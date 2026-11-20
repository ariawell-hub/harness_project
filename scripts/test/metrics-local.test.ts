// metrics(17.2절 상시 지표 가운데 리포 파일과 로컬 로그로 재는 것): 계획 파일, runner 로그, 자체 테스트 보고서. 계획 20261119-metrics step2.
// 기간 밖의 계획·이벤트를 세거나, 작업자가 다른 실행을 잘못 묶거나, 잴 수 없는 지표가 이유 없이 빠지는 것을 본다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { runMetrics } from '../commands/metrics.ts';
import { loadConfig } from '../lib/config.ts';
import { localMetrics, type LocalMetrics } from '../metrics/local.ts';
import { pilotMetrics } from '../metrics/pilot.ts';
import { BEGIN, END, renderBlock } from '../metrics/render.ts';
import type { MetricsSource, Period } from '../metrics/source.ts';
import { steadyMetrics } from '../metrics/steady.ts';
import { HARNESS_ROOT, makeFixture, write, type Fixture } from './helpers.ts';

const P: Period = { since: '2026-11-11', until: '2026-11-12' };

let shared: Fixture | null = null;
after(() => shared?.cleanup());
function fixture(): Fixture {
  shared ??= makeFixture();
  return shared;
}

const local = (
  fx: Fixture,
  over: { runnerLog?: string | null; selfTestReport?: string | null } = {},
) =>
  localMetrics({
    root: fx.root,
    cfg: loadConfig(fx.root),
    period: P,
    runnerLog: over.runnerLog ?? null,
    selfTestReport: over.selfTestReport ?? null,
  });

// ── 계획 파일 ──

const PLAN_A = `---
id: 20261111-a
---

# 계획 A

## 진행 로그

- 방법 전환(진행 로그에 잘못 적은 줄, 3회): 세지 않는다

## 의사결정 로그

<!-- - 방법 전환(주석 안의 예시, 3회): 세지 않는다 -->

- 결정: 무엇 / 이유: 왜
- 방법 전환(check:lint, 3회): 가설 … / 시도한 방법 … / 폐기 이유 … / 새 방법 …
  - 방법 전환(들여 쓴 줄): 세지 않는다
- 방법 전환(review-round, 3회): 가설 … / 시도한 방법 … / 폐기 이유 … / 새 방법 …

## 발견 사항

<!-- - 주석 안의 항목 → 처리: #1 -->

- 문서로 옮겼다 → 처리: [문서](../../x.md)
- 링크와 번호가 함께 있으면 문서 반영이다 → 처리: [문서](../../x.md), #12
- Issue로 넘겼다 → 처리: #34
- 부채로 넘겼다 → 처리: TD-7
- 번호와 해당 없음이 함께 있으면 Issue·TD다 → 처리: TD-8(해당 없음은 아니다)
- 표기 앞의 [링크](../../y.md)는 보지 않는다 → 처리: #3
- 넘길 것이 없다 → 처리: 해당 없음
- 아직 표기하지 않았다
- 표기가 형식과 다르다 → 처리: 나중에
- 본문에 [링크](../../y.md)와 #99가 있지만 표기는 없다
  - 하위 항목은 세지 않는다 → 처리: #5
`;

const PLAN_B = `---
id: 20261112-b
---

# 계획 B

## 의사결정 로그

- 방법 전환(ac:x, 3회): 가설 … / 시도한 방법 … / 폐기 이유 … / 새 방법 …

## 발견 사항

- 없음
- 넘길 것이 없다 → 처리: 해당 없음
`;

/** 기간 밖의 계획. 든 것이 하나라도 세어지면 값이 달라진다 */
const outside = (id: string) => `---
id: ${id}
---

## 의사결정 로그

- 방법 전환(k, 3회): 기간 밖
- 방법 전환(k2, 3회): 기간 밖

## 발견 사항

- 기간 밖 → 처리: #1
- 기간 밖
`;

