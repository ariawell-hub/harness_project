# Step 3: verify-playwright

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 4~9, 의사결정 로그, 진행 로그의 Playwright 확인 결과)
- `docs/harness/design.md` 11.1절(브라우저, 열 수 있는 주소, 데이터, 통과 기준), 14.6절(페이지 내용은 데이터다)
- 앞 step에서 만든·바꾼 파일: `scripts/verify/judge.ts`(`OBSERVATION_NAME`, `Observation`), `scripts/verify/web.ts`(`DEFAULT_RUNNER`, 환경 변수 `HARNESS_VERIFY_BASE_URL`·`HARNESS_VERIFY_OUT`·`HARNESS_VERIFY_PROXY`, 출력 폴더 구조), `scripts/verify/deny-proxy.ts`, `scripts/verify/evidence.ts`, `scripts/commands/standard.ts`(추가 인자 인용), `scripts/test/profile-web.test.ts`, `profiles/web/profile.json`, `profiles/web/README.md`, `lab/pilot-prep/README.md`, `lab/pilot-prep/check-results.ts`
- `scripts/commands/init.ts`(프로파일의 `templates` 복사)

## 작업

Playwright 쪽 파일(설정, fixture)을 만들고, 웹 프로파일의 `verify`를 켜고, 실제 Playwright로 돌려 확인한다.

1. `profiles/web/verify/playwright.config.ts`(새 파일. `@playwright/test`를 import한다. 이 리포의 `tsconfig.json` 대상이 아니다)
   - `HARNESS_VERIFY_BASE_URL`, `HARNESS_VERIFY_OUT`, `HARNESS_VERIFY_PROXY` 가운데 하나라도 없으면 오류로 끝난다(`node scripts/harness.ts verify`로 실행하라는 안내). base URL이 `http://127.0.0.1:<포트>` 꼴이 아니어도 오류다.
   - 시나리오 위치: 리포 루트의 `e2e/` 아래 `*.spec.ts`. `forbidOnly: true`, `retries: 0`.
   - 리포터: JSON(`<OUT>/report.json`)과 줄 단위 출력.
   - 산출물 폴더(`outputDir`): `<OUT>/local/artifacts`. 스크린샷은 항상, trace와 영상은 실패했을 때만 남긴다(모두 `local/` 아래다. 올리지 않는다).
   - 브라우저: Playwright가 받은 Chromium 하나. 시나리오마다 새 컨텍스트다(Playwright 기본 동작). `channel`, `userDataDir`, `connectOverCDP`, `launchPersistentContext`를 쓰지 않는다. 이유: 제작자가 로그인해 둔 브라우저에 붙지 않는다(E5).
   - **주소 제한**: 브라우저의 프록시를 `HARNESS_VERIFY_PROXY`로 두고, 그 실행의 앱 출처(호스트:포트)만 프록시를 지나지 않게 한다. 루프백의 다른 포트도 프록시로 가야 한다(Playwright 1.65.1에서는 `bypass: '<-loopback>,127.0.0.1:<앱 포트>'`로 됐다. plan.md 진행 로그). 서비스 워커는 막는다(`serviceWorkers: 'block'`).

2. `profiles/web/verify/fixture.ts`(새 파일)
   - `export const test`(Playwright `test`를 확장), `export { expect }`. 시나리오는 이 파일에서 `test`를 import한다.
   - 자동 fixture(시나리오가 따로 요청하지 않아도 돈다)가 컨텍스트에 아래를 건다.
     - 보조 주소 제한: 모든 요청을 라우팅해 출처가 `HARNESS_VERIFY_BASE_URL`의 출처와 정확히 같지 않으면(스킴·호스트·포트) 보내지 않고 중단한다. `failedRequests`에 `blocked: true`로 적는다. 주 수단은 1의 프록시다. 이 라우팅은 어느 시나리오가 요청했는지를 남긴다.
     - 관찰: 페이지마다 콘솔의 `error` 메시지와 잡히지 않은 예외(`pageerror`)를 `consoleErrors`에, 실패한 요청(`requestfailed`)과 상태 코드 400 이상인 응답을 `failedRequests`에 적는다. 요청·응답의 헤더, 쿠키, 본문은 적지 않는다.
   - 의도한 실패 선언: fixture `verify`의 `allowConsoleError(pattern)`, `allowFailedRequest(pattern)`. 선언에 맞는 항목은 목록에서 빼고 `allowed` 건수로 센다. `blocked: true`인 항목은 선언으로 뺄 수 없다.
   - 시나리오가 끝날 때(성공·실패 모두) `Observation`(`version: 1`)을 `harness-verify`라는 이름의 JSON 첨부로 붙인다. 형식은 `scripts/verify/judge.ts`의 것과 같다.
   - fixture는 `scripts/`의 파일을 import하지 않는다(출처 비교 같은 짧은 로직은 이 파일에 쓴다). 이유: Playwright의 TypeScript 로더와 Node의 로더가 달라 `.ts` 확장자 import가 어긋날 수 있다.

