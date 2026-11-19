// verify 실물 확인(계획 20261119-pilot-prep step3, 수용 기준 4·5·6·8·9).
// 웹 프로파일을 적용하고 Playwright와 Chromium을 설치한 복제 폴더에서 `node scripts/harness.ts verify`를 사례마다 돌리고,
// 관찰한 값을 결과 파일에 옮긴다. 준비(복제, init, 의존성과 Chromium 설치)는 README의 명령으로 먼저 한다.
//
//   node lab/pilot-prep/trial-verify.ts <복제한 폴더>
//
// 실제 외부 주소로는 아무것도 보내지 않는다. 대상은 이 스크립트가 띄운 로컬 서버(도달을 센다)와
// 해석되지 않는 이름(external.invalid)이다. 설정이 틀려 요청이 프록시를 지나지 않아도 밖으로 나가지 않는다.
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'results',
  'verify-playwright.json',
);

/** 어디에도 새면 안 되는 합성 표식. 호스트 이름에도 넣으므로 소문자와 숫자만 쓴다 */
const MARK = 'zqtrialmark5d81e7';
const FIXTURE = 'profiles/web/verify/fixture';
const APP_DIR = 'trial-app';
const HITS = `${APP_DIR}/hits.json`;
const SHELL_MARKER = 'trial-shell-marker';

function fail(msg: string): never {
  process.stderr.write(`trial-verify: ${msg}\n`);
  process.exit(1);
}

// --- 앱(app:dev). PORT·HOST를 따르는 작은 HTTP 서버. 복제 폴더에 파일로 쓴다 ---

const APP_SERVER = String.raw`// trial-verify.ts가 쓴 파일이다. verify가 dev로 띄운다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const state = JSON.parse(readFileSync('trial-app/state.json', 'utf8'));
const port = Number(process.env.PORT);
const self = '127.0.0.1:' + port;
const other = state.otherPort;
const tcp = state.tcpPort;
const mark = state.marker;
// 통제된 대상으로서 센다: HTTP가 아닌 연결(clientErrors), Host가 앱 주소가 아닌 요청(badHost), 워커 스크립트 요청
const hits = { appPort: port, clientErrors: 0, badHost: 0, swScriptHits: 0, signalStarted: false };
const save = () => writeFileSync('trial-app/hits.json', JSON.stringify(hits));
save();

const DONE = "const done = (label) => { document.title = 'done:' + label; };";
const fetchPage = (url) =>
  'fetch(' + JSON.stringify(url) + ").then(() => done('ok'), () => done('error'));";
const socketPage = (url) =>
  'const ws = new WebSocket(' + JSON.stringify(url) + ");ws.onopen = () => done('open');ws.onerror = () => done('error');";
const PAGES = {
  'console-error': "console.error('trial: console error on purpose');done('ok');",
  'failed-request': fetchPage('/missing'),
  'ws-same-port': socketPage('ws://' + self + '/ws'),
  'other-port': fetchPage('http://127.0.0.1:' + other + '/hit'),
  'localhost-port': fetchPage('http://localhost:' + other + '/hit'),
  'named-host': fetchPage('http://ext.localhost:' + other + '/hit'),
  'ipv6-loopback': fetchPage('http://[::1]:' + other + '/hit'),
  'app-alias': fetchPage('http://localhost:' + port + '/'),
  'https-other-port': fetchPage('https://127.0.0.1:' + tcp + '/'),
  'external-name-http': fetchPage('http://external.invalid/'),
  'external-name-https': fetchPage('https://external.invalid/'),
  'websocket-out': socketPage('ws://127.0.0.1:' + other + '/ws'),
  'wss-same-port': socketPage('wss://' + self + '/ws'),
  // 등록이 거부되면 잡히지 않은 예외가 되고 제목이 바뀌지 않는다(시나리오가 실패한다)
  'service-worker': "navigator.serviceWorker.register('/sw.js').then(() => done('registered'));",
  marker:
    'console.error(' + JSON.stringify('trial ' + mark) + ');' +
    'Promise.allSettled([fetch(' + JSON.stringify('/missing-' + mark + '?q=' + mark) + '),' +
    'fetch(' + JSON.stringify('http://' + mark + '.invalid/') + ")]).then(() => done('ok'));",
};

const html = (res, body) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8">' + body);
};

const server = http.createServer((req, res) => {
  if (req.headers.host !== self) {
    hits.badHost++;
    save();
  }
  const p = new URL(req.url, 'http://' + self).pathname;
  if (p === '/') return html(res, '<title>trial app</title><h1>trial</h1>');
  if (p === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (p.startsWith('/case/') && Object.hasOwn(PAGES, p.slice(6))) {
    const name = p.slice(6);
    const text = name === 'marker' ? mark : name;
    return html(res, '<title>case</title><p>' + text + '</p><script>' + DONE + PAGES[name] + '</script>');
  }
  if (p === '/redirect-out') {
    res.writeHead(302, { location: 'http://127.0.0.1:' + other + '/redirected' });
    return res.end();
  }
  if (p === '/redirect-https') {
    res.writeHead(302, { location: 'https://' + self + '/' });
    return res.end();
  }
  if (p === '/sw.js') {
    hits.swScriptHits++;
    save();
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end("fetch('http://127.0.0.1:" + other + "/from-sw').catch(() => {});");
  }
  if (p === '/signal-started') {
    hits.signalStarted = true;
    save();
    return html(res, '<title>signal</title>');
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});
// 같은 포트의 평문 웹소켓은 받아 준다(HMR 구실)
server.on('upgrade', (req, socket) => {
  if (req.headers.host !== self) {
    hits.badHost++;
    save();
  }
  const accept = createHash('sha1')
    .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.on('error', () => {});
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
      accept +
      '\r\n\r\n',
  );
});
server.on('clientError', (err, socket) => {
  hits.clientErrors++;
  save();
  socket.destroy();
});
server.listen(port, process.env.HOST);
`;

