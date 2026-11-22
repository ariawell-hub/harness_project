# Step 0: parked

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `scripts/ci/ledger.ts`(`ENTRY_STATUSES`, `Entry`, `applyVerdict`, `applyPlanReview`, `ledgerStatus`, `renderLedger`, 형식 검사)
- `scripts/ci/ledger-store.ts`(`recordLedger`, 게시 시각을 채우는 자리), `scripts/ci/accept-load.ts`(`readRoundLedger`), `scripts/ci/owner-accept.ts`, `scripts/ci/rebuttal.ts`
- `scripts/ci/review-round.ts`(`writeRoundInput`), `scripts/ci/plan-hash.ts`(`planMode`)
- `scripts/harness.ts`의 `record-review`와 `review-plan` 명령
- `scripts/commands/pr-state.ts`(`logLongOpen`), `scripts/runner/review.ts`(`longOpen`, 열린 지적을 고르는 자리), `scripts/runner/divergence.ts`
- `scripts/cross-review/prompt.md`("라운드 규칙"), `scripts/cross-review/prompt-plan.md`, `scripts/cross-review/ledger.md`
- `docs/harness/design.md` 10.2절의 상태 목록, `docs/harness/workflow.md` 2절 "계획 검증"
- `.github/workflows/judge-codex.yml`, `.github/workflows/judge-claude.yml`(읽기만: `mode`가 어디로 넘어가는지)

## 작업

### 1. 원장의 상태와 필드 (`scripts/ci/ledger.ts`)

- `ENTRY_STATUSES`에 `parked`를 더한다(구현 대기).
- `Entry`에 선택 필드 `planRound?: true`를 더한다: 계획 전용 판정(`mode=plan`)에서 등록된 지적이다. 없으면 코드가 섞인 판정에서 등록된 것이다(이 필드가 생기기 전의 원장도 그렇게 읽는다). 형식 검사는 이 필드가 없거나 `true`일 때만 받는다(`openedAt`처럼 선택 필드로 다룬다).
- 함수 `parkFor(l: Ledger, planOnly: boolean): Ledger`(내보낸다. 입력은 바꾸지 않는다):
  - `planOnly`가 참이면: 상태가 `open`이고, `planRound`가 아니고, `file`이 계획 폴더(`scripts/lib/plan.ts`의 `PLANS_DIR` 아래. `docs/exec-plans/`로 시작한다) 밖인 지적을 `parked`로 바꾼다. 처리 칸(`note`)은 `구현 대기: 계획만 담은 head에서는 판정하지 않는다`로 적는다. 그 밖의 필드(`openedAt`, `rejectedBy`, `repro`)는 그대로 둔다.
  - `planOnly`가 거짓이면: 상태가 `parked`인 지적을 모두 `open`으로 바꾼다. 처리 칸은 `구현이 올라와 다시 열림`으로 적는다. `openedAt`은 그대로 둔다.
  - 바뀐 것이 없으면 내용이 같은 원장을 돌려준다(저장 여부를 가르는 비교가 "같다"로 나와야 한다).
- `applyVerdict`:
  - `ApplyOptions`에 `planOnly?: boolean`을 더한다. 참이면 이 판정에서 **새로 등록하는** 지적에 `planRound: true`를 적는다(`open`으로 등록되든 `deferred`로 등록되든).
  - 등록할 때의 상태를 정하는 지금의 규칙(P0·P1은 `open`, P2·P3은 `deferred`, 근거 없는 P1은 P2로, 그 검증자의 2라운드부터 바뀌지 않은 파일의 재현되지 않은 새 P1은 동결해 `deferred`)은 **바꾸지 않는다**. 계획 전용 판정에서도 같다. `planRound`는 "구현 대기로 두지 않는다"는 표시일 뿐 등록 상태를 바꾸지 않는다.
  - `resolutions`: `parked`인 지적은 `deferred`·`accepted`처럼 건너뛴다(자기 지적이든 남의 P0에 대한 동의든 반영하지 않는다).
  - 같은 지적의 재등록: `parked`인 지적은 그대로 둔다(다시 열거나 새로 등록하지 않는다. 재현 결과만 지금처럼 적는다).
