// 병합된 worktree 정리(cleanupMerged): 호출한 프로세스가 들어 있는 worktree는 남긴다(Issue #16 step1).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { HarnessConfig } from '../lib/config.ts';
import { cleanupMerged } from '../runner/run.ts';
import type { LocalPlan } from '../runner/next.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

function merged(worktree: string, branch: string, id: string): LocalPlan {
  return {
    worktree,
    branch,
    id,
    step: 0,
    ref: { id, kind: 'multi', where: 'active', file: `docs/exec-plans/active/${id}/plan.md` },
    fm: {},
    issue: 0,
    stepStatus: 'completed',
    needsPlanning: false,
    pr: { state: 'merged' } as LocalPlan['pr'],
    conflictWaiting: false,
  };
}

test('cleanupMerged: 지금 프로세스가 들어 있는 worktree는 지우지 않고 이유를 알린다', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const here = path.join(dir, 'wt', 'here');
  const done = path.join(dir, 'wt', 'done');
  sh('git', ['worktree', 'add', '-q', '-b', 'fix/20261112-here-s0', here], main);
  sh('git', ['worktree', 'add', '-q', '-b', 'fix/20261112-done-s0', done], main);
  const locals = [
    merged(here, 'fix/20261112-here-s0', '20261112-here'),
    merged(done, 'fix/20261112-done-s0', '20261112-done'),
  ];

  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let removed: string[];
  try {
    // 하위 폴더에 있어도 그 worktree 안이다
    removed = cleanupMerged(main, {} as HarnessConfig, locals, path.join(here, 'src'));
  } finally {
    process.stdout.write = orig;
  }

  assert.deepEqual(removed, [done]);
  assert.equal(existsSync(here), true, '세션이 있는 worktree는 남는다');
  assert.equal(existsSync(done), false);
  const kept = lines.find((l) => l.includes('남김'));
  assert.ok(kept, `남긴 이유 출력: ${lines.join(' | ')}`);
  assert.match(kept, new RegExp(here.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('cleanupMerged: here를 주지 않으면 process.cwd() 기준이고, main에서 부르면 모두 정리한다', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const a = path.join(dir, 'wt', 'a');
  sh('git', ['worktree', 'add', '-q', '-b', 'fix/20261112-a-s0', a], main);
  const removed = cleanupMerged(main, {} as HarnessConfig, [
    merged(a, 'fix/20261112-a-s0', '20261112-a'),
  ]);
  assert.deepEqual(removed, [a]);
});
