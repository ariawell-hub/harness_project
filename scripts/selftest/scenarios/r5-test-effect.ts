// R5: 변경 전 코드에서도 통과하는 테스트 파일을 더한 변경이 막히는가(설계서 5.1절, 12.4절).
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertAllowed, type Scenario } from '../run.ts';

export default {
  id: 'r5-test-effect',
  covers: 'R5',
  title:
    '변경 전 코드에서도 통과하는 테스트 파일을 더한 커밋은 `test-effect`가 실패하고, 계획 파일의 예외 줄이 있으면 통과한다',
  run(ctx) {
    const s = ctx.sample();
    const wt = path.join(path.dirname(s.root), 'work');
    s.git(['worktree', 'add', '-q', '-b', 'feat/20260101-work', wt, 'origin/main']);
    const commit = (files: Record<string, string>, msg: string) => {
      for (const [rel, content] of Object.entries(files)) s.write(rel, content, wt);
      s.git(['add', '-A'], wt);
      s.git(['commit', '-q', '-m', msg], wt);
    };
    const run = () => ctx.cli(s, ['test-effect', '--ci'], { cwd: wt });
    const HEAD = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n";

    // 대조군: 변경 전 코드에서 실패하는 테스트(확인하는 코드를 같은 커밋에 더한다)는 통과한다
    commit(
      {
        'scripts/selftest-sample/feature.ts': 'export const answer = () => 42;\n',
        'scripts/test/zz-feature.test.ts': `${HEAD}import { answer } from '../selftest-sample/feature.ts';\ntest('answer', () => assert.equal(answer(), 42));\n`,
      },
      'feat: answer',
    );
    const good = run();
    assertAllowed(good, '변경 전 코드에서 실패하는 테스트를 더한 커밋의 test-effect');
    assert.match(good.stdout, /zz-feature\.test\.ts: effective/, '판정 줄에 effective가 없다');

    // 변경 전 코드에서도 통과하는 테스트 파일
    commit(
      { 'scripts/test/zz-noop.test.ts': `${HEAD}test('noop', () => assert.equal(1, 1));\n` },
      'test: noop',
    );
    const bad = run();
    assert.notEqual(
      bad.code,
      0,
      '변경 전 코드에서도 통과하는 테스트를 더한 커밋에서 test-effect가 통과했다',
    );
    assert.match(bad.stderr, /R5/, 'test-effect 실패 사유에 R5가 없다');

    // 고치는 법이 낸 예외 줄에 사유를 채워 계획 파일에 적으면 통과한다
    const line = /- test-effect 예외: `[^`]+` @ `[0-9a-f]{40}` — 사유: <한 줄>/.exec(bad.stderr);
    assert.ok(line, '실패 출력의 고치는 법에 예외 줄이 없다');
    commit(
      {
        'docs/exec-plans/active/20260101-work.md': `# 계획\n\n## 의사결정 로그\n\n${line[0].replace('<한 줄>', '기존 동작을 확인하는 테스트다')}\n`,
      },
      'docs: 예외',
    );
    const exempt = run();
    assertAllowed(exempt, '예외 줄을 계획 파일에 적은 커밋의 test-effect');
    assert.match(exempt.stdout, /zz-noop\.test\.ts: exempt/, '판정 줄에 exempt가 없다');

    // 예외를 적은 뒤 테스트 파일을 다시 고치면 예외가 풀린다
    commit(
      { 'scripts/test/zz-noop.test.ts': `${HEAD}test('noop', () => assert.equal(2, 2));\n` },
      'test: noop 수정',
    );
    assert.notEqual(run().code, 0, '예외를 적은 뒤 고친 테스트 파일이 예외로 통과했다');
  },
} satisfies Scenario;
