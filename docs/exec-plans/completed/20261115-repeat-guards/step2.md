# Step 2: approval-guard

## 읽어야 할 파일

- `AGENTS.md` 작업 루프 6번, `docs/harness/workflow.md` 5절(위험도 높음, main 병합 갱신)
- `scripts/hooks/rules.ts` (`gitRules`의 push 판정, `ghRules`), `scripts/hooks/guard.ts` (`buildContext`, `GuardContext` 주입 방식)
- `scripts/lib/git.ts` (`harnessStateDir`, `listWorktrees`, `isClean`), `scripts/lib/plan.ts` (`parseBranch`, `findPlan`, `readIndex`)
- `scripts/commands/task.ts`의 `complete-step`, `scripts/harness.ts`의 명령 등록
- step1이 바꾼 `scripts/hooks/rules.ts`·`scripts/hooks/shell.ts`

## 작업

1. 명령 `node scripts/harness.ts pr-ready [--undo]`(worktree 안에서 실행)을 만든다.
   - 조건을 확인하고, 하나라도 안 되면 이유와 고치는 법을 출력하고 0이 아닌 코드로 끝난다(GitHub은 건드리지 않는다).
     - 현재 브랜치가 계획 브랜치이고 그 step이 `index.json`에서 `completed`다(small 계획은 계획 `status: completed`).
     - 작업 트리가 깨끗하고 HEAD가 `origin/<브랜치>`와 같다(다 push했다).
     - `git fetch` 뒤 `origin/main`이 HEAD의 조상이다(main에 뒤처지지 않았다).
   - 통과하면 PR의 초안을 해제하고(`gh pr ready <브랜치>`), worktree별 하네스 상태 폴더에 승인 요청 표시(그때의 HEAD sha)를 남긴다.
   - `--undo`는 PR을 초안으로 되돌리고 표시를 지운다. 표시가 없어도 실패하지 않는다.
   - GitHub 호출은 기존 `GitHubPort`·가짜 구현(`github-fake.ts`)을 거쳐 테스트할 수 있게 한다.
2. L1 훅 규칙을 더한다.
   - `gh pr ready`를 직접 실행하면 막고 `pr-ready` 명령을 안내한다(`--undo` 포함).
   - 승인 요청 표시가 있는 worktree의 브랜치를 `git push`하려 하면 막는다. 단, 표시의 sha 뒤에 더한 커밋이 병합 커밋뿐이면(`git rev-list --no-merges <sha>..<브랜치>`가 비어 있음) 허용한다. 고치는 법: 제작자에게 먼저 알리고 `pr-ready --undo`로 승인 요청을 거둔 뒤 push하거나, 다음 PR에 넣는다.
   - 계획 `risk: high`인 브랜치로 `gh pr create`를 `--draft` 없이 실행하면 막는다.
   - push·PR 대상 브랜치는 명령의 인자(`git push <원격> <브랜치>`, `gh pr create --head`)로, 없으면 `git -C`·세션 위치의 브랜치로 정한다. 브랜치의 worktree는 `git worktree list`로 찾는다. 판정에 필요한 조회는 `GuardContext`에 함수로 주입해 `rules.ts`를 순수하게 유지한다.
   - 표시나 계획을 읽지 못하면 이 규칙들은 막지 않는다(기존 규칙 판정은 그대로). 이 규칙은 실수 방지용이고 R20 같은 보장 대상이 아니다.
3. 테스트를 먼저 쓴다(`scripts/test/guard.test.ts`, `scripts/test/pr-ready.test.ts`). 차단·허용 사례와 `pr-ready`의 조건별 실패, 표시 생성·삭제.
4. `AGENTS.md`·절차서 5절의 "초안을 해제하며 승인을 요청한다"를 `pr-ready` 명령으로 바꿔 적고, 표준 명령 도움말(`scripts/harness.ts`), 설계서 13.1절, `docs/harness/architecture.md`, CHANGELOG를 맞춘다.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts scripts/test/pr-ready.test.ts
```

## 금지사항

- 에이전트가 승인하거나 보호 설정을 바꾸는 경로를 만들지 마라. 이유: R20. `pr-ready`는 초안 상태만 바꾼다.
- force push·rebase를 쓰지 마라. 이유: R14, ADR-0006.
- 기존 push 판정(R2 main 보호, R14 force push)을 바꾸지 마라. 이유: 새 규칙은 그 뒤에 더해지는 차단이다.
- 훅에서 네트워크를 호출하지 마라. 이유: 훅은 빨라야 하고 GitHub 장애로 push가 막히면 안 된다(의사결정 로그).
