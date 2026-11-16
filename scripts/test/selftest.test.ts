// 하네스 자체 테스트 실행기(scripts/selftest/run.ts, 설계서 12.4절) 테스트. 계획 20261116-ops-transition step1·2.
// (1) 이 리포의 하네스는 모든 시나리오를 통과한다. (2) 약화된 하네스에서는 해당 시나리오가 실패한다.
// (3) 실행기: 시나리오 하나가 예외로 끝나도 나머지를 돌린다, --only, 자격증명을 자식 프로세스에 넘기지 않는다.
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { formatSelfTest, runSelfTest, type SelfTestReport } from '../selftest/run.ts';
import { HARNESS_ROOT, tmp, write } from './helpers.ts';

const IDS = [
  'f92-switch-stop',
  'flow-full',
  'mcp-guard',
  'r1-plan-gate',
  'r13-db',
  'r20-owner-commands',
  'r4-bypass',
  'r45-runner',
  's1-next-task',
];

/** 대상 하네스로 쓸 사본(실행기가 샘플 리포에 복사하는 파일들) */
function copyHarness(): string {
  const dir = tmp('harness-selftest-copy-');
  for (const rel of [
    'scripts',
    '.claude/settings.json',
    '.claude/runner-settings.json',
    '.gitattributes',
    'harness.config.json',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/exec-plans/TEMPLATE.md',
    'docs/exec-plans/TEMPLATE-small.md',
    'docs/exec-plans/TEMPLATE-step.md',
    'docs/exec-plans/tech-debt-tracker.md',
    'docs/harness/workflow.md',
  ])
    cpSync(path.join(HARNESS_ROOT, rel), path.join(dir, rel), { recursive: true });
  return dir;
}

/** 사본의 파일에서 `from`(정확히 `count`번 있어야 한다)을 `to`로 바꾼다 */
function weaken(dir: string, rel: string, from: string, to: string, count: number): void {
  const f = path.join(dir, rel);
  const text = readFileSync(f, 'utf8');
  assert.equal(text.split(from).length - 1, count, `${rel}에서 "${from}"의 개수가 다르다`);
  writeFileSync(f, text.replaceAll(from, to));
}

/** 이 리포의 CLI로 self-test를 돌려 종료 코드와 보고서를 돌려준다 */
function selfTestCli(args: string[]): { code: number; report: SelfTestReport; stdout: string } {
  const out = path.join(tmp('harness-selftest-out-'), 'report.json');
  const r = runSync(
    process.execPath,
    [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'self-test', ...args, '--out', out],
    { cwd: HARNESS_ROOT, timeoutMs: 600_000 },
  );
  return {
    code: r.code,
    report: JSON.parse(readFileSync(out, 'utf8')) as SelfTestReport,
    stdout: r.stdout,
  };
}

test('self-test: 이 리포의 하네스는 모든 시나리오를 통과한다', async () => {
  const r = await runSelfTest({ harness: HARNESS_ROOT, headSha: 'a'.repeat(40) });
  assert.equal(r.version, 1);
  assert.equal(r.headSha, 'a'.repeat(40));
  assert.deepEqual(
    r.results.map((x) => [x.id, x.state]),
    IDS.map((id) => [id, 'pass']),
    formatSelfTest(r).join('\n'),
  );
  assert.deepEqual(r.results.map((x) => x.covers).sort(), [
    '4.5',
    '9.2',
    'R1',
    'R13',
    'R14',
    'R20',
    'R4',
    'S1',
    '전체 흐름',
  ]);
});

test('self-test: MCP 규칙을 판정하지 않거나 MCP 도구를 훅에 걸지 않는 하네스에서는 mcp-guard 시나리오가 실패한다', () => {
  const noRule = copyHarness();
  weaken(
    noRule,
    'scripts/hooks/rules.ts',
    "if (input.kind === 'mcp') return evaluateMcp(input, ctx);",
    '',
    1,
  );
  const a = selfTestCli(['--harness', noRule, '--only', 'mcp-guard']);
  assert.equal(a.code, 1);
  assert.deepEqual(
    a.report.results.map((x) => [x.id, x.state]),
    [['mcp-guard', 'fail']],
  );
  assert.match(a.report.results[0].detail, /훅 종료 코드가 2가 아니다\(0\)/);

  const noMatcher = copyHarness();
  weaken(noMatcher, '.claude/settings.json', '|mcp__.*"', '"', 1);
  const b = selfTestCli(['--harness', noMatcher, '--only', 'mcp-guard']);
  assert.equal(b.code, 1);
  assert.match(b.report.results[0].detail, /mcp__ 도구를 훅에 걸지 않는다/);
});

