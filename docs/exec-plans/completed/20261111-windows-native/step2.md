# Step 2: guard-dialects

## 읽어야 할 파일

- `docs/decisions/ADR-0005-windows-native.md`
- `docs/harness/design.md` 13.1절 훅 구현 규칙(셸 방언)
- `scripts/hooks/shell.ts` (`tokenize`, `normalize`, `parseShell`, `baseName`)
- `scripts/hooks/guard.ts` (`normalize`, `argvToScript`)
- `scripts/hooks/rules.ts` (`evaluate`, `evaluateBash`, `GuardInput`, `baseName` 호출부)
- `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`
- `.claude/settings.json`, `.claude/runner-settings.json`

## 작업

1. `scripts/hooks/shell.ts`
   - `export type Dialect = 'posix' | 'powershell' | 'cmd'`. `parseShell(src, dialect = 'posix')`.
   - 토크나이저 방언 차이: 이스케이프 문자(POSIX `\`, PowerShell 백틱, cmd `^`), PowerShell·cmd에서 `\`는 문자 그대로, 백틱 명령 치환은 POSIX만, `$(...)`는 POSIX·PowerShell, 작은따옴표는 cmd에서 일반 문자, heredoc은 POSIX만, `#` 주석은 POSIX·PowerShell, PowerShell 블록 주석 `<# … #>` 건너뛰기.
   - `commandName(argv0)`: 경로 마지막 부분을 소문자로 바꾸고 `.exe`·`.cmd`·`.bat`·`.com`을 뗀다. 명령 이름 판정(래퍼, `unset`, `export`, 셸 재귀)에 쓴다.
   - 재귀: `powershell`·`pwsh`의 `-Command`(접두 약어 포함, `-c`)는 나머지 인자를 PowerShell로, `-EncodedCommand`(`-e`, `-ec`, `-enc…`)는 base64(UTF-16LE)를 풀어 PowerShell로, 옵션 없이 온 첫 인자부터는 PowerShell 명령으로 해석한다(값을 받는 옵션 `-ExecutionPolicy` 등은 건너뛰고, `-File`이면 멈춘다). `cmd`의 `/c`·`/k`는 나머지를 cmd로. PowerShell의 `iex`·`Invoke-Expression`은 `eval`처럼 PowerShell로.
2. `scripts/hooks/rules.ts`
   - `GuardInput`에 `dialects?: Dialect[]`(기본 `['posix']`). `evaluate`는 방언마다 `evaluateBash`를 돌려 처음 걸린 문제를 돌려준다.
   - 명령 머리 비교(`rm`, `git`, `gh`, `security`, 외부 작용, DB 클라이언트)를 `baseName` 대신 `commandName`으로 한다. `git.exe push --force`, `GIT push --force`도 걸려야 한다.
3. `scripts/hooks/guard.ts`
   - `normalize(payload, platform = process.platform)`: 도구 이름 `PowerShell`이면 `['powershell']`, `Bash`면 `['posix']`, Windows에서 그 밖의 셸 도구(Codex 등)면 `['posix', 'powershell']`.
   - `argvToScript`의 셸 판정도 `commandName`을 쓴다.
4. `.claude/settings.json` 훅 matcher에 `PowerShell`을 넣는다. `.claude/runner-settings.json`의 `deny`에 `PowerShell`을 넣는다(runner는 Windows에서도 Bash 도구 = Git Bash만 쓴다).
5. 테스트
   - `shell.test.ts`: 방언별 토큰화(PowerShell 백틱 이스케이프와 `C:\path` 보존, cmd `^`와 `&`), `powershell -Command`·`pwsh -c`·`-EncodedCommand`·`cmd /c`·`iex` 재귀, `commandName`.
   - `guard.test.ts`: PowerShell 도구 입력으로 `git push --force`·`gh pr review --approve`가 차단되고 일상 명령이 허용된다. `powershell -Command "gh pr review 1 --approve"`, `cmd /c "git push -f origin x"`, 인코딩한 명령, `git.exe push --force origin x`가 차단된다. `normalize`가 도구·플랫폼별로 방언을 고른다.

## Acceptance Criteria

```bash
node --test scripts/test/shell.test.ts scripts/test/guard.test.ts
grep -q "PowerShell" .claude/settings.json
node scripts/harness.ts check
```

## 금지사항

- 기존 POSIX 해석 결과를 바꾸지 마라. 이유: 기존 BLOCK·ALLOW 표가 그대로 통과해야 한다.
- 해석할 수 없는 PowerShell 구문을 허용 쪽으로 처리하지 마라. 이유: R20은 L1에 기댄다(13.2절). 모르면 두 방언 모두로 판정한다.
- Windows 전용 차단 규칙(재귀 삭제, 자격 증명 저장소, 토큰 변수)을 여기서 넣지 마라. 이유: step3의 범위다.
