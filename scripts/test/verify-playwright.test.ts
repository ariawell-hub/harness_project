// verify의 Playwright 쪽 파일(profiles/web/verify)과 웹 프로파일의 verify 활성화(계획 20261119-pilot-prep 수용 기준 6·7).
// Playwright를 실행하지 않는다(이 리포에는 없다). 파일 내용을 보고, 설정 파일은 Node로 불러 만들어진 값을 본다
// (설정 파일은 @playwright/test에서 형식만 가져오므로 패키지 없이도 불러올 수 있다).
// 실제 브라우저에서 도는 것은 lab/pilot-prep의 실물 확인이 본다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { runSync } from '../lib/exec.ts';
import { isScenarioPath, OBSERVATION_NAME } from '../verify/judge.ts';
import { DEFAULT_RUNNER } from '../verify/web.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

const DIR = path.join(HARNESS_ROOT, 'profiles', 'web', 'verify');
const CONFIG = path.join(DIR, 'playwright.config.ts');
const FIXTURE = path.join(DIR, 'fixture.ts');
const read = (f: string) => readFileSync(f, 'utf8');

const APP = 'http://127.0.0.1:41001';
const PROXY = 'http://127.0.0.1:41002';
const VARS = [
  'HARNESS_VERIFY_BASE_URL',
  'HARNESS_VERIFY_OUT',
  'HARNESS_VERIFY_PROXY',
  'HARNESS_VERIFY_SCENARIOS',
];

interface Loaded {
  code: number;
  stderr: string;
  /** 정규식은 { re, flags }로 바뀌어 온다 */
  config: Record<string, unknown> | null;
}

/** 설정 파일을 새 프로세스에서 불러 기본 내보내기를 JSON으로 받는다. `over`의 undefined는 그 변수를 없앤다 */
function load(over: Record<string, string | undefined> = {}, cwd = tmp('harness-pw-config-')) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const v of VARS) delete env[v];
  const set: Record<string, string | undefined> = {
    HARNESS_VERIFY_BASE_URL: APP,
    HARNESS_VERIFY_OUT: path.join(cwd, '.harness-verify', 'run'),
    HARNESS_VERIFY_PROXY: PROXY,
    ...over,
  };
  for (const [k, v] of Object.entries(set)) if (v !== undefined) env[k] = v;
  const script = `
    const m = await import(${JSON.stringify(pathToFileURL(CONFIG).href)});
    process.stdout.write(JSON.stringify(m.default, (k, v) =>
      v instanceof RegExp ? { re: v.source, flags: v.flags } : v));
  `;
  const r = runSync(process.execPath, ['--input-type=module', '-e', script], { cwd, env });
  let config: Loaded['config'] = null;
  if (r.code === 0) config = JSON.parse(r.stdout) as Record<string, unknown>;
  return { code: r.code, stderr: r.stderr, config, cwd } satisfies Loaded & { cwd: string };
}

const use = (c: Loaded['config']) => (c?.use ?? {}) as Record<string, unknown>;
const proxyOf = (c: Loaded['config']) =>
  ((use(c).launchOptions ?? {}) as { proxy?: { server?: string; bypass?: string } }).proxy;

// --- 파일 내용 ---

test('설정과 fixture에 기존 브라우저·프로필에 붙는 경로가 없다', () => {
  for (const f of [CONFIG, FIXTURE]) {
    const text = read(f);
    for (const word of ['connectOverCDP', 'launchPersistentContext', 'userDataDir', 'channel'])
      assert.equal(text.includes(word), false, `${path.basename(f)}에 ${word}가 있다`);
  }
});

test('설정 파일은 __dirname과 import.meta를 쓰지 않는다(대상 리포의 모듈 방식에 기대지 않는다)', () => {
  const text = read(CONFIG);
  assert.equal(text.includes('__dirname'), false);
  assert.equal(text.includes('import.meta'), false);
});

test('설정 파일에 verify의 환경 변수와 주소 제한·서비스 워커·forbidOnly가 있다', () => {
  const text = read(CONFIG);
  for (const word of [...VARS, '<-loopback>', 'serviceWorkers', 'forbidOnly'])
    assert.equal(text.includes(word), true, `설정 파일에 ${word}가 없다`);
});

test('fixture에 관찰 기록 첨부의 이름과 앱 주소 환경 변수가 있다', () => {
  const text = read(FIXTURE);
  assert.equal(text.includes(`'${OBSERVATION_NAME}'`), true);
  assert.equal(text.includes('HARNESS_VERIFY_BASE_URL'), true);
});

test('fixture는 요청을 막지 않는다(라우팅을 쓰지 않는다)', () => {
  const text = read(FIXTURE);
  for (const word of ['.route(', 'routeWebSocket', '.abort('])
    assert.equal(text.includes(word), false, `fixture에 ${word}가 있다`);
});