// --- 시나리오 파일 ---

const up = (file: string) => '../'.repeat(file.split('/').length - 1);
const head = (file: string, direct = false) =>
  direct
    ? "import { expect, test } from '@playwright/test';\n\n"
    : `import { expect, test } from '${up(file)}${FIXTURE}';\n\n`;
/** 사례 페이지를 열고 페이지의 동작이 끝나기를(제목이 done:…) 기다린다 */
const visit = (page: string, o: { declare?: string; title?: string; name?: string } = {}) =>
  `test('${o.name ?? page}', async ({ page${o.declare ? ', verify' : ''} }) => {\n${o.declare ?? ''}` +
  `  await page.goto('/case/${page}');\n  await expect(page).toHaveTitle(${o.title ?? '/^done:/'});\n});\n`;
const home = (name: string) =>
  `test('${name}', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle('trial app');\n});\n`;
const navigate = (name: string, to: string) =>
  `test('${name}', async ({ page }) => {\n  // 리다이렉트의 뒤 목적지가 거부되어 이동이 실패할 수 있다\n  await page.goto('${to}').catch(() => {});\n});\n`;
// 우회 탐지(bypass-scan)가 이 스크립트를 건너뛴 테스트로 읽지 않게 나눠 적는다
const SKIP_CALL = 'test.' + 'sk' + 'ip';

interface Case {
  id: string;
  /** 시나리오 파일(리포 기준). null이면 파일을 만들지 않는다 */
  file: string | null;
  content?: (file: string) => string;
  /** 함께 만들어 두는 다른 파일 */
  extra?: { file: string; content: (file: string) => string }[];
  /** verify에 넘기는 인자. 없으면 [file] */
  args?: string[];
  signal?: boolean;
}

const OUTSIDE_PAGES = [
  'other-port',
  'localhost-port',
  'named-host',
  'ipv6-loopback',
  'app-alias',
  'https-other-port',
  'external-name-http',
  'external-name-https',
  'websocket-out',
  'wss-same-port',
];
const page = (id: string, o?: Parameters<typeof visit>[1]): Case => ({
  id,
  file: `e2e/t-${id}.spec.ts`,
  content: (f) => head(f) + visit(id, o),
});

