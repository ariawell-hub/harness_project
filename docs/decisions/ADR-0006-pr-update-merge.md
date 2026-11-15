---
status: active
related_code: [scripts/lib/git.ts]
review_cycle: on-change
---

# ADR-0006: 뒤처진 PR은 rebase가 아니라 main 병합으로 갱신한다

- 날짜: 2026-11-12
- 상태: 채택 (제작자 대화 결정). 절차서·설계서는 Issue #22 step0, runner 구현은 step1
- 관련: 설계서 4.5절, 10.3절, 14.4절, R2, R14, [절차서 5절](../harness/workflow.md), Issue #4·#22, PR #14

## 맥락

- 설계서는 main에 뒤처진 PR을 "rebase 후 다시 검사"하도록 정했다(4.5절 우선순위 2번, 10.3절 절차 4번).
- 이미 push한 브랜치를 rebase하면 원격을 갱신할 때 force push가 필요하다. R14와 L1 훅은 에이전트의 force push를 `--force-with-lease`까지 모두 막는다.
- runner 스크립트는 충돌이 없을 때 자기 브랜치를 rebase하고 `--force-with-lease`로 push한다. 충돌이 나면 사람에게 넘기는데, 넘겨받은 세션에는 결과를 올릴 방법이 없다.
- 실제 사례(PR #14, Issue #4): 세션이 rebase로 충돌을 풀고 `check`까지 통과했지만, push가 훅에 막혀 PR이 `CONFLICTING`으로 멈췄다. 이 상태는 `needs-human` 없이 Issue 댓글로만 남아 `start`에 드러나지 않았다. 제작자 승인으로 이전 PR head를 `git merge -s ours`로 연결해 일반 push로 풀었다.
- 2단계에서 "브랜치가 main 최신이어야 병합"을 켜면 PR 갱신이 훨씬 잦아진다.

## 결정

1. 에이전트 세션과 runner 모두 PR 브랜치는 **`origin/main`을 PR 브랜치에 병합하고 일반 push로** 갱신한다. 이미 push한 브랜치는 rebase하지 않는다.
2. R14(에이전트 force push 금지)는 완화하지 않는다.
3. 충돌은 세션이 병합 커밋 안에서 해결하고 `check`를 다시 돌린다. runner는 제작자 답을 기다리지 않고 충돌을 남긴 병합과 충돌 해결 세션을 띄우고, 판정·커밋·push는 runner가 한다(TD-9, Issue #56). 실패하면 병합을 취소해 worktree를 깨끗이 두고, 5회 실패하면 Issue에 `needs-human`으로 넘긴다. 제작자가 답하면 답을 넣어 다시 푼다(TD-27).
4. 이미 로컬에서 rebase했다면 `git merge -s ours origin/<브랜치>`로 원격 이력을 부모로 연결한 뒤 일반 push한다. 트리는 rebase 결과 그대로이고, 원격 head의 자손이 되므로 fast-forward다.
5. 충돌을 풀 수 없거나 push가 막히면 우회하지 않고 Issue에 `needs-human` 라벨과 질문을 남긴다(절차서 7절). 댓글만으로는 `start` ①에 나오지 않는다.

**승인 결속(10.3절)과의 관계**: main을 병합한 뒤 PR head와 main의 merge-base는 병합한 main 커밋이다. 그래서 "merge-base 대비 diff"는 PR이 main에 더하는 변경과 같다. 충돌 없이 병합했으면 patch-id가 이전과 같아 기존 결속 규칙대로 승인을 이어받는다. 충돌을 해결하면서 PR의 변경이 바뀌면 patch-id가 달라져 다시 검증한다. rebase 때와 같은 규칙이다.

## 버린 대안

- **에이전트에 자기 작업 브랜치 `--force-with-lease` 허용**: R14를 완화해야 하고, L1 훅이 "자기 브랜치"를 판정해야 해 규칙 표면이 넓어진다. lease는 동시 덮어쓰기는 막지만 이미 검토된 커밋이 이력에서 사라지는 것은 막지 못한다.
- **갱신할 때마다 새 브랜치·새 PR**: PR 번호와 검토 기록이 갈라지고, 로컬 브랜치 이름과 PR 브랜치 이름이 달라져 runner가 자기 PR을 찾는 규칙(`<type>/<id>-s<N>`)과 어긋난다.
- **제작자가 매번 직접 force push**: 갱신마다 사람을 기다린다. 2단계의 "main 최신 필수"와 함께 쓰면 병목이 된다.

## 결과

- PR 커밋 목록에 병합 커밋이 남지만, squash 병합이라 main 이력에는 남지 않는다.
- 세션 절차는 [절차서 5절](../harness/workflow.md)의 "main에 뒤처지거나 충돌한 PR 갱신"에 있다.
- runner 갱신 경로(Issue #22 step1): `scripts/lib/git.ts`의 `updateBranchFromBase`가 PR 브랜치에 `origin/main`을 병합하고 일반 push한다. 충돌하면 병합을 취소하고 `conflict`를, 원격 PR 브랜치에 로컬에 없는 커밋이 있으면 병합 없이 `failed`를 돌려준다. runner(`doUpdate`)는 충돌이면 계획을 `blocked` + `needs-human`으로, 그 밖의 실패는 `pr:update` 실패로 기록한다. `pickNext`는 `BEHIND`와 `DIRTY`를 갱신 대상으로 보고, 계획이 `blocked`인 PR은 다시 고르지 않는다. GitHub 상태가 늦어 이미 최신인데 갱신 대상으로 보이면 환경 대기로 처리한다.
- 충돌 답변 경로(Issue #43 step0, TD-27): runner 세션에는 `git fetch`·`git merge` 권한이 없어 "병합해 풀어라"라는 답을 세션이 실행할 수 없었다(Issue #5 / PR #29). 이제 충돌 중단은 계획 파일을 바꾸지 않고 worktree 하네스 상태(`conflict.json`)에 대기를 둔다. 답을 받으면 `updateBranchFromBase(..., { keepConflict: true })`로 충돌을 남긴 병합을 시작하고 충돌 해결 세션(`conflictPrompt`)이 파일만 고친다. runner가 충돌 표시(`<<<<<<<`·`>>>>>>>` 줄)·미병합 경로·step AC·`check`를 확인한 뒤에만 `git commit --no-edit`와 일반 push를 한다. 실패하면 `git merge --abort`로 되돌린다.
- 충돌 자동 해결(Issue #56 step6, TD-9): `doUpdate`는 병합이 충돌하면 사람에게 넘기지 않고 바로 `doResolveConflict`로 간다. 제작자 답이 없으므로 충돌 해결 프롬프트에 답변 절이 없다. 실패는 `pr:conflict` 키로 세고(`pr:update`로는 세지 않는다), 한도(5회)에 닿으면 `reportConflict`가 `needs-human`과 중단 보고를 남기고 `conflict.json`으로 기다린다. 그 뒤는 위 충돌 답변 경로와 같다. 사람 답 없이 풀어도 되는 근거: 충돌 해결로 PR 변경이 바뀌면 patch-id가 달라져 두 검증자가 다시 판정한다(10.3절).
- runner step 완료 push의 `--force-with-lease` 폴백(TD-22)도 Issue #27에서 없앴다. 자기 브랜치 push가 거부되고 원격과 갈라졌으면(`remoteBranchDiverged`) 계획을 `blocked` + `needs-human`으로 보고한다. 이제 runner 어디에도 force push가 없다.

## 검토 기록

- 2026-11-12 (Issue #37): R8 검토. 마지막 갱신(#28) 뒤 변경은 #31(선점 해제)과 #34(계획 작성 질문)이고, `updateBranchFromBase`·`doUpdate`·`pickNext`의 `BEHIND`·`DIRTY` 처리와 force push 없음이 그대로다. 결정 유효, 본문 수정 없음.
