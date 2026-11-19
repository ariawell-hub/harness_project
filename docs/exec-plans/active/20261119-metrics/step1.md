# Step 1: steady-github

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 17.2절(상시 지표), 10.1절(위험도), 14.6절(외부 입력)
- `docs/QUALITY_SCORE.md`
- step0이 만든 파일: `scripts/metrics/source.ts`, `scripts/metrics/pilot.ts`, `scripts/metrics/render.ts`, `scripts/commands/metrics.ts`, `scripts/test/metrics-pilot.test.ts`, `scripts/test/metrics-command.test.ts`
- `scripts/ci/ledger.ts`(`Ledger`, `roundsOf`), `scripts/gates/risk-gate.ts`(`risk-gate` 설명 문구), `scripts/runner/run.ts`(중단 보고·질문·승인 요청·CI 대기 알림 댓글의 문구), `scripts/ci/revert.ts`(자동 revert 불가 알림의 표식)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 자료 더 읽기 (`scripts/metrics/source.ts`)

`MetricsSource`에 아래를 더한다. 모두 읽기만 하고, 끝까지 읽지 못하면 `SourceError`다.

```ts
export interface MergedPr {
  /* step0의 필드에 더한다 */
  /** PR에 든 커밋의 SHA(`gh pr list --json commits`의 `oid`) */
  commits: string[];
  /** 커밋 목록을 다 받았는가. `gh`가 주는 목록은 100개까지라, 100개면 false다 */
  commitsComplete: boolean;
  /** 다른 리포(포크)의 브랜치에서 온 PR인가(`isCrossRepository`) */
  crossRepo: boolean;
}
export interface WorkflowRun {
  /* step0의 필드에 더한다 */
  /** 실행의 head 리포가 이 리포인가(`head_repository.full_name == repository.full_name`) */
  sameRepo: boolean;
}
export interface HeadStatus {
  context: string;
  state: string;
  description: string;
  creator: string;
  at: string;
}
export interface LabelEvent {
  issue: number;
  at: string;
}
export interface BotComment {
  issue: number;
  at: string;
  kind: EscalationKind;
}
export type EscalationKind =
  | 'stop-limit'
  | 'stop-deadlock'
  | 'stop-failures'
  | 'stop-conflict'
  | 'stop-other'
  | 'question'
  | 'approval'
  | 'ci-stall'
  | 'revert';

export interface MetricsSource {
  /** PR head 커밋의 커밋 상태 전체(옛 기록 포함) */
  headStatuses(sha: string): HeadStatus[];
  /** 기간에 needs-human 라벨이 붙은 사건 */
  needsHumanEvents(p: Period): LabelEvent[];
  /** 기간에 봇 계정(`cfg.github.bot`)이 쓴 에스컬레이션 댓글 */
  escalationComments(p: Period): BotComment[];
  /** 그 head 브랜치 이름으로 열린 PR의 수(상태·base·포크 여부와 무관). 100 이상이면 `SourceError` */
  headPrCount(head: string): number;
}
```

- 워크플로 실행을 읽는 범위를 넓힌다: `runMetrics`가 `since`와 기간에 병합된 PR의 가장 이른 `createdAt` 날짜 가운데 이른 쪽부터 `until`까지 읽는다(기간 전에 열린 PR의 첫 `check` 실행을 보기 위해서다). step0의 사용량 계산은 `createdAt`이 기간 안인 실행만 세므로 값이 바뀌지 않는다. 이것을 테스트로 고정한다.
- `needsHumanEvents`: `gh api --paginate "repos/{owner}/{repo}/issues/events?per_page=100"`에서 `event`가 `labeled`이고 라벨이 `cfg.github.needsHumanLabel`인 것. 기간 안인 것만 남긴다.
- `escalationComments`: `gh api --paginate "repos/{owner}/{repo}/issues/comments?since=<since>T00:00:00Z&per_page=100"`에서 작성자가 `cfg.github.bot`이고 생성 시각이 기간 안인 댓글을 본문 문구로 분류한다. 본문은 분류에만 쓰고 결과에 담지 않는다. 분류(위에서부터 먼저 맞는 것):
  - 본문에 `## 중단 보고:`로 시작하는 줄이 있다 → 그 안에서 다시 가른다(`scripts/runner/run.ts`의 두 보고 형식). `- 추정 원인: `으로 시작하는 줄의 나머지가 `교착`으로 시작하면 `stop-deadlock`, `step 총량 상한`으로 시작하면 `stop-limit`, `실패 키 <키> <수>회` 꼴이면 `stop-failures`다. `- 원인: `으로 시작하는 줄에 `병합이 충돌한다`가 있으면 `stop-conflict`(PR 갱신 충돌 보고. 5회 실패 중단이 아니다). 어느 것도 아니면 `stop-other`
  - `<!-- harness-revert-escalate` 표식이 있다 → `revert`
  - `질문 N건을 남겼다`(N은 숫자) → `question`
  - `제작자 승인을 기다린다` → `approval`
  - `CI 대기가` → `ci-stall`
  - 어느 것도 아니면 버린다.

