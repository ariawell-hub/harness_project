# Step 1: accept-wire

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준", 의사결정 로그)
- 앞 step에서 만든·바꾼 파일: `scripts/ci/owner-accept.ts`(`AcceptComment`, `ownerAccepts`, `applyOwnerAccepts`, `needsAccepts`), `scripts/ci/ledger.ts`(`accepted`, `openedAt`), `scripts/test/owner-accept.test.ts`, `scripts/test/ledger-accept.test.ts`
- `scripts/ci/ledger-store.ts`(`IssueComment`, `listComments`, `ledgerFromComments`, `loadLedger`, `recordLedger`, `recordCiFailure`, `githubLedgerApi`), `scripts/ci/pr.ts`(`githubGet`), `scripts/test/ledger-store.test.ts`(가짜 API의 본보기)
- `scripts/harness.ts`의 `review-plan`(plan job이 원장을 읽어 job 출력 `ledger=`로 내는 부분)과 `record-review`, `scripts/test/record.test.ts`(명령을 자식 프로세스로 띄우고 `GITHUB_API_URL`을 로컬 HTTP 서버로 돌리는 테스트의 본보기)
- `scripts/runner/ledger-read.ts`, `scripts/runner/divergence.ts`, `scripts/test/divergence.test.ts`
- `scripts/cross-review/prompt.md`("라운드 규칙"), `scripts/cross-review/prompt-codex.md`, `scripts/cross-review/ledger.md`
- `docs/harness/design.md` 10.2절 (4), `docs/harness/workflow.md` 8절

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 게시 시각 `scripts/ci/ledger-store.ts`

- `IssueComment`에 선택 필드 `updated_at?: unknown`을 더한다.
- `ledgerFromComments`: 고른 원장 댓글의 `updated_at`이 `Date.parse`가 되는 문자열이면, 그 원장에서 상태가 `open`이고 `openedAt`이 없는 지적에 그 값을 `openedAt`으로 채워 돌려준다. `updated_at`을 읽을 수 없으면 채우지 않는다. 이미 있는 `openedAt`은 바꾸지 않는다. 인자와 그 밖의 동작은 그대로다(부르는 곳 모두에 적용된다).
  - 근거: 원장 댓글에 들어 있는 열린 지적은 그 댓글이 마지막으로 저장된 시각(GitHub이 정한 `updated_at`)이나 그 전에 게시됐다. 그래서 이 값은 실제 게시 시각보다 앞설 수 없다.
- 채워진 값은 그 뒤 원장을 저장하는 실행(`recordLedger`, `recordCiFailure`)이 함께 저장한다. `recordLedger`의 저장 여부는 지금처럼 "댓글에 저장된 본문에서 읽은 원장과 달라졌는가"로 정하되, 비교의 기준은 **채우기 전**의 원장이어야 한다(채운 것만 달라도 저장한다).
- 기록 job의 시계(`Date.now`, `new Date()`)로 `openedAt`을 적지 않는다. 이번 실행의 판정으로 등록되거나 다시 열린 지적은 `openedAt` 없이 저장된다.

### 2. 편집 이력 읽기와 승인 반영 `scripts/ci/pr.ts`, `scripts/ci/accept-load.ts`(새 파일)

```ts
// scripts/ci/pr.ts
/** GitHub GraphQL 요청 함수. 응답이 200이 아니거나 errors가 있으면 예외. data를 돌려준다 */
export function githubGraphql(
  token: string,
  apiUrl?: string,
): (query: string, variables: Record<string, unknown>) => Promise<unknown>;

// scripts/ci/accept-load.ts
export type Graphql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** PR의 댓글을 편집 이력 필드와 함께 모두 읽는다. 끝을 확인하지 못하면 예외 */
export function listAcceptComments(o: {
  graphql: Graphql;
  repo: string; // owner/name
  number: number;
}): Promise<AcceptComment[]>;

export interface Accepted {
  ledger: Ledger;
  outcome: AcceptOutcome | null; // 승인을 보지 않았으면 null
}

/** 원장에 제작자 승인을 반영한다. 볼 지적이 없으면 GraphQL을 부르지 않는다 */
export function loadAccepted(o: {
  ledger: Ledger;
  owner: string;
  graphql: Graphql;
  repo: string;
  number: number;
}): Promise<Accepted>;
```

