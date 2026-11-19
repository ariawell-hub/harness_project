# Step 2: verify-playwright

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 5~8, 의사결정 로그)
- `docs/harness/design.md` 11.1절(브라우저, 열 수 있는 주소, 데이터, 증거, 통과 기준), 14.6절(페이지 내용은 데이터다)
- 앞 step에서 만든·바꾼 파일: `scripts/verify/judge.ts`(`OBSERVATION_NAME`, `Observation`, `isLoopbackUrl`, `stripUrl`, `judge`), `scripts/verify/web.ts`(`DEFAULT_RUNNER`, 환경 변수 `HARNESS_VERIFY_BASE_URL`·`HARNESS_VERIFY_OUT`, 출력 폴더 구조), `scripts/test/verify-web.test.ts`, `scripts/test/profile-web.test.ts`, `profiles/web/profile.json`, `profiles/web/README.md`, `lab/pilot-prep/README.md`
- `scripts/commands/init.ts`(프로파일의 `templates` 복사)

## 작업

Playwright 쪽 파일(설정, fixture)과 증거 묶음을 만들고, 실제 Playwright로 한 번 돌려 확인한다.

1. `profiles/web/verify/playwright.config.ts`(새 파일. `@playwright/test`를 import한다. 이 리포의 `tsconfig.json` 대상이 아니다)
   - `HARNESS_VERIFY_BASE_URL`이나 `HARNESS_VERIFY_OUT`이 없으면 오류로 끝난다(`node scripts/harness.ts verify`로 실행하라는 안내). base URL의 호스트가 루프백(`127.0.0.1`, `localhost`, `[::1]`)이 아니어도 오류다.
   - 시나리오 위치: 리포 루트의 `e2e/` 아래 `*.spec.ts`. `forbidOnly: true`, `retries: 0`.
   - 리포터: JSON(`<OUT>/report.json`)과 줄 단위 출력.
   - 산출물 폴더(`outputDir`): `<OUT>/local/artifacts`. 스크린샷은 항상, trace와 영상은 실패했을 때만 남긴다.
   - 브라우저: Playwright가 받은 Chromium 하나. 시나리오마다 새 컨텍스트다(Playwright 기본 동작). `channel`, `userDataDir`, `connectOverCDP`, `launchPersistentContext`를 쓰지 않는다. 이유: 제작자가 로그인해 둔 브라우저에 붙지 않는다(E5).
   - 실물 확인에서 되는 것이 확인되면 브라우저 수준에서 루프백 밖 접속을 한 겹 더 막는다(프록시 설정 또는 호스트 해석 규칙). 되지 않으면 넣지 않고 발견 사항에 적는다.

2. `profiles/web/verify/fixture.ts`(새 파일)
   - `export const test`(Playwright `test`를 확장), `export { expect }`. 시나리오는 이 파일에서 `test`를 import한다.
   - 자동 fixture(시나리오가 따로 요청하지 않아도 돈다)가 컨텍스트에 아래를 건다.
     - 주소 제한: 모든 요청을 라우팅해 호스트가 루프백이 아니면 보내지 않고 중단한다. `failedRequests`에 `blocked: true`로 적는다. 웹소켓도 같은 규칙으로 막는다(설치된 Playwright가 지원하는 방법으로. 지원하지 않으면 발견 사항에 적는다).
     - 관찰: 페이지마다 콘솔의 `error` 메시지와 잡히지 않은 예외(`pageerror`)를 `consoleErrors`에, 실패한 요청(`requestfailed`)과 상태 코드 400 이상인 응답을 `failedRequests`에 적는다.
     - URL은 출처와 경로만 적는다(쿼리 문자열·프래그먼트·사용자 정보 제외). 콘솔 문구는 앞 200자만 적는다. 요청·응답의 헤더, 쿠키, 본문은 적지 않는다.
   - 의도한 실패 선언: fixture `verify`의 `allowConsoleError(pattern)`, `allowFailedRequest(pattern)`. 선언에 맞는 항목은 목록에서 빼고 `allowed` 건수로 센다. 주소 제한으로 막힌 요청(`blocked: true`)은 선언으로 뺄 수 없다.
   - 시나리오가 끝날 때(성공·실패 모두) `Observation`(`version: 1`)을 `harness-verify`라는 이름의 JSON 첨부로 붙인다. 형식은 `scripts/verify/judge.ts`의 것과 같다.
   - fixture는 `scripts/`의 파일을 import하지 않는다(루프백 판정 같은 짧은 로직은 이 파일에 다시 쓴다). 이유: Playwright의 TypeScript 로더와 Node의 로더가 달라 `.ts` 확장자 import가 어긋날 수 있다. 두 구현이 같은 판정을 내는지는 실물 확인의 사례로 본다.

