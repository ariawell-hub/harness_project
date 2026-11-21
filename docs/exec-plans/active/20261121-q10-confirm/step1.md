# Step 1: confirm

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준" 3·4·5, 의사결정 로그, step0의 진행 로그)
- 앞 step에서 만든·바꾼 파일: `lab/q10-db/run.ts`, `lab/q10-db/README.md`("CI 러너에서 돌리기"), `.github/workflows/q10-trial.yml`, `scripts/test/q10-trial-workflow.test.ts`
- `lab/q10-db/check-results.ts`(`--confirm`, `REQUIRED_PLATFORMS`), `lab/q10-db/results/darwin-arm64.json`
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`("확정 조건", "되돌리는 조건"), `docs/harness/design.md` 18절 Q10 행·19절 "현재 위치"·14.3절, `docs/exec-plans/tech-debt-tracker.md`의 TD-14 행, `profiles/web/README.md`의 "DB" 절, `scripts/test/profile-web-db.test.ts`(README를 결과 파일과 견주는 테스트)

## 작업

### 1. 실측

- main에서 워크플로를 돌린다: `gh workflow run q10-trial.yml --ref main`. 실행 번호와 주소를 진행 로그에 적는다. 봇 토큰으로 실행이 거부되면 제작자에게 Actions 화면에서 "Run workflow"를 눌러 달라고 요청한다(`needs-human`).
- 두 job(`ubuntu-latest`, `windows-latest`)이 모두 성공해야 한다. 실패한 job이 있으면 로그에서 원인을 찾는다.
- 성공한 두 job의 로그를 파일로 받아(`gh run view <실행 번호> --log > <새 임시 폴더의 파일>`) `run.ts`의 마지막 단계가 `out-file.test.ts`를 돌렸고 실패한 테스트가 0건인 것을 확인한다. Linux의 로그에서는 심볼릭 링크를 바꾸는 사례가 건너뛰어지지 않고 통과했는지, Windows의 로그에서는 `--out`을 거부하는 사례가 통과했는지 본다. 확인한 것(job마다 테스트 수, 통과·실패·건너뜀의 수)을 진행 로그에 적는다. 그 테스트가 돌지 않았거나 Linux에서 링크 사례가 건너뛰어졌으면 확정하지 않고 원인을 고친다(스크립트 수정은 위와 같이 별도 PR로 먼저 병합한다).
  - 절차나 스크립트의 문제(예: Windows에서의 경로·프로세스 실행)면 `lab/q10-db/`의 스크립트를 고쳐 다시 돌린다. 워크플로는 기본 브랜치의 정의로 돌므로 스크립트 수정은 별도 PR로 먼저 병합한다(이 계획의 범위 안. 이 step의 브랜치에서 올리지 않는다). 판정 기준을 느슨하게 고치지 않는다.
  - 도구 자체가 그 환경에서 돌지 않는 것이면(설치가 안 된다, 마이그레이션이 생성·적용되지 않는다, 격리가 깨진다) **확정하지 않는다**: 결과 파일을 더하지 않고, 원인과 로그의 실행 주소를 진행 로그에 적고, 제작자에게 묻는다(기준대로 "DB 없이 시작"으로 되돌릴지). 이 step은 거기서 멈춘다.
- 산출물을 받는다: `gh run download <실행 번호> --dir <새 임시 폴더>`. 받은 폴더의 `linux-<arch>.json`과 `win32-<arch>.json`을 `lab/q10-db/results/`에 복사한다. 내용을 손으로 고치지 않는다. `node scripts/harness.ts fmt`로 포맷한다.
- 받은 산출물의 `darwin-arm64.json`(체크아웃된 그대로 올라온다)은 쓰지 않는다. 리포의 `darwin-arm64.json`은 바꾸지 않는다.
- 결과 파일과 README의 표를 고친 뒤 `node lab/q10-db/verify-artifacts.ts`(아래 2)로 출처를 확인한다. 그 출력(결과 파일, 실행 번호, 실행의 커밋, 산출물 이름, "같다")을 진행 로그에 그대로 옮기고 PR 본문의 검증 절에도 적는다.

### 2. 출처 확인: `lab/q10-db/verify-artifacts.ts`(새 파일)와 테스트 `lab/q10-db/test/verify-artifacts.test.ts`

커밋한 결과 파일이 README가 가리키는 실행의 산출물인지 확인한다. 내용 검사(`check-results.ts`)는 값이 맞는지만 보므로, 다른 실행에서 받은 파일을 넣고 README에 다른 실행 번호를 적어도 통과한다. 그 틈을 막는다.

`node lab/q10-db/verify-artifacts.ts`. 리포의 루트에서 돌린다. GitHub은 읽기만 한다(`gh api`의 조회, `gh run download`).

- 대상: `lab/q10-db/README.md`의 "잰 머신" 표에서 결과 파일 이름이 `linux-`·`win32-`로 시작하는 행. 행마다 실행 주소(`https://github.com/<리포>/actions/runs/<숫자>`)에서 리포와 실행 번호를 읽는다. 이 리포의 이름은 `gh repo view --json nameWithOwner`로 읽는다. 그런 행이 `linux-`와 `win32-`에 하나씩 이상 있어야 하고, `lab/q10-db/results/`의 `linux-*`·`win32-*` 파일마다 행이 있어야 한다.
- 실행(`gh api repos/<리포>/actions/runs/<번호>`): 주소의 리포가 이 리포다. `path`가 `.github/workflows/q10-trial.yml`, `event`가 `workflow_dispatch`, `head_branch`가 `main`, `status`가 `completed`, `conclusion`이 `success`다. `head_sha`가 `origin/main`의 조상이다(`git merge-base --is-ancestor`).
- job(`gh api repos/<리포>/actions/runs/<번호>/jobs`): 이름에 `ubuntu-latest`가 든 job과 `windows-latest`가 든 job이 모두 있고 둘 다 `conclusion`이 `success`다.
- 산출물: `gh run download <번호> --name q10-result-<os> --dir <새 임시 폴더>`(`mkdtempSync`로 만들고 지우지 않는다). `linux-*` 파일은 `q10-result-ubuntu-latest`에서, `win32-*` 파일은 `q10-result-windows-latest`에서 받은 같은 이름의 파일과 견준다. 다른 OS의 산출물에만 있는 파일은 일치로 치지 않는다. 산출물에 그 이름의 파일이 없으면 문제다.
- 비교하는 법: 두 파일을 JSON으로 읽은 값이 깊이 같은지 본다(`node:util`의 `isDeepStrictEqual`). 포매터가 바꾸는 것(들여쓰기, 줄바꿈, 줄 끝)은 읽은 값에 들지 않으므로 비교에서 빠진다. 값은 하나라도 다르면 문제다(숫자와 글, 배열의 순서 포함).
- 출력: 행마다 한 줄(결과 파일, 실행 번호, 실행의 커밋 앞 12자, 산출물 이름, `같다`). 문제가 있으면 문제를 표준 오류에 내고 종료 코드 1로 끝난다. 없으면 0이다. `gh`나 `git`을 실행하지 못해도 1이다.
- 구조: 표를 읽는 순수 함수(`readRows(readme)`), 모은 자료로 문제의 목록을 내는 순수 함수(`provenanceProblems(input)` — 행, 리포 이름, 실행·job의 응답, 조상 여부, 산출물에서 읽은 글, 커밋된 파일의 글), 자료를 모으는 함수(`gh`·`git`을 부르는 `exec`를 주입한다)를 내보낸다. 파일을 직접 실행했을 때만 실제로 돈다.
- 테스트(`node:test`, 네트워크를 쓰지 않는다. 먼저 쓴다): 모두 맞으면 문제가 0건이다. 문제로 내는 것: 다른 워크플로의 실행, `main`이 아닌 브랜치의 실행, `workflow_dispatch`가 아닌 이벤트, 끝나지 않은 실행, 실패한 실행, `origin/main`의 조상이 아닌 커밋의 실행, 한 OS의 job이 없다, 한 OS의 job이 실패했다, 주소의 리포가 다르다, 행에 실행 주소가 없다, `linux-`나 `win32-` 행이 없다, 결과 파일은 있는데 행이 없다, 산출물에 파일이 없다, 다른 OS의 산출물에만 파일이 있다, 값 하나가 다르다, JSON으로 읽을 수 없다. 포맷만 다른 파일(들여쓰기, CRLF 줄 끝, 끝의 줄바꿈)은 문제가 아니다.

