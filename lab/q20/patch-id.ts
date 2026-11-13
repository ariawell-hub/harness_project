// Q20 시험 항목 patch-id(계획 20261111-q20-lab step1, 설계서 10.3절 승인 결속, ADR-0006).
// PR의 "merge-base 대비 diff"의 `git patch-id --stable`을 계산하고, 병합 방식 갱신에서 유지되는지 시험한다.
// deploy.ts와 같이 작업 트리를 쓰지 않는다. git 객체와 git-dir 아래 임시 index만 만든다(R3). force push는 없다(R14).
//
//   node lab/q20/patch-id.ts <PR 번호>        # 시험 리포 PR의 patch-id를 JSON으로 출력
//   node lab/q20/patch-id.ts --experiment     # 시험 전체를 돌리고 results/patch-id.json을 쓴다
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, gitTry, repoInfo } from '../../scripts/lib/git.ts';
import { runSync } from '../../scripts/lib/exec.ts';
import { LAB_REPO, LAB_URL } from './deploy.ts';

export interface PatchIdResult {
  head: string;
  mergeBase: string;
  patchId: string;
}

/** base와 head의 merge-base 대비 diff의 `git patch-id --stable` */
export function patchIdOf(cwd: string, base: string, head: string): PatchIdResult {
  const mergeBase = git(['merge-base', base, head], cwd);
  const diff = git(['diff', '--no-color', '--no-ext-diff', mergeBase, head], cwd);
  const r = runSync('git', ['patch-id', '--stable'], { cwd, input: diff + '\n' });
  if (r.code !== 0) throw new Error(`git patch-id 실패: ${r.stderr.trim()}`);
  const patchId = r.stdout.trim().split(/\s+/)[0] ?? '';
  if (!patchId) throw new Error(`patch-id가 비었다(diff 없음): ${mergeBase}..${head}`);
  return { head: git(['rev-parse', head], cwd), mergeBase, patchId };
}

/** parent 트리 위에 files(경로 → 내용)를 덮은 커밋을 만든다 */
export function commitFiles(
  cwd: string,
  parent: string,
  files: Record<string, string>,
  message: string,
  parents: string[] = [parent],
): string {
  const tree = treeWith(cwd, `${parent}^{tree}`, files);
  return git(['commit-tree', tree, ...parents.flatMap((p) => ['-p', p]), '-m', message], cwd);
}

function treeWith(cwd: string, baseTree: string, files: Record<string, string>): string {
  const info = repoInfo(cwd);
  const indexFile = path.join(info.gitDir, `q20-pid-index-${process.pid}`);
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    git(['read-tree', baseTree], cwd, env);
    for (const [file, content] of Object.entries(files)) {
      const r = runSync('git', ['hash-object', '-w', '--stdin'], { cwd, input: content });
      if (r.code !== 0) throw new Error(`hash-object 실패: ${r.stderr.trim()}`);
      git(['update-index', '--add', '--cacheinfo', `100644,${r.stdout.trim()},${file}`], cwd, env);
    }
    return git(['write-tree'], cwd, env);
  } finally {
    rmSync(indexFile, { force: true });
  }
}

export type MergeResult = { commit: string; conflicts: string[] };

/**
 * ours에 theirs를 병합한 커밋(부모 ours, theirs)을 만든다. `git merge-tree --write-tree`로 작업 트리 없이 한다.
 * 충돌하면 resolve(경로 → 해결한 내용)로 충돌 파일을 덮는다. 해결하지 않은 충돌이 남으면 예외.
 */
