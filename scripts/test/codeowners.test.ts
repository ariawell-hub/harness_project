// CODEOWNERS 생성·검사(10.4절 운영 전환 체크리스트 2). 계획 20261116-ops-security step4.
// 단일 원본은 harness.config.json의 protectedPaths다. 파일은 `codeowners --write`가 만든다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  CODEOWNERS_FILE,
  codeownersPattern,
  codeownersProblems,
  codeownersText,
} from '../gates/codeowners.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { HARNESS_ROOT, fixtureConfig, makeFixture, write, type Fixture } from './helpers.ts';

const PATHS = ['scripts/**', '.gitignore', 'docs/exec-plans/TEMPLATE*.md'];

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });

// 임시 리포는 파일 전체가 하나를 나눠 쓴다(만드는 데 몇 초 걸린다)
let shared: Fixture | null = null;
after(() => shared?.cleanup());

/** 설정을 바꿔 다시 읽는다 */
function setConfig(root: string, over: Record<string, unknown>): HarnessConfig {
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig(over), null, 2));
  return loadConfig(root);
}

/** 보호 경로 셋이 있고 CODEOWNERS는 없는 리포 */
function fresh(over: Record<string, unknown> = {}): { root: string; cfg: HarnessConfig } {
  const fx = (shared ??= makeFixture());
  rmSync(path.join(fx.root, CODEOWNERS_FILE), { force: true });
  return { root: fx.root, cfg: setConfig(fx.root, { protectedPaths: PATHS, ...over }) };
}

test('codeownersPattern: 폴더 전체(`X/**`)는 `/X/`, 그 밖은 앞에 `/`를 붙인다', () => {
  assert.equal(codeownersPattern('scripts/**'), '/scripts/');
  assert.equal(codeownersPattern('.github/**'), '/.github/');
  assert.equal(codeownersPattern('.gitignore'), '/.gitignore');
  assert.equal(codeownersPattern('harness.config.json'), '/harness.config.json');
  assert.equal(codeownersPattern('docs/exec-plans/TEMPLATE*.md'), '/docs/exec-plans/TEMPLATE*.md');
  assert.equal(codeownersPattern('apps/*/**'), '/apps/*/');
});

test('codeownersPattern: CODEOWNERS 문법으로 옮길 수 없는 glob은 null이다', () => {
  for (const g of [
    'a/**/b',
    '**/x',
    '**',
    'a/**/',
    'a b',
    'a/[xy].ts',
    '!a',
    '/abs',
    'a/',
    'a//b',
    'a?.ts',
    '#x',
    'a\\b',
    '',
  ])
    assert.equal(codeownersPattern(g), null, g);
});

