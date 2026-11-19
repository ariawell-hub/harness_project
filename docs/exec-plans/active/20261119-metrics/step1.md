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
  /* step0의 필드 */ firstCommitAt: string;
} // PR의 가장 이른 커밋 시각. 모르면 ''
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
}
```

- `firstCommitAt`: `gh pr list`의 `commits`에서 가장 이른 `committedDate`.
- 워크플로 실행을 읽는 범위를 넓힌다: `runMetrics`가 `since`와 기간에 병합된 PR의 가장 이른 `createdAt` 날짜 가운데 이른 쪽부터 `until`까지 읽는다(기간 전에 열린 PR의 첫 `check` 실행을 보기 위해서다). step0의 사용량 계산은 `createdAt`이 기간 안인 실행만 세므로 값이 바뀌지 않는다. 이것을 테스트로 고정한다.
- `needsHumanEvents`: `gh api --paginate "repos/{owner}/{repo}/issues/events?per_page=100"`에서 `event`가 `labeled`이고 라벨이 `cfg.github.needsHumanLabel`인 것. 기간 안인 것만 남긴다.
- `escalationComments`: `gh api --paginate "repos/{owner}/{repo}/issues/comments?since=<since>T00:00:00Z&per_page=100"`에서 작성자가 `cfg.github.bot`이고 생성 시각이 기간 안인 댓글을 본문 문구로 분류한다. 본문은 분류에만 쓰고 결과에 담지 않는다. 분류(위에서부터 먼저 맞는 것):
  - 본문에 `## 중단 보고:` 줄이 있다 → `추정 원인` 줄에 `교착`이 있으면 `stop-deadlock`, `step 총량 상한`이 있으면 `stop-limit`, 아니면 `stop-failures`
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
  labels: LabelEvent[];
  comments: BotComment[];
}
export function steadyMetrics(i: SteadyInput): SteadyMetrics;
```

순수 함수다. 정의:

- **PR 리드타임**: PR마다 `mergedAt − firstCommitAt`의 중앙값과 최댓값(분). `firstCommitAt`이 빈 PR은 빼고 그 수를 따로 낸다. step0의 계획 커밋이 PR의 첫 커밋이라 "계획 생성 → 병합"에 해당한다.
- **CI 첫 통과율**: PR마다 `runs` 가운데 `path`가 `.github/workflows/check.yml`, `event`가 `pull_request`, `branch`가 그 PR의 `head`인 실행 중 `createdAt`이 가장 이른 것을 고른다. 그 실행이 `attempt` 1이고 `conclusion`이 `success`면 첫 통과다. 비율 = 첫 통과 PR 수 ÷ 실행을 찾은 PR 수. 실행을 찾지 못한 PR 수를 따로 낸다.
- **PR당 리뷰 라운드 수**: PR마다 검증자별 판정 수(`roundsOf`) 중 큰 값. 원장이 없는 PR은 0. 중앙값, 최댓값, 3라운드를 넘은 PR의 번호(19절 4단계 완료 기준이 3라운드다).
- **에스컬레이션 수와 사유**: `labels`의 수가 전체다. 사유별 수는 `comments`를 `kind`로 센다(5회 실패 중단, 총량 상한 중단, 교착, 질문, 승인 요청, CI 대기, 자동 revert 불가). 전체에서 사유별 합을 뺀 값(0 미만이면 0)을 "그 밖(대화 세션이 직접 올린 것 등)"으로 낸다.
- **5회 중단·총량 상한 도달 횟수**: `comments`의 `stop-failures` 수와 `stop-limit` 수.
- **위험도별 PR 수**: PR마다 `statuses` 가운데 `context`가 `risk-gate`이고 `creator`가 `recorderBot`인 가장 최근 기록의 `description`이 `위험도 낮음`·`위험도 보통`·`위험도 높음`으로 시작하는 것으로 가른다. 맞는 기록이 없으면 "알 수 없음".
- **PR 크기**: `additions + deletions`의 중앙값과 400줄을 넘는 PR의 수(Q9의 경고 기준. `pr-size` 게이트는 아직 없다, TD-6).

### 3. 연결과 렌더

- `runMetrics`가 위 자료를 읽어 `steadyMetrics`를 부르고, `renderBlock`이 `### 상시 지표` 절을 파일럿 지표 아래에 더한다. 형식 규칙은 step0과 같다(목록, 수와 번호만).
- `docs/QUALITY_SCORE.md`의 "측정 정의"에 이 step의 지표를 더하고, 이 리포에서 `metrics --since 2026-11-11 --until <작업일(UTC)> --write`를 다시 실행해 기록한다.
- `docs/harness/architecture.md`의 `metrics/*` 행과 `docs/harness/CHANGELOG.md`를 고친다.

### 4. 테스트 `scripts/test/metrics-steady.test.ts`(새 파일)

- 댓글 분류 함수: 위 문구마다 한 사례, 봇이 아닌 작성자와 기간 밖 댓글은 버린다, 분류 결과에 본문이 없다.
- `steadyMetrics`: 지표마다 고정 입력으로 값 단언(첫 실행이 재실행된 PR은 첫 통과가 아니다, 실행 없는 PR은 분모에서 빠진다, 검증 App이 아닌 계정이 쓴 `risk-gate` 기록은 쓰지 않는다, 사유별 합이 전체보다 크면 "그 밖"은 0).
- 실행 조회 범위를 넓혀도 step0의 Actions 실행 시간 값이 같다.
- `renderBlock`이 `### 상시 지표` 절을 내고 제목 문자열을 담지 않는다.
- `ghSource`: 더한 세 조회가 고정 응답을 위 형으로 바꾸고, 기록된 호출의 인자가 step0의 "읽기 요청" 꼴이다.
- 이 리포의 `docs/QUALITY_SCORE.md` 표식 구간 안에 `### 상시 지표` 제목이 있다.

## Acceptance Criteria

```bash
node --test scripts/test/metrics-pilot.test.ts scripts/test/metrics-command.test.ts scripts/test/metrics-steady.test.ts
```

## 금지사항

- step0의 파일럿 판정 지표 정의와 값을 바꾸지 마라. 이유: 파일럿 판정의 기준이다. 바꿔야 하면 계획을 고쳐 다시 검증받는다.
- 댓글·Issue의 본문을 결과 자료형이나 출력에 담지 마라. 이유: 외부 입력이다(14.6절). 분류한 종류만 남긴다.
- 봇 계정이 아닌 작성자의 댓글을 에스컬레이션으로 세지 마라. 이유: 같은 문구를 누구나 쓸 수 있다.
- 검증 App 봇이 아닌 계정이 쓴 커밋 상태로 위험도를 정하지 마라. 이유: 같은 이름의 상태를 PR 작성자도 쓸 수 있다(10.3절).
- `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`, `scripts/harness.ts`를 고치지 마라. 이유: 이 step에는 명령 등록 변경이 없고, 다른 세션의 작업과 겹친다.
- GitHub에 쓰는 호출을 하지 마라. 이유: 집계는 읽기만 한다.
- 다른 세션(Issue #140)이 맡은 경로(`scripts/verify/**`, `scripts/commands/standard.ts`, `profiles/web/**`, `lab/pilot-prep/**`, `.claude/skills/web-verify/`, `.gitignore`, 설계서 11.1절, `workflow.md` 4절, 기술 부채 표 TD-12 행, `architecture.md`의 `verify/*`·`commands/standard.ts` 행)를 고치지 마라. 이유: 세션 간 합의.
