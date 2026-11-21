// actions-cost의 자료 원천: 기간에 만들어진 Actions 실행의 job을 `gh api`로 읽는다. 읽기만 한다.
// 다 읽었는지 알 수 없으면 값을 내지 않고 SourceError로 끝낸다: 적게 읽은 값이 "예산 안"이라는 판단을 만들면 안 된다.
// 실행 기록의 글자열(이름, 라벨)은 그대로 돌려준다. 출력과 보존 기록에서 거르는 일은 actions-cost.ts가 한다.
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import type { JobRecord } from './actions-cost.ts';
import { daysBefore, daysOf, SourceError, type Period } from './source.ts';

export interface ActionsSource {
  /** 기간에 만들어진 실행의 job 전부(모든 시도). 끝까지 읽지 못하면 SourceError */
  jobs(period: Period): JobRecord[];
}

/**
 * head를 찾는 범위: 기간 시작 전 이만큼의 날의 실행 목록도 읽는다(청구에는 넣지 않는다).
 * `workflow_run` 실행은 원본 실행이 끝난 직후에 만들어지므로, 기간 안의 실행을 일으킬 수 있는 원본은
 * 기간 시작 직전이나 그 뒤에 끝난(`updated_at`) 실행뿐이다. 그런 실행이 얼마나 앞서 만들어졌을 수 있는지는
 * GitHub의 한도가 정한다: 다시 실행은 처음 실행한 뒤 30일까지, 실행 하나는 35일까지다(2026-11-21 확인:
 * docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs,
 * docs.github.com/en/actions/reference/limits). 65일에 여유 하루(`MARGIN_DAYS`)를 더한다
 */
export const LOOKBACK_DAYS = 66;
/** 원본 실행이 끝난 때와 그것이 일으킨 실행이 만들어진 때 사이의 여유 */
const MARGIN_DAYS = 1;
/** Actions 실행 목록(`created` 조건)의 조회 상한. 이 수에 닿으면 더 있는지 알 수 없다 */
const RUNS_LIMIT = 1000;
const SHA_RE = /^[0-9a-f]{40}$/;
/** PR의 head 커밋에서 시작하는 실행의 이벤트. 이 실행들의 `head_sha`가 PR head다 */
const PR_EVENTS = new Set(['pull_request', 'pull_request_target', 'pull_request_review']);

// 쪽마다 머리 줄(`{"total":N}`)과 항목 줄이 온다. 줄마다 JSON 하나다
const RUNS_JQ =
  '({total: .total_count} | tojson), (.workflow_runs[] | {id, path, event, branch: .head_branch, headSha: .head_sha, headOwner: (.head_repository.owner.login // null), createdAt: .created_at, updatedAt: .updated_at} | tojson)';
// `filter=all`: 다시 실행한 실행의 앞선 시도까지 받는다. 시도 번호는 job 기록의 것이다
const JOBS_JQ =
  '({total: .total_count} | tojson), (.jobs[] | {id, name, attempt: .run_attempt, conclusion, startedAt: .started_at, completedAt: .completed_at, labels, steps: ((.steps // []) | length)} | tojson)';
const PULLS_JQ =
  '.[] | {number, ref: .head.ref, owner: (.head.repo.owner.login // .head.user.login // null), createdAt: .created_at} | tojson';
const STATUSES_JQ = '.[] | {id, url: .target_url} | tojson';

interface Run {
  id: number;
  workflow: string;
  event: string;
  branch: string;
  /** head 리포의 소유자. 지워진 포크면 null. 브랜치 조회의 `head` 값으로만 쓴다(외부 입력) */
  headOwner: string | null;
  headSha: string;
  createdAt: string;
  updatedAt: string;
}

type Json = Record<string, unknown>;
const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/**
 * `reading`과 같지만 오류 글을 옮기지 않는다. 브랜치 이름이 든 조회에 쓴다:
 * `gh`의 오류 글에 주소가 들어 있을 수 있고, 브랜치 이름은 외부 입력이다
 */
