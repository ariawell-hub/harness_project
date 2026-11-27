// 지적 원장: 직렬화, 판정 반영(ID·라운드·동결·상태 전이), review-ledger 판정. 계획 20261115-review-ledger step0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_BODY,
  MAX_ENTRIES,
  applyPlanReview,
  applyVerdict,
  emptyLedger,
  ledgerStatus,
  parkFor,
  parseLedger,
  renderLedger,
  type Entry,
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
  repro: { path: '', content: '' },
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

test('근거가 빈 P1은 P2로 내려 등록한다. P0은 내리지 않는다(10.2절 (3))', () => {
  const l = round1([
    finding({ title: '근거 없음', evidence: '  ' }),
    finding({ title: '위치 없음', file: '' }),
    finding({ title: 'P0 근거 없음', severity: 'P0', evidence: '' }),
    finding({ title: '근거 있음' }),
  ]);
  assert.deepEqual(
    l.findings.map((e) => [e.title, e.severity, e.status]),
    [
      ['근거 없음', 'P2', 'deferred'],
      ['위치 없음', 'P2', 'deferred'],
      ['P0 근거 없음', 'P0', 'open'],
      ['근거 있음', 'P1', 'open'],
    ],
  );
  assert.match(byId(l, 'F1').note, /근거 없음/);
});

test('재현 결과를 원장에 적는다. 재현된 P1은 동결하지 않고, 재현 안 됨은 상태를 바꾸지 않는다', () => {
  const l = applyVerdict(round1([]), {
    reviewer: 'claude',
    verdict: verdict([
      finding({ file: 'src/old.ts', title: '재현됨' }),
      finding({ file: 'src/old.ts', title: '재현 안 됨' }),
      finding({ file: 'src/fix.ts', title: '바뀐 파일, 재현 안 됨' }),
      finding({ file: 'src/old.ts', title: '실행 못 함' }),
    ]),
    headSha: H2,
    changedSinceLastRound: ['src/fix.ts'],
    repro: new Map([
      [0, 'reproduced'],
      [1, 'not-reproduced'],
      [2, 'not-reproduced'],
      [3, 'error'],
    ]),
  });
  assert.deepEqual(
    l.findings.map((e) => [e.title, e.repro, e.status]),
    [
      ['재현됨', 'reproduced', 'open'],
      ['재현 안 됨', 'not-reproduced', 'deferred'],
      ['바뀐 파일, 재현 안 됨', 'not-reproduced', 'open'],
      ['실행 못 함', 'error', 'deferred'],
    ],
  );
  assert.match(renderLedger(l), /재현됨.*\| 재현됨 \| open/);
  // 이미 등록된 지적을 다시 내며 재현 결과가 오면 결과만 고친다
  const again = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/fix.ts', title: '바뀐 파일, 재현 안 됨' })]),
    headSha: H3,
    changedSinceLastRound: [],
    repro: new Map([[0, 'reproduced']]),
  });
  assert.deepEqual([byId(again, 'F3').repro, byId(again, 'F3').status], ['reproduced', 'open']);
});

/** 범위 밖 미룸의 처리 칸(Issue #262). 새 상수를 정적으로 가져오면 변경 전 코드에서 파일이 단언 전에 죽는다 */
const OUTSIDE = /^범위 밖: 직전 판정 이후 main 병합으로만 바뀐 파일의 새 P1이다/;

