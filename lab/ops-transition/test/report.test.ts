import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkItems, ITEMS, OPTIONAL_ITEMS, REQUIRED, validateResult } from '../report.ts';

const kase = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  expected: '기대',
  observed: '관찰',
  verdict: 'pass',
  evidence: ['https://example.invalid/pr/1'],
  ...over,
});
const result = (item: string, cases: unknown[]) => ({ item, summary: '요약', cases });
const full = (item: string) =>
  result(
    item,
    REQUIRED[item].map((n) => kase(n)),
  );

test('항목과 필수 사례는 step6 지시서의 목록과 하네스 리포 시험(target-repo)이다', () => {
  assert.deepEqual(ITEMS, [
    'selftest',
    'flow',
    'revert',
    'guard-selftest',
    'codeowners',
    'workflow-scope',
    'stage',
    'target-repo',
    'td38',
  ]);
  assert.deepEqual(REQUIRED, {
    selftest: ['ci-check', 'live'],
    flow: ['runner-unattended', 'carry-over', 'no-carry'],
    revert: ['rerun-first', 'revert-pr', 'issue-reopen', 'plan-restore', 'tampered'],
    'guard-selftest': ['protected-pr', 'non-protected-pr'],
    codeowners: ['owner-required', 'auto-merge'],
    'workflow-scope': ['push-rejected'],
    stage: ['operation-pr'],
    'target-repo': ['workflow-push-rejected'],
    td38: [],
  });
  assert.deepEqual(OPTIONAL_ITEMS, ['td38']);
});

test('필수 사례가 모두 pass이고 기록이 완결되면 통과한다', () => {
  for (const item of ITEMS) {
    const r = full(item);
    // td38은 필수 사례가 없다. 기록이 완결되려면 사례가 하나는 있어야 한다
    if (r.cases.length === 0) r.cases.push(kase('seen'));
    assert.deepEqual(validateResult(item, r), [], item);
  }
});

test('필수 사례가 빠졌거나 pass가 아니면 막는다', () => {
  const missing = result(
    'revert',
    REQUIRED.revert.slice(1).map((n) => kase(n)),
  );
  assert.match(validateResult('revert', missing).join('\n'), /필수 사례 rerun-first가 없다/);
  for (const verdict of ['fail', 'partial', 'n/a']) {
    const r = full('flow');
    r.cases[1] = kase('carry-over', { verdict, evidence: [], observed: '못 봤다' });
    const p = validateResult('flow', r).join('\n');
    assert.match(p, /필수 사례 carry-over의 판정이 pass가 아니다/, verdict);
  }
});

test('target-repo(하네스 리포 시험): 결과 파일이 없거나 workflow-push-rejected가 pass가 아니면 막는다', () => {
  assert.deepEqual(validateResult('target-repo', full('target-repo')), []);
  const failed = result('target-repo', [kase('workflow-push-rejected', { verdict: 'fail' })]);
  assert.match(
    validateResult('target-repo', failed).join('\n'),
    /필수 사례 workflow-push-rejected의 판정이 pass가 아니다/,
  );
  const other = result('target-repo', [kase('low-risk-auto-merge')]);
  assert.match(
    validateResult('target-repo', other).join('\n'),
    /필수 사례 workflow-push-rejected가 없다/,
  );
  const dir = mkdtempSync(path.join(tmpdir(), 'ops-report-'));
  assert.match(checkItems(dir, ['target-repo']).join('\n'), /target-repo: 결과 파일이 없다/);
});

test('필수가 아닌 사례는 fail·partial·n/a여도 기록이 완결되면 통과한다', () => {
  const r = full('workflow-scope');
  r.cases.push(kase('update-after-workflow-change', { verdict: 'fail' }));
  r.cases.push(kase('revert-of-workflow', { verdict: 'n/a', evidence: [], observed: '못 봤다' }));
  assert.deepEqual(validateResult('workflow-scope', r), []);
  const td = result('td38', [kase('bot-comment-edit', { verdict: 'partial' })]);
  assert.deepEqual(validateResult('td38', td), []);
});

test('기록 완결: 근거 없음(n/a 제외), 빈 필드, 잘못된 verdict, item 불일치, 같은 이름의 사례를 막는다', () => {
  const noEvidence = full('stage');
  noEvidence.cases[0] = kase('operation-pr', { evidence: [] });
  assert.match(validateResult('stage', noEvidence).join('\n'), /근거/);
  const blank = full('stage');
  blank.cases[0] = kase('operation-pr', { observed: ' ' });
  assert.match(validateResult('stage', blank).join('\n'), /observed/);
  const bad = full('stage');
  bad.cases.push(kase('extra', { verdict: 'ok' }));
  assert.match(validateResult('stage', bad).join('\n'), /verdict/);
  assert.match(validateResult('flow', full('stage')).join('\n'), /item 값/);
  assert.match(validateResult('stage', { ...full('stage'), summary: '' }).join('\n'), /summary/);
  assert.match(validateResult('stage', result('stage', [])).join('\n'), /cases가 없다/);
  const dup = full('stage');
  dup.cases.push(kase('operation-pr', { verdict: 'fail' }));
  assert.match(validateResult('stage', dup).join('\n'), /이름이 같은 사례/);
});

test('결과 파일: 없으면 막는다(td38은 없어도 된다). JSON이 깨지면 막는다', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ops-report-'));
  writeFileSync(path.join(dir, 'stage.json'), JSON.stringify(full('stage')));
  writeFileSync(path.join(dir, 'flow.json'), '{');
  assert.deepEqual(checkItems(dir, ['stage', 'td38']), []);
  const p = checkItems(dir, ['stage', 'flow', 'revert']).join('\n');
  assert.match(p, /flow: JSON 파싱 실패/);
  assert.match(p, /revert: 결과 파일이 없다/);
  writeFileSync(path.join(dir, 'td38.json'), JSON.stringify(result('td38', [])));
  assert.match(checkItems(dir, ['td38']).join('\n'), /cases가 없다/);
});

test('CLI: 인자가 없거나 모르는 항목이면 종료 코드 2', () => {
  const file = fileURLToPath(new URL('../report.ts', import.meta.url));
  const run = (args: string[]) =>
    spawnSync(process.execPath, [file, ...args], { encoding: 'utf8' });
  const none = run([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /사용법/);
  const unknown = run(['--item', 'nope']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /알 수 없는 항목/);
});
