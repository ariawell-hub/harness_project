// PR 상태 판정(10.3절 "체크 요약 API는 출처를 보지 않는다"). 계획 20261115-runner-pr-flow step0.
// 필수 체크는 설정의 context마다 기대 출처가 쓴 가장 최근 결과로 본다. 흉내 체크는 없는 것으로 본다.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { applyVerdict, emptyLedger, renderLedger, type Ledger } from '../ci/ledger.ts';
import { ACTIONS_APP_ID } from '../ci/protection.ts';
import { gatesMissingLine } from '../commands/pr-state.ts';
import { newTask } from '../commands/task.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { isBehind } from '../lib/git.ts';
import { FakeGitHub, initFakeState } from '../lib/github-fake.ts';
import {
  checkRunToCheck,
  newestFirst,
  statusToCheck,
  type CommitCheck,
  type PullRequest,
} from '../lib/github.ts';
import {
  classifyPr,
  gatesMissing,
  requiredStates,
  type RequiredState,
} from '../runner/pr-state.ts';
import { HARNESS_ROOT, commitAll, makeFixture, sh, tmp, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'risk-gate', source: 'recorder' as const },
  { context: 'deps-guard', source: 'recorder' as const },
  { context: 'harness-guard', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];
const CI = { requiredChecks: REQUIRED, recorderBot: BOT };

let clock = 0;
/** 뒤에 만든 것이 더 최근이다 */
const at = () => new Date(Date.UTC(2026, 10, 15, 0, 0, clock++)).toISOString();

function status(
  context: string,
  state: CommitCheck['state'],
  creator = BOT,
  description = '',
): CommitCheck {
  return {
    context,
    kind: 'status',
    state,
    description,
    creator,
    appId: null,
    targetUrl: '',
    at: at(),
  };
}

function run(context: string, state: CommitCheck['state'], appId = ACTIONS_APP_ID): CommitCheck {
  return {
    context,
    kind: 'check-run',
    state,
    description: '',
    creator: '',
    appId,
    targetUrl: '',
    at: at(),
  };
}

/** 필수 체크가 모두 success인 목록. over로 context별 상태를 바꾸고, null이면 그 체크를 뺀다 */
function green(over: Record<string, CommitCheck['state'] | null> = {}): CommitCheck[] {
  const out: CommitCheck[] = [];
  for (const r of REQUIRED) {
    const s = r.context in over ? over[r.context] : 'success';
    if (s === null) continue;
    out.push(r.source === 'actions' ? run(r.context, s) : status(r.context, s));
  }
  return out.reverse(); // 최신 먼저
}

const PR: PullRequest = {
  number: 7,
  title: 't',
  body: '',
  head: 'feat/20261115-demo-s0',
  headSha: 'a'.repeat(40),
  state: 'open',
  isDraft: false,
  autoMerge: true,
  labels: [],
  url: '',
  mergeState: 'BLOCKED',
  checks: 'pending',
  failingChecks: [],
};

function classify(
  over: Record<string, CommitCheck['state'] | null> = {},
  o: { pr?: Partial<PullRequest>; behind?: boolean; stepCompleted?: boolean } = {},
) {
  return classifyPr({
    pr: { ...PR, ...o.pr },
    required: requiredStates(green(over), CI),
    behind: o.behind ?? false,
    stepCompleted: o.stepCompleted ?? true,
  });
}

const stateOf = (list: RequiredState[], context: string) =>
  list.find((r) => r.context === context)?.state;

test('requiredStates: 설정 순서대로 하나씩 내고, 해당 출처의 결과가 없으면 missing이다', () => {
  const r = requiredStates([], CI);
  assert.deepEqual(
    r.map((x) => x.context),
    REQUIRED.map((x) => x.context),
  );
  assert.ok(r.every((x) => x.state === 'missing'));
  assert.equal(r[0].source, 'actions');
  assert.equal(r[1].source, 'recorder');
});

