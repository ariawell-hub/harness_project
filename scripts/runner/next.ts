// 다음 할 일 고르기 (4.5절 우선순위, S1). runner와 대화 세션의 `start`가 함께 쓴다.
//   1. 답을 받은 needs-human 항목(제작자 댓글. 다른 계정이 고친 댓글은 답이 아니다, TD-26)
//   2. 내 PR 중 조치가 필요한 것(체크 실패, main에 뒤처짐)
//   3. 내가 맡은 계획의 진행 중인 step (계획 작성 포함)
//   4. 앞 step이 병합된 계획의 다음 step
//   5. 선점되지 않은 Issue 중 제작자·외주 개발자가 만든 것 (우선순위 라벨 순, WIP 상한 안에서).
//      내 선점이 남은 Issue도 revert로 계획이 main에서 빠졌으면 고른다(new-task가 계획을 복원한다, 8.3절).
//      `github.botIssues`가 owner-approved면 제작자가 `/harness accept` 댓글을 단 봇 Issue도.
//      그 밖의 작성자는 고르지 않고 `excluded`로 알린다(14.6절).
//      만든 뒤 허용 계정이 아닌 계정이 제목·본문을 고쳤으면 그 뒤의 제작자 승인이 있어야 한다(TD-19)
//   6. 없으면 idle (CI·사람 대기 수 포함)
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planHashes } from '../ci/plan-hash.ts';
import { stepCompletedAt } from '../commands/pr-state.ts';
import { claimOwner, findRestore, listRemoteClaims } from '../commands/task.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type {
  Comment,
  ContentHistory,
  GitHubPort,
  Issue,
  IssueHistory,
  PullRequest,
} from '../lib/github.ts';
import { readApprovalMarker } from '../lib/approval.ts';
import {
  defaultBase,
  gitTry,
  harnessStateDir,
  isBehind,
  listWorktrees,
  repoInfo,
  revParse,
  showFile,
  type RepoInfo,
} from '../lib/git.ts';
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
import { planApproved, readPrLedger } from './ledger-read.ts';
import { classifyPr, requiredStates, type PrVerdict, type RequiredState } from './pr-state.ts';

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
  /**
   * 열린 내 PR의 분류(10.3절, `pr-state.ts`). 필수 체크를 출처로 걸러 판정한 결과다.
   * `ci.requiredChecks`가 빈 리포와 남의 계획에는 없다(그때는 체크 요약으로 판단한다)
   */
  prState?: PrVerdict;
  /** `prState`를 낸 필수 체크 상태. 알림 문구(상태 설명, 실행 링크)에 쓴다 */
  required?: RequiredState[];
  /** PR head의 계획에서 이 step이 completed인가(`prState`와 함께 채운다) */
  prStepCompleted?: boolean;
  /**
   * 계획 검증(G1, 4.1절) 대상이면 지금 계획의 핵심 섹션 해시와 원장의 승인 여부.
   * 대상: `planReview.required`가 켜져 있고, step 폴더 형식 계획이고, 해시가 base(main)의 것과 다르다.
   * `approved`는 PR이 열려 있고 step이 끝나지 않았고 CI가 끝났을 때만 원장을 읽어 채운다(읽지 못하면 null)
   */
  planReview?: { hash: string; approved: boolean | null };
}

/**
 * 계획 검증(G1) 대상이면 지금 계획의 해시, 아니면 null(소규모 계획, 검증이 꺼진 리포, 계획이 base와 같은 해시).
 * 계획이 main에 이미 같은 해시로 있으면(둘째 step부터) 다시 검증받지 않는다(10.3절).
 * 필수 체크(`ci.requiredChecks`)나 검증 App 봇(`ci.recorderBot`) 설정이 없는 리포도 null이다: 승인을 기록할 CI가 없어
 * runner가 승인을 확인할 수 없다(기다리기만 하게 된다). 그런 리포는 지금까지처럼 step을 바로 진행한다
 */
