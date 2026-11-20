# Step 0: pilot

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 17.2절(지표), 12.2절(정기 작업), 14.6절(외부 입력)
- `docs/QUALITY_SCORE.md`
- `scripts/harness.ts`(`OPTIONS`, `HELP`, `case 'ops-check'`: 명령 등록 방식)
- `scripts/commands/ops-check.ts`, `scripts/test/ops-check.test.ts`(명령 파일과 테스트의 본보기), `scripts/test/helpers.ts`
- `scripts/ci/ledger.ts`(`Ledger`, `Entry`), `scripts/runner/ledger-read.ts`(`readPrLedger`), `scripts/lib/github.ts`(`getGitHub`), `scripts/lib/exec.ts`(`runSync`), `scripts/lib/git.ts`(`repoInfo`)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 자료 읽기 `scripts/metrics/source.ts`

```ts
export interface Period {
  since: string;
  until: string;
} // YYYY-MM-DD(UTC), 양끝 포함
export class SourceError extends Error {}
export function parsePeriod(
  since: string | undefined,
  until: string | undefined,
  now: Date,
): Period;
export function inPeriod(iso: string, p: Period): boolean;

export interface MergedPr {
  number: number;
  head: string;
  headSha: string;
  createdAt: string;
  mergedAt: string;
  /** main에 들어간 병합 커밋의 SHA. 모르면 '' */
  mergeSha: string;
  additions: number;
  deletions: number;
}
export interface WorkflowRun {
  path: string;
  event: string;
  branch: string;
  headSha: string;
  status: string;
  conclusion: string;
  createdAt: string;
  startedAt: string;
  updatedAt: string;
  attempt: number;
}
export interface BugIssue {
  number: number;
  createdAt: string;
}

export interface MetricsSource {
  mergedPrs(p: Period): MergedPr[];
  workflowRuns(p: Period): WorkflowRun[];
  bugIssues(p: Period): BugIssue[];
  /** PR의 지적 원장. 없으면 null */
  ledger(pr: number): Ledger | null;
}
export function ghSource(o: {
  cfg: HarnessConfig;
  /** `gh <args>`를 실행해 표준 출력을 돌려준다. 실패하면 예외 */
  gh: (args: string[]) => string;
  ledger: (pr: number) => Ledger | null;
}): MetricsSource;
/** 실제 `gh` CLI와 `readPrLedger`를 끼운 `ghSource` */
export function defaultSource(cwd: string, cfg: HarnessConfig): MetricsSource;
```