- `ledgerStatus`: `parked`는 막지 않는다. 통과할 때와 실패할 때 모두 상태 설명에 수를 적는다(`구현 대기 N`. 0이면 적지 않는다. `제작자 승인 N`을 적는 것과 같은 꼴).
- `renderLedger`와 형식 검사: 상태 `parked`와 필드 `planRound`가 댓글의 데이터에 그대로 실리고 다시 읽힌다. 표의 상태 칸은 값 그대로(`parked`) 보인다.

### 2. 기록 job (`scripts/ci/ledger-store.ts`의 `recordLedger`)

- `RecordLedgerOptions`에 `planOnly: boolean`을 더한다(`plan` 옵션과 따로다. `plan`은 계획 해시가 맞을 때만 온다).
- 읽은 원장에 **제작자 승인을 조회하기 전에** `parkFor(ledger, o.planOnly)`를 적용하고, 승인을 반영한 뒤 한 번 더 적용한다. 그다음에 판정을 반영한다. 판정이 없어도(`verdict`가 null) 적용한다.
  - 앞의 적용: 코드가 섞인 head에서 되돌아온 지적이 승인 조회의 대상(`open`·`accepted`인 P0·P1이 있을 때만 조회한다)에 들어가게 한다. 저장된 원장에 `parked`뿐이어도 조회하고, 유효한 승인 댓글이 있으면 그 기록에서 `accepted`가 된다.
  - 뒤의 적용: 계획만 담은 head에서 승인이 철회돼 이 기록에서 `open`으로 돌아온 지적도 구현 대기로 둔다.
- `applyVerdict`에 `planOnly`를 넘긴다.
- 그 결과가 읽은 원장과 다르면 지금의 규칙대로 저장한다(구현 대기로 두거나 되돌린 것만 달라도 저장한다).
- 끝에서 제작자 승인을 다시 반영하는 지금의 순서는 그대로 둔다(되돌아온 지적은 `open`이므로 승인 댓글이 있으면 반영될 수 있다. `parked`는 대상이 아니다).

### 3. plan job이 넘기는 원장 (`scripts/ci/accept-load.ts`의 `readRoundLedger`)

- 인자에 `planOnly: boolean`을 더하고, 기록 job과 같은 순서로 반영해 돌려준다(`parkFor` → 제작자 승인 → `parkFor`). 저장하지 않는다.
- 반박(`rebuttals`)은 그 뒤의 원장으로 거른다(`parked`인 지적에 대한 반박은 열린 지적에 대한 것이 아니므로 빠진다. `scripts/ci/rebuttal.ts`는 고치지 않는다).

### 4. 명령 (`scripts/harness.ts`)

- `review-plan`(plan job 쪽: 원장을 API로 읽는 갈래): 이미 계산한 `mode`가 `plan`인지를 `readRoundLedger`에 넘긴다.
- `record-review`: `--mode`가 `plan`인지를 `recordLedger`의 `planOnly`로 넘긴다(계획 해시의 형식과 무관하다). `--mode`가 없거나 다른 값이면 거짓이다(코드가 섞인 것으로 본다: 되돌리는 쪽).
- 워크플로 파일은 고치지 않는다. 두 판정 워크플로가 `record-review`에 `--mode`를 이미 넘기는지 읽어서 확인하고 진행 로그에 적는다. 넘기지 않는 워크플로가 있으면 멈추고 계획을 고친다.

### 5. 판정 입력 (`scripts/ci/review-round.ts`의 `writeRoundInput`)

원장에 `parked`인 지적이 하나라도 있으면 원장 파일(`.harness-review/ledger.md`)의 머리 항목들(검증자, 이번 판정 …) 끝에 한 줄을 더한다(글자 그대로):

`- 상태 parked: 구현 대기. 이 head는 계획 파일만 담고 있어 그 지적이 가리키는 코드가 없다. 판정 대상이 아니고, 코드가 다시 올라온 head에서 open으로 돌아간다`

없으면 더하지 않는다(지금의 출력과 같다).

### 6. `pr-state` (`scripts/commands/pr-state.ts`)

"오래 열린 지적" 줄을 내는 자리에서, 원장에 `parked`인 지적이 있으면 한 줄을 더 낸다: `- 구현 대기 지적: F9, F10 — 계획만 담은 head라 판정하지 않는다. 구현을 올리면 다시 열려 판정받는다(절차서 2절)`. 지적의 제목·위치는 내지 않는다(지금의 줄과 같다). 없으면 내지 않는다.

