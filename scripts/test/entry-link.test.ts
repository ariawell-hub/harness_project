// 링크를 거친 경로로 불린 진입 스크립트(Issue #237). 리포를 링크한 폴더, macOS의 /tmp·/var 아래,
// Windows의 정션으로 열면 실행 경로(process.argv[1])가 링크를 푼 실제 경로와 달라진다. 그때도 L1 훅·세션 훅·
// verify 웹 구현이 직접 경로와 같게 돌아야 한다(아무것도 하지 않고 종료 코드 0으로 끝나면 훅이 꺼진 것과 같다).
// 이 파일은 하네스 모듈의 판정 함수를 import하지 않고 스크립트를 프로세스로만 부른다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { initFakeState } from '../lib/github-fake.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

/**
 * 리포를 가리키는 링크. Windows에서는 권한 없이 만들 수 있는 정션이고, macOS·Linux에서는 형식 인자를 무시하고
 * 심볼릭 링크다. 링크가 든 임시 폴더는 실제 경로로 풀지 않는다(macOS에서는 그 자체도 /var 링크를 거친다)
 */
function linkedRoot(): string {
  const link = path.join(mkdtempSync(path.join(tmpdir(), 'harness-entry-link-')), 'repo');
  symlinkSync(HARNESS_ROOT, link, 'junction');
  return link;
}

const bash = (command: string, cwd: string) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    cwd,
  });

function run(script: string, input: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return runSync(process.execPath, [script], { input, ...opts });
}

test('링크를 거친 경로로 불린 L1 훅이 직접 경로와 같게 막는다(금지 호출은 종료 코드 2, 허용 호출은 0)', () => {
  const guard = path.join(linkedRoot(), 'scripts', 'hooks', 'guard.ts');
  const cwd = tmp();
  const force = run(guard, bash('git push --force origin main', cwd));
  assert.equal(force.code, 2, `종료 코드가 2가 아니다(표준 오류: ${force.stderr})`);
  assert.match(force.stderr, /R14/);
  const approve = run(guard, bash('gh pr review 7 --approve', cwd));
  assert.equal(approve.code, 2, `종료 코드가 2가 아니다(표준 오류: ${approve.stderr})`);
  assert.match(approve.stderr, /R20/);
  const ls = run(guard, bash('ls', cwd));
  assert.equal(ls.code, 0, ls.stderr);
});

test('L1 훅 진입 파일은 직접 실행을 판정하지 않는다(import.meta.url·process.argv가 없다)', () => {
  const text = readFileSync(path.join(HARNESS_ROOT, 'scripts', 'hooks', 'guard.ts'), 'utf8');
  assert.doesNotMatch(text, /import\.meta\.url/);
  assert.doesNotMatch(text, /process\.argv/);
});

const CONFIG_OK = 'export class ConfigError extends Error {}\n';

/**
 * 진입 파일을 복사한 임시 폴더. 판정 모듈(scripts/hooks/decide.ts)과 설정 모듈(scripts/lib/config.ts)은
 * 주어진 글의 대역 파일로 두고, null이면 두지 않는다
 */
function entryOnly(files: { decide: string | null; config: string | null }): string {
  const dir = tmp();
  const guard = path.join(dir, 'scripts', 'hooks', 'guard.ts');
  mkdirSync(path.dirname(guard), { recursive: true });
  mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  copyFileSync(path.join(HARNESS_ROOT, 'scripts', 'hooks', 'guard.ts'), guard);
  if (files.decide !== null)
    writeFileSync(path.join(dir, 'scripts', 'hooks', 'decide.ts'), files.decide);
  if (files.config !== null)
    writeFileSync(path.join(dir, 'scripts', 'lib', 'config.ts'), files.config);
  return guard;
}

