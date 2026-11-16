# Step 2: mcp-guard

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 3, 의사결정 로그의 TD-13 결정 두 건)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-13, TD-8
- `docs/harness/design.md` 0.1절(E5), 5.1절 규칙 표(R14, R20), 13.1절(훅 구현 규칙), 13.2절(강제 계층), 14.4절
- `scripts/hooks/guard.ts`(`normalize`, `decide`, `buildContext`), `scripts/hooks/rules.ts`(`GuardInput`, `GuardContext`, `evaluate`), `scripts/test/guard.test.ts`
- `.claude/settings.json`(PreToolUse matcher), `scripts/lib/config.ts`(`guard`), `harness.config.json`, `profiles/`의 기본 설정
- #57 계획(`20261116-ops-transition`)의 step1(selftest-core)이 만든 파일(먼저 병합돼 있어야 한다): `scripts/selftest/run.ts`(`hook`), `scripts/selftest/scenarios/r20-owner-commands.ts`(시나리오 형식), `scripts/harness.ts`의 `self-test` 명령(`--only`. 이 step의 AC가 쓴다)

## 작업

1. 설정(`scripts/lib/config.ts`, `harness.config.json`, 프로파일 기본값)

   ```jsonc
   "guard": {
     "dbPatterns": [], "dbClients": [],
     "mcp": {
       // 도구 이름(서버 접두어 뒤)을 _ - 와 대소문자 경계로 나눈 단어에 이 중 하나가 있으면 삭제 계열로 막는다
       "denyWords": ["delete", "trash", "remove", "destroy", "purge", "erase", "wipe", "cancel"],
       // 전체 도구 이름 glob. 외부 발송(R14)
       "denyTools": ["mcp__*Gmail__send_message", "mcp__*Gmail__reply", "mcp__*Gmail__forward"],
       // 위 두 규칙의 예외(전체 도구 이름 glob)
       "allowTools": [],
       // 브라우저·데스크톱 자동화 도구(전체 도구 이름 glob). 입력에 denyHosts의 주소가 있으면 막는다(R20)
       "browserTools": ["mcp__claude-in-chrome__*", "mcp__playwright__*", "mcp__*Browser__*", "mcp__computer-use__*", "mcp__remote-devices__*"],
       "denyHosts": ["github.com", "*.github.com"]
     }
   }
   ```

   키가 없으면 위 기본값을 쓴다(옛 설정 파일과 호환). 형식이 틀리면 `ConfigError`다.

2. `scripts/hooks/guard.ts`·`rules.ts`
   - `normalize`: 도구 이름이 `mcp__`로 시작하면 `kind: 'mcp'`, `tool`(전체 이름), `input`(도구 입력 객체)을 담는다.
   - `evaluateMcp(input, ctx): Problem | null`
     1. `allowTools`에 맞으면 통과.
     2. `denyTools`에 맞으면 R14(외부 발송)로 막는다. 고치는 법: 초안까지만 만들고 발송은 제작자가 한다.
     3. 도구 이름의 단어에 `denyWords`가 있으면 R14(데이터 삭제)로 막는다. 단어 단위로 비교한다(`untrash`·`unlabel`은 `trash`·`label`과 다르다).
     4. `browserTools`에 맞는 도구는 입력의 모든 문자열 값(중첩 포함, 깊이·길이 상한)에서 URL과 호스트를 찾아 `denyHosts`에 맞으면 R20으로 막는다. 고치는 법: GitHub 작업은 봇 토큰의 `gh`로 한다.
     5. 그 밖은 통과.
   - 훅 프로세스가 입력을 해석하지 못한 `mcp__` 호출은 막는다(종료 코드 2). 그 밖의 기존 도구 판정은 바꾸지 않는다.

3. `.claude/settings.json`: PreToolUse matcher에 `mcp__.*`를 더한다. 그 밖의 키는 바꾸지 않는다. `.claude/runner-settings.json`은 바꾸지 않는다(runner는 `--strict-mcp-config`로 MCP가 없다).

4. 자체 테스트 시나리오(새 파일 `scripts/selftest/scenarios/mcp-guard.ts`): 훅에 MCP 도구 호출 JSON을 넣어 삭제 도구·메일 발송·브라우저의 GitHub 이동이 종료 코드 2이고, 검색·읽기·초안 작성·GitHub이 아닌 주소로의 이동이 0임을 확인한다.

