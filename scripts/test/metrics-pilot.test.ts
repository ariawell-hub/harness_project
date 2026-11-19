// metrics(17.2절 파일럿 판정 지표): 기간, GitHub 자료 읽기, 지표 계산, 렌더. 계획 20261119-metrics step0.
// 지표는 파일럿 판정의 근거다. 자료를 일부만 읽고 낸 값이나 서로 다른 사건을 합친 값이 나오지 않는 것을 본다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLedger, type Entry, type Ledger } from '../ci/ledger.ts';
import { loadConfig } from '../lib/config.ts';
import { pilotMetrics, type PilotInput } from '../metrics/pilot.ts';
import { BEGIN, END, renderBlock, replaceBlock } from '../metrics/render.ts';
import {
  SourceError,
  ghSource,
  inPeriod,
  parsePeriod,
  type MergedPr,
  type Period,
  type WorkflowRun,
} from '../metrics/source.ts';
import { HARNESS_ROOT } from './helpers.ts';

const CFG = loadConfig(HARNESS_ROOT);
const P: Period = { since: '2026-11-11', until: '2026-11-12' };
const CHECK = '.github/workflows/check.yml';
const JUDGE_CLAUDE = '.github/workflows/judge-claude.yml';
const JUDGE_CODEX = '.github/workflows/judge-codex.yml';

function pr(number: number, over: Partial<MergedPr> = {}): MergedPr {
  return {
    number,
    head: `feat/x-s${number}`,
    headSha: `h${number}`,
    createdAt: '2026-11-11T01:00:00Z',
    mergedAt: '2026-11-11T02:00:00Z',
    mergeSha: `m${number}`,
    additions: 10,
    deletions: 2,
    ...over,
  };
}

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    path: CHECK,
    event: 'push',
    branch: 'main',
    headSha: 'sha',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-11-11T03:00:00Z',
    startedAt: '2026-11-11T03:00:00Z',
    updatedAt: '2026-11-11T03:10:00Z',
    attempt: 1,
    ...over,
  };
}

function finding(id: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    severity: 'P1',
    reviewer: 'codex',
    file: 'a.ts',
    line: 1,
    title: `제목-${id}`,
    repro: '',
    status: 'fixed',
    note: '',
    round: 1,
    rejectedBy: [],
    ...over,
  };
}

function ledger(findings: Entry[], rounds = 0): Ledger {
  const l = emptyLedger('base');
  l.findings = findings;
  l.rounds = Array.from({ length: rounds }, (_, i) => ({
    reviewer: i % 2 ? ('codex' as const) : ('claude' as const),
    head: `r${i}`,
  }));
  return l;
}

function input(over: Partial<PilotInput> = {}): PilotInput {
  return {
    period: P,
    defaultBranch: 'main',
    priorMainCheck: 'success',
    prs: [],
    runs: [],
    bugs: [],
    ledgers: new Map(),
    ...over,
  };
}

// ── 기간 ──

test('parsePeriod: 기본값은 now의 UTC 날짜까지 7일(양끝 포함)이다', () => {
  // 한국 시각으로는 11-20이지만 UTC로는 11-19다
  const now = new Date('2026-11-19T23:30:00Z');
  assert.deepEqual(parsePeriod(undefined, undefined, now), {
    since: '2026-11-13',
    until: '2026-11-19',
  });
  assert.deepEqual(parsePeriod(undefined, '2026-11-10', now), {
    since: '2026-11-04',
    until: '2026-11-10',
  });
  assert.deepEqual(parsePeriod('2026-11-11', undefined, now), {
    since: '2026-11-11',
    until: '2026-11-19',
  });
  assert.deepEqual(parsePeriod('2026-11-19', '2026-11-19', now), {
    since: '2026-11-19',
    until: '2026-11-19',
  });
});

test('parsePeriod: 형식이 틀리거나 없는 날짜이거나 순서가 뒤집히면 예외다(SourceError가 아니다)', () => {
  const now = new Date('2026-11-19T00:00:00Z');
  for (const [since, until] of [
    ['2026-13-01', undefined],
    ['2026-02-30', undefined],
    ['20261111', undefined],
    ['2026-11-11T00:00:00Z', undefined],
    [undefined, 'yesterday'],
    ['2026-11-12', '2026-11-11'],
  ] as const) {
    assert.throws(
      () => parsePeriod(since, until, now),
      (e: unknown) => e instanceof Error && !(e instanceof SourceError),
      `${since} ~ ${until}`,
    );
  }
});

