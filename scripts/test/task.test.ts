import assert from 'node:assert/strict';
import { existsSync, linkSync, lstatSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ClaimError, claimHeartbeat, completeStep, linkFile, newTask } from '../commands/task.ts';
import { loadConfig } from '../lib/config.ts';
import { parseDoc } from '../lib/plan.ts';
import { commitAll, makeFixture, sh, tmp, write } from './helpers.ts';

test('linkFile: 심볼릭 링크 → 하드 링크 순으로 연결하고 복사하지 않는다(ADR-0005)', () => {
  const d = tmp('harness-link-');
  const src = path.join(d, 'dev-env');
  writeFileSync(src, 'A=1\n');
  assert.equal(linkFile(src, path.join(d, 'a')), 'symlink');
  assert.ok(lstatSync(path.join(d, 'a')).isSymbolicLink());
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
