---
id: 20261121-owner-accept-p1
issue: 178 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
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
3. P2·P3과, `deferred`·`fixed`·`rejected`인 P1은 대상이 아니다. 반영하지 않은 이유가 고정된 문구로 로그에 남는다.
4. `accepted`인 P1은 검증자의 판정으로 바뀌지 않고, 승인 댓글이 없어지면 `open`으로 돌아가 다시 막는다. 검증자가 다른 위치나 제목으로 낸 새 지적은 새 ID로 다시 막는다(P0의 지금 동작과 같다).
5. P0에 대한 지금의 동작은 바뀌지 않는다(있던 P0 테스트가 그대로 통과한다).
6. 설계서 10.2절 (4), 절차서 8절, 원장 형식 문서(`scripts/cross-review/ledger.md`), `docs/harness/architecture.md`의 `ci/*` 행이 "제작자 승인은 P0·P1"이라고 같은 말을 한다. 설계서의 버전이 오르고 변경 기록과 `CHANGELOG`에 한 줄이 있다. `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- `scripts/ci/owner-accept.ts`의 판별 두 곳(`refusal`, `needsAccepts`)과 주석. `scripts/ci/accept-load.ts`·`scripts/ci/ledger.ts`의 주석.
- 테스트: `scripts/test/owner-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/ledger.test.ts`.
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
- `scripts/test/owner-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/ledger.test.ts`
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, `scripts/cross-review/ledger.md`
- 읽기만: `scripts/ci/ledger-store.ts`, `scripts/cross-review/prompt.md`, `scripts/ci/rebuttal.ts`, `scripts/test/ledger-store.test.ts`

## step 목록

- step0 p1-accept: 제작자 승인의 대상을 열린 P0·P1로 넓히고(판별 두 곳), 테스트와 문서를 맞춘다.

## 진행 로그

- 2026-11-21 계획 작성. 출처: PR #171의 F28 교착(재판정 4회)에서 제작자가 "하네스를 먼저 고친다"를 골랐다(대화). 봇이 Issue #178을 등록했다.

## 의사결정 로그

- 결정(제작자, 2026-11-21 대화): `/harness accept`를 P1까지 넓힌다. / 이유: 검증자(LLM)를 거치지 않아 결과가 확정적이고, 봇은 쓸 수 없으며, 변경이 작다. / 버린 대안: 제작자 계정의 PR 댓글을 검증자 입력에 넣기(자유 글이 검증자에게 가는 길이 생기고, 닫힐지는 여전히 검증자에 달려 있다).
- 결정: P1의 승인 조건을 P0과 똑같이 둔다(교착이나 재판정 횟수를 코드로 요구하지 않는다). / 이유: P0에도 그런 조건이 없다. 승인하는 것은 제작자뿐이고, 언제 권할지는 절차서의 봇 지침으로 정한다. 조건을 등급마다 다르게 두면 판별이 복잡해진다. / 버린 대안: 재판정 3회 이상이나 반박 2회 뒤에만 인정하기.
- 결정: 위험도 high. / 이유: 병합 관문(차단 지적을 누가 닫을 수 있는가)을 바꾸는 권한 결정이다(절차서 1절의 기준: 보안·인증).
- 결정: 대상에서 동결된 P1(`deferred`)과 P2·P3을 뺀다. / 이유: 병합을 막지 않는다.

## 발견 사항

- runner의 교착 보고(Issue에 올리는 A/B/C 선택지)에는 제작자 승인이 선택지로 없다. P0에도 지금 없다. → 처리: 해당 없음(제작자에게 보고한다. 이 계획의 범위 밖이다)
- 이 변경 뒤에는 열린 P1이 있는 모든 판정 실행이 PR 댓글의 편집 이력을 GraphQL로 읽는다(전에는 열린 P0이 있을 때만). 읽지 못하면 `review-ledger`가 `error`로 남는다. 닫힌 쪽이지만 GraphQL 장애에 걸리는 PR이 늘어난다. → 처리: 해당 없음(설계서 10.2절 (4)에 이미 적힌 닫힌 쪽 동작이다. 문제가 실제로 나오면 그때 다룬다)

## 열린 질문

- 없음. 방법은 제작자가 정했다(의사결정 로그).

## 검증 방법과 결과

- step0의 AC: 테스트 여섯 파일, 판별 문구, 범위 밖 파일이 바뀌지 않았는지, `ledger.ts`·`accept-load.ts`는 주석만 바뀌었는지, 문서 다섯 곳, `node scripts/harness.ts check`.
- 결과: (step0 실행 뒤 적는다)

## 다음 할 일

- 계획만 담은 커밋을 올려 초안 PR을 열고 계획 검증(G1)을 받는다. 승인되면 step0을 TDD로 구현해 같은 PR에 올린다.
- 위험도 high라 초안으로 두고, 완료 처리·기록·main 병합·`check`가 끝난 뒤 `node scripts/harness.ts pr-ready`로 제작자 head 승인을 한 번 요청한다.
- 병합되면 PR #171로 돌아간다: worktree `feat/20261121-actions-cost-design-s0`에서 `origin/main`을 병합해 push하고(올리지 않은 기록 커밋 하나가 로컬에 있다), 제작자에게 PR #171에 `/harness accept F28` 댓글을 요청한다. 다음 판정에서 반영되면 `pr-ready`.