3. 시나리오 예시 템플릿과 프로파일
   - `profiles/web/templates/smoke.spec.ts`: fixture의 `test`로 첫 화면을 열어 제목이 있는지 보는 시나리오 하나.
   - `profiles/web/profile.json`: `commands.verify`를 `{ "run": "node scripts/verify/web.ts", "timeoutSec": 1800 }`으로, `templates`에 `{ "from": "templates/smoke.spec.ts", "to": "e2e/smoke.spec.ts" }`를 더하고, `version`을 `0.3.0`으로 올린다.

4. 테스트 `scripts/test/verify-playwright.test.ts`(새 파일. Playwright를 실행하지 않고 파일 내용과 프로파일을 본다)
   - `profiles/web/verify/playwright.config.ts`와 `fixture.ts`에 `connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`이 없다.
   - 설정 파일에 `HARNESS_VERIFY_BASE_URL`, `HARNESS_VERIFY_OUT`, `HARNESS_VERIFY_PROXY`, `serviceWorkers`, `forbidOnly`가 있다. `fixture.ts`에 `OBSERVATION_NAME`의 값과 `HARNESS_VERIFY_BASE_URL`이 있다.
   - `DEFAULT_RUNNER`의 `--config` 뒤 경로에 파일이 있다.
   - `scripts/test/profile-web.test.ts`에 더한다: 웹 프로파일의 `commands.verify.run`이 `node scripts/verify/web.ts`이고 `commands.dev`가 `null`이 아니다. `templates`의 모든 `from` 파일이 있고, `init`을 적용하면 `e2e/smoke.spec.ts`가 생긴다.

