// verify 웹 구현의 실행·판정(계획 20261119-pilot-prep 수용 기준 3~5).
// 가짜 dev(작은 HTTP 서버)와 가짜 실행기(report.json을 쓰는 스크립트)로 본다. Playwright는 쓰지 않는다.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { isScenarioPath, judge, OBSERVATION_NAME, type Observation } from '../verify/judge.ts';
import { DEFAULT_RUNNER, unsupportedPlatform, verifyWeb } from '../verify/web.ts';
import { fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

// ---------- judge ----------

const ROOT = path.resolve('/repo');
const OBS: Observation = {
  version: 1,
  consoleErrors: [],
  failedRequests: [],
  allowed: { consoleErrors: 0, failedRequests: 0 },
};
const attach = (o: unknown) => ({
  name: OBSERVATION_NAME,
  contentType: 'application/json',
  body: Buffer.from(JSON.stringify(o)).toString('base64'),
});
const spec = (file: string, results: unknown[]) => ({
  title: 'works',
  file,
  line: 3,
  tests: [{ projectName: 'chromium', results }],
});
const passed = (o: unknown = OBS) => ({ status: 'passed', attachments: [attach(o)] });
/** 보고서. files는 시나리오 폴더(e2e) 기준 경로 */
const report = (files = ['a.spec.ts'], over: Record<string, unknown> = {}) => ({
  config: { rootDir: path.join(ROOT, 'e2e') },
  suites: files.map((f) => ({ title: f, file: f, specs: [spec(f, [passed()])], suites: [] })),
  errors: [],
  ...over,
});
const one = (result: unknown) =>
  report([], { suites: [{ title: 'a', specs: [spec('a.spec.ts', [result])] }] });
const all = (v: ReturnType<typeof judge>) =>
  [...v.problems, ...v.scenarios.flatMap((s) => s.problems)].join('\n');

test('judge: 모든 시나리오가 passed이고 관찰 기록이 비어 있으면 통과다', () => {
  const v = judge(report(), 0, { root: ROOT });
  assert.equal(v.ok, true, all(v));
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.scenarios, [
    {
      file: 'e2e/a.spec.ts',
      line: 3,
      title: 'works [chromium]',
      status: 'passed',
      ok: true,
      problems: [],
      observation: OBS,
    },
  ]);
});

test('judge: 의도한 실패로 뺀 건수(allowed)는 실패가 아니다', () => {
  const o = { ...OBS, allowed: { consoleErrors: 2, failedRequests: 1 } };
  const v = judge(one(passed(o)), 0, { root: ROOT });
  assert.equal(v.ok, true, all(v));
  assert.deepEqual(v.scenarios[0].observation?.allowed, { consoleErrors: 2, failedRequests: 1 });
});

test('judge: 중첩된 suite의 시나리오도 모으고, 다시 돌린 시나리오는 마지막 결과로 본다', () => {
  const nested = report([], {
    suites: [
      {
        title: 'a.spec.ts',
        specs: [],
        suites: [
          { title: 'group', specs: [spec('sub/b.spec.ts', [{ status: 'failed' }, passed()])] },
        ],
      },
    ],
  });
  const v = judge(nested, 0, { root: ROOT });
  assert.equal(v.ok, true, all(v));
  assert.deepEqual(
    v.scenarios.map((s) => s.file),
    ['e2e/sub/b.spec.ts'],
  );
  const flaky = judge(one({ status: 'failed', attachments: [attach(OBS)] }), 0, { root: ROOT });
  assert.equal(flaky.ok, false);
  const last = report([], {
    suites: [{ title: 'a', specs: [spec('a.spec.ts', [passed(), { status: 'failed' }])] }],
  });
  assert.equal(judge(last, 0, { root: ROOT }).ok, false);
});

test('judge: 보고서를 읽지 못하면 실패다(객체 아님, suites 없음, errors 없음)', () => {
  for (const bad of [null, undefined, 'x', 1, [], [report()]]) {
    const v = judge(bad, 0, { root: ROOT });
    assert.equal(v.ok, false);
    assert.match(all(v), /보고서가 객체가 아니다/);
  }
  const noSuites = judge({ config: { rootDir: ROOT }, errors: [] }, 0, { root: ROOT });
  assert.equal(noSuites.ok, false);
  assert.match(all(noSuites), /suites 배열이 없다/);
  const noErrors = judge(report(['a.spec.ts'], { errors: undefined }), 0, { root: ROOT });
  assert.equal(noErrors.ok, false);
  assert.match(all(noErrors), /errors 배열이 없다/);
});

test('judge: suite의 specs·suites가 배열이 아니면 실패다(보고서의 시나리오를 다 볼 수 없다)', () => {
  const ok = { title: 'a.spec.ts', specs: [spec('a.spec.ts', [passed()])] };
  for (const bad of [
    { ...ok, suites: { title: 'nested', specs: [spec('b.spec.ts', [{ status: 'failed' }])] } },
    { ...ok, suites: 'x' },
    { ...ok, suites: null },
    { title: 'only-bad', specs: { 0: spec('b.spec.ts', [passed()]) }, suites: [ok] },
    { title: 'only-bad', specs: 1, suites: [ok] },
  ]) {
    const v = judge(report([], { suites: [bad] }), 0, { root: ROOT });
    assert.equal(v.ok, false, JSON.stringify(bad).slice(0, 80));
    assert.match(all(v), /suite의 (specs|suites)가 배열이 아니다/);
  }
  // 두 필드가 없는 suite는 형식 오류가 아니다
  const v = judge(report([], { suites: [ok, { title: 'empty' }] }), 0, { root: ROOT });
  assert.equal(v.ok, true, all(v));
});

