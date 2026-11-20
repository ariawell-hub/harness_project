# Step 0: decision-record

## 읽어야 할 파일

- `ARCHITECTURE.md`
- 이 계획의 `plan.md`("목표와 수용 기준", 진행 로그의 사전 확인, 의사결정 로그)
- `lab/pilot-prep/README.md`, `lab/pilot-prep/check-results.ts`, `lab/pilot-prep/test/`(실물 확인을 남기는 방식의 본보기: 실행 스크립트가 결과 파일을 쓰고, 검사 스크립트가 기대값과 대 본다)
- `docs/decisions/ADR-0006-pr-update-merge.md`(ADR 형식과 frontmatter), `docs/decisions/index.md`
- `docs/harness/design.md` 0절(실행 OS, 버전 이력), 14.3절, 18절(Q10 행과 이미 결정된 행의 적는 방식, 예: Q3), 19절 "현재 위치"
- `docs/exec-plans/tech-debt-tracker.md`의 TD-12, TD-14 행
- `harness.config.json`의 `testInertPaths`(`lab/**`는 이 리포의 테스트·`check` 대상이 아니다)

## 작업

### 1. 실물 확인 `lab/q10-db/`

테스트(`lab/q10-db/test/check-results.test.ts`)를 먼저 쓰고 실패하는 것을 확인해 진행 로그에 적는다(R5).

- `lab/q10-db/README.md`: 무엇을 확인하는지, 절차, 파일 표, 결과 파일을 손으로 고치지 않는다는 것, 다른 머신(Windows 네이티브, Linux)에서 다시 재는 법.

  ```bash
  T=$(mktemp -d)
  node lab/q10-db/trial.ts "$T"
  node scripts/harness.ts fmt
  node lab/q10-db/check-results.ts <platform>-<arch>
  ```

- `lab/q10-db/trial.ts <빈 폴더>`: 그 폴더에 시험 프로젝트를 만들고 돌려 `lab/q10-db/results/<platform>-<arch>.json`을 쓴다(`process.platform`, `process.arch`).
  - 프로젝트: `package.json`(`type: module`), 패키지 셋을 **정확한 버전**으로 설치한다(`drizzle-orm` 0.45.4, `@electric-sql/pglite` 0.5.17, `drizzle-kit` 0.31.11. `pnpm add --save-exact`). 버전은 `check-results.ts`가 내보내는 상수 하나를 쓴다. 테이블 하나짜리 스키마, `drizzle.config.ts`(`dialect: 'postgresql'`), DB 폴더를 인자로 받아 마이그레이션 적용 → 한 행 넣기 → 행 수와 `select version()`을 한 줄 JSON으로 내는 실행 파일.
  - 자식 프로세스는 인자 배열로 띄운다(셸 문자열을 만들지 않는다). `drizzle-kit`은 `node`로 그 패키지의 실행 파일을 직접 띄운다(`node_modules/.bin`의 셸 래퍼는 OS마다 다르다). 시간 제한을 둔다.
  - 설치는 설치 스크립트를 실행하지 않는 pnpm 기본 동작 그대로 한다(허용 목록을 더하지 않는다).
  - 결과에 담는 것: `platform`, `arch`, `node`(버전), `pnpm`(버전), `packages`(셋의 설치된 버전), `installScripts`(설치된 패키지 가운데 `preinstall`·`install`·`postinstall` 스크립트를 가진 패키지 이름의 정렬된 중복 없는 목록), `pglite`(`dependencies` 수, `.node` 파일 수, `.wasm` 파일 수, `os`·`cpu` 필드), `generate`(종료 코드, 만든 `.sql` 파일 수, `CREATE TABLE`이 있는지), `cases`(아래 사례별 종료 코드와 행 수), `server`(`select version()`의 앞 40자).
  - 사례(`cases`의 `name`): `folder-a`(새 폴더, 1행), `folder-b`(다른 새 폴더, 1행), `folder-a-again`(첫 폴더를 다시 연다, 2행), `memory`(메모리 DB, 1행), `concurrent-c`·`concurrent-d`(서로 다른 새 폴더 둘을 동시에 띄운다, 각 1행).
  - 결과에 절대 경로, 사용자 이름, 환경 변수 값, 걸린 시간을 담지 않는다(머신마다 달라 비교할 수 없고 개인 정보가 섞인다).
