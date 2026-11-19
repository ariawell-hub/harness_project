// 표준 명령의 추가 인자(`node scripts/harness.ts <명령> -- <인자>`)는 셸이 해석하지 않고
// 글자 그대로 구현에 전달된다(계획 20261119-pilot-prep 수용 기준 3, 계획 검증 F4).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runStandard, shellQuote } from '../commands/standard.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const RUN = 'node echo-args.mjs';
const NONE = { setup: null, fmt: null, lint: null, test: null, build: null, dev: null };

/** `verify`가 받은 인자를 args.json에 쓰는 리포. 셸이 인자를 실행하면 표식 파일(marker*)이 생긴다 */
function repo(): string {
  const root = path.join(tmp('harness-std-args-'), 'r');
  gitInit(root);
  write(
    root,
    'echo-args.mjs',
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('args.json', JSON.stringify(process.argv.slice(2)));\n",
  );
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ commands: { ...NONE, verify: { run: RUN, timeoutSec: 60 } } })),
  );
  commitAll(root, 'init');
  return root;
}
const received = (root: string) =>
  JSON.parse(readFileSync(path.join(root, 'args.json'), 'utf8')) as string[];
const markers = (root: string) => readdirSync(root).filter((f) => f.startsWith('marker'));

const ARGS = [
  '$(touch marker1)',
  '`touch marker2`',
  'a; touch marker3',
  'a && touch marker4',
  '$HOME',
  "it's",
  'say "hi"',
  'a b',
  '*.ts',
  'e2e/[id].spec.ts',
  "'; touch marker5; '",
  '\\',
  'a\nb',
  '',
  '-x',
];

test('추가 인자는 하나씩 넘겨도 글자 그대로 전달되고 셸이 실행하지 않는다', async () => {
  for (const arg of ARGS) {
    const root = repo();
    const r = await runStandard('verify', root, loadConfig(root), { extraArgs: [arg] });
    assert.equal(r.ok, true, `${JSON.stringify(arg)}: ${r.result?.stderr}`);
    assert.deepEqual(received(root), [arg]);
    assert.deepEqual(markers(root), [], JSON.stringify(arg));
  }
});

test('추가 인자 여러 개가 순서대로 글자 그대로 전달된다', async () => {
  const root = repo();
  const r = await runStandard('verify', root, loadConfig(root), { extraArgs: ARGS });
  assert.equal(r.ok, true, r.result?.stderr);
  assert.deepEqual(received(root), ARGS);
  assert.deepEqual(markers(root), []);
});

test('명령행(harness.ts verify -- <인자>)으로 넘긴 인자도 글자 그대로 전달된다', () => {
  const root = repo();
  const r = runSync(
    process.execPath,
    [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'verify', '--', '$(touch marker1)', "it's"],
    { cwd: root },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(received(root), ['$(touch marker1)', "it's"]);
  assert.deepEqual(markers(root), []);
});

test('추가 인자가 없으면 실행한 명령 문자열이 명령 정의와 같다', async () => {
  const root = repo();
  for (const extraArgs of [undefined, []]) {
    const r = await runStandard('verify', root, loadConfig(root), { extraArgs });
    assert.equal(r.command, RUN);
    assert.equal(r.ok, true, r.result?.stderr);
    assert.deepEqual(received(root), []);
  }
});

test('NUL 문자가 든 추가 인자는 실행하지 않고 실패로 돌려준다', async () => {
  const root = repo();
  const r = await runStandard('verify', root, loadConfig(root), { extraArgs: ['ok', 'a\0b'] });
  assert.equal(r.ok, false);
  assert.equal(r.notApplicable, false);
  assert.notEqual(r.result?.code, 0);
  assert.match(r.result?.stderr ?? '', /NUL/);
  assert.equal(existsSync(path.join(root, 'args.json')), false);
});

test('shellQuote는 작은따옴표로 감싸고 안의 작은따옴표만 바꾼다', () => {
  assert.equal(shellQuote('a b'), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(shellQuote('$(x) `y` "z" \\'), '\'$(x) `y` "z" \\\'');
  assert.equal(shellQuote(''), "''");
});