test('requiredStates: recorder 체크는 검증 App 봇이 쓴 커밋 상태만 본다(봇 PAT·Actions가 쓴 같은 이름은 무시)', () => {
  const only = requiredStates(
    [status('review/claude', 'success', 'ariawell247'), run('review/codex', 'success')],
    CI,
  );
  assert.equal(stateOf(only, 'review/claude'), 'missing');
  assert.equal(stateOf(only, 'review/codex'), 'missing');
  // 흉내 상태가 더 최근이어도 검증 App의 결과를 가리지 않는다
  const real = status('review/claude', 'failure', BOT, '수정 요청 (P1 1)');
  const fake = status('review/claude', 'success', 'ariawell247');
  const r = requiredStates([fake, real], CI);
  assert.equal(stateOf(r, 'review/claude'), 'failure');
  assert.equal(r.find((x) => x.context === 'review/claude')?.description, '수정 요청 (P1 1)');
});

test('requiredStates: actions 체크는 GitHub Actions App의 check run만 본다', () => {
  const r = requiredStates([status('check', 'success', BOT), run('check', 'success', 999)], CI);
  assert.equal(stateOf(r, 'check'), 'missing');
  assert.equal(stateOf(requiredStates([run('check', 'failure')], CI), 'check'), 'failure');
});

test('requiredStates: 같은 출처의 기록이 여럿이면 입력 순서와 관계없이 가장 최근 것을 쓴다', () => {
  const old = status('plan-gate', 'failure');
  const recent = status('plan-gate', 'success');
  assert.equal(stateOf(requiredStates([recent, old], CI), 'plan-gate'), 'success');
  assert.equal(stateOf(requiredStates([old, recent], CI), 'plan-gate'), 'success');
  const rerunOld = run('check', 'failure');
  const rerun = run('check', 'pending');
  assert.equal(stateOf(requiredStates([rerunOld, rerun], CI), 'check'), 'pending');
});

test('requiredStates: ci.recorderBot이 없으면 recorder 체크는 모두 missing이다', () => {
  const r = requiredStates(green(), { requiredChecks: REQUIRED, recorderBot: null });
  assert.equal(stateOf(r, 'check'), 'success');
  assert.ok(r.filter((x) => x.source === 'recorder').every((x) => x.state === 'missing'));
});

test('classifyPr 1·2: 열려 있지 않으면 closed, DIRTY면 다른 상태와 관계없이 conflict', () => {
  assert.equal(classify({}, { pr: { state: 'merged' } }).kind, 'closed');
  assert.equal(classify({ check: 'failure' }, { pr: { state: 'closed' } }).kind, 'closed');
  assert.equal(classify({ check: 'failure' }, { pr: { mergeState: 'DIRTY' } }).kind, 'conflict');
});

test('classifyPr 3: check(Actions) 실패는 다른 체크가 진행 중이거나 없어도 fix다', () => {
  const v = classify({ check: 'failure', 'review/claude': null, 'review/codex': 'pending' });
  assert.equal(v.kind, 'fix');
  assert.deepEqual(v.kind === 'fix' ? v.failing.map((f) => f.context) : [], ['check']);
});

test('classifyPr 4: 진행 중이거나 아직 없는 필수 체크가 있으면 wait-ci이고, 그동안 다른 실패는 보지 않는다', () => {
  const v = classify({ 'review/claude': 'failure', 'review/codex': 'pending' });
  assert.equal(v.kind, 'wait-ci');
  assert.deepEqual(v.kind === 'wait-ci' ? v.waiting : [], ['review/codex']);
  const none = classify({ 'harness-guard': 'failure', 'review-ledger': null });
  assert.deepEqual(none.kind === 'wait-ci' ? none.waiting : [], ['review-ledger']);
  assert.equal(classify({ check: 'pending' }).kind, 'wait-ci');
});

