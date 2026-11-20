// metrics(17.2절 상시 지표 가운데 GitHub에서 읽는 것): 댓글 분류, 자료 읽기, 지표 계산, 렌더. 계획 20261119-metrics step1.
// 실행과 PR을 잘못 잇거나, 남이 쓴 댓글·커밋 상태를 세거나, 외부 입력 문자열이 결과에 남지 않는 것을 본다.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { emptyLedger, type Ledger, type Reviewer } from '../ci/ledger.ts';
import { loadConfig } from '../lib/config.ts';
import { pilotMetrics } from '../metrics/pilot.ts';
import { planClaimedAt } from '../metrics/plans.ts';
import { renderBlock } from '../metrics/render.ts';
import {
  SourceError,
  classifyEscalation,
  ghSource,
  type BotComment,
  type EscalationKind,
  type HeadStatus,
  type LabelEvent,
  type MergedPr,
  type Period,
  type WorkflowRun,
} from '../metrics/source.ts';
import { steadyMetrics, type SteadyInput } from '../metrics/steady.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';
import { fits, ghReadShapes, matchShape } from './metrics-allow.ts';

const CFG = loadConfig(HARNESS_ROOT);
const BOT = CFG.github.bot;
const NEEDS_HUMAN = CFG.github.needsHumanLabel;
const RECORDER = 'harness-recorder[bot]';
const P: Period = { since: '2026-11-11', until: '2026-11-12' };
const CHECK = '.github/workflows/check.yml';
const sha = (c: string) => c.repeat(40);

function pr(number: number, over: Partial<MergedPr> = {}): MergedPr {
  return {
    number,
    head: `feat/20261111-x-s${number}`,
    headSha: sha('a'),
    createdAt: '2026-11-11T01:00:00Z',
    mergedAt: '2026-11-11T05:00:00Z',
    mergeSha: `m${number}`,
    additions: 10,
    deletions: 2,
    commits: [sha('a')],
    crossRepo: false,
    ...over,
  };
}

/** 기본값은 PR 1의 첫 `check` 실행(통과) */
function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    path: CHECK,
    event: 'pull_request',
    branch: 'feat/20261111-x-s1',
    headSha: sha('a'),
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-11-11T02:00:00Z',
    startedAt: '2026-11-11T02:00:00Z',
    updatedAt: '2026-11-11T02:10:00Z',
    attempt: 1,
    runNumber: 1,
    sameRepo: true,
    ...over,
  };
}

function ledger(rounds: Reviewer[]): Ledger {
  const l = emptyLedger(sha('b'));
  l.rounds = rounds.map((reviewer) => ({ reviewer, head: sha('c') }));
  return l;
}

const risk = (description: string, over: Partial<HeadStatus> = {}): HeadStatus => ({
  context: 'risk-gate',
  state: 'success',
  description,
  creator: RECORDER,
  at: '2026-11-11T03:00:00Z',
  ...over,
});

function input(over: Partial<SteadyInput> = {}): SteadyInput {
  const prs = over.prs ?? [];
  return {
    period: P,
    prs,
    runs: [],
    ledgers: new Map(),
    statuses: new Map(),
    recorderBot: RECORDER,
    planClaimedAt: new Map(),
    headPrCounts: new Map(prs.map((p) => [p.number, 1])),
    labels: [],
    comments: [],
    ...over,
  };
}

// ── 댓글 분류 ──

// scripts/runner/run.ts의 실패 중단 보고 형식
const stopReport = (reason: string) => `@maker runner가 계획을 멈췄다.

## 중단 보고: 20261111-x
- 목표: 무엇
- 실패 키: check:test 5
- 시도 이력:
  - 2026-11-11T01:00:00Z [check:test] 실패
- 3회차 방법 전환 내용과 이유: 계획의 "의사결정 로그" 참조 (브랜치 \`feat/20261111-x-s0\`)
- 추정 원인: ${reason}
- 교차 검증 의견: (이 PR의 원장에 열린 지적 없음)
- 사람이 결정할 것: A) 계속 / B) 포기`;

// scripts/runner/run.ts의 PR 갱신 충돌 보고 형식
const conflictReport = `@maker runner가 PR 갱신을 멈췄다.

## 중단 보고: 20261111-x
- 원인: origin/main 병합이 충돌한다(\`a.ts\`). 병합은 취소했고 PR 브랜치와 계획 파일은 그대로다.
- PR: #7 (브랜치 \`feat/20261111-x-s0\`)
- 사람이 결정할 것:
  - A) 이 Issue에 제작자 계정으로 답을 단다(추천).`;

const BODIES: Array<[EscalationKind, string]> = [
  ['stop-failures', stopReport('실패 키 check:test 5회')],
  ['stop-limit', stopReport('step 총량 상한: 실패한 check 10회')],
  ['stop-limit', stopReport('step 총량 상한: 세션 실행 시간 130분')],
  ['stop-deadlock', stopReport('교착: F3')],
  ['stop-conflict', conflictReport],
  // PR #44(2026-11-12) 전의 갱신 충돌 보고는 실패 중단 보고의 형식으로 쓰였다
  ['stop-conflict', stopReport('origin/main 병합이 충돌한다(`a.ts`). 병합은 취소했다')],
  ['stop-other', stopReport('세션이 계획을 고칠 수 없다고 보고했다')],
  [
    'revert',
    '<!-- harness-revert-escalate target=abc -->\n@maker main이 깨졌지만 자동으로 되돌리지 못했다.',
  ],
  [
    'question',
    '@maker runner의 step 1 세션이 질문 2건을 남겼다. 답을 받을 때까지 계획 `20261111-x`를 멈춘다.',
  ],
  ['approval', '@maker PR #7이 제작자 승인을 기다린다.\n\n- 위험도 높음'],
  ['ci-stall', '@maker PR #7의 CI 대기가 5시간을 넘었다(기준 4시간).'],
];

