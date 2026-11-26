// 판정 job(gates 워크플로 evaluate)의 기계 판정 묶음(10.3·10.4절).
// main(base/)의 이 스크립트가 PR head 체크아웃(pr/)을 데이터로만 읽는다. PR 코드를 실행하지 않고 비밀이 없다.
// 설정(cfg)은 반드시 main 쪽에서 읽는다. PR이 판정 기준을 함께 바꿀 수 있기 때문이다.
import type { HarnessConfig } from '../lib/config.ts';
import { literalSpan } from '../lib/literal.ts';
import { formatProblem, matchesAny, WARN_PREFIX } from '../lib/util.ts';
import { depsGuard, httpRegistry, type Registry } from '../gates/deps-guard.ts';
import { harnessGuard } from '../gates/harness-guard.ts';
import { prSize } from '../gates/pr-size.ts';
import { scopeCheck } from '../gates/scope.ts';
import { planGate, type PlanG1 } from '../gates/plan-gate.ts';
import {
  revertCheck,
  revertTarget,
  type RevertCheck,
  type TargetCheck,
} from '../gates/revert-check.ts';
import {
  assessRisk,
  changedFiles,
  lastOwnerDecision,
  riskGate,
  type ApprovalContext,
  type ApprovalData,
  type Review,
  type Risk,
  type RiskSignal,
  type Suite,
} from '../gates/risk-gate.ts';
import type { Graphql } from './accept-load.ts';
import { isAncestorOf, ownerApprovalCarry } from './binding.ts';
import { ACTIONS_APP_ID } from './protection.ts';
import { REVIEWERS, type PlanReview } from './ledger.ts';
import { planHashes } from './plan-hash.ts';
import {
  GATE_CONTEXTS,
  WARN_CONTEXTS,
  fitWarnings,
  serializeResults,
  type GateResult,
  type GateResults,
} from './results.ts';

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
  /**
   * 제작자 승인 판정 자료(PR 커밋별 check suite, 강제 push 이력, Issue #250). 위험도가 높음이고 제작자의 마지막
   * 판정 리뷰가 승인일 때만 부른다. 주지 않거나 읽지 못하면(null) 승인을 확인할 수 없다(error)
   */
  approvalInputs?: () => Promise<ApprovalData | null>;
}

const REPO_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const SHA40 = /^[0-9a-f]{40}$/;
const PER_PAGE = 100;
/** `pulls/{n}/commits`는 250개까지만 준다. 그 수에 닿으면 목록이 잘렸을 수 있다 */
const PR_COMMITS_MAX = 250;
const SUITE_PAGES = 10;
const FORCE_PUSH_PAGES = 10;
const FORCE_PUSH_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      timelineItems(first: 100, after: $after, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
        pageInfo { hasNextPage endCursor }
        nodes { ... on HeadRefForcePushedEvent { createdAt } }
      }
    }
  }
}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 응답 꼴이 틀렸다(빈 목록으로 넘기지 않는다) */
class ShapeError extends Error {}

/**
 * 제작자 승인 판정 자료를 읽는다(Issue #250). PR 커밋(REST, 쪽 번호), 커밋마다 check suite(REST, 쪽 번호. 같은 커밋의
 * suite를 거르지 않고 모두), PR head 강제 push 이벤트(GraphQL, `pageInfo`. `totalCount`는 거르기 전 수라 쓰지 않는다).
 * 어느 쪽이든 실패하거나 응답 꼴이 틀리거나 check suite가 `total_count`만큼 오지 않으면 빈 목록이 아니라 null이다(fail-closed)
 */
