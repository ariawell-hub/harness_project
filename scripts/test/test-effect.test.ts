import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { exemptLine, parseExemptions, testEffect } from '../gates/test-effect.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, sh, tmp, write } from './helpers.ts';

const HEAD = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n";
const PASSING = `${HEAD}import { add } from '../src/lib.mjs';\ntest('add', () => assert.equal(add(1, 2), 3));\n`;
const MARK = 'MARKER-OUTPUT-7f3a';
const PLAN = 'docs/exec-plans/active/20260101-x/plan.md';

/** base 커밋이 있는 리포. src/lib.mjs(add), t/existing.test.mjs, t/helper.mjs */
function repo(over: Record<string, unknown> = {}): { root: string; base: string } {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  const testEffectCfg =
    'testEffect' in over
      ? over.testEffect
      : {
          files: ['t/*.test.mjs'],
          support: ['t/helper.mjs'],
          command: [process.execPath, '--test'],
          timeoutSec: 60,
          link: [],
          ...over,
        };
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig({ testEffect: testEffectCfg })));
  write(root, '.gitignore', 'deps/\n');
  write(root, 'src/lib.mjs', 'export const add = (a, b) => a + b;\n');
  write(root, 't/helper.mjs', 'export const one = () => 1;\n');
  write(root, 't/existing.test.mjs', PASSING);
  write(root, PLAN, '# 계획\n\n## 의사결정 로그\n');
  const base = commitAll(root, 'base');
  return { root, base };
}

const check = (root: string, base: string | null, committedOnly = false) =>
  testEffect(root, loadConfig(root), { base, committedOnly });
const blobOf = (root: string, rel: string) => sh('git', ['hash-object', rel], root);
const outcomes = (r: Awaited<ReturnType<typeof check>>) =>
  Object.fromEntries(r.items.map((i) => [i.file, i.outcome]));

test('base에서도 통과하는 새 테스트 파일은 ineffective이고 고치는 법에 예외 줄이 있다', async () => {
  const { root, base } = repo();
  write(root, 't/new.test.mjs', PASSING);
  const r = await check(root, base);
  assert.equal(r.skipped, false);
  assert.deepEqual(outcomes(r), { 't/new.test.mjs': 'ineffective' });
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].rule, 'R5 테스트 실효성');
  assert.match(r.problems[0].what, /t\/new\.test\.mjs/);
  assert.ok(
    r.problems[0].how.includes(exemptLine('t/new.test.mjs', blobOf(root, 't/new.test.mjs'))),
  );
});

test('base에서 실패하는 새 테스트 파일은 effective다(단언 실패, 모듈 없음)', async () => {
  const { root, base } = repo();
  write(
    root,
    'src/lib.mjs',
    'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  );
  write(
    root,
    't/sub.test.mjs',
    `${HEAD}import * as lib from '../src/lib.mjs';\ntest('sub', () => assert.equal(lib.sub?.(3, 1), 2));\n`,
  );
  write(root, 'src/neu.mjs', 'export const neu = 1;\n');
  write(
    root,
    't/neu.test.mjs',
    `${HEAD}import { neu } from '../src/neu.mjs';\ntest('neu', () => assert.equal(neu, 1));\n`,
  );
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), { 't/sub.test.mjs': 'effective', 't/neu.test.mjs': 'effective' });
  assert.deepEqual(r.problems, []);
  assert.match(r.items[0].detail, /종료 코드 \d+/);
});

test('수정한 테스트 파일: 더한 케이스가 base에서 실패하면 effective, 통과하면 ineffective다', async () => {
  const a = repo();
  write(
    a.root,
    'src/lib.mjs',
    'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  );
  write(
    a.root,
    't/existing.test.mjs',
    `${PASSING}import * as lib from '../src/lib.mjs';\ntest('sub', () => assert.equal(lib.sub?.(3, 1), 2));\n`,
  );
  commitAll(a.root, 'change');
  assert.deepEqual(outcomes(await check(a.root, a.base, true)), {
    't/existing.test.mjs': 'effective',
  });

  const b = repo();
  write(
    b.root,
    't/existing.test.mjs',
    `${PASSING}test('again', () => assert.equal(add(2, 2), 4));\n`,
  );
  const r = await check(b.root, b.base);
  assert.deepEqual(outcomes(r), { 't/existing.test.mjs': 'ineffective' });
  assert.equal(r.problems.length, 1);
});

test('시간 초과는 effective다', async () => {
  const { root, base } = repo({ timeoutSec: 2 });
  write(
    root,
    't/slow.test.mjs',
    `${HEAD}test('slow', async () => { await new Promise((r) => setTimeout(r, 60000)); });\n`,
  );
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), { 't/slow.test.mjs': 'effective' });
  assert.match(r.items[0].detail, /시간 초과/);
});

