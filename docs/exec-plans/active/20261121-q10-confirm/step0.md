# Step 0: ci-trial

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준" 1·2, 의사결정 로그)
- `lab/q10-db/README.md`, `lab/q10-db/trial.ts`(인자를 읽는 곳과 결과를 쓰는 곳. 지금은 `--out <파일>`을 받는다), `lab/q10-db/check-results.ts`(`<이름>`, `--file`, `--confirm`), `lab/q10-db/test/check-results.test.ts`
- `docs/SECURITY.md`의 "워크플로 변경 절차", `docs/harness/workflow.md` 5절의 "운영 단계의 보호 경로 PR"·"제작자 작업 요청", `lab/workflow-change/README.md`(앞선 사례)
- `.github/workflows/check.yml`(액션을 고정한 꼴, Node 버전, pnpm 준비), `scripts/test/ci.test.ts`(워크플로 구조를 글로 단언하는 방식), `scripts/gates/harness-guard.ts`(워크플로 검사: 캐시, 비밀, 새 write 권한)

## 작업

테스트를 먼저 쓰고 실패를 확인해 진행 로그에 적는다(R5).

순서는 `docs/SECURITY.md`의 "워크플로 변경 절차" 가운데 계획 검증(G1)을 받는 계획의 순서다: (가) 계획만 담은 초안 PR로 계획 검증을 받는다. (나) 승인 뒤 아래 1~3과 5의 CHANGELOG 줄을 올려 구현 판정을 받는다(구조 테스트는 로컬에서만 확인하고 올리지 않는다. 완료 처리도 하지 않는다. 그래서 이 head는 `plan-gate`를 통과하지 못한다). 판정의 지적은 이 단계에서 고친다. (다) 판정이 끝난 head의 SHA를 기준 커밋으로 삼아 Issue #180에 제작자 작업을 요청한다(`needs-human`). 요청한 뒤에는 제작자의 커밋이 올 때까지 브랜치에 커밋을 더하지 않는다. (라) 제작자가 브랜치에 워크플로 커밋을 올리면 받아서, 기준 커밋의 트리에 패치를 적용한 결과와 받은 head의 트리가 통째로 같은지 SECURITY.md의 명령으로 본다. 같지 않으면 멈추고 제작자에게 알린다. (마) 같으면 4와 진행 로그(기준 커밋의 SHA), 완료 처리를 올린다.

### 1. `lab/q10-db/run.ts`(새 파일)와 테스트 `lab/q10-db/test/run.test.ts`

`node lab/q10-db/run.ts [--skip-fmt]`. 리포의 루트에서 돌린다.

- 단계(기본): ① 새 임시 폴더를 만들어(`fs.mkdtempSync`, 지우지 않는다) `node lab/q10-db/trial.ts <폴더>` ② `node scripts/harness.ts fmt` ③ `node lab/q10-db/check-results.ts <platform>-<arch>`(이 머신의 `process.platform`·`process.arch`) ④ `node --test lab/q10-db/test/check-results.test.ts`.
- `--skip-fmt`: ②를 뺀다.
- 받는 인자는 `--skip-fmt` 하나뿐이다. 그 밖의 인자는(`--out` 포함) 사용법을 내고 종료 코드 2로 끝난다(아무 단계도 돌리지 않는다).
- 한 단계가 0이 아닌 종료 코드로 끝나거나 실행하지 못하면 뒤 단계를 돌리지 않고, 실패한 단계의 이름을 표준 오류에 내고 종료 코드 1로 끝난다. 모든 단계가 통과하면 0이다.
- 자식 프로세스는 `process.execPath`로 띄운다(셸을 거치지 않는다. OS와 무관하다). 출력은 그대로 흘려보낸다.
- 구조: 단계 목록을 만드는 순수 함수(`planSteps(opts)` — 이름과 인자 배열의 목록), 목록을 차례로 돌리는 함수(`runSteps(steps, exec)` — `exec`를 주입한다), 실제로 자식 프로세스를 띄우는 함수(`spawnStep`)를 내보낸다. 파일을 직접 실행했을 때만 실제로 돈다.
- 테스트(`node:test`, 네트워크를 쓰지 않는다): 기본·`--skip-fmt`의 단계 목록(순서와 인자), 가운데 단계가 실패하면 뒤 단계가 불리지 않고 1을 낸다, 모두 통과하면 0이다, 실행하지 못한 단계(`exec`가 던진다)도 실패다, 잘못된 인자(`--bogus`, `--out x.json`)는 2이고 단계가 하나도 불리지 않는다. `spawnStep`으로 `process.exit(0)`과 `process.exit(3)`만 하는 Node 한 줄을 실제로 띄워 종료 코드가 그대로 돌아오는지 본다(실제 실행 경로. 리포의 파일을 건드리지 않는다).