- `githubGraphql`: `POST <apiUrl>/graphql`(기본 `https://api.github.com`), `githubGet`과 같은 헤더와 시간 제한. 오류 메시지에 응답 본문을 300자 넘게 넣지 않는다.
- `listAcceptComments`: `repository(owner, name) { pullRequest(number) { comments(first: 100, after) { pageInfo { hasNextPage endCursor } nodes { databaseId author { login } body createdAt lastEditedAt editor { login } userContentEdits(first: 1) { totalCount } } } } }`. 쪽 수 상한(`ledger-store.ts`의 `MAX_PAGES`와 같은 값)을 넘거나 응답 꼴이 다르면 예외다. 일부만 읽은 목록을 돌려주지 않는다.
- `loadAccepted`: `owner`가 빈 문자열이거나 `needsAccepts(ledger)`가 거짓이면 `{ ledger, outcome: null }`을 그대로 돌려준다(요청 없음). 아니면 `applyOwnerAccepts(ledger, ownerAccepts(await listAcceptComments(…), owner))`. 예외는 잡지 않고 올린다.

### 3. 기록 job `scripts/ci/ledger-store.ts`의 `recordLedger`

- `LedgerApi`에 선택 필드 `graphql?: Graphql`을 더하고 `githubLedgerApi`가 채운다. `RecordLedgerOptions`(`Where`)에 선택 필드 `owner?: string`을 더한다.
- 순서: 원장을 읽는다(1의 채우기 포함) → `owner`와 `api.graphql`이 있으면 `loadAccepted` → 판정이 있으면 `applyVerdict` → 앞에서 읽은 승인 목록으로 `applyOwnerAccepts`를 한 번 더(같은 실행에서 결과가 흔들리지 않게. GraphQL은 한 번만 부른다) → 달라졌으면 저장 → `ledgerStatus`로 `review-ledger` 기록.
- `loadAccepted`가 예외를 내면 원장을 저장하지 않고 `review-ledger`를 `error`로 남긴다(지금의 `원장 처리 실패: …` 경로). 설명에 댓글 본문을 넣지 않는다.
- `owner`가 없거나 `api.graphql`이 없으면 승인을 보지 않는다. 이때 이미 `accepted`인 지적은 건드리지 않는다.
- 원장이 없으면 승인 댓글이 있어도 원장을 만들지 않는다.
- 반영 결과(`AcceptOutcome`)를 부른 쪽이 로그로 쓸 수 있게 선택 콜백 `onAccepts?: (o: AcceptOutcome) => void`로 넘긴다.
- `recordCiFailure`와 `plan-gate`의 `loadLedger`는 승인을 보지 않는다(실패 기록과 계획 승인은 승인과 무관하다).

### 4. plan job과 호출하는 곳 `scripts/ci/accept-load.ts`, `scripts/harness.ts`

- `review-plan`이 원장을 읽는 부분(댓글 목록 → 원장 → 반박)을 `harness.ts`에서 함수로 옮긴다:

  ```ts
  // scripts/ci/accept-load.ts
  export function readRoundLedger(o: {
    get: (path: string) => Promise<unknown>;
    graphql: Graphql;
    repo: string;
    number: number;
    recorderBot: string;
    owner: string;
  }): Promise<{
    ledger: Ledger | null;
    rebuttals: Rebuttal[];
    outcome: AcceptOutcome | null;
    /** 승인을 확인하지 못한 이유(한 줄). 확인했거나 볼 것이 없었으면 null */
    acceptError: string | null;
  }>;
  ```

  - 댓글 목록이나 원장을 읽지 못하면 지금처럼 예외다(`review-plan`은 판정 없이 실패한다).
  - `loadAccepted`가 예외를 내면 저장된 원장(1의 채우기까지 한 것)을 그대로 쓰고 `acceptError`에 이유를 적는다. 판정은 계속한다. 관문은 기록 job이 정한다(계획의 의사결정 로그).
  - 반박 판별(`parseRebuttals`)은 승인이 반영된 원장으로 한다(`accepted`인 지적은 반박 대상이 아니다).

- `review-plan`: `readRoundLedger`에 `cfg.github.owner`와 `githubGraphql(GH_TOKEN, GITHUB_API_URL)`을 넘긴다. 로그: `review-plan: 제작자 승인 N건(F…)`(0건이면 쓰지 않는다), `review-plan: 제작자 승인을 확인하지 못했다(저장된 원장을 그대로 쓴다) — <이유>`.
- `record-review`: `recordLedger`에 `owner: cfg.github.owner`와 `onAccepts`를 넘긴다. 로그는 한 줄씩: `record-review: 제작자 승인 F6(댓글 123)`, `record-review: 제작자 승인 무시 F7(댓글 124): <고정된 이유>`, `record-review: 제작자 승인 철회 F6`.
- `scripts/runner/ledger-read.ts`의 `readPrLedger`는 저장된 원장을 그대로 읽는다(승인을 다시 계산하지 않는다. 기록 job이 저장한 결과만 믿는다).
- `harness.ts`의 수정은 함수를 부르고 로그를 쓰는 줄에 그친다. 판별 로직을 `harness.ts`에 두지 않는다.

