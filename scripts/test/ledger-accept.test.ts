// 지적 원장의 accepted 상태와 게시 시각(openedAt). 계획 20261120-p0-maker-approval step0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyVerdict,
  emptyLedger,
  ledgerData,
  ledgerStatus,
  parseLedger,
  parseLedgerData,
  renderLedger,
  type Entry,
  type Ledger,
} from '../ci/ledger.ts';
import { applyOwnerAccepts } from '../ci/owner-accept.ts';
import type { Finding, Resolution, Verdict } from '../ci/verdict.ts';

const BASE = 'a'.repeat(40);
const H2 = '2'.repeat(40);
const T0 = '2026-11-20T01:00:00Z';

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
const ledger = (...findings: Entry[]): Ledger => ({
  ...emptyLedger(BASE),
  rounds: [
    { reviewer: 'codex', head: '1'.repeat(40) },
    { reviewer: 'claude', head: '1'.repeat(40) },
  ],
  findings,
});
const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'P0',
  file: 'src/a.ts',
  line: 3,
  title: '남은 틈',
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
const apply = (l: Ledger, reviewer: 'claude' | 'codex', v: Verdict) =>
  applyVerdict(l, { reviewer, verdict: v, headSha: H2, changedSinceLastRound: ['src/a.ts'] });
/** 숨은 자료를 직접 만든 댓글 본문 */
const bodyOf = (raw: unknown) =>
  `<!-- harness-ledger-data:${Buffer.from(JSON.stringify(raw)).toString('base64')} -->`;