test('예외 줄: 경로와 blob이 같고 이 변경이 고친 계획 파일에 있어야 exempt다', async () => {
  const { root, base } = repo();
  write(root, 't/new.test.mjs', PASSING);
  const line = (blob: string, reason = '기존 동작을 확인하는 테스트다') =>
    exemptLine('t/new.test.mjs', blob).replace('<한 줄>', reason);
  const plan = (l: string) => write(root, PLAN, `# 계획\n\n## 의사결정 로그\n\n${l}\n`);

  plan(line(blobOf(root, 't/new.test.mjs')));
  const ok = await check(root, base);
  assert.deepEqual(outcomes(ok), { 't/new.test.mjs': 'exempt' });
  assert.deepEqual(ok.problems, []);
  assert.match(ok.items[0].detail, /기존 동작을 확인하는 테스트다/);

  // blob이 다르다(예외를 적은 뒤 테스트 파일을 다시 고쳤다)
  write(root, 't/new.test.mjs', `${PASSING}// 고침\n`);
  assert.deepEqual(outcomes(await check(root, base)), { 't/new.test.mjs': 'ineffective' });

  // 사유가 비었다
  plan(line(blobOf(root, 't/new.test.mjs'), ''));
  assert.deepEqual(outcomes(await check(root, base)), { 't/new.test.mjs': 'ineffective' });
  // 사유 자리를 채우지 않았다
  plan(exemptLine('t/new.test.mjs', blobOf(root, 't/new.test.mjs')));
  assert.deepEqual(outcomes(await check(root, base)), { 't/new.test.mjs': 'ineffective' });
});

test('예외 줄: 이 변경이 고치지 않은 계획 파일의 줄은 인정하지 않는다', async () => {
  const { root } = repo();
  const blob = runSync('git', ['hash-object', '--stdin'], {
    cwd: root,
    input: PASSING,
  }).stdout.trim();
  write(
    root,
    PLAN,
    `# 계획\n\n${exemptLine('t/new.test.mjs', blob).replace('<한 줄>', '앞 step의 예외')}\n`,
  );
  const base = commitAll(root, 'base2');
  write(root, 't/new.test.mjs', PASSING);
  assert.equal(blobOf(root, 't/new.test.mjs'), blob);
  assert.deepEqual(outcomes(await check(root, base)), { 't/new.test.mjs': 'ineffective' });
});

test('parseExemptions: 줄 전체가 형식에 맞아야 읽는다', () => {
  const blob = 'a'.repeat(40);
  const good = exemptLine('t/a.test.mjs', blob).replace('<한 줄>', '리팩터');
  assert.deepEqual(parseExemptions(`앞\n${good}\n뒤\n`), [
    { file: 't/a.test.mjs', blob, reason: '리팩터' },
  ]);
  for (const bad of [
    `  ${good}`,
    good.replace(blob, 'a'.repeat(12)),
    good.replace(' — 사유: 리팩터', ''),
    good.replace('리팩터', ' '),
    `> ${good}`,
  ])
    assert.deepEqual(parseExemptions(bad), [], bad);
});

test('이전 판으로 되돌린 테스트 파일은 restored다(base에서 통과해도)', async () => {
  const { root } = repo();
  write(
    root,
    'src/lib.mjs',
    'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
  );
  write(
    root,
    't/existing.test.mjs',
    `${PASSING}import { sub } from '../src/lib.mjs';\ntest('sub', () => assert.equal(sub(3, 1), 2));\n`,
  );
  const base = commitAll(root, 'target');
  // 되돌리기: 테스트만 이전 판으로(코드는 그대로 둬서 base에서 통과하는 내용이다)
  write(root, 't/existing.test.mjs', PASSING);
  commitAll(root, 'revert');
  const r = await check(root, base, true);
  assert.deepEqual(outcomes(r), { 't/existing.test.mjs': 'restored' });
  assert.deepEqual(r.problems, []);
});

