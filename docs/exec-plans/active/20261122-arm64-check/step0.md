# Step 0: arm64

## 읽어야 할 파일

- `docs/SECURITY.md`의 "워크플로 변경 절차"(순서와, 계획 검증을 받는 계획에서의 순서)
- `docs/harness/actions-cost.md`("재는 방법", "판단 절차", "기록")
- `docs/decisions/ADR-0008-actions-cost.md`(후보표의 B2·B1, 묶음 "호스팅 유지", "결정")
- `.github/workflows/check.yml`, `.github/workflows/gates.yml`(고칠 곳), 그 밖의 워크플로 넷(읽기만)
- `scripts/test/ci.test.ts`(`jobs()` 도우미와 워크플로 구조 테스트), `scripts/test/harness-guard.test.ts`(`selftest`와 `check`의 gitleaks 버전·체크섬이 같은지 보는 테스트)
- `lab/repro-on-demand/README.md`, `lab/repro-on-demand/workflows.patch`(패치와 적용 방법을 두는 방식의 본보기)
- `lab/actions-cost/check-doc.ts`(기록 표의 행을 보존 기록과 견주는 검사), `lab/actions-cost/README.md`
- 이 계획의 `plan.md`(의사결정 로그)
- Issue #206

## 작업

순서는 `docs/SECURITY.md` "워크플로 변경 절차"의 계획 검증을 받는 계획의 순서다: 봇이 워크플로 파일과 구조 테스트를 뺀 나머지를 올려 판정을 받는다 → 제작자에게 요청한다 → 제작자의 워크플로 커밋 → 봇이 트리를 비교하고 구조 테스트와 완료 처리를 올린다.

### 1. 넣기 전 값을 잰다 (`lab/actions-cost/2026-11-19_2026-11-22.jsonl`)

```bash
T=$(mktemp -d) && node scripts/harness.ts actions-cost --since 2026-11-19 --until 2026-11-22 --save lab/actions-cost/2026-11-19_2026-11-22.jsonl > "$T/live.md"
```

- 2026-11-23 00:00(UTC) 뒤에, 그 기간에 만들어진 실행 가운데 진행 중이거나 대기 중인 것이 없을 때 잰다. 잰 시각과 그때 진행 중인 실행이 없었다는 확인을 진행 로그에 적는다. 보존 기록에는 시각이 없어 AC는 이것을 보지 못한다.
- 워크플로 변경이 병합되기 전에 잰다(이 step의 순서가 그렇다).
- GitHub을 읽는 것은 이 한 번이다. 그 뒤로는 `--from`의 출력만 쓴다. 파일을 손으로 고치지 않는다.
- 기준선의 보존 기록(`lab/actions-cost/2026-11-17_2026-11-20.jsonl`)은 건드리지 않는다.

### 2. 기록 표와 문서 (`docs/harness/actions-cost.md`)