test('범위 밖(Issue #262): main 병합으로만 바뀐 파일의 새 P1은 재현돼도 deferred, P0은 open, 그 밖은 지금 규칙', () => {
  const l = applyVerdict(round1([]), {
    reviewer: 'claude',
    verdict: verdict([
      finding({ file: 'src/main-only.ts', title: '범위 밖 P1, 재현됨' }),
      finding({ file: 'src/main-only.ts', title: '범위 밖 P1, 재현 안 됨' }),
      finding({ file: 'src/main-only.ts', title: '범위 밖 P0', severity: 'P0' }),
      finding({ file: 'src/main-only.ts', title: '범위 밖 근거 없음', evidence: '' }),
      finding({ file: 'src/fix.ts', title: '바뀐 파일 P1' }),
      finding({ file: 'src/old.ts', title: '바뀌지 않은 파일, 재현됨' }),
      finding({ file: 'src/old.ts', title: '바뀌지 않은 파일, 재현 안 됨' }),
    ]),
    headSha: H2,
    changedSinceLastRound: ['src/fix.ts'],
    outsideSinceLastRound: ['src/main-only.ts'],
    repro: new Map([
      [0, 'reproduced'],
      [1, 'not-reproduced'],
      [5, 'reproduced'],
    ]),
  });
  assert.deepEqual(
    l.findings.map((e) => [e.title, e.severity, e.status, OUTSIDE.test(e.note)]),
    [
      ['범위 밖 P1, 재현됨', 'P1', 'deferred', true],
      ['범위 밖 P1, 재현 안 됨', 'P1', 'deferred', true],
      ['범위 밖 P0', 'P0', 'open', false],
      ['범위 밖 근거 없음', 'P2', 'deferred', false],
      ['바뀐 파일 P1', 'P1', 'open', false],
      ['바뀌지 않은 파일, 재현됨', 'P1', 'open', false],
      ['바뀌지 않은 파일, 재현 안 됨', 'P1', 'deferred', false],
    ],
  );
  assert.match(byId(l, 'F4').note, /근거 없음/);
  assert.match(byId(l, 'F7').note, /동결/);
  // 라운드와 상관없다: 그 검증자의 첫 판정이어도 목록에 있으면 범위 밖이다
  const first = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ file: 'src/main-only.ts', title: 'codex 첫 판정' })]),
    headSha: H2,
    changedSinceLastRound: null,
    outsideSinceLastRound: ['src/main-only.ts'],
  });
  assert.equal(first.findings.at(-1)?.status, 'deferred');
  assert.match(first.findings.at(-1)?.note ?? '', OUTSIDE);
  // 목록을 주지 않으면 지금 규칙: 첫 판정의 P1은 open
  const none = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ file: 'src/main-only.ts', title: 'codex 목록 없음' })]),
    headSha: H2,
    changedSinceLastRound: null,
  });
  assert.equal(none.findings.at(-1)?.status, 'open');
  // 이미 있는 지적은 바꾸지 않는다: 열린 F3(P0)·F5(P1)를 다시 내도 open 그대로다
  const again = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([
      finding({ file: 'src/main-only.ts', title: '범위 밖 P0', severity: 'P0' }),
      finding({ file: 'src/fix.ts', title: '바뀐 파일 P1' }),
    ]),
    headSha: H3,
    changedSinceLastRound: [],
    outsideSinceLastRound: ['src/fix.ts', 'src/main-only.ts'],
  });
  assert.deepEqual([byId(again, 'F3').status, byId(again, 'F5').status], ['open', 'open']);
  assert.equal(again.findings.length, l.findings.length);
});

test('ledgerStatus(Issue #262): 범위 밖 P1은 막지 않고 동결과 따로 센다', () => {
  const l = applyVerdict(round1([]), {
    reviewer: 'claude',
    verdict: verdict([
      finding({ file: 'src/main-only.ts', title: '범위 밖' }),
      finding({ file: 'src/old.ts', title: '동결' }),
    ]),
    headSha: H2,
    changedSinceLastRound: [],
    outsideSinceLastRound: ['src/main-only.ts'],
    repro: new Map([[0, 'reproduced']]),
  });
  const ok = ledgerStatus(l);
  assert.equal(ok.state, 'success');
  assert.equal(
    ok.description,
    '차단 지적 없음 (전체 2, 미룸 2, 그중 동결 P1 1, 그중 범위 밖 P1 1)',
  );
  // 열린 지적이 있어 실패할 때도 적는다
  const bad = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/fix.ts', title: '열림' })]),
    headSha: H3,
    changedSinceLastRound: ['src/fix.ts'],
  });
  const f = ledgerStatus(bad);
  assert.equal(f.state, 'failure');
  assert.match(f.description, /범위 밖 P1 1/);
});

// ---------- 계획 승인(G1, step4) ----------

const PH1 = 'a1'.repeat(32);
const PH2 = 'b2'.repeat(32);