test('support 파일은 head 판으로 덮어쓴다', async () => {
  const { root, base } = repo();
  write(root, 't/helper.mjs', 'export const one = () => 1;\nexport const two = () => 2;\n');
  write(
    root,
    't/two.test.mjs',
    `${HEAD}import { two } from './helper.mjs';\ntest('two', () => assert.equal(two(), 2));\n`,
  );
  // 헬퍼를 덮어쓰지 않으면 base에서 "two 없음"으로 실패해 effective로 잘못 나온다
  assert.deepEqual(outcomes(await check(root, base)), { 't/two.test.mjs': 'ineffective' });
});

test('committedOnly면 커밋되지 않은 변경을 보지 않고, 아니면 추적되지 않은 새 파일도 본다', async () => {
  const { root, base } = repo();
  write(root, 't/new.test.mjs', PASSING);
  assert.deepEqual((await check(root, base, true)).items, []);
  assert.deepEqual(outcomes(await check(root, base, false)), { 't/new.test.mjs': 'ineffective' });
});

test('삭제된 테스트 파일과 대상이 아닌 파일은 보지 않는다', async () => {
  const { root, base } = repo();
  sh('git', ['rm', '-q', 't/existing.test.mjs'], root);
  write(root, 'src/other.test.mjs', PASSING);
  const r = await check(root, base);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.problems, []);
  assert.equal(r.skipped, false);
});

test('설정이 null이거나 base가 없으면 skipped다', async () => {
  const off = repo({ testEffect: null });
  write(off.root, 't/new.test.mjs', PASSING);
  assert.equal((await check(off.root, off.base)).skipped, true);
  const noBase = repo();
  write(noBase.root, 't/new.test.mjs', PASSING);
  const r = await check(noBase.root, null);
  assert.equal(r.skipped, true);
  assert.deepEqual(r.items, []);
});

test('심볼릭 링크로 커밋된 테스트 파일은 invalid다', async () => {
  const { root, base } = repo();
  const blob = runSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: root,
    input: 'existing.test.mjs',
  }).stdout.trim();
  sh('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},t/link.test.mjs`], root);
  sh('git', ['commit', '-q', '-m', 'link'], root);
  const r = await check(root, base, true);
  assert.deepEqual(outcomes(r), { 't/link.test.mjs': 'invalid' });
  assert.equal(r.problems.length, 1);
});

test('테스트 출력을 결과에 옮기지 않고, 임시 worktree를 남기지 않고, head 작업 트리를 바꾸지 않는다', async () => {
  const { root, base } = repo({ link: ['deps'] });
  write(root, 'deps/val.mjs', 'export const val = 7;\n');
  // deps는 .gitignore에 있어 base 체크아웃에 없다. 연결되면 base에서 통과하고, 안 되면 모듈 없음으로 실패한다
  write(
    root,
    't/dep.test.mjs',
    `${HEAD}import { val } from '../deps/val.mjs';\nconsole.log('${MARK}');\nconsole.error('${MARK}');\ntest('val', () => assert.equal(val, 7));\n`,
  );
  write(
    root,
    't/fail.test.mjs',
    `${HEAD}console.log('${MARK}');\ntest('fail', () => assert.fail('${MARK}'));\n`,
  );
  const before = sh('git', ['status', '--porcelain'], root);
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), {
    't/dep.test.mjs': 'ineffective',
    't/fail.test.mjs': 'effective',
  });
  assert.ok(!JSON.stringify(r).includes(MARK), '결과에 테스트 출력이 들어 있다');
  assert.equal(sh('git', ['status', '--porcelain'], root), before);
  assert.equal(
    sh('git', ['worktree', 'list', '--porcelain'], root).match(/^worktree /gm)?.length,
    1,
  );
  assert.ok(existsSync(path.join(root, 'deps/val.mjs')), '연결한 원본이 지워졌다');
});