### 3. 테스트(먼저 쓴다)

`lab/q10-db/test/confirmed.test.ts`(새 파일, `node:test`). 결과 파일을 더하기 전에는 실패하고 더한 뒤 통과하는 것을 진행 로그에 적는다.

- `lab/q10-db/results/`의 결과 파일로 `confirmProblems`(`check-results.ts`)를 돌리면 문제가 0건이다(세 환경 모두 통과).
- `linux-*`와 `win32-*` 결과 파일이 하나씩 이상 있고, 각 파일의 `packages`와 `pnpm`이 `darwin-arm64.json`의 것과 같다(같은 버전을 쟀다).
- `lab/q10-db/README.md`의 "잰 머신" 표에 결과 파일마다 행이 있다(파일 이름이 백틱으로 적힌 행). `linux-*`·`win32-*` 행에는 실행 주소(`/actions/runs/<숫자>`)가 있다.
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`의 "상태" 줄이 `- 상태: 채택`으로 시작하고 `잠정`이 그 줄에 없다.
- 문서들이 같은 확정 상태를 말한다(한 곳만 고치고 다른 곳에 잠정 상태가 남으면 실패한다):
  - ADR-0007: 문서에 "이 결정은 잠정이다"가 없다. "확정 조건" 절(`## 확정 조건`부터 다음 `## ` 앞까지)에 `lab/q10-db/results/`의 결과 파일 이름이 모두 적혀 있고, README의 "잰 머신" 표에 있는 실행 번호가 모두 적혀 있다(어디서 쟀는지). "알려진 한계" 절에 `TD-14`와 `Windows PC`가 함께 든 줄이 있다(Windows는 CI 러너에서 쟀고 PC에서는 아직이라는 한계).
  - `docs/decisions/index.md`: ADR-0007의 행에 `채택`이 있고 `잠정`이 없다.
  - 설계서: `| Q10 `으로 시작하는 행(18절)에 `확정`과 `ADR-0007`이 있고 `잠정`이 없다. `- **현재 위치`로 시작하는 줄(19절)에 `잠정`과 "실측이 남았다"가 없고, 그 줄이 `Q10`을 말하면 `확정`이 함께 있다. (0절의 버전 이력은 지난 일의 기록이라 보지 않는다.)
  - 기술 부채 표: `| TD-14 `로 시작하는 행에 `lab/q10-db`, `CI`, `Windows PC`, "확정 조건은 채워졌다"가 있고 옛 문구 "결과 파일을 더하기"가 없다.
  - `profiles/web/README.md`: ADR-0007의 링크가 든 문단("DB" 절 첫 문단)에 `확정`이 있고 `잠정`과 "macOS에서만 쟀다"가 없다.
  - `lab/q10-db/README.md`: "아직 재지 않았다"와 "ADR-0007은 잠정이다"가 없다.

