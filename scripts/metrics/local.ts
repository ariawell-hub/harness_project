// 상시 지표(17.2절) 가운데 리포 파일과 로컬 로그로 재는 것. 파일만 읽는다(네트워크·GitHub을 쓰지 않는다).
// 계획 파일(방법 전환, 발견 사항의 처리), 문서 검사("검토 필요"), runner 로그(실행·세션·판정), 자체 테스트 보고서.
// 로그와 계획의 자유 문자열은 가르는 데만 쓰고 결과에 옮기지 않는다(14.6절): 결과는 수와 계획 id뿐이다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { docLint } from '../gates/doc-lint.ts';
import type { HarnessConfig } from '../lib/config.ts';
import { PLANS_DIR, PLAN_ID_RE, parseDoc, section, stripHtmlComments } from '../lib/plan.ts';
import type { StopReason } from '../runner/run.ts';
import { median } from './pilot.ts';
import { inPeriod, type Period } from './source.ts';

export interface LocalInput {
  root: string;
  cfg: HarnessConfig;
  period: Period;
  /** `<공유 git-dir>/harness/runner.jsonl`. null이거나 파일이 없으면 runner 지표를 내지 않는다 */
  runnerLog: string | null;
  /** `self-test --out <파일>`이 쓴 보고서. null이면 통과율을 내지 않는다 */
  selfTestReport: string | null;
}

/** runner가 멈춘 이유. `exit`의 `reason`이 정해진 값이 아니면 `other`다 */
export type StopName = StopReason | 'other';

/** `StopReason`(scripts/runner/run.ts)의 값 전부. 하나라도 빠지면 아래 형 검사가 실패한다 */
export const STOP_REASONS = [
  'idle',
  'human',
  'time-limit',
  'usage-limit',
  'max-iterations',
  'once',
  'locked',
  'agent-missing',
  'error',
] as const satisfies readonly StopReason[];
const ALL_STOP_REASONS: Exclude<StopReason, (typeof STOP_REASONS)[number]> extends never
  ? true
  : never = true;
void ALL_STOP_REASONS;

export interface RunnerMetrics {
  /** `start`의 시각이 기간 안인 실행의 수 */
  runs: number;
  /** 끝난 실행의 시간(분). 끝난 실행이 없으면 null */
  medianMin: number | null;
  maxMin: number | null;
  /** `exit` 없이 다음 `start`가 오거나 로그가 끝난 실행 */
  noExit: number;
  reasons: Record<StopName, number>;
  /** `plan`과 `step`으로 묶은 묶음마다의 세션 수, `attempt`가 2 이상인 세션의 수 */
  sessions: { median: number | null; max: number | null; retries: number };
  /** `judge-fail`의 세 갈래. AC 실패는 `acFailed` 이상 `acFailed + acUnknown` 이하다 */
  judgeFail: { acFailed: number; acUnknown: number; other: number };
  /** `review-diverged`·`review-reverted` 이벤트 수 */
  diverged: number;
  /** 읽지 못한 줄(JSON 객체가 아니거나 시각·이벤트 이름이 없다) */
  broken: number;
}

export interface LocalMetrics {
  switches: { total: number; byPlan: Array<{ id: string; count: number }> };
  findings: { doc: number; issueTd: number; none: number; unmarked: number };
  /** `docLint`의 `R8 검토 필요` 경고 수. 기간과 무관한 현재 값 */
  reviewNeeded: number;
  runner: RunnerMetrics | null;
  selfTest: { passed: number; total: number } | null;
}

// ── 계획 파일 ──

