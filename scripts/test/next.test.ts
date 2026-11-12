// runner 새 Issue 후보의 작성자 확인(설계서 4.5절 우선순위 5번, 14.6절)과
// 봇 Issue의 제작자 승인 댓글(`github.botIssues: owner-approved`).
// 가짜 GitHub + 로컬 bare 원격. 실제 gh는 부르지 않는다.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { acceptHint } from '../commands/start.ts';
import { ConfigError, loadConfig, type HarnessConfig } from '../lib/config.ts';
import { getGitHub, toIssue, type Comment, type GitHubPort, type Issue } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState } from '../lib/github-fake.ts';
import {
  BOT_ISSUE_ACCEPT,
  filterTrustedIssues,
  ownerAccepted,
  pickNext,
  sameLogin,
  type Pick,
} from '../runner/next.ts';
import { fixtureConfig, makeFixture, tmp } from './helpers.ts';

const GITHUB = {
  remote: 'origin',
  defaultBranch: 'main',
  owner: 'maker',
  bot: 'harness-bot',
  priorityLabels: ['priority:high'],
  needsHumanLabel: 'needs-human',
};

/** 봇 Issue 승인 경로를 켠 설정 */
const APPROVED = { botIssues: 'owner-approved' };
const WAITING_REASON = '봇 계정이 만든 Issue: 제작자 계정의 `/harness accept` 댓글 대기';

/** 가짜 GitHub 상태를 만들고 `fill`로 Issue를 넣은 뒤 pickNext 결과를 돌려준다 */
function pickWith(
  fill: (state: string) => void,
  github: Record<string, unknown> = {},
  makeGh?: (state: string) => GitHubPort,
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
      gh: makeGh ? makeGh(state) : getGitHub(fx.root),
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

const said = (author: string, body: string): Comment => ({ author, body, createdAt: '' });

/** 불린 Issue 번호를 기록하는 댓글 조회 함수 */
function countingComments(byIssue: Record<number, Comment[]> = {}): {
  fn: (n: number) => Comment[];
  calls: number[];
} {
  const calls: number[] = [];
  return {
    fn: (n) => {
      calls.push(n);
      return byIssue[n] ?? [];
    },
    calls,
  };
}

/** 지정한 Issue의 댓글 조회만 실패하는 가짜 GitHub */
class FlakyCommentsGitHub extends FakeGitHub {
  private failOn: number;
  constructor(file: string, failOn: number) {
    super(file);
    this.failOn = failOn;
  }
  comments(n: number): Comment[] {
    if (n === this.failOn) throw new Error(`gh api 502 (#${n})\n상세 로그`);
    return super.comments(n);
  }
}

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
    () => [],
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
  const r = filterTrustedIssues(
    [issue(1, 'maker'), issue(2, '')],
    cfgWith({ owner: '' }),
    () => [],
  );
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

// ---- step1: 봇 Issue의 제작자 승인(github.botIssues) ----

test('loadConfig: github.botIssues는 없으면 exclude이고, exclude | owner-approved가 아니면 ConfigError다', () => {
  const dir = tmp('harness-next-cfg-');
  const put = (github: Record<string, unknown>) =>
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify(fixtureConfig({ github: { ...GITHUB, ...github } })),
    );
  put({});
  assert.equal(loadConfig(dir).github.botIssues, 'exclude');
  put({ botIssues: 'exclude' });
  assert.equal(loadConfig(dir).github.botIssues, 'exclude');
  put({ botIssues: 'owner-approved' });
  assert.equal(loadConfig(dir).github.botIssues, 'owner-approved');
  for (const bad of ['Owner-Approved', 'include', '', null, true, ['exclude']]) {
    put({ botIssues: bad });
    assert.throws(
      () => loadConfig(dir),
      (e: unknown) =>
        e instanceof ConfigError && /github\.botIssues는 exclude \| owner-approved/.test(e.message),
      `botIssues=${JSON.stringify(bad)}`,
    );
  }
});

