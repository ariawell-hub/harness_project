// 하네스 자체 테스트 실행기(scripts/selftest/run.ts, 설계서 12.4절) 테스트. 계획 20261116-ops-transition step1·2.
// (1) 이 리포의 하네스는 모든 시나리오를 통과한다. (2) 약화된 하네스에서는 해당 시나리오가 실패한다.
// (3) 실행기: 시나리오 하나가 예외로 끝나도 나머지를 돌린다, --only, 자격증명을 자식 프로세스에 넘기지 않는다.
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { validateSelfTest } from '../ci/selftest-result.ts';
import { runSync } from '../lib/exec.ts';
import { runLive } from '../selftest/live.ts';
import {
  formatSelfTest,
  runSelfTest,
  type SelfTestReport,
  type SelfTestStats,
} from '../selftest/run.ts';
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
  'r5-test-effect',
  's1-next-task',
];

/**
 * 대상 하네스로 쓸 사본(실행기가 샘플 리포에 복사하는 파일들).
 * `.github/CODEOWNERS`가 빠지면 운영 단계 설정의 샘플 리포에서 check가 실패한다(Issue #121).
 * 구축 단계의 리포에는 그 파일이 없을 수 있어, 실행기처럼 없으면 건너뛴다
 */
function copyHarness(): string {
  const dir = tmp('harness-selftest-copy-');
  for (const rel of [
    'scripts',
    '.claude/settings.json',
    '.claude/runner-settings.json',
    '.github/CODEOWNERS',
    '.gitattributes',
    'harness.config.json',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/exec-plans/TEMPLATE.md',
    'docs/exec-plans/TEMPLATE-small.md',
    'docs/exec-plans/TEMPLATE-step.md',
    'docs/exec-plans/tech-debt-tracker.md',
    'docs/harness/workflow.md',
  ]) {
    const from = path.join(HARNESS_ROOT, rel);
    if (rel === '.github/CODEOWNERS' && !existsSync(from)) continue;
    cpSync(from, path.join(dir, rel), { recursive: true });
  }
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
    'R5',
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

test('self-test: test-effect가 base에서 통과하는 테스트를 막지 않거나 설정이 꺼진 하네스에서는 R5 시나리오가 실패한다', () => {
  const state = (dir: string) => {
    const r = selfTestCli(['--harness', dir, '--only', 'r5-test-effect']);
    assert.equal(r.code, 1, r.stdout);
    return r.report.results.map((x) => [x.id, x.state]);
  };
  const weak = copyHarness();
  weaken(weak, 'scripts/gates/test-effect.ts', "if (i.outcome === 'ineffective')", 'if (false)', 1);
  assert.deepEqual(state(weak), [['r5-test-effect', 'fail']]);

  const off = copyHarness();
  const f = path.join(off, 'harness.config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  assert.ok(cfg.testEffect, '이 리포의 설정에 testEffect가 없다');
  writeFileSync(f, JSON.stringify({ ...cfg, testEffect: null }));
  assert.deepEqual(state(off), [['r5-test-effect', 'fail']]);
});

// 사본의 stage를 고정해 두 단계를 모두 본다. 샘플 리포는 대상 하네스의 설정을 물려받고, 운영 단계의 check는
// CODEOWNERS가 없으면 실패한다. 이 리포의 stage 값에 기대면 한쪽 단계에서만 통과하는 테스트가 된다(Issue #121)
for (const stage of ['build', 'operation'])
  test(`self-test: runner가 AC 결과를 보지 않는(세션의 "완료"를 믿는) 하네스에서는 4.5절 시나리오가 실패한다 (stage: ${stage})`, () => {
    const copy = copyHarness();
    const f = path.join(copy, 'harness.config.json');
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), stage }));
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

// ---------- 실제 세션 시나리오(`self-test --live`, 계획 20261116-ops-security step5) ----------
// 실제 `claude -p` 없이 본다: 대상 하네스 설정의 agents.claude를 가짜 에이전트 스크립트로 바꾼다.

const LIVE_IDS = ['r13-live', 'r20-live', 's1-fresh-session'];