function writePlans(fx: Fixture): void {
  write(fx.root, 'docs/exec-plans/active/20261111-a.md', PLAN_A);
  write(fx.root, 'docs/exec-plans/completed/20261112-b/plan.md', PLAN_B);
  // step 파일의 줄은 세지 않는다(계획의 의사결정 로그만 본다)
  write(
    fx.root,
    'docs/exec-plans/completed/20261112-b/step0.md',
    '## 의사결정 로그\n\n- 방법 전환(step 파일, 3회): 세지 않는다\n',
  );
  write(fx.root, 'docs/exec-plans/completed/20261110-old.md', outside('20261110-old'));
  write(fx.root, 'docs/exec-plans/active/20261113-late/plan.md', outside('20261113-late'));
  // 계획 id 꼴이 아닌 파일
  write(fx.root, 'docs/exec-plans/active/notes.md', outside('notes'));
}

test('localMetrics: 방법 전환은 기간 안 계획의 의사결정 로그에서 "- 방법 전환("으로 시작하는 줄의 수다', () => {
  const fx = fixture();
  writePlans(fx);
  const m = local(fx);
  assert.equal(m.switches.total, 3);
  assert.deepEqual(m.switches.byPlan, [
    { id: '20261111-a', count: 2 },
    { id: '20261112-b', count: 1 },
  ]);
});

test('localMetrics: 발견 사항의 처리 분포는 "→ 처리:" 뒤를 문서 반영 → Issue·TD → 해당 없음 순서로 가른다', () => {
  const fx = fixture();
  writePlans(fx);
  // A: 문서 반영 2, Issue·TD 4, 해당 없음 1, 처리 표기 없음 3. B: 해당 없음 1("- 없음"은 발견 사항이 아니다)
  assert.deepEqual(local(fx).findings, { doc: 2, issueTd: 4, none: 2, unmarked: 3 });
});

test('localMetrics: 기간을 옮기면 그 기간의 계획만 센다(id의 날짜를 기간의 날짜와 그대로 견준다)', () => {
  const fx = fixture();
  writePlans(fx);
  const m = localMetrics({
    root: fx.root,
    cfg: loadConfig(fx.root),
    period: { since: '2026-11-10', until: '2026-11-10' },
    runnerLog: null,
    selfTestReport: null,
  });
  assert.deepEqual(m.switches, { total: 2, byPlan: [{ id: '20261110-old', count: 2 }] });
  assert.deepEqual(m.findings, { doc: 0, issueTd: 1, none: 0, unmarked: 1 });
});

// ── runner 로그 ──

const ev = (ts: string, worker: string, event: string, data: Record<string, unknown> = {}) =>
  JSON.stringify({ ts, worker, event, ...data });

