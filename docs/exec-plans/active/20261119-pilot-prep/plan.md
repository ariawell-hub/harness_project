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

이 템플릿 리포는 core 프로파일이라 Vitest도 Playwright도 없다. 그래서 확인은 두 겹으로 한다: 이 리포의 테스트(가짜 dev 서버·가짜 시나리오 실행기)로 하네스 쪽 동작을 확인하고, 임시 폴더에 만든 실제 웹 프로젝트에서 돌려 본 결과를 `lab/pilot-prep/results/`에 남긴다. 결과 파일은 `lab/pilot-prep/check-results.ts`가 사례별로 검사한다(사례 id, 종료 코드, 판정, 관찰 값).

수용 기준:

1. `profiles/web/profile.json`의 `config.testEffect`가 채워져 있다. `init --profile web`을 적용한 설정이 `loadConfig` 검증을 통과하고 `testEffect`가 `null`이 아니다(테스트).
2. 웹 프로파일 설정을 적용한 실제 Vitest 프로젝트에서 `node scripts/harness.ts test-effect`가 "해당 없음"이 아니라 판정을 낸다(실물 확인, `lab/pilot-prep/results/test-effect-vitest.json`).
   - 변경 전 코드에서도 통과하는 테스트 파일은 `ineffective`이고 종료 코드 1, 변경 전 코드에서 단언이 실패하는 테스트 파일은 `단언 실패`, 새 모듈의 테스트 파일은 `단언 실패 아님`.
   - 테스트 파일 하나의 판정에 다른 테스트 파일의 결과가 섞이지 않는다: 경로가 서로 부분 문자열인 세 파일(`a.test.ts`, `a.test.tsx`, 더 깊은 폴더의 같은 이름)의 변경 전 결과를 다르게 만들었을 때 파일마다 자기 결과대로 판정된다.
3. 표준 명령에 넘긴 추가 인자(`node scripts/harness.ts <명령> -- <인자>`)는 셸이 해석하지 않고 글자 그대로 구현에 전달된다. `$(…)`, 역따옴표, `;`, 따옴표, 공백, `*`이 든 인자로 확인한다(테스트).
4. 웹 프로파일 설정에서 `node scripts/harness.ts verify`는 `dev`와 거부 프록시를 띄우고, 시나리오를 실행하고, 판정하고, 띄운 것을 정리한다. 성공·실패·시간 초과·신호(SIGTERM, SIGINT) 어느 경우에도 `dev`의 프로세스 트리와 시나리오 실행기의 프로세스 트리가 남지 않는다(테스트. 브라우저 프로세스는 실물 확인).
5. `verify`의 종료 코드는 아래를 모두 만족할 때만 0이다(테스트).
   - 시나리오가 1개 이상이고 모두 성공했다. 건너뛴 시나리오는 실패로 센다.
   - 모든 시나리오에 하네스 fixture의 관찰 기록이 있다(fixture를 쓰지 않은 시나리오는 실패).
   - 콘솔 에러 0건, 실패한 네트워크 요청 0건. 시나리오 코드에서 "의도한 실패"로 선언한 것은 빼고 건수를 센다. 두 분류는 따로 세고 따로 선언한다(브라우저는 404 응답에 콘솔 에러도 낸다).
   - 거부 프록시에 닿은 요청이 0건이다.
   - 시나리오 실행기의 종료 코드가 0이고 결과 파일을 읽을 수 있다. 읽지 못하거나 형식이 틀리면 실패다.
   - 시나리오 파일을 지정한 실행(`verify -- e2e/<파일>.spec.ts`)에서는 결과 파일의 시나리오가 정확히 그 파일들의 것이다. 지정하지 않은 파일의 시나리오가 있거나 지정한 파일의 시나리오가 없으면 실패다(테스트). 실제 Playwright에서 경로가 정규식·부분 문자열로 겹치는 다른 파일은 돌지 않는다(실물 확인).
6. 브라우저가 닿을 수 있는 곳은 `verify`가 그 실행에서 정한 앱 주소 하나다: `http://127.0.0.1:<포트>`와, 같은 호스트·포트의 `ws://`(같은 서버로 가는 평문 웹소켓. 개발 서버의 HMR이 쓴다). 그 밖의 요청은 대상에 도달하지 않고 거부 프록시에 기록되며 `verify`가 실패한다. 시나리오 코드의 "의도한 실패" 선언으로는 이 실패를 뺄 수 없고, fixture를 쓰지 않은 시나리오도 같은 제한을 받는다.
   - 그 밖의 요청: 다른 로컬 포트(`127.0.0.1`, `localhost`, `*.localhost`, `[::1]`), 앱 포트를 다른 이름(`localhost`)이나 다른 스킴(`https`, `wss`)으로 부르는 요청, 로컬이 아닌 이름(http·https), 앱이 보낸 리다이렉트의 대상(스킴만 바뀐 것 포함), 다른 서버로 가는 웹소켓.
   - 실물 확인: 사례마다 도달을 셀 수 있는 통제된 대상을 두고 도달 0건, 프록시 기록 1건 이상, 종료 코드 1을 확인한다. 실제 외부 주소로는 요청하지 않는다(해석되지 않는 이름 `external.invalid`가 프록시에 기록되는 것으로 확인한다).
   - 서비스 워커는 등록·실행되지 않는다(브라우저가 워커 스크립트를 받아 오지 않는다). 그래서 워커가 내는 요청이 없다. 등록을 시도한 것만으로는 실패가 아니다(실물 확인: 워커 스크립트 요청 0건, 다른 서버 도달 0건, 프록시 기록 0건, 종료 코드 0).
