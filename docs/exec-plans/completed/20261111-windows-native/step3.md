# Step 3: guard-windows-rules

## 읽어야 할 파일

- `docs/decisions/ADR-0005-windows-native.md`
- `docs/harness/design.md` 5.1절 R14·R20, 14.4절
- `scripts/hooks/rules.ts` (`rmRule`, `secretRules`, `isCredentialFile`, `expandHome`, `evaluateBash`)
- `scripts/hooks/shell.ts` (step2의 `Dialect`, `commandName`)
- `scripts/test/guard.test.ts`
- `.claude/settings.json`

## 작업

1. R14 Windows 재귀 삭제(`rmRule` 확장)
   - 대상 명령: `remove-item`, `ri`, `del`, `erase`, `rd`, `rmdir`, `rm`(PowerShell 별칭).
   - 재귀 판정: PowerShell `-Recurse`의 접두 약어(`-r`, `-rec`, …, 대소문자 무시), cmd `/s`. `rm`은 기존 POSIX 판정을 유지한다.
   - 대상 경로: `-`로 시작하는 옵션과(`rd`·`rmdir`·`del`·`erase`의) 한 글자 `/x` 옵션을 뺀 인자. PowerShell 재귀 삭제에 대상이 없으면(파이프로 받는 경우) 막는다.
   - `expandHome`이 `$env:USERPROFILE`, `${env:USERPROFILE}`, `%USERPROFILE%`, `$HOME`을 홈으로 바꾼다. 바꾼 뒤에도 `$`, 백틱, `%NAME%`이 남으면 "해석할 수 없는 변수"로 막는다.
2. R20 Windows 자격증명
   - 명령: `cmdkey`, `vaultcmd`, `get-storedcredential`은 막는다. `git credential-manager get`, `git-credential-manager get`, `git credential-wincred get`, `git-credential-wincred get`, `git credential-osxkeychain get`도 막는다(기존 `git credential fill` 차단 유지).
   - 원문 검사: `PasswordVault`, `CredRead`, `CredEnumerate`, `ProtectedData]::Unprotect`가 나오면 막는다.
   - 자격증명 파일: `AppData/Roaming/GitHub CLI/hosts.yml`(`$env:APPDATA`·`%APPDATA%` 형태 포함), `AppData/{Roaming,Local}/Microsoft/{Credentials,Protect,Vault}` 아래. Windows 경로는 대소문자를 무시한다.
3. R20 토큰 환경 변수 변경(Windows 형태, 이름은 대소문자 무시): `$env:GH_TOKEN = …`·`$env:GH_TOKEN=…`, `Remove-Item Env:GH_TOKEN`(`Set-Item`, `Clear-Item`, `New-Item`, 별칭 포함), `[Environment]::SetEnvironmentVariable('GH_TOKEN', …)`, cmd `set GH_TOKEN=…`, `setx GH_TOKEN …`. 읽기(`echo $env:GH_TOKEN`)는 막지 않는다.
4. `.claude/settings.json` `permissions.deny`에 `Read(~/AppData/Roaming/GitHub CLI/**)`를 넣는다.
5. 테스트(`guard.test.ts`): 위 항목마다 차단 사례, 그리고 worktree 안 재귀 삭제(`Remove-Item -Recurse -Force ./build`), `del file.txt`, `echo $env:GH_TOKEN`, `Get-Content README.md` 같은 일상 명령의 허용 사례. PowerShell 방언과 POSIX 방언 양쪽에서 확인한다.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts
grep -q "GitHub CLI" .claude/settings.json
node scripts/harness.ts check
```

## 금지사항

- 기존 규칙을 약하게 바꾸지 마라. 이유: R4(검사 약화 금지).
- worktree 안의 일상 삭제(`del file.txt`, `Remove-Item -Recurse ./build`)를 막지 마라. 이유: R14는 worktree 밖·루트·홈 삭제를 막는 규칙이다.
- 봇 토큰 읽기(`echo $env:GH_TOKEN`)를 막지 마라. 이유: 기존 POSIX 규칙도 변경만 막는다. 범위를 넓히는 것은 이번 범위 밖이다.
