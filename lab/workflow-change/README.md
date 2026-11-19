# 워크플로 변경 시험 (TD-53, Issue #139)

봇 토큰에는 `workflow` 권한이 없어 봇은 `.github/workflows/`를 바꾼 커밋을 push할 수 없다(`docs/SECURITY.md`). 워크플로를 바꿔야 할 때의 절차를 작은 변경으로 한 번 해 보는 기록이다. 계획은 `docs/exec-plans/`의 `20261119-workflow-change-procedure`.

## 순서

1. 봇이 이 브랜치(`chore/20261119-workflow-change-procedure`)에 계획과 패치를 올린다. PR은 아직 없다.
2. **제작자**가 이 브랜치에 패치를 적용한 커밋을 올린다(아래 "제작자 작업").
3. 봇이 그 위에 구조 테스트(`scripts/test/ci.test.ts`)와 문서를 올리고 PR을 연다. 워크플로 커밋이 없으면 이 테스트가 실패해 `check`가 통과하지 못한다.
4. 판정이 통과하면 봇이 승인을 요청하고, 제작자가 승인하면 병합된다.

## 패치가 바꾸는 것

`judge-codex-repro-comment.patch`: `.github/workflows/judge-codex.yml`의 머리 주석에 재현 job(`repro`) 설명 한 줄을 더한다. `judge-claude.yml`에는 이미 있는 줄이다. 주석이라 워크플로의 동작은 바뀌지 않는다.

## 제작자 작업

제작자 계정의 자격증명이 있는 터미널에서 한다. 에이전트 세션 안(`!` 명령 포함)에서는 봇 토큰이 쓰여 push가 거부된다.

방법 A(터미널). 봇의 worktree에서 바로 한다. 다른 브랜치로 옮기거나 받을 것이 없다.

```bash
cd /Users/sol/Desktop/harness_project.worktrees/chore/20261119-workflow-change-procedure
git status --short                    # 아무것도 나오지 않아야 한다
git apply lab/workflow-change/judge-codex-repro-comment.patch
git add .github/workflows/judge-codex.yml
git commit -m "ci(judge-codex): 머리 주석에 재현 job 설명을 더한다" -m "Refs #139"
git push origin chore/20261119-workflow-change-procedure
```

방법 B(GitHub 웹). 브랜치 `chore/20261119-workflow-change-procedure`에서 `.github/workflows/judge-codex.yml`을 열어 `# store:` 줄 바로 아래에 패치의 `+` 줄(맨 앞의 `+`는 빼고)을 넣고 그 브랜치에 바로 커밋한다.

확인: push가 거부되지 않으면 된 것이다. `git log --oneline -1 origin/chore/20261119-workflow-change-procedure`에 방금 커밋이 보인다. 끝나면 봇에게 알린다.

## 결과

`result.json`에 적는다(봇이 3번에서 올린다).