export function mergeCommit(
  cwd: string,
  ours: string,
  theirs: string,
  message: string,
  resolve: Record<string, string> = {},
): MergeResult {
  const r = gitTry(['merge-tree', '--write-tree', '--name-only', ours, theirs], cwd);
  const lines = r.stdout.split('\n');
  const tree = lines[0]?.trim() ?? '';
  if (!/^[0-9a-f]{40}$/.test(tree)) throw new Error(`merge-tree 실패: ${r.stderr.trim()}`);
  if (r.ok) {
    return {
      commit: git(['commit-tree', tree, '-p', ours, '-p', theirs, '-m', message], cwd),
      conflicts: [],
    };
  }
  const blank = lines.indexOf('', 1);
  const conflicts = lines.slice(1, blank < 0 ? undefined : blank).filter(Boolean);
  const missing = conflicts.filter((f) => !(f in resolve));
  if (missing.length) throw new Error(`해결하지 않은 충돌: ${missing.join(', ')}`);
  const resolved = treeWith(cwd, tree, resolve);
  return {
    commit: git(['commit-tree', resolved, '-p', ours, '-p', theirs, '-m', message], cwd),
    conflicts,
  };
}

// ---------- 시험 리포 ----------

const ref = (name: string) => `refs/q20-lab/pid/${name}`;

/** 시험 리포 main과 PR head를 가져온다 */
export function fetchLab(cwd: string, pr?: number): { main: string; head?: string } {
  const specs = ['+refs/heads/main:' + ref('main')];
  if (pr) specs.push(`+refs/pull/${pr}/head:${ref(`pr-${pr}`)}`);
  git(['fetch', '--quiet', '--no-write-fetch-head', LAB_URL, ...specs], cwd);
  return {
    main: git(['rev-parse', ref('main')], cwd),
    head: pr ? git(['rev-parse', ref(`pr-${pr}`)], cwd) : undefined,
  };
}

export function prPatchId(cwd: string, pr: number): PatchIdResult & { pr: number } {
  const { main, head } = fetchLab(cwd, pr);
  return { pr, ...patchIdOf(cwd, main, head!) };
}

function gh(args: string[], cwd: string): string {
  const r = runSync('gh', args, { cwd });
  if (r.code !== 0) throw new Error(`gh ${args.join(' ')} 실패: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function push(cwd: string, commit: string, branch: string): void {
  if (!/^q20\/[A-Za-z0-9._-]+$/.test(branch)) throw new Error(`q20/ 브랜치만 쓴다: ${branch}`);
  git(['push', '--quiet', LAB_URL, `${commit}:refs/heads/${branch}`], cwd);
}

function openPR(cwd: string, branch: string, title: string): { number: number; url: string } {
  const url = gh(
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
      '계획 20261111-q20-lab step1 patch-id 시험(lab/q20/patch-id.ts).',
    ],
    cwd,
  );
  return { number: Number(url.split('/').pop()), url };
}

/**
 * head가 GitHub PR에 반영된 뒤 squash 병합한다. push 직후에는 GitHub이 새 head를 아직 모를 수 있어
 * "Head branch was modified"로 거부된다(1차 실행에서 관찰). 기대 head를 고정해(--match-head-commit) 기다렸다 다시 시도한다.
 */
async function mergePR(cwd: string, n: number, head: string, tries = 20): Promise<void> {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const cur = gh(
      ['pr', 'view', String(n), '-R', LAB_REPO, '--json', 'headRefOid', '--jq', '.headRefOid'],
      cwd,
    );
    if (cur === head) {
      const r = runSync(
        'gh',
        ['pr', 'merge', String(n), '-R', LAB_REPO, '--squash', '--match-head-commit', head],
        { cwd },
      );
      if (r.code === 0) return;
      last = r.stderr.trim();
      if (!/Head branch was modified|not mergeable|Base branch was modified/i.test(last))
        throw new Error(`PR #${n} 병합 실패: ${last}`);
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`PR #${n} 병합 실패(head 동기화 대기 초과): ${last}`);
}

/**
 * push 직후에는 `refs/pull/<n>/head`가 늦게 갱신된다(2차 실행에서 관찰: 옛 head로 재면 측정이 틀린다).
 * PR ref가 expected가 될 때까지 기다린 뒤 그때의 main 기준으로 patch-id를 잰다.
 */