/** 기간 안의 계획 파일(리포 상대 경로). 단일 파일 계획과 폴더 계획의 `plan.md` */
function plansIn(root: string, p: Period): Array<{ id: string; file: string }> {
  const out: Array<{ id: string; file: string }> = [];
  for (const state of ['active', 'completed']) {
    const dir = path.join(root, PLANS_DIR, state);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const folder = e.isDirectory();
      if (!folder && !e.name.endsWith('.md')) continue;
      const id = folder ? e.name : e.name.slice(0, -'.md'.length);
      if (!PLAN_ID_RE.test(id)) continue;
      const file = folder
        ? path.join(PLANS_DIR, state, id, 'plan.md')
        : path.join(PLANS_DIR, state, e.name);
      if (!existsSync(path.join(root, file))) continue;
      // id의 날짜를 시간대 보정 없이 기간의 날짜와 그대로 견준다
      const day = `${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}`;
      if (day < p.since || day > p.until) continue;
      out.push({ id, file });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 절차서 6절의 형식. 들여 쓴 줄과 주석 안의 줄은 세지 않는다 */
const SWITCH_LINE = /^- 방법 전환\(/;
const MARK = '→ 처리:';
const LINK = /\[[^\]]+\]\([^)]+\)/;
const ISSUE_OR_TD = /#\d+|TD-\d+/;

type Disposition = keyof LocalMetrics['findings'];

/** 발견 사항 한 항목의 처리. `→ 처리:` 뒤만 본다. 여럿이면 문서 반영 → Issue·TD → 해당 없음 순서다 */
function disposition(line: string): Disposition {
  const at = line.indexOf(MARK);
  if (at < 0) return 'unmarked';
  const tail = line.slice(at + MARK.length);
  if (LINK.test(tail)) return 'doc';
  if (ISSUE_OR_TD.test(tail)) return 'issueTd';
  if (tail.includes('해당 없음')) return 'none';
  return 'unmarked';
}

function planMetrics(root: string, p: Period): Pick<LocalMetrics, 'switches' | 'findings'> {
  const byPlan: Array<{ id: string; count: number }> = [];
  const findings = { doc: 0, issueTd: 0, none: 0, unmarked: 0 };
  for (const { id, file } of plansIn(root, p)) {
    const { body } = parseDoc(readFileSync(path.join(root, file), 'utf8'));
    const log = stripHtmlComments(section(body, '의사결정 로그') ?? '');
    const count = log.split('\n').filter((l) => SWITCH_LINE.test(l)).length;
    if (count) byPlan.push({ id, count });
    for (const line of stripHtmlComments(section(body, '발견 사항') ?? '').split('\n')) {
      // 최상위 항목만 본다. "- 없음"은 발견 사항이 아니다(scripts/lib/plan.ts의 unhandledFindings와 같다)
      if (!/^- \S/.test(line) || /^- (없음|none)\s*$/i.test(line)) continue;
      findings[disposition(line)]++;
    }
  }
  return {
    switches: { total: byPlan.reduce((a, x) => a + x.count, 0), byPlan },
    findings,
  };
}

// ── runner 로그 ──

interface LogEvent {
  at: string;
  worker: string;
  event: string;
  data: Record<string, unknown>;
}

function readLog(file: string): { events: LogEvent[]; broken: number } {
  const events: LogEvent[] = [];
  let broken = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      broken++;
      continue;
    }
    const d = v as Record<string, unknown> | null;
    if (
      !d ||
      typeof d !== 'object' ||
      Array.isArray(d) ||
      typeof d.ts !== 'string' ||
      Number.isNaN(Date.parse(d.ts)) ||
      typeof d.event !== 'string'
    ) {
      broken++;
      continue;
    }
    events.push({
      at: d.ts,
      worker: typeof d.worker === 'string' ? d.worker : '',
      event: d.event,
      data: d,
    });
  }
  return { events, broken };
}

/** runner가 `judge-fail`에 쓰는 꼴(scripts/runner/run.ts): `AC <수>개, check 실패: <하위 검사 이름들 | 없음>` */
const JUDGE_DETAIL = /^AC \d+개, check 실패: (.+)$/;
const MIN_MS = 60_000;

