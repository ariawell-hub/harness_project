# 파일럿 착수 준비: 실물 확인

웹 프로파일의 `test-effect` 설정(TD-42)과 `verify` 구현(TD-12)을 실제 도구(Vitest, Playwright)로 돌려 본 기록이다. 이 템플릿 리포는 core 프로파일이라 두 도구가 없다. 그래서 임시 폴더에 이 리포를 복제해 웹 프로파일을 적용하고 거기서 돌린다. 계획은 `20261119-pilot-prep`(`docs/exec-plans/`)이다.

| 경로                              | 내용                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| `trial-test-effect.ts`            | `test-effect` 실물 확인을 돌리고 결과 파일을 쓴다                      |
| `check-results.ts`                | 결과 파일을 사례별 기대값과 대 본다(어긋나면 종료 코드 1)              |
| `results/test-effect-vitest.json` | `test-effect` 실물 확인 결과                                           |
| `trial-verify.ts`                 | `verify` 실물 확인을 돌리고 결과 파일을 쓴다                           |
| `results/verify-playwright.json`  | `verify` 실물 확인 결과                                                |
| `test/`                           | `check-results.ts` 테스트(`node --test lab/pilot-prep/test/*.test.ts`) |

결과 파일은 스크립트가 쓴다. 손으로 고치지 않는다. 기대와 다른 사례가 나오면 래퍼나 설정을 고치고 다시 돌린다.

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않고, `scripts/test/`의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).

## test-effect (Vitest)

확인하는 것(계획의 수용 기준 2): 웹 프로파일을 적용한 실제 Vitest 프로젝트에서 `node scripts/harness.ts test-effect`가 판정을 내고, 테스트 파일 하나의 판정에 다른 테스트 파일의 결과가 섞이지 않는다.

```bash
T=$(mktemp -d)
git clone -q . "$T/repo"
(cd "$T/repo" && node scripts/harness.ts init --profile web && pnpm add -D --save-exact vitest@5.1.0)
node lab/pilot-prep/trial-test-effect.ts "$T/repo"
node scripts/harness.ts fmt
node lab/pilot-prep/check-results.ts test-effect-vitest
```

- 복제는 커밋된 내용만 가져간다. 확인할 변경을 먼저 커밋한다.
- Vitest 버전은 `5.1.0`으로 고정한다. 결과 파일의 `tool.vitest`가 이 값이 아니면 `check-results.ts`가 실패한다(`VITEST_VERSION`). 버전을 올리려면 설치 명령과 `VITEST_VERSION`을 함께 고치고 다시 돌린다.
- `pnpm add`는 이 리포의 설치 정책(`pnpm-workspace.yaml`의 `minimumReleaseAge`, 설치 스크립트 차단)을 그대로 따른다.
- 결과 파일은 스크립트가 쓴 뒤 `fmt`로 포맷만 맞춘다(내용은 바뀌지 않는다).
- 임시 폴더는 지우지 않는다(R14).

스크립트가 하는 일:

1. 기준 커밋을 둘 만든다: `src/math.ts`(`add`, 값을 그대로 돌려주는 `clamp`), 통과하는 테스트, `vitest.config.ts`. 설정에는 래퍼가 덮어써야 하는 값(`include`, `passWithNoTests: true`)을 일부러 넣는다. 첫 커밋에는 래퍼(`profiles/web/test-effect/run-one.mjs`)가 없고(웹 프로파일을 처음 적용하기 전의 리포), 둘째 커밋이 래퍼를 더한다.
2. 작업 트리를 바꾼다: `clamp`가 10으로 자르게 하고 새 모듈 `src/fresh.ts`를 더하고, 사례마다 테스트 파일 하나를 더한다.
3. `node scripts/harness.ts test-effect --base <기준 커밋>`을 세 번 돌린다.
   - `all`: 래퍼가 있는 기준 커밋과 비교한다. 위쪽 일곱 사례가 모두 있다.
   - `effective-only`: 변경 전 코드에서도 통과하는 두 사례를 뺐다.
   - `first-adoption`: `adoption-*` 두 사례를 더하고 **래퍼가 없는 기준 커밋**과 비교한다. 웹 프로파일과 테스트를 한 변경에서 함께 더하는 경우다.
4. 판정 줄과 종료 코드를 실행 출력에서 옮겨 `results/test-effect-vitest.json`에 쓴다.

