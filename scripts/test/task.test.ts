import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as prettier from 'prettier';
import { planHash, planHashAt } from '../ci/plan-hash.ts';
import {
  ClaimError,
  appendProgress,
  claimHeartbeat,
  claimOwner,
  completeStep,
  findRestore,
  linkFile,
  newTask,
  releaseClaim,
  restorablePlan,
  restorePlan,
} from '../commands/task.ts';
import { loadConfig } from '../lib/config.ts';
import { FakeGitHub, addFakeIssue, initFakeState } from '../lib/github-fake.ts';
import type { Comment } from '../lib/github.ts';
import { parseDoc } from '../lib/plan.ts';
import { findRevertMarker, revertMarker } from '../lib/revert-marker.ts';
import { commitAll, makeFixture, revertOnMain, sh, tmp, write, type Fixture } from './helpers.ts';

test('linkFile: 심볼릭 링크 → 하드 링크 순으로 연결하고 복사하지 않는다(ADR-0005)', () => {
  const d = tmp('harness-link-');
  const src = path.join(d, 'dev-env');
  writeFileSync(src, 'A=1\n');
  // 심볼릭 링크를 만들 수 있는지는 환경이 정한다(개발자 모드가 꺼진 Windows는 못 만든다, ADR-0005)
  let canSymlink = true;
  try {
    symlinkSync(src, path.join(d, 'probe'));
  } catch {
    canSymlink = false;
  }
  if (canSymlink) {
    assert.equal(linkFile(src, path.join(d, 'a')), 'symlink');
    assert.ok(lstatSync(path.join(d, 'a')).isSymbolicLink());
  } else {
    assert.equal(linkFile(src, path.join(d, 'a')), 'hardlink');
    assert.equal(statSync(path.join(d, 'a')).ino, statSync(src).ino);
  }
  const fail = (): never => {
    throw new Error('EPERM: 심볼릭 링크 권한 없음');
  };
  assert.equal(linkFile(src, path.join(d, 'b'), { symlink: fail, hardlink: linkSync }), 'hardlink');
  assert.equal(statSync(path.join(d, 'b')).ino, statSync(src).ino);
  assert.equal(readFileSync(path.join(d, 'b'), 'utf8'), 'A=1\n');
  assert.equal(linkFile(src, path.join(d, 'c'), { symlink: fail, hardlink: fail }), null);
  assert.equal(existsSync(path.join(d, 'c')), false);
});

test('new-task: claim 브랜치로 선점하고 브랜치·worktree·계획 골격을 만든다', async () => {
  const fx = makeFixture();
  try {
    const r = await newTask(fx.root, {
      issue: 7,
      slug: 'demo',
      size: 'medium',
      owner: 'runner-1',
      github: false,
      date: '20261111',
    });
    assert.equal(r.branch, 'feat/20261111-demo-s0');
    assert.ok(existsSync(path.join(r.worktree, 'docs/exec-plans/active/20261111-demo/plan.md')));
    const fm = parseDoc(readFileSync(path.join(r.worktree, r.planFile), 'utf8')).frontmatter!;
    assert.deepEqual(
      [fm.id, fm.issue, fm.status, fm.owner, fm.size],
      ['20261111-demo', 7, 'draft', 'runner-1', 'medium'],
    );
    assert.match(sh('git', ['ls-remote', '--heads', 'origin', 'claim/7'], fx.root), /claim\/7/);
    // 같은 Issue를 다시 선점하면 거부된다(원자적 선점)
    await assert.rejects(
      newTask(fx.root, { issue: 7, slug: 'again', owner: 'runner-2', github: false }),
      ClaimError,
    );
    // 생존 확인은 fast-forward push
    claimHeartbeat(fx.root, loadConfig(fx.root), 7, 'runner-1');
    const small = await newTask(fx.root, {
      issue: 8,
      slug: 'typo',
      size: 'small',
      github: false,
      date: '20261111',
    });
    assert.equal(small.branch, 'feat/20261111-typo');
    assert.ok(existsSync(path.join(small.worktree, 'docs/exec-plans/active/20261111-typo.md')));
  } finally {
    fx.cleanup();
  }
});

