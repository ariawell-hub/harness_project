// actions-cost의 계산·렌더·보존 기록(계획 20261121-actions-cost-design step0). 입출력이 없는 함수만 본다.
// 출력에 PR 제목·브랜치 이름이 들어갈 길은 없다: 입력 타입(JobRecord)에 그 필드가 없다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  OTHER,
  actionsCost,
  billedMinutes,
  formatSaved,
  fromSaved,
  knownNamesFrom,
  parseSaved,
  recordCells,
  renderCost,
  runnerRate,
  toSaved,
  type JobRecord,
  type KnownNames,
  type SavedJob,
} from '../metrics/actions-cost.ts';
import { SourceError, type Period } from '../metrics/source.ts';
import { HARNESS_ROOT } from './helpers.ts';

const PERIOD: Period = { since: '2026-11-17', until: '2026-11-18' };
const KNOWN: KnownNames = new Map([
  ['check', new Set(['check'])],
  ['gates', new Set(['evaluate', 'record', 'selftest'])],
  ['judge-codex', new Set(['plan', 'judge'])],
]);
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

let nextRun = 1;
/** `seconds`초를 돈 job. 넘긴 필드만 바꾼다 */
function job(over: Partial<JobRecord> & { seconds?: number } = {}): JobRecord {
  const { seconds = 30, ...rest } = over;
  const start = Date.parse('2026-11-17T01:00:00Z');
  return {
    runId: nextRun++,
    workflow: 'check',
    job: 'check',
    attempt: 1,
    event: 'pull_request',
    createdAt: '2026-11-17T00:59:00Z',
    conclusion: 'success',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + seconds * 1000).toISOString(),
    labels: ['ubuntu-latest'],
    steps: 5,
    pr: 7,
    head: SHA_A,
    offPr: false,
    ...rest,
  };
}
const cost = (jobs: JobRecord[], known = KNOWN, period = PERIOD) =>
  actionsCost(jobs, period, known);
const render = (jobs: JobRecord[], known = KNOWN, period = PERIOD) =>
  renderCost(cost(jobs, known, period), period);

/** 렌더의 표에서 첫 칸이 `first`인 행의 칸들 */
function rowOf(text: string, first: string): string[] | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells[0] === first) return cells;
  }
  return null;
}

test('청구 분: 초를 분으로 올림하고 최소 1분이다', () => {
  assert.equal(billedMinutes(job({ seconds: 59 })), 1);
  assert.equal(billedMinutes(job({ seconds: 60 })), 1);
  assert.equal(billedMinutes(job({ seconds: 61 })), 2);
  assert.equal(billedMinutes(job({ seconds: 0 })), 1, '0초이지만 단계가 있는 job은 1분');
  assert.equal(billedMinutes(job({ seconds: 425 })), 8);
});

test('청구 분: 돌지 않은 job은 0분이다', () => {
  assert.equal(billedMinutes(job({ conclusion: 'skipped' })), 0);
  assert.equal(billedMinutes(job({ steps: 0 })), 0);
  assert.equal(billedMinutes(job({ startedAt: null })), 0);
  assert.equal(billedMinutes(job({ completedAt: null })), 0);
  assert.equal(billedMinutes(job({ startedAt: '시각 아님' })), 0);
  const r = cost([job({ conclusion: 'skipped' }), job({ steps: 0 }), job({ seconds: 61 })]);
  assert.equal(r.idleJobs, 2);
  assert.equal(r.ranJobs, 1);
  assert.equal(r.minutes, 2);
});

test('청구 분: 끝이 시작보다 이르면 0초로 보고 1분이다', () => {
  const j = job();
  assert.equal(billedMinutes({ ...j, startedAt: j.completedAt, completedAt: j.startedAt }), 1);
});

test('시도: 같은 실행의 시도가 다르면 각각 센다', () => {
  const r = cost([
    job({ runId: 900, attempt: 1, seconds: 61 }),
    job({ runId: 900, attempt: 2, seconds: 61 }),
  ]);
  assert.equal(r.minutes, 4);
  assert.equal(r.runs, 1);
  assert.equal(r.rerunMinutes, 2);
});

