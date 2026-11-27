---
id: 20261127-round-pr-scope
issue: 262 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-27T20:25:52+09:00 # new-task가 채운다
---

# main 병합 뒤 재판정의 라운드 입력이 다른 PR의 변경을 담아, 검증자가 PR 변경 밖 코드로 무관한 PR을 막는다

## 목표와 수용 기준

위험도 높음 PR은 `origin/main` 병합 갱신 뒤에도 검증자가 다시 판정한다(설계서 10.3절). 라운드 입력(`scripts/ci/review-round.ts`)의 "직전 판정 이후 바뀐 파일"과 diff는 `git diff <직전 판정 head> HEAD`라, main 병합으로 들어온 다른 PR의 변경까지 담는다. 검증자는 그 변경을 이 PR의 수정으로 보고 차단 지적을 내고, 동결 규칙(10.2절 (5))도 그 파일을 "바뀐 파일"로 세어 막는다. PR #254는 이렇게 F4·F5(P0)·F6(재현된 P1)로, #258은 F25(P1)로 막혔다. 고치는 일은 그 PR 범위 밖이었다(#257, #260, #261, #264).

제작자 결정(2026-11-27 대화, "하네스 원칙·규칙 변경"): **PR이 바꾸지 않았는데 main 병합으로 바뀐 파일의 새 P1은 재현됐어도 범위 밖으로 미룬다(`deferred`). 봇이 Issue로 넘긴다. P0은 지금처럼 막는다.**

수용 기준:

1. 라운드 입력의 "직전 판정 이후 바뀐 파일"(`round-changed.txt`, 반환값 `changed`)은 직전 판정 head 이후 바뀐 파일 가운데 이 PR의 파일이다. 이 PR의 파일은 지금 head가 바꾼 파일(`<merge-base>...HEAD`)과 직전 판정 head가 바꾼 파일(`<merge-base>...<직전 head>`)을 합친 것이다(뒤의 것이 없으면 PR이 직전 판정 뒤 되돌린 파일을 main 쪽으로 잘못 나눈다, 계획 검증 F1). 직전 판정 이후 바뀌었지만 어느 쪽에도 없는 파일(main 병합으로만 바뀐 파일)은 `round-main.txt`에 "이 PR의 변경이 아니다"로 따로 적고(반환값 `outside`), `round-diff.patch`에는 넣지 않는다. 둘 중 하나라도 읽지 못하면 나누지 않는다(수용 기준 2). 테스트: main 병합만 더한 갱신 뒤 main에서만 바뀐 파일이 `changed`·`round-diff.patch`에 없고 `outside`·`round-main.txt`에 있다. 병합 뒤 PR이 바꾼 파일은 `changed`와 diff에 있다. 직전 판정 head에서 바꿨다가 그 뒤 merge-base와 같게 되돌린 파일은 `changed`와 diff(되돌림)에 있고 `outside`에 없으며, 그 파일의 새 P1은 지금 규칙대로 `open`이다.
2. merge-base를 모르면(인자가 없음) `changed`는 지금처럼 직전 판정 이후 바뀐 파일 전부이고 `outside`는 빈 목록이다(지금 동작).
3. plan job 출력 `round_changed`는 `{ changed, outside }`의 base64 JSON이다(`encodeRoundChanged`). 인코딩한 값이 100,000자 이하면 그 값을 낸다. 넘으면 나누기 전 목록(`changed`와 `outside`의 합)을 지금의 배열 꼴로 인코딩해 100,000자 이하면 그 값을 낸다(지금 동작으로 돌아간다: 범위 밖 없음. 객체 꼴의 필드 이름 때문에 지금은 전달되던 목록이 버려져 새 P1이 동결되지 않게 한다, 계획 검증 F7). 그것도 넘으면 지금처럼 빈 값이다. 기록 job(`record-review --round-changed`, `parseRoundChanged`)은 이 꼴과 지금의 배열 꼴(`changed`만, `outside`는 빈 목록)을 받고, 그 밖(빈 값, base64·JSON이 아님, 배열·객체가 아님, `changed`가 문자열 배열·null이 아님, `outside`가 없거나 문자열 배열이 아님, 원소에 문자열이 아닌 값)은 모르는 것으로 본다(`changed` null, `outside` 빈 목록). 테스트: 각 꼴과 크기 경계(객체 꼴 100,000자 그대로, 객체 꼴이 상한을 처음 넘는 base64 길이 100,004자면 배열 꼴, 배열 꼴도 100,004자면 빈 값. base64 길이는 4의 배수다, 계획 검증 F3). 배열 꼴이 정확히 100,000자인 목록은 배열 꼴로 전달되고, 그 값을 받은 2라운드 계획 전용 기록에서 목록에 있는 파일의 재현 결과 없는 새 P1이 `open`이다(계획 검증 F7).
4. 원장 반영(`applyVerdict`): 새 P1의 위치가 `outside`에 있으면 재현 여부와 상관없이 `deferred`로 등록하고 처리 칸에 범위 밖 이유를 적는다. P0, `outside`에 없는 파일의 P1, P2·P3의 등록 규칙은 그대로다. `review-ledger`의 설명은 범위 밖 P1의 수를 따로 적는다(`그중 범위 밖 P1 N`).
   4-2. 4와 4-1은 구현 판정(기록의 `mode`가 `plan`이 아닌 것)에만 쓴다. 계획 전용 판정(G1)은 범위 밖으로 미루지 않는다: main 병합으로 같은 계획의 다른 step 파일이 바뀌면 그 파일이 `outside`가 될 수 있고, 그 파일의 P1을 미루면 수정 요청이 계획 승인으로 기록된다(계획 검증 F5). 계획 전용 판정의 기록은 지금 규칙 그대로다: 동결 검사의 바뀐 파일에는 나누기 전 목록(`changed`와 `outside`의 합)을 쓴다(`outside`를 빼면 그 파일의 재현 안 된 P1이 동결된다, 계획 검증 F6). 테스트: 2라운드 계획 전용 기록에서 `outside` 파일의 P1(재현 결과 없음, 재현됨 둘 다)이 `open`이고 `review/<검증자>`가 failure이며 그 검증자의 계획 승인이 남지 않는다.
   4-1. 검증자 상태(`review/<검증자>`, 필수 체크): 판정의 차단 지적(P0·P1)이 모두 `outside` 파일의 P1이고, 판정의 `resolutions`에 `open`이 없으면 success로 기록한다(설명에 범위 밖 P1 수, 승인처럼 patch를 적는다). 그 밖은 지금 규칙(승인이고 차단 지적이 없을 때만 success)이다. 원장이 막아야 하는 것(열린 지적)은 `review-ledger`가 그대로 막는다. 이 규칙이 없으면 원장은 미뤄도 `review/*`가 실패해 PR이 막힌다(계획 검증 F4). 테스트: 범위 밖 P1만 있는 판정에서 `review/<검증자>`와 `review-ledger`가 모두 success, 범위 안 P1이나 P0이 함께 있거나 `resolutions`에 `open`이 있으면 `review/<검증자>`가 failure이고 `review-ledger`도 막는다.
