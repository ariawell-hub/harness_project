// runner가 PR의 지적 원장(10.2절 (4))을 읽는다. 읽기만 한다: 원장은 기록 job이 검증 App으로 관리한다.
// 원장으로 인정하는 댓글은 작성자가 검증 App 봇(ci.recorderBot)인 것뿐이다. 봇 PAT과 PR 작성자도 같은 표식의 댓글을
// 쓸 수 있고(ADR-0003), runner가 만든 PR의 작성자는 runner 자신이다. 판정 워크플로와 같은 함수(ci/ledger-store.ts)로 고른다.
import { REVIEWERS, type Ledger } from '../ci/ledger.ts';
import { ledgerFromComments } from '../ci/ledger-store.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type { GitHubPort } from '../lib/github.ts';

/** PR의 지적 원장. 원장 댓글이 없으면 null. 읽지 못하거나 깨졌으면 예외 */
export function readPrLedger(gh: GitHubPort, cfg: HarnessConfig, pr: number): Ledger | null {
  const bot = cfg.ci.recorderBot;
  if (!bot) throw new Error('ci.recorderBot 설정이 없어 원장 댓글을 가릴 수 없다');
  const comments = gh
    .prComments(pr)
    .map((c) => ({ id: c.id, user: { login: c.author }, body: c.body }));
  return ledgerFromComments(comments, bot).ledger;
}

/**
 * 원장의 계획 승인(G1, 10.3절)이 이 해시의 것이고 두 검증자가 모두 있는가.
 * 실행하지 않은 검증자("해당 없음")도 기록 job이 승인에 넣으므로 두 검증자를 모두 요구한다(plan-gate와 같은 기준).
 *
 * 승인은 계획 핵심 섹션의 해시에 묶는다. 승인이 기록된 head(`planReview.head`)가 지금 PR head와 같은지는 보지 않는다:
 * - 10.3절 결속 기준과 `plan-gate`(`gates/plan-gate.ts`의 `checkG1`)가 해시와 검증자만 본다. runner만 head를 요구하면
 *   병합 판정과 갈린다. 진행 로그·상태만 바뀐 커밋은 계획을 다시 검증받지 않는다(8.3절 계획 전용 커밋)
 * - 계획이 멈춰 중단 보고와 함께 작업 중인 코드가 push되면 그 head는 계획 전용이 아니라 계획 승인이 다시 기록되지 않는다.
 *   head를 요구하면 제작자 답을 받은 뒤에도 승인을 확인하지 못해 step을 이어 가지 못한다
 * 호출하는 쪽은 지금 head의 필수 체크가 모두 끝나 `review/*`·`review-ledger`가 통과한 뒤에만 이 함수를 부른다
 * (`next.ts`: 계획 검증 중인 PR의 분류가 ready일 때). 지금 head에서 검증자가 수정을 요청했으면 거기서 걸린다
 */
export function planApproved(ledger: Ledger | null, hash: string): boolean {
  const p = ledger?.planReview;
  return !!p && p.hash === hash && REVIEWERS.every((r) => p.approvals.includes(r));
}
