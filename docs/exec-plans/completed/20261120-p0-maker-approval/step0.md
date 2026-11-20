# Step 0: accept-ledger

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 10.2절 (4)(지적 원장), 3절 B11
- 이 계획의 `plan.md`("목표와 수용 기준", 의사결정 로그)
- `scripts/ci/ledger.ts`(`Entry`, `applyVerdict`, `ledgerStatus`, `renderLedger`, `validEntry`, `parseLedger`), `scripts/test/ledger.test.ts`(테스트의 본보기)
- `scripts/runner/next.ts`의 `sameLogin`(계정 이름 비교의 선례: 대소문자 무시, 빈 문자열은 같지 않다. `scripts/ci/`에서 `scripts/runner/`를 가져오지 않는다. 같은 규칙을 새 파일에 둔다)
- `scripts/lib/github.ts`의 `RawContent`·`toContentHistory`(GraphQL 편집 이력 필드의 뜻)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 이 step은 순수 함수만 만든다. 원장을 읽고 쓰는 경로(`ledger-store.ts`, `harness.ts`)에는 잇지 않는다.

### 1. 원장의 상태와 게시 시각 `scripts/ci/ledger.ts`

- `ENTRY_STATUSES`에 `'accepted'`를 더한다. 뜻: 제작자가 남은 위험을 받아들인 P0.
- `Entry`에 선택 필드 `openedAt?: string`을 더한다. 그 지적이 `open`인 채로 원장 댓글에 게시된 것이 확인된 시각(GitHub이 준 ISO 8601 시각)이다. 이 step의 어떤 함수도 이 값을 채우지 않는다(채우는 것은 step1이 원장을 읽을 때 한다).
  - `validEntry`: 이 필드가 없는 지적(기존 원장)도, 있는 지적도 읽는다. 있으면 `Date.parse`가 되는 40자 이하의 문자열이어야 한다. 그 밖의 모르는 키가 있으면 지금처럼 원장으로 읽지 않는다.
- `applyVerdict`:
  - 닫힌 지적(`fixed`·`rejected`)이 다시 `open`이 될 때(같은 지적의 재등록, 지적을 낸 검증자의 `resolutions`가 `open`) 그 지적의 `openedAt`을 지운다. 이미 `open`인 지적의 `openedAt`은 건드리지 않는다. 새 지적은 `openedAt` 없이 등록한다.
  - `accepted`인 지적을 `deferred`처럼 다룬다: `resolutions`로 바꾸지 않고(P0의 `rejected` 동의도 기록하지 않는다), 같은 검증자·위치·제목의 지적이 다시 와도 상태를 바꾸지 않는다(재현 결과만 갱신하는 지금 동작은 그대로).
- `ledgerStatus`: `accepted`는 막지 않는다. 통과 설명에 `accepted`가 하나라도 있으면 `제작자 승인 N`을 더한다(예: `차단 지적 없음 (전체 6, 미룸 1, 제작자 승인 1)`). 없으면 지금 문자열 그대로다.
- `renderLedger`의 표는 상태 칸에 `accepted`를 그대로 적는다(다른 상태와 같다).

### 2. 승인 댓글 `scripts/ci/owner-accept.ts`(새 파일)