test('applyPlanReview: 승인을 해시에 묶어 남기고, 해시가 바뀌면 이전 승인을 지운다', () => {
  const l0 = emptyLedger(BASE);
  const l1 = applyPlanReview(l0, { reviewer: 'codex', hash: PH1, headSha: H1, approved: true });
  assert.deepEqual(l1.planReview, { hash: PH1, head: H1, approvals: ['codex'] });
  // 입력은 바꾸지 않는다
  assert.equal(l0.planReview, undefined);
  // 다른 검증자가 같은 해시를 뒤 head에서 승인: 승인이 쌓이고 head는 마지막 승인의 것이다
  const l2 = applyPlanReview(l1, { reviewer: 'claude', hash: PH1, headSha: H2, approved: true });
  assert.deepEqual(l2.planReview, { hash: PH1, head: H2, approvals: ['claude', 'codex'] });
  // 같은 검증자가 다시 승인해도 한 번만 남는다
  const again = applyPlanReview(l2, { reviewer: 'claude', hash: PH1, headSha: H3, approved: true });
  assert.deepEqual(again.planReview?.approvals, ['claude', 'codex']);
  // 해시가 바뀌면 이전 승인은 모두 사라진다
  const l3 = applyPlanReview(l2, { reviewer: 'claude', hash: PH2, headSha: H3, approved: true });
  assert.deepEqual(l3.planReview, { hash: PH2, head: H3, approvals: ['claude'] });
});

test('applyPlanReview: 수정 요청은 그 검증자의 승인만 지우고, 판정이 없으면(error) 그대로 둔다', () => {
  let l = applyPlanReview(emptyLedger(BASE), {
    reviewer: 'claude',
    hash: PH1,
    headSha: H1,
    approved: true,
  });
  l = applyPlanReview(l, { reviewer: 'codex', hash: PH1, headSha: H1, approved: true });
  const rejected = applyPlanReview(l, {
    reviewer: 'codex',
    hash: PH1,
    headSha: H2,
    approved: false,
  });
  assert.deepEqual(rejected.planReview, { hash: PH1, head: H1, approvals: ['claude'] });
  const unknown = applyPlanReview(l, { reviewer: 'codex', hash: PH1, headSha: H2, approved: null });
  assert.deepEqual(unknown.planReview, l.planReview);
  // 해시가 바뀌었으면 판정이 없어도 옛 승인은 남기지 않는다
  const moved = applyPlanReview(l, { reviewer: 'codex', hash: PH2, headSha: H2, approved: null });
  assert.deepEqual(moved.planReview, { hash: PH2, head: H2, approvals: [] });
});

test('planReview: 원장 댓글에 왕복하고 표에 보인다. 없는 옛 원장도 읽고, 형식이 다르면 null', () => {
  const plain = round1([finding()]);
  // 이 필드가 생기기 전의 원장: 자료에 planReview가 없다
  assert.doesNotMatch(
    Buffer.from(renderLedger(plain).match(/data:([A-Za-z0-9+/=]+)/)![1], 'base64').toString(),
    /planReview/,
  );
  assert.deepEqual(parseLedger(renderLedger(plain)), plain);

  const l = applyPlanReview(plain, { reviewer: 'codex', hash: PH1, headSha: H2, approved: true });
  const body = renderLedger(l);
  assert.deepEqual(parseLedger(body), l);
  assert.match(body, new RegExp(`계획 검증\\(G1\\).*${PH1.slice(0, 12)}.*codex`));
  // 계획 승인은 review-ledger 판정을 바꾸지 않는다
  assert.deepEqual(ledgerStatus(l), ledgerStatus(plain));

  const data = (o: unknown) =>
    `<!-- harness-ledger-data:${Buffer.from(JSON.stringify(o)).toString('base64')} -->`;
  const pr = l.planReview!;
  for (const bad of [
    { ...pr, hash: PH1.slice(0, 40) },
    { ...pr, hash: PH1.toUpperCase() },
    { ...pr, head: 'abc' },
    { ...pr, approvals: ['gpt'] },
    { ...pr, approvals: ['codex', 'codex'] },
    { ...pr, approvals: 'codex' },
    { ...pr, extra: 1 },
    { hash: PH1, head: H1 },
    null,
    'x',
  ])
    assert.equal(parseLedger(data({ ...l, planReview: bad })), null, JSON.stringify(bad));
});

// ---------- 구현 대기(parked): 계획만 담은 head에서 판정할 수 없는 코드 지적 (Issue #212) ----------