### 7. runner의 대응 집계 (`scripts/runner/review.ts`)

`settledResponses`(대응한 뒤 닫힌 지적)는 "`open`이 아닌 지적"을 닫힌 것으로 본다. `parked`는 닫힌 것이 아니므로 뺀다(바꾸는 줄은 이 함수의 본문 안에만 둔다. 함수 위의 설명 주석은 그대로 두고, 설명이 필요하면 본문 안의 주석으로 적는다): 아직 세지 않은 대응이 붙은 지적이 `parked`인 동안에는 성공으로도 실패로도 세지 않고 그 대응 기록을 그대로 둔다(`failedResponses`는 `open`만 봐서 이미 세지 않는다). 그 지적이 `open`으로 돌아와 판정을 받으면 지금의 규칙대로 센다(열려 있으면 실패, `fixed`·`rejected`·`deferred`·`accepted`면 닫힘).

그 밖의 runner 코드는 고치지 않는다. 읽어서 확인한 것을 진행 로그에 적는다: 대응할 지적(`openBlocking`), 오래 열린 지적(`longOpen`), 교착(`deadlocked`)은 `open`만 본다. 발산 판단(`divergence.ts`)은 `open`과 닫힌 상태(`fixed`·`rejected`·`accepted`)만 세므로 `parked`인 지적은 새 지적으로도 해소로도 세지 않는다.

### 8. 테스트 먼저 (있던 테스트의 단언은 고치지 않는다)

구현 전에 돌려 실패를 확인하고 진행 로그에 적는다.

`scripts/test/ledger.test.ts`:

- `parkFor(…, true)`: 코드 파일에 대한 `open` P1과 P0이 `parked`가 된다. 계획 폴더 안 파일(`docs/exec-plans/active/<id>/step0.md`)에 대한 `open` 지적, `planRound`인 지적(위치가 코드 파일이어도), `fixed`·`rejected`·`deferred`·`accepted`인 지적은 그대로다. `openedAt`·`rejectedBy`가 남는다. 입력 원장은 바뀌지 않는다. 계획 폴더와 이름만 비슷한 경로(`docs/exec-plans-old/x.md`, `xdocs/exec-plans/y.md`)는 폴더 밖이다.
- `parkFor(…, false)`: `parked`가 모두 `open`이 되고 `openedAt`이 남는다. `parked`가 없으면 `JSON.stringify`가 같은 원장이 나온다.
- 두었다가 되돌리면(`true` 뒤 `false`) 상태와 `openedAt`이 처음과 같다.
- `applyVerdict`: `parked`인 지적에 대한 `resolutions`(`fixed`·`rejected`·`open`, 남의 P0에 대한 `rejected`)가 반영되지 않는다. 같은 검증자·위치·제목의 지적을 `findings`에 다시 내도 새로 등록되지 않고 `parked`로 남는다. `planOnly`가 참이면 새 지적에 `planRound: true`가 붙고, 거짓이거나 없으면 붙지 않는다.
- `ledgerStatus`: `parked`뿐이면 통과이고 설명에 `구현 대기 2`가 있다. `open`과 `parked`가 함께 있으면 실패이고 설명에 둘 다 있다. `parked`가 없으면 설명이 지금과 글자 그대로 같다.
- 형식: `parked`와 `planRound: true`가 든 원장을 댓글로 만들었다가 다시 읽으면 같다. `planRound: false`, `planRound: 1`, 모르는 상태 값은 거부한다. 필드가 없는 지금의 원장은 그대로 읽힌다.

`scripts/test/ledger-store.test.ts`(`recordLedger`):

