// PR 상태 판정(4.5절 우선순위 2번, 10.3절). 순수 함수만 둔다(네트워크·git 호출 없음).
// 필수 체크는 설정(ci.requiredChecks)의 context마다 "기대 출처가 쓴 가장 최근 결과"로 본다.
// 체크 요약(statusCheckRollup)은 출처를 보지 않아, 봇 PAT이나 PR 워크플로가 쓴 같은 이름의 결과도 통과로 보인다(Q20).
import { ACTIONS_APP_ID } from '../ci/protection.ts';
import { GATE_CONTEXTS, LEDGER_CONTEXT, REVIEW_CONTEXTS } from '../ci/results.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type { CommitCheck, PullRequest } from '../lib/github.ts';

/** missing: 기대 출처가 쓴 결과가 아직 없다 */
export type CheckState = 'success' | 'failure' | 'error' | 'pending' | 'missing';

export interface RequiredState {
  context: string;
  source: 'actions' | 'recorder';
  state: CheckState;
  description: string;
  targetUrl: string;
  /** 기록 시각(ISO). missing이면 '' */
  at: string;
}

/**
 * 필수 체크마다 기대 출처의 가장 최근 결과를 고른다(설정 순서).
 * recorder: 작성자가 검증 App 봇(ci.recorderBot)인 커밋 상태. actions: GitHub Actions App의 check run.
 * 다른 계정·App이 쓴 같은 이름의 결과는 없는 것으로 본다. 나중에 쓰였어도 기대 출처의 결과를 가리지 않는다.
 */
export function requiredStates(
  checks: readonly CommitCheck[],
  ci: Pick<HarnessConfig['ci'], 'requiredChecks' | 'recorderBot'>,
): RequiredState[] {
  return ci.requiredChecks.map((want) => {
    let latest: CommitCheck | null = null;
    for (const c of checks) {
      if (c.context !== want.context) continue;
      const mine =
        want.source === 'recorder'
          ? c.kind === 'status' && !!ci.recorderBot && c.creator === ci.recorderBot
          : c.kind === 'check-run' && c.appId === ACTIONS_APP_ID;
      if (!mine) continue;
      // 시각이 같으면 앞에 온 것을 쓴다(목록은 최신순으로 온다)
      if (!latest || c.at > latest.at) latest = c;
    }
    return {
      context: want.context,
      source: want.source,
      state: latest?.state ?? 'missing',
      description: latest?.description ?? '',
      targetUrl: latest?.targetUrl ?? '',
      at: latest?.at ?? '',
    };
  });
}

/**
 * 검증자의 판정은 모두 났는데(승인이든 수정 요청이든) 상태가 없는 게이트의 이름(설정 순서).
 * 게이트는 push 직후에 돌고 판정보다 먼저 끝난다. 판정이 난 뒤에도 게이트 상태가 없으면 기다려도 오지 않는다:
 * `gates` 실행이 취소됐거나 다른 head에 기록됐다(Issue #181). 필수 체크에 검증자 판정이 없으면 빈 배열이다
 */
export function gatesMissing(required: readonly RequiredState[]): string[] {
  const has = (list: readonly string[], context: string) => list.includes(context);
  const reviews = required.filter((r) => has(REVIEW_CONTEXTS, r.context));
  if (reviews.length === 0) return [];
  if (reviews.some((r) => r.state !== 'success' && r.state !== 'failure')) return [];
  return required
    .filter((r) => has(GATE_CONTEXTS, r.context) && r.state === 'missing')
    .map((r) => r.context);
}

/**
 * PR 하나가 지금 무엇을 필요로 하는가.
 * - fix: 세션이 고칠 실패(check, plan-gate·deps-guard·harness-guard)
 * - review: 검증자의 수정 요청이나 원장의 열린 차단 지적
 * - infra-error: 판정을 내지 못한 체크가 있다(검증자 장애, 기록 실패). 기다린다
 * - wait-ci: 진행 중이거나 아직 없는 필수 체크가 있다
 * - behind: 다른 조건은 갖췄고 main에 뒤처졌다(승인을 이어받을 수 있을 때만 갱신한다)
 * - approval: 제작자의 head 승인만 남았다
 * - ready: 조치할 것이 없다(GitHub 자동 병합을 기다리거나, 끝나지 않은 step의 PR이면 다음 일을 한다)
 */
