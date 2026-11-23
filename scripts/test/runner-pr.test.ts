// runner와 2단계 PR 흐름(4.5절 우선순위 2번, 10.3절). 계획 20261115-runner-pr-flow step1.
// 가짜 GitHub은 필수 체크(출처 포함)가 모두 success일 때만 병합한다. 테스트가 setCheck로 CI를 흉내 낸다.
// 뒤처지거나 충돌한 PR의 갱신과 대기 알림은 runner-pr-update.test.ts. 함께 쓰는 준비 코드는 runner-pr-fixture.ts(Issue #230에서 나눴다).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as prettier from 'prettier';
import { reopenStep } from '../commands/task.ts';
import { readAttempts } from '../lib/attempts.ts';
import { readApprovalMarker } from '../lib/approval.ts';
import { repoInfo } from '../lib/git.ts';
import { describeTask } from '../commands/start.ts';
import { readPrWait, writePrWait } from '../runner/next.ts';
import { HARNESS_ROOT, commitAll, sh, write } from './helpers.ts';
import {
  BOT,
  ACTIONS,
  REQUIRED,
  setup,
  run,
  openPr,
  planId,
  headOf,
  setAll,
  pick,
} from './runner-pr-fixture.ts';

const lastPick = (root: string) =>
  readFileSync(path.join(repoInfo(root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e.event === 'pick')
    .at(-1)!;

test('runner: 봇 계정이 쓴 같은 이름의 success만 있는 PR은 CI 대기이고 병합되지 않는다. 검증 App·Actions의 success가 모두 오면 병합된다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const sessions = t.prompts().length;
    for (const r of REQUIRED)
      t.gh.setCheck(pr.head(), { context: r.context, creator: 'harness-bot' });
    t.gh.setCheck(pr.head(), { context: 'check', kind: 'check-run', appId: 999 });
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.raw().prs[0].state, 'open', '흉내 체크로는 병합되지 않는다');
    assert.equal(t.prompts().length, sessions, '세션을 띄우지 않는다');
    assert.match(String(lastPick(t.fx.root).reason), /CI·병합 대기 1건/);
    setAll(t, pr.head());
    assert.equal(t.raw().prs[0].state, 'merged');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(t.raw().issues[0].state, 'closed');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: check(Actions) 실패는 수정 세션을 띄우고 실패 키 pr:check로 센다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const before = pr.head();
    t.gh.setCheck(before, {
      context: 'check',
      kind: 'check-run',
      appId: ACTIONS,
      state: 'failure',
    });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'fix-pr');
    assert.deepEqual(p.task.kind === 'fix-pr' ? p.task.failing.map((f) => f.context) : [], [
      'check',
    ]);
    const sessions = t.prompts().length;
    await run(t.fx.root);
    const fix = t.prompts().slice(sessions);
    assert.equal(fix.length, 1, '수정 세션 한 번');
    assert.match(fix[0].prompt, /## CI 실패[\s\S]*check/);
    assert.ok(readAttempts(repoInfo(pr.worktree)).some((a) => a.key === 'pr:check' && !a.ok));
    assert.notEqual(pr.head(), before, '고친 뒤 새 head를 push한다');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: step 완료 여부는 PR head에서 읽는다. 수정하다 실패해 로컬 step만 되돌려진 PR의 plan-gate 실패를 계속 고친다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    setAll(t, pr.head(), { 'plan-gate': 'failure' });
    assert.equal(pick(t.fx.root).task.kind, 'fix-pr');
    // 수정 세션이 판정에 실패한 뒤의 상태: step을 되돌린 커밋이 로컬에만 있다(push하지 않았다)
    reopenStep(pr.worktree, 'CI 체크 실패: plan-gate');
    const p = pick(t.fx.root);
    assert.equal(
      p.task.kind,
      'fix-pr',
      'PR head의 step은 completed다: plan-gate 실패를 숨기지 않는다',
    );
    assert.deepEqual(p.task.kind === 'fix-pr' ? p.task.failing.map((f) => f.context) : [], [
      'plan-gate',
    ]);
  } finally {
    t.fx.cleanup();
  }
});