test('inPeriod: since 00:00Z 이상, until 다음 날 00:00Z 미만이다', () => {
  assert.equal(inPeriod('2026-11-11T00:00:00Z', P), true);
  assert.equal(inPeriod('2026-11-10T23:59:59Z', P), false);
  assert.equal(inPeriod('2026-11-12T23:59:59Z', P), true);
  assert.equal(inPeriod('2026-11-13T00:00:00Z', P), false);
  // 시간대가 붙은 시각은 UTC로 바꿔 본다: 한국 11-11 08:00은 UTC 11-10 23:00이다
  assert.equal(inPeriod('2026-11-11T08:00:00+09:00', P), false);
  assert.equal(inPeriod('깨진 값', P), false);
});

// ── ghSource ──

interface Fake {
  calls: string[][];
  gh: (args: string[]) => string;
}

let runId = 1000;
/** 실행 목록 응답의 한 줄. id는 줄마다 다르다(주면 그 값) */
const runLine = (over: Partial<WorkflowRun> = {}, id = runId++) =>
  JSON.stringify({ id, ...run(over) });

/** 호출을 기록하고 고정 응답을 돌려주는 gh. runs는 날짜 → 응답 줄 */
function fakeGh(o: { prs?: unknown; issues?: unknown; runs?: Record<string, string[]> }): Fake {
  const calls: string[][] = [];
  return {
    calls,
    gh(args) {
      calls.push(args);
      if (args[0] === 'pr') return JSON.stringify(o.prs ?? []);
      if (args[0] === 'issue') return JSON.stringify(o.issues ?? []);
      const day = /created=(\d{4}-\d{2}-\d{2})/.exec(args.join(' '))?.[1] ?? '';
      const lines = o.runs?.[day] ?? [JSON.stringify({ total: 0 })];
      return lines.join('\n') + '\n';
    },
  };
}

const source = (f: Fake, led: (pr: number) => Ledger | null = () => null) =>
  ghSource({ cfg: CFG, gh: f.gh, ledger: led });

const rawPr = (number: number, mergedAt: string) => ({
  number,
  headRefName: `feat/x-s${number}`,
  headRefOid: `h${number}`,
  createdAt: '2026-11-10T01:00:00Z',
  mergedAt,
  mergeCommit: { oid: `m${number}` },
  additions: 7,
  deletions: 3,
});

test('ghSource.mergedPrs: 기본 브랜치에 병합된 PR을 읽어 형을 바꾸고 기간 밖은 뺀다', () => {
  const f = fakeGh({
    prs: [
      rawPr(1, '2026-11-11T00:00:00Z'),
      rawPr(2, '2026-11-13T00:00:00Z'),
      { ...rawPr(3, '2026-11-12T10:00:00Z'), mergeCommit: null },
    ],
  });
  assert.deepEqual(source(f).mergedPrs(P), [
    {
      number: 1,
      head: 'feat/x-s1',
      headSha: 'h1',
      createdAt: '2026-11-10T01:00:00Z',
      mergedAt: '2026-11-11T00:00:00Z',
      mergeSha: 'm1',
      additions: 7,
      deletions: 3,
    },
    {
      number: 3,
      head: 'feat/x-s3',
      headSha: 'h3',
      createdAt: '2026-11-10T01:00:00Z',
      mergedAt: '2026-11-12T10:00:00Z',
      mergeSha: '',
      additions: 7,
      deletions: 3,
    },
  ]);
  const a = f.calls[0];
  assert.deepEqual(a.slice(0, 2), ['pr', 'list']);
  assert.equal(a[a.indexOf('--state') + 1], 'merged');
  assert.equal(a[a.indexOf('--base') + 1], CFG.github.defaultBranch);
  // 종료일 뒤의 PR이 쌓여도 상한에 닿지 않게 검색을 기간으로 좁힌다. 끝은 하루 넉넉히 잡고 받은 뒤에 다시 거른다
  assert.equal(a[a.indexOf('--search') + 1], 'merged:2026-11-11..2026-11-13');
  assert.equal(a[a.indexOf('--limit') + 1], '1000');
});

