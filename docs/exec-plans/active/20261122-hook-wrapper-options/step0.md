# Step 0: wrapper-options

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- 이 계획의 `plan.md`("목표와 수용 기준", 의사결정 로그, 진행 로그의 사전 확인)
- `scripts/hooks/shell.ts`(`WRAPPERS`, `normalize`의 "앞의 할당과 래퍼, 명령 앞에 서는 낱말을 벗긴다" 자리, `env`·`timeout`·`xargs`의 처리, `eval`의 재귀, `parseSequence`, `commandName`)
- `scripts/hooks/rules.ts`(`evaluateBash`. 읽기만 한다)
- `scripts/test/command-position.test.ts`(금지 호출 목록, 틀로 감싸 판정하는 방식, 실제 셸 대조와 시간 테스트의 방식), `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`
- `docs/harness/design.md` 13.1절, `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행

## 작업

테스트를 먼저 쓰고 실패를 확인해 진행 로그에 적는다(R5). 금지 호출의 글이 든 테스트는 판정만 한다(`evaluate`). 실제로 돌리는 것은 가짜 명령 `tool`뿐이다.

### 1. 옵션 표와 읽는 함수 `scripts/hooks/wrappers.ts`(새 파일)

래퍼 하나의 표:

- `flags`: 값을 받지 않는 짧은 옵션의 글자들.
- `values`: 값을 받는 짧은 옵션의 글자들(`-u 값`, `-u값`).
- `longFlags`: 값을 받지 않는 긴 옵션의 이름들(`--이름`. `--이름=값`만 되는 옵션도 여기에 둔다).
- `longValues`: 값을 받는 긴 옵션의 이름들(`--이름 값`, `--이름=값`).
- `words`·`wordValues`: 글자 그대로 견주는 옵션 낱말(`arch`의 `-arm64`)과 그 가운데 값을 받는 것(`-arch 값`).
- `positionals`: 옵션 뒤, 명령 앞에 오는 자리 인자의 수(`timeout`의 시간은 1).
- `numeric`: `-<숫자>` 꼴의 옵션을 받는다(`nice -10`).

표의 내용(이름은 `commandName`으로 견준다. 경로·대소문자·`.exe`를 무시한다):

| 래퍼                  | `flags`             | `values`         | `longFlags`                                                                                                                                                                                                                     | `longValues`                                                                                                        | 그 밖                                                                                                               |
| --------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `sudo`                | `ABbEeHiKklNnPSsVv` | `CDghpRrTtUu`    | `askpass`, `background`, `bell`, `preserve-env`, `edit`, `set-home`, `help`, `login`, `remove-timestamp`, `reset-timestamp`, `list`, `no-update`, `non-interactive`, `preserve-groups`, `stdin`, `shell`, `version`, `validate` | `close-from`, `chdir`, `group`, `host`, `prompt`, `chroot`, `role`, `type`, `command-timeout`, `other-user`, `user` |                                                                                                                     |
| `doas`                | `Lns`               | `Cu`             |                                                                                                                                                                                                                                 |                                                                                                                     |                                                                                                                     |
| `nice`, `gnice`       |                     | `n`              | `help`, `version`                                                                                                                                                                                                               | `adjustment`                                                                                                        | `numeric`                                                                                                           |
| `ionice`              | `t`                 | `cnpPu`          | `ignore`, `help`, `version`                                                                                                                                                                                                     | `class`, `classdata`, `pid`, `pgid`, `uid`                                                                          |                                                                                                                     |
| `exec`                | `cl`                | `a`              |                                                                                                                                                                                                                                 |                                                                                                                     |                                                                                                                     |
| `command`             | `pvV`               |                  |                                                                                                                                                                                                                                 |                                                                                                                     |                                                                                                                     |
| `builtin`, `nohup`    |                     |                  | `help`, `version`                                                                                                                                                                                                               |                                                                                                                     |                                                                                                                     |
| `time`                | `apv`               | `fo`             | `append`, `verbose`, `portability`, `help`, `version`                                                                                                                                                                           | `format`, `output`                                                                                                  |                                                                                                                     |
| `timeout`, `gtimeout` | `v`                 | `sk`             | `preserve-status`, `foreground`, `verbose`, `help`, `version`                                                                                                                                                                   | `signal`, `kill-after`                                                                                              | `positionals` 1                                                                                                     |
| `xargs`, `gxargs`     | `0oprtx`            | `adEeIiJLlnPRSs` | `null`, `no-run-if-empty`, `verbose`, `interactive`, `exit`, `open-tty`, `show-limits`, `eof`, `replace`, `max-lines`, `help`, `version`                                                                                        | `arg-file`, `delimiter`, `max-args`, `max-procs`, `max-chars`, `process-slot-var`                                   |                                                                                                                     |
| `stdbuf`, `gstdbuf`   |                     | `ioe`            | `help`, `version`                                                                                                                                                                                                               | `input`, `output`, `error`                                                                                          |                                                                                                                     |
| `setsid`              | `cfw`               |                  | `ctty`, `fork`, `wait`, `help`, `version`                                                                                                                                                                                       |                                                                                                                     |                                                                                                                     |
| `caffeinate`          | `dimsu`             | `tw`             |                                                                                                                                                                                                                                 |                                                                                                                     |                                                                                                                     |
| `arch`                |                     |                  |                                                                                                                                                                                                                                 |                                                                                                                     | `words`: `-32`, `-64`, `-arm64`, `-arm64e`, `-x86_64`, `-x86_64h`, `-i386`, `-c`. `wordValues`: `-arch`, `-e`, `-d` |
| `chrt`                | `abdfimoRrv`        | `DPpT`           | `all-tasks`, `batch`, `deadline`, `fifo`, `idle`, `max`, `other`, `rr`, `reset-on-fork`, `verbose`, `help`, `version`                                                                                                           | `sched-runtime`, `sched-period`, `sched-deadline`, `pid`                                                            | `positionals` 1                                                                                                     |
| `taskset`             | `acp`               |                  | `all-tasks`, `cpu-list`, `pid`, `help`, `version`                                                                                                                                                                               |                                                                                                                     | `positionals` 1                                                                                                     |
| `unbuffer`            | `p`                 |                  |                                                                                                                                                                                                                                 |                                                                                                                     |                                                                                                                     |

- `xargs`의 `values`에서 `e`·`i`·`l`은 GNU에서 값을 붙여 써야만 받는 옵션이다(`-i{}`). 띄어 쓴 다음 낱말을 값으로 볼지 알 수 없으므로 이 글자가 낱말의 끝에 오면 **표에 없는 옵션처럼** 다룬다(아래 "모르는 옵션").
- `env`(와 `genv`)는 지금처럼 `normalize` 안에서 따로 읽는다(할당과 `-u`를 모아야 한다). 3에서 고친다.

읽는 함수 `skipWrapperOptions(name, words, i)`: `words[i]`부터 옵션과 자리 인자를 건너뛰어 `{ next, unsure }`를 낸다. `next`는 명령(또는 다음 래퍼·할당)이 시작하는 자리, `unsure`는 표에 없는 옵션을 만났는가다. 순수 함수다.

- `--`: 건너뛰고 옵션 읽기를 끝낸다.
- `words`·`wordValues`에 있는 낱말: 하나(값을 받으면 둘)를 건너뛴다.
- `--이름=값`: 하나를 건너뛴다(이름을 몰라도 값이 붙어 있으므로 한 낱말이다).
- `--이름`: `longValues`에 있으면 둘, `longFlags`에 있으면 하나를 건너뛴다. 없으면 하나를 건너뛰고 `unsure`다.
- `-<숫자>`(`numeric`인 래퍼): 하나를 건너뛴다.
- `-글자들`: 글자를 앞에서부터 본다. `values`의 글자를 만나면 거기서 끝난다: 그 글자가 낱말의 끝이면 다음 낱말이 값이고(둘을 건너뛴다), 아니면 나머지 글자가 값이다(하나를 건너뛴다). `flags`의 글자는 지나간다. 둘 다 아닌 글자를 만나면 하나를 건너뛰고 `unsure`다. 끝까지 `flags`뿐이면 하나를 건너뛴다.
- `-` 하나뿐인 낱말, `-`로 시작하지 않는 낱말: 옵션 읽기를 끝낸다.
- 옵션 읽기가 끝나면 `positionals`만큼 낱말을 건너뛴다(낱말이 모자라면 끝까지).
- 값이 있어야 하는데 낱말이 없으면(`nice -n`) 끝까지 건너뛴 것으로 본다(명령이 없다).

`env -S`의 문자열을 나누는 함수 `splitEnvString(text)`도 이 파일에 둔다(3에서 쓴다. 순수 함수다). `env`가 문자열을 인자로 나누는 규칙이다.

- 따옴표 밖의 공백 글자(스페이스, 탭, 줄바꿈, 캐리지 리턴, 세로 탭, 폼 피드)에서 나눈다. GNU의 문서는 여섯을 모두 구분자로 적고 FreeBSD의 문서는 스페이스와 탭만 적는다. 더 나누는 쪽으로 읽는다(나뉜 낱말이 명령 이름이 되므로 막는 쪽이다).
- 작은따옴표·큰따옴표로 묶은 부분은 한 낱말에 든다(따옴표는 뗀다. 빈 따옴표 `''`는 빈 낱말이다).
- 백슬래시(따옴표 밖과 큰따옴표 안):
  - `\f`·`\n`·`\r`·`\t`·`\v`는 그 제어 문자(폼 피드, 줄바꿈, 캐리지 리턴, 탭, 세로 탭)가 되어 낱말 안에 든다. 낱말을 나누지 않는다(`"a\tb"`와 `a\tb`는 가운데에 탭이 든 낱말 하나다).
  - `\#`·`\$`·`\"`·`\'`·`\\`는 그 글자다(`\#x`는 주석이 아니라 낱말 `#x`다).
  - `\_`는 따옴표 밖에서 낱말을 나누고 큰따옴표 안에서는 공백 글자다.
  - `\c`는 따옴표 밖에서 문자열 읽기를 끝낸다(그때까지 읽은 낱말은 남는다). 큰따옴표 안의 `\c`는 두 구현 모두 오류로 끝나고 아무것도 실행하지 않는다. 훅은 따옴표 밖과 같게 읽기를 끝낸다.
  - 그 밖의 글자가 뒤따르면(`\q`) `env`는 오류로 끝나고 아무것도 실행하지 않는다. 훅은 백슬래시를 떼고 그 글자를 둔다(막는 쪽으로 읽는다).