test('L1 훅 진입 파일이 판정 모듈을 불러오지 못하면 어떤 호출이든 종료 코드 2로 막는다(fail-closed)', () => {
  const cases: [string, { decide: string | null; config: string | null }][] = [
    ['모듈 없음', { decide: null, config: null }],
    // 진입 파일은 설정 모듈을 먼저 불러온다: 설정 모듈이 있어야 판정 모듈을 불러오는 자리에 닿는다
    ['판정 모듈만 없음(설정 모듈은 있음)', { decide: null, config: CONFIG_OK }],
    ['판정 모듈 문법 오류', { decide: 'export const = ;\n', config: CONFIG_OK }],
    [
      '판정 모듈이 불러올 때 Error를 던짐',
      { decide: "throw new Error('boom');\n", config: CONFIG_OK },
    ],
    ['판정 모듈이 불러올 때 null을 던짐', { decide: 'throw null;\n', config: CONFIG_OK }],
    ['판정 모듈이 불러올 때 문자열을 던짐', { decide: "throw 'boom';\n", config: CONFIG_OK }],
    ['판정 함수가 없음', { decide: 'export {};\n', config: CONFIG_OK }],
    ['설정 모듈이 불러올 때 null을 던짐', { decide: 'export {};\n', config: 'throw null;\n' }],
    [
      '판정 함수가 null을 던짐',
      { decide: 'export function decide(): never {\n  throw null;\n}\n', config: CONFIG_OK },
    ],
    // 오류 메시지를 만들다 다시 던질 자리: 설정 오류인지 가리는 instanceof, 던진 값을 글로 바꾸기
    [
      '설정 모듈의 ConfigError가 클래스가 아님',
      { decide: 'throw null;\n', config: 'export const ConfigError = null;\n' },
    ],
    [
      '글로 바꾸다 던지는 값을 던짐',
      {
        decide: 'throw {\n  toString() {\n    throw null;\n  },\n};\n',
        config: CONFIG_OK,
      },
    ],
  ];
  for (const [name, files] of cases) {
    const guard = entryOnly(files);
    for (const command of ['git push --force origin main', 'ls']) {
      const r = run(guard, bash(command, path.dirname(guard)));
      assert.equal(
        r.code,
        2,
        `${name} · ${command}: 종료 코드가 2가 아니다(표준 오류: ${r.stderr})`,
      );
      assert.match(r.stderr, /fail-closed/, `${name} · ${command}`);
    }
  }
});

/**
 * 오류 처리 중 재던짐: 판정 모듈 대역이 stderr 쓰기를 "표식 파일(대역 옆의 reached)을 쓰고 던지는 함수"로 바꾼 뒤
 * 던진다. 표식이 있으면 진입 파일의 오류 처리가 메시지를 쓰려 했다는 뜻이다(메시지는 쓸 수 없다)
 */
const RETHROW = {
  decide: [
    "import { writeFileSync } from 'node:fs';",
    'process.stderr.write = () => {',
    "  writeFileSync(new URL('./reached', import.meta.url), 'write');",
    '  throw null;',
    '};',
    'throw null;',
    '',
  ].join('\n'),
  config: CONFIG_OK,
};