test('judge: 최상위 errors가 있으면 실패다', () => {
  const v = judge(report(['a.spec.ts'], { errors: [{ message: 'config broke' }] }), 0, {
    root: ROOT,
  });
  assert.equal(v.ok, false);
  assert.match(all(v), /최상위 errors 1건: config broke/);
});

test('judge: 시나리오가 0개면 실패다', () => {
  const v = judge(report([]), 0, { root: ROOT });
  assert.equal(v.ok, false);
  assert.match(all(v), /시나리오가 0개다/);
  const noTests = report([], {
    suites: [{ title: 'a', specs: [{ title: 't', file: 'a.spec.ts' }] }],
  });
  assert.equal(judge(noTests, 0, { root: ROOT }).ok, false);
});

test('judge: config.rootDir을 모르거나 시나리오 파일이 리포 루트 밖이면 실패다', () => {
  for (const rootDir of [undefined, 1, 'e2e', null]) {
    const v = judge(report(['a.spec.ts'], { config: { rootDir } }), 0, { root: ROOT });
    assert.equal(v.ok, false);
    assert.match(all(v), /config\.rootDir/);
  }
  const outside = report(['a.spec.ts'], { config: { rootDir: path.resolve('/elsewhere/e2e') } });
  const v = judge(outside, 0, { root: ROOT });
  assert.equal(v.ok, false);
  assert.match(all(v), /리포 루트 밖/);
  const up = judge(report(['../../x/a.spec.ts']), 0, { root: ROOT });
  assert.equal(up.ok, false);
  assert.match(all(up), /리포 루트 밖/);
  const noFile = report([], {
    suites: [{ title: 'a', specs: [{ ...spec('a', [passed()]), file: 1 }] }],
  });
  assert.equal(judge(noFile, 0, { root: ROOT }).ok, false);
});

test('judge: 지정한 시나리오 파일 집합과 결과의 파일 집합이 다르면 실패다', () => {
  const same = judge(report(['a.spec.ts']), 0, { root: ROOT, scenarios: ['e2e/a.spec.ts'] });
  assert.equal(same.ok, true, all(same));
  const extra = judge(report(['a.spec.ts', 'sub-e2e/a.spec.ts']), 0, {
    root: ROOT,
    scenarios: ['e2e/a.spec.ts'],
  });
  assert.equal(extra.ok, false);
  assert.match(
    all(extra),
    /지정하지 않은 파일의 시나리오가 결과에 있다: e2e\/sub-e2e\/a\.spec\.ts/,
  );
  const missing = judge(report(['a.spec.ts']), 0, {
    root: ROOT,
    scenarios: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
  });
  assert.equal(missing.ok, false);
  assert.match(all(missing), /지정한 파일의 시나리오가 결과에 없다: e2e\/b\.spec\.ts/);
  // 대소문자만 다른 이름은 같은 파일로 보지 않는다
  const cased = judge(report(['A.spec.ts']), 0, { root: ROOT, scenarios: ['e2e/a.spec.ts'] });
  assert.equal(cased.ok, false);
});

test('judge: 마지막 결과가 passed가 아니면 실패다(skipped 포함)', () => {
  for (const status of ['failed', 'timedOut', 'skipped', 'interrupted', '', 1]) {
    const v = judge(one({ status, attachments: [attach(OBS)] }), 0, { root: ROOT });
    assert.equal(v.ok, false, String(status));
    assert.match(all(v), /상태가 passed가 아니다/);
  }
  const none = report([], { suites: [{ title: 'a', specs: [spec('a.spec.ts', [])] }] });
  const v = judge(none, 0, { root: ROOT });
  assert.equal(v.ok, false);
  assert.match(all(v), /실행 결과가 없다/);
});

test('judge: 관찰 기록이 없거나 읽지 못하거나 형식이 다르면 실패다', () => {
  const cases: [unknown, RegExp][] = [
    [{ status: 'passed' }, /관찰 기록 첨부\(harness-verify\)가 없다/],
    [{ status: 'passed', attachments: [] }, /가 없다/],
    [{ status: 'passed', attachments: [{ name: 'other', body: 'e30=' }] }, /가 없다/],
    [{ status: 'passed', attachments: [attach(OBS), attach(OBS)] }, /가 2개다/],
    [{ status: 'passed', attachments: [{ name: OBSERVATION_NAME, path: '/x' }] }, /본문/],
    [{ status: 'passed', attachments: [{ name: OBSERVATION_NAME, body: 'bm90IGpzb24=' }] }, /JSON/],
    [passed({ ...OBS, version: 2 }), /형식/],
    [passed({ ...OBS, consoleErrors: undefined }), /형식/],
    [passed({ ...OBS, consoleErrors: ['x'] }), /형식/],
    [passed({ ...OBS, failedRequests: [{ url: 'u', reason: 'r' }] }), /형식/],
    [passed({ ...OBS, allowed: { consoleErrors: -1, failedRequests: 0 } }), /형식/],
    [passed({ ...OBS, allowed: null }), /형식/],
    [passed([OBS]), /형식/],
  ];
  for (const [result, re] of cases) {
    const v = judge(one(result), 0, { root: ROOT });
    assert.equal(v.ok, false, JSON.stringify(result));
    assert.match(all(v), re);
    assert.equal(v.scenarios[0].observation, null);
  }
});

