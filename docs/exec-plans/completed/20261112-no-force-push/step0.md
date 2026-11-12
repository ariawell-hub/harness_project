# Step 0: no-force-push

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-no-force-push/plan.md` (의사결정 로그)
- `docs/decisions/ADR-0006-pr-update-merge.md`
- `docs/harness/design.md` 14.4절
- `scripts/runner/run.ts` `doStep`의 "통과: … push → PR" 부분, `blockPlan`
- `scripts/lib/git.ts` `updateBranchFromBase`(같은 갈라짐 판정을 이미 한다)
- `scripts/test/runner.test.ts` `setup`, `openPR`, `runnerEvents`, `scripts/test/helpers.ts` `advanceRemote`

## 작업

1. `scripts/lib/git.ts`에 `export function remoteBranchDiverged(worktree: string, remote: string, branch: string): boolean`을 더한다. `<remote> <branch>`를 fetch하고, `<remote>/<branch>`가 HEAD의 조상이 아니면 `true`다. fetch 실패나 원격 브랜치가 없으면 `false`(갈라짐을 확인하지 못함). 예외를 던지지 않는다.
2. `scripts/runner/run.ts` `doStep`: 일반 push가 실패하면
   - `remoteBranchDiverged`가 `true`면 `pr:push` 실패를 기록하고 `blockPlan`(이유: 원격 브랜치에 로컬에 없는 커밋이 있어 덮어쓰지 않는다, 절차서 5절)을 부른 뒤 `'blocked'`를 돌려준다.
   - 아니면 지금처럼 `push-fail` 이벤트 뒤 `'env'`.
   - `--force-with-lease` 호출을 지운다.
3. 테스트(먼저 실패를 확인하고 진행 로그에 남긴다)
   - `scripts/test/branch-update.test.ts`: `remoteBranchDiverged`가 원격이 앞서면 `true`, 같거나 로컬이 앞서면 `false`, 원격 브랜치가 없으면 `false`.
   - `scripts/test/runner.test.ts`: runner-1 계획 브랜치를 원격에 push한 뒤 다른 clone에서 커밋 하나를 더 올린다. runner가 계획·step0을 끝내고 push할 때 덮어쓰지 않고 멈추는지(종료 `human`, Issue에 `needs-human`, 원격 브랜치 head 그대로, PR 없음) 확인한다.
4. 문서: 설계서 14.4절 git 행에 "runner 스크립트도 force push하지 않는다. 자기 브랜치 push가 거부되면 멈추고 보고한다(Issue #27)"를 더하고 버전을 v0.7.9로 올린다. TD-22를 해결로 바꾼다. ADR-0006 결과의 TD-22 문장, CHANGELOG, architecture.md `lib/git.ts` 행을 갱신한다.

## Acceptance Criteria

```bash
node --test scripts/test/branch-update.test.ts scripts/test/runner.test.ts
! grep -rn "force-with-lease" scripts/runner scripts/lib
grep -q "export function remoteBranchDiverged" scripts/lib/git.ts
grep -q "v0.7.9" docs/harness/design.md
```

## 금지사항

- 원격 커밋을 자동으로 병합하거나 `-s ours`로 연결하지 마라. 이유: 어느 쪽을 남길지는 사람이 판단한다.
- L1 훅(`scripts/hooks/`)을 고치지 마라. 이유: 이번 범위 밖이다.
