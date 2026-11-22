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

- 단계(기본): ① 새 임시 폴더를 만들어(`fs.mkdtempSync`, 지우지 않는다) `node lab/q10-db/trial.ts <폴더>` ② `node scripts/harness.ts fmt` ③ `node lab/q10-db/check-results.ts <platform>-<arch>`(이 머신의 `process.platform`·`process.arch`) ④ `node --test lab/q10-db/test/check-results.test.ts lab/q10-db/test/out-file.test.ts`(검사 스크립트의 테스트와 `--out` 경로 검사의 테스트. `check`는 `scripts/test/` 아래만 돌리므로 `lab/q10-db/test/`의 테스트는 이 단계가 돌린다. CI의 워크플로가 이 명령을 부르므로 Linux와 Windows 러너에서도 돈다. `--skip-fmt`와 `--out`에서도 ④는 같다).
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
  - `openOutFile(repoRoot, file)`: 검사한 폴더와 여는 폴더가 같은 폴더이게 연다. 경로를 검사한 뒤에 그 경로로 열면 그 사이에 경로가 가리키는 곳이 바뀔 수 있으므로, 폴더를 먼저 붙잡고 붙잡은 폴더를 검사한다.
    1. 부모 폴더로 들어간다(`process.chdir(부모)`. 없거나 폴더가 아니면 거부한다). 이 뒤로 "현재 폴더"는 경로가 아니라 들어간 그 폴더 자체다. 원래 경로의 심볼릭 링크가 다른 곳을 가리키게 바뀌어도 현재 폴더는 바뀌지 않는다.
    2. 현재 폴더의 실제 경로(들어간 직후의 `process.cwd()`. 운영체제가 알려 주는 그 폴더의 경로)가 리포 루트의 실제 경로 밖인지 본다(`isOutsideDir`). 아니면 거부한다. 그 경로의 폴더와 붙잡은 폴더가 같은 폴더인지도 본다(`statSync('.')`와 `statSync(경로)`의 `dev`·`ino`). 붙잡은 폴더를 검사하므로 "검사한 폴더"와 "여는 폴더"가 다를 수 없다.
    3. 파일 이름만으로 연다(`openSync(이름, 'wx')`. 상대 경로라 현재 폴더 기준으로 열린다). 새 파일로만 연다. 그 이름의 항목이 있으면(심볼릭 링크 포함) 실패한다.
    4. 연 뒤 붙잡은 폴더(`statSync('.')`)와 2에서 읽은 경로의 폴더(`statSync(경로)`)가 여전히 같은 폴더인지(`dev`·`ino`) 본다. 그 경로에 폴더가 없거나 다른 폴더면 디스크립터를 닫고 실패한다(아래 "남는 한계"). `process.cwd()`를 다시 읽는 것으로는 알 수 없다: Node가 그 값을 기억해 두어 폴더가 옮겨져도 바뀌지 않는다(확인함. 진행 로그).
    5. 성공하든 실패하든 처음의 현재 폴더로 돌아간다(`finally`).
    6. 디스크립터와 고정한 경로(2에서 읽은 폴더 경로에 이름을 붙인 것)를 낸다.
  - `--out`은 POSIX(macOS, Linux)에서만 받는다. Windows(`process.platform === 'win32'`)에서는 `run.ts`와 `trial.ts`가 `--out`을 거부한다(`run.ts`는 2, `trial.ts`는 0이 아닌 코드. 아무것도 실행하거나 만들지 않는다). 이유: 위 1~3이 기대는 것(상대 경로가 붙잡은 현재 폴더 기준으로 열린다)을 Windows에서는 확인하지 못했다. CI의 워크플로와 결과를 리포에 쓰는 기본 절차는 `--out`을 쓰지 않으므로 Windows의 실측에는 영향이 없다. `outFileProblem`·`pinOutFile`·`openOutFile`과 `run.ts`의 인자 해석은 `platform`을 인자로 받는다(기본값 `process.platform`). `win32`이면 경로가 무엇이든(리포 밖의 있는 폴더 아래의 새 이름이어도) 다른 검사보다 먼저 거부하고 아무것도 만들지 않는다.
  - 결과는 연 디스크립터에 쓴다. 경로로 다시 열지 않는다. 그래서 연 뒤에 경로가 가리키는 곳이 바뀌어도 결과는 처음 연 파일에 쓰인다.
  - 남는 한계(적어 둔다): 붙잡은 폴더 **자체를** 누가 리포 안으로 옮기는 경우(`mv 그폴더 리포/…`)다. 2와 3 사이에 옮기면 그 폴더 안에 빈 파일이 생기고 4에서 실패로 드러난다. 이것은 경로의 링크를 바꾸는 것이 아니라 옮기는 쪽이 리포의 작업 트리에 폴더를 직접 넣는 것이다(이 도구가 리포 안의 자리를 고르는 것이 아니다). "리포 밖"은 경로의 성질이라 폴더를 붙잡은 뒤에도 폴더가 옮겨지는 것까지 한 번의 호출로 막는 방법은 없다. 부모 경로의 심볼릭 링크가 바뀌는 경우(검사 전, 검사와 여는 것 사이, 연 뒤)는 모두 막는다.
