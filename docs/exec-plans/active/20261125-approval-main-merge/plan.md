---
id: 20261125-approval-main-merge
issue: 243 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-25T10:32:13+09:00 # new-task가 채운다
---

# 승인 요청 뒤 main 병합 갱신 push를 L1 훅이 막는다(main에서 들어온 커밋을 새 커밋으로 센다)

## 목표와 수용 기준

승인 요청(`pr-ready`) 뒤에 main이 움직이면, PR 브랜치를 `origin/main` 병합만으로 갱신한 push도 L1 훅이 `[승인 요청 뒤 push]`로 막는다(PR #236, 2026-11-25). 원인은 `scripts/lib/approval.ts`의 `approvalPending`이 `git rev-list --count --no-merges <표시>..HEAD`로 세서, 병합으로 들어온 main 커밋(#207의 squash 커밋 `a06b7fd`)까지 "새 커밋"으로 센 것이다. 절차서 5절과 훅 안내문은 "main 병합 갱신(병합 커밋만 더함)은 막지 않는다"고 한다. 동작을 문서에 맞춘다. 같은 push에서 본 TD-38의 미확인 사례도 기록한다.

수용 기준:

1. 승인 요청 표시 뒤 기본 브랜치의 원격 추적 ref(`refs/remotes/<github.remote>/<github.defaultBranch>`, 이 리포는 `origin/main`)에 새 커밋이 생기고, PR 브랜치가 그것을 병합만 했으면 `approvalPending`이 0을 돌려주고 훅이 그 push를 막지 않는다.
2. 표시 뒤 PR 브랜치에 생긴 병합 아닌 커밋은 지금처럼 센다(훅이 막는다): 직접 만든 커밋, main 병합 앞뒤에 섞인 커밋, 기본 브랜치에 없는 다른 브랜치를 병합해 들어온 커밋.
3. 기본 브랜치의 원격 추적 ref가 없으면 지금처럼 표시 뒤의 병합 아닌 커밋을 모두 센다. 이름이 같은 로컬 브랜치(`refs/heads/origin/main`)는 원격 추적 ref로 쓰지 않는다.
4. 기존 승인 요청 규칙 테스트(`scripts/test/guard.test.ts`의 "승인 요청 규칙…" 세 개)와 `pr-ready`·runner PR 테스트가 고치지 않은 채 통과한다.
5. `docs/exec-plans/tech-debt-tracker.md`의 TD-38에 관찰을 적는다: 2026-11-25, PR #236의 갱신 push `d426343..fd2f6f6`, `workflow` 권한 없는 봇 토큰, main의 워크플로 변경(#207 `.github/workflows/check.yml`)을 병합으로 가져온 push를 GitHub이 받아들였다. "여전히 보지 못한 것"에서 그 사례를 뺀다(워크플로를 바꾼 커밋의 revert push는 남긴다).
6. `docs/harness/architecture.md`의 `lib/approval.ts` 줄이 새 셈 방식(기본 브랜치에서 온 커밋은 세지 않음)을 적는다. 변경 조각 `docs/harness/changes/20261125-approval-main-merge-s0.md`에 CHANGELOG 한 줄을 적는다.

## 범위 / 비범위

- 범위: `approvalPending`의 커밋 셈, 그 회귀 테스트, 위 문서 기록.
- 비범위:
  - 병합 커밋 자체에 섞인 변경(충돌 해결을 넘는 변경) 탐지. 지금도 `--no-merges`로 병합 커밋은 세지 않는다. 바꾸지 않는다.
  - 원격 추적 ref를 일부러 옮기는 우회(`git update-ref`) 대비. L1 훅은 실수를 막는 장치이고 일부러 하는 우회는 R4 위반이다(설계서 5절 보장 수준).
  - runner의 승인 요청 표시 처리(`scripts/runner/run.ts`). runner는 이 훅을 거치지 않고 표시만 읽고 쓴다.
  - 자체 테스트 시나리오. 새 규칙이 아니라 기존 규칙의 셈을 고친다.

## 관련 파일·문서

- `scripts/lib/approval.ts`
- `scripts/test/guard.test.ts`
- `docs/harness/architecture.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/harness/changes/20261125-approval-main-merge-s0.md`
- 읽기만: `scripts/hooks/rules.ts`, `scripts/hooks/guard.ts`, `scripts/commands/pr-ready.ts`, `scripts/lib/config.ts`, `scripts/lib/git.ts`, `scripts/test/helpers.ts`, `docs/harness/workflow.md`

## step 목록

- step0 main-merge: `approvalPending`이 기본 브랜치에서 온 커밋을 세지 않게 하고 TD-38 관찰을 적는다

## 진행 로그

- 2026-11-25 10:32 제작자 대화 지시("이슈 등록하고 바로 진행해라")로 Issue #243을 등록하고 `new-task`로 시작했다. 위험도는 high로 정했다(의사결정 로그 1).

## 의사결정 로그

1. 결정: 계획 위험도 `high`. 이유: L1 훅이 막는 범위를 줄이는 변경이라 기준(보안)에 해당하는지 애매하고, 애매하면 high다(절차서 1절). 보호 경로(`scripts/`)라 운영 단계에서는 어차피 제작자 head 승인 대상이다. 버린 대안: normal(검사 약화가 아니라 오판 수정으로 볼 수도 있지만 판단을 낮춰 적지 않는다).
2. 결정: 기본 브랜치의 원격 추적 ref에서 닿는 커밋을 빼고 센다(`rev-list --count --no-merges HEAD ^<표시> ^refs/remotes/<remote>/<기본 브랜치>`). 이유: 절차서 5절이 허용하는 갱신은 `origin/main` 병합이고, 그 밖의 경로로 들어온 커밋(다른 브랜치 병합)은 계속 막아야 한다. 버린 대안: `--first-parent`로 첫 부모 줄기만 세기(다른 브랜치를 `--no-ff`로 병합하면 그 커밋이 빠져 막아야 할 push를 통과시킨다), 병합 커밋의 둘째 부모가 기본 브랜치에 있는지 하나씩 보기(같은 결과를 더 많은 git 호출로 낸다).
3. 결정: ref 이름은 `refs/remotes/…` 전체로 쓰고, 원격·기본 브랜치 이름은 `pr-ready`처럼 메인 체크아웃의 `harness.config.json`(`github.remote`, `github.defaultBranch`)에서 읽는다. 설정을 못 읽으면 `origin`·`main`을 쓴다. 이유: 짧은 이름 `origin/main`은 같은 이름의 로컬 브랜치가 먼저 잡힌다. 원격 추적 ref가 없으면 빼지 않아 예전처럼 막는 쪽으로 남는다. 버린 대안: 설정을 못 읽으면 null(막지 않음)을 돌려주기(지금의 실패 처리보다 느슨해진다).

## 발견 사항

## 열린 질문

## 검증 방법과 결과

- step0 AC: 새 회귀 테스트와 기존 승인 요청·`pr-ready`·runner PR 테스트, 문서 기록 확인 명령.
- `node scripts/harness.ts check`(test-effect로 새 테스트가 변경 전 코드에서 단언 실패하는지 본다).

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0 구현.
