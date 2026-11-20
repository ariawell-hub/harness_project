// 상시 지표(17.2절) 가운데 GitHub 자료로 재는 것의 계산. 순수 함수다: 읽은 자료를 받아 값만 낸다.
// 측정 정의는 docs/QUALITY_SCORE.md의 "측정 정의"가 원천이다.
import { REVIEWERS, roundsOf, type Ledger } from '../ci/ledger.ts';
import { CHECK_WORKFLOW, median, runOrder } from './pilot.ts';
import {
  inPeriod,
  type BotComment,
  type EscalationKind,
  type HeadStatus,
  type LabelEvent,
  type MergedPr,
  type Period,
  type WorkflowRun,
} from './source.ts';

/** PR 크기 경고 기준(Q9). 추가 + 삭제 줄 수가 이 값을 넘으면 큰 PR로 센다 */
const SIZE_LIMIT = 400;
/** 리뷰 라운드 기준(19절 4단계 완료 기준) */
const ROUND_LIMIT = 3;
const RISK_CONTEXT = 'risk-gate';
/** `risk-gate`가 description 앞에 적는 문구(scripts/gates/risk-gate.ts) */
const RISK_PREFIX = { low: '위험도 낮음', normal: '위험도 보통', high: '위험도 높음' } as const;
type RiskKey = keyof typeof RISK_PREFIX;

export const ESCALATION_KINDS: readonly EscalationKind[] = [
  'stop-failures',
  'stop-limit',
  'stop-deadlock',
  'stop-conflict',
  'stop-other',
  'question',
  'approval',
  'ci-stall',
  'revert',
];

export interface SteadyInput {
  period: Period;
  prs: MergedPr[];
  runs: WorkflowRun[];
  ledgers: ReadonlyMap<number, Ledger | null>;
  statuses: ReadonlyMap<number, HeadStatus[]>;
  /** 검증 App 봇의 login. 비어 있으면 어느 기록으로도 위험도를 정하지 않는다 */
  recorderBot: string;
  /** PR 번호 → 그 PR의 계획 frontmatter `claimed_at`. 계획을 찾지 못한 PR은 없다 */
  planClaimedAt: ReadonlyMap<number, string>;
  /** PR 번호 → 그 PR의 head 브랜치 이름으로 열린 PR의 수. 없는 PR은 이을 수 없는 것으로 본다 */
  headPrCounts: ReadonlyMap<number, number>;
  labels: LabelEvent[];
  comments: BotComment[];
}

export interface SteadyMetrics {
  /** 계획 생성 → 병합(분) */
  leadTime: { medianMin: number | null; maxMin: number | null; noPlan: number };
  firstPass: {
    /** 첫 `check` 실행이 첫 시도에 통과한 PR 수 */
    passed: number;
    /** 실행을 찾은 PR 수(분모) */
    withRuns: number;
    rate: number | null;
    /** 실행을 PR에 이을 수 없어 뺀 PR 수 */
    unlinkable: number;
    /** 이을 수 있지만 실행을 찾지 못한 PR 수 */
    noRuns: number;
  };
  rounds: { median: number | null; max: number | null; over3: number[] };
  escalation: { labels: number; comments: Record<EscalationKind, number> };
  stops: { failures: number; limit: number };
  risk: Record<RiskKey | 'unknown', number>;
  size: { median: number | null; over400: number };
}

const MIN_MS = 60_000;
const max = (values: number[]) => (values.length ? Math.max(...values) : null);

/**
 * 그 PR의 `check` 실행. 실행 목록은 PR 번호를 주지 않으므로 head 브랜치 이름과 커밋 SHA, 시각으로 잇는다.
 * 조건이 하나라도 어긋나면 그 PR의 실행이 아니다
 */
function runsOfPr(p: MergedPr, opened: number, merged: number, runs: WorkflowRun[]): WorkflowRun[] {
  const commits = new Set(p.commits);
  return runs.filter((r) => {
    if (r.path !== CHECK_WORKFLOW || r.event !== 'pull_request') return false;
    if (!r.sameRepo || r.branch !== p.head || !commits.has(r.headSha)) return false;
    const t = Date.parse(r.createdAt);
    return !Number.isNaN(t) && t >= opened && t <= merged;
  });
}