- 계획만 담은 head: 저장된 원장에 Codex의 코드 지적(`open`, P1)이 있고, Codex가 그 지적에 대한 `resolutions` 없이 `approve`를 낸다(`planOnly: true`, `plan: { hash, approved: true }`). 저장된 원장에서 그 지적은 `parked`이고, 계획 승인에 Codex가 들어 있으며, `review-ledger`는 통과이고 설명에 `구현 대기 1`이 있다.
- 같은 head에서 검증자가 `parked`인 지적에 `resolutions`로 `fixed`를 내도 `parked`로 남는다.
- 코드가 섞인 head(`planOnly: false`): 저장된 원장의 `parked`가 판정 전에 `open`이 되고, 그 판정의 `resolutions`가 `fixed`이면 `fixed`, `open`이거나 없으면 `open`으로 남아 `review-ledger`가 실패한다.
- 코드가 섞인 head에서 판정이 없을 때(`verdict: null`): `parked`가 `open`으로 저장되고 `review-ledger`가 실패한다.
- 저장된 원장에 `parked`인 P1 하나뿐이고(다른 `open`·`accepted` 지적이 없다) 그 지적의 게시 시각 뒤에 달린 유효한 제작자 승인 댓글이 있다: 코드가 섞인 head의 첫 기록에서 승인 댓글을 조회하고(GraphQL 호출이 있다) 그 지적이 `accepted`로 저장되며 `review-ledger`가 통과한다. 계획만 담은 head의 기록에서는 그 지적이 `parked`로 남고 승인되지 않는다.
- 계획만 담은 head에서 승인 댓글이 지워진 `accepted` 코드 지적: 그 기록에서 `parked`로 저장된다(`open`으로 남지 않는다).
- 계획 전용 판정에서 그 검증자의 1라운드에 새로 낸 P1(위치가 코드 파일)은 `open`으로 등록되고 `planRound`가 붙으며, 다음 계획 전용 기록에서도 `parked`가 되지 않고 `open`으로 남는다(그 검증자가 닫을 때까지). 2라운드부터의 동결은 지금과 같다: 직전 판정 뒤 바뀌지 않은 파일의 재현되지 않은 새 P1은 계획 전용 판정에서도 `deferred`로 등록되고 `planRound`가 붙는다(등록 규칙은 이 step이 바꾸지 않는다).
- `parked`가 없는 원장과 `planOnly: false`인 기록은 지금과 같은 결과를 낸다(있던 테스트가 그대로 통과한다).

`scripts/test/accept-load.test.ts`(`readRoundLedger`): `parked`뿐인 원장에서 `planOnly: false`이면 승인 댓글을 조회해 돌려준 원장에서 그 지적이 `accepted`다. `planOnly: true`이면 돌려준 원장에서 코드 지적이 `parked`이고, 그 지적에 대한 반박은 돌려주지 않는다. `planOnly: false`이면 저장된 `parked`가 `open`으로 보인다. 저장(쓰기 호출)은 하지 않는다.

`scripts/test/ledger-accept.test.ts`: `parked`인 P1에 대한 제작자 승인 댓글은 반영되지 않는다(`open`으로 되돌아온 뒤에는 반영된다).

판정 입력(`writeRoundInput`의 테스트가 있는 파일. `scripts/test/runner-review.test.ts`에 없으면 `scripts/test/ci.test.ts`에 더한다): `parked`가 있으면 원장 파일에 5의 줄이 한 번 있고 표의 상태 칸이 `parked`다. 없으면 그 줄이 없다.

`scripts/test/pr-state.test.ts`: 원장에 `parked`가 있으면 6의 줄이 나오고 지적 번호가 들어 있다. 없으면 나오지 않는다. `parked`인 지적은 "오래 열린 지적"으로 나오지 않는다.

`scripts/test/runner-review.test.ts`:

- 아직 세지 않은 대응이 붙은 지적이 `parked`이면 `settledResponses`에도 `failedResponses`에도 나오지 않는다(대응 기록이 남는다). 같은 지적이 `open`으로 돌아오고 그 검증자가 대응 head를 판정했으면 `failedResponses`에 나오고, `fixed`가 되면 `settledResponses`에 나온다.
- `openBlocking`, `longOpen`, `deadlocked`가 `parked`인 지적을 내지 않는다. `divergence`가 `parked`인 지적을 새 지적으로도 해소로도 세지 않는다(이 넷은 지금의 코드로 통과해야 한다. 실패하면 멈추고 계획을 고친다).

### 9. 문서

