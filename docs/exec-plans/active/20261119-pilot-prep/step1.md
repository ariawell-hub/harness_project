# Step 1: verify-run

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 3~5, 의사결정 로그)
- `docs/harness/design.md` 6절(표준 명령 계약: 비대화식, 종료 코드, 시간 제한, `dev`는 띄운 쪽이 정리)과 11.1절
- `scripts/commands/standard.ts`(`runStandard`: `commands.verify.run`을 셸로 실행하고 추가 인자를 끝에 붙인다. `scripts/harness.ts`는 `--` 뒤의 인자만 추가 인자로 넘긴다: `node scripts/harness.ts verify -- e2e/a.spec.ts`)
- `scripts/lib/exec.ts`(`run`, `runShell`, `killTree`), `scripts/lib/config.ts`(`loadConfig`, `HarnessConfig`), `scripts/lib/git.ts`(`repoInfo`)
- `scripts/test/helpers.ts`
- 앞 step에서 만든·바꾼 파일: `profiles/web/profile.json`, `scripts/test/profile-web.test.ts`, `profiles/web/README.md`

## 작업

`verify` 표준 명령의 웹 구현 가운데 실행과 판정을 만든다. Playwright를 import하지 않는다. 시나리오 실행기는 명령(인자 배열)으로만 다룬다. Playwright 쪽 파일과 증거 묶음은 step2다.

1. `scripts/verify/judge.ts`(새 파일, 순수 함수)
   - `isLoopbackUrl(url: string): boolean`: `http:`·`https:`이고 호스트가 `127.0.0.1`, `localhost`, `[::1]` 가운데 하나일 때만 참. 해석하지 못하는 문자열은 거짓.
   - `stripUrl(url: string): string`: 출처와 경로만 남긴다(쿼리 문자열, 프래그먼트, 사용자 정보 제거). 해석하지 못하면 `'(해석 못 함)'`.
   - 관찰 기록 형식(fixture가 시나리오마다 `harness-verify`라는 이름의 JSON 첨부로 붙인다. step2의 fixture가 이 형식을 쓴다):
     ```ts
     export const OBSERVATION_NAME = 'harness-verify';
     export interface Observation {
       version: 1;
       consoleErrors: { text: string }[];
       failedRequests: { url: string; reason: string; blocked: boolean }[];
       /** 시나리오가 "의도한 실패"로 선언해 위 목록에서 뺀 건수 */
       allowed: { consoleErrors: number; failedRequests: number };
     }
     ```
   - `judge(report: unknown, runnerCode: number): Verdict`. `report`는 Playwright JSON 리포터의 결과다(`suites[].specs[].tests[].results[]`, `suites[].suites[]` 중첩, 최상위 `errors[]`). 시나리오 하나 = spec의 test 하나.
     ```ts
     export interface ScenarioVerdict {
       title: string;
       file: string;
       status: string;
       ok: boolean;
       problems: string[];
       observation: Observation | null;
     }
     export interface Verdict {
       ok: boolean;
       scenarios: ScenarioVerdict[];
       problems: string[];
     }
     ```
   - 판정 규칙(하나라도 걸리면 `ok: false`. 판단하지 못하면 실패다):
     - `report`가 객체가 아니거나 `suites`가 배열이 아니다. 최상위 `errors`가 비어 있지 않다.
     - 시나리오가 0개다.
     - 시나리오의 마지막 결과 상태가 `passed`가 아니다(`skipped` 포함).
     - 시나리오에 관찰 기록 첨부가 없거나, base64 본문을 JSON으로 읽지 못하거나, 위 형식이 아니다(`version`이 1이 아닌 것 포함).
     - 관찰 기록의 `consoleErrors`나 `failedRequests`가 비어 있지 않다.
     - `runnerCode`가 0이 아니다(모든 시나리오가 `passed`여도).
   - `problems`의 문장에는 URL을 `stripUrl`로 줄여 넣고 콘솔 문구는 앞 200자만 넣는다.

