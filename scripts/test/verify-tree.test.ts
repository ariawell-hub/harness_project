// verify의 정리: 실행기가 자기 프로세스 그룹 밖에 띄운 프로세스(브라우저)가 끝난 것까지 확인한 뒤 돌아간다
// (구현 판정 F2). 그런 프로세스에는 신호를 보내지 않고, 남아 있으면 실패로 알린다(F6). 하네스가 받은 SIGHUP에서도
// 정리한다(F1).
// Playwright는 브라우저를 새 프로세스 그룹으로 띄운다. 실행기 그룹에 보낸 신호는 브라우저에 닿지 않는다.
// 브라우저는 실행기와 이은 파이프가 닫히면 스스로 끝난다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { FORWARDED } from '../lib/exec.ts';
import {
  Descendants,
  findMarked,
  listProcesses,
  parseMarked,
  parseProcessList,
  parseProcStat,
  procList,
  readProcessList,
  RUN_MARK,
  scanProc,
  type ProcessRow,
} from '../verify/tree.ts';
import { DEFAULT_RUNNER, STOP_SIGNALS, verifyWeb } from '../verify/web.ts';
import { fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const T = { timeout: 120_000, skip: process.platform === 'win32' };
const WEB = path.join(HARNESS_ROOT, 'scripts/verify/web.ts');
const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');

// ---------- 프로세스 목록과 자손 추적 ----------

test('parseProcessList: pid·ppid·pgid·상태·시작 시각을 읽고, 읽지 못한 줄이 있으면 목록 전체를 버린다', () => {
  assert.deepEqual(
    parseProcessList(
      [
        '    1     0     1 Ss   Thu Nov 19 21:03:11 2026    ',
        '  812     1   812 S+   Fri Nov 20 08:16:18 2026',
        // 날짜가 한 자리면 빈칸이 둘이다. 하나로 줄여 적는다
        ' 9001   812  9001 Z    Thu Nov  5 01:02:03 2026',
        '',
      ].join('\n'),
    ),
    [
      { pid: 1, ppid: 0, pgid: 1, zombie: false, started: 'Thu Nov 19 21:03:11 2026' },
      { pid: 812, ppid: 1, pgid: 812, zombie: false, started: 'Fri Nov 20 08:16:18 2026' },
      { pid: 9001, ppid: 812, pgid: 9001, zombie: true, started: 'Thu Nov 5 01:02:03 2026' },
    ],
  );
  // macOS의 ps는 막 생기거나 끝나는 중인 프로세스의 상태를 ?·?E로 적는다. 그 줄도 읽는다(좀비는 아니다).
  // 시작 시각이 없는 줄은 빈 문자열로 읽는다(그런 프로세스는 따라가지 않는다)
  assert.deepEqual(
    parseProcessList(' 6312  6204  6199 ?E   Fri Nov 20 08:16:18 2026\n 6649  6204  6199 ?   \n'),
    [
      { pid: 6312, ppid: 6204, pgid: 6199, zombie: false, started: 'Fri Nov 20 08:16:18 2026' },
      { pid: 6649, ppid: 6204, pgid: 6199, zombie: false, started: '' },
    ],
  );
  assert.equal(parseProcessList(''), null);
  assert.equal(parseProcessList('1 0 1 S x\nPID PPID PGID STAT STARTED\n'), null);
  assert.equal(parseProcessList('1 0 S\n'), null);
});

/** Linux의 /proc/<pid>/stat 한 줄. comm 뒤로 상태·부모·그룹, 그리고 20번째에 시작 시각이 온다 */
const statLine = (
  pid: number,
  comm: string,
  state: string,
  ppid: number,
  pgid: number,
  start: number,
) =>
  `${pid} (${comm}) ${state} ${ppid} ${pgid} ${pgid} 0 -1 4194304 1 2 3 4 5 6 7 8 20 0 1 0 ${start} 1000 200 18446744073709551615\n`;

test('parseProcStat: 상태·부모·그룹·시작 시각을 읽고, 이름에 빈칸과 괄호가 있어도 읽는다', () => {
  assert.deepEqual(parseProcStat(statLine(812, 'node', 'S', 1, 812, 4242)), {
    pid: 812,
    ppid: 1,
    pgid: 812,
    zombie: false,
    started: '4242',
  });
  // 이름 안의 ") S 9 9"에 속지 않는다(마지막 닫는 괄호 뒤부터 센다)
  assert.deepEqual(parseProcStat(statLine(813, 'a b) S 9 9 (x', 'R', 812, 812, 77)), {
    pid: 813,
    ppid: 812,
    pgid: 812,
    zombie: false,
    started: '77',
  });
  assert.equal(parseProcStat(statLine(814, 'gone', 'Z', 1, 814, 5))?.zombie, true);
  assert.equal(parseProcStat(statLine(815, 'gone', 'X', 1, 815, 5))?.zombie, true);
  assert.equal(parseProcStat(''), null);
  assert.equal(parseProcStat('812 node S 1 812'), null);
  // 칸이 모자라 시작 시각이 없다
  assert.equal(parseProcStat('812 (node) S 1 812 812 0 -1'), null);
  assert.equal(
    parseProcStat('x (node) S 1 812 812 0 -1 4194304 1 2 3 4 5 6 7 8 20 0 1 0 9 1'),
    null,
  );
});

test('procList: /proc 꼴의 폴더에서 목록과 시작 시각을 읽는다', () => {
  const proc = tmp('harness-fake-proc-list-');
  write(proc, '1/stat', statLine(1, 'init', 'S', 0, 1, 3));
  write(proc, '812/stat', statLine(812, 'node', 'S', 1, 812, 4242));
  write(proc, '900/stat', statLine(900, 'chrome (x)', 'S', 812, 900, 5000));
  write(proc, '901/stat', statLine(901, 'gone', 'Z', 812, 900, 5001));
  // 읽는 사이 끝난 프로세스(stat이 없다), 폴더 이름과 다른 pid가 든 파일, 숫자가 아닌 항목은 건너뛴다
  mkdirSync(path.join(proc, '902'));
  write(proc, '903/stat', statLine(904, 'other', 'S', 1, 904, 9));
  write(proc, 'self/stat', statLine(812, 'node', 'S', 1, 812, 4242));
  write(proc, 'uptime', '1 1\n');
  assert.deepEqual(
    procList(proc)?.sort((a, b) => a.pid - b.pid),
    [
      { pid: 1, ppid: 0, pgid: 1, zombie: false, started: '3' },
      { pid: 812, ppid: 1, pgid: 812, zombie: false, started: '4242' },
      { pid: 900, ppid: 812, pgid: 900, zombie: false, started: '5000' },
      { pid: 901, ppid: 812, pgid: 900, zombie: true, started: '5001' },
    ],
  );
  const missing = path.join(proc, 'missing');
  assert.equal(procList(missing), null);
  // 프로세스가 하나도 없으면 읽지 못한 것이다
  assert.equal(procList(tmp('harness-fake-proc-empty-')), null);
});

test('listProcesses: 실제 목록에 이 프로세스가 있다', T, async () => {
  const rows = await listProcesses();
  assert.ok(rows);
  const me = rows.find((r) => r.pid === process.pid);
  assert.ok(me);
  assert.equal(me.ppid, process.ppid);
  assert.equal(me.zombie, false);
  assert.notEqual(me.started, '');
});

test('listProcesses: 프로세스가 계속 생기고 끝나는 동안에도 목록을 읽는다', T, async () => {
  // 생기는 중·끝나는 중인 프로세스가 목록에 섞인다(상태 ?·?E)
  const churn = setInterval(() => {
    for (let i = 0; i < 4; i++) spawn(process.execPath, ['-e', '0'], { stdio: 'ignore' });
  }, 20);
  try {
    const until = Date.now() + 3000;
    let reads = 0;
    while (Date.now() < until) {
      assert.ok(await listProcesses(), `${reads}번 읽은 뒤 목록을 읽지 못했다`);
      reads++;
    }
    assert.ok(reads > 5);
  } finally {
    clearInterval(churn);
  }
});

test('readProcessList: 읽지 못하면 정해진 횟수만큼 다시 읽고, 끝내 못 읽으면 null이다', async () => {
  const rows = [row(1, 0, 1)];
  let calls = 0;
  const flaky = () => Promise.resolve(++calls < 3 ? null : rows);
  assert.equal(await readProcessList(flaky, 3), rows);
  assert.equal(calls, 3);
  calls = 0;
  assert.equal(await readProcessList(flaky, 2), null);
  assert.equal(calls, 2);
  calls = 0;
  assert.equal(await readProcessList(() => Promise.resolve((calls++, rows)), 3), rows);
  assert.equal(calls, 1);
});

const row = (
  pid: number,
  ppid: number,
  pgid: number,
  zombie = false,
  started = 'S',
): ProcessRow => ({ pid, ppid, pgid, zombie, started });
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

// 프로세스는 번호가 아니라 번호와 시작 시각으로 기억한다(같은 번호를 받은 무관한 프로세스를 남은 것으로 세지 않는다)
test('Descendants: 같은 번호·같은 그룹이어도 시작 시각이 다르면 다른 프로세스다(빼고, 다시 넣지 않는다)', async () => {
  const d = tracker(
    [row(100, 1, 100), row(200, 100, 200, false, 'A')],
    // 200번이 끝나고 무관한 프로세스가 같은 번호를 받았다. 그룹 번호도 같다(그룹의 첫 프로세스라 pid와 같다)
    [row(200, 1, 200, false, 'B')],
    [row(200, 1, 200, false, 'B')],
  );
  await d.refresh([100]);
  assert.deepEqual(d.pids(), [200]);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
  await d.refresh();
  assert.deepEqual(d.pids(), []);
});

test('Descendants: 시작 시각을 읽지 못한 프로세스는 따라가지 않는다(어느 프로세스인지 묶어 둘 수 없다)', async () => {
  const d = tracker([
    row(100, 1, 100),
    row(200, 100, 200, false, ''),
    row(201, 200, 200),
    row(300, 100, 300),
  ]);
  await d.refresh([100]);
  assert.deepEqual(d.pids(), [300]);
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

// ---------- 표식으로 찾기 ----------

const NEEDLE = `${RUN_MARK}=0123456789abcdef0123456789abcdef`;

test('parseMarked: 표식이 한 낱말로 든 줄의 pid만 돌려준다', () => {
  const text = [
    `  101 /usr/bin/node app.js PATH=/usr/bin ${NEEDLE} HOME=/home/u`,
    `  102 /usr/bin/node other.js PATH=/usr/bin ${RUN_MARK}=ffff HOME=/home/u`,
    ` 9103 chrome-headless-shell --type=renderer ${NEEDLE}`,
    // 값이 더 길거나 이름 앞에 글자가 붙은 것은 다른 변수다
    `  104 node x.js ${NEEDLE}0 X${NEEDLE}`,
    `  105 node y.js`,
    `${NEEDLE} (pid가 없는 줄)`,
    '',
  ].join('\n');
  assert.deepEqual(parseMarked(text, NEEDLE), [101, 9103]);
  assert.deepEqual(parseMarked('', NEEDLE), []);
});

test('scanProc: environ에 표식이 있는 pid만 돌려주고, 읽을 수 없는 프로세스는 건너뛴다', () => {
  const proc = tmp('harness-fake-proc-');
  const env = (pid: string, entries: string[]) =>
    write(proc, `${pid}/environ`, entries.map((e) => `${e}\0`).join(''));
  env('201', ['PATH=/usr/bin', NEEDLE, 'HOME=/home/u']);
  env('202', [NEEDLE]);
  env('203', ['PATH=/usr/bin', `${RUN_MARK}=ffff`]);
  // 값이 더 길거나 다른 변수의 값 안에 든 것은 표식이 아니다
  env('204', [`${NEEDLE}0`, `OTHER=x ${NEEDLE}`]);
  env('205', []);
  // environ이 없는 프로세스(읽는 사이 끝났다), 숫자가 아닌 항목
  mkdirSync(path.join(proc, '206'));
  write(proc, 'self/environ', `${NEEDLE}\0`);
  write(proc, 'uptime', '1 1\n');
  assert.deepEqual(scanProc(proc, NEEDLE)?.sort(), [201, 202]);
  assert.equal(scanProc(path.join(proc, 'missing'), NEEDLE), null);
});

test('findMarked: 표식을 환경으로 물려받은 실제 프로세스를 부모와 무관하게 찾는다', T, async () => {
  const value = randomBytes(16).toString('hex');
  const needle = `${RUN_MARK}=${value}`;
  // 중간 프로세스가 손자를 새 그룹에 띄우고 바로 끝난다. 손자는 다른 부모로 넘어간다
  const dir = tmp('harness-marked-');
  const middle = spawn(
    process.execPath,
    [
      '-e',
      "const c = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });" +
        "c.unref(); require('node:fs').writeFileSync('orphan.pid', String(c.pid));",
    ],
    { cwd: dir, stdio: 'ignore', env: { ...process.env, [RUN_MARK]: value } },
  );
  await new Promise((r) => middle.once('exit', r));
  const orphan = Number(readFileSync(path.join(dir, 'orphan.pid'), 'utf8'));
  try {
    assert.equal(alive(orphan), true);
    const found = await findMarked(needle);
    assert.ok(found);
    assert.ok(found.includes(orphan), '부모를 잃은 프로세스를 찾지 못했다');
    // 이 프로세스(표식 없음)는 들어 있지 않다
    assert.equal(found.includes(process.pid), false);
    assert.deepEqual(await findMarked(`${RUN_MARK}=${randomBytes(16).toString('hex')}`), []);
  } finally {
    process.kill(orphan, 'SIGKILL');
  }
});

test('Descendants: 표식을 가진 프로세스는 부모가 누구든 더하고 그 자식도 따라간다', async () => {
  const lists = [
    // 실행기는 이미 끝났다. 300은 다른 부모로 넘어간 브라우저(표식 있음), 301은 그 자식(표식을 읽지 못했다)
    [row(1, 0, 1), row(300, 1, 300), row(301, 300, 300), row(400, 1, 400)],
  ];
  const d = new Descendants(
    () => Promise.resolve(lists[0]),
    () => Promise.resolve([300, 999]),
  );
  // 표식으로 찾으라고 하지 않으면 찾지 않는다
  assert.equal(await d.refresh(), true);
  assert.deepEqual(d.pids(), []);
  assert.equal(await d.refresh([], true), true);
  // 목록에 없는 pid(999)도 버리지 않는다(목록을 읽은 뒤에 뜬 프로세스일 수 있다)
  assert.deepEqual(d.pids(), [300, 301, 999]);
});

// 구현 판정 3라운드 F2: 목록과 표식은 다른 시점에 읽는다. 목록을 읽은 뒤에 뜬 프로세스는 표식에만 나온다.
// 그것을 버리면 살아 있는 프로세스를 두고 "남은 것이 없다"고 하게 된다
test('Descendants: 표식에는 있고 목록에는 없는 pid도 남은 것으로 세고, 다음에 목록에서 확인한다', async () => {
  const lists = [
    [row(1, 0, 1)],
    [row(1, 0, 1), row(500, 1, 500), row(501, 500, 500)],
    [row(1, 0, 1)],
  ];
  const marks = [[500], [500], []];
  let i = 0;
  let j = 0;
  const d = new Descendants(
    () => Promise.resolve(lists[Math.min(i++, lists.length - 1)]),
    () => Promise.resolve(marks[Math.min(j++, marks.length - 1)]),
  );
  // 목록을 읽은 뒤에 뜬 프로세스: 표식 조회에만 나온다. 남은 것으로 센다
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), [500]);
  // 다음 읽기에서 목록에도 나온다. 그 자식도 따라간다
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), [500, 501]);
  // 목록에도 표식에도 없으면 끝난 것이다
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), []);
});