### 5. 수렴 판정과 프롬프트

- `scripts/runner/divergence.ts`: 해소된 지적의 셈에 `accepted`를 넣는다(대응 전에 열려 있던 지적이 지금 `fixed`·`rejected`·`accepted`).
- `scripts/cross-review/prompt.md`의 "라운드 규칙"에 한 항목을 더한다: 상태가 `accepted`인 지적은 제작자가 남은 위험을 받아들인 것이다. `resolutions`에 판정을 내지 말고 `findings`에 다시 적지 마라. 그 뒤에 바뀐 코드에서 다른 결함을 찾았으면 새 지적으로 낸다. `prompt-codex.md`에 라운드 규칙이 따로 있으면 같은 줄을 더한다.

### 6. 문서

- `docs/harness/design.md` 10.2절 (4): 상태 목록의 `rejected` 줄에서 "제작자가 승인해야"를 떼어 `accepted` 줄로 옮긴다. 내용: P0에만 쓴다 / 제작자 계정이 PR에 단, 승인 줄(`/harness accept F<번호>`)만 있는 댓글 / 편집 이력으로 고쳐지지 않은 것이 확인된 댓글만(확인하지 못하면 거부) / 지적이 원장에 게시된 시각보다 뒤에 단 것만(시각은 원장 댓글의 저장 시각에서 얻는다) / 다음 판정 실행에서 반영 / 댓글이 지워지거나 고쳐지면 다시 열림 / 검증자의 판정으로 바뀌지 않음 / head에 묶지 않는 이유 한 줄 / 편집 이력을 읽지 못하면 기록 job은 `review-ledger`를 `error`로 남기고 plan job은 저장된 원장을 쓴다. "병합 조건" 줄에 `accepted`를 더한다. "구현" 목록에 `scripts/ci/owner-accept.ts`·`accept-load.ts`를 더한다.
- `docs/harness/design.md` 0절 버전 이력과 `docs/harness/CHANGELOG.md`에 한 줄(번호는 push할 때 main의 다음 번호. 다른 PR이 먼저 병합되면 `origin/main`을 병합하고 다시 잡는다).
- `scripts/cross-review/ledger.md`: "숨은 자료"의 지적 필드에 `openedAt`, "상태" 표에 `accepted`, "판정 반영 규칙"에 승인 규칙과 게시 시각 규칙.
- `docs/harness/workflow.md` 8절 "교착": P0의 교착에서 제작자가 고를 수 있는 것으로 "남은 위험을 받아들인다"를 더하고, "효과" 줄의 "P0은 두 검증자가 모두 동의해야 닫힌다"에 제작자 승인을 더한다. 승인을 요청할 때 제작자에게 알릴 것을 적는다: 지적 ID와 무엇을 받아들이는 것인지, 댓글에는 승인 줄만 적는다(설명은 다른 댓글에), 단 뒤에 고치지 않는다(고치면 무효. 새로 단다), 원장에 그 지적이 보인 뒤에 단다, 다음 판정에서 반영된다.
- `docs/harness/architecture.md`의 파일 표에 `ci/accept-load.ts`를 더한다.
- 설계서 5절 표, 10.3절, `docs/SECURITY.md`는 고치지 않는다.

### 7. 테스트(새 파일)

- `scripts/test/accept-load.test.ts`(가짜 `get`·`graphql`·`send`)
  - 게시 시각: 원장 댓글의 `updated_at`이 `openedAt`이 없는 열린 지적에만 채워지고 이미 있는 값과 닫힌 지적은 그대로다. `updated_at`이 없으면 채우지 않는다.
  - **계획 검증 F3의 두 경우**: (가) 지적이 등록된 실행이 저장하기 전에 단 댓글(그 지적은 `openedAt` 없이 저장되고, 다음 실행이 원장 댓글의 `updated_at`을 채운다. 댓글 시각이 그보다 앞이거나 같다) → 무시된다. (나) 원장이 게시된 뒤에 단 댓글 → 다음 실행에서 `accepted`. 같은 실행의 판정으로 새로 등록된 P0은 그 실행에서 뒤 시각의 댓글이 있어도 `accepted`가 되지 않는다.
  - `listAcceptComments`: 여러 쪽, 끝을 확인하지 못함(예외), 응답 꼴이 다름(예외).
  - `loadAccepted`: 볼 지적이 없으면 `graphql`을 부르지 않는다. `owner`가 빈 문자열이면 부르지 않는다.
  - `recordLedger`: 판정 없이도(이어받음) 승인을 저장하고 `review-ledger`가 success / 같은 실행의 판정이 그 지적을 `open`으로 답해도 저장된 상태는 `accepted` / 승인 댓글이 사라진 뒤 다시 기록하면 `open`으로 저장되고 failure / **작성 시각과 수정 시각이 같지만 편집 이력이 있는 댓글**은 반영되지 않는다 / 봇 계정·PR 작성자·검증 App이 단 같은 본문은 반영되지 않는다 / `graphql`이 예외를 내면 저장하지 않고(`send` 호출 0회) `review-ledger`가 error / 원장이 없으면 승인 댓글만으로 댓글을 만들지 않는다.
  - `readRoundLedger`: 승인이 반영된 원장을 돌려준다 / `graphql`이 예외를 내면 저장된 원장과 `acceptError`를 돌려준다 / `accepted`인 지적에 대한 반박은 버려진다.