/** 리포 밖 폴더(파일 하나, 빈 폴더 하나)를 가리키는 심볼릭 링크를 base 커밋에 넣는다. 작업 트리에는 만들지 않는다 */
function withLinks(
  over: Record<string, unknown>,
  links: (outside: string) => Record<string, string>,
): { root: string; base: string; outside: string } {
  const { root } = repo(over);
  const outside = tmp('harness-test-outside-');
  write(outside, 'helper.mjs', 'export const one = () => 1;\n');
  write(outside, 'dir/.keep', '');
  for (const [rel, target] of Object.entries(links(outside))) {
    if (existsSync(path.join(root, rel))) sh('git', ['rm', '-q', rel], root);
    const blob = runSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: target });
    sh(
      'git',
      ['update-index', '--add', '--cacheinfo', `120000,${blob.stdout.trim()},${rel}`],
      root,
    );
  }
  sh('git', ['commit', '-q', '-m', 'links'], root);
  return { root, base: sh('git', ['rev-parse', 'HEAD'], root), outside };
}
const outsideState = (outside: string) => ({
  helper: readFileSync(path.join(outside, 'helper.mjs'), 'utf8'),
  dir: readdirSync(path.join(outside, 'dir')),
});
const UNTOUCHED = { helper: 'export const one = () => 1;\n', dir: ['.keep'] };

test('링크를 따라가지 않는다: base에서 링크였던 support 파일은 링크를 지우고 일반 파일로 덮어쓴다', async () => {
  const { root, base, outside } = withLinks({}, (o) => ({
    't/helper.mjs': path.join(o, 'helper.mjs'),
  }));
  write(root, 't/helper.mjs', 'export const one = () => 1;\nexport const two = () => 2;\n');
  write(
    root,
    't/two.test.mjs',
    `${HEAD}import { two } from './helper.mjs';\ntest('two', () => assert.equal(two(), 2));\n`,
  );
  const r = await check(root, base);
  assert.deepEqual(outsideState(outside), UNTOUCHED);
  assert.deepEqual(outcomes(r), { 't/two.test.mjs': 'ineffective' });
});

test('링크를 따라가지 않는다: base에서 링크였던 폴더 아래의 테스트 파일은 invalid다', async () => {
  const { root, base, outside } = withLinks({ files: ['t/*.test.mjs', 'd/*.test.mjs'] }, (o) => ({
    d: path.join(o, 'dir'),
  }));
  write(root, 'd/new.test.mjs', `${HEAD}test('x', () => assert.fail('x'));\n`);
  write(root, 't/fail.test.mjs', `${HEAD}test('x', () => assert.fail('x'));\n`);
  const local = await check(root, base);
  assert.deepEqual(outsideState(outside), UNTOUCHED);
  assert.deepEqual(outcomes(local), {
    'd/new.test.mjs': 'invalid',
    't/fail.test.mjs': 'effective',
  });
  assert.equal(local.problems.length, 1);

  commitAll(root, 'change');
  const committed = await check(root, base, true);
  assert.deepEqual(outsideState(outside), UNTOUCHED);
  assert.deepEqual(outcomes(committed), {
    'd/new.test.mjs': 'invalid',
    't/fail.test.mjs': 'effective',
  });
});

test('링크를 따라가지 않는다: support 파일이나 link의 상위 경로가 링크면 아무것도 실행하지 않는다', async () => {
  const a = withLinks({ support: ['d/helper.mjs'] }, (o) => ({ d: path.join(o, 'dir') }));
  write(a.root, 'd/helper.mjs', 'export const two = () => 2;\n');
  write(a.root, 't/fail.test.mjs', `${HEAD}test('x', () => assert.fail('x'));\n`);
  const ra = await check(a.root, a.base);
  assert.deepEqual(outsideState(a.outside), UNTOUCHED);
  assert.deepEqual(outcomes(ra), { 't/fail.test.mjs': 'invalid' });
  assert.match(ra.items[0].detail, /d\/helper\.mjs/);

  const b = withLinks({ link: ['d/deps'] }, (o) => ({ d: path.join(o, 'dir') }));
  write(b.root, 'd/deps/val.mjs', 'export const val = 7;\n');
  write(b.root, 't/fail.test.mjs', `${HEAD}test('x', () => assert.fail('x'));\n`);
  const rb = await check(b.root, b.base);
  assert.deepEqual(outsideState(b.outside), UNTOUCHED);
  assert.deepEqual(outcomes(rb), { 't/fail.test.mjs': 'invalid' });
  assert.match(rb.items[0].detail, /d\/deps/);
});

test('`-`로 시작하는 경로는 실행하지 않고 invalid다(명령의 옵션으로 읽힌다)', async () => {
  const { root, base } = repo({ files: ['*.test.mjs'] });
  write(root, '-x.test.mjs', `${HEAD}test('x', () => assert.fail('x'));\n`);
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), { '-x.test.mjs': 'invalid' });
  assert.equal(r.problems.length, 1);
});

