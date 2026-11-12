// 다음 할 일 고르기 (4.5절 우선순위, S1). runner와 대화 세션의 `start`가 함께 쓴다.
//   1. 답을 받은 needs-human 항목(제작자 댓글. 다른 계정이 고친 댓글은 답이 아니다, TD-26)
//   2. 내 PR 중 조치가 필요한 것(체크 실패, main에 뒤처짐)
//   3. 내가 맡은 계획의 진행 중인 step (계획 작성 포함)
//   4. 앞 step이 병합된 계획의 다음 step
//   5. 선점되지 않은 Issue 중 제작자·외주 개발자가 만든 것 (우선순위 라벨 순, WIP 상한 안에서).
//      `github.botIssues`가 owner-approved면 제작자가 `/harness accept` 댓글을 단 봇 Issue도.
//      그 밖의 작성자는 고르지 않고 `excluded`로 알린다(14.6절).
//      만든 뒤 허용 계정이 아닌 계정이 제목·본문을 고쳤으면 그 뒤의 제작자 승인이 있어야 한다(TD-19)
//   6. 없으면 idle (CI·사람 대기 수 포함)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listRemoteClaims } from '../commands/task.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type {
  Comment,
  ContentHistory,
  GitHubPort,
  Issue,
  IssueHistory,
  PullRequest,
} from '../lib/github.ts';
import { gitTry, harnessStateDir, listWorktrees, repoInfo, showFile } from '../lib/git.ts';
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
  /** main 병합 충돌로 멈춰 제작자 답을 기다린다(`conflict.json`, TD-27). 이 PR은 다시 고르지 않는다 */
  conflictWaiting: boolean;
}

/**
 * main 병합 충돌 상태(TD-27). worktree 하네스 상태 폴더의 `conflict.json`(git이 추적하지 않는다).
 * 충돌 중단은 계획 파일을 바꾸지 않으므로(열린 PR의 plan-gate 유지) 대기 여부를 여기에 둔다.
 * - waiting: 중단 보고를 올리고 제작자 답을 기다린다
 * - resolve: 답을 받았다. 다음 갱신에서 충돌을 남긴 병합 + 해결 세션으로 푼다
 */
export interface ConflictState {
  waiting: boolean;
  resolve: boolean;
  files: string[];
}

function conflictFile(worktree: string): string {
  return path.join(harnessStateDir(repoInfo(worktree), 'worktree'), 'conflict.json');
}

/** 없거나 깨졌으면 대기·해결 모두 false */
export function readConflictState(worktree: string): ConflictState {
  try {
    const raw = JSON.parse(readFileSync(conflictFile(worktree), 'utf8')) as Partial<ConflictState>;
    return {
      waiting: raw.waiting === true,
      resolve: raw.resolve === true,
      files: Array.isArray(raw.files) ? raw.files.map(String) : [],
    };
  } catch {
    return { waiting: false, resolve: false, files: [] };
  }
}

export function writeConflictState(worktree: string, s: ConflictState): void {
  writeFileSync(conflictFile(worktree), JSON.stringify(s, null, 2) + '\n');
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
      conflictWaiting: readConflictState(wt.path).waiting,
    });
  }
  return out;
}