test('judge: 관찰 기록에 콘솔 에러나 실패한 요청이 있으면 실패다', () => {
  const c = judge(one(passed({ ...OBS, consoleErrors: [{ text: 'boom' }] })), 0, { root: ROOT });
  assert.equal(c.ok, false);
  assert.match(all(c), /콘솔 에러 1건: boom/);
  const f = judge(
    one(
      passed({
        ...OBS,
        failedRequests: [
          { url: 'http://127.0.0.1:1/api', reason: '500', blocked: false },
          { url: 'https://ext.invalid/x', reason: 'blocked', blocked: true },
        ],
      }),
    ),
    0,
    { root: ROOT },
  );
  assert.equal(f.ok, false);
  assert.match(all(f), /실패한 요청 2건: http:\/\/127\.0\.0\.1:1\/api \(500\)/);
  assert.match(all(f), /\[앱 주소 밖, 차단\] https:\/\/ext\.invalid\/x/);
});

test('judge: 실행기의 종료 코드가 0이 아니면 모든 시나리오가 passed여도 실패다', () => {
  const v = judge(report(), 1, { root: ROOT });
  assert.equal(v.ok, false);
  assert.equal(v.scenarios[0].ok, true);
  assert.match(all(v), /종료 코드가 0이 아니다: 1/);
});

test('judge: 문자열로 바꿀 수 없는 값과 깊게 중첩된 값에서도 멈추지 않고 실패로 판정한다', () => {
  const weird = () => JSON.parse('{"toString":null}') as unknown;
  const deep = () => {
    let v: unknown = {};
    for (let i = 0; i < 200_000; i++) v = i % 2 ? { suites: [v] } : [v];
    return v;
  };
  const hostile = {
    config: { rootDir: path.join(ROOT, 'e2e') },
    errors: [weird(), deep()],
    suites: [
      {
        title: weird(),
        specs: [
          {
            title: weird(),
            file: 'a.spec.ts',
            line: deep(),
            tests: [
              {
                projectName: 'p',
                results: [
                  { status: weird(), attachments: [{ name: OBSERVATION_NAME, body: weird() }] },
                ],
              },
              { projectName: weird(), results: deep() },
            ],
          },
          weird(),
        ],
        suites: [deep(), weird(), 1],
      },
    ],
  };
  const v = judge(hostile, 0, { root: ROOT, scenarios: ['e2e/a.spec.ts'] });
  assert.equal(v.ok, false);
  assert.equal(v.scenarios.length, 2);
  assert.match(all(v), /상태가 passed가 아니다: 객체/);
  // suite가 깊게 이어져도 재귀하지 않는다
  let chain: unknown = { title: 'leaf', specs: [spec('a.spec.ts', [passed()])] };
  for (let i = 0; i < 200_000; i++) chain = { title: 's', suites: [chain] };
  const c = judge(report([], { suites: [chain] }), 0, { root: ROOT });
  assert.equal(c.ok, false);
  assert.match(all(c), /suite가 너무 많다/);
});

test('isScenarioPath: e2e 아래의 .spec.ts이고 구간이 영문자·숫자로 시작하는 상대 경로만 참이다', () => {
  for (const p of ['e2e/a.spec.ts', 'e2e/sub/a-b_c.spec.ts', 'e2e/v1.2/login.spec.ts'])
    assert.equal(isScenarioPath(p), true, p);
  for (const p of [
    'e2e/./a.spec.ts',
    'e2e/.hidden/a.spec.ts',
    'e2e/-x/a.spec.ts',
    'e2e/[id].spec.ts',
    'e2e/(shop)/a.spec.ts',
    'e2e/a b.spec.ts',
    'e2e/../a.spec.ts',
    'e2e//a.spec.ts',
    '/abs/e2e/a.spec.ts',
    'src/a.spec.ts',
    'e2e/a.spec.tsx',
    '--config',
    'e2e/.spec.ts',
    'e2e/$(x).spec.ts',
    'e2e\\a.spec.ts',
    'e2e/a.spec.ts\n',
    'e2e/한글.spec.ts',
    '',
  ])
    assert.equal(isScenarioPath(p), false, JSON.stringify(p));
  assert.equal(isScenarioPath(1 as unknown as string), false);
});

// ---------- verifyWeb ----------

/**
 * verifyWeb과 명령행의 테스트는 macOS·Linux에서만 돈다.
 * Windows에서는 verifyWeb이 아무것도 띄우지 않고 실패한다(아래 unsupportedPlatform 테스트)
 */
const posixTest = (name: string, fn: () => void | Promise<void>) =>
  test(name, async () => {
    if (process.platform !== 'win32') await fn();
  });

test('unsupportedPlatform: Windows에서는 지원하지 않는 이유를 돌려주고 macOS·Linux에서는 null이다', () => {
  assert.match(unsupportedPlatform('win32') ?? '', /Windows.*프로세스/);
  assert.equal(unsupportedPlatform('darwin'), null);
  assert.equal(unsupportedPlatform('linux'), null);
});

