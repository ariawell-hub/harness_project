// runner 통합 테스트(12.4절 4.5절 시나리오, 1단계 완료 기준 S6).
// 가짜 에이전트 + 가짜 GitHub(즉시 squash merge) + 로컬 bare 원격.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { readAttempts } from '../lib/attempts.ts';
import { repoInfo, listWorktrees } from '../lib/git.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, makeFixture, sh } from './helpers.ts';

function setup(configOver: Record<string, unknown> = {}) {
  const fx = makeFixture(configOver);
  const state = path.join(fx.dir, 'gh.json');
  const behavior = path.join(fx.dir, 'behavior.json');
  const logFile = path.join(fx.dir, 'prompts.jsonl');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
  writeFileSync(behavior, '{}');
  writeFileSync(logFile, '');
  process.env.HARNESS_FAKE_GH = state;
  process.env.HARNESS_FAKE_AGENT = path.join(HARNESS_ROOT, 'scripts/test/fake-agent.ts');
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
