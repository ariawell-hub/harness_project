// runner와 2단계 PR 흐름(4.5절 우선순위 2번, 10.3절). 계획 20261115-runner-pr-flow step1.
// 가짜 GitHub은 필수 체크(출처 포함)가 모두 success일 때만 병합한다. 테스트가 setCheck로 CI를 흉내 낸다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { reopenStep } from '../commands/task.ts';
import { readAttempts } from '../lib/attempts.ts';
import { readApprovalMarker } from '../lib/approval.ts';
import { loadConfig } from '../lib/config.ts';
import { listWorktrees, repoInfo } from '../lib/git.ts';
import { getGitHub, type CommitCheck } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { describeTask } from '../commands/start.ts';
import { pickNext, readPrWait, writePrWait } from '../runner/next.ts';
import { runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, advanceRemote, commitAll, makeFixture, sh, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const ACTIONS = 15368;
const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'risk-gate', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];

function setup() {
  const fx = makeFixture({ ci: { requiredChecks: REQUIRED, recorderBot: BOT } });
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
  // step 하나짜리 계획: step0의 PR이 마지막 PR이다
  writeFileSync(behavior, JSON.stringify({ 'demo-feature': { steps: 1 } }));
  writeFileSync(logFile, '');
  process.env.HARNESS_FAKE_GH = state;
  process.env.HARNESS_FAKE_AGENT = path.join(HARNESS_ROOT, 'scripts/selftest/fake-agent.ts');
  process.env.FAKE_BEHAVIOR = behavior;
  process.env.FAKE_LOG = logFile;
  const raw = () => JSON.parse(readFileSync(state, 'utf8')) as FakeState;
  const gh = new FakeGitHub(state);
  const prompts = () =>
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { slug: string; step: string; prompt: string });
  const patchPr = (fn: (p: FakeState['prs'][number]) => void) => {
    const s = raw();
    fn(s.prs[0]);
    writeFileSync(state, JSON.stringify(s));
  };
  return { fx, state, behavior, raw, gh, prompts, patchPr };
}

type T = ReturnType<typeof setup>;

const run = (root: string, once = false) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 40, noWait: true, once });

/** Issue 하나를 계획·step0까지 진행해 PR이 열리고 CI를 기다리는 상태로 만든다 */
async function openPr(t: T) {
  addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
  const stop = await run(t.fx.root);
  assert.equal(stop, 'idle', '필수 체크가 아직 없으면 CI 대기다');
  const pr = t.raw().prs[0];
  assert.equal(pr.state, 'open');
  const worktree = listWorktrees(t.fx.root).find((w) => w.branch === pr.head)!.path;
  return { number: pr.number, branch: pr.head, worktree, head: () => headOf(t, pr.head) };
}

/** 브랜치 이름(`feat/<계획 id>-s<N>`)에서 계획 id */
const planId = (branch: string) => branch.replace(/^[a-z]+\//, '').replace(/-s\d+$/, '');

const headOf = (t: T, branch: string) => t.gh.findPRByBranch(branch)!.headSha;

/** head에 필수 체크를 기대 출처로 쓴다. over로 context별 상태를 바꾸고 null이면 쓰지 않는다 */
function setAll(t: T, sha: string, over: Record<string, CommitCheck['state'] | null> = {}) {
  for (const r of REQUIRED) {
    const state = r.context in over ? over[r.context] : 'success';
    if (state === null) continue;
    if (r.source === 'actions')
      t.gh.setCheck(sha, { context: r.context, kind: 'check-run', appId: ACTIONS, state });
    else t.gh.setCheck(sha, { context: r.context, creator: BOT, state, description: `${state}!` });
  }
}

const lastPick = (root: string) =>
  readFileSync(path.join(repoInfo(root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e.event === 'pick')
    .at(-1)!;

const pick = (root: string) =>
  pickNext({ main: root, cfg: loadConfig(root), gh: getGitHub(root), worker: 'runner-1' });

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
