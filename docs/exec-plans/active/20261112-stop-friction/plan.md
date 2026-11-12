---
id: 20261112-stop-friction
issue: 16 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T09:50:06+09:00 # new-task가 채운다
---

# fix: 세션이 멈추는 원인 제거 (worktree 판정·정리, 질문 규칙, runner 기록, CLI 도움말)

## 목표와 수용 기준

제작자 지시(대화, 2026-11-12): 지난 세션 기록 분석에서 나온 "AI 진행을 멈추게 하는 과정" 다섯 가지를 순서대로 고친다. Windows 지원 세션은 2시간 42분 중 약 126분(78%)이 승인·답변 대기였고, 그중 약 80분이 `EnterWorktree` 승인 대기였다.

- L1 훅이 쓰기 대상 파일이 속한 worktree 기준으로 R3·R1을 판정한다. main 체크아웃에 있는 대화 세션은 같은 리포의 **자기 소유**(계획 `owner`가 현재 작업자) 작업 worktree 파일을 `EnterWorktree` 없이 고칠 수 있다. 다른 작업자(runner 등)의 worktree, worktree 안의 세션이 다른 worktree를 고치는 것, main 체크아웃 수정은 계속 막는다.
- `start`(와 runner)의 병합 worktree 정리가 호출한 프로세스가 들어 있는 worktree를 지우지 않고, 남긴 이유를 출력한다.
- 절차서의 질문 규칙: 대화에서 제작자가 직접 지시한 일은 봇이 Issue를 등록하고 바로 진행한다. "반드시 묻는다" 밖의 판단은 추천안으로 진행하고 의사결정 로그에 남긴다. 질문은 작업 시작 때 모아서 한다.
- runner가 세션마다 원본 출력을 남기고, `session-end` 이벤트에 세션 id·권한 거부(`permission_denials`)·종료 이유를 기록한다. Claude 세션 기록이 남는다(`--no-session-persistence` 제거).
- `node scripts/harness.ts <명령> --help`는 실행하지 않고 도움말만 출력한다. 모르는 플래그는 실행 없이 오류로 끝난다(TD-17). 리포 밖 파일 수정 차단 메시지가 사용자 환경 파일임을 알리고 `! <명령>` 안내를 준다.
- 동작이 바뀌는 곳마다 테스트가 있고 `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

- 범위: `scripts/hooks/`, `scripts/runner/`, `scripts/harness.ts`, `scripts/test/`, `harness.config.json`(보호 경로), 절차서·설계서·AGENTS.md·architecture.md·CHANGELOG·TD.
- 비범위: 다른 대화 세션이 들어 있는 worktree 감지(프로세스 간 점유 정보가 없다. 1번으로 세션이 worktree에 들어갈 필요가 없어지므로 완화된다), runner 무인 권한 프로필의 허용 목록 확대(4번 기록이 쌓인 뒤 데이터로 정한다), Codex 세션 기록(`--ephemeral`), Bash 명령 안의 `cd`를 따라가는 R2 판정, Issue #4(claim 해제·main fast-forward)의 범위.

## 관련 파일·문서

- scripts/hooks/rules.ts
- scripts/hooks/guard.ts
- scripts/runner/run.ts
- scripts/runner/agents.ts
- scripts/harness.ts
- scripts/test/
- harness.config.json
- AGENTS.md
- docs/harness/workflow.md
- docs/harness/design.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/tech-debt-tracker.md

## step 목록

- step0 guard-own-worktree: L1 훅이 쓰기 대상 파일의 worktree 기준으로 판정하고, main 체크아웃의 대화 세션이 자기 소유 worktree를 고칠 수 있게 한다
- step1 keep-current-worktree: 병합 worktree 정리가 호출한 프로세스가 들어 있는 worktree를 남긴다
- step2 ask-rules: 절차서·AGENTS.md의 Issue 접수·질문 규칙을 고친다
- step3 runner-session-log: runner가 세션 원본 출력과 `session-end`(세션 id·권한 거부·종료 이유)를 남긴다
- step4 cli-help-messages: CLI `--help`·모르는 플래그 처리(TD-17), 리포 밖 파일 차단 메시지

## 진행 로그

- 2026-11-12 09:55 계획 작성. Issue #16 선점(owner: session). step0 수정 전이라 이 세션은 `EnterWorktree`로 s0 worktree에 들어가 작업한다.
- 2026-11-12 10:15 step0: 먼저 실패한 테스트 기록 — `node --test scripts/test/guard.test.ts` → `does not provide an export named 'buildContext'`로 실패. 구현 후 15개 통과(새 테스트 2개: 판정 표, 실제 훅 프로세스). 훅 프로세스로 main 체크아웃 `cwd` + 자기 worktree `Write`는 0, 임시 폴더 안의 worktree 간 `Write`는 2를 확인(수정 전에는 임시 폴더 허용 때문에 통과했다). step0 AC와 `check` 통과.
- 2026-11-12 10:14 step0 PR #17 병합. 이 세션은 `ExitWorktree`로 main 체크아웃에 돌아왔다.
- 2026-11-12 10:20 step1: **step0 실사용 확인** — main 체크아웃에 있는 세션이 `EnterWorktree` 없이 s1 worktree에 새 파일 `Write`·기존 파일 `Edit`를 했고 훅 차단도, Claude Code 승인 요청도 없었다. 먼저 실패한 테스트 기록 — `node --test scripts/test/cleanup.test.ts` → 세션이 있는 worktree가 지워져 `removed` 배열이 기대와 달라 실패. 구현 후 새 파일 2개 통과, `runner.test.ts` 2개 통과. step1 AC와 `check` 통과.
- 2026-11-12 10:19 step1 PR #18 병합. `start`가 s1 worktree를 정리했다(세션은 main에 있으므로 남김 없음).
- 2026-11-12 10:25 step2(문서만): 절차서 1절 접수 규칙(대화 지시는 봇이 Issue 등록 후 바로 시작), 7절(추천안이 분명한 운영 판단은 묻지 않음, 질문 시점, 대화 결정 즉시 기록), AGENTS.md, 설계서 v0.7.7(8.3절 접수, 9.1절). "반드시 묻는다" 목록과 runner의 봇 Issue 제외 규칙은 그대로 뒀다. step2 AC와 `check` 통과.

## 의사결정 로그

- 결정: 다섯 항목을 Issue 하나·계획 하나·step 다섯 개로 나누고 순서대로 병합한다. 이유: 제작자가 "순서대로" 지시했고, step0이 병합되면 step1부터 이 세션이 `EnterWorktree` 없이 작업해 수정을 직접 검증할 수 있다. 버린 대안: 항목마다 Issue(선점·계획 오버헤드가 다섯 배).
- 결정: R3 완화는 "세션이 main 체크아웃에 있고, 대상이 같은 리포(공유 git-dir)의 작업 worktree이고, 그 계획의 `owner`가 현재 작업자(`HARNESS_WORKER`, 없으면 `session`)"일 때만 허용한다. 이유: runner 세션은 항상 자기 worktree에서 시작하므로 영향이 없고, 대화 세션이 runner의 worktree를 건드리는 일은 계속 막는다. 버린 대안: 대상 파일 기준 판정만(다른 작업자 worktree도 열림), `EnterWorktree`·`ExitWorktree` 자동 허용(승인만 없앨 뿐 worktree 전환·삭제된 폴더 문제는 남음).
- 결정: 정리 보호는 `cleanupMerged` 안에서 `process.cwd()`가 그 worktree 안이면 건너뛰는 방식으로 하고 `start.ts`는 건드리지 않는다. 이유: 열린 PR #14(Issue #4)가 `start.ts` ② 절을 고치고 있어 충돌을 피한다.

## 발견 사항

- step0: 임시 폴더 허용(리포 밖이라도 임시 폴더면 허용)이 같은 리포의 다른 worktree에도 적용되어, 임시 폴더 안에 만든 리포에서는 worktree 간 수정이 막히지 않았다 → 처리: 해당 없음(이번 step에서 같은 리포 판정을 임시 폴더 허용보다 먼저 하도록 고치고 테스트 추가)

## 열린 질문

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- step0은 병합 뒤 이 세션이 main 체크아웃에서 step1 worktree 파일을 바로 고치는 것으로 실제 동작을 확인한다. Claude Code 자체가 작업 폴더 밖 쓰기에 승인을 요구하는지도 이때 확인한다.

## 다음 할 일

- step0 구현.