test('시도: 일부 job만 다시 실행하면 다시 돈 job만 두 번 청구된다', () => {
  // 시도 1에서 evaluate·record가 돌고 시도 2에서 record만 다시 돈다
  const jobs = [
    job({ runId: 901, workflow: 'gates', job: 'evaluate', attempt: 1, seconds: 20 }),
    job({ runId: 901, workflow: 'gates', job: 'record', attempt: 1, seconds: 20 }),
    job({ runId: 901, workflow: 'gates', job: 'record', attempt: 2, seconds: 20 }),
  ];
  const r = cost(jobs);
  const byJob = new Map(r.byJob.map((x) => [x.name, x]));
  assert.equal(byJob.get('gates / evaluate')?.minutes, 1);
  assert.equal(byJob.get('gates / record')?.minutes, 2);
  assert.equal(byJob.get('gates / record')?.jobs, 2);
  assert.equal(r.rerunMinutes, 1);
  assert.deepEqual(
    toSaved(jobs, KNOWN).map((s) => [s.job, s.attempt]),
    [
      ['evaluate', 1],
      ['record', 1],
      ['record', 2],
    ],
  );
});

test('단가: 확인한 라벨 하나뿐일 때만 금액을 낸다', () => {
  assert.deepEqual(runnerRate(['ubuntu-latest']), { kind: 'priced', usdPerMinute: 0.006 });
  assert.equal(runnerRate(['ubuntu-24.04']).kind, 'priced');
  assert.equal(runnerRate(['ubuntu-22.04']).kind, 'priced');
  assert.deepEqual(runnerRate(['macos-latest']), { kind: 'unknown', usdPerMinute: 0 });
  assert.equal(runnerRate(['ubuntu-latest', 'gpu']).kind, 'unknown');
  assert.equal(runnerRate([]).kind, 'unknown');
  assert.deepEqual(runnerRate(['self-hosted', 'linux']), { kind: 'self-hosted', usdPerMinute: 0 });
});

test('단가: 모르는 러너와 self-hosted는 금액에 들지 않고 분이 따로 나온다', () => {
  const r = cost([
    job({ seconds: 61 }),
    job({ seconds: 130, labels: ['macos-latest'] }),
    job({ seconds: 200, labels: ['self-hosted'] }),
  ]);
  assert.equal(r.minutes, 2);
  assert.equal(r.usd, 0.012);
  assert.equal(r.unknownMinutes, 3);
  assert.equal(r.selfHostedMinutes, 4);
  assert.equal(r.ranJobs, 3);
});

test('올림으로 붙은 분, 1분 미만 job, 30일 환산', () => {
  // 30초 + 90초 = 실제 2분, 청구 1 + 2 = 3분. 기간 2일
  const r = cost([job({ seconds: 30 }), job({ seconds: 90 })]);
  assert.equal(r.days, 2);
  assert.equal(r.minutes, 3);
  assert.equal(r.actualSeconds, 120);
  assert.equal(r.roundingMinutes, 1);
  assert.equal(r.subMinuteJobs, 1);
  assert.equal(r.subMinuteMinutes, 1);
  assert.equal(r.monthlyMinutes, 45);
  assert.equal(r.monthlyUsd, 0.27);
});

test('PR head 하나당 평균: 분자와 분모가 head가 있는 job이다', () => {
  const linked = [
    job({ seconds: 61, head: SHA_A }),
    job({ seconds: 61, head: SHA_B, pr: 8 }),
    job({ seconds: 61, head: SHA_B, pr: 8 }),
  ];
  const base = cost(linked);
  assert.equal(base.heads, 2);
  assert.equal(base.headMinutes, 6);
  assert.equal(base.perHead, 3);
  // PR 밖 실행과 PR을 찾지 못한 실행이 있어도 값이 변하지 않는다
  const mixed = cost([
    ...linked,
    job({ seconds: 600, pr: null, head: null, offPr: true, event: 'push' }),
    job({ seconds: 600, pr: null, head: null, offPr: false, event: 'workflow_run' }),
  ]);
  assert.equal(mixed.perHead, 3);
  assert.equal(mixed.heads, 2);
  // 같은 head에서 실행이 더 돌면 분모는 그대로이고 분자만 는다
  const again = cost([...linked, job({ seconds: 61, head: SHA_A })]);
  assert.equal(again.heads, 2);
  assert.equal(again.perHead, 4);
  assert.equal(cost([job({ pr: null, head: null, offPr: true })]).perHead, null);
});

