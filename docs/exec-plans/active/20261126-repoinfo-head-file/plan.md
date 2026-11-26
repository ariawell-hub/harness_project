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
3. 빠른 경로가 다섯째 줄이 정확히 `--`일 때만 넷째 줄을 브랜치로 쓴다. 그 밖의 출력(종료 코드 0이어도 다섯째 줄이 다르거나 줄 수가 다름)이면 예전 경로로 돌아간다(지금처럼 값과 예외가 예전과 같다). 꾸민 출력으로 테스트한다.
4. detached HEAD와 브랜치와 같은 짧은 이름의 ref가 있을 때도 git을 한 번만 띄운다(새 테스트로 실행 횟수를 단언).
5. `docs/harness/architecture.md`의 `lib/git.ts` 줄이 적은 빠른 경로 명령이 실제와 같다.
6. 지표 명령의 허용 목록(`scripts/test/metrics-allow.ts`)과 기대값(`scripts/test/metrics-command.test.ts`)이 새 인자를 그대로 적는다(옛 꼴은 남기지 않는다). `metrics-command.test.ts`가 통과한다.

## 범위 / 비범위

범위: `repoInfo`의 빠른 경로 인자와 출력 판정, 그 테스트, 그 인자를 못박은 지표 허용 목록과 기대값, 코드 구조 문서, 변경 조각.

비범위:

- `repoInfo`의 다른 동작과 `toRepoInfo`, 다른 git 호출(`hasCommits`, `revParse` 등).
- Issue #230의 다른 속도 개선.
- 설계서. 동작 규칙은 바뀌지 않는다(예전 값으로 돌아갈 뿐이다).

## 관련 파일·문서

- `scripts/lib/git.ts`
- `scripts/test/repo-info.test.ts`
- `scripts/test/metrics-allow.ts`(`GIT_READ_SHAPES`의 `rev-parse` 꼴)
- `scripts/test/metrics-command.test.ts`(`REPO_INFO_GIT`)
- `docs/harness/architecture.md`
- `docs/harness/changes/20261126-repoinfo-head-file-s0.md`
- `docs/exec-plans/active/20261126-repoinfo-head-file/**`
- 읽기만: `scripts/test/helpers.ts`, `docs/exec-plans/completed/20261123-windows-test-speed/`

## step 목록

- step0 end-of-revs: 빠른 경로 인자 끝에 `--`를 붙이고 다섯째 줄 `--`를 확인한다. 첫 커밋 전 + `HEAD` 파일 테스트를 먼저 쓴다.

## 진행 로그

