# Step 0: init-target

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`commands/` 줄, `profiles/` 항목)
- `docs/harness/design.md` 16절(도입 절차)
- `scripts/commands/init.ts`(전체), `scripts/harness.ts`의 `HELP`·`OPTIONS`·`scanArgs`·`main`(옵션을 읽는 부분과 `init` 분기)
- `scripts/test/profile-web.test.ts`, `scripts/test/profile-web-db.test.ts`(`init`을 함수로 부르는 테스트), `scripts/test/cli.test.ts`(명령줄을 프로세스로 돌리는 방법), `scripts/test/helpers.ts`
- `profiles/core/profile.json`, `profiles/web/profile.json`, `harness.config.json`, `README.md`의 "새 프로젝트에 적용하기"

## 작업

### 1. `scripts/commands/init.ts`

- `init(root: string, profile: string, opts: { owner?: string; bot?: string; dryRun?: boolean }): number`. 지금의 호출(`init(root, 'web', {})`)은 그대로 동작한다.
- 순서:
  1. `<root>/harness.config.json`이 없으면 표준 오류에 `설정 파일이 없다: <경로>`와 고치는 법(템플릿을 복사한 폴더에서 실행하거나 `--repo`로 가리킨다)을 쓰고 1을 돌려준다. 아무것도 쓰지 않는다.
  2. 프로파일 파일이 없으면 지금의 문구(`프로파일이 없다: …`)와 1이다.
  3. 경로 검사. 대상 폴더의 실제 경로(`realpathSync(root)`)를 기준으로, 아래 경로의 실제 위치가 그 안인지 본다(`resolvesInside`). 설정 파일과 프로파일 파일을 먼저 보고(프로파일을 읽기 전이다), 프로파일을 읽은 뒤 각 템플릿의 원본(`profiles/<이름>/<from>`)과 놓일 자리(`<to>`)를 본다. 건너뛸 템플릿도 본다. 밖인 것이 있으면 표준 오류에 `대상 폴더 밖을 가리키는 경로가 있다(심볼릭 링크나 상위 경로): <경로들>`과 `아무것도 쓰지 않았다`를 쓰고 1을 돌려준다. 이 검사는 설정 파일을 쓰기 전에 모두 끝낸다. `dryRun`에서도 같다.
  4. 적용한 설정을 만든다. 결과는 지금의 코드가 만드는 것과 값도 키의 순서도 같다: 지금의 설정에 프로파일의 `config` 항목을 덮어쓰고, `profile`·`profileVersion`을 적고, `github`에 `owner`·`bot`(주어졌을 때만)을 적는다.
  5. 바뀐 항목을 구한다(`changedKeys`). 비었으면 내용이 같은 것이다.
  6. 설정 파일:
     - `dryRun`: 쓰지 않는다. 첫 줄에 `[dry-run] 파일을 쓰지 않는다. 대상: <root>`. 이어서 바뀔 항목이 있으면 `프로파일 <이름>@<버전>을 적용하면 harness.config.json의 다음 항목이 바뀐다: <항목들>`, 없으면 `프로파일 <이름>@<버전>은 이미 적용돼 있다: harness.config.json에서 바뀌는 항목이 없다.`
     - 내용이 같다: 쓰지 않는다. `프로파일 <이름>@<버전>은 이미 적용돼 있다: harness.config.json을 다시 쓰지 않았다.`
     - 내용이 다르다: 지금처럼 `JSON.stringify(설정, null, 2) + '\n'`으로 쓴다. `프로파일 <이름>@<버전>을 harness.config.json에 적용했다. 바뀐 항목: <항목들>`과, 파일 전체를 다시 써 서식이 달라졌을 수 있으니 의존성을 설치한 뒤 `node scripts/harness.ts fmt`로 맞추라는 줄을 출력한다.
  7. 템플릿: 건너뛰는 조건과 문구(`- 건너뜀(이미 있음): …`)는 그대로다. 복사할 템플릿은 `dryRun`이면 복사하지 않고 `- 템플릿 복사 예정: <경로>`, 아니면 지금처럼 복사하고 `- 템플릿 복사: <경로>`.
  8. 남은 수동 작업 안내: 글은 그대로다. `dryRun`에서도 출력한다. 필수 체크 목록은 적용한 설정에서 만든다(지금과 같다).
