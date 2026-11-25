---
id: 20261123-change-fragments
issue: 222 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-23T06:34:31+09:00 # new-task가 채운다
---

# PR마다 설계서 버전·변경 이력·CHANGELOG를 고치지 않고 PR별 변경 조각 파일에 적는다 (TD-39)

## 목표와 수용 기준

보호 경로를 바꾼 PR은 `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 끝에 한 줄을 더한다(`harness-guard`가 CHANGELOG를 고쳤는지 본다). 설계서를 고친 PR은 머리말의 버전 줄과 변경 이력 끝에 한 줄을 더한다(`doc-lint`의 `R8 설계서 버전`이 둘을 견준다). 계획 둘을 병행하면 PR끼리 이 세 자리에서 충돌한다. 나중 PR은 `origin/main`을 병합하고 번호를 올려 다시 판정받는데, 그 PR이 제작자 승인을 기다리는 위험도 높음 PR이면 새 커밋 때문에 승인을 다시 받아야 한다(승인은 head에 묶인다. TD-39). 2026-11-22~23에 두 번 겪었다: #219와 #221이 같은 v0.7.79를, #214와 #221이 같은 v0.7.80을 썼다.

제작자가 고른 방향(2026-11-23 대화, Issue #222): PR은 변경 기록을 조각 파일에만 적는다. 버전 번호를 매겨 CHANGELOG와 설계서로 옮기는 일은 따로 여는 모으기 PR이 한다. 조각 파일은 PR(브랜치)마다 하나다(의사결정 로그 1).

수용 기준:

1. 변경 조각 파일의 자리는 `docs/harness/changes/<이름>.md`다. `<이름>`은 PR 브랜치 이름의 `/` 뒤와 같다(`<계획 id>-s<N>`, 소규모 계획은 `<계획 id>`). 형식은 첫 줄 `# 변경 조각: <이름>`, `## CHANGELOG`(한 줄 항목 하나 이상), 없어도 되는 `## 설계서 변경 이력`(한 줄 항목)이다. 항목은 버전으로 시작하지 않고 Markdown 링크를 넣지 않는다.
2. `doc-lint`는 조각 폴더의 Markdown 파일에 frontmatter와 색인 링크를 요구하지 않는다. 조각 폴더 아래의 모든 파일(확장자와 하위 폴더를 가리지 않는다)의 자리·이름·형식이 틀리면 `R8 변경 조각`으로 실패한다.
3. `harness-guard`(CHANGELOG): 보호 경로를 바꾼 PR이 CHANGELOG를 고치지 않아도, **그 PR 브랜치 이름의 조각**에 base에 없던 CHANGELOG 항목을 형식에 맞게 더했으면 통과한다. CHANGELOG를 고친 PR은 지금처럼 통과한다. 둘 다 아니면(형식이 틀린 조각, 자리 밖 파일, 다른 브랜치 이름의 조각, CHANGELOG 항목을 더하지 않은 조각 변경, 조각 삭제만, 브랜치를 모름) 지금처럼 실패하고 설명에 `CHANGELOG`가 있다. 검사를 약화하지 않는다.
4. `harness-guard`(설계서): 설계서(`docs/harness/design.md`)를 바꾼 PR은 변경 이력에 base의 항목(버전)을 모두 남긴 채 base의 마지막 버전보다 큰 항목을 더했거나(옛 방식, 모으기 PR) 그 PR 브랜치 이름의 조각에 base에 없던 설계서 변경 이력 항목을 더해야 통과한다. 아니면 실패한다(마지막 항목을 지우거나 고치기만 한 것은 기록이 아니다). 지금은 설계서 본문만 바꾸고 변경 이력을 남기지 않아도 막는 검사가 없다(Codex F4, F8).
5. 두 PR이 각자 조각 파일만 더하면 git 병합에서 서로 충돌하지 않는다. 모으기 PR이 조각을 지워도, 그 뒤에 열린 PR은 새 이름의 파일만 더하므로 충돌하지 않는다.
6. 모으기 명령 `node scripts/harness.ts changes-collect`는 조각을 이름 차례로 읽는다. CHANGELOG 항목은 "다음 버전 (미배포)" 절 끝으로 옮긴다. 설계서 변경 이력 항목마다 다음 패치 버전과 그날 날짜를 붙여 변경 이력 끝에 넣고 머리말을 맞춘다. 그리고 조각 파일을 지운다. 결과는 `doc-lint`를 통과한다.
   - 조각이 없으면 아무것도 바꾸지 않고 0으로 끝난다.
   - 조각 하나라도 형식이 틀리거나, 설계서·CHANGELOG를 읽지 못하거나, 조각 폴더·그 위 폴더·조각·두 기록 파일 가운데 심볼릭 링크나 일반 파일이 아닌 것이 있거나, 조각·두 기록 파일 가운데 하드 링크 수가 1이 아닌 것이 있거나, 조각·두 기록 파일 가운데 HEAD에 커밋되지 않은 파일(git이 무시하는 파일 포함)이 있거나, 두 기록 파일·조각 폴더에 커밋하지 않은 변경이 있으면 아무것도 바꾸지 않고 1로 끝난다. 경계(폴더가 심볼릭 링크가 아닌지)는 폴더 안을 읽기 전에 본다.
   - 쓰기·지우기 도중에 실패하면 1로 끝나고 되돌리는 명령을 출력한다. 되돌리기 전에 다시 실행하면 위 "커밋하지 않은 변경"으로 막혀, 항목이 두 번 옮겨지지 않는다.
   - git은 읽기 둘만 쓴다: HEAD에 커밋된 파일인지 보는 `git ls-tree`와 커밋하지 않은 변경을 보는 `git status`. 스테이징·커밋·되돌리기 같은 쓰기는 하지 않는다(Codex F10).
