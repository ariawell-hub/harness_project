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
  /** 이 job이 돈 시도. job 기록의 `run_attempt`다(실행 기록의 최신 시도 번호가 아니다). 다시 실행하면 2부터 */
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
  /** 이 실행이 속한 PR. PR의 실행이 아니거나(main의 `push` 등) 찾지 못했으면 null */
  pr: number | null;
  /** 이 실행이 검증한 PR head 커밋의 SHA. `pr`이 null이면 null이다. head를 세는 데만 쓰고 출력하지 않는다 */
  head: string | null;
  /** PR의 실행이 아닌 것이 분명한가(기본 브랜치의 `push` 실행). `pr`이 null인 실행을 "PR 밖"과 "PR을 찾지 못함"으로 가른다 */
  offPr: boolean;
}

/** 출력에 적어도 되는 이름: 워크플로 이름 → 그 워크플로의 job 이름들 */
export type KnownNames = Map<string, Set<string>>;
/** 워크플로 파일들의 글에서 허용 목록을 만든다: 워크플로 이름은 파일 이름(확장자 제외), job 이름은 `jobs:` 아래의 키와 그 `name:` 값 */
export function knownNamesFrom(files: { name: string; text: string }[]): KnownNames;

/** 청구 단위(분). 돌지 않은 job은 0, 돈 job은 초를 분으로 올림하고 최소 1 */
export function billedMinutes(j: JobRecord): number;

/** 러너의 분당 단가(달러). `kind`는 'priced' | 'unknown' | 'self-hosted' */
export function runnerRate(labels: string[]): {
  kind: 'priced' | 'unknown' | 'self-hosted';
  usdPerMinute: number;
};

