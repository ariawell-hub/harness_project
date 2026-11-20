// 지적 원장 댓글의 읽기·쓰기와 기록 job 연결(10.2절 (4)). 기록 job만 쓴다(recorder environment, 검증 App 토큰).
// 원장으로 인정하는 댓글은 작성자가 검증 App 봇(ci.recorderBot)인 것뿐이다. 봇 PAT과 PR 작성자도 같은 표식의 댓글을 쓸 수 있다(ADR-0003).
// 읽지 못하거나 깨졌으면 예외를 던지고, 기록 쪽은 review-ledger를 error로 남긴다(fail-closed).
// 제작자 승인(accepted)은 기록 job이 댓글의 편집 이력을 읽어 반영한다(accept-load.ts). 읽지 못하면 원장을 쓰지 않고 error다.
import { acceptErrorText, loadAccepted, type Graphql } from './accept-load.ts';
import {
  LEDGER_MARKER,
  applyPlanReview,
  applyVerdict,
  emptyLedger,
  ledgerStatus,
  parseLedger,
  renderLedger,
  type Ledger,
  type ReproResult,
  type Reviewer,
} from './ledger.ts';
import {
  LEDGER_CONTEXT,
  PLAN_HASH_RE,
  SHA_RE,
  cleanDescription,
  type StatusPayload,
} from './results.ts';
import { applyOwnerAccepts, type AcceptOutcome } from './owner-accept.ts';
import { githubGraphql } from './pr.ts';
import type { Verdict } from './verdict.ts';

/** GitHub 댓글 본문 상한 */
const COMMENT_MAX = 65_536;
const PER_PAGE = 100;
/** 댓글을 이만큼 넘겨도 끝이 나오지 않으면 원장 유무를 알 수 없다고 본다 */
const MAX_PAGES = 30;
const MAX_CI_FAILURES = 30;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface LedgerApi {
  get: (path: string) => Promise<unknown>;
  send: (method: 'POST' | 'PATCH', path: string, body: unknown) => Promise<unknown>;
  /** 댓글의 편집 이력을 읽는 GraphQL 요청(제작자 승인 확인). 없으면 승인을 보지 않는다 */
  graphql?: Graphql;
}

export interface StoredLedger {
  commentId: number | null;
  /** 게시 시각(openedAt)을 채운 원장. 댓글에 저장된 것과 다를 수 있다(stamped) */
  ledger: Ledger | null;
  /** 이번에 읽으면서 게시 시각을 채운 지적 수. 채운 것이 없으면 이 필드도 없다 */
  stamped?: number;
}

interface Where {
  /** owner/name */
  repo: string;
  /** PR 번호 */
  number: number;
  recorderBot: string;
}

/** 원장 댓글의 저장 시각으로 쓸 수 있는 값인가(원장 형식의 openedAt 조건과 같다) */
const validTime = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * 게시 시각 채우기: open인데 openedAt이 없는 지적에 원장 댓글의 마지막 저장 시각(GitHub이 정한 updated_at)을 적는다.
 * 원장 댓글에 들어 있는 열린 지적은 그 시각이나 그 전에 게시됐으므로, 이 값은 실제 게시 시각보다 앞설 수 없다.
 * 한 번 채워진 값은 바꾸지 않는다(원장을 저장하는 경로가 채워진 원장을 저장하므로 뒤의 수정으로 늦춰지지 않는다).
 * 러너의 시계는 쓰지 않는다: 그 시각과 실제 게시 사이에 단 승인 댓글이 아직 보이지 않는 지적을 닫게 된다
 */
function stampOpened(l: Ledger, updatedAt: unknown): { ledger: Ledger; stamped: number } {
  if (!validTime(updatedAt)) return { ledger: l, stamped: 0 };
  let stamped = 0;
  const findings = l.findings.map((e) => {
    if (e.status !== 'open' || e.openedAt !== undefined) return e;
    stamped++;
    return { ...e, openedAt: updatedAt };
  });
  return stamped ? { ledger: { ...l, findings }, stamped } : { ledger: l, stamped: 0 };
}

