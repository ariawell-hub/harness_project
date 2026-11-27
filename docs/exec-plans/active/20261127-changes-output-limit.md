---
id: 20261127-changes-output-limit
issue: 264 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session
claimed_at: 2026-11-27T18:44:17+09:00
---

# changes-collect: 모은 결과의 크기를 보지 않아, 다음 실행에서 읽을 수 없는 CHANGELOG를 게시할 수 있다(#263)

- 목표: `changes-collect`가 모은 결과(설계서·CHANGELOG)의 바이트 수가 읽기 상한(`READ_MAX`, 16 MiB)을 넘으면 파일을 쓰거나 조각을 지우기 전에 파일 이름과 상한을 알리고 1로 끝낸다. 다음 실행에서 읽을 수 없는 기록 파일을 게시하고 조각을 지우는 일을 막는다(Issue #264, PR #254 판정 F6). 수용 기준: CHANGELOG가 정확히 `READ_MAX`바이트이고 작은 조각 하나를 모으는 테스트에서 명령이 1이고 CHANGELOG 크기가 그대로이며 조각이 남는다. 결과가 정확히 `READ_MAX`바이트이면 통과한다(경계). 있던 `changes-collect` 테스트는 그대로 통과한다.
- 변경: `scripts/commands/changes.ts` 7단계에서 `collectFragments` 뒤, 쓸 파일(설계서는 바뀔 때만, CHANGELOG)의 `Buffer.byteLength`가 `READ_MAX`를 넘으면 `fail(problems, false)`. 테스트 `scripts/test/changes-collect.test.ts` 두 건(넘는 경우, 경계), 변경 조각.
- 검증: `node --test scripts/test/changes-collect.test.ts`, 새 테스트가 main 코드에서 실패하는 것(R5), `node scripts/harness.ts check`.
- 비범위: 상한 값 자체를 바꾸는 일, 기록 파일을 나누는 일(상한에 닿으면 사람이 CHANGELOG를 정리한다).

## 관련 파일·문서

<!-- 바꿀 파일·폴더 경로를 백틱으로 감싸 적는다(glob 가능, 폴더는 그 아래 전부). 읽기만 할 파일은 "읽기만"으로 시작하는 항목에 따로 적는다. 범위 밖 변경 검사(scope, R18)의 기준 -->

- `scripts/commands/changes.ts`
- `scripts/test/changes-collect.test.ts`
- `docs/harness/changes/20261127-changes-output-limit.md`
- `docs/exec-plans/active/20261127-changes-output-limit.md`

## 진행 로그

- 2026-11-27 테스트 먼저: 새 테스트 둘 중 상한을 넘는 경우(Codex F6 재현 테스트와 같은 상황)가 main(`4e615e7`) 코드에서 실패했다(모으기가 0으로 끝나고 상한을 넘는 CHANGELOG를 게시). 구현: 7단계 계산 뒤 쓸 파일(설계서는 바뀔 때만, CHANGELOG)의 바이트 수가 `READ_MAX`를 넘으면 `fail(…, false)`. 경계 테스트는 결과가 정확히 상한이면 모으고, 다음 실행이 그 파일을 읽은 뒤(읽기 상한 문제가 아니다) 더 모은 결과 크기로 멈추는지 본다. `changes-collect.test.ts` 34건 통과.
