// 발산 판정(10.2절 (7)). 계획 20261115-runner-pr-flow step5.
// 대응을 push한 뒤의 원장으로 "수렴하지 않은 라운드"인지 본다: 새 차단 지적 > 해소, 회귀, 같은 위치.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyVerdict, emptyLedger, type Ledger, type Reviewer } from '../ci/ledger.ts';
import type { Finding, Resolution, Severity } from '../ci/verdict.ts';
import { divergence, type RoundBefore } from '../runner/divergence.ts';

const BASE = 'a'.repeat(40);
const H1 = '1'.repeat(40);

const finding = (severity: Severity, file: string, line: number, title: string): Finding => ({
  severity,
  file,
  line,
  title,
  evidence: '근거',
  suggestion: '제안',
  repro: { path: '', content: '' },
});

function judged(
  l: Ledger,
  reviewer: Reviewer,
  head: string,
  findings: Finding[],
  resolutions: Resolution[] = [],
  changed: string[] | null = findings.map((f) => f.file),
): Ledger {
  return applyVerdict(l, {
    reviewer,
    verdict: { verdict: 'request_changes', risk: 'normal', summary: '요약', findings, resolutions },
    headSha: head,
    changedSinceLastRound: changed,
  });
}

/** 대응 전: codex가 F1(a.ts:1)·F2(b.ts:2)를 열었다 */
const start = () =>
  judged(emptyLedger(BASE), 'codex', BASE, [
    finding('P1', 'src/a.ts', 1, '첫째'),
    finding('P1', 'src/b.ts', 2, '둘째'),
  ]);
const before: RoundBefore = {
  open: [
    { id: 'F1', file: 'src/a.ts', line: 1 },
    { id: 'F2', file: 'src/b.ts', line: 2 },
  ],
  maxId: 2,
  head: H1,
};
const fixed = (id: string): Resolution => ({ id, status: 'fixed', note: '' });
const open = (id: string): Resolution => ({ id, status: 'open', note: '' });

test('divergence: 대응한 지적이 닫히고 새 차단 지적이 없으면 수렴이다', () => {
  const after = judged(start(), 'codex', H1, [], [fixed('F1'), fixed('F2')]);
  assert.deepEqual(divergence(before, after), { diverged: false, signals: [] });
  // 아직 열려 있기만 한 것은 발산 신호가 아니다(F<번호> 실패로 센다)
  const still = judged(start(), 'codex', H1, [], [fixed('F1'), open('F2')]);
  assert.equal(divergence(before, still).diverged, false);
});

test('divergence: 새로 열린 차단 지적이 해소된 차단 지적보다 많으면 발산이다. 수가 같으면 아니다', () => {
  const two = judged(
    start(),
    'codex',
    H1,
    [finding('P1', 'src/c.ts', 3, '새 하나'), finding('P0', 'src/d.ts', 4, '새 둘')],
    [fixed('F1'), open('F2')],
  );
  const d = divergence(before, two);
  assert.equal(d.diverged, true);
  assert.equal(d.signals.length, 1);
  assert.match(d.signals[0], /새 차단 지적 2건\(F3, F4\).*해소 1건/);
  const same = judged(
    start(),
    'codex',
    H1,
    [finding('P1', 'src/c.ts', 3, '새 하나')],
    [fixed('F1'), open('F2')],
  );
  assert.equal(divergence(before, same).diverged, false, '새 1건, 해소 1건');
  // rejected도 해소다
  const rejected = judged(
    start(),
    'codex',
    H1,
    [finding('P1', 'src/c.ts', 3, '새 하나'), finding('P1', 'src/d.ts', 4, '새 둘')],
    [fixed('F1'), { id: 'F2', status: 'rejected', note: '' }],
  );
  assert.equal(divergence(before, rejected).diverged, false, '새 2건, 해소 2건');
});

test('divergence: 동결돼 deferred로 등록된 새 P1과 P2·P3은 세지 않는다', () => {
  // 2라운드에 바뀌지 않은 파일의 새 P1은 동결된다(deferred)
  const after = judged(
    start(),
    'codex',
    H1,
    [
      finding('P1', 'src/x.ts', 1, '동결될 P1'),
      finding('P1', 'src/y.ts', 1, '동결될 P1 둘'),
      finding('P2', 'src/a.ts', 9, '개선'),
    ],
    [open('F1'), open('F2')],
    [],
  );
  assert.deepEqual(
    after.findings.slice(2).map((e) => e.status),
    ['deferred', 'deferred', 'deferred'],
  );
  assert.deepEqual(divergence(before, after), { diverged: false, signals: [] });
});