test('ownerAccepted: 제작자 계정 댓글에서 앞뒤 공백을 뺀 한 줄이 정확히 /harness accept일 때만 인정한다', () => {
  assert.equal(BOT_ISSUE_ACCEPT, '/harness accept');
  const ok = (body: string, author = 'maker') => ownerAccepted([said(author, body)], 'maker');
  // 인정
  assert.equal(ok('/harness accept'), true);
  assert.equal(ok('  /harness accept\t'), true);
  assert.equal(ok('확인했다.\r\n/harness accept\r\n'), true, 'CRLF 여러 줄 가운데 한 줄');
  assert.equal(ok('/harness accept', 'Maker'), true, '대소문자만 다른 제작자 계정');
  assert.equal(ok('```sh\nnode x\n```\n/harness accept'), true, '닫힌 펜스 뒤의 줄');
  assert.equal(
    ownerAccepted([said('harness-bot', '진행할까요?'), said('maker', '/harness accept')], 'maker'),
    true,
    '어느 댓글이든',
  );
  // 불인정: 다른 계정
  assert.equal(ok('/harness accept', 'harness-bot'), false, '봇');
  assert.equal(ok('/harness accept', 'contractor'), false, '외주 개발자');
  assert.equal(ok('/harness accept', ''), false, '작성자 불명');
  assert.equal(ownerAccepted([said('maker', '/harness accept')], ''), false, '제작자 미설정');
  assert.equal(ownerAccepted([], 'maker'), false);
  // 불인정: 인용, 문장 속 언급, 인라인 코드, 다른 표기
  assert.equal(ok('> /harness accept'), false, '인용');
  assert.equal(ok('>/harness accept'), false, '인용(공백 없음)');
  assert.equal(ok('승인하려면 /harness accept 해 주세요'), false, '문장 속 언급');
  assert.equal(ok('/harness accept 해 주세요'), false, '줄 앞부분만 일치');
  assert.equal(ok('`/harness accept`'), false, '인라인 코드');
  assert.equal(ok('/harness accepted'), false);
  assert.equal(ok('/Harness Accept'), false, '명령은 정확히 일치해야 한다');
  assert.equal(ok('/harness  accept'), false);
  // 불인정: 코드 블록 안
  assert.equal(ok('```\n/harness accept\n```'), false, '백틱 펜스');
  assert.equal(ok('~~~text\n/harness accept\n~~~'), false, '물결 펜스');
  assert.equal(ok('```\n/harness accept'), false, '닫히지 않은 펜스');
  assert.equal(ok('````\n```\n/harness accept\n````'), false, '짧은 펜스는 긴 펜스를 닫지 않는다');
  assert.equal(ok('```\n~~~\n/harness accept\n```'), false, '다른 문자의 펜스는 닫지 않는다');
  assert.equal(
    ok('```\n``` x\n/harness accept\n```'),
    false,
    '정보 문자열이 붙은 줄은 닫는 펜스가 아니다',
  );
  assert.equal(
    ok('```\n    ```\n/harness accept\n```'),
    false,
    '4칸 들여 쓴 ```은 닫는 펜스가 아니다',
  );
});

test('filterTrustedIssues: botIssues가 exclude(기본값)면 제작자 승인 댓글이 있어도 봇 Issue를 빼고 댓글을 조회하지 않는다', () => {
  for (const github of [{}, { botIssues: 'exclude' }]) {
    const c = countingComments({ 1: [said('maker', '/harness accept')] });
    const r = filterTrustedIssues(
      [issue(1, 'harness-bot'), issue(2, 'maker')],
      cfgWith(github),
      c.fn,
    );
    assert.deepEqual(
      r.trusted.map((i) => i.number),
      [2],
    );
    assert.deepEqual(
      r.excluded.map((e) => e.number),
      [1],
    );
    assert.equal(r.excluded[0].reason, '봇 계정이 만든 Issue');
    assert.equal(c.calls.length, 0, `댓글 조회 0회 (${JSON.stringify(github)})`);
  }
});

test('filterTrustedIssues: owner-approved면 봇 Issue에만 댓글을 조회하고, 제작자 승인이 있는 것만 통과한다', () => {
  const accept = [said('maker', '/harness accept')];
  const c = countingComments({
    1: accept,
    2: [said('harness-bot', '/harness accept')],
    3: accept,
    4: accept,
    5: accept,
  });
  const r = filterTrustedIssues(
    [
      issue(1, 'harness-bot'),
      issue(2, 'Harness-Bot'),
      issue(3, 'stranger'),
      issue(4, ''),
      issue(5, 'maker'),
    ],
    cfgWith(APPROVED),
    c.fn,
  );
  assert.deepEqual(
    r.trusted.map((i) => i.number),
    [1, 5],
  );
  assert.deepEqual(
    r.excluded.map((e) => e.number),
    [2, 3, 4],
  );
  const by = new Map(r.excluded.map((e) => [e.number, e]));
  assert.equal(by.get(2)!.reason, WAITING_REASON);
  assert.match(by.get(3)!.reason, /허용 계정\(github\.owner·github\.collaborators\)이 아닌 작성자/);
  assert.match(by.get(4)!.reason, /작성자 불명/);
  assert.deepEqual(c.calls, [1, 2], '봇이 아닌 계정의 Issue에는 승인 경로가 없다');
});

