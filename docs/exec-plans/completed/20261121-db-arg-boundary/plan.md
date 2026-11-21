---
id: 20261121-db-arg-boundary
issue: 172 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T13:20:57+09:00 # new-task가 채운다
---

# L1 훅의 DB 규칙이 인자의 경계를 보고 판정한다 (TD-61, PR #169 교착의 선행 작업)

## 목표와 수용 기준

L1 훅의 DB 규칙(`scripts/hooks/rules.ts`의 `dbRules`)은 명령의 인자를 공백으로 이은 글 하나를 정규식에 넘긴다. 인자의 경계가 사라져 인자가 다른 두 호출이 같은 글이 된다(`--config "a generate" --name x`와 `--config a generate --name x`). 그래서 "플래그 뒤에 오는 금지 하위 명령"을 막는 정규식은 값에 공백이 든 호출을 놓치거나(`drizzle-kit --config "team config.ts" migrate`), 값 안의 낱말을 하위 명령으로 읽어 허용된 호출을 막는다. PR #169(Issue #166 step1)가 이 때문에 교착이 됐고, 제작자가 "지적대로 고친다"를 골랐다(2026-11-21).

이 계획은 하위 명령을 보는 금지 규칙을 **인자 배열의 자리로** 판정하는 새 형식(`guard.dbCommands`)을 더한다. 정규식 규칙(`DB_PATTERNS`, `guard.dbPatterns`)은 그대로 둔다(따옴표로 묶은 SQL 글 안의 `drop table`처럼 인자 안의 공백에 기대는 패턴이 있어, 잇는 방식을 바꾸면 깨진다).

수용 기준:

1. 설정 `guard.dbCommands`(항목: 도구 이름 `tool`, 금지 하위 명령 목록 `forbidden`)를 주면, L1 규칙(`evaluate`)이 그 도구의 금지 하위 명령 호출을 R13으로 막는다. 판정은 인자 배열로 한다(step0의 "판정 규칙").
2. 인자가 다르고 이은 글이 같은 두 호출을 다르게 판정한다: `drizzle-kit --config "team config.ts" migrate`는 막히고, `drizzle-kit --config "team local migrate config.ts" generate`와 `drizzle-kit --config a generate --name migrate`는 막히지 않는다(`forbidden`에 `migrate`가 있는 설정에서. 테스트가 단언한다).
3. 플래그가 하위 명령 앞에 오는 호출, 버전을 붙인 호출(`drizzle-kit@0.31.11`), 패키지 실행기를 거친 호출(`npx`, `pnpm exec`, `pnpm dlx`), 실행 파일을 경로로 부르는 호출(`node node_modules/drizzle-kit/bin.cjs`)에서도 도구와 하위 명령을 찾는다.
4. 코어가 이 형식으로 기본 항목을 갖는다: `drizzle-kit`의 `push`, `prisma`의 `db push`와 `migrate reset`. 지금 코어 정규식이 놓치는 `drizzle-kit --config x push`, `npx drizzle-kit@latest push`, `prisma --schema x db push`가 막힌다.
5. 지금 막히는 호출은 모두 그대로 막힌다. 있던 정규식과 DB 클라이언트 목록을 지우거나 고치지 않는다. `scripts/test/guard.test.ts`에서 줄을 지우지 않는다(더하기만 한다. AC가 본다). 자체 테스트 시나리오 `r13-db`의 있던 단언이 그대로 통과한다.
6. 판정은 정규식 역추적 없이 인자 수에 비례하는 시간에 끝난다. 규칙마다 인자 배열을 한 번만 지나가고, 인자 하나를 읽는 횟수가 상수 이하다(읽은 횟수를 세는 테스트가 도구 자리가 빽빽한 최악 입력에서 단언하고, 인자 20,000개짜리 최악 입력에 시간 제한을 건 테스트가 있다).
7. 설정 검사는 실제로 걸 수 있는 항목만 통과시킨다: 틀린 `guard.dbCommands`(배열이 아님, 모르는 키, 빠진 필드, 틀린 자료형, 빈 이름, 빈 목록, 공백만 있는 항목, 허용 글자 밖의 이름, `-`로 시작하는 이름, 실행 파일 확장자로 끝나는 이름, `-`로 시작하는 금지 항목)는 설정 오류다. 검사를 통과한 규칙의 도구와 금지 항목으로 만든 가장 단순한 호출은 반드시 걸린다(테스트가 이 불변식을 단언한다). 키가 없으면 빈 목록이다(옛 설정 파일과 호환). L1 훅은 `guard.dbCommands`를 메인 체크아웃의 설정에서 읽는다(작업 worktree의 빈 목록이나 옛 설정이 메인의 차단을 풀지 못한다. 훅을 프로세스로 부르는 테스트가 두 체크아웃의 설정이 다른 경우를 본다). 메인의 설정이 틀리면 Bash 호출이 막히고(fail-closed) Read·Edit는 이 설정 때문에 막히지 않는다.
8. 설계서(13.1절, 12.4절의 `r13-db` 행, 갈라진 지점보다 커진 머리의 버전과 그 번호로 시작하는 변경 기록 한 줄), `docs/harness/architecture.md`의 `hooks/*` 행, `CHANGELOG`의 "다음 버전" 절에 `guard.dbCommands`가 적혀 있다(AC가 절·행·줄마다 확인하고, 버전은 갈라진 지점의 값과 비교한다). 14.3절은 한 글자도 바뀌지 않는다(PR #169의 AC가 14.3절을 글자 그대로 비교한다). `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- 새 모듈 `scripts/hooks/db-commands.ts`(인자 배열 판정)와 그 테스트.
- `scripts/hooks/rules.ts`(`dbRules`가 새 판정을 함께 돌린다, 코어 기본 항목, `GuardContext`에 필드), `scripts/hooks/guard.ts`(설정 읽기), `scripts/lib/config.ts`(타입과 검사).
- `harness.config.json`, `profiles/core/profile.json`: `guard.dbCommands: []` 키를 더한다(빈 목록. 동작은 그대로).
- 테스트: `scripts/test/db-commands.test.ts`(새 파일), `scripts/test/guard.test.ts`(행 더하기), `scripts/test/lib.test.ts`(설정 검사), 자체 테스트 시나리오 `scripts/selftest/scenarios/r13-db.ts`(사례 더하기).
- 문서: 설계서(14.3절 제외), `docs/harness/architecture.md`, `CHANGELOG`.

비범위:

- 웹 프로파일(`profiles/web/**`)과 `scripts/test/profile-web*.test.ts`. PR #169가 이 계획이 병합된 뒤 main을 병합해 Drizzle 항목을 새 형식으로 옮긴다.
- 기술 부채 표. TD-61 행은 PR #169가 만든다(main에 아직 없다). 이 계획이 닫는 것과 남기는 것은 이 계획의 "발견 사항"에 적고, PR #169가 그 행을 맞춘다.
- 정규식 규칙(`DB_PATTERNS`, `guard.dbPatterns`)과 DB 클라이언트 규칙의 동작 변경.
- 설계서 14.3절.
- 패키지 스크립트 안에 든 명령, 셸 안의 셸(`sh -c "…"`)을 지금보다 더 깊이 푸는 일.
- `.github/workflows/`.

## 관련 파일·문서

- `scripts/hooks/db-commands.ts`(새 파일), `scripts/hooks/rules.ts`, `scripts/hooks/guard.ts`, `scripts/lib/config.ts`
- `harness.config.json`, `profiles/core/profile.json`
- `scripts/test/db-commands.test.ts`(새 파일), `scripts/test/guard.test.ts`, `scripts/test/lib.test.ts`, `scripts/selftest/scenarios/r13-db.ts`
- `docs/harness/design.md`(14.3절 제외), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- 읽기만: `scripts/hooks/shell.ts`(`parseShell`, `commandName`, `SimpleCommand`), `scripts/test/helpers.ts`, `scripts/selftest/run.ts`, `profiles/web/profile.json`, PR #169의 `scripts/test/profile-web-db.test.ts`("한계" 테스트)

## step 목록

- step0 argv-rule: 인자 배열 판정 모듈, 설정 `guard.dbCommands`, 코어 기본 항목, 테스트, 문서.

## 진행 로그

- 2026-11-21 PR #169의 F1 교착에 제작자가 A(지적대로 고친다)를 골랐다. Issue #172 등록, `new-task`, 계획 작성.
- 2026-11-21 계획 검증 1라운드(PR #174, head `3ec3201`): `review/claude` 승인(F1·F2, P2). `review/codex` 수정 요청(F3~F6, P1 넷): F3 새 목록을 어느 체크아웃의 설정에서 읽는지 없다(worktree에서 읽으면 빈 목록으로 메인의 차단이 풀린다), F4 설정 검사가 걸리지 않는 항목(공백만 있는 글, 틀린 자료형)을 통과시킨다, F5 step이 제곱 시간 구현을 허용해 계획의 선형 기준과 어긋난다, F6 문서 AC가 요구한 자리(13.1절, 12.4절 행, 버전 줄, CHANGELOG)를 확인하지 않는다. 모두 받아들여 계획을 고쳤다(F1·F2도 같은 수정으로 닫힌다).
- 2026-11-21 계획 검증 2라운드(PR #174, head `d648e08`): `review/claude` 승인(F7, P2). `review/codex` 수정 요청. F3·F5는 닫혔다(fixed). 남은 것 둘: F4(`-`로 시작하는 도구 이름이 설정 검사를 통과하지만 플래그로 읽혀 걸리지 않는다), F6(문서 AC가 버전이 커졌는지와 `hooks/*` 행인지를 보지 않는다). 새 차단 지적은 없다. 둘 다 받아들여 고쳤다: 도구 이름은 허용 글자를 정해 검사하고 실행 파일 확장자로 끝나는 이름·`-`로 시작하는 금지 항목도 거부한다(F7 포함). "검사를 통과한 규칙은 반드시 걸린다"를 불변식 테스트로 둔다. 문서 AC는 갈라진 지점의 버전과 비교하고 행과 절을 짚는다.
- 2026-11-21 계획 검증 3라운드(PR #174, head `ab328fc`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F4는 닫혔다. F6만 남았다: `hooks/*` 행을 고르는 `grep -F`가 줄의 처음을 고정하지 않아, 다른 행의 설명에 같은 글을 넣어도 통과한다. 받아들여 고쳤다: 첫 칸이 정확히 그 이름인 행을 `awk`로 고르고(하나뿐인지도 본다) 그 행에서 글을 찾는다. `r13-db` 행도 같은 방식으로 바꿨다. F6은 1라운드에 등록되어 두 번 다시 판정받았다. 다음 판정에서도 열려 있으면 교착으로 제작자에게 넘긴다(절차서 6절).
- 2026-11-21 계획 검증 4라운드(PR #174, head `b41746d`): `review/claude` 승인(지적 없음). `review/codex` 수정 요청. F6만 열려 있다: `hooks/*` 행은 이제 정확히 고르지만, `r13-db` 행을 설계서 전체에서 찾으므로 그 행을 다른 절로 옮겨 적어도 통과한다(12.4절 안에서만 봐야 한다). `pr-state`가 "오래 열린 지적: F6 — 재판정 3회 뒤에도 열려 있다"를 냈다. 절차서 8절에 따라 더 고쳐 올리지 않고 제작자에게 물었다(선택지 A 방향을 정해 한 번 더 고친다 / B 범위를 줄인다 / C 포기).
  - F6의 경과: 1라운드 "문서 AC가 글이 어디에든 한 번 있으면 통과한다" → 절·행·줄마다 확인하게 고쳤다. 2라운드 "버전이 커졌는지와 `hooks/*` 행인지 보지 않는다" → 갈라진 지점의 버전과 비교, 행을 `grep -F`로 골랐다. 3라운드 "`grep -F`가 줄의 처음을 고정하지 않는다" → 첫 칸으로 행을 고르는 `awk`로 바꿨다(`r13-db` 행도). 4라운드 "`r13-db` 행을 12.4절 안에서 찾지 않는다". 설계(판정 규칙, 설정의 출처, 설정 검사, 선형 시간)에 대한 지적은 모두 닫혔다.
  - 제작자의 답(2026-11-21): **A. 방향을 정해 한 번 더 고친다.** 정한 방향: 문서의 행을 고르는 AC는 모두 "절 안에서, 첫 칸이 정확히 그 이름인 행 하나"로 본다. `r13-db` 행은 12.4절 안에서, `hooks/*` 행은 `architecture.md`의 "레이어" 절 안에서 고른다(뒤의 것은 지적받지 않았지만 같은 종류의 틈이라 함께 좁혔다). 다음 판정에서도 F6이 열려 있으면 다시 고쳐 올리지 않고 제작자에게 묻는다.
- 2026-11-21 판정을 기다리는 동안 step0을 로컬에서 구현했다(push하지 않았다. 계획 승인 뒤에 올린다).
  - 테스트 먼저: `scripts/test/db-commands.test.ts`를 쓰고 규칙에 잇기 전에 돌려 11개 가운데 5개가 실패하는 것을 봤다(훅 판정을 거치는 다섯: 막혀야 하는 호출이 통과, 차단 메시지, 경계, 알려진 대가, 코어 기본 항목). 판정 모듈만 부르는 여섯은 모듈과 함께 써서 실패를 따로 보지 못했다(모듈이 없던 변경 전 코드에서는 실패한다. `test-effect`가 확인한다). `guard.test.ts`·`lib.test.ts`에 더한 테스트는 구현 뒤에 썼다.
  - 로컬 `node scripts/harness.ts check` 통과(test 326초, test-effect 통과).
- 2026-11-21 계획 검증 5라운드(PR #174, head `a33fc8a`): `review/claude`·`review/codex` 모두 승인. F6이 닫혔다. 원장에 `계획 검증(G1): … 승인: claude, codex`가 남았다. 이 뒤에 구현을 올렸다.
- 2026-11-21 step0 자체 검증(구현을 올리기 전):
  - AC 블록의 명령을 한 줄씩 돌려 모두 통과했다(테스트 3개 파일 60개 통과, `self-test` 통과, 문서 AC 통과).
  - 새 모듈의 테스트가 단언으로 실패하는지 변이로 확인했다(체크리스트의 R5 항목). `scripts/hooks/db-commands.ts`를 한 군데씩 틀리게 바꾸고 `scripts/test/db-commands.test.ts`를 돌린 뒤 되돌렸다(되돌린 파일이 원본과 같은지 `cmp`로 봤다).
    - 도구 자리를 찾지 못하게 함 → 8개 실패(판정 모듈만 부르는 테스트 셋 포함).
    - 허용된 하위 명령에서 걷기를 끝내지 않게 함 → 4개 실패(통과해야 하는 호출이 막힘, 경계, 기준 구현과의 비교).
    - 낱말이 둘 이상인 금지 항목을 첫 낱말만 비교하게 함 → 5개 실패(읽은 횟수 한도와 시간 제한 테스트 포함).
    - 도구 이름을 앞부분만 비교하게 함(`drizzle-kitx`) → 1개 실패.
  - 한 번만 걷는다는 조건(금지사항 "도구 자리마다 다시 걷지 마라")을 깨는 변이는 따로 만들지 않았다. 읽은 횟수 테스트의 한도(규칙 수 × 인자 수 × 4)가 그 경우를 잡는다: 도구 자리가 빽빽한 입력에서 다시 걸으면 읽기가 인자 수의 제곱으로 는다.

## 의사결정 로그

- 결정: 글을 잇는 방식을 바꾸지 않고, 인자 배열로 판정하는 새 형식(`guard.dbCommands`)을 더한다. / 이유: 있는 정규식 가운데 인자 안의 공백에 기대는 것이 있다(`psql -c "DROP TABLE x"`의 `drop\s+table`). 인자의 경계를 표시해 잇거나 공백을 바꾸면 그 패턴과 프로파일의 있던 패턴이 깨진다. 하위 명령을 보는 규칙은 정규식보다 인자의 자리로 보는 쪽이 정확하고 역추적이 없다. / 버린 대안: 경계 표시를 넣어 잇기(있던 패턴이 깨지거나 두 글을 모두 돌려야 해 허용된 호출을 막는 쪽이 남는다), 프로파일 정규식 다듬기(PR #169에서 되돌렸다. 같은 글을 가를 수 없다).
- 결정: 플래그가 값을 받는지 알 수 없으므로 "플래그 바로 뒤의 플래그 아닌 인자"는 값일 수도 하위 명령일 수도 있다고 보고 둘 다 따진다(금지 이름이면 막고, 아니면 값으로 보고 계속 걷는다). / 이유: 도구마다 플래그 목록을 설정에 적게 하면 설정이 도구의 버전에 묶인다. 막는 쪽으로 기운 판정이 R13에 맞다. / 대가: `drizzle-kit --verbose generate --name migrate`처럼 값을 받지 않는 플래그 뒤에 허용된 하위 명령이 오고, 그 뒤 플래그의 값이 금지 이름과 글자 그대로 같으면 막힌다. 값을 `--name=migrate`로 붙여 쓰면 막히지 않는다(차단 메시지의 "고치는 법"에 적는다). / 버린 대안: 허용된 하위 명령 목록을 받아 거기서 멈추기(`--config generate migrate`처럼 값이 허용된 이름과 같으면 금지 호출을 놓친다).
- 결정: 코어 기본 항목도 이 계획에서 넣는다(`drizzle-kit`의 `push`, `prisma`의 `db push`·`migrate reset`). / 이유: TD-61이 적은 코어의 틈(플래그가 앞에 오는 호출, 버전을 붙인 호출)이 같은 수단으로 닫힌다. 있던 정규식은 지우지 않으므로 약화가 없다.
- 결정: `guard.dbCommands`는 메인 체크아웃의 설정에서 읽고, 틀리면 Bash 호출을 막는다(fail-closed). / 이유: `guard.mcp`와 같은 이유다. worktree에서 고친, 병합되지 않은 설정으로 규칙을 풀 수 없어야 한다. 틀린 설정은 `check`가 병합 전에 막으므로 main에 들어가기 어렵고, 들어갔다면 조용히 꺼지는 것보다 막히는 쪽이 낫다. Read·Edit는 이 설정을 읽지 않아 고칠 길이 남는다. / 버린 대안: worktree의 설정에서 읽기(있던 `dbPatterns`와 같은 방식. 빈 목록으로 차단이 풀린다), 틀린 항목만 버리기(오타로 규칙이 꺼진다).
- 결정: 도구 자리가 여럿이어도 한 번만 걷는다(다음 도구 자리에서 걷기를 새로 시작한다). / 이유: 자리마다 따로 걸은 것과 결과가 같고(step0의 "한 번만 걷는다"에 이유를 적었다) 선형 시간이다. 테스트가 느린 기준 구현과 결과를 비교한다. / 버린 대안: 자리마다 처음부터 다시 걷기(처음 계획. 제곱 시간).

## 발견 사항

- 이 계획이 TD-61에서 닫는 것: 공백이 든 플래그 값(인자의 경계), 코어의 플래그가 앞에 오는 호출과 버전을 붙인 호출(`drizzle-kit`, `prisma`). 남는 것: 금지 낱말 사이에 플래그가 끼는 호출(`prisma db --schema x push`), 코어의 다른 도구(정규식으로만 본다), 셸 안의 셸. TD-61 행은 PR #169에 있으므로 그 PR이 이 내용으로 행을 맞춘다. → 처리: #166(PR #169에서 TD-61 행을 고친다)
- 있던 `guard.dbPatterns`·`dbClients`는 작업 worktree의 설정에서 읽는다(`scripts/hooks/guard.ts`의 `buildContext`). worktree에서 그 목록을 비우면 프로파일이 더한 차단이 그 worktree에서 풀린다(코어 목록은 코드에 있어 남는다). `guard.mcp`와 새 `guard.dbCommands`는 메인에서 읽는다. 이 계획은 있던 동작을 바꾸지 않는다. → 처리: #166(PR #169에서 TD-61 행에 더한다. 제작자에게 별도 Issue를 제안한다)
- 도구 자리는 인자의 경로 조각으로 찾으므로(계획의 판정 규칙), 도구와 이름이 같은 디렉터리를 가리키는 인자 뒤에 금지 이름과 같은 인자가 오면 도구를 부르지 않는 명령도 막힌다. 실제로 확인했다: `git -C repos/drizzle-kit push`의 인자 배열이 금지로 판정된다(`git -C repos/drizzle-kit status`는 통과). 도구 자체의 리포를 그 이름의 폴더에서 다룰 때만 생기고, 그 폴더로 옮겨 가서 실행하면 통과한다. 놓치는 쪽이 아니라 더 막는 쪽이라 규칙은 그대로 두고 설계서에 알려진 대가로 적었다. → 처리: [docs/harness/design.md](../../../harness/design.md) 13.1절 "알려진 대가"

## 열린 질문

없음. (교착의 선택은 제작자가 정했다. 판정 방식은 구현 방식이라 의사결정 로그에 적었다.)

## 검증 방법과 결과

- 수용 기준 1~4, 6: `node --test scripts/test/db-commands.test.ts scripts/test/guard.test.ts`.
- 수용 기준 5: 위 테스트와 `node scripts/harness.ts self-test`(`check`의 `test`에 들어 있다), AC의 "줄을 지우지 않았다" 확인.
- 수용 기준 7: `node --test scripts/test/lib.test.ts`와 훅을 프로세스로 부르는 테스트.
- 수용 기준 8: AC의 14.3절 비교와 `node scripts/harness.ts check`.
- 결과(2026-11-21, 구현을 올리기 전 로컬): AC 블록 전부 통과. `node scripts/harness.ts check` 통과(fmt, lint, test, test-effect, doc-lint, bypass-scan, secret-scan).

## 다음 할 일

- step0의 구현을 올려 구현 판정을 받는다. 위험도 높음이라 초안으로 두고, 판정이 끝나면 `pr-ready`로 제작자 승인을 요청한다.
- 이 계획이 병합되면 PR #169(브랜치 `feat/20261120-q10-db-decision-s1`)가 main을 병합하고, 웹 프로파일의 Drizzle 정규식을 `guard.dbCommands` 항목으로 옮겨 수용 기준 5를 채운 뒤 TD-61 행을 맞춘다. 그 계획의 step1 지시("`guard.dbPatterns`에 더한다")와 어긋나므로 계획 수정이 필요하다(제작자에게 알리고 계획만 담은 커밋으로 다시 검증받는다).