test('self-test: 훅이 종료 코드 1로 끝나는(경고만 하는) 하네스에서는 R20 시나리오가 실패하고 CLI가 1로 끝난다', () => {
  const copy = copyHarness();
  weaken(copy, 'scripts/hooks/guard.ts', 'process.exit(2)', 'process.exit(1)', 2);
  const r = selfTestCli(['--harness', copy, '--only', 'r20-owner-commands']);
  assert.equal(r.code, 1);
  assert.deepEqual(
    r.report.results.map((x) => [x.id, x.state]),
    [['r20-owner-commands', 'fail']],
  );
  assert.match(r.report.results[0].detail, /훅 종료 코드가 2가 아니다\(1\)/);
  assert.match(r.stdout, /^✗ r20-owner-commands \(R20\) — /m);
  assert.match(r.stdout, /self-test: 실패 1건/);
});

test('self-test: plan-gate가 항상 통과하는 하네스에서는 R1 시나리오가 실패하고 CLI가 1로 끝난다', () => {
  const copy = copyHarness();
  weaken(copy, 'scripts/harness.ts', 'return r.problems.length ? 1 : 0;', 'return 0;', 1);
  const r = selfTestCli(['--harness', copy, '--only', 'r1-plan-gate']);
  assert.equal(r.code, 1);
  assert.deepEqual(
    r.report.results.map((x) => [x.id, x.state]),
    [['r1-plan-gate', 'fail']],
  );
  assert.match(r.report.results[0].detail, /plan-gate가 통과했다/);
});

test('self-test: runner가 AC 결과를 보지 않는(세션의 "완료"를 믿는) 하네스에서는 4.5절 시나리오가 실패한다', () => {
  const copy = copyHarness();
  weaken(copy, 'scripts/runner/run.ts', 'const pass = r.code === 0;', 'const pass = true;', 1);
  const r = selfTestCli(['--harness', copy, '--only', 'r45-runner']);
  assert.equal(r.code, 1);
  assert.deepEqual(
    r.report.results.map((x) => [x.id, x.state]),
    [['r45-runner', 'fail']],
    r.report.results[0].detail,
  );
  assert.match(r.report.results[0].detail, /AC 실패를 보지 않고 step을 넘겼다/);
});

test('self-test CLI: --only로 고른 시나리오만 돌리고, 통과하면 0이다. 없는 id는 2다', () => {
  const r = selfTestCli(['--only', 'r20-owner-commands', '--head-sha', 'b'.repeat(40)]);
  assert.equal(r.code, 0);
  assert.equal(r.report.headSha, 'b'.repeat(40));
  assert.deepEqual(
    r.report.results.map((x) => [x.id, x.state]),
    [['r20-owner-commands', 'pass']],
  );
  assert.match(r.stdout, /^✓ r20-owner-commands \(R20\) — /m);
  const bad = runSync(
    process.execPath,
    [
      path.join(HARNESS_ROOT, 'scripts/harness.ts'),
      'self-test',
      '--only',
      'r20-owner-commands,nope',
    ],
    { cwd: HARNESS_ROOT },
  );
  // 없는 id를 건너뛰면 "0개 실행, 통과"가 될 수 있다
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /없는 시나리오: nope/);
});

/** 실행기만 시험하는 가짜 하네스: CLI가 받은 환경 변수를 그대로 출력한다 */
function echoHarness(): string {
  const dir = tmp('harness-selftest-echo-');
  write(dir, 'harness.config.json', JSON.stringify({ github: { owner: 'maker', bot: 'bot' } }));
  write(
    dir,
    'scripts/harness.ts',
    'console.log(JSON.stringify({ env: process.env, cwd: process.cwd() }));\n',
  );
  return dir;
}

