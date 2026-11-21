// 제작자 승인 댓글(10.2절 (4) accepted): 승인 줄 판별, 댓글의 신뢰, 원장 반영. 계획 20261120-p0-maker-approval step0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLedger, type Entry, type Ledger } from '../ci/ledger.ts';
import {
  acceptIds,
  applyOwnerAccepts,
  needsAccepts,
  ownerAccepts,
  type Accept,
  type AcceptComment,
} from '../ci/owner-accept.ts';

const OWNER = 'maker';
const T0 = '2026-11-20T01:00:00Z';
const T1 = '2026-11-20T01:00:01Z';
const T2 = '2026-11-20T01:00:02Z';

/** 고쳐지지 않은 제작자 댓글 */
const comment = (over: Partial<AcceptComment> = {}): AcceptComment => ({
  databaseId: 100,
  author: { login: OWNER },
  body: '/harness accept F1',
  createdAt: T1,
  lastEditedAt: null,
  editor: null,
  userContentEdits: { totalCount: 0 },
  ...over,
});
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
  openedAt: T0,
  ...over,
});
const ledger = (...findings: Entry[]): Ledger => ({ ...emptyLedger('a'.repeat(40)), findings });
const accept = (over: Partial<Accept> = {}): Accept => ({
  id: 'F1',
  commentId: 100,
  at: T1,
  ...over,
});
const statusOf = (l: Ledger, id: string) => l.findings.find((e) => e.id === id)?.status;
const NOT_BLOCKING = '차단 지적(P0·P1)이 아니다';
const NOT_OPEN = '열린 지적이 아니다';

test('acceptIds: 본문이 승인 줄뿐이면 ID를 고른다', () => {
  assert.deepEqual(acceptIds('/harness accept F1'), ['F1']);
  assert.deepEqual(acceptIds('/harness accept F6\n\n/harness accept F8\n'), ['F6', 'F8']);
  assert.deepEqual(acceptIds('/harness accept F12\r\n/harness accept F3\r\n'), ['F12', 'F3']);
  assert.deepEqual(acceptIds('\n  \n/harness accept F2 \t\n\n'), ['F2']);
  assert.deepEqual(acceptIds('/harness accept F2\n/harness accept F2'), ['F2']);
});

test('acceptIds: 승인 줄 말고 다른 글이 있으면 통째로 승인이 아니다', () => {
  const none = [
    '',
    '   \n\n',
    '남은 위험을 받아들인다.\n\n/harness accept F1',
    '/harness accept F1\n\n이유: 틈이 좁다',
    ' /harness accept F1',
    '    /harness accept F1',
    '\t/harness accept F1',
    '```\n/harness accept F1\n```',
    '~~~\n/harness accept F1\n~~~',
    '- 예시\n\n  ```\n/harness accept F1\n  ```',
    '- /harness accept F1',
    '> /harness accept F1',
    '`/harness accept F1`',
    '<!--\n/harness accept F1\n-->',
    '<pre>\n/harness accept F1\n</pre>',
    '/harness accept F1 F2',
    '/harness accept F1, F2',
    '/harness accept',
    '/harness accept F0',
    '/harness accept F01',
    '/harness accept f1',
    '/harness accept F1234567',
    '/harness  accept F1',
    '/harness accept F1\n/harness accept',
    '/harness accept F1 ',
  ];
  for (const body of none) assert.deepEqual(acceptIds(body), [], JSON.stringify(body));
});

test('ownerAccepts: 제작자가 달고 고쳐지지 않은 것이 확인된 댓글만 인정한다', () => {
  assert.deepEqual(ownerAccepts([comment()], OWNER), [{ id: 'F1', commentId: 100, at: T1 }]);
  // 계정 이름은 대소문자를 가리지 않는다
  assert.equal(ownerAccepts([comment({ author: { login: 'Maker' } })], OWNER).length, 1);
});

