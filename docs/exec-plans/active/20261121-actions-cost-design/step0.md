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
  /** 이 실행이 검증한 PR head 커밋의 SHA. `pr`이 null이면 null이다. head는 `pr`과 이 값의 쌍으로 센다. 세는 데만 쓰고 출력하지 않는다 */
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
     PR head의 수와 PR head 하나당 평균, 30일 환산(분, 달러), 단가를 모르는 러너와 self-hosted 러너의 분.
     전체 금액은 밀리달러 정수로도 낸다(`usdMilli`. 단가가 밀리달러 정수라 분 × 단가의 합이 정수다).
     예산과 견줄 때는 나눈 값이 아니라 이 정수를 쓴다(step1) */
}
export function actionsCost(jobs: JobRecord[], period: Period, known: KnownNames): CostReport;
export function renderCost(report: CostReport, period: Period): string;

/** 판단 절차 문서의 "기록" 표에 옮기는 칸 여섯: 기간, 청구 분, PR 하나당 청구 분(PR 밖 포함), PR 하나당 금액(PR 밖 포함), PR head 하나당 청구 분, 30일 환산 금액 */
export function recordCells(report: CostReport, period: Period): string[];

/** 보존 기록의 job 하나. 계산에 드는 값만 담는다. 글자열은 날짜, 허용 목록에 있는 이름, 정해 둔 낱말뿐이다 */
export interface SavedJob {
  run: number;
  attempt: number;
  /** 허용 목록에 있고 글자 조건에 맞는 이름. 아니면 '(기타)' */
  workflow: string;
  job: string;
  /** 실행이 만들어진 날짜(UTC, YYYY-MM-DD) */
  day: string;
  /** 돈 시간(초, 0 이상의 정수). 돌지 않은 job은 null */
  seconds: number | null;
  /** 단가표에 있는 라벨과 'self-hosted'만 그대로 둔다. 그 밖의 라벨은 '(기타)' */
  labels: string[];
  pr: number | null;
  /** PR head를 가르는 순번(1부터). SHA가 아니다. `pr`이 null이면 null */
  head: number | null;
  offPr: boolean;
}
export function toSaved(jobs: JobRecord[], known: KnownNames): SavedJob[];
export function fromSaved(saved: SavedJob[]): JobRecord[];
/** 보존 기록 파일의 글. 입력의 순서가 달라도 같은 기록이면 같은 글이다 */
export function formatSaved(saved: SavedJob[], period: Period): string;
/** 보존 기록 파일의 글을 읽는다. 형식에 어긋나면 SourceError */
export function parseSaved(text: string): { period: Period; jobs: SavedJob[] };
```

규칙:

- **돌지 않은 job**: `conclusion`이 `skipped`이거나, `startedAt`·`completedAt`이 없거나 날짜로 읽히지 않거나, `steps`가 0이면 0분이다. 수는 "돌지 않은 job"으로 따로 센다.
- **돈 job**: `completedAt − startedAt`(초, 음수면 0)을 60으로 나눠 올림하고 최소 1분이다. 초는 정수로 센다(GitHub의 시각은 초 단위다. 소수가 있으면 올림한다). 실제 초 합계도 이 정수 초로 낸다.
- **시도**: 같은 실행의 시도가 다르면 각각 센다. 일부 job만 다시 실행한 경우, 다시 돌지 않은 job은 앞선 시도의 기록 하나만 있으므로 한 번만 센다. 같은 job 기록(job id)이 두 번 들어오면 한 번만 세지 않고 자료 읽기가 오류로 끝낸다(아래 2).
- **단가**: 표를 코드에 둔다. 확인한 단가만 넣는다: 라벨이 `ubuntu-latest`·`ubuntu-24.04`·`ubuntu-22.04` 가운데 하나뿐이면 분당 $0.006(2코어 Linux x64, 2026-01-01부터). 라벨에 `self-hosted`가 있으면 `self-hosted`(금액 0, 분은 따로 보인다). 그 밖은 `unknown`(금액에 넣지 않고 분을 따로 보인다). 표의 주석에 값의 출처와 확인한 날짜를 적는다.
- **올림으로 붙은 분**: 돈 job의 청구 분 합계에서 실제 초 합계를 60으로 나눈 값을 뺀다.
- **PR head 하나당 평균**(push 한 번의 추정값): 분자와 분모를 같은 실행 집합으로 맞춘다. 분자는 `head`가 있는 job의 청구 분 합계, 분모는 그 job들의 서로 다른 (`pr`, `head`) 쌍의 수다. 같은 커밋을 두 PR이 함께 가지면 PR마다 따로 센다(보존 기록의 `head` 순번과 같은 기준이다. 원래 입력으로 계산하든 보존 기록에서 되돌린 입력으로 계산하든 수가 같다). 같은 head에서 여러 번 돈 실행(PR 다시 열기, 본문 수정으로 다시 돈 게이트, 다시 실행)은 그 head의 비용에 든다. PR 밖 실행(`offPr`)과 PR을 찾지 못한 실행은 분자에 넣지 않고 따로 보인다. 분모가 0이면 "해당 없음"으로 낸다. 출력에 "push를 직접 세지 않고 PR head로 센 추정값"이라고 적는다.
- **PR 하나당 평균**(예산과 견주는 값): 분모는 `pr`이 있는 job들의 서로 다른 PR 번호의 수다. 분자가 다른 두 값을 이름을 달리해 따로 낸다. (가) "PR에 이어진 실행만": `pr`이 있는 job의 청구 분 합계(분자와 분모가 같은 실행 집합이다). (나) "PR 밖 포함": 전체 청구 분. 병합 뒤 main의 `check`처럼 PR이 일으키지만 PR에 이어지지 않는 실행과 PR을 찾지 못한 실행까지 PR 수로 나눠 얹은 값이다. 예산은 프로젝트의 모든 Actions 비용을 PR 수로 나눈 것이라 (나)와 견준다. (나)는 금액으로도 낸다("PR 하나당 금액": 전체 금액 ÷ PR 수). 예산과의 비교는 금액으로 한다. 단가가 다른 러너가 섞이면 분으로는 견줄 수 없기 때문이다. 출력에 (나)가 분자에 PR 밖 실행을 넣은 값이라고 적는다. 분모가 0이면 둘 다 "해당 없음"이다.
- **PR별**: `pr`이 있는 job을 PR 번호로 합친다. `pr`이 null이고 `offPr`이면 "PR 밖(main 등)", `offPr`이 아니면 "PR을 찾지 못함" 행이다.
- **30일 환산**: 합계를 기간의 날 수로 나눠 30을 곱한다. 달러는 소수 둘째 자리까지.
- **기록 칸**(`recordCells`): 글자열 여섯을 이 순서로 낸다. 기간(`<since>~<until>`), 청구 분(정수, 자릿수 구분 없음), PR 하나당 청구 분((나) "PR 밖 포함". 소수 첫째 자리까지, 분모가 0이면 `해당 없음`), PR 하나당 금액((나)의 금액. `$` 뒤에 소수 셋째 자리까지, 분모가 0이면 `해당 없음`), PR head 하나당 청구 분(소수 첫째 자리까지 또는 `해당 없음`), 30일 환산 금액(`$` 뒤에 소수 둘째 자리까지). 렌더는 이 여섯 칸을 표의 한 행으로 낸다(칸의 글은 `recordCells`와 같다. 칸 사이의 공백은 표 정렬을 따른다). step1의 문서가 이 행을 "기록" 표에 옮기고 검사 스크립트가 `recordCells`의 값과 대 본다.
- **렌더**: 마크다운 표다. 같은 입력이면 출력이 같다(행의 순서는 청구 분 내림차순, 같으면 이름·번호 오름차순). prettier를 통과하는 모양으로 낸다.
- **출력에 넣는 이름**(14.6절): 워크플로·job 이름은 허용 목록(`known`)에 있는 것만 그대로 적는다. 목록에 없는 워크플로는 `(기타)` 행으로, 아는 워크플로의 모르는 job은 `<워크플로> / (기타)` 행으로 합친다. 실행 기록의 이름은 외부가 정할 수 있으므로(공개 리포에서는 포크의 PR이 `pull_request` 워크플로의 job 이름과 워크플로 파일을 정한다) 글자와 길이가 무난해도 목록에 없으면 적지 않는다. 목록에 있는 이름에도 글자 조건(`[A-Za-z0-9_.-]`, 40자 이하)을 한 번 더 건다. PR은 번호만 적는다. 제목, 브랜치 이름, 커밋 SHA, 계정 이름은 적지 않는다.

### 1-1. 보존 기록 (같은 파일 `scripts/metrics/actions-cost.ts`)

기준선을 잰 뒤에 그 기간의 실행을 누가 다시 실행하면 시도가 늘고, 실행 기록이 지워지거나 PR이 닫히면 GitHub이 주는 값이 달라질 수 있다. 그래서 잰 시점의 입력을 파일로 남기고(보존 기록), 그 뒤의 확인은 GitHub을 다시 읽지 않고 그 파일로 한다. 기준은 보존 기록이다.

- **`toSaved`**: job마다 계산에 드는 값만 옮긴다.
  - `workflow`·`job`: 렌더의 이름 규칙과 같다(허용 목록에 있고 글자 조건에 맞으면 그대로, 아니면 `(기타)`. 워크플로가 `(기타)`면 job도 `(기타)`다).
  - `day`: `createdAt`의 UTC 날짜.
  - `seconds`: 돌지 않은 job(위 규칙)은 null, 돈 job은 위 "돈 job"의 정수 초다.
  - `labels`: 단가표에 있는 라벨과 `self-hosted`는 그대로, 그 밖은 `(기타)`로 바꾼다. 바꾼 뒤에도 `runnerRate`의 결과(`kind`와 단가)가 바꾸기 전과 같아야 한다.
  - `head`: 입력에 있는 서로 다른 (PR 번호, head SHA) 쌍을 PR 번호, SHA 순으로 늘어놓은 순번(1부터). 같은 커밋을 두 PR이 함께 가지면 PR마다 다른 순번이다. SHA는 옮기지 않는다.
  - `event`, `conclusion`, 시각(시·분·초), `steps`는 옮기지 않는다.
- **`fromSaved`**: 보존 기록을 계산의 입력(`JobRecord`)으로 되돌린다. 없는 값은 계산 결과가 같아지게 채운다(돌지 않은 job은 `conclusion: 'skipped'`·`steps: 0`·시각 null, 돈 job은 그 날짜의 0시에 시작해 `seconds`초 뒤에 끝난 것으로, `head`는 순번을 글자열로). 지켜야 하는 것은 하나다: 어떤 입력 `jobs`에도 `renderCost(actionsCost(fromSaved(toSaved(jobs, known)), period, known), period)`가 `renderCost(actionsCost(jobs, period, known), period)`와 같은 글이다.
- **파일 형식**(`formatSaved`, 확장자 `.jsonl`): 첫 줄은 머리 `{"version":1,"since":"<날짜>","until":"<날짜>","count":<job 수>,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}`, 이어서 job마다 한 줄(`columns` 순서의 JSON 배열, 공백 없음)이다. 줄은 `run`, `attempt`, 그다음 줄의 글자열 순으로 늘어놓는다. 모든 줄은 `\n`으로 끝난다. 같은 기록이면 입력 순서와 무관하게 같은 글이다.
- **`parseSaved`**: 아래 가운데 하나라도 어긋나면 `SourceError`다(일부만 읽은 값을 돌려주지 않는다). 머리 줄이 위 형식이다(`version`이 1, `columns`가 위 목록과 같다, `since`·`until`이 `parsePeriod`를 통과한다). 줄 수가 `count`와 같다. 줄마다 길이가 `columns`와 같은 배열이다. `run`·`attempt`는 1 이상의 안전한 정수, `seconds`는 0 이상의 안전한 정수 또는 null, `pr`·`head`는 1 이상의 안전한 정수 또는 null이고 `pr`이 null이면 `head`도 null, `offPr`은 참·거짓이고 `pr`이 있으면 거짓이다. `day`는 기간 안의 날짜다. `workflow`·`job`은 `(기타)`이거나 글자 조건(`[A-Za-z0-9_.-]`, 40자 이하)에 맞는다. `labels`의 원소는 단가표의 라벨, `self-hosted`, `(기타)` 가운데 하나다. 빈 줄이나 남는 글이 없다.
- `--from`으로 읽은 이름도 렌더에서 체크아웃의 허용 목록을 다시 거친다(파일을 고쳐 허용 목록 밖의 이름을 출력에 넣을 길이 없다).

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
- **PR과 head 찾기**: 실행 기록의 PR 목록(`pull_requests`)은 쓰지 않는다. PR이 닫히면 비기 때문이다(2026-11-21에 확인: 2026-11-17의 실행 100건 모두 비어 있었다). 지난 기간을 재면 그 목록으로는 PR을 하나도 찾지 못한다. 아래 순서로 찾는다.
  - PR 이벤트 실행(`pull_request`·`pull_request_target`·`pull_request_review`)의 실행 기록에는 PR의 head 커밋(`head_sha`), head 브랜치(`head_branch`), head 리포의 소유자, 실행이 처음 만들어진 때(`created_at`. 다시 실행해도 바뀌지 않는다)가 있다(2026-11-21에 이 리포의 실행에서 세 이벤트 모두 확인). PR은 커밋으로 찾지 않고 브랜치와 시각으로 찾는다. 실행마다 따로 정한다: 커밋이 같은 실행도 브랜치나 만들어진 때가 다르면 다른 PR의 것일 수 있다(두 브랜치의 PR이 같은 커밋을 함께 가질 수 있고, 닫은 PR의 브랜치로 새 PR을 열 수 있다).
  - **후보**: 그 소유자와 브랜치로 연 PR 가운데, 만들어진 때(`created_at`)가 그 실행이 만들어진 때보다 늦지 않은 PR이다. 조회는 `repos/{owner}/{repo}/pulls?state=all&head=<소유자>:<브랜치>`이고 소유자·브랜치마다 한 번 한다(쪽을 끝까지 넘긴다. 병합하지 않고 닫은 PR도 준다. 2026-11-21에 PR #113에서 확인). 받은 PR 가운데 head 브랜치와 head 리포 소유자가 그 값과 같은 것만 본다(`head` 값의 꼴이 어긋나면 GitHub이 조건을 무시하고 모든 PR을 준다. 같은 날 확인). 실행보다 늦게 만들어진 PR은 그 실행이 만들어질 때 없던 PR이라 후보가 아니다. 같은 초에 만들어졌으면 후보다(2026-11-21에 PR #113·#114·#136·#168·#171에서 확인: 첫 실행은 PR이 만들어지고 3~4초 뒤에 만들어졌다). PR의 만들어진 때를 읽지 못하면 오류다.
  - **고르기**: 후보가 정확히 하나면 그 실행은 그 PR의 것이다(PR 이벤트 실행은 그 브랜치를 head로 하는 PR에서만 생기고, 그때 있던 PR이 그것뿐이다). 후보가 없거나 둘 이상이면 잇지 않는다("PR을 찾지 못함"에 든다). 둘 이상일 때 다른 근거로 고르지 않는다. PR의 커밋 목록은 force push로 지워진 커밋이 빠지고 250개에서 잘리며, PR의 지금 head는 실행 뒤에 바뀌고, 닫힌 때는 다시 열면 지워지며 닫힌 PR에서도 실행이 생긴다(본문 수정으로 도는 게이트, 리뷰로 도는 `review-trigger`). 어느 것도 "그 실행이 어느 PR의 것인가"를 확정하지 못한다. 그래서 닫은 PR의 브랜치로 PR을 다시 열면, 두 번째 PR이 만들어진 뒤에 그 브랜치에서 만들어진 실행은 어느 PR에도 잇지 않는다. 이것이 이 방법의 한계다(2026-11-21에 이 리포의 PR 119개를 확인: 브랜치를 다시 쓴 것은 #13·#30 한 쌍이다). 병합하지 않고 닫은 PR도 이렇게 찾고, PR 수와 PR별 합계에 든다(버려진 PR도 PR 하나다).
  - 실행 기록에 브랜치나 소유자가 없는 실행(지워진 포크)은 조회하지 않고, 잇지 않는다. 커밋에 이어진 PR 조회(`commits/<sha>/pulls`)는 쓰지 않는다: 병합된 PR과 열린 PR만 주므로(2026-11-21에 PR #113·#114·#136의 커밋과 GitHub REST 문서에서 확인), 병합하지 않고 닫은 PR의 실행을 그 커밋을 함께 가진 다른 PR에 잘못 이을 수 있다.
  - 브랜치 이름과 소유자 이름은 외부 입력이다. 조회의 `head` 값으로만 쓰고(퍼센트 인코딩한다), 출력·보존 기록·오류 문구에 넣지 않는다. 이 조회가 실패했을 때의 오류 문구에는 `gh`의 오류 글을 옮기지 않는다(주소에 브랜치 이름이 들어 있을 수 있다).
  - PR을 찾은 PR 이벤트 실행의 `head_sha`가 그 PR의 head다. 같은 커밋이 두 PR의 head면 PR마다 따로 센다(head는 PR과 커밋의 쌍이다). 이벤트가 `push`도 `workflow_run`도 PR 이벤트도 아닌 실행(`workflow_dispatch` 등)은 같은 방법으로 PR을 찾되, 그 PR과 그 실행의 `head_sha`가 위에서 찾은 head(쌍)일 때만 잇는다.
  - `workflow_run`으로 시작한 실행은 `head_sha`가 기본 브랜치의 커밋이라 위 방법으로 이을 수 없다. PR을 찾은 head 커밋마다 커밋 상태를 읽어(쪽을 끝까지 넘긴다), `target_url`이 가리키는 실행 번호의 실행을 그 PR과 head에 잇는다. 한 실행을 두 커밋의 상태가 가리키면 잇지 않는다. 그 커밋이 두 PR의 head여도 잇지 않는다(커밋 상태는 커밋에 붙어 있어 어느 PR의 것인지 가릴 수 없다).
  - **head를 찾는 범위는 청구 기간보다 넓고, 원본 실행이 끝난 때로 정한다.** `workflow_run` 실행은 원본 실행(판정은 `check`, 승인 뒤의 게이트는 `review-trigger`)이 끝난 직후에 만들어지고, 상태는 원본 실행의 `head_sha`에 남는다. 그래서 기간 안에 만들어진 `workflow_run` 실행의 원본은 기간 시작 직전이나 그 뒤에 끝난 실행뿐이다. 실행 기록의 `updated_at`은 그 실행이 끝난 때보다 앞서지 않는다. 기간 시작 전에 만들어진 PR 이벤트 실행 가운데 `updated_at`이 "기간 시작 하루 전의 UTC 0시" 이후인 것의 `head_sha`를 head 후보에 더한다(하루는 원본이 끝난 때와 다음 실행이 만들어진 때 사이의 차이를 덮는 여유다). 만들어진 날짜로 자르지 않는다. 다시 실행한 실행은 `created_at`이 처음 그대로이고 `updated_at`만 바뀌므로(2026-11-21에 이 리포의 다시 실행한 실행에서 확인), 오래전에 만들어진 실행이 기간 안에 다시 실행돼 판정을 일으킨 경우도 이 조건에 든다.
  - 기간 시작 전의 실행 목록은 66일(`LOOKBACK_DAYS`)을 날짜별로, 같은 검사로 읽는다. 66일은 GitHub의 한도에서 나온 값이다: 실행은 처음 실행한 뒤 30일까지만 다시 실행할 수 있고, 실행 하나는 기다린 시간을 합쳐 35일을 넘기지 못한다(2026-11-21에 GitHub 문서 "Re-running workflows and jobs"와 "Actions limits"에서 확인). 위 조건에 드는 실행은 끝난 때보다 65일 넘게 앞서 만들어졌을 수 없고, 여유 하루를 더해 66일이다. 이 범위 밖에는 조건에 드는 실행이 없다.
  - 기간 시작 전의 실행은 PR과 head를 찾는 데만 쓴다. job을 읽지 않고, 돌려주는 job과 청구 합계에 넣지 않는다(돌려주는 job은 기간 안에 만들어진 실행의 것뿐이다). 조건에 들지 않는 실행의 `head_sha`는 PR 조회도 상태 조회도 하지 않는다.
  - 잇는 사슬은 한 단계다(PR 이벤트 실행 → `workflow_run` 실행). `workflow_run` 실행이 다시 일으킨 `workflow_run` 실행은 그 head가 다른 길로 후보에 들었을 때만 이어진다(이 리포에는 그런 워크플로가 없다).
  - 어디에도 이어지지 않은 실행은 PR과 head 둘 다 null이다(상태를 남기지 않는 `revert` 실행, 판정 없이 끝난 판정 실행이 그렇다). 버리지 않는다("PR을 찾지 못함"으로 합산한다). `offPr`은 이벤트가 `push`이고 브랜치가 기본 브랜치인 실행만 참이다.
  - 조회가 실패하면 `SourceError`다. 찾지 못한 것(null)과 읽지 못한 것(오류)을 가른다.
- 조회가 실패하면 `SourceError`를 던진다. 일부만 읽은 목록을 돌려주지 않는다.
- `scripts/metrics/source.ts`의 `Period`·`parsePeriod`·`daysOf`·`SourceError`는 가져다 쓴다.

### 3. 명령 (`scripts/commands/actions-cost.ts`, 새 파일. `scripts/harness.ts`에 등록)

```ts
export interface ActionsCostOptions {
  since?: string;
  until?: string;
  /** 읽은 기록을 보존 기록으로 남길 파일 */
  save?: string;
  /** GitHub 대신 읽을 보존 기록 파일 */
  from?: string;
  /** 테스트용. 주지 않으면 리포 루트의 `.github/workflows/*.yml`·`*.yaml`을 읽어 `knownNamesFrom`으로 만든다 */
  known?: KnownNames;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}
