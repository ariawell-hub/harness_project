---
id: 20261124-slim-runner
issue: 240 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-24T23:06:44+09:00 # new-task가 채운다
---

# ADR-0008 B1: 1분 미만 job을 1코어 러너(ubuntu-slim)로 옮긴다

## 목표와 수용 기준

ADR-0008에서 제작자가 묶음 "호스팅 유지"를 골랐다(순서 A6 → B2 → B1 → F2 → A4 → A5 → B3). B2의 첫 단계(`check` job을 arm64로, Issue #206, PR #207)는 2026-11-24 13:07 UTC에 병합됐다. 다음 수단 B1은 1분 미만 job을 1코어 러너(`ubuntu-slim`, 분당 $0.002. 지금의 x64 2코어는 분당 $0.006)로 옮긴다. 기준선에서 이 job들의 청구는 1697분이고, 옮기면 $6.79(28.1%, PR당 $0.170)가 준다(ADR-0008 후보표 B1).

옮길 job은 ADR-0008 B1의 13개다.

- `gates`: `evaluate`, `record`
- `judge-claude`: `plan`, `repro`, `record`, `failed`, `ci-failure`
- `judge-codex`: `plan`, `pubkey`, `store`, `repro`, `record`
- `review-trigger`: `trigger`

`review-trigger`를 뺀 12개는 main의 정의로 돈다(`pull_request_target`, `workflow_run`). 병합 전에 실제 조건으로 돌려 볼 수 없고, `ubuntu-slim`에서 깨지면 고치는 PR의 기록과 판정도 막힌다(B2에서 `selftest`를 뺀 이유와 같다). 그래서 러너를 워크플로에 바로 적지 않고 제작자가 정하는 리포 변수 `SHORT_JOB_RUNNER`로 고른다. 변수가 `ubuntu-slim`이면 `ubuntu-slim`이고, 없거나 다른 값이면 지금의 `ubuntu-latest`다. GitHub 식의 문자열 비교는 대소문자를 가리지 않으므로 `UBUNTU-SLIM`처럼 대소문자만 다른 값도 켜진다. 어느 값이든 고르는 러너 라벨은 식에 적힌 두 값(`ubuntu-slim`, `ubuntu-latest`) 가운데 하나다. 워크플로 변경을 병합해도 러너는 바뀌지 않는다. 제작자가 넣기 전 값의 기간이 끝난 뒤 변수를 켜고, 깨지면 변수를 지워 PR 없이 되돌린다.

수용 기준:

1. 위 13개 job의 `runs-on`이 `${{ vars.SHORT_JOB_RUNNER == 'ubuntu-slim' && 'ubuntu-slim' || 'ubuntu-latest' }}`이고, 다른 job의 러너는 바뀌지 않는다. 워크플로 폴더의 모든 job을 보는 구조 테스트가 단언하고, 그 테스트는 merge-base에서 단언 실패로 실패한다(`test-effect`).
2. 워크플로 변경이 main에 들어간 뒤에도 변수를 켜기 전까지 13개 job은 `ubuntu-latest`에서 돈다. 새 정의로 돈 실행으로 확인한다: step0 병합 시각 뒤에 만들어진 같은 리포 PR의 `gates` 실행(`pull_request_target`은 실행을 만들 때의 main 정의로 돈다)과, `head_sha`가 병합 커밋이거나 그 뒤의 main 커밋인 두 판정 워크플로의 실행(`workflow_run`의 `head_sha`는 그때의 main 커밋이다)에서, `gates`의 `evaluate`·`record`, `judge-claude`의 `plan`·`record`, `judge-codex`의 `plan`·`pubkey`·`store`·`record`가 `ubuntu-latest`에서 성공한 실행 링크를 Issue에 남긴다. 병합 전 PR head에서 돈 실행은 옛 main 정의라 이 확인에 쓰지 않는다.
3. 설계서 10.4절의 러너 문단과 E3가 1분 미만 job이 1코어 컨테이너 러너에서 돈다는 것(비밀을 가진 기록 job과 Codex 인증 저장 job 포함), 그 범위, 스위치와 되돌리는 법을 적는다. `docs/SECURITY.md`에 제작자가 변수를 켜고 끄는 절차가 있다.
4. 변수를 켜기 전에 넣기 전의 값(B2 첫 단계 뒤, 2026-11-25~2026-11-28)을 재서 보존 기록과 기록 표의 행으로 남긴다. 그 기간의 러너별 표에 `ubuntu-24.04-arm` 행이 있고 `ubuntu-slim` 행이 없다.
5. 변수를 켠 뒤 완료 처리를 올린 최종 head에서, 그 head의 커밋 상태 `plan-gate`·`review/claude`·`review/codex`가 가리키는 세 실행이 끝나고 세 상태가 성공일 때, 그 실행에서 반드시 도는 8개 job(`gates`의 `evaluate`·`record`, `judge-claude`의 `plan`·`record`, `judge-codex`의 `plan`·`pubkey`·`store`·`record`)이 모두 job 라벨 `ubuntu-slim`, 결과 `success`여야 승인을 요청한다. 확인 명령은 step1에 있다. 조건이 있을 때만 도는 5개(`judge-claude`의 `failed`·`ci-failure`·`repro`, `judge-codex`의 `repro`, 리뷰가 제출될 때 도는 `review-trigger`)는 관찰 기간에 `ubuntu-slim`에서 돈 실행이 있으면 링크를 적고, 없으면 이름을 적어 병합 뒤 Issue에서 이어 본다. 결과는 PR 본문과 Issue에 적는다. 러너 탓으로 실패한 job이 있으면 제작자가 변수를 끄고, 승인을 요청하지 않는다.

## 범위 / 비범위

범위:

- 13개 job의 `runs-on`을 스위치 식으로 바꾸는 워크플로 패치와 적용 안내(제작자가 커밋한다), 그 구조 테스트.
- 설계서 10.4절·E3와 `docs/SECURITY.md`의 문서.
- 넣기 전 값의 측정과 기록, 변수를 켠 뒤의 관찰.

비범위:

- `selftest`와 판정의 `judge` job을 arm64로 옮기는 것(B2의 나머지). 별도 Issue에서 다룬다.
- `revert` 워크플로의 job. ADR-0008 B1의 목록에 없고, `act` job은 main에 push하는 봇 토큰을 가진다.
- `check` job. B2에서 arm64로 옮겼고 1분 미만 job이 아니다.
- 넣은 뒤의 값을 재는 것. 변수를 켠 뒤 나흘이 지나 다음 수단(F2)을 넣기 전에 잰다.
- `harness-guard`에 러너 검사를 더하는 것. 지금 러너를 단언하는 것은 `check`의 구조 테스트이고, 워크플로는 보호 경로라 바꾸면 제작자 승인이 필요하다.

## 관련 파일·문서

- `lab/actions-cost/b1-slim/` (워크플로 패치와 적용 안내)
- `.github/workflows/gates.yml`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `.github/workflows/review-trigger.yml` (제작자가 커밋한다)
- `scripts/test/ci.test.ts` (러너 구조 테스트)
- `docs/harness/design.md` (10.4절, E3)
- `docs/SECURITY.md` (제작자 설정: 1분 미만 job의 러너 변수)
- `docs/harness/changes/20261124-slim-runner-s0.md`, `docs/harness/changes/20261124-slim-runner-s1.md` (변경 조각)
- `lab/actions-cost/2026-11-25_2026-11-28.jsonl`, `docs/harness/actions-cost.md` (step1: 넣기 전 값)
- 읽기만: `docs/decisions/ADR-0008-actions-cost.md`, `scripts/metrics/actions-cost.ts`, `scripts/hooks/rules.ts`, `lab/actions-cost/check-doc.ts`, `docs/harness/workflow.md`, `docs/exec-plans/completed/20261122-arm64-check/`

## step 목록

- step0 switch: 13개 job의 러너 스위치(변수가 없으면 지금 러너), 구조 테스트, 설계서·보안 문서. 병합해도 러너는 바뀌지 않는다.
- step1 slim-on: 넣기 전 값(2026-11-25~2026-11-28)을 재서 기록하고, 제작자가 변수를 켠 뒤 첫 실행들을 관찰해 기록한다.

## 진행 로그

- 2026-11-24 Issue #240을 등록하고(제작자 대화 지시: B2 첫 단계 병합 뒤 B1을 바로 시작) 계획을 썼다. 계획 검증(G1)을 받는다.
- 2026-11-24 계획을 쓰며 확인한 것:
  - `ubuntu-slim`(GitHub 문서 "GitHub-hosted runners", runner-images의 `ubuntu-slim` 목록, 2026-11-24): x64 1 CPU, 5 GB RAM, 14 GB SSD. 비공개 리포에서 쓸 수 있다. 공유 VM 위의 컨테이너에서 돌고("hypervisor level 2 isolation"), 컨테이너는 비특권 모드다. job 제한은 15분이고 넘으면 실패한다. git 2.56.1, gh 2.104.0, jq 1.7, curl, tar, openssl, coreutils, Node.js 24.22.3, npm이 있다. corepack·pnpm과 gzip은 목록에 없고, `sudo`는 문서에 없다. 다른 Node 버전의 도구 캐시는 적혀 있지 않다. 분당 $0.002(`actions_linux_slim`).
  - 13개 job이 쓰는 것: 액션은 `actions/checkout`, `actions/setup-node`(Node 22.20), `actions/create-github-app-token`이고, 명령은 `git`, `gh`, `jq`, `base64`, `node`다. `pnpm`·`sudo`·`docker`는 쓰지 않는다. `setup-node`는 이 이미지에 22.20의 캐시가 없으면 실행마다 내려받는다(가장 짧은 job도 분 단위로 올려 청구되므로 금액은 같다). 가장 긴 제한은 `repro`의 15분으로 러너의 제한과 같다.
  - `review-trigger`는 `pull_request_review`로 PR 쪽 정의로 돈다(워크플로 첫 줄의 설명). Issue #240 본문에 "13개 모두 main의 정의"라고 적은 것은 틀렸다. Issue에 바로잡는 댓글을 단다.
  - `runs-on`에는 `vars` 문맥을 쓸 수 있다(GitHub 문서 "Contexts reference"의 표: `jobs.<job_id>.runs-on`에 `github, needs, strategy, matrix, vars, inputs`). 정하지 않은 변수는 빈 문자열이다. 개인 계정 리포에서는 협업자면 리포 변수를 만들고 바꿀 수 있다(문서 "Store information in variables"). 이 리포의 L1 훅은 `gh variable set/delete`와 `gh api …/actions/variables`를 R20으로 막는다(`scripts/hooks/rules.ts`).
  - 측정 도구의 단가표에 `ubuntu-slim`(분당 $0.002)이 이미 있다(`scripts/metrics/actions-cost.ts`).
- 2026-11-24 B2 첫 단계(Issue #206)에서 넘어온 기록: PR #207의 마지막 head `42a53ab`의 `check`가 `ubuntu-24.04-arm`에서 통과했다(실행 45397198647). 코드 판정 3라운드의 F6(최종 head의 arm64 통과 근거가 검토 입력에 없다)은 반박(판정 워크플로는 head의 `check`가 성공해야 돈다, `.github/workflows/judge-codex.yml:32`)이 받아들여져 `rejected`가 됐다. 그 PR의 로컬 `check`가 한 번은 머신 부하로 `test`의 시간 제한(3600초)을 넘겨 중단됐고 다시 돌려 통과했다. 병합 뒤 main(실행 45400289877)과 그다음 PR(실행 45402159014)의 `check`도 arm64에서 통과했다. 그 PR에 커밋을 더 올리지 않으려고 B2 계획에 적지 못해 여기에 적는다.
- 2026-11-24 계획 검증 1라운드(PR #241, head `f3fea85`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청(P1 3). 셋 다 받아들여 계획을 고쳤다(의사결정 로그).
  - F1(GitHub 식의 문자열 비교는 대소문자를 가리지 않아 `UBUNTU-SLIM`도 켜진다. "다른 값이면 `ubuntu-latest`"라는 설명과 어긋난다): 대소문자만 다른 값도 켜진다는 것과 값마다의 기대 결과(없음, `ubuntu-slim`, 대소문자 변형, 그 밖)를 계획과 step0(안내, 보안 문서, 설계서)에 적었다.
  - F2(step0의 확인은 병합 전 PR head의 실행이라 옛 main 정의의 고정 러너를 본 것일 수 있다): step0에 병합 뒤 관찰(작업 8)을 더했다. 병합 시각 뒤에 만들어진 `gates` 실행과 `head_sha`가 병합 커밋 이후인 판정 실행에서 8개 job이 `ubuntu-latest`로 성공한 것을 Issue에 남긴다. 판정 실행(`workflow_run`)의 `head_sha`는 그때의 main 커밋이다(PR #241의 판정 실행 45412754341의 `head_sha`가 `a06b7fd`였다).
  - F3(승인 전에 성공을 확인해야 하는 job과 미룰 수 있는 job의 구분과 종료 조건이 없다): 반드시 도는 8개와 조건이 있을 때만 도는 5개를 나누고, 최종 head의 커밋 상태가 가리키는 세 실행에서 8개가 모두 `ubuntu-slim`으로 성공했는지 보는 확인 명령을 step1에 넣었다. 그 명령이 `통과`를 내야 승인을 요청한다.

## 의사결정 로그

- 결정: 러너를 리포 변수 `SHORT_JOB_RUNNER`로 고르는 스위치로 바꾼다. 워크플로 변경을 병합하는 것과 러너를 옮기는 것을 나눈다. / 이유: 12개 job이 main의 정의로 돌아 병합 전에 실제 조건으로 확인할 수 없다. `runs-on`을 바로 바꾸면 깨졌을 때 되돌리는 PR의 기록·판정도 같은 job이라 막히고 제작자가 보호 설정을 손봐야 한다. 스위치면 제작자가 변수를 지워 PR 없이 바로 되돌린다. 옮기는 시각도 측정 기간에 맞춰 고를 수 있다. / 대안: `runs-on`을 바로 바꾼다(되돌리기가 막힐 수 있다). PR 쪽 정의로 도는 임시 시험 워크플로로 도구가 있는지 먼저 본다(비밀·environment 단계는 돌려 볼 수 없고, 제작자의 워크플로 커밋이 두 번 더 든다).
- 결정: 변수의 값을 러너 이름으로 그대로 쓰지 않고, 워크플로 식이 두 GitHub 호스팅 러너(`ubuntu-slim`, `ubuntu-latest`) 가운데 하나만 고르게 한다. / 이유: 개인 계정 리포에서는 협업자면 리포 변수를 바꿀 수 있다. 값을 그대로 쓰면 리뷰를 거치지 않은 변수 하나로 비밀을 가진 job의 러너를 아무 라벨로 바꿀 수 있다(예: `self-hosted`. 설계서 10.4절이 금지한다). 두 값으로 묶으면 변수가 바뀌어도 ADR-0008에서 받아들인 두 격리 수준 사이를 오갈 뿐이다. 봇의 변수 변경은 L1 훅이 R20으로 막는다. / 대안: `runs-on: ${{ vars.SHORT_JOB_RUNNER || 'ubuntu-latest' }}`(값 그대로).
- 결정: 변수가 없거나 다른 값이면 `ubuntu-latest`다. / 이유: 변수를 지우거나 잘못 적어도 지금과 같은 VM 러너로 돈다. 병합만으로는 아무것도 바뀌지 않는다. / 대안: 기본을 `ubuntu-slim`으로(병합이 곧 전환이라 스위치의 뜻이 약하다).
- 결정: 대소문자만 다른 값(`UBUNTU-SLIM` 등)도 켜지는 것을 그대로 두고, 계획·안내·보안 문서·설계서에 기대 결과를 적는다(계획 검증 1라운드 F1). / 이유: GitHub 식의 `==`는 문자열의 대소문자를 가리지 않고, 대소문자를 가리는 비교 함수가 없다(`contains`·`startsWith`도 가리지 않는다). 대소문자가 달라도 고르는 라벨은 식에 적힌 소문자 `ubuntu-slim`이라 두 러너로 묶는다는 목적은 그대로다. / 대안: 정확한 철자만 받는 꼴을 찾는다(식만으로는 없다).
- 결정: 승인 전에 성공을 확인해야 하는 job은 최종 head에서 반드시 도는 8개이고, 조건이 있을 때만 도는 5개는 병합 뒤로 미룰 수 있다(계획 검증 1라운드 F3). / 이유: 8개는 `check`가 성공한 head마다 돈다(`gates`의 두 job, 판정 워크플로의 `plan`·`record`, Codex의 `pubkey`·`store`). 5개 가운데 `failed`는 판정 job이 실패했을 때, `ci-failure`는 `check`가 실패했을 때, `repro`는 재현 테스트가 붙은 지적이 있을 때, `review-trigger`는 리뷰가 제출될 때(봇은 리뷰를 제출하지 않는다, R20) 돈다. 일부러 실패를 만들어 돌리지 않는다. 최종 head의 실행은 그 head의 커밋 상태가 가리키는 실행으로 집는다(판정 워크플로 실행의 `head_sha`는 PR head가 아니라 main 커밋이라 커밋으로 찾을 수 없다). / 대안: 13개 모두 승인 전에 확인한다(5개는 일부러 실패나 지적을 만들어야 돈다).
- 결정: 기본 러너 확인(수용 기준 2)은 step0 병합 뒤 새 정의로 만들어진 실행으로 한다(계획 검증 1라운드 F2). / 이유: 병합 전 PR head에서 도는 `gates`·판정 워크플로는 그때의 main 정의(고정 러너)로 돌아 스위치를 확인하지 못한다. 병합 자체는 `gates`를 돌리지 않으므로 그 뒤 같은 리포 PR의 이벤트를 기다린다. / 대안: 병합 전 PR head의 실행으로 확인한다(옛 정의다).
- 결정: 비밀을 가진 job(`recorder`의 기록 job 셋과 `ci-failure`, `codex-auth-store`의 `pubkey`·`store`)도 옮긴다. / 이유: 제작자가 묶음 "호스팅 유지"를 고를 때 잃는 보장에 "1분 미만 job이 VM이 아니라 컨테이너에서 돈다. 비밀을 가진 기록 job 포함"이 있었고, 그 묶음의 금액은 이 job들을 옮긴다고 셌다(옮기지 않으면 예산을 넘는다고 적었다). / 대안: 비밀이 없는 job(795분)만 옮긴다($3.18).
- 결정: `review-trigger`도 같은 스위치로 옮긴다. / 이유: ADR-0008 B1의 목록에 있고, 13개를 한 변수로 켜고 꺼야 효과를 한 번에 잴 수 있다. PR 쪽 정의로 돌지만 비밀·체크아웃이 없는 `echo` 한 줄이다. / 대안: `runs-on: ubuntu-slim`으로 바로 바꾼다(스위치와 따로 움직여 측정이 섞인다).
- 결정: 넣기 전 값은 2026-11-25~2026-11-28이고, 변수는 그 기간이 끝나고 잰 뒤에 켠다(step1). / 이유: B2 첫 단계가 2026-11-24 13:07 UTC에 병합됐고 `actions-cost`는 날짜(UTC) 단위로 읽으므로 그 뒤 첫 UTC 자정부터 나흘이다. 기준선과 A6 행과 길이가 같다. 이 기간이 B2 첫 단계를 넣은 뒤의 값이기도 하다. 그 기간에 `origin/main`을 병합하지 않은 PR의 `check`는 x64로 돈다(PR 쪽 정의). / 대안: B2 뒤의 값을 따로 재는 PR을 둔다(측정이 같은 기간이라 두 번 잴 까닭이 없다).
- 결정: step을 둘로 나눈다. step0은 스위치와 문서(병합해도 바뀌지 않는다), step1은 측정·켜기·관찰이다. / 이유: step0은 2026-11-29를 기다리지 않고 병합할 수 있다. 측정이 끝나야 켤 수 있으므로 측정과 켜기를 한 PR에 둔다. / 대안: 한 PR에 모두 넣는다(2026-11-29까지 열려 있고, 측정 전에는 제작자의 워크플로 커밋을 받을 수 없다).

## 발견 사항

- Issue #240 본문의 "13개 모두 main의 정의로 돈다"는 틀렸다(`review-trigger`는 PR 쪽 정의). → 처리: Issue #240에 바로잡는 댓글
- `ubuntu-slim` 이미지 목록에 gzip이 없다. `actions/setup-node`는 Node를 `.tar.gz`로 받아 풀 수 있다. 실제로 도는지는 step1에서 변수를 켠 뒤 첫 실행으로 본다. → 처리: step1의 관찰(수용 기준 5)

## 열린 질문

없음. 제작자에게 요청할 것(step0의 워크플로 커밋과 head 승인, step1의 변수 켜기와 head 승인)은 각 step의 순서에 있다.

## 검증 방법과 결과

- step0의 AC: 구조 테스트, 패치와 워크플로 트리의 일치, 패치 밖 변경 없음, 스위치 식이 13줄뿐인지, 설계서·보안 문서, 변경 조각, `check`.
- step0 병합 뒤: 새 정의로 만들어진 실행에서 8개 job이 `ubuntu-latest`로 성공한 것을 보고 Issue에 남긴다(수용 기준 2, step0 작업 8).
- step1의 AC: 보존 기록과 기록 표의 행, 러너별 표, 문서 검사, 변경 조각, `check`.
- step1에서 변수를 켠 뒤: 최종 head의 확인 명령(step1 작업 5)이 `통과`를 내는지, 미룬 5개 job의 관찰을 PR 본문과 Issue에 적는다(수용 기준 5).

## 다음 할 일

- 계획만 담은 head로 계획 검증(G1)을 받는다.
- 승인되면 step0의 작업(패치·안내·문서·변경 조각)을 올려 판정을 받고, Issue #240에 제작자의 워크플로 커밋을 요청한다.
- 선점은 `claim-heartbeat --issue 240`으로 유지한다(24시간마다 만료).
