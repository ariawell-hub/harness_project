# 세션 인수인계 (2026-11-23)

> 대화 세션 하나가 2026-11-22~23에 한 일과 남긴 일. 제작자가 "현재 작업이 끝나면 종료하고 인수인계 문서를 만들라"고 해 만들었다.
> **이 파일과 같은 폴더의 `draft-step0.patch`는 TD-39의 초안 PR을 만들기 전에 지운다**(계획 검증에 들어갈 파일이 아니다). 브랜치는 이 두 파일을 담은 채 원격에 올라가 있다.

## 0. 이어받는 세션이 먼저 할 일

1. `node scripts/harness.ts start`를 실행한다.
2. 열린 `needs-human`: **#180**(Q10 확정, 다른 세션 담당 PR #188). 제작자의 워크플로 커밋은 올라갔고 그 세션이 이어 간다. 이쪽 일이 아니다.
3. 이 세션의 PR은 모두 병합됐다(3절). 열린 PR #217·#207·#188·#226은 다른 세션의 것이다. #226(`fix/20261123-results-not-inert`)은 보호 경로 설정(`harness.config.json`)을 고친다. TD-39를 시작하기 전에 겹치는지 본다.
4. `start`는 봇이 만든 Issue를 "다음 할 일" 후보에서 뺀다. 그래서 **#223, #224는 `start`에 나오지 않는다.** 2절을 보고 `new-task --issue <N>`으로 직접 맡는다.

## 1. 진행 중

### TD-39 — Issue #222 (PR마다 설계서 버전·변경 이력·CHANGELOG 대신 계획별 조각 파일에 적는다)

- 제작자 결정(2026-11-23 대화): **조각 파일로**. PR은 계획별 조각 파일에만 변경 이력·CHANGELOG 항목을 적는다. 버전을 매기고 모으는 일은 따로 여는 모으기 PR이 한다.
- worktree `harness_project.worktrees/feat/20261123-change-fragments-s0`, 브랜치 `feat/20261123-change-fragments-s0`(선점 `claim/222`). 규모 large, 위험도 high.
- 상태:
  - 계획 파일은 골격뿐이다. 아직 push하지 않았고 PR도 없다.
  - step0 초안(코드·테스트)은 `draft-step0.patch`에 있다. `git apply`로 적용한다. 초안 구현에서 새 테스트 5건과 있던 `harness-guard.test.ts`가 모두 통과했다(22건). 구현 전 실패는 아직 확인하지 않았다.
- 초안의 설계:
  - 자리: `docs/harness/changes/<계획 id>.md`. 계획 하나에 파일 하나이고, step PR은 자기 계획의 파일에 더한다. 계획이 다르면 파일이 달라 충돌하지 않는다.
  - 형식(`scripts/lib/changes.ts`의 `parseFragment`):

    ```markdown
    # 변경 조각: <계획 id>

    ## CHANGELOG

    - <한 줄>

    ## 설계서 변경 이력

    - <한 줄>
    ```

  - 형식 규칙:
    - 첫 줄의 id는 파일 이름과 같다. 섹션은 이 둘뿐이고 이 차례이며, `설계서 변경 이력`은 없어도 된다.
    - 섹션 안에는 `- ` 한 줄 항목과 빈 줄만 둔다. CHANGELOG 항목은 하나 이상이다.
    - 항목을 버전(`v0.7.1`)으로 시작하지 않는다.
  - `doc-lint`: 조각 폴더를 frontmatter·색인 검사에서 빼고(`NO_FRONTMATTER`), 새 규칙 `R8 변경 조각`으로 자리·이름·형식을 본다.
  - `harness-guard`: 보호 경로를 바꾼 PR은 CHANGELOG를 고쳤거나, 조각 파일에 base에 없던 CHANGELOG 항목을 더했으면 통과한다. 형식이 틀린 조각은 세지 않는다. 실패 문구에는 여전히 "CHANGELOG"가 들어간다(있던 테스트가 그 글을 본다).