7. 브라우저는 시나리오마다 새 컨텍스트와 임시 프로필로 뜬다. 하네스가 주는 Playwright 설정과 fixture에는 기존 브라우저·프로필에 붙는 경로(`connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`)가 없다(테스트가 파일 내용으로 확인).
8. PR에 올릴 증거 묶음(`evidence/`)에는 `summary.md`와 `summary.json` 둘만 들어간다. 요약에는 실행 시각, 판정, 시나리오의 파일 경로와 줄 번호, 상태, 분류별 건수만 있다. 앱이나 시나리오가 실행 중에 만든 문자열(콘솔 문구, URL의 호스트·경로·쿼리, 시나리오 제목, 화면 글자)은 들어가지 않는다. 스크린샷·영상·trace·`dev` 출력은 `local/`에만 남는다. 합성 표식을 콘솔·URL·제목·화면·프록시 요청에 넣었을 때 `evidence/`의 어느 파일에도 그 표식이 없다(테스트와 실물 확인).
9. 실제 Playwright로 돌린 결과가 `lab/pilot-prep/results/verify-playwright.json`에 있고 step3에 적은 사례가 모두 기대대로다(`check-results.ts`).
10. `.claude/skills/web-verify/SKILL.md`와 절차서 4절이 같은 명령(`node scripts/harness.ts verify`)과 같은 절차 문서(`profiles/web/README.md`)를 가리킨다(테스트).
11. 기술 부채 표의 TD-42가 해결로, TD-12가 웹 쪽 완료와 남은 일로 갱신돼 있다. 설계서 11.1절이 구현(위치, 주소 제한 방식과 보장 수준, 증거 묶음)과 맞다.
12. 각 step의 PR에서 `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

범위:

- `profiles/web/profile.json`의 `testEffect`, `commands.verify`, 템플릿 목록. `profiles/web/README.md`.
- 테스트 파일 하나만 실행하는 Vitest 래퍼 `profiles/web/test-effect/run-one.mjs`.
- 표준 명령 실행기(`scripts/commands/standard.ts`)의 추가 인자 인용. 이유: `verify`에 시나리오 경로를 넘기는 길이 이 실행기를 지나고, 지금은 큰따옴표로 붙여 셸이 `$(…)`를 실행한다.
- `verify`의 웹 구현: `scripts/verify/`(새 폴더)와 `profiles/web/verify/`(Playwright 설정·fixture). 테스트는 새 파일로 더한다.
- `web-verify` 스킬(Claude Code)과 절차서 4절의 안내 한 항목(Codex는 `AGENTS.md` → 절차서로 같은 명령에 닿는다).
- 실물 확인 기록과 검사 스크립트 `lab/pilot-prep/`.
- 문서: 설계서 11.1절과 변경 이력, 코드 구조 문서, `CHANGELOG`, 기술 부채 표의 TD-12·TD-42 행.
- 열린 질문 Q10·Q13을 추천안과 함께 올린다(아래 "열린 질문").

비범위:

- "버그 수정 PR의 검증 증거 필수 상태 체크"(11.1절 마지막 항목), 증거를 PR에 붙이는 수단, 스크린샷·영상을 올리는 일(올리기 전 민감 표시 검사 포함). 이유: 워크플로 변경이다. TD-53(Issue #139) 병합 뒤 별도 Issue로 한다(제작자 지시). 이 계획의 공개 증거는 글 요약뿐이다.
- 설계서 14.3절·18절. 이유: Q10·Q13 결정 전에는 고치지 않는다(제작자 지시). 14.3절의 DB 차단 목록 보강과 `verify`의 일회용 DB·합성 시드 연결은 Q10 결정 뒤의 일이다.
- `game-verify`. 게임 프로파일 착수 때 한다.
- 파일럿 대상 리포 만들기, 그 리포의 의존성(`vitest`, `@playwright/test`) 추가. 이 템플릿의 `package.json`·lockfile은 바꾸지 않는다.
- E2E 시나리오(`e2e/`)의 테스트 실효성 검사. 이유: 실행 중인 앱이 필요해 `test-effect`가 변경 전 코드에서 돌릴 수 없다.
- 새 설정 키. `scripts/lib/config.ts`와 `harness.config.json`은 바꾸지 않는다.
- 시나리오 코드가 일부러 우회하는 것을 막는 일. 이유: 시나리오는 PR 작성자의 코드라서, fixture를 쓰지 않고 `harness-verify` 첨부를 직접 붙이거나 자기 브라우저를 따로 띄우면 로컬 `verify`는 속는다. `verify`는 에이전트가 로컬에서 쓰는 도구이지 강제 장치가 아니다(11.1절). 강제는 필수 상태 체크(별도 Issue)가 CI에서 다시 실행하고 검증자가 `e2e/` 변경을 보는 것으로 한다. 이 계획은 실수(fixture 누락, 앱이 낸 외부 요청·리다이렉트)를 잡는다.
- HTTP 프록시를 지나지 않는 통신(WebRTC 등 UDP)의 차단. 이유: L0 네트워크 허용 목록(4단계)의 일이다. 주소 제한의 보장 수준은 11.1절대로 절차 수준이다. 브라우저의 프록시 설정이 듣지 않는 경우(Playwright·Chromium 버전이 바뀌어 우회 규칙의 뜻이 달라지는 경우)에는 요청이 실제로 나간다. 그때도 fixture의 관찰로 `verify`는 실패한다. 버전을 올릴 때 실물 확인을 다시 돌려 잡는다(`profiles/web/README.md`에 적는다).
- 서비스 워커에 기대는 앱 동작의 검증. 이유: `verify`의 브라우저에서는 서비스 워커가 등록·실행되지 않는다(수용 기준 6).
- 다른 세션(Issue #139)과 겹치는 곳: 설계서 0.1절 E1·0.2절·10.2~10.4절, `docs/SECURITY.md`, 절차서 5절, `.github/workflows/`, `scripts/test/ci.test.ts`, `scripts/ci/repro.ts`, `scripts/harness.ts`.

## 관련 파일·문서

- `profiles/web/profile.json`, `profiles/web/README.md`
- `profiles/web/test-effect/run-one.mjs`(새 파일)
- `profiles/web/verify/`(새 폴더: `playwright.config.ts`, `fixture.ts`), `profiles/web/templates/`(시나리오 예시)
- `scripts/commands/standard.ts`
- `scripts/verify/`(새 폴더)
- `scripts/test/profile-web.test.ts`, `scripts/test/standard-args.test.ts`, `scripts/test/verify-web.test.ts`, `scripts/test/verify-guard.test.ts`, `scripts/test/verify-playwright.test.ts`, `scripts/test/verify-skill.test.ts`(모두 새 파일)
- `.gitignore`(`.harness-verify/`)
- `.claude/skills/web-verify/SKILL.md`
- `docs/harness/workflow.md`(4절만), `docs/harness/design.md`(11.1절, 0절 변경 이력), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`(TD-12, TD-42 행만)
- `docs/index.md`(`lab/pilot-prep/README.md` 링크)
- `lab/pilot-prep/`
- `docs/exec-plans/active/20261119-pilot-prep/`