- 작은따옴표 안의 백슬래시: `\'`는 작은따옴표, `\\`는 백슬래시다. 그 밖의 백슬래시는 글자 그대로 남는다(`'a\tb'`는 글자 넷 `a\tb`다).
- 위 규칙은 GNU coreutils의 `env`와 FreeBSD·macOS의 `env`의 문서가 같게 적은 것이다(이스케이프의 표, 작은따옴표 안에서는 `\'`와 `\\`만 읽는다는 것, `\_`의 두 뜻, 낱말 첫 글자의 `#`, `${이름}`만 값으로 바꾼다는 것. 2026-11-22에 두 문서를 읽었다. 계획의 진행 로그). 문서가 다르거나 한쪽에만 적힌 곳은 위에 따로 적었다(구분자, 오류로 끝나는 꼴). macOS에서는 이 Mac의 `env`로 동작을 확인했다. 실제 실행 대조 테스트(4)가 그 머신의 `env`와 견준다: macOS는 로컬, Linux는 CI의 `check`다. CI 러너의 `env`는 GNU가 아니라 uutils coreutils다(0.10.0. 2026-11-22에 CI의 실패 메시지로 확인했다). uutils는 같은 플래그를 두 번 쓰면(`-i … -i`) 오류로 끝나고 아무것도 실행하지 않는다(GNU와 macOS는 받는다). 훅은 받는 쪽으로 읽는다(실행되지 않는 호출을 실행되는 것으로 읽으므로 막는 쪽이다). GNU coreutils의 `env`로는 돌려 보지 못했다: 문서와 9.4의 소스(`env.c`)를 읽어 확인했다. 대조하는 사례에는 세 구현이 같게 읽는 꼴만 넣는다(따옴표 밖의 줄바꿈 구분자, 오류로 끝나는 꼴, 같은 플래그를 되풀이한 꼴은 넣지 않는다).
- 낱말의 첫 글자가 따옴표 밖의 `#`이면 문자열의 끝까지 주석이다(낱말 가운데의 `#`은 글자다).
- 닫히지 않은 따옴표는 문자열의 끝까지를 한 낱말로 본다(`env`는 오류로 끝나지만 막는 쪽으로 읽는다).
- `${이름}`은 풀지 않고 글자 그대로 둔다. `env`는 환경 변수의 값으로 바꾸지만 훅은 그 값을 모른다(셸이 실행할 때 만드는 인자와 같은 한계다. TD-62 (4)).

