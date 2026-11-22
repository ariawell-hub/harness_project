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
   - 명령 줄을 문자열로 받는 `env -S "…"`(`--split-string`).
   - 래퍼가 겹친 꼴, 다른 틀(예약어 뒤, 리다이렉션, 할당, `bash -c`)과 섞인 꼴.
2. 표에 없는 옵션을 만나면 막는 쪽으로 기운다: 그 옵션이 값을 받는지 알 수 없으므로, 주 해석(옵션이 값을 받지 않는다고 본 것)과 함께 뒤의 낱말에서 시작하는 명령도 후보로 내어 규칙을 돌린다(`nice --모르는옵션 5 금지호출`이 막힌다)(테스트).
3. 지금 막히는 꼴의 판정은 그대로다: 옵션이 없는 래퍼, 값을 받지 않는 옵션, 값이 옵션에 붙은 꼴(`nice -n5`, `--adjustment=5`), `timeout 5`, `env -u 이름`, `xargs -n 1`·`-I {}`, `--` 뒤의 명령(테스트).
4. 허용되어야 하는 호출은 막히지 않는다: 래퍼 뒤의 금지되지 않은 명령(`nice -n 5 node scripts/harness.ts test`, `timeout -s KILL 5 git status`, `sudo -u 사용자 ls`), 금지 호출의 글이 다른 명령의 인자일 뿐인 호출(`nice -n 5 echo git reset --hard`. 옵션을 모두 아는 경우)(테스트).
5. 검사 순서 규칙(R4)의 판정이 래퍼의 옵션에 따라 달라지지 않는다: 검사 명령이나 뒤 명령 앞의 래퍼에 값을 받는 옵션이 있어도, 옵션 없는 같은 래퍼일 때와 판정이 같다(테스트).
6. 분석기의 해석이 실제 셸과 같다: 이 머신에 있고 권한 없이 돌릴 수 있는 래퍼로 가짜 명령(`tool a b`. 인자를 파일에 적기만 하는 스크립트)을 감싸 실제로 돌려, 그 명령이 인자 `a b`로 실행된 꼴에서는 분석기의 주 해석도 이름이 `tool`이고 인자가 `a b`인 명령이다(테스트. 그 래퍼가 없는 환경에서는 그 꼴의 대조를 건너뛴다).
7. 기존 테스트(`scripts/test/shell.test.ts`, `guard.test.ts`, `db-commands.test.ts`, `command-position.test.ts`, `profile-web-db.test.ts`)가 단언을 고치지 않고 통과한다. 입력이 길어도 판정 시간이 입력 길이에 비례한다(테스트).
8. 설계서 13.1절에 래퍼의 옵션을 읽는 방법과 남는 틈이 적히고, 기술 부채 표 TD-62의 (3)에서 이 항목이 빠진다. `node scripts/harness.ts check`와 `node scripts/harness.ts self-test` 통과.

## 범위 / 비범위

범위:

- 래퍼의 옵션 표와 그것을 읽는 함수(새 파일 `scripts/hooks/wrappers.ts`), `scripts/hooks/shell.ts`의 래퍼를 벗기는 자리(`normalize`)가 그 함수를 쓴다. `env -S`의 문자열을 명령 줄로 다시 읽는다.
- 새 테스트 `scripts/test/wrapper-options.test.ts`.
- `docs/harness/design.md` 13.1절(항목 하나를 넣고 "남는 틈"의 문구 하나를 고친다)과 0절 버전 이력, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`의 TD-62 행, `docs/harness/architecture.md`(훅의 파일 표에 새 파일).

비범위:

- 훅이 모르는 실행기가 인자로 받아 실행하는 명령(`find -exec`, `ssh 호스트 명령`, `watch`, `script -c`, `su -c`, `flock`, `strace` 등). 이유: 실행기마다 인자 문법이 다르고(명령을 문자열로 받는 것, 파일·호스트 뒤에 받는 것) 목록으로 닫을 수 없다. TD-62에 남는다.
- 규칙(`scripts/hooks/rules.ts`)의 금지 목록·예외 목록·메시지. 이유: 이 계획은 분석기가 명령 이름을 찾는 자리를 바로잡는다. 규칙은 분석기의 결과를 그대로 쓴다.
- TD-62의 다른 항목((1) 금지 낱말 사이의 플래그, (2) 설정의 출처, (4) 셸이 실행할 때 만드는 인자), cmd 방언의 `if`·`for … do`, 검사 순서 규칙이 `if`·`for` 안의 명령을 순서에 넣지 않는 것.
- 서버 쪽 보호 설정, 권한 프로필, `harness.config.json`.

## 관련 파일·문서

- `scripts/hooks/wrappers.ts`(새 파일), `scripts/hooks/shell.ts`
- `scripts/test/wrapper-options.test.ts`(새 파일), 기존 `scripts/test/shell.test.ts`, `scripts/test/guard.test.ts`, `scripts/test/db-commands.test.ts`, `scripts/test/command-position.test.ts`(고치지 않는다. 통과해야 한다)
- `scripts/hooks/rules.ts`(읽기만 한다. 고치지 않는다)
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

## 의사결정 로그

- 결정: 래퍼마다 옵션 표(값을 받지 않는 옵션, 값을 받는 옵션, 옵션 뒤의 자리 인자 수)를 두고, 표대로 읽을 수 있으면 해석은 하나다. / 이유: 흔한 꼴(`nice -n 5`, `sudo -u 사용자`)을 정확히 읽어야 허용되어야 하는 호출(`nice -n 5 echo …`)을 막지 않는다. / 버린 대안: 래퍼 뒤의 모든 낱말을 명령 후보로 본다(표가 필요 없지만 `timeout 5 grep git …`처럼 인자에 명령 이름이 있는 호출이 넓게 막힌다).
- 결정: 표에 없는 옵션을 만나면 뒤의 낱말도 명령 후보로 낸다(막는 쪽으로 기운다). / 이유: 옵션 목록은 OS와 버전마다 다르고 끝이 없다. 모르는 옵션이 값을 받는지 알 수 없을 때 한 해석만 고르면 다른 쪽이 틈이 된다. / 대가: 모르는 옵션이 붙은 래퍼 뒤에서는 인자에 금지 호출의 글이 낱말로 이어진 호출도 막힌다(`nice --모르는옵션 5 echo git reset --hard`). 드문 꼴이고, 막히면 그 옵션을 빼거나 표에 더하면 된다.
- 결정: 후보는 주 해석 뒤에 따로 낸다. 검사 순서용 분석(`parseSequence`)은 주 해석만 쓴다. / 이유: 순서 규칙은 명령 하나가 한 자리를 차지한다고 본다. 후보가 순서에 끼면 `검사 && 래퍼 … push`의 판정이 흔들린다.
- 결정: 규칙(`rules.ts`)은 고치지 않는다. / 이유: 틈은 분석기가 낸 명령의 이름에 있다. 분석기가 바른 명령을 내면 모든 규칙이 그대로 돈다.
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
