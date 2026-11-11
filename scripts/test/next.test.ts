// runner 새 Issue 후보의 작성자 확인(설계서 4.5절 우선순위 5번, 14.6절).
// 가짜 GitHub + 로컬 bare 원격. 실제 gh는 부르지 않는다.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig, type HarnessConfig } from '../lib/config.ts';
import { getGitHub, toIssue, type Issue } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState } from '../lib/github-fake.ts';
import { filterTrustedIssues, pickNext, sameLogin, type Pick } from '../runner/next.ts';
import { fixtureConfig, makeFixture, tmp } from './helpers.ts';

const GITHUB = {
  remote: 'origin',
  defaultBranch: 'main',
  owner: 'maker',
  bot: 'harness-bot',
  priorityLabels: ['priority:high'],
  needsHumanLabel: 'needs-human',
};

/** 가짜 GitHub 상태를 만들고 `fill`로 Issue를 넣은 뒤 pickNext 결과를 돌려준다 */
function pickWith(
  fill: (state: string) => void,
  github: Record<string, unknown> = {},
): { pick: Pick } {
  const fx = makeFixture({ github: { ...GITHUB, ...github } });
  const prev = process.env.HARNESS_FAKE_GH;
  try {
    const state = path.join(fx.dir, 'gh.json');
    initFakeState(state, { remote: fx.remote, owner: 'maker' });
    fill(state);
    process.env.HARNESS_FAKE_GH = state;
    const pick = pickNext({
      main: fx.root,
      cfg: loadConfig(fx.root),
      gh: getGitHub(fx.root),
      worker: 'runner-1',
    });
    return { pick };
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_GH;
    else process.env.HARNESS_FAKE_GH = prev;
    fx.cleanup();
  }
}

function pickedNumber(p: Pick): number | null {
  return p.task.kind === 'new-issue' ? p.task.issue.number : null;
}

function cfgWith(github: Record<string, unknown> = {}): HarnessConfig {
  const c = fixtureConfig({ github: { ...GITHUB, collaborators: [], ...github } });
  return c as unknown as HarnessConfig;
}

const issue = (number: number, author: string, labels: string[] = []): Issue => ({
  number,
  title: `Issue ${number}`,
  body: '',
  labels,
  state: 'open',
  createdAt: '',
  author,
});

test('가짜 GitHub: addFakeIssue는 작성자를 생략하면 제작자(owner)로 두고, 옛 상태는 빈 작성자다', () => {
  const dir = tmp('harness-next-fake-');
  const state = path.join(dir, 'gh.json');
  initFakeState(state, { remote: dir, owner: 'maker' });
  const a = addFakeIssue(state, 'A', 'a');
  const b = addFakeIssue(state, 'B', 'b', [], 'harness-bot');
  const gh = new FakeGitHub(state);
  assert.equal(gh.getIssue(a).author, 'maker');
  assert.equal(gh.getIssue(b).author, 'harness-bot');
  assert.deepEqual(
    gh.listOpenIssues().map((i) => [i.number, i.author]),
    [
      [a, 'maker'],
      [b, 'harness-bot'],
    ],
  );
  // 작성자 필드가 없는 옛 상태 파일
  writeFileSync(
    state,
    JSON.stringify({
      me: 'harness-bot',
      owner: 'maker',
      remote: dir,
      mergeMode: 'manual',
      next: 2,
      issues: [
        {
          number: 1,
          title: 'old',
          body: '',
          labels: [],
          state: 'open',
          createdAt: '',
          comments: [],
        },
      ],
      prs: [],
    }),
  );
  assert.equal(gh.listOpenIssues()[0].author, '');
  assert.equal(gh.getIssue(1).author, '');
});

test('pickNext: 제작자가 만든 Issue는 새 후보다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Owner feature', 'x');
  });
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 1);
  assert.deepEqual(pick.excluded, []);
});

test('pickNext: github.collaborators 계정이 만든 Issue는 새 후보다', () => {
  const { pick } = pickWith(
    (s) => {
      addFakeIssue(s, 'Contractor feature', 'x', [], 'contractor');
    },
    { collaborators: ['contractor'] },
  );
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 1);
});

test('pickNext: 봇이 만든 Issue만 있으면 idle이고, 제외 목록과 이유에 번호가 나온다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Bot feature', 'x', [], 'harness-bot');
  });
  assert.equal(pick.task.kind, 'idle');
  assert.equal(pick.excluded.length, 1);
  assert.equal(pick.excluded[0].number, 1);
  assert.equal(pick.excluded[0].author, 'harness-bot');
  assert.equal(pick.excluded[0].title, 'Bot feature');
  assert.match(pick.excluded[0].reason, /봇 계정이 만든 Issue/);
  assert.match(pick.reason, /작성자 확인으로 제외: #1\b/);
  assert.deepEqual(pick.waiting, { ci: 0, human: 0 }, 'runner 정지 조건은 그대로다');
});