const SCENARIO = (id: string, body: string) =>
  `import assert from 'node:assert/strict';\nexport default { id: '${id}', covers: 'T', title: '${id} 통과', run(ctx) {\n${body}\n} };\n`;

test('runSelfTest: 시나리오 하나가 예외로 끝나도 나머지를 돌린다(assert는 fail, 그 밖은 error)', async () => {
  const dir = tmp('harness-selftest-scn-');
  write(
    dir,
    'a-throws.ts',
    SCENARIO('a-throws', `throw new Error('첫 줄\\n둘째 줄 ' + 'x'.repeat(2000));`),
  );
  write(dir, 'b-asserts.ts', SCENARIO('b-asserts', `assert.equal(1, 2, '기대와 다르다');`));
  write(dir, 'c-passes.ts', SCENARIO('c-passes', ''));
  write(dir, 'd-wrong-id.ts', SCENARIO('other-id', ''));
  write(dir, 'e-broken.ts', 'export default 1;\n');
  write(dir, 'notes.md', '시나리오가 아닌 파일은 읽지 않는다\n');
  const r = await runSelfTest({ harness: echoHarness(), scenarioDir: dir });
  assert.deepEqual(
    r.results.map((x) => [x.id, x.state]),
    [
      ['a-throws', 'error'],
      ['b-asserts', 'fail'],
      ['c-passes', 'pass'],
      ['d-wrong-id', 'error'],
      ['e-broken', 'error'],
    ],
  );
  // detail은 한 줄 500자 이내다
  const [a, b, , d] = r.results;
  assert.match(a.detail, /^첫 줄 둘째 줄 x+$/);
  assert.equal(a.detail.length, 500);
  assert.match(b.detail, /기대와 다르다/);
  assert.match(d.detail, /id\(other-id\)가 파일 이름\(d-wrong-id\)과 다르다/);
  assert.deepEqual(
    (
      await runSelfTest({ harness: echoHarness(), scenarioDir: dir, only: ['c-passes'] })
    ).results.map((x) => x.id),
    ['c-passes'],
  );
  await assert.rejects(
    runSelfTest({ harness: echoHarness(), scenarioDir: dir, only: ['c-passes', 'zzz'] }),
    /없는 시나리오: zzz/,
  );
  await assert.rejects(
    runSelfTest({ harness: echoHarness(), scenarioDir: tmp('harness-selftest-empty-') }),
    /실행할 시나리오가 없다/,
  );
});

test('runSelfTest: 자식 프로세스에 세션의 자격증명과 홈 폴더를 넘기지 않는다', async () => {
  const dir = tmp('harness-selftest-scn-');
  write(
    dir,
    'env.ts',
    SCENARIO(
      'env',
      `const s = ctx.sample();
       const r = JSON.parse(ctx.cli(s, ['x'], { env: { EXTRA: '1' } }).stdout);
       const leaked = Object.keys(r.env).filter((k) => /TOKEN|SECRET|KEY/i.test(k));
       assert.deepEqual(leaked, []);
       assert.equal(r.env.EXTRA, '1');
       assert.equal(r.env.HARNESS_FAKE_GH, s.ghState);
       assert.notEqual(r.env.HOME, ${JSON.stringify(process.env.HOME ?? process.env.USERPROFILE ?? '')});
       assert.equal(r.env.HOME, r.env.USERPROFILE);
       assert.equal(r.cwd, s.root);
       const state = JSON.parse((await import('node:fs')).readFileSync(s.ghState, 'utf8'));
       assert.equal(state.owner, 'maker');
       assert.equal(state.me, 'bot');
       assert.equal(s.issue('a'), 1);
       assert.equal(s.issue('b', { author: s.bot }), 2);`,
    ).replace('run(ctx) {', 'async run(ctx) {'),
  );
  const before = { ...process.env };
  process.env.GH_TOKEN = 'ghp_selftest_dummy';
  process.env.ANTHROPIC_API_KEY = 'dummy';
  process.env.MY_SECRET = 'dummy';
  try {
    const r = await runSelfTest({ harness: echoHarness(), scenarioDir: dir });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [['env', 'pass']],
      r.results[0].detail,
    );
  } finally {
    for (const k of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'MY_SECRET']) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
});