- `run.ts`: `--out`이 있으면 단계 목록을 만들기 전에 `pinOutFile`을 부른다. 걸리면 2로 끝난다. 통과하면 받은 경로가 아니라 **고정한 경로**를 `trial.ts`의 `--out`과 `check-results.ts --file`에 넘긴다.
- `trial.ts`: `--out`이 있으면 인자를 읽은 직후(폴더 안에 무엇을 만들거나 패키지를 설치하기 전)에 `openOutFile`로 결과 파일을 열고, 걸리면 이유를 내고 0이 아닌 종료 코드로 끝난다(넘겨받은 빈 폴더에는 아무것도 만들지 않는다). 실측이 끝나면 결과를 그 디스크립터에 쓰고 닫는다. 실측이 실패하면 결과를 쓰지 않으므로 열어 둔 파일은 빈 채로 남는다(경로로 지우지 않는다. 지우는 것도 경로가 바뀌면 다른 파일을 지울 수 있다). 빈 파일은 `check-results.ts --file`을 통과하지 못한다(JSON이 아니다). 부모 폴더를 만들던 것(`mkdirSync(…, { recursive: true })`)은 `--out`이 없을 때(리포의 `results/`)만 한다. `trial.ts`의 확인 항목과 결과의 내용은 바꾸지 않는다.
- 테스트(`out-file.test.ts`. 임시 폴더는 `mkdtempSync`로 만들고 지우지 않는다. 통과 사례와 아래의 거부 사례는 macOS·Linux에서 본다. Windows에서 볼 것은 다음 항목에 따로 있다): 리포 밖 새 폴더의 새 이름은 통과한다. 거부하는 것: 리포 안의 있는 파일(`package.json`), 리포 안의 새 이름(`lab/q10-db/results/x.json`), 리포 루트 바로 아래의 새 이름, 리포 밖의 있는 파일, 리포 밖 폴더에 있는 심볼릭 링크(리포 안의 파일을 가리키는 것, 끊어진 것), 리포 안의 폴더를 가리키는 심볼릭 링크 폴더 아래의 새 이름, 없는 부모 폴더, 부모가 파일인 경로. 거부한 뒤 대상이 그대로다(있던 파일과 링크가 가리키는 파일의 내용이 같고, 새 파일이 생기지 않았다). macOS·Linux에서는 링크 사례를 건너뛰지 않는다(링크를 만들지 못하면 실패다).
- 테스트(같은 파일. Windows의 거부. 모든 OS에서 돈다): `platform`을 `win32`로 주면 리포 밖의 있는 폴더 아래의 새 이름도 `outFileProblem`·`pinOutFile`·`openOutFile`이 거부하고, 그 경로에 파일이 생기지 않으며 현재 폴더가 그대로다. 실제 Windows에서는(`process.platform === 'win32'`) `platform`을 주지 않아도 같다. 이 사례는 어느 OS에서도 건너뛰지 않는다.
- 테스트(같은 파일. 고정. Windows에서는 건너뛴다): 리포 역할의 임시 폴더와 리포 밖 역할의 임시 폴더를 만들고, 리포 밖 폴더를 가리키는 심볼릭 링크 폴더 아래의 새 이름으로 `openOutFile`을 부른다. 고정한 경로가 링크를 거치지 않는 실제 경로다. 링크를 바꾸는 때를 셋으로 나눠 본다(`openOutFile`이 테스트용으로 받는 함수 `beforeOpen`을 2와 3 사이에 부른다): (가) 2와 3 사이에 링크를 리포 역할의 폴더를 가리키게 바꾼다 — 여는 것이 성공하고 파일은 리포 밖 폴더에 생기며 리포 역할의 폴더에는 아무 항목도 생기지 않는다. (나) 연 뒤에 링크를 바꾸고 디스크립터에 결과를 쓴다 — 결과는 리포 밖 폴더의 파일에 쓰이고 리포 역할의 폴더에는 아무 항목도 생기지 않는다. (다) 부르기 전에 링크가 리포 역할의 폴더를 가리킨다 — 거부하고 리포 역할의 폴더에 아무 항목도 생기지 않는다. 그리고: 2와 3 사이에 붙잡은 폴더 자체를 리포 역할의 폴더 안으로 옮기면(`renameSync`) 실패로 끝나고 결과를 쓰지 않는다(남는 한계가 드러나는 것을 본다). 부른 뒤 현재 폴더(`process.cwd()`)가 부르기 전과 같다(성공, 거부, 실패 모두). `pinOutFile`이 낸 경로로 다시 부르면 같은 경로가 나온다. 이미 있는 이름으로 `openOutFile`을 부르면 실패하고 있던 파일이 그대로다. 디스크립터에 쓰지 않고 닫으면 빈 파일이 남고, 그 파일은 `check-results.ts`의 파일 검사를 통과하지 못한다. `win32`인 척하면(`platform`을 인자로 준다) `pinOutFile`과 `openOutFile`이 거부한다.
- `run.test.ts`에 더한다: `--out`이 검사에 걸리면 2를 내고 `exec`가 한 번도 불리지 않는다(리포 안의 있는 파일, 리포 밖의 있는 파일). 심볼릭 링크 폴더 아래의 경로를 주면 단계의 인자에는 고정한 경로(실제 경로)가 들어간다(이 둘은 macOS·Linux에서 본다). `platform`이 `win32`이면 리포 밖의 유효한 새 경로를 `--out`으로 줘도 2를 내고 `exec`가 한 번도 불리지 않으며 그 경로에 파일이 생기지 않는다(모든 OS에서 본다). 세 가지 단계 목록(기본, `--skip-fmt`, `--out`)의 마지막 단계의 인자에 `check-results.test.ts`와 `out-file.test.ts`가 모두 있다.
- 테스트(`out-file.test.ts`. 두 진입점을 실제 명령으로 부른다. `run.ts`의 마지막 단계가 이 파일을 돌리므로 두 러너에서도 돈다): `node lab/q10-db/run.ts …`와 `node lab/q10-db/trial.ts <새 빈 임시 폴더> …`를 자식 프로세스로 띄운다(`spawnSync`. 시간 제한 30초. 거부는 무엇을 설치하거나 실행하기 전에 끝나므로 넉넉하다. 시간 제한에 걸리면 실패다).
  - 모든 OS: `--out`에 리포 안의 있는 파일(`package.json`)을 준다. `run.ts`는 2, `trial.ts`는 0이 아닌 코드로 끝나고, 그 파일의 내용이 그대로이며, `trial.ts`에 넘긴 폴더가 비어 있다. (Windows에서는 "Windows에서는 받지 않는다"로, 다른 OS에서는 경로 검사로 거부된다. 어느 쪽이든 결과는 같다.)
  - macOS·Linux에서만: 리포 안의 폴더를 가리키는 심볼릭 링크 폴더(리포 밖의 임시 폴더에 만든다) 아래의 새 이름을 준다. 두 진입점이 거부하고, 링크가 가리키는 리포 안의 폴더에 그 이름의 항목이 생기지 않으며, `trial.ts`에 넘긴 폴더가 비어 있다.
  - Windows에서만(`process.platform === 'win32'`. 러너의 Windows job에서 돈다): `--out`에 **리포 밖의 있는 폴더 아래의 새 이름**(다른 OS라면 받는 경로)을 준다. `run.ts`는 2, `trial.ts`는 0이 아닌 코드로 끝나고, 표준 오류에 Windows에서는 `--out`을 받지 않는다는 글이 있으며, 그 경로에 파일이 생기지 않고, `trial.ts`에 넘긴 폴더가 비어 있다.
  - OS에 따라 돌지 않는 사례는 건너뜀으로 표시한다(`skip`. 이름에 OS를 적는다). step1이 러너의 로그에서 "Linux에서는 macOS·Linux 사례가, Windows에서는 Windows 사례가 건너뛰어지지 않고 통과했다"를 확인한다.