export function runActionsCost(cwd: string, o: ActionsCostOptions, source?: ActionsSource): number;
```

- 순서: 인자·기간 검사 → 자료 읽기 → (`--save`가 있으면) 보존 기록 쓰기 → 계산·렌더 → 출력. 기간의 기본값은 `metrics`와 같다(`until`은 오늘(UTC), `since`는 그 6일 전).
- 종료 코드: 0 성공, 1 인자나 기간이 틀림(GitHub과 보존 기록을 읽기 전), 2 자료를 끝까지 읽지 못함(표준 출력에 아무것도 내지 않는다).
- 진행 상황(읽은 실행 수)은 표준 오류로만 낸다.
- **`--save <파일>`**: 자료를 끝까지 읽은 뒤 `formatSaved(toSaved(…), 기간)`을 그 파일에 쓴다. 그 파일이 이미 있으면 GitHub을 읽기 전에 종료 코드 1로 끝나고 파일을 그대로 둔다(남긴 기준을 다시 잰 값으로 덮어쓰지 않는다). 같은 폴더의 임시 파일에 다 쓴 뒤, 대상이 이미 있으면 실패하는 방식으로 대상 경로에 놓는다: 임시 파일에서 대상 경로로 하드 링크를 걸고(대상이 있으면 운영체제가 거부한다) 임시 파일을 지운다. 이름 바꾸기는 대상을 덮어쓰므로 쓰지 않는다. 처음의 존재 검사는 빨리 끝내려는 것이고, 덮어쓰지 않는다는 보장은 이 놓기가 한다. 읽는 사이에 다른 명령이 같은 경로에 먼저 저장했으면(두 명령이 처음 검사를 함께 통과한 경우) 놓기가 실패하고, 이 명령은 종료 코드 2로 끝나며 표준 출력에 아무것도 내지 않는다. 먼저 저장된 파일의 내용은 그대로다. 자료 읽기나 쓰기가 실패하면 그 파일은 생기지 않고 임시 파일도 남지 않는다.
- **`--from <파일>`**: 자료 원천을 부르지 않고(GitHub을 읽지 않는다) 그 파일을 `parseSaved`로 읽어 `fromSaved`의 결과로 계산한다. 기간은 파일의 머리 줄의 것이다. `--since`·`--until`·`--save`와 함께 주면 종료 코드 1이다. 파일이 없거나 `parseSaved`가 실패하면 종료 코드 2이고 표준 출력에 아무것도 내지 않는다.
- GitHub에서 읽은 경로도 계산은 `fromSaved(toSaved(…))`를 거친 입력으로 한다. 그래서 같은 체크아웃에서 `--save`로 낸 출력과 그 파일을 `--from`으로 낸 출력이 같은 글이다.
- `--save`를 주지 않으면 파일을 쓰지 않는다. `--save`는 그 파일 하나만 쓴다.
- 허용 목록은 명령을 실행한 체크아웃의 워크플로 파일에서 만든다(실행 기록에서 만들지 않는다). YAML을 읽는 의존성을 더하지 않는다(줄 단위로 읽는다. 읽지 못한 이름은 `(기타)`가 될 뿐이다).
- `scripts/harness.ts`의 도움말에 한 줄을 더한다.

### 4. 테스트 (`scripts/test/actions-cost.test.ts`, `scripts/test/actions-cost-command.test.ts`, 새 파일)

- 계산: 59초 job은 1분, 60초는 1분, 61초는 2분, 0초이지만 단계가 있는 job은 1분, 건너뛴 job·단계 0인 job·시각이 없는 job은 0분. 시도 둘은 둘 다 센다. 일부만 다시 실행한 입력(시도 1에서 A·B가 돌고 시도 2에서 B만 다시 돈다)에서 A는 한 번, B는 두 번 청구되고 job별 시도 번호가 맞는지 단언한다. 단가를 모르는 라벨과 `self-hosted`는 금액에 들지 않고 분이 따로 나온다. 올림으로 붙은 분, 30일 환산의 값을 단언한다. PR head 하나당 평균은 섞인 입력으로 단언한다: PR 밖 실행(main의 `push`)과 PR을 찾지 못한 실행이 있어도 값이 변하지 않고, 같은 head에서 실행이 여러 번 돌면 분모는 그대로이고 분자만 는다. 같은 커밋을 head로 가진 두 PR에 1분 job이 하나씩 있으면 head는 둘이고 평균은 1.0이다(커밋으로 세면 하나에 2.0이다). `pr`이 null인 job은 `offPr`에 따라 "PR 밖" 행과 "PR을 찾지 못함" 행에 나뉘어 든다.
- PR 하나당 평균: (가)는 PR 밖 실행과 PR을 찾지 못한 실행이 있어도 값이 변하지 않고, (나)는 그만큼 는다. 두 값의 분모가 같다. `recordCells`의 여섯 칸을 값으로 단언하고(분모 0의 `해당 없음` 포함), 렌더의 표에서 그 행을 찾아 칸의 글이 `recordCells`와 같은지 단언한다.
- 보존 기록: 섞인 입력(돈 job, 돌지 않은 job 세 가지, 목록에 없는 이름, 모르는 라벨, `self-hosted`, 시도 둘, PR 밖, PR을 찾지 못함, 같은 head의 실행 여럿, 같은 커밋을 head로 가진 두 PR)에서 `fromSaved(toSaved(…))`로 계산한 렌더가 원래 입력의 렌더와 같은 글이다. `formatSaved`의 글에 입력의 head SHA, 목록에 없는 이름, 모르는 라벨이 나오지 않는다. `formatSaved`는 입력 순서를 바꿔도 같은 글이고 `parseSaved(formatSaved(x))`는 `x`와 같다. `toSaved`가 바꾼 라벨의 `runnerRate`가 바꾸기 전과 같다. `parseSaved`는 어긋난 파일마다 `SourceError`를 던진다: 빈 글, `version`이 다름, `columns`가 다름, 줄 하나가 빠져 `count`와 다름, 줄이 하나 더 있음, 배열 길이가 다름, 수 자리에 글자열, 음수·소수, 기간 밖의 날짜, 날짜 꼴이 아닌 `day`, 글자 조건에 어긋난 이름, 정해 둔 것 밖의 라벨, `pr`이 null인데 `head`가 있음, 끝에 남는 글.
- 렌더: 같은 입력을 순서만 바꿔 넣어도 출력이 같다. 허용 목록에 없는 이름은 글자와 길이가 무난해도(예: 짧은 영문 낱말, 계정 이름처럼 보이는 글) 출력에 그대로 나오지 않고 `(기타)`로 합쳐진다. 목록에 있어도 글자 조건에 어긋나는 이름(마크다운 문법, 줄바꿈, 41자 이상)은 `(기타)`다. `knownNamesFrom`은 이 리포의 실제 워크플로 파일에서 `check`의 `check`, `gates`의 `evaluate`·`selftest`·`record`를 읽어 낸다. 출력에 PR 제목·브랜치 이름이 들어갈 길이 없다는 것(입력 타입에 그 필드가 없다)을 주석으로 적는다.
- 명령: 가짜 `ActionsSource`로 종료 코드 0·1·2를 확인한다. 2일 때 `out`이 한 번도 불리지 않는다. 기간이 틀리면 자료 원천을 부르지 않는다.
- 명령의 보존 기록(임시 폴더에서): `--save`가 파일을 쓰고, 그 파일을 `--from`으로 낸 출력이 `--save` 때의 출력과 같은 글이다. `--from`은 자료 원천을 한 번도 부르지 않는다. `--save`의 파일이 이미 있으면 종료 코드 1이고 자료 원천을 부르지 않으며 파일의 내용이 그대로다. 자료 읽기가 실패한 `--save`는 종료 코드 2이고 파일이 생기지 않는다(임시 파일도 남지 않는다). 두 저장이 처음 검사를 함께 통과한 경우: 가짜 자료 원천이 읽는 도중에 대상 경로에 다른 내용의 파일을 만들면(먼저 끝난 다른 명령), 종료 코드 2이고 `out`이 불리지 않으며 그 파일의 내용이 먼저 쓴 것 그대로이고 임시 파일이 남지 않는다. `--from`을 `--since`·`--until`·`--save`와 함께 주면 종료 코드 1이다. 없는 파일과 형식이 어긋난 파일의 `--from`은 종료 코드 2이고 `out`이 불리지 않는다. `--save`를 주지 않은 실행 뒤에 임시 폴더가 비어 있다.
- 자료 읽기(`ghActionsSource`)는 `gh`를 가짜 실행 파일이나 주입한 실행 함수로 바꿔, `total_count` 불일치·쪽마다 다른 `total_count`·받은 수는 맞지만 실행 id가 중복된 응답·job id가 중복된 응답·`run_attempt`가 없는 job·조회 실패·쪽 넘김·`filter=all`·일부만 다시 실행한 응답의 시도 번호·PR과 head 찾기를 확인한다. PR과 head 찾기는 경우마다 본다: 실행 기록의 PR 목록이 비어 있어도 실행 기록의 브랜치로 PR을 찾는다, `workflow_run` 실행을 상태의 `target_url`로 잇는다, 두 head의 상태가 가리키는 실행과 어느 상태도 가리키지 않는 실행은 null이다, 기본 브랜치의 `push` 실행만 `offPr`이다, PR 조회나 상태 조회의 실패는 null이 아니라 오류다. 브랜치와 시각으로 찾기: 병합하지 않고 닫은 PR의 실행이 그 PR에 이어진다(PR의 커밋 목록 조회와 커밋에 이어진 PR 조회는 어느 경우에도 부르지 않는다). 같은 커밋을 가진 두 브랜치의 PR A와 B에서 A 브랜치의 실행은 A에, B 브랜치의 실행은 B에 이어지고 PR 수가 2이며 head도 둘로 센다. 그 커밋의 상태가 가리키는 `workflow_run` 실행은 어느 PR에도 잇지 않는다. 같은 브랜치를 다시 쓴 두 PR A(먼저 만들어졌고 닫혔다)와 B(나중에 만들어졌고 지금 head가 A의 커밋과 같다)가 같은 커밋을 함께 가진 응답에서, B가 만들어지기 전에 만들어진 실행은 A에 이어지고, B가 만들어진 뒤에 만들어진 실행은 null이며, PR 수는 1이다(B에 잇지 않는다). B가 만들어지기 전에 만들어졌다가 그 뒤에 다시 실행된 실행(`created_at`은 그대로이고 `updated_at`만 늦다)은 A에 이어진다. PR과 실행이 같은 초에 만들어졌으면 그 PR은 후보다. 그 브랜치의 PR이 실행보다 늦게 만들어진 것뿐이면 null이다. 다른 브랜치나 다른 소유자의 PR이 응답에 섞여 와도 후보가 아니다. 만들어진 때가 없거나 시각 꼴이 아닌 PR이 오면 오류다. 브랜치 조회의 실패는 오류이고 그 문구에 브랜치 이름이 없다. 특수 글자가 든 브랜치 이름(`&`, `#`, 공백, `{owner}`)이 인코딩돼 조회에 들어간다. 같은 브랜치의 실행이 여럿이어도 브랜치 조회는 한 번이다. 실행 기록에 브랜치나 소유자가 없으면 조회를 하지 않고 null이다. `workflow_dispatch` 실행은 그 PR과 커밋이 PR 이벤트 실행으로 찾은 head일 때만 이어지고, 아니면 null이다. 기간 밖의 원본 실행: 원본 `check`가 기간 전날 23시대에 만들어지고 판정 실행이 기간 첫날에 만들어진 응답에서, 판정 실행이 그 PR과 head에 이어지고, 전날의 실행은 job 조회가 불리지 않으며 돌려준 job에 없다. 원본 실행이 기간 시작 40일 전에 만들어졌고 기간 안에 다시 실행된(`updated_at`이 기간 안) 응답에서도 판정 실행이 이어진다. 며칠 전에 push된 head를 기간 안에 리뷰해 `review-trigger`(`pull_request_review`)와 게이트가 돈 응답에서, 게이트 실행이 `review-trigger` 실행의 `head_sha`로 이어진다. 기간 전에 만들어졌고 `updated_at`이 기간 시작 하루 전의 0시보다 앞선 실행의 `head_sha`는 PR 조회와 상태 조회가 불리지 않는다. 실행 목록 조회는 기간의 날 수 + 66번이고 그보다 앞선 날은 읽지 않는다. 오류 경우마다 명령이 종료 코드 2로 끝나고 표준 출력이 비어 있는지도 확인한다. 네트워크를 쓰지 않는다.