test('filterTrustedIssues: owner-approved여도 github.owner가 비면 모두 빼고 댓글을 조회하지 않는다', () => {
  const c = countingComments({ 1: [said('', '/harness accept')] });
  const r = filterTrustedIssues(
    [issue(1, 'harness-bot'), issue(2, 'maker')],
    cfgWith({ ...APPROVED, owner: '' }),
    c.fn,
  );
  assert.deepEqual(r.trusted, []);
  assert.equal(r.excluded.length, 2);
  for (const e of r.excluded) assert.match(e.reason, /github\.owner가 비어 있다/);
  assert.equal(c.calls.length, 0);
});

test('filterTrustedIssues: 댓글 조회가 실패하면 그 봇 Issue만 빼고(메시지 첫 줄) 나머지는 계속 거른다', () => {
  const fn = (n: number): Comment[] => {
    if (n === 1) throw new Error('gh api 502\n상세 로그');
    return [said('maker', '/harness accept')];
  };
  const r = filterTrustedIssues(
    [issue(1, 'harness-bot'), issue(2, 'harness-bot')],
    cfgWith(APPROVED),
    fn,
  );
  assert.deepEqual(
    r.trusted.map((i) => i.number),
    [2],
  );
  assert.deepEqual(r.excluded, [
    { number: 1, title: 'Issue 1', author: 'harness-bot', reason: '댓글 조회 실패: gh api 502' },
  ]);
});

test('pickNext: botIssues 기본값(exclude)이면 제작자 /harness accept 댓글이 있어도 봇 Issue를 고르지 않는다', () => {
  const { pick } = pickWith((s) => {
    const n = addFakeIssue(s, 'Bot feature', 'x', [], 'harness-bot');
    new FakeGitHub(s).ownerComment(n, '/harness accept');
  });
  assert.equal(pick.task.kind, 'idle');
  assert.equal(pick.excluded.length, 1);
  assert.equal(pick.excluded[0].reason, '봇 계정이 만든 Issue');
});

test('pickNext: owner-approved면 제작자 /harness accept 댓글이 있는 봇 Issue를 new-issue로 고른다', () => {
  const { pick } = pickWith((s) => {
    const n = addFakeIssue(s, 'Bot feature', 'x', [], 'harness-bot');
    new FakeGitHub(s).ownerComment(n, '좋다.\n/harness accept');
  }, APPROVED);
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 1);
  assert.deepEqual(pick.excluded, []);
});