### 2. 분석기 `scripts/hooks/shell.ts`

- `normalize`의 래퍼를 벗기는 자리: `WRAPPERS`·`timeout`·`xargs`의 세 갈래를 하나로 합쳐, 이름이 표에 있으면 `skipWrapperOptions`로 건너뛴다. `WRAPPERS` 집합은 표의 이름으로 대신한다(표에 지금의 래퍼가 모두 있다).
- **모르는 옵션(`unsure`)일 때의 후보**: 주 해석은 `next`에서 시작하는 명령이다(전과 같은 방식으로 낸다). 여기에 더해, `next` 뒤의 낱말 가운데 `-`로 시작하지 않는 낱말마다 그 낱말에서 시작하는 명령을 후보로 낸다. 후보는 한 조각에서 많아야 8개다(앞에서부터). 후보는 그 낱말부터 끝까지를 `normalize`에 다시 넣어 만든다(후보 안의 래퍼·할당·리다이렉션도 같은 방식으로 읽힌다). 후보에서 다시 후보를 내지 않는다.
- 주 해석을 먼저 `out`에 넣고 후보를 그 뒤에 넣는다. `parseSequence`(검사 순서용 분석)는 그 자리의 주 해석을 지금처럼 `cmd`로 내고, 후보가 있으면 `alts`(새 선택 칸. 명령의 배열)로 함께 낸다. 후보가 없으면 `alts`를 두지 않는다.
- 계수기 `parseWork`(내보내는 객체 `{ words: number }`): `normalize`가 낱말 목록을 받을 때마다 그 길이를 `words`에 더한다(후보를 만들 때와 `-S`로 다시 읽을 때도 `normalize`를 거치므로 센다). 판정에는 쓰지 않는다. 읽은 양이 입력 길이에 비례하는지를 테스트가 이 값으로 본다(4).
- 리다이렉션이 섞인 조각(`nice >/dev/null -n 5 git …`)에서도 같다: 옵션 읽기는 리다이렉션을 뺀 낱말로 한다(지금의 구조 그대로).

### 3. `env`

`normalize`의 `env` 처리에 더한다(이름이 `env`나 `genv`일 때).

- 값을 받는 옵션: `-C 폴더`·`--chdir 폴더`·`--chdir=폴더`, `-P 경로`, `-a 이름`·`--argv0 이름`·`--argv0=이름`. 값까지 건너뛴다. 짧은 옵션은 묶어 쓴 꼴도 읽는다(`-iC 폴더`: `i`는 값을 받지 않고 `C`가 끝에 있어 다음 낱말이 값이다).
- 값을 받지 않는 옵션: `-i`, `-0`, `-v`, `--ignore-environment`, `--null`, `--debug`, `--list-signal-handling`, `--block-signal`·`--default-signal`·`--ignore-signal`(값은 `=`로만 붙는다), `--help`, `--version`. `-`(혼자 쓴 것. `-i`와 같다).
- `-S 문자열`·`--split-string 문자열`·`--split-string=문자열`·`-S문자열`(묶은 꼴 `-iS 문자열` 포함): 문자열을 `splitEnvString`으로 낱말로 나눠 **그 옵션의 자리에 넣고**, 거기서부터 `env`의 옵션·할당 읽기를 이어 간다(문자열 안에 `env`의 옵션과 할당이 올 수 있다: `env -S "-i A=1 명령"`). 이렇게 읽은 명령이 이 조각의 **주 해석**이다. 따로 더하는 명령이 아니므로 검사 순서용 분석(`parseSequence`)도 이 명령을 그 자리의 명령으로 본다.
  - 문자열 뒤의 낱말은 **경계를 그대로 둔 채** 뒤에 붙는다: `env -S 'tool' 'a b'`가 `tool`에 넘기는 인자는 `a b` 하나이고, `env -S "tool a" '' b`의 인자는 `a`, 빈 낱말, `b` 셋이다. 공백으로 이어 붙여 다시 읽지 않는다.
  - 셸의 연산자는 문자열 안에서 연산자가 아니다: `env -S "git status; echo x"`는 `git`에 `status;`, `echo`, `x`를 넘기는 명령 하나다(`env`가 그렇게 실행한다). 셸 명령 줄로 다시 읽지 않는다(`parseInto`를 쓰지 않는다).
  - 문자열에서 나온 낱말에 다시 `-S`가 있으면 같은 방식으로 나눈다. 한 조각에서 네 번까지다. 다섯 번째 `-S`를 만나면 더 읽지 않고, 그 조각이 낸 명령에 **끝까지 읽지 못했다**는 표시를 단다(`SimpleCommand`의 새 선택 칸 `incomplete: true`. 그 조각이 낸 명령이 없으면 빈 명령에 달아 낸다). 그 호출은 규칙이 막는다(3-1). 후보로 넘기지 않는다: 다섯 번째 문자열 안에 명령과 인자가 함께 있으면(`-S "tool a"`) 낱말 경계에서 시작하는 후보로는 그 명령을 찾지 못한다(계획 검증 2회차의 F6). 한도를 두는 이유: `-S-S-S…x`처럼 겹치면 나눌 때마다 남은 글을 다시 읽어 비용이 제곱으로 는다.
  - 리다이렉션이 붙은 낱말(`env -S "…">out`)에서는 리다이렉션을 그대로 두고 낱말의 글만 나눈다.
- `-u`·`--unset`과 할당은 지금 그대로다.
- 위에 없는 `-`로 시작하는 낱말: 지금처럼 하나를 건너뛰고, 2의 "모르는 옵션"과 같이 후보를 낸다.

### 3-1. 규칙 `scripts/hooks/rules.ts`: 검사 순서 규칙과 읽지 못한 명령

