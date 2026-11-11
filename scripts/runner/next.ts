// 다음 할 일 고르기 (4.5절 우선순위, S1). runner와 대화 세션의 `start`가 함께 쓴다.
//   1. 답을 받은 needs-human 항목
//   2. 내 PR 중 조치가 필요한 것(체크 실패, main에 뒤처짐)
//   3. 내가 맡은 계획의 진행 중인 step (계획 작성 포함)
//   4. 앞 step이 병합된 계획의 다음 step
//   5. 선점되지 않은 Issue (우선순위 라벨 순, WIP 상한 안에서)
//   6. 없으면 idle (CI·사람 대기 수 포함)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import type { GitHubPort, Issue, PullRequest } from '../lib/github.ts';
import { gitTry, listWorktrees, showFile } from '../lib/git.ts';
import {
  PLANS_DIR,
  findPlan,
  parseBranch,
  parseDoc,
  parseIndex,
  readIndex,
  smallPlanFields,
  type Frontmatter,
  type PlanRef,
} from '../lib/plan.ts';

export interface LocalPlan {
  worktree: string;
  branch: string;
  id: string;
  step: number | null;
  ref: PlanRef;
  fm: Frontmatter;
  issue: number;
  /** step 상태(소규모는 계획 status로 대신) */
  stepStatus: string;
  /** 계획 작성이 아직 안 됨(status=draft) */
  needsPlanning: boolean;
  pr: PullRequest | null;
}

export type Task =
  | { kind: 'answered'; issue: number; answer: string; local: LocalPlan | null }
  | { kind: 'fix-pr'; local: LocalPlan; pr: PullRequest }
  | { kind: 'rebase'; local: LocalPlan; pr: PullRequest }
  | { kind: 'plan'; local: LocalPlan }
  | { kind: 'step'; local: LocalPlan }
  | { kind: 'next-step'; id: string; step: number; issue: number }
  | { kind: 'new-issue'; issue: Issue }
  | { kind: 'idle' };

export interface Pick {
  task: Task;
  reason: string;
  waiting: { ci: number; human: number };
}

export interface NextEnv {
  main: string;
  cfg: HarnessConfig;
  gh: GitHubPort;
  worker: string;
}

export function readLocalPlans(env: NextEnv): LocalPlan[] {
  const out: LocalPlan[] = [];
  for (const wt of listWorktrees(env.main)) {
    if (path.resolve(wt.path) === path.resolve(env.main) || !wt.branch || !existsSync(wt.path))
      continue;
    const b = parseBranch(wt.branch);
    if (!b) continue;
    const ref = findPlan(wt.path, b.id);
    if (!ref) continue;
    const doc = parseDoc(readFileSync(path.join(wt.path, ref.file), 'utf8'));
    const fm = doc.frontmatter ?? {};
    let stepStatus = String(fm.status ?? '');
    let needsPlanning = fm.status === 'draft';
    if (ref.kind === 'multi') {
      try {
        const idx = readIndex(wt.path, ref);
        stepStatus = idx.steps[b.step ?? 0]?.status ?? 'pending';
        if (idx.steps.length === 0) needsPlanning = true;
      } catch {
        needsPlanning = true;
      }
    } else if (!smallPlanFields(doc.body).검증) needsPlanning = true;
    let pr: PullRequest | null = null;
    try {
      pr = env.gh.findPRByBranch(wt.branch);
    } catch {
      pr = null;
    }
    out.push({
      worktree: wt.path,
      branch: wt.branch,
      id: b.id,
      step: b.step,
      ref,
      fm,
      issue: Number(fm.issue ?? 0),
      stepStatus,
      needsPlanning,
      pr,
    });
  }
  return out;
}

function latestOwnerAnswer(gh: GitHubPort, owner: string, issue: number): string | null {
  if (!owner) return null;
  const comments = gh.comments(issue);
  const last = comments[comments.length - 1];
  // 답변 인정 기준(9.1절): 제작자 계정의 댓글만. 마지막 댓글이 제작자여야 "답을 받음"
  return last && last.author === owner ? last.body : null;
}

function priorityOf(issue: Issue, labels: string[]): number {
  const i = labels.findIndex((l) => issue.labels.includes(l));
  return i < 0 ? labels.length : i;
}

