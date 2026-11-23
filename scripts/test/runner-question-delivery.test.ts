// runner의 질문 전달(Issue #211)의 뒷부분: 본문 거부·길이 상한과 안내 댓글, 올리지 못한 사이의 제작자 댓글, 라벨,
// 상태 전환의 경계, usage-limit 정지, 정지 알림. 끝에 questionNotice.
// runner.test.ts에서 나눴다(Issue #230). 함께 쓰는 준비 코드는 runner-fixture.ts.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { repoInfo } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue } from '../lib/github-fake.ts';
import { classifyEscalation } from '../metrics/source.ts';
import { writeQuestionState } from '../runner/next.ts';
import { questionComment, questionNotice, runRunner } from '../runner/run.ts';
import { commitAll, sh } from './helpers.ts';
import { fencedBlocks } from './markdown-model.ts';
import {
  setup,
  run,
  baseLimits,
  openPR,
  runnerEvents,
  onceRunner,
  QUESTION_ARGS,
  BOT,
  LABEL,
  SLUG,
  TITLE,
  type Setup,
  patchGh,
  wtOf,
  qsOf,
  botComments,
  lastId,
  labeled,
  eventCount,
  planPrompts,
  expectedComments,
  remotePlan,
  untilAsked,
  gammaIssue,
  stageUnposted,
  padQuestion,
} from './runner-fixture.ts';

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