test('classifyPr 5: step이 끝나지 않은 PR(계획 검증 중)은 plan-gate·risk-gate 실패와 뒤처짐을 보지 않는다', () => {
  const o = { stepCompleted: false, behind: true };
  assert.equal(classify({ 'plan-gate': 'failure', 'risk-gate': 'failure' }, o).kind, 'ready');
  assert.equal(classify({ 'plan-gate': 'failure', 'review-ledger': 'failure' }, o).kind, 'review');
  assert.equal(classify({ 'plan-gate': 'failure', 'review/codex': 'failure' }, o).kind, 'review');
  const e = classify({ 'plan-gate': 'failure', 'review/claude': 'error' }, o);
  assert.equal(e.kind, 'infra-error');
  assert.deepEqual(e.kind === 'infra-error' ? e.failing.map((f) => f.context) : [], [
    'review/claude',
  ]);
});

test('classifyPr 5: step이 끝나지 않은 PR에서도 deps-guard·harness-guard 실패는 fix다(plan-gate·risk-gate만 보지 않는다, PR #93 F2)', () => {
  const o = { stepCompleted: false };
  const v = classify(
    {
      'plan-gate': 'failure',
      'risk-gate': 'failure',
      'harness-guard': 'failure',
      'deps-guard': 'failure',
      'review/claude': 'failure',
    },
    o,
  );
  assert.equal(v.kind, 'fix');
  assert.deepEqual(v.kind === 'fix' ? v.failing.map((f) => f.context) : [], [
    'deps-guard',
    'harness-guard',
  ]);
  assert.equal(classify({ 'plan-gate': 'failure', 'deps-guard': 'failure' }, o).kind, 'fix');
});

test('classifyPr 6: plan-gate·deps-guard·harness-guard 실패는 설명을 담은 fix이고 review보다 앞선다', () => {
  const v = classify({
    'harness-guard': 'failure',
    'deps-guard': 'failure',
    'review/claude': 'failure',
  });
  assert.equal(v.kind, 'fix');
  assert.deepEqual(v.kind === 'fix' ? v.failing.map((f) => f.context) : [], [
    'deps-guard',
    'harness-guard',
  ]);
  assert.equal(classify({ 'plan-gate': 'failure' }).kind, 'fix');
});

test('classifyPr 7·8: review/*·review-ledger 실패는 review, error 상태는 infra-error', () => {
  assert.equal(classify({ 'review/claude': 'failure' }).kind, 'review');
  assert.equal(classify({ 'review-ledger': 'failure' }).kind, 'review');
  assert.equal(classify({ 'review-ledger': 'failure', 'review/codex': 'error' }).kind, 'review');
  assert.equal(classify({ 'review/codex': 'error' }).kind, 'infra-error');
  assert.equal(classify({ 'risk-gate': 'error' }).kind, 'infra-error');
});

test('classifyPr 9·10·11: 뒤처짐은 behind(risk-gate만 실패여도), risk-gate만 실패면 approval, 그 밖은 ready', () => {
  assert.equal(classify({}, { behind: true }).kind, 'behind');
  assert.equal(classify({ 'risk-gate': 'failure' }, { behind: true }).kind, 'behind');
  assert.equal(classify({ 'risk-gate': 'failure' }).kind, 'approval');
  assert.equal(classify().kind, 'ready');
  // 수정 요청 상태의 뒤처진 PR은 갱신하지 않는다(승인을 이어받지 못한다)
  assert.equal(classify({ 'review/claude': 'failure' }, { behind: true }).kind, 'review');
});

