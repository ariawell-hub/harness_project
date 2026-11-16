// R20: 제작자 권한 명령이 L1 훅에서 실제로 차단되는가(설계서 5.1절, 13.1절, 12.4절).
// 훅이 경고만 하고 통과시키지 않는지 본다: 종료 코드가 정확히 2여야 한다.
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'r20-owner-commands',
  covers: 'R20',
  title: 'PR 승인·계정 전환·보호 설정 변경·토큰 교체를 훅이 종료 코드 2로 막는다',
  run(ctx) {
    const s = ctx.sample();
    const bash = (command: string) => ctx.hook(s, { tool_name: 'Bash', tool_input: { command } });
    for (const command of [
      'gh pr review 7 --approve',
      'gh auth switch',
      'gh auth login',
      'gh api -X PUT repos/o/r/branches/main/protection -f enforce_admins=false',
      'GH_TOKEN=other gh pr view 7',
    ])
      assertBlocked(bash(command), /R20/, command);
    // 대조군
    assertAllowed(bash('gh pr view 7'), 'gh pr view 7');
  },
} satisfies Scenario;