test('명령을 실행할 수 없으면 effective로 세지 않고 invalid다', async () => {
  const { root, base } = repo({ command: ['harness-no-such-command-xyz'] });
  write(root, 't/new.test.mjs', PASSING);
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), { 't/new.test.mjs': 'invalid' });
  assert.equal(r.problems.length, 1);
});

const cli = (root: string, args: string[]) =>
  runSync(
    process.execPath,
    [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'test-effect', ...args],
    {
      cwd: root,
    },
  );

test('CLI: 종료 코드와 마지막 줄, 출력에 테스트 출력이 없다', () => {
  const { root, base } = repo();
  write(
    root,
    't/fail.test.mjs',
    `${HEAD}console.log('${MARK}');\ntest('fail', () => assert.fail('x'));\n`,
  );
  const pass = cli(root, ['--base', base]);
  assert.equal(pass.code, 0, pass.stderr);
  assert.match(pass.stdout, /t\/fail\.test\.mjs: effective/);
  assert.match(pass.stdout.trimEnd(), /test-effect: 통과$/);

  write(root, 't/new.test.mjs', `${PASSING}console.log('${MARK}');\n`);
  const fail = cli(root, ['--base', base]);
  assert.equal(fail.code, 1);
  assert.match(fail.stderr, /\[R5 테스트 실효성\]/);
  assert.match(fail.stdout.trimEnd(), /test-effect: 1건$/);
  assert.ok(!`${pass.stdout}${pass.stderr}${fail.stdout}${fail.stderr}`.includes(MARK));

  // --ci면 커밋된 변경만 본다(커밋된 변경이 없다)
  const ci = cli(root, ['--ci', '--base', base]);
  assert.equal(ci.code, 0, ci.stderr);

  const off = repo({ testEffect: null });
  const none = cli(off.root, ['--base', off.base]);
  assert.equal(none.code, 0);
  assert.match(none.stdout.trimEnd(), /test-effect: 해당 없음\(.+\)$/);
});

const PATTERN = 'AssertionError|ERR_ASSERTION';
const reasons = (r: Awaited<ReturnType<typeof check>>) =>
  Object.fromEntries(r.items.map((i) => [i.file, i.reason]));
const LIB2 = 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n';
const ASSERTING = `${HEAD}import * as lib from '../src/lib.mjs';\ntest('sub', () => assert.equal(lib.sub?.(3, 1), 2));\n`;
const NEW_MODULE = `${HEAD}import { neu } from '../src/neu.mjs';\ntest('neu', () => assert.equal(neu, 1));\n`;

test('실패 이유: 단언 실패는 assertion, 그 밖(모듈 없음)은 other이고 둘 다 통과다', async () => {
  const { root, base } = repo({ assertPattern: PATTERN });
  write(root, 'src/lib.mjs', LIB2);
  write(root, 't/sub.test.mjs', ASSERTING);
  write(root, 'src/neu.mjs', 'export const neu = 1;\n');
  write(root, 't/neu.test.mjs', NEW_MODULE);
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), { 't/sub.test.mjs': 'effective', 't/neu.test.mjs': 'effective' });
  assert.deepEqual(reasons(r), { 't/sub.test.mjs': 'assertion', 't/neu.test.mjs': 'other' });
  assert.deepEqual(r.problems, []);
  const detail = Object.fromEntries(r.items.map((i) => [i.file, i.detail]));
  assert.match(detail['t/sub.test.mjs'], /^base에서 단언 실패, 종료 코드 \d+$/);
  assert.match(
    detail['t/neu.test.mjs'],
    /^base에서 실패\(단언 실패 아님: 모듈 없음 등\), 종료 코드 \d+$/,
  );
  // 그 밖의 실패가 있으면 안내 한 줄(파일 수)
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /1개/);
  assert.match(r.notes[0], /단언을 확인하지 못했다/);
});

test('실패 이유: 그 밖의 실패가 없으면 notes는 비어 있다', async () => {
  const { root, base } = repo({ assertPattern: PATTERN });
  write(root, 'src/lib.mjs', LIB2);
  write(root, 't/sub.test.mjs', ASSERTING);
  const r = await check(root, base);
  assert.deepEqual(reasons(r), { 't/sub.test.mjs': 'assertion' });
  assert.deepEqual(r.notes, []);
});

