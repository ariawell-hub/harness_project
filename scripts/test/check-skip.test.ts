// check의 test 건너뛰기(6절, Issue #129): 바뀐 파일이 모두 testInertPaths 안일 때만 test를 돌리지 않는다.
// 픽스처의 test 명령은 항상 실패한다. 돌았으면 실패, 건너뛰었으면 통과로 구분된다.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cacheKey, runCheck, testInert, testSkip } from '../commands/check.ts';
import { ConfigError, loadConfig } from '../lib/config.ts';
import { repoInfo } from '../lib/git.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const INERT = ['plans/**', 'lab/**'];
const PROTECTED = ['scripts/**', 'harness.config.json', 'plans/TEMPLATE*.md'];
const FAILING_TEST = { run: `"${process.execPath}" -e "process.exit(1)"`, timeoutSec: 60 };

function config(over: Record<string, unknown> = {}): string {
  const c = fixtureConfig({ testInertPaths: INERT, protectedPaths: PROTECTED, ...over });
  (c.commands as Record<string, unknown>).test = FAILING_TEST;
  return JSON.stringify(c, null, 2);
}

/** main에 base 커밋을 두고 작업 브랜치로 옮긴 리포 */
function repo(over: Record<string, unknown> = {}): { root: string; base: string } {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(root, 'harness.config.json', config(over));
  write(root, 'scripts/a.ts', 'export const a = 1;\n');
  write(root, 'plans/TEMPLATE.md', '# 틀\n');
  write(root, 'plans/p1.md', '# 계획\n');
  const base = commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'feat/x'], root);
  return { root, base };
}

const check = (
  root: string,
  base: string | null,
  o: { ci?: boolean; env?: NodeJS.ProcessEnv } = {},
) =>
  runCheck(repoInfo(root), loadConfig(root), {
    base,
    ci: o.ci,
    env: o.env ?? {},
    only: ['test'],
    noCache: true,
    noRecord: true,
    quiet: true,
  });
const shape = (r: Awaited<ReturnType<typeof check>>) =>
  r.results.map((x) => [x.name, x.ok, x.skipped]);
const RAN = [['test', false, false]];
const SKIPPED = [['test', true, true]];

test('check(test): 바뀐 파일이 모두 testInertPaths 안이면 test를 건너뛰고 이유를 남긴다', async () => {
  const { root, base } = repo();
  write(root, 'plans/p1.md', '# 계획\n\n- 진행\n');
  write(root, 'lab/out/result.json', '{}\n'); // 추적되지 않은 새 파일도 센다
  const r = await check(root, base);
  assert.equal(r.ok, true);
  assert.deepEqual(shape(r), SKIPPED);
  assert.match(r.results[0].output, /바뀐 파일 2개/);
  assert.match(r.results[0].output, /testInertPaths/);

  // 커밋한 뒤 CI 방식(커밋된 변경만)으로도 같다
  commitAll(root, 'plan');
  assert.deepEqual(shape(await check(root, base, { ci: true })), SKIPPED);
});

test('check(test): 목록 밖 파일이 하나라도 바뀌면 test를 돌린다', async () => {
  const { root, base } = repo();
  write(root, 'plans/p1.md', '# 계획 2\n');
  write(root, 'docs/guide.md', '# 안내\n');
  const r = await check(root, base);
  assert.equal(r.ok, false);
  assert.deepEqual(shape(r), RAN);
});

test('check(test): 바뀐 파일이 없거나, 설정이 없거나, base가 없으면 test를 돌린다', async () => {
  const none = repo();
  assert.deepEqual(shape(await check(none.root, none.base)), RAN);

  for (const over of [{ testInertPaths: [] }, { testInertPaths: undefined }]) {
    const off = repo(over);
    write(off.root, 'plans/p1.md', '# 계획 2\n');
    assert.deepEqual(shape(await check(off.root, off.base)), RAN);
  }

  const noBase = repo();
  write(noBase.root, 'plans/p1.md', '# 계획 2\n');
  assert.deepEqual(shape(await check(noBase.root, null)), RAN);
});

test('check(test): 기본 브랜치에서는 건너뛰지 않는다(브랜치 이름, GITHUB_REF)', async () => {
  const { root, base } = repo();
  write(root, 'plans/p1.md', '# 계획 2\n');
  commitAll(root, 'plan');
  // main push의 CI: GITHUB_REF가 기본 브랜치다
  assert.deepEqual(
    shape(await check(root, base, { ci: true, env: { GITHUB_REF: 'refs/heads/main' } })),
    RAN,
  );
  // PR의 CI: 병합 ref다
  assert.deepEqual(
    shape(await check(root, base, { ci: true, env: { GITHUB_REF: 'refs/pull/7/merge' } })),
    SKIPPED,
  );
  // 기본 브랜치를 체크아웃한 상태
  sh('git', ['checkout', '-q', 'main'], root);
  sh('git', ['merge', '-q', '--ff-only', 'feat/x'], root);
  assert.deepEqual(shape(await check(root, base, { ci: true })), RAN);
});