## step 목록

- step0 web-test-effect: 웹 프로파일의 `testEffect` 설정, 파일 하나만 도는 Vitest 래퍼, 실제 Vitest 확인(TD-42).
- step1 verify-run: 표준 명령의 추가 인자 인용, `verify` 웹 구현의 실행·판정(`dev`와 실행기의 수명, 통과 기준, 종료 코드).
- step2 verify-guard: 거부 프록시(앱 주소 밖 요청의 기록과 거부)와 공개 증거 요약.
- step3 verify-playwright: Playwright 설정·fixture, 웹 프로파일의 `verify` 활성화, 실제 Playwright 확인.
- step4 web-verify-skill: 스킬 래퍼, 절차서·설계서·기술 부채 표 반영(TD-12).

## 진행 로그

- 2026-11-19: 제작자 대화 지시로 Issue #140을 등록하고 `new-task`로 worktree와 계획 골격을 만들었다. 계획을 작성했다. 계획만 담은 커밋(`41b45a6`)으로 초안 PR #142를 열었다.
- 2026-11-19: 계획 검증 1라운드(head `41b45a6`). `review/claude` 승인(P2 3건: F1·F2·F3), `review/codex` 수정 요청(P0 1건 F4, P1 6건 F5~F10). 모두 받아들여 계획을 고쳤다(반박 없음).
  - F4(P0): 표준 명령의 추가 인자가 큰따옴표로 셸에 붙는다(`scripts/commands/standard.ts`). 인용을 고치는 일을 범위와 step1에 넣었다(수용 기준 3).
  - F5(P1)·F2(P2): 허용 경계를 루프백 전체에서 그 실행의 앱 출처 하나로 좁히고, 라우팅 대신 하네스가 띄우는 거부 프록시를 주 수단으로 했다(수용 기준 6, step2·step3).
  - F6(P1): 공개 증거를 글 요약 둘로 줄이고 실행 중에 생긴 문자열을 넣지 않는다. 스크린샷을 올리는 일은 비범위로 뺐다(수용 기준 8).
  - F7(P1): 웹 프로파일의 `commands.verify` 활성화를 Playwright 설정·fixture가 생기는 step3으로 옮겼다.
  - F8(P1)·F3(P2): 신호·시간 초과에서 실행기 트리와 `dev` 트리를 모두 끝내고 4초 안에 마치는 계약과 테스트를 step1에 넣었다(수용 기준 4).
  - F9(P1): 임시 폴더의 Vitest 5.1.1로 확인하니 `vitest run src/a.test.ts`가 `src/a.test.tsx`와 `src/sub/src/a.test.ts`까지 돌렸다(3개 파일, 종료 코드 1). 파일 하나만 도는 래퍼(`include`를 그 파일 하나로 바꾼다)로 바꿨다(수용 기준 2, step0).
  - F10(P1)·F1(P2): 실물 확인 결과를 사례별로 검사하는 `lab/pilot-prep/check-results.ts`를 AC에 넣었다.
