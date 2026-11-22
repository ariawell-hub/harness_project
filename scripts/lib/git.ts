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

/**
 * git의 전역 옵션(하위 명령 앞에 둔다): 그 호출의 경로 인자를 pathspec이 아니라 글자 그대로 읽는다.
 * `git … -- <경로>`의 경로는 pathspec이라 `*`·`?`·`[`는 glob이고 `:`으로 시작하면 특수 표기다(`:!x`는 제외).
 * 남이 정한 파일 이름(PR이 바꾼 파일)을 경로 인자로 넘기는 호출에 쓴다:
 * `git([LITERAL_PATHSPECS, 'diff', …, '--', 파일], root)`
 */
export const LITERAL_PATHSPECS = '--literal-pathspecs';

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

export type MainSync =
  | { status: 'updated'; from: string; to: string }
  | { status: 'up-to-date'; head: string }
  | { status: 'skipped'; reason: string };

/**
 * main 체크아웃을 <remote>/<branch>로 fast-forward 한다. fetch는 호출자가 먼저 한다.
 * 사람의 로컬 커밋·미커밋 작업을 지키려고 `merge --ff-only`만 쓴다(R14). 예외를 던지지 않는다.
 */
export function fastForwardMain(mainRoot: string, remote: string, branch: string): MainSync {
  const upstream = `${remote}/${branch}`;
  const skip = (reason: string): MainSync => ({ status: 'skipped', reason });
  try {
    const sym = gitTry(['symbolic-ref', '--short', '-q', 'HEAD'], mainRoot);
    const current = sym.ok ? sym.stdout.trim() : '';
    if (current !== branch) {
      return skip(
        `체크아웃된 브랜치가 ${branch} 브랜치가 아니다(지금: ${current || 'detached HEAD'}). 고치는 법: main 체크아웃을 ${branch} 브랜치로 되돌리고 작업은 worktree에서 한다`,
      );
    }
    const status = gitTry(['status', '--porcelain'], mainRoot);
    if (!status.ok) return skip(`git status 실패: ${firstLine(status.stderr)}`);
    if (status.stdout.trim() !== '') {
      return skip(
        '미커밋 변경이나 추적 안 된 파일이 있다. 고치는 법: git status로 확인해 커밋하거나 치운 뒤 다시 실행한다',
      );
    }
    const target = revParse(upstream, mainRoot);
    if (!target) {
      return skip(`${upstream} 브랜치가 없다. 고치는 법: 원격 설정을 확인하고 fetch가 되는지 본다`);
    }
    const from = revParse('HEAD', mainRoot);
    if (!from) return skip(`${branch} 브랜치에 커밋이 없다`);
    if (from === target) return { status: 'up-to-date', head: from };
    if (!gitTry(['merge-base', '--is-ancestor', 'HEAD', upstream], mainRoot).ok) {
      const n = gitTry(['rev-list', '--count', `${upstream}..HEAD`], mainRoot).stdout.trim() || '?';
      return skip(
        `로컬 ${branch} 브랜치에만 있는 커밋이 ${n}개 있다(${upstream}보다 앞섰거나 갈라졌다). 고치는 법: 그 커밋을 다른 브랜치로 옮겨 PR로 올린 뒤 로컬 ${branch} 브랜치를 ${upstream}에 맞춘다`,
      );
    }
    const m = gitTry(['merge', '--ff-only', '--quiet', upstream], mainRoot);
    if (!m.ok) {
      return skip(
        `fast-forward 실패: ${firstLine(m.stderr)}. 고치는 법: git status로 main 체크아웃을 확인한다`,
      );
    }
    return { status: 'updated', from, to: revParse('HEAD', mainRoot) ?? target };
  } catch (e) {
    return skip(`git 실행 실패: ${firstLine((e as Error).message)}`);
  }
}

export type BranchUpdate =
  | { status: 'up-to-date'; head: string }
  | { status: 'updated'; from: string; to: string }
  | { status: 'conflict'; files: string[] }
  | { status: 'failed'; stage: 'precheck' | 'fetch' | 'merge' | 'push'; reason: string };

/**
 * 원격 브랜치에 로컬 HEAD에 없는 커밋이 있는가(다른 곳에서 push됐거나 로컬 이력을 고쳐 갈라짐).
 * `<remote> <branch>`를 fetch해 판정한다. fetch 실패나 원격 브랜치 없음은 false(확인하지 못함). 예외를 던지지 않는다.
 */
export function remoteBranchDiverged(worktree: string, remote: string, branch: string): boolean {
  try {
    if (!gitTry(['fetch', '--quiet', remote, branch], worktree).ok) return false;
    const ref = `${remote}/${branch}`;
    if (!revParse(ref, worktree)) return false;
    return !gitTry(['merge-base', '--is-ancestor', ref, 'HEAD'], worktree).ok;
  } catch {
    return false;
  }
}

