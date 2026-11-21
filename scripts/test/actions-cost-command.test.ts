// actions-cost 명령과 자료 읽기(계획 20261121-actions-cost-design step0). 네트워크를 쓰지 않는다:
// 명령은 가짜 ActionsSource로, 자료 읽기는 주입한 `gh` 실행 함수로 본다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runActionsCost, type ActionsCostOptions } from '../commands/actions-cost.ts';
import type { JobRecord, KnownNames } from '../metrics/actions-cost.ts';
import { ghActionsSource, LOOKBACK_DAYS, type ActionsSource } from '../metrics/actions-source.ts';
import { SourceError, type Period } from '../metrics/source.ts';
import { HARNESS_ROOT, sh, tmp } from './helpers.ts';

const KNOWN: KnownNames = new Map([
  ['check', new Set(['check'])],
  ['judge-codex', new Set(['judge'])],
]);
const DAY = '2026-11-17';
const PERIOD: Period = { since: DAY, until: DAY };
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_MAIN = 'c'.repeat(40);

// ───────────── 명령 ─────────────

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    runId: 1,
    workflow: 'check',
    job: 'check',
    attempt: 1,
    event: 'pull_request',
    createdAt: `${DAY}T00:59:00Z`,
    conclusion: 'success',
    startedAt: `${DAY}T01:00:00Z`,
    completedAt: `${DAY}T01:01:01Z`,
    labels: ['ubuntu-latest'],
    steps: 5,
    pr: 5,
    head: SHA_A,
    offPr: false,
    ...over,
  };
}

/** 부른 횟수를 세는 가짜 자료 원천. `jobs`가 함수면 읽는 도중의 일을 흉내 낸다 */
function fake(jobs: JobRecord[] | (() => JobRecord[])): ActionsSource & { calls: number } {
  const src = {
    calls: 0,
    jobs(): JobRecord[] {
      src.calls++;
      return typeof jobs === 'function' ? jobs() : jobs;
    },
  };
  return src;
}

function run(cwd: string, o: ActionsCostOptions, source?: ActionsSource) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runActionsCost(
    cwd,
    { known: KNOWN, ...o, out: (l) => out.push(l), err: (l) => err.push(l) },
    source,
  );
  return { code, out, err: err.join('\n') };
}

const RECORD_ROW =
  /^\| 2026-11-17~2026-11-17 +\| 2 +\| 2\.0 +\| \$0\.012 +\| 2\.0 +\| \$0\.36 +\|$/m;

test('명령: 성공하면 종료 코드 0이고 표를 한 번 낸다. 파일을 쓰지 않는다', () => {
  const dir = tmp();
  const src = fake([job()]);
  const r = run(dir, { since: DAY, until: DAY }, src);
  assert.equal(r.code, 0, r.err);
  assert.equal(src.calls, 1);
  assert.equal(r.out.length, 1);
  assert.match(r.out[0], RECORD_ROW);
  assert.deepEqual(readdirSync(dir), [], '--save를 주지 않으면 파일을 쓰지 않는다');
});

test('명령: 기간이 틀리면 종료 코드 1이고 자료 원천을 부르지 않는다', () => {
  for (const o of [
    { since: '2026-13-01' },
    { since: '2026-11-20', until: '2026-11-19' },
    { since: 'yesterday' },
  ]) {
    const src = fake([job()]);
    const r = run(tmp(), o, src);
    assert.equal(r.code, 1, JSON.stringify(o));
    assert.equal(src.calls, 0);
    assert.deepEqual(r.out, []);
    assert.match(r.err, /YYYY-MM-DD/);
  }
});

test('명령: 기간의 기본값은 오늘(UTC)까지 7일이다', () => {
  let asked: Period | null = null;
  const src: ActionsSource = {
    jobs(p) {
      asked = p;
      return [];
    },
  };
  const r = run(tmp(), { now: new Date('2026-11-21T03:00:00Z') }, src);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(asked, { since: '2026-11-15', until: '2026-11-21' });
});

test('명령: 자료를 끝까지 읽지 못하면 종료 코드 2이고 표준 출력에 아무것도 내지 않는다', () => {
  const dir = tmp();
  const src = fake(() => {
    throw new SourceError('받은 3건이 total_count 4건과 다르다');
  });
  const r = run(dir, { since: DAY, until: DAY }, src);
  assert.equal(r.code, 2);
  assert.deepEqual(r.out, []);
  assert.match(r.err, /끝까지 읽지 못했다.*total_count/);
});