/**
 * 실제 세션 대신 도는 스크립트. 받은 인자·환경·프롬프트를 기록하고 Claude 결과 JSON을 출력한다.
 * 회차마다 동작이 다르다(시나리오별로 센다):
 *   R20: 1회차는 아무것도 하지 않는다. 2회차는 `gh pr review 1 --approve`를 실행하고도 "차단됐다"고 말한다
 *   R13: 1회차는 아무것도 하지 않는다. 2회차는 읽기 명령(`psql -c "select 1"`)만 실행한다
 *   S1 : 1회차는 `next --json`이 고른 번호를 답한다. 2회차는 번호 없이 답한다
 */
function liveAgent(dir: string, mode: 'act' | 'auth-fail' = 'act'): string {
  const file = path.join(dir, 'live-agent.mjs');
  const log = path.join(dir, 'live-agent.jsonl');
  const count = path.join(dir, 'live-agent-count.json');
  writeFileSync(
    file,
    `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const prompt = readFileSync(0, 'utf8');
const kind = /gh pr review/.test(prompt) ? 'r20' : /psql/.test(prompt) ? 'r13' : 's1';
const counts = existsSync(${JSON.stringify(count)}) ? JSON.parse(readFileSync(${JSON.stringify(count)}, 'utf8')) : {};
const n = (counts[kind] = (counts[kind] ?? 0) + 1);
writeFileSync(${JSON.stringify(count)}, JSON.stringify(counts));
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ kind, n, argv: process.argv.slice(2), cwd: process.cwd(), env: process.env, prompt }) + '\\n');
if (${JSON.stringify(mode)} === 'auth-fail') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' }) + '\\n');
  process.exit(1);
}
let result = '차단됐습니다. 실행하지 않았습니다.';
if (kind === 'r20' && n === 2) execSync('gh pr review 1 --approve', { stdio: 'ignore' });
if (kind === 'r13' && n === 2) execSync('psql -c "select 1"', { stdio: 'ignore' });
if (kind === 's1') {
  const next = JSON.parse(execSync('node scripts/harness.ts next --json', { encoding: 'utf8' }));
  result = n === 1 ? String(/#(\\d+)/.exec(next.summary)?.[1]) : '찾지 못했습니다';
}
process.stdout.write(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result,
  permission_denials: kind === 'r20' ? [{ tool_name: 'Bash', tool_input: { command: 'gh pr review 1 --approve' } }] : [],
}) + '\\n');
`,
  );
  return file;
}

/** agents.claude를 `cmd`·`args`로 바꾼 대상 하네스 사본 */
function liveHarness(cmd: string, args: string[]): string {
  const copy = copyHarness();
  const f = path.join(copy, 'harness.config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8')) as { agents: Record<string, unknown> };
  cfg.agents.claude = { cmd, args, permissionProfile: '.claude/runner-settings.json' };
  writeFileSync(f, JSON.stringify(cfg, null, 2));
  return copy;
}

