// risk-gate(10.1·10.3절)와 PR 해석(ci-pr). 계획 20261114-ci-gates step1.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { resolvePr } from '../ci/pr.ts';
import { runGates } from '../ci/gates.ts';
import { validateResults, RECORDED_CONTEXTS } from '../ci/results.ts';
import {
  assessRisk,
  changedFiles,
  ownerApprovedHead,
  parseReviews,
  riskGate,
  type Review,
} from '../gates/risk-gate.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const BRANCH = 'feat/20261114-demo-s0';
const DIR = 'docs/exec-plans/active/20261114-demo';
const plan = (risk: string) =>
  `---\nid: 20261114-demo\nissue: 3\ntype: feat\nstatus: active\nsize: medium\nrisk: ${risk}\nauthor: claude-code\nowner: r\nclaimed_at: 2026-11-14T09:00:00+09:00\n---\n# 데모\n`;

function repo(
  files: Record<string, string | Buffer>,
  o: { planRisk?: string; cfg?: Record<string, unknown> } = {},
): { root: string; base: string; head: string; cfg: HarnessConfig } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(
      fixtureConfig({
        riskPaths: [
          { glob: 'docs/**', risk: 'low' },
          { glob: 'src/**', risk: 'normal' },
          { glob: 'migrations/**', risk: 'high' },
        ],
        protectedPaths: ['scripts/**'],
        ...o.cfg,
      }),
    ),
  );
  write(root, 'old.txt', 'x\n');
  const base = commitAll(root, 'init');
  const cfg = loadConfig(root);
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  if (o.planRisk) write(root, `${DIR}/plan.md`, plan(o.planRisk));
  for (const [f, c] of Object.entries(files)) write(root, f, c as string);
  const head = commitAll(root, 'change');
  return { root, base, head, cfg };
}

const assess = (r: ReturnType<typeof repo>, signals = [] as { risk: 'high'; reason: string }[]) =>
  assessRisk({ root: r.root, base: r.base, branch: BRANCH, cfg: r.cfg, signals });

test('changedFiles: 바이너리와 삭제 파일을 구분해 돌려준다', () => {
  const r = repo({ 'a.txt': 'a\n', 'img.bin': Buffer.from([0, 1, 2, 0, 255]) as never });
  sh('git', ['rm', '-q', 'old.txt'], r.root);
  commitAll(r.root, 'rm');
  const files = changedFiles(r.root, r.base);
  assert.deepEqual(files.map((f) => [f.path, f.binary]).sort(), [
    ['a.txt', false],
    ['img.bin', true],
    ['old.txt', false],
  ]);
});

test('assessRisk: 경로 표의 최댓값, 안 맞는 경로는 low', () => {
  assert.equal(assess(repo({ 'docs/a.md': 'a\n', 'other.txt': 'a\n' })).risk, 'low');
  assert.equal(assess(repo({ 'docs/a.md': 'a\n', 'src/a.ts': 'a\n' })).risk, 'normal');
  const hi = assess(repo({ 'src/a.ts': 'a\n', 'migrations/1.sql': 'a\n' }));
  assert.equal(hi.risk, 'high');
  assert.match(hi.reasons.join(' '), /migrations\/1\.sql/);
});

test('assessRisk: 계획 risk는 올릴 수만 있다', () => {
  assert.equal(assess(repo({ 'docs/a.md': 'a\n' }, { planRisk: 'high' })).risk, 'high');
  assert.equal(assess(repo({ 'migrations/1.sql': 'a\n' }, { planRisk: 'low' })).risk, 'high');
  assert.equal(assess(repo({ 'docs/a.md': 'a\n' }, { planRisk: 'bogus' })).risk, 'low');
});

test('assessRisk: 보호 경로는 build=normal, operation=high', () => {
  assert.equal(assess(repo({ 'scripts/x.ts': 'a\n' })).risk, 'normal');
  assert.equal(
    assess(repo({ 'scripts/x.ts': 'a\n' }, { cfg: { stage: 'operation' } })).risk,
    'high',
  );
});

test('assessRisk: 바이너리 파일과 신호는 high', () => {
  const bin = assess(repo({ 'docs/img.bin': Buffer.from([0, 1, 2, 0, 255]) as never }));
  assert.equal(bin.risk, 'high');
  assert.match(bin.reasons.join(' '), /판정할 수 없는 파일 형식/);
  const sig = assess(repo({ 'docs/a.md': 'a\n' }), [{ risk: 'high', reason: '권한 완화' }]);
  assert.equal(sig.risk, 'high');
  assert.match(sig.reasons.join(' '), /권한 완화/);
});

const H = 'a'.repeat(40);
const rv = (user: string, state: string, commitId = H, at = '2026-11-14T00:00:00Z'): Review => ({
  user,
  state,
  commitId,
  submittedAt: at,
});

test('ownerApprovedHead: 제작자의 마지막 판정 리뷰가 head 승인일 때만', () => {
  assert.equal(ownerApprovedHead([rv('maker', 'APPROVED')], 'maker', H), true);
  assert.equal(ownerApprovedHead([rv('Maker', 'APPROVED')], 'maker', H), true);
  assert.equal(ownerApprovedHead([], 'maker', H), false);
  assert.equal(ownerApprovedHead([rv('bot', 'APPROVED')], 'maker', H), false);
  assert.equal(ownerApprovedHead([rv('maker', 'APPROVED', 'b'.repeat(40))], 'maker', H), false);
  assert.equal(
    ownerApprovedHead(
      [rv('maker', 'APPROVED'), rv('maker', 'CHANGES_REQUESTED', H, '2026-11-14T01:00:00Z')],
      'maker',
      H,
    ),
    false,
  );
  assert.equal(
    ownerApprovedHead(
      [rv('maker', 'APPROVED'), rv('maker', 'COMMENTED', H, '2026-11-14T01:00:00Z')],
      'maker',
      H,
    ),
    true,
  );
  assert.equal(
    ownerApprovedHead(
      [rv('maker', 'APPROVED'), rv('maker', 'DISMISSED', H, '2026-11-14T01:00:00Z')],
      'maker',
      H,
    ),
    false,
  );
  assert.equal(ownerApprovedHead([rv('maker', 'APPROVED')], '', H), false);
});

