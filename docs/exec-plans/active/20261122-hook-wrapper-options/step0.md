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
- `assigns`: 옵션 사이에 `이름=값` 낱말을 받는다(`sudo`만 참이다. 아래 표에는 칸을 두지 않았다. 2의 "`sudo`의 할당").

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

uutils의 `env`가 옵션을 읽기 전에 `-S`를 먼저 나누는 훑기를 따라 하는 함수 `uutilsSplits(words)`도 이 파일에 둔다(3의 "uutils의 먼저 훑기"에서 쓴다. 순수 함수다. 규칙은 거기에 적었다). `env` 뒤의 처음 받은 낱말을 받아 uutils가 나누는 낱말의 자리(0부터 센 번호)를 낸다. 낱말 목록의 중간(`from`)에서 시작해 나누는 자리와 훑기가 그친 자리를 함께 내는 `uutilsScan(words, from)`을 두고, `uutilsSplits`는 그것을 쓴다(분석기는 `uutilsScan`을 쓴다. 3의 끝).

### 2. 분석기 `scripts/hooks/shell.ts`

- `normalize`의 래퍼를 벗기는 자리: `WRAPPERS`·`timeout`·`xargs`의 세 갈래를 하나로 합쳐, 이름이 표에 있으면 `skipWrapperOptions`로 건너뛴다. `WRAPPERS` 집합은 표의 이름으로 대신한다(표에 지금의 래퍼가 모두 있다).
- **모르는 옵션(`unsure`)일 때의 후보**: 주 해석은 `next`에서 시작하는 명령이다(전과 같은 방식으로 낸다). 여기에 더해, `next` 뒤의 낱말 가운데 `-`로 시작하지 않는 낱말마다 그 낱말에서 시작하는 명령을 후보로 낸다. 후보는 한 조각에서 많아야 8개다(앞에서부터). 후보는 그 낱말부터 끝까지를 `normalize`에 다시 넣어 만든다(후보 안의 래퍼·할당·리다이렉션도 같은 방식으로 읽힌다). 후보에서 다시 후보를 내지 않는다.
- 주 해석을 먼저 `out`에 넣고 후보를 그 뒤에 넣는다. `parseSequence`(검사 순서용 분석)는 그 자리의 주 해석을 지금처럼 `cmd`로 내고, 후보가 있으면 `alts`(새 선택 칸. 명령의 배열)로 함께 낸다. 후보가 없으면 `alts`를 두지 않는다.
- 계수기 `parseWork`(내보내는 객체 `{ words: number }`): `normalize`가 낱말 목록을 받을 때마다 그 길이를 `words`에 더한다(후보를 만들 때도 `normalize`를 거치므로 센다). `env`의 먼저 훑기(3)가 본 낱말 수도 더한다. 판정에는 쓰지 않는다. 읽은 양이 입력 길이에 비례하는지를 테스트가 이 값으로 본다(4).
- 리다이렉션이 섞인 조각(`nice >/dev/null -n 5 git …`)에서도 같다: 옵션 읽기는 리다이렉션을 뺀 낱말로 한다(지금의 구조 그대로).
- **`sudo`의 할당**: `sudo`는 옵션 사이에 `이름=값` 낱말을 받아 실행할 명령의 환경에 넣고, 그 뒤에서 옵션 읽기를 이어 간다(`sudo A=1 -u 사용자 명령`은 `명령`을 그 사용자로 실행한다). sudo의 소스(`src/parse_args.c`)를 2026-11-22에 읽었다: `/`나 `=`로 시작하지 않고 `=`가 든 낱말이 그런 낱말이고, 이름이 셸의 식별자일 필요가 없으며(`A-B=1`), 바로 앞 낱말이 `--`이면 할당이 아니라 명령이다. 지금은 셸의 식별자 꼴만 할당으로 읽고 그 뒤의 옵션을 읽지 않아 `sudo A=1 -u 사용자 명령`과 `sudo A-B=1 명령`의 명령에 규칙이 돌지 않는다(main에서도 같다).
  - 훅도 sudo처럼 읽는다: 표의 `assigns`가 참인 래퍼의 옵션 읽기가 끝난 자리(`next`)의 낱말이 `-`·`/`·`=`로 시작하지 않고 `=`가 들었고 바로 앞 낱말이 `--`가 아니면, 첫 `=`의 앞을 이름으로 뒤를 값으로 `assigns`에 담고 그다음 낱말부터 그 래퍼의 옵션을 다시 읽는다(`skipWrapperOptions`를 다시 부른다. 표에 없는 옵션을 만나면 처음과 같게 후보를 낸다). 그런 낱말이 다시 오면 되풀이한다(낱말을 하나 이상 지나가므로 읽는 양은 입력에 비례한다).
  - `--` 바로 뒤의 낱말은 sudo에게 명령이다. 그 낱말이 셸의 식별자 꼴 할당이면(`sudo -- A=1 명령`) 지금처럼 할당으로 읽어 뒤의 명령을 본다(sudo는 `A=1`이라는 명령을 찾다가 실패한다. 막는 쪽이고 지금도 그렇다). 식별자 꼴이 아니면(`sudo -- A-B=1 명령`) 그 낱말이 명령 이름이다.
  - `doas`는 할당을 받지 않는다(OpenBSD의 `doas.c`를 읽었다: 옵션 뒤의 첫 낱말이 명령이다). 표의 `assigns`를 두지 않는다. 다른 래퍼도 지금 그대로다.

### 3. `env`

`normalize`의 `env` 처리(이름이 `env`나 `genv`일 때)를 다시 쓴다. `env`의 구현 셋(GNU coreutils, macOS, uutils coreutils)은 같은 낱말을 다르게 읽는 자리가 있다. 근거는 셋이다: 2026-11-22에 macOS는 이 Mac에서, uutils는 CI 러너(`env (uutils coreutils) 0.10.0`)에서 받은 이름과 인자를 적기만 하는 가짜 실행 파일로 돌려 본 결과(plan.md 진행 로그의 조사 1차·2차. 아래의 "실측"), GNU `env.c`(9.4)의 소스, uutils 0.10.0의 소스(`src/uu/env/src/env.rs`. 아래의 "uutils 소스").

원칙은 셋이다(제작자 결정 셋, 2026-11-22: 실제 `env`처럼 한 가지로 읽는다. 구현마다 갈리는 꼴은 모두 막는다. `env -S`는 통째로 막는다).