export function pickNext(env: NextEnv): Pick {
  const { cfg, gh, worker } = env;
  const label = cfg.github.needsHumanLabel;
  const locals = readLocalPlans(env);
  const mine = locals.filter((l) => String(l.fm.owner ?? '') === worker);
  const issues = gh.listOpenIssues();
  const humanIssues = new Set<number>();

  // 1. 답을 받은 needs-human
  for (const issue of issues.filter((i) => i.labels.includes(label))) {
    const answer = latestOwnerAnswer(gh, cfg.github.owner, issue.number);
    const local = mine.find((l) => l.issue === issue.number) ?? null;
    if (answer && (local || !locals.some((l) => l.issue === issue.number))) {
      return {
        task: { kind: 'answered', issue: issue.number, answer, local },
        reason: `#${issue.number}에 제작자 답변이 있다`,
        waiting: { ci: 0, human: 0 },
      };
    }
    humanIssues.add(issue.number);
  }

  // 2. 내 PR 중 조치가 필요한 것
  let ci = 0;
  for (const l of mine) {
    const pr = l.pr;
    if (!pr || pr.state !== 'open') continue;
    if (pr.labels.includes(label)) continue;
    if (pr.checks === 'failure')
      return {
        task: { kind: 'fix-pr', local: l, pr },
        reason: `PR #${pr.number} 체크 실패: ${pr.failingChecks.join(', ')}`,
        waiting: { ci, human: humanIssues.size },
      };
    if (pr.mergeState === 'BEHIND')
      return {
        task: { kind: 'rebase', local: l, pr },
        reason: `PR #${pr.number}가 main에 뒤처졌다`,
        waiting: { ci, human: humanIssues.size },
      };
    ci++;
  }

  // 3. 진행 중인 step(또는 계획 작성)
  for (const l of mine) {
    if (l.fm.status === 'blocked' || l.fm.status === 'completed' || l.fm.status === 'abandoned') {
      if (l.fm.status === 'blocked') humanIssues.add(l.issue);
      continue;
    }
    if (l.pr && l.pr.state !== 'closed') continue; // PR이 열렸거나 병합됨
    if (l.needsPlanning)
      return {
        task: { kind: 'plan', local: l },
        reason: `계획 ${l.id} 작성이 필요하다`,
        waiting: { ci, human: humanIssues.size },
      };
    if (l.stepStatus !== 'completed')
      return {
        task: { kind: 'step', local: l },
        reason: `계획 ${l.id} step${l.step ?? ''} 진행 중`,
        waiting: { ci, human: humanIssues.size },
      };
  }

  // 4. 앞 step이 병합된 계획의 다음 step
  const ref = `${cfg.github.remote}/${cfg.github.defaultBranch}`;
  const ls = gitTry(['ls-tree', '-r', '--name-only', ref, `${PLANS_DIR}/active/`], env.main);
  if (ls.ok) {
    for (const file of ls.stdout.split('\n').filter((f) => f.endsWith('/plan.md'))) {
      const text = showFile(env.main, ref, file);
      const fm = text ? parseDoc(text).frontmatter : null;
      if (!fm || String(fm.owner ?? '') !== worker || fm.status === 'blocked') continue;
      const id = String(fm.id);
      const idxText = showFile(env.main, ref, file.replace(/plan\.md$/, 'index.json'));
      if (!idxText) continue;
      const idx = parseIndex(idxText);
      const next = idx.steps.findIndex((s) => s.status !== 'completed');
      if (next < 0) continue;
      if (locals.some((l) => l.id === id && l.step === next)) continue; // 이미 작업 중이거나 PR 대기
      const type = typeof fm.type === 'string' ? fm.type : 'feat';
      const remoteHas = gitTry(
        ['rev-parse', '--verify', '-q', `${cfg.github.remote}/${type}/${id}-s${next}`],
        env.main,
      ).ok;
      if (remoteHas) {
        ci++;
        continue;
      }
      return {
        task: { kind: 'next-step', id, step: next, issue: Number(fm.issue) },
        reason: `계획 ${id}의 step${next} 시작 가능(앞 step 병합됨)`,
        waiting: { ci, human: humanIssues.size },
      };
    }
  }

  // 5. 선점되지 않은 Issue (WIP 상한)
  const openMine = mine.filter((l) => l.pr?.state === 'open').length;
  if (openMine < cfg.limits.wipPerWorker) {
    const claims = new Set(
      gitTry(['ls-remote', '--heads', cfg.github.remote, 'claim/*'], env.main)
        .stdout.split('\n')
        .map((l) => /refs\/heads\/claim\/(\d+)/.exec(l)?.[1])
        .filter(Boolean)
        .map(Number),
    );
    const candidates = issues
      .filter(
        (i) =>
          !i.labels.includes(label) &&
          !claims.has(i.number) &&
          !locals.some((l) => l.issue === i.number),
      )
      .sort(
        (a, b) =>
          priorityOf(a, cfg.github.priorityLabels) - priorityOf(b, cfg.github.priorityLabels) ||
          a.number - b.number,
      );
    if (candidates.length) {
      return {
        task: { kind: 'new-issue', issue: candidates[0] },
        reason: `선점되지 않은 Issue #${candidates[0].number}`,
        waiting: { ci, human: humanIssues.size },
      };
    }
  }

  return {
    task: { kind: 'idle' },
    reason: ci
      ? `CI·병합 대기 ${ci}건`
      : humanIssues.size
        ? `사람 대기 ${humanIssues.size}건`
        : '할 일 없음',
    waiting: { ci, human: humanIssues.size },
  };
}