`sequenceRules`가 순서의 한 자리를 볼 때 주 해석(`cmd`)과 후보(`alts`)를 함께 본다.

- 주 해석이나 후보 가운데 하나라도 검사 명령이면 그 자리는 검사 명령이다(출력 가림과 "검사가 앞에 있었다"의 판정에 쓴다).
- 주 해석이나 후보 가운데 하나라도 뒤 명령(push·완료 처리·승인 요청·PR 생성)이면 그 자리는 뒤 명령이다(메시지에는 처음 찾은 것의 이름을 쓴다).
- `set -e`·`pipefail`은 주 해석에서만 읽는다(지금 그대로다).
- 후보가 없는 자리의 판정은 지금과 같다. 이 함수의 판정 조건·메시지는 바꾸지 않는다.

끝까지 읽지 못한 명령: `evaluateBash`가 분석기가 낸 명령 가운데 `incomplete`가 달린 것이 있으면 그 호출을 막는다(방언마다 같다).

- 규칙 이름은 `R4 훅 우회`, 내용은 "`env -S`가 다섯 번 넘게 겹쳐 실행될 명령을 끝까지 읽지 못했다", 고치는 법은 "`env -S`를 겹치지 말고 실행할 명령을 그대로 쓴다"다.
- 문자열 안에 무엇이 있든 막는다(허용된 명령이어도). 읽지 못한 명령을 통과시키지 않는 것이 목적이다.
- `rules.ts`에서 고치는 것은 이 둘(검사 순서 규칙이 후보를 함께 본다, 읽지 못한 명령을 막는다)뿐이다. 금지 목록·예외 목록과 다른 규칙의 메시지는 바꾸지 않는다.

### 4. 테스트 `scripts/test/wrapper-options.test.ts`(새 파일)

판정은 `evaluate({ kind: 'bash', command, cwd }, ctx)`로 한다(`command-position.test.ts`와 같은 `ctx`: 리포 없음, `dbClients: ['psql']`).

- **금지 호출**(`command-position.test.ts`와 같은 열둘): `git push --force origin main`(R14), `git push origin main`(R2), `git reset --hard`(R14), `git clean -fd`(R14), `gh pr review 7 --approve`(R20), `gh secret set X`(R20), `gh auth switch`(R20), `git commit --no-verify -m x`(R4), `rm -rf /`(R14), `psql -c x`(R13), `security find-generic-password -s x`(R20), `npm publish`(R14). 그대로 쓴 판정이 이 규칙인지 먼저 본다.
- **닫는 꼴**(금지 호출마다 모두 기준과 같은 규칙으로 막혀야 한다. `C`는 금지 호출, `이름`은 그 첫 낱말, `나머지`는 그 뒤):
  - `nice`: `nice -n 5 C`, `nice --adjustment 5 C`, `nice -n 5 -- C`, `gnice -n 5 C`.
  - `sudo`·`doas`: `sudo -u someone C`, `sudo -g staff C`, `sudo -u someone -- C`, `sudo --user someone C`, `sudo -iu someone C`, `sudo -E -u someone A=1 C`, `sudo -u someone -g staff C`, `sudo -D /tmp C`, `sudo -h host C`, `sudo -p prompt C`, `sudo --chdir /tmp C`, `doas -u someone C`.
  - `ionice`·`exec`·`time`: `ionice -c 2 C`, `ionice -c 2 -n 7 C`, `ionice --class 2 C`, `exec -a name C`, `exec -cla name C`, `time -f %e C`, `time -o out.txt C`.
  - `timeout`: `timeout -s KILL 5 C`, `timeout -k 1 5 C`, `timeout --signal KILL 5 C`, `timeout --kill-after 1 5 C`, `timeout -s KILL -k 1 5 C`, `gtimeout 5 C`, `gtimeout -s KILL 5 C`.
  - `env`: `env -C /tmp C`, `env --chdir /tmp C`, `env -P /usr/bin C`, `env -a name C`, `env --argv0 name C`, `env -i -C /tmp A=1 C`, `env -iC /tmp C`, `env -S "C"`, `env --split-string="C"`, `env --split-string "C"`, `env -S "이름" 나머지`, `env -i -S "C"`, `genv -u HOME C`.
  - `xargs`: `xargs --max-args 1 C`, `xargs --max-procs 2 C`, `xargs -a list.txt C`, `xargs --arg-file list.txt C`, `xargs -J % C`, `xargs -R 2 C`, `gxargs -n 1 C`.
  - 새 래퍼: `stdbuf -o L C`, `stdbuf -oL C`, `stdbuf --output=L C`, `stdbuf --output L C`, `gstdbuf -o L C`, `setsid C`, `setsid -w C`, `caffeinate C`, `caffeinate -i C`, `caffeinate -t 60 C`, `caffeinate -dims -w 1 C`, `arch -arm64 C`, `arch -arch arm64 C`, `arch -e A=1 C`, `chrt -f 10 C`, `chrt 10 C`, `taskset -c 0 C`, `taskset 0x1 C`, `unbuffer C`, `unbuffer -p C`.
  - 겹친 래퍼: `sudo -u someone nice -n 5 C`, `nice -n 5 sudo -u someone C`, `timeout -s KILL 5 env -C /tmp C`, `nohup nice -n 5 C`.
  - 다른 틀과 섞인 꼴: `if true; then nice -n 5 C; fi`, `>/dev/null nice -n 5 C`, `nice >/dev/null -n 5 C`, `nice -n >/dev/null 5 C`, `nice -n 5 >/dev/null C`, `A=1 nice -n 5 C`, `bash -c "nice -n 5 C"`, `true && sudo -u someone C`, `NICE -n 5 C`(이름의 대소문자), `/usr/bin/nice -n 5 C`(경로).
  - 모르는 옵션(후보로 막힌다): `nice --unknown 5 C`, `sudo --unknown someone C`, `sudo -Z someone C`, `timeout --unknown x 5 C`, `stdbuf -Z x C`, `env --unknown x C`, `xargs -i {} C`(값을 붙여 써야 하는 옵션을 띄어 쓴 꼴), `nice --unknown a b c d C`(후보 넷째 자리).