- 2026-11-26 접수: 제작자가 대화에서 남은 지적을 Issue로 열어 고치라고 지시했고 봇이 Issue #252를 등록했다. `new-task --issue 252 --slug repoinfo-head-file --type fix --size medium --risk high`로 시작했다(main `4816af5`).
- 2026-11-26 재현(임시 리포, 첫 커밋 전 `main`, 루트에 `HEAD` 파일): 지금 빠른 경로는 종료 코드 0과 넷째 줄 `HEAD`. 인자 끝에 `--`를 붙이면 `fatal: bad revision 'HEAD'`, 종료 코드 128. 커밋 뒤에는 `--`를 붙여도 0이고 넷째 줄 `main`, 다섯째 줄 `--`.
- 2026-11-26 계획 검증 1회차(head `1633e7f`): Claude 승인(지적 없음), Codex 수정 요청(P1 둘, P2 하나). 모두 받아들였다. F1(성공 응답의 다섯째 줄이 `--`가 아닐 때 예전 경로로 가는지 검증하지 않는다) → 꾸민 출력으로 보는 테스트 (나)를 작업과 수용 기준 3에 더했다. F2(detached HEAD와 겹치는 이름에서 git 실행 횟수를 보지 않는다) → 실행 횟수를 단언하는 테스트 (다)와 수용 기준 4를 더했다(AC의 테스트 수 6 → 8). F3(P2, 코드 구조 문서의 빠른 경로 명령) → 관련 파일과 작업 3, 수용 기준 5, AC 한 줄을 더했다. 그 사이 main에 #241이 병합돼 `origin/main`을 병합했다.
- 2026-11-26 계획 검증 2회차(head `e499f26`): 두 검증자 승인(G1).
- 2026-11-26 테스트 먼저: `scripts/test/repo-info.test.ts`에 (가) 첫 커밋 전 + `HEAD` 파일(루트·하위 폴더), (나) 빠른 경로가 성공해도 다섯째 줄이 `--`가 아닌 꾸민 출력(줄 넷, 다른 글, 줄 여섯), (다) 같은 이름의 태그·원격 추적 ref·detached HEAD에서 git 한 번을 더했다(테스트 8건). 고치기 전에 (가)·(나)가 실패했다((가)는 브랜치 `HEAD`, (나)는 예전 경로를 타지 않음). (다)는 지금도 통과하며 고친 뒤 git 한 번이 유지되는지 지킨다. 고친 뒤 8건 통과.
- 2026-11-26 `check` 실패(push 전): `scripts/test/metrics-command.test.ts` 6건. 지표 명령의 허용 목록(`metrics-allow.ts`의 `GIT_READ_SHAPES`)과 기대값(`REPO_INFO_GIT`)이 빠른 경로의 인자를 정확히 못박아, 끝에 더한 `--`가 허용 목록 밖으로 보였다. 두 파일이 계획 범위(관련 파일, AC의 `scripts` 파일 목록) 밖이라 계획을 고친다. 절차서 2절에 따라 코드 커밋을 되돌리는 커밋으로 PR의 변경을 계획만 남기고(코드는 push하지 않았다) 계획 검증을 다시 받는다. 고친 것: 관련 파일·범위·수용 기준 6, step0 작업 2와 AC(테스트 실행에 `metrics-command.test.ts`, 허용 목록 grep, `scripts` 파일 목록 넷), 금지사항(옛 꼴을 남기거나 다른 꼴을 넓히지 않는다).
- 2026-11-26 계획 검증 3회차(head `7c345d9`): 두 검증자 수정 요청(P1 하나씩, 같은 지적). 받아들였다. 허용 목록 AC의 `grep -qF`가 한 줄 문자열을 찾는데 `metrics-allow.ts`의 `rev-parse` 꼴은 인자를 줄마다 적어 올바른 구현에서도 실패한다 → `GIT_READ_SHAPES`를 불러 `rev-parse` 꼴이 하나이고 인자 배열이 새 배열과 같은지 보는 `node -e` 한 줄로 바꿨다(옛 배열은 거부). 지금 파일(옛 꼴)에서 1, 끝에 `'--'`를 더한 파일에서 0인 것을 확인했다.

## 의사결정 로그

- 결정: 인자 끝에 `--`를 붙여 `HEAD`를 리비전으로만 읽게 한다. / 이유: git 실행 횟수(한 번)를 그대로 두면서 모호한 경우를 예전 경로로 돌린다. / 버린 대안: `--verify`를 쓴다(경로 셋을 함께 묻는 꼴에서 동작을 따로 확인해야 한다), 넷째 줄이 `HEAD`이고 그 이름의 파일이 있으면 예전 경로로 간다(파일 검사가 하나 늘고 detached HEAD의 `HEAD`와 가르기가 번거롭다).
- 결정: 지표 허용 목록의 `rev-parse` 꼴을 새 인자로 바꾸고 옛 꼴은 지운다. / 이유: 허용 목록은 지표 명령이 띄우는 프로세스를 정확히 못박는 검사이고, 지표는 커밋이 있는 리포에서 돌아 빠른 경로만 탄다(그 위 주석). / 버린 대안: 옛 꼴을 함께 남긴다(쓰지 않는 꼴로 목록이 넓어진다).
- 결정: risk는 high다. / 이유: 운영 단계에서 `scripts/`는 보호 경로라 위험도 높음이다(절차서 5절).

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 `node scripts/harness.ts check`.

## 다음 할 일

1. 고친 계획으로 계획 검증(G1)을 다시 받는다.
2. 승인 뒤 되돌린 코드를 다시 올리고 허용 목록·기대값을 맞춘다.