#### `trial.ts`에서 `--out`을 지운다

지금 `trial.ts`는 `--out <파일>`을 받아 결과를 그 경로에 검사 없이 쓴다(`--out package.json`이면 실측이 끝난 뒤 작업 트리의 `package.json`을 결과로 덮어쓴다. 계획 검증 1회차의 F1). 이 옵션을 안전하게 만드는 대신 없앤다(제작자 결정, 2026-11-22. 의사결정 로그). 확정 조건에 필요한 기능이 아니고 CI의 실측도 쓰지 않는다.

- `trial.ts`가 받는 인자는 `<빈 폴더>` 하나뿐이다. 인자가 하나가 아니거나 `--`로 시작하면 사용법을 내고 0이 아닌 종료 코드로 끝난다(넘겨받은 폴더에 무엇을 만들거나 패키지를 설치하기 전에). 결과는 언제나 `lab/q10-db/results/<platform>-<arch>.json`에 쓴다(지금의 기본 동작 그대로). 머리 주석과 사용법 문구, 끝의 출력 문구에서 `--out`을 지운다.
- 인자 검사를 함수로 뗀다: `lab/q10-db/trial-args.ts`(새 파일)의 `parseTrialArgs(argv)`. 받을 수 있으면 `{ dir }`를, 아니면 `{ error }`(사용법의 글)를 낸다. 파일 시스템을 보지 않고 아무것도 실행하지 않는 순수 함수다. `trial.ts`의 `main`은 첫 문장에서 이 함수를 부르고, `error`면 그 글을 내고 끝난다(`fail`). `trial.ts`는 불러오기만 해도 실측이 돌기 때문에(파일 끝에서 `main`을 부른다) 테스트가 `trial.ts`를 불러오거나 실행하지 않고 이 함수만 시험한다.
- 그 밖의 `trial.ts`(확인 항목, 결과의 내용, 실험 폴더가 리포 밖인지 보는 검사)는 바꾸지 않는다.
- `check-results.ts`의 `--file <파일>`은 그대로 둔다. 파일을 읽어 검사만 하고 아무것도 쓰지 않는다. 받은 실행 산출물을 리포에 넣기 전에 검사하는 데 쓴다(2의 README).
- 테스트(`run.test.ts`에 더한다. 네트워크를 쓰지 않고 `trial.ts`를 실행하지 않는다): `parseTrialArgs`가 `['<폴더>']`에는 `{ dir }`를 내고, `[]`, `['--x']`, `['<폴더>', '--out', 'x.json']`, `['<폴더>', '더']`에는 사용법이 든 `error`를 낸다. 연결을 글로 본다(`trial.ts`를 읽는다): `trial.ts`가 `./trial-args.ts`의 `parseTrialArgs`를 가져오고, `main` 안에서 그 호출이 폴더를 보거나 만들거나 자식 프로세스를 띄우는 어떤 호출(`existsSync`, `statSync`, `readdirSync`, `mkdirSync`, `writeFileSync`, `spawnSync`)보다 앞에 있으며, `trial.ts`에 `--out`이라는 글이 없다. 구현 전의 실패 확인은 이 테스트로 한다: `trial-args.ts`가 없어 불러오기에서 실패한다(옛 `trial.ts`를 실행하지 않으므로 패키지 설치가 시작되지 않는다).
- 실제 명령으로는 구현 뒤에 AC가 본다(여덟째 줄): `trial.ts`에 빈 임시 폴더와 `--out <다른 새 임시 폴더 아래의 이름>`을 주면 0이 아닌 코드로 끝나고 두 폴더가 빈 채다. 두 경로 모두 리포 밖의 새 임시 폴더다. 리포 안의 경로를 `--out`에 주는 테스트나 AC는 두지 않는다.