- `scripts/test/accept-cli.test.ts`: 실제 명령을 자식 프로세스로 띄우고 `GITHUB_API_URL`을 로컬 HTTP 서버로 돌린다(`scripts/test/record.test.ts`의 방식). 서버는 REST 댓글 목록, `POST /graphql`, PR 조회, 댓글 PATCH, 커밋 상태 POST에 답하고 받은 요청을 기록한다.
  - `review-plan --pr-number <N> --reviewer codex …`: 제작자의 유효한 승인 댓글이 있을 때 job 출력(`GITHUB_OUTPUT` 파일)의 `ledger=` 값을 `parseLedgerData`로 읽으면 그 ID가 `accepted`다. 같은 서버에서 그 댓글의 편집 이력만 "고쳐짐"으로 바꾸면 `open`이다. `/graphql`이 500이면 명령은 성공하고 `ledger=`의 그 지적은 저장된 상태(`open`)이며 출력에 `제작자 승인을 확인하지 못했다`가 있다.
  - `record-review … --pr-number <N>`: 서버가 받은 원장 댓글 PATCH 본문에서 그 ID가 `accepted`이고, 받은 `review-ledger` 상태가 success다. `/graphql`이 500이면 PATCH가 없고 `review-ledger`가 error다.
  - 두 명령 모두 설정(`--config-root`)의 `github.owner`를 쓰는 것을 확인한다: 설정의 제작자 계정을 다른 이름으로 바꾼 설정 폴더로 돌리면 같은 댓글이 반영되지 않는다.
- `scripts/test/divergence.test.ts`: `accepted`가 해소로 세지는 경우를 더한다(새 `test(...)`로).

## Acceptance Criteria

```bash
node --test scripts/test/accept-load.test.ts
node --test scripts/test/accept-cli.test.ts
node --test scripts/test/ledger-store.test.ts
node --test scripts/test/record.test.ts
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

- `.github/workflows/`를 고치지 마라. 이유: 운영 단계에서 워크플로 변경은 제작자가 직접 커밋하는 절차가 따로 있고, 이 기능은 지금 워크플로의 입력과 토큰만으로 동작한다(계획의 수용 기준 7).
- `scripts/ci/verdict.ts`의 `verdictStatus`와 `scripts/ci/record.ts`의 `recordReview`를 고치지 마라. 이유: `review/*`는 검증자의 판정 그대로여야 한다. 승인은 원장에만 반영한다.
- 승인 판별을 `scripts/ci/owner-accept.ts` 밖에 다시 구현하지 마라. plan job과 기록 job은 `loadAccepted` 하나를 쓴다. 이유: 두 job이 다른 결과를 내면 검증자가 본 원장과 저장된 원장이 어긋난다.
- REST 댓글 목록의 `created_at`·`updated_at`으로 승인 댓글의 편집 여부를 판단하지 마라. 이유: 초 단위라 같은 초의 편집이 보이지 않는다. REST의 `updated_at`은 원장 댓글의 게시 시각을 얻는 데에만 쓴다.
- 기록 job이 편집 이력을 읽지 못했을 때 승인을 유지하거나 새로 반영하지 마라. 이유: 확인하지 못한 승인으로 관문이 열린다. 그때는 원장을 쓰지 않고 `error`다.
- `openedAt`을 러너의 시계로 적지 마라. 이유: 그 시각과 실제 게시 사이에 단 댓글이 아직 보이지 않는 지적을 닫는다(계획 검증 F3).
- 댓글 본문이나 토큰을 로그·상태 설명에 넣지 마라. 이유: 댓글은 외부 입력이고(14.6절), 러너의 워크플로 명령 줄을 만들 수 있다. 로그에는 지적 ID, 댓글 id, 고정된 이유 문자열만 쓴다.
- `scripts/metrics/`를 고치지 마라. 이유: 다른 계획(Issue #146)의 범위다.
- 기존 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
