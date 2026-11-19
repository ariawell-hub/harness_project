// 시간 제한이 있는 프로세스 실행 (6절: 모든 명령에 시간 제한, 끝나지 않는 프로세스가 무인 루프를 붙잡지 않게).
// 프로세스를 새 프로세스 그룹으로 띄워, 시간 초과나 종료 시 자식 프로세스까지 함께 정리한다.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  /** true면 플랫폼 기본 셸, 문자열이면 그 셸 실행 파일(Windows의 Git Bash 등) */
  shell?: boolean | string;
  /** 출력을 실시간으로 현재 프로세스의 stdout/stderr에도 흘린다 */
  stream?: boolean;
  /** 종료 후에도 남은 같은 그룹의 프로세스(dev 서버 등)를 정리한다. 기본 true */
  killGroupOnExit?: boolean;
  /**
   * 실행하는 동안 이 프로세스가 받은 SIGTERM·SIGINT·SIGHUP을 자식의 프로세스 그룹에 넘기고, 자식이 끝난 뒤 이 프로세스도
   * 그 신호로 끝난다. 자식은 새 프로세스 그룹이라 부모에게 온 신호도 터미널의 Ctrl-C도 받지 못한다. 넘기지 않으면
   * 부모만 끝나고 자식 트리(dev 서버, 브라우저)가 남는다. 표준 명령 실행에 쓴다. Windows에서는 아무것도 하지 않는다
   */
  forwardSignals?: boolean;
  /** 신호를 넘긴 뒤 자식이 끝나기를 기다리는 시간. 지나면 SIGKILL을 보낸다. 기본 10초 */
  forwardGraceMs?: number;
}

const FORWARDED: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

const MAX_KEEP = 2_000_000; // 출력은 끝부분 2MB만 보관한다
const isWin = process.platform === 'win32';

function keepTail(buf: string, chunk: string): string {
  const next = buf + chunk;
  return next.length > MAX_KEEP ? next.slice(next.length - MAX_KEEP) : next;
}

export function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;
  try {
    if (isWin) {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // 이미 종료됨
  }
}

export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: opts.shell ?? false,
      detached: !isWin,
      stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // 신호 전달(forwardSignals): 첫 신호는 자식 그룹에 그대로 넘기고 유예 시간 뒤 SIGKILL을 보낸다.
    // 유예 시간 안에 신호를 또 받으면 기다리지 않고 SIGKILL을 보낸다
    let received: NodeJS.Signals | null = null;
    let forceTimer: NodeJS.Timeout | undefined;
    const onSignal = (signal: NodeJS.Signals) => {
      if (received) {
        killTree(child.pid, 'SIGKILL');
        return;
      }
      received = signal;
      killTree(child.pid, signal);
      forceTimer = setTimeout(() => killTree(child.pid, 'SIGKILL'), opts.forwardGraceMs ?? 10_000);
    };
    const forwarding = opts.forwardSignals === true && !isWin;
    if (forwarding) for (const s of FORWARDED) process.on(s, onSignal);
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (forwarding) {
        for (const s of FORWARDED) process.off(s, onSignal);
        // 자식 트리가 끝났다. 받은 신호의 기본 동작(종료)으로 이어 간다. 이 프로세스에 다른 처리기가 있으면 그쪽이 받는다
        if (received) process.kill(process.pid, received);
      }
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    };
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout = keepTail(stdout, s);
      if (opts.stream) process.stdout.write(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr = keepTail(stderr, s);
      if (opts.stream) process.stderr.write(s);
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            killTree(child.pid, 'SIGTERM');
            setTimeout(() => killTree(child.pid, 'SIGKILL'), 5000).unref();
          }, opts.timeoutMs)
        : undefined;
    child.on('error', (err) => {
      stderr = keepTail(stderr, `\n[exec] 실행 실패: ${err.message}\n`);
      finish(127);
    });
    let exitCode: number | null = null;
    const codeOf = (code: number | null, signal: NodeJS.Signals | null) =>
      timedOut ? 124 : (code ?? (signal ? 128 : 1));
    child.on('exit', (code, signal) => {
      exitCode = codeOf(code, signal);
      if (opts.killGroupOnExit !== false) killTree(child.pid, 'SIGTERM');
      // 손자 프로세스가 파이프를 잡고 있어도 2초 뒤에는 결과를 돌려준다
      const code2 = exitCode;
      setTimeout(() => finish(code2), 2000).unref();
    });
    child.on('close', (code, signal) => finish(exitCode ?? codeOf(code, signal)));
  });
}

// ---------- Windows 네이티브 (ADR-0005) ----------

const WSL_BASH = /\\windows\\(system32|sysnative)\\bash\.exe$|\\windowsapps\\/i;

export interface GitBashProbe {
  env: NodeJS.ProcessEnv;
  exists: (p: string) => boolean;
  /** `git --exec-path` 결과(예: C:/Program Files/Git/mingw64/libexec/git-core). 없으면 null */
  gitExecPath: () => string | null;
}