### 2. 상시 지표 `scripts/metrics/steady.ts`

```ts
export interface SteadyInput {
  period: Period;
  prs: MergedPr[];
  runs: WorkflowRun[];
  ledgers: ReadonlyMap<number, Ledger | null>;
  statuses: ReadonlyMap<number, HeadStatus[]>;
  recorderBot: string;
  /** PR 번호 → 그 PR의 계획 frontmatter `claimed_at`. 계획을 찾지 못한 PR은 없다 */
  planClaimedAt: ReadonlyMap<number, string>;
  /** PR 번호 → 그 PR의 head 브랜치 이름으로 열린 PR의 수(`headPrCount`). 없는 PR은 이을 수 없는 것으로 본다 */
  headPrCounts: ReadonlyMap<number, number>;
  labels: LabelEvent[];
  comments: BotComment[];
}
export function steadyMetrics(i: SteadyInput): SteadyMetrics;
```

순수 함수다. 정의:

- **PR 리드타임(계획 생성 → 병합)**: PR마다 `mergedAt − planClaimedAt`의 중앙값과 최댓값(분). 계획 생성 시각은 `new-task`가 계획 frontmatter에 적는 `claimed_at`이다. 둘째 step부터의 PR도 그 계획의 `claimed_at`부터 잰다(계획이 생긴 뒤 그 PR이 병합되기까지). `planClaimedAt`에 없는 PR, 시각을 읽지 못한 PR, 값이 음수인 PR은 빼고 "계획을 찾지 못한 PR" 수로 따로 낸다.
  - `planClaimedAt`은 새 파일 `scripts/metrics/plans.ts`의 `planClaimedAt(root: string, prs: MergedPr[]): Map<number, string>`이 만든다: PR의 `head`를 `parseBranch`로 읽어 계획 id를 얻고, `findPlan(root, id)`로 찾은 계획 파일(`active/`·`completed/`)의 frontmatter `claimed_at`을 읽는다. 브랜치 이름이 계획 형식이 아니거나(revert PR 등) 계획 파일이 없으면 넣지 않는다. `root`는 명령을 실행한 체크아웃이다.
- **CI 첫 통과율**: Actions 실행 목록은 병합된 PR의 번호를 주지 않는다(응답의 `pull_requests`가 비어 있다. 이 리포의 2026-11-12·18 실행에서 확인). 실행과 PR을 잇는 값은 head 브랜치 이름과 커밋 SHA뿐이라, **그 head 브랜치 이름으로 열린 PR이 그 PR 하나뿐일 때만** 실행을 잇는다. 같은 이름으로 열린 PR이 하나라도 더 있으면(닫힌 PR, base가 다른 PR, base를 바꾼 PR, 다시 연 PR과 겹친 PR, 포크의 PR) 어느 PR의 실행인지 가를 수 없으므로 그 PR은 지표에서 뺀다.
  - 이을 수 있는 PR: `crossRepo`가 거짓이고 `commitsComplete`가 참이고 `headPrCounts`의 그 PR 값이 1인 PR. 값이 2 이상이거나 없는 PR을 포함해 나머지는 분모에서 빼고 "실행을 이을 수 없는 PR" 수로 따로 낸다.
  - `headPrCount`: `gh pr list --state all --head <head> --limit 100 --json number`가 돌려준 수. 병합된 PR마다 한 번 읽는다.
  - 이을 수 있는 PR의 실행: `runs` 가운데 `path`가 `.github/workflows/check.yml`, `event`가 `pull_request`, `sameRepo`가 참, `branch`가 그 PR의 `head`, `headSha`가 그 PR의 `commits`에 들고, `createdAt`이 그 PR의 `createdAt` 이상 `mergedAt` 이하인 것.
  - 그중 `createdAt`이 가장 이른 실행이 `attempt` 1이고 `conclusion`이 `success`면 첫 통과다. 비율 = 첫 통과 PR 수 ÷ 실행을 찾은 PR 수. 이을 수 있는데 실행을 찾지 못한 PR 수도 따로 낸다(분모에서 뺀다).
  - 이 하네스의 브랜치 이름은 `new-task`가 step마다 하나씩 만들어(`<type>/<계획 id>-s<N>`) 보통 PR 하나에만 쓰인다. 대상 PR은 step0에서 기본 브랜치에 병합된 것으로 한정돼 있다.
