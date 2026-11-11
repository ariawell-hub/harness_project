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

export async function runStandard(
  name: StandardName,
  root: string,
  cfg: HarnessConfig,
  opts: { checkMode?: boolean; stream?: boolean; extraArgs?: string[] } = {},
): Promise<StandardRun> {
  const def = cfg.commands[name];
  if (!def) return { name, command: null, result: null, ok: true, notApplicable: true };
  let command = opts.checkMode && def.check ? def.check : def.run;
  if (opts.extraArgs?.length)
    command += ' ' + opts.extraArgs.map((a) => JSON.stringify(a)).join(' ');
  const result = await runShell(command, {
    cwd: root,
    timeoutMs: def.timeoutSec * 1000,
    stream: opts.stream,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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