test('classifyEscalation: 문구마다 종류가 정해진다', () => {
  for (const [kind, body] of BODIES) assert.equal(classifyEscalation(body), kind, body);
  // 충돌 보고는 5회 실패 중단이 아니다
  assert.notEqual(classifyEscalation(conflictReport), 'stop-failures');
  // 어느 문구도 없으면 버린다
  assert.equal(classifyEscalation('PR을 열었다. 판정을 기다린다.'), null);
  assert.equal(classifyEscalation(''), null);
  // "## 중단 보고:"는 줄의 처음이어야 한다(인용한 글은 중단 보고가 아니다)
  assert.equal(classifyEscalation('앞서 올린 "## 중단 보고: x"를 참고하라'), null);
  // 중단 보고 안의 다른 문구보다 중단 보고가 먼저다
  assert.equal(
    classifyEscalation(`${stopReport('교착: F3')}\n제작자 승인을 기다린다`),
    'stop-deadlock',
  );
});

// ── ghSource: 더한 조회 ──

interface Fake {
  calls: string[][];
  gh: (args: string[]) => string;
}

/** 호출을 기록하고, 허용 목록의 꼴 이름으로 고정 응답을 고르는 gh. 꼴과 맞지 않는 호출은 예외다 */
function fakeGh(answers: Record<string, (args: string[]) => string>): Fake {
  const calls: string[][] = [];
  return {
    calls,
    gh(args) {
      calls.push(args);
      const shape = matchShape(ghReadShapes(CFG.github.defaultBranch), args);
      if (!shape) throw new Error(`허용 목록에 없는 호출: ${args.join(' ')}`);
      const answer = answers[shape.name];
      if (!answer) throw new Error(`응답을 정하지 않은 호출: ${shape.name}`);
      return answer(args);
    },
  };
}

const source = (f: Fake) => ghSource({ cfg: CFG, gh: f.gh, ledger: () => null });
const lines = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const rawPr = (number: number, mergedAt: string, over: Record<string, unknown> = {}) => ({
  number,
  headRefName: `feat/20261111-x-s${number}`,
  headRefOid: sha('a'),
  createdAt: '2026-11-10T01:00:00Z',
  mergedAt,
  mergeCommit: { oid: `m${number}` },
  additions: 7,
  deletions: 3,
  isCrossRepository: false,
  ...over,
});

const shaN = (n: number) => n.toString(16).padStart(40, '0');

test('ghSource.mergedPrs: 기간 안의 PR마다 커밋 목록을 따로 읽는다', () => {
  const f = fakeGh({
    prs: () =>
      JSON.stringify([
        rawPr(1, '2026-11-11T00:00:00Z'),
        rawPr(2, '2026-11-13T00:00:00Z'),
        rawPr(3, '2026-11-12T10:00:00Z', { isCrossRepository: true }),
      ]),
    prCommits: (args) =>
      args[2].includes('/pulls/1/') ? `${sha('a')}\n${sha('b')}\n` : `${sha('c')}\n`,
  });
  const prs = source(f).mergedPrs(P);
  assert.deepEqual(
    prs.map((p) => [p.number, p.commits, p.crossRepo]),
    [
      [1, [sha('a'), sha('b')], false],
      [3, [sha('c')], true],
    ],
  );
  // PR 조회는 commits 필드를 달라고 하지 않는다(GraphQL 노드 한도를 넘는다)
  const fields = f.calls[0][f.calls[0].indexOf('--json') + 1].split(',');
  assert.ok(!fields.includes('commits'));
  assert.ok(fields.includes('isCrossRepository'));
  // 커밋 조회는 기간 안의 PR마다 그 번호로 한 번씩. 기간 밖의 PR 2에는 부르지 않는다
  assert.deepEqual(
    f.calls.slice(1).map((a) => a[2]),
    [
      'repos/{owner}/{repo}/pulls/1/commits?per_page=100',
      'repos/{owner}/{repo}/pulls/3/commits?per_page=100',
    ],
  );
});

/** 커밋 조회의 한 쪽이 내는 출력: 한 줄에 SHA 하나, 줄바꿈으로 끝난다 */
const page = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => `${shaN(from + i)}\n`).join('');

function commitsSource(commits: () => string): Fake {
  return fakeGh({
    prs: () => JSON.stringify([rawPr(7, '2026-11-11T00:00:00Z')]),
    prCommits: commits,
  });
}

test('ghSource.mergedPrs: 쪽을 넘겨 받은 커밋이 모두 남는다', () => {
  // `gh api --paginate --jq`는 쪽마다의 결과를 이어서 낸다: 첫 쪽 100줄 + 둘째 쪽 1줄
  const f = commitsSource(() => page(1, 100) + page(101, 1));
  const [pr7] = source(f).mergedPrs(P);
  assert.equal(pr7.commits.length, 101);
  assert.deepEqual(
    pr7.commits,
    Array.from({ length: 101 }, (_, i) => shaN(i + 1)),
  );
  assert.ok(pr7.commits.includes(shaN(101)), '둘째 쪽의 SHA가 빠졌다');
  const call = f.calls[1];
  assert.deepEqual(call, [
    'api',
    '--paginate',
    'repos/{owner}/{repo}/pulls/7/commits?per_page=100',
    '--jq',
    '.[].sha',
  ]);
  // --paginate를 뺀 호출은 읽기 요청 꼴이 아니다
  const shapes = ghReadShapes(CFG.github.defaultBranch);
  assert.equal(matchShape(shapes, call)?.name, 'prCommits');
  assert.equal(
    matchShape(
      shapes,
      call.filter((a) => a !== '--paginate'),
    ),
    null,
  );
});