- `parsePeriod`: 형식이 `YYYY-MM-DD`가 아니거나 없는 날짜이거나 `since`가 `until`보다 뒤면 예외(`SourceError`가 아닌 일반 오류, 명령이 종료 코드 1로 바꾼다). `until`이 없으면 `now`의 UTC 날짜, `since`가 없으면 `until`의 6일 전.
- `inPeriod`: `since`일 00:00:00Z 이상이고 `until` 다음 날 00:00:00Z 미만이면 참.
- `ghSource`는 받은 `gh` 함수로만 GitHub을 읽는다. 읽기 요청만 보낸다: 인자 배열은 아래 "읽기 요청 꼴" 가운데 PR·Issue·실행 조회 셋 중 하나와 자리마다 맞는다(다른 인자를 덧붙이지 않는다). `defaultSource`의 `gh` 함수는 `runSync('gh', args, { cwd, timeoutMs: 120_000 })`이고 종료 코드가 0이 아니면 예외다.
  - `mergedPrs`: `gh pr list --state merged --base <cfg.github.defaultBranch> --search "merged:<since>..<until 다음 날>" --limit 1000 --json …`으로 기본 브랜치에 병합된 PR을 읽고(검색은 끝을 하루 넉넉히 잡는다. 검색의 날짜 경계가 UTC와 어긋나도 빠지지 않게 한다) `mergedAt`이 기간 안인 것만 남긴다. 받은 수가 1000이면 `SourceError`(다 읽었는지 알 수 없다).
  - `workflowRuns`: 기간의 날짜마다 `gh api --paginate "repos/{owner}/{repo}/actions/runs?created=<날짜>&per_page=100"`으로 읽는다. 이 API는 `created` 조건이 있으면 조회 하나에 1000건까지만 준다. 응답의 `total_count`를 함께 받아, 그날 받은 실행 수가 `total_count`와 다르거나 `total_count`가 1000 이상이면 `SourceError`다(1000건이면 상한에 닿은 것이라 다 읽었는지 알 수 없다).
  - `bugIssues`: `gh issue list --state all --label bug --search "created:<since>..<until 다음 날>" --limit 1000 --json number,createdAt`으로 읽고 기간 안인 것만 남긴다. 받은 수가 1000이면 `SourceError`.
  - `ledger`: 받은 `ledger` 함수를 부른다. `defaultSource`는 `readPrLedger(getGitHub(cwd), cfg, pr)`를 끼운다(검증 App 봇이 쓴 원장 댓글만 인정하는 규칙을 그대로 쓴다).
  - 읽기 요청 꼴(인자 배열의 길이와 자리마다의 값이 맞아야 한다. `<날짜>`는 `YYYY-MM-DD`, `<번호>`는 숫자, `<필드>`는 영문자와 쉼표, `<jq>`는 `--jq` 바로 뒤 한 자리의 문자열이다):
    - PR 조회: `pr` `list` `--state` `merged` `--base` `<기본 브랜치>` `--search` `merged:<날짜>..<날짜>` `--limit` `1000` `--json` `<필드>`
    - Issue 조회: `issue` `list` `--state` `all` `--label` `bug` `--search` `created:<날짜>..<날짜>` `--limit` `1000` `--json` `number,createdAt`
    - 실행 조회: `api` `--paginate` `repos/{owner}/{repo}/actions/runs?created=<날짜>&per_page=100` `--jq` `<jq>`
    - 댓글 조회(원장. `scripts/lib/github.ts`의 `prComments`가 보낸다): `api` `--paginate` `repos/{owner}/{repo}/issues/<번호>/comments?per_page=100` `--jq` `<jq>`
  - `gh`·`ledger` 함수가 예외를 내거나 응답을 형식대로 읽지 못하면 `SourceError`다(원장이 깨진 PR이 하나라도 있으면 집계 전체가 실패한다).

### 2. 파일럿 판정 지표 `scripts/metrics/pilot.ts`

```ts
export interface PilotInput {
  period: Period;
  defaultBranch: string;
  /** 기간 직전의 마지막 main `check` 실행(결론이 success·failure인 것)의 결론. 확인하지 못했으면 null */
  priorMainCheck: 'success' | 'failure' | null;
  prs: MergedPr[];
  runs: WorkflowRun[];
  bugs: BugIssue[];
  ledgers: ReadonlyMap<number, Ledger | null>;
}
export function pilotMetrics(i: PilotInput): PilotMetrics;
```

순수 함수다(네트워크·파일·시계를 쓰지 않는다). 정의:

- **병합 후 결함**(세 값을 따로 낸다. 더하지 않는다)
  - main `check` 실패: `path`가 `.github/workflows/check.yml`, `event`가 `push`, `branch`가 `defaultBranch`, `status`가 `completed`이고 `createdAt`이 기간 안인 실행 가운데 `conclusion`이 `failure`인 수. 같은 조건에서 `conclusion`이 `success`이고 `attempt`가 2 이상인 수를 "재실행 뒤 통과"로 따로 낸다.
  - revert PR: `prs` 가운데 `head`가 `revert/`로 시작하는 PR의 번호.
  - 버그 Issue: `bugs`의 번호.
- **검증 누락**: 검증을 통과해 병합된 PR 가운데 그 병합 커밋에서 main `check`가 실패로 바뀐 PR의 수와 번호.
  - 위 main `check` 실행(결론이 `success`·`failure`인 것만)을 `createdAt` 순으로 놓는다. 결론이 `failure`이고 직전 실행의 결론이 `success`인 실행이 "실패로 바뀐 실행"이다. 기간의 첫 실행은 `priorMainCheck`를 직전 실행의 결론으로 쓴다. 이미 실패 중인 main에 이어진 실패(직전이 `failure`)는 앞선 결함과 같은 것으로 보고 세지 않는다. 기간의 첫 실행이 `failure`인데 `priorMainCheck`가 null이면 "전환 여부 미확인"으로 따로 세고 검증 누락에 넣지 않는다. 기간 시작일을 옮겨도 같은 실행의 판정이 달라지지 않게 하려는 것이다.
  - 실패로 바뀐 실행의 `headSha`가 `prs` 중 하나의 `mergeSha`와 같으면 그 PR이 원인이다. PR 번호로 중복을 없앤다.
  - 원인 PR을 찾지 못한 "실패로 바뀐 실행"의 수를 따로 낸다(검증 누락에 더하지 않는다).
  - 버그 Issue는 원인 PR과 잇는 근거가 없어 검증 누락에 더하지 않는다. 병합 후 결함의 값으로만 낸다. 렌더가 이 사실을 검증 누락 항목 아래에 적는다("버그 Issue N건은 원인 PR이 이어지지 않아 넣지 않았다. 사람이 가른다").
