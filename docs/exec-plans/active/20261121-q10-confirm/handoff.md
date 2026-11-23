# 세션 인수인계 (2026-11-23) — Q10 확정(#180), step1 시작 전

> Windows PC의 대화 세션이 맥 세션의 인수인계(옛 `handoff.md`, 커밋 `d90f49b`에서 지웠다)를 넘겨받았다. 이 세션은 #188을 끝내고 계획 수정(#232)까지 병합한 뒤 멈췄다. 제작자가 "인수인계서를 개선하고 작업을 멈춰라"고 해서, 옛 파일을 지금 상태로 고쳐 step1 브랜치에 올렸다(올리는 곳은 제작자가 골랐다).
>
> **이 파일은 step1의 첫 커밋에서 지운다.** step1의 산출물이 아니다. 이 브랜치(`chore/20261121-q10-confirm-s1`)에는 이 파일을 더한 커밋 하나만 있고 PR은 없다. step1의 다른 작업(워크플로 실행 포함)은 아직 하지 않았다.

## 0. 이어받는 세션이 먼저 할 일

1. `node scripts/harness.ts start`를 실행한다. 열린 `needs-human`은 #180(이 계획) 하나다.
2. worktree를 준비한다. 이 PC에는 `harness__project.worktrees/chore/20261121-q10-confirm-s1`이 있다. 다른 머신이면 리포 루트에서 아래 명령을 실행한다. 원격 브랜치를 따라가는 로컬 브랜치가 생긴다.

   ```bash
   git fetch origin
   git worktree add ../harness__project.worktrees/chore/20261121-q10-confirm-s1 chore/20261121-q10-confirm-s1
   ```

   `new-task --plan 20261121-q10-confirm --step 1`은 다시 실행하지 않는다. 이미 실행해서 브랜치가 있다.

3. 새 worktree에서는 `node scripts/harness.ts setup`부터 실행한다. 건너뛰면 `fmt`가 `Command "prettier" not found`로 실패한다.
4. owner를 확인한다. 계획 frontmatter의 owner는 `session`이고, main 체크아웃에서 연 대화 세션은 이 worktree를 고칠 수 있다(L1 훅 R3). 다른 owner 이름(runner 작업자, `mac-session-N` 등)으로 이어 가려면 owner를 바꾸기 전에 제작자에게 묻는다. 지난번 넘겨받기에서도 그렇게 했다.
5. 판정에 답하기 전에는 `node scripts/harness.ts pr-state --pr <N>`을 본다. "오래 열린 지적" 줄이 나오면 고치지 말고 제작자에게 묻는다.

## 1. 지금 상태 (2026-11-23 10:00 UTC 무렵)

