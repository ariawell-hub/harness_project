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