- "기록" 표에 기준선 행 다음으로 한 행을 더한다. `수단` 칸은 `A6`, `보존 기록` 칸은 `` `2026-11-19_2026-11-22.jsonl` ``이다. `기간`부터 `30일 환산 금액`까지 여섯 칸은 `node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-19_2026-11-22.jsonl` 출력의 "기록 칸" 행을 그대로 옮긴다. `판단` 칸은 문서가 정한 순서로 정하고(`예산 안`·`예산 밖`·`판단 못 함`) 한 줄 설명을 단다. 설명에는 이 행이 A6 뒤이자 B2를 넣기 전의 값이라는 것을 적는다.
- "재는 방법"의 **단가** 줄에서 보존 기록에 남는 라벨의 설명을 고친다: 단가를 아는 러너의 라벨과 `self-hosted`가 그대로 남는다(PR #205 판정의 F4).
- 기준선의 표식 구간과 기준선 행은 바꾸지 않는다.

### 3. 워크플로 패치 (`lab/actions-cost/b2-arm64/workflows.patch`, `lab/actions-cost/b2-arm64/README.md`)

패치는 워크플로 파일 둘만 바꾸고, 파일마다 아래 세 줄만 바꾼다(여섯 줄. 줄을 더하거나 지우지 않는다).

| 파일                          | job        | 바꾸기 전                                                                           | 바꾼 뒤                                                                             |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `.github/workflows/check.yml` | `check`    | `runs-on: ubuntu-latest`                                                            | `runs-on: ubuntu-24.04-arm`                                                         |
| `.github/workflows/check.yml` | `check`    | `GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` | `GITLEAKS_SHA256: e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080` |
| `.github/workflows/check.yml` | `check`    | `…/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`                                   | `…/gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`                                 |
| `.github/workflows/gates.yml` | `selftest` | `runs-on: ubuntu-latest`                                                            | `runs-on: ubuntu-24.04-arm`                                                         |
| `.github/workflows/gates.yml` | `selftest` | 위와 같은 `GITLEAKS_SHA256` 줄                                                      | 위와 같다                                                                           |
| `.github/workflows/gates.yml` | `selftest` | 위와 같은 내려받기 줄                                                               | 위와 같다                                                                           |

- `GITLEAKS_VERSION`(8.30.1)은 바꾸지 않는다. arm64 파일의 체크섬은 gitleaks 8.30.1의 배포 체크섬 목록에서 읽고 파일을 받아 계산한 값과 견줬다(계획의 진행 로그).
- `gates.yml`의 `evaluate`·`record` job과 다른 워크플로는 건드리지 않는다.
- 패치는 통과를 확인한 트리의 `git diff -- .github/workflows`로 만든다. 워크플로 파일만 담는다.
- `README.md`에는 바꾸는 줄과 위치(파일, job, 바꾸기 전과 뒤의 줄), 제작자가 하는 방법(GitHub 웹에서 이 브랜치의 두 파일을 고쳐 그 브랜치에 바로 커밋한다. 파일 하나에 커밋 하나여도 된다. 에이전트가 도는 머신의 터미널에서 하지 않는다), 봇이 확인한 것(체크섬의 출처, 구조 테스트의 실패와 통과), 남는 위험과 되돌리는 방법(`selftest`는 main의 정의로 돌아 병합 뒤에야 arm64에서 돈다. 병합 뒤 arm64에서만 실패하면 보호 경로를 바꾸는 PR이 `harness-guard`에서 막히고, 되돌리는 PR도 같이 막혀 제작자가 보호 설정을 손봐 되돌려야 한다. 되돌리는 변경은 이 패치의 반대다)을 적는다.

### 4. 구조 테스트 (`scripts/test/ci.test.ts`)

지금 워크플로에서 실패하고 패치를 적용한 트리에서 통과하는 것을 로컬에서 확인해 진행 로그에 적는다(R5). 테스트는 제작자의 워크플로 커밋을 받은 뒤에 올린다(그 전에 올리면 `check`가 실패한다).

- 러너: 워크플로 여섯(`check`, `gates`, `judge-claude`, `judge-codex`, `revert`, `review-trigger`)의 모든 job에 대해, job 블록에 `runs-on:` 줄이 정확히 하나이고 그 값이 아래와 같다. job의 목록도 견준다(job이 늘거나 줄면 테스트가 실패해 러너를 정하게 한다).
  - `ubuntu-24.04-arm`: `check`의 `check`, `gates`의 `selftest`.
  - `ubuntu-latest`: 나머지 17개(`gates`의 `evaluate`·`record`, `judge-claude`의 `plan`·`judge`·`repro`·`record`·`failed`·`ci-failure`, `judge-codex`의 `plan`·`pubkey`·`judge`·`store`·`repro`·`record`, `revert`의 `plan`·`act`, `review-trigger`의 `trigger`).
- gitleaks: 여섯 워크플로에서 `gitleaks_`가 든 job은 `check`의 `check`와 `gates`의 `selftest` 둘뿐이다. 두 job마다 버전이 `8.30.1`이고, 내려받는 파일 이름의 아키텍처가 그 job의 러너와 맞고(`ubuntu-24.04-arm`이면 `linux_arm64`, `ubuntu-latest`이면 `linux_x64`), 체크섬이 그 아키텍처의 값이다(arm64 `e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080`, x64 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`). job 블록에 다른 아키텍처의 파일 이름이 없다.
- `scripts/test/harness-guard.test.ts`의 "두 job의 버전과 체크섬이 같다"는 테스트는 고치지 않는다(패치 뒤에도 통과해야 한다).

### 5. 제작자에게 요청하고, 받은 것을 확인한다

- 나머지(보존 기록, 문서, 패치와 README, 변경 이력)를 올려 판정을 받은 뒤 Issue #206에 요청을 남긴다(`needs-human`): 브랜치 이름, 바꿀 줄과 위치(README 링크), 남는 위험, 끝난 뒤 알릴 방법. 요청은 한 번에 모은다.
- 제작자의 커밋을 받으면(`git fetch origin <브랜치>`, `git merge --ff-only origin/<브랜치>`) 봇이 커밋을 더하기 전에, 요청할 때의 head 트리에 패치를 적용한 결과와 받은 head의 트리를 통째로 견준다(`docs/SECURITY.md`의 명령). 다르면 멈추고 제작자에게 다른 곳을 알린다. 결과를 진행 로그에 적는다.
- 같으면 구조 테스트를 커밋하고, AC와 `check`를 통과시키고, 완료 처리한 뒤 push한다.
- push 뒤 그 head의 `check` 실행이 `ubuntu-24.04-arm`에서 돌았는지 실행 기록의 job 라벨로 확인해 PR 본문과 Issue에 적는다.

### 6. 변경 이력 (`docs/harness/CHANGELOG.md`)

"다음 버전"에 한 줄: Issue #206, 옮긴 job 둘과 러너, gitleaks의 arm64 파일과 체크섬, 검사를 약화하지 않는다는 것, 판정 job과 1분 미만 job은 옮기지 않았다는 것.

## Acceptance Criteria

```bash
node --test scripts/test/ci.test.ts scripts/test/harness-guard.test.ts
T=$(mktemp -d) && want=$(export GIT_INDEX_FILE="$T/index"; git read-tree origin/main && git apply --cached lab/actions-cost/b2-arm64/workflows.patch && git write-tree) && test -n "$want" && test "$(git rev-parse "$want:.github/workflows")" = "$(git rev-parse "HEAD:.github/workflows")"
test "$(git diff --name-only origin/main HEAD -- .github | sort | tr '\n' ' ')" = ".github/workflows/check.yml .github/workflows/gates.yml "
T=$(mktemp -d) && git diff origin/main HEAD -- .github/workflows > "$T/d" && test "$(grep -c "^-[^-]" "$T/d")" = 6 && test "$(grep -c "^+[^+]" "$T/d")" = 6
test "$(grep -c "runs-on: ubuntu-24.04-arm" .github/workflows/check.yml)" = 1 && test "$(grep -c "runs-on: ubuntu-24.04-arm" .github/workflows/gates.yml)" = 1 && ! grep -q "ubuntu-24.04-arm" .github/workflows/judge-claude.yml .github/workflows/judge-codex.yml .github/workflows/revert.yml .github/workflows/review-trigger.yml
test -s lab/actions-cost/b2-arm64/README.md && test "$(grep -c "^diff --git" lab/actions-cost/b2-arm64/workflows.patch)" = 2
test -s lab/actions-cost/2026-11-19_2026-11-22.jsonl && head -1 lab/actions-cost/2026-11-19_2026-11-22.jsonl | grep -q '"since":"2026-11-19","until":"2026-11-22"'
git diff --quiet origin/main HEAD -- lab/actions-cost/2026-11-17_2026-11-20.jsonl
T=$(mktemp -d) && grep "^| 2026-11-19~2026-11-22 *| A6 *|" docs/harness/actions-cost.md > "$T/row" && test "$(grep -c "" "$T/row")" = 1 && grep -qF '`2026-11-19_2026-11-22.jsonl`' "$T/row"
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-19_2026-11-22.jsonl > "$T/out.md" && awk '/^\*\*기록 칸\*\*/{s=1;next} /^\*\*/{s=0} s' "$T/out.md" | grep "^| 2026-11-19~2026-11-22 " | tr -d ' ' > "$T/a" && test -s "$T/a" && grep "^| 2026-11-19~2026-11-22 *| A6 *|" docs/harness/actions-cost.md | tr -d ' ' | sed 's/|A6|/|/' > "$T/b" && grep -qF "$(cat "$T/a")" "$T/b"
node lab/actions-cost/check-doc.ts
node --test lab/actions-cost/test/check-doc.test.ts
T=$(mktemp -d) && awk '/^## 재는 방법/{s=1;next} /^## /{s=0} s' docs/harness/actions-cost.md | grep "^- \*\*단가\*\*:" > "$T/l" && test "$(grep -c "" "$T/l")" = 1 && grep -qF "self-hosted" "$T/l"
grep -q "#206" docs/harness/CHANGELOG.md
node scripts/harness.ts check
```

- `actions-cost --from`은 GitHub을 읽지 않는다. `origin/main`과 견주는 줄은 로컬의 `origin/main`을 쓴다(AC를 돌리기 전에 `git fetch origin`으로 맞추고, main이 앞서 있으면 `origin/main`을 병합한 뒤에 돌린다).
- 첫째 줄: 구조 테스트(러너, gitleaks)와 지금의 `selftest` 테스트.
- 둘째 줄: `origin/main`의 트리에 패치를 적용한 결과와 이 브랜치 head의 `.github/workflows` 폴더가 통째로 같다(패치의 줄이 빠졌거나, 일부만 들어갔거나, 패치 밖의 워크플로 줄이 바뀌었으면 다르다).
- 셋째·넷째 줄: `.github` 아래에서 바뀐 파일은 두 워크플로뿐이고, 바뀐 줄은 지운 줄 여섯과 더한 줄 여섯이다.
- 다섯째 줄: arm64 러너를 쓰는 job은 `check.yml`과 `gates.yml`에 하나씩이고 다른 워크플로에는 없다(어느 job인지는 첫째 줄의 테스트가 본다).
- 일곱째 줄: 넣기 전 값의 보존 기록이 있고 머리 줄의 기간이 2026-11-19~2026-11-22다. 여덟째 줄: 기준선의 보존 기록은 그대로다.
- 아홉째 줄: 기록 표에 그 기간의 행이 하나이고 수단이 `A6`, 보존 기록 칸이 그 파일이다.
- 열째 줄: 그 행의 여섯 칸이 `--from` 출력의 "기록 칸" 행과 같다(공백을 지우고 견준다. 문서의 행에서 `수단` 칸을 빼면 "기록 칸" 행이 그 앞머리다). 열한째 줄의 문서 검사도 모든 행의 값과 판단을 보존 기록으로 다시 계산해 견준다.
- 열셋째 줄: "재는 방법"의 단가 줄이 하나이고 `self-hosted`를 적는다.

## 금지사항

- 봇이 `.github/workflows/`를 고쳐 커밋하거나 push하지 마라. 이유: 워크플로 파일은 제작자가 올린다(봇 토큰에 `workflow` 권한이 없고, 그 권한을 다시 받지 않는다. `docs/SECURITY.md`). 패치를 만들고 로컬에서 확인할 때 고친 워크플로 파일은 커밋하지 않고 되돌린다.
- 패치에 여섯 줄 밖의 변경을 넣지 마라. 이유: 제작자가 웹에서 손으로 옮기고, 봇은 받은 트리를 패치와 통째로 견준다. 판정 job과 1분 미만 job의 러너는 이 계획의 범위가 아니다.
- 구조 테스트를 제작자의 워크플로 커밋보다 먼저 올리지 마라. 이유: 그 head의 `check`가 실패한다. 순서를 바꿔 단언을 느슨하게 하면 패치가 빠져도 통과한다(`docs/SECURITY.md`).
- 받은 트리가 패치와 다르면 그 위에 커밋하지 마라. 이유: 패치 밖의 워크플로 변경이 검토 없이 들어간다. 멈추고 제작자에게 알린다.
- gitleaks의 체크섬 검증 단계(`sha256sum -c`)를 빼거나 느슨하게 하지 마라. 이유: 내려받은 실행 파일을 검증 없이 쓰게 된다(R4).
- `lab/actions-cost/2026-11-17_2026-11-20.jsonl`과 새 보존 기록을 손으로 고치지 마라. 2026-11-22(UTC)가 끝나기 전에 재지 마라. 이유: 보존 기록이 기록 표의 기준이고, 끝나지 않은 날을 재면 그날의 실행이 빠진다.
- 예산 값, 판단 규칙, 기준선의 표식 구간과 기준선 행을 바꾸지 마라. 이유: 이 step은 수단 하나를 넣고 넣기 전 값을 기록할 뿐이다.
- 설계서(`docs/harness/design.md`)의 보장과 구조를 바꾸지 마라. 이유: B2는 잃는 보장이 없다(GitHub 호스팅 VM 그대로다).
