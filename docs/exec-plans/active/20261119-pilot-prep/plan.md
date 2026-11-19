---
id: 20261119-pilot-prep
issue: 140 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T18:28:11+09:00 # new-task가 채운다
---

# 3단계 파일럿 착수 준비: web 프로파일 testEffect(TD-42)와 web-verify(TD-12)

## 목표와 수용 기준

로드맵 3단계(파일럿, 설계서 19절)는 웹 프로젝트 하나에서 실제 작업 5~10건을 돌린다. 그 전에 웹 프로파일에 비어 있는 두 가지를 채운다.

- **TD-42**: `profiles/web/profile.json`에 `testEffect` 설정이 없어, 웹 프로파일을 적용한 리포에서는 테스트 실효성 검사(R5, `test-effect`)가 "해당 없음"으로 건너뛴다.
- **TD-12**: `verify` 표준 명령의 웹 프로파일 구현과 `web-verify` 스킬이 없다(`commands.verify`가 `null`). 설계서 11.1절은 버그 수정 PR의 검증 증거를 파일럿부터 요구한다.

이 템플릿 리포는 core 프로파일이라 Vitest도 Playwright도 없다. 그래서 확인은 두 겹으로 한다: 이 리포의 테스트(가짜 dev 서버·가짜 시나리오 실행기)로 하네스 쪽 동작을 확인하고, 임시 폴더에 만든 실제 웹 프로젝트에서 한 번 돌려 본 결과를 `lab/pilot-prep/results/`에 남긴다.

수용 기준:

1. `profiles/web/profile.json`의 `config.testEffect`가 채워져 있다. `init --profile web`을 적용한 설정이 `loadConfig` 검증을 통과하고 `testEffect`가 `null`이 아니다(테스트).
2. 웹 프로파일 설정을 적용한 실제 Vitest 프로젝트에서 `node scripts/harness.ts test-effect`가 "해당 없음"이 아니라 판정을 낸다: 변경 전 코드에서도 통과하는 테스트 파일은 실패(`ineffective`), 변경 전 코드에서 단언이 실패하는 테스트 파일은 `단언 실패`, 새 모듈의 테스트 파일은 `단언 실패 아님`. 결과가 `lab/pilot-prep/results/test-effect-vitest.json`에 있다.
3. `profiles/web/profile.json`의 `commands.verify`가 `null`이 아니다. 웹 프로파일 설정에서 `node scripts/harness.ts verify`는 `dev`를 띄우고, 시나리오를 실행하고, 판정하고, `dev`를 정리한다. 성공·실패·시간 초과·신호(SIGTERM, SIGINT) 어느 경우에도 `dev` 프로세스가 남지 않는다(테스트).
4. `verify`의 종료 코드는 아래를 모두 만족할 때만 0이다(테스트).
   - 시나리오가 1개 이상이고 모두 성공했다. 건너뛴 시나리오는 실패로 센다.
   - 모든 시나리오에 하네스 fixture의 관찰 기록이 있다(fixture를 쓰지 않은 시나리오는 실패).
   - 콘솔 에러 0건, 실패한 네트워크 요청 0건. 시나리오 코드에서 "의도한 실패"로 선언한 것은 빼고 요약에 건수를 적는다.
   - 시나리오 실행기의 종료 코드가 0이고 결과 파일을 읽을 수 있다. 읽지 못하거나 형식이 틀리면 실패다.
