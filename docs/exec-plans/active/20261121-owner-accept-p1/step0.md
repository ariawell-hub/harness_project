# Step 0: p1-accept

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`ci/*` 행)
- `docs/harness/design.md` 10.2절 (4)(지적 원장의 상태, 반박 형식, 병합 조건), 5절의 B11 행
- `docs/harness/workflow.md` 8절(반박, 교착, 오래 열린 지적, 제작자 승인)
- `scripts/cross-review/ledger.md`(원장 형식, "제작자 승인" 절, "규칙" 절), `scripts/cross-review/prompt.md`(읽기만)
- `scripts/ci/owner-accept.ts`(`refusal`, `applyOwnerAccepts`, `needsAccepts`), `scripts/ci/accept-load.ts`(`loadAccepted`), `scripts/ci/ledger.ts`(`ENTRY_STATUSES`, `ledgerStatus`), `scripts/ci/ledger-store.ts`(읽기만)
- `scripts/test/owner-accept.test.ts`, `scripts/test/accept-load.test.ts`, `scripts/test/accept-cli.test.ts`, `scripts/test/ledger-accept.test.ts`, `scripts/test/ledger.test.ts`(읽기만)
- `scripts/gates/test-effect.ts`(읽기만. 고친 테스트 파일마다 변경 전 코드에서 실패해야 한다), `scripts/ci/ledger.ts`의 `applyVerdict`(새 지적의 등록과 동결)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 실패를 확인한 테스트 이름과 실패한 수를 적는다.

### 1. 판별 (`scripts/ci/owner-accept.ts`)

제작자 승인의 대상을 "열린 P0"에서 "열린 P0·P1"로 넓힌다. 그 밖의 조건은 한 글자도 바꾸지 않는다.

- `refusal`: 지적의 등급이 P0도 P1도 아니면 `'차단 지적(P0·P1)이 아니다'`를 돌려준다(있던 문구 `'P0이 아니다'`를 이 문구로 바꾼다). 검사 순서는 그대로다: 원장에 없는 지적 → 등급 → 상태(`open`·`accepted`가 아니면 `'열린 지적이 아니다'`) → 게시 시각 없음 → 게시 시각보다 뒤가 아님.
- `needsAccepts`: `open`이거나 `accepted`인 P0·P1이 하나라도 있으면 참이다.
- 바꾸지 않는 것: 승인 줄의 형식(`acceptIds`), 제작자 계정 비교와 고쳐지지 않음 확인(`ownerAccepts`, `unedited`), 같은 지적의 승인 가운데 가장 늦은 것을 쓰는 규칙, 승인을 댓글에서 매번 다시 계산하고 없어지면 `open`으로 되돌리는 규칙(`applyOwnerAccepts`), 처리 칸의 문구.
- 그래서 생기는 동작(테스트로 확인한다):
  - 열린 P1에 인정되는 승인 댓글이 있으면 `accepted`가 되고 처리 칸이 `제작자 승인(댓글 <id>)`이다.
  - 동결돼 `deferred`인 P1, `fixed`·`rejected`인 P1은 `'열린 지적이 아니다'`로 반영되지 않는다. P2·P3은 `'차단 지적(P0·P1)이 아니다'`로 반영되지 않는다.
  - `accepted`인 P1의 승인 댓글이 없어지면(지워짐, 고쳐짐) `open`으로 돌아간다.
  - 반영하지 않은 승인의 이유는 댓글을 읽은 실행에서만 로그에 남는다. `needsAccepts`가 거짓인 원장(열렸거나 `accepted`인 P0·P1이 없다)에서는 댓글을 읽지 않으므로 이유도 남지 않는다(지금의 P0과 같은 동작이다).
  - 열린 P1만 있는 원장에서도 기록 job과 plan job이 PR 댓글의 편집 이력을 읽는다(`loadAccepted`가 GraphQL을 부른다). 읽지 못하면 지금의 P0과 같은 길로 닫힌 쪽이다(기록 job은 원장을 쓰지 않고 `review-ledger`가 `error`).