test('gatesMissing: 검증자의 판정이 모두 났는데 게이트 상태가 없으면 그 이름들을 설정 순서로 낸다(Issue #181)', () => {
  const missing = (over: Record<string, CommitCheck['state'] | null>) =>
    gatesMissing(requiredStates(green(over), CI));
  const noGates = {
    'plan-gate': null,
    'risk-gate': null,
    'deps-guard': null,
    'harness-guard': null,
  };
  assert.deepEqual(missing(noGates), ['plan-gate', 'risk-gate', 'deps-guard', 'harness-guard']);
  // 판정은 승인이든 수정 요청이든 난 것이다
  assert.deepEqual(
    missing({ 'risk-gate': null, 'review/claude': 'failure', 'review/codex': 'failure' }),
    ['risk-gate'],
  );
  assert.deepEqual(missing({ 'deps-guard': null, 'review/codex': 'failure' }), ['deps-guard']);
  // 판정이 아직 없거나 진행 중이거나 내지 못했으면(error) 게이트가 없어도 알리지 않는다: 아직 기다릴 때다
  for (const s of [null, 'pending', 'error'] as const) {
    assert.deepEqual(missing({ ...noGates, 'review/claude': s }), [], String(s));
    assert.deepEqual(missing({ ...noGates, 'review/codex': s }), [], String(s));
  }
  // 게이트가 기록돼 있으면 상태가 무엇이든 빈 배열이다
  assert.deepEqual(missing({}), []);
  assert.deepEqual(
    missing({ 'plan-gate': 'failure', 'risk-gate': 'pending', 'deps-guard': 'error' }),
    [],
  );
  // check(Actions)와 review-ledger는 게이트가 아니다
  assert.deepEqual(missing({ check: null, 'review-ledger': null }), []);
  // 필수 체크에 검증자 판정이 없는 리포에서는 알리지 않는다
  assert.deepEqual(
    gatesMissing(requiredStates([], { requiredChecks: REQUIRED.slice(0, 5), recorderBot: BOT })),
    [],
  );
  // revert-check도 게이트다(이 리포의 설정에는 있다)
  const withRevert = {
    requiredChecks: [{ context: 'revert-check', source: 'recorder' as const }, ...REQUIRED],
    recorderBot: BOT,
  };
  assert.deepEqual(gatesMissing(requiredStates(green(), withRevert)), ['revert-check']);
});

test('statusToCheck·checkRunToCheck: API 항목을 출처와 함께 옮기고, 모르는 상태는 통과로 보지 않는다', () => {
  const st = statusToCheck(['review/claude', 'success', '승인', BOT, 'https://x/runs/1', 't1']);
  assert.deepEqual(
    [st.kind, st.state, st.description, st.creator, st.appId, st.targetUrl, st.at],
    ['status', 'success', '승인', BOT, null, 'https://x/runs/1', 't1'],
  );
  assert.equal(statusToCheck(['x', 'weird', null, null, null, 't']).state, 'error');
  assert.equal(statusToCheck(['x', 'pending', null, null, null, 't']).creator, '');
  const cr = (status: string, conclusion: string | null) =>
    checkRunToCheck(['check', status, conclusion, 15368, 'u', 't2', null]).state;
  assert.equal(cr('in_progress', null), 'pending');
  assert.equal(cr('queued', null), 'pending');
  for (const c of ['success', 'neutral', 'skipped']) assert.equal(cr('completed', c), 'success');
  for (const c of ['failure', 'timed_out', 'cancelled', 'action_required', 'stale', null])
    assert.equal(cr('completed', c), 'failure', String(c));
  const run = checkRunToCheck(['check', 'completed', 'success', 15368, 'u', 't2', '제목']);
  assert.deepEqual(
    [run.kind, run.creator, run.appId, run.description],
    ['check-run', '', 15368, '제목'],
  );
  assert.equal(
    checkRunToCheck(['check', 'completed', 'success', null, null, null, null]).appId,
    null,
  );
});

test('newestFirst: 시각이 늦은 것이 앞이고, 같으면 받은 순서를 지킨다', () => {
  const a = status('a', 'success');
  const b = status('b', 'success');
  const same = { ...status('c', 'success'), at: b.at };
  assert.deepEqual(
    newestFirst([a, b, same]).map((c) => c.context),
    ['b', 'c', 'a'],
  );
});

