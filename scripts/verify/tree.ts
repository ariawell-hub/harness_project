// verify가 띄운 것(dev, 실행기)의 자손을 프로세스 그룹과 무관하게 따라간다(설계서 11.1절, 계획 20261119-pilot-prep
// 수용 기준 4). verify의 정리는 dev와 실행기의 프로세스 그룹에 신호를 보내고 그룹이 빈 것을 확인한다. Playwright는
// 브라우저를 새 프로세스 그룹으로 띄우므로 그것만으로는 브라우저가 끝났는지 알 수 없다. 그래서 도는 동안 프로세스
// 목록에서 자손을 찾아 기억하고, 정리할 때 그 프로세스들이 모두 사라진 것을 확인한다.
//
// **여기서 찾은 프로세스에는 신호를 보내지 않는다. 남았는지 세기만 한다**(구현 판정 F6). 직접 띄우지 않은 프로세스는
// 번호(pid)로만 가리킬 수 있는데, 번호는 그 프로세스가 끝나면 무관한 프로세스가 다시 받을 수 있다. 번호가 아직 그
// 프로세스의 것인지 확인하는 것과 신호를 보내는 것을 한 동작으로 묶는 수단이 Node에는 없다. 브라우저는 실행기와 이은
// 파이프가 닫히면(실행기가 어떻게 끝나든) 스스로 끝나므로, 실행기를 끝내고 기다리면 된다. 기한까지 남아 있으면
// 부르는 쪽(web.ts)이 남은 번호와 함께 실패로 알린다.
//
// 찾는 방법은 둘이다.
// 1. 부모·자식 관계: 프로세스 목록에서 뿌리(dev, 실행기)와 이미 아는 프로세스의 자식을 따라간다. 주기적으로 읽는다.
//    부모가 먼저 끝나 다른 부모로 넘어간 프로세스는, 그 전에 한 번이라도 봤어야 계속 따라갈 수 있다.
// 2. 표식: verify는 dev와 실행기에 이번 실행만의 환경 변수(HARNESS_VERIFY_RUN=<난수>)를 준다. 환경은 자손에게
//    물려지므로, 부모가 누구든 그 표식을 가진 프로세스는 이번 실행이 띄운 것이다. 한 번도 보지 못한 채 부모를 잃은
//    프로세스(목록을 읽는 사이에 브라우저가 뜨고 실행기가 죽은 경우)도 이것으로 찾는다. 정리할 때 읽는다.
//
// 목록에서 본 프로세스는 번호와 시작 시각으로 기억한다. 같은 번호를 무관한 프로세스가 다시 받았으면(시작 시각이
// 다르다) 남은 것으로 세지 않는다. 틀리게 세어도 생기는 일은 "남았다"는 잘못된 실패뿐이다(신호는 가지 않는다).
//
// 읽는 수단은 운영체제마다 하나로 맞춘다(시작 시각의 표현이 서로 달라 섞으면 견줄 수 없다).
// - Linux: /proc. 목록·시작 시각은 `/proc/<pid>/stat`(시작 시각은 부팅 뒤의 틱 수다), 표식은 `/proc/<pid>/environ`.
//   `ps`는 쓰지 않는다(procps의 `lstart`는 부르는 시점에 따라 1초 달라질 수 있다).
// - 그 밖(macOS): `ps`. 목록·시작 시각은 `ps -A -o pid=,ppid=,pgid=,stat=,lstart=`, 표식은 `ps -A -E -o pid=,command=`.
//
// 한계
// - 환경을 읽을 수 없거나(Linux에서 다른 사용자나 덤프가 막힌 프로세스) 표식을 지운 프로세스가, 목록을 읽는
//   사이(주기는 web.ts)에 띄워지고 그 부모가 곧바로 끝나면 놓칠 수 있다.
// - 스스로 끝나지 않는 그룹 밖 프로세스(dev가 따로 띄워 둔 데몬 등)는 끝내지 못한다. 남았다고 알릴 뿐이다.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** 끝났지만 부모가 아직 거두지 않았다. 남은 프로세스로 세지 않는다 */
  zombie: boolean;
  /** 시작 시각(같은 운영체제 안에서만 견준다). 읽지 못했으면 빈 문자열이고, 그런 프로세스는 따라가지 않는다 */
  started: string;
}

/** 지금 떠 있는 프로세스의 목록. 읽지 못했으면 null */
export type ListProcesses = () => Promise<ProcessRow[] | null>;