test('new-task: 잘못된 slug와 Issue 없는 접수를 거부한다', async () => {
  const fx = makeFixture();
  try {
    await assert.rejects(newTask(fx.root, { slug: 'x', github: false }), /--issue/);
    await assert.rejects(
      newTask(fx.root, { issue: 1, slug: 'Bad Slug', github: false }),
      /kebab-case/,
    );
    await assert.rejects(
      newTask(fx.root, { issue: 1, slug: 'thing-s2', github: false }),
      /-s<숫자>/,
    );
  } finally {
    fx.cleanup();
  }
});

test('complete-step: 마지막 step이면 계획을 completed/로 옮기는 계획 전용 커밋', async () => {
  const fx = makeFixture();
  try {
    const r = await newTask(fx.root, { issue: 9, slug: 'two', github: false, date: '20261111' });
    const dir = path.join(r.worktree, 'docs/exec-plans/active/20261111-two');
    writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify({
        plan: '20261111-two',
        steps: [{ step: 0, name: 'only', status: 'in_progress' }],
      }),
    );
    write(r.worktree, 'src/x.ts', 'export const x = 1;\n');
    commitAll(r.worktree, 'work');
    // 처리 없는 발견 사항이 있으면 거부
    const plan = path.join(dir, 'plan.md');
    writeFileSync(
      plan,
      readFileSync(plan, 'utf8').replace('## 발견 사항', '## 발견 사항\n- 처리 안 된 항목'),
    );
    assert.throws(() => completeStep(r.worktree), /발견 사항/);
    writeFileSync(
      plan,
      readFileSync(plan, 'utf8').replace('- 처리 안 된 항목', '- 처리된 항목 → 처리: 해당 없음'),
    );
    const c = completeStep(r.worktree);
    assert.equal(c.last, true);
    assert.ok(existsSync(path.join(r.worktree, 'docs/exec-plans/completed/20261111-two/plan.md')));
    assert.ok(!existsSync(dir));
    const files = sh('git', ['show', '--name-only', '--format=', 'HEAD'], r.worktree);
    assert.ok(
      files.split('\n').every((f) => f.startsWith('docs/exec-plans/')),
      '계획 전용 커밋은 계획 파일만 바꾼다',
    );
  } finally {
    fx.cleanup();
  }
});

// ---------- revert된 계획의 복원 (8.3절 "되돌리기") ----------

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function comment(author: string, body: string, editors: string[] = []): Comment {
  const at = '2026-11-16T00:00:00Z';
  return {
    id: '1',
    author,
    body,
    createdAt: at,
    history: { changes: [author, ...editors].map((by) => ({ by, at })), complete: true },
  };
}

test('revert 표식: 봇이 쓰고 봇만 고친 댓글의 가장 최근 표식만 읽는다', () => {
  const line = revertMarker(SHA_A, '20261111-demo');
  assert.equal(line, `<!-- harness-revert target=${SHA_A} plan=20261111-demo -->`);
  assert.throws(() => revertMarker('abc', '20261111-demo'), /40자 SHA/);
  assert.throws(() => revertMarker(SHA_A, '../x'), /계획 id/);
  const bot = 'harness-bot';
  assert.deepEqual(findRevertMarker([comment(bot, `되돌렸다\n${line}`)], bot), {
    target: SHA_A,
    planId: '20261111-demo',
  });
  // 최근 댓글이 이긴다. 계정 이름의 대소문자는 가리지 않는다
  assert.equal(
    findRevertMarker(
      [comment(bot, line), comment('Harness-Bot', revertMarker(SHA_B, '20261112-two'))],
      bot,
    )?.target,
    SHA_B,
  );
  // 다른 계정의 댓글, 다른 계정이 고친 봇 댓글, 이력을 확인하지 못한 댓글은 믿지 않는다
  assert.equal(findRevertMarker([comment('contractor', line)], bot), null);
  assert.equal(findRevertMarker([comment(bot, line, ['contractor'])], bot), null);
  assert.equal(findRevertMarker([{ ...comment(bot, line), history: null }], bot), null);
  assert.equal(findRevertMarker([comment(bot, line)], ''), null);
  // 형식이 다른 표식은 무시한다
  for (const bad of [
    `<!-- harness-revert target=${SHA_A.slice(1)} plan=20261111-demo -->`,
    `<!-- harness-revert target=${SHA_A.toUpperCase()} plan=20261111-demo -->`,
    `<!-- harness-revert target=${SHA_A} plan=demo -->`,
    `<!-- harness-revert plan=20261111-demo target=${SHA_A} -->`,
  ])
    assert.equal(findRevertMarker([comment(bot, bad)], bot), null, bad);
});

