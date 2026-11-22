---
id: 20261122-arm64-check
issue: 206 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T17:02:59+09:00 # new-task가 채운다
---

# ADR-0008 B2: check job을 arm64 2코어 러너로 옮긴다

## 목표와 수용 기준

ADR-0008에서 제작자가 묶음 "호스팅 유지"를 골랐다(순서 A6 → B2 → B1 → F2 → A4 → A5 → B3). A6은 이 리포에 이미 들어 있다(Issue #129). 다음 수단 B2는 arm64 2코어 러너(`ubuntu-24.04-arm`, 분당 $0.005. x64 2코어는 분당 $0.006)다. 잃는 보장은 없다(GitHub 호스팅 VM 그대로다. ADR-0008 후보표 B2).

이 계획은 B2의 첫 단계다. 1코어 러너로 옮기지 않을 job(B1의 대상이 아닌 job: `check`, `selftest`, 두 판정 워크플로의 `judge`) 가운데, 병합 전에 실제 조건으로 확인할 수 있는 하나만 옮긴다.

- `check` 워크플로의 `check` job(기준선의 1587분, 39.4%): PR 쪽 정의로 돈다. 이 PR의 head에서 `check`가 arm64 러너로, 실제 job의 조건(같은 단계, 같은 시간 제한) 그대로 돌아 통과해야 병합된다. 병합 뒤에 깨져도 고치는 PR은 자기 정의의 `check`로 돈다.
- `selftest`와 `judge`는 옮기지 않는다. 둘 다 main의 정의로 돌아(`pull_request_target`, `workflow_run`) 병합 전에 실제 job의 조건으로 돌려 볼 수 없다.

수용 기준:

1. `check.yml`의 `check` job의 `runs-on`이 `ubuntu-24.04-arm`이다. 다른 job 18개(`gates`의 3개, `judge-claude`의 6개, `judge-codex`의 6개, `revert`의 2개, `review-trigger`의 1개)의 `runs-on`은 `ubuntu-latest` 그대로다.
2. gitleaks를 받는 job(`check`, `selftest`)은 러너의 아키텍처에 맞는 파일과 그 체크섬을 쓴다. `check`(arm64): `gitleaks_8.30.1_linux_arm64.tar.gz`, SHA-256 `e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080`. `selftest`(x64, 그대로): `gitleaks_8.30.1_linux_x64.tar.gz`, SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`. 두 job의 버전은 같다.
3. 워크플로의 변경은 준비한 패치(`lab/actions-cost/b2-arm64/workflows.patch`)와 전체가 같다. 패치 밖의 워크플로 변경이 없다.
4. 넣기 전의 값(A6 뒤의 값)이 기록에 있다. 기간은 A6이 병합된 시각(2026-11-19 04:56 UTC, PR #130) 뒤의 첫 UTC 자정부터 나흘인 2026-11-20~2026-11-23이고, 이 PR의 워크플로 변경이 병합되기 전에 끝난다. 보존 기록 `lab/actions-cost/2026-11-20_2026-11-23.jsonl`과 `docs/harness/actions-cost.md` "기록" 표의 행(수단 `A6`). 행의 값과 판단은 그 보존 기록으로 계산한 값과 같다(문서 검사가 본다).
5. 이 PR의 head에서 `check`가 arm64 러너로 돌아 통과한다(필수 체크라 통과하지 않으면 병합되지 않는다. 돈 러너의 라벨은 실행 기록에서 읽어 PR 본문과 Issue에 적는다).

## 범위 / 비범위

범위:

- `.github/workflows/check.yml`의 `check` job: `runs-on`, gitleaks 파일 이름, 체크섬(세 줄). 제작자가 올린다(봇은 워크플로 파일을 push할 수 없다. `docs/SECURITY.md` "워크플로 변경 절차").
- 그 구조를 단언하는 테스트. `selftest`와 `check`의 gitleaks 버전·체크섬이 같아야 한다는 지금의 테스트(`scripts/test/harness-guard.test.ts`)는 그 자리에서, 버전이 같고 파일과 체크섬은 job마다 그 러너의 아키텍처의 값이어야 한다는 것으로 바꾼다(두 job의 러너가 달라져 체크섬이 같을 수 없다. 체크섬을 정해 둔 값과 견주므로 느슨해지지 않는다). 고치는 테스트 파일 둘(`ci.test.ts`, `harness-guard.test.ts`)은 파일마다 merge-base에서 단언 실패로 실패해야 한다(`test-effect`).
- 넣기 전 값의 측정과 기록(보존 기록 파일, 기록 표의 행).
- 문서 `docs/harness/actions-cost.md`의 보존 기록 설명 한 문장(PR #205 판정의 F4, P2로 미룬 것: 보존 기록에 `self-hosted` 라벨도 그대로 남는다는 것이 빠져 있다), 변경 이력 한 줄.

비범위:

- `selftest` job과 판정 job(`judge-claude`·`judge-codex`의 `judge`)을 arm64로 옮기는 것. 이 job들은 main의 정의로 돌아 병합 전에 실제 job의 조건(main의 실행기와 따로 받은 PR 트리, 그 job의 시간 제한, 보고서를 job 출력으로 넘기는 것)으로 돌려 볼 수 없고, 병합 뒤에 깨지면 고치는 PR도 같은 job에서 막힌다. 병합 전에 확인할 방법을 마련하는 것까지 별도 Issue에서 다룬다.
- 1분 미만 job을 1코어 러너로 옮기는 것(B1). 그 job들은 여기서 건드리지 않는다(B1에서 x64에서 1코어로 바로 옮긴다. 묶음이 가정한 끝 상태와 같다).
- 넣은 뒤의 값을 재는 것. 같은 길이의 기간(나흘)이 지난 뒤, 다음 수단을 넣기 전에 잰다.
- 설계서의 보장과 구조(10.3절, 10.4절, E3). 바뀌지 않는다.
- 하네스를 쓰는 다른 프로젝트의 테스트가 arm64 Linux에서 도는지(프로젝트마다 확인할 일이다. ADR-0008 후보표 B2의 "바꿔야 하는 것").

## 관련 파일·문서

- `.github/workflows/check.yml`
- `scripts/test/ci.test.ts`
- `scripts/test/harness-guard.test.ts`
- `lab/actions-cost/b2-arm64/`
- `lab/actions-cost/2026-11-20_2026-11-23.jsonl`
- `docs/harness/actions-cost.md`
- `docs/harness/CHANGELOG.md`
- 읽기만: `docs/SECURITY.md`("워크플로 변경 절차"), `docs/decisions/ADR-0008-actions-cost.md`, `.github/workflows/gates.yml`, `lab/actions-cost/check-doc.ts`, `lab/actions-cost/2026-11-17_2026-11-20.jsonl`, `lab/repro-on-demand/README.md`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `.github/workflows/revert.yml`, `.github/workflows/review-trigger.yml`

## step 목록

- step0 arm64: 넣기 전 값을 재서 기록하고, `check` job을 arm64 2코어 러너로 옮기는 패치와 구조 테스트를 넣는다.

## 진행 로그

- 2026-11-22 Issue #206을 등록하고(제작자 대화 지시: 묶음 "호스팅 유지"를 차례대로 진행) 계획을 썼다. 계획 검증(G1)을 받는다.
- 2026-11-22 계획을 쓰며 확인한 것:
  - gitleaks 8.30.1의 배포 체크섬 목록(`gitleaks_8.30.1_checksums.txt`)에서 `linux_arm64.tar.gz`의 SHA-256은 `e4a487ee…b080`이다. 파일을 받아 계산한 값과 같다. 같은 목록의 `linux_x64.tar.gz` 값(`551f6fc8…70eb`)은 지금 워크플로에 고정한 값과 같다.
  - 지금 워크플로의 job 19개는 모두 `runs-on: ubuntu-latest`다. `runs-on`을 단언하는 테스트는 아직 없다.
  - 검증자 CLI의 고정 버전(`@anthropic-ai/claude-code@2.1.314`, `@openai/codex@0.167.2`)에는 Linux arm64 빌드가 있다(npm 레지스트리의 `optionalDependencies`). 이 계획은 판정 job을 옮기지 않으므로 쓰지 않는 사실이고, 다음 단계의 근거로 적어 둔다.
- 2026-11-22 계획 검증 1라운드(PR #207, head `92d908d`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청(P1 2). 둘 다 받아들여 계획을 고쳤다.
  - F1(넣기 전 값의 기간 2026-11-19~22는 A6이 들어간 날의 0시부터라 A6 전에 만들어진 실행이 섞인다): A6의 병합 시각을 확인했다(PR #130, 2026-11-19 04:56 UTC). 기간을 그 뒤 첫 UTC 자정부터의 나흘(2026-11-20~2026-11-23)로 바꾸고 파일 이름, 문서 행, AC를 맞췄다. 재는 때는 2026-11-24 00:00(UTC) 뒤다.
  - F2(`selftest`가 실제 job의 조건으로 arm64에서 통과하는지 병합 전에 확인하지 않는다. 15분 제한, main의 실행기와 따로 받은 PR 트리, 보고서를 job 출력으로 넘기는 것): 병합 전에 그 조건을 재현할 길이 없어(`gates`는 main의 정의로 돈다) `selftest`를 범위에서 뺐다. 이 계획은 `check` job만 옮긴다. 두 job의 gitleaks 체크섬이 같아야 한다는 테스트는 버전이 같고 체크섬은 아키텍처마다 정해 둔 값이어야 한다는 것으로 바꾼다.
- 2026-11-22 계획 검증 2라운드(head `a368ab9`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청(P1 1). F1·F2는 `fixed`.
  - F3(체크섬 단언을 `ci.test.ts`로 옮기고 `harness-guard.test.ts`에 버전 비교만 남기면, 그 파일은 merge-base에서도 통과해 `test-effect`가 `ineffective`로 막는다): 받아들였다. gitleaks 고정값 단언(job마다 파일의 아키텍처와 체크섬)을 `harness-guard.test.ts`의 그 테스트에 둔다. merge-base의 `check.yml`은 x64라 거기서 실패한다. `ci.test.ts`에는 러너 단언과 gitleaks를 받는 job의 목록을 둔다. 두 파일이 파일마다 merge-base에서 단언 실패로 실패하는지 보는 AC(`test-effect --ci`의 파일별 판정)와, 따로 돌린 결과를 진행 로그에 적는 절차를 더했다.
- 2026-11-22 계획 검증 3라운드(head `52973df`): 두 검증자 승인(지적 없음). F3은 `fixed`. 계획 승인 해시 `c3d944ce0d2d`.
- 2026-11-22 step0을 시작했다(측정 전에 할 수 있는 것).
  - 구조 테스트를 먼저 썼다. 지금 워크플로에서 파일마다 단언 실패로 실패한다: `ci.test.ts` 37개 가운데 1개 실패(러너 테스트. `check/check`가 `ubuntu-latest`), `harness-guard.test.ts` 15개 가운데 1개 실패(`check: arm64 파일의 체크섬`). 워크플로의 세 줄을 로컬에서 바꾼 트리에서는 둘 다 통과한다(37개, 15개).
  - 패치(`lab/actions-cost/b2-arm64/workflows.patch`)는 그 통과한 트리의 `git diff -- .github/workflows`다. `origin/main`의 트리에 적용하면 `check.yml`의 세 줄만 바뀐다(지운 줄 3, 더한 줄 3). 로컬에서 바꾼 워크플로와 테스트는 되돌렸다. 테스트는 제작자의 워크플로 커밋 뒤에 올린다.
  - 적용 안내(`lab/actions-cost/b2-arm64/README.md`), 변경 이력, 보존 기록 설명의 문장(PR #205의 F4)을 썼다.
  - 남은 것: 2026-11-24 00:00(UTC) 뒤의 측정과 기록 표의 행. 그때까지 push하지 않는다(push마다 `check`와 판정이 돌아 재는 기간의 분이 는다. 판정은 측정까지 든 변경으로 한 번에 받는다).

## 의사결정 로그

- 결정: B2는 1코어 러너로 옮기지 않을 job에만 넣는다(`check`, `selftest`, `judge` 둘). 1분 미만 job은 B1에서 x64에서 1코어로 바로 옮긴다. / 이유: 끝 상태가 묶음 "호스팅 유지"의 가정과 같고(2코어 arm64에 남는 것은 이 네 job이다. 기준선에서 2331분), 같은 줄을 두 번 바꾸지 않아 제작자가 올릴 워크플로 변경이 준다. 수단의 효과도 job이 겹치지 않아 따로 잴 수 있다. / 대안: 모든 job을 arm64로 옮긴 뒤 B1에서 다시 1코어로 옮긴다(ADR 후보표의 B2 단독 추정 $4.03은 이 방식이다).
- 결정: 판정 job은 이 계획에서 옮기지 않는다. / 이유: 판정 워크플로는 main의 정의로 돈다. arm64에서 검증자 CLI나 샌드박스가 돌지 않으면 병합 뒤에야 드러나고, 그때는 고치는 PR도 판정을 받지 못해 제작자가 보호 설정을 손봐야 한다. `check`는 PR 쪽 정의라 이 PR에서 실제 조건으로 먼저 확인된다. / 대안: 네 job을 한 번에 옮긴다(제작자 작업은 한 번이지만 깨졌을 때의 범위가 크다).
- 결정: `selftest`도 이 계획에서 옮기지 않는다(계획 검증 1라운드 F2로 바꿨다. 처음에는 `check`와 함께 옮기려 했다). / 이유: `selftest`는 main의 정의로 돈다. `check` job이 arm64에서 같은 gitleaks 설치와 같은 시나리오를 돌려 보기는 하지만, 실제 job의 조건(15분 제한, main의 실행기와 따로 받은 PR 트리, 보고서를 job 출력으로 넘기는 것)은 병합 전에 재현되지 않는다. 병합 뒤 arm64에서만 실패하면 보호 경로를 바꾸는 PR이 `harness-guard`에서 막히고, 되돌리는 PR도 보호 경로(워크플로)를 바꾸므로 같이 막힌다. / 치르는 값: 264분(기준선의 6.6%)이 x64에 남고, 두 job의 체크섬을 아키텍처마다 고정하도록 테스트를 고친다. / 대안: 함께 옮기고 위험을 제작자에게 알린다.
- 결정: 넣기 전 값의 측정과 워크플로 변경을 한 step(PR 하나)에 넣는다. / 이유: 제작자의 승인이 한 번으로 준다. 측정은 워크플로 변경이 병합되기 전의 기간(2026-11-20~23)을 재므로 같은 PR에 있어도 섞이지 않는다. 이 PR의 head에서 도는 `check`는 PR 쪽 정의라 제작자의 워크플로 커밋이 올라간 뒤로는 arm64에서 돈다. 그 커밋은 측정을 마친 뒤에 요청한다. / 대안: 측정만 담은 PR을 먼저 병합한다(승인이 두 번이다).
- 결정: 넣기 전 값의 기간은 2026-11-20~2026-11-23이다(계획 검증 1라운드 F1로 바꿨다. 처음에는 2026-11-19~22였다). / 이유: A6은 2026-11-19 04:56 UTC에 병합됐다(PR #130). `actions-cost`는 기간에 만들어진 실행을 날짜(UTC) 단위로 읽으므로, 그 뒤 첫 UTC 자정부터 재야 A6 전의 실행이 섞이지 않는다. 나흘이라 기준선과 길이가 같다. 2026-11-23(UTC)이 끝난 뒤에 재고, 이 PR은 그 뒤에 병합되므로 기간이 B2 전에 끝난다. / 대안: 2026-11-19~22(A6이 들어간 날의 앞 다섯 시간이 섞인다).

## 발견 사항

## 열린 질문

없음. 제작자에게 요청할 것(워크플로 커밋, head 승인)은 step0의 순서에 있다.

## 검증 방법과 결과

- step0의 AC(구조 테스트, 패치와 워크플로 트리의 일치, 패치 밖 변경 없음, 보존 기록과 기록 표의 행, 문서 검사, `check`).
- 이 PR의 head에서 돈 `check` 실행의 러너 라벨을 실행 기록에서 읽어 PR 본문과 Issue에 적는다(수용 기준 5).
- 병합 뒤: main의 워크플로에 변경이 들어 있는지, 병합 뒤 main의 `check`와 그다음 PR의 `check`가 arm64로 돌아 통과하는지 보고 Issue에 남긴다(`docs/SECURITY.md` "워크플로 변경 절차" 7).

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다.
- 승인 뒤, 2026-11-23(UTC)이 끝나면(한국 시간 2026-11-24 09:00) step0을 시작한다(측정 → 패치와 문서 push → 제작자의 워크플로 커밋 → 구조 테스트와 완료 처리).
