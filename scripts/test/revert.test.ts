// revert 워크플로(10.3절 "병합 후 main CI가 실패하면"): 결정(decideRevert), 조회(planRevert), 실행(actRevert).
// 계획 20261116-ops-security step1. 임시 git 리포 + 로컬 bare 원격 + 가짜 GitHub.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  RevertError,
  actRevert,
  decideRevert,
  irreversible,
  parseRevertAction,
  planRevert,
  runOf,
  sourcePrOf,
  type RevertAction,
  type RevertRun,
  type RevertSource,
} from '../ci/revert.ts';
import { revertCheck } from '../gates/revert-check.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { FakeGitHub, addFakeIssue, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { findRevertMarker } from '../lib/revert-marker.ts';
import {
  HARNESS_ROOT,
  advanceRemote,
  commitAll,
  fixtureConfig,
  makeFixture,
  sh,
  write,
  type Fixture,
} from './helpers.ts';

const SHA = 'a1'.repeat(20);
const RUN: RevertRun = {
  id: 77,
  headSha: SHA,
  attempt: 2,
  conclusion: 'failure',
  event: 'push',
  branch: 'main',
};
const SOURCE: RevertSource = {
  number: 12,
  headRef: 'feat/20261116-demo-s1',
  title: 'feat(20261116-demo): step1 part',
  body: 'Refs #5\n\n본문',
};
const decide = (over: Partial<Parameters<typeof decideRevert>[0]> = {}) =>
  decideRevert({
    run: RUN,
    defaultBranch: 'main',
    onMain: true,
    source: SOURCE,
    exists: false,
    irreversible: false,
    ...over,
  });

test('decideRevert: 갈래마다 정해진 순서로 고른다', () => {
  // main의 push 실행이 실패로 끝난 경우만 본다
  assert.equal(decide({ run: { ...RUN, event: 'pull_request' } }).action, 'skip');
  assert.equal(decide({ run: { ...RUN, branch: 'feat/x' } }).action, 'skip');
  for (const conclusion of ['success', 'cancelled', 'skipped', ''])
    assert.equal(decide({ run: { ...RUN, conclusion } }).action, 'skip', conclusion);
  assert.equal(decide({ run: { ...RUN, conclusion: 'timed_out' } }).action, 'revert');
  assert.equal(decide({ onMain: false }).action, 'skip');
  assert.equal(decide({ run: { ...RUN, headSha: 'HEAD' } }).action, 'skip');
  // 첫 실패는 다시 실행한다. 이미 있는 revert·원래 PR 없음보다 앞이다
  assert.deepEqual(decide({ run: { ...RUN, attempt: 1 }, exists: true, source: null }), {
    action: 'rerun',
    runId: 77,
  });
  // 두 번째 실패: 이미 있으면 아무것도 하지 않는다(에스컬레이션보다 앞)
  assert.equal(decide({ exists: true, source: null, irreversible: true }).action, 'skip');
  assert.deepEqual(decide({ source: null }), {
    action: 'escalate',
    reason: '대상 커밋을 병합한 PR을 찾지 못했다',
    issue: null,
    pr: null,
    target: SHA,
  });
  // revert의 revert는 자동으로 하지 않는다
  const again = decide({ source: { ...SOURCE, headRef: `revert/${'b2'.repeat(20)}` } });
  assert.equal(again.action, 'escalate');
  assert.match(again.action === 'escalate' ? again.reason : '', /revert PR의 병합 커밋/);
  const irr = decide({ irreversible: true });
  assert.deepEqual(
    { ...irr, reason: '' },
    { action: 'escalate', reason: '', issue: 5, pr: 12, target: SHA },
  );
  assert.deepEqual(decide(), {
    action: 'revert',
    target: SHA,
    pr: 12,
    issue: 5,
    closes: false,
    title: 'feat(20261116-demo): step1 part',
  });
});

test('decideRevert: 원래 Issue는 PR 본문 첫 줄의 Closes·Refs에서만 읽는다', () => {
  const of = (body: string) => {
    const a = decide({ source: { ...SOURCE, body } });
    assert.equal(a.action, 'revert');
    return a.action === 'revert' ? [a.issue, a.closes] : [];
  };
  assert.deepEqual(of('Closes #9\n\n본문'), [9, true]);
  assert.deepEqual(of('closes #9'), [9, true]);
  assert.deepEqual(of('Refs #31 뒤 설명'), [31, false]);
  assert.deepEqual(of('본문\nCloses #9'), [null, false]);
  assert.deepEqual(of('Refs #0'), [null, false]);
  assert.deepEqual(of('Refs #x'), [null, false]);
  assert.deepEqual(of(''), [null, false]);
  // 제목은 한 줄로 만든다
  const a = decide({ source: { ...SOURCE, title: ' 여러\n줄 \t제목 ' } });
  assert.equal(a.action === 'revert' ? a.title : '', '여러 줄 제목');
});