5. 시나리오가 받는 앱 주소는 `verify`가 정한 루프백 주소(`http://127.0.0.1:<포트>`)다. 루프백이 아닌 주소로 가는 요청은 보내지 않고 막으며, 막힌 요청은 실패한 네트워크 요청으로 세어 `verify`가 실패한다(실물 확인).
6. 브라우저는 시나리오마다 새 컨텍스트와 임시 프로필로 뜬다. 하네스가 주는 Playwright 설정과 fixture에는 기존 브라우저·프로필에 붙는 경로(`connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`)가 없다(테스트가 파일 내용으로 확인).
7. PR에 올릴 증거 묶음(`evidence/`)에는 요약(`summary.md`, `summary.json`), 스크린샷(`.png`), 영상(`.webm`)만 들어간다. Playwright trace와 HAR은 묶음에 넣지 않는다. 요약에는 요청 URL의 출처와 경로만 적고, 쿼리 문자열·요청·응답 헤더·쿠키·본문은 적지 않는다(테스트).
8. 실제 Playwright로 돌린 결과가 `lab/pilot-prep/results/verify-playwright.json`에 있다: 통과하는 시나리오(종료 코드 0), 콘솔 에러·실패한 요청·외부 주소 요청·fixture를 쓰지 않은 시나리오(각각 종료 코드 1), 증거 묶음의 파일 목록.
9. `.claude/skills/web-verify/SKILL.md`와 절차서 4절이 같은 명령(`node scripts/harness.ts verify`)과 같은 절차 문서(`profiles/web/README.md`)를 가리킨다(테스트).
10. 기술 부채 표의 TD-42가 해결로, TD-12가 웹 쪽 완료와 남은 일로 갱신돼 있다. 설계서 11.1절이 구현(위치, 증거 묶음, 주소 제한의 보장 수준)과 맞다.
11. 각 step의 PR에서 `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

범위:

- `profiles/web/profile.json`의 `testEffect`, `commands.verify`, 템플릿 목록. `profiles/web/README.md`.
- `verify`의 웹 구현: `scripts/verify/`(새 폴더)와 `profiles/web/verify/`(Playwright 설정·fixture). 테스트는 새 파일로 더한다.
- `web-verify` 스킬(Claude Code)과 절차서 4절의 안내 한 항목(Codex는 `AGENTS.md` → 절차서로 같은 명령에 닿는다).
- 실물 확인 기록 `lab/pilot-prep/`.
- 문서: 설계서 11.1절과 변경 이력, 코드 구조 문서, `CHANGELOG`, 기술 부채 표의 TD-12·TD-42 행.
- 열린 질문 Q10·Q13을 추천안과 함께 올린다(아래 "열린 질문").

비범위:

- "버그 수정 PR의 검증 증거 필수 상태 체크"(11.1절 마지막 항목)와 증거를 PR에 붙이는 수단. 이유: 워크플로 변경이다. TD-53(Issue #139) 병합 뒤 별도 Issue로 한다(제작자 지시).
- 설계서 14.3절·18절. 이유: Q10·Q13 결정 전에는 고치지 않는다(제작자 지시). 14.3절의 DB 차단 목록 보강과 `verify`의 일회용 DB·합성 시드 연결은 Q10 결정 뒤의 일이다.
- `game-verify`. 게임 프로파일 착수 때 한다.
- 파일럿 대상 리포 만들기, 그 리포의 의존성(`vitest`, `@playwright/test`) 추가. 이 템플릿의 `package.json`·lockfile은 바꾸지 않는다.
- E2E 시나리오(`e2e/`)의 테스트 실효성 검사. 이유: 실행 중인 앱이 필요해 `test-effect`가 변경 전 코드에서 돌릴 수 없다.
- 새 설정 키. `scripts/lib/config.ts`와 `harness.config.json`은 바꾸지 않는다.
- 시나리오 코드가 관찰 기록을 지어내는 것을 막는 일. 이유: 시나리오와 그 첨부는 PR 작성자의 코드라서, fixture를 쓰지 않고 `harness-verify` 첨부를 직접 붙이면 로컬 `verify`는 속는다. `verify`는 에이전트가 로컬에서 쓰는 도구이지 강제 장치가 아니다(11.1절). 강제는 필수 상태 체크(별도 Issue)가 CI에서 다시 실행하고 검증자가 `e2e/` 변경을 보는 것으로 한다. 이 계획은 실수로 fixture를 빠뜨린 시나리오만 잡는다.
- 다른 세션(Issue #139)과 겹치는 곳: 설계서 0.1절 E1·0.2절·10.2~10.4절, `docs/SECURITY.md`, 절차서 5절, `.github/workflows/`, `scripts/test/ci.test.ts`, `scripts/ci/repro.ts`, `scripts/harness.ts`.

## 관련 파일·문서

- `profiles/web/profile.json`, `profiles/web/README.md`
- `profiles/web/verify/`(새 폴더: `playwright.config.ts`, `fixture.ts`), `profiles/web/templates/`(시나리오 예시)
- `scripts/verify/`(새 폴더)
- `scripts/test/profile-web.test.ts`, `scripts/test/verify-web.test.ts`, `scripts/test/verify-evidence.test.ts`, `scripts/test/verify-skill.test.ts`(모두 새 파일)
- `.gitignore`(`.harness-verify/`)
- `.claude/skills/web-verify/SKILL.md`
- `docs/harness/workflow.md`(4절만), `docs/harness/design.md`(11.1절, 0절 변경 이력), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`(TD-12, TD-42 행만)
- `docs/index.md`(`lab/pilot-prep/README.md` 링크)
- `lab/pilot-prep/`
- `docs/exec-plans/active/20261119-pilot-prep/`

