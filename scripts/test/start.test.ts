// start의 세션 시작 절차 테스트(Issue #4): main 동기화(fastForwardMain)와 닫힌 Issue의 선점 해제
// (listRemoteClaims·releaseClosedClaims) 단위 + `harness.ts start` 통합.
// 원격 main은 bare 원격을 별도 clone에서 push해 앞서게 만든다(main 체크아웃을 되돌리지 않는다).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TaskError, claimIssue, listRemoteClaims, releaseClosedClaims } from '../commands/task.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { fastForwardMain } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue, initFakeState } from '../lib/github-fake.ts';
import {
  advanceRemote,
  commitAll,
  fixtureConfig,
  makeFixture,
  sh,
  write,
  type Fixture,
} from './helpers.ts';

const head = (root: string, ref = 'HEAD') => sh('git', ['rev-parse', ref], root);

test('fastForwardMain: 원격이 앞서면 당긴다 (a)', () => {
  const fx = makeFixture();
  try {
    const before = head(fx.root);
    const sha = advanceRemote(fx, 'remote.txt', 'r\n');
    const r = fastForwardMain(fx.root, 'origin', 'main');
    assert.deepEqual(r, { status: 'updated', from: before, to: sha });
    assert.equal(head(fx.root), head(fx.root, 'origin/main'));
    assert.equal(readFileSync(path.join(fx.root, 'remote.txt'), 'utf8'), 'r\n');
  } finally {
    fx.cleanup();
  }
});

test('fastForwardMain: 원격과 같으면 up-to-date (b)', () => {
  const fx = makeFixture();
  try {
    const r = fastForwardMain(fx.root, 'origin', 'main');
    assert.deepEqual(r, { status: 'up-to-date', head: head(fx.root) });
  } finally {
    fx.cleanup();
  }
});

test('fastForwardMain: 추적 파일 변경이 있으면 건드리지 않는다 (c)', () => {
  const fx = makeFixture();
  try {
    const before = head(fx.root);
    advanceRemote(fx, 'remote.txt', 'r\n');
    write(fx.root, 'AGENTS.md', '사람이 고치는 중\n');
    const r = fastForwardMain(fx.root, 'origin', 'main');
    assert.equal(r.status, 'skipped');
    assert.match(r.status === 'skipped' ? r.reason : '', /미커밋 변경/);
    assert.equal(head(fx.root), before);
    assert.equal(readFileSync(path.join(fx.root, 'AGENTS.md'), 'utf8'), '사람이 고치는 중\n');
  } finally {
    fx.cleanup();
  }
});

test('fastForwardMain: main이 아닌 브랜치·detached HEAD면 건드리지 않는다 (d)', () => {
  const fx = makeFixture();
  try {
    advanceRemote(fx, 'remote.txt', 'r\n');
    sh('git', ['switch', '-q', '-c', 'side'], fx.root);
    const before = head(fx.root);
    const r = fastForwardMain(fx.root, 'origin', 'main');
    assert.equal(r.status, 'skipped');
    assert.match(r.status === 'skipped' ? r.reason : '', /side/);
    assert.equal(head(fx.root), before);

    sh('git', ['switch', '-q', '--detach'], fx.root);
    const d = fastForwardMain(fx.root, 'origin', 'main');
    assert.equal(d.status, 'skipped');
    assert.match(d.status === 'skipped' ? d.reason : '', /detached/);
    assert.equal(head(fx.root), before);
  } finally {
    fx.cleanup();
  }
});

test('fastForwardMain: 로컬 main에만 커밋이 있으면 건드리지 않고 그 수를 알린다 (e)', () => {
  const fx = makeFixture();
  try {
    write(fx.root, 'local1.txt', '1\n');
    commitAll(fx.root, 'local 1');
    write(fx.root, 'local2.txt', '2\n');
    const ahead = commitAll(fx.root, 'local 2');
    const r = fastForwardMain(fx.root, 'origin', 'main');
    assert.equal(r.status, 'skipped', '앞섰을 때');
    assert.match(r.status === 'skipped' ? r.reason : '', /2개/);
    assert.equal(head(fx.root), ahead);

    advanceRemote(fx, 'remote.txt', 'r\n');
    const d = fastForwardMain(fx.root, 'origin', 'main');
    assert.equal(d.status, 'skipped', '갈라졌을 때');
    assert.match(d.status === 'skipped' ? d.reason : '', /2개/);
    assert.equal(head(fx.root), ahead);
  } finally {
    fx.cleanup();
  }
});

