// test-effect 실물 확인(계획 20261119-pilot-prep step0, 수용 기준 2).
// 웹 프로파일을 적용하고 Vitest를 설치한 복제 폴더에 기준 커밋과 사례를 만들고,
// `node scripts/harness.ts test-effect`를 두 번 돌려 판정 줄과 종료 코드를 결과 파일에 옮긴다.
// 준비(복제, init, 의존성 설치)는 README의 명령으로 먼저 한다.
//
//   node lab/pilot-prep/trial-test-effect.ts <복제한 폴더>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'results',
  'test-effect-vitest.json',
);

const CLAMP_TEST = (importPath: string) =>
  `import { expect, test } from 'vitest';\nimport { clamp } from '${importPath}';\n\ntest('clamp는 10을 넘지 않는다', () => {\n  expect(clamp(11)).toBe(10);\n});\n`;
const ADD_TEST = (importPath: string) =>
  `import { expect, test } from 'vitest';\nimport { add } from '${importPath}';\n\ntest('add', () => {\n  expect(add(1, 2)).toBe(3);\n});\n`;

/** 사례 하나에 테스트 파일 하나. 기준 커밋의 clamp는 값을 그대로 돌려주고, 변경이 10으로 자른다 */
const CASES: readonly { id: string; file: string; content: string }[] = [
  { id: 'passes-on-base', file: 'src/keep.test.ts', content: ADD_TEST('./math') },
  { id: 'assertion', file: 'src/change.test.ts', content: CLAMP_TEST('./math') },
  {
    id: 'new-module',
    file: 'src/fresh.test.ts',
    content: `import { expect, test } from 'vitest';\nimport { fresh } from './fresh';\n\ntest('fresh', () => {\n  expect(fresh()).toBe('fresh');\n});\n`,
  },
  { id: 'similar-pass', file: 'src/sim/a.test.ts', content: ADD_TEST('../math') },
  { id: 'similar-fail', file: 'src/sim/a.test.tsx', content: CLAMP_TEST('../math') },
  {
    id: 'similar-nested',
    file: 'src/sim/deep/src/sim/a.test.ts',
    content: CLAMP_TEST('../../../../math'),
  },
  {
    id: 'special-path',
    file: 'src/app/(shop)/[id]/page.test.tsx',
    content: CLAMP_TEST('../../../math'),
  },
];
/** 두 번째 실행에서 빼는 사례(변경 전 코드에서도 통과하는 테스트) */
const INEFFECTIVE = ['passes-on-base', 'similar-pass'];

function fail(msg: string): never {
  process.stderr.write(`trial-test-effect: ${msg}\n`);
  process.exit(1);
}

function main(): void {
  const arg = process.argv[2];
  if (process.argv.length !== 3 || !arg)
    fail('사용법: node lab/pilot-prep/trial-test-effect.ts <복제한 폴더>');
  const root = path.resolve(arg);
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };
  const run = (cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const git = (...args: string[]) => {
    const r = run('git', [
      '-c',
      'user.name=trial',
      '-c',
      'user.email=trial@example.invalid',
      ...args,
    ]);
    if (r.code !== 0) fail(`git ${args.join(' ')} 실패: ${r.out}`);
    return r.out.trim();
  };

  const vitestPkg = path.join(root, 'node_modules', 'vitest', 'package.json');
  if (!existsSync(vitestPkg))
    fail(`Vitest가 설치돼 있지 않다(${vitestPkg}). README의 준비 명령을 먼저 실행하라`);
  const cfg = JSON.parse(readFileSync(path.join(root, 'harness.config.json'), 'utf8')) as {
    profile?: string;
    testEffect?: { command?: string[] };
  };
  if (cfg.profile !== 'web' || !cfg.testEffect?.command)
    fail(
      '웹 프로파일이 적용돼 있지 않다. `node scripts/harness.ts init --profile web`을 먼저 실행하라',
    );
  if (existsSync(path.join(root, 'src'))) fail('src/가 이미 있다. 새로 복제한 폴더에서 돌려라');

  // 기준 커밋: 작은 모듈과 통과하는 테스트. Vitest 설정은 래퍼가 덮어써야 하는 값을 일부러 넣는다
  write(
    'vitest.config.ts',
    `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: { include: ['src/**/*.test.{ts,tsx}'], passWithNoTests: true },\n});\n`,
  );
  write(
    'src/math.ts',
    'export const add = (a: number, b: number) => a + b;\nexport const clamp = (x: number) => x;\n',
  );
  write('src/base.test.ts', ADD_TEST('./math'));
  git('add', '-A');
  git('commit', '-q', '-m', 'trial: base');
  const base = git('rev-parse', 'HEAD');

  // 변경: clamp의 동작을 바꾸고 새 모듈을 더한다. 사례의 테스트 파일을 더한다(커밋하지 않은 작업 트리)
  write(
    'src/math.ts',
    'export const add = (a: number, b: number) => a + b;\nexport const clamp = (x: number) => Math.min(x, 10);\n',
  );
  write('src/fresh.ts', "export const fresh = () => 'fresh';\n");
  for (const c of CASES) write(c.file, c.content);

  const testEffect = () =>
    run(process.execPath, ['scripts/harness.ts', 'test-effect', '--base', base]);
  const all = testEffect();
  process.stdout.write(`--- all (종료 코드 ${all.code})\n${all.out}\n`);
  const cases = CASES.map((c) => {
    const line = all.out.split('\n').find((l) => l.startsWith(`${c.file}: `)) ?? '';
    const outcome = /^: ([a-z]+)\(/.exec(line.slice(c.file.length))?.[1] ?? '';
    return { id: c.id, file: c.file, outcome, line };
  });

  for (const c of CASES) if (INEFFECTIVE.includes(c.id)) unlinkSync(path.join(root, c.file));
  const effectiveOnly = testEffect();
  process.stdout.write(
    `--- effective-only (종료 코드 ${effectiveOnly.code})\n${effectiveOnly.out}\n`,
  );

  const result = {
    tool: {
      vitest: (JSON.parse(readFileSync(vitestPkg, 'utf8')) as { version: string }).version,
      node: process.version,
      os: `${process.platform}-${process.arch}`,
    },
    command: cfg.testEffect.command,
    runs: [
      { id: 'all', exitCode: all.code },
      { id: 'effective-only', exitCode: effectiveOnly.code },
    ],
    cases,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(
    `결과를 썼다: ${OUT}\n검사: node lab/pilot-prep/check-results.ts test-effect-vitest\n`,
  );
}

main();