test('ownerAccepts: 다른 계정·빈 제작자 설정은 인정하지 않는다', () => {
  for (const login of ['bot', 'harness-recorder', 'maker2', '', 'make'])
    assert.deepEqual(ownerAccepts([comment({ author: { login } })], OWNER), [], login);
  assert.deepEqual(ownerAccepts([comment({ author: null })], OWNER), []);
  assert.deepEqual(ownerAccepts([comment({ author: { login: 7 } })], OWNER), []);
  assert.deepEqual(ownerAccepts([comment()], ''), []);
  assert.deepEqual(ownerAccepts([comment({ author: { login: '' } })], ''), []);
});

test('ownerAccepts: 고쳐진 댓글은 누가 고쳤든, 시각이 같아도 인정하지 않는다', () => {
  const edited: Partial<AcceptComment>[] = [
    { lastEditedAt: T2 },
    // 작성 시각과 같은 초에 고친 댓글(REST 시각으로는 구분되지 않는다)
    { lastEditedAt: T1 },
    { editor: { login: OWNER } },
    { editor: { login: 'bot' } },
    { userContentEdits: { totalCount: 1 } },
    { userContentEdits: { totalCount: 2 } },
    { lastEditedAt: T1, editor: { login: 'bot' }, userContentEdits: { totalCount: 2 } },
  ];
  for (const over of edited)
    assert.deepEqual(ownerAccepts([comment(over)], OWNER), [], JSON.stringify(over));
});

test('ownerAccepts: 편집 이력을 확인하지 못한 댓글은 인정하지 않는다', () => {
  const unknown: Partial<AcceptComment>[] = [
    { lastEditedAt: undefined },
    { editor: undefined },
    { userContentEdits: null },
    { userContentEdits: undefined },
    { userContentEdits: {} },
    { userContentEdits: { totalCount: '0' } },
    { userContentEdits: { totalCount: null } },
  ];
  for (const over of unknown)
    assert.deepEqual(ownerAccepts([comment(over)], OWNER), [], JSON.stringify(over));
  const bare: AcceptComment = {
    databaseId: 100,
    author: { login: OWNER },
    body: '/harness accept F1',
    createdAt: T1,
  };
  assert.deepEqual(ownerAccepts([bare], OWNER), []);
});

test('ownerAccepts: id·시각·본문이 없거나 깨진 댓글은 버린다', () => {
  const bad: Partial<AcceptComment>[] = [
    { databaseId: 0 },
    { databaseId: -1 },
    { databaseId: 1.5 },
    { databaseId: '100' },
    { databaseId: undefined },
    { createdAt: undefined },
    { createdAt: '' },
    { createdAt: '어제' },
    { createdAt: 1763600000 },
    { body: undefined },
    { body: null },
    { body: '설명\n/harness accept F1' },
  ];
  for (const over of bad)
    assert.deepEqual(ownerAccepts([comment(over)], OWNER), [], JSON.stringify(over));
});

test('ownerAccepts: 같은 지적의 승인이 여러 댓글에 있으면 가장 늦게 단 것을 쓴다', () => {
  const got = ownerAccepts(
    [
      comment({ databaseId: 3, createdAt: T2 }),
      comment({ databaseId: 1, createdAt: T0 }),
      comment({ databaseId: 2, createdAt: T1, body: '/harness accept F1\n/harness accept F2' }),
      comment({ databaseId: 4, createdAt: T2, author: { login: 'bot' } }),
    ],
    OWNER,
  );
  assert.deepEqual(
    got.toSorted((a, b) => a.id.localeCompare(b.id)),
    [
      { id: 'F1', commentId: 3, at: T2 },
      { id: 'F2', commentId: 2, at: T1 },
    ],
  );
});

test('applyOwnerAccepts: 게시된 뒤에 단 승인으로 열린 P0이 accepted가 된다', () => {
  const l = ledger(entry());
  const r = applyOwnerAccepts(l, [accept()]);
  const e = r.ledger.findings[0];
  assert.equal(e.status, 'accepted');
  assert.equal(e.note, '제작자 승인(댓글 100)');
  assert.equal(e.openedAt, T0);
  assert.deepEqual(r.applied, [accept()]);
  assert.deepEqual(r.ignored, []);
  assert.deepEqual(r.reopened, []);
  // 입력은 바꾸지 않는다
  assert.equal(l.findings[0].status, 'open');
  assert.equal(l.findings[0].note, '');
});