test('ghSource.workflowRuns: 날짜마다 따로 읽고 total_count와 견준다', () => {
  const f = fakeGh({
    runs: {
      '2026-11-11': [
        JSON.stringify({ total: 2 }),
        runLine({ createdAt: '2026-11-11T03:00:00Z' }),
        // 둘째 페이지도 머리 줄을 낸다
        JSON.stringify({ total: 2 }),
        runLine({ createdAt: '2026-11-11T04:00:00Z', conclusion: 'failure', attempt: 2 }),
      ],
      '2026-11-12': [JSON.stringify({ total: 0 })],
    },
  });
  const runs = source(f).workflowRuns(P);
  assert.deepEqual(
    runs.map((r) => [r.createdAt, r.conclusion, r.attempt, r.path, r.event, r.branch]),
    [
      ['2026-11-11T03:00:00Z', 'success', 1, CHECK, 'push', 'main'],
      ['2026-11-11T04:00:00Z', 'failure', 2, CHECK, 'push', 'main'],
    ],
  );
  const days = f.calls.map((a) => /created=(\d{4}-\d{2}-\d{2})/.exec(a.join(' '))?.[1]);
  assert.deepEqual(days, ['2026-11-11', '2026-11-12']);
  for (const a of f.calls) {
    assert.equal(a[0], 'api');
    assert.ok(a.includes('--paginate'));
  }
});

test('ghSource.workflowRuns: 진행 중인 실행의 빈 결론은 빈 문자열이다', () => {
  const f = fakeGh({
    runs: {
      '2026-11-11': [
        JSON.stringify({ total: 1 }),
        JSON.stringify({ id: 1, ...run(), status: 'in_progress', conclusion: null }),
      ],
    },
  });
  const [r] = source(f).workflowRuns({ since: '2026-11-11', until: '2026-11-11' });
  assert.equal(r.status, 'in_progress');
  assert.equal(r.conclusion, '');
});

test('ghSource.workflowRuns: 다 읽었는지 알 수 없으면 SourceError다', () => {
  const day = { since: '2026-11-11', until: '2026-11-11' };
  const lines = (total: number, n: number) => [
    JSON.stringify({ total }),
    ...Array.from({ length: n }, () => runLine()),
  ];
  // 받은 수가 total_count와 다르다
  assert.throws(
    () => source(fakeGh({ runs: { '2026-11-11': lines(3, 2) } })).workflowRuns(day),
    SourceError,
  );
  // 받은 수와 total_count가 모두 1000이다: 상한에 닿았다
  assert.throws(
    () => source(fakeGh({ runs: { '2026-11-11': lines(1000, 1000) } })).workflowRuns(day),
    SourceError,
  );
  // total_count가 상한을 넘는다
  assert.throws(
    () => source(fakeGh({ runs: { '2026-11-11': lines(1200, 1000) } })).workflowRuns(day),
    SourceError,
  );
  // 머리 줄이 없다
  assert.throws(
    () => source(fakeGh({ runs: { '2026-11-11': [runLine()] } })).workflowRuns(day),
    SourceError,
  );
  // 페이지 경계에서 한 실행이 두 번 오고 다른 실행이 빠졌다: 수는 total_count와 같아도 다 읽은 것이 아니다
  const dup = [
    JSON.stringify({ total: 3 }),
    runLine({}, 1),
    runLine({}, 2),
    JSON.stringify({ total: 3 }),
    runLine({ conclusion: 'failure' }, 2),
  ];
  assert.throws(
    () => source(fakeGh({ runs: { '2026-11-11': dup } })).workflowRuns(day),
    (e: unknown) => e instanceof SourceError && /중복/.test(e.message),
  );
  // 실행 id가 없는 줄은 읽지 못한 것이다
  assert.throws(
    () =>
      source(
        fakeGh({ runs: { '2026-11-11': [JSON.stringify({ total: 1 }), JSON.stringify(run())] } }),
      ).workflowRuns(day),
    SourceError,
  );
  // 999건은 읽는다
  assert.equal(
    source(fakeGh({ runs: { '2026-11-11': lines(999, 999) } })).workflowRuns(day).length,
    999,
  );
});

test('ghSource: PR·Issue 수가 상한(1000)이면 SourceError다', () => {
  const many = Array.from({ length: 1000 }, (_, i) => rawPr(i + 1, '2026-11-11T00:00:00Z'));
  assert.throws(() => source(fakeGh({ prs: many })).mergedPrs(P), SourceError);
  assert.equal(source(fakeGh({ prs: many.slice(0, 999) })).mergedPrs(P).length, 999);
  const issues = Array.from({ length: 1000 }, (_, i) => ({
    number: i + 1,
    createdAt: '2026-11-11T00:00:00Z',
  }));
  assert.throws(() => source(fakeGh({ issues })).bugIssues(P), SourceError);
});

