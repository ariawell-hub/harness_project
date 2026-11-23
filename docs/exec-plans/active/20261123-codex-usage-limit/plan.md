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
6. 자격증명 없이 잇는 확인(병합 전, 판정 F1): 고정된 한도 실행 기록(사용 한도 문구의 `turn.failed`)으로 `codex-scan`(종료 코드 1, 값 파일) → `codex-unavailable`(그 파일 → `GITHUB_OUTPUT`의 `unavailable=` 줄) → 그 줄의 값을 받은 `recordReview`(가짜 poster)가 한도 설명의 error를 쓰는 것까지 한 테스트에서 이어서 본다. GitHub이 실패한 job의 출력을 다음 job에 넘기는 것은 이 리포의 봉인·저장 경로가 이미 쓰는 동작이다: 실행 44542064356(2026-11-19)에서 `judge` job이 `scan` 단계에서 실패했고, `if: always()`인 `seal` 단계의 출력(`sealed`)을 받아 `store` job이 돌아 성공했다. `why` 단계는 같은 꼴이다(실패한 `scan` 단계의 출력에 기대지 않는다).
7. 병합되는 head에는 워크플로 변경과 그것을 단언하는 구조 테스트가 함께 있다. step의 AC는 워크플로 변경이 없는 트리(push 1의 head)에 구조 테스트를 더하면 실패한다(새 단언). 진행 로그에 그 실패를 적는다.
8. 문서: 설계서 10.1절 "검증자 장애"(사용 한도는 다시 돌리지 않고 풀리는 시각을 적는다)와 10.4절 판정 job 출력, `CHANGELOG`, 기술 부채 표(TD-50 해결, TD-56에 상태 설명으로 한도를 가를 수 있게 됐다는 것). Claude 검증자에서 같은 일이 어떻게 보이는지 조사한 결과를 발견 사항에 적고, 같은 방식으로 할지는 새 TD로 남긴다.

## 범위 / 비범위

범위:

- `scripts/ci/codex-scan.ts`(한도 인식과 풀리는 시각 읽기), `scripts/harness.ts`(`codex-scan`의 `--unavailable-out`, 새 명령 `codex-unavailable`, `record-review`의 `--unavailable` 옵션), `scripts/ci/record.ts`(`recordReview`의 설명과 한도 설명 판별), `scripts/runner/run.ts`(`doReportStall`의 추천 글).
- 테스트: `scripts/test/scan-output.test.ts`, `scripts/test/codex-scan.test.ts`, `scripts/test/record.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/ci.test.ts`.
- `.github/workflows/judge-codex.yml`: `scan` 명령의 인자 하나, 새 단계 `why` 하나, `judge` job 출력 한 줄, `record-review` 단계의 환경 변수 한 줄과 인자 하나. **제작자가 커밋한다.** 봇은 패치 파일로 준비한다(`lab/codex-usage-limit/`).
- 문서와 기술 부채 표.

비범위:

- 상태를 error 말고 다른 값으로 바꾸기, 한도 동안 다른 검증자로 대신하기, 위험도 낮음 PR의 Codex 판정 면제(제작자 결정: 검증을 약화하지 않는다).
- `judge-claude.yml`과 `claude-scan`(조사만 하고 새 TD로 남긴다).
- 지표 집계(`scripts/metrics/`)가 한도 횟수를 세게 하기(TD-56으로 남긴다).
- 판정 워크플로를 자동으로 다시 실행하기, 한도가 가까워진 것을 미리 알리기.

## 관련 파일·문서

- `scripts/ci/codex-scan.ts`, `scripts/ci/record.ts`, `scripts/harness.ts`, `scripts/runner/run.ts`
- `scripts/test/scan-output.test.ts`, `scripts/test/codex-scan.test.ts`, `scripts/test/record.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/ci.test.ts`
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

## 의사결정 로그

