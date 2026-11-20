// metrics(17.2절): 지표를 집계해 표준 출력에 낸다. 파일을 쓰지 않는다.
// GitHub은 읽기만 한다. 순서가 규칙이다: 기간 검사 → 자료 읽기 → 계산·렌더 → 출력.
// 자료를 다 읽지 못하면 아무것도 내지 않는다(종료 코드 2).
// 출력은 docs/QUALITY_SCORE.md의 표식 구간에 그대로 붙여 넣는 글이다. 문서에는 작업자가 붙여 넣어 기록한다.
import type { Ledger } from '../ci/ledger.ts';
import { loadConfig } from '../lib/config.ts';
import { repoInfo } from '../lib/git.ts';
import { isMainCheck, pilotMetrics, runOrder } from '../metrics/pilot.ts';
import { planClaimedAt } from '../metrics/plans.ts';
import { renderBlock } from '../metrics/render.ts';
import {
  daysBefore,
  defaultSource,
  parsePeriod,
  type HeadStatus,
  type MergedPr,
  type MetricsSource,
  type Period,
  type WorkflowRun,
} from '../metrics/source.ts';
import { steadyMetrics } from '../metrics/steady.ts';

/** 기간 직전의 main `check` 결론을 찾으러 거슬러 올라가는 날 수 */
const PRIOR_DAYS = 7;

export interface MetricsOptions {
  since?: string;
  until?: string;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/**
 * 기간 직전의 마지막 main `check` 실행(결론이 success·failure인 것)의 결론.
 * 전날부터 하루씩 거슬러 그런 실행이 처음 나온 날의 가장 늦은 실행을 쓴다. 없으면 null
 */
function priorMainCheck(
  source: MetricsSource,
  p: Period,
  defaultBranch: string,
): 'success' | 'failure' | null {
  for (let n = 1; n <= PRIOR_DAYS; n++) {
    const day = daysBefore(p.since, n);
    let last: (WorkflowRun & { conclusion: 'success' | 'failure' }) | null = null;
    for (const r of source.workflowRuns({ since: day, until: day })) {
      if (!isMainCheck(r, defaultBranch)) continue;
      if (r.conclusion !== 'success' && r.conclusion !== 'failure') continue;
      if (Number.isNaN(Date.parse(r.createdAt))) continue;
      // 가장 늦은 실행. 순서 기준은 기간 안의 전환 판정과 같다(runOrder)
      if (!last || runOrder(r, last) >= 0) last = { ...r, conclusion: r.conclusion };
    }
    if (last) return last.conclusion;
  }
  return null;
}

/**
 * 실행을 읽기 시작할 날: `since`와 기간에 병합된 PR이 열린 날 가운데 가장 이른 날.
 * 기간 전에 열린 PR의 첫 `check` 실행을 보기 위해서다(CI 첫 통과율). 파일럿 지표는 기간 안의 실행만 센다
 */
function runsSince(p: Period, prs: MergedPr[]): string {
  let since = p.since;
  for (const pr of prs) {
    const t = Date.parse(pr.createdAt);
    if (Number.isNaN(t)) continue;
    const day = new Date(t).toISOString().slice(0, 10);
    if (day < since) since = day;
  }
  return since;
}

export function runMetrics(cwd: string, o: MetricsOptions, source?: MetricsSource): number {
  const out = o.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l: string) => process.stderr.write(`${l}\n`));

  // ① 기간. GitHub을 읽기 전에 본다
  let period: Period;
  try {
    period = parsePeriod(o.since, o.until, o.now ?? new Date());
  } catch (e) {
    err(`metrics: ${first(e)}. 날짜는 UTC 기준 YYYY-MM-DD로 준다(예: --since 2026-11-11)`);
    return 1;
  }

  // ② 자료 읽기. 하나라도 읽지 못하면 값을 내지 않는다
  let block: string;
  try {
    const info = repoInfo(cwd);
    const cfg = loadConfig(info.root);
    const src = source ?? defaultSource(info.root, cfg);
    const prs = src.mergedPrs(period);
    const runs = src.workflowRuns({ since: runsSince(period, prs), until: period.until });
    const bugs = src.bugIssues(period);
    const ledgers = new Map<number, Ledger | null>();
    for (const p of prs) ledgers.set(p.number, src.ledger(p.number));
    const prior = priorMainCheck(src, period, cfg.github.defaultBranch);
    const statuses = new Map<number, HeadStatus[]>();
    const headPrCounts = new Map<number, number>();
    for (const p of prs) {
      statuses.set(p.number, src.headStatuses(p.headSha));
      headPrCounts.set(p.number, src.headPrCount(p.head));
    }
    const labels = src.needsHumanEvents(period);
    const comments = src.escalationComments(period);
    // ③ 계산·렌더
    block = renderBlock(
      period,
      pilotMetrics({
        period,
        defaultBranch: cfg.github.defaultBranch,
        priorMainCheck: prior,
        prs,
        runs,
        bugs,
        ledgers,
      }),
      steadyMetrics({
        period,
        prs,
        runs,
        ledgers,
        statuses,
        recorderBot: cfg.ci.recorderBot ?? '',
        planClaimedAt: planClaimedAt(info.root, prs),
        headPrCounts,
        labels,
        comments,
      }),
    );
  } catch (e) {
    err(
      `metrics: ${first(e)}. 집계하지 않았다(자료를 일부만 읽은 값은 내지 않는다). gh 인증과 네트워크를 확인하고 다시 실행하라`,
    );
    return 2;
  }

  // ④ 출력
  out(block);
  return 0;
}