test('ghSource.mergedPrs: 커밋 조회가 상한에 닿거나 응답이 깨지면 SourceError다', () => {
  const one = (commits: string) => source(commitsSource(() => commits)).mergedPrs(P)[0];
  // 이 조회는 PR 하나에 250개까지만 준다. 250개면 더 있는지 알 수 없다
  assert.equal(one(page(1, 249)).commits.length, 249);
  assert.throws(
    () => one(page(1, 250)),
    (e: unknown) => e instanceof SourceError && /PR #7/.test(e.message) && /상한/.test(e.message),
  );
  assert.throws(() => one(page(1, 251)), SourceError);
  // 같은 SHA가 두 번 오면 읽는 동안 목록이 바뀐 것이다
  assert.throws(
    () => one(`${sha('a')}\n${sha('b')}\n${sha('a')}\n`),
    (e: unknown) => e instanceof SourceError && /중복/.test(e.message),
  );
  assert.throws(() => one('not-a-sha\n'), SourceError);
  // 병합된 PR에는 커밋이 하나 이상 있다. 빈 응답은 다 읽은 결과가 아니다
  for (const empty of ['', '\n', '\n\n  \n'])
    assert.throws(
      () => one(empty),
      (e: unknown) => e instanceof SourceError && /PR #7/.test(e.message),
      JSON.stringify(empty),
    );
  assert.throws(() => one(`${sha('a')} \n`), SourceError);
  // 커밋 조회가 실패하면 PR 목록을 다 읽지 못한 것이다
  const broken = commitsSource(() => {
    throw new Error('HTTP 502');
  });
  assert.throws(() => source(broken).mergedPrs(P), SourceError);
});

test('ghSource.workflowRuns: 실행의 head 리포가 이 리포인지 읽는다', () => {
  const raw = (id: number, sameRepo: unknown) => ({ id, ...run(), sameRepo });
  const f = fakeGh({
    runs: (args) =>
      args[2].includes('created=2026-11-11')
        ? lines({ total: 2 }, raw(1, true), raw(2, false))
        : lines({ total: 0 }),
  });
  assert.deepEqual(
    source(f)
      .workflowRuns(P)
      .map((r) => r.sameRepo),
    [true, false],
  );
  const jq = f.calls[0][f.calls[0].indexOf('--jq') + 1];
  assert.match(jq, /sameRepo: \(\.head_repository\.full_name == \.repository\.full_name\)/);
  // 값이 참·거짓이 아니면 읽지 못한 것이다
  const bad = fakeGh({ runs: () => lines({ total: 1 }, raw(1, null)) });
  assert.throws(() => source(bad).workflowRuns(P), SourceError);
});

test('ghSource.headStatuses: 그 커밋의 상태를 읽어 형을 바꾼다', () => {
  const f = fakeGh({
    statuses: () =>
      lines(
        {
          id: 2,
          context: 'risk-gate',
          state: 'success',
          description: '위험도 보통: 계획 risk: normal',
          creator: RECORDER,
          at: '2026-11-11T03:00:00Z',
        },
        {
          id: 1,
          context: 'check',
          state: 'pending',
          description: null,
          creator: null,
          at: '2026-11-11T02:00:00Z',
        },
      ),
  });
  assert.deepEqual(source(f).headStatuses(sha('a')), [
    {
      context: 'risk-gate',
      state: 'success',
      description: '위험도 보통: 계획 risk: normal',
      creator: RECORDER,
      at: '2026-11-11T03:00:00Z',
    },
    {
      context: 'check',
      state: 'pending',
      description: '',
      creator: '',
      at: '2026-11-11T02:00:00Z',
    },
  ]);
  assert.equal(f.calls[0][2], `repos/{owner}/{repo}/commits/${sha('a')}/statuses?per_page=100`);
  // SHA가 아닌 값으로는 조회하지 않는다(경로에 그대로 들어간다)
  const g = fakeGh({ statuses: () => '' });
  assert.throws(() => source(g).headStatuses('main/../x'), SourceError);
  assert.throws(() => source(g).headStatuses('abc'), SourceError);
  assert.deepEqual(g.calls, []);
  // 같은 기록이 두 번 오면 SourceError
  const dup = fakeGh({
    statuses: () => {
      const row = { id: 1, context: 'x', state: 's', description: '', creator: '', at: P.since };
      return lines(row, row);
    },
  });
  assert.throws(() => source(dup).headStatuses(sha('a')), SourceError);
});

test('ghSource.needsHumanEvents: 기간 안에 needs-human 라벨이 붙은 사건만 남긴다', () => {
  const ev = (id: number, label: unknown, at: string, issue: unknown = 7) => ({
    id,
    label,
    issue,
    at,
  });
  const f = fakeGh({
    events: () =>
      lines(
        ev(1, NEEDS_HUMAN, '2026-11-12T23:59:59Z'),
        ev(2, NEEDS_HUMAN, '2026-11-13T00:00:00Z'),
        ev(3, 'bug', '2026-11-11T05:00:00Z'),
        ev(4, NEEDS_HUMAN, '2026-11-11T00:00:00Z', 9),
        // 라벨이 지워졌거나 Issue가 없어진 사건
        ev(5, null, '2026-11-11T05:00:00Z', null),
      ),
  });
  assert.deepEqual(source(f).needsHumanEvents(P), [
    { issue: 7, at: '2026-11-12T23:59:59Z' },
    { issue: 9, at: '2026-11-11T00:00:00Z' },
  ]);
  const jq = f.calls[0][f.calls[0].indexOf('--jq') + 1];
  assert.match(jq, /select\(\.event == "labeled"\)/);
  const dup = fakeGh({
    events: () => lines(ev(1, NEEDS_HUMAN, P.since + 'T01:00:00Z'), ev(1, NEEDS_HUMAN, P.since)),
  });
  assert.throws(() => source(dup).needsHumanEvents(P), SourceError);
});