test('fastForwardMain: 원격 브랜치가 없으면 건드리지 않는다', () => {
  const fx = makeFixture();
  try {
    const before = head(fx.root);
    const r = fastForwardMain(fx.root, 'origin', 'nope');
    assert.equal(r.status, 'skipped');
    assert.equal(head(fx.root), before);
  } finally {
    fx.cleanup();
  }
});

// ---------- start 통합 ----------

const GITHUB_EMPTY_OWNER = {
  ...(fixtureConfig().github as Record<string, unknown>),
  owner: '',
};

function fakeState(fx: Fixture): string {
  const state = path.join(fx.dir, 'gh.json');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
  return state;
}

function runStart(fx: Fixture, state = fakeState(fx)) {
  const r = runSync(process.execPath, ['scripts/harness.ts', 'start'], {
    cwd: fx.root,
    env: { ...process.env, HARNESS_FAKE_GH: state, HARNESS_WORKER: 'start-test' },
  });
  return { code: r.code, out: r.stdout + r.stderr };
}

test('start: main을 origin/main으로 당기고 새 설정을 같은 실행에서 쓴다 (Issue #4)', () => {
  const fx = makeFixture({ github: GITHUB_EMPTY_OWNER });
  try {
    advanceRemote(
      fx,
      'harness.config.json',
      JSON.stringify(fixtureConfig(), null, 2), // owner: "maker"
    );
    const r = runStart(fx);
    assert.equal(r.code, 0, r.out);
    assert.equal(head(fx.root), head(fx.root, 'origin/main'), r.out);
    assert.doesNotMatch(r.out, /github\.owner/, r.out);
    assert.match(r.out, /## ② 정리\n- main: origin\/main으로 당겼다 \([0-9a-f]{7} → [0-9a-f]{7}\)/);
    assert.match(r.out, /- 병합된 worktree: 없음/);
  } finally {
    fx.cleanup();
  }
});

test('start: main 체크아웃에 미커밋 변경이 있으면 이유만 출력하고 넘어간다', () => {
  const fx = makeFixture();
  try {
    const before = head(fx.root);
    advanceRemote(fx, 'remote.txt', 'r\n');
    write(fx.root, 'AGENTS.md', '사람이 고치는 중\n');
    const r = runStart(fx);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /- main: 당기지 않았다 — .*미커밋 변경/);
    assert.equal(head(fx.root), before);
    assert.equal(readFileSync(path.join(fx.root, 'AGENTS.md'), 'utf8'), '사람이 고치는 중\n');
  } finally {
    fx.cleanup();
  }
});

test('start: 원격과 같으면 최신이라고 출력한다', () => {
  const fx = makeFixture();
  try {
    const r = runStart(fx);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /- main: 최신\(origin\/main과 같다\)/);
  } finally {
    fx.cleanup();
  }
});

// ---------- 닫힌 Issue의 선점 해제 (Issue #4) ----------

/** bare 원격을 다른 곳에 clone해 main에서 새 브랜치를 만들어 파일 하나를 바꾸고 push한다 */
function pushBranch(fx: Fixture, branch: string, rel: string, content: string): void {
  const clone = path.join(mkdtempSync(path.join(fx.dir, 'clone-')), 'c');
  sh('git', ['clone', '-q', fx.remote, clone], fx.dir);
  sh('git', ['config', 'user.email', 'test@example.invalid'], clone);
  sh('git', ['config', 'user.name', 'test'], clone);
  sh('git', ['config', 'commit.gpgsign', 'false'], clone);
  sh('git', ['switch', '-q', '-c', branch], clone);
  write(clone, rel, content);
  commitAll(clone, `branch: ${rel}`);
  sh('git', ['push', '-q', 'origin', branch], clone);
}

