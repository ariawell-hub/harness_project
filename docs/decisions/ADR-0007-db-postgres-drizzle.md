---
status: active
related_code: [profiles/web/profile.json]
review_cycle: on-change
---

# ADR-0007: 파일럿 웹 프로젝트의 DB는 PostgreSQL + Drizzle, 일회용 DB는 내장 PostgreSQL(PGlite)

- 날짜: 2026-11-20(결정), 2026-11-23(채택)
- 상태: 채택 (2026-11-23. 기준은 제작자 대화 지시, 적용은 실측. macOS·Linux·Windows 네이티브에서 재어 아래 "확정 조건"이 채워졌다)
- 관련: 설계서 0절(실행 OS), 14.3절(R13), 18절 Q10, 19절, [웹 프로파일](../../profiles/web/README.md), [실물 확인](../../lab/q10-db/README.md), Issue #166, Issue #180, ADR-0005

## 맥락

- 설계서 18절의 Q10(사용할 DB와 ORM·마이그레이션 도구)은 3단계 파일럿 착수 전에 정할 것으로 남아 있었다(19절). 정해져야 14.3절의 DB 차단 목록을 웹 프로파일에서 채울 수 있다.
- 추천안은 PostgreSQL + Drizzle이었다(계획 `20261119-pilot-prep`의 "열린 질문"). 마이그레이션이 사람이 읽는 SQL 파일로 남아 리뷰와 정적 검사(14.3절)가 그대로 되고, 막을 명령이 적다.
- 판단 기준(제작자 대화 지시, 2026-11-20): 여러 PC와 다양한 개발 환경에서 영향이 없으면 PostgreSQL + Drizzle을 쓰고, 아니면 DB 없이 시작한다.
- 에이전트가 실행되는 머신은 macOS와 Windows 네이티브(WSL 아님)이고 둘을 함께 쓴다. CI 러너는 Linux다(설계서 0절, ADR-0005).
- 14.3절은 worktree마다 표준 명령이 만들고 지우는 로컬 DB(일회용 DB)를 요구한다.

## 결정

1. 파일럿 웹 프로젝트의 DB는 **PostgreSQL**, ORM·마이그레이션 도구는 **Drizzle**(`drizzle-orm`, `drizzle-kit`)이다. 마이그레이션은 `drizzle-kit generate`가 만든 SQL 파일로 쓰고 리뷰받는다(14.3절 "코드·마이그레이션에 들어가는 것").
2. 일회용 DB(14.3절)는 **내장 PostgreSQL(PGlite, `@electric-sql/pglite`)**이다. worktree 안의 폴더 하나가 DB 하나이고, 테스트는 메모리 DB를 쓴다. PC에 PostgreSQL 서버나 컨테이너 런타임을 요구하지 않는다.
3. 운영 DB는 서버형 PostgreSQL이다. 에이전트는 닿지 않는다(E4, 14.3절 그대로).
4. 웹 프로파일의 DB 차단 목록(14.3절)은 이 도구에 맞춰 채운다(계획 `20261120-q10-db-decision` step1).

기준의 적용: 서버형 PostgreSQL을 PC마다 두는 방식은 환경 영향이 있다. PC마다 설치(또는 컨테이너 런타임), 포트, 버전, 계정을 맞춰야 하고, CI에는 서비스 컨테이너가 필요해 워크플로를 고쳐야 한다. PGlite를 일회용 DB로 쓰면 PC별로 준비할 것이 패키지 설치뿐이다. 그래서 2번을 조건으로 1번을 고른다.

기준은 여러 실행 환경을 묻는다. 2026-11-20에는 macOS에서만 재어 결정했고, 2026-11-23에 Linux와 Windows 네이티브의 결과를 더해 세 환경 모두 통과한 것을 확인하고 채택했다(아래 "확정 조건").

## 실측

절차와 결과는 [lab/q10-db](../../lab/q10-db/README.md)에 있다. 잰 환경은 셋이다: 2026-11-20 macOS(Apple Silicon, Node 22.23.3), 2026-11-23 GitHub Actions의 `ubuntu-latest`(Linux x64)와 `windows-latest`(Windows 네이티브 x64, Node 22.20.0). pnpm은 모두 10.34.5다. 아래 결과는 세 환경에서 같았다.

- 이 리포의 설치 정책(R17, `pnpm-workspace.yaml`: 게시 후 14일, 설치 스크립트 차단)을 시험 프로젝트에 그대로 놓고 설치했다. 설치 전에, 쓰는 pnpm이 이 리포가 고정한 버전(`package.json`의 `packageManager`)이고 게시 후 최소 기간을 실제로 적용하는지(최소 기간을 100년으로 올린 폴더에서 설치가 거부되는지) 확인했다. 그 정책 아래의 버전은 `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11, `@electric-sql/pglite` 0.5.15다.
- PGlite는 런타임 의존성 0, 네이티브 바이너리 0, WASM 파일 2개이고 `os`·`cpu` 제한이 없다. 앱 프로세스 안에서 돈다(서버 프로세스와 포트가 없다).
- 설치된 패키지 가운데 설치 스크립트를 가진 것은 `esbuild`뿐이다(`drizzle-kit`이 쓴다). 설치 스크립트를 실행하지 않은 상태에서 아래가 모두 됐다.
- `drizzle-kit generate`가 SQL 마이그레이션 파일을 만들고, `drizzle-orm/pglite/migrator`가 적용했다.
- 폴더 둘이 격리됐고, 같은 폴더를 다시 열면 데이터가 남아 있었고, 메모리 DB가 됐고, 서로 다른 폴더를 동시에 열 수 있었다.

## 확정 조건

기준은 여러 실행 환경을 묻는다. 확정 조건은 `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0으로 끝나는 것이다. 이 명령은 `lab/q10-db/results/`에 macOS(`darwin-*`), Windows 네이티브(`win32-*`), Linux(`linux-*`)의 결과 파일이 모두 있고 모두 검사를 통과할 때만 0이다. 하나라도 없거나 통과하지 못하면 확정하지 않는다. 2026-11-20에는 macOS 결과뿐이라 1이었다.