- `changedKeys(before, after): string[]`(export) — 값이 달라진 항목의 이름.
  - 양쪽의 최상위 키를 `before`의 키 순서, 이어서 `after`에만 있는 키의 순서로 본다. 값이 같으면(`isDeepStrictEqual`) 건너뛴다.
  - 양쪽 값이 모두 배열이 아닌 객체면 그 아래 키를 같은 방법으로 보고 `<키>.<아래 키>`로 적는다. 아니면 `<키>`만 적는다. 한쪽에만 있는 키도 달라진 것이다.
  - 두 단계까지만 내려간다.
- `resolvesInside(realRoot, p): boolean`(export) — 경로의 실제 위치가 `realRoot` 안(또는 `realRoot` 자신)인가.
  - 경로가 있으면(`lstatSync`가 성공하면) `realpathSync`로 푼 위치로 본다. 풀리지 않으면(끊긴 링크) 밖이다. 이유: 끊긴 링크 자리에 쓰면 링크가 가리키는 곳에 파일이 생긴다.
  - 없으면 있는 가장 가까운 상위 폴더를 풀고 나머지 경로를 붙여 본다. 이유: 상위 폴더가 밖을 가리키는 링크면 그 아래에 만드는 파일이 밖에 생긴다.
  - 안인지는 경로 구분자까지 맞춰 본다(이름의 앞부분만 같은 이웃 폴더는 밖이다).

### 2. `scripts/harness.ts`

- `init` 분기: 대상은 `path.resolve(str('repo') ?? repoInfo(cwd).root)`(다른 명령의 `--repo`와 같은 꼴). `dryRun: flag('dry-run')`을 넘긴다. `--repo`가 있으면 명령을 실행한 폴더가 git 리포가 아니어도 된다.
- 옵션 표(`OPTIONS`)에 `'dry-run': { type: 'boolean' }`을 더한다.
- 옵션을 읽은 직후, 어떤 명령도 실행하기 전에 `--dry-run`의 쓰임을 검사한다. 어긋나면 표준 오류에 이유를 쓰고 2를 돌려준다.
  - 명령이 `init`이 아닌데 `--dry-run`이 있다: `--dry-run은 init에서만 쓴다(<명령>은 받지 않는다)`.
  - `init`인데 값이 붙었다(`--dry-run=false`, `--dry-run=true`, `--dry-run=`): `--dry-run은 값을 받지 않는다`. 이유: 값을 붙이면 불리언으로 읽히지 않아 `flag('dry-run')`이 거짓이 되고 실제로 쓴다.
  - `--` 뒤의 인자는 지금처럼 보지 않는다.
  - 검사는 옵션 파서(`parseArgs`)가 읽은 값으로 한다. 인자를 따로 훑지 않는다. 문자열 옵션의 값 자리에 온 글자(`--owner --dry-run=x`의 `--dry-run=x`)는 그 옵션의 값이고 `--dry-run`이 아니다(`scanArgs`가 값 자리를 건너뛰는 것과 같다).
- 도움말의 `init` 줄: `init --profile core|web [--repo <폴더>] [--dry-run] [--owner <제작자 계정>] [--bot <봇 계정>]`과 그 아래 설명(대상 리포, 프로파일을 대상 리포의 `profiles/`에서 읽는 것, `--dry-run`, 내용이 같으면 다시 쓰지 않는 것).

### 3. 테스트 `scripts/test/init.test.ts`(새 파일, 먼저 쓴다)

임시 폴더에 이 리포의 `profiles/`와 `harness.config.json`을 복사해 쓴다. 명령줄 테스트는 `scripts/harness.ts`를 프로세스로 돌린다(`cli.test.ts`와 같은 방법).

