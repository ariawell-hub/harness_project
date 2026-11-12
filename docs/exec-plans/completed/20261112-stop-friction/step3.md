# Step 3: runner-session-log

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-stop-friction/plan.md`
- `scripts/runner/agents.ts` (`SessionResult`, `runSession`)
- `scripts/runner/run.ts` (`event`, 계획 작성·step 실행에서 `runSession` 뒤 처리)
- `scripts/lib/git.ts` (`harnessStateDir`)
- `harness.config.json` (`agents.claude.args`)
- `scripts/test/runner.test.ts`, `scripts/test/fake-agent.ts`
- `docs/harness/architecture.md` (상태 위치 표)

## 작업

배경: runner는 `claude -p --output-format json --no-session-persistence`로 세션을 띄우고, 실패할 때만 출력 끝 몇 줄을 남긴다. 무인 세션이 왜 멈췄는지(특히 `dontAsk`가 조용히 거부한 도구)를 알 수 없다. Claude의 JSON 결과에는 `session_id`, `num_turns`, `terminal_reason`, `is_error`, `permission_denials`가 있다.

1. `scripts/runner/agents.ts`
   - `export interface SessionSummary { sessionId?: string; numTurns?: number; terminalReason?: string; isError?: boolean; result?: string; denials: { tool: string; input: string }[] }`
   - `export function parseSessionSummary(stdout: string): SessionSummary | null`: stdout에서 마지막 JSON 결과 객체(`type: "result"`)를 찾아 요약한다. `input`은 200자로 자른다. JSON이 아니면 `null`.
   - `SessionResult`에 `stdout: string`(원본, 자르지 않음)과 `summary: SessionSummary | null`을 더한다.
2. `scripts/runner/run.ts`
   - 세션이 끝나면(환경 장애로 돌아가기 전 포함, 계획 작성·step 실행 둘 다) 원본 출력을 `<공유 git-dir>/harness/sessions/<시각>-<계획 id>-<plan|s<N>>-<시도>.log`에 저장하고, `session-end` 이벤트를 남긴다: `{ plan, step, kind, code, timedOut, durationMs, sessionId, turns, terminalReason, denials: <개수>, deniedTools: <도구 이름 목록(중복 제거)>, log: <파일 경로> }`.
   - 권한 거부가 있으면 콘솔 출력에도 도구 이름을 보인다.
3. `harness.config.json`: `agents.claude.args`에서 `--no-session-persistence`를 뺀다(Claude Code가 `~/.claude/projects/` 아래에 세션 전체 기록을 남긴다. `sessionId`로 찾는다). 템플릿·프로파일에 같은 인자가 있으면 함께 고친다.
4. 테스트
   - `parseSessionSummary`: Claude 결과 JSON(권한 거부 2건, 같은 도구 중복), JSON 아닌 출력, 여러 줄 출력의 마지막 결과.
   - runner 통합(`fake-agent.ts`에 Claude 형식 결과 JSON을 출력하는 동작 추가): `runner.jsonl`에 `session-end`와 `deniedTools`가 있고 `sessions/` 아래 로그 파일이 생긴다.
5. 문서: `docs/harness/architecture.md` 상태 위치 표에 `sessions/` 줄, 세션 기록 찾는 법. `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄. Codex 세션 기록(`--ephemeral`)은 TD로 등록한다.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts
! grep -q "no-session-persistence" harness.config.json
node scripts/harness.ts check
```

## 금지사항

- 세션 출력을 리포 안(worktree 파일)에 쓰지 마라. 이유: 커밋에 섞이고 시크릿 스캔 대상이 된다. 공유 git-dir의 `harness/` 아래에 둔다.
- runner 무인 권한 프로필(`.claude/runner-settings.json`)의 허용 목록을 넓히지 마라. 이유: 이 step은 기록만 한다. 넓힐지는 쌓인 거부 기록을 보고 따로 정한다.
- 성공·실패 판정 로직(AC 실행, 실패 횟수)을 바꾸지 마라. 이유: 이 step의 범위가 아니다.
