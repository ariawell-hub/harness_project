// trial.ts의 인자 검사. 파일 시스템을 보지 않고 아무것도 실행하지 않는다.
// trial.ts는 불러오기만 해도 실측이 돌기 때문에, 테스트는 이 파일만 불러온다.

export const TRIAL_USAGE = '사용법: node lab/q10-db/trial.ts <빈 폴더>';

export type TrialArgs = { dir: string } | { error: string };

/** 받는 인자는 <빈 폴더> 하나뿐이다. 인자가 하나가 아니거나 `--`로 시작하면 사용법을 낸다 */
export function parseTrialArgs(argv: readonly string[]): TrialArgs {
  const dir = argv[0];
  if (argv.length !== 1 || !dir || dir.startsWith('--')) return { error: TRIAL_USAGE };
  return { dir };
}
