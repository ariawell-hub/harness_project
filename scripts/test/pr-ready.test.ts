// pr-ready: 승인 요청 전 조건 확인 → 초안 해제 → 승인 요청 표시 (Issue #78 step2)
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { prReady } from '../commands/pr-ready.ts';
import { TaskError, completeStep, newTask } from '../commands/task.ts';
import { approvalMarkerFile, readApprovalMarker } from '../lib/approval.ts';
import { repoInfo } from '../lib/git.ts';
import { FakeGitHub, initFakeState } from '../lib/github-fake.ts';
import { advanceRemote, commitAll, makeFixture, sh, write, type Fixture } from './helpers.ts';

const ID = '20261115-ready';

/** step 2개짜리 계획의 step0 worktree. 코드 커밋까지 하고 push·PR은 호출자가 한다 */
async function setup(fx: Fixture): Promise<{ wt: string; branch: string; gh: FakeGitHub }> {
  const r = await newTask(fx.root, { issue: 5, slug: 'ready', github: false, date: '20261115' });
  const dir = path.join(r.worktree, `docs/exec-plans/active/${ID}`);
  writeFileSync(
    path.join(dir, 'index.json'),
    JSON.stringify({
      plan: ID,
      steps: [
        { step: 0, name: 'a', status: 'in_progress' },
        { step: 1, name: 'b', status: 'pending' },
      ],
    }),
  );
  write(r.worktree, 'src/x.ts', 'export const x = 1;\n');
  commitAll(r.worktree, 'work');
  const state = path.join(fx.dir, 'gh.json');
  initFakeState(state, { remote: fx.remote, owner: 'maker', mergeMode: 'manual' });
  return { wt: r.worktree, branch: r.branch, gh: new FakeGitHub(state) };
}

const push = (wt: string, branch: string) => sh('git', ['push', '-q', '-u', 'origin', branch], wt);
const draftPr = (gh: FakeGitHub, branch: string) =>
  gh.createPR({ head: branch, base: 'main', title: 't', body: 'b', draft: true });

test('pr-ready: 조건이 모두 맞으면 초안을 해제하고 승인 요청 표시를 남긴다', async () => {
  const fx = makeFixture();
  try {
    const { wt, branch, gh } = await setup(fx);
    completeStep(wt);
    push(wt, branch);
    const pr = draftPr(gh, branch);
    const r = prReady(wt, { github: gh });
    assert.equal(r.pr, pr.number);
    assert.equal(gh.findPRByBranch(branch)!.isDraft, false);
    const head = sh('git', ['rev-parse', 'HEAD'], wt);
    assert.equal(readApprovalMarker(repoInfo(wt)), head);
    // 표시는 git이 추적하지 않는 worktree별 상태 폴더에 있다
    assert.equal(sh('git', ['status', '--porcelain'], wt), '');
    // 되돌리기: 초안으로 돌리고 표시를 지운다. 두 번 해도 실패하지 않는다
    prReady(wt, { github: gh, undo: true });
    assert.equal(gh.findPRByBranch(branch)!.isDraft, true);
    assert.equal(existsSync(approvalMarkerFile(repoInfo(wt))), false);
    prReady(wt, { github: gh, undo: true });
  } finally {
    fx.cleanup();
  }
});

test('pr-ready: 조건이 안 되면 이유를 모두 알리고 GitHub은 건드리지 않는다', async () => {
  const fx = makeFixture();
  try {
    const { wt, branch, gh } = await setup(fx);
    push(wt, branch);
    draftPr(gh, branch);
    const fails = (re: RegExp) => {
      assert.throws(
        () => prReady(wt, { github: gh }),
        (e: unknown) => e instanceof TaskError && re.test(e.message),
      );
      assert.equal(gh.findPRByBranch(branch)!.isDraft, true);
      assert.equal(existsSync(approvalMarkerFile(repoInfo(wt))), false);
    };
    // 완료 처리 전
    fails(/complete-step/);
    completeStep(wt);
    // 완료 커밋을 push하지 않았다
    fails(/push/);
    push(wt, branch);
    // 커밋하지 않은 변경
    write(wt, 'src/y.ts', 'export const y = 2;\n');
    fails(/커밋하지 않은/);
    commitAll(wt, 'more');
    push(wt, branch);
    // main이 앞서갔다
    advanceRemote(fx, 'other.txt', 'x\n');
    fails(/origin\/main/);
    sh('git', ['merge', '-q', 'origin/main', '-m', 'merge main'], wt);
    push(wt, branch);
    prReady(wt, { github: gh });
    assert.equal(gh.findPRByBranch(branch)!.isDraft, false);
  } finally {
    fx.cleanup();
  }
});

test('pr-ready: PR이 없거나 main 체크아웃이면 거부한다', async () => {
  const fx = makeFixture();
  try {
    const { wt, branch, gh } = await setup(fx);
    completeStep(wt);
    push(wt, branch);
    assert.throws(() => prReady(wt, { github: gh }), /PR/);
    assert.throws(() => prReady(fx.root, { github: gh }), /worktree|계획 브랜치/);
    assert.equal(readFileSync(path.join(fx.dir, 'gh.json'), 'utf8').includes('"prs": []'), true);
  } finally {
    fx.cleanup();
  }
});