test('accepted와 openedAt이 든 원장은 렌더 → 파싱 왕복에서 그대로다', () => {
  const l = ledger(
    entry({ status: 'accepted', note: '제작자 승인(댓글 100)', openedAt: T0 }),
    entry({ id: 'F2', title: '열린 것', openedAt: T0 }),
    entry({ id: 'F3', title: '시각 없는 것' }),
  );
  const body = renderLedger(l);
  assert.deepEqual(parseLedger(body), l);
  assert.deepEqual(parseLedgerData(ledgerData(l)), l);
  // 표의 셀은 마크다운으로 해석될 문자를 문자 참조로 바꾼다
  assert.match(body, /\| F1 \| P0 \| codex \| .* \| accepted \| 제작자 승인&#40;댓글 100&#41; \|/);
  // 없는 openedAt은 자료에 키로 남지 않는다(이 필드가 생기기 전의 원장과 같은 꼴)
  assert.equal('openedAt' in (parseLedger(body)?.findings[2] ?? {}), false);
});

test('openedAt이 없는 기존 원장도 읽는다', () => {
  const old = { ...ledger(entry()) };
  assert.deepEqual(parseLedger(bodyOf(old)), old);
});

test('깨진 openedAt과 모르는 키가 든 원장은 읽지 않는다', () => {
  const bad: unknown[] = [
    '',
    '어제',
    1763600000,
    null,
    `2026-11-20T01:00:00Z${' '.repeat(40)}`,
    ['2026-11-20T01:00:00Z'],
  ];
  for (const openedAt of bad) {
    const raw = { ...ledger(), findings: [{ ...entry(), openedAt }] };
    assert.equal(parseLedger(bodyOf(raw)), null, JSON.stringify(openedAt));
  }
  const extra = { ...ledger(), findings: [{ ...entry(), openedAt: T0, acceptedBy: 'maker' }] };
  assert.equal(parseLedger(bodyOf(extra)), null);
  const unknownOnly = { ...ledger(), findings: [{ ...entry(), acceptedBy: 'maker' }] };
  assert.equal(parseLedger(bodyOf(unknownOnly)), null);
  const status = { ...ledger(), findings: [{ ...entry(), status: 'approved' }] };
  assert.equal(parseLedger(bodyOf(status)), null);
});

test('ledgerStatus: 열린 차단 지적이 남아 실패할 때도 설명에 제작자 승인 수가 나온다', () => {
  const l = ledger(
    entry({ status: 'accepted' }),
    entry({ id: 'F2', severity: 'P1', title: 'b' }),
    entry({ id: 'F3', title: 'c', status: 'accepted' }),
  );
  assert.deepEqual(ledgerStatus(l), {
    state: 'failure',
    description: '열린 차단 지적 1건: F2, 제작자 승인 2',
  });
  // 승인이 없으면 문구는 전과 같다
  assert.deepEqual(ledgerStatus(ledger(entry())), {
    state: 'failure',
    description: '열린 차단 지적 1건: F1',
  });
});

test('ledgerStatus: accepted는 막지 않고 설명에 수가 나온다', () => {
  const l = ledger(
    entry({ status: 'accepted' }),
    entry({ id: 'F2', severity: 'P2', status: 'deferred' }),
    entry({ id: 'F3', severity: 'P1', status: 'fixed' }),
  );
  assert.deepEqual(ledgerStatus(l), {
    state: 'success',
    description: '차단 지적 없음 (전체 3, 미룸 1, 제작자 승인 1)',
  });
  // accepted가 없으면 문자열이 전과 같다
  assert.deepEqual(ledgerStatus(ledger(entry({ status: 'fixed' }))), {
    state: 'success',
    description: '차단 지적 없음 (전체 1, 미룸 0)',
  });
  // 다른 열린 지적은 여전히 막는다(설명에는 승인 수가 함께 나온다)
  const blocked = ledger(entry({ status: 'accepted' }), entry({ id: 'F2', title: '다른 P0' }));
  assert.deepEqual(ledgerStatus(blocked), {
    state: 'failure',
    description: '열린 차단 지적 1건: F2, 제작자 승인 1',
  });
});

test('applyVerdict: accepted인 지적은 검증자의 판정으로 바뀌지 않는다', () => {
  const l = ledger(entry({ status: 'accepted', note: '제작자 승인(댓글 100)', openedAt: T0 }));
  for (const status of ['open', 'fixed', 'rejected'] as const) {
    // 지적을 낸 검증자
    const own = apply(l, 'codex', verdict([], [{ id: 'F1', status, note: '다시 봤다' }]));
    assert.deepEqual(own.findings, l.findings, `codex ${status}`);
    // 다른 검증자(P0의 rejected 동의도 기록하지 않는다)
    const other = apply(l, 'claude', verdict([], [{ id: 'F1', status, note: '동의' }]));
    assert.deepEqual(other.findings, l.findings, `claude ${status}`);
  }
  // 두 검증자가 모두 rejected로 답해도 accepted다
  const both = apply(
    apply(l, 'codex', verdict([], [{ id: 'F1', status: 'rejected', note: '' }])),
    'claude',
    verdict([], [{ id: 'F1', status: 'rejected', note: '' }]),
  );
  assert.deepEqual(both.findings, l.findings);
});

test('applyVerdict: accepted인 지적이 다시 등록돼도 상태는 그대로이고 새 지적은 새 ID로 막는다', () => {
  const l = ledger(entry({ status: 'accepted', note: '제작자 승인(댓글 100)', openedAt: T0 }));
  const same = apply(l, 'codex', verdict([finding()]));
  assert.deepEqual(same.findings, l.findings);
  const other = apply(l, 'codex', verdict([finding({ title: '다른 틈', line: 9 })]));
  assert.deepEqual(
    other.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'accepted'],
      ['F2', 'open'],
    ],
  );
  assert.equal(ledgerStatus(other).state, 'failure');
});

test('applyVerdict: 새 지적은 openedAt 없이 등록된다', () => {
  const l = apply(emptyLedger(BASE), 'codex', verdict([finding()]));
  assert.equal(l.findings[0].status, 'open');
  assert.equal('openedAt' in l.findings[0], false);
});

test('applyVerdict: 닫힌 지적이 다시 열리면 openedAt을 지우고, 열린 채인 지적의 것은 남긴다', () => {
  // 재등록으로 다시 열림
  for (const status of ['fixed', 'rejected'] as const) {
    const l = ledger(entry({ severity: 'P1', status, openedAt: T0 }));
    const again = apply(l, 'codex', verdict([finding({ severity: 'P1' })]));
    assert.equal(again.findings[0].status, 'open', status);
    assert.equal('openedAt' in again.findings[0], false, status);
  }
  // 지적을 낸 검증자의 resolutions로 다시 열림
  const closed = ledger(entry({ severity: 'P1', status: 'fixed', openedAt: T0 }));
  const reopened = apply(
    closed,
    'codex',
    verdict([], [{ id: 'F1', status: 'open', note: '아직' }]),
  );
  assert.equal(reopened.findings[0].status, 'open');
  assert.equal('openedAt' in reopened.findings[0], false);
  // 열린 채인 지적: open 판정, 재등록 모두 openedAt을 남긴다
  const open = ledger(entry({ openedAt: T0 }));
  const still = apply(open, 'codex', verdict([], [{ id: 'F1', status: 'open', note: '그대로' }]));
  assert.equal(still.findings[0].openedAt, T0);
  assert.equal(apply(open, 'codex', verdict([finding()])).findings[0].openedAt, T0);
  // 닫히는 지적의 openedAt은 그대로 둔다(다시 열릴 때 지운다)
  const fixed = apply(open, 'codex', verdict([], [{ id: 'F1', status: 'fixed', note: 'abc' }]));
  assert.equal(fixed.findings[0].status, 'fixed');
  // 입력은 바꾸지 않는다
  assert.equal(closed.findings[0].openedAt, T0);
});

