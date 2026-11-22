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

# ADR-0008 B2: check와 selftest job을 arm64 2코어 러너로 옮긴다

## 목표와 수용 기준

ADR-0008에서 제작자가 묶음 "호스팅 유지"를 골랐다(순서 A6 → B2 → B1 → F2 → A4 → A5 → B3). A6은 이 리포에 이미 들어 있다(Issue #129). 다음 수단 B2는 arm64 2코어 러너(`ubuntu-24.04-arm`, 분당 $0.005. x64 2코어는 분당 $0.006)다. 잃는 보장은 없다(GitHub 호스팅 VM 그대로다. ADR-0008 후보표 B2).

이 계획은 B2의 첫 단계다. 1코어 러너로 옮기지 않을 job(B1의 대상이 아닌 job: `check`, `selftest`, 두 판정 워크플로의 `judge`) 가운데, PR에서 미리 확인할 수 있는 둘을 옮긴다.

- `check` 워크플로의 `check` job: PR 쪽 정의로 돈다. 이 PR의 `check`가 arm64에서 통과해야 병합된다.
- `gates` 워크플로의 `selftest` job: main의 정의로 돌아 병합 뒤에야 arm64에서 돈다. 하는 일(gitleaks 설치, 자체 테스트 시나리오 실행)은 `check` job이 arm64에서 먼저 돌려 본다(`check`의 gitleaks 설치 단계가 같고, 테스트 묶음의 `scripts/test/selftest.test.ts`가 시나리오를 모두 돌린다).

수용 기준:

1. `check.yml`의 `check` job과 `gates.yml`의 `selftest` job의 `runs-on`이 `ubuntu-24.04-arm`이다. 다른 job 17개(`gates`의 `evaluate`·`record`, `judge-claude`의 6개, `judge-codex`의 6개, `revert`의 2개, `review-trigger`의 1개)의 `runs-on`은 `ubuntu-latest` 그대로다.
2. gitleaks를 받는 job(`check`, `selftest`)은 러너의 아키텍처에 맞는 파일과 그 체크섬을 쓴다: `gitleaks_8.30.1_linux_arm64.tar.gz`, SHA-256 `e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080`. 두 job의 버전과 체크섬은 서로 같다(지금의 테스트 그대로).
3. 워크플로의 변경은 준비한 패치(`lab/actions-cost/b2-arm64/workflows.patch`)와 전체가 같다. 패치 밖의 워크플로 변경이 없다.
4. 넣기 전의 값(A6 뒤의 값)이 기록에 있다: 보존 기록 `lab/actions-cost/2026-11-19_2026-11-22.jsonl`과 `docs/harness/actions-cost.md` "기록" 표의 행(수단 `A6`). 행의 값과 판단은 그 보존 기록으로 계산한 값과 같다(문서 검사가 본다).
5. 이 PR의 head에서 `check`가 arm64 러너로 돌아 통과한다(필수 체크라 통과하지 않으면 병합되지 않는다. 돈 러너의 라벨은 실행 기록에서 읽어 PR 본문과 Issue에 적는다).

## 범위 / 비범위

범위:

- `.github/workflows/check.yml`의 `check` job과 `.github/workflows/gates.yml`의 `selftest` job: `runs-on`, gitleaks 파일 이름, 체크섬(job마다 세 줄). 제작자가 올린다(봇은 워크플로 파일을 push할 수 없다. `docs/SECURITY.md` "워크플로 변경 절차").
- 그 구조를 단언하는 테스트.
- 넣기 전 값의 측정과 기록(보존 기록 파일, 기록 표의 행).
- 문서 `docs/harness/actions-cost.md`의 보존 기록 설명 한 문장(PR #205 판정의 F4, P2로 미룬 것: 보존 기록에 `self-hosted` 라벨도 그대로 남는다는 것이 빠져 있다), 변경 이력 한 줄.

비범위:

- 판정 job(`judge-claude`·`judge-codex`의 `judge`)을 arm64로 옮기는 것. 판정 워크플로는 main의 정의로 돌아 PR에서 미리 돌려 볼 수 없고, 깨지면 고치는 PR도 판정을 받지 못한다. 이 단계의 결과를 본 뒤 별도 Issue에서 다룬다.
- 1분 미만 job을 1코어 러너로 옮기는 것(B1). 그 job들은 여기서 건드리지 않는다(B1에서 x64에서 1코어로 바로 옮긴다. 묶음이 가정한 끝 상태와 같다).
- 넣은 뒤의 값을 재는 것. 같은 길이의 기간(나흘)이 지난 뒤, 다음 수단을 넣기 전에 잰다.
- 설계서의 보장과 구조(10.3절, 10.4절, E3). 바뀌지 않는다.
- 하네스를 쓰는 다른 프로젝트의 테스트가 arm64 Linux에서 도는지(프로젝트마다 확인할 일이다. ADR-0008 후보표 B2의 "바꿔야 하는 것").

## 관련 파일·문서

- `.github/workflows/check.yml`
- `.github/workflows/gates.yml`
- `scripts/test/ci.test.ts`
- `lab/actions-cost/b2-arm64/`
- `lab/actions-cost/2026-11-19_2026-11-22.jsonl`
- `docs/harness/actions-cost.md`
- `docs/harness/CHANGELOG.md`
- 읽기만: `docs/SECURITY.md`("워크플로 변경 절차"), `docs/decisions/ADR-0008-actions-cost.md`, `scripts/test/harness-guard.test.ts`, `scripts/test/selftest.test.ts`, `lab/actions-cost/check-doc.ts`, `lab/actions-cost/2026-11-17_2026-11-20.jsonl`, `lab/repro-on-demand/README.md`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `.github/workflows/revert.yml`, `.github/workflows/review-trigger.yml`

## step 목록

- step0 arm64: 넣기 전 값을 재서 기록하고, `check`와 `selftest` job을 arm64 2코어 러너로 옮기는 패치와 구조 테스트를 넣는다.

## 진행 로그

- 2026-11-22 Issue #206을 등록하고(제작자 대화 지시: 묶음 "호스팅 유지"를 차례대로 진행) 계획을 썼다. 계획 검증(G1)을 받는다.
- 2026-11-22 계획을 쓰며 확인한 것:
  - gitleaks 8.30.1의 배포 체크섬 목록(`gitleaks_8.30.1_checksums.txt`)에서 `linux_arm64.tar.gz`의 SHA-256은 `e4a487ee…b080`이다. 파일을 받아 계산한 값과 같다. 같은 목록의 `linux_x64.tar.gz` 값(`551f6fc8…70eb`)은 지금 워크플로에 고정한 값과 같다.
  - 지금 워크플로의 job 19개는 모두 `runs-on: ubuntu-latest`다. `runs-on`을 단언하는 테스트는 아직 없다.
  - 검증자 CLI의 고정 버전(`@anthropic-ai/claude-code@2.1.314`, `@openai/codex@0.167.2`)에는 Linux arm64 빌드가 있다(npm 레지스트리의 `optionalDependencies`). 이 계획은 판정 job을 옮기지 않으므로 쓰지 않는 사실이고, 다음 단계의 근거로 적어 둔다.

## 의사결정 로그

- 결정: B2는 1코어 러너로 옮기지 않을 job에만 넣는다(`check`, `selftest`, `judge` 둘). 1분 미만 job은 B1에서 x64에서 1코어로 바로 옮긴다. / 이유: 끝 상태가 묶음 "호스팅 유지"의 가정과 같고(2코어 arm64에 남는 것은 이 네 job이다. 기준선에서 2331분), 같은 줄을 두 번 바꾸지 않아 제작자가 올릴 워크플로 변경이 준다. 수단의 효과도 job이 겹치지 않아 따로 잴 수 있다. / 대안: 모든 job을 arm64로 옮긴 뒤 B1에서 다시 1코어로 옮긴다(ADR 후보표의 B2 단독 추정 $4.03은 이 방식이다).
- 결정: 판정 job은 이 계획에서 옮기지 않는다. / 이유: 판정 워크플로는 main의 정의로 돈다. arm64에서 검증자 CLI나 샌드박스가 돌지 않으면 병합 뒤에야 드러나고, 그때는 고치는 PR도 판정을 받지 못해 제작자가 보호 설정을 손봐야 한다. `check`는 PR 쪽 정의라 이 PR에서 먼저 확인된다. / 대안: 네 job을 한 번에 옮긴다(제작자 작업은 한 번이지만 깨졌을 때의 범위가 크다).
- 결정: `selftest`는 `check`와 함께 옮긴다. / 이유: `selftest`도 main의 정의로 돌지만, 하는 일을 `check` job이 arm64에서 먼저 돌려 본다(같은 gitleaks 설치 단계, 같은 시나리오). 두 job의 gitleaks 버전·체크섬이 같아야 한다는 지금의 테스트도 그대로 둘 수 있다. / 남는 위험: 병합 뒤 `selftest`가 arm64에서만 실패하면 보호 경로를 바꾸는 PR이 `harness-guard`에서 막히고, 되돌리는 PR도 보호 경로(워크플로)를 바꾸므로 같이 막힌다. 그때는 제작자가 보호 설정을 손봐 되돌려야 한다. 제작자에게 요청할 때 이 위험을 함께 적는다. / 대안: `check`만 옮긴다(위험이 없지만 두 job의 체크섬을 따로 고정하도록 테스트를 고쳐야 하고 264분이 x64에 남는다).
- 결정: 넣기 전 값의 측정과 워크플로 변경을 한 step(PR 하나)에 넣는다. / 이유: 제작자의 승인이 한 번으로 준다. 측정은 워크플로 변경이 병합되기 전의 기간(2026-11-19~22)을 재므로 같은 PR에 있어도 섞이지 않는다. / 대안: 측정만 담은 PR을 먼저 병합한다(승인이 두 번이다).
- 결정: 넣기 전 값의 기간은 2026-11-19~2026-11-22다. / 이유: A6이 들어간 날(2026-11-19)부터의 나흘이고 기준선(나흘)과 길이가 같다. 2026-11-22(UTC)가 끝난 뒤에 잰다. / 대안: 2026-11-18~21(지금 잴 수 있지만 A6 전의 하루가 섞인다).

## 발견 사항

## 열린 질문

없음. 제작자에게 요청할 것(워크플로 커밋, head 승인)은 step0의 순서에 있다.

## 검증 방법과 결과

- step0의 AC(구조 테스트, 패치와 워크플로 트리의 일치, 패치 밖 변경 없음, 보존 기록과 기록 표의 행, 문서 검사, `check`).
- 이 PR의 head에서 돈 `check` 실행의 러너 라벨을 실행 기록에서 읽어 PR 본문과 Issue에 적는다(수용 기준 5).
- 병합 뒤: main의 워크플로에 변경이 들어 있는지, 그 뒤 보호 경로를 바꾸는 첫 PR에서 `selftest`가 arm64로 돌아 통과하는지 보고 Issue에 남긴다(`docs/SECURITY.md` "워크플로 변경 절차" 7).

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다.
- 승인 뒤, 2026-11-22(UTC)가 끝나면 step0을 시작한다(측정 → 패치와 문서 push → 제작자의 워크플로 커밋 → 구조 테스트와 완료 처리).
