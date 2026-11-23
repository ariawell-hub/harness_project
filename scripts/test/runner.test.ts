// runner 통합 테스트(12.4절 4.5절 시나리오, 1단계 완료 기준 S6).
// 가짜 에이전트 + 가짜 GitHub(즉시 squash merge) + 로컬 bare 원격.
// 열린 질문은 runner-questions.test.ts, 질문 전달(Issue #211)의 뒷부분은 runner-question-delivery.test.ts. 함께 쓰는 준비 코드는 runner-fixture.ts(Issue #230에서 나눴다).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { newTask } from '../commands/task.ts';
import { readAttempts } from '../lib/attempts.ts';
import { gitTry, repoInfo, listWorktrees } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue } from '../lib/github-fake.ts';
import { parseSessionSummary } from '../runner/agents.ts';
import { runRunner } from '../runner/run.ts';
import { advanceRemote, sh } from './helpers.ts';
import {
  setup,
  run,
  baseLimits,
  openPR,
  runnerEvents,
  onceRunner,
  conflictPrompts,
} from './runner-fixture.ts';

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
