// 제작자 승인의 연결: 게시 시각 채우기, 편집 이력 읽기, 기록 job·plan job의 원장 반영. 계획 20261120-p0-maker-approval step1.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  listAcceptComments,
  loadAccepted,
  readRoundLedger,
  type Graphql,
} from '../ci/accept-load.ts';
import { emptyLedger, parseLedger, renderLedger, type Entry, type Ledger } from '../ci/ledger.ts';
import {
  ledgerFromComments,
  recordCiFailure,
  recordLedger,
  type IssueComment,
  type LedgerApi,
} from '../ci/ledger-store.ts';
import type { AcceptComment } from '../ci/owner-accept.ts';
import { githubGraphql } from '../ci/pr.ts';
import type { StatusPayload } from '../ci/results.ts';
import type { Finding, Resolution, Verdict } from '../ci/verdict.ts';

const BOT = 'harness-recorder[bot]';
const OWNER = 'maker';
const BASE = 'a'.repeat(40);
const H1 = '1'.repeat(40);
const SECRET = 'SECRET-COMMENT-TEXT';
const at = (sec: number) => `2026-11-20T01:00:${String(sec).padStart(2, '0')}Z`;

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'F1',
  severity: 'P0',
  reviewer: 'codex',
  file: 'src/a.ts',
  line: 3,
  title: '남은 틈',
  repro: '',
  status: 'open',
  note: '',
  round: 1,
  rejectedBy: [],
  ...over,
});
const ledgerOf = (...findings: Entry[]): Ledger => ({
  ...emptyLedger(BASE),
  rounds: [{ reviewer: 'codex', head: H1 }],
  findings,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'P0',
  file: 'src/b.ts',
  line: 9,
  title: '다른 틈',
  evidence: '근거',
  suggestion: '제안',
  repro: { path: '', content: '' },
  ...over,
});
const verdict = (findings: Finding[] = [], resolutions: Resolution[] = []): Verdict => ({
  verdict: findings.length ? 'request_changes' : 'approve',
  risk: 'normal',
  summary: '요약',
  findings,
  resolutions,
});
/** GraphQL이 주는 댓글. 번호는 fullDatabaseId(BigInt라 문자열)로 온다. 실제 댓글 번호는 32비트를 넘는다 */
type Node = Omit<AcceptComment, 'databaseId'> & { fullDatabaseId?: unknown; databaseId?: unknown };
const CID = 7_000_000_000;
/** 고쳐지지 않은 제작자의 승인 댓글(GraphQL 꼴) */
const accept = (id: string, sec: number, over: Partial<Node> = {}): Node => ({
  fullDatabaseId: String(CID + sec),
  author: { login: OWNER },
  body: `/harness accept ${id}`,
  createdAt: at(sec),
  lastEditedAt: null,
  editor: null,
  userContentEdits: { totalCount: 0 },
  ...over,
});

interface Rest extends IssueComment {
  id: number;
  user: { login: string };
  body: string;
  updated_at?: string;
}
/** 가짜 GitHub: REST 댓글, GraphQL 댓글(편집 이력), 저장 시각을 정하는 시계 */
function world(init: { ledger?: Ledger; ledgerAt?: string; gql?: Node[] } = {}) {
  const w = {
    rest: [] as Rest[],
    gql: [...(init.gql ?? [])],
    /** 다음 저장에 GitHub이 적을 시각 */
    now: at(0),
    gqlCalls: 0,
    sends: 0,
    gqlFail: null as Error | null,
    statuses: [] as StatusPayload[],
    api: null as unknown as LedgerApi,
    graphql: null as unknown as Graphql,
    stored: (): Ledger => {
      const c = w.rest.find((x) => x.user.login === BOT);
      const l = c && parseLedger(c.body);
      assert.ok(l, '저장된 원장이 없다');
      return l;
    },
    status: () => w.statuses.at(-1),
  };
  if (init.ledger)
    w.rest.push({
      id: 500,
      user: { login: BOT },
      body: renderLedger(init.ledger),
      updated_at: init.ledgerAt,
    });
  w.graphql = async (_q, v) => {
    w.gqlCalls++;
    if (w.gqlFail) throw w.gqlFail;
    const start = v.after ? Number(v.after) : 0;
    const nodes = w.gql.slice(start, start + 100);
    const more = start + 100 < w.gql.length;
    return {
      repository: {
        pullRequest: {
          comments: {
            pageInfo: { hasNextPage: more, endCursor: more ? String(start + 100) : null },
            nodes,
          },
        },
      },
    };
  };
  w.api = {
    get: async (p) => {
      const m = /^repos\/o\/r\/issues\/7\/comments\?per_page=100&page=(\d+)$/.exec(p);
      if (m) return w.rest.slice((Number(m[1]) - 1) * 100, Number(m[1]) * 100);
      if (p === 'repos/o/r/pulls/7') return { user: { login: 'writer-bot' } };
      throw new Error(`모르는 경로: ${p}`);
    },
    send: async (method, p, body) => {
      w.sends++;
      const text = (body as { body: string }).body;
      if (method === 'POST' && p === 'repos/o/r/issues/7/comments') {
        w.rest.push({ id: 500, user: { login: BOT }, body: text, updated_at: w.now });
        return {};
      }
      const m = /^repos\/o\/r\/issues\/comments\/(\d+)$/.exec(p);
      const c = m && w.rest.find((x) => x.id === Number(m[1]));
      if (method !== 'PATCH' || !c) throw new Error(`모르는 요청: ${method} ${p}`);
      c.body = text;
      c.updated_at = w.now;
      return {};
    },
    graphql: (q, v) => w.graphql(q, v),
  };
  return w;
}
type World = ReturnType<typeof world>;
/** 기록 job 한 번. 저장되면 그 시각은 `sec`다 */
async function record(
  w: World,
  sec: number,
  o: {
    verdict?: Verdict | null;
    reviewer?: 'claude' | 'codex';
    owner?: string;
    planOnly?: boolean;
  } = {},
) {
  w.now = at(sec);
  return recordLedger({
    reviewer: o.reviewer ?? 'claude',
    verdict: o.verdict ?? null,
    headSha: H1,
    promptBase: BASE,
    changedSinceLastRound: ['src/b.ts'],
    planOnly: o.planOnly ?? false,
    repo: 'o/r',
    number: 7,
    recorderBot: BOT,
    owner: o.owner ?? OWNER,
    api: w.api,
    post: async (p) => void w.statuses.push(p),
  });
}
const where = { repo: 'o/r', number: 7 };
/** readRoundLedger의 인자: 코드가 섞인 head */
const round = { ...where, planOnly: false };

