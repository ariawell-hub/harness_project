# Step 0: ci-trial

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준" 1·2, 의사결정 로그)
- `lab/q10-db/README.md`, `lab/q10-db/trial.ts`(인자와 `--out`), `lab/q10-db/check-results.ts`(`<이름>`, `--file`, `--confirm`), `lab/q10-db/test/check-results.test.ts`
- `docs/SECURITY.md`의 "워크플로 변경 절차", `docs/harness/workflow.md` 5절의 "운영 단계의 보호 경로 PR"·"제작자 작업 요청", `lab/workflow-change/README.md`(앞선 사례)
- `.github/workflows/check.yml`(액션을 고정한 꼴, Node 버전, pnpm 준비), `scripts/test/ci.test.ts`(워크플로 구조를 글로 단언하는 방식), `scripts/gates/harness-guard.ts`(워크플로 검사: 캐시, 비밀, 새 write 권한)

## 작업

테스트를 먼저 쓰고 실패를 확인해 진행 로그에 적는다(R5).

순서는 `docs/SECURITY.md`의 "워크플로 변경 절차" 가운데 계획 검증(G1)을 받는 계획의 순서다: (가) 계획만 담은 초안 PR로 계획 검증을 받는다. (나) 승인 뒤 아래 1~3과 5의 CHANGELOG 줄을 올려 구현 판정을 받는다(구조 테스트는 로컬에서만 확인하고 올리지 않는다. 완료 처리도 하지 않는다. 그래서 이 head는 `plan-gate`를 통과하지 못한다). 판정의 지적은 이 단계에서 고친다. (다) 판정이 끝난 head의 SHA를 기준 커밋으로 삼아 Issue #180에 제작자 작업을 요청한다(`needs-human`). 요청한 뒤에는 제작자의 커밋이 올 때까지 브랜치에 커밋을 더하지 않는다. (라) 제작자가 브랜치에 워크플로 커밋을 올리면 받아서, 기준 커밋의 트리에 패치를 적용한 결과와 받은 head의 트리가 통째로 같은지 SECURITY.md의 명령으로 본다. 같지 않으면 멈추고 제작자에게 알린다. (마) 같으면 4와 진행 로그(기준 커밋의 SHA), 완료 처리를 올린다.

### 1. `lab/q10-db/run.ts`(새 파일)와 테스트 `lab/q10-db/test/run.test.ts`

`node lab/q10-db/run.ts [--skip-fmt] [--out <파일>]`. 리포의 루트에서 돌린다.

- 단계(기본): ① 새 임시 폴더를 만들어(`fs.mkdtempSync`, 지우지 않는다) `node lab/q10-db/trial.ts <폴더>` ② `node scripts/harness.ts fmt` ③ `node lab/q10-db/check-results.ts <platform>-<arch>`(이 머신의 `process.platform`·`process.arch`) ④ `node --test lab/q10-db/test/check-results.test.ts`.
- `--skip-fmt`: ②를 뺀다.
- `--out <파일>`: ①에 `--out <파일>`을 넘기고 ②를 빼고 ③을 `node lab/q10-db/check-results.ts --file <파일>`로 바꾼다. 파일은 아래 "`--out` 경로 검사"를 통과해야 한다. 통과하지 못하면 이유를 표준 오류에 내고 종료 코드 2로 끝나며 단계를 하나도 돌리지 않는다(자식 프로세스를 띄우지 않는다).
- 한 단계가 0이 아닌 종료 코드로 끝나거나 실행하지 못하면 뒤 단계를 돌리지 않고, 실패한 단계의 이름을 표준 오류에 내고 종료 코드 1로 끝난다. 모든 단계가 통과하면 0이다.
- 모르는 인자, `--out`에 값이 없는 경우는 사용법을 내고 종료 코드 2로 끝난다(아무 단계도 돌리지 않는다).
- 자식 프로세스는 `process.execPath`로 띄운다(셸을 거치지 않는다. OS와 무관하다). 출력은 그대로 흘려보낸다.
- 구조: 단계 목록을 만드는 순수 함수(`planSteps(opts)` — 이름과 인자 배열의 목록)와 목록을 차례로 돌리는 함수(`runSteps(steps, exec)` — `exec`를 주입한다)를 내보낸다. 파일을 직접 실행했을 때만 실제로 돈다.
- 테스트(`node:test`, 네트워크를 쓰지 않는다): 기본·`--skip-fmt`·`--out`의 단계 목록(순서와 인자), 가운데 단계가 실패하면 뒤 단계가 불리지 않고 1을 낸다, 모두 통과하면 0이다, 실행하지 못한 단계(`exec`가 던진다)도 실패다, 잘못된 인자는 2이고 단계가 하나도 불리지 않는다.

