// 다음 할 일 고르기 (4.5절 우선순위, S1). runner와 대화 세션의 `start`가 함께 쓴다.
//   1. 답을 받은 needs-human 항목
//   2. 내 PR 중 조치가 필요한 것(체크 실패, main에 뒤처짐)
//   3. 내가 맡은 계획의 진행 중인 step (계획 작성 포함)
//   4. 앞 step이 병합된 계획의 다음 step
//   5. 선점되지 않은 Issue 중 제작자·외주 개발자가 만든 것 (우선순위 라벨 순, WIP 상한 안에서).
//      `github.botIssues`가 owner-approved면 제작자가 `/harness accept` 댓글을 단 봇 Issue도.
//      그 밖의 작성자는 고르지 않고 `excluded`로 알린다(14.6절)
//   6. 없으면 idle (CI·사람 대기 수 포함)
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { listRemoteClaims } from '../commands/task.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type { Comment, GitHubPort, Issue, PullRequest } from '../lib/github.ts';
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
  /** main에 뒤처지거나 충돌한 PR을 origin/main 병합으로 갱신(ADR-0006) */
  | { kind: 'update'; local: LocalPlan; pr: PullRequest }
  | { kind: 'plan'; local: LocalPlan }
  | { kind: 'step'; local: LocalPlan }
  | { kind: 'next-step'; id: string; step: number; issue: number }
  | { kind: 'new-issue'; issue: Issue }
  | { kind: 'idle' };

/** 작성자 확인으로 새 Issue 후보에서 뺀 Issue (4.5절 5번, 14.6절) */
export interface ExcludedIssue {
  number: number;
  title: string;
  author: string;
  reason: string;
}

export interface Pick {
  task: Task;
  reason: string;
  waiting: { ci: number; human: number };
  /** 작성자 때문에 새 Issue 후보에서 뺀 것. 5번까지 가지 않았으면 [] */
  excluded: ExcludedIssue[];
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

/** GitHub login 비교. 대소문자를 무시하고, 빈 문자열은 어떤 계정과도 같지 않다 */
export function sameLogin(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** 봇 Issue 승인 표시(`github.botIssues: owner-approved`). 제작자 계정 댓글의 한 줄 */
export const BOT_ISSUE_ACCEPT = '/harness accept';

/** 승인 경로가 켜져 있고 제작자 승인을 기다리는 봇 Issue의 제외 사유 */
export const BOT_ISSUE_WAITING_REASON = `봇 계정이 만든 Issue: 제작자 계정의 \`${BOT_ISSUE_ACCEPT}\` 댓글 대기`;

/** 펜스 코드 블록(``` 또는 ~~~, 3칸까지 들여쓰기) 여닫는 줄 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * 댓글 본문에 승인 줄이 있는지 본다. 앞뒤 공백을 뺀 줄이 정확히 `/harness accept`여야 한다.
 * 인용(`> ...`)·문장 속 언급·인라인 코드는 줄 전체가 일치하지 않아 빠지고, 펜스 코드 블록 안의 줄은 건너뛴다.
 * 닫히지 않은 펜스는 끝까지 코드로 본다(fail-closed).
 */
function hasAcceptLine(body: string): boolean {
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const m = FENCE.exec(line.replace(/\r$/, ''));
    if (fence) {
      // 닫는 펜스: 같은 문자, 여는 펜스 이상 길이, 뒤에 공백만
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    if (line.trim() === BOT_ISSUE_ACCEPT) return true;
  }
  return false;
}

/**
 * 제작자(`owner`) 계정이 쓴 댓글 가운데 `/harness accept` 한 줄이 있는지 본다(9.1절 답변 인정과 같은 근거:
 * 댓글 작성자는 봇이 흉내 낼 수 없다). 봇·외주 개발자 등 다른 계정의 댓글은 보지 않는다.
 * 한계: 마지막 편집자는 보지 않는다. 쓰기 권한 계정이 제작자 댓글을 고친 경우를 가려내지 못한다(TD-26).
 */
export function ownerAccepted(comments: Comment[], owner: string): boolean {
  return comments.some((c) => sameLogin(c.author, owner) && hasAcceptLine(c.body));
}

/**
 * 새 Issue 후보를 작성자로 거른다(14.6절). 제작자(`github.owner`)·외주 개발자(`github.collaborators`)가
 * 만든 Issue만 `trusted`다. `github.botIssues`가 `owner-approved`면 봇 계정 Issue 가운데 제작자 승인
 * 댓글(`ownerAccepted`)이 있는 것도 `trusted`다. 댓글은 이때만 `comments(n)`으로 조회한다.
 * `github.owner`가 비면 모두 뺀다(fail-closed). 입력 순서를 지킨다.
 */
export function filterTrustedIssues(
  issues: Issue[],
  cfg: HarnessConfig,
  comments: (issue: number) => Comment[],
): { trusted: Issue[]; excluded: ExcludedIssue[] } {
  const { owner, bot } = cfg.github;
  const allowed = [owner, ...(cfg.github.collaborators ?? [])];
  // 설정을 거치지 않은 값(undefined 등)은 exclude로 본다(fail-closed)
  const approvalOpen = cfg.github.botIssues === 'owner-approved';
  const trusted: Issue[] = [];
  const excluded: ExcludedIssue[] = [];
  for (const i of issues) {
    let reason: string;
    if (!owner) reason = 'github.owner가 비어 있다(설정 누락 시 새 Issue를 고르지 않는다)';
    else if (allowed.some((a) => sameLogin(i.author, a))) {
      trusted.push(i);
      continue;
    } else if (sameLogin(i.author, bot)) {
      if (!approvalOpen) reason = '봇 계정이 만든 Issue';
      else {
        try {
          if (ownerAccepted(comments(i.number), owner)) {
            trusted.push(i);
            continue;
          }
          reason = BOT_ISSUE_WAITING_REASON;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          reason = `댓글 조회 실패: ${msg.split('\n')[0]}`;
        }
      }
    } else if (!i.author) reason = '작성자 불명';
    else reason = '허용 계정(github.owner·github.collaborators)이 아닌 작성자';
    excluded.push({ number: i.number, title: i.title, author: i.author, reason });
  }
  return { trusted, excluded };
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
        excluded: [],
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
    // 멈춘 계획은 사람의 답을 기다린다(needs-human은 Issue에 달린다). 다시 고르면 같은 중단 보고를 반복한다
    if (l.fm.status === 'blocked') continue;
    if (pr.checks === 'failure')
      return {
        task: { kind: 'fix-pr', local: l, pr },
        reason: `PR #${pr.number} 체크 실패: ${pr.failingChecks.join(', ')}`,
        waiting: { ci, human: humanIssues.size },
        excluded: [],
      };
    // BEHIND는 "main 최신 필수" 브랜치 보호에서만 나온다. 충돌은 DIRTY로 온다
    if (pr.mergeState === 'BEHIND' || pr.mergeState === 'DIRTY')
      return {
        task: { kind: 'update', local: l, pr },
        reason:
          pr.mergeState === 'DIRTY'
            ? `PR #${pr.number}가 main과 충돌한다(DIRTY)`
            : `PR #${pr.number}가 main에 뒤처졌다(BEHIND)`,
        waiting: { ci, human: humanIssues.size },
        excluded: [],
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
        excluded: [],
      };
    if (l.stepStatus !== 'completed')
      return {
        task: { kind: 'step', local: l },
        reason: `계획 ${l.id} step${l.step ?? ''} 진행 중`,
        waiting: { ci, human: humanIssues.size },
        excluded: [],
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
        excluded: [],
      };
    }
  }

