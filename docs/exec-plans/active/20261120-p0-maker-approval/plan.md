---
id: 20261120-p0-maker-approval
issue: 150 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-20T12:19:52+09:00 # new-task가 채운다
---

# P0 지적을 제작자 승인으로 닫는 경로가 설계서에만 있고 원장 코드에는 없다

## 목표와 수용 기준

설계서 10.2절 (4)와 원칙 B11은 P0 지적을 닫는 근거로 "두 검증자의 동의"와 "제작자 승인" 둘을 든다. 원장 코드(`scripts/ci/ledger.ts`)에는 앞의 것만 있다. 그래서 검증자 하나가 P0을 거두지 않으면 제작자가 남은 위험을 받아들이기로 해도 `review-ledger`가 통과하지 않는다(PR #149의 F6에서 드러났다. 제작자의 PR 댓글을 반박의 근거로 인용했지만 검증자는 "허용된 입력에서 확인할 수 없다"며 받아들이지 않았다).

제작자 계정이 PR에 단 정해진 한 줄 댓글을 기계가 확인해 그 P0 지적을 닫는 경로를 만든다. 검증자(LLM)의 판단을 거치지 않으므로 B11("LLM은 차단을 풀 수 없다")과 맞는다.

수용 기준:

1. 제작자 계정(`github.owner`)이 PR에 단 댓글에 앞뒤 공백을 뺀 줄 `/harness accept F<번호>`가 있고, 그 댓글이 한 번도 고쳐지지 않았으며(REST `created_at`과 `updated_at`이 같다), 그 지적이 원장에서 `open`인 P0이고, 댓글이 그 지적이 열린 시각보다 뒤에 달렸으면, 원장에서 그 지적의 상태가 `accepted`가 된다.
2. `accepted`인 지적은 `review-ledger`를 막지 않는다. 상태 설명에 그 수가 나온다.
3. 아래 댓글은 승인으로 보지 않는다(지적은 `open`으로 남는다): 다른 계정(봇, PR 작성자, 검증 App)의 댓글, 고쳐진 댓글(누가 고쳤든), 시각을 읽을 수 없는 댓글, 코드 블록·인용 안의 줄, 줄의 일부만 일치하는 글, 원장에 없는 ID, P1~P3 지적, `open`이 아닌 지적, 지적이 열린 시각과 같거나 그보다 앞선 댓글.
4. 승인 댓글이 지워지거나 고쳐지면 다음 기록에서 그 지적은 `open`으로 돌아간다(철회).
5. `accepted`인 지적은 검증자의 판정(`resolutions`, 같은 지적의 재등록)으로 상태가 바뀌지 않는다. 검증자가 새 지적(다른 위치나 제목)을 내면 새 ID로 등록되고 그 P0은 다시 막는다(B11: 검증자는 차단을 더할 수 있다).
6. 판정 job에 넘기는 원장(plan job이 읽은 것)에도 같은 규칙이 적용돼, 승인 뒤의 첫 판정에서 검증자가 그 지적을 `accepted`로 본다.
7. 워크플로 파일(`.github/workflows/`)을 고치지 않고 동작한다. 승인은 그 뒤의 첫 판정 실행(새 head의 `check` 통과 뒤, 또는 판정 워크플로 재실행)에서 원장에 반영된다.
8. 설계서 10.2절 (4), `scripts/cross-review/ledger.md`, 절차서 8절 "교착"이 구현과 같은 내용을 적는다.

## 범위 / 비범위

범위:

- 승인 댓글의 판별과 원장 반영(`scripts/ci/`), 새 상태 `accepted`, 지적이 열린 시각(`openedAt`) 기록.
- plan job·기록 job·`plan-gate`가 원장을 읽는 공통 경로(`ledgerFromComments`)에 반영.
- 검증자 프롬프트의 라운드 규칙에 `accepted`를 다루는 한 줄, 수렴 판정(`scripts/runner/divergence.ts`)의 해소 셈에 `accepted`.
- 문서: 설계서 10.2절 (4)와 0절·`CHANGELOG`, `scripts/cross-review/ledger.md`, 절차서 8절.

비범위:

- P1 지적의 제작자 수용. 설계서가 제작자 승인을 둔 것은 P0뿐이다. P1의 교착은 지금 절차(절차서 8절: 고친다 / 범위를 줄인다 / 포기)를 그대로 쓴다.
- 워크플로 변경(댓글이 달릴 때 바로 원장을 다시 기록하는 트리거). 승인이 다음 판정 실행에 반영되는 것으로 충분하고, 워크플로 변경은 제작자가 직접 커밋해야 하는 절차(`docs/SECURITY.md`)라 필요해지면 별도 Issue로 한다.
- 승인을 head SHA에 묶는 일. 이유는 의사결정 로그.
- `review/*` 상태의 계산(`scripts/ci/verdict.ts`). 검증자가 승인된 지적을 판정의 `findings`에 다시 적으면 그 판정은 지금처럼 수정 요청이 된다.
- 지표 집계(`scripts/metrics/`). `accepted`는 `rejected`(지적이 틀렸다)와 뜻이 달라 기존 집계에 넣지 않는다. 지표에 따로 셀지는 그 계획(Issue #146)에서 정한다.
- PR #149의 F6에 실제로 승인을 받는 일. 이 계획이 병합된 뒤 그 PR에서 한다.

## 관련 파일·문서

- `scripts/ci/owner-accept.ts`(새 파일), `scripts/ci/ledger.ts`, `scripts/ci/ledger-store.ts`
- `scripts/harness.ts`(원장을 읽는 네 곳에 제작자 계정을 넘기고 로그 줄을 더한다: `review-plan`, `record-review`, `plan-gate`, `ledger-ci-failure`)
- `scripts/runner/divergence.ts`, `scripts/runner/ledger-read.ts`
- `scripts/cross-review/prompt.md`, `scripts/cross-review/prompt-codex.md`, `scripts/cross-review/ledger.md`
- `scripts/test/owner-accept.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/ledger-store-accept.test.ts`(새 파일), `scripts/test/divergence.test.ts`
- `docs/harness/design.md`(0절 버전 이력, 10.2절 (4)), `docs/harness/CHANGELOG.md`, `docs/harness/workflow.md`(8절), `docs/harness/architecture.md`(파일 표)
- `docs/exec-plans/active/20261120-p0-maker-approval/`

## step 목록

- step0 accept-ledger: 승인 댓글 판별(`owner-accept.ts`)과 원장의 `accepted` 상태·`openedAt`(순수 함수와 테스트). 아직 CI 경로에 잇지 않는다.
- step1 accept-wire: 원장을 읽고 쓰는 경로에 잇고, 프롬프트·수렴 판정·문서를 맞춘다.

## 진행 로그

- 2026-11-20T12:19:52+09:00 접수(Issue #150). 제작자가 대화에서 PR #149 step3의 다음 방식으로 "이 Issue를 먼저 구현한다"를 골랐다(경위. 그 계획의 열린 질문 Q-정리).
- 2026-11-20 계획 작성. 읽은 것: `scripts/ci/ledger.ts`·`ledger-store.ts`·`record.ts`·`verdict.ts`·`rebuttal.ts`, `scripts/harness.ts`의 `review-plan`·`record-review`, `scripts/runner/next.ts`의 `/harness accept`(봇 Issue 승인) 선례, `.github/workflows/judge-codex.yml`의 plan·record job, 설계서 10.2절, `scripts/cross-review/prompt.md`.

## 의사결정 로그

- 결정: 새 상태 `accepted`를 둔다(`rejected`를 쓰지 않는다). / 이유: `rejected`는 "지적이 틀렸다"이고 제작자 승인은 "지적은 맞지만 남은 위험을 받아들인다"라 뜻이 다르다. 프롬프트의 라운드 규칙은 검증자에게 자기 지적 중 `open`·`fixed`·`rejected`인 것을 매 라운드 다시 판정하라고 하므로, `rejected`로 두면 검증자가 매번 `open`으로 되돌린다. `accepted`는 `deferred`처럼 판정으로 바뀌지 않는 상태로 둔다. / 버린 대안: `rejected` + 표시 필드(판정 뒤에 매번 다시 덮어써야 하고 원장의 표에서 구분되지 않는다).
- 결정: 댓글의 신뢰는 REST 값만으로 본다: 작성자가 제작자이고 `created_at`과 `updated_at`이 같다(한 번도 고쳐지지 않았다). / 이유: 쓰기 권한 계정(봇)은 남의 댓글을 고칠 수 있다(TD-26). 고친 계정을 가리려면 GraphQL 편집 이력이 필요한데, plan job의 읽기 도구는 GET만 하고 두 job 모두 이미 REST로 댓글 목록을 읽는다. 고쳐진 댓글을 모두 거부하면 편집 이력 없이도 안전한 쪽으로 틀린다(제작자가 자기 댓글을 고쳐도 거부되고, 새 댓글을 달면 된다). TD-26의 행도 이 방법(REST `updated_at`)을 선택지로 적었다. 확인한 것: 이 리포의 댓글 둘(봇이 고친 `7027181840`은 두 시각이 다르고, 고치지 않은 `7027568658`은 같다).
- 결정: 승인을 지적 ID에 묶고 head SHA에는 묶지 않는다. / 이유: 승인은 다음 판정 실행에서 반영되는데 그 실행은 대개 새 head에서 돈다. head에 묶으면 반영되는 순간 무효가 된다. 승인 뒤에 코드가 바뀌어 검증자가 다른 문제를 보면 새 ID의 지적으로 등록돼 다시 막는다. 위험도 높음 PR은 `risk-gate`가 제작자의 head 승인을 따로 요구한다. / 버린 대안: 줄에 head SHA를 함께 적게 한다(워크플로 재실행으로만 반영할 수 있고, 완료 처리 커밋이나 main 병합마다 다시 받아야 한다).
- 결정: 승인 댓글은 지적이 열린 시각보다 뒤에 달린 것만 인정한다(`openedAt`). 이 필드가 없는 기존 지적은 새 코드가 처음 원장을 쓸 때 그 시각으로 채운다. / 이유: 지적 번호는 차례로 붙으므로, 아직 없는 번호를 미리 승인한 댓글이 나중에 등록될 P0을 닫으면 안 된다. 기존 지적(PR #149의 F6)은 이 계획이 병합된 뒤 첫 판정이 지나고 단 댓글로 승인받는다(한 번 더 기다리는 대신 예외 경로를 두지 않는다).
- 결정: 승인은 저장된 상태가 아니라 댓글에서 매번 다시 계산한다(원장을 읽는 공통 경로에서). / 이유: 철회(댓글 삭제·수정)가 따로 코드 없이 반영되고, plan job과 기록 job이 같은 결과를 본다.
- 결정: step을 둘로 나눈다(순수 함수 → 연결). / 이유: 관문을 바꾸는 코드라 판정이 좁은 범위를 보게 한다. step0은 CI 경로에 이어지지 않아 병합돼도 동작이 바뀌지 않는다.

## 발견 사항

- `review/*` 상태는 원장과 따로 계산된다(`verdictStatus`: 판정이 `approve`이고 그 판정의 `findings`에 P0·P1이 없어야 success). 원장에서 P0을 닫아도 검증자가 같은 문제를 계속 수정 요청으로 내면 `review/<검증자>`가 실패로 남는다. 그래서 수용 기준 6(판정 전에 원장에 반영해 검증자가 `accepted`를 보게 한다)이 필요하다. 그래도 검증자가 새 지적으로 다시 내는 것은 기계로 막지 않는다(B11). → 처리: 해당 없음(범위/비범위와 수용 기준 5·6에 반영했다)
- 프롬프트는 PR의 1라운드 base 버전으로 고정된다(10.2절 (2)). 이 계획이 프롬프트에 더하는 줄은 병합 뒤에 열린 PR부터 적용된다. 이미 열린 PR(#149)의 검증자는 옛 프롬프트로 `accepted`를 본다. 옛 규칙도 다시 판정할 상태를 `open`·`fixed`·`rejected`로 한정하고 원장에 있는 지적을 다시 적지 말라고 하므로 같은 방향이다. → 처리: 해당 없음(동작을 바꿀 수 없는 제약이다. 원장의 처리 칸에 "제작자 승인"을 적어 옛 프롬프트의 검증자도 읽게 한다)

## 열린 질문

없다. 제작자가 정한 것(이 Issue를 먼저 구현한다)과 설계서 10.2절이 이미 정한 것(P0, 제작자 승인) 안에서 구현 방식만 정했다(의사결정 로그).

## 검증 방법과 결과

- step마다 AC 명령(step 파일)과 `node scripts/harness.ts check`.
- 수용 기준 1~5는 `scripts/test/owner-accept.test.ts`·`ledger-accept.test.ts`(step0), 6·7은 `scripts/test/ledger-store-accept.test.ts`(step1: 댓글 목록 → 읽은 원장, 기록 뒤 저장된 원장과 `review-ledger` 상태), 8은 step1의 `grep` AC와 `doc-lint`로 확인한다.
- 병합 뒤 확인(이 계획의 PR 밖): PR #149에서 제작자가 F6에 승인 댓글을 단 뒤의 판정 실행에서 원장의 F6이 `accepted`가 되고 `review-ledger`가 그 지적 때문에 실패하지 않는 것을 본다. 결과는 그 계획의 진행 로그에 적는다.

## 다음 할 일

1. 계획만 담은 커밋을 push하고 초안 PR을 열어 계획 검증(G1)을 받는다.
2. 승인 뒤 step0을 구현한다(TDD). `check` → `complete-step` → push. 두 검증자가 승인하면 `pr-ready`로 한 번만 승인을 요청한다(위험도 높음).
3. step0 병합 뒤 `new-task --plan 20261120-p0-maker-approval --step 1`로 step1을 한다. 설계서·`CHANGELOG`를 고치는 PR이므로 다른 세션의 PR(#151)·PR #149와 버전 번호 순서를 맞춘다(먼저 병합되는 쪽이 다음 번호).
4. step1 병합 뒤 PR #149를 `origin/main`으로 갱신하고, 판정이 한 번 돈 뒤 제작자에게 F6의 승인 댓글(`/harness accept F6`)을 요청한다.