2. `scripts/verify/web.ts`(새 파일)

   ```ts
   export const DEFAULT_RUNNER: string[]; // node node_modules/@playwright/test/cli.js test --config profiles/web/verify/playwright.config.ts
   export interface VerifyOptions {
     runner?: string[];
     /** 실행기 끝에 붙일 시나리오 경로 */
     scenarios?: string[];
     readyTimeoutSec?: number; // 기본 120
     runnerTimeoutSec?: number; // 기본 900
   }
   export interface VerifyResult {
     ok: boolean;
     outDir: string;
     baseUrl: string;
     verdict: Verdict;
   }
   export async function verifyWeb(
     root: string,
     cfg: HarnessConfig,
     o?: VerifyOptions,
   ): Promise<VerifyResult>;
   ```

   - 순서: 출력 폴더 만들기 → 빈 포트 고르기 → `dev` 띄우기 → 준비 대기 → 실행기 → 결과 파일 읽기 → `judge` → `dev` 정리.
   - 출력 폴더: `<root>/.harness-verify/<YYYYMMDD-HHMMSS>-<pid>/`. 그 아래 `local/`(올리지 않는 것: `dev.log` 등). `.gitignore`에 `.harness-verify/`를 더한다.
   - `cfg.commands.dev`가 없으면 실패한다(무엇이 없는지와 고치는 법을 낸다).
   - 포트: `127.0.0.1`의 0번 포트로 잠깐 listen해 받은 번호. `baseUrl`은 `http://127.0.0.1:<포트>`.
   - `dev`: `cfg.commands.dev.run`을 셸로, 자기 프로세스 그룹으로 띄운다. 환경 변수 `PORT=<포트>`, `HOST=127.0.0.1`. 출력은 `local/dev.log`로 보낸다.
   - 준비 대기: `baseUrl`에 HTTP 응답(상태 코드 무관)이 올 때까지. 제한 시간을 넘거나 그 전에 `dev`가 끝나면 실패하고 `dev.log` 끝부분을 보인다.
   - 실행기: `runner`(기본 `DEFAULT_RUNNER`) 뒤에 `scenarios`를 붙여 셸 없이 실행한다(`cwd`는 `root`). 환경 변수 `HARNESS_VERIFY_BASE_URL=<baseUrl>`, `HARNESS_VERIFY_OUT=<출력 폴더>`. 실행기는 `<출력 폴더>/report.json`에 결과를 쓴다. 시간 초과는 실패다.
   - 정리: 성공, 실패, 예외, 시간 초과 어느 경우에도 `dev`의 프로세스 트리를 끝낸다(`killTree`, 남아 있으면 SIGKILL). 정리한 뒤에 돌아간다.
   - 명령행 진입(`node scripts/verify/web.ts [시나리오 경로…]`): `repoInfo`·`loadConfig`로 설정을 읽고 `verifyWeb`을 부른다. 시나리오별 한 줄(`✓`/`✗`, 제목, 문제)과 전체 문제, 출력 폴더를 stdout에 내고 종료 코드는 `ok ? 0 : 1`이다.
     - 추가 인자는 `-`로 시작하지 않고 `..` 구간이 없는 리포 안 상대 경로만 받는다. 그 밖의 인자는 실행하지 않고 종료 코드 1로 끝낸다. 이유: `--config` 같은 옵션으로 하네스의 Playwright 설정을 바꿔치지 못하게 한다.
     - SIGTERM·SIGINT를 받으면 `dev`를 정리하고 끝난다. 표준 명령의 시간 제한이 이 프로세스를 끝낼 때 `dev`가 남지 않게 한다.

3. `profiles/web/profile.json`
   - `commands.verify`: `{ "run": "node scripts/verify/web.ts", "timeoutSec": 1800 }`. `version`을 `0.3.0`으로 올린다.

