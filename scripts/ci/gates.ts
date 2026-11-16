// 판정 job(gates 워크플로 evaluate)의 기계 판정 묶음(10.3·10.4절).
// main(base/)의 이 스크립트가 PR head 체크아웃(pr/)을 데이터로만 읽는다. PR 코드를 실행하지 않고 비밀이 없다.
// 설정(cfg)은 반드시 main 쪽에서 읽는다. PR이 판정 기준을 함께 바꿀 수 있기 때문이다.
import type { HarnessConfig } from '../lib/config.ts';
import { formatProblem } from '../lib/util.ts';
import { depsGuard, httpRegistry, type Registry } from '../gates/deps-guard.ts';
import { harnessGuard } from '../gates/harness-guard.ts';
import { planGate, type PlanG1 } from '../gates/plan-gate.ts';
import {
  revertCheck,
  revertTarget,
  type RevertCheck,
  type TargetCheck,
} from '../gates/revert-check.ts';
import { riskGate, type Review, type Risk, type RiskSignal } from '../gates/risk-gate.ts';
import { REVIEWERS, type PlanReview } from './ledger.ts';
import { planHashes } from './plan-hash.ts';
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
  /** PR 리뷰(제작자 승인 확인용). 조회하지 못했으면 null */
  reviews?: Review[] | null;
  /** PR 본문(보호 경로 체크리스트 확인용). 읽지 못했으면 null */
  prBody?: string | null;
  /** 레지스트리·OSV 조회. 기본은 실제 HTTP(lockfile이 바뀌었을 때만 부른다) */
  registry?: Registry;
  now?: Date;
  /**
   * 원장(검증 App 봇 댓글)의 계획 승인을 읽는다(G1). 없으면 null. 계획이 merge-base와 다를 때만 부른다.
   * 주지 않으면(PR 번호를 모른다) 승인이 없는 것으로 본다
   */
  planReview?: () => Promise<PlanReview | null>;
  /**
   * revert 대상 커밋의 main `check` 결론(10.3절 revert-check). 브랜치가 `revert/<SHA>` 꼴일 때만 부른다.
   * 주지 않으면 조회하지 못한 것(null)으로 본다
   */
  targetCheck?: () => Promise<TargetCheck>;
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

/**
 * G1 판정 자료(4.1·10.3절). 계획 폴더가 없으면(소규모, 계획 없음) undefined.
 * 원장을 읽지 못하면: 켜져 있을 때는 예외(plan-gate = error, fail-closed), 꺼져 있을 때는 원장을 보지 않은 것으로 둔다
 */
async function planG1(o: RunGatesOptions): Promise<PlanG1 | undefined> {
  const h = planHashes(o.root, o.base, o.branch);
  if (!h) return undefined;
  const g: PlanG1 = { ...h, review: null, reviewers: REVIEWERS };
  if (h.hash === h.baseHash || !o.planReview) return g;
  try {
    return { ...g, review: await o.planReview() };
  } catch (e) {
    if (o.cfg.planReview.required)
      throw new Error(`계획 승인을 확인할 원장을 읽지 못했다 — ${firstLine(e)}`, { cause: e });
    return { ...h, reviewers: REVIEWERS };
  }
}

function planGateResult(o: RunGatesOptions, g1: PlanG1 | undefined): Omit<GateResult, 'context'> {
  const r = planGate({ root: o.root, base: o.base, branch: o.branch, mode: 'pr', cfg: o.cfg, g1 });
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

export async function runGates(o: RunGatesOptions): Promise<GateResults> {
  const signals: RiskSignal[] = [];
  let risk: Risk | undefined;
  // 확인된 revert PR이면 plan-gate는 계획을 요구하지 않고 harness-guard는 작성자 체크리스트를 보지 않는다
  let revert: RevertCheck | undefined;
  const byContext: Record<(typeof GATE_CONTEXTS)[number], () => GateResult | Promise<GateResult>> =
    {
      'revert-check': async () => {
        try {
          const tc = revertTarget(o.branch) && o.targetCheck ? await o.targetCheck() : null;
          const r = revertCheck({ root: o.root, base: o.base, branch: o.branch, targetCheck: tc });
          revert = r;
          return {
            context: 'revert-check',
            state: r.state,
            description: r.description,
            details: r.details,
          };
        } catch (e) {
          return guarded('revert-check', () => {
            throw e;
          });
        }
      },
      'plan-gate': async () => {
        if (revert?.verified)
          return {
            context: 'plan-gate',
            state: 'success',
            description: 'revert PR: 계획 불필요',
            details: [],
          };
        try {
          const g1 = await planG1(o);
          return guarded('plan-gate', () => planGateResult(o, g1));
        } catch (e) {
          return guarded('plan-gate', () => {
            throw e;
          });
        }
      },
      'harness-guard': () => {
        const g = guarded('harness-guard', () => {
          const r = harnessGuard({
            root: o.root,
            base: o.base,
            cfg: o.cfg,
            prBody: o.prBody ?? null,
            skipAuthorChecks: revert?.verified === true,
          });
          signals.push(...r.signals);
          return r.result;
        });
        // 검사가 죽어 신호를 알 수 없으면 위험도를 높음으로 본다(fail-closed)
        if (g.state === 'error' && !signals.length)
          signals.push({ risk: 'high', reason: 'harness-guard가 판정하지 못했다' });
        return g;
      },
      'deps-guard': async () => {
        try {
          const r = await depsGuard({
            root: o.root,
            base: o.base,
            cfg: o.cfg,
            registry: o.registry ?? httpRegistry(o.cfg.deps),
            now: o.now ?? new Date(),
          });
          return { context: 'deps-guard', ...r };
        } catch (e) {
          return guarded('deps-guard', () => {
            throw e;
          });
        }
      },
      'risk-gate': () =>
        guarded('risk-gate', () => {
          const r = riskGate({ ...o, signals, reviews: o.reviews ?? null });
          risk = r.risk;
          return { state: r.state, description: r.description, details: r.details };
        }),
    };
  const results: GateResult[] = [];
  for (const c of GATE_CONTEXTS) results.push(await byContext[c]());
  return { version: 1, headSha: o.headSha, results, ...(risk ? { risk } : {}) };
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
