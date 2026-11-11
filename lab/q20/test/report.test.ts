import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkItems, validateResult } from '../report.ts';

const ok = {
  item: 'patch-id',
  summary: '요약',
  cases: [
    {
      name: 'rebase',
      expected: '같다',
      observed: '같았다',
      verdict: 'pass',
      evidence: ['https://x'],
    },
  ],
};

test('완결된 기록은 통과한다(실패 판정이어도)', () => {
  assert.deepEqual(validateResult('patch-id', ok), []);
  const failed = { ...ok, cases: [{ ...ok.cases[0], verdict: 'fail' }] };
  assert.deepEqual(validateResult('patch-id', failed), []);
});

test('근거가 없으면 막는다(n/a 제외)', () => {
  const p = validateResult('patch-id', { ...ok, cases: [{ ...ok.cases[0], evidence: [] }] });
  assert.equal(p.length, 1);
  assert.match(p[0], /근거/);
  const na = { ...ok, cases: [{ ...ok.cases[0], verdict: 'n/a', evidence: [] }] };
  assert.deepEqual(validateResult('patch-id', na), []);
});

test('item 불일치, 빈 summary, 빈 cases, 잘못된 verdict를 막는다', () => {
  assert.match(validateResult('env-ref', ok).join('\n'), /item 값/);
  assert.match(validateResult('patch-id', { ...ok, summary: ' ' }).join('\n'), /summary/);
  assert.match(validateResult('patch-id', { ...ok, cases: [] }).join('\n'), /cases가 없다/);
  const bad = { ...ok, cases: [{ ...ok.cases[0], verdict: 'ok' }] };
  assert.match(validateResult('patch-id', bad).join('\n'), /verdict/);
  const blank = { ...ok, cases: [{ ...ok.cases[0], observed: '' }] };
  assert.match(validateResult('patch-id', blank).join('\n'), /observed/);
});

test('결과 파일이 없거나 JSON이 깨지면 막는다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'q20-report-'));
  writeFileSync(path.join(dir, 'patch-id.json'), JSON.stringify(ok));
  writeFileSync(path.join(dir, 'env-ref.json'), '{');
  assert.deepEqual(checkItems(dir, ['patch-id']), []);
  const p = checkItems(dir, ['patch-id', 'env-ref', 'merge-queue']);
  assert.equal(p.length, 2);
  assert.match(p.join('\n'), /env-ref: JSON 파싱 실패/);
  assert.match(p.join('\n'), /merge-queue: 결과 파일이 없다/);
});