| 사례 id          | 테스트 파일                         | 변경 전 코드에서 | 기대 판정                               |
| ---------------- | ----------------------------------- | ---------------- | --------------------------------------- |
| `passes-on-base` | `src/keep.test.ts`                  | 통과             | `ineffective`                           |
| `assertion`      | `src/change.test.ts`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `new-module`     | `src/fresh.test.ts`                 | 모듈 없음        | `effective`, 판정 줄에 `단언 실패 아님` |
| `similar-pass`   | `src/sim/a.test.ts`                 | 통과             | `ineffective`                           |
| `similar-fail`   | `src/sim/a.test.tsx`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `similar-nested` | `src/sim/deep/src/sim/a.test.ts`    | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `special-path`   | `src/app/(shop)/[id]/page.test.tsx` | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `adoption-pass`  | `src/adopt-pass.test.ts`            | 통과             | `ineffective`                           |
| `adoption-fail`  | `src/adopt-fail.test.ts`            | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |

`similar-*` 세 파일은 경로가 서로 부분 문자열이다. Vitest CLI의 파일 인자는 부분 문자열 필터라서 `vitest run src/sim/a.test.ts`는 세 파일을 모두 돌린다. 그러면 통과하는 `similar-pass`가 다른 두 파일의 실패 때문에 `effective`로 잘못 판정된다. 래퍼(`profiles/web/test-effect/run-one.mjs`)가 파일 하나만 돌리므로 `similar-pass`는 `ineffective`로 나와야 한다.

`adoption-*` 두 사례의 판정 줄은 `first-adoption` 실행에서 옮긴다. 변경 전 코드에는 래퍼가 없으므로, 이 변경이 더한 래퍼가 변경 전 코드 위에 놓이지 않으면 Node가 래퍼를 찾지 못해 두 사례 모두 `effective`(단언 실패 아님)로 나온다. 프로파일의 `testEffect.support`에 래퍼 폴더가 있어 래퍼가 함께 놓이고, 통과하는 `adoption-pass`는 `ineffective`로 나와야 한다(구현 판정 F19).

`check-results.ts test-effect-vitest`가 확인하는 것: `tool.vitest`가 `5.1.0`이다, `command`가 `profiles/web/profile.json`의 `testEffect.command`와 같다, 세 실행의 종료 코드(`all` 1, `effective-only` 0, `first-adoption` 1), 위 표의 사례가 모두 있고 더 있는 것이 없다, 사례마다 파일·판정·판정 줄의 문구가 표와 같다.

## verify (Playwright)

확인하는 것(계획의 수용 기준 4·5·6·8·9): 웹 프로파일을 적용한 리포에서 `node scripts/harness.ts verify`가 실제 Playwright와 Chromium으로 돌고, 앱 주소 밖으로 가려는 요청이 대상에 닿지 않고 거부 프록시에 기록되며, 공개 증거 요약에 실행 중의 글자가 새지 않고, 어느 경우에도 프로세스가 남지 않는다.

```bash
T=$(mktemp -d)
git clone -q . "$T/repo"
(cd "$T/repo" && node scripts/harness.ts init --profile web && pnpm add -D --save-exact @playwright/test@1.65.0 && pnpm exec playwright install chromium)
node lab/pilot-prep/trial-verify.ts "$T/repo"
node scripts/harness.ts fmt
node lab/pilot-prep/check-results.ts verify-playwright
```

- 복제는 커밋된 내용만 가져간다. 확인할 변경을 먼저 커밋한다.
- Playwright 버전은 `1.65.0`으로 고정한다. 결과 파일의 `tool.playwright`가 이 값이 아니면 `check-results.ts`가 실패한다(`PLAYWRIGHT_VERSION`). 버전을 올리려면 설치 명령과 `PLAYWRIGHT_VERSION`을 함께 고치고 다시 돌린다. 이 리포의 설치 정책(`minimumReleaseAge`)이 받아 주는 버전이어야 한다.
- Chromium은 Playwright의 공용 캐시(`~/Library/Caches/ms-playwright` 등)에 받는다.
- IPv6 루프백(`[::1]`)이 있는 macOS나 Linux에서 돌린다. 5분쯤 걸린다.
- **실제 외부 주소로는 아무것도 보내지 않는다.** 대상은 스크립트가 띄운 로컬 서버와 해석되지 않는 이름(`external.invalid`)이다. 설정이 틀려 요청이 프록시를 지나지 않아도 밖으로 나가지 않는다.
- 임시 폴더는 지우지 않는다(R14).

스크립트가 하는 일:

1. **통제된 대상**을 띄운다: 다른 포트의 HTTP 서버(`127.0.0.1`과 `[::1]`), 또 다른 포트의 TCP 서버(TLS 대상 구실). 연결·요청·업그레이드 요청을 센다.
2. 복제 폴더에 앱(`trial-app/server.mjs`, `app:dev`)을 쓴다. `PORT`·`HOST`를 따르는 작은 HTTP 서버이고 같은 포트의 웹소켓을 받아 준다. 앱도 대상 구실을 한다: HTTP가 아닌 연결, `Host`가 앱 주소가 아닌 요청, 서비스 워커 스크립트 요청을 센다.
3. **계측 자기 점검**: 대상 서버 셋과 앱에 직접 닿아 보고 계수기가 오르는지 확인한다. 세지 못하면 사례를 돌리지 않고 끝난다(`selfCheck`).
4. `init`이 만든 `e2e/smoke.spec.ts`만 있을 때 인자 없이 돌린다(`full-run`). 그 뒤 사례마다 시나리오 파일을 만들고 `node scripts/harness.ts verify -- e2e/<사례 파일>`을 돌린다.
5. 사례마다 관찰한 값을 `results/verify-playwright.json`에 쓴다.

사례마다 적는 값:

| 값                                | 뜻                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `exitCode`                        | `verify`의 종료 코드(신호로 끝났으면 `null`이고 `signal`에 신호 이름)                                                            |
| `targetHits`                      | 그 실행에서 통제된 대상에 닿은 횟수의 합                                                                                         |
| `denied`, `deniedTargets`         | 거부 프록시에 닿은 요청의 건수와 호스트:포트 목록(`local/detail.json`)                                                           |
| `scenarioFiles`, `scenarios`      | `evidence/summary.json`의 시나리오 파일 목록과 시나리오별 값                                                                     |
| `allowed`                         | 의도한 실패로 뺀 건수(분류별)                                                                                                    |
| `blocked`                         | fixture가 적은 앱 주소 밖 요청의 건수                                                                                            |
| `evidenceFiles`                   | `evidence/`의 파일 이름 목록                                                                                                     |
| `leftover`                        | `verify`가 돌아간 시점에 남아 있는 `dev`·실행기·브라우저·`verify` 프로세스 수                                                    |
| `swScriptHits`                    | 앱에 온 서비스 워커 스크립트 요청 수                                                                                             |
| `markerInEvidence`                | `evidence/` 두 파일에 합성 표식이 있는가                                                                                         |
| `deniedTargetInEvidence`          | 거부된 대상(호스트:포트)이나 그 호스트 이름이 `evidence/` 두 파일에 있는가(`127.0.0.1`, `localhost`, `::1`은 이름 검사에서 뺀다) |
| `markerFile`                      | 셸이 인자를 실행했을 때 생기는 표식 파일이 있는가                                                                                |
| `runningBeforeSignal`(`signal`만) | 신호를 보내기 직전에 같은 방법으로 센 프로세스 수(세는 방법이 그 프로세스들을 실제로 보는지 확인한다)                            |