## step 목록

- step0 web-test-effect: 웹 프로파일의 `testEffect` 설정과 실제 Vitest 확인(TD-42).
- step1 verify-run: `verify` 웹 구현의 실행·판정(`dev` 수명, 시나리오 실행기, 통과 기준, 종료 코드).
- step2 verify-playwright: Playwright 설정·fixture(주소 제한, 관찰 기록), 증거 묶음, 실제 Playwright 확인.
- step3 web-verify-skill: 스킬 래퍼, 절차서·설계서·기술 부채 표 반영(TD-12).

## 진행 로그

- 2026-11-19: 제작자 대화 지시로 Issue #140을 등록하고 `new-task`로 worktree와 계획 골격을 만들었다. 계획을 작성했다. 다음은 계획만 담은 커밋으로 초안 PR을 열어 계획 검증(G1)을 받는 것이다.

## 의사결정 로그

- 결정: 계획의 위험도는 high다. / 이유: `verify`는 보안 성격의 동작을 구현한다(제작자 로그인 세션과 브라우저 분리(E5), 열 수 있는 주소 제한, 증거에서 자격증명 제거). 10.1절 "보안·권한·인증 변경"에 걸치고, 애매하면 high다(절차서 1절). 구현 PR은 모두 보호 경로(`profiles/**`, `scripts/**`)를 바꿔 운영 단계에서는 어차피 제작자 승인 대상이라 승인 횟수는 늘지 않는다. / 버린 대안: normal(TD-42만 보면 설정값이지만 한 계획에 `verify`가 같이 있다).
- 결정: Playwright와 Vitest는 대상 리포(웹 프로파일을 적용한 제품 리포)의 의존성이다. 하네스 코드(`scripts/`)는 둘을 import하지 않고 명령으로만 실행한다. 이 템플릿의 `package.json`에는 더하지 않는다. / 이유: 코어 코드는 프로파일을 몰라도 된다(S5). core 프로파일 리포가 브라우저 내려받기와 웹 전용 의존성을 지지 않는다. 템플릿에 새 직접 의존성이 없으니 ADR도 필요 없다. / 버린 대안: 템플릿의 devDependency로 `@playwright/test`를 더한다(이 리포의 테스트에서 실제 브라우저를 돌릴 수 있지만 CI 시간과 설치 정책 부담이 크다).
- 결정: Playwright를 import하는 파일(설정, fixture)은 `profiles/web/verify/`에 둔다. / 이유: `tsconfig.json`의 `include`가 `scripts/**/*.ts`라 `scripts/` 아래에 두면 이 리포의 `lint`(tsc)가 `@playwright/test`를 찾지 못해 실패한다. `profiles/**`는 보호 경로라 제품 리포에서 에이전트가 주소 제한을 풀려면 제작자 승인이 필요하다. / 버린 대안: 템플릿으로 제품 리포의 `e2e/`에 복사한다(보호 경로 밖이라 fixture를 고쳐 제한을 풀 수 있다).
- 결정: `verify`의 진입점은 `node scripts/verify/web.ts`이고 웹 프로파일의 `commands.verify.run`에 적는다. `scripts/harness.ts`는 고치지 않는다. / 이유: 표준 명령 실행기(`runStandard`)가 `commands.verify`를 그대로 실행한다. 다른 세션이 `scripts/harness.ts`를 고치는 중이다. / 버린 대안: `harness.ts`에 `verify-web` 하위 명령을 더한다.
- 결정: 설정 키를 더하지 않는다. 시나리오 실행기 명령과 제한 시간은 `scripts/verify/web.ts`의 상수이고, 테스트는 함수 인자로 가짜 실행기를 넣는다. / 이유: 실행기를 설정으로 바꿀 수 있으면 검사를 약화시키는 길이 하나 더 생기고 `harness-guard`의 신호 목록도 고쳐야 한다. 필요가 생기면 그때 더한다(B4). / 버린 대안: `verify.web.runner` 설정 키.
- 결정: 판정은 Playwright JSON 리포터의 결과 파일(시나리오 목록과 상태)과 fixture가 시나리오마다 붙이는 관찰 기록(`harness-verify` 첨부)으로 한다. 관찰 기록이 없는 시나리오는 실패다. / 이유: 콘솔 에러와 실패한 요청은 페이지에 리스너를 달아야 셀 수 있어 fixture가 필요하고, 스킬은 강제 장치가 아니므로(11.1절) fixture를 쓰지 않은 시나리오를 판정에서 걸러야 한다. / 버린 대안: fixture가 따로 파일에 적는다(fixture를 쓰지 않은 시나리오가 보이지 않는다).
- 결정: 증거 묶음에 Playwright trace와 HAR을 넣지 않는다. trace는 실패 원인을 보는 로컬 진단용으로만 `local/`에 남긴다. / 이유: 11.1절은 올리기 전에 요청 헤더·쿠키·토큰을 지우라고 하고, trace는 이것들을 자동으로 담는다. zip 안의 네트워크 기록을 고쳐 쓰는 것보다 올리지 않는 쪽이 빠뜨릴 길이 없다. / 버린 대안: trace zip을 풀어 헤더·쿠키를 지우고 다시 묶는다(Playwright 내부 형식에 묶이고 놓치는 필드가 생길 수 있다).
- 결정: 주소 제한은 fixture의 컨텍스트 라우팅(루프백이 아닌 요청 중단)으로 하고, 실물 확인에서 되는 것이 확인되면 브라우저 수준 차단(프록시 또는 호스트 해석 규칙)을 한 겹 더한다. 보장 수준은 11.1절대로 절차 수준이다(L0 네트워크 허용 목록은 4단계). / 이유: 라우팅만으로는 서비스 워커·웹소켓 같은 경로가 Playwright 버전에 따라 빠질 수 있다. 되는지 모르는 것을 계획에 확정으로 적지 않는다. / 버린 대안: 브라우저 수준 차단만 쓴다(막힌 요청을 시나리오별로 기록하기 어렵다).
- 결정: 증거를 PR에 붙이는 수단은 이 계획에서 정하지 않는다. `verify`는 묶음을 worktree의 `.harness-verify/<실행 시각>/evidence/`에 만들고 `summary.md`를 PR 본문에 옮길 수 있는 글로 낸다. / 이유: 봇은 PR 댓글에 파일을 올릴 API가 없고, 스크린샷을 커밋하면 바이너리 파일이라 `risk-gate`가 위험도 높음으로 올린다. Actions 산출물로 올리려면 워크플로를 바꿔야 한다. 필수 상태 체크와 같이 정할 일이다(별도 Issue). / 버린 대안: 계획 폴더에 스크린샷을 커밋한다.
- 결정: Codex 쪽 래퍼는 따로 만들지 않고 절차서 4절의 안내 항목으로 한다. / 이유: Codex는 `AGENTS.md`와 절차서를 읽는다(13.1절). `new-task` 스킬도 Claude Code 쪽에만 있고 Codex는 절차서로 같은 명령에 닿는다. 로직은 `scripts/`에 하나뿐이다. / 버린 대안: Codex 스킬 폴더를 새로 만든다(Codex의 프로젝트 스킬 로딩을 이 리포에서 확인한 적이 없다, TD-8).
- 결정: step0의 구현은 계획 검증 뒤 로컬에서 끝내 두고, push와 승인 요청은 TD-53 PR(Issue #139)이 병합된 뒤에 한다. `CHANGELOG`·기술 부채 표·설계서의 변경은 그 병합을 `origin/main`에서 받아 온 뒤에 더하고 버전은 v0.7.59부터 쓴다. / 이유: 다른 세션과의 합의(세 파일을 고치는 PR은 한 번에 하나, 제작자 승인 대기 중인 PR이 있으면 `pr-ready`를 하지 않는다). push 한 번이 판정 한 라운드라 준비가 끝난 뒤 한 번에 올린다(절차서 5절). / 버린 대안: 구현을 먼저 올리고 `CHANGELOG`를 나중 커밋으로 더한다(라운드가 늘고 `harness-guard`가 그 사이 실패한다).
- 결정: Q10·Q13은 "열린 질문"에 올리되 step0~3은 답을 기다리지 않는다. / 이유: 네 step 어느 것도 DB·ORM이나 리포 소유 계정에 기대지 않는다. 답이 필요한 일(14.3절·18절, DB 차단 목록, 일회용 DB)은 비범위다.

## 발견 사항

- `verify`가 만든 증거를 봇이 PR에 붙일 길이 지금은 없다(댓글 파일 첨부 API 없음, 커밋하면 바이너리라 위험도 높음). → 처리: TD-12(행을 갱신할 때 남은 일로 적는다. 필수 상태 체크의 별도 Issue에서 정한다)
- E2E 시나리오는 `test-effect` 대상이 아니다(실행 중인 앱이 필요하다). 11.1절 절차 7("재현 시나리오는 E2E 테스트로 남긴다")의 실효성은 `verify`의 전후 비교로만 본다. → 처리: TD-12(남은 일로 적는다)

## 열린 질문

두 질문 모두 절차서 7절의 "제품·UX 방향"과 "비용"에 해당한다. step0~3은 답을 기다리지 않는다. 답을 받기 전에는 설계서 14.3절·18절을 고치지 않는다.

### 질문: Q10 — 파일럿 웹 프로젝트의 DB와 ORM·마이그레이션 도구

- A) PostgreSQL + Drizzle ORM(`drizzle-kit generate`로 SQL 마이그레이션 파일 생성, `migrate`로 적용) — 영향: 마이그레이션이 사람이 읽는 SQL 파일이라 리뷰와 L3 정적 검사(파괴적 구문 탐지, 14.3절)가 그대로 된다. 막을 명령이 `drizzle-kit push` 하나로 좁다(이미 14.3절 예시에 있다). 프로파일의 `guard.dbPatterns`에 이 명령을, `riskPaths`의 `drizzle/**`는 그대로 쓴다. worktree별 일회용 DB는 로컬 PostgreSQL에 worktree마다 데이터베이스를 만들거나 테스트용 내장 구현을 쓴다(방식은 후속 계획에서 정한다).
- B) PostgreSQL + Prisma(`prisma migrate`) — 영향: 스키마 파일 하나로 모델이 보여 읽기 쉽다. 대신 막을 명령이 많다(`db push`, `migrate reset`, `--accept-data-loss`, 개발용 `migrate dev`의 초기화 제안). 클라이언트 생성·엔진 준비가 설치 스크립트에 기대는 버전이면 설치 스크립트 기본 차단(R17, `onlyBuiltDependencies`)에 허용 항목과 ADR이 필요하다(버전별로 확인해야 한다. 확인하지 않았다).
- C) 파일럿은 DB 없이(또는 파일 하나짜리 SQLite로) 시작하고 Q10은 DB가 필요한 첫 작업 때 정한다 — 영향: 파일럿 착수가 가장 빠르다. R13(DB 위험 작업 금지)과 마이그레이션의 위험도 높음 흐름을 파일럿에서 겪어 보지 못해 17.2절 지표에 그 부분이 빠진다.
- 추천: A. 이유: 하네스의 DB 규칙(14.3절)은 "마이그레이션은 파일로 쓰고 리뷰받는다, diff 자동 적용은 막는다"인데 SQL 파일을 직접 남기는 도구가 이 규칙과 가장 잘 맞고, 설치 스크립트 예외도 필요 없다. 파일럿 대상이 DB를 쓰지 않는 프로젝트라면 C다. 대상 프로젝트는 제작자가 정한다.

