// 하네스 자체 테스트 실행기(scripts/selftest/run.ts, 설계서 12.4절) 테스트. 계획 20261116-ops-transition step1·2.
// 이 리포의 하네스는 모든 시나리오를 통과한다. 약화된 하네스와 실행기의 테스트는 selftest-cases.test.ts(Issue #230에서 나눴다).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSelfTest, runSelfTest } from '../selftest/run.ts';
import { HARNESS_ROOT } from './helpers.ts';

const IDS = [
  'f92-switch-stop',
  'flow-full',
  'mcp-guard',
  'r1-plan-gate',
  'r13-db',
  'r20-owner-commands',
  'r4-bypass',
  'r45-runner',
  'r5-test-effect',
  's1-next-task',
];

test('self-test: 이 리포의 하네스는 모든 시나리오를 통과한다', async () => {
  const r = await runSelfTest({ harness: HARNESS_ROOT, headSha: 'a'.repeat(40) });
  assert.equal(r.version, 1);
  assert.equal(r.headSha, 'a'.repeat(40));
  assert.deepEqual(
    r.results.map((x) => [x.id, x.state]),
    IDS.map((id) => [id, 'pass']),
    formatSelfTest(r).join('\n'),
  );
  assert.deepEqual(r.results.map((x) => x.covers).sort(), [
    '4.5',
    '9.2',
    'R1',
    'R13',
    'R14',
    'R20',
    'R4',
    'R5',
    'S1',
    '전체 흐름',
  ]);
});
