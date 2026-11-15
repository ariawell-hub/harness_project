// 어떤 검증자가 필요한가(10.1절 검증자 구성·위험도별 검증 수준).
// 낮음: 작성 도구와 다른 도구 1명(B). 보통·높음: A + B. 실행하지 않는 검증자는 기록 job이 "해당 없음(통과)"으로 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { harnessGuard } from '../gates/harness-guard.ts';
import { assessRisk, type Risk, type RiskSignal } from '../gates/risk-gate.ts';
import type { HarnessConfig } from '../lib/config.ts';
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

export interface ReviewPlan {
  risk: Risk;
  reasons: string[];
  author: string;
  claude: boolean;
  codex: boolean;
}

/**
 * 판정 워크플로의 첫 job이 쓰는 계산. gates 워크플로와 같은 위험도가 나오도록 harness-guard 신호를 함께 본다.
 * 계산하지 못하면 높음으로 본다(fail-closed, 두 검증자).
 */
export function planReview(o: {
  root: string;
  cfg: HarnessConfig;
  base: string;
  branch: string;
}): ReviewPlan {
  const author = planAuthor(o.root, o.branch);
  let risk: Risk = 'high';
  let reasons: string[];
  try {
    let signals: RiskSignal[];
    try {
      signals = harnessGuard({ root: o.root, base: o.base, cfg: o.cfg, prBody: null }).signals;
    } catch {
      signals = [{ risk: 'high', reason: 'harness-guard가 판정하지 못했다' }];
    }
    ({ risk, reasons } = assessRisk({ ...o, signals }));
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    reasons = [`위험도를 계산하지 못했다: ${msg}`];
  }
  return { risk, reasons, author, ...reviewersFor(risk, author) };
}