export async function readApprovalInputs(o: {
  /** REST 경로를 받아 JSON을 돌려준다. 실패는 예외 */
  api: (path: string) => Promise<unknown>;
  graphql: Graphql;
  /** owner/name */
  repo: string;
  pr: number;
}): Promise<ApprovalData | null> {
  const m = REPO_RE.exec(o.repo);
  if (!m || !Number.isInteger(o.pr) || o.pr <= 0) return null;
  try {
    const shas: string[] = [];
    for (let page = 1; ; page++) {
      const list = await o.api(
        `repos/${o.repo}/pulls/${o.pr}/commits?per_page=${PER_PAGE}&page=${page}`,
      );
      if (!Array.isArray(list)) throw new ShapeError();
      for (const c of list) {
        if (!isObj(c) || typeof c.sha !== 'string' || !SHA40.test(c.sha)) throw new ShapeError();
        shas.push(c.sha);
      }
      if (shas.length >= PR_COMMITS_MAX) return null;
      if (list.length < PER_PAGE) break;
    }
    const suites: Record<string, Suite[]> = {};
    for (const sha of shas) {
      const out: Suite[] = [];
      let done = false;
      for (let page = 1; page <= SUITE_PAGES && !done; page++) {
        const r = await o.api(
          `repos/${o.repo}/commits/${sha}/check-suites?per_page=${PER_PAGE}&page=${page}`,
        );
        if (!isObj(r) || !Array.isArray(r.check_suites) || typeof r.total_count !== 'number')
          throw new ShapeError();
        for (const x of r.check_suites) {
          if (!isObj(x) || typeof x.created_at !== 'string') throw new ShapeError();
          const app = x.app;
          if (app !== null && !(isObj(app) && typeof app.id === 'number')) throw new ShapeError();
          if (x.head_branch !== null && typeof x.head_branch !== 'string') throw new ShapeError();
          out.push({
            appId: isObj(app) ? (app.id as number) : 0,
            headBranch: x.head_branch,
            createdAt: x.created_at,
          });
        }
        if (out.length >= r.total_count) done = true;
        // 모은 수가 total_count에 닿기 전에 쪽이 덜 차면 목록이 빠진 것이다(구현 판정 F16)
        else if (r.check_suites.length < PER_PAGE) return null;
      }
      if (!done) return null;
      suites[sha] = out;
    }
    const forcePushedAt: string[] = [];
    let after: string | null = null;
    for (let page = 1; page <= FORCE_PUSH_PAGES; page++) {
      const data = await o.graphql(FORCE_PUSH_QUERY, {
        owner: m[1],
        name: m[2],
        number: o.pr,
        after,
      });
      const repository = isObj(data) ? data.repository : null;
      const pr = isObj(repository) ? repository.pullRequest : null;
      const items = isObj(pr) ? pr.timelineItems : null;
      const info = isObj(items) ? items.pageInfo : null;
      const nodes = isObj(items) ? items.nodes : null;
      if (!isObj(info) || typeof info.hasNextPage !== 'boolean' || !Array.isArray(nodes))
        throw new ShapeError();
      for (const n of nodes) {
        if (!isObj(n) || typeof n.createdAt !== 'string') throw new ShapeError();
        forcePushedAt.push(n.createdAt);
      }
      if (!info.hasNextPage) return { suites, forcePushedAt };
      if (typeof info.endCursor !== 'string' || info.endCursor === '') throw new ShapeError();
      after = info.endCursor;
    }
    return null;
  } catch {
    return null;
  }
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

/**
 * 이 PR에 자체 테스트(gates 워크플로 selftest job, 12.4절)가 필요한가: 보호 경로를 바꿨다(harness-guard와 같은 판단).
 * 판단하지 못하면 true다(fail-closed)
 */
export function selfTestNeeded(o: { root: string; base: string; cfg: HarnessConfig }): boolean {
  try {
    return changedFiles(o.root, o.base).some((f) => matchesAny(f.path, o.cfg.protectedPaths));
  } catch {
    return true;
  }
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
            branch: o.branch,
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
      'risk-gate': async () => {
        // 승인 자료는 위험도 높음이고 제작자의 마지막 판정 리뷰가 승인일 때만 읽는다(API 사용량, Issue #250)
        let approval: ApprovalContext | null = null;
        try {
          const reviews = o.reviews ?? null;
          if (
            o.approvalInputs &&
            reviews &&
            lastOwnerDecision(reviews, o.cfg.github.owner)?.state === 'APPROVED' &&
            assessRisk({ ...o, signals }).risk === 'high'
          ) {
            const data = await o.approvalInputs();
            if (data) {
              const prFiles = changedFiles(o.root, o.base).map((f) => f.path);
              approval = {
                ...data,
                headBranch: o.branch,
                actionsAppId: ACTIONS_APP_ID,
                isAncestor: (a, d) => isAncestorOf(o.root, a, d),
                carry: (h0) => ownerApprovalCarry(o.root, o.base, h0, prFiles),
              };
            }
          }
        } catch {
          approval = null;
        }
        return guarded('risk-gate', () => {
          const r = riskGate({ ...o, signals, reviews: o.reviews ?? null, approval });
          risk = r.risk;
          return { state: r.state, description: r.description, details: r.details };
        });
      },
    };
  const results: GateResult[] = [];
  for (const c of GATE_CONTEXTS) results.push(await byContext[c]());
  // 경고 판정(R15·R18). 확인된 revert PR은 보지 않는다: 크기와 범위는 되돌리는 대상이 정한다
  const warn: Record<(typeof WARN_CONTEXTS)[number], () => Omit<GateResult, 'context'>> = {
    'pr-size': () => {
      const r = prSize({ root: o.root, base: o.base, cfg: o.cfg });
      return { state: r.state, description: r.description, details: r.details };
    },
    scope: () => {
      const r = scopeCheck({ root: o.root, base: o.base, branch: o.branch });
      return { state: r.state, description: r.description, details: r.details };
    },
  };
  for (const c of WARN_CONTEXTS)
    results.push(
      revert?.verified
        ? { context: c, state: 'success', description: 'revert PR: 보지 않는다', details: [] }
        : guarded(c, warn[c]),
    );
  return { version: 1, headSha: o.headSha, results, ...(risk ? { risk } : {}) };
}

