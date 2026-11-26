// repoInfo가 git을 한 번만 띄우고(Issue #230), 돌려주는 값과 예외는 예전 두 번 읽기와 같은지 본다.
// 프로세스 수는 node:child_process의 spawnSync를 감싸 센다(제품 코드에 세는 장치를 두지 않는다).
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { GitError, repoInfo } from '../lib/git.ts';
import { commitAll, gitInit, sh, tmp } from './helpers.ts';

/** fn을 부르는 동안 띄운 동기 프로세스(명령과 인자)를 돌려준다 */
function spawned<T>(fn: () => T): { value: T; calls: string[][] } {
  const orig = cp.spawnSync;
  const calls: string[][] = [];
  cp.spawnSync = function (this: unknown, ...a: Parameters<typeof orig>) {
    const [cmd, args] = a as unknown as [string, string[] | undefined];
    calls.push([cmd, ...(Array.isArray(args) ? args : [])]);
    return orig.apply(this, a);
  } as typeof orig;
  syncBuiltinESMExports();
  try {
    return { value: fn(), calls };
  } finally {
    cp.spawnSync = orig;
    syncBuiltinESMExports();
  }
}

/** 예전 repoInfo(rev-parse 다음 symbolic-ref)가 돌려주던 값 */
function expected(cwd: string) {
  const out = sh(
    'git',
    ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
    cwd,
  ).split('\n');
  const commonDir = path.resolve(cwd, out[2]);
  const gitDir = path.resolve(out[1]);
  const sym = cp.spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  return {
    root: out[0],
    gitDir,
    commonDir,
    mainRoot: path.dirname(commonDir),
    isMainCheckout: gitDir === commonDir,
    branch: sym.status === 0 ? sym.stdout.trim() : 'HEAD',
  };
}

function repo(): string {
  const root = path.join(tmp('harness-repo-info-'), 'r');
  gitInit(root);
  writeFileSync(path.join(root, 'a.txt'), 'a\n');
  commitAll(root, 'init');
  return root;
}

test('repoInfo: 커밋이 있는 리포에서는 부를 때마다 git을 하나만 띄우고, 값은 예전 두 번 읽기와 같다(메인 체크아웃·worktree)', () => {
  const root = repo();
  const wt = path.join(path.dirname(root), 'wt');
  sh('git', ['worktree', 'add', '-q', '-b', 'feature/wt', wt], root);
  for (const cwd of [root, wt]) {
    for (let i = 0; i < 2; i++) {
      const { value, calls } = spawned(() => repoInfo(cwd));
      assert.equal(calls.length, 1, `${cwd}: ${JSON.stringify(calls)}`);
      assert.deepEqual(value, expected(cwd));
    }
  }
  assert.equal(repoInfo(root).isMainCheckout, true);
  assert.equal(repoInfo(wt).isMainCheckout, false);
  assert.equal(repoInfo(wt).branch, 'feature/wt');
});

test('repoInfo: 브랜치 이름은 symbolic-ref --short와 같다(겹치는 짧은 이름, 원격 추적 ref, detached HEAD)', () => {
  const root = repo();
  const check = (what: string) => assert.deepEqual(repoInfo(root), expected(root), what);
  check('일반');
  sh('git', ['checkout', '-q', '-b', 'feature/x'], root);
  check('/가 든 이름');
  sh('git', ['checkout', '-q', 'main'], root);
  sh('git', ['tag', 'main'], root);
  check('같은 이름의 태그');
  assert.equal(repoInfo(root).branch, 'heads/main');
  sh('git', ['update-ref', 'refs/remotes/origin/zz', 'HEAD'], root);
  sh('git', ['checkout', '-q', '-b', 'origin/zz'], root);
  check('같은 짧은 이름의 원격 추적 ref');
  assert.equal(repoInfo(root).branch, 'origin/zz');
  sh('git', ['symbolic-ref', 'HEAD', 'refs/remotes/origin/zz'], root);
  check('HEAD가 refs/remotes를 가리킴');
  sh('git', ['checkout', '-q', '--detach', 'main'], root);
  check('detached HEAD');
  assert.equal(repoInfo(root).branch, 'HEAD');
  sh('git', ['checkout', '-q', 'feature/x'], root);
  assert.equal(repoInfo(root).branch, 'feature/x', '브랜치를 바꾸면 다음 호출에 새 값');
});

test('repoInfo: 커밋이 없는 브랜치, 하위 폴더, 바뀐 설정도 예전과 같은 값이다', () => {
  const empty = path.join(tmp('harness-repo-info-'), 'e');
  gitInit(empty);
  const { value, calls } = spawned(() => repoInfo(empty));
  assert.deepEqual(value, expected(empty));
  assert.equal(value.branch, 'main');
  assert.ok(calls.length <= 3, JSON.stringify(calls));

  const root = repo();
  const sub = path.join(root, 'sub', 'deeper');
  mkdirSync(sub, { recursive: true });
  assert.deepEqual(repoInfo(sub), expected(sub));
  assert.equal(repoInfo(sub).root, repoInfo(root).root);

  const other = path.join(path.dirname(root), 'elsewhere');
  mkdirSync(other);
  sh('git', ['config', 'core.worktree', other], root);
  assert.deepEqual(repoInfo(root), expected(root));
  // 경로 표기(Windows의 짧은 이름 등)에 기대지 않으려고 폴더 이름으로 견준다
  assert.equal(path.basename(repoInfo(root).root), path.basename(other));
});

