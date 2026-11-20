// check-results.ts 테스트: 기대와 어긋난 결과 파일을 통과시키지 않는다.
//   node --test lab/q10-db/test/check-results.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  checkPlatform,
  checkPnpm,
  checkQ10,
  confirmProblems,
  PACKAGES,
  readRepoPackageManager,
  REQUIRED_PLATFORMS,
} from '../check-results.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-results.ts');

interface Good {
  platform: string;
  arch: string;
  node: string;
  pnpm: string;
  packageManager: string;
  policy: Record<string, unknown>;
  packages: Record<string, string>;
  installScripts: string[];
  pglite: Record<string, unknown>;
  generate: Record<string, unknown>;
  cases: { name: string; exitCode: number; rows: number }[];
  server: string;
}

/** 모든 기대를 채운 결과 */
function good(): Good {
  return {
    platform: 'darwin',
    arch: 'arm64',
    node: 'v22.0.0',
    pnpm: '10.0.0',
    packageManager: 'pnpm@10.0.0',
    policy: { minimumReleaseAge: 20160, onlyBuiltDependencies: 0, enforced: true },
    packages: { ...PACKAGES },
    installScripts: ['esbuild'],
    pglite: { dependencies: 0, nativeFiles: 0, wasmFiles: 2, os: null, cpu: null },
    generate: { exitCode: 0, sqlFiles: 1, createTable: true },
    cases: CASES.map((c) => ({ name: c.name, exitCode: 0, rows: c.rows })),
    server: 'PostgreSQL 18.7 (PGlite 0.5.17) on wasm3',
  };
}

/** 이 리포가 고정한 pnpm으로 잰 맞는 결과(명령을 돌리는 테스트용) */
function repoGood(): Good {
  const packageManager = readRepoPackageManager();
  return { ...good(), packageManager, pnpm: packageManager.replace(/^pnpm@/, '') };
}

const withCase = (name: string, over: Partial<Good['cases'][number]>): Good => {
  const g = good();
  g.cases = g.cases.map((c) => (c.name === name ? { ...c, ...over } : c));
  return g;
};

test('모든 기대를 채운 결과는 어긋난 점이 없다', () => {
  assert.deepEqual(checkQ10(good()), []);
  assert.deepEqual(checkPlatform(good(), 'darwin-arm64'), []);
});

test('사례는 여섯이고 이름이 겹치지 않는다', () => {
  assert.equal(CASES.length, 6);
  assert.equal(new Set(CASES.map((c) => c.name)).size, 6);
});

test('최소 기간이 더 긴 정책은 통과한다', () => {
  assert.deepEqual(
    checkQ10({
      ...good(),
      policy: { minimumReleaseAge: 43200, onlyBuiltDependencies: 0, enforced: true },
    }),
    [],
  );
});

test('고정한 버전은 리포의 설치 정책 아래에서 잰 것이다(PGlite 0.5.15)', () => {
  assert.equal(PACKAGES['@electric-sql/pglite'], '0.5.15');
});

test('설치 스크립트를 가진 패키지가 없어도 통과한다(esbuild의 부분집합)', () => {
  assert.deepEqual(checkQ10({ ...good(), installScripts: [] }), []);
});