7. 설계서 머리말·변경 이력을 읽는 코드(`designVersionProblems`)를 `scripts/gates/doc-lint.ts`에서 `scripts/lib/design-version.ts`로 옮긴다. `doc-lint`의 `R8 설계서 버전` 결과는 그대로다(있던 테스트를 고치지 않고 통과한다). 게이트와 모으기가 같은 읽기 코드를 쓴다(Codex F5).
8. 문서와 템플릿: 절차서 5절(보호 경로 PR의 기록 규칙, 설계서 버전 규칙, 모으기 PR 절차), 설계서(7.2절 트리, R9 행, `harness-guard` 행, 10.4절의 `harness-guard` 설명), CHANGELOG 머리 문장, PR 템플릿의 보호 경로 체크 줄, README, 하네스 코드 구조 문서를 새 규칙에 맞춘다.
9. 기술 부채 표: TD-39를 해결로 닫는다. 같은 종류의 충돌(새 TD 행 번호)과 이 계획을 이어받으며 찾은 일(진행 로그 2026-11-23 12:23)은 새 행으로 남긴다.
10. step1 PR은 CHANGELOG와 설계서를 고치지 않고 자기 조각 파일로만 기록한다. 그 PR이 `harness-guard`를 통과하는 것으로 새 방식이 실제로 통과함을 보인다.

## 범위 / 비범위

범위:

- 조각 읽기와 모으기: 새 파일 `scripts/lib/changes.ts`, 새 파일 `scripts/commands/changes.ts`, `scripts/harness.ts`의 명령 하나.
- 설계서 버전 읽기: 새 파일 `scripts/lib/design-version.ts`(`scripts/gates/doc-lint.ts`에서 옮긴다).
- 게이트: `scripts/gates/doc-lint.ts`, `scripts/gates/harness-guard.ts`, 브랜치 이름을 넘기는 `scripts/ci/gates.ts`.
- 테스트: 새 파일 `scripts/test/changes.test.ts`·`scripts/test/changes-collect.test.ts`, `scripts/test/harness-guard.test.ts`에 테스트 추가.
- 수용 기준 8의 문서·템플릿, 기술 부채 표, step1의 조각 파일.

비범위:

- 모으기 PR을 자동으로 열기(runner, `start`, CI). 제작자 지시로 연다(의사결정 로그 9).
- 첫 모으기. 이 계획이 끝난 뒤 제작자 지시로 연다.
- 기술 부채 표의 새 행 번호 충돌을 고치는 일. 새 TD 행으로 남긴다(의사결정 로그 6).
- runner 충돌 해결 안내(`scripts/runner/prompt.ts`)와 계획 템플릿(`docs/exec-plans/TEMPLATE*.md`) 수정(의사결정 로그 7, 8).
- 이미 CHANGELOG와 설계서 변경 이력에 있는 항목의 정리.
- `harness.config.json`. 조각 폴더는 이미 보호 경로(`docs/harness/**`) 안이고 `test` 건너뛰기 대상이 아니다.
- revert와 모으기의 관계: 이미 모은 조각의 PR을 revert하면 그 CHANGELOG 항목은 남는다. revert PR이 CHANGELOG를 고치게 하는 일은 다루지 않는다.

## 관련 파일·문서