- **오탐**: `ledgers`의 지적 가운데 등급이 P0·P1이고 상태가 `deferred`가 아닌 것이 차단 지적이다. 그 가운데 `repro`가 `not-reproduced`인 수, `status`가 `rejected`인 수, 둘 중 하나라도 해당하는 수(오탐 수)와 비율(오탐 수 ÷ 차단 지적 수. 차단 지적이 0이면 null).
- **PR당 대기 시간**: PR마다 `mergedAt − createdAt`. 중앙값(짝수 개면 가운데 둘의 평균)과 최댓값을 분으로. PR이 없으면 null.
- **PR당 사용량**
  - Actions 실행 시간: `createdAt`이 기간 안이고 `status`가 `completed`인 모든 실행의 `updatedAt − startedAt` 합(분). 그중 `path`가 `.github/workflows/judge-claude.yml`·`.github/workflows/judge-codex.yml`인 실행의 합을 따로 낸다. PR당 값은 합 ÷ 병합 PR 수(PR이 없으면 null).
  - 판정 수: `ledgers`의 `rounds` 길이의 합과 PR당 값.
  - 실패로 끝난 판정 워크플로 실행 수: 위 두 판정 워크플로의 실행 가운데 `conclusion`이 `failure`인 수(검증자 장애·한도로 판정 없이 끝난 실행이 여기에 든다).
- 시각이 깨진 값(`Date.parse`가 NaN)은 그 항목을 세지 않고 `skipped` 수에 더한다(조용히 0으로 세지 않는다).

### 3. 렌더 `scripts/metrics/render.ts`

```ts
export const BEGIN = '<!-- metrics:begin -->';
export const END = '<!-- metrics:end -->';
export function renderBlock(p: Period, pilot: PilotMetrics): string;
```

- `renderBlock`: 첫 줄은 `집계 기간: <since> ~ <until>(UTC) · 병합 PR <N>개`다. 그 아래 `### 파일럿 판정 지표` 제목과 지표마다 목록 한 항목(세부 값은 하위 목록). 표를 쓰지 않는다. 집계 시각을 넣지 않는다. 수와 PR·Issue 번호(`#N`), 커밋 SHA 앞 7자만 쓴다. 값이 null이면 `—`와 이유(예: "병합 PR 없음").
- 출력은 prettier(`.prettierrc`)를 통과하는 형태여야 한다: 목록은 `- `, 하위 목록은 공백 2칸 들여쓰기, 제목 앞뒤 빈 줄, 줄 끝 공백 없음.
- `BEGIN`·`END`는 `docs/QUALITY_SCORE.md`에서 집계 결과를 붙여 넣는 자리의 표식 줄이다. 문서를 고치는 함수는 두지 않는다.

### 4. 명령 `scripts/commands/metrics.ts`와 등록

```ts
export interface MetricsOptions {
  since?: string;
  until?: string;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}
export function runMetrics(cwd: string, o: MetricsOptions, source?: MetricsSource): number;
```

- 순서: ① 기간 검사(틀리면 종료 코드 1) → ② 자료 읽기(`source`가 없으면 `ghSource`. 예외가 나면 종료 코드 2. `priorMainCheck`는 기간 시작 전날부터 거꾸로 하루씩 `workflowRuns`를 읽어, 결론이 `success`·`failure`인 main `check` 실행이 처음 나온 날의 가장 늦은 실행의 결론으로 정한다. 7일을 거슬러도 없으면 null이다) → ③ 계산·렌더 → ④ 표준 출력.
- ①은 GitHub을 읽기 전에 한다. ②가 실패하면(원장 읽기 예외 포함) 표준 출력에 집계 결과를 내지 않는다. 오류 메시지는 `err`(기본 표준 오류)로 내고 "무엇 + 고치는 법"으로 쓴다.
- 명령은 파일을 쓰지 않는다. 파일을 쓰는 옵션(`--write` 같은 것)을 두지 않는다.
- `source`가 없을 때 쓰는 것은 `defaultSource(cwd, cfg)`다.
- `scripts/harness.ts`에는 등록만 한다: `HELP`에 `metrics [--since <날짜>] [--until <날짜>]` 한 줄, `OPTIONS`에 `since`·`until`, `case 'metrics'`에서 `runMetrics` 호출.

