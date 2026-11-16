// 하네스 자체 테스트 실행기(scripts/selftest/run.ts, 설계서 12.4절) 테스트. 계획 20261116-ops-transition step1.
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
  'mcp-guard',
  'r1-plan-gate',
  'r13-db',
  'r20-owner-commands',
  'r4-bypass',
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
  assert.deepEqual(r.results.map((x) => x.covers).sort(), ['R1', 'R13', 'R14', 'R20', 'R4', 'S1']);
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