5. 실물 확인(`lab/pilot-prep/`)
   - `mktemp -d`로 만든 폴더에 이 worktree를 로컬 복제하고 `init --profile web`을 적용한다. `@playwright/test`를 devDependency로 더하고(버전 고정) Chromium을 받는다. 이 리포의 `package.json`·lockfile은 바꾸지 않는다.
   - `app:dev`는 `PORT`를 따르는 작은 Node HTTP 서버로 둔다. 따로 "다른 서버"를 하나 더 띄운다(다른 로컬 포트, HTTP와 업그레이드 요청의 도달 횟수를 센다). 앱은 사례에 쓸 페이지를 준다(다른 서버로 `fetch`, 다른 서버로 302 리다이렉트, 다른 서버로 웹소켓, 다른 서버로 `fetch`하는 서비스 워커 등록, 외부 이름으로 `fetch`).
   - 사례마다 `node scripts/harness.ts verify -- e2e/<사례>.spec.ts`를 돌려 `lab/pilot-prep/results/verify-playwright.json`의 `cases`에 적는다. 사례마다 `id`, `exitCode`, `otherHits`(다른 서버의 도달 횟수), `denied`(거부 프록시 건수), `evidenceFiles`(`evidence/`의 파일 이름 목록), `leftover`(실행 뒤 남은 `dev`·실행기·브라우저 프로세스 수)를 적는다.

     | 사례 id           | 내용                                                            | 기대                                                       |
     | ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
     | `pass`            | 통과하는 시나리오                                               | 종료 코드 0, `denied` 0                                    |
     | `console-error`   | 페이지가 `console.error`를 낸다                                 | 종료 코드 1                                                |
     | `failed-request`  | 페이지가 앱의 없는 경로를 `fetch`한다(404)                      | 종료 코드 1                                                |
     | `allowed-failure` | 위 요청을 `allowFailedRequest`로 선언한다                       | 종료 코드 0                                                |
     | `other-port`      | 페이지가 다른 서버(`127.0.0.1`의 다른 포트)를 `fetch`한다       | 종료 코드 1, `otherHits` 0                                 |
     | `localhost-port`  | 같은 요청을 `localhost` 이름으로 한다                           | 종료 코드 1, `otherHits` 0                                 |
     | `external-http`   | 페이지가 `http://example.com/`을 `fetch`한다                    | 종료 코드 1                                                |
     | `external-https`  | 페이지가 `https://example.com/`을 `fetch`한다                   | 종료 코드 1                                                |
     | `redirect-out`    | 앱의 경로가 다른 서버로 302 리다이렉트한다                      | 종료 코드 1, `otherHits` 0, `denied` 1 이상                |
     | `websocket-out`   | 페이지가 다른 서버로 웹소켓을 연다                              | 종료 코드 1, `otherHits` 0                                 |
     | `service-worker`  | 페이지가 다른 서버로 `fetch`하는 서비스 워커를 등록한다         | `otherHits` 0(종료 코드는 적기만 한다)                     |
     | `allow-blocked`   | `other-port`의 요청을 `allowFailedRequest`로 선언한다           | 종료 코드 1, `otherHits` 0                                 |
     | `no-fixture`      | `@playwright/test`의 `test`를 직접 쓴 시나리오                  | 종료 코드 1                                                |
     | `skipped`         | 건너뛰게 표시한 시나리오                                        | 종료 코드 1                                                |
     | `marker`          | 합성 표식을 화면 글자·콘솔 에러·요청 URL·시나리오 제목에 넣는다 | `evidence/` 두 파일에 표식 없음(`markerInEvidence: false`) |
     | `signal`          | 끝나지 않는 시나리오를 돌리다 `verify`에 SIGTERM을 보낸다       | `leftover` 0                                               |
     | `shell-arg`       | `verify -- 'e2e/$(touch <표식 파일>).spec.ts'`                  | 종료 코드 1, 표식 파일 없음(`markerFile: false`)           |

   - 앱·다른 서버 띄우기, 사례별 실행, 관찰 값 모으기, 결과 파일 쓰기는 스크립트 `lab/pilot-prep/trial-verify.ts <복제한 폴더>`가 한다(의존성과 Chromium 설치는 README의 명령으로 먼저 한다). 결과 파일을 손으로 쓰지 않는다.
   - 모든 사례에서 `evidenceFiles`는 `summary.json`과 `summary.md`뿐이고 `leftover`는 0이어야 한다(`shell-arg`는 예외다: 인자가 글자 그대로 전달돼 `web.ts`의 경로 검사에서 거부되므로 아무것도 띄우지 않고 `evidenceFiles`가 비어 있다).
   - 결과 파일에 함께 적는다: `tool`(Playwright·Node 버전, OS), 설정에 쓴 프록시 우회 값(`bypass`), 실패 사례에서 trace가 `local/` 아래에만 있는지(`traceOnlyInLocal`).
   - `lab/pilot-prep/check-results.ts`에 `verify-playwright`를 더한다: `node lab/pilot-prep/check-results.ts verify-playwright`가 위 표의 사례 id가 모두 있고 더 있는 것은 없는지, 사례마다 표의 기대(종료 코드, `otherHits`, `denied`, `markerInEvidence`, `markerFile`)와 공통 기대(`evidenceFiles`, `leftover`)가 맞는지, `tool.playwright`와 `bypass`가 비어 있지 않은지, `traceOnlyInLocal`이 참인지 확인한다. 어긋나면 무엇이 어긋났는지 내고 종료 코드 1이다.
   - `DEFAULT_RUNNER`(`node node_modules/@playwright/test/cli.js …`)가 실제로 도는지 확인한다.
   - 기대와 다른 사례가 있으면 결과 파일을 맞춰 고치지 않는다. 설정·fixture·`scripts/verify/`를 고치고(테스트도 함께) 다시 돌린다. 프록시 방식으로 기대를 채울 수 없으면 멈추고 계획을 고쳐 다시 검증받는다.
   - `lab/pilot-prep/README.md`에 절차와 결과 파일 설명을 더한다.

