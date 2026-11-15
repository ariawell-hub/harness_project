// 지적 원장: 직렬화, 판정 반영(ID·라운드·동결·상태 전이), review-ledger 판정. 계획 20261115-review-ledger step0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_BODY,
  MAX_ENTRIES,
  applyVerdict,
  emptyLedger,
  ledgerStatus,
  parseLedger,
  renderLedger,
  type Ledger,
} from '../ci/ledger.ts';
import type { Finding, Resolution, Verdict } from '../ci/verdict.ts';

const BASE = 'a'.repeat(40);
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const H3 = '3'.repeat(40);

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'P1',
  file: 'src/a.ts',
  line: 3,
  title: '만료 토큰을 허용함',
  evidence: '근거',
  suggestion: '제안',
  ...over,
});
const verdict = (findings: Finding[] = [], resolutions: Resolution[] = []): Verdict => ({
  verdict: findings.some((f) => f.severity <= 'P1') ? 'request_changes' : 'approve',
  risk: 'normal',
  summary: '요약',
  findings,
  resolutions,
});
const round1 = (findings: Finding[], reviewer: 'claude' | 'codex' = 'claude'): Ledger =>
  applyVerdict(emptyLedger(BASE), {
    reviewer,
    verdict: verdict(findings),
    headSha: H1,
    changedSinceLastRound: null,
  });
const byId = (l: Ledger, id: string) => {
  const e = l.findings.find((x) => x.id === id);
  assert.ok(e, `${id}가 원장에 없다`);
  return e;
};

test('1라운드: 지적에 F<번호>를 차례로 붙이고 P0·P1은 open, P2·P3은 deferred', () => {
  const l = round1([
    finding({ severity: 'P0', title: 'a' }),
    finding({ severity: 'P1', title: 'b' }),
    finding({ severity: 'P2', title: 'c' }),
    finding({ severity: 'P3', title: 'd' }),
  ]);
  assert.deepEqual(
    l.findings.map((e) => [e.id, e.severity, e.status, e.reviewer, e.round]),
    [
      ['F1', 'P0', 'open', 'claude', 1],
      ['F2', 'P1', 'open', 'claude', 1],
      ['F3', 'P2', 'deferred', 'claude', 1],
      ['F4', 'P3', 'deferred', 'claude', 1],
    ],
  );
  assert.deepEqual(l.rounds, [{ reviewer: 'claude', head: H1 }]);
  assert.equal(l.promptBase, BASE);
  // 다른 검증자의 지적은 번호를 이어 받는다
  const both = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ title: 'e' })]),
    headSha: H1,
    changedSinceLastRound: null,
  });
  assert.deepEqual(
    both.findings.slice(-1).map((e) => [e.id, e.reviewer, e.round]),
    [['F5', 'codex', 1]],
  );
  // 입력 원장은 바꾸지 않는다
  assert.equal(l.findings.length, 4);
});

test('2라운드 동결: 바뀌지 않은 파일의 새 P1은 deferred, P0과 바뀐 파일의 P1은 open', () => {
  const l = applyVerdict(round1([]), {
    reviewer: 'claude',
    verdict: verdict([
      finding({ file: 'src/old.ts', title: '옛 코드 P1' }),
      finding({ file: 'src/old.ts', title: '옛 코드 P0', severity: 'P0' }),
      finding({ file: 'src/fix.ts', title: '수정에서 생긴 P1' }),
    ]),
    headSha: H2,
    changedSinceLastRound: ['src/fix.ts'],
  });
  assert.deepEqual(
    l.findings.map((e) => [e.title, e.status, e.round]),
    [
      ['옛 코드 P1', 'deferred', 2],
      ['옛 코드 P0', 'open', 2],
      ['수정에서 생긴 P1', 'open', 2],
    ],
  );
  assert.match(byId(l, 'F1').note, /동결/);
  // 그 검증자의 첫 판정이면(앞 라운드에 판정을 못 냈다) 동결하지 않는다
  const first = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ file: 'src/old.ts', title: 'codex 첫 판정' })]),
    headSha: H2,
    changedSinceLastRound: ['src/fix.ts'],
  });
  assert.equal(first.findings.at(-1)?.status, 'open');
  // 바뀐 파일 목록을 모르면(null) 동결한다(fail-closed가 아니라 목표 고정 쪽)
  const unknown = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/x.ts', title: '목록 없음' })]),
    headSha: H3,
    changedSinceLastRound: null,
  });
  assert.equal(unknown.findings.at(-1)?.status, 'deferred');
});