5. 테스트(`scripts/test/guard.test.ts`에 더한다)
   - 막힘: `mcp__claude_ai_Gmail__trash_message`, `mcp__claude_ai_Google_Drive__trash_file`, `mcp__claude_ai_Notion__notion-delete-pages`, `mcp__claude_ai_Google_Calendar__delete_event`, `mcp__claude_ai_Gmail__send_message`, `mcp__claude-in-chrome__navigate`(`url`이 `https://github.com/…`), `mcp__playwright__browser_navigate`(GitHub 주소), `mcp__claude-in-chrome__javascript_tool`(코드 문자열에 `https://api.github.com/…`).
   - 통과: `…Gmail__search_threads`, `…Gmail__create_draft`, `…Gmail__untrash_message`, `…Google_Drive__read_file_content`, `…Notion__notion-create-pages`(본문에 GitHub 링크가 있어도 통과. 브라우저 도구가 아니다), `mcp__claude-in-chrome__navigate`(다른 사이트), `mcp__claude-in-chrome__computer`(스크린샷).
   - 설정: `allowTools`로 예외, `denyWords`를 비우면 삭제 도구 통과, 키가 없는 옛 설정에서 기본값.
   - 종료 코드: `decide`가 막을 때 훅 프로세스가 2로 끝난다(기존 테스트와 같은 방식).

6. 문서
   - 설계서: 5.1절 R14·R20 행의 장치에 MCP 규칙, 13.1절에 "MCP 도구도 훅을 거친다"와 규칙, 13.2절·0.1절 E5에 남는 위험(브라우저 안의 클릭으로 GitHub에 닿는 경로와 이름이 규칙에 걸리지 않는 새 MCP 도구는 훅이 막지 못한다. 에이전트가 조작하는 브라우저 프로필에 제작자 GitHub 로그인을 두지 않는다), 10.4절 운영 전환 체크리스트 3번 뒤에 그 확인을 한 줄 더한다.
   - `docs/SECURITY.md`: "에이전트용 브라우저 프로필(제작자)" 절(Claude 확장을 설치한 Chrome 프로필에서 GitHub 로그아웃, 확인 방법), 강제 장치 요약 표.
   - `CLAUDE.md`의 훅 항목에 MCP 한 줄. `tech-debt-tracker.md`의 TD-13을 결과에 맞게 고친다(훅 규칙은 해결, 남는 위험은 E5와 Codex 훅 TD-8). `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

7. 이 step의 PR은 `.claude/settings.json`의 `hooks`와 `harness.config.json`의 `guard`를 바꿔 `harness-guard` 신호(위험도 높음)가 된다. 초안으로 올리고 절차서 5절 "승인 요청 전 조건"대로 `pr-ready`로 제작자 승인을 요청한다.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts scripts/test/selftest.test.ts scripts/test/lib.test.ts
node scripts/harness.ts self-test --only mcp-guard,r20-owner-commands
grep -q "mcp__" .claude/settings.json
grep -q "export function evaluateMcp" scripts/hooks/rules.ts
```

## 금지사항

- MCP 도구를 기본으로 막고 허용 목록만 여는 방식으로 만들지 마라. 이유: 제작자 결정(2026-11-16)은 삭제를 뺀 적극 활용이다. 막는 것은 삭제 계열, 메일 발송, 브라우저의 GitHub 접근뿐이다.
- 삭제 단어를 부분 문자열로 비교하지 마라. 이유: `untrash`(복구)가 `trash`에 걸린다. 단어 단위로 나눠 비교한다.
- 브라우저 도구가 아닌 MCP 도구의 입력에서 GitHub 주소를 찾아 막지 마라. 이유: 문서·메일 본문에 GitHub 링크를 쓰는 정상 작업이 막힌다.
- `.claude/settings.json`의 `permissions`·`disableBypassPermissionsMode`·다른 훅을 바꾸지 마라. 이유: 이 step의 변경은 matcher 한 곳이다. 그 밖의 변경은 완화 신호가 된다.
- 훅이 해석하지 못한 MCP 호출을 통과시키지 마라. 이유: 13.1절. 판단하지 못하면 막는다.
