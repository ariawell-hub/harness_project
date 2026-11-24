---
id: 20261123-codex-usage-limit
issue: 223 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
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
- 2026-11-24 6번(문서): 설계서 10.1절 "검증자 장애"와 10.4절 "판정 job 안의 유출 검사"에 한 항목씩, `docs/SECURITY.md`에 "사용 한도에 걸렸을 때"(runner 알림이 가리키는 확인 방법), 기술 부채 표(TD-50 해결, TD-56에 상태 설명으로 가를 수 있게 된 것, 새 TD-70·TD-71). 변경 기록은 변경 조각 `docs/harness/changes/20261123-codex-usage-limit-s0.md`(의사결정 로그).
- 2026-11-24 Claude 검증자 조사: `claude-scan`은 `result` 이벤트가 `is_error`면 "실행 오류(판정 없음)"로 실패하고 문구는 로그에만 남긴다. `judge-claude`의 실패한 실행 5건을 봤다: 3건은 허용 밖 도구(`Bash`) 호출(44669039688, 44885889572, 45109695141), 2건(44290534509, 44288744654, 2026-11-18)은 job이 돌기 전 워크플로 수준 실패였다. 한도로 끝난 실행은 없었다(발견 사항).
- 2026-11-24 push 1 전 `node scripts/harness.ts check` 통과(워크플로와 `ci.test.ts`를 되돌린 트리). `test-effect`: `runner-pr`·`scan-output`·`usage-limit-cli`는 변경 전 코드에서 단언 실패(잇는 테스트는 `codex-scan`이 모르는 옵션으로 끝나 종료 코드 단언이 실패한다), `codex-scan`·`record`는 새 내보내기가 없어 불러오기에서 실패(단언은 위 테스트 먼저 기록대로 직접 확인했다).

## 의사결정 로그

