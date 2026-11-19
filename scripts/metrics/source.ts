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
}

export interface BugIssue {
  number: number;
  createdAt: string;
}

export interface MetricsSource {
  mergedPrs(p: Period): MergedPr[];
  workflowRuns(p: Period): WorkflowRun[];
  bugIssues(p: Period): BugIssue[];
  /** PR의 지적 원장. 없으면 null */
  ledger(pr: number): Ledger | null;
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

/** 실행 목록의 한 페이지를 머리 줄(`{"total":N}`)과 실행 줄들로 바꾼다. 줄마다 JSON 하나다 */
const RUNS_JQ =
  '({total: .total_count} | tojson), (.workflow_runs[] | {id, path, event, branch: .head_branch, headSha: .head_sha, status, conclusion, createdAt: .created_at, startedAt: .run_started_at, updatedAt: .updated_at, attempt: .run_attempt} | tojson)';

const PR_FIELDS =
  'number,headRefName,headRefOid,createdAt,mergedAt,mergeCommit,additions,deletions';

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

  return {
    mergedPrs(p) {
      const what = '병합된 PR 목록';
      return reading(what, () => {
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
          }))
          .filter((x) => inPeriod(x.mergedAt, p));
      });
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
        return raw
          .map((x) => ({ number: num(x, 'number'), createdAt: time(x, 'createdAt') }))
          .filter((x) => inPeriod(x.createdAt, p));
      });
    },
    ledger(pr) {
      return reading(`PR #${pr}의 지적 원장`, () => o.ledger(pr));
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