function latestOwnerAnswer(gh: GitHubPort, owner: string, issue: number): string | null {
  if (!owner) return null;
  const comments = gh.comments(issue);
  const last = comments[comments.length - 1];
  // 답변 인정 기준(9.1절): 제작자 계정의 댓글만. 마지막 댓글이 인정되는 제작자 댓글이어야 "답을 받음"
  return last && ownerComment(last, owner) ? last.body : null;
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

/** 계정 목록을 사람이 읽을 문자열로. 알 수 없는 계정은 "불명" */
function whoList(changes: { by: string }[]): string {
  return [...new Set(changes.map((c) => c.by || '불명'))].join(', ');
}

/**
 * 제작자 댓글로 인정하지 않는 이유(9.1절 답변 인정 기준). 인정하면 null.
 * 작성자가 제작자여야 하고, 편집 이력을 끝까지 확인했으며, 고친 계정이 모두 제작자여야 한다.
 * 쓰기 권한 계정(봇 포함)은 남의 댓글을 고칠 수 있으므로 작성자만 보면 봇이 제작자 답변을 바꿀 수 있다(TD-26)
 */
export function ownerCommentRejection(c: Comment, owner: string): string | null {
  if (!owner) return '제작자 계정(github.owner)이 설정되지 않았다';
  if (!sameLogin(c.author, owner)) return '제작자 계정의 댓글이 아니다';
  if (!c.history || !c.history.complete) return '댓글 편집 이력을 확인하지 못했다';
  const others = c.history.changes.filter((ch) => !sameLogin(ch.by, owner));
  if (others.length) return `다른 계정(${whoList(others)})이 고친 댓글이다`;
  return null;
}

/** 인정되는 제작자 댓글인가(`ownerCommentRejection`이 null) */
export function ownerComment(c: Comment, owner: string): boolean {
  return ownerCommentRejection(c, owner) === null;
}

/**
 * 제작자(`owner`) 댓글 가운데 `/harness accept` 한 줄이 있는지 본다(9.1절 답변 인정과 같은 근거:
 * 댓글 작성자는 봇이 흉내 낼 수 없다). 봇·외주 개발자 등 다른 계정의 댓글과, 다른 계정이 고친 제작자 댓글은
 * 보지 않는다(`ownerComment`)
 */
export function ownerAccepted(comments: Comment[], owner: string): boolean {
  return comments.some((c) => ownerComment(c, owner) && hasAcceptLine(c.body));
}

export type IssueTrust =
  | { ok: true }
  | {
      ok: false;
      /** incomplete: 이력을 다 읽지 못함 / waiting: 승인 없음 / stale: 승인이 마지막 변경보다 앞 */
      kind: 'incomplete' | 'waiting' | 'stale';
      reason: string;
    };

/**
 * Issue 제목·본문을 믿을 수 있는가(14.6절, TD-19). 변경 이력(만든 것 포함) 가운데 허용 계정(`allowed`:
 * 제작자·외주 개발자)이 아닌 계정의 변경이 없으면 믿는다. 있으면 그 마지막 변경보다 **엄격히 뒤**에 단
 * 제작자 `/harness accept` 댓글(`ownerAccepted` 기준)이 있어야 믿는다. 같은 시각은 뒤로 보지 않는다(GitHub
 * 시각은 초 단위라 순서를 단정할 수 없다). 시각을 읽을 수 없으면 승인이 있어도 믿지 않는다.
 * 이력이 불완전하면 댓글을 보지 않고 믿지 않는다. 댓글은 비허용 변경이 있을 때만 `comments()`로 읽는다
 */
export function issueTrust(
  h: ContentHistory,
  allowed: string[],
  owner: string,
  comments: () => Comment[],
): IssueTrust {
  if (!owner)
    return { ok: false, kind: 'waiting', reason: '제작자 계정(github.owner)이 설정되지 않았다' };
  if (!h.complete)
    return {
      ok: false,
      kind: 'incomplete',
      reason: '제목·본문 변경 이력을 다 읽지 못했다(확인할 수 없어 후보로 삼지 않는다)',
    };
  const bad = h.changes.filter((c) => !allowed.some((a) => sameLogin(c.by, a)));
  if (!bad.length) return { ok: true };
  // NaN이 하나라도 있으면 Math.max가 NaN이고, 어떤 승인도 그보다 뒤가 아니다(fail-closed)
  const last = Math.max(...bad.map((c) => Date.parse(c.at)));
  const accepts = comments()
    .filter((c) => ownerComment(c, owner) && hasAcceptLine(c.body))
    .map((c) => Date.parse(c.createdAt));
  if (accepts.some((t) => t > last)) return { ok: true };
  const who = whoList(bad);
  if (accepts.length)
    return {
      ok: false,
      kind: 'stale',
      reason: `제작자 승인 뒤에 허용 계정이 아닌 계정(${who})이 제목·본문을 바꿨다: 내용을 확인하고 다시 \`${BOT_ISSUE_ACCEPT}\` 댓글을 달면 후보가 된다`,
    };
  return {
    ok: false,
    kind: 'waiting',
    reason: `허용 계정이 아닌 계정(${who})이 만들거나 제목·본문을 바꿨다: 내용을 확인하고 제작자 계정으로 \`${BOT_ISSUE_ACCEPT}\` 댓글을 달면 후보가 된다`,
  };
}

/** 오류 메시지 첫 줄 */
function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0];
}