export function planReviewHash(
  cfg: HarnessConfig,
  worktree: string,
  branch: string,
): string | null {
  if (!cfg.planReview.required) return null;
  if (cfg.ci.requiredChecks.length === 0 || !cfg.ci.recorderBot) return null;
  try {
    const base = defaultBase(worktree, cfg.github.remote, cfg.github.defaultBranch);
    const h = base ? planHashes(worktree, base, branch) : null;
    return h && h.hash !== h.baseHash ? h.hash : null;
  } catch {
    return null;
  }
}

/**
 * PR 하나의 CI 대기 기록(4.5절). worktree 하네스 상태 폴더의 `pr-wait.json`(git이 추적하지 않는다).
 * 같은 head에서 얼마나 기다렸는지와, 오래된 대기를 이미 알렸는지를 둔다. runner만 쓴다
 */
export interface PrWait {
  /** 기다리기 시작한 PR head */
  head: string;
  /** 기다리기 시작한 시각(ISO) */
  since: string;
  /** 오래된 대기를 needs-human으로 알렸는가 */
  reported: boolean;
}

function prWaitFile(worktree: string): string {
  return path.join(harnessStateDir(repoInfo(worktree), 'worktree'), 'pr-wait.json');
}

/** 없거나 깨졌으면 null */
export function readPrWait(worktree: string): PrWait | null {
  try {
    const raw = JSON.parse(readFileSync(prWaitFile(worktree), 'utf8')) as Partial<PrWait>;
    if (typeof raw.head !== 'string' || typeof raw.since !== 'string') return null;
    if (Number.isNaN(Date.parse(raw.since))) return null;
    return { head: raw.head, since: raw.since, reported: raw.reported === true };
  } catch {
    return null;
  }
}

export function writePrWait(worktree: string, w: PrWait): void {
  writeFileSync(prWaitFile(worktree), JSON.stringify(w, null, 2) + '\n');
}

