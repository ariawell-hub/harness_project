# Step 1: windows-runtime

## 읽어야 할 파일

- `docs/decisions/ADR-0005-windows-native.md` (step0에서 만든 결정)
- `docs/harness/design.md` 6절(명령 문자열의 셸, 줄바꿈), 14.2절(`.env` 연결)
- `scripts/lib/exec.ts` (`run`, `runShell`, `runSync`)
- `scripts/commands/task.ts` (`linkDevEnv`)
- `scripts/commands/standard.ts`, `scripts/runner/run.ts` (`runShell` 호출부, runner 시작)
- `scripts/runner/agents.ts` (에이전트 CLI 실행)
- `scripts/test/task.test.ts`, `scripts/test/helpers.ts`
- `harness.config.json` (`protectedPaths`)

## 작업

1. 루트에 `.gitattributes`를 만든다: `* text=auto eol=lf`와 근거 주석(ADR-0005). 만들기 전에 `git ls-files --eol`로 CRLF 파일이 없는지 확인하고, 있으면 진행 로그에 적는다.
2. `harness.config.json`의 `protectedPaths`에 `.gitattributes`를 넣는다.
3. `scripts/lib/exec.ts`
   - `findGitBash(r: { env: NodeJS.ProcessEnv; exists: (p: string) => boolean; gitExecPath: () => string | null }): string | null`
     - 후보 순서: `HARNESS_BASH`, `CLAUDE_CODE_GIT_BASH_PATH`, `git --exec-path` 결과에서 세 단계 위의 `bin\bash.exe`·`usr\bin\bash.exe`, `%ProgramFiles%\Git\bin\bash.exe`, `%ProgramFiles(x86)%\Git\bin\bash.exe`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`.
     - 경로 계산은 `path.win32`로 한다(macOS에서 테스트할 수 있게).
     - `\Windows\System32\bash.exe`, `\Windows\Sysnative\bash.exe`, `\WindowsApps\` 아래 경로는 WSL이므로 환경 변수로 지정해도 버린다.
   - `shellOption(platform: NodeJS.Platform, resolve: () => string | null): true | string | null`: Windows가 아니면 `true`(`/bin/sh`), Windows면 Git Bash 경로, 못 찾으면 `null`.
   - `runShell`: `shellOption(process.platform, ...)`이 `null`이면 실행하지 않고 종료 코드 127과 "Git for Windows(bash)가 필요하다. 설치하거나 HARNESS_BASH로 bash.exe 경로를 지정하라. WSL bash는 쓰지 않는다"를 stderr로 돌려준다. 문자열이면 `spawn`의 `shell`에 그 경로를 넘긴다(`ExecOptions.shell`을 `boolean | string`으로). Git Bash 탐색 결과는 프로세스 안에서 한 번만 계산한다.
   - `resolveExecutable(cmd: string, r: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv; exists: (p: string) => boolean }): { path: string } | { error: string }`
     - Windows가 아니면 `cmd`를 그대로 돌려준다.
     - Windows면 `PATH`의 디렉터리 순서대로 `PATHEXT` 확장자를 붙여 찾는다(경로·확장자가 이미 있으면 그대로 판정). 처음 찾은 것이 `.exe`·`.com`이면 그 전체 경로, `.cmd`·`.bat`이면 오류("셸 없이 실행할 수 없다. 네이티브 설치본(.exe)을 쓰거나 harness.config.json agents.<도구>.cmd에 .exe 경로를 지정하라")를 돌려준다. 못 찾으면 `cmd`를 그대로 돌려준다(실행 시 ENOENT로 알린다).
4. `scripts/runner/agents.ts`·`scripts/runner/run.ts`: runner가 시작할 때 고른 도구(`claude`·`codex`)의 `cmd`를 `resolveExecutable`로 확인하고, 오류면 이유를 출력하고 runner를 시작하지 않는다(실패 횟수에 넣지 않는다). 세션은 확인된 경로로 띄운다.
5. `scripts/commands/task.ts`
   - `linkFile(src, dst, ops = { symlink: symlinkSync, hardlink: linkSync }): 'symlink' | 'hardlink' | null`를 export한다. 심볼릭 링크 → 실패하면 하드 링크 → 둘 다 실패하면 `null`. 복사하지 않는다.
   - `linkDevEnv`는 하드 링크로 대체했으면 그 사실을, 둘 다 실패하면 "Windows는 개발자 모드를 켜거나 worktree와 개발용 .env를 같은 드라이브에 두라"를 경고로 알린다.
6. 테스트(새 파일 `scripts/test/exec.test.ts`, 기존 `scripts/test/task.test.ts`)
   - `findGitBash`: 환경 변수 우선, `git --exec-path`에서 계산, 기본 설치 경로, WSL 경로 거부, 아무것도 없으면 `null`.
   - `shellOption`: darwin·linux → `true`, win32 + 찾음 → 경로, win32 + 못 찾음 → `null`.
   - `resolveExecutable`: darwin은 그대로, win32에서 `.exe` 발견 → 전체 경로, `.cmd`만 발견 → 오류, PATH 순서 우선, 못 찾음 → 그대로.
   - `linkFile`: 심볼릭 링크 성공, 심볼릭 링크 실패 시 하드 링크(같은 내용), 둘 다 실패 시 `null`.

## Acceptance Criteria

```bash
test -f .gitattributes
grep -q "eol=lf" .gitattributes
node --test scripts/test/exec.test.ts scripts/test/task.test.ts
node scripts/harness.ts check
```

## 금지사항

- macOS·Linux의 `runShell` 동작(`/bin/sh`)을 바꾸지 마라. 이유: 기존 AC와 CI가 그대로 돌아야 한다.
- Windows에서 Git Bash를 못 찾았을 때 cmd.exe로 대신 실행하지 마라. 이유: POSIX 문법 AC가 다른 뜻으로 실행되어 실패 횟수만 쌓인다(fail-closed).
- 개발용 `.env`를 worktree로 복사하지 마라. 이유: 키를 교체해도 복사본이 남는다(14.2절).
- 훅(`scripts/hooks/`)을 고치지 마라. 이유: step2·3의 범위다.