const BAD: [string, () => unknown, RegExp][] = [
  [
    '정책의 최소 기간이 짧다',
    () => ({
      ...good(),
      policy: { minimumReleaseAge: 0, onlyBuiltDependencies: 0, enforced: true },
    }),
    /minimumReleaseAge/,
  ],
  [
    '정책의 최소 기간이 숫자가 아니다',
    () => ({
      ...good(),
      policy: { minimumReleaseAge: '20160', onlyBuiltDependencies: 0, enforced: true },
    }),
    /minimumReleaseAge/,
  ],
  [
    '설치 스크립트 허용 항목이 있다',
    () => ({
      ...good(),
      policy: { minimumReleaseAge: 20160, onlyBuiltDependencies: 1, enforced: true },
    }),
    /onlyBuiltDependencies/,
  ],
  ['policy가 없다', () => ({ ...good(), policy: undefined }), /policy/],
  [
    '정책의 적용을 확인하지 못했다(enforced가 없다)',
    () => ({ ...good(), policy: { minimumReleaseAge: 20160, onlyBuiltDependencies: 0 } }),
    /enforced/,
  ],
  [
    '정책이 적용되지 않았다(enforced가 false)',
    () => ({
      ...good(),
      policy: { minimumReleaseAge: 20160, onlyBuiltDependencies: 0, enforced: false },
    }),
    /enforced/,
  ],
  [
    'enforced가 true가 아닌 참 값이다',
    () => ({
      ...good(),
      policy: { minimumReleaseAge: 20160, onlyBuiltDependencies: 0, enforced: 'true' },
    }),
    /enforced/,
  ],
  ['쓴 pnpm이 packageManager와 다르다', () => ({ ...good(), pnpm: '9.0.0' }), /packageManager/],
  ['packageManager가 없다', () => ({ ...good(), packageManager: undefined }), /packageManager/],
  ['pnpm 버전이 없다', () => ({ ...good(), pnpm: '', packageManager: 'pnpm@' }), /pnpm/],
  [
    '패키지 버전이 다르다',
    () => ({ ...good(), packages: { ...PACKAGES, 'drizzle-kit': '0.0.1' } }),
    /drizzle-kit/,
  ],
  [
    '패키지가 빠졌다',
    () => ({ ...good(), packages: { 'drizzle-orm': PACKAGES['drizzle-orm'] } }),
    /packages/,
  ],
  [
    'PGlite에 의존성이 생겼다',
    () => ({ ...good(), pglite: { ...good().pglite, dependencies: 1 } }),
    /dependencies/,
  ],
  [
    'PGlite에 네이티브 파일이 생겼다',
    () => ({ ...good(), pglite: { ...good().pglite, nativeFiles: 1 } }),
    /nativeFiles/,
  ],
  [
    'PGlite에 WASM 파일이 없다',
    () => ({ ...good(), pglite: { ...good().pglite, wasmFiles: 0 } }),
    /wasmFiles/,
  ],
  [
    'PGlite에 os 제한이 생겼다',
    () => ({ ...good(), pglite: { ...good().pglite, os: ['darwin'] } }),
    /os/,
  ],
  [
    'PGlite에 cpu 제한이 생겼다',
    () => ({ ...good(), pglite: { ...good().pglite, cpu: ['arm64'] } }),
    /cpu/,
  ],
  [
    'esbuild가 아닌 설치 스크립트가 있다',
    () => ({ ...good(), installScripts: ['esbuild', 'left-pad'] }),
    /left-pad/,
  ],
  [
    'installScripts가 배열이 아니다',
    () => ({ ...good(), installScripts: 'esbuild' }),
    /installScripts/,
  ],
  [
    'generate가 실패했다',
    () => ({ ...good(), generate: { ...good().generate, exitCode: 1 } }),
    /generate/,
  ],
  [
    'SQL 파일을 만들지 않았다',
    () => ({ ...good(), generate: { ...good().generate, sqlFiles: 0 } }),
    /sqlFiles/,
  ],
  [
    'CREATE TABLE이 없다',
    () => ({ ...good(), generate: { ...good().generate, createTable: false } }),
    /createTable/,
  ],
  ['격리가 깨졌다(다른 폴더에 행이 보인다)', () => withCase('folder-b', { rows: 2 }), /folder-b/],
  [
    '다시 열었는데 데이터가 남아 있지 않다',
    () => withCase('folder-a-again', { rows: 1 }),
    /folder-a-again/,
  ],
  ['사례가 실패했다', () => withCase('memory', { exitCode: 1 }), /memory/],
  [
    '동시 실행 사례가 실패했다',
    () => withCase('concurrent-d', { exitCode: 1, rows: 0 }),
    /concurrent-d/,
  ],
  [
    '사례가 빠졌다',
    () => ({ ...good(), cases: good().cases.filter((c) => c.name !== 'concurrent-c') }),
    /concurrent-c/,
  ],
  ['사례가 겹친다', () => ({ ...good(), cases: [...good().cases, good().cases[0]] }), /folder-a/],
  [
    '모르는 사례가 있다',
    () => ({ ...good(), cases: [...good().cases, { name: 'extra', exitCode: 0, rows: 1 }] }),
    /extra/,
  ],
  ['서버 문자열이 PostgreSQL이 아니다', () => ({ ...good(), server: 'SQLite 3' }), /server/],
  ['객체가 아니다', () => 'nope', /객체/],
  ['null이다', () => null, /객체/],
  ['필드가 없다', () => ({}), /packages/],
  ['cases가 배열이 아니다', () => ({ ...good(), cases: {} }), /cases/],
  ['사례 항목이 객체가 아니다', () => ({ ...good(), cases: [1, 2, 3, 4, 5, 6] }), /cases/],
];

