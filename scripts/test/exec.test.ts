// Windows 네이티브 실행 분기 테스트(ADR-0005). 플랫폼·환경·파일 존재 여부를 주입해 macOS·Linux에서도 검증한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findGitBash, resolveExecutable, shellOption } from '../lib/exec.ts';
import { resolveAgentCommand } from '../runner/agents.ts';
import type { HarnessConfig } from '../lib/config.ts';

const existsIn =
  (...paths: string[]) =>
  (p: string) =>
    paths.some((x) => x.toLowerCase() === p.toLowerCase());
const noGit = () => null;

test('findGitBash: 환경 변수 → git --exec-path → 기본 설치 경로 순서', () => {
  const custom = 'D:\\tools\\Git\\bin\\bash.exe';
  assert.equal(
    findGitBash({ env: { HARNESS_BASH: custom }, exists: existsIn(custom), gitExecPath: noGit }),
    custom,
  );
  assert.equal(
    findGitBash({
      env: { CLAUDE_CODE_GIT_BASH_PATH: custom },
      exists: existsIn(custom),
      gitExecPath: noGit,
    }),
    custom,
  );
  const fromGit = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(
    findGitBash({
      env: {},
      exists: existsIn(fromGit),
      gitExecPath: () => 'C:/Program Files/Git/mingw64/libexec/git-core',
    }),
    fromGit,
  );
  const usrBin = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
  assert.equal(
    findGitBash({
      env: {},
      exists: existsIn(usrBin),
      gitExecPath: () => 'C:/Program Files/Git/mingw64/libexec/git-core',
    }),
    usrBin,
  );
  assert.equal(
    findGitBash({
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: existsIn(fromGit),
      gitExecPath: noGit,
    }),
    fromGit,
  );
  const userInstall = 'C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
  assert.equal(
    findGitBash({
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      exists: existsIn(userInstall),
      gitExecPath: noGit,
    }),
    userInstall,
  );
});

test('findGitBash: WSL bash는 지정해도 쓰지 않고, 아무것도 없으면 null', () => {
  const wsl = 'C:\\Windows\\System32\\bash.exe';
  const store = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe';
  assert.equal(
    findGitBash({ env: { HARNESS_BASH: wsl }, exists: existsIn(wsl), gitExecPath: noGit }),
    null,
  );
  assert.equal(
    findGitBash({
      env: { CLAUDE_CODE_GIT_BASH_PATH: store },
      exists: existsIn(store),
      gitExecPath: noGit,
    }),
    null,
  );
  const real = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(
    findGitBash({
      env: { HARNESS_BASH: wsl, ProgramFiles: 'C:\\Program Files' },
      exists: existsIn(wsl, real),
      gitExecPath: noGit,
    }),
    real,
  );
  assert.equal(findGitBash({ env: {}, exists: () => false, gitExecPath: noGit }), null);
});

test('shellOption: macOS·Linux는 /bin/sh, Windows는 Git Bash, 없으면 null', () => {
  const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(
    shellOption('darwin', () => bash),
    true,
  );
  assert.equal(
    shellOption('linux', () => null),
    true,
  );
  assert.equal(
    shellOption('win32', () => bash),
    bash,
  );
  assert.equal(
    shellOption('win32', () => null),
    null,
  );
});

test('resolveExecutable: Windows는 PATH·PATHEXT로 찾고 .cmd 래퍼는 거부한다', () => {
  assert.deepEqual(
    resolveExecutable('claude', { platform: 'darwin', env: {}, exists: () => false }),
    { path: 'claude' },
  );
  const env = { Path: 'C:\\a;C:\\b', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.deepEqual(
    resolveExecutable('claude', {
      platform: 'win32',
      env,
      exists: existsIn('C:\\b\\claude.exe'),
    }),
    { path: 'C:\\b\\claude.exe' },
  );
  // PATH 순서를 따른다: 앞 디렉터리의 .cmd가 먼저 걸리면 거부한다
  const r = resolveExecutable('codex', {
    platform: 'win32',
    env,
    exists: existsIn('C:\\a\\codex.cmd', 'C:\\b\\codex.exe'),
  });
  assert.ok('error' in r && r.error.includes('codex.cmd'), JSON.stringify(r));
  // 경로·확장자를 직접 적은 경우
  assert.deepEqual(
    resolveExecutable('C:\\tools\\codex.exe', { platform: 'win32', env, exists: () => true }),
    { path: 'C:\\tools\\codex.exe' },
  );
  assert.ok(
    'error' in
      resolveExecutable('C:\\tools\\codex.cmd', { platform: 'win32', env, exists: () => true }),
  );
  // 환경 변수 이름의 대소문자는 가리지 않는다
  assert.deepEqual(
    resolveExecutable('gh', {
      platform: 'win32',
      env: { PATH: 'C:\\gh' },
      exists: existsIn('C:\\gh\\gh.exe'),
    }),
    { path: 'C:\\gh\\gh.exe' },
  );
  // 못 찾으면 그대로 돌려준다(실행 시 ENOENT로 알린다)
  assert.deepEqual(resolveExecutable('nothing', { platform: 'win32', env, exists: () => false }), {
    path: 'nothing',
  });
});

test('resolveAgentCommand: runner가 고른 도구의 실행 파일을 확인한다', () => {
  const cfg = {
    agents: { claude: { cmd: 'claude', args: [] }, codex: { cmd: 'codex', args: [] } },
  } as unknown as HarnessConfig;
  const win = {
    platform: 'win32' as const,
    env: { Path: 'C:\\npm' },
    exists: existsIn('C:\\npm\\codex.cmd', 'C:\\npm\\claude.exe'),
  };
  assert.deepEqual(resolveAgentCommand('claude', cfg, win), { path: 'C:\\npm\\claude.exe' });
  const r = resolveAgentCommand('codex', cfg, win);
  assert.ok('error' in r && r.error.includes('agents.codex.cmd'), JSON.stringify(r));
  assert.deepEqual(resolveAgentCommand('fake', cfg, win), { path: process.execPath });
  const none = resolveAgentCommand('codex', { agents: {} } as unknown as HarnessConfig, win);
  assert.ok('error' in none);
});