const remoteClaims = (fx: Fixture) =>
  sh('git', ['ls-remote', '--heads', 'origin', 'claim/*'], fx.root)
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t')[1].replace('refs/heads/', ''))
    .sort();

interface ClaimSetup {
  state: string;
  gh: FakeGitHub;
  cfg: HarnessConfig;
}

/**
 * 가짜 Issue #1(열림), #2(PR 병합 `Closes #2`로 닫힘)와 원격 claim/1·claim/2·claim/99(가짜 GitHub에 없는 번호).
 * 로컬 worktree는 만들지 않는다(대화형 경로에서 worktree를 이미 지운 상태).
 */
function setupClaims(fx: Fixture): ClaimSetup {
  const state = fakeState(fx);
  assert.equal(addFakeIssue(state, '열린 Issue', '열려 있다'), 1);
  assert.equal(addFakeIssue(state, '닫힐 Issue', 'PR 병합으로 닫힌다'), 2);
  const cfg = loadConfig(fx.root);
  for (const n of [1, 2, 99]) claimIssue(fx.root, cfg, n, 'other-machine');
  const gh = new FakeGitHub(state);
  pushBranch(fx, 'feat/close-2', 'closed.txt', 'done\n');
  const pr = gh.createPR({
    head: 'feat/close-2',
    base: 'main',
    title: 'close 2',
    body: 'Closes #2',
  });
  gh.enableAutoMerge(pr.number); // mergeMode immediate: 원격 main에 squash merge → #2 닫힘
  assert.equal(gh.getIssue(2).state, 'closed', '준비: PR 병합으로 #2가 닫힌다');
  assert.equal(gh.getIssue(1).state, 'open');
  assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/2', 'claim/99']);
  return { state, gh, cfg };
}