test('ledgerFromComments: openedAt이 없는 열린 지적에만 원장 댓글의 저장 시각을 채운다', () => {
  const l = ledgerOf(
    entry(),
    entry({ id: 'F2', severity: 'P1', title: 'b' }),
    entry({ id: 'F3', title: 'c', openedAt: at(1) }),
    entry({ id: 'F4', title: 'd', status: 'fixed' }),
    entry({ id: 'F5', title: 'e', severity: 'P2', status: 'deferred' }),
    entry({ id: 'F6', title: 'f', status: 'accepted', openedAt: at(1) }),
  );
  const comment = { id: 500, user: { login: BOT }, body: renderLedger(l), updated_at: at(9) };
  const got = ledgerFromComments([comment], BOT).ledger;
  assert.deepEqual(
    got?.findings.map((e) => [e.id, e.openedAt]),
    [
      ['F1', at(9)],
      ['F2', at(9)],
      ['F3', at(1)],
      ['F4', undefined],
      ['F5', undefined],
      ['F6', at(1)],
    ],
  );
  // 저장 시각을 읽을 수 없으면 채우지 않는다
  for (const updated_at of [undefined, '', '어제', 1763600000, `${at(9)}${' '.repeat(40)}`]) {
    const none = ledgerFromComments([{ ...comment, updated_at }], BOT).ledger;
    assert.deepEqual(none, l, JSON.stringify(updated_at));
  }
});

test('F3: 지적이 게시되기 전이나 같은 시각에 단 댓글은 그 지적을 닫지 못하고, 게시 뒤의 댓글은 다음 실행에서 닫는다', async () => {
  for (const [sec, want] of [
    [4, 'open'],
    [5, 'open'],
    [6, 'accepted'],
  ] as const) {
    // 아직 원장에 없는 F1을 미리(또는 뒤에) 승인한 댓글
    const w = world({ gql: [accept('F1', sec)] });
    // 실행 1: 판정이 P0 F1을 등록하고 원장을 at(5)에 게시한다. 이 실행에서는 닫히지 않는다
    await record(w, 5, { reviewer: 'codex', verdict: verdict([finding()]) });
    assert.deepEqual(
      w.stored().findings.map((e) => [e.id, e.status, e.openedAt]),
      [['F1', 'open', undefined]],
    );
    assert.equal(w.status()?.state, 'failure');
    // 실행 2: 게시 시각(at(5))이 채워지고 그보다 엄격히 뒤의 댓글만 인정된다
    await record(w, 20);
    const e = w.stored().findings[0];
    assert.equal(e.status, want, `댓글 ${sec}초`);
    assert.equal(e.openedAt, at(5));
    assert.equal(w.status()?.state, want === 'accepted' ? 'success' : 'failure');
  }
});

test('F3: 같은 실행의 판정으로 새로 등록된 P0은 뒤 시각의 댓글이 있어도 그 실행에서 닫히지 않는다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F2', 50)],
  });
  await record(w, 10, { reviewer: 'codex', verdict: verdict([finding()]) });
  assert.deepEqual(
    w.stored().findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'open'],
      ['F2', 'open'],
    ],
  );
  assert.equal(w.gqlCalls, 1);
});