test('PR 하나당 평균: PR에 이어진 실행만 센 값과 PR 밖 포함 값의 분모가 같다', () => {
  const linked = [job({ seconds: 61, pr: 7 }), job({ seconds: 61, pr: 8, head: SHA_B })];
  const base = cost(linked);
  assert.equal(base.prs, 2);
  assert.equal(base.perPrLinked, 2);
  assert.equal(base.perPrAll, 2);
  const mixed = cost([
    ...linked,
    job({ seconds: 121, pr: null, head: null, offPr: true }),
    job({ seconds: 61, pr: null, head: null, offPr: false }),
  ]);
  assert.equal(mixed.prs, 2);
  assert.equal(mixed.perPrLinked, 2, 'PR 밖 실행이 있어도 변하지 않는다');
  assert.equal(mixed.perPrAll, 4.5, '전체 9분 ÷ PR 2개');
  assert.equal(mixed.perPrUsd, 0.027, '전체 $0.054 ÷ PR 2개');
  assert.equal(mixed.usdMilli, 54, '밀리달러 정수');
  const none = cost([job({ pr: null, head: null, offPr: true })]);
  assert.equal(none.perPrLinked, null);
  assert.equal(none.perPrAll, null);
  assert.equal(none.perPrUsd, null);
});

test('PR별: pr이 없는 job은 offPr에 따라 두 행으로 나뉜다', () => {
  const r = cost([
    job({ seconds: 61, pr: 7 }),
    job({ seconds: 61, pr: 7 }),
    job({ seconds: 61, pr: 12, head: SHA_B }),
    job({ seconds: 121, pr: null, head: null, offPr: true }),
    job({ seconds: 181, pr: null, head: null, offPr: false }),
  ]);
  assert.deepEqual(
    r.byPr.map((x) => [x.name, x.minutes]),
    [
      ['#7', 4],
      ['#12', 2],
    ],
  );
  assert.equal(r.offPr.minutes, 3);
  assert.equal(r.unlinked.minutes, 4);
  const text = renderCost(r, PERIOD);
  assert.deepEqual(rowOf(text, 'PR 밖(main 등)')?.slice(1, 3), ['1', '3']);
  assert.deepEqual(rowOf(text, 'PR을 찾지 못함')?.slice(1, 3), ['1', '4']);
});

test('날짜별: 기간의 모든 날이 나오고 실행이 만들어진 날에 든다', () => {
  const r = cost([
    job({ seconds: 61, createdAt: '2026-11-17T23:59:59Z' }),
    job({ seconds: 61, createdAt: '2026-11-18T00:00:00Z' }),
    job({ seconds: 61, createdAt: '2026-11-18T10:00:00Z' }),
  ]);
  // 다른 표와 같이 청구 분 내림차순이다
  assert.deepEqual(
    r.byDay.map((x) => [x.name, x.minutes]),
    [
      ['2026-11-18', 4],
      ['2026-11-17', 2],
    ],
  );
  const empty = cost([job({ seconds: 61, createdAt: '2026-11-18T00:00:00Z' })]);
  assert.deepEqual(
    empty.byDay.map((x) => [x.name, x.jobs, x.minutes]),
    [
      ['2026-11-18', 1, 2],
      ['2026-11-17', 0, 0],
    ],
  );
});