test('releaseClosedClaims: 닫힌 Issue의 claim만 지우고, 열린 Issue·확인 못 한 claim은 남긴다', () => {
  const fx = makeFixture();
  try {
    const { gh, cfg } = setupClaims(fx);
    const r = releaseClosedClaims(fx.root, cfg, gh, gh.listOpenIssues());
    assert.deepEqual(r.released, [2]);
    assert.deepEqual(r.kept, [1]);
    assert.equal(r.failed.length, 1, JSON.stringify(r.failed));
    assert.equal(r.failed[0].issue, 99);
    assert.match(r.failed[0].reason, /#99/);
    assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/99']);

    // 멱등: 다시 실행해도 오류 없이 지울 것이 없다
    const again = releaseClosedClaims(fx.root, cfg, gh, gh.listOpenIssues());
    assert.deepEqual(again.released, []);
    assert.deepEqual(again.kept, [1]);
    assert.deepEqual(
      again.failed.map((f) => f.issue),
      [99],
    );
    assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/99']);
  } finally {
    fx.cleanup();
  }
});

test('releaseClosedClaims: 열린 Issue 목록에 있는 번호는 GitHub를 다시 부르지 않는다', () => {
  const fx = makeFixture();
  try {
    const { gh, cfg } = setupClaims(fx);
    const asked: number[] = [];
    const spy = Object.create(gh) as FakeGitHub;
    spy.getIssue = (n: number) => {
      asked.push(n);
      return gh.getIssue(n);
    };
    const r = releaseClosedClaims(fx.root, cfg, spy, gh.listOpenIssues());
    assert.deepEqual(asked, [2, 99]);
    assert.deepEqual(r.kept, [1]);
  } finally {
    fx.cleanup();
  }
});

test('releaseClosedClaims: 열린 Issue 목록에 없어도 GitHub에서 열려 있으면 지우지 않는다', () => {
  const fx = makeFixture();
  try {
    const { gh, cfg } = setupClaims(fx);
    // ① 이후에 다시 열렸거나 목록이 잘린 경우: openIssues에는 없지만 실제로는 열려 있다
    const r = releaseClosedClaims(fx.root, cfg, gh, []);
    assert.deepEqual(r.released, [2]);
    assert.deepEqual(r.kept, [1]);
    assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/99']);
  } finally {
    fx.cleanup();
  }
});

test('listRemoteClaims: claim/<숫자>만 번호 오름차순으로 돌려준다', () => {
  const fx = makeFixture();
  try {
    const cfg = loadConfig(fx.root);
    for (const n of [10, 2]) claimIssue(fx.root, cfg, n, 'w');
    for (const b of ['claim/abc', 'claim/3/x', 'claim/04', 'feat/claim/5', 'claimx/6']) {
      sh('git', ['push', '-q', 'origin', `HEAD:refs/heads/${b}`], fx.root);
    }
    assert.deepEqual(listRemoteClaims(fx.root, cfg), [2, 10]);
  } finally {
    fx.cleanup();
  }
});

test('listRemoteClaims: 원격 조회 실패는 TaskError', () => {
  const fx = makeFixture();
  try {
    const cfg = loadConfig(fx.root);
    const bad = { ...cfg, github: { ...cfg.github, remote: 'no-such-remote' } };
    assert.throws(() => listRemoteClaims(fx.root, bad), TaskError);
  } finally {
    fx.cleanup();
  }
});

test('start: 로컬 worktree가 없어도 닫힌 Issue의 claim을 원격에서 지운다 (Issue #4)', () => {
  const fx = makeFixture();
  try {
    const { state } = setupClaims(fx);
    const r = runStart(fx, state);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/99'], r.out);
    assert.match(r.out, /claim\/2/);
    assert.match(r.out, /- 선점 해제: claim\/2 \(Issue #2 닫힘\)/);
    assert.match(r.out, /- 선점 유지\(확인 실패\): claim\/99 — .*#99/);
    assert.doesNotMatch(r.out, /선점 해제: claim\/1\b/);
    // PR 병합으로 앞선 원격 main도 같은 실행에서 당긴다(step0)
    assert.match(r.out, /- main: origin\/main으로 당겼다/);

    // 다시 실행해도 오류 없이 지울 것이 없다
    const again = runStart(fx, state);
    assert.equal(again.code, 0, again.out);
    assert.doesNotMatch(again.out, /선점 해제: claim/);
    assert.deepEqual(remoteClaims(fx), ['claim/1', 'claim/99']);
  } finally {
    fx.cleanup();
  }
});

test('start: claim 목록 조회가 실패해도 경고만 내고 종료 코드는 0', () => {
  const fx = makeFixture();
  try {
    const state = fakeState(fx);
    // 원격이 사라졌다: fetch·ls-remote 모두 실패
    sh('git', ['remote', 'set-url', 'origin', path.join(fx.dir, 'gone.git')], fx.root);
    const r = runStart(fx, state);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /선점 정리 건너뜀/);
    assert.match(r.out, /## ③ 다음 할 일/);
  } finally {
    fx.cleanup();
  }
});

test('start: 마지막 제작자 댓글을 다른 계정이 고쳤으면 답변 대기로 보이고 이유를 붙인다 (TD-26)', () => {
  const fx = makeFixture();
  try {
    const state = fakeState(fx);
    const gh = new FakeGitHub(state);
    const ok = addFakeIssue(state, 'Answered', 'x', ['needs-human']);
    gh.ownerComment(ok, 'A로 하라');
    const bad = addFakeIssue(state, 'Tampered', 'y', ['needs-human']);
    gh.ownerComment(bad, 'A로 하라');
    gh.editCommentAs(bad, 0, 'harness-bot', 'C로 하라');
    const r = runStart(fx, state);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /- #1 Answered — 제작자 답변 있음/);
    assert.match(r.out, /- #2 Tampered — 답변 대기 \(.*harness-bot.*\)/);
  } finally {
    fx.cleanup();
  }
});