/** Git for Windows의 bash.exe를 찾는다. WSL bash는 Windows 네이티브가 아니므로 지정해도 버린다 */
export function findGitBash(r: GitBashProbe): string | null {
  const w = path.win32;
  const cands: string[] = [];
  for (const k of ['HARNESS_BASH', 'CLAUDE_CODE_GIT_BASH_PATH']) {
    const v = r.env[k];
    if (v) cands.push(v);
  }
  const exec = r.gitExecPath();
  if (exec) {
    const gitRoot = w.join(exec, '..', '..', '..');
    cands.push(w.join(gitRoot, 'bin', 'bash.exe'), w.join(gitRoot, 'usr', 'bin', 'bash.exe'));
  }
  for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
    const v = r.env[k];
    if (v) cands.push(w.join(v, 'Git', 'bin', 'bash.exe'));
  }
  if (r.env.LOCALAPPDATA)
    cands.push(w.join(r.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'));
  for (const c of cands.map((x) => w.normalize(x))) {
    if (WSL_BASH.test(c)) continue;
    if (r.exists(c)) return c;
  }
  return null;
}

/** runShell이 쓸 셸: Windows가 아니면 true(/bin/sh), Windows면 Git Bash 경로, 못 찾으면 null */
export function shellOption(
  platform: NodeJS.Platform,
  resolve: () => string | null,
): true | string | null {
  return platform === 'win32' ? resolve() : true;
}

let gitBashCache: string | null | undefined;
function gitBash(): string | null {
  if (gitBashCache === undefined) {
    gitBashCache = findGitBash({
      env: process.env,
      exists: existsSync,
      gitExecPath: () => {
        const r = runSync('git', ['--exec-path'], { timeoutMs: 20_000 });
        return r.code === 0 ? r.stdout.trim() || null : null;
      },
    });
  }
  return gitBashCache;
}

export const GIT_BASH_MISSING =
  '[exec] Windows에서 셸 명령(step AC·표준 명령)은 Git Bash로 실행한다. Git for Windows(bash.exe)를 찾지 못해 실행하지 않았다.\n' +
  '고치는 법: Git for Windows를 설치하거나 HARNESS_BASH에 bash.exe 경로를 지정하라. WSL bash는 쓰지 않는다.\n' +
  '근거: docs/decisions/ADR-0005-windows-native.md, docs/harness/design.md 6절\n';

/**
 * 셸 문자열 명령 실행 (프로파일 표준 명령·step AC용). POSIX sh 문법 하나로 쓴다(6절).
 * macOS·Linux는 /bin/sh, Windows는 Git Bash. Git Bash가 없으면 cmd.exe로 대신 실행하지 않고 실패한다.
 */
export function runShell(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  const shell = shellOption(process.platform, gitBash);
  if (shell === null) {
    return Promise.resolve({
      code: 127,
      stdout: '',
      stderr: GIT_BASH_MISSING,
      timedOut: false,
      durationMs: 0,
    });
  }
  return run(command, [], { ...opts, shell });
}

export interface ExecutableProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (p: string) => boolean;
}

function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k ? env[k] : undefined;
}

/**
 * 셸 없이 띄울 실행 파일을 정한다. Windows는 PATH 디렉터리 순서대로 PATHEXT를 붙여 찾는다.
 * 처음 걸린 것이 .cmd·.bat(npm 래퍼 등)이면 셸 없이 실행할 수 없으므로 오류를 돌려준다.
 */
export function resolveExecutable(
  cmd: string,
  r: ExecutableProbe,
): { path: string } | { error: string } {
  if (r.platform !== 'win32') return { path: cmd };
  const w = path.win32;
  const wrapper = (p: string) => ({
    error:
      `${p}는 셸 래퍼(.cmd·.bat)라서 셸 없이 실행할 수 없다. ` +
      '네이티브 설치본(.exe)을 쓰거나 실행 파일 경로(.exe)를 직접 지정하라',
  });
  const ext = w.extname(cmd).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') return wrapper(cmd);
  if (ext || w.isAbsolute(cmd) || /[\\/]/.test(cmd)) return { path: cmd };
  const exts = (envGet(r.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  for (const dir of (envGet(r.env, 'PATH') ?? '').split(';').filter(Boolean)) {
    for (const e of exts) {
      const p = w.join(dir, cmd + e);
      if (!r.exists(p)) continue;
      return e === '.cmd' || e === '.bat' ? wrapper(p) : { path: p };
    }
  }
  return { path: cmd };
}

export interface SyncResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runSync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number } = {},
): SyncResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? `\n${r.error.message}` : ''),
  };
}

export function tail(text: string, lines = 60): string {
  const arr = text.trimEnd().split('\n');
  return arr.slice(Math.max(0, arr.length - lines)).join('\n');
}
