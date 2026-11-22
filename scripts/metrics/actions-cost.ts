// actions-cost의 계산·렌더·보존 기록(계획 20261121-actions-cost-design). 입출력이 없는 순수 함수다.
// Actions 실행 기록의 job에서 "비공개 리포였다면 청구됐을 값"을 낸다: job마다 초를 분으로 올림하고 러너 단가를 곱한다.
// 출력과 보존 기록에는 수, 날짜, PR 번호, 허용 목록에 있는 워크플로·job 이름만 적는다(설계서 14.6절).
// 실행 기록의 이름·라벨은 외부(포크의 PR)가 정할 수 있어, 체크아웃의 워크플로 파일에 없는 것은 `(기타)`로 합친다.
import { daysOf, parsePeriod, SourceError, type Period } from './source.ts';

export interface JobRecord {
  runId: number;
  /** 워크플로 파일 경로의 이름 부분(`.github/workflows/check.yml` → `check`) */
  workflow: string;
  job: string;
  /** 이 job이 돈 시도. job 기록의 `run_attempt`다(실행 기록의 최신 시도 번호가 아니다). 다시 실행하면 2부터 */
  attempt: number;
  event: string;
  /** 실행이 만들어진 시각(ISO). 날짜별 합계의 기준 */
  createdAt: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  labels: string[];
  /** job이 실제로 돈 단계의 수. 0이면 시작하지 못한 job이다 */
  steps: number;
  /** 이 실행이 속한 PR. PR의 실행이 아니거나(main의 `push` 등) 찾지 못했으면 null */
  pr: number | null;
  /** 이 실행이 검증한 PR head 커밋의 SHA. `pr`이 null이면 null이다. head를 세는 데만 쓰고 출력하지 않는다 */
  head: string | null;
  /** PR의 실행이 아닌 것이 분명한가(기본 브랜치의 `push` 실행). `pr`이 null인 실행을 "PR 밖"과 "PR을 찾지 못함"으로 가른다 */
  offPr: boolean;
}

/** 출력에 적어도 되는 이름: 워크플로 이름 → 그 워크플로의 job 이름들 */
export type KnownNames = Map<string, Set<string>>;

/** 허용 목록에 없거나 글자 조건에 어긋난 이름·라벨을 합치는 자리 */
export const OTHER = '(기타)';
/** 허용 목록에 있어도 한 번 더 거는 글자 조건: 마크다운 문법·줄바꿈·긴 글이 표에 들어가지 않게 한다 */
const NAME_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 러너의 분당 단가(천분의 1달러). 확인한 것만 넣는다. 모르는 러너는 금액을 내지 않고 분만 보인다.
 * - Linux 2코어 x64(`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04`. 청구 항목 `actions_linux`): 분당 $0.006.
 * - Linux 2코어 arm64(`ubuntu-24.04-arm`): 분당 $0.005.
 * - Linux 1코어 x64(`ubuntu-slim`): 분당 $0.002.
 * 단가의 출처: https://docs.github.com/en/billing/reference/actions-runner-pricing
 * 라벨의 출처: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
 * 둘 다 2026-11-22에 확인했다(ADR-0008의 "확인한 외부 사실"). 단가의 출처가 job마다 분 단위로 올림한다고 적는다.
 * 단가를 더하거나 바꿀 때는 출처와 확인한 날짜를 여기 적는다. 쓰기로 한 러너만 넣는다(`ubuntu-22.04-arm`은 없다).
 * 보존 기록은 이 표의 라벨만 그대로 남긴다(`keptLabel`). 표에 없는 라벨의 분은 나중에 단가를 더해도 다시 계산할 수 없다.
 */
const RATE_MILLI: ReadonlyMap<string, number> = new Map([
  ['ubuntu-latest', 6],
  ['ubuntu-24.04', 6],
  ['ubuntu-22.04', 6],
  ['ubuntu-24.04-arm', 5],
  ['ubuntu-slim', 2],
]);
const SELF_HOSTED = 'self-hosted';

const COLUMNS = [
  'run',
  'attempt',
  'workflow',
  'job',
  'day',
  'seconds',
  'labels',
  'pr',
  'head',
  'offPr',
] as const;