`--out`의 검사를 어디서 보는가(진입점마다, OS마다. 빈칸이 없어야 한다):

| 진입점                                               | macOS(이 step의 AC)                                                            | Linux(러너, step1에서 확인)                                                 | Windows(러너, step1에서 확인)                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 함수 셋(`outFileProblem`·`pinOutFile`·`openOutFile`) | 통과·거부·링크를 바꾸는 사례, `win32`를 준 거부 사례                           | 왼쪽과 같다                                                                 | `win32`를 준 거부 사례와 `platform`을 주지 않은 거부 사례(통과·링크 사례는 건너뛴다. `--out`을 받지 않는 OS다) |
| `run.ts`(명령)                                       | 있는 파일 거부, 링크 거부, `--out`으로 돌리는 실측의 성공(AC 다섯째 줄)        | 있는 파일 거부, 링크 거부                                                   | 있는 파일 거부, **유효한 새 경로 거부**                                                                        |
| `run.ts`(단계 목록. `run.test.ts`)                   | 거부하면 `exec`를 부르지 않는다, 고정한 경로를 넘긴다, `win32`를 주면 거부한다 | 돌지 않는다(러너는 `run.test.ts`를 돌리지 않는다. 위 줄의 명령 사례가 본다) | 왼쪽과 같다                                                                                                    |
| `trial.ts`(명령)                                     | 있는 파일 거부, 링크 거부, 성공은 `run.ts`의 실측이 `trial.ts`를 불러서 본다   | 있는 파일 거부, 링크 거부                                                   | 있는 파일 거부, **유효한 새 경로 거부**                                                                        |

