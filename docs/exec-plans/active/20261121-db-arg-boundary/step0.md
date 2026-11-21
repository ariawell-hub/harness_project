# Step 0: argv-rule

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 14.3절(R13. 읽기만), 13.1절(L1 훅), 12.4절(자체 테스트의 `r13-db` 행)
- `scripts/hooks/rules.ts`(`dbRules`, `DB_PATTERNS`, `DB_CLIENTS`, `GuardContext`, `evaluate`), `scripts/hooks/shell.ts`(`parseShell`, `SimpleCommand`, `commandName`, `baseName`), `scripts/hooks/guard.ts`(`loadGuardConfig`와 `guard.mcp`를 읽는 길), `scripts/lib/config.ts`(`guard`의 타입, `resolveMcpGuard`가 문제를 알리는 방식)
- `scripts/test/guard.test.ts`(규칙 표와 훅을 프로세스로 부르는 테스트), `scripts/test/helpers.ts`, `scripts/selftest/scenarios/r13-db.ts`, `scripts/selftest/run.ts`

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 인자 배열 판정 (`scripts/hooks/db-commands.ts`, 새 파일)

입출력이 없는 순수 함수다. 정규식으로 인자 배열 전체를 훑지 않는다.

```ts
export interface DbCommandRule {
  /** 도구 이름(예: `drizzle-kit`). 소문자로 비교한다 */
  tool: string;
  /** 금지 하위 명령. 낱말이 둘 이상이면 공백으로 나눠 적는다(예: `db push`). 소문자로 비교한다 */
  forbidden: string[];
}
/** 금지 호출이면 걸린 도구와 하위 명령을, 아니면 null을 돌려준다 */
export function matchDbCommand(
  argv: string[],
  rules: DbCommandRule[],
): { tool: string; sub: string } | null;
```

판정 규칙:

- **도구 자리 찾기**: 인자를 `/`와 `\`로 나눈 조각 가운데 하나가, 실행 파일 확장자(`.exe`·`.cmd`·`.bat`·`.com`)를 떼고 소문자로 바꿨을 때 `tool`과 같거나 `tool@`로 시작하면 그 인자가 도구 자리다. 그래서 `drizzle-kit`, `drizzle-kit@0.31.11`, `./node_modules/.bin/drizzle-kit`, `node_modules/drizzle-kit/bin.cjs`, `node_modules\.bin\drizzle-kit.cmd`가 모두 도구 자리다. 인자 하나에 공백으로 이어진 글(`"drizzle-kit push"`)은 조각이 `tool`과 같지 않으므로 도구 자리가 아니다(그 글은 있던 정규식이 본다). 도구 자리가 여러 곳이면 자리마다 판정하고 하나라도 걸리면 금지다.
- **걷기**: 도구 자리 다음 인자부터 차례로 본다. `플래그 뒤`라는 상태 하나를 둔다(처음에는 거짓).
  - 인자가 없으면 끝이다(금지 아님).
  - 인자가 `--`이면 그다음 인자가 하위 명령이다. 그 자리에서 금지 목록과 비교하고 끝낸다.
  - 인자가 `-`로 시작하면 플래그다. `플래그 뒤`를 참으로 하고 다음으로 간다(`--name=x`처럼 값이 붙은 플래그도 플래그 하나다).
  - 그 밖의 인자(빈 글 포함)는 먼저 그 자리에서 금지 목록과 비교한다. 걸리면 금지다. 걸리지 않았고 `플래그 뒤`가 참이면 플래그의 값일 수 있으므로 `플래그 뒤`를 거짓으로 하고 다음으로 간다. `플래그 뒤`가 거짓이면 그 인자가 하위 명령이므로 끝낸다(금지 아님. 허용된 하위 명령 뒤의 인자는 보지 않는다).
- **금지 목록과 비교**: 금지 항목을 공백으로 나눈 낱말 열이 그 자리부터의 인자들과 차례로 같으면(소문자 비교, 인자 전체가 같아야 한다) 걸린 것이다. `db push`는 인자 `db` 다음에 인자 `push`가 올 때만 걸린다. 인자 `team migrate x.ts`는 `migrate`와 같지 않다.
- 인자 수에 비례하는 시간에 끝난다(도구 자리마다 뒤를 다시 걷더라도 규칙 수 × 인자 수의 제곱을 넘지 않게 하고, 인자 20,000개에서 시간 제한 안에 끝나야 한다).

### 2. 규칙에 잇기 (`scripts/hooks/rules.ts`)

- `GuardContext`에 `dbCommands?: DbCommandRule[]`를 더한다(없으면 빈 목록).
- 코어 기본 항목 `DB_COMMANDS`: `{ tool: 'drizzle-kit', forbidden: ['push'] }`, `{ tool: 'prisma', forbidden: ['db push', 'migrate reset'] }`.
- `dbRules`는 있던 판정(DB 클라이언트, 정규식)을 그대로 한 뒤, 걸리지 않았으면 `matchDbCommand(c.argv, [...DB_COMMANDS, ...ctx.dbCommands])`를 돌린다. 걸리면 `R13 DB 위험 작업`으로 막는다. 메시지에는 도구와 하위 명령을 적고, "고치는 법"에 있던 문구와 함께 "플래그의 값이 금지 하위 명령과 같은 글이면 `--이름=값`으로 붙여 써라"를 적는다.
- 있던 `DB_PATTERNS`·`DB_CLIENTS`의 항목과 정규식 판정의 순서·문구를 바꾸지 않는다.

### 3. 설정 (`scripts/lib/config.ts`, `scripts/hooks/guard.ts`, `harness.config.json`, `profiles/core/profile.json`)

- `guard`의 타입에 `dbCommands: DbCommandRule[]`를 더한다.
- 검사 함수를 `guard.mcp`의 것(`resolveMcpGuard`)과 같은 모양으로 둔다: 키가 없으면 빈 목록. 배열이 아니거나, 항목이 객체가 아니거나, 모르는 키가 있거나, `tool`이 빈 글이거나 공백·`/`·`\`를 담거나, `forbidden`이 비었거나 빈 글을 담으면 문제로 알린다.
- L1 훅(`guard.ts`)도 이 함수로 읽는다. 설정이 틀렸을 때 훅이 하는 일은 `guard.mcp`가 틀렸을 때와 같게 한다(그 길을 먼저 읽고 따른다). 틀린 항목만 조용히 버리고 나머지로 판정하지 않는다.
- `harness.config.json`과 `profiles/core/profile.json`의 `guard`에 `"dbCommands": []`를 더한다.

### 4. 테스트

- `scripts/test/db-commands.test.ts`(새 파일. `matchDbCommand`와, `parseShell`로 푼 명령을 `evaluate`에 넣는 것 둘 다):
  - 막힘: `drizzle-kit migrate`, `drizzle-kit --config x migrate`, `drizzle-kit --config "team config.ts" migrate`, `drizzle-kit --config=x migrate`, `drizzle-kit -- migrate`, `npx drizzle-kit@latest migrate`, `pnpm exec drizzle-kit migrate`, `pnpm dlx drizzle-kit@0.31.11 migrate`, `node node_modules/drizzle-kit/bin.cjs migrate`, `./node_modules/.bin/drizzle-kit migrate`, 대문자를 섞은 것, 플래그가 500개 앞에 오는 것(설정: `drizzle-kit`의 `migrate`·`push`·`drop`).
  - 통과: `drizzle-kit generate`, `drizzle-kit generate --name migrate`, `drizzle-kit --config a generate --name migrate`, `drizzle-kit --config "team local migrate config.ts" generate`, `drizzle-kit --config "a migrate" generate`, `drizzle-kit --name=migrate generate`, `echo drizzle-kit`, `cat docs/drizzle-kit/migrate.md`.
  - **경계**: 인자가 다르고 이은 글이 같은 두 호출(`parseShell`로 인자가 다름과 이은 글이 같음을 먼저 단언한다)이 다르게 판정된다: `drizzle-kit --config "team config.ts" migrate`(막힘)와 `drizzle-kit --config "team config.ts migrate"`(통과), `drizzle-kit --config "a generate" --name migrate`(막힘)와 `drizzle-kit --config a generate --name migrate`(통과).
  - 알려진 대가를 단언으로 남긴다: `drizzle-kit --verbose generate --name migrate`는 막히고 `drizzle-kit --verbose generate --name=migrate`는 통과한다.
  - 낱말이 둘인 항목: `prisma db push`, `prisma --schema x db push`, `npx prisma migrate reset --force`는 막히고 `prisma migrate status`, `prisma db pull`, `prisma generate`는 통과한다(코어 기본 항목만으로).
  - 코어 기본 항목: 설정 없이 `drizzle-kit --config x push`와 `npx drizzle-kit@latest push`가 막히고 `drizzle-kit generate`는 통과한다.
  - 시간: 인자 20,000개(금지 하위 명령 없음, 도구 자리 여럿 포함)의 판정을 자식 프로세스에서 시간 제한(20초)을 걸어 돌린다. 큰 입력은 표준 입력으로 넘긴다(환경 변수·인자는 OS의 길이 한도에 걸린다).
- `scripts/test/guard.test.ts`: 규칙 표에 플래그가 앞에 오는 코어 사례를 더한다. 있던 줄은 지우거나 고치지 않는다.
- `scripts/test/lib.test.ts`: `guard.dbCommands` 검사(키 없음, 바른 값, 틀린 값마다 문제).
- 훅을 프로세스로 부르는 테스트 하나: 설정 파일의 `guard.dbCommands`로 종료 코드 2가 나온다. 틀린 설정에서 규칙이 조용히 꺼지지 않는다.
- `scripts/selftest/scenarios/r13-db.ts`: 설정에 `dbCommands` 항목 하나를 더하고, 공백이 든 값 뒤의 금지 하위 명령(막힘)과 같은 도구의 허용된 하위 명령(통과)을 더한다. 있던 사례는 그대로 둔다.

### 5. 문서

- `docs/harness/design.md`: L1 훅의 DB 규칙을 설명하는 곳(13.1절)과 12.4절의 `r13-db` 행에 `guard.dbCommands`와 인자 배열 판정을 적고 버전 줄을 올린다(번호는 올릴 때 main의 다음 번호). **14.3절은 고치지 않는다.**
- `docs/harness/architecture.md`: `hooks/*` 행에 `db-commands.ts`를 더한다.
- `docs/harness/CHANGELOG.md`에 한 줄.

## Acceptance Criteria

```bash
node --test scripts/test/db-commands.test.ts scripts/test/guard.test.ts scripts/test/lib.test.ts
b=$(git merge-base HEAD origin/main) && test "$(git diff "$b" -- scripts/test/guard.test.ts | grep -c '^-[^-]')" -eq 0
b=$(git merge-base HEAD origin/main) && t=$(mktemp -d) && git show "$b:docs/harness/design.md" | awk '/^### 14\.3 /{s=1} /^### 14\.4 /{s=0} s' > "$t/a" && awk '/^### 14\.3 /{s=1} /^### 14\.4 /{s=0} s' docs/harness/design.md > "$t/b" && test -s "$t/a" && diff "$t/a" "$t/b"
b=$(git merge-base HEAD origin/main) && test -z "$(git diff --name-only "$b" -- profiles/web scripts/test/profile-web.test.ts docs/exec-plans/tech-debt-tracker.md .github)"
grep -q "dbCommands" docs/harness/design.md && grep -q "db-commands" docs/harness/architecture.md
node scripts/harness.ts self-test
node scripts/harness.ts check
```

## 금지사항

- `DB_PATTERNS`·`DB_CLIENTS`의 항목을 지우거나 느슨하게 고치지 마라. 이유: 지금 막는 것을 그대로 막아야 한다(R4, R13). 이 step은 규칙을 더하기만 한다.
- `scripts/test/guard.test.ts`와 `scripts/selftest/scenarios/r13-db.ts`의 있던 단언을 지우거나 약하게 하지 마라. 이유: R4.
- 인자를 이은 글에 정규식을 돌려 하위 명령을 찾지 마라. 이유: 인자의 경계가 사라져 같은 문제가 되풀이된다(PR #169의 F1·F3). 역추적 폭주도 다시 생길 수 있다.
- 허용된 하위 명령 뒤의 인자에서 금지 이름을 찾지 마라. 이유: `drizzle-kit generate --name migrate` 같은 허용된 호출이 막힌다.
- "플래그가 값을 받는지"를 도구별 플래그 목록으로 판정하지 마라. 이유: 설정이 도구의 버전에 묶이고, 목록에 없는 플래그에서 금지 호출을 놓친다. 플래그 바로 뒤의 인자는 값과 하위 명령 양쪽으로 따진다.
- `profiles/web/**`, `scripts/test/profile-web*.test.ts`, 기술 부채 표, 설계서 14.3절을 고치지 마라. 이유: PR #169의 것이다. 14.3절은 그 PR의 AC가 글자 그대로 비교한다.
- 틀린 `guard.dbCommands`를 조용히 무시하지 마라. 이유: 오타 하나로 규칙이 꺼진 것을 아무도 모르게 된다.
- `.github/workflows/`를 고치지 마라. 이유: 제작자가 적용한다.
- 새 의존성을 더하지 마라. 이유: 필요 없다(R17).
