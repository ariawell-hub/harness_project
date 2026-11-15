// 지적 대응(10.2절 (4)·(6), 4.5절): runner가 원장의 열린 P0·P1에 지적마다 세션 하나로 대응한다.
// 이 파일은 대응 기록(`review.json`), 원장에서 대상을 고르는 함수, 세션 출력에서 반박을 고르는 함수,
// 판정 실행 로그에서 지적의 근거·제안을 읽는 함수를 둔다. 세션·판정·댓글·push는 run.ts의 doReview가 한다.
// 원장 상태는 검증자 판정으로만 바뀐다. runner는 원장을 읽기만 하고, 자기 대응이 통했는지는 다음 판정으로 안다.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEWERS, cell, roundsOf, type Entry, type Ledger, type Reviewer } from '../ci/ledger.ts';
import { parseRebuttals, type Rebuttal } from '../ci/rebuttal.ts';
import { gitTry, harnessStateDir, repoInfo } from '../lib/git.ts';

/** 대응 한 번. head는 그 대응을 push한 커밋 */
export interface ReviewResponse {
  head: string;
  kind: 'fix' | 'rebuttal';
  /** 이 대응의 결과(다음 판정에서 닫혔는가, 여전히 열려 있는가)를 실패 기록에 반영했는가 */
  counted: boolean;
  /** 반박의 근거와 요지(kind가 rebuttal일 때만). 교착 보고에 적는다 */
  evidence?: string;
  summary?: string;
  /** 이 반박을 교착 보고(9.1절)에 올렸는가. 올린 반박은 다음 교착 판단에서 세지 않는다 */
  escalated?: boolean;
}

/** 이번 라운드에서 받았지만 아직 push하지 않은 반박. posted는 PR 댓글로 달았는가 */
export interface PendingRebuttal {
  evidence: string;
  summary: string;
  posted: boolean;
}

/** 지적 대응 상태. worktree 하네스 상태 폴더의 `review.json`(git이 추적하지 않는다). runner만 쓴다 */
export interface ReviewState {
  /**
   * 대응 키 → 대응 기록(오래된 것부터). 키는 지적 ID(`F3`)이거나, 차단 지적 없이 수정을 요청한
   * 검증자에 대한 대응이면 `review:<검증자>`다
   */
  responses: Record<string, ReviewResponse[]>;
  /** 마지막 대응 라운드: 대응 전 head와 push한 head, 대응 전 열린 차단 지적, 대응 전 원장의 가장 큰 지적 번호 */
  round: { base: string; head: string; open: string[]; maxId: number } | null;
  /** 지금 라운드에서 판정을 통과했지만 아직 push하지 않은 대응 키. push하면 비운다 */
  pending: string[];
  /** `pending` 가운데 반박으로 대응한 지적 ID → 그 반박. 없는 키는 수정이다. push하면 비운다 */
  rebuttals: Record<string, PendingRebuttal>;
}

function stateFile(worktree: string): string {
  return path.join(harnessStateDir(repoInfo(worktree), 'worktree'), 'review.json');
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** 없거나 깨졌으면 빈 상태 */
export function readReviewState(worktree: string): ReviewState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(worktree), 'utf8')) as Partial<ReviewState>;
    const responses: ReviewState['responses'] = {};
    for (const [k, list] of Object.entries(raw.responses ?? {})) {
      if (!Array.isArray(list)) continue;
      responses[k] = list
        .filter((r) => r && isStr(r.head) && (r.kind === 'fix' || r.kind === 'rebuttal'))
        .map((r) => ({
          head: r.head,
          kind: r.kind,
          counted: r.counted === true,
          ...(r.kind === 'rebuttal'
            ? {
                evidence: isStr(r.evidence) ? r.evidence : '',
                summary: isStr(r.summary) ? r.summary : '',
                ...(r.escalated === true ? { escalated: true } : {}),
              }
            : {}),
        }));
    }
    const rebuttals: ReviewState['rebuttals'] = {};
    for (const [k, r] of Object.entries(raw.rebuttals ?? {}))
      if (r && isStr(r.evidence) && isStr(r.summary))
        rebuttals[k] = { evidence: r.evidence, summary: r.summary, posted: r.posted === true };
    const r = raw.round;
    const round =
      r && isStr(r.base) && isStr(r.head) && Array.isArray(r.open) && Number.isInteger(r.maxId)
        ? { base: r.base, head: r.head, open: r.open.filter(isStr), maxId: r.maxId }
        : null;
    return {
      responses,
      round,
      pending: Array.isArray(raw.pending) ? raw.pending.filter(isStr) : [],
      rebuttals,
    };
  } catch {
    return { responses: {}, round: null, pending: [], rebuttals: {} };
  }
}

