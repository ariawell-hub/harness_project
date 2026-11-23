// runner의 열린 질문: 질문 댓글의 형식, 계획·step 세션이 남긴 질문으로 멈췄다가 답으로 이어 가기(TD-18·TD-19·TD-24),
// 충돌에 대한 제작자 답(TD-27), 질문을 올리지 못했을 때의 전달(Issue #211)의 앞부분.
// runner.test.ts에서 나눴다(Issue #230). 함께 쓰는 준비 코드는 runner-fixture.ts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { newTask } from '../commands/task.ts';
import { readAttempts } from '../lib/attempts.ts';
import { gitTry, repoInfo, listWorktrees } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue } from '../lib/github-fake.ts';
import { openQuestions, parseDoc } from '../lib/plan.ts';
import { classifyEscalation } from '../metrics/source.ts';
import { readQuestionState, writeQuestionState } from '../runner/next.ts';
import { questionComment } from '../runner/run.ts';
import { sh } from './helpers.ts';
import { fencedBlocks } from './markdown-model.ts';
import {
  setup,
  run,
  openPR,
  onceRunner,
  conflictPrompts,
  QUESTION_ARGS,
  BOT,
  LABEL,
  TITLE,
  patchGh,
  qsOf,
  botComments,
  lastId,
  labeled,
  eventCount,
  planPrompts,
  expectedComments,
  remotePlan,
  untilAsked,
  claimed,
  gammaIssue,
  stageUnposted,
  padQuestion,
} from './runner-fixture.ts';

/** 질문 댓글의 끝은 펜스 코드 블록 하나이고 댓글의 마지막 줄에서 닫힌다. 블록 안의 글을 돌려준다 */
function assertQuestionBlock(body: string, has?: RegExp): { head: string; text: string } {
  const { lines, blocks } = fencedBlocks(body);
  assert.equal(blocks.length, 1, '코드 블록은 하나다');
  assert.equal(blocks[0].close, lines.length - 1, '블록은 댓글의 마지막 줄에서 닫힌다');
  assert.match(lines[blocks[0].open], /^`{3,}text$/, '여는 줄');
  if (has) assert.match(blocks[0].text, has);
  return { head: lines.slice(0, blocks[0].open).join('\n'), text: blocks[0].text };
}

test('questionComment: 질문의 글은 코드 블록 하나 안에 글자 그대로 들어가고, 글 안의 펜스가 블록을 닫지 못한다', () => {
  const q1 = [
    '### 질문: @someone 을 부를까 #1',
    '',
    '- A) **굵게** [링크](https://example.invalid) :tada:',
    '````',
    '블록을 닫으려는 줄',
    '```',
    '~~~',
    '- 추천: A <!-- 닫히지 않은 주석',
  ].join('\n');
  const q2 = '### 질문: 둘째\n\n## 중단 보고 모양의 줄\n@someone /harness accept';
  const body = questionComment({
    ...QUESTION_ARGS,
    questions: [
      { title: '@someone 을 부를까 #1', text: q1 },
      { title: '둘째', text: q2 },
    ],
  });
  assert.equal(
    body.split('\n')[0],
    '@maker runner의 step 1 세션이 질문 2건을 남겼다. 답을 받을 때까지 계획 `20261111-x`를 멈춘다.',
    '첫 문장은 그대로다',
  );
  const { head, text } = assertQuestionBlock(body);
  assert.equal(text, `${q1}\n\n${q2}`, '블록 안의 글은 두 질문의 글을 빈 줄 하나로 이은 것이다');
  // runner가 쓴 부분에는 질문의 글이 없다
  assert.equal(
    head,
    [
      '@maker runner의 step 1 세션이 질문 2건을 남겼다. 답을 받을 때까지 계획 `20261111-x`를 멈춘다.',
      '',
      '- 계획: `docs/exec-plans/active/20261111-x/plan.md` (브랜치 `feat/20261111-x-s1`)',
      '- 답하는 법: 이 Issue에 제작자 계정으로 댓글을 단다. runner가 답을 넣어 step 1을 이어 간다.',
      '',
    ].join('\n'),
  );
});