/** 재던짐 대역으로 진입 파일을 실행한다. 신호·실행 오류와 표식 파일을 함께 돌려준다 */
function runRethrow(guard: string, command: string) {
  const r = spawnSync(process.execPath, [guard], {
    input: bash(command, path.dirname(guard)),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    status: r.status,
    signal: r.signal,
    error: r.error?.message,
    stderr: r.stderr,
    reached: existsSync(path.join(path.dirname(guard), 'reached')),
  };
}

/** 표식이 있고 신호·실행 오류 없이 종료 코드를 내며 끝났다(오류 처리에 닿은 뒤 끝났다) */
function assertReachedAndExited(r: ReturnType<typeof runRethrow>, what: string): void {
  assert.equal(r.reached, true, `${what}: 오류 처리에 닿지 않았다(표준 오류: ${r.stderr})`);
  assert.equal(r.signal, null, `${what}: 신호로 끝났다`);
  assert.equal(r.error, undefined, `${what}: 실행 오류`);
  assert.equal(typeof r.status, 'number', `${what}: 종료 코드가 없다`);
}

test('L1 훅 진입 파일은 오류를 처리하다 다시 던져도 종료 코드 2로 막는다', () => {
  for (const command of ['git push --force origin main', 'ls']) {
    const r = runRethrow(entryOnly(RETHROW), command);
    assertReachedAndExited(r, command);
    assert.equal(r.status, 2, `${command}: 종료 코드가 2가 아니다(표준 오류: ${r.stderr})`);
  }
});

test('재던짐 테스트는 finally를 본다: finally 없이 쓴 진입 파일 사본에서는 종료 코드가 2가 아니다', () => {
  // catch 안의 "try { 메시지 쓰기 } finally { process.exit(2) }"를 finally 없이 차례로 쓴 꼴로 바꾼다
  const withFinally = [
    '    try {',
    '      process.stderr.write(failureMessage(e, isConfigError));',
    '    } finally {',
    '      process.exit(2);',
    '    }',
  ].join('\n');
  const withoutFinally = [
    '    process.stderr.write(failureMessage(e, isConfigError));',
    '    process.exit(2);',
  ].join('\n');
  const original = runRethrow(entryOnly(RETHROW), 'git push --force origin main');
  const copy = entryOnly(RETHROW);
  const text = readFileSync(copy, 'utf8');
  assert.equal(
    text.split(withFinally).length - 1,
    1,
    '진입 파일에서 바꿀 글이 정확히 한 번 있어야 한다',
  );
  writeFileSync(copy, text.replace(withFinally, withoutFinally));
  const changed = runRethrow(copy, 'git push --force origin main');
  // 두 실행 모두 오류 처리에 닿은 뒤 끝났어야 대조가 성립한다(바꾼 사본이 문법 오류로 끝나면 여기서 실패한다)
  assertReachedAndExited(original, '원본');
  assertReachedAndExited(changed, 'finally를 뺀 사본');
  assert.equal(original.status, 2, '원본이 종료 코드 2가 아니다');
  assert.notEqual(
    changed.status,
    2,
    'finally가 없는데도 종료 코드 2다: 재던짐 대역이 오류 처리 중 재던짐을 만들지 못한다',
  );
});

test('링크를 거친 경로로 불린 세션 훅이 Stop에서 열린 PR을 알린다', () => {
  const root = linkedRoot();
  const state = path.join(tmp(), 'gh.json');
  initFakeState(state, {
    remote: path.join(tmp(), 'none.git'),
    owner: 'maker',
    mergeMode: 'manual',
  });
  const s = JSON.parse(readFileSync(state, 'utf8'));
  s.prs.push({
    number: 7,
    title: 't',
    body: '',
    head: 'feat/20261115-x-s0',
    headSha: '',
    base: 'main',
    state: 'open',
    isDraft: false,
    autoMerge: true,
    labels: [],
    url: 'u',
    mergeState: 'DIRTY',
    checks: 'success',
    failingChecks: [],
  });
  writeFileSync(state, JSON.stringify(s));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_FAKE_GH: state,
    CLAUDE_PROJECT_DIR: root,
  };
  // runner 세션 표시가 있으면 세션 훅이 아무것도 하지 않는다
  delete env.HARNESS_SESSION;
  const r = run(
    path.join(root, 'scripts', 'hooks', 'session.ts'),
    JSON.stringify({ hook_event_name: 'Stop', cwd: root }),
    { env },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.notEqual(r.stdout.trim(), '', '세션 훅이 아무것도 내지 않았다');
  assert.match(JSON.parse(r.stdout).systemMessage, /#7/);
});

test('링크를 거친 경로로 불린 verify 웹 구현이 받을 수 없는 인자를 거부한다(종료 코드 1)', () => {
  const web = path.join(linkedRoot(), 'scripts', 'verify', 'web.ts');
  const r = runSync(process.execPath, [web, '--config', 'x'], { cwd: HARNESS_ROOT });
  assert.equal(r.code, 1, `종료 코드가 1이 아니다(표준 출력: ${r.stdout})`);
  assert.match(r.stderr, /받을 수 없는 인자/);
});
