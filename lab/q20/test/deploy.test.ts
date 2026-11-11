import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitAll, gitInit, sh, tmp, write } from '../../../scripts/test/helpers.ts';
import { deploy } from '../deploy.ts';

/** 시험 리포 역할의 bare 원격(README 하나)과 하네스 역할의 리포를 만든다 */
function fixture() {
  const lab = tmp('q20-lab-');
  gitInit(lab);
  write(lab, 'README.md', 'lab initial\n');
  write(lab, 'keep.txt', 'lab only\n');
  commitAll(lab, 'init');
  const bare = tmp('q20-lab-bare-');
  sh('git', ['clone', '-q', '--bare', lab, bare], lab);
  const labMain = sh('git', ['rev-parse', 'main'], bare);

  const harness = tmp('q20-harness-');
  gitInit(harness);
  write(harness, 'lab/q20/repo/README.md', 'from harness\n');
  write(harness, 'lab/q20/repo/.github/workflows/probe.yml', 'name: probe\n');
  write(harness, 'lab/q20/attacks/a1/README.md', 'injected\n');
  write(harness, 'lab/q20/attacks/a1/evil/x.txt', 'x\n');
  write(harness, 'other.txt', 'not deployed\n');
  commitAll(harness, 'harness');
  return { bare, labMain, harness };
}

const ls = (bare: string, rev: string) =>
  sh('git', ['ls-tree', '-r', '--name-only', rev], bare).split('\n').sort();
const show = (bare: string, rev: string, file: string) =>
  sh('git', ['show', `${rev}:${file}`], bare);

test('기본 모드: 커밋된 lab/q20/repo 트리를 시험 리포 main 위 커밋으로 push한다', () => {
  const { bare, labMain, harness } = fixture();
  const r = deploy({ cwd: harness, remoteUrl: bare, branch: 'q20/baseline' });
  assert.equal(r.parent, labMain);
  assert.equal(sh('git', ['rev-parse', 'refs/heads/q20/baseline'], bare), r.commit);
  assert.equal(sh('git', ['rev-parse', `${r.commit}^`], bare), labMain);
  assert.deepEqual(ls(bare, r.commit), ['.github/workflows/probe.yml', 'README.md']);
  assert.equal(r.tree, sh('git', ['rev-parse', 'HEAD:lab/q20/repo'], harness));
});

test('overlay 모드: 시험 리포 main 트리를 유지하고 overlay 파일만 덮는다', () => {
  const { bare, labMain, harness } = fixture();
  const r = deploy({
    cwd: harness,
    remoteUrl: bare,
    branch: 'q20/attack-a1',
    overlayDir: 'lab/q20/attacks/a1',
  });
  assert.equal(r.parent, labMain);
  assert.deepEqual(ls(bare, r.commit), ['README.md', 'evil/x.txt', 'keep.txt']);
  assert.equal(show(bare, r.commit, 'README.md'), 'injected');
  assert.equal(show(bare, r.commit, 'keep.txt'), 'lab only');
});

test('커밋하지 않은 변경이 있거나 브랜치 이름이 q20/가 아니면 거부한다', () => {
  const { bare, harness } = fixture();
  assert.throws(() => deploy({ cwd: harness, remoteUrl: bare, branch: 'main' }), /q20\//);
  write(harness, 'lab/q20/repo/README.md', 'dirty\n');
  assert.throws(
    () => deploy({ cwd: harness, remoteUrl: bare, branch: 'q20/x' }),
    /커밋하지 않은 변경/,
  );
});

test('작업 트리를 바꾸지 않는다', () => {
  const { bare, harness } = fixture();
  deploy({ cwd: harness, remoteUrl: bare, branch: 'q20/y', overlayDir: 'lab/q20/attacks/a1' });
  assert.equal(sh('git', ['status', '--porcelain'], harness), '');
});