const RUNNER_LOG = [
  // 기간 전에 시작한 실행은 기간 안에 끝나도 세지 않는다
  ev('2026-11-10T23:50:00Z', 'w1', 'start'),
  ev('2026-11-11T00:10:00Z', 'w1', 'exit', { reason: 'idle' }),
  // w1: 30분, 사람 대기. 그 사이에 w2가 시작한다(작업자별로 묶지 않으면 w2의 실행이 01:30에 끝난 것이 된다)
  ev('2026-11-11T01:00:00Z', 'w1', 'start'),
  ev('2026-11-11T01:10:00Z', 'w2', 'start'),
  ev('2026-11-11T01:30:00Z', 'w1', 'exit', { reason: 'human' }),
  // w1: exit 없이 다음 start가 온다
  ev('2026-11-11T02:00:00Z', 'w1', 'start'),
  // w2: 90분, 할 일 없음
  ev('2026-11-11T02:40:00Z', 'w2', 'exit', { reason: 'idle' }),
  // w1: 10분. reason이 정해진 값이 아니면 "그 밖"이고 문자열은 결과에 남지 않는다
  ev('2026-11-11T03:00:00Z', 'w1', 'start'),
  ev('2026-11-11T03:10:00Z', 'w1', 'exit', { reason: '세션 출력이 섞인 문자열' }),
  // 깨진 줄 넷: JSON이 아니다, 객체가 아니다, 시각이 없다, 시각이 날짜가 아니다
  'not json',
  '[]',
  JSON.stringify({ worker: 'w1', event: 'start' }),
  JSON.stringify({ ts: '어제', worker: 'w1', event: 'start' }),
  // start 없는 exit는 버린다
  ev('2026-11-11T04:00:00Z', 'w3', 'exit', { reason: 'error' }),
  // 세션: (p1, 0) 3회, (p1, 1) 1회, (p2, step 없음) 1회, (p2, 0) 2회
  ev('2026-11-11T05:00:00Z', 'w1', 'session-start', { plan: 'p1', step: 0, attempt: 1 }),
  ev('2026-11-11T05:10:00Z', 'w1', 'session-start', { plan: 'p1', step: 0, attempt: 2 }),
  ev('2026-11-11T05:20:00Z', 'w1', 'session-start', { plan: 'p1', step: 0, attempt: 3 }),
  ev('2026-11-11T05:30:00Z', 'w1', 'session-start', { plan: 'p1', step: 1, attempt: 1 }),
  ev('2026-11-11T05:40:00Z', 'w2', 'session-start', { plan: 'p2', kind: 'planning', attempt: 1 }),
  ev('2026-11-11T05:50:00Z', 'w2', 'session-start', { plan: 'p2', step: 0, attempt: 1 }),
  ev('2026-11-12T05:00:00Z', 'w2', 'session-start', { plan: 'p2', step: 0, attempt: 2 }),
  ev('2026-11-13T05:00:00Z', 'w2', 'session-start', { plan: 'p9', step: 0, attempt: 5 }),
  // judge-fail: AC 실패 확인 2, AC 결과 미확인 1, 그 밖 2, 기간 밖 1
  ev('2026-11-11T06:00:00Z', 'w1', 'judge-fail', {
    plan: 'p1',
    detail: 'AC 2개, check 실패: 없음',
  }),
  ev('2026-11-11T06:10:00Z', 'w1', 'judge-fail', {
    plan: 'p1',
    detail: 'AC 3개, check 실패: 없음',
  }),
  ev('2026-11-11T06:20:00Z', 'w1', 'judge-fail', {
    plan: 'p1',
    detail: 'AC 1개, check 실패: lint, test',
  }),
  ev('2026-11-11T06:30:00Z', 'w1', 'judge-fail', { plan: 'p1', detail: 'AC 명령이 없다' }),
  ev('2026-11-11T06:40:00Z', 'w1', 'judge-fail', { plan: 'p1' }),
  ev('2026-11-13T06:00:00Z', 'w1', 'judge-fail', {
    plan: 'p1',
    detail: 'AC 2개, check 실패: 없음',
  }),
  // 발산: 기간 안 3, 기간 밖 1
  ev('2026-11-11T07:00:00Z', 'w1', 'review-diverged', { plan: 'p1', pr: 1 }),
  ev('2026-11-11T07:10:00Z', 'w1', 'review-reverted', { plan: 'p1', pr: 1 }),
  ev('2026-11-12T07:00:00Z', 'w2', 'review-reverted', { plan: 'p2', pr: 2 }),
  ev('2026-11-10T07:00:00Z', 'w2', 'review-diverged', { plan: 'p2', pr: 2 }),
  // 다른 이벤트는 세지 않는다
  ev('2026-11-11T08:00:00Z', 'w1', 'pick', { kind: 'step' }),
  // w2: 시간대가 붙은 시각(UTC로 11-12 23:00)에 시작하고 로그가 끝난다
  ev('2026-11-13T08:00:00+09:00', 'w2', 'start'),
  // 기간 뒤에 시작한 실행
  ev('2026-11-13T00:00:00Z', 'w1', 'start'),
  ev('2026-11-13T00:05:00Z', 'w1', 'exit', { reason: 'error' }),
  '',
].join('\n');

function writeLog(fx: Fixture, name: string, text: string): string {
  const file = path.join(fx.dir, name);
  writeFileSync(file, text);
  return file;
}

