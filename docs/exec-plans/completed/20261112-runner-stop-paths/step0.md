# Step 0: conflict-resolve

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-runner-stop-paths/plan.md` (수용 기준, 의사결정 로그)
- `docs/decisions/ADR-0006-pr-update-merge.md`, `docs/harness/workflow.md` 5절
- `scripts/lib/git.ts` `updateBranchFromBase`
- `scripts/runner/run.ts` `doUpdate`·`doAnswered`·`blockPlan`·`doStep`(판정 부분), `scripts/runner/next.ts` `readLocalPlans`·`pickNext` 2번
- `scripts/runner/prompt.ts`, `scripts/test/fake-agent.ts`, `scripts/test/runner.test.ts` `openPR`

## 작업

1. `scripts/lib/git.ts` `updateBranchFromBase(worktree, remote, base, branch, opts?: { keepConflict?: boolean })`: `keepConflict`면 충돌 때 병합을 취소하지 않고 `{ status: 'conflict', files }`를 돌려준다(병합 진행 중). 기본 동작은 그대로.
2. `scripts/runner/next.ts`
   - 충돌 상태 `ConflictState { waiting: boolean; resolve: boolean; files: string[] }`를 worktree 하네스 상태 폴더의 `conflict.json`에 읽고 쓰는 `readConflictState(worktree)`·`writeConflictState(worktree, s)`(없거나 깨졌으면 모두 false·빈 배열).
   - `LocalPlan.conflictWaiting`. `pickNext` 2번은 답을 기다리는 충돌 계획의 PR을 고르지 않고 사람 대기로 센다.
3. `scripts/runner/run.ts`
   - `doUpdate`: 충돌이면 `blockPlan`을 부르지 않는다. `conflict.json`에 `{ waiting: true, files }`를 쓰고, Issue에 `needs-human` 라벨과 중단 보고 댓글(충돌 파일, 병합은 취소했다, 사람이 결정할 것: A 답하면 해결 세션(추천) / B 직접 병합해 push한 뒤 답 / C 포기)을 남긴다. 계획 파일은 바꾸지 않는다.
   - `doAnswered`: `conflict.json`이 `waiting`이면 `{ waiting: false, resolve: true }`로 바꾸고 `answer.md`만 남긴다. 계획·step 상태는 바꾸지 않는다.
   - `doUpdate`: `resolve`면 `doResolveConflict`. `judge`가 stop이면 다시 `waiting`으로 넘긴다(위 보고, 사유에 실패 횟수). 아니면 `updateBranchFromBase(..., { keepConflict: true })`. 충돌이 아니면(갱신·최신) 상태를 지우고 끝. 충돌이면 해결 세션(`conflictPrompt`)을 띄운 뒤 runner가 판정: 충돌 파일에 `<<<<<<<`·`>>>>>>>`로 시작하는 줄이 없음 → `git add -A` → 미병합 경로 없음 → step AC(있으면)·`check` 통과 → `git commit --no-edit` → 일반 push. 실패면 `git merge --abort`, `pr:conflict` 실패 기록. 성공이면 상태를 지우고 `pr:conflict` 성공 기록, 답 파일 삭제.
4. `scripts/runner/prompt.ts` `conflictPrompt`: 지도, 계획 파일·브랜치, 충돌 파일 목록, 해야 할 일(양쪽 의도 유지, 번호를 함께 쓰는 자리는 main을 먼저 두고 이 브랜치 내용을 다음 번호로, 진행 로그 한 줄, `check` 확인), 하지 말 것(git 명령, 무관한 변경), 제작자 답변, 직전 실패, 방법 전환, 공통 규칙.
5. `scripts/test/fake-agent.ts`: 프롬프트가 충돌 해결이면 behavior `conflict` 순서(`ok` | `fail`)대로, `ok`면 나열된 파일의 충돌 표시 줄을 지운다(양쪽 내용 유지). git은 쓰지 않는다.
6. 테스트(먼저 실패 확인): `branch-update.test.ts`(`keepConflict`), `runner.test.ts`(충돌 중단이 계획 파일을 안 바꿈, 답 뒤 해결 성공·실패), `next.test.ts`(답을 기다리는 충돌 계획은 update로 고르지 않음).
7. 문서: 설계서 4.5절(실패와 대기)·v0.7.14 이력, ADR-0006 결정 3·5와 runner 갱신 경로, 절차서 5절, CHANGELOG, architecture.md, TD-27 해결.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts scripts/test/next.test.ts scripts/test/branch-update.test.ts
grep -q "export function conflictPrompt" scripts/runner/prompt.ts
grep -q "keepConflict" scripts/lib/git.ts
grep -q "v0.7.14" docs/harness/design.md
grep -q "TD-27.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- force push, `reset --hard`, `clean -f`를 쓰지 마라. 이유: R2·R14. 되돌리기는 `git merge --abort`만 쓴다.
- runner 세션 권한 프로필에 git 권한을 더하지 마라. 이유: 권한 확대는 범위 밖이다.
- 충돌 표시가 남았거나 검사가 실패한 병합을 커밋·push하지 마라. 이유: runner 판정이 근거다.
- 충돌 중단 때 계획 파일(`status`, `index.json`)을 바꾸지 마라. 이유: 열린 PR의 plan-gate가 실패한다(PR #29).
