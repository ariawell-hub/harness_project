// runner의 계획 검증(G1) 흐름(4.1절, 10.3절). 계획 20261115-runner-pr-flow step2.
// 계획만 담은 커밋으로 초안 PR을 열고, 원장(검증 App 봇 댓글)의 계획 승인을 확인한 뒤에 step 세션을 띄운다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { emptyLedger, renderLedger, type Ledger, type Reviewer } from '../ci/ledger.ts';
import { planHash } from '../ci/plan-hash.ts';
import { describeTask } from '../commands/start.ts';
import { readAttempts } from '../lib/attempts.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { listWorktrees, repoInfo } from '../lib/git.ts';
import { getGitHub, type CommitCheck } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { planApproved, readPrLedger } from '../runner/ledger-read.ts';
import { pickNext, planReviewHash } from '../runner/next.ts';
import { runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, makeFixture, sh } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const ACTIONS = 15368;
const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];

function setup(over: Record<string, unknown> = {}, steps = 2) {
  const fx = makeFixture({
    ci: { requiredChecks: REQUIRED, recorderBot: BOT },
    planReview: { required: true },
    ...over,
  });
  const state = path.join(fx.dir, 'gh.json');
  const behavior = path.join(fx.dir, 'behavior.json');
  const logFile = path.join(fx.dir, 'prompts.jsonl');
  initFakeState(state, {
    remote: fx.remote,
    owner: 'maker',
    mergeRequires: REQUIRED.map((r) =>
      r.source === 'actions'
        ? { context: r.context, kind: 'check-run' as const, appId: ACTIONS }
        : { context: r.context, kind: 'status' as const, creator: BOT },
    ),
  });
  writeFileSync(behavior, JSON.stringify({ 'demo-feature': { steps } }));
  writeFileSync(logFile, '');
  process.env.HARNESS_FAKE_GH = state;
  process.env.HARNESS_FAKE_AGENT = path.join(HARNESS_ROOT, 'scripts/test/fake-agent.ts');
  process.env.FAKE_BEHAVIOR = behavior;
  process.env.FAKE_LOG = logFile;
  const raw = () => JSON.parse(readFileSync(state, 'utf8')) as FakeState;
  const gh = new FakeGitHub(state);
  const prompts = () =>
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { slug: string; step: string; prompt: string });
  return { fx, state, behavior, raw, gh, prompts };
}

type T = ReturnType<typeof setup>;

const run = (root: string, once = false) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 40, noWait: true, once });

const pick = (root: string) =>
  pickNext({ main: root, cfg: loadConfig(root), gh: getGitHub(root), worker: 'runner-1' });

const headOf = (t: T, branch: string) => t.gh.findPRByBranch(branch)!.headSha;

function setAll(t: T, sha: string, over: Record<string, CommitCheck['state'] | null> = {}) {
  for (const r of REQUIRED) {
    const state = r.context in over ? over[r.context] : 'success';
    if (state === null) continue;
    if (r.source === 'actions')
      t.gh.setCheck(sha, { context: r.context, kind: 'check-run', appId: ACTIONS, state });
    else t.gh.setCheck(sha, { context: r.context, creator: BOT, state, description: `${state}!` });
  }
}