export type PrVerdict =
  | { kind: 'closed' }
  | { kind: 'conflict' }
  | { kind: 'fix'; failing: RequiredState[] }
  | { kind: 'review' }
  | { kind: 'infra-error'; failing: RequiredState[] }
  | { kind: 'wait-ci'; waiting: string[] }
  | { kind: 'behind' }
  | { kind: 'approval' }
  | { kind: 'ready' };

const RISK_CONTEXT = 'risk-gate';
const PLAN_CONTEXT = 'plan-gate';
const isReview = (context: string) => context.startsWith('review/') || context === LEDGER_CONTEXT;

export function classifyPr(i: {
  pr: PullRequest;
  required: readonly RequiredState[];
  /** main에 뒤처졌는가(로컬 git으로 판단한다) */
  behind: boolean;
  /** 이 PR이 맡은 step이 completed인가. 아니면 계획 검증 중이거나 진행 중인 PR이다 */
  stepCompleted: boolean;
}): PrVerdict {
  if (i.pr.state !== 'open') return { kind: 'closed' };
  // 충돌한 PR은 pull_request 워크플로가 돌지 않아 아무것도 진행되지 않는다. 먼저 푼다
  if (i.pr.mergeState === 'DIRTY') return { kind: 'conflict' };
  // check가 실패하면 판정 워크플로가 돌지 않는다. 다른 체크를 기다리지 않는다
  const actionsFailed = i.required.filter((r) => r.source === 'actions' && r.state === 'failure');
  if (actionsFailed.length) return { kind: 'fix', failing: actionsFailed };
  const waiting = i.required.filter((r) => r.state === 'pending' || r.state === 'missing');
  if (waiting.length) return { kind: 'wait-ci', waiting: waiting.map((r) => r.context) };

  const failed = i.required.filter((r) => r.state === 'failure');
  const reviewFailed = failed.some((r) => isReview(r.context));
  const errors = i.required.filter((r) => r.state === 'error');
  // step이 끝나지 않은 PR에서 plan-gate 실패는 예상된 것이다("step이 completed가 아니다").
  // deps-guard·harness-guard 실패는 step 완료와 무관하게 고쳐야 한다(PR #93 F2)
  const gateFailed = failed.filter(
    (r) =>
      !isReview(r.context) &&
      r.context !== RISK_CONTEXT &&
      (i.stepCompleted || r.context !== PLAN_CONTEXT),
  );
  if (gateFailed.length) return { kind: 'fix', failing: gateFailed };
  if (!i.stepCompleted) {
    // step이 끝나지 않은 PR: risk-gate 실패와 뒤처짐은 지금 볼 일이 아니다
    if (reviewFailed) return { kind: 'review' };
    if (errors.length) return { kind: 'infra-error', failing: errors };
    return { kind: 'ready' };
  }
  if (reviewFailed) return { kind: 'review' };
  if (errors.length) return { kind: 'infra-error', failing: errors };
  if (i.behind) return { kind: 'behind' };
  if (failed.some((r) => r.context === RISK_CONTEXT)) return { kind: 'approval' };
  return { kind: 'ready' };
}

/** 분류를 사람이 읽을 한 줄로 */
export function describeVerdict(v: PrVerdict): string {
  switch (v.kind) {
    case 'closed':
      return 'closed (열려 있지 않다)';
    case 'conflict':
      return 'conflict (main과 충돌: origin/main을 병합해 푼다)';
    case 'fix':
      return `fix (고칠 실패: ${v.failing.map((f) => f.context).join(', ')})`;
    case 'review':
      return 'review (검증자의 수정 요청 또는 원장의 열린 차단 지적)';
    case 'infra-error':
      return `infra-error (판정 없음: ${v.failing.map((f) => f.context).join(', ')})`;
    case 'wait-ci':
      return `wait-ci (대기: ${v.waiting.join(', ')})`;
    case 'behind':
      return 'behind (main에 뒤처짐: origin/main을 병합해 갱신한다)';
    case 'approval':
      return 'approval (제작자의 head 승인 대기)';
    case 'ready':
      return 'ready (조치할 것 없음)';
  }
}
