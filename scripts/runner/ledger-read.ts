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
 * 실행하지 않은 검증자("해당 없음")도 기록 job이 승인에 넣으므로 두 검증자를 모두 요구한다(plan-gate와 같은 기준)
 */
export function planApproved(ledger: Ledger | null, hash: string): boolean {
  const p = ledger?.planReview;
  return !!p && p.hash === hash && REVIEWERS.every((r) => p.approvals.includes(r));
}
