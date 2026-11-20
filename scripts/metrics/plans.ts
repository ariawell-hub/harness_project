// PR의 계획 생성 시각. PR의 head 브랜치 이름으로 계획 파일을 찾아 frontmatter의 claimed_at을 읽는다. 파일만 읽는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findPlan, parseBranch, parseDoc } from '../lib/plan.ts';
import type { MergedPr } from './source.ts';

/**
 * PR 번호 → 그 PR의 계획 frontmatter `claimed_at`(`new-task`가 채운다).
 * 브랜치 이름이 계획 형식이 아니거나(revert PR 등) 계획 파일·값이 없는 PR은 넣지 않는다.
 * `root`는 명령을 실행한 체크아웃이다: 그 체크아웃에 없는 계획의 PR은 찾지 못한다
 */
export function planClaimedAt(root: string, prs: MergedPr[]): Map<number, string> {
  const byPlan = new Map<string, string | null>();
  const out = new Map<number, string>();
  for (const p of prs) {
    const id = parseBranch(p.head)?.id;
    if (!id) continue;
    if (!byPlan.has(id)) byPlan.set(id, claimedAt(root, id));
    const at = byPlan.get(id);
    if (at) out.set(p.number, at);
  }
  return out;
}

function claimedAt(root: string, id: string): string | null {
  const ref = findPlan(root, id);
  if (!ref) return null;
  const v = parseDoc(readFileSync(path.join(root, ref.file), 'utf8')).frontmatter?.claimed_at;
  return typeof v === 'string' && v ? v : null;
}
