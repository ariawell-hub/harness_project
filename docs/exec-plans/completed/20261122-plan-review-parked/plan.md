---
id: 20261122-plan-review-parked
issue: 212 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T21:10:49+09:00 # new-task가 채운다
---

# 계획만 남긴 PR에서 열린 코드 지적이 계획 검증(G1)을 막는다

## 목표와 수용 기준

코드를 올린 PR에서 계획을 고쳐야 하면(계획이 아직 main에 없는 PR) 되돌리는 커밋으로 PR의 변경을 계획만 남기고 계획 검증(G1)을 다시 받는다(절차서 2절). 그런데 그 전의 구현 판정에서 등록된 **코드에 대한 열린 지적**은 계획만 담은 head에서 닫힐 수 없다: 그 코드가 head에 없어 검증자가 고쳐졌는지 볼 수 없고, 검증자는 "내가 낸 지적 가운데 `open`으로 남는 P0·P1이 없을 때만 승인"하므로 계획을 승인하지 못한다. 계획 승인이 없으면 구현을 올릴 수 없고, 구현을 올리지 못하면 그 지적을 닫을 수 없다. PR #197에서 이 맞물림이 났다(F9·F10이 열린 채 계획만 남긴 head에서 Codex의 계획 승인이 나오지 않았고, 재판정마다 제작자에게 물어야 했다). Issue #212.

제작자가 방향을 정했다(2026-11-22 대화): 계획만 담은 head에서는 그 head가 담지 않은 코드에 대한 열린 지적을 **"구현 대기"**로 둔다. 닫지 않는다. 구현이 다시 올라온 head에서 자동으로 다시 열려 판정받고, 해소되지 않으면 병합을 막는다.

수용 기준:

1. 계획만 담은 head(`mode=plan`)의 판정에서, 계획 폴더(`docs/exec-plans/`) 밖 파일에 대한 `open` 지적은 원장 상태 `parked`(구현 대기)가 된다. 검증자가 받는 원장에도 `parked`로 보인다. 계획 전용 판정에서 등록된 지적과 계획 폴더 안 파일에 대한 지적은 `parked`가 되지 않는다(계획 검증이 판정할 대상이다)(테스트).
2. `parked`인 지적은 검증자의 판정(`resolutions`, 같은 지적의 재등록)으로 바뀌지 않고, 제작자 승인(`/harness accept`)과 반박의 대상이 아니다. runner는 그 지적에 붙은 대응을 성공으로도 실패로도 세지 않는다(`open`으로 돌아와 판정을 받은 뒤에 센다). 검증자가 그 지적을 판정하지 않고 승인하면 계획 승인(G1)이 기록된다(테스트).
3. 코드가 섞인 head(`mode=code`)의 기록은 제작자 승인을 조회하고 판정을 반영하기 **전에** `parked`를 모두 `open`으로 되돌린다(되돌아온 지적에 유효한 승인 댓글이 있으면 그 기록에서 `accepted`가 된다). 판정이 없는 기록(판정 실패, 승인 이어받기)에서도 되돌린다. 그래서 코드가 섞인 head에서 `parked`가 남은 채 `review-ledger`가 통과하는 일은 없고, 되돌아온 지적은 그 판정의 `resolutions`로 평소처럼 닫히거나 열린 채 병합을 막는다(테스트).
4. 계획만 담은 head에서 `parked`는 `review-ledger`를 막지 않는다(그 head에는 그 코드가 없다). 상태 설명에 수를 적는다(`구현 대기 N`)(테스트).
5. 원장 형식: 새 상태 `parked`와 지적의 새 선택 필드(계획 전용 판정에서 등록됐다는 표시)가 있는 원장과 없는 원장을 모두 읽고 쓴다. 모르는 상태와 모르는 필드는 지금처럼 거부한다(테스트).
6. `pr-state`가 구현 대기인 지적을 한 줄로 알린다(테스트).
7. 검증 프롬프트(`scripts/cross-review/prompt.md`), 원장 문서(`scripts/cross-review/ledger.md`), 설계서 10.2절, 절차서 2절에 규칙이 적힌다. 프롬프트 버전이 고정된(이미 열린) PR의 검증자를 위해 판정 입력의 원장 파일에 `parked`의 뜻이 한 줄 들어간다(테스트).
8. 워크플로 파일은 바꾸지 않는다(판정 워크플로가 이미 `mode`를 기록 job에 넘긴다). `node scripts/harness.ts check`와 `node scripts/harness.ts self-test` 통과.

