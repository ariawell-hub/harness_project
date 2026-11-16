// R13: 금지 DB 명령이 L1 훅에서 차단되는가(설계서 14.3절, 12.4절).
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'r13-db',
  covers: 'R13',
  title:
    '데이터 삭제·스키마 파괴·스키마 diff 자동 적용·DB 직접 접속을 훅이 막는다(읽기 명령은 통과)',
  run(ctx) {
    // 프로파일이 채우는 차단 목록(guard.dbPatterns·dbClients)도 함께 확인한다
    const s = ctx.sample({
      config: {
        guard: { dbPatterns: ['\\bknex\\s+migrate:rollback\\b'], dbClients: ['cockroach'] },
      },
    });
    const bash = (command: string) => ctx.hook(s, { tool_name: 'Bash', tool_input: { command } });
    for (const command of [
      'psql -c "DROP TABLE users"', // 스키마 파괴 + 직접 접속
      `node -e "db.query('DELETE FROM users')"`, // 데이터 삭제
      'npx prisma migrate reset', // 초기화
      'npx prisma db push --accept-data-loss', // 스키마 diff 자동 적용
      'npx knex migrate:rollback', // 설정의 dbPatterns
      'cockroach sql -e "select 1"', // 설정의 dbClients
    ])
      assertBlocked(bash(command), /R13/, command);
    // 대조군: 같은 도구의 읽기 명령
    for (const command of ['npx prisma migrate status', 'npx knex migrate:status'])
      assertAllowed(bash(command), command);
  },
} satisfies Scenario;
