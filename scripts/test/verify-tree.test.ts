// verify의 정리: 실행기가 자기 프로세스 그룹 밖에 띄운 프로세스(브라우저)까지 끝내고 끝난 것을 확인한 뒤 돌아간다
// (구현 판정 F2). 하네스가 받은 SIGHUP에서도 정리한다(F1).
// Playwright는 브라우저를 새 프로세스 그룹으로 띄운다. 실행기 그룹에 보낸 신호는 브라우저에 닿지 않는다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { FORWARDED } from '../lib/exec.ts';
import { Descendants, listProcesses, parseProcessList, type ProcessRow } from '../verify/tree.ts';
import { DEFAULT_RUNNER, STOP_SIGNALS, verifyWeb } from '../verify/web.ts';
import { fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const T = { timeout: 120_000, skip: process.platform === 'win32' };
const WEB = path.join(HARNESS_ROOT, 'scripts/verify/web.ts');
const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');

// ---------- 프로세스 목록과 자손 추적 ----------

test('parseProcessList: pid·ppid·pgid·상태 네 칸을 읽고, 읽지 못한 줄이 있으면 목록 전체를 버린다', () => {
  assert.deepEqual(
    parseProcessList('    1     0     1 Ss\n  812     1   812 S+\n 9001   812  9001 Z\n'),
    [
      { pid: 1, ppid: 0, pgid: 1, zombie: false },
      { pid: 812, ppid: 1, pgid: 812, zombie: false },
      { pid: 9001, ppid: 812, pgid: 9001, zombie: true },
    ],
  );
  assert.equal(parseProcessList(''), null);
  assert.equal(parseProcessList('1 0 1 S\nPID PPID PGID STAT\n'), null);
  assert.equal(parseProcessList('1 0 S\n'), null);
  assert.equal(parseProcessList('1 0 1 S extra\n'), null);
});

test('listProcesses: 실제 목록에 이 프로세스가 있다', T, async () => {
  const rows = await listProcesses();
  assert.ok(rows);
  const me = rows.find((r) => r.pid === process.pid);
  assert.ok(me);
  assert.equal(me.ppid, process.ppid);
  assert.equal(me.zombie, false);
});

const row = (pid: number, ppid: number, pgid: number, zombie = false): ProcessRow => ({
  pid,
  ppid,
  pgid,
  zombie,
});
/** 차례로 돌려줄 목록을 받아 Descendants를 만든다 */
function tracker(...lists: (ProcessRow[] | null)[]) {
  let i = 0;
  return new Descendants(() => Promise.resolve(lists[Math.min(i++, lists.length - 1)]));
}

test('Descendants: 뿌리의 자손을 그룹과 무관하게 따라가고 뿌리 자신은 넣지 않는다', async () => {
  const d = tracker([
    row(1, 0, 1),
    row(100, 1, 100), // 실행기
    row(101, 100, 100), // 작업자(같은 그룹)
    row(200, 101, 200), // 브라우저(새 그룹)
    row(201, 200, 200), // 브라우저의 자식
    row(300, 1, 300), // 무관
    row(301, 300, 300),
  ]);
  assert.equal(await d.refresh([100]), true);
  assert.deepEqual(d.pids(), [101, 200, 201]);
});

test('Descendants: 뿌리가 여럿이면 모두의 자손을 따라간다', async () => {
  const d = tracker([
    row(100, 1, 100), // dev
    row(110, 100, 110),
    row(200, 1, 200), // 실행기
    row(210, 200, 210),
    row(300, 1, 300),
  ]);
  await d.refresh([100, 200]);
  assert.deepEqual(d.pids(), [110, 210]);
  // 뿌리끼리 부모·자식이어도 뿌리는 넣지 않는다
  const nested = tracker([row(100, 1, 100), row(200, 100, 200), row(210, 200, 210)]);
  await nested.refresh([100, 200]);
  assert.deepEqual(nested.pids(), [210]);
});

test('Descendants: 부모가 끝나 다른 부모로 넘어간 자손도 계속 따라가고, 새 자식을 더한다', async () => {
  const d = tracker(
    [row(100, 1, 100), row(101, 100, 100), row(200, 101, 200)],
    // 실행기와 작업자가 끝났다. 브라우저는 1의 자식이 됐고 새 자식을 띄웠다
    [row(200, 1, 200), row(202, 200, 200), row(300, 1, 300)],
  );
  await d.refresh([100]);
  assert.equal(await d.refresh(), true);
  assert.deepEqual(d.pids(), [200, 202]);
});

test('Descendants: 목록에서 사라진 pid는 뺀다. 같은 번호가 다른 그룹으로 다시 나타나도 다시 넣지 않는다', async () => {
  const d = tracker(
    [row(100, 1, 100), row(200, 100, 200)],
    [row(300, 1, 300)],
    // 200번이 무관한 프로세스로 다시 쓰였다
    [row(200, 300, 300), row(300, 1, 300)],
  );
  await d.refresh([100]);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
});

test('Descendants: 한 번의 목록 사이에 같은 번호가 다른 그룹으로 바뀌어 있으면 뺀다', async () => {
  const d = tracker([row(100, 1, 100), row(200, 100, 200)], [row(200, 300, 300), row(300, 1, 300)]);
  await d.refresh([100]);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
});

test('Descendants: 끝났지만 거둬지지 않은 프로세스(좀비)는 남은 것으로 세지 않는다', async () => {
  const d = tracker(
    [row(100, 1, 100), row(200, 100, 200)],
    [row(100, 1, 100), row(200, 100, 200, true)],
  );
  await d.refresh([100]);
  assert.deepEqual(d.pids(), [200]);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
});

test('Descendants: 목록을 읽지 못하면 false를 돌려주고 알던 것을 그대로 둔다', async () => {
  const d = tracker([row(100, 1, 100), row(200, 100, 200)], null);
  assert.equal(await d.refresh([100]), true);
  assert.equal(await d.refresh(), false);
  assert.deepEqual(d.pids(), [200]);
});

test('Descendants: 이 프로세스 자신은 넣지 않는다', async () => {
  const d = tracker([row(100, 1, 100), row(process.pid, 100, 100), row(7, process.pid, 7)]);
  await d.refresh([100]);
  assert.deepEqual(d.pids(), []);
});

// ---------- verifyWeb ----------

test('verify가 처리하는 신호는 표준 명령 실행기가 넘기는 신호와 같다', () => {
  assert.deepEqual([...STOP_SIGNALS], ['SIGTERM', 'SIGINT', 'SIGHUP']);
  assert.equal(STOP_SIGNALS, FORWARDED);
});

interface RunnerCfg {
  /** 새 프로세스 그룹에 띄워 두는 프로세스(브라우저 구실). stubborn은 SIGTERM을 무시한다 */
  browser: 'plain' | 'stubborn';
  /** 실행기가 SIGTERM을 무시한다(정리가 SIGKILL까지 간다) */
  ignoreTerm?: boolean;
  /** 끝나지 않는다 */
  hang?: boolean;
  /** dev가 새 프로세스 그룹에 프로세스를 하나 띄워 둔다(helper.pid) */
  devHelper?: boolean;
}

const DEV = (helper: boolean) => `import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (${String(helper)}) {
  const h = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { detached: true, stdio: 'ignore' });
  h.unref();
  writeFileSync('helper.pid', String(h.pid));
}
http.createServer((req, res) => res.end('fake dev')).listen(Number(process.env.PORT), process.env.HOST, () =>
  writeFileSync('dev.pid', String(process.pid)),
);
`;

/** 브라우저 구실: 스스로 끝나지 않는다(부모가 끝나도 남는다) */
const browserScript = (stubborn: boolean) =>
  `${stubborn ? "process.on('SIGTERM', () => {});" : ''} setInterval(() => {}, 1000);`;

const runnerScript = (cfg: RunnerCfg) => `const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const CFG = ${JSON.stringify(cfg)};
if (CFG.ignoreTerm) process.on('SIGTERM', () => {});
const browser = spawn(process.execPath, ['-e', ${JSON.stringify(browserScript(cfg.browser === 'stubborn'))}], {
  detached: true,
  stdio: 'ignore',
});
browser.unref();
fs.writeFileSync('browser.pid', String(browser.pid));
fs.writeFileSync('runner.pid', String(process.pid));
const observation = { version: 1, consoleErrors: [], failedRequests: [], allowed: { consoleErrors: 0, failedRequests: 0 } };
const report = {
  config: { rootDir: path.join(process.cwd(), 'e2e') },
  suites: [{ title: 'root', suites: [], specs: [{ title: 'works', file: 'a.spec.ts', line: 3, tests: [{
    projectName: 'chromium',
    results: [{ status: 'passed', attachments: [{ name: 'harness-verify', contentType: 'application/json',
      body: Buffer.from(JSON.stringify(observation)).toString('base64') }] }],
  }] }] }],
  errors: [],
};
if (CFG.hang) setInterval(() => {}, 1000);
else
  // verify가 이 실행기의 자손을 한 번은 볼 수 있을 만큼 떠 있다가 통과 보고서를 쓰고 끝난다(브라우저는 남긴다)
  setTimeout(() => {
    fs.writeFileSync(path.join(process.env.HARNESS_VERIFY_OUT, 'report.json'), JSON.stringify(report));
  }, 1500);
`;

const NONE = { setup: null, fmt: null, lint: null, test: null, build: null, verify: null };
function fx(cfg: RunnerCfg, verifyRun: string | null = null) {
  const root = path.join(tmp('harness-verify-tree-'), 'r');
  gitInit(root);
  write(root, 'dev.mjs', DEV(cfg.devHelper === true));
  const script = runnerScript(cfg);
  write(root, 'fake-runner.cjs', script);
  write(root, DEFAULT_RUNNER[1], script);
  write(root, 'e2e/a.spec.ts', '// 시나리오 자리\n');
  write(
    root,
    'harness.config.json',
    JSON.stringify(
      fixtureConfig({
        commands: {
          ...NONE,
          dev: { run: 'node dev.mjs', timeoutSec: 60 },
          verify: verifyRun ? { run: verifyRun, timeoutSec: 120 } : null,
        },
      }),
    ),
  );
  return { root, runner: [process.execPath, 'fake-runner.cjs'] };
}
type Fx = ReturnType<typeof fx>;
const run = (f: Fx, o: Parameters<typeof verifyWeb>[2] = {}) =>
  verifyWeb(f.root, loadConfig(f.root), { runner: f.runner, ...o });
const pidIn = (root: string, name: string) => Number(readFileSync(path.join(root, name), 'utf8'));
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** 테스트가 실패해도 프로세스를 남기지 않는다 */
function reap(root: string, ...more: (number | undefined)[]): void {
  const pids = [...more];
  for (const name of ['browser.pid', 'runner.pid', 'dev.pid', 'helper.pid'])
    if (existsSync(path.join(root, name))) pids.push(pidIn(root, name));
  for (const pid of pids) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 이미 끝났다
    }
  }
}
async function waitFor(cond: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`기다리다 시간이 지났다: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const problems = (r: Awaited<ReturnType<typeof verifyWeb>>) => r.verdict.problems.join('\n');

test(
  'verifyWeb: 실행기를 SIGKILL로 끝내야 하는 경우에도 실행기가 다른 그룹에 띄운 프로세스가 끝난 뒤에 돌아간다',
  T,
  async () => {
    const f = fx({ browser: 'plain', ignoreTerm: true, hang: true });
    try {
      const r = await run(f, { runnerTimeoutSec: 2 });
      // 돌아온 바로 그 시점에 브라우저 구실의 프로세스가 없다
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(alive(pidIn(f.root, 'runner.pid')), false);
      assert.equal(alive(pidIn(f.root, 'dev.pid')), false);
      assert.equal(r.ok, false);
      assert.match(problems(r), /실행기가 2초 안에 끝나지 않아 중단했다/);
      assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
    } finally {
      reap(f.root);
    }
  },
);

test('verifyWeb: 다른 그룹의 프로세스가 SIGTERM을 무시하면 SIGKILL로 끝낸다', T, async () => {
  const f = fx({ browser: 'stubborn', hang: true });
  try {
    const r = await run(f, { runnerTimeoutSec: 2 });
    assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
    assert.equal(r.ok, false);
    assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
  } finally {
    reap(f.root);
  }
});

test('verifyWeb: 중단 신호로 끝낼 때도 다른 그룹의 프로세스가 남지 않는다', T, async () => {
  const f = fx({ browser: 'plain', ignoreTerm: true, hang: true });
  const ac = new AbortController();
  try {
    const pending = run(f, { signal: ac.signal });
    await waitFor(() => existsSync(path.join(f.root, 'browser.pid')), 30_000, '브라우저 pid 파일');
    // verify가 실행기의 자손을 한 번은 본 뒤에 끊는다
    await new Promise((r) => setTimeout(r, 1000));
    ac.abort();
    const r = await pending;
    assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
    assert.equal(alive(pidIn(f.root, 'runner.pid')), false);
    assert.equal(r.ok, false);
    assert.match(problems(r), /중단 신호를 받았다/);
  } finally {
    reap(f.root);
  }
});

test(
  'verifyWeb: 실행기가 스스로 끝나며 남긴 다른 그룹의 프로세스도 끝낸다(판정은 그대로 통과다)',
  T,
  async () => {
    const f = fx({ browser: 'plain' });
    try {
      const r = await run(f);
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, true, problems(r));
    } finally {
      reap(f.root);
    }
  },
);

test('verifyWeb: dev가 다른 그룹에 띄운 프로세스도 끝낸다', T, async () => {
  const f = fx({ browser: 'plain', devHelper: true });
  try {
    const r = await run(f);
    assert.equal(alive(pidIn(f.root, 'helper.pid')), false, 'dev가 띄운 프로세스가 남았다');
    assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
    assert.equal(r.ok, true, problems(r));
  } finally {
    reap(f.root);
  }
});

test(
  'verifyWeb: 프로세스 목록을 읽지 못하면 통과로 두지 않는다(남은 것이 없는지 확인하지 못했다)',
  T,
  async () => {
    const f = fx({ browser: 'plain' });
    try {
      const r = await run(f, { listProcesses: () => Promise.resolve(null) });
      assert.equal(r.ok, false);
      assert.match(problems(r), /띄운 프로세스를 끝내지 못했다.*프로세스 목록/);
      // 시나리오 자신은 통과였다
      assert.equal(r.verdict.scenarios.length, 1);
      assert.equal(r.verdict.scenarios[0].ok, true);
      const summary = JSON.parse(
        readFileSync(path.join(r.outDir, 'evidence', 'summary.json'), 'utf8'),
      ) as { ok: boolean; problems: { category: string; count: number }[] };
      assert.equal(summary.ok, false);
      assert.deepEqual(summary.problems, [{ category: '정리 실패', count: 1 }]);
    } finally {
      reap(f.root);
    }
  },
);

// ---------- 신호 ----------

for (const sig of ['SIGHUP', 'SIGTERM', 'SIGINT'] as const) {
  test(
    `명령행: ${sig}을 받으면 dev·실행기·다른 그룹의 프로세스를 끝내고 종료 코드 1로 끝난다`,
    T,
    async () => {
      const f = fx({ browser: 'plain', hang: true });
      const child = spawn(process.execPath, [WEB], { cwd: f.root, stdio: 'ignore' });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
        child.once('exit', (code, signal) => r({ code, signal })),
      );
      try {
        await waitFor(() => existsSync(path.join(f.root, 'browser.pid')), 30_000, '브라우저 pid');
        await new Promise((r) => setTimeout(r, 1000));
        child.kill(sig);
        assert.deepEqual(await exited, { code: 1, signal: null });
        for (const name of ['dev.pid', 'runner.pid', 'browser.pid'])
          assert.equal(alive(pidIn(f.root, name)), false, `${name}의 프로세스가 남았다`);
      } finally {
        reap(f.root, child.pid);
      }
    },
  );
}

// 구현 판정 F1: 하네스는 받은 SIGHUP을 명령의 프로세스 그룹에 넘긴다. verify가 SIGHUP을 처리하지 않으면
// verify만 끝나고 dev와 실행기(각자의 그룹)가 남는다
test(
  'harness verify: 하네스가 SIGHUP을 받으면 verify가 띄운 것이 모두 끝난 뒤 같은 신호로 끝난다',
  T,
  async () => {
    const f = fx({ browser: 'plain', hang: true }, `node ${JSON.stringify(WEB)}`);
    const harness = spawn(process.execPath, [HARNESS, 'verify'], { cwd: f.root, stdio: 'ignore' });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) =>
      harness.once('exit', (code, signal) => r({ code, signal })),
    );
    try {
      await waitFor(() => existsSync(path.join(f.root, 'browser.pid')), 30_000, '브라우저 pid');
      await new Promise((r) => setTimeout(r, 1000));
      harness.kill('SIGHUP');
      const end = await exited;
      for (const name of ['dev.pid', 'runner.pid', 'browser.pid'])
        assert.equal(alive(pidIn(f.root, name)), false, `${name}의 프로세스가 남았다`);
      assert.deepEqual(end, { code: null, signal: 'SIGHUP' });
      // verify는 신호로 죽지 않고 정리한 뒤 실패로 끝났다(공개 요약이 남는다)
      const base = path.join(f.root, '.harness-verify');
      const summary = JSON.parse(
        readFileSync(path.join(base, readdirSync(base)[0], 'evidence', 'summary.json'), 'utf8'),
      ) as { ok: boolean; problems: { category: string; count: number }[] };
      assert.equal(summary.ok, false);
      assert.deepEqual(summary.problems, [{ category: '중단 신호', count: 1 }]);
    } finally {
      reap(f.root, harness.pid);
    }
  },
);
