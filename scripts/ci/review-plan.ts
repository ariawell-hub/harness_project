// 어떤 검증자가 필요한가(10.1절 검증자 구성·위험도별 검증 수준).
// 낮음: 작성 도구와 다른 도구 1명(B). 보통·높음: A + B. 실행하지 않는 검증자는 기록 job이 "해당 없음(통과)"으로 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Risk } from '../gates/risk-gate.ts';
import { findPlan, parseBranch, parseDoc } from '../lib/plan.ts';

export function reviewersFor(risk: Risk, author: string): { claude: boolean; codex: boolean } {
  if (risk !== 'low') return { claude: true, codex: true };
  // 다른 도구 1명: Codex가 썼으면 Claude, 그 밖(Claude Code, 사람, 알 수 없음)은 Codex
  return author === 'codex' ? { claude: true, codex: false } : { claude: false, codex: true };
}

/** PR 트리의 계획 frontmatter `author`. 없으면 '' */
export function planAuthor(root: string, branch: string): string {
  const b = parseBranch(branch);
  const ref = b ? findPlan(root, b.id) : null;
  if (!ref) return '';
  const f = path.join(root, ref.file);
  if (!existsSync(f)) return '';
  const a = parseDoc(readFileSync(f, 'utf8')).frontmatter?.author;
  return typeof a === 'string' ? a : '';
}