- **PR당 리뷰 라운드 수**: PR마다 검증자별 판정 수(`roundsOf`) 중 큰 값. 원장이 없는 PR은 0. 중앙값, 최댓값, 3라운드를 넘은 PR의 번호(19절 4단계 완료 기준이 3라운드다).
- **에스컬레이션 수와 사유**: 두 값을 따로 낸다. 서로 빼거나 맞추지 않는다(라벨과 댓글은 따로 기록돼 날짜 경계에서 다른 기간에 들 수 있고, 대화 세션이 댓글 없이 라벨만 붙이기도 한다).
  - `needs-human` 라벨이 붙은 횟수: `labels`의 수.
  - 사유별 알림 댓글 수: `comments`를 `kind`로 센다(5회 실패 중단, 총량 상한 중단, 교착, 갱신 충돌, 그 밖의 중단, 질문, 승인 요청, CI 대기, 자동 revert 불가).
- **5회 중단·총량 상한 도달 횟수**: `comments`의 `stop-failures` 수와 `stop-limit` 수. `stop-conflict`·`stop-other`는 넣지 않는다.
- **위험도별 PR 수**: PR마다 `statuses` 가운데 `context`가 `risk-gate`이고 `creator`가 `recorderBot`인 가장 최근 기록의 `description`이 `위험도 낮음`·`위험도 보통`·`위험도 높음`으로 시작하는 것으로 가른다. 맞는 기록이 없으면 "알 수 없음".
- **PR 크기**: `additions + deletions`의 중앙값과 400줄을 넘는 PR의 수(Q9의 경고 기준. `pr-size` 게이트는 아직 없다, TD-6).

### 3. 연결과 렌더

- `runMetrics`가 위 자료를 읽어 `steadyMetrics`를 부른다. 병합된 PR마다 `headStatuses(headSha)`를 `statuses`에, `headPrCount(head)`를 `headPrCounts`에, `planClaimedAt(root, prs)`의 결과를 `planClaimedAt`에 PR 번호를 키로 담아 넘긴다. 그리고 `renderBlock`이 `### 상시 지표` 절을 파일럿 지표 아래에 더한다. 형식 규칙은 step0과 같다(목록, 수와 번호만).
- `docs/QUALITY_SCORE.md`의 "측정 정의"에 이 step의 지표를 더하고, 이 리포에서 `metrics --since 2026-11-11 --until <작업일(UTC)> --write`를 다시 실행해 기록한다.
- `docs/harness/architecture.md`의 `metrics/*` 행과 `docs/harness/CHANGELOG.md`를 고친다.
- 이 step의 PR은 보호 경로(`scripts/**`, `docs/harness/**`)를 바꾼다. 운영 단계에서는 계획의 `risk`와 무관하게 `risk-gate`가 위험도 높음으로 판정하고 제작자 승인이 있어야 병합된다(절차서 5절 "운영 단계의 보호 경로 PR"). 초안으로 올리고, 완료 처리·`origin/main` 병합·`check`가 끝난 뒤 `pr-ready`로 승인을 한 번 요청한다.

### 4. 테스트 `scripts/test/metrics-steady.test.ts`(새 파일)

