// verify 표준 명령의 웹 구현(설계서 11.1절): 거부 프록시와 dev를 띄우고, 시나리오 실행기를 돌리고, 판정하고, 정리하고,
// 공개 증거 요약(evidence/)과 진단 파일(local/detail.json)을 남긴다.
//
//   node scripts/verify/web.ts [e2e/<시나리오>.spec.ts …]
//
// 실행기(Playwright)는 명령(인자 배열)으로만 다룬다. 이 파일은 실행기 패키지를 import하지 않는다.
// 실행기 명령, 설정 파일 경로, 앱 주소는 환경 변수·명령행 인자·설정 파일로 바꿀 수 없다(검사를 약화시키는 길이 된다).
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { FORWARDED, killTree, tail } from '../lib/exec.ts';
import { repoInfo } from '../lib/git.ts';
import { startDenyProxy, type DeniedRequest, type DenyProxy } from './deny-proxy.ts';
import { buildEvidence } from './evidence.ts';
import { isScenarioPath, judge, type Verdict } from './judge.ts';
import {
  Descendants,
  findMarked,
  identify,
  listProcesses,
  RUN_MARK,
  type FindMarked,
  type Identify,
  type ListProcesses,
} from './tree.ts';

/** 시나리오 실행기. 인자를 더 붙이지 않는다(시나리오는 환경 변수로 넘긴다) */
export const DEFAULT_RUNNER: string[] = [
  'node',
  'node_modules/@playwright/test/cli.js',
  'test',
  '--config',
  'profiles/web/verify/playwright.config.ts',
];

export const OUT_DIR = '.harness-verify';
const HOST = '127.0.0.1';
/** 정리: SIGTERM 뒤 이만큼 기다리고 SIGKILL을 보낸다 */
const TERM_GRACE_MS = 2000;
/** 정리: SIGKILL 뒤 끝난 것을 확인하는 시간. 둘을 더해도 중단 신호부터 4초 안이다(프로세스 목록을 읽는 시간은 따로 든다) */
const KILL_CONFIRM_MS = 1500;
/** 도는 동안 dev와 실행기의 자손(브라우저 등)을 찾아 두는 주기 */
const FOLLOW_MS = 250;

export interface VerifyOptions {
  runner?: string[];
  /** 실행할 시나리오 파일(리포 기준 상대 경로). 없으면 전부 */
  scenarios?: string[];
  /** 기본 120 */
  readyTimeoutSec?: number;
  /** 기본 900 */
  runnerTimeoutSec?: number;
  /** 중단 신호. 끊기면 띄운 것을 정리하고 실패로 돌아간다 */
  signal?: AbortSignal;
  /** 프로세스 목록을 읽는 수단(dev와 실행기가 다른 프로세스 그룹에 띄운 것을 찾는다). 기본은 ps. 테스트가 바꾼다 */
  listProcesses?: ListProcesses;
  /** 이번 실행의 표식(환경 변수)을 가진 프로세스를 찾는 수단. 기본은 ps -E(Linux는 /proc). 테스트가 바꾼다 */
  findMarked?: FindMarked;
  /** 번호들의 지금 시작 시각을 읽는 수단(신호를 보내기 직전의 확인). 기본은 ps(Linux는 /proc). 테스트가 바꾼다 */
  identify?: Identify;
}

export interface VerifyResult {
  ok: boolean;
  outDir: string;
  baseUrl: string;
  verdict: Verdict;
  /** 거부 프록시에 닿은 요청(앱 주소 밖으로 가려던 것). 하나라도 있으면 실패다 */
  denied: { count: number; requests: DeniedRequest[] };
  /** PR에 올릴 수 있는 요약 묶음(`<outDir>/evidence/`). 출력 폴더를 만들지 못했거나 묶음을 만들지 못했으면 null */
  evidence: { dir: string; files: string[] } | null;
}

const failed = (problem: string): Verdict => ({ ok: false, scenarios: [], problems: [problem] });
const noDenied = (): VerifyResult['denied'] => ({ count: 0, requests: [] });
const ABORTED = '중단 신호를 받았다';

