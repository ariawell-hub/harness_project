// 판정 job(gates 워크플로 evaluate)의 기계 판정 묶음(10.3·10.4절).
// main(base/)의 이 스크립트가 PR head 체크아웃(pr/)을 데이터로만 읽는다. PR 코드를 실행하지 않고 비밀이 없다.
// 설정(cfg)은 반드시 main 쪽에서 읽는다. PR이 판정 기준을 함께 바꿀 수 있기 때문이다.
import type { HarnessConfig } from '../lib/config.ts';
import { formatProblem } from '../lib/util.ts';
import { planGate } from '../gates/plan-gate.ts';
import { GATE_CONTEXTS, type GateResult, type GateResults } from './results.ts';

export interface RunGatesOptions {
  /** PR head 체크아웃(데이터) */
  root: string;
  /** main 설정 */
  cfg: HarnessConfig;
  /** merge-base */
  base: string;
  /** PR head 브랜치 이름 */
  branch: string;
  headSha: string;
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0].slice(0, 200);
}

/** 검사 하나를 격리한다. 예외는 그 context만 error로 만든다 */
function guarded(context: string, fn: () => Omit<GateResult, 'context'>): GateResult {
  try {
    return { context, ...fn() };
  } catch (e) {
    return {
      context,
      state: 'error',
      description: `판정 중 오류: ${firstLine(e)}`,
      details: [String(e instanceof Error ? (e.stack ?? e.message) : e)],
    };
  }
}

function planGateResult(o: RunGatesOptions): Omit<GateResult, 'context'> {
  const r = planGate({ root: o.root, base: o.base, branch: o.branch, mode: 'pr', cfg: o.cfg });
  if (!r.problems.length) {
    return {
      state: 'success',
      description: `통과 (${r.plan?.file ?? o.branch})`,
      details: r.notes.map((n) => `참고: ${n}`),
    };
  }
  const more = r.problems.length > 1 ? ` 외 ${r.problems.length - 1}건` : '';
  return {
    state: 'failure',
    description: `${r.problems[0].what}${more}`,
    details: [...r.problems.map(formatProblem), ...r.notes.map((n) => `참고: ${n}`)],
  };
}

export function runGates(o: RunGatesOptions): GateResults {
  const byContext: Record<(typeof GATE_CONTEXTS)[number], () => GateResult> = {
    'plan-gate': () => guarded('plan-gate', () => planGateResult(o)),
  };
  return {
    version: 1,
    headSha: o.headSha,
    results: GATE_CONTEXTS.map((c) => byContext[c]()),
  };
}

const STATE_MARK: Record<string, string> = { success: '통과', failure: '실패', error: '오류' };

/** 판정 job의 $GITHUB_STEP_SUMMARY용 Markdown */
export function summaryMarkdown(r: GateResults): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const lines = [
    `## 기계 판정 (head \`${r.headSha.slice(0, 12)}\`)`,
    '',
    '| 체크 | 결과 | 설명 |',
    '| --- | --- | --- |',
    ...r.results.map((g) => `| ${g.context} | ${STATE_MARK[g.state]} | ${esc(g.description)} |`),
  ];
  for (const g of r.results) {
    if (!g.details.length) continue;
    lines.push('', `### ${g.context}`, '', '```text', ...g.details, '```');
  }
  return lines.join('\n') + '\n';
}
