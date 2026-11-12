// 세션 시작 절차 (7.1절, S1): ① 열린 needs-human 먼저 보고 ② 병합된 worktree 정리 ③ 다음 할 일 고르기.
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { getGitHub } from '../lib/github.ts';
import { repoInfo } from '../lib/git.ts';
import { log, warn } from '../lib/util.ts';
import { cleanupMerged } from '../runner/run.ts';
import {
  BOT_ISSUE_ACCEPT,
  BOT_ISSUE_WAITING_REASON,
  pickNext,
  readLocalPlans,
  type ExcludedIssue,
} from '../runner/next.ts';
import { fetchRemote } from './task.ts';

export function describeTask(t: ReturnType<typeof pickNext>['task']): string {
  switch (t.kind) {
    case 'answered':
      return `답을 받은 #${t.issue} 이어 가기${t.local ? ` (worktree ${t.local.worktree})` : ''}`;
    case 'fix-pr':
      return `PR #${t.pr.number} 체크 실패 수정 (worktree ${t.local.worktree})`;
    case 'rebase':
      return `PR #${t.pr.number}를 main 위로 rebase (worktree ${t.local.worktree})`;
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
  const cfg = loadConfig(main);
  try {
    fetchRemote(main, cfg);
  } catch (e) {
    warn(`원격 fetch 실패(로컬 상태로 진행): ${(e as Error).message.split('\n')[0]}`);
  }
  const gh = getGitHub(main);
  const label = cfg.github.needsHumanLabel;

  log('## ① 사람의 답을 기다리는 항목 (needs-human)');
  let issues;
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
    const cs = gh.comments(i.number);
    const last = cs[cs.length - 1];
    const answered = !!last && !!cfg.github.owner && last.author === cfg.github.owner;
    log(`- #${i.number} ${i.title} — ${answered ? '제작자 답변 있음' : '답변 대기'}`);
  }

  log('\n## ② 병합된 worktree 정리');
  const locals = readLocalPlans({ main, cfg, gh, worker });
  const removed = cleanupMerged(main, cfg, locals);
  log(removed.length ? removed.map((r) => `- 삭제: ${r}`).join('\n') : '- 없음');

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