test('기록 칸: 여섯 칸의 값과 렌더의 그 행이 같다', () => {
  const jobs = [
    job({ seconds: 61, pr: 7 }),
    job({ seconds: 61, pr: 8, head: SHA_B }),
    job({ seconds: 61, pr: null, head: null, offPr: true }),
  ];
  const r = cost(jobs);
  const cells = recordCells(r, PERIOD);
  // 청구 6분, PR 2개(PR 밖 포함 6 ÷ 2), head 2개(4 ÷ 2), 6분 × $0.006 ÷ 2일 × 30일
  assert.deepEqual(cells, ['2026-11-17~2026-11-18', '6', '3.0', '$0.018', '2.0', '$0.54']);
  assert.deepEqual(rowOf(renderCost(r, PERIOD), cells[0]), cells);
  const none = cost([job({ pr: null, head: null, offPr: true, seconds: 61 })]);
  assert.deepEqual(recordCells(none, PERIOD), [
    '2026-11-17~2026-11-18',
    '2',
    '해당 없음',
    '해당 없음',
    '해당 없음',
    '$0.18',
  ]);
});

test('렌더: 입력의 순서를 바꿔도 출력이 같다', () => {
  const jobs = [
    job({ workflow: 'gates', job: 'evaluate', seconds: 20 }),
    job({ workflow: 'gates', job: 'record', seconds: 20, pr: 9, head: SHA_B }),
    job({ seconds: 400 }),
    job({ workflow: 'judge-codex', job: 'judge', seconds: 300, pr: null, head: null }),
    job({ conclusion: 'skipped', workflow: 'gates', job: 'selftest' }),
  ];
  const a = render(jobs);
  assert.equal(render([...jobs].reverse()), a);
  assert.equal(render([jobs[2], jobs[0], jobs[4], jobs[1], jobs[3]]), a);
  // 청구 분 내림차순, 같으면 이름 오름차순
  const names = cost(jobs).byJob.map((x) => x.name);
  assert.deepEqual(names, [
    'check / check',
    'judge-codex / judge',
    'gates / evaluate',
    'gates / record',
  ]);
});

test('렌더: 표의 줄마다 표시 폭이 같다(prettier가 다시 맞추지 않는 모양)', () => {
  const text = render([
    job({ seconds: 61 }),
    job({ workflow: 'gates', job: 'evaluate', seconds: 5, pr: null, head: null, offPr: true }),
  ]);
  const wide = (s: string) =>
    [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣＀-｠]/.test(ch) ? 2 : 1), 0);
  const blocks = text
    .trimEnd()
    .split('\n\n')
    .filter((b) => b.startsWith('|'));
  assert.ok(blocks.length >= 5, '표가 다섯 개 이상이다');
  for (const b of blocks) {
    const widths = new Set(b.split('\n').map(wide));
    assert.equal(widths.size, 1, `표의 줄 폭이 다르다:\n${b}`);
  }
  assert.ok(!/[ \t]$/m.test(text), '줄 끝 공백이 없다');
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
});

test('렌더: 허용 목록에 없는 이름은 글자가 무난해도 (기타)로 합쳐진다', () => {
  const jobs = [
    job({ seconds: 61 }),
    // 목록에 없는 워크플로(외부 PR이 더한 파일), 계정 이름처럼 보이는 job
    job({ workflow: 'deploy', job: 'octocat', seconds: 61 }),
    // 아는 워크플로의 모르는 job
    job({ workflow: 'gates', job: 'ignore-rules', seconds: 61 }),
    job({ workflow: 'gates', job: 'evaluate', seconds: 61 }),
  ];
  const text = render(jobs);
  for (const bad of ['deploy', 'octocat', 'ignore-rules']) assert.ok(!text.includes(bad), bad);
  const r = cost(jobs);
  assert.deepEqual(new Map(r.byWorkflow.map((x) => [x.name, x.minutes])).get(OTHER), 2);
  const byJob = new Map(r.byJob.map((x) => [x.name, x.minutes]));
  assert.equal(byJob.get(OTHER), 2);
  assert.equal(byJob.get(`gates / ${OTHER}`), 2);
  assert.equal(byJob.get('gates / evaluate'), 2);
});

