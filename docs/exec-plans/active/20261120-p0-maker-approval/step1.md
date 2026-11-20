# Step 1: accept-wire

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 앞 step에서 만든·바꾼 파일: `scripts/ci/owner-accept.ts`(`ownerAccepts`, `applyOwnerAccepts`), `scripts/ci/ledger.ts`(`accepted`, `openedAt`, `ApplyOptions.now`), `scripts/test/owner-accept.test.ts`, `scripts/test/ledger-accept.test.ts`
- `scripts/ci/ledger-store.ts`(`ledgerFromComments`, `loadLedger`, `recordLedger`, `recordCiFailure`), `scripts/test/ledger-store.test.ts`(가짜 API의 본보기)
- `scripts/harness.ts`의 `review-plan`·`record-review`·`plan-gate`·`ledger-ci-failure`(원장을 읽는 곳), `scripts/runner/ledger-read.ts`, `scripts/runner/divergence.ts`
- `scripts/cross-review/prompt.md`("라운드 규칙"), `scripts/cross-review/prompt-codex.md`, `scripts/cross-review/ledger.md`
- `docs/harness/design.md` 10.2절 (4), `docs/harness/workflow.md` 8절, `docs/SECURITY.md`의 "워크플로 변경"(이 step은 워크플로를 고치지 않는다는 것을 확인하려고 읽는다)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 원장을 읽는 공통 경로 `scripts/ci/ledger-store.ts`

- `ledgerFromComments(comments, recorderBot, owner?)`: 셋째 인자(제작자 계정)를 주면, 고른 원장에 `applyOwnerAccepts(원장, ownerAccepts(comments, owner))`를 적용한 원장을 돌려준다. `StoredLedger`에 선택 필드 `accepts?: { applied; ignored; reopened }`와 `changed?: boolean`(승인 반영으로 저장된 원장과 달라졌는가)을 더한다. `owner`를 주지 않거나 빈 문자열이면 지금과 같다(승인을 보지 않는다. 이미 `accepted`인 지적도 건드리지 않는다).
- `Where`에 선택 필드 `owner?: string`을 더하고 `loadLedger`가 그대로 넘긴다.
- `recordLedger`:
  - 읽은 원장(승인이 반영된 것)에 판정을 적용할 때 `applyVerdict`에 `now`를 넘긴다. `now`는 `RecordLedgerOptions`의 선택 필드 `now?: () => Date`로 받고 기본값은 지금 시각이다.
  - 판정을 적용한 뒤 `applyOwnerAccepts`를 한 번 더 적용한다(같은 실행에서 검증자가 다시 연 지적이 있어도 결과가 같게).
  - 저장 직전에 `open`인데 `openedAt`이 없는 지적(이 필드가 생기기 전의 원장)에 `now`를 채운다.
  - 저장 여부는 지금처럼 "댓글에 저장된 원장과 달라졌는가"로 정한다. 승인만 반영돼 달라진 경우도 저장한다. 판정이 없는 기록(해당 없음, 이어받음, error)에서도 같다.
  - 원장이 없으면 승인 댓글이 있어도 원장을 만들지 않는다.
- `recordCiFailure`: 원장을 읽을 때 `owner`를 넘기지 않는다(실패 기록은 승인과 무관하고, 저장된 원장을 그대로 고쳐 쓴다).

### 2. 호출하는 곳 `scripts/harness.ts`, `scripts/runner/ledger-read.ts`

- `review-plan`(plan job): `ledgerFromComments(comments, recorderBot, cfg.github.owner)`. 판정 job에 넘기는 원장과 반박 판별(`parseRebuttals`)이 승인이 반영된 원장을 쓴다. 로그 한 줄: `review-plan: 제작자 승인 N건(F…)`(0건이면 쓰지 않는다).
- `record-review`(기록 job): `recordLedger`에 `owner: cfg.github.owner`. 반영·무시·철회를 로그에 한 줄씩 적는다: `record-review: 제작자 승인 F6(댓글 123)`, `record-review: 제작자 승인 무시 F7(댓글 124): <이유>`, `record-review: 제작자 승인 철회 F6`. 로그에 댓글 본문은 적지 않는다.
- `plan-gate`: `loadLedger`에 `owner`를 넘기지 않는다(계획 승인만 읽는다).
- `scripts/runner/ledger-read.ts`의 `readPrLedger`: 저장된 원장을 그대로 읽는다(승인을 다시 계산하지 않는다). 로컬에서 읽는 댓글 목록(`gh`)에는 `updated_at`이 없을 수 있어 같은 판별을 보장하지 못한다. 기록 job이 저장한 결과만 믿는다.
- `harness.ts`의 수정은 인자를 넘기고 로그를 쓰는 줄에 그친다. 판별 로직을 `harness.ts`에 두지 않는다.

### 3. 수렴 판정과 프롬프트

- `scripts/runner/divergence.ts`: 해소된 지적의 셈에 `accepted`를 넣는다(대응 전에 열려 있던 지적이 지금 `fixed`·`rejected`·`accepted`).
- `scripts/cross-review/prompt.md`의 "라운드 규칙"에 한 항목을 더한다: 상태가 `accepted`인 지적은 제작자가 남은 위험을 받아들인 것이다. `resolutions`에 판정을 내지 말고 `findings`에 다시 적지 마라. 그 뒤에 바뀐 코드에서 다른 결함을 찾았으면 새 지적으로 낸다. `prompt-codex.md`에 라운드 규칙이 따로 있으면 같은 줄을 더한다.