test('pickNext: 우선순위가 높은 봇 Issue를 건너뛰고 제작자 Issue를 고른다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Bot urgent', 'x', ['priority:high'], 'harness-bot');
    addFakeIssue(s, 'Owner plain', 'y');
  });
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 2);
  assert.deepEqual(
    pick.excluded.map((e) => e.number),
    [1],
  );
});

test('pickNext: 대소문자만 다른 제작자 계정의 Issue도 후보다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Owner mixed case', 'x', [], 'Maker');
  });
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 1);
});

test('pickNext: github.owner가 비면 작성자와 관계없이 idle이다(fail-closed)', () => {
  const { pick } = pickWith(
    (s) => {
      addFakeIssue(s, 'Owner feature', 'x');
      addFakeIssue(s, 'Empty author', 'y', [], '');
    },
    { owner: '' },
  );
  assert.equal(pick.task.kind, 'idle');
  assert.deepEqual(
    pick.excluded.map((e) => e.number),
    [1, 2],
  );
  for (const e of pick.excluded) assert.match(e.reason, /github\.owner가 비어 있다/);
  assert.match(pick.reason, /#1, #2/);
});

test('pickNext: needs-human 같은 앞 조건으로 빠진 Issue는 제외 목록에 넣지 않는다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Waiting', 'x', ['needs-human'], 'harness-bot');
  });
  assert.equal(pick.task.kind, 'idle');
  assert.deepEqual(pick.excluded, []);
  assert.doesNotMatch(pick.reason, /작성자 확인/);
});

test('filterTrustedIssues: 허용 계정만 통과하고, 사유를 붙이며 입력 순서를 지킨다', () => {
  const cfg = cfgWith({ collaborators: ['Contractor'] });
  const r = filterTrustedIssues(
    [
      issue(3, 'stranger'),
      issue(1, 'maker'),
      issue(5, ''),
      issue(2, 'contractor'),
      issue(4, 'Harness-Bot'),
    ],
    cfg,
  );
  assert.deepEqual(
    r.trusted.map((i) => i.number),
    [1, 2],
  );
  assert.deepEqual(
    r.excluded.map((e) => e.number),
    [3, 5, 4],
  );
  const by = new Map(r.excluded.map((e) => [e.number, e]));
  assert.match(by.get(3)!.reason, /허용 계정\(github\.owner·github\.collaborators\)이 아닌 작성자/);
  assert.match(by.get(5)!.reason, /작성자 불명/);
  assert.match(by.get(4)!.reason, /봇 계정이 만든 Issue/);
  assert.equal(by.get(3)!.author, 'stranger');
  assert.equal(by.get(3)!.title, 'Issue 3');
});

test('filterTrustedIssues: github.owner가 비면 모두 제외한다', () => {
  const r = filterTrustedIssues([issue(1, 'maker'), issue(2, '')], cfgWith({ owner: '' }));
  assert.deepEqual(r.trusted, []);
  assert.equal(r.excluded.length, 2);
  for (const e of r.excluded) assert.match(e.reason, /github\.owner가 비어 있다/);
});

test('sameLogin: 대소문자를 무시하고 빈 문자열은 어떤 계정과도 같지 않다', () => {
  assert.equal(sameLogin('Maker', 'maker'), true);
  assert.equal(sameLogin('maker', 'maker2'), false);
  assert.equal(sameLogin('', ''), false);
  assert.equal(sameLogin('', 'maker'), false);
  assert.equal(sameLogin('maker', ''), false);
});

test('toIssue: 작성자 login을 꺼내고, 삭제된 계정(null)이나 누락은 빈 문자열이다', () => {
  const base = {
    number: 9,
    title: 't',
    body: null,
    labels: [{ name: 'priority:high' }],
    state: 'OPEN',
    createdAt: '2026-11-11T00:00:00Z',
  };
  assert.deepEqual(toIssue({ ...base, author: { login: 'x' } }), {
    number: 9,
    title: 't',
    body: '',
    labels: ['priority:high'],
    state: 'open',
    createdAt: '2026-11-11T00:00:00Z',
    author: 'x',
  });
  assert.equal(toIssue({ ...base, author: null }).author, '');
  assert.equal(toIssue(base).author, '');
  assert.equal(toIssue({ ...base, state: 'CLOSED' }).state, 'closed');
});

test('loadConfig: github.collaborators는 없으면 []이고, 문자열 배열이 아니면 ConfigError다', () => {
  const dir = tmp('harness-next-cfg-');
  const put = (github: Record<string, unknown>) =>
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify(fixtureConfig({ github: { ...GITHUB, ...github } })),
    );
  put({});
  assert.deepEqual(loadConfig(dir).github.collaborators, []);
  put({ collaborators: ['contractor'] });
  assert.deepEqual(loadConfig(dir).github.collaborators, ['contractor']);
  for (const bad of ['contractor', [1], ['ok', null], { a: 'b' }]) {
    put({ collaborators: bad });
    assert.throws(
      () => loadConfig(dir),
      (e: unknown) =>
        e instanceof ConfigError &&
        /github\.collaborators는 계정 이름 문자열 배열이어야 한다/.test(e.message),
    );
  }
});
