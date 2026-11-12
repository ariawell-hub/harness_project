---
id: 20261112-pr-update-merge
issue: 22 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T12:24:49+09:00 # new-task가 채운다
---

# fix: 뒤처진 PR 갱신(rebase)과 에이전트 force push 금지(R14)의 충돌

## 목표와 수용 기준

출처: Issue #22(제작자 대화 지시, 2026-11-12). 방향은 제작자가 승인했다. 에이전트 세션과 runner가 main에 뒤처진 PR을 갱신하는 표준을 "rebase"에서 "`origin/main`을 PR 브랜치에 병합"으로 바꾼다. R14(에이전트 force push 금지)는 그대로 둔다.

배경: PR #14(Issue #4)가 main과 충돌했다. 넘겨받은 세션이 rebase로 충돌을 해결했지만 결과를 올리려면 force push가 필요했고, L1 훅이 R14로 막았다. PR은 `CONFLICTING` 상태로 멈췄고, `needs-human` 없이 Issue 댓글로만 남아 `start`에 드러나지 않았다. 제작자 승인으로 이전 PR head를 `git merge -s ours`로 연결해 일반 push로 풀었다.

수용 기준:

1. 결정이 ADR로 남고(`docs/decisions/ADR-0006-pr-update-merge.md`), 설계서(4.5절, 10.3절, 14.4절)와 절차서(5절)가 세션의 PR 갱신·충돌 해결 절차를 "`origin/main` 병합 → 충돌 해결 → `check` → 일반 push"로 설명한다. 이미 push한 브랜치를 rebase하지 않는다는 이유와, 막히면 `needs-human`으로 보고하는 절차가 들어 있다.
2. runner는 PR이 main에 뒤처졌거나(`BEHIND`) 충돌하면(`DIRTY`) `origin/main`을 병합해 일반 push로 갱신한다. 갱신 경로에 force push가 없다.
3. 병합이 충돌하면 runner는 병합을 취소해 worktree를 깨끗이 두고 계획을 `blocked` + `needs-human`으로 보고한다. 이미 `blocked`인 계획의 PR은 다시 고르지 않는다(같은 보고를 반복하지 않는다).
4. push가 실패하면 실패로 기록한다(성공으로 기록하지 않는다).
5. `start`·`next`의 다음 할 일 문구가 "main 병합으로 갱신"을 안내한다.
6. 10.3절 승인 결속 기준(merge-base 대비 diff의 patch-id)이 병합 방식에서도 성립하는지 ADR과 설계서에 적는다.
7. 테스트: 로컬 bare 원격에서 뒤처진 PR 브랜치 갱신(충돌 없음·이미 최신·충돌·push 거부)과 `pickNext`의 `BEHIND`·`DIRTY`·`blocked` 처리.

## 범위 / 비범위

- 범위: PR 브랜치 갱신 절차(문서), runner 갱신 경로(`doRebase` → main 병합), `pickNext`의 갱신 대상 판정, `start` 안내 문구, 관련 테스트.
- 비범위:
  - R14·L1 훅 규칙 변경. 에이전트 force push 금지는 그대로다.
  - runner의 step push 실패 시 `--force-with-lease` 폴백(`scripts/runner/run.ts` step 완료 push). 갱신 경로가 아니라 step 결과 push 경로다 → TD-22.
  - 충돌 자동 해결 세션(2단계, TD-9).
  - 다른 작업자 worktree 인계 명령 → TD-23.
  - 2단계 `review/*` 결속 구현(TD-1). 이번에는 기준 문장만 맞춘다.

## 관련 파일·문서

- `docs/decisions/ADR-0006-pr-update-merge.md`(새 파일), `docs/decisions/index.md`
- `docs/harness/workflow.md`, `docs/harness/design.md`, `AGENTS.md`
- `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`, `docs/exec-plans/tech-debt-tracker.md`
- `scripts/lib/git.ts`, `scripts/runner/run.ts`, `scripts/runner/next.ts`, `scripts/commands/start.ts`
- `scripts/test/branch-update.test.ts`(새 파일), `scripts/test/next.test.ts`, `scripts/test/helpers.ts`, `scripts/test/start.test.ts`
- `docs/exec-plans/active/20261112-pr-update-merge/`

## step 목록

- step0 merge-procedure: ADR-0006과 설계서·절차서·AGENTS.md에 "main 병합으로 갱신" 절차를 적는다(문서만).
- step1 runner-update: runner 갱신 경로를 main 병합 + 일반 push로 바꾸고 `DIRTY`·`blocked`·push 실패를 처리한다(코드·테스트).

## 진행 로그