- 댓글 분류 함수: 위 문구마다 한 사례(`scripts/runner/run.ts`의 실패 중단 보고와 갱신 충돌 보고 형식을 고정 입력으로 둔다. 충돌 보고는 `stop-conflict`이고 5회 중단 수에 들지 않는다), 봇이 아닌 작성자와 기간 밖 댓글은 버린다, 분류 결과에 본문이 없다.
- `steadyMetrics`: 지표마다 고정 입력으로 값 단언(첫 실행이 재실행된 PR은 첫 통과가 아니다, 실행 없는 PR은 분모에서 빠진다, 검증 App이 아닌 계정이 쓴 `risk-gate` 기록은 쓰지 않는다, 같은 head 브랜치 이름으로 열린 PR이 둘 이상이면(닫았다 새로 연 PR, base가 다르거나 base를 바꾼 PR) 그 PR은 "실행을 이을 수 없는 PR"로 빠진다: PR과 실행 자료는 같게 두고 `headPrCounts`의 값만 1과 2로 바꾼 두 입력에서, 1이면 첫 통과율에 들고 2이면 빠진다. 값이 없는 PR도 빠진다, 포크의 같은 이름 브랜치에서 돈 실행(`sameRepo` 거짓)은 어느 PR에도 이어지지 않는다, 포크에서 온 PR과 커밋이 100개인 PR은 "실행을 이을 수 없는 PR"로 빠진다, PR의 커밋에 없는 SHA의 실행은 브랜치 이름이 같아도 이어지지 않는다, PR이 열리기 전이나 병합된 뒤의 실행은 이어지지 않는다, 라벨은 기간 마지막 날 23:59:59Z에 붙고 댓글은 다음 날 00:00:01Z에 달린 사건이 두 기간에서 라벨 수와 댓글 수로 각각 한 번씩 세어진다).
- `planClaimedAt`: 임시 폴더의 계획 파일(단일 파일, 폴더, `active/`·`completed/`)에서 `claimed_at`을 읽는다, 계획 형식이 아닌 브랜치와 계획 파일이 없는 PR은 빠진다. 계획이 없는 PR과 둘째 step PR이 섞인 입력에서 리드타임과 "계획을 찾지 못한 PR" 수가 맞다.
- 실행 조회 범위를 넓혀도 step0의 Actions 실행 시간 값이 같다.
- 명령 경로의 연결(`scripts/test/metrics-command.test.ts`에 더한다. 호출을 기록하는 메모리 `MetricsSource`를 끼워 `runMetrics`를 부르고 출력을 본다):
  - 병합 PR과 성공한 첫 실행은 그대로 두고 `headPrCount`의 반환값만 1과 2로 바꾼 두 실행에서, 출력의 첫 통과율과 "실행을 이을 수 없는 PR" 수가 다르다(1이면 첫 통과에 들고 2이면 빠진다). `headPrCount`가 병합된 PR마다 그 PR의 `head`로 불린다.
  - `headStatuses`가 병합된 PR마다 그 PR의 `headSha`로 불리고, 한 PR의 `risk-gate` 기록만 `위험도 높음`으로 바꾸면 출력의 위험도별 PR 수가 바뀐다.
  - 임시 리포에 계획 파일을 두고 그 계획의 브랜치 이름을 `head`로 가진 PR을 주면 출력에 리드타임 값이 나오고, 계획 파일을 지우면 "계획을 찾지 못한 PR" 수가 1 늘어난다.
  - `needsHumanEvents`·`escalationComments`의 반환값을 하나씩 늘리면 출력의 라벨 수와 그 사유의 댓글 수가 1씩 늘어난다.
  - `workflowRuns`가 기간에 병합된 PR의 가장 이른 `createdAt` 날짜부터 불린다(기간 전에 열린 PR을 준다).
- `renderBlock`이 `### 상시 지표` 절을 내고 제목 문자열을 담지 않는다.
- `ghSource`: 더한 네 조회(`headStatuses`, `needsHumanEvents`, `escalationComments`, `headPrCount`)가 고정 응답을 위 형으로 바꾸고, 기록된 호출의 인자가 step0의 "읽기 요청" 꼴이다.
- 이 리포의 `docs/QUALITY_SCORE.md` 표식 구간 안에 `### 상시 지표` 제목이 있다.

## Acceptance Criteria

```bash
node --test scripts/test/metrics-pilot.test.ts scripts/test/metrics-command.test.ts scripts/test/metrics-steady.test.ts
grep -q "^집계 기간: 2026-11-11 ~ $(date -u +%Y-%m-%d)(UTC) · 병합 PR [0-9][0-9]*개$" docs/QUALITY_SCORE.md
```

둘째 명령은 문서의 집계 기간이 2026-11-11부터 AC를 실행하는 날(UTC)까지인지 본다. 날짜가 바뀐 뒤에 완료 처리하게 되면 집계를 다시 실행한다.

## 금지사항

- step0의 파일럿 판정 지표 정의와 값을 바꾸지 마라. 이유: 파일럿 판정의 기준이다. 바꿔야 하면 계획을 고쳐 다시 검증받는다.
- 댓글·Issue의 본문을 결과 자료형이나 출력에 담지 마라. 이유: 외부 입력이다(14.6절). 분류한 종류만 남긴다.
- 봇 계정이 아닌 작성자의 댓글을 에스컬레이션으로 세지 마라. 이유: 같은 문구를 누구나 쓸 수 있다.
- 검증 App 봇이 아닌 계정이 쓴 커밋 상태로 위험도를 정하지 마라. 이유: 같은 이름의 상태를 PR 작성자도 쓸 수 있다(10.3절).
- `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`, `scripts/harness.ts`를 고치지 마라. 이유: 이 step에는 명령 등록 변경이 없고, 다른 세션의 작업과 겹친다.
- GitHub에 쓰는 호출을 하지 마라. 이유: 집계는 읽기만 한다.
- 다른 세션(Issue #140)이 맡은 경로(`scripts/verify/**`, `scripts/commands/standard.ts`, `profiles/web/**`, `lab/pilot-prep/**`, `.claude/skills/web-verify/`, `.gitignore`, 설계서 11.1절, `workflow.md` 4절, 기술 부채 표 TD-12 행, `architecture.md`의 `verify/*`·`commands/standard.ts` 행)를 고치지 마라. 이유: 세션 간 합의.