- **세 구현이 같은 것을 실행하는 꼴만 읽는다.** 읽은 명령의 이름과 인자는 실제로 실행되는 것과 같다. 한 구현이 오류로 끝나 아무것도 실행하지 않는 꼴(그 구현이 모르는 옵션)은 나머지 구현의 실행으로 읽는다: 무엇이든 실행된다면 읽은 것과 같다.
- **갈리면 막는다.** 구현에 따라 실행 파일이나 그것이 받는 인자가 달라지는 꼴과 표에 없는 옵션은 **끝까지 읽지 못한 명령**으로 낸다(`SimpleCommand`의 새 선택 칸 `incomplete: true`. 그 조각이 낸 명령이 없으면 빈 명령에 달아 낸다). 표시가 있으면 규칙이 그 호출을 막으므로(3-1) 그 조각의 나머지를 어떻게 읽든 통과하지 않는다. `env`에서는 후보를 내지 않는다. 한 구현의 읽기를 골라 읽지도 않는다: 고르지 않은 구현이 실제로 실행하는 것(이름이 `-`로 시작하는 실행 파일, 달라진 인자)을 놓친다(계획 검증 11회차의 F12·F14).
- **`-S`(`--split-string`)의 문자열은 읽지 않는다.** `-S`는 문자열을 `env`가 낱말로 나눠 명령으로 실행하는 옵션이다(스크립트의 첫 줄에 쓰려고 만든 것이다). 그 문자열을 나누는 규칙을 훅이 구현마다 다 알 수 없다: 따옴표 밖의 줄바꿈·캐리지 리턴·세로 탭·폼 피드를 GNU의 문서는 구분자로 적고 FreeBSD의 문서는 스페이스와 탭만 적는다(이 Mac의 `env`는 넷 모두에서 나눈다: 2026-11-22 실측. 문서와 실제가 다른 구현이 있다는 뜻이다. uutils는 재지 않았다). 오류로 끝나는 꼴(정해지지 않은 이스케이프, 닫히지 않은 따옴표)은 한쪽 문서에만 적혀 있고, uutils는 옵션을 읽기 전에 `-S`를 먼저 나눈다(아래). 훅이 문자열을 읽으면 읽은 인자의 경계가 어느 한 구현이나 버전과 어긋날 수 있다(계획 검증 12회차의 F15. 1~11회차의 F2·F3·F5·F6·F14도 `-S`를 읽는 데서 나왔다). 그래서 `-S`가 옵션으로 읽힐 수 있는 `env` 호출은 문자열 안이 무엇이든 읽지 못한 명령으로 막는다. 문자열을 나누는 함수는 두지 않는다.

`-S` 꼴: `-`와 영문자·숫자가 이어지고 그 안에 `S`가 있는 낱말(`-S`, `-S문자열`, `-iS`, `-vS문자열`)과 `--split-string`으로 시작하는 낱말.

읽기는 세 단계다. 옵션 단계에서 시작한다. 할당을 읽으면 할당 단계로, `--`를 읽으면 끝 단계로 간다.

**옵션 단계**

- 값을 받지 않는 옵션: `-i`, `-0`, `-v`와 이 글자들만 묶은 꼴(`-iv`), `--ignore-environment`, `--null`, `--debug`, `--list-signal-handling`, `--block-signal`·`--default-signal`·`--ignore-signal`(값은 `=`로만 붙는다), `--help`, `--version`. 건너뛴다.
- 값을 받는 옵션: `-u 이름`·`-u이름`·`--unset=이름`, `-C 폴더`·`-C폴더`·`--chdir 폴더`·`--chdir=폴더`, `-P 경로`·`-P경로`, `-a 이름`·`-a이름`·`--argv0 이름`·`--argv0=이름`. 값까지 건너뛴다. 값을 받지 않는 글자 뒤에 묶은 꼴도 읽는다(`-iC 폴더`, `-iu이름`). 띄어 쓴 값의 자리에 `-S` 꼴 낱말이 있으면 읽지 못한 명령이다(`env -u -S… 명령`: GNU와 macOS는 그 낱말을 값으로 두고, uutils는 먼저 나눈다).
- `S`를 옵션 글자로 읽는 낱말(`-S 문자열`, `-S문자열`, 값을 받지 않는 글자 뒤에 묶은 `-iS 문자열`·`-vS문자열`)과 `--split-string`으로 시작하는 낱말(`--split-string 문자열`, `--split-string=문자열`): **읽지 못한 명령이다.** 문자열을 나누지 않는다(위의 셋째 원칙). 값을 붙여 쓴 옵션의 값에 든 `S`는 옵션 글자가 아니다: `env -uSHELL 명령`, `env -iuS 명령`은 그 이름을 지우고 뒤의 명령을 실행하는 호출로 읽는다(GNU와 macOS는 `-u`의 값으로 읽고, uutils의 훑기는 `-S`·`-vS`·`-vvS`로 시작하는 낱말만 나눈다. 이 Mac에서 실측했고 실제 실행 대조가 CI의 uutils에서도 견준다).
- 혼자 쓴 `-`: 건너뛴다(세 구현 모두 환경을 비우는 뜻으로 읽는다. 실측: `env - T a`). 그 뒤에는 할당이나 명령 이름만 읽는다: 그 뒤에 `-`로 시작하는 낱말이 오면 읽지 못한 명령이다(`env - -i 명령`, `env - -- 명령`, `env - - 명령`). macOS는 `-`를 옵션으로 읽고 옵션 읽기를 이어 뒤의 명령을 실행하고(실측: `env - -i T a`가 `tool`을 실행한다), GNU와 uutils는 그 낱말을 실행 파일 이름으로 찾는다(GNU는 소스. uutils 실측: `-i`를 찾다가 127). 할당이 오면 할당 단계로 간다(실측: `env - A=1 T a`가 macOS와 uutils에서 `tool`을 실행한다. GNU는 소스).
- `--`: 건너뛰고 끝 단계로 간다.
- `=`가 들고 `-`로 시작하지 않는 낱말: 할당이다. 이름이 셸의 식별자가 아니어도 된다(`BUILD-MODE=local`, `a.b=1`. GNU는 `strchr`로, uutils는 `split_once`로 `=`가 있는지만 본다. macOS와 uutils에서 실측). 첫 `=`의 앞을 이름으로 뒤를 값으로 `assigns`에 담고 할당 단계로 간다. 이름이 빈 낱말(`=x`)은 담지 않고 넘어간다(uutils는 경고만 내고 명령을 실행한다: 실측. macOS는 오류로 끝나 아무것도 실행하지 않는다). 지금은 셸의 식별자 꼴만 할당으로 읽어 `env BUILD-MODE=local 명령`의 `BUILD-MODE=local`을 명령 이름으로 본다(main에서도 같다. 구현 판정 7회차의 F10).
- `-`로 시작하지 않고 `=`도 없는 낱말: 명령 이름이다. 읽기를 끝낸다.
- 그 밖의 `-`로 시작하는 낱말은 모두 읽지 못한 명령이다. 확인한 갈림:
  - 표에 없는 글자나 이름(`-Z`, `--unknown`, `-x=1`, macOS만 아는 `-L 사용자`·`-U 사용자`, uutils만 아는 `-f 파일`·`--file 파일`).
  - 긴 옵션의 줄인 꼴(`--split '…'`, `--s='…'`, `--unse 이름`): GNU는 다른 이름과 겹치지 않는 앞부분을 받는다(glibc와 coreutils의 설명서). uutils는 `--split`의 문자열을 값으로 삼키기만 하고 뒤의 낱말을 실행한다(실측: `env --split x T a`가 `tool`을 실행한다).
  - 띄어 쓴 `--unset 이름`: GNU와 uutils는 `이름`을 지우고 뒤의 명령을 실행한다. macOS는 `--`로 시작하는 낱말을 짧은 옵션의 묶음으로 읽어(`-`, `-`, `u`와 그 값 `nset`) `이름`을 실행한다(실측: `env --unset T a`가 `tool`을 실행한다). `--unset=이름`과 `-u 이름`은 뒤의 명령이 실행되는 구현끼리 같게 읽는다.
  - macOS가 묶음으로 읽는 그 밖의 꼴(`--S '…'`, `--uX`, `-i-S '…'`: 실측으로 모두 뒤의 명령이나 문자열 안의 명령을 실행한다). 표에 없는 이름·글자이므로 위와 같이 읽지 못한 명령이다.

**할당 단계**(할당을 하나라도 읽은 뒤. `--`는 여기서 옵션의 끝이 아니다)

