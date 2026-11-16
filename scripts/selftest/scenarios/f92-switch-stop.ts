// 9.2절: 같은 실패가 3회면 다음 세션에 방법 전환을 지시하고, 5회면 계획을 멈춰 제작자에게 보고하는가(설계서 9.2절, 12.4절).
import assert from 'node:assert/strict';
import { assertAllowed, runnerConfig, type Scenario } from '../run.ts';

interface State {
  issues: { number: number; state: string; labels: string[]; comments: { body: string }[] }[];
  prs: { state: string }[];
}

export default {
  id: 'f92-switch-stop',
  covers: '9.2',
  title:
    '같은 실패 3회 뒤의 세션에 방법 전환을 지시하고, 5회에 계획을 멈춰 중단 보고와 `needs-human`을 남긴다',
  timeoutSec: 300,
  run(ctx) {
    const s = ctx.sample({
      config: runnerConfig(ctx.harness, {
        planReview: { required: false },
        failure: { switchAt: 3, stopAt: 5 },
      }),
    });
    const issue = s.issue('Alpha feature', { body: '알파 기능을 만든다' });
    // step 세션이 매번 "완료했다"고만 하고 아무것도 만들지 않는다: AC가 같은 키로 계속 실패한다
    ctx.agent(s, { 'alpha-feature': { steps: 1, '0': Array<string>(8).fill('fail') } });
    const ran = ctx.cli(s, [
      'run',
      '--worker',
      'selftest-1',
      '--tool',
      'fake',
      '--no-wait',
      '--max-iterations',
      '30',
    ]);
    assertAllowed(ran, 'runner');

    const sessions = s.prompts().filter((p) => p.slug === 'alpha-feature' && p.step === '0');
    assert.equal(
      sessions.length,
      5,
      `step 세션이 5회가 아니다(${sessions.length}회). 5회 실패에 멈춰야 한다`,
    );
    sessions.forEach((p, i) =>
      assert.equal(
        p.prompt.includes('방법 전환 지시'),
        i >= 3,
        `${i + 1}번째 세션의 프롬프트: 방법 전환 지시는 같은 실패 3회 뒤에만 있어야 한다`,
      ),
    );

    const state = ctx.github(s).read() as State;
    const it = state.issues.find((i) => i.number === issue)!;
    assert.equal(it.state, 'open', '멈춘 계획의 Issue가 닫혔다');
    assert.ok(it.labels.includes('needs-human'), 'Issue에 needs-human 라벨이 없다');
    assert.ok(
      it.comments.some((c) => c.body.includes('중단 보고') && c.body.includes(`@${s.owner}`)),
      'Issue에 제작자를 멘션한 "중단 보고" 댓글이 없다',
    );
    assert.equal(state.prs.length, 0, '완료되지 않은 step의 PR이 만들어졌다');

    // 계획이 blocked로 원격 브랜치에 올라가 있다
    s.git(['fetch', '-q', 'origin']);
    const branch = s
      .git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
      .split('\n')
      .find((b) => /alpha-feature/.test(b));
    assert.ok(branch, '멈춘 계획의 브랜치가 원격에 없다');
    const planFile = s
      .git(['ls-tree', '-r', '--name-only', branch, '--', 'docs/exec-plans/active'])
      .split('\n')
      .find((f) => /alpha-feature(\/plan)?\.md$/.test(f));
    assert.ok(planFile, '원격 브랜치에 계획 파일이 없다');
    assert.match(
      s.git(['show', `${branch}:${planFile}`]),
      /^status: blocked\b/m,
      '계획의 status가 blocked가 아니다',
    );
  },
} satisfies Scenario;
