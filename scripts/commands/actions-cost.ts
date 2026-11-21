// actions-cost 명령. 아직 구현하지 않았다: 테스트를 먼저 두고 실패를 확인하기 위한 빈 구현이다
// (계획 20261121-actions-cost-design step0, 진행 로그의 F28 대응).
import type { KnownNames } from '../metrics/actions-cost.ts';
import type { ActionsSource } from '../metrics/actions-source.ts';

export interface ActionsCostOptions {
  since?: string;
  until?: string;
  /** 읽은 기록을 보존 기록으로 남길 파일 */
  save?: string;
  /** GitHub 대신 읽을 보존 기록 파일 */
  from?: string;
  /** 테스트용. 주지 않으면 리포 루트의 `.github/workflows/*.yml`·`*.yaml`을 읽어 `knownNamesFrom`으로 만든다 */
  known?: KnownNames;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export function runActionsCost(
  _cwd: string,
  _o: ActionsCostOptions,
  _source?: ActionsSource,
): number {
  throw new Error('구현 전');
}