test('ghSource.bugIssues: bug 라벨 Issue를 읽고 기간 밖은 뺀다', () => {
  const f = fakeGh({
    issues: [
      { number: 5, createdAt: '2026-11-12T23:00:00Z' },
      { number: 6, createdAt: '2026-11-13T00:00:00Z' },
    ],
  });
  assert.deepEqual(source(f).bugIssues(P), [{ number: 5, createdAt: '2026-11-12T23:00:00Z' }]);
  const a = f.calls[0];
  assert.deepEqual(a.slice(0, 2), ['issue', 'list']);
  assert.equal(a[a.indexOf('--label') + 1], 'bug');
  assert.equal(a[a.indexOf('--state') + 1], 'all');
  assert.equal(a[a.indexOf('--search') + 1], 'created:2026-11-11..2026-11-13');
});

test('ghSource: gh·ledger 함수의 예외와 읽지 못한 응답은 SourceError가 된다', () => {
  const boom = () => {
    throw new Error('gh: HTTP 502');
  };
  const s = ghSource({ cfg: CFG, gh: boom, ledger: boom });
  assert.throws(() => s.mergedPrs(P), SourceError);
  assert.throws(() => s.workflowRuns(P), SourceError);
  assert.throws(() => s.bugIssues(P), SourceError);
  assert.throws(() => s.ledger(1), SourceError);
  // JSON이 아니다, 배열이 아니다, 필드의 형이 다르다
  assert.throws(
    () => ghSource({ cfg: CFG, gh: () => '<html>', ledger: () => null }).mergedPrs(P),
    SourceError,
  );
  assert.throws(() => source(fakeGh({ prs: { message: 'x' } })).mergedPrs(P), SourceError);
  assert.throws(
    () =>
      source(fakeGh({ prs: [{ ...rawPr(1, '2026-11-11T00:00:00Z'), number: '1' }] })).mergedPrs(P),
    SourceError,
  );
  assert.throws(() => source(fakeGh({ prs: [rawPr(1, '언젠가')] })).mergedPrs(P), SourceError);
  assert.throws(
    () => source(fakeGh({ issues: [{ number: 1, createdAt: 3 }] })).bugIssues(P),
    SourceError,
  );
  assert.throws(
    () =>
      source(
        fakeGh({ runs: { '2026-11-11': [JSON.stringify({ total: 1 }), '{"path": 3}'] } }),
      ).workflowRuns(P),
    SourceError,
  );
});

test('ghSource.ledger: 받은 함수를 PR 번호로 부른다', () => {
  const l = ledger([finding('F1')]);
  const seen: number[] = [];
  const s = source(fakeGh({}), (n) => {
    seen.push(n);
    return n === 7 ? l : null;
  });
  assert.equal(s.ledger(7), l);
  assert.equal(s.ledger(8), null);
  assert.deepEqual(seen, [7, 8]);
});

test('ghSource: 모든 호출이 읽기 요청이다', () => {
  const f = fakeGh({});
  const s = source(f);
  s.mergedPrs(P);
  s.workflowRuns(P);
  s.bugIssues(P);
  assert.equal(f.calls.length, 4);
  const WRITE = ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input'];
  for (const a of f.calls) {
    const head = a.slice(0, 2).join(' ');
    assert.ok(head === 'pr list' || head === 'issue list' || a[0] === 'api', a.join(' '));
    for (const w of WRITE) assert.ok(!a.includes(w), `${w}: ${a.join(' ')}`);
    assert.ok(!a.some((x) => /^(-X|--method=|--field=|--raw-field=|--input=)/.test(x)));
    if (a[0] === 'api') {
      // --paginate, --jq <식>, 경로뿐이다
      const rest = a.slice(1).filter((x, i, all) => x !== '--paginate' && all[i - 1] !== '--jq');
      assert.deepEqual(
        rest.filter((x) => x !== '--jq').map((x) => x.split('?')[0]),
        ['repos/{owner}/{repo}/actions/runs'],
      );
    }
  }
});

// ── pilotMetrics ──