- `-S` 꼴 낱말(`=`가 들었든 아니든): 읽지 못한 명령이다. GNU와 macOS는 그 낱말을 실행 파일 이름으로 찾거나(`=`가 없을 때. macOS 실측: `-S`가 `T a`를 받는다) 할당으로 읽고(`=`가 있을 때), uutils는 문자열을 나눠 그 안의 명령을 실행한다(실측: `env A=1 -S 'T a'`, `env A=1 -S'T a'`, `env A=1 --split-string 'T a'`, `env A=1 --split-string='T a'`, `env A=1 -S 'B=2 T a'`가 uutils에서 `tool`을 실행한다).
- 그 밖의 `=`가 든 낱말: 할당이다(`-`로 시작해도 같다: `env A=1 -x=1 명령`).
- 혼자 쓴 `-`: 읽지 못한 명령이다. GNU와 macOS는 `-`라는 이름의 실행 파일을 찾아 뒤의 낱말을 인자로 넘기고(GNU는 소스, macOS는 실측), uutils는 넘어가 뒤의 명령을 실행한다(실측: `env A=1 - T a`, `env A=1 - B=2 T a`. uutils 소스: 명령 이름 앞의 `-`는 어디에 있든 환경을 비우는 뜻이다).
- 그 밖의 `-`로 시작하는 낱말(`-i`, `-u`, `--`, `--split`): **명령 이름이다.** 세 구현 모두 그 낱말을 실행 파일 이름으로 찾고 뒤의 낱말을 인자로 넘긴다(GNU는 소스: 첫 할당 뒤에는 옵션을 읽지 않는다. macOS와 uutils는 실측: `env A=1 -i T a`, `env A=1 -u HOME T a`, `env A=1 -- T a`, `env A=1 --split 'T a'`에서 그 이름의 가짜 실행 파일이 뒤의 낱말을 그대로 받았다). 그 낱말부터 끝까지를 명령으로 내고 **글자 그대로 둔다**(뒤의 낱말에서 래퍼·할당을 벗기지 않는다. 인자일 뿐이다). 뒤의 명령은 실행되지 않으므로 규칙이 돌지 않는다. 지금(main)은 그 낱말을 옵션으로 읽고 뒤의 명령에 규칙을 돌린다: `env A=1 -i <금지 호출>`이 막히던 것이 통과로 바뀐다(제작자 결정, 2026-11-22. 계획 검증 9·10회차의 F13). 뒤의 인자 가운데 uutils만 나누는 `-S`가 있으면 아래 "uutils의 먼저 훑기"가 막는다(`env A=1 -x -S '…'`. 계획 검증 11회차의 F14).
- 그 밖의 낱말: 명령 이름이다. 읽기를 끝낸다.

**끝 단계**(옵션 단계에서 `--`를 읽은 뒤. 구현 판정 7회차의 F9)

- `=`가 든 낱말: 할당이다(`-`로 시작해도 같다. 실측: `env -- -x=1 T a`, `env -i -- A-B=1 T a`가 macOS와 uutils에서 `tool`을 실행한다. GNU의 소스도 같다).
- 혼자 쓴 `-`: 읽지 못한 명령이다. macOS는 `-`라는 실행 파일을 찾고(실측), uutils는 넘어가 뒤의 명령을 실행한다(실측: `env -- - T a`, `env -- A=1 - T a`, `env -- - A=1 T a`). GNU는 `--` 바로 뒤의 것만 넘어간다(소스).
- 그 밖의 첫 낱말이 명령 이름이다. `-`로 시작하면 글자 그대로 둔다. `env -- -S 'tool a'`는 `-S`라는 이름의 명령에 `tool a`를 인자 하나로 넘기는 호출이다(옵션이 아니므로 위의 셋째 원칙에 들지 않는다. 실측: macOS와 uutils 모두 `-S`가 `T a` 하나를 받았다. `env -- A=1 -S 'T a'`도 같다. uutils의 훑기는 `--`에서 그친다. 계획 검증 8회차의 F11은 이 실측으로 닫는다).

**uutils의 먼저 훑기**(uutils 소스: 0.10.0의 `process_all_string_arguments`. 2026-11-22에 읽었다)

uutils는 옵션을 읽기 전에 처음 받은 낱말(`env` 뒤의 낱말)을 앞에서부터 한 번 훑으며 `-S`를 나눈다. GNU와 macOS는 옵션을 읽는 자리에서만 나눈다. 그래서 GNU와 macOS에게는 명령 이름이나 인자인 낱말을 uutils만 나누는 자리가 있다. 훅은 uutils의 훑기를 그대로 따라 해 본다.

- uutils가 나누는 낱말: `--split-string`·`-S`·`-vS`·`-vvS` 가운데 하나로 시작하고 뒤에 글이 붙은 낱말(붙은 글을 나눈다), 그 넷 가운데 하나와 글자가 같은 낱말(다음 처음 받은 낱말을 나누고, 그 낱말은 훑지 않고 건너뛴다. 다음 낱말이 없으면 나누지 않는다).
- 훑기가 그치는 곳: `--`와 글자가 같은 낱말, `-`로 시작하지 않고 `=`도 없는 낱말. 그 낱말부터는 나누지 않는다.
- 그치지 않는 예외: 바로 앞에서 훑은 낱말(나눈 낱말이 아닌 것)이 `--argv0`·`--chdir`·`--file`·`--unset`과 글자가 같거나, `-`로 시작하고 `--`로 시작하지 않으며 끝 글자가 `a`·`C`·`f`·`u`이면, 그 다음 낱말에서는 그치지 않는다(uutils는 그 낱말을 옵션의 값으로 본다. `-u이름`처럼 값을 붙여 쓴 낱말의 끝 글자가 그 넷 가운데 하나여도 그렇다: `env -uXa 명령 -S '…'`에서 uutils는 `명령`을 지나 `-S`를 나눈다).

`uutilsSplits(낱말들)`(새 함수. `wrappers.ts`)가 이 훑기로 uutils가 나누는 낱말의 자리(처음 받은 낱말 가운데 몇 번째인가)를 낸다. 입력 길이에 비례하는 한 번의 훑기다. **`env`가 처음 받은 낱말에서 이 함수가 자리를 하나라도 내면 읽지 못한 명령이다**(단계의 읽기가 어디서 끝났든). uutils가 `-S`를 나눈다는 뜻이기 때문이다: 그 낱말이 GNU와 macOS에게도 옵션이면 셋째 원칙으로 막는 호출이고, 아니면 uutils만 나눠 실행 파일이나 인자가 달라지는 호출이다. 이 규칙이 막는 것:

- 할당 단계의 `-`로 시작하는 명령 이름 뒤의 `-S`(`env A=1 -x -S '…'`. 실측: uutils에서는 `-x`가 `T`, `a`를 받고 macOS에서는 `-S`, `T a`를 받았다. F14).
- 끝 글자 때문에 명령 이름을 지나쳐 나누는 `-S`(`env -uXa git -S '…'`).

명령 이름 뒤의 `-S`가 인자로 읽히는 것은 uutils의 훑기가 그 앞에서 그친 때다: 명령 이름이 `-`로 시작하지 않을 때(실측: `env T -S 'a b'`, `env T x -S 'a b'`, `env A=1 T -S 'a b'`, `env -i T -S 'a b'`에서 세 구현 모두 `tool`이 `-S`와 `a b`를 그대로 받았다), 그 사이에 그런 낱말이 있을 때(`env A=1 -i git log -S x`), 끝 단계일 때. `env LC_ALL=C sort -S 1G`나 `env A=1 git log -S x` 같은 호출은 그대로 읽는다.

명령 이름을 찾은 뒤는 지금과 같다: 그 낱말이 `-`로 시작하지 않으면 거기서부터 래퍼 벗기기를 이어 간다(`env A=1 nice -n 5 명령`). 그 안에 다시 `env`가 있으면 그 `env` 뒤의 낱말이 그 `env`가 처음 받은 낱말이다.