test('localMetrics: runner 실행은 작업자별로 start와 그 뒤 첫 exit를 묶고, 시작이 기간 안인 것만 센다', () => {
  const fx = fixture();
  const r = local(fx, { runnerLog: writeLog(fx, 'runner.jsonl', RUNNER_LOG) }).runner;
  assert.ok(r);
  // w1 01:00(30분), w1 02:00(종료 기록 없음), w1 03:00(10분), w2 01:10(90분), w2 11-12 23:00(종료 기록 없음)
  assert.equal(r.runs, 5);
  assert.equal(r.noExit, 2);
  assert.equal(r.medianMin, 30);
  assert.equal(r.maxMin, 90);
  assert.equal(r.reasons.human, 1);
  assert.equal(r.reasons.idle, 1);
  assert.equal(r.reasons.other, 1);
  assert.equal(r.reasons.error, 0);
  // 끝난 실행 셋의 이유만 센다
  assert.equal(
    Object.values(r.reasons).reduce((a, b) => a + b, 0),
    3,
  );
  assert.equal(r.broken, 4);
});

test('localMetrics: step당 세션 수는 plan과 step으로 묶고, 재시도는 attempt가 2 이상인 세션의 수다', () => {
  const fx = fixture();
  const r = local(fx, { runnerLog: writeLog(fx, 'runner.jsonl', RUNNER_LOG) }).runner;
  assert.ok(r);
  // 묶음의 크기: 3, 1, 1, 2
  assert.deepEqual(r.sessions, { median: 1.5, max: 3, retries: 3 });
});

test('localMetrics: judge-fail을 detail로 세 갈래로 가르고, AC 실패는 범위로 낸다', () => {
  const fx = fixture();
  const r = local(fx, { runnerLog: writeLog(fx, 'runner.jsonl', RUNNER_LOG) }).runner;
  assert.ok(r);
  assert.deepEqual(r.judgeFail, { acFailed: 2, acUnknown: 1, other: 2 });
  assert.equal(r.diverged, 3);
  // 범위: "확인" 이상, "확인 + 미확인" 이하
  const text = block(local(fx, { runnerLog: writeLog(fx, 'runner.jsonl', RUNNER_LOG) }));
  assert.match(text, /^- "세션은 완료라 했지만 AC 실패": 2건 이상 3건 이하\(.+, TD-\d+\)$/m);
  assert.match(text, /^ {2}- AC 실패 확인 2건 · AC 결과 미확인 1건 · 그 밖 2건$/m);
});

test('localMetrics: runner 로그가 없으면 runner 지표가 없다(경로를 주지 않았거나 파일이 없다)', () => {
  const fx = fixture();
  assert.equal(local(fx).runner, null);
  assert.equal(local(fx, { runnerLog: path.join(fx.dir, 'no-such', 'runner.jsonl') }).runner, null);
  // 빈 로그는 로그가 있는 것이다: 값이 0이다
  const empty = local(fx, { runnerLog: writeLog(fx, 'empty.jsonl', '') }).runner;
  assert.ok(empty);
  assert.equal(empty.runs, 0);
  assert.equal(empty.medianMin, null);
  assert.deepEqual(empty.sessions, { median: null, max: null, retries: 0 });
  assert.equal(empty.broken, 0);
});

// ── 자체 테스트 보고서 ──

const report = (states: string[]) =>
  JSON.stringify({
    version: 1,
    headSha: '',
    results: states.map((state, i) => ({ id: `s${i}`, covers: 'R1', state, detail: '제목' })),
  });

test('localMetrics: 자체 테스트 통과율은 보고서의 pass 수 ÷ 전체다. 보고서를 주지 않으면 값이 없다', () => {
  const fx = fixture();
  const file = writeLog(fx, 'selftest.json', report(['pass', 'pass', 'fail', 'error']));
  assert.deepEqual(local(fx, { selfTestReport: file }).selfTest, { passed: 2, total: 4 });
  assert.equal(local(fx).selfTest, null);
});

