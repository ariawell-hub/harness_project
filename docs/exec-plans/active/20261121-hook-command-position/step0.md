# Step 0: command-name

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준", 의사결정 로그, 진행 로그의 사전 확인)
- `scripts/hooks/shell.ts`(`SimpleCommand`의 `argv`·`args`, `normalize`, `parseInto`, `parseSequence`, `shellArgs`, `Redir`)
- `scripts/hooks/rules.ts`(`evaluateBash`, `gitRules`, `ghRules`, `rmRule`, `externalRules`, `secretRules`, `dbRules`, `followUp`, `sequenceRules`, `isEnvFile`)
- `scripts/test/db-commands.test.ts`(`args`의 계약을 고정한 단언, 실제 bash와의 무작위 대조), `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`
- `docs/harness/design.md` 13.1절, `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행

## 작업

테스트를 먼저 쓰고 실패를 확인해 진행 로그에 적는다(R5). 금지 호출의 글이 든 테스트는 판정만 한다(`evaluate`). 실제 셸 대조에는 가짜 명령만 쓴다.

### 1. 테스트 `scripts/test/command-position.test.ts`(새 파일)

판정은 `evaluate({ kind: 'bash', command, cwd }, ctx)`로 한다(`ctx`는 리포 없음, `dbClients: ['psql']`).

- **금지 호출**(그대로 쓰면 막히는 것. 기대 규칙의 첫 낱말을 함께 둔다): `git push --force origin main`(R14), `git push origin main`(R2), `git reset --hard`(R14), `git clean -fd`(R14), `gh pr review 7 --approve`(R20), `gh secret set X`(R20), `gh auth switch`(R20), `git commit --no-verify -m x`(R4), `rm -rf /`(R14), `psql -c x`(R13), `security find-generic-password -s x`(R20), `npm publish`(R14). 그대로 쓴 판정의 규칙을 기준으로 삼고(테스트가 먼저 그 기준이 위 규칙과 같은지 본다), 감싼 꼴의 판정이 그 기준과 같은 규칙인지 본다.
- **닫는 꼴**(금지 호출마다 모두 기준과 같은 규칙으로 막혀야 한다. `C`는 금지 호출, `이름`은 그 첫 낱말, `나머지`는 그 뒤):
  - 이름 앞의 리다이렉션: `>/dev/null C`, `> /dev/null C`, `2>&1 C`, `</dev/null C`, `&>/dev/null C`, `>&2 C`, `<<<x C`, `2>/dev/null >/dev/null C`, `A=1 >/dev/null C`, `>/dev/null env C`, `env >/dev/null C`.
  - 이름 뒤·이름에 붙은 리다이렉션: `이름 >/dev/null 나머지`, `이름 2>&1 나머지`, `이름 > out 나머지`, `이름>/dev/null 나머지`, `이름> out 나머지`.
  - bash 예약어: `if true; then C; fi`, `if false; then :; else C; fi`, `if false; then :; elif C; then :; fi`, `for a in b; do C; done`, `while true; do C; break; done`, `until false; do C; break; done`, `select a in b; do C; break; done`, `if C; then :; fi`, `while C; do break; done`, `until C; do break; done`, `! C`, `coproc C`.
  - 조합: `if true; then ! C; fi`, `if ! C; then :; fi`, `! time C`, `time ! C`, `if false; then :; else if true; then C; fi; fi`, `if true; then >/dev/null C; fi`, `while :; do 이름 >/dev/null 나머지; done`.
  - zsh: `noglob C`, `nocorrect C`, `- C`, `repeat 1 C`, `if [[ -n x ]] C`, `while [[ -n x ]] C`, `if [[ x == "]]" ]] C`.
- **유지하는 꼴**(지금도 막힌다. 그대로여야 한다): `C >/dev/null`, `time C`, `time -p C`, `{ C; }`, `( C )`, `true && C`, `case x in x) C;; esac`, `f() { C; }; f`, `function f { C; }; f`, `A=1 C`, `env A=1 C`, `command C`, `exec C`, `nohup C`, `echo | xargs C`, `eval "C"`, `bash -c "C"`, `sh -c 'C'`, 줄을 바꾼 `if true\nthen\n  C\nfi`, `for a in b; do { C; }; done`, `if true; then ( C ); fi`, `coproc N { C; }`, `builtin command C`.
- **허용**(막히지 않아야 한다): `echo then git push --force origin main`, `echo do rm -rf /`, `git commit -m "do it"`, `git commit -m "if then else"`, `grep -r "if" .`, `echo '>' git reset --hard`, `if git diff --quiet; then echo clean; fi`, `for f in a b; do node --test "$f"; done`, `until [ -f done.txt ]; do sleep 10; done`, `while read -r line; do echo "$line"; done < in.txt`, `! grep -q x in.txt`, `if [[ -f x ]]; then echo y; fi`, `[[ -n x ]] && echo y`, `git status >/dev/null 2>&1`, `>/dev/null git status`, `git >/dev/null status`, `repeat 3 echo hi`, `noglob echo *`, `cat <.env.example`, `gh issue comment 1 --body "cat <.env"`(따옴표 안의 글은 리다이렉션이 아니다), `node scripts/harness.ts check > check.log 2>&1 && git push origin feat/x`.
- **분석기의 낱말**(`parseShell`): `>/dev/null git push`의 `argv`는 `['git', 'push', '>/dev/null']`이고 `args`는 `['git', 'push']`다. `> out git push`는 `argv` `['git', 'push', '>', 'out']`. `git>/dev/null push`는 `argv` `['git', '>/dev/null', 'push']`, `args` `['git', 'push']`. `git >/dev/null push`의 `argv`는 그대로 `['git', '>/dev/null', 'push']`다(인자 사이의 리다이렉션은 옮기지 않는다). `if true; then git push; fi`는 `argv`가 `['git', 'push']`인 명령을 낸다. `>/dev/null` 하나뿐인 명령과 `> out`은 전과 같은 `argv`(`['>/dev/null']`, `['>', 'out']`)다. 예약어뿐인 조각(`then`뿐인 줄)은 전처럼 그 낱말을 담은 명령을 낸다(`argv`는 `['then']`). PowerShell·cmd 방언에서는 예약어와 zsh 수식어를 벗기지 않는다(`parseShell('then git push', 'powershell')`의 `argv`는 `['then', 'git', 'push']`).
- **검사 순서 규칙**(R4 검사 우회로 막혀야 한다): `node scripts/harness.ts check; >/dev/null git push origin x`, `node scripts/harness.ts check; git >/dev/null push origin x`, `node scripts/harness.ts check; git>/dev/null push origin x`, `>/dev/null node scripts/harness.ts check; git push origin x`, `>check.log node scripts/harness.ts check | cat`, `node scripts/harness.ts >check.log check; git push origin x`, `node scripts/harness.ts check; ! git push origin x`, `node scripts/harness.ts check; noglob git push origin x`. 막히지 않아야 하는 것: `node scripts/harness.ts check >check.log 2>&1 && >/dev/null git push origin x`, `if node scripts/harness.ts check; then git push origin x; fi`.
- **파일 이름 검사**: `cat <.env`, `<.env cat`, `cat 0<.env`, `wc -l <.env`, `cat<.env`, `cat <.env.local`, `cat < .env`가 R10으로 막힌다. `cat <~/.config/gh/hosts.yml`은 R20으로 막힌다(지금도 막힌다). `cat <.env.example`, `ls .env`(지금도 허용)는 막히지 않는다.
- **실제 셸 대조**: 닫는 꼴·유지하는 꼴의 감싸는 틀과 인자 자리에 예약어가 있는 틀(`echo then C`, `"then" C`, `A=1 then C`)에 `C`로 `tool a b`를 넣어 실제 셸로 돌린다. `tool`은 받은 인자를 환경 변수가 가리키는 파일에 적는 함수다(`db-commands.test.ts`의 무작위 대조와 같은 방식. 임시 폴더에서 돌린다). bash(`bash -c`)와 zsh(`zsh -f -c`)를 각각 돌려, 셸이 `tool`을 인자 `a b`로 실행한 틀에서는 `parseShell`이 `(args ?? argv)`가 `['tool', 'a', 'b']`인 명령을 내는지 본다. 셸이 실행하지 않은 틀은 비교하지 않는다. 그 셸이 없거나 Windows면 그 셸의 대조를 건너뛴다(`t.skip`). 비교한 틀의 수가 bash는 30 이상, zsh는 35 이상이어야 한다(대조가 조용히 비지 않게 한다).
- **시간**: `]]`를 20,000번 넣은 입력, `then`을 20,000번 넣은 입력, 리다이렉션 낱말 20,000개가 이름 앞에 온 입력의 판정이 각각 5초 안에 끝난다(별도 프로세스로 돌려 시간을 건다).

### 2. 분석기 `scripts/hooks/shell.ts`

- `normalize`가 앞의 할당·래퍼를 벗기는 자리에서 다음도 벗긴다(순서와 무관하게, 섞여 있어도):
  - 리다이렉션뿐인 낱말(연산자와 그 대상): 건너뛰고 `argv`의 끝으로 옮긴다.
  - 리다이렉션이 붙은 낱말(`env>/dev/null`, `git>/dev/null`): 앞의 글을 낱말로 보고, 붙은 리다이렉션을 따로 뗀다. 벗기는 낱말이면 리다이렉션은 끝으로 옮기고, 명령 이름이면 이름 바로 뒤에 둔다.
  - POSIX 방언에서만: bash의 예약어(`then`, `do`, `else`, `elif`, `if`, `while`, `until`, `!`, `coproc`. `time`은 이미 래퍼다)와 zsh의 명령 앞 수식어(`noglob`, `nocorrect`, `-`, `repeat`와 그 뒤의 횟수 낱말 하나).
- 그 결과 `argv`의 첫 낱말은 명령 이름이다. 명령 이름이 없으면 리다이렉션 낱말만 `argv`에 남긴다(전과 같은 `argv`). 예약어·수식어뿐인 조각은 전처럼 그 낱말을 `argv`에 담는다. 래퍼뿐이어서 아무 낱말도 남지 않으면 전처럼 명령을 내지 않는다(할당이 있으면 할당만 낸다).
- `args`는 전처럼 `argv`에서 리다이렉션을 뺀 것이다(`argv`와 같으면 두지 않는다). 인자 사이의 리다이렉션은 `argv`에 그 자리 그대로 둔다.
- `SimpleCommand`에 `targets`(없으면 두지 않는다)를 더한다: 낱말에 붙은 리다이렉션의 대상이다. 토큰화가 따옴표 밖의 연산자로 판별한 리다이렉션 낱말에서, 연산자가 시작한 뒤의 글을 연산자 글자(`<`·`>`와 뒤따르는 `&`·`|`)에서 나눈 조각이다(`<.env` → `.env`, `0<.env` → `.env`, `<a>b` → `a`, `b`). 따옴표로 묶은 글 안의 `<.env`는 리다이렉션이 아니므로 대상이 아니다. 띄어 쓴 대상(`< .env`)은 전처럼 `argv`의 낱말이다.
- `bash -c`·`eval`·`powershell -Command`·`cmd /c`·`iex`의 재귀는 `args`(리다이렉션을 뺀 인자)로 본다.
- `parseInto`(POSIX 방언): 단순 명령에 `[[` 낱말이 나온 뒤에는 `]]` 낱말마다 그 자리에서 명령을 나눈다(연산자를 만나면 그 상태를 끝낸다).
- `parseSequence`: 낱말의 리다이렉션 정보를 `normalize`에 넘겨 같은 처리를 받는다. 제어문의 낱말(`then`, `do`, `else`, `elif`, `if`, `while`, `until`)은 벗기지 않는다(`normalize`에 선택 인자를 둔다). 제어문이 아닌 낱말(`!`, `coproc`, zsh 수식어)은 여기서도 벗긴다.
- `SimpleCommand`의 주석을 새 계약에 맞게 고친다.

### 3. 규칙 `scripts/hooks/rules.ts`

- `evaluateBash`: 명령마다 "인자로 보는 꼴"(`args`가 있으면 `argv` 자리에 `args`를 넣은 것)을 만들어, 이름과 인자의 자리로 고르는 규칙(`gitRules`, `ghRules`, `rmRule`, `externalRules`, `secretRules`의 명령 이름·하위 명령 판정)에 넘긴다. 명령 이름은 그 꼴의 첫 낱말이다. 낱말을 이은 글과 대상 파일을 보는 규칙은 `argv`를 계속 쓴다.
- `secretRules`의 파일 이름 검사(자격증명 파일, `.env`): `argv`의 낱말과 함께 분석기가 낸 `targets`(낱말에 붙은 리다이렉션의 대상)도 본다. `.env`를 읽어도 되는 명령의 예외(`ENV_READ_EXEMPT`)와 `.env.example`의 예외는 그대로다.
- `dbRules`의 DB 클라이언트 검사: `argv`와 `args`의 낱말을 모두 본다(리다이렉션이 붙은 `psql>/dev/null`).
- `followUp`(검사 순서 규칙): `git`의 하위 명령과 `gh pr create`·`ready`의 자리를 `args`로 본다.
- 규칙의 금지 목록·예외 목록·메시지는 바꾸지 않는다.

### 4. 문서

- `docs/harness/design.md` 13.1절: `  - 명령 이름은 대소문자와 …` 줄 바로 아래에 다음 한 줄을 넣는다(글자 그대로). 13.1절의 다른 줄은 바꾸지 않는다.

  ```text
    - 명령 이름의 자리: 규칙은 셸이 실제로 실행하는 명령의 이름과 인자를 본다. 분석기는 명령 이름 앞의 리다이렉션(`>/dev/null git …`)을 인자 뒤로 옮기고, 이름에 붙은 리다이렉션(`git>/dev/null …`)을 떼고, 명령 앞에 서는 낱말을 벗긴다: bash의 예약어(`then`·`do`·`else`·`elif`·`if`·`while`·`until`·`!`·`coproc`)와 zsh의 명령 앞 수식어(`noglob`·`nocorrect`·`-`·`repeat N`). `[[ … ]]` 뒤에 이어진 낱말은 새 명령으로 본다(zsh의 짧은 꼴 `if [[ … ]] 명령`). 이름과 인자의 자리로 고르는 규칙(`git`·`gh`·삭제·운영 작용·자격증명 도구)은 리다이렉션을 뺀 인자로 판정하므로 인자 사이에 리다이렉션이 끼어도(`git >/dev/null push …`) 판정이 같다. 파일 이름을 보는 규칙(R10의 `.env`, 자격증명 파일)은 리다이렉션에 붙은 대상(`<.env`)도 본다. 이 꼴들에서 실제 bash와 zsh가 명령을 실행하는지를 테스트가 대조한다(그 셸이 있는 환경에서). 남는 틈: 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`), 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`), cmd 방언의 `if`·`for … do` 뒤의 명령, 검사 순서 규칙(R4)이 `if`·`for` 안의 명령을 순서에 넣지 않는 것(TD-62).
  ```

- 설계서 0절 버전 이력과 문서 머리의 버전(번호는 push할 때 main의 다음 번호), `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(Issue #182, 검사를 약화하지 않는다는 것). PR 본문에 `- [x] 보호 경로 변경: …` 줄.
- `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행: `(3) …` 부분만 다음 글로 바꾼다(글자 그대로. 표의 칸 맞춤 공백은 포매터가 정한다). 다른 행과 그 행의 다른 항목은 바꾸지 않는다.

  ```text
  (3) 명령 이름을 가리는 꼴 가운데 남은 것: 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`), 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`), cmd 방언의 `if`·`for … do` 뒤의 명령, 검사 순서 규칙(R4)이 `if`·`for` 안의 명령을 순서에 넣지 않는 것(명령 이름 앞·뒤의 리다이렉션, bash 예약어와 zsh 수식어 뒤의 명령은 #182가 닫았다).
  ```

## Acceptance Criteria

```bash
node --test scripts/test/command-position.test.ts
node --test scripts/test/shell.test.ts scripts/test/guard.test.ts scripts/test/db-commands.test.ts scripts/test/profile-web-db.test.ts
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- scripts/test | tr '\n' ' ')" = "scripts/test/command-position.test.ts "
O=$(mktemp -d) && printf '%s\n' '  - 명령 이름의 자리: 규칙은 셸이 실제로 실행하는 명령의 이름과 인자를 본다. 분석기는 명령 이름 앞의 리다이렉션(`>/dev/null git …`)을 인자 뒤로 옮기고, 이름에 붙은 리다이렉션(`git>/dev/null …`)을 떼고, 명령 앞에 서는 낱말을 벗긴다: bash의 예약어(`then`·`do`·`else`·`elif`·`if`·`while`·`until`·`!`·`coproc`)와 zsh의 명령 앞 수식어(`noglob`·`nocorrect`·`-`·`repeat N`). `[[ … ]]` 뒤에 이어진 낱말은 새 명령으로 본다(zsh의 짧은 꼴 `if [[ … ]] 명령`). 이름과 인자의 자리로 고르는 규칙(`git`·`gh`·삭제·운영 작용·자격증명 도구)은 리다이렉션을 뺀 인자로 판정하므로 인자 사이에 리다이렉션이 끼어도(`git >/dev/null push …`) 판정이 같다. 파일 이름을 보는 규칙(R10의 `.env`, 자격증명 파일)은 리다이렉션에 붙은 대상(`<.env`)도 본다. 이 꼴들에서 실제 bash와 zsh가 명령을 실행하는지를 테스트가 대조한다(그 셸이 있는 환경에서). 남는 틈: 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`), 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`), cmd 방언의 `if`·`for … do` 뒤의 명령, 검사 순서 규칙(R4)이 `if`·`for` 안의 명령을 순서에 넣지 않는 것(TD-62).' > "$O/line.txt" && git show "$(git merge-base HEAD origin/main):docs/harness/design.md" | sed -n '/^### 13.1/,/^### 13.2/p' > "$O/base.txt" && L=$(grep -n -F '  - 명령 이름은 대소문자와 `.exe` 등 확장자를 무시하고 비교한다.' "$O/base.txt" | cut -d: -f1) && test -n "$L" && awk -v at="$L" -v f="$O/line.txt" 'BEGIN {getline row < f} {print} NR == at {print row}' "$O/base.txt" > "$O/expected.txt" && sed -n '/^### 13.1/,/^### 13.2/p' docs/harness/design.md > "$O/now.txt" && diff "$O/expected.txt" "$O/now.txt"
O=$(mktemp -d) && git show "$(git merge-base HEAD origin/main):docs/exec-plans/tech-debt-tracker.md" > "$O/base.md" && OLD='(3) 명령 이름으로 고르는 규칙(`git`·`gh`: R2·R14·R20)은 명령 이름 앞에 리다이렉션이 오는 호출과 예약어(`then`·`do`) 뒤의 명령에서 돌지 않는다(Issue #172의 작업 중에 확인했다).' NEW='(3) 명령 이름을 가리는 꼴 가운데 남은 것: 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`), 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`), cmd 방언의 `if`·`for … do` 뒤의 명령, 검사 순서 규칙(R4)이 `if`·`for` 안의 명령을 순서에 넣지 않는 것(명령 이름 앞·뒤의 리다이렉션, bash 예약어와 zsh 수식어 뒤의 명령은 #182가 닫았다).' node -e 'const fs = require("fs"); const base = fs.readFileSync(process.argv[1], "utf8"); if (base.split(process.env.OLD).length !== 2) process.exit(2); const sq = (s) => s.split("\n").map((l) => l.replace(/ +\|$/, " |")).join("\n"); const want = sq(base.replace(process.env.OLD, process.env.NEW)); const got = sq(fs.readFileSync("docs/exec-plans/tech-debt-tracker.md", "utf8")); process.exit(want === got ? 0 : 1);' "$O/base.md"
grep -q '#182' docs/harness/CHANGELOG.md
node scripts/harness.ts self-test
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 셋째 줄: 이 PR이 `scripts/test/` 아래에서 바꾼 파일은 새 테스트 파일 하나뿐이다(기존 테스트의 단언을 고치지 않았다).
- 넷째 줄: 13.1절은 PR이 갈라진 지점의 13.1절에 고정한 한 줄을 정해진 자리에 넣은 것과 글자 그대로 같다(기대한 글을 고정한 글로 만들어 절 전체를 비교한다).
- 다섯째 줄: 기술 부채 표는 PR이 갈라진 지점의 표에서 TD-62의 `(3)` 글만 고정한 글로 바꾼 것과 같다(칸 맞춤 공백은 빼고 표 전체를 비교한다. 바꿀 글이 갈라진 지점에 한 번만 있어야 한다).
- `origin/main`이 필요하다(`git fetch origin`).