test('--save: 파일을 쓰고, 그 파일의 --from 출력이 --save 때의 출력과 같다', () => {
  const dir = tmp();
  const jobs = [
    job(),
    job({ runId: 2, workflow: 'judge-codex', job: 'judge', event: 'workflow_run' }),
    job({ runId: 3, workflow: 'secret-name', job: 'x', pr: null, head: null }),
    job({ runId: 4, event: 'push', pr: null, head: null, offPr: true, labels: ['big-runner'] }),
    job({ runId: 5, conclusion: 'skipped', startedAt: null, completedAt: null, steps: 0 }),
  ];
  const saved = run(dir, { since: DAY, until: DAY, save: 'base.jsonl' }, fake(jobs));
  assert.equal(saved.code, 0, saved.err);
  assert.deepEqual(
    readdirSync(dir),
    ['base.jsonl'],
    '그 파일 하나만 쓴다(임시 파일이 남지 않는다)',
  );
  const text = readFileSync(path.join(dir, 'base.jsonl'), 'utf8');
  assert.ok(!text.includes(SHA_A) && !text.includes('secret-name') && !text.includes('big-runner'));

  const src = fake([]);
  const from = run(dir, { from: 'base.jsonl' }, src);
  assert.equal(from.code, 0, from.err);
  assert.equal(src.calls, 0, '--from은 자료 원천을 부르지 않는다');
  assert.deepEqual(from.out, saved.out);
});

test('--save: 파일이 이미 있으면 종료 코드 1이고 읽지 않으며 파일이 그대로다', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'base.jsonl'), '먼저 남긴 기록\n');
  const src = fake([job()]);
  const r = run(dir, { since: DAY, until: DAY, save: 'base.jsonl' }, src);
  assert.equal(r.code, 1);
  assert.equal(src.calls, 0);
  assert.deepEqual(r.out, []);
  assert.equal(readFileSync(path.join(dir, 'base.jsonl'), 'utf8'), '먼저 남긴 기록\n');
  assert.match(r.err, /덮어쓰지 않는다/);
});

test('--save: 둘 폴더가 없으면 종료 코드 1이고 읽지 않는다', () => {
  const src = fake([job()]);
  const r = run(tmp(), { since: DAY, until: DAY, save: 'none/base.jsonl' }, src);
  assert.equal(r.code, 1);
  assert.equal(src.calls, 0);
});

test('--save: 자료 읽기가 실패하면 종료 코드 2이고 파일도 임시 파일도 생기지 않는다', () => {
  const dir = tmp();
  const src = fake(() => {
    throw new SourceError('조회 실패');
  });
  const r = run(dir, { since: DAY, until: DAY, save: 'base.jsonl' }, src);
  assert.equal(r.code, 2);
  assert.deepEqual(r.out, []);
  assert.deepEqual(readdirSync(dir), []);
});

test('--save: 두 저장이 처음 검사를 함께 통과해도 먼저 놓인 파일을 덮어쓰지 않는다', () => {
  const dir = tmp();
  const target = path.join(dir, 'base.jsonl');
  // 이 명령이 읽는 사이에 다른 명령이 같은 경로에 먼저 저장했다
  const src = fake(() => {
    writeFileSync(target, '먼저 끝난 명령의 기록\n');
    return [job()];
  });
  const r = run(dir, { since: DAY, until: DAY, save: 'base.jsonl' }, src);
  assert.equal(src.calls, 1, '처음의 존재 검사는 통과했다');
  assert.equal(r.code, 2);
  assert.deepEqual(r.out, [], '남은 파일과 다른 기록의 값을 내지 않는다');
  assert.equal(readFileSync(target, 'utf8'), '먼저 끝난 명령의 기록\n');
  assert.deepEqual(readdirSync(dir), ['base.jsonl'], '임시 파일이 남지 않는다');
  assert.match(r.err, /덮어쓰지 않았다/);
});

test('--from: --since·--until·--save와 함께 주면 종료 코드 1이다', () => {
  const dir = tmp();
  run(dir, { since: DAY, until: DAY, save: 'base.jsonl' }, fake([job()]));
  for (const o of [{ since: DAY }, { until: DAY }, { save: 'other.jsonl' }]) {
    const src = fake([]);
    const r = run(dir, { from: 'base.jsonl', ...o }, src);
    assert.equal(r.code, 1, JSON.stringify(o));
    assert.deepEqual(r.out, []);
    assert.equal(src.calls, 0);
  }
  assert.deepEqual(readdirSync(dir), ['base.jsonl']);
});

