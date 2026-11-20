// 실물 확인 결과 파일 검사(계획 20261119-pilot-prep). 결과 파일은 trial-*.ts가 쓴다. 손으로 고치지 않는다.
// 사례마다 기대값을 대 보고, 하나라도 어긋나면 무엇이 어긋났는지 내고 종료 코드 1로 끝난다.
//
//   node lab/pilot-prep/check-results.ts test-effect-vitest
//   node lab/pilot-prep/check-results.ts verify-playwright
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(HERE, 'results');
const REPO_ROOT = path.resolve(HERE, '..', '..');

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);

// 결과 파일의 값은 따라 내려가지 않는다(String(), 템플릿 문자열, JSON.stringify를 쓰지 않는다).
// `{"toString":null}`은 String()에서 TypeError를, 깊게 중첩된 값은 JSON.stringify에서 RangeError를 내
// 검사가 멈추고 어느 칸이 틀렸는지가 사라진다(구현 판정 F21, F22).
const SHOW_MAX = 200;
/** 값을 메시지에 넣을 글자로 바꾼다. 어떤 값에도 예외를 내지 않는다. 문자열은 길이를 자르고, 객체·배열은 종류만 적는다 */
function show(v: unknown): string {
  if (typeof v === 'string') return v.length > SHOW_MAX ? `${v.slice(0, SHOW_MAX)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  if (v === undefined) return '(없음)';
  if (Array.isArray(v)) return `배열(길이 ${v.length})`;
  return typeof v === 'object' ? '객체' : typeof v;
}
/** 문자열 배열이면 요소를 적고, 아니면 show와 같다(요소 안으로는 들어가지 않는다) */
const showList = (v: unknown): string =>
  Array.isArray(v) && v.length <= 20 ? `[${v.map(show).join(', ')}]` : show(v);
/** 둘 다 문자열 배열이고 요소가 모두 같다 */
const sameStrings = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((x, i) => typeof x === 'string' && x === b[i]);

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

/** 결과가 기대와 어긋난 점의 목록. 비어 있으면 통과다. profileCommand는 웹 프로파일의 testEffect.command */
export function checkTestEffect(result: unknown, profileCommand: unknown): string[] {
  const bad: string[] = [];
  if (!isObj(result)) return ['결과가 객체가 아니다'];
  const tool = isObj(result.tool) ? result.tool : {};
  if (tool.vitest !== VITEST_VERSION)
    bad.push(`tool.vitest: ${show(tool.vitest)}(기대 ${VITEST_VERSION})`);
  if (!sameStrings(result.command, profileCommand))
    bad.push(
      `command가 프로파일의 testEffect.command와 다르다: ${showList(result.command)} / ${showList(profileCommand)}`,
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
      bad.push(
        `${want.id}: 판정 줄이 "${want.file}: ${want.outcome}("로 시작하지 않는다: ${show(line)}`,
      );
    if (want.phrase && !line.includes(want.phrase))
      bad.push(`${want.id}: 판정 줄에 "${want.phrase}"가 없다: ${show(line)}`);
    if (want.phrase === '단언 실패' && line.includes('단언 실패 아님'))
      bad.push(`${want.id}: 판정 줄이 "단언 실패 아님"이다: ${show(line)}`);
  }
  return bad;
}

// --- verify 실물 확인(step3 지시서의 표) ---

/** 실물 확인에 쓰는 Playwright 버전(README의 설치 명령과 같다) */
export const PLAYWRIGHT_VERSION = '1.65.0';
/** 설정이 브라우저에 주는 프록시 우회 값. 앱 포트 자리는 이름으로 적혀 온다 */
export const VERIFY_BYPASS = '<-loopback>,http://127.0.0.1:<앱 포트>,ws://127.0.0.1:<앱 포트>';
const EVIDENCE_FILES = ['summary.json', 'summary.md'];
/** 표식이 든 호스트 이름 자리. 결과 파일의 marker로 바꿔 읽는다 */
const MARKER_HOST = '<marker>.invalid';

export interface VerifyCase {
  id: string;
  /** 하네스(`node scripts/harness.ts verify`)의 기대 종료 코드. null은 신호로 끝나 종료 코드가 없는 실행이다 */
  exit: 0 | 1 | null;
  /** 하네스가 이 신호로 끝나야 한다. 없으면 신호로 끝나지 않아야 한다 */
  signal?: 'SIGTERM' | 'SIGHUP';
  /**
   * 끝나지 않는 시나리오가 시작된 뒤에 도중에 끊는 사례. harness: 하네스에 `signal`을 보낸다.
   * runner: 실행기의 프로세스 그룹을 SIGKILL로 끝낸다(verify는 스스로 실패로 끝난다)
   */
  interrupt?: 'harness' | 'runner';
  /** 거부 프록시에 닿은 건수: none은 0, some은 1 이상, any는 보지 않는다 */
  denied: 'none' | 'some' | 'any';
  /** denied가 some일 때 deniedTargets에 있어야 하는 대상. port의 이름은 결과 파일의 포트로 바꿔 읽는다 */
  target?: { host: string; port: 'other' | 'tcp' | 'app' | number };
  /** summary.json의 시나리오 파일 목록 */
  files?: string[];
  /** summary.json의 의도한 실패 건수 */
  allowed?: { consoleErrors: number; failedRequests: number };
  /** fixture도 앱 주소 밖 요청을 적었다(blocked 1 이상). 없으면 0이어야 한다 */
  blocked?: boolean;
  /** 실패의 이유를 요약의 값으로 확인한다 */
  why?: 'console' | 'request' | 'no-observation' | 'skipped' | 'failed';
  /** 아무것도 띄우지 않아 증거 묶음이 없다 */
  noEvidence?: boolean;
}

const out = (id: string, host: string, port: 'other' | 'tcp' | 'app' | number): VerifyCase => ({
  id,
  exit: 1,
  denied: 'some',
  target: { host, port },
  blocked: true,
});
const NONE = { consoleErrors: 0, failedRequests: 0 };

export const VERIFY_CASES: readonly VerifyCase[] = [
  { id: 'full-run', exit: 0, denied: 'none', files: ['e2e/smoke.spec.ts'], allowed: NONE },
  { id: 'pass', exit: 0, denied: 'none', files: ['e2e/t-pass.spec.ts'], allowed: NONE },
  { id: 'exact-select', exit: 0, denied: 'none', files: ['e2e/sel/a.spec.ts'], allowed: NONE },
  { id: 'console-error', exit: 1, denied: 'none', why: 'console', allowed: NONE },
  { id: 'failed-request', exit: 1, denied: 'none', why: 'request', allowed: NONE },
  {
    id: 'allowed-request-only',
    exit: 1,
    denied: 'none',
    why: 'console',
    allowed: { consoleErrors: 0, failedRequests: 1 },
  },
  {
    id: 'allowed-failure',
    exit: 0,
    denied: 'none',
    allowed: { consoleErrors: 1, failedRequests: 1 },
  },
  { id: 'ws-same-port', exit: 0, denied: 'none', allowed: NONE },
  out('other-port', '127.0.0.1', 'other'),
  out('localhost-port', 'localhost', 'other'),
  out('named-host', 'ext.localhost', 'other'),
  out('ipv6-loopback', '[::1]', 'other'),
  out('app-alias', 'localhost', 'app'),
  out('https-other-port', '127.0.0.1', 'tcp'),
  out('external-name-http', 'external.invalid', 80),
  out('external-name-https', 'external.invalid', 443),
  out('redirect-out', '127.0.0.1', 'other'),
  out('redirect-https-same-port', '127.0.0.1', 'app'),
  out('websocket-out', '127.0.0.1', 'other'),
  out('wss-same-port', '127.0.0.1', 'app'),
  { id: 'service-worker', exit: 0, denied: 'none', allowed: NONE },
  out('allow-blocked', '127.0.0.1', 'other'),
  { id: 'no-fixture', exit: 1, denied: 'none', why: 'no-observation' },
  {
    id: 'no-fixture-out',
    exit: 1,
    denied: 'some',
    target: { host: '127.0.0.1', port: 'other' },
    why: 'no-observation',
  },
  { id: 'skipped', exit: 1, denied: 'none', why: 'skipped' },
  { ...out('marker', MARKER_HOST, 80), why: 'failed' },
  // 지시서의 표에 없는 사례(더 엄하게 본다): 시나리오 코드가 Node 쪽에서 보내는 요청도 거부 프록시에 닿는다
  { id: 'node-request', exit: 1, denied: 'some', target: { host: '127.0.0.1', port: 'other' } },
  { id: 'signal', exit: null, signal: 'SIGTERM', interrupt: 'harness', denied: 'any' },
  // 구현 판정 F1: 하네스가 넘기는 신호 가운데 SIGHUP에서도 verify가 정리한다
  { id: 'signal-hup', exit: null, signal: 'SIGHUP', interrupt: 'harness', denied: 'any' },
  // 구현 판정 F2: 실행기가 SIGKILL로 끝나 브라우저를 닫아 줄 것이 없을 때도 verify가 돌아간 시점에 브라우저가 없다
  { id: 'runner-killed', exit: 1, interrupt: 'runner', denied: 'any' },
  { id: 'shell-arg', exit: 1, denied: 'none', noEvidence: true },
];

const isInt = (x: unknown): x is number => Number.isInteger(x);
const isPort = (x: unknown): x is number => isInt(x) && x > 0 && x < 65536;

/** 결과가 기대와 어긋난 점의 목록. 비어 있으면 통과다 */
export function checkVerifyPlaywright(result: unknown): string[] {
  const bad: string[] = [];
  if (!isObj(result)) return ['결과가 객체가 아니다'];
  const tool = isObj(result.tool) ? result.tool : {};
  if (tool.playwright !== PLAYWRIGHT_VERSION)
    bad.push(`tool.playwright: ${show(tool.playwright)}(기대 ${PLAYWRIGHT_VERSION})`);
  if (result.bypass !== VERIFY_BYPASS)
    bad.push(`bypass: ${show(result.bypass)}(기대 ${VERIFY_BYPASS})`);
  if (result.traceOnlyInLocal !== true)
    bad.push(`traceOnlyInLocal: ${show(result.traceOnlyInLocal)}(기대 true)`);
  if (result.selfCheck !== true) bad.push(`selfCheck: ${show(result.selfCheck)}(기대 true)`);
  const marker =
    typeof result.marker === 'string' && /^[a-z0-9]{8,40}$/.test(result.marker)
      ? result.marker
      : null;
  if (marker === null)
    bad.push(`marker가 영문 소문자·숫자 8~40자가 아니다: ${show(result.marker)}`);
  const ports = isObj(result.ports) ? result.ports : {};
  for (const k of ['other', 'tcp'])
    if (!isPort(ports[k])) bad.push(`ports.${k}가 포트 번호가 아니다: ${show(ports[k])}`);

  const cases = Array.isArray(result.cases) ? result.cases.filter(isObj) : [];
  if (!Array.isArray(result.cases) || cases.length !== result.cases.length)
    bad.push('cases가 객체 배열이 아니다');
  const known = new Set(VERIFY_CASES.map((c) => c.id));
  for (const c of cases)
    if (typeof c.id !== 'string' || !known.has(c.id)) bad.push(`모르는 사례가 있다: ${show(c.id)}`);

  for (const want of VERIFY_CASES) {
    const got = cases.filter((c) => c.id === want.id);
    if (got.length !== 1) {
      bad.push(`사례 ${want.id}가 ${got.length}개다(1개여야 한다)`);
      continue;
    }
    const c = got[0];
    const miss = (what: string, value: unknown, expected: string) =>
      bad.push(`${want.id}: ${what}: ${showList(value)}(기대 ${expected})`);

    if (c.exitCode !== want.exit)
      miss('종료 코드', c.exitCode, want.exit === null ? '없음(신호로 끝난다)' : String(want.exit));
    // 신호로 끝나야 하는 사례는 그 신호로, 나머지는 신호 없이 끝났어야 한다(스스로 끝난 실행을 신호 사례로 치지 않는다)
    if (c.signal !== (want.signal ?? null)) miss('끝난 신호', c.signal, want.signal ?? '없음');
    // 공통 기대: 통제된 대상에 닿지 않았다, 남은 프로세스가 없다, 증거 묶음은 요약 둘뿐이고 새는 글자가 없다
    if (c.targetHits !== 0) miss('targetHits', c.targetHits, '0');
    if (c.leftover !== 0) miss('leftover', c.leftover, '0');
    const files = want.noEvidence ? [] : EVIDENCE_FILES;
    if (!sameStrings(c.evidenceFiles, files))
      miss('evidenceFiles', c.evidenceFiles, `[${files.join(', ')}]`);
    if (c.deniedTargetInEvidence !== false)
      miss('deniedTargetInEvidence', c.deniedTargetInEvidence, 'false');
    if (c.markerInEvidence !== false) miss('markerInEvidence', c.markerInEvidence, 'false');
    if (c.markerFile !== false) miss('markerFile', c.markerFile, 'false');
    if (c.swScriptHits !== 0) miss('swScriptHits', c.swScriptHits, '0');

    if (want.denied === 'none' && c.denied !== 0) miss('denied', c.denied, '0');
    if (want.denied === 'some') {
      if (!isInt(c.denied) || c.denied < 1) miss('denied', c.denied, '1 이상');
      const t = want.target;
      if (t) {
        const host = t.host === MARKER_HOST ? `${marker ?? ''}.invalid` : t.host;
        const port =
          t.port === 'app' ? c.appPort : typeof t.port === 'number' ? t.port : ports[t.port];
        const target = isPort(port) ? `${host}:${port}` : null;
        const listed = Array.isArray(c.deniedTargets) ? c.deniedTargets : [];
        if (target === null) miss('대상의 포트', port, '포트 번호');
        else if (!listed.includes(target)) miss('deniedTargets', c.deniedTargets, `${target} 포함`);
      }
    }
    if (want.files && !sameStrings(c.scenarioFiles, want.files))
      miss('scenarioFiles', c.scenarioFiles, `[${want.files.join(', ')}]`);
    if (want.allowed) {
      const a = isObj(c.allowed) ? c.allowed : {};
      if (
        a.consoleErrors !== want.allowed.consoleErrors ||
        a.failedRequests !== want.allowed.failedRequests
      )
        bad.push(
          `${want.id}: allowed: 콘솔 에러 ${show(a.consoleErrors)}·실패한 요청 ${show(a.failedRequests)}` +
            `(기대 ${want.allowed.consoleErrors}·${want.allowed.failedRequests})`,
        );
    }
    if (want.blocked ? !isInt(c.blocked) || c.blocked < 1 : c.blocked !== 0)
      miss('blocked(fixture가 적은 앱 주소 밖 요청)', c.blocked, want.blocked ? '1 이상' : '0');

    const scenarios = Array.isArray(c.scenarios) ? c.scenarios.filter(isObj) : [];
    if (want.exit === 0) {
      if (!scenarios.length || !scenarios.every((s) => s.ok === true && s.status === 'passed'))
        bad.push(`${want.id}: 통과한 실행인데 passed가 아닌 시나리오가 있거나 시나리오가 없다`);
    }
    if (want.why) {
      const s = scenarios.length === 1 ? scenarios[0] : null;
      if (!s) bad.push(`${want.id}: 시나리오가 ${scenarios.length}개다(1개여야 한다)`);
      else {
        const count = (k: string) => (isInt(s[k]) ? (s[k] as number) : -1);
        const ok = {
          console: count('consoleErrors') >= 1 && s.failedRequests === 0,
          request: count('failedRequests') >= 1,
          'no-observation': s.status === 'passed' && s.observation === false,
          skipped: s.status === 'skipped',
          failed: s.status === 'failed',
        }[want.why];
        if (!ok)
          bad.push(
            `${want.id}: 실패의 이유가 기대(${want.why})와 다르다: 상태 ${show(s.status)}, 관찰 기록 ${show(s.observation)}, ` +
              `콘솔 에러 ${show(s.consoleErrors)}, 실패한 요청 ${show(s.failedRequests)}`,
          );
      }
    }
    if (want.interrupt) {
      // 끊기 전에 시나리오가 브라우저로 앱에 닿은 것을 봤고, 신호를 실제로 보냈다
      if (c.started !== true) miss('started', c.started, 'true');
      if (c.signalSent !== true) miss('signalSent', c.signalSent, 'true');
      // 남은 프로세스를 세는 방법이 끊기 전에 떠 있던 것(verify, dev, 실행기)과 브라우저를 실제로 봤다
      if (!isInt(c.runningBeforeSignal) || c.runningBeforeSignal < 3)
        miss('runningBeforeSignal', c.runningBeforeSignal, '3 이상');
      if (!isInt(c.browsersBeforeSignal) || c.browsersBeforeSignal < 1)
        miss('browsersBeforeSignal', c.browsersBeforeSignal, '1 이상');
    }
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
  'verify-playwright': () =>
    checkVerifyPlaywright(readJson(path.join(RESULTS_DIR, 'verify-playwright.json'))),
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
