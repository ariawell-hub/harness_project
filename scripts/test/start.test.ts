// start의 main 동기화 테스트(Issue #4): fastForwardMain 단위 + `harness.ts start` 통합.
// 원격 main은 bare 원격을 별도 clone에서 push해 앞서게 만든다(main 체크아웃을 되돌리지 않는다).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { fastForwardMain } from '../lib/git.ts';
import { initFakeState } from '../lib/github-fake.ts';
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

function runStart(fx: Fixture) {
  const state = path.join(fx.dir, 'gh.json');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
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