/** 문제 문구에 적는 대상 수 */
const DENIED_SHOWN = 20;
/** 거부 프록시에 닿은 요청의 문제 문구. 대상(호스트:포트)은 한 번씩만 적는다 */
function deniedProblem(d: VerifyResult['denied']): string {
  const targets = [...new Set(d.requests.map((r) => `${r.host}:${r.port}`))];
  const more = targets.length > DENIED_SHOWN ? ` 외 ${targets.length - DENIED_SHOWN}곳` : '';
  return `앱 주소 밖으로 가려는 요청 ${d.count}건: ${targets.slice(0, DENIED_SHOWN).join(', ')}${more}`;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 이 플랫폼에서 verify를 돌릴 수 없으면 이유를, 돌릴 수 있으면 null을 돌려준다.
 * 정리 계약은 프로세스 그룹에 기댄다: dev와 실행기를 각자의 그룹으로 띄우고, 그룹에 신호를 보내고, 그룹이 빈 것을 확인한다
 * (dev와 실행기가 다른 그룹에 띄운 것, 곧 브라우저는 프로세스 목록에서 따라간다: tree.ts).
 * Windows에는 이것이 없다. 부모가 먼저 끝나면 남은 자식(브라우저 등)을 찾을 길이 없어(taskkill /T는 살아 있는 부모에서만
 * 내려간다) 프로세스가 남았는데도 정리됐다고 판정하게 된다. 그래서 띄우지 않고 실패한다(구현 판정 F1)
 */
export function unsupportedPlatform(platform: NodeJS.Platform): string | null {
  return platform === 'win32'
    ? 'Windows에서는 verify를 지원하지 않는다: 띄운 프로세스 트리(dev, 실행기, 브라우저)가 모두 끝났는지 확인할 수단(프로세스 그룹)이 없다. macOS나 Linux(CI 포함)에서 실행하라'
    : null;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 127.0.0.1의 빈 포트 하나 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('포트를 받지 못했다'))));
    });
  });
}

/** HTTP 응답이 한 번 오는가(상태 코드 무관). 중단 신호가 오면 기다리지 않고 거짓으로 끝난다 */
function responds(url: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1000, signal }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/** 띄운 프로세스와 그 종료를 쥔다 */
interface Proc {
  child: ChildProcess;
  /** 끝났으면 종료 코드(신호로 끝났으면 128, 띄우지 못했으면 127) */
  code: number | null;
  exited: Promise<void>;
}

/** 자기 프로세스 그룹으로 띄운다(정리할 때 그룹 전체에 신호를 보낸다). 출력은 `log`(열어 둔 파일)로 보낸다 */
function start(
  cmd: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean; log: number },
): Proc {
  const child = spawn(cmd, args, {
    cwd: o.cwd,
    env: o.env,
    shell: o.shell,
    detached: true,
    stdio: ['ignore', o.log, o.log],
  });
  const proc: Proc = { child, code: null, exited: Promise.resolve() };
  proc.exited = new Promise<void>((resolve) => {
    child.once('error', () => {
      proc.code ??= 127;
      resolve();
    });
    child.once('exit', (code, signal) => {
      proc.code ??= code ?? (signal ? 128 : 1);
      resolve();
    });
  });
  return proc;
}

/**
 * 프로세스 그룹에 남은 프로세스가 있는가. 그룹의 첫 프로세스가 끝난 뒤에도 남은 자식을 본다.
 * 스스로 다른 그룹·세션으로 옮겨 간 자손(setsid)은 보지 못한다(표준 명령 실행기 `lib/exec.ts`와 같은 한계)
 */
function treeAlive(p: Proc): boolean {
  const pid = p.child.pid;
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    // EPERM: 있지만 신호를 보낼 수 없다(남은 것으로 본다). ESRCH: 없다
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 아직 떠 있는 것의 pid. 끝난 것의 pid는 뿌리로 쓰지 않는다(다른 프로세스가 그 번호를 다시 쓸 수 있다) */
const running = (procs: readonly Proc[]): number[] =>
  procs.flatMap((p) => (p.code === null && p.child.pid ? [p.child.pid] : []));

/**
 * 도는 동안 띄운 것(`procs`: dev, 실행기. 나중에 더해도 된다)의 자손을 주기적으로 찾아 둔다.
 * 돌려준 함수를 부르면 멈추고, 돌고 있던 읽기가 끝난 뒤 돌아간다
 */
function follow(tracker: Descendants, procs: readonly Proc[]): () => Promise<void> {
  let on = true;
  let wake = () => {};
  const loop = (async () => {
    while (on) {
      await tracker.refresh(running(procs));
      if (!on) break;
      let timer: NodeJS.Timeout | undefined;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, FOLLOW_MS);
      });
      clearTimeout(timer);
    }
  })();
  return async () => {
    on = false;
    wake();
    await loop;
  };
}

