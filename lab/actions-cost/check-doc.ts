// 판단 절차 문서(docs/harness/actions-cost.md)의 검사. 아직 구현하지 않았다:
// 테스트(test/check-doc.test.ts)를 먼저 두고 실패를 확인하기 위한 빈 구현이다(계획 20261121-actions-cost-design step1).
import type { KnownNames } from '../../scripts/metrics/actions-cost.ts';

/** 제작자가 정한 예산(2026-11-21). 문서의 "예산" 절이 이 값과 같아야 한다 */
export const BUDGET = {
  accountUsd: 18,
  prsPerMonth: 100,
  minutesPerPr: 30,
  usdPerPr: 0.18,
} as const;
export const BASELINE_FILE = '2026-11-17_2026-11-20.jsonl';

export interface DocInputs {
  /** 문서의 글 */
  doc: string;
  /** 보존 기록 파일의 글(이름으로 찾는다). 없으면 null */
  saved: (name: string) => string | null;
  known: KnownNames;
}

/** 어긋난 점의 목록. 없으면 빈 배열 */
export function checkDoc(_i: DocInputs): string[] {
  return [];
}