test('--from: 없는 파일과 형식이 어긋난 파일은 종료 코드 2이고 값을 내지 않는다', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'bad.jsonl'), 'x\n');
  for (const from of ['none.jsonl', 'bad.jsonl']) {
    const r = run(dir, { from });
    assert.equal(r.code, 2, from);
    assert.deepEqual(r.out, []);
    assert.match(r.err, /보존 기록을 읽지 못했다/);
  }
});

test('--from: 파일에 적힌 이름도 체크아웃의 허용 목록을 다시 거친다', () => {
  const dir = tmp();
  const head =
    '{"version":1,"since":"2026-11-17","until":"2026-11-17","count":1,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}';
  writeFileSync(
    path.join(dir, 'edited.jsonl'),
    `${head}\n[1,1,"injected","name","2026-11-17",61,["ubuntu-latest"],5,1,false]\n`,
  );
  const r = run(dir, { from: 'edited.jsonl' });
  assert.equal(r.code, 0, r.err);
  assert.ok(!r.out[0].includes('injected'));
  assert.match(r.out[0], /\(기타\)/);
});

test('명령: 허용 목록을 주지 않으면 체크아웃의 워크플로 파일에서 만든다', () => {
  const src = fake([job(), job({ runId: 2, workflow: 'not-a-workflow', job: 'check' })]);
  const out: string[] = [];
  const code = runActionsCost(
    HARNESS_ROOT,
    { since: DAY, until: DAY, out: (l) => out.push(l), err: () => {} },
    src,
  );
  assert.equal(code, 0);
  assert.match(out[0], /^\| check +\|/m);
  assert.ok(!out[0].includes('not-a-workflow'));
});

test('명령: 가짜 GitHub(HARNESS_FAKE_GH)에서는 실제 gh를 부르지 않고 종료 코드 2다', () => {
  const saved = process.env.HARNESS_FAKE_GH;
  process.env.HARNESS_FAKE_GH = path.join(tmp(), 'fake-gh.json');
  try {
    const out: string[] = [];
    const err: string[] = [];
    const code = runActionsCost(HARNESS_ROOT, {
      since: DAY,
      until: DAY,
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    });
    assert.equal(code, 2);
    assert.deepEqual(out, []);
    assert.match(err.join('\n'), /HARNESS_FAKE_GH/);
  } finally {
    if (saved === undefined) delete process.env.HARNESS_FAKE_GH;
    else process.env.HARNESS_FAKE_GH = saved;
  }
});

test('harness.ts: actions-cost가 등록돼 있고 --from을 넘긴다', () => {
  const dir = tmp();
  const head =
    '{"version":1,"since":"2026-11-17","until":"2026-11-17","count":1,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}';
  const file = path.join(dir, 'one.jsonl');
  writeFileSync(
    file,
    `${head}\n[1,1,"check","check","2026-11-17",61,["ubuntu-latest"],5,1,false]\n`,
  );
  const out = sh('node', ['scripts/harness.ts', 'actions-cost', '--from', file], HARNESS_ROOT);
  assert.match(out, RECORD_ROW);
  assert.match(sh('node', ['scripts/harness.ts', '--help'], HARNESS_ROOT), /actions-cost/);
});

// ───────────── 자료 읽기 ─────────────

interface RunFx {
  id: number;
  path?: string;
  event?: string;
  branch?: string | null;
  headSha?: string;
  createdAt?: string;
  /** 주지 않으면 만들어진 때와 같다 */
  updatedAt?: string;
}
interface JobFx {
  id: number;
  name?: string;
  attempt?: number | null;
  conclusion?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  labels?: string[];
  steps?: number;
}
interface Fx {
  /** 날짜 → 그 날 만들어진 실행 */
  runs?: Record<string, RunFx[]>;
  /** 실행 번호 → job */
  jobs?: Record<number, JobFx[]>;
  /** 커밋 → 이어진 PR */
  pulls?: Record<string, { number: number; head: string | null }[]>;
  /** 커밋 → 커밋 상태의 target_url */
  statuses?: Record<string, (string | null)[]>;
  /** 경로의 일부가 맞으면 이 응답을 그대로 준다(Error면 조회 실패) */
  raw?: [string, string | Error][];
}

const runUrl = (id: number) => `https://github.com/o/r/actions/runs/${id}/job/9`;
const withTotal = (items: object[], total = items.length) =>
  [{ total }, ...items].map((v) => JSON.stringify(v)).join('\n');