/**
 * `ps -A -o pid=,ppid=,pgid=,stat=,lstart=`의 출력을 읽는다.
 * 읽지 못한 줄이 하나라도 있으면 목록 전체를 버린다(일부만 믿고 "남은 것이 없다"고 하지 않는다)
 */
export function parseProcessList(text: string): ProcessRow[] | null {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // 상태 칸은 빈칸 없는 글자열이면 받는다. macOS는 막 생기거나 끝나는 중인 프로세스를 ?·?E로 적는다
    // (그런 프로세스가 하나만 있어도 목록 전체를 버리면 프로세스가 자주 바뀌는 동안에는 읽지 못한다).
    // 시작 시각은 줄의 나머지다(`Fri Nov 20 08:16:18 2026`. 날짜가 한 자리면 빈칸이 둘이라 하나로 줄인다)
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(\S.*?))?\s*$/.exec(line);
    if (!m) return null;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      zombie: m[4].startsWith('Z'),
      started: (m[5] ?? '').replace(/\s+/g, ' '),
    });
  }
  return rows.length ? rows : null;
}

/**
 * Linux의 `/proc/<pid>/stat` 한 줄을 읽는다: `pid (comm) state ppid pgrp … starttime …`.
 * comm에는 빈칸과 괄호가 들 수 있어 마지막 `)` 뒤부터 센다. 그 뒤 1번째가 상태, 2번째가 부모, 3번째가 그룹,
 * 20번째가 시작 시각(부팅 뒤의 틱 수)이다. 꼴이 다르면 null
 */
export function parseProcStat(text: string): ProcessRow | null {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 1 || close < open) return null;
  const pid = text.slice(0, open).trim();
  const rest = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  if (!/^\d+$/.test(pid) || rest.length < 20) return null;
  const [state, ppid, pgid] = rest;
  const started = rest[19];
  if (!/^\d+$/.test(ppid) || !/^\d+$/.test(pgid) || !/^\d+$/.test(started)) return null;
  return {
    pid: Number(pid),
    ppid: Number(ppid),
    pgid: Number(pgid),
    // Z: 좀비, X: 끝나는 중
    zombie: state === 'Z' || state === 'X',
    started,
  };
}

