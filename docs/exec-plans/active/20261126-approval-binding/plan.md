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

# 제작자 승인을 GitHub의 "오래된 승인 철회"로 head에 묶는다

## 목표와 수용 기준

PR #226에서 제작자 승인은 2026-11-25T04:36:27Z에 head `5027f12`에 달렸다. 그 뒤 봇이 `origin/main` 병합 커밋 둘(`c5d5338`, `a1aae51`)을 올렸는데 두 head 모두 `risk-gate`가 "제작자 head 승인"으로 success였고, 제작자가 새 head를 승인하지 않은 채 병합됐다. REST `pulls/226/reviews`와 GraphQL `PullRequestReview.commit` 모두 그 리뷰의 커밋을 `a1aae51`로 돌려준다. GitHub이 리뷰의 커밋을 새 head로 옮겨 보고한다. `scripts/gates/risk-gate.ts`의 `ownerApprovedHead`는 "제작자의 마지막 판정 리뷰가 승인이고 `commitId === headSha`"로 보므로, 그 커밋 값에 따라 승인이 새 head로 넘어간다. 일반 커밋에서도 GitHub이 리뷰의 커밋을 옮기는지는 확인하지 못했다.

제작자 결정(2026-11-26 대화): 처음에는 "main 병합만 더한 갱신은 승인을 이어받는다"를 하네스가 check suite 시각으로 승인 head를 추정해 구현하려 했다. 계획 검증과 구현 판정에서 추정의 경계 사례가 이어서 나와(F15~F20) 제작자가 방향을 바꿨다: **GitHub 기본 기능 "새 커밋 push 시 오래된 승인 철회"(dismiss stale approvals)를 쓴다.** GitHub이 서버에서 승인을 철회하고(리뷰 상태 `DISMISSED`), 바뀐 내용이 없는 base 병합에서는 승인을 대부분 유지한다고 알려져 있다. 하네스는 시각 추정을 하지 않고 지금처럼 리뷰 상태로 판정하되, 그 규칙이 켜져 있는지 확인한다.

기존 보호 규칙의 리뷰 설정은 관리자가 아닌 토큰으로 읽을 수 없다(`branches/main/protection/required_pull_request_reviews` 404, GraphQL `branchProtectionRule` null). 규칙 세트(ruleset)의 규칙은 읽기 권한으로 읽힌다(`GET rules/branches/main`, 지금은 `[]`). 그래서 이 규칙은 규칙 세트로 켠다.

수용 기준:

1. (step0) 제작자가 main에 규칙 세트를 만든다: "Require a pull request before merging", 필수 승인 0, "Dismiss stale pull request approvals when new commits are pushed" 켬. 봇 토큰으로 `GET repos/{repo}/rules/branches/main`이 `type: pull_request`이고 `parameters.dismiss_stale_reviews_on_push: true`인 규칙을 돌려준다.
2. (step0) 이 리포의 버릴 시험 PR(위험도 높음, 병합하지 않는다)로 실제 동작을 잰다: 제작자 승인 뒤 (가) `origin/main` 병합만 더한 push와 (나) 내용을 바꾼 일반 커밋 push에서 리뷰 API의 상태(`state`)·커밋(`commit_id`)과 `risk-gate` 상태를 기록한다. 기대: (가) 승인 유지(`APPROVED`)이고 `risk-gate` success, (나) `DISMISSED`이고 `risk-gate` failure.
3. (step0) 결과가 기대와 다르면 step1 전에 계획을 고친다(예: (가)에서도 철회되면 main 병합 뒤 다시 승인받는다고 문서에 적고, (나)에서 철회되지 않으면 이 방향을 다시 묻는다).
4. (step1) `risk-gate`는 위험도 높음일 때 PR의 실제 base 브랜치(PR API `GET pulls/<n>`의 `base.ref`. 기본 브랜치 설정을 쓰지 않는다)의 규칙(`GET rules/branches/<base>`)에 `dismiss_stale_reviews_on_push: true`인 `pull_request` 규칙이 있는지 확인한다. 없으면 failure(`위험도 높음: 오래된 승인 철회 규칙이 없어 제작자 승인을 head에 묶을 수 없다`), 읽지 못하면 error(fail-closed). 규칙이 있으면 지금 판정(제작자의 마지막 판정 리뷰가 승인이고 리뷰의 커밋이 head)을 그대로 쓴다. 규칙은 위험도 높음이고 승인 리뷰가 있을 때만 읽는다. 읽기 실패의 error 설명에는 복구 방법(SECURITY.md)을 적는다.
5. (step1) 전환: 규칙을 켜기 전에 받은 승인은 세지 않는다. main 설정 `github.dismissStaleSince`(ISO 시각, step0에서 기록한 규칙 활성화 시각)보다 엄격히 뒤(초 단위)에 제출된 승인만 센다. 같은 초이거나 앞선 승인은 승인이 아니다(failure, 고치는 법: 현재 head를 다시 승인). 키가 없거나 시각이 아니면 failure. 규칙 활성화 전에 승인받고 GitHub이 리뷰 커밋을 옮겨 둔 열린 PR(#226 꼴)이 활성화 뒤 push 없이 통과하지 않게 한다(계획 검증 F23).
6. (step1) `ops-check`가 같은 규칙을 봇 토큰으로 확인한다. 규칙이 없으면 2번 항목이 실패(`fail`), 읽지 못하면 다른 실패가 없을 때 `unknown`이고, 명령의 종료 코드가 그에 따른다.
7. (step1) 설계서 0.2절(리포 설정)·10.3절(승인 결속 기준의 제작자 승인 행)·10.4절, 절차서 5절("위험도 높음", "승인 요청 전 조건"), SECURITY.md(제작자 설정 절차)를 이 규칙으로 맞춘다.

## 범위 / 비범위

범위:

- step0: 제작자 작업 요청(규칙 세트), 시험 PR의 실측, `lab/approval-binding/`(절차·결과), 변경 조각.
- step1: `scripts/gates/risk-gate.ts`(규칙과 전환 시각 확인), `scripts/ci/gates.ts`(PR base와 규칙을 읽어 넘긴다), `scripts/harness.ts`(`gates`가 읽기 함수를 만든다), `scripts/commands/ops-check.ts`(규칙 확인과 항목 상태), `scripts/lib/config.ts`·`harness.config.json`(`github.dismissStaleSince`), 테스트(`scripts/test/risk-gate.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/harness-guard.test.ts`, `scripts/test/ops-check.test.ts`, `scripts/test/lib.test.ts`), 설계서·절차서·SECURITY.md, 변경 조각. 규칙 목록의 쪽 경로·쪽 모으기·규칙 판정은 새 모듈 `scripts/lib/rules.ts`에 두고 판정 job(`readDismissRule`)과 GitHub 포트가 함께 쓴다. GitHub 포트(`scripts/lib/github.ts`)와 가짜 포트(`scripts/lib/github-fake.ts`)에 규칙 읽기(`branchRules`)를 더한다(`ops-check`는 포트로 읽고 명령 테스트는 가짜 포트로 돈다).

비범위:

- 워크플로 파일(`.github/workflows/`). 규칙 읽기는 판정 job의 지금 토큰(읽기 권한에 늘 있는 metadata)으로 한다.
- 보호 설정·규칙 세트를 봇이 바꾸는 것(R20). 제작자가 한다.
- 승인 head를 하네스가 추정하는 것(옛 방식, 버렸다).
- 검증자 승인 이어받기(`review/*`)의 규칙.
- 승인 요청 뒤 main 병합 push를 L1 훅이 막는 문제(Issue #243, PR #244가 다룬다).

## 관련 파일·문서

- `lab/approval-binding/**`
- `docs/harness/changes/20261126-approval-binding-s0.md`
- `docs/harness/changes/20261126-approval-binding-s1.md`
- `scripts/gates/risk-gate.ts`
- `scripts/ci/gates.ts`
- `scripts/harness.ts`
- `scripts/commands/ops-check.ts`
- `scripts/lib/rules.ts`
- `scripts/lib/github.ts`
- `scripts/lib/github-fake.ts`
- `scripts/lib/config.ts`
- `harness.config.json`
- `scripts/test/lib.test.ts`
- `scripts/test/risk-gate.test.ts`
- `scripts/test/ci.test.ts`
- `scripts/test/harness-guard.test.ts`
- `scripts/test/ops-check.test.ts`
- `docs/harness/design.md`
- `docs/harness/workflow.md`
- `docs/SECURITY.md`
- `docs/exec-plans/active/20261126-approval-binding/**`
- 읽기만: `.github/workflows/gates.yml`, `scripts/ci/pr.ts`(`githubGet`), `scripts/ci/protection.ts`

## step 목록

- step0 measure: 제작자가 규칙 세트를 켜고, 버릴 시험 PR로 main 병합 push와 일반 커밋 push 뒤의 리뷰 상태와 `risk-gate`를 잰다(제작자 승인 한 번).
- step1 rule: `risk-gate`와 `ops-check`가 규칙을 확인하고, 문서를 맞춘다. 테스트 먼저.

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
- 2026-11-26 계획 검증 8회차(head `26ed36a`, 계획만): Claude 승인, Codex 수정 요청(P1 하나). 받아들였다. F17: 강제 push가 없어도 A 뒤에 B를 push하고 B의 suite가 먼저, A의 suite가 늦게 생기면 시각으로 고른 H0가 A가 되어, 지금 head B를 정당하게 승인해도 이어받기(B는 일반 커밋)에서 계속 거부된다. H0를 "후보 가운데 시각이 가장 늦은 것"에서 "후보 가운데 이력의 끝(나머지 모두의 후손)"으로 바꿨다(수용 기준 1, step0 작업 1과 테스트, 의사결정 로그). 시각은 제출 전 push를 가르는 데와 60초 창에만 쓴다. 코드는 작업 트리에 두고 아직 올리지 않았다.
- 2026-11-26 계획 검증 9회차(head `6cc0ebf`, 계획만): 두 검증자 승인(G1). F15·F16은 구현 대기.
- 2026-11-26 구현 다시 올림: 되돌렸던 코드(`97522cc`)를 가져오고 세 지적을 고쳤다. 테스트를 먼저 고쳐 옛 코드에서 실패하는 것을 확인했다(F15·F16: `97522cc` 코드에서 3건 실패, F17: 시각으로 고르는 코드에서 2건 실패). F15: PR에 강제 push가 하나라도 있으면 승인 아님. F16: check suite가 `total_count`만큼 오지 않으면 null. F17: H0는 후보 가운데 이력의 끝(`isAncestor`, `binding.ts`의 `isAncestorOf`). `risk-gate-approval.test.ts` 25건, 관련 다섯 파일 113건 통과. 설계서·절차서·변경 조각을 맞췄다. main에 #249가 병합돼 `origin/main`을 병합했다.
- 2026-11-26 step0 구현 판정 2회차(head `17deac6`): Claude 승인(지적 없음), Codex 수정 요청(P0 하나, P1 하나). 둘 다 받아들였다. F18(P0): 같은 이름의 옛 브랜치에서 생긴 suite가 미승인 head의 근거가 된다 → PR이 열린 시각 이후의 suite만 센다. F19(P1): 갈라진 후보 A·B가 둘을 합친 M의 조상이면 "모두 끝의 조상" 검사를 통과한다 → 후보를 짝마다 조상 관계로 확인한다. 수용 기준 1이 바뀌므로 다시 구현 커밋(`3ba7855`)을 되돌려 계획만 남기고 계획 검증을 받는다. step0 상태는 진행 중으로 돌렸다.
- 2026-11-26 방향 전환(제작자 결정): 시각 추정 방식은 계획 검증 9회와 구현 판정 2회에서 지적 20건(F1~F20)이 나왔고, 고칠 때마다 새 경계 사례가 나왔다(강제 push, suite 지연, 같은 이름의 옛 브랜치, PR을 열기 전의 suite). 제작자에게 묻자 "GitHub 기본 기능"을 골랐다. 확인한 것: main의 기존 보호 규칙은 이미 "PR 필수 + 코드 오너 리뷰 필수(승인 0)"이지만(SECURITY.md "코드 오너 리뷰 필수") 관리자가 아닌 토큰으로는 읽을 수 없다. 규칙 세트 규칙은 `GET rules/branches/main`으로 읽힌다(지금 `[]`). 테스트 리포 `harness-ops-lab`은 지금 봇 토큰으로 보이지 않아(404) 실측은 이 리포의 버릴 시험 PR로 한다. 수용 기준·범위·관련 파일·step을 새로 썼다(step0 measure, step1 rule). 옛 방식 코드는 커밋 `97522cc`·`3ba7855`에 남아 있고 되돌린 상태다. 계획 검증을 다시 받는다.
- 2026-11-26 계획 검증 10회차(새 방향 첫 회, head `cba9580`): Claude 승인(P2 둘), Codex 수정 요청(P0 하나, P1 셋, 오래 열린 F7). F7은 절차서 8절대로 제작자에게 물었고 "한 번 더 고친다"를 골랐다. 모두 받아들였다. F7(P1): 실측 AC가 `submittedAt`·`riskGate.description` 누락을 거르지 않는다 → 사례마다 두 필드를 검사한다. F23(P0): 규칙 활성화 전에 받은 승인(리뷰 커밋이 옮겨진 것)이 활성화 뒤 push 없이 통과한다 → main 설정 `github.dismissStaleSince`보다 앞선 승인은 세지 않는다(수용 기준 5). F24(P1): main 병합에서 승인이 먼저 철회되면 일반 커밋 사례가 아무것도 보여 주지 못한다 → 매 push 직전에 지금 head가 승인·success인지 확인하고, 철회됐으면 일반 커밋 전에 다시 승인받는다(step0 작업 5·6). F25(P1): 기본 브랜치가 아니라 PR의 실제 base의 규칙을 본다(수용 기준 4). F26(P1): `ops-check` 항목 상태와 종료 코드를 정한다(수용 기준 6). Claude P2: 판정 job 토큰으로 규칙을 읽는지 → 이 리포는 공개라 인증 없이도 200(`curl`로 확인)이고, 비공개 리포도 `GITHUB_TOKEN`에는 metadata 읽기가 늘 있다. 실패 때 복구 방법을 error 설명과 SECURITY.md에 적는다. Claude P2: 시험 브랜치의 main 병합 push는 승인 요청 표시(`pr-ready`)가 없는 브랜치라 L1 훅의 그 규칙에 걸리지 않는다. 그래도 막히면 기록하고 제작자에게 알린다(step0 작업 5).
- 2026-11-26 계획 검증 11회차(head `ce4c1b8`): Claude 승인(P2 하나), Codex 수정 요청(F23 유지, F28 새로). 받아들였다. F23: 전환 시각과 같은 초에 제출된 승인은 활성화 직전일 수 있다 → 전환 시각보다 엄격히 뒤의 승인만 센다(수용 기준 5, step1 작업 2와 경계 테스트). F28: harness-guard의 성공 테스트가 새 전환 조건을 만족하는 입력을 갖지 않는다 → 그 테스트의 설정에 `github.dismissStaleSince`, 리뷰 제출 시각을 그보다 뒤의 ISO 시각으로 바꾸고, 같은 입력에서 `dismissRule`만 빼면 error임을 단언한다(step1 작업 5). Claude P2(설정을 PR이 바꿀 수 있다): 판정 job은 설정을 base에서 읽는다(`gates.yml`의 `--config-root ../base`). 의사결정 로그 문구를 그 근거로 고쳤다.
- 2026-11-26 계획 검증 12회차(head `cd4f8a1`, 계획만): 두 검증자 승인(G1).
- 2026-11-26 step0 실측: 제작자가 규칙 세트 `approval-dismiss-stale`(id 28177521, `created_at` 16:11:33Z)을 만들었고 봇이 16:18:41Z에 `rules/branches/main`과 `rulesets/28177521`로 읽었다. 시험 PR #256(플러밍 커밋 `b87c8b3`)을 제작자가 승인했고(`risk-gate` success), #242 병합 뒤 main 병합 커밋 `8cd1641`을 push했다(승인 유지, 리뷰 커밋이 `8cd1641`로 옮겨짐, success, L1 훅은 막지 않음). 이어 일반 커밋 `511f2a5`를 push했다(1초 뒤 `review_dismissed`, 리뷰 커밋은 `8cd1641`에 남음, failure). 기대(수용 기준 2)와 같아 step1을 계획대로 한다. 실제 PR #253의 main 병합 갱신(`c77a1cd`)에서도 승인이 유지되고 success였다. #256은 닫고 브랜치를 지웠다. 결과 `lab/approval-binding/results/live.json`·`README.md`, 변경 조각 s0.
- 2026-11-27 step1 실행 PR #259(브랜치 `fix/20261126-approval-binding-s1`)의 첫 계획 커밋(관련 파일에 GitHub 포트 둘을 더함)에 계획 검증이 Claude 승인(P2 하나), Codex 수정 요청(P1 셋)을 냈다. 모두 step1 파일의 작업·AC를 고쳐야 하는 지적이라 절차서 2절 "실행 중인 step의 계획 수정"대로 완료된 step0 번호의 계획 수정 PR(`docs/20261126-approval-binding-s0`)로 먼저 고친다. #259는 초안으로 두고 커밋을 더 올리지 않는다. 받아들인 것: (1) `ops-check`의 포트가 규칙 목록을 끝까지 읽는 계약이 없다 → 쪽 경로·쪽 모으기·판정을 `scripts/lib/rules.ts`로 빼 판정 job과 실제 포트가 같은 함수로 끝까지 읽고, 끝까지 못 읽으면 던져 `unknown`이 되게 했다(쪽 모으기를 가짜 응답으로 테스트한다). (2) 슬래시가 든 base 브랜치(`release/1.x`)가 경로 두 구간으로 나뉜다 → 브랜치 이름을 경로 한 구간으로 인코딩(`release%2F1.x`)하고 판정 job·포트 모두 그 함수를 쓴다. (3) AC가 설계서·절차서 갱신을 보지 않는다 → 해당 문구 grep을 더했다. Claude P2(읽을 파일과 작업에 포트 메서드·순수 판정 함수가 없다) → 읽을 파일과 작업 4에 적었다.

## 의사결정 로그

- 결정(제작자, 2026-11-26 두 번째): 승인 결속을 GitHub의 "오래된 승인 철회"에 맡긴다. 하네스는 그 규칙이 켜져 있는지 확인하고 리뷰 상태로 판정한다. / 이유: 서버가 push마다 승인을 철회하므로 하네스가 승인 head를 추정할 필요가 없다. 추정은 경계 사례가 끝나지 않았다. / 버린 대안: 시각 추정을 더 고친다, 리뷰 이벤트 때 head를 검증 App 상태로 남긴다(판정 job에 `statuses: read`가 필요하다).
- 결정: 규칙은 기존 보호 규칙이 아니라 규칙 세트로 켠다. / 이유: 기존 보호 규칙의 리뷰 설정은 관리자만 읽을 수 있어, 꺼져도 하네스가 알 수 없다. 규칙 세트는 읽기 권한으로 읽혀 `risk-gate`가 fail-closed로 확인한다. / 버린 대안: 기존 규칙의 체크박스만 켠다(제작자 작업은 적지만 확인할 수 없다).
- 결정(계획 검증 F23): 규칙 활성화 전 승인은 main 설정의 활성화 시각으로 거른다. / 이유: 활성화 전에 GitHub이 리뷰 커밋을 옮겨 둔 승인이 활성화 뒤 push 없이 남으면 규칙 확인만으로는 통과한다. 판정 job은 설정을 base 체크아웃에서 읽으므로(`gates --config-root ../base`) PR이 고친 값은 판정에 쓰이지 않는다. 같은 초의 승인은 활성화 직전일 수 있어 세지 않는다(계획 검증 11회차 F23). / 버린 대안: 규칙 세트의 생성 시각을 API로 읽는다(읽기 권한을 확인하지 못했다. step0에서 읽히는지 함께 본다).
- 결정(계획 검증 F25): 규칙은 PR의 실제 base 브랜치에서 읽는다. base는 PR API로 읽는다(워크플로를 바꾸지 않는다).
- 결정: 실측(step0)을 코드(step1)보다 먼저 한다. / 이유: 필수 승인 0에서도 철회가 일어나는지, main 병합에서 승인이 유지되는지를 확인한 뒤 그 위에 확인 코드를 둔다.
- 아래는 옛 방식(시각 추정)의 결정이다. 버렸고 기록으로 둔다.

- 결정(제작자, 2026-11-26): main 병합만 더한 갱신은 승인을 이어받는다. / 버린 대안: 어떤 새 커밋이든 다시 승인(병렬 위험도 높음 PR이 갱신마다 재승인을 기다린다).
- 결정: 승인 head는 check suite 생성 시각으로 정한다. / 이유: 리뷰의 `commit_id`는 GitHub이 옮겨 보고한다. 리뷰 제출 시각과 check suite 생성 시각은 모두 GitHub 서버 시각이고, check suite는 PR head가 push될 때 Actions App이 만든다(봇이 만들 수 없다). 판정 job의 권한(`checks: read`)으로 읽을 수 있어 워크플로를 바꾸지 않는다. / 버린 대안: 승인 때 기록 job이 승인 head를 커밋 상태로 남기고 뒤에 읽는다(판정 job에 `statuses: read`를 더하는 워크플로 변경이 필요하다), 커밋 날짜로 정한다(봇이 정할 수 있다).
- 결정: H0는 "커밋마다 가장 이른 suite 시각이 리뷰 제출보다 엄격히 앞선 것 중 가장 늦은 것"이고, 그 시각이 제출 60초 안이면 모호하다고 본다. 이어받기에는 H0가 지금 head의 조상이어야 한다. / 이유: 같은 초와 시계 차이로 승인하지 않은 head가 H0로 잡히지 않게 한다(계획 검증 F3). 승인 뒤 같은 커밋에 생긴 suite가 H0를 바꾸지 않는다. 강제 push로 head를 되돌렸다가 다시 올리는 꼴에서 옛 head가 승인 head로 잡혀도 조상 조건에서 걸린다. / 버린 대안: 리뷰가 부른 워크플로 실행(`review-trigger`)의 head로 정한다(실행과 리뷰를 잇는 것도 시각뿐이고 API 호출이 는다).
- 결정(구현 판정 F15로 바꿈): PR에 강제 push가 하나라도 있으면 승인 아님. 처음에는 "H0 뒤에 있으면"이었으나, 강제 push 뒤 옛 head의 suite가 늦게 생기면 그 규칙을 비켜 간다. / 버린 대안: 강제 push 이벤트의 앞·뒤 커밋으로 사라진 커밋을 가려 그 커밋만 후보에서 뺀다(사라진 커밋은 판정 job 체크아웃에 없어 조상 관계를 볼 수 없다).
- (옛 결정) 강제 push가 H0 뒤에 있으면 승인 아님. / 이유: PR 커밋 목록은 지금 이력만 담아 강제 push로 사라진 승인 head를 후보로 못 본다(계획 검증 F9). 하네스는 강제 push를 하지 않으므로(R2) 정상 흐름에서는 걸리지 않는다. / 버린 대안: 리뷰 이벤트 때 head를 신뢰된 기록으로 남긴다(기록 job에 쓰기 권한이나 워크플로 변경이 필요하다), 브랜치의 워크플로 실행 목록으로 후보를 넓힌다(판정 job에 `actions: read`가 없다).
- 결정(계획 검증 F17로 바꿈): H0는 후보 가운데 이력의 끝이다(시각이 가장 늦은 것이 아니다). / 이유: 조상 커밋의 suite가 늦게 생기면 시각으로 고른 H0가 조상이 되어, 지금 head를 정당하게 승인해도 이어받기에서 계속 거부된다(같은 head를 다시 승인해도 순서가 그대로다). 강제 push가 없으면 push된 head들은 한 줄을 이루고, 제출 전에 push된 것의 끝이 제출 때의 head이거나(그 suite가 늦으면) 그 조상이다. / 버린 대안: 시각이 가장 늦은 것(지연에 약하다).
- 결정(구현 판정 F18로 더함): PR이 열린 시각 이후의 suite만 센다. / 이유: 같은 이름의 옛 브랜치에서 A의 후속 커밋 B에 suite가 생긴 뒤 브랜치를 지우고 같은 이름으로 A에서 새 PR을 열면, 제작자가 A를 승인한 뒤 B로 fast-forward할 때 B의 옛 suite가 승인보다 앞서 B가 H0가 된다. 옛 브랜치의 suite는 새 PR이 열리기 전에 생긴다. suite의 `pull_requests`는 지금 열린 PR을 브랜치로 맞춰 보여 줘(병합된 #226은 비었고 열린 #253의 옛 head들은 253) 옛 브랜치를 가리지 못한다. / 버린 대안: 리뷰 이벤트 때의 head를 검증 App 상태로 남기고 읽는다(판정 job에 `statuses: read`가 필요해 워크플로 변경이 있어야 한다. 발견 사항).
- 결정(구현 판정 F19로 더함): 후보는 짝마다 조상 관계여야 한다. / 이유: 서로 갈라진 A·B와 둘을 합친 M이 모두 후보이면 "모두 끝의 조상"만 보는 검사를 통과한다. 강제 push가 없으면 push된 head는 한 줄이다.
- 결정: 60초 창. / 이유: 하네스 흐름에서 승인은 판정이 끝난 뒤 `pr-ready`로 요청하므로 push와 승인 사이가 몇 분 이상이다(PR #226은 56분). 창에 걸리면 다시 승인받으면 된다.

## 발견 사항

- 옛 방식(check suite 시각으로 승인 head 추정)의 남은 위험과 경계 사례는 진행 로그 F15~F20에 있다. 새 방식에서는 쓰지 않는다. → 처리: 해당 없음
- 테스트 리포 `ariawell-hub/harness-ops-lab`이 봇 토큰으로 보이지 않는다(2026-11-26, `GET repos` 404). 지운 것인지 권한이 바뀐 것인지 제작자에게 알린다. → 처리: #250
- 규칙 세트의 `created_at`(16:11:33Z)과 봇이 처음 본 시각(16:18:41Z)이 다르다. step1의 `github.dismissStaleSince`는 계획대로 늦은 쪽(`rule.firstSeenAt`)을 쓴다. 그 사이에 받은 승인(#253·#254의 승인 포함)은 step1 병합 뒤 열려 있으면 다시 받아야 한다. → 처리: [lab/approval-binding/README.md](../../../../lab/approval-binding/README.md)
- 일반 커밋에서 GitHub은 리뷰 커밋을 새 head로 옮기지 않는다. `gates`가 철회 직전에 리뷰를 읽어도 리뷰 커밋이 head가 아니라 failure다. → 처리: [lab/approval-binding/README.md](../../../../lab/approval-binding/README.md)

## 열린 질문

없음.

## 검증 방법과 결과

- step0: 실측 결과(`lab/approval-binding/results/live.json`)와 AC, `node scripts/harness.ts check`.
- step1: AC와 `node scripts/harness.ts check`.
- 옛 방식 step0(되돌림): head `97522cc`·`3ba7855`에서 AC 9줄이 통과했었다.

## 다음 할 일

1. step0 완료 처리 뒤 구현 판정을 받고 승인 요청(`pr-ready`).
2. step0 병합 뒤 `new-task --plan 20261126-approval-binding --step 1`로 step1(rule)을 한다.
