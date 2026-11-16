// revert-check(10.3절): revert/<SHA> PR의 정확한 역적용 판정, 대상의 main check 증거, 판정 묶음 연결.
// 계획 20261116-ops-security step0.
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runGates } from '../ci/gates.ts';
import { ACTIONS_APP_ID } from '../ci/protection.ts';
import { GATE_CONTEXTS, toStatuses, validateResults } from '../ci/results.ts';
import { targetCheckOf } from '../ci/revert-evidence.ts';
import { planReview } from '../ci/review-plan.ts';
import { revertCheck, revertTarget, type TargetCheck } from '../gates/revert-check.ts';
import { loadConfig } from '../lib/config.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

/** main: init → 대상 커밋(a.txt 수정, new.txt 추가, gone.txt 삭제). 대상의 SHA를 돌려준다 */
function repo(): { root: string; target: string } {
  const root = path.join(tmp('revert-'), 'r');
  gitInit(root);
  write(root, 'a.txt', 'a1\na2\n');
  write(root, 'b.txt', 'b1\n');
  write(root, 'gone.txt', 'x\n');
  commitAll(root, 'init');
  write(root, 'a.txt', 'a1\na2 bad\n');
  write(root, 'new.txt', 'n\n');
  rmSync(path.join(root, 'gone.txt'));
  const target = commitAll(root, 'bad change');
  return { root, target };
}

/** main에서 revert/<대상> 브랜치를 만들고 `git revert`한다 */
function revertBranch(root: string, target: string): void {
  sh('git', ['checkout', '-q', '-b', `revert/${target}`, 'main'], root);
  sh('git', ['revert', '--no-edit', target], root);
}

const amend = (root: string) => {
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '--amend', '--no-edit'], root);
};

function check(root: string, target: string, targetCheck: TargetCheck = 'failure') {
  const base = sh('git', ['merge-base', 'main', 'HEAD'], root);
  return revertCheck({ root, base, branch: `revert/${target}`, targetCheck });
}

test('revertTarget: revert/<40자 소문자 hex>만 받는다', () => {
  const sha = 'a1'.repeat(20);
  assert.equal(revertTarget(`revert/${sha}`), sha);
  for (const b of [
    'feat/20261116-x-s0',
    `revert/${sha.slice(1)}`,
    `revert/${sha}0`,
    `revert/${sha.toUpperCase()}`,
    `revert/${sha}/x`,
    `x/revert/${sha}`,
    `revert/${sha}\n`,
    'revert/HEAD',
    '',
  ])
    assert.equal(revertTarget(b), null, JSON.stringify(b));
});

test('revertCheck: revert/ 꼴이 아닌 브랜치는 해당 없음(success)이고 git을 읽지 않는다', () => {
  const r = revertCheck({
    root: path.join(tmp('revert-'), '없는-폴더'),
    base: 'x',
    branch: 'feat/20261116-x-s0',
    targetCheck: null,
  });
  assert.deepEqual(
    [r.applies, r.verified, r.state, r.description],
    [false, false, 'success', 'revert PR 아님'],
  );
});

test('revertCheck: 정확한 역적용이고 대상의 main check가 실패했으면 확인', () => {
  const { root, target } = repo();
  revertBranch(root, target);
  const r = check(root, target);
  assert.deepEqual([r.applies, r.verified, r.state, r.target], [true, true, 'success', target]);
  assert.match(r.description, /정확한 역적용/);
});

test('revertCheck: 여분 파일, 일부만 되돌림, 한 바이트 차이, 실행 권한만 다름은 실패', () => {
  const cases: [string, (root: string, target: string) => void, RegExp][] = [
    [
      '여분 파일',
      (root) => write(root, 'extra.txt', 'x\n'),
      /바꾸지 않은 파일을 바꿨다: extra\.txt/,
    ],
    [
      '대상이 바꾸지 않은 파일 수정',
      (root) => write(root, 'b.txt', 'b1 changed\n'),
      /바꾸지 않은 파일을 바꿨다: b\.txt/,
    ],
    [
      '일부만 되돌림',
      (root, target) => void sh('git', ['checkout', target, '--', 'new.txt'], root),
      /되돌리지 않았다: new\.txt/,
    ],
    ['한 바이트 차이', (root) => write(root, 'a.txt', 'a1\na2 \n'), /부모와 다르다.*: a\.txt/],
    [
      '실행 권한만 다름',
      (root) => void sh('git', ['update-index', '--chmod=+x', 'a.txt'], root),
      /부모와 다르다.*: a\.txt/,
    ],
  ];
  for (const [name, change, re] of cases) {
    const { root, target } = repo();
    revertBranch(root, target);
    change(root, target);
    if (name === '실행 권한만 다름') sh('git', ['commit', '-q', '--amend', '--no-edit'], root);
    else amend(root);
    const r = check(root, target);
    assert.deepEqual([r.applies, r.verified, r.state], [true, false, 'failure'], name);
    assert.match(r.details.join('\n'), re, name);
    assert.ok(r.description.length <= 140, name);
  }
});