### 5. 문서

- `docs/harness/architecture.md`: 명령 목록과 `metrics/*` 행에 `actions-cost`를 더한다.
- `docs/harness/CHANGELOG.md`: "다음 버전" 아래에 한 줄(`actions-cost` 명령). 이 step은 보호 경로(`scripts/**`, `docs/harness/**`)를 바꾸므로 `harness-guard`가 이 줄을 요구한다.

## Acceptance Criteria

```bash
node --test scripts/test/actions-cost.test.ts scripts/test/actions-cost-command.test.ts
node scripts/harness.ts actions-cost --since 2026-13-01; test $? -eq 1
node scripts/harness.ts actions-cost --since 2026-11-20 --until 2026-11-19; test $? -eq 1
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from "$T/none.jsonl"; test $? -eq 2
T=$(mktemp -d) && printf 'x\n' > "$T/bad.jsonl" && node scripts/harness.ts actions-cost --from "$T/bad.jsonl"; test $? -eq 2
T=$(mktemp -d) && printf 'x\n' > "$T/bad.jsonl" && test -z "$(node scripts/harness.ts actions-cost --from "$T/bad.jsonl" 2>/dev/null)"
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from "$T/none.jsonl" --since 2026-11-17; test $? -eq 1
T=$(mktemp -d) && printf 'x\n' > "$T/have.jsonl" && node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-17 --save "$T/have.jsonl"; test $? -eq 1
T=$(mktemp -d) && printf '%s\n' '{"version":1,"since":"2026-11-17","until":"2026-11-17","count":1,"columns":["run","attempt","workflow","job","day","seconds","labels","pr","head","offPr"]}' '[1,1,"check","check","2026-11-17",61,["ubuntu-latest"],5,1,false]' > "$T/one.jsonl" && node scripts/harness.ts actions-cost --from "$T/one.jsonl" > "$T/out.md" && grep -Eq '^\| 2026-11-17~2026-11-17 +\| 2 +\| 2\.0 +\| \$0\.012 +\| 2\.0 +\| \$0\.36 +\|$' "$T/out.md"
grep -q "actions-cost" docs/harness/architecture.md
grep -q "actions-cost" docs/harness/CHANGELOG.md
node scripts/harness.ts check
```