for (const [name, make, re] of BAD) {
  test(`어긋난 결과가 걸린다: ${name}`, () => {
    const bad = checkQ10(make());
    assert.ok(bad.length > 0, '어긋난 점이 없다고 판정했다');
    assert.ok(
      bad.some((b) => re.test(b)),
      `어긋난 점에 ${re}가 없다: ${bad.join(' / ')}`,
    );
  });
}

test('어떤 꼴의 입력에도 예외를 내지 않는다', () => {
  for (const v of [undefined, 1, [], [[]], { cases: [null] }, { pglite: 1, generate: 's' }]) {
    assert.doesNotThrow(() => checkQ10(v));
    assert.doesNotThrow(() => checkPlatform(v, 'darwin-arm64'));
    assert.ok(checkQ10(v).length > 0);
  }
});

test('파일 이름과 플랫폼이 다르면 걸린다', () => {
  assert.ok(checkPlatform(good(), 'win32-x64').length > 0);
  assert.ok(checkPlatform({ ...good(), arch: 'x64' }, 'darwin-arm64').length > 0);
  assert.ok(checkPlatform({}, 'darwin-arm64').length > 0);
});

test('명령: 인자가 없거나 이름이 꼴에 맞지 않으면 종료 코드 2, 결과 파일이 없으면 1', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(run().status, 2);
  assert.equal(run('a', 'b', 'c').status, 2);
  assert.equal(run('../../package').status, 2);
  assert.equal(run('--file').status, 2);
  assert.equal(run('nope-nope').status, 1);
});

test('명령 --file: 그 파일을 읽고 실행 중인 머신의 플랫폼과 대 본다', () => {
  const run = (file: string) =>
    spawnSync(process.execPath, [SCRIPT, '--file', file], { encoding: 'utf8', timeout: 60_000 });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'q10-check-'));
  const here = { ...repoGood(), platform: process.platform, arch: process.arch };
  const ok = path.join(dir, 'ok.json');
  writeFileSync(ok, JSON.stringify(here));
  assert.equal(run(ok).status, 0, '이 머신의 맞는 결과가 통과하지 않았다');

  const other = path.join(dir, 'other.json');
  writeFileSync(other, JSON.stringify({ ...here, platform: 'plan9' }));
  const r = run(other);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /플랫폼/);

  const loose = path.join(dir, 'loose.json');
  writeFileSync(
    loose,
    JSON.stringify({
      ...here,
      policy: { minimumReleaseAge: 0, onlyBuiltDependencies: 0, enforced: true },
    }),
  );
  assert.equal(run(loose).status, 1);

  // 결과 안의 두 칸은 서로 같지만 이 리포가 고정한 pnpm이 아니다
  const oldPnpm = path.join(dir, 'old-pnpm.json');
  writeFileSync(oldPnpm, JSON.stringify({ ...here, pnpm: '9.0.0', packageManager: 'pnpm@9.0.0' }));
  const o = run(oldPnpm);
  assert.equal(o.status, 1);
  assert.match(o.stderr, /고정/);

  assert.equal(run(path.join(dir, 'missing.json')).status, 1);
  const broken = path.join(dir, 'broken.json');
  writeFileSync(broken, '{');
  assert.equal(run(broken).status, 1);
});