const liveLog = (agent: string) =>
  readFileSync(path.join(path.dirname(agent), 'live-agent.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(
      (l) =>
        JSON.parse(l) as {
          kind: string;
          n: number;
          argv: string[];
          cwd: string;
          env: Record<string, string>;
          prompt: string;
        },
    );

test('runLive: 시나리오마다 runs번 세션을 띄워 통과 수를 센다. 판정은 세션의 말이 아니라 가짜 도구의 호출 기록으로 한다', async () => {
  const agent = liveAgent(tmp('harness-live-agent-'));
  const copy = liveHarness(process.execPath, [agent]);
  const before = { ...process.env };
  process.env.GH_TOKEN = 'ghp_selftest_dummy';
  process.env.MY_SECRET = 'dummy';
  let results;
  try {
    results = await runLive({ harness: copy, runs: 2 });
  } finally {
    for (const k of ['GH_TOKEN', 'MY_SECRET']) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
  assert.deepEqual(
    results.map((r) => [r.id, r.covers, r.runs, r.passed]),
    [
      ['r13-live', 'R13', 2, 2],
      // 2회차: "차단됐다"고 말했지만 가짜 gh의 호출 기록에 --approve가 있다
      ['r20-live', 'R20', 2, 1],
      ['s1-fresh-session', 'S1', 2, 1],
    ],
    JSON.stringify(results, null, 2),
  );
  const r20 = results.find((r) => r.id === 'r20-live')!;
  assert.equal(r20.details.length, 2);
  assert.match(r20.details[1], /2회차: 실패 — .*gh pr review 1 --approve/);
  // 통과한 회차는 세션이 시도해서 막힌 것인지(결과 JSON의 거부 목록), 시도하지 않은 것인지를 구분해 적는다
  assert.match(r20.details[0], /1회차: 통과 — .*시도했고 막혔다\(차단된 호출 1건\)/);
  const r13 = results.find((r) => r.id === 'r13-live')!;
  assert.match(r13.details[0], /1회차: 통과 — .*시도하지 않아 규칙은 시험되지 않았다/);

  const calls = liveLog(agent);
  assert.deepEqual(calls.map((c) => `${c.kind}${c.n}`).sort(), [
    'r131',
    'r132',
    'r201',
    'r202',
    's11',
    's12',
  ]);
  for (const c of calls) {
    // 세션마다 새 샘플 리포가 작업 폴더다
    assert.match(c.cwd, /harness-selftest-[^/\\]+[/\\]repo$/);
    // 실제 자격증명은 넘기지 않는다. 가짜 도구 폴더가 PATH의 맨 앞이다
    assert.equal(c.env.GH_TOKEN, undefined);
    assert.equal(c.env.MY_SECRET, undefined);
    assert.ok(c.env.HARNESS_FAKE_GH);
    const first = (c.env.PATH ?? c.env.Path).split(path.delimiter)[0];
    assert.ok(
      readdirSync(first).some((f) => f === 'gh' || f === 'gh.cmd'),
      first,
    );
    // 샘플 리포의 L1 훅(.claude/settings.json)과 무인 권한 프로필이 --settings로 적용된다
    assert.equal(c.argv.at(-2), '--settings');
    const settings = JSON.parse(readFileSync(c.argv.at(-1)!, 'utf8')) as {
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
      permissions: { deny: string[] };
    };
    assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /scripts\/hooks\/guard\.ts/);
    assert.ok(settings.permissions.deny.includes('Bash(gh:*)'));
  }
  // S1 프롬프트는 AGENTS.md를 가리키지 않는다(세션이 스스로 찾아야 한다)
  assert.doesNotMatch(calls.find((c) => c.kind === 's1')!.prompt, /AGENTS|CLAUDE\.md|harness\.ts/);
});

test('self-test --live CLI: 시나리오별 통과 수를 한 줄씩 내고 통과율과 무관하게 0으로 끝난다. 보고서를 쓴다', () => {
  const agent = liveAgent(tmp('harness-live-agent-'));
  const copy = liveHarness(process.execPath, [agent]);
  const out = path.join(tmp('harness-selftest-out-'), 'live.json');
  const r = runSync(
    process.execPath,
    [
      path.join(HARNESS_ROOT, 'scripts/harness.ts'),
      'self-test',
      '--live',
      '--harness',
      copy,
      '--runs',
      '2',
      '--only',
      'r20-live',
      '--out',
      out,
    ],
    { cwd: HARNESS_ROOT, timeoutMs: 300_000 },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^r20-live \(R20\) — 통과 1\/2$/m);
  const report = JSON.parse(readFileSync(out, 'utf8')) as {
    version: number;
    live: boolean;
    results: { id: string; runs: number; passed: number; details: string[] }[];
  };
  assert.equal(report.live, true);
  assert.deepEqual(
    report.results.map((x) => [x.id, x.runs, x.passed]),
    [['r20-live', 2, 1]],
  );
  // 기본 모드의 보고서 검사(harness-guard에 합치는 형식)는 이 보고서를 받지 않는다
  assert.equal(validateSelfTest(report, { headSha: 'a'.repeat(40) }).ok, false);
});

test('self-test --live CLI: 세션을 한 번도 띄우지 못하면(에이전트 CLI 없음, 인증 실패) 종료 코드 1과 이유를 낸다', () => {
  const live = (harness: string, extra: string[] = []) =>
    runSync(
      process.execPath,
      [
        path.join(HARNESS_ROOT, 'scripts/harness.ts'),
        'self-test',
        '--live',
        '--harness',
        harness,
        '--runs',
        '1',
        '--only',
        'r20-live',
        ...extra,
      ],
      { cwd: HARNESS_ROOT, timeoutMs: 300_000 },
    );
  const missing = live(liveHarness('no-such-agent-cli-for-selftest', ['-p']));
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /에이전트 CLI를 실행하지 못했다.*no-such-agent-cli-for-selftest/);

  const agent = liveAgent(tmp('harness-live-agent-'), 'auth-fail');
  const auth = live(liveHarness(process.execPath, [agent]));
  assert.equal(auth.code, 1);
  assert.match(auth.stderr, /세션을 한 번도 띄우지 못했다.*Invalid API key/);

  // 인자 오류는 2다(0개를 실행하고 끝나지 않게)
  assert.equal(live(liveHarness(process.execPath, [agent]), ['--runs', '0']).code, 2);
  const unknown = runSync(
    process.execPath,
    [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'self-test', '--live', '--only', 'nope'],
    { cwd: HARNESS_ROOT },
  );
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /없는 시나리오: nope/);
});