type DevMode = 'ok' | 'never' | 'exit' | 'silent' | 'plant-fifo' | null;
interface RunnerCfg {
  mode:
    | 'pass'
    | 'no-report'
    | 'broken'
    | 'hang'
    | 'hang-stubborn'
    | 'fifo'
    | 'symlink'
    | 'huge'
    | 'pass-leave-child';
  /** pass일 때 보고서에 담을 파일(시나리오 폴더 기준) */
  reportFiles?: string[];
  code?: number;
}
const NONE = { setup: null, fmt: null, lint: null, test: null, build: null, verify: null };
const FAKE_AT_DEFAULT = DEFAULT_RUNNER[1];

const devScript = (mode: DevMode) => `import http from 'node:http';
import net from 'node:net';
import { readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
writeFileSync('dev-pid', String(process.pid));
const mode = ${JSON.stringify(mode)};
if (mode === 'plant-fifo') {
  // 실행기 로그 자리에 FIFO를 심으려 한다(verify가 그것을 열면 멈춘다)
  let planted = 0;
  for (const d of readdirSync('.harness-verify')) {
    try {
      execFileSync('mkfifo', ['.harness-verify/' + d + '/local/runner.log'], { stdio: 'ignore' });
      planted++;
    } catch {}
  }
  writeFileSync('planted', String(planted));
}
if (mode === 'exit') process.exit(3);
if (mode === 'never') setInterval(() => {}, 1000);
else if (mode === 'silent')
  // 접속은 받지만 응답하지 않는다
  net.createServer(() => {}).listen(Number(process.env.PORT), process.env.HOST);
else
  http
    .createServer((req, res) => {
      res.statusCode = 404; // 준비 대기는 상태 코드를 보지 않는다
      res.end('fake dev');
    })
    .listen(Number(process.env.PORT), process.env.HOST);
`;

const runnerScript = (cfg: RunnerCfg) => `const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const CFG = ${JSON.stringify(cfg)};
const out = process.env.HARNESS_VERIFY_OUT;
fs.writeFileSync(
  'runner-seen.json',
  JSON.stringify({
    argv: process.argv.slice(2),
    baseUrl: process.env.HARNESS_VERIFY_BASE_URL ?? null,
    out: out ?? null,
    scenarios: process.env.HARNESS_VERIFY_SCENARIOS ?? null,
    cwd: process.cwd(),
  }),
);
if (CFG.mode === 'hang' || CFG.mode === 'hang-stubborn') {
  const stubborn = CFG.mode === 'hang-stubborn';
  if (stubborn) process.on('SIGTERM', () => {});
  const body = (stubborn ? "process.on('SIGTERM', () => {});" : '') + 'setInterval(() => {}, 1000)';
  const g = spawn(process.execPath, ['-e', body], { stdio: 'ignore' });
  fs.writeFileSync('runner-pids.json', JSON.stringify({ runner: process.pid, grandchild: g.pid }));
  setInterval(() => {}, 1000);
} else if (CFG.mode === 'broken') {
  fs.writeFileSync(path.join(out, 'report.json'), '{"suites": [');
} else if (CFG.mode === 'fifo') {
  // 쓰는 쪽이 없는 FIFO: 그냥 열면 멈춘다
  require('node:child_process').execFileSync('mkfifo', [path.join(out, 'report.json')]);
} else if (CFG.mode === 'huge') {
  fs.writeFileSync(path.join(out, 'report.json'), '{}');
  fs.truncateSync(path.join(out, 'report.json'), 64 * 1024 * 1024 + 1);
} else {
  if (CFG.mode === 'pass-leave-child') {
    // 같은 프로세스 그룹에 자식을 남기고 정상 종료한다
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    g.unref();
    fs.writeFileSync('runner-pids.json', JSON.stringify({ runner: process.pid, grandchild: g.pid }));
  }
  const obs = Buffer.from(
    JSON.stringify({
      version: 1,
      consoleErrors: [],
      failedRequests: [],
      allowed: { consoleErrors: 0, failedRequests: 0 },
    }),
  ).toString('base64');
  const suites = CFG.reportFiles.map((f) => ({
    title: f,
    file: f,
    specs: [
      {
        title: 'works',
        file: f,
        line: 3,
        tests: [
          {
            projectName: 'chromium',
            results: [
              {
                status: 'passed',
                attachments: [{ name: 'harness-verify', contentType: 'application/json', body: obs }],
              },
            ],
          },
        ],
      },
    ],
    suites: [],
  }));
  // Playwright처럼 config.rootDir는 실행기가 본 실제 경로의 시나리오 폴더다
  const body = JSON.stringify({ config: { rootDir: path.join(process.cwd(), 'e2e') }, suites, errors: [] });
  if (CFG.mode === 'symlink') {
    // 통과 보고서를 다른 곳에 쓰고 결과 파일 자리에는 심볼릭 링크를 둔다
    fs.writeFileSync('real-report.json', body);
    fs.symlinkSync(path.join(process.cwd(), 'real-report.json'), path.join(out, 'report.json'));
  } else fs.writeFileSync(path.join(out, 'report.json'), body);
  process.exitCode = CFG.code ?? 0;
}
`;