export function checkWhere(o: Where): void {
  if (!o.recorderBot) throw new Error('ci.recorderBot 설정이 없어 원장 댓글을 가릴 수 없다');
  if (!REPO_RE.test(o.repo)) throw new Error('repo 형식 오류(owner/name)');
  if (!Number.isInteger(o.number) || o.number <= 0) throw new Error('PR 번호를 모른다');
}

export interface IssueComment {
  id?: unknown;
  user?: { login?: unknown } | null;
  body?: unknown;
  /** REST의 마지막 수정 시각. 원장 댓글의 게시 시각을 얻는 데에만 쓴다(승인 댓글의 편집 여부는 이 값으로 보지 않는다) */
  updated_at?: unknown;
}

/** PR의 댓글을 시간순으로 모두 읽는다. 끝을 확인하지 못하면 예외 */
export async function listComments(o: {
  get: LedgerApi['get'];
  repo: string;
  number: number;
}): Promise<IssueComment[]> {
  const out: IssueComment[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = await o.get(
      `repos/${o.repo}/issues/${o.number}/comments?per_page=${PER_PAGE}&page=${page}`,
    );
    if (!Array.isArray(raw)) throw new Error('댓글 목록이 배열이 아니다');
    out.push(...(raw as IssueComment[]));
    if (raw.length < PER_PAGE) return out;
  }
  throw new Error(`댓글이 ${MAX_PAGES * PER_PAGE}개를 넘어 원장 유무를 알 수 없다`);
}

/**
 * 댓글 목록에서 검증 App 봇이 쓴 원장 댓글 중 가장 오래된 것을 고른다. 없으면 둘 다 null, 깨졌으면 예외.
 * 열린 지적의 게시 시각을 채워 돌려준다(stampOpened)
 */
export function ledgerFromComments(
  comments: readonly IssueComment[],
  recorderBot: string,
): StoredLedger {
  for (const c of comments) {
    if (c?.user?.login !== recorderBot) continue;
    if (typeof c.body !== 'string' || !c.body.includes(LEDGER_MARKER)) continue;
    if (typeof c.id !== 'number') throw new Error('원장 댓글에 id가 없다');
    const ledger = parseLedger(c.body);
    if (!ledger) throw new Error(`원장 댓글(${c.id})이 깨졌다`);
    const s = stampOpened(ledger, c.updated_at);
    return { commentId: c.id, ledger: s.ledger, ...(s.stamped ? { stamped: s.stamped } : {}) };
  }
  return { commentId: null, ledger: null };
}

/** 검증 App 봇이 쓴 원장 댓글 중 가장 오래된 것을 읽는다. 없으면 둘 다 null */
export async function loadLedger(o: Where & { get: LedgerApi['get'] }): Promise<StoredLedger> {
  checkWhere(o);
  return ledgerFromComments(await listComments(o), o.recorderBot);
}

/** 원장 댓글을 만들거나 고친다. 본문이 댓글 상한을 넘으면 쓰지 않고 예외 */
export async function saveLedger(o: {
  send: LedgerApi['send'];
  repo: string;
  number: number;
  commentId: number | null;
  ledger: Ledger;
}): Promise<void> {
  const body = renderLedger(o.ledger);
  if (body.length > COMMENT_MAX)
    throw new Error(`원장 본문이 ${body.length}자라 댓글 상한(${COMMENT_MAX}자)을 넘는다`);
  if (o.commentId === null)
    await o.send('POST', `repos/${o.repo}/issues/${o.number}/comments`, { body });
  else await o.send('PATCH', `repos/${o.repo}/issues/comments/${o.commentId}`, { body });
}

