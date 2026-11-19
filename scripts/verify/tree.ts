// verify가 띄운 것(dev, 실행기)의 자손을 프로세스 그룹과 무관하게 따라간다(설계서 11.1절, 계획 20261119-pilot-prep
// 수용 기준 4). verify의 정리는 dev와 실행기의 프로세스 그룹에 신호를 보내고 그룹이 빈 것을 확인한다. Playwright는
// 브라우저를 새 프로세스 그룹으로 띄우므로 그것만으로는 브라우저가 끝났는지 알 수 없다(실행기를 SIGKILL로 끝내면
// 브라우저를 닫아 줄 것이 없다). 그래서 도는 동안 프로세스 목록에서 자손을 찾아 기억하고, 정리할 때 그 프로세스들에도
// 신호를 보내고 모두 사라진 것을 확인한다.
//
// 한계: 목록을 읽는 사이(주기는 web.ts)에 띄워지고 그 부모가 곧바로 끝난 프로세스는 놓칠 수 있다.
import { execFile } from 'node:child_process';

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

/**
 * 뿌리 프로세스들의 자손을 기억한다. 뿌리 자신은 넣지 않는다(뿌리와 그 그룹은 부르는 쪽이 따로 다룬다).
 * `refresh`를 부를 때마다 목록을 다시 읽어:
 * - 알던 프로세스 가운데 pid와 프로세스 그룹이 그대로인 것만 남긴다. 사라진 pid는 뺀다. 같은 번호가 무관한 프로세스로
 *   다시 쓰였을 때(그룹이 다르다) 그것을 우리 것으로 보지 않는다
 * - 뿌리와 남은 프로세스의 자식을 새로 더한다(부모가 끝나 다른 부모로 넘어간 프로세스도 이미 알고 있으면 계속 따라간다)
 * - 좀비는 뺀다
 */
export class Descendants {
  /** pid → 프로세스 그룹 */
  private known = new Map<number, number>();
  private readonly list: ListProcesses;

  constructor(list: ListProcesses = listProcesses) {
    this.list = list;
  }

  /**
   * 목록을 다시 읽는다. `roots`에는 아직 떠 있는 뿌리만 준다(끝난 뒤의 번호는 다른 프로세스일 수 있다).
   * 읽지 못했으면 false이고 알던 것은 그대로 둔다
   */
  async refresh(roots: readonly number[] = []): Promise<boolean> {
    const rows = await this.list();
    if (!rows) return false;
    const next = new Map<number, number>();
    const children = new Map<number, ProcessRow[]>();
    for (const r of rows) {
      if (r.zombie) continue;
      const siblings = children.get(r.ppid);
      if (siblings) siblings.push(r);
      else children.set(r.ppid, [r]);
      if (this.known.get(r.pid) === r.pgid) next.set(r.pid, r.pgid);
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
    this.known = next;
    return true;
  }

  /** 지금 알고 있는(마지막으로 읽은 목록에 있던) 자손의 pid */
  pids(): number[] {
    return [...this.known.keys()].sort((a, b) => a - b);
  }
}
