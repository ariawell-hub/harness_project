// 지표(17.2절)의 자료 원천: 기간과 GitHub 읽기. 읽기만 한다.
// 다 읽었는지 알 수 없으면 값을 내지 않고 SourceError로 끝낸다: 빠진 결함이 "결함 없음"으로 기록되면 안 된다.
import type { Ledger } from '../ci/ledger.ts';
import type { HarnessConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { getGitHub, type GitHubPort } from '../lib/github.ts';
import { readPrLedger } from '../runner/ledger-read.ts';

/** YYYY-MM-DD(UTC), 양끝 포함 */
export interface Period {
  since: string;
  until: string;
}

/** 자료를 읽지 못했거나 다 읽었는지 알 수 없다 */
export class SourceError extends Error {}

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
/** gh 목록 조회(`--limit`)와 Actions 실행 목록(`created` 조건)의 상한. 이 수에 닿으면 더 있는지 알 수 없다 */
const LIMIT = 1000;
/** 버그 Issue의 라벨(17.2절 "병합 후 결함") */
const BUG_LABEL = 'bug';
/** PR 커밋 조회가 PR 하나에 주는 커밋 수의 상한(GitHub REST "List commits on a pull request") */
const PR_COMMITS_LIMIT = 250;
/** head별 PR 조회의 `--limit` */
const HEAD_PRS_LIMIT = 100;
const SHA_RE = /^[0-9a-f]{40}$/;

function dayMs(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  // 2026-02-30처럼 없는 날짜는 다른 날로 넘어간다
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day ? null : t;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 기간의 날짜들(UTC), 이른 날부터 */
export function daysOf(p: Period): string[] {
  const from = dayMs(p.since);
  const to = dayMs(p.until);
  if (from === null || to === null) throw new Error(`기간이 틀리다: ${p.since} ~ ${p.until}`);
  const out: string[] = [];
  for (let t = from; t <= to; t += DAY_MS) out.push(dayOf(t));
  return out;
}

/** `day`의 n일 전(UTC) */
export function daysBefore(day: string, n: number): string {
  const t = dayMs(day);
  if (t === null) throw new Error(`날짜가 틀리다: ${day}`);
  return dayOf(t - n * DAY_MS);
}

/**
 * GitHub 검색의 날짜 범위. 종료일 뒤의 항목이 쌓여도 조회 상한에 닿지 않게 끝을 둔다.
 * 끝은 하루 넉넉히 잡는다(검색의 날짜 경계 해석에 기대지 않는다). 받은 뒤에 `inPeriod`로 다시 거른다
 */
function searchRange(p: Period): string {
  return `${p.since}..${daysBefore(p.until, -1)}`;
}

export function parsePeriod(
  since: string | undefined,
  until: string | undefined,
  now: Date,
): Period {
  const end = until ?? dayOf(now.getTime());
  const endMs = dayMs(end);
  if (endMs === null) throw new Error(`--until이 YYYY-MM-DD 꼴의 날짜가 아니다: ${end}`);
  const start = since ?? dayOf(endMs - (DEFAULT_DAYS - 1) * DAY_MS);
  const startMs = dayMs(start);
  if (startMs === null) throw new Error(`--since가 YYYY-MM-DD 꼴의 날짜가 아니다: ${start}`);
  if (startMs > endMs) throw new Error(`--since(${start})가 --until(${end})보다 뒤다`);
  return { since: start, until: end };
}

export function inPeriod(iso: string, p: Period): boolean {
  const t = Date.parse(iso);
  const from = dayMs(p.since);
  const to = dayMs(p.until);
  if (Number.isNaN(t) || from === null || to === null) return false;
  return t >= from && t < to + DAY_MS;
}

export interface MergedPr {
  number: number;
  head: string;
  headSha: string;
  createdAt: string;
  mergedAt: string;
  /** main에 들어간 병합 커밋의 SHA. 모르면 '' */
  mergeSha: string;
  additions: number;
  deletions: number;
  /** PR에 든 커밋의 SHA 전부. 다 받지 못하면 `mergedPrs`가 SourceError를 던지므로 일부만 든 목록은 없다 */
  commits: string[];
  /** 다른 리포(포크)의 브랜치에서 온 PR인가 */
  crossRepo: boolean;
}

export interface WorkflowRun {
  path: string;
  event: string;
  branch: string;
  headSha: string;
  status: string;
  /** 끝나지 않았으면 '' */
  conclusion: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  attempt: number;
  /** 같은 워크플로 안에서 실행마다 늘어나는 번호. 같은 초에 만들어진 실행의 순서를 가린다 */
  runNumber: number;
  /** 실행의 head 리포가 이 리포인가. 포크의 같은 이름 브랜치에서 돈 실행을 가린다 */
  sameRepo: boolean;
}

export interface BugIssue {
  number: number;
  createdAt: string;
}

/** 커밋 상태 기록 하나 */
export interface HeadStatus {
  context: string;
  state: string;
  /** 없으면 '' */
  description: string;
  /** 기록한 계정의 login. 없으면 '' */
  creator: string;
  at: string;
}

export interface LabelEvent {
  issue: number;
  at: string;
}

export type EscalationKind =
  | 'stop-limit'
  | 'stop-deadlock'
  | 'stop-failures'
  | 'stop-conflict'
  | 'stop-other'
  | 'question'
  | 'approval'
  | 'ci-stall'
  | 'revert';

/** 봇이 쓴 에스컬레이션 댓글. 본문은 담지 않는다(14.6절) */
export interface BotComment {
  issue: number;
  at: string;
  kind: EscalationKind;
}

export interface MetricsSource {
  mergedPrs(p: Period): MergedPr[];
  workflowRuns(p: Period): WorkflowRun[];
  bugIssues(p: Period): BugIssue[];
  /** PR의 지적 원장. 없으면 null */
  ledger(pr: number): Ledger | null;
  /** PR head 커밋의 커밋 상태 전체(옛 기록 포함) */
  headStatuses(sha: string): HeadStatus[];
  /** 기간에 needs-human 라벨이 붙은 사건 */
  needsHumanEvents(p: Period): LabelEvent[];
  /** 기간에 봇 계정(`cfg.github.bot`)이 쓴 에스컬레이션 댓글 */
  escalationComments(p: Period): BotComment[];
  /** 그 head 브랜치 이름으로 열린 PR의 수(상태·base·포크 여부와 무관) */
  headPrCount(head: string): number;
}

/**
 * 봇 댓글의 본문을 에스컬레이션 종류로 가른다. 어느 것도 아니면 null.
 * 문구는 댓글을 쓰는 코드의 것이다: 중단 보고 둘과 질문·승인·CI 대기는 scripts/runner/run.ts,
 * 실패 사유는 scripts/lib/attempts.ts, 자동 revert 불가 표식은 scripts/ci/revert.ts
 */
export function classifyEscalation(body: string): EscalationKind | null {
  const lines = body.split('\n');
  if (lines.some((l) => l.startsWith('## 중단 보고:'))) {
    const cause = lines.find((l) => l.startsWith('- 추정 원인: '))?.slice('- 추정 원인: '.length);
    if (cause !== undefined) {
      if (cause.startsWith('교착')) return 'stop-deadlock';
      if (cause.startsWith('step 총량 상한')) return 'stop-limit';
      if (/^실패 키 .+ \d+회/.test(cause)) return 'stop-failures';
      // PR #44 전의 갱신 충돌 보고는 실패 중단 보고의 형식으로 쓰였다
      if (cause.includes('병합이 충돌한다')) return 'stop-conflict';
    }
    if (lines.some((l) => l.startsWith('- 원인: ') && l.includes('병합이 충돌한다')))
      return 'stop-conflict';
    return 'stop-other';
  }
  if (body.includes('<!-- harness-revert-escalate')) return 'revert';
  if (/질문 \d+건을 남겼다/.test(body)) return 'question';
  if (body.includes('제작자 승인을 기다린다')) return 'approval';
  if (body.includes('CI 대기가')) return 'ci-stall';
  return null;
}

const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** `what`을 읽다가 난 예외를 SourceError로 바꾼다 */
function reading<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`${what}을(를) 읽지 못했다: ${first(e)}`);
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(o: Json, k: string): string {
  if (typeof o[k] !== 'string') throw new Error(`${k}가 문자열이 아니다`);
  return o[k];
}
function num(o: Json, k: string): number {
  if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) throw new Error(`${k}가 수가 아니다`);
  return o[k];
}
/** 없거나 null이면 '' */
function optStr(o: Json, k: string): string {
  if (o[k] === null || o[k] === undefined) return '';
  return str(o, k);
}
function time(o: Json, k: string): string {
  const v = str(o, k);
  if (Number.isNaN(Date.parse(v))) throw new Error(`${k}가 시각이 아니다`);
  return v;
}
function bool(o: Json, k: string): boolean {
  if (typeof o[k] !== 'boolean') throw new Error(`${k}가 참·거짓이 아니다`);
  return o[k];
}