test('revertCheck: main이 대상 뒤로 나아가도 겹치지 않으면 확인, 대상의 파일을 다시 바꿨으면 실패', () => {
  const ok = repo();
  write(ok.root, 'b.txt', 'b1\nb2\n');
  commitAll(ok.root, 'later, other file');
  revertBranch(ok.root, ok.target);
  assert.equal(check(ok.root, ok.target).verified, true);

  // 대상이 바꾼 a.txt를 뒤 커밋이 다시 바꿨다. 손으로 대상 이전 내용으로 돌려도 역적용이 아니다
  const bad = repo();
  write(bad.root, 'a.txt', 'a1\na2 bad\na3\n');
  commitAll(bad.root, 'later, same file');
  sh('git', ['checkout', '-q', '-b', `revert/${bad.target}`, 'main'], bad.root);
  write(bad.root, 'a.txt', 'a1\na2\n');
  write(bad.root, 'gone.txt', 'x\n');
  rmSync(path.join(bad.root, 'new.txt'));
  commitAll(bad.root, 'manual revert');
  const r = check(bad.root, bad.target);
  assert.equal(r.state, 'failure');
  assert.match(r.details.join('\n'), /부모와 다르다.*: a\.txt/);
});

test('revertCheck: 대상이 main의 first-parent 이력에 없거나 병합 커밋이면 실패', () => {
  const { root } = repo();
  // 옆 브랜치의 커밋을 병합 커밋으로 main에 넣는다
  sh('git', ['checkout', '-q', '-b', 'side', 'main'], root);
  write(root, 'side.txt', 's\n');
  const side = commitAll(root, 'side commit');
  sh('git', ['checkout', '-q', 'main'], root);
  sh('git', ['merge', '-q', '--no-ff', '--no-edit', 'side'], root);
  const merge = sh('git', ['rev-parse', 'HEAD'], root);

  sh('git', ['checkout', '-q', '-b', `revert/${side}`, 'main'], root);
  sh('git', ['revert', '--no-edit', side], root);
  const notFirst = check(root, side);
  assert.equal(notFirst.state, 'failure');
  assert.match(notFirst.details[0], /first-parent 이력에 없다/);

  sh('git', ['checkout', '-q', '-b', `revert/${merge}`, 'main'], root);
  sh('git', ['revert', '--no-edit', '-m', '1', merge], root);
  const isMerge = check(root, merge);
  assert.equal(isMerge.state, 'failure');
  assert.match(isMerge.details[0], /병합 커밋이다/);

  const unknown = 'f'.repeat(40);
  sh('git', ['checkout', '-q', '-b', `revert/${unknown}`, 'main'], root);
  const none = check(root, unknown);
  assert.equal(none.state, 'failure');
  assert.match(none.details[0], /first-parent 이력에 없다/);
});

test('revertCheck: 대상의 check가 성공·기록 없음이면 실패, 조회하지 못했으면 error', () => {
  const { root, target } = repo();
  revertBranch(root, target);
  for (const [tc, re] of [
    ['success', /main check가 성공이다/],
    ['none', /main check 기록이 없다/],
  ] as const) {
    const r = check(root, target, tc);
    assert.deepEqual([r.verified, r.state], [false, 'failure'], tc);
    assert.match(r.details.join('\n'), re);
  }
  const unknown = check(root, target, null);
  assert.deepEqual([unknown.applies, unknown.verified, unknown.state], [true, false, 'error']);
  // 역적용이 아니면 조회 결과와 무관하게 실패다
  write(root, 'extra.txt', 'x\n');
  amend(root);
  assert.equal(check(root, target, null).state, 'failure');
  // base가 SHA가 아니면 예외(판정 묶음이 error로 바꾼다)
  assert.throws(
    () => revertCheck({ root, base: 'main', branch: `revert/${target}`, targetCheck: 'failure' }),
    /40자리/,
  );
});

// ---------- 대상의 check 결론 조회 ----------