2026-11-23에 조건이 채워졌다(종료 코드 0). 그래서 이 ADR의 상태를 채택으로 바꾸고 설계서 18절의 Q10 행과 19절 "현재 위치"를 확정으로 고쳤다(계획 `20261121-q10-confirm`, Issue #180). 세 환경의 결과 파일과 잰 곳은 다음과 같다.

- macOS: `darwin-arm64.json`. Mac(Apple Silicon)에서 쟀다(2026-11-20).
- Linux: `linux-x64.json`. CI 러너 `ubuntu-latest`에서 쟀다. 실행 https://github.com/ariawell-hub/harness_project/actions/runs/45180055726 (`main`의 `67bd225`, 워크플로 `q10-trial`을 손으로 돌렸다).
- Windows 네이티브: `win32-x64.json`. CI 러너 `windows-latest`에서 쟀다. 같은 실행(45180055726)이다.

Linux와 Windows 네이티브의 결과 파일은 그 실행의 산출물을 손대지 않고 넣은 것이다. `node lab/q10-db/verify-artifacts.ts`가 출처를 확인했다: 그 실행이 `main`에서 손으로 돌린 `q10-trial` 실행이고 두 OS의 job이 성공했으며, 각 OS의 산출물에 든 파일이 커밋한 결과 파일과 값으로 같다. 패키지 버전, pnpm 고정 버전, 설치 정책을 바꾸면 같은 워크플로로 다시 잰다.

## 알려진 한계

- PGlite는 한 프로세스가 연결 하나로 쓴다. 같은 폴더를 두 프로세스가 함께 열 수 없으므로 `dev`와 테스트는 서로 다른 DB를 쓴다.
- 개발·테스트(PGlite)와 운영(서버형 PostgreSQL)은 드라이버가 다르다. 연결 풀, 동시성, 확장 기능의 차이는 로컬에서 드러나지 않는다.
- `drizzle-kit`은 되돌리는 마이그레이션을 만들지 않는다. 14.3절이 요구하는 "적용 → 롤백 → 재적용" 증거의 롤백 SQL은 손으로 쓴다.
- `drizzle-kit`은 `esbuild`에 기댄다. 설치 스크립트 허용 목록(R17)에 더하지 않는다. 설치 스크립트 없이 돌지 않는 버전이 나오면 그 버전으로 올리지 않는다.
- 설치 정책(게시 후 14일) 때문에 최신 버전을 바로 쓰지 못한다. 잰 날 PGlite의 최신 버전(0.5.17, 게시 하루째)은 정책에 걸려 설치가 거부됐다.
- 일회용 DB를 표준 명령(`setup`·`test`·`dev`·`verify`)에 잇는 일은 아직 없다. 파일럿 대상 리포의 DB를 쓰는 첫 작업에서 한다(TD-12).
- Linux와 Windows 네이티브는 CI 러너에서 쟀다. Windows 네이티브의 확정 근거는 CI의 Windows 러너에서 받은 산출물이다. 출처는 `lab/q10-db/verify-artifacts.ts`로 확인했다. 러너는 제작자의 PC와 경로, 사용자 이름, 보안 프로그램이 다르고, 그 차이는 이 실측에 들지 않는다. 제작자의 Windows PC에서는 2026-11-23에 절차가 통과했으나 결과 파일을 남기지 않아 확정 근거로 쓰지 않는다. 그 실행의 기록은 계획 `20261121-q10-confirm`의 "검증 방법과 결과"에 있다.

## 되돌리는 조건

다른 실행 환경(Windows 네이티브, Linux)에서 `lab/q10-db`의 검사가 통과하지 않고 고칠 수 없으면, 기준대로 "DB 없이 시작"으로 바꾸고 이 ADR을 대체하는 ADR을 쓴다. 그때까지 만든 차단 목록은 남긴다(쓰지 않는 도구를 막아도 해가 없다).

## 버린 대안

- **서버형 PostgreSQL을 PC마다 설치(또는 컨테이너)**: PC마다 설치·포트·버전·계정을 맞춰야 하고 CI 워크플로를 고쳐야 한다. 기준에 어긋난다. 실측한 Mac에는 컨테이너 런타임이 없다.
- **SQLite**: 설치가 필요 없지만 운영 DB(PostgreSQL)와 방언이 달라, 개발에서 본 동작과 마이그레이션 SQL이 운영과 어긋난다.
- **PostgreSQL + Prisma**: 막을 명령이 많고(`db push`, `migrate reset`, `--accept-data-loss`), 클라이언트 생성이 설치 스크립트에 기대는지 버전별로 확인해야 한다(확인하지 않았다).
- **DB 없이 시작**: 기준이 충족되지 않을 때의 선택이다. R13과 마이그레이션의 위험도 높음 흐름을 파일럿에서 겪어 보지 못한다.

## 결과

- 설계서 18절의 Q10이 확정 결정으로 바뀐다(2026-11-23). 19절의 착수 전에 정할 것에서 Q10이 빠지고 Q13(개인 계정·조직)이 남는다. Q13은 열려 있다.
- 웹 프로파일(`profiles/web/profile.json`)의 `guard.dbPatterns`에 DB에 접속하는 `drizzle-kit` 명령과 마이그레이션 파일을 지우는 명령이 들어간다(step1).
- `riskPaths`의 `drizzle/**`(위험도 높음)는 그대로 쓴다.