/** 가짜 GitHub을 켜고 `fn`을 실행한다. 상태 파일 경로를 넘긴다 */
async function withFakeGh(fx: Fixture, fn: (state: string) => Promise<void>): Promise<void> {
  const prev = process.env.HARNESS_FAKE_GH;
  const state = path.join(fx.dir, 'gh.json');
  initFakeState(state, { remote: fx.remote, owner: 'maker' });
  process.env.HARNESS_FAKE_GH = state;
  try {
    await fn(state);
  } finally {
    if (prev === undefined) delete process.env.HARNESS_FAKE_GH;
    else process.env.HARNESS_FAKE_GH = prev;
  }
}

function remoteClone(fx: Fixture): string {
  const clone = path.join(mkdtempSync(path.join(fx.dir, 'clone-')), 'c');
  sh('git', ['clone', '-q', fx.remote, clone], fx.dir);
  sh('git', ['config', 'user.email', 'test@example.invalid'], clone);
  sh('git', ['config', 'user.name', 'test'], clone);
  sh('git', ['config', 'commit.gpgsign', 'false'], clone);
  return clone;
}

/** PR 병합 흉내: 브랜치를 push하고 원격 main에 squash 병합한 뒤 브랜치와 worktree를 정리한다. 병합 커밋 SHA */
function squashMerge(fx: Fixture, worktree: string, branch: string): string {
  sh('git', ['push', '-q', 'origin', branch], worktree);
  const clone = remoteClone(fx);
  sh('git', ['merge', '--squash', '-q', `origin/${branch}`], clone);
  const sha = commitAll(clone, `squash: ${branch}`);
  sh('git', ['push', '-q', 'origin', 'main'], clone);
  sh('git', ['push', '-q', 'origin', '--delete', branch], clone);
  sh('git', ['worktree', 'remove', '--force', worktree], fx.root);
  sh('git', ['branch', '-D', branch], fx.root);
  sh('git', ['fetch', '-q', '--prune', 'origin'], fx.root);
  return sha;
}

const STEP_TEXT = (n: number) =>
  `# Step ${n}: s${n}\n\n## 읽어야 할 파일\n\n- \`AGENTS.md\`\n\n## 작업\n\n1. src/s${n}.ts를 만든다.\n\n` +
  '## Acceptance Criteria\n\n```bash\ntest -f AGENTS.md\n```\n\n## 금지사항\n\n- 테스트를 지우지 마라. 이유: R4\n';

/** step 2개짜리 계획을 채운다(계획 골격 worktree에서) */
function fillTwoSteps(worktree: string, id: string): void {
  const dir = `docs/exec-plans/active/${id}`;
  write(
    worktree,
    `${dir}/index.json`,
    JSON.stringify(
      {
        plan: id,
        steps: [
          { step: 0, name: 's0', status: 'in_progress' },
          { step: 1, name: 's1', status: 'pending' },
        ],
      },
      null,
      2,
    ) + '\n',
  );
  write(worktree, `${dir}/step0.md`, STEP_TEXT(0));
  write(worktree, `${dir}/step1.md`, STEP_TEXT(1));
}

const readFm = (root: string, rel: string) =>
  parseDoc(readFileSync(path.join(root, rel), 'utf8')).frontmatter!;