const STATE_MARK: Record<string, string> = { success: '통과', failure: '실패', error: '오류' };

/** 경고 판정이 경고를 냈는가(state는 success이고 설명이 `경고: `로 시작한다) */
export function isWarning(g: GateResult): boolean {
  return (
    (WARN_CONTEXTS as readonly string[]).includes(g.context) &&
    g.state === 'success' &&
    g.description.startsWith(WARN_PREFIX)
  );
}

/**
 * 표의 칸에 넣는 글자를 코드 스팬으로 적는다. 설명에는 PR이 정하는 글자(파일 이름)가 들어간다:
 * 코드 스팬 안의 글자는 굵게·링크·HTML·멘션으로 읽히지 않고 그대로 보인다.
 * 코드 스팬은 `literalSpan`이 만들고, 여기서는 표의 칸을 가르는 `|`만 역슬래시로 막는다
 */
export function cellCode(s: string): string {
  return literalSpan(s).replace(/\|/g, '\\|');
}

/** 판정 job의 $GITHUB_STEP_SUMMARY용 Markdown */
export function summaryMarkdown(r: GateResults): string {
  const lines = [
    `## 기계 판정 (head \`${r.headSha.slice(0, 12)}\`)`,
    '',
    '| 체크 | 결과 | 설명 |',
    '| --- | --- | --- |',
    ...r.results.map(
      (g) =>
        `| ${g.context} | ${isWarning(g) ? '경고' : STATE_MARK[g.state]} | ${cellCode(g.description)} |`,
    ),
  ];
  for (const g of r.results) {
    if (!g.details.length) continue;
    lines.push('', `### ${g.context}`, '', '```text', ...g.details, '```');
  }
  return lines.join('\n') + '\n';
}

/**
 * `gates` 명령이 내는 두 가지. 결과 파일(기록 job으로 넘어간다)에는 크기를 맞춘 결과를 쓰고,
 * 판정 job 요약은 원래 결과로 만든다: 크기 때문에 결과 파일에서 뺀 경고와 상세도 요약에는 남는다
 */
export function gatesOutput(r: GateResults): { file: string; summary: string } {
  return { file: serializeResults(fitWarnings(r)), summary: summaryMarkdown(r) };
}
