---
id: 20261121-hook-command-position
issue: 182 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T23:27:08+09:00 # new-task가 채운다
---

# L1 훅의 명령 이름 규칙(R2·R4·R14·R20)이 리다이렉션 뒤와 예약어 뒤의 명령에서도 돈다 (TD-62 ③)

## 목표와 수용 기준

L1 훅의 규칙 가운데 명령의 이름과 인자의 자리로 고르는 것(`git`·`gh`·삭제·운영 작용·자격증명 도구: R2·R4·R14·R20)은 셸 분석기(`scripts/hooks/shell.ts`)가 낸 명령의 첫 낱말을 이름으로 본다. 첫 낱말이 이름이 아닌 꼴에서는 그 규칙이 돌지 않는다(TD-62 (3), Issue #182). 서버 쪽 장치(브랜치 보호, 봇 토큰의 권한)가 막는 것도 있지만, 작업 트리를 되돌리는 `git` 명령과 훅을 건너뛰는 커밋은 L1 훅 말고 막는 것이 없다.

접수한 뒤 판정을 넓혀 다시 찔러 보았다(진행 로그, main `7eb751b`). Issue에 적은 것(이름 앞의 리다이렉션, 예약어 뒤) 말고도 같은 원인의 틈이 있다: 이름 **뒤**에 리다이렉션이 끼는 호출(`git >/dev/null push …`: 하위 명령의 자리가 밀린다), 이름에 붙은 리다이렉션(`git>/dev/null …`), zsh의 명령 앞 수식어(`noglob`·`nocorrect`·`-`·`repeat N`. 이 Mac의 세션 셸은 zsh다)와 짧은 꼴(`if [[ … ]] 명령`), 검사 순서 규칙(R4)의 같은 꼴, 그리고 리다이렉션에 붙은 대상 파일(`cat <.env`: R10의 파일 이름 검사가 `<.env`를 파일 이름으로 보지 못한다). 이 계획은 이것들을 함께 닫는다.

수용 기준:

1. 금지 호출 여덟(main으로의 push, 강제 push, 작업 트리를 되돌리는 `git` 명령 둘, PR 승인, 시크릿 변경, 계정 전환, 훅을 건너뛰는 커밋)이 다음 꼴로 감싸도 그대로 쓴 것과 같은 규칙으로 막힌다(테스트).
   - 이름 앞의 리다이렉션: `>파일`, `> 파일`, `2>&1`, `<파일`, `&>파일`, `>&2`, `<<<낱말`, 둘 이상, 할당·래퍼와 섞인 것(`A=1 >파일 …`, `>파일 env …`, `env >파일 …`).
   - 이름 뒤에 낀 리다이렉션과 이름에 붙은 리다이렉션: `이름 >파일 …`, `이름 2>&1 …`, `이름 > 파일 …`, `이름>파일 …`.
   - bash의 예약어 뒤: `then`, `else`, `elif`, `do`(`for`·`while`·`until`·`select`), 조건 자리(`if`·`while`·`until` 바로 뒤), `!`, `coproc`, 그리고 이들의 조합(`then !`, `if !`, `! time`, `time !`, `else if`, `then >파일`).
   - zsh의 명령 앞 수식어와 짧은 꼴: `noglob`, `nocorrect`, `-`, `repeat N`, `if [[ … ]] 명령`·`while [[ … ]] 명령`.
2. 같은 꼴로 감싼 다른 규칙의 금지 호출도 막힌다: 재귀 삭제(R14), DB 클라이언트(R13), 키체인 조회(R20), 패키지 게시 같은 운영 작용(R14)(테스트).
3. 지금 막히는 꼴의 판정은 그대로다: `time`, 중괄호·괄호 묶음, `&&` 뒤, `case` 가지, 함수 본문, 할당 뒤, `env`·`command`·`exec`·`nohup`·`xargs`, `eval`·`bash -c`·`sh -c`의 문자열, 줄을 바꾼 `then`, 끝에 붙은 리다이렉션(테스트).
4. 허용되어야 하는 호출은 막히지 않는다: 예약어와 같은 글자가 인자에 있을 뿐인 호출(`echo then`, `git commit -m "do it"`, `grep -r "if" .`), 예약어 뒤의 허용된 명령(`if git diff --quiet; then echo x; fi`, `for f in a b; do node --test "$f"; done`, `until [ … ]; do sleep 10; done`), 검사 뒤 `&&`로 이은 push(테스트).
5. 검사 순서 규칙(R4, 검사 명령 뒤 `&&`가 아닌 연산자로 이은 push·완료 처리, 검사 출력의 파이프)이 검사 명령이나 뒤 명령의 이름 앞·뒤에 리다이렉션이 있어도 돈다(테스트).
6. R10·R20의 파일 이름 검사가 리다이렉션에 붙은 대상도 본다: `cat <.env`, `<.env cat`, `cat 0<.env`, `wc -l <.env`가 R10으로 막힌다. `.env.example`을 같은 꼴로 읽는 것은 막히지 않는다(테스트).
7. 분석기의 해석이 실제 셸과 같다: 위 꼴로 감싼 가짜 명령(`tool a b`. 인자를 파일에 적기만 하는 함수)을 실제 bash와 zsh로 돌려, 셸이 그 명령을 실행한 꼴에서는 분석기도 이름이 `tool`이고 인자가 `a b`인 명령을 낸다(테스트. 셸이 없는 환경에서는 그 셸의 대조를 건너뛴다).
8. 기존 테스트(`scripts/test/shell.test.ts`, `guard.test.ts`, `db-commands.test.ts`, `profile-web-db.test.ts` 등)가 단언을 고치지 않고 통과한다. 입력이 길어도 판정 시간은 입력 길이에 비례한다(테스트).
9. 설계서 13.1절에 분석기가 명령 이름을 찾는 방법과 남는 틈이 적히고, 기술 부채 표 TD-62의 (3)이 남은 틈으로 고쳐진다. `node scripts/harness.ts check`와 `node scripts/harness.ts self-test` 통과.

## 범위 / 비범위

범위:

- `scripts/hooks/shell.ts`: 명령 이름 앞의 리다이렉션·예약어·zsh 수식어를 벗기고 이름에 붙은 리다이렉션을 떼어, `argv`의 첫 낱말이 명령 이름이 되게 한다. `[[ … ]]` 뒤의 낱말을 새 명령으로 나눈다. 검사 순서용 분석(`parseSequence`)에도 리다이렉션 처리를 넣는다.
- `scripts/hooks/rules.ts`: 이름과 인자의 자리로 고르는 규칙이 리다이렉션을 뺀 인자(`args`)로 판정한다. 파일 이름 검사가 리다이렉션에 붙은 대상을 본다. DB 클라이언트 검사가 리다이렉션이 붙은 낱말도 본다.
- 새 테스트 `scripts/test/command-position.test.ts`.
- `docs/harness/design.md` 13.1절(항목 하나)과 0절 버전 이력, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행.

비범위:

- TD-62의 다른 항목: (1) 금지 낱말 사이의 플래그, (2) `dbPatterns`·`dbClients`의 출처, (4) 셸이 실행할 때 만드는 인자(변수, 명령 치환, 중괄호 전개).
- 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`, `watch` 등). 이유: 실행기마다 인자 문법이 달라 목록으로 닫을 수 없다. 남는 틈으로 적는다.
- 값을 받는 옵션이 붙은 래퍼 뒤의 명령(`nice -n 5 명령`, `sudo -u 사용자 명령`, `timeout -s KILL 5 명령`). 이유: 래퍼마다 값을 받는 옵션의 표가 있어야 한다. 이 계획은 리다이렉션과 예약어가 가린 자리를 바로잡는다. 남는 틈으로 적는다(사전 확인에서 찾았다. main에서도 통과한다).
- cmd 방언의 `if`·`for … do` 뒤의 명령, PowerShell의 제어문. 이유: 이 Mac에서 실제 셸로 대조할 수 없다. Windows 실기 검증(TD-14) 때 본다. 남는 틈으로 적는다. 리다이렉션 처리(이름 앞·뒤)는 방언과 무관하게 적용된다.
- 검사 순서 규칙이 `if`·`for` 안의 명령을 순서에 넣는 일. 이유: `if 검사; then push; fi`는 검사가 통과할 때만 push하는 바른 꼴이라, 예약어를 벗기면 바른 꼴이 막힌다. 조건문의 뜻을 따지는 것은 이 규칙(절차 안내)의 범위를 넘는다. 남는 틈으로 적는다.
- 서버 쪽 보호 설정, 권한 프로필.

## 관련 파일·문서

- `scripts/hooks/shell.ts`, `scripts/hooks/rules.ts`
- `scripts/test/command-position.test.ts`(새 파일), 기존 `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`, `scripts/test/db-commands.test.ts`(고치지 않는다. 통과해야 한다)
- `docs/harness/design.md`(13.1절, 0절 버전 이력), `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`(TD-62 행)
- `docs/exec-plans/active/20261121-hook-command-position/**`

## step 목록

- step0 command-name: 분석기가 명령 이름을 찾고(이름 앞의 리다이렉션·예약어·zsh 수식어, 이름에 붙은 리다이렉션, `[[ … ]]` 뒤), 규칙이 리다이렉션을 뺀 인자와 리다이렉션의 대상 파일을 본다. 테스트 먼저. 설계서 13.1절과 TD-62를 맞춘다.

## 진행 로그

- 2026-11-21 접수: 제작자가 대화에서 "Issue를 등록해 고친다"로 정했다. Issue #182를 등록하고 `new-task`로 시작했다.
- 2026-11-21 사전 확인(main `7eb751b`, 훅의 `evaluate`로 판정만 했다. 명령을 실행하지 않았다): 금지 호출 여덟(그대로 쓰면 모두 막힌다)을 감싸 판정했다.
  - 통과한 꼴(틈): 이름 앞의 리다이렉션 전부(`>파일`, `> 파일`, `&>파일`, `>&2`, `<<<낱말`, `{이름}>파일`, 둘 이상, 할당·`env`와 섞인 것), 이름 뒤에 낀 리다이렉션(`git`·`gh`·키체인 조회. 삭제와 패키지 게시는 막혔다), 이름에 붙은 리다이렉션(DB 클라이언트 포함 전부), `then`·`else`·`elif`·`do`·조건 자리·`!`·`coproc`와 그 조합(`then !`, `if !`, `! time`, `time !`, `else if`), zsh의 `noglob`·`nocorrect`·`repeat 1`·`-`·`if [[ … ]] 명령`.
  - 막힌 꼴: 끝에 붙은 리다이렉션, `time`·`time -p`, 묶음(`do {`, `then (`), `coproc 이름 {`, `function f {`, `case` 가지, 줄을 바꾼 `then`, zsh의 `for x (y) 명령`·`() { … }`·`always`, `builtin command`.
  - 허용이 맞는 것: `echo then …`(통과).
  - 검사 순서 규칙: `검사; >파일 git push …`와 `검사; git >파일 push …`가 통과했다(`검사; git push …`는 막힌다).
  - 파일 이름 검사: `cat <.env`, `<.env cat`, `cat 0<.env`, `wc -l <.env`가 통과했다(`cat .env`, `cat < .env`, `< .env cat`은 막힌다). 자격증명 파일은 정규식이 글의 가운데도 봐서 `cat <~/.config/gh/hosts.yml`이 막힌다.
- 2026-11-21 실제 셸 확인(이 Mac: bash 3.2.57, zsh 5.9. 인자를 파일에 적기만 하는 함수 `tool`로 돌렸다): 이름 앞·뒤·붙은 리다이렉션, `then`·`else`·`elif`·`do`·조건 자리·`!`·`time`과 조합은 두 셸 모두 명령을 실행했다. `coproc 명령`은 zsh만(bash 3.2에는 없다), `noglob`·`nocorrect`·`-`·`repeat 1`·`if [[ … ]] 명령`·`for x (y) 명령`·`() { … }`·`always`·`foreach`는 zsh만 실행했다. 따옴표로 묶은 `"then" 명령`과 할당 뒤의 `then`은 두 셸 모두 실행하지 않았다(예약어가 아니다).
- 2026-11-21 step0 테스트 먼저: `scripts/test/command-position.test.ts`(11건)를 쓰고 구현 전에 돌렸다. 6건 실패(닫는 꼴, 분석기의 낱말, 검사 순서 규칙, 파일 이름 검사, 실제 bash 대조, 실제 zsh 대조), 5건 통과(기준, 유지하는 꼴, 허용, 다른 방언, 시간)였다. 구현 뒤 11건 통과.
- 2026-11-21 step0 기존 테스트와 부딪힌 곳 하나: 예약어뿐인 조각을 없앴더니 `db-commands.test.ts`의 "명령의 첫 낱말 자리의 묶음 괄호" 테스트가 실패했다(조각의 순서로 명령을 고른다). 기존 단언을 고치지 않고, 예약어뿐인 조각은 전처럼 그 낱말을 담은 명령을 내게 했다(의사결정 로그). 그 뒤 기존 훅 테스트 네 파일(94건)과 새 테스트가 모두 통과했다.
- 2026-11-21 step0 판정 비교(고치기 전 main과 고친 뒤): `bash -c>/dev/null "…"`, `eval >/dev/null "…"`, `>/dev/null eval …`, `if [[ … ]]; then …; fi`, `[[ … ]] 명령`, `>.env`, `: >.env`, `node scripts/harness.ts >log check; git push …`가 통과에서 막힘으로 바뀌었다. `echo "see <.env"`, `gh issue comment 1 --body "cat <.env"`, `cat .env.example > x`, `git add .env`는 전처럼 통과한다. `nice -n 5 …`, `sudo -u root …`, `timeout -s KILL 5 …`, `find . -exec … ;`, `exec -a x …`는 고치기 전에도 뒤에도 통과한다(비범위. 남는 틈으로 적는다).
- 2026-11-22 step0 AC 수정(push 전): 기술 부채 표를 비교하는 AC 줄이 실패했다. 표의 칸 맞춤 공백이 줄 끝이 아니라 가운데 칸에 있어서였다(TD-62 행의 글이 길어져 그 칸의 공백이 줄었다). 비교가 모든 칸의 맞춤 공백을 빼게 고쳤다. 표의 내용은 손대지 않았다.
- 2026-11-22 step0 main 병합: 다른 세션의 PR(#179)이 설계서 v0.7.71을 먼저 썼다. `origin/main`(`47dee9d`)을 병합하고 이 변경의 버전을 v0.7.72로 옮겼다(변경 이력, 머리말, CHANGELOG). 충돌은 설계서의 변경 이력 한 곳이었다.

## 의사결정 로그

- 결정: 분석기를 고친다. `argv`의 첫 낱말이 언제나 명령 이름이 되게 한다(이름이 없는 명령은 예외). / 이유: 규칙마다 이름을 찾게 하면 새 규칙이 같은 틈을 다시 만든다. 지금도 래퍼(`sudo`, `env`)와 할당은 분석기가 벗긴다. 예약어와 이름 앞의 리다이렉션도 같은 자리에서 벗긴다. / 버린 대안: 규칙이 `args`의 첫 낱말을 보게만 하기(`>파일 env git …`처럼 래퍼와 섞인 꼴이 남는다).
- 결정: 이름 앞의 리다이렉션은 `argv`의 끝으로 옮기고(버리지 않는다), 인자 사이의 리다이렉션은 `argv`에 그 자리 그대로 둔다. 이름과 인자의 자리로 고르는 규칙은 `args`(리다이렉션을 뺀 인자)로 판정한다. / 이유: `argv`가 리다이렉션을 낱말 그대로 담는다는 계약(Issue #172, `db-commands.test.ts`의 단언)을 지킨다. 낱말을 이은 글을 보는 규칙(DB 정규식)과 대상 파일을 보는 규칙은 `argv`를 계속 쓴다. bash에서 리다이렉션은 단순 명령의 어느 자리에 있어도 뜻이 같으므로 옮겨도 명령의 뜻이 바뀌지 않는다. / 버린 대안: 모든 리다이렉션을 끝으로 옮기기(있는 단언을 고쳐야 한다).
- 결정: 예약어는 따옴표를 따지지 않고, 할당·래퍼 뒤에서도 벗긴다. / 이유: 분석기의 낱말에는 따옴표 정보가 없다. `"then" git …`은 bash에서 `then`이라는 명령을 찾다 실패하므로(실제 셸로 확인) 막아도 잃는 것이 없다. 벗기는 쪽이 막는 쪽이다. 인자 자리의 `then`(`echo then`)은 벗기지 않는다.
- 결정: zsh의 명령 앞 수식어(`noglob`·`nocorrect`·`-`·`repeat N`)와 `[[ … ]]` 뒤의 명령도 닫는다. / 이유: macOS의 세션 셸은 zsh다. 실제 zsh가 이 꼴에서 명령을 실행하는 것을 확인했다. bash는 이 꼴을 실행하지 않으므로(없는 명령, 문법 오류) 벗겨도 bash의 해석과 어긋나는 허용이 생기지 않는다. / 버린 대안: 설계서의 "훅은 bash의 해석을 따른다"대로 남는 틈으로 두기(같은 원인이고 몇 낱말로 닫힌다).
- 결정: `[[`가 나온 단순 명령에서는 `]]` 낱말마다 명령을 나눈다. / 이유: 따옴표로 묶은 `"]]"`와 진짜 `]]`를 구별할 수 없으므로 모든 `]]` 뒤를 새 명령으로 본다. 입력을 한 번만 지나가고(시간이 길이에 비례한다), 어느 `]]`가 진짜든 그 뒤의 명령을 놓치지 않는다. bash에서 `[[ … ]]` 뒤에는 연산자가 와야 하므로 바른 bash 명령의 판정은 달라지지 않는다.
- 결정: 리다이렉션에 붙은 대상 파일의 검사(R10)를 이 계획에 넣는다. / 이유: Issue #182의 범위(명령 이름)보다 넓지만, 같은 조사에서 나온 리다이렉션 처리의 틈이고 R10은 L1 훅이 주로 지킨다. 고치는 자리도 같다(이름 앞의 리다이렉션을 옮기면 `<.env cat`의 판정이 이 변경에 걸린다). Issue #182에 댓글로 남긴다. / 버린 대안: TD-62에 항목으로만 남기기.
- 결정: 검사 순서용 분석에서는 제어문의 낱말(`then`, `do`, `else`, `elif`, `if`, `while`, `until`)을 벗기지 않는다. 제어문이 아닌 낱말(`!`, `coproc`, zsh 수식어)은 벗긴다. / 이유: 범위 / 비범위에 적었다(`if 검사; then push; fi`가 막힌다). `검사; noglob git push`는 조건 안이 아니므로 순서에 넣는다.
- 결정: 리다이렉션에 붙은 대상은 분석기가 토큰화 때 판별한 리다이렉션에서 낸다(`SimpleCommand.targets`). / 이유: 규칙이 낱말의 글에서 `<`를 찾으면 따옴표로 묶은 글(`--body "cat <.env"`)도 대상으로 읽어 허용된 호출이 막힌다. 토큰화는 따옴표 밖의 연산자만 리다이렉션으로 본다. / 버린 대안: 규칙에서 낱말을 `<`·`>`로 나누기.
- 결정: 예약어·수식어뿐인 조각(`then`뿐인 줄)은 전처럼 그 낱말을 담은 명령을 낸다. / 이유: 기존 테스트(`db-commands.test.ts`의 "명령의 첫 낱말 자리의 묶음 괄호")가 조각의 순서로 명령을 고른다. 낱말만 있는 조각을 없애면 순서가 밀린다. 그 낱말을 이름으로 가진 규칙이 없어 판정에는 영향이 없다.
- 결정: 위험도 high. / 이유: L1 훅의 판정(보안 장치)을 바꾼다.

## 발견 사항

- 이름 뒤에 낀 리다이렉션(`git >/dev/null push …`)과 이름에 붙은 리다이렉션은 Issue #182와 TD-62 (3)에 없던 틈이다. 이 계획이 닫는다. → 처리: [설계서 13.1절](../../../harness/design.md)
- `cat <.env`처럼 리다이렉션에 붙은 대상은 R10의 파일 이름 검사에 걸리지 않았다. 이 계획이 닫는다. → 처리: [설계서 13.1절](../../../harness/design.md)
- zsh는 `if [[ … ]] 명령`, `repeat N 명령`, `noglob 명령` 같은 꼴을 기본 설정에서 실행한다(zsh 5.9로 확인). 훅은 bash의 해석을 기준으로 하지만 세션 셸이 zsh인 머신이 있다. → 처리: [설계서 13.1절](../../../harness/design.md)
- 값을 받는 옵션이 붙은 래퍼(`nice -n 5`, `sudo -u 사용자`, `timeout -s KILL 5`, `exec -a 이름`) 뒤의 명령은 래퍼가 옵션의 값을 명령 이름으로 읽어 규칙이 돌지 않는다. main에서도 같다. 이 계획의 범위 밖이라 남는 틈으로 적었다. → 처리: TD-62

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령, `node scripts/harness.ts check`, `node scripts/harness.ts self-test`.
- 수용 기준 1~6, 8: `node --test scripts/test/command-position.test.ts`와 기존 테스트.
- 수용 기준 7: 같은 테스트 파일의 실제 셸 대조(bash는 CI와 이 Mac, zsh는 이 Mac).
- 결과(2026-11-22, main 병합 뒤): step0의 AC 10줄 통과, `node scripts/harness.ts check` 통과, `node scripts/harness.ts self-test` 통과(시나리오 10개). 새 테스트 11건 통과(실제 셸 대조는 이 Mac의 bash 3.2.57과 zsh 5.9에서 돌았다. CI는 bash만 있어 zsh 대조는 건너뛴다). 기존 훅 테스트는 고치지 않았다.

## 다음 할 일

1. step0: 테스트를 먼저 쓰고 실패를 확인한 뒤 구현한다.
2. `check`·`self-test` 뒤 PR(초안, 위험도 높음) → 계획 검증·구현 판정 → `pr-ready`.