test('targetCheckOf: Actions App이 만든 이름 check의 최신 run만 본다', async () => {
  const sha = 'b'.repeat(40);
  const run = (over: Record<string, unknown>) => ({
    id: 1,
    name: 'check',
    status: 'completed',
    conclusion: 'success',
    started_at: '2026-11-16T00:00:00Z',
    app: { id: ACTIONS_APP_ID },
    ...over,
  });
  const calls: string[] = [];
  const of = (runs: unknown[]) =>
    targetCheckOf(
      async (p) => {
        calls.push(p);
        return { check_runs: runs };
      },
      'o/r',
      sha,
    );
  assert.equal(await of([run({ conclusion: 'failure' })]), 'failure');
  assert.equal(calls[0], `repos/o/r/commits/${sha}/check-runs?check_name=check&per_page=100`);
  assert.equal(await of([run({ conclusion: 'timed_out' })]), 'failure');
  assert.equal(await of([run({})]), 'success');
  // 다른 App의 같은 이름 run, 이름이 다른 run은 무시한다
  assert.equal(
    await of([
      run({ conclusion: 'failure', app: { id: 999 } }),
      run({ conclusion: 'failure', name: 'check-extra' }),
      run({ conclusion: 'failure', app: null }),
    ]),
    'none',
  );
  // 여러 run 가운데 최신(시작 시각, 같으면 id)
  assert.equal(
    await of([
      run({ id: 1, conclusion: 'failure', started_at: '2026-11-16T00:00:00Z' }),
      run({ id: 2, conclusion: 'success', started_at: '2026-11-16T01:00:00Z' }),
    ]),
    'success',
  );
  assert.equal(
    await of([
      run({ id: 5, conclusion: 'failure', started_at: '2026-11-16T01:00:00Z' }),
      run({ id: 4, conclusion: 'success', started_at: '2026-11-16T01:00:00Z' }),
    ]),
    'failure',
  );
  // 진행 중·취소·건너뜀은 결론이 없는 것으로 본다
  assert.equal(await of([run({ status: 'in_progress', conclusion: null })]), 'none');
  assert.equal(await of([run({ conclusion: 'cancelled' })]), 'none');
  assert.equal(await of([]), 'none');
  // 조회 실패·형식 오류·잘못된 인자는 null
  assert.equal(await targetCheckOf(async () => ({}), 'o/r', sha), null);
  assert.equal(
    await targetCheckOf(
      async () => {
        throw new Error('HTTP 500');
      },
      'o/r',
      sha,
    ),
    null,
  );
  const before = calls.length;
  assert.equal(await of([run({ conclusion: 'failure' })]), 'failure');
  assert.equal(calls.length, before + 1);
  for (const [repo, s] of [
    ['o/r', 'HEAD'],
    ['o/r/../x', sha],
    ['', sha],
  ])
    assert.equal(
      await targetCheckOf(async () => ({ check_runs: [run({ conclusion: 'failure' })] }), repo, s),
      null,
    );
});

// ---------- 판정 묶음 연결 ----------

const HOOKS = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [] }] } });

/** 보호 경로가 있는 리포. 대상 커밋이 훅 설정과 스크립트를 더한다 */
function gatedRepo(): { root: string; target: string } {
  const root = path.join(tmp('revert-'), 'pr');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ protectedPaths: ['.claude/**', 'scripts/**'] })),
  );
  write(root, 'scripts/a.ts', 'export const a = 1;\n');
  commitAll(root, 'init');
  write(root, '.claude/settings.json', HOOKS);
  write(root, 'scripts/a.ts', 'export const a = 2;\n');
  const target = commitAll(root, 'add hook');
  return { root, target };
}

async function gates(root: string, target: string, tc: TargetCheck) {
  let asked = 0;
  const r = await runGates({
    root,
    cfg: loadConfig(root),
    base: sh('git', ['merge-base', 'main', 'HEAD'], root),
    branch: `revert/${target}`,
    headSha: sh('git', ['rev-parse', 'HEAD'], root),
    prBody: 'Refs #1\n',
    reviews: [],
    targetCheck: async () => {
      asked++;
      return tc;
    },
  });
  const by = (c: string) => r.results.find((x) => x.context === c)!;
  return { r, by, asked: () => asked };
}

test('runGates: 확인된 revert PR은 계획 없이 plan-gate success, 작성자 체크리스트 면제, 신호는 그대로', async () => {
  const { root, target } = gatedRepo();
  revertBranch(root, target);
  const { r, by, asked } = await gates(root, target, 'failure');
  assert.deepEqual(
    r.results.map((x) => x.context),
    [...GATE_CONTEXTS],
  );
  assert.equal(r.results[0].context, 'revert-check');
  assert.equal(by('revert-check').state, 'success', by('revert-check').details.join('\n'));
  assert.equal(asked(), 1);
  assert.equal(by('plan-gate').state, 'success');
  assert.match(by('plan-gate').description, /revert PR: 계획 불필요/);
  // CHANGELOG·PR 본문 줄이 없어도 실패하지 않는다. 훅 설정 삭제는 신호로 남아 위험도 높음이다
  const hg = by('harness-guard');
  assert.equal(hg.state, 'success', hg.details.join('\n'));
  assert.match(hg.details.join('\n'), /신호\(위험도 높음\): \.claude\/settings\.json: 삭제/);
  assert.equal(r.risk, 'high');
  // 제작자 승인이 없으면 risk-gate가 막는다(revert라도 완화 신호는 사람이 본다)
  assert.equal(by('risk-gate').state, 'failure');
});

