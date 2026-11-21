---
id: 20261121-db-arg-boundary
issue: 172 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
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
6. 판정은 정규식 역추적 없이 인자 수에 비례하는 시간에 끝난다(인자 20,000개짜리 명령으로 시간 제한을 건 테스트).
7. 틀린 `guard.dbCommands`(배열이 아님, 모르는 키, 빈 이름, 빈 목록)는 설정 검사가 문제로 알린다. 훅은 틀린 설정을 조용히 버려 규칙이 꺼지게 하지 않는다. 키가 없으면 빈 목록이다(옛 설정 파일과 호환).
8. 설계서(L1 훅의 DB 규칙을 설명하는 곳, 12.4절의 `r13-db` 행, 버전 줄), `docs/harness/architecture.md`, `CHANGELOG`가 맞춰져 있다. 14.3절은 한 글자도 바뀌지 않는다(PR #169의 AC가 14.3절을 글자 그대로 비교한다). `node scripts/harness.ts check` 통과.

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

## 의사결정 로그

- 결정: 글을 잇는 방식을 바꾸지 않고, 인자 배열로 판정하는 새 형식(`guard.dbCommands`)을 더한다. / 이유: 있는 정규식 가운데 인자 안의 공백에 기대는 것이 있다(`psql -c "DROP TABLE x"`의 `drop\s+table`). 인자의 경계를 표시해 잇거나 공백을 바꾸면 그 패턴과 프로파일의 있던 패턴이 깨진다. 하위 명령을 보는 규칙은 정규식보다 인자의 자리로 보는 쪽이 정확하고 역추적이 없다. / 버린 대안: 경계 표시를 넣어 잇기(있던 패턴이 깨지거나 두 글을 모두 돌려야 해 허용된 호출을 막는 쪽이 남는다), 프로파일 정규식 다듬기(PR #169에서 되돌렸다. 같은 글을 가를 수 없다).
- 결정: 플래그가 값을 받는지 알 수 없으므로 "플래그 바로 뒤의 플래그 아닌 인자"는 값일 수도 하위 명령일 수도 있다고 보고 둘 다 따진다(금지 이름이면 막고, 아니면 값으로 보고 계속 걷는다). / 이유: 도구마다 플래그 목록을 설정에 적게 하면 설정이 도구의 버전에 묶인다. 막는 쪽으로 기운 판정이 R13에 맞다. / 대가: `drizzle-kit --verbose generate --name migrate`처럼 값을 받지 않는 플래그 뒤에 허용된 하위 명령이 오고, 그 뒤 플래그의 값이 금지 이름과 글자 그대로 같으면 막힌다. 값을 `--name=migrate`로 붙여 쓰면 막히지 않는다(차단 메시지의 "고치는 법"에 적는다). / 버린 대안: 허용된 하위 명령 목록을 받아 거기서 멈추기(`--config generate migrate`처럼 값이 허용된 이름과 같으면 금지 호출을 놓친다).
- 결정: 코어 기본 항목도 이 계획에서 넣는다(`drizzle-kit`의 `push`, `prisma`의 `db push`·`migrate reset`). / 이유: TD-61이 적은 코어의 틈(플래그가 앞에 오는 호출, 버전을 붙인 호출)이 같은 수단으로 닫힌다. 있던 정규식은 지우지 않으므로 약화가 없다.

## 발견 사항

- 이 계획이 TD-61에서 닫는 것: 공백이 든 플래그 값(인자의 경계), 코어의 플래그가 앞에 오는 호출과 버전을 붙인 호출(`drizzle-kit`, `prisma`). 남는 것: 금지 낱말 사이에 플래그가 끼는 호출(`prisma db --schema x push`), 코어의 다른 도구(정규식으로만 본다), 셸 안의 셸. TD-61 행은 PR #169에 있으므로 그 PR이 이 내용으로 행을 맞춘다. → 처리: #166(PR #169에서 TD-61 행을 고친다)

## 열린 질문

없음. (교착의 선택은 제작자가 정했다. 판정 방식은 구현 방식이라 의사결정 로그에 적었다.)

## 검증 방법과 결과

- 수용 기준 1~4, 6: `node --test scripts/test/db-commands.test.ts scripts/test/guard.test.ts`.
- 수용 기준 5: 위 테스트와 `node scripts/harness.ts self-test`(`check`의 `test`에 들어 있다), AC의 "줄을 지우지 않았다" 확인.
- 수용 기준 7: `node --test scripts/test/lib.test.ts`와 훅을 프로세스로 부르는 테스트.
- 수용 기준 8: AC의 14.3절 비교와 `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push하고 초안 PR을 열어 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
- 이 계획이 병합되면 PR #169(브랜치 `feat/20261120-q10-db-decision-s1`)가 main을 병합하고, 웹 프로파일의 Drizzle 정규식을 `guard.dbCommands` 항목으로 옮겨 수용 기준 5를 채운 뒤 TD-61 행을 맞춘다. 그 계획의 step1 지시("`guard.dbPatterns`에 더한다")와 어긋나므로 계획 수정이 필요하다(제작자에게 알리고 계획만 담은 커밋으로 다시 검증받는다).