- 표에서 보지 않는 것(적어 둔다): Linux에서 `--out`으로 돌리는 **실측의 성공**은 명령으로 돌려 보지 않는다(러너의 실측은 `--out`을 쓰지 않고, 패키지 설치가 드는 실측을 한 번 더 돌리지 않는다). Linux에서는 함수의 통과 사례(여는 것, 디스크립터에 쓰는 것)까지만 본다.

### 2. `lab/q10-db/README.md`

- "절차" 절의 셸 블록 둘(Bash, PowerShell)을 명령 하나로 바꾼다: `node lab/q10-db/run.ts`. 실패하면 그 자리에서 멈춘다는 것, `trial.ts`가 실패하면 결과 파일을 새로 쓰지 않는다는 것은 남긴다. "PowerShell 절차는 아직 Windows에서 돌려 보지 않았다" 줄은 지운다(그 블록이 없어진다).
- 작업 트리를 바꾸지 않고 돌려 보는 법을 `node lab/q10-db/run.ts --out <리포 밖 파일>`로 고친다. 파일은 리포 밖의 있는 폴더 아래의 새 이름이어야 한다는 것(리포 안의 경로와 이미 있는 파일은 실행하기 전에 거부한다)과, `--out`으로 돌린 실측이 실패하면 그 이름의 빈 파일이 남는다는 것, `--out`은 macOS와 Linux에서만 받는다는 것을 적는다.
- "CI 러너에서 돌리기" 항목을 더한다: 워크플로 `q10-trial`을 손으로 돌린다(`gh workflow run q10-trial.yml --ref main`), 실행 산출물(`q10-result-<os>`)을 받는다(`gh run download <실행 번호> --dir <새 임시 폴더>`), 받은 폴더의 `<platform>-<arch>.json`을 `lab/q10-db/results/`에 복사하고 `node scripts/harness.ts fmt`와 `node lab/q10-db/check-results.ts <이름>`을 돌린다. 러너에서는 포맷을 건너뛴다는 것과 이유(하네스의 의존성을 설치하지 않는다)를 적는다. 러너에서도 마지막 단계가 검사 스크립트와 `--out` 경로 검사의 테스트를 돌린다는 것(Linux에서는 링크를 바꾸는 사례, Windows에서는 `--out`을 거부하는 사례)을 적는다. 받은 파일의 내용을 손으로 고치지 않는다.
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
- 이 AC는 macOS나 Linux에서 돌린다(이 step은 Mac에서 실행한다). 다섯째 줄(`--out`으로 돌리는 실측)과 끝의 두 줄은 `--out`을 받는 OS의 기준이다. Windows의 기준은 "`--out`을 거부하고 자식 프로세스를 띄우지 않으며 파일을 만들지 않는다"이고, `platform`에 `win32`를 준 사례(`out-file.test.ts`, `run.test.ts`. 어느 OS에서든 돈다)와 실제 Windows에서 두 진입점을 명령으로 부르는 사례(`out-file.test.ts`. 러너의 Windows job에서 돈다)가 본다. 뒤의 것은 이 step의 AC로는 돌지 않고(Mac에서는 건너뜀으로 표시된다) step1이 러너의 로그로 확인한다. 진입점마다 OS마다 무엇을 어디서 보는지는 "작업"의 표에 있다.
- Linux와 Windows에서의 실행: `out-file.test.ts`는 `run.ts`의 마지막 단계로 돌므로, 워크플로 `q10-trial`의 두 러너에서 돈다(Linux에서 링크를 바꾸는 사례, Windows에서 거부 사례). 워크플로는 이 step이 병합된 뒤 step1에서 돌린다. step1이 두 job의 로그에서 그 테스트가 돌았고 실패가 없는 것을 확인한다(step1의 "실측").