test('runGates: 확인되지 않은 revert/ PR은 revert-check 실패이고 다른 판정은 평소대로다', async () => {
  const { root, target } = gatedRepo();
  revertBranch(root, target);
  const { by } = await gates(root, target, 'success');
  assert.equal(by('revert-check').state, 'failure');
  assert.match(by('revert-check').description, /main check가 성공이다/);
  assert.equal(by('plan-gate').state, 'failure');
  assert.equal(by('harness-guard').state, 'failure');
  assert.match(by('harness-guard').description, /CHANGELOG/);

  // 조회 함수를 주지 않으면 조회하지 못한 것으로 본다(fail-closed)
  const r = await runGates({
    root,
    cfg: loadConfig(root),
    base: sh('git', ['merge-base', 'main', 'HEAD'], root),
    branch: `revert/${target}`,
    headSha: sh('git', ['rev-parse', 'HEAD'], root),
  });
  assert.equal(r.results[0].state, 'error');
  assert.equal(r.results.find((x) => x.context === 'plan-gate')!.state, 'failure');
});

test('runGates: revert/ 꼴이 아닌 브랜치는 대상의 check를 조회하지 않는다', async () => {
  const { root, target } = gatedRepo();
  sh('git', ['checkout', '-q', '-b', 'feat/20261116-x-s0', 'main'], root);
  write(root, 'src/x.ts', 'export {}\n');
  commitAll(root, 'x');
  let asked = 0;
  const r = await runGates({
    root,
    cfg: loadConfig(root),
    base: target,
    branch: 'feat/20261116-x-s0',
    headSha: sh('git', ['rev-parse', 'HEAD'], root),
    targetCheck: async () => {
      asked++;
      return 'failure';
    },
  });
  assert.equal(asked, 0);
  assert.deepEqual(
    [r.results[0].context, r.results[0].state, r.results[0].description],
    ['revert-check', 'success', 'revert PR 아님'],
  );
});

test('planReview: 확인된 revert는 두 검증자를 돌리지 않고 위험도는 그대로 계산한다', () => {
  const { root, target } = gatedRepo();
  revertBranch(root, target);
  const o = {
    root,
    cfg: loadConfig(root),
    base: sh('git', ['merge-base', 'main', 'HEAD'], root),
    branch: `revert/${target}`,
  };
  const plain = planReview(o);
  assert.deepEqual([plain.risk, plain.claude, plain.codex], ['high', true, true]);
  const verified = planReview({ ...o, revert: check(root, target) });
  assert.deepEqual([verified.risk, verified.claude, verified.codex], ['high', false, false]);
  assert.ok(verified.reasons.includes('revert-check가 확인한 revert PR'));
  // 확인되지 않은 결과는 평소대로다
  const failed = planReview({ ...o, revert: check(root, target, 'success') });
  assert.deepEqual([failed.claude, failed.codex], [true, true]);
});

test('validateResults·toStatuses: revert-check context를 받는다', () => {
  const sha = 'c'.repeat(40);
  const raw = {
    version: 1,
    headSha: sha,
    results: GATE_CONTEXTS.map((context) => ({
      context,
      state: 'success',
      description: '통과',
      details: [],
    })),
  };
  const v = validateResults(raw, { headSha: sha, contexts: GATE_CONTEXTS });
  assert.equal(v.ok, true);
  assert.equal(GATE_CONTEXTS[0], 'revert-check');
  const statuses = toStatuses(v.ok ? v.value : null, GATE_CONTEXTS, 'x');
  assert.deepEqual(statuses[0], { context: 'revert-check', state: 'success', description: '통과' });
  // 결과 파일에 없으면 그 context는 error다(fail-closed)
  raw.results = raw.results.filter((x) => x.context !== 'revert-check');
  const missing = validateResults(raw, { headSha: sha, contexts: GATE_CONTEXTS });
  assert.equal(toStatuses(missing.ok ? missing.value : null, GATE_CONTEXTS, 'x')[0].state, 'error');
});