// 표식으로만 본 pid는 번호 말고 아는 것이 없다. 표식을 다시 읽어 거기 없다고 확인될 때까지 남은 것으로 센다
test('Descendants: 표식으로만 본 pid는 표식을 다시 읽지 못하면 남은 것으로 계속 세고, 표식에 없으면 뺀다', async () => {
  // 500: 처음에는 표식을 가진 프로세스였다. 두 번째 읽기부터는 같은 번호를 받은 무관한 프로세스(그룹 900)다
  const lists = [
    [row(1, 0, 1)],
    [row(1, 0, 1), row(500, 1, 900)],
    [row(1, 0, 1), row(500, 1, 900)],
  ];
  const marks: (number[] | null)[] = [[500], null, []];
  let i = 0;
  let j = 0;
  const d = new Descendants(
    () => Promise.resolve(lists[Math.min(i++, lists.length - 1)]),
    () => Promise.resolve(marks[Math.min(j++, marks.length - 1)]),
  );
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), [500]);
  // 표식을 읽지 못했다: 끝났다고 하지 못한다
  assert.equal(await d.refresh([], true), false);
  assert.deepEqual(d.pids(), [500]);
  // 표식을 다시 읽었고 500에는 표식이 없다: 우리 것이 아니다
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), []);
});