test('new-task --issue: 첫 step의 PR이 revert된 Issue는 같은 id의 계획을 active/에 복원한다', async () => {
  const fx = makeFixture();
  try {
    await withFakeGh(fx, async (state) => {
      const issue = addFakeIssue(state, 'Demo', '본문');
      const gh = new FakeGitHub(state);
      const cfg = loadConfig(fx.root);
      // 표식이 없는 평소의 접수: 새 골격
      const r = await newTask(fx.root, {
        issue,
        slug: 'demo',
        owner: 'runner-1',
        date: '20261111',
      });
      const id = '20261111-demo';
      const dir = `docs/exec-plans/active/${id}`;
      assert.equal(readFm(r.worktree, r.planFile).status, 'draft');
      fillTwoSteps(r.worktree, id);
      write(r.worktree, 'src/s0.ts', 'export const s0 = 1;\n');
      const sideCommit = commitAll(r.worktree, 'step0');
      assert.equal(completeStep(r.worktree).last, false);
      const target = squashMerge(fx, r.worktree, r.branch);
      const hashAtTarget = planHashAt(fx.root, target, dir);
      assert.ok(hashAtTarget);
      revertOnMain(fx, target);
      assert.equal(
        sh('git', ['ls-tree', '-r', '--name-only', 'origin/main', '--', dir], fx.root),
        '',
      );

      // 표식이 없으면 복원하지 않는다. 봇이 아닌 계정의 표식도 믿지 않는다
      assert.equal(findRestore(fx.root, cfg, gh, issue), null);
      gh.commentAs(issue, 'contractor', revertMarker(target, id));
      assert.equal(findRestore(fx.root, cfg, gh, issue), null);
      // 봇의 표식이어도: main의 조상이 아닌 커밋, 다른 Issue의 계획, 형식이 다른 SHA는 복원하지 않는다
      const req = { target, planId: id, issue };
      assert.equal(restorablePlan(fx.root, 'origin/main', { ...req, target: sideCommit }), null);
      assert.equal(restorablePlan(fx.root, 'origin/main', { ...req, issue: issue + 1 }), null);
      assert.equal(restorablePlan(fx.root, 'origin/main', { ...req, target: 'HEAD' }), null);
      assert.equal(restorePlan(fx.root, 'origin/main', { ...req, target: sideCommit }), null);
      assert.deepEqual(restorablePlan(fx.root, 'origin/main', req)?.reverted, [0]);

      gh.comment(issue, `main의 check가 실패해 되돌렸다.\n${revertMarker(target, id)}`);
      // 다른 작업자의 선점이면 거부한다(첫 step의 Issue는 닫힌 적이 없어 선점이 남아 있다)
      await assert.rejects(
        newTask(fx.root, { issue, slug: 'other', owner: 'runner-2' }),
        ClaimError,
      );
      const again = await newTask(fx.root, {
        issue,
        slug: 'other',
        size: 'small',
        owner: 'runner-1',
      });
      assert.deepEqual([again.id, again.branch, again.step], [id, r.branch, 0]);
      assert.equal(again.planFile, `${dir}/plan.md`);
      const doc = parseDoc(readFileSync(path.join(again.worktree, again.planFile), 'utf8'));
      assert.deepEqual([doc.frontmatter!.status, doc.frontmatter!.owner], ['active', 'runner-1']);
      assert.match(doc.body, new RegExp(`revert된 계획 복원: 대상 ${target.slice(0, 12)}`));
      const idx = JSON.parse(readFileSync(path.join(again.worktree, dir, 'index.json'), 'utf8'));
      assert.deepEqual(idx.steps[0], { step: 0, name: 's0', status: 'pending' });
      assert.equal(idx.steps[1].status, 'pending');
      // 핵심 섹션과 step 파일은 그대로다: 받은 계획 승인이 유지된다
      assert.equal(planHash(again.worktree, dir), hashAtTarget);
      assert.equal(existsSync(path.join(again.worktree, 'src/s0.ts')), false);
      assert.match(gh.comments(issue).at(-1)!.body, /revert된 계획 `20261111-demo` 복원/);
    });
  } finally {
    fx.cleanup();
  }
});

test('new-task --issue: revert된 소규모 계획을 복원하고, 풀린 선점은 다시 잡는다', async () => {
  const fx = makeFixture();
  try {
    await withFakeGh(fx, async (state) => {
      const issue = addFakeIssue(state, 'Typo', '본문');
      const cfg = loadConfig(fx.root);
      const r = await newTask(fx.root, {
        issue,
        slug: 'typo',
        size: 'small',
        owner: 'runner-1',
        date: '20261111',
      });
      const id = '20261111-typo';
      write(r.worktree, 'src/typo.ts', 'export const t = 1;\n');
      commitAll(r.worktree, 'fix');
      assert.equal(completeStep(r.worktree).last, true);
      const target = squashMerge(fx, r.worktree, r.branch);
      assert.notEqual(showAt(fx, target, `docs/exec-plans/completed/${id}.md`), '');
      revertOnMain(fx, target);
      // 병합으로 Issue가 닫혔을 때 선점이 풀렸다
      assert.equal(releaseClaim(fx.root, cfg, issue), true);
      new FakeGitHub(state).comment(issue, revertMarker(target, id));

      const again = await newTask(fx.root, { issue, owner: 'runner-2' });
      assert.deepEqual([again.id, again.branch, again.step], [id, 'feat/20261111-typo', null]);
      assert.equal(again.planFile, `docs/exec-plans/active/${id}.md`);
      const fm = readFm(again.worktree, again.planFile);
      assert.deepEqual([fm.status, fm.owner, fm.issue], ['active', 'runner-2', issue]);
      assert.equal(
        existsSync(path.join(again.worktree, `docs/exec-plans/completed/${id}.md`)),
        false,
      );
      sh('git', ['fetch', '-q', '--prune', 'origin'], fx.root);
      assert.equal(claimOwner(fx.root, cfg, issue), 'runner-2');
    });
  } finally {
    fx.cleanup();
  }
});

