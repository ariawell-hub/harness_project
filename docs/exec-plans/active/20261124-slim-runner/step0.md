# Step 0: switch

## 읽어야 할 파일

- 이 계획의 `plan.md`(목표와 수용 기준, 의사결정 로그)
- `docs/SECURITY.md`의 "워크플로 변경 절차"(순서와, 계획 검증을 받는 계획에서의 순서)
- `docs/decisions/ADR-0008-actions-cost.md`(후보표의 B1, 묶음 "호스팅 유지"의 잃는 보장, "결정")
- `.github/workflows/gates.yml`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `.github/workflows/review-trigger.yml`(고칠 곳), 그 밖의 워크플로(읽기만)
- `scripts/test/ci.test.ts`의 러너 테스트("워크플로: check job만 arm64 2코어 러너로 돌고 나머지 job의 러너는 그대로다")와 `workflowJobs()`·`jobs()` 도우미
- `docs/harness/design.md`의 E3 행(1절 결정 표)과 10.4절의 "self-hosted 러너는 쓰지 않는다" 문단
- `scripts/hooks/rules.ts`의 R20 규칙 가운데 `gh variable`과 `actions/variables`를 막는 부분(읽기만)
- `lab/actions-cost/b2-arm64/README.md`, `lab/actions-cost/b2-arm64/workflows.patch`(패치와 적용 방법을 두는 방식의 본보기)
- Issue #240

## 작업

순서는 `docs/SECURITY.md` "워크플로 변경 절차"의 계획 검증을 받는 계획의 순서다: 봇이 워크플로 파일과 구조 테스트를 뺀 나머지를 올려 판정을 받는다 → 제작자에게 요청한다 → 제작자의 워크플로 커밋 → 봇이 트리를 비교하고 구조 테스트와 완료 처리를 올린다.

스위치 식은 아래 한 가지다. 이 step의 모든 곳(패치, 테스트, 문서)에서 글자 그대로 같게 쓴다.

```yaml
runs-on: ${{ vars.SHORT_JOB_RUNNER == 'ubuntu-slim' && 'ubuntu-slim' || 'ubuntu-latest' }}
```

변수 값마다 고르는 러너(GitHub 식의 `==`는 문자열의 대소문자를 가리지 않는다. 계획 검증 1라운드 F1). 안내·보안 문서·설계서에 이 표의 내용을 그대로 적는다.

| `SHORT_JOB_RUNNER`의 값                             | 러너            |
| --------------------------------------------------- | --------------- |
| 없음(빈 문자열)                                     | `ubuntu-latest` |
| `ubuntu-slim`                                       | `ubuntu-slim`   |
| 대소문자만 다른 값(`UBUNTU-SLIM`, `Ubuntu-Slim` 등) | `ubuntu-slim`   |
| 그 밖의 값(`ubuntu-latest`, `self-hosted`, `on` 등) | `ubuntu-latest` |

어느 값이든 고르는 라벨은 식에 적힌 두 값 가운데 하나다(대소문자가 달라도 라벨은 소문자 `ubuntu-slim`이다).

### 1. 워크플로 패치 (`lab/actions-cost/b1-slim/workflows.patch`)

- 네 파일에서 아래 13개 job의 `    runs-on: ubuntu-latest` 줄(앞 공백 4칸)을 스위치 식으로 바꾼다. 줄을 더하거나 지우지 않는다. 다른 줄과 다른 job은 그대로다.
  - `gates.yml`: `evaluate`, `record`
  - `judge-claude.yml`: `plan`, `repro`, `record`, `failed`, `ci-failure`
  - `judge-codex.yml`: `plan`, `pubkey`, `store`, `repro`, `record`
  - `review-trigger.yml`: `trigger`
- 로컬에서 네 파일을 바꾼 트리를 만들어 아래 3의 테스트가 통과하는 것을 본 뒤, 그 트리의 `git diff -- .github/workflows`를 패치로 둔다. 그 뒤 로컬의 워크플로 변경은 되돌린다(워크플로는 제작자가 커밋한다).

### 2. 적용 안내 (`lab/actions-cost/b1-slim/README.md`)

B2의 안내(`lab/actions-cost/b2-arm64/README.md`)와 같은 꼴로 쓴다.