function runnerMetrics(file: string, p: Period): RunnerMetrics {
  const { events, broken } = readLog(file);
  const reasons = Object.fromEntries(
    [...STOP_REASONS, 'other' as const].map((k) => [k, 0]),
  ) as Record<StopName, number>;
  const known = new Set<string>(STOP_REASONS);
  /** 작업자별로 아직 끝나지 않은 실행의 시작 시각 */
  const open = new Map<string, string>();
  const minutes: number[] = [];
  let runs = 0;
  let noExit = 0;
  const groups = new Map<string, number>();
  let retries = 0;
  const judgeFail = { acFailed: 0, acUnknown: 0, other: 0 };
  let diverged = 0;

  /** 끝을 보지 못한 실행 하나를 닫는다 */
  const abandon = (startedAt: string) => {
    if (!inPeriod(startedAt, p)) return;
    runs++;
    noExit++;
  };

  for (const e of events) {
    if (e.event === 'start') {
      const prev = open.get(e.worker);
      if (prev !== undefined) abandon(prev);
      open.set(e.worker, e.at);
      continue;
    }
    if (e.event === 'exit') {
      const startedAt = open.get(e.worker);
      // start 없는 exit는 어느 실행의 것인지 알 수 없다
      if (startedAt === undefined) continue;
      open.delete(e.worker);
      if (!inPeriod(startedAt, p)) continue;
      runs++;
      minutes.push(Math.max(0, Date.parse(e.at) - Date.parse(startedAt)) / MIN_MS);
      const reason = e.data.reason;
      reasons[typeof reason === 'string' && known.has(reason) ? (reason as StopReason) : 'other']++;
      continue;
    }
    if (!inPeriod(e.at, p)) continue;
    if (e.event === 'session-start') {
      const { plan, step, attempt } = e.data;
      const key = `${typeof plan === 'string' ? plan : ''}\0${typeof step === 'number' ? step : ''}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
      if (typeof attempt === 'number' && attempt >= 2) retries++;
    } else if (e.event === 'judge-fail') {
      const m = typeof e.data.detail === 'string' ? JUDGE_DETAIL.exec(e.data.detail) : null;
      if (!m) judgeFail.other++;
      else if (m[1] === '없음') judgeFail.acFailed++;
      else judgeFail.acUnknown++;
    } else if (e.event === 'review-diverged' || e.event === 'review-reverted') {
      diverged++;
    }
  }
  for (const startedAt of open.values()) abandon(startedAt);

  const sizes = [...groups.values()];
  return {
    runs,
    medianMin: median(minutes),
    maxMin: minutes.length ? Math.max(...minutes) : null,
    noExit,
    reasons,
    sessions: {
      median: median(sizes),
      max: sizes.length ? Math.max(...sizes) : null,
      retries,
    },
    judgeFail,
    diverged,
    broken,
  };
}

// ── 자체 테스트 보고서 ──

const STATES = new Set(['pass', 'fail', 'error']);

/** `--self-test-report`로 받은 파일이 없거나 `self-test --out`의 보고서가 아니다. 명령은 종료 코드 1로 끝낸다 */
export class SelfTestReportError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `self-test --out <파일>`이 쓴 보고서(`SelfTestReport`, scripts/selftest/run.ts)의 통과 수와 전체 수.
 * 파일을 한 번 읽는다. 없거나 형식이 다르면(`self-test --live`의 보고서 포함) `SelfTestReportError`다.
 * 형식: `version`이 1, `headSha`가 문자열, `results`의 항목마다 `id`(비지 않은 문자열, 겹치지 않는다)·
 * `covers`·`detail`(문자열)·`state`(`pass`·`fail`·`error`)
 */
export function readSelfTestReport(file: string): { passed: number; total: number } {
  const bad = (why: string) =>
    new SelfTestReportError(`\`self-test --out\`의 보고서 형식이 아니다(${why})`);
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new SelfTestReportError(
      code === 'ENOENT' ? '파일이 없다' : '읽을 수 없거나 JSON이 아니다',
    );
  }
  if (!isObject(v)) throw bad('객체가 아니다');
  if (v.live === true) throw bad('`self-test --live`의 보고서다');
  if (v.version !== 1) throw bad('version이 1이 아니다');
  if (typeof v.headSha !== 'string') throw bad('headSha가 문자열이 아니다');
  if (!Array.isArray(v.results)) throw bad('results 배열이 없다');
  const ids = new Set<string>();
  let passed = 0;
  for (const r of v.results as unknown[]) {
    if (!isObject(r)) throw bad('시나리오가 객체가 아니다');
    if (typeof r.id !== 'string' || !r.id) throw bad('시나리오의 id가 없다');
    if (ids.has(r.id)) throw bad('같은 id의 시나리오가 두 번 있다');
    ids.add(r.id);
    if (typeof r.covers !== 'string' || typeof r.detail !== 'string')
      throw bad('시나리오의 covers·detail이 문자열이 아니다');
    if (typeof r.state !== 'string' || !STATES.has(r.state))
      throw bad('시나리오의 state가 pass·fail·error가 아니다');
    if (r.state === 'pass') passed++;
  }
  return { passed, total: v.results.length };
}

/**
 * 보고서를 가장 먼저 읽는다: 틀린 보고서는 다른 자료를 읽기 전에 `SelfTestReportError`로 끝난다.
 * 문서 목록이나 커밋 시각을 읽지 못하면 "검토 필요" 문서 수를 0으로 내지 않고 예외다(`docLint`의 엄격 모드)
 */
export function localMetrics(i: LocalInput): LocalMetrics {
  const selfTest = i.selfTestReport === null ? null : readSelfTestReport(i.selfTestReport);
  return {
    ...planMetrics(i.root, i.period),
    reviewNeeded: docLint(i.root, i.cfg, { strict: true }).warnings.filter(
      (w) => w.rule === 'R8 검토 필요',
    ).length,
    runner:
      i.runnerLog !== null && existsSync(i.runnerLog) ? runnerMetrics(i.runnerLog, i.period) : null,
    selfTest,
  };
}