## 금지사항

- 워크플로 파일을 봇이 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없고, 워크플로는 제작자가 올린다(SECURITY.md). 봇은 패치만 준비한다.
- 구조 테스트와 완료 처리를 제작자의 워크플로 커밋보다 먼저 올리지 마라. 이유: 구조 테스트가 먼저 올라가면 테스트만 있는 head가 실패한 채 판정을 기다리고, 완료 처리가 먼저 올라가면 워크플로가 빠진 head가 `check`와 `plan-gate`를 통과해 워크플로 없이 병합될 수 있다(SECURITY.md의 순서). 초안 PR은 계획 검증 때문에 먼저 열려 있다.
- 워크플로에 비밀, environment, 캐시, 쓰기 권한, PR·push 트리거를 넣지 마라. 이유: 패키지를 설치해 코드를 실행하는 워크플로다. 손으로 돌리는 읽기 전용 실행으로 둔다(10.4절).
- `lab/q10-db/check-results.ts`의 기대값·판정 기준과 `trial.ts`의 확인 항목을 느슨하게 바꾸지 마라. 이유: 확정 조건의 판정이다. 실측에서 어긋난 점이 나오면 원인을 고친다.
- `lab/q10-db/results/`에 결과 파일을 더하거나 고치지 마라. 이유: 결과는 step1에서, 워크플로의 산출물로만 더한다.
- 다른 워크플로 파일, `harness.config.json`, 설계서를 고치지 마라. 이유: 이 step의 범위가 아니다.