- main은 `69ecad1`(#232 병합)이다. 설계서는 v0.7.81이다.
- 계획 `20261121-q10-confirm`(Issue #180)의 상태:
  - status는 `active`다.
  - step0 `ci-trial`은 완료됐다(PR #188, `c2cb9ff`). 워크플로 `.github/workflows/q10-trial.yml`이 main에 있다.
  - F16에 따른 계획 수정이 병합됐다(PR #232, `69ecad1`). 계획 해시는 `827ef23ec69d`이고 Claude·Codex가 승인했다.
  - step1 `confirm`은 `pending`이다(`index.json`).
- 이 세션이 끝낸 것(모두 병합):

  | PR   | Issue | 내용                                                                                          | 병합      |
  | ---- | ----- | --------------------------------------------------------------------------------------------- | --------- |
  | #231 | #228  | Windows 네이티브에서 `check`가 통과한다(EPERM 테스트 2건의 확인 방법, `test.timeoutSec` 3600) | `54631b7` |
  | #188 | #180  | Q10 확정 step0: 실측 절차 `run.ts`와 손으로 도는 워크플로 `q10-trial`(F15·F16 처리)           | `c2cb9ff` |
  | #232 | #180  | 계획 수정(F16): step1의 ADR·TD-14 문구 지시. TD-14의 `lab/q10-db` 항목은 닫는다               | `69ecad1` |

  이 세션이 등록하고 아직 열려 있는 것: Issue #230(Windows에서 테스트가 느리다).

- 다른 세션의 열린 PR(모두 초안). 이 세션은 손대지 않았다.

  | PR   | Issue | 내용                                                                                       | 상태(10:00 UTC 무렵)                                  | 맡은 곳                                     |
  | ---- | ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------- |
  | #217 | #212  | 계획만 담은 head에서 코드 지적을 구현 대기(`parked`)로 둔다                                | main과 충돌(설계서). 두 검증자 승인, 미룬 지적 F6(P2) | 맥 세션(끝남). 이어 갈 세션이 정해지지 않음 |
  | #226 | #225  | 결과 파일 `lab/q10-db/results/darwin-arm64.json`을 보호 경로에 넣어 test 건너뛰기에서 뺀다 | main에 뒤처짐. Codex F1(P1) 열림                      | 맥 세션(끝남). 이어 갈 세션이 정해지지 않음 |
  | #227 | #222  | 보호 경로 PR의 변경 기록을 PR별 조각 파일에 적는다(TD-39)                                  | 판정 대응 중(09:52 UTC에 갱신됐다)                    | 이 PC의 다른 대화 세션                      |
  | #229 | #223  | Codex 사용량 한도                                                                          | 진행 중                                               | 이 PC의 다른 대화 세션                      |
  | #207 | #206  | `check` job을 arm64 러너로 옮긴다                                                          | 2026-11-22 뒤로 갱신 없음                             | 다른 세션                                   |

  이 PC에는 Issue #224(Q13, PR 없음)의 worktree `docs/20261123-q13-personal-account`도 있다(다른 세션).

## 2. step1 할 일 (차례대로)

기준은 `step1.md`다. 아래는 순서와 놓치기 쉬운 점만 적는다.

1. **이 파일을 지운다.** step1의 첫 커밋에서 지운다.
2. **테스트를 먼저 쓴다.**
   - 먼저 쓸 테스트는 `lab/q10-db/test/verify-artifacts.test.ts`와 `lab/q10-db/test/confirmed.test.ts`다.
   - `confirmed.test.ts`가 결과 파일과 문서를 고치기 전에 실패하는 것을 진행 로그에 적는다.
   - 이 두 테스트는 `check`가 돌리지 않는다(`check`는 `scripts/test/`만 돌린다). AC가 돌린다.
3. **워크플로를 돌린다.**
   - 명령: `gh workflow run q10-trial.yml --ref main`. 실행 번호와 주소를 진행 로그에 적는다.
   - 봇 토큰으로 거부되면 Issue #180에 댓글로 Actions 화면의 "Run workflow"를 요청한다(라벨 `needs-human`은 이미 붙어 있다).
   - job이 실패하면 `step1.md` 작업 1을 따른다.
     - 스크립트의 문제면 별도 PR로 먼저 고친다.
     - 도구 자체의 문제면 멈추고 제작자에게 묻는다(수용 기준 5).
   - 참고: 제작자의 이 Windows PC에서는 11-23에 절차가 통과했다(`win32-x64: 통과`). 그러니 `windows-latest`가 실패하면 러너 쪽 차이부터 의심한다.
4. **산출물을 받는다.**
   - 명령: `gh run download <번호> --dir "$(mktemp -d)"`.
   - `linux-*.json`과 `win32-*.json`만 `lab/q10-db/results/`에 복사하고 `node scripts/harness.ts fmt`로 포맷한다.
   - 손으로 고치지 않는다. `darwin-arm64.json`은 건드리지 않는다.
5. **출처를 확인한다.**
   - `lab/q10-db/README.md`의 "잰 머신" 표에 두 행을 더한다.
   - `verify-artifacts.ts`를 구현하고 `node lab/q10-db/verify-artifacts.ts`를 실행한다.
   - 출력을 진행 로그와 PR 본문에 그대로 옮긴다.
6. **문서를 고친다**(`step1.md` 작업 4). #232가 정한 것:
   - ADR-0007 "알려진 한계"에 두 문장을 글자 그대로 넣는다. `Windows 네이티브의 확정 근거는 CI의 Windows 러너에서 받은 산출물이다.` / `제작자의 Windows PC에서는 2026-11-23에 절차가 통과했으나 결과 파일을 남기지 않아 확정 근거로 쓰지 않는다.`
   - ADR 문서 전체에 `잠정`, "아직 재지 않았다", `TD-14`를 남기지 않는다. `## 결과` 절의 Q10 줄도 확정으로 고친다.
   - TD-14 행에서는 `step1.md`에 적힌 문구를 글자 그대로 지운다. 다른 항목과 다른 행은 고치지 않는다(AC 아홉째 줄).
   - 설계서 Q10 행과 `lab/q10-db/README.md`에서도 TD-14를 가리키지 않는다.
   - 설계서 버전은 push할 때 main의 다음 번호다. #217도 v0.7.82를 쓰려 한다. 먼저 병합된 쪽이 번호를 가져간다.
   - #227(TD-39)이 먼저 병합되면 CHANGELOG와 설계서 이력 대신 변경 조각 파일에 적는다. 그 PR의 설명을 따른다.
7. **올린다.**
   - AC 14줄을 모두 돌린다(`run-ac.mjs`, 6절).
   - 그다음 `check && complete-step && git push && gh pr create --draft`를 실행한다.
   - step1은 마지막 step이라 PR 본문 첫 줄은 `Closes #180`이다.
8. **판정을 받고 승인을 요청한다.**
   - 계획의 risk가 high라 제작자 head 승인이 필요하다.
   - 두 검증자가 승인하면 `pr-ready`와 `gh pr merge --auto --squash`를 실행한다.
   - Issue #180에 `@ariawell-hub` 승인 요청을 PR 번호, head와 함께 단다.

## 3. 제작자 확인이 필요한 것

- [ ] **#217·#226을 이어 갈 세션을 정한다.** 맥 세션이 끝나 맡은 곳이 없다. 옛 인수인계의 할 일은 그대로 유효하다(커밋 `d90f49b^`의 `handoff.md` 2.2·2.3절). 다만 아래 두 가지는 바뀌었다.
  - #217: main이 v0.7.81이라 v0.7.82로 올린다.
  - #226: #188이 병합됐으므로 main을 병합할 때 `lab/q10-db/README.md`의 "결과 파일을 같게 다루는 일은 Issue #225다"를 "두 파일 모두 보호 경로" 꼴로 맞춘다.
- [ ] 아래 넷은 맥 세션이 남긴 것이다. 이 세션은 답을 받았는지 확인하지 않았다.
  - `blockPlan`·`reportConflict`에도 #211과 같은 문제가 있는지, Issue로 등록할지.
  - `verify-guard` 테스트가 불안정한 것을 Issue로 등록할지.
  - `scripts/lib/plan.ts`의 `sections()`에 #202와 같은 꼴(주석·코드 블록 가리기)이 남아 있는 것을 Issue로 등록할지.
  - #217의 미룬 지적 F6(P2): 승인을 요청할 때 알린다.
- [ ] 예전 브랜치 `feat/20261121-q10-confirm-s0`이 원격에 남아 있다(`6fbdaa2`). 쓰지 않으니 제작자가 지워도 된다.
- 알림(질문이 아니다): TD-14의 `lab/q10-db` 항목을 닫은 것은 봇의 판단이다. 계획의 의사결정 로그 "결정(F16 계획 수정)"에 있고, #232의 계획 검증을 받았다.

## 4. 놓치기 쉬운 규칙과 요령

옛 인수인계 4절에서 유효한 것:

- **충돌한 PR에서는 `check`가 돌지 않는다.** 판정도 시작되지 않는다. 다른 PR이 병합되면 바로 `origin/main`을 병합한다. rebase는 하지 않는다.
- **설계서를 고치면 네 곳을 함께 고친다.** 머리말 버전, 최종 갱신 날짜(이력의 마지막 날짜와 같아야 한다), 0절 이력, CHANGELOG의 "설계서 v…" 줄이다.
- **승인 요청은 한 번에 하나다.** 요청한 PR에는 커밋을 더 올리지 않는다.
- **step을 실행하는 PR은 자기 step의 "작업"·"Acceptance Criteria"·"금지사항"을 바꿀 수 없다.** 바꿔야 하면 계획 수정 PR로 한다. 절차서 4.1절이고 #232가 그 사례다. 브랜치는 `docs/<계획 id>-s<완료된 step>`, 계획 폴더만 고친다.
- **`testInertPaths`에 테스트가 읽는 파일이 들어가면 안 된다.** `lab/`에서 `scripts/test/`가 읽는 파일은 보호 경로에 넣는다(#215, #225). step1에서 `scripts/test/`의 테스트가 새 결과 파일을 읽게 되면 그 파일도 보호 경로에 넣는다.

이 세션에서 새로 안 것:

- **Windows PC의 `check`는 25~31분 걸린다.**
  - `test`만 1516~1858초다(시간 제한 3600초). 줄이는 일은 Issue #230이다.
  - 계획 폴더 같은 `testInertPaths`만 바뀐 변경은 `test`를 건너뛰어 몇 초에 끝난다.
  - `check`는 백그라운드로 돌리고, `check && push`를 한 명령으로 잇는다.
- **검사 출력은 파일로 보낸다.** `check`·`test`의 출력을 파이프로 넘기면 L1 훅(R4)이 막는다.
- **"나중 PR에서 고친다"는 기록만으로는 판정이 닫히지 않는다.**
  - F16에서 Codex가 "후속 PR에서 고치겠다는 기록은 현재 지시를 바꾸지 않는다"고 했다.
  - 실행을 실제로 막는 장치를 함께 둬야 닫혔다. 이번에는 step 파일의 "읽어야 할 파일" 첫 항목과 계획 status `blocked`(runner가 고르지 않는다)였다.
- **risk가 high인 계획은 계획 수정 PR도 제작자 head 승인이 필요하다.** risk-gate가 브랜치 이름으로 계획을 찾기 때문이다.
- **계획 검증 승인이 원장에 남아도 `plan-gate` 상태는 바로 바뀌지 않는다.** gates가 다시 돌아야 바뀐다. 계획 수정 PR에서는 `pr-ready`가 초안을 해제하면 gates가 다시 돌아 통과로 바뀌었다.
- **문서 테스트의 단언은 "낱말이 들어 있다"로 두지 않는다.** 낱말만 보면 뜻을 뒤집어 적어도 통과한다(#232의 F1). 넣을 문장을 글자 그대로 정하고, 옛 상태의 낱말이 문서 어디에도 없는지 본다(#232의 F2, ADR `## 결과` 절).
- **판정 지적의 본문은 record job 로그에 있다.**
  - `gh api .../jobs/<id>/logs`는 터미널 이스케이프 때문에 거부된다. `gh run view <실행> --job <record job> --log > 파일`로 받는다.
  - 받은 로그에서 `record-review: 판정`, `[P1]`, `근거:`, `제안:` 줄을 본다.
  - `judge-codex` 실행은 `headBranch`가 `main`(`workflow_run`)이라 PR 브랜치로 걸러지지 않는다. 시각으로 고른다.
- 커밋 메시지는 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`로 끝낸다. 사용자에게는 한국어로 보고한다.

## 5. 이 세션이 멈춘 이유

제작자가 "232 승인 확인하고 인수인계서를 개선하고 작업을 멈춰라"고 했다(2026-11-23 대화). #232는 제작자 승인 뒤(09:12 UTC) 병합된 것을 확인했다. step1은 시작하지 않았다.

## 6. 참고: 이 세션의 스크립트

이 세션의 scratchpad(`C:\Users\user\AppData\Local\Temp\claude\96837667c8e0bd15\b0f03185-77b3-4348-8fd1-7c532db2dca8\scratchpad\`)에 있다. 재부팅하거나 정리하면 지워질 수 있다.

| 파일                    | 하는 일                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `run-ac.mjs`            | `node run-ac.mjs <step 파일> <로그 폴더>`. step의 AC 명령을 차례로 돌린다 |
| `resolve-changelog.mjs` | CHANGELOG 충돌을 main의 줄 먼저 두고 푼다                                 |
| `takeover-owner.mjs`    | 계획의 owner를 바꾼다(제작자 승인 뒤에만 쓴다)                            |
| `pr-plan-fix-body.md`   | #232의 PR 본문(계획 수정 PR의 본문 예)                                    |
| `pr-188-body-v15.md`    | #188의 마지막 PR 본문(step PR의 본문 예)                                  |