#### `--out` 경로 검사: `lab/q10-db/out-file.ts`(새 파일)와 테스트 `lab/q10-db/test/out-file.test.ts`

지금 `trial.ts`의 `--out`은 경로를 검사하지 않고 그대로 쓴다(`--out package.json`이면 실측이 끝난 뒤 작업 트리의 `package.json`을 결과로 덮어쓴다). 쓰는 쪽(`trial.ts`)과 부르는 쪽(`run.ts`)이 같은 검사를 쓴다.

- `outFileProblem(repoRoot, file)`: 문제가 없으면 `null`, 있으면 이유(글)를 낸다. 파일이나 폴더를 만들거나 고치지 않는다.
  - 부모 폴더가 없거나 폴더가 아니면 거부한다(폴더를 만들어 주지 않는다).
  - 부모 폴더의 실제 경로(`realpathSync`. 심볼릭 링크를 따라간 경로)가 리포 루트의 실제 경로 자체이거나 그 안이면 거부한다(`check-results.ts`의 `isOutsideDir`로 판정한다). 리포 안을 가리키는 심볼릭 링크 폴더를 거친 경로도 여기서 걸린다.
  - 그 이름의 항목이 이미 있으면 거부한다(`lstatSync`. 파일, 폴더, 심볼릭 링크 — 끊어진 링크와 리포 안의 파일을 가리키는 링크 포함). 있는 파일을 덮어쓰지 않는다.
- 검사한 대상과 쓰는 대상을 같게 고정한다(검사한 뒤 실측이 끝날 때까지 몇 분이 걸린다. 그 사이에 부모 경로의 심볼릭 링크가 리포 안을 가리키게 바뀌어도 리포 안에 파일이 생기면 안 된다).
  - `pinOutFile(repoRoot, file)`: 위 검사를 통과하면 **고정한 경로**를 낸다. 부모 폴더의 실제 경로에 파일 이름을 붙인 절대 경로다(이때 심볼릭 링크인 폴더가 하나도 없는 경로). 걸리면 이유를 낸다. 아무것도 만들지 않는다.
  - `openOutFile(repoRoot, file)`: 고정한 경로를 `wx`로 열어(새 파일로만 연다. 그 이름이 있으면 실패한다) 파일 디스크립터와 고정한 경로를 낸다. 연 직후에 다시 확인한다: 고정한 경로의 부모 폴더의 실제 경로가 그대로이고 리포 밖이며, 연 파일과 고정한 경로의 항목이 같은 파일이다(`fstatSync`와 `lstatSync`의 `dev`·`ino`). 다르면 디스크립터를 닫고 실패한다(결과를 쓰지 않는다).
  - 결과는 연 디스크립터에 쓴다. 경로로 다시 열지 않는다. 그래서 연 뒤에 경로가 가리키는 곳이 바뀌어도 결과는 처음 연 파일에 쓰인다.
  - 남는 한계(적어 둔다): 검사와 여는 것 사이의 한순간에, 심볼릭 링크가 아니던 폴더를 누가 심볼릭 링크로 바꿔치면 그 한순간에는 막지 못하고 연 직후의 확인에서 실패로 드러난다(빈 파일이 그 자리에 남을 수 있다). Node에는 폴더 디스크립터를 기준으로 여는 방법이 없다. 그렇게 바꿔칠 수 있는 프로세스는 이미 그 사용자의 권한으로 리포에 직접 쓸 수 있다.
