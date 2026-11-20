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

1. `lab/q10-db/`에 실물 확인의 절차(README), 실행 스크립트, 검사 스크립트, 결과 파일이 있다. 결과 파일 이름은 실행한 머신의 `<platform>-<arch>`이고(이 계획은 `darwin-arm64.json`을 남긴다), 다른 머신에서 같은 절차로 결과 파일을 더할 수 있다. `node lab/q10-db/check-results.ts darwin-arm64`가 종료 코드 0이다. step의 AC가 실행 스크립트를 실제로 돌려(결과는 리포 밖에 쓴다) 그 머신의 새 결과가 검사를 통과하는지 본다.
2. 실행 스크립트는 이 리포의 설치 정책(R17, `pnpm-workspace.yaml`: 게시 후 최소 기간, 설치 스크립트 차단)을 시험 프로젝트에 그대로 적용해 설치한다. 설치 전에, 실제로 쓰는 pnpm이 이 리포의 `packageManager`와 같은 버전이고 게시 후 최소 기간을 실제로 적용하는지(정책을 엄하게 한 폴더에서 설치가 거부되는지) 확인하고, 아니면 결과를 쓰지 않고 실패한다. 검사 스크립트는 다음이 어긋나면 종료 코드 1이다: 고정한 패키지 버전, 적용된 설치 정책(최소 기간이 20160분 이상, 설치 스크립트 허용 항목 0, 적용 확인 통과, pnpm 버전이 이 리포의 `package.json`에 적힌 `packageManager`와 같음. 검사 스크립트가 리포의 값을 직접 읽어 본다), PGlite에 런타임 의존성·네이티브 바이너리·`os`/`cpu` 제한이 없음, 설치 스크립트를 가진 패키지가 `esbuild`뿐임, `drizzle-kit generate`가 SQL 마이그레이션 파일을 만듦, 사례별 기대값(폴더 둘의 격리, 같은 폴더를 다시 열면 데이터가 남음, 메모리 DB, 서로 다른 폴더의 동시 실행). 검사 스크립트의 테스트가 있다.
3. `docs/decisions/ADR-0007-db-postgres-drizzle.md`가 결정, 기준, 실측, 확정 조건, 알려진 한계, 되돌리는 조건을 적고 `docs/decisions/index.md`에 올라 있다. **상태는 "잠정"이다.** 기준은 여러 실행 환경을 묻는데 이 계획이 잰 것은 macOS 하나이기 때문이다. 확정 조건은 실행할 수 있는 명령으로 둔다: `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0이다. 이 명령은 macOS(`darwin-*`), Windows 네이티브(`win32-*`), Linux(`linux-*`) 세 환경의 결과 파일이 모두 있고 모두 검사를 통과할 때만 0이다(환경 하나만 더 통과한 상태는 1이다. 테스트가 본다). 이 계획이 끝난 시점에는 1이다.
4. 설계서 18절의 Q10 행이 잠정 결정(PostgreSQL + Drizzle, 일회용 DB는 PGlite)으로 적혀 있고 ADR-0007을 가리킨다. 19절 "현재 위치"의 착수 전에 정할 것에 Q10이 남아 있되 "잠정 결정, Windows 네이티브·Linux 실측이 남았다"로 적히고, Q13은 그대로 열려 있다. 14.3절에 웹 프로파일의 일회용 DB가 무엇인지 한 항목이 있다.
5. 웹 프로파일을 적용한 설정(`init --profile web`)의 `guard.dbPatterns`로 L1 규칙(`scripts/hooks/rules.ts`의 `evaluate`)을 돌리면, DB에 접속하는 `drizzle-kit` 명령(`migrate`, `studio`, `introspect`, `pull`, `push`)과 마이그레이션 파일을 지우는 `drop`이 R13으로 막히고, 파일만 다루는 명령(`generate`, `check`, `export`, `up`)은 막히지 않는다. 플래그가 하위 명령 앞에 오는 형태(`drizzle-kit --config x migrate`)도 막힌다. 코어 규칙은 하위 명령이 바로 뒤에 오는 `push`만 막는다(그대로다).
6. `profiles/web/README.md`에 DB 절이 있다: 선택한 도구와 버전, 일회용 DB의 규약(worktree 안의 폴더, 테스트는 메모리), 허용·금지 명령, 훅이 보지 못하는 것(패키지 스크립트 안의 명령), 한계.
7. 기술 부채 표의 TD-12 (3)(Q10을 기다리던 일회용 DB 연결)과 TD-14(Windows 실기 검증)가 결정에 맞게 고쳐져 있다. 코어 DB 패턴이 플래그가 앞에 오는 호출을 놓친다는 것이 새 행으로 남아 있다.
8. 14.3절의 규칙을 빼거나 약하게 바꾸지 않는다. 각 step의 AC가 기대한 14.3절을 만들어 지금의 14.3절 전체와 `diff`로 비교한다. 기대한 글은 PR이 갈라진 지점의 14.3절에 그 step의 허용된 변경 하나만 정해진 자리에 적용한 것이다(step0: "DB 환경 구분" 표의 마지막 행 아래에 항목 한 줄을 넣는다 / step1: "프로파일이 채운다" 줄을 그 자리에서 뒤에 덧붙인 줄로 바꾼다). 줄을 빼고 비교하지 않으므로 허용된 줄의 자리도 본다. 허용된 줄의 글은 각 step 파일의 "작업"과 AC에 글자 그대로 고정하고, 기대한 글은 그 고정한 글로 만든다(지금 파일에서 읽어 오지 않는다). `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- `lab/q10-db/`(새 폴더): 실물 확인 절차·스크립트·결과·검사·테스트.
- ADR-0007(새 파일)과 ADR 색인.
- 설계서 18절 Q10 행, 19절 "현재 위치", 14.3절(일회용 DB 항목 하나, "프로파일이 채운다" 줄), 0절 버전 이력. `docs/harness/CHANGELOG.md`.
- `profiles/web/profile.json`의 `guard.dbPatterns`와 버전, `profiles/web/README.md`.
- 새 테스트 `scripts/test/profile-web-db.test.ts`.
- 기술 부채 표의 TD-12·TD-14 행과 새 행 하나(코어 DB 패턴의 틈).