const CASES: Case[] = [
  { id: 'pass', file: 'e2e/t-pass.spec.ts', content: (f) => head(f) + home('pass') },
  {
    id: 'exact-select',
    file: 'e2e/sel/a.spec.ts',
    content: (f) => head(f) + home('exact-select'),
    extra: [
      {
        file: 'e2e/sel/more-e2e/sel/a.spec.ts',
        content: (f) =>
          head(f) + "test('골라지면 안 되는 시나리오', async () => {\n  expect(1).toBe(2);\n});\n",
      },
    ],
  },
  page('console-error'),
  page('failed-request'),
  {
    id: 'allowed-request-only',
    file: 'e2e/t-allowed-request-only.spec.ts',
    content: (f) =>
      head(f) +
      visit('failed-request', {
        name: 'allowed-request-only',
        declare: "  verify.allowFailedRequest('/missing');\n",
      }),
  },
  {
    id: 'allowed-failure',
    file: 'e2e/t-allowed-failure.spec.ts',
    content: (f) =>
      head(f) +
      visit('failed-request', {
        name: 'allowed-failure',
        declare:
          "  verify.allowFailedRequest('/missing');\n  verify.allowConsoleError(/status of 404/);\n",
      }),
  },
  page('ws-same-port', { title: "'done:open'" }),
  ...OUTSIDE_PAGES.slice(0, 8).map((id) => page(id)),
  {
    id: 'redirect-out',
    file: 'e2e/t-redirect-out.spec.ts',
    content: (f) => head(f) + navigate('redirect-out', '/redirect-out'),
  },
  {
    id: 'redirect-https-same-port',
    file: 'e2e/t-redirect-https-same-port.spec.ts',
    content: (f) => head(f) + navigate('redirect-https-same-port', '/redirect-https'),
  },
  ...OUTSIDE_PAGES.slice(8).map((id) => page(id)),
  page('service-worker', { title: "'done:registered'" }),
  {
    id: 'allow-blocked',
    file: 'e2e/t-allow-blocked.spec.ts',
    content: (f) =>
      head(f) +
      visit('other-port', {
        name: 'allow-blocked',
        declare: '  verify.allowFailedRequest(/./);\n  verify.allowConsoleError(/./);\n',
      }),
  },
  {
    id: 'no-fixture',
    file: 'e2e/t-no-fixture.spec.ts',
    content: (f) => head(f, true) + home('no-fixture'),
  },
  {
    id: 'no-fixture-out',
    file: 'e2e/t-no-fixture-out.spec.ts',
    content: (f) => head(f, true) + visit('other-port', { name: 'no-fixture-out' }),
  },
  {
    id: 'skipped',
    file: 'e2e/t-skipped.spec.ts',
    content: (f) =>
      head(f) + `${SKIP_CALL}('skipped', async ({ page }) => {\n  await page.goto('/');\n});\n`,
  },
  {
    id: 'marker',
    file: 'e2e/t-marker.spec.ts',
    content: (f) =>
      head(f) +
      `test('marker ${MARK}', async ({ page }) => {\n  await page.goto('/case/marker');\n` +
      `  await expect(page.getByText('${MARK}')).toBeVisible();\n  await expect(page).toHaveTitle(/^done:/);\n` +
      // 시나리오 자체도 실패시킨다: 표식이 오류 문구, trace, 영상, 스크린샷에도 들어간다(모두 local/에만 남아야 한다)
      `  expect(await page.title(), '${MARK}').toBe('${MARK}');\n});\n`,
  },
  {
    // 시나리오 코드가 Node 쪽에서 보내는 요청(Playwright의 request). 브라우저 밖이지만 같은 프록시 설정을 따른다
    id: 'node-request',
    file: 'e2e/t-node-request.spec.ts',
    content: (f) =>
      head(f) +
      "test('node-request', async ({ page, request }) => {\n  await page.goto('/');\n" +
      `  const target = 'http://127.0.0.1:' + process.env.TRIAL_OTHER_PORT + '/from-node';\n` +
      '  await request.get(target).catch(() => {});\n  await page.request.get(target).catch(() => {});\n' +
      "  await expect(page).toHaveTitle('trial app');\n});\n",
  },
  {
    id: 'signal',
    file: 'e2e/t-signal.spec.ts',
    content: (f) =>
      head(f) +
      "test('signal', async ({ page }) => {\n  test.setTimeout(600_000);\n  await page.goto('/signal-started');\n" +
      '  await new Promise(() => {});\n  expect(true).toBe(true);\n});\n',
    signal: true,
  },
  { id: 'shell-arg', file: null },
];