test('divergence: 대응 전에는 닫혀 있다가 다시 열린 지적을 새 차단 지적으로 센다', () => {
  // 대응 전: F1은 이미 fixed였고 열린 것은 F2뿐이다
  let l = judged(start(), 'codex', '2'.repeat(40), [], [fixed('F1'), open('F2')]);
  const b: RoundBefore = { open: [{ id: 'F2', file: 'src/b.ts', line: 2 }], maxId: 2, head: H1 };
  // 대응 뒤: 검증자가 F1을 다시 냈다(회귀로 다시 열림). F2는 그대로 열려 있다
  l = judged(l, 'codex', H1, [finding('P1', 'src/a.ts', 1, '첫째')], [open('F2')]);
  assert.equal(l.findings[0].status, 'open');
  const d = divergence(b, l);
  assert.equal(d.diverged, true);
  assert.match(d.signals[0], /새 차단 지적 1건\(F1\).*해소 0건/);
});

test('divergence: 대응 head의 check 실패 기록이 원장에 있으면 회귀다', () => {
  const after: Ledger = {
    ...judged(start(), 'codex', H1, [], [fixed('F1'), fixed('F2')]),
    ciFailures: [{ head: H1, run: 'https://github.com/o/r/actions/runs/1' }],
  };
  const d = divergence(before, after);
  assert.equal(d.diverged, true);
  assert.equal(d.signals.length, 1);
  assert.match(d.signals[0], /check.*실패/);
  // 다른 head의 실패 기록은 이 라운드의 회귀가 아니다
  const other: Ledger = { ...after, ciFailures: [{ head: BASE, run: 'x' }] };
  assert.equal(divergence(before, other).diverged, false);
});

test('divergence: 대응 전 열린 차단 지적과 같은 위치에 새 차단 지적이 열리면 발산이다(수가 같아도)', () => {
  const after = judged(
    start(),
    'codex',
    H1,
    [finding('P1', 'src/b.ts', 2, '같은 자리의 다른 지적')],
    [fixed('F1'), fixed('F2')],
  );
  const d = divergence(before, after);
  assert.equal(d.diverged, true, '새 1건, 해소 2건이지만 같은 위치다');
  assert.equal(d.signals.length, 1);
  assert.match(d.signals[0], /같은 위치.*F3/);
  // 신호 글에는 검증자 출력(파일 경로, 제목)을 넣지 않는다: 실패 기록과 진행 로그에 들어간다
  assert.doesNotMatch(d.signals.join(' '), /src\/b\.ts|같은 자리/);
  // 줄이 다르면 같은 위치가 아니다. 위치 없는 지적끼리는 같은 위치로 보지 않는다
  const near = judged(
    start(),
    'codex',
    H1,
    [finding('P1', 'src/b.ts', 3, '옆 줄')],
    [fixed('F1'), fixed('F2')],
  );
  assert.equal(divergence(before, near).diverged, false);
  const nowhere = judged(emptyLedger(BASE), 'codex', H1, [
    finding('P0', '', 0, '위치 없는 새 지적'),
  ]);
  assert.equal(
    divergence(
      { open: [{ id: 'F9', file: '', line: 0 }], maxId: 0, head: H1 },
      nowhere,
    ).signals.some((s) => /같은 위치/.test(s)),
    false,
  );
});

test('divergence: 신호가 여럿이면 모두 적는다', () => {
  const after: Ledger = {
    ...judged(
      start(),
      'codex',
      H1,
      [finding('P1', 'src/a.ts', 1, '같은 자리'), finding('P1', 'src/z.ts', 1, '새 둘')],
      [open('F1'), open('F2')],
    ),
    ciFailures: [{ head: H1, run: 'x' }],
  };
  // 같은 자리·같은 제목이 아니면 새 지적이다(같은 제목이면 원장이 중복으로 본다)
  const d = divergence(before, after);
  assert.equal(d.diverged, true);
  assert.equal(d.signals.length, 3);
});
