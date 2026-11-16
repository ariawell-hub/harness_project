// L1 훅 테스트(12.4절 R13·R20 시나리오 포함). 규칙 표 + 실제 프로세스 종료 코드 2 확인.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_MCP_GUARD, type McpGuardConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { repoInfo } from '../lib/git.ts';
import { findPlan } from '../lib/plan.ts';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { buildContext, normalize } from '../hooks/guard.ts';
import { HARNESS_ROOT, commitAll, gitInit, sh, tmp, write } from './helpers.ts';
import { readFileSync } from 'node:fs';

const HOME = '/Users/someone';
const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
  repo: null,
  hasPlan: () => true,
  dbPatterns: [],
  dbClients: [],
  home: HOME,
  ...over,
});
const bash = (command: string, c = ctx(), cwd = '/work/repo') =>
  evaluate({ kind: 'bash', command, cwd }, c);

const BLOCK: [string, string][] = [
  ['gh pr review 12 --approve', 'R20'],
  ['gh pr review --approve 12 -b ok', 'R20'],
  ['gh pr merge 3 --admin --squash', 'R20'],
  ['gh auth token', 'R20'],
  ['gh auth switch -u maker', 'R20'],
  ['gh secret set FOO -b bar', 'R20'],
  ['gh api -X PUT repos/o/r/branches/main/protection -f x=1', 'R20'],
  ['gh api repos/o/r/rulesets -f name=x', 'R20'],
  ['gh api --method DELETE repos/o/r/environments/judge', 'R20'],
  ['gh api -X PATCH repos/o/r -f allow_auto_merge=false', 'R20'],
  [
    `gh api graphql -f query='mutation { addPullRequestReview(input:{}) { clientMutationId } }'`,
    'R20',
  ],
  ['GH_TOKEN=ghp_x gh pr list', 'R20'],
  ['unset GH_TOKEN', 'R20'],
  ['env -u GH_TOKEN gh pr list', 'R20'],
  ['security find-generic-password -s github.com -w', 'R20'],
  ['cat ~/.config/gh/hosts.yml', 'R20'],
  ['git credential fill', 'R20'],
  ['git push origin main', 'R2'],
  ['git push origin HEAD:main', 'R2'],
  ['git push --all', 'R2'],
  ['git push -f origin feat/x', 'R14'],
  ['git push --force-with-lease origin feat/x', 'R14'],
  ['git push origin +feat/x', 'R14'],
  ['git commit --no-verify -m x', 'R4'],
  ['git commit -nm x', 'R4'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'R4'],
  ['git config core.hooksPath .nohooks', 'R4'],
  ['gh workflow disable check.yml', 'R4'],
  ['git add -f .env', 'R10'],
  ['cat .env', 'R10'],
  ['grep KEY .env.local', 'R10'],
  ['source .env.production', 'R10'],
  ['git reset --hard HEAD~1', 'R14'],
  ['git clean -fdx', 'R14'],
  ['git checkout -- .', 'R14'],
  ['git restore .', 'R14'],
  ['git branch -D feat/other', 'R14'],
  ['git filter-branch --tree-filter x', 'R14'],
  ['rm -rf /', 'R14'],
  ['rm -rf ~', 'R14'],
  ['rm -rf ~/Documents', 'R14'],
  ['rm -rf $SOME_DIR', 'R14'],
  ['terraform destroy -auto-approve', 'R14'],
  ['vercel deploy --prod', 'R14'],
  ['npm publish', 'R14'],
  ['curl http://169.254.169.254/latest/meta-data/', 'R14'],
  ['psql -h db.internal -U app', 'R13'],
  ['docker exec db mysql -e "select 1"', 'R13'],
  ['pnpm prisma db push', 'R13'],
  ['npx prisma migrate reset --force', 'R13'],
  ['pnpm drizzle-kit push', 'R13'],
  [`node -e "db.query('DROP TABLE users')"`, 'R13'],
  [`node -e "db.query('DELETE FROM users')"`, 'R13'],
  ['echo "UPDATE users SET admin = true" | sqlite3 dev.db', 'R13'],
  ['bash -c "echo ok && gh pr review 1 --approve"', 'R20'],
  ['echo $(gh auth token)', 'R20'],
];

const ALLOW = [
  'git status',
  'git push origin feat/20261110-x-s0',
  'git push -u origin HEAD:refs/heads/feat/20261110-x-s0',
  'git commit -m "fix: x"',
  'git commit -am "fix"',
  'git add -A',
  'git restore --staged .',
  'git checkout -b feat/y',
  'git branch -d merged-branch',
  'gh pr create --title x --body y',
  'gh pr merge 3 --auto --squash',
  'gh pr view 3',
  'gh api repos/o/r/pulls',
  'gh auth status',
  'node scripts/harness.ts check',
  'pnpm test',
  'cat .env.example',
  'ls -la .env',
  'rm -rf /tmp/harness-x',
  'truncate -s 0 app.log',
  'echo "UPDATE users SET a=1 WHERE id=2" > q.sql',
  'cat > migrations/001.sql <<EOF\nDROP TABLE old;\nEOF',
];

test('금지 명령은 해당 규칙으로 차단된다', () => {
  for (const [cmd, rule] of BLOCK) {
    const r = bash(cmd);
    assert.ok(r, `차단되어야 한다: ${cmd}`);
    assert.ok(r!.rule.startsWith(rule), `${cmd} → ${r!.rule} (기대 ${rule})`);
    assert.ok(r!.how.length > 0 && r!.doc.length > 0, '메시지에 고치는 법과 근거가 있어야 한다');
  }
});

test('일상 명령은 허용된다', () => {
  for (const cmd of ALLOW) {
    const r = bash(cmd);
    assert.equal(r, null, `허용되어야 한다: ${cmd} → ${r?.rule}: ${r?.what}`);
  }
});

