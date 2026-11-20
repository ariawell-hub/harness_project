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

1. 아래가 모두 맞으면 원장에서 그 지적의 상태가 `accepted`가 된다.
   - 제작자 계정(`github.owner`)이 PR에 단 댓글이다.
   - 댓글 본문이 승인 줄만으로 이뤄져 있다: 빈 줄을 뺀 모든 줄이 들여쓰기 없이 `/harness accept F<번호>`다.
   - 댓글이 한 번도 고쳐지지 않았다. GitHub의 편집 이력(GraphQL `lastEditedAt`·`editor`·`userContentEdits`)으로 확인한다. 이력을 확인하지 못한 댓글은 고쳐진 것으로 본다.
   - 그 지적이 원장에서 `open`인 P0이다.
   - 댓글이 그 지적이 `open`으로 **원장 댓글에 게시된 시각**보다 엄격히 뒤에 달렸다. 이 시각은 한 번 기록되면 그 지적이 열려 있는 동안 바뀌지 않는다: 게시 뒤에 단 승인은 그 사이에 원장이 다른 이유(다른 검증자의 기록, `check` 실패 기록)로 다시 저장돼도 다음 기록에서 반영된다.
2. `accepted`인 지적은 `review-ledger`를 막지 않는다. 상태 설명에 그 수가 나온다.
3. 아래 댓글은 승인으로 보지 않는다(지적은 `open`으로 남는다): 다른 계정(봇, PR 작성자, 검증 App)의 댓글, 고쳐진 댓글(누가 고쳤든. 작성 시각과 수정 시각이 초 단위로 같아도 편집 이력이 있으면 고쳐진 것이다), 편집 이력을 확인하지 못한 댓글, 승인 줄 말고 다른 글이 한 줄이라도 있는 댓글(설명, 인용, 코드 블록, 목록, HTML 주석 포함), 들여쓴 승인 줄, 원장에 없는 ID, P1~P3 지적, `open`이 아닌 지적, 지적이 게시된 시각과 같거나 그보다 앞선 댓글, 게시 시각을 아직 모르는 지적(이번 실행에서 등록되거나 다시 열린 지적)에 대한 댓글.
4. 승인 댓글이 지워지거나 고쳐지면 다음 기록에서 그 지적은 `open`으로 돌아간다(철회).
5. `accepted`인 지적은 검증자의 판정(`resolutions`, 같은 지적의 재등록)으로 상태가 바뀌지 않는다. 검증자가 새 지적(다른 위치나 제목)을 내면 새 ID로 등록되고 그 P0은 다시 막는다(B11: 검증자는 차단을 더할 수 있다).
6. 판정 job에 넘기는 원장(plan job의 `review-plan`이 읽어 job 출력으로 내는 것)에도 같은 규칙이 적용돼, 승인 뒤의 첫 판정에서 검증자가 그 지적을 `accepted`로 본다. 실제 명령(`review-plan`, `record-review`)을 가짜 API 서버로 구동해 확인한다.
7. 워크플로 파일(`.github/workflows/`)을 고치지 않고 동작한다. 승인은 그 뒤의 첫 판정 실행(새 head의 `check` 통과 뒤, 또는 판정 워크플로 재실행)에서 원장에 반영된다.
8. 기록 job이 편집 이력을 읽지 못하면(요청 실패, 목록의 끝을 확인하지 못함) 원장을 쓰지 않고 `review-ledger`를 `error`로 남긴다(fail-closed). 열린 P0도 `accepted`인 지적도 없는 원장에서는 편집 이력을 읽지 않는다. 편집 이력 요청의 응답 본문과 GitHub이 준 오류 문구는 로그·상태 설명·예외 메시지에 넣지 않는다(HTTP 상태 코드와 고정된 문구만 쓴다).
9. 설계서 10.2절 (4), `scripts/cross-review/ledger.md`, 절차서 8절 "교착"이 구현과 같은 내용을 적는다.

## 범위 / 비범위

범위:

- 승인 댓글의 판별과 원장 반영(`scripts/ci/`), 새 상태 `accepted`, 지적이 `open`으로 게시된 시각(`openedAt`) 기록, PR 댓글의 편집 이력 읽기(GraphQL).
- plan job과 기록 job이 원장을 읽는 경로에 반영(같은 함수를 쓴다).
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

