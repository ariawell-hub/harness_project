// pr-ready: 승인 요청 전 조건(절차서 5절)을 확인하고 PR의 초안을 해제한다(Issue #78 step2).
//   pr-ready        : 조건 확인 → 초안 해제 → 승인 요청 표시(그때의 HEAD sha)
//   pr-ready --undo : 초안으로 되돌리고 표시를 지운다(승인 요청을 거둔다)
// 승인하거나 보호 설정을 바꾸지 않는다(R20). 초안 상태만 바꾼다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { clearApprovalMarker, writeApprovalMarker } from '../lib/approval.ts';
import { loadConfig } from '../lib/config.ts';
import { gitTry, isClean, repoInfo, revParse } from '../lib/git.ts';
import { getGitHub, type GitHubPort } from '../lib/github.ts';
import { findPlan, parseBranch, parseDoc, readIndex } from '../lib/plan.ts';
import { TaskError } from './task.ts';

export interface PrReadyResult {
  pr: number;
  undone: boolean;
  sha: string | null;
}

export function prReady(
  cwd: string,
  opts: { undo?: boolean; github?: GitHubPort } = {},
): PrReadyResult {
  const info = repoInfo(cwd);
  const b = parseBranch(info.branch);
  if (info.isMainCheckout || !b) {
    throw new TaskError(
      `브랜치 ${info.branch}가 계획 브랜치가 아니다\n고치는 법: 작업 worktree 안에서 실행하라`,
    );
  }
  const ref = findPlan(info.root, b.id);
  if (!ref) throw new TaskError(`계획 ${b.id}를 찾을 수 없다`);
  const gh = opts.github ?? getGitHub(info.root);
  const pr = gh.findPRByBranch(info.branch);
  if (!pr || pr.state !== 'open') {
    throw new TaskError(
      `브랜치 ${info.branch}의 열린 PR이 없다\n고치는 법: 먼저 \`gh pr create --draft\`로 초안 PR을 올려라`,
    );
  }
  if (opts.undo) {
    if (!pr.isDraft) gh.setDraft(pr.number, true);
    clearApprovalMarker(info);
    return { pr: pr.number, undone: true, sha: null };
  }

  const cfg = loadConfig(info.mainRoot);
  const remote = cfg.github.remote;
  const base = `${remote}/${cfg.github.defaultBranch}`;
  const problems: string[] = [];

  let done = ref.where === 'completed';
  if (!done && ref.kind === 'multi') {
    done = readIndex(info.root, ref).steps[b.step ?? 0]?.status === 'completed';
  } else if (!done) {
    const text = readFileSync(path.join(info.root, ref.file), 'utf8');
    done = parseDoc(text).frontmatter?.status === 'completed';
  }
  if (!done)
    problems.push('이 step이 완료 처리되지 않았다 → `node scripts/harness.ts complete-step`');

  if (!isClean(info.root)) problems.push('커밋하지 않은 변경이 있다 → 커밋하거나 되돌려라');

  const fetched = gitTry(['fetch', '-q', remote], info.root).ok;
  if (!fetched) problems.push(`\`git fetch ${remote}\`가 실패했다 → 네트워크를 확인하라`);
  const head = revParse('HEAD', info.root);
  const pushed = revParse(`${remote}/${info.branch}`, info.root);
  if (!head || head !== pushed)
    problems.push(
      `HEAD가 ${remote}/${info.branch}와 다르다(push하지 않은 커밋) → \`git push ${remote} ${info.branch}\``,
    );
  if (fetched && !gitTry(['merge-base', '--is-ancestor', base, 'HEAD'], info.root).ok)
    problems.push(
      `${base}에 뒤처졌다 → \`git merge ${base}\` 뒤 check·push(docs/harness/workflow.md 5절)`,
    );

  if (problems.length) {
    throw new TaskError(
      `pr-ready: 승인 요청 전 조건이 안 됐다. PR #${pr.number}은 그대로다.\n- ${problems.join('\n- ')}`,
    );
  }
  if (pr.isDraft) gh.setDraft(pr.number, false);
  writeApprovalMarker(info, head!);
  return { pr: pr.number, undone: false, sha: head };
}