test('Descendants: 표식으로 본 pid는 표식을 쓰지 않는 읽기에서도 남은 것으로 센다', async () => {
  const lists = [[row(1, 0, 1)], [row(1, 0, 1), row(500, 1, 777, false, 'T')]];
  let i = 0;
  const d = new Descendants(
    () => Promise.resolve(lists[Math.min(i++, lists.length - 1)]),
    () => Promise.resolve([500]),
  );
  await d.refresh([], true);
  assert.deepEqual(d.pids(), [500]);
  assert.equal(await d.refresh(), true);
  assert.deepEqual(d.pids(), [500]);
  assert.equal(await d.refresh([], true), true);
  assert.deepEqual(d.pids(), [500]);
  assert.equal(await d.refresh(), true);
  assert.deepEqual(d.pids(), [500]);
});

test('Descendants: 목록을 읽지 못하면 알던 것을 그대로 둔다(표식으로 본 것도)', async () => {
  const lists = [[row(100, 1, 100), row(200, 100, 200)], null];
  let i = 0;
  const d = new Descendants(
    () => Promise.resolve(lists[Math.min(i++, lists.length - 1)]),
    () => Promise.resolve([500]),
  );
  assert.equal(await d.refresh([100], true), true);
  assert.deepEqual(d.pids(), [200, 500]);
  assert.equal(await d.refresh([100], true), false);
  assert.deepEqual(d.pids(), [200, 500]);
});