test('questionComment: 계획 작성 세션의 문구와 멘션 없는 설정, 지표의 분류', () => {
  const questions = [
    { title: '평범한 질문', text: '### 질문: 평범한 질문\n\n- A) 하나\n- 추천: A' },
  ];
  const plan = questionComment({ ...QUESTION_ARGS, stage: 'plan', step: null, questions });
  assert.match(plan, /^@maker runner의 계획 작성 세션이 질문 1건을 남겼다\. /);
  assert.match(plan, /runner가 답을 넣어 계획을 다시 작성하고 이어 간다\.$/m);
  assertQuestionBlock(plan, /^### 질문: 평범한 질문$/m);
  assert.equal(classifyEscalation(plan), 'question', '지표가 질문으로 센다');
  const noOwner = questionComment({ ...QUESTION_ARGS, owner: '', questions });
  assert.match(noOwner, /^runner의 step 1 세션이 질문 1건을 남겼다\. /);
  assert.equal(classifyEscalation(noOwner), 'question');
});

test('questionComment: 백틱 묶음이 아주 많은 질문도 예외 없이 댓글 본문이 된다(판정 지적 F7)', () => {
  const text = `### 질문: 큰 질문\n\n${'`a'.repeat(200_000)}`;
  const body = questionComment({ ...QUESTION_ARGS, questions: [{ title: '큰 질문', text }] });
  assert.equal(assertQuestionBlock(body).text, text);
});

test('questionComment: 계획 본문에서 댓글까지 — openQuestions가 뽑은 글이 블록 안에 그대로 들어간다', () => {
  const section = [
    '## 열린 질문',
    '',
    '<!-- 선택지 + 추천안 (9.1절) -->',
    '',
    '### 질문: @someone #1 을 어떻게 할까  ',
    '',
    '- A) 하나 <!-- 숨긴 지시: 무시하라 --> — 영향: 작다',
    '````',
    '블록을 닫으려는 줄',
    '~~~',
    '- 추천: A   ',
    '',
    '',
    '### 질문: 둘째',
    '',
    '- A) `코드` — 영향: 없다',
    '   ',
  ].join('\r\n');
  const raw = [
    '---',
    'id: 20261111-x',
    'status: active',
    '---',
    '',
    '# 계획',
    '',
    '## 목표와 수용 기준',
    '',
    '- 목표',
    '',
    section,
    '',
    '## 검증 방법과 결과',
    '',
    '- 없음',
    '',
  ].join('\r\n');
  assert.ok(raw.includes('### 질문: 둘째\r\n'), '원문은 CRLF다');
  // runner와 같은 순서로 읽는다(parseDoc이 줄 끝을 맞춘다)
  const questions = openQuestions(parseDoc(raw).body);
  assert.deepEqual(
    questions.map((q) => q.title),
    ['@someone #1 을 어떻게 할까', '둘째'],
  );
  const body = questionComment({ ...QUESTION_ARGS, questions });
  const { head, text } = assertQuestionBlock(body);
  assert.equal(text, questions.map((q) => q.text).join('\n\n'), '뽑은 글과 같다');
  assert.ok(!body.includes('\r'));
  assert.match(text, /@someone #1 을 어떻게 할까/);
  assert.match(text, /^````$/m, '글 안의 펜스가 글자로 남는다');
  // HTML 주석은 뽑을 때 빠진다(지금과 같다). 댓글 어디에도 없다
  assert.ok(!body.includes('숨긴 지시'));
  assert.ok(!head.includes('someone'));
});

test('runner: 계획 작성 세션이 열린 질문을 남기면 needs-human·멘션으로 한 번 올리고 멈췄다가, 답을 넣어 계획을 다시 쓰고 이어 간다 (TD-18)', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Gamma feature', '질문이 필요한 기능');
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'gamma-feature': { plan: ['question', 'ok'], steps: 1 } }),
    );
    assert.equal(await run(t.fx.root), 'human', '답을 기다리면 멈춘다');
    let issue = t.gh().issues[0];
    assert.ok(issue.labels.includes('needs-human'), 'Issue에 needs-human');
    const asked = issue.comments.filter((c) => c.body.includes('데모 질문'));
    assert.equal(asked.length, 1, '질문을 한 번 올린다');
    assert.match(asked[0].body, /@maker/, '제작자 멘션');
    assert.match(asked[0].body, /추천: A/, '질문 블록 전문');
    assertQuestionBlock(asked[0].body, /^### 질문: 데모 질문$/m);
    assert.equal(t.gh().prs.length, 0, 'step으로 넘어가지 않았다');
    assert.ok(
      !t.prompts().some((p) => p.slug === 'gamma-feature' && p.step !== 'plan'),
      'step 세션을 띄우지 않았다',
    );
    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('gamma-feature'))!;
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    const planRel = sh(
      'git',
      ['ls-tree', '-r', '--name-only', `origin/${wt.branch}`, 'docs/exec-plans/active/'],
      t.fx.root,
    )
      .split('\n')
      .find((f) => f.endsWith('/plan.md'))!;
    assert.match(
      sh('git', ['show', `origin/${wt.branch}:${planRel}`], t.fx.root),
      /^status: blocked/m,
      '멈춘 계획을 push했다',
    );

    // 답을 기다리는 동안 다시 돌려도 같은 질문을 또 올리지 않는다
    assert.equal(await run(t.fx.root), 'human');
    issue = t.gh().issues[0];
    assert.equal(issue.comments.filter((c) => c.body.includes('데모 질문')).length, 1);

    // 제작자 답 → 답을 넣어 계획을 다시 작성 → 이미 올린 질문만 남았으니 진행
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    assert.equal(await run(t.fx.root), 'idle');
    issue = t.gh().issues[0];
    assert.equal(issue.state, 'closed', '답을 받은 뒤 끝까지 간다');
    assert.ok(!issue.labels.includes('needs-human'));
    const plans = t.prompts().filter((p) => p.slug === 'gamma-feature' && p.step === 'plan');
    assert.equal(plans.length, 2, '답을 받은 뒤 계획을 다시 작성한다');
    assert.doesNotMatch(plans[0].prompt, /제작자 답변/);
    assert.match(plans[1].prompt, /제작자 답변[\s\S]*B로 하라/);
    assert.equal(
      issue.comments.filter((c) => c.body.includes('데모 질문')).length,
      1,
      '이미 올린 질문은 다시 올리지 않는다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 선점 뒤 계획 작성 전에 허용 계정이 아닌 계정이 Issue를 고치면 계획을 멈추고, 제작자 /harness accept 뒤 고친 내용으로 이어 간다 (TD-19)', async () => {
  const t = setup();
  try {
    const n = addFakeIssue(t.state, 'Delta feature', '원래 본문');
    await newTask(t.fx.root, {
      issue: n,
      slug: 'delta-feature',
      size: 'medium',
      owner: 'runner-1',
      github: false,
    });
    const gh = new FakeGitHub(t.state);
    gh.editIssueAs(n, 'harness-bot', { body: '봇이 고친 본문' });

    assert.equal(await run(t.fx.root), 'human', '확인을 기다린다');
    let issue = t.gh().issues[0];
    assert.ok(issue.labels.includes('needs-human'));
    const report = issue.comments.find((c) => c.body.includes('runner가 계획을 멈췄다'));
    assert.ok(report, '중단 보고');
    assert.match(report.body, /@maker/);
    assert.match(report.body, /harness-bot/);
    assert.match(report.body, /\/harness accept/, '확인 방법');
    assert.ok(
      !t.prompts().some((p) => p.slug === 'delta-feature'),
      '계획 작성 세션을 띄우지 않았다',
    );

    gh.ownerComment(n, '봤다.\n/harness accept');
    assert.equal(await run(t.fx.root), 'idle');
    issue = t.gh().issues[0];
    assert.equal(issue.state, 'closed', '승인 뒤 끝까지 간다');
    const plan = t.prompts().find((p) => p.slug === 'delta-feature' && p.step === 'plan');
    assert.match(plan!.prompt, /봇이 고친 본문/, '확인한 이력 조회의 본문을 넣는다');
  } finally {
    t.fx.cleanup();
  }
});

