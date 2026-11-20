// 표준 명령을 돌리는 중에 하네스 프로세스가 받은 신호(SIGTERM, SIGINT)는 명령의 프로세스 트리로 넘어간다
// (계획 20261119-pilot-prep 수용 기준 4. 실물 확인에서 찾았다: `node scripts/harness.ts verify`에 SIGTERM을 보내면
// 하네스만 끝나고 verify·dev·실행기·브라우저가 남았다. 명령은 새 프로세스 그룹이라 부모에게 온 신호를 받지 못한다).
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const T = { timeout: 60_000, skip: process.platform === 'win32' };
const NONE = { setup: null, fmt: null, lint: null, test: null, build: null, dev: null };

/**
 * 표준 명령 구실을 하는 프로그램. 같은 그룹에 자식을 하나 두고(dev 서버나 브라우저 구실) pid 둘을 적은 뒤 기다린다.
 * 신호를 받으면 받은 신호 이름을 적고 끝난다. `stubborn`이면 신호를 적기만 하고 끝나지 않는다(자식도 무시한다)
 */
function command(stubborn: boolean): string {
  const child = stubborn
    ? "process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); setInterval(() => {}, 1000);"
    : 'setInterval(() => {}, 1000);';
  return `import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    appendFileSync('got-signal', sig + '\\n');
    ${stubborn ? '' : 'process.exit(0);'}
  });
writeFileSync('pids.json', JSON.stringify({ self: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`;
}

function repo(stubborn = false): string {
  const root = path.join(tmp('harness-std-signal-'), 'r');
  gitInit(root);
  write(root, 'long.mjs', command(stubborn));
  write(
    root,
    'harness.config.json',
    JSON.stringify(
      fixtureConfig({ commands: { ...NONE, verify: { run: 'node long.mjs', timeoutSec: 60 } } }),
    ),
  );
  write(root, '.gitignore', 'pids.json\ngot-signal\n');
  commitAll(root, 'init');
  return root;
}

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
const exited = (p: ChildProcess) =>
  new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    p.once('exit', (code, signal) => resolve({ code, signal })),
  );
const pids = (root: string) =>
  JSON.parse(readFileSync(path.join(root, 'pids.json'), 'utf8')) as { self: number; child: number };
/** pid 파일이 다 쓰였는가. 파일이 생긴 직후에는 비어 있을 수 있어 있는지만 보면 안 된다(간헐 실패로 찾았다) */
function hasPids(root: string): boolean {
  try {
    const p = pids(root);
    return p.self > 0 && p.child > 0;
  } catch {
    return false;
  }
}
const got = (root: string) =>
  existsSync(path.join(root, 'got-signal'))
    ? readFileSync(path.join(root, 'got-signal'), 'utf8').trim().split('\n')
    : [];

/** 남은 것을 치운다(테스트가 실패해도 프로세스를 남기지 않는다) */
function reap(...list: (number | undefined)[]): void {
  for (const pid of list) {
    if (!pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 이미 끝났다
    }
  }
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  test(
    `harness verify 실행 중 ${sig}을 받으면 명령의 프로세스 트리로 넘기고, 트리가 끝난 뒤 같은 신호로 끝난다`,
    T,
    async () => {
      const root = repo();
      const harness = spawn(
        process.execPath,
        [path.join(HARNESS_ROOT, 'scripts', 'harness.ts'), 'verify'],
        {
          cwd: root,
          stdio: 'ignore',
        },
      );
      const done = exited(harness);
      let p: { self: number; child: number } | undefined;
      try {
        await waitFor(() => hasPids(root), 30_000, '명령의 pid 파일');
        p = pids(root);
        harness.kill(sig);
        const end = await done;
        // 하네스가 끝난 시점에 명령과 그 자식이 이미 끝나 있다
        assert.equal(alive(p.self), false, '명령이 남았다');
        assert.equal(alive(p.child), false, '명령의 자식이 남았다');
        assert.deepEqual(got(root), [sig]);
        assert.deepEqual(end, { code: null, signal: sig });
      } finally {
        reap(harness.pid, p?.self, p?.child);
      }
    },
  );
}