### 2. 주석 (`scripts/ci/owner-accept.ts`, `scripts/ci/accept-load.ts`, `scripts/ci/ledger.ts`)

"P0"만 적은 주석을 "P0·P1"로 맞춘다: `owner-accept.ts`의 첫 줄과 `needsAccepts`의 주석, `accept-load.ts`의 `loadAccepted` 주석, `ledger.ts`의 `ENTRY_STATUSES` 주석과 `ledgerStatus` 주석. 이 세 파일에서 코드가 바뀌는 곳은 1절의 두 함수뿐이다. `ledger.ts`와 `accept-load.ts`는 주석만 바뀐다.

### 3. 테스트

- `scripts/test/owner-accept.test.ts`:
  - 열린 P1이 승인으로 `accepted`가 된다(처리 칸 문구 포함). P0과 P1이 함께 열린 원장에서 두 승인이 모두 반영된다.
  - 반영하지 않는 경우: P2(`deferred`), P3(`deferred`), 상태가 `open`인 P2(손으로 만든 원장)는 `'차단 지적(P0·P1)이 아니다'`. `deferred`·`fixed`·`rejected`인 P1은 `'열린 지적이 아니다'`. 게시 시각이 없는 P1, 게시 시각과 같거나 앞선 시각의 승인은 P0과 같은 이유로 반영되지 않는다.
  - `accepted`인 P1에 이번에 인정된 승인이 없으면 `open`으로 돌아가고 `reopened`에 든다.
  - 제작자가 아닌 계정(PR 작성자인 봇 계정 포함)의 승인 줄 댓글, 고쳐진 댓글, 승인 줄 말고 다른 글이 있는 댓글(반박 세 줄 문단 안에 승인 줄을 넣은 것 포함)은 P1에도 승인이 아니다.
  - `needsAccepts`: 열린 P1만 있으면 참, `accepted`인 P1만 있으면 참, `fixed`·`rejected`·`deferred`인 P1만 있으면 거짓, P2·P3만 있으면 거짓.
- `scripts/test/accept-load.test.ts`:
  - 열린 P1만 있는 원장에서 `loadAccepted`가 GraphQL을 한 번 부르고 승인을 반영한다.
  - 볼 지적이 없는 원장(`deferred`인 P2만, `fixed`인 P1만)에서는 GraphQL을 부르지 않는다.
  - 열린 P1만 있는 원장에서 GraphQL 읽기가 실패하면 예외가 그대로 올라온다(닫힌 쪽).
- `scripts/test/accept-cli.test.ts`(기록 job을 명령으로 부르는 테스트):
  - 열린 P1 하나가 있는 원장에 제작자의 승인 댓글이 있으면 원장 표의 그 행이 `accepted`가 되고 `review-ledger`가 `success`다(상태 설명에 `제작자 승인 1`). 같은 원장에 봇 계정의 승인 줄 댓글만 있으면 `open`으로 남고 `review-ledger`가 `failure`다.
  - 거부 이유의 로그: 열린 P1(F1)과 `deferred`인 P2(F2)가 함께 있는 원장에서 제작자가 두 지적을 모두 승인하는 댓글을 달면, F1은 `accepted`가 되고 F2는 `deferred` 그대로이며, 출력에 `record-review: 제작자 승인 무시 F2(댓글 <id>): 차단 지적(P0·P1)이 아니다` 줄이 있다.
  - 조회를 건너뛰는 원장: `fixed`인 P1만 있는 원장에 제작자의 승인 줄 댓글이 있어도 댓글을 읽지 않는다. 단언하는 것은 셋이다: (1) 가짜 GraphQL이 불린 횟수가 0이다(테스트 도우미가 횟수를 세지 않으면 세게 한다). (2) 저장된 원장에서 그 P1 행의 상태(`fixed`)와 처리 칸의 글이 실행 전과 같다. (3) 출력에 `record-review: 제작자 승인`으로 시작하는 줄이 없다(승인·무시·철회 기록의 공통 접두사다). 원장 전체가 그대로라고 단언하지 않는다: 기록 명령은 이번 판정을 반영해 판정 라운드를 더하고 원장을 다시 저장하는 것이 정상이다. 거부 이유는 댓글을 읽는 원장(열렸거나 `accepted`인 P0·P1이 하나라도 있는 원장)에서만 남는다.
