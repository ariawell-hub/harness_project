// Q10 실물 확인(계획 20261120-q10-db-decision step0, 수용 기준 1).
// 빈 폴더에 시험 프로젝트를 만들고 Drizzle과 내장 PostgreSQL(PGlite)을 설치해,
// PC에 DB 서버 없이 마이그레이션 생성·적용과 폴더별 격리가 되는지 돌려 본다.
// 이 리포의 설치 정책(pnpm-workspace.yaml, R17)을 시험 프로젝트에 그대로 놓고 설치한다.
// 결과는 results/<platform>-<arch>.json에 쓴다(실행한 머신마다 파일 하나). --out을 주면 그 파일에 쓴다.
//
//   node lab/q10-db/trial.ts <빈 폴더> [--out <결과 파일>]
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CASES,
  isOutsideDir,
  PACKAGES,
  readRepoPackageManager,
  RESULTS_DIR,
} from './check-results.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
/** 설치 정책 파일(R17). 시험 프로젝트의 루트에 그대로 복사한다 */
const POLICY_FILE = 'pnpm-workspace.yaml';
/** 정책 적용 확인용 폴더에만 쓰는 게시 후 최소 기간(분): 100년. 어떤 버전도 통과하지 못한다 */
const PROBE_AGE = 52_560_000;
const PROBE_ERROR = 'NO_MATURE_MATCHING_VERSION';
const NAME = `${process.platform}-${process.arch}`;
const INSTALL_TIMEOUT_MS = 300_000;
const RUN_TIMEOUT_MS = 120_000;

const SCHEMA = `import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
`;
const CONFIG = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({ dialect: 'postgresql', schema: './src/schema.ts', out: './drizzle' });
`;
/** DB 위치를 인자로 받아 마이그레이션 적용 → 한 행 넣기 → 전체 행 수와 서버 버전을 한 줄 JSON으로 낸다 */
const RUN = `import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { notes } from './src/schema.ts';

