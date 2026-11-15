---
id: 20261115-review-ledger
issue: 55 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
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
8. G1: 중·대 규모 계획은 코드 변경이 없는 커밋에서 필요한 검증자의 승인을 받아야 한다. `plan-gate`가 계획 핵심 섹션 해시(목표·수용 기준, 범위, 관련 파일, 모든 step의 작업·AC·금지사항)가 승인받은 해시와 같은지 확인한다. main에 이미 있는 계획과 해시가 같으면 다시 검증하지 않는다. `planReview.required: true`로 켠다.
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
- scripts/runner/prompt.ts
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
- step6 bind-prohibitions: step의 금지사항을 계획 해시와 자기 step 불변 규칙에 넣는다(PR #87 F2)

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
- 2026-11-15 step2: PR #85 병합(두 검증자 승인, 위험도 보통). 완료 처리 커밋의 판정에서 2라운드 입력과 프롬프트 버전 고정이 실제로 돌았다(실행 43696858234·43696858235): `review-plan: claude 2라운드, 프롬프트 버전 40e38e7a40ce, 직전 판정 이후 바뀐 파일 2`, `review-prompt: 프롬프트 버전 40e38e7a40ce`. Claude는 "직전 판정 이후 바뀐 것은 완료 표시와 로그뿐"이라고 판정했고, Codex는 "F1은 다른 검증자가 낸 지적이라 처리하지 않았다"고 적었다.
- 2026-11-15 step3: 테스트 먼저. `node --test scripts/test/repro.test.ts scripts/test/ledger.test.ts scripts/test/verdict.test.ts` 종료 코드 1(28개 중 5개 실패: `scripts/ci/repro.ts` 없음, `repro` 필드와 원장 규칙 없음). 구현 뒤 34개 통과.
- 2026-11-15 step3: `ci.repro` 설정을 더해 `harness-guard`가 `harness.config.json`의 `ci` 변경을 신호로 잡을 것이다(위험도 높음, 제작자 head 승인). PR 코드를 실행하는 job을 더하는 변경이라 초안으로 올리고 끝난 뒤 승인을 요청한다.
- 2026-11-15 step3: AC 실행 결과. `node --test scripts/test/repro.test.ts scripts/test/ledger.test.ts scripts/test/verdict.test.ts scripts/test/ci.test.ts` 종료 코드 0, `grep` 2개 통과, `node scripts/harness.ts check` 종료 코드 0.
- 2026-11-15 step3: PR #86 1차 판정(head cd8ff70). `review/claude` 승인(지적 없음), `review/codex` 수정 요청(P1 1: 재현 테스트에 러너의 `HOME`을 넘긴다). 원장에 F1(P1, codex, `open`)이 등록되고 `review-ledger = failure — 열린 차단 지적 1건: F1`이 기록됐다(차단 지적이 원장으로 병합을 막는 첫 실제 사례). `risk-gate`는 예상대로 위험도 높음(`harness.config.json`의 `ci` 변경).
- 2026-11-15 step3: F1 수정(지적이 타당해 반박하지 않았다). `HOME`이 러너의 것과 다르고 빈 폴더인지 보는 사례를 더했고, 옛 구현에서 종료 코드 1(7개 중 1개 실패), 새 구현에서 7개 통과를 확인했다. 재현 테스트의 `HOME`·임시 폴더를 실행용 빈 폴더로 바꿨다. `node scripts/harness.ts check` 종료 코드 0.
- 2026-11-15 step3: PR #86 2차 판정(head 47b588f, 실행 43698538681·43698538871). `review/claude` 승인(P2 1: 재현 job 권한이 step 본문의 `permissions: {}`와 다르다 → 원장 F2 `deferred`, 의사결정 로그에 이유가 있다), `review/codex` 2라운드 승인(`resolutions`로 F1을 `fixed`로 판정). 원장 F1이 `open` → `fixed`로 바뀌고 `review-ledger`가 `failure`(09:18:55, Claude 기록 시점) → `success`(09:19:29, Codex 기록 뒤)로 바뀌었다(수용 기준 2·3의 첫 실제 상태 전이). 제작자 head 승인(09:22) 뒤 병합.
- 2026-11-15 step4: 시작. GitHub 확인: 열린 PR 없음, `needs-human` 없음, Issue #55 열림. 병합 직후 main의 `check`(push) 완료로 두 판정 워크플로가 새 정의로 시작해 모든 job이 `skipped`로 끝났다(실행 43699190511·43699190423, `repro` job 포함. 문법 오류 없음). 재현 job은 아직 실제 PR에서 돈 적이 없다. 이 step의 PR 첫 판정에서 확인한다.
- 2026-11-15 step4: PR #86에서 본 것. Claude의 첫 판정(head cd8ff70, 지적 없음)은 원장이 생기기 전이라 라운드로 남지 않았고, 다음 판정(head 47b588f)이 "claude 1라운드"로 돌았다(`review-plan: claude 1라운드 … 바뀐 파일 알 수 없음`). 의사결정 로그("지적이 없던 라운드는 원장을 만들지 않는다")대로다. 전체를 다시 검토하는 쪽이라 놓치는 것은 없다. 발견 사항에 적었다.
- 2026-11-15 step4: 테스트 먼저. `node --test scripts/test/plan-hash.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts scripts/test/ci.test.ts` 종료 코드 1(파일 4개 모두 실패: `scripts/ci/plan-hash.ts` 없음, `ledger.ts`에 `applyPlanReview` 없음, `review-round.ts`에 `promptFiles` 없음. 테스트별 실패는 따로 보지 못했다). 구현 뒤 64개 통과.
- 2026-11-15 step4: 명령을 이어 붙인 테스트(`record.test.ts`, 가짜 GitHub API 서버)를 구현과 함께 썼다: `review-plan`(mode=plan, 해시) → `record-review --mode plan` 두 검증자 → 코드 추가 → `gates --pr-number`의 `plan-gate` 통과, 승인 뒤 다른 step의 AC를 고치면 실패, 원장 읽기 실패는 `error`. 처음에 한 번 실패했다(테스트가 `review-plan`이 쓴 `.harness-review/`를 함께 커밋해 계획 전용이 아니게 됐다. 테스트 리포에 `.gitignore`를 두어 고쳤다. CI는 매번 새로 체크아웃해 해당 없다).
- 2026-11-15 step4: AC 실행 결과. `node --test scripts/test/plan-hash.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts scripts/test/ci.test.ts` 종료 코드 0, `grep`·`test -f` 통과, `node scripts/harness.ts check` 종료 코드 0. `planReview.required`는 `false` 그대로다.
- 2026-11-15 step4: step3의 재현 job이 PR #87의 첫 판정(head 397f103)에서 처음 실제로 돌았다. 두 판정 워크플로 모두 `repro` job이 성공했고 로그는 `repro: 실행한 재현 테스트가 없다`다(실행 43701011453·43701011437). 판정 → 재현 → 기록 순서와 job 출력 연결은 확인됐다. 검증자가 재현 테스트를 붙인 지적이 없어 테스트를 실제로 붙여 실행하는 경로는 아직 보지 못했다(step5에서 정리한다).
- 2026-11-15 step4: PR #87 1차 판정(head 397f103). `review/claude` 승인(지적 없음), `review/codex` 수정 요청(P1 1: `prompt-plan.md`가 "위 검증 항목 대신 아래 항목으로 판정하라"고 해 공통 검증 기준을 바꾼다). 원장 F1(P1, codex, `open`), `review-ledger = failure`. `risk-gate`는 위험도 보통, `harness-guard` 통과(보호 경로 22개, 신호 없음), `plan-gate`는 완료 처리 전이라 실패. Claude의 판정은 원장이 생기기 전(09:50:09)이라 라운드로 남지 않았다(발견 사항의 그 경우다).
- 2026-11-15 step4: F1 수정(반박하지 않았다. 공통 기준을 바꾸지 않고 더하는 쪽이 맞다). `prompt-plan.md`를 "위의 신뢰 경계·검증 항목·라운드 규칙·등급·출력 형식은 그대로 적용하고 아래를 추가로 본다"로 고치고, 구현이 아직 없다는 것만으로는 지적하지 않게 적었다. `ci.test.ts`에 단언을 먼저 더해 옛 문구에서 종료 코드 1(33개 중 1개 실패), 고친 뒤 33개 통과를 확인했다.
- 2026-11-15 step4: PR #87 2차 판정(head 547eb17, 실행 43701623547·43701623625). `review/claude` 승인(P2 1: 승인 결속 범위에 step의 금지사항이 빠져 있다 → 원장 F2 `deferred`), `review/codex` 2라운드 승인(F1을 `fixed`로 판정). `review-ledger = success — 차단 지적 없음 (전체 2, 미룸 1)`. 병합(09:58, 위험도 보통). 병합 뒤 main의 `check`(실행 43701790548) 성공, 두 판정 워크플로는 PR이 아니라 건너뜀(실행 43701972285·43701972339).
- 2026-11-15 step5: 시작. GitHub 확인: 열린 PR 없음, `needs-human` 없음, Issue #55 열림, 필수 체크 7개 등록됨(`required-checks` 통과).
- 2026-11-15 step5: 제작자 결정(대화): PR #87 F2는 금지사항을 계획 해시에 넣는 것으로 처리한다. 자기 step 불변 규칙에도 금지사항을 더한다. `planReview.required`를 켜기 전에 이 step에서 한다(작업 1의 "기대와 다른 것은 이 step에서 고친다"). 수용 기준 8의 해시 대상 문구를 그에 맞게 고쳤다.
- 2026-11-15 step5: 수용 기준 8을 고치면 계획 해시가 main과 달라진다. 그래서 이 PR의 첫 push는 계획 파일만 담아 계획 검증(mode=plan)을 받는다. 계획 전용 커밋의 계획 검증과 원장의 계획 승인, `plan-gate`의 G1 판정을 실제 PR에서 확인하는 기회로 쓴다(작업 1).
- 2026-11-15 step5: PR #88 계획 검증 1차(head dd41c80, 실행 43703055110·43703055109). 계획 전용 커밋의 계획 검증이 실제 PR에서 처음 돌았다: plan job `review-plan: mode=plan, 계획 해시 61b9a21b9f55`, 판정 job `review-prompt: … 파일 prompt.md, prompt-plan.md`, 재현 job `실행한 재현 테스트가 없다`, 기록 job `계획 검증(G1) 해시 61b9a21b9f55 — review/claude 승인 아님`. 원장 댓글에 `계획 검증(G1): 해시 61b9a21b9f55 · 승인: 없음` 줄이 생겼다. `risk-gate`는 위험도 보통(계획 `risk`), `harness-guard`는 보호 경로 변경 없음.
- 2026-11-15 step5: 그 판정은 두 검증자 모두 수정 요청이다. Claude P1(원장 F1)·Codex P1(F3): 수용 기준 8에 금지사항 해시를 넣었는데 그것을 맡는 step의 작업·AC가 없다. Claude P2(F2, `deferred`): step5 작업 4의 "이 계획은 main의 것과 해시가 같다"가 사실과 달라졌다. `review-ledger = failure — 열린 차단 지적 2건: F1, F3`. 지적이 타당해 반박하지 않는다.
- 2026-11-15 step5: 두 검증자는 step5의 작업·AC에 더하라고 제안했지만 `plan-gate`가 실행 중인 step의 작업·AC 수정을 막는다(설계서 8.2절). 그래서 금지사항 해시 작업을 새 step6(`bind-prohibitions`)으로 더했다. step5는 그대로 두고 마지막 step이 step6이 된다(PR #88은 `Refs #55`). 제작자에게 알린다(대화).
- 2026-11-15 step5: PR #88 계획 검증 2차(head c9f0d4b, 실행 43703896693·43703896625). 두 검증자 2라운드 승인(지적 없음). 2라운드 입력과 프롬프트 고정이 계획 검증에서도 돌았다(`review-plan: claude 2라운드, 프롬프트 버전 9028a631c049, 직전 판정 이후 바뀐 파일 3`, `review-prompt: … 파일 prompt.md, prompt-plan.md`). 원장 F1·F3이 `open` → `fixed`, `review-ledger`가 `failure`(Claude 기록 시점) → `success`(Codex 기록 뒤). 기록 job 로그 `계획 검증(G1) 해시 0fc4d16a42b8 — review/claude 승인`·`review/codex 승인`, 원장 댓글 `계획 검증(G1): 해시 0fc4d16a42b8 · 승인: claude, codex · head c9f0d4ba94d0`. 해시가 1차(61b9a21b9f55)와 달라 이전 기록(승인 없음)이 새 해시로 바뀌었다. 계획 전용 커밋의 계획 검증과 원장의 계획 승인 기록을 실제 PR에서 확인했다(수용 기준 8·9).
- 2026-11-15 step5: 테스트 먼저. `node --test scripts/test/protection.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts` 종료 코드 1(`protection.test.ts` 파일 실패: `commands/init.ts`에 `requiredCheckGuide` export 없음. 테스트별 실패는 따로 보지 못했다). 구현과 설정(`ci.requiredChecks`에 `review-ledger`, `planReview.required: true`) 뒤 33개 통과. `node scripts/harness.ts check` 종료 코드 0.
- 2026-11-15 step5: `init` 출력만 보려고 `init --profile core`를 실행했다가 worktree의 `harness.config.json`이 다시 쓰였다(`init`은 `--repo`를 받지 않고 현재 리포에 적용한다). 커밋 전이라 그 파일을 HEAD로 되돌리고 의도한 두 곳만 다시 고쳤다. 안내 문구는 `requiredCheckGuide` 테스트로 확인한다.
- 2026-11-15 step5: 작업 1 정리. 실제 PR에서 확인한 것: 원장 댓글(작성자 `harness-recorder[bot]`, #85), 두 기록 job이 한 댓글을 차례로 고침(#85), 2라운드 입력·프롬프트 버전 고정(#85, #88), 상태 전이 `open` → `fixed`와 `review-ledger` failure → success(#86, #87, #88), 재현 job 실행과 job 출력 연결(#87, #88), 계획 전용 커밋의 계획 검증과 계획 승인(#88). 보지 못한 것: 검증자가 붙인 재현 테스트의 실제 실행(붙인 판정이 없었다), 반박 전달(지적이 모두 타당해 반박하지 않았다), 2라운드 동결(바뀌지 않은 파일의 새 P1이 없었다), `ci-failure` job(`check`가 실패한 PR head가 없었다). 이 넷은 단위 테스트와 명령 연결 테스트(`ledger.test.ts`, `rebuttal.test.ts`, `repro.test.ts`, `record.test.ts`)로만 확인했다.
- 2026-11-15 step5: PR #88 코드 검증(head 152e4ab, 실행 43704437892·43704437873, mode=code). `review/claude` 3라운드 승인(지적 없음), `review/codex` 수정 요청(P1, 원장 F4: 수용 기준 9의 `review-ledger` 필수 체크 등록과 `required-checks` 통과 근거가 진행 로그에 없다). 타당하다. 등록은 제작자 작업이라 아래처럼 요청했고, 등록 뒤 결과를 적는다. `gates`(실행 43704268584): `plan-gate` 상세에 `참고: G1(꺼짐): 계획 승인 확인(해시 0fc4d16a42b8, claude·codex)`. 판정 job이 원장을 읽어 G1을 (b) 경로로 확인하는 것을 실제 PR에서 봤다. `risk-gate`는 위험도 높음(`harness.config.json`의 `planReview`·`ci` 변경), `harness-guard`는 통과(보호 경로 8개, 신호 1건).
- 2026-11-15 step5: 제작자에게 요청(대화, 한 건): `review-ledger`를 main의 필수 상태 체크로 등록하고 출처를 검증 App `harness-recorder`로 지정. 절차는 [SECURITY.md](../../../SECURITY.md) "필수 체크 등록". 확인은 봇이 `node scripts/harness.ts required-checks`로 한다. 요청 전 확인: `review-ledger`는 PR #85·#86·#87·#88의 모든 판정에서 `harness-recorder[bot]`이 기록했다(금지사항 1).
- 2026-11-15 step5: 제작자가 `review-ledger`를 필수 체크로 등록했다(대화 통보). 확인: `GET repos/ariawell-hub/harness_project/branches/main`의 `protection.required_status_checks.checks`에 `review-ledger`가 `app_id` 5764201(검증 App `harness-recorder`)로 있다. `node scripts/harness.ts required-checks` 종료 코드 0(`✓ review-ledger: 출처 recorder(5764201)` 포함 8개 모두 통과, `required-checks: 통과`). 수용 기준 9의 등록이 끝났다(PR #88 F4).
- 2026-11-15 step5: AC 실행 결과. `node --test scripts/test/protection.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts` 종료 코드 0(33개 통과), `node scripts/harness.ts required-checks` 종료 코드 0, `grep -q '"required": true' harness.config.json` 통과.
- 2026-11-15 step5: PR #88 판정(head 033e52d, 실행 43706570531·43706570542). 두 검증자 4라운드 승인(지적 없음). Codex가 F4를 `fixed`로 판정했고 `review-ledger`가 `failure`(Claude 기록 시점) → `success — 차단 지적 없음 (전체 4, 미룸 1)`로 바뀌었다. `review-ledger`가 필수 체크로 등록된 뒤의 첫 판정이다. `risk-gate`는 위험도 높음이라 완료 처리 뒤 제작자 head 승인을 요청한다.
- 2026-11-15 step5: PR #88 병합(11:11, 제작자 head 승인 95e0138 뒤 `risk-gate` 통과, 자동 병합). 완료 커밋의 판정에서 두 검증자 승인, `plan-gate` 통과.
- 2026-11-15 step6: 시작. GitHub 확인: 열린 PR 없음, `needs-human` 없음, Issue #55 열림, `required-checks` 통과(8개). 작업 6: 열린 PR이 없으므로 원장에 계획 승인이 기록된 채 열린 PR도 없다. 해시 정의를 바꿔도 무효가 되는 승인이 없다.
- 2026-11-15 step6: 제작자 결정(대화): PR #88 F2(step5 작업 4의 괄호)는 step5.md를 고치지 않고 발견 사항에 남긴다. 켜진 상태의 `plan-gate` 통과는 이 PR에서 확인해 적는다.
- 2026-11-15 step6: 테스트 먼저. `node --test scripts/test/plan-hash.test.ts scripts/test/plan-gate.test.ts scripts/test/gates.test.ts` 종료 코드 1(24개 중 3개 실패: 금지사항을 고쳐도 해시가 같다, 승인 뒤 금지사항을 고쳐도 G1이 통과한다, 자기 step의 금지사항을 지워도 통과한다). 구현 뒤 24개 통과. "금지사항을 고쳐도 해시가 같다"던 단언은 "읽어야 할 파일만 고치면 같다"로 바꾸고 금지사항은 "다르다" 쪽으로 옮겼다.
- 2026-11-15 step6: AC 실행 결과. 위 테스트 명령 종료 코드 0, `grep -q "STEP_BOUND_SECTIONS"` 두 개 통과, `node scripts/harness.ts check` 종료 코드 0.
- 2026-11-15 step6: PR #89 판정(head 8ee9ed5). `gates`(실행 43708109196)는 main의 설정(`planReview.required: true`)으로 돈 첫 실행이다. `plan-gate` 상세에 G1 실패도 `G1(꺼짐)` 참고 줄도 없다. 계획 핵심 섹션이 main과 같아 (a) 경로로 통과했고 원장을 읽지 않았다(plan job 로그 `mode=code, 계획 해시 0fc4d16a42b8`, PR #88에서 승인받은 해시와 같다). `plan-gate`의 실패 두 건은 완료 처리 전이라 나온 것이다. `risk-gate` 위험도 보통, `harness-guard` 통과(보호 경로 10개).
- 2026-11-15 step6: 두 검증자 1라운드 승인(지적 없음, 실행 43708293802·43708293786). `review-ledger = success — 원장 없음(등록된 지적이 없다)`. 지적이 없는 PR에서도 필수 체크 `review-ledger`가 기록되는 것을 확인했다(원장 댓글은 만들지 않는다).

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
- 재현 job의 권한은 `permissions: {}`가 아니라 `contents: read`다(step3 본문과 다르다). 이유: 비공개 리포는 체크아웃에 읽기 권한이 필요하다. 체크아웃은 자격증명을 남기지 않고(`persist-credentials: false`), 그 토큰으로 할 수 있는 일은 PR 작성자가 이미 가진 읽기뿐이다.
- "재현됨"은 테스트가 실패하고 출력에 단언 실패(`ci.repro.failPattern`)가 보일 때만이다. 이유: 검증자는 테스트를 실행해 볼 수 없어 문법·import 오류가 있는 테스트를 낼 수 있다. 그것을 재현으로 세면 동결 예외가 잘못 열린다.
- 재현 테스트는 판정 하나에 3개, 파일 하나에 4000자까지다. 이유: 판정은 job 출력과 환경 변수로 넘어가 크기 한도(약 128KB)가 있다. 넘는 판정은 형식 오류(error)다.
- 재현 job은 의존성을 설치하지 않는다. 이유: 이 리포는 의존성이 없다. 의존성이 필요한 프로파일은 `ci.repro`를 켤 때 설치 단계를 함께 설계한다(비밀이 없는 job이라 설치 스크립트 실행 자체는 허용할 수 있다).
- 지적 ID는 원장 전체에서 `F<번호>`로 차례로 붙인다(설계서 10.2절 (4) 예시). 검증자는 다음 라운드에 판정 스키마의 `resolutions: [{ id, status, note }]`로 원장 지적의 상태를 낸다. 남의 지적에 대한 판정은 P0 `rejected` 동의로만 쓴다.
- "바뀌지 않은 코드"는 직전 라운드 head와 지금 head 사이에 바뀌지 않은 파일로 판정한다(줄 단위가 아니다). 이유: 기계로 단순하게 판정할 수 있고, 수정된 파일의 새 결함은 놓치지 않는다. 한계: 수정된 파일 안의 옛 코드에 대한 뒤늦은 지적도 받는다.
- 원장 댓글을 쓰려면 검증 App에 Pull requests 쓰기 권한이 필요하다(지금은 읽기, 설계서 0.2절). 제작자 작업이라 step1에서 필요한 다른 작업과 함께 한 번에 요청한다(R20). 권한이 오기 전까지 step0은 순수 로직만 만든다.
- 재현 job은 판정 워크플로(`workflow_run`, main 정의) 안의 job으로 두고 권한·environment를 주지 않는다. 설계서 10.4절 표는 `pull_request_target`으로 적었지만 조건(main 정의, 비밀·쓰기 없음)은 같고, 판정 결과를 job 출력으로 바로 받을 수 있다. step3에서 설계서를 고친다.
- G1의 승인 기록은 원장 JSON의 `planReview`(해시, head, 검증자별 판정)에 둔다. 뒤 step의 PR은 계획이 main의 것과 해시가 같으면 통과한다. 이유: 계획은 첫 step PR에서 검증받고 main에 들어간다. 뒤 step에서 핵심 섹션을 고치면 그 PR에서 다시 계획 전용 커밋으로 검증받는다.
- 계획 해시(`planHash`)는 `plan.md`의 세 섹션과 계획 폴더의 모든 `step<N>.md`(번호순)의 두 섹션을 `[이름, 본문]` 목록의 JSON으로 만들어 sha256(64자)을 낸다. 본문은 줄 끝 공백과 섹션 앞뒤 빈 줄을 뗀다. 경로(`active/`·`completed/`)·frontmatter·`index.json`은 넣지 않는다. 이유: 완료 처리(상태·위치 이동)와 진행 로그로는 해시가 바뀌지 않아야 한다. step 파일은 `index.json`이 아니라 폴더 목록에서 찾는다(상태 파일이 해시 대상을 정하지 않게 한다).
- `plan-gate`(`gates/`)는 해시를 직접 계산하지 않는다. `ci/gates.ts`와 CLI가 `ci/plan-hash.ts`로 계산해 `g1`(지금 해시, merge-base 해시, 원장의 계획 승인)로 넘긴다. 이유: 레이어 규칙(`gates/`는 `ci/`를 import하지 않는다). runner처럼 `g1`을 넘기지 않는 호출은 G1을 확인하지 않고 참고만 남긴다. 최종 판정은 CI의 `plan-gate`다(설계서 4.1절).
- `mode=plan`은 "PR의 merge-base 대비 변경이 모두 이 브랜치 계획의 폴더(`active/<id>/`·`completed/<id>/`) 안"일 때다. 커밋 하나가 아니라 PR 전체로 본다. 이유: 검증자는 PR 전체 diff를 보므로, 앞 커밋에 코드가 있으면 그 판정은 계획만 본 것이 아니다. 코드를 먼저 올렸다면 되돌리는 커밋으로 계획만 남긴 뒤 검증받는다.
- 계획 승인은 `mode=plan`인 head에서 `review/<검증자>`가 success일 때 기록한다(승인 판정, 위험도 기준 "해당 없음", 이어받음). failure면 그 검증자의 승인을 지우고, error면 그대로 둔다. `plan-gate`는 두 검증자가 모두 `approvals`에 있어야 통과시킨다. 이유: 필요한 검증자는 판정 워크플로의 plan job이 그 커밋에서 정한다. `plan-gate`가 뒤 커밋에서 다시 계산하면 코드가 섞인 diff의 위험도로 바뀐다. 버린 대안: `plan-gate`가 계획 `risk`로 필요한 검증자를 다시 계산(계산이 두 곳으로 갈린다).
- 계획 승인이 있으면 지적이 없어도 원장 댓글을 만든다. 이유: 승인을 둘 곳이 원장뿐이다. 이때부터 라운드도 기록되고 프롬프트 버전이 고정된다.
- 원장의 `planReview`는 없어도 되는 필드다(버전은 1 그대로). 이유: 이 변경 전에 만들어진 원장 댓글을 그대로 읽어야 한다.
- `planReview.required`가 `false`인 동안에도 `plan-gate`는 G1을 계산해 결과를 참고(`G1(꺼짐)`)로 남긴다. 이유: step5에서 켜기 전에 실제 PR에서 원장 읽기와 판정을 볼 수 있어야 한다(step4 금지사항). 꺼져 있을 때 원장을 읽지 못하면 참고로만 남기고, 켜져 있으면 `plan-gate`가 `error`다(fail-closed).
- `prompt-plan.md`는 `review-prompt --mode plan`이 첫 파일 바로 뒤에 붙인다(Codex는 꼬리말 앞). 프롬프트 버전이 이 파일이 생기기 전 커밋으로 고정된 PR이 계획 전용이 되면 판정이 실패하는데, 지금 열린 PR이 없어 해당하는 PR이 없다(2026-11-15 확인).
- 계획 검증 프롬프트는 공통 검증 항목을 대신하지 않고 더한다(PR #87 F1). 이유: 계획만 바꾼 PR에도 신뢰 경계·범위·문서·보안 항목은 그대로 해당한다. 구현이 없다는 것만으로 지적하지 않게 하는 문장만 따로 둔다. 버린 대안: 계획 전용 항목으로 바꿔 판정(검증자가 공통 기준을 건너뛸 수 있다).
- step의 "금지사항"도 계획 해시와 자기 step 불변 규칙에 넣는다(제작자 결정 2026-11-15, PR #87 F2). 이유: 검증자는 금지사항까지 읽고 계획을 승인하고 코드 검증도 금지사항을 기준으로 본다. 승인 뒤 금지사항을 지우는 것은 AC를 약하게 고치는 것과 같은 우회다(설계서 8.2절). "읽어야 할 파일"은 넣지 않는다(안내이고 구현 중에 자주 고친다). 버린 대안: 금지사항이 해시에 없다고 문서에만 적기(틈이 그대로 남는다).
- 금지사항 해시는 step5가 아니라 새 step6에서 한다(PR #88 F1·F3). 이유: 수용 기준마다 그것을 맡는 step의 작업·AC가 있어야 하는데, 실행 중인 step5의 작업·AC는 고칠 수 없다(`plan-gate`). 버린 대안: step5 작업 1의 "기대와 다른 것은 이 step에서 고친다"로 보고 step5에서 하기(해시가 금지사항을 포함하는지 판정하는 AC가 없어 새 세션이 하지 않고 끝낼 수 있다), 반박하기(지적이 타당하다).
- `planReview.required`는 step5에서 켜고 해시 정의는 step6에서 바꾼다. 처음에는 켜기 전에 바꾸려 했다. 순서가 바뀌어도 무효가 되는 승인이 없다: 해시 정의가 바뀔 때 영향받는 것은 "원장에 계획 승인이 기록된 채 열려 있는 다른 PR"뿐이고, step6이 병합 전에 그런 PR이 없는지 확인한다(step6 작업 6). step6 PR 자신은 계획이 main과 같아 다시 검증받지 않는다(판정은 main의 옛 정의로 지금과 base를 함께 계산한다).
- step5 작업 4의 "(이 계획은 main의 것과 해시가 같다)"는 고치지 않는다(PR #88 F2). 실행 중인 step의 작업이라 고칠 수 없다. 이 PR의 계획 해시는 main과 다르고, `plan-gate`의 G1은 이 PR의 계획 전용 커밋에서 받은 계획 승인의 해시로 확인된다. CI의 `gates`는 main의 설정으로 돌아 `planReview.required: true`는 병합 뒤 PR부터 적용되므로, 이 PR에서는 `plan-gate` 상세의 `G1(꺼짐)` 줄로 판정 결과를 본다.
- `init` 안내의 필수 체크 목록은 문구로 적지 않고 설정(`ci.requiredChecks`)에서 만든다(`requiredCheckGuide`). 이유: 체크를 더할 때 안내와 설정이 어긋나지 않는다(이번에 `review-ledger`를 더하며 두 곳을 고쳐야 했다).
- `review-ledger`는 `review/*`와 같은 조건으로 등록한다. 이유: 기록 job이 `review/*`를 쓸 때마다 `review-ledger`도 쓴다(판정 없음·해당 없음·이어받음·원장 실패 포함). `review/*`가 기록되는 PR에서 `review-ledger`만 빠지는 경로가 없다.

## 발견 사항

- #54 step4의 Claude 검증자 P2: `planCarry`의 patch-id 측정 실패 경로에 테스트가 없다. step0에서 테스트를 더한다. → 처리: 해당 없음
- 원장의 지적 ID는 `F1`~`F9999`만 형식에 맞다. 차단 지적이 그보다 많이 쌓이면 원장을 읽지 못해 `review-ledger`가 `error`가 된다(PR #83 Claude P2). 한 PR에서 일어나기 어렵고 fail-closed라 그대로 둔다. → 처리: 해당 없음
- 라운드 기록은 자르지 않아 판정이 아주 많이 쌓이면 원장 본문이 댓글 상한을 넘는다(PR #83 Codex P2). 그때는 `saveLedger`가 쓰지 않고 예외를 던져 `review-ledger = error`가 된다. → 처리: 해당 없음
- PR #85 Claude P2(원장 F1): `loadLedger`가 원장을 찾은 뒤에도 댓글을 끝까지 읽는다. 반박을 고르려면 모든 댓글이 필요해 plan job은 어차피 전부 읽는다. 기록 job의 읽기만 일찍 끝낼 수 있지만 댓글 수가 적어 그대로 둔다. → 처리: 해당 없음
- `Ledger`에 `dropped` 필드가 있다(step0 본문의 정의에는 없다, PR #83 Claude P3). 형식 문서에 적혀 있다. → 처리: [ledger.md](../../../../scripts/cross-review/ledger.md)
- 판정 워크플로의 `record` job은 `scripts`만 받아 `harness.config.json`이 없었다. 원장은 `ci.recorderBot`이 필요해 설정 파일도 받게 했다. → 처리: 해당 없음
- #54 step4의 Claude 검증자 P3: `CHANGELOG`의 설계서 v0.7.28 항목이 v0.7.24 항목 앞에 있다(main 병합 때 번호만 다시 매겼다). step0에서 순서를 맞춘다. → 처리: [CHANGELOG](../../../harness/CHANGELOG.md)
- 원장이 생기기 전의 판정(지적 없음)은 라운드로 남지 않는다. 그 검증자의 다음 판정은 1라운드로 돌아 전체를 다시 검토한다(PR #86의 Claude). 계획 승인으로 원장이 먼저 생기는 PR(G1)에서는 첫 판정부터 라운드가 남는다. → 처리: 해당 없음
- PR #87 Claude P2(원장 F2): 계획 검증 프롬프트는 step의 금지사항까지 읽으라고 하는데 계획 해시에는 금지사항이 없었다. 승인 뒤 금지사항을 지워도 다시 검증받지 않는다. step6에서 해시와 자기 step 불변 규칙에 넣는다(의사결정 로그). → 처리: [step6](step6.md)
- 실행 중인 step의 작업·AC는 계획 전용 커밋으로 검증자 승인을 받아도 고칠 수 없다. 계획 검증이 "이 step에 일을 더하라"고 지적하면 새 step을 더하는 길뿐이다(PR #88). 규칙의 목적(실행 PR이 자기 AC를 약하게 고치는 것을 막는다)에는 맞지만, G1이 켜진 뒤에는 "계획 승인을 받은 자기 step 수정"을 허용할지 따로 정할 수 있다. → 처리: 해당 없음
- PR #88 Claude P2(원장 F2): step5 작업 4의 "(이 계획은 main의 것과 해시가 같다)"는 그 PR에서 사실과 달랐다(수용 기준 8을 고쳐 해시가 달라졌고, G1은 계획 전용 커밋의 승인으로 확인됐다). 완료된 step의 지시문이고 해시 대상이라 고치지 않는다(제작자 결정 2026-11-15). 고치면 계획을 다시 검증받아야 하고 그 문장을 다시 실행할 세션이 없다. → 처리: 해당 없음
- step5 작업 4의 "켠 뒤 `plan-gate`가 통과하는지 본다"는 PR #88에서 `G1(꺼짐)` 참고 줄로만 볼 수 있었다. CI의 `gates`가 main의 설정으로 돌기 때문이다. `planReview.required: true` 아래에서 도는 첫 PR은 step6의 PR이고 결과는 진행 로그에 적는다. → 처리: 해당 없음

## 열린 질문

없음. 제작자 작업(검증 App 권한, 필수 체크 등록)은 step1·step5에서 요청한다.

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- 워크플로 변경은 main 병합 뒤 다음 PR에서 실제로 돈다(`workflow_run`은 main 정의). step1~4의 실제 동작은 다음 step의 PR에서 확인해 진행 로그에 남기고, step5에서 모아 확인한다.

## 다음 할 일

- 이 계획은 step6으로 끝난다(Issue #55). 다음은 #56(runner 연결)이다. #56은 중·대 규모 새 계획이면 계획만 담은 커밋으로 먼저 계획 검증을 받아야 한다(`planReview.required: true`, 절차서 2절).
- 실제 PR에서 보지 못한 것(진행 로그 "작업 1 정리"): 재현 테스트의 실제 실행, 반박 전달, 2라운드 동결, `ci-failure` job. #56·#57의 PR에서 기회가 생기면 확인한다.