함수(`init`, `changedKeys`):

- 같은 프로파일(core)을 다시 적용하면 설정 파일의 바이트가 그대로다. 먼저 그 파일을 `JSON.stringify`로 다시 쓰면 바이트가 달라진다는 것을 단언해, 이 테스트가 "다시 쓰지 않음"을 본다는 것을 확인한다.
- 서식을 바꾸고(한 줄 JSON) 프로파일이 정하는 객체 항목의 키 순서를 뒤집어 둔 설정도 다시 쓰지 않는다.
- web을 `owner`·`bot`과 함께 적용하면 쓴 파일이 `JSON.stringify({...지금 설정, ...프로파일 config, profile, profileVersion, github: {...지금 github, owner, bot}}, null, 2) + '\n'`과 글자까지 같다. `loadConfig`가 통과하고 템플릿 넷이 생긴다. 서식을 바꿔 둔 뒤 같은 인자로 다시 실행하면 그대로다. `owner`만 바꿔 실행하면 그 값만 바뀐다.
- `dryRun`: 종료 값이 0이고, 폴더 아래 모든 파일의 경로와 바이트가 그대로다. 복사 대상인 자리 표시 파일(`harness:placeholder`가 든 `ARCHITECTURE.md`)을 미리 둬 그 바이트가 그대로인지도 본다.
- 프로파일의 템플릿 `to`가 `../…`이면 종료 값 1이고 폴더 아래 파일이 그대로이며 대상 폴더 밖에 파일이 생기지 않는다.
- `resolvesInside`: 폴더 자신·안의 파일·아직 없는 깊은 경로는 안, 상위 폴더·`..`으로 벗어난 경로·이름 앞부분만 같은 이웃 폴더는 밖. 링크: 밖을 가리키는 폴더 링크와 그 아래 경로는 밖, 안을 가리키는 링크는 안, 끊긴 링크는 밖.
- `changedKeys`: 같은 값이면 빈 배열, 객체 안 키 순서만 다르면 같다, 배열의 순서가 다르면 다르다, 객체 값은 아래 키까지(더해진 키·바뀐 키), 최상위에서 사라진 키와 더해진 키, 한쪽만 객체면 키 이름만, 배열과 객체는 다르다.

명령줄:

- `--repo`: 리포 A에서 `init --profile web --repo <B> --owner …`를 실행한다. A와 B의 웹 프로파일을 서로 다르게 만든다(버전, 설정값 하나, 템플릿 하나의 글). B에는 자리 표시 파일(`ARCHITECTURE.md`)과 있던 파일(`e2e/smoke.spec.ts`)을 둔다.
  - A의 모든 파일(경로와 바이트)이 그대로다.
  - B의 설정이 B의 프로파일에서 왔다(`profileVersion`과 그 설정값이 B의 것). B에 생긴 템플릿의 글이 B의 것이다. 자리 표시 파일은 B의 템플릿으로 바뀌고 있던 파일은 그대로다(`- 건너뜀(이미 있음): …`).
  - 출력에 `적용했다. 바뀐 항목: `, `github.owner`, `fmt` 안내, `남은 수동 작업`이 있다.