- `lab/q10-db/check-results.ts <결과 이름>`: `results/<결과 이름>.json`을 읽어 기대값과 대 보고, 어긋난 것을 한 줄씩 출력하고 종료 코드 1. 모두 맞으면 0. 검사 함수(`checkQ10(result: unknown): string[]`)와 버전 상수를 내보낸다.
  - 기대값: `packages`가 상수와 같다 / `pglite.dependencies` 0, `.node` 0, `.wasm` 1 이상, `os`·`cpu`가 없다 / `installScripts`가 `['esbuild']`의 부분집합이다(이름 기준) / `generate` 종료 코드 0, `.sql` 1개 이상, `CREATE TABLE` 있음 / 사례 여섯이 모두 있고 종료 코드 0이며 행 수가 위와 같다 / `server`가 `PostgreSQL`로 시작한다 / `platform`·`arch`가 파일 이름과 같다.
  - 꼴이 다른 입력(객체가 아님, 필드 없음, 사례가 빠짐)은 예외가 아니라 어긋남으로 보고한다.
- `lab/q10-db/test/check-results.test.ts`: 맞는 결과는 어긋남 0건. 어긋난 결과 각각이 걸린다(패키지 버전 다름, PGlite에 의존성이 생김, `.node` 파일이 생김, `esbuild`가 아닌 설치 스크립트, `generate` 실패, 격리가 깨짐(`folder-b` 2행), 다시 열었는데 1행, 사례가 빠짐, 파일 이름과 플랫폼이 다름, 객체가 아닌 입력).
- `lab/q10-db/results/darwin-arm64.json`: 이 Mac에서 `trial.ts`를 실제로 돌려 만든다. 손으로 쓰지 않는다.

### 2. ADR `docs/decisions/ADR-0007-db-postgres-drizzle.md`

ADR-0006의 형식(frontmatter, 날짜·상태·관련, 맥락·결정·결과)을 따른다. `related_code`는 `profiles/web/profile.json`. `docs/decisions/index.md`에 행을 더한다.