- 계획에 넣을 step 안(아직 안 씀):
  - **step0 `fragments`**: 위 초안과 문서. 문서는 절차서 5절의 보호 경로 PR 규칙과 설계서 버전 규칙, 설계서 7.2절 트리·10.4절 `harness-guard` 행·R9 행, `.github/pull_request_template.md`와 `scripts/cross-review/checklist.md`의 "CHANGELOG 갱신" 문구, CHANGELOG 머리 문장이다.
    - 이 step의 PR은 main의 `harness-guard`(조각을 모르는 판)로 판정된다. 그래서 **CHANGELOG에 직접 한 줄을 적어야 한다**(옛 방식).
  - **step1 `collect`**: 모으기 명령 `node scripts/harness.ts changes-collect`.
    - 조각을 이름 차례로 읽는다.
    - 설계서 변경 이력 항목마다 다음 버전(패치 +1)과 오늘 날짜를 붙여 이력 끝에 넣고 머리말을 맞춘다.
    - CHANGELOG 항목은 "다음 버전 (미배포)" 끝에 그대로 옮긴다.
    - 조각 파일을 지운다. git 명령은 쓰지 않는다.
    - 조각이 없으면 바꾸지 않고 0으로 끝낸다. 결과는 `doc-lint`를 통과해야 한다.
    - 이 step은 step0이 병합된 뒤라 자기 조각 파일로 기록한다.
