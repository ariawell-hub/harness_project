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
2. `doc-lint`는 조각 폴더의 Markdown 파일에 frontmatter와 색인 링크를 요구하지 않는다. 자리·이름·형식이 틀리면 `R8 변경 조각`으로 실패한다.
3. `harness-guard`: 보호 경로를 바꾼 PR이 CHANGELOG를 고치지 않아도, 조각 파일에 base에 없던 CHANGELOG 항목을 형식에 맞게 더했으면 통과한다. CHANGELOG를 고친 PR은 지금처럼 통과한다. 둘 다 아니면(형식이 틀린 조각, 자리 밖 파일, CHANGELOG 항목을 더하지 않은 조각 변경, 조각 삭제만) 지금처럼 실패하고 설명에 `CHANGELOG`가 있다. 검사를 약화하지 않는다.
4. 두 PR이 각자 조각 파일만 더하면 git 병합에서 서로 충돌하지 않는다. 모으기 PR이 조각을 지워도, 그 뒤에 열린 PR은 새 이름의 파일만 더하므로 충돌하지 않는다.
5. 모으기 명령 `node scripts/harness.ts changes-collect`는 조각을 이름 차례로 읽는다. CHANGELOG 항목은 "다음 버전 (미배포)" 절 끝으로 옮긴다. 설계서 변경 이력 항목마다 다음 패치 버전과 그날 날짜를 붙여 변경 이력 끝에 넣고 머리말을 맞춘다. 그리고 조각 파일을 지운다. 결과는 `doc-lint`를 통과한다. 조각이 없으면 아무것도 바꾸지 않고 0으로 끝난다. 조각 하나라도 형식이 틀리거나 설계서·CHANGELOG를 읽지 못하면 아무것도 바꾸지 않고 1로 끝난다. 스테이징·커밋 같은 git 명령은 쓰지 않는다.
6. 문서와 템플릿: 절차서 5절(보호 경로 PR의 기록 규칙, 설계서 버전 규칙, 모으기 PR 절차), 설계서(7.2절 트리, R9 행, `harness-guard` 행, 10.4절의 `harness-guard` 설명), CHANGELOG 머리 문장, PR 템플릿의 보호 경로 체크 줄, README, 하네스 코드 구조 문서를 새 규칙에 맞춘다.
7. 기술 부채 표: TD-39를 해결로 닫는다. 같은 종류의 충돌(새 TD 행 번호)과 이 계획을 이어받으며 찾은 일(진행 로그 2026-11-23 12:23)은 새 행으로 남긴다.
8. step1 PR은 CHANGELOG와 설계서를 고치지 않고 자기 조각 파일로만 기록한다. 그 PR이 `harness-guard`를 통과하는 것으로 새 방식이 실제로 통과함을 보인다.

## 범위 / 비범위

범위:

- 조각 읽기와 모으기: 새 파일 `scripts/lib/changes.ts`, 새 파일 `scripts/commands/changes.ts`, `scripts/harness.ts`의 명령 하나.
- 게이트: `scripts/gates/doc-lint.ts`, `scripts/gates/harness-guard.ts`.
- 테스트: 새 파일 `scripts/test/changes.test.ts`·`scripts/test/changes-collect.test.ts`, `scripts/test/harness-guard.test.ts`에 테스트 추가.
- 수용 기준 6의 문서·템플릿, 기술 부채 표, step1의 조각 파일.

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
- `scripts/commands/changes.ts`
- `scripts/harness.ts`
- `scripts/gates/doc-lint.ts`
- `scripts/gates/harness-guard.ts`
- `scripts/test/changes.test.ts`
- `scripts/test/changes-collect.test.ts`
- `scripts/test/harness-guard.test.ts`
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

- step0 fragments: 조각 파일의 자리·형식(`scripts/lib/changes.ts`)을 정하고 `doc-lint`·`harness-guard`가 조각을 받게 한다. 규칙 문서를 바꾼다. 이 PR은 main의 `harness-guard`로 판정되므로 옛 방식(CHANGELOG, 설계서 버전)으로 기록한다.
- step1 collect: 모으기 명령 `changes-collect`와 모으기 PR 절차를 더하고 TD-39를 닫는다. 이 PR은 자기 조각 파일로만 기록한다.

## 진행 로그

- 2026-11-23 06:48 작업 공간을 만들고 step0 초안(조각 파일 형식, doc-lint, harness-guard)을 짜 봤다. 계획은 아직 쓰지 않았다. 제작자 지시로 세션을 끝내며 초안을 `draft-step0.patch`로, 인수인계를 `handoff.md`로 이 폴더에 남겼다.
- 2026-11-23 12:23 다른 PC의 세션이 이어받았다. 이 PC에는 이 브랜치의 worktree가 없어서 `start`가 "할 일 없음"을 냈다(`scripts/runner/next.ts`의 `readLocalPlans`는 로컬 worktree의 계획만 본다). `new-task --issue 222`는 이미 있는 `claim/222` 때문에 쓸 수 없어, `git worktree add --track -b feat/20261123-change-fragments-s0 <경로> origin/feat/20261123-change-fragments-s0`로 만들고 `setup`을 돌렸다. `origin/main`(e9f7ad6)을 병합했다. 조각 단위를 제작자에게 물어 step(PR)별로 정했다(의사결정 로그 1). 계획을 쓰고 `handoff.md`·`draft-step0.patch`를 지웠다. 초안 패치는 커밋 5059e42에 남아 있다(`git show 5059e42:docs/exec-plans/active/20261123-change-fragments/draft-step0.patch`). 머신을 옮겨 이어 가는 절차가 없는 것은 step1에서 TD 행으로 남긴다.

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
11. 결정: `harness-guard`는 조각 파일의 이름을 PR 브랜치와 견주지 않는다. / 이유: 판정 함수가 브랜치를 받지 않는다. 이름 규칙은 충돌을 피하려는 약속이고, 이름이 달라도 형식에 맞는 기록은 기록이다. 형식과 자리는 `doc-lint`가 본다.

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

## 열린 질문

없음. 조각 단위는 제작자가 답했다(의사결정 로그 1).

## 검증 방법과 결과

- step마다 AC 명령, `node scripts/harness.ts check`(구현 전 실패를 보는 `test-effect` 포함), [자체 리뷰 체크리스트](../../../../scripts/cross-review/checklist.md).
- 수용 기준 4는 step0 테스트(두 브랜치의 git 병합)로 본다.
- 수용 기준 5는 step1 테스트와, step1 AC가 이 리포의 클론에서 `changes-collect`를 돌린 뒤 `doc-lint`가 통과하는 것으로 본다(실제 설계서·CHANGELOG로).
- 수용 기준 8은 step1 PR의 `harness-guard` 결과(CI)로 본다.

## 다음 할 일

- 계획만 담은 커밋으로 초안 PR(`Refs #222`)을 열어 계획 검증(G1)을 받는다. 승인되면 step0의 테스트를 먼저 커밋하고(구현 전 실패를 진행 로그에) 구현한다.
