# Step 0: decision-record

## 읽어야 할 파일

- `ARCHITECTURE.md`
- 이 계획의 `plan.md`("목표와 수용 기준", 진행 로그의 사전 확인과 계획 검증 1라운드, 의사결정 로그)
- `lab/pilot-prep/README.md`, `lab/pilot-prep/check-results.ts`, `lab/pilot-prep/test/`(실물 확인을 남기는 방식의 본보기: 실행 스크립트가 결과 파일을 쓰고, 검사 스크립트가 기대값과 대 본다)
- `pnpm-workspace.yaml`(R17 설치 정책: 게시 후 최소 기간 `minimumReleaseAge`, 설치 스크립트 허용 목록 `onlyBuiltDependencies`)
- `docs/decisions/ADR-0006-pr-update-merge.md`(ADR 형식과 frontmatter), `docs/decisions/index.md`
- `docs/harness/design.md` 0절(실행 OS, 버전 이력), 14.3절, 18절(Q10 행과 이미 결정된 행의 적는 방식, 예: Q3), 19절 "현재 위치"
- `docs/exec-plans/tech-debt-tracker.md`의 TD-12, TD-14 행
- `harness.config.json`의 `testInertPaths`(`lab/**`는 이 리포의 테스트·`check` 대상이 아니다)

## 작업

### 1. 실물 확인 `lab/q10-db/`

테스트(`lab/q10-db/test/check-results.test.ts`)를 먼저 쓰고 실패하는 것을 확인해 진행 로그에 적는다(R5).

- `lab/q10-db/README.md`: 무엇을 확인하는지, 절차, 파일 표, 결과 파일을 손으로 고치지 않는다는 것, 다른 머신(Windows 네이티브, Linux)에서 다시 재는 법, 잰 머신의 표, 이 확인이 보지 않는 것.

  ```bash
  T=$(mktemp -d)
  node lab/q10-db/trial.ts "$T"
  node scripts/harness.ts fmt
  node lab/q10-db/check-results.ts <platform>-<arch>
  ```