### 2. `lab/q10-db/README.md`

- "절차" 절의 셸 블록 둘(Bash, PowerShell)을 명령 하나로 바꾼다: `node lab/q10-db/run.ts`. 실패하면 그 자리에서 멈춘다는 것, `trial.ts`가 실패하면 결과 파일을 새로 쓰지 않는다는 것은 남긴다. "PowerShell 절차는 아직 Windows에서 돌려 보지 않았다" 줄은 지운다(그 블록이 없어진다).
- "작업 트리를 바꾸지 않고 돌려만 보려면 결과를 리포 밖에 쓴다"는 항목(`trial.ts … --out …`)을 지운다. 대신 적는다: 이 명령은 `lab/q10-db/results/<platform>-<arch>.json`을 다시 쓴다. 작업 트리를 바꾸지 않고 돌려 보려면 리포를 새 임시 폴더에 복제해 그 안에서 돌린다(`git clone` 뒤 그 폴더에서 `node lab/q10-db/run.ts --skip-fmt`. 복제본에는 하네스의 의존성이 없어 포맷을 건너뛴다. CI 러너와 같은 조건이다). README의 다른 곳에 `--out`이 남지 않게 한다.
- "CI 러너에서 돌리기" 항목을 더한다: 워크플로 `q10-trial`을 손으로 돌린다(`gh workflow run q10-trial.yml --ref main`), 실행 산출물(`q10-result-<os>`)을 받는다(`gh run download <실행 번호> --dir <새 임시 폴더>`), 받은 폴더의 `<platform>-<arch>.json`을 `lab/q10-db/results/`에 복사하고 `node scripts/harness.ts fmt`와 `node lab/q10-db/check-results.ts <이름>`을 돌린다. 러너에서는 포맷을 건너뛴다는 것과 이유(하네스의 의존성을 설치하지 않는다)를 적는다. 받은 파일을 리포에 넣기 전에 검사하려면 `node lab/q10-db/check-results.ts --file <받은 파일>`을 쓸 수 있다는 것(그 파일을 실행 중인 머신의 플랫폼과 대 보므로, 받은 머신과 플랫폼이 다르면 복사한 뒤 `<이름>`으로 검사한다)을 적는다. 받은 파일의 내용을 손으로 고치지 않는다.
- 파일 표에 `run.ts`와 패치 파일을 더한다.

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
C=$(mktemp -d) && git clone -q --no-hardlinks . "$C/repo" && (cd "$C/repo" && node lab/q10-db/run.ts --skip-fmt) && test -z "$(git status --porcelain -- lab/q10-db/results)"
node lab/q10-db/run.ts --bogus; test $? = 2
O=$(mktemp -d) && { node lab/q10-db/run.ts --out "$O/x.json"; test $? = 2; } && test -z "$(ls -A "$O")"
D=$(mktemp -d) && O=$(mktemp -d) && { node lab/q10-db/trial.ts "$D" --out "$O/x.json"; test $? != 0; } && test -z "$(ls -A "$D")" && test -z "$(ls -A "$O")"
! grep -q -e '--out' lab/q10-db/trial.ts lab/q10-db/run.ts lab/q10-db/README.md
git apply --reverse --check lab/q10-db/q10-trial-workflow.patch
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- .github | tr '\n' ' ')" = ".github/workflows/q10-trial.yml "
test "$(grep -c '^diff --git ' lab/q10-db/q10-trial-workflow.patch)" = 1
node lab/q10-db/check-results.ts darwin-arm64
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 다섯째 줄은 절차를 이 머신에서 실제로 돌린다(네트워크로 패키지를 설치한다). 이 작업 트리가 아니라 새 임시 폴더의 복제본에서 돌린다: 복제본은 커밋된 HEAD이므로 구현을 커밋한 뒤에 돌린다. 결과는 복제본의 `lab/q10-db/results/`에 쓰이고, 이 작업 트리의 결과 폴더가 바뀌지 않았는지 본다. 복제본에는 하네스의 의존성이 없어 `--skip-fmt`로 돌린다(CI 러너와 같은 명령이다). 복제본은 지우지 않는다.
- 여섯째~아홉째 줄: 모르는 인자와 `--out`은 `run.ts`가 2로 끝낸다(아무 단계도 돌지 않는다). `trial.ts`도 `--out`을 받지 않고 넘긴 폴더에 아무것도 만들지 않는다. `--out`에는 리포 밖의 새 임시 폴더 아래의 이름을 주고, 그 폴더가 빈 채인지 본다. `trial.ts`, `run.ts`, README에 `--out`이 남아 있지 않다. 이 줄들은 구현 뒤에 돌린다(AC). 구현 전의 실패 확인은 첫 줄의 테스트로 하고, 그 테스트는 `trial.ts`를 실행하지 않는다.
- 열째~열두째 줄: 워크플로 파일이 패치와 같고(새 파일을 만드는 패치는 내용이 글자 그대로 같아야 거꾸로 적용된다), 이 PR이 `.github/` 아래에서 바꾼 파일이 그 하나뿐이며, 패치가 파일 하나만 다룬다. `origin/main`이 필요하다(`git fetch origin`).
- 구조의 세부는 셋째 줄의 테스트가 본다.
- Linux와 Windows에서 절차가 도는지는 이 step이 병합된 뒤 step1에서 워크플로로 본다.

