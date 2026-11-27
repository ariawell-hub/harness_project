---
id: 20261127-frozen-review-status
issue: 267 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session
claimed_at: 2026-11-27T23:34:17+09:00
---

# 동결된 P1만 있는 판정도 review/<검증자>가 실패해 PR을 막는다(원장은 미루는데 검증자 상태는 판정만 본다)

- 목표: 구현 판정의 차단 지적(P0·P1)이 모두 원장에서 미뤄지는 P1(동결, 범위 밖, 근거 없음)이고 `resolutions`에 `open`이 없으면 `review/<검증자>`(필수 체크)도 success로 기록한다. 지금은 원장이 동결된 P1을 `deferred`로 등록해도 `review/<검증자>`가 판정만 보고 실패해 PR을 막는다(Issue #267, #266 계획 검증 F4에서 드러남). 수용 기준: (1) 2라운드 구현 판정의 차단 지적이 모두 동결된 P1(바뀌지 않은 파일, 재현되지 않음)이고 `resolutions`에 `open`이 없으면 `review/<검증자>`와 `review-ledger`가 모두 success다. (2) 1라운드, 바뀐 파일의 P1, 재현된 P1, P0, `resolutions`의 `open`이 있으면 지금처럼 막는다. (3) 계획 전용 판정(G1)은 지금 규칙 그대로다(미뤄진 P1로 `review/<검증자>`를 success로 바꾸면 수정 요청이 계획 승인이 된다, #266 계획 검증 F5). (4) 라운드 수를 모르면(전달 값에 없음·깨짐) 동결로 통과시키지 않는다(fail-closed). (5) 원장 반영과 검증자 상태가 같은 분류 함수를 쓴다.
- 변경:
  - `scripts/ci/ledger.ts`: 새 지적의 등록 등급·상태·처리 칸을 정하는 함수 `newEntryStatus(f, { round, changed, outside, repro })`를 내보내고 `applyVerdict`가 그것을 쓴다(동작은 같다).
  - `scripts/ci/review-round.ts`의 `round-main.txt` 안내(`ROUND_MAIN_NOTE`)를 지시가 아니라 사실로 쓴다(기록 job이 그 파일의 새 P1을 범위 밖으로 미루고 P0은 막는다). PR #254 판정(main 병합 뒤)에서 Codex가 #266이 넣은 "원래 등급으로 적어라" 문장을 원장 데이터 안의 지시(주입)로 보고 P1을 냈다. 원장 파일은 검증자에게 데이터이고, 검증자가 할 일은 프롬프트에 있다.
  - `scripts/ci/review-round.ts`: 전달 값에 이 검증자의 라운드 수를 더한다(`{ changed, outside, round }`). `encodeRoundChanged`·`parseRoundChanged`(라운드는 1 이상의 정수, 없거나 다르면 null), 나누기 상한 검사(`fitsSplit`)도 라운드를 넣은 값으로 잰다. 워크플로는 그대로다(출력 이름 `round_changed`).
  - `scripts/ci/verdict.ts`·`scripts/ci/record.ts`: `verdictStatus(v, deferred?)`의 둘째 인자를 범위 밖 목록에서 "원장이 미루는 새 지적인가" 함수로 바꾼다. 차단 지적이 모두 P1이고 그 함수가 참이고 `resolutions`에 `open`이 없으면 success(`승인 (미룬 P1 N, …)`). `recordReview`의 `outside`를 `deferred`로 바꾼다.
  - `scripts/harness.ts`(`record-review`): 구현 판정이고 라운드 수를 알면 `newEntryStatus`로 `deferred`를 만든다(재현 결과도 함께 본다). 계획 전용 판정이거나 라운드 수를 모르면 범위 밖 목록만 쓴다(지금 동작).
  - 테스트 `scripts/test/record.test.ts`, `scripts/test/verdict.test.ts`, `scripts/test/ledger-store.test.ts`(전달 꼴의 라운드), `scripts/test/ledger.test.ts`(`newEntryStatus`). 설계서 10.2절 (5), `scripts/cross-review/ledger.md`, 변경 조각.
- 검증: `node --test scripts/test/record.test.ts scripts/test/verdict.test.ts scripts/test/ledger-store.test.ts scripts/test/ledger.test.ts`, 새 테스트가 main 코드에서 실패하는 것(R5), `node scripts/harness.ts check`.
- 비범위: 원장 반영 규칙 자체(동결·범위 밖의 조건), 워크플로 파일, 계획 전용 판정의 상태.

## 관련 파일·문서

<!-- 바꿀 파일·폴더 경로를 백틱으로 감싸 적는다(glob 가능, 폴더는 그 아래 전부). 읽기만 할 파일은 "읽기만"으로 시작하는 항목에 따로 적는다. 범위 밖 변경 검사(scope, R18)의 기준 -->

- `scripts/ci/ledger.ts`
- `scripts/ci/review-round.ts`
- `scripts/ci/verdict.ts`
- `scripts/ci/record.ts`
- `scripts/harness.ts`
- `scripts/test/record.test.ts`
- `scripts/test/verdict.test.ts`
- `scripts/test/ledger-store.test.ts`
- `scripts/test/ledger.test.ts`
- `scripts/cross-review/ledger.md`
- `docs/harness/design.md`
- `docs/harness/changes/20261127-frozen-review-status.md`
- `docs/exec-plans/active/20261127-frozen-review-status.md`
- 읽기만: `.github/workflows/judge-claude.yml`

## 진행 로그

- 2026-11-27 계획 작성. 기록 job은 라운드 수를 받지 않아(워크플로가 넘기지 않는다) 동결을 판단할 수 없다 → #262의 전달 값에 라운드 수를 더한다. 같은 실행의 plan job이 원장에서 센 값이고, 다른 실행의 기록이 그 사이 끼어도 라운드는 늘기만 해 1라운드로 잘못 보는 쪽(막는 쪽)으로만 어긋난다.
- 2026-11-27 구현: `newEntryStatus`를 `applyVerdict`에서 떼어 내 원장 반영과 기록 job이 함께 쓴다. 전달 값에 `round`(없으면 null, 있는데 1 이상의 정수가 아니면 깨진 값). `verdictStatus`의 둘째 인자를 범위 밖 목록에서 "원장이 미루는 지적인가" 함수로 바꿨다(#262의 범위 밖 판단도 그 함수로 간다. 설명은 `승인 (미룬 P1 N, …)`). 라운드 수를 모르면 1라운드로 보아 동결로 통과시키지 않는다. 테스트: 2라운드 동결 P1만 → 두 체크 success, 재현됨·바뀐 파일 P1·라운드 모름·1라운드·계획 전용 → `review/claude` failure, `newEntryStatus` 경우표, 전달 꼴의 `round`. 5개 테스트 파일 119건 통과.
- 2026-11-27 PR #254 재판정(main 병합 뒤, #266 반영): Codex가 `.harness-review/ledger.md:8`의 `round-main.txt` 안내("원래 등급으로 적어라")를 원장 데이터 안의 지시로 보고 새 P1을 냈다. 원장에서는 동결로 미뤄졌지만 `review/codex`가 실패해 #254를 막았다(이 계획이 고치는 바로 그 경우). 안내를 사실 서술로 바꿨다(위 변경). `verdict.test.ts`가 변경 전 코드에서 예외(단언 실패 아님)로 죽던 것을 단언 실패로 바꿨다.
- 2026-11-27 구현 판정 1회차(head `b03f714`): Claude 승인(지적 없음), Codex 수정 요청(P1 F1, P2 하나). 받아들였다. F1: 바뀐 파일 목록을 모르고(`changed` null) 라운드 수만 알면 모든 P1이 동결로 분류돼 바뀐 파일의 P1까지 검증자 상태가 통과한다 → 라운드 수와 바뀐 파일 목록을 둘 다 알 때만 동결로 통과시킨다. P2: 설계서 10.2절 (5)가 전달 꼴을 두 가지로 적었다 → 지금 꼴(`{ changed, outside, round }`)을 한 곳에 적고 예전 꼴은 호환 입력으로 적었다.