const PLAN_FILE = 'docs/exec-plans/active/20261122-demo/step0.md';
const OPENED = '2026-11-22T01:00:00Z';
const PARK_NOTE = '구현 대기: 계획만 담은 head에서는 판정하지 않는다';
const UNPARK_NOTE = '구현이 올라와 다시 열림';
const entryOf = (over: Partial<Entry> = {}): Entry => ({
  id: 'F1',
  severity: 'P1',
  reviewer: 'codex',
  file: 'src/a.ts',
  line: 3,
  title: '코드 지적',
  repro: '',
  status: 'open',
  note: '',
  round: 1,
  rejectedBy: [],
  ...over,
});
const ledgerOf = (...findings: Entry[]): Ledger => ({
  ...emptyLedger(BASE),
  rounds: [
    { reviewer: 'codex', head: H1 },
    { reviewer: 'claude', head: H1 },
  ],
  findings,
});
const statuses = (l: Ledger) => l.findings.map((e) => `${e.id}:${e.status}`);
/** 숨은 자료를 직접 만든 댓글 본문 */
const rawBody = (raw: unknown) =>
  `<!-- harness-ledger-data:${Buffer.from(JSON.stringify(raw)).toString('base64')} -->`;

test('parkFor(계획만 담은 head): 계획 폴더 밖 파일에 대한 열린 지적만 구현 대기로 둔다', () => {
  const l = ledgerOf(
    entryOf({ id: 'F1', openedAt: OPENED }),
    entryOf({
      id: 'F2',
      severity: 'P0',
      rejectedBy: ['claude'],
      openedAt: OPENED,
      note: '전의 글',
    }),
    entryOf({ id: 'F3', file: PLAN_FILE }),
    entryOf({ id: 'F4', planRound: true }),
    entryOf({ id: 'F5', status: 'fixed' }),
    entryOf({ id: 'F6', status: 'rejected' }),
    entryOf({ id: 'F7', status: 'deferred' }),
    entryOf({ id: 'F8', status: 'accepted' }),
    // 계획 폴더와 이름만 비슷한 경로는 폴더 밖이다
    entryOf({ id: 'F9', file: 'docs/exec-plans-old/x.md' }),
    entryOf({ id: 'F10', file: 'xdocs/exec-plans/y.md' }),
  );
  const before = JSON.stringify(l);
  const p = parkFor(l, true);
  assert.deepEqual(statuses(p), [
    'F1:parked',
    'F2:parked',
    'F3:open',
    'F4:open',
    'F5:fixed',
    'F6:rejected',
    'F7:deferred',
    'F8:accepted',
    'F9:parked',
    'F10:parked',
  ]);
  assert.equal(byId(p, 'F1').note, PARK_NOTE);
  assert.equal(byId(p, 'F2').note, PARK_NOTE);
  // 그 밖의 필드는 그대로다
  assert.equal(byId(p, 'F1').openedAt, OPENED);
  assert.deepEqual(byId(p, 'F2').rejectedBy, ['claude']);
  assert.deepEqual({ ...byId(p, 'F1'), status: 'open', note: '' }, byId(l, 'F1'));
  assert.equal(JSON.stringify(parkFor(l, true).findings[2]), JSON.stringify(l.findings[2]));
  assert.equal(JSON.stringify(l), before, '입력은 바꾸지 않는다');
  // 둘 것이 없으면 내용이 같은 원장이다
  assert.equal(JSON.stringify(parkFor(p, true)), JSON.stringify(p));
  const none = ledgerOf(entryOf({ file: PLAN_FILE }), entryOf({ id: 'F2', status: 'fixed' }));
  assert.equal(JSON.stringify(parkFor(none, true)), JSON.stringify(none));
});

test('parkFor(코드가 섞인 head): 구현 대기를 모두 열림으로 되돌린다. 구현 대기가 없으면 같은 원장이다', () => {
  const l = ledgerOf(
    entryOf({ id: 'F1', status: 'parked', note: PARK_NOTE, openedAt: OPENED }),
    entryOf({ id: 'F2', severity: 'P0', status: 'parked', note: PARK_NOTE }),
    entryOf({ id: 'F3', status: 'fixed', note: 'abc1234' }),
    entryOf({ id: 'F4', status: 'deferred' }),
    entryOf({ id: 'F5', status: 'accepted' }),
  );
  const before = JSON.stringify(l);
  const u = parkFor(l, false);
  assert.deepEqual(statuses(u), ['F1:open', 'F2:open', 'F3:fixed', 'F4:deferred', 'F5:accepted']);
  assert.equal(byId(u, 'F1').note, UNPARK_NOTE);
  assert.equal(byId(u, 'F1').openedAt, OPENED);
  assert.equal(byId(u, 'F3').note, 'abc1234');
  assert.equal(JSON.stringify(l), before, '입력은 바꾸지 않는다');
  assert.equal(JSON.stringify(parkFor(u, false)), JSON.stringify(u));
  // 열린 코드 지적을 코드가 섞인 head에서 구현 대기로 두지 않는다
  const open = ledgerOf(entryOf({ openedAt: OPENED }));
  assert.equal(JSON.stringify(parkFor(open, false)), JSON.stringify(open));
});