  // 5. 선점되지 않은 Issue (WIP 상한). 작성자 확인(14.6절)은 이 단계에만 적용한다:
  //    이미 선점한 작업(1~4번)은 선점 때 판단이 끝났다
  let excluded: ExcludedIssue[] = [];
  const openMine = mine.filter((l) => l.pr?.state === 'open').length;
  if (openMine < cfg.limits.wipPerWorker) {
    let claims = new Set<number>();
    try {
      claims = new Set(listRemoteClaims(env.main, cfg));
    } catch {
      // 조회 실패는 선점 없음으로 본다(기존 동작). push 거부가 실제 선점을 지킨다(8.3절)
    }
    const open = issues.filter(
      (i) =>
        !i.labels.includes(label) &&
        !claims.has(i.number) &&
        !locals.some((l) => l.issue === i.number),
    );
    // 앞 조건으로 먼저 거른 뒤 적용한다(봇 Issue 댓글 조회 횟수를 줄인다)
    const filtered = filterTrustedIssues(open, cfg, (n) => gh.comments(n));
    excluded = filtered.excluded;
    const candidates = filtered.trusted.sort(
      (a, b) =>
        priorityOf(a, cfg.github.priorityLabels) - priorityOf(b, cfg.github.priorityLabels) ||
        a.number - b.number,
    );
    if (candidates.length) {
      return {
        task: { kind: 'new-issue', issue: candidates[0] },
        reason: `선점되지 않은 Issue #${candidates[0].number}`,
        waiting: { ci, human: humanIssues.size },
        excluded,
      };
    }
  }

  const idle = ci
    ? `CI·병합 대기 ${ci}건`
    : humanIssues.size
      ? `사람 대기 ${humanIssues.size}건`
      : '할 일 없음';
  return {
    task: { kind: 'idle' },
    reason: excluded.length
      ? `${idle} (작성자 확인으로 제외: ${excluded.map((e) => `#${e.number}`).join(', ')})`
      : idle,
    waiting: { ci, human: humanIssues.size },
    excluded,
  };
}
