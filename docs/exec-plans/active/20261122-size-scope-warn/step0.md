# Step 0: pr-size

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*`, `ci/*` 행)
- `docs/harness/design.md` 5절(R15 행), 10.2절 (1), 10.3절의 필수 체크 표, 10.4절(판정 job과 기록 job)
- `scripts/ci/results.ts`, `scripts/ci/gates.ts`, `scripts/ci/record.ts`(전체)
- `scripts/gates/risk-gate.ts`의 `changedFiles`(`git diff --numstat -z --no-renames`를 읽는 방식), `scripts/gates/harness-guard.ts`의 `CONFIG_KEYS`와 그것을 쓰는 곳
- `scripts/lib/config.ts`(`HarnessConfig`, `relPath`, `resolveDbCommands`, `loadConfig`), `scripts/lib/util.ts`(`globToRegExp`, `matchesAny`가 파일 경로의 `\`를 `/`로 바꾸는 것), `scripts/lib/git.ts`(`git`)
- `scripts/commands/ops-check.ts`의 `requiredChecks`(`GATE_CONTEXTS`를 필수 체크 요구 목록으로 쓴다)
- `scripts/harness.ts`의 `gates`·`record-status` 명령(읽기만. 고치지 않는다), `.github/workflows/gates.yml`(읽기만)
- `scripts/test/helpers.ts`, `scripts/test/ci.test.ts`, `scripts/test/risk-gate.test.ts`(임시 리포로 PR 트리를 만드는 방식), `scripts/test/record.test.ts`, `scripts/test/revert-check.test.ts`, `scripts/test/harness-guard.test.ts`

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

### 1. 경고 판정의 틀

- `scripts/lib/util.ts`: `export const WARN_PREFIX = '경고: ';`
- `scripts/lib/util.ts`에 판정 상세의 크기를 묶는 함수를 더한다. 판정 결과 파일은 job 출력과 환경 변수 하나로 기록 job에 넘어가므로(`.github/workflows/gates.yml`의 `results`와 `RESULTS_B64`), PR이 정하는 값(파일 경로)이 그 크기를 키우게 두지 않는다.

  ```ts
  export const DETAIL_LINE_MAX = 200;
  export const DETAILS_MAX_BYTES = 12_000;
  export const DETAILS_CUT = '… (상세를 줄였다)';
  export function capDetails(lines: string[]): string[];
  ```

  - 한 줄은 `DETAIL_LINE_MAX`자(글자열의 `length`)까지다. 넘으면 199자로 자르고 끝에 `…`를 붙인다.
  - 앞에서부터 담는다. 담은 줄들의 UTF-8 바이트 수(줄마다 1을 더한다)의 합이 `DETAILS_MAX_BYTES`를 넘게 되는 줄부터는 모두 버리고, 끝에 `DETAILS_CUT` 한 줄을 더한다(이 줄은 합에 세지 않는다). 버린 줄이 없으면 더하지 않는다.
  - 순수 함수다. 받은 배열을 고치지 않는다.

- `scripts/ci/results.ts`:

  ```ts
  /** 경고 판정 context. 필수 체크가 아니다. 경고여도 state는 success이고 description이 WARN_PREFIX로 시작한다 */
  export const WARN_CONTEXTS = ['pr-size'] as const;
  /** 기록 job이 커밋 상태로 쓰는 context 전부: GATE_CONTEXTS 뒤에 WARN_CONTEXTS */
  export const RECORDED_CONTEXTS = [...GATE_CONTEXTS, ...WARN_CONTEXTS] as const;
  ```

  - `GATE_CONTEXTS`는 그대로다(값과 순서). `scope`는 step1이 `WARN_CONTEXTS`에 더한다.

- `scripts/ci/gates.ts`의 `runGates`: 필수 판정 다섯을 지금 순서대로 낸 뒤 `WARN_CONTEXTS`의 판정을 그 순서대로 `results`에 더한다.
  - 경고 판정 하나는 `guarded`로 감싼다. 예외는 그 context만 `error`로 만들고 다른 결과를 바꾸지 않는다.
  - `revert-check`가 확인한 revert PR(`verified`)이면 경고 판정을 실행하지 않고 `state: 'success'`, `description: 'revert PR: 보지 않는다'`, `details: []`를 낸다.
  - 경고 판정은 위험도 신호(`signals`)와 `risk`에 아무것도 더하지 않는다.
- `scripts/ci/gates.ts`:

  ```ts
  /** 경고 판정이 경고를 냈는가: context가 WARN_CONTEXTS에 있고, state가 success이고, description이 WARN_PREFIX로 시작한다 */
  export function isWarning(g: GateResult): boolean;
  ```

  - `summaryMarkdown`의 표에서 `isWarning`인 행은 결과 칸이 `경고`다. 그 밖의 행은 지금과 같다.

- `scripts/ci/record.ts`의 `recordStatuses`: `contexts`를 주지 않았을 때의 기본값을 `RECORDED_CONTEXTS`로 바꾼다. 그 밖의 동작(형식 검사, 빠진 context는 `error`, 결과가 없거나 깨지면 모두 `error`)은 그대로다. `scripts/harness.ts`는 고치지 않는다(`record-status` 명령은 `contexts`를 주지 않는다).

### 2. 설정 `prSize` (`scripts/lib/config.ts`)

```ts
export interface PrSizeConfig {
  /** 변경 줄 수(추가 + 삭제)의 상한. 넘으면 경고한다 */
  maxLines: number;
  /** 세지 않는 경로(glob, 리포 루트 기준) */
  exclude: string[];
}
export const DEFAULT_PR_SIZE: PrSizeConfig;
export function resolvePrSize(raw: unknown): PrSizeConfig;
```

- `HarnessConfig`에 `prSize: PrSizeConfig`를 더하고 `loadConfig`가 `resolvePrSize`로 채운다.
- 기본값: `maxLines`는 400. `exclude`는 아래 여덟 개다(이 순서).
  - 문서: `**/*.md`, `docs/**`
  - 테스트: `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**`
  - 생성 파일: `**/generated/**`
- `resolvePrSize`:
  - `undefined`면 기본값이다(키가 없는 옛 설정 파일과 호환).
  - 객체면 준 항목만 기본값을 대신한다. `exclude`를 주면 그 목록이 기본 목록을 **대신한다**(더하지 않는다. 빈 배열도 된다).
  - `ConfigError`(메시지에 `prSize`가 있다)인 경우: 객체가 아니다(배열, `null`, 글자 등), `maxLines`·`exclude` 밖의 키가 있다, `maxLines`가 1 이상의 안전한 정수가 아니다, `exclude`가 리포 안 상대 경로(`relPath`) 글자의 배열이 아니다.
  - 돌려주는 값은 기본값 객체와 배열을 공유하지 않는다(받은 쪽이 고쳐도 기본값이 바뀌지 않는다).
- `harness.config.json`과 `profiles/`에는 키를 더하지 않는다.
- `scripts/gates/harness-guard.ts`의 `CONFIG_KEYS`에 `'prSize'`를 더한다. main과 PR 트리의 `harness.config.json`에서 `prSize`가 다르면 지금 있는 "판정 관련 설정 변경" 신호에 `prSize`가 들어간다.

### 3. `scripts/gates/pr-size.ts`(새 파일)

```ts
export interface SizedFile {
  path: string;
  /** 추가 + 삭제 줄 수. 바이너리는 0 */
  lines: number;
  binary: boolean;
}
/** merge-base 대비 바뀐 파일과 줄 수 */
export function changedLines(root: string, base: string): SizedFile[];