훑기의 비용: `env`가 겹친 조각에서 `env`마다 끝까지 훑으면 읽는 양이 제곱으로 는다(`env -uXa env -uXa …`: 끝 글자의 예외 때문에 훑기가 뒤의 `env`를 지나 끝까지 간다). 그래서 한 조각 안에서는, 앞의 `env`의 훑기가 나누는 낱말 없이 지나간 구간 안에서 시작하는 훑기를 다시 하지 않는다. 훑기는 낱말을 하나씩 보고(앞 낱말이 남기는 것은 "다음 낱말에서 그치지 않는다" 하나뿐이다) 그친 자리도 같으므로, 그 구간 안에서 시작한 훑기는 더 일찍 그치거나 같은 낱말을 지나 같은 자리에서 그친다: 나누는 낱말이 없다. `uutilsScan(words, from)`이 그친 자리를 함께 내고, 분석기가 그 자리를 조각마다 기억한다. 나누는 낱말을 찾은 훑기 뒤에는 그 조각을 더 읽지 않는다(읽지 못한 명령이다). 그래서 훑기들이 지나가는 구간은 서로 겹치지 않고, 한 조각에서 훑기가 낱말을 보는 횟수는 그 조각의 낱말 수의 두 배를 넘지 않는다(훑기마다 그친 낱말 하나를 더 본다). 훑은 낱말 수는 계수기 `parseWork.words`에 더한다(계획 검증 13회차의 F16).

### 3-1. 규칙 `scripts/hooks/rules.ts`: 검사 순서 규칙과 읽지 못한 명령

`sequenceRules`가 순서의 한 자리를 볼 때 주 해석(`cmd`)과 후보(`alts`)를 함께 본다.

- 주 해석이나 후보 가운데 하나라도 검사 명령이면 그 자리는 검사 명령이다(출력 가림과 "검사가 앞에 있었다"의 판정에 쓴다).
- 주 해석이나 후보 가운데 하나라도 뒤 명령(push·완료 처리·승인 요청·PR 생성)이면 그 자리는 뒤 명령이다(메시지에는 처음 찾은 것의 이름을 쓴다).
- `set -e`·`pipefail`은 주 해석에서만 읽는다(지금 그대로다).
- 후보가 없는 자리의 판정은 지금과 같다. 이 함수의 판정 조건·메시지는 바꾸지 않는다.

끝까지 읽지 못한 명령: `evaluateBash`가 분석기가 낸 명령 가운데 `incomplete`가 달린 것이 있으면 그 호출을 막는다(방언마다 같다).

- 규칙 이름은 `R4 훅 우회`, 내용은 "`env`가 실행할 명령을 읽지 못했다(`-S`·`--split-string`이 있거나, `env`의 구현마다 달리 읽는 꼴이다)", 고치는 법은 "`env -S`를 쓰지 말고 실행할 명령을 그대로 쓴다. `env`의 옵션은 할당(`이름=값`)과 명령보다 앞에 `-i`, `-u 이름`, `-C 폴더`처럼 따로 쓴다"다.
- 실행될 명령이 무엇이든 막는다(허용된 명령이어도). 읽지 못한 명령을 통과시키지 않는 것이 목적이다.
- `rules.ts`에서 고치는 것은 이 둘(검사 순서 규칙이 후보를 함께 본다, 읽지 못한 명령을 막는다)뿐이다. 금지 목록·예외 목록과 다른 규칙의 메시지는 바꾸지 않는다.

### 4. 테스트 `scripts/test/wrapper-options.test.ts`(새 파일)

판정은 `evaluate({ kind: 'bash', command, cwd }, ctx)`로 한다(`command-position.test.ts`와 같은 `ctx`: 리포 없음, `dbClients: ['psql']`).

- **금지 호출**(`command-position.test.ts`와 같은 열둘): `git push --force origin main`(R14), `git push origin main`(R2), `git reset --hard`(R14), `git clean -fd`(R14), `gh pr review 7 --approve`(R20), `gh secret set X`(R20), `gh auth switch`(R20), `git commit --no-verify -m x`(R4), `rm -rf /`(R14), `psql -c x`(R13), `security find-generic-password -s x`(R20), `npm publish`(R14). 그대로 쓴 판정이 이 규칙인지 먼저 본다.
- **닫는 꼴**(금지 호출마다 모두 기준과 같은 규칙으로 막혀야 한다. `C`는 금지 호출, `이름`은 그 첫 낱말, `나머지`는 그 뒤):
  - `nice`: `nice -n 5 C`, `nice --adjustment 5 C`, `nice -n 5 -- C`, `gnice -n 5 C`.
  - `sudo`·`doas`: `sudo -u someone C`, `sudo -g staff C`, `sudo -u someone -- C`, `sudo --user someone C`, `sudo -iu someone C`, `sudo -E -u someone A=1 C`, `sudo -u someone -g staff C`, `sudo -D /tmp C`, `sudo -h host C`, `sudo -p prompt C`, `sudo --chdir /tmp C`, `doas -u someone C`.
  - `ionice`·`exec`·`time`: `ionice -c 2 C`, `ionice -c 2 -n 7 C`, `ionice --class 2 C`, `exec -a name C`, `exec -cla name C`, `time -f %e C`, `time -o out.txt C`.
  - `timeout`: `timeout -s KILL 5 C`, `timeout -k 1 5 C`, `timeout --signal KILL 5 C`, `timeout --kill-after 1 5 C`, `timeout -s KILL -k 1 5 C`, `gtimeout 5 C`, `gtimeout -s KILL 5 C`.
  - `env`: `env -C /tmp C`, `env --chdir /tmp C`, `env -P /usr/bin C`, `env -a name C`, `env --argv0 name C`, `env -i -C /tmp A=1 C`, `env -iC /tmp C`, `genv -u HOME C`, `env -uSSH_AUTH_SOCK C`, `env -iuS C`(값을 붙여 쓴 `-u`의 값에 `S`가 들어도 `-S`가 아니다).
  - `xargs`: `xargs --max-args 1 C`, `xargs --max-procs 2 C`, `xargs -a list.txt C`, `xargs --arg-file list.txt C`, `xargs -J % C`, `xargs -R 2 C`, `gxargs -n 1 C`.
  - 새 래퍼: `stdbuf -o L C`, `stdbuf -oL C`, `stdbuf --output=L C`, `stdbuf --output L C`, `gstdbuf -o L C`, `setsid C`, `setsid -w C`, `caffeinate C`, `caffeinate -i C`, `caffeinate -t 60 C`, `caffeinate -dims -w 1 C`, `arch -arm64 C`, `arch -arch arm64 C`, `arch -e A=1 C`, `chrt -f 10 C`, `chrt 10 C`, `taskset -c 0 C`, `taskset 0x1 C`, `unbuffer C`, `unbuffer -p C`.
  - 겹친 래퍼: `sudo -u someone nice -n 5 C`, `nice -n 5 sudo -u someone C`, `timeout -s KILL 5 env -C /tmp C`, `nohup nice -n 5 C`.
  - 다른 틀과 섞인 꼴: `if true; then nice -n 5 C; fi`, `>/dev/null nice -n 5 C`, `nice >/dev/null -n 5 C`, `nice -n >/dev/null 5 C`, `nice -n 5 >/dev/null C`, `A=1 nice -n 5 C`, `bash -c "nice -n 5 C"`, `true && sudo -u someone C`, `NICE -n 5 C`(이름의 대소문자), `/usr/bin/nice -n 5 C`(경로).
  - 모르는 옵션(후보로 막힌다): `nice --unknown 5 C`, `sudo --unknown someone C`, `sudo -Z someone C`, `timeout --unknown x 5 C`, `stdbuf -Z x C`, `xargs -i {} C`(값을 붙여 써야 하는 옵션을 띄어 쓴 꼴), `nice --unknown a b c d C`(후보 넷째 자리).
  - 할당과 옵션의 끝(구현 판정 7회차의 F9·F10과 같은 갈래): `env BUILD-MODE=local C`, `env a.b=1 C`, `env -i A-B=1 C`, `env -- BUILD-MODE=local C`, `env -- -x=1 C`, `env =x C`, `env A=1 -x=1 C`, `env - A=1 C`, `sudo A-B=1 C`, `sudo A=1 -u someone C`, `sudo -u someone A-B=1 C`, `sudo A=1 B-C=2 -g staff -u someone C`, `sudo -u someone A=1 -- C`.
