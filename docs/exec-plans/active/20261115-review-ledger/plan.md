---
id: 20261115-review-ledger
issue: 55 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-15T16:00:39+09:00 # new-task가 채운다
---

# feat: 2단계③ 지적 원장·재현 job·계획 교차 검증 — review-ledger, 라운드 규칙, G1 (TD-3)

## 목표와 수용 기준

로드맵 2단계의 셋째 Issue다. 리뷰 루프가 수렴하도록(R16, 설계서 10.2절) 지적 원장과 라운드 규칙을 CI에 넣고, 중·대 규모 계획을 구현 전에 교차 검증한다(G1, TD-3). #54가 만든 판정·기록 job 위에 얹는다.

수용 기준:

1. 지적 원장: 기록 job이 검증 App으로 PR 댓글 하나를 관리한다. 지적마다 ID·등급·검증자·위치·내용·재현·상태·처리를 담고, 1라운드 base SHA(프롬프트 버전)와 CI(`check`) 실패 기록을 담는다. 원장으로 인정하는 댓글은 작성자가 검증 App 봇(`ci.recorderBot`)인 것뿐이다.
2. 상태 전이는 검증자 판정과 기계 검사로만 일어난다. `fixed`·P1 `rejected`는 그 지적을 낸 검증자의 판정으로, P0 `rejected`는 두 검증자가 모두 동의해야 된다. P2·P3과 동결된 지적은 `deferred`, 나머지는 `open`이다.
3. `review-ledger` 커밋 상태: 원장에 `open`인 P0·P1이 없을 때만 success. 등록된 P0·P1은 `fixed`나 `rejected`가 돼야 닫힌다. 동결 규칙(수용 기준 4)으로 `deferred`로 등록된 P1은 설계서 10.2절 (5)대로 후속으로 넘긴 것이라 막지 않고, 그 수를 상태 설명에 적는다. 원장을 읽지 못하거나 깨졌으면 `error`(fail-closed).
4. 라운드 규칙: 2라운드부터 검증자는 원장과 직전 라운드 이후 diff를 입력으로 받는다. 직전 라운드 head 이후 바뀌지 않은 파일에 대한 새 지적은 P0만 `open`으로 받고 나머지는 `deferred`로 등록한다(재현된 P1은 step3에서 예외로 더한다).
5. 반박: 절차서 8절 형식(지적 ID, 근거, 요지 300자 이내)을 지킨 PR 댓글만 골라 검증자 입력에 넣는다. 형식에 맞지 않는 글은 전달하지 않는다.
6. 프롬프트 버전 고정: 2라운드부터 판정 job은 원장에 적힌 1라운드 base SHA의 프롬프트를 쓴다.
7. 재현 job: 검증자가 낸 재현 테스트를 비밀·쓰기 권한이 없는 job에서 PR head에 붙여 실행하고 "재현됨 / 재현 안 됨 / 실행 못 함"을 원장에 기록한다. 근거가 없는 P1은 P2로 내린다. "재현 안 됨"은 기계가 내리지 않고 다음 라운드에서 검증자가 확인한다(10.4절 재현 job의 한계).
8. G1: 중·대 규모 계획은 코드 변경이 없는 커밋에서 필요한 검증자의 승인을 받아야 한다. `plan-gate`가 계획 핵심 섹션 해시(목표·수용 기준, 범위, 관련 파일, 모든 step의 작업·AC)가 승인받은 해시와 같은지 확인한다. main에 이미 있는 계획과 해시가 같으면 다시 검증하지 않는다. `planReview.required: true`로 켠다.
9. 실제 PR에서 원장 댓글(작성자 = 검증 App), 2라운드 상태 전이, `review-ledger`, 재현 job, G1을 확인해 진행 로그에 남기고, 제작자가 `review-ledger`를 검증 App 출처의 필수 체크로 등록해 `required-checks`가 통과한다.

## 범위 / 비범위