```ts
import type { Ledger } from './ledger.ts';

/** GraphQL로 읽은 PR 댓글 하나(step1이 채운다). 읽지 못한 필드는 undefined나 null이다 */
export interface AcceptComment {
  databaseId?: unknown;
  author?: { login?: unknown } | null;
  body?: unknown;
  createdAt?: unknown;
  lastEditedAt?: unknown;
  editor?: unknown;
  userContentEdits?: { totalCount?: unknown } | null;
}

export interface Accept {
  /** F<번호> */
  id: string;
  /** 승인 댓글의 id */
  commentId: number;
  /** 댓글이 달린 시각(GraphQL createdAt) */
  at: string;
}

/** 본문 전체가 승인 줄뿐인 댓글에서 지적 ID를 고른다(중복 없이, 나온 순서). 아니면 빈 배열 */
export function acceptIds(body: string): string[];

/** 제작자 계정이 달았고 한 번도 고쳐지지 않은 것이 확인된 댓글의 승인만 고른다 */
export function ownerAccepts(comments: readonly AcceptComment[], owner: string): Accept[];

export interface AcceptOutcome {
  ledger: Ledger;
  /** 이번에 반영됐거나 유지된 승인 */
  applied: Accept[];
  /** 반영하지 않은 승인과 이유(로그용. 이유는 아래 고정된 문자열 가운데 하나) */
  ignored: { id: string; commentId: number; reason: string }[];
  /** 승인이 없어져 open으로 되돌린 지적 ID */
  reopened: string[];
}

/** 원장에 승인을 반영한 새 원장을 돌려준다(입력은 바꾸지 않는다) */
export function applyOwnerAccepts(l: Ledger, accepts: readonly Accept[]): AcceptOutcome;

/** 이 원장에 승인을 볼 지적이 있는가: open이거나 accepted인 P0이 하나라도 있다 */
export function needsAccepts(l: Ledger): boolean;
```

- `acceptIds`: 본문을 `\n`으로 나누고 줄 끝의 `\r`을 뗀다. 공백 문자만 있는 줄은 버린다. 남은 줄이 하나 이상이고 **모든** 줄이 정규식 `^/harness accept F[1-9]\d{0,5}[ \t]*$`와 맞아야 한다(줄 앞에는 공백도 없어야 한다). 한 줄이라도 맞지 않으면 빈 배열이다. 그래서 설명 문장, 인용(`> …`), 목록, 펜스·들여쓰기 코드 블록, HTML 주석이나 태그, ID가 둘인 줄, ID가 없는 `/harness accept`가 든 댓글은 통째로 승인이 아니다. 마크다운 문맥을 해석하지 않는다.
- `ownerAccepts`: 댓글 하나가 인정되는 조건은 모두 맞아야 한다. 하나라도 어긋나면 그 댓글은 통째로 버린다.
  - (a) `owner`가 빈 문자열이 아니다.
  - (b) `author.login`이 문자열이고 `owner`와 같은 계정이다(대소문자 무시. 빈 문자열은 어느 것과도 같지 않다).
  - (c) `databaseId`가 양의 정수다.
  - (d) `createdAt`이 문자열이고 `Date.parse`가 된다.
  - (e) 고쳐지지 않은 것이 확인된다: `lastEditedAt`이 `null`이고(없는 필드 `undefined`는 확인하지 못한 것이다), `editor`가 `null`이고, `userContentEdits`가 객체이며 그 `totalCount`가 정확히 `0`이다.
  - (f) `body`가 문자열이다.
  - 같은 ID의 승인이 여러 댓글에 있으면 가장 늦게 달린 것 하나를 쓴다.
- `applyOwnerAccepts`:
  - 승인의 ID가 원장에 없으면 `ignored`(이유 `원장에 없는 지적`).
  - 지적이 P0이 아니면 `ignored`(`P0이 아니다`).
  - 지적이 `open`도 `accepted`도 아니면 `ignored`(`열린 지적이 아니다`).
  - 지적에 `openedAt`이 없으면 `ignored`(`게시 시각을 모르는 지적`).
  - 승인의 `at`이 `openedAt`보다 **엄격히 뒤**가 아니면 `ignored`(`지적이 게시된 뒤에 단 댓글이 아니다`). 시각은 `Date.parse` 값으로 비교한다. 같은 시각은 뒤로 보지 않는다(GitHub 시각은 초 단위라 순서를 단정할 수 없다).
  - 위를 모두 지나면 그 지적의 상태를 `accepted`로, 처리 칸(`note`)을 `제작자 승인(댓글 <commentId>)`으로 적고 `applied`에 넣는다.
  - 원장에서 `accepted`인데 이번에 `applied`에 들지 못한 지적은 `open`으로 되돌리고 처리 칸에 `제작자 승인이 없어져 다시 열림`을 적고 `reopened`에 넣는다. `openedAt`은 바꾸지 않는다.
  - 같은 입력에 두 번 적용해도 결과가 같다(멱등).