- **유지하는 꼴**(지금도 막힌다. 그대로여야 한다): `nice C`, `sudo C`, `sudo -n C`, `nohup C`, `time -p C`, `command -p C`, `exec -c C`, `nice -n5 C`, `nice --adjustment=5 C`, `nice -10 C`, `ionice -c2 C`, `timeout 5 C`, `timeout --signal=KILL 5 C`, `timeout --preserve-status 5 C`, `env -u HOME C`, `env -i C`, `env --chdir=/tmp C`, `env A=1 C`, `xargs -n 1 C`, `xargs -I {} C`, `xargs --max-procs=2 C`, `xargs -0 -n 1 C`, `sudo --user=someone C`, `sudo -usomeone C`, `command -- C`, `exec -- C`, `nohup -- C`, `builtin command C`.
- **유지하는 꼴(할당과 옵션의 끝)**: `env -- C`, `env -i -- A=1 C`, `env - C`, `sudo A=1 C`, `sudo -- A=1 C`.
- **허용**(막히지 않아야 한다): `nice -n 5 node scripts/harness.ts test`, `timeout -s KILL 5 git status`, `timeout -k 1 5 node --test x.test.ts`, `sudo -u someone ls`, `nice -n 5 echo git reset --hard`, `sudo -u someone echo "git reset --hard"`, `timeout 5 grep -r "git push --force" .`, `xargs -n 1 echo`, `nice -n 5 git log --oneline`, `env -C /tmp git status`, `env -uSHELL git status`, `stdbuf -o L cat file.txt`, `caffeinate -i node scripts/harness.ts test`, `arch -arm64 node -v`, `chrt -f 10 node -v`, `taskset -c 0 node -v`, `nice --unknown 5 node -v`(모르는 옵션이 있어도 뒤에 금지 호출이 없으면 통과한다), `sudo --unknown someone git status`.
- **허용(할당과 옵션의 끝)**: `env BUILD-MODE=local git status`, `env -- git status`, `env - git status`, `env - A=1 git status`, `sudo A=1 -u someone ls`, `env tool -S "git reset --hard"`(명령 이름 뒤의 `-S`는 그 명령의 인자다), `env LC_ALL=C sort -S 1G file.txt`(할당 뒤의 명령 이름에서 uutils의 훑기가 그친다), `env -- -S "git reset --hard"`(`--` 뒤의 `-S`는 그 이름의 명령이고 문자열은 인자 하나다).
- **실행되지 않는 명령**(통과로 바뀐다. 제작자 결정, 2026-11-22): 금지 호출 열둘을 넣은 `env A=1 -i C`, `env A=1 -u HOME C`, `env A=1 -- C`, `env A=1 --split C`, `env -- -x C`의 판정이 `tool-x C`(금지 호출의 글이 다른 명령의 인자일 뿐인 호출)의 판정과 같다. `env -- -S "C"`와 `env -- A=1 -S "C"`의 판정은 `tool-x "C"`(글 전체가 인자 하나)와 같다. 낸 명령에 `incomplete`가 없다. 기준이 되는 `tool-x C`는 열둘 가운데 열하나가 통과하고 `psql -c x`만 R13이다(DB 클라이언트의 이름은 인자 자리에서도 본다. main에서 확인했다). `env A=1 -i C`는 main에서 열둘 모두 그 호출의 규칙으로 막힌다는 것도 진행 로그에 적는다(바뀌는 판정).
- **읽지 못한 명령**(R4로 막힌다. `X`에 `git status`를 넣어도 막히고, 금지 호출 열둘을 넣어도 막힌다. 낸 명령에 `incomplete`가 있다. `-S`의 문자열 안에 줄바꿈이 든 꼴도 같다: `env -S` 뒤의 문자열이 `tool a`, 줄바꿈, `b`인 호출은 R4다. 계획 검증 12회차의 F15):
  - 표에 없는 옵션과 줄인 긴 옵션: `env --unknown x X`, `env -Z X`, `env -L someone X`, `env --split "X"`, `env --s="X"`, `env --split-s "git" status`, `env --unse HOME X`, `env --unset HOME X`, `env --S "X"`, `env --uY X`, `env -i-S "X"`, `env -x=1 X`, `env --file x X`.
  - `-S`가 옵션으로 읽히는 호출(문자열을 읽지 않는다. 제작자 결정): `env -S "X"`, `env -S"X"`, `env --split-string "X"`, `env --split-string="X"`, `env -i -S "X"`, `env -iS "X"`, `env -vS "X"`, `env -S "이름" 나머지`, `env -S "BUILD-MODE=local X"`, `env -u -S X`, `env -C -Sa X`, `env -P /usr/bin -S "X"`, `env -S "-S 'X'"`, `env -S -i -S -i -S "X"`.
  - uutils만 `-S`를 나누는 호출: `env A=1 -S "X"`, `env A=1 -S"X"`, `env A=1 -S "B=2 X"`, `env A=1 --split-string "X"`, `env A=1 --split-string="X"`, `env A=1 -iS "X"`, `env A=1 -vS "X"`, `env A=1 -x -S "X"`(F14), `env A=1 -u HOME -S "X"`, `env -uXa 이름 -S "나머지"`(끝 글자 때문에 uutils가 명령 이름을 지나쳐 나눈다).
  - 혼자 쓴 `-`의 갈림(F12): `env A=1 - X`, `env -- - X`, `env -- A=1 - X`, `env A=1 - B=2 X`, `env -- - A=1 X`, `env A=1 - -i X`, `env - -i X`, `env - -u HOME X`, `env - -- X`, `env - - X`.