- `scripts/cross-review/prompt.md`의 "라운드 규칙"에서 `accepted`를 설명한 항목 바로 뒤에 한 항목을 더한다(글자 그대로):

  ``- 상태가 `parked`인 지적은 구현 대기다. 이 PR은 지금 계획 파일만 담고 있어 그 지적이 가리키는 코드가 없다. `resolutions`에 판정을 내지 말고 `findings`에 다시 적지 마라. `verdict`를 정할 때 세지 마라. 코드가 다시 올라온 head에서 `open`으로 돌아오면 그때 판정한다.``

- `scripts/cross-review/ledger.md`: "상태" 표에 `parked` 행(뜻: 구현 대기. 계획만 담은 head에서 판정할 수 없는 코드 지적. 코드가 섞인 head의 기록에서 `open`으로 돌아간다. 그 head에서는 병합을 막지 않는다), "원장" 절의 지적 필드 설명에 `planRound`, "판정 반영 규칙"에 두는 조건과 되돌리는 때, `parked`는 판정·제작자 승인·반박으로 바뀌지 않는다는 것을 적는다.
- `docs/harness/design.md` 10.2절의 상태 목록에서 `accepted` 항목(그 아래 딸린 항목들 포함) 바로 뒤에 같은 들여쓰기로 한 항목을 더한다(글자 그대로):

  ``- `parked`: **구현 대기**다. 계획만 담은 head(`mode=plan`)에서는 그 head에 없는 코드에 대한 열린 지적을 판정할 수 없다. 기록 job이 계획 폴더 밖 파일에 대한 `open` 지적을 `parked`로 바꾸고(계획 전용 판정에서 등록된 지적은 빼고), 검증자는 그것을 판정하지 않으며 계획 승인(G1)과 그 head의 `review-ledger`를 막지 않는다. 코드가 섞인 head의 기록은 판정을 반영하기 전에 `parked`를 모두 `open`으로 되돌린다. 그래서 구현이 다시 올라오면 다시 판정받고, 해소되지 않으면 병합을 막는다(Issue #212).``

- 설계서 0절 버전 이력에 한 항목(다음 번호. 올릴 때의 main 기준), 머리말의 버전.
- `docs/harness/workflow.md` 2절 "계획 검증"에서 "코드를 이미 올린 PR에서 계획 검증이 필요해지면(계획 수정) …"으로 시작하는 항목 바로 뒤에 한 항목을 더한다(글자 그대로):

  ``- 계획만 남긴 동안, 앞선 구현 판정에서 나온 코드에 대한 열린 지적은 원장에서 `parked`(구현 대기)가 된다. 계획 검증을 막지 않고 고치거나 반박할 것도 없다(`pr-state`가 번호를 알린다). 코드를 다시 올리면 `open`으로 돌아가 다시 판정받으므로, 그때 고친 내용으로 닫는다(설계서 10.2절, Issue #212).``

- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(`#212`, `설계서 v…`, "검사를 약화하지 않는다: 코드가 올라온 head에서는 전과 같이 막는다").

## Acceptance Criteria

```bash
node --test scripts/test/ledger.test.ts scripts/test/ledger-store.test.ts scripts/test/accept-load.test.ts scripts/test/ledger-accept.test.ts
node --test scripts/test/pr-state.test.ts scripts/test/runner-review.test.ts scripts/test/runner-plan-review.test.ts scripts/test/record.test.ts scripts/test/ci.test.ts
test "$(grep -c -F '`parked`: **구현 대기**다. 계획만 담은 head(`mode=plan`)에서는 그 head에 없는 코드에 대한 열린 지적을 판정할 수 없다.' docs/harness/design.md)" = 1
test "$(git diff --numstat "$(git merge-base HEAD origin/main)" HEAD -- docs/harness/design.md | cut -f1,2 | tr '\t' ' ')" = "3 1"
test "$(grep -c -F '계획만 남긴 동안, 앞선 구현 판정에서 나온 코드에 대한 열린 지적은 원장에서 `parked`(구현 대기)가 된다.' docs/harness/workflow.md)" = 1
test "$(grep -c -F '상태가 `parked`인 지적은 구현 대기다.' scripts/cross-review/prompt.md)" = 1
grep -q 'parked' scripts/cross-review/ledger.md && grep -q 'planRound' scripts/cross-review/ledger.md
grep -q '#212' docs/harness/CHANGELOG.md
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github scripts/cross-review/prompt-plan.md scripts/ci/rebuttal.ts scripts/ci/owner-accept.ts
BASE="$(git merge-base HEAD origin/main)" && N="$(git diff --name-only "$BASE" HEAD -- scripts/runner)" && test "$N" = "scripts/runner/review.ts"
BASE="$(git merge-base HEAD origin/main)" && D="$(git diff -U0 "$BASE" HEAD -- scripts/runner/review.ts)" && test -n "$D" && test "$(printf '%s\n' "$D" | grep '^@@' | grep -v -c -F 'export function settledResponses(')" = 0
node scripts/harness.ts check
node scripts/harness.ts self-test
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 셋째·넷째 줄: 설계서에는 정한 항목 하나가 들어가고, 바뀌는 줄은 머리말의 버전(한 줄을 고친다), 버전 이력(한 줄을 더한다), 10.2절의 새 항목(한 줄을 더한다)뿐이다. `origin/main`이 필요하다(`git fetch origin`).
- 아홉째~열한째 줄은 명령이 실패해도 통과하지 않는다: 기준 커밋을 구하지 못하거나(`origin/main`이 없다) `git diff`가 실패하면 그 줄이 실패한다(`&&`로 이었고, 결과가 비어도 통과하는 비교를 쓰지 않는다).
- 아홉째 줄: 워크플로(`.github/**`), 계획 검증 프롬프트, 반박·제작자 승인의 판별 코드는 바뀌지 않는다(`git diff --quiet`는 차이가 있으면 1, 실패하면 그 밖의 값으로 끝난다).
- 열째 줄: `scripts/runner/` 아래에서 바뀌는 파일은 `review.ts` 하나뿐이다(`ledger-read.ts`를 포함해 다른 runner 파일이 바뀌면 실패한다).
- 열한째 줄: `review.ts`에서 바뀌는 줄은 모두 `settledResponses` 함수의 본문 안에 있다. 문맥 없는 diff(`-U0`)의 hunk 머리글은 바뀐 줄을 감싼 함수의 선언 줄을 싣는다: 머리글에 그 선언이 없는 hunk가 하나라도 있으면 실패한다. 그래서 함수 위의 설명 주석은 고치지 않고, 필요한 설명은 함수 본문 안의 주석으로 적는다.
- 열두째 줄: 전체 `check`(포맷·정적 검사·모든 테스트·빌드·문서 검사·우회 탐지·시크릿 스캔)가 통과해야 한다. 그 뒤의 `lint`·`doc-lint`·`fmt --check`는 `check`에 들어 있지만 실패한 곳을 바로 보려고 따로 둔다.

## 금지사항

- `parked`를 병합을 허용하는 닫힌 상태로 만들지 마라(코드가 섞인 head의 기록에서 `open`으로 되돌리는 것을 건너뛰는 갈래를 두지 마라). 이유: 열린 지적을 계획만 남겼다가 다시 올리는 것으로 지울 수 있게 된다(R4).
- 코드가 섞인 head에서 지적을 `parked`로 두지 마라. `mode`를 알 수 없으면 코드가 섞인 것으로 본다. 이유: fail-closed.
- 계획 폴더 안 파일에 대한 지적과 계획 전용 판정에서 등록된 지적을 `parked`로 두지 마라. 이유: 계획 검증이 판정해야 할 지적이다.
- 워크플로 파일(`.github/workflows/**`)을 고치지 마라. 이유: 봇이 고치지 않는다(SECURITY.md "워크플로 변경 절차").
- runner에서는 `scripts/runner/review.ts`의 `settledResponses`만 고친다. 그 밖의 `scripts/runner/**`와 `scripts/ci/rebuttal.ts`, `scripts/ci/owner-accept.ts`, `scripts/cross-review/prompt-plan.md`를 고치지 마라. 이유: 이 step의 범위가 아니다(고쳐야 하면 멈추고 계획을 고친다).
- 등록할 때의 상태를 정하는 규칙(동결 포함)을 바꾸지 마라. 이유: 10.2절 (5)의 규칙이고 이 step의 범위가 아니다.
- 있던 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
- `pr-state`의 줄과 로그에 지적의 제목·위치(검증자 출력)를 넣지 마라. 이유: 지금의 "오래 열린 지적" 줄과 같은 이유다(검증자 출력은 PR 내용에 영향받는 글이다).