test('parseReviews: API 원본(배열, --slurp 배열의 배열)을 바꾸고 깨진 값은 null', () => {
  const raw = { user: { login: 'maker' }, state: 'APPROVED', commit_id: H, submitted_at: 't' };
  assert.deepEqual(parseReviews(JSON.stringify([raw])), [rv('maker', 'APPROVED', H, 't')]);
  assert.equal(parseReviews(JSON.stringify([[raw], [raw]]))!.length, 2);
  assert.equal(parseReviews('{'), null);
  assert.equal(parseReviews(JSON.stringify({ message: 'Not Found' })), null);
  assert.equal(parseReviews(JSON.stringify([{ state: 'APPROVED' }])), null);
});

test('riskGate: 보통은 통과, 높음은 제작자 head 승인이 있어야 통과', () => {
  const lo = repo({ 'src/a.ts': 'a\n' });
  const a = riskGate({ ...lo, branch: BRANCH, signals: [], headSha: lo.head, reviews: null });
  assert.equal(a.state, 'success');
  assert.equal(a.risk, 'normal');
  const hi = repo({ 'migrations/1.sql': 'a\n' });
  const o = { ...hi, branch: BRANCH, signals: [], headSha: hi.head };
  const none = riskGate({ ...o, reviews: [] });
  assert.equal(none.state, 'failure');
  assert.match(none.description, /제작자 head 승인 필요/);
  assert.equal(riskGate({ ...o, reviews: [rv('maker', 'APPROVED', hi.head)] }).state, 'success');
  assert.equal(riskGate({ ...o, reviews: [rv('maker', 'APPROVED', hi.base)] }).state, 'failure');
  assert.equal(riskGate({ ...o, reviews: null }).state, 'error');
});

test('runGates: risk-gate 결과와 risk를 담고 결과 검사를 통과한다', async () => {
  const hi = repo({ 'migrations/1.sql': 'a\n' });
  const r = await runGates({ ...hi, branch: BRANCH, headSha: hi.head, reviews: [] });
  assert.equal(r.risk, 'high');
  assert.equal(r.results.find((x) => x.context === 'risk-gate')!.state, 'failure');
  assert.equal(validateResults(r, { headSha: hi.head, contexts: RECORDED_CONTEXTS }).ok, true);
  assert.equal(
    validateResults({ ...r, risk: 'none' }, { headSha: hi.head, contexts: RECORDED_CONTEXTS }).ok,
    false,
  );
});

// ---------- ci-pr ----------

const REPO = 'o/r';
const prObj = (over: Record<string, unknown> = {}) => ({
  number: 7,
  state: 'open',
  body: '본문',
  head: { sha: H, ref: BRANCH, repo: { full_name: REPO } },
  base: { sha: 'b'.repeat(40), ref: 'main' },
  ...over,
});

test('resolvePr: pull_request_target은 이벤트에서, 포크는 건너뛴다', async () => {
  const api = async () => assert.fail('API를 부르면 안 된다');
  const r = await resolvePr({
    eventName: 'pull_request_target',
    event: { pull_request: prObj() },
    repo: REPO,
    api,
  });
  assert.deepEqual(r, {
    number: 7,
    headSha: H,
    headRef: BRANCH,
    baseSha: 'b'.repeat(40),
    body: '본문',
  });
  const fork = await resolvePr({
    eventName: 'pull_request_target',
    event: { pull_request: prObj({ head: { sha: H, ref: BRANCH, repo: { full_name: 'x/r' } } }) },
    repo: REPO,
    api,
  });
  assert.ok('skip' in fork);
});

test('resolvePr: workflow_run은 head SHA로 API를 조회해 열린 같은 리포 PR만 고른다', async () => {
  const calls: string[] = [];
  const mk = (list: unknown) => async (p: string) => {
    calls.push(p);
    return list;
  };
  const ev = { workflow_run: { head_sha: H, pull_requests: [{ number: 999 }] } };
  const ok = await resolvePr({
    eventName: 'workflow_run',
    event: ev,
    repo: REPO,
    api: mk([prObj({ state: 'closed', number: 1 }), prObj({ body: null })]),
  });
  assert.deepEqual(calls, [`repos/${REPO}/commits/${H}/pulls`]);
  assert.ok(!('skip' in ok) && ok.number === 7 && ok.body === '');
  for (const list of [
    [],
    [prObj({ state: 'closed' })],
    [prObj({ head: { sha: 'c'.repeat(40), ref: BRANCH, repo: { full_name: REPO } } })],
    [prObj({ head: { sha: H, ref: BRANCH, repo: { full_name: 'x/r' } } })],
    { message: 'Not Found' },
  ]) {
    const r = await resolvePr({ eventName: 'workflow_run', event: ev, repo: REPO, api: mk(list) });
    assert.ok('skip' in r, JSON.stringify(list));
  }
  const bad = await resolvePr({
    eventName: 'workflow_run',
    event: { workflow_run: { head_sha: 'zzz' } },
    repo: REPO,
    api: mk([]),
  });
  assert.ok('skip' in bad);
  assert.ok('skip' in (await resolvePr({ eventName: 'push', event: {}, repo: REPO, api: mk([]) })));
});
