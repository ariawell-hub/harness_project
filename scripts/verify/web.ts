// verify 표준 명령의 웹 구현(설계서 11.1절): dev를 띄우고, 시나리오 실행기를 돌리고, 판정하고, 정리한다.
//
//   node scripts/verify/web.ts [e2e/<시나리오>.spec.ts …]
//
// 실행기(Playwright)는 명령(인자 배열)으로만 다룬다. 이 파일은 실행기 패키지를 import하지 않는다.
// 실행기 명령, 설정 파일 경로, 앱 주소는 환경 변수·명령행 인자·설정 파일로 바꿀 수 없다(검사를 약화시키는 길이 된다).
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { killTree, tail } from '../lib/exec.ts';
import { repoInfo } from '../lib/git.ts';
import { isScenarioPath, judge, type Verdict } from './judge.ts';

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
/** 정리: SIGKILL 뒤 끝난 것을 확인하는 시간. 둘을 더해도 중단 신호부터 4초 안이다 */
const KILL_CONFIRM_MS = 1500;

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
}

export interface VerifyResult {
  ok: boolean;
  outDir: string;
  baseUrl: string;
  verdict: Verdict;
}

const failed = (problem: string): Verdict => ({ ok: false, scenarios: [], problems: [problem] });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 이 플랫폼에서 verify를 돌릴 수 없으면 이유를, 돌릴 수 있으면 null을 돌려준다.
 * 정리 계약은 프로세스 그룹에 기댄다: dev와 실행기를 각자의 그룹으로 띄우고, 그룹에 신호를 보내고, 그룹이 빈 것을 확인한다.
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

async function goneWithin(procs: Proc[], ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (!procs.some(treeAlive)) return true;
    if (Date.now() >= until) return false;
    await sleep(25);
  }
}

/**
 * 정리 계약: 띄운 트리를 모두 끝내고 끝난 것을 확인한 뒤 돌아간다.
 * 그룹에 SIGTERM → 2초 안에 끝나지 않으면 SIGKILL → 확인. 남은 것이 있으면 false
 */
async function cleanup(procs: Proc[]): Promise<boolean> {
  const live = procs.filter((p) => p.child.pid);
  for (const p of live) killTree(p.child.pid, 'SIGTERM');
  if (await goneWithin(live, TERM_GRACE_MS)) return true;
  for (const p of live) killTree(p.child.pid, 'SIGKILL');
  return goneWithin(live, KILL_CONFIRM_MS);
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
    return '';
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
  const unsupported = unsupportedPlatform(process.platform);
  if (unsupported) return { ok: false, outDir: '', baseUrl: '', verdict: failed(unsupported) };
  // 보고서의 config.rootDir는 실행기가 본 실제 경로다. 심볼릭 링크를 낀 경로를 그대로 쓰면 리포 기준 경로가 어긋난다
  root = realpathSync(root);
  const made = makeOutDir(root);
  if ('problem' in made)
    return { ok: false, outDir: '', baseUrl: '', verdict: failed(made.problem) };
  const outDir = made.outDir;
  const local = path.join(outDir, 'local');
  mkdirSync(local);
  const result = (baseUrl: string, verdict: Verdict): VerifyResult => ({
    ok: verdict.ok,
    outDir,
    baseUrl,
    verdict,
  });

  let scenarios: string[] | undefined;
  if (o.scenarios) {
    const checked = checkScenarios(root, o.scenarios);
    if ('problem' in checked) return result('', failed(checked.problem));
    scenarios = checked.scenarios;
  }
  const dev = cfg.commands.dev;
  if (!dev)
    return result(
      '',
      failed(
        'commands.dev가 없다. verify는 dev로 앱을 띄운다. 고치는 법: harness.config.json의 commands.dev에 앱 실행 명령(run, timeoutSec)을 넣어라(PORT·HOST 환경 변수를 따라야 한다)',
      ),
    );
  const signal = o.signal;
  if (signal?.aborted) return result('', failed('중단 신호를 받았다'));

  const aborted = new Promise<'aborted'>((resolve) =>
    signal?.addEventListener('abort', () => resolve('aborted'), { once: true }),
  );
  const procs: Proc[] = [];
  let baseUrl = '';
  let verdict: Verdict;
  // 로그 파일 둘은 아무것도 띄우기 전에 새로 만들어 열어 둔다(wx: 이미 있으면 실패). dev가 실행기 로그 자리에
  // FIFO나 링크를 미리 둘 수 없고, 로그 끝부분은 이 fd로 읽는다
  const logs: number[] = [];
  try {
    const devLog = openSync(path.join(local, 'dev.log'), 'wx');
    logs.push(devLog);
    const runnerLog = openSync(path.join(local, 'runner.log'), 'wx');
    logs.push(runnerLog);
    const port = await freePort();
    baseUrl = `http://${HOST}:${port}`;
    const devProc = start(dev.run, [], {
      cwd: root,
      env: { ...process.env, PORT: String(port), HOST },
      shell: true,
      log: devLog,
    });
    procs.push(devProc);

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
      env.HARNESS_VERIFY_OUT = outDir;
      if (scenarios) env.HARNESS_VERIFY_SCENARIOS = JSON.stringify(scenarios);
      const runnerProc = start(runner[0], runner.slice(1), {
        cwd: root,
        env,
        shell: false,
        log: runnerLog,
      });
      procs.push(runnerProc);
      const timeoutSec = o.runnerTimeoutSec ?? 900;
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutSec * 1000);
      });
      const ended = await Promise.race([
        runnerProc.exited.then(() => 'exited' as const),
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
            ? failed(`${read.problem}(실행기 종료 코드 ${runnerProc.code})`)
            : judge(read.report, runnerProc.code ?? 1, { root, scenarios });
      }
    }
  } catch (e) {
    verdict = failed(
      `verify를 끝내지 못했다: ${e instanceof Error ? e.message : '알 수 없는 오류'}`,
    );
  } finally {
    const clean = await cleanup(procs);
    if (!clean) {
      // 남은 프로세스가 있으면 통과로 두지 않는다
      verdict = failed('띄운 프로세스를 끝내지 못했다(dev 또는 실행기의 프로세스가 남아 있다)');
    }
    for (const fd of logs) closeSync(fd);
  }
  return result(baseUrl, verdict!);
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
}

async function main(argv: string[]): Promise<number> {
  const out = (s: string) => process.stdout.write(s);
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
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  try {
    const r = await verifyWeb(info.root, cfg, {
      scenarios: argv.length ? argv : undefined,
      signal: ac.signal,
    });
    report(r, out);
    return r.ok && !ac.signal.aborted ? 0 : 1;
  } finally {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
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