test('isBehind: 원격 기준 브랜치가 HEAD의 조상이 아니면 true, 판단하지 못하면 false', () => {
  const fx = makeFixture();
  try {
    sh('git', ['checkout', '-q', '-b', 'topic'], fx.root);
    write(fx.root, 'a.txt', 'a\n');
    commitAll(fx.root, 'topic');
    assert.equal(isBehind(fx.root, 'origin', 'main'), false);
    sh('git', ['checkout', '-q', 'main'], fx.root);
    write(fx.root, 'b.txt', 'b\n');
    commitAll(fx.root, 'main moves');
    sh('git', ['push', '-q', 'origin', 'main'], fx.root);
    sh('git', ['checkout', '-q', 'topic'], fx.root);
    assert.equal(isBehind(fx.root, 'origin', 'main'), true);
    sh('git', ['merge', '-q', '--no-edit', 'origin/main'], fx.root);
    assert.equal(isBehind(fx.root, 'origin', 'main'), false);
    assert.equal(isBehind(fx.root, 'origin', 'no-such-branch'), false);
  } finally {
    fx.cleanup();
  }
});

/** 계획 worktree를 만들고 브랜치를 push한 뒤 가짜 PR을 연다 */
async function fixtureWithPR(config: Record<string, unknown> = {}) {
  const fx = makeFixture(config);
  const state = path.join(fx.dir, 'gh.json');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
  const t = await newTask(fx.root, {
    issue: 3,
    slug: 'demo',
    size: 'medium',
    owner: 'runner-1',
    github: false,
    date: '20261115',
  });
  write(t.worktree, 'note.txt', 'x\n');
  const head = commitAll(t.worktree, 'work');
  sh('git', ['push', '-q', 'origin', t.branch], t.worktree);
  const gh = new FakeGitHub(state);
  const pr = gh.createPR({ head: t.branch, base: 'main', title: 'demo', body: 'Refs #3' });
  return { fx, state, t, head, gh, pr };
}

test('가짜 GitHub: PR의 headSha는 원격 브랜치 끝이고, commitChecks는 그 커밋의 기록 전체를 최신순으로 준다', async () => {
  const { fx, t, head, gh, pr } = await fixtureWithPR();
  try {
    assert.equal(gh.findPRByBranch(t.branch)?.headSha, head);
    assert.equal(gh.findPRByBranch(t.branch)?.autoMerge, false);
    assert.deepEqual(gh.commitChecks(head), []);
    gh.setCheck(head, { context: 'review/claude', state: 'failure', creator: BOT });
    gh.setCheck(head, { context: 'review/claude', state: 'success', creator: 'harness-bot' });
    gh.setCheck(head, { context: 'check', kind: 'check-run', state: 'success', appId: 15368 });
    const list = gh.commitChecks(head);
    assert.deepEqual(
      list.map((c) => `${c.context}:${c.kind}:${c.state}:${c.creator}`),
      [
        'check:check-run:success:',
        'review/claude:status:success:harness-bot',
        `review/claude:status:failure:${BOT}`,
      ],
    );
    assert.deepEqual(gh.commitChecks('b'.repeat(40)), []);
    assert.equal(gh.getPR(pr.number)?.head, t.branch);
    assert.equal(gh.getPR(9999), null);
  } finally {
    fx.cleanup();
  }
});

const cli = (args: string[], cwd: string, state: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], {
    cwd,
    env: { ...process.env, HARNESS_FAKE_GH: state },
  });