| 사례 id                    | 내용                                                                                     | 기대                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `full-run`                 | `e2e/smoke.spec.ts`만 있을 때 인자 없이 실행                                             | 종료 코드 0, 시나리오 파일은 `e2e/smoke.spec.ts` 하나                         |
| `pass`                     | 통과하는 시나리오                                                                        | 종료 코드 0, 거부 0건                                                         |
| `exact-select`             | `e2e/sel/a.spec.ts`를 지정. 실패하는 `e2e/sel/more-e2e/sel/a.spec.ts`가 함께 있다        | 종료 코드 0, 시나리오 파일은 지정한 것 하나                                   |
| `console-error`            | 페이지가 `console.error`를 낸다                                                          | 종료 코드 1(콘솔 에러 1건 이상)                                               |
| `failed-request`           | 페이지가 앱의 없는 경로를 `fetch`한다(404)                                               | 종료 코드 1(실패한 요청 1건 이상)                                             |
| `allowed-request-only`     | 위 요청을 `allowFailedRequest`로만 선언                                                  | 종료 코드 1(404의 콘솔 에러가 남는다), 뺀 요청 1건                            |
| `allowed-failure`          | 요청은 `allowFailedRequest`로, 콘솔 에러는 `allowConsoleError`로 선언                    | 종료 코드 0, 뺀 요청 1건·뺀 콘솔 에러 1건                                     |
| `ws-same-port`             | `ws://127.0.0.1:<앱 포트>`로 웹소켓을 열고 앱이 받아 준다                                | 종료 코드 0, 거부 0건                                                         |
| `other-port`               | `http://127.0.0.1:<다른 포트>`를 `fetch`                                                 | 종료 코드 1, 거부 1건 이상                                                    |
| `localhost-port`           | 같은 요청을 `localhost` 이름으로                                                         | 종료 코드 1, 거부 1건 이상                                                    |
| `named-host`               | 같은 요청을 `ext.localhost` 이름으로                                                     | 종료 코드 1, 거부 1건 이상                                                    |
| `ipv6-loopback`            | 같은 요청을 `[::1]`로                                                                    | 종료 코드 1, 거부 1건 이상                                                    |
| `app-alias`                | 앱 포트를 다른 이름으로(`http://localhost:<앱 포트>`)                                    | 종료 코드 1, 거부 1건 이상                                                    |
| `https-other-port`         | `https://127.0.0.1:<TCP 서버 포트>`를 `fetch`                                            | 종료 코드 1, 거부 1건 이상                                                    |
| `external-name-http`       | `http://external.invalid/`를 `fetch`                                                     | 종료 코드 1, 거부 기록에 `external.invalid:80`                                |
| `external-name-https`      | `https://external.invalid/`를 `fetch`                                                    | 종료 코드 1, 거부 기록에 `external.invalid:443`                               |
| `redirect-out`             | 앱의 경로가 다른 서버로 302 리다이렉트                                                   | 종료 코드 1, 거부 1건 이상                                                    |
| `redirect-https-same-port` | 앱의 경로가 `https://127.0.0.1:<앱 포트>/`로 302 리다이렉트                              | 종료 코드 1, 거부 1건 이상                                                    |
| `websocket-out`            | 다른 서버로 웹소켓을 연다                                                                | 종료 코드 1, 거부 1건 이상                                                    |
| `wss-same-port`            | `wss://127.0.0.1:<앱 포트>`로 웹소켓을 연다                                              | 종료 코드 1, 거부 1건 이상                                                    |
| `service-worker`           | 다른 서버로 `fetch`하는 서비스 워커를 등록한다                                           | 종료 코드 0, 거부 0건, 워커 스크립트 요청 0건                                 |
| `allow-blocked`            | `other-port`의 요청과 콘솔 에러를 모든 것에 맞는 패턴으로 선언                           | 종료 코드 1, 거부 1건 이상                                                    |
| `no-fixture`               | `@playwright/test`의 `test`를 직접 쓴, 통과하는 시나리오                                 | 종료 코드 1(관찰 기록 없음)                                                   |
| `no-fixture-out`           | 직접 쓴 시나리오에서 다른 서버를 `fetch`                                                 | 종료 코드 1, 거부 1건 이상                                                    |
| `skipped`                  | 건너뛰게 표시한 시나리오                                                                 | 종료 코드 1(상태 `skipped`)                                                   |
| `marker`                   | 합성 표식을 화면·콘솔 에러·요청 경로와 쿼리·시나리오 제목·단언 문구·호스트 이름에 넣는다 | 종료 코드 1(상태 `failed`), 거부 기록에 `<표식>.invalid:80`, 요약에 표식 없음 |
| `node-request`             | 시나리오 코드가 Playwright의 `request`와 `page.request`로 다른 서버를 부른다             | 종료 코드 1, 거부 1건 이상                                                    |
| `signal`                   | 끝나지 않는 시나리오를 돌리다 `node scripts/harness.ts verify`에 SIGTERM을 보낸다        | 남은 프로세스 0                                                               |
| `shell-arg`                | `verify -- 'e2e/$(touch <표식 파일>).spec.ts'`                                           | 종료 코드 1, 표식 파일 없음, 아무것도 띄우지 않는다(증거 묶음 없음)           |

공통 기대(`check-results.ts verify-playwright`가 모든 사례에서 확인한다): `targetHits` 0, `leftover` 0, `evidenceFiles`는 `summary.json`과 `summary.md`뿐(`shell-arg`는 비어 있다), `markerInEvidence`와 `deniedTargetInEvidence`는 거짓, 워커 스크립트 요청 0건. 거부를 기대하는 사례는 `deniedTargets`에 그 사례의 대상 호스트:포트가 있어야 하고, fixture를 쓴 사례는 fixture도 그 요청을 적었어야 한다(`blocked` 1 이상). 거부를 기대하지 않는 사례는 거부 0건이어야 한다. 그 밖에 `tool.playwright`가 `1.65.0`, `bypass`가 `<-loopback>,http://127.0.0.1:<앱 포트>,ws://127.0.0.1:<앱 포트>`, `selfCheck`와 `traceOnlyInLocal`(스크린샷·trace·영상이 출력 폴더의 `local/` 아래에만 있고 trace가 하나 이상 있다)이 참인지 본다.

`node-request`는 step3 지시서의 표에 없던 사례다. 실물 확인을 하다 Playwright의 `request` fixture가 브라우저 실행 옵션의 프록시를 따르지 않고 다른 포트에 그대로 닿는 것을 보고, 설정의 컨텍스트 옵션에도 같은 프록시를 두고 사례로 남겼다.
