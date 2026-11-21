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
  - 절차나 스크립트의 문제(예: Windows에서의 경로·프로세스 실행)면 `lab/q10-db/`의 스크립트를 고쳐 다시 돌린다. 워크플로는 기본 브랜치의 정의로 돌므로 스크립트 수정은 별도 PR로 먼저 병합한다(이 계획의 범위 안. 이 step의 브랜치에서 올리지 않는다). 판정 기준을 느슨하게 고치지 않는다.
  - 도구 자체가 그 환경에서 돌지 않는 것이면(설치가 안 된다, 마이그레이션이 생성·적용되지 않는다, 격리가 깨진다) **확정하지 않는다**: 결과 파일을 더하지 않고, 원인과 로그의 실행 주소를 진행 로그에 적고, 제작자에게 묻는다(기준대로 "DB 없이 시작"으로 되돌릴지). 이 step은 거기서 멈춘다.
- 산출물을 받는다: `gh run download <실행 번호> --dir <새 임시 폴더>`. 받은 폴더의 `linux-<arch>.json`과 `win32-<arch>.json`을 `lab/q10-db/results/`에 복사한다. 내용을 손으로 고치지 않는다. `node scripts/harness.ts fmt`로 포맷한다.
- 받은 산출물의 `darwin-arm64.json`(체크아웃된 그대로 올라온다)은 쓰지 않는다. 리포의 `darwin-arm64.json`은 바꾸지 않는다.

### 2. 테스트(먼저 쓴다)

`lab/q10-db/test/confirmed.test.ts`(새 파일, `node:test`). 결과 파일을 더하기 전에는 실패하고 더한 뒤 통과하는 것을 진행 로그에 적는다.

- `lab/q10-db/results/`의 결과 파일로 `confirmProblems`(`check-results.ts`)를 돌리면 문제가 0건이다(세 환경 모두 통과).
- `linux-*`와 `win32-*` 결과 파일이 하나씩 이상 있고, 각 파일의 `packages`와 `pnpm`이 `darwin-arm64.json`의 것과 같다(같은 버전을 쟀다).
- `lab/q10-db/README.md`의 "잰 머신" 표에 결과 파일마다 행이 있다(파일 이름이 백틱으로 적힌 행). `linux-*`·`win32-*` 행에는 실행 주소(`/actions/runs/<숫자>`)가 있다.
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`의 "상태" 줄이 `- 상태: 채택`으로 시작하고 `잠정`이 그 줄에 없다.

`scripts/test/profile-web-db.test.ts`의 "확인한 버전" 테스트는 그대로 통과해야 한다(README의 버전은 바뀌지 않는다).

### 3. 문서

- `lab/q10-db/README.md`: "잰 머신" 표에 두 행(결과 파일, 머신 — "GitHub Actions `ubuntu-latest`"·"GitHub Actions `windows-latest`", 날짜, 실행 주소). "Windows 네이티브와 Linux에서는 아직 재지 않았다" 줄을 고친다. "확정 조건" 절의 "지금은 macOS 결과뿐이라 1이다"를 지금 상태(0)로 고친다.
- `docs/decisions/ADR-0007-db-postgres-drizzle.md`: 상태를 채택으로 바꾸고 날짜를 적는다. "확정 조건" 절에 조건이 채워졌다는 것과 세 환경을 어디서 쟀는지(macOS는 Mac, Linux와 Windows는 CI 러너)를 적는다. "알려진 한계"에 한 항목을 더한다: Windows는 CI의 러너에서 쟀고 제작자의 Windows PC에서는 아직 재지 않았다(TD-14). "되돌리는 조건"은 그대로 둔다. 문서 첫머리의 "이 결정은 잠정이다" 문장들을 확정에 맞게 고친다. `docs/decisions/index.md`에 상태를 적는 칸이 있으면 맞춘다.
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
```

- 첫 줄이 확정 조건이다. 둘째 줄의 테스트가 결과 파일과 문서(README의 표, ADR의 상태)를 견준다.
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
