---
id: 20261123-codex-usage-limit
issue: 223 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-23T12:40:42+09:00 # new-task가 채운다
---

# Codex 사용 한도로 판정이 없으면 이유와 풀리는 시각을 상태 설명과 알림에 적는다 (TD-50)

## 목표와 수용 기준

Codex 계정이 사용 한도에 걸리면 `review/codex`가 "판정 없음(판정 job 실패 또는 유출 검사 불통과)"(error)으로 남고 모든 PR이 멈춘다(TD-50). 틀린 통과는 없지만, 이유와 풀리는 시각은 판정 job 로그를 열어야 보인다. 기록 job은 판정 job의 로그를 읽을 권한이 없고 판정 출력(`verdict`)이 비었다는 것만 안다.

제작자 결정(2026-11-23 대화): **기다림 + 알림**. 한도가 풀릴 때까지 병합하지 않는다(상태는 지금처럼 error, fail-closed). 한도 오류에는 판정을 다시 돌리지 않는다. 대신 이유와 풀리는 시각을 커밋 상태 설명과 runner 알림에 적는다. 이유를 넘기는 길은 **판정 job의 새 출력 하나**다(제작자가 2026-11-23 대화에서 골랐다. 판정 출력에 표식을 싣는 길은 버렸다. 의사결정 로그).

수용 기준:

1. `codex-scan`이 옵션 `--unavailable-out <파일>`을 받는다. 실행 기록의 마지막 `turn.failed` 오류 문구에서 사용 한도를 알아보면, 지금처럼 판정 없이 종료 코드 1로 끝나되 그 파일에 값 한 줄을 쓴다. 값은 `usage-limit` 또는 `usage-limit@YYYY-MM-DDTHH:MMZ`(풀리는 시각, UTC) 둘 가운데 하나뿐이다. 실패로 끝나는 경로에서 `GITHUB_OUTPUT`에는 지금처럼 아무것도 쓰지 않는다(#143의 약속: 판정을 내보내지 못하면 job 출력을 쓰지 않는다). 명령을 자식 프로세스로 실행하는 테스트로 아래를 확인한다.
   - 한도 문구와 "try again at Nov 21st, 2026 8:36 AM": 파일 내용 `usage-limit@2026-11-21T08:36Z`, 종료 코드 1, 판정 파일 없음, `GITHUB_OUTPUT`에 쓴 줄 없음.
   - 한도 문구에 시각이 없거나 읽을 수 없는 시각(없는 날짜, 다른 표기): 파일 내용 `usage-limit`.
   - 한도가 아닌 `turn.failed`, 그 밖의 실패(비밀 값, 허용 밖 항목, 판정 형식 오류), 통과한 판정: 파일을 만들지 않는다.
   - 한도 문구에 비밀 값이나 줄바꿈·제어 문자가 섞여도 파일 내용은 위 형식뿐이다(오류 문구 원문은 들어가지 않는다).
2. 새 명령 `codex-unavailable --file <파일>`이 그 파일을 읽어, 내용이 수용 기준 1의 형식이면 `GITHUB_OUTPUT`에 `unavailable=<값>` 한 줄을 덧붙인다. 파일이 없거나 형식이 아니면(앞뒤 공백·줄바꿈만 다른 것은 받는다, 둘째 줄이 있으면 받지 않는다) 아무것도 쓰지 않는다. 종료 코드는 언제나 0이다(이 단계의 실패가 판정 job의 다른 단계를 바꾸지 않게). `GITHUB_OUTPUT`이 없으면(로컬) 쓰지 않는다. 자식 프로세스 테스트로 확인한다.
3. `record-review`가 옵션 `--unavailable <값>`을 받는다. 판정이 없을 때(판정 파일이 없거나 비었다)만 이 값을 본다.
   - 값이 수용 기준 1의 형식이면 상태는 error이고 설명은 사용 한도와 풀리는 시각(UTC)을 적는다. 예: `판정 없음: 검증자 사용 한도(풀림 2026-11-21 08:36 UTC). 풀린 뒤 판정 워크플로를 다시 실행한다`. 시각이 없으면 "풀리는 시각 모름"을 적는다.
   - 값이 비었거나 형식이 아니면(앞뒤 공백, 다른 글, 없는 날짜) 지금 설명 그대로다.
   - 판정이 있으면 값을 무시한다(판정 검사·기록이 지금과 같다). `--needed false`와 이어받기 경로도 지금과 같다.
   - `scripts/test/record.test.ts`가 단언한다.
4. runner의 CI 대기 알림(`scripts/runner/run.ts`의 `doReportStall`)은 기다리는 체크의 설명을 지금처럼 적고, "사람이 결정할 것"의 A)(추천)를 세 경우로 나눠 적는다. 판별은 기다리는 체크의 설명이 수용 기준 3의 한도 설명인가로 한다(판별 함수는 기록 쪽과 함께 쓴다). `scripts/test/runner-pr.test.ts`가 세 경우를 단언한다.
   - 풀리는 시각이 있는 한도 설명이 있다: `A) 풀리는 시각(<YYYY-MM-DD HH:MM> UTC) 뒤에 판정 워크플로를 다시 실행한다(추천). 판정이 기록되면 runner가 이어 간다.` 시각이 여럿이면 가장 늦은 것을 적는다.
   - 시각을 모르는 한도 설명만 있다: `A) 검증자 사용 한도가 풀렸는지 확인한 뒤(\`docs/SECURITY.md\`) 판정 워크플로를 다시 실행한다(추천). 판정이 기록되면 runner가 이어 간다.`
   - 한도 설명이 없다: 지금 글 그대로(`A) Actions에서 멈춘 워크플로를 다시 실행한다(추천). …`).
   - 세 경우 모두 B)·C)와 "runner는 판정 워크플로를 다시 실행하지 않는다"는 그대로다. runner는 판정 워크플로를 다시 실행하지 않는다(지금과 같다).