- **유지하는 꼴**(지금도 막힌다. 그대로여야 한다): `nice C`, `sudo C`, `sudo -n C`, `nohup C`, `time -p C`, `command -p C`, `exec -c C`, `nice -n5 C`, `nice --adjustment=5 C`, `nice -10 C`, `ionice -c2 C`, `timeout 5 C`, `timeout --signal=KILL 5 C`, `timeout --preserve-status 5 C`, `env -u HOME C`, `env -i C`, `env --chdir=/tmp C`, `env A=1 C`, `xargs -n 1 C`, `xargs -I {} C`, `xargs --max-procs=2 C`, `xargs -0 -n 1 C`, `sudo --user=someone C`, `sudo -usomeone C`, `command -- C`, `exec -- C`, `nohup -- C`, `builtin command C`.
- **허용**(막히지 않아야 한다): `nice -n 5 node scripts/harness.ts test`, `timeout -s KILL 5 git status`, `timeout -k 1 5 node --test x.test.ts`, `sudo -u someone ls`, `nice -n 5 echo git reset --hard`, `sudo -u someone echo "git reset --hard"`, `timeout 5 grep -r "git push --force" .`, `xargs -n 1 echo`, `nice -n 5 git log --oneline`, `env -C /tmp git status`, `env -S "node -v"`, `stdbuf -o L cat file.txt`, `caffeinate -i node scripts/harness.ts test`, `arch -arm64 node -v`, `chrt -f 10 node -v`, `taskset -c 0 node -v`, `nice --unknown 5 node -v`(모르는 옵션이 있어도 뒤에 금지 호출이 없으면 통과한다), `sudo --unknown someone git status`.
- **막는 쪽으로 기우는 대가를 고정한다**(막힌다. 의사결정 로그의 대가): `nice --unknown 5 echo git reset --hard`는 R14로 막힌다. 같은 호출에서 모르는 옵션을 빼면(`nice -n 5 echo git reset --hard`) 통과한다.
- **분석기의 낱말**(`parseShell`. 명령의 `args ?? argv`를 본다):
  - `nice -n 5 git status`, `sudo -u someone -g staff git status`, `timeout -s KILL -k 1 5 git status`, `xargs --max-args 1 git status`, `stdbuf -o L git status`, `arch -arch arm64 git status`, `chrt -f 10 git status`: 각각 명령 하나, `['git', 'status']`.
  - `env -C /tmp A=1 git status`: `['git', 'status']`이고 `assigns`에 `A: '1'`.
  - `sudo -u someone A=1 git status`: `['git', 'status']`이고 `assigns`에 `A: '1'`.
  - `nice --unknown 5 git status`: 첫 명령(주 해석)은 `['5', 'git', 'status']`, 그 뒤의 후보는 `['git', 'status']`, `['status']`다.
  - `nice --unknown a b c d e f g h i j`: 후보는 8개다(`b`부터 `i`까지에서 시작하는 것).
  - `env -S`(모두 명령 하나다. 후보가 없다): `env -S "git status" --short`는 `['git', 'status', '--short']`. `env -S 'tool' 'a b'`는 `['tool', 'a b']`(뒤 인자의 경계). `env -S "tool a" '' b`는 `['tool', 'a', '', 'b']`(빈 인자). `env -S 'tool "a b"' c`는 `['tool', 'a b', 'c']`(문자열 안의 따옴표). `env -S "git status; echo x"`는 `['git', 'status;', 'echo', 'x']`(연산자가 아니다). `env -S "git status # x" y`는 `['git', 'status', 'y']`(주석). `env -S 'git\_status'`는 `['git', 'status']`. `env -S "-i A=1 git status"`와 `env -iS "A=1 git status"`는 `['git', 'status']`이고 `assigns`에 `A: '1'`. `env -S "-S 'git status'"`, `env -S"git status"`, `env --split-string="git status"`, `env --split-string "git status"`는 `['git', 'status']`. 이스케이프: `env -S 'tool "a\tb"'`와 `env -S 'tool a\tb'`는 `['tool', 'a<탭>b']`(탭이 든 인자 하나), `env -S "tool 'a\tb'"`는 `['tool', 'a\tb']`(작은따옴표 안: 백슬래시가 남는다), `env -S 'tool \#a "b\"c" \$d'`는 `['tool', '#a', 'b"c', '$d']`, `env -S 'tool a\cb c'`는 `['tool', 'a']`.
  - `-S` 네 번까지는 읽는다: `env -S -i -S -i -S -i -S "git status"`와 `env -S-S-S-S"git status"`는 명령 하나 `['git', 'status']`이고 `incomplete`가 없으며 통과한다. 네 번째 문자열 안의 금지 호출은 그 호출의 규칙으로 막힌다(`env -S -i -S -i -S -i -S "C"`. 금지 호출 열둘).
  - 다섯 번째에서는 읽지 못한 명령으로 막는다: `env -S -i -S -i -S -i -S -i -S "git status"`, `env -S-S-S-S-S"git status"`, `env -S -i -S -i -S -i -S -i -S "tool a"`는 낸 명령에 `incomplete`가 있고 R4로 막힌다(문자열 안의 명령이 허용된 것이어도). 금지 호출 열둘을 다섯 번째 문자열에 넣은 꼴(`env -S -i -S -i -S -i -S -i -S "C"`)도 모두 막힌다.
  - `incomplete`는 그 밖의 명령에는 없다(닫는 꼴·유지하는 꼴·허용의 어느 호출에도 없다).
  - 래퍼뿐인 조각(`nice -n 5`, `sudo -u someone`, `timeout -s KILL 5`, `nice -n`)은 전처럼 명령을 내지 않는다.
