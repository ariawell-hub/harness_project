// plan-gate의 G1(계획 교차 검증 확인, 4.1·10.3절): merge-base와 같은 해시, 원장의 계획 승인, 그 밖은 실패.
// 계획 20261115-review-ledger step4.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runGates } from '../ci/gates.ts';
import type { PlanReview } from '../ci/ledger.ts';
import { planHash } from '../ci/plan-hash.ts';
import { planGate, type PlanG1 } from '../gates/plan-gate.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const ID = '20261111-demo';
const DIR = `docs/exec-plans/active/${ID}`;
const S0 = `feat/${ID}-s0`;
const S1 = `feat/${ID}-s1`;
const HEAD = '1'.repeat(40);
const BOTH = ['claude', 'codex'] as const;

const PLAN = (size = 'medium') => `---
id: ${ID}
issue: 3
type: feat
status: active
size: ${size}
risk: normal
author: claude-code
owner: runner-1
claimed_at: 2026-11-11T09:00:00+09:00
---
# 데모

## 목표와 수용 기준
- 데모 함수를 만든다

## 범위 / 비범위
- src/demo.ts만

## 관련 파일·문서
- src/demo.ts

## 발견 사항
- 없음

## 검증 방법과 결과
- node --test
`;
const STEP = (n: number, ac = `test -f s${n}.txt`) =>
  `# Step ${n}: s${n}\n\n## 작업\n- 파일을 만든다\n\n## Acceptance Criteria\n\`\`\`bash\n${ac}\n\`\`\`\n`;

function writePlan(root: string, statuses: string[]) {
  write(root, `${DIR}/plan.md`, PLAN());
  write(
    root,
    `${DIR}/index.json`,
    JSON.stringify({
      plan: ID,
      steps: statuses.map((status, i) => ({ step: i, name: `s${i}`, status })),
    }),
  );
  statuses.forEach((_, i) => write(root, `${DIR}/step${i}.md`, STEP(i)));
}

/** step0 PR: base에는 계획이 없다. 계획과 코드를 올리고 step0을 완료 처리했다 */
function firstStepRepo(required: boolean): { root: string; base: string; cfg: HarnessConfig } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig({ planReview: { required } })));
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', S0], root);
  writePlan(root, ['completed', 'pending']);
  write(root, 'src/demo.ts', 'export {}\n');
  commitAll(root, 'step0');
  return { root, base, cfg: loadConfig(root) };
}

const g1 = (root: string, over: Partial<PlanG1> = {}): PlanG1 => ({
  hash: planHash(root, DIR),
  baseHash: null,
  review: null,
  reviewers: BOTH,
  ...over,
});
const gate = (o: { root: string; base: string; cfg: HarnessConfig }, g?: PlanG1, branch = S0) =>
  planGate({ root: o.root, base: o.base, branch, mode: 'pr', cfg: o.cfg, g1: g });
const whats = (r: { problems: { what: string }[] }) => r.problems.map((p) => p.what).join('\n');

test('G1 (a): merge-base의 같은 계획과 해시가 같으면 다시 검증하지 않는다', () => {
  const o = firstStepRepo(true);
  const hash = planHash(o.root, DIR);
  // 원장에 계획 승인이 없어도 통과한다
  const r = gate(o, g1(o.root, { baseHash: hash, review: null }));
  assert.deepEqual(r.problems, []);
});

test('G1 (b): 원장의 계획 승인 해시가 지금 해시와 같고 필요한 검증자가 모두 승인했으면 통과', () => {
  const o = firstStepRepo(true);
  const hash = planHash(o.root, DIR);
  const ok = gate(o, g1(o.root, { review: { hash, approvals: ['codex', 'claude'] } }));
  assert.deepEqual(ok.problems, []);
  assert.match(ok.notes.join('\n'), /G1.*승인/);
  // 한 검증자만 승인했으면 실패하고 누가 빠졌는지 적는다
  const one = gate(o, g1(o.root, { review: { hash, approvals: ['claude'] } }));
  assert.match(whats(one), /codex/);
  assert.doesNotMatch(whats(one), /claude,/);
});

test('G1 (c): 계획 승인이 없거나 승인 뒤 핵심 섹션이 바뀌었으면 실패', () => {
  const o = firstStepRepo(true);
  const hash = planHash(o.root, DIR);
  const none = gate(o, g1(o.root, { review: null }));
  assert.match(whats(none), /G1/);
  assert.match(none.problems[0].how, /계획만 담은 커밋/);
  // 승인받은 뒤 다른 step의 AC를 고쳤다: 원장의 해시와 다르다
  write(o.root, `${DIR}/step1.md`, STEP(1, 'true'));
  const stale = gate(o, g1(o.root, { review: { hash, approvals: [...BOTH] } }));
  assert.notEqual(planHash(o.root, DIR), hash);
  assert.match(whats(stale), /G1/);
  // merge-base의 해시와도 다르면 (a)로 통과하지 않는다
  const moved = gate(o, g1(o.root, { baseHash: hash, review: null }));
  assert.match(whats(moved), /G1/);
});

