// runner와 2단계 PR 흐름(계속): 뒤처지거나 충돌한 PR의 갱신, 같은 head의 CI 대기 알림(ciStallHours),
// 자동 병합 다시 켜기, push한 커밋이 PR head에 반영되기 전의 대기.
// runner-pr.test.ts에서 나눴다(Issue #230). 함께 쓰는 준비 코드는 runner-pr-fixture.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { describeTask } from '../commands/start.ts';
import { pickNext, readPrWait, writePrWait } from '../runner/next.ts';
import { advanceRemote, commitAll, sh, write } from './helpers.ts';
import { BOT, ACTIONS, setup, run, openPr, planId, setAll, pick } from './runner-pr-fixture.ts';

test('runner: 뒤처진 PR은 필수 체크가 모두 success일 때만 갱신한다(진행 중·수정 요청 상태에서는 갱신하지 않는다)', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const head = pr.head();
    advanceRemote(t.fx, 'other.txt', 'main moves\n');
    // 자동 병합을 끈다: 가짜 GitHub은 "main 최신 필수"를 흉내 내지 않는다
    t.patchPr((p) => (p.autoMerge = false));
    // 판정 진행 중
    setAll(t, head, { 'review/codex': null, 'review-ledger': null });
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    await run(t.fx.root);
    assert.equal(pr.head(), head, '판정 중에는 갱신하지 않는다');
    // 수정 요청: 갱신이 아니라 지적 대응이 먼저다
    setAll(t, head, { 'review/codex': 'failure' });
    assert.equal(pick(t.fx.root).task.kind, 'review');
    await run(t.fx.root, true);
    assert.equal(pr.head(), head, '수정 요청 상태에서는 갱신하지 않는다');
    // 모두 success
    t.gh.setCheck(head, { context: 'review/codex', creator: BOT });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'update');
    assert.match(p.reason, /뒤처졌다/);
    await run(t.fx.root);
    assert.notEqual(pr.head(), head);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    sh('git', ['merge-base', '--is-ancestor', 'origin/main', pr.head()], t.fx.root);
    sh('git', ['merge-base', '--is-ancestor', head, pr.head()], t.fx.root);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 충돌(DIRTY)로 표시된 PR은 다른 체크와 관계없이 바로 갱신한다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const head = pr.head();
    advanceRemote(t.fx, 'other.txt', 'main moves\n');
    t.patchPr((p) => (p.mergeState = 'DIRTY'));
    assert.equal(pick(t.fx.root).task.kind, 'update');
    await run(t.fx.root);
    assert.notEqual(pr.head(), head);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 같은 head에서 CI 대기가 ciStallHours를 넘으면 needs-human으로 한 번만 알린다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const wait = readPrWait(pr.worktree);
    assert.equal(wait?.head, pr.head(), 'CI 대기를 시작한 head와 시각을 적어 둔다');
    assert.equal(wait?.reported, false);
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    const stalls = () => t.raw().issues[0].comments.filter((c) => c.body.includes('CI 대기가'));
    // 25시간 전부터 기다린 것으로 만든다(기본 ciStallHours 24)
    writePrWait(pr.worktree, {
      head: pr.head(),
      since: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      reported: false,
    });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'report-stall');
    assert.match(describeTask(p.task), /오래된 CI 대기.*review\/claude/);
    assert.equal(readPrWait(pr.worktree)?.reported, false, 'pickNext는 상태 파일을 쓰지 않는다');
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(stalls().length, 1);
    assert.match(stalls()[0].body, /@maker[\s\S]*review\/claude/);
    assert.ok(t.raw().issues[0].labels.includes('needs-human'));
    assert.equal(readPrWait(pr.worktree)?.reported, true);
    await run(t.fx.root);
    assert.equal(stalls().length, 1, '같은 head에서는 다시 알리지 않는다');
    // 제작자가 답하면 needs-human만 떼고, 완료된 step을 되돌리거나 세션을 띄우지 않는다
    const sessions = t.prompts().length;
    t.gh.ownerComment(1, '워크플로를 다시 실행했다');
    assert.equal(pick(t.fx.root).task.kind, 'answered');
    await run(t.fx.root);
    assert.ok(!t.raw().issues[0].labels.includes('needs-human'));
    assert.equal(t.prompts().length, sessions);
    const idx = JSON.parse(
      readFileSync(
        path.join(pr.worktree, 'docs/exec-plans/completed/' + planId(pr.branch), 'index.json'),
        'utf8',
      ),
    ) as { steps: { status: string }[] };
    assert.equal(idx.steps[0].status, 'completed', '열린 PR의 step 상태를 바꾸지 않는다');
    assert.equal(sh('git', ['status', '--porcelain'], pr.worktree), '');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 필수 체크가 모두 success인데 자동 병합이 꺼져 있으면 다시 켠다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    t.patchPr((p) => (p.autoMerge = false));
    setAll(t, pr.head());
    assert.equal(t.raw().prs[0].state, 'open');
    const arm = pick(t.fx.root);
    assert.equal(arm.task.kind, 'arm-merge');
    assert.match(describeTask(arm.task), new RegExp(`PR #${pr.number} 자동 병합 켜기`));
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.raw().prs[0].state, 'merged');
    assert.equal(t.raw().issues[0].state, 'closed');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: push한 커밋이 PR head에 아직 반영되지 않았으면 옛 head의 결과로 판단하지 않고 기다린다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const old = pr.head();
    // 옛 head에는 check 실패가 있다. 새 커밋을 push했지만 가짜 원격 추적 ref만 앞서 있는 상황을 만든다
    t.gh.setCheck(old, { context: 'check', kind: 'check-run', appId: ACTIONS, state: 'failure' });
    write(pr.worktree, 'out/extra.txt', 'x\n');
    const next = commitAll(pr.worktree, 'extra');
    sh('git', ['update-ref', `refs/remotes/origin/${pr.branch}`, next], pr.worktree);
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'idle', '옛 head의 check 실패로 수정 세션을 띄우지 않는다');
    assert.deepEqual(p.waiting, { ci: 1, human: 0 });
  } finally {
    t.fx.cleanup();
  }
});