- `--repo`의 상대 경로는 명령을 실행한 폴더 기준이다. `--repo`가 없으면 실행한 리포에 적용된다.
- `--dry-run`: 자리 표시 파일과 있던 파일을 둔 리포에서 실행한다. 종료 코드가 0이고 모든 파일의 경로와 바이트가 그대로다. 출력이 `[dry-run] 파일을 쓰지 않는다`로 시작하고, 바뀔 항목(`profile`, `profileVersion`, `github.owner`, `commands.`으로 시작하는 항목), 복사될 템플릿 셋의 `- 템플릿 복사 예정: `(자리 표시 파일 포함), 있던 파일의 `- 건너뜀(이미 있음): `, `남은 수동 작업`이 있고 `적용했다`와 `- 템플릿 복사: `는 없다. 같은 프로파일이면 바뀌는 항목이 없다고 나온다.
- 이미 적용된 리포에서 `init --profile core`: 바이트가 그대로이고 `다시 쓰지 않았다`와 `남은 수동 작업`이 나온다.
- `--dry-run=false`·`--dry-run=true`·`--dry-run=`을 `init`에 주면 종료 코드 2와 `값을 받지 않는다`. `codeowners`·`fmt`·`start`에 `--dry-run`을 주면 종료 코드 2와 `init에서만 쓴다`. 어느 경우에도 모든 파일이 그대로다. `init --profile core --dry-run --owner --dry-run=x`는 종료 코드 0이고 바뀔 항목이 `github.owner`다(값 자리의 글자는 옵션이 아니다).
- 빈 폴더를 `--repo`로 가리키면 종료 코드 1, `설정 파일이 없다: `, 스택 줄(`    at …`)이 없고 그 폴더에 파일이 생기지 않는다. 없는 프로파일은 종료 코드 1과 `프로파일이 없다: `.
- 대상 폴더 밖을 가리키는 링크(심볼릭 링크를 만들 수 없는 환경에서는 건너뛴다). 모두 종료 코드 1, `대상 폴더 밖을 가리키는 경로가 있다`, 밖의 폴더의 파일이 그대로다.
  - 설정 파일이 다른 리포의 설정을 가리키는 링크다(`--dry-run`에서도 거절한다). 템플릿도 복사하지 않는다.
  - 템플릿이 놓일 폴더(`docs/product`)가 밖을 가리키는 링크다. 설정 파일도 쓰지 않았고 다른 템플릿도 복사하지 않았다.
  - 템플릿 자리(`e2e/smoke.spec.ts`)에 밖을 가리키는 끊긴 링크가 있다. 밖에 파일이 생기지 않는다.
  - 프로파일 폴더(`profiles/web`)가 밖을 가리키는 링크다. 설정 파일을 쓰지 않는다.
- 도움말에 `init --profile core|web [--repo <폴더>] [--dry-run]`이 있다.

테스트만 담은 커밋을 구현 커밋보다 먼저 만들고, 구현 전의 실패를 진행 로그에 적는다.

### 4. 문서와 기술 부채 표