## 금지사항

- 워크플로 파일을 봇이 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없고, 워크플로는 제작자가 올린다(SECURITY.md). 봇은 패치만 준비한다.
- 구조 테스트와 완료 처리를 제작자의 워크플로 커밋보다 먼저 올리지 마라. 이유: 구조 테스트가 먼저 올라가면 테스트만 있는 head가 실패한 채 판정을 기다리고, 완료 처리가 먼저 올라가면 워크플로가 빠진 head가 `check`와 `plan-gate`를 통과해 워크플로 없이 병합될 수 있다(SECURITY.md의 순서). 초안 PR은 계획 검증 때문에 먼저 열려 있다.
- 워크플로에 비밀, environment, 캐시, 쓰기 권한, PR·push 트리거를 넣지 마라. 이유: 패키지를 설치해 코드를 실행하는 워크플로다. 손으로 돌리는 읽기 전용 실행으로 둔다(10.4절).
- `lab/q10-db/check-results.ts`의 기대값·판정 기준과 `trial.ts`의 확인 항목을 느슨하게 바꾸지 마라. 이유: 확정 조건의 판정이다. 실측에서 어긋난 점이 나오면 원인을 고친다.
- `lab/q10-db/results/`에 결과 파일을 더하거나 고치지 마라. 이유: 결과는 step1에서, 워크플로의 산출물로만 더한다.
- 다른 워크플로 파일, `harness.config.json`, 설계서를 고치지 마라. 이유: 이 step의 범위가 아니다.
- 결과를 다른 경로에 쓰는 옵션(`--out` 같은 것)을 `run.ts`나 `trial.ts`에 다시 넣지 마라. 리포 안의 경로를 쓰기 대상으로 주는 테스트나 AC도 두지 마라. 이유: 임의의 경로에 쓰는 옵션은 작업 트리의 파일을 덮어쓸 수 있고, 안전하게 만드는 비용이 이 실험의 목적에 비해 크다(제작자 결정, 2026-11-22).
