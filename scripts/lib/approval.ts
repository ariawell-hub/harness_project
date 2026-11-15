// 승인 요청 표시(Issue #78 step2). `pr-ready`가 worktree별 하네스 상태 폴더에 남기고, L1 훅이 읽는다.
// 표시는 승인을 요청한 시점의 HEAD sha다. git이 추적하지 않고, worktree가 지워지면 함께 사라진다.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitTry, listWorktrees, tryRepoInfo, type RepoInfo } from './git.ts';
import { findPlan, parseBranch, parseDoc } from './plan.ts';

export function approvalMarkerFile(info: RepoInfo): string {
  return path.join(info.gitDir, 'harness', 'approval-requested');
}

export function readApprovalMarker(info: RepoInfo): string | null {
  const f = approvalMarkerFile(info);
  if (!existsSync(f)) return null;
  const sha = readFileSync(f, 'utf8').trim();
  return /^[0-9a-f]{7,64}$/.test(sha) ? sha : null;
}

export function writeApprovalMarker(info: RepoInfo, sha: string): void {
  const f = approvalMarkerFile(info);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, `${sha}\n`);
}

export function clearApprovalMarker(info: RepoInfo): void {
  rmSync(approvalMarkerFile(info), { force: true });
}

/** `branch`가 체크아웃된 worktree. branch가 null이면 dir의 worktree. 못 찾으면 null */
export function worktreeOfBranch(dir: string, branch: string | null): RepoInfo | null {
  const here = tryRepoInfo(dir);
  if (!here) return null;
  if (branch === null || here.branch === branch) return here;
  for (const wt of listWorktrees(here.root)) {
    if (wt.branch === branch) return tryRepoInfo(wt.path);
  }
  return null;
}

/**
 * 승인 요청 표시가 있는 브랜치면, 표시 뒤에 더한 "병합이 아닌" 커밋 수를 돌려준다.
 * 표시가 없거나 알 수 없으면 null(막지 않는다). main 병합 갱신(절차서 5절)은 병합 커밋이라 0이다.
 */
export function approvalPending(dir: string, branch: string | null): number | null {
  try {
    const wt = worktreeOfBranch(dir, branch);
    if (!wt) return null;
    const sha = readApprovalMarker(wt);
    if (!sha) return null;
    const r = gitTry(['rev-list', '--count', '--no-merges', `${sha}..HEAD`], wt.root);
    if (!r.ok) return null;
    const n = Number(r.stdout.trim());
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/** 브랜치 계획의 위험도(frontmatter `risk`). 계획 브랜치가 아니거나 못 읽으면 null */
export function planRiskOf(dir: string, branch: string | null): string | null {
  try {
    const wt = worktreeOfBranch(dir, branch);
    if (!wt) return null;
    const b = parseBranch(wt.branch);
    const ref = b ? findPlan(wt.root, b.id) : null;
    if (!ref) return null;
    const risk = parseDoc(readFileSync(path.join(wt.root, ref.file), 'utf8')).frontmatter?.risk;
    return typeof risk === 'string' ? risk : null;
  } catch {
    return null;
  }
}
