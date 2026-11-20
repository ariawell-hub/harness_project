# Step 0: accept-ledger

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 10.2절 (4)(지적 원장), 3절 B11
- `scripts/ci/ledger.ts`(`Entry`, `applyVerdict`, `ledgerStatus`, `renderLedger`, `validEntry`, `parseLedger`), `scripts/test/ledger.test.ts`(테스트의 본보기)
- `scripts/ci/ledger-store.ts`의 `IssueComment`
- `scripts/runner/next.ts`의 `hasAcceptLine`·`FENCE`(펜스 코드 블록을 건너뛰는 줄 판별의 선례. `scripts/ci/`에서 `scripts/runner/`를 가져오지 않는다. 같은 규칙을 새 파일에 둔다)
- `scripts/runner/next.ts`의 `sameLogin`(계정 이름 비교의 선례: 대소문자 무시, 빈 문자열은 같지 않다. 가져오지 않고 같은 규칙을 새 파일에 둔다)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 이 step은 순수 함수만 만든다. 원장을 읽고 쓰는 경로(`ledger-store.ts`, `harness.ts`)에는 잇지 않는다.

### 1. 원장의 상태와 시각 `scripts/ci/ledger.ts`

- `ENTRY_STATUSES`에 `'accepted'`를 더한다. 뜻: 제작자가 남은 위험을 받아들인 P0.
- `Entry`에 선택 필드 `openedAt?: string`을 더한다. 그 지적이 마지막으로 `open`이 된 시각(ISO 8601, UTC)이다.
  - `validEntry`: 이 필드가 없는 지적(기존 원장)도, 있는 지적도 읽는다. 있으면 `Date.parse`가 되는 80자 이하의 문자열이어야 한다. 그 밖의 모르는 키가 있으면 지금처럼 원장으로 읽지 않는다.
- `ApplyOptions`에 선택 필드 `now?: string`(ISO)을 더한다. `applyVerdict`는 `now`가 있으면 아래 경우에 그 지적의 `openedAt`을 `now`로 적는다: 새 지적을 `open`으로 등록할 때, 닫힌 지적(`fixed`·`rejected`)을 재등록으로 다시 열 때, 검증자의 `resolutions`가 `fixed`·`rejected`인 지적을 `open`으로 되돌릴 때. 이미 `open`인 지적의 `openedAt`은 바꾸지 않는다. `now`가 없으면 `openedAt`을 건드리지 않는다(지금 동작).
- `applyVerdict`는 `accepted`인 지적을 `deferred`처럼 다룬다: `resolutions`로 바꾸지 않고(P0의 `rejected` 동의도 기록하지 않는다), 같은 검증자·위치·제목의 지적이 다시 와도 상태를 바꾸지 않는다(재현 결과만 갱신하는 지금 동작은 그대로).
- `ledgerStatus`: `accepted`는 막지 않는다. 통과 설명에 `accepted`가 하나라도 있으면 `제작자 승인 N`을 더한다(예: `차단 지적 없음 (전체 6, 미룸 1, 제작자 승인 1)`). 없으면 지금 문자열 그대로다.
- `renderLedger`의 표는 상태 칸에 `accepted`를 그대로 적는다(다른 상태와 같다).

### 2. 승인 댓글 `scripts/ci/owner-accept.ts`(새 파일)

```ts
import type { IssueComment } from './ledger-store.ts'; // created_at·updated_at은 이 step에서 타입에 더한다(선택 필드, unknown)
import type { Ledger } from './ledger.ts';

/** 승인 줄의 머리. 줄 전체가 `/harness accept F<번호>`여야 한다 */
export const ACCEPT_PREFIX = '/harness accept';

export interface Accept {
  /** F<번호> */
  id: string;
  /** 승인 댓글의 id */
  commentId: number;
  /** 댓글이 달린 시각(REST created_at) */
  at: string;
}

/** 댓글 본문에서 승인 줄의 지적 ID를 고른다(중복 없이, 나온 순서) */
export function acceptIds(body: string): string[];

/** 제작자 계정이 달았고 한 번도 고쳐지지 않은 댓글의 승인만 고른다 */
export function ownerAccepts(comments: readonly IssueComment[], owner: string): Accept[];

export interface AcceptOutcome {
  ledger: Ledger;
  /** 이번에 반영됐거나 유지된 승인 */
  applied: Accept[];
  /** 반영하지 않은 승인과 이유(로그용. 이유는 고정된 문자열 가운데 하나) */
  ignored: { id: string; commentId: number; reason: string }[];
  /** 승인이 없어져 open으로 되돌린 지적 ID */
  reopened: string[];
}

/** 원장에 승인을 반영한 새 원장을 돌려준다(입력은 바꾸지 않는다) */
export function applyOwnerAccepts(l: Ledger, accepts: readonly Accept[]): AcceptOutcome;
```