### 질문: Q13 — 파일럿 리포를 개인 계정에 둘지 조직에 둘지

- A) 지금처럼 개인 계정(`ariawell-hub`, GitHub Pro)에 둔다 — 영향: 추가 비용이 없다. Q20에서 시험한 구성(`pull_request_target`의 environment, 체크 출처 고정, patch-id 결속)이 개인 계정 리포 기준이라 그대로 쓴다. 외부 테스터는 협업자로 초대하지 않고 별도 폼·리포로 피드백을 받는다(14.6절). merge queue는 쓸 수 없다(이미 대안으로 운영 중). Actions 포함 사용량은 이 리포와 파일럿 리포가 같은 계정 것을 나눠 쓴다(TD-49).
- B) 조직(Team)을 만들어 옮긴다 — 영향: 멤버마다 요금이 붙는다(제작자·봇 계정 둘부터). 외부 테스터에게 읽기·분류 권한만 줄 수 있고 Secret Protection(Q18)을 검토할 수 있다. 대신 리포 이전 뒤 0.2절 리포 설정, environment, 검증 App 설치, 필수 체크 출처를 다시 확인해야 하고 Q20 가운데 계정 종류에 기대는 항목을 다시 시험해야 한다.
- 추천: A. 이유: 지금은 제작자 1인이고 외부 테스터가 없어 조직의 이점(세분된 권한)을 쓸 곳이 없다. 검증된 구성을 바꾸는 비용이 파일럿 착수를 늦춘다. 외부 테스터에게 리포 접근을 줘야 하거나 실서비스 운영 키를 다루게 되면(Q18) 그때 다시 정한다.

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- 실물 확인(임시 폴더의 실제 웹 프로젝트): step0은 Vitest로 `test-effect`, step2는 Playwright로 `verify`. 절차는 `lab/pilot-prep/README.md`, 결과는 `lab/pilot-prep/results/`에 남긴다. 이 리포의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).
- 결과는 step을 진행하며 진행 로그에 적는다.

## 다음 할 일

1. 계획만 담은 커밋을 push하고 초안 PR을 연다(`Refs #140`). 계획 검증(G1) 승인을 받는다.
2. 승인 뒤 step0을 로컬에서 TDD로 구현한다. push하지 않는다.
3. TD-53 PR(Issue #139)이 병합되면 `origin/main`을 병합하고 `CHANGELOG`(v0.7.59)·TD-42 행을 더한 뒤 `check` → `complete-step` → push → `pr-ready`로 한 번만 승인을 요청한다. 그 전에 다른 세션의 PR이 제작자 승인 대기 중이면 기다린다.
4. 병합 뒤 `new-task --plan 20261119-pilot-prep --step 1`.
5. Q10·Q13의 답을 받으면 의사결정 로그에 적는다. 14.3절·18절 반영은 별도 Issue다.