test('Descendants: 표식을 가졌어도 이 프로세스와 뿌리는 넣지 않고, 좀비도 넣지 않는다', async () => {
  const d = new Descendants(
    () =>
      Promise.resolve([
        row(100, 1, 100),
        row(process.pid, 1, process.pid),
        row(200, 1, 200, true),
        row(300, 1, 300),
      ]),
    () => Promise.resolve([100, process.pid, 200, 300]),
  );
  await d.refresh([100], true);
  assert.deepEqual(d.pids(), [300]);
});

test('Descendants: 표식을 읽지 못하면 부모·자식 관계로 찾은 데까지 반영하고 false를 돌려준다', async () => {
  const d = new Descendants(
    () => Promise.resolve([row(100, 1, 100), row(200, 100, 200), row(300, 1, 300)]),
    () => Promise.resolve(null),
  );
  assert.equal(await d.refresh([100], true), false);
  assert.deepEqual(d.pids(), [200]);
  // 표식을 쓰지 않는 읽기는 그대로 true다
  assert.equal(await d.refresh([100]), true);
});

// ---------- verifyWeb ----------

test('verify가 처리하는 신호는 표준 명령 실행기가 넘기는 신호와 같다', () => {
  assert.deepEqual([...STOP_SIGNALS], ['SIGTERM', 'SIGINT', 'SIGHUP']);
  assert.equal(STOP_SIGNALS, FORWARDED);
});

interface RunnerCfg {
  /**
   * 실행기가 새 프로세스 그룹에 띄워 두는 프로세스(브라우저 구실).
   * tied: 실행기와 이은 파이프가 닫히면(실행기가 어떻게 끝나든) 스스로 끝난다. 실제 Chromium이 이렇게 한다.
   * lingering: 실행기가 끝나도 스스로 끝나지 않는다
   */
  browser: 'tied' | 'lingering';
  /** tied: 파이프가 닫힌 뒤 끝나기까지 걸리는 시간(ms). 기본 0 */
  exitDelayMs?: number;
  /** 실행기가 SIGTERM을 무시한다(정리가 SIGKILL까지 간다) */
  ignoreTerm?: boolean;
  /** 끝나지 않는다 */
  hang?: boolean;
  /** dev가 새 프로세스 그룹에 스스로 끝나지 않는 프로세스를 하나 띄워 둔다(helper.pid) */
  devHelper?: boolean;
  /** 브라우저를 띄우고 조금 뒤 SIGKILL로 죽는다(브라우저를 닫아 줄 것이 없다) */
  crash?: boolean;
}

const DEV = (helper: boolean) => `import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (${String(helper)}) {
  const h = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { detached: true, stdio: 'ignore' });
  h.unref();
  writeFileSync('helper.pid', String(h.pid));
}
writeFileSync('dev-mark', process.env.HARNESS_VERIFY_RUN ?? '');
http.createServer((req, res) => res.end('fake dev')).listen(Number(process.env.PORT), process.env.HOST, () =>
  writeFileSync('dev.pid', String(process.pid)),
);
`;

/** 브라우저 구실. tied는 표준 입력(실행기와 이은 파이프)이 닫히면 끝난다 */
const browserScript = (cfg: RunnerCfg) =>
  cfg.browser === 'tied'
    ? `process.stdin.on('end', () => setTimeout(() => process.exit(0), ${String(cfg.exitDelayMs ?? 0)})); process.stdin.resume(); setInterval(() => {}, 1000);`
    : 'setInterval(() => {}, 1000);';

