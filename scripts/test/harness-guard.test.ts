// harness-guard(10.3·10.4절, R9). 계획 20261114-ci-gates step2.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runGates } from '../ci/gates.ts';
import { harnessGuard } from '../gates/harness-guard.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const BODY = '## 자체 리뷰\n- [x] 보호 경로 변경: CHANGELOG 갱신, 검사를 약화하지 않음\n';
const LOG = 'docs/harness/CHANGELOG.md';
const WF = `name: w
on: pull_request
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo a
  b:
    runs-on: ubuntu-latest
    environment: recorder
    steps:
      - run: echo b
`;
const CLAUDE = {
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }] },
  permissions: { allow: ['Read'], deny: ['Bash(gh:*)', 'Read(./.env)'] },
  enableAllProjectMcpServers: false,
};
const CODEX = 'sandbox_mode = "workspace-write"\napproval_policy = "on-request"\n';
const CONFIG = () =>
  fixtureConfig({
    protectedPaths: [
      'scripts/**',
      '.github/**',
      '.claude/**',
      '.codex/**',
      '.gitignore',
      'harness.config.json',
      'docs/harness/**',
    ],
    commands: {
      setup: null,
      fmt: null,
      lint: null,
      test: { run: 'node --test', timeoutSec: 60 },
      build: null,
      dev: null,
      verify: null,
    },
  });

function repo(): { root: string; base: string; cfg: HarnessConfig } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(CONFIG(), null, 2));
  write(root, LOG, '# 이력\n');
  write(root, '.github/workflows/w.yml', WF);
  write(root, '.claude/settings.json', JSON.stringify(CLAUDE, null, 2));
  write(root, '.codex/config.toml', CODEX);
  write(root, '.codex/hooks.json', '{"hooks":{}}\n');
  write(root, '.gitignore', '.env\n.env.*\nnode_modules/\n');
  write(root, 'scripts/x.ts', 'export {}\n');
  write(root, 'src/a.ts', 'export {}\n');
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', 'feat/20261114-demo-s0'], root);
  return { root, base, cfg: loadConfig(root) };
}

/** 파일을 바꾸고(CHANGELOG 포함 여부 선택) 판정한다 */
function run(
  files: Record<string, string | null>,
  o: { log?: boolean; body?: string | null } = {},
): ReturnType<typeof harnessGuard> {
  const r = repo();
  for (const [f, c] of Object.entries(files)) {
    if (c === null) sh('git', ['rm', '-q', f], r.root);
    else write(r.root, f, c);
  }
  if (o.log ?? true) write(r.root, LOG, '# 이력\n- 변경\n');
  commitAll(r.root, 'change');
  return harnessGuard({ ...r, prBody: o.body === undefined ? BODY : o.body });
}

const reasons = (g: ReturnType<typeof harnessGuard>) => g.signals.map((s) => s.reason).join('\n');

test('보호 경로 변경이 없으면 통과, 신호 없음', () => {
  const g = run({ 'src/a.ts': 'export const a = 1\n' }, { log: false, body: null });
  assert.equal(g.result.state, 'success');
  assert.match(g.result.description, /보호 경로 변경 없음/);
  assert.deepEqual(g.signals, []);
});

test('보호 경로를 바꾸고 CHANGELOG·체크리스트가 있으면 통과', () => {
  const g = run({ 'scripts/x.ts': 'export const x = 1\n' });
  assert.equal(g.result.state, 'success', g.result.details.join('\n'));
  assert.deepEqual(g.signals, []);
});

test('CHANGELOG 누락, 체크리스트 누락·미체크는 실패, 본문을 못 읽으면 error', () => {
  const f = { 'scripts/x.ts': 'export const x = 1\n' };
  const noLog = run(f, { log: false });
  assert.equal(noLog.result.state, 'failure');
  assert.match(noLog.result.description, /CHANGELOG/);
  assert.equal(run(f, { body: '본문' }).result.state, 'failure');
  assert.equal(run(f, { body: '- [ ] 보호 경로 변경: 아직' }).result.state, 'failure');
  assert.equal(run(f, { body: null }).result.state, 'error');
});

test('워크플로 캐시 사용은 실패', () => {
  for (const add of [
    '      - uses: actions/cache@0000000000000000000000000000000000000000\n',
    '      - uses: actions/setup-node@x\n        with:\n          cache: pnpm\n',
  ]) {
    const g = run({ '.github/workflows/w.yml': WF + add });
    assert.equal(g.result.state, 'failure', add);
    assert.match(g.result.details.join('\n'), /캐시/);
  }
});

