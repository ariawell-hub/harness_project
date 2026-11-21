# Step 1: drizzle-guard

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준" 5·6·7, 의사결정 로그의 차단 목록 결정과 2026-11-21의 계획 수정, 발견 사항)
- 앞 step에서 만든·바꾼 파일: `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `lab/q10-db/README.md`, `docs/harness/design.md` 14.3절·18절 Q10 행
- `docs/harness/design.md` 13.1절의 "DB 금지 명령의 하위 명령 판정(R13, `guard.dbCommands`)" 항목(도구 자리, 인자, 걷기, 알려진 대가, 설정의 출처, 남는 틈). Issue #172(PR #174)가 넣었다.
- `scripts/hooks/db-commands.ts`의 `matchDbCommand`(인자 배열의 자리로 하위 명령을 판정한다), `scripts/hooks/rules.ts`의 "DB (R13)" 부분(`DB_CLIENTS`, `DB_PATTERNS`, `DB_COMMANDS`, `dbRules`), `evaluate`, `GuardContext`(`dbCommands`)
- `scripts/lib/config.ts`의 `resolveDbCommands`(설정 검사), `scripts/hooks/guard.ts`의 `buildContext`(`guard.dbCommands`는 메인 체크아웃의 `harness.config.json`에서 읽고, `dbPatterns`·`dbClients`는 작업 폴더의 설정에서 읽는다)
- `scripts/commands/init.ts`의 `init`(프로파일의 `config`를 키 단위로 덮어쓴다. `guard`는 통째로 바뀌므로 프로파일의 `guard`에 든 키만 남는다)
- `scripts/test/db-commands.test.ts`·`scripts/test/guard.test.ts`(규칙 표로 `evaluate`를 돌리는 방식), `scripts/test/profile-web.test.ts`(임시 폴더에 웹 프로파일을 적용하는 `webRepo`)
- `profiles/web/profile.json`(`guard`), `profiles/web/README.md`, `profiles/core/profile.json`

## 작업

테스트를 먼저 쓰고, 설정을 고치기 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

이 step은 한 번 구현해 PR #169에 올린 뒤 계획을 고쳤다(2026-11-21, `plan.md`의 의사결정 로그). 그 브랜치에는 고치기 전의 계획대로 `guard.dbPatterns`에 정규식 항목을 더한 구현이 있다. 아래 지시가 그 구현과 다른 곳은 아래 지시로 바꾼다. 그 정규식 항목은 main에 없던 것이므로 빼도 main 기준으로 검사가 약해지지 않는다(같은 호출을 `guard.dbCommands` 항목이 막는지 테스트가 본다).

### 1. 테스트 `scripts/test/profile-web-db.test.ts`(새 파일)

임시 폴더에 웹 프로파일을 적용하고(`init(root, 'web', {})`. `profile-web.test.ts`의 `webRepo`와 같은 방식), 그 설정 `cfg = loadConfig(root)`의 `guard`를 `GuardContext`에 넣어 `evaluate({ kind: 'bash', command, cwd }, ctx)`를 돌린다. `GuardContext`의 `dbCommands`는 배열을 돌려주는 함수다: `dbPatterns: cfg.guard.dbPatterns`, `dbClients: cfg.guard.dbClients`, `dbCommands: () => cfg.guard.dbCommands`.

- 막힌다(R13), 하위 명령이 바로 뒤에 오는 형태: `pnpm exec drizzle-kit migrate`, `npx drizzle-kit migrate --config drizzle.config.ts`, `pnpm drizzle-kit studio`, `drizzle-kit introspect`, `drizzle-kit pull`, `drizzle-kit drop`, `DRIZZLE-KIT MIGRATE`(대소문자), `pnpm exec drizzle-kit push`(코어 규칙도 막는다).
- 막힌다(R13), 버전을 붙여 받아 실행하는 형태와 패키지의 실행 파일을 직접 부르는 형태: `pnpm dlx drizzle-kit@0.31.11 migrate`, `npx drizzle-kit@latest --config drizzle.config.ts studio`, `node node_modules/drizzle-kit/bin.cjs migrate`.
- 막힌다(R13), **플래그가 하위 명령 앞에 오는 형태**(`drizzle-kit`은 이 순서도 받는다. 계획의 진행 로그): `drizzle-kit --config drizzle.config.ts migrate`, `drizzle-kit --config=drizzle.config.ts studio`, `pnpm exec drizzle-kit --config drizzle.config.ts push`, `drizzle-kit -h drop`, `drizzle-kit --config a.ts --verbose pull`.
- 막힌다(R13), **플래그의 값에 공백이 든 형태**(고치기 전의 계획이 한계로 남겼던 것): `drizzle-kit --config "team config.ts" migrate`, `drizzle-kit --config 'a b.ts' studio`, `npx drizzle-kit@latest --config "team config.ts" drop`.
- 막히지 않는다: `pnpm exec drizzle-kit generate`, `pnpm exec drizzle-kit generate --name add-migrate-log`, `drizzle-kit generate --name migrate`(하위 명령 뒤의 인자에 금지 명령의 이름이 있어도 막지 않는다), `drizzle-kit --config drizzle.config.ts generate`, `drizzle-kit --config "team migrate config.ts" generate`(값 안의 낱말은 하위 명령이 아니다), `drizzle-kit check`, `drizzle-kit export`, `drizzle-kit up`, `pnpm test`.
- 인자의 경계를 본다: 인자가 다르고 공백으로 이은 글이 같은 두 호출을 다르게 판정한다. `drizzle-kit --config "team config.ts" migrate`(막힌다)와 `drizzle-kit --config "team config.ts migrate"`(값일 뿐이라 막히지 않는다). `parseShell`로 두 호출의 인자가 다르고 이은 글이 같음을 함께 단언한다.
- 알려진 대가(막힌다. 더 막는 쪽이라 받아들인다, 설계서 13.1절): `drizzle-kit --name migrate generate`(플래그의 값이 금지 명령의 이름과 같다). 붙여 쓴 `drizzle-kit --name=migrate generate`는 막히지 않는다.
- 프로파일이 더한 것임을 확인한다: `dbCommands`가 빈 컨텍스트에서는 `drizzle-kit migrate`가 막히지 않고, `drizzle-kit push`와 `drizzle-kit --config x push`는 막힌다(코어 기본 항목).
- 설정의 꼴: 웹 프로파일을 적용한 설정의 `guard.dbCommands`에 `tool`이 `drizzle-kit`인 항목이 하나 있고 `forbidden`이 정확히 `migrate`, `studio`, `introspect`, `pull`, `drop`, `push` 여섯이다(순서는 보지 않는다). `guard.dbPatterns`에는 `drizzle`이 든 항목이 없다. `loadConfig`가 설정 검사(`resolveDbCommands`)에서 던지지 않는다.
- 웹 프로파일의 `dbPatterns` 항목이 모두 정규식으로 컴파일된다(`new RegExp(p, 'i')`).
- **실제 훅이 그 목록을 읽는다**(값을 직접 넣는 위 테스트는 훅이 설정을 읽는 길을 보지 못한다): 훅을 프로세스로 부른다(`scripts/test/guard.test.ts`의 "guard 프로세스: guard.dbCommands는 메인 체크아웃의 설정으로 판정하고…" 테스트와 같은 방식. `scripts/hooks/guard.ts`에 훅 입력을 표준 입력으로 준다).
  - 임시 git 리포(메인 체크아웃)에 웹 프로파일을 적용한 `harness.config.json`을 두고 커밋한다. 메인 체크아웃에서 `drizzle-kit --config "team config.ts" migrate`가 종료 코드 2와 R13으로 막히고, `drizzle-kit generate`는 종료 코드 0이다.
  - `git worktree add`로 연결 worktree를 만들고 그 worktree의 `harness.config.json`에서 `guard.dbCommands`를 빈 목록으로 바꾼다. 그 worktree에서도 같은 금지 호출이 종료 코드 2와 R13으로 막힌다(메인 체크아웃의 설정으로 판정한다). 키를 지워도 같다.
  - 대조: 메인 체크아웃의 설정에서 `guard.dbCommands`를 빈 목록으로 바꾸면 그 금지 호출(`migrate`)이 종료 코드 0이다(막는 것이 웹 프로파일의 항목임을 본다). 코어 기본 항목인 `drizzle-kit --config x push`는 그때도 막힌다.
- **README의 DB 절이 설정과 맞는다**: `profiles/web/README.md`의 `## DB` 절(다음 `## ` 제목 앞까지)을 읽어 본다.
  - "명령" 표에서 훅 칸이 "금지"인 행들에 백틱으로 적힌 이름의 집합이 웹 프로파일 `guard.dbCommands`의 `drizzle-kit` 항목의 `forbidden`과 같다(빠진 것도 남는 것도 없다).
  - 훅 칸이 "허용"인 행들의 이름 집합이 `generate`, `check`, `export`, `up`이고 금지 집합과 겹치지 않는다.
  - 확인한 버전: `lab/q10-db/results/darwin-arm64.json`의 `versions`에 있는 세 패키지(`drizzle-orm`, `drizzle-kit`, `@electric-sql/pglite`)의 버전이 절에 그 패키지 이름과 함께 적혀 있다.