4. 테스트 `scripts/test/verify-web.test.ts`(새 파일). 가짜 `dev`(환경 변수 `PORT`로 뜨는 작은 Node HTTP 서버)와 가짜 실행기(`$HARNESS_VERIFY_OUT/report.json`을 쓰는 Node 스크립트)를 임시 폴더에 만든다.
   - `judge`: 통과 사례 하나와, 위 판정 규칙의 각 항목마다 실패 사례 하나. `allowed` 건수는 실패가 아니다.
   - `isLoopbackUrl`: `http://127.0.0.1:3000/`, `http://localhost/`, `http://[::1]:8080/`은 참. `http://127.0.0.1.example.com/`, `http://localhost.example.com/`, `http://example.com@127.0.0.1.example.com/`, `file:///etc/hosts`, `http://192.168.0.2/`, 빈 문자열은 거짓.
   - `stripUrl`: 쿼리 문자열·프래그먼트·사용자 정보가 빠진다.
   - `verifyWeb`: 통과하면 `ok`이고 실행기가 받은 `HARNESS_VERIFY_BASE_URL`이 루프백이며 `HARNESS_VERIFY_OUT`이 출력 폴더다. 끝난 뒤 그 포트에 접속이 되지 않는다(`dev`가 정리됐다).
   - `dev`가 준비되지 않는 경우(제한 시간 1초), `dev`가 곧바로 끝나는 경우, 실행기가 시간 초과하는 경우, 실행기가 결과 파일을 쓰지 않는 경우: 모두 `ok: false`이고 `dev`가 남지 않는다.
   - `commands.dev`가 `null`이면 실패한다.
   - 명령행: 통과하면 종료 코드 0, 실패하면 1. `--config x` 같은 인자는 실행기를 띄우지 않고 1. 실행 중에 SIGTERM을 보낸 경우와 SIGINT를 보낸 경우 각각 `dev`가 남지 않는다.
   - `scripts/test/profile-web.test.ts`에 더한다: 웹 프로파일의 `commands.verify.run`이 `node scripts/verify/web.ts`이고 `commands.dev`가 `null`이 아니다.

5. 문서
   - `profiles/web/README.md`의 verify 항목: `app:dev`는 환경 변수 `PORT`와 `HOST`를 따라야 한다. 통과 기준. 출력 폴더.
   - `docs/harness/architecture.md`: `verify/*` 모듈 한 줄.
   - `docs/harness/CHANGELOG.md` 한 줄과 설계서 0절 변경 이력 한 줄(다음 버전 번호).

## Acceptance Criteria

```bash
node --test scripts/test/verify-web.test.ts
node --test scripts/test/profile-web.test.ts
grep -q '"node scripts/verify/web.ts"' profiles/web/profile.json
grep -q '^.harness-verify/$' .gitignore
grep -q 'scripts/verify' docs/harness/architecture.md
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
```

## 금지사항

- `scripts/verify/`에서 `@playwright/test`나 `playwright`를 import하지 마라. 이유: 이 리포에는 그 의존성이 없고 `lint`(tsc)가 실패한다. 코어 코드는 프로파일의 도구를 몰라도 된다(S5).
- `scripts/harness.ts`, `scripts/lib/config.ts`, `harness.config.json`, `scripts/commands/standard.ts`를 고치지 마라. 이유: 다른 세션과 겹치고, 이 계획은 설정 키를 더하지 않는다. `verify`는 `commands.verify.run`으로 연결된다.
- 실행기 명령이나 Playwright 설정 경로를 환경 변수·명령행 인자·설정 파일로 바꿀 수 있게 하지 마라. 이유: 검사를 약화시키는 길이 된다. 테스트는 `verifyWeb`의 함수 인자로만 가짜 실행기를 넣는다.
- `baseUrl`에 루프백이 아닌 주소를 쓸 수 있게 하지 마라. 이유: 11.1절 "worktree에서 띄운 로컬 앱 주소만 연다".
- 판단하지 못한 경우(결과 파일 없음, 형식 오류, 관찰 기록 없음)를 통과로 두지 마라. 이유: fail closed.
- `dev`의 출력이나 실행기의 출력을 증거로 올릴 자리에 쓰지 마라(`local/` 밖). 이유: 출력에 비밀이 섞일 수 있다.
- `scripts/test/` 아래 기존 테스트 파일(앞 step이 만든 `profile-web.test.ts` 제외)을 고치지 마라. 이유: 다른 세션과 겹친다.
- 테스트에서 `sleep`으로 고정 시간을 기다리지 마라. 이유: CI에서 흔들린다. 조건(포트 접속, 프로세스 종료)을 확인하며 기다린다.
- 기술 부채 표, 설계서 14.3절·18절·0.1절·0.2절·10.2~10.4절, 절차서 5절을 고치지 마라. 이유: 다른 세션과의 합의, Q10·Q13 미결정.