- `scripts/test/ledger-accept.test.ts`(이 파일에만 더한다. `scripts/test/ledger.test.ts`는 고치지 않는다):
  - 아래 테스트는 모두 **열린 P1에 `applyOwnerAccepts`로 승인을 반영한 원장**을 입력으로 쓴다(손으로 `accepted`를 적은 원장을 쓰지 않는다). 지금 코드에서는 P1이 `accepted`가 되지 않으므로 구현 전에 실패한다. `ledgerStatus`와 `applyVerdict`는 이 step에서 동작이 바뀌지 않으므로, 손으로 만든 `accepted` 원장만 쓰는 테스트는 변경 전 코드에서도 통과해 `test-effect`가 그 파일을 막는다. `test-effect` 예외 줄은 쓰지 않는다.
  - `ledgerStatus`: 승인이 반영된 P1만 있으면 `success`이고 설명에 `제작자 승인 1`이 있다. 승인이 반영된 P1과 `open`인 다른 P1이 함께 있으면 `failure`다.
  - 승인이 반영된 P1은 그 지적을 낸 검증자의 판정(`resolutions`의 `open`·`fixed`·`rejected`, 같은 위치·제목의 재등록)으로 바뀌지 않는다.
  - 새 지적은 있던 등록 규칙(동결 포함)을 그대로 따른다. 승인이 반영된 P1을 낸 검증자의 2라운드 이후 판정에서: (가) 직전 판정 이후 **바뀐 파일**에 대한, 위치나 제목이 다른 새 P1은 새 ID로 등록되고 `open`이다(다시 막는다). (나) 직전 판정 이후 **바뀌지 않은 파일**에 대한 재현되지 않은 새 P1은 새 ID로 등록되지만 `deferred`다(막지 않는다. 설계서 10.2절 (5)의 동결). (다) 새 P0은 파일이 바뀌었든 아니든 `open`이다.
- 있던 단언 가운데 고치는 것은 **"P1은 승인되지 않는다"를 전제한 것뿐**이다(예: `owner-accept.test.ts`의 "반영하지 않는 경우" 표의 P1 행과 문구 `'P0이 아니다'`, `needsAccepts` 테스트의 P1 줄, `accept-load.test.ts`의 "볼 지적이 없으면 GraphQL을 부르지 않는다"의 P1 원장, `accept-cli.test.ts`의 "P0이 아닌 지적" 사례). 그 자리의 P1을 P2로 바꾸거나 기대값을 새 동작으로 바꾼다. 고친 테스트의 파일과 이름을 진행 로그에 적는다. 그 밖의 있던 단언은 지우거나 약하게 하지 않는다.

### 4. 문서

