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

1. `risk-gate`는 리뷰가 보고하는 커밋(`commit_id`)에 기대지 않고, 제작자의 마지막 판정 리뷰(승인)가 **제출된 시각에 PR의 head였던 커밋**(승인 head, H0)을 하네스가 정한다. H0는 이 PR의 커밋 가운데 GitHub Actions App이 PR head 브랜치에서 만든 check suite가 있고 그 생성 시각이 리뷰 제출 시각 이하인 것 중 가장 늦은 것이다(check suite의 생성 시각은 GitHub 서버 시각이고 봇이 만들 수 없다).
2. 지금 head가 H0면 승인이다(지금과 같다).
3. 지금 head가 H0가 아니면 다음을 모두 만족할 때만 승인을 이어받는다. 하나라도 아니면 `제작자 head 승인 필요`로 실패한다.
   - H0가 지금 head의 조상이다(강제 push로 이력이 바뀌지 않았다).
   - H0와 지금 head의 patch-id(각자 base와의 diff)가 같다.
   - PR이 바꾼 파일의 내용이 H0와 지금 head에서 바이트 단위로 같다.
   - H0 이후 main에서 바뀐 파일이 PR이 바꾼 파일과 겹치지 않는다.
     이어받으면 상태 설명에 `제작자 head 승인 이어받음 <H0 12자리>`를 적는다.
4. 리뷰·check suite·PR 커밋을 읽지 못하거나 H0를 정하지 못하면 승인으로 보지 않는다(fail-closed, `error` 또는 `failure`. 지금 리뷰를 못 읽을 때와 같은 꼴).
5. 승인 뒤 일반 커밋이 더해진 head는 GitHub이 리뷰의 커밋을 무엇으로 보고하든 승인으로 보지 않는다(테스트로 단언).
6. 설계서 10.3절과 절차서 5절("승인 요청 전 조건", "위험도 높음")의 승인 규칙을 위 규칙으로 맞춘다. 승인 요청 뒤 main 병합 갱신은 다시 승인받지 않아도 된다는 것을 적는다.
7. 병합 뒤 테스트 리포(`ariawell-hub/harness-ops-lab`)에서 실제로 확인한다(step1): 승인 뒤 main 병합만 더한 head는 이어받고, 일반 커밋을 더한 head는 다시 승인을 요구하며, 그때 GitHub이 리뷰의 커밋을 무엇으로 보고하는지 기록한다.

## 범위 / 비범위

범위:

- `scripts/gates/risk-gate.ts`(승인 head 결정과 이어받기 판정), `scripts/ci/gates.ts`(필요한 자료를 읽어 넘긴다. 판정 job의 `GH_TOKEN`은 `checks: read`·`pull-requests: read`가 있다), `scripts/ci/binding.ts`의 있는 함수(`patchId`, `samePrContent`, `changedOnBaseSince`) 재사용.
- 테스트: `scripts/test/risk-gate.test.ts`, 새 파일 `scripts/test/risk-gate-approval.test.ts`.
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
- `scripts/test/risk-gate.test.ts`
- `scripts/test/risk-gate-approval.test.ts`
- `docs/harness/design.md`
- `docs/harness/workflow.md`
- `docs/harness/changes/20261126-approval-binding-s0.md`
- `docs/harness/changes/20261126-approval-binding-s1.md`
- `lab/approval-binding/**`
- `docs/exec-plans/active/20261126-approval-binding/**`
- 읽기만: `.github/workflows/gates.yml`, `scripts/ci/review-plan.ts`, `scripts/lib/github.ts`, `docs/SECURITY.md`("테스트 리포 준비"), `lab/ops-transition/README.md`

## step 목록

- step0 bind: 승인 head를 하네스가 정하고, main 병합만 더한 갱신에 이어받는다. 테스트 먼저.
- step1 live: 병합 뒤 테스트 리포에서 두 경우(main 병합만, 일반 커밋)를 실제로 확인하고 GitHub의 리뷰 커밋 보고를 기록한다(제작자의 승인 두 번이 필요하다).

## 진행 로그

- 2026-11-26 접수: 제작자가 대화에서 남은 지적을 Issue로 열어 고치라고 지시했고 봇이 Issue #250을 등록했다. 방향은 대화에서 물어 "main 병합만은 이어받기"로 정해졌다. `new-task --issue 250 --slug approval-binding --type fix --size large --risk high`로 시작했다(main `4816af5`).
- 2026-11-26 읽은 것: `risk-gate`는 `gates` 워크플로의 판정 job(`evaluate`)이 미리 읽은 리뷰 JSON(`gh api pulls/<N>/reviews`)으로 판정한다. 그 job의 `GH_TOKEN`은 `contents`·`pull-requests`·`checks` 읽기이고 PR 이력 전체(`fetch-depth: 0`)를 체크아웃한다. 커밋 상태 읽기(`statuses`)는 없어 검증자 이어받기(`fetchCandidates`)처럼 앞선 head의 상태를 읽을 수는 없다. 자체 테스트 시나리오에는 `risk-gate`가 없다.

## 의사결정 로그

- 결정(제작자, 2026-11-26): main 병합만 더한 갱신은 승인을 이어받는다. / 버린 대안: 어떤 새 커밋이든 다시 승인(병렬 위험도 높음 PR이 갱신마다 재승인을 기다린다).
- 결정: 승인 head는 check suite 생성 시각으로 정한다. / 이유: 리뷰의 `commit_id`는 GitHub이 옮겨 보고한다. 리뷰 제출 시각과 check suite 생성 시각은 모두 GitHub 서버 시각이고, check suite는 PR head가 push될 때 Actions App이 만든다(봇이 만들 수 없다). 판정 job의 권한(`checks: read`)으로 읽을 수 있어 워크플로를 바꾸지 않는다. / 버린 대안: 승인 때 기록 job이 승인 head를 커밋 상태로 남기고 뒤에 읽는다(판정 job에 `statuses: read`를 더하는 워크플로 변경이 필요하다), 커밋 날짜로 정한다(봇이 정할 수 있다).
- 결정: H0는 "생성 시각이 리뷰 제출 이하인 것 중 가장 늦은 것"이고, 이어받기에는 H0가 지금 head의 조상이어야 한다. / 이유: 강제 push로 head를 되돌렸다가 다시 올리는 꼴에서 옛 check suite가 승인 head로 잡히지 않게 한다.

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step0: AC 명령과 `node scripts/harness.ts check`.
- step1: 테스트 리포 실측 결과(`lab/approval-binding/results/`).

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 step0을 테스트부터 구현한다.