- 2026-11-12 12:25 (KST) `new-task --issue 22 --slug pr-update-merge --size medium --type fix`로 선점·worktree 생성. `start` 결과 `needs-human` 없음. 같은 세션에서 PR #14를 `-s ours` 병합으로 갱신해 병합했다(Issue #4 댓글).
- 2026-11-12 12:29 (KST) 계획 작성(커밋 `c02c1d0`). 관련 코드 확인: `doRebase`(`scripts/runner/run.ts`)는 rebase 뒤 `--force-with-lease`로 push하고 push 결과를 확인하지 않는다. `pickNext`(`scripts/runner/next.ts`)는 `mergeState === 'BEHIND'`만 갱신 대상으로 보고, 충돌(`DIRTY`) PR은 CI 대기로 센다. 갱신·rebase 경로에 테스트가 없다.
- 2026-11-12 12:31 (KST) step0 구현(커밋 `c4443e5`): ADR-0006 작성·색인, 절차서 5절 "main에 뒤처지거나 충돌한 PR 갱신"(병합 명령, rebase 금지 이유, `merge -s ours` 복구, `needs-human` 보고), 설계서 v0.7.8(4.5절·10.3절 결속 설명·절차 4번·14.4절·로드맵·시험 항목의 rebase 표현), AGENTS.md 작업 루프 6번, TD-9 문구, TD-22·TD-23 등록, CHANGELOG. step0 AC 12개 모두 통과.
- 2026-11-12 12:33 (KST) step0 병합(PR #23, `9d10ad2`). `new-task --plan 20261112-pr-update-merge --step 1`로 step1 worktree 생성.
- 2026-11-12 12:40 (KST) step1 먼저 실패한 테스트:
  - `node --test scripts/test/branch-update.test.ts` → 파일 전체 실패(`lib/git.ts`에 `updateBranchFromBase` export 없음).
  - `node --test scripts/test/next.test.ts`의 새 PR 테스트: `BEHIND` → 기대 `update`, 실제 `rebase`. `DIRTY` → 기대 `update`, 실제 `idle`(충돌 PR을 무시하는 발견 사항 재현). `blocked` + `BEHIND` → 기대 `idle`, 실제 `rebase`(같은 중단 보고를 반복할 경로).
  - runner 통합 테스트(DIRTY PR)를 구현 파일만 stash한 옛 코드로 돌림 → 기대 `human`, 실제 `idle`(PR #14처럼 아무 보고 없이 멈춤).
- 2026-11-12 12:45 (KST) step1 구현: `updateBranchFromBase`(lib/git.ts), `pickNext`의 `update`·`DIRTY`·`blocked` 건너뛰기(runner/next.ts), `doUpdate`(runner/run.ts), `describeTask` 문구(commands/start.ts). `advanceRemote`를 `scripts/test/helpers.ts`로 옮겨 branch 지정·fetch 생략을 더했다. 새 테스트 13개 포함 AC 테스트 파일 4개 통과. architecture.md `lib/git.ts` 행, CHANGELOG 갱신.
- 2026-11-12 12:55 (KST) 자체 리뷰에서 헛도는 반복을 찾았다: runner 루프는 갱신 작업 뒤 기다리지 않으므로, GitHub이 계산이 늦어 `DIRTY`를 계속 알리는데 브랜치는 이미 최신이면 같은 PR을 쉬지 않고 다시 고른다. 테스트(`DIRTY` + 이미 최신, `maxIterations: 3`)를 먼저 추가 → 기대 `wait-env` 3회, 실제 0회로 실패. `doUpdate`가 `up-to-date`이면 `env`를 돌려 기존 환경 대기(`pollSec`, `usageLimitMaxWaitMin` 상한)를 타게 고친 뒤 AC 테스트 41개 통과.

## 의사결정 로그

- 결정: 세션과 runner 모두 PR 갱신을 `origin/main` 병합으로 한다. / 이유: 절차가 하나이고 갱신 경로에서 force push가 사라진다. squash 병합이라 main 이력에는 차이가 없다. / 버린 대안: runner만 rebase + `--force-with-lease` 유지(세션과 절차가 갈리고, 충돌 시 세션이 이어받으면 PR #14와 같은 상태가 된다), 에이전트에 자기 브랜치 lease push 허용(R14 완화. 제작자가 고르지 않았다).
- 결정: `DIRTY`도 갱신 대상으로 본다. 병합이 충돌하면 `blockPlan`으로 `needs-human`을 단다. / 이유: PR #14가 `DIRTY`였는데 runner는 `BEHIND`만 보고 CI 대기로 세어 아무 보고 없이 멈췄다. / 버린 대안: `DIRTY`는 바로 `needs-human`(GitHub의 `DIRTY` 판정은 계산 시점의 것이라, 직접 병합해 보는 편이 정확하다).
- 결정: PR 조치 루프에서 계획 상태가 `blocked`인 것은 건너뛴다. / 이유: `blockPlan`은 Issue에 라벨을 달고 PR에는 달지 않는다. 지금 루프는 PR 라벨만 보므로, 충돌한 PR을 매 바퀴 다시 골라 같은 보고를 반복한다.
- 결정: step을 문서(step0) → 코드(step1) 순서로 나눈다. / 이유: 세션용 절차는 문서만 바뀌어도 바로 쓸 수 있고, 결정(ADR)이 구현보다 먼저 리포에 남는다. 두 step 모두 PR 하나(400줄 안팎)에 든다. / 버린 대안: 한 step(문서·코드·테스트가 한 PR에 섞여 400줄을 넘을 수 있다).
- 결정: 갱신 함수는 `scripts/lib/git.ts`에 두고 runner는 호출만 한다. / 이유: `fastForwardMain`과 같은 방식(git 실패를 예외 대신 결과 값으로 돌려줌)이라 bare 원격으로 단위 테스트할 수 있다.
- 결정(step1): `updateBranchFromBase`는 PR 브랜치도 함께 fetch해, 원격 PR 브랜치에 로컬에 없는 커밋이 있으면 병합하기 전에 `failed`(precheck)로 끝낸다. / 이유: 다른 곳에서 push된 커밋을 모르고 병합 커밋을 만들면 push가 거부되고 로컬에 쓸모없는 병합 커밋만 남는다. PR #14처럼 로컬에서 rebase한 경우도 여기서 걸러 사람에게 넘긴다(`merge -s ours` 판단은 사람·세션이 한다).
- 결정(step1): main을 이미 포함해도 로컬 HEAD가 원격 PR 브랜치보다 앞서 있으면 push한다(`updated`). / 이유: push만 실패했던 앞 시도의 병합 커밋을 다시 올려야 하고, `up-to-date`로 끝내면 GitHub 상태가 그대로라 runner가 같은 PR을 계속 고른다.
- 결정(step1): 충돌이 아닌 갱신 실패(fetch·push·precheck)는 `pr:update` 실패로 기록하고 9.2절 판정(`judge`)이 멈추라고 하면 `blockPlan`한다. 환경 장애(`env`)로 표시하지 않는다. / 이유: push 거부·원격 앞섬은 기다려도 풀리지 않는다. 네트워크 장애와 구분할 방법이 없어 보수적으로 실패로 센다. / 버린 대안: 실패마다 바로 `blockPlan`(일시적 네트워크 실패에도 사람을 부른다).
- 결정(step1): GitHub은 갱신이 필요하다는데(`BEHIND`·`DIRTY`) 로컬은 이미 최신(`up-to-date`)이면 성공·실패로 세지 않고 `env`(환경 대기)로 돌려준다. / 이유: GitHub의 병합 상태 계산이 늦은 것이라 기다리면 풀린다. runner 루프는 갱신 작업 뒤 기다리지 않아, 성공으로 처리하면 같은 PR을 쉬지 않고 다시 고른다. 환경 대기는 `usageLimitMaxWaitMin`에서 runner를 멈춰 끝이 있다. / 버린 대안: 실패로 세기(계산이 늦을 뿐인데 5회 만에 사람을 부른다), 갱신 작업마다 고정 대기 추가(새 대기 규칙이 생긴다).
- 결정(step1): 충돌을 확인한 runner 통합 테스트를 더한다(AC 파일 `runner.test.ts` 안). / 이유: `doUpdate`의 연결(충돌 → `blockPlan` 한 번, 원격에 병합을 올리지 않음)은 단위 테스트만으로는 확인되지 않는다.

## 발견 사항

- runner `pickNext`는 `BEHIND`만 갱신 대상으로 본다. 브랜치 보호에 "main 최신 필수"가 꺼져 있으면 GitHub은 충돌 없이 뒤처진 PR을 `BEHIND`로 알리지 않고, 충돌한 PR은 `DIRTY`로 알린다. 그래서 지금 runner는 충돌한 PR을 CI 대기로 세고 아무 일도 하지 않는다 → 처리: #22 (step1)
- `doRebase`는 `--force-with-lease` push의 결과를 확인하지 않고 `pr:rebase-conflict`를 `ok: true`로 기록한다 → 처리: #22 (step1)
- 설계서 14.4절은 `push --force`를 금지 대상으로 적지만, runner의 step 완료 push는 일반 push가 거부되면 자기 브랜치에 `--force-with-lease`로 덮어쓴다(`scripts/runner/run.ts`). 문서는 에이전트만 막는다고 구분하지 않는다 → 처리: TD-22 (step0에서 등록)
- 다른 작업자(runner 등) worktree를 제작자 지시로 넘겨받을 정식 방법이 없다. PR #14 갱신 때 L1 훅(R3)이 계획 파일 수정을 막아, 진행 로그를 Issue #4 댓글로 남겼다 → 처리: TD-23 (step0에서 등록)

## 열린 질문

- 없음. 방향(main 병합, R14 유지)은 제작자가 승인했다(2026-11-12 대화). 나머지는 위 의사결정 로그의 구현 판단이다.

## 검증 방법과 결과

- step0: `node scripts/harness.ts doc-lint`와 step0의 grep AC. 결과: AC 12개 통과, `check` 통과(아래 진행 로그).
- step1: `node --test scripts/test/branch-update.test.ts scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/runner.test.ts`, `node scripts/harness.ts check`. 결과: AC 4개 명령 통과(테스트 41개), `check` 통과(진행 로그 참조).

## 다음 할 일

- step1 `check` → `complete-step` → PR(`Closes #22`). 마지막 step이다.
- 병합 뒤: 남은 TD-22(runner step 완료 push의 lease 폴백)·TD-23(다른 작업자 worktree 인계)은 별도 판단.
