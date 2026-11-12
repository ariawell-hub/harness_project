# Step 1: keep-current-worktree

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-stop-friction/plan.md`
- `scripts/runner/run.ts` (`cleanupMerged`)
- `scripts/commands/start.ts` (② 절에서 `cleanupMerged` 호출)
- `scripts/runner/next.ts` (`LocalPlan`)
- `scripts/test/runner.test.ts`, `scripts/test/helpers.ts`
- `docs/harness/workflow.md` 1절(step0에서 바꾼 대화 세션 안내)

## 작업

배경: `start`는 병합된 worktree를 지운다. 세션이 그 worktree 안에 있으면 세션의 현재 폴더가 사라져 이후 명령이 모두 실패한다(2026-11-11 실제 발생).

1. `scripts/runner/run.ts`
   - `cleanupMerged(main, cfg, locals, here = process.cwd())`: `here`가 그 worktree 경로 안(같거나 하위)이면 지우지 않고 선점 해제도 하지 않는다. 대신 `- 남김: <경로> — 지금 이 프로세스가 그 worktree 안에서 실행 중이다. main 체크아웃으로 나간 뒤(ExitWorktree 또는 cd) start를 다시 실행하면 정리된다`를 출력한다.
   - 경로 비교는 `realpath` 기준으로 한다(macOS `/private/tmp` 같은 심볼릭 링크 차이).
   - 반환값(지운 경로 목록)과 기존 호출부(`start.ts`, runner 루프)는 바꾸지 않는다.
2. 테스트(`scripts/test/runner.test.ts` 또는 새 파일)
   - 병합된 계획 두 개 중 `here`가 들어 있는 worktree는 남고 출력에 "남김"이 있으며, 다른 하나는 지워진다.
3. `docs/harness/workflow.md` 1절: 세션이 들어가 있던 worktree가 지워져 명령이 실패하면 `ExitWorktree`(또는 main 체크아웃으로 `cd`)로 돌아온다는 한 줄.
4. `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts
node scripts/harness.ts check
```

## 금지사항

- `scripts/commands/start.ts`를 고치지 마라. 이유: 열린 PR #14가 같은 부분을 고친다(충돌 회피).
- 다른 세션이 쓰는 worktree를 추측으로 찾지 마라(프로세스 목록·lsof 등). 이유: OS마다 다르고 Claude Code 세션은 셸 명령마다 새 프로세스라 믿을 수 없다(비범위).
