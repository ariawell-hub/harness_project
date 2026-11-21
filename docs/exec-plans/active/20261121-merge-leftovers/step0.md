# Step 0: conflict-markers

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*` 행)
- `scripts/gates/bypass-scan.ts`(전체. 자기 파일이 검사에 걸리지 않게 문자열을 조립하는 방식), `scripts/lib/git.ts`(`gitTry`), `scripts/lib/util.ts`(`Problem`, `formatProblem`)
- `scripts/commands/check.ts`의 `runCheck`(`bypass-scan` 단계, `doc-lint` 단계가 CODEOWNERS 검사를 함께 보는 방식), `scripts/harness.ts`의 `case 'bypass-scan'`
- `scripts/test/helpers.ts`, `scripts/test/doc-lint-gate.test.ts`(임시 리포와 CLI 실행 방식), `scripts/test/gates.test.ts`의 `bypass-scan` 테스트
- `docs/harness/workflow.md` 5절 "main에 뒤처지거나 충돌한 PR 갱신", `docs/exec-plans/tech-debt-tracker.md`의 TD-30 행

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

"충돌 표식 줄"의 뜻은 계획(`plan.md`)의 "목표와 수용 기준" 첫머리와 같다. 아래에서 "시작 표식"은 `<` 일곱 개, "끝 표식"은 `>` 일곱 개다.

### 1. `scripts/gates/conflict-markers.ts`(새 파일)

```ts
/** 작업 트리에 남은 병합 충돌 표식 줄을 찾는다. 파일마다 한 건, 경로 순 */
export function conflictMarkers(root: string): Problem[];
```

- 이 파일과 테스트 파일에는 충돌 표식 줄을 두지 않는다. 표식 문자열은 반복으로 조립한다(`'<'.repeat(7)`).
- `root`에서 `git grep`을 한 번 실행한다(`gitTry`). 인자는 순서대로 `grep`, `-n`, `-I`, `-z`, `-o`, `-E`, `--no-color`, `--no-column`, `--no-recurse-submodules`, `--untracked`, `-e`, 패턴, `--`, `.`이다. 패턴은 하나이고 `^(` + 시작 표식 + `|` + 끝 표식 + `)( |` + CR 한 글자 + `?$)`이다(확장 정규식). 충돌 표식 줄(표식 바로 뒤가 공백 한 글자이거나 줄 끝이거나 CR 하나 뒤 줄 끝)만 맞는다.
  - `-E`·`--no-color`·`--no-column`은 사용자의 `git` 설정이 패턴 해석과 출력 형식을 바꾸지 못하게 한다. `--untracked`는 무시되지 않는 새 파일도 본다. `-I`는 바이너리 파일을 건너뛴다.
  - `-o`는 줄 전체가 아니라 맞은 부분(표식과 그 뒤의 공백이나 CR)만 출력하게 한다. 줄이 길어도 출력은 표식 줄마다 경로, 줄 번호, 아홉 글자 이하다.
  - 걸러내기는 이 패턴이 한다. 표식 모양이지만 충돌 표식 줄이 아닌 줄(같은 문자 여덟 개, 표식 뒤에 글자가 붙은 줄)은 아무리 많아도 출력에 나오지 않는다.
  - `-e`를 둘로 나누지 않는다. 패턴을 둘 주면 맞는 줄이 많은 파일에서 `git grep`이 아주 느리다(계획의 진행 로그에 잰 값이 있다).
- 종료 코드와 출력의 해석(위에서부터 차례로 본다):
  - 표준 오류가 비어 있지 않으면(공백 문자만 있는 것은 빈 것으로 본다) 종료 코드와 표준 출력이 무엇이든 검사 실패다. 읽을 수 없는 파일이나 폴더가 있으면 `git grep`은 그 파일을 건너뛰고 표준 오류에만 적는다.
  - 종료 코드 1이고 표준 출력이 비어 있으면 맞는 줄이 없다: 빈 배열.
  - 종료 코드 0이면 표준 출력을 처음부터 끝까지 `경로 NUL 줄 번호(십진수) NUL 맞은 부분 LF`의 반복으로 읽는다. 경로에는 NUL이 없다. 맞은 부분은 시작 표식이나 끝 표식이고 그 뒤에 공백 한 글자나 CR 한 글자가 붙을 수 있다(그 밖의 글자가 오면 형식에 맞지 않는 것이다). 남는 글자 없이 끝까지 읽혀야 한다.
  - 그 밖의 경우(다른 종료 코드, 종료 코드 1인데 출력이 있다, 종료 코드 0인데 위 형식으로 끝까지 읽히지 않는다)도 검사 실패다.
  - 검사 실패는 문제 한 건을 돌려준다(찾은 표식이 있어도 그 한 건뿐이다): `rule`은 `R7 충돌 표식 검사 실패`, `what`에 `git grep`이라는 글자, `how`에 `git status`라는 글자(이 폴더에서 `git status`가 도는지, 읽을 수 없는 파일이나 폴더가 없는지 확인하고 다시 실행한다는 뜻)가 있다.
- 읽은 줄을 경로로 묶어 파일마다 문제 한 건을 만든다. 줄 번호를 모아 두지 않고 파일마다 가장 작은 줄 번호와 표식 줄의 수만 누적한다(표식 줄이 아주 많은 파일에서도 같은 결과를 낸다). 경로의 코드 단위 순(자바스크립트의 기본 문자열 비교)으로 정렬한다.
  - `rule`: `R7 충돌 표식`
  - `what`: 경로, 그 파일에서 가장 작은 줄 번호, 표식 줄의 수가 들어 있다. 형식은 `<경로>:<줄 번호>에 병합 충돌 표식이 남아 있다(표식 <수>줄)`. 줄 내용은 넣지 않는다.
  - `how`: 충돌 블록을 풀고 표식 줄을 지우라는 것과, 표식 모양의 줄이 꼭 필요한 파일이면 줄 머리에 오지 않게 쓰라는 것.
  - `doc`: `docs/harness/workflow.md 5절`

### 2. 호출처

- `scripts/commands/check.ts`의 `bypass-scan` 단계: `bypassScan`의 문제 목록 뒤에 `conflictMarkers(root)`의 문제 목록을 이어 붙여 판정하고 출력한다. 단계 이름, 실패 키, 캐시는 그대로다.
- `scripts/harness.ts`의 `case 'bypass-scan'`: 명령이 `bypass-scan`일 때 `bypassScan`의 목록 뒤에 `conflictMarkers(info.root)`의 목록을 이어 붙인다. `secret-scan` 명령은 그대로다. 출력 형식(`formatProblem`, 마지막 줄의 `bypass-scan: <수>건` 또는 `bypass-scan: 통과`)과 종료 코드 계산은 그대로다.

### 3. 테스트 `scripts/test/conflict-markers.test.ts`(새 파일)

실제 `git` 리포를 임시 폴더에 만들어 쓴다(`scripts/test/helpers.ts`). 표식 문자열은 반복으로 조립한다.

- **완전한 충돌 블록**: 커밋한 파일의 2번째 줄에 `시작 표식 + 공백 + HEAD`, 4번째 줄에 `=` 일곱 개, 6번째 줄에 `끝 표식 + 공백 + other`. 결과는 문제 한 건이고 `rule`이 `R7 충돌 표식`, `what`에 그 경로와 `:2`와 `표식 2줄`이 있고, `how`와 `doc`이 비어 있지 않다. `what`에 `HEAD`와 `other`가 없다(줄 내용을 옮기지 않는다).
- **표식 하나만 남은 파일**: 끝 표식 줄만 있는 파일과 시작 표식 줄만 있는 파일이 각각 한 건씩 걸린다. 표식 뒤에 아무것도 없는 줄(표식만 있는 줄)도 걸린다.
- **새 파일과 무시되는 파일**: 커밋하지 않은 새 파일의 표식은 걸린다. `.gitignore`에 든 파일의 표식은 걸리지 않는다.
- **걸리지 않는 줄**: `=`만 일곱 개인 줄, 공백 두 개로 들여쓴 표식, 문장 중간의 표식, 같은 문자 여덟 개로 시작하는 줄, 표식 바로 뒤에 공백 없이 글자가 붙은 줄만 있는 파일. 결과는 빈 배열이다.
- **CRLF**: 줄 끝이 CRLF인 파일의 `시작 표식 + CR`인 줄과 `끝 표식 + 공백 + 이름 + CR`인 줄이 걸린다(표식 2줄).
- **바이너리**: NUL 바이트와 표식 줄이 함께 든 파일은 걸리지 않는다.
- **경로**: 이름에 공백, 콜론, 한글이 든 파일의 경로가 `what`에 그대로 있다(Windows는 파일 이름에 콜론을 쓸 수 없어 그 플랫폼에서는 콜론을 붙임표로 바꾼 이름을 쓴다). 파일 셋에 표식이 있으면 문제가 세 건이고 경로 순이다.
- **표식 줄이 아주 많은 파일**: 첫 줄 뒤에 `시작 표식 + 공백 + 글자 400개`인 줄이 200,000개 이어지는 파일(줄 전체를 모으면 80MB를 넘는다)과, 끝 표식 줄 하나가 든 다른 파일이 있다. 결과는 문제 두 건이고 경로 순이다. 첫 건의 `what`은 큰 파일의 경로와 `:2`로 시작하고 `표식 200000줄`이 있다. 둘째 건은 다른 파일의 `:1`이다.
- **표식이 아닌 줄이 아주 많은 파일**: `같은 문자 여덟 개 + 공백 + 글자 400개`인 줄이 170,000개인 파일(이 줄들이 출력에 나오면 `gitTry`의 출력 상한 64MiB를 넘는다)만 있다. 결과는 빈 배열이다.
- 위 두 사례의 큰 파일은 커밋하지 않고(무시되지 않는 새 파일이다), 사례가 끝나면 빈 내용으로 덮어쓴다(임시 폴더에 큰 파일을 남기지 않는다).
- **`assume-unchanged`로 표시한 파일**: (가) 깨끗한 파일을 커밋하고 `git update-index --assume-unchanged`로 표시한 뒤 작업 트리의 2번째 줄에 시작 표식 줄을 넣는다. 결과는 `R7 충돌 표식` 한 건이고 `what`이 그 경로와 `:2`로 시작한다. (나) 2번째 줄에 끝 표식 줄이 든 파일을 커밋하고 같은 표시를 한 뒤 작업 트리의 내용을 표식 없는 내용으로 바꾼다. 결과는 빈 배열이다(작업 트리를 본다).
- **커밋이 없는 리포**: `git init`만 한 리포의 새 파일에 든 표식이 걸린다.
- **`git` 설정**: 리포에 `grep.patternType=fixed`, `grep.column=true`, `color.grep=always`를 설정해도 "완전한 충돌 블록" 사례의 결과가 설정 전과 같다(깊은 비교).
- **읽을 수 없는 파일**: 커밋한 리포에서 표식이 든 추적 파일의 읽기 권한을 없앤다(`chmod 000`). 다른 파일에는 표식이 없다. `conflictMarkers`의 결과는 문제 한 건이고 `rule`이 `R7 충돌 표식 검사 실패`다(빈 배열이 아니다). 권한을 되돌리면 `R7 충돌 표식` 한 건이다. 같은 상태의 리포에서 CLI는 계획의 수용 기준 3대로 실행 방식에 따라 다르다.
  - R4 검사가 작업 트리를 견주는 실행(브랜치가 `main`이라 비교 기준이 있고 `--ci`가 아니다): `bypass-scan`과 `check --only bypass-scan --no-cache`가 종료 코드 1이고 출력에 `git diff`가 있다(R4 검사의 예외. `R7 충돌 표식 검사 실패` 문구는 요구하지 않는다).
  - `--ci`를 붙인 실행: `bypass-scan --ci`와 `check --only bypass-scan --ci`가 종료 코드 1이고 출력에 `R7 충돌 표식 검사 실패`가 있다.
  - 비교 기준이 없는 리포(브랜치 이름을 `work`로 바꿔 `main`도 `origin/main`도 없다): `bypass-scan`과 `check --only bypass-scan --no-cache`가 종료 코드 1이고 출력에 `R7 충돌 표식 검사 실패`가 있다.
- **읽을 수 없는 폴더**: 커밋한 리포에 새 폴더와 그 안의 표식이 든 파일을 만들고(커밋하지 않는다) 폴더의 권한을 없앤다. `conflictMarkers`의 결과는 `R7 충돌 표식 검사 실패` 한 건이다. `bypass-scan` 명령과 `check --only bypass-scan --no-cache`는 종료 코드 1이고 출력에 `R7 충돌 표식 검사 실패`가 있다. 권한을 되돌리면 `conflictMarkers`의 결과는 그 파일의 `R7 충돌 표식` 한 건이다.
- 위 두 사례는 권한으로 읽기를 막을 수 없는 환경(Windows, 관리자 권한 실행)에서는 하지 않는다.
- **검사 실패**: `git` 리포가 아닌 폴더에서 결과는 문제 한 건이고 `rule`이 `R7 충돌 표식 검사 실패`, `what`에 `git grep`, `how`에 `git status`가 있다.
- **CLI**: `harness.config.json`이 있는 임시 리포에서 하네스의 `scripts/harness.ts`를 실행한다.
  - 표식이 든 파일을 커밋한 리포: `bypass-scan`은 종료 코드 1이고 출력(표준 출력과 표준 오류를 합친 것)에 `R7 충돌 표식`, 그 경로, `bypass-scan: 1건`이 있다. `check --only bypass-scan --no-cache`는 종료 코드 1이고 출력에 `✗ bypass-scan`과 `R7 충돌 표식`이 있다.
  - 같은 리포에서 표식 줄을 지우면 두 명령 모두 종료 코드 0이고, `bypass-scan`의 출력에 `bypass-scan: 통과`가 있다.

### 4. 문서

- `docs/harness/workflow.md` 5절 "main에 뒤처지거나 충돌한 PR 갱신"의 "완료 커밋 뒤에 충돌 해결로 코드가 바뀌면 …" 항목 바로 앞에 아래 한 항목을 더한다(글자 그대로). 4절은 고치지 않는다.

  ```text
  - 충돌 표식이 남으면 `check`가 막는다. `bypass-scan` 단계가 작업 트리에서 `<<<<<<<`나 `>>>>>>>`로 시작하는 줄을 찾아 `R7 충돌 표식`으로 알린다. `=======`만 있는 줄은 세지 않는다.
  ```

- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)"에 한 줄: 무엇이 바뀌었는지, 검사를 약화하지 않고 강화한다는 것, 검사 대상과 걸리지 않는 것, 설계서 본문은 바뀌지 않는다는 것.
- `docs/exec-plans/tech-debt-tracker.md`: TD-30 행의 상태를 `해결(#<이 PR 번호>: …)`로 바꾼다. 표의 다른 행이 다시 정렬되지 않게 열 폭 안으로 쓴다.
- 같은 표의 맨 끝에 TD-63 행을 더한다(계획의 수용 기준 1이 남긴 한계). 있던 다른 행은 고치지 않는다.
  - 내용: `git` 출력의 경로를 UTF-8로만 읽는다는 것(실행 도우미 `runSync`가 출력을 UTF-8 글자열로 바꾼다), UTF-8로 읽을 수 없는 파일 이름 둘이 같은 글자열이 되면 충돌 표식 검사가 두 파일을 한 건으로 합쳐 알린다는 것(검사는 실패로 끝난다), `git` 출력에서 경로를 받는 다른 게이트도 같은 방식이라는 것, 고치려면 도우미가 바이트로 받는 길을 주어야 한다는 것.
  - 근거: `scripts/lib/exec.ts`의 `runSync`, `scripts/gates/conflict-markers.ts`, PR #176의 지적 원장(F11). 다시 볼 때: UTF-8이 아닌 파일 이름이 든 리포에 하네스를 붙일 때. 상태: `열림`.

## Acceptance Criteria

```bash
node --test scripts/test/conflict-markers.test.ts scripts/test/gates.test.ts scripts/test/cli.test.ts scripts/test/check-skip.test.ts
node scripts/harness.ts bypass-scan
grep -qxF -e '- 충돌 표식이 남으면 `check`가 막는다. `bypass-scan` 단계가 작업 트리에서 `<<<<<<<`나 `>>>>>>>`로 시작하는 줄을 찾아 `R7 충돌 표식`으로 알린다. `=======`만 있는 줄은 세지 않는다.' docs/harness/workflow.md
grep -q "^| TD-30 .*| 해결(" docs/exec-plans/tech-debt-tracker.md
grep -q "^| TD-63 .*UTF-8.*runSync.*| 열림 " docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- `check`의 단계 이름 목록(`CHECK_STEPS`)을 바꾸지 마라. 이유: 실패 키와 캐시, `--only`의 값이 단계 이름에 묶여 있다.
- `check`의 캐시 키 구성과 캐시 적중 판정을 바꾸지 마라. 이유: 캐시가 적중한 실행이 단계를 다시 돌리지 않는 것은 설계서 6절의 정의다(계획의 비범위).
- `bypassScan` 함수와 `secret-scan`의 동작을 바꾸지 마라. 이유: 이 step은 검사 하나를 더할 뿐이다.
- 검사를 하지 못한 경우를 빈 결과로 넘기지 마라. 이유: 읽지 못한 것을 통과로 치는 동작은 TD-60에서 없앴다.
- 문제의 `what`에 줄 내용을 넣지 마라. 이유: 줄 내용은 작성자가 정하는 글자라 출력에 옮길 이유가 없다(경로와 줄 번호로 충분하다).
- 리포의 파일(계획, 절차서, 테스트, 소스)에 충돌 표식 줄을 두지 마라. 이유: 이 검사가 자기 리포에서 실패한다.
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라(R4). 이유: 표식이 없는 리포의 결과가 같다는 증거다.
- `scripts/hooks/`, `scripts/lib/config.ts`, `harness.config.json`, `profiles/`, `scripts/runner/`, `.github/`, 설계서(`docs/harness/design.md`), 절차서 4절을 고치지 마라. 이유: 범위 밖이고 다른 세션이 고치는 파일이 있다.