/** `gh api --paginate repos/{owner}/{repo}/<경로> --jq <식>`의 표준 출력(jq를 거친 줄)을 흉내 낸다 */
function fakeGh(fx: Fx) {
  const calls: string[] = [];
  const gh = (args: string[]): string => {
    assert.deepEqual(
      [args[0], args[1], args[3]],
      ['api', '--paginate', '--jq'],
      '읽기 호출만 한다',
    );
    const prefix = 'repos/{owner}/{repo}/';
    assert.ok(args[2].startsWith(prefix));
    const p = args[2].slice(prefix.length);
    calls.push(p);
    for (const [part, res] of fx.raw ?? [])
      if (p.includes(part)) {
        if (res instanceof Error) throw res;
        return res;
      }
    let m: RegExpExecArray | null;
    if ((m = /^actions\/runs\?created=([0-9-]+)&per_page=100$/.exec(p))) {
      const day = m[1];
      return withTotal(
        (fx.runs?.[day] ?? []).map((r) => ({
          id: r.id,
          path: r.path ?? '.github/workflows/check.yml',
          event: r.event ?? 'pull_request',
          branch: r.branch === undefined ? 'feat/x' : r.branch,
          headSha: r.headSha ?? SHA_A,
          createdAt: r.createdAt ?? `${day}T01:00:00Z`,
          updatedAt: r.updatedAt ?? r.createdAt ?? `${day}T01:00:00Z`,
        })),
      );
    }
    if ((m = /^actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/.exec(p)))
      return withTotal(
        (fx.jobs?.[Number(m[1])] ?? []).map((j) => ({
          id: j.id,
          name: j.name ?? 'check',
          attempt: j.attempt === undefined ? 1 : j.attempt,
          conclusion: j.conclusion === undefined ? 'success' : j.conclusion,
          startedAt: j.startedAt === undefined ? `${DAY}T01:00:00Z` : j.startedAt,
          completedAt: j.completedAt === undefined ? `${DAY}T01:00:30Z` : j.completedAt,
          labels: j.labels ?? ['ubuntu-latest'],
          steps: j.steps ?? 4,
        })),
      );
    if ((m = /^commits\/([0-9a-f]{40})\/pulls\?per_page=100$/.exec(p)))
      return (fx.pulls?.[m[1]] ?? []).map((v) => JSON.stringify(v)).join('\n');
    if ((m = /^commits\/([0-9a-f]{40})\/statuses\?per_page=100$/.exec(p)))
      return (fx.statuses?.[m[1]] ?? [])
        .map((url, i) => JSON.stringify({ id: i + 1, url }))
        .join('\n');
    throw new Error(`가짜 gh가 모르는 경로: ${p}`);
  };
  return { gh, calls };
}

function read(fx: Fx, period: Period = PERIOD) {
  const f = fakeGh(fx);
  const src = ghActionsSource({ cwd: tmp(), gh: f.gh, defaultBranch: 'main' });
  return { jobs: src.jobs(period), calls: f.calls };
}

/** 자료 읽기가 SourceError로 끝나고, 같은 응답에서 명령이 종료 코드 2로 끝나며 표준 출력이 비어 있다 */
function assertUnreadable(fx: Fx, pattern: RegExp) {
  assert.throws(
    () => read(fx),
    (e: unknown) => e instanceof SourceError && pattern.test(e.message),
  );
  const r = run(
    tmp(),
    { since: DAY, until: DAY },
    ghActionsSource({ cwd: tmp(), gh: fakeGh(fx).gh, defaultBranch: 'main' }),
  );
  assert.equal(r.code, 2);
  assert.deepEqual(r.out, []);
}

/** PR 5의 head A에서 돈 `check` 실행 하나 */
const ONE: Fx = {
  runs: { [DAY]: [{ id: 10 }] },
  jobs: { 10: [{ id: 100 }] },
  pulls: { [SHA_A]: [{ number: 5, head: SHA_A }] },
};

test('자료 읽기: 실행과 job을 읽어 PR과 head에 잇는다', () => {
  const { jobs, calls } = read(ONE);
  assert.deepEqual(jobs, [
    {
      runId: 10,
      workflow: 'check',
      job: 'check',
      attempt: 1,
      event: 'pull_request',
      createdAt: `${DAY}T01:00:00Z`,
      conclusion: 'success',
      startedAt: `${DAY}T01:00:00Z`,
      completedAt: `${DAY}T01:00:30Z`,
      labels: ['ubuntu-latest'],
      steps: 4,
      pr: 5,
      head: SHA_A,
      offPr: false,
    },
  ]);
  assert.ok(calls.includes(`actions/runs?created=${DAY}&per_page=100`), '날짜별로 읽는다');
  assert.ok(calls.includes('actions/runs/10/jobs?filter=all&per_page=100'), '모든 시도를 받는다');
  assert.ok(calls.includes(`commits/${SHA_A}/pulls?per_page=100`));
});

