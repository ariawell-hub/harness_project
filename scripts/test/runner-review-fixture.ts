// runner의 지적 대응 테스트(runner-review.test.ts, runner-review-rebuttal.test.ts, runner-review-round.test.ts)가 함께 쓰는 준비 코드.
// 원장(검증 App 봇 댓글)·필수 체크·판정 도우미. 테스트 파일이 아니다(이름이 .test.ts로 끝나지 않는다).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyVerdict, renderLedger, type Ledger, type Reviewer } from '../ci/ledger.ts';
import type { Finding, Resolution, Severity, Verdict } from '../ci/verdict.ts';
import { loadConfig } from '../lib/config.ts';
import { listWorktrees, repoInfo } from '../lib/git.ts';
import { getGitHub, type CommitCheck } from '../lib/github.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { pickNext } from '../runner/next.ts';
import { runRunner } from '../runner/run.ts';
import { HARNESS_ROOT, makeFixture, sh } from './helpers.ts';

export const BOT = 'harness-recorder[bot]';

export const ACTIONS = 15368;

export const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];

export function setup(over: Record<string, unknown> = {}) {
  const fx = makeFixture({ ci: { requiredChecks: REQUIRED, recorderBot: BOT }, ...over });
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
  const events = (name: string) =>
    readFileSync(path.join(repoInfo(fx.root).commonDir, 'harness', 'runner.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((e) => e.event === name);
  return { fx, state, behavior, raw, gh, prompts, events };
}

export type T = ReturnType<typeof setup>;

export const run = (root: string, once = false) =>
  runRunner({ cwd: root, worker: 'runner-1', tool: 'fake', maxIterations: 40, noWait: true, once });

export const pick = (root: string) =>
  pickNext({ main: root, cfg: loadConfig(root), gh: getGitHub(root), worker: 'runner-1' });

export const headOf = (t: T, branch: string) => t.gh.findPRByBranch(branch)!.headSha;

export function setAll(t: T, sha: string, over: Record<string, CommitCheck['state'] | null> = {}) {
  for (const r of REQUIRED) {
    const state = r.context in over ? over[r.context] : 'success';
    if (state === null) continue;
    if (r.source === 'actions')
      t.gh.setCheck(sha, { context: r.context, kind: 'check-run', appId: ACTIONS, state });
    else t.gh.setCheck(sha, { context: r.context, creator: BOT, state, description: `${state}!` });
  }
}

/** 그 검증자가 수정을 요청하고 원장에 열린 차단 지적이 있는 head의 CI 결과 */
export const reviewChecks = (
  t: T,
  sha: string,
  reviewer: Reviewer,
  ledgerState: 'failure' | 'success' = 'failure',
) => setAll(t, sha, { [`review/${reviewer}`]: 'failure', 'review-ledger': ledgerState });

/** Issue 하나를 진행해 PR이 열리고 CI를 기다리는 상태(계획 검증이 켜져 있으면 계획 검증 초안 PR) */
export async function openPr(t: T) {
  addFakeIssue(t.state, 'Demo feature', '데모 기능을 만든다');
  assert.equal(await run(t.fx.root), 'idle');
  const pr = t.raw().prs[0];
  const worktree = listWorktrees(t.fx.root).find((w) => w.branch === pr.head)!.path;
  const id = pr.head.replace(/^[a-z]+\//, '').replace(/-s\d+$/, '');
  return { number: pr.number, branch: pr.head, worktree, id, head: () => headOf(t, pr.head) };
}

export const finding = (
  severity: Severity,
  file: string,
  line: number,
  title: string,
): Finding => ({
  severity,
  file,
  line,
  title,
  evidence: '근거가 있다',
  suggestion: '이렇게 고친다',
  repro: { path: '', content: '' },
});

export const verdict = (findings: Finding[], resolutions: Resolution[] = []): Verdict => ({
  verdict: 'request_changes',
  risk: 'normal',
  summary: '요약',
  findings,
  resolutions,
});

/** 검증자의 판정 하나를 원장에 반영한다(기록 job이 하는 일) */
export function judged(
  l: Ledger,
  reviewer: Reviewer,
  head: string,
  findings: Finding[],
  resolutions: Resolution[] = [],
): Ledger {
  return applyVerdict(l, {
    reviewer,
    verdict: verdict(findings, resolutions),
    headSha: head,
    changedSinceLastRound: findings.map((f) => f.file),
  });
}

/** 원장 댓글을 쓰거나 고친다. author를 주면 그 계정의 댓글로 쓴다 */
export function postLedger(t: T, pr: number, ledger: Ledger, author = BOT) {
  const comments = t.raw().issues.find((i) => i.number === pr)?.comments ?? [];
  const index = comments.findIndex((c) => c.author === author);
  if (index < 0) t.gh.commentAs(pr, author, renderLedger(ledger));
  else t.gh.editCommentAs(pr, index, author, renderLedger(ledger));
}

export const reviewSessions = (t: T) => t.prompts().filter((p) => p.step === 'review');

export const BASE = 'a'.repeat(40);

// ---------- step4: 반박·교착·근거 읽기 ----------

export const prCommentsBy = (t: T, pr: number, author: string) =>
  (t.raw().issues.find((i) => i.number === pr)?.comments ?? []).filter((c) => c.author === author);

export const codeDiff = (worktree: string, from: string, to: string) =>
  sh(
    'git',
    ['diff', '--name-only', from, to, '--', '.', ':(exclude)docs/exec-plans'],
    worktree,
  ).trim();