export interface CostReport {
  /* 합계(분, 실제 초, 달러), 올림으로 붙은 분, 1분 미만 job의 수와 청구 분,
     워크플로별·job별·날짜별·PR별 행, PR 밖 실행의 합계, PR을 찾지 못한 실행의 합계,
     PR head의 수와 PR head 하나당 평균, 30일 환산(분, 달러), 단가를 모르는 러너와 self-hosted 러너의 분 */
}
export function actionsCost(jobs: JobRecord[], period: Period, known: KnownNames): CostReport;
export function renderCost(report: CostReport, period: Period): string;
```

규칙:

- **돌지 않은 job**: `conclusion`이 `skipped`이거나, `startedAt`·`completedAt`이 없거나 날짜로 읽히지 않거나, `steps`가 0이면 0분이다. 수는 "돌지 않은 job"으로 따로 센다.
- **돈 job**: `completedAt − startedAt`(초, 음수면 0)을 60으로 나눠 올림하고 최소 1분이다.
- **시도**: 같은 실행의 시도가 다르면 각각 센다. 일부 job만 다시 실행한 경우, 다시 돌지 않은 job은 앞선 시도의 기록 하나만 있으므로 한 번만 센다. 같은 job 기록(job id)이 두 번 들어오면 한 번만 세지 않고 자료 읽기가 오류로 끝낸다(아래 2).
- **단가**: 표를 코드에 둔다. 확인한 단가만 넣는다: 라벨이 `ubuntu-latest`·`ubuntu-24.04`·`ubuntu-22.04` 가운데 하나뿐이면 분당 $0.006(2코어 Linux x64, 2026-01-01부터). 라벨에 `self-hosted`가 있으면 `self-hosted`(금액 0, 분은 따로 보인다). 그 밖은 `unknown`(금액에 넣지 않고 분을 따로 보인다). 표의 주석에 값의 출처와 확인한 날짜를 적는다.
- **올림으로 붙은 분**: 돈 job의 청구 분 합계에서 실제 초 합계를 60으로 나눈 값을 뺀다.
- **PR head 하나당 평균**(push 한 번의 추정값): 분자와 분모를 같은 실행 집합으로 맞춘다. 분자는 `head`가 있는 job의 청구 분 합계, 분모는 그 job들의 서로 다른 `head`의 수다. 같은 head에서 여러 번 돈 실행(PR 다시 열기, 본문 수정으로 다시 돈 게이트, 다시 실행)은 그 head의 비용에 든다. PR 밖 실행(`offPr`)과 PR을 찾지 못한 실행은 분자에 넣지 않고 따로 보인다. 분모가 0이면 "해당 없음"으로 낸다. 출력에 "push를 직접 세지 않고 PR head로 센 추정값"이라고 적는다.
- **PR별**: `pr`이 있는 job을 PR 번호로 합친다. `pr`이 null이고 `offPr`이면 "PR 밖(main 등)", `offPr`이 아니면 "PR을 찾지 못함" 행이다.
- **30일 환산**: 합계를 기간의 날 수로 나눠 30을 곱한다. 달러는 소수 둘째 자리까지.
- **렌더**: 마크다운 표다. 같은 입력이면 출력이 같다(행의 순서는 청구 분 내림차순, 같으면 이름·번호 오름차순). prettier를 통과하는 모양으로 낸다.
- **출력에 넣는 이름**(14.6절): 워크플로·job 이름은 허용 목록(`known`)에 있는 것만 그대로 적는다. 목록에 없는 워크플로는 `(기타)` 행으로, 아는 워크플로의 모르는 job은 `<워크플로> / (기타)` 행으로 합친다. 실행 기록의 이름은 외부가 정할 수 있으므로(공개 리포에서는 포크의 PR이 `pull_request` 워크플로의 job 이름과 워크플로 파일을 정한다) 글자와 길이가 무난해도 목록에 없으면 적지 않는다. 목록에 있는 이름에도 글자 조건(`[A-Za-z0-9_.-]`, 40자 이하)을 한 번 더 건다. PR은 번호만 적는다. 제목, 브랜치 이름, 커밋 SHA, 계정 이름은 적지 않는다.

### 2. 자료 읽기 (`scripts/metrics/actions-source.ts`, 새 파일)

```ts
export interface ActionsSource {
  /** 기간에 만들어진 실행의 job 전부(모든 시도). 끝까지 읽지 못하면 SourceError */
  jobs(period: Period): JobRecord[];
}
export function ghActionsSource(o: { cwd: string /* 그 밖은 구현 재량 */ }): ActionsSource;
```

- `gh api`로 읽기만 한다. 실행 목록은 날짜별로 읽는다(`created=<날짜>`). 아래 가운데 하나면 `SourceError`다(`scripts/metrics/source.ts`의 `ghSource`가 실행을 읽을 때 쓰는 검사와 같다): 받은 수가 `total_count`와 다르다, 쪽마다 온 `total_count`가 서로 다르다, 같은 실행 id가 두 번 왔다(읽는 동안 목록이 바뀌어 다른 실행이 빠졌을 수 있다), 조회 상한(한 조회에 1,000건)에 닿았다.
- job은 실행마다 모든 시도를 받는다(`filter=all`). 쪽을 끝까지 넘긴다. job의 시도 번호는 job 기록의 `run_attempt`에서 읽는다(2026-11-21에 이 리포의 다시 실행한 실행에서 `filter=all` 응답의 job마다 `run_attempt`가 오는 것을 확인했다). `run_attempt`가 없거나 수가 아닌 job이 있으면 `SourceError`다(실행의 최신 시도 번호로 채우지 않는다). 받은 job 수가 그 조회의 `total_count`와 다르거나 같은 job id가 두 번 오면 `SourceError`다.
- **PR과 head 찾기**: `pull_request`·`pull_request_target` 실행은 실행 기록의 PR 번호와 head 커밋 SHA를 쓴다(포크의 PR이라 PR 목록이 비어 있으면 둘 다 null). `workflow_run`으로 시작한 실행은 `pull_request` 실행에서 본 head 커밋의 커밋 상태를 읽어, `target_url`이 가리키는 실행 번호로 그 PR과 head에 잇는다. 찾지 못하면 둘 다 null이다. 이 방법의 조회 수가 지나치면 다른 방법을 써도 된다(의사결정 로그에 적는다). 찾지 못한 실행을 버리지 않는다. `offPr`은 이벤트가 `push`이고 브랜치가 기본 브랜치인 실행만 참이다.
- 조회가 실패하면 `SourceError`를 던진다. 일부만 읽은 목록을 돌려주지 않는다.
- `scripts/metrics/source.ts`의 `Period`·`parsePeriod`·`daysOf`·`SourceError`는 가져다 쓴다.

### 3. 명령 (`scripts/commands/actions-cost.ts`, 새 파일. `scripts/harness.ts`에 등록)

```ts
export interface ActionsCostOptions {
  since?: string;
  until?: string;
  /** 테스트용. 주지 않으면 리포 루트의 `.github/workflows/*.yml`·`*.yaml`을 읽어 `knownNamesFrom`으로 만든다 */
  known?: KnownNames;
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
- 허용 목록은 명령을 실행한 체크아웃의 워크플로 파일에서 만든다(실행 기록에서 만들지 않는다). YAML을 읽는 의존성을 더하지 않는다(줄 단위로 읽는다. 읽지 못한 이름은 `(기타)`가 될 뿐이다).
- `scripts/harness.ts`의 도움말에 한 줄을 더한다.

### 4. 테스트 (`scripts/test/actions-cost.test.ts`, `scripts/test/actions-cost-command.test.ts`, 새 파일)

- 계산: 59초 job은 1분, 60초는 1분, 61초는 2분, 0초이지만 단계가 있는 job은 1분, 건너뛴 job·단계 0인 job·시각이 없는 job은 0분. 시도 둘은 둘 다 센다. 일부만 다시 실행한 입력(시도 1에서 A·B가 돌고 시도 2에서 B만 다시 돈다)에서 A는 한 번, B는 두 번 청구되고 job별 시도 번호가 맞는지 단언한다. 단가를 모르는 라벨과 `self-hosted`는 금액에 들지 않고 분이 따로 나온다. 올림으로 붙은 분, 30일 환산의 값을 단언한다. PR head 하나당 평균은 섞인 입력으로 단언한다: PR 밖 실행(main의 `push`)과 PR을 찾지 못한 실행이 있어도 값이 변하지 않고, 같은 head에서 실행이 여러 번 돌면 분모는 그대로이고 분자만 는다. `pr`이 null인 job은 `offPr`에 따라 "PR 밖" 행과 "PR을 찾지 못함" 행에 나뉘어 든다.
- 렌더: 같은 입력을 순서만 바꿔 넣어도 출력이 같다. 허용 목록에 없는 이름은 글자와 길이가 무난해도(예: 짧은 영문 낱말, 계정 이름처럼 보이는 글) 출력에 그대로 나오지 않고 `(기타)`로 합쳐진다. 목록에 있어도 글자 조건에 어긋나는 이름(마크다운 문법, 줄바꿈, 41자 이상)은 `(기타)`다. `knownNamesFrom`은 이 리포의 실제 워크플로 파일에서 `check`의 `check`, `gates`의 `evaluate`·`selftest`·`record`를 읽어 낸다. 출력에 PR 제목·브랜치 이름이 들어갈 길이 없다는 것(입력 타입에 그 필드가 없다)을 주석으로 적는다.
- 명령: 가짜 `ActionsSource`로 종료 코드 0·1·2를 확인한다. 2일 때 `out`이 한 번도 불리지 않는다. 기간이 틀리면 자료 원천을 부르지 않는다.
- 자료 읽기(`ghActionsSource`)는 `gh`를 가짜 실행 파일이나 주입한 실행 함수로 바꿔, `total_count` 불일치·쪽마다 다른 `total_count`·받은 수는 맞지만 실행 id가 중복된 응답·job id가 중복된 응답·`run_attempt`가 없는 job·조회 실패·쪽 넘김·`filter=all`·일부만 다시 실행한 응답의 시도 번호·PR과 head 찾기(상태의 `target_url`)를 확인한다. 오류 경우마다 명령이 종료 코드 2로 끝나고 표준 출력이 비어 있는지도 확인한다. 네트워크를 쓰지 않는다.

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