test('ghSource.escalationComments: 봇이 기간 안에 쓴 댓글만 분류하고 본문은 남기지 않는다', () => {
  const c = (id: number, user: unknown, at: string, body: unknown, issue = 7) => ({
    id,
    user,
    at,
    issue,
    body,
  });
  const report = stopReport('실패 키 check:test 5회');
  const f = fakeGh({
    repoComments: () =>
      lines(
        c(1, BOT, '2026-11-11T05:00:00Z', report),
        // 같은 문구를 다른 계정이 썼다
        c(2, 'someone', '2026-11-11T05:00:00Z', report),
        c(3, RECORDER, '2026-11-11T05:00:00Z', report),
        // 기간 밖
        c(4, BOT, '2026-11-13T00:00:01Z', report),
        c(5, BOT, '2026-11-10T23:59:59Z', report),
        // 봇이 썼지만 에스컬레이션이 아니다
        c(6, BOT, '2026-11-11T06:00:00Z', 'PR을 열었다'),
        c(7, BOT, '2026-11-12T06:00:00Z', '@maker PR #8이 제작자 승인을 기다린다.', 8),
        c(8, BOT, '2026-11-12T07:00:00Z', null),
        // 집계 시작일 00:00:00Z에 쓰인 댓글은 기간 안이다
        c(
          9,
          BOT,
          '2026-11-11T00:00:00Z',
          '@maker PR #9의 CI 대기가 5시간을 넘었다(기준 4시간).',
          9,
        ),
      ),
  });
  const got = source(f).escalationComments(P);
  assert.deepEqual(got, [
    { issue: 7, at: '2026-11-11T05:00:00Z', kind: 'stop-failures' },
    { issue: 8, at: '2026-11-12T06:00:00Z', kind: 'approval' },
    { issue: 9, at: '2026-11-11T00:00:00Z', kind: 'ci-stall' },
  ]);
  assert.ok(!JSON.stringify(got).includes('중단 보고'), '본문이 결과에 남았다');
  // 조회의 since는 집계 시작일 00:00:00Z다. GitHub은 갱신 시각이 since와 같은 댓글도 준다(경계 포함.
  // 2026-11-20에 이 리포에서 확인). 받은 뒤에는 생성 시각으로 거른다: 시작일 00:00:00Z(위 9번)는 들고
  // 직전 초(위 5번)는 빠진다
  assert.equal(
    f.calls[0][2],
    'repos/{owner}/{repo}/issues/comments?since=2026-11-11T00:00:00Z&per_page=100',
  );
  const dup = fakeGh({
    repoComments: () => lines(c(1, BOT, P.since, report), c(1, BOT, P.since, report)),
  });
  assert.throws(() => source(dup).escalationComments(P), SourceError);
});

test('ghSource.headPrCount: 그 head 브랜치 이름으로 열린 PR의 수다', () => {
  const f = fakeGh({ headPrs: () => JSON.stringify([{ number: 7 }, { number: 3 }]) });
  assert.equal(source(f).headPrCount('feat/20261111-x-s1'), 2);
  assert.deepEqual(f.calls[0], [
    'pr',
    'list',
    '--state',
    'all',
    '--head',
    'feat/20261111-x-s1',
    '--limit',
    '100',
    '--json',
    'number',
  ]);
  assert.equal(source(fakeGh({ headPrs: () => '[]' })).headPrCount('feat/x'), 0);
  // 상한에 닿으면 더 있는지 알 수 없다
  const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })));
  assert.throws(() => source(fakeGh({ headPrs: () => full })).headPrCount('feat/x'), SourceError);
  // 항목이 PR이 아니면(번호가 없거나 양의 정수가 아니다) 수로 세지 않는다. 같은 번호가 두 번 와도 다 읽은 결과가 아니다
  const broken: Array<[string, unknown[]]> = [
    ['번호 없는 항목', [{}]],
    ['문자열 번호', [{ number: '7' }]],
    ['0', [{ number: 0 }]],
    ['음수', [{ number: -1 }]],
    ['소수', [{ number: 1.5 }]],
    ['null', [{ number: null }]],
    ['번호 없는 항목이 섞임', [{ number: 7 }, {}]],
    ['같은 번호 중복', [{ number: 7 }, { number: 7 }]],
  ];
  for (const [why, items] of broken) {
    assert.throws(
      () => source(fakeGh({ headPrs: () => JSON.stringify(items) })).headPrCount('feat/x'),
      SourceError,
      why,
    );
  }
  // 옵션으로 읽힐 이름과 빈 이름으로는 조회하지 않는다
  const g = fakeGh({ headPrs: () => '[]' });
  assert.throws(() => source(g).headPrCount('--web'), SourceError);
  assert.throws(() => source(g).headPrCount(''), SourceError);
  assert.deepEqual(g.calls, []);
});

test('ghSource: 더한 조회의 인자 배열이 읽기 요청 꼴과 자리마다 맞는다', () => {
  const f = fakeGh({
    prs: () => JSON.stringify([rawPr(1, '2026-11-11T00:00:00Z')]),
    prCommits: () => `${sha('a')}\n`,
    statuses: () => '',
    events: () => '',
    repoComments: () => '',
    headPrs: () => '[]',
  });
  const s = source(f);
  s.mergedPrs(P);
  s.headStatuses(sha('a'));
  s.needsHumanEvents(P);
  s.escalationComments(P);
  s.headPrCount('feat/20261111-x-s1');
  const shapes = ghReadShapes(CFG.github.defaultBranch);
  const added = ['prCommits', 'statuses', 'events', 'repoComments', 'headPrs'];
  assert.deepEqual(
    f.calls.map((a) => matchShape(shapes, a)?.name),
    ['prs', ...added],
  );
  // 꼴이 실제로 가른다: 인자를 덧붙이거나 자리를 바꾸면 어느 꼴과도 맞지 않는다
  for (const a of f.calls) {
    assert.equal(matchShape(shapes, [...a, '--method=POST']), null, a.join(' '));
    assert.equal(matchShape(shapes, [...a, '--web']), null, a.join(' '));
  }
  const events = shapes.find((x) => x.name === 'events');
  assert.ok(events);
  assert.ok(!fits(events, ['api', 'repos/{owner}/{repo}/issues/events?per_page=100', '--jq', '.']));
});

// ── steadyMetrics ──