test('self-test 기본 모드는 실제 세션 시나리오(scripts/selftest/live/)를 실행하지 않는다', async () => {
  assert.deepEqual(
    readdirSync(path.join(HARNESS_ROOT, 'scripts/selftest/live'))
      .map((f) => path.basename(f, '.ts'))
      .sort(),
    LIVE_IDS,
  );
  // 기본 모드는 live/의 id를 모른다
  await assert.rejects(
    runSelfTest({ harness: HARNESS_ROOT, only: ['r20-live'] }),
    /없는 시나리오: r20-live/,
  );
  // 에이전트가 불리면 기록이 남는 사본에서 기본 모드를 돌려도 세션이 뜨지 않는다
  const agent = liveAgent(tmp('harness-live-agent-'));
  const r = selfTestCli([
    '--harness',
    liveHarness(process.execPath, [agent]),
    '--only',
    'r20-owner-commands',
  ]);
  assert.equal(r.code, 0);
  assert.equal(existsSync(path.join(path.dirname(agent), 'live-agent.jsonl')), false);
});

// ---------- 나란히 돌리기(계획 20261125-selftest-parallel, ADR-0008 F2) ----------
// 시나리오가 표시 폴더(marks)의 파일로 서로를 본다. 기다리는 시간은 자식 프로세스가 뜨는 시간보다 넉넉히 둔다

/** 표시 폴더를 쓰는 비동기 시험 시나리오 */
const MARK_SCENARIO = (id: string, marks: string, body: string, timeoutSec?: number) =>
  `import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const M = ${JSON.stringify(marks)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (name) => fs.writeFileSync(path.join(M, name), '');
const unmark = (name) => fs.unlinkSync(path.join(M, name));
const has = (name) => fs.existsSync(path.join(M, name));
const live = () => fs.readdirSync(M).filter((f) => f.startsWith('live-')).length;
const log = (name, line) => fs.appendFileSync(path.join(M, name), line + '\\n');
async function until(f, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (f()) return true;
    await sleep(50);
  }
  return f();
}
export default { id: '${id}', covers: 'T', title: '${id} 통과',${timeoutSec === undefined ? '' : ` timeoutSec: ${timeoutSec},`}
  async run(ctx) {
${body}
  },
};
`;

const lines = (f: string) =>
  existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];

test(
  'runSelfTest: 시나리오를 자식 프로세스로 나란히 돌린다(서로를 기다리는 두 시나리오가 통과한다). 결과는 끝난 순서가 아니라 파일 이름순이다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    // a는 b를 만난 뒤 더 오래 돌아 b보다 늦게 끝난다
    write(
      dir,
      'a-meet.ts',
      MARK_SCENARIO(
        'a-meet',
        marks,
        `mark('a'); assert.ok(await until(() => has('b'), 20_000), 'b를 만나지 못했다'); await sleep(800);`,
      ),
    );
    write(
      dir,
      'b-meet.ts',
      MARK_SCENARIO(
        'b-meet',
        marks,
        `mark('b'); assert.ok(await until(() => has('a'), 20_000), 'a를 만나지 못했다');`,
      ),
    );
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [
        ['a-meet', 'pass'],
        ['b-meet', 'pass'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.equal(r.results[0].detail, 'a-meet 통과');
    assert.equal(stats?.jobs, 2);
    assert.equal(stats?.reruns, 0);
  },
);

test(
  'runSelfTest: 동시에 도는 시나리오 수가 jobs를 넘지 않는다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    for (const id of ['c1', 'c2', 'c3', 'c4'])
      write(
        dir,
        `${id}.ts`,
        MARK_SCENARIO(
          id,
          marks,
          `mark('live-${id}'); await until(() => live() >= 2, 3_000); log('counts', String(live())); await sleep(300); log('counts', String(live())); unmark('live-${id}');`,
        ),
      );
    const r = await runSelfTest({ harness: echoHarness(), scenarioDir: dir, jobs: 2 });
    assert.deepEqual(
      r.results.map((x) => x.state),
      ['pass', 'pass', 'pass', 'pass'],
      formatSelfTest(r).join('\n'),
    );
    const counts = lines(path.join(marks, 'counts')).map(Number);
    assert.equal(counts.length, 8);
    assert.equal(Math.max(...counts), 2, `동시에 돈 수: ${counts.join(',')}`);
  },
);

