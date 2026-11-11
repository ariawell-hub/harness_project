import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandName, parseShell } from '../hooks/shell.ts';

const argvs = (s: string) => parseShell(s).map((c) => c.argv);
const ps = (s: string) => parseShell(s, 'powershell').map((c) => c.argv);
const cmd = (s: string) => parseShell(s, 'cmd').map((c) => c.argv);
const has = (all: string[][], s: string) => all.some((a) => a.join(' ') === s);

test('commandName: 경로·대소문자·실행 확장자를 무시한다(ADR-0005)', () => {
  assert.equal(commandName('C:\\Program Files\\Git\\cmd\\git.exe'), 'git');
  assert.equal(commandName('/usr/bin/GIT'), 'git');
  assert.equal(commandName('Remove-Item'), 'remove-item');
  assert.equal(commandName('npm.CMD'), 'npm');
});

test('PowerShell 방언: 백틱 이스케이프, 역슬래시 보존, $(...), 블록 주석, 호출 연산자', () => {
  assert.deepEqual(ps('Remove-Item -Recurse -Force C:\\work\\x'), [
    ['Remove-Item', '-Recurse', '-Force', 'C:\\work\\x'],
  ]);
  assert.deepEqual(ps('Write-Output "a`"b" \'c d\''), [['Write-Output', 'a"b', 'c d']]);
  assert.ok(has(ps('echo $(gh auth token)'), 'gh auth token'));
  assert.deepEqual(ps('git status; git log | Select-Object -First 1'), [
    ['git', 'status'],
    ['git', 'log'],
    ['Select-Object', '-First', '1'],
  ]);
  assert.deepEqual(ps('ls <# git push origin main #> -Force'), [['ls', '-Force']]);
  assert.deepEqual(ps('& "C:\\Git\\bin\\git.exe" push --force'), [
    ['C:\\Git\\bin\\git.exe', 'push', '--force'],
  ]);
});

test('cmd 방언: ^ 이스케이프, & 구분, 작은따옴표는 일반 문자', () => {
  assert.deepEqual(cmd('rd /s /q C:\\x & echo it^&s'), [
    ['rd', '/s', '/q', 'C:\\x'],
    ['echo', 'it&s'],
  ]);
  assert.deepEqual(cmd("echo 'a b'"), [['echo', "'a", "b'"]]);
});

test('PowerShell·cmd 래퍼 안의 명령도 꺼낸다', () => {
  assert.ok(
    has(
      argvs('powershell -NoProfile -Command "gh pr review 1 --approve"'),
      'gh pr review 1 --approve',
    ),
  );
  assert.ok(has(argvs('pwsh.exe -c "git push --force origin x"'), 'git push --force origin x'));
  assert.ok(has(argvs('powershell -ExecutionPolicy Bypass "gh auth token"'), 'gh auth token'));
  const enc = Buffer.from('gh auth token', 'utf16le').toString('base64');
  assert.ok(has(argvs(`powershell -enc ${enc}`), 'gh auth token'));
  assert.ok(has(argvs(`powershell.exe -EncodedCommand ${enc}`), 'gh auth token'));
  assert.ok(has(argvs('cmd /c "git push -f origin x"'), 'git push -f origin x'));
  assert.ok(has(argvs('CMD.EXE /S /C "gh auth token"'), 'gh auth token'));
  assert.ok(has(ps('iex "gh auth token"'), 'gh auth token'));
  assert.ok(has(ps('Invoke-Expression -Command "gh auth token"'), 'gh auth token'));
  // -File 스크립트는 내용을 볼 수 없다(bash script.sh와 같다)
  assert.equal(argvs('powershell -File x.ps1').length, 1);
});

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
