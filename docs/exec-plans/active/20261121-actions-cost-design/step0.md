# Step 0: shadow-cost

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 14.6절(외부 입력), 10.2~10.4절(워크플로와 job의 구성. 읽기만)
- `scripts/metrics/source.ts`(`Period`, `parsePeriod`, `daysOf`, `SourceError`, `ghSource`가 실행을 읽는 방식), `scripts/commands/metrics.ts`(명령의 순서와 종료 코드), `scripts/test/metrics-command.test.ts`(가짜 자료 원천으로 명령을 시험하는 방식)
- `scripts/harness.ts`(`metrics` 명령이 등록된 자리)
- `.github/workflows/*.yml`(워크플로와 job의 이름. 읽기만)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 계산 (`scripts/metrics/actions-cost.ts`, 새 파일)

입출력이 없는 순수 함수로 둔다.

```ts
export interface JobRecord {
  runId: number;
  /** 워크플로 파일 경로의 이름 부분(`.github/workflows/check.yml` → `check`) */
  workflow: string;
  job: string;
  /** 실행의 몇 번째 시도인가(다시 실행하면 2부터) */
  attempt: number;
  event: string;
  /** 실행이 만들어진 시각(ISO). 날짜별 합계의 기준 */
  createdAt: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  labels: string[];
  /** job이 실제로 돈 단계의 수. 0이면 시작하지 못한 job이다 */
  steps: number;
  /** 이 실행이 속한 PR. 찾지 못했으면 null */
  pr: number | null;
  /** push를 가르는 값: `pull_request` 실행의 head 커밋 SHA. 그 밖의 실행은 null */
  pushSha: string | null;
}

/** 청구 단위(분). 돌지 않은 job은 0, 돈 job은 초를 분으로 올림하고 최소 1 */
export function billedMinutes(j: JobRecord): number;

/** 러너의 분당 단가(달러). `kind`는 'priced' | 'unknown' | 'self-hosted' */
export function runnerRate(labels: string[]): {
  kind: 'priced' | 'unknown' | 'self-hosted';
  usdPerMinute: number;
};

export interface CostReport {
  /* 합계(분, 실제 초, 달러), 올림으로 붙은 분, 1분 미만 job의 수와 청구 분,
     워크플로별·job별·날짜별·PR별 행, PR을 찾지 못한 실행의 합계,
     push 수와 push 한 번당 평균, 30일 환산(분, 달러), 단가를 모르는 러너와 self-hosted 러너의 분 */
}
export function actionsCost(jobs: JobRecord[], period: Period): CostReport;
export function renderCost(report: CostReport, period: Period): string;
```

규칙:

- **돌지 않은 job**: `conclusion`이 `skipped`이거나, `startedAt`·`completedAt`이 없거나 날짜로 읽히지 않거나, `steps`가 0이면 0분이다. 수는 "돌지 않은 job"으로 따로 센다.
- **돈 job**: `completedAt − startedAt`(초, 음수면 0)을 60으로 나눠 올림하고 최소 1분이다.
- **시도**: 같은 실행의 시도가 다르면 각각 센다.
- **단가**: 표를 코드에 둔다. 확인한 단가만 넣는다: 라벨이 `ubuntu-latest`·`ubuntu-24.04`·`ubuntu-22.04` 가운데 하나뿐이면 분당 $0.006(2코어 Linux x64, 2026-01-01부터). 라벨에 `self-hosted`가 있으면 `self-hosted`(금액 0, 분은 따로 보인다). 그 밖은 `unknown`(금액에 넣지 않고 분을 따로 보인다). 표의 주석에 값의 출처와 확인한 날짜를 적는다.
- **올림으로 붙은 분**: 돈 job의 청구 분 합계에서 실제 초 합계를 60으로 나눈 값을 뺀다.
- **push 한 번당 평균**: 청구 분 합계를 `pushSha`의 서로 다른 값의 수로 나눈다. 0이면 "해당 없음"으로 낸다.
- **30일 환산**: 합계를 기간의 날 수로 나눠 30을 곱한다. 달러는 소수 둘째 자리까지.
- **렌더**: 마크다운 표다. 같은 입력이면 출력이 같다(행의 순서는 청구 분 내림차순, 같으면 이름·번호 오름차순). prettier를 통과하는 모양으로 낸다.
- **출력에 넣는 글자**(14.6절): 워크플로·job 이름은 `[A-Za-z0-9_.-]`와 공백·`/`만으로 되고 40자 이하일 때만 그대로 적는다. 아니면 `(기타)`로 합친다. PR은 번호만 적는다. 제목, 브랜치 이름, 커밋 SHA, 계정 이름은 적지 않는다.

### 2. 자료 읽기 (`scripts/metrics/actions-source.ts`, 새 파일)

```ts
export interface ActionsSource {
  /** 기간에 만들어진 실행의 job 전부(모든 시도). 끝까지 읽지 못하면 SourceError */
  jobs(period: Period): JobRecord[];
}
export function ghActionsSource(o: { cwd: string /* 그 밖은 구현 재량 */ }): ActionsSource;
```