export function writeReviewState(worktree: string, s: ReviewState): void {
  writeFileSync(stateFile(worktree), JSON.stringify(s, null, 2) + '\n');
}

const idNumber = (id: string) => Number(id.slice(1));

/** 원장에서 이번에 대응할 지적: 상태가 open인 P0·P1, ID 순 */
export function openBlocking(ledger: Ledger): Entry[] {
  return ledger.findings
    .filter((e) => (e.severity === 'P0' || e.severity === 'P1') && e.status === 'open')
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

/** 원장의 가장 큰 지적 번호. 지적이 없으면 0 */
export function maxFindingId(ledger: Ledger): number {
  return ledger.findings.reduce((n, e) => Math.max(n, idNumber(e.id)), 0);
}

const lastUncounted = (state: ReviewState, key: string): ReviewResponse | null => {
  const last = state.responses[key]?.at(-1);
  return last && !last.counted ? last : null;
};

/**
 * 대응한 뒤 그 지적을 낸 검증자가 대응 head를 판정했는데도 열려 있는 지적 ID(아직 세지 않은 것).
 * 검증자가 대응 head를 아직 판정하지 않았으면(원장의 rounds에 없다) 세지 않는다
 */
export function failedResponses(state: ReviewState, ledger: Ledger): string[] {
  const out: string[] = [];
  for (const e of ledger.findings) {
    const last = lastUncounted(state, e.id);
    if (!last || e.status !== 'open') continue;
    if (ledger.rounds.some((r) => r.reviewer === e.reviewer && r.head === last.head))
      out.push(e.id);
  }
  return out.sort((a, b) => idNumber(a) - idNumber(b));
}

/** 대응한 뒤 닫힌 지적 ID(fixed·rejected·deferred. 아직 세지 않은 것). 그 실패 키는 0으로 돌아간다(9.2절) */
export function settledResponses(state: ReviewState, ledger: Ledger): string[] {
  return ledger.findings
    .filter((e) => lastUncounted(state, e.id) !== null && e.status !== 'open')
    .map((e) => e.id)
    .sort((a, b) => idNumber(a) - idNumber(b));
}

/** 그 키의 마지막 대응을 "결과를 반영했다"로 표시한 새 상태 */
export function markCounted(state: ReviewState, keys: readonly string[]): ReviewState {
  const responses = { ...state.responses };
  for (const k of keys) {
    const list = responses[k];
    if (!list?.length) continue;
    responses[k] = [...list.slice(0, -1), { ...list[list.length - 1], counted: true }];
  }
  return { ...state, responses };
}

/** 차단 지적 없이 수정을 요청한 검증자에 대한 대응 키(실패 키로도 쓴다) */
export const reviewerKey = (reviewer: Reviewer) => `review:${reviewer}`;

/** `review/<검증자>` context에서 검증자 이름. 검증자 context가 아니면 null */
export function reviewerOfContext(context: string): Reviewer | null {
  const name = context.startsWith('review/') ? context.slice('review/'.length) : '';
  return REVIEWERS.find((r) => r === name) ?? null;
}

/** 그 검증자가 마지막 판정에서 등록한 지적(미룬 것 포함), ID 순. 차단 지적 없는 수정 요청에 대응할 때 넘긴다 */
export function lastRoundFindings(ledger: Ledger, reviewer: Reviewer): Entry[] {
  const round = roundsOf(ledger, reviewer);
  return ledger.findings
    .filter((e) => e.reviewer === reviewer && e.round === round)
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

/**
 * 차단 지적 없는 수정 요청에 대응한 뒤, 그 검증자가 대응 head를 판정했는가(아직 세지 않은 대응).
 * 호출하는 쪽은 그 검증자의 `review/*`가 여전히 실패일 때 이 값으로 실패를 센다
 */
export function reviewerJudgedResponse(
  state: ReviewState,
  ledger: Ledger,
  reviewer: Reviewer,
): boolean {
  const last = lastUncounted(state, reviewerKey(reviewer));
  return !!last && ledger.rounds.some((r) => r.reviewer === reviewer && r.head === last.head);
}

/**
 * 중단 보고(Issue 댓글)의 "교차 검증 의견"에 쓰는 지적 한 줄(ID·등급·검증자·위치·제목).
 * 위치와 제목은 검증자 출력이라 원장 표와 같은 방법으로 마크다운·멘션 문자를 문자 참조로 바꾼다.
 * 실패 기록의 detail에는 쓰지 않는다: detail은 다음 세션 프롬프트의 "직전 실패"(데이터 블록 밖)에 들어간다
 */
export function findingLine(e: Entry): string {
  const where = e.file ? `${cell(e.file)}${e.line > 0 ? `:${e.line}` : ''}` : '(위치 없음)';
  return `${e.id} [${e.severity}, ${e.reviewer}] ${where} — ${cell(e.title)}`;
}

/** 커밋 메시지 제목에 쓸 지적 제목 앞부분: 한 줄(제어 문자와 유니코드 줄 구분자 없음) */
export function commitSubject(title: string, max = 60): string {
  return (
    title
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
      .replace(/ {2,}/g, ' ')
      .trim()
      .slice(0, max) || '지적 대응'
  );
}

// ---------- 반박 (10.2절 (4), 절차서 8절) ----------

const SHA40 = /^[0-9a-f]{40}$/;
/** 유니코드 줄·단락 구분자(U+2028, U+2029). 판정 워크플로의 규칙은 제어 문자만 거른다(TD-35) */
const LINE_SEPARATOR = /[\p{Zl}\p{Zp}]/u;

/**
 * 세션 출력에서 이 지적의 반박을 고른다. 형식·근거가 맞지 않으면 null.
 * 형식은 판정 워크플로와 같은 함수(`ci/rebuttal.ts`의 `parseRebuttals`)로 본다: 세션 출력을 PR 작성자의 댓글 하나로 넣는다.
 * 규칙을 여기 다시 구현하지 않는다(갈라지면 runner가 단 반박이 판정 워크플로에서 버려진다).
 * 더해서 runner가 근거를 확인한다. 판정 워크플로는 형식만 보고 근거가 있는지는 보지 않는다:
 * - 40자 SHA: 원격 브랜치(`<remote>/<지금 브랜치>`)의 조상인 커밋. 검증자는 push된 것만 볼 수 있다
 * - 경로(`경로` 또는 `경로:줄`): worktree에 있고 git이 추적하는 파일
 * - 링크: runner가 확인할 수 없어 받지 않는다
 * 요지에 유니코드 줄 구분자가 있어도 받지 않는다(검증자 입력에서 새 줄로 보일 수 있다)
 */
export function sessionRebuttal(o: {
  output: string;
  id: string;
  ledger: Ledger;
  /** owner/name */
  repo: string;
  worktree: string;
  /** 원격 이름. 기본 origin */
  remote?: string;
}): Rebuttal | null {
  const author = 'session';
  const r = parseRebuttals({
    comments: [{ user: { login: author }, body: o.output }],
    ledger: o.ledger,
    author,
    recorderBot: '',
    repo: o.repo,
  }).find((x) => x.id === o.id);
  if (!r || LINE_SEPARATOR.test(r.summary)) return null;
  if (SHA40.test(r.evidence)) {
    const branch = gitTry(['rev-parse', '--abbrev-ref', 'HEAD'], o.worktree);
    const name = branch.ok ? branch.stdout.trim() : '';
    if (!name || name === 'HEAD') return null;
    if (!gitTry(['cat-file', '-e', `${r.evidence}^{commit}`], o.worktree).ok) return null;
    const ref = `refs/remotes/${o.remote ?? 'origin'}/${name}`;
    return gitTry(['merge-base', '--is-ancestor', r.evidence, ref], o.worktree).ok ? r : null;
  }
  if (r.evidence.includes('://')) return null;
  const file = r.evidence.replace(/:\d+$/, '');
  try {
    if (!statSync(path.join(o.worktree, file)).isFile()) return null;
  } catch {
    return null;
  }
  return gitTry(['ls-files', '--error-unmatch', '--', file], o.worktree).ok ? r : null;
}

/**
 * 라운드의 반박을 담은 PR 댓글 본문: 절차서 8절의 세 줄 문단들을 코드 블록 하나에 넣는다(세션의 다른 글은 넣지 않는다).
 * 요지는 세션이 쓴 글이다. 코드 블록 안이라 GitHub이 멘션(`@계정`)·마크다운·`#번호` 참조로 해석하지 않는다(PR #96 원장 F1).
 * 값은 바꾸지 않는다: 여는 줄·문단·닫는 줄 사이에 빈 줄을 둬서 판정 워크플로(`parseRebuttals`)는 빈 줄로 나뉜
 * 세 줄 문단을 그대로 읽고, 여는 줄과 닫는 줄은 세 줄 문단이 아니라 버려진다.
 * 문단의 줄은 모두 `- `로 시작해 코드 블록을 닫지 못한다
 */
export function rebuttalComment(list: readonly Rebuttal[]): string {
  return [
    '```text',
    ...list.map((r) => `- 지적: ${r.id}\n- 근거: ${r.evidence}\n- 요지: ${r.summary}`),
    '```',
  ].join('\n\n');
}

const freshRebuttals = (list: readonly ReviewResponse[]) =>
  list.filter((r) => r.kind === 'rebuttal' && !r.escalated);

/**
 * 교착(9.1절)인 지적 ID: 아직 교착으로 올리지 않은 반박 대응이 2회 이상이고, 마지막 대응이 반박이며,
 * 그 반박을 push한 head를 그 지적을 낸 검증자가 판정했는데도 열려 있다
 */
export function deadlocked(state: ReviewState, ledger: Ledger): string[] {
  return ledger.findings
    .filter((e) => {
      const list = state.responses[e.id] ?? [];
      const last = list.at(-1);
      if (e.status !== 'open' || !last || last.kind !== 'rebuttal' || last.escalated) return false;
      return (
        freshRebuttals(list).length >= 2 &&
        ledger.rounds.some((r) => r.reviewer === e.reviewer && r.head === last.head)
      );
    })
    .map((e) => e.id)
    .sort((a, b) => idNumber(a) - idNumber(b));
}

/** 교착 보고에 적을 그 지적의 반박(아직 올리지 않은 것 가운데 마지막 둘, 오래된 것부터) */
export function deadlockRebuttals(state: ReviewState, id: string): ReviewResponse[] {
  return freshRebuttals(state.responses[id] ?? []).slice(-2);
}

/** 그 지적들의 반박을 "교착으로 올렸다"로 표시한 새 상태 */
export function markEscalated(state: ReviewState, ids: readonly string[]): ReviewState {
  const responses = { ...state.responses };
  for (const id of ids)
    responses[id] = (responses[id] ?? []).map((r) =>
      r.kind === 'rebuttal' ? { ...r, escalated: true } : r,
    );
  return { ...state, responses };
}

// ---------- 판정 실행 로그에서 근거·제안 읽기 (10.1절) ----------

/** 기록 job이 로그에 낸 지적 하나(`ci/record.ts`의 `reviewLogLines`). 검증자 출력이라 데이터로만 쓴다 */
export interface LoggedFinding {
  severity: string;
  file: string;
  line: number;
  title: string;
  evidence: string;
  suggestion: string;
}

const LOG_VERDICT = 'record-review: 판정 ';
// 한 줄씩 본다. `s` 플래그: 제목에 남은 유니코드 줄 구분자(U+2028, TD-35)도 `.`이 읽는다
const LOG_FINDING = /^\s*\[(P[0-3])\] (.*?):(\d+) (.*)$/s;
const LOG_EVIDENCE = /^\s*근거: (.*)$/s;
const LOG_SUGGESTION = /^\s*제안: (.*)$/s;
const LOG_TIME = /^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;

/** 판정 워크플로(`judge-claude.yml`, `judge-codex.yml`)에서 record-review를 실행하는 job의 이름 */
export const RECORD_JOB = 'record';

/**
 * `gh run view --log`의 줄 앞머리(job, step, 시각. 탭으로 나뉜다)를 뗀다. 기록 job이 찍는 본문에는 탭이 없다
 * (제어 문자는 공백이 된다). 앞머리가 있으면 기록 job의 줄만 읽는다: 판정 job은 PR 내용에 영향받는 LLM을 돌리므로
 * 그 job의 로그에 같은 모양의 줄이 있어도 지적으로 읽지 않는다. 다른 job의 줄은 빈 줄로 본다
 */
function logBody(line: string): string {
  const tab = line.lastIndexOf('\t');
  if (tab < 0) return line.replace(LOG_TIME, '');
  if (line.slice(0, line.indexOf('\t')) !== RECORD_JOB) return '';
  return line.slice(tab + 1).replace(LOG_TIME, '');
}

/**
 * 실행 로그(줄 앞에 job·step·시각이 붙어 있어도 된다)에서 record-review가 찍은 지적을 읽는다.
 * 판정 줄(`record-review: 판정 …`) 바로 뒤에 이어진 세 줄 묶음(위치·제목, 근거, 제안)만 읽는다. 기록 job은 본문을
 * 한 줄로 만들어 찍으므로 제목·근거 안의 글로는 줄이 늘지 않는다. 줄 앞머리가 있으면 기록 job(`RECORD_JOB`)의 줄만 본다.
 * 판정 줄이 여럿이면 마지막 것을 쓴다. 읽은 값은 검증자 출력이다: 프롬프트의 데이터 블록에만 넣는다
 */
export function parseReviewLog(text: string): LoggedFinding[] {
  const lines = text.split(/\r?\n/).map(logBody);
  let out: LoggedFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(LOG_VERDICT)) continue;
    const block: LoggedFinding[] = [];
    let j = i + 1;
    for (; j + 2 < lines.length; j += 3) {
      const head = LOG_FINDING.exec(lines[j]);
      const evidence = LOG_EVIDENCE.exec(lines[j + 1]);
      const suggestion = LOG_SUGGESTION.exec(lines[j + 2]);
      if (!head || !evidence || !suggestion) break;
      block.push({
        severity: head[1],
        file: head[2],
        line: Number(head[3]),
        title: head[4],
        evidence: evidence[1],
        suggestion: suggestion[1],
      });
    }
    out = block;
    i = j - 1;
  }
  return out;
}

/**
 * 그 지적이 등록된 판정의 head: 원장 rounds에서 그 검증자의 `round`번째 항목. 없으면 null.
 * 그 head의 `review/<검증자>` 상태가 가리키는 실행의 로그에 이 지적의 근거·제안이 있다
 */
export function findingHead(ledger: Ledger, e: Entry): string | null {
  return ledger.rounds.filter((r) => r.reviewer === e.reviewer)[e.round - 1]?.head ?? null;
}

/**
 * 로그에서 읽은 지적 가운데 원장의 이 지적과 위치·제목이 같은 것. 없으면 null.
 * 로그 줄의 `위치:줄 제목`을 통째로 견준다(위치에 `:숫자 `가 들어 있어 나누는 자리가 달라져도 같은 줄이면 같다).
 * 등급은 보지 않는다: 근거 없는 P1은 원장에 P2로 등록된다
 */
export function loggedFor(list: readonly LoggedFinding[], e: Entry): LoggedFinding | null {
  const want = `${e.file}:${e.line} ${e.title}`;
  return list.find((f) => `${f.file}:${f.line} ${f.title}` === want) ?? null;
}
