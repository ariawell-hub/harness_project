// runner 통합 테스트(12.4절 4.5절 시나리오, 1단계 완료 기준 S6).
// 가짜 에이전트 + 가짜 GitHub(즉시 squash merge) + 로컬 bare 원격.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { newTask } from '../commands/task.ts';
import { readAttempts } from '../lib/attempts.ts';
import { gitTry, repoInfo, listWorktrees } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { openQuestions, parseDoc } from '../lib/plan.ts';
import { classifyEscalation } from '../metrics/source.ts';
import { parseSessionSummary } from '../runner/agents.ts';
import { readQuestionState, writeQuestionState } from '../runner/next.ts';
import { questionComment, questionNotice, runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, advanceRemote, commitAll, makeFixture, sh, write } from './helpers.ts';
import { fencedBlocks } from './markdown-model.ts';

function setup(configOver: Record<string, unknown> = {}) {
  const fx = makeFixture(configOver);
  const state = path.join(fx.dir, 'gh.json');
  const behavior = path.join(fx.dir, 'behavior.json');
  const logFile = path.join(fx.dir, 'prompts.jsonl');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
  writeFileSync(behavior, '{}');
  writeFileSync(logFile, '');
  process.env.HARNESS_FAKE_GH = state;
  process.env.HARNESS_FAKE_AGENT = path.join(HARNESS_ROOT, 'scripts/selftest/fake-agent.ts');
  process.env.FAKE_BEHAVIOR = behavior;
  process.env.FAKE_LOG = logFile;
  const gh = () => JSON.parse(readFileSync(state, 'utf8')) as FakeState;
  const prompts = () =>
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { slug: string; step: string; prompt: string });
  return { fx, state, behavior, gh, prompts };
}

const run = (root: string) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 80, noWait: true });

