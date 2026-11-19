# Step 1: verify-run

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 3~5, 의사결정 로그)
- `docs/harness/design.md` 6절(표준 명령 계약: 비대화식, 종료 코드, 시간 제한, `dev`는 띄운 쪽이 정리)과 11.1절
- `scripts/commands/standard.ts`(`runStandard`: `commands.<이름>.run`을 셸로 실행하고 추가 인자를 끝에 붙인다. 지금은 `JSON.stringify`로 인용한다. `scripts/harness.ts`는 `--` 뒤의 인자만 추가 인자로 넘긴다: `node scripts/harness.ts verify -- e2e/a.spec.ts`)
- `scripts/lib/exec.ts`(`run`은 자식을 자기 프로세스 그룹으로 띄우고 끝날 때까지 기다린다. 실행 중인 자식의 핸들은 돌려주지 않는다. `runShell`, `killTree`. 시간 제한을 넘기면 SIGTERM을 보내고 5초 뒤 SIGKILL을 보낸다)
- `scripts/lib/config.ts`(`loadConfig`, `HarnessConfig`), `scripts/lib/git.ts`(`repoInfo`), `scripts/test/helpers.ts`
- 앞 step에서 만든·바꾼 파일: `profiles/web/profile.json`, `scripts/test/profile-web.test.ts`, `profiles/web/README.md`

## 작업

표준 명령의 추가 인자 인용을 고치고, `verify` 웹 구현 가운데 실행과 판정을 만든다. Playwright를 import하지 않는다. 시나리오 실행기는 명령(인자 배열)으로만 다룬다. 웹 프로파일의 `commands.verify`는 이 step에서 켜지 않는다(step3). 거부 프록시와 증거 요약은 step2다.

1. `scripts/commands/standard.ts`의 추가 인자 인용
   - 추가 인자를 POSIX 셸의 작은따옴표로 인용해 붙인다: 인자를 `'…'`로 감싸고 안의 `'`는 `'\''`로 바꾼다. `JSON.stringify`(큰따옴표)는 쓰지 않는다. 이유: 큰따옴표 안에서는 셸이 `$(…)`·역따옴표·`$변수`를 푼다.
   - NUL 문자가 든 인자는 실행하지 않고 실패로 돌려준다.
   - 추가 인자가 없을 때의 명령 문자열과 그 밖의 동작(시간 제한, 환경 변수, `checkMode`)은 그대로다.

2. 테스트 `scripts/test/standard-args.test.ts`(새 파일)
   - 임시 폴더에 받은 인자를 JSON 한 줄로 파일에 쓰는 Node 스크립트를 만들고, 그 스크립트를 실행하는 명령 정의로 `runStandard`를 부른다.
   - 인자 `$(touch <표식 파일>)`, `` `touch <표식 파일>` ``, `a; touch <표식 파일>`, `a && touch <표식 파일>`, `$HOME`, `it's`, `say "hi"`, `a b`, `*.ts`, `e2e/[id].spec.ts`를 넘겼을 때 스크립트가 받은 인자가 글자 그대로이고 표식 파일이 생기지 않는다. 표준 명령 실행기는 어떤 인자든 그대로 넘긴다(`verify`가 받는 경로를 좁히는 것은 아래 3의 `isScenarioPath`다).
   - 명령행으로도 확인한다: 그 명령 정의를 `commands.verify`로 둔 픽스처 리포에서 `node scripts/harness.ts verify -- '$(touch <표식 파일>)'`를 실행하면 스크립트가 그 문자열을 그대로 받고 표식 파일이 없다.
   - 추가 인자가 없으면 실행된 명령 문자열이 명령 정의와 같다.