### 5. 테스트

- `scripts/test/metrics-pilot.test.ts`: `parsePeriod`·`inPeriod`(경계 시각, 틀린 형식), `ghSource`(호출을 기록하고 고정 응답을 돌려주는 `gh` 함수를 끼운다: 응답이 위 형으로 바뀐다, 기간 밖 항목이 빠진다, 날짜마다 실행을 따로 읽는다, 받은 실행 수가 `total_count`와 다르면 `SourceError`, 받은 수와 `total_count`가 모두 1000이어도 `SourceError`, PR·Issue 수가 상한이면 `SourceError`, `gh`·`ledger` 함수의 예외가 `SourceError`가 된다, 기록된 모든 호출의 인자 배열이 위 "읽기 요청 꼴"의 PR·Issue·실행 조회 가운데 하나와 자리마다 맞는다), `pilotMetrics`(위 정의의 값마다 고정 입력으로 단언: 재실행 뒤 통과 분리, 자정(UTC)을 사이에 둔 연속 실패는 `priorMainCheck`가 `failure`라 검증 누락이 아니다, 기간 전 성공 뒤 기간 첫 실행의 실패는 검증 누락이다, `priorMainCheck`가 null인 첫 실패는 "전환 여부 미확인"이다, 검증 누락은 실패로 바뀐 실행의 원인 PR만 세고 이어진 실패·원인 PR을 찾지 못한 실패·버그 Issue는 넣지 않는다, 같은 PR은 한 번만 센다, 동결 P1·P2 제외, 재현 안 됨과 rejected가 겹친 지적은 한 번, 짝수 개 중앙값, PR 0개일 때 null, 깨진 시각), `renderBlock`(null 표시, 표 없음).
- `scripts/test/metrics-command.test.ts`: 임시 리포(`makeFixture`)와 메모리 `MetricsSource`로 `runMetrics`를 부른다. 같은 자료로 두 번 실행하면 출력이 같다, 자료 읽기 예외는 종료 코드 2이고 표준 출력이 비어 있다, `priorMainCheck`를 전날 실행에서 찾는 경우·이틀 전에서 찾는 경우·7일 안에 없는 경우(null)에 `runMetrics`가 읽는 날짜와 결과가 맞다, 자료가 상한에 닿은 `ghSource`(실행 1000건, `total_count` 1000)로 실행하면 종료 코드 2이고 표준 출력이 비어 있다, 기간이 틀리면 종료 코드 1이고 자료를 읽지 않는다, 원장 지적의 제목 문자열이 출력에 나오지 않는다. 연결 확인: 메모리 `MetricsSource`의 자료를 한 가지씩만 바꿔(병합 PR 하나 추가, main `check` 실패 실행 하나 추가, 버그 Issue 하나 추가, 한 PR의 원장에 rejected 차단 지적 하나 추가) `runMetrics`의 출력에서 그에 해당하는 값(병합 PR 수, main `check` 실패 수, 버그 Issue 수, 오탐 수)이 바뀌는 것을 단언한다. `ledger`가 병합된 PR마다 그 번호로 한 번씩 불리는 것도 단언한다. `scripts/harness.ts metrics --since 2026-13-01`을 자식 프로세스로 실행해 종료 코드 1과 오류 메시지를 확인한다(등록 확인. GitHub을 읽기 전에 끝난다). 이 리포의 `docs/QUALITY_SCORE.md`를 읽어 표식 줄(`BEGIN`, `END`)이 이 순서로 하나씩 있고, 구간의 첫 줄이 `집계 기간: <날짜> ~ <날짜>(UTC) · 병합 PR <수>개` 꼴이고, `### 파일럿 판정 지표` 아래에 지표 넷(병합 후 결함, 검증 누락, 오탐, PR당 대기 시간, PR당 사용량 항목)마다 수가 든 줄 또는 `—`와 이유가 든 줄이 있으며, 표(`|`로 시작하는 줄)가 남아 있지 않은 것을 단언한다. 이 테스트는 다음 집계 뒤에도 통과해야 하므로 날짜와 값 자체는 고정하지 않는다. 첫 집계의 시작일은 AC의 둘째 명령이 본다.

