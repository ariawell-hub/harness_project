# Step 0: gate-read-failure

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*` 행)
- `scripts/gates/doc-lint.ts`(전체), `scripts/lib/git.ts`(`gitTry`), `scripts/lib/util.ts`(`Problem`)
- `scripts/commands/check.ts`의 `runCheck`(시작할 때의 캐시 키 계산과 캐시 적중, 끝날 때의 캐시 쓰기, `doc-lint` 단계), `scripts/harness.ts`의 `case 'doc-lint'`
- `scripts/metrics/local.ts`의 `localMetrics`, `scripts/commands/metrics.ts`의 예외 처리(종료 코드 2), `scripts/test/metrics-allow.ts`(`GIT_READ_SHAPES`)
- `scripts/test/helpers.ts`, `scripts/test/gates.test.ts`의 `repo()`, `scripts/test/check-skip.test.ts`(캐시 테스트)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-60 행

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

### 1. `scripts/gates/doc-lint.ts`

```ts
/** 문서 목록이나 커밋 시각을 `git`으로 읽지 못했다 */
export class DocLintReadError extends Error {}

export interface DocLintOptions {
  /** 참이면 커밋 시각을 읽지 않는다(커밋이 없는 리포). "검토 필요" 경고는 나오지 않는다 */
  noHistory?: boolean;
}
export function docLint(root: string, cfg: HarnessConfig, o?: DocLintOptions): DocLintResult;
export function docLintGate(root: string, cfg: HarnessConfig): DocLintResult;
```

- `docLint`: `strict` 옵션을 없앤다. `git` 읽기 실패는 늘 `DocLintReadError`다(지금의 `strict: true`와 같은 조건, 같은 메시지).
  - `git ls-files`가 실패하면 던진다.
  - `git log`가 실패하거나 출력이 숫자가 아니면 던진다(메시지에 그 경로들). 조회는 성공했고 출력이 비어 있으면(그 경로에 커밋 이력이 없다) 지금처럼 0이다.
  - `noHistory`가 참이면 `git log`를 실행하지 않는다. 그 밖의 검사는 같다.
- `docLintGate`: 게이트가 쓰는 함수다. 예외를 던지지 않고 결과로 돌려준다.
  1. "커밋이 없는 리포"인지 본다. 아래 셋이 모두 맞을 때만 그렇다. 하나라도 아니면(명령이 다른 종료 코드로 끝난 경우도) 커밋이 있는 리포로 다룬다.
     - `git symbolic-ref -q HEAD`가 종료 코드 0이고 ref 이름(`refs/heads/…`)을 출력한다(HEAD가 브랜치를 가리킨다).
     - 그 ref에 `git show-ref --verify -q <ref>`가 종료 코드 1이다(ref를 찾지 못한다).
     - `git rev-parse --git-path <ref>`가 종료 코드 0이고 그 경로(`root` 기준)에 파일이 없다(ref 파일이 있으면 내용이 손상된 것이다).
  2. 커밋이 없는 리포면 `docLint(root, cfg, { noHistory: true })`, 그 밖에는 `docLint(root, cfg)`의 결과를 그대로 돌려준다. 손상된 ref, 없는 객체를 가리키는 ref, `git` 리포가 아닌 폴더는 모두 뒤의 경로로 가서 `git ls-files`나 `git log`의 실패로 드러난다.
  3. 커밋이 없는 리포가 아니면, 2가 예외 없이 끝난 뒤 `git rev-parse --verify -q HEAD^{commit}`을 실행한다. 종료 코드가 0이 아니면 `DocLintReadError`(메시지에 `git rev-parse`가 들어 있다. HEAD의 커밋을 읽지 못했다는 뜻)로 다룬다. 커밋 시각이 필요한 문서가 하나도 없어 2에서 `git log`가 불리지 않은 리포의 손상된 ref가 여기서 드러난다.
  4. 2·3의 `DocLintReadError`는 오류 한 건으로 바꿔 `{ errors: [그 오류], warnings: [] }`를 돌려준다. 오류는 `rule: 'R8 문서 읽기 실패'`, `what`은 `DocLintReadError`의 메시지(실패한 조회의 이름 `git ls-files`, `git log`, `git rev-parse` 가운데 하나가 들어 있다), `how`는 고치는 법이고 `git status`라는 글자가 들어 있다(이 폴더에서 `git status`가 도는지 확인하고 다시 실행한다는 뜻), `doc`은 이 파일의 다른 오류와 같은 값이다.
  5. `DocLintReadError`가 아닌 예외는 잡지 않는다.

### 2. 호출처

- `scripts/commands/check.ts`의 `doc-lint` 단계와 `scripts/harness.ts`의 `case 'doc-lint'`가 `docLint` 대신 `docLintGate`를 부른다. 그 밖의 줄(CODEOWNERS 검사, 출력 형식, 종료 코드 계산)은 그대로 둔다.
- `scripts/commands/check.ts`의 `runCheck`: 시작할 때 캐시 키 계산(`cacheKey`)이 예외를 던지면 그 실행은 캐시를 쓰지 않는 실행으로 한다. 캐시 적중을 보지 않고, 검사 단계를 모두 실제로 실행하고, 끝날 때 캐시에 쓰지 않는다. 예외를 밖으로 던지지 않는다. `--no-cache`·`--ci` 실행과 키를 만든 실행의 동작은 그대로다.
- `scripts/metrics/local.ts`: `docLint(i.root, i.cfg, { strict: true })`를 `docLint(i.root, i.cfg)`로 바꾸고 주석의 "엄격 모드" 표현을 맞춘다. 동작은 같다.

### 3. 테스트 `scripts/test/doc-lint-gate.test.ts`(새 파일)

실제 `git` 리포를 임시 폴더에 만들어 쓴다(`scripts/test/helpers.ts`). 리포마다 `harness.config.json`, `AGENTS.md`, 색인 `docs/index.md`, 문서가 있다. `git` 읽기 실패는 리포를 실제로 깨뜨려 만든다(가짜 `git`을 끼우지 않는다).

읽기 실패 사례의 CLI 단언은 공통이다. 아래 세 실행 모두에서 종료 코드가 1이고, 출력(표준 출력과 표준 오류를 합친 것)에 `R8 문서 읽기 실패`, 그 사례에서 실패한 조회의 이름(`git ls-files`, `git log`, `git rev-parse` 가운데 하나), `git status`(고치는 법)가 있다. `check`의 두 실행은 출력에 `✗ doc-lint`도 있다.

- `node scripts/harness.ts doc-lint`
- `node scripts/harness.ts check --only doc-lint`(기본 실행. 캐시를 쓴다. 이 리포들은 통과한 적이 없어 캐시가 적중하지 않는다)
- `node scripts/harness.ts check --only doc-lint --no-cache`

사례:

- **문서 목록 읽기 실패**: 커밋한 리포에 깨진 링크가 든 문서를 두고, 색인 파일(`git rev-parse --git-path index`가 가리키는 파일)을 색인이 아닌 내용으로 덮어쓴다(`git ls-files`가 실패하고 `git rev-parse`는 성공한다).
  - `docLint`는 `DocLintReadError`를 던진다.
  - `docLintGate`의 결과는 오류가 정확히 한 건이고 `rule`이 `R8 문서 읽기 실패`, `what`에 `git ls-files`, `how`에 `git status`가 있다. 경고는 없다.
  - 위 CLI 단언(조회 이름은 `git ls-files`). 기본 실행의 `check`는 캐시 키를 만들지 못해도 예외로 끝나지 않고 `doc-lint` 단계의 실패로 끝난다(출력에 `git add`가 실패했다는 스택이 없다).
- **커밋 시각 읽기 실패**: `review_cycle: on-change`이고 `related_code`가 비지 않은 문서를 커밋한 리포에서 현재 브랜치의 ref 파일(`git rev-parse --git-path <ref>`)을 바꾼다. 세 가지를 각각 본다: 없는 객체의 해시(`1`을 40번), 해시가 아닌 내용, 빈 파일. 셋 다 `git log`가 실패하고 `git ls-files`는 성공한다. 뒤의 둘은 `git rev-parse --verify -q HEAD`가 커밋 없는 리포와 같은 종료 코드 1로 끝나는 경우다.
  - 세 가지 모두 `docLintGate`의 결과는 오류가 정확히 한 건이고 `rule`이 `R8 문서 읽기 실패`, `what`에 `git log`가 있다. 경고는 없다.
  - 세 가지 모두 위 CLI 단언(조회 이름은 `git log`).
- **HEAD 커밋 읽기 실패(커밋 시각이 필요한 문서가 없다)**: 모든 문서의 `related_code`가 빈 리포를 커밋한 뒤 현재 브랜치의 ref 파일을 위와 같은 세 가지로 바꾼다. `git log`는 불리지 않는다.
  - 세 가지 모두 `docLintGate`의 결과는 오류가 정확히 한 건이고 `rule`이 `R8 문서 읽기 실패`, `what`에 `git rev-parse`가 있다. 경고는 없다.
  - 세 가지 모두 위 CLI 단언(조회 이름은 `git rev-parse`).
- **커밋이 없는 리포**: `git init`만 하고 커밋하지 않은 리포(파일은 작업 트리에 있다). 문서 하나는 `review_cycle: on-change`이고 `related_code`가 비지 않다.
  - 문서가 모두 정상이면 `docLintGate`의 오류와 경고가 없고, `node scripts/harness.ts doc-lint`는 종료 코드 0이다.
  - 깨진 링크가 든 문서를 더하면 `docLintGate`의 오류에 `R8 깨진 링크`가 있고 `R8 문서 읽기 실패`는 없다.
  - 같은 리포에서 `docLint(root, cfg)`(옵션 없이)는 `DocLintReadError`를 던진다(커밋 없는 리포의 처리는 게이트용 함수에만 있다).
  - 커밋이 있는 리포에서 `git checkout --orphan <새 브랜치>`를 한 직후도 커밋이 없는 리포다: 문서가 정상이면 `docLintGate`의 오류와 경고가 없다.
- **`git` 리포가 아닌 폴더**: `docLintGate`의 결과는 오류가 정확히 한 건이고 `rule`이 `R8 문서 읽기 실패`, `what`에 `git ls-files`가 있다.
- **정상 리포에서 같은 결과**: 커밋한 리포에 깨진 링크가 든 문서와, `related_code`가 문서보다 나중에 커밋된 문서를 둔다. `docLintGate`의 결과가 `docLint`의 결과와 같고(deepEqual), 오류에 `R8 깨진 링크`, 경고에 `R8 검토 필요`가 있다. 분리된 HEAD(`git checkout --detach`)에서도 같다.
- **캐시 키를 만들지 못한 실행은 캐시에 남지 않는다**: 색인을 덮어쓴 리포에서 문서를 쓰지 않는 단계만 실행하면(`check --only build`. 픽스처의 `build` 명령은 해당 없음이다) 종료 코드 0으로 끝나고, 캐시 폴더(`<git 공용 폴더>/harness/check-cache`)에 파일이 생기지 않는다.

### 4. 문서

- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)"에 한 줄: 무엇이 바뀌었는지, 검사를 약화하지 않고 강화한다는 것, 커밋 없는 리포의 처리, 설계서 본문은 바뀌지 않는다는 것.
- `docs/exec-plans/tech-debt-tracker.md`: TD-60 행의 상태를 `해결(#<이 PR 번호>: …)`로 바꾼다. 다른 행은 고치지 않는다. 표의 다른 행이 다시 정렬되지 않게 열 폭 안으로 쓴다.

## Acceptance Criteria

```bash
node --test scripts/test/doc-lint-gate.test.ts scripts/test/gates.test.ts scripts/test/codeowners.test.ts scripts/test/check-skip.test.ts scripts/test/metrics-command.test.ts scripts/test/metrics-local.test.ts
grep -q "^| TD-60 .*| 해결(" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- `doc-lint`의 검사 항목과 판정 기준(링크, 색인, frontmatter, 줄 수, "검토 필요")을 바꾸지 마라. 이유: 이 step은 읽기 실패의 처리만 바꾼다.
- `git` 읽기가 실패했을 때 빈 결과나 0으로 넘어가는 경로를 남기지 마라(커밋 없는 리포의 `noHistory`는 예외). 이유: 그 경로가 TD-60이다.
- `check`의 캐시 키 구성(`cacheKey`), 캐시 적중 판정, 끝날 때의 캐시 쓰기 조건을 바꾸지 마라. 이유: 이 step은 키를 만들지 못한 실행을 캐시 없는 실행으로 돌리는 것만 더한다.
- `scripts/commands/metrics.ts`, `scripts/metrics/render.ts`, `scripts/test/metrics-*.ts`를 고치지 마라. 이유: 지표 집계의 동작과 그 테스트는 그대로여야 한다(수용 기준 5).
- `docLint` 안에서 `git` 호출을 더하지 마라. 이유: 지표 집계가 실행하는 `git` 호출의 허용 목록(`scripts/test/metrics-allow.ts`)과 호출 순서 테스트가 바뀐다.
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라(R4). 이유: 정상 리포의 결과가 같다는 증거다.
- `scripts/hooks/`, `scripts/runner/`, `.github/`를 고치지 마라. 이유: 범위 밖이다.