test('PowerShell 방언으로도 금지 명령을 막는다(ADR-0005)', () => {
  const psb = (command: string) =>
    evaluate({ kind: 'bash', command, cwd: '/work/repo', dialects: ['powershell'] }, ctx());
  const block: [string, string][] = [
    ['git push --force origin feat/x', 'R14'],
    ['gh pr review 3 --approve', 'R20'],
    ['git.exe push origin main', 'R2'],
    ['& "C:\\Program Files\\Git\\cmd\\git.exe" reset --hard', 'R14'],
    ['Get-Content .env', 'R10'],
  ];
  for (const [c, rule] of block) {
    const r = psb(c);
    assert.ok(r?.rule.startsWith(rule), `${c} → ${r?.rule} (기대 ${rule})`);
  }
  for (const c of ['git status', 'node scripts/harness.ts check', 'Get-ChildItem -Force']) {
    assert.equal(psb(c), null, c);
  }
});

test('Windows 차단 규칙: 재귀 삭제(R14), 자격 증명 저장소·토큰 변수(R20) (ADR-0005)', () => {
  const wctx = ctx({
    repo: {
      root: '/work/repo',
      gitDir: '/work/.git/worktrees/repo',
      commonDir: '/work/.git',
      mainRoot: '/work/main',
      isMainCheckout: false,
      branch: 'feat/20261111-x-s0',
    },
  });
  const run = (command: string, dialect: 'posix' | 'powershell') =>
    evaluate({ kind: 'bash', command, cwd: '/work/repo', dialects: [dialect] }, wctx);
  const BLOCK_PS: [string, string][] = [
    ['Remove-Item -Recurse -Force ~', 'R14'],
    ['Remove-Item -Path ../.. -Recurse', 'R14'],
    ['ri -r -fo ../other', 'R14'],
    ['Remove-Item -Recurse $env:TEMP/x', 'R14'],
    ['Remove-Item -Recurse -Force $env:USERPROFILE', 'R14'],
    ['Get-ChildItem ../other | Remove-Item -Recurse -Force', 'R14'],
    ['del /s /q ../other', 'R14'],
    ['cmdkey /list', 'R20'],
    ['vaultcmd /listcreds:"Windows Credentials"', 'R20'],
    ['Get-StoredCredential -Target git:https://github.com', 'R20'],
    ['git-credential-manager get', 'R20'],
    ['[Windows.Security.Credentials.PasswordVault]::new().RetrieveAll()', 'R20'],
    ['Get-Content "$env:APPDATA\\GitHub CLI\\hosts.yml"', 'R20'],
    ['type "C:\\Users\\me\\AppData\\Roaming\\GitHub CLI\\hosts.yml"', 'R20'],
    ['Copy-Item C:\\Users\\me\\AppData\\Local\\Microsoft\\Credentials\\ABC x', 'R20'],
    ['$env:GH_TOKEN = "ghp_x"', 'R20'],
    ['$env:GH_TOKEN=$null', 'R20'],
    ['${env:GITHUB_TOKEN} = "x"', 'R20'],
    ['Remove-Item Env:GH_TOKEN', 'R20'],
    ['Remove-Item -Path Env:\\GITHUB_TOKEN', 'R20'],
    ['[Environment]::SetEnvironmentVariable("GH_TOKEN", $null)', 'R20'],
  ];
  for (const [c, rule] of BLOCK_PS) {
    const r = run(c, 'powershell');
    assert.ok(r?.rule.startsWith(rule), `[powershell] ${c} → ${r?.rule} (기대 ${rule})`);
  }
  const BLOCK_POSIX: [string, string][] = [
    ['cmd /c "rd /s /q %USERPROFILE%"', 'R14'],
    ['cmd /c "rmdir /S /Q ..\\..\\.."', 'R14'],
    ['cmd /c "set GH_TOKEN=x && gh pr list"', 'R20'],
    ['setx GH_TOKEN abc', 'R20'],
    ['gh_token=x gh pr list', 'R20'],
    ['cat ~/AppData/Roaming/GitHub\\ CLI/hosts.yml', 'R20'],
    ['powershell -Command "Remove-Item Env:GH_TOKEN"', 'R20'],
  ];
  for (const [c, rule] of BLOCK_POSIX) {
    const r = run(c, 'posix');
    assert.ok(r?.rule.startsWith(rule), `[posix] ${c} → ${r?.rule} (기대 ${rule})`);
  }
  const ALLOW_PS = [
    'Remove-Item -Recurse -Force ./build',
    'Remove-Item -Recurse build, dist',
    'del file.txt',
    'rd /s /q build',
    'echo $env:GH_TOKEN',
    'Get-Content README.md',
    'Get-ChildItem Env:',
    'git status',
  ];
  for (const c of ALLOW_PS) {
    const r = run(c, 'powershell');
    assert.equal(r, null, `[powershell] 허용되어야 한다: ${c} → ${r?.rule}: ${r?.what}`);
  }
  assert.equal(run('rmdir -p a/b', 'posix'), null, 'POSIX rmdir(빈 폴더)는 허용');
});

test('파일 도구도 Windows 자격 증명 경로를 막는다', () => {
  for (const f of [
    'C:\\Users\\me\\AppData\\Roaming\\GitHub CLI\\hosts.yml',
    'C:\\Users\\me\\AppData\\Local\\Microsoft\\Vault\\x\\Policy.vpol',
    '/Users/someone/library/keychains/login.keychain-db',
  ]) {
    const r = evaluate({ kind: 'read', files: [f], cwd: '/work/repo' }, ctx());
    assert.ok(r?.rule.startsWith('R20'), `${f} → ${r?.rule}`);
  }
  const s = JSON.parse(readFileSync(path.join(HARNESS_ROOT, '.claude/settings.json'), 'utf8'));
  assert.ok(s.permissions.deny.includes('Read(~/AppData/Roaming/GitHub CLI/**)'));
});

test('셸 래퍼·대소문자·확장자로 감싸도 막는다', () => {
  const enc = Buffer.from('gh auth token', 'utf16le').toString('base64');
  const block: [string, string][] = [
    ['powershell -Command "gh pr review 1 --approve"', 'R20'],
    ['pwsh -c "git push -f origin x"', 'R14'],
    ['cmd /c "git push --force origin x"', 'R14'],
    [`powershell -enc ${enc}`, 'R20'],
    ['git.exe push --force origin x', 'R14'],
    ['GIT push origin main', 'R2'],
    ['/usr/local/bin/GH.EXE auth token', 'R20'],
    ['cat .ENV', 'R10'],
  ];
  for (const [c, rule] of block) {
    const r = bash(c);
    assert.ok(r?.rule.startsWith(rule), `${c} → ${r?.rule} (기대 ${rule})`);
  }
});