function readingQuietly<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`${what}을(를) 읽지 못했다`);
  }
}

/** `what`을 읽다가 난 예외를 SourceError로 바꾼다 */
function reading<T>(what: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`${what}을(를) 읽지 못했다: ${first(e)}`);
  }
}

function lines(text: string): Json[] {
  const out: Json[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const v: unknown = JSON.parse(line);
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      throw new Error('응답 줄이 객체가 아니다');
    out.push(v as Json);
  }
  return out;
}
function num(o: Json, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new Error(`${k}가 정수가 아니다`);
  return v;
}
function str(o: Json, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new Error(`${k}가 문자열이 아니다`);
  return v;
}
function optStr(o: Json, k: string): string | null {
  return o[k] === null || o[k] === undefined ? null : str(o, k);
}

/**
 * 머리 줄과 항목 줄을 가른다. 아래 가운데 하나면 다 읽은 것이 아니다: 쪽마다 온 `total_count`가 서로 다르다,
 * 받은 수가 `total_count`와 다르다, 같은 id가 두 번 왔다(읽는 동안 목록이 바뀌어 다른 항목이 빠졌을 수 있다)
 */
function counted(what: string, text: string): { total: number; items: Json[] } {
  const totals = new Set<number>();
  const ids = new Set<number>();
  const items: Json[] = [];
  for (const v of lines(text)) {
    if ('total' in v) {
      totals.add(num(v, 'total'));
      continue;
    }
    const id = num(v, 'id');
    if (ids.has(id))
      throw new SourceError(
        `${what}: 같은 기록이 중복으로 왔다. 읽는 동안 목록이 바뀌어 빠진 기록이 있을 수 있다. 다시 실행하라`,
      );
    ids.add(id);
    items.push(v);
  }
  if (totals.size !== 1)
    throw new SourceError(
      `${what}: total_count를 하나로 읽지 못했다(${[...totals].join(', ') || '없음'}). 읽는 동안 목록이 바뀌었을 수 있다. 다시 실행하라`,
    );
  const [total] = totals;
  if (items.length !== total)
    throw new SourceError(
      `${what}: 받은 ${items.length}건이 total_count ${total}건과 다르다. 다시 실행하라`,
    );
  return { total, items };
}

/** 워크플로 파일 경로의 이름 부분(`.github/workflows/check.yml` → `check`) */
const workflowOf = (file: string) =>
  (file.split('/').pop() ?? '').replace(/@.*$/, '').replace(/\.ya?ml$/, '');

