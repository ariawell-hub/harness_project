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
- runner 세션 기록(Issue #16 step3): 세션마다 원본 출력을 `<공유 git-dir>/harness/sessions/`에 남기고 `runner.jsonl`에 `session-end`(세션 id·턴·종료 이유·권한 거부 개수와 도구 이름·로그 경로)를 쓴다. 환경 장애로 끝난 세션도 기록한다. `harness.config.json`의 Claude 실행 인자에서 `--no-session-persistence`를 빼 세션 전체 기록이 남는다(보호 경로). Codex는 TD-20.
- CLI·차단 메시지(Issue #16 step4): `node scripts/harness.ts <명령> --help`(또는 `-h`)는 아무것도 실행하지 않고 도움말을 출력하고, `--` 앞의 모르는 `--옵션`은 실행 없이 종료 코드 2로 끝난다(TD-17 해결). 리포 밖(사용자 환경·다른 프로젝트) 파일 쓰기 차단 메시지를 "리포 밖 파일"로 바꾸고 사용자가 직접 실행할 `! <명령>` 안내를 준다.
- `start`가 fetch 뒤 main 체크아웃을 `origin/main`으로 fast-forward 하고 `harness.config.json`을 다시 읽는다(Issue #4). 못 당기면(다른 브랜치, 미커밋 변경, 로컬 전용 커밋, merge 실패) ② 정리 절에 이유를 출력하고 넘어간다. runner `syncMain`과 같은 함수(`lib/git.ts`의 `fastForwardMain`)를 쓴다. runner 실행 중 설정 재로드는 TD-21.
- 설계서 v0.7.8 · PR 갱신 방식(ADR-0006, Issue #22 step0): main에 뒤처지거나 충돌한 PR은 rebase가 아니라 `origin/main` 병합 + 일반 push로 갱신한다. R14(에이전트 force push 금지)는 유지. 절차서 5절에 세션 절차(이미 rebase했으면 `merge -s ours`, 막히면 `needs-human`)를 더했다. runner 구현은 step1, runner step 완료 push의 lease 폴백은 TD-22, 다른 작업자 worktree 인계는 TD-23.
- runner PR 갱신(ADR-0006, Issue #22 step1): `doRebase`(rebase + `--force-with-lease`)를 `doUpdate`로 바꿨다. `lib/git.ts`의 `updateBranchFromBase`가 `origin/main`을 병합하고 일반 push한다. 충돌하면 병합을 취소하고 계획을 `blocked` + `needs-human`으로, 원격 PR 브랜치에 로컬에 없는 커밋이 있거나 push가 거부되면 실패로 기록한다(반복되면 5회에 멈춤). GitHub은 갱신이 필요하다는데 브랜치가 이미 최신이면 환경 대기로 처리해 헛돌지 않는다. `pickNext`는 `BEHIND`뿐 아니라 `DIRTY`(충돌)도 갱신 대상으로 보고, 계획이 `blocked`인 PR은 다시 고르지 않는다. 작업 종류 `rebase` → `update`, 실패 키 `pr:rebase-conflict` → `pr:update`.
- Codex 설정(Issue #25, 보호 경로): `.codex/config.toml`에 `approvals_reviewer = "auto_review"`. 대화형 Codex 세션의 승인 요청을 사람 대신 Codex 자동 검토자가 판단한다(제작자 결정, ADR-0002). 샌드박스·L1 훅은 그대로이고 runner(`approval_policy="never"`)는 영향 없음. 실제 동작 확인은 TD-8. Codex용 new-task 스킬 `.agents/skills/new-task/SKILL.md`(`.claude` 쪽과 같은 내용) 추가.
- 설계서 v0.7.9 · runner force push 제거(Issue #27, TD-22 해결): step 완료 push가 거부되면 `--force-with-lease`로 덮어쓰지 않는다. 원격 브랜치에 로컬에 없는 커밋이 있으면(`lib/git.ts`의 `remoteBranchDiverged`) 계획을 `blocked` + `needs-human`으로 보고하고, 확인하지 못하면 환경 대기한다. 이제 runner 어디에도 force push가 없다(14.4절).
- 닫힌 Issue의 선점 해제(Issue #4 step1): `start`가 ② 정리 절에서 GitHub에서 닫힌 Issue의 `claim/<N>`을 원격에서 지운다(로컬 worktree가 없어도). 열린 Issue와 닫혔음을 확인 못 한 claim(조회 실패, 없는 번호)은 남기고 이유를 출력한다. `next`의 claim 목록 파싱을 `listRemoteClaims`로 공용화(정확히 `claim/<숫자>`만 센다).
- 설계서 v0.7.10 · runner 계획 작성 질문(Issue #33, TD-18 해결): 계획 작성 세션이 "열린 질문"에 `### 질문:`(절차서 7절 형식)을 남기면 runner가 계획을 `blocked`로 커밋·push하고 Issue에 `needs-human` + 제작자 멘션으로 질문 전문을 올린다. 올린 질문은 worktree 하네스 상태의 `questions.json`에 남겨 다시 올리지 않는다. 제작자 답을 받으면 계획을 `draft`로 되돌리고 답을 넣어 계획 작성 세션을 다시 띄운다. 계획 작성 프롬프트에 질문 형식 안내를 더했다. `lib/plan.ts`에 `openQuestions`. step 세션의 질문 감지는 TD-24.
- 설계서 v0.7.11 · `related_code` 작성 기준(Issue #39, TD-25 해결): 7.2절에 "문서의 내용이 기대는 파일만, 폴더 전체·계획 폴더는 넣지 않는다"를 적었다. ADR-0001 `[package.json, tsconfig.json]`, ADR-0005 `[lib/exec.ts, hooks/shell.ts, .gitattributes]`, ADR-0006 `[lib/git.ts]`, `workflow.md`는 `docs/exec-plans/` 대신 `docs/exec-plans/TEMPLATE*.md`. R8 검토 경고가 무관한 코드 변경·계획 파일 추가마다 반복되던 문제를 줄인다.

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