- `docs/harness/design.md` 10.2절 (4):
  - `accepted`의 정의를 "제작자가 남은 위험을 받아들인 P0·P1"로 고친다. 조건 가운데 "그 지적이 `open`인 P0이고"를 "`open`인 P0 또는 P1이고"로 고친다.
  - "P1에는 쓰지 않는다." 문장을 지우고 그 자리에 적는다: P1에도 쓴다는 것과 이유(되돌릴 수 없는 절차에 대한 지적처럼 고칠 수 없는 P1의 교착을 제작자가 풀 수 있어야 한다. Issue #178, PR #171의 F28), P2·P3과 동결돼 `deferred`인 P1은 병합을 막지 않으므로 대상이 아니라는 것, 봇과 검증자는 이 길을 쓸 수 없다는 것(B11, R20).
  - 병합 조건 줄을 "P0·P1 지적이 모두 `fixed`·`rejected`·`accepted` 가운데 하나다"로 고친다.
  - 머리의 버전 줄(`> 버전 v…`)의 패치 자리를 올리고 변경 기록에 `- v<새 번호> (<날짜>): …` 줄을 더한다(번호는 올릴 때 main의 다음 번호). 그 줄에 `Issue #178`을 적는다.
  - 5절의 B11 행은 고치지 않는다(제작자 승인을 "다른 근거"의 하나로 이미 적고 있다).
- `docs/harness/workflow.md` 8절:
  - "오래 열린 지적" 문단의 "남은 위험을 받아들이는 승인은 P0에만 있다" 문장을 "제작자는 선택지 말고 남은 위험을 받아들일 수도 있다(아래 '제작자 승인')"는 뜻으로 고친다.
  - "제작자 승인(P0)" 항목의 제목을 `**제작자 승인(P0·P1)**`으로 고치고, "P0의 교착에서"를 "P0·P1의 교착이나 오래 열린 지적에서"로, "승인은 P0에만 쓴다"를 "승인은 열린 P0·P1에 쓴다"로 고친다.
  - 같은 항목에 봇의 지침을 더한다: 지적대로 고칠 수 있으면 고친다. 봇은 교착(반박 2회)이나 오래 열린 지적에서만 승인을 선택지의 하나로 제작자에게 제시하고, 고르는 것은 제작자다.
- `scripts/cross-review/ledger.md`: 상태 표의 `accepted` 행, 절 제목(`## 제작자 승인 (P0·P1)`), 그 절의 첫 문장과 "대상은 … P0뿐이다" 줄, "열린 P0도 `accepted`도 없는 원장에서는 편집 이력을 읽지 않는다" 줄, "규칙" 절의 "`accepted`인 P0은 막지 않고" 줄을 P0·P1로 맞춘다.
- `docs/harness/architecture.md`: `ci/*` 행의 `owner-accept.ts` 설명 "(P0 → `accepted`, 순수 함수)"를 "(P0·P1 → `accepted`, 순수 함수)"로 고친다.
- `docs/harness/CHANGELOG.md`의 `## 다음 버전 (미배포)` 절 끝에 한 줄을 더한다. `Issue #178`과 새 설계서 버전, "관문을 푸는 길을 제작자에게 하나 더한다(완화). 봇과 검증자는 쓸 수 없다"를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/owner-accept.test.ts scripts/test/accept-load.test.ts scripts/test/accept-cli.test.ts scripts/test/ledger-accept.test.ts scripts/test/ledger.test.ts scripts/test/ledger-store.test.ts
node scripts/harness.ts test-effect
b=$(git merge-base HEAD origin/main) && test -z "$(git diff --name-only "$b" -- scripts/test/ledger.test.ts scripts/test/ledger-store.test.ts)"
grep -qF "차단 지적(P0·P1)이 아니다" scripts/test/accept-cli.test.ts && grep -q "applyOwnerAccepts" scripts/test/ledger-accept.test.ts && test "$(grep -c "^- test-effect 예외:" docs/exec-plans/active/20261121-owner-accept-p1/plan.md)" -eq 0
test "$(grep -c "P0이 아니다" scripts/ci/owner-accept.ts)" -eq 0 && grep -qF "차단 지적(P0·P1)이 아니다" scripts/ci/owner-accept.ts && grep -qF "차단 지적(P0·P1)이 아니다" scripts/test/owner-accept.test.ts
b=$(git merge-base HEAD origin/main) && test -z "$(git diff --name-only "$b" -- scripts/cross-review/prompt.md scripts/ci/rebuttal.ts scripts/ci/ledger-store.ts scripts/runner scripts/commands .github harness.config.json)"
b=$(git merge-base HEAD origin/main) && test "$(git diff "$b" -- scripts/ci/ledger.ts scripts/ci/accept-load.ts | grep -E '^[+-][^+-]' | grep -vcE '^[+-][[:space:]]*(//|/\*|\*)')" -eq 0
test "$(grep -c "P1에는 쓰지 않는다" docs/harness/design.md)" -eq 0 && grep -qF "제작자가 남은 위험을 받아들인 P0·P1" docs/harness/design.md
b=$(git merge-base HEAD origin/main) && old=$(git show "$b:docs/harness/design.md" | sed -n 's/^> 버전 v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\) .*/\1/p' | head -n 1) && new=$(sed -n 's/^> 버전 v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\) .*/\1/p' docs/harness/design.md | head -n 1) && test -n "$old" && test -n "$new" && test "$old" != "$new" && test "$(printf '%s\n%s\n' "$old" "$new" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$new"
new=$(sed -n 's/^> 버전 v\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\) .*/\1/p' docs/harness/design.md | head -n 1) && test -n "$new" && grep -F -- "- v$new (" docs/harness/design.md | grep -qF "Issue #178"
grep -qF "**제작자 승인(P0·P1)**" docs/harness/workflow.md && test "$(grep -c "승인은 P0에만" docs/harness/workflow.md)" -eq 0
grep -q "^## 제작자 승인 (P0·P1)$" scripts/cross-review/ledger.md && test "$(grep -c "P0뿐이다" scripts/cross-review/ledger.md)" -eq 0 && test "$(grep -c "받아들인 P0이다" scripts/cross-review/ledger.md)" -eq 0
grep -qF "(P0·P1 → \`accepted\`, 순수 함수)" docs/harness/architecture.md
awk '/^## 다음 버전/{s=1;next} /^## /{s=0} s' docs/harness/CHANGELOG.md | grep -F "Issue #178" | grep -qF "완화"
node scripts/harness.ts check
```

## 금지사항

- 승인 댓글을 인정하는 조건(제작자 계정, 본문이 승인 줄뿐, 고쳐지지 않음이 확인됨, 지적이 게시된 뒤)을 느슨하게 하지 마라. 이유: 이 조건이 봇과 주입된 글이 관문을 여는 것을 막는다(B11, R20). 이 step은 대상 등급만 넓힌다.
- P2·P3이나 `deferred`·`fixed`·`rejected`인 지적을 승인 대상으로 넣지 마라. 이유: 병합을 막지 않는 지적이라 닫을 것이 없고, 대상이 넓어지면 승인의 뜻이 흐려진다.
- 검증자 프롬프트(`scripts/cross-review/prompt.md`)를 고치지 마라. 이유: `accepted`에 대한 지시가 등급과 무관하게 이미 있다. 프롬프트를 바꾸면 열려 있는 PR들의 판정 기준이 함께 바뀐다.
- 제작자 계정의 댓글 글을 검증자 입력에 넣지 마라. 이유: 자유 글이 검증자에게 가는 길이 생긴다(10.2절 (4) "반박 형식"). 제작자가 고르지 않은 방법이다.
- 반박(`scripts/ci/rebuttal.ts`)과 runner(`scripts/runner/**`), `pr-state`의 동작을 고치지 마라. 이유: 범위 밖이다. runner의 교착 보고 문구에 승인 선택지를 더하는 일은 발견 사항으로 남긴다.
- "P1은 승인되지 않는다"를 전제한 것 말고는 있던 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
- `test-effect` 예외 줄을 쓰지 마라. 이유: 고치는 테스트 파일 넷은 모두 새 동작(P1 승인)을 단언하므로 변경 전 코드에서 실패해야 한다. 예외가 필요해졌다면 테스트가 새 동작을 보지 않는다는 뜻이다.
- 새 지적의 등록 규칙(등급 내림, 동결, 가득 찬 원장)을 고치지 마라. 이유: 승인된 지적 뒤에 나온 새 지적이 막는지는 있던 규칙이 정한다. 이 step은 그 규칙을 바꾸지 않는다.
- `.github/workflows/`와 `harness.config.json`을 고치지 마라. 이유: 필요 없다. 워크플로는 제작자가 적용한다.