test('F5: 한 번 채워진 게시 시각은 뒤의 원장 수정으로 늦춰지지 않는다', async () => {
  for (const acceptSec of [25, 15]) {
    // at(10): 지적이 openedAt 없이 게시됐다
    const w = world({ ledger: ledgerOf(entry()), ledgerAt: at(10) });
    if (acceptSec < 20) w.gql.push(accept('F1', acceptSec));
    // at(20): 다른 검증자의 기록 job이 원장을 읽고 저장한다. 게시 시각 at(10)이 채워져 저장된다
    await record(w, 20, { verdict: verdict() });
    assert.equal(w.stored().findings[0].openedAt, at(10));
    // at(25): 제작자의 승인 댓글(둘째 경우는 at(15)에 이미 달렸다)
    if (acceptSec >= 20) w.gql.push(accept('F1', acceptSec));
    // at(30): check 실패 기록이 원장을 다시 저장한다
    w.now = at(30);
    await recordCiFailure({
      ...where,
      recorderBot: BOT,
      api: w.api,
      headSha: H1,
      run: 'https://github.com/o/r/actions/runs/1',
      promptBase: BASE,
    });
    assert.equal(w.stored().ciFailures.length, 1);
    assert.equal(w.stored().findings[0].openedAt, at(10));
    // at(40): 다음 기록에서 반영된다
    await record(w, 40);
    const e = w.stored().findings[0];
    assert.deepEqual(
      [e.status, e.openedAt, e.note],
      ['accepted', at(10), `제작자 승인(댓글 ${CID + acceptSec})`],
    );
    assert.equal(w.status()?.state, 'success');
    assert.match(w.status()?.description ?? '', /제작자 승인 1/);
  }
});

test('F5: check 실패 기록만 사이에 끼어도 게시 시각이 그때 채워져 저장된다', async () => {
  const w = world({ ledger: ledgerOf(entry()), ledgerAt: at(10) });
  w.gql.push(accept('F1', 15));
  w.now = at(30);
  await recordCiFailure({
    ...where,
    recorderBot: BOT,
    api: w.api,
    headSha: H1,
    run: 'https://github.com/o/r/actions/runs/1',
    promptBase: BASE,
  });
  assert.equal(w.stored().findings[0].openedAt, at(10));
  // 실패 기록은 승인을 보지 않는다
  assert.equal(w.stored().findings[0].status, 'open');
  assert.equal(w.gqlCalls, 0);
  await record(w, 40);
  assert.equal(w.stored().findings[0].status, 'accepted');
});

test('recordLedger: 판정 없이도 승인을 저장하고, 같은 실행의 판정이 open으로 답해도 accepted다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  const seen: string[] = [];
  w.now = at(10);
  await recordLedger({
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '그대로다' }]),
    headSha: H1,
    promptBase: BASE,
    changedSinceLastRound: [],
    planOnly: false,
    ...where,
    recorderBot: BOT,
    owner: OWNER,
    api: w.api,
    post: async (p) => void w.statuses.push(p),
    onAccepts: (o) =>
      seen.push(`applied=${o.applied.map((a) => `${a.id}:${a.commentId}`)} reopened=${o.reopened}`),
  });
  assert.equal(w.stored().findings[0].status, 'accepted');
  assert.equal(w.status()?.state, 'success');
  assert.deepEqual(seen, ['applied=F1:7000000005 reopened=']);
  assert.equal(w.gqlCalls, 1);
  // 판정 없는 기록(이어받음)에서도 유지되고, 달라진 것이 없으면 다시 저장하지 않는다
  const sends = w.sends;
  await record(w, 20);
  assert.equal(w.stored().findings[0].status, 'accepted');
  assert.equal(w.sends, sends);
});

test('recordLedger: 승인 댓글이 사라지면 open으로 저장되고 review-ledger가 실패한다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  await record(w, 10);
  assert.equal(w.stored().findings[0].status, 'accepted');
  w.gql = [];
  await record(w, 20);
  const e = w.stored().findings[0];
  assert.deepEqual([e.status, e.note], ['open', '제작자 승인이 없어져 다시 열림']);
  assert.deepEqual(w.status(), {
    context: 'review-ledger',
    state: 'failure',
    description: '열린 차단 지적 1건: F1',
  });
});

test('listAcceptComments: 댓글 번호를 fullDatabaseId로 읽는다(32비트 필드 databaseId를 요청하지 않는다)', async () => {
  const w = world({ gql: [accept('F1', 5)] });
  let query = '';
  const graphql: Graphql = (q, v) => {
    query = q;
    return w.graphql(q, v);
  };
  const got = await listAcceptComments({ graphql, ...where });
  assert.equal(got[0].databaseId, 7_000_000_005);
  assert.ok(got[0].databaseId > 2 ** 31);
  assert.match(query, /\bfullDatabaseId\b/);
  assert.doesNotMatch(query, /\bdatabaseId\b/);
});

