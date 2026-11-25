---
id: 20261125-symlink-main
issue: 237 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-25T10:50:18+09:00 # new-task가 채운다
---

# L1 훅이 링크를 거친 경로로 불리면 아무것도 막지 않는다(직접 실행 판정이 실제 경로를 견주지 않는다)

## 목표와 수용 기준

L1 훅(`scripts/hooks/guard.ts`)은 파일 끝의 직접 실행 판정(`path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`)이 참일 때만 검사를 돈다. `import.meta.url`은 링크를 푼 실제 경로이고 `process.argv[1]`은 실행한 경로 그대로라, 리포를 링크를 거친 경로(링크한 폴더, macOS의 `/tmp`·`/var` 아래, Windows의 정션)로 열어 훅이 그 경로로 불리면 판정이 거짓이 되어 검사 없이 종료 코드 0으로 끝난다(Issue #237). 훅이 꺼진 것과 같다. 세션 훅(`scripts/hooks/session.ts`)과 `verify` 표준 명령의 웹 구현(`scripts/verify/web.ts`)도 같은 판정을 써서, 링크를 거친 경로로 불리면 아무것도 하지 않고 0으로 끝난다(`verify`는 판정 없이 통과로 보인다).

수용 기준:

1. 링크를 거친 경로로 불린 L1 훅이 직접 경로와 같게 판정한다: 리포를 가리키는 링크(macOS·Linux는 심볼릭 링크, Windows는 정션) 아래의 `scripts/hooks/guard.ts`에 금지 호출(`git push --force origin main`, `gh pr review 7 --approve`)을 넣으면 종료 코드 2와 규칙 이름(R14, R20)이 나오고, 허용 호출(`ls`)은 0이다(테스트).
2. L1 훅의 진입 파일에는 직접 실행 판정이 없다: `scripts/hooks/guard.ts`는 실행 전용이고 불리면 늘 검사한다. 판정 코드(`normalize`, `buildContext`, `decide` 등)는 새 파일 `scripts/hooks/decide.ts`로 옮기고 테스트는 그쪽을 import한다. `scripts/hooks/guard.ts`의 글에 `import.meta.url`과 `process.argv`가 없다(테스트).
3. 훅 코드를 불러오지 못해도 막는다(fail-closed): 진입 파일이 판정 모듈이나 설정 모듈을 불러오지 못하면 금지 호출이든 허용 호출이든 종료 코드 2와 fail-closed 메시지로 끝난다. 불러오지 못하는 경우는 모듈 없음, 문법 오류, 불러올 때 던짐(`Error` 객체와 `Error`가 아닌 값(`null`, 문자열) 모두), 판정 함수가 없음이다. 오류 메시지를 만들거나 쓰다가 다시 던져도 종료 코드 2로 끝난다: 대역 모듈이 stderr 쓰기를 "표식을 남기고 던지는 함수"로 바꾼 뒤 던지는 경우에도 종료 코드 2이고, 같은 경우가 `catch`의 `finally` 없이 쓴 진입 파일 사본에서는 종료 코드 2가 아니다. 두 실행 모두 표식(오류 처리가 메시지를 쓰려 했다)과 신호 없는 종료를 먼저 확인한다(테스트가 그 재던짐을 실제로 시험한다는 확인). 지금은 불러오기 오류에서 Node가 종료 코드 1로 끝나고, Claude Code는 종료 코드 1을 경고로만 보아 막지 않는다(테스트: 임시 폴더에 진입 파일을 복사하고, 판정 모듈과 설정 모듈은 없거나 위의 경우를 만드는 대역 파일로 둔다).
4. 세션 훅과 `verify` 웹 구현도 링크를 거친 경로로 불리면 돈다: 링크 경로의 `scripts/hooks/session.ts`가 Stop 입력과 가짜 GitHub 상태(열린 PR 하나)에서 그 PR의 알림(`systemMessage`)을 내고, 링크 경로의 `scripts/verify/web.ts`가 받을 수 없는 인자(`--config x`)에 종료 코드 1과 "받을 수 없는 인자"를 낸다(테스트). 두 파일은 새 함수 `isEntry`(새 파일 `scripts/lib/entry.ts`)로 판정한다.
5. `isEntry(moduleUrl, argv1)`는 두 경로를 실제 경로로 풀어 견준다: 같은 파일이면(절대 경로, 링크를 거친 경로, 현재 폴더 기준 상대 경로) 참이고, 다른 파일이거나 `argv1`이 `undefined`·빈 문자열이거나 풀 수 없는 경로(없는 파일)면 거짓이다. `argv1`에는 기본값이 없다: 호출자가 `process.argv[1]`을 넘기고, `undefined`를 넘기면 `moduleUrl`이 지금 실행 중인 파일이어도 거짓이다(테스트).
6. 기존 동작이 그대로다: `scripts/test/guard.test.ts`(import 줄 하나만 바꾼다), `session-hook.test.ts`, `selftest.test.ts`(진입 파일의 `process.exit(2)`는 두 곳 그대로다), `profile-web-db.test.ts`가 단언을 고치지 않고 통과하고, `node scripts/harness.ts self-test`가 통과한다.
7. 설계서 13.1절 "훅 구현 규칙"에 진입 파일 규칙(직접 실행 판정을 두지 않는다, 판정 모듈을 불러오지 못해도 종료 코드 2)이 적히고 같은 절의 "남는 위험"이 이에 맞는다. `docs/harness/architecture.md`의 진입점·모듈 설명이 맞다. `lab/`에 남는 같은 판정은 기술 부채 표의 새 행으로 남는다. `node scripts/harness.ts check`가 통과하고, 그 안의 `test-effect`가 새 링크 테스트(`scripts/test/entry-link.test.ts`)를 변경 전 코드에서 "단언 실패"로 판정한다(모듈 없음 같은 다른 이유의 실패가 아니다).

## 범위 / 비범위

범위:

- `scripts/lib/entry.ts`(새 파일): `isEntry`.
- `scripts/hooks/decide.ts`(새 파일): `scripts/hooks/guard.ts`의 진입(`main`) 밖 코드를 옮긴다. 규칙·메시지·export 이름은 그대로다.
- `scripts/hooks/guard.ts`: 실행 전용 진입 파일. 정적 import는 `node:` 모듈만 두고, 판정 모듈은 `try` 안에서 동적으로 불러와 불러오기 오류도 `catch`의 종료 코드 2로 막는다. `catch`는 메시지를 만들다 다시 던져도 `finally`에서 종료 코드 2로 끝난다. 파일 끝에서 조건 없이 실행한다.
- `scripts/hooks/session.ts`, `scripts/verify/web.ts`: 파일 끝의 직접 실행 판정을 `isEntry`로 바꾼다.
- 테스트: 새 파일 `scripts/test/entry.test.ts`, `scripts/test/entry-link.test.ts`, `scripts/test/guard.test.ts`의 import 줄 하나.
- 문서: 설계서 13.1절, `docs/harness/architecture.md`, 변경 조각, 기술 부채 표(새 행 하나).

비범위:

- `lab/`의 같은 판정(`q10-db/check-results.ts`·`run.ts`, `pilot-prep/check-results.ts`, `actions-cost/check-adr.ts`·`check-doc.ts`, `q20/report.ts`, `ops-transition/report.ts`). 이유: 훅·검증 같은 강제 장치가 아니라 실험 도구이고, `check`의 `test`가 그 테스트를 돌리지 않는다. 위험도 high 계획에 강제 장치가 아닌 일을 섞지 않는다(workflow.md 1절). 기술 부채 표에 남긴다.
- 훅 명령(`.claude/settings.json`, `.codex/hooks.json`)과 권한 프로필. 이유: 훅 명령의 경로는 그대로 두고 진입 파일 안에서 고친다.
- `node`를 찾지 못해 훅 프로세스가 뜨지 못하는 경우(13.1절 "남는 위험", TD-14). 이유: 진입 파일이 돌기 전의 일이다.
- 다른 `scripts/` 진입점(`scripts/harness.ts` 등). 이유: 직접 실행 판정이 없다(진입 파일로만 쓰인다). 착수 때 `scripts/`에서 `process.argv[1]`과 `import.meta.url`을 견주는 곳은 세 파일뿐이었다.

## 관련 파일·문서

- `scripts/lib/entry.ts`, `scripts/hooks/decide.ts`, `scripts/hooks/guard.ts`, `scripts/hooks/session.ts`, `scripts/verify/web.ts`
- `scripts/test/entry.test.ts`, `scripts/test/entry-link.test.ts`, `scripts/test/guard.test.ts`
- `docs/harness/design.md`, `docs/harness/architecture.md`, `docs/harness/changes/20261125-symlink-main-s0.md`, `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261125-symlink-main/**`
- 읽기만: `scripts/test/session-hook.test.ts`, `scripts/test/selftest.test.ts`, `scripts/test/verify-web.test.ts`, `scripts/test/profile-web-db.test.ts`, `scripts/test/helpers.ts`, `scripts/lib/github-fake.ts`, `lab/q10-db/verify-artifacts.ts`, `lab/q10-db/test/verify-artifacts.test.ts`, `.claude/settings.json`, `.codex/hooks.json`

## step 목록

- step0 entry: L1 훅 진입 파일에서 직접 실행 판정을 없애고(판정 코드는 `decide.ts`로), 판정 모듈을 불러오지 못해도 종료 코드 2로 막는다. 세션 훅과 `verify` 웹 구현은 실제 경로로 견주는 `isEntry`를 쓴다. 테스트 먼저.

## 진행 로그

- 2026-11-25 접수: 제작자가 대화에서 "다른 세션의 작업과 겹치지 않게 작업 가능한 것을 파악하고 진행"을 지시했다. 열린 Issue 가운데 선점(`claim/*`)이 없는 것은 #237과 #194였고, 규모가 작고 강제 장치에 닿는 #237을 먼저 맡았다. Issue 라벨은 small이지만 동작이 바뀌는 변경이라 medium으로 잡았다(workflow.md 1절).
- 2026-11-25 겹침 확인: 열린 PR 7개(#217, #226, #229, #241, #242, #244, #245)의 파일과 견줬다. 이 계획의 코드 파일과 겹치는 PR은 없다. PR #244(#243)가 `scripts/test/guard.test.ts`·`docs/harness/architecture.md`·기술 부채 표를, PR #242·#229가 architecture.md·기술 부채 표를, PR #241·#229가 설계서를 고친다. 이 계획은 guard.test.ts의 import 한 줄, architecture.md의 해당 줄, 기술 부채 표의 새 행 하나, 설계서 13.1절만 고친다.
- 2026-11-25 재현(이 worktree, macOS, 읽기만 했다): 같은 입력을 직접 경로와 링크(`mktemp -d` 안의 심볼릭 링크 → worktree) 경로로 넣었다.
  - `scripts/hooks/guard.ts`에 `git push --force origin main`: 직접 경로 종료 코드 2(`[R14 파괴적 git]`), 링크 경로 출력 없이 0.
  - `scripts/hooks/session.ts`에 Stop + 가짜 GitHub 상태(열린 PR #7, 충돌): 직접 경로는 알림을 냈고, 링크 경로는 출력 없이 0.
  - `scripts/verify/web.ts --config x`: 직접 경로 종료 코드 1("받을 수 없는 인자"), 링크 경로 출력 없이 0.
- 2026-11-25 계획만 담은 초안 PR #246을 열었다. 계획 검증을 기다리는 동안 step0을 로컬에서 구현했다(올리지 않았다). 새 링크 테스트는 변경 전 코드에서 다섯 개 모두 단언으로 실패했고(`test-effect`도 "base에서 단언 실패"), 구현 뒤 AC 명령이 통과했다(테스트 74개, `self-test` 시나리오 10개).
- 2026-11-25 계획 검증 1회차: Claude 승인(지적 없음), Codex 수정 요청(P1 셋). 셋 다 맞는 지적이라 계획을 고쳤다.
  - F1: `isEntry`의 `argv1`에 기본값(`process.argv[1]`)을 두면 `undefined`를 명시적으로 넘겨도 기본값으로 바뀌어, 지금 실행 중인 파일의 URL로는 "`argv1`이 없으면 거짓"이 지켜지지 않는다. → 기본값을 없애고 호출자가 `process.argv[1]`을 넘긴다. 테스트에 실행 중인 파일의 URL과 `undefined`를 넣었다(수용 기준 5).
  - F2: 진입 파일만 복사한 테스트는 모듈 없음만 본다. 모듈이 있는데 불러오다 실패하는 경우(문법 오류, `Error`가 아닌 값을 던짐, 판정 함수 없음)와 `catch` 안에서 다시 던지는 경우를 보지 않는다. → 대역 모듈로 그 경우들을 만들고, `catch`는 메시지 처리를 `try`/`finally`로 감싸 종료 코드 2에 늘 닿게 했다(수용 기준 3, step0 작업 1·4).
  - F3: step의 AC에 전체 `check`가 없고, 새 링크 테스트가 변경 전 코드에서 단언으로 실패했는지 확인하는 명령도 없다. → AC에 `check`와 `test-effect` 판정 줄 확인을 더했다(수용 기준 7).
- 2026-11-25 고친 계획에 맞춰 로컬 구현을 고쳤다: `isEntry`의 기본값을 없앴고, 진입 파일의 `catch`는 메시지를 만드는 함수(`failureMessage`)가 어떤 값에도 던지지 않고 `finally`에서 종료 코드 2로 끝난다. 불러오기 실패 테스트는 열 가지 경우(모듈 없음, 문법 오류, `Error`·`null`·문자열을 던짐, 판정 함수 없음, 설정 모듈이 던짐, 판정 함수가 던짐, `ConfigError`가 클래스가 아님, 글로 바꾸다 던지는 값)를 본다.
- 2026-11-25 계획 검증 2회차: Claude 승인(지적 없음), Codex는 F1~F3을 닫고 새 지적 하나(P1)를 냈다. 맞는 지적이라 계획을 고쳤다.
  - F4: 대역 테스트는 처음 불러올 때나 판정할 때 던지는 경우뿐이라 오류를 처리하는 중에 다시 던지는 경우가 없다. `finally`를 뺀 구현도 모든 대역 테스트를 통과하고, 그 상황에서는 종료 코드 1로 끝나 막지 않는다. → 대역이 `process.stderr.write`를 던지게 바꾼 뒤 던지는 경우를 더하고, 같은 경우를 `finally`를 뺀 진입 파일 사본으로 돌려 종료 코드가 2가 아님을 단언한다(수용 기준 3, step0 작업 1 (다)·(다-2)).
- 2026-11-25 계획 검증 3회차: Claude 승인(지적 없음), Codex는 F4를 닫고 새 지적 하나(P1)를 냈다. 맞는 지적이라 계획을 고쳤다.
  - F5: 대조 테스트는 바꾼 사본의 종료 코드가 2가 아니기만 하면 통과하므로, 바꾼 사본이 문법 오류로 오류 처리에 닿지 못해도(종료 코드 1) 통과한다. → 재던짐 대역이 stderr 쓰기를 부르면 표식 파일을 남기게 하고, 원본과 바꾼 사본 모두에서 표식과 신호 없는 종료를 먼저 확인한 뒤 종료 코드를 단언한다. 임시 폴더에서 세 꼴로 확인했다: 원본(표식 있음, 2), `finally`를 뺀 사본(표식 있음, 1), 문법 오류를 넣은 사본(표식 없음, 1).
- 2026-11-25 계획 검증 4회차(head `bfeafbe`): Claude·Codex 승인(지적 없음). 원장에 `계획 검증(G1): 해시 00c7ee833b61 · 승인: claude, codex`가 남았다. 로컬 구현(F4·F5의 테스트 포함)을 올린다.

## 의사결정 로그

- 결정: L1 훅 진입 파일(`guard.ts`)은 직접 실행을 판정하지 않고 늘 검사하며, 판정 코드는 `decide.ts`로 옮긴다 / 이유: L1 훅은 R20 등이 기대는 강제 장치라, "직접 실행인가"를 판정하는 길 자체를 없애야 판정이 틀려 조용히 0으로 끝나는 일이 없다. 실제 경로로 견주는 판정도 풀지 못하는 경로에서는 거짓이 된다 / 버린 대안: (가) `guard.ts`에서 `isEntry`로 견주기만 한다(판정이 남는다). (나) 훅 명령을 새 진입 파일로 바꾼다(`.claude/settings.json`·`.codex/hooks.json`과, 훅 명령의 경로를 확인하는 자체 테스트 시나리오 `mcp-guard`를 함께 고쳐야 한다. 자체 테스트 파일 수정은 main의 시나리오로 시험받으므로 PR을 나눠야 한다). (다) `import.meta.main`(Node 문서에서 초기 개발 단계이고, 엔진 하한 22.18에서 있는지 확인하지 않았다).
- 결정: 진입 파일이 판정 모듈을 동적으로 불러와 불러오기 오류도 `catch`에서 종료 코드 2로 막는다 / 이유: 파일 머리의 주석은 "내부 오류가 나도 종료 코드 2로 막는다"인데, 정적 import가 실패하면 그 `try`에 닿기 전에 Node가 종료 코드 1로 끝나 Claude Code가 막지 않는다. 진입 파일을 다시 짜는 김에 Issue가 함께 보라고 한 fail-closed를 불러오기 단계까지 넓힌다 / 버린 대안: 정적 import를 그대로 둔다(불러오기 오류에서 열린다).
- 결정: 세션 훅과 `verify` 웹 구현은 `isEntry`(실제 경로 비교)로 판정한다 / 이유: 두 파일은 테스트가 함수를 import하므로(`session-hook.test.ts`, `verify-*.test.ts`) 진입 파일을 나누려면 테스트 import를 여럿 고쳐야 한다. 세션 훅은 알림용(fail-open)이고 `verify`는 L1 같은 강제 장치가 아니다. `lab/q10-db/verify-artifacts.ts`의 `isMain`과 같은 방식이다 / 버린 대안: 세 파일 모두 진입 파일을 나눈다(변경이 커지고 테스트 import를 여럿 고친다).
- 결정: `isEntry`의 `argv1`은 기본값 없이 받는다(계획 검증 F1) / 이유: 기본값이 있으면 명시적 `undefined`가 기본값으로 바뀌어 "실행 경로가 없으면 거짓"을 함수의 계약으로 지킬 수 없다. 호출자가 넘기면 무엇을 견주는지 호출하는 줄에서 보인다 / 버린 대안: 인자를 생략할 때만 `process.argv[1]`을 쓴다(`arguments.length`로 가른다. 계약이 호출 형태에 따라 달라진다).

## 발견 사항

- L1 훅의 머리 주석은 "내부 오류가 나도 종료 코드 2로 막는다"였지만, 정적 import가 실패하는 오류(모듈 없음, 문법 오류)에서는 Node가 종료 코드 1로 끝나 막지 않았다. 이 step에서 진입 파일이 판정 모듈을 `try` 안에서 불러오게 고쳤다. → 처리: [설계서 13.1절 "진입 파일"](../../../harness/design.md)
- 테스트 도우미 `tmp()`(`scripts/test/helpers.ts`)와 자체 테스트의 샘플 리포는 임시 폴더를 `realpathSync`로 풀어 쓴다. 그래서 macOS의 `/var` 링크를 거치는 이 문제를 기존 테스트가 잡지 못했다. 새 링크 테스트는 임시 폴더를 풀지 않고 링크를 직접 만든다. → 처리: 해당 없음(새 테스트가 링크 경로를 직접 시험한다. 도우미가 경로를 푸는 것은 다른 테스트의 경로 비교에 필요하다)
- `lab/`의 스크립트 7개에 같은 직접 실행 판정이 남았다(비범위). → 처리: TD-70
- 최종 로컬 `check`에서 이 변경과 무관한 `scripts/test/wrapper-options.test.ts`의 시간 비율 테스트가 한 번 실패했다(입력 4배에 시간 10배, 상한 8배. 다른 대화 세션 둘이 함께 돌아 부하 평균이 16~17이었다). 같은 커밋을 다시 돌리자 통과했다. 분석기의 시간 보장을 지키는 테스트이고 다른 계획의 파일이라 격리하지 않았다. → 처리: TD-71

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령(새 테스트 두 파일과 기존 훅·세션·자체 테스트 파일, `self-test`, 진입 파일 글 확인, `test-effect` 판정 줄, `check`).
- 결과(2026-11-25, macOS, Node 22.23.3):
  - 변경 전 코드에서 새 링크 테스트가 모두 단언으로 실패했다. `test-effect`: `scripts/test/entry-link.test.ts: effective(base에서 단언 실패, 종료 코드 1)`. `entry.test.ts`와 import 줄만 바꾼 `guard.test.ts`는 새 모듈이 없어 "단언 실패 아님"으로 표시된다(`entry.test.ts`의 단언은 `isEntry`의 참·거짓 사례를 직접 본다).
  - AC의 `node --test` 여섯 파일 통과, `self-test` 시나리오 10개 통과, 진입 파일 글에 `import.meta.url`·`process.argv` 없음, `check` 통과. 최종 트리의 결과는 PR #246 본문의 "검증"에 적는다.
  - `check`의 doc-lint 경고(R8 검토 필요) 가운데 이 변경과 닿는 것은 ADR-0002(`related_code`에 `scripts/hooks/guard.ts`)다. ADR-0002의 내용(코어 훅은 `scripts/hooks/guard.ts` 하나이고 두 도구가 같은 stdin 규약과 종료 코드 2를 쓴다)은 그대로 맞아 고치지 않았다. 나머지 다섯은 이 변경 전부터 있던 경고다.

## 다음 할 일

- 완료 처리 뒤 구현을 올리고, `origin/main` 병합·`check`를 확인한 뒤 `pr-ready`로 제작자 승인을 요청한다(위험도 high).
