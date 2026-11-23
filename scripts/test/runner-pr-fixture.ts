// runner와 2단계 PR 흐름 테스트(runner-pr.test.ts, runner-pr-update.test.ts)가 함께 쓰는 준비 코드.
// 가짜 GitHub은 필수 체크(출처 포함)가 모두 success일 때만 병합한다. 테스트 파일이 아니다(이름이 .test.ts로 끝나지 않는다).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.ts';
import { listWorktrees } from '../lib/git.ts';
import { getGitHub, type CommitCheck } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { pickNext } from '../runner/next.ts';
import { runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, makeFixture } from './helpers.ts';

export const BOT = 'harness-recorder[bot]';

export const ACTIONS = 15368;

export const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'risk-gate', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];

export function setup() {
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

export type T = ReturnType<typeof setup>;

export const run = (root: string, once = false) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 40, noWait: true, once });

/** Issue 하나를 계획·step0까지 진행해 PR이 열리고 CI를 기다리는 상태로 만든다 */
export async function openPr(t: T) {
  addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
  const stop = await run(t.fx.root);
  assert.equal(stop, 'idle', '필수 체크가 아직 없으면 CI 대기다');
  const pr = t.raw().prs[0];
  assert.equal(pr.state, 'open');
  const worktree = listWorktrees(t.fx.root).find((w) => w.branch === pr.head)!.path;
  return { number: pr.number, branch: pr.head, worktree, head: () => headOf(t, pr.head) };
}

/** 브랜치 이름(`feat/<계획 id>-s<N>`)에서 계획 id */
export const planId = (branch: string) => branch.replace(/^[a-z]+\//, '').replace(/-s\d+$/, '');

export const headOf = (t: T, branch: string) => t.gh.findPRByBranch(branch)!.headSha;

/** head에 필수 체크를 기대 출처로 쓴다. over로 context별 상태를 바꾸고 null이면 쓰지 않는다 */
export function setAll(t: T, sha: string, over: Record<string, CommitCheck['state'] | null> = {}) {
  for (const r of REQUIRED) {
    const state = r.context in over ? over[r.context] : 'success';
    if (state === null) continue;
    if (r.source === 'actions')
      t.gh.setCheck(sha, { context: r.context, kind: 'check-run', appId: ACTIONS, state });
    else t.gh.setCheck(sha, { context: r.context, creator: BOT, state, description: `${state}!` });
  }
}

export const pick = (root: string) =>
  pickNext({ main: root, cfg: loadConfig(root), gh: getGitHub(root), worker: 'runner-1' });
