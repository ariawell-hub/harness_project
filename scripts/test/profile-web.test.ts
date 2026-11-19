// 웹 프로파일(profiles/web): init으로 적용한 설정이 검증을 통과하고 testEffect가 채워져 있다(TD-42).
import assert from 'node:assert/strict';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../commands/init.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { matchesAny } from '../lib/util.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

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
    support: ['src/test/**'],
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