- 바꾸는 것: 파일마다 job 이름과 줄 번호, 바꾸기 전과 뒤의 줄. 스위치 식의 뜻(위의 값마다의 표. 대소문자만 다른 값도 켜진다는 것 포함).
- 제작자 작업: GitHub 웹에서 브랜치 `feat/20261124-slim-runner-s0`의 네 파일을 고쳐 그 브랜치에 바로 커밋한다(파일마다 커밋 하나). 에이전트가 도는 머신의 터미널에서 하지 않는다(설계서 E5). 이 step에서는 변수를 만들지 않는다.
- 커밋 뒤의 일: 그 head의 `check`는 기존 러너 테스트가 옛 러너를 요구해 한 번 실패한다(기대한 실패). 봇이 트리를 비교하고 구조 테스트를 올린다.
- 봇이 확인한 것: 테스트가 지금 워크플로에서 실패하고 패치를 적용한 트리에서 통과한다. 패치는 그 트리의 diff다.
- 켜고 끄는 법: `docs/SECURITY.md`의 새 절(아래 5) 링크. 켜는 것은 step1에서 봇이 요청할 때다.
- 옮기지 않은 것: `check`, `selftest`, 판정의 `judge`, `revert`의 두 job(이유 한 줄씩).
- 되돌리는 방법: 러너만 되돌리려면 변수를 지운다(PR이 필요 없다). 스위치 식을 걷어 내려면 워크플로 13줄(제작자)과 러너 테스트의 기대값(봇)을 한 PR에서 함께 `ubuntu-latest`로 맞춘다. 워크플로만 바꾸면 구조 테스트가 그 PR의 `check`를 실패시킨다.

### 3. 구조 테스트 (`scripts/test/ci.test.ts`, 초안은 `lab/actions-cost/b1-slim/tests.patch`)

- 러너 테스트의 표에서 13개 job의 기대값을 스위치 식(`runs-on:` 뒤의 글자)으로 바꾼다. 다른 job의 기대값은 그대로다. 식은 상수 하나로 두고 표와 아래 테스트가 같이 쓴다.
- 테스트를 하나 더한다: 워크플로 폴더의 모든 job 가운데 `runs-on`에 식(`${{`)이 든 job은 위 13개와 `q10-trial/trial`(`${{ matrix.os }}`)뿐이고, 13개의 식은 상수와 글자 그대로 같다. 워크플로 파일에서 `ubuntu-slim`이 나오는 줄은 이 13줄뿐이다. 실패 메시지에는 어긋난 job의 이름을 넣는다.
- 지금 워크플로에서 이 파일이 단언 실패로 실패하고(러너 표가 13개 job에서 어긋난다), 패치를 적용한 트리에서 통과하는 것을 본다. 결과(테스트 수, 실패 수)를 진행 로그에 적는다.
- 테스트 변경은 제작자의 워크플로 커밋 전에는 `scripts/test/ci.test.ts`에 올리지 않는다(올리면 그 head의 `check`가 실패한다). 그동안은 `git diff -- scripts/test/ci.test.ts`를 `lab/actions-cost/b1-slim/tests.patch`로 올려 판정에서 함께 본다. 제작자의 커밋을 받은 뒤 `git apply`로 적용하고, 같은 커밋에서 `tests.patch`를 지운다.
- 다른 테스트 파일이 이 job들의 실제 워크플로 줄을 견주다가 실패하면 그 테스트도 고치고, 그 파일도 merge-base에서 단언 실패로 실패하는지 본다(`test-effect`).

### 4. 설계서 (`docs/harness/design.md`)

- 10.4절의 "self-hosted 러너는 쓰지 않는다" 문단: self-hosted 금지는 그대로 둔다. "모든 작업은 GitHub 호스팅(일회용) 러너에서 돈다"와 하위 항목의 "고른 수단(1코어 컨테이너 러너 등)을 구현하는 Issue가 고치기 전까지 이 문단은 그대로다"를 아래 내용으로 바꾼다.
  - 13개 job은 리포 변수 `SHORT_JOB_RUNNER`가 `ubuntu-slim`이면 1코어 러너(`ubuntu-slim`)에서 돈다. 이 러너는 job마다 새 VM이 아니라 공유 VM 위의 job마다 새 컨테이너다(GitHub 문서의 표현을 적고 출처를 단다). 그 가운데 기록 job(`recorder`)과 Codex 인증 저장 job(`codex-auth-store`)은 비밀을 가진다.
  - 나머지 job(`check`, `selftest`, 판정의 `judge`, `revert`)은 VM 러너에서 돈다.
  - 변수의 값은 워크플로 식이 두 러너 가운데 하나로만 바꾼다. 변수로 다른 러너를 고를 수 없다. 비교는 대소문자를 가리지 않는다(위의 값마다의 표).
  - 변수는 제작자가 바꾼다(R20. L1 훅이 봇의 `gh variable`·`actions/variables` 호출을 막는다). 리포의 다른 협업자도 바꿀 수 있지만 두 러너 사이를 오갈 뿐이다. 되돌리려면 변수를 지운다(`docs/SECURITY.md`).
  - ADR-0008 링크와 제작자가 묶음을 고른 날(2026-11-22)은 남긴다.
