// 세션 훅(SessionStart·Stop) 테스트 (Issue #78 step3). 알림용이라 어떤 경우에도 종료 코드 0이다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { describePr, handle, stopMessage, type SessionDeps } from '../hooks/session.ts';
import { runSync } from '../lib/exec.ts';
import { initFakeState } from '../lib/github-fake.ts';
import type { PullRequest } from '../lib/github.ts';
import { HARNESS_ROOT, makeFixture } from './helpers.ts';

const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 't',
  body: '',
  head: 'feat/20261115-x-s0',
  state: 'open',
  isDraft: false,
  labels: [],
  url: 'u',
  mergeState: 'BLOCKED',
  checks: 'success',
  failingChecks: [],
  ...over,
});

const deps = (over: Partial<SessionDeps> = {}): SessionDeps => ({
  env: {},
  runStart: () => '## ① 사람의 답을 기다리는 항목\n- 없음',
  listPRs: () => [],
  ...over,
});

test('describePr: 상태별로 무엇을 기다리는지와 누가 풀어야 하는지를 적는다', () => {
  assert.match(describePr(pr({ mergeState: 'DIRTY' })), /#7.*충돌.*봇/);
  assert.match(describePr(pr({ mergeState: 'BEHIND' })), /뒤처.*봇/);
  assert.match(
    describePr(pr({ checks: 'failure', failingChecks: ['risk-gate'] })),
    /승인 대기.*제작자/,
  );
  assert.match(
    describePr(pr({ checks: 'failure', failingChecks: ['check', 'risk-gate'] })),
    /체크 실패\(check, risk-gate\).*봇/,
  );
  assert.match(describePr(pr({ checks: 'pending' })), /진행 중.*CI/);
  assert.match(describePr(pr({ isDraft: true })), /초안.*봇/);
  assert.match(describePr(pr()), /병합 대기/);
  // 충돌·뒤처짐이 체크 상태보다 먼저다(봇이 먼저 풀어야 체크가 다시 돈다)
  assert.match(describePr(pr({ mergeState: 'DIRTY', checks: 'pending' })), /충돌/);
});

test('stopMessage: 열린 PR이 없으면 null, 있으면 PR마다 한 줄', () => {
  assert.equal(stopMessage([]), null);
  const m = stopMessage([pr(), pr({ number: 8, mergeState: 'DIRTY' })])!;
  assert.equal(m.split('\n').filter((l) => l.startsWith('- ')).length, 2);
  assert.match(m, /#8/);
});

test('SessionStart: 새 세션(startup)에서만 start 결과를 문맥으로 내보낸다', () => {
  let ran = 0;
  const d = deps({
    runStart: () => {
      ran++;
      return 'START-OUTPUT';
    },
  });
  const out = handle({ hook_event_name: 'SessionStart', source: 'startup', cwd: '/r' }, d);
  assert.match(out, /START-OUTPUT/);
  assert.match(out, /node scripts\/harness\.ts start/);
  assert.equal(ran, 1);
  for (const source of ['resume', 'clear', 'compact', 'fork', undefined]) {
    assert.equal(handle({ hook_event_name: 'SessionStart', source, cwd: '/r' }, d), '');
  }
  assert.equal(ran, 1);
});

test('SessionStart: start가 실패하면 직접 실행하라고 안내한다(세션은 막지 않는다)', () => {
  const out = handle(
    { hook_event_name: 'SessionStart', source: 'startup', cwd: '/r' },
    deps({
      runStart: () => {
        throw new Error('timeout');
      },
    }),
  );
  assert.match(out, /직접 실행/);
});

test('Stop: 대기 상태를 systemMessage로만 내보내고 종료를 막지 않는다', () => {
  const d = deps({ listPRs: () => [pr({ checks: 'failure', failingChecks: ['risk-gate'] })] });
  const out = JSON.parse(handle({ hook_event_name: 'Stop', cwd: '/r' }, d));
  assert.match(out.systemMessage, /#7.*승인 대기/);
  assert.deepEqual(Object.keys(out), ['systemMessage']);
  // 열린 PR이 없거나, 이미 stop 훅으로 이어지는 중이거나, 조회가 실패하면 아무것도 내보내지 않는다
  assert.equal(handle({ hook_event_name: 'Stop', cwd: '/r' }, deps()), '');
  assert.equal(handle({ hook_event_name: 'Stop', stop_hook_active: true, cwd: '/r' }, d), '');
  const broken = deps({
    listPRs: () => {
      throw new Error('gh 없음');
    },
  });
  assert.equal(handle({ hook_event_name: 'Stop', cwd: '/r' }, broken), '');
});

test('runner가 띄운 세션과 모르는 이벤트에서는 아무것도 하지 않는다', () => {
  let ran = 0;
  const d = deps({
    env: { HARNESS_SESSION: '1' },
    runStart: () => {
      ran++;
      return 'x';
    },
    listPRs: () => {
      ran++;
      return [pr()];
    },
  });
  assert.equal(handle({ hook_event_name: 'SessionStart', source: 'startup', cwd: '/r' }, d), '');
  assert.equal(handle({ hook_event_name: 'Stop', cwd: '/r' }, d), '');
  assert.equal(ran, 0);
  assert.equal(handle({ hook_event_name: 'PreToolUse', cwd: '/r' }, deps()), '');
  assert.equal(handle({}, deps()), '');
});

function runHook(
  payload: unknown,
  env: NodeJS.ProcessEnv,
  script = path.join(HARNESS_ROOT, 'scripts/hooks/session.ts'),
) {
  const clean = { ...process.env, ...env };
  delete clean.HARNESS_SESSION;
  if (env.HARNESS_SESSION) clean.HARNESS_SESSION = env.HARNESS_SESSION;
  return runSync(process.execPath, [script], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: clean,
  });
}

test('session 프로세스: 실제 start를 돌려 결과를 내보내고, Stop은 열린 PR을 알린다', () => {
  const fx = makeFixture();
  try {
    const state = path.join(fx.dir, 'gh.json');
    initFakeState(state, { remote: fx.remote, owner: 'maker', mergeMode: 'manual' });
    const env = { HARNESS_FAKE_GH: state, CLAUDE_PROJECT_DIR: fx.root };
    const script = path.join(fx.root, 'scripts/hooks/session.ts');
    const s = runHook(
      { hook_event_name: 'SessionStart', source: 'startup', cwd: fx.root },
      env,
      script,
    );
    assert.equal(s.code, 0);
    assert.match(s.stdout, /needs-human/);
    assert.match(s.stdout, /다음 할 일/);
    const none = runHook({ hook_event_name: 'Stop', cwd: fx.root }, env, script);
    assert.equal(none.code, 0);
    assert.equal(none.stdout, '');
    const st = JSON.parse(readFileSync(state, 'utf8'));
    st.prs.push({ ...pr({ mergeState: 'DIRTY' }), base: 'main', autoMerge: true });
    writeFileSync(state, JSON.stringify(st));
    const stop = runHook({ hook_event_name: 'Stop', cwd: fx.root }, env, script);
    assert.equal(stop.code, 0);
    assert.match(JSON.parse(stop.stdout).systemMessage, /#7.*충돌/);
  } finally {
    fx.cleanup();
  }
});

test('session 프로세스: 입력이 깨지거나 GitHub 조회가 실패해도 종료 코드 0, 출력 없음(fail-open)', () => {
  const env = { HARNESS_FAKE_GH: '/nonexistent/gh.json', CLAUDE_PROJECT_DIR: HARNESS_ROOT };
  for (const payload of ['not json', '', { hook_event_name: 'Stop', cwd: HARNESS_ROOT }]) {
    const r = runHook(payload, env);
    assert.equal(r.code, 0, String(payload));
    assert.equal(r.stdout, '');
  }
  const runner = runHook(
    { hook_event_name: 'SessionStart', source: 'startup', cwd: HARNESS_ROOT },
    { ...env, HARNESS_SESSION: '1' },
  );
  assert.equal(runner.code, 0);
  assert.equal(runner.stdout, '');
});

test('.claude/settings.json: 세션 훅을 더했고 PreToolUse·permissions는 그대로다', () => {
  const s = JSON.parse(readFileSync(path.join(HARNESS_ROOT, '.claude/settings.json'), 'utf8'));
  const cmd = 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/session.ts"';
  assert.equal(s.hooks.SessionStart[0].matcher, 'startup');
  assert.equal(s.hooks.SessionStart[0].hooks[0].command, cmd);
  assert.equal(s.hooks.Stop[0].hooks[0].command, cmd);
  for (const h of [s.hooks.SessionStart[0].hooks[0], s.hooks.Stop[0].hooks[0]]) {
    assert.equal(h.type, 'command');
    assert.ok(h.timeout > 0 && h.timeout <= 180);
  }
  // 불변식: 금지 훅과 권한은 이 step 전과 같다
  assert.deepEqual(s.hooks.PreToolUse, [
    {
      matcher: 'Bash|PowerShell|Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob',
      hooks: [
        {
          type: 'command',
          command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/guard.ts"',
          timeout: 30,
        },
      ],
    },
  ]);
  assert.deepEqual(s.permissions, {
    deny: [
      'Read(./.env)',
      'Read(./.env.*)',
      'Read(~/.config/gh/**)',
      'Read(~/AppData/Roaming/GitHub CLI/**)',
      'Read(~/.git-credentials)',
      'Bash(git push --force:*)',
      'Bash(git push -f:*)',
      'Bash(gh pr review --approve:*)',
      'Bash(gh auth token:*)',
    ],
  });
  assert.equal(s.disableBypassPermissionsMode, 'disable');
  assert.deepEqual(Object.keys(s.hooks).sort(), ['PreToolUse', 'SessionStart', 'Stop']);
});
