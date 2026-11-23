---
id: 20261121-q10-confirm
issue: 180 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T23:14:31+09:00 # new-task가 채운다
---

# Q10 확정: Windows 네이티브와 Linux에서 lab/q10-db 실측을 더해 ADR-0007을 채택으로 바꾼다

## 목표와 수용 기준

Q10(DB·ORM)의 판단 기준은 "여러 PC와 다양한 개발 환경에 영향이 없으면 PostgreSQL + Drizzle, 아니면 DB 없이 시작"이다(제작자 대화 지시, 2026-11-20). Issue #166이 macOS에서 재어 잠정으로 정했다(ADR-0007). 확정 조건은 `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0인 것, 곧 macOS·Windows 네이티브·Linux 세 환경의 결과 파일이 모두 검사를 통과하는 것이다. 지금은 macOS 결과뿐이다.

이 세션이 쓸 수 있는 머신은 Mac 하나이고 컨테이너 런타임이 없다. 제작자가 Linux 실측을 CI 러너에서 한 번 돌리기로 정했다(2026-11-21, Issue #180의 댓글). 이 계획은 실물 확인을 CI 러너에서 손으로 돌리는 워크플로를 더하고(step0), 그 결과로 확정한다(step1).

수용 기준:

1. 실물 확인의 절차가 OS와 무관한 명령 하나다: `node lab/q10-db/run.ts`. 실행, 포맷, 결과 검사, 검사 스크립트의 테스트를 차례로 돌리고, 하나가 실패하면 그 자리에서 멈추고 0이 아닌 종료 코드로 끝난다(뒤 단계를 돌리지 않는다. 테스트가 본다). `--skip-fmt`는 포맷 단계를 뺀다(하네스의 의존성을 설치하지 않은 CI 러너용). 결과를 쓰는 곳은 `lab/q10-db/results/<platform>-<arch>.json` 하나다: 결과를 다른 경로에 쓰는 옵션(`trial.ts`의 `--out`)은 없앤다(`run.ts`와 `trial.ts`가 `--out`을 받지 않는다. 테스트와 AC가 본다).
2. 워크플로 `.github/workflows/q10-trial.yml`이 있다. 손으로만 실행되고(`workflow_dispatch`), `ubuntu-latest`와 `windows-latest`에서 `node lab/q10-db/run.ts --skip-fmt`를 돌려 `lab/q10-db/results/`를 실행 산출물로 올린다. 비밀·environment·캐시를 쓰지 않고, 권한은 `contents: read`뿐이며, 액션은 커밋 SHA로 고정한다. 구조를 단언하는 테스트가 `check`에 든다(워크플로 파일이 없거나 다르면 실패한다). 워크플로 파일의 내용은 리포의 패치(`lab/q10-db/q10-trial-workflow.patch`)와 같다(테스트가 본다).
3. `lab/q10-db/results/`에 `linux-<arch>.json`과 `win32-<arch>.json`이 있다. 둘 다 워크플로의 실행 산출물이고(실행 주소를 README의 "잰 머신" 표에 적는다. `node lab/q10-db/verify-artifacts.ts`가 그 실행이 `main`의 `q10-trial` 실행이고 두 OS의 job이 성공했으며 그 산출물의 결과가 커밋한 결과 파일과 값으로 같은 것을 확인한다), 각각 `node lab/q10-db/check-results.ts <이름>`을 통과한다. `node lab/q10-db/check-results.ts --confirm`이 종료 코드 0이다.
4. ADR-0007의 상태가 채택이고, 세 환경의 실측(어디서 쟀는지 포함)과 남은 한계(Windows의 확정 근거는 CI 러너의 산출물이다. 제작자의 Windows PC에서는 2026-11-23에 절차가 통과했으나 결과 파일을 남기지 않아 확정 근거로 쓰지 않는다)가 적혀 있다. 설계서 18절의 Q10 행과 19절 "현재 위치"가 확정으로 적혀 있다. 기술 부채 표 TD-14 행에서 `lab/q10-db` 항목이 빠져 있다(끝났다). `profiles/web/README.md`의 "잠정" 문구가 확정에 맞게 고쳐져 있다. 이 문서들과 ADR 목록(`docs/decisions/index.md`), `lab/q10-db/README.md`가 같은 확정 상태를 말하는지 테스트(`lab/q10-db/test/confirmed.test.ts`)가 본다.
5. 어느 환경에서든 실측이 통과하지 못하면 확정하지 않는다. 그때 step1은 결과 파일을 더하지 않고 멈춰 원인을 진행 로그에 적고 제작자에게 묻는다(제작자의 기준대로 "DB 없이 시작"으로 되돌릴지).
6. `node scripts/harness.ts check` 통과. 14.3절의 규칙은 바꾸지 않는다.

## 범위 / 비범위

범위:

- `lab/q10-db/run.ts`(새 파일)와 그 테스트, `lab/q10-db/README.md`(절차를 명령 하나로, CI에서 돌리는 법, "잰 머신" 표), 워크플로 패치 `lab/q10-db/q10-trial-workflow.patch`.
- `lab/q10-db/trial.ts`에서 `--out`을 지운다(결과를 검사 없이 임의의 경로에 쓰던 옵션). 인자 검사를 `lab/q10-db/trial-args.ts`(새 파일)로 뗀다.
- `.github/workflows/q10-trial.yml`(새 파일. 제작자가 올린다. `docs/SECURITY.md`의 "워크플로 변경 절차").
- 워크플로의 구조를 단언하는 테스트 `scripts/test/q10-trial-workflow.test.ts`(새 파일).
- 결과 파일 `lab/q10-db/results/linux-<arch>.json`, `lab/q10-db/results/win32-<arch>.json`.
- 결과 파일의 출처 확인 `lab/q10-db/verify-artifacts.ts`(새 파일)와 그 테스트, 확정 상태의 테스트 `lab/q10-db/test/confirmed.test.ts`(새 파일).
- ADR-0007, 설계서 18절 Q10 행·19절 "현재 위치"·0절 버전 이력, `docs/harness/CHANGELOG.md`, 기술 부채 표의 TD-14 행, `profiles/web/README.md`의 DB 절 첫 문단.

비범위:

- 제작자의 Windows PC에서 낸 결과 파일을 리포에 더하는 것과 TD-14의 다른 실기 검증 항목(훅의 차단 동작 등). 이유: CI의 Windows 러너도 네이티브 Windows이고, 확정 조건(`win32-*` 결과)은 출처를 확인할 수 있는 러너의 산출물로 채운다(`verify-artifacts.ts`는 CI 실행만 확인한다). 제작자의 PC에서는 2026-11-23에 절차가 통과했다("검증 방법과 결과"). TD-14의 다른 항목은 이 계획과 관계없다.
- 하네스 스크립트 자체를 Windows·macOS 러너에서 돌리는 CI 행렬(TD-15). 이유: 이 워크플로는 `lab/q10-db`의 실물 확인만 돌린다.
- 워크플로를 PR이나 push에 자동으로 돌리는 것. 이유: 실측은 패키지 버전이나 설치 정책을 바꿀 때만 다시 재면 되고, 자동 실행은 Actions 사용량을 늘린다(Issue #170).
- 일회용 DB를 표준 명령에 잇는 일(TD-12), 웹 프로파일의 차단 목록(Issue #166에서 끝났다), `lab/q10-db/trial.ts`와 `check-results.ts`의 판정 기준.
- 다른 워크플로 파일.

## 관련 파일·문서

- `lab/q10-db/run.ts`, `lab/q10-db/test/run.test.ts`, `lab/q10-db/README.md`, `lab/q10-db/q10-trial-workflow.patch`, `lab/q10-db/results/**`
- `lab/q10-db/verify-artifacts.ts`, `lab/q10-db/test/verify-artifacts.test.ts`, `lab/q10-db/test/confirmed.test.ts`
- `lab/q10-db/trial-args.ts`
- `lab/q10-db/trial.ts`(`--out`을 지운다. 그 밖에는 실측에서 어긋난 점이 나오면 고친다. 확인 항목과 판정 기준은 바꾸지 않는다), `lab/q10-db/check-results.ts`(실측에서 어긋난 점이 나오면 고친다. 판정 기준은 바꾸지 않는다)
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
  - 전제를 이 Mac(macOS, Node 22)에서 임시 폴더로 확인했다(리포는 건드리지 않는다): 심볼릭 링크 폴더로 들어가면 `process.cwd()`가 링크를 따라간 실제 경로를 낸다. 들어간 뒤 링크를 다른 폴더를 가리키게 바꾸고 파일 이름만으로 `wx`로 열면 파일은 처음 들어간 폴더에 생기고 바뀐 쪽에는 아무것도 생기지 않는다. 붙잡은 폴더 자체를 다른 곳으로 옮기면 `process.cwd()`의 글은 그대로이고(Node가 기억해 둔 값), `statSync('.')`와 `statSync(기억한 경로)`를 견주면 드러난다(경로가 없어 `ENOENT`, 같은 이름의 새 폴더가 생겼으면 `ino`가 다르다). 그래서 연 뒤의 확인은 경로를 다시 읽는 것이 아니라 폴더의 정체를 견주는 것으로 적었다. Linux에서는 워크플로 `q10-trial`의 러너에서 `run.ts`의 마지막 단계가 `out-file.test.ts`를 돌려 같은 것을 본다(step1에서 실행하고 로그로 확인한다. `check`는 `scripts/test/` 아래만 돌린다).
- 2026-11-22 계획 검증 4회차: Claude 승인, Codex 수정 요청(P1 둘). F5는 닫혔다. 둘 다 맞는 지적이라 계획을 고쳤다.
  - F6(P1): Windows에서 `--out`을 거부하기로 했는데, 테스트는 "리포 밖 새 경로는 통과"를 요구하고 링크 사례만 건너뛰게 돼 있었고 AC의 실측 줄도 `--out`의 성공을 요구했다. → 통과 사례와 `--out` 실측은 macOS·Linux의 기준으로 적고, Windows의 기준(유효한 새 경로도 거부한다, 자식 프로세스를 띄우지 않는다, 파일이 생기지 않는다)을 따로 두었다. 검사 함수와 `run.ts`의 인자 해석이 `platform`을 인자로 받아, 그 사례를 모든 OS의 테스트에서 본다.
  - F7(P1): `out-file.test.ts`가 Linux에서 도는 곳이 없었다(`check`는 `scripts/test/` 아래만 돌리고, `run.ts`의 마지막 단계는 `check-results.test.ts`만 돌렸다). 앞 회차에 "Linux에서는 CI의 테스트가 본다"고 적은 것은 틀렸다. → `run.ts`의 마지막 단계가 `out-file.test.ts`도 돌린다. 워크플로가 `run.ts`를 부르므로 Linux와 Windows 러너에서 돈다(워크플로 파일과 패치는 바뀌지 않는다). `run.test.ts`가 단계 목록에 그 테스트가 든 것을 보고, step1이 두 job의 로그에서 그 테스트가 돌았고 실패가 없는 것(Linux에서 링크 사례가 건너뛰어지지 않은 것)을 확인한다.
- 2026-11-22 계획 검증 5회차: Claude 승인, Codex 수정 요청(P1 하나). F6·F7은 닫혔다. F8(P1): Windows에서 `trial.ts`를 직접 부를 때 `--out`을 거부하는지 보는 곳이 없다(함수와 `run.ts`만 본다). 맞는 지적이다. 회차마다 `--out`의 다른 조합에서 빈 곳이 하나씩 나왔으므로(F1, F5~F8), 이번에는 지적된 줄만 고치지 않고 진입점(함수, `run.ts`, `trial.ts`)과 OS(macOS, Linux, Windows)의 조합을 표로 모두 적어 빈칸을 찾았다. 빈칸은 둘이었다: Windows에서 `trial.ts`를 명령으로 부르는 경우(F8), Windows와 Linux의 러너에서 `run.ts`를 명령으로 부르는 경우(`run.test.ts`는 러너에서 돌지 않는다. 지적되지 않았지만 같은 종류다). → `out-file.test.ts`에 두 진입점을 실제 명령으로 부르는 사례를 넣었다(모든 OS, macOS·Linux, Windows). `run.ts`의 마지막 단계가 그 파일을 돌리므로 두 러너에서 돌고, step1이 로그에서 건너뛰어지지 않은 것을 확인한다. 보지 않는 것 하나(Linux에서 `--out` 실측의 성공)는 표 아래에 적었다.
- 2026-11-22 계획 검증 6회차: Claude 승인, Codex 수정 요청(P1 둘). F8은 닫혔다. F9(P1): 두 진입점을 명령으로 부르는 거부 테스트가 실제 작업 트리의 `package.json`을 쓰기 대상으로 준다. 검사가 빠진 코드(구현 전의 실패 확인, 회귀)에서는 덮어쓸 수 있다. F10(P1): Linux에서 `--out`이 정상 경로를 받는지 명령 수준으로 보지 않는다. 둘 다 `--out`의 지적이고, 여섯 회차 동안 이 옵션에서만 일곱 건이 나왔다(F1, F5~F10). 앞의 보고에서 정한 대로 더 고치지 않고 제작자에게 물었다(선택지: `--out`을 없앤다 / 한 번 더 고친다 / 남은 지적을 받아들인다). 답: "`--out`을 없앤다".
- 2026-11-22 계획을 다시 썼다(`--out`을 없앤다). step0: `run.ts`는 `--skip-fmt`만 받는다. `trial.ts`에서 `--out`을 지운다(인자는 빈 폴더 하나). 경로 검사(`out-file.ts`)와 그 테스트, 진입점·OS 표, Windows에서의 거부 기준은 통째로 뺐다. 절차를 이 머신에서 돌려 보는 AC는 새 임시 폴더의 복제본에서 돌린다(`git clone` 뒤 `run.ts --skip-fmt`. 이 worktree에서 복제하면 같은 커밋이 체크아웃되는 것을 확인했다). `--out`을 받지 않는 것을 보는 테스트는 리포 밖의 임시 폴더만 쓰기 대상으로 준다(F9와 같은 일이 없게). step1: 러너의 로그에서 경로 검사 테스트를 확인하는 항목을 뺐다. 옛 브랜치의 `run.ts`와 테스트는 `--out`을 받는 꼴이라 가져온 뒤 고친다.
- 2026-11-22 계획 검증 7회차(`--out`을 없앤 계획): Claude 승인, Codex 수정 요청(P1 하나). F1~F10은 모두 닫혔다(F4는 미룸). F11(P1): `trial.ts`를 실제 명령으로 불러 `--out`의 거부를 보는 테스트는, 고치기 전의 코드에서 돌리면(구현 전의 실패 확인) 그 인자가 받아들여져 패키지 설치가 시작된다. "네트워크를 쓰지 않는 테스트"와 어긋난다. 맞는 지적이다. → 인자 검사를 순수 함수(`lab/q10-db/trial-args.ts`의 `parseTrialArgs`)로 떼고 테스트는 그 함수와 연결(글)을 본다. `trial.ts`는 불러오기만 해도 실측이 돌기 때문에 테스트가 불러오거나 실행하지 않는다. 실제 명령으로 보는 것은 구현 뒤의 AC 한 줄로 옮겼다(리포 밖의 임시 폴더만 쓴다).
- 2026-11-22 계획 검증 8회차: Claude 승인, Codex 수정 요청(P1 하나). F11은 닫혔다. F12(P1): `trial.ts`를 명령으로 부르는 AC가 종료 코드와 빈 폴더만 봐서, 사용법을 내지 않고 예외로 죽어도 통과한다. 맞는 지적이다. → 그 AC와 `run.ts`의 같은 AC가 표준 오류를 파일로 받아 사용법의 글이 있는지 본다. 두 명령의 사용법 문구와 종료 코드(`run.ts` 2, `trial.ts` 1)를 계획에 적었다.
- 2026-11-22 계획 검증 9회차: Claude 승인, Codex 수정 요청(새 지적 없음. F12가 남았다). F12: 고친 AC는 표준 오류에 사용법의 글이 **들어 있는지**만 봐서(`grep -F`), 사용법을 담은 예외로 죽어도 통과한다. 맞는 지적이다. → 두 AC가 표준 오류 전체를 기대한 한 줄과 견준다(`test "$(cat …)" = '…'`). 두 명령이 그 경우에 표준 오류에 내는 글을 정확히 한 줄로 정했다.
- 2026-11-22 계획 검증 10회차: Claude·Codex 모두 승인(지적 없음. F4는 P2로 미뤄 둔 채다). 계획 해시 `49fa50ae8ba1`.
- 2026-11-22 step0 구현(절차의 (나)): 테스트를 먼저 썼다(`lab/q10-db/test/run.test.ts`). 구현 전에 돌려 실패를 확인했다: `run.ts`가 없어 불러오기에서 실패한다(`ERR_MODULE_NOT_FOUND`. `trial.ts`를 실행하지 않는다). 그 뒤 `run.ts`(`--skip-fmt`만 받는다), `trial-args.ts`(`parseTrialArgs`)를 쓰고 `trial.ts`에서 `--out`을 지웠다. README, 패치(`q10-trial-workflow.patch`. 액션의 SHA와 Node 버전은 지금의 `check.yml`과 같다), CHANGELOG 한 줄. `node --test lab/q10-db/test/run.test.ts lab/q10-db/test/check-results.test.ts` 85건 통과. 구조 테스트(`scripts/test/q10-trial-workflow.test.ts`)는 제작자의 워크플로 커밋 뒤에 올린다. 완료 처리도 그때 한다.
- 2026-11-22 구현 판정 1회차(head `3ae8632`): Claude 승인(지적 없음), Codex 수정 요청(P1 하나). F13: README의 파일 표가 포맷 검사에서 실패한다고 했다(검증자는 명령을 실행하지 않았다). 확인했다: 이 작업 트리에서 `node scripts/harness.ts fmt --check`와 `prettier --check lab/q10-db/README.md`가 통과하고, 그 head의 CI `check`(포맷 검사 포함)도 통과했다. 포매터는 표의 칸을 표시 너비로 맞춘다(한글은 두 칸이라 글자 수로는 어긋나 보인다). 파일을 바꾸지 않았다. F13 반박(1회).
- 2026-11-22 구현 판정 2회차: F13의 반박이 받아들여졌고 두 검증자가 승인했다(열린 지적 없음). Issue #180에 제작자 작업(워크플로 파일 커밋)을 요청했다(기준 커밋 `270d8d7`). 요청 뒤로 이 브랜치에 커밋을 올리지 않고 기다렸다.
- 2026-11-22 제작자의 워크플로 커밋을 받았다(`cf280e3`, 작성자 제작자 계정, GitHub 웹에서 만든 서명된 커밋. 바뀐 파일은 `.github/workflows/q10-trial.yml` 하나, 42줄). 트리 비교(SECURITY.md의 비교 명령): 기준 커밋 `270d8d7`의 트리에 `lab/q10-db/q10-trial-workflow.patch`를 적용한 트리와 받은 head의 트리가 통째로 같다(둘 다 `163ed6b09826`).
- 2026-11-22 `origin/main`(`5fdf195`)을 병합했다(기다리는 동안 main이 나아가 CHANGELOG의 같은 자리가 충돌했다: main의 줄 먼저, 이 PR의 줄 뒤). 구조 테스트 `scripts/test/q10-trial-workflow.test.ts`를 더했다(5건 통과. 계획대로 워크플로 커밋 뒤에 올린다. 테스트는 워크플로 파일을 읽으므로 그 파일이 없는 head에서는 실패한다).
- 2026-11-22 구현 판정 3회차(head `41847e4`. 워크플로 커밋과 구조 테스트를 담은 head): Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨). F14: 워크플로 패치(`lab/q10-db/q10-trial-workflow.patch`)만 바꾼 변경에서는 `check`가 `test`를 건너뛰어, 패치와 워크플로 파일이 같은지 보는 구조 테스트가 돌지 않는다. 맞는 지적이고 원인은 이 PR의 밖(`check`의 건너뛰기 대상을 정하는 설정)이다. 제작자에게 물었고(2026-11-22 대화), "별도 PR로 먼저 고친다"로 정했다.
- 2026-11-22 그 수정이 main에 병합됐다(Issue #215, PR #216, `31b2390`): 패치 파일을 보호 경로(`protectedPaths`)에 더해 건너뛰기 대상에서 뺐다. `origin/main`을 병합했다(CHANGELOG의 같은 자리가 충돌했다: main의 줄 먼저, 이 PR의 줄 뒤). 이 PR의 파일은 바꾸지 않았다. 병합 뒤 step0의 AC와 `check`가 통과한다. 패치 파일이 보호 경로가 됐으므로 PR 본문의 보호 경로 줄에 더했다.
- 2026-11-23 앞의 head(`1372614`)를 올린 직후 PR #219가 병합돼 main과 충돌했다(CHANGELOG의 같은 자리). 충돌한 PR에서는 GitHub이 `check` 워크플로를 돌리지 않아 판정이 시작되지 않았다(1시간 기다려 확인했다). `origin/main`(`c24444c`)을 다시 병합했다(main의 줄 먼저, 이 PR의 줄 뒤). 이 PR의 파일은 바꾸지 않았다.
- 2026-11-23T11:58:11+09:00 step0 재작업: 미뤄 둔 판정 지적 F15(Codex P2, `lab/q10-db/README.md`): README가 '`scripts/test/`의 테스트는 `lab/`을 읽지 않는다'라고 하나, 구조 테스트가 워크플로 패치를 읽고 그 패치는 보호 경로다. 맞는 지적이다. 승인을 요청하기 전에 README의 그 문장을 고친다.
- 2026-11-23 작업을 넘겨받았다: 맥 세션(`mac-session-2`)이 인수인계를 남기고 끝났고, Windows PC의 대화 세션이 제작자 승인(2026-11-23 대화)을 받아 넘겨받았다(owner → `session`, 아래 의사결정 로그). worktree는 이 PC에 새로 만들었다. 넘겨받기 전에 owner를 확인하지 않고 git 명령으로 병합 커밋·인수인계 파일 삭제·step0 재작업을 먼저 만들었다. README를 고치려다 L1 훅(R3)이 막아 알았고, 그때까지 push하지 않았다.
- 2026-11-23 `origin/main`(`e9f7ad6`, #214·#221 병합 뒤)을 다시 병합했다(CHANGELOG의 같은 자리가 충돌했다: main의 줄 먼저, 이 PR의 줄 뒤). 이 PR의 파일은 바꾸지 않았다. 세션 인수인계 파일(`handoff.md`)을 지웠다.
- 2026-11-23 F15 처리: `lab/q10-db/README.md`의 문장을 고쳤다. 테스트가 이 폴더에서 읽는 두 파일과, 그 파일들이 `testInertPaths`·보호 경로와 어떤 관계인지 적었다. 맥 세션이 F15를 확인하다가 `profile-web-db.test.ts`가 `results/darwin-arm64.json`도 읽는 것을 찾아 Issue #225로 등록했다(고치는 PR은 #226). step0 금지사항(`harness.config.json`을 고치지 않는다) 때문에 이 PR에서 고치지 않는다. 문서만 바뀌어 테스트는 더하지 않았다.
- 2026-11-23 구현 판정 5회차(head `226ad6b`): CI `check` 통과, Claude 승인(지적 없음), Codex 수정 요청(P1 하나). `pr-state`에 "오래 열린 지적" 줄은 없다. F16(P1, `plan.md:145`): 제작자의 Windows PC에서 절차가 통과했다는 기록과, step1이 ADR·TD-14에 "제작자의 Windows PC에서는 아직 재지 않았다"고 쓰게 하는 지시(`step1.md`의 작업 3·4, 계획의 수용 기준 4·비범위)가 충돌한다. 맞는 지적이다. 이 PR에서는 `plan.md:145`의 문장을 고쳤다(그 실행은 결과 파일이 없어 확정 근거가 아니라고 적고, 지시처럼 읽히던 "ADR의 한계를 적을 때 참고한다"를 지웠다). step1의 지시는 이 PR에서 고칠 수 없어 병합 뒤 계획 수정 PR로 고친다(의사결정 로그).
- 2026-11-23 제작자 결정대로 Issue #228(Windows 전용 테스트 실패)을 먼저 고쳤다(PR #231, 병합 `54631b7`. 테스트 2건의 확인 방법, `commands.test.timeoutSec` 1800 → 3600초). `origin/main`(`54631b7`)을 병합했다(CHANGELOG의 같은 자리가 충돌했다: main의 줄 먼저, 이 PR의 줄 뒤). 이 PR의 파일은 바꾸지 않았다.
- 2026-11-23 구현 판정 6회차(head `4365802`, 이 PC의 `check` 통과 뒤 올렸다. F16 반박 1회를 함께 냈다): CI `check` 통과, Claude 승인(지적 없음), Codex 수정 요청(새 지적 없음, F16이 열려 있다). Codex의 이유: "후속 PR에서 고치겠다는 기록은 현재 지시를 바꾸지 않는다." `pr-state`에 "오래 열린 지적" 줄은 없다. 기록만이 아니라 step1이 고치기 전의 지시대로 실행되지 않게 막는 장치를 더했다(의사결정 로그 "결정(F16 보강)"). 반박 2회째를 낸다. 그래도 열려 있으면 교착이라 제작자에게 묻는다.
- 2026-11-23 구현 판정 7회차(head `510bcda`): 두 검증자 승인, F16은 `fixed`로 닫혔다. 제작자 승인 뒤 #188이 병합됐다(`c2cb9ff`).
- 2026-11-23 계획 수정(F16): 절차서 4.1절 "실행 중인 step의 계획 수정"대로 완료된 step0의 번호로 브랜치 `docs/20261121-q10-confirm-s0`을 `origin/main`(`c2cb9ff`)에서 만들었다. 의사결정 로그 "결정(F16)"대로 step1의 작업 3(`confirmed.test.ts`의 ADR·TD-14·설계서 Q10 행·README 기준)과 작업 4(README·ADR·설계서·TD-14 문구), 계획의 수용 기준 4·비범위를 고쳤다. TD-14의 `lab/q10-db` 항목은 닫기로 했다(아래 "결정(F16 계획 수정)"). step1.md의 "먼저 읽는다(F16)" 항목을 지우고 status를 `active`로 되돌렸다. 계획 검증(G1)을 다시 받는다.
- 2026-11-23 계획 수정의 계획 검증 1회차(PR #232, head `499d46c`): Claude 승인(지적 없음), Codex 수정 요청(P1 둘). 둘 다 맞는 지적이라 step1의 작업 3·4를 고쳤다.
  - F1(P1, `step1.md:47`): ADR "알려진 한계"의 단언이 한 줄에 `CI`·`Windows PC`·`결과 파일`이 있는지만 봐서, PC의 결과를 확정 근거로 삼았다고 뒤바꿔 적어도 통과한다. → 넣을 두 문장(Windows의 확정 근거는 CI 러너의 산출물이다, 제작자 PC에서는 통과했으나 결과 파일이 없어 확정 근거로 쓰지 않는다)을 작업 4에 글자 그대로 정하고, 테스트가 각각 본다.
  - F2(P1, `step1.md:59`): ADR의 `## 결과` 절에 "Q10이 잠정 결정으로 바뀐다 … Q10(잠정, 실측 남음)"이 남아도 작업과 테스트가 잡지 못한다. → 작업 4에 그 줄을 확정에 맞게 고치는 것을 넣었다. 테스트는 ADR 문서 전체에 `잠정`이 없는 것과, "결과" 절의 `Q10`이 든 줄마다 `확정`이 있는 것을 본다.
- 2026-11-23 계획 수정이 병합됐다(PR #232, `69ecad1`). Windows PC의 세션이 `new-task --plan 20261121-q10-confirm --step 1`로 브랜치 `chore/20261121-q10-confirm-s1`을 만들고, 제작자 지시대로 세션 인수인계 파일만 올린 채 멈췄다(`d45f142`).
- 2026-11-23 step1 시작(넘겨받기): 이 Mac의 대화 세션이 그 인수인계를 이어받았다(제작자 대화 지시). owner는 `session` 그대로다(이 Mac 세션의 작업자 이름도 `session`이고, Windows PC의 세션은 멈췄다). worktree는 이 Mac에 새로 만들었다(`git worktree add ../harness_project.worktrees/chore/20261121-q10-confirm-s1 chore/20261121-q10-confirm-s1`. 인수인계에 적힌 경로 `harness__project.worktrees`는 Windows PC의 폴더 이름이다). `origin/main`(`85cac33`, #227 병합 뒤)을 병합했다. 인수인계 파일(`handoff.md`)을 지웠다. #227이 먼저 병합됐으므로 이 step의 CHANGELOG·설계서 기록은 변경 조각에 적는다(의사결정 로그).
- 2026-11-23 워크플로 1회차: `gh workflow run q10-trial.yml --ref main`(봇 토큰으로 실행됐다). 실행 45177957783(https://github.com/ariawell-hub/harness_project/actions/runs/45177957783), 커밋 `85cac33`. 두 job(`ubuntu-latest`, `windows-latest`)이 모두 `trial` 단계에서 실패했다: `trial: 쓰는 pnpm(! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.34.5.tgz)이 이 리포가 고정한 pnpm@10.34.5와 다르다`. `trial.ts`가 `pnpm --version`의 표준 출력과 표준 오류를 이어 붙인 글의 마지막 줄을 버전으로 읽는데, 러너에서는 Corepack이 pnpm을 처음 받으며 표준 오류에 안내 줄을 쓴다. 도구가 아니라 스크립트의 문제라(작업 1) 결과 파일을 더하지 않고 별도 PR로 먼저 고친다: Issue #233, PR #234(계획 `20261123-corepack-version`). 이 Mac에서 빈 Corepack 캐시로 같은 실패를 재현했고, 고친 코드로는 절차가 통과했다(그 계획의 진행 로그).
- 2026-11-23 테스트를 먼저 썼다(작업 2·3). 결과 파일과 문서를 고치기 전에 돌렸다:
  - `node --test lab/q10-db/test/confirmed.test.ts`: 10건 가운데 9건 실패(확정 조건, linux·win32 결과, ADR 상태 줄, ADR 본문, ADR 목록, 설계서, TD-14 행, 웹 프로파일 README, `lab/q10-db/README.md`). 통과한 1건은 "잰 머신 표에 결과 파일마다 행"이다(그때는 결과 파일이 `darwin-arm64.json`뿐이고 그 행이 있다).
  - `node --test lab/q10-db/test/verify-artifacts.test.ts`: `verify-artifacts.ts`가 없어 실패(`ERR_MODULE_NOT_FOUND`). 테스트만 커밋했다(`18255cf`). 구현(`3535b83`) 뒤 27건 통과. 구현하며 테스트 한 곳을 고쳤다: 호출 기록에는 명령 이름(`gh`)도 들어 있어 `gh api` 호출의 길이 기대값이 2가 아니라 3이다(단언의 뜻은 그대로: 경로 밖의 인자가 없다).
- 2026-11-23 #234가 병합됐다(`67bd225`). `origin/main`을 병합했다.
- 2026-11-23 워크플로 2회차: `gh workflow run q10-trial.yml --ref main`. 실행 45180055726(https://github.com/ariawell-hub/harness_project/actions/runs/45180055726), 커밋 `67bd225`. 두 job(`trial (ubuntu-latest)`, `trial (windows-latest)`)이 모두 성공했다. `gh run download 45180055726 --dir <새 임시 폴더>`로 받아 `q10-result-ubuntu-latest/linux-x64.json`과 `q10-result-windows-latest/win32-x64.json`만 `lab/q10-db/results/`에 복사하고 `node scripts/harness.ts fmt`로 포맷했다(손으로 고치지 않았다. `darwin-arm64.json`은 그대로). `node lab/q10-db/check-results.ts linux-x64`, `win32-x64`: 통과. `node lab/q10-db/check-results.ts --confirm`: `--confirm: 확정 조건이 채워졌다(darwin, win32, linux)`, 종료 코드 0. 두 결과 모두 Node v22.20.0, pnpm 10.34.5, 패키지 버전은 `darwin-arm64.json`과 같다.
- 2026-11-23 출처 확인(`node lab/q10-db/verify-artifacts.ts`, 종료 코드 0):

  ```text
  results/linux-x64.json · 실행 45180055726 · 커밋 67bd22575419 · 산출물 q10-result-ubuntu-latest · 같다
  results/win32-x64.json · 실행 45180055726 · 커밋 67bd22575419 · 산출물 q10-result-windows-latest · 같다
  ```

- 2026-11-23 음성 확인(실제 GitHub 자료, 이 작업 트리의 새 임시 복제본에서): (1) `linux-x64.json`의 행 수 하나를 2 → 3으로 바꾸면 종료 코드 1, `linux-x64.json: 커밋한 파일과 산출물의 값이 다르다`. (2) README의 실행 주소를 실패한 1회차(45177957783)로 바꾸면 종료 코드 1, 문제 5건(두 산출물을 받지 못했다, 실행이 성공하지 않았다, 두 job이 성공하지 않았다). (3) 되돌리면 종료 코드 0. 처음 이 확인을 돌렸을 때는 세 경우가 모두 출력 없이 종료 코드 0이었다: 복제본의 경로(`/var/folders/…`)가 macOS에서 링크라 `process.argv[1]`과 `import.meta.url`(실제 경로 `/private/var/…`)이 달라, 직접 실행 판정이 거짓이 되어 아무것도 하지 않았다. 링크를 거친 경로로 실행하는 테스트를 먼저 더해 실패를 확인하고(29건 가운데 1건 실패), 두 경로를 `realpathSync.native`로 풀어 견주게 고쳤다(`9b6e4d4`, 29건 통과). 그 뒤 위 세 경우를 다시 돌렸다(발견 사항).
- 2026-11-23 문서(작업 4): `lab/q10-db/README.md`("잰 머신" 표에 "실행" 칸과 두 행, 확정 상태 문단, "확정 조건" 절, 경로 표, CI 절차 5번), ADR-0007(상태 채택, 결정·실측·확정 조건·알려진 한계·결과), `docs/decisions/index.md`(채택), 설계서 18절 Q10 행·19절 "현재 위치"·14.3절의 "잠정" 한 낱말, TD-14 행의 `lab/q10-db` 항목, `profiles/web/README.md` DB 절 첫 문단, 변경 조각 `docs/harness/changes/20261121-q10-confirm-s1.md`. `confirmed.test.ts` 10건 통과.
- 2026-11-23 step1 PR #235(초안, head `1954b1e`)를 올렸다. 구현 판정 1회차: CI `check` 통과, Claude 승인(지적 없음), Codex 수정 요청(P1 하나, 재현됨). `pr-state`에 "오래 열린 지적" 줄은 없다.
- 2026-11-23T22:29:25+09:00 step1 재작업: 구현 판정 1회차(head 1954b1e) Codex F1(P1, 재현됨): verify-artifacts.ts가 실행 주소의 번호 뒤 경계를 보지 않아 틀린 주소(…/runs/101typo)를 실행 101로 읽는다. 실행 칸 전체를 주소 꼴로 검사하게 고친다
- 2026-11-23 F1 처리: 맞는 지적이다. 정규식 `…/actions/runs/(\d+)`가 행 어디서든 번호만 떼어 읽어, 적힌 주소와 다른 실행을 확인하고도 0으로 끝날 수 있었다. 테스트를 먼저 더했다(꼴이 틀린 실행 칸 9가지: 번호 뒤 글, `/attempts/1`, 질의, 조각, `http`, 다른 호스트, 앞에 붙은 글, 링크 문법, 주소 둘. 실행 칸이 아닌 칸에만 있는 주소. 꼴이 틀리면 조회하지 않는다): 고치기 전 32건 가운데 3건 실패(`388b346`). `readRows`가 표의 머리줄로 "결과 파일"·"실행" 칸을 찾고, 실행 칸 전체가 `https://github.com/<owner>/<repo>/actions/runs/<번호>` 하나일 때만 읽게 고쳤다(`3b108bb`, 32건 통과). 비어 있으면 "실행 주소가 없다", 꼴이 틀리면 "실행 칸이 실행 주소의 꼴이 아니다"를 낸다. `confirmed.test.ts`의 실행 주소 확인도 같은 꼴(실행 칸 전체)로 맞췄다(README에 `…/runs/45180055726typo`를 넣으면 실패하는 것을 확인하고 되돌렸다). 실제 자료의 음성 확인에 (4) linux 행의 주소를 `…/runs/45180055726typo`로 바꾸는 경우를 더했다: 종료 코드 1, `linux-x64.json: 실행 칸이 실행 주소의 꼴이 아니다(…)`. (1)~(3)도 다시 돌려 앞과 같았다.

## 의사결정 로그

- 결정: 절차를 셸 블록 둘(Bash, PowerShell)에서 명령 하나(`node lab/q10-db/run.ts`)로 바꾼다. / 이유: PowerShell 블록은 Windows에서 돌려 본 적이 없고, 워크플로에 셸 절차를 그대로 넣으면 절차가 어긋날 때마다 제작자가 워크플로를 다시 올려야 한다. 스크립트로 두면 봇이 고칠 수 있고 세 OS가 같은 코드를 돈다. "앞 단계가 실패하면 멈춘다"도 코드와 테스트로 보장한다. / 버린 대안: 워크플로에 두 셸 절차를 넣기.
- 결정: CI에서는 포맷 단계를 뺀다(`--skip-fmt`). 받은 결과 파일은 리포에 넣을 때 `node scripts/harness.ts fmt`로 포맷한다. / 이유: 포맷은 하네스의 의존성 설치(`setup`)가 필요한데, 하네스 스크립트는 Windows 러너에서 돌려 본 적이 없다(TD-14, TD-15). 실물 확인이 하네스의 Windows 지원에 걸리지 않게 한다. 포맷은 도구가 하는 일이라 "결과 파일을 손으로 고치지 않는다"에 어긋나지 않는다. / 버린 대안: 러너에서 `setup`과 포맷까지 돌리기.
- 결정: Windows 네이티브의 결과는 CI의 `windows-latest` 러너에서 얻는다. / 이유: 러너는 WSL이 아닌 네이티브 Windows이고, 확정 조건이 묻는 것(패키지가 네이티브 바이너리·설치 스크립트 없이 설치되고 도는가)을 잰다. Linux와 같은 실행으로 함께 얻는다. 제작자의 PC와 다른 점(경로, 사용자 이름, 보안 프로그램)은 재지 못하므로 ADR에 적고 PC에서의 재실측을 TD-14에 남긴다. 제작자에게는 워크플로 커밋을 요청할 때 함께 알린다. / 버린 대안: Windows PC의 세션을 기다리기(확정이 그 세션에 묶인다).
- 결정: 워크플로는 손으로만 돈다(`workflow_dispatch`). / 이유: 다시 잴 때는 패키지 버전·pnpm 고정 버전·설치 정책을 바꿀 때뿐이다. PR마다 돌리면 사용량이 는다(Issue #170). / 버린 대안: `lab/q10-db/**`를 바꾼 PR에서 자동으로 돌리기(병합 전에 결과를 볼 수 있지만 PR 코드를 실행하는 워크플로가 하나 는다).
- 결정: step을 둘로 나눈다. / 이유: 손으로 도는 워크플로는 기본 브랜치에 있어야 실행할 수 있다. 워크플로가 병합된 뒤에 돌려 결과를 받는다.
- 결정: 위험도 high. / 이유: 워크플로(보호 경로)를 더하고 DB·마이그레이션 도구 결정을 확정한다.
- 결정: 다시 시작하는 브랜치의 접두어를 `chore`로 한다. / 이유: 브랜치 이름은 `<type>/<계획 id>-s<step>`이고 같은 이름의 원격 브랜치를 다른 커밋으로 다시 만들 수 없다(지우고 다시 만드는 것은 force push와 같다). 게이트는 접두어가 아니라 계획 id와 step 번호로 계획을 찾는다. 추가하는 것이 CI 워크플로와 실험 폴더의 실행 스크립트라 `chore`가 맞다. / 버린 대안: 옛 브랜치에서 제작자가 워크플로를 지우고 다시 올리기(제작자 작업 2회).
- 결정(철회, 2026-11-22): `--out`의 결과 파일을 실측 전에 열어 둔다. → `--out`을 없애면서 필요 없어졌다(아래).
- 2026-11-22 계획 검증이 5회차까지 왔다. 앞의 보고에서 "같은 자리에서 한 번 더 지적이 나오면 먼저 묻겠다"고 했으나 묻지 않고 고쳤다. 이유: F8은 새 지적이고 맞는 지적이며 고칠 것이 테스트 설계다(절차서 7절의 "묻지 않고 진행한다"). `pr-state`에 "오래 열린 지적" 줄이 없다(같은 지적이 다시 열린 것이 아니다). 추천안이 분명한 질문은 하지 않는다(7절). 대신 대응하는 방법을 바꿨다(지적된 곳만 고치기 → 조합을 표로 전부 점검). 제작자에게는 그대로 보고한다. 대안으로 검토한 것: `--out`을 이 계획에서 빼는 것. 고르지 않았다 — `--out`은 main의 `trial.ts`에 이미 있고 검사 없이 쓰므로(F1), 빼지 않는 한 고쳐야 하며, 빼면 작업 트리를 바꾸지 않고 돌려 보는 절차(README)가 없어진다.
- 결정(제작자, 2026-11-22 대화): `--out`을 없앤다. / 이유: 결과를 임의의 경로에 쓰는 옵션은 작업 트리의 파일을 덮어쓸 수 있다(F1). 안전하게 만들려면 경로 검사, 검사와 쓰기 사이의 틈, OS마다 다른 동작, 진입점마다의 검증이 따라오고(F5~F10), 계획 검증 여섯 회차 동안 지적이 이 옵션에서만 나왔다. 확정 조건(세 환경의 결과 파일)에 필요한 기능이 아니고 CI의 실측도 쓰지 않는다. 없애면 지적의 대상이 사라지고 main에 있는 검사 없는 `--out`도 함께 없어진다. / 대가: "작업 트리를 바꾸지 않고 돌려 보기"가 옵션 하나에서 "임시 폴더에 복제해 돌리기"로 바뀐다. / 버린 대안: 한 번 더 고친다(계획과 코드가 더 커지고 다음 회차에 또 나올 수 있다), 남은 지적을 제작자가 받아들인다(구현 판정에서 다시 나올 수 있다).
- 결정(구현 판정 3회차 F14 뒤, 제작자 2026-11-22 대화): F14는 이 PR에서 고치지 않고 별도 PR(#216)로 먼저 고친 뒤 이 PR이 main을 병합해 해소를 판정받는다. / 이유: 원인이 `check`의 설정(보호 경로)이라 이 step의 범위 밖이고, 이 PR은 제작자가 올린 워크플로 커밋을 담고 있어 변경을 더 얹지 않는 편이 낫다. 제작자 승인은 그 PR과 이 PR, 두 번이다.
- 결정(제작자, 2026-11-23 대화): 이 계획을 Windows PC의 대화 세션이 넘겨받는다(owner `mac-session-2` → `session`). / 이유: 맥 세션이 인수인계 문서를 남기고 끝났다. L1 훅(R3)이 owner가 다른 worktree의 수정을 막아 제작자에게 물었다. / 대가: 맥에서는 이 브랜치를 고치지 않는다(두 곳에서 고치면 어긋난다).
- 결정: 결과 파일(`results/darwin-arm64.json`)의 건너뛰기 문제는 이 PR에서 고치지 않고 Issue #225(PR #226)로 따로 고친다. / 이유: F14 때 제작자가 정한 방법(별도 PR로 먼저 고친다)과 같다. step0의 금지사항이 `harness.config.json` 수정을 막는다.
- 결정(제작자, 2026-11-23 대화): 이 head는 로컬 `check`가 통과하지 않은 채 push한다(이번만 예외). / 이유: Windows PC의 `check`에서 `test` 두 건(`next.test.ts`의 `writeQuestionState` rename, `scope.test.ts`의 symlink)이 `EPERM`으로 실패했다. main 체크아웃(`e9f7ad6`)에서 그 두 테스트만 돌려도 똑같이 실패해 이 PR의 변경과 관계없다. 나머지(`fmt`·`lint`·`test-effect`·`doc-lint`·`bypass-scan`·`secret-scan`, 테스트 1274건)는 통과했다. 병합 조건인 CI의 `check`(Linux 러너)는 그대로 필수다. 두 실패는 Issue #228로 등록했다. / 버린 대안: Windows 실패부터 별도 PR로 고친 뒤 push(규칙 그대로지만 #188이 그 PR의 판정·승인만큼 늦어진다).
- 결정(F16): step1의 ADR·TD-14 문구 지시는 이 PR에서 고치지 않는다. #188이 병합된 뒤, step1을 시작하기 전에 계획만 담은 별도 PR(브랜치 `docs/20261121-q10-confirm-s0`, 절차서 4.1절 "실행 중인 step의 계획 수정")로 고쳐 계획 검증을 받는다. / 이유: 고칠 곳(`step1.md`의 작업·AC, 계획의 수용 기준 4·비범위)은 계획 검증(G1) 해시에 묶여 있다. 이 PR은 계획이 아직 main에 없는 첫 PR이라, 여기서 고치려면 PR을 계획만 남긴 상태로 되돌려 다시 검증받아야 한다. 그런데 이 PR에는 제작자가 올린 워크플로 파일이 있고, 봇은 그 파일을 지우는 커밋을 올릴 수 없다(절차서 4.1절, 발견 사항 둘째 줄과 같은 사정). / 고칠 내용: ADR "알려진 한계"와 TD-14의 `lab/q10-db` 항목은 둘을 따로 적는다. (1) 확정 근거: Linux·Windows는 CI 러너의 산출물이고 `verify-artifacts.ts`로 출처를 확인했다. (2) 제작자의 Windows PC: 2026-11-23에 절차가 통과했으나 결과 파일을 남기지 않아 확정 근거로 쓰지 않는다. TD-14에 PC 재실측을 남긴다면 그 목적(출처를 남기는 실측)을 적고, 목적이 없으면 그 항목을 닫는다. `confirmed.test.ts`의 기준도 이 문구에 맞춘다. / 버린 대안: step1 PR에서 지시와 다르게 쓰기(실행 PR은 자기 step의 작업·AC를 바꿀 수 없고 판정이 지시와 다르다고 본다), PC 실행 기록을 지우기(일어난 일을 가린다).
- 결정(제작자, 2026-11-23 대화): F16 대응 커밋을 올리기 전에 Issue #228(Windows 전용 테스트 실패)부터 고친다. 앞의 "이번만 예외"는 head `226ad6b` 한 번뿐이고, 이후 push에는 적용하지 않는다. #228이 병합되면 이 브랜치에 `origin/main`을 병합하고, 로컬 `check`가 통과한 뒤 push한다.
- 결정(F16 보강, 구현 판정 6회차 뒤): step1이 고치기 전의 문구 지시대로 실행되지 않게 계획 해시에 들지 않는 두 곳을 고친다. (1) `step1.md`의 "읽어야 할 파일" 맨 앞에 "먼저 읽는다(F16)" 항목을 둔다: 문구 지시는 계획 수정 PR이 고치고, 그 PR이 병합되기 전에는 이 step을 시작하지 않으며, ADR·TD-14에 제작자 PC를 "아직 재지 않았다"고 쓰지 않는다. (2) 계획의 status를 `blocked`로 둔다: runner는 `blocked` 계획을 고르지 않고(`scripts/runner/next.ts`), `start`는 이 계획을 대기로 보인다. 계획 수정 PR이 지시를 고치면서 status를 `active`로 되돌린다. / 이유: 판정 6회차에서 Codex가 "후속 PR에서 고치겠다는 기록은 현재 지시를 바꾸지 않는다"고 했다. 묶인 섹션(작업·AC)은 이 PR에서 고칠 수 없으므로(위 "결정(F16)"), 실행 전에 읽는 자리와 실행을 고르는 상태로 막는다. 계획 해시는 그대로다(`49fa50ae8ba1`). / 대가: #188이 병합된 뒤 계획 수정 PR이 병합될 때까지 `start`가 #180을 대기로 보인다.
- 결정(F16 계획 수정, 2026-11-23): TD-14의 `lab/q10-db` 항목은 남기지 않고 닫는다(step1이 그 행에서 뺀다). 위 "Windows 네이티브의 결과는 CI의 `windows-latest` 러너에서 얻는다"의 "PC에서의 재실측을 TD-14에 남긴다"를 바꾼다. ADR-0007과 `lab/q10-db/README.md`, 설계서 Q10 행도 그 항목(TD-14)을 가리키지 않는다. / 이유: 그 재실측의 목적은 러너가 재지 못하는 PC의 차이(경로, 사용자 이름, 보안 프로그램)를 보는 것이었고, 2026-11-23에 제작자의 PC에서 절차가 통과해 채워졌다. 다시 돌려 결과 파일을 남겨도 `verify-artifacts.ts`처럼 출처를 확인할 수단이 없어 확정 근거가 늘지 않는다. 다시 잴 일(패키지 버전·pnpm 고정 버전·설치 정책을 바꿀 때)은 워크플로 `q10-trial`이 맡는다. / 버린 대안: TD-14에 "출처를 남기는 PC 재실측"으로 남기기(확정 근거를 늘리지 않는 일을 남긴다).
- 결정(step1): CHANGELOG 한 줄과 설계서 머리말·0절 이력 대신 변경 조각(`docs/harness/changes/20261121-q10-confirm-s1.md`)에 적는다. / 이유: step1.md 작업 4는 #227(TD-39) 전에 썼다. #227이 먼저 병합돼 절차서 5절이 "설계서를 고친 PR은 머리말·이력을 고치지 않고 조각의 `## 설계서 변경 이력`에 적는다"로 바뀌었다. 조각의 두 섹션이 같은 내용(CHANGELOG 한 줄: 검사를 약화하지 않는다는 것, 설계서 이력 한 줄)을 담고, 버전과 날짜는 모으기 PR이 붙인다. 버전 번호를 쓰지 않으므로 #217과 번호가 겹치지 않는다. 인수인계(2절 6번)도 #227이 먼저 병합되면 조각에 적기로 했다. / 버린 대안: 옛 방식(CHANGELOG 직접, 설계서 v0.7.83): 절차서가 "이 규칙 전에 쓴 계획"으로 받아 주지만, 같은 자리를 고치는 다른 PR과 충돌하고 번호를 다툰다.
- 결정(step1): 14.3절은 "잠정" 한 낱말만 지웠다: `(ADR-0007, 잠정)` → `(ADR-0007, )`. / 이유: AC 여덟째 줄이 두 쪽에서 "잠정"을 지운 14.3절이 글자 그대로 같기를 요구한다. 그 낱말만 지우는 것 말고는(쉼표까지 지우거나 "확정"으로 바꾸기) AC를 통과하지 못하고, 실행 PR은 자기 step의 AC를 바꿀 수 없다(절차서 4.1절). 낱말을 남기면 14.3절이 ADR-0007을 잠정이라 해 18절과 어긋난다. 남은 `, `는 발견 사항에 적는다. / 버린 대안: `(ADR-0007)`로 다듬기(AC 실패), 계획 수정 PR로 AC를 고치기(쉼표 하나를 위해 계획 검증과 제작자 승인을 한 번 더 받는다), 그대로 두기(문서가 어긋난다).
- 결정(step1): `lab/q10-db/README.md`의 "잰 머신" 표에 "실행" 칸을 더해 실행 주소를 적는다(macOS 행은 비운다). / 이유: 작업 4가 두 행에 실행 주소를 적으라 하고, `verify-artifacts.ts`와 `confirmed.test.ts`가 행에서 주소를 읽는다. 칸을 따로 두면 머신 이름과 섞이지 않는다.
- 결정(step1): `verify-artifacts.ts`의 직접 실행 판정은 두 경로를 실제 경로(`realpathSync.native`)로 풀어 견준다. / 이유: 링크를 거친 경로로 실행하면 아무것도 하지 않고 0으로 끝나, AC 마지막 줄이 확인 없이 통과할 수 있었다(진행 로그의 음성 확인). `.native`는 Windows에서 드라이브 문자·대소문자까지 실제 이름으로 푼다. 실행 경로를 풀 수 없으면 실행하지 않는다(불러온 경우와 같다). / 버린 대안: 판정 없이 언제나 실행하기(테스트가 불러오면 GitHub을 읽는다). 같은 꼴의 다른 파일(`check-results.ts` 등)은 이 step에서 고치지 않는다(AC 일곱째 줄, 발견 사항).
- 결정(step1, F1): README "잰 머신" 표의 실행 칸은 주소 하나만 받는다(앞뒤 공백 밖에 글이 없다. `https`, 호스트 `github.com`, 경로 `/<owner>/<repo>/actions/runs/<번호>`). 칸은 머리줄의 이름("결과 파일", "실행")으로 찾는다. / 이유: 주소의 일부만 읽으면 적힌 주소와 다른 실행을 확인하게 된다(F1). 칸 전체를 보면 링크 문법·주소 둘 같은 애매한 꼴도 함께 막힌다. / 버린 대안: 번호 뒤에 경계(`\b`, `(?:[/?#]|$)`)만 더하기(`/attempts/1`·질의가 붙은 주소를 받는다. 그 주소가 가리키는 것이 실행 전체인지 시도 하나인지 갈린다), `new URL`로 풀기(칸 안의 다른 글을 따로 막아야 한다).

## 발견 사항

- 이 리포에는 워크플로의 실행 산출물을 올리는 액션을 쓰는 곳이 없었다. 새 액션(`actions/upload-artifact`)을 커밋 SHA로 고정해 쓴다. → 처리: 해당 없음(step0의 워크플로와 구조 테스트에 반영한다)
- 계획 검증을 받는 계획인데 계획 검증 없이 코드를 브랜치에 올리고 제작자 작업을 요청했다(봇의 절차 실수). 워크플로 파일이 든 브랜치는 봇이 계획만 남긴 상태로 되돌릴 수 없어 새 브랜치로 다시 시작했고, 제작자의 워크플로 커밋이 한 번 더 필요해졌다. `new-task`나 `start`가 "중·대 규모 계획은 계획만 담은 초안 PR부터"를 알려 주지만, PR을 열지 않고 push만 한 브랜치는 어떤 검사도 보지 않는다. → 처리: 해당 없음(제작자에게 보고한다)
- (step1) CI 러너에서 `trial.ts`가 Corepack의 다운로드 안내(표준 오류)를 pnpm 버전으로 읽어 두 job이 실패했다. Mac·Windows PC에서는 pnpm이 이미 받아져 있어(또는 Corepack을 거치지 않아) 드러나지 않았다. → 처리: #233
- (step1) 직접 실행 판정 `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`은 링크를 거친 경로(macOS의 `/var`·`/tmp`, 링크한 리포 폴더, Windows의 정션)로 실행하면 거짓이 되어, 스크립트가 아무것도 하지 않고 종료 코드 0으로 끝난다. `verify-artifacts.ts`는 이 step에서 고쳤다. 같은 꼴이 `lab/`의 다른 스크립트(`q10-db/check-results.ts`·`run.ts`, `pilot-prep`, `actions-cost`, `q20`, `ops-transition`)와 `scripts/hooks/guard.ts`·`scripts/hooks/session.ts`·`scripts/verify/web.ts`에 있다. 특히 `guard.ts`(L1 훅)는 링크를 거친 경로로 불리면 아무것도 막지 않는다: 같은 force push 입력이 직접 경로로는 종료 코드 2(R14 차단), 링크를 거친 경로(`<임시 폴더>/link/scripts/hooks/guard.ts`)로는 출력 없이 종료 코드 0이었다(이 Mac, 읽기만 하는 확인). 훅은 `node "$CLAUDE_PROJECT_DIR/scripts/hooks/guard.ts"`로 불리므로, 리포를 링크를 거친 경로로 열면 L1 훅이 꺼진 것과 같다. → 처리: 해당 없음(이 step의 범위 밖이고 `check-results.ts`·`trial.ts`는 AC 일곱째 줄이 고치지 못하게 한다. 제작자에게 보고하고 Issue 등록을 제안한다)
- (step1) 14.3절의 `(ADR-0007, )`: AC 여덟째 줄 때문에 "잠정"만 지워 쉼표와 빈칸이 남았다(의사결정 로그). → 처리: 해당 없음(다음에 설계서를 고치는 PR에서 `(ADR-0007)`로 다듬도록 제작자에게 제안한다)
- (step1) 작업자 이름: Windows PC와 이 Mac의 대화 세션이 모두 기본 이름 `session`이다(`HARNESS_WORKER`를 정하지 않았다). 절차서 1절은 머신마다 고유한 이름을 정하라고 한다. 같은 이름이면 L1 훅(R3)이 서로의 worktree를 자기 것으로 본다. 이번에는 Windows PC의 세션이 멈춘 뒤 넘겨받았고, 같은 머신에서 다른 대화 세션도 `session`으로 돌고 있어 그 세션의 worktree는 건드리지 않았다. → 처리: 해당 없음(제작자에게 알린다. 머신마다 `HARNESS_WORKER`를 정하면 owner를 바꾸는 넘겨받기에 제작자 승인이 필요해진다)

## 열린 질문

없음.

제작자에게 알릴 것(질문이 아니다): step0은 제작자가 봇의 브랜치에 워크플로 파일을 올려야 이어진다(Issue #180에 요청을 남긴다). Windows의 결과는 CI의 Windows 러너에서 얻는다(위 의사결정 로그).

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`.
- 수용 기준 1: `node --test lab/q10-db/test/run.test.ts`, 새 임시 폴더의 복제본에서 `node lab/q10-db/run.ts --skip-fmt`를 실제로 돌린 결과(이 작업 트리의 결과 폴더가 그대로다), `--out`을 주면 `run.ts`와 `trial.ts`가 사용법을 내고 끝나는 것(step0 AC).
- 수용 기준 2: `node --test scripts/test/q10-trial-workflow.test.ts`, 받은 브랜치의 트리가 기준 커밋에 패치를 적용한 트리와 같은지(SECURITY.md의 비교 명령, 진행 로그에 적는다).
- 수용 기준 3: `node lab/q10-db/check-results.ts <이름>` 둘과 `--confirm`, 출처 확인 `node lab/q10-db/verify-artifacts.ts`(step1 AC. 출력을 진행 로그와 PR 본문에 옮긴다).
- 수용 기준 4: 문서를 설정·결과 파일과 견주는 테스트(`lab/q10-db/test/confirmed.test.ts`: ADR의 상태·확정 조건·알려진 한계·결과, ADR 목록, 설계서 18·19절, TD-14 행, 웹 프로파일 README, `lab/q10-db/README.md`)와 `doc-lint`(step1 AC).
- 결과(2026-11-22, step0): AC의 명령 16줄이 모두 통과했다(다섯째 줄은 새 임시 폴더의 복제본에서 절차를 실제로 돌렸다). `node scripts/harness.ts check` 통과. 트리 비교는 진행 로그에 있다.
- 결과(2026-11-23, step0 재작업 F15, 제작자의 Windows 11 PC): AC의 명령 16줄이 모두 통과했다. 다섯째 줄은 이 PC(Windows 네이티브, Git Bash)의 새 임시 복제본에서 절차를 돌렸고 `trial: lab/q10-db/results/win32-x64.json을 썼다`, `win32-x64: 통과`가 나왔다. 그 결과 파일은 복제본에만 있고 리포에 넣지 않았다(결과는 step1에서 워크플로의 산출물로만 더한다). 이 실행은 확정 근거가 아니다: 결과 파일을 남기지 않았고 출처를 확인할 수 없다. 확정 조건의 Windows 결과는 step1에서 CI 러너의 산출물로 더하고 `verify-artifacts.ts`로 출처를 확인한다. 그래서 "제작자의 Windows PC에서 절차가 통과했다(결과 파일 없음)"와 "확정 근거는 CI 산출물이다"를 따로 적어야 한다. step1의 문서 지시는 그에 맞춰 고친다(F16, 의사결정 로그). `node scripts/harness.ts check`는 `test`의 두 건이 Windows에서만 실패했다(main에서도 같다. Issue #228, 의사결정 로그). 나머지는 통과했다.
- 결과(2026-11-23, step1, 이 Mac): 워크플로 실행 45180055726의 두 job 성공, 결과 파일 둘을 더했다. AC의 명령 14줄이 모두 통과했다: `check-results.ts --confirm` 종료 코드 0, `confirmed.test.ts` 10건, `check-results.test.ts`, `run.test.ts`, `profile-web-db.test.ts`, `q10-trial-workflow.test.ts`, 바꾸지 않을 파일(일곱째 줄), 14.3절(여덟째 줄), TD-14 한 행(아홉째 줄), `lint`, `doc-lint`, `fmt --check`, `verify-artifacts.test.ts` 29건, `verify-artifacts.ts` 종료 코드 0(출력은 진행 로그). 음성 확인 세 경우(진행 로그). `node scripts/harness.ts check` 통과.
- 결과(2026-11-23, step1 F1 처리 뒤, 이 Mac): AC의 명령 14줄이 모두 다시 통과했다(`verify-artifacts.test.ts` 32건, `confirmed.test.ts` 10건). 음성 확인 네 경우(진행 로그). `node scripts/harness.ts check` 통과.

## 다음 할 일

1. (끝남) step0: 계획 검증(G1), 구현 판정, 제작자의 워크플로 커밋, 구조 테스트와 완료 처리, #188 병합(`c2cb9ff`).
2. (끝남) 계획 수정 PR #232(`69ecad1`).
3. step1 PR(`Closes #180`): 두 검증자의 판정을 받고, 계획의 risk가 high라 제작자 head 승인을 받아 병합한다. 병합되면 이 계획이 끝난다.