test('runSelfTest: ctx.github·ctx.agent·ctx.api — 상태 파일을 읽고 고치고, 가짜 에이전트를 연결하고, API 서버는 시나리오가 끝나면 꺼진다', async () => {
  const dir = tmp('harness-selftest-scn-');
  write(
    dir,
    'kit.ts',
    SCENARIO(
      'kit',
      `const fs = await import('node:fs');
       const s = ctx.sample();
       // 상태 파일을 고친 뒤에 Issue를 더해도 고친 내용이 남는다
       ctx.github(s).update((st) => { st.prs.push({ number: 9 }); });
       assert.equal(s.issue('a'), 1);
       const st = ctx.github(s).read();
       assert.deepEqual([st.prs.length, st.issues.length, st.next], [1, 1, 2]);
       // 가짜 에이전트: 실행기 쪽 파일, 동작 지정 파일, 프롬프트 기록
       assert.equal(JSON.parse(ctx.cli(s, ['x']).stdout).env.HARNESS_FAKE_AGENT, undefined);
       assert.deepEqual(s.prompts(), []);
       ctx.agent(s, { demo: { steps: 1 } });
       const env = JSON.parse(ctx.cli(s, ['x']).stdout).env;
       assert.equal(env.HARNESS_FAKE_AGENT, ${JSON.stringify(path.join(HARNESS_ROOT, 'scripts/selftest/fake-agent.ts'))});
       assert.deepEqual(JSON.parse(fs.readFileSync(env.FAKE_BEHAVIOR, 'utf8')), { demo: { steps: 1 } });
       fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ slug: 'demo', step: '0', prompt: 'p' }) + '\\n');
       assert.deepEqual(s.prompts(), [{ slug: 'demo', step: '0', prompt: 'p' }]);
       // API 서버: 정한 경로의 GET에만 답한다
       const api = await ctx.api(s, { 'repos/o/r/x': [1] });
       assert.deepEqual(await (await fetch(api.url + '/repos/o/r/x?per_page=100')).json(), [1]);
       assert.equal((await fetch(api.url + '/repos/o/r/y')).status, 404);
       assert.equal((await fetch(api.url + '/repos/o/r/x', { method: 'POST' })).status, 404);
       api.set({ 'repos/o/r/y': { a: 1 } });
       assert.deepEqual(await (await fetch(api.url + '/repos/o/r/y')).json(), { a: 1 });
       assert.deepEqual(api.hits(), ['GET repos/o/r/x', 'GET repos/o/r/y', 'POST repos/o/r/x', 'GET repos/o/r/y']);
       globalThis.selfTestApiUrl = api.url;`,
    ).replace('run(ctx) {', 'async run(ctx) {'),
  );
  // 시나리오가 정한 시간 제한을 쓴다: 0초면 첫 자식 프로세스를 띄우기 전에 넘긴다
  write(
    dir,
    'slow.ts',
    SCENARIO('slow', `ctx.sample();`).replace("covers: 'T',", "covers: 'T', timeoutSec: 0,"),
  );
  const r = await runSelfTest({ harness: echoHarness(), scenarioDir: dir });
  assert.deepEqual(
    r.results.map((x) => [x.id, x.state]),
    [
      ['kit', 'pass'],
      ['slow', 'error'],
    ],
    r.results.map((x) => x.detail).join('\n'),
  );
  assert.match(r.results[1].detail, /시나리오 시간 제한을 넘겼다/);
  const url = (globalThis as { selfTestApiUrl?: string }).selfTestApiUrl!;
  // 프로세스 종료는 비동기다. 꺼질 때까지 잠깐 기다린다
  let closed = false;
  for (const until = Date.now() + 10_000; !closed && Date.now() < until;) {
    closed = await fetch(`${url}/repos/o/r/y`).then(
      () => false,
      () => true,
    );
  }
  assert.ok(closed, '시나리오가 끝났는데 API 서버가 살아 있다');
});
