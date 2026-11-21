// R13: 금지 DB 명령이 L1 훅에서 차단되는가(설계서 14.3절, 12.4절).
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'r13-db',
  covers: 'R13',
  title:
    '데이터 삭제·스키마 파괴·스키마 diff 자동 적용·DB 직접 접속을 훅이 막는다(읽기 명령은 통과)',
  run(ctx) {
    // 프로파일이 채우는 차단 목록(guard.dbPatterns·dbClients)도 함께 확인한다.
    // guard.dbCommands는 하위 명령을 인자 배열의 자리로 본다(값에 공백이 든 호출도 가른다)
    const s = ctx.sample({
      config: {
        guard: {
          dbPatterns: ['\\bknex\\s+migrate:rollback\\b'],
          dbClients: ['cockroach'],
          dbCommands: [{ tool: 'drizzle-kit', forbidden: ['migrate'] }],
        },
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
      'npx drizzle-kit --config "team config.ts" migrate', // 설정의 dbCommands: 값에 공백이 든 플래그 뒤의 금지 하위 명령
      'npx drizzle-kit@latest --config x push', // 코어의 기본 항목: 버전을 붙이고 플래그가 앞에 온 호출
      'npx drizzle-kit > out.txt --config x migrate', // 리다이렉션은 인자가 아니다
    ])
      assertBlocked(bash(command), /R13/, command);
    // 대조군: 같은 도구의 읽기 명령
    for (const command of [
      'npx prisma migrate status',
      'npx knex migrate:status',
      // 같은 도구의 허용된 하위 명령: 값 안에 금지 이름과 같은 낱말이 있어도 통과한다
      'npx drizzle-kit --config "team migrate config.ts" generate',
    ])
      assertAllowed(bash(command), command);
  },
} satisfies Scenario;