- **`skipWrapperOptions`**(표를 읽는 함수만 따로): 위 "읽는 함수"의 항목마다 한 사례씩(`--`, 값이 붙은 긴 옵션, 값을 띄어 쓴 긴 옵션, 모르는 긴 옵션, 숫자 옵션, 묶은 짧은 옵션의 가운데·끝의 값 글자, 모르는 글자, `-` 하나, 자리 인자, 값이 없는 끝). 표에 든 래퍼 이름마다 `flags`와 `values`에 같은 글자가 없고 `longFlags`와 `longValues`에 같은 이름이 없다.
- **`splitEnvString`**: 규칙마다 한 사례씩. 공백·탭·줄바꿈에서 나눔, 작은따옴표, 큰따옴표, 빈 따옴표, 붙여 쓴 따옴표(`a"b c"d`는 `ab cd`), 제어 문자 이스케이프 다섯(`\f`·`\n`·`\r`·`\t`·`\v`. 따옴표 밖과 큰따옴표 안에서 각각), 글자 이스케이프 다섯(`\#`·`\$`·`\"`·`\'`·`\\`), 따옴표 밖과 큰따옴표 안의 `\_`, `\c`(그때까지의 낱말이 남는다), 정해지지 않은 이스케이프(`\q`는 `q`), 작은따옴표 안의 `\'`·`\\`와 그 밖의 백슬래시(남는다), 낱말 첫 글자의 `#`, 낱말 가운데의 `#`, 닫히지 않은 따옴표, `${이름}`, 빈 문자열, 문자열 끝의 백슬래시 하나(글자로 남는다).
- **검사 순서 규칙**(R4): 다음 쌍의 판정이 서로 같다(앞의 것은 옵션 없는 래퍼, 뒤의 것은 값을 받는 옵션이 있는 래퍼).
  - `node scripts/harness.ts check; nice git push origin x`와 `node scripts/harness.ts check; nice -n 5 git push origin x`, `…; sudo -u someone git push origin x`, `…; timeout -s KILL 5 git push origin x`: 모두 R4.
  - `node scripts/harness.ts check && nice git push origin x`와 `node scripts/harness.ts check && nice -n 5 git push origin x`: 판정이 같다.
  - `nice node scripts/harness.ts check; git push origin x`와 `nice -n 5 node scripts/harness.ts check; git push origin x`: 판정이 같다.
  - 모르는 옵션(후보도 순서의 그 자리에서 본다): `node scripts/harness.ts check && nice --unknown 5 git push origin x`는 `node scripts/harness.ts check && nice git push origin x`와 판정이 같다. `node scripts/harness.ts check; nice --unknown 5 git push origin x`는 R4다(`…; nice git push origin x`와 같다). `nice --unknown 5 node scripts/harness.ts check; git push origin x`도 R4다. `nice --unknown 5 node scripts/harness.ts check | tail`은 R4(출력 가림)다.
  - `env -S`(문자열 안의 명령이 그 자리의 명령이다): `node scripts/harness.ts check; env -S "git push origin x"`는 R4이고, `node scripts/harness.ts check && env -S "git push origin x"`는 `node scripts/harness.ts check && git push origin x`와 판정이 같다. `env -S "node scripts/harness.ts check"; git push origin x`는 R4이고, `env -S "node scripts/harness.ts check" && git push origin x`는 `node scripts/harness.ts check && git push origin x`와 판정이 같다. 둘을 각각 감싼 `env -S "node scripts/harness.ts check"; env -S "git push origin x"`는 R4, `&&`로 이으면 감싸지 않은 것과 판정이 같다.
- **실제 실행 대조**: 임시 폴더에 실행 파일 `tool`을 만든다. 받은 인자의 수와 인자를 NUL로 구분해 결과 파일에 적는 `sh` 스크립트다(공백·탭·줄바꿈이 든 인자와 빈 인자를 구별한다). 결과 파일의 절대 경로는 스크립트 안에 적어 둔다. 명령에는 `tool`을 그 절대 경로로 적어 `bash -c`로 돌린다(아래 사례의 `tool`은 모두 그 절대 경로다). `PATH`와 환경 변수에 기대지 않으므로 `env -i`가 환경을 비운 사례에서도 `tool`이 실행되고 결과를 적는다(계획 검증 3회차의 F7). 임시 폴더의 경로에 셸이나 `env -S`가 달리 읽는 글자(공백, 따옴표, 백슬래시, `$`, `#`, `;`)가 없는지 먼저 단언한다. 사례마다 돌리기 전에 결과 파일을 빈 파일로 만들고, 돌린 뒤에 비어 있으면 `tool`이 실행되지 않은 것이다.
  - 돌리는 것은 그 래퍼가 이 머신에 있고(`command -v`) 권한이나 시스템 상태를 건드리지 않는 래퍼의 틀뿐이다: `nice`, `env`, `nohup`, `command`, `exec`, `time`, `timeout`·`gtimeout`, `stdbuf`·`gstdbuf`, `caffeinate`, `arch`, `gnice`, `genv`, `unbuffer`, `xargs`·`gxargs`(입력은 빈 줄 하나). `sudo`, `doas`, `ionice`, `chrt`, `taskset`, `setsid`의 틀과 모르는 옵션의 틀은 돌리지 않는다. 래퍼가 없으면 그 틀을 건너뛴다(`t.diagnostic`으로 대조한 틀과 건너뛴 틀의 수를 낸다). Windows에서는 이 테스트를 건너뛴다. 실제로 대조한 틀이 하나 이상이어야 한다(POSIX 환경에서).
  - 준비를 먼저 확인한다: `tool`을 래퍼 없이 직접 돌려(`tool direct`) 결과 파일에 인자 `direct`가 적혔는지 단언한다. 실행 권한·경로·결과 파일 가운데 하나라도 잘못이면 여기서 테스트가 실패한다(준비의 실패를 "지원하지 않는다"로 읽지 않는다. 계획 검증 4회차의 F8).
  - `-S`를 아는지 확인한다: `env -S 'tool probe'`를 한 번 돌린다(문구가 로캘에 따라 바뀌지 않게 `LC_ALL=C`로 돌린다). 판정은 셋이다.
    - `tool`이 인자 `probe`로 실행됐다: 그 머신의 `env`는 `-S`를 안다.
    - `tool`이 실행되지 않았고, `env`가 0이 아닌 코드로 끝났고, 표준 오류에 옵션을 모른다는 문구(`invalid option`, `illegal option`, `unrecognized option` 가운데 하나. 대소문자를 가리지 않는다)가 있다: `-S`를 모르는 `env`다. `-S`가 든 틀과 아래의 `-S` 사례를 건너뛰고 그 사실을 `t.diagnostic`으로 낸다.
    - 그 밖(실행되지 않았는데 옵션 오류가 아니다, 받은 인자가 `probe`가 아니다): 테스트가 실패한다.
  - `-S`를 아는 머신에서는 `-S` 사례를 건너뛰지 않는다: `tool`이 실행되지 않으면 실패다. macOS의 `env`, GNU coreutils 8.30 이상, uutils coreutils(CI의 Linux)는 `-S`를 알고 옵션 오류를 내지 않으므로, 그 머신에서는 확인이나 사례의 실행이 실패하면 건너뛰지 않고 테스트가 실패한다.
  - 닫는 꼴·유지하는 꼴의 틀에 `C`로 `tool a b`를 넣어 돌린다. `tool`이 인자 `a b`로(`xargs`는 `a b`로 시작하는 인자로) 실행된 틀에서는 분석기(`parseShell`)가 낸 명령 가운데 `[tool, 'a', 'b']`가 있는지 본다. 이 틀들에는 모르는 옵션이 없어 후보가 없으므로, 낸 명령은 모두 어느 조각의 주 해석이다. 실행되지 않은 틀(래퍼가 그 옵션을 모른다 등)은 비교하지 않는다.
  - 인자의 경계: `env -S 'tool' 'a b'`, `env -S "tool a" '' b`, `env -S 'tool "a b"' c`, `env -S 'tool a; b'`, `env -S 'tool a # b' c`, `env -S '-i tool a'`, `nice -n 5 tool 'a b' ''`, 이스케이프가 든 `env -S 'tool "a\tb"'`, `env -S 'tool a\tb'`, `env -S "tool 'a\tb'"`, `env -S 'tool "a\nb" c\_d "e\_f"'`, `env -S 'tool \#a "b\"c" \$d'`, `env -S 'tool a\cb c'`, 네 번 나누는 `env -S -uA -S -uB -S -uC -S 'tool a'`(같은 플래그를 되풀이하지 않는다. `-S`의 문자열은 차례로 `-uA`, `-uB`, `-uC`, `tool a`다)를 돌려, `tool`이 실제로 받은 인자 배열과 `parseShell`의 첫 명령(`args ?? argv`)이 통째로 같은지 본다. `-S`를 아는 머신에서는 사례마다 `tool`이 실행돼야 한다(실행되지 않으면 실패다. `-i`가 든 사례도 `tool`의 절대 경로와 스크립트 안의 결과 파일 경로 덕분에 실행된다). `tool`은 인자를 NUL로 구분해 적으므로 탭·줄바꿈이 든 인자도 그대로 견준다. 다섯 번 나누는 `env -S -uA -S -uB -S -uC -S -uD -S 'tool a'`는 `-S`를 아는 머신에서 `tool`이 인자 `a`로 실행됐음을 단언하고(`[tool, 'a']`), 훅이 그 호출을 R4로 막는지 본다(읽지 못한 명령이 통과하지 않는다는 것을 실제 실행과 함께 본다).