test('pickNext: owner-approved여도 승인 댓글이 없으면 idle이고, 제외 사유가 /harness accept를 안내한다', () => {
  const { pick } = pickWith((s) => {
    addFakeIssue(s, 'Bot feature', 'x', [], 'harness-bot');
  }, APPROVED);
  assert.equal(pick.task.kind, 'idle');
  assert.equal(pick.excluded.length, 1);
  assert.equal(pick.excluded[0].reason, WAITING_REASON);
  assert.match(pick.excluded[0].reason, /\/harness accept/);
  assert.match(pick.reason, /작성자 확인으로 제외: #1\b/);
  assert.deepEqual(pick.waiting, { ci: 0, human: 0 }, 'runner 정지 조건은 그대로다');
});

test('pickNext: owner-approved여도 봇 자신이나 외주 개발자가 쓴 /harness accept는 인정하지 않는다', () => {
  const { pick } = pickWith(
    (s) => {
      const a = addFakeIssue(s, 'Bot self-approved', 'x', [], 'harness-bot');
      const b = addFakeIssue(s, 'Contractor-approved', 'y', [], 'harness-bot');
      const gh = new FakeGitHub(s);
      gh.comment(a, '/harness accept'); // 상태의 me = 봇
      gh.commentAs(b, 'contractor', '/harness accept');
    },
    { ...APPROVED, collaborators: ['contractor'] },
  );
  assert.equal(pick.task.kind, 'idle');
  assert.deepEqual(
    pick.excluded.map((e) => [e.number, e.reason]),
    [
      [1, WAITING_REASON],
      [2, WAITING_REASON],
    ],
  );
});

test('pickNext: owner-approved여도 인용·문장 속 언급·코드 블록 안의 /harness accept는 인정하지 않는다', () => {
  const { pick } = pickWith((s) => {
    const gh = new FakeGitHub(s);
    for (const body of [
      '> /harness accept',
      '승인하려면 /harness accept 라고 댓글을 달아 주세요',
      '예시:\n```\n/harness accept\n```',
    ]) {
      const n = addFakeIssue(s, `Bot ${body.length}`, 'x', [], 'harness-bot');
      gh.ownerComment(n, body);
    }
  }, APPROVED);
  assert.equal(pick.task.kind, 'idle');
  assert.deepEqual(
    pick.excluded.map((e) => e.number),
    [1, 2, 3],
  );
  for (const e of pick.excluded) assert.equal(e.reason, WAITING_REASON);
});

test('pickNext: owner-approved면 대소문자만 다른 제작자 계정의 승인도 인정한다', () => {
  const { pick } = pickWith((s) => {
    const n = addFakeIssue(s, 'Bot feature', 'x', [], 'Harness-Bot');
    new FakeGitHub(s).commentAs(n, 'MAKER', '/harness accept');
  }, APPROVED);
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 1);
});

test('pickNext: owner-approved여도 봇이 아닌 계정의 Issue는 제작자 승인 댓글이 있어도 제외한다', () => {
  const { pick } = pickWith((s) => {
    const gh = new FakeGitHub(s);
    const a = addFakeIssue(s, 'Stranger feature', 'x', [], 'stranger');
    const b = addFakeIssue(s, 'Ghost feature', 'y', [], '');
    gh.ownerComment(a, '/harness accept');
    gh.ownerComment(b, '/harness accept');
  }, APPROVED);
  assert.equal(pick.task.kind, 'idle');
  assert.deepEqual(
    pick.excluded.map((e) => e.number),
    [1, 2],
  );
  for (const e of pick.excluded) assert.notEqual(e.reason, WAITING_REASON);
});

test('pickNext: owner-approved에서 댓글 조회가 실패한 봇 Issue만 빼고 다른 후보를 고른다', () => {
  const { pick } = pickWith(
    (s) => {
      addFakeIssue(s, 'Bot flaky', 'x', ['priority:high'], 'harness-bot'); // #1: 조회 실패
      const ok = addFakeIssue(s, 'Bot approved', 'y', [], 'harness-bot');
      new FakeGitHub(s).ownerComment(ok, '/harness accept');
    },
    APPROVED,
    (s) => new FlakyCommentsGitHub(s, 1),
  );
  assert.equal(pick.task.kind, 'new-issue');
  assert.equal(pickedNumber(pick), 2);
  assert.deepEqual(
    pick.excluded.map((e) => [e.number, e.reason]),
    [[1, '댓글 조회 실패: gh api 502 (#1)']],
  );
});

test('acceptHint(start): owner-approved에서 승인 대기 봇 Issue가 있을 때만 /harness accept 안내 한 줄을 낸다', () => {
  const waiting = {
    number: 7,
    title: 'Bot feature',
    author: 'harness-bot',
    reason: WAITING_REASON,
  };
  const other = { ...waiting, number: 8, author: 'stranger', reason: '작성자 불명' };
  const hint = acceptHint(cfgWith(APPROVED), [other, waiting]);
  assert.ok(hint);
  assert.match(hint, /\/harness accept/);
  assert.match(hint, /#7/);
  assert.doesNotMatch(hint, /#8/);
  assert.match(hint, /maker/, '제작자 계정을 알려 준다');
  assert.equal(hint.includes('\n'), false, '한 줄');
  assert.equal(acceptHint(cfgWith(APPROVED), [other]), null);
  assert.equal(acceptHint(cfgWith(APPROVED), []), null);
  // exclude면 안내하지 않는다(사유가 같아도)
  assert.equal(acceptHint(cfgWith({ botIssues: 'exclude' }), [waiting]), null);
  assert.equal(acceptHint(cfgWith(), [waiting]), null);
});