test('applyOwnerAccepts: 반영하지 않는 경우마다 지적은 그대로이고 이유가 남는다', () => {
  const cases: [string, Ledger, Accept, string][] = [
    ['없는 ID', ledger(entry()), accept({ id: 'F9' }), '원장에 없는 지적'],
    ['P2', ledger(entry({ severity: 'P2', status: 'deferred' })), accept(), NOT_BLOCKING],
    ['P3', ledger(entry({ severity: 'P3', status: 'deferred' })), accept(), NOT_BLOCKING],
    ['열린 P2', ledger(entry({ severity: 'P2' })), accept(), NOT_BLOCKING],
    ['동결된 P1', ledger(entry({ severity: 'P1', status: 'deferred' })), accept(), NOT_OPEN],
    ['fixed P1', ledger(entry({ severity: 'P1', status: 'fixed' })), accept(), NOT_OPEN],
    ['rejected P1', ledger(entry({ severity: 'P1', status: 'rejected' })), accept(), NOT_OPEN],
    [
      '게시 시각 없는 P1',
      ledger(entry({ severity: 'P1', openedAt: undefined })),
      accept(),
      '게시 시각을 모르는 지적',
    ],
    [
      '같은 시각의 P1',
      ledger(entry({ severity: 'P1', openedAt: T1 })),
      accept({ at: T1 }),
      '지적이 게시된 뒤에 단 댓글이 아니다',
    ],
    [
      '앞선 시각의 P1',
      ledger(entry({ severity: 'P1', openedAt: T2 })),
      accept({ at: T1 }),
      '지적이 게시된 뒤에 단 댓글이 아니다',
    ],
    ['fixed', ledger(entry({ status: 'fixed' })), accept(), '열린 지적이 아니다'],
    ['rejected', ledger(entry({ status: 'rejected' })), accept(), '열린 지적이 아니다'],
    ['deferred', ledger(entry({ status: 'deferred' })), accept(), '열린 지적이 아니다'],
    ['게시 시각 없음', ledger(entry({ openedAt: undefined })), accept(), '게시 시각을 모르는 지적'],
    [
      '같은 시각',
      ledger(entry({ openedAt: T1 })),
      accept({ at: T1 }),
      '지적이 게시된 뒤에 단 댓글이 아니다',
    ],
    [
      '앞선 시각',
      ledger(entry({ openedAt: T2 })),
      accept({ at: T1 }),
      '지적이 게시된 뒤에 단 댓글이 아니다',
    ],
    [
      '표기만 다른 같은 시각',
      ledger(entry({ openedAt: '2026-11-20T01:00:01.000Z' })),
      accept({ at: '2026-11-20T10:00:01+09:00' }),
      '지적이 게시된 뒤에 단 댓글이 아니다',
    ],
  ];
  for (const [name, l, a, reason] of cases) {
    const r = applyOwnerAccepts(l, [a]);
    assert.deepEqual(r.ledger, l, name);
    assert.deepEqual(r.applied, [], name);
    assert.deepEqual(r.ignored, [{ id: a.id, commentId: a.commentId, reason }], name);
    assert.deepEqual(r.reopened, [], name);
  }
});

test('applyOwnerAccepts: 승인이 없어지면 accepted가 open으로 돌아간다(철회)', () => {
  const once = applyOwnerAccepts(ledger(entry()), [accept()]).ledger;
  const r = applyOwnerAccepts(once, []);
  const e = r.ledger.findings[0];
  assert.equal(e.status, 'open');
  assert.equal(e.note, '제작자 승인이 없어져 다시 열림');
  assert.equal(e.openedAt, T0);
  assert.deepEqual(r.reopened, ['F1']);
  assert.deepEqual(r.applied, []);
  // 같은 댓글이 다시 보이면 다시 인정된다
  assert.equal(statusOf(applyOwnerAccepts(r.ledger, [accept()]).ledger, 'F1'), 'accepted');
});