/**
 * 자동 해결이 한도(5회)까지 실패해 멈춘 PR에 제작자가 답하게 만든다. 답을 받는 바퀴와 갱신 바퀴를 한 번씩 돌린다.
 * `then`은 답을 받은 뒤 해결 세션의 동작이다
 */

async function answerConflict(t: ReturnType<typeof setup>, answer: string, then: 'ok' | 'fail') {
  writeFileSync(
    t.behavior,
    JSON.stringify({ demo: { conflict: ['fail', 'fail', 'fail', 'fail', 'fail', then] } }),
  );
  assert.equal(await run(t.fx.root), 'human');
  new FakeGitHub(t.state).ownerComment(1, answer);
  await onceRunner(t.fx.root); // 답 받음
  await onceRunner(t.fx.root); // 충돌 해결 시도
}

test('runner: 한도에 닿아 멈춘 충돌에 제작자가 답하면 답을 넣은 해결 세션 뒤, runner가 판정해 병합 커밋을 일반 push한다 (TD-27)', async () => {
  const t = setup();
  try {
    const task = await openPR(t, 'DIRTY', 'main\n');
    await answerConflict(t, '양쪽을 모두 살려라', 'ok');
    assert.equal(conflictPrompts(t).length, 6, '답을 받은 뒤 해결 세션을 다시 띄웠다');
    const prompt = conflictPrompts(t).at(-1)!;
    assert.match(prompt.prompt, /## 충돌 파일\n- `shared\.txt`/);
    assert.match(prompt.prompt, /양쪽을 모두 살려라/, '제작자 답을 넣는다');
    assert.equal(
      gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], task.worktree).ok,
      false,
      '병합을 마쳤다',
    );
    const shared = readFileSync(path.join(task.worktree, 'shared.txt'), 'utf8');
    assert.doesNotMatch(shared, /^(<{7}|>{7})/m, '충돌 표시 없음');
    assert.match(shared, /pr/);
    assert.match(shared, /main/);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    assert.ok(
      gitTry(['merge-base', '--is-ancestor', 'origin/main', `origin/${task.branch}`], t.fx.root).ok,
      '해결한 병합 커밋을 push했다',
    );
    const resolved = readAttempts(repoInfo(task.worktree)).filter((a) => a.key === 'pr:conflict');
    assert.deepEqual(
      resolved.map((a) => a.ok),
      [false, false, false, false, false, true],
    );
    assert.ok(!t.gh().issues[0].labels.includes('needs-human'));
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 해결 세션이 충돌을 풀지 못하면 병합을 취소하고 push하지 않으며 pr:conflict 실패로 센다 (TD-27)', async () => {
  const t = setup();
  try {
    const task = await openPR(t, 'DIRTY', 'main\n');
    const head = sh('git', ['rev-parse', 'HEAD'], task.worktree);
    writeFileSync(t.behavior, JSON.stringify({ demo: { conflict: ['fail'] } }));
    await onceRunner(t.fx.root);
    assert.equal(conflictPrompts(t).length, 1);
    assert.equal(
      gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], task.worktree).ok,
      false,
      '병합을 취소했다',
    );
    assert.equal(sh('git', ['rev-parse', 'HEAD'], task.worktree), head, 'HEAD 그대로');
    assert.equal(sh('git', ['status', '--porcelain'], task.worktree), '', 'worktree 깨끗');
    assert.equal(
      sh('git', ['ls-remote', 'origin', `refs/heads/${task.branch}`], t.fx.root).split(/\s+/)[0],
      head,
      '원격 그대로',
    );
    const fails = readAttempts(repoInfo(task.worktree)).filter((a) => a.key === 'pr:conflict');
    assert.equal(fails.length, 1);
    assert.equal(fails[0].ok, false);
    assert.match(fails[0].detail ?? '', /shared\.txt/);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: step 세션이 열린 질문을 남기면 판정 전에 needs-human·멘션으로 한 번 올리고 멈췄다가, 답을 넣어 그 step을 이어 간다 (TD-24)', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Epsilon feature', '스텝 질문이 필요한 기능');
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'epsilon-feature': { '0': ['question', 'ok'], steps: 1 } }),
    );
    assert.equal(await run(t.fx.root), 'human', '답을 기다리면 멈춘다');
    let issue = t.gh().issues[0];
    assert.ok(issue.labels.includes('needs-human'));
    const asked = issue.comments.filter((c) => c.body.includes('스텝 질문'));
    assert.equal(asked.length, 1, '질문을 한 번 올린다');
    assert.match(asked[0].body, /@maker/);
    assert.match(asked[0].body, /step 0/);
    assert.match(asked[0].body, /추천: A/, '질문 블록 전문');
    assertQuestionBlock(asked[0].body, /^### 질문: 스텝 질문$/m);
    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('epsilon-feature'))!;
    assert.equal(
      readAttempts(repoInfo(wt.path)).filter((a) => a.kind === 'ac').length,
      0,
      'AC로 판정하지 않았다',
    );
    assert.equal(t.gh().prs.length, 0, 'PR을 만들지 않았다');

    assert.equal(await run(t.fx.root), 'human');
    assert.equal(
      t.gh().issues[0].comments.filter((c) => c.body.includes('스텝 질문')).length,
      1,
      '다시 돌려도 같은 질문을 또 올리지 않는다',
    );

    new FakeGitHub(t.state).ownerComment(1, 'A로 하라');
    assert.equal(await run(t.fx.root), 'idle');
    issue = t.gh().issues[0];
    assert.equal(issue.state, 'closed', '답을 받은 뒤 끝까지 간다');
    assert.ok(!issue.labels.includes('needs-human'));
    const steps = t.prompts().filter((p) => p.slug === 'epsilon-feature' && p.step === '0');
    assert.equal(steps.length, 2, '같은 step을 다시 띄운다');
    assert.doesNotMatch(steps[0].prompt, /제작자 답변/);
    assert.match(steps[1].prompt, /제작자 답변[\s\S]*A로 하라/);
    assert.match(steps[0].prompt, /### 질문:/, 'step 프롬프트가 질문 형식을 안내한다');
    assert.equal(
      t.prompts().filter((p) => p.slug === 'epsilon-feature' && p.step === 'plan').length,
      1,
      '계획을 다시 쓰지 않는다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 질문을 올리지 못하면 올린 것으로 적지 않고, 풀리면 한 번 올린 뒤에야 답을 기다린다 (Issue #211, 계획 작성 단계)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['down'];
    });
    await untilAsked(t);
    assert.equal(botComments(t).length, 0, '봇 댓글이 없다');
    assert.ok(!labeled(t), '댓글을 올리지 못했으면 라벨도 붙이지 않는다');
    assert.equal(t.gh().commentCalls, 1, '불확실한 실패 뒤에 안내 댓글을 올리지 않았다');
    let qs = qsOf(t);
    assert.deepEqual(qs.reported, [], '올린 것으로 적지 않았다');
    assert.equal(qs.unposted, true);
    assert.equal(qs.base, lastId(t), '기준은 질문을 올리기로 한 때의 마지막 댓글의 번호다');
    assert.match(String(qs.base), /^[1-9]\d*$/);
    assert.match(remotePlan(t), /^status: blocked/m, '멈춘 계획을 push했다');
    assert.equal(eventCount(t, 'questions-unposted'), 1);

    assert.equal(await run(t.fx.root), 'human', '올린 뒤에야 사람의 답을 기다린다고 멈춘다');
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [expectedComments(t).question],
      '질문 댓글을 한 번, questionComment의 본문 그대로 올린다',
    );
    assert.ok(labeled(t));
    qs = qsOf(t);
    assert.deepEqual(qs.reported, [TITLE]);
    assert.equal(qs.unposted, false);
    assert.equal(eventCount(t, 'questions-posted'), 1);

    assert.equal(await run(t.fx.root), 'human');
    assert.equal(botComments(t).length, 1, '다시 돌려도 더 올리지 않는다');

    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed', '답을 받은 뒤 끝까지 간다');
    assert.match(planPrompts(t)[1].prompt, /제작자 답변[\s\S]*B로 하라/);
    assert.equal(botComments(t).filter((c) => c.body.includes(TITLE)).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: step 세션의 질문도 올리지 못하면 다시 올리고, 답을 받으면 그 step을 이어 간다 (Issue #211)', async () => {
  const t = setup();
  const slug = 'epsilon-feature';
  try {
    addFakeIssue(t.state, 'Epsilon feature', '스텝 질문이 필요한 기능');
    writeFileSync(t.behavior, JSON.stringify({ [slug]: { '0': ['question', 'ok'], steps: 1 } }));
    await claimed(t, slug);
    patchGh(t, (s) => {
      s.commentFaults = ['down'];
    });
    await untilAsked(t, slug);
    assert.equal(botComments(t).length, 0);
    assert.ok(!labeled(t));
    let qs = qsOf(t, slug);
    assert.deepEqual(qs.reported, []);
    assert.equal(qs.unposted, true);
    assert.equal(qs.stage, 'step');

    assert.equal(await run(t.fx.root), 'human');
    const want = expectedComments(t, slug, 'step').question;
    assert.match(want, /step 0 세션이 질문 1건을 남겼다/);
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [want],
    );
    qs = qsOf(t, slug);
    assert.deepEqual(qs.reported, ['스텝 질문']);
    assert.equal(qs.unposted, false);

    new FakeGitHub(t.state).ownerComment(1, 'A로 하라');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed');
    const steps = t.prompts().filter((p) => p.slug === slug && p.step === '0');
    assert.equal(steps.length, 2, '같은 step을 다시 띄운다');
    assert.match(steps[1].prompt, /제작자 답변[\s\S]*A로 하라/);
    assert.equal(botComments(t).filter((c) => c.body.includes('스텝 질문')).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 게시 응답을 잃으면 다음 주기에 이미 올라간 댓글을 찾아 올린 것으로 적고 더 올리지 않는다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['lost'];
    });
    await untilAsked(t);
    assert.equal(botComments(t).length, 1, '댓글은 남았다');
    assert.ok(!labeled(t));
    assert.equal(qsOf(t).unposted, true);
    assert.deepEqual(qsOf(t).reported, []);

    await onceRunner(t.fx.root);
    assert.equal(t.gh().commentCalls, 1, '아무것도 더 올리지 않았다');
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [expectedComments(t).question],
    );
    assert.ok(labeled(t));
    assert.deepEqual(qsOf(t).reported, [TITLE]);
    assert.equal(qsOf(t).unposted, false);
  } finally {
    t.fx.cleanup();
  }
  // 안내 댓글에서 응답을 잃은 경우
  const n = setup();
  try {
    const st = await stageUnposted(n);
    padQuestion(n, st.planFile, 70_000);
    patchGh(n, (s) => {
      s.commentFaults = ['lost'];
    });
    await onceRunner(n.fx.root);
    assert.equal(n.gh().commentCalls, 1);
    assert.equal(botComments(n).length, 1);
    assert.ok(!labeled(n));
    assert.equal(qsOf(n).unposted, true);

    await onceRunner(n.fx.root);
    assert.equal(n.gh().commentCalls, 1, '안내 댓글을 더 올리지 않았다');
    assert.deepEqual(
      botComments(n).map((c) => c.body),
      [expectedComments(n).notice],
    );
    assert.ok(labeled(n));
    assert.deepEqual(qsOf(n).reported, [TITLE]);
    assert.equal(qsOf(n).unposted, false);
  } finally {
    n.fx.cleanup();
  }
});