test('parkFor: 두었다가 되돌리면 상태와 게시 시각이 처음과 같다', () => {
  const l = ledgerOf(
    entryOf({ id: 'F1', openedAt: OPENED }),
    entryOf({ id: 'F2', severity: 'P0' }),
    entryOf({ id: 'F3', file: PLAN_FILE, openedAt: OPENED }),
    entryOf({ id: 'F4', status: 'fixed' }),
  );
  const back = parkFor(parkFor(l, true), false);
  assert.deepEqual(
    back.findings.map((e) => [e.id, e.status, e.openedAt]),
    l.findings.map((e) => [e.id, e.status, e.openedAt]),
  );
  assert.equal(ledgerStatus(parkFor(l, true)).state, 'failure', '계획 파일의 지적 F3은 막는다');
  assert.equal(ledgerStatus(back).state, 'failure');
});

test('applyVerdict: 구현 대기인 지적은 판정(resolutions, 재등록)으로 바뀌지 않는다', () => {
  const parked = ledgerOf(
    entryOf({ id: 'F1', status: 'parked', note: PARK_NOTE, openedAt: OPENED }),
    entryOf({ id: 'F2', severity: 'P0', status: 'parked', note: PARK_NOTE }),
  );
  const by = (reviewer: 'claude' | 'codex', v: Verdict) =>
    applyVerdict(parked, { reviewer, verdict: v, headSha: H2, changedSinceLastRound: [] });
  for (const status of ['fixed', 'rejected', 'open'] as const) {
    const l = by('codex', verdict([], [{ id: 'F1', status, note: '판정' }]));
    assert.deepEqual(
      [byId(l, 'F1').status, byId(l, 'F1').note, byId(l, 'F1').openedAt],
      ['parked', PARK_NOTE, OPENED],
      status,
    );
  }
  // 남의 P0에 대한 rejected(동의)도 적지 않는다
  const agreed = by('claude', verdict([], [{ id: 'F2', status: 'rejected', note: '동의' }]));
  assert.deepEqual(byId(agreed, 'F2').rejectedBy, []);
  assert.equal(byId(agreed, 'F2').status, 'parked');
  const own = by('codex', verdict([], [{ id: 'F2', status: 'rejected', note: '철회' }]));
  assert.deepEqual([byId(own, 'F2').status, byId(own, 'F2').rejectedBy], ['parked', []]);
  // 같은 검증자·위치·제목의 지적을 다시 내도 새로 등록되지 않고 구현 대기로 남는다
  const again = by('codex', verdict([finding({ title: '코드 지적' })]));
  assert.deepEqual(statuses(again), ['F1:parked', 'F2:parked']);
  assert.equal(byId(again, 'F1').note, PARK_NOTE);
});

