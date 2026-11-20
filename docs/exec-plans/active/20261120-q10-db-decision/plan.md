---
id: 20261120-q10-db-decision
issue: 166 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-20T21:50:40+09:00 # new-task가 채운다
---

# Q10 결정 반영: 파일럿 웹 프로젝트의 DB는 PostgreSQL + Drizzle, 일회용 DB는 내장 PostgreSQL(PGlite)

## 목표와 수용 기준

설계서 18절의 Q10(사용할 DB와 ORM·마이그레이션 도구)은 3단계 파일럿 착수 전에 정할 것으로 남아 있다(19절). 판단 기준은 "여러 PC와 다양한 개발 환경에 영향이 없으면 PostgreSQL + Drizzle, 아니면 DB 없이 시작"이다(Issue #166의 경위). 이 계획은 기준을 실측으로 적용한 결과를 기록하고, 그 결과에 맞게 웹 프로파일의 DB 차단 목록을 채운다.

실행 환경은 macOS와 Windows 네이티브이고 CI는 Linux다(설계서 0절). 서버형 PostgreSQL을 PC마다 두면 설치·포트·버전을 맞춰야 하고 CI 워크플로를 고쳐야 한다. 내장 PostgreSQL(PGlite, WASM)을 일회용 DB로 쓰면 PC별로 준비할 것이 패키지 설치뿐이다. 2026-11-20에 macOS에서 임시 폴더로 확인했다(진행 로그). 이 계획은 그 확인을 다시 돌릴 수 있는 절차와 결과 파일로 남긴다.

수용 기준:

1. `lab/q10-db/`에 실물 확인의 절차(README), 실행 스크립트, 검사 스크립트, 결과 파일이 있다. 결과 파일 이름은 실행한 머신의 `<platform>-<arch>`이고(이 계획은 `darwin-arm64.json`을 남긴다), 다른 머신에서 같은 절차로 결과 파일을 더할 수 있다. `node lab/q10-db/check-results.ts darwin-arm64`가 종료 코드 0이다.
2. 검사 스크립트는 다음이 어긋나면 종료 코드 1이다: 고정한 패키지 버전, PGlite에 런타임 의존성·네이티브 바이너리·`os`/`cpu` 제한이 없음, 설치 스크립트를 가진 패키지가 `esbuild`뿐임, `drizzle-kit generate`가 SQL 마이그레이션 파일을 만듦, 사례별 기대값(폴더 둘의 격리, 같은 폴더를 다시 열면 데이터가 남음, 메모리 DB, 서로 다른 폴더의 동시 실행). 검사 스크립트의 테스트가 있다.
3. `docs/decisions/ADR-0007-db-postgres-drizzle.md`가 결정, 기준, 실측, 알려진 한계, 되돌리는 조건을 적고 `docs/decisions/index.md`에 올라 있다.
4. 설계서 18절의 Q10 행이 결정(PostgreSQL + Drizzle, 일회용 DB는 PGlite)으로 적혀 있고 ADR-0007을 가리킨다. 19절 "현재 위치"의 착수 전 결정 목록에서 Q10이 빠지고 Q13만 남는다. 14.3절에 웹 프로파일의 일회용 DB가 무엇인지 한 항목이 있다.
5. 웹 프로파일을 적용한 설정(`init --profile web`)의 `guard.dbPatterns`로 L1 규칙(`scripts/hooks/rules.ts`의 `evaluate`)을 돌리면, DB에 접속하는 `drizzle-kit` 명령(`migrate`, `studio`, `introspect`, `pull`)과 마이그레이션 파일을 지우는 `drop`이 R13으로 막히고, 파일만 다루는 명령(`generate`, `check`, `export`, `up`)은 막히지 않는다. `push`는 코어 규칙이 이미 막는다(그대로다).
6. `profiles/web/README.md`에 DB 절이 있다: 선택한 도구와 버전, 일회용 DB의 규약(worktree 안의 폴더, 테스트는 메모리), 허용·금지 명령, 훅이 보지 못하는 것(패키지 스크립트 안의 명령), 한계.
7. 기술 부채 표의 TD-12 (3)(Q10을 기다리던 일회용 DB 연결)과 TD-14(Windows 실기 검증)가 결정에 맞게 고쳐져 있다.
8. 14.3절의 금지 분류 표와 강제 장치 표의 규칙을 빼거나 약하게 바꾸지 않는다. `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- `lab/q10-db/`(새 폴더): 실물 확인 절차·스크립트·결과·검사·테스트.
- ADR-0007(새 파일)과 ADR 색인.
- 설계서 18절 Q10 행, 19절 "현재 위치", 14.3절(일회용 DB 항목 하나, "프로파일이 채운다" 줄), 0절 버전 이력. `docs/harness/CHANGELOG.md`.
- `profiles/web/profile.json`의 `guard.dbPatterns`와 버전, `profiles/web/README.md`.
- 새 테스트 `scripts/test/profile-web-db.test.ts`.
- 기술 부채 표의 TD-12·TD-14 행.

비범위:

- 일회용 DB를 표준 명령(`setup`·`test`·`dev`·`verify`)에 실제로 잇는 일(폴더 만들기·지우기, 마이그레이션 적용, 합성 시드). 이유: 파일럿 대상 리포의 앱 구조가 있어야 정할 수 있다. 그 리포의 DB를 쓰는 첫 작업에서 한다(TD-12 (3)).
- 코어 규칙(`scripts/hooks/rules.ts`의 `DB_PATTERNS`·`DB_CLIENTS`). 이유: 코어는 스택과 무관한 목록이고, 스택별 목록은 프로파일이 채운다(14.3절).
- L3 정적 검사(마이그레이션 SQL의 파괴적 구문 탐지), `riskPaths`(`drizzle/**`는 이미 high다).
- Q13(개인 계정·조직). 답을 받지 못했다.
- `.github/workflows/`. Windows·Linux에서의 실측(그 머신에서 처음 작업할 때 한다. TD-14).

## 관련 파일·문서

- `lab/q10-db/README.md`, `lab/q10-db/trial.ts`, `lab/q10-db/check-results.ts`, `lab/q10-db/results/darwin-arm64.json`, `lab/q10-db/test/check-results.test.ts`
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `docs/decisions/index.md`, `docs/index.md`(색인에 올릴 것이 있으면)
- `docs/harness/design.md`(0절 버전 이력, 14.3절, 18절 Q10 행, 19절 "현재 위치"), `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`(파일 표에 올릴 것이 있으면)
- `docs/exec-plans/tech-debt-tracker.md`(TD-12, TD-14 행)
- `profiles/web/profile.json`, `profiles/web/README.md`
- `scripts/test/profile-web-db.test.ts`
- `docs/exec-plans/active/20261120-q10-db-decision/**`

## step 목록

- step0 decision-record: 실물 확인을 `lab/q10-db/`에 남기고, ADR-0007과 설계서 18절·19절·14.3절, 기술 부채 표에 결정을 적는다.
- step1 drizzle-guard: 웹 프로파일의 `guard.dbPatterns`에 DB에 접속하는 `drizzle-kit` 명령과 `drop`을 더하고(테스트 먼저), README의 DB 절과 설계서 14.3절의 한 줄을 맞춘다.

## 진행 로그

- 2026-11-20 접수: 제작자가 대화에서 Q10의 판단 기준을 주었다. Issue #166을 등록하고 `new-task`로 시작했다.
- 2026-11-20 사전 확인(임시 폴더, macOS arm64, Node 22.23.3, pnpm 10.34.5): `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.17.
  - PGlite: 런타임 의존성 0, 설치 스크립트 없음, `.node` 0개·`.wasm` 2개, `os`·`cpu` 제한 없음. `select version()`은 `PostgreSQL 18.7 (PGlite 0.5.17) on wasm3`.
  - `drizzle-kit generate`가 `CREATE TABLE` SQL 파일을 만들었고 `drizzle-orm/pglite/migrator`가 적용했다. 설치 스크립트를 가진 패키지는 `esbuild` 셋(0.18.20, 0.25.12, 0.28.2)뿐이고, pnpm이 그 스크립트를 실행하지 않은 상태에서 동작했다. `esbuild`의 선택 의존성에 `@esbuild/win32-x64`, `@esbuild/linux-x64`, `@esbuild/darwin-arm64`가 있다.
  - 폴더 둘이 격리됐고(각 1행), 같은 폴더를 다시 열면 2행, 메모리 DB 1행, 서로 다른 폴더 동시 실행 각 1행. 첫 기동 0.7초쯤, 폴더당 38MB쯤. 상위 폴더가 없으면 PGlite가 폴더를 만들지 못한다(상위 폴더는 미리 만든다).
  - 이 Mac에는 컨테이너 런타임(`docker`)이 없다.
- 2026-11-20 계획 작성. `drizzle-kit --help`의 명령: `generate`, `migrate`, `introspect`, `push`, `studio`, `up`, `check`, `drop`, `export`.

## 의사결정 로그

- 결정: PostgreSQL + Drizzle로 하고, 일회용 DB(14.3절)는 내장 PostgreSQL(PGlite)로 둔다. / 이유: 기준은 "PC·개발 환경에 영향이 없는가"다. 서버형 PostgreSQL은 PC마다 설치(또는 컨테이너 런타임)·포트·버전·계정을 맞춰야 하고 CI에 서비스 컨테이너가 필요하다(워크플로 변경). PGlite는 패키지 하나이고 네이티브 바이너리와 설치 스크립트가 없어 준비할 것이 `pnpm install`뿐이다. / 버린 대안: 서버형 PostgreSQL을 PC마다 설치(환경 영향이 있어 기준에 어긋난다), SQLite(운영 DB와 방언이 달라 개발에서 본 동작이 운영과 어긋난다), DB 없이 시작(기준이 충족되면 고르지 않는다. PGlite가 다른 머신에서 돌지 않으면 이쪽으로 되돌린다).
- 결정: Windows 네이티브와 Linux의 실측은 이 계획에서 하지 않고, 같은 절차로 다시 잴 수 있게 `lab/q10-db/`를 남긴다. / 이유: 이 세션이 쓸 수 있는 머신은 Mac 하나다. 구조상(WASM, 네이티브 바이너리 없음) 같을 것으로 보지만 확인한 것이 아니므로 ADR과 TD-14에 "확인 전"으로 적는다. Linux는 파일럿 리포의 CI가 DB 테스트를 처음 돌릴 때 드러난다.
- 결정: 프로파일이 막는 `drizzle-kit` 명령은 "DB에 접속하는 것"(`migrate`, `studio`, `introspect`, `pull`. `push`는 코어)과 "마이그레이션 파일을 지우는 것"(`drop`)이다. 파일만 다루는 `generate`, `check`, `export`, `up`은 허용한다. / 이유: 14.3절의 환경 구분 표는 일회용 DB를 "표준 명령을 통해서만" 쓰게 한다. `drizzle-kit`이 접속하는 DB는 설정 파일과 환경 변수가 정하므로 에이전트가 직접 실행하면 대상이 일회용 DB인지 훅이 알 수 없다(14.3절 "대상 DB를 잘못 판단하는 사고"). `studio`는 데이터를 고치고 지울 수 있는 DB 클라이언트다("직접 접속"). `drop`은 마이그레이션 파일과 기록을 지운다("이력 변경"). / 버린 대안: `push`·`drop`만 막기(접속 대상을 가리지 못하는 `migrate`·`studio`가 남는다).
- 결정: step을 둘로 나눈다(결정 기록 / 차단 목록). / 이유: 앞은 문서와 `lab/`, 뒤는 프로파일 설정과 테스트라 검토할 것이 다르고, 한 PR이 400줄 안팎에 든다. 둘 다 보호 경로(`docs/harness/**`, `profiles/**`)를 바꾼다.
- 결정: 위험도 high. / 이유: R13의 차단 목록(보안 규칙)과 DB·마이그레이션 도구 결정을 다룬다.

## 발견 사항

- 코어 규칙이 이미 `drizzle-kit push`를 막는다(`scripts/hooks/rules.ts`의 `DB_PATTERNS`, `scripts/test/guard.test.ts`). Issue #166의 수용 기준("`drizzle-kit push`를 막고")은 지금도 참이라, 이 계획의 테스트는 프로파일이 더하는 명령을 본다(수용 기준 5). → 처리: 해당 없음(계획의 수용 기준에 반영했다)
- L1 훅은 명령 전체를 이어 붙인 글에서 패턴을 찾는다. 금지 명령의 이름이 인자나 커밋 메시지에 글자로 들어 있어도 막힌다(코어의 `drizzle-kit push`, DB 클라이언트 이름도 같다. 이 세션에서 DB 클라이언트가 설치됐는지 조회하는 명령이 막혔다). → 처리: 해당 없음(지금 동작이고 엄한 쪽이다. step1의 README에 적는다)

## 열린 질문

없음. Q13(개인 계정·조직)은 이 계획의 범위가 아니다(설계서 18절에 열린 채 남는다).

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- 수용 기준 1·2: `node lab/q10-db/check-results.ts darwin-arm64`, `node --test lab/q10-db/test/check-results.test.ts`.
- 수용 기준 3·4·6·7: 문서의 해당 줄을 `grep`으로 확인(각 step의 AC), `doc-lint`.
- 수용 기준 5: `node --test scripts/test/profile-web-db.test.ts`.
- 결과는 step을 진행하며 진행 로그에 적는다.

## 다음 할 일

1. 계획만 담은 커밋을 push하고 초안 PR을 연다(계획 검증, G1).
2. 두 검증자가 계획을 승인하면 step0을 구현한다.
3. step0이 병합되면 `new-task --plan 20261120-q10-db-decision --step 1`로 step1을 잇는다.