test('pr-state 명령: 필수 체크를 출처와 함께 한 줄씩 내고 마지막 줄에 분류를 낸다(읽기만 한다)', async () => {
  const { fx, state, t, head, gh, pr } = await fixtureWithPR({
    ci: { requiredChecks: REQUIRED.slice(0, 3), recorderBot: BOT },
  });
  try {
    gh.setCheck(head, { context: 'check', kind: 'check-run', state: 'success', appId: 15368 });
    gh.setCheck(head, {
      context: 'plan-gate',
      state: 'success',
      creator: BOT,
      description: '통과',
    });
    gh.setCheck(head, { context: 'risk-gate', state: 'success', creator: 'harness-bot' });
    // 읽기만 한다: 가짜 GitHub의 상태 파일(댓글·라벨·체크)이 그대로다
    const before = readFileSync(state, 'utf8');
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`PR #${pr.number}.*${head.slice(0, 12)}`));
    assert.match(r.stdout, /check \[actions\]: success/);
    assert.match(r.stdout, /plan-gate \[recorder\]: success — 통과/);
    // 봇 계정이 쓴 risk-gate는 없는 것으로 본다
    assert.match(r.stdout, /risk-gate \[recorder\]: missing/);
    assert.match(r.stdout, /분류: wait-ci.*risk-gate/);
    assert.equal(readFileSync(state, 'utf8'), before);
    // 번호로 지정해도 같다
    const byNumber = cli(['pr-state', '--pr', String(pr.number)], fx.root, state);
    assert.equal(byNumber.code, 0, byNumber.stderr);
    assert.match(byNumber.stdout, /분류: wait-ci/);
    // 현재 브랜치에 PR이 없으면 종료 코드 1
    const none = cli(['pr-state'], fx.root, state);
    assert.equal(none.code, 1);
    assert.match(none.stderr + none.stdout, /PR이 없다/);
  } finally {
    fx.cleanup();
  }
});

test('gatesMissingLine: 안내의 명령에 넣는 브랜치 이름은 셸의 낱말 하나로 인용한다(F1)', (t) => {
  // git이 받는 브랜치 이름에는 셸의 특수 문자가 올 수 있다. 안내를 복사해 실행해도 이름의 일부가 명령으로 읽히면 안 된다
  const hostile = [
    'feat/x;touch${IFS}pwned',
    'feat/$(touch pwned)',
    'feat/`touch pwned`',
    "feat/a'b",
    "feat/a';touch pwned;'",
    'feat/a&&b|c>d<e',
    'feat/a"b\\c',
    'feat/#x!y*z',
  ];
  for (const branch of hostile) {
    const line = gatesMissingLine(['plan-gate', 'risk-gate'], branch);
    assert.match(line, /게이트 상태 없음/);
    assert.match(line, /plan-gate, risk-gate/);
    // 한 줄이다(브랜치 이름이 줄을 나누지 않는다)
    assert.ok(!line.includes('\n'), line);
    const m = /gh run list --workflow gates --branch ('.*') --limit 5/.exec(line);
    assert.ok(m, line);
    // 인용한 낱말은 작은따옴표 구간과 \'의 연속이다: 따옴표 밖에 다른 글자가 없다
    assert.match(m[1], /^(?:'[^']*'|\\')+$/, m[1]);
  }
  // 줄바꿈이 든 이름은 git이 받지 않지만, 받아도 줄을 나누지 않는다
  assert.ok(!gatesMissingLine(['plan-gate'], 'a\nb').includes('\n'));
  // 실제 셸이 그 낱말을 브랜치 이름 그대로 읽는다(POSIX 셸이 있을 때)
  const probe = runSync('sh', ['-c', 'exit 0']);
  if (process.platform === 'win32' || probe.code !== 0) {
    t.skip('sh가 없다');
    return;
  }
  const work = tmp('harness-pr-state-quote-');
  for (const branch of hostile) {
    const line = gatesMissingLine(['plan-gate'], branch);
    const quoted = /--branch ('.*') --limit 5/.exec(line)![1];
    const r = runSync('sh', ['-c', `printf '%s' ${quoted}`], { cwd: work });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, branch);
    assert.deepEqual(readdirSync(work), [], branch);
  }
});

