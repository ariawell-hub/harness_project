// metrics(17.2절): 지표를 집계해 출력하고, --write면 docs/QUALITY_SCORE.md의 표식 구간을 바꾼다.
// GitHub은 읽기만 한다. 순서가 규칙이다: 기간 검사 → 쓰기 전 조건 → 자료 읽기 → 계산 → 출력·쓰기.
// 자료를 다 읽지 못하면 아무것도 내지 않는다(종료 코드 2). 메인 체크아웃과 기본 브랜치에서는 쓰지 않는다(R3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ledger } from '../ci/ledger.ts';
import { loadConfig } from '../lib/config.ts';
import { repoInfo } from '../lib/git.ts';
import { isMainCheck, pilotMetrics } from '../metrics/pilot.ts';
import { renderBlock, replaceBlock } from '../metrics/render.ts';
import {
  daysBefore,
  defaultSource,
  parsePeriod,
  type MetricsSource,
  type Period,
} from '../metrics/source.ts';

export const METRICS_DOC = 'docs/QUALITY_SCORE.md';
/** 기간 직전의 main `check` 결론을 찾으러 거슬러 올라가는 날 수 */
const PRIOR_DAYS = 7;

export interface MetricsOptions {
  since?: string;
  until?: string;
  write: boolean;
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
    let last: { t: number; conclusion: 'success' | 'failure' } | null = null;
    for (const r of source.workflowRuns({ since: day, until: day })) {
      if (!isMainCheck(r, defaultBranch)) continue;
      if (r.conclusion !== 'success' && r.conclusion !== 'failure') continue;
      const t = Date.parse(r.createdAt);
      if (Number.isNaN(t)) continue;
      if (!last || t >= last.t) last = { t, conclusion: r.conclusion };
    }
    if (last) return last.conclusion;
  }
  return null;
}

export function runMetrics(cwd: string, o: MetricsOptions, source?: MetricsSource): number {
  const out = o.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l: string) => process.stderr.write(`${l}\n`));

  // ① 기간
  let period: Period;
  try {
    period = parsePeriod(o.since, o.until, o.now ?? new Date());
  } catch (e) {
    err(`metrics: ${first(e)}. 날짜는 UTC 기준 YYYY-MM-DD로 준다(예: --since 2026-11-11)`);
    return 1;
  }

  // ② 쓰기 전 조건. GitHub을 읽기 전에 본다
  const info = repoInfo(cwd);
  const cfg = loadConfig(info.root);
  const file = path.join(info.root, METRICS_DOC);
  if (o.write) {
    if (info.isMainCheckout || info.branch === cfg.github.defaultBranch) {
      err(
        `metrics: 메인 체크아웃과 기본 브랜치(${cfg.github.defaultBranch})에서는 --write로 파일을 고치지 않는다(R3). 작업 worktree에서 실행하라. 값만 보려면 --write를 빼라`,
      );
      return 1;
    }
    if (!existsSync(file)) {
      err(`metrics: ${METRICS_DOC}가 없다. 문서를 만들고 표식 구간을 넣은 뒤 다시 실행하라`);
      return 1;
    }
    if (replaceBlock(readFileSync(file, 'utf8'), '') === null) {
      err(
        `metrics: ${METRICS_DOC}에서 표식 구간을 찾지 못했다. "<!-- metrics:begin -->" 줄과 "<!-- metrics:end -->" 줄을 이 순서로 하나씩 넣어라`,
      );
      return 1;
    }
  }

  // ③ 자료 읽기. 하나라도 읽지 못하면 값을 내지 않는다
  let block: string;
  try {
    const src = source ?? defaultSource(info.root, cfg);
    const prs = src.mergedPrs(period);
    const runs = src.workflowRuns(period);
    const bugs = src.bugIssues(period);
    const ledgers = new Map<number, Ledger | null>();
    for (const p of prs) ledgers.set(p.number, src.ledger(p.number));
    const prior = priorMainCheck(src, period, cfg.github.defaultBranch);
    // ④ 계산·렌더
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
    );
  } catch (e) {
    err(
      `metrics: ${first(e)}. 집계하지 않았고 문서도 바꾸지 않았다(자료를 일부만 읽은 값은 내지 않는다). gh 인증과 네트워크를 확인하고 다시 실행하라`,
    );
    return 2;
  }

  // ⑤ 출력·쓰기
  out(block);
  if (o.write) {
    // 자료를 읽는 동안 문서가 바뀌었을 수 있다. 지금 내용에서 구간만 바꾼다
    const next = existsSync(file) ? replaceBlock(readFileSync(file, 'utf8'), block) : null;
    if (next === null) {
      err(`metrics: 자료를 읽는 동안 ${METRICS_DOC}의 표식 구간이 사라졌다. 문서를 쓰지 않았다`);
      return 1;
    }
    writeFileSync(file, next);
    err(`metrics: ${METRICS_DOC}의 집계 결과를 바꿨다`);
  }
  return 0;
}