test('runner: 응답을 잃은 질문에 제작자가 바로 답하면 올린 것으로 적고 그 답을 받는다. 같은 질문을 다시 올리지 않는다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['lost'];
    });
    await untilAsked(t);
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');

    await onceRunner(t.fx.root);
    assert.equal(t.gh().commentCalls, 1, '봇 댓글을 더 올리지 않았다');
    assert.deepEqual(qsOf(t).reported, [TITLE]);
    assert.equal(eventCount(t, 'answered'), 1, '그 댓글을 답으로 받았다');

    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed');
    assert.match(planPrompts(t)[1].prompt, /제작자 답변[\s\S]*B로 하라/);
    assert.equal(
      botComments(t).filter((c) => c.body.includes(TITLE)).length,
      1,
      '세션이 같은 질문을 남겨도 다시 올리지 않는다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 응답을 잃었고 라벨이 먼저 붙어 있었고 라벨을 다시 붙이지 못해도, 올린 것으로 적어 같은 질문을 다시 올리지 않는다 (Issue #211, 판정 지적 F6)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    // 선점한 뒤(라벨이 붙은 Issue는 새로 맡지 않는다) 다른 이유로 라벨이 붙어 있다
    new FakeGitHub(t.state).addLabel(1, LABEL);
    patchGh(t, (s) => {
      s.commentFaults = ['lost'];
    });
    await untilAsked(t);
    assert.equal(botComments(t).length, 1);
    assert.equal(qsOf(t).unposted, true);
    assert.deepEqual(qsOf(t).reported, []);

    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    patchGh(t, (s) => {
      s.labelFaults = 1;
    });
    await onceRunner(t.fx.root);
    assert.equal(t.gh().labelFaults, 0, '라벨을 붙이려다 실패했다');
    assert.deepEqual(qsOf(t).reported, [TITLE], '라벨을 붙이지 못했어도 올린 것으로 적는다');
    assert.equal(eventCount(t, 'answered'), 1, '먼저 붙어 있던 라벨로 답을 받았다');

    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed');
    assert.equal(botComments(t).filter((c) => c.body.includes(TITLE)).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 기준 댓글이 목록에 없어도 번호로 이번 질문의 댓글을 찾고, 앞선 질문의 같은 댓글은 이번 전달로 보지 않는다 (Issue #211, 판정 지적 F7)', async () => {
  for (const kind of ['absent', 'same-second', 'older'] as const) {
    const t = setup();
    try {
      const st = await stageUnposted(t);
      const want = expectedComments(t).question;
      const at = '2026-11-22T00:00:00.000Z';
      patchGh(t, (s) => {
        const list = s.issues[0].comments;
        // 기준 댓글(번호 6)과 같은 초에 올라간 질문 댓글
        if (kind === 'same-second')
          list.push({ id: '6', author: 'someone', body: '다른 댓글', createdAt: at });
        list.push({ id: kind === 'older' ? '3' : '7', author: BOT, body: want, createdAt: at });
      });
      // absent: 기준 댓글(번호 6)이 지워졌거나 읽는 범위 밖으로 밀려 목록에 없다
      writeQuestionState(st.info, {
        ...readQuestionState(st.info),
        base: kind === 'older' ? '5' : '6',
      });
      await onceRunner(t.fx.root);
      if (kind === 'older') {
        assert.equal(t.gh().commentCalls, 1, '번호가 기준보다 작은 봇 댓글은 앞선 질문의 것이다');
        assert.equal(botComments(t).length, 2);
      } else {
        assert.equal(t.gh().commentCalls, 0, `${kind}: 아무것도 더 올리지 않는다`);
        assert.equal(botComments(t).length, 1);
      }
      assert.deepEqual(qsOf(t).reported, [TITLE], kind);
      assert.equal(qsOf(t).unposted, false, kind);
      assert.ok(labeled(t), kind);
    } finally {
      t.fx.cleanup();
    }
  }
});