// --- 통제된 대상: 닿으면 센다 ---

interface Targets {
  otherPort: number;
  tcpPort: number;
  /** 지금까지 닿은 횟수(연결, HTTP 요청, 업그레이드 요청) */
  hits(): number;
  reset(): void;
}

function listen(server: net.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });
}

async function startTargets(): Promise<Targets> {
  let count = 0;
  const httpServer = () => {
    const s = http.createServer((req, res) => {
      count++;
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      res.end('controlled target');
    });
    s.on('connection', () => count++);
    s.on('upgrade', (req, socket) => {
      count++;
      socket.destroy();
    });
    s.on('clientError', (err, socket) => socket.destroy());
    return s;
  };
  const otherPort = await listen(httpServer(), 0, '127.0.0.1');
  try {
    await listen(httpServer(), otherPort, '::1');
  } catch (e) {
    fail(
      `[::1]:${otherPort}에서 듣지 못했다(${e instanceof Error ? e.message : '오류'}). IPv6 루프백이 있는 기기에서 돌려라`,
    );
  }
  const tcp = net.createServer((socket) => {
    count++;
    socket.on('error', () => {});
    socket.destroy();
  });
  const tcpPort = await listen(tcp, 0, '127.0.0.1');
  return { otherPort, tcpPort, hits: () => count, reset: () => (count = 0) };
}

/** 계측 자기 점검: 대상 서버 셋에 직접 닿아 보고 계수기가 오르는지 확인한다 */
async function selfCheckTargets(t: Targets): Promise<void> {
  const get = (host: string) =>
    new Promise<void>((resolve, reject) => {
      http
        .get({ host, port: t.otherPort, path: '/self-check', agent: false }, (res) => {
          res.resume();
          res.on('end', () => resolve());
        })
        .on('error', reject);
    });
  const connect = () =>
    new Promise<void>((resolve, reject) => {
      const s = net.connect(t.tcpPort, '127.0.0.1');
      s.once('error', reject);
      s.once('close', () => resolve());
    });
  t.reset();
  await get('127.0.0.1');
  const a = t.hits();
  await get('::1');
  const b = t.hits();
  await connect();
  const c = t.hits();
  if (!(a > 0 && b > a && c > b))
    fail(`자기 점검: 통제된 대상이 도달을 세지 못한다(${a}, ${b}, ${c})`);
  t.reset();
}

/** 계측 자기 점검: 앱을 직접 띄워 Host가 다른 요청과 HTTP가 아닌 연결을 보내고 계수기가 오르는지 확인한다 */
async function selfCheckApp(root: string): Promise<void> {
  const port = await new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      s.close(() => resolve(p));
    });
  });
  const app = spawn(process.execPath, [`${APP_DIR}/server.mjs`], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  const send = (payload: string) =>
    new Promise<boolean>((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => s.write(payload));
      s.once('error', () => resolve(false));
      s.once('close', () => resolve(true));
      s.on('data', () => s.destroy());
    });
  try {
    const until = Date.now() + 15_000;
    let up = false;
    while (!up && Date.now() < until) {
      up = await send(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      if (!up) await new Promise((r) => setTimeout(r, 50));
    }
    if (!up) fail('자기 점검: 앱이 뜨지 않았다');
    await send(`GET / HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`);
    await send('\x16\x03\x01\x00\x05hello\r\n\r\n');
    const hits = JSON.parse(readFileSync(path.join(root, HITS), 'utf8')) as Record<string, number>;
    if (hits.badHost !== 1 || hits.clientErrors !== 1)
      fail(
        `자기 점검: 앱이 도달을 세지 못한다(badHost ${hits.badHost}, clientErrors ${hits.clientErrors})`,
      );
  } finally {
    app.kill('SIGKILL');
  }
}

// --- 프로세스 ---