test('repoInfo: 작업 트리에 HEAD라는 파일이 있어도 git을 하나만 띄우고 값은 예전과 같다', () => {
  // git rev-parse는 인자 HEAD가 리비전이자 파일 이름이어도 모호하다고 실패하지 않는다(구현 판정 F14의 반박 근거)
  const root = repo();
  writeFileSync(path.join(root, 'HEAD'), 'not a ref\n');
  const sub = path.join(root, 'sub');
  mkdirSync(sub);
  writeFileSync(path.join(sub, 'HEAD'), 'not a ref\n');
  for (const cwd of [root, sub]) {
    const { value, calls } = spawned(() => repoInfo(cwd));
    assert.equal(calls.length, 1, `${cwd}: ${JSON.stringify(calls)}`);
    assert.deepEqual(value, expected(cwd));
  }
  // 이 테스트가 모호한 경우를 만든 것을 확인한다: 모호성을 따지는 명령(git log)은 같은 자리에서 실패한다
  const log = cp.spawnSync('git', ['log', '-1', '--format=%h', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    // 오류 문구를 견주므로 번역하지 않은 문구로 받는다(구현 판정 F16)
    env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' },
  });
  assert.notEqual(log.status, 0, log.stdout);
  assert.match(log.stderr, /ambiguous argument 'HEAD'/);
});

test('repoInfo: 첫 커밋 전 브랜치의 작업 트리에 HEAD 파일이 있어도 브랜치 이름은 HEAD가 아니다 (Issue #252)', () => {
  // 빠른 경로가 HEAD를 파일 인자로 읽어 그 글자를 브랜치로 내던 회귀(#236, PR #226 판정 F3)
  const empty = path.join(tmp('harness-repo-info-'), 'e');
  gitInit(empty);
  writeFileSync(path.join(empty, 'HEAD'), 'not a ref\n');
  const sub = path.join(empty, 'sub');
  mkdirSync(sub);
  writeFileSync(path.join(sub, 'HEAD'), 'not a ref\n');
  for (const cwd of [empty, sub]) {
    const { value, calls } = spawned(() => repoInfo(cwd));
    assert.deepEqual(value, expected(cwd), cwd);
    assert.equal(value.branch, 'main', cwd);
    assert.ok(calls.length <= 3, `${cwd}: ${JSON.stringify(calls)}`);
  }
});

/** 빠른 경로 호출(`--abbrev-ref=loose`가 든 git rev-parse)에만 꾸민 출력과 종료 코드 0을 돌려주고 나머지는 실행한다 */
function faked<T>(fastStdout: string, fn: () => T): { value: T; calls: string[][] } {
  const orig = cp.spawnSync;
  const calls: string[][] = [];
  cp.spawnSync = function (this: unknown, ...a: Parameters<typeof orig>) {
    const [cmd, args] = a as unknown as [string, string[] | undefined];
    const argv = Array.isArray(args) ? args : [];
    calls.push([cmd, ...argv]);
    if (argv.includes('--abbrev-ref=loose'))
      return { pid: 0, output: [], stdout: fastStdout, stderr: '', status: 0, signal: null };
    return orig.apply(this, a);
  } as typeof orig;
  syncBuiltinESMExports();
  try {
    return { value: fn(), calls };
  } finally {
    cp.spawnSync = orig;
    syncBuiltinESMExports();
  }
}

test('repoInfo: 빠른 경로가 성공해도 다섯째 줄이 정확히 --가 아니면 예전 경로로 읽는다 (Issue #252)', () => {
  const root = repo();
  const real = expected(root);
  const head = [real.root, real.gitDir, '.git'];
  for (const out of [
    [...head, 'HEAD'].join('\n') + '\n', // 줄이 넷(예전 빠른 경로의 출력 꼴)
    [...head, 'HEAD', 'oops'].join('\n') + '\n', // 다섯째 줄이 다른 글
    [...head, 'HEAD', '--', 'x'].join('\n') + '\n', // 줄이 여섯
  ]) {
    const { value, calls } = faked(out, () => repoInfo(root));
    assert.ok(
      calls.some((c) => c.includes('symbolic-ref')),
      `예전 경로를 타야 한다: ${JSON.stringify(calls)}`,
    );
    assert.deepEqual(value, real, JSON.stringify(out));
  }
});

test('repoInfo: detached HEAD와 브랜치와 같은 짧은 이름의 ref가 있어도 git을 하나만 띄운다 (Issue #252)', () => {
  const root = repo();
  const once = (what: string) => {
    const { value, calls } = spawned(() => repoInfo(root));
    assert.equal(calls.length, 1, `${what}: ${JSON.stringify(calls)}`);
    assert.deepEqual(value, expected(root), what);
  };
  sh('git', ['tag', 'main'], root);
  once('같은 이름의 태그');
  sh('git', ['update-ref', 'refs/remotes/origin/zz', 'HEAD'], root);
  sh('git', ['checkout', '-q', '-b', 'origin/zz'], root);
  once('같은 짧은 이름의 원격 추적 ref');
  sh('git', ['checkout', '-q', '--detach', 'main'], root);
  once('detached HEAD');
});

test('repoInfo: 리포가 아닌 폴더에서는 예전과 같은 GitError를 던진다', () => {
  const dir = tmp('harness-repo-info-none-');
  assert.throws(
    () => repoInfo(dir),
    (e: Error) =>
      e instanceof GitError &&
      e.message.startsWith(
        'git rev-parse --show-toplevel --absolute-git-dir --git-common-dir 실패',
      ),
  );
});