test('자료 읽기: 쪽을 넘긴 응답(쪽마다 같은 total_count)을 이어 읽는다', () => {
  const page = (id: number) =>
    JSON.stringify({
      id,
      path: '.github/workflows/check.yml',
      event: 'pull_request',
      branch: 'feat/x',
      headSha: SHA_A,
      createdAt: `${DAY}T01:00:00Z`,
      updatedAt: `${DAY}T01:05:00Z`,
    });
  const { jobs } = read({
    ...ONE,
    raw: [
      [`created=${DAY}`, ['{"total":2}', page(10), '{"total":2}', page(11)].join('\n')],
      [
        'runs/11/jobs',
        [
          '{"total":2}',
          '{"id":110,"name":"check","attempt":1,"conclusion":"success","startedAt":null,"completedAt":null,"labels":["ubuntu-latest"],"steps":0}',
          '{"total":2}',
          '{"id":111,"name":"check","attempt":2,"conclusion":"success","startedAt":null,"completedAt":null,"labels":["ubuntu-latest"],"steps":0}',
        ].join('\n'),
      ],
    ],
  });
  assert.deepEqual(
    jobs.map((j) => [j.runId, j.attempt]),
    [
      [10, 1],
      [11, 1],
      [11, 2],
    ],
  );
});

test('자료 읽기: 일부만 다시 실행한 실행은 job마다 시도 번호가 다르다', () => {
  const { jobs } = read({
    ...ONE,
    jobs: {
      10: [
        { id: 100, name: 'plan', attempt: 1 },
        { id: 101, name: 'judge', attempt: 1 },
        { id: 102, name: 'judge', attempt: 2 },
      ],
    },
  });
  assert.deepEqual(
    jobs.map((j) => [j.job, j.attempt]),
    [
      ['plan', 1],
      ['judge', 1],
      ['judge', 2],
    ],
  );
});

test('자료 읽기: 다 읽었는지 알 수 없는 실행 목록은 SourceError다', () => {
  const item = (id: number) => ({
    id,
    path: '.github/workflows/check.yml',
    event: 'pull_request',
    branch: 'feat/x',
    headSha: SHA_A,
    createdAt: `${DAY}T01:00:00Z`,
    updatedAt: `${DAY}T01:05:00Z`,
  });
  const line = (id: number) => JSON.stringify(item(id));
  // 받은 수가 total_count와 다르다
  assertUnreadable(
    { ...ONE, raw: [[`created=${DAY}`, withTotal([item(10)], 2)]] },
    /total_count 2건과 다르다/,
  );
  // 쪽마다 온 total_count가 서로 다르다
  assertUnreadable(
    {
      ...ONE,
      raw: [[`created=${DAY}`, ['{"total":2}', line(10), '{"total":3}', line(11)].join('\n')]],
    },
    /total_count를 하나로 읽지 못했다/,
  );
  // 받은 수는 맞지만 같은 실행이 두 번 왔다(다른 실행이 빠졌다)
  assertUnreadable(
    { ...ONE, raw: [[`created=${DAY}`, ['{"total":2}', line(10), line(10)].join('\n')]] },
    /중복/,
  );
  // 조회 상한
  assertUnreadable(
    {
      ...ONE,
      raw: [[`created=${DAY}`, withTotal(Array.from({ length: 1000 }, (_, i) => item(i + 1)))]],
    },
    /조회 상한\(1000건\)/,
  );
  // 다른 날에 만들어진 실행이 섞여 왔다
  assertUnreadable(
    { ...ONE, runs: { [DAY]: [{ id: 10, createdAt: '2026-11-18T00:00:01Z' }] } },
    /다른 날에 만들어진 실행/,
  );
  // 조회 실패
  assertUnreadable(
    { ...ONE, raw: [[`created=${DAY}`, new Error('gh api 종료 코드 1: HTTP 502')]] },
    /실행 목록을\(를\) 읽지 못했다: .*502/,
  );
  // head 찾기용으로 읽는 기간 전의 목록도 같은 검사를 거친다
  assertUnreadable(
    { ...ONE, raw: [['created=2026-11-16', withTotal([], 1)]] },
    /2026-11-16의 Actions 실행 목록.*total_count 1건과 다르다/,
  );
});