test('pr-state 명령: 검증자의 판정이 났는데 게이트 상태가 없는 head에서 다시 돌리는 법을 한 줄로 알린다(Issue #181)', async () => {
  const { fx, state, t, head, gh } = await fixtureWithPR({
    ci: { requiredChecks: REQUIRED, recorderBot: BOT },
  });
  try {
    gh.setCheck(head, { context: 'check', kind: 'check-run', state: 'success', appId: 15368 });
    gh.setCheck(head, { context: 'review/claude', state: 'success', creator: BOT });
    const waiting = cli(['pr-state'], t.worktree, state);
    assert.equal(waiting.code, 0, waiting.stderr);
    // 판정 하나가 아직 없다: 게이트가 없어도 알리지 않는다
    assert.doesNotMatch(waiting.stdout, /게이트 상태 없음/);
    gh.setCheck(head, { context: 'review/codex', state: 'failure', creator: BOT });
    const before = readFileSync(state, 'utf8');
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    const line = r.stdout.split('\n').find((l) => l.includes('게이트 상태 없음'));
    assert.ok(line, r.stdout);
    assert.match(line, /plan-gate, risk-gate, deps-guard, harness-guard/);
    assert.match(line, /gh run list --workflow gates --branch \S+/);
    assert.ok(line.includes(`--branch '${t.branch}' `), line);
    assert.match(line, /gh run rerun <실행 번호>/);
    // 필수 체크 목록 뒤, 분류 줄 앞이다. 분류는 그대로 wait-ci다
    const lines = r.stdout.split('\n');
    const at = lines.indexOf(line);
    assert.ok(at > lines.findIndex((l) => l.startsWith('- review-ledger [recorder]')), r.stdout);
    assert.ok(at < lines.findIndex((l) => l.startsWith('분류: ')), r.stdout);
    assert.match(r.stdout, /분류: wait-ci/);
    assert.equal(readFileSync(state, 'utf8'), before);
    // 게이트가 기록되면 그 줄이 없다
    for (const context of ['plan-gate', 'risk-gate', 'deps-guard', 'harness-guard'])
      gh.setCheck(head, { context, state: 'success', creator: BOT });
    const ok = cli(['pr-state'], t.worktree, state);
    assert.equal(ok.code, 0, ok.stderr);
    assert.doesNotMatch(ok.stdout, /게이트 상태 없음/);
  } finally {
    fx.cleanup();
  }
});

test('pr-state 명령: ci.requiredChecks가 빈 리포에서는 그 사실을 알리고 종료 코드 0이다', async () => {
  const { fx, state, t } = await fixtureWithPR();
  try {
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /ci\.requiredChecks가 비어/);
  } finally {
    fx.cleanup();
  }
});

// 계획 20261116-ops-security step4
test('이 리포의 설정: revert-check가 필수 체크 목록에 나오고 검증 App이 쓴 결과만 인정한다', () => {
  const ci = loadConfig(HARNESS_ROOT).ci;
  const of = (checks: CommitCheck[]) =>
    requiredStates(checks, ci).find((r) => r.context === 'revert-check');
  assert.equal(of([])?.state, 'missing');
  assert.equal(of([])?.source, 'recorder');
  // 봇 계정이 쓴 같은 이름의 상태는 없는 것으로 본다
  assert.equal(of([status('revert-check', 'success', 'harness-bot')])?.state, 'missing');
  const mine = of([status('revert-check', 'success', ci.recorderBot ?? '', 'revert PR 아님')]);
  assert.equal(mine?.state, 'success');
  assert.equal(mine?.description, 'revert PR 아님');
});

// ---------- 오래 열린 지적 (9.1절, Issue #165) ----------

/** codex가 P1 하나를 등록하고 열어 둔 채 판정을 more번 더 낸 원장 */
function ledgerWithOpenP1(more: number): Ledger {
  const judge = (l: Ledger, head: string, first: boolean) =>
    applyVerdict(l, {
      reviewer: 'codex',
      verdict: {
        verdict: 'request_changes',
        risk: 'normal',
        summary: '요약',
        findings: first
          ? [
              {
                severity: 'P1',
                file: 'note.txt',
                line: 1,
                title: '검증자가 쓴 제목이다',
                evidence: '근거',
                suggestion: '제안',
                repro: { path: '', content: '' },
              },
            ]
          : [],
        resolutions: first ? [] : [{ id: 'F1', status: 'open', note: '' }],
      },
      headSha: head,
      changedSinceLastRound: first ? ['note.txt'] : [],
    });
  let l = judge(emptyLedger('a'.repeat(40)), '0'.repeat(40), true);
  for (let i = 0; i < more; i++) l = judge(l, String(i + 1).repeat(40), false);
  return l;
}

