// R1: 계획 없이 코드를 고친 브랜치가 plan-gate와 L1 훅에서 막히는가(설계서 5.1절, 12.4절).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'r1-plan-gate',
  covers: 'R1',
  title: '계획 없는 브랜치는 `plan-gate`가 실패하고 훅이 코드 수정을 막는다(계획이 있으면 통과)',
  run(ctx) {
    const s = ctx.sample();
    const edit = (cwd: string, rel: string) =>
      ctx.hook(
        s,
        {
          tool_name: 'Edit',
          tool_input: { file_path: path.join(cwd, rel), old_string: 'a', new_string: 'b' },
        },
        { cwd },
      );
    const commitCode = (cwd: string) => {
      s.write('src/demo.ts', 'export const demo = 1;\n', cwd);
      s.git(['add', '-A'], cwd);
      s.git(['commit', '-q', '-m', 'feat: 데모 상수'], cwd);
    };

    // 계획 없이 만든 브랜치·worktree
    const bare = path.join(path.dirname(s.root), 'no-plan');
    s.git(['worktree', 'add', '-q', '-b', 'feat/20260101-no-plan', bare, 'origin/main']);
    assertBlocked(edit(bare, 'src/demo.ts'), /R1/, '계획 없는 worktree의 코드 Edit');
    commitCode(bare);
    const gate = ctx.cli(s, ['plan-gate'], { cwd: bare });
    assert.notEqual(gate.code, 0, '계획 없이 코드를 바꾼 브랜치에서 plan-gate가 통과했다');
    assert.match(gate.stderr, /R1/, 'plan-gate 실패 사유에 R1이 없다');

    // 대조군: new-task로 계획을 만들고 채운 브랜치
    const issue = s.issue('데모 상수를 더한다');
    const made = ctx.cli(s, [
      'new-task',
      '--issue',
      String(issue),
      '--slug',
      'demo',
      '--size',
      'small',
      '--no-setup',
    ]);
    assertAllowed(made, 'new-task');
    const info = JSON.parse(/^\{[\s\S]*?^\}/m.exec(made.stdout)?.[0] ?? 'null') as {
      worktree: string;
      planFile: string;
    };
    const planned = info.worktree;
    const plan = path.join(planned, info.planFile);
    writeFileSync(
      plan,
      readFileSync(plan, 'utf8')
        .replace('status: draft', 'status: active')
        .replace('- 목표:', '- 목표: 데모 상수를 더한다')
        .replace('- 변경:', '- 변경: `src/demo.ts`')
        .replace('- 검증:', '- 검증: `test -f src/demo.ts`'),
    );
    assertAllowed(edit(planned, 'src/demo.ts'), '계획이 있는 worktree의 코드 Edit');
    commitCode(planned);
    assertAllowed(ctx.cli(s, ['complete-step'], { cwd: planned }), 'complete-step');
    assertAllowed(ctx.cli(s, ['plan-gate'], { cwd: planned }), '계획이 있는 브랜치의 plan-gate');
  },
} satisfies Scenario;