test('같은 지적(검증자·위치·제목)은 다시 등록하지 않는다', () => {
  const l = round1([finding()]);
  const again = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding()]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
  });
  assert.equal(again.findings.length, 1);
  assert.equal(again.rounds.length, 2);
  // 파일 이름은 원장에 적는 꼴(제어 문자 제거)로 비교한다
  const ctl = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/a.ts\u0007' })]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
  });
  assert.equal(ctl.findings.length, 1);
});

test('fixed·rejected 지적을 같은 검증자가 다시 내면 다시 연다. deferred는 그대로 둔다', () => {
  let l = round1([finding({ title: 'a' }), finding({ title: 'b' }), finding({ severity: 'P2' })]);
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict(
      [],
      [
        { id: 'F1', status: 'fixed', note: '고침' },
        { id: 'F2', status: 'rejected', note: '반박 동의' },
      ],
    ),
    headSha: H2,
    changedSinceLastRound: [],
  });
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([
      finding({ title: 'a' }),
      finding({ title: 'b' }),
      finding({ severity: 'P2' }),
    ]),
    headSha: H3,
    changedSinceLastRound: [],
  });
  assert.deepEqual(
    l.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'open'],
      ['F2', 'open'],
      ['F3', 'deferred'],
    ],
  );
  assert.match(byId(l, 'F1').note, /다시 지적/);
});

test('resolutions: 자기 지적만 fixed·rejected·open으로 바꾼다', () => {
  let l = round1([finding({ title: 'a' }), finding({ title: 'b' })]);
  l = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ title: 'c' })]),
    headSha: H1,
    changedSinceLastRound: null,
  });
  // codex가 claude의 P1(F1)을 고쳤다고 해도 무시한다. 모르는 ID도 무시한다
  l = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict(
      [],
      [
        { id: 'F1', status: 'fixed', note: '남의 지적' },
        { id: 'F3', status: 'fixed', note: 'a1b2c3d에서 고침' },
        { id: 'F99', status: 'fixed', note: '없는 지적' },
      ],
    ),
    headSha: H2,
    changedSinceLastRound: [],
  });
  assert.deepEqual(
    l.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'open'],
      ['F2', 'open'],
      ['F3', 'fixed'],
    ],
  );
  assert.equal(byId(l, 'F3').note, 'a1b2c3d에서 고침');
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict(
      [],
      [
        { id: 'F1', status: 'fixed', note: '' },
        { id: 'F2', status: 'rejected', note: '반박에 동의' },
      ],
    ),
    headSha: H2,
    changedSinceLastRound: [],
  });
  assert.deepEqual(
    l.findings.map((e) => e.status),
    ['fixed', 'rejected', 'fixed'],
  );
  // 고쳤다고 한 지적을 낸 검증자가 다시 열 수 있다
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '회귀' }]),
    headSha: H3,
    changedSinceLastRound: [],
  });
  assert.equal(byId(l, 'F1').status, 'open');
});

test('resolutions: deferred 지적은 판정으로 바뀌지 않는다', () => {
  let l = round1([finding({ severity: 'P2' })]);
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '' }]),
    headSha: H2,
    changedSinceLastRound: [],
  });
  assert.equal(byId(l, 'F1').status, 'deferred');
});