- `lab/q10-db/trial.ts <빈 폴더> [--out <결과 파일>]`: 그 폴더에 시험 프로젝트를 만들고 돌려 결과 파일을 쓴다. `--out`이 없으면 `lab/q10-db/results/<platform>-<arch>.json`(`process.platform`, `process.arch`)이다. `--out`은 결과를 리포 밖에 쓰게 해 AC가 작업 트리를 바꾸지 않고 절차를 돌리는 데 쓴다.
  - **설치 정책(R17)을 그대로 적용한다.** 이 리포의 `pnpm-workspace.yaml`을 시험 프로젝트의 루트에 그대로 복사한 뒤 설치한다. 그래야 게시 후 최소 기간과 설치 스크립트 차단이 실제 리포와 같게 걸린다. 정책을 느슨하게 하는 인자·환경 변수·설정을 더하지 않는다. 정책 때문에 설치가 거부되면 실패로 끝낸다(결과 파일을 쓰지 않는다).
  - 프로젝트: `package.json`(`type: module`), 패키지 셋을 **정확한 버전**으로 설치한다(`pnpm add --save-exact`). 버전은 `check-results.ts`가 내보내는 상수 하나를 쓴다. 상수의 값은 정책 아래에서 설치되는 버전이어야 한다(2026-11-20 기준 `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.15. 계획의 진행 로그). 테이블 하나짜리 스키마, `drizzle.config.ts`(`dialect: 'postgresql'`), DB 위치를 인자로 받아 마이그레이션 적용 → 한 행 넣기 → 행 수와 `select version()`을 한 줄 JSON으로 내는 실행 파일.
  - 자식 프로세스는 인자 배열로 띄운다. 인자에 바깥 입력을 넣지 않는다(상수와 이 스크립트가 만든 경로만). `drizzle-kit`은 `node`로 그 패키지의 실행 파일을 직접 띄운다(`node_modules/.bin`의 셸 래퍼는 OS마다 다르다). pnpm은 Windows에서 `.cmd`라 셸을 거쳐야 실행되므로 그 OS에서만 셸을 켠다. 시간 제한을 둔다.
  - 결과에 담는 것: `platform`, `arch`, `node`(버전), `pnpm`(버전), `policy`(시험 프로젝트에 놓인 정책 파일에서 읽은 `minimumReleaseAge` 값과 `onlyBuiltDependencies`의 항목 수), `packages`(셋의 설치된 버전), `installScripts`(설치된 패키지 가운데 `preinstall`·`install`·`postinstall` 스크립트를 가진 패키지 이름의 정렬된 중복 없는 목록), `pglite`(`dependencies` 수, `.node` 파일 수, `.wasm` 파일 수, `os`·`cpu` 필드), `generate`(종료 코드, 만든 `.sql` 파일 수, `CREATE TABLE`이 있는지), `cases`(아래 사례별 종료 코드와 행 수), `server`(`select version()`의 앞 40자).
  - 사례(`cases`의 `name`): `folder-a`(새 폴더, 1행), `folder-b`(다른 새 폴더, 1행), `folder-a-again`(첫 폴더를 다시 연다, 2행), `memory`(메모리 DB, 1행), `concurrent-c`·`concurrent-d`(서로 다른 새 폴더 둘을 동시에 띄운다, 각 1행).
  - 결과에 절대 경로, 사용자 이름, 환경 변수 값, 걸린 시간을 담지 않는다(머신마다 달라 비교할 수 없고 개인 정보가 섞인다).
- `lab/q10-db/check-results.ts <결과 이름>` 또는 `--file <결과 파일>`: 결과를 읽어 기대값과 대 보고, 어긋난 것을 한 줄씩 출력하고 종료 코드 1. 모두 맞으면 0. `<결과 이름>`은 `results/<결과 이름>.json`을 읽고 그 이름과 결과의 `platform`·`arch`를 대 본다. `--file`은 그 파일을 읽고 실행 중인 머신의 `platform`·`arch`와 대 본다. 검사 함수(`checkQ10(result: unknown): string[]`, `checkPlatform(result: unknown, name: string): string[]`)와 버전 상수를 내보낸다.
  - 기대값: `packages`가 상수와 같다 / `policy.minimumReleaseAge`가 20160 이상이고 `policy.onlyBuiltDependencies`가 0이다 / `pglite.dependencies` 0, `.node` 0, `.wasm` 1 이상, `os`·`cpu`가 없다 / `installScripts`가 `['esbuild']`의 부분집합이다(이름 기준) / `generate` 종료 코드 0, `.sql` 1개 이상, `CREATE TABLE` 있음 / 사례 여섯이 모두 한 번씩 있고 종료 코드 0이며 행 수가 위와 같다(모르는 사례가 없다) / `server`가 `PostgreSQL`로 시작한다 / `platform`·`arch`가 맞다.
  - 꼴이 다른 입력(객체가 아님, 필드 없음, 사례가 빠짐)은 예외가 아니라 어긋남으로 보고한다.
- `lab/q10-db/test/check-results.test.ts`: 맞는 결과는 어긋남 0건. 어긋난 결과 각각이 걸린다(패키지 버전 다름, 정책이 느슨함(최소 기간이 짧다, 설치 스크립트 허용 항목이 있다, `policy`가 없다), PGlite에 의존성이 생김, `.node` 파일이 생김, `esbuild`가 아닌 설치 스크립트, `generate` 실패, 격리가 깨짐(`folder-b` 2행), 다시 열었는데 1행, 사례가 빠짐·겹침, 플랫폼이 다름, 객체가 아닌 입력).
- `lab/q10-db/results/darwin-arm64.json`: 이 Mac에서 `trial.ts`를 실제로 돌려 만든다. 손으로 쓰지 않는다.

### 2. ADR `docs/decisions/ADR-0007-db-postgres-drizzle.md`

ADR-0006의 형식(frontmatter, 날짜·상태·관련)을 따른다. `related_code`는 `profiles/web/profile.json`. `docs/decisions/index.md`에 행을 더한다(상태 칸은 "잠정"). 아래 제목의 절을 둔다.

- `## 맥락`: Q10이 열려 있었다. 기준(여러 PC·다양한 개발 환경에 영향이 없으면 PostgreSQL + Drizzle, 아니면 DB 없이 시작. 제작자 대화 지시 2026-11-20, Issue #166). 실행 환경(macOS·Windows 네이티브, CI는 Linux).
- 머리의 상태 줄: `- 상태: 잠정 (…)`. macOS에서만 쟀고, 아래 확정 조건이 채워지면 채택으로 바꾼다고 적는다.
- `## 결정`:
  1. 파일럿 웹 프로젝트의 DB는 PostgreSQL, ORM·마이그레이션 도구는 Drizzle(`drizzle-orm`, `drizzle-kit`)이다. 마이그레이션은 `drizzle-kit generate`가 만든 SQL 파일로 쓰고 리뷰받는다(14.3절).
  2. 일회용 DB(14.3절)는 내장 PostgreSQL(PGlite)이다. worktree 안의 폴더 하나가 DB 하나이고, 테스트는 메모리 DB를 쓴다. PC에 PostgreSQL 서버나 컨테이너 런타임을 요구하지 않는다.
  3. 운영 DB는 서버형 PostgreSQL이고 에이전트는 닿지 않는다(E4, 14.3절 그대로).
- `## 실측`: `lab/q10-db/`의 절차와 결과(macOS arm64). 무엇을 쟀는지 요약. 설치 정책(R17)을 적용한 상태에서 쟀다는 것과 그 정책 아래의 버전.
- `## 확정 조건`: 기준은 여러 실행 환경을 묻는데 잰 것은 하나다. Windows 네이티브(`win32-*`)와 Linux(`linux-*`)에서 `lab/q10-db`의 절차를 돌린 결과 파일이 `results/`에 있고 검사를 통과하면 상태를 채택으로 바꾸고, 설계서 18절 Q10 행과 19절 "현재 위치"를 확정으로 고친다(그 변경은 별도 PR). 그 전까지 Q10은 3단계 착수 전에 끝낼 것으로 남는다.
- `## 알려진 한계`:
  - PGlite는 한 프로세스가 연결 하나로 쓴다. 같은 폴더를 두 프로세스가 함께 열 수 없으므로 `dev`와 테스트는 서로 다른 DB를 쓴다.
  - 개발·테스트(PGlite)와 운영(서버형 PostgreSQL)은 드라이버가 다르다. 연결 풀, 동시성, 확장 기능의 차이는 로컬에서 드러나지 않는다.
  - `drizzle-kit`은 되돌리는 마이그레이션을 만들지 않는다. 14.3절이 요구하는 "적용 → 롤백 → 재적용" 증거의 롤백 SQL은 손으로 쓴다.
  - `drizzle-kit`은 `esbuild`에 기댄다(설치 스크립트는 실행하지 않아도 동작했다. R17의 허용 목록에 더하지 않는다).
  - 설치 정책(게시 후 14일) 때문에 최신 버전을 바로 쓰지 못한다(잰 날 PGlite의 최신 버전은 정책에 걸렸다).
  - 일회용 DB를 표준 명령에 잇는 일은 아직 없다(TD-12).
- `## 되돌리는 조건`: 다른 실행 환경에서 `lab/q10-db/`의 검사가 통과하지 않고 고칠 수 없으면, 기준대로 "DB 없이 시작"으로 바꾸고 이 ADR을 대체하는 ADR을 쓴다.
- `## 버린 대안`: 서버형 PostgreSQL을 PC마다 설치, SQLite, Prisma(계획 `20261119-pilot-prep`의 "열린 질문" Q10 B), DB 없이 시작.

### 3. 설계서 `docs/harness/design.md`

- 18절 Q10 행: "잠정 결정: …(ADR-0007)". 내용: PostgreSQL + Drizzle, 일회용 DB는 PGlite, macOS에서 쟀고 Windows 네이티브와 Linux의 결과가 통과하면 확정한다(TD-14), 차단 목록은 웹 프로파일이 채운다(14.3절).
- 19절 "현재 위치" 줄: Q10을 착수 전에 정할 것에서 빼지 않는다. Q10은 잠정 결정이고 Windows 네이티브·Linux 실측이 남았다는 것(ADR-0007)과 Q13이 열려 있다는 것을 적는다. "단계별 선행 결정" 줄은 그대로 둔다.
- 14.3절 "DB 환경 구분" 표 아래에 항목 하나: 웹 프로파일의 일회용 DB는 worktree 안의 PGlite 폴더(테스트는 메모리)이고 PC에 DB 서버를 두지 않는다(ADR-0007, 잠정). 표준 명령에 잇는 일은 파일럿 리포에서 한다(TD-12).
- 14.3절의 금지 분류 표, "코드·마이그레이션에 들어가는 것", 강제 장치 표는 고치지 않는다.
- 0절 버전 이력에 한 줄, 문서 머리의 버전. `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄. 번호는 push할 때 main의 다음 번호다. 다른 PR이 먼저 병합되면 `origin/main`을 병합하고 다시 잡는다.

### 4. 기술 부채 표 `docs/exec-plans/tech-debt-tracker.md`

- TD-12 행의 (3): "Q10 뒤"를 "Q10은 잠정 결정이다(ADR-0007: worktree 안의 PGlite 폴더). 파일럿 대상 리포의 DB를 쓰는 첫 작업에서 표준 명령에 잇는다"로 바꾼다. 나머지 문장은 그대로 둔다.
- TD-14 행: 확인할 것에 "`lab/q10-db/`의 실물 확인(PGlite·`drizzle-kit`)을 Windows에서 다시 돌려 결과 파일을 더한다. Linux 결과와 함께 ADR-0007의 확정 조건이다"를 더한다. 나머지 문장은 그대로 둔다.
- 다른 행은 고치지 않는다.

### 5. 색인

- `docs/index.md`의 실물 확인 목록에 `lab/q10-db/README.md`를 더한다.

## Acceptance Criteria

```bash
node --test lab/q10-db/test/check-results.test.ts
test -f lab/q10-db/README.md
test -f lab/q10-db/trial.ts
grep -q "pnpm-workspace.yaml" lab/q10-db/trial.ts
P=$(mktemp -d) && O=$(mktemp -d) && node lab/q10-db/trial.ts "$P" --out "$O/result.json" && node lab/q10-db/check-results.ts --file "$O/result.json"
node lab/q10-db/check-results.ts darwin-arm64
grep -q "^- 상태: 잠정" docs/decisions/ADR-0007-db-postgres-drizzle.md
grep -q "^## 실측" docs/decisions/ADR-0007-db-postgres-drizzle.md
grep -q "^## 확정 조건" docs/decisions/ADR-0007-db-postgres-drizzle.md
grep -q "^## 알려진 한계" docs/decisions/ADR-0007-db-postgres-drizzle.md
grep -q "^## 되돌리는 조건" docs/decisions/ADR-0007-db-postgres-drizzle.md
sed -n '/^## 확정 조건/,/^## 알려진 한계/p' docs/decisions/ADR-0007-db-postgres-drizzle.md | grep "win32" | grep -q "linux"
grep "ADR-0007" docs/decisions/index.md | grep -q "잠정"
grep "^| Q10 " docs/harness/design.md | grep "ADR-0007" | grep "PGlite" | grep -q "잠정"
grep "현재 위치" docs/harness/design.md | grep "Q10" | grep "잠정" | grep -q "Q13"
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep "PGlite" | grep -q "ADR-0007"
sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | grep -q "drizzle-kit[ ]push"
grep "^| TD-12 " docs/exec-plans/tech-debt-tracker.md | grep -q "ADR-0007"
grep "^| TD-14 " docs/exec-plans/tech-debt-tracker.md | grep "lab/q10-db" | grep -q "ADR-0007"
grep -q "lab/q10-db/README.md" docs/index.md
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 다섯째 줄은 실물 확인을 실제로 돌린다(패키지 설치에 네트워크가 필요하고 1~2분 걸린다). 결과는 리포 밖 임시 폴더에 쓴다. 이 줄이 실행한 머신에서 통과하지 않으면 그 머신에서는 기준이 충족되지 않은 것이다(ADR-0007의 "되돌리는 조건").
- 열일곱째 줄은 14.3절의 금지 분류 표에 있던 예시(스키마 diff 자동 적용)가 그대로 남아 있는지 본다. 찾는 글을 `[ ]`로 쓴 이유: 금지 명령의 글자가 그대로 든 명령은 대화 세션의 L1 훅이 막는다(읽기만 하는 `grep`이어도).

## 금지사항

- `profiles/web/profile.json`과 `scripts/`를 고치지 마라. 이유: 차단 목록과 그 테스트는 step1의 범위다.
- 결과 파일(`lab/q10-db/results/*.json`)을 손으로 쓰거나 고치지 마라. 이유: 실측 기록이다. 기대와 다르면 스크립트나 절차를 고치고 다시 돌린다.
- Windows·Linux의 결과 파일을 추정으로 만들지 마라. 이유: 재지 않은 환경을 잰 것으로 남기면 기준("영향이 없는가")의 근거가 거짓이 된다.
- ADR의 상태를 "채택"으로, 설계서의 Q10을 "결정"(확정)으로 적지 마라. 이유: 기준은 여러 실행 환경을 묻는데 잰 것은 macOS 하나다. 확정은 ADR의 확정 조건이 채워진 뒤의 별도 변경이다.
- 시험 프로젝트의 설치 정책을 느슨하게 하지 마라(`pnpm-workspace.yaml`을 복사하지 않기, 값을 바꾸기, 정책을 끄는 인자·환경 변수). 이유: R17. 실제 리포에서 설치가 거부될 버전으로 잰 결과는 근거가 되지 못한다.
- `pnpm-workspace.yaml`과 설치 스크립트 허용 목록을 고치지 마라. 이유: R17. 설치 스크립트 없이 도는지가 확인 대상이다.
- 결과 파일과 문서에 절대 경로, 사용자 이름, 환경 변수 값을 넣지 마라. 이유: 개인 정보이고 머신마다 달라 비교할 수 없다.
- 14.3절의 금지 분류 표와 강제 장치 표를 고치지 마라. 이유: 이 step은 규칙을 바꾸지 않는다.
- `.github/workflows/`를 고치지 마라. 이유: 워크플로 변경은 제작자가 직접 커밋한다.
- 기술 부채 표에서 TD-12·TD-14 밖의 행을 고치지 마라. 이유: 다른 세션의 PR과 충돌한다.