- E3 행: "둘 다 GitHub 호스팅(일회용) 러너에서 실행하고"를, 판정(`judge`)은 GitHub 호스팅 VM 러너에서 돌고 1분 미만 job(기록 job과 Codex 인증 저장 job 포함)은 스위치를 켜면 1코어 컨테이너 러너에서 돈다는 뜻으로 고친다(10.4절 참조). 나머지 문장은 그대로다.
- 머리말의 버전과 변경 이력에는 줄을 더하지 않는다(변경 조각에 적는다).

### 5. 보안 문서 (`docs/SECURITY.md`)

"필수 체크 등록 (제작자)" 절 뒤에 절 하나를 더한다: "1분 미만 job의 러너 변수 (제작자)".

- 무엇: 리포 변수 `SHORT_JOB_RUNNER`. 값마다 고르는 러너의 표(위의 표 그대로. 대소문자만 다른 값도 켜진다). 잃는 보장(컨테이너 격리, 비밀을 가진 job 포함)과 설계서 10.4절 링크.
- 켜기: GitHub → 리포 → Settings → Secrets and variables → Actions → Variables 탭 → New repository variable. Name `SHORT_JOB_RUNNER`, Value `ubuntu-slim`. 봇이 요청할 때 한다(넣기 전 값을 잰 뒤).
- 끄기(되돌리기): 같은 화면에서 변수를 지운다. 바로 다음 실행부터 `ubuntu-latest`다. PR이 필요 없다.
- 확인: 봇이 실행 기록의 job 라벨(`gh api …/actions/runs/<id>/jobs`의 `labels`)을 본다.
- 봇은 이 변수를 만들거나 바꾸지 않는다(R20, L1 훅이 막는다).

### 6. 변경 조각 (`docs/harness/changes/20261124-slim-runner-s0.md`)

`docs/harness/CHANGELOG.md`는 고치지 않는다. 조각의 `## CHANGELOG`에 한 줄: Issue #240, 13개 job의 러너 스위치(변수가 없으면 지금 러너라 병합만으로는 바뀌지 않는다), 두 러너로 묶은 이유, 구조 테스트, 옮기지 않은 job. 설계서를 고치므로 `## 설계서 변경 이력`에 한 줄: 10.4절·E3의 바뀐 내용.

### 7. 제작자에게 요청하고, 받은 것을 확인한다

- 1·2·4·5·6과 3의 `tests.patch`를 올려 판정을 받은 뒤 Issue #240에 요청을 남긴다(`needs-human`): 브랜치 이름, 파일마다 바꿀 줄과 위치(README 링크), 커밋 뒤 한 번 실패하는 `check`, 끝난 뒤 알릴 방법. 요청은 한 번에 모은다. 요청할 때의 head를 기준 커밋으로 진행 로그에 적는다.
- 제작자의 커밋을 받으면(`git fetch origin <브랜치>`, `git merge --ff-only origin/<브랜치>`) 봇이 커밋을 더하기 전에, 기준 커밋의 트리에 패치를 적용한 결과와 받은 head의 트리를 통째로 견준다(`docs/SECURITY.md`의 명령). 다르면 멈추고 제작자에게 다른 곳을 알린다. 결과를 진행 로그에 적는다.
- 같으면 `tests.patch`를 적용하고 그 파일을 지워 커밋하고, AC와 `check`를 통과시키고, 완료 처리한 뒤 push한다.
- push 뒤 그 head의 `check`가 통과하는 것을 확인한다. 이 PR의 head에서 도는 `gates`와 판정 워크플로는 그때의 main 정의(고정 러너)로 돌므로 스위치의 확인에 쓰지 않는다(아래 8).

### 8. 병합 뒤 관찰 (수용 기준 2)

