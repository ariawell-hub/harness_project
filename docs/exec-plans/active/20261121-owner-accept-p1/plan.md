---
id: 20261121-owner-accept-p1
issue: 178 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active    # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T20:54:15+09:00 # new-task가 채운다
---

# 제작자 승인으로 P1 지적을 닫는 길을 만든다: 되돌릴 수 없는 절차 지적의 교착 (PR #171 F28)

## 목표와 수용 기준

제작자 승인(`/harness accept F<번호>`)은 지금 P0에만 있다(설계서 10.2절 (4) "P1에는 쓰지 않는다"). 그래서 고칠 수 없는 P1 지적이 교착이 되면 풀 길이 없다. PR #171(Issue #170 step0)의 F28이 그 사례다: "구현이 실패 테스트보다 먼저 작성됐다"는 지난 순서에 대한 지적이라 고칠 수 없고, 사후 실패 확인·반박 2회·빈 구현 커밋 뒤 복원까지 했지만 재판정 4회 뒤에도 열려 있다. 제작자가 자기 계정으로 단 예외 댓글은 검증자에게 전해지지 않는다(반박 전달은 세 줄 문단만 옮긴다). P0은 제작자가 남은 위험을 받아들일 수 있는데 그보다 가벼운 P1은 받아들일 수 없는 것도 어긋난다.

이 계획은 제작자 승인의 대상을 열린 P0·P1로 넓힌다. 방법은 제작자가 골랐다(2026-11-21 대화: "`/harness accept`를 P1까지"). 승인을 인정하는 조건은 그대로 둔다.

수용 기준:

1. 제작자 계정이 PR에 단, 승인 줄만 있는 고쳐지지 않은 댓글이 지적이 게시된 뒤에 달렸으면, 원장의 열린 P1이 `accepted`가 되고 `review-ledger`가 그 지적 때문에 막지 않는다(테스트가 판별 함수, 읽기, 기록 명령에서 단언한다).
2. 승인을 인정하는 조건은 P0과 같고 바뀌지 않는다: 제작자가 아닌 계정(PR 작성자인 봇 포함)의 댓글, 고쳐진 댓글, 다른 글이 섞인 댓글, 지적이 게시되기 전의 댓글은 P1에도 승인이 아니다(테스트가 단언한다). 계획·반박에 적은 글은 승인이 아니다.
3. P2·P3과, `deferred`·`fixed`·`rejected`인 P1은 대상이 아니다. 댓글을 읽는 실행(원장에 열렸거나 `accepted`인 P0·P1이 하나라도 있다)에서는 반영하지 않은 이유가 고정된 문구로 로그에 남는다(기록 명령 테스트가 열린 P1과 `deferred`인 P2를 함께 승인한 댓글로 단언한다). 그런 지적이 없는 원장에서는 댓글을 읽지 않으므로 이유도 남지 않는다(지금의 P0과 같다. 테스트가 단언한다).
4. `accepted`인 P1은 검증자의 판정으로 바뀌지 않고, 승인 댓글이 없어지면 `open`으로 돌아가 다시 막는다. 검증자가 다른 위치나 제목으로 낸 새 지적은 새 ID로 등록되고, 막는지는 있던 등록 규칙을 그대로 따른다: 새 P0과, 직전 판정 이후 바뀐 파일에 대한(또는 재현된) 새 P1은 `open`으로 다시 막는다. 그 검증자의 2라운드 이후에 바뀌지 않은 파일에 대해 낸 재현되지 않은 새 P1은 동결 규칙(설계서 10.2절 (5))대로 `deferred`로 등록돼 막지 않는다(테스트가 두 경우를 모두 단언한다).
5. P0에 대한 지금의 동작은 바뀌지 않는다(있던 P0 테스트가 그대로 통과한다).
6. 열린 P1이 있는 원장을 기록할 때 편집 이력을 읽지 못하면 닫힌 쪽이다(원장을 쓰지 않고 `review-ledger`가 `error`. 기록 명령 테스트가 단언한다). 가짜 GitHub이 `/graphql`을 모르던 있던 기록 명령 테스트(`scripts/test/record.test.ts`)는 단언을 지우거나 고치지 않고 통과한다(가짜 서버에 응답을 더한다).
7. 설계서 10.2절 (4), 절차서 8절, 원장 형식 문서(`scripts/cross-review/ledger.md`), `docs/harness/architecture.md`의 `ci/*` 행이 "제작자 승인은 P0·P1"이라고 같은 말을 한다. 설계서의 버전이 오르고 변경 기록과 `CHANGELOG`에 한 줄이 있다. `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- `scripts/ci/owner-accept.ts`의 판별 두 곳(`refusal`, `needsAccepts`)과 주석. `scripts/ci/accept-load.ts`·`scripts/ci/ledger.ts`의 주석.
- 테스트: `scripts/test/owner-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/record.test.ts`(가짜 서버에 `/graphql`을 더하고, 열린 P1이 있으면 편집 이력을 읽는다는 단언을 더한다). 다섯 파일 모두 새 동작을 단언해 변경 전 코드에서 실패한다(`test-effect`).
- 문서: `docs/harness/design.md`(10.2절 (4), 버전, 변경 기록), `docs/harness/workflow.md`(8절), `scripts/cross-review/ledger.md`, `docs/harness/architecture.md`(`ci/*` 행), `docs/harness/CHANGELOG.md`.

비범위:

- 승인 댓글을 인정하는 조건의 변경.
- 검증자 프롬프트(`scripts/cross-review/prompt.md`), 반박 전달(`scripts/ci/rebuttal.ts`), 제작자 댓글을 검증자 입력에 넣는 일.
- runner(`scripts/runner/**`)와 `pr-state`. runner의 교착 보고 문구(A/B/C)에 승인 선택지를 더하는 일은 하지 않는다(P0에도 지금 없다. 발견 사항).
- 검증자가 절차 지적의 등급을 매기는 기준.
- PR #171 자체. 이 계획이 병합된 뒤 그 PR에서 제작자가 F28을 승인한다.
- `.github/workflows/`, `harness.config.json`.

## 관련 파일·문서

- `scripts/ci/owner-accept.ts`, `scripts/ci/accept-load.ts`, `scripts/ci/ledger.ts`
- `scripts/test/owner-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/record.test.ts`
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, `scripts/cross-review/ledger.md`
- 읽기만: `scripts/ci/ledger-store.ts`, `scripts/cross-review/prompt.md`, `scripts/ci/rebuttal.ts`, `scripts/test/ledger-store.test.ts`, `scripts/test/ledger.test.ts`, `scripts/gates/test-effect.ts`

## step 목록

- step0 p1-accept: 제작자 승인의 대상을 열린 P0·P1로 넓히고(판별 두 곳), 테스트와 문서를 맞춘다.

## 진행 로그

- 2026-11-21 계획 작성. 출처: PR #171의 F28 교착(재판정 4회)에서 제작자가 "하네스를 먼저 고친다"를 골랐다(대화). 봇이 Issue #178을 등록했다.
- 2026-11-21 계획 검증 1라운드(head `076373a`): `review/claude` 승인. `review/codex` 수정 요청(P1 3건). 셋 다 맞는 지적이라 계획을 고쳤다.
  - F1(있던 원장 동작만 보는 테스트 파일은 `test-effect`에서 실패한다): 원장 쪽 테스트를 `ledger-accept.test.ts`에만 두고, 열린 P1에 `applyOwnerAccepts`로 승인을 반영한 원장을 입력으로 쓰게 했다(변경 전 코드에서 실패한다). `ledger.test.ts`는 고치지 않는다. 예외 줄은 쓰지 않는다. AC에 `test-effect`를 더했다.
  - F2(승인 뒤 새 P1이 막는 조건에 동결 규칙이 빠졌다): 수용 기준 4와 테스트를 있던 등록 규칙대로 적었다(바뀐 파일의 새 P1과 새 P0은 `open`, 바뀌지 않은 파일의 재현되지 않은 새 P1은 `deferred`).
  - F3(댓글 조회를 건너뛰는 원장에서는 거부 이유가 남지 않는다): 수용 기준 3을 "댓글을 읽는 실행에서 남는다"로 고치고, 기록 명령 테스트 둘(열린 P1과 `deferred` P2를 함께 승인, `fixed` P1만 있는 원장)을 더했다.
- 2026-11-21 계획 검증 2라운드(head `771de68`): `review/claude` 승인. `review/codex`가 F1·F2·F3을 닫고 새 P1 하나를 냈다(F4: `fixed`인 P1만 있는 원장의 기록 명령 테스트가 "원장은 그대로다"를 단언하게 적혀 있는데, 기록 명령은 판정 라운드를 더해 원장을 다시 저장하는 것이 정상이다. 승인 기록 줄의 접두사는 `record-review: 제작자 승인`이다). 맞는 지적이라 단언을 셋(GraphQL 호출 0회, 그 P1 행의 상태와 처리 칸 유지, `record-review: 제작자 승인`으로 시작하는 줄 없음)으로 고쳐 적었다. `pr-state`에 오래 열린 지적 줄은 없다.

- 2026-11-21 계획 검증 3라운드(head `564e87b`): 두 검증자 승인(G1 해시 `079705700eca`). F1~F4 모두 `fixed`.
- 2026-11-21 step0 구현(TDD)과 계획 수정.
  - 테스트를 먼저 썼고 구현 전에 실패를 확인했다(커밋 `1436768`은 테스트만 담았다). 그 상태에서 실패한 테스트: `owner-accept.test.ts` 18개 중 6개, `accept-load.test.ts` 23개 중 4개, `accept-cli.test.ts` 11개 중 2개, `ledger-accept.test.ts` 12개 중 3개. 합계 15개. 구현(커밋 `ddb10bb`: `refusal`, `needsAccepts`) 뒤 여섯 테스트 파일 94개가 통과했다. 문서도 고쳐 커밋했다.
  - 고친 있던 단언("P1은 승인되지 않는다"를 전제한 것만): `owner-accept.test.ts`의 `applyOwnerAccepts: 반영하지 않는 경우마다 지적은 그대로이고 이유가 남는다`(P1 행을 빼고 문구를 새 것으로), `applyOwnerAccepts: 두 번 적용해도 같고, 다른 지적은 건드리지 않는다`(건드리지 않는 지적 F2를 열린 P1에서 미뤄진 P2로), `needsAccepts: …`(제목과 P1 줄). `accept-load.test.ts`의 `recordLedger: 볼 지적이 없거나 제작자 설정·GraphQL이 없으면 편집 이력을 읽지 않는다`(열린 P1을 닫힌 P1과 미뤄진 P2로 바꾸고, 열린 지적이 없어졌으므로 `review-ledger` 기대값을 `failure`에서 `success`로), `loadAccepted: 볼 지적이 없거나 제작자가 비면 GraphQL을 부르지 않는다`(열린 P1을 닫힌 P1·동결된 P1·미뤄진 P2로). `accept-cli.test.ts`와 `ledger-accept.test.ts`는 더하기만 했다.
  - AC를 돌리다 하나가 실패했다: 기록 명령 테스트가 거부 문구를 정규식(괄호를 이스케이프한 글)으로 단언해 AC의 글자 그대로 찾기(`grep -F`)에 걸리지 않았다. 단언을 글자 그대로 비교(`includes`)로 바꿨다. 단언의 세기는 같다.
  - **`check`의 전체 테스트에서 계획에 없던 실패가 하나 나왔다**: `scripts/test/record.test.ts`의 `record-review: 판정을 원장 댓글에 반영하고 review/*와 review-ledger를 head에 기록한다`. 그 파일의 가짜 서버에는 `/graphql`이 없는데, 2라운드의 원장에 열린 P1이 있어 이제 편집 이력을 읽으려다 실패하고 `review-ledger`가 `error`가 된다. 동작은 계획대로다(읽지 못하면 닫힌 쪽). 테스트의 가짜 서버가 새 요청을 몰랐던 것이다. 이 파일은 "관련 파일"에 없어서 고치려면 계획을 고쳐 다시 검증받아야 한다. push하지 않았다.
  - 계획을 고쳤다: "관련 파일"과 범위에 `scripts/test/record.test.ts`를 더하고, step0의 작업 3절에 그 파일에서 할 일(가짜 서버에 `/graphql`, 요청 수 단언, 읽기 실패 테스트)을, AC에 그 파일의 실행과 "줄을 지우지 않았다"는 확인을, 금지사항 둘을 더했다. 수용 기준 6을 더했다(뒤 번호는 7이 됐다). 미리 확인했다: 그 변경을 넣으면 구현이 있을 때 그 파일 13개가 통과하고, 구현이 없으면 2개가 실패한다(`test-effect`를 통과한다).
  - 계획 검증을 다시 받으려고 코드를 내렸다(절차서 2절 "코드를 이미 올린 PR에서 계획 검증이 필요해지면"): `scripts/`와 `docs/harness/`를 계획만 있던 커밋(`564e87b`)의 상태로 되돌리는 커밋을 더했다. 테스트·구현·문서 커밋은 이력에 남아 있고, 승인 뒤에 다시 올린다.

- 2026-11-21 계획 검증 4라운드(head `d62e5a3`): 두 검증자 승인(G1 해시 `89b8bb4708e7`). codex가 P2 하나를 냈다(F5, 미룸: `record.test.ts`의 "줄을 지우지 않았다"를 보는 AC가 빈 줄 삭제를 세지 않는다). AC는 고치지 않았고(승인이 무효가 된다), 올릴 때 `git diff --numstat`으로 삭제 줄이 0임을 따로 확인했다(더한 줄 37, 지운 줄 0).
- 2026-11-21 코드를 다시 올렸다(테스트 → 구현 → 문서 순서의 커밋 셋).
  - 테스트 커밋 `2935b8b`: 다섯 테스트 파일 77개 가운데 17개가 실패한다(앞서의 15개와 `record.test.ts`의 2개: 있던 테스트에 더한 요청 수 단언, 읽기 실패 테스트).
  - 구현 커밋 `3d1fa67`: 일곱 테스트 파일 107개가 통과한다. 문서 커밋 `2a2d696`.
  - AC 16줄과 `check` 통과. step0 완료 처리.
- 2026-11-21T22:21:36+09:00 step0 재작업: 코드 판정 1라운드의 F7(승인 뒤 새 지적의 설명에 동결 조건이 빠졌다)을 문서 세 곳에서 고친다

## 의사결정 로그

- 결정(제작자, 2026-11-21 대화): `/harness accept`를 P1까지 넓힌다. / 이유: 검증자(LLM)를 거치지 않아 결과가 확정적이고, 봇은 쓸 수 없으며, 변경이 작다. / 버린 대안: 제작자 계정의 PR 댓글을 검증자 입력에 넣기(자유 글이 검증자에게 가는 길이 생기고, 닫힐지는 여전히 검증자에 달려 있다).
- 결정: P1의 승인 조건을 P0과 똑같이 둔다(교착이나 재판정 횟수를 코드로 요구하지 않는다). / 이유: P0에도 그런 조건이 없다. 승인하는 것은 제작자뿐이고, 언제 권할지는 절차서의 봇 지침으로 정한다. 조건을 등급마다 다르게 두면 판별이 복잡해진다. / 버린 대안: 재판정 3회 이상이나 반박 2회 뒤에만 인정하기.
- 결정: 위험도 high. / 이유: 병합 관문(차단 지적을 누가 닫을 수 있는가)을 바꾸는 권한 결정이다(절차서 1절의 기준: 보안·인증).
- 결정: 대상에서 동결된 P1(`deferred`)과 P2·P3을 뺀다. / 이유: 병합을 막지 않는다.

## 발견 사항

- runner의 교착 보고(Issue에 올리는 A/B/C 선택지)에는 제작자 승인이 선택지로 없다. P0에도 지금 없다. → 처리: 해당 없음(제작자에게 보고한다. 이 계획의 범위 밖이다)
- 이 변경 뒤에는 열린 P1이 있는 모든 판정 실행이 PR 댓글의 편집 이력을 GraphQL로 읽는다(전에는 열린 P0이 있을 때만). 읽지 못하면 `review-ledger`가 `error`로 남는다. 닫힌 쪽이지만 GraphQL 장애에 걸리는 PR이 늘어난다. → 처리: 해당 없음(설계서 10.2절 (4)에 이미 적힌 닫힌 쪽 동작이다. 문제가 실제로 나오면 그때 다룬다)
- `scripts/test/record.test.ts`의 가짜 서버처럼 `/graphql`을 모르는 호출 환경에서는 열린 P1이 있는 원장의 기록이 `error`가 된다(닫힌 쪽). 실제 판정 워크플로는 원장 토큰으로 GraphQL을 읽으므로 해당하지 않는다. 계획을 쓸 때 "열린 P1이 있는 모든 실행이 편집 이력을 읽는다"는 것은 적었지만, 있던 테스트 가운데 그 요청을 모르는 가짜 서버가 있는지는 확인하지 않았다. → 처리: #178(이 계획의 step0에 더해 고쳤다. 진행 로그)
- 계획 검증 4라운드의 F5(P2, 미룸): `record.test.ts`에 줄을 더하기만 했는지 보는 AC(`grep -c '^-[^-]'`)가 빈 줄 삭제를 세지 않는다. → 처리: 해당 없음(이 PR에서는 `git diff --numstat`으로 삭제 0줄을 따로 확인했다. AC를 고치면 계획 승인이 무효가 돼 고치지 않았다)

## 열린 질문

- 없음. 방법은 제작자가 정했다(의사결정 로그).

## 검증 방법과 결과

- step0의 AC: 테스트 일곱 파일(`record.test.ts` 포함), `test-effect`, 판별 문구, 범위 밖 파일이 바뀌지 않았는지, `ledger.ts`·`accept-load.ts`는 주석만 바뀌었는지, 문서 다섯 곳, `node scripts/harness.ts check`.
- 결과(2026-11-21): step0의 AC 16줄 통과(테스트 일곱 파일 107개, `test-effect`, `check` 포함. 전체 테스트 통과). `node scripts/harness.ts plan-gate` 통과.

## 다음 할 일

- step0은 PR #179에서 코드 판정을 기다린다.
- 위험도 high라 초안으로 두고, 완료 처리·기록·main 병합·`check`가 끝난 뒤 `node scripts/harness.ts pr-ready`로 제작자 head 승인을 한 번 요청한다.
- 병합되면 PR #171로 돌아간다: worktree `feat/20261121-actions-cost-design-s0`에서 `origin/main`을 병합해 push하고(올리지 않은 기록 커밋 하나가 로컬에 있다), 제작자에게 PR #171에 `/harness accept F28` 댓글을 요청한다. 다음 판정에서 반영되면 `pr-ready`.