/**
 * `gh api --paginate --jq '… | tojson'`의 출력을 객체들로 바꾼다. 쪽마다 jq를 적용한 결과가 이어져 오므로
 * 쪽의 경계 없이 한 줄에 JSON 하나다. 같은 `id`가 두 번 오면 읽는 동안 목록이 바뀐 것이라 끝낸다
 */
function jsonLines(what: string, text: string): Json[] {
  const ids = new Set<number>();
  const out: Json[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const v: unknown = JSON.parse(line);
    if (!isObj(v)) throw new Error('응답 줄이 객체가 아니다');
    const id = num(v, 'id');
    if (ids.has(id))
      throw new SourceError(
        `${what}: 같은 기록이 중복으로 왔다. 읽는 동안 목록이 바뀌어 빠진 기록이 있을 수 있다. 다시 실행하라`,
      );
    ids.add(id);
    out.push(v);
  }
  return out;
}

function list(text: string): Json[] {
  const v: unknown = JSON.parse(text);
  if (!Array.isArray(v) || !v.every(isObj)) throw new Error('응답이 객체 배열이 아니다');
  return v;
}

function capped(what: string, n: number): void {
  if (n >= LIMIT)
    throw new SourceError(
      `${what}이(가) 조회 상한(${LIMIT}건)에 닿아 다 읽었는지 알 수 없다. --since·--until로 기간을 줄여 다시 실행하라`,
    );
}