interface Fx {
  root: string;
  /** verifyWeb의 함수 인자로 넣는 가짜 실행기 */
  runner: string[];
}
/** 가짜 dev와 가짜 실행기가 든 리포. 가짜 실행기는 함수 인자용과 명령행용(기본 실행기 자리) 두 곳에 둔다 */
function fx(o: { dev?: DevMode; runner?: RunnerCfg; files?: string[] } = {}): Fx {
  const root = path.join(tmp('harness-verify-'), 'r');
  gitInit(root);
  const dev = o.dev === undefined ? 'ok' : o.dev;
  write(root, 'dev.mjs', devScript(dev));
  const script = runnerScript(o.runner ?? { mode: 'pass', reportFiles: ['a.spec.ts'] });
  write(root, 'fake-runner.cjs', script);
  write(root, FAKE_AT_DEFAULT, script);
  for (const f of o.files ?? ['e2e/a.spec.ts']) write(root, f, '// 시나리오 자리\n');
  write(
    root,
    'harness.config.json',
    JSON.stringify(
      fixtureConfig({
        commands: { ...NONE, dev: dev === null ? null : { run: 'node dev.mjs', timeoutSec: 60 } },
      }),
    ),
  );
  return { root, runner: [process.execPath, 'fake-runner.cjs', 'test', '--config', 'x.ts'] };
}

const readJson = <T>(root: string, rel: string) =>
  JSON.parse(readFileSync(path.join(root, rel), 'utf8')) as T;