- 범위: `scripts/ci/`(원장, 반박, 재현, 계획 해시, 기록), `scripts/cross-review/`(프롬프트·스키마·원장 형식), `scripts/gates/plan-gate.ts`, `harness.ts` 명령, `.github/workflows/judge-*.yml`·`gates.yml`, 설정(`ci`, `planReview`), 문서.
- 비범위: runner의 지적 대응·CI 대기(#56), revert·자체 테스트·운영 전환(#57), 발산 감지의 자동 revert(10.2절 (7), runner 쪽이라 #56), 제작자 승인으로 P0을 `rejected`로 바꾸는 경로(필요가 생기면 TD), 지표 수집(17.2절).

## 관련 파일·문서

- scripts/ci/
- scripts/cross-review/
- scripts/gates/
- scripts/lib/
- scripts/commands/
- scripts/harness.ts
- scripts/test/
- .github/workflows/
- harness.config.json
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/SECURITY.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261115-review-ledger/

## step 목록

- step0 ledger-core: 원장 자료 구조, 댓글 직렬화·해석, 판정 반영(ID·라운드·동결·상태 전이), `review-ledger` 판정. 판정 스키마에 `resolutions` 추가. 워크플로는 바꾸지 않는다
- step1 ledger-record: 기록 job이 원장 댓글을 쓰고 `review-ledger`를 기록, 검증자 입력에 원장, `check` 실패 기록, 프롬프트 버전 고정
- step2 rebuttal: 반박 댓글 해석과 검증자 입력 전달
- step3 repro-job: 재현 테스트 필드, 재현 job, 원장 반영과 강등 규칙
- step4 plan-review: 계획 해시, 계획 전용 커밋 판정, `plan-gate`의 G1 확인
- step5 verify-register: 실제 PR 확인, `review-ledger` 필수 체크 등록, `planReview.required: true`, 문서 정리

## 진행 로그

- 2026-11-15 step0: 계획 작성. Issue #54 병합(PR #69) 뒤 시작. 위험도는 제작자 결정(2026-11-15 대화: #55·#56·#57은 보통)에 따라 `normal`이다.
- 2026-11-15 step0: 테스트 먼저. `node --test scripts/test/ledger.test.ts scripts/test/verdict.test.ts scripts/test/binding.test.ts` 종료 코드 1(21개 중 3개 실패: `scripts/ci/ledger.ts` 없음, `verdict.ts`에 `RESOLUTION_ID_RE` export 없음, `planCarry` 테스트의 도우미 오류). 구현 뒤 AC 테스트 종료 코드 0(49개 통과).
- 2026-11-15 step0: 전체 `check`가 한 번 실패했다(`claude-scan.test.ts`·`codex-scan.test.ts`의 "깨끗한 실행" 기대값에 `resolutions: []`가 없었다). 검사기가 빈 배열로 채우는 것이 의도한 동작이라 기대값을 고쳤다.
- 2026-11-15 step0: `planCarry`의 patch-id 측정 실패 경로 테스트는 구현을 바꾸지 않고 통과했다(기존 동작 고정). `CHANGELOG`의 #54 step4 항목을 v0.7.27 뒤로 옮겼다.
- 2026-11-15 step0: PR #83 1차 판정. `review/claude` 승인(P2 3), `review/codex` 수정 요청(P1 1: 동결된 P1이 `deferred`라 `review-ledger`를 통과한다, 수용 기준 3의 문장과 다르다). 설계서 10.2절 (4)·(5)는 동결된 지적을 `deferred`로 넘기라고 정하므로 동작은 두고, 수용 기준 3의 문장을 설계서에 맞게 고치고 동결 P1 수를 상태 설명에 적게 했다(테스트 추가).
- 2026-11-15 step0: Claude P2 3건 반영. 댓글 크기 상한(본문 60000자를 넘기는 P2·P3은 등록하지 않는다, 최악 크기 테스트), 라운드 기록을 자르지 않음, 닫힌 지적을 다시 내면 다시 열고 파일 이름은 정규화해 비교. 테스트와 구현을 함께 썼고, 그 뒤 옛 구현(`git show HEAD:scripts/ci/ledger.ts`)으로 새 테스트를 돌려 실패를 확인했다: 종료 코드 1(`MAX_BODY` export가 없어 파일 전체가 실패. 테스트별 실패는 따로 보지 못했다). 새 구현에서는 13개 모두 통과.
- 2026-11-15 step0: PR #83 2차 판정에서 두 검증자 승인(`review/claude` P2 1·P3 1, `review/codex` P2 1), 병합. 남은 지적: 라운드 기록이 쌓이면 댓글 상한을 넘을 수 있다(Codex P2), 지적 ID가 F9999를 넘으면 원장을 읽지 못한다(Claude P2), `dropped` 필드가 step 본문에 없다(Claude P3). step1에서 `saveLedger`가 댓글 상한을 넘는 본문을 쓰지 않고 예외를 던지게 해 `review-ledger = error`로 드러나게 했다. 나머지는 발견 사항에 적었다.
- 2026-11-15 step1: 테스트 먼저. `node --test scripts/test/ledger-store.test.ts` 종료 코드 1(`scripts/ci/ledger-store.ts` 없음). 구현 뒤 12개 통과. 워크플로 불변식 테스트(`ci.test.ts`)와 명령 연결 테스트(`record.test.ts`, 가짜 GitHub API 서버)는 구현과 함께 썼다.
- 2026-11-15 step1: 처음에는 판정 job의 입력 단계에 읽기 전용 `github.token`을 주어 원장을 읽게 했다. 기존 불변식 테스트("판정 job에는 `GH_TOKEN`이 없다")에 걸려, plan job이 원장을 읽어 job 출력으로 넘기는 방식으로 바꿨다. 판정 job에는 여전히 GitHub 토큰이 없다.
- 2026-11-15 step1: AC 실행 결과. `node --test scripts/test/ledger.test.ts scripts/test/ledger-store.test.ts scripts/test/record.test.ts scripts/test/ci.test.ts` 종료 코드 0, `grep` 3개 통과, `node scripts/harness.ts check` 종료 코드 0.
- 2026-11-15 step1: 제작자에게 요청(대화): 검증 App `harness-recorder`의 Pull requests 권한을 읽기·쓰기로 올리고 설치에서 수락. 절차와 확인 방법은 [SECURITY.md](../../../SECURITY.md) "검증 App 권한 변경". 수락 전에는 `review-ledger`가 `error`로 남고 `review/*`는 그대로 기록된다(원장 토큰 단계는 `continue-on-error`). 이 PR의 워크플로 변경은 main 병합 뒤 다음 PR(step2)에서 처음 돈다.
- 2026-11-15 step1: PR #84 1차 판정에서 두 검증자 승인(`review/claude` P2 2, `review/codex` 지적 없음). `harness-guard`가 워크플로의 새 `permission-pull-requests: write`를 신호로 잡아 `risk-gate`가 위험도 높음(제작자 head 승인 필요)으로 판정했다. 계획 위험도는 보통이지만 이 PR은 제작자 승인을 받는다.
- 2026-11-15 step1: Claude P2 반영. plan job이 원장을 읽지 못하면 로그만 남기고 1라운드처럼 진행하던 것을, 판정 없이 실패하게 바꿨다(테스트 추가: `record.test.ts`). 다른 P2(`queue: max`의 실제 동작)는 step2 PR의 첫 실행에서 확인한다.
- 2026-11-15 step1: PR #84 병합(제작자 head 승인). 제작자가 검증 App의 Pull requests 쓰기 권한을 수락했다(대화 통보). 2차 판정의 Claude P2(권한 수락 전에는 `ci-failure` job이 실패로 보인다)는 권한이 수락돼 해당하지 않는다.
- 2026-11-15 step2: 병합 직후 main의 `check`(push) 완료로 `judge-claude`·`judge-codex`가 새 정의로 시작해 `skipped`로 끝났다(실행 43695743048, 43695743049. PR이 아니라 건너뜀). 워크플로 문법 오류는 없다(job 단위 `queue: max` 포함).
- 2026-11-15 step2: 테스트 먼저. `node --test scripts/test/rebuttal.test.ts` 종료 코드 1(`scripts/ci/rebuttal.ts` 없음). 구현 뒤 10개 중 1개 실패: 짧은 SHA(`abc1234`)는 리포 안 경로 형식과 구분할 수 없어 근거로 받는다. 테스트에서 그 사례를 뺐다(의사결정 로그).
- 2026-11-15 step2: step1의 원장 연결이 PR #85(head 438413e)에서 실제로 돌았다.
  - `judge-claude`(실행 43696393704): `review/claude = success — 승인 (P2 1)` 뒤 `review-ledger = success — 차단 지적 없음 (전체 1, 미룸 1)`. PR에 원장 댓글이 생겼다(작성자 `harness-recorder`, 프롬프트 버전 `40e38e7a40ce`, F1 P2 claude `deferred`).
  - `judge-codex`(실행 43696393657): 30초 뒤 `review/codex = success — 승인 (지적 없음)`과 `review-ledger = success`. 같은 댓글이 `라운드: claude 1, codex 1`로 고쳐졌다(두 기록 job이 한 댓글을 차례로 고쳤다).
  - 상태 작성자는 모두 `harness-recorder[bot]`이다. 원장 토큰 단계가 성공했으므로 검증 App의 Pull requests 쓰기 권한이 적용됐다.
  - 아직 실제로 보지 못한 것: 2라운드 입력(`ledger.md`, 직전 판정 이후 diff)과 프롬프트 버전 고정, `ci-failure` job, 반박 전달. 2라운드와 프롬프트 고정은 이 PR의 다음 push에서, 반박은 step3 PR에서 확인한다.
- 2026-11-15 step2: AC 실행 결과. `node --test scripts/test/rebuttal.test.ts scripts/test/ledger.test.ts scripts/test/ci.test.ts` 종료 코드 0, `grep` 2개 통과, `node scripts/harness.ts check` 종료 코드 0.

## 의사결정 로그

- 원장은 PR 댓글 하나에 표(사람용)와 숨은 JSON(`<!-- harness-ledger:v1 … -->`, 기계용)을 함께 둔다. 기계는 JSON만 읽고 표는 JSON에서 다시 만든다. 이유: 표를 해석하면 셀 안의 `|`·줄바꿈으로 깨진다. 버린 대안: 리포 파일(작성자가 고칠 수 있다), 커밋 상태 description(140자).
- 두 판정 워크플로의 기록 job은 같은 job 단위 concurrency 그룹(`ledger-<PR 번호>`, 취소 없음, `queue: max`)으로 차례로 원장을 고친다. 이유: 한 댓글을 읽고-고치고-쓰므로 동시에 돌면 한쪽 변경이 사라진다. 버린 대안: 검증자마다 댓글을 따로 두기(P0 `rejected`처럼 두 검증자의 판정을 합쳐야 하는 규칙을 한곳에서 볼 수 없다).
- 숨은 자료는 JSON을 base64로 적는다. 이유: 제목에 `-->`가 있어도 주석이 일찍 닫히지 않고, 마크다운 해석과 무관하다. 사람은 표를 본다.
- `resolutions`는 스키마에서 필수로 둔다(빈 배열 허용). 이유: Codex 구조화 출력은 모든 속성이 `required`여야 한다. 검사기는 없어도 빈 배열로 받는다(옛 판정·시험 자료). Codex용 스키마에서는 `pattern`도 뺀다(형식은 검사기가 본다).
- 같은 head를 다시 판정해도 라운드로 센다. 같은 검증자·위치·제목의 지적은 다시 등록하지 않는다. 이유: 재실행으로 지적이 중복되거나 목표가 움직이지 않게 한다.
- 동결돼 `deferred`가 된 P1은 `review-ledger`를 막지 않는다. 이유: 설계서 10.2절 (5)가 "나머지는 `deferred`로 등록한다"고 정하고, (4)의 `deferred` 뜻이 "동결 규칙에 따라 후속 PR·tech-debt로 넘겼다"이다. 막으면 라운드마다 목표가 움직인다. P0과 바뀐 파일의 P1은 동결하지 않으므로 수정이 낳은 결함은 막는다. 버린 대안: `deferred` P1도 막기(Codex 검증자 제안. 동결 규칙이 뜻을 잃는다).
- 원장 댓글용 토큰은 상태용 토큰과 따로 받고, 그 단계는 실패해도 넘어간다(`continue-on-error`). 이유: 검증 App에 없는 권한을 요청하면 토큰 발급 자체가 실패한다. 한 토큰에 묶으면 권한 수락 전에 `review/*` 기록까지 멈춰 모든 PR이 막힌다.
- 판정 job은 원장을 API로 읽지 않는다. plan job(비밀 없음, `pull-requests: read`)이 읽어 job 출력(base64 JSON)으로 넘기고, 판정 job은 형식을 다시 검사해 입력을 만든다. 이유: 판정 job에 GitHub 토큰을 두지 않는 기존 규칙(10.4절)을 지킨다. 버린 대안: 입력 단계에만 읽기 토큰 주기(불변식을 약화한다).
- 원장 실패는 기록 job을 실패시키지 않고 `review-ledger = error`로만 남긴다. 이유: `review/*` 기록이 끝난 뒤의 일이고, 필수 체크가 되면 `error`가 병합을 막는다.
- 프롬프트 버전은 원장이 처음 만들어질 때의 base SHA다. 지적이 없던 라운드는 원장을 만들지 않으므로 그 뒤 첫 지적이 나온 라운드가 기준이 된다. 이유: 지적이 없는 PR에 댓글을 남기지 않는다. 지적이 없으면 고정할 대상(지적에 대한 재판정)도 없다.
- 반박은 PR 작성자 계정의 댓글만 본다. 이유: 요지 한 줄은 검증자에게 가는 글이라 쓸 수 있는 계정을 좁힌다. 제작자는 반박이 아니라 승인·Issue 댓글로 개입한다. 버린 대안: 모든 댓글(리포에 댓글을 달 수 있는 누구나 검증자 입력에 글을 넣는다).
- 반박 블록은 빈 줄로 구분된 정확히 세 줄 문단이다. 같은 댓글의 다른 문단(자유 글)은 버리고 블록만 쓴다. 이유: 설명을 곁들인 댓글도 쓸 수 있게 하되 검증자에게는 형식에 맞는 줄만 간다.
- 근거의 "리포 안 상대 경로"는 문자 집합과 `..` 금지만 본다(파일이 있는지는 보지 않는다). 짧은 SHA도 이 형식에 맞아 통과한다. 이유: 근거는 검증자가 직접 확인할 대상을 가리킬 뿐이고, 없는 경로면 검증자가 반박을 받아들이지 않는다.
- 지적 ID는 원장 전체에서 `F<번호>`로 차례로 붙인다(설계서 10.2절 (4) 예시). 검증자는 다음 라운드에 판정 스키마의 `resolutions: [{ id, status, note }]`로 원장 지적의 상태를 낸다. 남의 지적에 대한 판정은 P0 `rejected` 동의로만 쓴다.
- "바뀌지 않은 코드"는 직전 라운드 head와 지금 head 사이에 바뀌지 않은 파일로 판정한다(줄 단위가 아니다). 이유: 기계로 단순하게 판정할 수 있고, 수정된 파일의 새 결함은 놓치지 않는다. 한계: 수정된 파일 안의 옛 코드에 대한 뒤늦은 지적도 받는다.
- 원장 댓글을 쓰려면 검증 App에 Pull requests 쓰기 권한이 필요하다(지금은 읽기, 설계서 0.2절). 제작자 작업이라 step1에서 필요한 다른 작업과 함께 한 번에 요청한다(R20). 권한이 오기 전까지 step0은 순수 로직만 만든다.
- 재현 job은 판정 워크플로(`workflow_run`, main 정의) 안의 job으로 두고 권한·environment를 주지 않는다. 설계서 10.4절 표는 `pull_request_target`으로 적었지만 조건(main 정의, 비밀·쓰기 없음)은 같고, 판정 결과를 job 출력으로 바로 받을 수 있다. step3에서 설계서를 고친다.
- G1의 승인 기록은 원장 JSON의 `planReview`(해시, head, 검증자별 판정)에 둔다. 뒤 step의 PR은 계획이 main의 것과 해시가 같으면 통과한다. 이유: 계획은 첫 step PR에서 검증받고 main에 들어간다. 뒤 step에서 핵심 섹션을 고치면 그 PR에서 다시 계획 전용 커밋으로 검증받는다.

## 발견 사항

- #54 step4의 Claude 검증자 P2: `planCarry`의 patch-id 측정 실패 경로에 테스트가 없다. step0에서 테스트를 더한다. → 처리: 해당 없음
- 원장의 지적 ID는 `F1`~`F9999`만 형식에 맞다. 차단 지적이 그보다 많이 쌓이면 원장을 읽지 못해 `review-ledger`가 `error`가 된다(PR #83 Claude P2). 한 PR에서 일어나기 어렵고 fail-closed라 그대로 둔다. → 처리: 해당 없음
- 라운드 기록은 자르지 않아 판정이 아주 많이 쌓이면 원장 본문이 댓글 상한을 넘는다(PR #83 Codex P2). 그때는 `saveLedger`가 쓰지 않고 예외를 던져 `review-ledger = error`가 된다. → 처리: 해당 없음
- PR #85 Claude P2(원장 F1): `loadLedger`가 원장을 찾은 뒤에도 댓글을 끝까지 읽는다. 반박을 고르려면 모든 댓글이 필요해 plan job은 어차피 전부 읽는다. 기록 job의 읽기만 일찍 끝낼 수 있지만 댓글 수가 적어 그대로 둔다. → 처리: 해당 없음
- `Ledger`에 `dropped` 필드가 있다(step0 본문의 정의에는 없다, PR #83 Claude P3). 형식 문서에 적혀 있다. → 처리: [ledger.md](../../../../scripts/cross-review/ledger.md)
- 판정 워크플로의 `record` job은 `scripts`만 받아 `harness.config.json`이 없었다. 원장은 `ci.recorderBot`이 필요해 설정 파일도 받게 했다. → 처리: 해당 없음
- #54 step4의 Claude 검증자 P3: `CHANGELOG`의 설계서 v0.7.28 항목이 v0.7.24 항목 앞에 있다(main 병합 때 번호만 다시 매겼다). step0에서 순서를 맞춘다. → 처리: [CHANGELOG](../../../harness/CHANGELOG.md)

## 열린 질문

없음. 제작자 작업(검증 App 권한, 필수 체크 등록)은 step1·step5에서 요청한다.

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- 워크플로 변경은 main 병합 뒤 다음 PR에서 실제로 돈다(`workflow_run`은 main 정의). step1~4의 실제 동작은 다음 step의 PR에서 확인해 진행 로그에 남기고, step5에서 모아 확인한다.

## 다음 할 일

- step3(재현 job). 시작할 때 step2의 실제 동작(반박 전달)을 확인한다.