const runnerScript = (cfg: RunnerCfg) => `const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const CFG = ${JSON.stringify(cfg)};
if (CFG.ignoreTerm) process.on('SIGTERM', () => {});
const browser = spawn(process.execPath, ['-e', ${JSON.stringify(browserScript(cfg))}], {
  detached: true,
  stdio: [CFG.browser === 'tied' ? 'pipe' : 'ignore', 'ignore', 'ignore'],
});
browser.unref();
// 파이프가 이 실행기를 붙잡아 두지 않는다(실행기가 끝나면 파이프가 닫힌다)
if (browser.stdin) browser.stdin.unref();
fs.writeFileSync('browser.pid', String(browser.pid));
fs.writeFileSync('runner.pid', String(process.pid));
fs.writeFileSync('runner-env.json', JSON.stringify({ mark: process.env.HARNESS_VERIFY_RUN ?? null }));
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
if (CFG.crash) setTimeout(() => process.kill(process.pid, 'SIGKILL'), 700);
else if (CFG.hang) setInterval(() => {}, 1000);
else
  // verify가 이 실행기의 자손을 한 번은 볼 수 있을 만큼 떠 있다가 통과 보고서를 쓰고 끝난다
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
/** pid 파일이 아직 없거나 다 쓰이지 않았으면 -1 */
function pidOr(root: string, name: string): number {
  if (!existsSync(path.join(root, name))) return -1;
  const pid = pidIn(root, name);
  return pid > 0 ? pid : -1;
}
function alive(pid: number): boolean {
  if (!(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** 테스트가 띄운 것을 남기지 않는다. verify는 다른 그룹의 프로세스에 신호를 보내지 않으므로 남은 것은 여기서 끝낸다 */
function reap(root: string, ...more: (number | undefined)[]): void {
  const pids = [...more];
  for (const name of ['browser.pid', 'runner.pid', 'dev.pid', 'helper.pid'])
    pids.push(pidOr(root, name));
  for (const pid of pids) {
    if (!pid || pid < 1) continue;
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
/** 다른 그룹에 남은 프로세스를 그 번호와 함께 알리는 문제 */
const leftOutside = (pid: number) =>
  new RegExp(`띄운 프로세스를 끝내지 못했다.*다른 프로세스 그룹.*pid [0-9, ]*\\b${String(pid)}\\b`);

test(
  'verifyWeb: 실행기를 SIGKILL로 끝내야 하는 경우에도 실행기가 다른 그룹에 띄운 프로세스가 끝난 뒤에 돌아간다',
  T,
  async () => {
    const f = fx({ browser: 'tied', exitDelayMs: 400, ignoreTerm: true, hang: true });
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

// 구현 판정 F6: verify는 직접 띄운 프로세스(dev, 실행기)와 그 프로세스 그룹에만 신호를 보낸다. 다른 그룹의 프로세스는
// 번호로만 가리킬 수 있고, 번호는 다른 프로세스가 다시 받을 수 있다. 그래서 끝났는지 확인만 하고, 남았으면 알린다
test(
  'verifyWeb: 다른 그룹에 남은 프로세스에는 신호를 보내지 않고, 그 번호와 함께 남았다고 알린다',
  T,
  async () => {
    const f = fx({ browser: 'lingering', hang: true });
    try {
      const r = await run(f, { runnerTimeoutSec: 2 });
      const browser = pidIn(f.root, 'browser.pid');
      assert.equal(alive(browser), true, '다른 그룹의 프로세스에 신호를 보냈다');
      assert.equal(alive(pidIn(f.root, 'runner.pid')), false);
      assert.equal(alive(pidIn(f.root, 'dev.pid')), false);
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(browser));
    } finally {
      reap(f.root);
    }
  },
);

test('verifyWeb: 중단 신호로 끝낼 때도 다른 그룹의 프로세스가 끝난 뒤에 돌아간다', T, async () => {
  const f = fx({ browser: 'tied', exitDelayMs: 400, ignoreTerm: true, hang: true });
  const ac = new AbortController();
  try {
    const pending = run(f, { signal: ac.signal });
    await waitFor(() => pidOr(f.root, 'browser.pid') > 0, 30_000, '브라우저 pid 파일');
    // verify가 실행기의 자손을 한 번은 본 뒤에 끊는다
    await new Promise((r) => setTimeout(r, 1000));
    ac.abort();
    const r = await pending;
    assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
    assert.equal(alive(pidIn(f.root, 'runner.pid')), false);
    assert.equal(r.ok, false);
    assert.match(problems(r), /중단 신호를 받았다/);
    assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
  } finally {
    reap(f.root);
  }
});

test(
  'verifyWeb: 실행기가 스스로 끝나면, 그것이 다른 그룹에 띄운 프로세스가 끝난 것을 확인하고 돌아간다(판정은 그대로 통과다)',
  T,
  async () => {
    const f = fx({ browser: 'tied', exitDelayMs: 600 });
    try {
      const r = await run(f);
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, true, problems(r));
    } finally {
      reap(f.root);
    }
  },
);

test(
  'verifyWeb: 시나리오가 통과했어도 다른 그룹에 프로세스가 남아 있으면 통과로 두지 않는다',
  T,
  async () => {
    const f = fx({ browser: 'lingering' });
    try {
      const r = await run(f);
      const browser = pidIn(f.root, 'browser.pid');
      assert.equal(alive(browser), true, '다른 그룹의 프로세스에 신호를 보냈다');
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(browser));
      // 시나리오 자신은 통과였다
      assert.equal(r.verdict.scenarios.length, 1);
      assert.equal(r.verdict.scenarios[0].ok, true);
      // 공개 요약에는 분류와 건수만 들어간다. 남은 프로세스의 번호를 적은 문장은 들어가지 않는다
      const evidence = path.join(r.outDir, 'evidence');
      const json = readFileSync(path.join(evidence, 'summary.json'), 'utf8');
      const md = readFileSync(path.join(evidence, 'summary.md'), 'utf8');
      const summary = JSON.parse(json) as {
        ok: boolean;
        problems: { category: string; count: number }[];
      };
      assert.equal(summary.ok, false);
      assert.deepEqual(summary.problems, [{ category: '정리 실패', count: 1 }]);
      assert.equal((json + md).includes('pid '), false);
    } finally {
      reap(f.root);
    }
  },
);

// 구현 판정 2라운드 F2: 목록을 읽는 사이에 브라우저가 뜨고 실행기가 죽으면, 브라우저는 다른 부모로 넘어가
// 부모·자식 관계로는 찾을 수 없다. 여기서는 실행기가 떠 있는 동안의 목록을 비워 "한 번도 보지 못한" 경우를 만든다
test(
  'verifyWeb: 실행기가 떠 있는 동안 한 번도 보지 못한 다른 그룹의 프로세스도, 실행기가 죽은 뒤에 찾아 끝날 때까지 기다린다',
  T,
  async () => {
    const f = fx({ browser: 'tied', exitDelayMs: 800, crash: true });
    let sawRunner = false;
    const blind = async () => {
      const rows = await listProcesses();
      if (!rows) return null;
      // 실행기가 뜨기 전과 떠 있는 동안에는 dev만 있는 것처럼 보인다(실행기와 그 자손을 보지 못한다)
      if (!existsSync(path.join(f.root, 'runner.pid'))) return rows;
      if (alive(pidOr(f.root, 'runner.pid'))) {
        sawRunner = true;
        return [];
      }
      return rows;
    };
    // 실행기가 죽은 뒤에 표식으로 브라우저를 본 횟수(브라우저가 이미 끝나 있었다면 이 테스트는 아무것도 보지 못한다)
    let found = 0;
    const marks: typeof findMarked = async (needle) => {
      const pids = await findMarked(needle);
      if (pids?.includes(pidOr(f.root, 'browser.pid'))) found++;
      return pids;
    };
    try {
      const r = await run(f, { listProcesses: blind, findMarked: marks });
      assert.ok(found >= 1, '실행기가 죽은 뒤에 브라우저를 찾지 못했다(테스트의 전제)');
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, false);
      assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
      // 실행기가 떠 있는 동안 목록을 실제로 읽었다(가린 것이 쓰였다)
      assert.equal(sawRunner, true);
    } finally {
      reap(f.root);
    }
  },
);

// 구현 판정 3라운드 F2: 표식 조회가 찾은 프로세스가 프로세스 목록에는 (아직) 없을 때 정리가 끝났다고 하지 않는다.
// 여기서는 정리의 첫 읽기에서만 목록이 브라우저를 놓친다
test(
  'verifyWeb: 표식에는 있고 프로세스 목록에는 아직 없는 프로세스도, 끝난 것을 확인한 뒤에 돌아간다',
  T,
  async () => {
    const f = fx({ browser: 'tied', exitDelayMs: 800, crash: true });
    const browser = () => pidOr(f.root, 'browser.pid');
    const runnerDead = () =>
      existsSync(path.join(f.root, 'runner.pid')) && !alive(pidOr(f.root, 'runner.pid'));
    // 실행기가 끝난 뒤의 표식 읽기 횟수. 첫 표식 읽기 전까지(실행기가 떠 있는 동안과 정리의 첫 목록 읽기) 가린다
    let marked = 0;
    const list = async () =>
      (await listProcesses())?.filter((r) => marked >= 1 || r.pid !== browser()) ?? null;
    const marks: typeof findMarked = async (needle) => {
      const found = await findMarked(needle);
      if (runnerDead()) marked++;
      return found;
    };
    try {
      const r = await run(f, { listProcesses: list, findMarked: marks });
      assert.ok(marked >= 2);
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, false);
      assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
    } finally {
      reap(f.root);
    }
  },
);

test(
  'verifyWeb: 표식으로만 보이고 프로세스 목록에는 끝내 없는 번호도 남은 것으로 알리고, 신호는 보내지 않는다',
  T,
  async () => {
    const f = fx({ browser: 'lingering', crash: true });
    const hidden = async () =>
      (await listProcesses())?.filter((r) => r.pid !== pidOr(f.root, 'browser.pid')) ?? null;
    try {
      const r = await run(f, { listProcesses: hidden });
      const browser = pidIn(f.root, 'browser.pid');
      assert.equal(alive(browser), true, '다른 그룹의 프로세스에 신호를 보냈다');
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(browser));
    } finally {
      reap(f.root);
    }
  },
);

// 목록과 표식 읽기는 순간 사진이 아니다(읽는 사이에 뜨고 부모가 끝난 프로세스는 한 번의 읽기에서 빠질 수 있다).
// 한 번 비어 보인 것으로 끝났다고 하지 않고 다시 본다
test(
  'verifyWeb: 남은 것이 한 번 안 보였다고 정리가 끝났다고 하지 않는다(이어서 두 번 비어야 한다)',
  T,
  async () => {
    const f = fx({ browser: 'lingering', crash: true });
    const browser = () => pidOr(f.root, 'browser.pid');
    const runnerDead = () =>
      existsSync(path.join(f.root, 'runner.pid')) && !alive(pidOr(f.root, 'runner.pid'));
    // 실행기가 죽은 뒤의 표식 읽기 횟수. 정리는 볼 때마다 목록을 읽고 이어서 표식을 읽는다.
    // 1번째: 목록이 놓치고 표식만 본다. 2번째: 둘 다 본다. 3번째: 둘 다 놓친다(한 번 비어 보인다). 4번째부터: 둘 다 본다
    let after = 0;
    const list = async () =>
      (await listProcesses())?.filter((r) => (after !== 0 && after !== 2) || r.pid !== browser()) ??
      null;
    const blink: typeof findMarked = async (needle) => {
      const found = await findMarked(needle);
      if (!runnerDead()) return found;
      return ++after === 3 ? [] : found;
    };
    try {
      const r = await run(f, { listProcesses: list, findMarked: blink });
      assert.ok(after >= 4, '비어 보인 뒤에 다시 보지 않았다');
      assert.equal(r.ok, false);
      // 한 번 비어 보인 데서 끝났다고 했다면 이 문제가 없다
      assert.match(problems(r), leftOutside(pidIn(f.root, 'browser.pid')));
    } finally {
      reap(f.root);
    }
  },
);

// 구현 판정 4~8라운드 F6: 번호는 프로세스가 끝나면 다른 프로세스가 다시 받을 수 있다. verify가 자손이라고 알고 있는
// 번호가 무관한 프로세스의 것이 되어도 그 프로세스에 신호가 가면 안 된다. 여기서는 무관한 프로세스 하나를 두고,
// 실행기가 떠 있는 동안에는 프로세스 목록이 그것을 실행기의 자식으로 보여 주고(번호·그룹·시작 시각은 진짜 값이다),
// 실행기가 끝난 뒤에는 표식 읽기도 그 번호를 내놓게 한다. verify가 볼 수 있는 모든 것이 "우리 자손"이라고 말한다
test(
  'verifyWeb: 무관한 프로세스가 자손으로 보여도(번호가 다시 쓰인 경우) 그 프로세스에 신호가 가지 않는다',
  T,
  async () => {
    const f = fx({ browser: 'tied' });
    const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
      detached: true,
      stdio: 'ignore',
    });
    bystander.unref();
    const runner = () => pidOr(f.root, 'runner.pid');
    let adopted = false;
    const list = async () => {
      const rows = await listProcesses();
      if (!rows || !alive(runner())) return rows;
      return rows.map((r) => {
        if (r.pid !== bystander.pid) return r;
        adopted = true;
        return { ...r, ppid: runner() };
      });
    };
    let claimed = 0;
    const marks: typeof findMarked = async (needle) => {
      const found = await findMarked(needle);
      if (!found || runner() < 0 || alive(runner())) return found;
      claimed++;
      return [...found, bystander.pid!];
    };
    try {
      const r = await run(f, { listProcesses: list, findMarked: marks });
      assert.equal(adopted, true, '무관한 프로세스가 자손으로 보이지 않았다(테스트의 전제)');
      assert.ok(claimed >= 1);
      assert.equal(alive(bystander.pid!), true, '무관한 프로세스에 신호를 보냈다');
      // 우리 것은 끝났다
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      // 남은 것으로 보이므로 통과로 두지 않고 그 번호를 알린다
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(bystander.pid!));
    } finally {
      reap(f.root, bystander.pid);
    }
  },
);

// 구현 판정 4라운드 F2: 실행기를 SIGKILL로 끝낸 뒤에 처음 보인 자손도 끝난 것을 확인한다.
// 여기서는 브라우저를 실행기가 살아 있는 동안에는 목록에서도 표식에서도 가린다
test(
  'verifyWeb: 실행기를 SIGKILL로 끝낸 뒤 확인하다가 처음 찾은 프로세스도 끝난 것을 확인하고 돌아간다',
  T,
  async () => {
    const f = fx({ browser: 'tied', exitDelayMs: 600, ignoreTerm: true, hang: true });
    const browser = () => pidOr(f.root, 'browser.pid');
    const runnerDead = () =>
      existsSync(path.join(f.root, 'runner.pid')) && !alive(pidOr(f.root, 'runner.pid'));
    const list = async () =>
      (await listProcesses())?.filter((r) => runnerDead() || r.pid !== browser()) ?? null;
    let revealed = 0;
    const marks: typeof findMarked = async (needle) => {
      const found = await findMarked(needle);
      if (!found) return null;
      // 실행기가 SIGKILL로 끝난 뒤에야 보인다
      if (!runnerDead()) return found.filter((pid) => pid !== browser());
      if (found.includes(browser())) revealed++;
      return found;
    };
    try {
      const r = await run(f, { runnerTimeoutSec: 2, listProcesses: list, findMarked: marks });
      assert.ok(revealed >= 1, 'SIGKILL 뒤에 브라우저가 보이지 않았다(테스트의 전제)');
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, false);
      assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
    } finally {
      reap(f.root);
    }
  },
);

// 구현 판정 5라운드 F2: 기한을 넘겨 끝난 읽기에서 처음 찾은 프로세스를 두고 끝났다고 하지 않는다.
// 여기서는 실행기가 SIGKILL로 끝난 뒤의 첫 표식 읽기를 기한(1.5초)보다 오래 걸리게 한다
test(
  'verifyWeb: 기한을 넘겨 끝난 읽기에서 처음 찾은 프로세스가 남아 있으면, 그 번호와 함께 남았다고 알린다',
  T,
  async () => {
    const f = fx({ browser: 'lingering', ignoreTerm: true, hang: true });
    const browser = () => pidOr(f.root, 'browser.pid');
    const runnerDead = () =>
      existsSync(path.join(f.root, 'runner.pid')) && !alive(pidOr(f.root, 'runner.pid'));
    // 실행기가 살아 있는 동안에는 브라우저가 목록에도 표식에도 보이지 않는다
    const list = async () =>
      (await listProcesses())?.filter((r) => runnerDead() || r.pid !== browser()) ?? null;
    let slow = 0;
    const marks: typeof findMarked = async (needle) => {
      if (!runnerDead())
        return (await findMarked(needle))?.filter((pid) => pid !== browser()) ?? null;
      if (slow++ === 0) await new Promise((r) => setTimeout(r, 1800));
      return findMarked(needle);
    };
    try {
      const r = await run(f, { runnerTimeoutSec: 2, listProcesses: list, findMarked: marks });
      assert.ok(slow >= 1);
      assert.equal(alive(browser()), true, '다른 그룹의 프로세스에 신호를 보냈다');
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(browser()));
    } finally {
      reap(f.root);
    }
  },
);

// 읽기가 느려 기한을 넘겼다는 것만으로 "끝내지 못했다"고 하지 않는다: 남은 것이 보이지 않으면 한 번 더 확인한다
test(
  'verifyWeb: 기한을 넘겨 끝난 읽기에서 남은 것이 없으면, 이어서 한 번 더 확인하고 끝났다고 한다',
  T,
  async () => {
    const f = fx({ browser: 'tied', ignoreTerm: true, hang: true });
    const runnerDead = () =>
      existsSync(path.join(f.root, 'runner.pid')) && !alive(pidOr(f.root, 'runner.pid'));
    let slow = 0;
    const marks: typeof findMarked = async (needle) => {
      if (runnerDead() && slow++ === 0) await new Promise((r) => setTimeout(r, 1800));
      return findMarked(needle);
    };
    try {
      const r = await run(f, { runnerTimeoutSec: 2, findMarked: marks });
      assert.ok(slow >= 1);
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, false);
      assert.match(problems(r), /실행기가 2초 안에 끝나지 않아 중단했다/);
      assert.doesNotMatch(problems(r), /띄운 프로세스를 끝내지 못했다/);
    } finally {
      reap(f.root);
    }
  },
);

// 구현 판정 2라운드 F5: 정리 도중 목록을 읽지 못해도 dev와 실행기의 그룹은 끝낸다. 다른 그룹에 남은 것이 없는지는
// 확인하지 못했으므로 실패로 돌아간다
test(
  'verifyWeb: 정리 도중 프로세스 목록을 읽지 못하게 되면 dev와 실행기는 끝내고, 실패로 돌아간다',
  T,
  async () => {
    const f = fx({ browser: 'tied', ignoreTerm: true, hang: true });
    let stopping = false;
    // 정리가 시작된 뒤부터는 목록을 읽지 못한다
    const failing = async () => (stopping ? null : listProcesses());
    const marks: typeof findMarked = (needle) => {
      // 표식은 정리할 때만 읽는다
      stopping = true;
      return findMarked(needle);
    };
    try {
      const r = await run(f, { runnerTimeoutSec: 3, listProcesses: failing, findMarked: marks });
      // SIGTERM을 무시하는 실행기도 SIGKILL로 끝냈다
      assert.equal(alive(pidIn(f.root, 'runner.pid')), false, '실행기가 남았다');
      assert.equal(alive(pidIn(f.root, 'dev.pid')), false, 'dev가 남았다');
      assert.equal(r.ok, false);
      // 끝났는지 목록으로 확인하지는 못했다
      assert.match(problems(r), /띄운 프로세스를 끝내지 못했다.*프로세스 목록/);
    } finally {
      reap(f.root);
    }
  },
);

test(
  'verifyWeb: dev가 다른 그룹에 띄워 둔 프로세스가 남아 있으면 신호를 보내지 않고, 통과로 두지 않는다',
  T,
  async () => {
    const f = fx({ browser: 'tied', devHelper: true });
    try {
      const r = await run(f);
      const helper = pidIn(f.root, 'helper.pid');
      assert.equal(alive(helper), true, '다른 그룹의 프로세스에 신호를 보냈다');
      assert.equal(alive(pidIn(f.root, 'dev.pid')), false, 'dev가 남았다');
      assert.equal(alive(pidIn(f.root, 'browser.pid')), false, '브라우저가 남았다');
      assert.equal(r.ok, false);
      assert.match(problems(r), leftOutside(helper));
      assert.equal(r.verdict.scenarios[0].ok, true);
    } finally {
      reap(f.root);
    }
  },
);

test('verifyWeb: 표식을 가진 프로세스를 읽지 못해도 통과로 두지 않는다', T, async () => {
  const f = fx({ browser: 'tied' });
  try {
    const r = await run(f, { findMarked: () => Promise.resolve(null) });
    assert.equal(r.ok, false);
    assert.match(problems(r), /띄운 프로세스를 끝내지 못했다.*프로세스 목록/);
  } finally {
    reap(f.root);
  }
});

test('verifyWeb: dev와 실행기에 이번 실행의 표식을 주고, 실행마다 값이 다르다', T, async () => {
  const seen: string[] = [];
  for (let i = 0; i < 2; i++) {
    const f = fx({ browser: 'tied' });
    try {
      const r = await run(f, {
        findMarked: (needle) => {
          if (!seen.includes(needle)) seen.push(needle);
          return findMarked(needle);
        },
      });
      assert.equal(r.ok, true, problems(r));
      const env = JSON.parse(readFileSync(path.join(f.root, 'runner-env.json'), 'utf8')) as {
        mark: string | null;
      };
      assert.equal(`${RUN_MARK}=${String(env.mark)}`, seen[i]);
      assert.equal(readFileSync(path.join(f.root, 'dev-mark'), 'utf8'), env.mark);
    } finally {
      reap(f.root);
    }
  }
  assert.equal(seen.length, 2);
  for (const needle of seen) assert.match(needle, new RegExp(`^${RUN_MARK}=[0-9a-f]{32}$`));
});

test(
  'verifyWeb: 프로세스 목록을 읽지 못하면 통과로 두지 않는다(남은 것이 없는지 확인하지 못했다)',
  T,
  async () => {
    const f = fx({ browser: 'tied' });
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
    `명령행: ${sig}을 받으면 dev와 실행기를 끝내고, 다른 그룹의 프로세스가 끝난 것을 확인한 뒤 종료 코드 1로 끝난다`,
    T,
    async () => {
      const f = fx({ browser: 'tied', hang: true });
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
    const f = fx({ browser: 'tied', hang: true }, `node ${JSON.stringify(WEB)}`);
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