- **입력 길이에 비례하는가**: 입력의 꼴 여섯에 대해 본다. (가) `nice` 뒤에 모르는 옵션 n개와 낱말 n개 (나) `sudo -u a`를 n번 겹친 것 (다) `nice --unknown 5`를 n번 겹친 것(모르는 옵션이 붙은 래퍼를 겹친 입력) (라) `env` 뒤에 `-S -i`를 n번 쓴 것 (마) `timeout -s KILL 5`를 n번 겹친 것 (바) `-S`를 n번 붙여 쓴 낱말 하나(`env -S-S-S…x`).
  - 읽은 낱말 수(실행 환경과 무관한 기준): n이 2,000·20,000·80,000일 때, `parseShell` 한 번과 `parseSequence` 한 번이 각각 `parseWork.words`에 더한 값이 입력의 낱말 수의 50배를 넘지 않는다. 배수는 n과 무관한 상수다(주 해석 하나와 후보 8개, 각각 `-S`로 많아야 4번 더 읽는다: 45배 이하). 다시 읽는 횟수가 입력 길이에 따라 늘면(겹친 래퍼마다 후보를 낸다, 후보에서 다시 후보를 낸다) 이 단언이 실패한다.
  - 시간: n이 20,000일 때 판정(`evaluate`)이 5초 안에 끝난다. n을 80,000으로 늘린 판정 시간은 20,000일 때의 8배와 1초 가운데 큰 값을 넘지 않는다(크기마다 세 번 재어 가장 짧은 값으로 견준다. 선형이면 4배, 제곱이면 16배다. 1초 아래에서는 재는 오차가 비율을 흔들므로 견주지 않는다). 별도 프로세스로 돌려 시간 제한을 건다(`command-position.test.ts`의 방식).

### 5. 문서