/** exec.ts의 run을 forwardSignals로 부르는 프로그램(짧은 유예 시간을 주려고 하네스 대신 쓴다) */
function driver(root: string, graceMs: number): ChildProcess {
  const script = `
    const { run } = await import(${JSON.stringify(pathToFileURL(path.join(HARNESS_ROOT, 'scripts', 'lib', 'exec.ts')).href)});
    const r = await run(process.execPath, ['long.mjs'], { cwd: ${JSON.stringify(root)}, forwardSignals: true, forwardGraceMs: ${graceMs} });
    process.exitCode = r.code === 0 ? 0 : 1;
  `;
  return spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    stdio: 'ignore',
  });
}

test(
  '신호를 무시하는 명령은 유예 시간 뒤 SIGKILL로 끝내고 돌아간다(멈춰 있지 않는다)',
  T,
  async () => {
    const root = repo(true);
    const d = driver(root, 300);
    const done = exited(d);
    let p: { self: number; child: number } | undefined;
    try {
      await waitFor(() => hasPids(root), 30_000, '명령의 pid 파일');
      p = pids(root);
      d.kill('SIGTERM');
      const end = await done;
      assert.equal(alive(p.self), false, '명령이 남았다');
      assert.equal(alive(p.child), false, '명령의 자식이 남았다');
      assert.deepEqual(got(root), ['SIGTERM']);
      assert.deepEqual(end, { code: null, signal: 'SIGTERM' });
    } finally {
      reap(d.pid, p?.self, p?.child);
    }
  },
);

// 명령(그룹의 첫 프로세스)이 끝났다고 그 그룹이 빈 것은 아니다. 명령의 자식이 신호를 받고 끝나는 데 시간이 걸리면
// 그동안 기다린다(간헐 실패로 찾았다: 부하가 있을 때 자식이 아직 살아 있는 채로 하네스가 끝났다)
test('명령이 먼저 끝나도 그 그룹에 남은 프로세스가 끝난 뒤에 신호로 끝난다', T, async () => {
  const root = repo();
  // 명령은 신호를 받자마자 끝나고, 같은 그룹의 자식은 0.7초 뒤에 끝난다
  const child =
    "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 700));" +
    "require('node:fs').writeFileSync('child-ready', ''); setInterval(() => {}, 1000);";
  write(
    root,
    'long.mjs',
    `import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });
process.on('SIGTERM', () => process.exit(0));
writeFileSync('pids.json', JSON.stringify({ self: process.pid, child: child.pid }));
setInterval(() => {}, 1000);
`,
  );
  const d = driver(root, 10_000);
  const done = exited(d);
  let p: { self: number; child: number } | undefined;
  try {
    await waitFor(
      () => hasPids(root) && existsSync(path.join(root, 'child-ready')),
      30_000,
      '명령의 pid 파일과 자식의 준비',
    );
    p = pids(root);
    d.kill('SIGTERM');
    const end = await done;
    assert.equal(alive(p.child), false, '명령의 자식이 남았다');
    assert.equal(alive(p.self), false);
    assert.deepEqual(end, { code: null, signal: 'SIGTERM' });
  } finally {
    reap(d.pid, p?.self, p?.child);
  }
});

test('신호를 두 번 받으면 유예 시간을 기다리지 않고 SIGKILL로 끝낸다', T, async () => {
  const root = repo(true);
  // 유예 시간이 테스트 제한 시간보다 길다. 두 번째 신호가 아니면 끝나지 않는다
  const d = driver(root, 600_000);
  const done = exited(d);
  let p: { self: number; child: number } | undefined;
  try {
    await waitFor(() => hasPids(root), 30_000, '명령의 pid 파일');
    p = pids(root);
    d.kill('SIGTERM');
    await waitFor(() => got(root).length === 1, 30_000, '첫 신호 전달');
    d.kill('SIGTERM');
    const end = await done;
    assert.equal(alive(p.self), false, '명령이 남았다');
    assert.equal(alive(p.child), false, '명령의 자식이 남았다');
    assert.deepEqual(end, { code: null, signal: 'SIGTERM' });
  } finally {
    reap(d.pid, p?.self, p?.child);
  }
});

