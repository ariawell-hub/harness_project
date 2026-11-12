// PR 브랜치 갱신(ADR-0006, Issue #22): origin/main을 병합하고 일반 push로 올린다. force push는 없다.
// 원격 브랜치 갈라짐 판정(Issue #27): runner가 자기 브랜치 push 거부 때 덮어쓰지 않고 멈추는 근거.
// 로컬 bare 원격. 원격 main·PR 브랜치는 별도 clone에서 push해 앞서게 만든다.
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { gitTry, remoteBranchDiverged, updateBranchFromBase } from '../lib/git.ts';
import { advanceRemote, commitAll, makeFixture, sh, write, type Fixture } from './helpers.ts';

const BRANCH = 'feat/20261112-demo-s0';

const rev = (root: string, ref = 'HEAD') => sh('git', ['rev-parse', ref], root);
const remoteHead = (fx: Fixture) =>
  sh('git', ['ls-remote', fx.remote, `refs/heads/${BRANCH}`], fx.root).split(/\s+/)[0];
const parents = (root: string) =>
  sh('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], root).split(' ').slice(1);
const porcelain = (root: string) => sh('git', ['status', '--porcelain'], root);
const merging = (root: string) => gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], root).ok;

/** main에 shared.txt를 두고, PR 브랜치에서 커밋 하나를 만들어 push한다. PR head를 돌려준다 */
function setupPR(fx: Fixture, file = 'pr.txt', content = 'pr\n'): string {
  write(fx.root, 'shared.txt', 'base\n');
  commitAll(fx.root, 'base: shared');
  sh('git', ['push', '-q', 'origin', 'main'], fx.root);
  sh('git', ['checkout', '-q', '-b', BRANCH], fx.root);
  write(fx.root, file, content);
  const sha = commitAll(fx.root, 'pr: change');
  sh('git', ['push', '-q', '-u', 'origin', BRANCH], fx.root);
  return sha;
}

const update = (fx: Fixture, remote = 'origin') =>
  updateBranchFromBase(fx.root, remote, 'main', BRANCH);