export function ghActionsSource(o: {
  cwd: string;
  /** `gh <args>`를 실행해 표준 출력을 돌려준다. 실패하면 예외. 주지 않으면 실제 `gh`를 띄운다 */
  gh?: (args: string[]) => string;
  /** 기본 브랜치. 주지 않으면 설정(`github.defaultBranch`)에서 읽는다 */
  defaultBranch?: string;
  /** 진행 상황 한 줄(표준 오류로 보낼 것) */
  progress?: (line: string) => void;
}): ActionsSource {
  const gh =
    o.gh ??
    ((args: string[]) => {
      if (process.env.HARNESS_FAKE_GH)
        throw new Error('가짜 GitHub(HARNESS_FAKE_GH)에서는 Actions 실행 기록을 읽을 수 없다');
      const r = runSync('gh', args, { cwd: o.cwd, timeoutMs: 120_000 });
      if (r.code !== 0)
        throw new Error(
          `gh ${args.slice(0, 2).join(' ')} 종료 코드 ${r.code}: ${first(r.stderr.trim())}`,
        );
      return r.stdout;
    });
  const api = (pathAndQuery: string, jq: string) =>
    gh(['api', '--paginate', `repos/{owner}/{repo}/${pathAndQuery}`, '--jq', jq]);

  function runsOn(day: string): Run[] {
    const what = `${day}의 Actions 실행 목록`;
    return reading(what, () => {
      const { total, items } = counted(
        what,
        api(`actions/runs?created=${day}&per_page=100`, RUNS_JQ),
      );
      if (total >= RUNS_LIMIT)
        throw new SourceError(`${what}이 조회 상한(${RUNS_LIMIT}건)에 닿아 다 읽었는지 알 수 없다`);
      return items.map((v) => {
        const createdAt = str(v, 'createdAt');
        const t = Date.parse(createdAt);
        if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== day)
          throw new SourceError(`${what}: 다른 날에 만들어진 실행이 왔다`);
        return {
          id: num(v, 'id'),
          workflow: workflowOf(str(v, 'path')),
          event: str(v, 'event'),
          branch: optStr(v, 'branch') ?? '',
          headOwner: optStr(v, 'headOwner'),
          headSha: str(v, 'headSha'),
          createdAt,
          updatedAt: str(v, 'updatedAt'),
        };
      });
    });
  }

  type Job = Pick<
    JobRecord,
    'job' | 'attempt' | 'conclusion' | 'startedAt' | 'completedAt' | 'labels' | 'steps'
  > & { id: number };

  function jobsOf(run: number): Job[] {
    const what = `실행 ${run}의 job 목록`;
    return reading(what, () =>
      counted(what, api(`actions/runs/${run}/jobs?filter=all&per_page=100`, JOBS_JQ)).items.map(
        (v) => {
          // 실행의 최신 시도 번호로 채우지 않는다. 일부 job만 다시 실행하면 job마다 시도가 다르다
          const attempt = v.attempt;
          if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1)
            throw new SourceError(`${what}: run_attempt가 없는 job이 있다`);
          const labels = v.labels;
          if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string'))
            throw new Error('labels가 문자열 배열이 아니다');
          return {
            id: num(v, 'id'),
            job: str(v, 'name'),
            attempt,
            conclusion: optStr(v, 'conclusion'),
            startedAt: optStr(v, 'startedAt'),
            completedAt: optStr(v, 'completedAt'),
            labels: labels as string[],
            steps: num(v, 'steps'),
          };
        },
      ),
    );
  }

  interface PrRef {
    number: number;
    /** PR이 만들어진 때(ms) */
    createdAt: number;
  }
  const byBranch = new Map<string, PrRef[]>();
  /**
   * 그 소유자와 브랜치로 연 PR 전부(닫힌 것 포함). 브랜치와 소유자는 외부 입력이다:
   * 조회의 `head` 값으로만 쓰고 문구에 넣지 않는다. `sha`는 오류 문구에만 쓴다
   */
  function prsOfBranch(sha: string, owner: string, branch: string): PrRef[] {
    const key = `${owner}\n${branch}`;
    let prs = byBranch.get(key);
    if (!prs) {
      const head = `${encodeURIComponent(owner)}:${encodeURIComponent(branch)}`;
      prs = readingQuietly(`커밋 ${sha.slice(0, 7)}의 브랜치로 연 PR`, () => {
        const byNumber = new Map<number, PrRef>();
        for (const v of lines(api(`pulls?state=all&head=${head}&per_page=100`, PULLS_JQ))) {
          // `head` 값의 꼴이 어긋나면 GitHub이 조건을 무시하고 모든 PR을 준다. 받은 것을 다시 거른다
          if (optStr(v, 'ref') !== branch || optStr(v, 'owner') !== owner) continue;
          const createdAt = Date.parse(str(v, 'createdAt'));
          if (Number.isNaN(createdAt)) throw new Error('created_at이 시각이 아니다');
          byNumber.set(num(v, 'number'), { number: num(v, 'number'), createdAt });
        }
        return [...byNumber.values()];
      });
      byBranch.set(key, prs);
    }
    return prs;
  }

  /**
   * 그 실행의 PR. 실행이 만들어질 때 그 브랜치에 있던 PR(실행보다 늦게 만들어지지 않은 PR)이
   * 정확히 하나일 때만 그 PR이다: PR 이벤트 실행은 그 브랜치를 head로 하는 PR에서만 생긴다.
   * 둘 이상이면 고르지 않는다. 커밋 목록(force push로 빠지고 250개에서 잘린다), 지금 head(실행 뒤에 바뀐다),
   * 닫힌 때(다시 열면 지워지고 닫힌 PR에서도 실행이 생긴다)는 어느 PR의 실행인지 확정하지 못한다.
   * 브랜치나 소유자가 없는 실행(지워진 포크)은 찾지 않는다
   */
  function prOfRun(r: Run): number | null {
    if (!r.headOwner || !r.branch || !SHA_RE.test(r.headSha)) return null;
    const at = Date.parse(r.createdAt);
    if (Number.isNaN(at)) throw new SourceError(`실행 ${r.id}의 created_at을 읽지 못했다`);
    const candidates = prsOfBranch(r.headSha, r.headOwner, r.branch).filter(
      (p) => p.createdAt <= at,
    );
    return candidates.length === 1 ? candidates[0].number : null;
  }

  /** 그 커밋의 커밋 상태가 `target_url`로 가리키는 실행 번호들 */
  function statusRuns(sha: string): Set<number> {
    const what = `커밋 ${sha.slice(0, 7)}의 커밋 상태`;
    return reading(what, () => {
      const out = new Set<number>();
      for (const v of lines(api(`commits/${sha}/statuses?per_page=100`, STATUSES_JQ))) {
        const m = /\/actions\/runs\/(\d+)(?:[/?#]|$)/.exec(optStr(v, 'url') ?? '');
        if (m) out.add(Number(m[1]));
      }
      return out;
    });
  }

  return {
    jobs(period) {
      const defaultBranch = o.defaultBranch ?? loadConfig(o.cwd).github.defaultBranch;
      const seenRuns = new Set<number>();
      const readDays = (days: string[]) => {
        const out: Run[] = [];
        for (const day of days)
          for (const r of runsOn(day)) {
            if (seenRuns.has(r.id))
              throw new SourceError(
                `실행 ${r.id}이(가) 두 날의 목록에 왔다. 읽는 동안 목록이 바뀌었을 수 있다. 다시 실행하라`,
              );
            seenRuns.add(r.id);
            out.push(r);
          }
        return out;
      };
      const runs = readDays(daysOf(period));
      // head를 찾는 데만 쓰는 실행. job을 읽지 않고 청구에 넣지 않는다.
      // 만들어진 날짜가 아니라 끝난 때로 고른다: 다시 실행한 실행은 created_at이 처음 그대로다
      const endedFrom = Date.parse(`${daysBefore(period.since, MARGIN_DAYS)}T00:00:00Z`);
      const earlier = readDays(
        daysOf({
          since: daysBefore(period.since, LOOKBACK_DAYS),
          until: daysBefore(period.since, 1),
        }),
      ).filter((r) => {
        const t = Date.parse(r.updatedAt);
        if (Number.isNaN(t)) throw new SourceError(`실행 ${r.id}의 updated_at을 읽지 못했다`);
        return t >= endedFrom;
      });
      o.progress?.(
        `actions-cost: 실행 ${runs.length}건(head 찾기용으로 기간 전에 만들어져 기간 무렵에 끝난 ${earlier.length}건)`,
      );

      // ① PR 이벤트 실행 → PR. 실행 기록의 PR 목록은 PR이 닫히면 비므로 쓰지 않는다.
      // 실행마다 정한다: 커밋이 같아도 브랜치나 만들어진 때가 다르면 다른 PR의 것일 수 있다
      const prRuns = [...earlier, ...runs].filter((r) => PR_EVENTS.has(r.event));
      const prByRun = new Map<number, number>();
      /** 커밋 → 그 커밋을 head로 가진 PR들. head는 PR과 커밋의 쌍이다 */
      const prsByHead = new Map<string, Set<number>>();
      /** PR을 찾지 못한 PR 이벤트 실행이 있는 커밋 */
      const unresolved = new Set<string>();
      prRuns.forEach((r, i) => {
        const pr = prOfRun(r);
        if (pr !== null) {
          prByRun.set(r.id, pr);
          let set = prsByHead.get(r.headSha);
          if (!set) prsByHead.set(r.headSha, (set = new Set()));
          set.add(pr);
        } else unresolved.add(r.headSha);
        if ((i + 1) % 200 === 0)
          o.progress?.(
            `actions-cost: PR 이벤트 실행 ${prRuns.length}건 가운데 ${i + 1}건의 PR을 찾았다`,
          );
      });
      /** `workflow_run` 실행 번호 → 그 실행을 상태로 가리키는 head 커밋들 */
      const headsByRun = new Map<number, Set<string>>();
      const headShas = [...prsByHead.keys()].sort();
      headShas.forEach((sha, i) => {
        // 가릴 수 없는 커밋의 상태도 읽는다: 그 커밋과 다른 커밋이 같은 실행을 가리키면 그 실행은 잇지 않는다
        for (const run of statusRuns(sha)) {
          let set = headsByRun.get(run);
          if (!set) headsByRun.set(run, (set = new Set()));
          set.add(sha);
        }
        if ((i + 1) % 50 === 0)
          o.progress?.(
            `actions-cost: head ${headShas.length}개 가운데 ${i + 1}개의 커밋 상태를 읽었다`,
          );
      });

      // ② 실행 → PR과 head
      const none = { pr: null, head: null, offPr: false };
      const link = (r: Run): { pr: number | null; head: string | null; offPr: boolean } => {
        if (r.event === 'push') return { ...none, offPr: r.branch === defaultBranch };
        if (r.event === 'workflow_run') {
          const pointing = headsByRun.get(r.id);
          // 두 커밋의 상태가 가리키는 실행은 어느 쪽인지 가릴 수 없다
          if (pointing?.size !== 1) return none;
          const [head] = pointing;
          // 커밋 상태는 커밋에 붙어 있다. 그 커밋이 두 PR의 head거나, 그 커밋에 PR을 찾지 못한
          // PR 이벤트 실행이 있으면(그 실행에서 나온 판정일 수 있다) 어느 PR의 실행인지 가릴 수 없다
          if (prsByHead.get(head)!.size !== 1 || unresolved.has(head)) return none;
          const [pr] = prsByHead.get(head)!;
          return { pr, head, offPr: false };
        }
        if (PR_EVENTS.has(r.event)) {
          const pr = prByRun.get(r.id);
          return pr === undefined ? none : { pr, head: r.headSha, offPr: false };
        }
        // 그 밖의 이벤트: 같은 방법으로 찾되, 그 PR과 커밋이 PR 이벤트 실행으로 찾은 head일 때만 잇는다
        const pr = prOfRun(r);
        return pr !== null && prsByHead.get(r.headSha)?.has(pr)
          ? { pr, head: r.headSha, offPr: false }
          : none;
      };

      // ③ 실행마다 모든 시도의 job
      const seenJobs = new Set<number>();
      const out: JobRecord[] = [];
      runs.forEach((r, i) => {
        const at = link(r);
        for (const j of jobsOf(r.id)) {
          if (seenJobs.has(j.id))
            throw new SourceError(
              `job ${j.id}이(가) 두 실행의 목록에 왔다. 읽는 동안 목록이 바뀌었을 수 있다. 다시 실행하라`,
            );
          seenJobs.add(j.id);
          out.push({
            runId: r.id,
            workflow: r.workflow,
            job: j.job,
            attempt: j.attempt,
            event: r.event,
            createdAt: r.createdAt,
            conclusion: j.conclusion,
            startedAt: j.startedAt,
            completedAt: j.completedAt,
            labels: j.labels,
            steps: j.steps,
            pr: at.pr,
            head: at.head,
            offPr: at.offPr,
          });
        }
        if ((i + 1) % 100 === 0)
          o.progress?.(`actions-cost: 실행 ${runs.length}건 가운데 ${i + 1}건의 job을 읽었다`);
      });
      return out;
    },
  };
}