test('applyVerdict: 계획 전용 판정에서 새로 등록하는 지적에 planRound를 적는다. 등록 상태의 규칙은 그대로다', () => {
  const v = verdict([
    finding({ title: '새 P1' }),
    finding({ severity: 'P2', title: '새 P2' }),
    finding({ severity: 'P0', file: PLAN_FILE, title: '계획의 P0' }),
  ]);
  const o = { reviewer: 'claude' as const, verdict: v, headSha: H1, changedSinceLastRound: null };
  const plan = applyVerdict(emptyLedger(BASE), { ...o, planOnly: true });
  assert.deepEqual(
    plan.findings.map((e) => [e.id, e.status, e.planRound]),
    [
      ['F1', 'open', true],
      ['F2', 'deferred', true],
      ['F3', 'open', true],
    ],
  );
  for (const code of [
    applyVerdict(emptyLedger(BASE), o),
    applyVerdict(emptyLedger(BASE), { ...o, planOnly: false }),
  ]) {
    assert.deepEqual(statuses(code), ['F1:open', 'F2:deferred', 'F3:open']);
    assert.ok(
      code.findings.every((e) => !('planRound' in e)),
      '코드가 섞인 판정의 지적에는 필드가 없다',
    );
  }
  // 계획 전용 판정에서 등록된 지적은 위치가 코드 파일이어도 구현 대기로 두지 않는다
  assert.deepEqual(statuses(parkFor(plan, true)), ['F1:open', 'F2:deferred', 'F3:open']);
  // 2라운드부터의 동결은 계획 전용 판정에서도 같다: 바뀌지 않은 파일의 재현되지 않은 새 P1은 deferred다
  const second = applyVerdict(plan, {
    reviewer: 'claude',
    verdict: verdict([finding({ file: 'src/old.ts', title: '뒤늦은 P1' })]),
    headSha: H2,
    changedSinceLastRound: [],
    planOnly: true,
  });
  assert.deepEqual(
    [byId(second, 'F4').status, byId(second, 'F4').planRound, byId(second, 'F4').note],
    ['deferred', true, '동결: 직전 라운드 이후 바뀌지 않은 파일의 새 지적(10.2절 (5))'],
  );
  // 이미 있던 지적에는 적지 않는다
  assert.equal(
    'planRound' in byId(applyVerdict(round1([finding()]), { ...o, planOnly: true }), 'F1'),
    false,
  );
});

test('ledgerStatus: 구현 대기는 막지 않고 수를 적는다. 구현 대기가 없으면 설명이 전과 같다', () => {
  const parked = ledgerOf(
    entryOf({ id: 'F1', status: 'parked' }),
    entryOf({ id: 'F2', severity: 'P0', status: 'parked' }),
  );
  const only = ledgerStatus(parked);
  assert.equal(only.state, 'success');
  assert.equal(only.description, '차단 지적 없음 (전체 2, 미룸 0, 구현 대기 2)');
  const mixed = ledgerStatus(
    ledgerOf(
      entryOf({ id: 'F1', file: PLAN_FILE }),
      entryOf({ id: 'F2', status: 'parked' }),
      entryOf({ id: 'F3', status: 'accepted' }),
    ),
  );
  assert.equal(mixed.state, 'failure');
  assert.equal(mixed.description, '열린 차단 지적 1건: F1, 제작자 승인 1, 구현 대기 1');
  // 구현 대기가 없는 원장의 설명은 글자 그대로 전과 같다
  assert.equal(
    ledgerStatus(ledgerOf(entryOf({ status: 'fixed' }), entryOf({ id: 'F2', status: 'deferred' })))
      .description,
    '차단 지적 없음 (전체 2, 미룸 1, 그중 동결 P1 1)',
  );
  assert.equal(
    ledgerStatus(ledgerOf(entryOf({ status: 'accepted' }))).description,
    '차단 지적 없음 (전체 1, 미룸 0, 제작자 승인 1)',
  );
  assert.equal(ledgerStatus(ledgerOf(entryOf())).description, '열린 차단 지적 1건: F1');
});

test('형식: parked와 planRound가 댓글에 실리고 다시 읽힌다. 다른 값의 planRound와 모르는 상태는 거부한다', () => {
  const l = ledgerOf(
    entryOf({ id: 'F1', status: 'parked', note: PARK_NOTE, openedAt: OPENED }),
    entryOf({ id: 'F2', planRound: true }),
    entryOf({ id: 'F3', status: 'fixed' }),
  );
  const body = renderLedger(l);
  assert.deepEqual(parseLedger(body), l);
  // 표의 상태 칸은 값 그대로 보인다
  assert.match(body, /^\| F1 \| P1 \| codex \| .* \| parked \| /m);
  const raw = (over: Record<string, unknown>) =>
    rawBody({ ...l, findings: [{ ...entryOf(), ...over }] });
  assert.ok(parseLedger(raw({})), '필드가 없는 지금의 원장은 그대로 읽힌다');
  assert.ok(parseLedger(raw({ planRound: true })));
  assert.ok(parseLedger(raw({ status: 'parked' })));
  assert.equal(parseLedger(raw({ planRound: false })), null);
  assert.equal(parseLedger(raw({ planRound: 1 })), null);
  assert.equal(parseLedger(raw({ planRound: 'true' })), null);
  assert.equal(parseLedger(raw({ planRound: null })), null);
  assert.equal(parseLedger(raw({ status: 'paused' })), null);
});