- 보존 기록을 보는 여섯 줄은 GitHub을 읽지 않는다. 앞의 다섯은 읽기 전에 끝나는 경우다. 여섯째는 그 자리에서 만든 보존 기록(61초를 돈 `check` job 하나, PR 하나, head 하나, 기간 하루)을 `--from`으로 계산해 기록 칸 행을 본다: 청구 2분, PR 하나당 2.0분, PR 하나당 금액 $0.012(2분 × $0.006), PR head 하나당 2.0분, 30일 환산 $0.36(2분 × 30일 × $0.006). 실제 기간을 읽어 보존 기록을 남기는 일은 step1이 한다.

## 금지사항

- GitHub에 쓰는 호출(`POST`·`PATCH`·`PUT`·`DELETE`, `gh run rerun`, 댓글·라벨)을 넣지 마라. 이유: 재는 명령이다. 읽기만 한다.
- 확인하지 않은 단가를 표에 넣지 마라(1코어, arm64, Windows, macOS 등). 이유: 틀린 금액이 판단 자료가 된다. 모르는 러너는 분만 보인다. 단가를 더하는 일은 step2의 조사에서 출처를 확인한 뒤 한다.
- 보존 기록에 커밋 SHA, 브랜치 이름, PR 제목, 계정 이름, 허용 목록에 없는 워크플로·job 이름, 정해 둔 것 밖의 라벨을 넣지 마라. 이유: 이 파일은 리포에 남고, 실행 기록의 글자열은 외부가 정할 수 있다(14.6절).
- 있는 보존 기록 파일을 덮어쓰지 마라. 이유: 그 파일이 기준이다. 다시 잰 값으로 바뀌면 기준선과 문서가 어긋난 것을 알 수 없다.
- 자료를 일부만 읽고 값을 내지 마라. 이유: 적게 나온 값이 "예산 안"이라는 잘못된 판단을 만든다.
- 출력에 PR 제목, 브랜치 이름, 커밋 SHA, 계정 이름, 절대 경로를 넣지 마라. 이유: 14.6절(외부 입력을 문서로 옮기지 않는다)과 결과가 문서에 붙는다는 점.
- `scripts/metrics/source.ts`에 있는 export의 동작과 `metrics` 명령의 출력을 바꾸지 마라. 이유: `docs/QUALITY_SCORE.md`의 집계가 그 출력에 묶여 있다.
- `.github/workflows/`와 `harness.config.json`을 고치지 마라. 이유: 워크플로는 제작자가 적용하고, 이 step은 설정을 더하지 않는다.
- 테스트에서 실제 GitHub을 부르지 마라. 이유: `check`는 네트워크 없이 같은 결과를 내야 한다.
