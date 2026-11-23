// runner의 지적 대응(계속): 원장 작성자 확인, 계획 검증 단계의 대응, 검증자 한쪽만 실패한 판정,
// 반박(형식·근거 검사 뒤 PR 댓글. 계획 20261115-runner-pr-flow step4)과 그 도우미(rebuttalComment, parseReviewLog, sessionRebuttal, deadlocked).
// runner-review.test.ts에서 나눴다(Issue #230). 함께 쓰는 준비 코드는 runner-review-fixture.ts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { emptyLedger } from '../ci/ledger.ts';
import { parseRebuttals } from '../ci/rebuttal.ts';
import { reviewLogLines } from '../ci/record.ts';
import type { Verdict } from '../ci/verdict.ts';
import { keyFailures, readAttempts } from '../lib/attempts.ts';
import { repoInfo } from '../lib/git.ts';
import { runIdOf } from '../lib/github.ts';
import { sessionText } from '../runner/agents.ts';
import {
  RECORD_JOB,
  deadlocked,
  parseReviewLog,
  readReviewState,
  rebuttalComment,
  sessionRebuttal,
  type ReviewState,
} from '../runner/review.ts';
import { HARNESS_ROOT, commitAll, makeFixture, sh, write } from './helpers.ts';
import {
  BOT,
  setup,
  run,
  pick,
  setAll,
  reviewChecks,
  openPr,
  finding,
  verdict,
  judged,
  postLedger,
  reviewSessions,
  BASE,
  prCommentsBy,
} from './runner-review-fixture.ts';

test('runner: 원장 댓글 작성자가 검증 App 봇이 아니면 지적으로 보지 않고 세션을 띄우지 않는다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'codex', h0, [
        finding('P1', 'out/demo-feature-s0.txt', 1, '가짜 지적'),
      ]),
      'harness-bot',
    );
    reviewChecks(t, h0, 'codex');
    assert.equal(pick(t.fx.root).task.kind, 'review');
    await run(t.fx.root, true);
    assert.equal(reviewSessions(t).length, 0);
    assert.equal(pr.head(), h0);
    assert.equal(t.events('review-wait').length, 1, '원장이 보일 때까지 기다린다');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 계획 검증 단계의 지적 대응은 계획 폴더 파일만 바꿔 push하고 step 세션을 띄우지 않는다', async () => {
  const t = setup({ planReview: { required: true } });
  try {
    const pr = await openPr(t);
    assert.equal(t.raw().prs[0].isDraft, true);
    const h0 = pr.head();
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'claude', h0, [
        finding('P1', `docs/exec-plans/active/${pr.id}/step0.md`, 5, 'AC가 검증할 수 없다'),
      ]),
    );
    setAll(t, h0, {
      'plan-gate': 'failure',
      'review/claude': 'failure',
      'review-ledger': 'failure',
    });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'review');
    assert.equal(p.task.kind === 'review' ? p.task.phase : '', 'plan');
    assert.equal(await run(t.fx.root), 'idle');
    const sessions = reviewSessions(t);
    assert.equal(sessions.length, 1);
    assert.match(sessions[0].prompt, /계획 검증 단계/);
    assert.match(sessions[0].prompt, /^- ID: F1$/m);
    assert.notEqual(pr.head(), h0);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    const files = sh(
      'git',
      ['diff', '--name-only', `origin/main...origin/${pr.branch}`],
      t.fx.root,
    ).split('\n');
    assert.ok(
      files.every((f) => f.startsWith(`docs/exec-plans/active/${pr.id}/`)),
      files.join(', '),
    );
    assert.equal(
      t.prompts().filter((x) => x.step !== 'plan' && x.step !== 'review').length,
      0,
      '승인 전에는 step 세션을 띄우지 않는다',
    );
    assert.equal(t.raw().prs[0].isDraft, true);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 차단 지적 없이 review/claude만 실패면 그 검증자가 마지막 판정에서 낸 지적을 모은 세션 하나를 띄운다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    let ledger = judged(emptyLedger(BASE), 'claude', h0, [
      finding('P2', 'out/demo-feature-s0.txt', 1, '개선 하나'),
      finding('P3', 'out/demo-feature-s0.txt', 2, '취향 하나'),
    ]);
    ledger = judged(ledger, 'codex', h0, [
      finding('P2', 'out/demo-feature-s0.txt', 9, '코덱스의 개선'),
    ]);
    postLedger(t, pr.number, ledger);
    reviewChecks(t, h0, 'claude', 'success');
    assert.equal(pick(t.fx.root).task.kind, 'review');
    assert.equal(await run(t.fx.root), 'idle');
    const sessions = reviewSessions(t);
    assert.equal(sessions.length, 1);
    assert.match(sessions[0].prompt, /^- ID: F1$/m);
    assert.match(sessions[0].prompt, /^- ID: F2$/m);
    assert.doesNotMatch(
      sessions[0].prompt,
      /코덱스의 개선/,
      '수정을 요청한 검증자의 지적만 넘긴다',
    );
    const h1 = pr.head();
    assert.notEqual(h1, h0);
    assert.deepEqual(readReviewState(pr.worktree).responses['review:claude'], [
      { head: h1, kind: 'fix', counted: false },
    ]);
    // 그 검증자가 새 head를 판정했는데도 수정 요청이고 낸 지적이 없으면: 실패로 세고 사람에게 넘긴다
    ledger = judged(ledger, 'claude', h1, []);
    postLedger(t, pr.number, ledger);
    reviewChecks(t, h1, 'claude', 'success');
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(reviewSessions(t).length, 1);
    assert.equal(keyFailures(readAttempts(repoInfo(pr.worktree)), pr.id).get('review:claude'), 1);
    assert.ok(t.raw().issues[0].labels.includes('needs-human'));
    assert.match(
      t.raw().issues[0].comments.find((c) => c.body.includes('## 중단 보고'))!.body,
      /등록된 지적이 없다/,
    );
  } finally {
    t.fx.cleanup();
  }
});