5. `judge-codex.yml`(제작자 커밋, `docs/SECURITY.md` "워크플로 변경 절차"). 값이 없으면 지금처럼 돈다. 다른 job·단계·권한·environment는 바뀌지 않는다. `scripts/test/ci.test.ts`가 아래를 단언한다.
   - `scan` 단계의 `codex-scan` 명령에 `--unavailable-out "$RUNNER_TEMP/codex-unavailable.txt"`가 붙는다.
   - `scan` 바로 뒤, 봉인(`seal`) 앞에 단계 `why`가 있고 조건은 `always() && steps.scan.outcome == 'failure'`, 명령은 `codex-unavailable --file "$RUNNER_TEMP/codex-unavailable.txt"`다. 비밀·환경 변수를 받지 않는다.
   - `judge` job의 출력에 `unavailable: ${{ steps.why.outputs.unavailable }}`가 있다.
   - `record` job의 `record-review` 단계가 `needs.judge.outputs.unavailable`을 환경 변수로 받아 `--unavailable`로 넘긴다.
6. 자격증명 없이 잇는 확인(병합 전, 판정 F1·F3): 새 테스트 `scripts/test/usage-limit-cli.test.ts`가 세 명령을 모두 실제 명령(자식 프로세스)으로 잇는다. 고정된 한도 실행 기록(사용 한도 문구의 `turn.failed`)으로 `codex-scan`(종료 코드 1, 값 파일) → `codex-unavailable`(그 파일 → `GITHUB_OUTPUT`의 `unavailable=` 줄) → 그 줄의 값을 `--unavailable`로 받은 `record-review`(빈 판정 파일, 로컬 가짜 GitHub API. `scripts/test/accept-cli.test.ts`와 같은 꼴)까지 돌리고, 가짜 API가 받은 `review/codex` 상태가 error이며 설명에 사용 한도와 풀리는 시각이 있는지 단언한다. 시각을 모르는 한도와 한도가 아닌 실패(설명이 지금 그대로)도 같은 길로 본다. GitHub이 실패한 job의 출력을 다음 job에 넘기는 것은 이 리포의 봉인·저장 경로가 이미 쓰는 동작이다: 실행 44542064356(2026-11-19)에서 `judge` job이 `scan` 단계에서 실패했고, `if: always()`인 `seal` 단계의 출력(`sealed`)을 받아 `store` job이 돌아 성공했다. `why` 단계는 같은 꼴이다(실패한 `scan` 단계의 출력에 기대지 않는다).
7. 병합되는 head에는 워크플로 변경과 그것을 단언하는 구조 테스트가 함께 있다. step의 AC는 워크플로 변경이 없는 트리(push 1의 head)에 구조 테스트를 더하면 실패한다(새 단언). 진행 로그에 그 실패를 적는다.
8. 문서: 설계서 10.1절 "검증자 장애"(사용 한도는 다시 돌리지 않고 풀리는 시각을 적는다)와 10.4절 판정 job 출력, `CHANGELOG`, 기술 부채 표(TD-50 해결, TD-56에 상태 설명으로 한도를 가를 수 있게 됐다는 것). Claude 검증자에서 같은 일이 어떻게 보이는지 조사한 결과를 발견 사항에 적고, 같은 방식으로 할지는 새 TD로 남긴다.

## 범위 / 비범위

범위:

- `scripts/ci/codex-scan.ts`(한도 인식과 풀리는 시각 읽기), `scripts/harness.ts`(`codex-scan`의 `--unavailable-out`, 새 명령 `codex-unavailable`, `record-review`의 `--unavailable` 옵션), `scripts/ci/record.ts`(`recordReview`의 설명과 한도 설명 판별), `scripts/runner/run.ts`(`doReportStall`의 추천 글).
- 테스트: `scripts/test/scan-output.test.ts`, `scripts/test/codex-scan.test.ts`, `scripts/test/record.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/usage-limit-cli.test.ts`(새 파일).
- `.github/workflows/judge-codex.yml`: `scan` 명령의 인자 하나, 새 단계 `why` 하나, `judge` job 출력 한 줄, `record-review` 단계의 환경 변수 한 줄과 인자 하나. **제작자가 커밋한다.** 봇은 패치 파일로 준비한다(`lab/codex-usage-limit/`).
- 문서와 기술 부채 표.

비범위:

- 상태를 error 말고 다른 값으로 바꾸기, 한도 동안 다른 검증자로 대신하기, 위험도 낮음 PR의 Codex 판정 면제(제작자 결정: 검증을 약화하지 않는다).
- `judge-claude.yml`과 `claude-scan`(조사만 하고 새 TD로 남긴다).
- 지표 집계(`scripts/metrics/`)가 한도 횟수를 세게 하기(TD-56으로 남긴다).
- 판정 워크플로를 자동으로 다시 실행하기, 한도가 가까워진 것을 미리 알리기.

## 관련 파일·문서