test('pilotMetrics: main check 실패와 재실행 뒤 통과를 따로 센다', () => {
  const m = pilotMetrics(
    input({
      runs: [
        run({ conclusion: 'failure', createdAt: '2026-11-11T01:00:00Z' }),
        run({ conclusion: 'success', attempt: 2, createdAt: '2026-11-11T02:00:00Z' }),
        run({ conclusion: 'success', createdAt: '2026-11-11T03:00:00Z' }),
        // 아래는 main check가 아니거나 조건 밖이다
        run({ conclusion: 'failure', event: 'pull_request', branch: 'feat/x' }),
        run({ conclusion: 'failure', branch: 'feat/x' }),
        run({ conclusion: 'failure', path: JUDGE_CODEX, event: 'workflow_run' }),
        run({ conclusion: 'failure', createdAt: '2026-11-13T00:00:00Z' }),
        run({ conclusion: '', status: 'in_progress' }),
      ],
    }),
  );
  assert.equal(m.defects.mainCheckFailures, 1);
  assert.equal(m.defects.passedAfterRerun, 1);
});

test('pilotMetrics: revert PR과 버그 Issue는 번호로 낸다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(1), pr(2, { head: 'revert/abc123' }), pr(3, { head: 'feat/revert-button-s0' })],
      bugs: [
        { number: 41, createdAt: '2026-11-11T05:00:00Z' },
        { number: 33, createdAt: '2026-11-12T05:00:00Z' },
      ],
    }),
  );
  assert.deepEqual(m.defects.revertPrs, [2]);
  assert.deepEqual(m.defects.bugIssues, [33, 41]);
  assert.equal(m.mergedPrs, 3);
});

test('pilotMetrics: 검증 누락은 실패로 바뀐 실행의 원인 PR만 센다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(1), pr(2), pr(3)],
      bugs: [{ number: 41, createdAt: '2026-11-11T05:00:00Z' }],
      runs: [
        run({ createdAt: '2026-11-11T01:00:00Z', conclusion: 'success', headSha: 'm1' }),
        // 성공 → 실패: PR 2가 원인
        run({ createdAt: '2026-11-11T02:00:00Z', conclusion: 'failure', headSha: 'm2' }),
        // 이어진 실패: PR 3은 세지 않는다
        run({ createdAt: '2026-11-11T03:00:00Z', conclusion: 'failure', headSha: 'm3' }),
        run({ createdAt: '2026-11-11T04:00:00Z', conclusion: 'success', headSha: 'x' }),
        // 성공 → 실패인데 원인 PR이 없다
        run({ createdAt: '2026-11-11T05:00:00Z', conclusion: 'failure', headSha: 'direct' }),
        // 취소된 실행은 순서에 넣지 않는다
        run({ createdAt: '2026-11-11T05:30:00Z', conclusion: 'cancelled', headSha: 'm1' }),
        run({ createdAt: '2026-11-11T06:00:00Z', conclusion: 'success', headSha: 'y' }),
        // 같은 PR의 병합 커밋에서 다시 실패로 바뀌어도 PR은 한 번만 센다
        run({ createdAt: '2026-11-11T07:00:00Z', conclusion: 'failure', headSha: 'm2' }),
      ],
    }),
  );
  assert.deepEqual(m.missed.prs, [2]);
  assert.equal(m.missed.unattributed, 1);
  assert.equal(m.missed.unknownTransition, 0);
  assert.equal(m.defects.mainCheckFailures, 4);
});

test('pilotMetrics: 실행은 받은 순서가 아니라 createdAt 순으로 본다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(2)],
      runs: [
        run({ createdAt: '2026-11-11T02:00:00Z', conclusion: 'failure', headSha: 'm2' }),
        run({ createdAt: '2026-11-11T01:00:00Z', conclusion: 'failure', headSha: 'other' }),
      ],
      priorMainCheck: 'success',
    }),
  );
  // 먼저 실패한 것은 other(원인 PR 없음)이고, m2는 이어진 실패다
  assert.deepEqual(m.missed.prs, []);
  assert.equal(m.missed.unattributed, 1);
});

test('pilotMetrics: 기간 첫 실행의 실패는 기간 직전 결론으로 가른다', () => {
  const runs = [run({ createdAt: '2026-11-11T00:10:00Z', conclusion: 'failure', headSha: 'm1' })];
  const prs = [pr(1)];
  // 자정(UTC)을 사이에 둔 연속 실패: 검증 누락이 아니다
  const cont = pilotMetrics(input({ prs, runs, priorMainCheck: 'failure' }));
  assert.deepEqual(cont.missed.prs, []);
  assert.equal(cont.missed.unknownTransition, 0);
  assert.equal(cont.missed.unattributed, 0);
  // 기간 전 성공 뒤의 첫 실패: 검증 누락이다
  const turned = pilotMetrics(input({ prs, runs, priorMainCheck: 'success' }));
  assert.deepEqual(turned.missed.prs, [1]);
  // 직전 결론을 모른다: 따로 센다
  const unknown = pilotMetrics(input({ prs, runs, priorMainCheck: null }));
  assert.deepEqual(unknown.missed.prs, []);
  assert.equal(unknown.missed.unknownTransition, 1);
  assert.equal(unknown.missed.unattributed, 0);
  // 세 경우 모두 실패 수는 같다
  for (const m of [cont, turned, unknown]) assert.equal(m.defects.mainCheckFailures, 1);
});