- 결정: 이유는 판정 job의 새 출력(`unavailable`)으로 넘긴다. / 이유: 제작자가 골랐다(2026-11-23). 판정 출력은 판정만 나르고, 기록 job은 지금처럼 판정을 검사한다. 판정 job이 실패로 보이는 것도 그대로다. / 버린 대안: 한도일 때 판정 출력에 표식을 싣고 `scan` 단계를 성공으로 끝낸다(워크플로를 고치지 않아도 되지만 판정 출력이 판정이 아닌 값을 나르고, 한도인데 판정 job이 성공으로 보인다).
- 결정: 출력 값은 정한 형식(`usage-limit`, `usage-limit@YYYY-MM-DDTHH:MMZ`)뿐이고 오류 문구 원문을 넘기지 않는다. `record-review`도 같은 형식만 받는다. / 이유: 판정 job은 PR 내용을 읽은 LLM이 도는 job이고 기록 job은 커밋 상태를 쓰는 job이다. 그 사이의 값은 좁게 둔다(10.4절 출력 검사). 값을 위조해도 상태는 error이고 설명만 바뀐다.
- 결정: 풀리는 시각은 UTC로 읽는다. / 이유: 문구("Nov 21st, 2026 8:36 AM")에 시간대가 없다. Codex CLI는 실행한 기계의 시각대로 적는 것으로 보이고 GitHub 호스팅 러너의 시각대는 UTC다. 설명에 `UTC`를 붙여 기준을 밝힌다. 틀리면 설명의 시각만 틀리고 상태는 그대로다.
- 결정: "워크플로만 바뀐 트리에서도 AC가 실패한다"는 수용 기준으로 두지 않는다. / 이유: 스크립트 변경(push 1)이 제작자의 워크플로 커밋보다 먼저 올라가므로 그런 head는 이 PR에 생기지 않는다. 그런 트리가 생겨도 `record-review`는 모르는 옵션에서 실패하고(TD-17에서 고친 옵션 검사) `review/codex`가 기록되지 않아 병합이 막힌다(fail-closed). / 버린 대안: 옛 워크플로를 요구하는 단언을 지금 테스트에 더한다(#143은 기존 단언이 그 역할을 했다. 이번에는 바뀌는 줄을 지금 단언하는 테스트가 없다).
- 결정: 한도 값은 `codex-scan`이 파일에 쓰고, 뒤의 단계 `why`(`if: always() && steps.scan.outcome == 'failure'`)가 `codex-unavailable`로 검사해 job 출력에 쓴다(판정 1라운드 F1). / 이유: 실패로 끝나는 단계가 `GITHUB_OUTPUT`에 쓴 값이 넘어가는지를 병합 전에 확인할 길이 없다. 성공하는 단계의 출력이 실패한 job에서 다음 job으로 가는 것은 봉인·저장 경로(`seal` → `store`)가 이미 쓰고 있고 실행 44542064356에서 확인했다. `codex-scan`이 실패할 때 job 출력을 쓰지 않는다는 #143의 약속도 그대로다. / 버린 대안: `codex-scan`이 실패하면서 `GITHUB_OUTPUT`에 쓴다(처음 계획. 넘어가는지 병합 뒤에야 안다).
- 결정(2026-11-24 구현): CHANGELOG와 설계서 머리말·변경 이력을 직접 고치지 않고 변경 조각(`docs/harness/changes/20261123-codex-usage-limit-s0.md`)에 적는다. step의 "작업" 6은 "머리말·변경 이력. `CHANGELOG`"라고 적었지만, 그 뒤 main에 변경 조각(#227, 절차서 5절)이 들어와 보호 경로 PR은 조각에 적게 됐다. / 이유: 이 PR은 제작자의 워크플로 커밋과 승인을 기다리는 동안 열려 있어, 직접 고치면 먼저 병합되는 PR과 그 세 자리에서 충돌하고 새 커밋이 승인을 철회시킨다(TD-39). 조각 폴더는 계획의 "관련 파일·문서"에 없어 `scope` 경고가 날 수 있다(묶인 섹션이라 고치지 않고 PR 본문에 이유를 적는다). / 버린 대안: 직접 고친다(절차서는 받아 준다. 충돌을 다시 만든다).
- 결정(2026-11-24 구현): 한도 설명을 만드는 글과 읽는 함수(`usageLimitOf`)를 `scripts/ci/record.ts` 한곳에 둔다. 형식 검사(`isUnavailableValue`)는 `scripts/ci/codex-scan.ts`에 두고 기록 쪽이 불러 쓴다(step의 "작업" 1·3). runner는 `usageLimitOf`만 부른다. / 이유: 설명의 글과 판별이 어긋나면 runner의 추천이 조용히 지금 글로 돌아간다. 한곳에서 만들고 읽으면 왕복 테스트로 묶을 수 있다.
- 결정(2026-11-24 구현): `docs/SECURITY.md`에 "사용 한도에 걸렸을 때"를 더한다. / 이유: runner 알림의 시각을 모르는 경우 추천과 B)가 그 문서를 가리키는데, 지금 문서에는 한도를 확인하는 방법이 없다. 범위 안의 파일이다.
- 결정: `codex-unavailable`은 언제나 종료 코드 0이다. / 이유: 이 단계는 설명을 덧붙이는 일뿐이다. 실패해도 출력이 비어 기록 job은 지금 설명을 쓰고(fail-closed는 그대로), 봉인 단계는 `always()`라 영향이 없다. 실패로 끝내면 판정 job 화면에 실패한 단계가 둘로 보여 원인을 가린다.

## 발견 사항

- Claude 판정 job이 세션에 없는 `Bash` 도구를 불러 유출 검사가 "허용 밖 도구를 호출했다"로 막는 일이 되풀이된다: 실행 44669039688(2026-11-20), 44885889572(2026-11-21), 45109695141(2026-11-23, 이 PR 2라운드). 셋 다 `session_tools=4`인데 `tool_uses`에 `Bash:1`, `other_tools=1`이다. 틀린 통과는 없지만(fail-closed) 그 head의 판정이 없어 다시 돌려야 한다. 기술 부채 표·Issue에 없다. → 처리: TD-71
- Claude 판정 job에서 사용 한도가 어떻게 보이는지(수용 기준 8): `claude-scan`은 `result` 이벤트의 `is_error`로 "실행 오류(판정 없음)"를 내고 문구는 판정 job 로그에만 남아, `review/claude` 설명은 지금의 Codex와 같이 "판정 없음(판정 job 실패 또는 유출 검사 불통과)"뿐이다. `judge-claude`의 실패한 실행 5건 가운데 한도로 끝난 것은 없어 실제 문구는 확인하지 못했다. runner는 Claude 한도 문구를 `Claude AI usage limit reached|<유닉스 초>` 꼴로 가정한다(`scripts/runner/agents.ts`, `scripts/selftest/fake-agent.ts`). 같은 방식(`unavailable` 출력과 `why` 단계)으로 할지는 실제 문구를 본 뒤 정한다. → 처리: TD-70

## 열린 질문

## 검증 방법과 결과

- step0의 AC 명령(로컬, 제작자의 워크플로 커밋과 구조 테스트가 함께 든 트리). 수용 기준 6의 잇는 테스트가 여기에 든다.
- 워크플로 패치: 기준 커밋의 트리에 패치를 적용한 트리와 제작자가 올린 head의 트리가 같은지(`docs/SECURITY.md` 4번).
- 병합 뒤: 다음 PR의 판정 워크플로가 정상으로 돌고 `review/codex`가 지금처럼 기록되는지. 실제 사용 한도는 일부러 만들 수 없으므로, 처음 한도에 걸린 실행에서 `review/codex` 설명에 한도와 시각이 나오는지 보고 TD-50 행에 적는다.

## 다음 할 일

- 계획만 담은 커밋을 초안 PR로 올려 계획 검증(G1)을 받는다. 승인 뒤 step0의 순서대로 한다.
