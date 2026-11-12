// CLI 진입점: --help와 모르는 플래그는 아무것도 실행하지 않는다(TD-17, Issue #16 step4).
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

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