test('pilotMetrics: 직전 결론을 모르는 첫 실패 뒤의 실패는 이어진 실패다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(1), pr(2)],
      priorMainCheck: null,
      runs: [
        run({ createdAt: '2026-11-11T01:00:00Z', conclusion: 'failure', headSha: 'm1' }),
        run({ createdAt: '2026-11-11T02:00:00Z', conclusion: 'failure', headSha: 'm2' }),
      ],
    }),
  );
  assert.deepEqual(m.missed.prs, []);
  assert.equal(m.missed.unknownTransition, 1);
});

test('pilotMetrics: mergeSha가 빈 PR은 빈 headSha의 실행과 이어지지 않는다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(1, { mergeSha: '' })],
      runs: [run({ conclusion: 'failure', headSha: '' })],
    }),
  );
  assert.deepEqual(m.missed.prs, []);
  assert.equal(m.missed.unattributed, 1);
});

test('pilotMetrics: 오탐은 차단 지적(P0·P1, 동결 제외) 가운데 재현 안 됨과 rejected의 합집합이다', () => {
  const ledgers = new Map<number, Ledger | null>([
    [
      1,
      ledger([
        finding('F1', { status: 'fixed' }),
        finding('F2', { status: 'rejected' }),
        finding('F3', { repro: 'not-reproduced', status: 'fixed' }),
        // 겹친 지적은 한 번만 센다
        finding('F4', { repro: 'not-reproduced', status: 'rejected' }),
        // 동결된 P1과 P2는 차단 지적이 아니다
        finding('F5', { status: 'deferred', repro: 'not-reproduced' }),
        finding('F6', { severity: 'P2', status: 'rejected' }),
        finding('F7', { severity: 'P0', status: 'open' }),
      ]),
    ],
    [2, null],
    [3, ledger([finding('F1', { status: 'rejected' })])],
  ]);
  const m = pilotMetrics(input({ prs: [pr(1), pr(2), pr(3)], ledgers }));
  assert.deepEqual(m.falsePositives, {
    blocking: 6,
    notReproduced: 2,
    rejected: 3,
    either: 4,
    rate: 4 / 6,
  });
});

test('pilotMetrics: 차단 지적이 없으면 오탐 비율은 null이다', () => {
  const m = pilotMetrics(input({ prs: [pr(1)], ledgers: new Map([[1, ledger([])]]) }));
  assert.equal(m.falsePositives.blocking, 0);
  assert.equal(m.falsePositives.rate, null);
});

test('pilotMetrics: 대기 시간은 생성부터 병합까지의 중앙값과 최댓값(분)이다', () => {
  const at = (min: number) => new Date(Date.parse('2026-11-11T01:00:00Z') + min * 60_000);
  const mk = (n: number, min: number) => pr(n, { mergedAt: at(min).toISOString() });
  const odd = pilotMetrics(input({ prs: [mk(1, 30), mk(2, 10), mk(3, 200)] }));
  assert.deepEqual(odd.wait, { medianMin: 30, maxMin: 200 });
  // 짝수 개면 가운데 둘의 평균
  const even = pilotMetrics(input({ prs: [mk(1, 30), mk(2, 10), mk(3, 200), mk(4, 50)] }));
  assert.deepEqual(even.wait, { medianMin: 40, maxMin: 200 });
});

test('pilotMetrics: PR이 없으면 대기 시간과 PR당 값은 null이다', () => {
  const m = pilotMetrics(input({ runs: [run({ path: JUDGE_CLAUDE, event: 'workflow_run' })] }));
  assert.equal(m.mergedPrs, 0);
  assert.deepEqual(m.wait, { medianMin: null, maxMin: null });
  assert.equal(m.usage.actionsMin, 10);
  assert.equal(m.usage.actionsMinPerPr, null);
  assert.equal(m.usage.judgeMinPerPr, null);
  assert.equal(m.usage.roundsPerPr, null);
});