export interface RecordLedgerOptions extends Where {
  /** 제작자 계정(github.owner). 주면 제작자 승인 댓글을 원장에 반영한다. 없거나 비면 승인을 보지 않는다 */
  owner?: string;
  /** 제작자 승인을 반영한 결과(로그용). 승인을 본 실행에서만 부른다 */
  onAccepts?: (o: AcceptOutcome) => void;
  reviewer: Reviewer;
  /** 형식 검사와 시크릿 스캔을 통과한 판정. 판정이 없으면(해당 없음, 이어받음, error) null */
  verdict: Verdict | null;
  headSha: string;
  /** 원장을 새로 만들 때 적을 프롬프트 버전(이 실행의 base SHA) */
  promptBase: string;
  /** 이 검증자의 직전 판정 head 이후 바뀐 파일(plan job이 계산). 모르면 null */
  changedSinceLastRound: readonly string[] | null;
  /** 재현 job 결과(판정 findings 순번 → 결과). 없으면 재현 표시 없이 등록한다 */
  repro?: ReadonlyMap<number, ReproResult>;
  /**
   * 계획 전용 head(mode=plan)일 때만 준다(G1, 4.1절). 코드가 섞인 head의 판정은 계획 승인으로 남기지 않는다.
   * approved: 이 검증자의 review/*가 success면 true, failure면 false, error면 null
   */
  plan?: { hash: string; approved: boolean | null };
  /** 원장 댓글을 읽고 쓸 API(Pull requests 쓰기 토큰). 토큰을 받지 못했으면 null */
  api: LedgerApi | null;
  post: (p: StatusPayload) => Promise<void>;
}

/**
 * 판정을 원장에 반영해 댓글을 쓰고 review-ledger 상태를 head에 기록한다.
 * 판정이 없어도 지금 원장으로 판정한다. 원장이 없고 지적도 계획 승인도 없으면 댓글을 만들지 않는다.
 * 제작자 승인: 읽은 원장에 반영하고, 판정을 적용한 뒤 같은 승인 목록으로 한 번 더 반영한다(GraphQL은 한 번).
 * 편집 이력을 읽지 못하면 원장을 쓰지 않고 error다. 이번 판정으로 등록되거나 다시 열린 지적은 게시 시각이 없어
 * 이 실행에서는 승인되지 않는다. 이 실행에서 승인이 철회돼 다시 열린 지적은 같은 실행의 판정으로 바뀌지 않는다
 */