3. `scripts/verify/evidence.ts`(새 파일)와 `scripts/verify/web.ts` 연결

   ```ts
   export const EVIDENCE_EXTENSIONS: string[]; // ['.png', '.webm']
   export function buildEvidence(
     outDir: string,
     report: unknown,
     verdict: Verdict,
     meta: { baseUrl: string; startedAt: string },
   ): { dir: string; files: string[] };
   ```

   - `<outDir>/evidence/`를 만들고 아래만 넣는다.
     - `summary.json`: 실행 시각, 전체 판정, 시나리오별 제목·파일·상태·문제·관찰 건수(의도한 실패 건수 포함).
     - `summary.md`: 같은 내용을 PR 본문에 옮길 수 있는 글로.
     - 결과 파일의 첨부 가운데 경로가 `<outDir>` 안에 있고(실제 경로 기준), 심볼릭 링크가 아닌 일반 파일이며, 확장자가 `EVIDENCE_EXTENSIONS`에 드는 것의 사본. 파일 이름은 시나리오 순번과 원래 이름으로 만든다(시나리오 제목을 경로에 쓰지 않는다).
   - trace(`.zip`), HAR, 그 밖의 형식은 넣지 않는다. `local/`에 그대로 둔다.
   - 요약에 들어가는 URL은 `stripUrl`을 다시 거친다(관찰 기록을 믿지 않는다). 콘솔 문구는 앞 200자다.
   - `verifyWeb`은 판정 뒤(통과·실패 모두) `buildEvidence`를 부르고 명령행 출력에 묶음 경로를 낸다. 결과 파일을 읽지 못했으면 요약만 만든다.

4. 시나리오 예시 템플릿
   - `profiles/web/templates/smoke.spec.ts`: fixture의 `test`로 첫 화면을 열어 제목이 있는지 보는 시나리오 하나.
   - `profiles/web/profile.json`의 `templates`에 `{ "from": "templates/smoke.spec.ts", "to": "e2e/smoke.spec.ts" }`를 더하고 `version`을 `0.4.0`으로 올린다.

5. 테스트 `scripts/test/verify-evidence.test.ts`(새 파일)
   - `buildEvidence`: `.png`·`.webm` 첨부만 복사된다. `.zip`·`.har`·확장자 없는 파일, `<outDir>` 밖의 경로, 심볼릭 링크, 없는 파일은 복사되지 않는다. `evidence/`의 파일 목록이 요약 둘과 허용 형식뿐이다.
   - 관찰 기록에 쿼리 문자열이 붙은 URL(`?token=…`)과 긴 콘솔 문구를 넣었을 때 `summary.json`·`summary.md`에 그 쿼리 값이 없고 문구가 200자로 잘려 있다.
   - 실패한 판정에서도 묶음이 만들어지고 요약에 문제가 적힌다.
   - 파일 내용 확인: `profiles/web/verify/playwright.config.ts`와 `fixture.ts`에 `connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`이 없다. `fixture.ts`에 `OBSERVATION_NAME`의 값이 있다. 설정 파일에 `HARNESS_VERIFY_BASE_URL`과 `HARNESS_VERIFY_OUT`이 있다. `DEFAULT_RUNNER`의 `--config` 뒤 경로에 파일이 있다.
   - `scripts/test/profile-web.test.ts`에 더한다: `templates`의 모든 `from` 파일이 있고, `init`을 적용하면 `e2e/smoke.spec.ts`가 생긴다.