/** 정리하는 동안 그룹 밖의 자손이 남았는지 다시 보는 간격 */
const RECHECK_MS = 50;
/**
 * 남은 것이 없다고 이어서 몇 번 봐야 끝났다고 하는가. 프로세스 목록과 표식 읽기는 순간 사진이 아니라(읽는 사이에
 * 뜨고 그 부모가 끝난 프로세스는 한 번의 읽기에서 빠질 수 있다) 한 번 비어 보인 것으로는 끝났다고 하지 않는다
 */
const CLEAR_LOOKS = 2;
/** 그룹 밖의 자손에 신호를 처음 보낸 뒤, 기한이 지났어도 그것이 끝나는 것을 보려고 더 두는 시간 */
const SETTLE_MS = 500;
/** 그렇게 늘릴 수 있는 한도(신호 단계 하나의 기한에 더한다). 새 자손이 끝없이 나와도 여기서 멈춘다 */
const SETTLE_MAX_MS = 3000;

/** clean: 모두 끝났다. left: 남은 것이 있다. unknown: 프로세스 목록을 읽지 못해 남은 것이 없는지 확인하지 못했다 */
type Cleaned = 'clean' | 'left' | 'unknown';

/**
 * 정리 계약: 띄운 트리를 모두 끝내고 끝난 것을 확인한 뒤 돌아간다.
 * 대상은 dev와 실행기의 프로세스 그룹, 그리고 그 둘이 다른 그룹에 띄운 자손(`tracker`가 따라간 브라우저 등)이다.
 * 모두에 SIGTERM → 2초 안에 끝나지 않으면 SIGKILL → 확인.
 * 신호를 보내기 전에, 아직 떠 있는 dev와 실행기의 자손을 마지막으로 한 번 더 찾는다
 */
async function cleanup(procs: Proc[], tracker: Descendants, startedOf: Identify): Promise<Cleaned> {
  const live = procs.filter((p) => p.child.pid);
  /** 마지막으로 본 것이 온전한가(목록과 표식을 모두 읽었는가) */
  let seen = false;
  /** 그룹 밖의 자손을 다시 찾는다: 부모·자식 관계와 이번 실행의 표식 둘 다로 */
  const look = async () => {
    seen = await tracker.refresh(running(procs), true);
  };
  /**
   * 방금 본 그룹 밖 자손 가운데 이 신호를 아직 받지 않은 것에 보낸다. 보낸 수를 돌려준다.
   * 신호는 번호가 아니라 확인한 프로세스(번호와 시작 시각)에 묶는다: 보내기 직전에 그 번호의 시작 시각을 다시 읽어,
   * 기억한 것과 같을 때만 보낸다(그 프로세스가 끝나고 무관한 프로세스가 같은 번호를 받았으면 보내지 않는다.
   * 구현 판정 F6). 다시 읽지 못했으면 아무것에도 보내지 않는다. 다시 읽기와 보내기 사이에는 기다림을 두지 않는다
   */
  const signalNew = async (signal: NodeJS.Signals, sent: Map<number, string>): Promise<number> => {
    const targets = tracker.targets();
    // 사라졌거나 다른 프로세스가 된 번호는 잊는다
    for (const [pid, started] of sent)
      if (!targets.some((t) => t.pid === pid && t.started === started)) sent.delete(pid);
    const fresh = targets.filter((t) => sent.get(t.pid) !== t.started);
    if (fresh.length === 0) return 0;
    const now = await startedOf(fresh.map((t) => t.pid));
    if (!now) return 0;
    let count = 0;
    for (const t of fresh) {
      if (now.get(t.pid) !== t.started) continue;
      sent.set(t.pid, t.started);
      try {
        process.kill(t.pid, signal);
        count++;
      } catch {
        // 이미 끝났다
      }
    }
    return count;
  };
  /** 신호를 보낸 프로세스가 모두 사라질 때까지(같은 번호·시작 시각이 더는 없다) `ms`까지 기다린다 */
  const settle = async (sent: Map<number, string>, ms: number): Promise<void> => {
    const until = Date.now() + ms;
    for (;;) {
      const now = await startedOf([...sent.keys()]);
      if (now && ![...sent].some(([pid, started]) => now.get(pid) === started)) return;
      if (Date.now() >= until) return;
      await sleep(25);
    }
  };
  /**
   * 그룹에 `signal`을 보내고 `ms` 동안 모두 사라지기를 기다린다. 참이면 남은 것이 없다.
   * 기다리는 동안 볼 때마다, 그때 찾은 그룹 밖 자손에도 보낸다. 신호를 보낸 뒤에 처음 찾은 것(분리된 중간 프로세스가
   * 자손을 남기고 끝난 경우)도 받는다(구현 판정 4라운드 F2).
   * 신호를 보낸 바로 뒤에는 돌아가지 않는다(신호 전달은 종료를 기다리지 않는다. 5라운드 F2): 기한이 지났어도 방금
   * 처음 보낸 것이 있으면 `SETTLE_MS`씩 더 보고(모두 `SETTLE_MAX_MS`까지), 그 한도에서도 방금 보낸 것이 있으면
   * 그것이 사라지는 것을 `SETTLE_MS`까지 기다린 뒤 돌아간다
   */
  const sweep = async (signal: NodeJS.Signals, ms: number): Promise<boolean> => {
    let until = Date.now() + ms;
    const hardStop = until + SETTLE_MAX_MS;
    const sent = new Map<number, string>();
    let clear = 0;
    // 이미 끝난 것은 빼고(번호가 다시 쓰였을 수 있다) 지금 떠 있는 것에만 보낸다.
    // 목록을 읽지 못해도 멈추지 않는다: 그룹과, 마지막으로 목록에서 확인한 자손(시작 시각이 그대로인 것)에는
    // 보낸다(구현 판정 F5)
    await look();
    for (const p of live) killTree(p.child.pid, signal);
    for (;;) {
      const newly = await signalNew(signal, sent);
      const groups = live.some(treeAlive);
      // 그룹 밖의 자손이 남았는지는 프로세스 목록과 표식으로만 알 수 있다. 읽지 못했으면 끝났다고 보지 않고
      // 기다린다(다음에는 읽힐 수 있다. 끝내 못 읽으면 unknown이다). 어느 프로세스인지 모르는 번호도 남은 것이다
      clear = !groups && seen && tracker.pids().length === 0 ? clear + 1 : 0;
      if (clear >= CLEAR_LOOKS) return true;
      const now = Date.now();
      if (newly > 0) until = Math.min(hardStop, Math.max(until, now + SETTLE_MS));
      if (now >= until) {
        if (newly > 0) await settle(sent, SETTLE_MS);
        return false;
      }
      await sleep(groups ? 25 : RECHECK_MS);
      await look();
    }
  };
  if (await sweep('SIGTERM', TERM_GRACE_MS)) return 'clean';
  if (await sweep('SIGKILL', KILL_CONFIRM_MS)) return 'clean';
  if (live.some(treeAlive)) return 'left';
  return seen ? 'left' : 'unknown';
}