async function patchIdAt(
  cwd: string,
  pr: number,
  expected: string,
  timeoutMs = 120_000,
): Promise<PatchIdResult & { pr: number; main: string }> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { main, head } = fetchLab(cwd, pr);
    if (head === expected) return { pr, main, ...patchIdOf(cwd, main, head) };
    if (Date.now() > end)
      throw new Error(`PR #${pr} ref가 ${timeoutMs}ms 안에 ${expected.slice(0, 12)}가 되지 않았다`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function waitHead(cwd: string, pr: number, not: string, timeoutMs = 90_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const { head } = fetchLab(cwd, pr);
    if (head && head !== not) return head;
    if (Date.now() > end) throw new Error(`PR #${pr} head가 ${timeoutMs}ms 안에 바뀌지 않았다`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

interface Case {
  name: string;
  expected: string;
  observed: string;
  verdict: 'pass' | 'fail' | 'partial' | 'n/a';
  evidence: string[];
}

/** 시험 전체(step1 작업 1~4). 브랜치 이름에 실행 시각을 붙여 다시 돌려도 겹치지 않는다 */
export async function experiment(cwd: string): Promise<{ summary: string; cases: Case[] }> {
  const tag = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const br = (n: string) => `q20/pid-${n}-${tag}`;
  const short = (s: string) => s.slice(0, 12);
  const cases: Case[] = [];
  const m0 = fetchLab(cwd).main;

  // 1. PR A1·A2(a.txt), PR B(b.txt) 병합
  const a1c = commitFiles(cwd, m0, { 'a.txt': `A1 ${tag}: PR이 바꾼 줄\n` }, 'pid: A1 a.txt');
  push(cwd, a1c, br('a1'));
  const a1 = openPR(cwd, br('a1'), `pid A1 (${tag})`);
  const a2c = commitFiles(cwd, m0, { 'a2.txt': `A2 ${tag}: PR이 바꾼 줄\n` }, 'pid: A2 a2.txt');
  push(cwd, a2c, br('a2'));
  const a2 = openPR(cwd, br('a2'), `pid A2 (${tag})`);
  const a1Before = await patchIdAt(cwd, a1.number, a1c);
  const a2Before = await patchIdAt(cwd, a2.number, a2c);
  const bc = commitFiles(cwd, m0, { 'b.txt': `B ${tag}: main이 바꾼 다른 파일\n` }, 'pid: B b.txt');
  push(cwd, bc, br('b'));
  const b = openPR(cwd, br('b'), `pid B (${tag})`);
  await mergePR(cwd, b.number, bc);
  const m1 = fetchLab(cwd).main;

  // 2-(1). A1: main 병합 커밋 + 일반 push(ADR-0006)
  const a1m = mergeCommit(cwd, a1c, m1, `Merge main into ${br('a1')}`);
  push(cwd, a1m.commit, br('a1'));
  const a1After = await patchIdAt(cwd, a1.number, a1m.commit);
  cases.push({
    name: '겹치지 않는 main 변경 뒤 main 병합 + 일반 push(ADR-0006)',
    expected: 'patch-id가 같다(승인 이어받기 가능)',
    observed: `갱신 전 head ${short(a1Before.head)} patch-id ${short(a1Before.patchId)} → 병합 커밋 ${short(a1After.head)} patch-id ${short(a1After.patchId)}. merge-base ${short(a1Before.mergeBase)} → ${short(a1After.mergeBase)}`,
    verdict: a1Before.patchId === a1After.patchId ? 'pass' : 'fail',
    evidence: [a1.url, b.url],
  });

  // 2-(2). A2: GitHub Update branch(merge)
  gh(
    [
      'api',
      '-X',
      'PUT',
      `repos/${LAB_REPO}/pulls/${a2.number}/update-branch`,
      '-f',
      `expected_head_sha=${a2c}`,
    ],
    cwd,
  );
  const a2Updated = await waitHead(cwd, a2.number, a2c);
  const a2After = await patchIdAt(cwd, a2.number, a2Updated);
  cases.push({
    name: '겹치지 않는 main 변경 뒤 GitHub Update branch(merge)',
    expected: 'patch-id가 같다',
    observed: `갱신 전 head ${short(a2Before.head)} patch-id ${short(a2Before.patchId)} → GitHub 병합 커밋 ${short(a2After.head)} patch-id ${short(a2After.patchId)}`,
    verdict: a2Before.patchId === a2After.patchId ? 'pass' : 'fail',
    evidence: [a2.url],
  });
  gh(['pr', 'close', String(a2.number), '-R', LAB_REPO, '--delete-branch'], cwd);

  // 3. main이 a.txt를 바꾼 뒤 A1에 main 병합(충돌 해결: PR 쪽 내용 유지)
  const cc = commitFiles(
    cwd,
    m1,
    { 'a.txt': `C ${tag}: main이 같은 파일을 바꿈\n` },
    'pid: C a.txt',
  );
  push(cwd, cc, br('c'));
  const c = openPR(cwd, br('c'), `pid C (${tag})`);
  await mergePR(cwd, c.number, cc);
  const m2 = fetchLab(cwd).main;
  const a1Conf = mergeCommit(cwd, a1m.commit, m2, `Merge main into ${br('a1')} (충돌 해결)`, {
    'a.txt': `A1 ${tag}: PR이 바꾼 줄\n`,
  });
  push(cwd, a1Conf.commit, br('a1'));
  const a1Resolved = await patchIdAt(cwd, a1.number, a1Conf.commit);
  cases.push({
    name: '같은 파일을 바꾼 main 변경 뒤 main 병합(충돌 해결)',
    expected: 'PR이 main에 더하는 변경이 달라지므로 patch-id가 달라진다(다시 검증)',
    observed: `충돌 파일 ${a1Conf.conflicts.join(', ') || '(없음)'}. patch-id ${short(a1After.patchId)} → ${short(a1Resolved.patchId)}`,
    verdict:
      a1Conf.conflicts.length > 0 && a1Resolved.patchId !== a1After.patchId ? 'pass' : 'fail',
    evidence: [a1.url, c.url],
  });

  // 4. 최신 PR의 squash 결과 트리 == PR head 트리
  const latest = { main: fetchLab(cwd).main, head: a1Resolved.head };
  const upToDate = gitTry(['merge-base', '--is-ancestor', latest.main, latest.head], cwd).ok;
  await mergePR(cwd, a1.number, latest.head);
  const m3 = fetchLab(cwd).main;
  const headTree = git(['rev-parse', `${latest.head}^{tree}`], cwd);
  const squashTree = git(['rev-parse', `${m3}^{tree}`], cwd);
  cases.push({
    name: 'main 최신 PR의 squash 병합 결과 트리',
    expected:
      'squash 커밋 트리가 PR head 트리와 같다(10.3절 전제: 새 head의 check가 병합 대상 검증)',
    observed: `병합 직전 main ${short(latest.main)}이 head ${short(latest.head)}의 조상: ${upToDate}. head 트리 ${short(headTree)}, squash 커밋 ${short(m3)} 트리 ${short(squashTree)}. 시험 리포의 "최신 브랜치 필수" 설정은 바꾸지 않았다(R20)`,
    verdict: upToDate && headTree === squashTree ? 'pass' : 'fail',
    evidence: [a1.url],
  });

  const allPass = cases.every((x) => x.verdict === 'pass');
  return {
    summary: allPass
      ? '10.3절 승인 결속(merge-base 대비 diff의 patch-id)은 ADR-0006의 main 병합 갱신과 GitHub Update branch 모두에서 유지되고, 충돌 해결로 PR 변경이 바뀌면 달라진다. main 최신 PR의 squash 결과 트리는 head 트리와 같다. 설계 수정은 필요 없다.'
      : '일부 사례가 기대와 다르다. 사례별 관찰을 보고 10.3절 수정 여부를 정한다.',
    cases,
  };
}

async function main(argv: string[]): Promise<void> {
  const cwd = process.cwd();
  if (argv[0] === '--experiment') {
    const r = await experiment(cwd);
    const out = path.join(repoInfo(cwd).root, 'lab/q20/results/patch-id.json');
    writeFileSync(out, JSON.stringify({ item: 'patch-id', ...r }, null, 2) + '\n');
    process.stdout.write(`${out}\n`);
    return;
  }
  const n = Number(argv[0]);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error('사용법: node lab/q20/patch-id.ts <PR 번호> | --experiment');
  process.stdout.write(JSON.stringify(prPatchId(cwd, n)) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  });
}
