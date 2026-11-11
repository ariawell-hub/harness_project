---
id: 20261111-windows-native
issue: 7 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-11T17:57:33+09:00 # new-task가 채운다
---

# feat: Windows 네이티브 작업 지원 (설계서·실행 셸·L1 훅)

## 목표와 수용 기준

제작자 결정(대화, 2026-11-11): Mac과 Windows를 함께 쓰고, Windows에서는 **Windows 네이티브**로 작업한다(WSL2 아님). 설계서 점검에서 나온 문제 가운데 작업에 치명적이거나 Mac에 고정된 것만 고친다.

- 설계서·ADR이 지원 OS(macOS, Windows 네이티브)와 Windows 전제 조건(Git for Windows 필수)을 명시한다. E5·R20·runner 운영·실패 기록·0단계 완료 기준·부록 C의 "Mac" 전제를 "에이전트가 실행되는 모든 머신"으로 바꾼다.
- 텍스트 파일을 LF로 고정한다(`.gitattributes`). Windows Git 기본값(`core.autocrlf=true`)에서도 `fmt --check`, patch-id, 캐시 키가 OS와 무관하다.
- Windows에서 `runShell`(step AC, 프로파일 표준 명령)이 Git Bash로 실행된다. Git Bash를 찾지 못하면 이유를 알리고 실행하지 않는다. WSL `bash.exe`는 쓰지 않는다.
- 개발용 `.env` 연결이 심볼릭 링크 실패 시 하드 링크로 대체된다.
- Windows에서 runner가 에이전트 CLI를 셸 없이 실행할 수 있는지(`.exe`) 시작할 때 확인하고, npm 설치본(`.cmd`)뿐이면 이유를 알리고 시작하지 않는다.
- L1 훅이 Claude Code `PowerShell` 도구와 `powershell -Command`·`pwsh -c`·`-EncodedCommand`·`cmd /c` 안의 명령을 해석하고, 명령 이름을 대소문자·`.exe`와 무관하게 비교한다.
- L1 훅이 Windows의 재귀 삭제(`Remove-Item -Recurse`, `rd /s` 등, R14), 자격 증명 저장소 조회와 토큰 환경 변수 변경(R20)을 차단한다.
- 작업자 이름이 머신마다 고유해야 한다는 규칙을 문서에 둔다.
- 모든 동작 변경에 테스트가 있고 `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

- 범위: 설계서·ADR·절차서·README·SECURITY 문서, `.gitattributes`, `scripts/lib/exec.ts`, `scripts/commands/task.ts`, `scripts/hooks/`, `.claude/settings.json`, `.claude/runner-settings.json`, `harness.config.json`(보호 경로), 관련 테스트.
- 비범위: Windows 실기 검증과 Windows·macOS CI 러너 추가(이 Mac에서는 실측할 수 없다. TD-14·TD-15), L0 샌드박스(4단계), Windows 경로 길이·대소문자 파일 시스템 차이, Tier 0 로그 도구(`jq`), 작업자 이름 기본값 자동 변경.

## 관련 파일·문서

- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/CHANGELOG.md
- docs/decisions/ADR-0005-windows-native.md
- docs/decisions/index.md
- docs/exec-plans/tech-debt-tracker.md
- docs/SECURITY.md
- README.md
- .gitattributes
- harness.config.json
- scripts/lib/exec.ts
- scripts/commands/task.ts
- scripts/runner/agents.ts
- scripts/runner/run.ts
- scripts/hooks/shell.ts
- scripts/hooks/guard.ts
- scripts/hooks/rules.ts
- scripts/test/
- .claude/settings.json
- .claude/runner-settings.json

## step 목록

- step0 windows-design: 설계서·ADR-0005·절차서·README·SECURITY·TD를 Windows 네이티브 병행 기준으로 고친다
- step1 windows-runtime: `.gitattributes` LF 고정, Windows에서 Git Bash로 명령 실행, 에이전트 CLI 실행 파일 확인, `.env` 하드 링크 대체
- step2 guard-dialects: L1 훅이 PowerShell·cmd 방언과 Windows 셸 래퍼를 해석하고, 명령 이름을 대소문자·확장자와 무관하게 비교한다
- step3 guard-windows-rules: L1 훅에 Windows 재귀 삭제(R14), 자격 증명 저장소·토큰 변수(R20) 차단 규칙 추가

## 진행 로그

- 2026-11-11 18:00 계획 작성. Issue #7 선점(owner: session).
- 2026-11-11 18:40 step0 구현: ADR-0005, 설계서 v0.7.4, 절차서·README·SECURITY, TD-14~16, CHANGELOG. step1에 에이전트 CLI `.exe` 확인을 추가했다(발견 사항). step0 AC와 `check` 통과.
- 2026-11-11 18:20 step0 PR #8 병합. step1 시작.
- 2026-11-11 18:35 step1: 먼저 실패한 테스트 기록 — `node --test scripts/test/exec.test.ts scripts/test/task.test.ts` → `does not provide an export named 'findGitBash'`·`'linkFile'`로 2개 파일 실패. 구현 후 9개 통과. `git ls-files --eol`로 CRLF 파일이 없음을 확인하고 `.gitattributes`를 넣었다(다시 정규화할 파일 없음). runner는 시작할 때 에이전트 실행 파일을 확인하고 실패하면 `agent-missing`으로 멈춘다(종료 코드 1, 실패 횟수 미포함). step1 AC와 `check` 통과.
- 2026-11-11 18:50 step1 PR #9 병합. step2 시작.
- 2026-11-11 19:10 step2: 먼저 실패한 테스트 기록 — `node --test scripts/test/shell.test.ts scripts/test/guard.test.ts` → `commandName` export 없음과 PowerShell·래퍼·`normalize`·matcher 테스트 4개 실패. 구현 후 22개 통과. 실제 훅 프로세스에 PowerShell 도구 입력(`& "C:\…\git.exe" push --force`)을 넣어 종료 코드 2, 일상 명령은 0을 확인했다. step2 AC와 `check` 통과.
- 2026-11-11 19:20 step2 PR #10 병합. step3 시작.
- 2026-11-11 19:40 step3: 먼저 실패한 테스트 기록 — `node --test scripts/test/guard.test.ts` → Windows 차단 규칙(`Remove-Item -Recurse -Force ~` 통과)과 파일 도구 Windows 자격 증명 경로 테스트 2개 실패. 구현 후 24개 통과. 실제 훅 프로세스: PowerShell `$env:GH_TOKEN = "x"`는 종료 코드 2, `echo $env:GH_TOKEN`은 0. step3 AC와 `check` 통과. 계획 완료.

## 의사결정 로그

- 결정: Windows는 네이티브로 지원한다(WSL2 아님). 이유: 제작자 결정(대화 2026-11-11). 버린 대안: WSL2(POSIX 전제가 대부분 유지되지만 제작자가 네이티브를 택함).
- 결정: step AC와 프로파일 명령은 POSIX `sh` 문법 하나로 쓰고, Windows에서는 Git for Windows의 bash로 실행한다. 이유: AC가 이미 ```bash 블록이고, Mac에서 쓴 계획을 Windows runner가 그대로 판정해야 한다. Claude Code도 Windows에서 Git Bash를 쓴다. 버린 대안: cmd.exe 유지(Mac에서 쓴 AC가 깨진다), PowerShell 표준화(Mac·Linux CI와 문법이 갈린다), OS별 AC 두 벌(계획 검증 해시와 유지 비용이 두 배).
- 결정: L1 훅은 PowerShell·cmd 방언을 별도 토크나이저 모드로 해석하고, Claude Code `PowerShell` 도구는 PowerShell로, Windows의 그 밖의 셸 도구(Codex)는 POSIX와 PowerShell 두 방식으로 모두 판정해 하나라도 걸리면 막는다. 이유: Codex가 Windows에서 어떤 셸 형식을 넘기는지 실측 전이라 fail-closed로 둔다. 버린 대안: 완전한 PowerShell 파서(1단계 L1은 휴리스틱이라는 원칙과 맞지 않음).
- 결정: `.env` 연결은 심볼릭 링크 → 하드 링크 순으로 시도하고, 복사는 하지 않는다. 이유: 복사본은 키 교체 때 남는다. 하드 링크는 Windows에서 권한 없이 같은 볼륨이면 된다.
- 결정: Windows에서 에이전트 CLI가 `.cmd` 셸 래퍼뿐이면 runner를 시작하지 않고 `.exe` 설치·경로 지정을 안내한다. 이유: Node는 `.cmd`를 셸 없이 띄울 수 없고, cmd.exe를 거치면 프롬프트·JSON 인자 인용이 깨지기 쉽다. 버린 대안: cmd.exe로 감싸 실행(인용 규칙을 실측 없이 맞출 수 없음), npm 래퍼를 해석해 node로 직접 실행(래퍼 형식에 의존).

