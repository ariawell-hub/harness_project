// risk-gate(10.1·10.3절)와 PR 해석(ci-pr). 계획 20261114-ci-gates step1.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { resolvePr } from '../ci/pr.ts';
import { runGates } from '../ci/gates.ts';
import { validateResults, GATE_CONTEXTS } from '../ci/results.ts';
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
  assert.equal(validateResults(r, { headSha: hi.head, contexts: GATE_CONTEXTS }).ok, true);
  assert.equal(
    validateResults({ ...r, risk: 'none' }, { headSha: hi.head, contexts: GATE_CONTEXTS }).ok,
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

const NEW_H = 'd'.repeat(40);
const prTarget = (event: unknown, api: (p: string) => Promise<unknown>) =>
  resolvePr({ eventName: 'pull_request_target', event, repo: REPO, api });

test('resolvePr: pull_request_target은 이벤트의 PR 번호로 API를 조회해 실행 시점의 head를 낸다(Issue #181)', async () => {
  const calls: string[] = [];
  // 이벤트는 본문을 고친 때의 것이다: head가 이전 것이고 본문도 이전 것이다
  const r = await prTarget({ pull_request: prObj({ body: '이전 본문' }) }, async (p) => {
    calls.push(p);
    return prObj({
      body: '새 본문',
      head: { sha: NEW_H, ref: 'feat/renamed', repo: { full_name: REPO } },
      base: { sha: 'e'.repeat(40), ref: 'main' },
    });
  });
  assert.deepEqual(calls, [`repos/${REPO}/pulls/7`]);
  assert.deepEqual(r, {
    number: 7,
    headSha: NEW_H,
    headRef: 'feat/renamed',
    baseSha: 'e'.repeat(40),
    body: '새 본문',
  });
  // head가 그대로면 같은 값이 나온다. 닫힌 PR도 전처럼 판정한다(열림·닫힘을 따지지 않는다)
  const same = await prTarget({ pull_request: prObj() }, async () => prObj({ state: 'closed' }));
  assert.ok(!('skip' in same) && same.headSha === H && same.body === '본문');
});

test('resolvePr: pull_request_target의 이벤트가 포크 PR이거나 형식이 틀리면 API를 부르지 않고 건너뛴다', async () => {
  const api = async () => assert.fail('API를 부르면 안 된다');
  for (const pull_request of [
    prObj({ head: { sha: H, ref: BRANCH, repo: { full_name: 'x/r' } } }),
    prObj({ head: { sha: H, ref: BRANCH, repo: null } }),
    prObj({ head: { sha: 'zzz', ref: BRANCH, repo: { full_name: REPO } } }),
    prObj({ number: '7' }),
    prObj({ number: 0 }),
    prObj({ number: 1.5 }),
    prObj({ number: -3 }),
  ]) {
    const r = await prTarget({ pull_request }, api);
    assert.ok('skip' in r, JSON.stringify(pull_request));
  }
  assert.ok('skip' in (await prTarget({}, api)));
  assert.ok('skip' in (await prTarget(null, api)));
});

test('resolvePr: pull_request_target의 조회 응답이 이벤트의 PR과 맞지 않으면 건너뛰지 않고 실패한다(상태가 조용히 빠지지 않는다)', async () => {
  const ev = { pull_request: prObj() };
  for (const res of [
    null,
    undefined,
    'x',
    [prObj()],
    { message: 'Not Found' },
    prObj({ number: 8 }),
    prObj({ head: { sha: 'zzz', ref: BRANCH, repo: { full_name: REPO } } }),
    prObj({ head: { sha: NEW_H, ref: 7, repo: { full_name: REPO } } }),
    prObj({ base: { sha: 'zzz' } }),
  ]) {
    await assert.rejects(
      prTarget(ev, async () => res),
      /PR 조회 응답/,
      JSON.stringify(res),
    );
  }
  // API가 던지면 그 예외가 그대로 나온다
  await assert.rejects(
    prTarget(ev, async () => {
      throw new Error('GitHub 조회 실패: HTTP 502 repos/o/r/pulls/7');
    }),
    /HTTP 502/,
  );
});

test('resolvePr: pull_request_target의 조회 응답이 포크 PR이면 건너뛴다(포크 PR은 판정하지 않는다)', async () => {
  const ev = { pull_request: prObj() };
  for (const head of [
    { sha: NEW_H, ref: BRANCH, repo: { full_name: 'x/r' } },
    { sha: NEW_H, ref: BRANCH, repo: null },
  ]) {
    const r = await prTarget(ev, async () => prObj({ head }));
    assert.ok('skip' in r, JSON.stringify(head));
  }
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