/** 계획 작성까지 진행해 계획 검증 초안 PR이 열린 상태 */
async function planPr(t: T) {
  addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
  assert.equal(await run(t.fx.root), 'idle');
  const pr = t.raw().prs[0];
  const worktree = listWorktrees(t.fx.root).find((w) => w.branch === pr.head)!.path;
  const id = pr.head.replace(/^[a-z]+\//, '').replace(/-s\d+$/, '');
  const hash = () => planHash(worktree, `docs/exec-plans/active/${id}`);
  return { number: pr.number, branch: pr.head, worktree, id, hash, head: () => headOf(t, pr.head) };
}

/** 계획 검증 중인 head의 CI 결과: plan-gate는 step이 끝나지 않아 실패, 나머지는 통과 */
const planChecks = (t: T, sha: string, over: Record<string, CommitCheck['state'] | null> = {}) =>
  setAll(t, sha, { 'plan-gate': 'failure', ...over });

function ledgerBody(hash: string, head: string, approvals: Reviewer[]): string {
  const l: Ledger = { ...emptyLedger('a'.repeat(40)), planReview: { hash, head, approvals } };
  return renderLedger(l);
}

const stepSessions = (t: T) => t.prompts().filter((p) => p.step !== 'plan');

test('runner: 계획 작성 뒤 계획만 담은 초안 PR을 열고, 원장의 계획 승인 전에는 step 세션을 띄우지 않는다', async () => {
  const t = setup();
  try {
    const pr = await planPr(t);
    const first = t.raw().prs[0];
    assert.equal(first.isDraft, true);
    assert.equal(first.autoMerge, false, '계획 검증 중에는 자동 병합을 켜지 않는다');
    assert.match(first.body, /^Refs #1/);
    assert.match(first.title, /step0 part-0/);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    const files = sh(
      'git',
      ['diff', '--name-only', `origin/main...origin/${pr.branch}`],
      t.fx.root,
    ).split('\n');
    assert.ok(files.length > 0);
    assert.ok(
      files.every((f) => f.startsWith(`docs/exec-plans/active/${pr.id}/`)),
      `계획 폴더 파일만 올린다: ${files.join(', ')}`,
    );
    assert.equal(stepSessions(t).length, 0);
    // CI가 끝나도 원장에 계획 승인이 없으면 기다린다
    planChecks(t, pr.head());
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'idle');
    assert.deepEqual(p.waiting, { ci: 1, human: 0 });
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(stepSessions(t).length, 0);
    assert.equal(t.raw().prs[0].state, 'open');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 원장에 지금 해시와 두 검증자의 승인이 있으면 step을 실행하고, 끝나면 초안을 해제해 병합한다. 둘째 step은 계획 검증 없이 간다', async () => {
  const t = setup();
  try {
    const pr = await planPr(t);
    const planHead = pr.head();
    planChecks(t, planHead);
    t.gh.commentAs(pr.number, BOT, ledgerBody(pr.hash(), planHead, ['claude', 'codex']));
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'step');
    assert.match(p.reason, /승인/);
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(stepSessions(t).length, 1);
    const after = t.raw().prs[0];
    assert.equal(t.raw().prs.length, 1, '같은 PR에 구현을 올린다');
    assert.equal(after.isDraft, false, 'step이 끝나면 초안을 해제한다');
    assert.equal(after.autoMerge, true);
    assert.notEqual(pr.head(), planHead);
    setAll(t, pr.head());
    assert.equal(t.raw().prs[0].state, 'merged');
    // 둘째 step: 계획이 main과 같은 해시라 초안 PR·승인 대기 없이 진행한다
    assert.equal(await run(t.fx.root), 'idle');
    const second = t.raw().prs[1];
    assert.equal(stepSessions(t).length, 2);
    assert.equal(second.isDraft, false);
    assert.equal(second.autoMerge, true);
    assert.match(second.body, /^Closes #1/);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 해시가 다르거나, 검증자가 하나뿐이거나, 검증 App 봇이 쓰지 않은 원장은 계획 승인으로 보지 않는다', async () => {
  const t = setup();
  try {
    const pr = await planPr(t);
    const head = pr.head();
    planChecks(t, head);
    const cfg = loadConfig(t.fx.root);
    // PR 작성자(봇 계정)가 쓴 같은 형식의 댓글
    t.gh.commentAs(pr.number, 'harness-bot', ledgerBody(pr.hash(), head, ['claude', 'codex']));
    assert.equal(readPrLedger(t.gh, cfg, pr.number), null);
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    // 검증 App 봇의 원장이지만 다른 해시
    t.gh.commentAs(pr.number, BOT, ledgerBody('0'.repeat(64), head, ['claude', 'codex']));
    assert.equal(planApproved(readPrLedger(t.gh, cfg, pr.number), pr.hash()), false);
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    // 해시는 맞지만 검증자 하나
    t.gh.editCommentAs(pr.number, 1, BOT, ledgerBody(pr.hash(), head, ['claude']));
    assert.equal(planApproved(readPrLedger(t.gh, cfg, pr.number), pr.hash()), false);
    assert.equal(pick(t.fx.root).task.kind, 'idle');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(stepSessions(t).length, 0);
    // 둘 다 승인
    t.gh.editCommentAs(pr.number, 1, BOT, ledgerBody(pr.hash(), head, ['claude', 'codex']));
    assert.equal(planApproved(readPrLedger(t.gh, cfg, pr.number), pr.hash()), true);
    assert.equal(pick(t.fx.root).task.kind, 'step');
    // recorderBot 설정이 없으면 원장을 가릴 수 없다
    assert.throws(
      () => readPrLedger(t.gh, { ...cfg, ci: { ...cfg.ci, recorderBot: null } }, pr.number),
      /recorderBot/,
    );
    assert.equal(planApproved(null, pr.hash()), false);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 계획 작성 세션이 계획 폴더 밖 파일을 커밋하면 push하지 않고 plan:scope 실패로 세며, 되돌린 뒤에 초안 PR을 연다', async () => {
  const t = setup({}, 1);
  try {
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'demo-feature': { steps: 1, plan: ['stray', 'ok'] } }),
    );
    addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
    await run(t.fx.root, true); // 선점
    await run(t.fx.root, true); // 계획 작성(계획 밖 파일 커밋) → push 거부
    assert.equal(t.raw().prs.length, 0, 'PR을 열지 않는다');
    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('demo-feature'))!;
    assert.equal(
      sh('git', ['ls-remote', '--heads', 'origin', wt.branch!], t.fx.root),
      '',
      '계획 밖 변경이 섞인 브랜치를 push하지 않는다',
    );
    const scope = readAttempts(repoInfo(wt.path)).filter((a) => a.key === 'plan:scope');
    assert.equal(scope.length, 1);
    assert.equal(scope[0].ok, false);
    assert.match(scope[0].detail ?? '', /stray\.txt/);
    // 다음 계획 작성 세션이 직전 실패를 보고 되돌린다
    assert.equal(await run(t.fx.root), 'idle');
    const replan = t.prompts().filter((p) => p.step === 'plan');
    assert.equal(replan.length, 2);
    assert.match(replan[1].prompt, /plan:scope[\s\S]*stray\.txt/);
    assert.equal(t.raw().prs.length, 1);
    assert.equal(t.raw().prs[0].isDraft, true);
    assert.match(t.raw().prs[0].body, /^Closes #1/, 'step이 하나뿐이면 Closes다');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 계획만 담은 커밋의 check가 실패하면 step이 아니라 계획 작성 세션을 다시 띄운다', async () => {
  const t = setup();
  try {
    const pr = await planPr(t);
    const head = pr.head();
    t.gh.setCheck(head, { context: 'check', kind: 'check-run', appId: ACTIONS, state: 'failure' });
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'plan');
    assert.match(p.reason, /check/);
    assert.equal(await run(t.fx.root), 'idle');
    const plans = t.prompts().filter((x) => x.step === 'plan');
    assert.equal(plans.length, 2);
    assert.match(plans[1].prompt, /pr:check/);
    assert.equal(stepSessions(t).length, 0);
    assert.notEqual(pr.head(), head, '고친 계획을 같은 PR에 push한다');
    assert.equal(t.raw().prs.length, 1);
    assert.equal(t.raw().prs[0].isDraft, true);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 계획 검증 중인 초안 PR도 WIP 상한에 센다', async () => {
  const t = setup({
    limits: {
      sessionTimeoutMin: 1,
      acTimeoutSec: 60,
      stepFailedCheckLimit: 10,
      stepSessionMinutesLimit: 120,
      runnerMaxHours: 1,
      workers: 1,
      wipPerWorker: 1,
      claimExpiryHours: 24,
      usageLimitMaxWaitMin: 60,
      pollSec: 0,
    },
  });
  try {
    await planPr(t);
    addFakeIssue(t.state, 'Other feature', '다른 기능');
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'idle', '열린 PR(초안)이 상한이면 새 Issue를 선점하지 않는다');
    assert.equal(await run(t.fx.root), 'idle');
    assert.ok(!listWorktrees(t.fx.root).some((w) => w.branch?.includes('other-feature')));
  } finally {
    t.fx.cleanup();
  }
});

test('runner: planReview.required가 꺼진 리포는 계획 검증 없이 지금까지처럼 step을 바로 실행한다', async () => {
  const t = setup({ planReview: { required: false } });
  try {
    addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(stepSessions(t).length, 1);
    assert.equal(t.raw().prs[0].isDraft, false);
    assert.equal(t.raw().prs[0].autoMerge, true);
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 필수 체크·검증 App 봇 설정이 없는 리포는 planReview.required가 켜져 있어도 계획 검증 흐름을 쓰지 않는다', async () => {
  // 승인을 기록할 CI가 없으면 runner는 승인을 확인할 수 없다. 초안 PR을 열고 끝없이 기다리지 않는다
  const t = setup({ ci: { requiredChecks: [], recorderBot: null } });
  try {
    addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
    assert.equal(await run(t.fx.root), 'idle');
    assert.equal(stepSessions(t).length, 1);
    assert.equal(t.raw().prs[0].isDraft, false);
    const cfg = loadConfig(t.fx.root);
    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('demo-feature'))!;
    assert.equal(planReviewHash(cfg, wt.path, wt.branch!), null);
    assert.equal(
      planReviewHash(
        { ...cfg, ci: { ...cfg.ci, requiredChecks: REQUIRED, recorderBot: BOT } },
        wt.path,
        wt.branch!,
      )?.length,
      64,
      '2단계 CI 설정이 있으면 대상이다',
    );
  } finally {
    t.fx.cleanup();
  }
});

test('describeTask: plan-push는 대화 세션에 "계획만 담은 커밋을 push하고 초안 PR을 연다"로 보인다', async () => {
  const t = setup();
  try {
    addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
    await run(t.fx.root, true); // 선점
    // 계획 작성 세션만 끝난 상태를 만든다: runner 대신 가짜 에이전트의 결과를 직접 커밋한다
    const wt = listWorktrees(t.fx.root).find((w) => w.branch?.includes('demo-feature'))!;
    const prompt = `# 이번 작업: 계획 작성\n계획 파일: \`docs/exec-plans/active/${wt.branch!.replace(/^[a-z]+\//, '').replace(/-s\d+$/, '')}/plan.md\`\n`;
    const r = runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/test/fake-agent.ts')], {
      cwd: wt.path,
      input: prompt,
    });
    assert.equal(r.code, 0, r.stderr);
    sh('git', ['add', '-A'], wt.path);
    sh('git', ['commit', '-q', '-m', 'plan'], wt.path);
    const p = pick(t.fx.root);
    assert.equal(p.task.kind, 'plan-push');
    assert.match(describeTask(p.task), /계획만 담은 커밋을 push하고 초안 PR을 연다/);
  } finally {
    t.fx.cleanup();
  }
});
