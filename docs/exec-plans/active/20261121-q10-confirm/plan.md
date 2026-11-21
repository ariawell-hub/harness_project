---
id: 20261121-q10-confirm
issue: 180 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T23:14:31+09:00 # new-task가 채운다
---

# Q10 확정: Windows 네이티브와 Linux에서 lab/q10-db 실측을 더해 ADR-0007을 채택으로 바꾼다

## 목표와 수용 기준

Q10(DB·ORM)의 판단 기준은 "여러 PC와 다양한 개발 환경에 영향이 없으면 PostgreSQL + Drizzle, 아니면 DB 없이 시작"이다(제작자 대화 지시, 2026-11-20). Issue #166이 macOS에서 재어 잠정으로 정했다(ADR-0007). 확정 조건은 `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0인 것, 곧 macOS·Windows 네이티브·Linux 세 환경의 결과 파일이 모두 검사를 통과하는 것이다. 지금은 macOS 결과뿐이다.

이 세션이 쓸 수 있는 머신은 Mac 하나이고 컨테이너 런타임이 없다. 제작자가 Linux 실측을 CI 러너에서 한 번 돌리기로 정했다(2026-11-21, Issue #180의 댓글). 이 계획은 실물 확인을 CI 러너에서 손으로 돌리는 워크플로를 더하고(step0), 그 결과로 확정한다(step1).

수용 기준:

1. 실물 확인의 절차가 OS와 무관한 명령 하나다: `node lab/q10-db/run.ts`. 실행, 포맷, 결과 검사, 검사 스크립트의 테스트를 차례로 돌리고, 하나가 실패하면 그 자리에서 멈추고 0이 아닌 종료 코드로 끝난다(뒤 단계를 돌리지 않는다. 테스트가 본다). `--skip-fmt`는 포맷 단계를 뺀다(하네스의 의존성을 설치하지 않은 CI 러너용). `--out <파일>`은 결과를 리포 밖에 쓰고 그 파일을 검사한다(작업 트리를 바꾸지 않는다). `--out`의 경로가 리포 안을 가리키거나(심볼릭 링크를 거친 것 포함) 이미 있는 항목이면 `run.ts`와 `trial.ts`가 아무것도 실행하기 전에 거부한다. 있는 파일을 덮어쓰지 않는다. 검사한 폴더와 여는 폴더를 같게 하고(부모 폴더에 들어간 뒤 그 폴더를 검사하고 파일 이름만으로 연다) 연 파일 디스크립터에 쓴다. 부모 경로의 심볼릭 링크가 리포 안을 가리키게 바뀌어도(검사 전, 검사와 여는 것 사이, 연 뒤) 리포 안에 파일이 생기지 않는다(테스트와 AC가 본다). `--out`은 macOS와 Linux에서만 받는다(Windows에서는 거부한다. CI와 기본 절차는 `--out`을 쓰지 않는다).
2. 워크플로 `.github/workflows/q10-trial.yml`이 있다. 손으로만 실행되고(`workflow_dispatch`), `ubuntu-latest`와 `windows-latest`에서 `node lab/q10-db/run.ts --skip-fmt`를 돌려 `lab/q10-db/results/`를 실행 산출물로 올린다. 비밀·environment·캐시를 쓰지 않고, 권한은 `contents: read`뿐이며, 액션은 커밋 SHA로 고정한다. 구조를 단언하는 테스트가 `check`에 든다(워크플로 파일이 없거나 다르면 실패한다). 워크플로 파일의 내용은 리포의 패치(`lab/q10-db/q10-trial-workflow.patch`)와 같다(테스트가 본다).
3. `lab/q10-db/results/`에 `linux-<arch>.json`과 `win32-<arch>.json`이 있다. 둘 다 워크플로의 실행 산출물이고(실행 주소를 README의 "잰 머신" 표에 적는다. `node lab/q10-db/verify-artifacts.ts`가 그 실행이 `main`의 `q10-trial` 실행이고 두 OS의 job이 성공했으며 그 산출물의 결과가 커밋한 결과 파일과 값으로 같은 것을 확인한다), 각각 `node lab/q10-db/check-results.ts <이름>`을 통과한다. `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0이다.
4. ADR-0007의 상태가 채택이고, 세 환경의 실측(어디서 쟀는지 포함)과 남은 한계(Windows는 CI 러너에서 쟀다. 제작자의 Windows PC에서는 TD-14의 실기 검증 때 다시 돌린다)가 적혀 있다. 설계서 18절의 Q10 행과 19절 "현재 위치"가 확정으로 적혀 있다. 기술 부채 표 TD-14의 `lab/q10-db` 항목이 결과에 맞게 고쳐져 있다. `profiles/web/README.md`의 "잠정" 문구가 확정에 맞게 고쳐져 있다. 이 문서들과 ADR 목록(`docs/decisions/index.md`), `lab/q10-db/README.md`가 같은 확정 상태를 말하는지 테스트(`lab/q10-db/test/confirmed.test.ts`)가 본다.
5. 어느 환경에서든 실측이 통과하지 못하면 확정하지 않는다. 그때 step1은 결과 파일을 더하지 않고 멈춰 원인을 진행 로그에 적고 제작자에게 묻는다(제작자의 기준대로 "DB 없이 시작"으로 되돌릴지).
6. `node scripts/harness.ts check` 통과. 14.3절의 규칙은 바꾸지 않는다.

## 범위 / 비범위

범위:

- `lab/q10-db/run.ts`(새 파일)와 그 테스트, `lab/q10-db/README.md`(절차를 명령 하나로, CI에서 돌리는 법, "잰 머신" 표), 워크플로 패치 `lab/q10-db/q10-trial-workflow.patch`.
- `--out` 경로 검사 `lab/q10-db/out-file.ts`(새 파일)와 그 테스트, `lab/q10-db/trial.ts`의 `--out` 처리(경로 검사, 새 파일로만 쓰기).
- `.github/workflows/q10-trial.yml`(새 파일. 제작자가 올린다. `docs/SECURITY.md`의 "워크플로 변경 절차").
- 워크플로의 구조를 단언하는 테스트 `scripts/test/q10-trial-workflow.test.ts`(새 파일).
- 결과 파일 `lab/q10-db/results/linux-<arch>.json`, `lab/q10-db/results/win32-<arch>.json`.
- 결과 파일의 출처 확인 `lab/q10-db/verify-artifacts.ts`(새 파일)와 그 테스트, 확정 상태의 테스트 `lab/q10-db/test/confirmed.test.ts`(새 파일).
- ADR-0007, 설계서 18절 Q10 행·19절 "현재 위치"·0절 버전 이력, `docs/harness/CHANGELOG.md`, 기술 부채 표의 TD-14 행, `profiles/web/README.md`의 DB 절 첫 문단.

비범위:

- 제작자의 Windows PC에서의 실측과 TD-14의 다른 실기 검증 항목(훅의 차단 동작 등). 이유: 그 PC의 세션이 해야 한다. CI의 Windows 러너도 네이티브 Windows이므로 확정 조건(`win32-*` 결과)은 러너의 결과로 채우고, PC에서의 재실측은 TD-14에 남긴다.
- 하네스 스크립트 자체를 Windows·macOS 러너에서 돌리는 CI 행렬(TD-15). 이유: 이 워크플로는 `lab/q10-db`의 실물 확인만 돌린다.
- 워크플로를 PR이나 push에 자동으로 돌리는 것. 이유: 실측은 패키지 버전이나 설치 정책을 바꿀 때만 다시 재면 되고, 자동 실행은 Actions 사용량을 늘린다(Issue #170).
- 일회용 DB를 표준 명령에 잇는 일(TD-12), 웹 프로파일의 차단 목록(Issue #166에서 끝났다), `lab/q10-db/trial.ts`와 `check-results.ts`의 판정 기준.
- 다른 워크플로 파일.

## 관련 파일·문서

- `lab/q10-db/run.ts`, `lab/q10-db/test/run.test.ts`, `lab/q10-db/README.md`, `lab/q10-db/q10-trial-workflow.patch`, `lab/q10-db/results/**`
- `lab/q10-db/out-file.ts`, `lab/q10-db/test/out-file.test.ts`
- `lab/q10-db/verify-artifacts.ts`, `lab/q10-db/test/verify-artifacts.test.ts`, `lab/q10-db/test/confirmed.test.ts`
- `lab/q10-db/trial.ts`(`--out`의 경로 검사와 새 파일로만 쓰기. 그 밖에는 실측에서 어긋난 점이 나오면 고친다. 확인 항목과 판정 기준은 바꾸지 않는다), `lab/q10-db/check-results.ts`(실측에서 어긋난 점이 나오면 고친다. 판정 기준은 바꾸지 않는다)
- `docs/decisions/index.md`, `lab/q10-db/README.md`(확정 상태의 문구)
- `.github/workflows/q10-trial.yml`
- `scripts/test/q10-trial-workflow.test.ts`
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `docs/decisions/index.md`(상태를 적는 칸이 있으면)
- `docs/harness/design.md`(0절 버전 이력, 18절 Q10 행, 19절 "현재 위치"), `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`(TD-14 행)
- `profiles/web/README.md`
- `docs/exec-plans/active/20261121-q10-confirm/**`

## step 목록

- step0 ci-trial: 실물 확인의 절차를 명령 하나(`lab/q10-db/run.ts`)로 만들고, CI 러너(Linux, Windows)에서 손으로 돌리는 워크플로를 워크플로 변경 절차로 더한다.
- step1 confirm: 워크플로를 돌려 받은 두 결과 파일을 더하고, 확정 조건이 채워지면 ADR-0007·설계서·기술 부채 표·웹 프로파일 README를 확정으로 고친다.

## 진행 로그

- 2026-11-21 접수: Issue #166의 계획이 끝났다(PR #169 병합). 그 계획의 "다음 할 일"대로 Issue #180을 등록했다. 이 Mac에 컨테이너 런타임이 없는 것을 확인했다(`docker`·`podman`·`colima`·`limactl` 등 없음). 제작자에게 Linux 실측을 돌릴 곳을 물었고 "CI 러너에서 한 번 돌린다"는 답을 받았다(Issue #180의 댓글에 남겼다). `new-task`로 시작했다.
- 2026-11-21 사전 확인: `actions/upload-artifact`의 최신 릴리스는 v7.0.2(2026-10-07 게시, 커밋 `cf430e030ddbb5b0abf93d22962f4752f3646cd9`)다. `gh api`로 조회했다. `lab/q10-db/trial.ts`는 Windows에서 `pnpm`을 셸을 거쳐 부르게 돼 있다(이미 고려돼 있다. 돌려 본 적은 없다).
- 2026-11-21 step0 (가) `run.ts`: 테스트를 먼저 썼다. `node --test lab/q10-db/test/run.test.ts`가 `run.ts`가 없어 실패했다(`ERR_MODULE_NOT_FOUND`, 통과 0). 구현 뒤 8건 통과. `node lab/q10-db/run.ts --out <리포 밖 파일>`을 이 Mac에서 돌렸다: 실행 → 결과 검사 → 검사 스크립트의 테스트(75건)가 차례로 통과했고 종료 코드 0, 리포의 `results/`는 바뀌지 않았다. `--bogus`는 사용법을 내고 종료 코드 2다.
- 2026-11-21 step0 (가) 워크플로 패치와 구조 테스트: 워크플로 초안을 포매터에 넣어 바뀌는 곳이 없는 것을 확인하고, 임시 인덱스로 패치(`lab/q10-db/q10-trial-workflow.patch`)를 만들었다. 구조 테스트(`scripts/test/q10-trial-workflow.test.ts`, 5건)를 써서 워크플로 파일이 없는 지금은 5건 모두 실패하고, 패치를 로컬에 적용하면 5건 모두 통과하는 것을 확인했다. 그 뒤 로컬 적용을 되돌렸다(`git apply --reverse`). 구조 테스트는 아직 올리지 않는다(리포 밖에 두었다). PR도 열지 않는다. 기준 커밋의 SHA는 이 커밋을 올린 뒤 Issue #180의 요청 댓글과 다음 커밋의 진행 로그에 적는다.
- 2026-11-22 절차 실수와 다시 시작: 위의 (가)는 계획 검증을 받지 않는 계획의 순서였다. 이 계획은 중규모라 계획만 담은 초안 PR로 계획 검증(G1)을 먼저 받아야 하는데, PR 없이 계획과 코드(`run.ts`, 테스트, README, 패치)를 브랜치 `feat/20261121-q10-confirm-s0`에 함께 올리고(커밋 `887ca3a`) 제작자에게 워크플로 커밋을 요청했다. 제작자가 워크플로 커밋(`6fbdaa2`)을 올렸고, 트리 비교는 "같다"였다(기준 `887ca3a`의 트리에 패치를 적용한 것과 받은 head의 트리가 같다). 그런데 계획 검증은 PR의 변경이 계획 폴더뿐인 head의 판정으로만 남고, 봇은 워크플로 파일을 지우는 커밋을 올릴 수 없어 그 브랜치를 계획만 남긴 상태로 되돌릴 수 없다. 그 브랜치로는 `plan-gate`의 G1을 통과할 수 없다.
- 2026-11-22 제작자에게 물었다(선택지: 새 브랜치로 다시 / 같은 브랜치에서 제작자가 워크플로를 지우고 다시 올린다 / 보류). 답: "새 브랜치로 다시". main에서 새 브랜치 `chore/20261121-q10-confirm-s0`을 만들고 계획 폴더만 옮겼다(`git worktree add -b`. 같은 계획·같은 step이라 접두어만 다르게 했다. 계획의 `type`도 맞췄다). 순서를 SECURITY.md의 계획 검증을 받는 계획의 순서로 고쳤다(step0의 "작업" 첫머리와 "금지사항"). 옛 브랜치는 쓰지 않고 그대로 둔다(PR을 연 적이 없다). 옛 브랜치의 `run.ts`·테스트·README·패치는 계획 검증 승인 뒤 그대로 가져온다(`git restore --source 887ca3a`). 제작자의 워크플로 커밋은 새 브랜치에 한 번 더 필요하다.
- 2026-11-22 계획 검증 1회차(PR #188): Claude 승인(지적 없음), Codex 수정 요청(P0 하나, P1 둘, P2 하나). 넷 다 맞는 지적이라 계획을 고쳤다.
  - F1(P0): step0이 "`--out`의 파일이 리포 밖인지는 `trial.ts`가 검사한다"고 전제했는데, `trial.ts`는 실험 폴더만 검사하고 `--out`의 경로는 그대로 쓴다(코드를 다시 읽어 확인했다). `--out package.json`이면 작업 트리의 파일을 결과로 덮어쓴다. → 경로 검사(`lab/q10-db/out-file.ts`)를 step0의 작업·범위·관련 파일에 넣었다. 리포 안의 경로(심볼릭 링크를 거친 것 포함)와 이미 있는 항목을 `run.ts`와 `trial.ts`가 실행 전에 거부하고, `trial.ts`는 새 파일로만 쓴다. 거부할 때 자식 프로세스가 뜨지 않고 대상이 그대로인지 보는 테스트와 AC 세 줄을 더했다.
  - F2(P1): step1의 검사는 결과 파일의 내용과 README에 실행 주소가 있는지만 봐서, 다른 실행의 파일을 넣어도 통과한다. → 출처 확인 명령(`lab/q10-db/verify-artifacts.ts`)과 테스트를 step1에 넣었다. README가 가리키는 실행이 `main`의 `q10-trial`이고 두 OS의 job이 성공했는지, 그 산출물의 결과가 커밋한 파일과 값으로 같은지(JSON으로 읽어 견준다. 포맷 차이는 빠진다) 본다. 출력은 진행 로그와 PR 본문에 옮긴다.
  - F3(P1): ADR의 상태 줄만 고치고 설계서·웹 프로파일 README에 잠정 상태를 남겨도 통과한다. → 확정 상태의 테스트(`confirmed.test.ts`)에 ADR의 확정 조건·알려진 한계, ADR 목록, 설계서 18·19절, TD-14 행, 웹 프로파일 README, `lab/q10-db/README.md`의 단언을 더했다.
  - F4(P2): `lab/q10-db/test/confirmed.test.ts`가 관련 파일 목록에 없었다. → 더했다(새로 생긴 파일들과 함께).
- 2026-11-22 계획 검증 2회차: Claude 승인(지적 없음), Codex 수정 요청(P1 하나). F1~F3은 닫혔다. F5(P1): 검사한 뒤 실측이 끝날 때까지(패키지 설치로 몇 분) 부모 경로의 심볼릭 링크가 리포 안을 가리키게 바뀌면, 끝에 경로로 여는 `wx` 쓰기가 리포 안에 새 파일을 만든다. 맞는 지적이다. → 검사한 대상과 쓰는 대상을 고정한다: 부모의 실제 경로로 고정한 경로를 만들고(`pinOutFile`), `trial.ts`가 설치 전에 그 경로를 새 파일로 열어 두었다가(`openOutFile`) 끝에 그 디스크립터에 쓴다. `run.ts`는 고정한 경로를 뒤 단계에 넘긴다. 링크를 바꾼 뒤에 써도 리포 역할의 폴더에 아무것도 생기지 않는 테스트를 더했다. 남는 한계(검사와 여는 것 사이의 한순간)는 step0에 적었다.
- 2026-11-22 계획 검증 3회차: Claude 승인, Codex 수정 요청(새 지적 없음. F5가 남았다). F5: 고친 계획은 경로를 검사한 뒤 그 경로로 열어, 그 사이에 부모가 리포 안을 가리키게 바뀌면 리포 안에 빈 파일이 남는다. 테스트도 연 뒤에 링크를 바꾸는 경우만 본다. 맞는 지적이다. → 여는 법을 바꿨다: 부모 폴더에 먼저 들어가(`process.chdir`) 붙잡은 그 폴더를 검사하고 파일 이름만으로 연다. 검사한 폴더와 여는 폴더가 같으므로 링크가 언제 바뀌어도 리포 안에 파일이 생기지 않는다. 테스트에 "검사와 여는 것 사이에 링크를 바꾼다"를 넣었다(테스트용 함수 `beforeOpen`). 이 방식이 기대는 것을 Windows에서는 확인하지 못해 `--out`을 macOS와 Linux에서만 받는다(검증자가 제안한 대안: 보장하기 어려운 곳은 지원 범위에서 뺀다). 남는 한계는 붙잡은 폴더 자체가 리포 안으로 옮겨지는 경우 하나이고 step0에 적었다.
  - 전제를 이 Mac(macOS, Node 22)에서 임시 폴더로 확인했다(리포는 건드리지 않는다): 심볼릭 링크 폴더로 들어가면 `process.cwd()`가 링크를 따라간 실제 경로를 낸다. 들어간 뒤 링크를 다른 폴더를 가리키게 바꾸고 파일 이름만으로 `wx`로 열면 파일은 처음 들어간 폴더에 생기고 바뀐 쪽에는 아무것도 생기지 않는다. 붙잡은 폴더 자체를 다른 곳으로 옮기면 `process.cwd()`의 글은 그대로이고(Node가 기억해 둔 값), `statSync('.')`와 `statSync(기억한 경로)`를 견주면 드러난다(경로가 없어 `ENOENT`, 같은 이름의 새 폴더가 생겼으면 `ino`가 다르다). 그래서 연 뒤의 확인은 경로를 다시 읽는 것이 아니라 폴더의 정체를 견주는 것으로 적었다. Linux에서는 CI의 테스트(`out-file.test.ts`)가 같은 것을 본다.

## 의사결정 로그

- 결정: 절차를 셸 블록 둘(Bash, PowerShell)에서 명령 하나(`node lab/q10-db/run.ts`)로 바꾼다. / 이유: PowerShell 블록은 Windows에서 돌려 본 적이 없고, 워크플로에 셸 절차를 그대로 넣으면 절차가 어긋날 때마다 제작자가 워크플로를 다시 올려야 한다. 스크립트로 두면 봇이 고칠 수 있고 세 OS가 같은 코드를 돈다. "앞 단계가 실패하면 멈춘다"도 코드와 테스트로 보장한다. / 버린 대안: 워크플로에 두 셸 절차를 넣기.
- 결정: CI에서는 포맷 단계를 뺀다(`--skip-fmt`). 받은 결과 파일은 리포에 넣을 때 `node scripts/harness.ts fmt`로 포맷한다. / 이유: 포맷은 하네스의 의존성 설치(`setup`)가 필요한데, 하네스 스크립트는 Windows 러너에서 돌려 본 적이 없다(TD-14, TD-15). 실물 확인이 하네스의 Windows 지원에 걸리지 않게 한다. 포맷은 도구가 하는 일이라 "결과 파일을 손으로 고치지 않는다"에 어긋나지 않는다. / 버린 대안: 러너에서 `setup`과 포맷까지 돌리기.
- 결정: Windows 네이티브의 결과는 CI의 `windows-latest` 러너에서 얻는다. / 이유: 러너는 WSL이 아닌 네이티브 Windows이고, 확정 조건이 묻는 것(패키지가 네이티브 바이너리·설치 스크립트 없이 설치되고 도는가)을 잰다. Linux와 같은 실행으로 함께 얻는다. 제작자의 PC와 다른 점(경로, 사용자 이름, 보안 프로그램)은 재지 못하므로 ADR에 적고 PC에서의 재실측을 TD-14에 남긴다. 제작자에게는 워크플로 커밋을 요청할 때 함께 알린다. / 버린 대안: Windows PC의 세션을 기다리기(확정이 그 세션에 묶인다).
- 결정: 워크플로는 손으로만 돈다(`workflow_dispatch`). / 이유: 다시 잴 때는 패키지 버전·pnpm 고정 버전·설치 정책을 바꿀 때뿐이다. PR마다 돌리면 사용량이 는다(Issue #170). / 버린 대안: `lab/q10-db/**`를 바꾼 PR에서 자동으로 돌리기(병합 전에 결과를 볼 수 있지만 PR 코드를 실행하는 워크플로가 하나 는다).
- 결정: step을 둘로 나눈다. / 이유: 손으로 도는 워크플로는 기본 브랜치에 있어야 실행할 수 있다. 워크플로가 병합된 뒤에 돌려 결과를 받는다.
- 결정: 위험도 high. / 이유: 워크플로(보호 경로)를 더하고 DB·마이그레이션 도구 결정을 확정한다.
- 결정: 다시 시작하는 브랜치의 접두어를 `chore`로 한다. / 이유: 브랜치 이름은 `<type>/<계획 id>-s<step>`이고 같은 이름의 원격 브랜치를 다른 커밋으로 다시 만들 수 없다(지우고 다시 만드는 것은 force push와 같다). 게이트는 접두어가 아니라 계획 id와 step 번호로 계획을 찾는다. 추가하는 것이 CI 워크플로와 실험 폴더의 실행 스크립트라 `chore`가 맞다. / 버린 대안: 옛 브랜치에서 제작자가 워크플로를 지우고 다시 올리기(제작자 작업 2회).
- 결정: `--out`의 결과 파일을 실측 전에 열어 둔다. / 이유: 검사한 대상에 쓰려면 경로가 아니라 연 파일에 써야 한다(Node에는 폴더를 기준으로 여는 방법이 없다). / 대가: `--out`으로 돌린 실측이 실패하면 빈 파일이 남는다. 경로로 지우면 같은 문제가 생기므로 지우지 않는다. 빈 파일은 결과 검사를 통과하지 못한다. 결과를 리포의 `results/`에 쓰는 기본 경로는 전과 같다(실패하면 쓰지 않는다). / 버린 대안: 끝에 한 번 더 검사하고 경로로 쓴다(검사와 쓰기 사이의 틈이 남는다), 심볼릭 링크가 든 경로를 모두 거부한다(macOS의 임시 폴더 경로가 심볼릭 링크를 거쳐 `mktemp -d`의 폴더를 쓸 수 없다).

## 발견 사항

- 이 리포에는 워크플로의 실행 산출물을 올리는 액션을 쓰는 곳이 없었다. 새 액션(`actions/upload-artifact`)을 커밋 SHA로 고정해 쓴다. → 처리: 해당 없음(step0의 워크플로와 구조 테스트에 반영한다)
- 계획 검증을 받는 계획인데 계획 검증 없이 코드를 브랜치에 올리고 제작자 작업을 요청했다(봇의 절차 실수). 워크플로 파일이 든 브랜치는 봇이 계획만 남긴 상태로 되돌릴 수 없어 새 브랜치로 다시 시작했고, 제작자의 워크플로 커밋이 한 번 더 필요해졌다. `new-task`나 `start`가 "중·대 규모 계획은 계획만 담은 초안 PR부터"를 알려 주지만, PR을 열지 않고 push만 한 브랜치는 어떤 검사도 보지 않는다. → 처리: 해당 없음(제작자에게 보고한다)

## 열린 질문

없음.

제작자에게 알릴 것(질문이 아니다): step0은 제작자가 봇의 브랜치에 워크플로 파일을 올려야 이어진다(Issue #180에 요청을 남긴다). Windows의 결과는 CI의 Windows 러너에서 얻는다(위 의사결정 로그).

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- 수용 기준 1: `node --test lab/q10-db/test/run.test.ts`와 `node --test lab/q10-db/test/out-file.test.ts`, `node lab/q10-db/run.ts --out <리포 밖 파일>`을 실제로 돌린 결과, 작업 트리의 있는 파일을 `--out`으로 주면 거부되고 그 파일이 그대로인 것(step0 AC).
- 수용 기준 2: `node --test scripts/test/q10-trial-workflow.test.ts`, 받은 브랜치의 트리가 기준 커밋에 패치를 적용한 트리와 같은지(SECURITY.md의 비교 명령, 진행 로그에 적는다).
- 수용 기준 3: `node lab/q10-db/check-results.ts <이름>` 둘과 `--confirm`, 출처 확인 `node lab/q10-db/verify-artifacts.ts`(step1 AC. 출력을 진행 로그와 PR 본문에 옮긴다).
- 수용 기준 4: 문서를 설정·결과 파일과 견주는 테스트(`lab/q10-db/test/confirmed.test.ts`: ADR의 상태·확정 조건·알려진 한계, ADR 목록, 설계서 18·19절, TD-14 행, 웹 프로파일 README, `lab/q10-db/README.md`)와 `doc-lint`(step1 AC).
- 결과는 step을 진행하며 적는다.

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 `run.ts`와 테스트, README, 워크플로 패치, CHANGELOG 줄을 올려 구현 판정을 받는다(구조 테스트와 완료 처리는 아직 올리지 않는다).
3. 판정이 끝나면 Issue #180에 제작자 작업(워크플로 커밋)을 요청한다. 커밋이 오면 트리를 비교하고 구조 테스트와 완료 처리를 올린다.
4. step0이 병합되면 `new-task --plan 20261121-q10-confirm --step 1`로 step1을 잇는다.
