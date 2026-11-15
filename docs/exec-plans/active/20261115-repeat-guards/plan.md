---
id: 20261115-repeat-guards
issue: 78 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-15T14:55:04+09:00 # new-task가 채운다
---

# feat: 반복 문제 방지 — 승인 요청·명령 작성 규칙과 L1·세션 훅

## 목표와 수용 기준

지난 세션 기록(22개)에서 반복된 문제를 규칙과 훅으로 막는다. 제작자 조건은 "보안과 검사에 해를 끼치지 않는 범위"다. 그래서 훅은 차단을 더하기만 하고, 기존 차단 규칙·권한 설정·게이트 판정은 바꾸지 않는다.

1. `AGENTS.md`와 절차서에 승인 요청 전 조건, 제작자 작업을 모아 요청하기, 위험도 high를 붙이는 범위, 추천안 진행, 대기 상태 보고, 명령 작성 규칙이 있다.
2. L1 훅이 `check`·`test` 출력을 파이프로 가리는 명령과, 검사 실패를 보지 않고 `complete-step`·push·PR 생성으로 이어지는 명령을 막는다(TD-29).
3. L1 훅이 승인을 요청한 PR 브랜치에 새 커밋을 push하는 것과, 조건을 확인하지 않은 초안 해제를 막는다.
4. Claude Code 세션이 시작할 때 `start` 결과가 세션에 들어오고, 멈출 때 열린 내 PR의 대기 상태가 사용자에게 보인다.
5. 새 규칙마다 차단·허용 테스트가 있고 `check`가 통과한다. 기존 guard 테스트는 고치지 않고 그대로 통과한다.

## 범위 / 비범위

- 범위: 문서 규칙, L1 훅 규칙 추가, `pr-ready` 명령, 세션 훅(SessionStart·Stop).
- 비범위: `risk-gate`·`harness-guard` 등 게이트 판정 변경, 권한 프로필(`permissions`) 변경, 기존 R1~R20 규칙 완화, runner의 PR 흐름 변경(#56), Codex 세션 훅.

## 관련 파일·문서

- `AGENTS.md`, `CLAUDE.md`, `docs/harness/workflow.md`, `docs/harness/design.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `scripts/hooks/`, `scripts/commands/`, `scripts/lib/`, `scripts/harness.ts`, `scripts/test/`
- `.claude/settings.json`

## step 목록

- step0 rules-doc: `AGENTS.md`·절차서에 반복 문제 방지 규칙을 적는다.
- step1 command-guard: 검사 출력 가림과 실패 뒤 진행을 L1 훅으로 막는다(TD-29).
- step2 approval-guard: `pr-ready` 명령과 승인 요청 뒤 push 차단.
- step3 session-hooks: 세션 시작 때 `start` 결과 주입, 멈출 때 대기 상태 알림.

## 진행 로그

- 2026-11-15 14:55 Issue #78 등록, 작업 공간 생성, 계획 작성.
- 2026-11-15 15:10 step0 완료: AGENTS.md·절차서 1·5·7절·CHANGELOG. AC 4개와 `check` 통과(문서 변경이라 먼저 실패한 테스트는 없다).

## 의사결정 로그

- 결정: 계획 위험도는 normal. / 이유: 차단을 더하는 변경이고 권한·게이트 판정을 바꾸지 않는다. 약화가 섞이면 `harness-guard`가 높음으로 올린다. 제작자 결정(2026-11-15, "검사 약화·권한 변경이 없는 수정에 한해 위험도 보통")과 맞는다. / 버린 대안: high(PR 4개마다 승인이 필요해, 줄이려는 문제를 되풀이한다).
- 결정: 위험도 문구는 기준(절차서 1절: 보안·인증·마이그레이션·데이터 스크립트)을 바꾸지 않고, "기준에 해당하는 작업에만 붙이고 애매하면 high"로 적는다. / 이유: 기준을 좁히면 사람 확인이 줄어 제작자 조건(검사에 해를 끼치지 않는다)에 어긋난다. / 버린 대안: "인증·시크릿·권한 프로필·워크플로 권한만 high"로 좁히는 문구.
- 결정: 승인 요청 뒤 push 차단은 네트워크 조회 없이 worktree의 표시 파일로 판정한다. 표시는 `pr-ready`가 남기고 `pr-ready --undo`가 지운다. `origin/main` 병합 커밋만 더한 push는 허용한다. / 이유: 훅은 빨라야 하고(30초 제한) GitHub 장애로 모든 push가 막히면 안 된다. main 병합 갱신은 절차서 5절의 정상 흐름이다. / 버린 대안: 훅에서 `gh pr view`로 리뷰 상태 조회.
- 결정: 세션 훅은 알림용이라 실패해도 세션을 막지 않는다(fail-open). L1 금지 훅(`guard.ts`)의 fail-closed는 그대로다. / 이유: 세션 훅은 보장 수단이 아니라 편의 기능이다. 네트워크가 없다고 세션이 안 열리면 안 된다. / 버린 대안: Stop 훅이 종료를 막고 계속 일하게 하기(무한 반복 위험).
- 결정: SessionStart 훅은 새 세션(`startup`)에서만, 그리고 runner가 띄운 세션이 아닐 때만 `start`를 돌린다. / 이유: `start`는 main을 당기고 worktree를 정리한다. 재개·압축 때마다, 또는 runner step 세션마다 돌면 진행 중인 작업과 겹친다. / 버린 대안: 모든 세션에서 실행.

## 발견 사항

## 열린 질문

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- 훅 규칙은 `scripts/test/guard.test.ts`에 차단·허용 사례를 더해 확인한다. 기존 사례는 고치지 않는다.

## 다음 할 일

- step0부터 순서대로. step 하나가 병합되면 `new-task --plan 20261115-repeat-guards --step <N>`.