test('실패 이유: 시간 초과는 timeout, 실행하지 않았거나 통과한 판정은 null이다', async () => {
  const slow = repo({ assertPattern: PATTERN, timeoutSec: 2 });
  write(
    slow.root,
    't/slow.test.mjs',
    `${HEAD}test('slow', async () => { await new Promise((r) => setTimeout(r, 60000)); });\n`,
  );
  const rs = await check(slow.root, slow.base);
  assert.deepEqual(reasons(rs), { 't/slow.test.mjs': 'timeout' });
  assert.deepEqual(rs.notes, []);

  const { root, base } = repo({ assertPattern: PATTERN, files: ['t/*.test.mjs', '*.test.mjs'] });
  write(root, 't/pass.test.mjs', PASSING); // ineffective
  write(root, 't/exempt.test.mjs', `${PASSING}// 예외\n`);
  write(
    root,
    PLAN,
    `# 계획\n\n${exemptLine('t/exempt.test.mjs', blobOf(root, 't/exempt.test.mjs')).replace('<한 줄>', '기존 동작')}\n`,
  );
  write(root, '-x.test.mjs', PASSING); // invalid
  const r = await check(root, base);
  assert.deepEqual(outcomes(r), {
    '-x.test.mjs': 'invalid',
    't/exempt.test.mjs': 'exempt',
    't/pass.test.mjs': 'ineffective',
  });
  assert.deepEqual(reasons(r), {
    '-x.test.mjs': null,
    't/exempt.test.mjs': null,
    't/pass.test.mjs': null,
  });
});

test('실패 이유: assertPattern이 없으면 구분하지 않고 판정 줄은 그대로다', async () => {
  const { root, base } = repo();
  write(root, 'src/lib.mjs', LIB2);
  write(root, 't/sub.test.mjs', ASSERTING);
  write(root, 'src/neu.mjs', 'export const neu = 1;\n');
  write(root, 't/neu.test.mjs', NEW_MODULE);
  const r = await check(root, base);
  assert.deepEqual(reasons(r), { 't/sub.test.mjs': null, 't/neu.test.mjs': null });
  for (const i of r.items) assert.match(i.detail, /^base에서 실패, 종료 코드 \d+$/);
  assert.deepEqual(r.notes, []);
});

test('실패 이유: 단언 메시지와 출력의 표식이 결과와 CLI 출력에 없고, CLI는 참고 줄을 내고 0으로 끝난다', async () => {
  const { root, base } = repo({ assertPattern: PATTERN });
  write(
    root,
    't/msg.test.mjs',
    `${HEAD}console.log('${MARK}');\ntest('msg', () => assert.equal(1, 2, '${MARK}'));\n`,
  );
  write(root, 'src/neu.mjs', 'export const neu = 1;\n');
  write(root, 't/neu.test.mjs', `${NEW_MODULE}console.error('${MARK}');\n`);
  const r = await check(root, base);
  assert.deepEqual(reasons(r), { 't/msg.test.mjs': 'assertion', 't/neu.test.mjs': 'other' });
  assert.ok(!JSON.stringify(r).includes(MARK), '결과에 테스트 출력이 들어 있다');

  const out = cli(root, ['--base', base]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /t\/msg\.test\.mjs: effective\(base에서 단언 실패, 종료 코드 \d+\)/);
  assert.match(out.stdout, /t\/neu\.test\.mjs: effective\(base에서 실패\(단언 실패 아님/);
  assert.match(out.stdout, /^참고: .*1개/m);
  assert.match(out.stdout.trimEnd(), /test-effect: 통과$/);
  assert.ok(!`${out.stdout}${out.stderr}`.includes(MARK));
});

test('실패 이유: 단언 실패로 끝난 테스트 파일이 여러 개여도 모두 assertion이다(정규식에 상태가 없다)', async () => {
  const { root, base } = repo({ assertPattern: PATTERN });
  write(root, 'src/lib.mjs', LIB2);
  const files = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `t/sub-${n}.test.mjs`);
  for (const f of files) write(root, f, ASSERTING);
  const r = await check(root, base);
  assert.deepEqual(reasons(r), Object.fromEntries(files.map((f) => [f, 'assertion'])));
  assert.deepEqual(r.notes, []);
  // 설정은 정규식의 원문만 받는다. 플래그(g·y)를 줄 방법이 없어 lastIndex를 쓰지 않는다
  assert.equal(new RegExp(PATTERN).flags, '');
});
