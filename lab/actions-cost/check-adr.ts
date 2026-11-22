// ADR(docs/decisions/ADR-<번호>-actions-cost.md)에서 후보의 평가나 결정이 빠지면 실패하게 하는 검사
// (계획 20261121-actions-cost-design step2). 아직 구현하지 않았다: 테스트가 실패하는 것을 먼저 확인한다.
//   node lab/actions-cost/check-adr.ts [--file <ADR 파일>]
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 반드시 다뤄야 하는 후보의 ID */
export const REQUIRED_IDS: readonly string[] = [];

/** 어긋난 점의 목록. 없으면 빈 배열 */
export function checkAdr(text: string): string[] {
  void text;
  return [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write('check-adr: 통과\n');
