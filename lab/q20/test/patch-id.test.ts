// lab/q20/patch-id.ts의 git 객체 도구(작업 트리 없이 커밋·병합, merge-base 대비 patch-id).
// 시험 리포 없이 임시 리포 하나로 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitAll, gitInit, sh, tmp, write } from '../../../scripts/test/helpers.ts';
import { commitFiles, mergeCommit, patchIdOf } from '../patch-id.ts';

function repo() {
  const dir = tmp('q20-pid-');
  gitInit(dir);
  write(dir, 'README.md', 'base\n');
  write(dir, 'a.txt', 'a base\n');
  const base = commitAll(dir, 'base');
  return { dir, base };
}

const show = (dir: string, rev: string, file: string) => sh('git', ['show', `${rev}:${file}`], dir);
const parents = (dir: string, rev: string) =>
  sh('git', ['rev-list', '--parents', '-n', '1', rev], dir).split(' ').slice(1);

test('commitFiles: 작업 트리를 건드리지 않고 parent 트리 위에 파일을 덮은 커밋을 만든다', () => {
  const { dir, base } = repo();
  const c = commitFiles(dir, base, { 'a.txt': 'changed\n', 'new/x.txt': 'x\n' }, 'msg');
  assert.equal(show(dir, c, 'a.txt'), 'changed');
  assert.equal(show(dir, c, 'new/x.txt'), 'x');
  assert.equal(show(dir, c, 'README.md'), 'base');
  assert.deepEqual(parents(dir, c), [base]);
  assert.equal(sh('git', ['status', '--porcelain'], dir), '', '작업 트리 그대로');
  assert.equal(sh('git', ['rev-parse', 'HEAD'], dir), base, 'HEAD 그대로');
});

test('mergeCommit: 겹치지 않으면 두 부모 병합 커밋, 충돌은 resolve로 해결하고 없으면 예외', () => {
  const { dir, base } = repo();
  const pr = commitFiles(dir, base, { 'a.txt': 'pr\n' }, 'pr');
  const mainB = commitFiles(dir, base, { 'b.txt': 'b\n' }, 'b');
  const clean = mergeCommit(dir, pr, mainB, 'merge');
  assert.deepEqual(clean.conflicts, []);
  assert.deepEqual(parents(dir, clean.commit), [pr, mainB]);
  assert.equal(show(dir, clean.commit, 'a.txt'), 'pr');
  assert.equal(show(dir, clean.commit, 'b.txt'), 'b');

  const mainA = commitFiles(dir, mainB, { 'a.txt': 'main\n' }, 'main a');
  assert.throws(
    () => mergeCommit(dir, clean.commit, mainA, 'conflict'),
    /해결하지 않은 충돌: a\.txt/,
  );
  const resolved = mergeCommit(dir, clean.commit, mainA, 'resolved', { 'a.txt': 'pr\n' });
  assert.deepEqual(resolved.conflicts, ['a.txt']);
  assert.equal(show(dir, resolved.commit, 'a.txt'), 'pr');
  assert.deepEqual(parents(dir, resolved.commit), [clean.commit, mainA]);
});

test('patchIdOf: 겹치지 않는 main 병합 뒤에는 같고, 충돌 해결로 PR 변경이 바뀌면 다르다', () => {
  const { dir, base } = repo();
  const pr = commitFiles(dir, base, { 'a.txt': 'pr\n' }, 'pr');
  const before = patchIdOf(dir, base, pr);
  assert.equal(before.mergeBase, base);

  const mainB = commitFiles(dir, base, { 'b.txt': 'b\n' }, 'b');
  const merged = mergeCommit(dir, pr, mainB, 'merge').commit;
  const after = patchIdOf(dir, mainB, merged);
  assert.equal(after.mergeBase, mainB, '병합 뒤 merge-base는 병합한 main 커밋');
  assert.equal(after.patchId, before.patchId, '겹치지 않으면 patch-id 유지');

  const mainA = commitFiles(dir, mainB, { 'a.txt': 'main\n' }, 'main a');
  const resolved = mergeCommit(dir, merged, mainA, 'resolved', { 'a.txt': 'pr\n' }).commit;
  assert.notEqual(
    patchIdOf(dir, mainA, resolved).patchId,
    before.patchId,
    '충돌 해결 뒤에는 달라진다',
  );
});