- 정할 것과 조사할 것:
  - CHANGELOG 항목에 "설계서 vX" 앞머리를 모으기가 붙일지 정한다. 초안은 붙이지 않고 그대로 옮긴다.
  - 기술 부채 표의 새 TD 행 번호도 같은 종류의 충돌이다. 계획에서 남길지 정하고, 남기면 새 TD 행으로 적는다.
  - `scripts/runner/prompt.ts`의 충돌 해결 안내(설계서 버전·이력, CHANGELOG, TD 번호)를 고칠지 정한다. 모으기 PR과 옛 방식 PR이 남는 동안은 그대로 둬도 된다.
  - 다른 세션의 계획·PR이 같은 파일(`scripts/gates/harness-guard.ts`, `doc-lint.ts`, `scripts/harness.ts`)을 고치는지 시작 전에 본다(#217은 `scripts/harness.ts`를 고친다).
- 진행 차례:
  1. 계획 작성 → 이 파일과 패치를 지움 → 계획만 담은 커밋 → `check && fetch && behind=0 && push` → 초안 PR(`Refs #222`) → 계획 검증(G1).
  2. 승인되면 테스트만 담은 커밋(구현 전 실패를 진행 로그에) → 구현 → 문서 → `complete-step` → 구현 판정.

## 2. 맡지 않은 일 (Issue만 있다)

### Issue #223 — TD-50 (Codex 사용 한도로 판정이 없으면 이유와 풀리는 시각을 알린다)

- 제작자 결정(2026-11-23): **기다림 + 알림**. 검증은 약화하지 않는다.
  - 한도가 풀릴 때까지 병합하지 않는다(상태는 지금처럼 error).
  - 대신 `review/codex` 설명과 runner의 `needs-human` 알림에 사용 한도와 풀리는 시각을 적는다.
  - 한도 오류에는 판정을 다시 돌리지 않는다.
- 단서:
  - `scripts/ci/codex-scan.ts`가 `turn.failed`를 본다. `scripts/test/codex-scan.test.ts`에 한도 문구 예가 있다.
  - 커밋 상태 설명은 기록 job이 쓴다(`scripts/ci/record.ts`의 `recordReview`. 지금 설명은 "판정 job 실패 또는 유출 검사 불통과").
  - runner의 CI 대기 알림은 `scripts/runner/run.ts`에 있다("runner는 판정 워크플로를 다시 실행하지 않는다").
- 판정 job이 이유를 기록 job에 넘기려면 워크플로 파일(`.github/workflows/judge-codex.yml`)을 고쳐야 할 수 있다. 봇은 워크플로를 올릴 수 없으므로 제작자 작업으로 모아 요청한다.
- 규모 medium, 위험도 high.

### Issue #224 — Q13 결정 기록 (리포를 개인 계정에 둔다)

- 제작자 결정(2026-11-23): **개인 계정 유지**.
- 문서만 바꾼다:
  - 설계서 18절 Q13 행을 결정으로 닫는다.
  - 14.6절의 외부 테스터 문단과 `docs/decisions/ADR-0008-actions-cost.md`의 E2 행을 결정에 맞춘다.
- 규모 small, 위험도 low.
- TD-39 step0이 병합된 뒤면 조각 파일로 기록한다. 그 전이면 옛 방식(설계서 버전·이력, CHANGELOG)으로 하되, 다른 PR과 번호가 겹치는지 push 직전에 본다.

### TD-35 (한 줄로 만드는 CI 함수가 U+2028·U+2029를 남긴다)

- 다른 세션의 PR **#217**(계획 `20261122-plan-review-parked`)이 같은 파일(`scripts/ci/ledger.ts`, `scripts/ci/review-round.ts`)을 고칠 예정이라 미뤘다. #217이 병합된 뒤 시작한다.
- 대상: `scripts/ci/ledger.ts`·`record.ts`·`review-round.ts`의 `oneLine`, `scripts/ci/results.ts`의 `cleanDescription`.
  - `\p{Cc}`만 지운다. runner 쪽(`scripts/runner/prompt.ts`의 `LINE_BREAKS`)은 `[\p{Cc}\p{Zl}\p{Zp}]`를 지운다.
- 주의: `scripts/test/record.test.ts`의 `reviewLogLines` 형식 테스트가 있다(바꾸지 않는다고 적혀 있다).

### 그 밖

- **#194**는 봇이 만든 Issue라 `start`가 후보에서 뺀다. 제작자 확인 없이 맡지 않는다.

## 3. 이 세션에서 끝낸 일

- PR #209(TD-31, Issue #208) 병합.
- PR #221(TD-48, Issue #220): 기록 job의 커밋 상태 쓰기가 GitHub의 일시 오류(HTTP 5xx, 응답 없음)에 다시 보낸다(상태 하나에 4번까지, 다시 시도에 더 쓰는 시간은 poster 하나에 60초까지, 다시 시도는 poster 안에서 한 번에 하나씩). 2026-11-23 제작자 승인(head `2d1c0c0`), 병합 `e9f7ad6`. 설계서 v0.7.81.
- PR #219(TD-28, Issue #218): 판정 코드가 git 경로 인자를 `--literal-pathspecs`로 넘긴다. 병합 `c24444c`.
- 새 TD 행:
  - **TD-68**(#218에서 발견): `harness-guard`의 파일별 diff 실패를 조용히 넘긴다. 이 리포의 `node --test <파일>`이 파일 이름을 glob으로 읽는다.
  - **TD-69**(#220에서 발견): 다른 GitHub API 호출(원장 댓글, PR 읽기)은 다시 시도하지 않는다.

## 4. 이 세션에서 쓴 요령

- **push 전에**: `pr-state`의 "오래 열린" 줄 수, 초안이 아닌 열린 PR 목록, `git rev-list --count HEAD..origin/main`을 본다. push는 `check > 파일 && git fetch -q origin && [ behind = 0 ] && git push origin <브랜치>`로 묶는다.
- **판정 대기**: 백그라운드로 기다린다.
  1. head의 `check.yml` 실행이 3분 안에 생기는지 본다(충돌이면 생기지 않는다).
  2. statuses에 `review/claude`·`review/codex`·`review-ledger`·`plan-gate` 넷이 모일 때까지 `until … sleep 30`한다.
  3. `pr-state`를 본다.
  4. 원장 댓글(`harness-ledger:v1`)의 `| F…` 줄과 judge 실행 로그의 `[P…]`·근거·제안을 읽는다.
- **main 병합으로 번호가 겹칠 때**: `git merge --no-commit --no-ff origin/main` → 충돌한 설계서·CHANGELOG·tracker는 `git checkout --theirs -- <파일>`(main 쪽) → 이 작업의 문서 변경을 스크립트로 새 번호에 다시 적용 → `fmt` → 병합 커밋.
  - 위험도 high는 문서 충돌로 patch-id가 바뀌면 판정이 다시 돈다.
- **새 테스트 파일이 새 모듈을 쓸 때**: 동적 import에 `.catch(() => ({}))`를 붙인다. 성공·예외는 값으로 받아 단언한다(#221의 `outcome` 도우미). 이렇게 해야 이 변경 전의 코드에서도 단언 실패(test-effect의 `assertion`)로 끝난다. 그러지 않으면 `other`로 끝나고 검증자가 지적한다.
- **동시에 보낸 요청이 서버에 닿는 차례에 기대는 테스트는 흔들린다.** 응답은 요청 내용(context)마다 정한다.
- **`git stash`는 쓰지 않는다**(worktree끼리 공유된다). 초안은 `git diff > 패치` → 파일별 `git checkout -- <파일>` → `git apply`로 다룬다.
- **`gh pr ready`는 L1 훅이 막는다.** 되돌릴 때도 `node scripts/harness.ts pr-ready --pr N --undo`를 쓴다. `--undo`는 자동 병합도 끈다. 다시 해제할 때 `gh pr merge N --auto --squash`를 다시 켠다.
- 한글이 많은 치환은 Write로 python 스크립트를 만들어 `count == 1`을 단언하며 바꾼다. prettier가 들여쓰기를 바꾸므로 대상 글은 `fmt` 뒤의 실제 글로 맞춘다.