test('F2(구현 판정): 승인이 철회된 실행의 판정은 그 지적을 닫지 못한다. 다음 판정은 닫을 수 있다', async () => {
  for (const status of ['fixed', 'rejected', 'open'] as const) {
    const w = world({
      ledger: ledgerOf(
        entry({ status: 'accepted', openedAt: at(1), note: '제작자 승인(댓글 7000000005)' }),
      ),
      ledgerAt: at(1),
      // 승인 댓글이 지워졌다
      gql: [],
    });
    const seen: string[] = [];
    w.now = at(10);
    const run = (sec: number) => {
      w.now = at(sec);
      return recordLedger({
        // F1을 낸 검증자가 같은 실행에서 판정을 낸다
        reviewer: 'codex',
        verdict: verdict([], [{ id: 'F1', status, note: '판정' }]),
        headSha: H1,
        promptBase: BASE,
        changedSinceLastRound: [],
        planOnly: false,
        ...where,
        recorderBot: BOT,
        owner: OWNER,
        api: w.api,
        post: async (p) => void w.statuses.push(p),
        onAccepts: (o) => seen.push(`reopened=${o.reopened}`),
      });
    };
    await run(10);
    const e = w.stored().findings[0];
    assert.deepEqual([e.status, e.note], ['open', '제작자 승인이 없어져 다시 열림'], status);
    assert.equal(w.status()?.state, 'failure', status);
    assert.deepEqual(seen, ['reopened=F1'], status);
    // 판정 라운드는 기록된다
    assert.equal(w.stored().rounds.length, 2, status);
    // 다음 판정: 다시 열린 지적을 평소 규칙으로 처리한다
    await run(20);
    const next = w.stored().findings[0];
    assert.equal(next.status, status === 'fixed' ? 'fixed' : 'open', status);
    assert.equal(w.status()?.state, status === 'fixed' ? 'success' : 'failure', status);
  }
});

test('recordLedger: 고쳐진 댓글·다른 계정의 댓글·다른 제작자 설정은 반영되지 않는다', async () => {
  const cases: [string, Node, string][] = [
    // 작성 시각과 수정 시각이 같지만 편집 이력이 있다
    [
      '같은 초의 편집',
      accept('F1', 5, { lastEditedAt: at(5), editor: { login: 'writer-bot' } }),
      OWNER,
    ],
    ['편집 기록 수', accept('F1', 5, { userContentEdits: { totalCount: 2 } }), OWNER],
    ['편집 이력 없음', accept('F1', 5, { userContentEdits: null }), OWNER],
    ['봇 계정', accept('F1', 5, { author: { login: 'writer-bot' } }), OWNER],
    ['검증 App', accept('F1', 5, { author: { login: 'harness-recorder' } }), OWNER],
    ['설명이 붙은 댓글', accept('F1', 5, { body: '받아들인다.\n\n/harness accept F1' }), OWNER],
    ['다른 제작자 설정', accept('F1', 5), 'someone-else'],
    // 댓글 번호를 확인하지 못한 댓글: 32비트 필드(databaseId)만 있거나 번호가 숫자 문자열이 아니다
    ['32비트 번호 필드만', accept('F1', 5, { fullDatabaseId: undefined, databaseId: 905 }), OWNER],
    ['번호가 숫자 문자열이 아님', accept('F1', 5, { fullDatabaseId: '7000000005n' }), OWNER],
    ['번호가 안전한 정수 범위 밖', accept('F1', 5, { fullDatabaseId: '9007199254740993' }), OWNER],
    ['번호가 0', accept('F1', 5, { fullDatabaseId: '0' }), OWNER],
  ];
  for (const [name, comment, owner] of cases) {
    const w = world({
      ledger: ledgerOf(entry({ openedAt: at(1) })),
      ledgerAt: at(1),
      gql: [comment],
    });
    await record(w, 10, { owner });
    assert.equal(w.stored().findings[0].status, 'open', name);
    assert.equal(w.status()?.state, 'failure', name);
  }
});

test('recordLedger: 편집 이력을 읽지 못하면 저장하지 않고 error다. 오류 문구는 밖으로 나가지 않는다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ status: 'accepted', openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  w.gqlFail = new Error(SECRET);
  await record(w, 10, { verdict: verdict() });
  assert.equal(w.sends, 0);
  assert.equal(w.status()?.state, 'error');
  assert.doesNotMatch(JSON.stringify(w.statuses), new RegExp(SECRET));
  assert.match(w.status()?.description ?? '', /^원장 처리 실패: /);
  // 저장된 원장은 그대로다(승인을 유지하지도 풀지도 않는다)
  assert.equal(w.stored().findings[0].status, 'accepted');
  assert.equal(w.stored().rounds.length, 1);
});