test('pilotMetrics: 사용량은 기간 안에 끝난 모든 실행의 시간과 판정 수다', () => {
  const dur = (min: number, over: Partial<WorkflowRun> = {}) =>
    run({
      startedAt: '2026-11-11T03:00:00Z',
      updatedAt: new Date(Date.parse('2026-11-11T03:00:00Z') + min * 60_000).toISOString(),
      ...over,
    });
  const m = pilotMetrics(
    input({
      prs: [pr(1), pr(2)],
      ledgers: new Map<number, Ledger | null>([
        [1, ledger([], 4)],
        [2, null],
      ]),
      runs: [
        dur(10),
        dur(6, { event: 'pull_request', branch: 'feat/x' }),
        dur(8, { path: JUDGE_CLAUDE, event: 'workflow_run' }),
        dur(12, { path: JUDGE_CODEX, event: 'workflow_run', conclusion: 'failure' }),
        // 기간 밖, 진행 중은 넣지 않는다
        dur(100, { createdAt: '2026-11-10T23:00:00Z' }),
        dur(100, { status: 'in_progress', conclusion: '' }),
      ],
    }),
  );
  assert.equal(m.usage.actionsMin, 36);
  assert.equal(m.usage.judgeMin, 20);
  assert.equal(m.usage.actionsMinPerPr, 18);
  assert.equal(m.usage.judgeMinPerPr, 10);
  assert.equal(m.usage.rounds, 4);
  assert.equal(m.usage.roundsPerPr, 2);
  assert.equal(m.usage.failedJudgeRuns, 1);
  // 판정 워크플로의 실패는 main check 실패가 아니다
  assert.equal(m.defects.mainCheckFailures, 0);
});

test('pilotMetrics: 시각이 깨진 값은 세지 않고 skipped에 더한다', () => {
  const m = pilotMetrics(
    input({
      prs: [pr(1), pr(2, { createdAt: '깨짐' })],
      runs: [
        run(),
        run({ createdAt: '깨짐', conclusion: 'failure' }),
        run({ updatedAt: '깨짐' }),
        // 끝이 시작보다 앞선 실행도 시간을 알 수 없다
        run({ startedAt: '2026-11-11T04:00:00Z', updatedAt: '2026-11-11T03:00:00Z' }),
      ],
    }),
  );
  assert.equal(m.skipped, 4);
  assert.equal(m.wait.medianMin, 60);
  assert.equal(m.usage.actionsMin, 10);
  assert.equal(m.defects.mainCheckFailures, 0);
  assert.equal(m.mergedPrs, 2);
});

// ── 렌더 ──

const FULL: PilotInput = input({
  prs: [pr(1), pr(2, { head: 'revert/abc' })],
  bugs: [{ number: 41, createdAt: '2026-11-11T05:00:00Z' }],
  ledgers: new Map<number, Ledger | null>([
    [1, ledger([finding('F1', { status: 'rejected' }), finding('F2')], 3)],
    [2, null],
  ]),
  runs: [
    run({ createdAt: '2026-11-11T01:00:00Z', headSha: 'm0' }),
    run({ createdAt: '2026-11-11T02:00:00Z', conclusion: 'failure', headSha: 'm1' }),
    run({ path: JUDGE_CODEX, event: 'workflow_run', conclusion: 'failure' }),
  ],
});