test('신호: 워크플로·job 삭제, environment 밖 참조, 새 write 권한', () => {
  assert.match(reasons(run({ '.github/workflows/w.yml': null })), /워크플로 삭제/);
  assert.match(
    reasons(run({ '.github/workflows/w.yml': WF.replace(/ {2}a:[\s\S]*?echo a\n/, '') })),
    /job 삭제.*a/,
  );
  assert.match(
    reasons(
      run({ '.github/workflows/w.yml': WF.replace('environment: recorder', 'environment: prod') }),
    ),
    /environment.*prod/,
  );
  assert.match(
    reasons(run({ '.github/workflows/w.yml': WF.replace('contents: read', 'contents: write') })),
    /write/,
  );
  // 허용 목록 안의 environment와 job 추가는 신호가 아니다
  const ok = run({
    '.github/workflows/w.yml':
      WF +
      '  c:\n    runs-on: ubuntu-latest\n    environment: revert\n    steps:\n      - run: echo c\n',
  });
  assert.deepEqual(ok.signals, []);
});

test('신호: harness.config.json의 판정 관련 키 변경(TD-10), 깨진 JSON', () => {
  const c = CONFIG() as Record<string, never>;
  const weak = {
    ...c,
    commands: { ...(c.commands as object), test: { run: 'true', timeoutSec: 60 } },
  };
  assert.match(reasons(run({ 'harness.config.json': JSON.stringify(weak, null, 2) })), /commands/);
  assert.match(
    reasons(run({ 'harness.config.json': JSON.stringify({ ...c, stage: 'operation' }, null, 2) })),
    /stage/,
  );
  assert.match(reasons(run({ 'harness.config.json': '{' })), /harness\.config\.json/);
  // 판정과 무관한 키(limits)는 신호가 아니다
  const lim = { ...c, limits: { ...(c.limits as object), pollSec: 5 } };
  assert.deepEqual(run({ 'harness.config.json': JSON.stringify(lim, null, 2) }).signals, []);
});

test('신호: Claude 설정의 allow 추가·deny 삭제·훅 변경·모드 완화', () => {
  const j = (o: object) => ({ '.claude/settings.json': JSON.stringify(o, null, 2) });
  const p = CLAUDE.permissions;
  assert.match(
    reasons(run(j({ ...CLAUDE, permissions: { ...p, allow: ['Read', 'Bash(curl:*)'] } }))),
    /allow 추가.*curl/,
  );
  assert.match(
    reasons(run(j({ ...CLAUDE, permissions: { ...p, deny: ['Read(./.env)'] } }))),
    /deny 삭제/,
  );
  assert.match(reasons(run(j({ ...CLAUDE, hooks: {} }))), /hooks/);
  assert.match(
    reasons(run(j({ ...CLAUDE, enableAllProjectMcpServers: true }))),
    /enableAllProjectMcpServers/,
  );
  assert.match(reasons(run(j({ ...CLAUDE, disableAllHooks: true }))), /disableAllHooks/);
  assert.match(
    reasons(run(j({ ...CLAUDE, permissions: { ...p, defaultMode: 'acceptEdits' } }))),
    /defaultMode/,
  );
  assert.match(reasons(run({ '.claude/settings.json': null })), /삭제/);
  // deny를 더하는 것은 신호가 아니다
  assert.deepEqual(
    run(j({ ...CLAUDE, permissions: { ...p, deny: [...p.deny, 'WebFetch'] } })).signals,
    [],
  );
});

test('신호: Codex 설정·훅, 위험 플래그, .gitignore의 .env', () => {
  const full = 'danger-' + 'full-access';
  assert.match(
    reasons(run({ '.codex/config.toml': CODEX.replace('workspace-write', full) })),
    /sandbox_mode/,
  );
  assert.match(
    reasons(run({ '.codex/config.toml': CODEX.replace('on-request', 'never') })),
    /approval_policy/,
  );
  assert.match(reasons(run({ '.codex/hooks.json': '{}\n' })), /\.codex\/hooks\.json/);
  const flag = '--dangerously-' + 'skip-permissions';
  assert.match(reasons(run({ 'scripts/x.ts': `export const a = '${flag}'\n` })), /위험 플래그/);
  assert.match(reasons(run({ '.gitignore': '.env.*\nnode_modules/\n' })), /\.gitignore.*\.env/);
});

test('runGates: 신호가 있으면 risk-gate가 높음 → 제작자 head 승인이 있어야 통과', () => {
  const r = repo();
  write(r.root, '.codex/config.toml', CODEX.replace('on-request', 'never'));
  write(r.root, LOG, '# 이력\n- 변경\n');
  const head = commitAll(r.root, 'change');
  const o = { ...r, branch: 'feat/20261114-demo-s0', headSha: head, prBody: BODY };
  const no = runGates({ ...o, reviews: [] });
  const get = (x: typeof no, c: string) => x.results.find((g) => g.context === c)!;
  assert.equal(get(no, 'harness-guard').state, 'success');
  assert.match(get(no, 'harness-guard').description, /신호 1건/);
  assert.equal(no.risk, 'high');
  assert.equal(get(no, 'risk-gate').state, 'failure');
  const yes = runGates({
    ...o,
    reviews: [{ user: 'maker', state: 'APPROVED', commitId: head, submittedAt: 't' }],
  });
  assert.equal(get(yes, 'risk-gate').state, 'success');
});