test('recordLedger: 볼 지적이 없거나 제작자 설정·GraphQL이 없으면 편집 이력을 읽지 않는다', async () => {
  // 열렸거나 accepted인 P0·P1이 없다(닫힌 P1, 닫힌 P0, 미뤄진 P2뿐이다)
  const none = world({
    ledger: ledgerOf(
      entry({ severity: 'P1', status: 'fixed', openedAt: at(1) }),
      entry({ id: 'F2', status: 'fixed' }),
      entry({ id: 'F3', severity: 'P2', status: 'deferred', title: 'c' }),
    ),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  none.gqlFail = new Error('부르면 안 된다');
  await record(none, 10);
  assert.equal(none.gqlCalls, 0);
  assert.equal(none.status()?.state, 'success');
  assert.deepEqual(
    none.stored().findings.map((e) => e.status),
    ['fixed', 'fixed', 'deferred'],
  );
  // 제작자 설정이 비었다: 승인을 보지 않고, 이미 accepted인 지적도 건드리지 않는다
  const noOwner = world({
    ledger: ledgerOf(entry({ status: 'accepted', openedAt: at(1) })),
    ledgerAt: at(1),
  });
  await record(noOwner, 10, { owner: '' });
  assert.equal(noOwner.gqlCalls, 0);
  assert.equal(noOwner.stored().findings[0].status, 'accepted');
  // GraphQL 함수가 없는 API(옛 호출): 같다
  const noGql = world({ ledger: ledgerOf(entry({ openedAt: at(1) })), ledgerAt: at(1) });
  noGql.gql.push(accept('F1', 5));
  delete noGql.api.graphql;
  await record(noGql, 10);
  assert.equal(noGql.stored().findings[0].status, 'open');
});

test('recordLedger: 원장이 없으면 승인 댓글만으로 댓글을 만들지 않는다', async () => {
  const w = world({ gql: [accept('F1', 5)] });
  await record(w, 10, { verdict: verdict() });
  assert.equal(w.rest.length, 0);
  assert.equal(w.sends, 0);
  assert.equal(w.gqlCalls, 0);
  assert.equal(w.status()?.state, 'success');
});

test('listAcceptComments: 여러 쪽을 끝까지 읽고, 끝을 확인하지 못하거나 응답 꼴이 다르면 예외다', async () => {
  const w = world({ gql: Array.from({ length: 230 }, (_, i) => accept('F1', i % 60)) });
  const all = await listAcceptComments({ graphql: w.graphql, ...where });
  assert.equal(all.length, 230);
  assert.equal(w.gqlCalls, 3);
  // 끝이 나오지 않는다
  let calls = 0;
  const endless: Graphql = async () => {
    calls++;
    return {
      repository: {
        pullRequest: {
          comments: { pageInfo: { hasNextPage: true, endCursor: 'c' }, nodes: [accept('F1', 1)] },
        },
      },
    };
  };
  await assert.rejects(listAcceptComments({ graphql: endless, ...where }), /끝을 확인하지 못했다/);
  assert.equal(calls, 30);
  // 응답 꼴이 다르다
  const shapes: unknown[] = [
    null,
    {},
    { repository: null },
    { repository: { pullRequest: null } },
    { repository: { pullRequest: { comments: { nodes: [] } } } },
    { repository: { pullRequest: { comments: { pageInfo: { hasNextPage: false }, nodes: {} } } } },
    { repository: { pullRequest: { comments: { pageInfo: { hasNextPage: 'no' }, nodes: [] } } } },
    {
      repository: {
        pullRequest: { comments: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } },
      },
    },
  ];
  for (const shape of shapes)
    await assert.rejects(
      listAcceptComments({ graphql: async () => shape, ...where }),
      /응답 형식 오류/,
      JSON.stringify(shape),
    );
  // repo·번호 형식
  await assert.rejects(listAcceptComments({ graphql: w.graphql, repo: 'o', number: 7 }));
  await assert.rejects(listAcceptComments({ graphql: w.graphql, repo: 'o/r', number: 0 }));
});

test('loadAccepted: 볼 지적이 없거나 제작자가 비면 GraphQL을 부르지 않는다', async () => {
  const w = world({ gql: [accept('F1', 5)] });
  for (const quiet of [
    ledgerOf(entry({ severity: 'P1', status: 'fixed', openedAt: at(1) })),
    ledgerOf(entry({ severity: 'P1', status: 'deferred' })),
    ledgerOf(entry({ severity: 'P2', status: 'deferred' })),
  ])
    assert.deepEqual(
      await loadAccepted({ ledger: quiet, owner: OWNER, graphql: w.graphql, ...where }),
      { ledger: quiet, outcome: null, accepts: [] },
    );
  const p0 = ledgerOf(entry({ openedAt: at(1) }));
  const skipped = await loadAccepted({ ledger: p0, owner: '', graphql: w.graphql, ...where });
  assert.equal(skipped.outcome, null);
  assert.equal(w.gqlCalls, 0);
  const got = await loadAccepted({ ledger: p0, owner: OWNER, graphql: w.graphql, ...where });
  assert.equal(w.gqlCalls, 1);
  assert.equal(got.ledger.findings[0].status, 'accepted');
  assert.deepEqual(got.outcome?.applied, [{ id: 'F1', commentId: CID + 5, at: at(5) }]);
  // 입력은 바꾸지 않는다
  assert.equal(p0.findings[0].status, 'open');
});

test('readRoundLedger: plan job이 판정 job에 넘길 원장에 승인이 반영된다', async () => {
  const w = world({
    ledger: ledgerOf(entry(), entry({ id: 'F2', severity: 'P1', title: 'b' })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  const sha = 'c'.repeat(40);
  const rebut = (id: string) => `- 지적: ${id}\n- 근거: ${sha}\n- 요지: 이미 확인한다`;
  w.rest.push(
    { id: 600, user: { login: 'writer-bot' }, body: rebut('F1') },
    { id: 601, user: { login: 'writer-bot' }, body: rebut('F2') },
  );
  const o = { get: w.api.get, graphql: w.graphql, ...round, recorderBot: BOT };
  const r = await readRoundLedger({ ...o, owner: OWNER });
  assert.deepEqual(
    r.ledger?.findings.map((e) => [e.id, e.status, e.openedAt]),
    [
      ['F1', 'accepted', at(1)],
      ['F2', 'open', at(1)],
    ],
  );
  assert.deepEqual(
    r.outcome?.applied.map((a) => a.id),
    ['F1'],
  );
  assert.equal(r.acceptError, null);
  // accepted인 지적은 반박 대상이 아니다
  assert.deepEqual(
    r.rebuttals.map((x) => x.id),
    ['F2'],
  );
  // plan job은 쓰지 않는다
  assert.equal(w.sends, 0);
  // 제작자 설정이 다르면 반영되지 않는다
  const other = await readRoundLedger({ ...o, owner: 'someone-else' });
  assert.equal(other.ledger?.findings[0].status, 'open');
  assert.deepEqual(
    other.rebuttals.map((x) => x.id),
    ['F1', 'F2'],
  );
});

test('readRoundLedger: 편집 이력을 읽지 못하면 저장된 원장을 쓰고 이유를 고정된 문구로 알린다', async () => {
  const w = world({ ledger: ledgerOf(entry()), ledgerAt: at(1), gql: [accept('F1', 5)] });
  w.gqlFail = new Error(SECRET);
  const r = await readRoundLedger({
    get: w.api.get,
    graphql: w.graphql,
    ...round,
    recorderBot: BOT,
    owner: OWNER,
  });
  assert.equal(r.ledger?.findings[0].status, 'open');
  assert.equal(r.ledger?.findings[0].openedAt, at(1));
  assert.equal(r.outcome, null);
  assert.ok(r.acceptError);
  assert.doesNotMatch(r.acceptError, new RegExp(SECRET));
  // 원장이 없으면 승인을 보지 않는다
  const empty = world({ gql: [accept('F1', 5)] });
  const none = await readRoundLedger({
    get: empty.api.get,
    graphql: empty.graphql,
    ...round,
    recorderBot: BOT,
    owner: OWNER,
  });
  assert.deepEqual(none, { ledger: null, rebuttals: [], outcome: null, acceptError: null });
  assert.equal(empty.gqlCalls, 0);
  // 댓글 목록을 읽지 못하면 지금처럼 예외다
  await assert.rejects(
    readRoundLedger({
      get: async () => {
        throw new Error('GitHub 조회 실패: HTTP 403');
      },
      graphql: w.graphql,
      ...round,
      recorderBot: BOT,
      owner: OWNER,
    }),
    /HTTP 403/,
  );
});

test('githubGraphql: 오류 응답의 본문과 문구를 예외에 넣지 않는다', async () => {
  let mode = 'ok';
  const seen: { url: string; auth: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: `${req.method} ${req.url}`, auth: req.headers.authorization ?? '', body });
      const send = (code: number, text: string) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(text);
      };
      if (mode === '500') return send(500, JSON.stringify({ message: SECRET }));
      if (mode === 'errors')
        return send(
          200,
          JSON.stringify({ errors: [{ message: SECRET }], data: { viewer: { body: SECRET } } }),
        );
      if (mode === 'text') return send(200, `<html>${SECRET}</html>`);
      if (mode === 'nodata') return send(200, JSON.stringify({ message: SECRET }));
      send(200, JSON.stringify({ data: { ok: true } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const gql = githubGraphql('read-token', `${url}/`);
    assert.deepEqual(await gql('query { ok }', { n: 7 }), { ok: true });
    assert.deepEqual(seen[0].url, 'POST /graphql');
    assert.equal(seen[0].auth, 'Bearer read-token');
    assert.deepEqual(JSON.parse(seen[0].body), { query: 'query { ok }', variables: { n: 7 } });
    const want: Record<string, RegExp> = {
      '500': /^GraphQL 요청 실패: HTTP 500$/,
      errors: /^GraphQL 응답에 오류가 있다\(1건\)$/,
      text: /^GraphQL 응답 형식 오류$/,
      nodata: /^GraphQL 응답 형식 오류$/,
    };
    for (const [m, re] of Object.entries(want)) {
      mode = m;
      await assert.rejects(gql('query { ok }', {}), (e: Error) => {
        assert.match(e.message, re, m);
        assert.doesNotMatch(e.message, new RegExp(SECRET), m);
        return true;
      });
    }
  } finally {
    server.close();
  }
  // 응답이 없다(연결 거부): 원래 예외의 문구를 붙이지 않는다
  await assert.rejects(githubGraphql('t', 'http://127.0.0.1:9')('query { ok }', {}), {
    message: 'GraphQL 요청 실패: 응답 없음',
  });
});

// --- P1 (계획 20261121-owner-accept-p1)

test('loadAccepted: 열린 P1만 있는 원장에서도 편집 이력을 읽어 승인을 반영한다', async () => {
  const w = world({ gql: [accept('F1', 5)] });
  const p1 = ledgerOf(entry({ severity: 'P1', openedAt: at(1) }));
  const got = await loadAccepted({ ledger: p1, owner: OWNER, graphql: w.graphql, ...where });
  assert.equal(w.gqlCalls, 1);
  assert.equal(got.ledger.findings[0].status, 'accepted');
  assert.deepEqual(got.outcome?.applied, [{ id: 'F1', commentId: CID + 5, at: at(5) }]);
  assert.equal(p1.findings[0].status, 'open');
  // 읽지 못하면 예외가 그대로 올라온다(부르는 쪽이 닫힌 쪽으로 처리한다)
  w.gqlFail = new Error(SECRET);
  await assert.rejects(loadAccepted({ ledger: p1, owner: OWNER, graphql: w.graphql, ...where }));
});

test('recordLedger: 열린 P1의 제작자 승인이 저장되고 review-ledger가 통과한다. 철회되면 다시 막는다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ severity: 'P1', openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  await record(w, 10);
  assert.equal(w.gqlCalls, 1);
  assert.equal(w.stored().findings[0].status, 'accepted');
  assert.equal(w.stored().findings[0].note, `제작자 승인(댓글 ${CID + 5})`);
  assert.equal(w.status()?.state, 'success');
  assert.match(w.status()?.description ?? '', /제작자 승인 1/);
  // 승인 댓글이 사라졌다
  w.gql = [];
  await record(w, 20);
  assert.equal(w.stored().findings[0].status, 'open');
  assert.equal(w.status()?.state, 'failure');
});

test('recordLedger: P1에도 제작자가 아닌 계정·고쳐진 댓글·게시 전의 댓글은 승인이 아니다', async () => {
  const cases: [string, Node][] = [
    ['PR 작성자인 봇 계정', accept('F1', 5, { author: { login: 'writer-bot' } })],
    ['고쳐진 댓글', accept('F1', 5, { userContentEdits: { totalCount: 1 } })],
    ['다른 글이 섞인 댓글', accept('F1', 5, { body: '예외로 인정한다\n/harness accept F1' })],
    ['게시와 같은 시각의 댓글', accept('F1', 1)],
  ];
  for (const [name, node] of cases) {
    const w = world({
      ledger: ledgerOf(entry({ severity: 'P1', openedAt: at(1) })),
      ledgerAt: at(1),
      gql: [node],
    });
    await record(w, 10);
    assert.equal(w.stored().findings[0].status, 'open', name);
    assert.equal(w.status()?.state, 'failure', name);
  }
});

test('recordLedger: 열린 P1만 있는 원장에서 편집 이력을 읽지 못하면 저장하지 않고 error다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ severity: 'P1', openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  w.gqlFail = new Error(SECRET);
  await record(w, 10, { verdict: verdict() });
  assert.equal(w.sends, 0);
  assert.equal(w.status()?.state, 'error');
  assert.doesNotMatch(JSON.stringify(w.statuses), new RegExp(SECRET));
  assert.equal(w.stored().findings[0].status, 'open');
});

test('readRoundLedger: 승인된 P1은 판정 job에 accepted로 넘어가고 반박 대상이 아니다', async () => {
  const w = world({
    ledger: ledgerOf(entry({ severity: 'P1' }), entry({ id: 'F2', severity: 'P1', title: 'b' })),
    ledgerAt: at(1),
    gql: [accept('F1', 5)],
  });
  const sha = 'c'.repeat(40);
  const rebut = (id: string) => `- 지적: ${id}\n- 근거: ${sha}\n- 요지: 이미 확인한다`;
  w.rest.push(
    { id: 600, user: { login: 'writer-bot' }, body: rebut('F1') },
    { id: 601, user: { login: 'writer-bot' }, body: rebut('F2') },
  );
  const r = await readRoundLedger({
    get: w.api.get,
    graphql: w.graphql,
    ...round,
    recorderBot: BOT,
    owner: OWNER,
  });
  assert.deepEqual(
    r.ledger?.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'accepted'],
      ['F2', 'open'],
    ],
  );
  assert.deepEqual(
    r.rebuttals.map((x) => x.id),
    ['F2'],
  );
});