/** 읽으면 그 이름을 적고 예외를 던지는 자료 */
function untouchable(): { source: MetricsSource; calls: string[] } {
  const calls: string[] = [];
  const source = new Proxy(
    {},
    {
      get: (_t, k) => () => {
        calls.push(String(k));
        throw new Error('읽으면 안 된다');
      },
    },
  ) as MetricsSource;
  return { source, calls };
}

test('runMetrics: --self-test-report가 없는 파일이거나 형식이 다르면 종료 코드 1이고 자료를 읽지 않는다', () => {
  const fx = fixture();
  const cases: Array<[string, string]> = [
    ['없는 파일', path.join(fx.dir, 'no-such.json')],
    ['JSON이 아니다', writeLog(fx, 'bad1.json', 'not json')],
    ['results가 없다', writeLog(fx, 'bad2.json', JSON.stringify({ version: 1 }))],
    ['state가 정해진 값이 아니다', writeLog(fx, 'bad3.json', report(['pass', 'skipped']))],
    // `self-test --live --out`의 보고서는 형식이 다르다(시나리오별 통과 횟수)
    [
      '실제 세션 보고서',
      writeLog(
        fx,
        'bad4.json',
        JSON.stringify({ version: 1, live: true, runs: 3, results: [{ id: 'x', passed: 3 }] }),
      ),
    ],
  ];
  for (const [why, file] of cases) {
    const { source, calls } = untouchable();
    const out: string[] = [];
    const err: string[] = [];
    const code = runMetrics(
      fx.root,
      {
        since: P.since,
        until: P.until,
        selfTestReport: file,
        out: (l) => out.push(l),
        err: (l) => err.push(l),
      },
      source,
    );
    assert.equal(code, 1, why);
    assert.deepEqual(calls, [], why);
    assert.deepEqual(out, [], why);
    assert.match(err.join('\n'), /metrics: .*--self-test-report/, why);
  }
});

// ── 렌더 ──

const PILOT = pilotMetrics({
  period: P,
  defaultBranch: 'main',
  priorMainCheck: null,
  prs: [],
  runs: [],
  bugs: [],
  ledgers: new Map(),
});
const STEADY = steadyMetrics({
  period: P,
  prs: [],
  runs: [],
  ledgers: new Map(),
  statuses: new Map(),
  recorderBot: '',
  planClaimedAt: new Map(),
  headPrCounts: new Map(),
  labels: [],
  comments: [],
});
const block = (l: LocalMetrics) => renderBlock(P, PILOT, STEADY, l);

const FULL: LocalMetrics = {
  switches: {
    total: 3,
    byPlan: [
      { id: '20261111-a', count: 2 },
      { id: '20261112-b', count: 1 },
    ],
  },
  findings: { doc: 2, issueTd: 4, none: 2, unmarked: 3 },
  reviewNeeded: 4,
  runner: {
    runs: 5,
    medianMin: 30,
    maxMin: 90,
    noExit: 2,
    reasons: {
      idle: 1,
      human: 1,
      'time-limit': 0,
      'usage-limit': 0,
      'max-iterations': 0,
      once: 0,
      locked: 0,
      'agent-missing': 0,
      error: 0,
      other: 1,
    },
    sessions: { median: 1.5, max: 3, retries: 3 },
    judgeFail: { acFailed: 2, acUnknown: 1, other: 2 },
    diverged: 3,
    broken: 4,
  },
  selfTest: { passed: 2, total: 3 },
};

const EMPTY: LocalMetrics = {
  switches: { total: 0, byPlan: [] },
  findings: { doc: 0, issueTd: 0, none: 0, unmarked: 0 },
  reviewNeeded: 0,
  runner: null,
  selfTest: null,
};

