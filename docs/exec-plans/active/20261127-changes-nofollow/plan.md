---
id: 20261127-changes-nofollow
issue: 257 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-27T01:53:22+09:00 # new-task가 채운다
---

# changes-collect가 쓰기 직전 같은 바이트의 링크로 바뀐 기록 파일을 따라가 덮어쓴다(#242)

## 목표와 수용 기준

`changes-collect`(`scripts/commands/changes.ts`, #242)는 시작할 때 기록 파일(설계서, CHANGELOG, 조각)이 링크가 아닌 일반 파일이고 하드 링크 수가 1인지 `lstat`으로 본다. 쓰기·지우기 직전에는 "읽은 뒤 내용이 바뀌었는가"만 경로로 다시 읽어 본다. 이 재검사와 쓰기(`writeFileSync`)는 링크를 따라간다. 그래서 시작 검사 뒤 쓰기 전에 기록 파일이 **같은 바이트를 가진 다른 파일로 가는 링크**로 바뀌거나 상위 폴더(`docs/harness`, `docs/harness/changes`)가 링크로 바뀌면, 재검사는 같다고 보고 쓰기·지우기가 링크 너머(리포 밖일 수 있다)의 파일에 닿는다. PR #254 구현 판정의 Codex 지적 F4(P0)다. 같은 때에 그 작업 트리에 쓸 수 있는 다른 프로세스가 있어야 일어난다.

수용 기준:

1. 쓰기는 열린 파일 핸들로 한다. 쓰기 직전에 기록 파일을 링크를 따라가지 않고 연다(`O_NOFOLLOW`가 있는 플랫폼). 그 핸들의 `fstat`이 시작 검사 때의 그 파일(dev·ino 같음)이고 일반 파일이며 하드 링크 수가 1이고, 그 핸들로 읽은 내용이 처음 읽은 바이트와 같을 때만 같은 핸들로 처음부터 다시 쓴다. 아니면 쓰지 않고 멈춘다.
2. 조각을 지우기 직전에 링크를 따라가지 않고 `lstat`한 식별자가 시작 때와 같고, 링크를 따라가지 않고 연 핸들로 읽은 내용이 처음 읽은 바이트와 같을 때만 지운다.
3. 쓰기·지우기 직전마다 `docs`, `docs/harness`, `docs/harness/changes`가 링크가 아닌 실제 폴더이고 식별자가 시작 때와 같은지 본다. 아니면 멈춘다.
4. 멈추면 무엇이 바뀌었는지(`<경로>: 처음 검사한 그 파일이 아니다` 또는 `<폴더>: 처음 검사한 그 폴더가 아니다`)를 알리고, 지금처럼 이 명령이 바꾼 파일만 담은 되돌리는 명령을 낸다(바꾼 파일이 없으면 "아무 파일도 바꾸지 않았다"). 폴더가 바뀐 경우에는 폴더를 제자리에 돌려놓은 뒤 되돌리라고 알린다.
5. `O_NOFOLLOW`가 없는 플랫폼(Windows)에서는 1의 식별자 비교만으로 링크 너머 파일에 쓰지 않는다(링크를 따라 열려도 식별자가 다르다). 이 경로를 테스트로 확인한다(옵션으로 `O_NOFOLLOW`를 끈다).
6. 시작 검사 뒤 쓰기 전에 (가) CHANGELOG를 같은 바이트의 리포 밖 파일로 가는 링크로 바꾸기, (나) `docs/harness`를 같은 바이트의 사본이 든 리포 밖 폴더로 가는 링크로 바꾸기, (다) CHANGELOG에 리포 밖 하드 링크를 더하기, (라) `docs/harness/changes`를 같은 이름·바이트의 조각이 든 리포 밖 폴더로 가는 링크로 바꾸기에서, 리포 밖 파일이 바뀌거나 지워지지 않고 명령이 1을 낸다. (가)는 `O_NOFOLLOW`를 끈 경우도 같다. 이 변경 전 코드에서는 넷 모두 리포 밖 파일이 바뀌거나 지워져 테스트가 실패한다.
7. 있던 `changes-collect` 테스트는 그대로 통과한다.

## 범위 / 비범위

범위:

- `scripts/commands/changes.ts`: 시작 검사 때 식별자(dev·ino, bigint)를 기록하고, 읽기·쓰기·지우기를 위 기준으로 바꾼다.
- `scripts/test/changes-collect.test.ts`: 수용 기준 6의 경우를 더한다.
- `docs/harness/architecture.md`의 `lib/changes.ts` 줄(명령 설명), 변경 조각.

비범위:

- 지우기 직전 확인과 `unlink` 사이의 아주 짧은 창(Node에 `unlinkat`이 없다). 폴더 식별자 확인 뒤 그 사이에 폴더를 바꾸는 경쟁은 남는다. 발견 사항에 남은 위험으로 적는다.
- 리포 루트(`root`) 자체나 그 위 폴더가 바뀌는 경우.
- `changes-collect` 밖의 다른 쓰기 명령.

## 관련 파일·문서

- `scripts/commands/changes.ts`
- `scripts/test/changes-collect.test.ts`
- `docs/harness/architecture.md`
- `docs/harness/changes/20261127-changes-nofollow-s0.md`
- `docs/exec-plans/active/20261127-changes-nofollow/**`
- 읽기만: `scripts/lib/changes.ts`, `scripts/test/helpers.ts`

## step 목록

- step0 nofollow: 기록 파일을 핸들로 열어 식별자를 확인한 뒤 같은 핸들로 쓰고, 폴더 식별자를 확인한다. 테스트 먼저.

## 진행 로그

- 2026-11-27 Issue #257 등록(PR #254 구현 판정 Codex F4, #254 범위 밖이라 따로). 계획 작성.

## 의사결정 로그

- 결정: 경로로 다시 읽어 보는 확인 대신 열린 핸들의 `fstat` 식별자(dev·ino)와 링크 수로 "그 파일"인지 보고 같은 핸들로 쓴다. / 이유: 경로 확인과 경로 쓰기 사이에는 늘 창이 있다. 핸들로 확인하고 같은 핸들로 쓰면 창이 없다. / 버린 대안: 쓰기 직전에 `lstat`만 한 번 더 한다(확인과 쓰기 사이 창이 남는다).
- 결정: `O_NOFOLLOW`를 쓰되 식별자 비교를 주된 방어로 둔다. / 이유: Windows에는 `O_NOFOLLOW`가 없다(`fs.constants.O_NOFOLLOW`가 없음). 링크를 따라 열려도 식별자가 다르면 쓰지 않으므로 플랫폼과 무관하게 막힌다. / 버린 대안: Windows에서는 검사를 건너뛴다.
- 결정: 식별자는 `bigint` 통계로 견준다. / 이유: Windows의 파일 색인 번호는 `number`로 정밀도를 잃을 수 있다.
- 결정: 테스트 주입(`fs.writeFile`, `fs.unlink`)은 그대로 두고, 기본 쓰기만 핸들로 한다(주입 함수에 핸들을 셋째 인자로 넘긴다). / 이유: 있던 경쟁 테스트(F6)를 바꾸지 않는다. 확인은 주입 함수를 부르기 전에 하므로 새 테스트는 주입 함수 안에서 링크를 바꾸는 방식으로 확인과 쓰기 사이를 재현한다.

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

## 열린 질문

<!-- 선택지 + 추천안 (9.1절) -->

## 검증 방법과 결과

- step0 AC(`node --test scripts/test/changes-collect.test.ts`, grep, `check`).
- R5: 새 테스트가 이 변경 전 코드(merge-base)에서 실패하는 것을 진행 로그에 적는다.

## 다음 할 일

1. 계획 검증(G1)을 받는다(계획만 push, 초안 PR).
2. 승인 뒤 테스트 먼저 → 구현 → AC·`check` → 완료 처리 → push → 구현 판정 → `pr-ready`.
