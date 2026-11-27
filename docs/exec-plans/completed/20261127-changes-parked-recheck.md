---
id: 20261127-changes-parked-recheck
issue: 261 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session
claimed_at: 2026-11-27T13:41:54+09:00
---

# changes-collect: 원래 파일을 지우기 직전 바이트를 다시 견주지 않아, 미리 연 핸들로 저장한 내용을 잃을 수 있다(#258)

- 목표: `changes-collect`가 기록 파일을 게시한 뒤 임시 이름의 원래 파일을 지우기 직전에 그 파일의 식별자·바이트를 다시 견준다. 게시하는 동안 원래 파일을 미리 열어 둔 다른 세션이 저장했으면 지우지 않고 임시 이름에 남겨 경로를 알리고 1로 끝낸다(Issue #261, PR #254 판정 F5). 수용 기준: 결과를 새 파일에 쓰는 동안 원래 CHANGELOG를 미리 연 핸들로 다른 내용을 쓰는 테스트에서 원래 파일이 임시 이름에 그 내용으로 남고 경로를 알리며 명령이 1이다. 있던 `changes-collect` 테스트는 그대로 통과한다.
- 변경: `scripts/commands/changes.ts`의 `write`에서 새 이름을 지운 뒤 임시 이름을 지우기 전에 `verifyAt(rel, 임시 이름)`(식별자·링크 수 1·처음 읽은 바이트). 어긋나면 남긴 임시 파일에 넣고 멈춘다. 조각 지우기(`remove`)는 확인 바로 뒤에 지워 사이에 다른 일이 없으므로 그대로 둔다. 테스트 `scripts/test/changes-collect.test.ts` 한 건, 변경 조각.
- 검증: `node --test scripts/test/changes-collect.test.ts`, 새 테스트가 main 코드에서 실패하는 것(R5), `node scripts/harness.ts check`.
- 비범위: 다시 견준 뒤 지우기까지의 아주 짧은 창, 이미 연 핸들로 게시한 새 파일에 쓰는 프로세스(#258 계획의 위협 모형).

## 관련 파일·문서

<!-- 바꿀 파일·폴더 경로를 백틱으로 감싸 적는다(glob 가능, 폴더는 그 아래 전부). 읽기만 할 파일은 "읽기만"으로 시작하는 항목에 따로 적는다. 범위 밖 변경 검사(scope, R18)의 기준 -->

- `scripts/commands/changes.ts`
- `scripts/test/changes-collect.test.ts`
- `docs/harness/changes/20261127-changes-parked-recheck.md`
- `docs/exec-plans/active/20261127-changes-parked-recheck.md`

## 진행 로그

- 2026-11-27 테스트 먼저: 새 테스트(#261)가 main(`fe073a7`) 코드에서 실패했다(미리 연 핸들의 저장을 잃고 0). 구현: 임시 이름의 원래 파일을 지우기 직전에 식별자·바이트를 다시 견준다. 처음에는 `verifyAt`(링크 수 1 포함)을 써 #257 (파2)(옮겨 둔 원래 파일에 하드 링크를 더해도 원래 inode에 쓰지 않는다)가 실패했다 → 링크 수는 보지 않는 `sameBytesAt`으로 바꿨다(하드 링크가 더해져도 지우는 것은 이 명령의 임시 이름 하나다). `changes-collect.test.ts` 31건 통과.
- 2026-11-27 구현 판정 1회차(head `5a4ec9c`): Claude 승인(지적 없음), Codex 수정 요청(P0 F1). 받아들였다. 다시 견주는 `readAll`이 처음 `fstat`의 크기까지만 읽어, 읽는 도중 끝에 덧붙은 바이트를 놓친다 → `readAll`은 EOF까지 읽고, 다시 견줄 때 읽은 뒤의 `fstat` 크기·수정 시각이 읽기 전과 같고 읽은 길이와 같은지도 본다. 끝에만 덧붙인 저장 테스트를 더했다(읽는 도중의 끼어들기 자체는 시험용 고리 없이 재현하지 않았다). 32건 통과.
- 2026-11-27 구현 판정 2회차(head `50e40c1`): Claude 승인(지적 없음), Codex 수정 요청(P0 F2, P1 F3). 받아들였다. F2: EOF까지 쌓아 읽으면 계속 커지는 파일에서 메모리가 고갈된다 → `readUpTo(fd, max)`로 상한을 두고, 견줄 때는 기대 길이보다 한 바이트라도 더 있으면 다르다고 본다(처음 읽기 상한 16MB, 넘으면 문제로 낸다). F3: 덧붙임 테스트가 다시 견주기 전에 써서 견주는 도중을 보지 않는다 → 시험용 고리 `beforeRecheckRead`(첫 `fstat` 뒤 읽기 전)로 그 사이에 덧붙인다(직전 head에는 고리가 없어 실패한다).
- 2026-11-27 구현 판정 3회차(head `8c2bbc1`): Claude 승인(P2 하나), Codex 수정 요청(P0 F5). 같은 지적이라 받아들였다. `readUpTo`가 파일마다 상한(16MB)만큼 버퍼를 잡고 그 일부(`subarray`)를 `readBytes`에 쥐어, 작은 조각이 많으면 메모리가 고갈된다 → 64KB 청크로 읽고 실제 크기만큼 `Buffer.concat`으로 복사해 돌려준다.
- 2026-11-27 구현 판정 4회차(head `c384a20`): Claude 승인(지적 없음), Codex 수정 요청(F2 유지). 받아들였다. 짧은 읽기가 이어지면 청크마다 64KB 버퍼 전체를 `subarray`로 쥔다 → 고정 크기 버퍼 하나를 다시 쓰고 실제 읽은 바이트만 복사해 쌓는다.