- **막는 쪽으로 기우는 대가를 고정한다**(막힌다. 의사결정 로그의 대가): `nice --unknown 5 echo git reset --hard`는 R14로 막힌다. 같은 호출에서 모르는 옵션을 빼면(`nice -n 5 echo git reset --hard`) 통과한다.
- **분석기의 낱말**(`parseShell`. 명령의 `args ?? argv`를 본다):
  - `nice -n 5 git status`, `sudo -u someone -g staff git status`, `timeout -s KILL -k 1 5 git status`, `xargs --max-args 1 git status`, `stdbuf -o L git status`, `arch -arch arm64 git status`, `chrt -f 10 git status`: 각각 명령 하나, `['git', 'status']`.
  - `env -C /tmp A=1 git status`: `['git', 'status']`이고 `assigns`에 `A: '1'`.
  - `sudo -u someone A=1 git status`: `['git', 'status']`이고 `assigns`에 `A: '1'`.
  - `nice --unknown 5 git status`: 첫 명령(주 해석)은 `['5', 'git', 'status']`, 그 뒤의 후보는 `['git', 'status']`, `['status']`다.
  - `nice --unknown a b c d e f g h i j`: 후보는 8개다(`b`부터 `i`까지에서 시작하는 것).
  - `incomplete`는 그 밖의 명령에는 없다(닫는 꼴·유지하는 꼴·허용의 어느 호출에도 없다).
  - 래퍼뿐인 조각(`nice -n 5`, `sudo -u someone`, `timeout -s KILL 5`, `nice -n`)은 전처럼 명령을 내지 않는다.
  - 할당과 옵션의 끝(모두 명령 하나다. 후보가 없고 `incomplete`가 없다): `env BUILD-MODE=local git status`는 `['git', 'status']`이고 `assigns`에 `'BUILD-MODE': 'local'`. `env =x git status`는 `['git', 'status']`이고 `assigns`가 비어 있다. `env -- -S 'tool a'`는 `['-S', 'tool a']`. `env -- -x=1 tool a`는 `['tool', 'a']`이고 `assigns`에 `'-x': '1'`. `env -i -- A=1 tool a`는 `['tool', 'a']`. 할당 뒤의 `-` 낱말은 명령 이름이다: `env A=1 -i tool a`는 `['-i', 'tool', 'a']`(`assigns`에 `A: '1'`), `env A=1 -- tool a`는 `['--', 'tool', 'a']`, `env A=1 -u HOME -i tool a`는 `['-u', 'HOME', '-i', 'tool', 'a']`, `env A=1 -i B=2 nice tool a`는 `['-i', 'B=2', 'nice', 'tool', 'a']`(글자 그대로다. 뒤의 할당과 래퍼를 벗기지 않는다). 뒤의 인자 가운데 uutils의 훑기가 그친 뒤의 `-S`는 인자다: `env A=1 -i git log -S x`는 `['-i', 'git', 'log', '-S', 'x']`. 옵션 단계의 혼자 쓴 `-`는 건너뛴다: `env - tool a`, `env -i - tool a`는 `['tool', 'a']`, `env - A=1 tool a`는 `['tool', 'a']`이고 `assigns`에 `A: '1'`. 명령 이름 뒤의 `-S`는 인자다: `env tool -S 'a b'`는 `['tool', '-S', 'a b']`, `env A=1 sort -S 1G`는 `['sort', '-S', '1G']`. 값을 붙여 쓴 `-u`의 값: `env -uSHELL -uS git status`는 `['git', 'status']`이고 `unsets`가 `SHELL`, `S`다. `sudo A=1 -u someone git status`는 `['git', 'status']`이고 `assigns`에 `A: '1'`. `sudo -u someone A-B=1 git status`는 `['git', 'status']`이고 `assigns`에 `'A-B': '1'`. `sudo /x=1 git status`는 `['/x=1', 'git', 'status']`(`/`로 시작하면 명령이다). `sudo -u someone -- A-B=1 git status`는 `['A-B=1', 'git', 'status']`(`--` 바로 뒤는 명령이다). `doas A-B=1 git status`는 `['A-B=1', 'git', 'status']`(`doas`는 할당을 받지 않는다).
- **`skipWrapperOptions`**(표를 읽는 함수만 따로): 위 "읽는 함수"의 항목마다 한 사례씩(`--`, 값이 붙은 긴 옵션, 값을 띄어 쓴 긴 옵션, 모르는 긴 옵션, 숫자 옵션, 묶은 짧은 옵션의 가운데·끝의 값 글자, 모르는 글자, `-` 하나, 자리 인자, 값이 없는 끝). 표에 든 래퍼 이름마다 `flags`와 `values`에 같은 글자가 없고 `longFlags`와 `longValues`에 같은 이름이 없다. `assigns`가 참인 래퍼는 `sudo`뿐이다.
- **`uutilsSplits`**(3의 "uutils의 먼저 훑기"의 규칙마다 한 사례씩. 괄호 안은 `env` 뒤의 낱말, 화살표 뒤는 나누는 낱말의 자리): 따로 쓴 `-S`와 다음 낱말(`-S`, `a b`, `x` → 0), 붙여 쓴 `-Sab`(→ 0), `--split-string=a`와 `--split-string`, `a`(→ 0), `-vS`, `a`와 `-vvSa`(→ 0), 묶은 `-iS`, `a`(→ 없음), 값이 없는 끝의 `-S`(→ 없음), 그치는 낱말 뒤(`tool`, `-S`, `a` → 없음), `--` 뒤(`--`, `-S`, `a` → 없음), 할당과 `-`로 시작하는 낱말은 지나간다(`A=1`, `-x`, `-`, `-S`, `a` → 3), 값을 받는 옵션의 다음 낱말에서 그치지 않는다(`-u`, `HOME`, `-S`, `a` → 2. `--chdir`, `d`, `-S`, `a` → 2), 끝 글자의 예외(`-uXa`, `tool`, `-S`, `a` → 2. `-uXb`, `tool`, `-S`, `a` → 없음), `-P`는 값을 받는 옵션으로 보지 않는다(`-P`, `d`, `-S`, `a` → 없음), 나눈 낱말 뒤에서는 예외가 없다(`-S`, `-u`, `tool`, `-S`, `a` → 0), 여러 번(`-S`, `a`, `-S`, `b` → 0, 2), 건너뛴 문자열 낱말은 훑지 않는다(`-S`, `--`, `-S`, `a` → 0, 2).
- **검사 순서 규칙**(R4): 다음 쌍의 판정이 서로 같다(앞의 것은 옵션 없는 래퍼, 뒤의 것은 값을 받는 옵션이 있는 래퍼).
  - `node scripts/harness.ts check; nice git push origin x`와 `node scripts/harness.ts check; nice -n 5 git push origin x`, `…; sudo -u someone git push origin x`, `…; timeout -s KILL 5 git push origin x`: 모두 R4.
  - `node scripts/harness.ts check && nice git push origin x`와 `node scripts/harness.ts check && nice -n 5 git push origin x`: 판정이 같다.
  - `nice node scripts/harness.ts check; git push origin x`와 `nice -n 5 node scripts/harness.ts check; git push origin x`: 판정이 같다.
  - 모르는 옵션(후보도 순서의 그 자리에서 본다): `node scripts/harness.ts check && nice --unknown 5 git push origin x`는 `node scripts/harness.ts check && nice git push origin x`와 판정이 같다. `node scripts/harness.ts check; nice --unknown 5 git push origin x`는 R4다(`…; nice git push origin x`와 같다). `nice --unknown 5 node scripts/harness.ts check; git push origin x`도 R4다. `nice --unknown 5 node scripts/harness.ts check | tail`은 R4(출력 가림)다.
  - `env -S`(문자열을 읽지 않는다. 이음 연산자와 무관하게 읽지 못한 명령으로 막힌다): `node scripts/harness.ts check; env -S "git push origin x"`, `node scripts/harness.ts check && env -S "git push origin x"`, `env -S "node scripts/harness.ts check" && git push origin x`, `env -S "node scripts/harness.ts check" | tail`은 모두 R4다.
  - `env`의 할당 뒤(실제로 실행되는 명령만 그 자리의 명령이다. 계획 검증 9·10회차의 F13): `node scripts/harness.ts check; env A=1 -i git push origin x`와 `env A=1 -i node scripts/harness.ts check | tail`은 막히지 않는다(`-i`라는 이름의 명령일 뿐이고 push도 검사도 실행되지 않는다). 구현마다 갈리는 꼴은 이음 연산자와 무관하게 읽지 못한 명령으로 막힌다: `node scripts/harness.ts check; env A=1 - git push origin x`, `node scripts/harness.ts check && env A=1 - git push origin x`, `node scripts/harness.ts check && env A=1 -S "git push origin x"`, `env A=1 - node scripts/harness.ts check | tail`은 모두 R4다.
