// 승인 요청 표시(Issue #78 step2). `pr-ready`가 worktree별 하네스 상태 폴더에 남기고, L1 훅이 읽는다.
// 표시는 승인을 요청한 시점의 HEAD sha다. git이 추적하지 않고, worktree가 지워지면 함께 사라진다.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { gitTry, listWorktrees, revParse, tryRepoInfo, type RepoInfo } from './git.ts';
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
 * 기본 브랜치의 원격 추적 ref 전체 이름. 짧은 이름(`origin/main`)은 같은 이름의 로컬 브랜치가 먼저 잡혀 쓰지 않는다.
 * 원격·브랜치 이름은 `pr-ready`처럼 메인 체크아웃의 설정에서 읽고, 못 읽으면 `origin`·`main`이다
 */
function defaultBranchRef(info: RepoInfo): string {
  let remote = 'origin';
  let branch = 'main';
  try {
    ({ remote, defaultBranch: branch } = loadConfig(info.mainRoot).github);
  } catch {
    // 설정이 없는 리포(테스트 등)는 기본값으로 본다
  }
  return `refs/remotes/${remote}/${branch}`;
}

/** `git rev-list --count --no-merges <revs>`. 실패하면 null */
function countNonMerges(revs: string[], cwd: string): number | null {
  const r = gitTry(['rev-list', '--count', '--no-merges', ...revs], cwd);
  if (!r.ok) return null;
  const n = Number(r.stdout.trim());
  return Number.isInteger(n) ? n : null;
}

/** `git merge-base a b`. 실패하면 null */
function mergeBase(a: string, b: string, cwd: string): string | null {
  const r = gitTry(['merge-base', a, b], cwd);
  return r.ok ? r.stdout.trim() : null;
}

/** a와 b 사이에 내용이 다른 파일 이름. 실패하면 null. 파일 이름을 git 인자로 넘기지 않는다(pathspec이 된다) */
function changedNames(a: string, b: string, cwd: string): Set<string> | null {
  const r = gitTry(['diff', '--name-only', '-z', '--no-renames', a, b], cwd);
  return r.ok ? new Set(r.stdout.split('\0').filter(Boolean)) : null;
}

/**
 * 표시 뒤의 변경이 기본 브랜치 병합뿐인가: PR이 기본 브랜치에 더하는 변경이 표시 때와 같은가.
 * 승인 이어받기(설계서 10.3절, `scripts/ci/binding.ts`)가 main 병합 갱신을 알아보는 조건과 같은 꼴이다.
 * (가) PR 파일 목록이 같다 (나) PR 파일 내용이 바이트 단위로 같다 (다) 그사이 기본 브랜치가 PR 파일을 바꾸지 않았다.
 * 셋이면 HEAD는 "그때의 기본 브랜치 + 표시 때의 PR 변경"이다. 커밋 그래프의 모양은 보지 않는다:
 * 지금의 ref로는 과거 병합이 main 병합이었는지 가릴 수 없고, 병합 커밋 안에 섞인 변경도 내용으로만 보인다.
 * git 명령이 실패하면(공통 조상이 없는 ref 등) null: 판정하지 못했다
 */
function onlyBaseMerged(marker: string, base: string, cwd: string): boolean | null {
  const oldBase = mergeBase(marker, base, cwd);
  const newBase = mergeBase('HEAD', base, cwd);
  if (!oldBase || !newBase) return null;
  const prOld = changedNames(oldBase, marker, cwd);
  const prNew = changedNames(newBase, 'HEAD', cwd);
  const sinceMarker = changedNames(marker, 'HEAD', cwd);
  const onBase = changedNames(oldBase, newBase, cwd);
  if (!prOld || !prNew || !sinceMarker || !onBase) return null;
  // 표시 때의 PR 파일이 없으면(표시가 이미 기본 브랜치에 들어갔다 등) 견줄 근거가 없어 막는다
  if (prOld.size === 0) return false;
  if (prOld.size !== prNew.size || [...prOld].some((f) => !prNew.has(f))) return false;
  return ![...prOld].some((f) => sinceMarker.has(f) || onBase.has(f));
}

/**
 * 승인 요청 표시가 있는 브랜치면, 표시 뒤 PR 브랜치에 더한 새 커밋 수를 돌려준다. 0이면 막지 않는다.
 * 표시가 없거나 알 수 없으면 null(막지 않는다).
 * PR이 기본 브랜치에 더하는 변경이 표시 때와 같으면(main 병합 갱신, 절차서 5절) 0이다(Issue #243: 전에는
 * 표시 뒤 병합 아닌 커밋을 모두 세서, 승인 요청 뒤 main이 움직이면 갱신 push가 막혔다).
 * 다르면 표시 뒤 병합 아닌 커밋 가운데 기본 브랜치에 없는 것의 수이고, 0이면 1이다(병합 커밋 안의 변경 등).
 * HEAD가 표시와 같으면 0이다(기본 브랜치가 표시를 품은 뒤 fetch만 한 경우도).
 * 기본 브랜치의 원격 추적 ref가 없거나, 표시가 HEAD의 조상이 아니거나, 이 비교를 끝내지 못하면 예전 셈
 * (표시 뒤의 병합 아닌 커밋 수)을 돌려준다. fetch는 하지 않는다: ref가 오래됐으면 더 막을 뿐이다
 */
export function approvalPending(dir: string, branch: string | null): number | null {
  try {
    const wt = worktreeOfBranch(dir, branch);
    if (!wt) return null;
    const sha = readApprovalMarker(wt);
    if (!sha) return null;
    const before = countNonMerges(['HEAD', `^${sha}`], wt.root);
    if (before === null) return null;
    if (revParse('HEAD', wt.root) === revParse(sha, wt.root)) return 0;
    const base = revParse(defaultBranchRef(wt), wt.root);
    const descends = gitTry(['merge-base', '--is-ancestor', sha, 'HEAD'], wt.root).ok;
    if (!base || !descends) return before;
    const same = onlyBaseMerged(sha, base, wt.root);
    if (same === null) return before;
    if (same) return 0;
    const n = countNonMerges(['HEAD', `^${sha}`, `^${base}`], wt.root);
    return Math.max(n ?? before, 1);
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