5. `pr-state`가 원장의 범위 밖 지적 번호를 한 줄로 알린다(`- 범위 밖 지적: F6 — …`). 절차서 8절에 "그 줄이 보이면 봇이 Issue로 등록한다"를 적는다. 테스트는 판정을 원장에 반영한 결과(`applyVerdict`에 `outside`)로 원장 댓글을 만들어 그 줄을 본다(판정 → 원장 → 안내).
6. 검증 프롬프트(`scripts/cross-review/prompt.md`)가 `round-main.txt`의 뜻과 그 파일 문제의 처리를 적는다: 그 파일에서 찾은 결함은 P2로 낮추지 말고 원래 등급으로 적는다(기계가 P1은 범위 밖으로 미뤄 Issue로 넘기고, P0은 막는다). 낮춰 적으면 Issue 안내에서 빠지기 때문이다(계획 검증 F2). 설계서 10.2절 (4)·(5), `scripts/cross-review/ledger.md`가 구현과 같은 규칙을 적는다.

## 범위 / 비범위

범위: `scripts/ci/review-round.ts`(PR 범위로 나눈 바뀐 파일과 diff, `round-main.txt`), `scripts/ci/record.ts`·`scripts/ci/verdict.ts`(검증자 상태), `scripts/harness.ts`(`review-plan`이 merge-base를 넘기고 출력 꼴을 바꾼다, `record-review`가 두 꼴을 읽는다), `scripts/ci/ledger.ts`(범위 밖 등록, 상태 설명), `scripts/ci/ledger-store.ts`(전달), `scripts/commands/pr-state.ts`(알림 줄), 테스트(`scripts/test/ledger-store.test.ts`, `scripts/test/record.test.ts`, `scripts/test/ledger.test.ts`, `scripts/test/pr-state.test.ts`, `scripts/test/verdict.test.ts`), 프롬프트·형식 문서, 설계서·절차서, 변경 조각.

비범위:

- 워크플로 파일(`.github/workflows/`). 봇은 워크플로를 push할 수 없다. 출력 이름(`round_changed`)은 그대로 두고 값의 꼴만 바꾼다(plan·기록 job이 같은 실행의 base 스크립트로 돈다).
- P0의 등록 규칙. 범위 밖 P0도 지금처럼 막는다(제작자 결정).
- 1라운드와 직전 판정 이후 바뀌지 않은 파일의 규칙(지금 그대로: 1라운드는 동결 없음, 2라운드부터 바뀌지 않은 파일의 재현 안 된 P1은 동결).
- 이미 원장에 있는 지적의 상태(새로 등록하는 지적에만 쓴다).
- 범위 밖 지적의 Issue를 CI가 여는 것(기록 job에 Issue 쓰기 권한을 주지 않는다. 대화 세션·runner가 `pr-state`를 보고 연다).
- 고정된 프롬프트 버전(10.2절 (2)): 원장이 있는 PR은 1라운드 base의 프롬프트를 계속 쓴다. 기계 쪽 규칙(1~5)은 바로 모든 PR에 쓰인다.

## 관련 파일·문서

- `scripts/ci/review-round.ts`
- `scripts/harness.ts`
- `scripts/ci/ledger.ts`
- `scripts/ci/ledger-store.ts`
- `scripts/ci/record.ts`
- `scripts/ci/verdict.ts`
- `scripts/test/verdict.test.ts`
- `scripts/commands/pr-state.ts`
- `scripts/test/ledger-store.test.ts`
- `scripts/test/record.test.ts`
- `scripts/test/ledger.test.ts`
- `scripts/test/pr-state.test.ts`
- `scripts/cross-review/prompt.md`
- `scripts/cross-review/ledger.md`
- `docs/harness/design.md`
- `docs/harness/workflow.md`
- `docs/harness/changes/20261127-round-pr-scope-s0.md`
- `docs/exec-plans/active/20261127-round-pr-scope/**`
- 읽기만: `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `scripts/ci/review-input.ts`, `scripts/gates/risk-gate.ts`(`changedFiles`)

## step 목록

- step0 scope: 라운드 입력을 PR 범위로 나누고(`round-main.txt`), main 병합으로만 바뀐 파일의 새 P1을 범위 밖 미룸으로 등록하고, `pr-state`가 알린다. 프롬프트·형식 문서·설계서·절차서.

## 진행 로그

- 2026-11-27 계획 작성. 계기: PR #254 판정 11라운드에서 Codex가 #263의 `changes.ts`에 F6(P1, 재현됨)을 냈다(→ Issue #264, PR #265).
- 2026-11-27 계획 검증 5회차(head `2a590af`): Claude 승인(지적 없음), Codex 수정 요청(새 P1 F7). F6은 fixed. 받아들였다. F7: 객체 꼴은 필드 이름만큼 길어 지금은 배열 꼴로 상한 안에 들던 목록이 버려지고(빈 값 → 모름) 새 P1이 동결된다 → 객체 꼴이 넘치면 나누기 전 목록을 지금의 배열 꼴로 보낸다(수용 기준 3. 구현 판정에도 같다).
- 2026-11-27 계획 검증 4회차(head `67fd990`): Claude 승인(지적 없음), Codex 수정 요청(새 P1 F6). F5는 fixed. 받아들였다. F6: 계획 전용 판정에서 `outside`만 비우면 그 파일이 `changed`에서도 빠져 재현 안 된 P1이 동결된다 → 계획 전용 기록은 동결 검사에 나누기 전 목록(`changed`와 `outside`의 합)을 쓴다(수용 기준 4-2).
- 2026-11-27 계획 검증 3회차(head `d057aaf`): Claude 승인(지적 없음), Codex 수정 요청(새 P1 F5). F3·F4는 fixed. 받아들였다. F5: 범위 밖 규칙이 계획 전용 판정(G1)에도 쓰이면 같은 계획의 다른 step 파일에 대한 P1이 미뤄져 수정 요청이 계획 승인으로 기록된다 → 수용 기준 4-2(구현 판정에만 쓴다).
- 2026-11-27 계획 검증 2회차(head `f5397aa`): Claude 승인(지적 없음), Codex 수정 요청(F3 유지, 새 P1 F4). F1·F2는 fixed. 받아들였다. F3: base64 길이는 4의 배수라 100,001자를 만들 수 없다 → 상한을 처음 넘는 100,004자로 단언한다. F4: 원장이 범위 밖 P1을 미뤄도 `review/<검증자>`(필수 체크)는 판정만 보고 실패한다 → 수용 기준 4-1(차단 지적이 모두 범위 밖 P1이고 `resolutions`에 `open`이 없으면 success).
- 2026-11-27 계획 검증 1회차(head `33d3291`): Claude 승인(지적 없음), Codex 수정 요청(P1 F1~F3). 받아들였다. F1: 직전 판정 뒤 PR이 되돌린 파일이 지금 merge-base 대비 diff에 없어 main 쪽으로 나뉜다 → 이 PR의 파일에 직전 판정 head가 바꾼 파일(`<merge-base>...<직전 head>`)을 더하고 되돌림 테스트를 둔다. F2: 프롬프트가 범위 밖 결함을 P2로 적게 하면 Issue 안내에서 빠진다 → 원래 등급으로 적게 하고, 판정 → 원장 → `pr-state` 테스트를 둔다. F3: 전달 꼴의 오류와 크기 경계 테스트가 없다 → `parseRoundChanged`·`encodeRoundChanged`의 경우와 경계 테스트(수용 기준 3).

## 의사결정 로그

- 범위 밖의 기준 / "직전 판정 이후 바뀌었지만 이 PR이 바꾸지 않은 파일"로 정한다 / 이 PR이 바꾸지 않은 파일 전부로 넓히면 "이 PR이 고쳤어야 할 문서를 고치지 않았다"(수용 기준 미충족) 같은 P1까지 미뤄진다. 그런 지적은 바뀌지 않은 파일을 가리키므로 지금 규칙(2라운드부터 동결, 재현되면 받는다)에 맡긴다. 버린 대안: PR이 바꾸지 않은 모든 파일.
- 범위 밖 P0 / 막는다 / 제작자 결정. P0은 드물고 크며, 봇이 Issue로 고치거나 제작자가 `/harness accept`로 닫는다.
- 데이터 전달 / plan job 출력 `round_changed`의 값 꼴을 바꾼다 / 워크플로를 고치지 않는다. 기록 job이 PR 파일 목록을 API로 읽는 대안은 실패 경로가 늘고 같은 실행 안의 plan job 계산과 어긋날 수 있어 버렸다.
- 범위 밖 표시 / 처리 칸의 고정 문구(`OUTSIDE_NOTE`)로 가린다 / 원장 항목에 필드를 더하면 원장 자료 형식과 검사가 바뀐다. 처리 칸은 `deferred`가 된 뒤 판정으로 바뀌지 않고 기록 job만 쓴다.
- 판정 대상 diff / 양쪽이 바꾼 파일은 직전 판정 head 대비 diff 전체를 준다 / 파일 안에서 main의 덩어리를 가려내는 일은 이 계획에서 하지 않는다.
- 이 PR의 파일 / 지금 head와 직전 판정 head가 merge-base 대비 바꾼 파일의 합 / 지금 head만 보면 직전 판정 뒤 되돌린 파일이 main 쪽으로 나뉘어 그 회귀가 미뤄진다(계획 검증 F1). 직전 판정 head의 merge-base는 지금 merge-base와 직전 head의 merge-base(`<merge-base>...<직전 head>`)로 본다: main을 병합했으면 직전 판정 때의 main 지점이다. 버린 대안: main 쪽 커밋만 따로 diff(main 병합 커밋을 찾아야 하고 병합이 여럿이면 복잡하다).
- 범위 밖 결함의 등급 / 검증자는 원래 등급으로 적는다 / 기계가 등급으로 미룸과 차단을 정하므로, 프롬프트가 등급을 낮추게 하면 Issue 안내에서 빠진다(계획 검증 F2).

## 발견 사항

- 동결된 P1도 원장에서는 `deferred`지만 `review/<검증자>`는 판정만 보고 실패한다(`verdictStatus`). 검증자가 다음 판정에서 그 지적을 다시 내지 않아야 풀린다. 범위 밖은 이 계획에서 고친다(수용 기준 4-1, 계획 검증 F4). 동결은 라운드 수(원장)가 있어야 판정할 수 있어 따로 다룬다. → 처리: #267

- 검증 프롬프트는 이미 "바뀌지 않은 기존 코드의 문제는 P2로 적되, 기존 코드의 P0는 그대로 P0로"라고 적는다. 그런데 main 병합으로 들어온 변경이 `round-diff.patch`에 "직전 판정 이후 바뀐 것"으로 보여, 검증자는 그것을 이 PR의 수정으로 읽었다. → 처리: 이 계획(수용 기준 1, 6)

## 열린 질문

없음(범위는 제작자가 2026-11-27 대화에서 정했다).

## 검증 방법과 결과

- step0의 Acceptance Criteria 명령, `node scripts/harness.ts check`.

## 다음 할 일

- 계획 검증(G1)을 받은 뒤 step0을 구현한다.