const client = new PGlite(process.argv[2]);
const db = drizzle(client);
await migrate(db, { migrationsFolder: './drizzle' });
await db.insert(notes).values({ title: 'row' });
const rows = await db.select().from(notes);
const v = await client.query('select version()');
process.stdout.write(JSON.stringify({ rows: rows.length, version: String(v.rows[0].version) }) + '\\n');
await client.close();
`;

/** 사례 이름 → DB 위치. 폴더는 시험 프로젝트의 .db 아래에 둔다 */
const LOCATION: Record<string, string> = {
  'folder-a': './.db/a',
  'folder-b': './.db/b',
  'folder-a-again': './.db/a',
  memory: 'memory://',
  'concurrent-c': './.db/c',
  'concurrent-d': './.db/d',
};

function fail(msg: string): never {
  process.stderr.write(`trial: ${msg}\n`);
  process.exit(1);
}

const tail = (s: string): string => s.trimEnd().split('\n').slice(-15).join('\n');

/**
 * pnpm을 띄운다. 인자는 이 파일의 상수뿐이다(바깥 입력을 넣지 않는다).
 * Windows에서는 pnpm이 .cmd라 셸을 거쳐야 실행된다.
 */
function pnpm(cwd: string, args: string[], timeout: number): { status: number; out: string } {
  const r = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    shell: process.platform === 'win32',
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** 폴더 아래의 파일을 모두 센다(심볼릭 링크는 따라가지 않는다) */
function countFiles(dir: string, ext: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += countFiles(p, ext);
    else if (e.isFile() && e.name.endsWith(ext)) n += 1;
  }
  return n;
}

/** 설치된 패키지(node_modules/.pnpm 아래) 가운데 설치 스크립트를 가진 것의 이름 */
function installScripts(project: string): string[] {
  const store = path.join(project, 'node_modules', '.pnpm');
  const names = new Set<string>();
  for (const entry of readdirSync(store)) {
    const nm = path.join(store, entry, 'node_modules');
    if (!existsSync(nm) || !statSync(nm).isDirectory()) continue;
    for (const first of readdirSync(nm, { withFileTypes: true })) {
      // 실제 폴더만 본다. 링크는 다른 항목에서 실제 폴더로 한 번 본다
      if (!first.isDirectory()) continue;
      const dirs = first.name.startsWith('@')
        ? readdirSync(path.join(nm, first.name), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => path.join(nm, first.name, d.name))
        : [path.join(nm, first.name)];
      for (const d of dirs) {
        const f = path.join(d, 'package.json');
        if (!existsSync(f)) continue;
        const pkg = readJson(f);
        const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
        if (['preinstall', 'install', 'postinstall'].some((k) => typeof scripts[k] === 'string'))
          names.add(String(pkg.name));
      }
    }
  }
  return [...names].sort();
}

/** 패키지의 실행 파일(package.json의 bin) 경로 */
function binOf(project: string, pkgName: string): string {
  const dir = path.join(project, 'node_modules', pkgName);
  const bin = readJson(path.join(dir, 'package.json')).bin;
  const rel = typeof bin === 'string' ? bin : (bin as Record<string, string>)[pkgName];
  return path.join(dir, rel);
}

/** 시험 프로젝트에 놓인 정책 파일에서 값을 읽는다(한 줄에 하나씩 적힌 두 설정) */
function readPolicy(project: string): { minimumReleaseAge: number; onlyBuiltDependencies: number } {
  const text = readFileSync(path.join(project, POLICY_FILE), 'utf8');
  const age = /^minimumReleaseAge:\s*(\d+)\s*$/m.exec(text);
  const inline = /^onlyBuiltDependencies:\s*\[(.*)\]\s*$/m.exec(text);
  if (!age) fail(`${POLICY_FILE}에서 minimumReleaseAge를 읽지 못했다`);
  if (!inline)
    fail(
      `${POLICY_FILE}의 onlyBuiltDependencies가 한 줄 목록([...]) 꼴이 아니다(이 스크립트가 읽지 못한다)`,
    );
  const items = inline[1].split(',').filter((x) => x.trim() !== '');
  return { minimumReleaseAge: Number(age[1]), onlyBuiltDependencies: items.length };
}

/** 이 리포가 고정한 패키지 관리자(package.json의 packageManager, 예: pnpm@10.34.5) */
function repoPackageManager(): string {
  const pm = readRepoPackageManager();
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(pm))
    fail('이 리포의 package.json에서 packageManager(pnpm@<버전>)를 읽지 못했다');
  return pm;
}

/**
 * 실제로 쓰는 pnpm이 게시 후 최소 기간을 적용하는지 확인한다.
 * 최소 기간을 100년으로 올린 정책 파일을 놓은 폴더에서 설치가 거부되어야 한다.
 * 정책을 모르는 pnpm은 파일을 무시하고 설치에 성공한다(그러면 시험 프로젝트의 설치도 정책 밖이다).
 */
function probePolicy(probe: string, packageManager: string): void {
  writeFileSync(
    path.join(probe, 'package.json'),
    `${JSON.stringify({ name: 'q10-probe', private: true, packageManager }, null, 2)}\n`,
  );
  const text = readFileSync(path.join(REPO_ROOT, POLICY_FILE), 'utf8');
  const strict = text.replace(/^minimumReleaseAge:.*$/m, `minimumReleaseAge: ${PROBE_AGE}`);
  if (strict === text) fail(`${POLICY_FILE}에 minimumReleaseAge 줄이 없다`);
  writeFileSync(path.join(probe, POLICY_FILE), strict);
  const r = pnpm(
    probe,
    ['add', '--save-exact', `drizzle-orm@${PACKAGES['drizzle-orm']}`],
    INSTALL_TIMEOUT_MS,
  );
  if (r.status === 0)
    fail(
      '이 pnpm은 게시 후 최소 기간(minimumReleaseAge)을 적용하지 않는다. 설치 정책(R17) 밖이라 잴 수 없다',
    );
  if (!r.out.includes(PROBE_ERROR))
    fail(`정책 적용 확인이 다른 이유로 실패했다(${PROBE_ERROR}가 아니다)\n${tail(r.out)}`);
}

interface CaseResult {
  name: string;
  exitCode: number;
  rows: number | null;
}

/** 사례 하나를 node 자식 프로세스로 돌린다 */
function runCase(project: string, name: string): Promise<CaseResult & { version: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['run.ts', LOCATION[name]], { cwd: project });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      let rows: number | null = null;
      let version: string | null = null;
      try {
        const j = JSON.parse(out.trim().split('\n').pop() ?? '') as Record<string, unknown>;
        if (typeof j.rows === 'number') rows = j.rows;
        if (typeof j.version === 'string') version = j.version;
      } catch {
        // 출력이 JSON이 아니면 행 수 없음으로 남긴다
      }
      if (code !== 0)
        process.stderr.write(`trial: 사례 ${name} 실패(종료 코드 ${code})\n${tail(err)}\n`);
      resolve({ name, exitCode: code ?? -1, rows, version });
    });
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = argv[0];
  const usage = '사용법: node lab/q10-db/trial.ts <빈 폴더> [--out <결과 파일>]';
  if (!arg || arg.startsWith('--')) fail(usage);
  if (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--out' && argv[2])) fail(usage);
  const outFile =
    argv.length === 3 ? path.resolve(argv[2]) : path.join(RESULTS_DIR, `${NAME}.json`);
  if (!existsSync(arg) || !statSync(arg).isDirectory())
    fail('폴더가 없다(새 임시 폴더를 만들어 넘긴다. README의 절차)');
  const root = realpathSync(arg);
  if (readdirSync(root).length) fail('폴더가 비어 있지 않다');
  // 리포 밖의 폴더만 쓴다(Windows에서 다른 드라이브의 임시 폴더도 리포 밖이다)
  if (!isOutsideDir(REPO_ROOT, root)) fail('리포 밖의 폴더를 쓴다');
  const project = path.join(root, 'project');
  const probe = path.join(root, 'probe');
  mkdirSync(project);
  mkdirSync(probe);

  const packageManager = repoPackageManager();
  writeFileSync(
    path.join(project, 'package.json'),
    `${JSON.stringify({ name: 'q10-trial', private: true, type: 'module', packageManager }, null, 2)}\n`,
  );
  // 설치 정책을 그대로 적용한다. 정책에 걸리는 버전이면 아래 설치가 실패한다
  copyFileSync(path.join(REPO_ROOT, POLICY_FILE), path.join(project, POLICY_FILE));
  // 설치 전에: 쓰는 pnpm이 리포가 고정한 버전이고 정책을 실제로 적용하는지 확인한다
  const pnpmVersion = pnpm(project, ['--version'], 60_000).out.trim().split('\n').pop() ?? '';
  if (`pnpm@${pnpmVersion}` !== packageManager)
    fail(`쓰는 pnpm(${pnpmVersion})이 이 리포가 고정한 ${packageManager}와 다르다`);
  probePolicy(probe, packageManager);
  const policy = { ...readPolicy(project), enforced: true };
  mkdirSync(path.join(project, 'src'));
  mkdirSync(path.join(project, '.db'));
  writeFileSync(path.join(project, 'src', 'schema.ts'), SCHEMA);
  writeFileSync(path.join(project, 'drizzle.config.ts'), CONFIG);
  writeFileSync(path.join(project, 'run.ts'), RUN);

  // 설치: 위에서 놓은 정책 그대로(정책을 느슨하게 하는 인자·환경 변수를 더하지 않는다)
  const at = (n: keyof typeof PACKAGES) => `${n}@${PACKAGES[n]}`;
  const steps: string[][] = [
    ['add', '--save-exact', at('drizzle-orm'), at('@electric-sql/pglite')],
    ['add', '-D', '--save-exact', at('drizzle-kit')],
  ];
  for (const args of steps) {
    const r = pnpm(project, args, INSTALL_TIMEOUT_MS);
    if (r.status !== 0) fail(`설치 실패(pnpm ${args.join(' ')})\n${tail(r.out)}`);
  }

  const packages: Record<string, string> = {};
  for (const n of Object.keys(PACKAGES))
    packages[n] = String(readJson(path.join(project, 'node_modules', n, 'package.json')).version);

  const pgDir = realpathSync(path.join(project, 'node_modules', '@electric-sql', 'pglite'));
  const pgPkg = readJson(path.join(pgDir, 'package.json'));
  const pglite = {
    dependencies: Object.keys((pgPkg.dependencies ?? {}) as object).length,
    nativeFiles: countFiles(pgDir, '.node'),
    wasmFiles: countFiles(pgDir, '.wasm'),
    os: pgPkg.os ?? null,
    cpu: pgPkg.cpu ?? null,
  };

  // 마이그레이션 생성: drizzle-kit의 실행 파일을 node로 직접 띄운다(.bin의 셸 래퍼는 OS마다 다르다)
  const gen = spawnSync(process.execPath, [binOf(project, 'drizzle-kit'), 'generate'], {
    cwd: project,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
  });
  if (gen.status !== 0)
    process.stderr.write(`trial: generate 실패\n${tail(`${gen.stdout}${gen.stderr}`)}\n`);
  const outDir = path.join(project, 'drizzle');
  const sql = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.sql')) : [];
  const generate = {
    exitCode: gen.status ?? -1,
    sqlFiles: sql.length,
    createTable: sql.some((f) => /CREATE TABLE/i.test(readFileSync(path.join(outDir, f), 'utf8'))),
  };

  // 사례: 앞의 넷은 차례로, 뒤의 둘은 동시에
  const done: (CaseResult & { version: string | null })[] = [];
  for (const name of ['folder-a', 'folder-b', 'folder-a-again', 'memory'])
    done.push(await runCase(project, name));
  done.push(
    ...(await Promise.all([runCase(project, 'concurrent-c'), runCase(project, 'concurrent-d')])),
  );
  if (done.length !== CASES.length) fail('사례 수가 check-results.ts의 CASES와 다르다');

  const result = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    pnpm: pnpmVersion,
    packageManager,
    policy,
    packages,
    installScripts: installScripts(project),
    pglite,
    generate,
    cases: done.map(({ name, exitCode, rows }) => ({ name, exitCode, rows })),
    server: (done.find((d) => d.version)?.version ?? '').slice(0, 40),
  };
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(
    argv.length === 3
      ? `trial: 결과를 --out 파일에 썼다(${NAME})\n`
      : `trial: lab/q10-db/results/${NAME}.json을 썼다\n`,
  );
}

await main();