- 결정: 이유는 판정 job의 새 출력(`unavailable`)으로 넘긴다. / 이유: 제작자가 골랐다(2026-11-23). 판정 출력은 판정만 나르고, 기록 job은 지금처럼 판정을 검사한다. 판정 job이 실패로 보이는 것도 그대로다. / 버린 대안: 한도일 때 판정 출력에 표식을 싣고 `scan` 단계를 성공으로 끝낸다(워크플로를 고치지 않아도 되지만 판정 출력이 판정이 아닌 값을 나르고, 한도인데 판정 job이 성공으로 보인다).
- 결정: 출력 값은 정한 형식(`usage-limit`, `usage-limit@YYYY-MM-DDTHH:MMZ`)뿐이고 오류 문구 원문을 넘기지 않는다. `record-review`도 같은 형식만 받는다. / 이유: 판정 job은 PR 내용을 읽은 LLM이 도는 job이고 기록 job은 커밋 상태를 쓰는 job이다. 그 사이의 값은 좁게 둔다(10.4절 출력 검사). 값을 위조해도 상태는 error이고 설명만 바뀐다.
- 결정: 풀리는 시각은 UTC로 읽는다. / 이유: 문구("Nov 21st, 2026 8:36 AM")에 시간대가 없다. Codex CLI는 실행한 기계의 시각대로 적는 것으로 보이고 GitHub 호스팅 러너의 시각대는 UTC다. 설명에 `UTC`를 붙여 기준을 밝힌다. 틀리면 설명의 시각만 틀리고 상태는 그대로다.
- 결정: "워크플로만 바뀐 트리에서도 AC가 실패한다"는 수용 기준으로 두지 않는다. / 이유: 스크립트 변경(push 1)이 제작자의 워크플로 커밋보다 먼저 올라가므로 그런 head는 이 PR에 생기지 않는다. 그런 트리가 생겨도 `record-review`는 모르는 옵션에서 실패하고(TD-17에서 고친 옵션 검사) `review/codex`가 기록되지 않아 병합이 막힌다(fail-closed). / 버린 대안: 옛 워크플로를 요구하는 단언을 지금 테스트에 더한다(#143은 기존 단언이 그 역할을 했다. 이번에는 바뀌는 줄을 지금 단언하는 테스트가 없다).
- 결정: 한도 값은 `codex-scan`이 파일에 쓰고, 뒤의 단계 `why`(`if: always() && steps.scan.outcome == 'failure'`)가 `codex-unavailable`로 검사해 job 출력에 쓴다(판정 1라운드 F1). / 이유: 실패로 끝나는 단계가 `GITHUB_OUTPUT`에 쓴 값이 넘어가는지를 병합 전에 확인할 길이 없다. 성공하는 단계의 출력이 실패한 job에서 다음 job으로 가는 것은 봉인·저장 경로(`seal` → `store`)가 이미 쓰고 있고 실행 44542064356에서 확인했다. `codex-scan`이 실패할 때 job 출력을 쓰지 않는다는 #143의 약속도 그대로다. / 버린 대안: `codex-scan`이 실패하면서 `GITHUB_OUTPUT`에 쓴다(처음 계획. 넘어가는지 병합 뒤에야 안다).
- 결정: `codex-unavailable`은 언제나 종료 코드 0이다. / 이유: 이 단계는 설명을 덧붙이는 일뿐이다. 실패해도 출력이 비어 기록 job은 지금 설명을 쓰고(fail-closed는 그대로), 봉인 단계는 `always()`라 영향이 없다. 실패로 끝내면 판정 job 화면에 실패한 단계가 둘로 보여 원인을 가린다.

## 발견 사항

## 열린 질문

## 검증 방법과 결과

- step0의 AC 명령(로컬, 제작자의 워크플로 커밋과 구조 테스트가 함께 든 트리). 수용 기준 6의 잇는 테스트가 여기에 든다.
- 워크플로 패치: 기준 커밋의 트리에 패치를 적용한 트리와 제작자가 올린 head의 트리가 같은지(`docs/SECURITY.md` 4번).
- 병합 뒤: 다음 PR의 판정 워크플로가 정상으로 돌고 `review/codex`가 지금처럼 기록되는지. 실제 사용 한도는 일부러 만들 수 없으므로, 처음 한도에 걸린 실행에서 `review/codex` 설명에 한도와 시각이 나오는지 보고 TD-50 행에 적는다.

## 다음 할 일

- 계획만 담은 커밋을 초안 PR로 올려 계획 검증(G1)을 받는다. 승인 뒤 step0의 순서대로 한다.