test('parseRevertAction: 형식이 맞는 것만 받는다', () => {
  const ok: RevertAction[] = [
    { action: 'skip', reason: 'x' },
    { action: 'rerun', runId: 3 },
    { action: 'escalate', reason: 'x', issue: null, pr: 4, target: SHA },
    { action: 'revert', target: SHA, pr: 4, issue: 5, closes: true, title: 't' },
  ];
  for (const a of ok) assert.deepEqual(parseRevertAction(JSON.parse(JSON.stringify(a))), a);
  for (const bad of [
    null,
    {},
    { action: 'push' },
    { action: 'rerun', runId: '3' },
    { action: 'rerun', runId: 0 },
    { action: 'revert', target: 'main', pr: 4, issue: 5, closes: true, title: 't' },
    { action: 'revert', target: SHA, pr: -1, issue: 5, closes: true, title: 't' },
    { action: 'revert', target: SHA, pr: 4, issue: 5, closes: 'yes', title: 't' },
    { action: 'revert', target: SHA, pr: 4, issue: 5, closes: true, title: 'a\nb' },
    { action: 'escalate', reason: 'x', issue: null, pr: 4, target: 'HEAD' },
  ])
    assert.throws(() => parseRevertAction(bad), RevertError, JSON.stringify(bad));
});

test('runOf·sourcePrOf: 이벤트와 API 응답에서 필요한 값만 읽는다', async () => {
  assert.deepEqual(
    runOf({
      workflow_run: {
        id: 77,
        head_sha: SHA,
        run_attempt: 2,
        conclusion: 'failure',
        event: 'push',
        head_branch: 'main',
      },
    }),
    RUN,
  );
  assert.equal(runOf({}), null);
  assert.equal(
    runOf({ workflow_run: { id: 'x', head_sha: SHA, run_attempt: 1, event: 'push' } }),
    null,
  );

  const pr = (over: Record<string, unknown> = {}) => ({
    number: 12,
    title: 't',
    body: 'Refs #5',
    merged_at: '2026-11-16T00:00:00Z',
    merge_commit_sha: SHA,
    head: { ref: 'feat/20261116-demo-s1' },
    base: { ref: 'main' },
    ...over,
  });
  const asked: string[] = [];
  const api = (list: unknown) => async (p: string) => {
    asked.push(p);
    return list;
  };
  assert.deepEqual(await sourcePrOf(api([pr()]), 'o/r', SHA, 'main'), {
    number: 12,
    headRef: 'feat/20261116-demo-s1',
    title: 't',
    body: 'Refs #5',
  });
  assert.equal(asked[0], `repos/o/r/commits/${SHA}/pulls?per_page=100`);
  // 병합되지 않은 PR, 다른 커밋으로 병합된 PR, 다른 base의 PR은 원래 PR이 아니다
  for (const other of [
    pr({ merged_at: null }),
    pr({ merge_commit_sha: 'b2'.repeat(20) }),
    pr({ base: { ref: 'release' } }),
  ])
    assert.equal(await sourcePrOf(api([other]), 'o/r', SHA, 'main'), null);
  assert.equal(await sourcePrOf(api([]), 'o/r', SHA, 'main'), null);
  await assert.rejects(sourcePrOf(api({ message: 'x' }), 'o/r', SHA, 'main'), RevertError);
});

// ---------- 실제 git + 가짜 GitHub ----------

const PLAN_ID = '20261116-demo';
const PLAN = (risk: string) =>
  `---\nid: ${PLAN_ID}\nissue: 1\ntype: feat\nstatus: active\nsize: medium\nrisk: ${risk}\n---\n\n# 데모\n`;

interface Setup {
  fx: Fixture;
  gh: FakeGitHub;
  state: () => FakeState;
  issue: number;
  /** 원래 PR 번호 */
  pr: number;
  /** main에 병합된 대상 커밋 */
  target: string;
  runUrl: string;
}

