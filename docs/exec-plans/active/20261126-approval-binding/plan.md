---
id: 20261126-approval-binding
issue: 250 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-26T13:24:52+09:00 # new-task가 채운다
---

# 제작자 승인을 하네스가 head에 직접 묶고, main 병합만 더한 갱신에는 이어받는다

## 목표와 수용 기준

PR #226에서 제작자 승인은 2026-11-25T04:36:27Z에 head `5027f12`에 달렸다. 그 뒤 봇이 `origin/main` 병합 커밋 둘(`c5d5338`, `a1aae51`)을 올렸는데 두 head 모두 `risk-gate`가 "제작자 head 승인"으로 success였고, 제작자가 새 head를 승인하지 않은 채 병합됐다. REST `pulls/226/reviews`와 GraphQL `PullRequestReview.commit` 모두 그 리뷰의 커밋을 `a1aae51`로 돌려준다. GitHub이 리뷰의 커밋을 새 head로 옮겨 보고한다. `scripts/gates/risk-gate.ts`의 `ownerApprovedHead`는 "제작자의 마지막 판정 리뷰가 승인이고 `commitId === headSha`"로 보므로, 그 커밋 값에 따라 승인이 새 head로 넘어간다. 일반 커밋에서도 GitHub이 리뷰의 커밋을 옮기는지는 확인하지 못했다(최근 60개 PR에서 승인 뒤에 올라온 커밋은 #226의 main 병합 둘뿐이었다).

제작자 결정(2026-11-26 대화): 하네스가 승인을 직접 head에 묶는다. **승인받은 head와 PR 내용이 같고 main 병합만 더한 갱신은 승인을 이어받고**, 다른 커밋이 더해지면 다시 승인받는다(검증자 승인 이어받기, 설계서 10.3절과 같은 꼴).

수용 기준:

1. `risk-gate`는 리뷰가 보고하는 커밋(`commit_id`)에 기대지 않고, 제작자의 마지막 판정 리뷰(승인)가 **제출된 시각에 PR의 head였던 커밋**(승인 head, H0)을 하네스가 정한다. H0는 이 PR의 커밋 가운데 GitHub Actions App(`ACTIONS_APP_ID`)이 PR head 브랜치에서 만든 check suite의 첫 생성 시각이 리뷰 제출 시각보다 엄격히 앞선 것 중 가장 늦은 것이다(check suite의 생성 시각은 GitHub 서버 시각이고 봇이 만들 수 없다). H0의 첫 suite 시각이 제출 60초 안이면 승인 head가 모호하다고 보고 승인으로 보지 않는다(같은 초, 시계 차이, 승인 직전 push). PR에 head 강제 push 이벤트가 하나라도 있으면(시각과 무관하게) 승인으로 보지 않는다: 강제 push가 있으면 suite 시각(지연될 수 있다)으로 제출 때의 head를 복원할 수 없다(강제 push로 사라진 승인 head, 강제 push 뒤 늦게 생긴 옛 head의 suite). 그런 PR은 새 PR로 다시 올린다.
2. 지금 head가 H0면 승인이다(지금과 같다).
3. 지금 head가 H0가 아니면 다음을 모두 만족할 때만 승인을 이어받는다. 하나라도 아니면 `제작자 head 승인 필요`로 실패한다.
   - H0가 지금 head의 조상이다(강제 push로 이력이 바뀌지 않았다).
   - H0 이후 더한 커밋이 main 병합뿐이다: H0..head에서 main에 없는 커밋이 모두 병합 커밋이고, 각 병합의 첫째 부모를 뺀 부모가 main의 조상이다(빈 일반 커밋, 바꿨다 되돌린 일반 커밋, main이 아닌 브랜치 병합은 이어받지 않는다).
   - H0와 지금 head의 patch-id(각자 main과의 merge-base에서 그 커밋까지의 diff)가 같다.
   - PR이 바꾼 파일의 내용이 H0와 지금 head에서 바이트 단위로 같다.
   - H0 이후 main에서 바뀐 파일이 PR이 바꾼 파일과 겹치지 않는다.
     이어받으면 상태 설명에 `제작자 head 승인 이어받음 <H0 12자리>`를 적는다.
