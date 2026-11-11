import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseShell } from '../hooks/shell.ts';

const argvs = (s: string) => parseShell(s).map((c) => c.argv);

test('복합 명령을 단순 명령으로 나눈다', () => {
  assert.deepEqual(argvs('git status && pnpm test; echo hi | grep h'), [
    ['git', 'status'],
    ['pnpm', 'test'],
    ['echo', 'hi'],
    ['grep', 'h'],
  ]);
});

test('따옴표와 이스케이프를 처리한다', () => {
  assert.deepEqual(argvs(`git commit -m "a b" 'c d' e\\ f`), [
    ['git', 'commit', '-m', 'a b', 'c d', 'e f'],
  ]);
});

test('bash -c와 eval 안의 명령도 꺼낸다', () => {
  const all = argvs(`bash -lc "echo x && gh auth token"`);
  assert.ok(all.some((a) => a.join(' ') === 'gh auth token'));
  assert.ok(
    argvs(`eval 'git push origin main'`).some((a) => a.join(' ') === 'git push origin main'),
  );
});

test('$(...)와 백틱 치환 안의 명령도 꺼낸다', () => {
  assert.ok(argvs('echo $(gh auth token)').some((a) => a.join(' ') === 'gh auth token'));
  assert.ok(argvs('echo `security find-generic-password -s x`').some((a) => a[0] === 'security'));
});

test('env·sudo·할당 접두어를 벗기고 할당·해제를 기록한다', () => {
  const [c] = parseShell('GH_TOKEN=abc sudo -E env -u GITHUB_TOKEN git push');
  assert.deepEqual(c.argv, ['git', 'push']);
  assert.equal(c.assigns.GH_TOKEN, 'abc');
  assert.deepEqual(c.unsets, ['GITHUB_TOKEN']);
  const [u] = parseShell('unset GH_TOKEN');
  assert.deepEqual(u.unsets, ['GH_TOKEN']);
  const [e] = parseShell('export GH_TOKEN=x');
  assert.equal(e.assigns.GH_TOKEN, 'x');
});

test('heredoc 본문은 명령으로 보지 않는다', () => {
  const all = argvs('cat > a.sql <<EOF\nDROP TABLE users;\nEOF\necho done');
  assert.deepEqual(all, [
    ['cat', '>', 'a.sql'],
    ['echo', 'done'],
  ]);
});

test('주석은 무시한다', () => {
  assert.deepEqual(argvs('ls # git push origin main'), [['ls']]);
});