function firstPass(i: SteadyInput): SteadyMetrics['firstPass'] {
  let passed = 0;
  let withRuns = 0;
  let unlinkable = 0;
  let noRuns = 0;
  for (const p of i.prs) {
    const opened = Date.parse(p.createdAt);
    const merged = Date.parse(p.mergedAt);
    // 같은 head 브랜치 이름으로 열린 PR이 이 PR 하나뿐일 때만 잇는다
    const linkable =
      !p.crossRepo &&
      i.headPrCounts.get(p.number) === 1 &&
      !Number.isNaN(opened) &&
      !Number.isNaN(merged);
    if (!linkable) {
      unlinkable++;
      continue;
    }
    const own = runsOfPr(p, opened, merged, i.runs).sort(runOrder);
    if (!own.length) {
      noRuns++;
      continue;
    }
    withRuns++;
    // 실행 목록은 마지막 시도의 결과만 준다. 재실행된 실행은 첫 시도의 결과를 모르므로 첫 통과가 아니다
    if (own[0].attempt === 1 && own[0].conclusion === 'success') passed++;
  }
  return { passed, withRuns, rate: withRuns ? passed / withRuns : null, unlinkable, noRuns };
}

function riskOf(statuses: HeadStatus[], recorderBot: string): RiskKey | 'unknown' {
  if (!recorderBot) return 'unknown';
  let latest: HeadStatus | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const s of statuses) {
    // 검증 App이 쓴 기록만 쓴다. 커밋 상태는 쓰기 권한이 있으면 누구나 같은 이름으로 쓸 수 있다
    if (s.context !== RISK_CONTEXT || s.creator !== recorderBot) continue;
    const t = Date.parse(s.at);
    if (Number.isNaN(t) || t <= latestAt) continue;
    latest = s;
    latestAt = t;
  }
  if (!latest) return 'unknown';
  for (const key of ['low', 'normal', 'high'] as const)
    if (latest.description.startsWith(RISK_PREFIX[key])) return key;
  return 'unknown';
}

export function steadyMetrics(i: SteadyInput): SteadyMetrics {
  // 리드타임
  const leads: number[] = [];
  let noPlan = 0;
  for (const p of i.prs) {
    const claimed = Date.parse(i.planClaimedAt.get(p.number) ?? '');
    const merged = Date.parse(p.mergedAt);
    if (Number.isNaN(claimed) || Number.isNaN(merged) || merged < claimed) noPlan++;
    else leads.push((merged - claimed) / MIN_MS);
  }

  // 리뷰 라운드
  const rounds = i.prs.map((p) => {
    const l = i.ledgers.get(p.number) ?? null;
    return { pr: p.number, n: l ? Math.max(...REVIEWERS.map((r) => roundsOf(l, r))) : 0 };
  });

  // 에스컬레이션. 라벨과 댓글을 각자의 시각으로 기간에 넣는다
  const comments = Object.fromEntries(ESCALATION_KINDS.map((k) => [k, 0])) as Record<
    EscalationKind,
    number
  >;
  for (const c of i.comments) if (inPeriod(c.at, i.period)) comments[c.kind]++;

  const risk = { low: 0, normal: 0, high: 0, unknown: 0 };
  for (const p of i.prs) risk[riskOf(i.statuses.get(p.number) ?? [], i.recorderBot)]++;

  const sizes = i.prs.map((p) => p.additions + p.deletions);

  return {
    leadTime: { medianMin: median(leads), maxMin: max(leads), noPlan },
    firstPass: firstPass(i),
    rounds: {
      median: median(rounds.map((r) => r.n)),
      max: max(rounds.map((r) => r.n)),
      over3: rounds
        .filter((r) => r.n > ROUND_LIMIT)
        .map((r) => r.pr)
        .sort((a, b) => a - b),
    },
    escalation: {
      labels: i.labels.filter((l) => inPeriod(l.at, i.period)).length,
      comments,
    },
    stops: { failures: comments['stop-failures'], limit: comments['stop-limit'] },
    risk,
    size: { median: median(sizes), over400: sizes.filter((n) => n > SIZE_LIMIT).length },
  };
}