test('codeownersText: 이 리포의 보호 경로 전체가 설정 순서대로 한 줄씩 있고 소유자가 제작자 계정이다', () => {
  const cfg = loadConfig(HARNESS_ROOT);
  const lines = codeownersText(cfg).split('\n');
  assert.match(lines[0], /^# 생성 파일: `node scripts\/harness\.ts codeowners --write`/);
  const rules = lines.filter((l) => l && !l.startsWith('#'));
  assert.equal(rules.length, cfg.protectedPaths.length);
  assert.deepEqual(
    rules,
    cfg.protectedPaths.map((g) => `${codeownersPattern(g)} @${cfg.github.owner}`),
  );
  assert.ok(rules.includes('/scripts/ @ariawell-hub'));
  assert.ok(rules.includes('/.github/ @ariawell-hub'));
  assert.ok(rules.includes('/docs/exec-plans/TEMPLATE*.md @ariawell-hub'));
  assert.ok(codeownersText(cfg).endsWith('\n'));
});

test('이 리포의 .github/CODEOWNERS는 생성 결과와 같다', () => {
  const cfg = loadConfig(HARNESS_ROOT);
  assert.deepEqual(codeownersProblems(HARNESS_ROOT, cfg), []);
  assert.equal(
    readFileSync(path.join(HARNESS_ROOT, CODEOWNERS_FILE), 'utf8').replace(/\r\n/g, '\n'),
    codeownersText(cfg),
  );
});

test('codeownersProblems: 파일 없음, 한 줄 다름, 옮길 수 없는 glob, 소유자 형식을 알린다', () => {
  const { root, cfg } = fresh();
  const missing = codeownersProblems(root, cfg);
  assert.equal(missing.length, 1);
  assert.match(missing[0].what, /\.github\/CODEOWNERS가 없다/);
  assert.match(missing[0].how, /codeowners --write/);
  // 구축 단계의 check는 파일이 없는 것을 문제로 보지 않는다(missingOk)
  assert.deepEqual(codeownersProblems(root, cfg, { missingOk: true }), []);

  write(root, CODEOWNERS_FILE, codeownersText(cfg));
  assert.deepEqual(codeownersProblems(root, cfg), []);
  // 줄 끝이 CRLF여도 내용이 같으면 같다
  write(root, CODEOWNERS_FILE, codeownersText(cfg).replace(/\n/g, '\r\n'));
  assert.deepEqual(codeownersProblems(root, cfg), []);

  // 한 줄 다름: 소유자를 바꿨다, 줄을 지웠다, 줄을 더했다
  for (const bad of [
    codeownersText(cfg).replace('/.gitignore @maker', '/.gitignore @someone'),
    codeownersText(cfg).replace('/.gitignore @maker\n', ''),
    codeownersText(cfg) + '/src/ @maker\n',
  ]) {
    assert.notEqual(bad, codeownersText(cfg));
    write(root, CODEOWNERS_FILE, bad);
    const p = codeownersProblems(root, cfg, { missingOk: true });
    assert.equal(p.length, 1, bad);
    assert.match(p[0].what, /만든 내용과 다르다\(\d+번째 줄\)/);
  }

  // 옮길 수 없는 glob은 파일이 없어도(missingOk) 문제다
  const odd = fresh({ protectedPaths: [...PATHS, 'src/**/secret.ts'] });
  const p = codeownersProblems(odd.root, odd.cfg, { missingOk: true });
  assert.ok(
    p.some((x) => /src\/\*\*\/secret\.ts.*옮길 수 없다/.test(x.what)),
    JSON.stringify(p),
  );
  // 그 glob은 생성 결과에 넣지 않는다(틀린 패턴을 쓰지 않는다)
  assert.doesNotMatch(codeownersText(odd.cfg), /secret/);

  const owner = fresh({
    github: { ...(fixtureConfig().github as object), owner: 'maker other' },
  });
  assert.ok(
    codeownersProblems(owner.root, owner.cfg, { missingOk: true }).some((x) =>
      /github\.owner/.test(x.what),
    ),
  );
});

test('codeowners 명령: 비교만 하고(다르면 종료 코드 1) --write는 파일을 만든다', () => {
  const { root } = fresh();
  const before = cli(['codeowners'], root);
  assert.equal(before.code, 1, before.stdout + before.stderr);
  assert.match(before.stdout, /CODEOWNERS가 없다/);
  assert.equal(existsSync(path.join(root, CODEOWNERS_FILE)), false);

  const w = cli(['codeowners', '--write'], root);
  assert.equal(w.code, 0, w.stdout + w.stderr);
  assert.equal(
    readFileSync(path.join(root, CODEOWNERS_FILE), 'utf8'),
    codeownersText(loadConfig(root)),
  );
  const again = cli(['codeowners'], root);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /codeowners: 통과/);

  // 옮길 수 없는 glob이 있으면 --write도 종료 코드 1이다
  const odd = fresh({ protectedPaths: ['a/**/b'] });
  const bad = cli(['codeowners', '--write'], odd.root);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /옮길 수 없다/);
});

test('check(doc-lint): CODEOWNERS가 생성 결과와 다르면 실패한다. 파일이 없는 것은 운영 단계에서만 실패다', () => {
  const check = (root: string) => cli(['check', '--only', 'doc-lint', '--no-cache'], root);
  // 구축 단계: 파일이 없어도 통과(CODEOWNERS는 운영 단계에 추가한다, 0.2절)
  const { root, cfg } = fresh();
  const none = check(root);
  assert.equal(none.code, 0, none.stdout + none.stderr);

  write(root, CODEOWNERS_FILE, codeownersText(cfg));
  const same = check(root);
  assert.equal(same.code, 0, same.stdout + same.stderr);

  // 보호 경로를 더하고 파일을 다시 만들지 않으면 실패한다
  setConfig(root, { protectedPaths: [...PATHS, 'profiles/**'] });
  const stale = check(root);
  assert.equal(stale.code, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout, /✗ doc-lint/);
  assert.match(stale.stdout, /CODEOWNERS가 protectedPaths에서 만든 내용과 다르다/);
  assert.match(stale.stdout, /codeowners --write/);

  // 운영 단계: 파일이 없으면 실패
  const op = fresh({ stage: 'operation' });
  const r = check(op.root);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /CODEOWNERS가 없다/);
});