test('normalize: 도구·플랫폼별로 셸 방언을 고른다', () => {
  const n = (tool: string, platform: NodeJS.Platform) =>
    normalize({ tool_name: tool, tool_input: { command: 'git status' }, cwd: '/w' }, platform)
      ?.dialects;
  assert.deepEqual(n('PowerShell', 'win32'), ['powershell']);
  assert.deepEqual(n('Bash', 'win32'), ['posix']);
  assert.deepEqual(n('shell', 'win32'), ['posix', 'powershell']);
  assert.deepEqual(n('exec_command', 'darwin'), ['posix']);
  assert.deepEqual(n('Bash', 'darwin'), ['posix']);
});

test('훅 matcher가 Claude Code PowerShell 도구를 포함한다', () => {
  const s = JSON.parse(readFileSync(path.join(HARNESS_ROOT, '.claude/settings.json'), 'utf8'));
  assert.match(s.hooks.PreToolUse[0].matcher, /(^|\|)PowerShell(\||$)/);
  const runner = JSON.parse(
    readFileSync(path.join(HARNESS_ROOT, '.claude/runner-settings.json'), 'utf8'),
  );
  assert.ok(
    runner.permissions.deny.includes('PowerShell'),
    'runner는 PowerShell 도구를 쓰지 않는다',
  );
  assert.match(
    readFileSync(path.join(HARNESS_ROOT, 'scripts/runner/agents.ts'), 'utf8'),
    /matcher: '[^']*PowerShell/,
  );
});

test('main 체크아웃에 있으면 인자 없는 git push도 막는다', () => {
  const c = ctx({
    repo: {
      root: '/w',
      gitDir: '/w/.git',
      commonDir: '/w/.git',
      mainRoot: '/w',
      isMainCheckout: true,
      branch: 'main',
    },
  });
  assert.equal(bash('git push', c, '/w')?.rule.startsWith('R2'), true);
});

test('파일 도구: main 체크아웃·worktree 밖·계획 없음·.env·자격증명', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const mainInfo = repoInfo(main);
  const base = {
    dbPatterns: [],
    dbClients: [],
    hasPlan: (r: string, id: string) => findPlan(r, id) !== null,
    hasCommits: true,
  };
  const w = (file: string, c: GuardContext, cwd: string) =>
    evaluate({ kind: 'write', files: [file], cwd }, c);

  assert.match(w(path.join(main, 'src/a.ts'), { ...base, repo: mainInfo }, main)!.rule, /^R3/);
  // 부트스트랩(첫 커밋 전)은 허용
  assert.equal(
    w(path.join(main, 'src/a.ts'), { ...base, repo: mainInfo, hasCommits: false }, main),
    null,
  );

  const wt = path.join(dir, 'wt');
  sh('git', ['worktree', 'add', '-q', '-b', 'feat/20261111-demo-s0', wt], main);
  const wtInfo = repoInfo(wt);
  const c = { ...base, repo: wtInfo };
  assert.match(w(path.join(wt, 'src/a.ts'), c, wt)!.rule, /^R1/, '계획이 없으면 R1');
  assert.equal(
    w(path.join(wt, 'docs/exec-plans/active/20261111-demo/plan.md'), c, wt),
    null,
    '계획 파일은 쓸 수 있다',
  );
  write(wt, 'docs/exec-plans/active/20261111-demo/plan.md', '---\nid: 20261111-demo\n---\n');
  assert.equal(w(path.join(wt, 'src/a.ts'), c, wt), null, '계획이 있으면 허용');
  assert.match(w('/opt/elsewhere/x.ts', c, wt)!.rule, /^R3/, 'worktree 밖');
  const rm = (cmd: string) => evaluate({ kind: 'bash', command: cmd, cwd: wt }, c);
  assert.equal(rm('rm -rf node_modules dist'), null, 'worktree 안 정리는 허용');
  // 따옴표로 감싼다. 따옴표 없는 Windows 경로(C:\…)는 bash에서 역슬래시가 풀려 다른 경로가 된다
  assert.match(rm(`rm -rf '${wt}'`)!.rule, /^R14/, '임시 폴더 안 리포라도 루트 삭제는 막는다');
  assert.match(rm('rm -rf .git')!.rule, /^R14/);
  assert.match(rm('rm -rf ..')!.rule, /^R14/);
  assert.equal(w('/tmp/scratch.txt', c, wt), null, '임시 폴더는 허용');
  assert.match(
    evaluate({ kind: 'read', files: [path.join(wt, '.env')], cwd: wt }, c)!.rule,
    /^R10/,
  );
  assert.equal(
    evaluate({ kind: 'read', files: [path.join(wt, '.env.example')], cwd: wt }, c),
    null,
  );

  const other = path.join(dir, 'wt2');
  sh('git', ['worktree', 'add', '-q', '-b', 'random-branch', other], main);
  assert.match(
    w(path.join(other, 'a.ts'), { ...base, repo: repoInfo(other) }, other)!.rule,
    /^R1/,
    '규칙 밖 브랜치 이름',
  );
});