const CHECKS = { ci: { requiredChecks: REQUIRED.slice(0, 1), recorderBot: BOT } };
const LONG = /^- 오래 열린 지적: F1 \[P1, codex\] 재판정 3회 뒤에도 열려 있다/m;

test('pr-state 명령: 재판정 3회 뒤에도 열린 차단 지적을 분류 줄 앞에 한 줄로 낸다(읽기만 한다)', async () => {
  const { fx, state, t, gh, pr } = await fixtureWithPR(CHECKS);
  try {
    gh.commentAs(pr.number, BOT, renderLedger(ledgerWithOpenP1(3)));
    const before = readFileSync(state, 'utf8');
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, LONG);
    assert.match(r.stdout, /제작자에게 묻는다\(절차서 8절\)/);
    const lines = r.stdout.trimEnd().split('\n');
    assert.match(lines.at(-1)!, /^분류: /);
    assert.ok(lines.findIndex((x) => LONG.test(x)) < lines.length - 1);
    assert.ok(!r.stdout.includes('검증자가 쓴 제목이다'), r.stdout);
    assert.equal(readFileSync(state, 'utf8'), before);
  } finally {
    fx.cleanup();
  }
});

test('pr-state 명령: 재판정이 2회뿐이거나 원장 댓글의 작성자가 검증 App이 아니면 오래 열린 지적 줄이 없다', async () => {
  const { fx, state, t, gh, pr } = await fixtureWithPR(CHECKS);
  try {
    gh.commentAs(pr.number, BOT, renderLedger(ledgerWithOpenP1(2)));
    gh.commentAs(pr.number, 'harness-bot', renderLedger(ledgerWithOpenP1(3)));
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!r.stdout.includes('오래 열린 지적'), r.stdout);
    assert.match(r.stdout, /^분류: /m);
  } finally {
    fx.cleanup();
  }
});

test('pr-state 명령: 원장이 깨졌으면 그 사실을 한 줄로 알리고 분류는 그대로 낸다', async () => {
  const { fx, state, t, gh, pr } = await fixtureWithPR(CHECKS);
  try {
    gh.commentAs(pr.number, BOT, '<!-- harness-ledger:v1 -->\n깨진 본문');
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^- 오래 열린 지적 확인: 원장을 읽지 못했다/m);
    assert.match(r.stdout.trimEnd().split('\n').at(-1)!, /^분류: /);
  } finally {
    fx.cleanup();
  }
});

test('pr-state 명령: ci.recorderBot이 비어 있으면 원장을 읽지 않는다', async () => {
  const { fx, state, t, gh, pr } = await fixtureWithPR({
    ci: {
      requiredChecks: REQUIRED.filter((r) => r.source === 'actions').slice(0, 1),
      recorderBot: '',
    },
  });
  try {
    gh.commentAs(pr.number, BOT, renderLedger(ledgerWithOpenP1(3)));
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.ok(!r.stdout.includes('오래 열린 지적'), r.stdout);
    assert.match(r.stdout, /^분류: /m);
  } finally {
    fx.cleanup();
  }
});

test('pr-state 명령: ci.requiredChecks가 빈 리포에서도 오래 열린 지적을 체크 요약 줄 뒤에 낸다', async () => {
  const { fx, state, t, gh, pr } = await fixtureWithPR({
    ci: { requiredChecks: [], recorderBot: BOT },
  });
  try {
    gh.commentAs(pr.number, BOT, renderLedger(ledgerWithOpenP1(3)));
    const r = cli(['pr-state'], t.worktree, state);
    assert.equal(r.code, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    const summary = lines.findIndex((x) => x.includes('ci.requiredChecks가 비어'));
    const long = lines.findIndex((x) => LONG.test(x));
    assert.ok(summary >= 0 && long > summary, r.stdout);
    assert.ok(!r.stdout.includes('분류:'), r.stdout);
  } finally {
    fx.cleanup();
  }
});
