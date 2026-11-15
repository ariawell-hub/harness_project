# Step 3: session-hooks

## 읽어야 할 파일

- `.claude/settings.json`, `.claude/runner-settings.json`, `CLAUDE.md`
- `scripts/commands/start.ts` (`start`), `scripts/runner/next.ts`, `scripts/runner/agents.ts`(runner가 세션을 띄우는 방식과 환경 변수)
- `scripts/lib/github.ts` (`GitHubPort`, `PullRequest`)
- `docs/harness/design.md` 13.1절, 이 계획의 의사결정 로그(fail-open, `startup`에서만, runner 세션 제외)
- Claude Code 훅 문서의 SessionStart·Stop 입력·출력 형식(구현 전에 현재 형식을 확인한다)

## 작업

1. 진입점 `scripts/hooks/session.ts`를 만든다. stdin으로 훅 JSON을 받고 `hook_event_name`으로 나눈다.
   - **SessionStart**: `source`가 `startup`일 때만 `start`를 실행하고 그 출력을 세션 문맥으로 내보낸다. 재개·압축·`/clear`에서는 아무것도 하지 않는다.
   - **Stop**: 현재 작업자의 열린 PR을 조회해 대기 상태를 한 줄씩 만든다(승인 대기, main과 충돌, main에 뒤처짐, 체크 실패, 체크 진행 중). 사용자에게 보이는 메시지로 내보낸다. 종료를 막지 않는다(차단 결정이나 종료 코드 2를 쓰지 않는다). 열린 PR이 없으면 아무것도 내보내지 않는다.
   - runner가 띄운 세션이면 두 이벤트 모두 아무것도 하지 않는다. runner 세션을 구분할 방법이 없으면 runner가 세션을 띄울 때 환경 변수를 주도록 한다.
   - 어떤 오류(네트워크, gh 없음, 시간 초과, 잘못된 입력)에도 종료 코드 0으로 끝나고 세션을 막지 않는다.
   - 상태 판정과 메시지 작성은 순수 함수로 빼서 테스트한다.
2. `.claude/settings.json`의 `hooks`에 `SessionStart`와 `Stop`을 더한다. 시간 제한을 둔다. 기존 `PreToolUse` 항목과 `permissions`는 바꾸지 않는다.
3. 테스트를 먼저 쓴다(`scripts/test/session-hook.test.ts`): 이벤트별 출력, `startup`이 아닌 `source`, runner 세션, 오류 때 종료 코드 0, PR 상태별 문구, 그리고 `.claude/settings.json`의 `PreToolUse` 항목·`permissions`가 그대로라는 불변식.
4. `AGENTS.md`의 "세션 시작 절차"와 `CLAUDE.md`에 훅이 `start`를 실행한다는 것과, 결과가 보이지 않으면 직접 실행한다는 것을 적는다. 설계서 13.1절, `docs/harness/architecture.md`, CHANGELOG를 맞춘다.

## Acceptance Criteria

```bash
node --test scripts/test/session-hook.test.ts scripts/test/guard.test.ts
```

## 금지사항

- `PreToolUse` 훅과 `permissions`(deny 목록), `disableBypassPermissionsMode`를 바꾸지 마라. 이유: 권한·검사를 약화하지 않는다는 제작자 조건.
- Stop 훅이 종료를 막게 하지 마라. 이유: 무한 반복 위험(의사결정 로그).
- 세션 훅 출력에 토큰·환경 변수 값을 넣지 마라. 이유: 세션 기록에 남는다(R10).
- `guard.ts`의 fail-closed를 바꾸지 마라. 이유: R20은 L1에 기대고 있다.
