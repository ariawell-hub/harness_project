// actions-cost의 자료 원천. 아직 구현하지 않았다: 테스트를 먼저 두고 실패를 확인하기 위한 빈 구현이다
// (계획 20261121-actions-cost-design step0, 진행 로그의 F28 대응).
import type { JobRecord } from './actions-cost.ts';
import type { Period } from './source.ts';

export interface ActionsSource {
  /** 기간에 만들어진 실행의 job 전부(모든 시도). 끝까지 읽지 못하면 SourceError */
  jobs(period: Period): JobRecord[];
}

/** head를 찾는 범위: 기간 시작 전 이만큼의 날의 실행 목록도 읽는다(청구에는 넣지 않는다) */
export const LOOKBACK_DAYS = 66;

export function ghActionsSource(_o: {
  cwd: string;
  gh?: (args: string[]) => string;
  defaultBranch?: string;
  progress?: (line: string) => void;
}): ActionsSource {
  return {
    jobs() {
      throw new Error('구현 전');
    },
  };
}