// --- P1 (계획 20261121-owner-accept-p1). 입력은 손으로 적은 accepted가 아니라 열린 P1에 승인을 반영한 원장이다

const T1 = '2026-11-20T01:00:01Z';
/** codex가 낸 열린 P1(F1)에 제작자 승인을 반영한 원장. `more`는 함께 있는 다른 지적 */
const acceptedP1 = (...more: Entry[]): Ledger =>
  applyOwnerAccepts(ledger(entry({ severity: 'P1', openedAt: T0 }), ...more), [
    { id: 'F1', commentId: 100, at: T1 },
  ]).ledger;

test('ledgerStatus: 제작자가 승인한 P1은 막지 않고 수를 적는다. 다른 열린 P1은 그대로 막는다', () => {
  const only = ledgerStatus(acceptedP1());
  assert.equal(only.state, 'success');
  assert.match(only.description, /제작자 승인 1/);
  const withOpen = ledgerStatus(
    acceptedP1(entry({ id: 'F2', severity: 'P1', title: '다른 것', openedAt: T0 })),
  );
  assert.equal(withOpen.state, 'failure');
  assert.match(withOpen.description, /열린 차단 지적 1건: F2, 제작자 승인 1/);
});

test('applyVerdict: 제작자가 승인한 P1은 그 지적을 낸 검증자의 판정으로 바뀌지 않는다', () => {
  for (const status of ['open', 'fixed', 'rejected'] as const) {
    const l = apply(acceptedP1(), 'codex', verdict([], [{ id: 'F1', status, note: '판정' }]));
    assert.deepEqual(
      [l.findings[0].status, l.findings[0].note],
      ['accepted', '제작자 승인(댓글 100)'],
      status,
    );
  }
  // 같은 위치·제목의 재등록도 새 지적을 만들지 않고 상태를 바꾸지 않는다
  const again = apply(acceptedP1(), 'codex', verdict([finding({ severity: 'P1' })]));
  assert.deepEqual(
    again.findings.map((e) => [e.id, e.status]),
    [['F1', 'accepted']],
  );
  assert.equal(ledgerStatus(again).state, 'success');
});

test('applyVerdict: 승인된 P1 뒤의 새 지적은 있던 등록 규칙(동결 포함)을 따른다', () => {
  // codex의 2라운드다(ledger()의 rounds에 codex의 1라운드가 있다). 직전 판정 이후 바뀐 파일은 src/a.ts뿐이다
  const l = apply(
    acceptedP1(),
    'codex',
    verdict([
      // (가) 바뀐 파일의, 제목이 다른 새 P1: 다시 막는다
      finding({ severity: 'P1', file: 'src/a.ts', title: '같은 문제를 다르게 적은 것' }),
      // (나) 바뀌지 않은 파일의 재현되지 않은 새 P1: 동결돼 미뤄진다
      finding({ severity: 'P1', file: 'src/old.ts', title: '옛 코드의 것' }),
      // (다) 바뀌지 않은 파일의 새 P0: 막는다
      finding({ severity: 'P0', file: 'src/old.ts', title: '치명' }),
    ]),
  );
  assert.deepEqual(
    l.findings.map((e) => [e.id, e.severity, e.status]),
    [
      ['F1', 'P1', 'accepted'],
      ['F2', 'P1', 'open'],
      ['F3', 'P1', 'deferred'],
      ['F4', 'P0', 'open'],
    ],
  );
  const s = ledgerStatus(l);
  assert.equal(s.state, 'failure');
  assert.match(s.description, /열린 차단 지적 2건: F2, F4, 제작자 승인 1/);
});