- 명령이 파일을 쓰지 않는 것은 `scripts/test/metrics-command.test.ts`에서 두 가지로 본다(Git 상태로는 보지 않는다. 같은 내용으로 다시 쓰거나 Git이 무시하는 경로에 쓰면 드러나지 않는다).
  - 실행 전후 비교: `makeFixture`가 만든 임시 폴더 전체(리포, `.git`, Git이 무시하는 경로 포함)의 모든 항목을 `lstatSync(…, { bigint: true })`로 읽는 함수를 테스트에 두고, 정상 입력으로 `runMetrics`를 실행하기 전과 뒤의 결과(경로 목록, 항목마다 `ino`·`size`·`mtimeNs`·`ctimeNs`)가 같다고 단언한다. 종료 코드 0과 출력이 있는 것도 같은 테스트에서 본다.
  - 그 비교가 실제로 잡는지: 같은 함수로, 문서를 같은 내용으로 다시 쓴 뒤(`writeFileSync`)와 `node_modules/` 아래에 파일을 하나 만든 뒤에 각각 전후 결과가 달라지는 것을 단언한다.
  - 쓰기 시도 감지(임시 폴더 밖에 쓰는 경우까지 본다): 테스트가 내장 `fs` 모듈의 내용을 바꾸는 함수를 "호출을 기록하고 예외를 던지는 함수"로 바꿔 끼운 뒤(`node:module`의 `syncBuiltinESMExports()`를 불러, `fs`와 `node:fs` 어느 표기로 이름을 가져온 모듈에도 반영되게 한다) 정상 입력으로 `runMetrics`를 실행하고, 기록된 호출이 0건이며 종료 코드가 0이라고 단언한다. 끝나면(실패해도) 원래 함수로 되돌리고 다시 `syncBuiltinESMExports()`를 부른다.
    - 바꿔 끼우는 함수: `writeFileSync`, `writeSync`, `writevSync`, `appendFileSync`, `renameSync`, `copyFileSync`, `cpSync`, `mkdirSync`, `mkdtempSync`, `rmSync`, `rmdirSync`, `unlinkSync`, `truncateSync`, `ftruncateSync`, `symlinkSync`, `linkSync`, `chmodSync`, `fchmodSync`, `lchmodSync`, `chownSync`, `fchownSync`, `lchownSync`, `utimesSync`, `futimesSync`, `lutimesSync`, `createWriteStream`, 그리고 이들의 콜백 꼴(`writeFile`, `write`, `writev`, `appendFile`, `rename`, `copyFile`, `cp`, `mkdir`, `mkdtemp`, `rm`, `rmdir`, `unlink`, `truncate`, `ftruncate`, `symlink`, `link`, `chmod`, `fchmod`, `lchmod`, `chown`, `fchown`, `lchown`, `utimes`, `futimes`, `lutimes`)과 `fs.promises`의 같은 이름. `openSync`·`open`·`fs.promises.open`은 읽기 전용(`'r'` 또는 `O_RDONLY`)이 아닌 플래그로 부를 때만 기록하고 막는다.
    - 그 감지가 실제로 잡는지: 테스트 파일 옆에 두지 않고 테스트 안에서 만든 두 함수로 본다. 하나는 `fs`에서, 하나는 `node:fs`에서 `writeFileSync`를 이름으로 가져온 것이다(테스트 파일 머리의 정적 `import` 둘). 바꿔 끼운 상태에서 둘을 각각 부르면 예외가 나고 호출이 기록되며 파일이 생기지 않는 것을 단언한다. 읽기 함수(`readFileSync`)는 두 표기 모두 그대로 동작하는 것도 단언한다.
  - 자식 프로세스의 허용 목록(아래 두 테스트가 함께 쓴다. 명령과 인자 배열 전체가 맞을 때만 허용한다. 금지할 옵션을 나열하지 않는다):
    - `git`: `repoInfo`(`scripts/lib/git.ts`)가 실행하는 둘. `rev-parse` `--show-toplevel` `--absolute-git-dir` `--git-common-dir`, 그리고 `symbolic-ref` `--short` `-q` `HEAD`. 둘 다 읽기만 한다.
    - `gh`: 1절의 "읽기 요청 꼴" 넷.
    - 허용 목록과 고정 응답은 테스트 파일의 한곳에 둔다. 뒤 step이 조회나 읽기 명령을 더하면 그 step이 허용 목록, 고정 응답, 호출 단언을 함께 넓힌다(step1 4절, step2 4절에 넓힐 꼴이 적혀 있다). 목록 밖 호출이 막히는지 보는 사례는 그대로 두고 통과해야 한다.
  - 자식 프로세스(메모리 자료): 같은 방식으로 `child_process`의 `spawnSync`·`spawn`·`execSync`·`exec`·`execFileSync`·`execFile`·`fork`를 "기록하고 원래 함수를 부르는 함수"로 감싸, 메모리 `MetricsSource`로 `runMetrics`를 실행하는 동안 뜬 자식 프로세스가 허용 목록의 `git` 둘뿐이라고 단언한다(`gh`는 뜨지 않는다).
  - 기본 자료원 경로(명령행이 타는 경로): 유효한 기간으로 `runMetrics`를 `source` 인자 없이 부르는 테스트를 둔다. 네트워크와 실제 `gh` 없이 돈다.
    - 프로세스 실행 경계를 막는다: 위의 `child_process` 함수들을 바꿔 끼워, 허용 목록의 `git` 둘은 원래 함수로 실행하고, 허용 목록의 `gh` 넷에는 실행하지 않고 고정 응답(병합 PR 목록, 날짜별 실행 목록과 `total_count`, 버그 Issue 목록, PR의 댓글 목록)을 돌려준다. 허용 목록과 맞지 않는 호출은 고정 응답을 주기 전에 막는다: 실행하지 않고 "막은 호출"로 기록한 뒤 실패를 돌려준다.
    - 이 테스트 동안 `HARNESS_FAKE_GH`를 비워 `defaultSource`가 실제 경로(`runSync('gh', …)`와 `getGitHub`의 `gh` 구현)를 타게 하고, 끝나면 되돌린다.
    - 단언: 종료 코드 0이고 출력의 값이 고정 응답과 맞는다(병합 PR 수, main `check` 실패 수, 버그 Issue 수). 막은 호출이 0건이다. 관찰한 `gh` 호출에 PR 조회, 날짜별 실행 조회, Issue 조회, 병합된 PR마다의 댓글 조회가 있다. 위의 `fs` 쓰기 시도 감지를 함께 켜 두고 기록된 쓰기 호출이 0건이다.
    - 그 경계가 실제로 막는지: 같은 상태에서 아래를 `runSync`로 부르면 모두 실행되지 않고 막은 호출로 기록되는 것을 단언한다. `gh api -X POST …`, `gh api --method=POST …`, 허용되는 댓글 조회 인자 끝에 `--method=POST`를 덧붙인 것, 허용되는 PR 조회에서 `list`를 `merge`로 바꾼 것, `git status`, `sh -c …`.