/**
 * 이번 실행의 출력 폴더 `<root>/.harness-verify/<YYYYMMDD-HHMMSS>-<pid>/`를 새로 만든다.
 * 이미 있으면 뒤에 번호를 붙인다: 앞 실행의 결과 파일(report.json)을 이번 결과로 읽지 않게 한다.
 * `.harness-verify` 자리가 실제 폴더가 아니면(리포에 커밋된 심볼릭 링크 등) 만들지 않는다: 리포 밖에 쓰게 된다
 */
function makeOutDir(root: string): { outDir: string } | { problem: string } {
  const base = path.join(root, OUT_DIR);
  mkdirSync(base, { recursive: true });
  if (!lstatSync(base).isDirectory() || realpathSync(base) !== base)
    return { problem: `${OUT_DIR}가 실제 폴더가 아니다(심볼릭 링크). 지우고 다시 실행하라` };
  const name = `${stamp(new Date())}-${process.pid}`;
  for (let i = 0; i < 1000; i++) {
    const outDir = path.join(base, i ? `${name}-${i}` : name);
    try {
      mkdirSync(outDir);
      return { outDir };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  return { problem: `${OUT_DIR} 아래에 새 출력 폴더를 만들지 못했다` };
}

/** 지정한 시나리오 경로를 확인한다. 문제가 있으면 이유를 돌려준다. 중복은 하나로 본다 */
function checkScenarios(
  root: string,
  scenarios: string[],
): { scenarios: string[] } | { problem: string } {
  const unique = [...new Set(scenarios)];
  for (const p of unique) {
    if (!isScenarioPath(p))
      return {
        problem:
          '시나리오 경로가 아니다(e2e/로 시작하고 .spec.ts로 끝나며 영문자·숫자·._-/만 쓰는 상대 경로): ' +
          JSON.stringify(p),
      };
    const abs = path.join(root, p);
    const st = lstatSync(abs, { throwIfNoEntry: false });
    if (!st) return { problem: `시나리오 파일이 없다: ${p}` };
    if (!st.isFile())
      return { problem: `시나리오 경로가 일반 파일이 아니다(폴더·심볼릭 링크): ${p}` };
    // 상위 폴더가 심볼릭 링크인 경우도 막는다
    if (realpathSync(abs) !== abs)
      return { problem: `시나리오 경로에 심볼릭 링크가 끼어 있다: ${p}` };
  }
  return { scenarios: unique };
}

/** 결과 파일 크기 한도. 관찰 기록만 본문으로 붙으므로(스크린샷 등은 경로로 붙는다) 넉넉한 값이다 */
const MAX_REPORT_BYTES = 64 * 1024 * 1024;

/** 열어 둔 일반 파일을 `start`부터 끝까지 읽는다 */
function readFd(fd: number, start: number, end: number): string {
  const buf = Buffer.alloc(end - start);
  let off = 0;
  while (off < buf.length) {
    const n = readSync(fd, buf, off, buf.length - off, start + off);
    if (n === 0) break;
    off += n;
  }
  return buf.subarray(0, off).toString('utf8');
}

/**
 * 실행기가 쓴 결과 파일을 읽는다. 결과 파일은 PR의 코드가 만든 것이라 그냥 열지 않는다:
 * 쓰는 쪽이 없는 FIFO를 열면 프로세스가 멈춰 시간 제한도 정리도 돌지 못한다(구현 판정 F2).
 * 막히지 않게 열고(O_NONBLOCK), 심볼릭 링크는 따라가지 않고(O_NOFOLLOW), 연 파일이 일반 파일이고 한도보다 작을 때만 읽는다
 */
function readReport(file: string): { report: unknown } | { problem: string } {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? { problem: '실행기가 결과 파일(report.json)을 쓰지 않았다' }
      : { problem: '결과 파일(report.json)을 열지 못했다(심볼릭 링크이거나 읽을 수 없다)' };
  }
  let raw: string;
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { problem: '결과 파일(report.json)이 일반 파일이 아니다' };
    if (st.size > MAX_REPORT_BYTES)
      return { problem: `결과 파일(report.json)이 너무 크다(${MAX_REPORT_BYTES}바이트 초과)` };
    raw = readFd(fd, 0, st.size);
  } catch {
    return { problem: '결과 파일(report.json)을 읽지 못했다' };
  } finally {
    closeSync(fd);
  }
  try {
    return { report: JSON.parse(raw) as unknown };
  } catch {
    return { problem: '결과 파일(report.json)을 JSON으로 읽지 못했다' };
  }
}