- `scripts/lib/changes.ts`
- `scripts/lib/design-version.ts`
- `scripts/commands/changes.ts`
- `scripts/harness.ts`
- `scripts/gates/doc-lint.ts`
- `scripts/gates/harness-guard.ts`
- `scripts/ci/gates.ts`
- `scripts/test/changes.test.ts`
- `scripts/test/changes-collect.test.ts`
- `scripts/test/harness-guard.test.ts`
- `scripts/test/metrics-allow.ts`
- `scripts/test/metrics-command.test.ts`
- `docs/harness/changes/`
- `docs/harness/workflow.md`
- `docs/harness/design.md`
- `docs/harness/CHANGELOG.md`
- `docs/harness/architecture.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `.github/pull_request_template.md`
- `README.md`
- 읽기만: `scripts/runner/prompt.ts`, `scripts/runner/next.ts`, `scripts/commands/task.ts`, `docs/exec-plans/TEMPLATE*.md`, `scripts/lib/util.ts`, `scripts/test/helpers.ts`, `scripts/test/doc-lint-design-version.test.ts`

## step 목록

- step0 fragments: 조각 파일의 자리·형식(`scripts/lib/changes.ts`)을 정하고, 설계서 버전 읽기를 `scripts/lib/design-version.ts`로 옮기고, `doc-lint`·`harness-guard`가 조각을 받게 한다(설계서 기록 요구 포함). 규칙 문서를 바꾼다. 이 PR은 main의 `harness-guard`로 판정되므로 옛 방식(CHANGELOG, 설계서 버전)으로 기록한다.
- step1 collect: 모으기 명령 `changes-collect`와 모으기 PR 절차를 더하고 TD-39를 닫는다. 이 PR은 자기 조각 파일로만 기록한다.

## 진행 로그

- 2026-11-23 06:48 작업 공간을 만들고 step0 초안(조각 파일 형식, doc-lint, harness-guard)을 짜 봤다. 계획은 아직 쓰지 않았다. 제작자 지시로 세션을 끝내며 초안을 `draft-step0.patch`로, 인수인계를 `handoff.md`로 이 폴더에 남겼다.
- 2026-11-23 12:23 다른 PC의 세션이 이어받았다. 이 PC에는 이 브랜치의 worktree가 없어서 `start`가 "할 일 없음"을 냈다(`scripts/runner/next.ts`의 `readLocalPlans`는 로컬 worktree의 계획만 본다). `new-task --issue 222`는 이미 있는 `claim/222` 때문에 쓸 수 없어, `git worktree add --track -b feat/20261123-change-fragments-s0 <경로> origin/feat/20261123-change-fragments-s0`로 만들고 `setup`을 돌렸다. `origin/main`(e9f7ad6)을 병합했다. 조각 단위를 제작자에게 물어 step(PR)별로 정했다(의사결정 로그 1). 계획을 쓰고 `handoff.md`·`draft-step0.patch`를 지웠다. 초안 패치는 커밋 5059e42에 남아 있다(`git show 5059e42:docs/exec-plans/active/20261123-change-fragments/draft-step0.patch`). 머신을 옮겨 이어 가는 절차가 없는 것은 step1에서 TD 행으로 남긴다.
- 2026-11-23 12:48 계획만 담은 커밋(ab2bf5d)으로 초안 PR #227을 열었다. 계획 검증 1회차: review/claude 승인(지적 없음), review/codex 수정 요청(P0 1, P1 5: F1~F6). 여섯 건 모두 받아들여 계획을 고쳤다(의사결정 로그 11~14, 수용 기준 2·3·4·6·7). F1 모으기의 심볼릭 링크 경계, F2 `.md`가 아닌 조각 자리 파일, F3 다른 브랜치의 조각, F4 설계서 기록 누락, F5 `lib/`가 `gates/`를 가져옴, F6 모으기 중간 실패 뒤 재실행.
- 2026-11-23 12:53 계획 검증 2회차(73ddca8): review/claude 승인, review/codex 수정 요청. F2~F6은 해결로 닫혔다. 남은 F1(경계 확인이 폴더가 비었는지 본 뒤였다), 새 F7(P0, git이 무시하는 조각은 되돌리기로 살릴 수 없다), 새 F8(P1, 마지막 이력 항목을 지워도 옛 방식 기록으로 셌다)을 받아들여 고쳤다(의사결정 로그 12·14, 수용 기준 4·6). 그동안 step0 구현을 로컬에서 준비했다(커밋하지 않았다).
- 2026-11-23 13:01 계획 검증 3회차(7209df2): review/claude 승인, review/codex 수정 요청. F1·F7·F8은 해결로 닫혔다. 새 F9(P0, 기록 파일이 작업 트리 밖 파일과 하드 링크로 이어지면 바깥 파일을 덮어쓴다)와 F10(P1, 수용 기준 6이 `git status`만 허용해 step1의 `git ls-tree`와 어긋났다)을 받아들여 고쳤다(의사결정 로그 14, 수용 기준 6). 로컬 구현에는 F8 판정(`compareVersions`로 버전 비교)과 테스트 (e)(f)를 더했다.
- 2026-11-23 13:10 계획 검증 4회차(3fe6c4c): review/claude·review/codex 모두 승인, `review-ledger` 차단 지적 없음(전체 10). step0 테스트만 커밋했다(2ba5b16). 이 커밋을 새로 클론해 구현 없이 돌리면 새 테스트 9건(`changes.test.ts` 5건, `harness-guard.test.ts` 4건)이 모두 실패하고 있던 16건은 통과했다(1건은 이 환경에서 건너뜀). 이어서 구현과 문서(절차서 5절 "변경 조각", 설계서 v0.7.82, CHANGELOG, PR 템플릿, README, 코드 구조 문서)를 더했다.
- 2026-11-23 16:28 push 전 `check`의 `test`가 이 PC에서 두 번 1800초 시간 제한에 걸렸다(실패한 테스트 없음, Issue #230. 제작자가 프로그램을 정리한 뒤 세 번째를 돌렸다). 세 번째는 1520초에 끝났고 실패 셋이 나왔다. 둘은 Windows 전용 `EPERM`(`next.test.ts`, `scope.test.ts`)으로 main의 #231이 고쳤다. 하나는 이 step의 회귀다: `metrics-command.test.ts`가 지표 명령이 띄우는 git 명령을 허용 목록(`scripts/test/metrics-allow.ts`의 `GIT_READ_SHAPES`)으로 막는데, `doc-lint`에 더한 변경 조각 목록 읽기(`git ls-files … -- docs/harness/changes`)가 그 목록에 없다(지표 명령이 `docLint`를 부른다). 허용 목록과 호출 순서 테스트를 넓혀야 하고, 이 두 파일이 계획의 관련 파일과 step0 AC에 없어 계획을 고쳐 다시 검증받는다(의사결정 로그 15). step0을 `in_progress`로 되돌렸다. 코드는 올리지 않았으므로 되돌리는 커밋으로 PR의 변경을 계획만 남겨 검증받고, 승인 뒤 되돌림을 되돌린다(절차서 2절 "계획 검증").
- 2026-11-23 16:41 계획 검증 5회차(a24ea7b, 해시 2b971fcd9454): review/claude 승인, review/codex 승인(P2 1), `review-ledger` 차단 지적 없음(전체 11, 미룸 1). P2는 "범위 절의 테스트 목록에 지표 테스트 변경이 빠졌다"이다. 관련 파일과 step0의 작업·AC에는 들어 있고, 범위 절은 승인에 묶여 고치면 다시 검증받아야 해서 고치지 않았다. 되돌림을 되돌려(774de39, 트리가 d0f03b3과 같다) 코드를 다시 올리고 `origin/main`(54631b7, #231: Windows `EPERM` 테스트 2건, test 시간 제한 3600초)을 충돌 없이 병합했다.
- 2026-11-23 17:40 판정(f463846): review/claude 승인, review/codex 수정 요청(P1 2). F12: 조각 항목의 풀 수 없는 링크 글(`[x](%ZZ)`)이 일반 링크 검사의 `decodeURIComponent`에서 예외를 내 `R8 변경 조각` 진단 전에 `doc-lint`가 멈춘다. F13: PR 브랜치의 조각 자리에 심볼릭 링크를 커밋하면 `harness-guard`가 링크 대상의 글을 기록으로 센다. 고침: `doc-lint`는 조각 폴더의 파일을 일반 링크 검사에서 빼고(조각 형식 검사가 링크를 막는다), 일반 파일이 아닌 조각을 `R8 변경 조각`으로 잡는다. `harness-guard`는 조각과 설계서를 커밋의 일반 파일(모드 100644·100755)일 때만 읽는다(의사결정 로그 16). 테스트 2개에 경우를 더했다(줄을 지우지 않았다). f463846의 클론에 새 테스트만 얹으면 `doc-lint` 테스트가 `URIError`로, `harness-guard` 조각 테스트가 링크 경우에서 실패하는 것을 확인했다. 단계를 진행 중으로 되돌리고 다시 완료 처리한다.
- 2026-11-23 19:10 판정(7e74a4f, `origin/main` c2cb9ff 병합 뒤): review/claude 승인, review/codex 수정 요청(P1 1). F12·F13은 닫혔다. F14: 색인에 남은 조각의 상위 폴더가 작업 트리에서 순환 링크면 F13 고침에서 넣은 `lstatSync`가 `ELOOP`를 던져 `R8 변경 조각` 진단 전에 `doc-lint`가 멈춘다(고치기 전의 `existsSync`는 예외를 내지 않았다. 내가 만든 회귀다). 고침: 조각 자리의 종류를 예외 없이 보는 함수(`fragmentEntry`)로 목록 거르기와 일반 파일 검사를 함께 하고, 풀 수 없는 경로는 일반 파일이 아닌 것으로 잡는다. `changes.test.ts`의 `doc-lint` 테스트에 자기 자신으로 가는 상위 폴더 링크 경우를 더했다. 이 PC(Windows, 개발자 모드·WSL 없음)는 링크를 만들 수 없어(`EPERM`) 그 경우를 건너뛴다. 순환 junction과 폴더 권한 막기로도 `lstat`이 예외를 내지 않아 이 PC에서는 고치기 전 코드의 실패를 재현하지 못했다. 그 경우는 CI(Linux)의 `check`에서 돈다.
- 2026-11-25 step1 시작: step0이 병합된 뒤(#227) step1이 멈춰 있었다(선점 `claim/222`는 2026-11-23 18:13 뒤로 갱신되지 않아 만료). 제작자가 대화에서 이어 가라고 지시해(2026-11-24) 작업자 `mac-session`이 `new-task --plan 20261123-change-fragments --step 1`로 브랜치와 worktree를 만들었다(main `a06b7fd`). frontmatter의 `owner`는 그대로 둔다(TD-23).
- 2026-11-25 step1 테스트 먼저: `scripts/test/changes-collect.test.ts`(테스트 9건)를 썼다. `collectFragments`와 `runChangesCollect`는 동적으로 가져오고 결과를 값으로 받아 단언한다. 이 변경 전의 코드에서 돌려 9건 모두 단언 실패(`ERR_ASSERTION`)로 끝나는 것을 봤다(1~4: `collectFragments 없음`, 5~7: 모르는 명령, 8·9: `runChangesCollect 없음`). 테스트만 먼저 커밋한다.
- 2026-11-25 step1 구현: `scripts/lib/changes.ts`에 `collectFragments`(설계서는 `design-version.ts`로 읽는다. `scripts/gates/`를 가져오지 않는다), 새 파일 `scripts/commands/changes.ts`의 `runChangesCollect`(폴더 경계 → 빈 폴더 → 파일 경계 → `git ls-tree` → `git status` → 읽기·계산 → 쓰기·지우기 차례), `scripts/harness.ts`의 `changes-collect` 분기와 `HELP` 한 줄. `changes-collect.test.ts` 9건 통과(macOS라 링크 경우를 건너뛰지 않았다). 문서: 절차서 5절 "모으기 PR", 하네스 코드 구조 문서, 기술 부채 표(TD-39 해결, 새 TD-72·TD-73. 번호는 의사결정 로그 17), 이 PR의 조각 `docs/harness/changes/20261123-change-fragments-s1.md`.
- 2026-11-25T11:04:54+09:00 step1 재작업: 구현 판정 1회차(head 002d689): Claude 승인(지적 없음), Codex 수정 요청(P0 1, P1 3). F1(P0): assume-unchanged·skip-worktree로 표시된 조각의 커밋하지 않은 수정을 git status가 보이지 않아 지울 수 있다. F2: docs가 링크여도 docs/harness를 lstat한다. F3: 머리말 설명 안의 앞선 최종 갱신 날짜를 바꾼다. F4: 패치 번호를 Number로 올려 안전 정수를 넘으면 같은 값이 된다. 모두 맞는 지적이다. 테스트를 먼저 더하고 고친다
- 2026-11-25 그 사이 `origin/main`(`e183ae7`, #236)을 병합했다. 기술 부채 표의 같은 자리(TD-69 뒤)에 main이 TD-70·71을 더해 충돌했고, 번호는 겹치지 않아 main 쪽 행 뒤에 이 PR의 TD-72·73을 두었다.
- 2026-11-25 F1~F4 테스트 먼저(테스트 수는 9건 그대로, AC): 3번 테스트에 머리말 설명 안의 앞선 `최종 갱신:`(F3)과 패치 번호 `9007199254740992`(F4)를, 7번에 `assume-unchanged`로 숨긴 조각 수정과 `skip-worktree`로 숨긴 CHANGELOG 수정(F1, 수정본이 그대로 남는지)을, 8번에 `docs`가 링크이고 링크 너머의 `harness`가 파일일 때 `docs/harness` 문제가 출력되지 않는지(F2)를 더했다. 고치기 전에 3·7·8번이 실패했다(F1은 숨긴 수정본을 실제로 모아 지웠다).
- 2026-11-25 F1~F4 고침: F3 머리말은 줄 머리의 버전과 줄 끝의 최종 갱신만 바꾼다. F4 패치 번호를 `BigInt`로 올린다. F2 폴더 경계는 위 폴더부터 보고 실제 폴더가 아니면 그 자리에서 1로 끝난다. F1 `git ls-tree`를 `--name-only` 없이 불러 blob id를 받고, 각 파일의 바이트로 git blob id(SHA-1·SHA-256)를 계산해 견준다(CRLF로 꺼낸 작업 트리는 LF로 바꾼 바이트도 견준다). 다르면 문제로 내고, 이때는 되돌리는 명령을 권하지 않는다(숨긴 수정이 사라진다). 9건 통과, `tsc` 통과. 절차서 5절과 코드 구조 문서에 한 마디씩 더했다.
- 2026-11-25T12:43:49+09:00 step1 재작업: 구현 판정 2회차(head 1cc9043): Claude 승인(지적 없음), Codex 수정 요청(P1 하나. F2·F3·F4는 고쳐졌다고 적었다). F1(P0)이 다시 열렸다: CRLF를 LF로 바꾼 바이트도 견주는 탓에 LF를 강제하는 리포에서 줄 끝만 CRLF로 바꾸고 숨긴 수정이 통과한다. F5: 8번 테스트가 mv 실행 파일에 기대 Windows 네이티브에서 깨질 수 있다. 둘 다 맞는 지적이다. 테스트를 먼저 더하고 고친다
- 2026-11-25 F1 2회차·F5 테스트 먼저: 7번 테스트에 줄 끝만 CRLF로 바꾸고 `assume-unchanged`로 숨긴 조각 수정(g)을 더했고, 8번의 `mv` 호출을 `node:fs`의 `renameSync`(같은 임시 폴더 안)로 바꿨다. 고치기 전에 (g)가 실패했다(숨긴 CRLF 수정본을 모아 지웠다).
- 2026-11-25 F1 2회차 고침: 파일 바이트를 HEAD의 blob과 바이트 그대로만 견준다(CRLF를 LF로 바꿔 보는 것을 뺐다). 이 리포는 `.gitattributes`(`* text=auto eol=lf`)로 작업 트리를 LF로 두어 같은 파일이면 바이트가 같다. 줄 끝을 바꿔 꺼내는 체크아웃에서는 다르다고 보아 모으지 않는다(막는 쪽). 문제 글에 "줄 끝 포함 바이트로 견준다"를 더했다. 9건 통과, `tsc` 통과.

## 의사결정 로그

1. 결정: 조각 파일은 PR(브랜치)마다 하나다(`<계획 id>-s<N>.md`, 소규모 계획은 `<계획 id>.md`). / 이유: 계획마다 하나로 하면, 모으기 PR이 계획 X의 조각을 지우는 사이 X의 다음 step PR이 같은 파일에 줄을 더하고 있을 때 그 step PR이 modify/delete로 충돌한다. PR마다 새 파일만 더하면 다른 PR과도 모으기 PR과도 충돌하지 않는다. 제작자가 골랐다(2026-11-23 대화. Issue 본문의 "계획 하나에 파일 하나"를 바꾼다). / 버린 대안: 계획별 파일(Issue 문구 그대로, 충돌은 모으기 시점으로 피한다), 계획별 파일이되 `completed/`로 옮겨진 계획의 조각만 모으기(진행 중인 계획의 기록이 계획이 끝날 때까지 옮겨지지 않고, 모으기가 계획 상태를 읽어야 한다).
2. 결정: `harness-guard`는 CHANGELOG를 직접 고친 PR도 계속 통과시킨다. / 이유: 모으기 PR은 CHANGELOG를 고치고, 이 규칙 전에 쓴 계획은 AC가 CHANGELOG의 줄을 본다. 기록을 받는 길을 하나 더할 뿐 기록이 없는 PR은 지금처럼 실패하므로 약화가 아니다. / 버린 대안: CHANGELOG 직접 수정을 막기(모으기 PR과 진행 중인 계획이 막힌다).
3. 결정: step0 PR은 옛 방식(CHANGELOG 한 줄, 설계서 버전·변경 이력)으로 기록하고 step1부터 조각으로 기록한다. / 이유: `harness-guard`는 main의 정의로 돈다. step0 PR을 판정하는 main은 조각을 모른다.
4. 결정: 설계서 변경 이력 항목 하나가 버전 하나다(마지막 버전의 패치 번호 + 1, 날짜는 모으는 날). CHANGELOG 항목은 글을 바꾸지 않고 옮긴다("설계서 vX" 앞머리를 붙이지 않는다). / 이유: 지금의 형식(`  - v<버전> (<날짜>): 내용`)과 `R8 설계서 버전` 검사를 그대로 쓴다. CHANGELOG에 앞머리를 붙이면 조각 형식과 모으기 규칙이 늘어난다. 지금도 앞머리 없는 항목이 섞여 있다. / 버린 대안: 조각 하나를 버전 하나로 합치기, CHANGELOG 항목에 설계서 버전 붙이기.
5. 결정: 조각 항목은 버전으로 시작하지 않고 Markdown 링크(`](`)를 넣지 않는다. / 이유: 버전은 모으기가 매긴다. 링크는 상대 경로라 `docs/harness/changes/`에서 `docs/harness/`로 옮기면 깨진다(지금 CHANGELOG와 변경 이력에는 링크가 하나도 없다).
6. 결정: 기술 부채 표의 새 행 번호 충돌(같은 종류)은 이 계획에서 고치지 않고 새 TD 행으로 남긴다. / 이유: TD 번호는 같은 PR 안에서 코드 주석(`harness-quarantine: TD-N`), 계획의 발견 사항, 다른 문서가 바로 가리킨다. 모으기 때까지 번호를 미룰 수 없다. 겹치는 것은 TD 행을 더하는 PR끼리뿐이라 버전·CHANGELOG보다 드물다. / 버린 대안: 계획 id를 넣은 번호(`TD-<계획 id>-N`). 번호를 읽는 격리 주석 검사와 기존 참조 규칙을 함께 바꿔야 한다.
7. 결정: runner의 충돌 해결 안내(`scripts/runner/prompt.ts`의 `conflictPrompt`)는 고치지 않는다. Issue의 "할 일"과 다르다. / 이유: 조각 파일은 PR마다 새 파일이라 충돌하지 않는다. 안내가 다루는 자리(설계서 버전·이력, CHANGELOG, TD 번호)는 옛 방식 PR, 모으기 PR, TD 행에서 그대로 생기고 "main 쪽을 먼저 두고 다음 번호로 옮긴다"는 그 경우에 맞다. 충돌한 줄을 조각으로 옮기라고 바꾸면 CHANGELOG의 줄을 AC로 보는 옛 계획의 PR이 AC에서 실패한다.
8. 결정: 계획 템플릿(`docs/exec-plans/TEMPLATE*.md`)은 고치지 않는다. 바꿀 템플릿은 PR 템플릿(`.github/pull_request_template.md`)의 보호 경로 체크 줄이다. / 이유: 계획 템플릿 셋에는 CHANGELOG·설계서 버전 언급이 없다(확인함).
9. 결정: 모으기 PR은 제작자가 지시할 때 연다(대화나 Issue → 소규모 계획 → `changes-collect`). runner·`start`·CI가 스스로 열지 않는다. / 이유: 모으기 PR은 보호 경로를 바꿔 운영 단계에서 제작자 승인이 필요하다. 승인 요청이 제작자 모르게 늘지 않게 한다. / 버린 대안: 조각 수를 세어 `start`가 알리거나 runner가 자동으로 열기.
10. 결정: 모으기 계산은 `scripts/lib/changes.ts`의 순수 함수(`collectFragments`)에, 파일 읽기·쓰기·지우기는 `scripts/commands/changes.ts`에 둔다. `scripts/harness.ts`에는 명령 분기 하나와 도움말 한 줄만 더한다. / 이유: 계산을 파일 없이 시험한다. 다른 계획의 PR(#217)이 `scripts/harness.ts`를 고치므로 겹치는 면을 줄인다.
11. 결정: `harness-guard`는 PR 브랜치 이름의 `/` 뒤와 같은 이름의 조각만 기록으로 센다. 판정 함수가 브랜치를 받고(`scripts/ci/gates.ts`가 넘긴다), 브랜치를 모르면 조각을 세지 않는다. / 이유: 다른 PR의 조각에 줄을 더해도 기록으로 세면, 그 조각을 지우는 모으기 PR과 modify/delete로 충돌한다(Codex F3). 처음에는 판정 함수가 브랜치를 받지 않는다는 이유로 견주지 않기로 했으나, 판정 job은 브랜치를 이미 알고 있다(`runGates`의 `branch`). / 버린 대안: 이름을 견주지 않기(처음 안).
12. 결정: 설계서를 바꾼 PR에 설계서 기록을 요구하는 검사를 `harness-guard`에 더한다(수용 기준 4). 옛 방식 기록은 "base의 변경 이력 항목 버전이 head에 모두 있고, head의 마지막 버전이 base의 마지막 버전보다 크다"로 본다. 처음에는 "마지막 항목 줄이 base와 다르다"로 했으나, 마지막 항목을 지우고 머리말을 앞 항목에 맞추면 새 기록 없이 통과했다(Codex F8). 버전으로 보므로 옛 항목의 글을 고치는 것은 막지 않는다. / 이유: 조각에서 `## 설계서 변경 이력`은 없어도 되는 섹션이라, 검사가 없으면 설계서를 고치고도 이력이 빠지기 쉽다. `R8 설계서 버전`은 머리말과 마지막 항목만 견주므로 이 누락을 보지 못한다(Codex F4. 지금도 같은 틈이 있다). 모으기 PR은 마지막 항목을 바꾸므로 통과한다. / 버린 대안: 문서에 "검사 없음"으로 적고 TD로 남기기.
13. 결정: 설계서 머리말·변경 이력을 읽는 코드를 `scripts/lib/design-version.ts`로 옮기고 `doc-lint`는 그것을 쓴다(`designVersionProblems`를 다시 내보내 있던 테스트의 가져오기를 그대로 둔다). / 이유: `lib/`의 모으기 계산과 `gates/harness-guard`가 같은 읽기 규칙을 써야 한다. `lib/`가 `gates/`를 가져오지 않는다(Codex F5). 옮기기만 하고 규칙은 바꾸지 않는다.
14. 결정: 모으기 명령은 바꾸기 전에 (1) 조각 폴더와 그 위 폴더(`docs`, `docs/harness`)가 심볼릭 링크가 아닌 실제 폴더인지를 폴더 안을 읽기 전에 보고, 조각과 두 기록 파일이 심볼릭 링크가 아닌 일반 파일이고 하드 링크 수(`nlink`)가 1인지(`lstat`) 본다. (2) 조각과 두 기록 파일이 모두 HEAD에 커밋된 파일인지(`git ls-tree -r --name-only -z HEAD -- <셋>`) 본다. (3) 두 기록 파일과 조각 폴더에 커밋하지 않은 변경이 없는지(`git status --porcelain --untracked-files=all`) 본다. 쓰기·지우기 도중 실패하면 되돌리는 명령(`git restore --source=HEAD --staged --worktree -- <셋>`)을 출력한다. / 이유: 링크를 따라가면 작업 트리 밖 파일을 옮기고 지울 수 있다(Codex F1. 폴더가 비었는지 먼저 보면 빈 바깥 폴더로 가는 링크를 검사 없이 지나친다). 하드 링크도 같다: 기록 파일이 작업 트리 밖 파일과 하드 링크로 이어져 있으면 그 파일에 쓰는 것이 바깥 파일을 바꾼다(Codex F9). git이 만든 파일의 링크 수는 1이므로 1이 아니면 막는다. 기록 파일을 쓴 뒤 조각을 지우다 실패하고 다시 실행하면 같은 항목이 두 번 옮겨지고 설계서 버전이 한 번 더 매겨진다(Codex F6). (3)이 그 재실행을 막고, 되돌린 뒤에는 처음부터 다시 모은다. (3)은 git이 무시하는 파일을 보지 못하므로, 무시된 조각을 지우면 되돌리기로 살릴 수 없다. (2)가 그 경우를 막는다(Codex F7). / 버린 대안: 임시 파일과 이름 바꾸기로 쓰기를 원자적으로 하기(파일 셋 이상을 한꺼번에 원자적으로 바꿀 수 없어 중간 실패는 그대로 남는다), 이미 옮긴 항목을 글로 찾아 건너뛰기(같은 글의 항목을 구별하지 못한다).
15. 결정: `doc-lint`의 변경 조각 목록 읽기(`git ls-files -z --cached --others --exclude-standard -- docs/harness/changes`)를 지표 명령의 git 허용 목록(`scripts/test/metrics-allow.ts`의 `GIT_READ_SHAPES`)에 더하고, `scripts/test/metrics-command.test.ts`의 자식 프로세스 테스트(허용 목록의 git 넷 → 다섯, 호출 차례)를 맞춘다. / 이유: 지표 명령은 "검토 필요" 경고 수를 세려고 `docLint`를 부르고, 그 테스트는 허용 목록 밖의 git 명령을 막는다. 허용 목록 머리 주석이 "읽기 명령을 더하면 여기에 꼴을 더하고 호출 단언도 함께 넓힌다"고 정한다. 더하는 것은 읽기 하나다. / 버린 대안: 파일 시스템으로 폴더를 읽기(git이 무시하는 파일, 예를 들어 macOS의 `.DS_Store`까지 조각 자리 오류로 잡는다), 폴더가 없으면 git을 부르지 않기(테스트 고정물에만 맞춘 것이라, 조각이 있는 실제 리포에서는 허용 목록 밖의 읽기가 그대로 돈다), 지표 명령이 부를 때 조각 검사를 끄는 옵션(`docLint`와 `scripts/metrics/local.ts`의 인자를 함께 바꿔야 한다).
16. 결정: 조각은 일반 파일만 받는다. `doc-lint`는 조각 자리의 심볼릭 링크를 `R8 변경 조각` 문제로 내고 따라가 읽지 않는다. `harness-guard`는 커밋 트리에서 모드가 일반 파일(100644·100755)인 조각·설계서만 읽는다. 조각 폴더의 파일은 일반 링크 검사에서 뺀다. / 이유: 링크를 따라가면 리포의 다른 파일(예: 다른 PR의 조각)의 글로 기록 요구를 채운다(Codex F13). 조각 항목은 Markdown 링크를 받지 않으므로(의사결정 로그 5) 일반 링크 검사가 볼 것이 없고, 그 검사가 풀 수 없는 링크 글에서 예외를 내면 조각 진단이 가려진다(Codex F12). / 버린 대안: 일반 링크 검사의 `decodeURIComponent` 예외를 잡기(조각 밖 문서의 동작까지 바뀐다), 링크 대상이 조각 폴더 안이면 받기(모으기 PR이 대상을 지우면 깨진다). 상위 경로를 풀 수 없는 조각 자리(순환 링크의 `ELOOP` 등)도 예외로 멈추지 않고 일반 파일이 아닌 것으로 잡는다(Codex F14).
17. 결정(step1 구현, 2026-11-25): 새 기술 부채 행의 번호를 TD-72·TD-73으로 한다. step1 "작업" 6은 "push 직전의 `origin/main` 기준 다음 번호"(TD-70·71)라고 적었다. / 이유: 열린 PR #229가 같은 표에 TD-70·71을 이미 더했다. 그대로 쓰면 바로 새 행 A의 충돌이 나고, 두 PR 모두 제작자 승인을 기다리는 위험도 높음 PR이라 나중 PR의 번호 변경이 승인을 철회시킨다. 번호를 비워 두는 것은 표의 뜻을 바꾸지 않는다. / 버린 대안: TD-70·71을 쓰고 나중에 병합되는 쪽이 옮긴다(지금의 방식. 이미 알고 있는 충돌을 만든다).
18. 결정(step1 구현): 모으기 명령은 문제를 모두 표준 출력에 `changes-collect: ` 줄로 내고, 커밋 확인·상태 확인(4·5)에서 문제가 났을 때와 쓰기·지우기가 도중에 실패했을 때만 되돌리는 명령을 낸다. 되돌리는 명령은 줄 끝에 홀로 둔다(복사해 쓰기 쉽게). 쓰기는 바뀐 파일만 한다(설계서 항목이 없으면 설계서를 쓰지 않는다). / 이유: 형식 문제나 링크 문제에는 되돌릴 것이 없고, 되돌리기를 권하면 커밋하지 않은 남의 작업을 지우게 할 수 있다.
19. 결정(구현 판정 F1 뒤): 숨긴 수정은 새 git 명령 없이 잡는다. step1 "작업" 4는 `git ls-tree -r --name-only -z HEAD -- …`라고 적었는데, `--name-only`를 빼고 같은 명령으로 blob id까지 받아 파일 바이트에서 계산한 blob id와 견준다. git은 여전히 읽기 둘(`git ls-tree`, `git status`)만 쓴다(수용 기준 6, 금지사항). / 이유: `assume-unchanged`·`skip-worktree` 표시는 `git status`가 그 파일의 작업 트리를 보지 않게 해서, 상태 확인만으로는 HEAD로 되돌릴 수 없는 수정을 지울 수 있다. 바이트를 견주면 표시와 상관없이 "HEAD와 같다"를 직접 본다. 줄 끝도 바꿔 보지 않는다(F1 2회차: CRLF를 LF로 바꿔 견주면 줄 끝만 바꾼 숨긴 수정이 통과한다. 이 리포는 작업 트리를 LF로 둔다). / 버린 대안: `git ls-files -v`로 표시를 읽는다(읽기 git 명령이 하나 늘고, 표시 없이 생기는 다른 숨김(필터 등)은 못 잡는다), CRLF를 LF로 바꾼 바이트도 견준다(1회차 고침. 줄 끝만 바꾼 수정이 사라진다).

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

- 기술 부채 표의 새 행 번호가 같은 자리에서 충돌한다(TD-39와 같은 종류). 번호는 같은 PR 안에서 코드 주석·계획·문서가 바로 가리켜야 해서 모으기로 미룰 수 없다(의사결정 로그 6). 이 step도 열린 PR #229와 TD-70·71이 겹칠 뻔했다(의사결정 로그 17). → 처리: TD-72
- 다른 머신·다른 작업자 이름으로 만든 worktree의 계획을 이어 가는 절차가 없다(`readLocalPlans`는 로컬 worktree의 계획만, `start`는 `owner`가 지금 작업자인 것만 본다. `new-task`는 선점이 있는 Issue의 원격 브랜치를 이어받지 못한다). step0은 손으로 이었고(진행 로그 2026-11-23 12:23), step1은 선점이 만료된 채 `start`에 보이지 않다가 제작자 지시로 넘겨받았다. → 처리: TD-73

## 열린 질문

없음. 조각 단위는 제작자가 답했다(의사결정 로그 1).

## 검증 방법과 결과

- step마다 AC 명령, `node scripts/harness.ts check`(구현 전 실패를 보는 `test-effect` 포함), [자체 리뷰 체크리스트](../../../../scripts/cross-review/checklist.md).
- 수용 기준 5는 step0 테스트(두 브랜치의 git 병합)로 본다.
- 수용 기준 6은 step1 테스트와, step1 AC가 이 리포의 클론에서 `changes-collect`를 돌린 뒤 `doc-lint`가 통과하는 것으로 본다(실제 설계서·CHANGELOG로).
- 수용 기준 7은 있던 `scripts/test/doc-lint-design-version.test.ts`를 고치지 않고 통과하는 것으로 본다.
- 수용 기준 10은 step1 PR의 `harness-guard` 결과(CI)로 본다.
- 결과(step1, 2026-11-25, head `fbf90cc`): step1의 AC 20줄이 모두 통과했다. 클론에서의 모으기는 `changes-collect: 조각 4개, CHANGELOG 항목 4개, 설계서 v0.7.83, v0.7.84`였고 그 뒤 `doc-lint`가 통과했다(경고만). `doc-lint-design-version.test.ts`는 고치지 않고 통과한다(수용 기준 7). `check` 결과는 아래 줄.
- 결과(step1, 2026-11-25): `node scripts/harness.ts check` 통과. `test-effect`: `changes-collect.test.ts` effective(base에서 단언 실패).
- 결과(step1 재작업, 2026-11-25, head `6c731c9`. main `e183ae7` 병합과 F1~F4 고침 뒤): step1의 AC 20줄이 모두 통과했다. 클론에서의 모으기는 `changes-collect: 조각 5개, CHANGELOG 항목 5개, 설계서 v0.7.83, v0.7.84`(main에 #236의 조각이 더해졌다)였고 그 뒤 `doc-lint`가 통과했다. `node scripts/harness.ts check` 통과(첫 실행은 다른 세션의 `check`와 겹쳐 `test` 1건이 실패했는데 출력이 잘려 이름을 남기지 못했다. 혼자 다시 돌린 `test` 1350건과 `check`가 통과했다).

## 다음 할 일

- step0 PR #227: F14 고침을 완료 처리 → `origin/main` 병합 → `check` → push → 판정 통과 뒤 `pr-ready`로 제작자 head 승인 요청(위험도 높음).
- step0이 병합되면 `new-task --plan 20261123-change-fragments --step 1`로 step1(모으기 명령)을 시작한다.