interface Seen {
  argv: string[];
  baseUrl: string | null;
  out: string | null;
  scenarios: string | null;
  cwd: string;
}
const seen = (root: string) => readJson<Seen>(root, 'runner-seen.json');
const devPid = (root: string) => Number(readFileSync(path.join(root, 'dev-pid'), 'utf8'));
const started = (root: string) => ({
  dev: existsSync(path.join(root, 'dev-pid')),
  runner: existsSync(path.join(root, 'runner-seen.json')),
});
const NOT_STARTED = { dev: false, runner: false };

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** 조건이 참이 될 때까지 기다린다(고정 시간을 기다리지 않는다) */
async function waitFor(cond: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`기다리다 시간이 지났다: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const connects = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
const problems = (r: Awaited<ReturnType<typeof verifyWeb>>) => all(r.verdict);

posixTest(
  'verifyWeb: 통과하면 ok이고 실행기는 앱 주소와 출력 폴더를 환경 변수로 받으며, 끝난 뒤 dev가 남지 않는다',
  async () => {
    const f = fx();
    const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
    assert.equal(r.ok, true, problems(r));
    assert.match(r.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    const s = seen(f.root);
    assert.equal(s.baseUrl, r.baseUrl);
    assert.equal(s.out, r.outDir);
    assert.equal(s.cwd, f.root);
    assert.deepEqual(s.argv, f.runner.slice(2));
    assert.equal(s.scenarios, null);
    assert.equal(path.dirname(r.outDir), path.join(f.root, '.harness-verify'));
    assert.match(path.basename(r.outDir), /^\d{8}-\d{6}-\d+$/);
    assert.equal(existsSync(path.join(r.outDir, 'local', 'dev.log')), true);
    assert.equal(existsSync(path.join(r.outDir, 'local', 'runner.log')), true);
    assert.deepEqual(
      r.verdict.scenarios.map((x) => x.file),
      ['e2e/a.spec.ts'],
    );
    assert.equal(await connects(Number(new URL(r.baseUrl).port)), false);
    assert.equal(alive(devPid(f.root)), false);
  },
);

posixTest(
  'verifyWeb: 시나리오를 지정하면 실행기 인자는 그대로이고 환경 변수로 넘어간다',
  async () => {
    const f = fx();
    const r = await verifyWeb(f.root, loadConfig(f.root), {
      runner: f.runner,
      scenarios: ['e2e/a.spec.ts'],
    });
    assert.equal(r.ok, true, problems(r));
    const s = seen(f.root);
    assert.deepEqual(s.argv, f.runner.slice(2));
    assert.deepEqual(JSON.parse(s.scenarios ?? 'null'), ['e2e/a.spec.ts']);
  },
);

posixTest(
  'verifyWeb: 시나리오를 지정하지 않으면 바깥 환경의 HARNESS_VERIFY_SCENARIOS를 넘기지 않는다',
  async () => {
    const f = fx();
    const before = process.env.HARNESS_VERIFY_SCENARIOS;
    process.env.HARNESS_VERIFY_SCENARIOS = '["e2e/other.spec.ts"]';
    try {
      const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
      assert.equal(r.ok, true, problems(r));
      assert.equal(seen(f.root).scenarios, null);
    } finally {
      if (before === undefined) delete process.env.HARNESS_VERIFY_SCENARIOS;
      else process.env.HARNESS_VERIFY_SCENARIOS = before;
    }
  },
);

posixTest(
  'verifyWeb: 지정한 파일 밖의 시나리오가 결과에 있거나 지정한 파일의 시나리오가 없으면 실패다',
  async () => {
    const extra = fx({
      runner: { mode: 'pass', reportFiles: ['a.spec.ts', 'sub-e2e/a.spec.ts'] },
      files: ['e2e/a.spec.ts', 'e2e/sub-e2e/a.spec.ts'],
    });
    const r1 = await verifyWeb(extra.root, loadConfig(extra.root), {
      runner: extra.runner,
      scenarios: ['e2e/a.spec.ts'],
    });
    assert.equal(r1.ok, false);
    assert.match(problems(r1), /지정하지 않은 파일의 시나리오가 결과에 있다/);
    assert.equal(alive(devPid(extra.root)), false);

    const missing = fx({
      runner: { mode: 'pass', reportFiles: ['a.spec.ts'] },
      files: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
    });
    const r2 = await verifyWeb(missing.root, loadConfig(missing.root), {
      runner: missing.runner,
      scenarios: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
    });
    assert.equal(r2.ok, false);
    assert.match(problems(r2), /지정한 파일의 시나리오가 결과에 없다: e2e\/b\.spec\.ts/);
  },
);

posixTest('verifyWeb: 같은 시나리오를 두 번 지정하면 한 번 지정한 것과 같다', async () => {
  const f = fx();
  const r = await verifyWeb(f.root, loadConfig(f.root), {
    runner: f.runner,
    scenarios: ['e2e/a.spec.ts', 'e2e/a.spec.ts'],
  });
  assert.equal(r.ok, true, problems(r));
  assert.deepEqual(JSON.parse(seen(f.root).scenarios ?? 'null'), ['e2e/a.spec.ts']);
});

posixTest(
  'verifyWeb: 지정한 시나리오가 리포에 없거나 일반 파일이 아니거나 경로 규칙에 맞지 않으면 아무것도 띄우지 않는다',
  async () => {
    const f = fx({ files: ['e2e/a.spec.ts', 'e2e/dir.spec.ts/keep', 'e2e/real/a.spec.ts'] });
    const bad = ['e2e/none.spec.ts', 'e2e/dir.spec.ts', 'e2e/./a.spec.ts', '--config', 'src/a.ts'];
    symlinkSync(path.join(f.root, 'e2e/a.spec.ts'), path.join(f.root, 'e2e/link.spec.ts'));
    bad.push('e2e/link.spec.ts');
    symlinkSync(path.join(f.root, 'e2e/real'), path.join(f.root, 'e2e/linked'), 'junction');
    bad.push('e2e/linked/a.spec.ts');
    for (const p of bad) {
      const r = await verifyWeb(f.root, loadConfig(f.root), {
        runner: f.runner,
        scenarios: ['e2e/a.spec.ts', p],
      });
      assert.equal(r.ok, false, p);
      assert.match(problems(r), /시나리오/);
      assert.deepEqual(started(f.root), NOT_STARTED, p);
    }
  },
);

posixTest(
  'verifyWeb: 심볼릭 링크로 가리킨 리포에서도 시나리오 파일이 리포 기준 경로로 나온다',
  async () => {
    const f = fx();
    const link = path.join(path.dirname(f.root), 'link');
    symlinkSync(f.root, link, 'junction');
    const r = await verifyWeb(link, loadConfig(link), {
      runner: f.runner,
      scenarios: ['e2e/a.spec.ts'],
    });
    assert.equal(r.ok, true, problems(r));
    assert.deepEqual(
      r.verdict.scenarios.map((x) => x.file),
      ['e2e/a.spec.ts'],
    );
    assert.equal(seen(f.root).cwd, f.root);
    assert.equal(r.outDir.startsWith(f.root + path.sep), true);
  },
);

posixTest('verifyWeb: dev가 준비되지 않거나 곧바로 끝나면 실패하고 dev가 남지 않는다', async () => {
  const never = fx({ dev: 'never' });
  const r1 = await verifyWeb(never.root, loadConfig(never.root), {
    runner: never.runner,
    readyTimeoutSec: 1,
  });
  assert.equal(r1.ok, false);
  assert.match(problems(r1), /dev가 1초 안에 .*응답하지 않았다/);
  assert.equal(started(never.root).runner, false);
  assert.equal(alive(devPid(never.root)), false);

  const exits = fx({ dev: 'exit' });
  const t0 = Date.now();
  const r2 = await verifyWeb(exits.root, loadConfig(exits.root), { runner: exits.runner });
  assert.equal(r2.ok, false);
  assert.match(problems(r2), /dev가 준비되기 전에 끝났다\(종료 코드 3\)/);
  assert.ok(Date.now() - t0 < 30_000, '제한 시간(120초)까지 기다리지 않는다');
  assert.equal(started(exits.root).runner, false);
});

posixTest(
  'verifyWeb: 실행기가 결과 파일을 쓰지 않거나 깨진 JSON을 쓰면 실패하고 dev가 남지 않는다',
  async () => {
    const none = fx({ runner: { mode: 'no-report' } });
    const r1 = await verifyWeb(none.root, loadConfig(none.root), { runner: none.runner });
    assert.equal(r1.ok, false);
    assert.match(problems(r1), /결과 파일\(report\.json\)을 쓰지 않았다/);
    assert.equal(alive(devPid(none.root)), false);

    const broken = fx({ runner: { mode: 'broken' } });
    const r2 = await verifyWeb(broken.root, loadConfig(broken.root), { runner: broken.runner });
    assert.equal(r2.ok, false);
    assert.match(problems(r2), /JSON으로 읽지 못했다/);
    assert.equal(alive(devPid(broken.root)), false);

    const missing = fx();
    const r3 = await verifyWeb(missing.root, loadConfig(missing.root), {
      runner: [process.execPath, 'no-such-runner.cjs'],
    });
    assert.equal(r3.ok, false);
    assert.equal(alive(devPid(missing.root)), false);
  },
);

posixTest('verifyWeb: 실행기의 종료 코드가 0이 아니면 보고서가 통과여도 실패다', async () => {
  const f = fx({ runner: { mode: 'pass', reportFiles: ['a.spec.ts'], code: 1 } });
  const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
  assert.equal(r.ok, false);
  assert.match(problems(r), /종료 코드가 0이 아니다/);
});

interface Pids {
  runner: number;
  grandchild: number;
}
const pids = (root: string) => readJson<Pids>(root, 'runner-pids.json');
const noneAlive = (root: string) => {
  const p = pids(root);
  return { runner: alive(p.runner), grandchild: alive(p.grandchild), dev: alive(devPid(root)) };
};
const ALL_GONE = { runner: false, grandchild: false, dev: false };

posixTest(
  'verifyWeb: 실행기가 시간 제한을 넘기면 실패하고 실행기·손자·dev가 모두 끝난다',
  async () => {
    const f = fx({ runner: { mode: 'hang' } });
    const r = await verifyWeb(f.root, loadConfig(f.root), {
      runner: f.runner,
      runnerTimeoutSec: 1,
    });
    assert.equal(r.ok, false);
    assert.match(problems(r), /실행기가 1초 안에 끝나지 않아 중단했다/);
    assert.deepEqual(noneAlive(f.root), ALL_GONE);
  },
);

posixTest('verifyWeb: SIGTERM을 무시하는 실행기 트리도 끝낸다(SIGKILL)', async () => {
  const f = fx({ runner: { mode: 'hang-stubborn' } });
  const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner, runnerTimeoutSec: 1 });
  assert.equal(r.ok, false);
  assert.deepEqual(noneAlive(f.root), ALL_GONE);
});

posixTest('verifyWeb: 중단 신호를 받으면 4초 안에 돌아가고 띄운 것이 모두 끝난다', async () => {
  const f = fx({ runner: { mode: 'hang' } });
  const ac = new AbortController();
  const run = verifyWeb(f.root, loadConfig(f.root), { runner: f.runner, signal: ac.signal });
  await waitFor(() => existsSync(path.join(f.root, 'runner-pids.json')), 30_000, '실행기 pid 파일');
  const t0 = Date.now();
  ac.abort();
  const r = await run;
  assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
  assert.equal(r.ok, false);
  assert.match(problems(r), /중단 신호/);
  assert.deepEqual(noneAlive(f.root), ALL_GONE);
});

posixTest(
  'verifyWeb: 준비를 기다리는 중에 중단 신호를 받아도 4초 안에 돌아가고 dev가 남지 않는다',
  async () => {
    const f = fx({ dev: 'silent' });
    const ac = new AbortController();
    const run = verifyWeb(f.root, loadConfig(f.root), { runner: f.runner, signal: ac.signal });
    await waitFor(() => existsSync(path.join(f.root, 'dev-pid')), 30_000, 'dev pid 파일');
    const t0 = Date.now();
    ac.abort();
    const r = await run;
    assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
    assert.equal(r.ok, false);
    assert.match(problems(r), /중단 신호/);
    assert.equal(started(f.root).runner, false);
    assert.equal(alive(devPid(f.root)), false);
  },
);

posixTest(
  'verifyWeb: 실행마다 새 출력 폴더를 쓴다(앞 실행의 결과 파일을 읽지 않는다)',
  async () => {
    const f = fx();
    const first = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
    assert.equal(first.ok, true, problems(first));
    // 같은 초, 같은 프로세스에서 다시 돌린다. 이번 실행기는 결과 파일을 쓰지 않는다
    write(f.root, 'fake-runner.cjs', runnerScript({ mode: 'no-report' }));
    const second = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
    assert.notEqual(second.outDir, first.outDir);
    assert.equal(second.ok, false);
    assert.match(problems(second), /결과 파일\(report\.json\)을 쓰지 않았다/);
  },
);

posixTest(
  'verifyWeb: 출력 폴더 자리(.harness-verify)가 심볼릭 링크면 아무것도 띄우지 않고 실패한다',
  async () => {
    const f = fx();
    const outside = tmp('harness-verify-outside-');
    symlinkSync(outside, path.join(f.root, '.harness-verify'), 'junction');
    const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
    assert.equal(r.ok, false);
    assert.match(problems(r), /\.harness-verify/);
    assert.deepEqual(started(f.root), NOT_STARTED);
    assert.deepEqual(readdirSync(outside), []);
  },
);

posixTest('verifyWeb: commands.dev가 없으면 실패하고 고치는 법을 낸다', async () => {
  const f = fx({ dev: null });
  const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
  assert.equal(r.ok, false);
  assert.match(problems(r), /commands\.dev가 없다.*고치는 법/);
  assert.deepEqual(started(f.root), NOT_STARTED);
});

posixTest(
  'verifyWeb: 실행기가 자식을 남기고 정상 종료해도 그 자식까지 끝낸 뒤 돌아간다',
  async () => {
    const f = fx({ runner: { mode: 'pass-leave-child', reportFiles: ['a.spec.ts'] } });
    const r = await verifyWeb(f.root, loadConfig(f.root), { runner: f.runner });
    assert.equal(r.ok, true, problems(r));
    assert.deepEqual(noneAlive(f.root), ALL_GONE);
  },
);

posixTest('verifyWeb: 결과 파일이 심볼릭 링크거나 너무 크면 읽지 않고 실패한다', async () => {
  const link = fx({ runner: { mode: 'symlink', reportFiles: ['a.spec.ts'] } });
  const r1 = await verifyWeb(link.root, loadConfig(link.root), { runner: link.runner });
  assert.equal(r1.ok, false);
  assert.match(problems(r1), /결과 파일\(report\.json\)을 열지 못했다/);
  const huge = fx({ runner: { mode: 'huge' } });
  const r2 = await verifyWeb(huge.root, loadConfig(huge.root), { runner: huge.runner });
  assert.equal(r2.ok, false);
  assert.match(problems(r2), /결과 파일\(report\.json\)이 너무 크다/);
});

// ---------- 명령행 ----------

const WEB = path.join(HARNESS_ROOT, 'scripts/verify/web.ts');
const cli = (root: string, args: string[]) =>
  runSync(process.execPath, [WEB, ...args], { cwd: root });

posixTest('명령행: 통과하면 종료 코드 0이고 시나리오별 한 줄과 출력 폴더를 낸다', () => {
  const f = fx();
  const r = cli(f.root, []);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ e2e\/a\.spec\.ts:3 works \[chromium\]/);
  assert.match(r.stdout, /verify: 통과 \(시나리오 1개\) · 출력 .*\.harness-verify/);
  // 명령행은 기본 실행기를 인자를 더 붙이지 않고 쓴다
  assert.deepEqual(seen(f.root).argv, DEFAULT_RUNNER.slice(2));
  assert.equal(alive(devPid(f.root)), false);
});

posixTest('명령행: 시나리오 경로를 주면 그 파일만 지정해 실행한다', () => {
  const f = fx();
  const r = cli(f.root, ['e2e/a.spec.ts']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const s = seen(f.root);
  assert.deepEqual(s.argv, DEFAULT_RUNNER.slice(2));
  assert.deepEqual(JSON.parse(s.scenarios ?? 'null'), ['e2e/a.spec.ts']);
});

posixTest('명령행: 실패하면 종료 코드 1이고 문제를 낸다', () => {
  const f = fx({ runner: { mode: 'no-report' } });
  const r = cli(f.root, []);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✗ .*report\.json/);
  assert.match(r.stdout, /verify: 실패/);
});

posixTest('명령행: 시나리오 경로가 아닌 인자가 있으면 아무것도 띄우지 않고 종료 코드 1이다', () => {
  const f = fx();
  for (const args of [
    ['--config', 'x'],
    ['../e2e/a.spec.ts'],
    ['e2e/../a.spec.ts'],
    ['e2e/./a.spec.ts'],
    ['src/a.ts'],
    ['e2e/$(x).spec.ts'],
    ['e2e/a b.spec.ts'],
    ['e2e/a.spec.ts', '--headed'],
    ['-g', 'x'],
  ]) {
    const r = cli(f.root, args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.stderr, /받을 수 없는 인자/);
    assert.deepEqual(started(f.root), NOT_STARTED, args.join(' '));
  }
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  posixTest(`명령행: ${sig}을 받으면 4초 안에 끝나고 실행기·손자·dev가 남지 않는다`, async () => {
    const f = fx({ runner: { mode: 'hang' } });
    const child = spawn(process.execPath, [WEB], { cwd: f.root, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => resolve(code)),
    );
    try {
      await waitFor(
        () => existsSync(path.join(f.root, 'runner-pids.json')),
        30_000,
        '실행기 pid 파일',
      );
      const t0 = Date.now();
      child.kill(sig);
      const code = await exited;
      assert.ok(Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
      assert.equal(code, 1);
      assert.deepEqual(noneAlive(f.root), ALL_GONE);
    } finally {
      child.kill('SIGKILL');
    }
  });
}

// 아래 둘은 고치기 전에는 verify가 멈추던 경우다. 멈추면 테스트 프로세스까지 멈추므로 명령행(자식 프로세스)으로 본다
function cliWithin(root: string, ms: number) {
  // 멈춘 프로세스는 SIGTERM을 처리하지 못한다. SIGKILL로 끊고, 그때 남는 dev는 여기서 끝낸다
  const r = spawnSync(process.execPath, [WEB], {
    cwd: root,
    encoding: 'utf8',
    timeout: ms,
    killSignal: 'SIGKILL',
  });
  const timedOut = r.status === null;
  if (timedOut && existsSync(path.join(root, 'dev-pid')) && alive(devPid(root)))
    process.kill(devPid(root), 'SIGKILL');
  return { code: r.status ?? -1, timedOut, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

posixTest(
  '명령행: 실행기가 결과 파일 자리에 FIFO를 남겨도 멈추지 않고 실패로 끝나며 dev가 남지 않는다',
  () => {
    const f = fx({ runner: { mode: 'fifo' } });
    const r = cliWithin(f.root, 30_000);
    assert.equal(r.timedOut, false, 'verify가 멈췄다');
    assert.match(r.stdout, /결과 파일\(report\.json\)이 일반 파일이 아니다/);
    assert.equal(r.code, 1);
    assert.equal(alive(devPid(f.root)), false);
  },
);

posixTest(
  '명령행: dev가 실행기 로그 자리에 FIFO를 심으려 해도 멈추지 않는다(로그 파일은 dev보다 먼저 만든다)',
  () => {
    const f = fx({ dev: 'plant-fifo' });
    const r = cliWithin(f.root, 30_000);
    assert.equal(r.timedOut, false, 'verify가 멈췄다');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(readFileSync(path.join(f.root, 'planted'), 'utf8'), '0');
    assert.equal(alive(devPid(f.root)), false);
  },
);