/** 열어 둔 로그 파일의 끝부분. 경로로 다시 열지 않는다(그 자리의 파일이 바뀌었을 수 있다) */
function logTail(fd: number): string {
  try {
    const size = fstatSync(fd).size;
    return tail(readFd(fd, Math.max(0, size - 16_384), size), 20);
  } catch {
    // 조용히 비우지 않는다: 읽지 못한 것과 출력이 없는 것은 다르다
    return '(로그를 읽지 못했다)';
  }
}

/**
 * 앱을 띄워 시나리오를 돌리고 판정한다. 돌아가기 전에 띄운 것(dev와 실행기의 프로세스 트리)을 모두 끝낸다:
 * 정상 종료, 판정 실패, 예외, 실행기 시간 초과, 중단 신호 어느 경우에도 같다.
 */
export async function verifyWeb(
  root: string,
  cfg: HarnessConfig,
  o: VerifyOptions = {},
): Promise<VerifyResult> {
  const early = (problem: string): VerifyResult => ({
    ok: false,
    outDir: '',
    baseUrl: '',
    verdict: failed(problem),
    denied: noDenied(),
    evidence: null,
  });
  const unsupported = unsupportedPlatform(process.platform);
  if (unsupported) return early(unsupported);
  // 보고서의 config.rootDir는 실행기가 본 실제 경로다. 심볼릭 링크를 낀 경로를 그대로 쓰면 리포 기준 경로가 어긋난다
  root = realpathSync(root);
  const made = makeOutDir(root);
  if ('problem' in made) return early(made.problem);
  const outDir = made.outDir;
  const local = path.join(outDir, 'local');
  mkdirSync(local);
  const startedAt = new Date().toISOString();
  // 진단 파일은 아무것도 띄우기 전에 새로 만들어 열어 두고 끝에 이 fd로 쓴다(로그 파일과 같은 이유:
  // dev나 실행기가 그 자리를 링크나 FIFO로 바꿔도 따라가지 않는다)
  const detailFd = openSync(path.join(local, 'detail.json'), 'wx');
  /**
   * 마무리: 프록시 기록을 판정에 반영하고, 진단 파일(local/detail.json)과 공개 증거 요약(evidence/)을 남긴다.
   * 띄운 것을 모두 끝낸 뒤에만 부른다
   */
  const finish = (baseUrl: string, judged: Verdict, denied = noDenied()): VerifyResult => {
    let verdict = judged;
    const fail = (problem: string) => {
      verdict = {
        ok: false,
        scenarios: verdict.scenarios,
        problems: [...verdict.problems, problem],
      };
    };
    // 판정은 여기서 한 번 정해지고 반환값·진단 파일·공개 요약·명령행의 종료 코드가 모두 이것을 쓴다.
    // 이 함수는 기다리는 곳이 없어 도중에 중단 신호의 상태가 바뀌지 않는다.
    // 통과로 판정한 뒤 정리하는 동안 온 중단 신호도 실패다(구현 판정 F2)
    if (o.signal?.aborted && !verdict.problems.some((p) => p.startsWith(ABORTED))) fail(ABORTED);
    // 관찰 기록의 allowed와 무관하다: 프록시에 닿은 것은 시나리오 코드가 뺄 수 없다
    if (denied.count) fail(deniedProblem(denied));
    /** 지금의 판정으로 진단 파일을 처음부터 다시 쓴다 */
    const writeDetail = (): boolean => {
      try {
        const detail = {
          startedAt,
          ok: verdict.ok,
          baseUrl,
          denied,
          problems: verdict.problems,
          scenarios: verdict.scenarios,
        };
        const buf = Buffer.from(`${JSON.stringify(detail, null, 2)}\n`);
        ftruncateSync(detailFd, 0);
        let off = 0;
        while (off < buf.length) off += writeSync(detailFd, buf, off, buf.length - off, off);
        return true;
      } catch {
        return false;
      }
    };
    let evidence: VerifyResult['evidence'] = null;
    try {
      // 진단 파일을 쓰지 못한 것도 요약의 판정에 들어가게 요약보다 먼저 쓴다
      if (!writeDetail()) fail('진단 파일(local/detail.json)을 쓰지 못했다');
      try {
        // 마지막 단계다: 묶음은 다 쓰인 채로 한 번에 나타나거나 아예 생기지 않는다. 이 뒤로는 판정이 바뀌지 않는다
        evidence = buildEvidence(outDir, verdict, { startedAt, deniedCount: denied.count });
      } catch (e) {
        fail(`증거 묶음을 만들지 못했다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
        // 요약이 없으므로 판정이 어긋날 곳은 진단 파일뿐이다. 마지막 판정으로 다시 쓴다
        writeDetail();
      }
    } finally {
      // 요약이 나타난 뒤에는 판정을 바꿀 일이 없어야 한다. 닫기 실패는 판정에 넣지 않는다
      try {
        closeSync(detailFd);
      } catch {
        // 진단 파일은 이미 썼다
      }
    }
    return { ok: verdict.ok, outDir, baseUrl, verdict, denied, evidence };
  };

  let scenarios: string[] | undefined;
  if (o.scenarios) {
    const checked = checkScenarios(root, o.scenarios);
    if ('problem' in checked) return finish('', failed(checked.problem));
    scenarios = checked.scenarios;
  }
  const dev = cfg.commands.dev;
  if (!dev)
    return finish(
      '',
      failed(
        'commands.dev가 없다. verify는 dev로 앱을 띄운다. 고치는 법: harness.config.json의 commands.dev에 앱 실행 명령(run, timeoutSec)을 넣어라(PORT·HOST 환경 변수를 따라야 한다)',
      ),
    );
  const signal = o.signal;
  if (signal?.aborted) return finish('', failed('중단 신호를 받았다'));

  const aborted = new Promise<'aborted'>((resolve) =>
    signal?.addEventListener('abort', () => resolve('aborted'), { once: true }),
  );
  const procs: Proc[] = [];
  // dev와 실행기가 다른 프로세스 그룹에 띄우는 것(브라우저 등)을 따라간다. 정리할 때 그것까지 끝낸다
  // 표식: dev와 실행기에 이번 실행만의 환경 변수를 준다. 자손이 물려받으므로, 한 번도 보지 못한 채 부모를 잃은
  // 프로세스도 이것으로 찾는다(tree.ts)
  const mark = `${RUN_MARK}=${randomBytes(16).toString('hex')}`;
  const tracker = new Descendants(o.listProcesses ?? listProcesses, () =>
    (o.findMarked ?? findMarked)(mark),
  );
  const marked = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
    ...env,
    [RUN_MARK]: mark.slice(RUN_MARK.length + 1),
  });
  let stopFollowing: (() => Promise<void>) | undefined;
  let baseUrl = '';
  let verdict: Verdict;
  let proxy: DenyProxy | null = null;
  let denied = noDenied();
  // 로그 파일 둘은 아무것도 띄우기 전에 새로 만들어 열어 둔다(wx: 이미 있으면 실패). dev가 실행기 로그 자리에
  // FIFO나 링크를 미리 둘 수 없고, 로그 끝부분은 이 fd로 읽는다(그래서 dev.log는 읽기도 되는 wx+로 연다)
  const logs: number[] = [];
  try {
    const devLog = openSync(path.join(local, 'dev.log'), 'wx+');
    logs.push(devLog);
    const runnerLog = openSync(path.join(local, 'runner.log'), 'wx');
    logs.push(runnerLog);
    // 거부 프록시는 dev보다 먼저 띄운다. 브라우저의 요청 가운데 앱 주소가 아닌 것이 여기로 온다
    proxy = await startDenyProxy();
    const port = await freePort();
    baseUrl = `http://${HOST}:${port}`;
    const devProc = start(dev.run, [], {
      cwd: root,
      env: marked({ ...process.env, PORT: String(port), HOST }),
      shell: true,
      log: devLog,
    });
    procs.push(devProc);
    stopFollowing = follow(tracker, procs);

    // 준비 대기: 응답이 오거나, dev가 끝나거나, 제한 시간이 지나거나, 중단 신호가 올 때까지
    const readyUntil = Date.now() + (o.readyTimeoutSec ?? 120) * 1000;
    let ready: 'ready' | 'exited' | 'timeout' | 'aborted' = 'timeout';
    for (;;) {
      if (signal?.aborted) ready = 'aborted';
      else if (devProc.code !== null) ready = 'exited';
      else if (await responds(baseUrl, signal)) ready = 'ready';
      else if (Date.now() < readyUntil) {
        await Promise.race([sleep(100), devProc.exited, aborted]);
        continue;
      }
      break;
    }
    if (ready !== 'ready') {
      const why = {
        exited: `dev가 준비되기 전에 끝났다(종료 코드 ${devProc.code})`,
        timeout: `dev가 ${o.readyTimeoutSec ?? 120}초 안에 ${baseUrl}에서 응답하지 않았다`,
        aborted: '중단 신호를 받았다',
      }[ready];
      verdict = failed(`${why}\ndev.log 끝부분:\n${logTail(devLog)}`);
    } else {
      const runner = o.runner ?? DEFAULT_RUNNER;
      const env: NodeJS.ProcessEnv = { ...process.env };
      // 바깥에서 물려받은 값을 쓰지 않는다
      delete env.HARNESS_VERIFY_SCENARIOS;
      env.HARNESS_VERIFY_BASE_URL = baseUrl;
      env.HARNESS_VERIFY_PROXY = proxy.url;
      env.HARNESS_VERIFY_OUT = outDir;
      if (scenarios) env.HARNESS_VERIFY_SCENARIOS = JSON.stringify(scenarios);
      const started = start(runner[0], runner.slice(1), {
        cwd: root,
        env: marked(env),
        shell: false,
        log: runnerLog,
      });
      procs.push(started);
      const timeoutSec = o.runnerTimeoutSec ?? 900;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutSec * 1000);
      });
      const ended = await Promise.race([
        started.exited.then(() => 'exited' as const),
        timedOut,
        aborted,
      ]);
      clearTimeout(timer);
      if (ended === 'timeout')
        verdict = failed(`실행기가 ${timeoutSec}초 안에 끝나지 않아 중단했다`);
      else if (ended === 'aborted') verdict = failed('중단 신호를 받았다');
      else {
        const read = signal?.aborted
          ? { problem: '중단 신호를 받았다' }
          : readReport(path.join(outDir, 'report.json'));
        verdict =
          'problem' in read
            ? failed(`${read.problem}(실행기 종료 코드 ${started.code})`)
            : judge(read.report, started.code ?? 1, { root, scenarios });
      }
    }
  } catch (e) {
    verdict = failed(
      `verify를 끝내지 못했다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`,
    );
  } finally {
    try {
      await stopFollowing?.();
      const cleaned = await cleanup(procs, tracker, o.identify ?? identify);
      // 남은 프로세스가 있거나 남은 것이 없는지 확인하지 못했으면 통과로 두지 않는다.
      // 시나리오별 결과는 그대로 두고 전체 문제로 더한다
      const problem = {
        clean: null,
        left: '띄운 프로세스를 끝내지 못했다(dev, 실행기 또는 그 둘이 띄운 프로세스가 남아 있다)',
        unknown:
          '띄운 프로세스를 끝내지 못했다고 본다: 프로세스 목록(ps)을 읽지 못해 dev와 실행기가 띄운 프로세스(브라우저 등)가 모두 끝났는지 확인하지 못했다',
      }[cleaned];
      if (problem) {
        const judged: Verdict = verdict!;
        verdict = {
          ok: false,
          scenarios: judged.scenarios,
          problems: judged.problems.includes(problem)
            ? judged.problems
            : [...judged.problems, problem],
        };
      }
    } finally {
      // 어느 경우에도 돌아가기 전에 프록시를 닫는다. 기록은 띄운 것을 모두 끝낸 뒤에 읽는다:
      // 실행기가 끝난 뒤에도 남은 자식(브라우저)이 보낸 요청까지 센다
      if (proxy) {
        denied = { count: proxy.count(), requests: proxy.denied() };
        await proxy.close();
      }
      for (const fd of logs) closeSync(fd);
    }
  }
  return finish(baseUrl, verdict!, denied);
}