- `scripts/ci/owner-accept.ts`·`scripts/ci/accept-load.ts`(새 파일), `scripts/ci/ledger.ts`, `scripts/ci/ledger-store.ts`, `scripts/ci/pr.ts`(GraphQL 요청 함수)
- `scripts/harness.ts`(`review-plan`·`record-review`가 새 함수를 부르고 로그 줄을 더한다)
- `scripts/runner/divergence.ts`, `scripts/runner/ledger-read.ts`
- `scripts/cross-review/prompt.md`, `scripts/cross-review/prompt-codex.md`, `scripts/cross-review/ledger.md`
- `scripts/test/owner-accept.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`(새 파일), `scripts/test/divergence.test.ts`
- `docs/harness/design.md`(0절 버전 이력, 10.2절 (4)), `docs/harness/CHANGELOG.md`, `docs/harness/workflow.md`(8절), `docs/harness/architecture.md`(파일 표)
- `docs/exec-plans/active/20261120-p0-maker-approval/`

## step 목록

- step0 accept-ledger: 승인 댓글 판별(`owner-accept.ts`)과 원장의 `accepted` 상태·`openedAt`(순수 함수와 테스트). 아직 CI 경로에 잇지 않는다.
- step1 accept-wire: 편집 이력 읽기와 게시 시각 기록을 더해 원장을 읽고 쓰는 경로에 잇고, 프롬프트·수렴 판정·문서를 맞춘다.

## 진행 로그