// --- 구현 대기(parked, Issue #212)

test('readRoundLedger: 구현 대기를 기록 job과 같은 순서로 반영해 넘긴다(저장하지 않는다)', async () => {
  const PARK_NOTE = '구현 대기: 계획만 담은 head에서는 판정하지 않는다';
  const sha = 'c'.repeat(40);
  const rebut = (id: string) => `- 지적: ${id}\n- 근거: ${sha}\n- 요지: 이미 확인한다`;
  const read = (w: World, planOnly: boolean) =>
    readRoundLedger({
      get: w.api.get,
      graphql: w.graphql,
      ...where,
      recorderBot: BOT,
      owner: OWNER,
      planOnly,
    });
  // 구현 대기뿐인 원장, 코드가 섞인 head: 승인 댓글을 조회해 accepted로 넘긴다
  const parked = () =>
    world({
      ledger: ledgerOf(
        entry({ severity: 'P1', status: 'parked', note: PARK_NOTE, openedAt: at(1) }),
      ),
      ledgerAt: at(1),
      gql: [accept('F1', 5)],
    });
  const a = parked();
  const code = await read(a, false);
  assert.equal(a.gqlCalls, 1);
  assert.equal(code.ledger?.findings[0].status, 'accepted');
  assert.equal(a.sends, 0);
  // 승인 댓글이 없으면 저장된 구현 대기가 열림으로 보인다
  const b = parked();
  b.gql = [];
  b.rest.push({ id: 600, user: { login: 'writer-bot' }, body: rebut('F1') });
  const open = await read(b, false);
  assert.deepEqual(
    open.ledger?.findings.map((e) => [e.status, e.openedAt]),
    [['open', at(1)]],
  );
  assert.deepEqual(
    open.rebuttals.map((x) => x.id),
    ['F1'],
    '열림으로 돌아온 지적에 대한 반박은 넘긴다',
  );
  assert.equal(b.sends, 0);
  // 계획만 담은 head: 저장된 열린 코드 지적이 구현 대기로 보이고, 그 지적에 대한 반박은 넘기지 않는다
  const c = world({
    ledger: ledgerOf(
      entry({ severity: 'P1' }),
      entry({
        id: 'F2',
        severity: 'P1',
        file: 'docs/exec-plans/active/20261122-demo/step0.md',
        title: '계획의 지적',
      }),
    ),
    ledgerAt: at(1),
    gql: [],
  });
  c.rest.push(
    { id: 600, user: { login: 'writer-bot' }, body: rebut('F1') },
    { id: 601, user: { login: 'writer-bot' }, body: rebut('F2') },
  );
  const plan = await read(c, true);
  assert.deepEqual(
    plan.ledger?.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'parked'],
      ['F2', 'open'],
    ],
  );
  assert.deepEqual(
    plan.rebuttals.map((x) => x.id),
    ['F2'],
  );
  assert.equal(c.sends, 0);
  // 계획만 담은 head에서는 구현 대기인 지적의 승인 댓글을 반영하지 않는다
  const d = parked();
  const held = await read(d, true);
  assert.equal(held.ledger?.findings[0].status, 'parked');
  assert.equal(d.sends, 0);
  // 계획만 담은 head에서 승인이 철회된 accepted 코드 지적은 구현 대기로 보인다
  const e = world({
    ledger: ledgerOf(entry({ severity: 'P1', status: 'accepted', openedAt: at(1) })),
    ledgerAt: at(1),
    gql: [],
  });
  assert.equal((await read(e, true)).ledger?.findings[0].status, 'parked');
});