## 금지사항

- 기존 테스트 파일의 단언을 고치거나 지우지 마라. 이유: 있는 계약(`argv`가 인자 사이의 리다이렉션을 그대로 담는다, `args`가 bash가 넘기는 인자와 같다)이 그대로인지를 그 테스트가 본다(R4). 기존 단언과 부딪히면 멈추고 진행 로그에 적는다.
- 규칙의 금지 목록·예외 목록(`ENV_READ_EXEMPT`, `WRAPPERS` 밖의 실행기 등)을 바꾸거나, 막히던 호출이 통과하게 만들지 마라. 이유: 이 step은 규칙이 보는 자리를 바로잡는 것이다. 차단을 풀지 않는다.
- 테스트나 명령으로 금지 호출을 실제로 실행하지 마라. 판정(`evaluate`)만 하고, 실제 셸 대조는 가짜 명령 `tool`로만 한다. 이유: R2·R14·R20.
- 훅을 끄거나 우회해 확인하지 마라(R4). 금지 호출의 글이 든 내용은 파일 도구로 쓴다.
- 검사 순서용 분석에서 제어문의 낱말(`then`, `do`, `if` …)을 벗기지 마라. 이유: `if 검사; then push; fi`가 막힌다(계획의 비범위).
- `harness.config.json`, 권한 프로필, `.github/`를 고치지 마라. 이유: 이 step의 범위가 아니다.
