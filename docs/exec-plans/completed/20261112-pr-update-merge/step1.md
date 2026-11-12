# Step 1: runner-update

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-pr-update-merge/plan.md` (목표, 의사결정 로그, 발견 사항)
- `docs/decisions/ADR-0006-pr-update-merge.md` (step0에서 만듦)
- `docs/harness/workflow.md` 5절 "main에 뒤처지거나 충돌한 PR 갱신" (step0에서 만듦)
- `scripts/lib/git.ts` `fastForwardMain`(결과 값 방식의 예), `gitTry`
- `scripts/runner/run.ts` `doRebase`, `blockPlan`, `recordAttempt` 호출, 메인 루프의 `case 'rebase'`
- `scripts/runner/next.ts` `Task` 타입, `pickNext`의 "2. 내 PR 중 조치가 필요한 것"
- `scripts/commands/start.ts` `describeTask`
- `scripts/test/start.test.ts` `advanceRemote`(bare 원격 앞당기기), `scripts/test/helpers.ts` `makeFixture`, `scripts/test/next.test.ts`

## 작업

1. `scripts/lib/git.ts`에 PR 브랜치 갱신 함수를 더한다.
   ```ts
   export type BranchUpdate =
     | { status: 'up-to-date'; head: string }
     | { status: 'updated'; from: string; to: string }
     | { status: 'conflict'; files: string[] }
     | { status: 'failed'; stage: 'precheck' | 'fetch' | 'merge' | 'push'; reason: string };
   export function updateBranchFromBase(
     worktree: string,
     remote: string,
     base: string,
     branch: string,
   ): BranchUpdate;
   ```
   - 순서: worktree가 깨끗한지 확인(아니면 `failed`/`precheck`) → `git fetch <remote> <base>` → `<remote>/<base>`가 이미 HEAD의 조상이면 `up-to-date` → `git merge --no-edit <remote>/<base>` → 충돌이면 충돌 파일 목록을 모으고 `git merge --abort`로 되돌린 뒤 `conflict` → `git push <remote> HEAD:refs/heads/<branch>`(일반 push) → 실패면 `failed`/`push` → `updated`.
   - 예외를 던지지 않는다. git 실패는 모두 결과 값으로 돌려준다.
   - 어떤 경우에도 force push(`--force`, `--force-with-lease`, `+refspec`)를 쓰지 않는다.
   - `conflict`·`failed`(merge 단계) 뒤에는 worktree에 진행 중인 병합(`MERGE_HEAD`)이 남지 않고 HEAD가 호출 전과 같다.
2. `scripts/runner/next.ts`: `Task`의 `{ kind: 'rebase' }`를 `{ kind: 'update' }`로 바꾼다. "2. 내 PR" 루프에서
   - 계획 상태(`l.fm.status`)가 `blocked`면 건너뛴다.
   - `pr.mergeState`가 `BEHIND` 또는 `DIRTY`면 `update` 작업을 고른다. 이유 문구에 상태를 넣는다(예: `PR #N가 main과 충돌한다(DIRTY)`).
3. `scripts/runner/run.ts`: `doRebase`를 `doUpdate`로 바꿔 `updateBranchFromBase`를 호출한다.
   - `updated`·`up-to-date`: 성공 기록, `event(ctx, 'updated', …)`.
   - `conflict`: 실패 기록(충돌 파일 포함) 뒤 `blockPlan`(이유에 충돌 파일, 절차서 5절 안내).
   - `failed`: 실패 기록(`ok: false`, stage·reason). 성공으로 기록하지 않는다.
   - 실패 키는 `pr:update`로 한 가지를 쓴다.
4. `scripts/commands/start.ts` `describeTask`: `update`는 `PR #N를 origin/main 병합으로 갱신 (worktree …, 절차서 5절)` 형태로 안내한다.
5. 테스트(먼저 실패하는 것을 확인하고 진행 로그에 남긴다):
   - 새 파일 `scripts/test/branch-update.test.ts`: 로컬 bare 원격으로 (a) main만 앞선 경우 병합 커밋이 생기고 원격 PR 브랜치가 fast-forward로 갱신된다 (b) 이미 최신이면 `up-to-date`이고 커밋이 생기지 않는다 (c) 같은 줄을 고친 충돌이면 `conflict`와 파일 목록, worktree 깨끗함, HEAD·원격 그대로 (d) 원격 PR 브랜치가 다른 커밋으로 앞서 있으면 `failed`/`push`이고 원격 브랜치가 그대로다(덮어쓰지 않음) (e) 미커밋 변경이 있으면 `failed`/`precheck`. `advanceRemote` 같은 도우미가 필요하면 `scripts/test/helpers.ts`로 옮겨 함께 쓴다.
   - `scripts/test/next.test.ts`: `BEHIND`·`DIRTY` PR은 `update`, 계획이 `blocked`인 `DIRTY` PR은 고르지 않는다.
6. 문서: `docs/harness/architecture.md`의 `lib/git.ts` 행에 "PR 브랜치 main 병합 갱신"을 더하고, `docs/harness/CHANGELOG.md`에 한 줄(Issue #22 step1)을 더한다. 계획의 진행 로그·검증 결과·발견 사항 처리를 갱신한다.

## Acceptance Criteria

```bash
node --test scripts/test/branch-update.test.ts scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/runner.test.ts
! grep -n "kind: 'rebase'" scripts/runner/next.ts scripts/runner/run.ts scripts/commands/start.ts
! grep -n "doRebase" scripts/runner/run.ts
grep -q "export function updateBranchFromBase" scripts/lib/git.ts
```

## 금지사항

- 갱신 경로에서 force push를 쓰지 마라. 이유: ADR-0006. 원격 PR 브랜치가 예상과 다르면 실패로 기록한다.
- runner step 완료 push의 `--force-with-lease` 폴백은 고치지 마라. 이유: 이번 범위 밖(TD-22).
- L1 훅(`scripts/hooks/`)을 고치지 마라. 이유: R14 유지가 결정이다.
- 충돌을 자동으로 해결하지 마라(`-X ours`/`-X theirs` 등). 이유: 의미를 판단해야 하므로 사람(2단계에서는 해결 세션)에게 넘긴다.