test('forwardSignals를 주지 않은 실행은 전과 같다(신호 처리기를 걸지 않는다)', T, async () => {
  const root = repo();
  const script = `
    const { run } = await import(${JSON.stringify(pathToFileURL(path.join(HARNESS_ROOT, 'scripts', 'lib', 'exec.ts')).href)});
    const before = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    const pending = run(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], { cwd: ${JSON.stringify(root)} });
    const during = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    await pending;
    const forwarded = run(process.execPath, ['-e', 'setTimeout(() => {}, 200)'], { cwd: ${JSON.stringify(root)}, forwardSignals: true });
    const duringForward = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    await forwarded;
    const after = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT');
    process.stdout.write(JSON.stringify({ before, during, duringForward, after }));
  `;
  const d = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let out = '';
  d.stdout!.on('data', (c: Buffer) => (out += c.toString()));
  const end = await exited(d);
  assert.equal(end.code, 0);
  // 실행이 끝나면 걸었던 처리기를 모두 뗀다
  assert.deepEqual(JSON.parse(out), { before: 0, during: 0, duringForward: 2, after: 0 });
});

test(
  'forwardSignals 실행이 둘 이상이면 모두 끝난 뒤에 신호로 끝난다(먼저 끝난 쪽이 부모를 끝내지 않는다)',
  T,
  async () => {
    const root = repo();
    // 신호를 받으면 인자로 받은 시간 뒤에 이름을 적고 끝나는 프로그램
    write(
      root,
      'slow.mjs',
      `import { appendFileSync, writeFileSync } from 'node:fs';
const [name, delay] = process.argv.slice(2);
process.on('SIGTERM', () =>
  setTimeout(() => {
    appendFileSync('exited', name + '\\n');
    process.exit(0);
  }, Number(delay)),
);
writeFileSync('pid-' + name, String(process.pid));
setInterval(() => {}, 1000);
`,
    );
    const exec = pathToFileURL(path.join(HARNESS_ROOT, 'scripts', 'lib', 'exec.ts')).href;
    const script = `
    const { run } = await import(${JSON.stringify(exec)});
    const o = { cwd: ${JSON.stringify(root)}, forwardSignals: true };
    await Promise.all([
      run(process.execPath, ['slow.mjs', 'fast', '0'], o),
      run(process.execPath, ['slow.mjs', 'slow', '700'], o),
    ]);
  `;
    const d = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      stdio: 'ignore',
    });
    const done = exited(d);
    const pidOf = (name: string) => Number(readFileSync(path.join(root, `pid-${name}`), 'utf8'));
    let fast: number | undefined;
    let slow: number | undefined;
    try {
      await waitFor(
        () =>
          existsSync(path.join(root, 'pid-fast')) &&
          existsSync(path.join(root, 'pid-slow')) &&
          pidOf('fast') > 0 &&
          pidOf('slow') > 0,
        30_000,
        '두 명령의 pid 파일',
      );
      fast = pidOf('fast');
      slow = pidOf('slow');
      d.kill('SIGTERM');
      const end = await done;
      assert.equal(alive(slow), false, '늦게 끝나는 명령이 남았다');
      assert.equal(alive(fast), false);
      assert.deepEqual(readFileSync(path.join(root, 'exited'), 'utf8').trim().split('\n'), [
        'fast',
        'slow',
      ]);
      assert.deepEqual(end, { code: null, signal: 'SIGTERM' });
    } finally {
      reap(d.pid, fast, slow);
    }
  },
);