test('steadyMetrics: 리드타임은 계획 생성부터 병합까지다. 계획을 찾지 못한 PR은 따로 센다', () => {
  const m = steadyMetrics(
    input({
      prs: [
        pr(1, { mergedAt: '2026-11-11T05:00:00Z' }),
        // 둘째 step의 PR도 같은 계획의 claimed_at부터 잰다
        pr(2, { mergedAt: '2026-11-11T09:00:00Z' }),
        pr(3),
        pr(4),
        pr(5),
      ],
      planClaimedAt: new Map([
        [1, '2026-11-11T03:00:00Z'],
        [2, '2026-11-11T03:00:00Z'],
        // 시각을 읽지 못했다
        [4, 'yesterday'],
        // 병합보다 뒤다
        [5, '2026-11-12T00:00:00Z'],
      ]),
    }),
  );
  assert.deepEqual(m.leadTime, { medianMin: 240, maxMin: 360, noPlan: 3 });
  const none = steadyMetrics(input({ prs: [pr(1)] }));
  assert.deepEqual(none.leadTime, { medianMin: null, maxMin: null, noPlan: 1 });
});

test('steadyMetrics: 첫 실행이 첫 시도에 통과한 PR만 첫 통과다', () => {
  const head = (n: number) => `feat/20261111-x-s${n}`;
  const m = steadyMetrics(
    input({
      prs: [pr(1), pr(2), pr(3), pr(4), pr(5)],
      runs: [
        // PR 1: 첫 실행이 통과
        run({ branch: head(1) }),
        // PR 2: 첫 실행은 실패, 뒤 실행이 통과
        run({ branch: head(2), conclusion: 'failure', createdAt: '2026-11-11T02:00:00Z' }),
        run({ branch: head(2), createdAt: '2026-11-11T03:00:00Z', runNumber: 2 }),
        // PR 3: 첫 실행이 재실행 뒤 통과했다(실행 목록은 마지막 시도의 결과만 준다)
        run({ branch: head(3), attempt: 2 }),
        // PR 4: 같은 초의 두 실행. 실행 번호가 작은 쪽(실패)이 먼저다
        run({ branch: head(4), runNumber: 9 }),
        run({ branch: head(4), runNumber: 8, conclusion: 'failure' }),
        // PR 5: 실행이 없다
      ],
    }),
  );
  assert.deepEqual(m.firstPass, { passed: 1, withRuns: 4, rate: 0.25, unlinkable: 0, noRuns: 1 });
  const none = steadyMetrics(input({ prs: [pr(1)] }));
  assert.deepEqual(none.firstPass, {
    passed: 0,
    withRuns: 0,
    rate: null,
    unlinkable: 0,
    noRuns: 1,
  });
});

test('steadyMetrics: 같은 head 브랜치 이름으로 열린 PR이 하나뿐일 때만 실행을 잇는다', () => {
  const base = { prs: [pr(1)], runs: [run()] };
  const one = steadyMetrics(input({ ...base, headPrCounts: new Map([[1, 1]]) }));
  assert.deepEqual(one.firstPass, { passed: 1, withRuns: 1, rate: 1, unlinkable: 0, noRuns: 0 });
  // 닫았다 새로 연 PR, base가 다르거나 base를 바꾼 PR이 있으면 어느 PR의 실행인지 가를 수 없다
  const two = steadyMetrics(input({ ...base, headPrCounts: new Map([[1, 2]]) }));
  assert.deepEqual(two.firstPass, { passed: 0, withRuns: 0, rate: null, unlinkable: 1, noRuns: 0 });
  // 값이 없는 PR도 뺀다
  const missing = steadyMetrics(input({ ...base, headPrCounts: new Map() }));
  assert.deepEqual(missing.firstPass.unlinkable, 1);
  const zero = steadyMetrics(input({ ...base, headPrCounts: new Map([[1, 0]]) }));
  assert.deepEqual(zero.firstPass.unlinkable, 1);
});

test('steadyMetrics: 포크에서 온 PR과 시각을 읽지 못한 PR은 실행을 이을 수 없다', () => {
  const m = steadyMetrics(
    input({
      prs: [pr(1, { crossRepo: true }), pr(3, { createdAt: 'broken' }), pr(4)],
      runs: [
        run({ branch: 'feat/20261111-x-s1' }),
        run({ branch: 'feat/20261111-x-s3' }),
        run({ branch: 'feat/20261111-x-s4' }),
      ],
    }),
  );
  assert.deepEqual(m.firstPass, { passed: 1, withRuns: 1, rate: 1, unlinkable: 2, noRuns: 0 });
});

test('steadyMetrics: 조건이 하나라도 어긋난 실행은 그 PR의 실행이 아니다', () => {
  const others: Array<[string, Partial<WorkflowRun>]> = [
    ['포크의 같은 이름 브랜치에서 돈 실행', { sameRepo: false }],
    ['PR이 열리기 전', { createdAt: '2026-11-11T00:59:59Z' }],
    ['병합된 뒤', { createdAt: '2026-11-11T05:00:01Z' }],
    ['다른 브랜치', { branch: 'feat/20261111-x-s9' }],
    ['push로 돈 실행', { event: 'push' }],
    ['다른 워크플로', { path: '.github/workflows/gates.yml' }],
  ];
  for (const [why, over] of others) {
    // 어긋난 실행은 실패, 그 뒤의 맞는 실행은 통과다. 어긋난 실행이 이어지면 첫 통과가 아니게 된다
    const m = steadyMetrics(
      input({
        prs: [pr(1)],
        runs: [
          run({ createdAt: '2026-11-11T01:30:00Z', conclusion: 'failure', ...over }),
          run({ createdAt: '2026-11-11T04:00:00Z', runNumber: 2 }),
        ],
      }),
    );
    assert.deepEqual(
      m.firstPass,
      { passed: 1, withRuns: 1, rate: 1, unlinkable: 0, noRuns: 0 },
      why,
    );
  }
  // 경계 시각(열린 때, 병합된 때)의 실행은 그 PR의 것이다
  for (const at of ['2026-11-11T01:00:00Z', '2026-11-11T05:00:00Z']) {
    const m = steadyMetrics(
      input({ prs: [pr(1)], runs: [run({ createdAt: at, conclusion: 'failure' })] }),
    );
    assert.equal(m.firstPass.withRuns, 1, at);
    assert.equal(m.firstPass.passed, 0, at);
  }
});

