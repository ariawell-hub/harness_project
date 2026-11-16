// S1: 새 세션이 선점되지 않은 다음 작업을 찾는가(설계서 4.5절, 12.4절).
import assert from 'node:assert/strict';
import { assertAllowed, type Scenario } from '../run.ts';

export default {
  id: 's1-next-task',
  covers: 'S1',
  title: '`next`·`start`가 선점되지 않은 제작자 Issue를 고른다(선점된 Issue와 봇 Issue는 건너뛴다)',
  run(ctx) {
    const s = ctx.sample();
    const claimed = s.issue('남이 선점한 작업');
    const free = s.issue('선점되지 않은 작업');
    const fromBot = s.issue('봇이 제안한 작업', { author: s.bot });
    // 다른 작업자의 선점: 원격의 claim/<N> 브랜치
    const claim = s.git([
      'commit-tree',
      'HEAD^{tree}',
      '-p',
      'HEAD',
      '-m',
      `claim #${claimed} by other-worker at ${new Date().toISOString()}`,
    ]);
    s.git(['push', '-q', 'origin', `${claim}:refs/heads/claim/${claimed}`]);

    const next = ctx.cli(s, ['next', '--json']);
    assertAllowed(next, 'next --json');
    const pick = JSON.parse(next.stdout) as { reason: string; summary: string };
    assert.match(pick.summary, new RegExp(`#${free}\\b`), `next가 고른 것: ${pick.summary}`);
    assert.doesNotMatch(pick.summary, new RegExp(`#(${claimed}|${fromBot})\\b`));

    const start = ctx.cli(s, ['start']);
    assertAllowed(start, 'start');
    const todo = start.stdout.split('다음 할 일')[1] ?? '';
    assert.match(todo, new RegExp(`Issue #${free}\\b`), 'start의 "다음 할 일"에 번호가 없다');

    // 대조군: 선점이 없으면 가장 앞의 제작자 Issue를 고른다(선점 때문에 건너뛴 것이 맞다)
    const s2 = ctx.sample();
    const first = s2.issue('첫 작업');
    s2.issue('둘째 작업');
    const next2 = ctx.cli(s2, ['next', '--json']);
    assertAllowed(next2, '대조군 next --json');
    assert.match(
      (JSON.parse(next2.stdout) as { summary: string }).summary,
      new RegExp(`#${first}\\b`),
    );
  },
} satisfies Scenario;
