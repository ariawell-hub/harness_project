---
id: 20261112-runner-stop-paths
issue: 43 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T22:25:36+09:00 # new-task가 채운다
---

# fix: runner 멈춤·답변 경로 — 충돌 답변 뒤 해결 세션, step 질문 올리기 (TD-27, TD-24)

## 목표와 수용 기준

runner가 사람에게 넘긴 뒤 답을 받아도 이어 가지 못하는 경로 두 개를 고친다.

1. **충돌 답변 경로(TD-27)**: main 병합 충돌로 멈춘 계획에 제작자가 답해도 runner 세션은 `git fetch`·`git merge` 권한이 없어 병합하지 못하고, 다음 바퀴에 같은 충돌로 다시 멈춘다(Issue #5 / PR #29, 제작자가 직접 세 번 병합). 또 충돌 중단 때 `blockPlan`이 완료된 step과 계획을 `blocked`로 바꿔 PR 브랜치에 push해 CI `plan-gate`가 실패했다.
2. **step 세션 질문(TD-24)**: step 세션이 "열린 질문"에 `### 질문:`을 적고 멈춰도 runner는 AC 실패로만 센다.

수용 기준

- step0 (TD-27)
  - 충돌 중단은 계획 파일을 바꾸지 않는다(PR의 plan-gate 유지). worktree 하네스 상태(`conflict.json`)에 대기를 적고 Issue에 `needs-human`과 중단 보고(답하면 무엇을 하는지)를 남긴다. 답을 기다리는 동안 그 PR을 다시 고르지 않는다(같은 보고 반복 없음, runner 정지 사유 `human`).
  - 제작자가 답하면 runner가 origin/main을 병합해 **충돌을 남긴 채** 충돌 해결 세션을 띄운다(답 본문을 프롬프트에 넣는다). 세션은 파일만 고치고 git은 쓰지 않는다.
  - runner가 직접 판정한다: 충돌 파일에 충돌 표시가 없고, 모두 스테이징한 뒤 미병합 경로가 없고, step AC(있으면)와 `check`가 통과해야 병합 커밋을 만들고 일반 push한다. 하나라도 실패하면 `git merge --abort`로 병합 전으로 되돌리고 `pr:conflict` 실패로 기록한다. 9.2절 한도(5회)에 닿으면 다시 `needs-human`으로 넘긴다. force push는 없다.
  - 다시 시도할 때 main에서 충돌이 사라졌으면 해결 세션 없이 일반 갱신으로 끝낸다.
- step1 (TD-24)
  - step 세션이 끝난 뒤 판정 전에 계획의 새 `### 질문:`(이미 올린 것 제외)을 본다. 있으면 계획을 `blocked`로 멈추고 Issue에 `needs-human`·제작자 멘션·질문 전문을 올린다. AC 판정과 실패 기록을 하지 않는다.
  - 답을 받으면 계획을 `active`, step을 `in_progress`로 되돌리고 답을 넣어 그 step 세션을 다시 띄운다(계획 작성 단계 질문은 지금처럼 계획을 다시 작성).
- 설계서(4.5절, 9.1절)·ADR-0006·절차서 5절·7절을 맞추고 TD-27·TD-24를 해결로 바꾼다. 각 step에서 `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

- 범위: `scripts/runner/run.ts`, `scripts/runner/next.ts`, `scripts/runner/prompt.ts`, `scripts/lib/git.ts`, 테스트(`runner.test.ts`, `next.test.ts`, `branch-update.test.ts`, `fake-agent.ts`), 문서.
- 비범위
  - 제작자 답 없이 충돌을 자동으로 푸는 것(TD-9, 2단계).
  - runner 세션 권한 프로필(`.claude/runner-settings.json`)에 git 권한을 더하는 것(권한 확대. 병합·커밋·push는 runner 스크립트가 한다).
  - 다른 작업자 worktree 인계(TD-23).

## 관련 파일·문서

- `scripts/runner/run.ts`, `scripts/runner/next.ts`, `scripts/runner/prompt.ts`, `scripts/lib/git.ts`
- `scripts/test/runner.test.ts`, `scripts/test/next.test.ts`, `scripts/test/branch-update.test.ts`, `scripts/test/fake-agent.ts`
- `docs/harness/design.md`(4.5절, 9.1절, 버전·이력), `docs/decisions/ADR-0006-pr-update-merge.md`, `docs/harness/workflow.md`(5절, 7절), `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`, `docs/exec-plans/tech-debt-tracker.md`

## step 목록

- step0 conflict-resolve: 충돌 중단을 계획 파일 밖에 기록하고, 답을 받으면 충돌을 남긴 병합 + 해결 세션 + runner 판정 뒤 push (TD-27)
- step1 step-questions: step 세션의 새 열린 질문을 판정 전에 `needs-human`으로 올리고 답을 받으면 그 step을 이어 간다 (TD-24)

## 진행 로그

- 2026-11-12 대화 세션. 제작자 지시("우선순위를 파악해서 문제되는 사항들 먼저 해결해달라")의 2순위로 Issue #43을 봇이 등록하고 계획을 썼다(1순위 #41은 PR #42로 병합).
- 2026-11-12 step0 테스트 먼저: `branch-update.test.ts`(keepConflict), `next.test.ts`(답을 기다리는 충돌 계획은 고르지 않음, 상태 파일), `runner.test.ts`(충돌 중단이 계획 파일을 안 바꿈, 답 뒤 해결 성공·실패)와 가짜 에이전트 충돌 해결 동작을 더하고 실패를 확인했다(next.test.ts는 `readConflictState` export 없음으로 불러오기 실패, 나머지 24개 중 5개 실패).
- 2026-11-12 step0 구현: `updateBranchFromBase`의 `keepConflict`, `next.ts` `ConflictState`·`readConflictState`·`writeConflictState`·`LocalPlan.conflictWaiting`·`pickNext` 2번, `prompt.ts` `conflictPrompt`, `run.ts` `reportConflict`·`judgeResolution`·`doResolveConflict`와 `doUpdate`·`doAnswered` 분기. 문서(설계서 v0.7.14 4.5절·10.3절, ADR-0006, 절차서 5절, CHANGELOG, architecture.md, TD-27 해결).

## 의사결정 로그

- 결정: 충돌은 제작자 답을 받은 뒤 runner가 병합하고 세션이 표시만 푼다. 병합·스테이징·커밋·push는 runner 스크립트가 한다. 이유: 세션 권한을 넓히지 않고(TD-27의 B안 기각) 답변 경로가 실제로 동작한다. 판정은 runner가 직접 한다(세션의 "완료" 주장은 근거가 아니다). 버린 대안: 세션 권한에 `git fetch`·`git merge` 추가(권한 확대), 충돌이면 "사람이 병합"이라고만 보고(제작자가 매번 직접 병합해야 한다. 이번 세션에서 세 번 했다).
- 결정: 충돌 중단은 계획 파일을 바꾸지 않고 worktree 하네스 상태로 기록한다. 이유: 완료된 step의 PR에 `blocked`를 push하면 plan-gate가 실패한다(PR #29). `needs-human` 라벨이 사람에게 드러내는 경로다(`start` ①).
- 결정: 해결 판정의 충돌 표시는 `<<<<<<<`·`>>>>>>>`로 시작하는 줄만 본다. 이유: `=======` 한 줄은 마크다운 제목 밑줄 등 정상 내용일 수 있다. 충돌 블록에는 여는·닫는 표시가 반드시 있다.
- 결정: 해결 시도도 9.2절 한도로 센다(키 `pr:conflict`). 3회째에는 프롬프트에 방법 전환, 5회째에 다시 사람에게 넘긴다. 제작자 답변은 지금처럼 실패 횟수를 초기화한다.
- 결정: step 두 개(PR 두 개)로 나눈다. 이유: 두 경로는 독립이고, step0이 더 급하다(제작자가 직접 병합하는 일을 없앤다).

## 발견 사항

- PR #29의 CI `plan-gate` 실패 원인은 `blockPlan`이었다. 완료된 step을 `blocked`로 바꾸고 계획 `status: blocked`를 커밋해 PR 브랜치에 push했다. 충돌 중단은 이제 계획 파일을 바꾸지 않는다. → 처리: [설계서 4.5절](../../../harness/design.md)
- `blockPlan`은 다른 경로(step 5회 실패, 원격 브랜치 갈라짐)에서도 계획을 `blocked`로 push한다. 그 경로는 PR이 아직 없거나(step 진행 중) 이미 체크가 실패한 PR이라 영향이 작다. → 처리: 해당 없음
- `acceptanceCommands`는 step 파일이 없으면 예외를 던진다. 충돌 판정은 step 파일이 없으면 AC 없이 `check`만 본다. → 처리: 해당 없음

## 열린 질문

없음

## 검증 방법과 결과

- step0: `node --test scripts/test/runner.test.ts scripts/test/next.test.ts scripts/test/branch-update.test.ts`
  - 충돌 중단: 계획 파일이 바뀌지 않고 PR 브랜치에 push되지 않는다, `needs-human` 한 번, 정지 사유 `human`
  - 답 뒤 해결 성공: 원격 PR 브랜치가 origin/main을 포함하고 충돌 표시가 없다, 해결 프롬프트에 충돌 파일과 답 본문
  - 해결 실패: `MERGE_HEAD` 없음, 원격 변화 없음, `pr:conflict` 실패 기록
  - `updateBranchFromBase(..., { keepConflict: true })`가 충돌을 남긴다
- step1: `node --test scripts/test/runner.test.ts`
  - step 세션 질문: `needs-human`·멘션·질문 전문 한 번, AC 실패 기록 없음, 답 뒤 같은 step을 답과 함께 다시 실행해 끝까지 간다
- 각 step: `node scripts/harness.ts check`
- 결과
  - step0(2026-11-12): AC 5개 통과. 전체 `node --test "scripts/test/*.test.ts"` 142 pass / 0 fail, `tsc` 통과, `node scripts/harness.ts check` 통과(R8 경고 1건: ADR-0003의 `harness.config.json`, 이 변경과 무관).

## 다음 할 일

- step0 PR 병합 뒤 `node scripts/harness.ts new-task --plan 20261112-runner-stop-paths --step 1`로 step1(step-questions, TD-24)