test('이 리포의 packageManager를 읽는다(pnpm@<버전>)', () => {
  assert.match(readRepoPackageManager(), /^pnpm@\d+\.\d+\.\d+$/);
});

test('pnpm 버전은 리포의 고정값을 기준으로 본다', () => {
  assert.deepEqual(checkPnpm(good(), 'pnpm@10.0.0'), []);
  assert.deepEqual(checkPnpm(repoGood(), readRepoPackageManager()), []);
});

test('결과의 두 칸이 서로 같아도 리포의 고정 버전과 다르면 걸린다', () => {
  // 결과 안에서는 맞아떨어진다(checkQ10은 통과). 리포의 고정값과 대 봐야 걸린다
  assert.deepEqual(checkQ10(good()), []);
  const bad = checkPnpm(good(), 'pnpm@10.34.5');
  assert.ok(bad.length > 0, '구버전으로 잰 결과를 통과시켰다');
  assert.ok(
    bad.some((b) => /고정/.test(b)),
    bad.join(' / '),
  );
});

test('pnpm 버전 칸 하나만 달라도 걸린다', () => {
  assert.ok(checkPnpm({ ...good(), pnpm: '9.0.0' }, 'pnpm@10.0.0').length > 0);
  assert.ok(checkPnpm({ ...good(), packageManager: 'pnpm@9.0.0' }, 'pnpm@10.0.0').length > 0);
  assert.ok(checkPnpm({ ...good(), pnpm: undefined }, 'pnpm@10.0.0').length > 0);
  assert.ok(checkPnpm({ ...good(), packageManager: undefined }, 'pnpm@10.0.0').length > 0);
});

test('리포의 고정값을 읽지 못했으면 통과시키지 않는다(예외도 내지 않는다)', () => {
  for (const pm of ['', 'npm@10.0.0', 'pnpm@', 'pnpm@latest'])
    assert.ok(checkPnpm(good(), pm).length > 0, `통과시켰다: ${pm}`);
  for (const v of [undefined, null, 1, 'x', []]) {
    assert.doesNotThrow(() => checkPnpm(v, 'pnpm@10.0.0'));
    assert.ok(checkPnpm(v, 'pnpm@10.0.0').length > 0);
  }
});

const pass = (name: string) => ({ name, bad: [] as string[] });

test('확정 조건: 필요한 환경은 macOS, Windows 네이티브, Linux 셋이다', () => {
  assert.deepEqual([...REQUIRED_PLATFORMS].sort(), ['darwin', 'linux', 'win32']);
});

test('확정 조건: macOS만 있으면 Windows와 Linux가 없다고 낸다', () => {
  const p = confirmProblems([pass('darwin-arm64')]);
  assert.ok(
    p.some((x) => /win32/.test(x)),
    p.join(' / '),
  );
  assert.ok(
    p.some((x) => /linux/.test(x)),
    p.join(' / '),
  );
  assert.ok(!p.some((x) => /darwin/.test(x)), p.join(' / '));
});

test('확정 조건: 환경 하나만 더 통과한 상태는 채워진 것이 아니다', () => {
  const noLinux = confirmProblems([pass('darwin-arm64'), pass('win32-x64')]);
  assert.ok(noLinux.length > 0);
  assert.ok(
    noLinux.some((x) => /linux/.test(x)),
    noLinux.join(' / '),
  );
  assert.ok(!noLinux.some((x) => /win32/.test(x)), noLinux.join(' / '));

  const noWindows = confirmProblems([pass('darwin-arm64'), pass('linux-x64')]);
  assert.ok(noWindows.length > 0);
  assert.ok(
    noWindows.some((x) => /win32/.test(x)),
    noWindows.join(' / '),
  );
  assert.ok(!noWindows.some((x) => /linux/.test(x)), noWindows.join(' / '));

  const noMac = confirmProblems([pass('win32-x64'), pass('linux-x64')]);
  assert.ok(
    noMac.some((x) => /darwin/.test(x)),
    noMac.join(' / '),
  );
});

