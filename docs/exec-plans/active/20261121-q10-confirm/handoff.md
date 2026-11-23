# 세션 인수인계 (2026-11-23) — Q10 확정(#180)과 곁가지

> 대화 세션 하나가 2026-11-21~23에 한 일과 남긴 일. 제작자가 "현재 작업이 끝나면 종료하고 인수인계 문서를 만들라"고 해 Claude Docs에 썼고, 이어서 "md 파일로 만들고 커밋하라"고 해 이 파일로 옮겼다. 옮기면서 그 뒤 바뀐 상태(#221 병합, #226 판정)를 반영했다.
> **이 파일은 PR #188의 다음 push(main 병합·F15)에서 함께 지운다**(step0의 산출물이 아니고 계획 검증에 들어갈 파일이 아니다). 이 파일을 올린 커밋은 #188이 main과 충돌한 동안 올렸다. 충돌한 PR은 `check`가 돌지 않아 이 커밋으로 판정이 새로 돌지 않는다.

## 0. 이어받는 세션이 먼저 할 일

1. `node scripts/harness.ts start`를 실행한다.
2. 열린 `needs-human`: **#180**(Q10 확정). 이 세션의 PR #188이 맡는다. 제작자의 워크플로 커밋(`.github/workflows/q10-trial.yml`)은 #188 브랜치에 올라가 있다.
3. 이 세션의 열린 PR은 #188, #217, #226 셋이다(모두 초안, 1절 표). #207과 TD-39(#222, 브랜치 `feat/20261123-change-fragments-s0`, PR 없음)는 다른 세션의 것이다.
4. 새 판정에 답하기 전에 `node scripts/harness.ts pr-state --pr <N>`을 본다. "오래 열린 지적" 줄이 나오면 고치지 말고 제작자에게 묻는다.
5. 승인 요청(`pr-ready`)은 한 번에 하나다. 차례: **#188 → #217 → #226**.

## 1. 지금 상태 (2026-11-23)

main은 `e9f7ad6`(#221 병합)이고 설계서는 v0.7.81이다.

| PR   | Issue | 내용                                                                                            | head      | 판정                                    | main과            | 다음                                       |
| ---- | ----- | ----------------------------------------------------------------------------------------------- | --------- | --------------------------------------- | ----------------- | ------------------------------------------ |
| #188 | #180  | Q10 확정 step0 `ci-trial`: 실측을 CI 러너(Linux·Windows)에서 돌리는 워크플로와 `run.ts`         | `02246f7` | 두 검증자 승인. 미룬 지적 F15(P2)       | 충돌(CHANGELOG)   | main 병합 + F15 → 재판정 → 승인 요청 1순위 |
| #217 | #212  | 계획만 담은 head에서 코드 지적을 구현 대기(`parked`)로 둔다                                     | `3df4626` | 두 검증자 승인. 미룬 지적 F6(P2)        | 충돌(설계서)      | main 병합 + 설계서 v0.7.82 → 재판정        |
| #226 | #225  | 실측 결과 파일 `lab/q10-db/results/darwin-arm64.json`을 보호 경로에 넣어 test 건너뛰기에서 뺀다 | `fd91621` | Claude 승인, **Codex 수정 요청 F1(P1)** | 뒤처짐(충돌 없음) | F1 고침 → 재판정                           |

Q10 배경: 제작자 지시는 "DB·ORM은 여러 PC와 개발 환경에서 영향이 없으면 PostgreSQL + Drizzle, 영향이 있으면 DB 없이 시작"이다. ADR-0007은 macOS 실측만 있어 제안 상태다. #180 step1이 Linux·Windows 실측을 더해 결론을 낸다.

## 2. 다음 할 일 (차례대로)

### 2.1 #188 — main 병합과 F15

worktree `harness_project.worktrees/chore/20261121-q10-confirm-s0`.

1. `git fetch origin` 뒤 `git merge --no-commit --no-ff origin/main`. 2026-11-23에 `git merge-tree`로 보니 `docs/harness/CHANGELOG.md`만 충돌한다. main의 줄을 먼저, 이 PR의 줄을 뒤에 두고 병합 커밋을 만든다.
2. 이 파일(`handoff.md`)을 지운다.
3. 완료된 step0을 다시 연다. `scripts/commands/task.ts`의 `reopenStep(cwd, 이유)`를 부른다. 이유: "미뤄 둔 판정 지적 F15(Codex P2, `lab/q10-db/README.md`): README가 '`scripts/test/`의 테스트는 `lab/`을 읽지 않는다'라고 하나, 구조 테스트가 워크플로 패치를 읽고 그 패치는 보호 경로다. 맞는 지적이다. 승인을 요청하기 전에 README의 그 문장을 고친다."
4. `lab/q10-db/README.md`의 문장을 바꾼다.

   지금:

   ```text
   하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않고, `scripts/test/`의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).
   ```

   바꿀 글(#226이 아직 병합되지 않았을 때):

   ```text
   하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않는다. `scripts/test/`의 테스트는 이 폴더에서 두 파일을 읽는다: 워크플로 패치(`q10-trial-workflow.test.ts`가 워크플로 파일과 글자 그대로 같은지 본다)와 `results/darwin-arm64.json`(`profile-web-db.test.ts`가 웹 프로파일 README의 DB 절에 적은 버전과 같은지 본다). `check`는 `lab/` 안의 파일만 바뀐 변경에서 `test`를 건너뛰지만(`testInertPaths`) 보호 경로는 건너뛰지 않는다. 워크플로 패치는 보호 경로라, 그것을 바꾼 변경은 `test`를 돌리고 제작자 승인이 필요하다. 결과 파일을 같게 다루는 일은 Issue #225다.
   ```

   #226이 먼저 병합됐으면 끝의 두 문장을 "두 파일 모두 보호 경로라, 그것을 바꾼 변경은 `test`를 돌리고 제작자 승인이 필요하다."로 쓴다.

5. 계획(`plan.md`)에 적는다.
   - 진행 로그: main 병합(#214·#221 병합 뒤, CHANGELOG 충돌을 main의 줄 먼저로 풀었다)과 F15 처리. F15를 확인하다가 `profile-web-db.test.ts`가 `results/darwin-arm64.json`도 읽는 것을 찾았고, step0 금지사항(`harness.config.json`을 고치지 않는다) 때문에 Issue #225로 등록했다. 문서만 바뀌어 테스트는 더하지 않았다.
   - 의사결정 로그: 결과 파일의 건너뛰기 문제는 이 PR에서 고치지 않고 Issue #225로 따로 고친다. F14 때 제작자가 정한 방법(별도 PR로 먼저 고친다)과 같다.
6. step0의 AC 명령(16줄)을 모두 돌린다. 그다음 `check && complete-step`을 실행한다.
7. PR 본문에 F15 대응 절을 더한다(`gh pr edit 188 --body-file …`). 그다음 `check && git fetch -q origin && [ behind = 0 ] && git push origin chore/20261121-q10-confirm-s0`을 실행한다.
8. 판정을 기다린다. 두 검증자가 승인하면 `node scripts/harness.ts pr-ready --pr 188`과 `gh pr merge 188 --auto --squash`를 실행한다. Issue #180에 `@ariawell-hub` 승인 요청 댓글을 단다(PR 번호와 head를 함께 적는다). `needs-human` 라벨은 이미 붙어 있다.

### 2.2 #217 — main 병합과 설계서 번호

worktree `harness_project.worktrees/fix/20261122-plan-review-parked-s0`.

1. `git merge origin/main`을 하면 `docs/harness/design.md`만 충돌한다. #221이 v0.7.81을 먼저 썼으므로 이 PR은 **v0.7.82**로 올린다.
   - 버전 이력은 main의 줄을 먼저 두고, 이 PR의 줄을 v0.7.82로 바꾼다.
   - 머리말의 버전과 최종 갱신 날짜를 맞춘다. 날짜는 이력의 마지막 항목 날짜와 같아야 한다.
   - CHANGELOG는 자동으로 병합되지만, 이 PR의 "설계서 v0.7.81" 줄(#212)은 v0.7.82로 고친다.
2. `fmt`와 `doc-lint`를 돌린다. 계획(`docs/exec-plans/completed/20261122-plan-review-parked/`)에 병합을 적는다.
3. `check && fetch && behind=0 && push`로 올리고 재판정을 받는다. 승인 요청은 #188이 병합된 뒤에 한다.
4. 미룬 F6(P2)은 승인을 요청할 때 제작자에게 알린다.
5. TD-39(#222, 다른 세션)의 step0이 먼저 병합되면 설계서 버전·이력·CHANGELOG 대신 계획별 조각 파일(`docs/harness/changes/<계획 id>.md`)에 적는다. 그 PR의 설명을 따른다.

### 2.3 #226 — 판정 지적 F1과 README

worktree `harness_project.worktrees/fix/20261123-results-not-inert`.

1. `pr-state --pr 226`을 본다.
2. F1(Codex P1, `scripts/test/check-skip.test.ts:486`): 새 훑기 테스트의 정규식 ``/['"`](lab\/[^'"`\s]+)['"`]/g``가 공백이 든 경로를 놓친다. 예를 들어 `lab/q10-db/results/trial notes.json`을 읽는 테스트가 생겨도 잡지 못한다. Codex 제안: 따옴표 안의 경로에 공백을 허용하고, 공백이 든 실제 파일 경로도 검사되는지 확인한다.
   - 고칠 방향(안): 문자 집합에서 `\s` 대신 줄바꿈만 뺀다. 훑는 부분을 함수로 떼어, 공백이 든 경로를 넣은 글로 시험한다.
   - 테스트를 먼저 고쳐 실패를 진행 로그에 적는다.
   - 완료 처리 뒤라 `reopenStep`이 먼저다. 작은 계획이라 `completed/`로 옮겨져 있으니, `reopenStep`이 이 경우를 다루는지 먼저 본다.
3. main을 병합한다(뒤처짐만 있고 충돌은 없을 것이다).
4. #188이 먼저 병합됐으면 `lab/q10-db/README.md`의 "결과 파일을 같게 다루는 일은 Issue #225다"를 "두 파일 모두 보호 경로"로 맞춘다. 2.1의 4번 끝 글과 같게 쓴다.
5. 재판정을 받는다. 승인 요청은 #217 다음이다. Issue #225에 `needs-human` 라벨을 붙이고 승인 요청 댓글을 단다.

### 2.4 Issue #180 step1

#188이 병합된 뒤 `node scripts/harness.ts new-task --plan 20261121-q10-confirm --step 1`로 시작한다.

1. 워크플로 `q10-trial`을 돌려 Linux·Windows 결과를 더한다.
2. 제작자 지시대로 ADR-0007을 채택(PostgreSQL + Drizzle)하거나 "DB 없이 시작"으로 정한다.
3. 테스트가 새 결과 파일(예: `results/linux-x64.json`)을 읽게 되면 그 파일도 보호 경로에 넣는다. #226의 훑기 테스트가 빠진 것을 잡는다.

## 3. 제작자 확인이 필요한 것

- [ ] **질문**: `blockPlan`과 `reportConflict`에도 #211과 같은 문제가 있다. 상태를 먼저 적고, 알림에 실패하면 경고만 남긴다. Issue로 등록할지 아직 답을 받지 못했다.
- [ ] #217의 미룬 지적 F6(P2): 승인을 요청할 때 알린다.
- [ ] 예전 브랜치 `feat/20261121-q10-confirm-s0`(원격에 남아 있다)와 그 worktree는 쓰지 않는다. 제작자가 지워도 된다.
- [ ] `verify-guard` 테스트가 가끔 실패한다(불안정하다). Issue로 등록할지 정해야 한다.
- [ ] `scripts/lib/plan.ts`의 `sections()`에 #202에서 고친 것과 같은 꼴(주석과 코드 블록 가리기)이 남아 있다. Issue로 등록할지 정해야 한다.

참고: 2026-11-22 21:33 UTC에 제작자의 첫 승인이 이미 병합된 #219에 달렸다. #214는 21:36에 다시 승인받아 병합됐다. 승인을 요청할 때는 PR 번호와 head를 함께 적는다.

## 4. 놓치기 쉬운 규칙과 요령

- **충돌한 PR에서는 `check`가 돌지 않는다.** `pull_request` 워크플로가 돌지 않아 판정도 시작되지 않는다. #188에서 이 때문에 1시간을 기다렸다. 다른 PR이 병합되면 바로 main을 병합한다.
- **설계서 버전은 병합 차례대로 쓴다.** 지금 main은 v0.7.81이다. 설계서를 고치면 다음 네 가지를 함께 고친다:
  - 머리말 버전
  - 최종 갱신 날짜(이력의 마지막 항목 날짜와 같아야 한다. `doc-lint`가 본다)
  - 0절 이력
  - CHANGELOG의 "설계서 v…" 줄
- **승인 요청은 한 번에 하나다.** 승인을 요청한 PR에는 커밋을 더 올리지 않는다.
- **Codex의 지적 내용은 실행 로그에 있다.**
  - `gh run list --workflow judge-codex`의 headSha는 PR head가 아니라 main 커밋일 수 있다(`workflow_run`). 로그의 `ci-pr: PR #N head …` 줄로 PR을 찾는다.
  - 로그에서 `record-review: 판정`, `[P0~3]`, `근거:`, `제안:` 줄을 본다.
  - 원장 댓글(`harness-ledger:v1`)에서는 `| F…` 줄을 본다.
- **완료 커밋 뒤에 고치려면 `reopenStep`이 먼저다.** step을 실행하는 PR은 자기 step의 "작업", "Acceptance Criteria", "금지사항"을 바꿀 수 없다. 바꿔야 할 것은 의사결정 로그에 적는다.
- **`testInertPaths`에 테스트가 읽는 파일이 들어가면 안 된다.** `lab/`에서 테스트가 읽는 파일은 보호 경로에 넣는다(#215, #225). 보호 경로는 건너뛰기 대상이 아니다.
- 보호 경로를 바꾼 PR의 본문에는 `- [x] 보호 경로 변경: …` 줄을 넣는다.
- 커밋 메시지는 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`로 끝낸다. 사용자에게는 한국어로 보고한다.

## 5. 이 세션에서 끝낸 일

- PR #214(Issue #211): runner가 질문이 전달된 뒤에만 올린 것으로 적는다. 2026-11-22 21:38 UTC 병합(`3e9e8b2`).
- PR #216(Issue #215, #188의 F14): 워크플로 패치를 보호 경로에 넣어 test 건너뛰기에서 뺐다. 병합 `31b2390`.
  - 이 PR의 테스트가 `results/darwin-arm64.json`을 건너뛰기 대상이라고 잘못 단언했다. 그래서 Issue #225를 만들었고 #226이 고친다.

## 6. 참고

이 세션이 만든 스크립트는 세션 scratchpad(`/private/tmp/claude-501/<프로젝트>/051fe201-cac5-4eba-b700-2b25fea4ab6f/scratchpad/`)에 있다. 재부팅하면 지워질 수 있다. 필요한 글은 이 파일에 옮겨 두었다.

| 파일                    | 하는 일                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `f15-188.mjs`           | #188의 README F15 수정과 계획 기록. 인자는 병합한 main 커밋 7자다. 아직 돌리지 않았다. 계획 기록의 "PR #214가 병합돼"는 "#214·#221"로 고쳐 쓴다 |
| `reopen-188-f15.mjs`    | #188 step0을 다시 연다(`reopenStep`). 아직 돌리지 않았다                                                                                        |
| `run-ac.mjs`            | `node run-ac.mjs <step 파일> <로그 폴더>`. step의 AC 명령을 차례로 돌린다                                                                       |
| `resolve-changelog.mjs` | CHANGELOG 충돌을 main의 줄 먼저 두고 푼다                                                                                                       |
| `renumber-design.mjs`   | `<옛 번호> <새 번호> <Issue>`. 설계서 머리말·이력 충돌을 풀고 번호와 CHANGELOG 줄을 맞춘다                                                      |
| `pr-188-body-v14.md`    | #188의 지금 PR 본문                                                                                                                             |
| `pr-212-body.md`        | #217의 지금 PR 본문                                                                                                                             |
| `pr-225-body.md`        | #226의 지금 PR 본문                                                                                                                             |

worktree(모두 `harness_project.worktrees/` 아래):

| PR   | worktree                             | 계획                                                      |
| ---- | ------------------------------------ | --------------------------------------------------------- |
| #188 | `chore/20261121-q10-confirm-s0`      | `docs/exec-plans/active/20261121-q10-confirm/`            |
| #217 | `fix/20261122-plan-review-parked-s0` | `docs/exec-plans/completed/20261122-plan-review-parked/`  |
| #226 | `fix/20261123-results-not-inert`     | `docs/exec-plans/completed/20261123-results-not-inert.md` |

병합된 #214의 worktree(`fix/20261122-runner-question-post-s0`)는 다음 `start`가 정리한다.
