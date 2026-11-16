// 작업자 여러 개, 정지 알림, WIP 상한(4.5절). 계획 20261115-runner-pr-flow step6.
// 가짜 에이전트 + 가짜 GitHub + 로컬 bare 원격. 작업자 여러 개는 실제로 자식 프로세스를 띄워 확인한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../lib/config.ts';
import { repoInfo } from '../lib/git.ts';
import { getGitHub } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { pickNext } from '../runner/next.ts';
import { runRunner } from '../runner/run.ts';
import { workerNames } from '../runner/workers.ts';
import { HARNESS_ROOT, fixtureConfig, makeFixture, sh } from './helpers.ts';

const LIMITS = fixtureConfig().limits as Record<string, number>;

function setup(configOver: Record<string, unknown> = {}, fake: Partial<FakeState> = {}) {
  const fx = makeFixture(configOver);
  const state = path.join(fx.dir, 'gh.json');
  const behavior = path.join(fx.dir, 'behavior.json');
  const logFile = path.join(fx.dir, 'prompts.jsonl');
  initFakeState(state, { remote: fx.remote, owner: 'maker', ...fake });
  writeFileSync(behavior, '{}');
  writeFileSync(logFile, '');
  process.env.HARNESS_FAKE_GH = state;
  process.env.HARNESS_FAKE_AGENT = path.join(HARNESS_ROOT, 'scripts/selftest/fake-agent.ts');
  process.env.FAKE_BEHAVIOR = behavior;
  process.env.FAKE_LOG = logFile;
  delete process.env.HARNESS_WORKER;
  const gh = () => JSON.parse(readFileSync(state, 'utf8')) as FakeState;
  const events = () =>
    readFileSync(path.join(repoInfo(fx.root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const workers = () => [
    ...new Set(
      events()
        .filter((e) => e.event === 'start')
        .map((e) => String(e.worker)),
    ),
  ];
  return { fx, state, behavior, gh, events, workers };
}

/** fixture 리포에서 `node scripts/harness.ts run …`을 실제 프로세스로 실행한다 */
function cli(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/harness.ts'), 'run', ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 600_000,
  });
}

test('workerNames: 접두어와 1부터의 번호', () => {
  assert.deepEqual(workerNames('runner', 2), ['runner-1', 'runner-2']);
  assert.deepEqual(workerNames('mac', 3), ['mac-1', 'mac-2', 'mac-3']);
  assert.equal(new Set(workerNames('w', 5)).size, 5, '이름이 겹치지 않는다');
  for (const bad of ['', 'a b', 'a/b', '../x', 'a;b'])
    assert.throws(() => workerNames(bad, 1), bad);
  for (const n of [0, -1, 1.5, Number.NaN]) assert.throws(() => workerNames('runner', n));
});

test('설정: limits.workers가 1 이상의 정수가 아니면 ConfigError다', () => {
  for (const bad of [0, -1, 1.5, '2', null]) {
    const fx = makeFixture({ limits: { ...LIMITS, workers: bad } });
    try {
      assert.throws(
        () => loadConfig(fx.root),
        (e: unknown) => e instanceof ConfigError && /limits\.workers/.test(e.message),
        String(bad),
      );
    } finally {
      fx.cleanup();
    }
  }
  assert.equal(loadConfig(HARNESS_ROOT).limits.workers, 2, '이 리포의 작업자 수(Q19)');
});

test('run: --worker 없이 실행하면 limits.workers만큼 작업자 프로세스를 띄워 Issue 두 개를 나눠 끝낸다', () => {
  const t = setup({ limits: { ...LIMITS, workers: 2 } });
  try {
    addFakeIssue(t.state, 'Alpha feature', '알파');
    addFakeIssue(t.state, 'Beta feature', '베타');
    writeFileSync(
      t.behavior,
      JSON.stringify({ 'alpha-feature': { steps: 1 }, 'beta-feature': { steps: 1 } }),
    );
    const r = cli(t.fx.root, ['--tool', 'fake', '--no-wait', '--max-iterations', '60']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(t.workers().sort(), ['runner-1', 'runner-2']);
    assert.equal(
      t.events().filter((e) => e.event === 'exit').length,
      2,
      '두 작업자 모두 스스로 끝났다',
    );
    const s = t.gh();
    assert.deepEqual(
      s.issues.filter((i) => i.number <= 2).map((i) => i.state),
      ['closed', 'closed'],
      'Issue 두 개가 모두 끝난다',
    );
    assert.equal(s.prs.filter((p) => p.state === 'merged').length, 2);
    // 같은 Issue를 두 작업자가 함께 맡지 않는다: Issue마다 계획 하나, 선점 하나
    const claimed = t.events().filter((e) => e.event === 'claimed');
    assert.deepEqual(claimed.map((e) => e.issue).sort(), [1, 2]);
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    const plans = sh(
      'git',
      ['ls-tree', '-r', '--name-only', 'origin/main', 'docs/exec-plans/completed/'],
      t.fx.root,
    )
      .split('\n')
      .filter((f) => f.endsWith('/plan.md'));
    assert.equal(plans.length, 2);
    const owners = plans.map((f) => {
      const text = sh('git', ['show', `origin/main:${f}`], t.fx.root);
      return {
        issue: Number(/^issue: (\d+)/m.exec(text)?.[1]),
        owner: /^owner: (\S+)/m.exec(text)?.[1] ?? '',
      };
    });
    assert.deepEqual(owners.map((o) => o.issue).sort(), [1, 2]);
    for (const o of owners) assert.match(o.owner, /^runner-[12]$/);
    // 계획의 owner와 선점한 작업자가 같다
    for (const c of claimed)
      assert.equal(owners.find((o) => o.issue === c.issue)!.owner, String(c.worker));
    // lock은 작업자마다 따로 잡고 끝나면 지운다
    const dir = path.join(repoInfo(t.fx.root).commonDir, 'harness');
    for (const w of ['runner-1', 'runner-2'])
      assert.throws(() => readFileSync(path.join(dir, `runner-${w}.lock`)), /ENOENT/);
  } finally {
    t.fx.cleanup();
  }
});

test('run: --prefix로 작업자 이름을 정하고, --worker나 HARNESS_WORKER가 있으면 그 이름의 루프 하나만 돈다', () => {
  const t = setup({ limits: { ...LIMITS, workers: 2 } });
  try {
    let r = cli(t.fx.root, ['--tool', 'fake', '--once', '--no-wait', '--prefix', 'mac']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(t.workers().sort(), ['mac-1', 'mac-2']);
    r = cli(t.fx.root, ['--tool', 'fake', '--once', '--no-wait', '--worker', 'x']);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(t.workers().sort(), ['mac-1', 'mac-2', 'x']);
    r = cli(t.fx.root, ['--tool', 'fake', '--once', '--no-wait'], { HARNESS_WORKER: 'y' });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.deepEqual(t.workers().sort(), ['mac-1', 'mac-2', 'x', 'y']);
    assert.equal(t.events().filter((e) => e.event === 'start').length, 4);
    // 이름으로 쓸 수 없는 접두어는 아무것도 띄우지 않는다
    r = cli(t.fx.root, ['--tool', 'fake', '--once', '--no-wait', '--prefix', 'a/b']);
    assert.notEqual(r.status, 0);
    assert.equal(t.events().filter((e) => e.event === 'start').length, 4);
  } finally {
    t.fx.cleanup();
  }
});

test('run: 자식 작업자 하나가 실패로 끝나면 가장 큰 종료 코드로 끝난다', () => {
  const t = setup({ limits: { ...LIMITS, workers: 2 } });
  try {
    // 에이전트 CLI가 없으면 작업자가 시작하지 못하고 종료 코드 1로 끝난다(agent-missing)
    const r = cli(t.fx.root, ['--tool', 'claude', '--once', '--no-wait']);
    assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  } finally {
    t.fx.cleanup();
  }
});

const stopNotes = (s: FakeState, issue = 1) =>
  s.issues
    .find((i) => i.number === issue)!
    .comments.filter((c) => c.body.includes('<!-- harness-runner-stop:'));

test('정지 알림: 연속 오류로 멈추면 진행 중 계획의 Issue에 멘션과 표식이 있는 댓글을 한 번 남긴다. idle로 끝나면 남기지 않는다', async () => {
  const t = setup();
  const agent = process.env.HARNESS_FAKE_AGENT;
  try {
    addFakeIssue(t.state, 'Alpha feature', '알파');
    writeFileSync(t.behavior, JSON.stringify({ 'alpha-feature': { steps: 1 } }));
    const run = () =>
      runRunner({
        cwd: t.fx.root,
        worker: 'runner-1',
        tool: 'fake',
        maxIterations: 40,
        noWait: true,
      });
    // 세션을 띄울 수 없게 만든다: 선점한 뒤 계획 작성 세션이 계속 오류로 끝난다
    delete process.env.HARNESS_FAKE_AGENT;
    assert.equal(await run(), 'error');
    let notes = stopNotes(t.gh());
    assert.equal(notes.length, 1);
    assert.equal(notes[0].author, 'harness-bot');
    assert.match(notes[0].body, /@maker/);
    assert.match(notes[0].body, /runner-1/);
    assert.match(notes[0].body, /\d{8}-alpha-feature/, '남은 일: 계획 id');
    assert.match(notes[0].body, /node scripts\/harness\.ts run --worker runner-1 --tool fake/);
    assert.match(notes[0].body, /<!-- harness-runner-stop:runner-1:error -->\s*$/);
    assert.deepEqual(t.gh().issues[0].labels, [], 'needs-human을 붙이지 않는다');
    // 같은 이유로 다시 멈춰도 댓글이 늘지 않는다(마지막 댓글이 같은 표식의 내 댓글이다)
    assert.equal(await run(), 'error');
    assert.equal(stopNotes(t.gh()).length, 1);
    // 다른 댓글이 그 뒤에 달렸으면 다시 알린다
    new FakeGitHub(t.state).ownerComment(1, '확인했다');
    assert.equal(await run(), 'error');
    assert.equal(stopNotes(t.gh()).length, 2);
    // 다시 시작해 끝까지 가면(idle) 알리지 않는다. 계획은 blocked가 아니라 그대로 이어진다
    process.env.HARNESS_FAKE_AGENT = agent;
    assert.equal(await run(), 'idle');
    assert.equal(t.gh().issues[0].state, 'closed');
    assert.equal(stopNotes(t.gh()).length, 2);
    assert.ok(!t.gh().issues[0].labels.includes('needs-human'));
  } finally {
    process.env.HARNESS_FAKE_AGENT = agent;
    t.fx.cleanup();
  }
});

test('정지 알림: 사용량 한도로 멈추면 이유와 함께 알리고, 맡은 계획이 없으면 알리지 않는다', async () => {
  const t = setup({ limits: { ...LIMITS, usageLimitMaxWaitMin: 0 } });
  try {
    const run = () =>
      runRunner({
        cwd: t.fx.root,
        worker: 'runner-1',
        tool: 'fake',
        maxIterations: 40,
        noWait: true,
        pollSec: 1,
      });
    addFakeIssue(t.state, 'Alpha feature', '알파');
    addFakeIssue(t.state, 'Beta feature', '베타');
    writeFileSync(t.behavior, JSON.stringify({ 'alpha-feature': { plan: ['limit'], steps: 1 } }));
    assert.equal(await run(), 'usage-limit');
    const notes = stopNotes(t.gh());
    assert.equal(notes.length, 1);
    assert.match(notes[0].body, /사용량 한도/);
    assert.match(notes[0].body, /<!-- harness-runner-stop:runner-1:usage-limit -->\s*$/);
    assert.equal(stopNotes(t.gh(), 2).length, 0, '맡지 않은 Issue에는 알리지 않는다');
    // 한 바퀴만 돌고 끝난 것(once)은 정지가 아니다
    writeFileSync(t.behavior, JSON.stringify({ 'alpha-feature': { steps: 1 } }));
    assert.equal(
      await runRunner({
        cwd: t.fx.root,
        worker: 'runner-1',
        tool: 'fake',
        once: true,
        noWait: true,
      }),
      'once',
    );
    assert.equal(stopNotes(t.gh()).length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('WIP: 작업자의 열린 PR(초안 포함)이 wipPerWorker개면 새 Issue를 선점하지 않는다', async () => {
  const t = setup({ limits: { ...LIMITS, wipPerWorker: 1 } }, { mergeMode: 'manual' });
  try {
    addFakeIssue(t.state, 'Alpha feature', '알파');
    addFakeIssue(t.state, 'Beta feature', '베타');
    writeFileSync(t.behavior, JSON.stringify({ 'alpha-feature': { steps: 1 } }));
    const stop = await runRunner({
      cwd: t.fx.root,
      worker: 'runner-1',
      tool: 'fake',
      maxIterations: 40,
      noWait: true,
    });
    assert.equal(stop, 'idle');
    const s = t.gh();
    assert.equal(s.prs.length, 1);
    assert.equal(s.prs[0].state, 'open', '자동 병합되지 않고 열려 있다');
    assert.ok(
      !t.events().some((e) => e.event === 'claimed' && e.issue === 2),
      '열린 PR이 상한이면 다음 Issue를 선점하지 않는다',
    );
    const cfg = loadConfig(t.fx.root);
    const pick = (wip: number) =>
      pickNext({
        main: t.fx.root,
        cfg: { ...cfg, limits: { ...cfg.limits, wipPerWorker: wip } },
        gh: getGitHub(t.fx.root),
        worker: 'runner-1',
      }).task;
    assert.equal(pick(1).kind, 'idle');
    // 초안 PR도 센다
    new FakeGitHub(t.state).setDraft(s.prs[0].number, true);
    assert.equal(pick(1).kind, 'idle');
    // 상한이 2면 다음 Issue를 고른다. 다른 작업자의 열린 PR은 세지 않는다
    const next = pick(2);
    assert.equal(next.kind, 'new-issue');
    assert.equal(next.kind === 'new-issue' ? next.issue.number : 0, 2);
    const other = pickNext({
      main: t.fx.root,
      cfg,
      gh: getGitHub(t.fx.root),
      worker: 'runner-2',
    }).task;
    assert.equal(other.kind, 'new-issue');
  } finally {
    t.fx.cleanup();
  }
});

test('runner: 원격 fetch가 실패해도 죽지 않고 환경 장애로 기다린다(다른 작업자의 fetch와 겹치거나 네트워크가 끊겼을 때)', async () => {
  const t = setup({ limits: { ...LIMITS, usageLimitMaxWaitMin: 0 } });
  try {
    sh(
      'git',
      ['remote', 'set-url', 'origin', path.join(t.fx.dir, 'no-such-remote.git')],
      t.fx.root,
    );
    // 대기 간격 0: 실패로 세지 않고 바퀴마다 다시 시도한다
    assert.equal(
      await runRunner({
        cwd: t.fx.root,
        worker: 'runner-1',
        tool: 'fake',
        maxIterations: 3,
        noWait: true,
      }),
      'max-iterations',
    );
    assert.equal(t.events().filter((e) => e.event === 'fetch-fail').length, 3);
    assert.equal(t.events().filter((e) => e.event === 'error').length, 0);
    // 기다린 시간이 상한을 넘으면 사용량 한도와 같은 이유로 멈춘다
    assert.equal(
      await runRunner({
        cwd: t.fx.root,
        worker: 'runner-1',
        tool: 'fake',
        maxIterations: 3,
        noWait: true,
        pollSec: 1,
      }),
      'usage-limit',
    );
  } finally {
    t.fx.cleanup();
  }
});
