# Step 1: drizzle-guard

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준" 5·6, 의사결정 로그의 차단 목록 결정, 발견 사항)
- 앞 step에서 만든·바꾼 파일: `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `lab/q10-db/README.md`, `docs/harness/design.md` 14.3절·18절 Q10 행
- `scripts/hooks/rules.ts`의 "DB (R13)" 부분(`DB_CLIENTS`, `DB_PATTERNS`, `dbRules`: 명령의 인자를 공백으로 이은 글에 코어 패턴과 설정의 `dbPatterns`를 대소문자 무시로 맞춘다), `evaluate`, `GuardContext`
- `scripts/hooks/guard.ts`의 `loadGuardConfig`(리포의 `harness.config.json`에서 `guard.dbPatterns`·`dbClients`를 읽는다)
- `scripts/test/guard.test.ts`(규칙 표로 `evaluate`를 돌리는 방식), `scripts/test/profile-web.test.ts`(임시 폴더에 웹 프로파일을 적용하는 `webRepo`)
- `profiles/web/profile.json`(`guard`), `profiles/web/README.md`, `profiles/core/profile.json`

## 작업

테스트를 먼저 쓰고, 설정을 고치기 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 테스트 `scripts/test/profile-web-db.test.ts`(새 파일)

임시 폴더에 웹 프로파일을 적용하고(`init(root, 'web', {})`. `profile-web.test.ts`의 `webRepo`와 같은 방식), `loadConfig(root).guard`의 `dbPatterns`·`dbClients`를 `GuardContext`에 넣어 `evaluate({ kind: 'bash', command, cwd }, ctx)`를 돌린다.

- 막힌다(R13), 하위 명령이 바로 뒤에 오는 형태: `pnpm exec drizzle-kit migrate`, `npx drizzle-kit migrate --config drizzle.config.ts`, `pnpm drizzle-kit studio`, `drizzle-kit introspect`, `drizzle-kit pull`, `drizzle-kit drop`, `DRIZZLE-KIT MIGRATE`(대소문자), `pnpm exec drizzle-kit push`(코어 규칙도 막는다).
- 막힌다(R13), **플래그가 하위 명령 앞에 오는 형태**(`drizzle-kit`은 이 순서도 받는다. 계획의 진행 로그): `drizzle-kit --config drizzle.config.ts migrate`, `drizzle-kit --config=drizzle.config.ts studio`, `pnpm exec drizzle-kit --config drizzle.config.ts push`(코어 패턴은 이 형태를 놓친다. 프로파일 패턴이 막는다), `drizzle-kit -h drop`, `drizzle-kit --config a.ts --verbose pull`.
- 막히지 않는다: `pnpm exec drizzle-kit generate`, `pnpm exec drizzle-kit generate --name add-migrate-log`(하위 명령 뒤의 인자에 금지 명령의 이름이 들어 있어도 막지 않는다), `drizzle-kit --config drizzle.config.ts generate`, `drizzle-kit check`, `drizzle-kit export`, `drizzle-kit up`, `pnpm test`.
- 프로파일이 더한 것임을 확인한다: `dbPatterns`가 빈 컨텍스트에서는 `drizzle-kit migrate`가 막히지 않고 `drizzle-kit push`는 막힌다.
- 웹 프로파일의 `dbPatterns` 항목이 모두 정규식으로 컴파일된다(`new RegExp(p, 'i')`).

### 2. 설정 `profiles/web/profile.json`

- `guard.dbPatterns`에 항목 하나를 더한다: `drizzle-kit` 뒤에 플래그(`-x`, `--name`, `--name=값`, `--name 값`)가 0개 이상 온 다음의 하위 명령이 `migrate`, `studio`, `introspect`, `pull`, `drop`, `push`인 경우. 이미 있는 항목은 그대로 둔다.
  - 플래그 뒤의 값 하나를 건너뛰므로, 플래그의 값이 금지 명령의 이름인 호출(`drizzle-kit --name migrate generate`)도 막힌다. 엄한 쪽의 오탐이라 받아들인다(README에 적는다).
  - 하위 명령 자리가 아닌 곳(하위 명령 뒤의 인자)에 있는 이름은 보지 않는다.
- 프로파일 `version`을 올린다(0.3.0 → 0.4.0).
- `dbClients`, `riskPaths`, 다른 설정은 고치지 않는다.

### 3. 문서

- `profiles/web/README.md`: "DB 금지 명령" 줄("DB·ORM 확정(Q10) 후 보강한다")을 고치고 "DB" 절(`## DB`)을 더한다.
  - 선택: PostgreSQL + Drizzle, 일회용 DB는 PGlite(ADR-0007, 잠정). 확인한 버전과 `lab/q10-db` 링크.
  - 일회용 DB의 규약: worktree 안의 폴더 하나가 DB 하나(리포에 커밋하지 않는다), 테스트는 메모리 DB, `dev`와 테스트는 같은 폴더를 함께 열지 않는다. 표준 명령에 잇는 일은 대상 리포에서 한다(TD-12).
  - 명령: 허용(`generate`, `check`, `export`, `up`: 파일만 다룬다), 금지(`push`: 스키마 diff 자동 적용 / `migrate`·`studio`·`introspect`·`pull`: 설정이 가리키는 DB에 접속한다 / `drop`: 마이그레이션 파일을 지운다). 마이그레이션 적용은 표준 명령 안에서 앱의 마이그레이션 코드가 한다.
  - 훅이 보지 못하는 것: 패키지 스크립트(`pnpm db:migrate` 같은 이름) 안에 든 명령. 그런 스크립트를 더하는 변경은 리뷰에서 본다(절차 수준). 훅은 명령 전체의 글에서 찾으므로 금지 명령이 커밋 메시지에 글자로 들어 있어도 막히고, 플래그의 값이 금지 명령의 이름이어도 막힌다.
  - 한계: ADR-0007의 "알려진 한계"를 가리킨다.