`scripts/test/profile-web-db.test.ts`의 "확인한 버전" 테스트는 그대로 통과해야 한다(README의 버전은 바뀌지 않는다).

### 4. 문서

- `lab/q10-db/README.md`: "잰 머신" 표에 두 행(결과 파일, 머신 — "GitHub Actions `ubuntu-latest`"·"GitHub Actions `windows-latest`", 날짜, 실행 주소). "Windows 네이티브와 Linux에서는 아직 재지 않았다" 줄을 고친다. "확정 조건" 절의 "지금은 macOS 결과뿐이라 1이다"를 지금 상태(0)로 고친다.
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`: 상태를 채택으로 바꾸고 날짜를 적는다. "확정 조건" 절에 조건이 채워졌다는 것과 세 환경을 어디서 쟀는지(macOS는 Mac, Linux와 Windows는 CI 러너)를 결과 파일의 이름 셋과 CI 실행의 주소로 적는다. "알려진 한계"에 한 항목을 더한다: Windows는 CI의 러너에서 쟀고 제작자의 Windows PC에서는 아직 재지 않았다(TD-14). "되돌리는 조건"은 그대로 둔다. 문서 첫머리의 "이 결정은 잠정이다" 문장들을 확정에 맞게 고친다. `docs/decisions/index.md`에 상태를 적는 칸이 있으면 맞춘다.
- `docs/harness/design.md`: 18절의 Q10 행을 확정 결정으로(ADR-0007을 가리킨다), 19절 "현재 위치"의 "착수 전에 정할 것"에서 Q10을 빼거나 확정으로 고친다(Q13은 그대로 둔다). 14.3절은 "잠정"이라는 말이 있으면 그 말만 고치고 규칙·표는 한 글자도 바꾸지 않는다. 0절 버전 이력과 문서 머리의 버전(번호는 push할 때 main의 다음 번호).
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(검사를 약화하지 않는다는 것).
- `docs/exec-plans/tech-debt-tracker.md`의 TD-14 행: `lab/q10-db` 항목을 "CI의 Windows 러너에서 쟀다. 제작자의 Windows PC에서 한 번 더 돌린다(확정 조건은 채워졌다)"는 뜻으로 고친다. 그 행의 다른 항목과 다른 행은 고치지 않는다.
- `profiles/web/README.md`의 "DB" 절 첫 문단: "**잠정**이다(macOS에서만 쟀다 …)"를 확정에 맞게 고친다(세 환경에서 쟀다, `lab/q10-db`). 계획 `20261120-q10-db-decision`이 고정한 문장들과 명령 표, 버전은 바꾸지 않는다(`scripts/test/profile-web-db.test.ts`가 본다).

## Acceptance Criteria

```bash
node lab/q10-db/check-results.ts --confirm
node --test lab/q10-db/test/confirmed.test.ts
node --test lab/q10-db/test/check-results.test.ts
node --test lab/q10-db/test/run.test.ts
node --test scripts/test/profile-web-db.test.ts
node --test scripts/test/q10-trial-workflow.test.ts
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- lab/q10-db/results/darwin-arm64.json lab/q10-db/check-results.ts lab/q10-db/trial.ts .github | wc -l | tr -d ' ')" = 0
O=$(mktemp -d) && git show "$(git merge-base HEAD origin/main):docs/harness/design.md" | sed -n '/^### 14.3/,/^### 14.4/p' | sed 's/잠정//g' > "$O/base.txt" && sed -n '/^### 14.3/,/^### 14.4/p' docs/harness/design.md | sed 's/잠정//g' > "$O/now.txt" && test -s "$O/base.txt" && diff "$O/base.txt" "$O/now.txt"
O=$(mktemp -d) && git show "$(git merge-base HEAD origin/main):docs/exec-plans/tech-debt-tracker.md" > "$O/base.md" && { diff "$O/base.md" docs/exec-plans/tech-debt-tracker.md > "$O/d.txt"; test "$(grep -c '^<' "$O/d.txt")" = 1; } && test "$(grep -c '^>' "$O/d.txt")" = 1 && grep -q '^< | TD-14 ' "$O/d.txt" && grep -q '^> | TD-14 ' "$O/d.txt"
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
node --test lab/q10-db/test/verify-artifacts.test.ts
node lab/q10-db/verify-artifacts.ts
```

- 첫 줄이 확정 조건이다. 둘째 줄의 테스트가 결과 파일과 문서(README의 표, ADR의 상태·확정 조건·알려진 한계, ADR 목록, 설계서 18·19절, TD-14 행, 웹 프로파일 README)를 견준다.
- 끝의 두 줄: 출처 확인의 테스트와, 실제 확인이다(네트워크로 GitHub을 읽는다). README가 가리키는 실행이 `main`의 `q10-trial` 실행이고 두 OS의 job이 성공했으며, 그 산출물의 결과가 커밋한 결과 파일과 값으로 같아야 0이다. 출력은 진행 로그와 PR 본문에 옮긴다.
- 일곱째 줄: macOS 결과, 판정 스크립트, 실행 스크립트, 워크플로를 이 step이 바꾸지 않았다.
- 여덟째 줄: 14.3절은 "잠정"이라는 낱말을 뺀 것 말고는 PR이 갈라진 지점과 글자 그대로 같다(두 쪽에서 그 낱말을 지우고 비교한다). 규칙·표가 바뀌면 실패한다.
- 아홉째 줄: 기술 부채 표에서 바뀐 줄은 TD-14 행 하나뿐이다(지운 줄 하나와 더한 줄 하나가 모두 그 행이다).
- `origin/main`이 필요하다(`git fetch origin`).

## 금지사항

- 결과 파일의 내용을 손으로 고치거나, 통과하지 못한 결과를 통과하게 만들려고 `check-results.ts`의 기대값·판정을 고치지 마라. 이유: 확정 조건의 근거다. 어긋나면 원인을 고쳐 다시 잰다.
- 한 환경이라도 통과하지 못했는데 ADR·설계서를 확정으로 고치지 마라. 이유: 제작자의 기준은 "영향이 없으면"이다. 그때는 멈추고 묻는다(수용 기준 5).
- `darwin-arm64.json`을 다시 쓰지 마라. 이유: 이 step은 두 환경을 더한다. 있는 결과를 바꾸면 무엇이 달라졌는지 가려진다.
- 14.3절의 규칙·표, ADR의 "되돌리는 조건", 웹 프로파일의 설정(`profiles/web/profile.json`)을 고치지 마라. 이유: 이 step은 상태를 확정으로 바꾸는 것이지 규칙을 바꾸지 않는다.
- 기술 부채 표에서 TD-14 행 밖을 고치지 마라. 이유: 다른 세션의 PR과 충돌한다.
- `.github/workflows/`를 고치지 마라. 이유: 워크플로 변경은 제작자가 올린다.
- `verify-artifacts.ts`가 통과하지 않는 결과 파일을 올리지 마라. 통과시키려고 README의 실행 주소를 다른 실행으로 바꾸거나 비교를 느슨하게 하지 마라. 이유: 결과 파일이 그 실행의 산출물이라는 것이 확정의 근거다. 어긋나면 산출물을 다시 받는다.