/** 그 커밋 트리에 있는 경로 이름(없으면 '') */
function showAt(fx: Fixture, rev: string, file: string): string {
  return sh('git', ['ls-tree', '--name-only', rev, '--', file], fx.root);
}

test('new-task --plan: 마지막 step의 PR이 revert되면 복원하지 않고, 풀린 선점을 다시 잡는다', async () => {
  const fx = makeFixture();
  try {
    await withFakeGh(fx, async (state) => {
      const issue = addFakeIssue(state, 'Two', '본문');
      const cfg = loadConfig(fx.root);
      const gh = new FakeGitHub(state);
      const r0 = await newTask(fx.root, {
        issue,
        slug: 'two',
        owner: 'runner-1',
        date: '20261111',
      });
      const id = '20261111-two';
      fillTwoSteps(r0.worktree, id);
      write(r0.worktree, 'src/s0.ts', 'export const s0 = 1;\n');
      commitAll(r0.worktree, 'step0');
      completeStep(r0.worktree);
      squashMerge(fx, r0.worktree, r0.branch);
      const r1 = await newTask(fx.root, { plan: id, step: 1, owner: 'runner-1' });
      write(r1.worktree, 'src/s1.ts', 'export const s1 = 1;\n');
      commitAll(r1.worktree, 'step1');
      assert.equal(completeStep(r1.worktree).last, true);
      const target = squashMerge(fx, r1.worktree, r1.branch);
      revertOnMain(fx, target);
      gh.comment(issue, revertMarker(target, id));
      // main의 계획이 active/로 돌아와 있다: 복원할 것이 없다
      assert.notEqual(showAt(fx, 'origin/main', `docs/exec-plans/active/${id}/plan.md`), '');
      assert.equal(findRestore(fx.root, cfg, gh, issue), null);

      // 마지막 step 병합으로 Issue가 닫혀 선점이 풀렸고, revert 워크플로가 Issue를 다시 열었다
      assert.equal(releaseClaim(fx.root, cfg, issue), true);
      const again = await newTask(fx.root, { plan: id, step: 1, owner: 'runner-2' });
      assert.equal(again.branch, 'feat/20261111-two-s1');
      sh('git', ['fetch', '-q', '--prune', 'origin'], fx.root);
      assert.equal(claimOwner(fx.root, cfg, issue), 'runner-2');
      const idx = JSON.parse(
        readFileSync(path.join(again.worktree, `docs/exec-plans/active/${id}/index.json`), 'utf8'),
      );
      assert.deepEqual(
        idx.steps.map((s: { status: string }) => s.status),
        ['completed', 'pending'],
      );
    });
  } finally {
    fx.cleanup();
  }
});