- `docs/harness/design.md` 14.3절의 "예시 명령은 스택마다 다르므로, 실제 차단 목록은 프로파일이 채운다(Q10)." 줄: 웹 프로파일이 채운 것(DB에 접속하는 `drizzle-kit` 명령과 `drop`, 플래그가 앞에 오는 형태 포함)을 덧붙인다. 금지 분류 표는 고치지 않는다.
- 0절 버전 이력과 문서 머리의 버전, `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(검사를 약화하지 않는다는 것, 프로파일 버전). 번호는 push할 때 main의 다음 번호다.
- `docs/harness/architecture.md`의 파일 표에 테스트 파일을 적는 칸이 있으면 더한다(없으면 고치지 않는다).
- `docs/exec-plans/tech-debt-tracker.md`에 새 행 하나(번호는 push할 때 main의 다음 번호): 코어 DB 패턴(`scripts/hooks/rules.ts`의 `DB_PATTERNS`)은 도구 이름 바로 뒤의 하위 명령만 본다. 플래그가 앞에 오는 호출(`drizzle-kit --config x push`, 다른 도구의 같은 형태)을 놓친다. 웹 프로파일은 `drizzle-kit`에 대해 프로파일 패턴으로 막는다. 다른 행은 고치지 않는다.

## Acceptance Criteria

```bash
node --test scripts/test/profile-web-db.test.ts
node --test scripts/test/profile-web.test.ts
node --test scripts/test/guard.test.ts
grep -q "drizzle-kit" profiles/web/profile.json
grep -q '"version": "0.4.0"' profiles/web/profile.json
grep -q "^## DB" profiles/web/README.md
grep -q "ADR-0007" profiles/web/README.md
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep "프로파일이 채운다" | grep -q "drizzle-kit"
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep -q "drizzle-kit[ ]push"
grep -q "DB_PATTERNS" docs/exec-plans/tech-debt-tracker.md
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

## 금지사항

- `scripts/hooks/rules.ts`와 `scripts/hooks/guard.ts`를 고치지 마라. 이유: 코어 규칙은 스택과 무관한 목록이다. 스택별 목록은 프로파일의 설정으로 더한다(14.3절). 코어 패턴의 틈은 기술 부채 표에 남긴다.
- 이미 있는 `dbPatterns`·`dbClients` 항목을 지우거나 좁히지 마라. 이유: R4(검사 약화).
- `drizzle-kit generate`를 막지 마라(플래그가 앞에 오는 형태 포함). 이유: 마이그레이션은 파일로 쓰고 리뷰받는 것이 규칙이고(14.3절), 이 명령이 그 파일을 만든다.
- 패턴을 "명령 어디든 `migrate`가 있으면"처럼 넓히지 마라. 이유: 다른 도구와 파일 이름(`generate --name add-migrate-log`)이 막힌다. `drizzle-kit`의 하위 명령 자리(플래그를 건너뛴 첫 인자)만 본다.
- 14.3절의 금지 분류 표와 강제 장치 표를 고치지 마라. 이유: 이 step은 표의 규칙을 프로파일에 채우는 것이지 규칙을 바꾸지 않는다.
- 기존 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
- `.github/workflows/`를 고치지 마라. 이유: 워크플로 변경은 제작자가 직접 커밋한다.
- 기술 부채 표에서 새 행 밖의 행을 고치지 마라. 이유: 다른 세션의 PR과 충돌한다.