비범위:

- 일회용 DB를 표준 명령(`setup`·`test`·`dev`·`verify`)에 실제로 잇는 일(폴더 만들기·지우기, 마이그레이션 적용, 합성 시드). 이유: 파일럿 대상 리포의 앱 구조가 있어야 정할 수 있다. 그 리포의 DB를 쓰는 첫 작업에서 한다(TD-12 (3)).
- 코어 규칙(`scripts/hooks/rules.ts`의 `DB_PATTERNS`·`DB_CLIENTS`). 이유: 코어는 스택과 무관한 목록이고, 스택별 목록은 프로파일이 채운다(14.3절).
- L3 정적 검사(마이그레이션 SQL의 파괴적 구문 탐지), `riskPaths`(`drizzle/**`는 이미 high다).
- Q13(개인 계정·조직). 답을 받지 못했다.
- `.github/workflows/`.
- Windows 네이티브와 Linux에서의 실측, 그리고 그 결과에 따른 Q10 확정(ADR 상태를 채택으로, 18절·19절을 확정으로). 이유: 이 세션이 쓸 수 있는 머신은 Mac 하나다. 그 머신에서 `lab/q10-db`의 절차를 돌린 뒤 별도 PR로 한다(TD-14).

## 관련 파일·문서

- `lab/q10-db/README.md`, `lab/q10-db/trial.ts`, `lab/q10-db/check-results.ts`, `lab/q10-db/results/darwin-arm64.json`, `lab/q10-db/test/check-results.test.ts`
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `docs/decisions/index.md`, `docs/index.md`(색인에 올릴 것이 있으면)
- `docs/harness/design.md`(0절 버전 이력, 14.3절, 18절 Q10 행, 19절 "현재 위치"), `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`(파일 표에 올릴 것이 있으면)
- `docs/exec-plans/tech-debt-tracker.md`(TD-12, TD-14 행, 새 행 하나)
- `profiles/web/profile.json`, `profiles/web/README.md`
- `scripts/test/profile-web-db.test.ts`
- `docs/exec-plans/active/20261120-q10-db-decision/**`

## step 목록

- step0 decision-record: 실물 확인을 `lab/q10-db/`에 남기고(설치 정책을 적용해 잰다), ADR-0007(잠정)과 설계서 18절·19절·14.3절, 기술 부채 표에 잠정 결정과 확정 조건을 적는다.
- step1 drizzle-guard: 웹 프로파일의 `guard.dbPatterns`에 DB에 접속하는 `drizzle-kit` 명령과 `drop`을 더하고(플래그가 앞에 오는 형태 포함, 테스트 먼저), README의 DB 절과 설계서 14.3절의 한 줄을 맞춘다.

## 진행 로그

