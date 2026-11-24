// Q10 실물 확인의 절차를 명령 하나로 돌린다(계획 20261121-q10-confirm step0). OS와 무관하다.
// 실행 → 포맷 → 결과 검사 → 검사 스크립트의 테스트. 한 단계가 실패하면 그 자리에서 멈춘다
// (trial.ts는 실패하면 결과 파일을 새로 쓰지 않는다. 이어서 검사를 돌리면 이전 결과가 통과로 보인다).
//
//   node lab/q10-db/run.ts                  결과를 results/<platform>-<arch>.json에 쓴다
//   node lab/q10-db/run.ts --skip-fmt       포맷을 건너뛴다(하네스의 의존성을 설치하지 않은 CI 러너)
//
// 받는 인자는 --skip-fmt 하나뿐이다. 결과를 다른 경로에 쓰는 옵션은 없다.
// 리포의 루트에서 돌린다.
import { spawnSync, type StdioOptions } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Options {
  skipFmt: boolean;
}

export interface PlanOptions extends Options {
  /** 시험 프로젝트를 만들 새 폴더 */
  workDir: string;
}

export interface Step {
  name: string;
  /** node에 넘기는 인자 */
  args: string[];
}

export const USAGE = '사용법: node lab/q10-db/run.ts [--skip-fmt]';

/** 인자를 읽는다. --skip-fmt가 아닌 인자가 하나라도 있으면 null이다 */
export function parseArgs(argv: readonly string[]): Options | null {
  const opts: Options = { skipFmt: false };
  for (const a of argv) {
    if (a === '--skip-fmt') opts.skipFmt = true;
    else return null;
  }
  return opts;
}

/** 절차의 단계(이름과 node에 넘기는 인자) */
export function planSteps(opts: PlanOptions): Step[] {
  const name = `${process.platform}-${process.arch}`;
  const steps: Step[] = [{ name: 'trial', args: ['lab/q10-db/trial.ts', opts.workDir] }];
  if (!opts.skipFmt) steps.push({ name: 'fmt', args: ['scripts/harness.ts', 'fmt'] });
  steps.push({ name: 'check', args: ['lab/q10-db/check-results.ts', name] });
  steps.push({ name: 'test', args: ['--test', 'lab/q10-db/test/check-results.test.ts'] });
  return steps;
}

/**
 * 단계를 차례로 돌린다. exec는 그 단계의 종료 코드를 낸다(신호로 끝났으면 null).
 * 0이 아닌 단계나 실행하지 못한 단계에서 멈추고 1을 낸다. 모두 통과하면 0이다.
 */
export function runSteps(
  steps: readonly Step[],
  exec: (step: Step) => number | null,
  log: (message: string) => void = (m) => process.stderr.write(`${m}\n`),
): number {
  for (const step of steps) {
    let code: number | null;
    try {
      code = exec(step);
    } catch (e) {
      log(
        `run: ${step.name} 단계를 실행하지 못했다: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 1;
    }
    if (code !== 0) {
      log(
        `run: ${step.name} 단계가 실패했다(종료 코드 ${code ?? '없음'}). 뒤 단계는 돌리지 않는다`,
      );
      return 1;
    }
  }
  return 0;
}

/** 단계 하나를 자식 프로세스로 띄운다(셸을 거치지 않는다). 종료 코드를 낸다. 띄우지 못하면 던진다 */
export function spawnStep(step: Step, stdio: StdioOptions = 'inherit'): number | null {
  const r = spawnSync(process.execPath, step.args, { stdio });
  if (r.error) throw r.error;
  return r.status;
}

function main(argv: readonly string[]): number {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  // 새 임시 폴더. 지우지 않는다(R14)
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'q10-'));
  return runSteps(planSteps({ ...opts, workDir }), (step) => {
    process.stdout.write(`run: ${step.name} — node ${step.args.join(' ')}\n`);
    return spawnStep(step);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
