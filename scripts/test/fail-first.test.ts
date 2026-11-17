// `fail-first` 명령(scripts/commands/fail-first.ts) 테스트. 계획 20261117-r5-fail-first step0.
// R5의 "먼저 실패한 테스트" 기록은 명령이 실행한 결과로만 남는다: 단언 실패일 때만 기록하고,
// 통과한 실행·시간 초과·단언 실패가 아닌 실패는 기록하지 않는다.
import assert from 'node:assert/strict';
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { failFirstFile, isTestFile, readFailFirst } from '../commands/fail-first.ts';
import { newTask } from '../commands/task.ts';
import { runSync } from '../lib/exec.ts';
import { repoInfo } from '../lib/git.ts';
import { fixtureConfig, makeFixture, sh, write, type Fixture } from './helpers.ts';

let fx: Fixture;
/** 계획 20261117-rec의 step0 worktree */
let wt: string;
const PLAN = '20261117-rec';

/**
 * 이 파일은 `node --test` 안에서 돈다. 그 표시(NODE_TEST_CONTEXT)가 넘어가면 명령 안의 `node --test`가
 * 테스트 파일을 실행하지 않고 0으로 끝난다. 에이전트의 셸에는 이 변수가 없으므로 빼고 실행한다
 */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'),
);
const cli = (cwd: string, args: string[]) =>
  runSync(process.execPath, [path.join(cwd, 'scripts/harness.ts'), 'fail-first', ...args], {
    cwd,
    env: ENV,
    timeoutMs: 60_000,
  });
const records = () => readFailFirst(repoInfo(wt), PLAN, 0);

before(async () => {
  fx = makeFixture();
  const r = await newTask(fx.root, { issue: 5, slug: 'rec', github: false, date: '20261117' });
  wt = r.worktree;
  write(
    wt,
    't/fail.test.mjs',
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('더하기', () => assert.equal(1 + 1, 3));\n",
  );
  write(
    wt,
    't/pass.test.mjs',
    "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('더하기', () => assert.equal(1 + 1, 2));\n",
  );
  write(
    wt,
    't/broken.test.mjs',
    "import { nothing } from './no-such-module.mjs';\nimport { test } from 'node:test';\ntest('없는 모듈', () => nothing());\n",
  );
});
after(() => fx.cleanup());

test('fail-first: 통과하는 명령과 단언 실패가 아닌 실패는 기록하지 않고 1로 끝난다(이유가 다르다)', () => {
  const pass = cli(wt, ['node --test t/pass.test.mjs']);
  assert.equal(pass.code, 1, pass.stderr);
  assert.match(pass.stderr, /테스트가 통과했다/);

  const broken = cli(wt, ['node --test t/broken.test.mjs']);
  assert.equal(broken.code, 1, broken.stderr);
  assert.match(broken.stderr, /단언 실패가 아니다/);
  // 실행 출력의 끝을 함께 보여 준다
  assert.match(broken.stderr, /no-such-module/);

  assert.deepEqual(records(), []);
  assert.equal(existsSync(failFirstFile(repoInfo(wt))), false);
});

test('fail-first: 단언에서 실패하는 명령은 기록되고 0으로 끝난다', () => {
  const r = cli(wt, ['node --test t/fail.test.mjs']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /fail-first: 기록했다 — node --test t\/fail\.test\.mjs → 종료 코드 1, /);
  const [rec, ...rest] = records();
  assert.deepEqual(rest, []);
  assert.equal(rec.kind, 'fail');
  assert.equal(rec.plan, PLAN);
  assert.equal(rec.step, 0);
  assert.equal(rec.command, 'node --test t/fail.test.mjs');
  assert.equal(rec.code, 1);
  assert.match(rec.matched ?? '', /AssertionError|ERR_ASSERTION/);
  assert.ok((rec.matched ?? '').length <= 200);
  assert.match(rec.outputSha ?? '', /^[0-9a-f]{12}$/);
  assert.equal(rec.head, sh('git', ['rev-parse', 'HEAD'], wt));
  assert.ok(!Number.isNaN(Date.parse(rec.ts)));
  // 기록은 git이 추적하지 않는 상태 폴더에 있다: 작업 트리에 새 파일이 생기지 않는다
  assert.doesNotMatch(sh('git', ['status', '--porcelain'], wt), /fail-first/);
});