- **실제 실행 대조**: 임시 폴더에 실행 파일 `tool`을 만든다. 받은 인자의 수와 인자를 NUL로 구분해 결과 파일에 적는 `sh` 스크립트다(공백·탭·줄바꿈이 든 인자와 빈 인자를 구별한다). 결과 파일의 절대 경로는 스크립트 안에 적어 둔다. 명령에는 `tool`을 그 절대 경로로 적어 `bash -c`로 돌린다(아래 사례의 `tool`은 모두 그 절대 경로다). `PATH`와 환경 변수에 기대지 않으므로 `env -i`가 환경을 비운 사례에서도 `tool`이 실행되고 결과를 적는다(계획 검증 3회차의 F7). 임시 폴더의 경로에 셸이 달리 읽는 글자(공백, 따옴표, 백슬래시, `$`, `#`, `;`)가 없는지 먼저 단언한다. 사례마다 돌리기 전에 결과 파일을 빈 파일로 만들고, 돌린 뒤에 비어 있으면 `tool`이 실행되지 않은 것이다.
  - 돌리는 것은 그 래퍼가 이 머신에 있고(`command -v`) 권한이나 시스템 상태를 건드리지 않는 래퍼의 틀뿐이다: `nice`, `env`, `nohup`, `command`, `exec`, `time`, `timeout`·`gtimeout`, `stdbuf`·`gstdbuf`, `caffeinate`, `arch`, `gnice`, `genv`, `unbuffer`, `xargs`·`gxargs`(입력은 빈 줄 하나). `sudo`, `doas`, `ionice`, `chrt`, `taskset`, `setsid`의 틀과 모르는 옵션의 틀은 돌리지 않는다. 래퍼가 없으면 그 틀을 건너뛴다(`t.diagnostic`으로 대조한 틀과 건너뛴 틀의 수를 낸다). Windows에서는 이 테스트를 건너뛴다. 실제로 대조한 틀이 하나 이상이어야 한다(POSIX 환경에서).
  - 준비를 먼저 확인한다: `tool`을 래퍼 없이 직접 돌려(`tool direct`) 결과 파일에 인자 `direct`가 적혔는지 단언한다. 실행 권한·경로·결과 파일 가운데 하나라도 잘못이면 여기서 테스트가 실패한다(준비의 실패를 "지원하지 않는다"로 읽지 않는다. 계획 검증 4회차의 F8).
  - 닫는 꼴·유지하는 꼴의 틀에 `C`로 `tool a b`를 넣어 돌린다. `tool`이 인자 `a b`로(`xargs`는 `a b`로 시작하는 인자로) 실행된 틀에서는 분석기(`parseShell`)가 낸 명령 가운데 `[tool, 'a', 'b']`가 있는지 본다. 이 틀들에는 모르는 옵션이 없어 후보가 없으므로, 낸 명령은 모두 어느 조각의 주 해석이다. 실행되지 않은 틀(래퍼가 그 옵션을 모른다 등)은 비교하지 않는다.
  - 인자의 경계: `nice -n 5 tool 'a b' ''`, `env -i tool 'a b' ''`, `env BUILD-MODE=local tool a`를 돌려, `tool`이 실제로 받은 인자 배열과 `parseShell`의 첫 명령(`args ?? argv`)이 통째로 같은지 본다. 사례마다 `tool`이 실행돼야 한다(실행되지 않으면 실패다. `-i`가 든 사례도 `tool`의 절대 경로와 스크립트 안의 결과 파일 경로 덕분에 실행된다). `tool`은 인자를 NUL로 구분해 적으므로 공백이 든 인자와 빈 인자도 그대로 견준다.
  - 이름이 `-`로 시작하는 가짜 실행 파일: 임시 폴더 하나에 `-i`, `-u`, `--`, `-x`, `-S`, `-`, `--split`이라는 이름의 실행 파일을 둔다. 제 이름과 받은 인자의 수, 인자를 NUL로 구분해 둘째 결과 파일에 적는 `sh` 스크립트다(결과 파일의 절대 경로는 스크립트 안에 적는다). 아래의 `env` 사례(구현마다 갈리는 꼴, 실행되지 않는 꼴, 읽지 못한 꼴)는 그 폴더를 `PATH`의 맨 앞에 두고 돌린다. 사례마다 "실행된 것"은 `tool`(받은 인자)이나 가짜 실행 파일(이름과 받은 인자) 가운데 결과를 적은 쪽이고, 둘 다 비어 있으면 실행된 것이 없다(계획 검증 11회차의 F12·F14: `tool`만 보면 다른 실행 파일이 실행된 것과 인자가 달라진 것을 놓친다).
  - 구현마다 갈리는 꼴 가운데 읽는 것(실행된 머신에서만 견준다): `env -- tool a`, `env -i -- A-B=1 tool a`, `env -- -x=1 tool a`, `env =x tool a`, `env A=1 -x=1 tool a`, `env - tool a`, `env - A=1 tool a`, `env -i - tool a`, `env tool -S 'a b'`, `env A=1 tool -S 'a b'`, `env -uSHELL tool a`, `env -iuS tool a`. 실행된 것이 있으면 그 이름과 인자 배열이 `parseShell`의 첫 명령과 통째로 같아야 한다. 실행된 것이 없으면 견주지 않고 그 사례와 종료 코드를 `t.diagnostic`으로 낸다(이 Mac에서는 `=x`가 실행되지 않는다). 견준 사례가 하나 이상이어야 한다.
  - 실행되지 않는 꼴(통과로 읽는 꼴의 전제를 그 머신에서 확인한다): `env A=1 -i tool a`, `env A=1 -u HOME tool a`, `env A=1 -- tool a`, `env A=1 --split 'tool a'`, `env -- -x tool a`, `env -- -S 'tool a'`, `env -- A=1 -S 'tool a'`, `env A=1 -i tool log -S x`. 사례마다 셋을 단언한다: `tool`이 실행되지 **않았다**, 그 이름의 가짜 실행 파일이 실행됐다, 가짜 실행 파일의 이름과 받은 인자 전체가 `parseShell`의 첫 명령(`args ?? argv`)과 통째로 같다(`env A=1 -i tool a`는 `['-i', tool, 'a']`). 어긋나는 머신이 있으면 테스트가 실패해 알린다(그 구현에서는 이 꼴이 다른 것을 실행한다는 뜻이다). 그때는 계획으로 돌아와(절차서 2절의 계획 수정) 그 꼴을 읽지 못한 명령으로 옮긴다. 그 머신만 건너뛰게 고치지 않는다. macOS와 uutils에서는 가짜 실행 파일이 뒤의 낱말을 그대로 받는다(실측. 마지막 사례는 이 Mac에서 확인했고 uutils는 소스로 읽었다).
  - 읽지 못한 꼴: "읽지 못한 명령" 목록의 틀에 `X`로 `tool a`를 넣어 돌린다(옵션 오류로 끝나는 구현이 많다. `sudo`처럼 권한을 바꾸는 것은 없다). 실행 여부와 무관하게 훅이 그 호출을 R4로 막는지 본다. 실행된 것이 있는 사례의 수를 `t.diagnostic`으로 낸다(구현에 따라 실제로 무엇인가 실행되는 꼴을 막고 있다는 근거다). `-S`의 문자열 안에 따옴표 밖의 줄바꿈이 든 꼴(`env -S` 뒤의 문자열이 `tool a`, 줄바꿈, `b`)도 돌린다: 구현에 따라 `tool`이 받는 인자의 경계가 다를 수 있는 꼴이고(F15), 훅은 무엇이 실행됐든 R4로 막는다.
  - 공통 단언: 이 테스트가 가짜 실행 파일의 폴더를 `PATH`에 두고 돌린 모든 `env` 사례에서, 실행된 것이 있으면 훅이 그 호출을 막았거나 `parseShell`이 낸 명령 가운데 실행된 것의 이름과 인자 배열 전체가 통째로 같은 것이 있다. 읽은 것과 다른 실행 파일이 실행되거나 인자가 다르면(F12·F14의 꼴) 이 단언이 실패한다.