test('확정 조건: 결과가 하나도 없으면 세 환경이 모두 없다고 낸다', () => {
  assert.equal(confirmProblems([]).length, 3);
});

test('확정 조건: 세 환경이 모두 통과하면 문제가 없다', () => {
  assert.deepEqual(
    confirmProblems([pass('darwin-arm64'), pass('win32-x64'), pass('linux-x64')]),
    [],
  );
  assert.deepEqual(
    confirmProblems([
      pass('darwin-arm64'),
      pass('win32-arm64'),
      pass('linux-arm64'),
      pass('linux-x64'),
    ]),
    [],
  );
});

test('확정 조건: 셋이 있어도 하나가 검사를 통과하지 못하면 그 파일을 낸다', () => {
  const p = confirmProblems([
    pass('darwin-arm64'),
    pass('win32-x64'),
    { name: 'linux-x64', bad: ['cases: folder-b의 행 수가 1이 아니다: 2'] },
  ]);
  assert.ok(
    p.some((x) => /linux-x64/.test(x)),
    p.join(' / '),
  );
});

test('확정 조건: 같은 환경에 통과한 파일이 있어도 통과하지 못한 파일이 있으면 채워진 것이 아니다', () => {
  const p = confirmProblems([
    pass('darwin-arm64'),
    pass('win32-x64'),
    pass('linux-x64'),
    { name: 'linux-arm64', bad: ['generate.exitCode가 0이 아니다: 1'] },
  ]);
  assert.ok(
    p.some((x) => /linux-arm64/.test(x)),
    p.join(' / '),
  );
});

test('명령 --confirm: 세 환경의 결과가 모두 통과할 때만 종료 코드 0', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, '--confirm', ...args], {
      encoding: 'utf8',
      timeout: 60_000,
    });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'q10-confirm-'));
  const put = (platform: string, arch: string, over: Record<string, unknown> = {}) =>
    writeFileSync(
      path.join(dir, `${platform}-${arch}.json`),
      JSON.stringify({ ...repoGood(), platform, arch, ...over }),
    );

  const empty = run(dir);
  assert.equal(empty.status, 1, '결과가 없는데 확정이라고 판정했다');

  put('darwin', 'arm64');
  const mac = run(dir);
  assert.equal(mac.status, 1, 'macOS만으로 확정이라고 판정했다');
  assert.match(mac.stderr, /win32/);
  assert.match(mac.stderr, /linux/);

  put('win32', 'x64');
  const two = run(dir);
  assert.equal(two.status, 1, '환경 둘로 확정이라고 판정했다');
  assert.match(two.stderr, /linux/);
  assert.doesNotMatch(two.stderr, /win32/);

  put('linux', 'x64');
  const all = run(dir);
  assert.equal(all.status, 0, `세 환경이 모두 통과했는데 확정이 아니라고 판정했다: ${all.stderr}`);

  // 통과하지 못하는 결과가 섞이면 다시 1
  put('linux', 'x64', {
    policy: { minimumReleaseAge: 0, onlyBuiltDependencies: 0, enforced: true },
  });
  const loose = run(dir);
  assert.equal(loose.status, 1);
  assert.match(loose.stderr, /linux-x64/);

  // 이 리포가 고정한 pnpm이 아닌 것으로 잰 결과도 통과가 아니다
  put('linux', 'x64', { pnpm: '9.0.0', packageManager: 'pnpm@9.0.0' });
  assert.equal(run(dir).status, 1);

  // 파일 이름과 내용의 플랫폼이 다르면 통과가 아니다(다른 환경의 결과를 이름만 바꿔 넣는 경우)
  writeFileSync(
    path.join(dir, 'linux-x64.json'),
    JSON.stringify({ ...repoGood(), platform: 'darwin', arch: 'arm64' }),
  );
  assert.equal(run(dir).status, 1);

  assert.equal(run(path.join(dir, 'no-such-folder')).status, 1);
  assert.equal(run(dir, 'extra').status, 2);
});