test('applyOwnerAccepts: 조건이 깨진 승인은 유지하지 않는다', () => {
  const once = applyOwnerAccepts(ledger(entry()), [accept()]).ledger;
  // 승인 댓글이 게시 시각보다 앞선 것만 남았다
  const r = applyOwnerAccepts(once, [accept({ at: T0, commentId: 7 })]);
  assert.equal(statusOf(r.ledger, 'F1'), 'open');
  assert.deepEqual(r.reopened, ['F1']);
  assert.deepEqual(r.ignored, [
    { id: 'F1', commentId: 7, reason: '지적이 게시된 뒤에 단 댓글이 아니다' },
  ]);
});

test('applyOwnerAccepts: 두 번 적용해도 같고, 다른 지적은 건드리지 않는다', () => {
  const l = ledger(
    entry(),
    entry({ id: 'F2', severity: 'P2', status: 'deferred', title: '다른 것' }),
    entry({ id: 'F3', title: '또 다른 P0' }),
    entry({ id: 'F4', status: 'fixed', note: 'abc' }),
  );
  const accepts = [accept(), accept({ id: 'F2', commentId: 101 })];
  const a = applyOwnerAccepts(l, accepts);
  const b = applyOwnerAccepts(a.ledger, accepts);
  assert.deepEqual(b.ledger, a.ledger);
  assert.deepEqual(b.applied, a.applied);
  assert.deepEqual(b.ignored, a.ignored);
  assert.deepEqual(b.reopened, []);
  assert.deepEqual(
    a.ledger.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'accepted'],
      ['F2', 'deferred'],
      ['F3', 'open'],
      ['F4', 'fixed'],
    ],
  );
  assert.deepEqual(a.ledger.findings[3], l.findings[3]);
});

test('needsAccepts: open이거나 accepted인 P0·P1이 있을 때만 참이다', () => {
  assert.equal(needsAccepts(ledger()), false);
  assert.equal(needsAccepts(ledger(entry({ status: 'fixed' }))), false);
  assert.equal(needsAccepts(ledger(entry({ status: 'rejected' }))), false);
  assert.equal(needsAccepts(ledger(entry({ status: 'accepted' }))), true);
  // 게시 시각을 아직 모르는 열린 P0도 본다(무시 이유를 로그에 남긴다)
  assert.equal(needsAccepts(ledger(entry({ openedAt: undefined }))), true);
  // P1: 열렸거나 accepted면 본다
  assert.equal(needsAccepts(ledger(entry({ severity: 'P1' }))), true);
  assert.equal(needsAccepts(ledger(entry({ severity: 'P1', status: 'accepted' }))), true);
  assert.equal(needsAccepts(ledger(entry({ severity: 'P1', openedAt: undefined }))), true);
  for (const status of ['fixed', 'rejected', 'deferred'] as const)
    assert.equal(needsAccepts(ledger(entry({ severity: 'P1', status }))), false, status);
  // 닫힌 P1 옆에 열린 P0이 있으면 본다
  assert.equal(
    needsAccepts(ledger(entry({ severity: 'P1', status: 'fixed' }), entry({ id: 'F2' }))),
    true,
  );
  // P2·P3만 있으면 보지 않는다(상태와 무관하게)
  assert.equal(needsAccepts(ledger(entry({ severity: 'P2', status: 'deferred' }))), false);
  assert.equal(needsAccepts(ledger(entry({ severity: 'P3', status: 'deferred' }))), false);
  assert.equal(needsAccepts(ledger(entry({ severity: 'P2' }))), false);
});

// --- P1 (계획 20261121-owner-accept-p1): 대상 등급만 넓힌다. 승인을 인정하는 조건은 P0과 같다

