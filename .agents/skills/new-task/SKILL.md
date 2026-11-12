---
name: new-task
description: GitHub Issue 하나를 맡아 작업을 시작할 때 사용한다. claim 브랜치로 선점하고 브랜치·worktree·계획 골격을 만든다. 코드를 고치기 전에 항상 먼저 실행한다.
---

# new-task

실제 동작은 `scripts/commands/task.ts`가 한다. 이 스킬은 언제·어떻게 쓰는지만 알려 준다.

1. 세션 시작 절차를 먼저 실행한다: `node scripts/harness.ts start`
2. 맡을 Issue와 규모를 정한다(docs/harness/workflow.md 1절).
3. 실행한다:
   ```bash
   node scripts/harness.ts new-task --issue <N> --slug <kebab-이름> --size <small|medium|large> [--type feat|fix|docs]
   ```
   - 선점이 거부되면(이미 claim됨) 다음 Issue로 간다.
   - 다음 step이면: `node scripts/harness.ts new-task --plan <계획 id> --step <N>`
4. 출력된 worktree로 이동해 계획 파일부터 채운다. main 체크아웃은 고치지 않는다(R3).