/**
 * 목록에 같은 번호가 두 번 오면 끝낸다. 읽는 동안 검색 결과의 순서가 바뀌면 페이지 경계에서
 * 한 항목이 두 번 오고 다른 항목이 빠질 수 있다. 그때도 받은 수는 상한보다 적다
 */
function unique(what: string, raw: Json[]): void {
  const seen = new Set<number>();
  for (const x of raw) {
    const n = num(x, 'number');
    if (seen.has(n))
      throw new SourceError(
        `${what}: 같은 번호(#${n})가 중복으로 왔다. 읽는 동안 목록이 바뀌어 빠진 항목이 있을 수 있다. 다시 실행하라`,
      );
    seen.add(n);
  }
}

/** 실행 목록의 한 페이지를 머리 줄(`{"total":N}`)과 실행 줄들로 바꾼다. 줄마다 JSON 하나다 */
const RUNS_JQ =
  '({total: .total_count} | tojson), (.workflow_runs[] | {id, path, event, branch: .head_branch, headSha: .head_sha, status, conclusion, createdAt: .created_at, startedAt: .run_started_at, updatedAt: .updated_at, attempt: .run_attempt, runNumber: .run_number, sameRepo: (.head_repository.full_name == .repository.full_name)} | tojson)';

// `commits`는 달라고 하지 않는다: `--limit 1000`과 함께 쓰면 GraphQL 노드 한도를 넘어 조회가 실패한다
const PR_FIELDS =
  'number,headRefName,headRefOid,createdAt,mergedAt,mergeCommit,additions,deletions,isCrossRepository';