- `run.ts`: `--out`이 있으면 단계 목록을 만들기 전에 `pinOutFile`을 부른다. 걸리면 2로 끝난다. 통과하면 받은 경로가 아니라 **고정한 경로**를 `trial.ts`의 `--out`과 `check-results.ts --file`에 넘긴다.
- `trial.ts`: `--out`이 있으면 인자를 읽은 직후(폴더 안에 무엇을 만들거나 패키지를 설치하기 전)에 `openOutFile`로 결과 파일을 열고, 걸리면 이유를 내고 0이 아닌 종료 코드로 끝난다(넘겨받은 빈 폴더에는 아무것도 만들지 않는다). 실측이 끝나면 결과를 그 디스크립터에 쓰고 닫는다. 실측이 실패하면 결과를 쓰지 않으므로 열어 둔 파일은 빈 채로 남는다(경로로 지우지 않는다. 지우는 것도 경로가 바뀌면 다른 파일을 지울 수 있다). 빈 파일은 `check-results.ts --file`을 통과하지 못한다(JSON이 아니다). 부모 폴더를 만들던 것(`mkdirSync(…, { recursive: true })`)은 `--out`이 없을 때(리포의 `results/`)만 한다. `trial.ts`의 확인 항목과 결과의 내용은 바꾸지 않는다.
- 테스트(`out-file.test.ts`. 임시 폴더는 `mkdtempSync`로 만들고 지우지 않는다): 리포 밖 새 폴더의 새 이름은 통과한다. 거부하는 것: 리포 안의 있는 파일(`package.json`), 리포 안의 새 이름(`lab/q10-db/results/x.json`), 리포 루트 바로 아래의 새 이름, 리포 밖의 있는 파일, 리포 밖 폴더에 있는 심볼릭 링크(리포 안의 파일을 가리키는 것, 끊어진 것), 리포 안의 폴더를 가리키는 심볼릭 링크 폴더 아래의 새 이름, 없는 부모 폴더, 부모가 파일인 경로. 거부한 뒤 대상이 그대로다(있던 파일과 링크가 가리키는 파일의 내용이 같고, 새 파일이 생기지 않았다). 심볼릭 링크를 만들 수 없는 환경(권한 없는 Windows)에서는 링크 사례만 건너뛴다.
- 테스트(같은 파일. 고정): 리포 역할의 임시 폴더와 리포 밖 역할의 임시 폴더를 만들고, 리포 밖 폴더를 가리키는 심볼릭 링크 폴더 아래의 새 이름으로 `openOutFile`을 부른다. 고정한 경로가 링크를 거치지 않는 실제 경로다. 그 뒤 링크를 리포 역할의 폴더를 가리키게 바꾸고 디스크립터에 결과를 쓴다: 결과는 리포 밖 폴더의 파일에 쓰이고, 리포 역할의 폴더에는 아무 항목도 생기지 않는다. `pinOutFile`이 낸 경로로 다시 부르면 같은 경로가 나온다. 이미 있는 이름으로 `openOutFile`을 부르면 실패하고 있던 파일이 그대로다. 디스크립터에 쓰지 않고 닫으면 빈 파일이 남고, 그 파일은 `check-results.ts`의 파일 검사를 통과하지 못한다.
- `run.test.ts`에 더한다: `--out`이 검사에 걸리면 2를 내고 `exec`가 한 번도 불리지 않는다(리포 안의 있는 파일, 리포 밖의 있는 파일). 심볼릭 링크 폴더 아래의 경로를 주면 단계의 인자에는 고정한 경로(실제 경로)가 들어간다.

### 2. `lab/q10-db/README.md`

- "절차" 절의 셸 블록 둘(Bash, PowerShell)을 명령 하나로 바꾼다: `node lab/q10-db/run.ts`. 실패하면 그 자리에서 멈춘다는 것, `trial.ts`가 실패하면 결과 파일을 새로 쓰지 않는다는 것은 남긴다. "PowerShell 절차는 아직 Windows에서 돌려 보지 않았다" 줄은 지운다(그 블록이 없어진다).
- 작업 트리를 바꾸지 않고 돌려 보는 법을 `node lab/q10-db/run.ts --out <리포 밖 파일>`로 고친다. 파일은 리포 밖의 있는 폴더 아래의 새 이름이어야 한다는 것(리포 안의 경로와 이미 있는 파일은 실행하기 전에 거부한다)과, `--out`으로 돌린 실측이 실패하면 그 이름의 빈 파일이 남는다는 것을 적는다.
- "CI 러너에서 돌리기" 항목을 더한다: 워크플로 `q10-trial`을 손으로 돌린다(`gh workflow run q10-trial.yml --ref main`), 실행 산출물(`q10-result-<os>`)을 받는다(`gh run download <실행 번호> --dir <새 임시 폴더>`), 받은 폴더의 `<platform>-<arch>.json`을 `lab/q10-db/results/`에 복사하고 `node scripts/harness.ts fmt`와 `node lab/q10-db/check-results.ts <이름>`을 돌린다. 러너에서는 포맷을 건너뛴다는 것과 이유(하네스의 의존성을 설치하지 않는다)를 적는다. 받은 파일의 내용을 손으로 고치지 않는다.
- 파일 표에 `run.ts`, `out-file.ts`와 패치 파일을 더한다.

