---
id: 20261126-repoinfo-head-file
issue: 252 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-26T12:58:52+09:00 # new-task가 채운다
---

# repoInfo가 첫 커밋 전 작업 트리에 HEAD 파일이 있으면 브랜치 이름을 HEAD로 낸다(#236 회귀)

## 목표와 수용 기준

#236(Issue #230)이 `scripts/lib/git.ts`의 `repoInfo`를 git 한 번(`git rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD`)으로 바꿨다. 이 빠른 경로는 성공 여부와 출력 줄 수(넷)만 보고 넷째 줄을 브랜치 이름으로 쓴다. 첫 커밋 전 브랜치의 작업 트리에 `HEAD`라는 파일이 있으면 `rev-parse`는 리비전으로 풀 수 없는 `HEAD`를 파일 인자로 보고 그 글자를 출력하며 종료 코드 0으로 끝난다. 그래서 `repoInfo`가 브랜치 이름을 `HEAD`로 낸다(예전 경로 `symbolic-ref --short -q HEAD`는 `main`). PR #226 구현 판정의 Codex 지적 F3(재현됨)이고, 이 계획을 쓰며 임시 리포에서 다시 재현했다.

인자 끝에 `--`를 붙이면 `rev-parse`는 앞의 `HEAD`를 리비전으로만 읽는다. 첫 커밋 전이면 `bad revision 'HEAD'`로 128이 되어 예전 경로로 돌아가고, 커밋이 있으면 넷째 줄 브랜치 뒤에 다섯째 줄 `--`를 낸다(git 2.5x, 임시 리포에서 확인).

수용 기준:

1. 첫 커밋 전 브랜치(`main`)에서 작업 트리 루트에 `HEAD` 파일이 있을 때, 루트와 하위 폴더에서 부른 `repoInfo`의 값이 예전 두 번 읽기(`rev-parse` 세 경로 + `symbolic-ref --short -q HEAD`)와 같고 브랜치가 `main`이다.
2. 커밋이 있는 리포의 보통 경우(메인 체크아웃, worktree, detached HEAD, 겹치는 짧은 이름, 작업 트리의 `HEAD` 파일)에 git을 한 번만 띄우고 값이 예전과 같다. `scripts/test/repo-info.test.ts`의 있던 테스트를 고치지 않고 통과한다.
3. 빠른 경로가 다섯째 줄이 정확히 `--`일 때만 넷째 줄을 브랜치로 쓴다. 그 밖의 출력이면 예전 경로로 돌아간다(지금처럼 값과 예외가 예전과 같다).

## 범위 / 비범위

범위: `repoInfo`의 빠른 경로 인자와 출력 판정, 그 테스트, 변경 조각.

비범위:

- `repoInfo`의 다른 동작과 `toRepoInfo`, 다른 git 호출(`hasCommits`, `revParse` 등).
- Issue #230의 다른 속도 개선.
- 설계서. 동작 규칙은 바뀌지 않는다(예전 값으로 돌아갈 뿐이다).

## 관련 파일·문서

- `scripts/lib/git.ts`
- `scripts/test/repo-info.test.ts`
- `docs/harness/changes/20261126-repoinfo-head-file-s0.md`
- `docs/exec-plans/active/20261126-repoinfo-head-file/**`
- 읽기만: `scripts/test/helpers.ts`, `docs/exec-plans/completed/20261123-windows-test-speed/`

## step 목록

- step0 end-of-revs: 빠른 경로 인자 끝에 `--`를 붙이고 다섯째 줄 `--`를 확인한다. 첫 커밋 전 + `HEAD` 파일 테스트를 먼저 쓴다.

## 진행 로그

- 2026-11-26 접수: 제작자가 대화에서 남은 지적을 Issue로 열어 고치라고 지시했고 봇이 Issue #252를 등록했다. `new-task --issue 252 --slug repoinfo-head-file --type fix --size medium --risk high`로 시작했다(main `4816af5`).
- 2026-11-26 재현(임시 리포, 첫 커밋 전 `main`, 루트에 `HEAD` 파일): 지금 빠른 경로는 종료 코드 0과 넷째 줄 `HEAD`. 인자 끝에 `--`를 붙이면 `fatal: bad revision 'HEAD'`, 종료 코드 128. 커밋 뒤에는 `--`를 붙여도 0이고 넷째 줄 `main`, 다섯째 줄 `--`.

## 의사결정 로그

- 결정: 인자 끝에 `--`를 붙여 `HEAD`를 리비전으로만 읽게 한다. / 이유: git 실행 횟수(한 번)를 그대로 두면서 모호한 경우를 예전 경로로 돌린다. / 버린 대안: `--verify`를 쓴다(경로 셋을 함께 묻는 꼴에서 동작을 따로 확인해야 한다), 넷째 줄이 `HEAD`이고 그 이름의 파일이 있으면 예전 경로로 간다(파일 검사가 하나 늘고 detached HEAD의 `HEAD`와 가르기가 번거롭다).
- 결정: risk는 high다. / 이유: 운영 단계에서 `scripts/`는 보호 경로라 위험도 높음이다(절차서 5절).

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 `node scripts/harness.ts check`.

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 테스트를 먼저 쓰고 고친다.