test('렌더: 목록에 있어도 글자 조건에 어긋나는 이름은 (기타)다', () => {
  const long = 'a'.repeat(41);
  const known: KnownNames = new Map([
    ['check', new Set(['check', '[x](http://e.test)', 'a\nb', long, 'has space'])],
    ['wf|pipe', new Set(['job'])],
  ]);
  const jobs = [
    job({ job: '[x](http://e.test)', seconds: 61 }),
    job({ job: 'a\nb', seconds: 61 }),
    job({ job: long, seconds: 61 }),
    job({ job: 'has space', seconds: 61 }),
    job({ workflow: 'wf|pipe', job: 'job', seconds: 61 }),
  ];
  const text = render(jobs, known);
  for (const bad of ['http://e.test', 'a\nb', long, 'has space', 'wf|pipe'])
    assert.ok(!text.includes(bad), bad);
  const byJob = new Map(cost(jobs, known).byJob.map((x) => [x.name, x.minutes]));
  assert.equal(byJob.get(`check / ${OTHER}`), 8);
  assert.equal(byJob.get(OTHER), 2);
});

test('knownNamesFrom: 이 리포의 워크플로 파일에서 이름을 읽는다', () => {
  const dir = path.join(HARNESS_ROOT, '.github', 'workflows');
  const files = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));
  const known = knownNamesFrom(files);
  assert.deepEqual([...(known.get('check') ?? [])], ['check']);
  assert.deepEqual([...(known.get('gates') ?? [])].sort(), ['evaluate', 'record', 'selftest']);
  assert.ok(known.get('judge-codex')?.has('judge'));
  assert.ok(!known.has('check.yml'));
});

test('knownNamesFrom: jobs 아래의 키와 name 값만 읽는다', () => {
  const known = knownNamesFrom([
    {
      name: 'build.yaml',
      text: [
        'name: 표시 이름',
        'on:',
        '  push:',
        'env:',
        '  not-a-job:',
        'jobs:',
        '  unit:',
        "    name: 'unit-tests'",
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: step-name',
        '  lint: # 주석',
        '    name: "lint"',
        'other:',
        '  after-jobs:',
      ].join('\n'),
    },
  ]);
  assert.deepEqual([...known.keys()], ['build']);
  assert.deepEqual([...(known.get('build') ?? [])].sort(), ['lint', 'unit', 'unit-tests']);
});

// ---- 보존 기록 ----

/** 돈 job, 돌지 않은 job 세 가지, 목록에 없는 이름, 모르는 라벨, self-hosted, 시도 둘, PR 밖, PR을 찾지 못함, 같은 head의 실행 여럿 */
function mixedJobs(): JobRecord[] {
  return [
    job({ runId: 11, seconds: 425 }),
    job({ runId: 11, attempt: 2, seconds: 61 }),
    job({ runId: 12, workflow: 'gates', job: 'evaluate', seconds: 21 }),
    job({ runId: 12, workflow: 'gates', job: 'selftest', conclusion: 'skipped' }),
    job({ runId: 12, workflow: 'gates', job: 'record', steps: 0 }),
    job({ runId: 13, workflow: 'gates', job: 'record', startedAt: null }),
    job({ runId: 14, workflow: 'evil-workflow', job: 'evil-job', seconds: 70 }),
    job({ runId: 15, workflow: 'gates', job: 'evil-name', seconds: 70 }),
    job({ runId: 16, labels: ['evil-label'], seconds: 100 }),
    job({ runId: 17, labels: ['self-hosted', 'evil-box'], seconds: 100 }),
    job({ runId: 18, pr: null, head: null, offPr: true, event: 'push', seconds: 400 }),
    job({ runId: 19, workflow: 'judge-codex', job: 'plan', pr: null, head: null, seconds: 15 }),
    job({ runId: 20, pr: 9, head: SHA_B, seconds: 59, createdAt: '2026-11-18T03:00:00Z' }),
    job({ runId: 21, pr: 9, head: SHA_B, seconds: 0, createdAt: '2026-11-18T04:00:00Z' }),
  ];
}