test('runner: Issue 하나를 계획 → step 2개 → 자동 병합까지 사람 없이 끝낸다 (S6)', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
    const stop = await run(t.fx.root);
    assert.equal(stop, 'idle');
    const s = t.gh();
    assert.equal(s.issues[0].state, 'closed', 'Closes #1로 Issue가 닫힌다');
    const prs = s.prs.filter((p) => p.state === 'merged');
    assert.equal(prs.length, 2, 'step 하나 = PR 하나');
    assert.match(prs[0].body, /^Refs #1/);
    assert.match(prs[1].body, /^Closes #1/);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    const tree = sh('git', ['ls-tree', '-r', '--name-only', 'origin/main'], t.fx.root);
    assert.match(tree, /out\/demo-feature-s0\.txt/);
    assert.match(tree, /out\/demo-feature-s1\.txt/);
    assert.match(tree, /docs\/exec-plans\/completed\/\d{8}-demo-feature\/plan\.md/);
    assert.doesNotMatch(
      sh('git', ['ls-remote', '--heads', 'origin'], t.fx.root),
      /claim\/1/,
      '마지막 step 병합 후 선점 해제',
    );
    assert.equal(listWorktrees(t.fx.root).length, 1, '병합된 worktree는 정리된다');
    const step1 = t.prompts().find((p) => p.step === '1');
    assert.match(
      step1!.prompt,
      /앞 step 요약[\s\S]*demo-feature-s0\.txt 생성/,
      '다음 step 프롬프트에 앞 step summary가 들어간다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 반복 실패는 5회에 멈추고 보고하며, 다음 Issue로 넘어가고, 제작자 답변 후 이어 간다', async () => {
  const t = setup({
    limits: { ...JSON.parse(JSON.stringify(baseLimits())), sessionTimeoutMin: 0.05 },
  });
  try {
    addFakeIssue(t.state, 'Alpha feature', 'A');
    addFakeIssue(t.state, 'Beta feature', 'B');
    writeFileSync(
      t.behavior,
      JSON.stringify({
        'alpha-feature': { '0': ['fail', 'timeout', 'limit', 'fail', 'fail', 'fail'] },
        'beta-feature': { steps: 1 },
      }),
    );
    const stop = await run(t.fx.root);
    assert.equal(stop, 'human', '사람 답변만 기다리면 멈춘다');
    let s = t.gh();
    const alpha = s.issues.find((i) => i.number === 1)!;
    const beta = s.issues.find((i) => i.number === 2)!;
    assert.ok(alpha.labels.includes('needs-human'));
    assert.ok(
      alpha.comments.some((c) => c.body.includes('## 중단 보고') && c.body.includes('@maker')),
    );
    assert.equal(alpha.state, 'open');
    assert.equal(beta.state, 'closed', '막힌 계획 대신 다음 Issue를 끝낸다');
    assert.ok(
      !s.prs.some((p) => p.head.includes('alpha') && p.state !== 'open'),
      '"완료"라고만 한 세션은 완료로 보지 않는다',
    );

    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('alpha'))!;
    const attempts = readAttempts(repoInfo(wt.path));
    assert.ok(
      attempts.some((a) => a.key === 'session:timeout' && !a.ok),
      '시간 초과는 실패로 센다',
    );
    assert.ok(
      attempts.some((a) => a.env),
      '사용량 한도는 환경 장애로 기록된다',
    );
    const alphaPrompts = t.prompts().filter((p) => p.slug === 'alpha-feature' && p.step === '0');
    assert.ok(
      alphaPrompts.some((p) => p.prompt.includes('방법 전환 지시')),
      '3회째부터 방법 전환을 지시한다',
    );
    assert.ok(!alphaPrompts[0].prompt.includes('방법 전환 지시'));

    // 제작자 답변 → 재개
    new FakeGitHub(t.state).ownerComment(1, 'AC는 그대로 두고 다시 시도하라');
    const stop2 = await run(t.fx.root);
    assert.equal(stop2, 'idle');
    s = t.gh();
    assert.equal(s.issues.find((i) => i.number === 1)!.state, 'closed');
    assert.ok(!s.issues.find((i) => i.number === 1)!.labels.includes('needs-human'));
    const resumed = t
      .prompts()
      .filter((p) => p.slug === 'alpha-feature' && p.step === '0')
      .at(-1)!;
    assert.match(resumed.prompt, /제작자 답변[\s\S]*AC는 그대로 두고/);
  } finally {
    t.fx.cleanup();
  }
});

function baseLimits() {
  return {
    sessionTimeoutMin: 1,
    acTimeoutSec: 60,
    stepFailedCheckLimit: 10,
    stepSessionMinutesLimit: 120,
    runnerMaxHours: 1,
    workers: 1,
    wipPerWorker: 2,
    claimExpiryHours: 24,
    usageLimitMaxWaitMin: 60,
    pollSec: 0,
  };
}

// ---- 세션 기록(Issue #16 step3): 무인 세션이 왜 멈췄는지 남긴다 ----

test('parseSessionSummary: Claude 결과 JSON에서 세션 id·턴·종료 이유·권한 거부를 뽑는다', () => {
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    num_turns: 3,
    terminal_reason: 'api_error',
    session_id: 'abc-123',
    result: 'x'.repeat(2000),
    permission_denials: [
      { tool_name: 'Bash', tool_input: { command: 'sed -n 1,9p ' + 'a'.repeat(400) } },
      { tool_name: 'Bash', tool_input: { command: 'find .' } },
    ],
  };
  const s = parseSessionSummary(JSON.stringify(result, null, 2))!;
  assert.equal(s.sessionId, 'abc-123');
  assert.equal(s.numTurns, 3);
  assert.equal(s.terminalReason, 'api_error');
  assert.equal(s.isError, true);
  assert.equal(s.denials.length, 2);
  assert.equal(s.denials[0].tool, 'Bash');
  assert.ok(s.denials[0].input.length <= 200, '입력은 200자로 자른다');
  assert.ok((s.result ?? '').length <= 500, '결과 문구도 자른다');
  // 여러 줄 출력(stream-json 등)이면 마지막 result 객체를 쓴다
  const lines = [
    '{"type":"system","session_id":"old"}',
    'not json',
    JSON.stringify({ ...result, session_id: 'last', permission_denials: [] }),
  ].join('\n');
  assert.equal(parseSessionSummary(lines)!.sessionId, 'last');
  assert.equal(parseSessionSummary('완료했습니다!'), null);
  assert.equal(parseSessionSummary(''), null);
});

test('runner: 세션마다 원본 출력과 session-end(세션 id·권한 거부 도구)를 남긴다', async () => {
  const t = setup();
  process.env.FAKE_RESULT_JSON = '1';
  try {
    addFakeIssue(t.state, 'Log demo', '세션 기록 확인');
    assert.equal(await run(t.fx.root), 'idle');
    const dir = path.join(repoInfo(t.fx.root).commonDir, 'harness');
    const ends = readFileSync(path.join(dir, 'runner.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.event === 'session-end');
    // 계획 작성 1 + step 2(기본 behavior)
    assert.equal(ends.length, 3, '세션마다 session-end');
    const planning = ends.find((e) => e.kind === 'planning')!;
    assert.match(String(planning.sessionId), /^fake-log-demo-plan$/);
    assert.equal(planning.denials, 3);
    assert.deepEqual(planning.deniedTools, ['Bash', 'WebFetch'], '도구 이름은 중복 없이');
    assert.equal(planning.turns, 7);
    const step0 = ends.find((e) => e.kind === 'step' && e.step === 0)!;
    assert.equal(step0.sessionId, 'fake-log-demo-0');
    for (const e of ends) {
      assert.ok(existsSync(String(e.log)), `원본 출력 파일: ${e.log}`);
      assert.match(readFileSync(String(e.log), 'utf8'), /permission_denials/);
    }
    assert.equal(readdirSync(path.join(dir, 'sessions')).length, 3);
  } finally {
    delete process.env.FAKE_RESULT_JSON;
    t.fx.cleanup();
  }
});

test('runner: 사용량 한도로 끝난 세션도 session-end를 남긴다', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Limit demo', '환경 장애 기록');
    writeFileSync(t.behavior, JSON.stringify({ 'limit-demo': { plan: ['limit'] } }));
    // 선점 → 계획 작성 세션(사용량 한도) → 대기 없이 종료
    await runRunner({
      cwd: t.fx.root,
      worker: 'runner-1',
      tool: 'fake',
      maxIterations: 4,
      noWait: true,
    });
    const dir = path.join(repoInfo(t.fx.root).commonDir, 'harness');
    const events = readFileSync(path.join(dir, 'runner.jsonl'), 'utf8');
    const end = events
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.event === 'session-end');
    assert.ok(end, 'env 장애여도 기록한다');
    assert.match(readFileSync(String(end.log), 'utf8'), /usage limit/);
  } finally {
    t.fx.cleanup();
  }
});

/**
 * runner-1 계획의 step0을 끝내고 PR을 연 상태를 만든다. PR 브랜치는 shared.txt를 'pr'로 바꾼다.
 * `mainShared`가 있으면 원격 main의 shared.txt를 그 내용으로 바꿔 충돌시킨다. 가짜 PR의 mergeState를 정한다.
 */
async function openPR(t: ReturnType<typeof setup>, mergeState: string, mainShared?: string) {
  addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
  const task = await newTask(t.fx.root, {
    issue: 1,
    slug: 'demo',
    size: 'medium',
    owner: 'runner-1',
    github: false,
    date: '20261112',
  });
  const plan = path.join(task.worktree, task.planFile);
  writeFileSync(plan, readFileSync(plan, 'utf8').replace(/^status: \w+/m, 'status: active'));
  write(
    task.worktree,
    path.join(path.dirname(task.planFile), 'index.json'),
    JSON.stringify({
      plan: '20261112-demo',
      steps: [{ step: 0, name: 'demo', status: 'completed' }],
    }),
  );
  write(task.worktree, 'shared.txt', 'pr\n');
  commitAll(task.worktree, 'pr: shared');
  sh('git', ['push', '-q', '-u', 'origin', task.branch], task.worktree);
  if (mainShared !== undefined) advanceRemote(t.fx, 'shared.txt', mainShared);
  const pr = new FakeGitHub(t.state).createPR({
    head: task.branch,
    base: 'main',
    title: 'demo',
    body: 'Refs #1',
  });
  const s = t.gh();
  s.prs.find((p) => p.number === pr.number)!.mergeState = mergeState;
  writeFileSync(t.state, JSON.stringify(s));
  return task;
}