test('파일 도구: main 체크아웃의 대화 세션은 자기 소유 작업 worktree만 고친다 (Issue #16)', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const wtRoot = path.join(dir, 'repo.worktrees');
  const mk = (branch: string, owner: string | null): string => {
    const wt = path.join(wtRoot, ...branch.split('/'));
    sh('git', ['worktree', 'add', '-q', '-b', branch, wt], main);
    const id = /\/(\d{8}-[a-z0-9-]+?)(?:-s\d+)?$/.exec(branch)?.[1];
    if (owner !== null && id)
      write(
        wt,
        `docs/exec-plans/active/${id}/plan.md`,
        `---\nid: ${id}\nowner: ${owner} # 주석\n---\n`,
      );
    return wt;
  };
  const mine = mk('fix/20261112-mine-s0', 'session');
  const runner = mk('feat/20261112-other-s0', 'runner-1');
  const noPlan = mk('feat/20261112-noplan-s0', null);
  const odd = mk('random-branch', null);
  // 테스트 폴더가 임시 폴더 안이라 임시 폴더 허용을 끈다
  const at = (cwd: string, worker = 'session'): GuardContext => ({
    ...buildContext(cwd, worker),
    tmpDirs: [],
    home: HOME,
  });
  const w = (file: string, cwd: string, worker?: string) =>
    evaluate({ kind: 'write', files: [file], cwd }, at(cwd, worker));

  // main 체크아웃 세션 → 자기 소유 worktree: 코드·계획 모두 허용 (EnterWorktree 불필요)
  assert.equal(w(path.join(mine, 'src/a.ts'), main), null);
  assert.equal(w(path.join(mine, 'docs/exec-plans/active/20261112-mine/step0.md'), main), null);
  // 작업자 이름이 다르면 자기 것이 아니다
  assert.match(w(path.join(mine, 'src/a.ts'), main, 'mac-session')!.rule, /^R3/);
  // 다른 작업자(runner) worktree는 막는다
  const r = w(path.join(runner, 'src/a.ts'), main)!;
  assert.match(r.rule, /^R3/);
  assert.match(r.what, /runner-1/);
  // 계획(owner)을 알 수 없거나 규칙 밖 브랜치면 막는다(fail-closed)
  assert.match(w(path.join(noPlan, 'src/a.ts'), main)!.rule, /^R3/);
  assert.match(w(path.join(noPlan, 'docs/exec-plans/active/x.md'), main)!.rule, /^R3/);
  assert.match(w(path.join(odd, 'a.ts'), main)!.rule, /^R3/);
  // main 체크아웃 자체는 여전히 막는다
  assert.match(w(path.join(main, 'src/a.ts'), main)!.rule, /^R3/);
  // worktree 안의 세션: 자기 worktree는 허용, 다른 worktree·main 체크아웃은 막는다
  assert.equal(w(path.join(mine, 'src/a.ts'), mine), null);
  const cross = w(path.join(runner, 'src/a.ts'), mine)!;
  assert.match(cross.rule, /^R3/);
  assert.match(cross.what, /다른 작업 worktree/);
  assert.match(w(path.join(main, 'src/a.ts'), mine)!.what, /main 체크아웃/);
  // 다른 리포와 리포 밖 경로는 지금처럼 막는다
  const elsewhere = path.join(dir, 'elsewhere');
  gitInit(elsewhere);
  assert.match(w(path.join(elsewhere, 'a.ts'), main)!.rule, /^R3/);
  assert.match(w(path.join(dir, 'loose', 'a.ts'), main)!.rule, /^R3/);
  // 사용자 환경 파일은 "리포 밖"이라고 알리고 사용자가 직접 실행할 명령을 안내하게 한다(step4)
  const zshrc = w(`${HOME}/.zshrc`, main)!;
  assert.match(zshrc.rule, /^R3/);
  assert.match(zshrc.what, /리포 밖 파일/);
  assert.match(zshrc.how, /! <명령>/);
  assert.doesNotMatch(zshrc.how, /현재 worktree 안의 파일만/);
});

// ---- 실제 프로세스: stdin JSON → 종료 코드 2 (13.1절: 경고만 하고 통과시키지 않는지) ----

function runGuard(payload: unknown): { code: number; stderr: string } {
  const r = runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/hooks/guard.ts')], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  return { code: r.code, stderr: r.stderr };
}

test('guard 프로세스: Claude Code 형식에서 차단은 종료 코드 2, 허용은 0', () => {
  const cwd = tmp();
  const block = runGuard({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'gh pr review 7 --approve' },
    cwd,
  });
  assert.equal(block.code, 2);
  assert.match(block.stderr, /R20/);
  assert.match(block.stderr, /고치는 법/);
  assert.equal(runGuard({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd }).code, 0);
  assert.equal(
    runGuard({ tool_name: 'Read', tool_input: { file_path: path.join(cwd, '.env') }, cwd }).code,
    2,
  );
});

test('guard 프로세스: main 체크아웃 세션이 자기 worktree에 쓰면 0, 다른 worktree 세션이 쓰면 2', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const mine = path.join(dir, 'wt', 'mine');
  const other = path.join(dir, 'wt', 'other');
  sh('git', ['worktree', 'add', '-q', '-b', 'fix/20261112-mine-s0', mine], main);
  sh('git', ['worktree', 'add', '-q', '-b', 'fix/20261112-other-s0', other], main);
  write(mine, 'docs/exec-plans/active/20261112-mine/plan.md', '---\nowner: session\n---\n');
  write(other, 'docs/exec-plans/active/20261112-other/plan.md', '---\nowner: session\n---\n');
  const env = { ...process.env };
  delete env.HARNESS_WORKER;
  const run = (cwd: string, file: string) =>
    runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/hooks/guard.ts')], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: file }, cwd }),
      env,
    });
  assert.equal(run(main, path.join(mine, 'src/a.ts')).code, 0);
  const cross = run(mine, path.join(other, 'src/a.ts'));
  assert.equal(cross.code, 2, '임시 폴더 안이어도 같은 리포의 다른 worktree는 막는다');
  assert.match(cross.stderr, /R3/);
});

test('guard 프로세스: Codex 형식(command 배열, apply_patch)도 처리한다', () => {
  const cwd = tmp();
  const r = runGuard({
    tool_name: 'shell',
    tool_input: { command: ['bash', '-lc', 'git push origin main'] },
    cwd,
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /R2/);
  const patch = '*** Begin Patch\n*** Add File: .env\n+X=1\n*** End Patch';
  assert.equal(runGuard({ tool_name: 'apply_patch', tool_input: { input: patch }, cwd }).code, 2);
});

test('guard 프로세스: 입력이 깨지면 안전을 위해 차단한다(fail-closed)', () => {
  const r = runGuard('{not json');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /fail-closed/);
});

// ---------- 검사 출력 가림·실패 뒤 진행 (Issue #78 step1, TD-29) ----------