3. `scripts/verify/judge.ts`(새 파일, 순수 함수)
   - 관찰 기록 형식(fixture가 시나리오마다 `harness-verify`라는 이름의 JSON 첨부로 붙인다. step3의 fixture가 이 형식을 쓴다):
     ```ts
     export const OBSERVATION_NAME = 'harness-verify';
     export interface Observation {
       version: 1;
       /** 콘솔의 error 메시지와 잡히지 않은 예외 */
       consoleErrors: { text: string }[];
       /** 실패한 요청, 상태 코드 400 이상인 응답, 앱 주소 밖으로 가려던 요청(blocked) */
       failedRequests: { url: string; reason: string; blocked: boolean }[];
       /** 시나리오가 "의도한 실패"로 선언해 위 목록에서 뺀 건수 */
       allowed: { consoleErrors: number; failedRequests: number };
     }
     ```
   - `export function isScenarioPath(p: string): boolean`: `e2e/`로 시작하고 `.spec.ts`로 끝나며, 영문자·숫자·`.`·`_`·`-`·`/`만으로 되어 있고, `/`로 나눈 구간이 모두 영문자나 숫자로 시작하는 상대 경로면 참이다(빈 구간, `.`, `..`, 점이나 `-`로 시작하는 구간은 거짓). 이 규칙에 맞는 경로는 정규화해도 바뀌지 않으므로, 지정한 경로와 보고서에서 얻은 리포 기준 경로를 글자 그대로 비교한다. 명령행 인자 검사(아래 4)와 증거 요약의 경로 표시(step2)가 이 함수 하나를 쓴다.
   - `judge(report: unknown, runnerCode: number, o: { root: string; scenarios?: string[] }): Verdict`. `report`는 Playwright JSON 리포터의 결과다(`config.rootDir`, `suites[].specs[].tests[].results[]`, `suites[].suites[]` 중첩, 최상위 `errors[]`). 시나리오 하나 = spec의 test 하나. `ScenarioVerdict.file`은 리포 루트 기준 상대 경로(`/` 구분)다: 보고서의 파일 경로는 `config.rootDir`(시나리오 폴더) 기준이므로 그것을 이어 붙인 뒤 `o.root` 기준으로 바꾼다.
     ```ts
     export interface ScenarioVerdict {
       file: string;
       line: number;
       title: string;
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
     - `config.rootDir`이 문자열이 아니거나 시나리오의 파일이 리포 루트 밖이다.
     - `o.scenarios`가 있는데 시나리오들의 파일 집합이 그것과 같지 않다(지정하지 않은 파일의 시나리오가 있다, 지정한 파일의 시나리오가 없다).
     - 시나리오의 마지막 결과 상태가 `passed`가 아니다(`skipped` 포함).
     - 시나리오에 관찰 기록 첨부가 없거나, base64 본문을 JSON으로 읽지 못하거나, 위 형식이 아니다(`version`이 1이 아닌 것 포함).
     - 관찰 기록의 `consoleErrors`나 `failedRequests`가 비어 있지 않다.
     - `runnerCode`가 0이 아니다(모든 시나리오가 `passed`여도).
   - `problems`는 에이전트가 로컬에서 원인을 보는 용도다(콘솔 문구와 URL이 들어간다). 공개 증거에는 쓰지 않는다(step2).

4. `scripts/verify/web.ts`(새 파일)

   ```ts
   export const DEFAULT_RUNNER: string[]; // node node_modules/@playwright/test/cli.js test --config profiles/web/verify/playwright.config.ts
   export interface VerifyOptions {
     runner?: string[];
     /** 실행할 시나리오 파일(리포 기준 상대 경로). 없으면 전부 */
     scenarios?: string[];
     readyTimeoutSec?: number; // 기본 120
     runnerTimeoutSec?: number; // 기본 900
     /** 중단 신호. 끊기면 띄운 것을 정리하고 실패로 돌아간다 */
     signal?: AbortSignal;
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

   - 순서: 출력 폴더 만들기 → 빈 포트 고르기 → `dev` 띄우기 → 준비 대기 → 실행기 → 결과 파일 읽기 → `judge` → 정리.
   - `root`는 실제 경로(`realpath`)로 바꿔서 쓴다(실행기의 `cwd`, `judge`의 `o.root`, 출력 폴더). 이유: 보고서의 `config.rootDir`는 실행기가 본 실제 경로라서, 심볼릭 링크를 낀 경로(macOS의 임시 폴더)를 그대로 쓰면 리포 기준 경로가 어긋난다.
   - 출력 폴더: `<root>/.harness-verify/<YYYYMMDD-HHMMSS>-<pid>/`. 그 아래 `local/`(올리지 않는 것: `dev.log`, 실행기 출력 등). `.gitignore`에 `.harness-verify/`를 더한다.
   - `cfg.commands.dev`가 없으면 실패한다(무엇이 없는지와 고치는 법을 낸다).
   - 포트: `127.0.0.1`의 0번 포트로 잠깐 listen해 받은 번호. `baseUrl`은 `http://127.0.0.1:<포트>`이고 다른 값을 받는 길이 없다.
   - `dev`: `cfg.commands.dev.run`을 셸로, 자기 프로세스 그룹으로 띄운다. 환경 변수 `PORT=<포트>`, `HOST=127.0.0.1`. 출력은 `local/dev.log`로 보낸다.
   - 준비 대기: `baseUrl`에 HTTP 응답(상태 코드 무관)이 올 때까지. 제한 시간을 넘거나 그 전에 `dev`가 끝나면 실패하고 `dev.log` 끝부분을 보인다.
   - 실행기: `runner`(기본 `DEFAULT_RUNNER`)를 인자를 더 붙이지 않고 셸 없이, 자기 프로세스 그룹으로 띄운다(`cwd`는 `root`). 환경 변수 `HARNESS_VERIFY_BASE_URL=<baseUrl>`, `HARNESS_VERIFY_OUT=<출력 폴더>`, 그리고 `scenarios`가 있으면 `HARNESS_VERIFY_SCENARIOS=<경로들의 JSON 배열>`(없으면 이 변수를 지운다. 바깥에서 물려받은 값을 쓰지 않는다). 실행기는 `<출력 폴더>/report.json`에 결과를 쓴다. 출력은 `local/runner.log`로 보낸다.
   - `scenarios`의 경로가 `isScenarioPath`에 맞지 않거나 `root` 아래의 일반 파일이 아니면(없음, 폴더, 심볼릭 링크) 아무것도 띄우지 않고 실패한다. 같은 경로를 두 번 주면 하나로 본다. 실행 뒤 `judge`에 `root`와 `scenarios`를 넘겨 결과의 파일 집합을 확인한다. 집합이 글자 그대로 같지 않으면 실패다(대소문자만 다른 이름처럼 비교할 수 없는 경우도 통과로 두지 않는다).
   - **정리 계약**: `dev`와 실행기 둘 다 실행 중인 자식의 핸들을 쥐고 있어야 한다(`scripts/lib/exec.ts`의 `run`은 핸들을 주지 않으므로 그대로는 쓸 수 없다). 정상 종료, 판정 실패, 예외, 실행기 시간 초과, 중단 신호 어느 경우에도 돌아가기 전에 실행기의 프로세스 트리와 `dev`의 프로세스 트리를 끝낸다: 그룹에 SIGTERM → 2초 안에 끝나지 않으면 SIGKILL → 두 트리가 끝난 것을 확인. 중단 신호를 받은 때부터 4초 안에 돌아간다. 이유: 표준 명령의 시간 제한은 SIGTERM 5초 뒤에 SIGKILL을 보낸다. 그 전에 정리를 마쳐야 한다.
   - 명령행 진입(`node scripts/verify/web.ts [시나리오 경로…]`): `repoInfo`·`loadConfig`로 설정을 읽고 `verifyWeb`을 부른다. 시나리오별 한 줄(`✓`/`✗`, 파일:줄, 제목, 문제)과 전체 문제, 출력 폴더를 stdout에 내고 종료 코드는 `ok ? 0 : 1`이다.
     - 추가 인자는 `isScenarioPath`에 맞는 경로만 받아 `scenarios`로 넘긴다. 그 밖의 인자가 하나라도 있으면 아무것도 띄우지 않고 종료 코드 1로 끝낸다. 이유: 옵션(`--config` 등)이나 정규식으로 해석될 문자가 실행기에 닿지 않게 한다.
     - SIGTERM·SIGINT를 받으면 중단 신호를 끊어 위 정리 계약대로 끝내고 종료 코드 1로 나간다.

5. 테스트 `scripts/test/verify-web.test.ts`(새 파일). 가짜 `dev`(환경 변수 `PORT`로 뜨는 작은 Node HTTP 서버)와 가짜 실행기(`$HARNESS_VERIFY_OUT/report.json`을 쓰는 Node 스크립트)를 임시 폴더에 만든다.
   - `judge`: 통과 사례 하나와, 위 판정 규칙의 각 항목마다 실패 사례 하나. `allowed` 건수는 실패가 아니다.
   - `verifyWeb`: 통과하면 `ok`이고 실행기가 받은 `HARNESS_VERIFY_BASE_URL`이 `http://127.0.0.1:<포트>` 꼴이며 `HARNESS_VERIFY_OUT`이 출력 폴더다. 끝난 뒤 그 포트에 접속이 되지 않고 `dev`의 pid가 없다.
   - 시나리오 지정: `scenarios: ['e2e/a.spec.ts']`로 부르면 가짜 실행기가 받은 명령행 인자는 `runner` 그대로이고(더 붙은 것이 없다) `HARNESS_VERIFY_SCENARIOS`가 그 배열이다. 지정하지 않으면 그 변수가 없다(테스트 프로세스의 환경에 그 변수가 있어도). 가짜 실행기가 다른 파일(`e2e/sub-e2e/a.spec.ts`)의 시나리오까지 담은 통과 결과를 쓰면 `ok: false`다. 지정한 파일의 시나리오가 결과에 없어도 `ok: false`다. 리포에 없는 파일을 지정하면 `dev`도 실행기도 띄우지 않고 실패한다.
   - `isScenarioPath`: `e2e/a.spec.ts`, `e2e/sub/a-b_c.spec.ts`는 참. `e2e/./a.spec.ts`, `e2e/.hidden/a.spec.ts`, `e2e/-x/a.spec.ts`, `e2e/[id].spec.ts`, `e2e/(shop)/a.spec.ts`, `e2e/a b.spec.ts`, `e2e/../a.spec.ts`, `e2e//a.spec.ts`, `/abs/e2e/a.spec.ts`, `src/a.spec.ts`, `e2e/a.spec.tsx`, `--config`는 거짓.
   - 경로 비교: `scenarios: ['e2e/a.spec.ts', 'e2e/a.spec.ts']`(중복)는 한 번 지정한 것과 결과가 같다. 심볼릭 링크인 시나리오 파일을 지정하면 띄우지 않고 실패한다. 임시 폴더를 가리키는 심볼릭 링크를 `root`로 주어도 통과 결과가 `ok`이고 `ScenarioVerdict.file`이 `e2e/a.spec.ts`다(가짜 실행기는 보고서의 `config.rootDir`를 자기 `process.cwd()` 아래 `e2e`로 쓴다). 명령행에 `e2e/./a.spec.ts`를 주면 `dev`도 실행기도 띄우지 않고 종료 코드 1이다.
   - `dev`가 준비되지 않는 경우(제한 시간 1초), `dev`가 곧바로 끝나는 경우, 실행기가 결과 파일을 쓰지 않는 경우, 실행기가 깨진 JSON을 쓰는 경우: 모두 `ok: false`이고 `dev`가 남지 않는다.
   - 실행기 시간 초과: 가짜 실행기가 손자 프로세스를 하나 띄우고 두 pid를 파일에 적은 뒤 끝나지 않는다. `runnerTimeoutSec: 1`로 부르면 `ok: false`이고 실행기·손자·`dev`의 pid가 모두 없다.
   - `commands.dev`가 `null`이면 실패한다.
   - 명령행: 통과하면 종료 코드 0, 실패하면 1. `--config x`, `../e2e/a.spec.ts`, `e2e/../a.spec.ts`, `src/a.ts`, `e2e/$(x).spec.ts`, `e2e/a b.spec.ts` 같은 인자는 `dev`도 실행기도 띄우지 않고 1.
   - 신호: 위의 "끝나지 않는 실행기"로 명령행을 띄우고, 실행기가 pid 파일을 쓴 것을 확인한 뒤 SIGTERM을 보낸 경우와 SIGINT를 보낸 경우 각각, 명령행 프로세스가 4초 안에 끝나고 실행기·손자·`dev`의 pid가 모두 없다.

6. 문서
   - `docs/harness/architecture.md`: `verify/*` 모듈 한 줄, `commands/standard.ts`의 추가 인자 인용 한 줄(해당 줄이 있으면 고친다).
   - `docs/harness/CHANGELOG.md` 한 줄(추가 인자 인용이 바뀐 것을 적는다: `$변수`를 인자에 넣어 셸이 풀게 하던 사용은 더 되지 않는다)과 설계서 0절 변경 이력 한 줄(다음 버전 번호).

## Acceptance Criteria

```bash
node --test scripts/test/standard-args.test.ts
node --test scripts/test/verify-web.test.ts
node --test scripts/test/cli.test.ts
node --test scripts/test/profile-web.test.ts
grep -q '^\.harness-verify/$' .gitignore
grep -q 'scripts/verify' docs/harness/architecture.md
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
```

## 금지사항

- 추가 인자를 큰따옴표로 인용하거나 인용 없이 셸 명령에 붙이지 마라. 이유: 셸이 `$(…)`를 실행한다(계획 검증 F4). 파일 이름은 PR 작성자가 정하는 데이터다.
- 시나리오 경로를 실행기의 명령행 인자로 붙이지 마라. 이유: Playwright는 파일 인자를 정규식으로 해석해 경로가 겹치는 다른 파일까지 고른다(계획 검증 F15). 환경 변수로 넘기고 결과의 파일 집합을 확인한다.
- 웹 프로파일의 `commands.verify`를 이 step에서 켜지 마라. 이유: `DEFAULT_RUNNER`가 가리키는 Playwright 설정 파일은 step3에서 생긴다. 그 전에 켜면 표준 `verify`가 돌지 못하는 상태로 병합된다(F7).
- 신호·시간 초과에서 `dev`만 정리하고 실행기 트리를 남기지 마라. 이유: Playwright와 브라우저가 남는다(F8).
- `scripts/verify/`에서 `@playwright/test`나 `playwright`를 import하지 마라. 이유: 이 리포에는 그 의존성이 없고 `lint`(tsc)가 실패한다. 코어 코드는 프로파일의 도구를 몰라도 된다(S5).
- `scripts/harness.ts`, `scripts/lib/config.ts`, `harness.config.json`을 고치지 마라. 이유: 다른 세션과 겹치고, 이 계획은 설정 키를 더하지 않는다.
- 실행기 명령, Playwright 설정 경로, `baseUrl`을 환경 변수·명령행 인자·설정 파일로 바꿀 수 있게 하지 마라. 이유: 검사를 약화시키는 길이 된다. 테스트는 `verifyWeb`의 함수 인자로만 가짜 실행기를 넣는다.
- 판단하지 못한 경우(결과 파일 없음, 형식 오류, 관찰 기록 없음)를 통과로 두지 마라. 이유: fail closed.
- `scripts/test/` 아래 기존 테스트 파일(앞 step이 만든 `profile-web.test.ts` 제외)을 고치지 마라. 이유: 다른 세션과 겹친다. 인용 변경으로 기존 테스트가 깨지면 멈추고 진행 로그에 적은 뒤 계획을 고친다.
- 테스트에서 `sleep`으로 고정 시간을 기다리지 마라. 이유: CI에서 흔들린다. 조건(포트 접속, pid 파일, 프로세스 종료)을 확인하며 기다린다.
- 기술 부채 표, 설계서 14.3절·18절·0.1절·0.2절·10.2~10.4절, 절차서 5절을 고치지 마라. 이유: 다른 세션과의 합의, Q10·Q13 미결정.
