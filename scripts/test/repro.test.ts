// 재현 job(10.2절 (3), 10.4절): 검증자가 낸 재현 테스트를 PR 체크아웃에 붙여 실행한다. 계획 20261115-review-ledger step3.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  parseReproResults,
  reproPathOk,
  reproResultsData,
  runRepro,
  type ReproConfig,
} from '../ci/repro.ts';
import type { Finding, Verdict } from '../ci/verdict.ts';
import { tmp, write } from './helpers.ts';

const CFG: ReproConfig = {
  dir: 'scripts/test',
  command: [process.execPath, '--test'],
  failPattern: 'AssertionError|ERR_ASSERTION',
  timeoutSec: 20,
};
const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'P1',
  file: 'src/a.js',
  line: 1,
  title: '지적',
  evidence: '근거',
  suggestion: '제안',
  repro: { path: '', content: '' },
  ...over,
});
const verdict = (findings: Finding[]): Verdict => ({
  verdict: 'request_changes',
  risk: 'normal',
  summary: '요약',
  findings,
  resolutions: [],
});
const T = (name: string, body: string) => ({
  path: `scripts/test/harness-repro-${name}.test.mjs`,
  content: `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('repro', async () => {\n${body}\n});\n`,
});
function repo(): string {
  const root = tmp();
  write(root, 'src/a.mjs', 'export const add = (a, b) => a - b;\n');
  mkdirSync(path.join(root, 'scripts/test'), { recursive: true });
  return root;
}

test('reproPathOk: 설정한 폴더 바로 아래의 harness-repro-*.test.* 이름만 받는다', () => {
  for (const p of [
    'scripts/test/harness-repro-a.test.ts',
    'scripts/test/harness-repro-f1-expired-token.test.mjs',
    'scripts/test/harness-repro-1.test.js',
  ])
    assert.equal(reproPathOk(p, 'scripts/test'), true, p);
  for (const p of [
    '',
    'scripts/test/a.test.ts',
    'scripts/test/harness-repro-.test.ts',
    'scripts/test/harness-repro-A.test.ts',
    'scripts/test/sub/harness-repro-a.test.ts',
    'scripts/test/../harness-repro-a.test.ts',
    'scripts/harness-repro-a.test.ts',
    '/scripts/test/harness-repro-a.test.ts',
    'scripts/test/harness-repro-a.test.sh',
    'scripts/test/harness-repro-a.test.ts ',
    `scripts/test/harness-repro-${'a'.repeat(61)}.test.ts`,
  ])
    assert.equal(reproPathOk(p, 'scripts/test'), false, p);
});

test('runRepro: 단언 실패는 reproduced, 통과는 not-reproduced, 단언이 아닌 실패는 error', () => {
  const root = repo();
  const v = verdict([
    finding({
      repro: T(
        'bug',
        "  const { add } = await import('../../src/a.mjs');\n  assert.equal(add(1, 2), 3);",
      ),
    }),
    finding({ repro: T('ok', '  assert.equal(1, 1);') }),
    finding(),
    finding({ repro: T('broken', "  await import('../../src/없는파일.mjs');") }),
    finding({
      repro: { path: 'scripts/test/harness-repro-syntax.test.mjs', content: 'const = ;' },
    }),
  ]);
  const r = runRepro({ root, verdict: v, cfg: CFG });
  assert.deepEqual(r, [
    { index: 0, result: 'reproduced' },
    { index: 1, result: 'not-reproduced' },
    { index: 3, result: 'error' },
    { index: 4, result: 'error' },
  ]);
  // 붙인 테스트 파일은 실행 뒤 지운다(다음 테스트에 섞이지 않게)
  assert.equal(existsSync(path.join(root, 'scripts/test/harness-repro-bug.test.mjs')), false);
});