/** `<procDir>`의 숫자 이름(프로세스) 목록. 폴더를 읽지 못하면 null */
function procPids(procDir: string): string[] | null {
  try {
    return readdirSync(procDir).filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
}

/** `<procDir>/<pid>/stat`을 읽는다. 없거나(읽는 사이 끝났다) 꼴이 다르면 null */
function procStat(procDir: string, pid: string | number): ProcessRow | null {
  try {
    const row = parseProcStat(readFileSync(`${procDir}/${pid}/stat`, 'latin1'));
    return row && row.pid === Number(pid) ? row : null;
  } catch {
    return null;
  }
}

/**
 * Linux: `<procDir>`에서 프로세스 목록을 읽는다. 읽는 사이 끝난 프로세스는 건너뛴다.
 * 폴더를 읽지 못했거나 하나도 읽지 못했으면 null
 */
export function procList(procDir: string): ProcessRow[] | null {
  const names = procPids(procDir);
  if (!names) return null;
  const rows: ProcessRow[] = [];
  for (const name of names) {
    const row = procStat(procDir, name);
    if (row) rows.push(row);
  }
  return rows.length ? rows : null;
}

const LIST_TIMEOUT_MS = 1000;
/** 목록을 읽는 횟수의 한도. 한 번의 실패(ps가 제때 끝나지 않음 등)로 "확인하지 못했다"고 하지 않는다 */
export const LIST_ATTEMPTS = 3;

/** `read`가 목록을 돌려줄 때까지 `attempts`번까지 읽는다. 끝내 읽지 못했으면 null */
export async function readProcessList(
  read: ListProcesses,
  attempts: number,
): Promise<ProcessRow[] | null> {
  for (let i = 0; i < attempts; i++) {
    const rows = await read();
    if (rows) return rows;
  }
  return null;
}

/** ps를 돌려 출력을 받는다. ps가 없거나 실패하거나 제때 끝나지 않으면 null. 날짜의 표기가 바뀌지 않게 로캘을 고정한다 */
function ps(args: string[], maxBuffer: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      args,
      {
        timeout: LIST_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer,
        env: { ...process.env, LC_ALL: 'C' },
      },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/** 목록을 한 번 읽는다. Linux는 /proc, 그 밖은 ps(POSIX의 -A와 -o) */
const listOnce: ListProcesses = async () => {
  if (process.platform === 'linux') return procList('/proc');
  const out = await ps(['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], 16 * 1024 * 1024);
  return out === null ? null : parseProcessList(out);
};

/** 프로세스 목록. 읽지 못하면 `LIST_ATTEMPTS`번까지 다시 읽는다 */
export const listProcesses: ListProcesses = () => readProcessList(listOnce, LIST_ATTEMPTS);

/** 이번 실행의 표식을 담는 환경 변수 이름 */
export const RUN_MARK = 'HARNESS_VERIFY_RUN';

/** 환경(이나 명령행)에 `needle`(`이름=값`)이 있는 프로세스의 pid. 읽지 못했으면 null */
export type FindMarked = (needle: string) => Promise<number[] | null>;

/**
 * `ps -A -E -o pid=,command=`의 출력(명령행 뒤에 환경이 빈칸으로 이어진다)에서 `needle`이 한 낱말로 든 줄의 pid.
 * 명령행에 같은 글자가 든 프로세스도 잡힌다(표식은 난수라 이번 실행이 띄운 것만 그 글자를 안다)
 */
export function parseMarked(text: string, needle: string): number[] {
  const pids: number[] = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s/.exec(line);
    if (m && ` ${line} `.includes(` ${needle} `)) pids.push(Number(m[1]));
  }
  return pids;
}

/**
 * Linux: `<procDir>/<pid>/environ`(NUL로 나뉜 `이름=값`)에 `needle`이 있는 pid.
 * 읽을 수 없는 프로세스(다른 사용자, 덤프가 막힌 프로세스, 읽는 사이 끝난 프로세스)는 건너뛴다.
 * 폴더 자체를 읽지 못하면 null
 */
export function scanProc(procDir: string, needle: string): number[] | null {
  const names = procPids(procDir);
  if (!names) return null;
  const pids: number[] = [];
  for (const name of names) {
    try {
      const env = readFileSync(`${procDir}/${name}/environ`, 'latin1');
      if (`\0${env}\0`.includes(`\0${needle}\0`)) pids.push(Number(name));
    } catch {
      // 읽을 수 없다
    }
  }
  return pids;
}

/** Linux는 /proc, 그 밖(macOS)은 `ps -E`로 읽는다. 읽지 못하면 `LIST_ATTEMPTS`번까지 다시 읽는다 */
export const findMarked: FindMarked = async (needle) => {
  if (process.platform === 'linux') return scanProc('/proc', needle);
  for (let i = 0; i < LIST_ATTEMPTS; i++) {
    const out = await ps(['-A', '-E', '-o', 'pid=,command='], 256 * 1024 * 1024);
    if (out !== null) return parseMarked(out, needle);
  }
  return null;
};

/**
 * 뿌리 프로세스들의 자손을 기억한다. 뿌리 자신은 넣지 않는다(뿌리와 그 그룹은 부르는 쪽이 따로 다룬다).
 * `refresh`를 부를 때마다 목록을 다시 읽어:
 * - 알던 프로세스 가운데 번호·시작 시각·프로세스 그룹이 그대로인 것만 남긴다. 사라진 번호는 뺀다. 같은 번호가 무관한
 *   프로세스로 다시 쓰였으면(시작 시각이 다르다) 그것을 우리 것으로 보지 않는다
 * - 뿌리와 남은 프로세스의 자식을 새로 더한다(부모가 끝나 다른 부모로 넘어간 프로세스도 이미 알고 있으면 계속 따라간다)
 * - 좀비와 시작 시각을 읽지 못한 프로세스는 뺀다
 * - `marked`를 주면 표식을 가진 프로세스(와 그 자식)도 더한다. 부모가 누구인지와 무관하다. 목록(표식보다 먼저
 *   읽는다)에 있는 것은 그 줄의 시작 시각과 함께 알던 것이 된다
 * - 표식에는 있는데 목록에는 없는 번호(목록을 읽은 뒤에 뜬 프로세스)는 버리지 않고 "아직 목록에서 확인하지 못한 것"으로
 *   들고 있는다. `pids()`에 들어가므로 부르는 쪽은 남은 것이 있다고 본다. 다음에 읽은 목록에 나오고 표식이 다시
 *   확인해 주면 알던 것이 된다. 표식을 다시 읽어 거기 없으면 뺀다. 표식을 읽지 않았거나 읽지 못한 읽기에서는 그대로
 *   들고 있는다
 *
 * 여기서 기억한 프로세스는 세기만 한다. 신호를 보낼 대상을 내주는 메서드는 두지 않는다(파일 머리말)
 */
export class Descendants {
  /** pid → 그 프로세스의 그룹과 시작 시각 */
  private known = new Map<number, { pgid: number; started: string }>();
  /** 표식으로는 봤지만 목록에서는 아직 확인하지 못한 pid */
  private unconfirmed = new Set<number>();
  private readonly list: ListProcesses;
  private readonly marked: (() => Promise<number[] | null>) | undefined;

  /** `marked`: 이번 실행의 표식을 가진 프로세스의 pid를 돌려준다(읽지 못했으면 null). 없으면 표식으로는 찾지 않는다 */
  constructor(list: ListProcesses = listProcesses, marked?: () => Promise<number[] | null>) {
    this.list = list;
    this.marked = marked;
  }

  /**
   * 목록을 다시 읽는다. `roots`에는 아직 떠 있는 뿌리만 준다(끝난 뒤의 번호는 다른 프로세스일 수 있다).
   * `byMark`가 참이면 표식으로도 찾는다(정리할 때 쓴다).
   * 다 읽었으면 true. 목록을 읽지 못했으면 false이고 알던 것은 그대로 둔다. 목록은 읽었지만 표식을 읽지 못했으면
   * 부모·자식 관계로 찾은 데까지 반영하고 false다(없다고 확인하지 못했다)
   */
  async refresh(roots: readonly number[] = [], byMark = false): Promise<boolean> {
    const rows = await this.list();
    if (!rows) return false;
    // undefined: 표식으로 찾지 않았다. null: 찾으려 했지만 읽지 못했다
    const tagged = byMark && this.marked ? await this.marked() : undefined;
    /** 이번 읽기에서 표식을 가진 것으로 확인된 pid. 표식을 읽지 않았거나 읽지 못했으면 null */
    const fresh = tagged ? new Set(tagged) : null;
    const skip = (pid: number) => pid === process.pid || roots.includes(pid);
    const next = new Map<number, { pgid: number; started: string }>();
    const listed = new Set<number>();
    const children = new Map<number, ProcessRow[]>();
    for (const r of rows) {
      listed.add(r.pid);
      // 시작 시각을 모르는 프로세스는 어느 프로세스인지 묶어 둘 수 없다
      if (r.zombie || !r.started) continue;
      const siblings = children.get(r.ppid);
      if (siblings) siblings.push(r);
      else children.set(r.ppid, [r]);
      if (skip(r.pid)) continue;
      const was = this.known.get(r.pid);
      const same = was !== undefined && was.started === r.started && was.pgid === r.pgid;
      // 전에 표식으로만 본 번호는 여기서 쓰지 않는다: 이번 표식(fresh)이 확인해 준 것만 알던 것이 된다
      if (same || fresh?.has(r.pid)) next.set(r.pid, { pgid: r.pgid, started: r.started });
    }
    const queue = [...next.keys(), ...roots];
    while (queue.length) {
      const parent = queue.pop()!;
      for (const c of children.get(parent) ?? []) {
        // 이 프로세스와 그 자식(목록을 읽는 ps 등)은 verify가 띄운 것의 자손이 아니다
        if (c.pid === process.pid || roots.includes(c.pid) || next.has(c.pid)) continue;
        next.set(c.pid, { pgid: c.pgid, started: c.started });
        queue.push(c.pid);
      }
    }
    const unconfirmed = new Set<number>();
    // 표식을 읽었으면: 표식에는 있고 목록에는 없는 것(목록을 읽은 뒤에 떴을 수 있다)을 버리지 않는다.
    // 읽지 않았거나 읽지 못했으면: 전에 표식으로만 본 번호가 끝났는지 모르므로 그대로 들고 있는다
    for (const pid of fresh ?? this.unconfirmed) {
      if (skip(pid) || next.has(pid)) continue;
      if (fresh && listed.has(pid)) continue;
      unconfirmed.add(pid);
    }
    this.known = next;
    this.unconfirmed = unconfirmed;
    return tagged !== null;
  }

  /**
   * 남은 것으로 세는 pid: 마지막으로 읽은 목록에 있던 자손과, 표식으로만 보고 아직 끝났다고 확인하지 못한 것.
   * 비어 있어야 남은 것이 없다
   */
  pids(): number[] {
    return [...this.known.keys(), ...this.unconfirmed].sort((a, b) => a - b);
  }
}