test('P0 rejected는 두 검증자가 모두 동의해야 한다', () => {
  let l = round1([finding({ severity: 'P0' })]);
  const reject = (reviewer: 'claude' | 'codex', cur: Ledger) =>
    applyVerdict(cur, {
      reviewer,
      verdict: verdict([], [{ id: 'F1', status: 'rejected', note: '재현 안 됨' }]),
      headSha: H2,
      changedSinceLastRound: [],
    });
  l = reject('claude', l);
  assert.equal(byId(l, 'F1').status, 'open');
  assert.deepEqual(byId(l, 'F1').rejectedBy, ['claude']);
  // 같은 검증자가 두 번 동의해도 한 번이다
  l = reject('claude', l);
  assert.equal(byId(l, 'F1').status, 'open');
  const done = reject('codex', l);
  assert.equal(byId(done, 'F1').status, 'rejected');
  // 낸 검증자가 동의를 거두면 다시 한 명이다
  const back = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '' }]),
    headSha: H3,
    changedSinceLastRound: [],
  });
  assert.deepEqual(byId(back, 'F1').rejectedBy, []);
  // 남의 P1에 대한 rejected는 무시한다
  let p1 = round1([finding()]);
  p1 = applyVerdict(p1, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'rejected', note: '' }]),
    headSha: H1,
    changedSinceLastRound: null,
  });
  assert.equal(byId(p1, 'F1').status, 'open');
  assert.deepEqual(byId(p1, 'F1').rejectedBy, []);
});

test('ledgerStatus: P0·P1이 모두 fixed·rejected일 때만 success', () => {
  assert.equal(ledgerStatus(emptyLedger(BASE)).state, 'success');
  let l = round1([finding({ title: 'a' }), finding({ title: 'b' }), finding({ severity: 'P2' })]);
  const open = ledgerStatus(l);
  assert.equal(open.state, 'failure');
  assert.match(open.description, /2건.*F1, F2/);
  l = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict(
      [],
      [
        { id: 'F1', status: 'fixed', note: '' },
        { id: 'F2', status: 'rejected', note: '' },
      ],
    ),
    headSha: H2,
    changedSinceLastRound: [],
  });
  const ok = ledgerStatus(l);
  assert.equal(ok.state, 'success');
  assert.match(ok.description, /차단 지적 없음/);
  // 동결된 P1은 막지 않는다(10.2절 (5)). 수를 description에 적는다
  const frozen = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/old.ts', title: '뒤늦은 P1' })]),
    headSha: H3,
    changedSinceLastRound: [],
  });
  const f = ledgerStatus(frozen);
  assert.equal(f.state, 'success');
  assert.match(f.description, /동결 P1 1/);
  // 열린 지적이 많아도 description은 140자를 넘지 않는다
  const many = round1(Array.from({ length: 30 }, (_, i) => finding({ title: `t${i}` })));
  assert.ok(ledgerStatus(many).description.length <= 140);
});

test('renderLedger → parseLedger 왕복. 표를 깨는 문자와 주석 끝 표식이 있어도 같다', () => {
  let l = round1([
    finding({
      title: '파이프 | 와 <!-- 주석 --> 과 @someone 과\n줄바꿈 [링크](https://x.invalid)',
      file: 'src/a|b.ts',
    }),
    finding({ severity: 'P3', title: '`코드`' }),
  ]);
  l = { ...l, ciFailures: [{ head: H1, run: 'https://github.com/o/r/actions/runs/1' }] };
  const body = renderLedger(l);
  assert.deepEqual(parseLedger(body), l);
  // 표의 셀에는 원문의 |, 줄바꿈, 주석, 멘션, 링크 문법이 그대로 남지 않는다
  const row = body.split('\n').find((x) => x.startsWith('| F1 '));
  assert.ok(row, 'F1 행이 없다');
  assert.equal(row.split(' | ').length, 8, row);
  assert.doesNotMatch(row, /<!--|@someone|\]\(https/);
  // 숨은 자료는 주석 하나이고 본문 어디에도 주석을 일찍 닫는 표식이 없다
  assert.equal(body.match(/<!--/g)?.length, body.match(/-->/g)?.length);
  assert.match(body, new RegExp(`프롬프트 버전.*${BASE.slice(0, 12)}`));
  assert.match(body, /CI 실패/);
});

