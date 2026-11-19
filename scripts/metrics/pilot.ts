// 파일럿 판정 지표(17.2절): 병합 후 결함, 검증 누락, 오탐, PR당 대기 시간·사용량. 순수 함수다.
// 측정 정의는 docs/QUALITY_SCORE.md에 있다. 서로 다른 사건은 더하지 않고 따로 낸다.
import type { Ledger } from '../ci/ledger.ts';
import { inPeriod, type BugIssue, type MergedPr, type Period, type WorkflowRun } from './source.ts';

export const CHECK_WORKFLOW = '.github/workflows/check.yml';
export const JUDGE_WORKFLOWS = [
  '.github/workflows/judge-claude.yml',
  '.github/workflows/judge-codex.yml',
];
const REVERT_PREFIX = 'revert/';
const MIN_MS = 60_000;

export interface PilotInput {
  period: Period;
  defaultBranch: string;
  /** 기간 직전의 마지막 main `check` 실행(결론이 success·failure인 것)의 결론. 확인하지 못했으면 null */
  priorMainCheck: 'success' | 'failure' | null;
  prs: MergedPr[];
  runs: WorkflowRun[];
  bugs: BugIssue[];
  ledgers: ReadonlyMap<number, Ledger | null>;
}

export interface PilotMetrics {
  mergedPrs: number;
  /** 병합 후 결함. 세 값은 같은 결함을 가리킬 수 있어 더하지 않는다 */
  defects: {
    mainCheckFailures: number;
    /** 다시 실행한 뒤 통과한 main `check` 실행 */
    passedAfterRerun: number;
    revertPrs: number[];
    bugIssues: number[];
  };
  /** 검증 누락 */
  missed: {
    /** 병합 커밋에서 main `check`가 실패로 바뀐 PR */
    prs: number[];
    /** 실패로 바뀌었지만 원인 PR을 찾지 못한 실행 수 */
    unattributed: number;
    /** 기간 첫 실행이 실패인데 직전 결론을 몰라 전환 여부를 가리지 못한 수 */
    unknownTransition: number;
  };
  falsePositives: {
    /** 차단 지적: P0·P1이고 동결(deferred)이 아닌 것 */
    blocking: number;
    notReproduced: number;
    rejected: number;
    /** 둘 중 하나라도 해당하는 지적 */
    either: number;
    rate: number | null;
  };
  wait: { medianMin: number | null; maxMin: number | null };
  usage: {
    actionsMin: number;
    judgeMin: number;
    actionsMinPerPr: number | null;
    judgeMinPerPr: number | null;
    rounds: number;
    roundsPerPr: number | null;
    failedJudgeRuns: number;
  };
  /** 시각이 깨져 세지 못한 항목 수 */
  skipped: number;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const numeric = (a: number, b: number) => a - b;

/** main의 push로 돈 끝난 `check` 실행인가(기간은 보지 않는다) */
export function isMainCheck(r: WorkflowRun, defaultBranch: string): boolean {
  return (
    r.path === CHECK_WORKFLOW &&
    r.event === 'push' &&
    r.branch === defaultBranch &&
    r.status === 'completed'
  );
}

export function pilotMetrics(i: PilotInput): PilotMetrics {
  let skipped = 0;
  const perPr = (v: number) => (i.prs.length ? v / i.prs.length : null);

  // 시각이 깨진 실행은 어느 지표에도 넣지 않는다
  const runs: WorkflowRun[] = [];
  for (const r of i.runs) {
    if (Number.isNaN(Date.parse(r.createdAt))) skipped++;
    else if (inPeriod(r.createdAt, i.period)) runs.push(r);
  }

  // ── 병합 후 결함 ──
  const mainChecks = runs.filter((r) => isMainCheck(r, i.defaultBranch));
  const mainCheckFailures = mainChecks.filter((r) => r.conclusion === 'failure').length;
  const passedAfterRerun = mainChecks.filter(
    (r) => r.conclusion === 'success' && r.attempt >= 2,
  ).length;
  const revertPrs = i.prs
    .filter((p) => p.head.startsWith(REVERT_PREFIX))
    .map((p) => p.number)
    .sort(numeric);
  const bugIssues = i.bugs.map((b) => b.number).sort(numeric);

  // ── 검증 누락: 성공에서 실패로 바뀐 실행의 원인 PR ──
  const byMergeSha = new Map<string, number>();
  for (const p of i.prs) if (p.mergeSha) byMergeSha.set(p.mergeSha, p.number);
  const decided = mainChecks
    .filter((r) => r.conclusion === 'success' || r.conclusion === 'failure')
    .map((r, n) => ({ r, n, t: Date.parse(r.createdAt) }))
    .sort((a, b) => a.t - b.t || a.n - b.n);
  const missed = new Set<number>();
  let unattributed = 0;
  let unknownTransition = 0;
  let prev: string | null = i.priorMainCheck;
  for (const { r } of decided) {
    if (r.conclusion === 'failure') {
      if (prev === null) unknownTransition++;
      else if (prev === 'success') {
        const cause = r.headSha ? byMergeSha.get(r.headSha) : undefined;
        if (cause === undefined) unattributed++;
        else missed.add(cause);
      }
    }
    prev = r.conclusion;
  }

  // ── 오탐 ──
  let blocking = 0;
  let notReproduced = 0;
  let rejected = 0;
  let either = 0;
  let rounds = 0;
  for (const l of i.ledgers.values()) {
    if (!l) continue;
    rounds += l.rounds.length;
    for (const f of l.findings) {
      if ((f.severity !== 'P0' && f.severity !== 'P1') || f.status === 'deferred') continue;
      blocking++;
      const nr = f.repro === 'not-reproduced';
      const rj = f.status === 'rejected';
      if (nr) notReproduced++;
      if (rj) rejected++;
      if (nr || rj) either++;
    }
  }

  // ── PR당 대기 시간 ──
  const waits: number[] = [];
  for (const p of i.prs) {
    const d = Date.parse(p.mergedAt) - Date.parse(p.createdAt);
    if (Number.isNaN(d) || d < 0) skipped++;
    else waits.push(d / MIN_MS);
  }

  // ── PR당 사용량 ──
  let actionsMin = 0;
  let judgeMin = 0;
  let failedJudgeRuns = 0;
  for (const r of runs) {
    if (r.status !== 'completed') continue;
    const judge = JUDGE_WORKFLOWS.includes(r.path);
    if (judge && r.conclusion === 'failure') failedJudgeRuns++;
    const d = Date.parse(r.updatedAt) - Date.parse(r.startedAt);
    if (Number.isNaN(d) || d < 0) {
      skipped++;
      continue;
    }
    actionsMin += d / MIN_MS;
    if (judge) judgeMin += d / MIN_MS;
  }

  return {
    mergedPrs: i.prs.length,
    defects: { mainCheckFailures, passedAfterRerun, revertPrs, bugIssues },
    missed: { prs: [...missed].sort(numeric), unattributed, unknownTransition },
    falsePositives: {
      blocking,
      notReproduced,
      rejected,
      either,
      rate: blocking ? either / blocking : null,
    },
    wait: { medianMin: median(waits), maxMin: waits.length ? Math.max(...waits) : null },
    usage: {
      actionsMin,
      judgeMin,
      actionsMinPerPr: perPr(actionsMin),
      judgeMinPerPr: perPr(judgeMin),
      rounds,
      roundsPerPr: perPr(rounds),
      failedJudgeRuns,
    },
    skipped,
  };
}
