// 웹 프로파일(profiles/web): init으로 적용한 설정이 검증을 통과하고 testEffect가 채워져 있다(TD-42).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../commands/init.ts';
import { testEffect } from '../gates/test-effect.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { matchesAny } from '../lib/util.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const WRAPPER = 'profiles/web/test-effect/run-one.mjs';

/** 이 리포의 profiles/web과 harness.config.json을 임시 폴더에 복사하고 웹 프로파일을 적용한다 */
function webRepo(): string {
  const root = tmp('harness-profile-web-');
  cpSync(path.join(HARNESS_ROOT, 'profiles', 'web'), path.join(root, 'profiles', 'web'), {
    recursive: true,
  });
  cpSync(path.join(HARNESS_ROOT, 'harness.config.json'), path.join(root, 'harness.config.json'));
  assert.equal(init(root, 'web', {}), 0);
  return root;
}

test('웹 프로파일을 적용한 설정이 loadConfig 검증을 통과하고 testEffect가 채워져 있다', () => {
  const cfg = loadConfig(webRepo());
  assert.equal(cfg.profile, 'web');
  assert.deepEqual(cfg.testEffect, {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    support: ['src/test/**', 'profiles/web/test-effect/**'],
    command: ['node', WRAPPER],
    timeoutSec: 300,
    link: ['node_modules'],
    assertPattern: 'AssertionError',
  });
});

test('testEffect.files는 src 아래 Vitest 테스트에만 맞는다(E2E 시나리오는 대상이 아니다)', () => {
  const files = loadConfig(webRepo()).testEffect!.files;
  for (const f of ['src/a.test.ts', 'src/domain/user/user.test.tsx'])
    assert.equal(matchesAny(f, files), true, f);
  for (const f of ['e2e/login.spec.ts', 'src/a.ts', 'tests/a.test.ts'])
    assert.equal(matchesAny(f, files), false, f);
});

test('testEffect.support는 공용 테스트 도구(src/test)에 맞는다', () => {
  const support = loadConfig(webRepo()).testEffect!.support;
  assert.equal(matchesAny('src/test/setup.ts', support), true);
  assert.equal(matchesAny('src/domain/user/user.ts', support), false);
});

test('testEffect.command는 node로 래퍼를 실행하고 그 래퍼가 이 리포에 있다', () => {
  const command = loadConfig(webRepo()).testEffect!.command;
  assert.deepEqual(command, ['node', WRAPPER]);
  assert.equal(existsSync(path.join(HARNESS_ROOT, WRAPPER)), true);
});

test('assertPattern은 단언 실패 출력에만 맞는다', () => {
  const re = new RegExp(loadConfig(webRepo()).testEffect!.assertPattern!);
  assert.equal(re.test('AssertionError: expected 1 to be 2'), true);
  assert.equal(re.test("Error: Cannot find module './nope'"), false);
});

test('래퍼는 인자가 정확히 하나가 아니면 Vitest를 불러오기 전에 종료 코드 2로 끝난다', () => {
  const wrapper = path.join(HARNESS_ROOT, WRAPPER);
  // 이 리포에는 Vitest가 없다. 인자 검사가 import보다 먼저여야 2가 나온다
  const none = runSync(process.execPath, [wrapper], { cwd: HARNESS_ROOT });
  assert.equal(none.code, 2, none.stderr);
  assert.match(none.stderr, /사용법/);
  const two = runSync(process.execPath, [wrapper, 'src/a.test.ts', 'src/b.test.ts'], {
    cwd: HARNESS_ROOT,
  });
  assert.equal(two.code, 2, two.stderr);
});

// --- 웹 프로파일을 처음 적용하는 변경(변경 전 코드에 래퍼가 없다) ---

/** 가짜 Vitest: include의 파일 하나를 import해 실행한다. 실패하면 오류를 내고 종료 코드 1 */
const FAKE_VITEST = `import path from 'node:path';
import { pathToFileURL } from 'node:url';
export async function startVitest(mode, filters, options) {
  const file = options.include[0].replace(/\\\\(.)/g, '$1');
  try {
    await import(pathToFileURL(path.resolve(file)).href);
  } catch (e) {
    console.error(e && e.stack ? e.stack : String(e));
    process.exitCode = 1;
  }
  return { close: async () => {} };
}
`;
const TEST_HEAD = "import assert from 'node:assert/strict';\n";

/**
 * 웹 프로파일의 testEffect를 쓰는 리포. 기준 커밋에는 래퍼(profiles/web/test-effect)가 없고,
 * 작업 트리가 이 리포의 실제 래퍼를 더한다. Vitest는 가짜 패키지다
 */
function adoptingRepo(): { root: string; base: string } {
  const root = path.join(tmp('harness-web-adopt-'), 'r');
  gitInit(root);
  const profile = JSON.parse(
    readFileSync(path.join(HARNESS_ROOT, 'profiles', 'web', 'profile.json'), 'utf8'),
  ) as { config: { testEffect: unknown } };
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ testEffect: profile.config.testEffect })),
  );
  write(root, '.gitignore', 'node_modules/\n');
  write(
    root,
    'src/math.ts',
    'export const add = (a: number, b: number) => a + b;\nexport const clamp = (x: number) => x;\n',
  );
  const base = commitAll(root, 'base: 래퍼 없음');
  mkdirSync(path.dirname(path.join(root, WRAPPER)), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, WRAPPER), path.join(root, WRAPPER));
  write(
    root,
    'node_modules/vitest/package.json',
    JSON.stringify({ name: 'vitest', type: 'module', exports: { './node': './node.js' } }),
  );
  write(root, 'node_modules/vitest/node.js', FAKE_VITEST);
  write(
    root,
    'src/math.ts',
    'export const add = (a: number, b: number) => a + b;\nexport const clamp = (x: number) => Math.min(x, 10);\n',
  );
  return { root, base };
}

test('래퍼가 없는 기준 커밋 위에 웹 프로파일과 테스트를 함께 더해도 변경 전 코드에서 테스트를 실제로 돌린다', async () => {
  const { root, base } = adoptingRepo();
  // 변경 전 코드에서도 통과하는 테스트와 단언이 실패하는 테스트
  write(
    root,
    'src/keep.test.ts',
    `${TEST_HEAD}import { add } from './math.ts';\nassert.equal(add(1, 2), 3);\n`,
  );
  write(
    root,
    'src/app/(shop)/[id]/clamp.test.ts',
    `${TEST_HEAD}import { clamp } from '../../../math.ts';\nassert.equal(clamp(11), 10);\n`,
  );
  const r = await testEffect(root, loadConfig(root), { base, committedOnly: false });
  const got = Object.fromEntries(r.items.map((i) => [i.file, [i.outcome, i.reason]]));
  assert.deepEqual(got, {
    'src/app/(shop)/[id]/clamp.test.ts': ['effective', 'assertion'],
    'src/keep.test.ts': ['ineffective', null],
  });
});

test('testEffect.support는 래퍼 폴더에 맞는다(이 변경이 더하거나 고친 래퍼가 변경 전 코드 위에 놓인다)', () => {
  const support = loadConfig(webRepo()).testEffect!.support;
  assert.equal(matchesAny(WRAPPER, support), true);
  assert.equal(matchesAny('profiles/web/profile.json', support), false);
});