test('updateBranchFromBase: main이 앞서면 직접 fetch해 병합 커밋을 만들고 일반 push로 갱신한다 (a)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    const mainSha = advanceRemote(fx, 'remote.txt', 'r\n', { fetch: false });
    const r = update(fx);
    assert.equal(r.status, 'updated');
    const now = rev(fx.root);
    assert.deepEqual(r, { status: 'updated', from: before, to: now });
    assert.deepEqual(parents(fx.root), [before, mainSha], '첫 부모는 PR head, 둘째는 main');
    assert.equal(remoteHead(fx), now, '원격 PR 브랜치가 새 head를 가리킨다');
    assert.equal(porcelain(fx.root), '');
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: 이미 main을 포함하고 원격과 같으면 up-to-date이고 커밋을 만들지 않는다 (b)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    assert.deepEqual(update(fx), { status: 'up-to-date', head: before });
    assert.equal(rev(fx.root), before);
    assert.equal(remoteHead(fx), before);
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: 충돌하면 병합을 취소하고 파일 목록을 돌려주며 HEAD·원격을 그대로 둔다 (c)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx, 'shared.txt', 'pr\n');
    advanceRemote(fx, 'shared.txt', 'main\n', { fetch: false });
    const r = update(fx);
    assert.deepEqual(r, { status: 'conflict', files: ['shared.txt'] });
    assert.equal(rev(fx.root), before, 'HEAD 그대로');
    assert.equal(merging(fx.root), false, '진행 중인 병합이 남지 않는다');
    assert.equal(porcelain(fx.root), '', 'worktree가 깨끗하다');
    assert.equal(remoteHead(fx), before, '원격 그대로');
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: push가 거부되면 failed(push)이고 원격을 덮어쓰지 않는다 (d)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    advanceRemote(fx, 'remote.txt', 'r\n', { fetch: false });
    const hook = path.join(fx.remote, 'hooks', 'pre-receive');
    writeFileSync(hook, '#!/bin/sh\necho "rejected by test" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const r = update(fx);
    assert.equal(r.status, 'failed');
    assert.equal(r.status === 'failed' && r.stage, 'push');
    assert.equal(remoteHead(fx), before, '원격 PR 브랜치 그대로');
    assert.equal(merging(fx.root), false);
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: 원격 PR 브랜치에 로컬에 없는 커밋이 있으면 병합 없이 failed(precheck) (e)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    const other = advanceRemote(fx, 'other.txt', 'o\n', { branch: BRANCH, fetch: false });
    advanceRemote(fx, 'remote.txt', 'r\n', { fetch: false });
    const r = update(fx);
    assert.equal(r.status, 'failed');
    assert.equal(r.status === 'failed' && r.stage, 'precheck');
    assert.equal(rev(fx.root), before, '로컬 병합 커밋을 만들지 않는다');
    assert.equal(remoteHead(fx), other, '원격 PR 브랜치 그대로');
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: 미커밋 변경이 있으면 failed(precheck)이고 아무것도 바꾸지 않는다 (f)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    advanceRemote(fx, 'remote.txt', 'r\n', { fetch: false });
    write(fx.root, 'pr.txt', '고치는 중\n');
    const r = update(fx);
    assert.equal(r.status, 'failed');
    assert.equal(r.status === 'failed' && r.stage, 'precheck');
    assert.equal(rev(fx.root), before);
    assert.equal(porcelain(fx.root), 'M pr.txt');
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: main은 이미 병합했지만 push하지 못한 커밋이 있으면 push한다 (g)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    advanceRemote(fx, 'remote.txt', 'r\n');
    sh('git', ['merge', '-q', '--no-edit', 'origin/main'], fx.root);
    const merged = rev(fx.root);
    assert.deepEqual(update(fx), { status: 'updated', from: before, to: merged });
    assert.equal(remoteHead(fx), merged);
  } finally {
    fx.cleanup();
  }
});

test('updateBranchFromBase: fetch가 실패하면 failed(fetch) (h)', () => {
  const fx = makeFixture();
  try {
    const before = setupPR(fx);
    const r = update(fx, 'no-such-remote');
    assert.equal(r.status, 'failed');
    assert.equal(r.status === 'failed' && r.stage, 'fetch');
    assert.equal(rev(fx.root), before);
  } finally {
    fx.cleanup();
  }
});

test('remoteBranchDiverged: 원격 브랜치에 로컬에 없는 커밋이 있으면 true, 같거나 로컬이 앞서면 false', () => {
  const fx = makeFixture();
  try {
    setupPR(fx);
    assert.equal(remoteBranchDiverged(fx.root, 'origin', BRANCH), false, '같음');
    write(fx.root, 'local.txt', 'l\n');
    commitAll(fx.root, 'local only');
    assert.equal(
      remoteBranchDiverged(fx.root, 'origin', BRANCH),
      false,
      '로컬이 앞섬(일반 push 가능)',
    );
    advanceRemote(fx, 'other.txt', 'o\n', { branch: BRANCH, fetch: false });
    assert.equal(remoteBranchDiverged(fx.root, 'origin', BRANCH), true, '원격에만 커밋이 있음');
  } finally {
    fx.cleanup();
  }
});

test('remoteBranchDiverged: 원격 브랜치가 없거나 fetch가 실패하면 false(확인하지 못함)', () => {
  const fx = makeFixture();
  try {
    sh('git', ['checkout', '-q', '-b', BRANCH], fx.root);
    assert.equal(remoteBranchDiverged(fx.root, 'origin', BRANCH), false, '원격 브랜치 없음');
    assert.equal(remoteBranchDiverged(fx.root, 'no-such-remote', BRANCH), false, 'fetch 실패');
  } finally {
    fx.cleanup();
  }
});