const CHECK = 'node scripts/harness.ts check';
const SEQ_BLOCK: string[] = [
  `${CHECK} 2>&1 | tail -1 && git push origin feat/x`,
  `${CHECK} | tail -3`,
  `${CHECK} |& tee check.log`,
  `node scripts/harness.ts test | grep -c ok`,
  `cd /work/wt && ${CHECK} 2>&1 | tail -1`,
  `${CHECK}; node scripts/harness.ts complete-step`,
  `${CHECK}\ngh pr create --draft --title x --body y`,
  `${CHECK} || true; git push origin feat/x`,
  `${CHECK} && echo ok; git push origin feat/x`,
  `${CHECK} & git push origin feat/x`,
  `${CHECK}; gh pr ready 12`,
  `${CHECK}; node scripts/harness.ts pr-ready`,
  `(cd /work/wt && ${CHECK}); git -C /work/wt push origin feat/x`,
  `HARNESS_WORKER=mac node /work/wt/scripts/harness.ts check ; git push origin feat/x`,
  // set -e가 있어도 파이프는 실패를 가린다
  `set -e\n${CHECK} | tail -1\ngit push origin feat/x`,
];
const SEQ_ALLOW: string[] = [
  `${CHECK} && node scripts/harness.ts complete-step && git push origin feat/x`,
  `${CHECK} > check.log 2>&1 && git push origin feat/x`,
  `cd /work/wt && ${CHECK} > /tmp/c.log 2>&1 && echo OK; tail -3 /tmp/c.log`,
  `set -o pipefail; ${CHECK} | tail -5`,
  `set -eo pipefail\n${CHECK} | tail -5\ngit push origin feat/x`,
  `set -o pipefail; ${CHECK} 2>&1 | tail -5 && git push origin feat/x`,
  `set -e\n${CHECK}\ngit push origin feat/x`,
  `(cd /work/wt && ${CHECK}) && git -C /work/wt push origin feat/x`,
  'git push origin feat/x',
  'ls; git push origin feat/x',
  'git log --oneline | head -3',
  'node scripts/harness.ts doc-lint | tail -3',
  `${CHECK}; tail -3 check.log`,
  'node scripts/harness.ts complete-step; git push origin feat/x',
  `echo "${CHECK} | tail -1"`,
];

test('검사 출력을 파이프로 가리거나 실패를 보지 않고 완료 처리·push로 이어지면 R4로 막는다', () => {
  for (const cmd of SEQ_BLOCK) {
    const p = bash(cmd);
    assert.ok(p, `차단되어야 한다: ${cmd}`);
    assert.match(p.rule, /^R4/, `${cmd} → ${p.rule}`);
    assert.match(p.how, /check\.log|pipefail|&&/, cmd);
  }
});

test('검사 결과를 종료 코드로 잇는 명령과 검사 명령이 없는 명령은 허용한다', () => {
  for (const cmd of SEQ_ALLOW) assert.equal(bash(cmd), null, `허용되어야 한다: ${cmd}`);
});

test('검사 순서 규칙은 POSIX 방언에만 적용한다', () => {
  const cmd = `${CHECK}; git push origin feat/x`;
  assert.equal(
    evaluate({ kind: 'bash', command: cmd, cwd: '/w', dialects: ['powershell'] }, ctx()),
    null,
  );
});

// ---------- 승인 요청 뒤 push·초안 해제 (Issue #78 step2) ----------

test('승인 요청 규칙: gh pr ready 직접 실행, 승인 요청 뒤 push, 위험도 높음의 초안 아닌 PR 생성을 막는다', () => {
  const seen: [string, string | null][] = [];
  // 훅은 -C 경로를 절대 경로로 바꿔 넘긴다. Windows에서는 드라이브 문자가 붙는다(Issue #99)
  const asked = path.resolve('/work/asked');
  const c = ctx({
    approvalPending: (dir, branch) => {
      seen.push([dir, branch]);
      if (branch === 'feat/20261115-asked-s0') return 2;
      if (branch === 'feat/20261115-merged-s0') return 0;
      if (branch === null && dir === asked) return 1;
      return null;
    },
    planRisk: (_dir, branch) => (branch === 'feat/20261115-high-s0' ? 'high' : 'normal'),
  });
  const blocked = (cmd: string, re: RegExp) => {
    const p = bash(cmd, c);
    assert.ok(p, `차단되어야 한다: ${cmd}`);
    assert.match(p.rule, /^승인 요청/, cmd);
    assert.match(p.how, re, cmd);
  };
  blocked('gh pr ready 12', /pr-ready/);
  blocked('gh pr ready --undo 12', /pr-ready --undo/);
  blocked('git push origin feat/20261115-asked-s0', /pr-ready --undo/);
  blocked('git push -u origin feat/20261115-asked-s0:feat/20261115-asked-s0', /제작자/);
  blocked('git -C /work/asked push', /pr-ready --undo/);
  blocked('git -C /work/asked push origin HEAD', /pr-ready --undo/);
  blocked('gh pr create --head feat/20261115-high-s0 --title x --body y', /--draft/);
  blocked('gh pr create -H feat/20261115-high-s0 --title x --body y', /--draft/);
  // main 병합 커밋만 더한 push, 표시가 없는 브랜치, 초안 PR, 위험도 보통은 허용한다
  assert.equal(bash('git push origin feat/20261115-merged-s0', c), null);
  assert.equal(bash('git push origin feat/20261115-free-s0', c), null);
  assert.equal(bash('gh pr create --draft --head feat/20261115-high-s0 --title x', c), null);
  assert.equal(bash('gh pr create -d -H feat/20261115-high-s0 --title x', c), null);
  assert.equal(bash('gh pr create --head feat/20261115-free-s0 --title x --body y', c), null);
  assert.equal(bash('node scripts/harness.ts pr-ready', c), null);
  assert.equal(bash('gh pr view 12', c), null);
  // 기존 규칙이 먼저다: force push는 R14, main push는 R2
  assert.match(bash('git push -f origin feat/20261115-asked-s0', c)!.rule, /^R14/);
  assert.match(bash('git push origin main', c)!.rule, /^R2/);
  // -C가 있으면 그 폴더 기준으로 조회한다
  assert.ok(seen.some(([d, b]) => d === asked && b === null));
  // 조회 함수가 없는 문맥(다른 도구·테스트)에서는 push·PR 생성을 막지 않는다
  assert.equal(bash('git push origin feat/20261115-asked-s0'), null);
  assert.equal(bash('gh pr create --head feat/20261115-high-s0 --title x --body y'), null);
});