test('reopenStep: 다시 연 계획 파일을 포매터가 고치지 않는다(status 줄의 값과 주석 사이는 공백 하나, 붙인 진행 로그)', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const id = planId(pr.branch);
    const done = path.join(pr.worktree, 'docs/exec-plans/completed', id, 'plan.md');
    assert.match(readFileSync(done, 'utf8'), /^status: completed #/m, '완료 처리된 계획이다');
    // 처음부터 포맷이 맞는 계획에서 시작한다: 다시 연 뒤에 어긋난 것은 reopenStep이 쓴 글이다
    const config = await prettier.resolveConfig(path.join(HARNESS_ROOT, 'x.md'));
    const md = { ...config, filepath: 'x.md' };
    writeFileSync(done, await prettier.format(readFileSync(done, 'utf8'), md));
    commitAll(pr.worktree, '계획을 포맷한다');
    assert.ok(await prettier.check(readFileSync(done, 'utf8'), md));
    reopenStep(pr.worktree, '판정의 지적을 고친다');
    const text = readFileSync(
      path.join(pr.worktree, 'docs/exec-plans/active', id, 'plan.md'),
      'utf8',
    );
    const status = text.split('\n').find((l) => l.startsWith('status:'))!;
    assert.match(status, /^status: active # \S/, status);
    assert.match(text, /^- \S+ step0 재작업: 판정의 지적을 고친다$/m, '진행 로그에 한 줄이 붙었다');
    // 다시 연 계획 파일 전체가 포매터의 검사를 통과한다(frontmatter와 붙인 진행 로그 모두)
    assert.ok(await prettier.check(text, md), text);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 대기가 아닌 상태가 되면 그 head의 대기 기록을 지워, 다시 대기할 때 새로 센다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    writePrWait(pr.worktree, {
      head: pr.head(),
      since: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      reported: false,
    });
    // 판정이 끝나 수정 요청 상태가 됐다(대기가 아니다)
    setAll(t, pr.head(), { 'review/claude': 'failure', 'review-ledger': 'failure' });
    await run(t.fx.root, true);
    assert.equal(readPrWait(pr.worktree), null, '옛 대기 시각을 남기지 않는다');
    assert.equal(t.raw().issues[0].comments.filter((c) => c.body.includes('CI 대기가')).length, 0);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: risk-gate만 실패면 수정 세션 없이 제작자 승인을 head마다 한 번만 요청하고, 승인되면 needs-human을 뗀다', async () => {
  const t = setup();
  try {
    writeFileSync(t.behavior, JSON.stringify({ 'demo-feature': { steps: 2 } }));
    const pr = await openPr(t);
    const sessions = t.prompts().length;
    const requests = () =>
      t.raw().issues[0].comments.filter((c) => c.body.includes('제작자 승인을 기다린다'));
    setAll(t, pr.head(), { 'risk-gate': 'failure' });
    const req = pick(t.fx.root);
    assert.equal(req.task.kind, 'request-approval');
    assert.match(describeTask(req.task), /승인을 제작자에게 요청/);
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(t.prompts().length, sessions, 'risk-gate 실패에 수정 세션을 띄우지 않는다');
    assert.ok(t.raw().issues[0].labels.includes('needs-human'));
    assert.equal(requests().length, 1);
    assert.match(requests()[0].body, /@maker/);
    assert.ok(requests()[0].body.includes(pr.head().slice(0, 12)));
    assert.match(requests()[0].body, new RegExp(`#${pr.number}`));
    assert.equal(readApprovalMarker(repoInfo(pr.worktree)), pr.head());
    // 같은 head에서는 다시 요청하지 않는다
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(requests().length, 1);
    // head가 바뀌면 다시 요청한다
    write(pr.worktree, 'out/extra.txt', 'x\n');
    commitAll(pr.worktree, 'extra');
    sh('git', ['push', '-q', 'origin', pr.branch], pr.worktree);
    setAll(t, pr.head(), { 'risk-gate': 'failure' });
    assert.equal(await run(t.fx.root), 'human');
    assert.equal(requests().length, 2);
    // 제작자가 승인하면(risk-gate success) 병합되고, runner가 needs-human을 뗀다
    t.gh.setCheck(pr.head(), { context: 'risk-gate', creator: BOT });
    assert.equal(t.raw().prs[0].state, 'merged');
    await run(t.fx.root);
    assert.ok(!t.raw().issues[0].labels.includes('needs-human'));
    assert.equal(t.raw().issues[0].state, 'open', 'step이 남아 있다');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: review/*·review-ledger 실패는 check 실패용 수정 세션이 아니라 지적 대응 작업이다. 원장이 보이지 않으면 세션 없이 기다린다', async () => {
  const t = setup();
  try {
    const pr = await openPr(t);
    const sessions = t.prompts().length;
    setAll(t, pr.head(), { 'review/claude': 'failure', 'review-ledger': 'failure' });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'review');
    assert.match(p.reason, /#\d+.*(수정 요청|차단 지적)/);
    // 원장 댓글(검증 App 봇)이 아직 없다: 지적을 모르는 채로 세션을 띄우지 않는다(대응 자체는 runner-review.test.ts)
    await run(t.fx.root, true);
    assert.equal(t.prompts().length, sessions);
    assert.equal(t.raw().prs[0].state, 'open');
    assert.equal(pr.head(), headOf(t, pr.branch));
  } finally {
    t.fx.cleanup();
  }
});