export function clearPrWait(worktree: string): void {
  rmSync(prWaitFile(worktree), { force: true });
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

/**
 * 올린 질문 제목과 답 대기 여부. worktree 하네스 상태 폴더의 questions.json(answer.md 옆).
 * - reported: 제작자에게 올린(댓글이 Issue에 있는 것을 확인한) 질문의 제목
 * - waiting: 답을 기다린다
 * - stage: 질문을 남긴 세션. plan(계획 작성, TD-18) | step(step 세션, TD-24). 답을 받은 뒤 이어 갈 곳이 다르다
 * - unposted: 질문을 올리기로 했는데 전달이 끝나지 않았다(댓글이 올라간 것을 확인하지 못했거나 라벨을 붙이지 못했다. Issue #211)
 * - base: 질문을 올리기로 한 때 Issue의 마지막 댓글의 번호(숫자로만 된 문자열. 댓글이 없었으면 '0').
 *   아직 읽지 못했거나 그 댓글의 번호를 읽지 못했으면 없다. 번호가 이것보다 큰 댓글만 이번 질문 뒤의 댓글이다
 */
export interface QuestionState {
  reported: string[];
  waiting: boolean;
  stage: 'plan' | 'step';
  unposted: boolean;
  base?: string;
}

const COMMENT_ID = /^\d+$/;

function questionFile(info: RepoInfo): string {
  return path.join(harnessStateDir(info, 'worktree'), 'questions.json');
}

/** 없거나 깨졌으면 빈 상태. unposted·base가 없는 옛 파일은 unposted: false, base 없음으로 읽는다 */
export function readQuestionState(info: RepoInfo): QuestionState {
  try {
    const raw = JSON.parse(readFileSync(questionFile(info), 'utf8')) as Partial<
      Record<keyof QuestionState, unknown>
    >;
    return {
      reported: Array.isArray(raw.reported) ? raw.reported.map(String) : [],
      waiting: raw.waiting === true,
      stage: raw.stage === 'step' ? 'step' : 'plan',
      unposted: raw.unposted === true,
      ...(typeof raw.base === 'string' && COMMENT_ID.test(raw.base) ? { base: raw.base } : {}),
    };
  } catch {
    return { reported: [], waiting: false, stage: 'plan', unposted: false };
  }
}

/**
 * 같은 폴더의 임시 파일에 다 쓴 뒤 이름을 바꿔 넣는다. 그 자리에서 덮어쓰면 쓰는 중에 runner가 끝났을 때 빈 파일이
 * 남고, 빈 파일은 "올리지 못한 질문 없음"으로 읽혀 멈춘 계획의 질문이 다시 올려지지 않는다(Issue #211).
 * 바꿔 넣으면 어느 순간에 끝나도 마지막으로 저장한 상태나 새 상태가 남는다
 */
export function writeQuestionState(info: RepoInfo, s: QuestionState): void {
  const file = questionFile(info);
  const next = `${file}.${process.pid}.tmp`;
  writeFileSync(next, JSON.stringify(s, null, 2) + '\n');
  renameSync(next, file);
}

/**
 * 질문을 올리기로 한 때의 기준: 마지막 댓글의 번호. 댓글이 하나도 없으면 '0'.
 * 마지막 댓글의 번호를 읽지 못했으면(빈 값, 숫자가 아님) undefined: 0이나 다른 댓글의 번호로 대신하지 않는다
 */
export function questionBase(comments: readonly Comment[]): string | undefined {
  const last = comments.at(-1);
  if (!last) return '0';
  return COMMENT_ID.test(last.id) ? last.id : undefined;
}

/**
 * 기준 뒤의 댓글: 번호가 `base`보다 큰 댓글(큰 정수로 견준다). 댓글 번호는 만들어진 순서대로 커지므로 기준 댓글이
 * 목록에 없어도(지워졌다, 읽는 범위 밖으로 밀렸다), 같은 초에 달린 댓글이어도 같은 답이 나온다.
 * 번호가 없는 댓글은 넣지 않는다. `base`가 없거나 숫자가 아니면 빈 목록이다(0으로 보지 않는다)
 */
export function commentsAfter(comments: readonly Comment[], base: string | undefined): Comment[] {
  if (base === undefined || !COMMENT_ID.test(base)) return [];
  const b = BigInt(base);
  return comments.filter((c) => COMMENT_ID.test(c.id) && BigInt(c.id) > b);
}

export type Task =
  | { kind: 'answered'; issue: number; answer: string; local: LocalPlan | null }
  /** `failing`: 고칠 체크와 상태 설명(체크 요약으로 판단한 경우 설명은 '') */
  | {
      kind: 'fix-pr';
      local: LocalPlan;
      pr: PullRequest;
      failing: { context: string; description: string }[];
    }
  /** `risk-gate`만 남았다: 제작자에게 현재 head 승인을 요청한다(head마다 한 번) */
  | { kind: 'request-approval'; local: LocalPlan; pr: PullRequest }
  /** 같은 head에서 CI 대기·판정 없음이 `limits.ciStallHours`를 넘었다: needs-human으로 알린다(한 번) */
  | { kind: 'report-stall'; local: LocalPlan; pr: PullRequest; waiting: string[] }
  /** 필수 체크가 모두 통과했는데 자동 병합이 꺼져 있다: 다시 켠다 */
  | { kind: 'arm-merge'; local: LocalPlan; pr: PullRequest }
  /**
   * 검증자의 수정 요청이나 원장의 열린 차단 지적에 대응한다(10.2절 (6)).
   * phase: plan = 계획 검증 중인 PR(계획 파일만 고친다), code = 구현을 올린 PR
   */
  | { kind: 'review'; local: LocalPlan; pr: PullRequest; phase: 'plan' | 'code' }
  /** 계획 검증 대상 계획을 다 썼다: 계획만 담은 커밋을 push하고 초안 PR을 연다(G1, 4.1절) */
  | { kind: 'plan-push'; local: LocalPlan }
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
  /** 이번에 읽은 계획 worktree 전체(runner가 대기 기록과 알림 정리에 다시 쓴다) */
  locals: LocalPlan[];
}

export interface NextEnv {
  main: string;
  cfg: HarnessConfig;
  gh: GitHubPort;
  worker: string;
  /** 지금 시각(ms). 테스트용. 없으면 Date.now() */
  now?: () => number;
}