- 병합 커밋과 병합 시각을 Issue #240에 적는다(step0의 PR은 병합으로 끝나므로, 계획의 진행 로그에는 step1의 PR이 옮겨 적는다).
- 관찰 대상은 병합 시각 뒤에 `check`가 성공한 같은 리포 PR의 head 하나다. 두 판정 워크플로와 Codex 인증 job(`pubkey`·`store`)이 모두 돌려면 두 검증자가 모두 판정하는 PR이어야 한다(위험도 높음이거나 보호 경로를 바꾼 PR. 절차서 5절). 병합 자체는 `gates`를 돌리지 않는다. 그런 다른 PR의 이벤트가 없으면 step1 PR의 첫 push(계획 `risk: high`이고 보호 경로 `docs/harness/actions-cost.md`를 바꾼다)를 관찰 대상으로 쓴다. step1은 이 관찰을 기다리지 않고 시작하고, 이 관찰은 step1이 변수를 켜 달라고 요청하기(step1 작업 4) 전에 끝낸다.
- 그 head의 커밋 상태 `plan-gate`·`review/claude`·`review/codex`가 가리키는 세 실행(`target_url`)을 쓴다. 새 정의로 돈 실행인지 본다: `gates` 실행은 `created_at`이 병합 시각 뒤다(`pull_request_target`은 실행을 만들 때의 main 정의로 돈다). 두 판정 실행은 `head_sha`가 병합 커밋이거나 그 뒤의 main 커밋이다(`workflow_run`의 `head_sha`는 그때의 main 커밋이다. `git merge-base --is-ancestor <병합 커밋> <head_sha>`).
- 그 세 실행에서 8개 job(`gates`의 `evaluate`·`record`, `judge-claude`의 `plan`·`record`, `judge-codex`의 `plan`·`pubkey`·`store`·`record`)의 job 라벨이 `ubuntu-latest`이고 결과가 `success`인 것을 확인한다. step1 작업 5의 확인 명령을 `SHA=<그 head의 40자 SHA> L=ubuntu-latest`로 돌리면 같은 것을 본다. 실행 링크와 함께 Issue #240에 남긴다.
- 라벨이 `ubuntu-latest`가 아니면(변수가 이미 있다) 멈추고 제작자에게 알린다.

## Acceptance Criteria

```bash
node --test scripts/test/ci.test.ts && \
T=$(mktemp -d) && node scripts/harness.ts test-effect --ci > "$T/te" 2>&1 && grep -qF "scripts/test/ci.test.ts: effective(base에서 단언 실패" "$T/te" && \
T=$(mktemp -d) && want=$(export GIT_INDEX_FILE="$T/index"; git read-tree origin/main && git apply --cached lab/actions-cost/b1-slim/workflows.patch && git write-tree) && test -n "$want" && test "$(git rev-parse "$want:.github/workflows")" = "$(git rev-parse "HEAD:.github/workflows")" && \
test "$(git diff --name-only origin/main HEAD -- .github | sort | tr '\n' ' ')" = ".github/workflows/gates.yml .github/workflows/judge-claude.yml .github/workflows/judge-codex.yml .github/workflows/review-trigger.yml " && \
T=$(mktemp -d) && git diff origin/main HEAD -- .github/workflows > "$T/d" && test "$(grep -c "^-[^-]" "$T/d")" = 13 && test "$(grep -c "^+[^+]" "$T/d")" = 13 && \
S="runs-on: \${{ vars.SHORT_JOB_RUNNER == 'ubuntu-slim' && 'ubuntu-slim' || 'ubuntu-latest' }}" && test "$(cat .github/workflows/*.yml | grep -cF "$S")" = 13 && test "$(cat .github/workflows/*.yml | grep "runs-on:" | grep -c "vars\.")" = 13 && test "$(cat .github/workflows/*.yml | grep -c "ubuntu-slim")" = 13 && \
test -s lab/actions-cost/b1-slim/README.md && test "$(grep -c "^diff --git" lab/actions-cost/b1-slim/workflows.patch)" = 4 && test ! -e lab/actions-cost/b1-slim/tests.patch && \
! grep -qF "고치기 전까지 이 문단은 그대로다" docs/harness/design.md && T=$(mktemp -d) && awk '/^### 10\.4 /{s=1;next} /^##+ /{s=0} s' docs/harness/design.md > "$T/s" && grep -qF "SHORT_JOB_RUNNER" "$T/s" && grep -qF "ubuntu-slim" "$T/s" && grep -qF "self-hosted 러너는 쓰지 않는다" "$T/s" && grep "^| E3 |" docs/harness/design.md | grep -qF "컨테이너" && \
grep -qF "SHORT_JOB_RUNNER" docs/SECURITY.md && grep -qF "1분 미만 job의 러너 변수" docs/SECURITY.md && \
grep -q "#240" docs/harness/changes/20261124-slim-runner-s0.md && grep -q "^## 설계서 변경 이력" docs/harness/changes/20261124-slim-runner-s0.md && git diff --quiet origin/main HEAD -- docs/harness/CHANGELOG.md && \
node scripts/harness.ts check
```

