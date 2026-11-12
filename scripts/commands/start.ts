// 세션 시작 절차 (7.1절, S1): fetch → main 체크아웃 fast-forward(안 되면 이유만) → 설정 다시 읽기 →
// ① 열린 needs-human 먼저 보고 ② 정리(main 동기화 결과, 병합된 worktree, 닫힌 Issue의 claim/<N> 선점 해제)
// ③ 다음 할 일 고르기(승인 대기 봇 Issue가 있으면 승인 방법 안내).
// 선점 해제는 GitHub에서 닫혔음을 확인한 Issue만 한다(8.3절).
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { getGitHub, type Comment, type Issue } from '../lib/github.ts';
import { fastForwardMain, repoInfo, type MainSync } from '../lib/git.ts';
import { log, warn } from '../lib/util.ts';
import { cleanupMerged } from '../runner/run.ts';
import {
  BOT_ISSUE_ACCEPT,
  BOT_ISSUE_WAITING_REASON,
  pickNext,
  ownerCommentRejection,
  readLocalPlans,
  sameLogin,
  type ExcludedIssue,
} from '../runner/next.ts';
import { TaskError, fetchRemote, releaseClosedClaims, type ClaimCleanup } from './task.ts';

export function describeTask(t: ReturnType<typeof pickNext>['task']): string {
  switch (t.kind) {
    case 'answered':
      return `답을 받은 #${t.issue} 이어 가기${t.local ? ` (worktree ${t.local.worktree})` : ''}`;
    case 'fix-pr':
      return `PR #${t.pr.number} 체크 실패 수정 (worktree ${t.local.worktree})`;
    case 'update':
      return `PR #${t.pr.number}를 origin/main 병합으로 갱신 (rebase·force push 없이, worktree ${t.local.worktree}, 절차서 5절)`;
    case 'plan':
      return `계획 ${t.local.id} 작성 (worktree ${t.local.worktree}, 파일 ${t.local.ref.file})`;
    case 'step':
      return `계획 ${t.local.id} step${t.local.step ?? ''} 진행 (worktree ${t.local.worktree})`;
    case 'next-step':
      return `계획 ${t.id} step${t.step} 시작: \`node scripts/harness.ts new-task --plan ${t.id} --step ${t.step}\``;
    case 'new-issue':
      return `Issue #${t.issue.number} "${t.issue.title}" 선점: \`node scripts/harness.ts new-task --issue ${t.issue.number} --slug <짧은-이름>\``;
    case 'idle':
      return '할 일 없음';
  }
}

/** 작성자 확인으로 새 Issue 후보에서 뺀 Issue 한 줄(4.5절 5번, 14.6절) */
export function describeExcluded(e: ExcludedIssue): string {
  return `후보 제외: #${e.number} "${e.title}" (작성자 ${e.author || '불명'}) — ${e.reason}`;
}

/**
 * needs-human 항목의 답 상태(9.1절 답변 인정 기준). 마지막 댓글이 인정되는 제작자 댓글이면 답이 있다.
 * 제작자 계정의 댓글인데 인정하지 않으면(다른 계정이 고침 등, TD-26) 이유를 붙인다
 */
export function describeAnswer(comments: Comment[], owner: string): string {
  const last = comments[comments.length - 1];
  if (!last || !owner) return '답변 대기';
  const why = ownerCommentRejection(last, owner);
  if (why === null) return '제작자 답변 있음';
  if (!sameLogin(last.author, owner)) return '답변 대기';
  return `답변 대기 (마지막 제작자 댓글을 답으로 인정하지 않음: ${why}. 새 댓글로 답한다)`;
}

export function describeMainSync(r: MainSync, upstream: string): string {
  switch (r.status) {
    case 'updated':
      return `- main: ${upstream}으로 당겼다 (${r.from.slice(0, 7)} → ${r.to.slice(0, 7)})`;
    case 'up-to-date':
      return `- main: 최신(${upstream}과 같다)`;
    case 'skipped':
      return `- main: 당기지 않았다 — ${r.reason}`;
  }
}