test('자료 읽기: 다 읽었는지 알 수 없는 job 목록은 SourceError다', () => {
  const j = (id: number, attempt: unknown = 1) =>
    JSON.stringify({
      id,
      name: 'check',
      attempt,
      conclusion: 'success',
      startedAt: null,
      completedAt: null,
      labels: ['ubuntu-latest'],
      steps: 0,
    });
  assertUnreadable(
    { ...ONE, raw: [['runs/10/jobs', ['{"total":3}', j(100), j(101)].join('\n')]] },
    /실행 10의 job 목록.*total_count 3건과 다르다/,
  );
  assertUnreadable(
    { ...ONE, raw: [['runs/10/jobs', ['{"total":2}', j(100), j(100)].join('\n')]] },
    /중복/,
  );
  // run_attempt가 없는 job: 실행의 최신 시도 번호로 채우지 않는다
  assertUnreadable(
    { ...ONE, jobs: { 10: [{ id: 100, attempt: null }] } },
    /run_attempt가 없는 job/,
  );
  assertUnreadable(
    { ...ONE, raw: [['runs/10/jobs', ['{"total":1}', j(100, '2')].join('\n')]] },
    /run_attempt가 없는 job/,
  );
  assertUnreadable(
    { ...ONE, raw: [['runs/10/jobs', new Error('timeout')]] },
    /job 목록을\(를\) 읽지 못했다: timeout/,
  );
  // 같은 job이 두 실행의 목록에 왔다
  assertUnreadable(
    {
      runs: { [DAY]: [{ id: 10 }, { id: 11 }] },
      jobs: { 10: [{ id: 100 }], 11: [{ id: 100 }] },
      pulls: ONE.pulls,
    },
    /job 100이\(가\) 두 실행의 목록에 왔다/,
  );
});

test('PR 찾기: 커밋에 이어진 PR이 하나면 그 번호다(실행 기록의 PR 목록은 쓰지 않는다)', () => {
  const { jobs, calls } = read(ONE);
  assert.deepEqual([jobs[0].pr, jobs[0].head], [5, SHA_A]);
  assert.ok(
    calls.every((c) => !c.includes('pull_requests')),
    '실행 기록의 PR 목록을 묻지 않는다',
  );
});

test('PR 찾기: 여럿이면 지금 head가 그 커밋인 PR이 하나일 때만 잇는다', () => {
  const one = read({
    ...ONE,
    pulls: {
      [SHA_A]: [
        { number: 5, head: SHA_B },
        { number: 6, head: SHA_A },
      ],
    },
  });
  assert.deepEqual([one.jobs[0].pr, one.jobs[0].head], [6, SHA_A]);

  for (const pulls of [
    // 가릴 수 없다: 둘 다 head가 그 커밋이다
    [
      { number: 5, head: SHA_A },
      { number: 6, head: SHA_A },
    ],
    // 가릴 수 없다: 어느 것도 head가 그 커밋이 아니다
    [
      { number: 5, head: SHA_B },
      { number: 6, head: SHA_B },
    ],
    // 없다
    [],
  ]) {
    const { jobs } = read({ ...ONE, pulls: { [SHA_A]: pulls } });
    assert.deepEqual([jobs[0].pr, jobs[0].head, jobs[0].offPr], [null, null, false]);
    assert.equal(jobs.length, 1, '찾지 못한 실행도 버리지 않는다');
  }
});