/**
 * main에 "원래 PR의 병합 커밋"을 만든다: 계획 파일(첫 step이면 새로 생김)과 코드 파일.
 * 가짜 GitHub에는 Issue와 병합된 원래 PR을 둔다
 */
function setup(o: { risk?: string; files?: Record<string, string>; step?: number } = {}): Setup {
  const fx = makeFixture({
    riskPaths: [{ glob: 'db/migrations/**', risk: 'high' }],
    github: { ...(fixtureConfig().github as object), bot: 'harness-bot' },
  });
  const stateFile = path.join(fx.dir, 'gh.json');
  initFakeState(stateFile, { remote: fx.remote, owner: 'maker', repo: 'o/r', mergeMode: 'manual' });
  const issue = addFakeIssue(stateFile, '데모 기능', '본문');
  const step = o.step ?? 0;
  const headRef = `feat/${PLAN_ID}-s${step}`;
  if (step > 0) {
    // 앞 step은 이미 main에 있다(계획 포함)
    advanceRemote(fx, `docs/exec-plans/active/${PLAN_ID}/plan.md`, PLAN(o.risk ?? 'normal'));
  }
  // 대상 커밋: bare 원격의 main에 한 커밋으로 올린다(squash 병합 흉내)
  const clone = path.join(fx.dir, 'merge-clone');
  sh('git', ['clone', '-q', fx.remote, clone], fx.dir);
  for (const k of ['user.email=t@example.invalid', 'user.name=t', 'commit.gpgsign=false'])
    sh('git', ['config', ...k.split('=')], clone);
  if (step === 0)
    write(clone, `docs/exec-plans/active/${PLAN_ID}/plan.md`, PLAN(o.risk ?? 'normal'));
  for (const [f, c] of Object.entries(o.files ?? { 'src/demo.ts': 'export const demo = 1;\n' }))
    write(clone, f, c);
  const target = commitAll(clone, `feat(${PLAN_ID}): step${step} (#2)`);
  sh('git', ['push', '-q', 'origin', 'main'], clone);
  sh('git', ['fetch', '-q', 'origin'], fx.root);

  const gh = new FakeGitHub(stateFile);
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8')) as FakeState;
  // 병합된 원래 PR(가짜 상태에 직접 적는다: 브랜치는 병합 뒤 지워졌다)
  const s = state();
  const pr = s.next++;
  s.prs.push({
    number: pr,
    title: `feat(${PLAN_ID}): step${step} @maker 확인`,
    body: `Closes #${issue}`,
    head: headRef,
    base: 'main',
    state: 'merged',
    isDraft: false,
    labels: [],
    url: `fake://pr/${pr}`,
    mergeState: 'CLEAN',
    checks: 'success',
    failingChecks: [],
    autoMerge: true,
  });
  s.issues.find((i) => i.number === issue)!.state = 'closed';
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
  return { fx, gh, state, issue, pr, target, runUrl: 'https://github.com/o/r/actions/runs/77' };
}

const act = (t: Setup, a: RevertAction) =>
  actRevert({ root: t.fx.root, gh: t.gh, cfg: loadConfig(t.fx.root), runUrl: t.runUrl }, a);
const revertOf = (t: Setup, over: Partial<Extract<RevertAction, { action: 'revert' }>> = {}) =>
  ({
    action: 'revert',
    target: t.target,
    pr: t.pr,
    issue: t.issue,
    closes: true,
    title: `feat(${PLAN_ID}): step0 @maker 확인`,
    ...over,
  }) satisfies RevertAction;
const remoteHeads = (t: Setup) =>
  sh('git', ['ls-remote', '--heads', 'origin'], t.fx.root)
    .split('\n')
    .map((l) => l.split('\t')[1])
    .filter(Boolean);