const paragraph = (id: string, evidence: string, summary: string) =>
  `- 지적: ${id}\n- 근거: ${evidence}\n- 요지: ${summary}`;

/** runner가 다는 반박 댓글: 형식 문단들을 코드 블록 안에 둔다(문단 앞뒤는 빈 줄) */
const fenced = (...paragraphs: string[]) => ['```text', ...paragraphs, '```'].join('\n\n');

test('rebuttalComment: 반박 문단을 코드 블록 안에 달아 GitHub이 멘션·마크다운을 해석하지 않고, 판정 워크플로는 같은 값을 읽는다', () => {
  const ledger = judged(emptyLedger(BASE), 'codex', BASE, [
    finding('P1', 'src/a.ts', 1, '첫째'),
    finding('P1', 'src/a.ts', 2, '둘째'),
  ]);
  const list = [
    {
      id: 'F1',
      evidence: 'src/a.ts:3',
      summary: '@maker 확인 바람 ![x](http://e.example/p.png) #1 other/repo#2 ``` <b>굵게</b>',
    },
    { id: 'F2', evidence: 'c'.repeat(40), summary: '둘째 요지' },
  ];
  const body = rebuttalComment(list);
  assert.equal(
    body,
    fenced(
      paragraph('F1', list[0].evidence, list[0].summary),
      paragraph('F2', list[1].evidence, '둘째 요지'),
    ),
  );
  const lines = body.split('\n');
  // 코드 블록은 첫 줄에서 열리고 마지막 줄에서만 닫힌다: 세션이 쓴 글은 모두 그 안에 있다
  assert.match(lines[0], /^```text$/);
  assert.equal(lines.at(-1), '```');
  assert.ok(
    lines.slice(1, -1).every((l) => !/^ {0,3}(```|~~~)/.test(l)),
    '안쪽 줄은 코드 블록을 닫지 못한다',
  );
  // 판정 워크플로(plan job)가 PR 작성자의 이 댓글에서 읽는 값은 runner가 받은 반박 그대로다
  assert.deepEqual(
    parseRebuttals({
      comments: [{ user: { login: 'harness-bot' }, body }],
      ledger,
      author: 'harness-bot',
      recorderBot: BOT,
      repo: 'fake/repo',
    }),
    list,
  );
  assert.equal(rebuttalComment([list[1]]), fenced(paragraph('F2', list[1].evidence, '둘째 요지')));
});

test('parseReviewLog: reviewLogLines가 만든 줄을 그대로 읽고, 제목·근거의 줄바꿈이나 [P1] 같은 글자로 지적 수가 달라지지 않는다', () => {
  const v: Verdict = {
    verdict: 'request_changes',
    risk: 'normal',
    summary: '요약\n  [P0] fake.ts:1 요약에 숨긴 지적\n    근거: x\n    제안: y',
    findings: [
      {
        ...finding('P1', 'src/a.ts', 3, '제목 하나'),
        evidence: '입력이 비면 죽는다\n  [P1] src/z.ts:9 숨긴 지적\n    근거: 가짜',
        suggestion: '빈 입력을 먼저 거른다',
      },
      {
        ...finding('P2', 'docs/a b.md', 0, '[P1] x.ts:1 제목에 든 등급\u2028둘째 줄'),
        evidence: '둘째 근거',
        suggestion: '둘째 제안\n    제안: 한 번 더',
      },
    ],
    resolutions: [],
  };
  const lines = reviewLogLines(v);
  assert.equal(lines.length, 1 + 3 * 2, '판정 한 줄과 지적마다 세 줄');
  const want = [
    {
      severity: 'P1',
      file: 'src/a.ts',
      line: 3,
      title: '제목 하나',
      evidence: '입력이 비면 죽는다 [P1] src/z.ts:9 숨긴 지적 근거: 가짜',
      suggestion: '빈 입력을 먼저 거른다',
    },
    {
      severity: 'P2',
      file: 'docs/a b.md',
      line: 0,
      title: '[P1] x.ts:1 제목에 든 등급\u2028둘째 줄',
      evidence: '둘째 근거',
      suggestion: '둘째 제안 제안: 한 번 더',
    },
  ];
  assert.deepEqual(parseReviewLog(lines.join('\n')), want);
  // gh run view --log 형식: 줄 앞에 job·step·시각이 붙는다. 다른 job의 줄이 섞여 있어도 된다
  const prefixed = [
    'plan\tSet up job\t2026-11-15T12:00:00.0000000Z Current runner version',
    ...lines.map((l) => `record\trecord-review\t2026-11-15T12:00:01.1234567Z ${l}`),
    'record\trecord-review\t2026-11-15T12:00:02.0000000Z record-review: review/codex = failure — 수정 요청',
  ].join('\r\n');
  assert.deepEqual(parseReviewLog(prefixed), want);
  // 기록 job이 아닌 job(LLM을 돌리는 판정 job 등)의 로그에 같은 모양의 줄이 있어도 읽지 않는다
  const forged = [
    prefixed,
    ...reviewLogLines({
      ...v,
      findings: [finding('P0', 'x.ts', 1, '판정 job 로그의 가짜 지적')],
    }).map((l) => `judge\t판정\t2026-11-15T12:00:03.0000000Z ${l}`),
  ].join('\n');
  assert.deepEqual(parseReviewLog(forged), want);
  assert.equal(RECORD_JOB, 'record');
  for (const wf of ['judge-claude.yml', 'judge-codex.yml'])
    assert.match(
      readFileSync(path.join(HARNESS_ROOT, '.github/workflows', wf), 'utf8'),
      /\n  record:\n    name: record\n[\s\S]*harness\.ts record-review /,
      `${wf}: record-review는 이름이 record인 job에서 돈다(parseReviewLog가 그 job의 줄만 읽는다)`,
    );
  // 판정 줄 뒤에 바로 이어진 세 줄 묶음만 읽는다
  assert.deepEqual(parseReviewLog('  [P1] a.ts:1 판정 줄 없는 지적\n    근거: x\n    제안: y'), []);
  assert.deepEqual(parseReviewLog(''), []);
  assert.deepEqual(
    parseReviewLog(reviewLogLines({ ...v, findings: [] }).join('\n')),
    [],
    '지적 없는 판정',
  );
  // 실행에 판정 줄이 여럿이면 마지막 것을 쓴다
  const twice = [...reviewLogLines({ ...v, findings: [v.findings[1]] }), ...lines].join('\n');
  assert.equal(parseReviewLog(twice).length, 2);
});

test('sessionText·runIdOf: 세션의 마지막 출력과 이 리포의 Actions 실행 URL', () => {
  const body = paragraph('F1', 'a.ts', '요지');
  assert.equal(sessionText(`앞 글\n\n${body}\n`), `앞 글\n\n${body}\n`, '텍스트 출력은 그대로');
  const json = JSON.stringify({ type: 'result', subtype: 'success', result: `설명\n\n${body}` });
  assert.equal(sessionText(json + '\n'), `설명\n\n${body}`, 'Claude 결과 JSON이면 result');
  assert.equal(runIdOf('https://github.com/o/r/actions/runs/123', 'o/r'), '123');
  assert.equal(runIdOf('https://github.com/o/r/actions/runs/123/job/456', 'o/r'), '123');
  assert.equal(runIdOf('https://github.com/o/r/actions/runs/123/attempts/2', 'o/r'), '123');
  for (const bad of [
    'https://github.com/other/r/actions/runs/123',
    'https://github.com/o/r/actions/runs/12a',
    'https://github.com/o/r/actions/runs/123/../../x',
    'https://evil.example/o/r/actions/runs/123',
    'http://github.com/o/r/actions/runs/123',
    'https://github.com/o/r/pull/1',
    '',
  ])
    assert.equal(runIdOf(bad, 'o/r'), null, bad);
});

test('sessionRebuttal: 형식은 판정 워크플로와 같은 규칙으로 보고, 근거는 원격 브랜치의 커밋이나 리포에 있는 파일이어야 한다', () => {
  const fx = makeFixture();
  try {
    sh('git', ['checkout', '-q', '-b', 'feat/x'], fx.root);
    write(fx.root, 'src/a.ts', 'export const a = 1;\n');
    const pushed = commitAll(fx.root, 'pushed');
    sh('git', ['push', '-q', '-u', 'origin', 'feat/x'], fx.root);
    write(fx.root, 'src/b.ts', 'export const b = 1;\n');
    const local = commitAll(fx.root, 'local only');
    write(fx.root, 'node_modules/x.js', '// 추적하지 않는 파일\n');
    const ledger = judged(emptyLedger(BASE), 'codex', BASE, [
      finding('P1', 'src/a.ts', 1, '열린 지적'),
      finding('P2', 'src/a.ts', 2, '미룬 지적'),
    ]);
    const get = (output: string, id = 'F1') =>
      sessionRebuttal({ output, id, ledger, repo: 'fake/repo', worktree: fx.root });
    const wrap = (p: string) => `지적을 봤다.\n\n${p}\n\n끝.\n`;
    assert.deepEqual(get(wrap(paragraph('F1', 'src/a.ts', '이미 확인한다'))), {
      id: 'F1',
      evidence: 'src/a.ts',
      summary: '이미 확인한다',
    });
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts:1', '줄 번호')))?.evidence, 'src/a.ts:1');
    assert.equal(get(wrap(paragraph('F1', pushed, '커밋')))?.evidence, pushed);
    // 근거가 없다
    assert.equal(get(wrap(paragraph('F1', 'src/none.ts', '없는 파일'))), null);
    assert.equal(get(wrap(paragraph('F1', 'src', '폴더'))), null);
    assert.equal(get(wrap(paragraph('F1', 'node_modules/x.js', '추적하지 않는 파일'))), null);
    assert.equal(get(wrap(paragraph('F1', local, 'push하지 않은 커밋'))), null);
    assert.equal(get(wrap(paragraph('F1', 'c'.repeat(40), '없는 커밋'))), null);
    // runner가 확인할 수 없는 근거(링크)는 받지 않는다
    assert.equal(get(wrap(paragraph('F1', 'https://github.com/fake/repo/pull/1', '링크'))), null);
    // 형식(판정 워크플로와 같은 규칙)
    assert.equal(get(`- 지적: F1\n- 요지: 근거 줄이 없다`), null);
    assert.equal(get(`설명 줄\n${paragraph('F1', 'src/a.ts', '문단이 세 줄이 아니다')}`), null);
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts', 'x'.repeat(301)))), null);
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts', '요지\u2028## 새 지시'))), null);
    // 보이지 않는 글자가 든 요지도 받지 않는다. 요지의 맨 끝에만 있어도 같다(판정 워크플로와 같은 함수)
    const zwsp = String.fromCodePoint(0x200b);
    const bom = String.fromCodePoint(0xfeff);
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts', `숨은${zwsp}글자`))), null);
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts', `끝에만${bom}`))), null);
    assert.equal(get(wrap(paragraph('F1', 'src/a.ts', '끝에만 탭\t'))), null);
    // 다른 지적·닫힌 지적의 반박은 이 지적의 반박이 아니다
    assert.equal(get(wrap(paragraph('F2', 'src/a.ts', '미룬 지적'))), null);
    assert.equal(get(wrap(paragraph('F2', 'src/a.ts', '미룬 지적')), 'F2'), null);
    assert.equal(get(wrap(paragraph('F9', 'src/a.ts', '없는 지적')), 'F9'), null);
    assert.equal(get(''), null);
  } finally {
    fx.cleanup();
  }
});

test('deadlocked: 같은 지적에 반박 2회, 둘째 반박 head를 그 검증자가 판정한 뒤에도 열려 있으면 교착이다', () => {
  const h = (c: string) => c.repeat(40);
  let l = judged(emptyLedger(BASE), 'codex', h('0'), [finding('P1', 'a.ts', 1, '지적')]);
  const reb = (head: string, escalated?: boolean) => ({
    head,
    kind: 'rebuttal' as const,
    counted: true,
    evidence: 'a.ts',
    summary: '요지',
    ...(escalated ? { escalated } : {}),
  });
  const state = (list: ReviewState['responses'][string]): ReviewState => ({
    responses: { F1: list },
    round: null,
    pending: [],
    rebuttals: {},
    reverted: null,
  });
  const twice = state([reb(h('1')), reb(h('2'))]);
  l = judged(l, 'codex', h('1'), [], [{ id: 'F1', status: 'open', note: '' }]);
  assert.deepEqual(deadlocked(twice, l), [], '둘째 반박 head를 아직 판정하지 않았다');
  assert.deepEqual(deadlocked(twice, judged(l, 'claude', h('2'), [])), [], '다른 검증자의 판정');
  const open = judged(l, 'codex', h('2'), [], [{ id: 'F1', status: 'open', note: '' }]);
  assert.deepEqual(deadlocked(twice, open), ['F1']);
  assert.deepEqual(deadlocked(state([reb(h('2'))]), open), [], '반박 1회');
  assert.deepEqual(
    deadlocked(state([reb(h('1')), { head: h('2'), kind: 'fix', counted: true }]), open),
    [],
    '마지막 대응이 수정이다',
  );
  assert.deepEqual(
    deadlocked(state([reb(h('1'), true), reb(h('2'), true)]), open),
    [],
    '이미 올린 교착은 다시 올리지 않는다',
  );
  const closed = judged(l, 'codex', h('2'), [], [{ id: 'F1', status: 'rejected', note: '' }]);
  assert.deepEqual(deadlocked(twice, closed), [], '반박이 받아들여졌다');
});

test('runner: 형식이 맞고 근거 파일이 있는 반박은 형식 문단만 PR 댓글로 달고, 수정 커밋이 없어도 계획 전용 커밋을 push한다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'codex', h0, [
        finding('P1', 'out/demo-feature-s0.txt', 1, '틀린 지적'),
      ]),
    );
    reviewChecks(t, h0, 'codex');
    writeFileSync(t.behavior, JSON.stringify({ 'demo-feature': { steps: 1, review: ['rebut'] } }));
    assert.equal(await run(t.fx.root), 'idle');
    const sessions = reviewSessions(t);
    assert.equal(sessions.length, 1);
    assert.match(sessions[0].prompt, /## 반박/);
    assert.match(sessions[0].prompt, /^- 지적: F1$/m, '프롬프트에 반박 형식이 있다');
    const mine = prCommentsBy(t, pr.number, 'harness-bot');
    assert.equal(mine.length, 1);
    assert.equal(
      mine[0].body,
      fenced(paragraph('F1', 'out/demo-feature-s0.txt', 'F1는 이 step의 범위 밖이다')),
      '댓글 본문은 코드 블록에 넣은 형식 문단뿐이다(세션의 다른 글은 넣지 않는다)',
    );
    const h1 = pr.head();
    assert.notEqual(h1, h0, '수정 커밋이 없어도 새 커밋을 올린다(다음 판정은 새 커밋에서 돈다)');
    const files = sh('git', ['diff', '--name-only', h0, h1], pr.worktree).split('\n');
    assert.ok(
      files.every((f) => f.startsWith('docs/exec-plans/')),
      `계획 파일만 바뀐다: ${files.join(', ')}`,
    );
    const plan = sh(
      'git',
      ['show', `${h1}:docs/exec-plans/completed/${pr.id}/plan.md`],
      pr.worktree,
    );
    assert.match(plan, /^- \S+ F1 반박$/m, '진행 로그에 한 줄');
    const state = readReviewState(pr.worktree);
    assert.deepEqual(state.responses.F1, [
      {
        head: h1,
        kind: 'rebuttal',
        counted: false,
        evidence: 'out/demo-feature-s0.txt',
        summary: 'F1는 이 step의 범위 밖이다',
      },
    ]);
    assert.deepEqual(state.pending, []);
    assert.deepEqual(state.rebuttals, {});
    assert.equal(t.events('review-pushed').length, 1);
    assert.equal(
      readAttempts(repoInfo(pr.worktree)).filter((a) => a.key === 'F1' && !a.ok).length,
      0,
      '반박은 실패가 아니다',
    );
    // 원장은 runner가 바꾸지 않는다
    assert.equal(prCommentsBy(t, pr.number, BOT).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 형식이 틀린 반박은 댓글로 달지 않고 F<번호> 실패로 센다. 파일을 바꾼 세션의 반박 문단은 무시하고 수정으로 판정한다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'codex', h0, [finding('P1', 'out/demo-feature-s0.txt', 1, '지적')]),
    );
    reviewChecks(t, h0, 'codex');
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'demo-feature': { steps: 1, review: ['rebut-bad', 'fix-rebut'] } }),
    );
    await run(t.fx.root, true);
    assert.equal(pr.head(), h0, 'push하지 않는다');
    assert.equal(prCommentsBy(t, pr.number, 'harness-bot').length, 0, '댓글을 달지 않는다');
    const fails = readAttempts(repoInfo(pr.worktree)).filter((a) => a.key === 'F1' && !a.ok);
    assert.equal(fails.length, 1);
    assert.match(fails[0].detail ?? '', /아무것도 바꾸지 않았다/);
    assert.match(fails[0].detail ?? '', /반박/);
    assert.doesNotMatch(
      fails[0].detail ?? '',
      /근거 줄이 없다/,
      '세션 출력은 실패 기록에 넣지 않는다',
    );
    // 다음 세션은 파일을 고치고 반박 문단도 낸다: 수정으로만 판정한다
    assert.equal(await run(t.fx.root), 'idle');
    const h1 = pr.head();
    assert.notEqual(h1, h0);
    assert.equal(prCommentsBy(t, pr.number, 'harness-bot').length, 0, '반박 댓글은 없다');
    assert.deepEqual(readReviewState(pr.worktree).responses.F1, [
      { head: h1, kind: 'fix', counted: false },
    ]);
    assert.match(sh('git', ['log', '--format=%s', `${h0}..${h1}`], pr.worktree), /fix\(F1\)/);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 판정에 실패해 되돌린 수정 뒤에 온 반박은 판정을 한 번 거친 뒤 올린다(올라간 코드는 대응 전과 같다)', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'codex', h0, [finding('P1', 'out/demo-feature-s0.txt', 1, '지적')]),
    );
    reviewChecks(t, h0, 'codex');
    // 첫 세션이 AC를 깨뜨린다(runner가 되돌린다). 다음 세션은 파일을 바꾸지 않고 반박한다
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'demo-feature': { steps: 1, review: ['break', 'rebut'] } }),
    );
    await run(t.fx.root, true);
    assert.equal(pr.head(), h0);
    assert.notEqual(
      sh('git', ['rev-parse', 'HEAD'], pr.worktree).trim(),
      h0,
      'push하지 않은 커밋이 남는다',
    );
    assert.equal(await run(t.fx.root), 'idle');
    const h1 = pr.head();
    assert.notEqual(h1, h0, '반박을 올린다');
    assert.equal(prCommentsBy(t, pr.number, 'harness-bot').length, 1);
    assert.equal(
      sh(
        'git',
        ['diff', '--name-only', h0, h1, '--', '.', ':(exclude)docs/exec-plans'],
        pr.worktree,
      ).trim(),
      '',
      '깨진 수정은 되돌려진 채 올라간다',
    );
    const judgedOk = readAttempts(repoInfo(pr.worktree)).filter((a) => a.kind === 'ac' && a.ok);
    assert.ok(judgedOk.length >= 1, '반박을 받기 전에 AC를 다시 돌렸다');
    assert.equal(readReviewState(pr.worktree).responses.F1.at(-1)!.kind, 'rebuttal');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 계획 검증 단계의 반박은 계획 폴더 파일만 바꾼 커밋을 push한다', async () => {
  const t = setup({ planReview: { required: true } });
  try {
    const pr = await openPr(t);
    const h0 = pr.head();
    const file = `docs/exec-plans/active/${pr.id}/plan.md`;
    postLedger(
      t,
      pr.number,
      judged(emptyLedger(BASE), 'claude', h0, [finding('P1', file, 5, '계획 지적')]),
    );
    setAll(t, h0, {
      'plan-gate': 'failure',
      'review/claude': 'failure',
      'review-ledger': 'failure',
    });
    writeFileSync(t.behavior, JSON.stringify({ 'demo-feature': { steps: 1, review: ['rebut'] } }));
    assert.equal(await run(t.fx.root), 'idle');
    const mine = prCommentsBy(t, pr.number, 'harness-bot');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].body, fenced(paragraph('F1', file, 'F1는 이 step의 범위 밖이다')));
    const h1 = pr.head();
    assert.notEqual(h1, h0);
    const files = sh('git', ['diff', '--name-only', h0, h1], pr.worktree).split('\n');
    assert.deepEqual(files, [file]);
    assert.equal(readReviewState(pr.worktree).responses.F1[0].kind, 'rebuttal');
    assert.equal(t.raw().prs[0].isDraft, true);
  } finally {
    t.fx.cleanup();
  }
});
