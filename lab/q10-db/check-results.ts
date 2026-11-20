// Q10 실물 확인 결과 파일 검사(계획 20261120-q10-db-decision). 결과 파일은 trial.ts가 쓴다. 손으로 고치지 않는다.
// 기대값을 대 보고, 하나라도 어긋나면 무엇이 어긋났는지 내고 종료 코드 1로 끝난다.
//
//   node lab/q10-db/check-results.ts darwin-arm64          results/darwin-arm64.json을 본다
//   node lab/q10-db/check-results.ts --file <결과 파일>    그 파일을 실행 중인 머신의 플랫폼과 대 본다
//   node lab/q10-db/check-results.ts --confirm [<폴더>]    확정 조건: 세 환경의 결과가 모두 통과하는가(기본 results/)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(HERE, 'results');
const REPO_PACKAGE_JSON = path.join(HERE, '..', '..', 'package.json');

/** ADR-0007의 확정 조건: 이 환경 모두에 검사를 통과한 결과 파일이 있어야 한다(process.platform의 값) */
export const REQUIRED_PLATFORMS = ['darwin', 'win32', 'linux'] as const;

const PNPM_RE = /^pnpm@(\d+\.\d+\.\d+)$/;

/**
 * 확인한 패키지와 버전. trial.ts가 이 버전으로 설치한다.
 * 이 리포의 설치 정책(pnpm-workspace.yaml, R17: 게시 후 14일) 아래에서 설치되는 버전이어야 한다(2026-11-20 기준).
 */
export const PACKAGES = {
  'drizzle-orm': '0.45.4',
  '@electric-sql/pglite': '0.5.15',
  'drizzle-kit': '0.31.11',
} as const;

/** 시험 프로젝트에 적용돼 있어야 하는 설치 정책(R17): 게시 후 최소 기간(분)의 하한 */
export const MIN_RELEASE_AGE = 20160;

/** 설치 스크립트를 가져도 되는 패키지. 스크립트는 실행하지 않는다(R17). 그래도 도는지가 확인 대상이다 */
const INSTALL_SCRIPT_OK = ['esbuild'];

/** 사례와 기대하는 행 수. 실행할 때마다 한 행을 넣고 그 DB의 전체 행 수를 센다 */
export const CASES: readonly { name: string; rows: number; what: string }[] = [
  { name: 'folder-a', rows: 1, what: '새 폴더' },
  { name: 'folder-b', rows: 1, what: '다른 새 폴더(격리)' },
  { name: 'folder-a-again', rows: 2, what: '첫 폴더를 다시 연다(데이터가 남는다)' },
  { name: 'memory', rows: 1, what: '메모리 DB' },
  { name: 'concurrent-c', rows: 1, what: '동시 실행 1' },
  { name: 'concurrent-d', rows: 1, what: '동시 실행 2' },
];

/** 결과 파일 이름: <platform>-<arch> */
export const NAME_RE = /^[a-z0-9]+-[a-z0-9_]+$/;

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);

/** 개수·분 수로 쓸 수 있는 값: 안전한 정수(소수, 무한대, NaN, 글자는 아니다) */
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);