- `scripts/ci/codex-scan.ts`, `scripts/ci/record.ts`, `scripts/harness.ts`, `scripts/runner/run.ts`
- `scripts/test/scan-output.test.ts`, `scripts/test/codex-scan.test.ts`, `scripts/test/record.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/usage-limit-cli.test.ts`
- `.github/workflows/judge-codex.yml`(제작자 커밋)
- `lab/codex-usage-limit/`(워크플로 패치와 적용 방법)
- `docs/harness/design.md`, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`, `docs/SECURITY.md`
- 읽기만: `scripts/ci/claude-scan.ts`, `scripts/ci/verdict.ts`, `scripts/ci/results.ts`, `scripts/runner/next.ts`, `scripts/runner/pr-state.ts`, `.github/workflows/judge-claude.yml`, `docs/exec-plans/completed/20261119-repro-on-demand/`

## step 목록

- step0 usage-limit: `codex-scan`의 한도 값 파일과 `codex-unavailable`의 출력, `record-review`의 설명, runner 알림의 추천, 워크플로 변경(제작자 커밋), 구조 테스트, 문서를 한 PR로 올린다.

## 진행 로그

- 2026-11-23 접수: 제작자가 대화에서 방향(기다림 + 알림)을 정했고 봇이 Issue #223을 등록했다. 이 세션은 제작자가 "안전하게 지금 바로 맡을 수 있는 부분부터 진행하라"고 해 `new-task`로 시작했다. 이유를 넘기는 길(새 job 출력 / 판정 출력의 표식)은 보안 경계라 대화에서 물었고 제작자가 새 job 출력을 골랐다.
- 2026-11-23 지금 동작을 읽었다(main `e9f7ad6`): `codex-scan`은 `turn.failed`면 오류 문구(300자, 비밀은 가림)를 로그에만 남기고 종료 코드 1로 끝난다. 그래서 `scan` 단계가 실패하고 `verdict` 출력이 비어, `record-review`가 "판정 없음(판정 job 실패 또는 유출 검사 불통과)"을 쓴다. runner는 이 상태를 `infra-error`로 기다리다가 24시간(`limits.ciStallHours`) 뒤 `needs-human`으로 한 번 알리고, 그 글에 기다리는 체크의 설명을 적는다. 판정 워크플로를 다시 실행하는 코드는 없다(`doReportStall`의 글 "runner는 판정 워크플로를 다시 실행하지 않는다").
- 2026-11-23 계획만 담은 커밋(`6d44d3a`)을 초안 PR #229로 올렸다(`check`는 계획 폴더만 바뀌어 `test`를 건너뛰고 통과).
- 2026-11-23 계획 검증 1라운드(head `6d44d3a`): claude 승인(지적 없음), codex 수정 요청(P1 2). 둘 다 받아들였다.
  - F1(P1): 종료 코드 1로 끝난 `scan` 단계의 출력이 기록 job까지 가는지 병합 전에 확인하지 않고 병합 뒤 첫 한도로 미뤘다. 넘어가지 않으면 AC가 모두 통과해도 설명이 지금 그대로다. → 실패한 단계의 출력에 기대지 않게 바꿨다: `codex-scan`은 한도 값을 파일에만 쓰고, 그 뒤의 `if: always() && steps.scan.outcome == 'failure'` 단계 `why`(새 명령 `codex-unavailable`)가 성공하며 job 출력을 쓴다. 실패한 job의 출력이 다음 job에 가는 것은 봉인·저장 경로가 이미 쓰는 동작이고 실행 44542064356에서 확인했다(`judge` 실패, `seal` 출력으로 `store` 성공). 고정된 한도 실행 기록으로 `codex-scan` → `codex-unavailable` → `recordReview`를 자격증명 없이 잇는 테스트를 수용 기준 6에 넣었다.
  - F2(P1): 시각을 모르는 한도에서 runner가 권할 행동이 정해지지 않았다. → 시각이 있는 한도, 시각을 모르는 한도, 한도가 아닌 경우의 추천 글을 수용 기준 4에 각각 적고 세 경우를 테스트로 단언하게 했다.
- 2026-11-23 계획 검증 2라운드(head `86ca288`): codex 수정 요청(P1 1. F1·F2는 해소됐다고 적었다), claude 판정 없음(error. 판정 job이 허용 밖 도구 `Bash`를 불러 유출 검사가 막았다. 발견 사항). 받아들였다.
  - F3(P1): 잇는 테스트가 마지막에 `recordReview` 함수에 값을 직접 넘겨, `record-review` 명령이 `--unavailable`을 받고도 함수에 넘기지 않으면 모든 단언이 통과한다. → 수용 기준 6을 세 명령 모두 실제 명령으로 잇고 가짜 GitHub API가 받은 상태를 단언하는 새 테스트 파일(`usage-limit-cli.test.ts`, `accept-cli.test.ts`와 같은 꼴)로 바꿨다.
- 2026-11-23 계획 검증 3라운드(head `37e7901`): 두 검증자 승인(G1, 원장 차단 없음).
- 2026-11-24 넘겨받기: 계획 승인 뒤 구현이 시작되지 않은 채 멈춰 있었다(선점 `claim/223`은 2026-11-23 12:59 뒤로 갱신되지 않아 만료, 로컬 worktree 없음). 제작자가 대화에서 이어 가라고 지시해 작업자 `mac-session`이 넘겨받았다. 원격 브랜치로 worktree를 다시 만들고 대화 세션이 그 안으로 들어가(EnterWorktree) 고쳤다. frontmatter의 `owner`는 그대로 둔다(TD-23).
- 2026-11-24 `origin/main`(`a06b7fd`)을 병합했다(충돌 없음).
- 2026-11-24 1번(한도 인식) 테스트 먼저: `codex-scan.test.ts`에 `usageLimitOutput`(문구와 시각, 대소문자·서수·12시 표기, 없는 날짜·시각, 다른 표기·시간대가 붙은 표기, 한도 아님), `isUnavailableValue`, `scanCodexRun`의 `unavailable`(마지막 `turn.failed`만, 비밀·제어 문자가 섞여도 정한 형식, 그 밖의 실패·통과에는 없음)을 더하고 돌렸다. 내보내기가 없어 불러오기에서 실패했다. 구현 뒤 12건 통과.
- 2026-11-24 2번(명령) 테스트 먼저: `scan-output.test.ts`에 `codex-scan --unavailable-out`(한도면 값 한 줄·종료 코드 1·판정 파일 없음·`GITHUB_OUTPUT`에 쓴 줄 없음, 그 밖의 실패·통과에는 파일 없음)과 `codex-unavailable`(받는 값, 앞뒤 공백·줄바꿈, 둘째 줄·없는 날짜·원문은 받지 않음, 파일 없음, `GITHUB_OUTPUT` 없음, 언제나 종료 코드 0)을 자식 프로세스로 더했다(자식에는 `PATH`와 테스트가 만든 `GITHUB_OUTPUT`만 넘긴다). 구현 전에 4건이 실패했다(모르는 옵션·모르는 명령). 구현 뒤 14건 통과.
- 2026-11-24 3번(기록 설명) 테스트 먼저: `record.test.ts`에 `recordReview`의 한도 설명(시각 있음·모름, 판정 파일 없음·빈 글), 형식이 아닌 값은 지금 설명, 판정이 있거나 해당 없음·이어받기·깨진 판정이면 값을 보지 않음, `usageLimitOf`의 왕복과 다른 설명은 null을 더했다. `usageLimitOf`가 없어 불러오기에서 실패했다. 구현 뒤 통과.
- 2026-11-24 4번(runner 알림) 테스트 먼저: `runner-pr.test.ts`에 CI 대기 알림의 A) 세 경우(시각이 있는 한도 둘이면 가장 늦은 시각, 시각을 모르는 한도와 섞이면 시각 있는 쪽, 시각을 모르는 한도, 한도 아님·한도 설명과 한 글자 다른 설명)와 B)·C)·"다시 실행하지 않는다"가 그대로인지를 더했다. 구현 전에 2건이 실패했다(지금 글이 나왔다). 구현 뒤 14건 통과.
- 2026-11-24 잇는 테스트 `usage-limit-cli.test.ts`(수용 기준 6): 1~4번 구현 뒤에 썼다(테스트 먼저가 아니다). 세 명령을 자식 프로세스로 잇고 로컬 가짜 GitHub API가 받은 `review/codex`의 `state`·`description`을 단언한다(시각 있는 한도, 시각 모름, 한도 아님). 3건 통과. 변경 전 코드에서 실패하는지는 `check`의 `test-effect`로 본다(아래).
- 2026-11-24 5번(워크플로 패치): `ci.test.ts`에 judge-codex 단언(`scan` 명령의 `--unavailable-out`, `scan` 바로 뒤·봉인 앞의 `why`와 조건·명령·비밀 없음, 봉인이 마지막에 `always()`, `judge` 출력의 `unavailable`이 `repro` 바로 아래, `record`의 `UNAVAILABLE` 환경 변수와 `--unavailable "$UNAVAILABLE"`)을 먼저 더해 지금 워크플로에서 실패하는 것을 봤다(`why` 단계 없음: `9,-1,10`). 워크플로를 고친 트리에서 `ci.test.ts` 38건과 step의 AC(일곱 파일 120건)가 통과했다. 그 상태의 `git diff -- .github/workflows/judge-codex.yml`을 `lab/codex-usage-limit/judge-codex.patch`로 저장하고, 워크플로와 `ci.test.ts`를 되돌렸다(`ci.test.ts`의 변경은 리포 밖 파일로 옮겨 두었다. push 1에 넣지 않는다). 되돌린 트리에 패치가 `git apply --check`로 그대로 적용된다. 제작자가 넣을 줄과 위치는 `lab/codex-usage-limit/README.md`.
- 2026-11-24 6번(문서): 설계서 10.1절 "검증자 장애"와 10.4절 "판정 job 안의 유출 검사"에 한 항목씩, `docs/SECURITY.md`에 "사용 한도에 걸렸을 때"(runner 알림이 가리키는 확인 방법), 기술 부채 표(TD-50 해결, TD-56에 상태 설명으로 가를 수 있게 된 것, 새 TD-74·TD-75). 변경 기록은 변경 조각 `docs/harness/changes/20261123-codex-usage-limit-s0.md`(의사결정 로그).
- 2026-11-24 Claude 검증자 조사: `claude-scan`은 `result` 이벤트가 `is_error`면 "실행 오류(판정 없음)"로 실패하고 문구는 로그에만 남긴다. `judge-claude`의 실패한 실행 5건을 봤다: 3건은 허용 밖 도구(`Bash`) 호출(44669039688, 44885889572, 45109695141), 2건(44290534509, 44288744654, 2026-11-18)은 job이 돌기 전 워크플로 수준 실패였다. 한도로 끝난 실행은 없었다(발견 사항).
- 2026-11-24 push 1 전 `node scripts/harness.ts check` 통과(워크플로와 `ci.test.ts`를 되돌린 트리). `test-effect`: `runner-pr`·`scan-output`·`usage-limit-cli`는 변경 전 코드에서 단언 실패(잇는 테스트는 `codex-scan`이 모르는 옵션으로 끝나 종료 코드 단언이 실패한다), `codex-scan`·`record`는 새 내보내기가 없어 불러오기에서 실패(단언은 위 테스트 먼저 기록대로 직접 확인했다).
- 2026-11-24 push 1(head `54914fa`)을 올렸다.
- 2026-11-25 구현 판정 1회차(head `54914fa`): Claude 승인(지적 없음), Codex 수정 요청(P1 둘).
  - F4(지금 head의 워크플로가 한도 값을 기록 job에 넘기지 않고, 구조 테스트도 그 경로를 요구하지 않는다): 이 head는 계획한 push 1이다(step "작업" 7: 워크플로 파일과 `ci.test.ts`를 바꾸지 않는다). 봇은 워크플로를 push할 수 없어 제작자의 `judge-codex.yml` 커밋 뒤 push 2에서 구조 테스트를 올리고, 병합되는 head에는 둘이 함께 있다(수용 기준 7). 그 전에는 step이 완료 처리 전이라 `plan-gate`가 병합을 막는다. 고칠 것이 없어 이 절차를 근거로 반박을 달았다.
  - F5(`8:36 AM America/Los_Angeles`처럼 2~5자가 아닌 시간대 이름이 붙은 시각을 UTC로 읽는다): 맞는 지적이다. 테스트를 먼저 더했다(IANA 이름, 긴 이름, `/`·`-`로 붙여 쓴 표기, 대괄호, 쉼표·쌍반점 뒤의 시간대, 줄바꿈 뒤의 시간대는 시각 모름. 글의 끝·문장 끝·뒤따르는 공백은 시각을 읽는다). 고치기 전에 실패했다(시간대 이름을 UTC 시각으로 읽었다). 시각 표기의 끝을 보게 고쳤다: 문장 끝(`.`·`!`·`?`)이나 글의 끝이면 받고, 그 밖에는 공백·쉼표·쌍반점 뒤에 글자·숫자·괄호·부호·`/`가 오면 시각을 모르는 것으로 본다. `codex-scan`·`scan-output`·`usage-limit-cli` 29건 통과.
- 2026-11-25 F4 반박을 달고 F5 수정(head `c341ed5`)을 올렸다.
- 2026-11-25 구현 판정 2회차(head `c341ed5`): Claude 승인(지적 없음), Codex 수정 요청(P1 하나. F4는 반박을 받아들였고 F5는 고쳐졌다고 적었다). F6: F5 수정이 쉼표 뒤의 안내 문구(`8:36 AM, or upgrade to Pro.`)까지 시간대로 보아 유효한 시각을 버린다. 맞는 지적이고 F5 수정이 만든 회귀다(직전 구현은 시각을 지켰다).
- 2026-11-25 `origin/main`(`e183ae7`, #236)을 병합했다. 기술 부채 표가 충돌했다: #236이 TD-70·71을 먼저 썼다(새 행 번호 충돌, 열린 PR #242가 TD-72로 등록하는 바로 그 일). 이 PR의 두 행을 TD-74·75로 옮기고(TD-72·73은 #242가 쓴다) 이 PR의 참조(TD-50·56의 글, `docs/SECURITY.md`, 이 계획, 변경 조각)를 맞췄다. 다른 파일은 충돌 없이 병합됐다.
- 2026-11-25 F6 테스트 먼저: 시각을 지켜야 하는 꼬리(`, or upgrade to Pro.`, ` or upgrade to Pro (…)`, `; see the usage page`, `, Upgrade to Pro.`, ` Upgrade to Pro`)와 시각을 몰라야 하는 꼬리(`utc`, `, GMT+9`, `Eastern Standard Time`)를 더하고 돌려 실패를 봤다. 고침: 시각 뒤가 문장 끝이 아니면 공백·쉼표·쌍반점 뒤 첫 낱말이 시간대처럼 생겼을 때만 시각을 모르는 것으로 본다(대문자 약어, 대소문자를 가리지 않는 `UTC`·`GMT`, IANA 이름, 부호 오프셋, 괄호·`/`, `Time`으로 끝나는 이름. `TIME_ZONE_LIKE`). 29건 통과.
- 2026-11-25 이 head(`f3228ef`)의 로컬 `check`에서 `test` 1건이 한 번 실패했다(다른 세션의 `check`와 겹쳐 평소보다 두 배 넘게 오래 걸렸고 출력이 잘려 이름을 남기지 못했다). 같은 커밋에서 `test`를 다시 돌려 1357건 통과, `check`도 다시 통과해 push했다.
- 2026-11-25 구현 판정 3회차(head `f3228ef`): Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨. F6은 고쳐졌다고 적었다). F7: 소문자로 쓴 `pst`가 붙은 시각을 UTC로 읽는다. 맞는 지적이다. 테스트를 먼저 더했다(`pst`, `Pst`, `, pdt`, `kst.`, `cest`, `pacific time`, `eastern daylight time`은 시각 모름). 고치기 전에 실패했다. 고침: 알려진 시간대 약어(북미·유럽·아시아·오세아니아의 흔한 것)와 북미 시간대 이름을 대소문자를 가리지 않고 낱말 하나로 알아보는 패턴(`TIME_ZONE_NAMED`)을 더했다. 안내 문구의 흔한 낱말(`or`, `see`, `upgrade`)과 겹치는 것은 넣지 않아 F6의 꼬리는 시각을 지킨다. 29건 통과.
- 2026-11-25 구현 판정 4회차(head `5103b01`): Claude 승인(P2 하나), Codex 수정 요청(P1 하나. F7은 고쳐졌다고 적었다). F9: `, West Coast users should check their local time.`의 `West`를 시간대 약어 `WEST`로 읽어 시각을 버린다. 맞는 지적이고 F7 수정이 만든 회귀다. 테스트를 먼저 더했다(`West Coast users …`, `, it may take a while`은 시각을 지키고, 홀로 붙은 `west`, `west.`, `pst, or upgrade to Pro.`는 시각 모름). 고치기 전에 실패했다. 고침: 대소문자 무관 약어는 홀로 붙었을 때만(글의 끝, 문장부호, 부호 오프셋이 이어질 때) 시간대로 본다. 뒤에 낱말이 이어지면 안내 문장의 첫 낱말이다. `, est. wait …`처럼 약어 뒤에 마침표가 오는 글은 `kst.`와 가릴 수 없어 시각 모름 쪽으로 둔다(테스트 목록에서 뺐다). 29건 통과.
- 2026-11-25 같은 날 PR #242의 Codex 판정이 실제로 사용 한도에 걸렸다(판정 실행 45545579256): 문구는 `You’ve hit your usage limit. Upgrade to Pro (…), visit … to purchase more credits or try again at 3:00 PM.`로 날짜 없이 시각만 있다. 이 구현은 이 꼴을 "풀리는 시각 모름"(`usage-limit`)으로 읽는다(테스트에 고정했다). 한도가 풀릴 때까지(러너 시각 15:00) push하지 않는다(절차서 5절).
- 2026-11-26 한도가 풀린 뒤 `origin/main`(`821c280`, #217)을 병합하고(충돌 없음) `check` 통과 뒤 F9 수정과 함께 올렸다(head `22d3801`).
- 2026-11-26 구현 판정 5회차(head `22d3801`): Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨. F9는 고쳐졌다고 적었다). F10: `8:36 AM pst or upgrade to Pro.`처럼 쉼표 없이 안내가 이어지면 `pst`를 시간대로 보지 않아 UTC로 읽는다. 맞는 지적이고 F9 수정이 만든 회귀다. 테스트를 먼저 더했다(`pst or upgrade to Pro.`, `kst and try later`, `utc or later`는 시각 모름). 고치기 전에 실패했다. 고침: 약어를 둘로 나눴다. 영어 낱말·흔한 줄임과 겹치지 않는 약어(`pst`, `kst`, `utc` 등. `TIME_ZONE_STRONG`)는 뒤에 무엇이 와도 낱말 하나로 시간대로 보고, 겹치는 약어(`west`, `wet`, `est`, `et`, `ct`, `mt`, `pt`, `ast`. `TIME_ZONE_WEAK`)만 홀로 붙었을 때 시간대로 본다. F6·F9의 꼬리는 그대로 시각을 지킨다. 29건 통과.
- 2026-11-26 구현 판정 6회차(head `3c5b284`): Claude 승인(지적 없음), Codex 수정 요청(새 지적 없음). F10이 남았다: `est or upgrade to Pro.`의 `est`(영어 줄임과 겹쳐 홀로 붙었을 때만 보는 쪽)를 시간대로 보지 않는다. 가리는 규칙의 반례가 판정 F5·F6·F7·F9·F10에서 되풀이돼, 제작자에게 방향을 물었다(선택지: 엄격하게 / 약어 목록 계속 보강 / F10을 승인으로 닫기). 제작자가 "엄격하게"를 골랐다(2026-11-26 대화).
- 2026-11-26 엄격한 규칙 테스트 먼저: 시각 뒤에 문장 끝이 아닌 글이 이어지는 꼴(`, or upgrade to Pro.`, `, West Coast users …`, `est or upgrade to Pro.`, 마침표에 붙인 `.PST` 등)을 모두 시각 모름으로, 글의 끝·공백뿐·문장 끝(`.`·`!`·`?` 바로 뒤에 글자·숫자가 붙지 않음)만 시각을 읽는 것으로 테스트를 고쳤다. 고치기 전에 실패했다. 고침: 시간대 판별 패턴(`TIME_ZONE_LIKE`·`TIME_ZONE_STRONG`·`TIME_ZONE_WEAK`)을 걷어내고 끝을 보는 정규식 하나(`TIME_END`)로 바꿨다. 실제 문구 둘(날짜가 있는 꼴, 시각만 있는 꼴)은 모두 마침표로 끝난다. 29건 통과.
- 2026-11-28 제작자의 워크플로 커밋 `9bcbf6b`(부모 `7793e9a`, `.github/workflows/judge-codex.yml` 한 파일)를 받았다. `docs/SECURITY.md` "워크플로 변경 절차" 4번대로 기준 커밋 `7793e9a`에 `lab/codex-usage-limit/judge-codex.patch`를 적용한 트리와 받은 head의 트리를 통째로 견줬다: 둘 다 `cf063aa`로 같다.
- 2026-11-28 `origin/main`(`abc4fa2`)을 병합했다. 충돌 셋: `scripts/ci/record.ts`의 `RecordReviewOptions`(#267의 `deferred`와 이 PR의 `unavailable`을 둘 다 둔다. 한도 설명은 판정이 없을 때, `deferred`는 판정이 있을 때 쓰여 겹치지 않는다), `scripts/test/record.test.ts`의 불러오기(둘을 합쳤다), 기술 부채 표(main의 TD-72·73과 이 PR의 TD-74·75를 둘 다 둔다. main은 TD-76·77로 건너뛰어 번호가 겹치지 않는다). `judge-codex.yml`은 main의 변경(#241의 `runs-on` 다섯 줄)과 제작자의 변경이 겹치지 않아 자동 병합됐고 그 결과가 main의 파일에 같은 패치를 적용한 것과 같았다(`cmp`). 그 병합에 구조 테스트와 완료 처리를 얹은 push(`6352eb9`, 로컬 `check`·AC 131건 통과)를 GitHub이 거부했다: `refusing to allow a Personal Access Token to create or update workflow .github/workflows/judge-codex.yml without workflow scope`. 병합한 파일이 두 부모 어디에도 없는 새 내용이기 때문으로 본다(#236에서 받아들여진 것은 PR이 바꾸지 않은 파일을 main 그대로 가져온 병합이다). 원격은 바뀌지 않았다.
- 2026-11-28 병합을 다시 했다: `judge-codex.yml`만 main의 것으로 두고(제작자의 네 곳이 빠진다) 나머지 충돌은 위와 같이 풀었다(`d358aa6`. 거부된 병합과 그 파일만 다르다). 이 push의 head가 새 기준 커밋이다. 같은 패치가 새 기준 커밋에 `git apply --check`로 그대로 적용된다. 제작자에게 같은 패치를 다시 요청하고, 받은 뒤 새 기준 커밋으로 트리를 견준 다음 구조 테스트(거부된 로컬 기록의 `10820c0`)와 완료 처리를 올린다. 이 절차를 `docs/SECURITY.md` "워크플로 변경 절차"에 적었다.
- 2026-11-28 제작자의 두 번째 워크플로 커밋 `93d7e62`(부모 `83603af`, `.github/workflows/judge-codex.yml` 한 파일)를 받았다. 새 기준 커밋 `83603af`에 같은 패치를 적용한 트리와 받은 head의 트리가 통째로 같다(`370d998`). push 2: 거부된 로컬 기록의 구조 테스트(`10820c0`)를 그대로 옮겼다(`5f7a63c`). step0의 AC(일곱 파일 131건) 통과. `origin/main`은 `abc4fa2` 그대로라 다시 병합하지 않는다.
- 2026-11-28 구현 판정(head `cd1e1af`, push 2): Claude 승인(지적 없음), Codex 수정 요청(P1 하나). F11: 구조 테스트가 `record` job 전체에서 `UNAVAILABLE` 선언과 `--unavailable` 인자를 따로 찾아, 선언을 앞 단계의 `env`로 옮겨도(단계의 `env`는 다른 단계에 이어지지 않는다) 통과한다. 맞는 지적이다. 리포 밖 사본의 워크플로를 그렇게 바꿔 지금 테스트가 통과하는 것을 먼저 봤다. 고침: `record-review`를 부르는 단계 하나를 찾아 그 단계의 `run:` 앞(`env:`)에 `UNAVAILABLE`이 있고 같은 단계의 `run`이 `--unavailable "$UNAVAILABLE"`로 넘기는지 단언한다. 고친 테스트는 그 사본에서 실패하고 실제 워크플로에서 통과한다. 워크플로는 바꾸지 않는다. AC 131건 통과.

## 의사결정 로그

- 결정: 이유는 판정 job의 새 출력(`unavailable`)으로 넘긴다. / 이유: 제작자가 골랐다(2026-11-23). 판정 출력은 판정만 나르고, 기록 job은 지금처럼 판정을 검사한다. 판정 job이 실패로 보이는 것도 그대로다. / 버린 대안: 한도일 때 판정 출력에 표식을 싣고 `scan` 단계를 성공으로 끝낸다(워크플로를 고치지 않아도 되지만 판정 출력이 판정이 아닌 값을 나르고, 한도인데 판정 job이 성공으로 보인다).
- 결정: 출력 값은 정한 형식(`usage-limit`, `usage-limit@YYYY-MM-DDTHH:MMZ`)뿐이고 오류 문구 원문을 넘기지 않는다. `record-review`도 같은 형식만 받는다. / 이유: 판정 job은 PR 내용을 읽은 LLM이 도는 job이고 기록 job은 커밋 상태를 쓰는 job이다. 그 사이의 값은 좁게 둔다(10.4절 출력 검사). 값을 위조해도 상태는 error이고 설명만 바뀐다.
- 결정: 풀리는 시각은 UTC로 읽는다. / 이유: 문구("Nov 21st, 2026 8:36 AM")에 시간대가 없다. Codex CLI는 실행한 기계의 시각대로 적는 것으로 보이고 GitHub 호스팅 러너의 시각대는 UTC다. 설명에 `UTC`를 붙여 기준을 밝힌다. 틀리면 설명의 시각만 틀리고 상태는 그대로다.
- 결정: "워크플로만 바뀐 트리에서도 AC가 실패한다"는 수용 기준으로 두지 않는다. / 이유: 스크립트 변경(push 1)이 제작자의 워크플로 커밋보다 먼저 올라가므로 그런 head는 이 PR에 생기지 않는다. 그런 트리가 생겨도 `record-review`는 모르는 옵션에서 실패하고(TD-17에서 고친 옵션 검사) `review/codex`가 기록되지 않아 병합이 막힌다(fail-closed). / 버린 대안: 옛 워크플로를 요구하는 단언을 지금 테스트에 더한다(#143은 기존 단언이 그 역할을 했다. 이번에는 바뀌는 줄을 지금 단언하는 테스트가 없다).
- 결정: 한도 값은 `codex-scan`이 파일에 쓰고, 뒤의 단계 `why`(`if: always() && steps.scan.outcome == 'failure'`)가 `codex-unavailable`로 검사해 job 출력에 쓴다(판정 1라운드 F1). / 이유: 실패로 끝나는 단계가 `GITHUB_OUTPUT`에 쓴 값이 넘어가는지를 병합 전에 확인할 길이 없다. 성공하는 단계의 출력이 실패한 job에서 다음 job으로 가는 것은 봉인·저장 경로(`seal` → `store`)가 이미 쓰고 있고 실행 44542064356에서 확인했다. `codex-scan`이 실패할 때 job 출력을 쓰지 않는다는 #143의 약속도 그대로다. / 버린 대안: `codex-scan`이 실패하면서 `GITHUB_OUTPUT`에 쓴다(처음 계획. 넘어가는지 병합 뒤에야 안다).
- 결정(2026-11-24 구현): CHANGELOG와 설계서 머리말·변경 이력을 직접 고치지 않고 변경 조각(`docs/harness/changes/20261123-codex-usage-limit-s0.md`)에 적는다. step의 "작업" 6은 "머리말·변경 이력. `CHANGELOG`"라고 적었지만, 그 뒤 main에 변경 조각(#227, 절차서 5절)이 들어와 보호 경로 PR은 조각에 적게 됐다. / 이유: 이 PR은 제작자의 워크플로 커밋과 승인을 기다리는 동안 열려 있어, 직접 고치면 먼저 병합되는 PR과 그 세 자리에서 충돌하고 새 커밋이 승인을 철회시킨다(TD-39). 조각 폴더는 계획의 "관련 파일·문서"에 없어 `scope` 경고가 날 수 있다(묶인 섹션이라 고치지 않고 PR 본문에 이유를 적는다). / 버린 대안: 직접 고친다(절차서는 받아 준다. 충돌을 다시 만든다).
- 결정(2026-11-24 구현): 한도 설명을 만드는 글과 읽는 함수(`usageLimitOf`)를 `scripts/ci/record.ts` 한곳에 둔다. 형식 검사(`isUnavailableValue`)는 `scripts/ci/codex-scan.ts`에 두고 기록 쪽이 불러 쓴다(step의 "작업" 1·3). runner는 `usageLimitOf`만 부른다. / 이유: 설명의 글과 판별이 어긋나면 runner의 추천이 조용히 지금 글로 돌아간다. 한곳에서 만들고 읽으면 왕복 테스트로 묶을 수 있다.
- 결정(2026-11-24 구현): `docs/SECURITY.md`에 "사용 한도에 걸렸을 때"를 더한다. / 이유: runner 알림의 시각을 모르는 경우 추천과 B)가 그 문서를 가리키는데, 지금 문서에는 한도를 확인하는 방법이 없다. 범위 안의 파일이다.
- 결정(제작자, 2026-11-26 대화): 풀리는 시각은 시각 표기 바로 뒤가 글의 끝·공백뿐·문장 끝일 때만 읽고, 그 밖의 글이 이어지면 시간대인지 안내인지 가리지 않고 시각을 모르는 것으로 본다. / 이유: 시간대와 안내 문구를 가리는 규칙은 구현 판정 F5~F10에서 반례가 되풀이됐다(시간대를 놓치면 틀린 UTC 시각을 적고, 안내를 시간대로 보면 시각을 잃는다). 틀린 시각은 사람을 잘못 이끌지만 "시각 모름"은 상태와 알림이 맞고 시각만 빠진다. 실제 문구는 마침표로 끝난다. 수용 기준 1("다른 표기와 시간대가 붙은 표기는 시각 모름")을 지킨다. / 버린 대안: 약어 목록을 계속 보강한다(반례가 끝나지 않는다), F10을 제작자 승인으로 닫는다(틀린 시각이 남는다). 판정 F6(안내가 이어지면 시각을 지켜야 한다)은 이 결정으로 다시 시각 모름이 된다.
- 결정: `codex-unavailable`은 언제나 종료 코드 0이다. / 이유: 이 단계는 설명을 덧붙이는 일뿐이다. 실패해도 출력이 비어 기록 job은 지금 설명을 쓰고(fail-closed는 그대로), 봉인 단계는 `always()`라 영향이 없다. 실패로 끝내면 판정 job 화면에 실패한 단계가 둘로 보여 원인을 가린다.

## 발견 사항

- Claude 판정 job이 세션에 없는 `Bash` 도구를 불러 유출 검사가 "허용 밖 도구를 호출했다"로 막는 일이 되풀이된다: 실행 44669039688(2026-11-20), 44885889572(2026-11-21), 45109695141(2026-11-23, 이 PR 2라운드). 셋 다 `session_tools=4`인데 `tool_uses`에 `Bash:1`, `other_tools=1`이다. 틀린 통과는 없지만(fail-closed) 그 head의 판정이 없어 다시 돌려야 한다. 기술 부채 표·Issue에 없다. → 처리: TD-75
- Claude 판정 job에서 사용 한도가 어떻게 보이는지(수용 기준 8): `claude-scan`은 `result` 이벤트의 `is_error`로 "실행 오류(판정 없음)"를 내고 문구는 판정 job 로그에만 남아, `review/claude` 설명은 지금의 Codex와 같이 "판정 없음(판정 job 실패 또는 유출 검사 불통과)"뿐이다. `judge-claude`의 실패한 실행 5건 가운데 한도로 끝난 것은 없어 실제 문구는 확인하지 못했다. runner는 Claude 한도 문구를 `Claude AI usage limit reached|<유닉스 초>` 꼴로 가정한다(`scripts/runner/agents.ts`, `scripts/selftest/fake-agent.ts`). 같은 방식(`unavailable` 출력과 `why` 단계)으로 할지는 실제 문구를 본 뒤 정한다. → 처리: TD-74
- 실제 Codex 한도 문구에는 날짜 없이 시각만 있는 꼴(`try again at 3:00 PM.`)이 있다(2026-11-25, 판정 실행 45545579256). 계획의 수용 기준 1이 든 꼴(`Nov 21st, 2026 8:36 AM`)과 다르다. 이 꼴은 어느 날의 시각인지 몰라 "풀리는 시각 모름"으로 적는다(상태와 알림은 맞고, 풀리는 시각만 빠진다). 시각만이라도 적을지는 수용 기준을 바꾸는 일이라 이 step에서 하지 않는다. → 처리: 해당 없음
- main이 같은 워크플로 파일을 바꾼 뒤에는 제작자의 워크플로 커밋이 든 브랜치를 봇이 `origin/main` 병합으로 갱신할 수 없다(2026-11-28 push 거부). 절차서와 보안 문서에 이 경우가 없었다 → 처리: [docs/SECURITY.md](../../../SECURITY.md) "워크플로 변경 절차"에 거부되는 조건과 봇의 절차(그 파일을 main 쪽으로 두고 병합, 같은 패치를 다시 요청)를 적었다

## 열린 질문

## 검증 방법과 결과

- step0의 AC 명령(로컬, 제작자의 워크플로 커밋과 구조 테스트가 함께 든 트리). 수용 기준 6의 잇는 테스트가 여기에 든다.
- 워크플로 패치: 기준 커밋의 트리에 패치를 적용한 트리와 제작자가 올린 head의 트리가 같은지(`docs/SECURITY.md` 4번).
- 결과(2026-11-28): 첫 커밋 `9bcbf6b` 트리 비교 같음(`cf063aa`), main 병합 뒤 다시 받은 `93d7e62` 트리 비교 같음(`370d998`). 그 트리에 구조 테스트를 더해 AC 131건 통과.
- 병합 뒤: 다음 PR의 판정 워크플로가 정상으로 돌고 `review/codex`가 지금처럼 기록되는지. 실제 사용 한도는 일부러 만들 수 없으므로, 처음 한도에 걸린 실행에서 `review/codex` 설명에 한도와 시각이 나오는지 보고 TD-50 행에 적는다.

## 다음 할 일

- push 2의 판정을 받고 `pr-ready`로 제작자 head 승인을 요청한다. 병합 뒤 관찰(위 "검증 방법과 결과"의 병합 뒤 항목)을 Issue #223에 남긴다.