4. 리뷰·check suite·PR 커밋을 읽지 못하거나 H0를 정하지 못하면 승인으로 보지 않는다(fail-closed, `error` 또는 `failure`. 지금 리뷰를 못 읽을 때와 같은 꼴).
5. 승인 뒤 일반 커밋이 더해진 head는 GitHub이 리뷰의 커밋을 무엇으로 보고하든 승인으로 보지 않는다(테스트로 단언). 이어받기 조건은 실제 git 이력을 만든 테스트로 본다.
6. 설계서 10.3절과 절차서 5절("승인 요청 전 조건", "위험도 높음")의 승인 규칙을 위 규칙으로 맞춘다. 승인 요청 뒤 main 병합 갱신은 다시 승인받지 않아도 된다는 것을 적는다.
7. 병합 뒤 테스트 리포(`ariawell-hub/harness-ops-lab`)에서 실제로 확인한다(step1): 승인 뒤 main 병합만 더한 head는 이어받고, 일반 커밋을 더한 head는 다시 승인을 요구하며, 그때 GitHub이 리뷰의 커밋을 무엇으로 보고하는지 기록한다.

## 범위 / 비범위

범위:

- `scripts/gates/risk-gate.ts`(승인 head 결정과 이어받기 판정), `scripts/ci/gates.ts`(필요한 자료를 읽어 넘긴다. 판정 job의 `GH_TOKEN`은 `checks: read`·`pull-requests: read`가 있다), `scripts/ci/binding.ts`(이어받기 판정 함수를 더하고 `samePrContent`·`changedOnBaseSince`를 재사용. `patchId`에 비교 끝 인자를 더하되 기본 동작은 그대로), `scripts/harness.ts`의 `gates` 명령(읽기 함수를 만들어 넘긴다), `scripts/ci/protection.ts`의 `ACTIONS_APP_ID` 재사용(읽기만, `ci/gates.ts`가 가져와 판정 함수에 넘긴다).
- 테스트: `scripts/test/risk-gate.test.ts`, 새 파일 `scripts/test/risk-gate-approval.test.ts`, `scripts/test/ci.test.ts`(`gates`가 위험도 높음일 때만 읽고 지금 설정으로 승인이 success가 되는지), `scripts/test/harness-guard.test.ts`의 `runGates` 승인 테스트 하나(리뷰의 `commitId`로 승인하던 입력에 승인 자료를 더한다. 단언은 그대로).
- 문서: 설계서 10.3절·10.4절의 해당 문장, 절차서 5절, 변경 조각.
- step1: `lab/approval-binding/`(실측 절차와 결과).

비범위:

- 워크플로 파일(`.github/workflows/`). 판정 job의 권한과 리뷰 조회는 그대로 쓴다.
- 브랜치 보호 설정(최신 상태 요구 등). 제작자만 바꿀 수 있다(R20).
- 검증자 승인 이어받기(`review/*`)의 규칙. 위험도 높음은 지금처럼 다시 판정한다.
- 승인 요청 뒤 main 병합 push를 L1 훅이 막는 문제(Issue #243, PR #244가 다룬다).

## 관련 파일·문서

- `scripts/gates/risk-gate.ts`
- `scripts/ci/gates.ts`
- `scripts/ci/binding.ts`
- `scripts/harness.ts`
- `scripts/test/risk-gate.test.ts`
- `scripts/test/risk-gate-approval.test.ts`
- `scripts/test/ci.test.ts`
- `scripts/test/harness-guard.test.ts`(신호로 높음이 된 PR의 `runGates` 승인 테스트 하나)
- `docs/harness/design.md`
- `docs/harness/workflow.md`
- `docs/harness/changes/20261126-approval-binding-s0.md`
- `docs/harness/changes/20261126-approval-binding-s1.md`
- `lab/approval-binding/**`
- `docs/exec-plans/active/20261126-approval-binding/**`
- 읽기만: `.github/workflows/gates.yml`, `scripts/ci/protection.ts`, `scripts/ci/review-plan.ts`, `scripts/lib/github.ts`, `docs/SECURITY.md`("테스트 리포 준비"), `lab/ops-transition/README.md`

## step 목록

- step0 bind: 승인 head를 하네스가 정하고, main 병합만 더한 갱신에 이어받는다. 테스트 먼저.
- step1 live: 병합 뒤 테스트 리포에서 두 경우(main 병합만, 일반 커밋)를 실제로 확인하고 GitHub의 리뷰 커밋 보고를 기록한다(제작자의 승인 두 번이 필요하다).

## 진행 로그

- 2026-11-26 접수: 제작자가 대화에서 남은 지적을 Issue로 열어 고치라고 지시했고 봇이 Issue #250을 등록했다. 방향은 대화에서 물어 "main 병합만은 이어받기"로 정해졌다. `new-task --issue 250 --slug approval-binding --type fix --size large --risk high`로 시작했다(main `4816af5`).
- 2026-11-26 읽은 것: `risk-gate`는 `gates` 워크플로의 판정 job(`evaluate`)이 미리 읽은 리뷰 JSON(`gh api pulls/<N>/reviews`)으로 판정한다. 그 job의 `GH_TOKEN`은 `contents`·`pull-requests`·`checks` 읽기이고 PR 이력 전체(`fetch-depth: 0`)를 체크아웃한다. 커밋 상태 읽기(`statuses`)는 없어 검증자 이어받기(`fetchCandidates`)처럼 앞선 head의 상태를 읽을 수는 없다. 자체 테스트 시나리오에는 `risk-gate`가 없다.
- 2026-11-26 계획 검증 1회차(head `20fb62c`): Claude 승인(P2 둘), Codex 수정 요청(P0 하나, P1 넷, P2 하나). 모두 받아들였다.
  - F3(P0, 승인과 같은 초에 생긴 새 head의 suite가 H0로 잡힐 수 있다) → "이하"를 "엄격히 앞선"으로 바꾸고, 커밋마다 가장 이른 suite를 쓰며, H0의 첫 suite가 제출 60초 안이면 모호하다고 보고 다시 승인받게 했다(수용 기준 1, step0 작업 1과 테스트). suite 시각은 push 뒤에만 생기므로 H0는 제출 때의 진짜 head이거나 그보다 앞선 커밋이고, 앞선 커밋이면 이어받기 조건이 더 엄격해질 뿐이다. 남는 위험은 같은 초와 서비스 사이 시계 차이라 60초 창으로 막는다.
  - F4(P1, 이어받기 조건이 main 병합만 더했는지 보지 않는다. 빈 일반 커밋이 통과한다) → 조건 "H0 이후 더한 커밋이 main 병합뿐"을 더했다(수용 기준 3, step0 작업 2 (나)). 빈 일반 커밋, 바꿨다 되돌린 커밋, main이 아닌 병합을 실제 git 테스트로 본다.
  - F5(P1, Claude P2와 같은 지적. 설정에 Actions App id가 없다) → `scripts/ci/protection.ts`의 `ACTIONS_APP_ID`를 쓴다(필수 체크 출처 `actions`의 매핑과 같다). 지금 설정으로 정당한 승인이 success가 되는 테스트를 더했다.
  - F6(P1, 있는 `patchId`는 비교 끝이 `HEAD`로 고정돼 H0의 patch를 못 구한다) → `patchId`에 비교 끝 인자(기본 `HEAD`)를 더하고 H0와 head를 각자의 merge-base에서 계산한다. 이어받기 판정을 `binding.ts`의 함수 하나로 모아 실제 git 이력으로 테스트한다.
  - F7(P1, step1 AC가 두 사례의 결과와 리뷰 기록을 정확히 보지 않는다) → 사례마다 상태(success/failure)와 설명, head·리뷰 API 커밋(40자)·시각이 있는지 단언하게 고쳤다.
  - F8(P2, Claude P2와 같은 지적. `scripts/harness.ts`, `scripts/test/ci.test.ts`가 관련 파일에 없다) → 범위와 관련 파일에 더했다.
- 2026-11-26 PR #226 자료로 규칙을 맞춰 봤다: 승인 `2026-11-25T04:36:27Z`. Actions suite의 첫 시각은 `5027f12` `03:40:49Z`, `c5d5338` `2026-11-26T00:19:29Z`, `a1aae51` `2026-11-26T03:09:08Z`라 H0는 `5027f12`다. `5027f12`에는 승인 뒤 `04:36:30Z`에도 suite가 생겼다(리뷰 뒤 재판정). 그래서 커밋마다 가장 이른 suite를 쓴다.
- 2026-11-26 계획 검증 2회차(head `e6729c4`): Claude 승인(지적 없음, F3~F7 해소로 봄), Codex 수정 요청(P0 하나, P1 하나). 둘 다 받아들였다.
  - F9(P0, 승인한 A가 강제 push로 PR 커밋 목록에서 사라지고 예전에 suite가 있던 B로 head가 돌아오면 B가 H0가 된다) → H0의 첫 suite 시각 이후에 강제 push 이벤트가 있으면 승인 아님(수용 기준 1, step0 작업 1·4와 테스트). 강제 push가 없으면 그 뒤의 head는 모두 지금 head의 조상이라 제출 때의 head가 후보에서 빠지지 않는다. 리뷰 이벤트에서 head를 기록해 두는 길은 워크플로 변경이 필요해 버렸다(의사결정 로그). suite 지연 사례 테스트도 더했다.
  - F10(P1, `gates/risk-gate.ts`가 `ci/protection.ts`를 가져오면 한 방향 의존을 어긴다) → `ci/gates.ts`가 `ACTIONS_APP_ID`를 넘긴다. AC의 상수 이름 grep을 `gates/`에서 `ci/`를 가져오지 않는지 보는 줄로 바꾸고, 판정에 쓰는 App id는 동작 테스트로 본다.
- 2026-11-26 확인: 강제 push 이벤트는 GraphQL `timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT])`로 읽는다. #226에서 `nodes`는 비었고 `totalCount`는 39(거르기 전 수)라 `nodes`만 쓴다. `gates` 워크플로는 이미 같은 job 토큰으로 GraphQL PR 조회(`ci-pr`, `scripts/ci/pr.ts`)를 한다.
- 2026-11-26 계획 검증 3회차(head `4ef98e1`): Claude 승인, Codex 수정 요청(P1 하나). 받아들였다. F11(강제 push 이력 등 실제 읽기 경로가 첫 쪽만 읽거나 뒤 쪽 오류를 빈 목록으로 다뤄도 테스트가 통과한다) → 읽기를 `gates.ts`의 내보낸 함수 `readApprovalInputs`로 두고 가짜 `api`·`graphql`로 여러 쪽 합치기, 뒤 쪽 오류·틀린 응답 꼴의 `null`, 250개 상한, `totalCount`를 쓰지 않는 것을 테스트하게 했다(step0 작업 4·5, AC 한 줄).
- 2026-11-26 계획 검증 4회차(head `fb5672c`): Claude 승인, Codex 수정 요청(P1 하나, F12: check suite 조회의 기본 `latest` 필터가 최초 suite를 빠뜨릴 수 있으니 `filter=all`을 쓰라). 반박한다. 확인(2026-11-26, `commits/5027f12…/check-suites`): 쿼리 없이, `?filter=latest`, `?filter=all` 세 경우 모두 Actions suite 넷(`03:40:49Z`, `03:40:51Z`, `04:18:30Z`, 승인 뒤 `04:36:30Z`)을 같게 돌려준다. `filter`는 check run 목록의 인자이고 check suite 목록은 같은 커밋의 suite를 모두 준다. 대신 읽기 경로 테스트에 "한 커밋의 suite 여럿(승인 전·후)을 거르지 않고 모두 넘긴다"를 더했다(step0 작업 5).
- 2026-11-26 계획 검증 5회차(head `aa92dc4`): 두 검증자 승인(G1, F12 반박 받아들여짐).
- 2026-11-26 구현 전에 읽다가 범위 밖 파일을 찾았다: `scripts/test/harness-guard.test.ts`의 "신호가 있으면 risk-gate가 높음 → 제작자 head 승인이 있어야 통과"가 리뷰의 `commitId`로 승인을 주고 success를 단언한다. 새 규칙에서는 승인 자료(suite)를 함께 줘야 한다. 관련 파일과 step0 작업 5에 더하고 계획만 다시 올린다(코드는 아직 커밋하지 않았다). `scripts/test/revert-check.test.ts`는 승인 리뷰가 없는 failure만 단언해, 승인 리뷰가 없으면 자료를 읽기 전에 failure로 끝내는 순서로 두면 그대로 통과한다.
- 2026-11-26 계획 검증 6회차(head `9b9a5f9`): Claude 승인, Codex 수정 요청(P1 둘). 둘 다 받아들였다. F13(harness-guard 테스트에 승인 자료만 더하면 merge-base 코드에서도 통과해 R5 test-effect에 걸린다) → "승인 자료 없이 리뷰의 `commitId`만 맞으면 error" 단언을 더한다(새 동작, merge-base에서는 success). F14(승인 리뷰가 없는 위험도 높음 PR에서 자료를 읽지 않는다는 조건을 검증하지 않는다) → `ci.test.ts`의 `gates` 테스트에서 부른 횟수로 단언하게 했다(step0 작업 5). 코드는 아직 커밋하지 않았다.
- 2026-11-26 계획 검증 7회차(head `dddfcbf`): 두 검증자 승인(G1).
- 2026-11-26 테스트 먼저: 새 파일 `scripts/test/risk-gate-approval.test.ts` 21건(`ownerApproval` 표 11, `ownerApprovalCarry` 실제 git 6, `patchId` 비교 끝 1, `readApprovalInputs` 읽기 경로 3). 구현 전에는 `ownerApproval`이 없어 파일 전체가 실패했다.
- 2026-11-26 구현: `risk-gate.ts`에 `lastOwnerDecision`·`ownerApproval`(옛 `ownerApprovedHead`를 지웠다), `riskGate`가 승인 리뷰 → 승인 자료 → 판정 순으로 본다. `binding.ts`에 `ownerApprovalCarry`와 `patchId`의 비교 끝 인자. `gates.ts`에 `readApprovalInputs`와 `approvalInputs` 연결(위험도 높음이고 승인 리뷰가 있을 때만 읽는다, App id는 `ci/protection.ts`의 `ACTIONS_APP_ID`). `harness.ts`의 `gates`가 `GH_TOKEN`으로 만든 읽기 함수를 넘긴다. 있던 테스트: `risk-gate.test.ts`(승인 판정 표를 `ownerApproval`로 옮기고 단언 그대로, 자료 없음 error 둘 추가), `harness-guard.test.ts`(승인 자료 추가, 자료 없음 error 단언 추가), `ci.test.ts`(`gates` 통합 테스트: Actions App의 suite면 success, 다른 App이면 failure, 자료 없음 error, 승인 리뷰 없음·위험도 보통은 읽지 않음). 다섯 파일 109건 통과. 설계서 10.3·10.4절, 절차서 5절, 변경 조각.
- 2026-11-26 step0 구현 판정(head `de30f41`): Claude 승인(지적 없음), Codex 수정 요청(P0 하나, P1 하나). 둘 다 받아들였다.
  - F15(P0): A의 후손 B가 head였다가 A로 강제 push된 뒤 B의 suite가 늦게 생기면, B의 첫 suite가 강제 push보다 늦어 "H0 뒤 강제 push" 규칙에 걸리지 않고 B가 H0가 된다. 제작자가 A를 승인한 뒤 B로 fast-forward하면 승인하지 않은 B가 통과한다. suite 시각은 push 순서를 늘 지키지 않으므로(지연), 강제 push가 있었던 PR에서는 시각으로 승인 head를 정할 수 없다. 규칙을 "PR에 강제 push 이벤트가 하나라도 있으면(시각과 무관하게) 승인으로 보지 않는다"로 바꾼다(수용 기준 1, step0 작업 1과 테스트). 강제 push가 없으면 head는 fast-forward로만 바뀌어, 늦게 생긴 suite가 가리키는 커밋은 제출 때 head의 조상이고 이어받기 조건이 더 엄격해질 뿐이다. 하네스는 강제 push를 하지 않으므로(R2) 정상 흐름은 걸리지 않는다. 강제 push가 있었던 PR은 새 PR로 다시 올린다.
  - F16(P1): check suite 쪽이 100개보다 적게 와도 모은 수가 `total_count`보다 적으면 목록이 빠진 것이다. 그때 null로 한다(step0 작업 4와 읽기 테스트). `total_count`는 쪽 나눔과 맞게 온다(`5027f12`: `per_page=2`로 두 쪽 각 2개, 총 4).
  - 수용 기준이 바뀌므로 절차서 2절대로 구현 커밋(`97522cc`)을 되돌리는 커밋으로 PR의 변경을 계획만 남기고(계획 파일은 그대로) 계획 검증을 다시 받는다. step0 상태는 진행 중으로 돌렸다. 승인 뒤 되돌린 코드를 다시 올리고 두 지적을 고친다.

## 의사결정 로그

- 결정(제작자, 2026-11-26): main 병합만 더한 갱신은 승인을 이어받는다. / 버린 대안: 어떤 새 커밋이든 다시 승인(병렬 위험도 높음 PR이 갱신마다 재승인을 기다린다).
- 결정: 승인 head는 check suite 생성 시각으로 정한다. / 이유: 리뷰의 `commit_id`는 GitHub이 옮겨 보고한다. 리뷰 제출 시각과 check suite 생성 시각은 모두 GitHub 서버 시각이고, check suite는 PR head가 push될 때 Actions App이 만든다(봇이 만들 수 없다). 판정 job의 권한(`checks: read`)으로 읽을 수 있어 워크플로를 바꾸지 않는다. / 버린 대안: 승인 때 기록 job이 승인 head를 커밋 상태로 남기고 뒤에 읽는다(판정 job에 `statuses: read`를 더하는 워크플로 변경이 필요하다), 커밋 날짜로 정한다(봇이 정할 수 있다).
- 결정: H0는 "커밋마다 가장 이른 suite 시각이 리뷰 제출보다 엄격히 앞선 것 중 가장 늦은 것"이고, 그 시각이 제출 60초 안이면 모호하다고 본다. 이어받기에는 H0가 지금 head의 조상이어야 한다. / 이유: 같은 초와 시계 차이로 승인하지 않은 head가 H0로 잡히지 않게 한다(계획 검증 F3). 승인 뒤 같은 커밋에 생긴 suite가 H0를 바꾸지 않는다. 강제 push로 head를 되돌렸다가 다시 올리는 꼴에서 옛 head가 승인 head로 잡혀도 조상 조건에서 걸린다. / 버린 대안: 리뷰가 부른 워크플로 실행(`review-trigger`)의 head로 정한다(실행과 리뷰를 잇는 것도 시각뿐이고 API 호출이 는다).
- 결정(구현 판정 F15로 바꿈): PR에 강제 push가 하나라도 있으면 승인 아님. 처음에는 "H0 뒤에 있으면"이었으나, 강제 push 뒤 옛 head의 suite가 늦게 생기면 그 규칙을 비켜 간다. / 버린 대안: 강제 push 이벤트의 앞·뒤 커밋으로 사라진 커밋을 가려 그 커밋만 후보에서 뺀다(사라진 커밋은 판정 job 체크아웃에 없어 조상 관계를 볼 수 없다).
- (옛 결정) 강제 push가 H0 뒤에 있으면 승인 아님. / 이유: PR 커밋 목록은 지금 이력만 담아 강제 push로 사라진 승인 head를 후보로 못 본다(계획 검증 F9). 하네스는 강제 push를 하지 않으므로(R2) 정상 흐름에서는 걸리지 않는다. / 버린 대안: 리뷰 이벤트 때 head를 신뢰된 기록으로 남긴다(기록 job에 쓰기 권한이나 워크플로 변경이 필요하다), 브랜치의 워크플로 실행 목록으로 후보를 넓힌다(판정 job에 `actions: read`가 없다).
- 결정: 60초 창. / 이유: 하네스 흐름에서 승인은 판정이 끝난 뒤 `pr-ready`로 요청하므로 push와 승인 사이가 몇 분 이상이다(PR #226은 56분). 창에 걸리면 다시 승인받으면 된다.

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step0: AC 명령과 `node scripts/harness.ts check`.
- 2026-11-26 step0 head `97522cc`(구현 판정 F15·F16으로 되돌림): AC 9줄 모두 통과(`check` 포함: fmt·lint·test·test-effect·doc-lint·bypass-scan·secret-scan 통과, build 해당 없음). `risk-gate-approval.test.ts` 21건, 관련 다섯 파일 109건 통과.
- step1: 테스트 리포 실측 결과(`lab/approval-binding/results/`).

## 다음 할 일

1. 고친 계획으로 계획 검증(G1)을 받고, 되돌린 코드를 다시 올려 F15·F16을 고친다. 구현 판정 뒤 제작자 승인을 요청한다(이 PR 자체가 위험도 높음이라 지금 규칙의 제작자 head 승인이 필요하다).
2. 병합 뒤 step1(테스트 리포 실측)을 새 브랜치에서 한다.