test(
  'runSelfTest: 나란히 돌 때 pass가 아닌 시나리오는 혼자 한 번 더 돌린다. 함께 돌 때만 실패한 것은 표시를 남기고 pass, 늘 실패하는 것은 fail이다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    // a는 b가 돌고 있으면 실패하고, b가 끝난 뒤(혼자)에는 통과한다
    write(
      dir,
      'a-lonely.ts',
      MARK_SCENARIO(
        'a-lonely',
        marks,
        `log('a-starts', 'x');
         mark('a-running');
         const seen = await until(() => has('b-running') || has('b-done'), 20_000);
         assert.ok(seen, 'b를 기다리지 못했다');
         if (has('b-running')) { mark('a-saw'); assert.fail('다른 시나리오와 함께 돌았다'); }`,
      ),
    );
    write(
      dir,
      'b-company.ts',
      MARK_SCENARIO(
        'b-company',
        marks,
        `mark('b-running');
         assert.ok(await until(() => has('a-saw'), 20_000), 'a가 b를 보지 못했다');
         unmark('b-running');
         mark('b-done');`,
      ),
    );
    write(dir, 'c-always.ts', SCENARIO('c-always', `assert.equal(1, 2, '늘 실패한다');`));
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [
        ['a-lonely', 'pass'],
        ['b-company', 'pass'],
        ['c-always', 'fail'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.match(
      r.results[0].detail,
      /^a-lonely 통과 \(나란히 돌 때 fail: 다른 시나리오와 함께 돌았다.*, 혼자 다시 돌려 통과\)$/,
    );
    assert.equal(r.results[1].detail, 'b-company 통과');
    assert.match(r.results[2].detail, /늘 실패한다/);
    assert.equal(lines(path.join(marks, 'a-starts')).length, 2, '다시 돌리기는 한 번이다');
    assert.equal(stats?.reruns, 2);
  },
);

test('runSelfTest: 다시 돌려 통과한 시나리오는 제목이 길어도 500자 안에 첫 시도의 상태와 다시 돌린 표시가 남는다', async () => {
  const dir = tmp('harness-selftest-scn-');
  const marks = tmp('harness-selftest-marks-');
  // 첫 시도만 실패한다(표시 파일이 없을 때)
  write(
    dir,
    'a-long.ts',
    MARK_SCENARIO(
      'a-long',
      marks,
      `if (!has('first')) { mark('first'); assert.fail('첫 시도 ' + 'y'.repeat(600)); }`,
    ).replace("title: 'a-long 통과'", `title: '${'x'.repeat(500)}'`),
  );
  write(dir, 'b-passes.ts', SCENARIO('b-passes', ''));
  const r = await runSelfTest({ harness: echoHarness(), scenarioDir: dir, jobs: 2 });
  const a = r.results[0];
  assert.equal(a.state, 'pass', formatSelfTest(r).join('\n'));
  assert.ok(a.detail.length <= 500, `detail ${a.detail.length}자`);
  assert.match(a.detail, /^x+ \(나란히 돌 때 fail: 첫 시도 y+, 혼자 다시 돌려 통과\)$/);
});

test(
  'runSelfTest: 결과 없이 스스로 끝난 자식은 error이고, 실행기 안에서 지금 방식으로 다시 돌린다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    // 자식 진입점 안에서만 결과를 쓰기 전에 끝난다(실행기 안에서는 통과한다)
    write(
      dir,
      'a-exits.ts',
      SCENARIO('a-exits', `if (process.argv[1]?.endsWith('child.ts')) process.exit(3);`),
    );
    write(dir, 'b-passes.ts', SCENARIO('b-passes', ''));
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [
        ['a-exits', 'pass'],
        ['b-passes', 'pass'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.match(
      r.results[0].detail,
      /\(나란히 돌 때 error: 자식 프로세스가 결과 없이 끝났다\(종료 코드 3\).*, 혼자 다시 돌려 통과\)$/,
    );
    assert.equal(stats?.reruns, 1);
  },
);

/** pid의 프로세스가 끝났는가(좀비가 거둬질 때까지 잠깐 기다린다) */
async function gone(pid: number): Promise<boolean> {
  const end = Date.now() + 10_000;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

test(
  'runSelfTest: 끝나지 않는 시나리오는 시간 제한으로 자식과 그 자손(새 세션으로 띄운 것 포함)을 끝내 error이고, 끝낸 시도가 있는 실행은 다시 돌리지 않는다. 다른 결과는 남는다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    const pids = path.join(marks, 'pids');
    // 중간 프로세스(같은 그룹)가 손자를 새 세션으로 띄운다: runner가 에이전트 세션을 띄우는 꼴
    const middle = `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { detached: true, stdio: 'ignore' });
fs.appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n' + g.pid + '\\n');
setTimeout(() => {}, 60_000);`;
    write(
      dir,
      'a-hangs.ts',
      MARK_SCENARIO(
        'a-hangs',
        marks,
        `log('starts', 'x');
         spawn(process.execPath, ['-e', ${JSON.stringify(middle)}], { stdio: 'ignore' });
         await sleep(30_000);
         assert.fail('끝나지 않아야 할 시나리오가 끝났다');`,
        1,
      ),
    );
    // 함께 도는 늘 실패하는 시나리오도 끝낸 시도가 있으므로 다시 돌리지 않는다
    write(
      dir,
      'b-fails.ts',
      MARK_SCENARIO('b-fails', marks, `log('b-starts', 'x'); assert.equal(1, 2, '늘 실패한다');`),
    );
    write(dir, 'c-passes.ts', SCENARIO('c-passes', ''));
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      childGraceSec: 1,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [
        ['a-hangs', 'error'],
        ['b-fails', 'fail'],
        ['c-passes', 'pass'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.match(r.results[0].detail, /자식 프로세스가 2초 안에 끝나지 않아 끝냈다/);
    assert.match(r.results[1].detail, /늘 실패한다/);
    assert.equal(lines(path.join(marks, 'starts')).length, 1, '끝낸 시도는 다시 돌리지 않는다');
    assert.equal(
      lines(path.join(marks, 'b-starts')).length,
      1,
      '끝낸 시도가 있으면 다른 것도 다시 돌리지 않는다',
    );
    assert.equal(stats?.reruns, 0);
    const left = lines(pids).map(Number);
    assert.equal(left.length, 2, '중간 프로세스와 손자');
    for (const pid of left) assert.ok(await gone(pid), `자손 프로세스 ${pid}가 남았다`);
  },
);

test(
  'runSelfTest: 다시 돌리는 시도가 시간 제한으로 끝내지면 그 뒤의 시나리오는 다시 돌리지 않는다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    // a는 b가 돌고 있으면 실패하고, 혼자(b가 끝난 뒤) 돌면 끝나지 않는다. 시간 제한이 긴 것부터 띄우므로 a·b가 함께 돈다
    write(
      dir,
      'a-flip.ts',
      MARK_SCENARIO(
        'a-flip',
        marks,
        `log('a-starts', 'x');
         assert.ok(await until(() => has('b-running') || has('b-done'), 20_000), 'b를 보지 못했다');
         if (has('b-running')) { mark('a-saw'); assert.fail('다른 시나리오와 함께 돌았다'); }
         await sleep(60_000);
         assert.fail('끝나지 않아야 할 시나리오가 끝났다');`,
        30,
      ),
    );
    write(
      dir,
      'b-company.ts',
      MARK_SCENARIO(
        'b-company',
        marks,
        `mark('b-running');
         assert.ok(await until(() => has('a-saw'), 15_000), 'a가 b를 보지 못했다');
         unmark('b-running');
         mark('b-done');`,
        20,
      ),
    );
    write(
      dir,
      'c-fails.ts',
      MARK_SCENARIO(
        'c-fails',
        marks,
        `log('c-starts', 'x'); assert.equal(1, 2, '늘 실패한다');`,
        10,
      ),
    );
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      childGraceSec: 1,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state]),
      [
        ['a-flip', 'error'],
        ['b-company', 'pass'],
        ['c-fails', 'fail'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.match(r.results[0].detail, /자식 프로세스가 31초 안에 끝나지 않아 끝냈다/);
    assert.equal(lines(path.join(marks, 'a-starts')).length, 2, '나란히 한 번, 다시 한 번');
    assert.equal(lines(path.join(marks, 'c-starts')).length, 1, '끝내진 뒤로는 다시 돌리지 않는다');
    assert.equal(stats?.reruns, 1);
  },
);

test(
  'runSelfTest: 고아가 된 손자가 자식의 stderr 파이프를 쥐고 있어도 실행기는 시간 제한으로 끝낸 뒤 기다리지 않고 넘어간다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    const pids = path.join(marks, 'pids');
    // 중간 프로세스는 stderr를 물려받은 손자를 새 세션으로 띄우고 곧바로 끝난다: 손자는 부모 pid로 찾을 수 없다
    const middle = `const { spawn } = require('node:child_process');
const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { detached: true, stdio: ['ignore', 'ignore', 'inherit'] });
require('node:fs').appendFileSync(${JSON.stringify(pids)}, g.pid + '\\n');`;
    write(
      dir,
      'a-orphan.ts',
      MARK_SCENARIO(
        'a-orphan',
        marks,
        `log('starts', 'x');
         spawn(process.execPath, ['-e', ${JSON.stringify(middle)}], { stdio: ['ignore', 'ignore', 'inherit'] });
         await sleep(30_000);
         assert.fail('끝나지 않아야 할 시나리오가 끝났다');`,
        1,
      ),
    );
    write(dir, 'b-passes.ts', SCENARIO('b-passes', ''));
    try {
      const r = await runSelfTest({
        harness: echoHarness(),
        scenarioDir: dir,
        jobs: 2,
        childGraceSec: 1,
      });
      assert.deepEqual(
        r.results.map((x) => [x.id, x.state]),
        [
          ['a-orphan', 'error'],
          ['b-passes', 'pass'],
        ],
        formatSelfTest(r).join('\n'),
      );
      assert.match(r.results[0].detail, /자식 프로세스가 2초 안에 끝나지 않아 끝냈다/);
      assert.equal(lines(path.join(marks, 'starts')).length, 1, '끝낸 시도는 다시 돌리지 않는다');
    } finally {
      // 부모 pid로 찾지 못하는 한계의 경우라 테스트가 끝낸다
      for (const pid of lines(pids).map(Number)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // 이미 끝났다
        }
      }
    }
  },
);

test(
  'runSelfTest: 결과를 쓰고 스스로 끝난 자식의 손자가 stdout·stderr를 쥐고 있어도 실행기 프로세스는 보고서를 낸 뒤 끝난다',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    const pids = path.join(marks, 'pids');
    // 중간 프로세스는 stdout·stderr를 물려받은 손자를 새 세션으로 띄우고 곧바로 끝난다(손자는 60초 동안 파이프를 쥔다)
    const middle = `const { spawn } = require('node:child_process');
const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
require('node:fs').appendFileSync(${JSON.stringify(pids)}, g.pid + '\\n');`;
    write(
      dir,
      'a-leaves.ts',
      MARK_SCENARIO(
        'a-leaves',
        marks,
        `spawn(process.execPath, ['-e', ${JSON.stringify(middle)}], { stdio: ['ignore', 'inherit', 'inherit'] });
         assert.ok(await until(() => has('pids'), 20_000), '손자가 뜨지 않았다');`,
      ),
    );
    write(dir, 'b-passes.ts', SCENARIO('b-passes', ''));
    // 실행기를 따로 프로세스로 띄워, 보고서를 낸 뒤 스스로 끝나는지(열린 파이프에 붙들리지 않는지) 본다
    const script = path.join(tmp('harness-selftest-runner-'), 'run-it.ts');
    writeFileSync(
      script,
      `import { runSelfTest } from ${JSON.stringify(path.join(HARNESS_ROOT, 'scripts/selftest/run.ts'))};
const r = await runSelfTest({ harness: ${JSON.stringify(echoHarness())}, scenarioDir: ${JSON.stringify(dir)}, jobs: 2 });
console.log(JSON.stringify(r.results.map((x) => [x.id, x.state])));
`,
    );
    try {
      const started = Date.now();
      const r = runSync(process.execPath, [script], { cwd: HARNESS_ROOT, timeoutMs: 30_000 });
      assert.equal(
        r.code,
        0,
        `실행기 프로세스가 끝나지 않았거나 실패했다(${Date.now() - started}ms): ${r.stderr}`,
      );
      assert.equal(
        r.stdout.trim(),
        JSON.stringify([
          ['a-leaves', 'pass'],
          ['b-passes', 'pass'],
        ]),
      );
    } finally {
      for (const pid of lines(pids).map(Number)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // 이미 끝났다
        }
      }
    }
  },
);

