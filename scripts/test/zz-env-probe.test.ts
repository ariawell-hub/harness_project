// 조사용(계획 20261122-hook-wrapper-options, Issue #193): 이 머신의 env가 할당이나 `--` 뒤의 낱말을 어떻게 읽는지 실제로 돌려 본다.
// 돌리는 것은 받은 인자를 파일에 적기만 하는 가짜 실행 파일뿐이다. uutils의 env에서만 결과를 실패 메시지로 낸다(CI의 로그로 읽는다).
// 조사가 끝나면 지운다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tmp } from './helpers.ts';

test('조사: env가 할당이나 `--` 뒤의 낱말을 읽는 방법', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX 셸이 필요하다');
    return;
  }
  const bin = tmp('harness-env-probe-bin-');
  const dash = tmp('harness-env-probe-dash-');
  const out = path.join(bin, 'argv.out');
  assert.match(bin, /^[A-Za-z0-9_./-]+$/, '임시 폴더의 경로');
  assert.match(dash, /^[A-Za-z0-9_./-]+$/, '임시 폴더의 경로');
  const tool = path.join(bin, 'tool');
  /** 받은 인자의 수와 인자를 이름과 함께 NUL로 구분해 적는 실행 파일 */
  const fake = (file: string, name: string) => {
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\0' '${name}' "$#" "$@" > '${out}'\n`);
    chmodSync(file, 0o755);
  };
  fake(tool, 'tool');
  for (const name of [
    '-i',
    '-',
    '--',
    '-S',
    '-u',
    '-x',
    '-iS',
    '--split',
    '--split-string',
    '--unse',
    '--ignore',
    'x',
  ])
    fake(path.join(dash, name), name);
  const PATH = `${dash}:${process.env.PATH ?? ''}`;
  const shapes = [
    "env T -S 'a b'",
    "env T x -S 'a b'",
    "env A=1 T -S 'a b'",
    "env -i T -S 'a b'",
    "env A=1 -x -S 'T a'",
    "env A=1 -S'T a'",
    "env A=1 --split-string 'T a'",
    "env A=1 --split-string='T a'",
    "env A=1 -iS 'T a'",
    "env A=1 -S '-i T a'",
    "env A=1 -S 'B=2 T a'",
    "env A=1 -S 'T' -S 'a b'",
    "env -- A=1 -S 'T a'",
    'env A=1 - B=2 T a',
    'env A=1 - -i T a',
    'env - -i T a',
    'env - A=1 T a',
    "env - -S 'T a'",
    'env -- - A=1 T a',
    "env -S 'A=1 - T a'",
    "env A=1 --split 'T a'",
    'env --split x T a',
    'env --split x -i T a',
    'env --unse HOME T a',
    'env --ignore T a',
  ];
  const lines: string[] = [];
  for (const shape of shapes) {
    writeFileSync(out, '');
    const r = spawnSync('bash', ['-c', shape.replace('T', () => tool)], {
      cwd: tmp('harness-env-probe-'),
      encoding: 'utf8',
      input: '\n',
      timeout: 20_000,
      env: { PATH, LC_ALL: 'C' },
    });
    const parts = readFileSync(out, 'utf8').split('\0');
    const ran =
      parts[0] === ''
        ? '(실행된 것이 없다)'
        : JSON.stringify([parts[0], ...parts.slice(2, 2 + Number(parts[1]))]).replaceAll(tool, 'T');
    const err = (r.stderr ?? '').trim().split('\n')[0].replaceAll(tool, 'T').slice(0, 120);
    lines.push(`${shape} => ${ran} (종료 코드 ${r.status}${err ? `, ${err}` : ''})`);
  }
  const version = spawnSync('env', ['--version'], { encoding: 'utf8', env: { PATH, LC_ALL: 'C' } });
  const which = (version.stdout ?? '').split('\n')[0] || '(env --version이 버전을 내지 않는다)';
  const report = `env: ${which}\n${lines.join('\n')}`;
  t.diagnostic(report);
  // uutils의 env에서만 실패로 낸다: CI의 실패 로그에서 결과를 읽는다
  assert.ok(!/uutils/i.test(which), report);
});