test('ledgerFromComments: 게시 시각이 없는 구현 대기 지적에도 원장 댓글의 저장 시각을 채운다 (Issue #212, 판정 지적 F8)', () => {
  const l = ledgerOf(
    entry({ severity: 'P1', status: 'parked' }),
    entry({ id: 'F2', title: 'b', status: 'parked', openedAt: at(1) }),
    entry({ id: 'F3', title: 'c', status: 'fixed' }),
  );
  const comment = { id: 500, user: { login: BOT }, body: renderLedger(l), updated_at: at(9) };
  assert.deepEqual(
    ledgerFromComments([comment], BOT).ledger?.findings.map((e) => [e.id, e.status, e.openedAt]),
    [
      ['F1', 'parked', at(9)],
      ['F2', 'parked', at(1)],
      ['F3', 'fixed', undefined],
    ],
  );
});

test('F8: 판정이 다시 열어 게시 시각 없이 구현 대기로 저장된 지적도, 게시 뒤의 제작자 승인을 코드가 돌아온 첫 기록에서 받는다 (Issue #212)', async () => {
  for (const [sec, want] of [
    [4, 'open'],
    [5, 'open'],
    [6, 'accepted'],
  ] as const) {
    // 앞선 구현 판정에서 고쳐진 코드 지적과, 그 번호를 승인한 제작자 댓글(sec초)
    const w = world({
      ledger: ledgerOf(
        entry({ severity: 'P1', status: 'fixed', note: 'abc1234', openedAt: at(1) }),
      ),
      ledgerAt: at(1),
      gql: [accept('F1', sec)],
    });
    // 실행 1(계획만 담은 head, at(5)에 저장): 지적을 낸 검증자가 다시 연다. 같은 기록에서 구현 대기가 되고
    // 다시 열렸으므로 게시 시각은 지워진다
    await record(w, 5, {
      reviewer: 'codex',
      verdict: verdict([], [{ id: 'F1', status: 'open', note: '고친 코드가 없다' }]),
      planOnly: true,
    });
    assert.deepEqual(
      w.stored().findings.map((e) => [e.status, e.openedAt]),
      [['parked', undefined]],
    );
    assert.equal(w.status()?.state, 'success');
    // 실행 2(코드가 돌아온 head, 판정 없음): 구현 대기로 게시된 시각(at(5))이 채워지고 그보다 엄격히 뒤의 승인만 받는다
    await record(w, 20);
    const e = w.stored().findings[0];
    assert.equal(e.status, want, `댓글 ${sec}초`);
    assert.equal(e.openedAt, at(5));
    assert.equal(w.status()?.state, want === 'accepted' ? 'success' : 'failure');
  }
});