test('승인 요청 규칙: 실제 worktree의 표시와 계획 위험도로 판정한다', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  write(main, 'README.md', 'x');
  commitAll(main);
  const branch = 'feat/20261115-asked-s0';
  const wt = path.join(dir, 'repo.worktrees', 'asked');
  sh('git', ['worktree', 'add', '-q', '-b', branch, wt], main);
  write(
    wt,
    'docs/exec-plans/active/20261115-asked/plan.md',
    '---\nid: 20261115-asked\nowner: session\nrisk: high # 주석\n---\n',
  );
  const asked = commitAll(wt, 'plan');
  const c = buildContext(main);
  const run = (cmd: string) => evaluate({ kind: 'bash', command: cmd, cwd: main }, c);
  // 표시가 없으면 push를 막지 않는다. 위험도 높음은 초안으로만 PR을 연다
  assert.equal(run(`git push origin ${branch}`), null);
  assert.match(run(`gh pr create --head ${branch} --title x --body y`)!.rule, /^승인 요청/);
  assert.equal(run(`gh pr create --draft --head ${branch} --title x --body y`), null);
  // 표시를 남긴 뒤: 새 커밋이 없으면 허용, 병합이 아닌 커밋을 더하면 막는다
  const gitDir = sh('git', ['rev-parse', '--absolute-git-dir'], wt);
  write(gitDir, 'harness/approval-requested', `${asked}\n`);
  assert.equal(run(`git push origin ${branch}`), null);
  write(wt, 'src/a.ts', 'export const a = 1;\n');
  commitAll(wt, 'extra');
  const p = run(`git push origin ${branch}`)!;
  assert.match(p.rule, /^승인 요청/);
  assert.match(p.what, /1개/);
  // 셸 명령에 넣는 경로는 `/`로 쓴다. Windows 경로의 `\`는 POSIX 셸에서 이스케이프다(Issue #99)
  const wtArg = wt.replaceAll('\\', '/');
  assert.match(run(`git -C ${wtArg} push origin HEAD`)!.rule, /^승인 요청/);
  // 인자 없는 push는 지금처럼 세션 위치(main) 기준으로 R2다
  assert.match(run(`git -C ${wtArg} push`)!.rule, /^R2/);
  // 다른 브랜치의 push는 영향을 받지 않는다
  assert.equal(run('git push origin feat/20261115-other-s0'), null);
});

test('승인 요청 규칙은 같은 명령 안의 금지 규칙(R…)을 가리지 않는다', () => {
  const c = ctx({ approvalPending: () => 3, planRisk: () => 'high' });
  assert.match(bash('gh pr ready 1; gh pr review 1 --approve', c)!.rule, /^R20/);
  assert.match(bash('git push origin feat/a; git push -f origin feat/b', c)!.rule, /^R14/);
  assert.match(bash('gh pr ready 1 && rm -rf $X', c)!.rule, /^R14/);
  assert.match(bash('gh pr ready 1', c)!.rule, /^승인 요청/);
});

// ---------- MCP 도구 규칙 (계획 20261116-ops-security step2, TD-13) ----------

const mcp = (tool: string, input: unknown = {}, c = ctx()) =>
  evaluate({ kind: 'mcp', tool, input, cwd: '/work/repo' }, c);
const mcpCfg = (over: Partial<McpGuardConfig>) =>
  ctx({ mcp: () => ({ ...DEFAULT_MCP_GUARD, ...over }) });
const GH = 'https://github.com/o/r/settings/branches';

const MCP_BLOCK: [string, unknown, string][] = [
  ['mcp__claude_ai_Gmail__trash_message', { messageId: 'm1' }, 'R14'],
  ['mcp__claude_ai_Gmail__delete_draft', { draftId: 'd1' }, 'R14'],
  ['mcp__claude_ai_Google_Drive__trash_file', { fileId: 'f1' }, 'R14'],
  ['mcp__claude_ai_Notion__notion-delete-pages', { page_ids: ['p1'] }, 'R14'],
  ['mcp__claude_ai_Google_Calendar__delete_event', { eventId: 'e1' }, 'R14'],
  ['mcp__claude_ai_Notion__notion-calendar-cancel-events', {}, 'R14'],
  ['mcp__claude_ai_Claude_Docs__delete', { id: 'x' }, 'R14'],
  // 대소문자 경계와 숫자 경계로도 단어를 나눈다
  ['mcp__files__deleteRecord', {}, 'R14'],
  ['mcp__files__HTMLPurge2', {}, 'R14'],
  ['mcp__claude_ai_Gmail__send_message', { to: 'a@example.com', body: 'x' }, 'R14'],
  ['mcp__claude_ai_Gmail__reply', { threadId: 't1' }, 'R14'],
  ['mcp__claude_ai_Gmail__forward', { messageId: 'm1' }, 'R14'],
  ['mcp__gmail__send_message', {}, 'R14'],
  ['mcp__claude-in-chrome__navigate', { url: GH, tabId: 1 }, 'R20'],
  ['mcp__claude-in-chrome__navigate', { url: 'github.com/o/r' }, 'R20'],
  ['mcp__claude-in-chrome__navigate', { url: 'HTTPS://GitHub.COM/login' }, 'R20'],
  ['mcp__claude-in-chrome__navigate', { url: 'https%3A%2F%2Fgithub.com%2Fo%2Fr' }, 'R20'],
  // 브라우저가 ASCII로 바꿔 여는 표기: 표의 마침표(U+3002), 반각 표의 마침표(U+FF61), 전각 글자와 전각 마침표
  ['mcp__claude-in-chrome__navigate', { url: 'https://github\u3002com/o/r' }, 'R20'],
  ['mcp__claude-in-chrome__navigate', { url: 'https://github\uff61com/o/r' }, 'R20'],
  [
    'mcp__claude-in-chrome__navigate',
    { url: 'https://\uff47\uff49\uff54\uff48\uff55\uff42\uff0e\uff43\uff4f\uff4d/o/r' },
    'R20',
  ],
  ['mcp__claude-in-chrome__navigate', { url: 'https%3A%2F%2Fgithub%E3%80%82com%2Fo' }, 'R20'],
  ['mcp__claude-in-chrome__tabs_create_mcp', { url: 'https://gist.github.com/x' }, 'R20'],
  ['mcp__playwright__browser_navigate', { url: 'https://github.com/o/r/pull/7' }, 'R20'],
  // 웹 편집기(github.dev)도 GitHub 로그인 세션으로 커밋한다
  ['mcp__playwright__browser_navigate', { url: 'https://github.dev/o/r' }, 'R20'],
  [
    'mcp__claude-in-chrome__javascript_tool',
    {
      action: 'javascript_exec',
      text: "fetch('https://api.github.com/repos/o/r/pulls/7/reviews', { method: 'POST' })",
    },
    'R20',
  ],
  ['mcp__playwright__browser_evaluate', { function: 'location = "https:\\/\\/github.com"' }, 'R20'],
  // 중첩된 입력
  [
    'mcp__claude-in-chrome__browser_batch',
    { actions: [{ name: 'navigate', input: { url: GH } }] },
    'R20',
  ],
  [
    'mcp__claude-in-chrome__computer',
    { action: 'type', text: 'github.com/settings/tokens' },
    'R20',
  ],
  ['mcp__remote-devices__Claude_Browser__navigate', { url: GH }, 'R20'],
  ['mcp__Claude_Browser__navigate', { url: GH }, 'R20'],
  ['mcp__computer-use__type', { text: 'https://github.com/settings/tokens' }, 'R20'],
];