- 2026-11-20T12:19:52+09:00 접수(Issue #150). 제작자가 대화에서 PR #149 step3의 다음 방식으로 "이 Issue를 먼저 구현한다"를 골랐다(경위. 그 계획의 열린 질문 Q-정리).
- 2026-11-20 계획 작성. 읽은 것: `scripts/ci/ledger.ts`·`ledger-store.ts`·`record.ts`·`verdict.ts`·`rebuttal.ts`, `scripts/harness.ts`의 `review-plan`·`record-review`, `scripts/runner/next.ts`의 `/harness accept`(봇 Issue 승인) 선례, `.github/workflows/judge-codex.yml`의 plan·record job, 설계서 10.2절, `scripts/cross-review/prompt.md`.
- 2026-11-20 계획 검증 1라운드(PR #152, head `ed78d7d`): `review/claude` 승인, `review/codex` 수정 요청(P0 1, P1 3). 넷 다 받아들여 계획을 고쳤다.
  - F1(P0): REST의 작성·수정 시각은 초 단위라, 댓글이 달린 그 초 안에 쓰기 권한 계정이 고치면 두 시각이 같다. → 편집 여부를 GraphQL 편집 이력으로 본다(수용 기준 1·3·8). 확인한 것: PR #149의 댓글 넷을 봇 토큰으로 조회하니 고치지 않은 제작자 댓글은 `lastEditedAt` null·`editor` null·`userContentEdits.totalCount` 0이고, 고친 댓글은 셋 다 값이 있었다.
  - F2(P1): 네 칸 들여쓴 코드 블록이나 목록 안 펜스의 줄을 승인으로 읽을 수 있다. → 마크다운 문맥을 가리려 하지 않고, 본문이 승인 줄만으로 이뤄진 댓글만 인정한다(수용 기준 1·3).
  - F3(P1): 기록 job의 시계로 적은 시각과 원장이 실제로 게시되는 시각 사이에 단 댓글이 아직 보이지 않는 지적을 닫을 수 있다. → 기준 시각을 원장 댓글이 실제로 저장된 시각(GitHub이 주는 원장 댓글의 `updated_at`)으로 바꾼다. 지적을 등록하거나 다시 여는 실행은 시각을 적지 않고, 그 뒤에 원장을 읽는 실행이 채운다(수용 기준 1·3).
  - F4(P1): 함수만 부르는 테스트는 `review-plan` 호출부에서 제작자 계정을 빠뜨려도 통과한다. → 실제 명령을 가짜 API 서버로 구동하는 테스트를 AC에 넣는다(수용 기준 6, `scripts/test/record.test.ts`가 같은 방식이다).
- 2026-11-20 계획 검증 2라운드(head `a212535`): `review/codex` 수정 요청(P1 2). 1라운드의 F1~F4는 고쳐졌다고 판정됐다. `review/claude`는 판정 job이 실패해 `error`였다(판정 없음. 다음 push에서 다시 돈다).
  - F5(P1): 게시 → 승인 댓글 → 다른 원장 수정 → 다음 실행의 순서에서 승인이 거부될 수 있다는 지적. 계획의 의도는 "원장을 저장하는 모든 경로가 읽을 때 채운 게시 시각을 함께 저장하므로 한 번 채워진 시각은 늦춰지지 않는다"였는데 step1이 이를 규칙과 테스트로 적지 않았다. → 수용 기준 1에 불변식을 적고, step1에 그 순서의 테스트(다른 검증자의 기록, `check` 실패 기록이 사이에 낀 경우)와 남는 보수적 경우(아직 시각이 채워지지 않은 지적은 그 실행에서 승인받지 못한다)를 적었다.
  - F6(P1): GraphQL 오류 응답에 댓글 본문이 함께 올 수 있는데 계획은 응답 본문 300자를 오류 메시지에 넣게 했다. → 응답 본문과 원시 오류 문구를 예외·로그·상태 설명에서 뺀다(수용 기준 8). 식별할 수 있는 문구가 든 오류 응답으로 두 명령의 출력과 상태 설명을 검사한다.
- 2026-11-20 계획 검증 3라운드(head `b691d07`): 두 검증자 승인. 원장에 `계획 검증(G1): 해시 90c0ac38fd3e · 승인: claude, codex`. 지적 여섯(F1~F6)은 모두 `fixed`다.
- 2026-11-20 step0 구현(TDD).
  - 실패 확인: 구현 전에 `scripts/test/owner-accept.test.ts`는 모듈이 없어 실패했고(통과 0), `scripts/test/ledger-accept.test.ts`는 8개 중 4개가 실패했다(`accepted`가 든 원장의 왕복, `ledgerStatus`, `accepted`가 판정으로 바뀌지 않는 것, 다시 열릴 때 `openedAt`을 지우는 것).
  - 구현 뒤: `owner-accept.test.ts` 14개, `ledger-accept.test.ts` 8개 통과. 기존 `ledger.test.ts` 18개, `ledger-store.test.ts` 12개는 고치지 않고 통과한다.
  - 테스트를 한 곳 고쳤다(구현이 아니라 테스트가 틀렸다): 원장 표의 셀은 괄호를 문자 참조(`&#40;`)로 바꾸는데 단언이 괄호 그대로를 기대했다.
- 2026-11-20T13:05:31+09:00 step0 재작업: harness-guard 실패: CHANGELOG 한 줄과 PR 본문의 보호 경로 체크 줄이 빠졌다
  - 구현 판정(head `d2b5c8b`): 두 검증자 승인(지적 없음). `harness-guard`는 실패했다: 보호 경로를 바꿨는데 `docs/harness/CHANGELOG.md`가 그대로이고 PR 본문에 보호 경로 체크 줄이 없었다(내가 빠뜨렸다. 로컬 `check`는 이 둘을 보지 않는다). `CHANGELOG`에 한 줄을 더하고 PR 본문에 체크 줄을 넣었다. 설계서는 step1에서 고치므로 이 줄에는 설계서 버전을 적지 않았다.
  - 그 줄을 파일 맨 끝(옛 버전 0.1.0 구역)에 붙인 것을 push 뒤에 알아채 "다음 버전 (미배포)" 구역의 끝으로 옮겼다(head `e03feba`의 판정은 이 잘못된 위치를 본 것이다).
- 2026-11-20T13:08:41+09:00 step0 재작업: CHANGELOG 줄을 옛 버전 구역에 넣었다: 다음 버전 구역으로 옮긴다

## 의사결정 로그

- 결정: 새 상태 `accepted`를 둔다(`rejected`를 쓰지 않는다). / 이유: `rejected`는 "지적이 틀렸다"이고 제작자 승인은 "지적은 맞지만 남은 위험을 받아들인다"라 뜻이 다르다. 프롬프트의 라운드 규칙은 검증자에게 자기 지적 중 `open`·`fixed`·`rejected`인 것을 매 라운드 다시 판정하라고 하므로, `rejected`로 두면 검증자가 매번 `open`으로 되돌린다. `accepted`는 `deferred`처럼 판정으로 바뀌지 않는 상태로 둔다. / 버린 대안: `rejected` + 표시 필드(판정 뒤에 매번 다시 덮어써야 하고 원장의 표에서 구분되지 않는다).
- 결정: 댓글의 편집 여부는 GraphQL 편집 이력으로 본다(`lastEditedAt`과 `editor`가 null이고 `userContentEdits.totalCount`가 0). 고쳐진 댓글은 누가 고쳤든 거부한다. / 이유: 쓰기 권한 계정(봇)은 남의 댓글을 고칠 수 있다(TD-26). 고친 계정을 가려 제작자의 편집만 인정하는 것(`scripts/runner/next.ts`의 `ownerCommentRejection`)보다 좁혀서, 편집 기록의 일부가 지워진 경우를 따질 필요가 없게 한다(`lastEditedAt`은 기록이 지워져도 남는다). 제작자는 고치는 대신 새 댓글을 단다. / 버린 대안: REST의 `created_at` = `updated_at`(초 단위라 같은 초의 편집을 놓친다. 계획 검증 F1).
- 결정: 승인 댓글은 본문 전체가 승인 줄뿐이어야 한다. / 이유: 줄 하나가 GitHub에서 코드·인용·주석으로 보이는지를 가리려면 마크다운 해석기가 필요하다. 다른 글이 없는 댓글만 받으면 그 판단이 필요 없다. 제작자가 눈으로 보는 것과 기계가 읽는 것이 같아진다. / 버린 대안: 펜스 코드 블록만 건너뛰는 줄 판별(`hasAcceptLine`의 방식. 들여쓴 코드 블록과 목록 안 펜스를 놓친다. 계획 검증 F2).
- 결정: 편집 이력을 읽지 못하면 기록 job은 원장을 쓰지 않고 `review-ledger`를 `error`로 남긴다. plan job은 저장된 원장을 그대로 판정 job에 넘기고 로그에 적는다. / 이유: 관문(`review-ledger`)은 기록 job이 정하므로 거기서는 닫힌 쪽으로 틀린다. plan job이 읽은 것은 검증자가 보는 입력일 뿐이고, plan job의 토큰(`github.token`, pull-requests 읽기)으로 편집 이력을 읽을 수 있는지는 병합 뒤 실제 실행에서만 확인된다. 읽지 못한다고 판정 전체를 실패시키면 열린 P0이 있는 PR은 판정을 받지 못한다.
- 결정: 승인을 지적 ID에 묶고 head SHA에는 묶지 않는다. / 이유: 승인은 다음 판정 실행에서 반영되는데 그 실행은 대개 새 head에서 돈다. head에 묶으면 반영되는 순간 무효가 된다. 승인 뒤에 코드가 바뀌어 검증자가 다른 문제를 보면 새 ID의 지적으로 등록돼 다시 막는다. 위험도 높음 PR은 `risk-gate`가 제작자의 head 승인을 따로 요구한다. / 버린 대안: 줄에 head SHA를 함께 적게 한다(워크플로 재실행으로만 반영할 수 있고, 완료 처리 커밋이나 main 병합마다 다시 받아야 한다).
- 결정: 승인 댓글은 지적이 `open`으로 원장에 게시된 시각(`openedAt`)보다 엄격히 뒤에 달린 것만 인정한다. 이 시각은 원장 댓글의 `updated_at`(GitHub이 정한 마지막 저장 시각)에서 얻는다: 지적을 등록하거나 다시 여는 실행은 `openedAt` 없이 저장하고, 그 뒤 원장을 읽는 실행이 `openedAt`이 없는 열린 지적에 그때의 `updated_at`을 채운다. / 이유: 지적 번호는 차례로 붙으므로, 아직 게시되지 않은 번호를 미리 승인한 댓글이 나중에 등록될 P0을 닫으면 안 된다. 기록 job의 시계로 적으면 그 시각과 실제 게시 사이의 댓글이 통과한다(계획 검증 F3). 마지막 저장 시각은 그 지적이 게시된 시각보다 앞설 수 없으므로 늦는 쪽으로만 틀린다(그 사이에 단 승인은 무시되고 제작자가 다시 단다). 승인은 지적이 게시된 실행의 다음 실행에서 반영된다. 이 필드가 없는 기존 지적(PR #149의 F6·F8)도 같은 규칙으로 채워진다. 기록 job의 시계는 쓰지 않는다.
- 결정: 승인은 저장된 상태가 아니라 댓글에서 매번 다시 계산한다(plan job과 기록 job이 함께 쓰는 함수 `loadAccepted`에서). / 이유: 철회(댓글 삭제·수정)가 따로 코드 없이 반영되고, plan job과 기록 job이 같은 결과를 본다.
- 결정: step을 둘로 나눈다(순수 함수 → 연결). / 이유: 관문을 바꾸는 코드라 판정이 좁은 범위를 보게 한다. step0은 CI 경로에 이어지지 않아 병합돼도 동작이 바뀌지 않는다.
- 결정(step0): 승인 줄의 ID는 계획대로 `F[1-9]\d{0,5}`로 받는다. 원장의 지적 ID는 네 자리까지라(`RESOLUTION_ID_RE`) 더 긴 번호는 "원장에 없는 지적"으로 무시된다. / 이유: 줄 판별과 원장 조회를 따로 두면 줄 판별이 원장 형식에 묶이지 않는다.
- 결정(step0): 같은 지적의 승인이 같은 시각에 여럿이면 댓글 id가 큰 것을 쓴다. / 이유: 결과가 입력 순서에 따라 달라지지 않게 한다(어느 것을 써도 반영 여부는 같다).

## 발견 사항

- `review/*` 상태는 원장과 따로 계산된다(`verdictStatus`: 판정이 `approve`이고 그 판정의 `findings`에 P0·P1이 없어야 success). 원장에서 P0을 닫아도 검증자가 같은 문제를 계속 수정 요청으로 내면 `review/<검증자>`가 실패로 남는다. 그래서 수용 기준 6(판정 전에 원장에 반영해 검증자가 `accepted`를 보게 한다)이 필요하다. 그래도 검증자가 새 지적으로 다시 내는 것은 기계로 막지 않는다(B11). → 처리: 해당 없음(범위/비범위와 수용 기준 5·6에 반영했다)
- 프롬프트는 PR의 1라운드 base 버전으로 고정된다(10.2절 (2)). 이 계획이 프롬프트에 더하는 줄은 병합 뒤에 열린 PR부터 적용된다. 이미 열린 PR(#149)의 검증자는 옛 프롬프트로 `accepted`를 본다. 옛 규칙도 다시 판정할 상태를 `open`·`fixed`·`rejected`로 한정하고 원장에 있는 지적을 다시 적지 말라고 하므로 같은 방향이다. → 처리: 해당 없음(동작을 바꿀 수 없는 제약이다. 원장의 처리 칸에 "제작자 승인"을 적어 옛 프롬프트의 검증자도 읽게 한다)

## 열린 질문

없다. 제작자가 정한 것(이 Issue를 먼저 구현한다)과 설계서 10.2절이 이미 정한 것(P0, 제작자 승인) 안에서 구현 방식만 정했다(의사결정 로그).

## 검증 방법과 결과

- step마다 AC 명령(step 파일)과 `node scripts/harness.ts check`.
- 수용 기준 1~5는 `scripts/test/owner-accept.test.ts`·`ledger-accept.test.ts`(step0)와 `scripts/test/accept-load.test.ts`(step1: 게시 시각, 편집 이력), 6·7·8은 `scripts/test/accept-cli.test.ts`(step1: 실제 명령 `review-plan`·`record-review`를 가짜 API 서버로 구동해 job 출력의 원장, 저장된 원장 댓글, `review-ledger` 상태를 본다), 9는 step1의 `grep` AC와 `doc-lint`로 확인한다.
- 병합 뒤 확인(이 계획의 PR 밖): PR #149에서 제작자가 승인 댓글을 단 뒤의 판정 실행에서 (a) plan job 로그에 `review-plan: 제작자 승인 N건`이 나오고(plan job의 토큰으로 편집 이력을 읽을 수 있다), (b) 원장의 그 지적이 `accepted`가 되고 `review-ledger`가 그 지적 때문에 실패하지 않는 것을 본다. 결과는 그 계획의 진행 로그에 적는다.

## 다음 할 일

1. 계획 검증(G1)을 받는다(PR #152. 1라운드의 지적 넷을 반영해 다시 올렸다).
2. 승인 뒤 step0을 구현한다(TDD). `check` → `complete-step` → push. 두 검증자가 승인하면 `pr-ready`로 한 번만 승인을 요청한다(위험도 높음).
3. step0 병합 뒤 `new-task --plan 20261120-p0-maker-approval --step 1`로 step1을 한다. 설계서·`CHANGELOG`를 고치는 PR이므로 다른 세션의 PR(#151)·PR #149와 버전 번호 순서를 맞춘다(먼저 병합되는 쪽이 다음 번호).
4. step1 병합 뒤 PR #149를 `origin/main`으로 갱신하고, 판정이 한 번 돈 뒤(열린 P0에 게시 시각이 채워진다) 제작자에게 승인 댓글을 요청한다. 댓글에는 승인 줄만 적는다.
