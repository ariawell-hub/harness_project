// 표준 명령 인터페이스(6절). 이름과 의미는 코어가, 구현은 프로파일(harness.config.json commands)이 정한다.
import type { HarnessConfig, StandardName } from '../lib/config.ts';
import { runShell, tail, type ExecResult } from '../lib/exec.ts';

export interface StandardRun {
  name: StandardName;
  command: string | null;
  result: ExecResult | null;
  ok: boolean;
  /** 프로파일에 해당 명령이 없음(null) */
  notApplicable: boolean;
}

/**
 * 인자 하나를 POSIX 셸의 작은따옴표로 인용한다. 작은따옴표 안에서는 셸이 아무것도 풀지 않는다
 * (`$(…)`, 역따옴표, `$변수`, `;`, glob). 안의 `'`만 `'\''`로 바꾼다.
 * 큰따옴표(JSON.stringify)는 쓰지 않는다: 그 안에서는 셸이 명령 치환과 변수를 푼다
 */
export function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", "'\\''")}'`;
}

export async function runStandard(
  name: StandardName,
  root: string,
  cfg: HarnessConfig,
  opts: { checkMode?: boolean; stream?: boolean; extraArgs?: string[] } = {},
): Promise<StandardRun> {
  const def = cfg.commands[name];
  if (!def) return { name, command: null, result: null, ok: true, notApplicable: true };
  let command = opts.checkMode && def.check ? def.check : def.run;
  const extra = opts.extraArgs ?? [];
  // NUL은 셸 명령 문자열에도 프로세스 인자에도 넣을 수 없다. 잘라서 넘기지 않고 실행하지 않는다
  if (extra.some((a) => a.includes('\0'))) {
    const stderr = `[${name}] 추가 인자에 NUL 문자가 있어 실행하지 않았다\n`;
    const result = { code: 2, stdout: '', stderr, timedOut: false, durationMs: 0 };
    return { name, command, result, ok: false, notApplicable: false };
  }
  if (extra.length) command += ' ' + extra.map(shellQuote).join(' ');
  const result = await runShell(command, {
    cwd: root,
    timeoutMs: def.timeoutSec * 1000,
    stream: opts.stream,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    // 명령은 새 프로세스 그룹에서 돈다. 하네스가 받은 신호를 넘겨야 명령이 띄운 것(dev, 실행기, 브라우저)이 남지 않는다
    forwardSignals: true,
  });
  return { name, command, result, ok: result.code === 0, notApplicable: false };
}

export function describeFailure(r: StandardRun, timeoutSec?: number): string {
  if (!r.result) return '';
  if (r.result.timedOut) {
    return `시간 제한 ${timeoutSec ?? '?'}초를 넘겨 중단했다: \`${r.command}\`\n멈춘 지점(출력 끝부분):\n${tail(r.result.stdout + r.result.stderr, 30)}`;
  }
  return `\`${r.command}\` 종료 코드 ${r.result.code}\n${tail(r.result.stdout + '\n' + r.result.stderr, 60)}`;
}