test('steadyMetrics: 커밋이 교체된 PR은 실행을 이을 수 없는 PR로 빠진다', () => {
  // 가장 이른 실행은 PR의 커밋 목록에 없는 SHA에서 실패했고, 그 뒤의 실행은 목록의 SHA에서 첫 시도에 통과했다.
  // 커밋 목록은 병합 때의 것이라, 앞선 실행을 버리고 고르면 뒤의 통과가 첫 통과로 세어진다
  const replaced = run({
    createdAt: '2026-11-11T01:30:00Z',
    conclusion: 'failure',
    headSha: sha('f'),
  });
  const later = run({ createdAt: '2026-11-11T04:00:00Z', runNumber: 2 });
  const out = { passed: 0, withRuns: 0, rate: null, unlinkable: 1, noRuns: 0 };
  const firstPassed = { passed: 1, withRuns: 1, rate: 1, unlinkable: 0, noRuns: 0 };
  assert.deepEqual(
    steadyMetrics(input({ prs: [pr(1)], runs: [replaced, later] })).firstPass,
    out,
    '첫 통과로도 실행을 찾은 PR로도 세지 않는다',
  );
  // 그 앞선 실행을 입력에서 빼면 첫 통과다
  assert.deepEqual(steadyMetrics(input({ prs: [pr(1)], runs: [later] })).firstPass, firstPassed);
  // 목록에 없는 SHA의 실행이 뒤에 있거나 그것뿐이어도 빠진다(통과한 실행이어도 같다)
  assert.deepEqual(
    steadyMetrics(
      input({
        prs: [pr(1)],
        runs: [
          run({ createdAt: '2026-11-11T01:30:00Z' }),
          run({ createdAt: '2026-11-11T04:00:00Z', runNumber: 2, headSha: sha('f') }),
        ],
      }),
    ).firstPass,
    out,
  );
  assert.deepEqual(
    steadyMetrics(input({ prs: [pr(1)], runs: [{ ...replaced, conclusion: 'success' }] }))
      .firstPass,
    out,
  );
  // 다른 PR은 그대로 센다
  assert.deepEqual(
    steadyMetrics(
      input({
        prs: [pr(1), pr(2)],
        runs: [replaced, later, run({ branch: 'feat/20261111-x-s2', runNumber: 3 })],
      }),
    ).firstPass,
    { passed: 1, withRuns: 1, rate: 1, unlinkable: 1, noRuns: 0 },
  );
  // 그 PR의 실행일 수 없는 것은 SHA가 목록에 없어도 PR을 빼지 않는다
  const notOwn: Array<[string, Partial<WorkflowRun>]> = [
    ['다른 브랜치', { branch: 'feat/20261111-x-s9' }],
    ['PR이 열리기 전', { createdAt: '2026-11-11T00:59:59Z' }],
    ['병합된 뒤', { createdAt: '2026-11-11T05:00:01Z' }],
    ['포크의 같은 이름 브랜치', { sameRepo: false }],
    ['push로 돈 실행', { event: 'push' }],
    ['다른 워크플로', { path: '.github/workflows/gates.yml' }],
  ];
  for (const [why, over] of notOwn) {
    assert.deepEqual(
      steadyMetrics(input({ prs: [pr(1)], runs: [{ ...replaced, ...over }, later] })).firstPass,
      firstPassed,
      why,
    );
  }
});

test('steadyMetrics: 리뷰 라운드 수는 검증자별 판정 수 가운데 큰 값이다', () => {
  const m = steadyMetrics(
    input({
      prs: [pr(1), pr(2), pr(3), pr(4)],
      ledgers: new Map<number, Ledger | null>([
        [1, ledger(['claude', 'codex'])],
        [2, ledger(['claude', 'codex', 'codex', 'codex', 'codex'])],
        [3, ledger(['claude', 'claude', 'claude', 'codex'])],
        [4, null],
      ]),
    }),
  );
  // 1, 4, 3, 0 → 중앙값 2, 최대 4. 3라운드를 넘은 것은 PR 2뿐이다
  assert.deepEqual(m.rounds, { median: 2, max: 4, over3: [2] });
  // 번호는 받은 순서(GitHub은 최신순으로 준다)가 아니라 작은 번호부터 낸다
  const many = ledger(['codex', 'codex', 'codex', 'codex']);
  const desc = steadyMetrics(
    input({
      prs: [pr(30), pr(4), pr(12)],
      ledgers: new Map<number, Ledger | null>([
        [30, many],
        [4, many],
        [12, many],
      ]),
    }),
  );
  assert.deepEqual(desc.rounds.over3, [4, 12, 30]);
  assert.deepEqual(steadyMetrics(input()).rounds, { median: null, max: null, over3: [] });
});

test('steadyMetrics: 에스컬레이션은 라벨 수와 사유별 댓글 수를 따로 낸다', () => {
  const label = (at: string): LabelEvent => ({ issue: 7, at });
  const comment = (kind: EscalationKind, at = '2026-11-11T05:00:00Z'): BotComment => ({
    issue: 7,
    at,
    kind,
  });
  const m = steadyMetrics(
    input({
      labels: [label('2026-11-11T05:00:00Z'), label('2026-11-12T05:00:00Z')],
      comments: [
        comment('stop-failures'),
        comment('stop-failures'),
        comment('stop-limit'),
        comment('stop-conflict'),
        comment('stop-other'),
        comment('question'),
      ],
    }),
  );
  assert.equal(m.escalation.labels, 2);
  assert.deepEqual(m.escalation.comments, {
    'stop-failures': 2,
    'stop-limit': 1,
    'stop-deadlock': 0,
    'stop-conflict': 1,
    'stop-other': 1,
    question: 1,
    approval: 0,
    'ci-stall': 0,
    revert: 0,
  });
  // 5회 중단과 총량 상한 도달에 갱신 충돌·그 밖의 중단은 넣지 않는다
  assert.deepEqual(m.stops, { failures: 2, limit: 1 });
});

