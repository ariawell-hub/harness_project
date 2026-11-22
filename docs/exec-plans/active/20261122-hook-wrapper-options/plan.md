---
id: 20261122-hook-wrapper-options
issue: 193 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T09:40:32+09:00 # new-task가 채운다
---

# L1 훅의 명령 이름 규칙이 값을 받는 옵션이 붙은 래퍼(sudo -u, nice -n, timeout -s 등) 뒤의 명령에서도 돈다 (TD-62)

## 목표와 수용 기준

L1 훅의 규칙 가운데 명령의 이름과 인자의 자리로 고르는 것(`git`·`gh`·삭제·운영 작용·자격증명 도구: R2·R4·R14·R20)은 셸 분석기(`scripts/hooks/shell.ts`)가 낸 명령의 첫 낱말을 이름으로 본다. 다른 명령을 대신 실행해 주는 명령(래퍼: `sudo`, `nice`, `timeout` 등)이 앞에 서면 분석기가 래퍼와 그 옵션을 건너뛰는데, `-`로 시작하는 낱말만 건너뛴다. 값을 받는 옵션이 값과 띄어 쓰여 있으면(`nice -n 5 명령`) 그 값을 명령 이름으로 읽고, 뒤의 실제 명령에는 규칙이 돌지 않는다(TD-62 (3), Issue #193. PR #184의 작업 중에 확인했고 그 전의 main에서도 같았다). 래퍼 목록에 없는 래퍼(`stdbuf`, `caffeinate` 등)는 그 이름이 명령 이름이 된다.

서버 쪽 장치(브랜치 보호, 봇 토큰의 권한)가 막는 것도 있지만, 작업 트리를 되돌리는 `git` 명령과 훅을 건너뛰는 커밋은 L1 훅 말고 막는 것이 없다.

수용 기준:

1. 금지 호출(main으로의 push, 강제 push, 작업 트리를 되돌리는 `git` 명령 둘, PR 승인, 시크릿 변경, 계정 전환, 훅을 건너뛰는 커밋, 재귀 삭제, DB 클라이언트, 키체인 조회, 패키지 게시)을 다음 꼴로 감싸도 그대로 쓴 것과 같은 규칙으로 막힌다(테스트. 꼴의 전체 목록은 step0).
   - 값을 받는 옵션이 값과 띄어 쓰인 래퍼: `nice -n 5`, `sudo -u 사용자`, `doas -u 사용자`, `ionice -c 2`, `exec -a 이름`, `timeout -s KILL 5`, `env -C 폴더`, `xargs --max-args 1`, `time -o 파일` 등.
   - 래퍼 목록에 새로 넣는 래퍼: `stdbuf`, `setsid`, `caffeinate`, `arch`, `chrt`, `taskset`, `unbuffer`, 그리고 `g`가 붙은 이름(`gtimeout`, `gnice`, `gstdbuf`, `genv`, `gxargs`).
   - 실행할 명령을 문자열로 받는 `env -S "…"`(`--split-string`): 문자열을 `env`의 규칙으로 낱말로 나눈 명령에 규칙이 돈다.
   - 래퍼가 겹친 꼴, 다른 틀(예약어 뒤, 리다이렉션, 할당, `bash -c`)과 섞인 꼴.
2. 표에 없는 옵션을 만나면 막는 쪽으로 기운다: 그 옵션이 값을 받는지 알 수 없으므로, 주 해석(옵션이 값을 받지 않는다고 본 것)과 함께 뒤의 낱말에서 시작하는 명령도 후보로 내어 규칙을 돌린다(`nice --모르는옵션 5 금지호출`이 막힌다)(테스트).
3. 지금 막히는 꼴의 판정은 그대로다: 옵션이 없는 래퍼, 값을 받지 않는 옵션, 값이 옵션에 붙은 꼴(`nice -n5`, `--adjustment=5`), `timeout 5`, `env -u 이름`, `xargs -n 1`·`-I {}`, `--` 뒤의 명령(테스트).
4. 허용되어야 하는 호출은 막히지 않는다: 래퍼 뒤의 금지되지 않은 명령(`nice -n 5 node scripts/harness.ts test`, `timeout -s KILL 5 git status`, `sudo -u 사용자 ls`), 금지 호출의 글이 다른 명령의 인자일 뿐인 호출(`nice -n 5 echo git reset --hard`. 옵션을 모두 아는 경우)(테스트).
5. 검사 순서 규칙(R4)의 판정이 래퍼의 옵션에 따라 달라지지 않는다: 검사 명령이나 뒤 명령 앞의 래퍼에 값을 받는 옵션이 있어도, 옵션 없는 같은 래퍼일 때와 판정이 같다. 표에 없는 옵션이 붙은 래퍼와 `env -S`에서도 같다: 검사 명령이나 뒤 명령이 후보이거나 `-S`의 문자열 안에 있어도 순서 규칙이 그 자리의 명령으로 본다(`;`로 이으면 R4, `&&`로 이으면 감싸지 않은 것과 같다)(테스트).
6. 분석기의 해석이 실제 실행과 같다: 이 머신에 있고 권한 없이 돌릴 수 있는 래퍼로 가짜 명령(`tool a b`. 인자를 파일에 적기만 하는 스크립트)을 감싸 실제로 돌려, 그 명령이 인자 `a b`로 실행된 꼴에서는 분석기도 이름이 `tool`이고 인자가 `a b`인 명령을 낸다. 인자의 경계도 같다: 공백이 든 인자와 빈 인자를 넘긴 꼴(`env -S 'tool' 'a b'` 등)에서 `tool`이 받은 인자 배열과 분석기의 명령이 통째로 같다(테스트. 그 래퍼가 없는 환경에서는 그 꼴의 대조를 건너뛴다).
7. 기존 테스트(`scripts/test/shell.test.ts`, `guard.test.ts`, `db-commands.test.ts`, `command-position.test.ts`, `profile-web-db.test.ts`)가 단언을 고치지 않고 통과한다. 입력이 길어도 판정 시간이 입력 길이에 비례한다: 분석기가 읽은 낱말 수가 세 크기의 입력에서 모두 입력의 낱말 수의 상수 배를 넘지 않고(계수기로 센다), 입력을 4배로 늘린 판정 시간이 8배를 넘지 않는다(테스트).
8. 설계서 13.1절에 래퍼의 옵션을 읽는 방법과 남는 틈이 적히고, 기술 부채 표 TD-62의 (3)에서 이 항목이 빠진다. `node scripts/harness.ts check`와 `node scripts/harness.ts self-test` 통과.

## 범위 / 비범위

범위:

- 래퍼의 옵션 표와 그것을 읽는 함수(새 파일 `scripts/hooks/wrappers.ts`), `scripts/hooks/shell.ts`의 래퍼를 벗기는 자리(`normalize`)가 그 함수를 쓴다. `env -S`의 문자열을 `env`의 규칙으로 낱말로 나눠 그 자리의 명령으로 읽는다.
- `scripts/hooks/rules.ts`의 검사 순서 규칙(`sequenceRules`): 순서의 한 자리에서 주 해석과 후보를 함께 본다. 그 함수만 고친다.
- 새 테스트 `scripts/test/wrapper-options.test.ts`.
- `docs/harness/design.md` 13.1절(항목 하나를 넣고 "남는 틈"의 문구 하나를 고친다)과 0절 버전 이력, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행, `docs/harness/architecture.md`(훅의 파일 표에 새 파일).

비범위:

- 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`, `watch`, `script -c`, `su -c`, `flock`, `strace` 등). 이유: 실행기마다 인자 문법이 다르고(명령을 문자열로 받는 것, 파일·호스트 뒤에 받는 것) 목록으로 닫을 수 없다. TD-62에 남는다.
- 규칙(`scripts/hooks/rules.ts`)의 금지 목록·예외 목록·메시지. 이유: 이 계획은 분석기가 명령 이름을 찾는 자리를 바로잡는다. 규칙은 분석기의 결과를 그대로 쓴다(검사 순서 규칙이 후보를 함께 보게 하는 것만 범위다).
- TD-62의 다른 항목((1) 금지 낱말 사이의 플래그, (2) 설정의 출처, (4) 셸이 실행할 때 만드는 인자), cmd 방언의 `if`·`for … do`, 검사 순서 규칙이 `if`·`for` 안의 명령을 순서에 넣지 않는 것.
- 서버 쪽 보호 설정, 권한 프로필, `harness.config.json`.

## 관련 파일·문서

- `scripts/hooks/wrappers.ts`(새 파일), `scripts/hooks/shell.ts`
- `scripts/test/wrapper-options.test.ts`(새 파일), 기존 `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`, `scripts/test/db-commands.test.ts`, `scripts/test/command-position.test.ts`(고치지 않는다. 통과해야 한다)
- `scripts/hooks/rules.ts`(검사 순서 규칙의 함수 `sequenceRules`만 고친다)
- `docs/harness/design.md`(13.1절, 0절 버전 이력), `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`
- `docs/exec-plans/tech-debt-tracker.md`(TD-62 행)
- `docs/exec-plans/active/20261122-hook-wrapper-options/**`

## step 목록

- step0 wrapper-options: 래퍼마다 옵션 표를 두어 값을 받는 옵션의 값을 건너뛰고, 표에 없는 옵션에서는 뒤의 낱말도 명령 후보로 낸다. 래퍼 목록에 없는 래퍼를 더한다. 테스트 먼저. 설계서 13.1절과 TD-62를 맞춘다.

## 진행 로그

- 2026-11-22 접수: 제작자가 대화에서 "래퍼의 틈 이슈 등록해라"로 정했다. Issue #193을 등록하고(원인, main에서 판정한 표, 할 일, 수용 기준) PR #185가 병합된 뒤 `new-task`로 시작했다.
- 2026-11-22 사전 확인(main `6edcc71`, 훅의 `evaluate`로 판정만 했다. 명령을 실행하지 않았다): Issue의 표에 더해 61가지 꼴을 판정했다.
  - 통과한다(닫아야 한다): `env -S "금지호출"`, `env --split-string="금지호출"`, `env -P 경로`, `env --chdir 폴더`, `env -a 이름`, `env -i -C 폴더 A=1`, `genv`·`gtimeout`·`gnice`(래퍼 목록에 없다), `sudo --user 사용자`, `sudo -iu 사용자`(묶은 옵션의 끝이 값을 받는다), `sudo -E -u 사용자 A=1`, 겹친 래퍼(`sudo -u 사용자 nice -n 5`), `xargs -a 파일`·`-J %`·`--max-procs 2`, `time -f 형식`·`-o 파일`, `chrt -f 10`, `taskset -c 0`·`taskset 0x1`, `unbuffer`, `stdbuf -oL`·`--output=L`, `caffeinate -t 60`, `arch -arch arm64`, `setsid -w`.
  - 다른 규칙도 같은 꼴에서 돌지 않는다: 재귀 삭제(`nice -n 5`), 패키지 게시(`sudo -u 사용자`), PR 승인, 강제 push(`timeout -s KILL 5`), 훅을 건너뛰는 커밋. DB 클라이언트는 이 꼴에서도 막힌다(낱말 전체에서 클라이언트 이름을 찾는 규칙이다).
  - 검사 순서 규칙: `검사; nice git push …`는 R4로 막히는데 `검사; nice -n 5 git push …`와 `검사; sudo -u 사용자 git push …`는 통과한다.
  - 이미 막힌다(유지한다): `env --chdir=폴더`, `sudo --user=사용자`, `sudo -u사용자`, `xargs --max-procs=2`, `xargs -0 -n 1`, `command --`, `exec --`, `nohup --`.
  - 허용된다(유지한다): `nice -n 5 node scripts/harness.ts test`, `timeout -s KILL 5 git status`, `sudo -u 사용자 ls`, `nice -n 5 echo git reset --hard`, `sudo -u 사용자 echo "…"`, `timeout 5 grep -r "…" .`, `xargs -n 1 echo`, `env -C 폴더 git status`, `stdbuf -o L cat 파일`, `caffeinate -i node …`, `arch -arm64 node -v`.
- 2026-11-22 계획 검증 1회차: Claude 승인(P2 하나), Codex 수정 요청(P1 셋). 넷 다 맞는 지적이라 계획을 고쳤다.
  - F2(P1): `env -S`의 문자열과 뒤 낱말을 공백으로 이어 다시 읽으면 인자의 경계가 사라진다(`env -S 'tool' 'a b'`의 인자는 `a b` 하나다). → 문자열만 `env`의 규칙으로 나누고(`splitEnvString`) 뒤 낱말은 경계를 둔 채 붙인다. 공백이 든 인자와 빈 인자를 실제 실행 대조에 넣었다(`tool`이 인자를 NUL로 구분해 적는다).
  - F3(P1): `-S`로 읽은 명령이 주 해석이 아니라서 검사 순서 규칙(R4)이 보지 못한다. → 나눈 낱말을 그 옵션의 자리에 넣어 읽은 명령이 주 해석이다. 검사 명령과 뒤 명령을 각각 감싼 꼴의 `;`(R4)와 `&&`(허용)를 테스트에 넣었다. 같은 종류의 틈을 하나 더 찾아 함께 닫았다: 모르는 옵션의 후보도 순서 규칙이 보지 못했다(`검사; nice --모르는옵션 5 git push …`). → `parseSequence`가 후보를 `alts`로 내고 `sequenceRules`가 함께 본다(`rules.ts`에서 그 함수만 고친다. 범위와 AC 넷째 줄을 고쳤다).
  - F4(P1): 한 크기에서 5초 안인지만 보면 제곱으로 느는 구현도 통과한다. → 읽은 낱말 수의 계수기(`parseWork`)로 세 크기에서 상수 배를 단언하고, 입력을 4배로 늘린 시간 비(8배 이하)를 더했다. 절대 시간(5초)은 남긴다.
  - F1(P2, Claude): 시간 테스트에 모르는 옵션이 붙은 래퍼를 겹친 입력이 없다. → 입력의 꼴 (다)로 넣었다.
  - 실제 실행 대조의 기준 문구도 고쳤다: "`parseShell`의 첫 명령"은 다른 틀과 섞인 꼴(`if true; then …`)에서 맞지 않는다. "낸 명령 가운데 있다"로 적고, 돌리는 틀에는 후보가 없어 낸 명령이 모두 주 해석임을 밝혔다. 인자의 경계 사례는 첫 명령을 통째로 견준다.
- 2026-11-22 `env -S`의 동작을 이 Mac의 `env`로 확인했다(인자를 출력만 하는 명령으로): 뒤 인자의 경계가 그대로다(공백이 든 인자, 빈 인자). 문자열 안의 따옴표로 묶은 부분은 한 인자다. `;`는 인자로 넘어간다. 낱말 첫 글자의 `#`부터 문자열 끝까지는 주석이고 뒤 인자는 그대로 붙는다. `\_`에서 낱말이 나뉜다. 문자열 안의 옵션(`-i`)과 할당을 `env`가 읽는다. 문자열 안의 `-S`도 다시 나눈다. 묶은 `-iS`가 된다. `${HOME}`은 값으로 바뀐다(훅은 값을 모르므로 글자 그대로 둔다). 분석기의 토큰은 따옴표를 뗀 글을 낱말로 주고 빈 인자도 낱말로 남긴다(`parseShell`로 확인).
- 2026-11-22 판정 시간의 증가를 main에서 쟀다(판정만): 래퍼를 겹친 입력 다섯 가지가 낱말 5,000·20,000·80,000개에서 4배마다 4.3~5.8배였다(예: `sudo -u a`를 겹친 것 6·27·116ms). 320,000개에서는 한 가지가 7.1배였다(메모리 영향으로 보인다). 그래서 시간 비의 기준은 20,000과 80,000 사이에서 8배로 잡고, 실행 환경과 무관한 기준은 계수기로 따로 둔다.

## 의사결정 로그

- 결정: 래퍼마다 옵션 표(값을 받지 않는 옵션, 값을 받는 옵션, 옵션 뒤의 자리 인자 수)를 두고, 표대로 읽을 수 있으면 해석은 하나다. / 이유: 흔한 꼴(`nice -n 5`, `sudo -u 사용자`)을 정확히 읽어야 허용되어야 하는 호출(`nice -n 5 echo …`)을 막지 않는다. / 버린 대안: 래퍼 뒤의 모든 낱말을 명령 후보로 본다(표가 필요 없지만 `timeout 5 grep git …`처럼 인자에 명령 이름이 있는 호출이 넓게 막힌다).
- 결정: 표에 없는 옵션을 만나면 뒤의 낱말도 명령 후보로 낸다(막는 쪽으로 기운다). / 이유: 옵션 목록은 OS와 버전마다 다르고 끝이 없다. 모르는 옵션이 값을 받는지 알 수 없을 때 한 해석만 고르면 다른 쪽이 틈이 된다. / 대가: 모르는 옵션이 붙은 래퍼 뒤에서는 인자에 금지 호출의 글이 낱말로 이어진 호출도 막힌다(`nice --모르는옵션 5 echo git reset --hard`). 드문 꼴이고, 막히면 그 옵션을 빼거나 표에 더하면 된다.
- 결정: 후보는 주 해석 뒤에 따로 낸다. 검사 순서용 분석(`parseSequence`)은 후보를 그 자리의 `alts`로 내고, 검사 순서 규칙은 주 해석과 후보를 함께 본다. / 이유: 순서 규칙은 명령 하나가 한 자리를 차지한다고 본다. 후보를 따로 한 자리씩 세면 `검사 && 래퍼 … push`의 판정이 흔들리고, 후보를 아예 보지 않으면 `검사; 래퍼 --모르는옵션 값 push`가 순서 규칙을 지나간다(수용 기준 2의 "막는 쪽으로 기운다"와 어긋난다). 같은 자리의 다른 해석으로 함께 보면 둘 다 풀린다. / 고친 것: 처음 계획은 "순서용 분석은 주 해석만 쓴다"였다. 계획 검증 1회차의 F3(`env -S`의 명령이 순서에서 빠진다)을 고치면서 같은 종류의 틈인 이것도 함께 닫았다.
- 결정: 규칙(`rules.ts`)의 금지 목록·예외·메시지는 고치지 않는다. 고치는 것은 검사 순서 규칙이 후보를 함께 보게 하는 것 하나다. / 이유: 틈은 분석기가 낸 명령의 이름에 있다. 분석기가 바른 명령을 내면 모든 규칙이 그대로 돈다. 순서 규칙만은 "한 자리에 명령 하나"로 읽으므로 후보를 넘겨받을 칸이 필요하다.
- 결정: `env -S`의 문자열은 `env`의 규칙으로 낱말로 나눠 그 옵션의 자리에 넣고, 그렇게 읽은 명령을 주 해석으로 삼는다. 셸 명령 줄로 다시 읽지 않는다. / 이유: `env`는 문자열만 자기 규칙으로 나누고(따옴표, 백슬래시, `#` 주석) 뒤 인자의 경계는 지킨다. `;`·`&&`도 연산자가 아니라 인자다. 이 Mac의 `env`로 확인했다(진행 로그). / 버린 대안: 문자열과 뒤 낱말을 공백으로 이어 `eval`처럼 다시 읽는다(처음 계획. 공백이 든 인자가 갈라지고, 주 해석이 아니라서 순서 규칙이 보지 못했다. 계획 검증 1회차의 F2·F3).
- 결정: 입력 길이에 비례하는지는 읽은 낱말 수의 계수기와 크기를 늘린 시간 비로 본다. / 이유: 한 크기의 절대 시간만으로는 제곱으로 느는 구현도 통과한다(F4). 계수기는 실행 환경의 시간 편차와 무관하고, 이 계획이 더하는 "다시 읽기"(후보, `-S`)가 상수 번으로 묶였는지를 바로 본다. 계수기가 세지 못하는 비용(배열 복사 등)은 시간 비가 본다. / 대가: 판정에 쓰지 않는 계수기(`parseWork`)가 분석기에 하나 생긴다.
- 결정: 위험도 high. / 이유: L1 훅의 판정을 바꾼다(보안 장치).

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step의 AC 명령과 `node scripts/harness.ts check`, `node scripts/harness.ts self-test`.
- 수용 기준 1~5·7: `node --test scripts/test/wrapper-options.test.ts`와 기존 테스트.
- 수용 기준 6: 같은 테스트의 실제 셸 대조(이 Mac에서 돌린 래퍼의 목록과 건너뛴 것을 진행 로그에 적는다).
- 수용 기준 8: AC의 문서 비교 줄과 `doc-lint`.
- 결과는 step을 진행하며 적는다.

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 step0을 테스트부터 구현한다.