- 2026-11-19: 계획의 전제가 되는 도구 동작을 리포 밖 임시 폴더에서 확인했다(리포의 파일은 만들지 않았고 step의 구현을 시작하지 않았다).
  - Vitest 5.1.1(Node 22.23.3, macOS): Node API `startVitest('test', [], { watch: false, include: [<파일 하나>] })`가 그 파일 하나만 돌린다. 통과하면 종료 코드 0, 단언 실패면 1이고 출력에 `AssertionError`, 모듈이 없으면 1이고 출력에 `Cannot find module`, 맞는 파일이 없으면 1이다. 대괄호·괄호·공백이 든 경로도 glob 문자를 이스케이프하면 돈다. `node_modules`를 심볼릭 링크로 연결한 다른 폴더에서도 같다.
  - Playwright 1.65.1(Chromium headless shell 159): 실행 옵션 `proxy: { server: <거부 프록시>, bypass: '<-loopback>,127.0.0.1:<앱 포트>' }`와 컨텍스트 옵션 `serviceWorkers: 'block'`에서 앱 출처는 프록시를 지나지 않고 열렸고, 다른 로컬 포트(`127.0.0.1`, `localhost`), 외부 http, 외부 https(`CONNECT`), 웹소켓(`CONNECT`), 앱의 302 리다이렉트 대상은 모두 프록시에 닿아 거부됐다(대상 서버 도달 0건). `bypass`에 `<-loopback>` 없이 `127.0.0.1:<앱 포트>`만 주면 앱 출처까지 프록시로 갔다.
- 2026-11-19: 계획 검증 2라운드(head `61b0a57`). 1라운드의 F4~F10은 모두 `fixed`로 닫혔다. `review/claude` 승인(P2 1건 F11), `review/codex` 수정 요청(P1 5건 F12~F16). 모두 받아들여 계획을 고쳤다(반박 없음).
  - F12(P1): 프록시 우회를 스킴까지 적는다. 스킴만 바뀐 리다이렉트(`https://127.0.0.1:<앱 포트>`) 사례를 실물 확인에 넣었다(수용 기준 6, step3).
  - F13(P1): 서비스 워커의 계약을 "등록·실행되지 않는다. 등록 시도는 실패가 아니다"로 적고 수용 기준 6과 사례의 기대값(종료 코드 0, 워커 스크립트 요청 0건)을 맞췄다.
  - F14(P1): 외부 주소 사례를 도달을 셀 수 있는 통제된 대상(다른 포트의 HTTP·TLS, `*.localhost` 이름, `[::1]`)으로 바꾸고 도달 0건·프록시 기록 1건 이상·종료 코드 1을 검사한다. 실제 외부 주소(`example.com`)로 요청하는 사례는 뺐다.
  - F15(P1)·F11(P2): 시나리오 파일을 환경 변수로 넘겨 정확 일치로 고르고, 결과의 파일 집합을 확인한다. 경로 규칙을 한 곳(`isScenarioPath`)에 둔다(수용 기준 5, step1·step2·step3).
  - F16(P1): 404 사례에서 실패한 요청과 콘솔 에러를 둘 다 선언하고, 하나만 선언하면 실패하는 사례를 더했다(수용 기준 5, step3).
  - fixture의 라우팅 차단을 뺐다(막는 수단은 프록시 하나, fixture는 관찰). 이유는 의사결정 로그.
- 2026-11-19: 2라운드 지적의 전제를 리포 밖 임시 폴더에서 확인했다(Playwright 1.65.1. 리포의 파일은 만들지 않았고 step의 구현을 시작하지 않았다).
  - 우회 `<-loopback>,127.0.0.1:<앱 포트>`: 앱이 `https://127.0.0.1:<앱 포트>/`로 리다이렉트하면 프록시를 지나지 않고 앱 포트에 TLS 연결이 갔다(`ERR_SSL_PROTOCOL_ERROR`, 프록시 기록 없음). F12 그대로다.
  - 우회 `<-loopback>,http://127.0.0.1:<앱 포트>,ws://127.0.0.1:<앱 포트>`: 앱의 `http://`와 `ws://`는 직접 갔고, 같은 포트의 `https://`·`wss://`, 다른 포트의 `http://`(`127.0.0.1`, `ext.localhost`, `[::1]`)·`https://`·`ws://`, `http://localhost:<앱 포트>`는 모두 프록시에 닿았다(대상 도달 0건). `ws://` 항목을 빼면 앱 포트의 `ws://`도 프록시로 갔다.
  - `serviceWorkers: 'block'`: `register()`는 오류 없이 끝났고 워커 스크립트 요청이 앱에 오지 않았다(콘솔 에러·요청 이벤트 없음). `'allow'`로 바꾸면 워커가 돌았고 워커가 다른 포트로 보낸 요청은 프록시에 닿았다(대상 도달 0건).
  - 404 응답: `response` 이벤트(404)와 콘솔 에러(`Failed to load resource: the server responded with a status of 404`)가 둘 다 났다.
  - 실행기: `playwright test e2e/a.spec.ts`가 `e2e/a.spec.ts`와 `e2e/sub-e2e/a.spec.ts` 2개를 돌렸다. 설정의 `testMatch`를 절대 경로에 정확히 일치하는 정규식으로 주면 1개만 돌았고, 없는 파일이면 "No tests found"로 종료 코드 1이다. JSON 보고서의 파일 경로는 `config.rootDir`(시나리오 폴더) 기준 상대 경로다. `type: module`인 폴더에서는 설정 파일의 `__dirname`이 없어 로드가 실패했다. 컨텍스트의 `request` 이벤트는 리다이렉트의 뒤 목적지도 냈고 페이지의 `websocket` 이벤트는 프록시에서 거부된 연결의 URL도 냈다.