/** 한 줄에 SHA 하나 */
const PR_COMMITS_JQ = '.[].sha';
const STATUSES_JQ =
  '.[] | {id, context, state, description, creator: .creator.login, at: .created_at} | tojson';
const EVENTS_JQ =
  '.[] | select(.event == "labeled") | {id, label: .label.name, issue: .issue.number, at: .created_at} | tojson';
// 본문은 분류에만 쓰고 결과에 담지 않는다
const COMMENTS_JQ =
  '.[] | {id, user: .user.login, at: .created_at, issue: (.issue_url | split("/") | last | tonumber), body} | tojson';

export function ghSource(o: {
  cfg: HarnessConfig;
  /** `gh <args>`를 실행해 표준 출력을 돌려준다. 실패하면 예외 */
  gh: (args: string[]) => string;
  ledger: (pr: number) => Ledger | null;
}): MetricsSource {
  const base = o.cfg.github.defaultBranch;

  function runsOn(day: string): WorkflowRun[] {
    const what = `${day}의 Actions 실행 목록`;
    return reading(what, () => {
      const text = o.gh([
        'api',
        '--paginate',
        `repos/{owner}/{repo}/actions/runs?created=${day}&per_page=100`,
        '--jq',
        RUNS_JQ,
      ]);
      const totals = new Set<number>();
      const ids = new Set<number>();
      const runs: WorkflowRun[] = [];
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const v: unknown = JSON.parse(line);
        if (!isObj(v)) throw new Error('응답 줄이 객체가 아니다');
        if ('total' in v) {
          totals.add(num(v, 'total'));
          continue;
        }
        // 읽는 동안 목록이 바뀌면 페이지 경계에서 한 실행이 두 번 오고 다른 실행이 빠질 수 있다.
        // 그때도 받은 수는 total_count와 같으므로 실행 id로 가린다
        const id = num(v, 'id');
        if (ids.has(id))
          throw new SourceError(
            `${what}: 같은 실행이 중복으로 왔다. 읽는 동안 목록이 바뀌어 빠진 실행이 있을 수 있다. 다시 실행하라`,
          );
        ids.add(id);
        runs.push({
          path: str(v, 'path'),
          event: str(v, 'event'),
          branch: optStr(v, 'branch'),
          headSha: str(v, 'headSha'),
          status: str(v, 'status'),
          conclusion: optStr(v, 'conclusion'),
          createdAt: time(v, 'createdAt'),
          startedAt: optStr(v, 'startedAt'),
          updatedAt: optStr(v, 'updatedAt'),
          attempt: num(v, 'attempt'),
          runNumber: num(v, 'runNumber'),
          sameRepo: bool(v, 'sameRepo'),
        });
      }
      if (totals.size !== 1)
        throw new SourceError(
          `${what}: total_count를 하나로 읽지 못했다(${[...totals].join(', ') || '없음'}). 읽는 동안 실행이 늘었을 수 있다. 다시 실행하라`,
        );
      const [total] = totals;
      capped(what, total);
      if (runs.length !== total)
        throw new SourceError(
          `${what}: 받은 실행 ${runs.length}건이 total_count ${total}건과 다르다. 다시 실행하라`,
        );
      return runs;
    });
  }

  /** PR에 든 커밋의 SHA 전부. 쪽을 넘긴 결과가 한 줄에 SHA 하나로 이어져 온다 */
  function commitsOf(pr: number): string[] {
    const what = `PR #${pr}의 커밋 목록`;
    return reading(what, () => {
      const text = o.gh([
        'api',
        '--paginate',
        `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`,
        '--jq',
        PR_COMMITS_JQ,
      ]);
      const shas = text.split('\n').filter((l) => l.trim() !== '');
      // 병합된 PR에는 커밋이 하나 이상 있다. 빈 목록은 다 읽은 결과가 아니다
      if (!shas.length)
        throw new SourceError(`${what}이 비어 있다. 응답을 읽지 못했을 수 있다. 다시 실행하라`);
      const seen = new Set<string>();
      for (const sha of shas) {
        if (!SHA_RE.test(sha)) throw new Error('커밋 SHA가 아닌 줄이 있다');
        if (seen.has(sha))
          throw new SourceError(
            `${what}: 같은 커밋이 중복으로 왔다. 읽는 동안 목록이 바뀌어 빠진 커밋이 있을 수 있다. 다시 실행하라`,
          );
        seen.add(sha);
      }
      if (shas.length >= PR_COMMITS_LIMIT)
        throw new SourceError(
          `${what}이 조회 상한(${PR_COMMITS_LIMIT}개)에 닿아 다 읽었는지 알 수 없다. 이 PR이 병합된 날을 뺀 기간으로 다시 실행하라`,
        );
      return shas;
    });
  }

  return {
    mergedPrs(p) {
      const what = '병합된 PR 목록';
      const prs = reading(what, () => {
        const raw = list(
          o.gh([
            'pr',
            'list',
            '--state',
            'merged',
            '--base',
            base,
            '--search',
            `merged:${searchRange(p)}`,
            '--limit',
            String(LIMIT),
            '--json',
            PR_FIELDS,
          ]),
        );
        capped(what, raw.length);
        unique(what, raw);
        return raw
          .map((x) => ({
            number: num(x, 'number'),
            head: str(x, 'headRefName'),
            headSha: str(x, 'headRefOid'),
            createdAt: str(x, 'createdAt'),
            mergedAt: time(x, 'mergedAt'),
            mergeSha: isObj(x.mergeCommit) ? optStr(x.mergeCommit, 'oid') : '',
            additions: num(x, 'additions'),
            deletions: num(x, 'deletions'),
            crossRepo: bool(x, 'isCrossRepository'),
          }))
          .filter((x) => inPeriod(x.mergedAt, p));
      });
      // 커밋 목록은 기간 안의 PR에만, PR마다 한 번 읽는다
      return prs.map((x) => ({ ...x, commits: commitsOf(x.number) }));
    },
    workflowRuns(p) {
      return daysOf(p)
        .flatMap(runsOn)
        .filter((r) => inPeriod(r.createdAt, p));
    },
    bugIssues(p) {
      const what = `버그 Issue 목록(라벨 ${BUG_LABEL})`;
      return reading(what, () => {
        const raw = list(
          o.gh([
            'issue',
            'list',
            '--state',
            'all',
            '--label',
            BUG_LABEL,
            '--search',
            `created:${searchRange(p)}`,
            '--limit',
            String(LIMIT),
            '--json',
            'number,createdAt',
          ]),
        );
        capped(what, raw.length);
        unique(what, raw);
        return raw
          .map((x) => ({ number: num(x, 'number'), createdAt: time(x, 'createdAt') }))
          .filter((x) => inPeriod(x.createdAt, p));
      });
    },
    ledger(pr) {
      return reading(`PR #${pr}의 지적 원장`, () => o.ledger(pr));
    },
    headStatuses(sha) {
      const what = `커밋 ${sha.slice(0, 12)}의 상태 기록`;
      return reading(what, () => {
        // 경로에 그대로 들어가는 값이다
        if (!SHA_RE.test(sha)) throw new Error('커밋 SHA가 16진수 40자가 아니다');
        const text = o.gh([
          'api',
          '--paginate',
          `repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`,
          '--jq',
          STATUSES_JQ,
        ]);
        return jsonLines(what, text).map((v) => ({
          context: str(v, 'context'),
          state: str(v, 'state'),
          description: optStr(v, 'description'),
          creator: optStr(v, 'creator'),
          at: time(v, 'at'),
        }));
      });
    },
    needsHumanEvents(p) {
      const what = '라벨 이벤트 목록';
      return reading(what, () => {
        const text = o.gh([
          'api',
          '--paginate',
          'repos/{owner}/{repo}/issues/events?per_page=100',
          '--jq',
          EVENTS_JQ,
        ]);
        return jsonLines(what, text)
          .filter((v) => v.label === o.cfg.github.needsHumanLabel)
          .map((v) => ({ issue: num(v, 'issue'), at: time(v, 'at') }))
          .filter((x) => inPeriod(x.at, p));
      });
    },
    escalationComments(p) {
      const what = '리포 댓글 목록';
      return reading(what, () => {
        const text = o.gh([
          'api',
          '--paginate',
          // since는 경계를 포함한다: 갱신 시각이 since와 같은 댓글도 온다(2026-11-20에 이 리포에서 확인.
          // 같은 시각이면 오고 1초 뒤로 주면 오지 않는다). 시작일 00:00:00Z에 쓰인 댓글을 받는다
          `repos/{owner}/{repo}/issues/comments?since=${p.since}T00:00:00Z&per_page=100`,
          '--jq',
          COMMENTS_JQ,
        ]);
        const out: BotComment[] = [];
        for (const v of jsonLines(what, text)) {
          // 봇 계정이 쓴 댓글만 본다. 같은 문구를 다른 계정이 써도 세지 않는다
          if (v.user !== o.cfg.github.bot) continue;
          const at = time(v, 'at');
          if (!inPeriod(at, p)) continue;
          const kind = classifyEscalation(optStr(v, 'body'));
          if (kind) out.push({ issue: num(v, 'issue'), at, kind });
        }
        return out;
      });
    },
    headPrCount(head) {
      const what = `head 브랜치 ${JSON.stringify(head)}로 열린 PR 목록`;
      return reading(what, () => {
        // `--head` 뒤 한 자리에 그대로 들어가는 값이다
        if (!head || head.startsWith('-')) throw new Error('브랜치 이름이 비었거나 -로 시작한다');
        const raw = list(
          o.gh([
            'pr',
            'list',
            '--state',
            'all',
            '--head',
            head,
            '--limit',
            String(HEAD_PRS_LIMIT),
            '--json',
            'number',
          ]),
        );
        if (raw.length >= HEAD_PRS_LIMIT)
          throw new SourceError(
            `${what}이 조회 상한(${HEAD_PRS_LIMIT}건)에 닿아 다 읽었는지 알 수 없다`,
          );
        return raw.length;
      });
    },
  };
}

/**
 * 실제 `gh` CLI와 `readPrLedger`를 끼운 `ghSource`.
 * 가짜 GitHub(`HARNESS_FAKE_GH`, 테스트·스모크)에서는 읽지 않는다: 가짜에는 실행 목록이 없고, 실제 `gh`를 부르면 엉뚱한 리포를 읽는다
 */
export function defaultSource(cwd: string, cfg: HarnessConfig): MetricsSource {
  let port: GitHubPort | null = null;
  return ghSource({
    cfg,
    gh(args) {
      if (process.env.HARNESS_FAKE_GH)
        throw new Error('가짜 GitHub(HARNESS_FAKE_GH)에서는 지표 자료를 읽을 수 없다');
      const r = runSync('gh', args, { cwd, timeoutMs: 120_000 });
      if (r.code !== 0)
        throw new Error(
          `gh ${args.slice(0, 2).join(' ')} 종료 코드 ${r.code}: ${first(r.stderr.trim())}`,
        );
      return r.stdout;
    },
    ledger: (pr) => readPrLedger((port ??= getGitHub(cwd)), cfg, pr),
  });
}