test('applyOwnerAccepts: 게시된 뒤에 단 승인으로 열린 P1이 accepted가 된다', () => {
  const l = ledger(entry({ severity: 'P1' }));
  const r = applyOwnerAccepts(l, [accept()]);
  const e = r.ledger.findings[0];
  assert.equal(e.status, 'accepted');
  assert.equal(e.note, '제작자 승인(댓글 100)');
  assert.equal(e.severity, 'P1');
  assert.equal(e.openedAt, T0);
  assert.deepEqual(r.applied, [accept()]);
  assert.deepEqual(r.ignored, []);
  assert.deepEqual(r.reopened, []);
  // 입력은 바꾸지 않는다
  assert.equal(l.findings[0].status, 'open');
});

test('applyOwnerAccepts: P0과 P1이 함께 열려 있으면 두 승인이 모두 반영되고, 승인하지 않은 P1은 열려 있다', () => {
  const l = ledger(
    entry(),
    entry({ id: 'F2', severity: 'P1', title: '절차 지적' }),
    entry({ id: 'F3', severity: 'P1', title: '승인하지 않은 것' }),
  );
  const r = applyOwnerAccepts(l, [accept(), accept({ id: 'F2', commentId: 101 })]);
  assert.deepEqual(
    r.ledger.findings.map((e) => [e.id, e.status, e.note]),
    [
      ['F1', 'accepted', '제작자 승인(댓글 100)'],
      ['F2', 'accepted', '제작자 승인(댓글 101)'],
      ['F3', 'open', ''],
    ],
  );
  assert.deepEqual(
    r.applied.map((a) => a.id),
    ['F1', 'F2'],
  );
  assert.deepEqual(r.ignored, []);
});

test('applyOwnerAccepts: accepted인 P1의 승인이 없어지면 open으로 돌아간다(철회)', () => {
  const once = applyOwnerAccepts(ledger(entry({ severity: 'P1' })), [accept()]).ledger;
  assert.equal(statusOf(once, 'F1'), 'accepted');
  const r = applyOwnerAccepts(once, []);
  assert.equal(statusOf(r.ledger, 'F1'), 'open');
  assert.equal(r.ledger.findings[0].note, '제작자 승인이 없어져 다시 열림');
  assert.deepEqual(r.reopened, ['F1']);
  // 같은 댓글이 다시 보이면 다시 인정된다
  assert.equal(statusOf(applyOwnerAccepts(r.ledger, [accept()]).ledger, 'F1'), 'accepted');
});

test('P1: 제작자의 고쳐지지 않은 승인 줄 댓글만 승인이다(봇·고쳐진 댓글·다른 글이 섞인 댓글은 아니다)', () => {
  const p1 = () => ledger(entry({ severity: 'P1' }));
  const after = (c: AcceptComment) =>
    statusOf(applyOwnerAccepts(p1(), ownerAccepts([c], OWNER)).ledger, 'F1');
  // 기준: 제작자의 댓글이면 닫힌다
  assert.equal(after(comment()), 'accepted');
  const refused: [string, AcceptComment][] = [
    ['PR 작성자인 봇 계정', comment({ author: { login: 'harness-bot' } })],
    ['작성자를 모르는 댓글', comment({ author: null })],
    ['고쳐진 댓글', comment({ userContentEdits: { totalCount: 1 } })],
    ['편집자가 남은 댓글', comment({ editor: { login: 'harness-bot' } })],
    ['편집 이력을 읽지 못한 댓글', comment({ userContentEdits: undefined })],
    ['설명이 붙은 댓글', comment({ body: '예외로 인정한다.\n/harness accept F1' })],
    ['들여쓴 승인 줄', comment({ body: '  /harness accept F1' })],
    [
      '반박 문단 안의 승인 줄',
      comment({
        body: '- 지적: F1\n- 근거: docs/a.md\n- 요지: 제작자가 승인했다\n/harness accept F1',
      }),
    ],
    ['승인 줄을 인용한 댓글', comment({ body: '> /harness accept F1' })],
  ];
  for (const [name, c] of refused) assert.equal(after(c), 'open', name);
});