test('actRevert: revert PR은 대상의 정확한 역적용이고, 자동 병합·Issue 재오픈·표식 댓글이 붙는다', () => {
  const t = setup();
  try {
    const mainBefore = sh('git', ['rev-parse', 'HEAD'], t.fx.root);
    const r = act(t, revertOf(t));
    assert.match(r.done, /revert PR #\d+을 만들고 자동 병합을 켰다/);
    const branch = `revert/${t.target}`;
    assert.ok(remoteHeads(t).includes(`refs/heads/${branch}`));
    // main 체크아웃과 원격 main은 그대로다(R2): 되돌리기는 PR로만 한다
    assert.equal(sh('git', ['rev-parse', 'HEAD'], t.fx.root), mainBefore);
    assert.equal(sh('git', ['status', '--porcelain'], t.fx.root), '');
    assert.equal(
      sh('git', ['ls-remote', 'origin', 'refs/heads/main'], t.fx.root).split('\t')[0],
      t.target,
    );
    assert.equal(
      sh('git', ['worktree', 'list'], t.fx.root).split('\n').length,
      1,
      '임시 worktree를 정리했다',
    );

    // revert-check의 조건 (b): PR 브랜치를 체크아웃한 곳에서 정확한 역적용으로 확인된다
    const co = path.join(t.fx.dir, 'pr-checkout');
    sh('git', ['clone', '-q', '--branch', branch, t.fx.remote, co], t.fx.dir);
    const base = sh('git', ['merge-base', 'origin/main', 'HEAD'], co);
    const check = revertCheck({ root: co, base, branch, targetCheck: 'failure' });
    assert.deepEqual(
      [check.applies, check.verified, check.state],
      [true, true, 'success'],
      check.details.join('\n'),
    );
    assert.equal(
      sh('git', ['log', '-1', '--format=%an <%ae>', 'HEAD'], co),
      'harness-bot <harness-bot@users.noreply.github.com>',
    );

    const s = t.state();
    const pr = s.prs.find((p) => p.head === branch)!;
    assert.equal(pr.title, `revert: feat(${PLAN_ID}): step0 @maker 확인`);
    assert.equal(pr.body.split('\n')[0], `Refs #${t.issue}`);
    assert.match(pr.body, new RegExp(`대상 커밋: \`${t.target}\``));
    assert.match(pr.body, new RegExp(`원래 PR: #${t.pr}\\b`));
    assert.match(pr.body, /actions\/runs\/77/);
    assert.doesNotMatch(pr.body, /보호 경로 변경/, '작성자 확인 표시를 기계로 넣지 않는다');
    assert.equal(pr.autoMerge, true);
    assert.equal(pr.base, 'main');
    const issue = s.issues.find((i) => i.number === t.issue)!;
    assert.equal(issue.state, 'open', 'Closes였던 Issue를 다시 연다');
    assert.equal(issue.comments.length, 1);
    const body = issue.comments[0].body;
    assert.deepEqual(findRevertMarker(t.gh.comments(t.issue), 'harness-bot'), {
      target: t.target,
      planId: PLAN_ID,
    });
    // 첫 step이 되돌려지면 계획이 main에서 빠진다: 계획 복원 명령을 안내한다
    assert.match(body, new RegExp(`new-task --issue ${t.issue}\``));
    assert.match(body, new RegExp(`revert PR: #${pr.number}\\b`));
    // PR 제목의 멘션·마크다운은 해석되지 않게 넣는다
    assert.doesNotMatch(body, /@maker/);

    // 같은 대상을 다시 처리해도 PR·댓글이 하나다
    const again = act(t, revertOf(t));
    assert.match(again.done, /이미 있다/);
    const s2 = t.state();
    assert.equal(s2.prs.filter((p) => p.head === branch).length, 1);
    assert.equal(s2.issues.find((i) => i.number === t.issue)!.comments.length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('actRevert: 뒤 step이 되돌려지면 --plan --step 명령을 안내하고, Refs면 Issue를 다시 열지 않는다', () => {
  const t = setup({ step: 1 });
  try {
    act(t, revertOf(t, { closes: false, title: 'step1' }));
    const issue = t.state().issues.find((i) => i.number === t.issue)!;
    assert.equal(issue.state, 'closed', 'Refs였으면 상태를 바꾸지 않는다');
    assert.match(issue.comments[0].body, new RegExp(`new-task --plan ${PLAN_ID} --step 1\``));
    assert.ok(findRevertMarker(t.gh.comments(t.issue), 'harness-bot'));
  } finally {
    t.fx.cleanup();
  }
});

test('actRevert: 충돌하면 브랜치를 올리지 않고 needs-human으로 넘긴다(같은 대상은 한 번만 알린다)', () => {
  const t = setup();
  try {
    // 대상 뒤에 main이 같은 파일을 다시 바꿨다
    advanceRemote(t.fx, 'src/demo.ts', 'export const demo = 2;\n');
    const r = act(t, revertOf(t));
    assert.match(r.done, /에스컬레이션/);
    assert.ok(
      !remoteHeads(t).some((h) => h.startsWith('refs/heads/revert/')),
      '원격에 revert 브랜치가 없다',
    );
    const s = t.state();
    assert.equal(s.prs.filter((p) => p.head.startsWith('revert/')).length, 0);
    const issue = s.issues.find((i) => i.number === t.issue)!;
    assert.deepEqual(issue.labels, ['needs-human']);
    assert.equal(issue.comments.length, 1);
    assert.match(issue.comments[0].body, /^@maker /);
    assert.match(issue.comments[0].body, /git revert가 충돌했다/);
    assert.equal(issue.state, 'closed', '되돌리지 않았으면 Issue를 다시 열지 않는다');
    assert.equal(sh('git', ['worktree', 'list'], t.fx.root).split('\n').length, 1);
    act(t, revertOf(t));
    assert.equal(t.state().issues.find((i) => i.number === t.issue)!.comments.length, 1);
  } finally {
    t.fx.cleanup();
  }
});

test('actRevert: rerun은 실패한 job 재실행만, escalate는 Issue(없으면 원래 PR)에 알린다. 대상이 main에 없으면 거부한다', () => {
  const t = setup();
  try {
    assert.match(act(t, { action: 'rerun', runId: 77 }).done, /다시 실행/);
    assert.deepEqual(t.state().reruns, [77]);
    assert.match(act(t, { action: 'skip', reason: '이미 있다' }).done, /아무것도 하지 않는다/);
    assert.equal(t.state().prs.length, 1);

    act(t, { action: 'escalate', reason: 'a | b @x', issue: null, pr: t.pr, target: t.target });
    const onPr = t.state().issues.find((i) => i.number === t.pr);
    assert.equal(onPr?.comments.length, 1, 'Issue가 없으면 원래 PR에 단다');
    assert.doesNotMatch(onPr!.comments[0].body, /@x/);
    assert.throws(
      () => act(t, { action: 'escalate', reason: 'x', issue: null, pr: null, target: t.target }),
      RevertError,
      '알릴 곳이 없으면 실행을 실패로 끝낸다',
    );
    assert.throws(() => act(t, revertOf(t, { target: SHA })), /first-parent 이력에 없다/);
    assert.equal(remoteHeads(t).filter((h) => h.includes('revert/')).length, 0);
  } finally {
    t.fx.cleanup();
  }
});

test('irreversible: 계획 risk: high이거나 높음 경로를 바꿨으면 참이다', () => {
  const normal = setup();
  const high = setup({ risk: 'high' });
  const migration = setup({ files: { 'db/migrations/001.sql': 'create table t(id int);\n' } });
  try {
    const of = (t: Setup, headRef = `feat/${PLAN_ID}-s0`) =>
      irreversible(t.fx.root, loadConfig(t.fx.root), t.target, headRef);
    assert.equal(of(normal), false);
    assert.equal(of(high), true);
    // 브랜치 이름으로 계획을 찾지 못하면 계획 위험도는 보지 않는다(경로만 본다)
    assert.equal(of(high, 'hotfix'), false);
    assert.equal(of(migration), true);
    assert.equal(of(migration, 'hotfix'), true);
    // 바꾼 파일을 읽지 못하면 자동으로 되돌리지 않는 쪽이다
    assert.equal(irreversible(normal.fx.root, loadConfig(normal.fx.root), SHA, 'hotfix'), true);
  } finally {
    for (const t of [normal, high, migration]) t.fx.cleanup();
  }
});

test('planRevert: 이벤트와 조회 결과로 재실행 → revert → 이미 있음을 고른다', async () => {
  const t = setup();
  try {
    const cfg = loadConfig(t.fx.root);
    const event = (attempt: number, sha = t.target) => ({
      workflow_run: {
        id: 77,
        head_sha: sha,
        run_attempt: attempt,
        conclusion: 'failure',
        event: 'push',
        head_branch: 'main',
      },
    });
    const asked: string[] = [];
    const source = {
      number: t.pr,
      title: '제목',
      body: `Closes #${t.issue}`,
      merged_at: '2026-11-16T00:00:00Z',
      merge_commit_sha: t.target,
      head: { ref: `feat/${PLAN_ID}-s0` },
      base: { ref: 'main' },
    };
    const api = (existing: unknown[]) => async (p: string) => {
      asked.push(p);
      return p.includes('/pulls?head=') ? existing : [source];
    };
    const plan = (ev: unknown, existing: unknown[] = []) =>
      planRevert({ root: t.fx.root, cfg, repo: 'o/r', api: api(existing), event: ev });

    // 첫 실패: 조회 없이 재실행
    assert.deepEqual(await plan(event(1)), { action: 'rerun', runId: 77 });
    assert.deepEqual(asked, []);
    assert.deepEqual(await plan(event(2)), {
      action: 'revert',
      target: t.target,
      pr: t.pr,
      issue: t.issue,
      closes: true,
      title: '제목',
    });
    assert.deepEqual(asked, [
      `repos/o/r/pulls?head=o:revert/${t.target}&state=all&per_page=1`,
      `repos/o/r/commits/${t.target}/pulls?per_page=100`,
    ]);
    assert.equal((await plan(event(2), [{ number: 9 }])).action, 'skip');
    // main 이력에 없는 커밋, 형식이 다른 이벤트
    assert.equal((await plan(event(2, SHA))).action, 'skip');
    assert.equal((await plan({})).action, 'skip');
    // revert 브랜치가 원격에 이미 있으면(PR은 아직 없어도) 아무것도 하지 않는다
    act(t, revertOf(t));
    sh('git', ['fetch', '-q', 'origin'], t.fx.root);
    assert.equal((await plan(event(2))).action, 'skip');
  } finally {
    t.fx.cleanup();
  }
});

test('revert-act CLI: 받은 자료와 실행 URL을 다시 검사한다', () => {
  const t = setup();
  try {
    const cli = (action: unknown, runUrl = t.runUrl) =>
      runSync(
        process.execPath,
        [
          path.join(t.fx.root, 'scripts/harness.ts'),
          'revert-act',
          '--data',
          Buffer.from(JSON.stringify(action)).toString('base64'),
          '--run-url',
          runUrl,
        ],
        {
          cwd: t.fx.root,
          env: { ...process.env, HARNESS_FAKE_GH: path.join(t.fx.dir, 'gh.json') },
        },
      );
    const bad = cli({
      action: 'revert',
      target: 'main',
      pr: 1,
      issue: 1,
      closes: true,
      title: 't',
    });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /형식이 다르다/);
    const url = cli({ action: 'rerun', runId: 77 }, 'https://example.com/o/r/actions/runs/77');
    assert.equal(url.code, 1);
    assert.match(url.stderr, /실행 URL이 아니다/);
    assert.equal(t.state().reruns, undefined);
    const ok = cli({ action: 'rerun', runId: 77 });
    assert.equal(ok.code, 0, ok.stderr);
    assert.deepEqual(t.state().reruns, [77]);
  } finally {
    t.fx.cleanup();
  }
});

test('revert.yml: 비밀은 act job에만 있고, 쓰기 권한·캐시가 없다', () => {
  const text = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/revert.yml'), 'utf8');
  const [, plan, actJob] = /\n {2}plan:\n([\s\S]*?)\n {2}act:\n([\s\S]*)$/.exec(text) ?? [];
  assert.ok(plan && actJob, 'plan·act job이 있다');
  assert.doesNotMatch(plan, /environment:|secrets\./, 'plan job에는 environment·비밀이 없다');
  assert.match(actJob, /^ {4}environment: revert$/m);
  assert.match(actJob, /secrets\.REVERT_BOT_TOKEN/);
  assert.match(actJob, /needs: plan/);
  assert.match(text, /^permissions: \{\}$/m);
  assert.doesNotMatch(text, /:\s*write(-all)?\s*$/m);
  assert.doesNotMatch(text, /actions\/cache|^\s*cache:/m);
  assert.match(text, /cancel-in-progress: false/);
  // 액션은 gates.yml과 같은 커밋 SHA로 고정한다
  const pins = (s: string) => [...s.matchAll(/uses: (\S+@[0-9a-f]{40})/g)].map((m) => m[1]);
  const gates = pins(readFileSync(path.join(HARNESS_ROOT, '.github/workflows/gates.yml'), 'utf8'));
  const mine = [...text.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(mine.length >= 4);
  for (const u of mine) assert.ok(gates.includes(u), `${u}는 gates.yml의 고정 SHA와 같아야 한다`);
  // 이벤트 유래 값을 run 스크립트에 직접 넣지 않는다
  for (const m of text.matchAll(/run: \|?([\s\S]*?)(?=\n {6}- |\n {2}\w|$)/g))
    assert.doesNotMatch(m[1], /\$\{\{/, 'run 스크립트에 식을 직접 넣지 않는다');
});