- `README.md` "새 프로젝트에 적용하기" 1번: 코드 블록의 명령 순서를 `init` → `pnpm install` → `node scripts/harness.ts fmt` → `check`로 한다. 코드 블록 아래에, 적용하기 전에 `--dry-run`으로 바뀔 항목을 볼 수 있다고 한 줄 적는다.
- `docs/harness/design.md`: 머리말의 버전을 올리고 0절 변경 이력에 한 항목(Issue #208, TD-31 해결)을 더한다. 16절 "새 프로젝트" 3번에 `init`의 동작을 적는다: 대상 리포(`--repo`), 내용이 같으면 설정 파일을 다시 쓰지 않는 것, `--dry-run`, 다시 쓴 뒤의 `fmt`.
- `docs/harness/CHANGELOG.md`: "다음 버전"에 한 항목.
- `docs/exec-plans/tech-debt-tracker.md`: TD-31의 상태를 `해결(#208: …)`로 바꾼다. 새 행 하나: 명령줄의 옵션 표가 명령 공용이라 명령이 읽지 않는 옵션을 조용히 받는다("발견 사항" 첫 항목. 상태 `열림`).
- 계획의 "발견 사항" 두 항목 끝에 `→ 처리: …`를 적는다(첫 항목은 새 TD 번호, 둘째는 README).

## Acceptance Criteria

```bash
node --test scripts/test/init.test.ts scripts/test/profile-web.test.ts scripts/test/profile-web-db.test.ts scripts/test/cli.test.ts
git rev-parse --verify --quiet origin/main^{commit}
git diff --quiet origin/main...HEAD -- scripts/test/profile-web.test.ts scripts/test/profile-web-db.test.ts profiles harness.config.json
grep -qF 'init --profile core|web [--repo <폴더>] [--dry-run]' scripts/harness.ts
awk '/^## 새 프로젝트에 적용하기/{f=1;next} /^## /{f=0} f' README.md | grep -oE 'harness\.ts init --profile|pnpm install|harness\.ts fmt|harness\.ts check' | head -4 | tr '\n' ' ' | grep -qF 'harness.ts init --profile pnpm install harness.ts fmt harness.ts check'
awk '/^## 새 프로젝트에 적용하기/{f=1;next} /^## /{f=0} f' README.md | grep -qF -- '--dry-run'
awk '/^## 16\. /{f=1;next} /^## 17\. /{f=0} f' docs/harness/design.md | grep -qF -- '--dry-run'
awk '/^## 16\. /{f=1;next} /^## 17\. /{f=0} f' docs/harness/design.md | grep -qF -- '--repo'
awk '/^## 16\. /{f=1;next} /^## 17\. /{f=0} f' docs/harness/design.md | grep -qF '다시 쓰지 않는다'
awk '/^## 16\. /{f=1;next} /^## 17\. /{f=0} f' docs/harness/design.md | grep -qF 'node scripts/harness.ts fmt'
grep -qE '^  - v0\.7\.[0-9]+ \(2026-11-[0-9]+\): .*Issue #208' docs/harness/design.md
grep -qF -- '--dry-run' docs/harness/CHANGELOG.md
grep -qE '^\| TD-31 .*\| 해결\(#208' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-[0-9]+ +\| .*옵션 표.*명령 공용.*\| 열림 *\|$' docs/exec-plans/tech-debt-tracker.md
test "$(grep -c '→ 처리: ' docs/exec-plans/*/20261122-init-repo-noop/plan.md)" = 2
node scripts/harness.ts doc-lint
```

## 금지사항

- 남은 수동 작업 안내의 글과 `requiredCheckGuide`를 바꾸지 마라. 이유: 범위 밖이고 다른 테스트(`ops-check`·필수 체크 관련)가 그 함수를 쓴다.
- 내용이 달라질 때 쓰는 결과(값, 키의 순서, 들여쓰기 2칸)를 바꾸지 마라. 이유: 지금의 사용법의 결과가 그대로여야 한다(수용 기준 3).
- 템플릿을 건너뛰는 조건을 바꾸지 마라. 이유: 있는 파일을 덮어쓰게 되면 사용자의 문서가 사라진다.
- `dryRun`에서 파일이나 폴더를 만들지 마라(`mkdirSync` 포함). 이유: 쓰지 않는 실행이다.
- 대상 폴더 밖을 가리키는 링크를 따라가 읽거나 쓰지 마라. 링크를 지우거나 풀어서 새 파일로 바꾸지도 마라. 이유: 밖의 파일이 바뀌거나, 사용자가 둔 링크가 말없이 사라진다. 거절하고 이유를 낸다.
- `--dry-run`을 옵션 표에 더하기만 하고 사용 제한 없이 두지 마라. 이유: 다른 명령이 조용히 받아 실제로 실행한다.
- 옵션 표를 명령별로 나누거나 다른 옵션의 검사를 더하지 마라. 이유: 모든 명령의 사용법을 확인해야 하는 일이라 범위 밖이다. 새 기술 부채 행으로 남긴다.
- `init`이 포맷터를 부르거나 `prettier`를 import하게 하지 마라. 이유: 코어는 프로파일의 도구를 모른다(S5). 의존성 설치 전에 돈다.
- `scripts/test/profile-web.test.ts`, `scripts/test/profile-web-db.test.ts`, `profiles/`, `harness.config.json`을 고치지 마라. 이유: 있던 동작이 그대로라는 것을 그 테스트가 본다.
- 테스트가 이 리포의 `harness.config.json`이나 `profiles/`에 쓰게 하지 마라(임시 폴더의 복사본에만 쓴다). 이유: 테스트가 작업 중인 리포의 설정을 바꾸면 안 된다.