test('보존 기록: 보존 기록을 거친 계산이 원래 입력의 계산과 같은 글이다', () => {
  const jobs = mixedJobs();
  const back = fromSaved(toSaved(jobs, KNOWN));
  assert.equal(render(back), render(jobs));
  assert.deepEqual(cost(back), cost(jobs));
  // 파일을 거쳐도 같다
  const parsed = parseSaved(formatSaved(toSaved(jobs, KNOWN), PERIOD));
  assert.deepEqual(parsed.period, PERIOD);
  assert.equal(render(fromSaved(parsed.jobs)), render(jobs));
});

test('보존 기록: SHA, 목록에 없는 이름, 모르는 라벨이 파일에 없다', () => {
  const text = formatSaved(toSaved(mixedJobs(), KNOWN), PERIOD);
  for (const bad of [SHA_A, SHA_B, 'evil', 'pull_request', 'success', 'T01:00'])
    assert.ok(!text.includes(bad), bad);
  const saved = toSaved(mixedJobs(), KNOWN);
  assert.deepEqual(
    saved.find((s) => s.run === 14),
    {
      run: 14,
      attempt: 1,
      workflow: OTHER,
      job: OTHER,
      day: '2026-11-17',
      seconds: 70,
      labels: ['ubuntu-latest'],
      pr: 7,
      head: 1,
      offPr: false,
    },
  );
  assert.equal(saved.find((s) => s.run === 15)?.job, OTHER);
  assert.equal(saved.find((s) => s.run === 15)?.workflow, 'gates');
  assert.equal(saved.find((s) => s.run === 20)?.head, 2);
  assert.equal(saved.find((s) => s.run === 18)?.head, null);
  assert.equal(saved.find((s) => s.run === 13)?.seconds, null);
  assert.equal(saved.find((s) => s.run === 21)?.seconds, 0);
});

test('보존 기록: 바꾼 라벨의 단가 분류가 바꾸기 전과 같다', () => {
  for (const labels of [
    ['ubuntu-latest'],
    ['ubuntu-22.04'],
    ['macos-latest'],
    ['ubuntu-latest', 'gpu'],
    ['self-hosted', 'linux', 'x64'],
    [],
  ]) {
    const [s] = toSaved([job({ labels })], KNOWN);
    assert.deepEqual(runnerRate(s.labels), runnerRate(labels), labels.join(','));
    for (const l of s.labels)
      assert.ok(
        ['ubuntu-latest', 'ubuntu-24.04', 'ubuntu-22.04', 'self-hosted', OTHER].includes(l),
      );
  }
});

test('보존 기록: 형식은 머리 줄과 job마다 한 줄이고 입력 순서와 무관하다', () => {
  const saved = toSaved(mixedJobs(), KNOWN);
  const text = formatSaved(saved, PERIOD);
  assert.equal(formatSaved([...saved].reverse(), PERIOD), text);
  const lines = text.split('\n');
  assert.equal(lines.pop(), '', '마지막 줄도 줄바꿈으로 끝난다');
  assert.equal(lines.length, saved.length + 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    version: 1,
    since: '2026-11-17',
    until: '2026-11-18',
    count: saved.length,
    columns: [
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
    ],
  });
  assert.equal(lines[1], '[11,1,"check","check","2026-11-17",425,["ubuntu-latest"],7,1,false]');
  assert.deepEqual(parseSaved(text), { period: PERIOD, jobs: parseSaved(text).jobs });
  assert.deepEqual(new Set(parseSaved(text).jobs.map((j) => JSON.stringify(j))).size, saved.length);
  assert.equal(formatSaved(parseSaved(text).jobs, PERIOD), text);
});

