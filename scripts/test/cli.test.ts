// CLI 진입점: --help와 모르는 플래그는 아무것도 실행하지 않는다(TD-17, Issue #16 step4).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, HARNESS_ROOT, gitInit, tmp, write } from './helpers.ts';

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });

test('CLI: <명령> --help는 실행하지 않고 도움말만 출력한다', () => {
  // 리포가 아닌 폴더: 명령이 실제로 실행되면 리포를 찾지 못해 실패한다
  const cwd = tmp();
  for (const args of [['run', '--help'], ['new-task', '--help'], ['start', '-h'], ['--help']]) {
    const r = cli(args, cwd);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stdout, /하네스 명령/);
  }
});

test('CLI: 모르는 플래그는 실행 없이 종료 코드 2와 이유를 낸다', () => {
  const cwd = tmp();
  const r = cli(['run', '--bogus-flag'], cwd);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /알 수 없는 옵션: --bogus-flag/);
  const eq = cli(['run', '--wroker=runner-2'], cwd);
  assert.equal(eq.code, 2);
  assert.match(eq.stderr, /--wroker/);
  // -- 뒤 인자는 표준 명령에 그대로 넘기므로 검사하지 않는다
  const passthrough = cli(['help', '--', '--anything'], cwd);
  assert.equal(passthrough.code, 0);
});

test('CLI: 종료 코드를 정하고 자연 종료한다(fetch 뒤 process.exit는 Windows의 Node 24에서 죽는다, Issue #99)', () => {
  const cwd = tmp();
  // 종료 코드의 뜻은 그대로다: 성공 0, 사용법·모르는 명령 2
  // 강제 종료 타이머(10초)는 프로세스를 붙잡지 않는다(unref): 명령이 끝나면 그 전에 종료한다
  const started = Date.now();
  assert.equal(cli(['--help'], cwd).code, 0);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5000, `--help가 ${elapsed}ms 걸렸다(타이머가 프로세스를 붙잡고 있다)`);
  assert.equal(cli(['no-such-command'], cwd).code, 2);
  assert.equal(cli(['run', '--bogus-flag'], cwd).code, 2);
  // 종료 처리: main 뒤에서 process.exit는 강제 종료 타이머(unref) 안에서만 불린다
  const src = readFileSync(path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'utf8');
  const tail = src.slice(src.lastIndexOf('function finish('));
  assert.match(tail, /process\.exitCode = code;/);
  assert.match(tail, /setTimeout\(\(\) => process\.exit\(code\), EXIT_GRACE_MS\)\.unref\(\);/);
  assert.equal(tail.match(/process\.exit\(/g)?.length, 1);
  assert.match(tail, /main\(process\.argv\.slice\(2\)\)\.then\(finish,/);
});

test('CLI: 오류 갈래의 종료 코드는 그대로다 — TaskError는 3, 그 밖의 예외는 1 (Issue #99)', () => {
  // 하네스 설정도 계획 브랜치도 없는 임시 리포
  const repo = tmp();
  gitInit(repo);
  const task = cli(['complete-step'], repo);
  assert.equal(task.code, 3, task.stderr);
  assert.match(task.stderr, /계획 브랜치가 아니다/);
  assert.doesNotMatch(task.stderr, /^오류:/);
  const other = cli(['plan-gate'], repo);
  assert.equal(other.code, 1, other.stderr);
  assert.match(other.stderr, /^오류: /);
});

test('CLI: check --only test-effect는 그 하위 검사만 실행한다', () => {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  const testEffect = {
    files: ['t/*.test.mjs'],
    command: [process.execPath, '--test'],
    timeoutSec: 60,
  };
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig({ testEffect })));
  const base = commitAll(root, 'base');
  write(root, 't/new.test.mjs', "import { test } from 'node:test';\ntest('a', () => {});\n");
  const r = cli(['check', '--only', 'test-effect', '--no-cache', '--base', base], root);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✗ test-effect /m);
  assert.match(r.stdout, /R5 테스트 실효성/);
  assert.doesNotMatch(r.stdout, /^[✓✗–] (fmt|lint|test|build|doc-lint|bypass-scan|secret-scan) /m);
});