test('fail-first --exempt: 실행 없이 예외를 기록한다. 사유가 비면 2다', () => {
  const r = cli(wt, ['--exempt', '문서만 고치는\nstep이다']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /fail-first: 예외를 기록했다 — 문서만 고치는 step이다/);
  const last = records().at(-1)!;
  assert.equal(last.kind, 'exempt');
  // 한 줄로 만든다
  assert.equal(last.reason, '문서만 고치는 step이다');
  assert.equal(last.command, undefined);

  const n = records().length;
  assert.equal(cli(wt, ['--exempt', '  ']).code, 2);
  assert.equal(cli(wt, []).code, 2);
  assert.equal(cli(wt, ['  ']).code, 2);
  // 명령과 예외를 함께 줄 수 없다
  assert.equal(cli(wt, ['--exempt', '사유', 'node --test t/fail.test.mjs']).code, 2);
  assert.equal(records().length, n);
});

test('fail-first: 계획 브랜치가 아니면 2다', () => {
  const r = cli(fx.root, ['node --test t/fail.test.mjs']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /계획 브랜치가 아니다/);
});

test('readFailFirst: 다른 계획·다른 step의 기록과 깨진 줄은 돌려주지 않는다', () => {
  const before = records();
  assert.ok(before.length > 0);
  const file = failFirstFile(repoInfo(wt));
  const other = { ...before[0], plan: '20261117-other' };
  const otherStep = { ...before[0], step: 1 };
  appendFileSync(
    file,
    `${JSON.stringify(other)}\n{깨진 줄\n\n${JSON.stringify(otherStep)}\n"문자열"\n`,
  );
  assert.deepEqual(records(), before);
  assert.equal(readFailFirst(repoInfo(wt), PLAN, 1).length, 1);
  assert.equal(readFailFirst(repoInfo(wt), '20261117-other', 0).length, 1);
});

test('fail-first: 단언 실패 정규식은 ci.repro.failPattern을 쓰고, 시간 제한(limits.acTimeoutSec)을 넘기면 기록하지 않는다', async () => {
  const base = fixtureConfig() as { limits: Record<string, unknown> };
  const fx2 = makeFixture({
    limits: { ...base.limits, acTimeoutSec: 2 },
    ci: {
      repro: {
        dir: 'scripts/test',
        command: ['node', '--test'],
        failPattern: 'EXPECTED_BUT_GOT',
        timeoutSec: 60,
      },
    },
  });
  try {
    const r = await newTask(fx2.root, { issue: 6, slug: 'pat', github: false, date: '20261117' });
    const info = () => repoInfo(r.worktree);
    // 설정의 정규식이 보이지 않는 실패는 단언 실패가 아니다(기본 정규식에 맞아도)
    const node = cli(r.worktree, ['echo AssertionError; exit 1']);
    assert.equal(node.code, 1);
    assert.match(node.stderr, /단언 실패가 아니다/);
    const slow = cli(r.worktree, ['echo EXPECTED_BUT_GOT; sleep 20; exit 1']);
    assert.equal(slow.code, 1);
    assert.match(slow.stderr, /시간 제한/);
    assert.deepEqual(readFailFirst(info(), '20261117-pat', 0), []);

    const ok = cli(r.worktree, ['echo "x EXPECTED_BUT_GOT 3"; exit 7']);
    assert.equal(ok.code, 0, ok.stderr);
    const [rec] = readFailFirst(info(), '20261117-pat', 0);
    assert.equal(rec.code, 7);
    assert.equal(rec.matched, 'x EXPECTED_BUT_GOT 3');
  } finally {
    fx2.cleanup();
  }
});

test('isTestFile: 테스트 파일의 기본 glob', () => {
  for (const f of [
    'scripts/test/a.test.ts',
    'scripts/test/helpers.ts',
    'src/foo.spec.js',
    'pkg/foo_test.go',
    'tests/test_foo.py',
    'src/__tests__/a.ts',
    'a.test.ts',
  ])
    assert.equal(isTestFile(f), true, f);
  for (const f of [
    'scripts/commands/task.ts',
    'docs/latest.md',
    'src/contest/a.ts',
    'src/attest.ts',
    'testing.md',
  ])
    assert.equal(isTestFile(f), false, f);
});
