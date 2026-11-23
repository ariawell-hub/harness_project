// runner 통합 테스트(runner.test.ts, runner-questions.test.ts, runner-question-delivery.test.ts)가 함께 쓰는 준비 코드.
// 가짜 에이전트 + 가짜 GitHub(즉시 squash merge) + 로컬 bare 원격. 테스트 파일이 아니다(이름이 .test.ts로 끝나지 않는다).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newTask } from '../commands/task.ts';
import { repoInfo, listWorktrees } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { openQuestions, parseDoc } from '../lib/plan.ts';
import { readQuestionState } from '../runner/next.ts';
import { questionComment, questionNotice, runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, advanceRemote, commitAll, makeFixture, sh, write } from './helpers.ts';

export function setup(configOver: Record<string, unknown> = {}) {
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

export const run = (root: string) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 80, noWait: true });

export function baseLimits() {
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

/**
 * runner-1 계획의 step0을 끝내고 PR을 연 상태를 만든다. PR 브랜치는 shared.txt를 'pr'로 바꾼다.
 * `mainShared`가 있으면 원격 main의 shared.txt를 그 내용으로 바꿔 충돌시킨다. 가짜 PR의 mergeState를 정한다.
 */

export async function openPR(t: ReturnType<typeof setup>, mergeState: string, mainShared?: string) {
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

export const runnerEvents = (root: string) =>
  readFileSync(path.join(repoInfo(root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

export const onceRunner = (root: string) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', once: true, noWait: true });

export const conflictPrompts = (t: ReturnType<typeof setup>) =>
  t.prompts().filter((p) => p.step === 'conflict');

export const QUESTION_ARGS = {
  owner: 'maker',
  stage: 'step' as const,
  step: 1,
  planId: '20261111-x',
  planFile: 'docs/exec-plans/active/20261111-x/plan.md',
  branch: 'feat/20261111-x-s1',
};

// ---- 올리지 못한 질문 (Issue #211) ----
// 질문 댓글을 올리지 못하면 올린 것으로 적지 않고, 계획을 멈춘 채 주기마다 다시 본다.

export const BOT = 'harness-bot';

export const LABEL = 'needs-human';

export const SLUG = 'gamma-feature';

export const TITLE = '데모 질문';

export type Setup = ReturnType<typeof setup>;

export const patchGh = (t: Setup, fn: (s: FakeState) => void) => {
  const s = t.gh();
  fn(s);
  writeFileSync(t.state, JSON.stringify(s));
};

export const wtOf = (t: Setup, slug: string) =>
  listWorktrees(t.fx.root).find((w) => w.branch?.includes(slug));

export const qsOf = (t: Setup, slug = SLUG) => readQuestionState(repoInfo(wtOf(t, slug)!.path));

/** Issue에 봇 계정이 단 질문 댓글과 안내 댓글(선점 때 다는 댓글 같은 다른 봇 댓글은 뺀다) */
export const botComments = (t: Setup, issue = 0) =>
  t
    .gh()
    .issues[issue].comments.filter((c) => c.author === BOT && /질문 \d+건을 남겼다/.test(c.body));

/** Issue의 마지막 댓글의 번호 */
export const lastId = (t: Setup, issue = 0) => t.gh().issues[issue].comments.at(-1)?.id;

export const labeled = (t: Setup, issue = 0) => t.gh().issues[issue].labels.includes(LABEL);

export const eventCount = (t: Setup, name: string) =>
  runnerEvents(t.fx.root).filter((e) => e.event === name).length;

export const planPrompts = (t: Setup, slug = SLUG) =>
  t.prompts().filter((p) => p.slug === slug && p.step === 'plan');

/** 계획 파일의 리포 상대 경로 */
export function planRelOf(t: Setup, slug: string): string {
  const dir = readdirSync(path.join(wtOf(t, slug)!.path, 'docs/exec-plans/active')).find((d) =>
    d.endsWith(slug),
  )!;
  return `docs/exec-plans/active/${dir}/plan.md`;
}

/** runner가 지금의 계획 파일로 만드는 질문 댓글과 안내 댓글 */
export function expectedComments(t: Setup, slug = SLUG, stage: 'plan' | 'step' = 'plan') {
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
export function remotePlan(t: Setup, slug = SLUG): string {
  sh('git', ['fetch', '-q', 'origin'], t.fx.root);
  return sh('git', ['show', `origin/${wtOf(t, slug)!.branch}:${planRelOf(t, slug)}`], t.fx.root);
}

/** 세션이 질문을 남겨 runner가 답을 기다리기 시작한 주기까지 한 주기씩 돌린다 */
export async function untilAsked(t: Setup, slug = SLUG): Promise<void> {
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

export async function claimed(t: Setup, slug = SLUG): Promise<void> {
  for (let i = 0; i < 5 && !wtOf(t, slug); i++) await onceRunner(t.fx.root);
  assert.ok(wtOf(t, slug), '선점했다');
  assert.equal(t.prompts().filter((p) => p.slug === slug).length, 0, '아직 세션이 뜨기 전이다');
  patchGh(t, (s) => {
    s.commentCalls = 0;
  });
}

/** 계획 작성 세션이 질문을 남기는 Issue를 만들고 선점까지 돌린다 */
export async function gammaIssue(t: Setup, plan: string[] = ['question', 'ok']): Promise<void> {
  addFakeIssue(t.state, 'Gamma feature', '질문이 필요한 기능');
  writeFileSync(t.behavior, JSON.stringify({ [SLUG]: { plan, steps: 1 } }));
  await claimed(t);
}

/**
 * 질문을 올리지 못한 채 멈춘 디스크 상태를 만든다: 계획은 blocked로 커밋·push됐고, 질문 상태는
 * `{ waiting: true, unposted: true, base }`이고, 봇 댓글도 라벨도 없다. 그 뒤 가짜의 호출 수를 0으로 되돌린다.
 * `before`는 선점 뒤, 질문 전에 Issue에 댓글을 달아 둔다
 */

export async function stageUnposted(t: Setup, before?: (gh: FakeGitHub) => void) {
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
export function padQuestion(t: Setup, planFile: string, length: number): void {
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