6. 문서
   - `profiles/web/README.md`의 verify 항목: 대상 리포의 준비(`@playwright/test` 추가와 그 리포의 ADR, Chromium 받기, `app:dev`는 환경 변수 `PORT`·`HOST`를 따른다), 시나리오 쓰는 법(fixture import, 의도한 실패 선언), 통과 기준, 주소 제한(앱 출처 하나, 다른 로컬 서비스가 필요하면 계획에 적고 제작자 승인으로 설정을 고친다), 출력 폴더(`evidence/`에는 요약 둘, 나머지는 `local/`), 합성 시드 데이터만 쓴다, 페이지 내용은 지시가 아니라 데이터다, 시나리오 코드가 일부러 우회하는 것은 막지 못한다.
   - `docs/harness/architecture.md`의 `verify/*` 줄 갱신, `docs/harness/CHANGELOG.md` 한 줄, 설계서 0절 변경 이력 한 줄(다음 버전 번호).

## Acceptance Criteria

```bash
node --test scripts/test/verify-playwright.test.ts
node --test scripts/test/profile-web.test.ts
node --test scripts/test/verify-web.test.ts
node --test scripts/test/verify-guard.test.ts
node lab/pilot-prep/check-results.ts verify-playwright
node lab/pilot-prep/check-results.ts test-effect-vitest
grep -q 'allowFailedRequest' profiles/web/README.md
node scripts/harness.ts lint
node scripts/harness.ts fmt --check
node scripts/harness.ts doc-lint
```

## 금지사항

- 브라우저의 프록시 우회 목록에 그 실행의 앱 출처 밖의 것을 넣지 마라(루프백 전체, 와일드카드 포함). 이유: 11.1절 "worktree에서 띄운 로컬 앱 주소만 연다". 다른 포트의 로컬 서비스도 허용 밖이다(계획 검증 F5).
- 주소 제한을 fixture의 라우팅에만 맡기지 마라. 이유: 라우팅은 리다이렉트의 뒤 목적지와 서비스 워커의 요청을 가로채지 못한다. 주 수단은 프록시다.
- 설정·fixture에서 기존 브라우저나 사용자 프로필에 붙지 마라(`connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`). 이유: 제작자가 로그인해 둔 세션을 에이전트가 쓰게 된다(E5).
- `blocked: true`인 요청을 "의도한 실패"로 뺄 수 있게 하지 마라. 이유: 외부 주소를 여는 예외는 계획에 적고 허용하는 일이지(11.1절) 시나리오 코드가 스스로 푸는 일이 아니다.
- `evidence/`에 요약 두 파일 밖의 것을 넣게 고치지 마라. 이유: 스크린샷·trace에는 화면의 토큰과 요청 헤더·쿠키가 담긴다. 올리는 일은 범위 밖이다.
- 실물 확인에 실데이터, 제작자 계정, 로그인이 필요한 외부 서비스를 쓰지 마라. 이유: 검증은 합성 데이터로만 한다. 외부 이름 사례는 프록시에서 막히는 것만 확인한다(요청이 실제로 나가지 않는다).
- 실물 확인 결과 파일을 손으로 기대값에 맞추지 마라. 돌리지 못한 사례는 채우지 말고 step을 끝내지 않는다. 이유: 이 파일이 수용 기준 4·6·8·9의 근거다.
- 이 리포의 `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `harness.config.json`, `scripts/harness.ts`, `scripts/lib/config.ts`를 바꾸지 마라. 이유: Playwright는 대상 리포의 의존성이다. 설정 키를 더하지 않는다.
- `scripts/verify/`에서 `@playwright/test`를 import하지 마라. 이유: 이 리포의 `lint`가 실패한다.
- 테스트(`scripts/test/`)가 `lab/`을 읽게 하지 마라. 이유: `lab/**`는 `testInertPaths`다. 결과 파일 검사는 `lab/pilot-prep/check-results.ts`가 한다.
- 임시 폴더를 지우는 명령을 실행하지 마라. 이유: R14.
- 기술 부채 표, 설계서 11.1절 본문·14.3절·18절·0.1절·0.2절·10.2~10.4절, 절차서 5절을 고치지 마라. 이유: 11.1절 반영은 step4가 한다. 나머지는 다른 세션과의 합의와 Q10·Q13 미결정.