## 발견 사항

- step0: worktree 기준(`origin/main`)이 로컬 main보다 앞서 ADR-0004·TD-13이 이미 있었다. 새 번호는 ADR-0005, TD-14부터 → 처리: 해당 없음
- step0: npm으로 설치한 에이전트 CLI(`claude.cmd`, `codex.cmd`)는 Windows에서 셸 없이 `spawn`할 수 없어 runner가 세션을 띄우지 못한다 → 처리: [ADR-0005](../../../decisions/ADR-0005-windows-native.md) 결정에 반영, step1에서 구현
- step0: README 요구 사항의 `brew install gitleaks`가 Mac 전용이었다 → 처리: [README](../../../../README.md) 요구 사항에 Windows 설치 방법 추가
- step0: frontmatter `related_code` 배열이 한 줄 100자를 넘으면 Prettier가 여러 줄 YAML로 바꾸고, doc-lint가 이를 "배열이 아니다"로 거부한다 → 처리: TD-16
- step2: runner가 만드는 Claude 설정(`writeClaudeRunnerSettings`)에도 훅 matcher가 따로 하드코딩되어 있었다. step 지시서에 없던 파일이라 함께 고치고 테스트로 묶었다 → 처리: 해당 없음
- step2: `.env` 판정이 대소문자를 구분해 `cat .ENV`가 통과했다(macOS·Windows 파일 시스템은 같은 파일로 연다) → 처리: 해당 없음(이번 step에서 고치고 테스트 추가)
- step2: step1 PR(#9)이 보호 경로를 바꾸면서 `CHANGELOG.md` 줄을 빠뜨렸다 → 처리: [CHANGELOG](../../../harness/CHANGELOG.md)에 step1·step2 줄 추가
- step3: `git credential …` 하위 명령은 이미 막혀 있었지만 `git-credential-manager get`처럼 도우미 실행 파일을 직접 부르는 형태는 빠져 있었다(macOS의 `git-credential-osxkeychain`도 같다) → 처리: 해당 없음(이번 step에서 고치고 테스트 추가)
- step3: 자격증명 파일 판정이 대소문자를 구분해 `library/keychains/…`처럼 소문자로 적으면 통과했다 → 처리: 해당 없음(이번 step에서 대소문자 무시로 고침)
- step3: 대화 세션 경로에는 계획 완료 뒤 `claim/<issue>` 해제가 없다(runner만 해제한다). 이 계획의 `claim/7`도 병합 뒤 원격에 남는다 → 처리: #4

## 열린 질문

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- Windows 실기 검증은 이 Mac에서 할 수 없다. 테스트는 Windows 분기를 주입 가능한 함수(플랫폼·환경·파일 존재 여부)로 나눠 macOS에서 검증한다. 실기 확인은 TD-14.
- 결과: step0~3 AC와 `check` 모두 통과(PR #8, #9, #10, 이 PR). 새 테스트는 `exec.test.ts` 5개, `task.test.ts` 1개, `shell.test.ts` 4개, `guard.test.ts` 6개. 실제 훅 프로세스로 PowerShell 도구 입력의 차단(종료 코드 2)·허용(0)을 확인했다. Windows 실기는 미확인(TD-14).

## 다음 할 일

- 없음(계획 완료). Windows 머신에서 처음 작업하기 전에 TD-14 실측을 먼저 한다. CI OS 행렬은 TD-15.