const runnerEvents = (root: string) =>
  readFileSync(path.join(repoInfo(root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

test('runner: GitHub이 DIRTY라 해도 브랜치가 이미 최신이면 실패로 세지 않고 기다린다(헛도는 반복 방지)', async () => {
  const t = setup();
  try {
    const task = await openPR(t, 'DIRTY');
    const stop = await runRunner({
      cwd: t.fx.root,
      worker: 'runner-1',
      tool: 'fake',
      maxIterations: 3,
      noWait: true,
    });
    assert.equal(stop, 'max-iterations');
    assert.equal(
      runnerEvents(t.fx.root).filter((e) => e.event === 'wait-env').length,
      3,
      '바퀴마다 환경 대기로 처리',
    );
    assert.equal(
      readAttempts(repoInfo(task.worktree)).filter((a) => a.key === 'pr:update' && !a.ok).length,
      0,
      '실패로 세지 않는다',
    );
    assert.ok(!t.gh().issues[0].labels.includes('needs-human'));
  } finally {
    t.fx.cleanup();
  }
});

const onceRunner = (root: string) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', once: true, noWait: true });
const conflictPrompts = (t: ReturnType<typeof setup>) =>
  t.prompts().filter((p) => p.step === 'conflict');

test('runner: main과 충돌한(DIRTY) PR은 제작자 답 없이 충돌 해결 세션을 띄우고, 풀리면 병합 커밋을 일반 push한다 (TD-9)', async () => {
  const t = setup();
  try {
    const task = await openPR(t, 'DIRTY', 'main\n');
    const head = sh('git', ['rev-parse', 'HEAD'], task.worktree);
    writeFileSync(t.behavior, JSON.stringify({ demo: { conflict: ['ok'] } }));
    await onceRunner(t.fx.root);
    const prompts = conflictPrompts(t);
    assert.equal(prompts.length, 1, '답을 기다리지 않고 해결 세션을 띄운다');
    assert.match(prompts[0].prompt, /## 충돌 파일\n- `shared\.txt`/);
    assert.doesNotMatch(prompts[0].prompt, /제작자 답변/, '제작자 답이 없으므로 답변 절이 없다');
    const issue = t.gh().issues[0];
    assert.ok(!issue.labels.includes('needs-human'));
    assert.equal(issue.comments.filter((c) => /중단 보고/.test(c.body)).length, 0);
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
    assert.ok(
      gitTry(['merge-base', '--is-ancestor', head, `origin/${task.branch}`], t.fx.root).ok,
      '옛 head가 새 head의 조상이다(force push 없음)',
    );
    const attempts = readAttempts(repoInfo(task.worktree));
    assert.deepEqual(
      attempts.filter((a) => a.key === 'pr:conflict').map((a) => a.ok),
      [true],
    );
    assert.equal(attempts.filter((a) => a.key === 'pr:update' && !a.ok).length, 0);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 충돌 해결이 5회 실패하면 needs-human과 중단 보고를 한 번 올리고 그 뒤로는 답을 기다린다. 계획 파일은 바꾸지 않는다 (ADR-0006, TD-27)', async () => {
  const t = setup();
  try {
    const task = await openPR(t, 'DIRTY', 'main\n');
    const head = sh('git', ['rev-parse', 'HEAD'], task.worktree);
    writeFileSync(
      t.behavior,
      JSON.stringify({ demo: { conflict: ['fail', 'fail', 'fail', 'fail', 'fail', 'ok'] } }),
    );
    assert.equal(await run(t.fx.root), 'human', '한도에 닿으면 사람 답변을 기다린다');
    assert.equal(conflictPrompts(t).length, 5, '해결 세션은 5번까지다');
    assert.match(
      conflictPrompts(t)[3].prompt,
      /방법 전환 지시/,
      '3회 실패 뒤에는 방법 전환을 지시한다',
    );
    assert.equal(
      sh('git', ['rev-parse', 'HEAD'], task.worktree),
      head,
      '계획 커밋을 만들지 않았다',
    );
    assert.equal(
      sh('git', ['status', '--porcelain'], task.worktree),
      '',
      '계획 파일을 바꾸지 않았다',
    );
    assert.equal(
      sh('git', ['ls-remote', 'origin', `refs/heads/${task.branch}`], t.fx.root).split(/\s+/)[0],
      head,
      'PR 브랜치에 blocked를 push하지 않았다(PR plan-gate 유지)',
    );
    let issue = t.gh().issues[0];
    assert.ok(issue.labels.includes('needs-human'), 'Issue에 needs-human');
    assert.equal(issue.comments.filter((c) => /중단 보고/.test(c.body)).length, 1);
    assert.match(issue.comments.at(-1)!.body, /shared\.txt/);
    assert.match(issue.comments.at(-1)!.body, /@maker/);
    assert.equal(
      gitTry(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], task.worktree).ok,
      false,
      '병합을 취소했다',
    );
    const fails = readAttempts(repoInfo(task.worktree)).filter((a) => a.key === 'pr:conflict');
    assert.deepEqual(
      fails.map((a) => a.ok),
      [false, false, false, false, false],
    );
    // 답을 기다리는 동안에는 세션도 보고도 더 없다
    assert.equal(await run(t.fx.root), 'human');
    issue = t.gh().issues[0];
    assert.equal(conflictPrompts(t).length, 5);
    assert.equal(
      issue.comments.filter((c) => /중단 보고/.test(c.body)).length,
      1,
      '같은 중단 보고를 반복하지 않는다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('runner: step 완료 push가 거부되고 원격 브랜치가 갈라졌으면 덮어쓰지 않고 멈춰 보고한다 (Issue #27)', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Diverge demo', '원격 브랜치 갈라짐');
    const task = await newTask(t.fx.root, {
      issue: 1,
      slug: 'diverge',
      size: 'medium',
      owner: 'runner-1',
      github: false,
      date: '20261112',
    });
    // 다른 곳에서 같은 브랜치에 커밋이 올라간 상태를 만든다
    sh('git', ['push', '-q', '-u', 'origin', task.branch], task.worktree);
    const other = advanceRemote(t.fx, 'other.txt', 'o\n', { branch: task.branch });

    assert.equal(await run(t.fx.root), 'human', '사람 답변만 기다리면 멈춘다');
    const remoteHead = sh(
      'git',
      ['ls-remote', t.fx.remote, `refs/heads/${task.branch}`],
      t.fx.root,
    ).split(/\s+/)[0];
    assert.equal(remoteHead, other, '원격 브랜치를 덮어쓰지 않았다');
    const s = t.gh();
    assert.ok(s.issues[0].labels.includes('needs-human'), 'Issue에 needs-human');
    assert.match(s.issues[0].comments.at(-1)!.body, /로컬에 없는 커밋/);
    assert.equal(s.prs.length, 0, 'PR을 만들지 않았다');
  } finally {
    t.fx.cleanup();
  }
});

/** 질문 댓글의 끝은 펜스 코드 블록 하나이고 댓글의 마지막 줄에서 닫힌다. 블록 안의 글을 돌려준다 */
function assertQuestionBlock(body: string, has?: RegExp): { head: string; text: string } {
  const { lines, blocks } = fencedBlocks(body);
  assert.equal(blocks.length, 1, '코드 블록은 하나다');
  assert.equal(blocks[0].close, lines.length - 1, '블록은 댓글의 마지막 줄에서 닫힌다');
  assert.match(lines[blocks[0].open], /^`{3,}text$/, '여는 줄');
  if (has) assert.match(blocks[0].text, has);
  return { head: lines.slice(0, blocks[0].open).join('\n'), text: blocks[0].text };
}

const QUESTION_ARGS = {
  owner: 'maker',
  stage: 'step' as const,
  step: 1,
  planId: '20261111-x',
  planFile: 'docs/exec-plans/active/20261111-x/plan.md',
  branch: 'feat/20261111-x-s1',
};

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

// ---- 올리지 못한 질문 (Issue #211) ----
// 질문 댓글을 올리지 못하면 올린 것으로 적지 않고, 계획을 멈춘 채 주기마다 다시 본다.

const BOT = 'harness-bot';
const LABEL = 'needs-human';
const SLUG = 'gamma-feature';
const TITLE = '데모 질문';
type Setup = ReturnType<typeof setup>;

const patchGh = (t: Setup, fn: (s: FakeState) => void) => {
  const s = t.gh();
  fn(s);
  writeFileSync(t.state, JSON.stringify(s));
};
const wtOf = (t: Setup, slug: string) =>
  listWorktrees(t.fx.root).find((w) => w.branch?.includes(slug));
const qsOf = (t: Setup, slug = SLUG) => readQuestionState(repoInfo(wtOf(t, slug)!.path));
/** Issue에 봇 계정이 단 질문 댓글과 안내 댓글(선점 때 다는 댓글 같은 다른 봇 댓글은 뺀다) */
const botComments = (t: Setup, issue = 0) =>
  t
    .gh()
    .issues[issue].comments.filter((c) => c.author === BOT && /질문 \d+건을 남겼다/.test(c.body));
/** Issue의 마지막 댓글의 번호 */
const lastId = (t: Setup, issue = 0) => t.gh().issues[issue].comments.at(-1)?.id;
const labeled = (t: Setup, issue = 0) => t.gh().issues[issue].labels.includes(LABEL);
const eventCount = (t: Setup, name: string) =>
  runnerEvents(t.fx.root).filter((e) => e.event === name).length;
const planPrompts = (t: Setup, slug = SLUG) =>
  t.prompts().filter((p) => p.slug === slug && p.step === 'plan');

/** 계획 파일의 리포 상대 경로 */
function planRelOf(t: Setup, slug: string): string {
  const dir = readdirSync(path.join(wtOf(t, slug)!.path, 'docs/exec-plans/active')).find((d) =>
    d.endsWith(slug),
  )!;
  return `docs/exec-plans/active/${dir}/plan.md`;
}

/** runner가 지금의 계획 파일로 만드는 질문 댓글과 안내 댓글 */
function expectedComments(t: Setup, slug = SLUG, stage: 'plan' | 'step' = 'plan') {
  const wt = wtOf(t, slug)!;
  const planFile = planRelOf(t, slug);
  const args = {
    owner: 'maker',
    stage,
    step: 0,
    planId: path.basename(path.dirname(planFile)),
    planFile,
    branch: wt.branch!,
    questions: openQuestions(parseDoc(readFileSync(path.join(wt.path, planFile), 'utf8')).body),
  };
  return { question: questionComment(args), notice: questionNotice(args), args };
}

/** 원격 브랜치에 올라간 계획 파일 */
function remotePlan(t: Setup, slug = SLUG): string {
  sh('git', ['fetch', '-q', 'origin'], t.fx.root);
  return sh('git', ['show', `origin/${wtOf(t, slug)!.branch}:${planRelOf(t, slug)}`], t.fx.root);
}

/** 세션이 질문을 남겨 runner가 답을 기다리기 시작한 주기까지 한 주기씩 돌린다 */
async function untilAsked(t: Setup, slug = SLUG): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await onceRunner(t.fx.root);
    if (wtOf(t, slug) && qsOf(t, slug).waiting) return;
  }
  assert.fail('질문을 남기는 주기에 닿지 못했다');
}

/**
 * 선점하는 주기까지 돌린다(아직 세션은 뜨지 않았다). 선점 때 봇이 Issue에 댓글을 하나 단다: 그 뒤에
 * 가짜의 댓글 호출 수를 0으로 되돌려, 뒤의 단언이 질문 전달의 호출만 세게 한다
 */
async function claimed(t: Setup, slug = SLUG): Promise<void> {
  for (let i = 0; i < 5 && !wtOf(t, slug); i++) await onceRunner(t.fx.root);
  assert.ok(wtOf(t, slug), '선점했다');
  assert.equal(t.prompts().filter((p) => p.slug === slug).length, 0, '아직 세션이 뜨기 전이다');
  patchGh(t, (s) => {
    s.commentCalls = 0;
  });
}

/** 계획 작성 세션이 질문을 남기는 Issue를 만들고 선점까지 돌린다 */
async function gammaIssue(t: Setup, plan: string[] = ['question', 'ok']): Promise<void> {
  addFakeIssue(t.state, 'Gamma feature', '질문이 필요한 기능');
  writeFileSync(t.behavior, JSON.stringify({ [SLUG]: { plan, steps: 1 } }));
  await claimed(t);
}

/**
 * 질문을 올리지 못한 채 멈춘 디스크 상태를 만든다: 계획은 blocked로 커밋·push됐고, 질문 상태는
 * `{ waiting: true, unposted: true, base }`이고, 봇 댓글도 라벨도 없다. 그 뒤 가짜의 호출 수를 0으로 되돌린다.
 * `before`는 선점 뒤, 질문 전에 Issue에 댓글을 달아 둔다
 */
async function stageUnposted(t: Setup, before?: (gh: FakeGitHub) => void) {
  await gammaIssue(t);
  before?.(new FakeGitHub(t.state));
  patchGh(t, (s) => {
    s.commentFaults = ['down'];
  });
  await untilAsked(t);
  assert.equal(botComments(t).length, 0);
  assert.ok(!labeled(t));
  assert.equal(qsOf(t).unposted, true);
  patchGh(t, (s) => {
    s.commentCalls = 0;
  });
  const wt = wtOf(t, SLUG)!;
  return { wt, info: repoInfo(wt.path), planFile: path.join(wt.path, planRelOf(t, SLUG)) };
}

/** 계획 파일의 질문 본문 한 줄에 글자를 더해 질문 댓글의 길이를 정확히 `length`로 맞춘다 */
function padQuestion(t: Setup, planFile: string, length: number): void {
  const line = '- A) 하나 — 영향: 작다';
  const original = readFileSync(planFile, 'utf8');
  assert.ok(original.includes(line));
  const base = expectedComments(t).question.length;
  assert.ok(length > base + 1);
  // 긴 백틱 줄: 코드 블록 안에 글자 그대로 들어간다
  const n = length - base - 1;
  const pad = '`a'.repeat(Math.floor(n / 2)) + (n % 2 ? 'x' : '');
  writeFileSync(planFile, original.replace(line, `${line} ${pad}`));
  assert.equal(expectedComments(t).question.length, length);
}

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

test('runner: GitHub이 질문 댓글의 본문을 거부하면(HTTP 422) 같은 주기에 안내 댓글을 올린다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['reject'];
    });
    await untilAsked(t);
    assert.equal(t.gh().commentCalls, 2, '질문 댓글이 거부된 뒤 안내 댓글을 올렸다');
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [expectedComments(t).notice],
      '봇 댓글은 안내 댓글 하나다',
    );
    assert.ok(labeled(t));
    assert.deepEqual(qsOf(t).reported, [TITLE]);
    assert.equal(qsOf(t).unposted, false);
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(botComments(t).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 질문 댓글이 길이 상한을 넘으면 보내지 않고 안내 댓글을 올린다. 경계는 65,536자다 (Issue #211)', async () => {
  const t = setup();
  try {
    const st = await stageUnposted(t);
    padQuestion(t, st.planFile, 70_000);
    const { question, notice, args } = expectedComments(t);
    assert.equal(question.length, 70_000);
    await onceRunner(t.fx.root);
    assert.equal(t.gh().commentCalls, 1, '넘는 본문은 보내지 않았다');
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [notice],
    );
    assert.match(notice, /^@maker /);
    assert.ok(notice.includes(`\`${args.planFile}\``));
    assert.ok(notice.includes(`\`${args.branch}\``));
    assert.ok(!notice.includes(TITLE), '질문의 제목이 없다');
    assert.ok(!notice.includes('영향: 작다'), '질문의 본문이 없다');
    assert.deepEqual(qsOf(t).reported, [TITLE]);
    assert.ok(labeled(t));
    assert.match(
      remotePlan(t),
      /^### 질문: 데모 질문$/m,
      '제작자가 읽을 질문이 원격 브랜치에 있다',
    );
    assert.equal(await run(t.fx.root), 'human');
  } finally {
    t.fx.cleanup();
  }
  for (const length of [65_536, 65_537]) {
    const b = setup();
    try {
      const st = await stageUnposted(b);
      padQuestion(b, st.planFile, length);
      const { question, notice } = expectedComments(b);
      assert.equal(question.length, length);
      await onceRunner(b.fx.root);
      assert.equal(b.gh().commentCalls, 1);
      assert.deepEqual(
        botComments(b).map((c) => c.body),
        [length === 65_536 ? question : notice],
        `${length}자`,
      );
    } finally {
      b.fx.cleanup();
    }
  }
});

test('runner: 안내 댓글은 멈춘 계획을 push한 뒤에만 올린다 (Issue #211)', async () => {
  const t = setup();
  try {
    const st = await stageUnposted(t);
    padQuestion(t, st.planFile, 70_000);
    // push만 실패하게 한다(fetch는 된다)
    sh('git', ['config', 'remote.origin.pushurl', path.join(t.fx.dir, 'no-such.git')], t.fx.root);
    await onceRunner(t.fx.root);
    assert.equal(t.gh().commentCalls, 0, '질문이 원격에 없으면 안내 댓글도 올리지 않는다');
    assert.equal(botComments(t).length, 0);
    assert.equal(qsOf(t).unposted, true);
    assert.deepEqual(qsOf(t).reported, []);

    sh('git', ['config', '--unset', 'remote.origin.pushurl'], t.fx.root);
    await onceRunner(t.fx.root);
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [expectedComments(t).notice],
    );
    assert.match(remotePlan(t), /^### 질문: 데모 질문$/m);
    assert.equal(qsOf(t).unposted, false);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 올리지 못한 사이에 제작자가 댓글을 달면 질문을 올리지 않고 그 댓글을 답으로 받는다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['down'];
    });
    await untilAsked(t);
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');

    await onceRunner(t.fx.root);
    assert.equal(botComments(t).length, 0, '질문 댓글을 올리지 않았다');
    assert.equal(t.gh().commentCalls, 1);
    assert.equal(eventCount(t, 'answered'), 1);
    assert.equal(qsOf(t).unposted, false);
    assert.equal(qsOf(t).base, undefined);

    // 세션이 같은 질문을 열린 질문에 남기면(올린 적이 없다) 그 질문을 올린다
    assert.equal(await run(t.fx.root), 'human');
    assert.match(planPrompts(t)[1].prompt, /제작자 답변[\s\S]*B로 하라/);
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [expectedComments(t).question],
      '한 번 올린다',
    );
    assert.deepEqual(qsOf(t).reported, [TITLE]);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 제작자 댓글을 답으로 넘길 때 라벨을 붙이지 못하면 그 주기에는 받지 않고, 다음 주기에 받는다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = ['down'];
    });
    await untilAsked(t);
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    patchGh(t, (s) => {
      s.labelFaults = 1;
    });
    await onceRunner(t.fx.root);
    assert.equal(eventCount(t, 'answered'), 0, '라벨이 없으면 답으로 받지 않는다');
    assert.equal(botComments(t).length, 0, '질문 댓글도 올리지 않는다');
    assert.equal(planPrompts(t).length, 1);
    assert.equal(qsOf(t).unposted, true);

    await onceRunner(t.fx.root);
    assert.equal(eventCount(t, 'answered'), 1);
    assert.equal(botComments(t).length, 0);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 마지막 댓글의 번호를 읽지 못하면 기준을 잡지 않고 전달과 답변 인정을 미룬다 (Issue #211, 판정 지적 F9)', async () => {
  const t = setup();
  try {
    const st = await stageUnposted(t);
    const want = expectedComments(t).question;
    // 앞선 질문의 같은 본문 댓글(번호 5)이 있고, 그 뒤 마지막 댓글(제작자)의 번호를 읽지 못한다
    patchGh(t, (s) => {
      s.issues[0].comments.push(
        { id: '5', author: BOT, body: want, createdAt: '2026-11-22T00:00:00.000Z' },
        { id: '', author: 'maker', body: '앞선 답', createdAt: '2026-11-22T00:00:01.000Z' },
      );
      s.issues[0].labels.push(LABEL);
    });
    writeQuestionState(st.info, { reported: [], waiting: true, stage: 'plan', unposted: true });
    const sessions = t.prompts().length;

    await onceRunner(t.fx.root);
    const qs = qsOf(t);
    assert.ok(!('base' in qs), '기준을 잡지 않는다(0도 아니다)');
    assert.equal(t.gh().commentCalls, 0, '댓글을 올리지 않는다');
    assert.deepEqual(qs.reported, [], '앞선 봇 댓글을 이번 전달로 보지 않는다');
    assert.equal(qs.unposted, true);
    assert.equal(eventCount(t, 'answered'), 0, '제작자 댓글이어도 답으로 받지 않는다');
    assert.equal(t.prompts().length, sessions);

    // 번호가 읽히면 그 번호가 기준이 되고 질문 댓글이 새로 올라간다
    patchGh(t, (s) => {
      s.issues[0].comments.at(-1)!.id = '6';
    });
    await onceRunner(t.fx.root);
    assert.equal(qsOf(t).base, '6');
    assert.equal(t.gh().commentCalls, 1);
    assert.deepEqual(
      botComments(t).map((c) => c.body),
      [want, want],
    );
    assert.deepEqual(qsOf(t).reported, [TITLE]);
    assert.equal(eventCount(t, 'answered'), 0, '기준과 같은 번호의 댓글은 답이 아니다');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 질문을 올리려는 사이에 달린 제작자 댓글은 답으로 받고, 질문보다 먼저 있던 제작자 댓글은 답이 아니다 (Issue #211)', async () => {
  // 기준(다른 계정의 댓글) 뒤에 제작자 댓글이 달렸다
  const a = setup();
  try {
    await stageUnposted(a, (gh) => gh.commentAs(1, 'someone', '지나가던 댓글'));
    assert.equal(a.gh().issues[0].comments.at(-1)!.body, '지나가던 댓글');
    assert.equal(qsOf(a).base, lastId(a), '기준은 질문을 올리기로 한 때의 마지막 댓글이다');
    new FakeGitHub(a.state).ownerComment(1, 'B로 하라');
    await onceRunner(a.fx.root);
    assert.equal(a.gh().commentCalls, 0, '질문 댓글을 올리지 않는다');
    assert.equal(eventCount(a, 'answered'), 1);
  } finally {
    a.fx.cleanup();
  }
  // 제작자 댓글이 먼저 있었고 라벨도 (다른 이유로) 붙어 있다. 질문은 계속 올라가지 못한다
  const b = setup();
  try {
    await stageUnposted(b, (gh) => gh.ownerComment(1, '질문보다 먼저 있던 댓글'));
    assert.equal(b.gh().issues[0].comments.at(-1)!.body, '질문보다 먼저 있던 댓글');
    assert.equal(qsOf(b).base, lastId(b));
    new FakeGitHub(b.state).addLabel(1, LABEL);
    patchGh(b, (s) => {
      s.commentFaults = ['down', 'down', 'down'];
    });
    const sessions = b.prompts().length;
    for (let i = 0; i < 3; i++) {
      await onceRunner(b.fx.root);
      assert.equal(b.prompts().length, sessions, '세션을 다시 띄우지 않는다');
      assert.equal(eventCount(b, 'answered'), 0);
      assert.equal(qsOf(b).unposted, true);
    }
    assert.equal(b.gh().commentCalls, 3, '주기마다 다시 올리려 했다');
    await onceRunner(b.fx.root);
    assert.deepEqual(
      botComments(b).map((c) => c.body),
      [expectedComments(b).question],
      '게시가 풀리면 질문 댓글이 올라간다',
    );
    assert.equal(eventCount(b, 'answered'), 0);
  } finally {
    b.fx.cleanup();
  }
});

test('runner: 상태 전환의 경계에서 끝난 실행을 다음 실행이 이어 간다 (Issue #211)', async () => {
  // (a) 계획을 멈춘 직후에 끝났다: 기준도 잡지 못했다
  const a = setup();
  try {
    const st = await stageUnposted(a);
    writeQuestionState(st.info, { reported: [], waiting: true, stage: 'plan', unposted: true });
    await onceRunner(a.fx.root);
    assert.deepEqual(
      botComments(a).map((c) => c.body),
      [expectedComments(a).question],
    );
    assert.equal(qsOf(a).unposted, false);
  } finally {
    a.fx.cleanup();
  }
  // (b) 계획 파일에 blocked를 적기만 하고 커밋하지 못한 채 끝났다(짧은 질문, 상한을 넘는 질문)
  for (const long of [false, true]) {
    const b = setup();
    try {
      const st = await stageUnposted(b);
      const text = readFileSync(st.planFile, 'utf8');
      writeFileSync(st.planFile, text.replace(/^status: blocked/m, 'status: active'));
      commitAll(st.wt.path, 'plan: 멈추기 전');
      sh('git', ['push', '-q', 'origin', st.wt.branch!], st.wt.path);
      assert.match(remotePlan(b), /^status: active/m);
      writeFileSync(st.planFile, text);
      if (long) padQuestion(b, st.planFile, 70_000);
      await onceRunner(b.fx.root);
      const remote = remotePlan(b);
      assert.match(remote, /^status: blocked/m, '멈춘 계획이 커밋·push됐다');
      assert.match(remote, /^### 질문: 데모 질문$/m, '원격 브랜치에 질문이 있다');
      const want = expectedComments(b);
      assert.deepEqual(
        botComments(b).map((c) => c.body),
        [long ? want.notice : want.question],
      );
      assert.equal(sh('git', ['status', '--porcelain'], st.wt.path).trim(), '');
    } finally {
      b.fx.cleanup();
    }
  }
  // (c) 상태를 적은 직후에 끝났다: 계획이 멈추지 않았다
  const c = setup();
  try {
    const st = await stageUnposted(c);
    const text = readFileSync(st.planFile, 'utf8');
    writeFileSync(st.planFile, text.replace(/^status: blocked/m, 'status: draft'));
    commitAll(st.wt.path, 'plan: 멈추기 전');
    // 표시를 지우고, 같은 주기에 세션이 다시 돌아 질문을 처음부터 올린다
    await onceRunner(c.fx.root);
    assert.equal(planPrompts(c).length, 2, '세션이 다시 돈다');
    let qs = qsOf(c);
    assert.equal(qs.unposted, false);
    assert.equal(await run(c.fx.root), 'human');
    assert.equal(planPrompts(c).length, 2);
    assert.deepEqual(
      botComments(c).map((b) => b.body),
      [expectedComments(c).question],
      '질문이 한 번 올라간다',
    );
    qs = qsOf(c);
    assert.equal(qs.waiting, true);
    assert.equal(qs.unposted, false);
  } finally {
    c.fx.cleanup();
  }
});

test('runner: 질문을 계속 올리지 못하면 사람 대기(human)가 아니라 usage-limit으로 멈춘다. CI를 기다리는 PR이 있어도 같다 (Issue #211)', async () => {
  const t = setup({ limits: { ...baseLimits(), usageLimitMaxWaitMin: 1, pollSec: 30 } });
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.commentFaults = Array.from({ length: 60 }, () => 'down' as const);
    });
    assert.equal(await run(t.fx.root), 'usage-limit');
    assert.deepEqual(qsOf(t).reported, []);
    assert.equal(botComments(t).filter((c) => c.body.includes('질문 1건')).length, 0);
    assert.ok(eventCount(t, 'wait-env') >= 1, '환경 장애로 기다렸다');
  } finally {
    t.fx.cleanup();
  }
  // 이 작업자의 다른 PR이 CI를 기다린다. 기다리는 분기를 살려 둔다(noWait 없음, 대기는 20ms)
  const c = setup({ limits: { ...baseLimits(), usageLimitMaxWaitMin: 0.001, pollSec: 0.02 } });
  try {
    await openPR(c, 'CLEAN');
    // 자동 병합을 켜도 병합되지 않고 기다린다
    patchGh(c, (s) => {
      s.mergeMode = 'manual';
    });
    addFakeIssue(c.state, 'Gamma feature', '질문이 필요한 기능');
    writeFileSync(c.behavior, JSON.stringify({ [SLUG]: { plan: ['question', 'ok'], steps: 1 } }));
    patchGh(c, (s) => {
      s.commentFaults = Array.from({ length: 200 }, () => 'down' as const);
    });
    const stop = await runRunner({
      cwd: c.fx.root,
      worker: 'runner-1',
      tool: 'fake',
      maxIterations: 60,
    });
    assert.ok(
      runnerEvents(c.fx.root).some(
        (e) => e.event === 'pick' && /CI·병합 대기/.test(String(e.reason)),
      ),
      '다른 PR이 CI를 기다리고 있었다',
    );
    assert.equal(stop, 'usage-limit', 'CI 대기로 끝없이 돌지 않는다');
    assert.deepEqual(qsOf(c).reported, []);
  } finally {
    c.fx.cleanup();
  }
});

test('runner: 전달 대기 중에 받은 제작자 답 뒤에는 정지 알림을 달지 않는다. 라벨이 붙으면 그 답을 받는다 (Issue #211, 판정 지적 F11)', async () => {
  const stopNotices = (t: Setup) =>
    t.gh().issues[0].comments.filter((c) => c.body.includes('<!-- harness-runner-stop:'));
  const limits = { limits: { ...baseLimits(), usageLimitMaxWaitMin: 1, pollSec: 30 } };
  const t = setup(limits);
  try {
    await stageUnposted(t);
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    // 댓글은 되는데 라벨만 계속 붙지 않는다: 제작자의 답을 받지 못한 채 대기 상한에 닿는다
    patchGh(t, (s) => {
      s.labelFaults = 500;
    });
    assert.equal(await run(t.fx.root), 'usage-limit');
    assert.equal(eventCount(t, 'answered'), 0);
    assert.equal(botComments(t).length, 0, '제작자가 먼저 답해 질문 댓글은 올리지 않았다');
    assert.equal(stopNotices(t).length, 0, '받지 못한 답 뒤에 정지 알림을 달지 않는다');
    assert.equal(t.gh().issues[0].comments.at(-1)!.body, 'B로 하라', '답이 마지막 댓글로 남는다');
    assert.equal(eventCount(t, 'stop-notice-skipped'), 1);
    assert.equal(qsOf(t).unposted, true);

    // 라벨 장애가 풀린 다음 실행: 그 답을 받고, 같은 질문을 다시 올리지 않는다
    patchGh(t, (s) => {
      s.labelFaults = 0;
    });
    await onceRunner(t.fx.root);
    assert.equal(eventCount(t, 'answered'), 1);
    assert.equal(botComments(t).length, 0);
    assert.equal(qsOf(t).unposted, false);
  } finally {
    t.fx.cleanup();
  }
  // 견줌: 받지 못한 답이 없으면(질문 댓글은 올라갔고 라벨만 붙지 않는다) 정지 알림을 지금처럼 단다
  const c = setup(limits);
  try {
    await gammaIssue(c);
    patchGh(c, (s) => {
      s.labelFaults = 500;
    });
    assert.equal(await run(c.fx.root), 'usage-limit');
    assert.equal(botComments(c).length, 1);
    assert.equal(stopNotices(c).length, 1);
    assert.equal(eventCount(c, 'stop-notice-skipped'), 0);
    // 그 뒤에 제작자가 답하면(마지막 댓글이다) 라벨이 붙는 대로 받는다
    new FakeGitHub(c.state).ownerComment(1, 'A로 하라');
    patchGh(c, (s) => {
      s.labelFaults = 0;
    });
    await onceRunner(c.fx.root);
    assert.equal(eventCount(c, 'answered'), 1);
    assert.equal(botComments(c).length, 1, '질문을 다시 올리지 않는다');
  } finally {
    c.fx.cleanup();
  }
});

test('runner: 라벨은 댓글 뒤에 붙인다. 댓글은 올라갔는데 라벨을 붙이지 못하면 올린 것으로 적고 라벨만 다시 붙인다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    patchGh(t, (s) => {
      s.labelFaults = 1;
    });
    await untilAsked(t);
    assert.equal(botComments(t).length, 1, '댓글은 올라갔다');
    assert.ok(!labeled(t));
    assert.deepEqual(qsOf(t).reported, [TITLE], '라벨의 결과를 기다리지 않고 적는다');
    assert.equal(qsOf(t).unposted, true, '라벨이 붙을 때까지 전달은 끝나지 않았다');

    await onceRunner(t.fx.root);
    assert.equal(t.gh().commentCalls, 1, '댓글을 더 올리지 않는다');
    assert.ok(labeled(t));
    assert.equal(qsOf(t).unposted, false);
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(botComments(t).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: unposted·base가 없는 질문 상태 파일을 둔 계획은 지금처럼 답을 기다리고 다시 올리지 않는다 (Issue #211)', async () => {
  const t = setup();
  try {
    await gammaIssue(t);
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(botComments(t).length, 1);
    const wt = wtOf(t, SLUG)!;
    const f = path.join(repoInfo(wt.path).gitDir, 'harness', 'questions.json');
    writeFileSync(f, JSON.stringify({ reported: [TITLE], waiting: true, stage: 'plan' }));
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(botComments(t).length, 1);
    assert.equal(t.gh().commentCalls, 1);
    new FakeGitHub(t.state).ownerComment(1, 'B로 하라');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed');
  } finally {
    t.fx.cleanup();
  }
});