test('renderBlock: 로컬 지표가 상시 지표 절에 값으로 나온다', () => {
  const text = block(FULL);
  const section = text.split('### 상시 지표')[1];
  for (const expected of [
    /^- 발산 감지 횟수: 3건$/m,
    /^- 3회 방법 전환: 3건\(20261111-a 2건, 20261112-b 1건\)$/m,
    /^- "검토 필요" 문서 수: 4개\(기간과 무관한 현재 값\)$/m,
    /^- 하네스 자체 테스트 통과율: 2건 ÷ 3건 = 66\.7%$/m,
    /^- runner 연속 실행 시간과 멈춘 이유\(이 명령을 실행한 머신의 로그만 본다\)$/m,
    /^ {2}- 실행: 5회 · 중앙값 30분 · 최대 90분 · 종료 기록 없음 2회$/m,
    /^ {2}- 멈춘 이유: 할 일 없음 1회 · 사람 대기 1회 · 그 밖 1회$/m,
    /^ {2}- 읽지 못한 로그 줄: 4줄$/m,
    /^- step당 세션 수·재시도 수: 중앙값 1\.5회 · 최대 3회 · 재시도 3건$/m,
    /^- 발견 사항의 처리 분포: 문서 반영 2건 · Issue·TD 4건 · 해당 없음 2건 · 처리 표기 없음 3건$/m,
  ])
    assert.match(section, expected);
  // 로컬 지표를 주지 않으면 step1의 출력 그대로다
  assert.equal(renderBlock(P, PILOT, STEADY), text.slice(0, text.indexOf('\n- 발산 감지 횟수')));
});

test('renderBlock: runner 로그와 보고서가 없으면 값 대신 이유를 적는다', () => {
  const text = block(EMPTY);
  for (const expected of [
    /^- 발산 감지 횟수: —\(이 머신에 runner 로그 없음\)$/m,
    /^- 3회 방법 전환: 0건$/m,
    /^- 하네스 자체 테스트 통과율: —\(보고서 없음\. `self-test --out`으로 만든다\)$/m,
    /^- runner 연속 실행 시간과 멈춘 이유: —\(이 머신에 runner 로그 없음\)$/m,
    /^- step당 세션 수·재시도 수: —\(이 머신에 runner 로그 없음\)$/m,
    /^- "세션은 완료라 했지만 AC 실패": —\(이 머신에 runner 로그 없음\)\. 로그가 있어도 범위로만 낸다\(.+, TD-\d+\)$/m,
  ])
    assert.match(text, expected);
  // 로그는 있지만 기간 안의 실행·세션이 없다
  const quiet = block({
    ...EMPTY,
    runner: {
      ...FULL.runner!,
      runs: 0,
      medianMin: null,
      maxMin: null,
      noExit: 0,
      reasons: { ...FULL.runner!.reasons, idle: 0, human: 0, other: 0 },
      sessions: { median: null, max: null, retries: 0 },
      broken: 0,
    },
    selfTest: { passed: 0, total: 0 },
  });
  assert.match(quiet, /^ {2}- 실행: 0회$/m);
  assert.match(quiet, /^ {2}- 멈춘 이유: 없음$/m);
  assert.match(quiet, /^- step당 세션 수·재시도 수: —\(기간 안의 세션 없음\)$/m);
  assert.match(quiet, /^- 하네스 자체 테스트 통과율: —\(보고서에 시나리오가 없다\)$/m);
});

