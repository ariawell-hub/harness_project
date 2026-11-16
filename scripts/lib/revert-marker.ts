// revert 워크플로가 원래 Issue에 다는 복원용 표식(8.3절 "되돌리기", 10.3절).
// 만드는 쪽(revert 워크플로)과 읽는 쪽(new-task의 계획 복원)이 이 모듈 하나를 쓴다.
// 표식은 Issue 댓글, 곧 외부 입력이다(14.6절): 형식이 정확히 맞는 것만 읽고, 봇 계정이 쓰고 봇만 고친 댓글만 믿는다.
import type { Comment } from './github.ts';
import { PLAN_ID_RE } from './plan.ts';

export interface RevertMarker {
  /** revert된 커밋(40자 SHA) */
  target: string;
  /** 그 커밋에 있던 계획의 id */
  planId: string;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const MARKER_RE = /<!-- harness-revert target=([0-9a-f]{40}) plan=([a-z0-9-]+) -->/g;

/** 표식 한 줄: `<!-- harness-revert target=<40자 SHA> plan=<계획 id> -->` */
export function revertMarker(target: string, planId: string): string {
  if (!SHA_RE.test(target)) throw new Error(`revert 표식의 대상은 40자 SHA여야 한다: ${target}`);
  if (!PLAN_ID_RE.test(planId)) throw new Error(`revert 표식의 계획 id 형식 오류: ${planId}`);
  return `<!-- harness-revert target=${target} plan=${planId} -->`;
}

function same(a: string, b: string): boolean {
  return a !== '' && b !== '' && a.toLowerCase() === b.toLowerCase();
}

/**
 * 봇 계정(`bot`)의 댓글 가운데 가장 최근의 표식(`comments`는 오래된 것부터). 없으면 null.
 * 다른 계정의 댓글, 다른 계정이 고쳤거나 편집 이력을 확인하지 못한 댓글, 형식이 다른 표식은 무시한다
 */
export function findRevertMarker(comments: Comment[], bot: string): RevertMarker | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (!same(c.author, bot)) continue;
    if (!c.history || !c.history.complete || c.history.changes.some((ch) => !same(ch.by, bot)))
      continue;
    let last: RevertMarker | null = null;
    for (const m of c.body.matchAll(MARKER_RE)) {
      if (PLAN_ID_RE.test(m[2])) last = { target: m[1], planId: m[2] };
    }
    if (last) return last;
  }
  return null;
}