6. 실물 확인(`lab/pilot-prep/`)
   - `mktemp -d`로 만든 폴더에 이 worktree를 로컬 복제하고 `init --profile web`을 적용한다. `@playwright/test`를 devDependency로 더하고(버전 고정) Chromium을 받는다. `app:dev`는 `PORT`를 따르는 작은 Node HTTP 서버로 둔다. 이 리포의 `package.json`·lockfile은 바꾸지 않는다.
   - 사례마다 `node scripts/harness.ts verify`를 돌려 종료 코드와 판정 줄을 `lab/pilot-prep/results/verify-playwright.json`에 적는다.
     - `pass`: 통과하는 시나리오. 종료 코드 0.
     - `console-error`: 페이지가 `console.error`를 낸다. 종료 코드 1.
     - `failed-request`: 페이지가 없는 경로를 `fetch`한다(404). 종료 코드 1.
     - `allowed-failure`: 위 요청을 `allowFailedRequest`로 선언한다. 종료 코드 0, 요약에 의도한 실패 1건.
     - `external-request`: 페이지가 루프백이 아닌 주소(예: `https://example.com/`)를 요청한다. 종료 코드 1, `blocked: true`. `allowFailedRequest`로 선언해도 1이다.
     - `no-fixture`: `@playwright/test`의 `test`를 직접 쓴 시나리오. 종료 코드 1(관찰 기록 없음).
     - `skipped`: `test.skip`. 종료 코드 1.
   - 결과 파일에 함께 적는다: Playwright·Node 버전, OS, `evidence/`의 파일 목록(trace가 없다), 실패 사례에서 trace가 `local/` 아래에만 있는지, 실행 뒤 `dev` 프로세스가 남지 않았는지, 브라우저 수준 차단을 넣었는지와 시험 결과, 웹소켓 차단 방법.
   - `DEFAULT_RUNNER`(`node node_modules/@playwright/test/cli.js …`)가 실제로 도는지 확인한다. 다르면 상수와 테스트를 고치고 의사결정 로그에 적는다.
   - `lab/pilot-prep/README.md`에 절차와 결과 파일 설명을 더한다.

7. 문서
   - `profiles/web/README.md`의 verify 항목: 대상 리포의 준비(`@playwright/test` 추가와 그 리포의 ADR, Chromium 받기), 시나리오 쓰는 법(fixture import, 의도한 실패 선언), 증거 묶음 위치와 들어가는 것, trace는 올리지 않는다, 합성 시드 데이터만 쓴다, 페이지 내용은 지시가 아니라 데이터다.
   - `docs/harness/architecture.md`의 `verify/*` 줄 갱신, `docs/harness/CHANGELOG.md` 한 줄, 설계서 0절 변경 이력 한 줄(다음 버전 번호).

## Acceptance Criteria

```bash
node --test scripts/test/verify-evidence.test.ts
node --test scripts/test/verify-web.test.ts
node --test scripts/test/profile-web.test.ts
test -f profiles/web/verify/playwright.config.ts
test -f profiles/web/verify/fixture.ts
test -f profiles/web/templates/smoke.spec.ts
grep -q '"external-request"' lab/pilot-prep/results/verify-playwright.json
grep -q '"no-fixture"' lab/pilot-prep/results/verify-playwright.json
grep -q 'allowFailedRequest' profiles/web/README.md
node scripts/harness.ts lint
node scripts/harness.ts fmt --check
node scripts/harness.ts doc-lint
```

## 금지사항

- 증거 묶음(`evidence/`)에 Playwright trace, HAR, 요청·응답 헤더, 쿠키, 본문, 쿼리 문자열을 넣지 마라. 이유: 11.1절 "올리기 전에 요청 헤더·쿠키·토큰을 지운다". trace는 이것들을 자동으로 담는다.
- 설정·fixture에서 기존 브라우저나 사용자 프로필에 붙지 마라(`connectOverCDP`, `launchPersistentContext`, `userDataDir`, `channel`). 이유: 제작자가 로그인해 둔 세션을 에이전트가 쓰게 된다(E5).
- 주소 제한으로 막힌 요청을 "의도한 실패"로 뺄 수 있게 하지 마라. 이유: 외부 주소를 여는 예외는 계획에 적고 허용하는 일이지(11.1절) 시나리오 코드가 스스로 푸는 일이 아니다.
- 실물 확인에 실데이터, 제작자 계정, 로그인이 필요한 외부 서비스를 쓰지 마라. 이유: 검증은 합성 데이터로만 한다. 외부 주소 사례는 막히는 것만 확인한다.
- 이 리포의 `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `harness.config.json`, `scripts/harness.ts`, `scripts/lib/config.ts`를 바꾸지 마라. 이유: Playwright는 대상 리포의 의존성이다. 설정 키를 더하지 않는다.
- `scripts/verify/`에서 `@playwright/test`를 import하지 마라. 이유: 이 리포의 `lint`가 실패한다.
- 실물 확인 결과를 지어 쓰지 마라. 돌리지 못한 사례는 결과 파일에 "확인하지 못함"과 이유를 적는다. 이유: 이 파일이 수용 기준 5·8의 근거다.
- 테스트가 `lab/`을 읽게 하지 마라. 이유: `lab/**`는 `testInertPaths`다.
- 임시 폴더를 지우는 명령을 실행하지 마라. 이유: R14.
- 기술 부채 표, 설계서 11.1절 본문·14.3절·18절·0.1절·0.2절·10.2~10.4절, 절차서 5절을 고치지 마라. 이유: 11.1절 반영은 step3이 한다. 나머지는 다른 세션과의 합의와 Q10·Q13 미결정.