- 2026-11-19: 계획 검증 3라운드(head `371129c`). 2라운드의 F12~F16은 모두 `fixed`로 닫혔다. `review/claude` 승인(지적 없음), `review/codex` 수정 요청(P1 2건 F17·F18). 열린 차단 지적은 7 → 5 → 2건으로 줄었고 앞선 지적과 같은 위치가 아니라 수렴하는 라운드다. 둘 다 받아들여 고쳤다(반박 없음).
  - F17(P1): `isScenarioPath`가 `e2e/./a.spec.ts`를 받아 실행 뒤 파일 집합 비교가 어긋난다. 경로의 모든 구간이 영문자·숫자로 시작해야 한다는 조건을 더해 `.` 구간과 점으로 시작하는 구간을 거부한다. 이 규칙에 맞는 경로는 정규화해도 그대로라 글자 그대로 비교한다. `root`는 실제 경로로 바꿔 쓴다(step1).
  - F18(P1): 실물 확인의 `marker` 사례가 표식이 든 이름으로 요청해 그 표식이 거부 프록시 기록에 들어간 것을 확인하고, 모든 사례에서 프록시 기록의 대상 문자열이 `evidence/`에 없는지를 결과 검사기의 통과 조건으로 한다(수용 기준 8, step3).
- 2026-11-19: 계획 검증 4라운드(head `3bcd478`). `review/claude`, `review/codex` 모두 승인(지적 없음), 원장의 차단 지적 0건(전체 18건, 미룸 4건). 계획 검증(G1)이 끝나 step0의 구현을 시작했다.
- 2026-11-19: step0을 로컬에서 구현했다(push하지 않았다. TD-53 PR #141이 제작자 승인 대기 중이다).
  - 테스트를 먼저 썼다(`scripts/test/profile-web.test.ts`, 구현 전 6개 가운데 5개 실패). `profiles/web/test-effect/run-one.mjs`와 `profiles/web/profile.json`의 `testEffect`(버전 0.2.0)를 더해 6개 모두 통과한다.
  - 실물 확인: `mktemp -d` 폴더에 이 worktree를 복제해 웹 프로파일을 적용하고 Vitest를 설치했다. 이 리포의 설치 정책(`minimumReleaseAge`)이 5.1.1 대신 5.1.0을 골랐다. `lab/pilot-prep/trial-test-effect.ts`가 일곱 사례를 만들어 `test-effect`를 두 번 돌렸고 첫 실행에서 모두 기대대로 나왔다(`all` 종료 코드 1, `effective-only` 0). 이름이 겹치는 세 파일(`src/sim/a.test.ts`, `a.test.tsx`, 더 깊은 폴더의 같은 이름)은 파일마다 자기 결과대로 판정됐다. `node lab/pilot-prep/check-results.ts test-effect-vitest` 통과.
  - `lab/pilot-prep/check-results.ts`의 테스트(`lab/pilot-prep/test/`)를 더했다(어긋난 결과 파일을 통과시키지 않는지 8개).
  - 남은 것: `CHANGELOG`·TD-42 행·설계서 0절 변경 이력(TD-53 병합 뒤 `origin/main`을 병합하고 더한다), `check` → `complete-step` → push → `pr-ready`.

## 의사결정 로그

- 결정: 계획의 위험도는 high다. / 이유: `verify`는 보안 성격의 동작을 구현한다(제작자 로그인 세션과 브라우저 분리(E5), 열 수 있는 주소 제한, 증거에서 자격증명 제거). 10.1절 "보안·권한·인증 변경"에 걸치고, 애매하면 high다(절차서 1절). 구현 PR은 모두 보호 경로(`profiles/**`, `scripts/**`)를 바꿔 운영 단계에서는 어차피 제작자 승인 대상이라 승인 횟수는 늘지 않는다. / 버린 대안: normal(TD-42만 보면 설정값이지만 한 계획에 `verify`가 같이 있다).
- 결정: Playwright와 Vitest는 대상 리포(웹 프로파일을 적용한 제품 리포)의 의존성이다. 하네스 코드(`scripts/`)는 둘을 import하지 않고 명령으로만 실행한다. 이 템플릿의 `package.json`에는 더하지 않는다. / 이유: 코어 코드는 프로파일을 몰라도 된다(S5). core 프로파일 리포가 브라우저 내려받기와 웹 전용 의존성을 지지 않는다. 템플릿에 새 직접 의존성이 없으니 ADR도 필요 없다. / 버린 대안: 템플릿의 devDependency로 `@playwright/test`를 더한다(이 리포의 테스트에서 실제 브라우저를 돌릴 수 있지만 CI 시간과 설치 정책 부담이 크다).
- 결정: Vitest와 Playwright를 import하는 파일(래퍼, 설정, fixture)은 `profiles/web/` 아래에 둔다. / 이유: `tsconfig.json`의 `include`가 `scripts/**/*.ts`라 `scripts/` 아래에 두면 이 리포의 `lint`(tsc)가 그 모듈을 찾지 못해 실패한다. `profiles/**`는 보호 경로라 제품 리포에서 에이전트가 주소 제한을 풀려면 제작자 승인이 필요하다. / 버린 대안: 템플릿으로 제품 리포의 `e2e/`에 복사한다(보호 경로 밖이라 fixture를 고쳐 제한을 풀 수 있다).
- 결정: `test-effect`의 웹 프로파일 명령은 Vitest CLI가 아니라 래퍼 `node profiles/web/test-effect/run-one.mjs <파일>`이다. 래퍼는 Vitest Node API로 `include`를 그 파일 하나로 바꿔 실행한다. / 이유: Vitest CLI의 인자는 경로 부분 문자열 필터라 이름이 겹치는 다른 테스트 파일이 함께 돌고, `test-effect`는 종료 코드 하나로 판정해 결과가 섞인다(계획 검증 F9, 임시 폴더에서 재현). / 버린 대안: CLI 필터에 겹치는 파일마다 `--exclude`를 붙인다(겹치는 파일을 찾으려고 리포를 훑어야 하고 Vitest의 필터 규칙을 따라 구현해야 한다).
- 결정: 표준 명령의 추가 인자는 `scripts/commands/standard.ts`에서 작은따옴표로 인용해(안의 `'`는 `'\''`) 셸 명령에 붙인다. / 이유: 지금의 `JSON.stringify`(큰따옴표)는 셸이 `$(…)`·역따옴표·`$변수`를 풀게 둔다. 명령 정의가 셸 문자열(6절)이라 실행 자체는 셸로 두고, 인자가 글자 그대로 전달되게 한다. POSIX `sh`와 Git Bash에서 같은 규칙이다. / 버린 대안: `verify`가 추가 인자를 받지 않게 한다(셸 해석은 `web.ts`에 닿기 전에 일어나므로 막지 못하고, 다른 표준 명령에도 같은 문제가 남는다).
- 결정: `verify`의 진입점은 `node scripts/verify/web.ts`이고 웹 프로파일의 `commands.verify.run`에 적는다. `scripts/harness.ts`는 고치지 않는다. 활성화는 Playwright 설정·fixture가 생기는 step3에서 한다. / 이유: 표준 명령 실행기(`runStandard`)가 `commands.verify`를 그대로 실행한다. 다른 세션이 `scripts/harness.ts`를 고치는 중이다. 실행기가 가리킬 설정 파일이 없는 상태로 명령을 켜지 않는다(F7). / 버린 대안: `harness.ts`에 `verify-web` 하위 명령을 더한다.
- 결정: 설정 키를 더하지 않는다. 시나리오 실행기 명령과 제한 시간은 `scripts/verify/web.ts`의 상수이고, 테스트는 함수 인자로 가짜 실행기를 넣는다. / 이유: 실행기를 설정으로 바꿀 수 있으면 검사를 약화시키는 길이 하나 더 생기고 `harness-guard`의 신호 목록도 고쳐야 한다. 필요가 생기면 그때 더한다(B4). / 버린 대안: `verify.web.runner` 설정 키.
- 결정: 판정은 세 가지로 한다: Playwright JSON 리포터의 결과 파일(시나리오 목록과 상태), fixture가 시나리오마다 붙이는 관찰 기록(`harness-verify` 첨부), 거부 프록시의 기록. 관찰 기록이 없는 시나리오는 실패다. / 이유: 콘솔 에러와 실패한 요청은 페이지에 리스너를 달아야 셀 수 있어 fixture가 필요하고, 스킬은 강제 장치가 아니므로(11.1절) fixture를 빠뜨린 시나리오를 판정에서 걸러야 한다. 프록시 기록은 시나리오 코드가 아니라 하네스 프로세스가 만든다. / 버린 대안: fixture가 따로 파일에 적는다(fixture를 쓰지 않은 시나리오가 보이지 않는다).
- 결정: 주소 제한을 막는 수단은 `verify`가 실행마다 띄우는 거부 프록시 하나다. 브라우저의 모든 요청을 프록시로 보내고 그 실행의 앱 주소(`http://127.0.0.1:<포트>`와 같은 호스트·포트의 `ws://`)만 스킴까지 적어 프록시를 지나지 않게 한다. 프록시는 아무것도 전달하지 않고 거부하며 종류·호스트·포트만 기록한다. fixture는 막지 않고 본다: 앱 주소 밖으로 가려던 요청과 웹소켓을 시나리오별로 적고(`blocked: true`), 이것은 선언으로 뺄 수 없는 실패다. / 이유: 컨텍스트 라우팅은 리다이렉트의 뒤 목적지와 서비스 워커의 요청을 가로채지 못한다(F5). 우회 규칙을 호스트:포트로만 적으면 앱 포트로 가는 `https` 요청(스킴만 바뀐 리다이렉트)이 프록시를 지나지 않고 직접 연결된다(F12, 임시 폴더에서 재현). 스킴까지 적으면 `https`·`wss`는 프록시로 간다. 막는 수단이 둘이면(라우팅과 프록시) 라우팅이 먼저 막은 요청은 실물 확인에서 프록시 경로를 확인하지 못하고, fixture를 쓰지 않은 시나리오에는 라우팅이 없다. 판정은 서로 기대지 않는 두 기록(프록시, fixture의 관찰) 가운데 하나만 걸려도 실패다. 보장 수준은 11.1절대로 절차 수준이다(L0는 4단계). / 버린 대안: 라우팅만 쓴다. 라우팅으로 먼저 막고 프록시를 뒤에 둔다. 호스트:포트 우회(`127.0.0.1:<포트>`). 호스트 해석 규칙(`--host-resolver-rules`, 포트 단위로 가르지 못한다).
- 결정: 같은 호스트·포트의 `ws://`는 앱 주소에 넣는다. / 이유: 개발 서버(`dev`)의 HMR이 같은 서버에 웹소켓을 연다. 막으면 개발 서버로 띄운 앱의 `verify`가 프록시 기록과 콘솔 에러로 늘 실패한다(임시 폴더에서 확인: `http://`만 우회시키면 앱 포트의 `ws://`가 프록시로 갔다). 같은 리스닝 소켓으로 가는 평문 연결이라 "worktree에서 띄운 로컬 앱 주소"(11.1절) 안이다. / 버린 대안: `http://`만 허용한다(파일럿의 개발 서버에서 쓸 수 없다).
- 결정: 서비스 워커는 등록·실행을 막고(`serviceWorkers: 'block'`), 등록 시도 자체는 실패로 세지 않는다. / 이유: 막으면 브라우저가 워커 스크립트를 받아 오지 않고 `register()`는 조용히 끝난다(임시 폴더에서 확인. 콘솔 에러도 요청도 없다). 워커가 없으니 워커가 내는 요청도 없다. 등록 시도를 실패로 세려면 페이지에 스크립트를 넣어 `register`를 가로채야 하고, 워커를 쓰는 앱(PWA)은 그것만으로 늘 실패하게 된다. 차단이 듣지 않는 경우에도 워커의 요청은 브라우저의 프록시 설정을 따른다(임시 폴더에서 `serviceWorkers: 'allow'`로 확인: 워커가 다른 포트로 보낸 요청이 프록시에 닿았고 대상 도달 0건). / 버린 대안: 등록 시도를 실패로 센다(F13의 첫 제안. 위 이유로 버린다).
- 결정: 시나리오 파일 지정은 실행기의 명령행 인자가 아니라 환경 변수 `HARNESS_VERIFY_SCENARIOS`(JSON 배열)로 넘기고, 하네스의 Playwright 설정이 그 경로들의 절대 경로에 정확히 일치하는 `testMatch`로 바꾼다. `verify`는 실행 뒤 결과 파일의 시나리오 파일 집합이 지정한 것과 같은지 확인한다. 경로 규칙(`e2e/`로 시작해 `.spec.ts`로 끝나고 영문자·숫자·`._-/`만)은 `scripts/verify/judge.ts`의 `isScenarioPath` 하나로 두고 명령행 검사와 증거 요약이 같이 쓴다. / 이유: Playwright CLI의 파일 인자는 정규식이라 `e2e/a.spec.ts`를 넘기면 `e2e/sub-e2e/a.spec.ts`도 돈다(F15, 임시 폴더에서 재현: 2개가 돌았다. 환경 변수와 정확 일치 `testMatch`로는 1개). 규칙이 두 곳에 있으면 어긋난다(F11). 대괄호·괄호는 요약이 PR 본문에 마크다운으로 들어가므로 뺀다. / 버린 대안: 정규식 문자를 이스케이프해 명령행 인자로 넘긴다(Playwright의 인자 해석 규칙에 기댄다).
- 결정: 콘솔 에러와 실패한 요청은 따로 세고 따로 선언한다. 404 응답 하나는 두 분류에 한 건씩 생긴다. / 이유: Chromium은 404 응답에 콘솔 에러(`Failed to load resource`)도 낸다(F16, 임시 폴더에서 확인). 둘을 묶어 한 선언으로 빼려면 브라우저가 내는 문구에 기대야 한다. / 버린 대안: 요청 실패에서 나온 콘솔 에러를 fixture가 알아서 뺀다.
- 결정: 공개 증거 묶음은 `summary.md`와 `summary.json` 둘뿐이고, 실행 중에 생긴 문자열 없이 파일 경로·줄 번호·상태·건수만 담는다. 자세한 진단(콘솔 문구, URL, 스크린샷, trace)은 `local/`에 두고 올리지 않는다. / 이유: 콘솔 문구나 URL 경로, 화면에 토큰이 찍힐 수 있고 글자 수를 자르는 것으로는 지워지지 않는다(F6). 11.1절은 올리기 전에 요청 헤더·쿠키·토큰을 지우라고 한다. 올리는 내용을 건수로 한정하면 빠뜨릴 길이 없다. 봇이 PR에 이미지를 붙일 수단도 지금은 없다(아래). / 버린 대안: 스크린샷을 묶음에 넣고 화면 글자를 비밀 패턴으로 검사한다(검사가 놓치면 그대로 공개된다. 필수 상태 체크의 Issue에서 수단과 함께 정한다).
- 결정: 증거를 PR에 붙이는 수단은 이 계획에서 정하지 않는다. `verify`는 묶음을 worktree의 `.harness-verify/<실행 시각>/evidence/`에 만들고 `summary.md`를 PR 본문에 옮길 수 있는 글로 낸다. / 이유: 봇은 PR 댓글에 파일을 올릴 API가 없고, 스크린샷을 커밋하면 바이너리 파일이라 `risk-gate`가 위험도 높음으로 올린다. Actions 산출물로 올리려면 워크플로를 바꿔야 한다. 필수 상태 체크와 같이 정할 일이다(별도 Issue). / 버린 대안: 계획 폴더에 스크린샷을 커밋한다.
- 결정: Codex 쪽 래퍼는 따로 만들지 않고 절차서 4절의 안내 항목으로 한다. / 이유: Codex는 `AGENTS.md`와 절차서를 읽는다(13.1절). `new-task` 스킬도 Claude Code 쪽에만 있고 Codex는 절차서로 같은 명령에 닿는다. 로직은 `scripts/`에 하나뿐이다. / 버린 대안: Codex 스킬 폴더를 새로 만든다(Codex의 프로젝트 스킬 로딩을 이 리포에서 확인한 적이 없다, TD-8).
- 결정: step을 5개로 나눈다(1라운드의 4개에서 거부 프록시·증거 요약을 따로 뗐다). / 이유: 거부 프록시와 인자 인용이 더해져 실행·판정 step이 PR 하나 크기를 넘는다. 프록시와 요약은 Playwright 없이 이 리포의 테스트로 확인되는 모듈이다. / 버린 대안: 4개로 두고 step1·step2를 키운다.
- 결정: step0의 구현은 계획 검증 뒤 로컬에서 끝내 두고, push와 승인 요청은 TD-53 PR(Issue #139)이 병합된 뒤에 한다. `CHANGELOG`·기술 부채 표·설계서의 변경은 그 병합을 `origin/main`에서 받아 온 뒤에 더하고 버전은 v0.7.59부터 쓴다. / 이유: 다른 세션과의 합의(세 파일을 고치는 PR은 한 번에 하나, 제작자 승인 대기 중인 PR이 있으면 `pr-ready`를 하지 않는다). push 한 번이 판정 한 라운드라 준비가 끝난 뒤 한 번에 올린다(절차서 5절). / 버린 대안: 구현을 먼저 올리고 `CHANGELOG`를 나중 커밋으로 더한다(라운드가 늘고 `harness-guard`가 그 사이 실패한다).
- 결정: Q10·Q13은 "열린 질문"에 올리되 step0~4는 답을 기다리지 않는다. / 이유: 어느 step도 DB·ORM이나 리포 소유 계정에 기대지 않는다. 답이 필요한 일(14.3절·18절, DB 차단 목록, 일회용 DB)은 비범위다.

## 발견 사항

- `verify`가 만든 증거를 봇이 PR에 붙일 길이 지금은 없다(댓글 파일 첨부 API 없음, 커밋하면 바이너리라 위험도 높음). → 처리: TD-12(행을 갱신할 때 남은 일로 적는다. 필수 상태 체크의 별도 Issue에서 정한다)
- E2E 시나리오는 `test-effect` 대상이 아니다(실행 중인 앱이 필요하다). 11.1절 절차 7("재현 시나리오는 E2E 테스트로 남긴다")의 실효성은 `verify`의 전후 비교로만 본다. → 처리: TD-12(남은 일로 적는다)
- 표준 명령의 추가 인자가 큰따옴표로 셸에 붙어 `$(…)`가 실행된다(`scripts/commands/standard.ts`, 이 계획 전부터 있던 동작. 계획 검증 F4). → 처리: 이 계획의 step1에서 고친다
- Vitest CLI의 파일 인자는 부분 문자열 필터다(`a.test.ts`를 넘기면 `a.test.tsx`도 돈다). → 처리: 이 계획의 step0(래퍼)과 `profiles/web/README.md`
- Playwright CLI의 파일 인자는 정규식이다(`e2e/a.spec.ts`가 `e2e/sub-e2e/a.spec.ts`도 고른다). → 처리: 이 계획의 step1·step3(환경 변수와 정확 일치)
- Playwright JSON 보고서의 파일 경로는 리포 루트가 아니라 시나리오 폴더(`config.rootDir`) 기준이다. → 처리: 이 계획의 step1(`judge`가 리포 기준 경로로 바꾼다)
- Chromium은 404 응답에 콘솔 에러도 낸다. → 처리: 이 계획의 step3(fixture와 `profiles/web/README.md`)
- `verify`의 브라우저에서는 서비스 워커가 돌지 않아 워커에 기대는 동작은 확인하지 못한다. → 처리: 이 계획의 step3(`profiles/web/README.md`에 한계로 적는다)
- 웹 프로파일에 `testEffect` 키가 없던 동안, `init --profile web`을 적용한 리포에는 core 프로파일의 `testEffect`(`scripts/test/*.test.ts`, `node --test`)가 그대로 남아 있었다(`init`은 프로파일에 있는 키만 덮어쓴다). 그래서 `src/`의 테스트는 검사 대상에 들지 않고 지나갔다. → 처리: 이 계획의 step0(프로파일이 키를 채운다. TD-42 행을 고칠 때 이 내용을 적는다)

## 열린 질문

두 질문 모두 절차서 7절의 "제품·UX 방향"과 "비용"에 해당한다. step0~4는 답을 기다리지 않는다. 답을 받기 전에는 설계서 14.3절·18절을 고치지 않는다.

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
- 실물 확인(임시 폴더의 실제 웹 프로젝트): step0은 Vitest로 `test-effect`, step3은 Playwright로 `verify`. 절차는 `lab/pilot-prep/README.md`, 결과는 `lab/pilot-prep/results/`에 남기고 `lab/pilot-prep/check-results.ts`로 사례별 기대값을 검사한다. 이 리포의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).
- 결과는 step을 진행하며 진행 로그에 적는다.

## 다음 할 일

1. (끝남) 계획 검증(G1): 4라운드에서 두 검증자 승인.
2. (끝남) step0의 로컬 구현과 실물 확인. push하지 않았다.
3. TD-53 PR(Issue #139, PR #141)이 병합되면 `origin/main`을 병합하고 `CHANGELOG`(v0.7.59)·TD-42 행을 더한 뒤 `check` → `complete-step` → push → `pr-ready`로 한 번만 승인을 요청한다. 그 전에 다른 세션의 PR이 제작자 승인 대기 중이면 기다린다.
4. 병합 뒤 `new-task --plan 20261119-pilot-prep --step 1`.
5. Q10·Q13의 답을 받으면 의사결정 로그에 적는다. 14.3절·18절 반영은 별도 Issue다.