function report(r: VerifyResult, write: (s: string) => void): void {
  for (const s of r.verdict.scenarios) {
    write(`${s.ok ? '✓' : '✗'} ${s.file}:${s.line} ${s.title}\n`);
    for (const p of s.problems) write(`    ${p}\n`);
  }
  for (const p of r.verdict.problems) write(`✗ ${p}\n`);
  write(
    `verify: ${r.ok ? '통과' : '실패'} (시나리오 ${r.verdict.scenarios.length}개) · 출력 ${r.outDir}\n`,
  );
  if (r.evidence) write(`증거 묶음(PR에 올릴 수 있는 요약): ${r.evidence.dir}\n`);
  if (r.outDir) write(`진단(로컬에서만 본다): ${path.join(r.outDir, 'local', 'detail.json')}\n`);
}

/** 받으면 띄운 것을 정리하고 실패로 끝나는 신호: 표준 명령 실행기가 넘기는 신호 전부다 */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = FORWARDED;

async function main(argv: string[]): Promise<number> {
  const out = (s: string) => process.stdout.write(s);
  // 출력을 받는 쪽이 먼저 닫혀도(EPIPE) 종료 코드는 판정을 따른다. 공개 요약과 어긋나지 않게 한다
  process.stdout.on('error', () => {});
  // 시나리오 경로만 받는다. 옵션(--config 등)이나 정규식으로 읽힐 문자가 실행기에 닿지 않게 한다
  const bad = argv.filter((a) => !isScenarioPath(a));
  if (bad.length) {
    process.stderr.write(
      `verify: 받을 수 없는 인자가 있어 아무것도 실행하지 않았다: ${bad.map((a) => JSON.stringify(a)).join(', ')}\n` +
        '사용법: node scripts/harness.ts verify [-- e2e/<시나리오>.spec.ts …]\n' +
        '시나리오 경로는 e2e/로 시작하고 .spec.ts로 끝나며 영문자·숫자·._-/만 쓰는 상대 경로다.\n',
    );
    return 1;
  }
  const info = repoInfo(process.cwd());
  const cfg = loadConfig(info.root);
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  // 하네스(표준 명령 실행기)가 넘겨주는 신호 셋을 모두 받는다. 하나라도 빠지면 그 신호에서 이 프로세스만 끝나고
  // dev와 실행기(각자의 프로세스 그룹)가 남는다
  for (const s of STOP_SIGNALS) process.on(s, onSignal);
  try {
    const r = await verifyWeb(info.root, cfg, {
      scenarios: argv.length ? argv : undefined,
      signal: ac.signal,
    });
    report(r, out);
    // 판정은 verifyWeb이 정한 하나다(중단 신호 포함). 여기서 다시 따지면 공개 요약과 종료 코드가 어긋난다
    return r.ok ? 0 : 1;
  } finally {
    for (const s of STOP_SIGNALS) process.off(s, onSignal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      process.stderr.write(`verify: ${e instanceof Error ? e.message : '알 수 없는 오류'}\n`);
      process.exitCode = 1;
    },
  );
}
