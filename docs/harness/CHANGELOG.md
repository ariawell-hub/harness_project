---
status: active
related_code: [scripts/, .claude/, .codex/, .github/, harness.config.json]
review_cycle: on-change
---

# 하네스 변경 이력

보호 경로(10.4절)를 바꾸는 PR은 여기에 한 줄을 남긴다.

## 다음 버전 (미배포)

- 설계서 v0.7.3: main의 "Require approval of the most recent reviewable push"를 구축·운영 단계 모두 끈다(0.2절). Q20 시험 리포 운영 방식(ADR-0004). 대화 세션 MCP 도구가 L1 훅 밖인 문제를 TD-13으로 등록.
- 설계서 v0.7.4: macOS와 Windows 네이티브 병행(ADR-0005). E5·R20을 에이전트가 실행되는 모든 머신 기준으로, AC·표준 명령은 POSIX `sh` 문법(Windows는 Git Bash), 텍스트 파일 LF 고정, L1 훅의 PowerShell·cmd 방언, 작업자 이름의 머신 간 고유성. Windows 실기 검증은 TD-14, CI OS 행렬은 TD-15.
- Windows 실행 환경(ADR-0005, PR #9): `.gitattributes` LF 고정(보호 경로), `runShell`이 Windows에서 Git Bash로 실행(없으면 cmd.exe로 대신하지 않고 실패, WSL bash 거부), runner가 시작할 때 에이전트 CLI 실행 파일을 확인(`.cmd` 래퍼뿐이면 `agent-missing`), 개발용 `.env`는 심볼릭 링크 → 하드 링크.
- L1 훅 셸 방언(ADR-0005): PowerShell·cmd 토큰화, `powershell -Command`·`pwsh -c`·`-EncodedCommand`·`cmd /c`·`iex` 재귀, 명령 이름 대소문자·확장자 무시, `.ENV`도 `.env`로 판정. Claude Code `PowerShell` 도구를 훅 matcher에 넣고(대화·runner), runner 권한 프로필은 `PowerShell` 도구를 거부한다.
- L1 Windows 차단 규칙(ADR-0005): R14 재귀 삭제에 `Remove-Item -Recurse`(별칭 포함)·cmd `rd`·`rmdir`·`del /s`, 대상 없는 PowerShell 재귀 삭제(파이프 입력) 차단, `$env:USERPROFILE`·`%USERPROFILE%`를 홈으로 해석. R20에 `cmdkey`·`vaultcmd`·`Get-StoredCredential`·`git-credential-*`, `PasswordVault`·`CredRead` 등 API, `%APPDATA%\GitHub CLI\hosts.yml`·`Microsoft\Credentials·Protect·Vault`, `$env:GH_TOKEN=`·`Remove-Item Env:GH_TOKEN`·`SetEnvironmentVariable`·`set`·`setx`(이름 대소문자 무시). 자격증명 파일 판정은 대소문자 무시. `Read(~/AppData/Roaming/GitHub CLI/**)` 거부.
- 설계서 v0.7.5: runner의 새 Issue 후보(4.5절 우선순위 5번)를 제작자(`github.owner`)·외주 개발자(새 설정 `github.collaborators`) 계정이 만든 Issue로 한정. 봇·그 밖의 계정·작성자 불명 Issue는 제외하고 `start`·`next`에 번호와 이유를 보인다. `github.owner`가 비면 새 Issue를 고르지 않는다(fail-closed). Issue 작성 뒤 수정 미확인은 TD-19(Issue #5).
- 설계서 v0.7.6 · L1 R3 판정(Issue #16 step0): 쓰기 대상을 그 파일이 속한 worktree 기준으로 판정한다. main 체크아웃의 대화 세션은 자기 소유(계획 `owner` = `HARNESS_WORKER`, 없으면 `session`) 작업 worktree를 `EnterWorktree` 없이 고칠 수 있다. 다른 작업자의 worktree, 소유자를 알 수 없는 worktree, worktree 간 수정, main 체크아웃 수정은 막는다(임시 폴더 안이어도 같은 리포면 막는다).
- 병합 worktree 정리(Issue #16 step1): `cleanupMerged`(`start`·runner)가 호출한 프로세스의 현재 폴더가 들어 있는 worktree는 지우지 않고 "남김"과 이유를 출력한다(경로는 `realpath`로 비교).
- 설계서 v0.7.7 · 질문 규칙(Issue #16 step2): 제작자가 대화로 직접 지시한 일은 봇이 Issue를 등록하고 묻지 않고 시작한다(절차서 1절의 "Issue가 없으면 만들지 말고 묻는다" 삭제). 추천안이 분명한 운영 판단은 묻지 않고 기록, 질문은 작업 시작 때 모음, 대화 결정은 즉시 리포에 기록(절차서 7절, 설계서 9.1절, AGENTS.md).

## 0.1.0 — 2026-11-11 (로드맵 1단계 최소 구성)

- 설계서 v0.7.1을 `docs/harness/design.md`로 이관(Q8). 참조 자료·검토 의견은 `docs/harness/background/`로, 기존 Next.js 문서 3개는 `profiles/web/templates/`로 이동.
- 스크립트 언어 결정: TypeScript + Node 22 빌드 없이 실행(ADR-0001, Q3).
- `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `docs/` 구조, 작업 절차서, 계획·step 템플릿.
- 표준 명령(시간 제한·프로세스 그룹 정리), `check`(캐시, doc-lint, bypass-scan, secret-scan).
- `new-task`(claim 브랜치 선점, step별 브랜치·worktree), `complete-step`, `claim-heartbeat`, `start`, `next`.
- L1 금지 훅(R1~R4, R10, R13, R14, R20): Claude Code·Codex 공통 `scripts/hooks/guard.ts`.
- 무인 권한 프로필(`.claude/runner-settings.json`), runner 최소형(작업자 1개, step 실행·AC 판정·재시도·세션 시간 제한, 3회/5회·총량 상한).
- CI: `check`(pull_request), `plan-gate`(pull_request_target, main 정의만 실행).
- 프로파일: `core`(이 템플릿 자신), `web`(초안), `game`(README 초안).
- R3 부트스트랩 예외: 커밋이 하나도 없는 리포에서만 main 체크아웃 수정을 허용한다. `git worktree add`에는 기준 커밋이 필요해서 첫 커밋 전에는 `new-task`를 쓸 수 없기 때문이다. 첫 커밋 뒤에는 이 예외가 적용되지 않는다.
- 검증: 이 템플릿을 만든 Claude Code 세션 자신이 훅에 막혔다(R3 main 체크아웃 수정, R14 변수 경로 재귀 삭제, R2 main push). 실제 `claude -p` 세션에서 권한이 `Bash(gh:*)`로 열린 상태에서도 `gh pr review --approve`가 R20으로 차단됨을 확인했다.
- 스모크 테스트(실제 `claude -p`, sonnet, 로컬 bare 원격 + 가짜 GitHub): runner가 Issue 하나를 선점 → 계획(step 2개) → step0 PR 병합 → step1 PR 병합(`Closes`) → Issue 종료 → claim 해제 → worktree 정리까지 사람 개입 없이 약 1분 30초에 마쳤다. 새 세션이 `AGENTS.md`만 읽고 `start`와 같은 다음 Issue를 골랐다(S1).
- 1단계에서 미룬 항목은 `docs/exec-plans/tech-debt-tracker.md` TD-1~TD-12.