- `acceptIds`: 줄마다 `\r`을 떼고 앞뒤 공백을 뺀 값이 정규식 `^/harness accept F[1-9]\d{0,5}$`와 맞아야 한다. 펜스 코드 블록(` ``` `·`~~~`, 3칸까지 들여쓰기) 안의 줄은 건너뛰고, 닫히지 않은 펜스는 끝까지 코드로 본다. 인용(`> …`), 문장 속 언급, 인라인 코드, ID가 둘인 줄, ID가 없는 `/harness accept`는 맞지 않는다.
- `ownerAccepts`: 댓글 하나가 인정되는 조건은 모두 맞아야 한다. (a) `owner`가 빈 문자열이 아니다. (b) `user.login`이 문자열이고 `owner`와 같은 계정이다(대소문자 무시. 빈 문자열은 어느 것과도 같지 않다). (c) `id`가 양의 정수다. (d) `created_at`·`updated_at`이 문자열이고 서로 같으며 `Date.parse`가 된다. (e) `body`가 문자열이다. 하나라도 어긋나면 그 댓글은 통째로 버린다. 같은 ID의 승인이 여러 댓글에 있으면 가장 늦게 달린 것 하나를 쓴다.
- `applyOwnerAccepts`:
  - 승인의 ID가 원장에 없으면 `ignored`(이유 `원장에 없는 지적`).
  - 지적이 P0이 아니면 `ignored`(`P0이 아니다`).
  - 지적이 `open`도 `accepted`도 아니면 `ignored`(`열린 지적이 아니다`).
  - 지적에 `openedAt`이 없거나, 승인의 `at`이 `openedAt`보다 **엄격히 뒤**가 아니면 `ignored`(`지적이 열린 뒤에 단 댓글이 아니다`). 시각은 `Date.parse` 값으로 비교한다. 같은 시각은 뒤로 보지 않는다.
  - 위를 모두 지나면 그 지적의 상태를 `accepted`로, 처리 칸(`note`)을 `제작자 승인(댓글 <commentId>)`으로 적고 `applied`에 넣는다.
  - 원장에서 `accepted`인데 이번에 `applied`에 들지 못한 지적은 `open`으로 되돌리고 처리 칸에 `제작자 승인이 없어져 다시 열림`을 적고 `reopened`에 넣는다. `openedAt`은 바꾸지 않는다(같은 댓글이 되살아나도 다시 인정된다).
  - 같은 입력에 두 번 적용해도 결과가 같다(멱등).
- 이 파일은 네트워크·파일·환경 변수·시계를 쓰지 않는다.

### 3. 테스트(새 파일)

- `scripts/test/owner-accept.test.ts`: `acceptIds`(맞는 줄, 펜스 안, 닫히지 않은 펜스, 인용, 문장 속, 인라인 코드, ID 둘, ID 없음, `F0`·`F01`, CRLF), `ownerAccepts`(다른 계정, 대소문자만 다른 제작자, 고쳐진 댓글, 시각이 없거나 깨진 댓글, `owner`가 빈 문자열, 같은 ID의 여러 댓글), `applyOwnerAccepts`(수용 기준 1·3·4의 경우마다 하나씩, 멱등, 입력 불변).
- `scripts/test/ledger-accept.test.ts`: `accepted`가 든 원장의 렌더 → 파싱 왕복, `openedAt`이 없는 원장과 있는 원장을 모두 읽는 것, 깨진 `openedAt`·모르는 키는 읽지 않는 것, `ledgerStatus`(막지 않음과 설명 문자열, `accepted`가 없을 때 문자열이 전과 같음), `applyVerdict`가 `accepted`를 판정으로 바꾸지 않는 것(자기 지적의 `open`·`fixed`·`rejected`, 다른 검증자의 `rejected`, 같은 지적의 재등록), `now`를 줬을 때와 주지 않았을 때의 `openedAt`.
- `docs/harness/architecture.md`의 파일 표에 `ci/owner-accept.ts`를 더한다(`doc-lint`가 요구하면 그 형식대로).

## Acceptance Criteria

```bash
node --test scripts/test/owner-accept.test.ts
node --test scripts/test/ledger-accept.test.ts
node --test scripts/test/ledger.test.ts
node --test scripts/test/ledger-store.test.ts
node scripts/harness.ts lint
node scripts/harness.ts fmt --check
node scripts/harness.ts doc-lint
```

## 금지사항

- `scripts/ci/ledger-store.ts`의 함수 동작, `scripts/harness.ts`, `.github/workflows/`를 고치지 마라(`IssueComment` 타입에 선택 필드를 더하는 것만 된다). 이유: 이 step은 병합돼도 CI의 동작이 바뀌지 않아야 한다. 연결은 step1이다.
- 댓글 작성자만 보고 승인을 인정하지 마라. 이유: 쓰기 권한 계정은 남의 댓글을 고칠 수 있다(TD-26). 고쳐진 댓글은 누가 고쳤든 버린다.
- 검증자의 판정(`resolutions`, `rejectedBy`)으로 `accepted`가 되게 하지 마라. 이유: B11. `accepted`는 `applyOwnerAccepts`만 만든다.
- P1~P3 지적을 승인 대상에 넣지 마라. 이유: 설계서 10.2절이 제작자 승인을 둔 것은 P0뿐이다(계획의 비범위).
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라. 이유: R4. 새 동작의 테스트는 새 파일에 둔다.
