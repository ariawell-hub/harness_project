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
import { dismissRuleOf } from '../lib/rules.ts';
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
/** readDismissRule이 돌려주는 값: 기본 브랜치에 규칙이 켜져 있다 / 꺼져 있다(Issue #250) */
const ON = { base: 'main', on: true };
const OFF = { base: 'main', on: false };
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
  // 승인은 규칙 세트(오래된 승인 철회)가 켜져 있고 전환 시각 뒤일 때만 head에 묶인다(Issue #250)
  hi.cfg.github.dismissStaleSince = '2026-11-13T00:00:00Z';
  const o = { ...hi, branch: BRANCH, signals: [], headSha: hi.head, dismissRule: ON };
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
    // head 저장소의 이름이 없거나 글이 아니면 포크인지 알 수 없다: 건너뛰지 않고 실패한다(F2)
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: {} } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 7 } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: '' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: 'x/r' } }),
    // 이름이 owner/name 꼴이 아니면 다른 리포로 확인된 것이 아니다(F3)
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 'invalid' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 'a/b/c' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 'x/' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: '/r' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 'x/r y' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH, repo: { full_name: 'x/r\n' } } }),
    prObj({ head: { sha: NEW_H, ref: BRANCH } }),
    prObj({ head: null }),
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

// ---------- 오래된 승인 철회 규칙 세트(Issue #250 step1) ----------

const RULE_ON = { type: 'pull_request', parameters: { dismiss_stale_reviews_on_push: true } };

test('dismissRuleOf: 쪽들 가운데 오래된 승인 철회가 켜진 pull_request 규칙이 있으면 true, 꼴이 틀리면 null', () => {
  assert.equal(dismissRuleOf([[RULE_ON]]), true);
  assert.equal(
    dismissRuleOf([[{ type: 'deletion' }], [{ type: 'non_fast_forward' }, RULE_ON]]),
    true,
  );
  assert.equal(
    dismissRuleOf([
      [{ type: 'pull_request', parameters: { dismiss_stale_reviews_on_push: false } }],
    ]),
    false,
  );
  assert.equal(dismissRuleOf([[]]), false);
  assert.equal(dismissRuleOf([[{ type: 'deletion' }, { type: 'pull_request' }]]), false);
  assert.equal(dismissRuleOf({ message: 'Not Found' }), null);
  assert.equal(dismissRuleOf([{ message: 'x' }]), null);
  assert.equal(dismissRuleOf([[{ parameters: {} }]]), null);
  assert.equal(dismissRuleOf([[null]]), null);
});

test('riskGate: 위험도 높음은 승인 리뷰 → 규칙 → 전환 시각 → head 순으로 본다(Issue #250)', () => {
  const hi = repo({ 'migrations/1.sql': 'a\n' });
  const since = '2026-11-14T00:00:00Z';
  hi.cfg.github.dismissStaleSince = since;
  const o = { ...hi, branch: BRANCH, signals: [], headSha: hi.head };
  const approve = (at: string, commit = hi.head) => [rv('maker', 'APPROVED', commit, at)];
  const ok = approve('2026-11-14T01:00:00Z');
  // 승인 리뷰가 없으면 규칙과 무관하게 failure
  for (const dismissRule of [ON, OFF, null, undefined])
    assert.equal(
      riskGate({ ...o, reviews: [], dismissRule }).state,
      'failure',
      JSON.stringify(dismissRule),
    );
  // 규칙을 확인하지 못했다(없음·null) → error, 복구 방법은 SECURITY.md
  for (const dismissRule of [null, undefined]) {
    const r = riskGate({ ...o, reviews: ok, dismissRule });
    assert.equal(r.state, 'error', JSON.stringify(dismissRule));
    assert.equal(
      r.description,
      '위험도 높음: 오래된 승인 철회 규칙을 확인하지 못해 제작자 승인을 head에 묶을 수 없다',
    );
    assert.match(r.details.join('\n'), /docs\/SECURITY\.md/);
  }
  // 규칙이 없다 → failure, 고치는 법은 SECURITY.md의 절차
  const off = riskGate({ ...o, reviews: ok, dismissRule: OFF });
  assert.equal(off.state, 'failure');
  assert.equal(
    off.description,
    '위험도 높음: 오래된 승인 철회 규칙이 없어 제작자 승인을 head에 묶을 수 없다',
  );
  assert.match(off.details.join('\n'), /고치는 법: .*docs\/SECURITY\.md/);
  // 전환 시각이 없거나 시각이 아니다 → failure(설정 방법)
  for (const bad of [undefined, '어제']) {
    const cfg = { ...hi.cfg, github: { ...hi.cfg.github, dismissStaleSince: bad } };
    const r = riskGate({ ...o, cfg, reviews: ok, dismissRule: ON });
    assert.equal(r.state, 'failure', String(bad));
    assert.match(r.description, /github\.dismissStaleSince/);
  }
  // 규칙을 켜기 전의 승인(리뷰 커밋이 head로 옮겨진 것)은 failure, 현재 head를 다시 승인하면 success(계획 검증 F23)
  const before = approve('2026-11-13T23:59:59Z');
  const old = riskGate({ ...o, reviews: before, dismissRule: ON });
  assert.equal(old.state, 'failure');
  assert.equal(
    old.description,
    '위험도 높음: 규칙을 켜기 전의 승인이라 현재 head를 다시 승인해야 한다',
  );
  const again = [...before, ...approve('2026-11-14T02:00:00Z')];
  assert.equal(riskGate({ ...o, reviews: again, dismissRule: ON }).state, 'success');
  // 경계: 전환 시각과 같은 초(소수 초 포함)는 failure, 1초 뒤는 success
  for (const at of ['2026-11-14T00:00:00Z', '2026-11-14T00:00:00.900Z'])
    assert.equal(riskGate({ ...o, reviews: approve(at), dismissRule: ON }).state, 'failure', at);
  assert.equal(
    riskGate({ ...o, reviews: approve('2026-11-14T00:00:01Z'), dismissRule: ON }).state,
    'success',
  );
  // 제출 시각을 읽을 수 없으면 뒤라고 보지 않는다
  assert.equal(riskGate({ ...o, reviews: approve(''), dismissRule: ON }).state, 'failure');
  // 규칙·시각이 맞아도 리뷰의 커밋이 head가 아니면 failure(지금 판정)
  const stale = riskGate({
    ...o,
    reviews: approve('2026-11-14T01:00:00Z', hi.base),
    dismissRule: ON,
  });
  assert.equal(stale.state, 'failure');
  assert.match(stale.description, /제작자 head 승인 필요/);
  assert.equal(riskGate({ ...o, reviews: ok, dismissRule: ON }).state, 'success');
  // base가 기본 브랜치가 아니면 그 브랜치에 규칙이 있고 승인이 main 전환 시각 뒤여도 failure(#258 판정 F25)
  const rel = riskGate({ ...o, reviews: ok, dismissRule: { base: 'release', on: true } });
  assert.equal(rel.state, 'failure');
  assert.equal(
    rel.description,
    '위험도 높음: 기본 브랜치가 아닌 base(release)에는 승인 전환 시각이 없어 제작자 승인을 셀 수 없다',
  );
  // 위험도 보통은 규칙과 무관하게 success
  const lo = repo({ 'src/a.ts': 'a\n' });
  assert.equal(
    riskGate({
      ...lo,
      branch: BRANCH,
      signals: [],
      headSha: lo.head,
      reviews: [],
      dismissRule: OFF,
    }).state,
    'success',
  );
});
