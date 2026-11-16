// harness-guard(10.3·10.4절, R9). 계획 20261114-ci-gates step2.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { runGates, selfTestNeeded } from '../ci/gates.ts';
import { harnessGuard, reproJobViolations } from '../gates/harness-guard.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

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
  write(root, 'scripts/selftest/run.ts', 'export {}\n');
  write(root, 'scripts/selftest/scenarios/r1-plan-gate.ts', 'export default {}\n');
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

test('이 리포의 revert.yml을 더하는 PR: 캐시·environment 실패가 없고 신호도 없다', () => {
  const wf = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/revert.yml'), 'utf8');
  const g = run({ '.github/workflows/revert.yml': wf });
  assert.equal(g.result.state, 'success', g.result.details.join('\n'));
  // 정해 둔 environment(revert)만 참조하고 쓰기 권한을 더하지 않는다
  assert.deepEqual(g.signals, []);
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

// ---------- 자체 테스트 연결 (12.4절, 계획 20261116-ops-security step3) ----------

const SELFTEST_JOB = (extra: string, run = 'node base/scripts/harness.ts self-test --harness pr') =>
  WF +
  `  selftest:\n    runs-on: ubuntu-latest\n${extra}    steps:\n      - run: ${run}\n        env:\n          T: x\n`;

test('자체 테스트 job(PR 코드 실행)에 environment·비밀·쓰기 권한이 있으면 실패', () => {
  const ok = run({
    '.github/workflows/w.yml': SELFTEST_JOB('    permissions:\n      contents: read\n'),
  });
  assert.equal(ok.result.state, 'success', ok.result.details.join('\n'));
  const bad: [string, RegExp][] = [
    [
      '    permissions:\n      contents: read\n    environment: recorder\n',
      /selftest: environment/,
    ],
    ['    permissions:\n      contents: write\n', /selftest: 쓰기 권한/],
    ['', /selftest: job 권한을 적지 않았다/],
  ];
  for (const [extra, want] of bad) {
    const g = run({ '.github/workflows/w.yml': SELFTEST_JOB(extra) });
    assert.equal(g.result.state, 'failure', extra);
    assert.match(g.result.details.join('\n'), want);
    assert.match(g.result.details.join('\n'), /PR 코드를 실행하는 job/);
  }
  const secret = run({
    '.github/workflows/w.yml': SELFTEST_JOB('    permissions:\n      contents: read\n').replace(
      'T: x',
      'T: ${{ secrets.X }}',
    ),
  });
  assert.equal(secret.result.state, 'failure');
  assert.match(secret.result.details.join('\n'), /selftest: 비밀/);
  // job id가 달라도 self-test 명령을 실행하면 같은 조건이다
  const renamed = run({
    '.github/workflows/w.yml': SELFTEST_JOB(
      '    permissions:\n      contents: read\n    environment: recorder\n',
    ).replace('  selftest:', '  scenarios:'),
  });
  assert.match(renamed.result.details.join('\n'), /scenarios: environment/);
  // self-test를 실행하지 않는 다른 job의 environment는 그대로 둔다(job b)
  assert.doesNotMatch(ok.result.details.join('\n'), /b: environment/);
});

test('신호: base에 있던 자체 테스트 파일의 수정·삭제. 새 시나리오 추가는 신호가 아니다', () => {
  const edited = run({ 'scripts/selftest/scenarios/r1-plan-gate.ts': 'export default { a: 1 }\n' });
  assert.equal(edited.result.state, 'success', edited.result.details.join('\n'));
  assert.match(
    reasons(edited),
    /자체 테스트 파일 수정: scripts\/selftest\/scenarios\/r1-plan-gate\.ts/,
  );
  assert.match(
    reasons(run({ 'scripts/selftest/scenarios/r1-plan-gate.ts': null })),
    /자체 테스트 파일 삭제: scripts\/selftest\/scenarios\/r1-plan-gate\.ts/,
  );
  assert.match(
    reasons(run({ 'scripts/selftest/run.ts': 'export const weak = true\n' })),
    /자체 테스트 파일 수정: scripts\/selftest\/run\.ts/,
  );
  const added = run({ 'scripts/selftest/scenarios/new-one.ts': 'export default {}\n' });
  assert.equal(added.result.state, 'success');
  assert.deepEqual(added.signals, []);
});

test('selfTestNeeded: 보호 경로를 바꾼 PR만 true. 판단하지 못하면 true', () => {
  const r = repo();
  write(r.root, 'src/a.ts', 'export const a = 1\n');
  commitAll(r.root, 'src');
  assert.equal(selfTestNeeded(r), false);
  write(r.root, 'scripts/x.ts', 'export const x = 1\n');
  commitAll(r.root, 'scripts');
  assert.equal(selfTestNeeded(r), true);
  assert.equal(selfTestNeeded({ ...r, base: 'f'.repeat(40) }), true);
});

test('gates 명령: GITHUB_OUTPUT에 selftest=<true|false>를 쓴다', () => {
  const cli = (r: { root: string; base: string }) => {
    const dir = tmp();
    const output = path.join(dir, 'output');
    writeFileSync(output, '');
    const res = runSync(
      process.execPath,
      [
        path.join(HARNESS_ROOT, 'scripts/harness.ts'),
        'gates',
        '--repo',
        r.root,
        '--config-root',
        r.root,
        '--base',
        r.base,
        '--head-ref',
        'feat/20261114-demo-s0',
        '--out',
        path.join(dir, 'gates.json'),
      ],
      { cwd: r.root, env: { ...process.env, GITHUB_OUTPUT: output, GH_TOKEN: '' } },
    );
    assert.equal(res.code, 0, res.stderr);
    return readFileSync(output, 'utf8');
  };
  const src = repo();
  write(src.root, 'src/a.ts', 'export const a = 1\n');
  commitAll(src.root, 'src');
  assert.equal(cli(src), 'selftest=false\n');
  const prot = repo();
  write(prot.root, 'scripts/x.ts', 'export const x = 1\n');
  commitAll(prot.root, 'scripts');
  assert.equal(cli(prot), 'selftest=true\n');
});

test('이 리포의 gates.yml: selftest job은 base의 실행기로 PR의 하네스를 시험하고 environment·비밀·쓰기 권한·캐시가 없다', () => {
  const wf = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/gates.yml'), 'utf8');
  assert.deepEqual(reproJobViolations(wf), []);
  const job = (id: string) => {
    const m = new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|$)`).exec(wf);
    assert.ok(m, `${id} job이 없다`);
    return m[1];
  };
  const st = job('selftest');
  assert.match(st, /needs\.evaluate\.outputs\.selftest == 'true'/);
  assert.match(st, /node base\/scripts\/harness\.ts self-test --harness pr /);
  assert.doesNotMatch(st, /pr\/scripts\/harness\.ts/);
  assert.match(st, /^ {4}permissions:\n {6}contents: read\n {4}outputs:/m);
  assert.doesNotMatch(st, /environment:|secrets\.|vars\.|GH_TOKEN|github\.token|: write|cache/i);
  // PR 유래 값은 env로만 넘긴다
  assert.doesNotMatch(st, /run: \|[\s\S]*\$\{\{/);
  for (const m of st.matchAll(/persist-credentials: (\S+)/g)) assert.equal(m[1], 'false');
  assert.equal([...st.matchAll(/uses: actions\/checkout@/g)].length, 2);
  assert.equal([...st.matchAll(/persist-credentials:/g)].length, 2);
  // environment는 record job 하나에만 있고, record는 selftest의 결과와 무관하게 실행된다
  assert.equal([...wf.matchAll(/^\s*environment:/gm)].length, 1);
  const rec = job('record');
  assert.match(rec, /environment: recorder/);
  assert.match(rec, /needs: \[evaluate, selftest\]/);
  assert.match(rec, /if: \$\{\{ !cancelled\(\) && /);
  assert.match(rec, /SELFTEST_B64: \$\{\{ needs\.selftest\.outputs\.report \}\}/);
  assert.match(rec, /SELFTEST_NEEDED: \$\{\{ needs\.evaluate\.outputs\.selftest \}\}/);
  assert.match(rec, /--selftest-needed "\$SELFTEST_NEEDED"/);
  assert.doesNotMatch(rec, /path: pr\b/);
});

test('runGates: 신호가 있으면 risk-gate가 높음 → 제작자 head 승인이 있어야 통과', async () => {
  const r = repo();
  write(r.root, '.codex/config.toml', CODEX.replace('on-request', 'never'));
  write(r.root, LOG, '# 이력\n- 변경\n');
  const head = commitAll(r.root, 'change');
  const o = { ...r, branch: 'feat/20261114-demo-s0', headSha: head, prBody: BODY };
  const no = await runGates({ ...o, reviews: [] });
  const get = (x: typeof no, c: string) => x.results.find((g) => g.context === c)!;
  assert.equal(get(no, 'harness-guard').state, 'success');
  assert.match(get(no, 'harness-guard').description, /신호 1건/);
  assert.equal(no.risk, 'high');
  assert.equal(get(no, 'risk-gate').state, 'failure');
  const yes = await runGates({
    ...o,
    reviews: [{ user: 'maker', state: 'APPROVED', commitId: head, submittedAt: 't' }],
  });
  assert.equal(get(yes, 'risk-gate').state, 'success');
});