/** 허용 계정: 제작자·외주 개발자(14.6절) */
export function allowedAccounts(cfg: HarnessConfig): string[] {
  return [cfg.github.owner, ...(cfg.github.collaborators ?? [])];
}

/**
 * 새 Issue 후보를 작성자와 변경 이력으로 거른다(14.6절). 제작자(`github.owner`)·외주 개발자
 * (`github.collaborators`)가 만든 Issue와, `github.botIssues`가 `owner-approved`일 때 봇 계정 Issue가
 * 대상이다. 대상 Issue는 `history(n)`으로 변경 이력을 읽어 `issueTrust`를 통과해야 `trusted`다
 * (봇 Issue는 만든 것 자체가 비허용 변경이라 제작자 승인이 필요하다). 댓글은 비허용 변경이 있을 때만
 * `comments(n)`으로 조회한다. 그 밖의 작성자는 이력을 보지 않고 뺀다.
 * `github.owner`가 비면 모두 뺀다(fail-closed). 입력 순서를 지킨다.
 */
export function filterTrustedIssues(
  issues: Issue[],
  cfg: HarnessConfig,
  comments: (issue: number) => Comment[],
  history: (issue: number) => IssueHistory,
): { trusted: Issue[]; excluded: ExcludedIssue[] } {
  const { owner, bot } = cfg.github;
  const allowed = allowedAccounts(cfg);
  // 설정을 거치지 않은 값(undefined 등)은 exclude로 본다(fail-closed)
  const approvalOpen = cfg.github.botIssues === 'owner-approved';
  const trusted: Issue[] = [];
  const excluded: ExcludedIssue[] = [];
  for (const i of issues) {
    let reason: string | null = null;
    const isAllowed = allowed.some((a) => sameLogin(i.author, a));
    const isBot = sameLogin(i.author, bot);
    if (!owner) reason = 'github.owner가 비어 있다(설정 누락 시 새 Issue를 고르지 않는다)';
    else if (isBot && !approvalOpen) reason = '봇 계정이 만든 Issue';
    else if (isAllowed || isBot) {
      let h: IssueHistory | null = null;
      try {
        h = history(i.number);
      } catch (e) {
        reason = `변경 이력 조회 실패: ${firstLine(e)}`;
      }
      if (h) {
        try {
          const t = issueTrust(h, allowed, owner, () => comments(i.number));
          if (t.ok) {
            trusted.push(i);
            continue;
          }
          // 봇 Issue의 "승인 없음"은 기존 안내(acceptHint)가 알아보는 사유로 둔다
          reason = isBot && t.kind === 'waiting' ? BOT_ISSUE_WAITING_REASON : t.reason;
        } catch (e) {
          reason = `댓글 조회 실패: ${firstLine(e)}`;
        }
      }
    } else if (!i.author) reason = '작성자 불명';
    else reason = '허용 계정(github.owner·github.collaborators)이 아닌 작성자';
    excluded.push({ number: i.number, title: i.title, author: i.author, reason: reason ?? '?' });
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
    // 충돌로 멈춘 계획은 계획 파일이 아니라 conflict.json으로 기다린다(TD-27)
    if (l.conflictWaiting) {
      humanIssues.add(l.issue);
      continue;
    }
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
    const filtered = filterTrustedIssues(
      open,
      cfg,
      (n) => gh.comments(n),
      (n) => gh.issueHistory(n),
    );
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