### 4. 문서

- `docs/harness/design.md` 10.2절 (4): 상태 목록의 `rejected` 줄에서 "제작자가 승인해야"를 떼어 `accepted` 줄로 옮긴다. 내용: P0에만 쓴다, 제작자 계정의 고쳐지지 않은 PR 댓글의 `/harness accept F<번호>` 한 줄, 지적이 열린 뒤에 단 것만, 다음 판정 실행에서 반영, 댓글이 지워지거나 고쳐지면 다시 열림, 검증자의 판정으로 바뀌지 않음, head에 묶지 않는 이유 한 줄. "병합 조건" 줄에 `accepted`를 더한다. "구현" 목록에 `scripts/ci/owner-accept.ts`를 더한다.
- `docs/harness/design.md` 0절 버전 이력과 `docs/harness/CHANGELOG.md`에 한 줄(번호는 push할 때 main의 다음 번호. 다른 PR이 먼저 병합되면 `origin/main`을 병합하고 다시 잡는다).
- `scripts/cross-review/ledger.md`: "숨은 자료"의 지적 필드에 `openedAt`, "상태" 표에 `accepted`, "판정 반영 규칙"에 승인 규칙.
- `docs/harness/workflow.md` 8절 "교착": P0의 교착에서 제작자가 고를 수 있는 것으로 "남은 위험을 받아들인다(PR에 `/harness accept F<번호>` 한 줄 댓글)"를 더하고, "효과" 줄의 "P0은 두 검증자가 모두 동의해야 닫힌다"에 제작자 승인을 더한다. 승인을 요청할 때 제작자에게 알릴 것(지적 ID, 무엇을 받아들이는 것인지, 댓글은 새로 달고 고치지 않는다, 다음 판정에서 반영된다)을 적는다.
- 설계서 5절 표, 10.3절, `docs/SECURITY.md`는 고치지 않는다.

### 5. 테스트

- `scripts/test/ledger-store-accept.test.ts`(새 파일, 가짜 API): 수용 기준 6·7의 경우. (a) 제작자의 승인 댓글이 있는 댓글 목록에서 `ledgerFromComments(…, owner)`가 `accepted`를 돌려주고 `owner` 없이는 `open`을 돌려준다. (b) `recordLedger`가 판정 없이도(이어받음) 승인을 저장하고 `review-ledger`를 success로 기록한다. (c) 같은 실행의 판정이 그 지적을 `open`으로 답해도 저장된 상태는 `accepted`다. (d) 승인 댓글이 사라진 목록으로 다시 기록하면 `open`으로 저장되고 `review-ledger`가 failure다. (e) `openedAt`이 없는 열린 지적은 첫 기록에서 `now`로 채워지고, 그보다 앞선 승인 댓글은 반영되지 않는다. (f) 봇 계정·PR 작성자·검증 App이 단 같은 줄은 반영되지 않는다. (g) 원장이 없으면 승인 댓글만으로 댓글을 만들지 않는다.
- `scripts/test/divergence.test.ts`: `accepted`가 해소로 세지는 경우를 더한다(새 `test(...)`로).

## Acceptance Criteria

```bash
node --test scripts/test/ledger-store-accept.test.ts
node --test scripts/test/ledger-store.test.ts
node --test scripts/test/owner-accept.test.ts
node --test scripts/test/ledger-accept.test.ts
node --test scripts/test/divergence.test.ts
grep -q "/harness accept F" docs/harness/design.md
grep -q "accepted" scripts/cross-review/ledger.md
grep -q "accepted" scripts/cross-review/prompt.md
grep -q "/harness accept F" docs/harness/workflow.md
node scripts/harness.ts lint
node scripts/harness.ts fmt --check
node scripts/harness.ts doc-lint
```

## 금지사항

- `.github/workflows/`를 고치지 마라. 이유: 운영 단계에서 워크플로 변경은 제작자가 직접 커밋하는 절차가 따로 있고, 이 기능은 지금 워크플로의 입력만으로 동작한다(계획의 수용 기준 7).
- `scripts/ci/verdict.ts`의 `verdictStatus`와 `scripts/ci/record.ts`의 `recordReview`를 고치지 마라. 이유: `review/*`는 검증자의 판정 그대로여야 한다. 승인은 원장에만 반영한다.
- 승인 판별을 `scripts/ci/owner-accept.ts` 밖에 다시 구현하지 마라. 이유: plan job과 기록 job이 다른 결과를 내면 검증자가 본 원장과 저장된 원장이 어긋난다.
- 댓글 본문이나 토큰을 로그·상태 설명에 넣지 마라. 이유: 댓글은 외부 입력이고(14.6절), 러너의 워크플로 명령 줄을 만들 수 있다. 로그에는 지적 ID, 댓글 id, 고정된 이유 문자열만 쓴다.
- `scripts/metrics/`를 고치지 마라. 이유: 다른 계획(Issue #146)의 범위다.
- 기존 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
