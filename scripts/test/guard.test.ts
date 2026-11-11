// L1 훅 테스트(12.4절 R13·R20 시나리오 포함). 규칙 표 + 실제 프로세스 종료 코드 2 확인.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { repoInfo } from '../lib/git.ts';
import { findPlan } from '../lib/plan.ts';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { normalize } from '../hooks/guard.ts';
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
  assert.match(rm(`rm -rf ${wt}`)!.rule, /^R14/, '임시 폴더 안 리포라도 루트 삭제는 막는다');
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