## 범위 / 비범위

범위:

- `scripts/ci/ledger.ts`: 상태 `parked`, 지적의 선택 필드, 구현 대기로 두기·되돌리기 함수, 판정 반영(`applyVerdict`)과 `review-ledger` 판정(`ledgerStatus`), 원장 댓글의 표시와 형식 검사.
- `scripts/ci/ledger-store.ts`(기록 job이 `mode`에 따라 두거나 되돌린다), `scripts/ci/accept-load.ts`(plan job이 판정 job에 넘기는 원장에 같은 규칙을 반영한다), `scripts/ci/review-round.ts`(판정 입력의 원장 파일에 뜻 한 줄), `scripts/harness.ts`(두 명령이 `mode`를 넘긴다).
- `scripts/commands/pr-state.ts`: 구현 대기 지적을 알리는 줄.
- `scripts/runner/review.ts`: 대응한 뒤 닫힌 지적을 고르는 함수(`settledResponses`)가 `parked`를 닫힌 것으로 세지 않는다.
- `scripts/cross-review/prompt.md`, `scripts/cross-review/ledger.md`.
- 테스트(`scripts/test/**`).
- `docs/harness/design.md`(10.2절 상태 목록, 0절 버전 이력), `docs/harness/workflow.md`(2절), `docs/harness/CHANGELOG.md`.

비범위:

- 계획 수정의 길 자체(계획만 남기기, 계획만 담은 별도 PR)와 `plan-gate`. 이유: 제작자가 고른 방향은 지금의 길을 그대로 두고 원장만 고친다.
- runner의 그 밖의 지적 대응 코드(대응할 지적 고르기, 오래 열린 지적, 교착, 발산 판단 `divergence.ts`, 주 흐름 `run.ts`). 이유: 이 코드들은 `open`인 지적과 닫힌 상태만 세어 `parked`를 건드리지 않는다. 테스트로 확인하고, 고쳐야 할 것이 나오면 멈추고 계획을 고친다.
- 지적을 등록할 때의 상태를 정하는 규칙(2라운드부터의 동결 포함). 이유: 10.2절 (5)의 규칙이고 계획 전용 판정에도 지금 그대로 적용된다. 이 계획은 등록된 뒤의 `open` 지적만 다룬다.
- 워크플로 파일(`.github/workflows/**`). 이유: 봇이 고치지 않는다. 필요한 값(`mode`)은 이미 넘어온다.
- 제작자가 올린 워크플로 파일처럼 봇이 되돌릴 수 없는 변경이 있어 계획만 남길 수 없는 PR(PR #188의 F14가 그런 경우였다). 이유: 다른 문제다. 발견 사항에 적는다.

## 관련 파일·문서

- `scripts/ci/ledger.ts`, `scripts/ci/ledger-store.ts`, `scripts/ci/accept-load.ts`, `scripts/ci/review-round.ts`
- `scripts/harness.ts`
- `scripts/commands/pr-state.ts`
- `scripts/runner/review.ts`
- `scripts/cross-review/prompt.md`, `scripts/cross-review/ledger.md`
- `scripts/test/ledger.test.ts`, `scripts/test/ledger-store.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/pr-state.test.ts`, `scripts/test/runner-review.test.ts`, `scripts/test/ci.test.ts`
- `docs/harness/design.md`(10.2절, 0절 버전 이력), `docs/harness/workflow.md`(2절), `docs/harness/CHANGELOG.md`
- `docs/exec-plans/active/20261122-plan-review-parked/**`
- 읽기만: `scripts/ci/plan-hash.ts`(`planMode`), `scripts/ci/owner-accept.ts`, `scripts/ci/rebuttal.ts`, `scripts/ci/verdict.ts`, `scripts/ci/record.ts`, `scripts/runner/run.ts`, `scripts/runner/divergence.ts`, `scripts/runner/ledger-read.ts`, `scripts/lib/plan.ts`(`PLANS_DIR`), `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`

## step 목록

- step0 parked: 원장에 구현 대기 상태를 더하고, 계획만 담은 head의 판정 입력과 기록에서 코드 지적을 구현 대기로 두며, 코드가 섞인 head에서 되돌린다. 테스트 먼저. 프롬프트·원장 문서·설계서·절차서를 맞춘다.

## 진행 로그

- 2026-11-22 접수: PR #197에서 난 맞물림을 제작자에게 보고했고, 제작자가 대화에서 Issue로 등록하라고 정해(2026-11-22) 봇이 Issue #212를 등록했다. Issue에 적은 세 방향((가) 구현 대기로 둔다, (나) 절차만 적는다, (다) 계획 수정의 길을 바꾼다) 가운데 어느 것으로 할지는 하네스 규칙의 변경이라 제작자에게 물었고("반드시 묻는다": 하네스 원칙·규칙 변경), (가)로 정해졌다. `new-task`로 시작했다.
- 2026-11-22 main(`5e8cc64`)의 코드를 읽었다. 판정 워크플로의 plan job이 PR 전체 변경을 보고 `mode`(`plan` | `code`)를 정하고(`scripts/ci/plan-hash.ts`의 `planMode`), 저장된 원장을 읽어 판정 job에 넘긴다(`review-plan` 명령, `readRoundLedger`). 판정 job은 받은 원장으로 판정 입력 파일을 만든다(`writeRoundInput`). 기록 job은 `record-review --mode`로 `mode`를 받고 `recordLedger`가 원장을 읽어 판정을 반영한 뒤 `review-ledger` 상태를 쓴다(`review-ledger`를 쓰는 곳은 여기뿐이다. 판정이 없어도 쓴다). 상태 값은 `scripts/ci/ledger.ts`의 `ENTRY_STATUSES`에 있고 형식 검사가 이 목록으로 거른다. `deferred`·`accepted`인 지적은 판정으로 바뀌지 않는다(같은 꼴을 `parked`에 쓴다). runner의 지적 대응과 `pr-state`의 "오래 열린 지적"은 `open`인 지적만 본다.
- 2026-11-22 계획 검증 1회차(head `b467754`): Claude 승인(지적 없음), Codex 수정 요청(P1 넷). F1(계획 전용 2라운드부터는 바뀌지 않은 코드 파일을 위치로 적은 새 P1이 동결돼 `deferred`로 등록되므로, "계획 전용 판정의 새 P1은 `open`으로 등록된다"는 테스트 문장과 맞지 않는다) → 맞다. 동결은 지금의 규칙(10.2절 (5))이고 이 계획은 바꾸지 않는다는 것을 작업·비범위·금지사항에 적고, 테스트를 1라운드(동결되지 않는 경우)와 2라운드(지금처럼 `deferred`)로 나눠 적었다. F2(저장된 원장에 `parked`뿐이면 제작자 승인 조회를 건너뛰어, 되돌아온 지적의 유효한 승인이 첫 코드 기록에서 반영되지 않는다) → 맞다. `parkFor`를 승인 조회 앞에서 먼저 적용한다(뒤에서 한 번 더). F3(runner의 `settledResponses`가 `open`이 아닌 지적을 모두 닫힌 것으로 세어, `parked`가 된 지적의 대응을 성공으로 적는다) → 맞다. `scripts/runner/review.ts`를 범위에 넣어 `parked`를 뺀다. F4(step의 AC에 전체 `check`가 없다) → 넣었다.
- 2026-11-22 계획 검증 2회차(head `e01b840`): Claude 승인(지적 없음), Codex 수정 요청. F1~F4는 닫혔고 F5가 새로 나왔다(1회차 뒤에 고친 AC의 금지 경로 검사가 runner 파일 셋만 봐서 다른 runner 파일의 변경을 놓치고, `git`이 실패하면 결과가 비어 통과한다). 맞는 지적이라 AC를 고쳤다: 기준 커밋과 diff의 성공을 `&&`로 확인하고, `scripts/runner/` 아래에서 바뀌는 파일이 `review.ts` 하나인지, 그 파일의 hunk가 모두 `settledResponses` 안인지 본다.
- 2026-11-22 계획 검증 3회차(head `ee0c9f3`): 두 검증자가 승인했다(G1). Claude가 P2 하나(F6, 미룸)를 냈다: 열한째 AC의 hunk 머리글 검사는 `settledResponses` 뒤, 다음 함수 앞의 줄 변경을 놓칠 수 있다. 미룬 지적이라 계획은 고치지 않았고, 구현에서 바꾼 줄이 그 함수의 본문 안뿐인 것을 diff로 직접 확인했다(아래).
- 2026-11-23 읽어서 확인한 것: 두 판정 워크플로(`judge-claude.yml`, `judge-codex.yml`)가 `record-review`에 `--mode "$MODE"`를 이미 넘긴다(워크플로는 고치지 않았다). runner의 `openBlocking`·`longOpen`·`deadlocked`는 `open`만 보고, `divergence`는 `open`과 `fixed`·`rejected`·`accepted`만 센다. 그래서 그 넷은 고치지 않았고 `parked`를 내지 않는 테스트가 지금의 코드로 통과한다.
- 2026-11-23 테스트 먼저: `ledger`·`ledger-accept`·`ledger-store`·`accept-load`·`pr-state`·`runner-review`의 테스트를 더하고 구현 전에 돌렸다. `ledger.test.ts`와 `ledger-accept.test.ts`는 `parkFor`가 없어 불러오기에서 실패했다(파일마다 tests 1, fail 1). `ledger-store.test.ts` 6건(기록 job 5, 판정 입력 1), `accept-load.test.ts` 1건, `pr-state.test.ts` 2건, `runner-review.test.ts` 1건(`settledResponses`)이 실패했다. runner의 넷(`openBlocking`·`longOpen`·`deadlocked`·`divergence`)은 계획대로 지금의 코드로 통과했다.
- 2026-11-23 `recordLedger`의 `planOnly`와 `readRoundLedger`의 `planOnly`를 필수 인자로 두어(빠뜨리면 타입 검사가 막는다), 그 두 함수를 부르는 있던 테스트의 호출에 `planOnly: false`(코드가 섞인 head)를 채웠다. 단언은 고치지 않았다.
- 2026-11-23 구현: `scripts/ci/ledger.ts`(`parked`, `planRound`, `parkFor`, `applyVerdict`, `ledgerStatus`, 형식 검사), `ledger-store.ts`(`recordLedger`: 승인 조회 전과 뒤에 `parkFor`), `accept-load.ts`(`readRoundLedger`: 같은 순서, 반박은 그 뒤의 원장으로 거른다), `review-round.ts`(원장 파일의 한 줄), `scripts/harness.ts`(`record-review`는 `--mode`가 `plan`인지, `review-plan`은 계산한 `mode`), `scripts/commands/pr-state.ts`(구현 대기 지적 줄), `scripts/runner/review.ts`(`settledResponses`의 본문 안만). 여섯 테스트 파일이 모두 통과한다(139건).
- 2026-11-23 문서: 프롬프트(`prompt.md`)와 설계서 10.2절·절차서 2절에 정한 글을 그대로 넣고, 원장 형식(`ledger.md`)에 `parked` 행, `planRound` 필드, "구현 대기" 절, 판정 반영 규칙을 더했다. 설계서는 v0.7.81로 적었다: main은 v0.7.79이고 먼저 승인을 요청할 PR #214가 v0.7.80을 쓴다(병합 순서가 바뀌면 main을 병합할 때 번호를 맞춘다). 머리말의 최종 갱신 날짜를 새 이력 항목의 날짜(2026-11-23)에 맞췄다(`doc-lint`의 설계서 버전 검사). CHANGELOG 한 줄.
- 2026-11-23 `origin/main`(`c24444c`)을 구현 커밋 뒤에 병합했다(충돌 없음).
- 2026-11-23T00:47:36+09:00 step0 재작업: 구현 판정 1회차(head `9781e46`. 원장의 4라운드): Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨). F7: 계획만 담은 head의 기록에서 검증자가 `fixed`였던 코드 지적을 판정으로 다시 열면(`resolutions`의 `open`, 같은 지적의 재등록), 판정을 반영한 뒤에는 구현 대기로 맞추지 않아 그 기록의 `review-ledger`가 막는다(다음 기록에서야 `parked`가 된다). 코드를 되돌린 head에는 고친 내용도 없어 검증자가 다시 열 수 있으므로 실제로 나는 경우다. 맞는 지적이다. 테스트를 먼저 더하고 고친다.
- 2026-11-23 F7 테스트 먼저: `ledger-store.test.ts`에 "계획만 담은 head에서 그 판정이 다시 연 코드 지적도 같은 기록에서 구현 대기가 된다"(resolutions로 다시 열기, 같은 지적의 재등록, 계획 전용 판정에서 등록된 지적은 막는다, 코드가 섞인 head는 지금처럼 막는다)를 더하고 고치기 전에 돌렸다. 실패했다(`parked`를 기대했는데 `open`). 고친 뒤 `ledger-store.test.ts` 19건이 통과한다.
- 2026-11-23 F7 수정: `recordLedger`가 저장하기 전에 `parkFor`를 한 번 더 적용한다(`scripts/ci/ledger-store.ts`). 원장 형식 문서(`ledger.md`)의 "순서" 항목을 맞췄다.
- 2026-11-23T01:17:07+09:00 step0 재작업: 구현 판정 2회차(head `1890c5c`. 원장의 5라운드): Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨. F7은 fixed). F8: 판정이 다시 연 지적은 게시 시각(`openedAt`)이 지워진 채 같은 기록에서 `parked`로 저장되는데, 원장을 읽을 때 게시 시각은 `open`인 지적에만 채워, 코드가 돌아온 첫 기록에서 그 지적이 게시 시각 없이 `open`으로 돌아와 그 사이에 단 제작자 승인이 거부된다(다음 기록부터는 그 승인이 게시 시각보다 앞서 영영 거부된다). 맞는 지적이다. 테스트를 먼저 더하고 고친다.
- 2026-11-23 F8 테스트 먼저: `accept-load.test.ts`에 "게시 시각이 없는 구현 대기 지적에도 원장 댓글의 저장 시각을 채운다"와 "판정이 다시 열어 게시 시각 없이 구현 대기로 저장된 지적도, 게시 뒤의 제작자 승인을 코드가 돌아온 첫 기록에서 받는다"(승인 댓글이 게시보다 앞서거나 같은 초면 받지 않는다)를 더하고 고치기 전에 돌렸다. 둘 다 실패했다. 있던 도우미 `record`가 계획만 담은 head의 기록도 돌릴 수 있게 선택 인자 `planOnly`를 받는다(주지 않으면 지금처럼 코드가 섞인 head다. 단언은 고치지 않았다).
- 2026-11-23 F8 수정: 원장을 읽을 때 게시 시각을 채우는 `stampOpened`(`scripts/ci/ledger-store.ts`)가 `parked`인 지적도 채운다. `Entry.openedAt`의 설명과 원장 형식 문서(`ledger.md`)의 두 곳을 맞췄다.
- 2026-11-24 넘겨받기: 이 PR(#217)은 두 검증자 승인·원장 차단 없음인 채로 main과 충돌해 멈춰 있었다(선점 `claim/212`는 2026-11-22 뒤로 갱신되지 않아 만료). 제작자가 대화에서 이 PR부터 이어 가라고 지시해(2026-11-24) 작업자 `mac-session`이 넘겨받았다. 정식 넘겨받기 방법이 없어(TD-23) frontmatter의 `owner`는 그대로 두고 대화 세션이 이 worktree로 들어가(EnterWorktree) 고쳤다.
- 2026-11-24 `origin/main`(`a06b7fd`, #207 병합까지)을 병합했다. 설계서 머리말·변경 이력만 충돌했다: main이 v0.7.80~v0.7.82를 먼저 썼고 이 PR의 v0.7.81과 번호가 겹쳤다(TD-39의 충돌). main에 변경 조각(#227)이 들어와 있어, 머리말·변경 이력은 main의 것으로 두고 이 PR의 설계서 변경 이력 항목과 CHANGELOG 항목을 조각 `docs/harness/changes/20261122-plan-review-parked-s0.md`로 옮겼다(글은 그대로, 앞의 버전 표기만 뺐다). 코드·테스트는 충돌 없이 병합돼 바뀐 것이 없다.

## 의사결정 로그

- 결정(제작자, 2026-11-22 대화): 계획만 담은 head에서는 그 head가 바꾸지 않은 파일에 대한 열린 지적을 "구현 대기"로 둔다. 닫지 않고, 구현이 다시 올라온 head에서 다시 열어 판정받는다. / 버린 대안(Issue의 (나), (다)): 절차만 적는다(맞는 지적이 `rejected`로 남고 검증자가 받아들여야 풀린다), 계획 수정의 길을 바꾼다(`plan-gate`와 절차서를 크게 고치고 PR이 둘로 는다).
- 결정: 새 상태 `parked`를 둔다(있던 상태에 얹지 않는다). / 이유: `deferred`는 병합을 막지 않는 미룸이고 다시 열리지 않는다. `open`인 채로 표시만 더하면 `open`을 보는 모든 곳(검증자의 승인 규칙, runner의 지적 대응, 오래 열린 지적, 반박, 제작자 승인)에 예외를 넣어야 한다. 새 상태는 그 코드들이 이미 `open`만 다뤄서 저절로 빠진다.
- 결정: 구현 대기로 두는 대상은 **계획 폴더(`docs/exec-plans/`) 밖 파일에 대한 `open` 지적 가운데 계획 전용 판정에서 등록되지 않은 것**이다. 계획 전용 판정에서 등록된 지적에는 표시(선택 필드)를 남긴다. / 이유: 계획만 담은 head가 바꾸는 파일은 그 계획의 폴더뿐이므로 폴더 밖 파일에 대한 지적은 그 head에서 판정할 수 없다. 다만 계획 검증에서 검증자가 위치를 코드 파일로 적은 지적(프롬프트는 계획 파일의 위치를 적으라고 하지만 강제하지 못한다)은 계획에 대한 지적이라 구현 대기로 두면 계획 검증이 그것을 건너뛴다. / 버린 대안: 위치만 본다(위의 경우에 계획 검증이 약해진다), 그 PR이 바꾼 파일 목록과 견준다(기록 job에는 PR의 코드가 없고, 계획만 담은 head에서는 결과가 계획 폴더 기준과 같다).
- 결정: 계획만 담은 head에서 `parked`는 `review-ledger`를 막지 않는다. 코드가 섞인 head의 기록은 판정을 반영하기 전에 `parked`를 모두 `open`으로 되돌린다. / 이유: 커밋 상태는 head마다 따로 있다. 계획만 담은 head에는 그 지적이 가리키는 코드가 없으므로 그 head의 `review-ledger`가 통과해도 그 코드는 병합되지 않는다. 코드가 올라온 head에서는 기록 job이 반드시 돌고(`review-ledger`를 쓰는 유일한 곳이고 판정이 없어도 쓴다) 거기서 되돌린다. 막게 하면 계획 승인이 난 뒤에도 PR의 분류가 "지적 대응"으로 남아 runner와 대화 세션이 대응할 것이 없는 지적에 묶인다.
- 결정(계획 검증 1회차 F2 뒤): 구현 대기로 두기·되돌리기를 제작자 승인의 조회 **앞**에서 먼저 하고, 승인을 반영한 뒤 한 번 더 한다. / 이유: 승인 조회는 `open`·`accepted`인 P0·P1이 있을 때만 한다. 되돌리기를 뒤에서만 하면 저장된 원장에 `parked`뿐일 때 조회를 건너뛰어 유효한 승인이 한 기록 늦게 반영된다. 뒤의 적용은 계획만 담은 head에서 승인이 철회돼 그 기록에서 열린 지적을 구현 대기로 두기 위한 것이다.
- 결정(계획 검증 1회차 F3 뒤): runner의 `settledResponses`에서 `parked`를 뺀다. 발산 판단은 고치지 않는다. / 이유: `parked`는 닫힌 것이 아니라서 대응의 성공으로 세면 실패 횟수가 잘못 0으로 돌아간다. 발산 판단은 `open`과 `fixed`·`rejected`·`accepted`만 세어 `parked`를 세지 않는다. 한 대응 라운드 사이에 `parked`가 `open`으로 돌아오면(계획만 담은 head에서 대응한 뒤 코드가 올라온 경우) 그 지적은 "다시 열린 지적"으로 세어진다: runner는 PR을 계획만 남기지 않고 계획 검증의 대응에서는 계획 파일만 고치므로 runner의 흐름에서는 생기지 않고, 생기더라도 제작자에게 묻는 쪽으로 틀린다.
- 결정(계획 검증 1회차 F1 뒤): 등록 규칙(동결 포함)은 건드리지 않는다. / 이유: 계획 전용 2라운드부터 바뀌지 않은 파일의 새 P1이 동결되는 것은 지금도 그렇고(계획 파일이든 코드 파일이든), 목표가 계속 움직이는 것을 막는 규칙이다(10.2절 (5)). 이 계획이 다루는 것은 이미 등록돼 `open`인 지적이 계획만 담은 head에서 판정될 수 없다는 문제다.
- 결정: plan job이 판정 job에 넘기는 원장에 같은 규칙을 반영한다(저장하지는 않는다). 저장은 기록 job이 한다. / 이유: 검증자가 `parked`를 봐야 판정하지 않는다. 제작자 승인(`accepted`)을 반영해 넘기는 지금의 꼴과 같다. 두 곳이 같은 함수를 쓴다.
- 결정: 프롬프트(`prompt.md`)에 규칙을 적고, 판정 입력의 원장 파일에도 뜻을 한 줄 적는다(지시가 아니라 설명으로). / 이유: 프롬프트는 PR의 첫 판정 때의 버전으로 고정된다(10.2절 (2)). 이미 열린 PR의 검증자는 새 규칙을 읽지 못한다. 옛 프롬프트의 규칙으로도 `parked`는 "`open`·`fixed`·`rejected`인 내 지적"이 아니라 판정 대상이 아니고 "`open`으로 남는 P0·P1"이 아니라 승인을 막지 않는다. 입력 파일의 한 줄은 그 상태가 무엇인지 알려 준다.
- 결정: 구현 대기에서 되돌아온 지적의 게시 시각(`openedAt`)은 그대로 둔다. / 이유: 그 지적은 전에 `open`으로 게시됐던 것이다. 제작자 승인은 `open`인 지적만 대상이라 구현 대기인 동안에는 반영되지 않는다.
- 결정(구현 판정 1회차 F7 뒤): 기록 job이 저장하기 전에 `parkFor`를 한 번 더 적용한다. step의 "작업" 2는 "승인 조회 전과 반영 뒤에 적용하고 그다음에 판정을 반영한다"는 차례를 적었고 그 뒤의 적용은 적지 않았다. 더한 적용은 같은 함수를 같은 조건으로 부르는 것이라 금지사항(코드가 섞인 head에서 두지 않는다, 계획 폴더 안의 지적과 계획 전용 판정의 지적은 두지 않는다, `parked`를 닫힌 상태로 만들지 않는다)을 모두 지킨다. 실행 중인 step의 "작업"은 이 PR에서 고칠 수 없어(`plan-gate`) 여기에 적는다. / 이유: 코드를 되돌린 head에는 고친 코드도 없어 검증자가 `fixed`인 코드 지적을 다시 열 수 있고, 그 기록에서 `review-ledger`가 막히면 계획 검증에 한 라운드가 더 든다. / 버린 대안: 계획만 담은 head에서는 `fixed`인 코드 지적에 대한 판정을 반영하지 않는다(검증자의 판정을 버리는 갈래가 늘고, 코드가 다시 올라왔을 때 그 지적이 다시 판정받지 않는다).
- 결정(구현 판정 2회차 F8 뒤): 게시 시각은 `parked`인 지적에도 채운다. 게시 시각의 목적은 아직 게시되지 않은 번호를 미리 승인한 댓글을 막는 것이고, `parked`인 지적도 그 번호로 원장 댓글에 게시돼 있으므로 그 저장 시각을 게시 시각으로 쓸 수 있다. `parked`인 동안 승인은 반영되지 않고(열린 지적이 아니다), 코드가 돌아와 `open`이 되면 게시 시각 뒤에 단 승인이 반영된다. / 버린 대안: 판정이 다시 연 지적을 같은 기록에서 `parked`로 두지 않는다(F7이 다시 열린다), 되돌릴 때 게시 시각을 그 기록의 시각으로 채운다(그 사이에 단 승인이 영영 받아지지 않는다).

- 결정(2026-11-24 main 병합): 설계서 기록을 번호를 올려(v0.7.83) 다시 적지 않고 변경 조각으로 옮긴다. / 이유: 절차서 5절은 설계서를 고친 PR이 변경 조각에 적게 한다. 번호를 올리면 승인을 기다리는 동안 다른 PR이 먼저 병합될 때 같은 충돌이 다시 나고, 제작자 승인 뒤의 새 커밋은 승인을 철회시킨다. 조각은 PR마다 새 파일이라 충돌하지 않는다. 조각 폴더는 계획의 "관련 파일·문서"에 없어 `scope` 경고가 날 수 있다(묶인 섹션이라 고치지 않고 PR 본문에 이유를 적는다). / 버린 대안: 번호를 v0.7.83으로 올린다(절차서 5절의 옛 방식 PR 처리. 다시 겹칠 수 있다).

## 발견 사항

- 봇이 되돌릴 수 없는 변경(제작자가 올린 워크플로 파일)이 든 PR은 계획만 남길 수 없어, 그 PR의 step이 금지한 파일을 고쳐야 하는 지적이 나오면 이 계획이 고치는 길로도 풀리지 않는다(PR #188의 F14. 제작자가 별도 PR #216으로 먼저 고치기로 정했다). → 처리: #215
- 열한째 AC(바뀐 줄이 `settledResponses` 안에만 있다)의 hunk 머리글 검사는 그 함수 뒤, 다음 함수 앞의 줄 변경을 놓칠 수 있다(계획 검증 3회차의 F6, P2, 미룸). 이 구현의 `review.ts` 변경은 그 함수 본문 안의 다섯 줄뿐인 것을 diff로 직접 확인했다. AC를 더 단단히 하려면 함수의 줄 범위를 구해 견주는 검사가 필요하다(이 step의 범위 밖). → 처리: 해당 없음

## 열린 질문

없음.

## 검증 방법과 결과

- step의 AC 명령과 `node scripts/harness.ts check`, `node scripts/harness.ts self-test`.
- 수용 기준 1~6: 원장·기록·판정 입력·`pr-state`·runner 대응 집계의 테스트.
- 수용 기준 7: AC의 문서 비교 줄과 판정 입력 테스트.
- 수용 기준 8: AC의 워크플로 비교 줄.
- 결과(2026-11-23): step0의 AC 16줄과 `node scripts/harness.ts check` 통과. 여섯 테스트 파일(`ledger` 25, `ledger-accept` 13, `ledger-store` 18, `accept-load` 24, `pr-state` 30, `runner-review` 29)과 `runner-plan-review`·`record`·`ci` 테스트 통과.

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 테스트를 먼저 쓰고 구현한다. 구현 판정을 받는다.
3. 판정이 끝나면 완료 처리 뒤 `pr-ready`로 승인을 요청한다(위험도 높음, 보호 경로).
