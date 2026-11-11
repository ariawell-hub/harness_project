// Q20 시험 리포 배포 도구(ADR-0004, 계획 20261111-q20-lab step0).
// 하네스 리포에 커밋된 트리로 시험 리포에 브랜치 커밋을 만들고 PR을 연다.
// 작업 트리 파일은 쓰지 않는다. git 객체와 git-dir 아래 임시 index만 만든다(R3).
//
//   node lab/q20/deploy.ts --branch q20/<이름> [--overlay <디렉터리>] [--title <제목>] [--merge]
import { rmSync } from 'node:fs';
import path from 'node:path';
import { git, gitTry, repoInfo } from '../../scripts/lib/git.ts';
import { runSync } from '../../scripts/lib/exec.ts';

export const LAB_REPO = 'ariawell-hub/harness-q20-lab';
export const LAB_URL = `https://github.com/${LAB_REPO}.git`;
export const SOURCE_DIR = 'lab/q20/repo';
const LAB_MAIN_REF = 'refs/q20-lab/main';

export interface DeployOptions {
  /** 하네스 리포(worktree) 안의 아무 경로 */
  cwd: string;
  /** 시험 리포 원격 URL. 테스트에서는 로컬 bare 리포 경로 */
  remoteUrl: string;
  /** 만들 브랜치. q20/ 접두어 필수 */
  branch: string;
  /** 지정하면 시험 리포 main 트리 위에 이 디렉터리(커밋된 HEAD 기준)의 파일만 덮는다 */
  overlayDir?: string;
  /** 전체 트리 원본 디렉터리(커밋된 HEAD 기준). 기본 lab/q20/repo */
  sourceDir?: string;
  message?: string;
}

export interface DeployResult {
  branch: string;
  commit: string;
  parent: string;
  tree: string;
  source: string;
}

function assertBranch(branch: string): void {
  if (!/^q20\/[A-Za-z0-9._-]+$/.test(branch))
    throw new Error(`브랜치 이름은 q20/<이름> 형식이어야 한다: ${branch}`);
}

function assertCommitted(cwd: string, dir: string): void {
  const dirty = git(['status', '--porcelain', '--', dir], cwd);
  if (dirty)
    throw new Error(`${dir}에 커밋하지 않은 변경이 있다. 배포는 커밋된 HEAD만 쓴다:\n${dirty}`);
  if (!gitTry(['rev-parse', '--verify', '-q', `HEAD:${dir}`], cwd).ok)
    throw new Error(`HEAD에 ${dir}가 없다`);
}

/** 시험 리포 main 끝을 가져와 SHA를 돌려준다 */
export function fetchLabMain(cwd: string, remoteUrl: string): string {
  git(
    ['fetch', '--quiet', '--no-write-fetch-head', remoteUrl, `+refs/heads/main:${LAB_MAIN_REF}`],
    cwd,
  );
  return git(['rev-parse', LAB_MAIN_REF], cwd);
}

/** 시험 리포 main 트리 위에 overlay 디렉터리의 파일만 덮은 트리를 만든다 */
export function overlayTree(cwd: string, baseCommit: string, overlayDir: string): string {
  const info = repoInfo(cwd);
  const indexFile = path.join(info.gitDir, `q20-overlay-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    git(['read-tree', `${baseCommit}^{tree}`], cwd, env);
    const entries = git(['ls-tree', '-r', '-z', `HEAD:${overlayDir}`], cwd)
      .split('\0')
      .filter(Boolean);
    if (entries.length === 0) throw new Error(`overlay ${overlayDir}에 파일이 없다`);
    for (const e of entries) {
      const [meta, file] = e.split('\t');
      const [mode, type, sha] = meta.split(' ');
      if (type !== 'blob') continue;
      git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${file}`], cwd, env);
    }
    return git(['write-tree'], cwd, env);
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/** 커밋을 만들어 시험 리포 브랜치로 push한다. PR은 만들지 않는다 */
export function deploy(o: DeployOptions): DeployResult {
  assertBranch(o.branch);
  const sourceDir = o.sourceDir ?? SOURCE_DIR;
  const dir = o.overlayDir ?? sourceDir;
  assertCommitted(o.cwd, dir);
  const parent = fetchLabMain(o.cwd, o.remoteUrl);
  const tree = o.overlayDir
    ? overlayTree(o.cwd, parent, o.overlayDir)
    : git(['rev-parse', `HEAD:${sourceDir}`], o.cwd);
  const head = git(['rev-parse', 'HEAD'], o.cwd);
  const message =
    o.message ?? `${o.overlayDir ? 'overlay' : 'deploy'}: ${dir} @ harness ${head.slice(0, 12)}`;
  const commit = git(['commit-tree', tree, '-p', parent, '-m', message], o.cwd);
  git(['push', '--quiet', o.remoteUrl, `${commit}:refs/heads/${o.branch}`], o.cwd);
  return { branch: o.branch, commit, parent, tree, source: `${dir}@${head}` };
}

function gh(args: string[], cwd: string): string {
  const r = runSync('gh', args, { cwd });
  if (r.code !== 0) throw new Error(`gh ${args.join(' ')} 실패: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv: string[]): void {
  const branch = arg(argv, 'branch');
  if (!branch) throw new Error('--branch q20/<이름>이 필요하다');
  const overlayDir = arg(argv, 'overlay');
  const cwd = process.cwd();
  const r = deploy({ cwd, remoteUrl: LAB_URL, branch, overlayDir });
  const existing = gh(
    [
      'pr',
      'list',
      '-R',
      LAB_REPO,
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'url',
      '--jq',
      '.[0].url // ""',
    ],
    cwd,
  );
  const title = arg(argv, 'title') ?? `${overlayDir ? 'attack' : 'deploy'}: ${branch}`;
  const url =
    existing ||
    gh(
      [
        'pr',
        'create',
        '-R',
        LAB_REPO,
        '--base',
        'main',
        '--head',
        branch,
        '--title',
        title,
        '--body',
        `하네스 리포 \`${r.source}\`에서 배포(lab/q20/deploy.ts).`,
      ],
      cwd,
    );
  let merged = false;
  if (argv.includes('--merge')) {
    if (overlayDir) throw new Error('공격 PR(--overlay)은 병합하지 않는다');
    gh(['pr', 'merge', url, '-R', LAB_REPO, '--squash'], cwd);
    merged = true;
  }
  process.stdout.write(JSON.stringify({ ...r, pr: url, merged }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}
