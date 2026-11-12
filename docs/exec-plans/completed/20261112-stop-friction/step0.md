# Step 0: guard-own-worktree

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-stop-friction/plan.md` (목표, 의사결정 로그)
- `docs/harness/design.md` 5.1절 R3 행, 4.2절
- `docs/harness/workflow.md` 1절
- `scripts/hooks/rules.ts` (`GuardContext`, `evaluateFile`, `within`, `tmpRoots`)
- `scripts/hooks/guard.ts` (`decide`)
- `scripts/lib/git.ts` (`RepoInfo`, `tryRepoInfo`), `scripts/lib/plan.ts` (`findPlan`, `parseDoc`, `parseBranch`, `PLANS_DIR`)
- `scripts/test/guard.test.ts` ("파일 도구: main 체크아웃·worktree 밖·계획 없음·.env·자격증명")

## 작업

배경: `new-task`는 worktree를 리포 옆 폴더(`../<repo>.worktrees/...`)에 만든다. 훅은 세션의 현재 폴더(`cwd`)로 리포를 정하므로, main 체크아웃에서 시작한 대화 세션이 그 worktree 파일을 고치면 "worktree 밖"(R3)으로 막힌다. 유일한 길인 `EnterWorktree`는 매번 사람 승인을 기다린다.

1. `scripts/hooks/rules.ts`
   - `GuardContext`에 선택 필드 세 개를 더한다.
     - `repoOf?: (abs: string) => RepoInfo | null` — 경로가 속한 리포(worktree) 정보
     - `planOwner?: (root: string, id: string) => string | null` — 그 worktree 계획의 frontmatter `owner`
     - `worker?: string` — 현재 작업자 이름
   - `evaluateFile`의 쓰기 판정에서 대상이 현재 리포 루트 밖이면, 아래 순서로 판정한다(필드가 없으면 지금과 같다).
     1. `repoOf(abs)`가 같은 리포(`commonDir` 같음)의 다른 worktree가 아니면 지금처럼 임시 폴더·`~/.claude/plans` 허용, 나머지는 R3 "worktree 밖".
     2. 현재 세션이 main 체크아웃이 아니면(다른 작업 worktree 안) R3로 막는다. 메시지는 "다른 작업 worktree(<경로>)의 파일" + "지금 worktree의 작업만 한다".
     3. 대상이 main 체크아웃이면 그 리포 정보로 기존 "main 체크아웃 수정" 판정을 한다.
     4. 대상 worktree 브랜치(`parseBranch`)의 계획 `owner`가 `worker`와 다르거나 없으면 R3로 막는다. 메시지는 "<owner>의 작업 worktree" + "자기 계획(owner가 <worker>)의 worktree만 고친다. 넘겨받으려면 제작자에게 묻는다".
     5. 통과하면 대상 worktree의 `RepoInfo`를 기준으로 기존 판정(계획 폴더 허용, R1 브랜치 이름, R1 계획 존재)을 그대로 한다.
2. `scripts/hooks/guard.ts` `decide`
   - `repoOf`: 경로에서 존재하는 가장 가까운 상위 폴더를 찾아 `tryRepoInfo`.
   - `planOwner`: `findPlan`으로 계획 파일을 찾아 frontmatter `owner`(문자열)를 돌려준다. 못 읽으면 `null`.
   - `worker`: `process.env.HARNESS_WORKER ?? 'session'` (`new-task`의 owner 기본값과 같은 규칙).
3. 테스트(`scripts/test/guard.test.ts`, 실제 git 리포·worktree로)
   - main 체크아웃 세션 → 자기 소유 worktree의 코드·계획 파일: 허용.
   - main 체크아웃 세션 → 다른 owner(`runner-1`) worktree: R3.
   - main 체크아웃 세션 → 계획 없는 작업 브랜치 worktree, 규칙 밖 브랜치 worktree: 막힌다.
   - worktree A 세션 → worktree B: R3.
   - worktree 세션 → main 체크아웃 파일: R3.
   - 다른 리포·리포 밖 경로: 지금처럼 R3(임시 폴더는 허용).
   - 실제 훅 프로세스(`runGuard`)로 main 체크아웃 `cwd` + 자기 소유 worktree 파일 `Write`가 종료 코드 0인지 확인한다.
4. 문서
   - `docs/harness/workflow.md` 1절: 대화 세션은 main 체크아웃에 머문 채 `new-task`가 출력한 worktree 경로의 파일을 고친다(`EnterWorktree` 불필요). 셸 명령은 `git -C <worktree> …` 또는 `cd <worktree> && …`로 실행하고, push는 브랜치 이름을 명시한다(`git -C <worktree> push -u origin <브랜치>`; 인자 없는 `git push`는 세션 위치가 main이라 R2로 막힌다).
   - `docs/harness/design.md` 5.1절 R3 행의 L1 설명에 "main 체크아웃의 대화 세션은 자기 소유 작업 worktree만 고칠 수 있다"를 더하고, 버전을 v0.7.6으로 올려 변경 이력에 한 줄 남긴다.
   - `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts
node scripts/harness.ts check
```

## 금지사항

- 다른 작업자의 worktree나 main 체크아웃 쓰기를 허용하지 마라. 이유: R3의 목적(작업 간 간섭 방지)이 그대로 남아야 한다.
- 대상 계획을 못 읽거나 owner가 없을 때 허용 쪽으로 처리하지 마라. 이유: L1은 fail-closed다(13.1절).
- Bash 명령 판정(`evaluateBash`)은 바꾸지 마라. 이유: 이 step의 범위가 아니다(`cd` 추적은 비범위).