test('보존 기록: 어긋난 파일은 SourceError다', () => {
  const HEAD =
    '{"version":1,"since":"2026-11-17","until":"2026-11-18","count":1,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}';
  const ROW = '[1,1,"check","check","2026-11-17",61,["ubuntu-latest"],5,1,false]';
  assert.equal(parseSaved(`${HEAD}\n${ROW}\n`).jobs.length, 1);
  const row = (cells: unknown[]) => `${HEAD}\n${JSON.stringify(cells)}\n`;
  const ok: unknown[] = JSON.parse(ROW);
  const set = (i: number, v: unknown) => ok.map((c, k) => (k === i ? v : c));
  const bad: [string, string][] = [
    ['빈 글', ''],
    ['머리 줄뿐인데 count가 1', `${HEAD}\n`],
    ['version이 다름', `${HEAD.replace('"version":1', '"version":2')}\n${ROW}\n`],
    ['columns가 다름', `${HEAD.replace('"run","attempt"', '"attempt","run"')}\n${ROW}\n`],
    ['줄이 하나 더 있음', `${HEAD}\n${ROW}\n${ROW}\n`],
    ['줄이 빠져 count와 다름', `${HEAD.replace('"count":1', '"count":2')}\n${ROW}\n`],
    [
      'since가 날짜가 아님',
      `${HEAD.replace('2026-11-17","until', '2026-13-01","until')}\n${ROW}\n`,
    ],
    [
      'since가 until보다 뒤',
      `${HEAD.replace('"until":"2026-11-18"', '"until":"2026-11-16"')}\n${ROW}\n`,
    ],
    ['머리 줄이 JSON이 아님', `x\n${ROW}\n`],
    ['줄이 배열이 아님', `${HEAD}\n{"run":1}\n`],
    ['배열 길이가 다름', row(ok.slice(0, 9))],
    ['수 자리에 글자열', row(set(0, '1'))],
    ['run이 0', row(set(0, 0))],
    ['attempt가 소수', row(set(1, 1.5))],
    ['seconds가 음수', row(set(5, -1))],
    ['seconds가 소수', row(set(5, 1.5))],
    ['기간 밖의 날짜', row(set(4, '2026-11-19'))],
    ['날짜 꼴이 아닌 day', row(set(4, '2026-11-17T00:00:00Z'))],
    ['글자 조건에 어긋난 워크플로', row(set(2, 'has space'))],
    ['글자 조건에 어긋난 job', row(set(3, '[x](y)'))],
    ['41자 이름', row(set(3, 'a'.repeat(41)))],
    ['정해 둔 것 밖의 라벨', row(set(6, ['macos-latest']))],
    ['labels가 배열이 아님', row(set(6, 'ubuntu-latest'))],
    ['pr이 null인데 head가 있음', row(set(7, null))],
    ['pr이 있는데 offPr이 참', row(set(9, true))],
    ['offPr이 참·거짓이 아님', row(set(9, 0))],
    ['head가 0', row(set(8, 0))],
    ['끝에 남는 글', `${HEAD}\n${ROW}\n남는 글`],
    ['끝에 빈 줄', `${HEAD}\n${ROW}\n\n`],
    ['마지막 줄바꿈 없음', `${HEAD}\n${ROW}`],
  ];
  for (const [what, text] of bad)
    assert.throws(() => parseSaved(text), SourceError, `통과하면 안 된다: ${what}`);
  // (기타)와 null은 받아들인다
  const fine: SavedJob[] = parseSaved(
    row([2, 3, OTHER, OTHER, '2026-11-18', null, [OTHER, 'self-hosted'], null, null, true]),
  ).jobs;
  assert.equal(fine[0].workflow, OTHER);
});

test('보존 기록: 파일의 이름도 계산에서 허용 목록을 다시 거친다', () => {
  // 손으로 고친 파일에 글자 조건은 맞지만 목록에 없는 이름이 들어 있다
  const text =
    '{"version":1,"since":"2026-11-17","until":"2026-11-18","count":1,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}\n' +
    '[1,1,"check","injected-name","2026-11-17",61,["ubuntu-latest"],5,1,false]\n';
  const out = render(fromSaved(parseSaved(text).jobs));
  assert.ok(!out.includes('injected-name'));
  assert.ok(out.includes(`check / ${OTHER}`));
});