### 3. 워크플로 패치 `lab/q10-db/q10-trial-workflow.patch`

`.github/workflows/q10-trial.yml`을 새로 만드는 패치(`git diff` 형식, 워크플로 파일만 든다). 워크플로의 내용:

- 머리 주석: 무엇을 하는지(Issue #180, ADR-0007의 확정 조건), 손으로만 돈다, 비밀·캐시를 쓰지 않는다, 액션은 커밋 SHA로 고정한다, 결과는 실행 산출물로만 낸다(리포에 쓰지 않는다).
- `name: q10-trial`. `on:`은 `workflow_dispatch`뿐이다.
- 최상위 `permissions:`는 `contents: read`뿐이다. `concurrency`는 두지 않는다(손으로 한 번 돈다).
- job `trial`: `runs-on: ${{ matrix.os }}`, `strategy.fail-fast: false`, `matrix.os: [ubuntu-latest, windows-latest]`, `timeout-minutes: 20`.
- steps: ① `actions/checkout`(`check.yml`과 같은 커밋 SHA, `persist-credentials: false`) ② `actions/setup-node`(`check.yml`과 같은 커밋 SHA와 Node 버전) ③ `corepack enable` ④ `node lab/q10-db/run.ts --skip-fmt` ⑤ `actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9`(v7.0.2), `name: q10-result-${{ matrix.os }}`, `path: lab/q10-db/results/`, `if-no-files-found: error`, `retention-days: 14`.
- `run:` 줄에 `${{ … }}`를 넣지 않는다. `secrets`, `environment`, 캐시(`actions/cache`, `cache:`)를 쓰지 않는다.

패치의 적용 방법(제작자 작업)을 README가 아니라 Issue #180의 요청에 적는다: 새 파일이므로 GitHub 웹에서 그 브랜치에 `.github/workflows/q10-trial.yml`을 만들고 패치의 `+` 줄(맨 앞의 `+`를 뺀 것)을 그대로 붙여 넣어 그 브랜치에 바로 커밋한다. 에이전트가 도는 머신의 터미널에서 하지 않는다(E5).

### 4. 구조 테스트 `scripts/test/q10-trial-workflow.test.ts`(새 파일. 제작자의 워크플로 커밋 뒤에 올린다)

`.github/workflows/q10-trial.yml`을 글로 읽어 단언한다(`scripts/test/ci.test.ts`의 방식).

- 파일이 있다. 내용이 패치의 `+` 줄을 이은 것과 글자 그대로 같다(패치의 머리 줄 `+++`는 뺀다).
- `on:` 아래의 트리거가 `workflow_dispatch` 하나다(`pull_request`, `pull_request_target`, `push`, `schedule`, `workflow_run`, `workflow_call`이 없다).
- `permissions:`가 최상위에 한 번 있고 그 아래가 `contents: read` 한 줄이다. 파일 어디에도 `write`가 없다.
- `secrets`, `environment:`, `actions/cache`, `cache:`가 없다. `run:` 줄(여러 줄 블록 포함)에 `${{`가 없다.
- 모든 `uses:`가 40자 16진수 커밋 SHA로 고정돼 있다. `actions/checkout`과 `actions/setup-node`의 SHA와 Node 버전이 `check.yml`의 것과 같다.
- 행렬에 `ubuntu-latest`와 `windows-latest`가 있고 `fail-fast: false`다. `timeout-minutes`가 있다.
- `node lab/q10-db/run.ts --skip-fmt`를 돌리는 줄이 있다.
- 산출물 올리기: `path: lab/q10-db/results/`, `if-no-files-found: error`.

### 5. 문서

- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄: 워크플로 `q10-trial`을 더했다(손으로만 돈다, 비밀·쓰기 권한 없음, 검사를 약화하지 않는다), `lab/q10-db/run.ts`. 설계서 본문은 바뀌지 않는다(이 step은 설계서를 고치지 않는다).
- PR 본문에 `- [x] 보호 경로 변경: …` 줄을 둔다.

## Acceptance Criteria

```bash
node --test lab/q10-db/test/run.test.ts
node --test lab/q10-db/test/check-results.test.ts
node --test scripts/test/q10-trial-workflow.test.ts
node --test scripts/test/ci.test.ts
O=$(mktemp -d) && node lab/q10-db/run.ts --out "$O/result.json" && test -s "$O/result.json" && test -z "$(git status --porcelain -- lab/q10-db/results)"
node lab/q10-db/run.ts --bogus; test $? = 2
git apply --reverse --check lab/q10-db/q10-trial-workflow.patch
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- .github | tr '\n' ' ')" = ".github/workflows/q10-trial.yml "
test "$(grep -c '^diff --git ' lab/q10-db/q10-trial-workflow.patch)" = 1
node lab/q10-db/check-results.ts darwin-arm64
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
node --test lab/q10-db/test/out-file.test.ts
B=$(git hash-object package.json) && { node lab/q10-db/run.ts --out package.json; test $? = 2; } && test "$(git hash-object package.json)" = "$B"
D=$(mktemp -d) && B=$(git hash-object package.json) && { node lab/q10-db/trial.ts "$D" --out package.json; test $? != 0; } && test "$(git hash-object package.json)" = "$B" && test -z "$(ls -A "$D")"
```

- 다섯째 줄은 절차를 이 머신에서 실제로 돌린다(네트워크로 패키지를 설치한다). 결과는 리포 밖에 쓰고, 리포의 결과 폴더가 바뀌지 않았는지 본다.
- 일곱째~아홉째 줄: 워크플로 파일이 패치와 같고(새 파일을 만드는 패치는 내용이 글자 그대로 같아야 거꾸로 적용된다), 이 PR이 `.github/` 아래에서 바꾼 파일이 그 하나뿐이며, 패치가 파일 하나만 다룬다. `origin/main`이 필요하다(`git fetch origin`).
- 구조의 세부는 셋째 줄의 테스트가 본다.
- 끝의 세 줄: `--out` 경로 검사의 테스트, 그리고 작업 트리의 있는 파일(`package.json`)을 `--out`으로 주면 `run.ts`가 2로 끝나고 `trial.ts`가 0이 아닌 코드로 끝나며 그 파일의 내용이 그대로인 것. `trial.ts`는 넘긴 빈 폴더에 아무것도 만들지 않고 끝난다(설치를 시작하기 전에 거부한다).

## 금지사항

- 워크플로 파일을 봇이 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없고, 워크플로는 제작자가 올린다(SECURITY.md). 봇은 패치만 준비한다.
- 구조 테스트와 완료 처리를 제작자의 워크플로 커밋보다 먼저 올리지 마라. 이유: 구조 테스트가 먼저 올라가면 테스트만 있는 head가 실패한 채 판정을 기다리고, 완료 처리가 먼저 올라가면 워크플로가 빠진 head가 `check`와 `plan-gate`를 통과해 워크플로 없이 병합될 수 있다(SECURITY.md의 순서). 초안 PR은 계획 검증 때문에 먼저 열려 있다.
- 워크플로에 비밀, environment, 캐시, 쓰기 권한, PR·push 트리거를 넣지 마라. 이유: 패키지를 설치해 코드를 실행하는 워크플로다. 손으로 돌리는 읽기 전용 실행으로 둔다(10.4절).
- `lab/q10-db/check-results.ts`의 기대값·판정 기준과 `trial.ts`의 확인 항목을 느슨하게 바꾸지 마라. 이유: 확정 조건의 판정이다. 실측에서 어긋난 점이 나오면 원인을 고친다.
- `lab/q10-db/results/`에 결과 파일을 더하거나 고치지 마라. 이유: 결과는 step1에서, 워크플로의 산출물로만 더한다.
- 다른 워크플로 파일, `harness.config.json`, 설계서를 고치지 마라. 이유: 이 step의 범위가 아니다.