- 2026-11-20 접수: 제작자가 대화에서 Q10의 판단 기준을 주었다. Issue #166을 등록하고 `new-task`로 시작했다.
- 2026-11-20 사전 확인(임시 폴더, macOS arm64, Node 22.23.3, pnpm 10.34.5): `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.17.
  - PGlite: 런타임 의존성 0, 설치 스크립트 없음, `.node` 0개·`.wasm` 2개, `os`·`cpu` 제한 없음. `select version()`은 `PostgreSQL 18.7 (PGlite 0.5.17) on wasm3`.
  - `drizzle-kit generate`가 `CREATE TABLE` SQL 파일을 만들었고 `drizzle-orm/pglite/migrator`가 적용했다. 설치 스크립트를 가진 패키지는 `esbuild` 셋(0.18.20, 0.25.12, 0.28.2)뿐이고, pnpm이 그 스크립트를 실행하지 않은 상태에서 동작했다. `esbuild`의 선택 의존성에 `@esbuild/win32-x64`, `@esbuild/linux-x64`, `@esbuild/darwin-arm64`가 있다.
  - 폴더 둘이 격리됐고(각 1행), 같은 폴더를 다시 열면 2행, 메모리 DB 1행, 서로 다른 폴더 동시 실행 각 1행. 첫 기동 0.7초쯤, 폴더당 38MB쯤. 상위 폴더가 없으면 PGlite가 폴더를 만들지 못한다(상위 폴더는 미리 만든다).
  - 이 Mac에는 컨테이너 런타임(`docker`)이 없다.
- 2026-11-20 계획 작성. `drizzle-kit --help`의 명령: `generate`, `migrate`, `introspect`, `push`, `studio`, `up`, `check`, `drop`, `export`.
- 2026-11-20 계획 검증 1라운드(PR #167, head `1d0008a`): `review/claude` 승인(P2 1: F1), `review/codex` 수정 요청(P1 4: F2~F5). 다섯 모두 받아들여 계획을 고쳤다.
  - F2(macOS만 재고 Q10을 확정한다): 결정을 "잠정"으로 낮췄다. ADR 상태, 18절 Q10 행, 19절 "현재 위치"가 모두 잠정이고, Windows 네이티브와 Linux의 결과 파일이 검사를 통과하는 것을 확정 조건으로 적는다. 확정은 이 계획의 범위 밖이다.
  - F3(시험 프로젝트가 설치 정책을 재현하지 않는다): 사실이었다. 사전 확인에 쓴 `@electric-sql/pglite` 0.5.17은 2026-11-19에 게시돼, 이 리포의 `pnpm-workspace.yaml`(`minimumReleaseAge: 20160`)을 놓은 폴더에서는 `ERR_PNPM_NO_MATURE_MATCHING_VERSION`으로 거부됐다. 같은 폴더에서 버전을 정하지 않고 설치하니 0.5.15(2026-11-03 게시)가 들어왔다. `drizzle-orm` 0.45.4(2026-10-08)와 `drizzle-kit` 0.31.11(2026-09-21), `esbuild` 셋은 정책을 통과했다. 실행 스크립트가 정책 파일을 시험 프로젝트에 복사하게 하고, 결과에 적용된 정책을 담아 검사한다. 고정 버전의 PGlite를 0.5.15로 바꿨다.
  - F4(AC가 실행 스크립트를 돌리지 않는다): AC에 README·실행 스크립트의 존재와, 실행 스크립트를 실제로 돌려 리포 밖에 쓴 결과가 검사를 통과하는 줄을 더했다(`--out`, `--file`).
  - F5(문서 검사가 필수 내용을 보지 않는다): AC에 ADR의 절 제목(실측, 확정 조건, 알려진 한계, 되돌리는 조건)과 상태, 설계서 14.3절·18절·19절의 기대 상태, 색인을 확인하는 줄을 더했다.
  - F1(플래그가 하위 명령 앞에 오면 패턴을 피한다): 사실이었다. `drizzle-kit --config drizzle.config.ts generate`가 종료 코드 0으로 동작했다. step1의 패턴이 플래그를 건너뛰게 하고 사례를 더했다. 코어의 `push` 패턴도 같은 틈이 있어, 프로파일 패턴에 `push`를 넣고 코어의 틈은 기술 부채 표에 남긴다(코어 규칙은 이 계획의 범위 밖).
- 2026-11-20 계획 검증 2라운드(head `4779832`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F2·F4는 `fixed`, F3·F5는 열린 채, F6(P1)이 새로 나왔다. 셋을 받아들여 계획을 고쳤다.
  - F3(정책 파일을 놓아도 실제 쓴 pnpm이 적용하는지 모른다): 실행 스크립트가 설치 전에 두 가지를 확인하게 했다. pnpm 버전이 이 리포의 `packageManager`(`pnpm@10.34.5`)와 같은지, 그리고 최소 기간을 100년으로 올린 확인용 폴더에서 설치가 `NO_MATURE_MATCHING_VERSION`으로 거부되는지. 결과에 `packageManager`와 `policy.enforced`를 담아 검사한다.
  - F5(절의 본문이 비어 있어도 통과한다): AC가 ADR을 절 제목 사이로 잘라 본문의 필수 내용을 본다(실측: 정책 파일·`lab/q10-db`·버전 / 확정 조건: `win32`·`linux`·검사 스크립트·착수 전 / 알려진 한계: 다섯 항목의 말 / 되돌리는 조건: DB 없이 시작·대체하는 ADR).
  - F6(14.3절의 예시 하나만 본다): 예시 하나를 찾는 줄을 빼고, PR이 갈라진 지점의 14.3절과 지금의 14.3절을 비교하는 줄로 바꿨다. 있던 줄이 하나라도 빠지거나 바뀌면 실패한다.
- 2026-11-20 계획 검증 3라운드(head `d254f18`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청(새 지적 없음, F3·F5·F6이 열린 채). 같은 지적이 세 번째라 방법을 바꿨다(의사결정 로그).
  - F3(검사기가 결과 안의 두 칸만 비교한다): 검사 스크립트가 이 리포의 `package.json`에서 `packageManager`를 직접 읽어 기준으로 삼는다(`checkPnpm`).
  - F5(한 환경만 통과해도 확정한다고 적어도 통과한다): 확정 조건을 글이 아니라 명령으로 만들었다(`check-results.ts --confirm`). 세 환경이 모두 통과해야 0이라는 것은 테스트가 본다. ADR은 그 명령을 확정 조건으로 가리킨다.
  - F6(줄이 있는지만 봐서 표가 깨져도 통과한다): 줄 존재 검사를 `diff`로 바꿨다. 그 step이 더하거나 고치는 한 줄만 빼고 줄 순서·빈 줄까지 갈라진 지점과 같아야 한다.
- 2026-11-20 계획 검증 4라운드(head `dac6f50`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F3·F5는 `fixed`가 됐고 F6만 열려 있다.
  - F6(허용된 줄을 양쪽에서 빼고 비교해 그 줄의 자리를 보지 않는다): 줄을 빼고 비교하는 방식을 버렸다. 갈라진 지점의 14.3절에 허용된 변경 하나를 정해진 자리에 적용한 기대 글을 만들고, 지금의 14.3절 전체와 `diff`로 비교한다. 로컬에서 확인했다: 더한 줄을 금지 분류 표의 머리와 구분선 사이로 옮긴 판, 표 안에 빈 줄을 넣은 판, 표의 한 행을 바꾼 판이 모두 실패한다.
- 2026-11-20 계획 검증 5라운드(head `375c18e`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F6만 열려 있다.
  - F6(기대 글을 만들 때 검증 대상인 지금 파일의 줄을 그대로 쓴다): 14.3절에 넣는 줄(step0)과 고친 뒤의 줄(step1)의 글을 계획에 글자 그대로 고정했다. AC는 그 고정한 글로 기대 14.3절을 만들어 전체와 `diff`로 비교한다. 로컬에서 확인했다: 더한 줄의 뒤에 문장을 덧붙인 판이 실패한다.
- 2026-11-20 계획 검증 6라운드(head `34465ec`): `review/claude`, `review/codex` 모두 승인. 원장의 F2~F6은 `fixed`, F1(P2)은 `deferred`(step1에서 다룬다). 계획 검증(G1) 해시 `195027cf717b`.
- 2026-11-20 step0 구현. 테스트를 먼저 쓰고 실패를 확인한 뒤 구현했다(R5).
  - 검사 스크립트(`lab/q10-db/check-results.ts`): 처음에는 모듈이 없어 테스트가 실패했고(0개 통과), 구현 뒤 통과했다. 계획 검증을 거치며 사례를 더할 때마다 같은 순서로 했다. 설치 정책 사례(실패 확인 뒤 구현, 38개), 정책 적용 확인·pnpm 버전 사례(44개 가운데 새 6개가 실패 → 구현 뒤 44개 통과), 리포의 고정값 비교와 확정 조건 판정(`checkPnpm`·`confirmProblems`·`--confirm`: 내보내는 이름이 없어 실패 → 구현 뒤 57개 통과).
  - 실행 스크립트(`lab/q10-db/trial.ts`)는 설치 전에 pnpm 버전(`pnpm@10.34.5`)과 정책 적용(최소 기간 100년인 확인용 폴더에서 설치가 `NO_MATURE_MATCHING_VERSION`으로 거부된다)을 확인한다. 이 Mac에서 두 번 돌렸다: 리포 밖에 쓰는 실행(AC)과 `results/darwin-arm64.json`을 쓰는 실행. 둘 다 검사를 통과했다.
  - 결과(macOS arm64, Node 22.23.3): 패키지는 `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.15. PGlite는 런타임 의존성 0, `.node` 0, `os`·`cpu` 제한 없음. 설치 스크립트를 가진 패키지는 `esbuild`뿐. `drizzle-kit generate` 종료 코드 0. 사례 여섯이 기대대로다(1·1·2·1·1·1행).
  - `node lab/q10-db/check-results.ts --confirm`은 종료 코드 1이다(`win32`, `linux`의 결과가 없다). 확정 조건이 아직 채워지지 않았다는 뜻이고 이 step의 기대 상태다.
  - 문서: ADR-0007(잠정), `docs/decisions/index.md`, 설계서 v0.7.67(0절, 14.3절의 한 줄, 18절 Q10 행, 19절 "현재 위치"), CHANGELOG, 기술 부채 표의 TD-12 (3)·TD-14, `docs/index.md`. 14.3절에 넣은 줄은 계획에 고정한 글 그대로다.