/**
 * `head`(기본 HEAD)가 `<remote>/<branch>`에 뒤처졌는가: 원격 기준 브랜치가 head의 조상이 아니면 true.
 * 로컬에 있는 마지막 원격 상태로 본다(fetch하지 않는다). 판단하지 못하면(ref 없음, git 실패) false.
 * GitHub의 mergeStateStatus는 다른 막힘과 겹칠 때 뒤처짐을 알려 주지 않을 수 있어 로컬 git으로 본다
 */
export function isBehind(cwd: string, remote: string, branch: string, head = 'HEAD'): boolean {
  try {
    const base = `${remote}/${branch}`;
    if (!revParse(base, cwd) || !revParse(head, cwd)) return false;
    return !gitTry(['merge-base', '--is-ancestor', base, head], cwd).ok;
  } catch {
    return false;
  }
}

/**
 * PR 브랜치(worktree의 HEAD)에 <remote>/<base>를 병합하고 일반 push로 <remote>/<branch>를 갱신한다(ADR-0006).
 * rebase·force push는 하지 않는다. 충돌하면 병합을 취소해 worktree와 HEAD를 호출 전으로 둔다
 * (`keepConflict`면 취소하지 않고 병합 진행 중으로 남긴다. 호출한 쪽이 끝내거나 `git merge --abort`한다).
 * 원격 PR 브랜치에 로컬에 없는 커밋이 있으면(다른 곳에서 push됨) 병합하지 않는다. 예외를 던지지 않는다.
 * `updated.from`은 갱신 전 원격 PR 브랜치 head다. push가 실패하면 로컬 병합 커밋은 남고 다음 호출이 push만 다시 한다.
 */
export function updateBranchFromBase(
  worktree: string,
  remote: string,
  base: string,
  branch: string,
  /** keepConflict: 충돌이면 병합을 취소하지 않고 진행 중으로 남긴다(충돌 해결 세션용, TD-27) */
  opts: { keepConflict?: boolean } = {},
): BranchUpdate {
  const fail = (stage: 'precheck' | 'fetch' | 'merge' | 'push', reason: string): BranchUpdate => ({
    status: 'failed',
    stage,
    reason,
  });
  const baseRef = `${remote}/${base}`;
  const branchRef = `${remote}/${branch}`;
  try {
    const status = gitTry(['status', '--porcelain'], worktree);
    if (!status.ok) return fail('precheck', `git status 실패: ${firstLine(status.stderr)}`);
    if (status.stdout.trim() !== '') {
      return fail(
        'precheck',
        '미커밋 변경이나 추적 안 된 파일이 있다. 커밋하거나 치운 뒤 다시 갱신한다',
      );
    }
    const fetched = gitTry(['fetch', '--quiet', remote, base, branch], worktree);
    if (!fetched.ok) return fail('fetch', `git fetch 실패: ${firstLine(fetched.stderr)}`);
    const remoteHead = revParse(branchRef, worktree);
    if (!remoteHead || !revParse(baseRef, worktree)) {
      return fail('fetch', `${baseRef} 또는 ${branchRef}가 없다`);
    }
    if (!gitTry(['merge-base', '--is-ancestor', branchRef, 'HEAD'], worktree).ok) {
      return fail(
        'precheck',
        `${branchRef}에 로컬에 없는 커밋이 있다(다른 곳에서 push됐다). 덮어쓰지 않는다. 고치는 법: 절차서 5절대로 원격 이력을 병합한 뒤 갱신한다`,
      );
    }
    if (!gitTry(['merge-base', '--is-ancestor', baseRef, 'HEAD'], worktree).ok) {
      const m = gitTry(['merge', '--no-edit', '--quiet', baseRef], worktree);
      if (!m.ok) {
        const unmerged = gitTry(['diff', '--name-only', '--diff-filter=U'], worktree);
        const files = unmerged.ok ? unmerged.stdout.split('\n').filter(Boolean) : [];
        const merging = gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], worktree).ok;
        if (files.length && merging && opts.keepConflict) return { status: 'conflict', files };
        if (merging) gitTry(['merge', '--abort'], worktree);
        if (files.length) return { status: 'conflict', files };
        return fail('merge', `git merge 실패: ${firstLine(m.stderr || m.stdout)}`);
      }
    }
    const head = revParse('HEAD', worktree);
    if (!head) return fail('merge', 'HEAD를 읽지 못했다');
    if (head === remoteHead) return { status: 'up-to-date', head };
    const pushed = gitTry(['push', '--quiet', remote, `HEAD:refs/heads/${branch}`], worktree);
    if (!pushed.ok) return fail('push', `git push 실패: ${firstLine(pushed.stderr)}`);
    return { status: 'updated', from: remoteHead, to: head };
  } catch (e) {
    return fail('precheck', `git 실행 실패: ${firstLine((e as Error).message)}`);
  }
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0] || '(출력 없음)';
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