- **입력 길이에 비례하는가**: 입력의 꼴 여덟에 대해 본다. (가) `nice` 뒤에 모르는 옵션 n개와 낱말 n개 (나) `sudo -u a`를 n번 겹친 것 (다) `nice --unknown 5`를 n번 겹친 것(모르는 옵션이 붙은 래퍼를 겹친 입력) (라) `env` 뒤에 `-S -i`를 n번 쓴 것 (마) `timeout -s KILL 5`를 n번 겹친 것 (바) `-S`를 n번 붙여 쓴 낱말 하나(`env -S-S-S…x`) (사) `sudo` 뒤에 `A=1 -u a`를 n번 쓴 것(할당 뒤에 옵션 읽기를 이어 가는 입력) (아) `env -uXa`를 n번 겹친 것(uutils의 훑기가 뒤의 `env`를 지나 끝까지 가는 입력).
  - 읽은 낱말 수(실행 환경과 무관한 기준): n이 2,000·20,000·80,000일 때, `parseShell` 한 번과 `parseSequence` 한 번이 각각 `parseWork.words`에 더한 값이 입력의 낱말 수의 50배를 넘지 않는다. 배수는 n과 무관한 상수다(주 해석 하나와 후보 8개, 그 각각에서 uutils의 훑기가 낱말마다 많아야 한 번: 18배 이하). 다시 읽는 횟수가 입력 길이에 따라 늘면(겹친 래퍼마다 후보를 낸다, 후보에서 다시 후보를 낸다, 겹친 `env`마다 끝까지 훑는다) 이 단언이 실패한다.
  - 시간: n이 20,000일 때 판정(`evaluate`)이 5초 안에 끝난다. n을 80,000으로 늘린 판정 시간은 20,000일 때의 8배와 1초 가운데 큰 값을 넘지 않는다(크기마다 세 번 재어 가장 짧은 값으로 견준다. 선형이면 4배, 제곱이면 16배다. 1초 아래에서는 재는 오차가 비율을 흔들므로 견주지 않는다). 별도 프로세스로 돌려 시간 제한을 건다(`command-position.test.ts`의 방식).

### 5. 문서

- `docs/harness/design.md` 13.1절:
  - `  - 명령 이름의 자리: …` 줄에서 `, 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`)`을 지운다(그 줄의 다른 글은 그대로다).
  - 그 줄 바로 아래에 다음 한 줄을 넣는다(글자 그대로).

    ```text
      - 래퍼의 옵션: 다른 명령을 대신 실행하는 명령(`sudo`·`doas`·`nice`·`ionice`·`timeout`·`env`·`xargs`·`exec`·`command`·`builtin`·`nohup`·`time`·`stdbuf`·`setsid`·`caffeinate`·`arch`·`chrt`·`taskset`·`unbuffer`와 `g`가 붙은 이름)은 벗기고 그 뒤의 명령을 본다. 래퍼마다 옵션 표(`scripts/hooks/wrappers.ts`)가 있어 값을 받는 옵션의 값(`nice -n 5`, `sudo -u 사용자`, `timeout -s KILL 5`)과 옵션 뒤의 자리 인자(`timeout`의 시간)를 건너뛴다. 표에 없는 옵션을 만나면 값을 받는지 알 수 없으므로, 뒤의 낱말에서 시작하는 명령도 후보로 보아 규칙을 돌린다(막는 쪽으로 기운다. 후보는 한 명령에 8개까지). `env`의 낱말은 `env`의 구현 셋(GNU, macOS, uutils)이 같은 것을 실행하는 꼴만 읽는다(할당 뒤의 `-`로 시작하는 낱말은 명령 이름이다). 구현에 따라 실행 파일이나 인자가 달라지는 꼴, 표에 없는 `env`의 옵션, 문자열을 명령으로 나눠 실행하는 `env -S`(`--split-string`)는 읽지 못한 명령으로 보아 R4로 막는다(`env`에서는 후보를 내지 않는다). 검사 순서 규칙(R4)은 순서의 한 자리에서 주 해석과 후보를 함께 본다. 이 머신에 있는 래퍼로는 실제 실행과 대조한다(테스트).
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
- `scripts/hooks/rules.ts`의 금지 목록·예외 목록·메시지를 바꾸거나, 막히던 호출이 통과하게 만들지 마라. `rules.ts`에서 고치는 것은 둘이다: `sequenceRules`가 순서의 한 자리에서 후보(`alts`)를 함께 보게 하는 것, 끝까지 읽지 못한 명령(`incomplete`)을 막는 차단 하나. 이유: 이 step은 분석기가 명령 이름을 찾는 자리를 바로잡는다. 차단을 풀지 않는다. 예외는 하나다(제작자 결정, 2026-11-22): `env`의 할당 뒤에 온 `-`로 시작하는 낱말을 실제 `env`처럼 명령 이름으로 읽는다(3의 할당 단계). main에서 막히던 `env A=1 -i <금지 호출>`이 통과로 바뀐다. 그 호출은 `-i`라는 실행 파일을 찾을 뿐 뒤의 명령을 실행하지 않는다(macOS와 uutils에서 실측, GNU는 소스). 이 예외 밖에서 통과로 바뀌는 꼴이 있으면 멈추고 진행 로그에 적는다.
- `env -S`의 문자열을 읽어서 통과시키지 마라(제작자 결정, 2026-11-22). `-S`가 옵션으로 읽힐 수 있는 `env` 호출은 문자열 안이 무엇이든 읽지 못한 명령으로 막는다. 이유: 문자열을 낱말로 나누는 규칙이 구현·버전·문서마다 달라(구분자, 오류로 끝나는 꼴, uutils의 먼저 나누기) 읽은 인자가 실제 실행과 어긋난다(계획 검증 1~12회차의 F2·F3·F5·F6·F14·F15).
- 표에 없는 옵션에서 한 해석만 고르지 마라. 이유: 고르지 않은 쪽이 틈이 된다(의사결정 로그). `env`는 후보를 내지 않고 읽지 못한 명령으로 막는다(3).
- `env`의 읽기에 실측이나 소스로 확인하지 않은 꼴을 더하지 마라. 확인하지 못한 꼴은 읽지 못한 명령으로 막는다. 구현마다 갈리는 꼴에서 한 구현의 읽기를 골라 읽지도 마라(제작자 결정, 2026-11-22: 갈리는 꼴은 모두 막는다). 이유: `env`는 구현마다 읽기가 달라, 추측하거나 고른 읽기가 틈이 되거나 실행되지 않는 호출을 막는다(판정 7~11회차의 F9·F10·F12·F13·F14).
- 테스트나 명령으로 금지 호출을 실제로 실행하지 마라. 판정(`evaluate`)만 하고, 실제 실행 대조는 가짜 명령 `tool`로만 한다. `sudo`·`doas`처럼 권한을 바꾸는 래퍼는 실제로 돌리지 않는다. 이유: R2·R14·R20.
- 훅을 끄거나 우회해 확인하지 마라(R4). 금지 호출의 글이 든 내용은 파일 도구로 쓴다.
- `harness.config.json`, 권한 프로필, `.github/`를 고치지 마라. 이유: 이 step의 범위가 아니다.