test('appendProgress: 붙인 뒤의 계획 파일을 포매터가 고치지 않는다', async () => {
  const root = tmp();
  const file = 'plan.md';
  const ref = { id: '20261122-x', kind: 'small' as const, where: 'active' as const, file };
  const config = await prettier.resolveConfig(path.join(import.meta.dirname, 'x.md'));
  const md = { ...config, filepath: 'x.md' };
  const FRONT = '---\nid: 20261122-x\nstatus: active # draft | active\n---\n\n# 제목\n';
  const cases: [name: string, body: string][] = [
    ['진행 로그 절이 없다', '\n- 목표: a\n- 변경: b\n- 검증: c\n\n## 관련 파일·문서\n\n- `a.ts`\n'],
    ['진행 로그 절이 비어 있고 마지막 절이다', '\n본문\n\n## 진행 로그\n'],
    [
      '진행 로그 절이 비어 있고 뒤에 절이 있다',
      '\n본문\n\n## 진행 로그\n\n## 의사결정 로그\n\n없음.\n',
    ],
    ['진행 로그에 항목이 있고 마지막 절이다', '\n본문\n\n## 진행 로그\n\n- 2026-11-22 접수\n'],
    [
      '진행 로그에 항목이 있고 뒤에 절이 있다',
      '\n본문\n\n## 진행 로그\n\n- 2026-11-22 접수\n  - 딸린 줄\n\n## 발견 사항\n\n없음.\n',
    ],
    [
      '진행 로그가 주석으로 끝난다',
      '\n본문\n\n## 진행 로그\n\n<!-- 시간순 -->\n\n## 발견 사항\n\n없음.\n',
    ],
    [
      '진행 로그가 문단으로 끝난다',
      '\n본문\n\n## 진행 로그\n\n아직 없다.\n\n## 발견 사항\n\n없음.\n',
    ],
    // 빈 줄이 든 목록: 같은 간격으로 붙인다
    [
      '항목 사이에 빈 줄이 있다',
      '\n본문\n\n## 진행 로그\n\n- 첫 기록\n\n- 둘째 기록\n\n## 발견 사항\n\n없음.\n',
    ],
    [
      '앞 항목들만 빈 줄로 떨어져 있다',
      '\n본문\n\n## 진행 로그\n\n- 첫 기록\n\n- 둘째 기록\n- 셋째 기록\n',
    ],
    [
      '마지막 항목 안에 빈 줄이 있다(딸린 문단)',
      '\n본문\n\n## 진행 로그\n\n- 첫 기록\n\n  딸린 문단\n\n## 발견 사항\n\n없음.\n',
    ],
    [
      '딸린 목록의 항목 사이에 빈 줄이 있다',
      '\n본문\n\n## 진행 로그\n\n- 첫 기록\n  - 딸린 항목\n\n  - 딸린 항목 둘\n',
    ],
    [
      '항목 안의 코드 블록에 빈 줄이 있다',
      '\n본문\n\n## 진행 로그\n\n- 첫 기록\n\n  ```text\n  x\n\n  y\n  ```\n\n## 발견 사항\n\n없음.\n',
    ],
    // 목록이 아닌 것으로 끝난다: 빈 줄을 두고 새 목록을 시작한다
    [
      '번호 목록으로 끝난다',
      '\n본문\n\n## 진행 로그\n\n1. 첫 기록\n2. 둘째 기록\n\n## 발견 사항\n\n없음.\n',
    ],
    ['번호 목록의 딸린 목록으로 끝난다', '\n본문\n\n## 진행 로그\n\n1. 첫 기록\n   - 딸린 항목\n'],
    [
      '코드 블록으로 끝난다',
      '\n본문\n\n## 진행 로그\n\n```text\n- x\n```\n\n## 발견 사항\n\n없음.\n',
    ],
    [
      '표로 끝난다',
      '\n본문\n\n## 진행 로그\n\n| 날짜 | 한 일 |\n| ---- | ----- |\n| 오늘 | 접수  |\n',
    ],
    ['인용으로 끝난다', '\n본문\n\n## 진행 로그\n\n> 인용\n\n## 발견 사항\n\n없음.\n'],
  ];
  for (const [name, body] of cases) {
    const before = FRONT + body;
    assert.ok(await prettier.check(before, md), `${name}: 붙이기 전의 글이 포맷에 맞다`);
    write(root, file, before);
    appendProgress(root, ref, '첫 줄');
    appendProgress(root, ref, '둘째 줄');
    const after = readFileSync(path.join(root, file), 'utf8');
    assert.ok(await prettier.check(after, md), `${name}:\n${after}`);
    // 붙인 두 줄이 진행 로그 절 안에 차례로 있고, 있던 글은 그대로다
    const sec = after.slice(after.indexOf('## 진행 로그'));
    const own = sec.slice(0, sec.indexOf('\n## ', 1) < 0 ? sec.length : sec.indexOf('\n## ', 1));
    assert.match(own, /^- \S+ 첫 줄\n\n?- \S+ 둘째 줄$/m, `${name}:\n${after}`);
    for (const line of before.split('\n').filter(Boolean))
      assert.ok(after.includes(line), `${name}: ${line}`);
  }
});