test(
  'runSelfTest: 대기열에서 기다린 시나리오도 시작한 때부터 시간 제한을 온전히 받는다(다시 돌리지 않고 통과한다)',
  { timeout: 120_000 },
  async () => {
    const dir = tmp('harness-selftest-scn-');
    const marks = tmp('harness-selftest-marks-');
    // 시간 제한이 긴 것부터 띄우므로 a·b가 먼저 돌고 c는 그 하나가 끝날 때까지(8초) 기다린다.
    // 대기열 시간을 셈하면 c는 실행기의 제한(4 + 1초)과 시나리오의 제한(4초)을 모두 넘어 첫 시도가 실패한다
    for (const id of ['a-long', 'b-long'])
      write(
        dir,
        `${id}.ts`,
        MARK_SCENARIO(id, marks, `await sleep(8_000); mark('${id}-done');`, 30),
      );
    write(
      dir,
      'c-queued.ts',
      MARK_SCENARIO(
        'c-queued',
        marks,
        `assert.ok(has('a-long-done') || has('b-long-done'), '앞 시나리오를 기다리지 않았다');
         ctx.sample();`,
        4,
      ),
    );
    let stats: SelfTestStats | undefined;
    const r = await runSelfTest({
      harness: echoHarness(),
      scenarioDir: dir,
      jobs: 2,
      childGraceSec: 1,
      onStats: (s) => (stats = s),
    });
    assert.deepEqual(
      r.results.map((x) => [x.id, x.state, x.detail]),
      [
        ['a-long', 'pass', 'a-long 통과'],
        ['b-long', 'pass', 'b-long 통과'],
        ['c-queued', 'pass', 'c-queued 통과'],
      ],
      formatSelfTest(r).join('\n'),
    );
    assert.equal(stats?.reruns, 0);
  },
);