- 이 파일은 네트워크·파일·환경 변수·시계를 쓰지 않는다.

### 3. 테스트(새 파일)

- `scripts/test/owner-accept.test.ts`
  - `acceptIds`: 승인 줄 하나, 여러 줄(빈 줄 사이), CRLF, 줄 끝 공백 / 빈 배열이어야 하는 것: 설명 문장이 함께 있는 댓글, 한 칸·네 칸·탭으로 들여쓴 줄, 펜스 코드 블록 안의 줄, 목록 항목 안의 펜스, 인용, 인라인 코드, HTML 주석 안의 줄, ID 둘, ID 없음, `F0`·`F01`, 빈 본문.
  - `ownerAccepts`: 다른 계정, 대소문자만 다른 제작자, `owner`가 빈 문자열, 고쳐진 댓글의 여러 꼴(`lastEditedAt`만 있음, `editor`만 있음, `totalCount`만 1 이상. **작성 시각과 같은 `lastEditedAt`** 포함), 편집 이력 필드가 없는 댓글(`lastEditedAt`이 `undefined`, `userContentEdits`가 `null`), 시각이 없거나 깨진 댓글, 같은 ID의 여러 댓글.
  - `applyOwnerAccepts`: 수용 기준 1·3·4의 경우마다 하나씩(같은 시각, 앞선 시각, `openedAt` 없음 포함), 멱등, 입력 불변. `needsAccepts`.
- `scripts/test/ledger-accept.test.ts`: `accepted`가 든 원장의 렌더 → 파싱 왕복, `openedAt`이 없는 원장과 있는 원장을 모두 읽는 것, 깨진 `openedAt`·모르는 키는 읽지 않는 것, `ledgerStatus`(막지 않음과 설명 문자열, `accepted`가 없을 때 문자열이 전과 같음), `applyVerdict`가 `accepted`를 판정으로 바꾸지 않는 것(자기 지적의 `open`·`fixed`·`rejected`, 다른 검증자의 `rejected`, 같은 지적의 재등록), 다시 열릴 때 `openedAt`이 지워지고 열린 채인 지적의 `openedAt`은 남는 것, 새 지적에 `openedAt`이 없는 것.
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

- `scripts/ci/ledger-store.ts`, `scripts/harness.ts`, `.github/workflows/`를 고치지 마라. 이유: 이 step은 병합돼도 CI의 동작이 바뀌지 않아야 한다. 연결은 step1이다.
- 댓글 작성자나 REST의 작성·수정 시각만 보고 승인을 인정하지 마라. 이유: 쓰기 권한 계정은 남의 댓글을 고칠 수 있고(TD-26), REST 시각은 초 단위라 같은 초의 편집이 보이지 않는다. 편집 이력 필드로 고쳐지지 않은 것이 확인된 댓글만 받는다.
- 승인 줄 말고 다른 글이 있는 댓글에서 줄을 골라내지 마라. 이유: 그 줄이 GitHub에서 코드·인용·주석으로 보이는지 가릴 수 없다.
- 이 step의 함수가 `openedAt`을 시계(`Date.now`, `new Date()`)로 채우게 하지 마라. 이유: 기준 시각은 원장이 실제로 게시된 시각이어야 한다(계획의 의사결정 로그).
- 검증자의 판정(`resolutions`, `rejectedBy`)으로 `accepted`가 되게 하지 마라. 이유: B11. `accepted`는 `applyOwnerAccepts`만 만든다.
- P1~P3 지적을 승인 대상에 넣지 마라. 이유: 설계서 10.2절이 제작자 승인을 둔 것은 P0뿐이다(계획의 비범위).
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라. 이유: R4. 새 동작의 테스트는 새 파일에 둔다.
