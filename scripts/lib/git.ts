// git 보조 함수. 모두 동기 실행이며 실패하면 GitError를 던진다(gitTry는 던지지 않음).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSync } from './exec.ts';

export class GitError extends Error {
  stderr: string;
  constructor(message: string, stderr: string) {
    super(message);
    this.stderr = stderr;
  }
}

export function gitTry(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  const r = runSync('git', args, { cwd, env: env ? { ...process.env, ...env } : undefined });
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr, code: r.code };
}

export function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const r = gitTry(args, cwd, env);
  if (!r.ok) {
    throw new GitError(`git ${args.join(' ')} 실패 (${cwd}): ${r.stderr.trim()}`, r.stderr);
  }
  return r.stdout.replace(/\n$/, '');
}

export interface RepoInfo {
  /** 현재 worktree의 루트 */
  root: string;
  /** 현재 worktree의 git-dir (메인 체크아웃이면 .git) */
  gitDir: string;
  /** 모든 worktree가 공유하는 git-dir */
  commonDir: string;
  /** 메인 체크아웃의 루트 */
  mainRoot: string;
  isMainCheckout: boolean;
  branch: string;
}

export function repoInfo(cwd: string): RepoInfo {
  const out = git(
    ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
    cwd,
  ).split('\n');
  const root = out[0];
  const gitDir = path.resolve(out[1]);
  const commonDir = path.resolve(cwd, out[2]);
  // 커밋이 없는 브랜치에서도 동작하도록 symbolic-ref를 쓴다. detached HEAD면 'HEAD'
  const sym = gitTry(['symbolic-ref', '--short', '-q', 'HEAD'], cwd);
  const branch = sym.ok ? sym.stdout.trim() : 'HEAD';
  return {
    root,
    gitDir,
    commonDir,
    mainRoot: path.dirname(commonDir),
    isMainCheckout: gitDir === commonDir,
    branch,
  };
}

/** 리포가 아닌 곳이면 null */
export function tryRepoInfo(cwd: string): RepoInfo | null {
  try {
    return repoInfo(cwd);
  } catch {
    return null;
  }
}

/** git이 추적하지 않는 하네스 상태 폴더. scope=worktree는 worktree별, common은 공유 */
export function harnessStateDir(info: RepoInfo, scope: 'worktree' | 'common'): string {
  const dir = path.join(scope === 'worktree' ? info.gitDir : info.commonDir, 'harness');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function hasCommits(cwd: string): boolean {
  return gitTry(['rev-parse', '--verify', '-q', 'HEAD'], cwd).ok;
}

export function revParse(ref: string, cwd: string): string | null {
  const r = gitTry(['rev-parse', '--verify', '-q', `${ref}^{commit}`], cwd);
  return r.ok ? r.stdout.trim() : null;
}

/** base 후보: origin/<기본 브랜치>와의 merge-base, 없으면 로컬 기본 브랜치 */
export function defaultBase(cwd: string, remote = 'origin', branch = 'main'): string | null {
  for (const ref of [`${remote}/${branch}`, branch]) {
    if (!revParse(ref, cwd)) continue;
    const r = gitTry(['merge-base', 'HEAD', ref], cwd);
    if (r.ok) return r.stdout.trim();
  }
  return null;
}

/**
 * 작업 트리 전체(추적 + 무시되지 않은 새 파일)의 트리 해시.
 * 실제 index를 건드리지 않도록 임시 index 파일을 쓴다(6절 check 캐시 키).
 */
export function worktreeTreeHash(info: RepoInfo): string {
  const tmp = mkdtempSync(path.join(tmpdir(), 'harness-idx-'));
  const idx = path.join(tmp, 'index');
  try {
    const real = path.join(info.gitDir, 'index');
    if (existsSync(real)) copyFileSync(real, idx);
    const env = { GIT_INDEX_FILE: idx };
    git(['add', '-A'], info.root, env);
    return git(['write-tree'], info.root, env);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** base...head (또는 base 대비 작업 트리) 사이에 바뀐 파일 */
export function changedFiles(cwd: string, base: string, head?: string): string[] {
  const args = head
    ? ['diff', '--name-only', '-z', `${base}...${head}`]
    : ['diff', '--name-only', '-z', base];
  const files = git(args, cwd).split('\0').filter(Boolean);
  if (!head) {
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd)
      .split('\0')
      .filter(Boolean);
    files.push(...untracked);
  }
  return [...new Set(files)];
}

export function showFile(cwd: string, rev: string, file: string): string | null {
  const r = gitTry(['show', `${rev}:${file}`], cwd);
  return r.ok ? r.stdout : null;
}

export function isClean(cwd: string): boolean {
  return git(['status', '--porcelain'], cwd).trim() === '';
}

export function remoteBranchExists(cwd: string, remote: string, branch: string): boolean {
  const r = gitTry(['ls-remote', '--exit-code', '--heads', remote, branch], cwd);
  return r.ok && r.stdout.trim() !== '';
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string;
}

export function listWorktrees(cwd: string): WorktreeEntry[] {
  const out = git(['worktree', 'list', '--porcelain'], cwd);
  const list: WorktreeEntry[] = [];
  let cur: Partial<WorktreeEntry> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9), branch: null, head: '' };
    else if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === '' && cur.path) {
      list.push(cur as WorktreeEntry);
      cur = {};
    }
  }
  if (cur.path) list.push(cur as WorktreeEntry);
  return list;
}
