// verify가 띄운 것(dev, 실행기)의 자손을 프로세스 그룹과 무관하게 따라간다(설계서 11.1절, 계획 20261119-pilot-prep
// 수용 기준 4). verify의 정리는 dev와 실행기의 프로세스 그룹에 신호를 보내고 그룹이 빈 것을 확인한다. Playwright는
// 브라우저를 새 프로세스 그룹으로 띄우므로 그것만으로는 브라우저가 끝났는지 알 수 없다(실행기를 SIGKILL로 끝내면
// 브라우저를 닫아 줄 것이 없다). 그래서 도는 동안 프로세스 목록에서 자손을 찾아 기억하고, 정리할 때 그 프로세스들에도
// 신호를 보내고 모두 사라진 것을 확인한다.
//
// 찾는 방법은 둘이다.
// 1. 부모·자식 관계: 프로세스 목록에서 뿌리(dev, 실행기)와 이미 아는 프로세스의 자식을 따라간다. 주기적으로 읽는다.
//    부모가 먼저 끝나 다른 부모로 넘어간 프로세스는, 그 전에 한 번이라도 봤어야 계속 따라갈 수 있다.
// 2. 표식: verify는 dev와 실행기에 이번 실행만의 환경 변수(HARNESS_VERIFY_RUN=<난수>)를 준다. 환경은 자손에게
//    물려지므로, 부모가 누구든 그 표식을 가진 프로세스는 이번 실행이 띄운 것이다. 한 번도 보지 못한 채 부모를 잃은
//    프로세스(목록을 읽는 사이에 브라우저가 뜨고 실행기가 죽은 경우)도 이것으로 찾는다. 정리할 때 읽는다.
//
// 한계: 환경을 읽을 수 없거나(Linux에서 다른 사용자나 덤프가 막힌 프로세스) 표식을 지운 프로세스가, 목록을 읽는
// 사이(주기는 web.ts)에 띄워지고 그 부모가 곧바로 끝나면 놓칠 수 있다.
import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** 끝났지만 부모가 아직 거두지 않았다. 남은 프로세스로 세지 않는다 */
  zombie: boolean;
}

/** 지금 떠 있는 프로세스의 목록. 읽지 못했으면 null */
export type ListProcesses = () => Promise<ProcessRow[] | null>;

/**
 * `ps -A -o pid=,ppid=,pgid=,stat=`의 출력을 읽는다.
 * 읽지 못한 줄이 하나라도 있으면 목록 전체를 버린다(일부만 믿고 "남은 것이 없다"고 하지 않는다)
 */
export function parseProcessList(text: string): ProcessRow[] | null {
  const rows: ProcessRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    // 상태 칸은 빈칸 없는 글자열이면 받는다. macOS는 막 생기거나 끝나는 중인 프로세스를 ?·?E로 적는다
    // (그런 프로세스가 하나만 있어도 목록 전체를 버리면 프로세스가 자주 바뀌는 동안에는 읽지 못한다)
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) return null;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      zombie: m[4].startsWith('Z'),
    });
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

/** ps를 한 번 돌려 읽는다(POSIX의 -A와 -o만 쓴다). ps가 없거나 실패하거나 제때 끝나지 않으면 null */
const listOnce: ListProcesses = () =>
  new Promise((resolve) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid=,pgid=,stat='],
      { timeout: LIST_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : parseProcessList(stdout)),
    );
  });

/** ps로 읽는다. 읽지 못하면 `LIST_ATTEMPTS`번까지 다시 읽는다 */
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
  let names: string[];
  try {
    names = readdirSync(procDir);
  } catch {
    return null;
  }
  const pids: number[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
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
    const found = await new Promise<number[] | null>((resolve) => {
      execFile(
        'ps',
        ['-A', '-E', '-o', 'pid=,command='],
        { timeout: LIST_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 256 * 1024 * 1024 },
        (err, stdout) => resolve(err ? null : parseMarked(stdout, needle)),
      );
    });
    if (found) return found;
  }
  return null;
};