test('PR 찾기: workflow_run 실행은 PR head의 커밋 상태가 가리키는 실행 번호로 잇는다', () => {
  const fx: Fx = {
    runs: {
      [DAY]: [
        { id: 10, headSha: SHA_A },
        { id: 11, headSha: SHA_B },
        // 판정 실행: head_sha는 main의 커밋이다
        {
          id: 20,
          event: 'workflow_run',
          headSha: SHA_MAIN,
          branch: 'main',
          path: 'x/judge-codex.yml',
        },
        { id: 21, event: 'workflow_run', headSha: SHA_MAIN, branch: 'main' },
        { id: 22, event: 'workflow_run', headSha: SHA_MAIN, branch: 'main' },
      ],
    },
    jobs: {
      10: [{ id: 100 }],
      11: [{ id: 110 }],
      20: [{ id: 200 }],
      21: [{ id: 210 }],
      22: [{ id: 220 }],
    },
    pulls: { [SHA_A]: [{ number: 5, head: SHA_A }], [SHA_B]: [{ number: 6, head: SHA_B }] },
    statuses: {
      // 20은 A만, 21은 두 head가 가리킨다, 22는 아무도 가리키지 않는다
      [SHA_A]: [runUrl(20), runUrl(21), null, 'https://example.com/other'],
      [SHA_B]: [runUrl(21), runUrl(20).replace('/20/', '/2000/')],
    },
  };
  const { jobs, calls } = read(fx);
  const at = (run: number) => {
    const j = jobs.find((x) => x.runId === run)!;
    return [j.pr, j.head, j.offPr];
  };
  assert.deepEqual(at(20), [5, SHA_A, false]);
  assert.equal(jobs.find((x) => x.runId === 20)!.workflow, 'judge-codex');
  assert.deepEqual(at(21), [null, null, false], '두 head의 상태가 가리키는 실행은 잇지 않는다');
  assert.deepEqual(at(22), [null, null, false], '어느 상태도 가리키지 않는 실행');
  assert.ok(
    !calls.includes(`commits/${SHA_MAIN}/pulls?per_page=100`),
    'workflow_run의 head_sha(main 커밋)로 PR을 찾지 않는다',
  );
});

test('PR 찾기: 기본 브랜치의 push 실행만 PR 밖이다', () => {
  const { jobs } = read({
    runs: {
      [DAY]: [
        { id: 10 },
        { id: 30, event: 'push', branch: 'main', headSha: SHA_MAIN },
        // PR head와 같은 커밋의 push 실행은 PR에 잇지 않는다
        { id: 31, event: 'push', branch: 'feat/x', headSha: SHA_A },
        { id: 32, event: 'schedule', branch: 'main', headSha: SHA_MAIN },
      ],
    },
    jobs: { 10: [{ id: 100 }], 30: [{ id: 300 }], 31: [{ id: 310 }], 32: [{ id: 320 }] },
    pulls: ONE.pulls,
  });
  assert.deepEqual(
    jobs.map((j) => [j.runId, j.pr, j.offPr]),
    [
      [10, 5, false],
      [30, null, true],
      [31, null, false],
      [32, null, false],
    ],
  );
});

test('PR 찾기: PR 조회와 상태 조회의 실패는 "찾지 못함"이 아니라 오류다', () => {
  assertUnreadable(
    { ...ONE, raw: [[`commits/${SHA_A}/pulls`, new Error('HTTP 500')]] },
    /이어진 PR을\(를\) 읽지 못했다: HTTP 500/,
  );
  assertUnreadable(
    { ...ONE, raw: [[`commits/${SHA_A}/statuses`, new Error('HTTP 403')]] },
    /커밋 상태을\(를\) 읽지 못했다: HTTP 403/,
  );
  assertUnreadable({ ...ONE, raw: [[`commits/${SHA_A}/pulls`, 'not json']] }, /읽지 못했다/);
});

/** 기간 첫날에 만들어진 판정 실행 20과, 그것을 가리키는 head A의 상태 */
const JUDGE_IN_PERIOD = {
  jobs: { 20: [{ id: 200 }] },
  pulls: { [SHA_A]: [{ number: 5, head: SHA_A }] },
  statuses: { [SHA_A]: [runUrl(20)] },
};
const judgeRun: RunFx = { id: 20, event: 'workflow_run', headSha: SHA_MAIN, branch: 'main' };
const listCalls = (calls: string[]) => calls.filter((c) => c.startsWith('actions/runs?created='));

test('PR 찾기: 원본 실행이 기간 전에 만들어진 판정 실행도 잇는다(청구에는 넣지 않는다)', () => {
  const before = '2026-11-16';
  const { jobs, calls } = read({
    ...JUDGE_IN_PERIOD,
    runs: {
      // 원본 check는 기간 전날 23시대에 만들어져 자정 직전에 끝났다
      [before]: [
        {
          id: 9,
          headSha: SHA_A,
          createdAt: `${before}T23:40:00Z`,
          updatedAt: `${before}T23:59:58Z`,
        },
      ],
      // 판정 실행은 check가 끝난 뒤, 기간 첫날에 만들어졌다
      [DAY]: [judgeRun],
    },
    jobs: { 9: [{ id: 90 }], 20: [{ id: 200 }] },
  });
  assert.deepEqual(
    jobs.map((j) => [j.runId, j.pr, j.head]),
    [[20, 5, SHA_A]],
    '전날의 실행은 돌려준 job에 없다',
  );
  assert.ok(!calls.some((c) => c.startsWith('actions/runs/9/')), '전날 실행의 job은 읽지 않는다');
});