test('renderBlock: 첫 줄은 기간과 병합 PR 수이고 지표마다 목록 항목이 있다', () => {
  const text = renderBlock(P, pilotMetrics(FULL));
  const lines = text.split('\n');
  assert.equal(lines[0], '집계 기간: 2026-11-11 ~ 2026-11-12(UTC) · 병합 PR 2개');
  assert.equal(lines[1], '');
  assert.equal(lines[2], '### 파일럿 판정 지표');
  assert.equal(lines[3], '');
  for (const title of ['병합 후 결함', '검증 누락', '오탐', 'PR당 대기 시간', 'PR당 사용량'])
    assert.equal(lines.filter((l) => l.startsWith(`- ${title}`)).length, 1, title);
  assert.match(text, /^ {2}- main `check` 실패: 1건/m);
  assert.match(text, /^ {2}- revert PR: 1건\(#2\)$/m);
  assert.match(text, /^ {2}- 버그 Issue: 1건\(#41\)$/m);
  assert.match(text, /^- 검증 누락: 1건\(#1\)$/m);
  assert.match(text, /버그 Issue 1건은 원인 PR이 이어지지 않아 넣지 않았다\. 사람이 가른다/);
  assert.match(text, /^- 오탐: 1건 ÷ 차단 지적 2건 = 50\.0%$/m);
  assert.match(text, /^- PR당 대기 시간: 중앙값 60분 · 최대 60분$/m);
  assert.match(text, /^ {2}- 판정 수: 3회\(PR당 1\.5회\)$/m);
  assert.match(text, /^ {2}- 실패로 끝난 판정 워크플로 실행: 1건$/m);
});

test('renderBlock: 표와 집계 시각을 쓰지 않고 prettier가 고칠 꼴이 없다', () => {
  for (const i of [FULL, input()]) {
    const text = renderBlock(P, pilotMetrics(i));
    const lines = text.split('\n');
    assert.ok(!lines.some((l) => l.trimStart().startsWith('|')), '표가 있다');
    assert.ok(!lines.some((l) => /\s$/.test(l)), '줄 끝 공백이 있다');
    assert.ok(!/\n\n\n/.test(text), '빈 줄이 연달아 있다');
    assert.ok(!text.startsWith('\n') && !text.endsWith('\n'));
    // 목록은 "- ", 하위 목록은 공백 2칸
    for (const l of lines.slice(4)) assert.match(l, /^( {2})?- \S/, l);
    // 시각(시:분)이 없다
    assert.ok(!/\d{2}:\d{2}/.test(text), '시각이 있다');
  }
});

test('renderBlock: 값이 없으면 —와 이유를 적는다', () => {
  const text = renderBlock(P, pilotMetrics(input()));
  assert.match(text, /^집계 기간: 2026-11-11 ~ 2026-11-12\(UTC\) · 병합 PR 0개$/m);
  assert.match(text, /^- 오탐: —\(차단 지적 없음\)$/m);
  assert.match(text, /^- PR당 대기 시간: —\(병합 PR 없음\)$/m);
  assert.match(text, /^ {2}- Actions 실행 시간: 0분\(PR당 —, 병합 PR 없음\)$/m);
  assert.match(text, /^- 검증 누락: 0건$/m);
  assert.match(text, /^ {2}- revert PR: 0건$/m);
});

test('renderBlock: 직전 결론을 모르는 첫 실패와 세지 못한 항목을 드러낸다', () => {
  const m = pilotMetrics(
    input({
      priorMainCheck: null,
      prs: [pr(1, { createdAt: '깨짐' })],
      runs: [run({ conclusion: 'failure', headSha: 'm1' })],
    }),
  );
  const text = renderBlock(P, m);
  assert.match(text, /^ {2}- 전환 여부 미확인[^\n]*: 1건$/m);
  assert.match(text, /^- 세지 못한 항목[^\n]*: 1건$/m);
});

test('replaceBlock: 표식 사이만 바꾸고 구간 밖은 그대로 둔다', () => {
  const doc = `# 제목\n\n앞\n\n${BEGIN}\n\n옛 값\n\n${END}\n\n뒤\n`;
  const out = replaceBlock(doc, '새 값\n\n- 항목');
  assert.equal(out, `# 제목\n\n앞\n\n${BEGIN}\n\n새 값\n\n- 항목\n\n${END}\n\n뒤\n`);
  // 다시 바꿔도 같다
  assert.equal(replaceBlock(out ?? '', '새 값\n\n- 항목'), out);
  // 표식이 붙어 있어도 된다
  assert.equal(replaceBlock(`${BEGIN}\n${END}\n`, 'x'), `${BEGIN}\n\nx\n\n${END}\n`);
});

test('replaceBlock: 표식이 없거나 여러 개거나 순서가 뒤집혔으면 null이다', () => {
  assert.equal(replaceBlock('# 제목\n', 'x'), null);
  assert.equal(replaceBlock(`${BEGIN}\n`, 'x'), null);
  assert.equal(replaceBlock(`${END}\n`, 'x'), null);
  assert.equal(replaceBlock(`${END}\n\n${BEGIN}\n`, 'x'), null);
  assert.equal(replaceBlock(`${BEGIN}\n${BEGIN}\n${END}\n`, 'x'), null);
  assert.equal(replaceBlock(`${BEGIN}\n${END}\n${END}\n`, 'x'), null);
  // 줄 안에 섞인 표식은 표식이 아니다
  assert.equal(replaceBlock(`앞 ${BEGIN}\n${END}\n`, 'x'), null);
});