test('questionNotice: 질문의 글 없이 질문이 있는 곳과 답하는 법을 알린다', () => {
  const mark = 'MARK-7f3a';
  const questions = [
    {
      title: `${mark} 제목`,
      text: `### 질문: ${mark} 제목\n\n- A) ${mark} @someone #1\n- 추천: A`,
    },
    { title: '둘째', text: `### 질문: 둘째\n\n${mark}` },
  ];
  const notice = questionNotice({ ...QUESTION_ARGS, questions });
  assert.ok(!notice.includes(mark), '질문의 글을 넣지 않는다');
  assert.ok(!notice.includes('someone'));
  assert.match(notice, /^@maker runner의 step 1 세션이 질문 2건을 남겼다\. /);
  assert.ok(
    notice.includes('`docs/exec-plans/active/20261111-x/plan.md`'),
    '계획 파일은 코드 스팬',
  );
  assert.ok(notice.includes('`feat/20261111-x-s1`'), '브랜치는 코드 스팬');
  assert.match(notice, /"열린 질문" 절/);
  assert.match(
    notice,
    /^- 답하는 법: 이 Issue에 제작자 계정으로 댓글을 단다\. runner가 답을 넣어 step 1을 이어 간다\.$/m,
    '답하는 법은 질문 댓글의 문장과 같다',
  );
  assert.ok(notice.length <= 1000);
  assert.equal(fencedBlocks(notice).blocks.length, 0, '코드 블록이 없다');
  assert.equal(classifyEscalation(notice), 'question', '지표가 질문으로 센다');
  assert.notEqual(notice, questionComment({ ...QUESTION_ARGS, questions }));
  const plan = questionNotice({ ...QUESTION_ARGS, stage: 'plan', step: null, questions });
  assert.match(plan, /^@maker runner의 계획 작성 세션이 질문 2건을 남겼다\. /);
  assert.match(plan, /runner가 답을 넣어 계획을 다시 작성하고 이어 간다\.$/m);
  const noOwner = questionNotice({ ...QUESTION_ARGS, owner: '', questions });
  assert.match(noOwner, /^runner의 step 1 세션이 질문 2건을 남겼다\. /);
  assert.ok(!noOwner.includes('@'), '제작자 계정이 없으면 멘션하지 않는다');
});