- `docs/harness/design.md` 13.1절:
  - `  - 명령 이름의 자리: …` 줄에서 `, 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`)`을 지운다(그 줄의 다른 글은 그대로다).
  - 그 줄 바로 아래에 다음 한 줄을 넣는다(글자 그대로).

    ```text
      - 래퍼의 옵션: 다른 명령을 대신 실행하는 명령(`sudo`·`doas`·`nice`·`ionice`·`timeout`·`env`·`xargs`·`exec`·`command`·`builtin`·`nohup`·`time`·`stdbuf`·`setsid`·`caffeinate`·`arch`·`chrt`·`taskset`·`unbuffer`와 `g`가 붙은 이름)은 벗기고 그 뒤의 명령을 본다. 래퍼마다 옵션 표(`scripts/hooks/wrappers.ts`)가 있어 값을 받는 옵션의 값(`nice -n 5`, `sudo -u 사용자`, `timeout -s KILL 5`)과 옵션 뒤의 자리 인자(`timeout`의 시간)를 건너뛴다. 표에 없는 옵션을 만나면 값을 받는지 알 수 없으므로, 뒤의 낱말에서 시작하는 명령도 후보로 보아 규칙을 돌린다(막는 쪽으로 기운다. 후보는 한 명령에 8개까지). `env -S "…"`의 문자열은 `env`의 규칙으로 낱말로 나눠 그 자리의 명령으로 읽는다(뒤 인자의 경계는 그대로다. 한 명령에서 네 번까지 나누고, 그보다 겹치면 끝까지 읽지 못한 명령으로 보아 R4로 막는다). 검사 순서 규칙(R4)은 순서의 한 자리에서 주 해석과 후보를 함께 본다. 이 머신에 있는 래퍼로는 실제 실행과 대조한다(테스트).
    ```

- 설계서 0절 버전 이력에 항목 하나와 문서 머리의 버전(번호는 push할 때 main의 다음 번호), `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(Issue #193, 검사를 약화하지 않는다는 것, 막는 쪽으로 기우는 대가). PR 본문에 `- [x] 보호 경로 변경: …` 줄.
- `docs/harness/architecture.md`의 `hooks/*` 행에 `wrappers.ts`(래퍼의 옵션 표)를 한 구절로 더한다.
- `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행: `(3) …` 부분만 다음 글로 바꾼다(글자 그대로. 표의 칸 맞춤 공백은 포매터가 정한다). 다른 행과 그 행의 다른 항목은 바꾸지 않는다.

  ```text
  (3) 명령 이름을 가리는 꼴 가운데 남은 것: 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`, `watch`, `script -c`, `su -c`), cmd 방언의 `if`·`for … do` 뒤의 명령, 검사 순서 규칙(R4)이 `if`·`for` 안의 명령을 순서에 넣지 않는 것(명령 이름 앞·뒤의 리다이렉션, bash 예약어와 zsh 수식어 뒤의 명령은 #182가, 값을 받는 옵션이 붙은 래퍼 뒤의 명령은 #193이 닫았다).
  ```

## Acceptance Criteria

```bash
node --test scripts/test/wrapper-options.test.ts
node --test scripts/test/shell.test.ts scripts/test/guard.test.ts scripts/test/db-commands.test.ts scripts/test/command-position.test.ts scripts/test/profile-web-db.test.ts
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- scripts/test | tr '\n' ' ')" = "scripts/test/wrapper-options.test.ts "
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- scripts/hooks | tr '\n' ' ')" = "scripts/hooks/rules.ts scripts/hooks/shell.ts scripts/hooks/wrappers.ts "
test "$(grep -c -F '  - 래퍼의 옵션: 다른 명령을 대신 실행하는 명령(`sudo`·`doas`·`nice`·`ionice`·`timeout`·`env`·`xargs`·`exec`·`command`·`builtin`·`nohup`·`time`·`stdbuf`·`setsid`·`caffeinate`·`arch`·`chrt`·`taskset`·`unbuffer`와 `g`가 붙은 이름)은 벗기고 그 뒤의 명령을 본다.' docs/harness/design.md)" = 1
! grep -q -F '값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`)' docs/harness/design.md docs/exec-plans/tech-debt-tracker.md
test "$(git diff --numstat "$(git merge-base HEAD origin/main)" HEAD -- docs/harness/design.md | cut -f1,2 | tr '\t' ' ')" = "4 2"
test "$(git diff --numstat "$(git merge-base HEAD origin/main)" HEAD -- docs/exec-plans/tech-debt-tracker.md | cut -f1,2 | tr '\t' ' ')" = "1 1"
grep -q -F '값을 받는 옵션이 붙은 래퍼 뒤의 명령은 #193이 닫았다' docs/exec-plans/tech-debt-tracker.md
grep -q '#193' docs/harness/CHANGELOG.md
grep -q -F 'wrappers.ts' docs/harness/architecture.md
node scripts/harness.ts self-test
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 셋째·넷째 줄: 이 PR이 `scripts/test/` 아래에서 바꾼 파일은 새 테스트 파일 하나뿐이고(기존 테스트의 단언을 고치지 않았다), `scripts/hooks/` 아래에서는 `rules.ts`(검사 순서 규칙의 함수 `sequenceRules`와 읽지 못한 명령을 막는 차단 하나), `shell.ts`, 새 파일 `wrappers.ts`뿐이다. `rules.ts`에서 그 둘 밖을 고치지 않았는지는 자체 리뷰에서 diff로 본다.
- 다섯째~여덟째 줄: 설계서에 고정한 줄이 한 번 있고, 지운 문구가 설계서와 기술 부채 표에 없다. 설계서에서 바뀐 줄 수가 정해진 것과 같다: 더한 줄 넷(머리의 버전 줄, 버전 이력의 항목, 13.1절에 넣은 줄, 문구를 지운 줄의 새 꼴), 지운 줄 둘(머리의 버전 줄, 문구를 지운 줄의 옛 꼴). 기술 부채 표는 TD-62 행 하나만 바뀐다.
- `origin/main`이 필요하다(`git fetch origin`).

## 금지사항

- 기존 테스트 파일의 단언을 고치거나 지우지 마라. 이유: 지금 막히는 꼴과 분석기의 계약(`argv`, `args`)이 그대로인지를 그 테스트가 본다(R4). 기존 단언과 부딪히면 멈추고 진행 로그에 적는다.
- `scripts/hooks/rules.ts`의 금지 목록·예외 목록·메시지를 바꾸거나, 막히던 호출이 통과하게 만들지 마라. `rules.ts`에서 고치는 것은 둘이다: `sequenceRules`가 순서의 한 자리에서 후보(`alts`)를 함께 보게 하는 것, 끝까지 읽지 못한 명령(`incomplete`)을 막는 차단 하나. 이유: 이 step은 분석기가 명령 이름을 찾는 자리를 바로잡는다. 차단을 풀지 않는다.
- `env -S`의 문자열을 셸 명령 줄로 다시 읽거나, 문자열과 뒤의 낱말을 공백으로 이어 붙이지 마라. 이유: `env`는 문자열만 자기 규칙으로 나누고 뒤 인자의 경계를 지킨다. 이어 붙이면 공백이 든 인자가 갈라져 실제 실행과 달라진다(계획 검증 1회차의 F2).
- 표에 없는 옵션에서 한 해석만 고르지 마라. 이유: 고르지 않은 쪽이 틈이 된다(의사결정 로그).
- 테스트나 명령으로 금지 호출을 실제로 실행하지 마라. 판정(`evaluate`)만 하고, 실제 실행 대조는 가짜 명령 `tool`로만 한다. `sudo`·`doas`처럼 권한을 바꾸는 래퍼는 실제로 돌리지 않는다. 이유: R2·R14·R20.
- 훅을 끄거나 우회해 확인하지 마라(R4). 금지 호출의 글이 든 내용은 파일 도구로 쓴다.
- `harness.config.json`, 권한 프로필, `.github/`를 고치지 마라. 이유: 이 step의 범위가 아니다.