test('parseLedger: 자료가 없거나 깨졌거나 형식이 다르면 null', () => {
  const good = renderLedger(round1([finding()]));
  const data = (o: unknown) =>
    `<!-- harness-ledger-data:${Buffer.from(JSON.stringify(o)).toString('base64')} -->`;
  const l = round1([finding()]);
  const bad = [
    '',
    '그냥 댓글',
    good.replace(/harness-ledger-data:[A-Za-z0-9+/=]+/, 'harness-ledger-data:!!!!'),
    data('문자열'),
    data({ ...l, version: 2 }),
    data({ ...l, promptBase: 'xyz' }),
    data({ ...l, findings: [{ ...l.findings[0], status: 'done' }] }),
    data({ ...l, findings: [{ ...l.findings[0], id: 'G1' }] }),
    data({ ...l, findings: [{ ...l.findings[0], extra: 1 }] }),
    data({ ...l, findings: [l.findings[0], l.findings[0]] }),
    data({ ...l, rounds: [{ reviewer: 'gpt', head: H1 }] }),
    data({ ...l, extra: 1 }),
    // 자료가 두 개면 어느 쪽이 진짜인지 알 수 없다
    good + '\n' + data(l),
  ];
  for (const b of bad) assert.equal(parseLedger(b), null, b.slice(0, 60));
});

test('원장이 가득 차면 P2·P3은 더 등록하지 않고 센다. P0·P1은 계속 받는다', () => {
  let l = emptyLedger(BASE);
  for (let i = 0; l.findings.length < MAX_ENTRIES; i++)
    l = applyVerdict(l, {
      reviewer: i % 2 ? 'codex' : 'claude',
      verdict: verdict(
        Array.from({ length: 30 }, (_, j) => finding({ severity: 'P2', title: `p2-${i}-${j}` })),
      ),
      headSha: H1,
      changedSinceLastRound: null,
    });
  assert.equal(l.findings.length, MAX_ENTRIES);
  const more = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ severity: 'P3', title: '넘침' }), finding({ title: '차단' })]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
  });
  assert.equal(more.findings.length, MAX_ENTRIES + 1);
  assert.equal(more.findings.at(-1)?.title, '차단');
  assert.equal(more.dropped, l.dropped + 1);
  assert.ok(renderLedger(more).length < 65536);
});

test('댓글 크기 상한: 긴 제목·특수문자로 커지면 P2·P3 등록을 멈춘다', () => {
  let l = emptyLedger(BASE);
  const long = (i: number, j: number) => `${'한|<@[*'.repeat(30)}${i}-${j}`.slice(0, 200);
  for (let i = 0; i < 6; i++)
    l = applyVerdict(l, {
      reviewer: i % 2 ? 'codex' : 'claude',
      verdict: verdict(
        Array.from({ length: 30 }, (_, j) =>
          finding({ severity: 'P2', title: long(i, j), file: `${'d/'.repeat(100)}${i}-${j}.ts` }),
        ),
      ),
      headSha: H1,
      changedSinceLastRound: null,
    });
  assert.ok(l.dropped > 0, '크기 상한에 걸린 지적이 없다');
  assert.ok(l.findings.length < MAX_ENTRIES);
  const body = renderLedger(l);
  assert.ok(body.length <= MAX_BODY, String(body.length));
  assert.deepEqual(parseLedger(body), l);
});

test('라운드 기록은 자르지 않는다(라운드 번호와 동결 판정이 틀어진다)', () => {
  let l = emptyLedger(BASE);
  for (let i = 0; i < 210; i++)
    l = applyVerdict(l, {
      reviewer: 'claude',
      verdict: verdict(),
      headSha: H1,
      changedSinceLastRound: [],
    });
  assert.equal(l.rounds.length, 210);
  assert.deepEqual(parseLedger(renderLedger(l)), l);
});