/** ② 정리 절의 선점 해제 줄. 해제·확인 실패가 없으면 "없음" 한 줄 */
export function describeClaimCleanup(r: ClaimCleanup): string[] {
  const lines = [
    ...r.released.map((n) => `- 선점 해제: claim/${n} (Issue #${n} 닫힘)`),
    ...r.failed.map((f) => `- 선점 유지(확인 실패): claim/${f.issue} — ${f.reason}`),
  ];
  return lines.length ? lines : ['- 닫힌 Issue의 선점: 없음'];
}

/**
 * `github.botIssues`가 owner-approved이고 제작자 승인을 기다리는 봇 Issue가 있으면 승인 방법 한 줄.
 * exclude면 승인 경로가 없으므로 안내하지 않는다(null)
 */
export function acceptHint(cfg: HarnessConfig, excluded: ExcludedIssue[]): string | null {
  if (cfg.github.botIssues !== 'owner-approved') return null;
  const waiting = excluded.filter((e) => e.reason === BOT_ISSUE_WAITING_REASON);
  if (!waiting.length) return null;
  const nums = waiting.map((e) => `#${e.number}`).join(', ');
  return `안내: ${nums}에 제작자 계정(${cfg.github.owner})으로 \`${BOT_ISSUE_ACCEPT}\` 한 줄 댓글을 달면 runner 작업 후보가 된다`;
}

export function start(cwd: string, worker: string): number {
  const info = repoInfo(cwd);
  const main = info.mainRoot;
  const before = loadConfig(main);
  try {
    fetchRemote(main, before);
  } catch (e) {
    warn(`원격 fetch 실패(로컬 상태로 진행): ${(e as Error).message.split('\n')[0]}`);
  }
  // fetch가 실패해도 로컬에 있는 마지막 원격 상태 기준으로 시도한다
  const { remote, defaultBranch } = before.github;
  const sync = fastForwardMain(main, remote, defaultBranch);
  // 당긴 main의 설정을 같은 실행에서 쓴다(Issue #4). ①부터는 이 설정만 쓴다
  const cfg = loadConfig(main);
  const gh = getGitHub(main);
  const label = cfg.github.needsHumanLabel;

  log('## ① 사람의 답을 기다리는 항목 (needs-human)');
  let issues: Issue[];
  try {
    issues = gh.listOpenIssues();
  } catch (e) {
    warn(`GitHub 조회 실패: ${(e as Error).message}`);
    return 1;
  }
  const waiting = issues.filter((i) => i.labels.includes(label));
  if (!cfg.github.owner)
    warn('harness.config.json github.owner(제작자 계정)가 비어 있어 답변 작성자를 확인할 수 없다');
  if (!waiting.length) log('- 없음');
  for (const i of waiting) {
    log(`- #${i.number} ${i.title} — ${describeAnswer(gh.comments(i.number), cfg.github.owner)}`);
  }

  log('\n## ② 정리');
  log(describeMainSync(sync, `${remote}/${defaultBranch}`));
  const locals = readLocalPlans({ main, cfg, gh, worker });
  const removed = cleanupMerged(main, cfg, locals);
  log(removed.length ? removed.map((r) => `- 삭제: ${r}`).join('\n') : '- 병합된 worktree: 없음');
  try {
    log(describeClaimCleanup(releaseClosedClaims(main, cfg, gh, issues)).join('\n'));
  } catch (e) {
    if (!(e instanceof TaskError)) throw e;
    warn(`선점 정리 건너뜀: ${e.message.split('\n')[0]}`);
  }

  log('\n## ③ 다음 할 일 (4.5절 우선순위)');
  const pick = pickNext({ main, cfg, gh, worker });
  log(`- ${describeTask(pick.task)}`);
  log(`- 이유: ${pick.reason}`);
  for (const e of pick.excluded) log(`- ${describeExcluded(e)}`);
  const hint = acceptHint(cfg, pick.excluded);
  if (hint) log(`- ${hint}`);
  if (info.isMainCheckout && pick.task.kind !== 'idle') {
    log('- 주의: 지금은 main 체크아웃이다. 코드는 worktree 안에서만 고친다(R3).');
  }
  return 0;
}