- `gh api`로 읽기만 한다. 실행 목록은 날짜별로 읽고(`created=<날짜>`), 받은 수가 `total_count`와 다르거나 조회 상한(한 조회에 1,000건)에 닿으면 `SourceError`다.
- job은 실행마다 모든 시도를 받는다(`filter=all`). 쪽을 끝까지 넘긴다.
- **PR 찾기**: `pull_request`·`pull_request_target` 실행은 실행 기록의 PR 번호를 쓴다(포크의 PR이라 비어 있으면 null). `workflow_run`으로 시작한 실행은 `pull_request` 실행에서 본 head 커밋의 커밋 상태를 읽어, `target_url`이 가리키는 실행 번호로 잇는다. 찾지 못하면 null이다. 이 방법의 조회 수가 지나치면 다른 방법을 써도 된다(의사결정 로그에 적는다). 찾지 못한 실행을 버리지 않는다.
- 조회가 실패하면 `SourceError`를 던진다. 일부만 읽은 목록을 돌려주지 않는다.
- `scripts/metrics/source.ts`의 `Period`·`parsePeriod`·`daysOf`·`SourceError`는 가져다 쓴다.

### 3. 명령 (`scripts/commands/actions-cost.ts`, 새 파일. `scripts/harness.ts`에 등록)

```ts
export interface ActionsCostOptions {
  since?: string;
  until?: string;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}
export function runActionsCost(cwd: string, o: ActionsCostOptions, source?: ActionsSource): number;
```

- 순서: 기간 검사 → 자료 읽기 → 계산·렌더 → 출력. 기간의 기본값은 `metrics`와 같다(`until`은 오늘(UTC), `since`는 그 6일 전).
- 종료 코드: 0 성공, 1 기간이 틀림(GitHub을 읽기 전), 2 자료를 끝까지 읽지 못함(표준 출력에 아무것도 내지 않는다).
- 진행 상황(읽은 실행 수)은 표준 오류로만 낸다.
- 파일을 쓰지 않는다.
- `scripts/harness.ts`의 도움말에 한 줄을 더한다.

### 4. 테스트 (`scripts/test/actions-cost.test.ts`, `scripts/test/actions-cost-command.test.ts`, 새 파일)

- 계산: 59초 job은 1분, 60초는 1분, 61초는 2분, 0초이지만 단계가 있는 job은 1분, 건너뛴 job·단계 0인 job·시각이 없는 job은 0분. 시도 둘은 둘 다 센다. 단가를 모르는 라벨과 `self-hosted`는 금액에 들지 않고 분이 따로 나온다. 올림으로 붙은 분, push 한 번당 평균, 30일 환산의 값을 단언한다. PR이 null인 job은 "PR을 찾지 못함" 행에 든다.
- 렌더: 같은 입력을 순서만 바꿔 넣어도 출력이 같다. 안전하지 않은 이름(마크다운 문법, 줄바꿈, 41자 이상)은 `(기타)`로 나온다. 출력에 PR 제목·브랜치 이름이 들어갈 길이 없다는 것(입력 타입에 그 필드가 없다)을 주석으로 적는다.
- 명령: 가짜 `ActionsSource`로 종료 코드 0·1·2를 확인한다. 2일 때 `out`이 한 번도 불리지 않는다. 기간이 틀리면 자료 원천을 부르지 않는다.
- 자료 읽기(`ghActionsSource`)는 `gh`를 가짜 실행 파일이나 주입한 실행 함수로 바꿔, `total_count` 불일치·조회 실패·쪽 넘김·`filter=all`·PR 찾기(상태의 `target_url`)를 확인한다. 네트워크를 쓰지 않는다.

### 5. 문서

- `docs/harness/architecture.md`: 명령 목록과 `metrics/*` 행에 `actions-cost`를 더한다.

## Acceptance Criteria

```bash
node --test scripts/test/actions-cost.test.ts scripts/test/actions-cost-command.test.ts
node scripts/harness.ts actions-cost --since 2026-13-01; test $? -eq 1
node scripts/harness.ts actions-cost --since 2026-11-20 --until 2026-11-19; test $? -eq 1
grep -q "actions-cost" docs/harness/architecture.md
node scripts/harness.ts check
```

## 금지사항

- GitHub에 쓰는 호출(`POST`·`PATCH`·`PUT`·`DELETE`, `gh run rerun`, 댓글·라벨)을 넣지 마라. 이유: 재는 명령이다. 읽기만 한다.
- 확인하지 않은 단가를 표에 넣지 마라(1코어, arm64, Windows, macOS 등). 이유: 틀린 금액이 판단 자료가 된다. 모르는 러너는 분만 보인다. 단가를 더하는 일은 step2의 조사에서 출처를 확인한 뒤 한다.
- 자료를 일부만 읽고 값을 내지 마라. 이유: 적게 나온 값이 "예산 안"이라는 잘못된 판단을 만든다.
- 출력에 PR 제목, 브랜치 이름, 커밋 SHA, 계정 이름, 절대 경로를 넣지 마라. 이유: 14.6절(외부 입력을 문서로 옮기지 않는다)과 결과가 문서에 붙는다는 점.
- `scripts/metrics/source.ts`에 있는 export의 동작과 `metrics` 명령의 출력을 바꾸지 마라. 이유: `docs/QUALITY_SCORE.md`의 집계가 그 출력에 묶여 있다.
- `.github/workflows/`와 `harness.config.json`을 고치지 마라. 이유: 워크플로는 제작자가 적용하고, 이 step은 설정을 더하지 않는다.
- 테스트에서 실제 GitHub을 부르지 마라. 이유: `check`는 네트워크 없이 같은 결과를 내야 한다.
