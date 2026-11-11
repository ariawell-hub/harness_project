// 시간 제한이 있는 프로세스 실행 (6절: 모든 명령에 시간 제한, 끝나지 않는 프로세스가 무인 루프를 붙잡지 않게).
// 프로세스를 새 프로세스 그룹으로 띄워, 시간 초과나 종료 시 자식 프로세스까지 함께 정리한다.
import { spawn, spawnSync } from 'node:child_process';

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
  shell?: boolean;
  /** 출력을 실시간으로 현재 프로세스의 stdout/stderr에도 흘린다 */
  stream?: boolean;
  /** 종료 후에도 남은 같은 그룹의 프로세스(dev 서버 등)를 정리한다. 기본 true */
  killGroupOnExit?: boolean;
}

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
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.destroy();
      child.stderr?.destroy();
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

/** 셸 문자열 명령 실행 (프로파일 표준 명령용). Windows에서는 cmd.exe, 그 밖에는 /bin/sh */
export function runShell(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return run(command, [], { ...opts, shell: true });
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