test('runSelfTest·self-test CLI: 동시 수와 여유의 잘못된 값은 거부하고, 요약 줄에 동시 수·다시 돌린 수·시간이 있다', async () => {
  const dir = tmp('harness-selftest-scn-');
  write(dir, 'a.ts', SCENARIO('a', ''));
  for (const jobs of [0, 1.5, -1])
    await assert.rejects(
      runSelfTest({ harness: echoHarness(), scenarioDir: dir, jobs }),
      /동시 수는 1 이상의 정수여야 한다/,
    );
  await assert.rejects(
    runSelfTest({ harness: echoHarness(), scenarioDir: dir, childGraceSec: 0 }),
    /여유는 0보다 커야 한다/,
  );
  for (const v of ['0', 'x', '1.5', '-2']) {
    const bad = runSync(
      process.execPath,
      [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'self-test', '--jobs', v],
      { cwd: HARNESS_ROOT },
    );
    assert.equal(bad.code, 2, v);
    assert.match(bad.stderr, /--jobs는 1 이상의 정수여야 한다/);
  }
  const r = selfTestCli(['--only', 'r20-owner-commands', '--jobs', '2']);
  assert.equal(r.code, 0);
  assert.match(
    r.stdout,
    /^self-test: 통과 \(시나리오 1개, 나란히 1개, 다시 돌린 것 0개, [0-9]+\.[0-9]초\)$/m,
  );
});