test('renderBlock: 잴 수 없는 지표 넷은 값 대신 이유와 TD 번호로 나온다', () => {
  for (const l of [FULL, EMPTY]) {
    const text = block(l);
    assert.match(
      text,
      /^- PR 크기 경고·범위 이탈 경고 수\(R15, R18\): —\(게이트가 없다, TD-6\)\. PR 크기는 위 "400줄을 넘는 PR"로 대신 본다$/m,
    );
    assert.match(
      text,
      /^- 위험 작업·제작자 권한 명령 차단 횟수\(R13, R14, R20\): —\(L1 훅이 차단을 기록하지 않는다, TD-\d+\)$/m,
    );
    assert.match(
      text,
      /^- 구독 한도 때문에 검증이 보류된 횟수\(Q12\): —\(한도와 그 밖의 검증자 장애를 가르는 기록이 없다, TD-\d+\)\. 파일럿 판정 지표의 "실패로 끝난 판정 워크플로 실행"으로 대신 본다$/m,
    );
    assert.match(
      text,
      /^ {2}- 실패 키별 3회·5회 횟수: —\(실패 기록 `attempts\.jsonl`이 worktree와 함께 지워져 키별로 셀 수 없다, TD-\d+\)\. 횟수는 계획의 방법 전환 줄과 중단 보고 댓글로 센다$/m,
    );
  }
  // 넷과 AC 실패의 TD 번호는 서로 다르다(TD-6과 새 TD 넷)
  const tds = [...block(FULL).matchAll(/TD-(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(tds).size, 5);
  assert.ok(tds.includes(6));
});

test('renderBlock: 로컬 지표의 줄도 표와 시각을 쓰지 않고 prettier가 고칠 꼴이 없다', () => {
  for (const l of [FULL, EMPTY]) {
    const text = block(l);
    const lines = text.split('\n');
    assert.ok(!lines.some((x) => x.trimStart().startsWith('|')), '표가 있다');
    assert.ok(!lines.some((x) => /\s$/.test(x)), '줄 끝 공백이 있다');
    assert.ok(!/\n\n\n/.test(text), '빈 줄이 연달아 있다');
    const start = lines.indexOf('### 상시 지표');
    for (const x of lines.slice(start + 2)) assert.match(x, /^( {2})?- \S/, x);
    assert.ok(!/\d{2}:\d{2}/.test(text), '시각이 있다');
    // 로그의 자유 문자열이 남지 않는다
    assert.ok(!text.includes('세션 출력이 섞인 문자열'));
  }
});

// ── 17.2절의 상시 지표 13항목 ──

/** 설계서 17.2절 "상시 지표"의 항목과, 집계 결과에서 그 항목에 대응하는 줄 */
const ITEMS: Array<[string, RegExp[]]> = [
  ['PR 리드타임(계획 생성 → 병합)', [/^- PR 리드타임\(계획 생성 → 병합\): \S/m]],
  ['CI 첫 통과율', [/^- CI 첫 통과율: \S/m]],
  [
    'PR당 리뷰 라운드 수와 발산 감지 횟수',
    [/^- PR당 리뷰 라운드 수: \S/m, /^- 발산 감지 횟수: \S/m],
  ],
  [
    '3회 방법 전환, 5회 중단, 총량 상한 도달 횟수(실패 키별)',
    [
      /^- 3회 방법 전환: \d+건/m,
      /^- 5회 중단: \d+건 · 총량 상한 도달: \d+건$/m,
      /^ {2}- 실패 키별 3회·5회 횟수: —\(.+, TD-\d+\)/m,
    ],
  ],
  [
    '에스컬레이션 수와 사유(교착, 검증자 장애 포함)',
    [/^ {2}- `needs-human` 라벨이 붙은 횟수: \d+건$/m, /^ {2}- 사유별 알림 댓글: \S/m],
  ],
  [
    '위험도별 PR 수, PR당 검증 사용량, 구독 한도 때문에 검증이 보류된 횟수(Q12)',
    [
      /^- 위험도별 PR 수: \S/m,
      /^- PR당 검증 사용량: \S/m,
      /^- 구독 한도 때문에 검증이 보류된 횟수\(Q12\): —\(.+, TD-\d+\)/m,
    ],
  ],
  [
    'PR 크기 경고·범위 이탈 경고 수(R15, R18)',
    [/^- PR 크기 경고·범위 이탈 경고 수\(R15, R18\): —\(.+, TD-6\)/m],
  ],
  [
    '위험 작업·제작자 권한 명령 차단 횟수(R13, R14, R20)',
    [/^- 위험 작업·제작자 권한 명령 차단 횟수\(R13, R14, R20\): —\(.+, TD-\d+\)$/m],
  ],
  ['"검토 필요" 문서 수(7.2절)', [/^- "검토 필요" 문서 수: \d+개/m]],
  ['하네스 자체 테스트 통과율(12.4절)', [/^- 하네스 자체 테스트 통과율: \S/m]],
  [
    'runner 연속 실행 시간과 멈춘 이유(할 일 없음, 사람 대기, 사용량 한도, 시간 상한, 오류)(4.5절)',
    [/^- runner 연속 실행 시간과 멈춘 이유(\(.+\)|: —\(.+\))$/m],
  ],
  [
    'step당 세션 수·재시도 수, runner 판정에서 "세션은 완료라 했지만 AC 실패"가 나온 횟수',
    [/^- step당 세션 수·재시도 수: \S/m, /^- "세션은 완료라 했지만 AC 실패": .+, TD-\d+\)$/m],
  ],
  [
    '발견 사항의 처리 분포(문서 반영 / Issue·TD / 해당 없음)(8.3절)',
    [/^- 발견 사항의 처리 분포: 문서 반영 \d+건 · Issue·TD \d+건 · 해당 없음 \d+건/m],
  ],
];

test('고정한 13항목이 설계서 17.2절의 상시 지표 목록과 같다', () => {
  const design = readFileSync(path.join(HARNESS_ROOT, 'docs/harness/design.md'), 'utf8').split(
    '\n',
  );
  const start = design.indexOf('**상시 지표**');
  assert.ok(start > 0, '설계서에 상시 지표 목록이 없다');
  const bullets: string[] = [];
  for (const l of design.slice(start + 1)) {
    if (!l.startsWith('- ')) break;
    bullets.push(l.slice(2));
  }
  assert.equal(ITEMS.length, 13);
  assert.deepEqual(
    ITEMS.map(([name]) => name),
    bullets,
  );
});

test('renderBlock: 17.2절 상시 지표 13항목 각각에 대응하는 줄이 있다(로그·보고서가 있든 없든)', () => {
  for (const l of [FULL, EMPTY]) {
    const section = block(l).split('### 상시 지표')[1];
    for (const [name, lines] of ITEMS)
      for (const re of lines) assert.match(section, re, `${name}: ${re}`);
  }
});

// ── 이 리포의 문서 ──

test('이 리포의 docs/QUALITY_SCORE.md 표식 구간에 17.2절 상시 지표 13항목 각각에 대응하는 줄이 있다', () => {
  const doc = readFileSync(path.join(HARNESS_ROOT, 'docs/QUALITY_SCORE.md'), 'utf8');
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  assert.ok(a >= 0 && b > a, '표식 구간이 없다');
  const inner = doc.slice(a + BEGIN.length, b);
  const section = inner.split('### 상시 지표')[1];
  assert.ok(section, '상시 지표 절이 없다');
  for (const [name, lines] of ITEMS)
    for (const re of lines) assert.match(section, re, `${name}: ${re}`);
});

test('이 리포의 기술 부채 표에 조회의 한계와 출력이 가리키는 TD가 등록돼 있다', () => {
  const rows = readFileSync(path.join(HARNESS_ROOT, 'docs/exec-plans/tech-debt-tracker.md'), 'utf8')
    .split('\n')
    .filter((l) => /^\| TD-\d+\s*\|/.test(l));
  // step1에서 알게 된 조회의 한계 둘을 담은 TD 하나
  assert.ok(
    rows.some((r) => r.includes('issues/events') && r.includes('250') && r.includes('종료 코드 2')),
    '조회의 한계(issues/events, 250, 종료 코드 2)를 담은 TD 행이 없다',
  );
  // 출력이 가리키는 번호마다 표에 그 번호의 행이 있다
  const cited = new Set(
    [FULL, EMPTY].flatMap((l) => [...block(l).matchAll(/TD-(\d+)/g)].map((m) => m[1])),
  );
  assert.ok(cited.size >= 5);
  for (const n of cited)
    assert.ok(
      rows.some((r) => new RegExp(`^\\| TD-${n}\\s*\\|`).test(r)),
      `TD-${n} 행이 없다`,
    );
});