/**
 * 뿌리 프로세스들의 자손을 기억한다. 뿌리 자신은 넣지 않는다(뿌리와 그 그룹은 부르는 쪽이 따로 다룬다).
 * `refresh`를 부를 때마다 목록을 다시 읽어:
 * - 알던 프로세스 가운데 pid와 프로세스 그룹이 그대로인 것만 남긴다. 사라진 pid는 뺀다. 같은 번호가 무관한 프로세스로
 *   다시 쓰였을 때(그룹이 다르다) 그것을 우리 것으로 보지 않는다
 * - 뿌리와 남은 프로세스의 자식을 새로 더한다(부모가 끝나 다른 부모로 넘어간 프로세스도 이미 알고 있으면 계속 따라간다)
 * - 좀비는 뺀다
 * - `marked`를 주면 표식을 가진 프로세스(와 그 자식)도 더한다. 부모가 누구인지와 무관하다
 * - 목록과 표식은 다른 시점에 읽는다. 표식에는 있는데 목록에는 없는 pid(목록을 읽은 뒤에 뜬 프로세스)는 버리지 않고
 *   "아직 목록에서 확인하지 못한 것"으로 들고 있는다. `pids()`에 들어가므로 부르는 쪽은 남은 것이 있다고 본다
 * - 표식으로만 본 pid는 번호 말고 아는 것이 없다(그룹을 모른다). 그 프로세스가 끝나고 무관한 프로세스가 같은 번호를
 *   받을 수 있으므로, **이번 읽기의 표식이 다시 확인해 준 것만** 끝낼 대상(`targets()`)이고 알던 것으로 옮긴다.
 *   표식을 읽지 않았거나 읽지 못한 읽기에서는 목록에 그 번호가 나와도 옮기지 않고, 끝낼 대상에서도 뺀다.
 *   남은 것으로는 계속 센다(끝났다고 확인하지 못했다). 표식을 다시 읽어 거기 없으면 뺀다
 */
export class Descendants {
  /** pid → 프로세스 그룹 */
  private known = new Map<number, number>();
  /** 표식으로는 봤지만 목록에서는 아직 확인하지 못한 pid */
  private unconfirmed = new Set<number>();
  /** 그 가운데 마지막 읽기의 표식이 확인해 준 pid */
  private verified = new Set<number>();
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
    if (!rows) {
      // 표식으로만 본 것이 지금도 그 프로세스인지 확인하지 못했다
      this.verified = new Set();
      return false;
    }
    // undefined: 표식으로 찾지 않았다. null: 찾으려 했지만 읽지 못했다
    const tagged = byMark && this.marked ? await this.marked() : undefined;
    /** 이번 읽기에서 표식을 가진 것으로 확인된 pid. 표식을 읽지 않았거나 읽지 못했으면 null */
    const fresh = tagged ? new Set(tagged) : null;
    const skip = (pid: number) => pid === process.pid || roots.includes(pid);
    const next = new Map<number, number>();
    const listed = new Set<number>();
    const children = new Map<number, ProcessRow[]>();
    for (const r of rows) {
      listed.add(r.pid);
      if (r.zombie) continue;
      const siblings = children.get(r.ppid);
      if (siblings) siblings.push(r);
      else children.set(r.ppid, [r]);
      if (skip(r.pid)) continue;
      // 전에 표식으로만 본 번호는 여기서 쓰지 않는다: 이번 표식(fresh)이 확인해 준 것만 알던 것이 된다
      if (this.known.get(r.pid) === r.pgid || fresh?.has(r.pid)) next.set(r.pid, r.pgid);
    }
    const queue = [...next.keys(), ...roots];
    while (queue.length) {
      const parent = queue.pop()!;
      for (const c of children.get(parent) ?? []) {
        // 이 프로세스와 그 자식(목록을 읽는 ps 등)은 우리가 끝낼 대상이 아니다
        if (c.pid === process.pid || roots.includes(c.pid) || next.has(c.pid)) continue;
        next.set(c.pid, c.pgid);
        queue.push(c.pid);
      }
    }
    const unconfirmed = new Set<number>();
    const verified = new Set<number>();
    if (fresh) {
      // 표식에는 있고 목록에는 없다: 목록을 읽은 뒤에 떴을 수 있다. 버리지 않는다(구현 판정 3라운드 F2).
      // 방금 표식으로 확인했으니 끝낼 대상이다
      for (const pid of fresh) {
        if (listed.has(pid) || skip(pid)) continue;
        unconfirmed.add(pid);
        verified.add(pid);
      }
    } else {
      // 표식을 읽지 않았거나 읽지 못했다: 전에 표식으로만 본 번호가 끝났는지도, 아직 그 프로세스인지도 모른다.
      // 남은 것으로 세되 끝낼 대상으로는 삼지 않는다(구현 판정 4라운드 F6)
      for (const pid of this.unconfirmed) if (!next.has(pid) && !skip(pid)) unconfirmed.add(pid);
    }
    this.known = next;
    this.unconfirmed = unconfirmed;
    this.verified = verified;
    return tagged !== null;
  }

  /**
   * 남은 것으로 세는 pid: 마지막으로 읽은 목록에 있던 자손과, 표식으로만 보고 아직 끝났다고 확인하지 못한 것.
   * 비어 있어야 남은 것이 없다
   */
  pids(): number[] {
    return [...this.known.keys(), ...this.unconfirmed].sort((a, b) => a - b);
  }

  /**
   * 신호를 보낼 pid: 목록에서 확인한 자손과, 표식으로만 본 것 가운데 마지막 읽기의 표식이 확인해 준 것.
   * `pids()`에는 있고 여기에는 없는 것은 우리 것인지 확인하지 못한 번호다
   */
  targets(): number[] {
    return [...this.known.keys(), ...this.verified].sort((a, b) => a - b);
  }
}