- 2026-11-20 step0 구현 검증 1라운드(head `9213851`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청(P1 셋: F7·F8·F9). 셋 다 받아들여 고쳤다. 테스트를 먼저 쓰고 실패를 확인했다(75개 가운데 새 11개가 실패 → 고친 뒤 75개 통과).
  - F7(Windows에서 리포와 다른 드라이브의 임시 폴더가 거부된다): "리포 밖인가"의 판정을 함수(`isOutsideDir`)로 빼고, 상대 경로가 절대 경로로 나오는 경우(드라이브가 다르다)를 밖으로 본다. 첫 경로 구성 요소가 정확히 `..`인지 보므로 이름이 `..`으로 시작하는 리포 안의 폴더는 밖이 아니다. Windows 경로 규칙(`path.win32`)으로 테스트했다. 실제 Windows에서 돌린 것은 아니다.
  - F8(개수 칸이 소수·무한대여도 통과한다. 재현됨): `generate.sqlFiles`, `pglite.wasmFiles`, `policy.minimumReleaseAge`를 안전한 정수로 본다. JSON의 `1e309`(읽으면 무한대)를 넣은 결과 파일이 명령에서 종료 코드 1인 것을 테스트한다.
  - F9(절차가 Bash만 전제한다): `lab/q10-db/README.md`에 PowerShell 절차를 더했다. 그 절차는 Windows에서 돌려 보지 않았고 README에 그렇게 적었다.
  - 결과 파일은 고친 스크립트로 다시 만들었고 내용이 같다(변경 없음).
- 2026-11-20 main 병합: PR #162가 먼저 병합되어 `docs/harness/CHANGELOG.md`가 충돌했다. `origin/main`을 병합하고 병합 순서대로 정리했다(rebase하지 않는다). main의 설계서는 바뀌지 않아 버전은 v0.7.67 그대로다. 충돌한 head(`fbbdc3b`)에서는 CI의 `check`가 돌지 않아 판정이 나오지 않았다.
- 2026-11-20 step0 구현 검증 2라운드(head `18d17e2`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F7~F9는 `fixed`, F10(P1)이 새로 나왔다.
  - F10(PowerShell 절차가 `trial.ts`의 실패 뒤에도 이어져, 남아 있던 이전 결과 파일이 통과로 보일 수 있다): `lab/q10-db/README.md`의 두 절차를 실패한 자리에서 멈추게 고쳤다. Bash는 명령을 `&&`로 잇고, PowerShell은 블록 안에서 명령마다 `$LASTEXITCODE`를 보고 멈춘다. 같은 틈이 Bash 절차에도 있었다(줄마다 따로 돌렸다). 결과 이름은 손으로 적지 않고 `node -p`로 만든다. Bash 절차는 README의 글자 그대로 돌려 통과를 확인했고, 비어 있지 않은 폴더를 넘긴 실패 경로에서 검사가 돌지 않는 것도 확인했다. PowerShell 절차는 돌려 보지 못했다(이 Mac에 PowerShell이 없다. README에 적었다).
- 2026-11-21 step0 병합(PR #167, main `32190dc`). 구현 검증 3라운드에서 두 검증자가 승인했고, PR #164가 먼저 병합되어 `origin/main`을 한 번 더 병합한 뒤 초안을 풀었다.
- 2026-11-21 step1 구현. 테스트를 먼저 쓰고 실패를 확인한 뒤 설정을 고쳤다(R5).
  - `scripts/test/profile-web-db.test.ts`(새 파일, 7개): 설정을 고치기 전에는 5개가 실패했다(막혀야 할 명령이 통과, `drizzle-kit` 항목 없음). 통과하던 2개는 "허용되어야 하는 명령"과 "프로파일 패턴이 없을 때의 코어 동작"이다. `profiles/web/profile.json`의 `guard.dbPatterns`에 항목 하나를 더한 뒤 7개가 통과했다.
  - 자체 리뷰에서 경계 사례를 실제 훅 판정으로 돌려 틈 둘을 찾았다: 버전을 붙인 호출(`drizzle-kit@<버전> <하위 명령>`)과 패키지의 실행 파일을 직접 부르는 호출(`node node_modules/drizzle-kit/bin.cjs <하위 명령>`)이 통과했다. 사례를 테스트에 더해 실패를 확인하고(7개 가운데 1개 실패) 패턴이 도구 이름 뒤의 `@…`·`/…`를 건너뛰게 고쳤다(7개 통과).
  - 프로파일 버전을 0.3.0에서 0.4.0으로 올렸다. `scripts/test/profile-web.test.ts`의 버전 단언 하나(`web@0.3.0`)를 새 버전으로 고쳤다(단언을 지우거나 약하게 한 것이 아니다).
  - 문서: `profiles/web/README.md`의 "DB" 절, 설계서 v0.7.68(0절, 14.3절의 한 줄은 계획에 고정한 글 그대로), CHANGELOG, 기술 부채 표의 새 행 TD-61. `docs/harness/architecture.md`에는 테스트 파일을 하나씩 적는 표가 없어 고치지 않았다.

## 의사결정 로그

- 결정: PostgreSQL + Drizzle로 하고, 일회용 DB(14.3절)는 내장 PostgreSQL(PGlite)로 둔다. / 이유: 기준은 "PC·개발 환경에 영향이 없는가"다. 서버형 PostgreSQL은 PC마다 설치(또는 컨테이너 런타임)·포트·버전·계정을 맞춰야 하고 CI에 서비스 컨테이너가 필요하다(워크플로 변경). PGlite는 패키지 하나이고 네이티브 바이너리와 설치 스크립트가 없어 준비할 것이 `pnpm install`뿐이다. / 버린 대안: 서버형 PostgreSQL을 PC마다 설치(환경 영향이 있어 기준에 어긋난다), SQLite(운영 DB와 방언이 달라 개발에서 본 동작이 운영과 어긋난다), DB 없이 시작(기준이 충족되면 고르지 않는다. PGlite가 다른 머신에서 돌지 않으면 이쪽으로 되돌린다).
- 결정(계획 검증 F2 뒤에 고침): 이 계획이 남기는 결정은 "잠정"이다. Windows 네이티브와 Linux의 실측은 이 계획에서 하지 않고, 같은 절차로 다시 잴 수 있게 `lab/q10-db/`를 남긴다. 두 환경의 결과 파일이 검사를 통과하면 확정한다(별도 PR). / 이유: 기준은 "여러 PC·다양한 개발 환경"을 묻는데 이 세션이 쓸 수 있는 머신은 Mac 하나다. 구조상(WASM, 네이티브 바이너리 없음) 같을 것으로 보지만 확인한 것이 아니다. 처음에는 확정으로 적고 한계에 "확인 전"을 두려 했으나, 그러면 재지 않은 환경에서 실패해도 착수 전 결정이 끝난 것으로 남는다. / 버린 대안: macOS 결과만으로 확정, Linux를 "파일럿 리포의 첫 CI에서 드러난다"로 미루기(확정 조건이 검사할 수 없는 말이 된다).
- 결정(계획 검증 F3 뒤): 실물 확인은 이 리포의 설치 정책을 적용한 프로젝트에서 한다. / 이유: 파일럿 리포는 이 템플릿의 정책을 물려받는다. 정책 밖에서 잰 버전은 실제로는 설치되지 않을 수 있다(사전 확인의 PGlite 0.5.17이 그랬다).
- 결정: 프로파일이 막는 `drizzle-kit` 명령은 "DB에 접속하는 것"(`migrate`, `studio`, `introspect`, `pull`, `push`)과 "마이그레이션 파일을 지우는 것"(`drop`)이다. 플래그가 하위 명령 앞에 오는 형태도 막는다(계획 검증 F1). `push`는 코어도 막지만 코어 패턴은 플래그가 앞에 오는 형태를 놓쳐 프로파일 패턴에 함께 넣는다. 파일만 다루는 `generate`, `check`, `export`, `up`은 허용한다. / 이유: 14.3절의 환경 구분 표는 일회용 DB를 "표준 명령을 통해서만" 쓰게 한다. `drizzle-kit`이 접속하는 DB는 설정 파일과 환경 변수가 정하므로 에이전트가 직접 실행하면 대상이 일회용 DB인지 훅이 알 수 없다(14.3절 "대상 DB를 잘못 판단하는 사고"). `studio`는 데이터를 고치고 지울 수 있는 DB 클라이언트다("직접 접속"). `drop`은 마이그레이션 파일과 기록을 지운다("이력 변경"). / 버린 대안: `push`·`drop`만 막기(접속 대상을 가리지 못하는 `migrate`·`studio`가 남는다).
- 결정: step을 둘로 나눈다(결정 기록 / 차단 목록). / 이유: 앞은 문서와 `lab/`, 뒤는 프로파일 설정과 테스트라 검토할 것이 다르고, 한 PR이 400줄 안팎에 든다. 둘 다 보호 경로(`docs/harness/**`, `profiles/**`)를 바꾼다.
- 결정: 위험도 high. / 이유: R13의 차단 목록(보안 규칙)과 DB·마이그레이션 도구 결정을 다룬다.
- 방법 전환(계획 검증에서 F3·F5·F6이 세 라운드째 열림): 문서의 글자를 찾는 AC를 늘리는 방식을 그만두고, 판정을 실행할 수 있는 것으로 옮겼다. / 이유: 글자를 찾는 검사는 "그 글자가 있지만 뜻이 다른 문서"를 통과시키고, 줄을 더할 때마다 같은 종류의 틈이 다시 지적됐다. 확정 조건은 명령(`--confirm`)과 그 테스트로, 14.3절의 보존은 `diff`로, pnpm 버전은 리포의 고정값과의 직접 비교로 본다. / 버린 대안: `grep` 줄을 더 더하기, 지적에 반박하기(지적이 맞다).
- 결정: 프로파일 패턴이 도구 이름 뒤의 버전(`@…`)과 경로(`/…`)를 건너뛰게 했다. / 이유: 계획의 수용 기준 5는 "DB에 접속하는 `drizzle-kit` 명령을 막는다"이고, `npx drizzle-kit@latest`와 실행 파일을 직접 부르는 형태는 같은 명령의 다른 표기다. 하위 명령 자리만 본다는 계획의 범위는 그대로다(하위 명령 뒤의 인자는 보지 않는다). / 버린 대안: 그대로 두고 문서에만 적기(쉽게 닿는 표기라 막는 편이 맞다).
- 결정: 플래그의 값에 공백이 든 호출(`--config "a b.ts"`)은 막지 않고 한계로 적는다. / 이유: 훅은 따옴표를 푼 인자를 공백으로 이어 붙인 글을 본다. 값이 둘로 보여 "플래그 뒤의 값 하나"를 건너뛰는 패턴으로는 잡지 못한다. 값을 여러 개 건너뛰게 하면 "명령 어디든 이름이 있으면 막는다"에 가까워져 계획의 금지사항과 어긋난다. / 버린 대안: 패턴을 넓히기(허용해야 하는 호출이 막힌다), 코어 규칙을 고쳐 인자 자리로 보기(이 계획의 비범위. TD-61에 적었다).

## 발견 사항

- 코어 규칙이 이미 `drizzle-kit push`를 막는다(`scripts/hooks/rules.ts`의 `DB_PATTERNS`, `scripts/test/guard.test.ts`). Issue #166의 수용 기준("`drizzle-kit push`를 막고")은 지금도 참이라, 이 계획의 테스트는 프로파일이 더하는 명령을 본다(수용 기준 5). → 처리: 해당 없음(계획의 수용 기준에 반영했다)
- L1 훅은 명령 전체를 이어 붙인 글에서 패턴을 찾는다. 금지 명령의 이름이 인자나 커밋 메시지에 글자로 들어 있어도 막힌다(코어의 `drizzle-kit push`, DB 클라이언트 이름도 같다. 이 세션에서 DB 클라이언트가 설치됐는지 조회하는 명령이 막혔다). → 처리: 해당 없음(지금 동작이고 엄한 쪽이다. step1의 README에 적는다)
- 사전 확인을 설치 정책 밖(빈 임시 폴더)에서 돌려, 정책에 걸리는 버전(`@electric-sql/pglite` 0.5.17, 게시 하루째)으로 쟀다. 계획 검증 F3이 짚었다. → 처리: 해당 없음(이 계획에서 고쳤다. 실행 스크립트가 정책 파일을 복사하고 검사 스크립트가 적용된 정책을 본다)
- 코어 DB 패턴(`scripts/hooks/rules.ts`의 `DB_PATTERNS`)은 도구 이름 바로 뒤의 하위 명령만 본다. `drizzle-kit --config x push`처럼 플래그가 앞에 오는 호출을 놓친다(다른 도구의 패턴도 같은 꼴이다). → 처리: 해당 없음(step1에서 기술 부채 표에 새 행으로 남긴다. 번호는 push할 때 정한다. 웹 프로파일은 `drizzle-kit`에 대해 프로파일 패턴으로 막는다)
- 대화 세션에서는 AC의 `grep` 문구에 금지 명령의 글자가 그대로 들어 있으면 L1 훅이 그 AC 명령을 막는다. → 처리: 해당 없음(그 AC 줄은 계획 검증 F6으로 14.3절 전체 비교로 바뀌어 금지 명령의 글자가 들어가지 않는다)
- 코어 DB 패턴은 버전을 붙인 호출(`npx drizzle-kit@latest push`)과 다른 도구의 플래그가 앞에 오는 호출(`prisma --schema x db push`)도 놓친다. 실제 훅 판정으로 확인했다(2026-11-21). → 처리: TD-61(기술 부채 표의 새 행에 함께 적었다)
- 웹 프로파일의 패턴은 플래그의 값에 공백이 든 호출을 놓친다. → 처리: TD-61(README의 "훅이 보는 것과 보지 못하는 것"에도 적었다)

## 열린 질문

없음. Q13(개인 계정·조직)은 이 계획의 범위가 아니다(설계서 18절에 열린 채 남는다).

제작자에게 알릴 것(질문이 아니다): Q10의 확정에는 Windows 네이티브와 Linux에서 `lab/q10-db`의 절차를 돌린 결과가 필요하다. Windows는 그 PC의 세션이 돌릴 수 있고, Linux는 이 세션이 쓸 수 있는 머신이 없다.

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- 수용 기준 1·2: `node lab/q10-db/check-results.ts darwin-arm64`, `node --test lab/q10-db/test/check-results.test.ts`, 그리고 실행 스크립트를 실제로 돌려 리포 밖에 쓴 결과의 검사(step0 AC의 다섯째 줄).
- 수용 기준 3·4·6·7: 문서의 해당 줄을 `grep`으로 확인(각 step의 AC), `doc-lint`.
- 수용 기준 5: `node --test scripts/test/profile-web-db.test.ts`.
- 결과는 step을 진행하며 진행 로그에 적는다.
- step0(2026-11-20): AC 34줄 모두 통과, `node scripts/harness.ts check` 통과. 수용 기준 1·2는 검사 스크립트 테스트 57개, 실행 스크립트를 실제로 돌려 리포 밖에 쓴 결과의 검사(`--file`), 저장한 결과의 검사(`check-results.ts darwin-arm64`)로 확인했다. 수용 기준 3은 ADR의 절별 필수 내용과 `--confirm`의 종료 코드 1(없는 환경으로 `win32`·`linux`를 낸다)로, 수용 기준 4·7은 설계서·기술 부채 표의 해당 줄로, 수용 기준 8은 갈라진 지점의 14.3절에 고정한 한 줄을 넣은 기대 글과 지금의 14.3절 전체의 `diff`(차이 없음)로 확인했다.
- step0 재작업(2026-11-20, F7~F9): AC 34줄 모두 통과. 검사 스크립트 테스트는 75개다(개수가 아닌 값 15, 명령에 무한대·소수 1, 리포 밖 폴더 판정 2가 늘었다).
- step0 재작업(2026-11-20, F10): 문서(README의 절차)만 고쳤다. README의 Bash 절차를 그대로 돌린 결과: 실행·`fmt`·결과 검사·테스트 75개 통과. `doc-lint`, `fmt --check` 통과.
- step1(2026-11-21): AC 15줄 모두 통과, `node scripts/harness.ts check` 통과. 수용 기준 5는 `scripts/test/profile-web-db.test.ts`(7개: 바로 뒤의 하위 명령·버전을 붙인 형태·실행 파일을 직접 부르는 형태 13건과 플래그가 앞에 오는 형태 6건이 R13으로 막힌다, 파일만 다루는 명령과 상관없는 명령 13건은 막히지 않는다, 프로파일 패턴이 없으면 코어만 동작한다, 있던 항목이 그대로다)로 확인했다. 수용 기준 6은 README의 "DB" 절, 수용 기준 7은 TD-61, 수용 기준 8은 14.3절 전체의 `diff`(차이 없음)로 확인했다. `scripts/test/profile-web.test.ts`(10개), `scripts/test/guard.test.ts`(29개) 통과.

## 다음 할 일

1. step1의 구현을 올려 검증받는다(마지막 step이라 PR이 Issue #166을 닫는다). 두 검증자가 승인하면 초안을 풀어 제작자 승인을 요청한다(위험도 높음).
2. 이 계획이 끝난 뒤: Windows 네이티브와 Linux에서 `lab/q10-db`의 절차를 돌려 결과 파일을 더하고 Q10을 확정한다(별도 Issue. `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0이어야 한다).
