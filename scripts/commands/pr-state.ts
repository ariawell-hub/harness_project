// `pr-state`: PR의 필수 체크 상태를 출처와 함께 보여 주고 분류한다(10.3절). 읽기만 한다.
// PR 화면의 체크 요약과 `gh pr checks`는 출처를 보지 않는다. 병합을 막는 것이 무엇인지는 이 명령으로 본다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { worktreeOfBranch } from '../lib/approval.ts';
import { loadConfig } from '../lib/config.ts';
import { gitTry, isBehind, repoInfo } from '../lib/git.ts';
import { getGitHub, type PullRequest } from '../lib/github.ts';
import { findPlan, parseBranch, parseDoc, readIndex } from '../lib/plan.ts';
import { log } from '../lib/util.ts';
import { classifyPr, describeVerdict, requiredStates } from '../runner/pr-state.ts';

/**
 * PR이 맡은 step이 completed인가. 그 브랜치의 worktree에서 계획을 읽는다.
 * worktree나 계획을 찾지 못하면 true로 본다(완료된 step의 PR로 다룬다: 실패한 게이트를 숨기지 않는다)
 */
export function stepCompletedOf(cwd: string, branch: string): boolean {
  try {
    const wt = worktreeOfBranch(cwd, branch);
    const b = parseBranch(branch);
    const ref = wt && b ? findPlan(wt.root, b.id) : null;
    if (!wt || !b || !ref) return true;
    if (ref.kind === 'multi') {
      return readIndex(wt.root, ref).steps[b.step ?? 0]?.status === 'completed';
    }
    const fm = parseDoc(readFileSync(path.join(wt.root, ref.file), 'utf8')).frontmatter;
    return fm?.status === 'completed';
  } catch {
    return true;
  }
}

/** PR head가 기준 브랜치에 뒤처졌는가. head 커밋이 로컬에 없으면 null(알 수 없음) */
export function behindOf(
  cwd: string,
  remote: string,
  branch: string,
  headSha: string,
): boolean | null {
  if (!/^[0-9a-f]{40}$/.test(headSha)) return null;
  if (!gitTry(['cat-file', '-e', `${headSha}^{commit}`], cwd).ok) return null;
  return isBehind(cwd, remote, branch, headSha);
}

export function prState(cwd: string, prNumber: number | null): number {
  const info = repoInfo(cwd);
  const cfg = loadConfig(info.root);
  const gh = getGitHub(info.root);
  let pr: PullRequest | null;
  if (prNumber === null) pr = info.branch ? gh.findPRByBranch(info.branch) : null;
  else pr = gh.getPR(prNumber);
  if (!pr) {
    process.stderr.write(
      prNumber === null
        ? `브랜치 ${info.branch || '(없음)'}의 PR이 없다\n고치는 법: PR이 있는 worktree에서 실행하거나 --pr <번호>를 준다\n`
        : `PR #${prNumber}이 없다\n`,
    );
    return 1;
  }
  log(
    `PR #${pr.number} (${pr.head}) head ${pr.headSha.slice(0, 12) || '?'} · ${pr.state}${pr.isDraft ? ' · 초안' : ''} · mergeStateStatus=${pr.mergeState || '?'} · 자동 병합 ${pr.autoMerge ? '켜짐' : '꺼짐'}`,
  );
  if (cfg.ci.requiredChecks.length === 0) {
    log(
      `ci.requiredChecks가 비어 있어 출처별 판정을 하지 않는다. 체크 요약: ${pr.checks}${pr.failingChecks.length ? ` (실패: ${pr.failingChecks.join(', ')})` : ''}`,
    );
    return 0;
  }
  const required = requiredStates(pr.headSha ? gh.commitChecks(pr.headSha) : [], cfg.ci);
  for (const r of required) {
    log(`- ${r.context} [${r.source}]: ${r.state}${r.description ? ` — ${r.description}` : ''}`);
  }
  const { remote, defaultBranch } = cfg.github;
  const behind = behindOf(info.root, remote, defaultBranch, pr.headSha);
  const stepCompleted = stepCompletedOf(info.root, pr.head);
  const verdict = classifyPr({ pr, required, behind: behind === true, stepCompleted });
  log(
    `분류: ${describeVerdict(verdict)} · 뒤처짐: ${behind === null ? '알 수 없음' : behind ? '예' : '아니오'} · step 완료: ${stepCompleted ? '예' : '아니오'}`,
  );
  return 0;
}