const MCP_ALLOW: [string, unknown][] = [
  ['mcp__claude_ai_Gmail__search_threads', { query: 'from:someone delete trash' }],
  ['mcp__claude_ai_Gmail__create_draft', { to: 'a@example.com', body: 'https://github.com/o/r' }],
  ['mcp__claude_ai_Gmail__get_thread', { threadId: 't1' }],
  // 복구·해제는 삭제가 아니다: 단어 단위로 비교한다
  ['mcp__claude_ai_Gmail__untrash_message', { messageId: 'm1' }],
  ['mcp__claude_ai_Gmail__unlabel_message', { messageId: 'm1' }],
  ['mcp__claude_ai_Notion__notion-restore-pages', {}],
  ['mcp__claude_ai_Google_Drive__read_file_content', { fileId: 'f1' }],
  ['mcp__claude_ai_Google_Drive__create_file', { name: 'removed-items.txt' }],
  // 브라우저 도구가 아니면 입력의 GitHub 주소를 보지 않는다
  ['mcp__claude_ai_Notion__notion-create-pages', { pages: [{ content: `PR: ${GH}` }] }],
  ['mcp__claude_ai_Notion__notion-fetch', { id: 'https://github.com/o/r' }],
  ['mcp__claude_ai_Google_Calendar__create_event', { summary: 'x' }],
  // 서버 이름의 단어는 보지 않는다
  ['mcp__trash-tools__list_items', {}],
  ['mcp__claude-in-chrome__navigate', { url: 'https://docs.anthropic.com/en/docs', tabId: 1 }],
  ['mcp__claude-in-chrome__navigate', { url: 'https://notgithub.com/x' }],
  ['mcp__claude-in-chrome__navigate', { url: 'https://github.com.example.org/x' }],
  ['mcp__claude-in-chrome__computer', { action: 'screenshot', tabId: 1 }],
  ['mcp__claude-in-chrome__tabs_context_mcp', {}],
  ['mcp__claude-in-chrome__read_page', { tabId: 1, filter: 'interactive' }],
  ['mcp__playwright__browser_take_screenshot', { filename: 'shot.png' }],
  ['mcp__ide__getDiagnostics', {}],
];

test('MCP: 삭제 계열 도구·메일 발송은 R14, 브라우저 도구의 GitHub 주소는 R20으로 막는다', () => {
  for (const [tool, input, rule] of MCP_BLOCK) {
    const p = mcp(tool, input);
    assert.ok(p, `차단되어야 한다: ${tool} ${JSON.stringify(input)}`);
    assert.ok(p.rule.startsWith(`${rule} `), `${tool}: ${p.rule} ${p.what}`);
    assert.ok(p.how && p.doc, '고치는 법과 근거 문서가 있어야 한다');
  }
  assert.match(mcp('mcp__claude_ai_Gmail__send_message')!.how, /초안/);
  assert.match(mcp('mcp__claude_ai_Gmail__trash_message')!.what, /trash/);
  const gh = mcp('mcp__claude-in-chrome__navigate', { url: GH })!;
  assert.match(gh.what, /github\.com/);
  assert.match(gh.how, /gh/);
});

test('MCP: 읽기·검색·작성·복구와 GitHub이 아닌 브라우저 조작은 막지 않는다', () => {
  for (const [tool, input] of MCP_ALLOW) {
    const p = mcp(tool, input);
    assert.equal(p, null, `허용되어야 한다: ${tool} → ${p?.rule} ${p?.what}`);
  }
});

test('MCP: 해석하지 못한 호출은 막는다(입력이 객체가 아님, 브라우저 입력이 상한을 넘음)', () => {
  for (const bad of ['text', 3, ['a'], true])
    assert.ok(mcp('mcp__claude_ai_Gmail__search_threads', bad), `입력 ${JSON.stringify(bad)}`);
  let deep: unknown = { url: 'https://example.com' };
  for (let i = 0; i < 40; i++) deep = { next: deep };
  assert.match(mcp('mcp__claude-in-chrome__browser_batch', deep)!.rule, /^R20 /);
  const huge = { text: 'a '.repeat(1_100_000) };
  assert.match(mcp('mcp__claude-in-chrome__javascript_tool', huge)!.rule, /^R20 /);
  // 브라우저 도구가 아니면 입력을 들여다보지 않으므로 크기와 무관하다
  assert.equal(mcp('mcp__claude_ai_Notion__notion-create-pages', deep), null);
  assert.equal(mcp('mcp__claude_ai_Google_Drive__create_file', huge), null);
  // 긴 영숫자 입력도 바로 끝난다(호스트 찾기가 길이에 비례)
  const started = Date.now();
  assert.equal(
    mcp('mcp__claude-in-chrome__javascript_tool', { text: 'a'.repeat(1_500_000) }),
    null,
  );
  assert.ok(Date.now() - started < 5_000);
});