test('steadyMetrics: 날짜 경계의 라벨과 댓글은 각자의 기간에서 한 번씩 세어진다', () => {
  // 라벨은 기간 마지막 날 23:59:59Z에 붙고 알림 댓글은 다음 날 00:00:01Z에 달렸다
  const labels: LabelEvent[] = [{ issue: 7, at: '2026-11-12T23:59:59Z' }];
  const comments: BotComment[] = [{ issue: 7, at: '2026-11-13T00:00:01Z', kind: 'stop-failures' }];
  const first = steadyMetrics(input({ labels, comments }));
  const next = steadyMetrics(
    input({ period: { since: '2026-11-13', until: '2026-11-14' }, labels, comments }),
  );
  assert.deepEqual(
    [first.escalation.labels, first.escalation.comments['stop-failures'], first.stops.failures],
    [1, 0, 0],
  );
  assert.deepEqual(
    [next.escalation.labels, next.escalation.comments['stop-failures'], next.stops.failures],
    [0, 1, 1],
  );
});

test('steadyMetrics: 위험도는 검증 App이 쓴 가장 최근 risk-gate 기록으로 가른다', () => {
  const m = steadyMetrics(
    input({
      prs: [pr(1), pr(2), pr(3), pr(4), pr(5), pr(6)],
      statuses: new Map<number, HeadStatus[]>([
        [1, [risk('위험도 낮음: 문서만')]],
        // 가장 최근 기록을 쓴다(받은 순서와 무관하다)
        [
          2,
          [
            risk('위험도 보통: 계획 risk: normal', { at: '2026-11-11T02:00:00Z' }),
            risk('위험도 높음, 제작자 head 승인: 보호 경로', { at: '2026-11-11T04:00:00Z' }),
            risk('위험도 높음: 제작자 head 승인 필요 — 보호 경로', { at: '2026-11-11T03:00:00Z' }),
          ],
        ],
        // 검증 App이 아닌 계정이 쓴 기록은 쓰지 않는다(더 최근이어도)
        [
          3,
          [
            risk('위험도 보통: 계획 risk: normal'),
            risk('위험도 낮음: 내가 썼다', { creator: 'someone', at: '2026-11-11T09:00:00Z' }),
          ],
        ],
        [4, [risk('위험도 낮음: 내가 썼다', { creator: 'someone' })]],
        // 다른 체크의 기록과, 문구가 맞지 않는 기록
        [5, [risk('위험도 낮음', { context: 'check' }), risk('판정 중')]],
      ]),
    }),
  );
  assert.deepEqual(m.risk, { low: 1, normal: 1, high: 1, unknown: 3 });
  // 검증 App의 login을 모르면 어느 기록도 쓰지 않는다
  const noBot = steadyMetrics(
    input({
      prs: [pr(1)],
      recorderBot: '',
      statuses: new Map([[1, [risk('위험도 낮음: x', { creator: '' })]]]),
    }),
  );
  assert.deepEqual(noBot.risk, { low: 0, normal: 0, high: 0, unknown: 1 });
});

test('steadyMetrics: PR 크기는 추가와 삭제 줄 수의 합이다', () => {
  const m = steadyMetrics(
    input({
      prs: [
        pr(1, { additions: 10, deletions: 2 }),
        pr(2, { additions: 300, deletions: 100 }),
        pr(3, { additions: 400, deletions: 1 }),
      ],
    }),
  );
  // 12, 400, 401 → 중앙값 400. 400줄을 넘는 것은 하나다
  assert.deepEqual(m.size, { median: 400, over400: 1 });
  assert.deepEqual(steadyMetrics(input()).size, { median: null, over400: 0 });
});

// ── 계획 생성 시각 ──

let plansRoot: string | null = null;

function plans(): string {
  if (plansRoot) return plansRoot;
  const root = tmp();
  const put = (rel: string, claimed: string | null) => {
    const file = path.join(root, 'docs/exec-plans', rel);
    mkdirSync(path.dirname(file), { recursive: true });
    const line = claimed === null ? '' : `claimed_at: ${claimed} # new-task가 채운다\n`;
    writeFileSync(file, `---\nid: x\nstatus: active\n${line}---\n\n# 계획\n`);
  };
  put('active/20261111-multi/plan.md', '2026-11-11T03:00:00+09:00');
  put('active/20261111-small.md', '2026-11-11T04:00:00Z');
  put('completed/20261101-done/plan.md', '2026-11-01T00:00:00Z');
  put('completed/20261102-old.md', '2026-11-02T00:00:00Z');
  put('active/20261111-empty.md', null);
  plansRoot = root;
  return root;
}

test('planClaimedAt: PR의 브랜치 이름으로 계획을 찾아 claimed_at을 읽는다', () => {
  const got = planClaimedAt(plans(), [
    pr(1, { head: 'feat/20261111-multi-s0' }),
    pr(2, { head: 'feat/20261111-multi-s1' }),
    pr(3, { head: 'fix/20261111-small' }),
    pr(4, { head: 'chore/20261101-done-s2' }),
    pr(5, { head: 'docs/20261102-old' }),
    // 계획 형식이 아닌 브랜치
    pr(6, { head: 'revert/123-abc' }),
    pr(7, { head: 'main' }),
    // 계획 파일이 없다
    pr(8, { head: 'feat/20261111-gone-s0' }),
    // claimed_at이 없는 계획
    pr(9, { head: 'feat/20261111-empty' }),
  ]);
  assert.deepEqual(
    [...got],
    [
      [1, '2026-11-11T03:00:00+09:00'],
      [2, '2026-11-11T03:00:00+09:00'],
      [3, '2026-11-11T04:00:00Z'],
      [4, '2026-11-01T00:00:00Z'],
      [5, '2026-11-02T00:00:00Z'],
    ],
  );
});