/**
 * 워크플로 파일들의 글에서 허용 목록을 만든다. 워크플로 이름은 파일 이름(확장자 제외),
 * job 이름은 `jobs:` 아래의 키와 그 `name:` 값이다. YAML 파서를 쓰지 않고 줄 단위로 읽는다:
 * 읽지 못한 이름은 `(기타)`가 될 뿐이다
 */
export function knownNamesFrom(files: { name: string; text: string }[]): KnownNames {
  const known: KnownNames = new Map();
  for (const f of files) {
    const jobs = new Set<string>();
    let inJobs = false;
    for (const line of f.text.split(/\r?\n/)) {
      if (/^\S/.test(line)) {
        inJobs = /^jobs:\s*(#.*)?$/.test(line);
        continue;
      }
      if (!inJobs) continue;
      const key = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
      if (key) {
        jobs.add(key[1]);
        continue;
      }
      const name = /^ {4}name:\s*(.+?)\s*$/.exec(line);
      if (name) jobs.add(name[1].replace(/^(['"])(.*)\1$/, '$2'));
    }
    known.set(f.name.replace(/\.ya?ml$/, ''), jobs);
  }
  return known;
}

/** 돈 시간(정수 초, 소수는 올림, 음수는 0). 돌지 않은 job은 null */
function ranSeconds(j: JobRecord): number | null {
  if (j.conclusion === 'skipped' || j.steps === 0 || !j.startedAt || !j.completedAt) return null;
  const start = Date.parse(j.startedAt);
  const end = Date.parse(j.completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - start) / 1000));
}

const minutesOf = (seconds: number | null) =>
  seconds === null ? 0 : Math.max(1, Math.ceil(seconds / 60));

/** 청구 단위(분). 돌지 않은 job은 0, 돈 job은 초를 분으로 올림하고 최소 1 */
export function billedMinutes(j: JobRecord): number {
  return minutesOf(ranSeconds(j));
}

/** 러너의 분당 단가(달러). 라벨이 확인한 라벨 하나뿐일 때만 `priced`다 */
export function runnerRate(labels: string[]): {
  kind: 'priced' | 'unknown' | 'self-hosted';
  usdPerMinute: number;
} {
  if (labels.includes(SELF_HOSTED)) return { kind: 'self-hosted', usdPerMinute: 0 };
  const milli = labels.length === 1 ? RATE_MILLI.get(labels[0]) : undefined;
  return milli === undefined
    ? { kind: 'unknown', usdPerMinute: 0 }
    : { kind: 'priced', usdPerMinute: milli / 1000 };
}

const rateMilli = (labels: string[]) =>
  labels.length === 1 && !labels.includes(SELF_HOSTED) ? RATE_MILLI.get(labels[0]) : undefined;

/** 러너별 표의 이름: 단가를 아는 러너는 그 라벨, self-hosted가 든 것은 'self-hosted', 그 밖은 '(기타)' */
const runnerName = (labels: string[]) =>
  labels.includes(SELF_HOSTED) ? SELF_HOSTED : rateMilli(labels) === undefined ? OTHER : labels[0];

// ---- 보존 기록 ----

/** 보존 기록의 job 하나. 계산에 드는 값만 담는다. 글자열은 날짜, 허용 목록에 있는 이름, 정해 둔 낱말뿐이다 */
export interface SavedJob {
  run: number;
  attempt: number;
  /** 허용 목록에 있고 글자 조건에 맞는 이름. 아니면 '(기타)' */
  workflow: string;
  job: string;
  /** 실행이 만들어진 날짜(UTC, YYYY-MM-DD) */
  day: string;
  /** 돈 시간(초, 0 이상의 정수). 돌지 않은 job은 null */
  seconds: number | null;
  /** 단가표에 있는 라벨과 'self-hosted'만 그대로 둔다. 그 밖의 라벨은 '(기타)' */
  labels: string[];
  pr: number | null;
  /** PR head(PR과 커밋의 쌍)를 가르는 순번(1부터). SHA가 아니다. `pr`이 null이면 null */
  head: number | null;
  offPr: boolean;
}

function shownNames(workflow: string, job: string, known: KnownNames): [string, string] {
  const jobs = known.get(workflow);
  if (!jobs || !NAME_RE.test(workflow)) return [OTHER, OTHER];
  return [workflow, jobs.has(job) && NAME_RE.test(job) ? job : OTHER];
}

const keptLabel = (l: string) => (RATE_MILLI.has(l) || l === SELF_HOSTED ? l : OTHER);

/** 실행이 만들어진 날짜(UTC). 읽히지 않는 시각은 빈 글이다(어느 날에도 들지 않는다) */
function dayOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/** job마다 계산에 드는 값만 옮긴다. 이름과 라벨을 거르고 head SHA를 순번으로 바꾼다 */
export function toSaved(jobs: JobRecord[], known: KnownNames): SavedJob[] {
  // head는 PR과 커밋의 쌍이다: 같은 커밋을 두 PR이 함께 가지면 PR마다 따로 센다.
  // PR 번호, SHA 순의 순번이라 fromSaved가 되돌린 입력에서도 같은 순번이 나온다
  const pairKey = (pr: number, head: string) => `${pr}\n${head}`;
  const pairs = new Map<string, { pr: number; head: string }>();
  for (const j of jobs)
    if (j.pr !== null && j.head) pairs.set(pairKey(j.pr, j.head), { pr: j.pr, head: j.head });
  const order = new Map(
    [...pairs.entries()]
      .sort(([, a], [, b]) => a.pr - b.pr || (a.head < b.head ? -1 : a.head > b.head ? 1 : 0))
      .map(([key], i) => [key, i + 1]),
  );
  return jobs.map((j) => {
    const [workflow, job] = shownNames(j.workflow, j.job, known);
    return {
      run: j.runId,
      attempt: j.attempt,
      workflow,
      job,
      day: dayOf(j.createdAt),
      seconds: ranSeconds(j),
      labels: j.labels.map(keptLabel),
      pr: j.pr,
      head: j.pr !== null && j.head ? (order.get(pairKey(j.pr, j.head)) ?? null) : null,
      offPr: j.pr === null && j.offPr,
    };
  });
}

/** 보존 기록을 계산의 입력으로 되돌린다. 없는 값은 계산 결과가 같아지게 채운다 */
export function fromSaved(saved: SavedJob[]): JobRecord[] {
  return saved.map((s) => {
    const start = `${s.day}T00:00:00.000Z`;
    const ran = s.seconds !== null;
    return {
      runId: s.run,
      workflow: s.workflow,
      job: s.job,
      attempt: s.attempt,
      event: '',
      createdAt: start,
      conclusion: ran ? 'success' : 'skipped',
      startedAt: ran ? start : null,
      completedAt: ran ? new Date(Date.parse(start) + (s.seconds ?? 0) * 1000).toISOString() : null,
      labels: [...s.labels],
      steps: ran ? 1 : 0,
      pr: s.pr,
      // 순번의 순서가 글자열 순서와 같게 자릿수를 맞춘다(toSaved가 다시 같은 순번을 준다)
      head: s.head === null ? null : `h${String(s.head).padStart(12, '0')}`,
      offPr: s.offPr,
    };
  });
}

const rowOf = (s: SavedJob): unknown[] => [
  s.run,
  s.attempt,
  s.workflow,
  s.job,
  s.day,
  s.seconds,
  s.labels,
  s.pr,
  s.head,
  s.offPr,
];

/** 보존 기록 파일의 글(`.jsonl`). 첫 줄은 머리, 이어서 job마다 한 줄. 입력의 순서가 달라도 같은 기록이면 같은 글이다 */
export function formatSaved(saved: SavedJob[], period: Period): string {
  const rows = saved
    .map((s) => ({ s, text: JSON.stringify(rowOf(s)) }))
    .sort(
      (a, b) =>
        a.s.run - b.s.run ||
        a.s.attempt - b.s.attempt ||
        (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
    );
  const head = JSON.stringify({
    version: 1,
    since: period.since,
    until: period.until,
    count: rows.length,
    columns: COLUMNS,
  });
  return [head, ...rows.map((r) => r.text)].join('\n') + '\n';
}

const isCount = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const isName = (v: unknown): v is string =>
  v === OTHER || (typeof v === 'string' && NAME_RE.test(v));

function savedRow(cells: unknown, days: Set<string>): SavedJob | string {
  if (!Array.isArray(cells) || cells.length !== COLUMNS.length) return '칸의 수가 다르다';
  const [run, attempt, workflow, job, day, seconds, labels, pr, head, offPr] = cells as unknown[];
  if (!isCount(run, 1)) return 'run이 1 이상의 정수가 아니다';
  if (!isCount(attempt, 1)) return 'attempt가 1 이상의 정수가 아니다';
  if (!isName(workflow) || !isName(job)) return '이름이 글자 조건에 어긋난다';
  if (typeof day !== 'string' || !DAY_RE.test(day) || !days.has(day))
    return 'day가 기간 안의 날짜가 아니다';
  if (seconds !== null && !isCount(seconds, 0)) return 'seconds가 0 이상의 정수나 null이 아니다';
  if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string' && keptLabel(l) === l))
    return 'labels에 정해 둔 것 밖의 라벨이 있다';
  if (pr !== null && !isCount(pr, 1)) return 'pr이 1 이상의 정수나 null이 아니다';
  if (head !== null && !isCount(head, 1)) return 'head가 1 이상의 정수나 null이 아니다';
  if (pr === null && head !== null) return 'pr이 없는데 head가 있다';
  if (typeof offPr !== 'boolean') return 'offPr이 참·거짓이 아니다';
  if (pr !== null && offPr) return 'pr이 있는데 offPr이 참이다';
  return { run, attempt, workflow, job, day, seconds, labels: labels as string[], pr, head, offPr };
}

/** 보존 기록 파일의 글을 읽는다. 형식에 어긋나면 SourceError(일부만 읽은 값을 돌려주지 않는다) */
export function parseSaved(text: string): { period: Period; jobs: SavedJob[] } {
  const fail = (why: string): never => {
    throw new SourceError(`보존 기록이 형식에 어긋난다: ${why}`);
  };
  const json = (line: string, where: string): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      return fail(`${where}이 JSON이 아니다`);
    }
  };
  if (!text.endsWith('\n')) fail('마지막 줄이 줄바꿈으로 끝나지 않는다');
  const lines = text.slice(0, -1).split('\n');
  const head = json(lines[0], '머리 줄');
  if (typeof head !== 'object' || head === null || Array.isArray(head))
    return fail('머리 줄이 객체가 아니다');
  const h = head as Record<string, unknown>;
  if (Object.keys(h).join(',') !== 'version,since,until,count,columns')
    fail('머리 줄의 항목이 다르다');
  if (h.version !== 1) fail('version이 1이 아니다');
  if (JSON.stringify(h.columns) !== JSON.stringify(COLUMNS)) fail('columns가 다르다');
  if (typeof h.since !== 'string' || typeof h.until !== 'string')
    return fail('since·until이 글자열이 아니다');
  let period: Period;
  try {
    period = parsePeriod(h.since, h.until, new Date(0));
  } catch {
    return fail('since·until이 기간이 아니다');
  }
  if (!isCount(h.count, 0)) fail('count가 0 이상의 정수가 아니다');
  if (lines.length - 1 !== h.count)
    fail(`줄 수(${lines.length - 1})가 count(${String(h.count)})와 다르다`);
  const days = new Set(daysOf(period));
  const jobs = lines.slice(1).map((line, i) => {
    const row = savedRow(json(line, `${i + 2}째 줄`), days);
    return typeof row === 'string' ? fail(`${i + 2}째 줄: ${row}`) : row;
  });
  return { period, jobs };
}

// ---- 계산 ----

export interface CostRow {
  name: string;
  /** 돈 job의 수(러너와 무관) */
  jobs: number;
  /** 청구 분(단가를 아는 러너의 것) */
  minutes: number;
  usd: number;
}

export interface CostReport {
  days: number;
  /** 서로 다른 실행의 수 */
  runs: number;
  ranJobs: number;
  /** 돌지 않은 job(건너뜀, 시작하지 못함) */
  idleJobs: number;
  /** 청구 분 합계. 단가를 아는 러너의 것만 센다 */
  minutes: number;
  usd: number;
  /** 전체 금액의 밀리달러 정수. 예산과 견줄 때는 나눈 값이 아니라 이 정수를 쓴다(1밀리달러에 못 미치는 초과를 잃지 않는다) */
  usdMilli: number;
  /** 청구 분에 든 job이 실제로 돈 초 */
  actualSeconds: number;
  /** 올림으로 붙은 분: 청구 분 − 실제 초 ÷ 60 */
  roundingMinutes: number;
  /** 1분이 안 되게 돈 job의 수와 그 청구 분 */
  subMinuteJobs: number;
  subMinuteMinutes: number;
  /** 다시 실행한 시도(시도 번호 2부터)의 청구 분 */
  rerunMinutes: number;
  /** 러너별. 이름은 단가표의 라벨, 'self-hosted', '(기타)'(단가를 모르는 러너) 가운데 하나다. '(기타)'와 'self-hosted'의 청구 분과 금액은 0이다 */
  byRunner: CostRow[];
  byWorkflow: CostRow[];
  byJob: CostRow[];
  byDay: CostRow[];
  byPr: CostRow[];
  /** PR 밖 실행(기본 브랜치의 push) */
  offPr: CostRow;
  /** PR을 찾지 못한 실행 */
  unlinked: CostRow;
  /** 실행이 이어진 서로 다른 PR의 수 */
  prs: number;
  /** PR 하나당 청구 분, PR에 이어진 실행만(분자와 분모가 같은 실행 집합). PR이 없으면 null */
  perPrLinked: number | null;
  /** PR 하나당 청구 분, PR 밖 포함(전체 청구 분 ÷ PR 수). 예산과 견주는 값. PR이 없으면 null */
  perPrAll: number | null;
  /** PR 하나당 금액, PR 밖 포함(전체 금액 ÷ PR 수). 예산과의 비교는 이 값으로 한다. PR이 없으면 null */
  perPrUsd: number | null;
  heads: number;
  /** head가 있는 job의 청구 분 */
  headMinutes: number;
  /** PR head 하나당 청구 분(push 한 번의 추정값). head가 없으면 null */
  perHead: number | null;
  monthlyMinutes: number;
  monthlyUsd: number;
  /** 단가를 모르는 러너와 self-hosted 러너에서 돈 분. 금액에 들지 않는다 */
  unknownMinutes: number;
  selfHostedMinutes: number;
}

interface Acc {
  jobs: number;
  minutes: number;
  milli: number;
}
const acc = (): Acc => ({ jobs: 0, minutes: 0, milli: 0 });
const row = (name: string, a: Acc): CostRow => ({
  name,
  jobs: a.jobs,
  minutes: a.minutes,
  usd: a.milli / 1000,
});

/** 청구 분 내림차순, 같으면 `key` 오름차순 */
function rows<K extends string | number>(m: Map<K, Acc>, name: (k: K) => string): CostRow[] {
  return [...m.entries()]
    .sort(([ka, a], [kb, b]) => b.minutes - a.minutes || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([k, a]) => row(name(k), a));
}

export function actionsCost(jobs: JobRecord[], period: Period, known: KnownNames): CostReport {
  // 계산은 보존 기록의 꼴로 한다. 그래서 GitHub에서 읽은 입력과 보존 기록으로 되돌린 입력의 결과가 같다
  const saved = toSaved(jobs, known);
  const days = daysOf(period);
  const total = acc();
  const byRunner = new Map<string, Acc>();
  const byWorkflow = new Map<string, Acc>();
  const byJob = new Map<string, Acc>();
  const byDay = new Map<string, Acc>(days.map((d) => [d, acc()]));
  const byPr = new Map<number, Acc>();
  const offPr = acc();
  const unlinked = acc();
  const runs = new Set<number>();
  const heads = new Set<number>();
  let idleJobs = 0;
  let actualSeconds = 0;
  let subMinuteJobs = 0;
  let subMinuteMinutes = 0;
  let rerunMinutes = 0;
  let linkedMinutes = 0;
  let headMinutes = 0;
  let unknownMinutes = 0;
  let selfHostedMinutes = 0;

  for (const s of saved) {
    runs.add(s.run);
    // PR과 head의 수는 돌았는지와 무관하게 센다: 돌지 않은 job만 있는 PR도 PR 하나다
    if (s.pr !== null) {
      if (!byPr.has(s.pr)) byPr.set(s.pr, acc());
      if (s.head !== null) heads.add(s.head);
    }
    if (s.seconds === null) {
      idleJobs++;
      continue;
    }
    const all = minutesOf(s.seconds);
    const milliPerMinute = rateMilli(s.labels);
    // 금액과 청구 분에는 단가를 아는 러너의 것만 든다
    const minutes = milliPerMinute === undefined ? 0 : all;
    const milli = minutes * (milliPerMinute ?? 0);
    if (milliPerMinute === undefined) {
      if (s.labels.includes(SELF_HOSTED)) selfHostedMinutes += all;
      else unknownMinutes += all;
    } else {
      actualSeconds += s.seconds;
      if (s.seconds < 60) {
        subMinuteJobs++;
        subMinuteMinutes += minutes;
      }
      if (s.attempt > 1) rerunMinutes += minutes;
    }
    const add = (a: Acc) => {
      a.jobs++;
      a.minutes += minutes;
      a.milli += milli;
    };
    const at = <K>(m: Map<K, Acc>, k: K) => {
      let a = m.get(k);
      if (!a) m.set(k, (a = acc()));
      add(a);
    };
    add(total);
    at(byRunner, runnerName(s.labels));
    at(byWorkflow, s.workflow);
    at(byJob, s.workflow === OTHER ? OTHER : `${s.workflow} / ${s.job}`);
    at(byDay, s.day);
    if (s.pr !== null) {
      at(byPr, s.pr);
      linkedMinutes += minutes;
      if (s.head !== null) headMinutes += minutes;
    } else add(s.offPr ? offPr : unlinked);
  }

  const per = (minutes: number, n: number) => (n ? minutes / n : null);
  return {
    days: days.length,
    runs: runs.size,
    ranJobs: total.jobs,
    idleJobs,
    minutes: total.minutes,
    usd: total.milli / 1000,
    usdMilli: total.milli,
    actualSeconds,
    roundingMinutes: total.minutes - actualSeconds / 60,
    subMinuteJobs,
    subMinuteMinutes,
    rerunMinutes,
    byRunner: rows(byRunner, (k) => k),
    byWorkflow: rows(byWorkflow, (k) => k),
    byJob: rows(byJob, (k) => k),
    byDay: rows(byDay, (k) => k),
    byPr: rows(byPr, (k) => `#${k}`),
    offPr: row('PR 밖(main 등)', offPr),
    unlinked: row('PR을 찾지 못함', unlinked),
    prs: byPr.size,
    perPrLinked: per(linkedMinutes, byPr.size),
    perPrAll: per(total.minutes, byPr.size),
    perPrUsd: byPr.size ? total.milli / byPr.size / 1000 : null,
    heads: heads.size,
    headMinutes,
    perHead: per(headMinutes, heads.size),
    monthlyMinutes: (total.minutes / days.length) * 30,
    monthlyUsd: ((total.milli / days.length) * 30) / 1000,
    unknownMinutes,
    selfHostedMinutes,
  };
}

// ---- 렌더 ----

const NONE = '해당 없음';
const one = (v: number | null) => (v === null ? NONE : v.toFixed(1));
const usd = (v: number) => `$${v.toFixed(2)}`;
const usd3 = (v: number | null) => (v === null ? NONE : `$${v.toFixed(3)}`);

/** 판단 절차 문서의 "기록" 표에 옮기는 칸 여섯: 기간, 청구 분, PR 하나당 청구 분(PR 밖 포함), PR 하나당 금액(PR 밖 포함), PR head 하나당 청구 분, 30일 환산 금액 */
export function recordCells(report: CostReport, period: Period): string[] {
  return [
    `${period.since}~${period.until}`,
    String(report.minutes),
    one(report.perPrAll),
    usd3(report.perPrUsd),
    one(report.perHead),
    usd(report.monthlyUsd),
  ];
}

/** 표시 폭: 한글·한자·전각 글자는 두 칸이다(prettier가 표를 맞추는 기준과 같다) */
function width(s: string): number {
  let n = 0;
  for (const ch of s) n += /[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/.test(ch) ? 2 : 1;
  return n;
}

/** prettier가 다시 맞추지 않는 모양의 마크다운 표 */
function table(head: string[], body: string[][]): string {
  const w = head.map((h, i) => Math.max(3, width(h), ...body.map((r) => width(r[i]))));
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c + ' '.repeat(w[i] - width(c))).join(' | ')} |`;
  return [line(head), `| ${w.map((n) => '-'.repeat(n)).join(' | ')} |`, ...body.map(line)].join(
    '\n',
  );
}

export function renderCost(report: CostReport, period: Period): string {
  const r = report;
  const share = (minutes: number) =>
    r.minutes ? `${((minutes / r.minutes) * 100).toFixed(1)}%` : NONE;
  const costRows = (list: CostRow[]) =>
    list.map((x) => [x.name, String(x.jobs), String(x.minutes), usd(x.usd), share(x.minutes)]);
  const cols = (first: string) => [first, '돈 job', '청구 분', '금액', '비율'];
  const summary: string[][] = [
    ['기간', `${period.since} ~ ${period.until} (${r.days}일)`],
    ['실행', String(r.runs)],
    ['돈 job', String(r.ranJobs)],
    ['돌지 않은 job', String(r.idleJobs)],
    ['청구 분', String(r.minutes)],
    ['금액', usd(r.usd)],
    ['실제로 돈 분', (r.actualSeconds / 60).toFixed(1)],
    ['올림으로 붙은 분', `${r.roundingMinutes.toFixed(1)} (${share(r.roundingMinutes)})`],
    ['1분 미만 job', `${r.subMinuteJobs}개, 청구 ${r.subMinuteMinutes}분`],
    ['다시 실행한 시도의 청구 분', String(r.rerunMinutes)],
    ['PR', `${r.prs}개`],
    ['PR 하나당 청구 분(PR에 이어진 실행만)', one(r.perPrLinked)],
    ['PR 하나당 청구 분(PR 밖 포함)', one(r.perPrAll)],
    ['PR 하나당 금액(PR 밖 포함)', usd3(r.perPrUsd)],
    ['PR head', `${r.heads}개`],
    ['PR head 하나당 청구 분', one(r.perHead)],
    ['30일 환산 청구 분', String(Math.round(r.monthlyMinutes))],
    ['30일 환산 금액', usd(r.monthlyUsd)],
    ['단가를 모르는 러너의 분', String(r.unknownMinutes)],
    ['self-hosted 러너의 분', String(r.selfHostedMinutes)],
  ];
  const parts = [
    '**Actions 비용: 비공개 리포였다면 청구됐을 값**',
    [
      '- 청구 분은 job마다 돈 초를 분으로 올림한 값이다(최소 1분). 다시 실행한 시도는 따로 센다. 돌지 않은 job은 0분이다.',
      '- 금액은 job마다 러너 단가를 곱해 더한 값이다(2코어 Linux x64 분당 $0.006, 2코어 Linux arm64 분당 $0.005, 1코어 Linux 분당 $0.002). 단가를 모르는 러너와 self-hosted 러너의 분은 청구 분과 금액에 넣지 않고 따로 적는다.',
      '- "PR 하나당 청구 분(PR 밖 포함)"과 "PR 하나당 금액(PR 밖 포함)"은 전체 청구 분과 전체 금액을 PR 수로 나눈 값이다. 분자에 PR 밖 실행(main 등)과 PR을 찾지 못한 실행이 들어 있다. 예산과는 금액으로 견준다.',
      '- "PR head 하나당 청구 분"은 push를 직접 세지 않고 PR head로 센 추정값이다. head가 있는 실행만 센다.',
      '- 공개 리포에서는 실제 청구가 아니다. 검증자의 구독 사용량은 들어 있지 않다.',
    ].join('\n'),
    '**요약**',
    table(['항목', '값'], summary),
    '**기록 칸** ("기록" 표에 옮기는 행)',
    table(
      [
        '기간',
        '청구 분',
        'PR 하나당 청구 분',
        'PR 하나당 금액',
        'PR head 하나당 청구 분',
        '30일 환산 금액',
      ],
      [recordCells(r, period)],
    ),
    '**러너별**',
    table(cols('러너'), costRows(r.byRunner)),
    '**워크플로별**',
    table(cols('워크플로'), costRows(r.byWorkflow)),
    '**job별**',
    table(cols('job'), costRows(r.byJob)),
    '**날짜별** (실행이 만들어진 날, UTC)',
    table(cols('날짜'), costRows(r.byDay)),
    '**PR별**',
    table(cols('PR'), costRows([...r.byPr, r.offPr, r.unlinked])),
  ];
  return parts.join('\n\n') + '\n';
}