test('check(test): 보호 경로의 파일은 testInertPaths에 걸려도 건너뛰는 근거가 아니다', async () => {
  const { root, base } = repo();
  write(root, 'plans/TEMPLATE.md', '# 틀 2\n'); // plans/** 이면서 보호 경로
  assert.deepEqual(shape(await check(root, base)), RAN);

  // 설정을 넓게 잘못 적어도 보호 경로 변경에서는 test가 돈다
  const wide = repo({ testInertPaths: ['**'] });
  write(wide.root, 'scripts/a.ts', 'export const a = 2;\n');
  assert.deepEqual(shape(await check(wide.root, wide.base)), RAN);
  // 설정 파일 자신도 보호 경로다: 목록을 넓히는 변경은 그 변경에서 test가 돈다
  const self = repo();
  writeFileSync(path.join(self.root, 'harness.config.json'), config({ testInertPaths: ['**'] }));
  assert.deepEqual(shape(await check(self.root, self.base)), RAN);
});

test('check(test): 이름 바꾸기와 삭제는 옛 경로로도 센다', async () => {
  const mv = repo({ protectedPaths: ['harness.config.json'] });
  write(mv.root, 'src/b.ts', 'export const b = 1;\n');
  write(mv.root, 'lab/.keep', '');
  const base = commitAll(mv.root, 'src');
  sh('git', ['mv', 'src/b.ts', 'lab/b.ts'], mv.root);
  commitAll(mv.root, 'mv');
  // 새 경로(lab/b.ts)만 보면 목록 안이다. 옛 경로(src/b.ts)가 목록 밖이라 돌아야 한다
  assert.deepEqual(shape(await check(mv.root, base, { ci: true })), RAN);

  const rm = repo({ protectedPaths: ['harness.config.json'] });
  write(rm.root, 'src/b.ts', 'export const b = 1;\n');
  const base2 = commitAll(rm.root, 'src');
  sh('git', ['rm', '-q', 'src/b.ts'], rm.root);
  write(rm.root, 'plans/p1.md', '# 계획 2\n');
  assert.deepEqual(shape(await check(rm.root, base2)), RAN);
});

test('testSkip: 판정과 이유를 돌려준다', () => {
  const { root, base } = repo();
  const info = repoInfo(root);
  const cfg = loadConfig(root);
  const o = { base, committedOnly: false, env: {} };
  assert.deepEqual(testSkip(info, cfg, o).skip, false); // 바뀐 파일 없음
  write(root, 'lab/x.json', '{}\n');
  const yes = testSkip(info, cfg, o);
  assert.equal(yes.skip, true);
  assert.match(yes.reason, /바뀐 파일 1개.*testInertPaths/);
  write(root, 'scripts/a.ts', 'export const a = 3;\n');
  const no = testSkip(info, cfg, o);
  assert.equal(no.skip, false);
  assert.match(no.reason, /scripts\/a\.ts/);
});

test('check 캐시 키: testInertPaths가 바뀌면 키가 달라진다', () => {
  const { root, base } = repo();
  const info = repoInfo(root);
  const cfg = loadConfig(root);
  const a = cacheKey(info, cfg, base);
  const b = cacheKey(info, { ...cfg, testInertPaths: [...INERT, 'notes/**'] }, base);
  assert.notEqual(a, b);
});

test('loadConfig: testInertPaths는 없으면 []이고, 리포 안 상대 경로 glob 배열이 아니면 ConfigError다', () => {
  const dir = tmp('harness-skip-cfg-');
  const put = (v: unknown) =>
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify(fixtureConfig(v === undefined ? {} : { testInertPaths: v })),
    );
  put(undefined);
  assert.deepEqual(loadConfig(dir).testInertPaths, []);
  put(['lab/**']);
  assert.deepEqual(loadConfig(dir).testInertPaths, ['lab/**']);
  for (const bad of ['lab/**', [1], [''], ['/abs/**'], ['../out/**'], ['a/../b'], ['C:\\x']]) {
    put(bad);
    assert.throws(
      () => loadConfig(dir),
      (e: unknown) => e instanceof ConfigError && /testInertPaths/.test(e.message),
      JSON.stringify(bad),
    );
  }
});

test('이 리포의 설정: 테스트가 읽는 파일은 건너뛰기 대상이 아니고, 계획 폴더와 lab은 대상이다', () => {
  const cfg = loadConfig(HARNESS_ROOT);
  // 테스트 픽스처와 자체 테스트가 실제 리포에서 복사하거나 읽는 파일(helpers.ts, selftest.test.ts, selftest/run.ts)
  const read = [
    'scripts/harness.ts',
    'scripts/test/helpers.ts',
    'scripts/cross-review/verdict.schema.json',
    '.github/workflows/check.yml',
    '.github/workflows/gates.yml',
    '.github/CODEOWNERS',
    '.claude/settings.json',
    '.claude/runner-settings.json',
    '.gitattributes',
    'harness.config.json',
    'profiles/core/profile.json',
    'pnpm-lock.yaml',
    'package.json',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/exec-plans/TEMPLATE.md',
    'docs/exec-plans/TEMPLATE-small.md',
    'docs/exec-plans/TEMPLATE-step.md',
    'docs/exec-plans/tech-debt-tracker.md',
    'docs/harness/workflow.md',
    'docs/harness/design.md',
  ];
  for (const f of read) assert.equal(testInert(f, cfg), false, f);
  for (const f of [
    'docs/exec-plans/active/20261119-x.md',
    'docs/exec-plans/active/20261116-y/steps/step7.md',
    'docs/exec-plans/completed/20261118-z.md',
    'lab/ops-transition/results/target-repo.json',
  ])
    assert.equal(testInert(f, cfg), true, f);
});