test('MCP 설정: allowTools는 삭제·발송 규칙의 예외이고, denyWords를 비우면 삭제 도구가 통과한다', () => {
  const allow = mcpCfg({ allowTools: ['mcp__*Gmail__delete_draft', 'mcp__claude-in-chrome__*'] });
  assert.equal(mcp('mcp__claude_ai_Gmail__delete_draft', {}, allow), null);
  assert.match(mcp('mcp__claude_ai_Gmail__trash_message', {}, allow)!.rule, /^R14 /);
  // 허용 목록은 브라우저의 GitHub 접근(R20)을 풀지 않는다
  assert.match(mcp('mcp__claude-in-chrome__navigate', { url: GH }, allow)!.rule, /^R20 /);
  const sendOk = mcpCfg({ allowTools: ['mcp__claude_ai_Gmail__send_message'] });
  assert.equal(mcp('mcp__claude_ai_Gmail__send_message', {}, sendOk), null);

  const noWords = mcpCfg({ denyWords: [] });
  assert.equal(mcp('mcp__claude_ai_Gmail__trash_message', {}, noWords), null);
  assert.match(mcp('mcp__claude_ai_Gmail__send_message', {}, noWords)!.rule, /^R14 /);
  const words = mcpCfg({ denyWords: ['Archive'] });
  assert.match(mcp('mcp__x__archive_thread', {}, words)!.rule, /^R14 /);
  assert.equal(mcp('mcp__x__trash_thread', {}, words), null);

  const hosts = mcpCfg({ denyHosts: ['example.com'], browserTools: ['mcp__mybrowser__*'] });
  assert.match(mcp('mcp__mybrowser__open', { url: 'https://example.com/a' }, hosts)!.rule, /^R20 /);
  assert.equal(mcp('mcp__mybrowser__open', { url: GH }, hosts), null);
  assert.equal(mcp('mcp__claude-in-chrome__navigate', { url: GH }, hosts), null);
});

test('normalize: mcp__ 도구는 입력의 command·cwd를 셸 명령으로 읽지 않는다', () => {
  const input = { command: 'rm -rf /', cwd: '/elsewhere', patch: '*** Begin Patch' };
  assert.deepEqual(normalize({ tool_name: 'mcp__x__run', tool_input: input, cwd: '/session' }), {
    kind: 'mcp',
    tool: 'mcp__x__run',
    input,
    cwd: '/session',
  });
  assert.deepEqual(normalize({ tool_name: 'mcp__x__list', cwd: '/session' })!.input, {});
  assert.equal(
    normalize({ tool_name: 'mcp__x__list', tool_input: 'oops', cwd: '/s' })!.input,
    'oops',
  );
});

test('훅 matcher가 MCP 도구(mcp__…)를 포함한다', () => {
  const s = JSON.parse(readFileSync(path.join(HARNESS_ROOT, '.claude/settings.json'), 'utf8'));
  const hooked = (tool: string) =>
    s.hooks.PreToolUse.some(
      (h: { matcher: string; hooks: { command: string }[] }) =>
        new RegExp(`^(?:${h.matcher})$`).test(tool) &&
        h.hooks.some((x) => x.command.includes('scripts/hooks/guard.ts')),
    );
  for (const tool of [
    'mcp__claude_ai_Gmail__trash_message',
    'mcp__claude-in-chrome__navigate',
    'mcp__playwright__browser_navigate',
    'Bash',
    'PowerShell',
    'Edit',
  ])
    assert.ok(hooked(tool), `${tool}이 훅을 거치지 않는다`);
});

test('guard 프로세스: MCP 호출의 차단은 종료 코드 2, 허용은 0', () => {
  const cwd = tmp();
  const call = (tool_name: string, tool_input: unknown) =>
    runGuard({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd });
  const trash = call('mcp__claude_ai_Gmail__trash_message', { messageId: 'm1' });
  assert.equal(trash.code, 2);
  assert.match(trash.stderr, /R14/);
  assert.match(trash.stderr, /고치는 법/);
  const nav = call('mcp__claude-in-chrome__navigate', { url: GH, tabId: 1 });
  assert.equal(nav.code, 2);
  assert.match(nav.stderr, /R20/);
  assert.equal(call('mcp__claude_ai_Gmail__search_threads', 'oops').code, 2);
  assert.equal(call('mcp__claude_ai_Gmail__search_threads', { query: 'x' }).code, 0);
});

test('guard 프로세스: MCP 규칙은 메인 체크아웃의 guard.mcp로 판정하고, 틀린 설정이면 MCP 호출만 막는다', () => {
  const dir = tmp();
  const main = path.join(dir, 'repo');
  gitInit(main);
  const put = (root: string, mcpCfg: unknown) =>
    write(root, 'harness.config.json', JSON.stringify({ guard: { mcp: mcpCfg } }));
  put(main, { allowTools: ['mcp__*Gmail__delete_draft'] });
  commitAll(main);
  const call = (cwd: string, tool_name: string, tool_input: unknown = {}) =>
    runGuard({ tool_name, tool_input, cwd });
  assert.equal(call(main, 'mcp__claude_ai_Gmail__delete_draft').code, 0);
  assert.equal(call(main, 'mcp__claude_ai_Gmail__trash_message').code, 2);

  // worktree에서 규칙을 풀어도(병합 전) 메인 체크아웃의 설정으로 판정한다
  const wt = path.join(dir, 'wt');
  sh('git', ['worktree', 'add', '-q', '-b', 'chore/20261116-relax-s0', wt], main);
  put(wt, { denyWords: [], denyTools: [] });
  assert.equal(call(wt, 'mcp__claude_ai_Gmail__trash_message').code, 2);
  assert.equal(call(wt, 'mcp__claude_ai_Gmail__send_message').code, 2);
  assert.equal(call(wt, 'mcp__claude_ai_Gmail__delete_draft').code, 0);

  put(main, { denyWords: 'delete' });
  const bad = call(main, 'mcp__claude_ai_Gmail__search_threads');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /guard\.mcp\.denyWords/);
  assert.equal(runGuard({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: main }).code, 0);
});