test('planClaimedAt과 steadyMetrics: 계획이 없는 PR과 둘째 step PR이 섞여도 리드타임이 맞다', () => {
  const prs = [
    pr(1, { head: 'feat/20261111-multi-s0', mergedAt: '2026-11-11T05:00:00Z' }),
    pr(2, { head: 'feat/20261111-multi-s1', mergedAt: '2026-11-12T05:00:00Z' }),
    pr(3, { head: 'revert/123-abc' }),
    pr(4, { head: 'feat/20261111-gone-s0' }),
  ];
  const m = steadyMetrics(input({ prs, planClaimedAt: planClaimedAt(plans(), prs) }));
  // 계획 생성은 2026-11-10T18:00:00Z다. 11시간(660분)과 35시간(2100분)
  assert.deepEqual(m.leadTime, { medianMin: 1380, maxMin: 2100, noPlan: 2 });
});

// ── 실행 조회 범위 ──

test('pilotMetrics: 기간 전의 실행이 더 들어와도 Actions 실행 시간은 같다', () => {
  const inPeriodRuns = [run({ event: 'push', branch: 'main' }), run({ runNumber: 2 })];
  const earlier = [
    run({
      createdAt: '2026-11-09T02:00:00Z',
      startedAt: '2026-11-09T02:00:00Z',
      updatedAt: '2026-11-09T03:00:00Z',
    }),
    run({
      path: '.github/workflows/judge-codex.yml',
      conclusion: 'failure',
      createdAt: '2026-11-10T23:59:59Z',
      startedAt: '2026-11-10T23:59:59Z',
      updatedAt: '2026-11-11T00:30:00Z',
    }),
  ];
  const base = {
    period: P,
    defaultBranch: 'main',
    priorMainCheck: 'success' as const,
    prs: [pr(1)],
    bugs: [],
    ledgers: new Map<number, Ledger | null>(),
  };
  const narrow = pilotMetrics({ ...base, runs: inPeriodRuns });
  const wide = pilotMetrics({ ...base, runs: [...earlier, ...inPeriodRuns] });
  assert.equal(narrow.usage.actionsMin, 20);
  assert.deepEqual(wide, narrow);
});

// ── 렌더 ──

test('renderBlock: 상시 지표 절을 파일럿 지표 아래에 낸다', () => {
  const prs = [pr(1), pr(2, { additions: 500, deletions: 0 })];
  const pilot = pilotMetrics({
    period: P,
    defaultBranch: 'main',
    priorMainCheck: 'success',
    prs,
    runs: [],
    bugs: [],
    ledgers: new Map(),
  });
  const steady = steadyMetrics(
    input({
      prs,
      runs: [run()],
      ledgers: new Map<number, Ledger | null>([
        [1, ledger(['claude', 'codex', 'codex', 'codex', 'codex'])],
      ]),
      statuses: new Map([[1, [risk('위험도 높음, 제작자 head 승인: 보호 경로')]]]),
      planClaimedAt: new Map([[1, '2026-11-11T03:00:00Z']]),
      labels: [{ issue: 7, at: '2026-11-11T05:00:00Z' }],
      comments: [{ issue: 7, at: '2026-11-11T05:00:00Z', kind: 'stop-failures' }],
    }),
  );
  const text = renderBlock(P, pilot, steady);
  const at = (s: string) => text.split('\n').indexOf(s);
  assert.ok(at('### 파일럿 판정 지표') > 0);
  assert.ok(at('### 상시 지표') > at('### 파일럿 판정 지표'));
  const section = text.split('### 상시 지표')[1];
  for (const expected of [
    /^- PR 리드타임\(계획 생성 → 병합\): 중앙값 120분 · 최대 120분$/m,
    /^ {2}- 계획을 찾지 못한 PR: 1건$/m,
    /^- CI 첫 통과율: 1건 ÷ 실행을 찾은 PR 1건 = 100\.0%$/m,
    /^ {2}- 실행을 이을 수 없는 PR: 0건$/m,
    /^ {2}- 이을 수 있지만 실행을 찾지 못한 PR: 1건$/m,
    /^- PR당 리뷰 라운드 수: 중앙값 2회 · 최대 4회$/m,
    /^ {2}- 3라운드를 넘은 PR: 1건\(#1\)$/m,
    /^ {2}- `needs-human` 라벨이 붙은 횟수: 1건$/m,
    /5회 실패 중단 1건/,
    /^- 5회 중단: 1건 · 총량 상한 도달: 0건$/m,
    /^- 위험도별 PR 수: 낮음 0개 · 보통 0개 · 높음 1개 · 알 수 없음 1개$/m,
    /^- PR 크기\(추가 \+ 삭제 줄 수\): 중앙값 256줄 · 400줄을 넘는 PR 1건$/m,
  ])
    assert.match(section, expected);
  // 표를 쓰지 않는다
  assert.ok(!text.split('\n').some((l) => l.startsWith('|')));
  // 상시 지표를 주지 않으면 파일럿 지표만 낸다(step0의 출력 그대로다)
  assert.equal(renderBlock(P, pilot), text.split('\n\n### 상시 지표')[0]);
});

test('renderBlock: 값이 없는 상시 지표는 —와 이유를 적는다', () => {
  const pilot = pilotMetrics({
    period: P,
    defaultBranch: 'main',
    priorMainCheck: null,
    prs: [],
    runs: [],
    bugs: [],
    ledgers: new Map(),
  });
  const text = renderBlock(P, pilot, steadyMetrics(input()));
  assert.match(text, /^- PR 리드타임\(계획 생성 → 병합\): —\(계획을 찾은 PR 없음\)$/m);
  assert.match(text, /^- CI 첫 통과율: —\(실행을 찾은 PR 없음\)$/m);
  assert.match(text, /^- PR당 리뷰 라운드 수: —\(병합 PR 없음\)$/m);
  assert.match(text, /^- PR 크기\(추가 \+ 삭제 줄 수\): —\(병합 PR 없음\)$/m);
});