function processes(): Map<number, string> {
  const r = spawnSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = new Map<number, string>();
  for (const line of (r.stdout ?? '').split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}
function cwdOf(pid: number): string {
  try {
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/cwd`);
    const r = spawnSync('lsof', ['-a', '-d', 'cwd', '-p', String(pid), '-Fn'], {
      encoding: 'utf8',
    });
    return (
      (r.stdout ?? '')
        .split('\n')
        .find((l) => l.startsWith('n'))
        ?.slice(1) ?? ''
    );
  } catch {
    return '';
  }
}
const BROWSER = /ms-playwright|headless[-_]shell/;
const OURS =
  /playwright|trial-app\/server\.mjs|scripts\/verify\/web\.ts|scripts\/harness\.ts verify/;
/** 이 실행이 띄웠고 아직 남아 있는 dev·실행기·브라우저·verify 프로세스 */
function leftover(before: Map<number, string>, root: string): string[] {
  const out: string[] = [];
  for (const [pid, command] of processes()) {
    if (before.has(pid) || pid === process.pid) continue;
    if (BROWSER.test(command) || (OURS.test(command) && cwdOf(pid) === root))
      out.push(`${pid} ${command.slice(0, 160)}`);
  }
  return out;
}

// --- 실행 ---

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (process.argv.length !== 3 || !arg)
    fail('사용법: node lab/pilot-prep/trial-verify.ts <복제한 폴더>');
  if (process.platform === 'win32') fail('verify는 Windows를 지원하지 않는다');
  const root = realpathSync(path.resolve(arg));
  const at = (rel: string) => path.join(root, rel);
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(at(rel)), { recursive: true });
    writeFileSync(at(rel), content);
  };

  const pwPkg = at('node_modules/@playwright/test/package.json');
  if (!existsSync(pwPkg))
    fail(`@playwright/test가 설치돼 있지 않다(${pwPkg}). README의 준비 명령을 먼저 실행하라`);
  const cfg = readJson(at('harness.config.json')) as {
    profile?: string;
    commands?: { verify?: { run?: string } | null };
  };
  if (cfg.profile !== 'web' || cfg.commands?.verify?.run !== 'node scripts/verify/web.ts')
    fail(
      '웹 프로파일이 적용돼 있지 않다. `node scripts/harness.ts init --profile web`을 먼저 실행하라',
    );
  const specs = readdirSync(at('e2e'), { recursive: true, encoding: 'utf8' }).filter((f) =>
    f.endsWith('.spec.ts'),
  );
  if (specs.length !== 1 || specs[0] !== 'smoke.spec.ts' || existsSync(at(APP_DIR)))
    fail(
      'e2e/에 smoke.spec.ts 말고 다른 시나리오가 있거나 trial-app/이 이미 있다. 새로 복제한 폴더에서 돌려라',
    );

  const targets = await startTargets();
  await selfCheckTargets(targets);
  write(`${APP_DIR}/server.mjs`, APP_SERVER);
  write(
    `${APP_DIR}/state.json`,
    JSON.stringify({ otherPort: targets.otherPort, tcpPort: targets.tcpPort, marker: MARK }),
  );
  const pkg = readJson(at('package.json')) as { scripts?: Record<string, string> };
  pkg.scripts = { ...pkg.scripts, 'app:dev': `node ${APP_DIR}/server.mjs` };
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  await selfCheckApp(root);

  const runs = () => (existsSync(at('.harness-verify')) ? readdirSync(at('.harness-verify')) : []);
  const sum = (list: Json[], key: string) =>
    list.reduce((n, s) => n + (typeof s[key] === 'number' ? (s[key] as number) : 0), 0);

  async function runCase(c: Case): Promise<Json> {
    const args = c.args ?? (c.file ? [c.file] : []);
    write(
      HITS,
      JSON.stringify({
        appPort: 0,
        clientErrors: 0,
        badHost: 0,
        swScriptHits: 0,
        signalStarted: false,
      }),
    );
    targets.reset();
    const before = processes();
    const runsBefore = new Set(runs());
    process.stdout.write(`--- ${c.id}: verify ${args.join(' ')}\n`);
    const child = spawn(
      process.execPath,
      ['scripts/harness.ts', 'verify', ...(args.length ? ['--', ...args] : [])],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TRIAL_OTHER_PORT: String(targets.otherPort) },
      },
    );
    let output = '';
    let runningBeforeSignal: number | null = null;
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    if (c.signal) {
      // 시나리오가 브라우저로 앱에 닿은 뒤에 신호를 보낸다
      const until = Date.now() + 120_000;
      let started = false;
      while (!started && child.exitCode === null && Date.now() < until) {
        await sleep(100);
        try {
          started = (readJson(at(HITS)) as { signalStarted?: boolean }).signalStarted === true;
        } catch {
          // 앱이 쓰는 중이다
        }
      }
      if (!started) process.stdout.write('    (시나리오가 시작되기 전에 끝났거나 시간이 지났다)\n');
      // 신호를 보내기 전에 떠 있는 것을 센다(남은 프로세스를 세는 방법이 이 프로세스들을 실제로 보는지 확인한다)
      runningBeforeSignal = leftover(before, root).length;
      child.kill('SIGTERM');
    }
    const end = await exited;
    // 남은 프로세스는 verify가 돌아간 바로 그 시점에 센다
    const left = leftover(before, root);
    // 이 프로세스의 대상 서버가 밀린 연결을 받아 세게 한다
    await sleep(300);

    const fresh = runs().filter((d) => !runsBefore.has(d));
    if (fresh.length > 1) fail(`${c.id}: 출력 폴더가 ${fresh.length}개 생겼다`);
    const outDir = fresh.length ? at(path.join('.harness-verify', fresh[0])) : null;
    const hits = readJson(at(HITS)) as Record<string, number>;
    let denied = 0;
    let deniedTargets: string[] = [];
    let deniedHosts: string[] = [];
    let scenarios: Json[] = [];
    let evidenceFiles: string[] = [];
    let evidenceText = '';
    if (outDir) {
      const detailFile = path.join(outDir, 'local', 'detail.json');
      const detail = existsSync(detailFile) ? readJson(detailFile) : null;
      if (isObj(detail) && isObj(detail.denied)) {
        denied = typeof detail.denied.count === 'number' ? detail.denied.count : -1;
        const requests = Array.isArray(detail.denied.requests)
          ? detail.denied.requests.filter(isObj)
          : [];
        deniedTargets = [...new Set(requests.map((r) => `${String(r.host)}:${String(r.port)}`))];
        deniedHosts = [...new Set(requests.map((r) => String(r.host)))];
      }
      const evidence = path.join(outDir, 'evidence');
      if (existsSync(evidence)) {
        evidenceFiles = readdirSync(evidence).sort();
        for (const f of evidenceFiles) evidenceText += readFileSync(path.join(evidence, f), 'utf8');
        const summaryFile = path.join(evidence, 'summary.json');
        const summary = existsSync(summaryFile) ? readJson(summaryFile) : null;
        if (isObj(summary) && Array.isArray(summary.scenarios))
          scenarios = summary.scenarios.filter(isObj);
      }
    }
    // 거부된 대상(호스트:포트)과 그 호스트 이름이 공개 요약에 있는가. 루프백의 흔한 이름은 호스트 검사에서 뺀다
    const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
    const deniedTargetInEvidence =
      deniedTargets.some((t) => evidenceText.includes(t)) ||
      deniedHosts.some((h) => !LOOPBACK.has(h) && evidenceText.includes(h));
    const result: Json = {
      id: c.id,
      exitCode: end.code,
      signal: end.signal,
      appPort: hits.appPort,
      targetHits: targets.hits() + hits.clientErrors + hits.badHost,
      denied,
      deniedTargets,
      scenarioFiles: [...new Set(scenarios.map((s) => String(s.file)))].sort(),
      scenarios,
      allowed: {
        consoleErrors: sum(scenarios, 'allowedConsoleErrors'),
        failedRequests: sum(scenarios, 'allowedFailedRequests'),
      },
      blocked: sum(scenarios, 'blockedRequests'),
      evidenceFiles,
      leftover: left.length,
      swScriptHits: hits.swScriptHits,
      markerInEvidence: evidenceText.includes(MARK),
      deniedTargetInEvidence,
      markerFile: existsSync(at(SHELL_MARKER)),
    };
    if (runningBeforeSignal !== null) result.runningBeforeSignal = runningBeforeSignal;
    process.stdout.write(
      `${output
        .split('\n')
        .filter((l) => l.trim())
        .slice(-6)
        .map((l) => `    ${l.slice(0, 200)}`)
        .join('\n')}\n` +
        `    => 종료 코드 ${String(end.code)}${end.signal ? `(${end.signal})` : ''}, 거부 ${denied}건 [${deniedTargets.join(', ')}], ` +
        `대상 도달 ${String(result.targetHits)}, 남은 프로세스 ${left.length}\n`,
    );
    for (const l of left) process.stdout.write(`    남은 프로세스: ${l}\n`);
    return result;
  }

  const cases: Json[] = [];
  // 사례 파일을 만들기 전: init이 만든 예시 시나리오만 있을 때 인자 없이 돌린다
  cases.push(await runCase({ id: 'full-run', file: null }));
  for (const c of CASES) {
    if (c.file && c.content) write(c.file, c.content(c.file));
    for (const x of c.extra ?? []) write(x.file, x.content(x.file));
  }
  for (const c of CASES) {
    if (c.id === 'shell-arg')
      cases.push(await runCase({ ...c, args: [`e2e/$(touch ${at(SHELL_MARKER)}).spec.ts`] }));
    else cases.push(await runCase(c));
  }

  // 스크린샷·trace·영상은 출력 폴더의 local/ 아래에만 있어야 한다. 실패 사례가 있으므로 trace가 하나 이상 있다
  const artifacts = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
    (f) =>
      !f.split(path.sep).includes('node_modules') &&
      !f.startsWith('.git' + path.sep) &&
      /\.(zip|webm|png|jpe?g|har)$/.test(f),
  );
  const inLocal = (f: string) =>
    /^\.harness-verify\/[^/]+\/local\//.test(f.split(path.sep).join('/'));
  const traces = artifacts.filter((f) => f.endsWith('.zip'));
  const traceOnlyInLocal = traces.length > 0 && artifacts.every(inLocal);

  // 설정에 쓴 프록시 우회 값: 설정 파일을 불러 읽는다(앱 포트 자리는 이름으로 바꿔 적는다)
  const PROBE_PORT = '65000';
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m = await import(${JSON.stringify(pathToFileURL(at('profiles/web/verify/playwright.config.ts')).href)});` +
        'process.stdout.write(m.default.use.launchOptions.proxy.bypass);',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        HARNESS_VERIFY_BASE_URL: `http://127.0.0.1:${PROBE_PORT}`,
        HARNESS_VERIFY_PROXY: 'http://127.0.0.1:65001',
        HARNESS_VERIFY_OUT: at('.harness-verify/probe'),
      },
    },
  );
  const bypass = probe.status === 0 ? probe.stdout.replaceAll(PROBE_PORT, '<앱 포트>') : '';

  let chromium = '';
  try {
    // @playwright/test → playwright → playwright-core(브라우저 목록). pnpm의 심볼릭 링크를 따라간다
    const playwright = realpathSync(
      path.join(path.dirname(realpathSync(pwPkg)), '..', '..', 'playwright'),
    );
    const browsers = readJson(path.join(playwright, '..', 'playwright-core', 'browsers.json')) as {
      browsers?: { name?: string; revision?: string; browserVersion?: string }[];
    };
    const b = browsers.browsers?.find((x) => x.name === 'chromium-headless-shell');
    chromium = b ? `${b.browserVersion ?? ''} (headless shell r${b.revision ?? ''})` : '';
  } catch {
    // 버전 표시는 없어도 된다
  }

  const result = {
    tool: {
      playwright: (readJson(pwPkg) as { version: string }).version,
      chromium,
      node: process.version,
      os: `${process.platform}-${process.arch}`,
    },
    bypass,
    marker: MARK,
    ports: { other: targets.otherPort, tcp: targets.tcpPort },
    // 계측 자기 점검: 통제된 대상과 앱의 계수기가 닿은 것을 실제로 센다(여기까지 왔으면 통과했다)
    selfCheck: true,
    traceOnlyInLocal,
    traces: traces.length,
    cases,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(
    `결과를 썼다: ${OUT}\n검사: node lab/pilot-prep/check-results.ts verify-playwright\n`,
  );
  // 대상 서버가 열려 있어 스스로 끝나지 않는다
  process.exit(0);
}

await main();
