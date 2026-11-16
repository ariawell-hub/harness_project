// R4: 검사를 건너뛰는 변경과 명령이 막히는가(설계서 5.1절, 12.4절).
import assert from 'node:assert/strict';
import path from 'node:path';
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'r4-bypass',
  covers: 'R4',
  title:
    '`.skip`을 더한 커밋은 `bypass-scan`이 실패하고 훅이 `--no-verify`와 검사 뒤 파이프를 막는다',
  run(ctx) {
    const s = ctx.sample();
    const wt = path.join(path.dirname(s.root), 'work');
    s.git(['worktree', 'add', '-q', '-b', 'feat/20260101-work', wt, 'origin/main']);
    const commit = (rel: string, content: string) => {
      s.write(rel, content, wt);
      s.git(['add', '-A'], wt);
      s.git(['commit', '-q', '-m', `test: ${rel}`], wt);
    };
    const TEST = "import { test } from 'node:test';\n";

    // 대조군: 건너뛰지 않는 테스트는 통과한다
    commit('src/a.test.ts', `${TEST}test('a', () => {});\n`);
    assertAllowed(
      ctx.cli(s, ['bypass-scan', '--ci'], { cwd: wt }),
      '.skip 없는 커밋의 bypass-scan',
    );

    // 이 파일이 이 리포의 bypass-scan에 걸리지 않게 금지 구문을 이어 붙여 만든다
    commit('src/b.test.ts', `${TEST}${['test', 'skip'].join('.')}('b', () => {});\n`);
    const scan = ctx.cli(s, ['bypass-scan', '--ci'], { cwd: wt });
    assert.notEqual(scan.code, 0, '.skip을 더한 커밋에서 bypass-scan이 통과했다');
    assert.match(scan.stderr, /R4/, 'bypass-scan 실패 사유에 R4가 없다');

    const bash = (command: string) =>
      ctx.hook(s, { tool_name: 'Bash', tool_input: { command } }, { cwd: wt });
    assertBlocked(bash('git commit --no-verify -m wip'), /R4/, 'git commit --no-verify');
    assertBlocked(bash('node scripts/harness.ts check | tail -1'), /R4/, 'check 뒤 파이프');
    // 대조군
    assertAllowed(bash('git commit -m wip'), 'git commit');
    assertAllowed(bash('node scripts/harness.ts check'), 'check');
  },
} satisfies Scenario;