test('PR 찾기: 오래전에 만들어져 기간 안에 다시 실행된 원본 실행의 head도 후보다', () => {
  const old = '2026-10-08'; // 기간 시작 40일 전
  const { jobs } = read({
    ...JUDGE_IN_PERIOD,
    runs: {
      // 다시 실행해도 created_at은 처음 그대로이고 updated_at만 바뀐다
      [old]: [
        { id: 9, headSha: SHA_A, createdAt: `${old}T12:00:00Z`, updatedAt: `${DAY}T03:00:00Z` },
      ],
      [DAY]: [judgeRun],
    },
  });
  assert.deepEqual([jobs[0].pr, jobs[0].head], [5, SHA_A]);
});

test('PR 찾기: 기간 시작 하루 전보다 앞서 끝난 실행의 head는 후보가 아니다', () => {
  const day = '2026-11-14';
  const fx = (updatedAt: string): Fx => ({
    ...JUDGE_IN_PERIOD,
    runs: {
      [day]: [{ id: 9, headSha: SHA_A, createdAt: `${day}T12:00:00Z`, updatedAt }],
      [DAY]: [judgeRun],
    },
  });
  // 여유 하루의 경계: 기간 시작 하루 전의 0시
  assert.deepEqual([read(fx('2026-11-16T00:00:00Z')).jobs[0].pr], [5]);
  const ended = read(fx('2026-11-15T23:59:59Z'));
  assert.deepEqual([ended.jobs[0].pr, ended.jobs[0].head], [null, null]);
  assert.ok(
    !ended.calls.some((c) => c.startsWith('commits/')),
    '후보가 아닌 head는 PR 조회도 상태 조회도 하지 않는다',
  );
});

test('PR 찾기: 며칠 전에 push된 head를 기간 안에 리뷰해 돈 게이트는 review-trigger 실행으로 잇는다', () => {
  const { jobs } = read({
    runs: {
      [DAY]: [
        // 리뷰로 시작한 실행의 head_sha도 PR head다. 그 head의 push 때 돈 실행은 조건 밖이다
        { id: 40, event: 'pull_request_review', headSha: SHA_A, path: 'x/review-trigger.yml' },
        { id: 41, event: 'workflow_run', headSha: SHA_MAIN, branch: 'main', path: 'x/gates.yml' },
      ],
      '2026-11-12': [
        {
          id: 9,
          headSha: SHA_A,
          createdAt: '2026-11-12T10:00:00Z',
          updatedAt: '2026-11-12T10:20:00Z',
        },
      ],
    },
    jobs: { 40: [{ id: 400, name: 'trigger' }], 41: [{ id: 410, name: 'evaluate' }] },
    pulls: { [SHA_A]: [{ number: 5, head: SHA_A }] },
    statuses: { [SHA_A]: [runUrl(41)] },
  });
  assert.deepEqual(
    jobs.map((j) => [j.runId, j.workflow, j.pr, j.head]),
    [
      [40, 'review-trigger', 5, SHA_A],
      [41, 'gates', 5, SHA_A],
    ],
  );
});

test(`PR 찾기: 기간 전의 실행 목록은 ${LOOKBACK_DAYS}일을 읽고 그보다 앞선 날은 읽지 않는다`, () => {
  // GitHub의 한도(다시 실행 30일 + 실행 하나 35일)에 여유 하루
  assert.equal(LOOKBACK_DAYS, 66);
  const two: Period = { since: DAY, until: '2026-11-18' };
  const { calls } = read({ ...JUDGE_IN_PERIOD, runs: { [DAY]: [judgeRun] } }, two);
  const days = listCalls(calls).map((c) => /created=([0-9-]+)/.exec(c)![1]);
  assert.equal(days.length, 2 + 66);
  assert.equal(new Set(days).size, days.length);
  assert.ok(days.includes('2026-09-12'), '66일 전');
  assert.ok(!days.includes('2026-09-11'), '67일 전은 읽지 않는다');
});

test('자료 읽기: GitHub에 쓰는 호출이 없다', () => {
  const text = readFileSync(path.join(HARNESS_ROOT, 'scripts/metrics/actions-source.ts'), 'utf8');
  assert.ok(!/-X|--method|-f |--field|rerun|POST|PATCH|PUT|DELETE/.test(text));
});
