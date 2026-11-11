// 세션 시작 절차 (7.1절, S1): fetch → main 체크아웃 fast-forward(안 되면 이유만) → 설정 다시 읽기 →
// ① 열린 needs-human 먼저 보고 ② 정리(main 동기화 결과, 병합된 worktree) ③ 다음 할 일 고르기.
import { loadConfig } from '../lib/config.ts';
import { getGitHub } from '../lib/github.ts';
import { fastForwardMain, repoInfo, type MainSync } from '../lib/git.ts';
import { log, warn } from '../lib/util.ts';
import { cleanupMerged } from '../runner/run.ts';
import { pickNext, readLocalPlans, type ExcludedIssue } from '../runner/next.ts';
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

  log('\n## ② 정리');
  log(describeMainSync(sync, `${remote}/${defaultBranch}`));
  const locals = readLocalPlans({ main, cfg, gh, worker });
  const removed = cleanupMerged(main, cfg, locals);
  log(removed.length ? removed.map((r) => `- 삭제: ${r}`).join('\n') : '- 병합된 worktree: 없음');

  log('\n## ③ 다음 할 일 (4.5절 우선순위)');
  const pick = pickNext({ main, cfg, gh, worker });
  log(`- ${describeTask(pick.task)}`);
  log(`- 이유: ${pick.reason}`);
  for (const e of pick.excluded) log(`- ${describeExcluded(e)}`);
  if (info.isMainCheckout && pick.task.kind !== 'idle') {
    log('- 주의: 지금은 main 체크아웃이다. 코드는 worktree 안에서만 고친다(R3).');
  }
  return 0;
}