test('fixture와 설정 파일은 scripts/의 파일을 import하지 않는다', () => {
  const froms = (f: string) =>
    [...read(f).matchAll(/^import\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]);
  assert.deepEqual(froms(FIXTURE), ['@playwright/test']);
  assert.deepEqual(froms(CONFIG), ['node:path', '@playwright/test']);
  for (const f of [FIXTURE, CONFIG]) {
    assert.equal(/\brequire\s*\(/.test(read(f)), false);
    assert.equal(/\bimport\s*\(/.test(read(f)), false);
  }
});

test('DEFAULT_RUNNER의 --config가 가리키는 설정 파일이 있다', () => {
  const i = DEFAULT_RUNNER.indexOf('--config');
  assert.notEqual(i, -1);
  const rel = DEFAULT_RUNNER[i + 1];
  assert.equal(path.join(HARNESS_ROOT, rel), CONFIG);
  assert.equal(existsSync(CONFIG), true);
});

// --- 설정 파일이 만드는 값 ---

test('설정: 시나리오 폴더·결과 파일·산출물 폴더가 리포 루트(실행 폴더)와 출력 폴더 기준 절대 경로다', () => {
  const r = load();
  assert.equal(r.code, 0, r.stderr);
  const c = r.config!;
  const out = path.join(r.cwd, '.harness-verify', 'run');
  assert.equal(c.testDir, path.join(r.cwd, 'e2e'));
  assert.equal(c.testMatch, '**/*.spec.ts');
  assert.equal(c.outputDir, path.join(out, 'local', 'artifacts'));
  assert.deepEqual(c.reporter, [['line'], ['json', { outputFile: path.join(out, 'report.json') }]]);
  assert.equal(c.forbidOnly, true);
  assert.equal(c.retries, 0);
});

test('설정: 브라우저는 Chromium 하나이고 서비스 워커를 막으며 앱 주소가 baseURL이다', () => {
  const c = load().config;
  assert.equal(use(c).browserName, 'chromium');
  assert.equal(use(c).baseURL, APP);
  assert.equal(use(c).serviceWorkers, 'block');
  assert.equal(c!.projects, undefined);
  assert.equal(c!.webServer, undefined);
});

test('설정: 산출물은 스크린샷은 항상, trace와 영상은 실패했을 때만 남긴다', () => {
  const c = load().config;
  assert.equal(use(c).screenshot, 'on');
  assert.equal(use(c).trace, 'retain-on-failure');
  assert.equal(use(c).video, 'retain-on-failure');
});

test('설정: 프록시 우회는 <-loopback>과 그 실행의 앱 주소 둘(스킴까지)뿐이다', () => {
  const c = load().config;
  const want = { server: PROXY, bypass: '<-loopback>,http://127.0.0.1:41001,ws://127.0.0.1:41001' };
  // 브라우저 실행과 컨텍스트 양쪽에 같은 값이다(컨텍스트 쪽은 Playwright가 Node에서 보내는 요청에도 쓰인다)
  assert.deepEqual(proxyOf(c), want);
  assert.deepEqual(use(c).proxy, want);
});

test('설정: 환경 변수가 하나라도 없으면 verify로 실행하라는 안내와 함께 오류다', () => {
  for (const name of ['HARNESS_VERIFY_BASE_URL', 'HARNESS_VERIFY_OUT', 'HARNESS_VERIFY_PROXY']) {
    for (const value of [undefined, '']) {
      const r = load({ [name]: value });
      assert.notEqual(r.code, 0, `${name}=${String(value)}`);
      assert.match(r.stderr, new RegExp(name));
      assert.match(r.stderr, /node scripts\/harness\.ts verify/);
    }
  }
});

test('설정: 앱 주소와 프록시 주소가 http://127.0.0.1:<포트> 꼴이 아니면 오류다', () => {
  const bad = [
    'http://localhost:41001',
    'https://127.0.0.1:41001',
    'http://127.0.0.1:41001/',
    'http://127.0.0.1:41001/app',
    'http://127.0.0.1',
    'http://127.0.0.1:0',
    'http://127.0.0.1:65536',
    'http://127.0.0.1:41001,http://example.test',
    'http://0.0.0.0:41001',
    'http://[::1]:41001',
    'http://user@127.0.0.1:41001',
    ' http://127.0.0.1:41001',
  ];
  for (const name of ['HARNESS_VERIFY_BASE_URL', 'HARNESS_VERIFY_PROXY'])
    for (const value of bad) assert.notEqual(load({ [name]: value }).code, 0, `${name}=${value}`);
});

test('설정: 출력 폴더가 절대 경로가 아니면 오류다', () => {
  assert.notEqual(load({ HARNESS_VERIFY_OUT: '.harness-verify/run' }).code, 0);
});

test('설정: 시나리오를 지정하면 그 파일의 절대 경로에 처음부터 끝까지 일치하는 것만 고른다', () => {
  const r = load({
    HARNESS_VERIFY_SCENARIOS: JSON.stringify(['e2e/a.spec.ts', 'e2e/x/b.spec.ts']),
  });
  assert.equal(r.code, 0, r.stderr);
  const list = r.config!.testMatch as { re: string; flags: string }[];
  assert.equal(list.length, 2);
  const res = list.map((x) => new RegExp(x.re, x.flags));
  const picked = (p: string) => res.some((re) => re.test(p));
  const abs = (rel: string) => path.join(r.cwd, rel);
  assert.equal(picked(abs('e2e/a.spec.ts')), true);
  assert.equal(picked(abs('e2e/x/b.spec.ts')), true);
  // 경로가 정규식·부분 문자열로 겹치는 다른 파일
  for (const other of [
    abs('e2e/sub-e2e/a.spec.ts'),
    abs(`e2e/more${abs('e2e/a.spec.ts')}`),
    abs('e2e/a.spec.tsx'),
    abs('e2e/a.spec.ts.bak'),
    abs('e2e/axspec.ts'),
    abs('e2e/aaspec.ts'),
    abs('e2e/b.spec.ts'),
    `/other${abs('e2e/a.spec.ts')}`,
    `${abs('e2e/a.spec.ts')}\n`,
  ])
    assert.equal(picked(other), false, other);
});

test('설정: 실행 폴더 경로의 정규식 문자는 글자 그대로 읽는다', () => {
  const cwd = path.join(tmp('harness-pw-config-'), 'a+b (c) [d]');
  const made = runSync('mkdir', ['-p', cwd]);
  assert.equal(made.code, 0, made.stderr);
  const r = load({ HARNESS_VERIFY_SCENARIOS: JSON.stringify(['e2e/a.spec.ts']) }, cwd);
  assert.equal(r.code, 0, r.stderr);
  const [x] = r.config!.testMatch as { re: string; flags: string }[];
  const re = new RegExp(x.re, x.flags);
  assert.equal(re.test(path.join(cwd, 'e2e/a.spec.ts')), true);
  assert.equal(re.test(path.join(cwd.replace('a+b', 'aab'), 'e2e/a.spec.ts')), false);
});

test('설정: 시나리오 지정이 경로의 JSON 배열이 아니면 오류다(전체 실행으로 넘어가지 않는다)', () => {
  const bad = [
    '',
    'e2e/a.spec.ts',
    '{}',
    '[]',
    'null',
    '"e2e/a.spec.ts"',
    '[1]',
    '[null]',
    '[["e2e/a.spec.ts"]]',
    '["e2e/a.spec.ts", 1]',
    '["e2e/a.spec.ts"',
  ];
  for (const value of bad) {
    const r = load({ HARNESS_VERIFY_SCENARIOS: value });
    assert.notEqual(r.code, 0, value);
    assert.match(r.stderr, /HARNESS_VERIFY_SCENARIOS/);
  }
});

test('설정: 시나리오 경로 규칙이 isScenarioPath와 같다', () => {
  const paths = [
    'e2e/a.spec.ts',
    'e2e/a-b_c.1.spec.ts',
    'e2e/x/y/z.spec.ts',
    'e2e/sel/more-e2e/sel/a.spec.ts',
    'e2e/.spec.ts',
    'e2e/./a.spec.ts',
    'e2e/../a.spec.ts',
    'e2e//a.spec.ts',
    'e2e/.hidden/a.spec.ts',
    'e2e/-a.spec.ts',
    'e2e/[id].spec.ts',
    'e2e/a b.spec.ts',
    'e2e/(x)/a.spec.ts',
    'e2e/a.spec.tsx',
    'e2e/a.test.ts',
    'src/a.spec.ts',
    '/e2e/a.spec.ts',
    'e2e/$(touch x).spec.ts',
    'e2e/a|b.spec.ts',
    'e2e/a*.spec.ts',
    'e2e/한글.spec.ts',
    'E2E/a.spec.ts',
  ];
  let accepted = 0;
  for (const p of paths) {
    const r = load({ HARNESS_VERIFY_SCENARIOS: JSON.stringify([p]) });
    assert.equal(r.code === 0, isScenarioPath(p), p);
    if (r.code === 0) accepted++;
  }
  // 받는 경로와 거부하는 경로가 둘 다 있어야 비교가 뜻이 있다
  assert.equal(accepted, 4);
});

// --- 시나리오 예시 템플릿 ---

test('시나리오 예시는 하네스 fixture의 test를 쓰고, 복사될 자리(e2e/)에서 본 fixture 경로가 맞다', () => {
  const text = read(path.join(HARNESS_ROOT, 'profiles', 'web', 'templates', 'smoke.spec.ts'));
  const m = /import \{ expect, test \} from '([^']+)';/.exec(text);
  assert.ok(m, 'fixture에서 expect와 test를 import하지 않는다');
  const target = path.resolve(HARNESS_ROOT, 'e2e', m[1]);
  assert.equal(target === FIXTURE || `${target}.ts` === FIXTURE, true, m[1]);
  assert.equal(text.includes("from '@playwright/test'"), false);
});
