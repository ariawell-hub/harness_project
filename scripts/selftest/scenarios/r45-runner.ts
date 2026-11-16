// 4.5절: runner가 Issue 여러 개를 사람 없이 끝까지 처리하는가. 세션의 "완료" 주장이 아니라 AC로 판정하고,
// 세션 시간 초과·사용량 한도와 한 계획의 중단 뒤에도 죽지 않고 다른 Issue를 처리하는가(설계서 4.5절, 12.4절).
import assert from 'node:assert/strict';
import { assertAllowed, runnerConfig, type Scenario } from '../run.ts';

interface State {
  issues: { number: number; state: string; labels: string[] }[];
  prs: { head: string; state: string; body: string }[];
}

export default {
  id: 'r45-runner',
  covers: '4.5',
  title:
    'runner가 step 2개짜리 Issue와 다른 Issue를 끝까지 처리한다(AC로 판정, 시간 초과·사용량 한도·중단 뒤에도 계속)',
  timeoutSec: 300,
  run(ctx) {
    const s = ctx.sample({
      config: runnerConfig(ctx.harness, {
        planReview: { required: false },
        failure: { switchAt: 3, stopAt: 5 },
        // 시간 초과 세션 하나가 이만큼 걸린다
        limits: { sessionTimeoutMin: 0.1 },
      }),
    });
    const gamma = s.issue('Gamma feature', { body: '끝내 완료되지 않는다' });
    const alpha = s.issue('Alpha feature', { body: 'step 2개' });
    const beta = s.issue('Beta feature', { body: 'step 1개' });
    ctx.agent(s, {
      // 시간 초과와 사용량 한도 한 번씩, 그 뒤로는 "완료했다"고만 한다: 5회 실패로 멈춘다
      'gamma-feature': { steps: 1, '0': ['timeout', 'limit', ...Array<string>(8).fill('fail')] },
      // 첫 세션은 "완료했다"고만 한다. 다음 세션이 실제로 만든다
      'alpha-feature': { steps: 2, '0': ['fail'] },
      'beta-feature': { steps: 1 },
    });
    const ran = ctx.cli(s, [
      'run',
      '--worker',
      'selftest-1',
      '--tool',
      'fake',
      '--no-wait',
      '--max-iterations',
      '80',
    ]);
    assertAllowed(ran, 'runner(시간 초과·사용량 한도·중단 뒤에도 끝까지 돈다)');

    const sessions = (slug: string) =>
      s.prompts().filter((p) => p.slug === slug && p.step === '0').length;
    assert.ok(
      sessions('alpha-feature') >= 2,
      '세션이 "완료"라고만 했는데 AC 실패를 보지 않고 step을 넘겼다(step 세션을 다시 띄우지 않았다)',
    );

    const state = ctx.github(s).read() as State;
    const issue = (n: number) => state.issues.find((i) => i.number === n)!;
    assert.equal(issue(gamma).state, 'open', 'AC가 끝내 실패한 Issue가 닫혔다');
    assert.ok(issue(gamma).labels.includes('needs-human'), '멈춘 Issue에 needs-human이 없다');
    assert.ok(
      !state.prs.some((p) => p.head.includes('gamma-feature')),
      'AC가 통과한 적 없는 step의 PR이 만들어졌다',
    );
    assert.equal(issue(alpha).state, 'closed', 'step 2개짜리 Issue가 닫히지 않았다');
    assert.equal(issue(beta).state, 'closed', '중단된 계획 뒤의 Issue를 처리하지 않았다');

    const merged = (slug: string) =>
      state.prs.filter((p) => p.head.includes(slug) && p.state === 'merged').map((p) => p.body);
    const a = merged('alpha-feature');
    assert.equal(a.length, 2, `step 하나에 PR 하나여야 한다(병합된 PR ${a.length}개)`);
    assert.match(a[0], new RegExp(`^Refs #${alpha}\\b`), '첫 step의 PR은 Refs여야 한다');
    assert.match(a[1], new RegExp(`^Closes #${alpha}\\b`), '마지막 step의 PR은 Closes여야 한다');
    assert.equal(merged('beta-feature').length, 1);

    s.git(['fetch', '-q', 'origin']);
    const tree = s.git(['ls-tree', '-r', '--name-only', 'origin/main']).split('\n');
    for (const f of ['alpha-feature-s0', 'alpha-feature-s1', 'beta-feature-s0'])
      assert.ok(tree.includes(`out/${f}.txt`), `main에 out/${f}.txt가 없다`);
    assert.ok(!tree.includes('out/gamma-feature-s0.txt'));
  },
} satisfies Scenario;