test('G1: 원장을 보지 않는 실행(로컬·runner)은 실패시키지 않고 참고만 남긴다', () => {
  const o = firstStepRepo(true);
  // runner: g1을 넘기지 않는다
  const none = gate(o);
  assert.deepEqual(none.problems, []);
  assert.match(none.notes.join('\n'), /G1.*CI/);
  // CLI: 해시만 넘긴다(review 없음)
  const local = gate(o, { hash: planHash(o.root, DIR), baseHash: null, reviewers: BOTH });
  assert.deepEqual(local.problems, []);
  assert.match(local.notes.join('\n'), /G1.*계획만 담은 커밋/);
});

test('G1: planReview.required가 false면 결과를 참고로만 남긴다. 소규모 계획은 확인하지 않는다', () => {
  const off = firstStepRepo(false);
  const r = gate(off, g1(off.root, { review: null }));
  assert.deepEqual(r.problems, []);
  assert.match(r.notes.join('\n'), /G1\(꺼짐\)/);

  // 소규모(단일 파일) 계획은 켜져 있어도 G1 대상이 아니다
  const root = path.join(tmp(), 'small');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ planReview: { required: true } })),
  );
  const base = commitAll(root, 'init');
  write(
    root,
    `docs/exec-plans/completed/${ID}.md`,
    PLAN('small').replace('status: active', 'status: completed') +
      '\n- 목표: 오타\n- 변경: 한 줄\n- 검증: true\n',
  );
  const small = planGate({
    root,
    base,
    branch: `docs/${ID}`,
    mode: 'pr',
    cfg: loadConfig(root),
  });
  assert.deepEqual(small.problems, []);
  assert.doesNotMatch(small.notes.join('\n'), /G1/);
});

// ---------- runGates: 해시 계산과 원장 읽기 ----------

const review = (root: string, approvals: PlanReview['approvals']): PlanReview => ({
  hash: planHash(root, DIR),
  head: HEAD,
  approvals,
});
const planGateOf = async (
  o: { root: string; base: string; cfg: HarnessConfig },
  planReview?: () => Promise<PlanReview | null>,
  branch = S0,
) => {
  const r = await runGates({ ...o, branch, headSha: HEAD, planReview });
  return r.results.find((x) => x.context === 'plan-gate')!;
};

test('runGates: 원장의 계획 승인으로 plan-gate를 판정한다(승인 있음 → 통과, 없음·부족 → 실패)', async () => {
  const o = firstStepRepo(true);
  const ok = await planGateOf(o, async () => review(o.root, ['claude', 'codex']));
  assert.equal(ok.state, 'success', ok.details.join('\n'));
  const none = await planGateOf(o, async () => null);
  assert.equal(none.state, 'failure');
  assert.match(none.description, /G1/);
  const one = await planGateOf(o, async () => review(o.root, ['codex']));
  assert.equal(one.state, 'failure');
  // 원장을 읽을 방법이 없으면(PR 번호 없음) 승인이 없는 것으로 본다
  assert.equal((await planGateOf(o)).state, 'failure');
});

test('runGates: 원장을 읽지 못하면 plan-gate는 error(fail-closed). 꺼져 있으면 참고만', async () => {
  const fail = async () => {
    throw new Error('GitHub 조회 실패: HTTP 502');
  };
  const on = await planGateOf(firstStepRepo(true), fail);
  assert.equal(on.state, 'error');
  assert.match(on.description, /원장/);
  const off = await planGateOf(firstStepRepo(false), fail);
  assert.equal(off.state, 'success', off.details.join('\n'));
  assert.match(off.details.join('\n'), /G1\(꺼짐\)/);
});

test('runGates: 계획이 merge-base와 같으면 원장을 읽지 않고 통과한다(뒤 step의 PR)', async () => {
  const o = firstStepRepo(true);
  // step0 병합 → step1 브랜치
  sh('git', ['checkout', '-q', 'main'], o.root);
  sh('git', ['merge', '-q', '--squash', S0], o.root);
  const base = commitAll(o.root, 'merge step0');
  sh('git', ['checkout', '-q', '-b', S1], o.root);
  const done = DIR.replace('/active/', '/completed/');
  mkdirSync(path.join(o.root, path.dirname(done)), { recursive: true });
  sh('git', ['mv', DIR, done], o.root);
  write(o.root, `${done}/plan.md`, PLAN().replace('status: active', 'status: completed'));
  write(
    o.root,
    `${done}/index.json`,
    JSON.stringify({
      plan: ID,
      steps: [0, 1].map((i) => ({ step: i, name: `s${i}`, status: 'completed' })),
    }),
  );
  write(o.root, 'src/demo2.ts', 'export {}\n');
  commitAll(o.root, 'step1');
  let calls = 0;
  const load = async () => {
    calls++;
    return null;
  };
  const same = await planGateOf({ ...o, base }, load, S1);
  assert.equal(same.state, 'success', same.details.join('\n'));
  assert.equal(calls, 0);
});