export interface PrSizeResult {
  state: 'success';
  description: string;
  details: string[];
  /** 센 줄 수 */
  lines: number;
  over: boolean;
}
/** 바뀐 파일 목록으로 판정한다(순수 함수) */
export function prSizeOf(
  files: SizedFile[],
  cfg: Pick<HarnessConfig, 'prSize' | 'deps'>,
): PrSizeResult;
/** `prSizeOf(changedLines(root, base), cfg)` */
export function prSize(o: { root: string; base: string; cfg: HarnessConfig }): PrSizeResult;
```

- `changedLines`: `git diff --numstat -z --no-renames <base>...HEAD`를 `root`에서 한 번 실행해 읽는다(`changedFiles`와 같은 인자). 삭제한 파일도 나온다. 이름을 바꾼 파일은 삭제와 추가 두 건이다. 추가나 삭제 칸이 `-`이면 바이너리이고 줄 수는 0이다. 레코드 하나라도 해석하지 못하면 예외다(일부만 세고 통과로 넘기지 않는다). `git`이 실패하면 예외다.
- `prSizeOf`:
  - 세는 파일: 바이너리가 아니고, `cfg.prSize.exclude`와 `cfg.deps.lockfiles`의 glob 어느 것에도 맞지 않는 파일. `lines`는 그 파일들의 줄 수의 합이다.
  - 경로는 `git`이 준 글자 그대로 견준다: `globToRegExp(glob).test(path)`. `matchesAny`는 쓰지 않는다(파일 경로의 `\`를 `/`로 바꾸므로, 이름에 `\`가 든 리포 루트의 파일 `docs\a.ts`가 `docs/**`에 맞아 버린다).
  - `lines > cfg.prSize.maxLines`이면 `over`가 참이다(같으면 거짓).
  - `state`는 늘 `success`다.
  - `description`: 넘지 않으면 `통과 (변경 <lines>줄 / 상한 <maxLines>줄)`, 넘으면 `WARN_PREFIX`로 시작하고 `<lines>`와 `<maxLines>`가 수 그대로 들어 있다.
  - `details`는 아래 순서의 줄들에 `capDetails`를 적용한 것이다.
    1. 첫 줄: 센 파일 수와 제외한 파일 수.
    2. 넘었을 때만: `고치는 법`으로 시작하는 줄(step을 더 잘게 나눈다, 경고이며 병합을 막지 않는다)과 `근거`로 시작하는 줄(설계서 10.2절 (1), R15).
    3. 센 파일을 줄 수가 많은 순서로(같으면 경로 순서) 한 줄에 하나씩, 줄 수와 경로. 30개까지만 적고 나머지는 수만 적는다.
  - `description`에는 경로를 넣지 않는다.
  - 설정은 넘겨받은 `cfg`만 쓴다. PR 트리의 `harness.config.json`을 읽지 않는다.
- `runGates`의 `pr-size` 판정은 `prSize`의 `state`·`description`·`details`를 그대로 쓴다.

### 4. 테스트

새 파일 `scripts/test/pr-size.test.ts`. 임시 `git` 리포로 base 커밋과 PR 브랜치를 만든다(`scripts/test/risk-gate.test.ts`의 `repo` 방식).

- **`changedLines`**: 새 파일(추가 줄 수), 고친 파일(추가 + 삭제), 지운 파일(삭제 줄 수), 바이너리(줄 수 0, `binary` 참), 이름을 바꾼 파일(옛 경로와 새 경로 두 건). `base`가 없는 커밋이면 예외다.
- **상한**: 센 줄 수가 상한과 같으면 `over`가 거짓이고 `description`이 `통과 (변경 N줄 / 상한 N줄)`이다. 상한보다 1 많으면 `over`가 참이고 `description`이 `경고: `로 시작하며 두 수가 들어 있다. 두 경우 모두 `state`는 `success`다.
- **제외**: 기본 설정에서 `README.md`, `docs/a.txt`, `src/a.test.ts`, `scripts/test/x.ts`, `src/generated/x.ts`, `pnpm-lock.yaml`, 바이너리는 세지 않는다. `src/a.ts`와 `scripts/gates/x.ts`는 센다. `prSize.exclude`를 `['src/**']`로 주면 `README.md`와 `scripts/test/x.ts`를 세고 `src/a.ts`는 세지 않으며, `pnpm-lock.yaml`은 여전히 세지 않는다.
- **`details`**: 줄 수가 많은 파일이 먼저 나온다. 넘었을 때만 고치는 법과 근거 줄이 있고, 그 두 줄은 파일 줄보다 앞이다. 센 파일이 31개면 30개만 적히고 나머지 1개는 수로 적힌다.
- **`capDetails`**: 짧은 줄들은 그대로다. 250자인 줄은 200자가 되고 `…`로 끝나며, 200자인 줄은 그대로다. 190자 남짓의 한글 줄 100개를 주면 끝이 `DETAILS_CUT`이고, 그 줄을 뺀 나머지의 바이트 합(줄마다 1을 더한다)이 `DETAILS_MAX_BYTES` 이하이며, 한 줄을 더 담았다면 넘었을 만큼 채워져 있다.
- **긴 경로**(`prSizeOf`에 직접 넘긴다. 파일 시스템을 거치지 않는다): 경로가 4,000자(한글)인 파일 40개로 상한을 넘기면, `description`과 `details`를 JSON으로 만든 것의 UTF-8 크기가 16,000바이트보다 작다. `details`의 모든 줄이 200자 이하이고, 앞의 세 줄(수, 고치는 법, 근거)이 남아 있으며, 끝 줄이 `DETAILS_CUT`이다.
- **경로의 글자**(`prSizeOf`에 직접 넘긴다): 경로가 `docs\a.ts`(역슬래시가 든 파일 이름)와 `src\test\a.ts`인 파일은 센다. `docs/a.ts`와 `src/test/a.ts`는 세지 않는다.
- **설정**: 키가 없는 설정 파일을 `loadConfig`로 읽으면 `prSize`가 기본값이다. `{ maxLines: 10 }`이면 `exclude`는 기본 목록이다. `{ exclude: [] }`이면 `maxLines`는 400이다. `ConfigError`(메시지에 `prSize`): `maxLines`가 0, 음수, 1.5, `'400'`인 경우, `exclude`에 `/abs`, `../x`, 수가 든 경우, 모르는 키, 배열, `null`. 돌려받은 `exclude`에 항목을 더해도 `DEFAULT_PR_SIZE.exclude`의 길이는 8이다.
- **`runGates`**: 결과의 context 순서가 `RECORDED_CONTEXTS`와 같고, `validateResults`(`contexts: RECORDED_CONTEXTS`)를 통과한다. 상한을 넘는 PR에서 `pr-size`가 `success`이고 `isWarning`이 참이며, 다른 판정의 `state`는 상한을 넘지 않는 같은 모양의 PR과 같다. PR 트리의 `harness.config.json`에 `prSize.maxLines`를 크게 적어도, 넘겨준 설정(main 쪽)의 상한으로 경고한다.
- **예외 격리**: `pr-size` 안에서 예외가 나게 하면(예: `cfg.prSize`가 빠진 설정을 넘긴다) `pr-size`만 `error`이고 필수 판정 다섯의 `state`·`description`은 정상 설정으로 돌린 결과와 같다.
- **요약**: `summaryMarkdown`에서 경고가 난 `pr-size` 행의 결과 칸은 `경고`이고, 경고가 아닐 때는 `통과`다. `isWarning`은 context가 `plan-gate`인 결과에는 설명이 `경고: `로 시작해도 거짓이다.
- **필수 체크가 아니다**: `GATE_CONTEXTS`에 `pr-size`가 없다.

기존 테스트 파일에서 고칠 곳(단언을 지우지 않는다. context 목록이 늘어난 만큼 기대값을 넓힌다):

- `scripts/test/ci.test.ts`: 정상 결과를 만드는 도우미(`results`)가 `RECORDED_CONTEXTS`의 결과를 모두 담는다. 그 도우미의 결과를 검사·변환하는 호출(`validateResults`, `toStatuses`)과 `runGates`의 context 순서 단언, `recordStatuses`의 두 테스트(정상 결과, 결과가 없거나 깨짐)가 `RECORDED_CONTEXTS`를 기준으로 한다. 더하는 사례: 결과에 `pr-size`만 빠져 있으면 `pr-size`만 `error`로 기록되고 필수 판정은 결과대로(그 가운데 하나를 `failure`로 둔다) 기록된다.
- `scripts/test/record.test.ts`: `record-status` 명령의 정상 결과 파일을 만드는 도우미(`gatesFile`)가 `RECORDED_CONTEXTS`의 결과를 모두 담는다(그대로 두면 빠진 `pr-size`가 `error`로 기록돼 "다른 기계 판정은 그대로다" 단언이 실패한다). 기록된 상태 수의 단언은 `RECORDED_CONTEXTS.length`를 기준으로 한다. 더하는 사례 둘(`record-status` 명령으로): (1) `pr-size`의 결과가 `success`이고 설명이 `경고: `로 시작하면 그 상태와 설명이 그대로 PR head에 기록되고 모든 context가 `success`다. (2) 결과 파일에 `pr-size`만 빠져 있으면 종료 코드 0이고 `pr-size`만 `error`, 나머지는 `success`로 기록된다.
- `scripts/test/risk-gate.test.ts`: `runGates` 결과를 `validateResults`로 검사하는 단언이 `RECORDED_CONTEXTS`를 쓴다.
- `scripts/test/revert-check.test.ts`: 확인된 revert PR의 `runGates` 테스트에서 context 순서 단언이 `RECORDED_CONTEXTS`를 기준으로 하고, `pr-size`가 `success`·`revert PR: 보지 않는다`인 단언을 더한다.
- `scripts/test/harness-guard.test.ts`: main과 PR 트리의 `harness.config.json`에서 `prSize`만 다르면 "판정 관련 설정 변경" 신호에 `prSize`가 있다는 사례를 더한다.

### 5. 문서

- `docs/harness/workflow.md` 5절: "필수 체크는 `check`(GitHub Actions)와 …"로 시작하는 항목 바로 뒤에 아래 한 항목을 더한다(글자 그대로).

  ```text
  - 경고 판정 `pr-size`는 필수 체크가 아니다. PR의 변경 줄 수(추가 + 삭제. 문서·테스트·생성 파일·lockfile·바이너리 제외)가 상한(`harness.config.json`의 `prSize.maxLines`, 없으면 400)을 넘으면 커밋 상태의 설명이 `경고: `로 시작한다. 상태는 `success`라 병합을 막지 않는다. 경고가 나오면 step을 더 잘게 나눌 수 있는지 본다(R15).
  ```

- `docs/harness/architecture.md`: `gates/*` 행에 `pr-size.ts`의 한 문장을, `ci/*` 행에 경고 판정 context(`WARN_CONTEXTS`)의 한 문장을 더한다.
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)"에 한 줄: 무엇이 바뀌었는지, 새 설정 키 `prSize`(없으면 기본값)와 `CONFIG_KEYS`, 경고는 `success`와 `경고: ` 설명으로 낸다는 것, 필수 체크와 워크플로는 바뀌지 않는다는 것, 검사를 약화하지 않는다는 것.
- 설계서와 기술 부채 표는 이 step에서 고치지 않는다(step1이 한 번에 고친다).

## Acceptance Criteria

```bash
node --test scripts/test/pr-size.test.ts scripts/test/ci.test.ts scripts/test/record.test.ts scripts/test/risk-gate.test.ts scripts/test/revert-check.test.ts scripts/test/harness-guard.test.ts scripts/test/ops-check.test.ts scripts/test/protection.test.ts scripts/test/lib.test.ts
grep -qxF -e '- 경고 판정 `pr-size`는 필수 체크가 아니다. PR의 변경 줄 수(추가 + 삭제. 문서·테스트·생성 파일·lockfile·바이너리 제외)가 상한(`harness.config.json`의 `prSize.maxLines`, 없으면 400)을 넘으면 커밋 상태의 설명이 `경고: `로 시작한다. 상태는 `success`라 병합을 막지 않는다. 경고가 나오면 step을 더 잘게 나눌 수 있는지 본다(R15).' docs/harness/workflow.md
grep -q 'pr-size.ts' docs/harness/architecture.md
grep -q 'WARN_CONTEXTS' docs/harness/architecture.md
grep -q 'prSize' docs/harness/CHANGELOG.md
```

## 금지사항

- `GATE_CONTEXTS`에 `pr-size`를 넣지 마라. 이유: `ops-check`가 그 목록을 브랜치 보호의 필수 체크 요구로 쓴다. 경고 판정은 필수 체크가 아니다.
- 경고를 `failure`나 `error`로 내지 마라. 이유: 필수 체크 설정이 없는 리포의 `pr-state`는 체크 요약으로 분류하므로 실패로 읽힌다. `error`는 판정하지 못했을 때만이다.
- `harness.config.json`, `profiles/`, `.github/`, `scripts/harness.ts`를 고치지 마라. 이유: 기본값과 기본 context 목록으로 충분하고, 다른 세션의 PR(#171)이 `scripts/harness.ts`를 고치는 중이다.
- `scripts/hooks/`, `scripts/ci/pr.ts`, `scripts/commands/pr-state.ts`, `scripts/runner/`, `scripts/metrics/`를 고치지 마라. 이유: 범위 밖이고 다른 세션의 PR(#184, #185, #171)이 고치는 중이다.
- 필수 판정 다섯(`revert-check`, `plan-gate`, `harness-guard`, `risk-gate`, `deps-guard`)의 판정 기준·순서·결과 문구를 바꾸지 마라. 이유: 이 step은 판정을 더할 뿐이다. `harness-guard`는 `CONFIG_KEYS`의 한 항목만 더한다.
- PR 트리의 `harness.config.json`으로 상한이나 제외 목록을 정하지 마라. 이유: PR이 판정 기준을 함께 바꿀 수 있다.
- `matchesAny`로 파일 경로를 견주지 마라. 이유: 파일 경로의 `\`를 `/`로 바꿔, 이름에 `\`가 든 파일이 다른 경로로 판정된다.
- 필수 판정 다섯의 `details`에 `capDetails`를 적용하지 마라. 이유: 필수 판정의 결과 문구를 바꾸지 않는다. 남은 일로 step1이 기술 부채 표에 적는다.
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라(R4). 이유: 필수 판정의 결과가 같다는 증거다. context 목록이 늘어난 곳의 기대값만 넓힌다.
- `docs/harness/design.md`와 `docs/exec-plans/tech-debt-tracker.md`를 고치지 마라. 이유: step1이 두 판정을 함께 적는다. 다른 세션의 PR과 겹치는 횟수를 줄인다.