- 블록은 줄 끝의 `&& \`로 이은 하나의 명령이다. 한 줄이라도 실패하면 뒤의 줄은 돌지 않고 블록 전체가 0이 아닌 종료 코드로 끝난다. 아래 "N째 줄"은 블록 안의 줄 차례다.
- `origin/main`과 견주는 줄은 로컬의 `origin/main`을 쓴다(AC를 돌리기 전에 `git fetch origin`으로 맞추고, main이 앞서 있으면 `origin/main`을 병합한 뒤에 돌린다).
- 첫째 줄: 러너 구조 테스트. 둘째 줄: 고친 테스트 파일이 merge-base의 코드에서 단언 실패로 실패한다(통과하면 `ineffective`라 `test-effect`가 실패한다).
- 셋째 줄: `origin/main`의 트리에 패치를 적용한 결과와 이 브랜치 head의 `.github/workflows` 폴더가 통째로 같다.
- 넷째·다섯째 줄: `.github` 아래에서 바뀐 파일은 네 워크플로뿐이고, 바뀐 줄은 지운 줄 13과 더한 줄 13이다.
- 여섯째 줄: 스위치 식이 든 줄은 13줄이고, `runs-on`에 변수를 쓰는 줄도 그 13줄뿐이고, `ubuntu-slim`이 나오는 줄도 그 13줄뿐이다.
- 일곱째 줄: 안내와 패치가 있고(패치는 네 파일), 테스트 초안 파일은 적용과 함께 지웠다.
- 여덟째 줄: 10.4절의 옛 문구가 없고, 10.4절에 변수 이름과 러너 이름이 있고 self-hosted 금지는 남았고, E3 행이 컨테이너 러너를 적는다.
- 아홉째 줄: 보안 문서에 변수의 절이 있다. 열째 줄: 변경 조각(#240, 설계서 변경 이력)이 있고 CHANGELOG는 main 그대로다. 조각의 형식은 마지막 줄의 `check`(`doc-lint`의 `R8 변경 조각`)가 본다.

## 금지사항

- `.github/workflows/`의 파일을 봇이 커밋하지 않는다. 이유: 봇 토큰에는 `workflow` 권한이 없어 push가 거부되고, 워크플로는 제작자가 올리는 것이 절차다(`docs/SECURITY.md`).
- 리포 변수 `SHORT_JOB_RUNNER`를 만들거나 바꾸지 않고, 이 step에서 제작자에게 만들어 달라고 요청하지도 않는다. 이유: R20이고, 넣기 전 값의 기간(2026-11-25~2026-11-28)이 끝나고 잰 뒤에 켜야 측정이 섞이지 않는다(step1).
- 스위치 식을 바꿔 쓰지 않는다(값을 그대로 러너로 쓰는 `${{ vars.SHORT_JOB_RUNNER }}`나 `|| 'ubuntu-latest'`만 둔 꼴). 이유: 리뷰를 거치지 않은 변수 하나로 비밀을 가진 job의 러너를 아무 라벨로 바꿀 수 있게 된다(의사결정 로그).
- 13개 밖의 job(`check`, `selftest`, 판정의 `judge`, `revert`, `q10-trial`)의 러너를 바꾸지 않는다. 이유: 범위 밖이고, 판정·`selftest`는 main의 정의로 돌아 병합 전에 확인할 수 없다.
- 제작자의 워크플로 커밋 전에 `scripts/test/ci.test.ts`의 변경을 올리지 않는다. 이유: 그 head의 `check`가 실패하고, 워크플로 커밋이 빠진 head가 통과하지 못하게 하는 순서가 깨진다.
- `docs/harness/CHANGELOG.md`와 설계서 머리말·변경 이력을 고치지 않는다. 이유: 보호 경로 PR의 변경 기록은 변경 조각에 적는다(PR #227 뒤의 규칙).