### 2. 설정 `profiles/web/profile.json`

- `guard`에 `dbCommands` 키를 더한다: 항목 하나, `tool`은 `drizzle-kit`, `forbidden`은 `migrate`, `studio`, `introspect`, `pull`, `drop`, `push`. `init`은 프로파일의 `guard`를 통째로 덮어쓰므로 이 키가 프로파일에 있어야 적용된 설정에 남는다.
  - 판정은 코어의 `matchDbCommand`가 한다(인자 배열에서 도구 자리를 찾고, 플래그를 건너뛴 다음의 낱말을 본다). 플래그 뒤의 낱말은 값일 수 있어 한 번 더 걷는다. 그래서 플래그의 값이 금지 명령의 이름과 같은 호출(`drizzle-kit --name migrate generate`)도 막힌다. 더 막는 쪽의 오탐이라 받아들인다(README에 적는다).
  - 하위 명령 자리가 아닌 곳(하위 명령 뒤의 인자, 플래그 값 안의 낱말)에 있는 이름은 보지 않는다.
- `guard.dbPatterns`는 main의 항목 그대로 둔다(`drizzle-kit` 정규식을 더하지 않는다). 이유: 정규식은 인자를 공백으로 이은 글을 봐서 인자의 경계를 가리지 못한다(PR #169의 지적 F1). 같은 호출을 `dbCommands` 항목이 막는다.
- 프로파일 `version`을 올린다(0.3.0 → 0.4.0).
- `dbClients`, `riskPaths`, 다른 설정은 고치지 않는다.

### 3. 문서

- `profiles/web/README.md`: "DB 금지 명령" 줄("DB·ORM 확정(Q10) 후 보강한다")을 고치고 "DB" 절(`## DB`)을 더한다.
  - 선택: PostgreSQL + Drizzle, 일회용 DB는 PGlite(ADR-0007, 잠정). 확인한 버전과 `lab/q10-db` 링크.
  - 일회용 DB의 규약: worktree 안의 폴더 하나가 DB 하나(리포에 커밋하지 않는다), 테스트는 메모리 DB, `dev`와 테스트는 같은 폴더를 함께 열지 않는다. 표준 명령에 잇는 일은 대상 리포에서 한다(TD-12).
  - 명령: 허용(`generate`, `check`, `export`, `up`: 파일만 다룬다), 금지(`push`: 스키마 diff 자동 적용 / `migrate`·`studio`·`introspect`·`pull`: 설정이 가리키는 DB에 접속한다 / `drop`: 마이그레이션 파일을 지운다). 마이그레이션 적용은 표준 명령 안에서 앱의 마이그레이션 코드가 한다.
  - 훅이 보는 것: 설정 `guard.dbCommands`의 항목으로 인자의 자리를 본다(설계서 13.1절을 가리킨다). 플래그가 하위 명령 앞에 오는 호출, 버전을 붙인 호출, 실행 파일을 직접 부르는 호출, 플래그의 값에 공백이 든 호출을 막는다. 이 설정은 메인 체크아웃의 `harness.config.json`에서 읽는다(worktree에서 목록을 비워도 풀리지 않는다).
  - 알려진 대가(더 막는 쪽): 플래그의 값이 금지 명령의 이름과 같은 호출(`--이름=값`으로 붙여 쓰면 통과한다). 설계서 13.1절의 "알려진 대가"를 가리킨다.
  - 훅이 보지 못하는 것: 패키지 스크립트(`pnpm db:migrate` 같은 이름) 안에 든 명령. 그런 스크립트를 더하는 변경은 리뷰에서 본다(절차 수준). 그 밖의 남는 틈은 설계서 13.1절의 "남는 틈"을 가리킨다(목록을 다시 적지 않는다).
  - 한계: ADR-0007의 "알려진 한계"를 가리킨다.
  - "명령"은 표로 적는다(칸: 하위 명령, 훅, 이유. 훅 칸은 "허용" 또는 "금지"). 테스트가 이 표를 설정과 대조한다.
  - AC가 DB 절에서 글자 그대로 찾는 말(절 안에 있어야 한다): `ADR-0007`, `lab/q10-db`, `PGlite`, `worktree 안의 폴더`, `메모리 DB`, `함께 열지 않는다`, `TD-12`, `guard.dbCommands`, `메인 체크아웃`, `13.1절`, `패키지 스크립트`, `붙여 쓰면`, `알려진 한계`.
- `docs/harness/design.md` 14.3절의 "예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10)." 줄: 줄의 자리와 있던 문장은 그대로 두고 같은 줄의 뒤에 웹 프로파일이 채운 것을 덧붙여, 그 줄을 **글자 그대로** 아래와 같게 한다. 금지 분류 표와 14.3절의 다른 줄은 한 글자도 바꾸지 않는다. 이 줄의 글은 계획이 정한 것이고 AC가 같은 글로 비교한다. 글을 바꿔야 하면 구현에서 바꾸지 않고 계획을 고쳐 다시 검증받는다.

  ```text
  - 예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10). 웹 프로파일은 DB에 접속하는 `drizzle-kit`의 하위 명령과 마이그레이션 파일을 지우는 하위 명령을 막는다(플래그가 하위 명령 앞에 오는 형태 포함, ADR-0007). 목록은 `profiles/web/README.md`의 "DB" 절에 있다.
  ```

- 0절 버전 이력과 문서 머리의 버전, `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(검사를 약화하지 않는다는 것, 프로파일 버전). 번호는 push할 때 main의 다음 번호다.
- `docs/harness/architecture.md`의 파일 표에 테스트 파일을 적는 칸이 있으면 더한다(없으면 고치지 않는다).
- `docs/exec-plans/tech-debt-tracker.md`에 새 행 하나. 번호는 TD-62다(다른 세션과 맞춘 번호다. push할 때 main에 그 번호가 이미 있으면 main의 다음 번호). DB 규칙과 L1 훅의 명령 판정에 남은 틈을 적는다. 다른 행은 고치지 않는다: PR이 갈라진 지점의 파일과 비교해 더한 줄이 정확히 하나이고 지우거나 바꾼 줄이 없어야 한다(AC가 본다). 새 행에는 아래 네 가지가 모두 들어가고, AC가 찾는 말(`DB_PATTERNS`, `guard.dbCommands`, `dbClients`, `메인 체크아웃`, `리다이렉션`, `예약어`, `13.1절`)을 글자 그대로 쓴다.
  1. 하위 명령 판정(`guard.dbCommands`)이 보지 못하는 것: 금지 낱말 사이에 플래그가 끼는 호출(`prisma db --schema x push`). 코어의 다른 도구는 정규식(`scripts/hooks/rules.ts`의 `DB_PATTERNS`)으로만 막아 플래그가 앞에 오는 호출을 놓친다(`drizzle-kit`과 `prisma`는 Issue #172가 닫았다).
  2. `guard.dbPatterns`·`dbClients`는 작업 worktree의 설정에서 읽는다. worktree에서 목록을 비우면 프로파일이 더한 차단이 그 worktree에서 풀린다(`dbCommands`는 메인 체크아웃에서 읽는다).
  3. 명령 이름으로 고르는 있던 규칙(`git`·`gh`: R2·R14·R20)은 명령 이름 앞에 리다이렉션이 오는 호출과 예약어 뒤의 명령(`then`·`do` 뒤)에서 돌지 않는다. Issue #172의 작업 중에 확인했다(그 계획의 발견 사항).
  4. 그 밖의 셸 해석의 틈은 설계서 13.1절의 "남는 틈"을 가리킨다.

## Acceptance Criteria

```bash
node --test scripts/test/profile-web-db.test.ts
node --test scripts/test/profile-web.test.ts
node --test scripts/test/guard.test.ts
grep -q '"dbCommands"' profiles/web/profile.json
grep -q "drizzle-kit" profiles/web/profile.json
grep -q '"version": "0.4.0"' profiles/web/profile.json
test "$(grep -c '^## DB$' profiles/web/README.md)" = 1
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "ADR-0007"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "lab/q10-db"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "PGlite"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "worktree 안의 폴더"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "메모리 DB"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "함께 열지 않는다"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "TD-12"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "guard.dbCommands"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "메인 체크아웃"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "13.1절"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "패키지 스크립트"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "붙여 쓰면"
awk '/^## DB$/{s=1;next} /^## /{s=0} s' profiles/web/README.md | grep -q "알려진 한계"
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep "프로파일이 채운다" | grep -q "drizzle-kit"
test "$(sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep -c "프로파일이 채운다")" = 1
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep -q "^- 예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10)\. "
O=$(mktemp -d) && git show "$(git merge-base HEAD origin/main):docs/harness/design.md" | sed -n '/^### 14.3/,/^### 14.4/p' | NEW='- 예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10). 웹 프로파일은 DB에 접속하는 `drizzle-kit`의 하위 명령과 마이그레이션 파일을 지우는 하위 명령을 막는다(플래그가 하위 명령 앞에 오는 형태 포함, ADR-0007). 목록은 `profiles/web/README.md`의 "DB" 절에 있다.' awk '$0 == "- 예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10)." {print ENVIRON["NEW"]; next} {print}' > "$O/expected.txt" && sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md > "$O/now.txt" && test -s "$O/expected.txt" && diff "$O/expected.txt" "$O/now.txt"
O=$(mktemp -d) && git show "$(git merge-base HEAD origin/main):docs/exec-plans/tech-debt-tracker.md" > "$O/base.md" && { diff "$O/base.md" docs/exec-plans/tech-debt-tracker.md > "$O/d.txt"; test "$(grep -c '^<' "$O/d.txt")" = 0; } && test "$(grep -c '^>' "$O/d.txt")" = 1 && grep '^> ' "$O/d.txt" | sed 's/^> //' | awk -F'|' '$2 ~ /^ *TD-[0-9]+ *$/' | grep "DB_PATTERNS" | grep "guard.dbCommands" | grep "dbClients" | grep "메인 체크아웃" | grep "리다이렉션" | grep "예약어" | grep -q "13.1절"
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- `git merge-base`가 든 줄은 14.3절 전체가 기대한 글과 같은지 본다. 기대한 글은 PR이 갈라진 지점의 14.3절에서 "- 예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10)." 한 줄만 그 자리에서 **이 명령에 글자 그대로 적힌 줄**로 바꾼 것이다. 그 줄의 글을 지금 파일에서 가져오지 않는다. 그 기대한 글과 지금의 14.3절 전체를 `diff`로 비교한다. 그래서 고친 줄의 글이 한 글자라도 다르거나(뒤에 문장을 더 덧붙인 경우 포함), 다른 자리(표 안 포함)로 옮겨지거나, 다른 줄이 빠지거나 바뀌거나 빈 줄이 끼면 실패한다. `origin/main`이 필요하다(`git fetch origin`). 명령에 적힌 글에는 `drizzle-kit`의 하위 명령 이름을 넣지 않았다(금지 명령의 글자가 든 명령은 L1 훅이 막는다).
- README를 보는 줄들은 `## DB` 절(그 제목 다음 줄부터 다음 `## ` 제목 앞까지)만 본다. 절 밖에 같은 말이 있어도 통과하지 않는다. `## DB` 제목은 하나여야 한다. 수용 기준 6의 내용마다 줄이 있다: 결정과 실측(`ADR-0007`, `lab/q10-db`, `PGlite`), 일회용 DB의 규약(`worktree 안의 폴더`, `메모리 DB`, `함께 열지 않는다`, `TD-12`), 훅이 보는 것(`guard.dbCommands`, `메인 체크아웃`, `13.1절`), 알려진 대가(`붙여 쓰면`), 훅이 보지 못하는 것(`패키지 스크립트`), 한계(`알려진 한계`). 허용·금지 명령의 목록과 버전은 테스트가 설정·결과 파일과 대조한다(명령 줄에서 보지 않는 이유: 금지 하위 명령의 이름이 든 명령은 L1 훅이 막을 수 있다).
- 기술 부채 표를 보는 줄은 PR이 갈라진 지점의 표와 지금의 표를 `diff`로 비교한다. 지우거나 바꾼 줄(`<`)이 0이고 더한 줄(`>`)이 정확히 1이어야 한다. 그래서 있던 행을 고쳐 말을 넣거나 같은 내용을 두 행에 적으면 실패한다. 필수 내용은 그 더한 줄 하나에서만 찾는다: 첫 칸이 `TD-<번호>`이고, `DB_PATTERNS`(정규식뿐인 도구의 틈), `guard.dbCommands`와 `dbClients`와 `메인 체크아웃`(설정의 출처가 다르다), `리다이렉션`과 `예약어`(명령 이름으로 고르는 규칙의 틈), `13.1절`(남는 틈)이 모두 있어야 한다. `origin/main`이 필요하다(`git fetch origin`).
- 설정의 꼴(`dbCommands` 항목의 금지 목록 여섯, `dbPatterns`에 `drizzle` 항목이 없음)과 실제 훅이 그 목록을 읽는지는 `scripts/test/profile-web-db.test.ts`가 본다.

## 금지사항

- 14.3절의 고치는 한 줄의 글을 "작업"과 AC에 적힌 것과 다르게 쓰지 마라(덧붙이기 포함). 이유: 14.3절은 DB 금지 규칙이고, 허용된 변경은 계획에 고정한 그 한 줄뿐이다. 다른 글은 규칙을 느슨하게 할 수 있어 계획 검증을 다시 받아야 한다.
- `scripts/hooks/`(`rules.ts`, `guard.ts`, `db-commands.ts`, `shell.ts`)와 `scripts/lib/config.ts`를 고치지 마라. 이유: 코어의 판정은 스택과 무관하고 Issue #172가 넣었다. 스택별 목록은 프로파일의 설정으로 더한다(14.3절). 코어에 남은 틈은 기술 부채 표에 남긴다.
- main에 있는 `dbPatterns`·`dbClients` 항목을 지우거나 좁히지 마라. 이유: R4(검사 약화). PR #169의 브랜치에만 있던 `drizzle-kit` 정규식 항목은 여기에 들지 않는다("작업" 첫머리).
- `drizzle-kit generate`를 막지 마라(플래그가 앞에 오는 형태 포함). `forbidden`에 `generate`, `check`, `export`, `up`을 넣지 마라. 이유: 마이그레이션은 파일로 쓰고 리뷰받는 것이 규칙이고(14.3절), 이 명령들이 그 파일을 만들고 본다.
- `dbPatterns`에 `drizzle-kit` 정규식을 더하거나 "명령 어디든 `migrate`가 있으면"처럼 넓은 패턴을 넣지 마라. 이유: 다른 도구와 파일 이름(`generate --name add-migrate-log`), 커밋 메시지의 글까지 막힌다. `drizzle-kit`의 하위 명령 자리만 본다.
- 14.3절의 금지 분류 표와 강제 장치 표를 고치지 마라. 이유: 이 step은 표의 규칙을 프로파일에 채우는 것이지 규칙을 바꾸지 않는다.
- 기존 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4. PR #169의 브랜치에만 있던 "한계" 테스트(공백이 든 값을 놓친다)는 "막는다"는 단언으로 바꾼다(더 엄해진다).
- `.github/workflows/`를 고치지 마라. 이유: 워크플로 변경은 제작자가 직접 커밋한다.
- 기술 부채 표에서 새 행 밖의 행을 고치지 마라. 이유: 다른 세션의 PR과 충돌한다.
