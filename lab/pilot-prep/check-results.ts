// 실물 확인 결과 파일 검사(계획 20261119-pilot-prep). 결과 파일은 trial-*.ts가 쓴다. 손으로 고치지 않는다.
// 사례마다 기대값을 대 보고, 하나라도 어긋나면 무엇이 어긋났는지 내고 종료 코드 1로 끝난다.
//
//   node lab/pilot-prep/check-results.ts test-effect-vitest
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(HERE, 'results');
const REPO_ROOT = path.resolve(HERE, '..', '..');

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** test-effect 실물 확인의 사례와 기대(step0 지시서의 표). phrase는 판정 줄에 있어야 하는 문구 */
export const TEST_EFFECT_CASES: readonly {
  id: string;
  file: string;
  outcome: 'ineffective' | 'effective';
  phrase: '단언 실패' | '단언 실패 아님' | null;
}[] = [
  { id: 'passes-on-base', file: 'src/keep.test.ts', outcome: 'ineffective', phrase: null },
  { id: 'assertion', file: 'src/change.test.ts', outcome: 'effective', phrase: '단언 실패' },
  { id: 'new-module', file: 'src/fresh.test.ts', outcome: 'effective', phrase: '단언 실패 아님' },
  { id: 'similar-pass', file: 'src/sim/a.test.ts', outcome: 'ineffective', phrase: null },
  { id: 'similar-fail', file: 'src/sim/a.test.tsx', outcome: 'effective', phrase: '단언 실패' },
  {
    id: 'similar-nested',
    file: 'src/sim/deep/src/sim/a.test.ts',
    outcome: 'effective',
    phrase: '단언 실패',
  },
  {
    id: 'special-path',
    file: 'src/app/(shop)/[id]/page.test.tsx',
    outcome: 'effective',
    phrase: '단언 실패',
  },
  // 래퍼가 없는 기준 커밋과 비교한 실행(first-adoption): 변경 전 코드에서도 테스트를 실제로 돌려야 한다
  { id: 'adoption-pass', file: 'src/adopt-pass.test.ts', outcome: 'ineffective', phrase: null },
  {
    id: 'adoption-fail',
    file: 'src/adopt-fail.test.ts',
    outcome: 'effective',
    phrase: '단언 실패',
  },
];
/** 실물 확인에 쓰는 Vitest 버전(README의 설치 명령과 같다) */
export const VITEST_VERSION = '5.1.0';
const TEST_EFFECT_RUNS: readonly { id: string; exitCode: number }[] = [
  { id: 'all', exitCode: 1 },
  { id: 'effective-only', exitCode: 0 },
  { id: 'first-adoption', exitCode: 1 },
];

/**
 * 결과 파일에서 읽은 값을 메시지에 넣을 글자로 바꾼다. 문자열은 그대로, 나머지는 JSON으로 적는다.
 * String()과 템플릿 문자열은 쓰지 않는다. `{"toString":null}` 같은 값에서 TypeError가 나 검사가 멈춘다(F21)
 */
const show = (v: unknown): string =>
  typeof v === 'string' ? v : (JSON.stringify(v) ?? 'undefined');

/** 결과가 기대와 어긋난 점의 목록. 비어 있으면 통과다. profileCommand는 웹 프로파일의 testEffect.command */
export function checkTestEffect(result: unknown, profileCommand: unknown): string[] {
  const bad: string[] = [];
  if (!isObj(result)) return ['결과가 객체가 아니다'];
  const tool = isObj(result.tool) ? result.tool : {};
  if (tool.vitest !== VITEST_VERSION)
    bad.push(`tool.vitest: ${show(tool.vitest)}(기대 ${VITEST_VERSION})`);
  if (!Array.isArray(profileCommand) || !same(result.command, profileCommand))
    bad.push(
      `command가 프로파일의 testEffect.command와 다르다: ${JSON.stringify(result.command)} / ${JSON.stringify(profileCommand)}`,
    );

  const runs = Array.isArray(result.runs) ? result.runs.filter(isObj) : [];
  for (const want of TEST_EFFECT_RUNS) {
    const got = runs.filter((r) => r.id === want.id);
    if (got.length !== 1) bad.push(`runs에 ${want.id}가 ${got.length}개다(1개여야 한다)`);
    else if (got[0].exitCode !== want.exitCode)
      bad.push(`runs.${want.id}의 종료 코드: ${show(got[0].exitCode)}(기대 ${want.exitCode})`);
  }

  const cases = Array.isArray(result.cases) ? result.cases.filter(isObj) : [];
  if (!Array.isArray(result.cases) || cases.length !== result.cases.length)
    bad.push('cases가 객체 배열이 아니다');
  const known = new Set(TEST_EFFECT_CASES.map((c) => c.id));
  for (const c of cases)
    if (typeof c.id !== 'string' || !known.has(c.id)) bad.push(`모르는 사례가 있다: ${show(c.id)}`);
  for (const want of TEST_EFFECT_CASES) {
    const got = cases.filter((c) => c.id === want.id);
    if (got.length !== 1) {
      bad.push(`사례 ${want.id}가 ${got.length}개다(1개여야 한다)`);
      continue;
    }
    const c = got[0];
    const line = typeof c.line === 'string' ? c.line : '';
    if (c.file !== want.file) bad.push(`${want.id}: file: ${show(c.file)}(기대 ${want.file})`);
    if (c.outcome !== want.outcome)
      bad.push(`${want.id}: outcome: ${show(c.outcome)}(기대 ${want.outcome})`);
    if (!line.startsWith(`${want.file}: ${want.outcome}(`))
      bad.push(`${want.id}: 판정 줄이 "${want.file}: ${want.outcome}("로 시작하지 않는다: ${line}`);
    if (want.phrase && !line.includes(want.phrase))
      bad.push(`${want.id}: 판정 줄에 "${want.phrase}"가 없다: ${line}`);
    if (want.phrase === '단언 실패' && line.includes('단언 실패 아님'))
      bad.push(`${want.id}: 판정 줄이 "단언 실패 아님"이다: ${line}`);
  }
  return bad;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) throw new Error(`파일이 없다: ${path.relative(REPO_ROOT, file)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 검사 이름 → 어긋난 점의 목록 */
const CHECKS: Record<string, () => string[]> = {
  'test-effect-vitest': () => {
    const profile = readJson(path.join(REPO_ROOT, 'profiles', 'web', 'profile.json')) as {
      config?: { testEffect?: { command?: unknown } };
    };
    return checkTestEffect(
      readJson(path.join(RESULTS_DIR, 'test-effect-vitest.json')),
      profile.config?.testEffect?.command,
    );
  },
};

function main(argv: string[]): number {
  const name = argv[0];
  if (argv.length !== 1 || !Object.hasOwn(CHECKS, name)) {
    process.stderr.write(
      `사용법: node lab/pilot-prep/check-results.ts <${Object.keys(CHECKS).join('|')}>\n`,
    );
    return 2;
  }
  let bad: string[];
  try {
    bad = CHECKS[name]();
  } catch (e) {
    bad = [`결과를 읽지 못했다: ${e instanceof Error ? e.message : String(e)}`];
  }
  if (bad.length) {
    process.stderr.write(`${name}: 기대와 어긋난 점 ${bad.length}건\n`);
    for (const b of bad) process.stderr.write(`- ${b}\n`);
    return 1;
  }
  process.stdout.write(`${name}: 통과\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