test('runRepro: 경로가 형식 밖이거나 이미 있는 파일이면 쓰지 않고 error', () => {
  const root = repo();
  write(root, 'scripts/test/harness-repro-exists.test.mjs', '// 원래 파일\n');
  write(root, 'outside.txt', '원래\n');
  const v = verdict([
    finding({ repro: { path: '../outside.test.mjs', content: 'x' } }),
    finding({ repro: { path: 'outside.txt', content: 'x' } }),
    finding({ repro: { ...T('exists', '  assert.equal(1, 2);') } }),
    finding({ repro: { path: 'scripts/test/harness-repro-a.test.mjs', content: '' } }),
  ]);
  const r = runRepro({ root, verdict: v, cfg: CFG });
  assert.deepEqual(r, [
    { index: 0, result: 'error' },
    { index: 1, result: 'error' },
    { index: 2, result: 'error' },
  ]);
  assert.equal(readFileSync(path.join(root, 'outside.txt'), 'utf8'), '원래\n');
  assert.equal(
    readFileSync(path.join(root, 'scripts/test/harness-repro-exists.test.mjs'), 'utf8'),
    '// 원래 파일\n',
  );
});

test('runRepro: 테스트 폴더가 리포 밖을 가리키는 심볼릭 링크면 쓰지 않는다', () => {
  const root = tmp();
  const outside = tmp();
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  symlinkSync(outside, path.join(root, 'scripts/test'));
  const r = runRepro({
    root,
    verdict: verdict([finding({ repro: T('link', '  assert.equal(1, 2);') })]),
    cfg: CFG,
  });
  assert.deepEqual(r, [{ index: 0, result: 'error' }]);
  assert.equal(existsSync(path.join(outside, 'harness-repro-link.test.mjs')), false);
});

test('runRepro: 시간 제한을 넘으면 error. 설정이 없으면 아무것도 실행하지 않는다', () => {
  const root = repo();
  const v = verdict([
    finding({ repro: T('slow', '  await new Promise((r) => setTimeout(r, 60_000));') }),
  ]);
  const started = Date.now();
  const r = runRepro({ root, verdict: v, cfg: { ...CFG, timeoutSec: 2 } });
  assert.deepEqual(r, [{ index: 0, result: 'error' }]);
  assert.ok(Date.now() - started < 30_000);
  assert.deepEqual(runRepro({ root, verdict: v, cfg: null }), []);
});

test('runRepro: 테스트 프로세스에 러너의 환경 변수를 넘기지 않는다', () => {
  const root = repo();
  process.env.HARNESS_REPRO_PROBE = 'leak';
  try {
    const v = verdict([
      finding({
        repro: T('env', "  assert.equal(process.env.HARNESS_REPRO_PROBE ?? '', 'leak');"),
      }),
    ]);
    // 환경이 넘어가지 않으면 단언이 실패한다
    assert.deepEqual(runRepro({ root, verdict: v, cfg: CFG }), [
      { index: 0, result: 'reproduced' },
    ]);
  } finally {
    delete process.env.HARNESS_REPRO_PROBE;
  }
});

test('reproResultsData → parseReproResults: 순번과 값만 받는다. 형식이 다르면 null', () => {
  const list = [
    { index: 0, result: 'reproduced' as const },
    { index: 3, result: 'not-reproduced' as const },
  ];
  assert.deepEqual(parseReproResults(reproResultsData(list), 5), list);
  assert.deepEqual(parseReproResults('', 5), []);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
  for (const bad of [
    '!!',
    'AAAA',
    enc({}),
    enc([{ index: 5, result: 'reproduced' }]),
    enc([{ index: -1, result: 'reproduced' }]),
    enc([{ index: 0.5, result: 'reproduced' }]),
    enc([{ index: 0, result: 'fixed' }]),
    enc([{ index: 0, result: '' }]),
    enc([{ index: 0, result: 'reproduced', extra: 1 }]),
    enc([
      { index: 0, result: 'reproduced' },
      { index: 0, result: 'error' },
    ]),
  ])
    assert.equal(parseReproResults(bad, 5), null, bad);
});
