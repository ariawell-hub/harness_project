---
status: active
related_code: [scripts/lib/exec.ts, scripts/hooks/, scripts/runner/, scripts/commands/task.ts]
review_cycle: on-change
---

# ADR-0005: macOS와 Windows 네이티브를 함께 쓴다

- 날짜: 2026-11-11
- 상태: 채택 (제작자 대화 결정). Windows 실기 검증은 TD-14
- 관련: 설계서 0절 지원 범위, E5, 4.5절, 6절, 13.1~13.2절, 14.2절, Q4, R14, R20, [ADR-0001](ADR-0001-script-language.md), [ADR-0002](ADR-0002-codex-hooks-sandbox.md)

## 맥락

- 설계서는 Windows를 스크립트 언어 선택(ADR-0001)에서만 고려했고, 운영·보안 규칙은 "에이전트가 실행되는 Mac" 하나를 전제했다.
- 제작자는 Mac과 Windows를 함께 쓰고, Windows에서는 **WSL이 아니라 Windows 네이티브**로 작업하기로 했다(대화, 2026-11-11). 게임 개발(Q1)은 Windows에서 할 가능성이 크다.
- 그대로 두면 Windows에서 다음이 깨진다.
  - step AC는 ```bash 블록인데 runner가 `cmd.exe`로 실행한다.
  - Windows Git 기본값(`core.autocrlf=true`)으로 받으면 작업 트리가 CRLF가 되어 Prettier(LF) `fmt --check`가 전부 실패하고, patch-id 결속(10.3절)과 캐시 키가 OS마다 달라진다.
  - L1 훅이 POSIX 셸 문법만 해석해 PowerShell·cmd 명령(`Remove-Item -Recurse`, `rd /s`, `$env:GH_TOKEN=…`)을 못 막는다. Claude Code는 Git Bash가 없으면 `PowerShell` 도구를 쓰는데 훅 matcher에 이 도구가 없다.
  - R20의 자격증명 차단이 macOS 키체인만 다룬다.
  - npm으로 설치한 에이전트 CLI(`claude.cmd`, `codex.cmd`)는 셸 없이 실행할 수 없다.
  - 개발용 `.env` 심볼릭 링크는 개발자 모드·관리자 권한 없이 실패한다.
  - 여러 머신이 같은 작업자 이름(`runner-1`, `session`)을 쓰면 서로의 계획을 자기 것으로 본다.

## 결정

- **지원 OS**: 에이전트가 실행되는 머신은 macOS와 Windows 네이티브다. CI 러너는 Linux다.
- **Windows 전제 조건**: Git for Windows(Git Bash 포함), Node 22.18 이상. 에이전트 CLI는 셸 없이 실행할 수 있는 네이티브 실행 파일(`.exe`)로 설치하거나 `harness.config.json`의 `agents.<도구>.cmd`에 `.exe` 경로를 적는다.
- **명령 문자열의 셸**: step AC와 프로파일 표준 명령은 POSIX `sh` 문법 하나로 쓴다. macOS·Linux는 `/bin/sh`, Windows는 Git Bash로 실행한다. Git Bash를 찾지 못하면 실행하지 않는다(cmd.exe로 대신 실행하지 않는다). WSL의 `bash.exe`는 Windows 네이티브가 아니므로 쓰지 않는다.
- **줄바꿈**: 텍스트 파일은 LF로 고정한다(`.gitattributes`의 `* text=auto eol=lf`). `.gitattributes`는 보호 경로다.
- **L1 훅의 셸 방언**: 훅은 POSIX, PowerShell, cmd 방언을 해석한다. `powershell -Command`, `pwsh -c`, `-EncodedCommand`, `cmd /c` 안의 명령도 재귀로 본다. 명령 이름은 대소문자와 `.exe` 등 확장자를 무시하고 비교한다. Claude Code `PowerShell` 도구는 PowerShell로, Windows에서 그 밖의 셸 도구(Codex)는 형식을 실측하기 전이므로 POSIX와 PowerShell 두 방식으로 모두 판정해 하나라도 걸리면 막는다. runner의 Claude 세션은 Windows에서도 `Bash` 도구(Git Bash)만 쓴다.
- **자격증명 위생(E5·R20)**: "에이전트가 실행되는 Mac"을 "에이전트가 실행되는 모든 머신"으로 넓힌다. Windows에서는 `gh auth logout`에 더해 자격 증명 관리자의 `git:https://github.com` 항목(Git Credential Manager)에 제작자 토큰이 없어야 한다. L1은 OS 자격증명 저장소(macOS 키체인, Windows 자격 증명 관리자, git 자격증명 도우미) 조회와 토큰 환경 변수 변경(PowerShell `$env:`, cmd `set`·`setx` 포함)을 막는다.
- **작업자 이름**: runner `--worker`와 대화 세션 `HARNESS_WORKER`는 머신마다 고유하게 정한다(예: `mac-session`, `win-runner-1`).
- **개발용 `.env` 연결**: 심볼릭 링크 → 실패하면 하드 링크. 복사하지 않는다(키를 교체해도 복사본이 남는다).

## 버린 대안

| 대안                                      | 버린 이유                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| WSL2에서 작업                             | POSIX 전제가 대부분 유지되지만, 제작자가 Windows 네이티브를 택했다(게임 엔진·도구가 Windows 쪽) |
| AC를 cmd.exe로 실행(현행 유지)            | Mac에서 쓴 AC(`VAR=x cmd`, 작은따옴표, `\` 줄 잇기)가 다른 뜻이 되어 실패 횟수만 쌓인다         |
| PowerShell을 표준 셸로                    | macOS·Linux CI와 문법이 갈린다. Mac에서 PowerShell 설치를 강제하게 된다                         |
| OS별 AC 두 벌                             | 계획 검증 해시(10.3절)와 작성·검토 비용이 두 배가 되고, 두 벌이 어긋나도 알 수 없다             |
| 에이전트 CLI `.cmd`를 cmd.exe로 감싸 실행 | 프롬프트·JSON 인자의 인용 규칙을 실측 없이 맞출 수 없다                                         |

## 남은 위험과 확인 항목

- 이 결정을 만든 세션은 macOS에서만 검증했다. Windows 분기는 플랫폼·환경을 주입한 단위 테스트로만 확인했다. Windows 머신에서 처음 작업하기 전에 실측한다(TD-14): 훅이 실제로 실행되고 종료 코드 2로 막는지(`PowerShell` 도구 matcher, `$CLAUDE_PROJECT_DIR` 확장), runner가 Git Bash로 AC를 실행하는지, 하드 링크 대체, `.gitattributes` 아래 `fmt --check`.
- **Windows에서 훅 자체가 실행되지 못하면 막지 못한다.** 예를 들어 훅 명령의 셸이 `node`를 못 찾으면 종료 코드가 2가 아니라서 Claude Code는 경고만 하고 도구를 실행한다. 이 경우 R20은 E5로만 지켜진다.
- Codex의 Windows 훅 지원과 셸 도구 페이로드 형식은 확인 전이다(TD-8과 함께 확인).
- L0(샌드박스)의 Windows 지원은 4단계 전에 확인한다(Q4).
- CI는 Linux 러너만 쓴다. 하네스 스크립트의 Windows·macOS 회귀는 CI가 잡지 못한다(TD-15, 비용 Q16).