/**
 * 열린 내 PR의 필수 체크를 읽어 분류한다. push한 커밋이 PR head에 아직 반영되지 않았으면(GitHub 반영 지연, Q20)
 * 옛 head의 결과로 판단하지 않고 기다린다. 조회가 실패해도 기다린다(실패한 체크가 있다고 단정하지 않는다).
 * step 완료 여부는 PR head의 계획에서 읽는다(`localCompleted`는 head에서 읽지 못할 때만 쓴다):
 * 수정하다 실패해 step을 되돌린 커밋이 로컬에만 있어도 PR head는 완료된 step의 PR이다
 */
function inspectPr(
  env: NextEnv,
  worktree: string,
  branch: string,
  pr: PullRequest,
  localCompleted: boolean,
): { prState: PrVerdict; required: RequiredState[]; prStepCompleted: boolean } {
  const { remote, defaultBranch } = env.cfg.github;
  try {
    const pushed = revParse(`${remote}/${branch}`, worktree);
    if (!pr.headSha || (pushed && pushed !== pr.headSha))
      return {
        prState: { kind: 'wait-ci', waiting: ['PR head 반영'] },
        required: [],
        prStepCompleted: localCompleted,
      };
    const required = requiredStates(env.gh.commitChecks(pr.headSha), env.cfg.ci);
    const behind = isBehind(worktree, remote, defaultBranch, pr.headSha);
    const stepCompleted = stepCompletedAt(worktree, pr.headSha, branch) ?? localCompleted;
    return {
      prState: classifyPr({ pr, required, behind, stepCompleted }),
      required,
      prStepCompleted: stepCompleted,
    };
  } catch (e) {
    return {
      prState: { kind: 'wait-ci', waiting: [`체크 조회 실패(${firstLine(e)})`] },
      required: [],
      prStepCompleted: localCompleted,
    };
  }
}