### 6. 문서와 첫 집계

- `docs/QUALITY_SCORE.md`: 지금의 빈 표를 지우고 `## 집계 결과`(표식 구간), `## 측정 정의`(이 step의 지표 넷의 정의와 읽는 법: 무엇을 어디서 세는가, 겹칠 수 있는 값, 기간이 UTC인 것), `## 도메인·레이어별 등급`(그대로)으로 바꾼다. frontmatter의 `related_code`에 `scripts/metrics/`를 넣는다.
- 이 리포에서 `node scripts/harness.ts metrics --since 2026-11-11 --until <작업일(UTC)>`의 출력을 파일로 받아, `docs/QUALITY_SCORE.md`의 표식 구간에 그대로 붙여 넣어 첫 집계를 기록한다(표식 줄과 내용 사이에 빈 줄 하나). `--until`은 실행하는 날의 UTC 날짜(`date -u +%Y-%m-%d`)다. 대조 기록(필수)을 계획의 진행 로그와 PR 본문에 적는다: ① 기대 종료일(실행한 날의 UTC 날짜)과 문서 첫 줄의 종료일, 둘이 같은지 ② 병합 PR 수, 버그 Issue 수, main `check` 실패 수 각각에 대해 문서의 값과 `gh` 조회로 따로 센 값(조회 명령은 인자를 줄이지 않고 전부 적는다), 둘이 같은지 ③ 문서의 표식 구간(표식 줄과 앞뒤 빈 줄을 뺀 내용)이 받아 둔 출력 파일과 같은지(`diff`의 종료 코드). 하나라도 다르면 고친 뒤에 완료 처리한다.
- 이 step의 PR은 보호 경로(`scripts/**`, `docs/harness/**`)를 바꾼다. 운영 단계에서는 계획의 `risk`와 무관하게 `risk-gate`가 위험도 높음으로 판정하고 제작자 승인이 있어야 병합된다(절차서 5절 "운영 단계의 보호 경로 PR"). 초안으로 올리고, 완료 처리·`origin/main` 병합·`check`가 끝난 뒤 `pr-ready`로 승인을 한 번 요청한다.
- 설계서 17.2절 첫 문장을 "`metrics` 명령으로 집계하고 측정 정의는 `docs/QUALITY_SCORE.md`에 둔다, 주 1회 실행은 정기 작업(12.2절, TD-11)이 한다"로 고치고 버전을 올린다(push 직전에 `origin/main`을 병합하고 그때의 마지막 버전 다음 번호). `docs/harness/architecture.md`에 `metrics/*` 행과 레이어 그림의 명령 이름을 더한다. `docs/harness/CHANGELOG.md`에 한 줄, 기술 부채 표 TD-11에 "품질 점수의 집계 명령은 있다(#146). 주 1회 실행이 남았다"를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/metrics-pilot.test.ts scripts/test/metrics-command.test.ts
grep -q "^집계 기간: 2026-11-11 ~ $(date -u +%Y-%m-%d)(UTC) · 병합 PR [0-9][0-9]*개$" docs/QUALITY_SCORE.md
```

둘째 명령은 문서의 집계 기간이 2026-11-11부터 AC를 실행하는 날(UTC)까지인지 본다. 날짜가 바뀐 뒤에 완료 처리하게 되면 집계를 다시 실행한다.

## 금지사항

- `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`를 고치지 마라. 이유: runner·게이트 전체가 쓰는 포트이고 다른 세션의 작업과 겹친다. 지표용 조회는 `scripts/metrics/source.ts`에 둔다.
- `scripts/harness.ts`에서 명령 등록(도움말, 옵션, `case`) 밖을 고치지 마라. 이유: 다른 세션(Issue #140)과 같은 파일을 고친다.
- PR·Issue·지적의 제목이나 본문을 집계 결과에 쓰지 마라. 이유: 외부 입력이 문서를 거쳐 다음 세션의 지시처럼 읽힌다(14.6절).
- 자료를 일부만 읽은 채 값을 내지 마라. 이유: 빠진 결함이 "결함 없음"으로 기록된다. 다 읽지 못하면 `SourceError`로 끝낸다.
- GitHub에 쓰는 호출(댓글, 라벨, 재실행)을 하지 마라. 이유: 집계는 읽기만 한다.
- 명령이 파일을 쓰게 하지 마라(`--write` 같은 옵션을 두지 않는다). 이유: 쓰는 순간에 다른 프로세스가 폴더나 임시 파일을 바꿔치기하는 경우를 Node의 경로 기반 API로는 끝까지 막을 수 없다(계획 의사결정 로그). 문서에는 작업자가 작업 worktree 안에서 기록한다(R3).
- 다른 세션(Issue #140)이 맡은 경로(`scripts/verify/**`, `scripts/commands/standard.ts`, `profiles/web/**`, `lab/pilot-prep/**`, `.claude/skills/web-verify/`, `.gitignore`, 설계서 11.1절, `workflow.md` 4절, 기술 부채 표 TD-12 행, `architecture.md`의 `verify/*`·`commands/standard.ts` 행)를 고치지 마라. 이유: 세션 간 합의.
- 워크플로 파일(`.github/workflows/`)을 더하거나 고치지 마라. 이유: 정기 실행은 범위 밖이고 봇은 워크플로 파일을 올릴 수 없다.