const SHOW_MAX = 80;
/** 값을 메시지에 넣을 글자로 바꾼다. 어떤 값에도 예외를 내지 않는다(객체·배열 안으로 들어가지 않는다) */
function show(v: unknown): string {
  if (typeof v === 'string') return v.length > SHOW_MAX ? `${v.slice(0, SHOW_MAX)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  if (v === undefined) return '(없음)';
  if (Array.isArray(v)) return `배열(길이 ${v.length})`;
  return typeof v === 'object' ? '객체' : typeof v;
}

/** 결과의 내용을 기대값과 대 본다. 어긋난 점의 목록(없으면 빈 배열) */
export function checkQ10(result: unknown): string[] {
  if (!isObj(result)) return [`결과가 객체가 아니다: ${show(result)}`];
  const bad: string[] = [];

  const pk = result.packages;
  if (!isObj(pk)) bad.push(`packages가 객체가 아니다: ${show(pk)}`);
  else
    for (const [name, version] of Object.entries(PACKAGES))
      if (pk[name] !== version)
        bad.push(`packages: ${name}의 버전이 ${version}이 아니다: ${show(pk[name])}`);

  const policy = result.policy;
  if (!isObj(policy)) bad.push(`policy가 객체가 아니다: ${show(policy)}`);
  else {
    const age = policy.minimumReleaseAge;
    if (!isCount(age) || age < MIN_RELEASE_AGE)
      bad.push(`policy.minimumReleaseAge가 ${MIN_RELEASE_AGE} 이상의 정수가 아니다: ${show(age)}`);
    if (policy.onlyBuiltDependencies !== 0)
      bad.push(
        `policy.onlyBuiltDependencies(설치 스크립트 허용 항목 수)가 0이 아니다: ${show(policy.onlyBuiltDependencies)}`,
      );
    if (policy.enforced !== true)
      bad.push(
        `policy.enforced가 true가 아니다(쓴 pnpm이 게시 후 최소 기간을 적용하는지 확인되지 않았다): ${show(policy.enforced)}`,
      );
  }

  const { pnpm, packageManager } = result;
  if (typeof pnpm !== 'string' || !/^\d+\.\d+\.\d+/.test(pnpm))
    bad.push(`pnpm 버전이 없다: ${show(pnpm)}`);
  else if (packageManager !== `pnpm@${pnpm}`)
    bad.push(
      `packageManager가 쓴 pnpm(${pnpm})과 다르다(리포가 고정한 pnpm으로 설치해야 한다): ${show(packageManager)}`,
    );

  const pg = result.pglite;
  if (!isObj(pg)) bad.push(`pglite가 객체가 아니다: ${show(pg)}`);
  else {
    if (pg.dependencies !== 0)
      bad.push(`pglite.dependencies가 0이 아니다: ${show(pg.dependencies)}`);
    if (pg.nativeFiles !== 0) bad.push(`pglite.nativeFiles가 0이 아니다: ${show(pg.nativeFiles)}`);
    if (!isCount(pg.wasmFiles) || pg.wasmFiles < 1)
      bad.push(`pglite.wasmFiles가 1 이상의 정수가 아니다: ${show(pg.wasmFiles)}`);
    if (pg.os !== null) bad.push(`pglite.os 제한이 있다: ${show(pg.os)}`);
    if (pg.cpu !== null) bad.push(`pglite.cpu 제한이 있다: ${show(pg.cpu)}`);
  }

  const scripts = result.installScripts;
  if (!Array.isArray(scripts)) bad.push(`installScripts가 배열이 아니다: ${show(scripts)}`);
  else
    for (const s of scripts)
      if (typeof s !== 'string' || !INSTALL_SCRIPT_OK.includes(s))
        bad.push(`installScripts: 설치 스크립트를 가진 패키지가 더 있다: ${show(s)}`);

  const gen = result.generate;
  if (!isObj(gen)) bad.push(`generate가 객체가 아니다: ${show(gen)}`);
  else {
    if (gen.exitCode !== 0) bad.push(`generate.exitCode가 0이 아니다: ${show(gen.exitCode)}`);
    if (!isCount(gen.sqlFiles) || gen.sqlFiles < 1)
      bad.push(`generate.sqlFiles가 1 이상의 정수가 아니다: ${show(gen.sqlFiles)}`);
    if (gen.createTable !== true)
      bad.push(`generate.createTable이 true가 아니다: ${show(gen.createTable)}`);
  }

  const cases = result.cases;
  if (!Array.isArray(cases)) bad.push(`cases가 배열이 아니다: ${show(cases)}`);
  else {
    const items = cases.filter(isObj);
    if (items.length !== cases.length) bad.push('cases에 객체가 아닌 항목이 있다');
    for (const want of CASES) {
      const got = items.filter((c) => c.name === want.name);
      if (got.length !== 1) {
        bad.push(`cases: ${want.name}(${want.what})이 ${got.length}건이다(1건이어야 한다)`);
        continue;
      }
      if (got[0].exitCode !== 0)
        bad.push(`cases: ${want.name}의 종료 코드가 0이 아니다: ${show(got[0].exitCode)}`);
      if (got[0].rows !== want.rows)
        bad.push(
          `cases: ${want.name}(${want.what})의 행 수가 ${want.rows}이 아니다: ${show(got[0].rows)}`,
        );
    }
    for (const c of items)
      if (!CASES.some((w) => w.name === c.name)) bad.push(`cases: 모르는 사례: ${show(c.name)}`);
  }

  if (typeof result.server !== 'string' || !result.server.startsWith('PostgreSQL'))
    bad.push(`server가 PostgreSQL로 시작하지 않는다: ${show(result.server)}`);

  return bad;
}

/** 결과의 platform·arch가 결과 파일 이름(<platform>-<arch>)과 같은지 본다 */
export function checkPlatform(result: unknown, name: string): string[] {
  if (!isObj(result)) return [`결과가 객체가 아니다: ${show(result)}`];
  const { platform, arch } = result;
  if (typeof platform !== 'string' || typeof arch !== 'string')
    return [`platform·arch가 문자열이 아니다: ${show(platform)}, ${show(arch)}`];
  return `${platform}-${arch}` === name
    ? []
    : [`파일 이름(${name})과 결과의 플랫폼(${show(platform)}-${show(arch)})이 다르다`];
}

/**
 * target이 parent의 밖에 있는가. parent 자신과 그 아래는 밖이 아니다.
 * Windows에서 드라이브가 다르면 상대 경로가 절대 경로로 나온다(그것도 밖이다).
 * 이름이 ..으로 시작하는 하위 폴더(..tmp)는 밖이 아니므로 첫 구성 요소가 정확히 ..인지 본다.
 */
export function isOutsideDir(
  parent: string,
  target: string,
  p: Pick<typeof path, 'relative' | 'isAbsolute' | 'sep'> = path,
): boolean {
  const rel = p.relative(parent, target);
  if (rel === '') return false;
  if (p.isAbsolute(rel)) return true;
  return rel.split(p.sep)[0] === '..';
}

/** 이 리포가 고정한 패키지 관리자(package.json의 packageManager, 예: pnpm@10.34.5). 읽지 못하면 빈 글 */
export function readRepoPackageManager(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(REPO_PACKAGE_JSON, 'utf8'));
    return isObj(pkg) && typeof pkg.packageManager === 'string' ? pkg.packageManager : '';
  } catch {
    return '';
  }
}

/**
 * 잴 때 쓴 pnpm이 이 리포가 고정한 버전인지 본다. 기준은 리포의 packageManager다.
 * 결과 안의 두 칸(pnpm, packageManager)이 서로 같기만 한 것은 통과가 아니다(둘 다 같은 구버전일 수 있다).
 */
export function checkPnpm(result: unknown, repoPackageManager: string): string[] {
  if (!isObj(result)) return [`결과가 객체가 아니다: ${show(result)}`];
  const m = PNPM_RE.exec(repoPackageManager);
  if (!m)
    return [
      `이 리포의 packageManager를 읽지 못했다(pnpm@<버전>이어야 한다): ${show(repoPackageManager)}`,
    ];
  const bad: string[] = [];
  if (result.packageManager !== repoPackageManager)
    bad.push(
      `packageManager가 이 리포가 고정한 ${repoPackageManager}와 다르다: ${show(result.packageManager)}`,
    );
  if (result.pnpm !== m[1])
    bad.push(`pnpm 버전이 이 리포가 고정한 ${m[1]}와 다르다: ${show(result.pnpm)}`);
  return bad;
}

/**
 * 확정 조건(ADR-0007)에 모자란 점. 빈 배열이면 채워진 것이다.
 * 필요한 환경마다 검사를 통과한 결과가 하나 이상 있어야 하고, 통과하지 못한 결과 파일이 하나도 없어야 한다.
 */
export function confirmProblems(checked: readonly { name: string; bad: string[] }[]): string[] {
  const out: string[] = [];
  for (const p of REQUIRED_PLATFORMS)
    if (!checked.some((c) => c.name.startsWith(`${p}-`) && c.bad.length === 0))
      out.push(`${p}: 검사를 통과한 결과 파일이 없다(${p}-<arch>.json)`);
  for (const c of checked)
    if (c.bad.length)
      out.push(`${c.name}: 검사를 통과하지 못했다(${c.bad.length}건). 첫 번째: ${c.bad[0]}`);
  return out;
}

/** 결과 파일 하나를 읽어 모든 검사를 돌린다. 읽지 못하면 그것이 어긋난 점이다 */
function checkFile(file: string, name: string, repoPackageManager: string): string[] {
  try {
    if (!existsSync(file)) throw new Error('결과 파일이 없다');
    const result: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return [
      ...checkPlatform(result, name),
      ...checkQ10(result),
      ...checkPnpm(result, repoPackageManager),
    ];
  } catch (e) {
    return [`결과를 읽지 못했다: ${e instanceof Error ? e.message : String(e)}`];
  }
}

function confirm(dir: string): number {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write('--confirm: 결과 폴더가 없다\n');
    return 1;
  }
  const repoPackageManager = readRepoPackageManager();
  const checked = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const name = f.slice(0, -'.json'.length);
      const bad = NAME_RE.test(name)
        ? checkFile(path.join(dir, f), name, repoPackageManager)
        : ['결과 파일 이름이 <platform>-<arch> 꼴이 아니다'];
      return { name, bad };
    });
  for (const c of checked) if (!c.bad.length) process.stdout.write(`${c.name}: 통과\n`);
  const problems = confirmProblems(checked);
  if (problems.length) {
    process.stderr.write(`--confirm: 확정 조건이 채워지지 않았다(${problems.length}건)\n`);
    for (const p of problems) process.stderr.write(`- ${p}\n`);
    return 1;
  }
  process.stdout.write(`--confirm: 확정 조건이 채워졌다(${REQUIRED_PLATFORMS.join(', ')})\n`);
  return 0;
}

const USAGE =
  '사용법: node lab/q10-db/check-results.ts <platform>-<arch> | --file <결과 파일> | --confirm [<결과 폴더>]\n';

function main(argv: string[]): number {
  if (argv[0] === '--confirm') {
    if (argv.length > 2) {
      process.stderr.write(USAGE);
      return 2;
    }
    return confirm(argv[1] ? path.resolve(argv[1]) : RESULTS_DIR);
  }
  let file: string;
  let name: string;
  let label: string;
  if (argv.length === 2 && argv[0] === '--file' && argv[1]) {
    file = path.resolve(argv[1]);
    name = `${process.platform}-${process.arch}`;
    label = `--file(${name})`;
  } else if (argv.length === 1 && NAME_RE.test(argv[0])) {
    name = argv[0];
    file = path.join(RESULTS_DIR, `${name}.json`);
    label = name;
  } else {
    process.stderr.write(USAGE);
    return 2;
  }
  const bad = checkFile(file, name, readRepoPackageManager());
  if (bad.length) {
    process.stderr.write(`${label}: 기대와 어긋난 점 ${bad.length}건\n`);
    for (const b of bad) process.stderr.write(`- ${b}\n`);
    return 1;
  }
  process.stdout.write(`${label}: 통과\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