export function readLocalPlans(env: NextEnv): LocalPlan[] {
  const out: LocalPlan[] = [];
  const baseSha = revParse(`${env.cfg.github.remote}/${env.cfg.github.defaultBranch}`, env.main);
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
    const localCompleted =
      ref.kind === 'multi' ? stepStatus === 'completed' : fm.status === 'completed';
    // revert 뒤 같은 브랜치 이름으로 다시 시작한 작업(8.3절 "되돌리기"): 병합된 옛 PR은 이 작업의 PR이 아니다.
    // 병합된 PR인데 이 worktree에서도 main에서도 그 step이 끝나 있지 않으면 그 병합은 되돌려진 것이다
    if (
      pr?.state === 'merged' &&
      !localCompleted &&
      (baseSha === null || stepCompletedAt(env.main, baseSha, wt.branch) !== true)
    )
      pr = null;
    const inspected =
      pr?.state === 'open' &&
      env.cfg.ci.requiredChecks.length > 0 &&
      String(fm.owner ?? '') === env.worker
        ? inspectPr(env, wt.path, wt.branch, pr, localCompleted)
        : null;
    // 계획 검증(G1) 대상인가. 승인은 CI가 끝난(ready) 계획 검증 중인 PR에서만 원장을 읽어 확인한다
    let planReview: LocalPlan['planReview'];
    if (ref.kind === 'multi' && String(fm.owner ?? '') === env.worker && !needsPlanning) {
      const hash = planReviewHash(env.cfg, wt.path, wt.branch);
      if (hash) {
        let approved: boolean | null = null;
        if (
          pr?.state === 'open' &&
          inspected?.prStepCompleted === false &&
          inspected.prState.kind === 'ready'
        ) {
          try {
            approved = planApproved(readPrLedger(env.gh, env.cfg, pr.number), hash);
          } catch {
            approved = null; // 원장을 읽지 못했다: 승인으로 보지 않고 기다린다
          }
        }
        planReview = { hash, approved };
      }
    }
    out.push({
      ...(inspected ?? {}),
      ...(planReview ? { planReview } : {}),
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

function latestOwnerAnswer(
  gh: GitHubPort,
  owner: string,
  issue: number,
  local: LocalPlan | null,
): string | null {
  if (!owner) return null;
  const comments = gh.comments(issue);
  const last = comments[comments.length - 1];
  // 답변 인정 기준(9.1절): 제작자 계정의 댓글만. 마지막 댓글이 인정되는 제작자 댓글이어야 "답을 받음"
  if (!last || !ownerComment(last, owner)) return null;
  // 전달이 끝나지 않은 질문이 있는 계획(Issue #211): 질문을 올리기로 한 뒤의 댓글만 답이다.
  // 질문보다 먼저 있던 제작자 댓글이 (다른 이유로 붙은) 라벨 때문에 답으로 보이지 않게 한다
  if (local) {
    const qs = readQuestionState(repoInfo(local.worktree));
    if (qs.unposted && !commentsAfter(comments, qs.base).includes(last)) return null;
  }
  return last.body;
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

/** 원장의 계획 승인을 기다릴 때 대기 목록에 적는 이름 */
export const PLAN_APPROVAL_WAIT = '계획 승인(G1)';

/** 계획 검증 중인 PR인가: 계획 검증 대상이고, PR이 열려 있고, PR head의 step이 끝나지 않았다 */
export function inPlanReview(l: LocalPlan): boolean {
  return !!l.planReview && l.pr?.state === 'open' && l.prStepCompleted === false;
}

export function pickNext(env: NextEnv): Pick {
  const locals = readLocalPlans(env);
  return { ...pickFrom(env, locals), locals };
}

function pickFrom(env: NextEnv, locals: LocalPlan[]): Omit<Pick, 'locals'> {
  const { cfg, gh, worker } = env;
  const label = cfg.github.needsHumanLabel;
  const mine = locals.filter((l) => String(l.fm.owner ?? '') === worker);
  const issues = gh.listOpenIssues();
  const humanIssues = new Set<number>();

  // 1. 답을 받은 needs-human
  for (const issue of issues.filter((i) => i.labels.includes(label))) {
    const local = mine.find((l) => l.issue === issue.number) ?? null;
    const answer = latestOwnerAnswer(gh, cfg.github.owner, issue.number, local);
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
  const act = (task: Task, reason: string): Omit<Pick, 'locals'> => ({
    task,
    reason,
    waiting: { ci, human: humanIssues.size },
    excluded: [],
  });
  /**
   * CI를 기다리는 PR: 같은 head에서 `limits.ciStallHours`를 넘겼으면 알림 작업을 돌려주고,
   * 이미 알렸으면 사람 대기로, 아니면 CI 대기로 센다(null)
   */
  const waitOrStall = (
    l: LocalPlan,
    pr: PullRequest,
    waiting: string[],
  ): Omit<Pick, 'locals'> | null => {
    const w = readPrWait(l.worktree);
    const same = w !== null && w.head === pr.headSha;
    if (same && w.reported) {
      // 이미 알렸다: 제작자 답을 기다린다
      humanIssues.add(l.issue);
    } else if (same && now - Date.parse(w.since) >= cfg.limits.ciStallHours * 3_600_000) {
      return act(
        { kind: 'report-stall', local: l, pr, waiting },
        `PR #${pr.number}의 CI 대기가 ${cfg.limits.ciStallHours}시간을 넘었다: ${waiting.join(', ')}`,
      );
    } else ci++;
    return null;
  };
  const now = env.now?.() ?? Date.now();
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
    // 필수 체크를 출처로 걸러 분류한 결과가 있으면 그것으로 고른다(10.3절). 없으면 체크 요약으로 판단한다
    const v = l.prState;
    if (v) {
      // 계획 검증 중인 PR(계획만 올렸고 step이 끝나지 않았다)의 check 실패와 "CI 끝남"은 3번에서 다룬다:
      // 수정 세션이 아니라 계획 작성 세션, 자동 병합이 아니라 계획 승인 확인이다
      if (inPlanReview(l) && (v.kind === 'fix' || v.kind === 'ready')) continue;
      switch (v.kind) {
        case 'closed':
          break;
        case 'conflict':
          return act({ kind: 'update', local: l, pr }, `PR #${pr.number}가 main과 충돌한다(DIRTY)`);
        case 'behind':
          // 필수 체크가 모두 통과한 뒤에만 갱신한다: 앞선 head의 승인을 이어받는다(10.3절)
          return act(
            { kind: 'update', local: l, pr },
            `PR #${pr.number}가 main에 뒤처졌다(필수 체크 통과, 승인 이어받기)`,
          );
        case 'fix':
          return act(
            {
              kind: 'fix-pr',
              local: l,
              pr,
              failing: v.failing.map((f) => ({ context: f.context, description: f.description })),
            },
            `PR #${pr.number} 체크 실패: ${v.failing.map((f) => f.context).join(', ')}`,
          );
        case 'approval':
          if (readApprovalMarker(repoInfo(l.worktree)) !== pr.headSha)
            return act(
              { kind: 'request-approval', local: l, pr },
              `PR #${pr.number}에 제작자 승인이 필요하다(risk-gate)`,
            );
          humanIssues.add(l.issue);
          break;
        case 'review':
          return act(
            { kind: 'review', local: l, pr, phase: inPlanReview(l) ? 'plan' : 'code' },
            `PR #${pr.number}에 검증자의 수정 요청 또는 열린 차단 지적이 있다`,
          );
        case 'wait-ci':
        case 'infra-error': {
          const stall = waitOrStall(
            l,
            pr,
            v.kind === 'wait-ci' ? v.waiting : v.failing.map((f) => f.context),
          );
          if (stall) return stall;
          break;
        }
        case 'ready':
          if (!pr.autoMerge && !pr.isDraft)
            return act(
              { kind: 'arm-merge', local: l, pr },
              `PR #${pr.number}의 필수 체크가 모두 통과했는데 자동 병합이 꺼져 있다`,
            );
          ci++;
          break;
      }
      continue;
    }
    if (pr.checks === 'failure')
      return {
        task: {
          kind: 'fix-pr',
          local: l,
          pr,
          failing: pr.failingChecks.map((c) => ({ context: c, description: '' })),
        },
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
    // 계획 검증 중인 PR(G1): 승인 전에는 step을 시작하지 않는다
    if (inPlanReview(l) && l.pr && l.prState) {
      if (l.pr.labels.includes(label)) continue;
      if (l.prState.kind === 'fix')
        return act(
          { kind: 'plan', local: l },
          `계획 ${l.id}의 계획 전용 커밋에서 ${l.prState.failing.map((f) => f.context).join(', ')} 실패: 계획을 다시 쓴다`,
        );
      if (l.prState.kind === 'ready') {
        if (l.planReview?.approved === true)
          return act(
            { kind: 'step', local: l },
            `계획 ${l.id}가 승인됐다(G1): step${l.step ?? ''} 진행`,
          );
        // CI는 끝났는데 원장에 지금 계획의 승인이 없다(기록 지연, 원장을 읽지 못함)
        const stall = waitOrStall(l, l.pr, [PLAN_APPROVAL_WAIT]);
        if (stall) return stall;
      }
      continue; // 그 밖(CI 대기, 열린 지적, 충돌)은 2번에서 셌다
    }
    if (l.pr && l.pr.state !== 'closed') continue; // PR이 열렸거나 병합됨
    if (l.needsPlanning)
      return {
        task: { kind: 'plan', local: l },
        reason: `계획 ${l.id} 작성이 필요하다`,
        waiting: { ci, human: humanIssues.size },
        excluded: [],
      };
    // 계획 검증 대상인데 아직 올리지 않았다: 계획만 담은 커밋을 먼저 올린다
    if (l.planReview && l.stepStatus !== 'completed')
      return act(
        { kind: 'plan-push', local: l },
        `계획 ${l.id}를 계획만 담은 커밋으로 올려 검증받는다(G1)`,
      );
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
    // 내 선점이 남아 있어도 고르는 경우: revert로 main에서 계획이 빠진 Issue(첫 step의 PR이 되돌려짐).
    // 닫힌 적이 없어 선점이 풀리지 않았고, new-task가 그 계획을 복원한다(8.3절 "되돌리기")
    const restorableMine = (n: number) =>
      claimOwner(env.main, cfg, n) === worker && findRestore(env.main, cfg, gh, n) !== null;
    const open = issues.filter(
      (i) =>
        !i.labels.includes(label) &&
        !locals.some((l) => l.issue === i.number) &&
        (!claims.has(i.number) || restorableMine(i.number)),
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
