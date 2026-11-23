# 세션 인수인계 (2026-11-23)

> 대화 세션 하나(작업자 `mac-session-2`)가 2026-11-21~23에 한 일과 남긴 일. 제작자가 "다음 스텝까지 진행한 뒤 인수인계서를 만들고 작업을 멈춰라"고 해 만들었다.
> **이 파일과 같은 폴더의 `draft-tests.patch`는 PR #207에 push하기 전에 지운다**(PR의 변경에 들어갈 파일이 아니다). 두 파일은 **로컬 커밋에만 있고 원격에는 없다.** 이 worktree를 지우면 사라진다.

## 0. 이어받는 세션이 먼저 할 일

1. `node scripts/harness.ts start`를 실행한다.
2. 열린 `needs-human`: **#180**(Q10 확정, 다른 세션 담당 PR #188). 이쪽 일이 아니다.
3. 이 세션의 열린 PR은 **#207**(초안) 하나다. 열린 PR #226·#217·#188은 다른 세션의 것이라 건드리지 않는다.
4. **선점부터 살린다.** `claim/206`의 마지막 생존 확인은 2026-11-23 00:47 UTC이고 24시간 뒤 만료된다. worktree에서 `node scripts/harness.ts claim-heartbeat --issue 206`을 실행한다.
5. 1절의 측정은 **2026-11-24 00:00 UTC(한국 시간 11월 24일 09:00) 뒤에만** 할 수 있다. 그 전이면 측정을 기다린다. 다른 수단(B1 등)도 먼저 넣지 않는다. 수단을 하나씩 넣고 전후를 재는 절차라, 겹치면 어느 수단의 효과인지 가릴 수 없다.

## 1. 진행 중

### ADR-0008 B2 첫 단계 — Issue #206, PR #207 (`check` job을 arm64 2코어 러너로)