- 맥락: Q10이 열려 있었다. 기준(여러 PC·다양한 개발 환경에 영향이 없으면 PostgreSQL + Drizzle, 아니면 DB 없이 시작. 제작자 대화 지시 2026-11-20, Issue #166). 실행 환경(macOS·Windows 네이티브, CI는 Linux).
- 결정:
  1. 파일럿 웹 프로젝트의 DB는 PostgreSQL, ORM·마이그레이션 도구는 Drizzle(`drizzle-orm`, `drizzle-kit`)이다. 마이그레이션은 `drizzle-kit generate`가 만든 SQL 파일로 쓰고 리뷰받는다(14.3절).
  2. 일회용 DB(14.3절)는 내장 PostgreSQL(PGlite)이다. worktree 안의 폴더 하나가 DB 하나이고, 테스트는 메모리 DB를 쓴다. PC에 PostgreSQL 서버나 컨테이너 런타임을 요구하지 않는다.
  3. 운영 DB는 서버형 PostgreSQL이고 에이전트는 닿지 않는다(E4, 14.3절 그대로).
- 실측: `lab/q10-db/`의 절차와 결과(macOS arm64). 무엇을 쟀는지 요약.
- 알려진 한계:
  - Windows 네이티브와 Linux에서는 재지 않았다(TD-14, 파일럿 리포의 첫 CI).
  - PGlite는 한 프로세스가 연결 하나로 쓴다. 같은 폴더를 두 프로세스가 함께 열 수 없으므로 `dev`와 테스트는 서로 다른 DB를 쓴다.
  - 개발·테스트(PGlite)와 운영(서버형 PostgreSQL)은 드라이버가 다르다. 연결 풀, 동시성, 확장 기능의 차이는 로컬에서 드러나지 않는다.
  - `drizzle-kit`은 되돌리는 마이그레이션을 만들지 않는다. 14.3절이 요구하는 "적용 → 롤백 → 재적용" 증거의 롤백 SQL은 손으로 쓴다.
  - `drizzle-kit`은 `esbuild`에 기댄다(설치 스크립트는 실행하지 않아도 동작했다. R17의 허용 목록에 더하지 않는다).
- 되돌리는 조건: 다른 실행 환경에서 `lab/q10-db/`의 검사가 통과하지 않고 고칠 수 없으면, 기준대로 "DB 없이 시작"으로 바꾸고 이 ADR을 대체하는 ADR을 쓴다.
- 버린 대안: 서버형 PostgreSQL을 PC마다 설치, SQLite, Prisma(계획 `20261119-pilot-prep`의 "열린 질문" Q10 B), DB 없이 시작.

### 3. 설계서 `docs/harness/design.md`

- 18절 Q10 행: 다른 결정된 행(Q3)의 적는 방식대로 "결정: …(ADR-0007)". 내용: PostgreSQL + Drizzle, 일회용 DB는 PGlite, 차단 목록은 웹 프로파일이 채운다(14.3절).
- 19절 "현재 위치" 줄: 착수 전에 정할 것에서 Q10을 빼고 Q13만 남긴다(Q10은 정해졌다고 적는다). "단계별 선행 결정" 줄의 Q10은 그대로 둔다(단계와 질문의 대응이다).
- 14.3절 "DB 환경 구분" 표 아래에 항목 하나: 웹 프로파일의 일회용 DB는 worktree 안의 PGlite 폴더(테스트는 메모리)이고 PC에 DB 서버를 두지 않는다(ADR-0007). 표준 명령에 잇는 일은 파일럿 리포에서 한다(TD-12).
- 14.3절의 금지 분류 표, "코드·마이그레이션에 들어가는 것", 강제 장치 표는 고치지 않는다.
- 0절 버전 이력에 한 줄, 문서 머리의 버전. `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄. 번호는 push할 때 main의 다음 번호다. 다른 PR이 먼저 병합되면 `origin/main`을 병합하고 다시 잡는다.

### 4. 기술 부채 표 `docs/exec-plans/tech-debt-tracker.md`

- TD-12 행의 (3): "Q10 뒤"를 "Q10은 정해졌다(ADR-0007: PGlite 폴더). 파일럿 대상 리포의 DB를 쓰는 첫 작업에서 표준 명령에 잇는다"로 바꾼다. 나머지 문장은 그대로 둔다.
- TD-14 행: 확인할 것에 "`lab/q10-db/`의 실물 확인(PGlite·`drizzle-kit`)을 Windows에서 다시 돌려 결과 파일을 더한다"를 더한다. 나머지 문장은 그대로 둔다.
- 다른 행은 고치지 않는다.

## Acceptance Criteria

```bash
node --test lab/q10-db/test/check-results.test.ts
node lab/q10-db/check-results.ts darwin-arm64
test -f docs/decisions/ADR-0007-db-postgres-drizzle.md
grep -q "ADR-0007" docs/decisions/index.md
grep "^| Q10 " docs/harness/design.md | grep -q "ADR-0007"
grep "^| Q10 " docs/harness/design.md | grep -q "PGlite"
grep "^| TD-12 " docs/exec-plans/tech-debt-tracker.md | grep -q "ADR-0007"
grep "^| TD-14 " docs/exec-plans/tech-debt-tracker.md | grep -q "lab/q10-db"
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

## 금지사항

- `profiles/web/profile.json`과 `scripts/`를 고치지 마라. 이유: 차단 목록과 그 테스트는 step1의 범위다.
- 결과 파일(`lab/q10-db/results/*.json`)을 손으로 쓰거나 고치지 마라. 이유: 실측 기록이다. 기대와 다르면 스크립트나 절차를 고치고 다시 돌린다.
- Windows·Linux의 결과 파일을 추정으로 만들지 마라. 이유: 재지 않은 환경을 잰 것으로 남기면 기준("영향이 없는가")의 근거가 거짓이 된다.
- 결과 파일과 문서에 절대 경로, 사용자 이름, 환경 변수 값을 넣지 마라. 이유: 개인 정보이고 머신마다 달라 비교할 수 없다.
- 설치 스크립트 허용 목록(`onlyBuiltDependencies` 등)에 패키지를 더하지 마라. 이유: R17. 설치 스크립트 없이 도는지가 확인 대상이다.
- 14.3절의 금지 분류 표와 강제 장치 표를 고치지 마라. 이유: 이 step은 규칙을 바꾸지 않는다.
- `.github/workflows/`를 고치지 마라. 이유: 워크플로 변경은 제작자가 직접 커밋한다.
- 기술 부채 표에서 TD-12·TD-14 밖의 행을 고치지 마라. 이유: 다른 세션의 PR과 충돌한다.