export async function recordLedger(o: RecordLedgerOptions): Promise<StatusPayload> {
  const done = async (state: StatusPayload['state'], description: string) => {
    const p = { context: LEDGER_CONTEXT, state, description: cleanDescription(description) };
    await o.post(p);
    return p;
  };
  if (!o.api) return done('error', '원장 토큰 없음(검증 App에 Pull requests 쓰기 권한이 필요하다)');
  try {
    const stored = await loadLedger({ ...o, get: o.api.get });
    let ledger = stored.ledger;
    const v = o.verdict;
    // 계획 승인은 둘 곳이 원장뿐이라 지적이 없어도 원장을 만든다
    const planApproved = o.plan?.approved === true;
    const before = ledger ? JSON.stringify(ledger) : '';
    // 게시 시각을 채운 것만 달라도 저장한다(before는 채운 뒤의 값이다)
    const stamped = !!stored.stamped;
    let accepted: Awaited<ReturnType<typeof loadAccepted>> | null = null;
    if (ledger && o.owner && o.api.graphql) {
      try {
        accepted = await loadAccepted({
          ledger,
          owner: o.owner,
          graphql: o.api.graphql,
          repo: o.repo,
          number: o.number,
        });
      } catch (e) {
        // 확인하지 못한 승인을 유지하거나 새로 반영하지 않는다. 원래 예외의 문구(응답 본문일 수 있다)는 버린다
        throw new Error(acceptErrorText(e));
      }
      ledger = accepted.ledger;
    }
    const checkBase = () => {
      if (!SHA_RE.test(o.promptBase)) throw new Error('프롬프트 버전 SHA 형식 오류');
    };
    // 이 실행에서 승인이 철회돼 다시 열린 지적: 같은 실행의 판정(resolutions)으로 바꾸지 않는다.
    // 저장된 원장에서 accepted였던 지적이라 판정이 건드릴 수 없었던 것이고, 철회는 open으로 저장돼 review-ledger를 막아야 한다.
    // 다음 판정부터는 열린 지적으로 평소처럼 판정된다
    const reopened = new Set(accepted?.outcome?.reopened ?? []);
    const verdict =
      v && reopened.size
        ? { ...v, resolutions: v.resolutions.filter((r) => !reopened.has(r.id)) }
        : v;
    if (v && verdict && (ledger || v.findings.length > 0 || planApproved)) {
      checkBase();
      ledger = applyVerdict(ledger ?? emptyLedger(o.promptBase), {
        reviewer: o.reviewer,
        verdict,
        headSha: o.headSha,
        changedSinceLastRound: o.changedSinceLastRound,
        repro: o.repro,
      });
    }
    if (o.plan && (ledger || planApproved)) {
      if (!PLAN_HASH_RE.test(o.plan.hash)) throw new Error('계획 해시 형식 오류');
      if (!ledger) checkBase();
      ledger = applyPlanReview(ledger ?? emptyLedger(o.promptBase), {
        reviewer: o.reviewer,
        hash: o.plan.hash,
        headSha: o.headSha,
        approved: o.plan.approved,
      });
    }
    if (ledger && accepted?.outcome) {
      const again = applyOwnerAccepts(ledger, accepted.accepts);
      ledger = again.ledger;
      // 로그에는 읽은 원장 기준의 결과를 낸다(다시 적용한 결과는 같은 승인 목록이라 반영·무시가 같다)
      o.onAccepts?.({ ...accepted.outcome, ledger });
    }
    if (ledger && (stamped || JSON.stringify(ledger) !== before))
      await saveLedger({ ...o, send: o.api.send, commentId: stored.commentId, ledger });
    if (!ledger) return done('success', '원장 없음(등록된 지적이 없다)');
    const s = ledgerStatus(ledger);
    return done(s.state, s.description);
  } catch (e) {
    return done('error', `원장 처리 실패: ${e instanceof Error ? e.message : '오류'}`);
  }
}

/** check 실패를 원장에 남긴다(9.2절 실패 횟수의 근거). 같은 실행은 한 번만, 최근 것만 둔다 */
export async function recordCiFailure(
  o: Where & { api: LedgerApi; headSha: string; run: string; promptBase: string },
): Promise<void> {
  if (!SHA_RE.test(o.headSha) || !SHA_RE.test(o.promptBase)) throw new Error('SHA 형식 오류');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(o.run))
    throw new Error('실행 URL 형식 오류');
  const stored = await loadLedger({ ...o, get: o.api.get });
  const ledger = stored.ledger ?? emptyLedger(o.promptBase);
  if (ledger.ciFailures.some((f) => f.run === o.run)) return;
  const next: Ledger = {
    ...ledger,
    ciFailures: [...ledger.ciFailures, { head: o.headSha, run: o.run }].slice(-MAX_CI_FAILURES),
  };
  await saveLedger({ ...o, send: o.api.send, commentId: stored.commentId, ledger: next });
}

/** 검증 App 토큰으로 댓글을 읽고 쓰는 API */
export function githubLedgerApi(token: string, apiUrl?: string): LedgerApi {
  const api = (apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`${api}/${p}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    // 응답 본문은 오류 문구에 넣지 않는다(댓글 내용이 섞일 수 있다)
    if (!res.ok) throw new Error(`GitHub ${method} 실패: HTTP ${res.status}`);
    return res.json();
  };
  return {
    get: (p) => call('GET', p),
    send: (m, p, b) => call(m, p, b),
    graphql: githubGraphql(token, apiUrl),
  };
}