- 배경: ADR-0008에서 제작자가 묶음 **"호스팅 유지"**를 골랐다(2026-11-22). 차례는 A6 → B2 → B1 → F2 → A4 → A5 → B3이다.
  - A6은 이미 들어가 있다(PR #130, 2026-11-19 04:56 UTC 병합). 이 PR이 B2의 첫 단계다.
  - 제작자는 잰 값이 예산을 넘으면 "검증 밖으로"로 넘어가도 된다고 했다. 이 주제를 다시 다룰 때는 "호스팅 유지하는 선에서 개선"과 "검증 밖으로"를 1순위로 둔다(ADR-0008에 반영).
- worktree `harness_project.worktrees/feat/20261122-arm64-check-s0`, 브랜치 `feat/20261122-arm64-check-s0`(선점 `claim/206`). 규모 medium, 위험도 high.
- 계획은 `docs/exec-plans/active/20261122-arm64-check/`의 `plan.md`와 `step0.md`다.
  - 계획 검증(G1)은 3라운드에 두 검증자가 승인했다(head `52973df`, 해시 `c3d944ce0d2d`).
  - 지적 F1~F3은 모두 `fixed`다. 의사결정 로그와 진행 로그에 있다.
- 범위: `check.yml`의 `check` job 하나만 옮긴다(기준선 4028분 가운데 1587분, 39.4%).
  - `selftest`와 판정 job은 main의 정의로 돌아 병합 전에 실제 조건으로 확인할 수 없어 옮기지 않는다(F2). 별도 Issue로 다룬다(아직 만들지 않았다).
- 상태:
  - 원격 head는 `52973df`(계획만)다.
  - 로컬 커밋은 아래 넷이고 **push하지 않았다.**
    - `1b250e8`: 패치와 안내, 문서
    - `9b588bc`: 계획의 다음 할 일
    - `961045c`: `origin/main` 병합. CHANGELOG 충돌을 풀었다.
    - 인수인계 커밋: 이 파일과 `draft-tests.patch`, 진행 로그
  - 측정 전에 push하지 않는 이유: push마다 `check`와 판정이 돌아 재는 기간의 분이 는다. 판정은 측정까지 든 변경으로 한 번에 받는다.
  - 로컬에 준비된 것:
    - `lab/actions-cost/b2-arm64/workflows.patch`: `check.yml`의 세 줄(`runs-on: ubuntu-24.04-arm`, gitleaks 체크섬 `e4a487ee…b080`, 파일 이름 `linux_arm64`).
    - `lab/actions-cost/b2-arm64/README.md`: 제작자 작업 안내.
    - `docs/harness/actions-cost.md`: 단가 줄에 `self-hosted` 예외를 적었다(PR #205의 미룬 P2 F4).
    - `docs/harness/CHANGELOG.md`: #206 한 줄.
  - 구조 테스트는 이 폴더의 `draft-tests.patch`에 있다.
    - 고치는 파일은 `scripts/test/ci.test.ts`(러너 표, gitleaks를 받는 job 목록)와 `scripts/test/harness-guard.test.ts`(job마다 gitleaks 파일의 아키텍처와 체크섬)다.
    - main 병합 뒤 다시 확인했다. 지금 워크플로에서는 파일마다 단언 실패로 실패하고, `workflows.patch`를 적용한 트리에서는 통과한다.
- 진행 차례(`step0.md`의 순서):
  1. **2026-11-24 00:00 UTC 뒤에 잰다.** 2026-11-20~23에 만들어진 실행 가운데 진행 중이거나 대기 중인 것이 없는지 먼저 본다. 잰 시각을 진행 로그에 적는다.

     ```bash
     node scripts/harness.ts actions-cost --since 2026-11-20 --until 2026-11-23 --save lab/actions-cost/2026-11-20_2026-11-23.jsonl
     ```

  2. 기록 표에 행을 더한다. `docs/harness/actions-cost.md`의 "기록" 표, 기준선 행 다음이다.
     - 수단 `A6`, 보존 기록 `` `2026-11-20_2026-11-23.jsonl` ``.
     - 여섯 칸은 `--from` 출력의 "기록 칸" 행을 그대로 옮긴다. 판단 칸에는 "A6 뒤, B2 전의 값. 기준선과 2026-11-20 하루가 겹친다"는 설명을 단다.
     - `node lab/actions-cost/check-doc.ts`로 확인한다.
  3. push 전 정리:
     - 이 파일과 `draft-tests.patch`를 `git rm`하는 커밋을 만든다. 테스트 패치는 이 인수인계 커밋에 남는다. `git show <인수인계 커밋>:docs/exec-plans/active/20261122-arm64-check/draft-tests.patch > <mktemp -d 폴더>/t.patch`로 꺼낸다.
     - 정리를 마치면 `check > 파일 && git fetch -q origin && [ behind = 0 ] && git push origin feat/20261122-arm64-check-s0`로 올린다.
     - 이 PR의 head에 워크플로 변경이 들어가면 보호 경로 PR이 된다. 그래서 PR 본문에 `- [x] 보호 경로 변경: …` 줄을 **처음부터** 넣는다(PR #205에서 빠뜨려 `harness-guard`가 실패했다).
  4. 코드 판정을 받는다. 판정이 끝나면 Issue #206에 `needs-human`으로 제작자 작업을 한 번에 요청한다.
     - 요청에 넣을 것: 브랜치 이름, `check.yml` 세 줄(README 링크), 끝난 뒤 알릴 방법.
     - 제작자는 GitHub 웹에서 그 브랜치에 커밋한다. **측정을 마치기 전에는 요청하지 않는다.** 그 커밋 뒤의 `check`는 arm64에서 돌고, 그 실행이 재는 기간에 섞이면 안 된다.
  5. 제작자 커밋을 받은 뒤:
     - `git fetch` → `git merge --ff-only`로 받는다.
     - `(요청 시 head + workflows.patch)`의 트리와 받은 head의 트리를 통째로 견준다. 다르면 멈추고 다른 곳을 알린다.
     - 같으면 테스트 패치를 `git apply`해 커밋한다.
     - step0의 AC 17줄과 `check`를 통과시키고 `complete-step` → `plan-gate` → push한다.
     - 그 head의 `check`가 `ubuntu-24.04-arm`에서 통과했는지 실행 기록의 job 라벨로 확인해 PR 본문과 Issue에 적는다.
     - 통과하면 `pr-ready`로 제작자 head 승인을 요청한다.
  6. 병합 뒤: main의 `check`가 arm64로 도는지 확인해 Issue에 남긴다.
     - 나흘(같은 길이) 뒤에 B2 뒤의 값을 재서 기록 표에 더한다. 그 측정이 다음 수단 B1의 "앞" 값이다.
     - `selftest`·판정 job의 arm64 이전은 별도 Issue로 한다. 교착 위험(main 정의로 돌아 깨지면 고치는 PR도 막힌다)을 제작자에게 알리고 진행 여부를 묻는다.
- 주의:
  - 워크플로 파일은 봇이 커밋하거나 push하지 않는다(`docs/SECURITY.md` "워크플로 변경 절차").
  - 구조 테스트를 제작자의 커밋보다 먼저 올리지 않는다(그 head의 `check`가 실패한다).
  - 기준선 보존 기록 `lab/actions-cost/2026-11-17_2026-11-20.jsonl`은 고치지 않는다.

## 2. 맡지 않은 일

- 묶음 "호스팅 유지"의 나머지 수단(B1 → F2 → A4 → A5 → B3)은 아직 Issue가 없다. B2를 넣은 뒤의 값을 잰 다음 차례대로 하나씩 등록한다(제작자 대화 지시로 시작한 일이라 봇이 Issue를 등록한다).
  - 수단의 내용과 추정 금액은 `docs/decisions/ADR-0008-actions-cost.md`의 후보표에 있다.
  - B1은 1분 미만 job을 x64에서 1코어(`ubuntu-slim`)로 바로 옮긴다. 단가는 `scripts/metrics/actions-cost.ts`의 `RATE_MILLI`에 이미 있다(PR #205).
- 알게 된 것(Issue로 만들지 않음): `harness-guard`에는 `runs-on` 변경(self-hosted 등)을 약화 신호로 보는 검사가 없다.

## 3. 이 세션에서 끝낸 일

- PR #201(Issue #170): ADR-0008(비공개 리포의 Actions 비용 절감 수단) 채택과 그 구조·금액을 보는 검사 `lab/actions-cost/check-adr.ts`. 코드 판정 7라운드. 제작자 승인 뒤 병합 `2ce57ce`.
- PR #205(Issue #204): `actions-cost`가 arm64 2코어($0.005/분)와 1코어($0.002/분) 러너의 단가를 안다. 출력에 러너별 표가 생겼다. 병합 `7db9062`.
  - 미룬 P2 F4(보존 기록 설명의 `self-hosted` 예외)는 PR #207의 로컬 커밋에서 고쳤다.
- Issue #206 등록, PR #207 계획 검증 통과.

## 4. 이 세션에서 쓴 요령

- **판정 결과 읽기**: head 커밋 상태 `review/codex`의 `target_url`에서 run id를 얻는다. `gh run view <id> --log`의 `VERDICT_B64:` 줄을 base64로 풀면 요약과 지적(근거·제안)이 나온다. 원장은 PR의 `harness-ledger:v1` 댓글의 `| F…` 줄이다.
- **판정 대기**: 백그라운드에서 `until`로 두 판정 상태가 pending이 아니게 될 때까지 기다린다. `mergeable=CONFLICTING`이거나 `^review|^risk-gate|^plan-gate|^harness-guard` 밖의 check가 실패해도 끝낸다. 끝나면 `pr-state`를 본다.
- **워크플로 패치 확인**: `T=$(mktemp -d) && want=$(export GIT_INDEX_FILE="$T/index"; git read-tree origin/main && git apply --cached <패치> && git write-tree)`로 만든 트리를 `git rev-parse HEAD:.github/workflows`와 견준다.
- **로컬에서 패치를 적용해 테스트할 때**: `git apply lab/actions-cost/b2-arm64/workflows.patch`로 적용하고 돌린 뒤 `git checkout -- .github/workflows/check.yml`로 되돌린다. 워크플로 변경은 커밋하지 않는다.
- **`git stash`는 쓰지 않는다**(worktree끼리 공유된다). 이 세션도 처음에 stash에 두었다가 패치 파일로 옮겼다.
- **한글 치환**: `.cjs` 스크립트로 정확한 글자열을 바꾸고, 자리가 하나가 아니면 예외를 던지게 한다. 셸 cwd는 매번 main 체크아웃으로 돌아가므로 `cd <worktree> && …`로 쓴다.
- **보호 경로를 바꾸는 PR**: 본문에 `- [x] 보호 경로 변경: …` 줄을 넣고 CHANGELOG에 한 줄을 적는다.
