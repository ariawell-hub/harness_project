---
id: 20261115-runner-pr-flow
issue: 56 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-15T20:49:34+09:00 # new-task가 채운다
---

# feat: 2단계④ runner와 PR 흐름 연결 — CI 대기, 지적 대응, WIP, 작업자 2개 (TD-9)

## 목표와 수용 기준

로드맵 2단계의 넷째 Issue다. runner는 1단계 형태 그대로라 PR을 만들고 자동 병합을 켠 뒤의 일을 모른다. 체크 요약(`statusCheckRollup`)에 실패가 하나라도 있으면 "CI 실패"로 보고 수정 세션을 띄우는데, 2단계에서는 제작자 승인을 기다리는 `risk-gate`, 검증자의 수정 요청(`review/*`), 열린 지적(`review-ledger`)도 모두 실패 상태로 온다. 계획 검증(G1)이 켜져 있어(`planReview.required: true`) 계획과 코드를 함께 올리는 지금 흐름은 `plan-gate`에서 막힌다. 이 계획은 runner가 2단계 PR 흐름(#53~#55가 만든 필수 체크·판정·원장·G1)을 따라가게 한다.

수용 기준:

1. **출처 기준 판정**: runner, `start`, `next`는 PR의 필수 체크 상태를 설정 `ci.requiredChecks`의 context마다 "기대 출처가 쓴 가장 최근 결과"로 판정한다. `source: recorder`는 작성자가 `ci.recorderBot`인 커밋 상태, `source: actions`는 GitHub Actions App의 check run이다. 다른 계정·App이 쓴 같은 이름의 결과는 없는 것으로 본다(나중에 쓰였어도 검증 App의 결과를 가리지 않는다). `ci.requiredChecks`가 빈 리포는 지금처럼 체크 요약으로 판정한다.
2. **대기와 조치 구분**: PR 하나의 상태를 다음 중 하나로 정한다. `check`(Actions) 실패는 바로 수정 세션. 그 밖에는 필수 체크가 모두 끝난 뒤에 판단한다: 진행 중이거나 아직 없으면 CI 대기, `plan-gate`·`deps-guard`·`harness-guard` 실패는 상태 설명을 넣은 수정 세션, `review/*`·`review-ledger` 실패는 지적 대응, `error` 상태는 대기, `risk-gate`만 실패면 제작자 승인 대기. 제작자 승인 요청은 Issue에 `needs-human`과 멘션으로 head마다 한 번만 올린다. 같은 head에서 CI 대기·`error`가 `limits.ciStallHours`(기본 24시간)를 넘으면 `needs-human`으로 한 번 알린다.
3. **PR 갱신과 승인 이어받기**: 충돌(DIRTY)은 바로 갱신한다. main에 뒤처진 PR은 필수 체크가 모두 success일 때(위험도 높음은 `risk-gate`를 뺀 나머지가 success일 때)만 `origin/main`을 병합해 갱신한다. 수정 요청이나 판정 진행 중인 PR을 갱신해 검증자 판정을 한 번 더 돌리지 않는다. 뒤처짐은 GitHub의 `mergeStateStatus`가 아니라 로컬 git(`origin/main`이 PR head의 조상인가)으로 판단한다.
4. **계획 검증(G1) 흐름**: `planReview.required`가 켜진 리포에서 runner는 중·대 규모 계획을 계획만 담은 커밋으로 push하고 초안 PR을 연 뒤, 원장의 계획 승인(해시가 지금 계획과 같고 두 검증자가 모두 있음)을 확인하고 나서야 step 세션을 띄운다. step이 끝나면 같은 PR의 초안을 해제하고 자동 병합을 켠다. 계획이 main의 것과 해시가 같은 PR(둘째 step부터)과 소규모 계획은 이 흐름을 거치지 않는다.
5. **지적 대응**: runner는 원장(작성자가 `ci.recorderBot`인 댓글)의 열린 P0·P1마다 세션을 하나씩 띄운다. 세션은 최소 수정을 하거나(커밋 메시지 `fix(F<번호>): …`), 지적이 틀렸다고 보면 절차서 8절 형식의 반박 문단을 낸다. runner가 수정은 AC·`check`로 직접 판정하고, 반박은 형식·근거를 검사해 PR 댓글로 단다. 한 라운드의 대응은 모아서 한 번만 push한다. 계획 검증 단계의 지적은 계획 파일만 고친다.
6. **지적별 실패 횟수와 교착**: 대응한 뒤 그 검증자가 다시 판정했는데도 열려 있는 지적은 실패 키 `F<번호>`로 1회 센다(9.2절). 3회에 방법 전환 지시, 5회에 계획을 멈추고 중단 보고를 올린다. 같은 지적에 반박을 2회 냈는데도 열려 있으면 교착으로 보고 `needs-human`으로 넘긴다(9.1절).
7. **발산 감지**: 대응을 push한 뒤의 라운드에서 (a) 새로 열린 차단 지적이 해소된 차단 지적보다 많거나, (b) 대응 head에서 CI `check`가 실패했거나, (c) 대응 전 열린 차단 지적과 같은 위치에 새 차단 지적이 열렸으면 수렴하지 않은 라운드다. runner는 마지막 수정 묶음을 `git revert`로 되돌려 일반 push하고(reset·force push 없음), 진행 로그에 원인을 적고, `review-round` 키로 실패 1회를 센다. 3회에 방법 전환 지시, 5회에 중단한다. 수정 세션 뒤 로컬 AC·`check`가 실패하면 그 수정을 되돌리고 `F<번호>` 실패로 센다.
8. **충돌 자동 해결**: `origin/main` 병합이 충돌하면 제작자 답을 기다리지 않고 충돌 해결 세션을 띄운다. 9.2절 한도에 닿으면 지금처럼 `needs-human`으로 넘긴다.
9. **작업자와 WIP**: `run`을 `--worker` 없이 실행하면 `limits.workers`(이 리포 2)만큼 작업자를 띄운다. 작업자마다 프로세스 하나이고 이름은 `<접두어>-<번호>`다. 작업자당 열린 PR(계획 검증 중인 초안 포함)이 `limits.wipPerWorker`에 닿으면 새 Issue를 선점하지 않는다.
10. **정지 알림**: runner가 실행 시간 상한, 사용량 한도, 연속 오류로 멈출 때 그 작업자가 맡은 끝나지 않은 계획의 Issue에 제작자 멘션 댓글(이유, 남은 일, 다시 시작하는 명령)을 남긴다. 같은 이유의 알림이 그 Issue의 마지막 댓글이면 다시 달지 않는다.
11. **실제 PR 확인**: 이 계획의 PR에서 `node scripts/harness.ts pr-state` 출력(출처별 필수 체크 상태와 분류, 진행 중 → 통과 전이)을 진행 로그에 남긴다. 실제 GitHub 응답으로 확인하지 못한 경로는 `tech-debt-tracker.md`에 남긴다.
12. **문서**: 설계서 4.5·10.2·10.3·19절, 절차서, 코드 구조 문서, `CHANGELOG`를 고치고 TD-9를 해결로 바꾼다.

## 범위 / 비범위

- 범위: `scripts/runner/`(상태 분류, 다음 할 일, 루프, 프롬프트, 지적 대응, 발산), `scripts/lib/github.ts`·`github-fake.ts`(PR head, 커밋의 체크, PR 댓글, 실행 로그), `scripts/lib/git.ts`·`config.ts`, `scripts/commands/start.ts`, `scripts/harness.ts`(`pr-state`, `run`), `scripts/ci/record.ts`(판정 로그 줄을 함수로 꺼내기만 한다. 형식은 그대로), 설정 `limits`, 테스트, 문서.
- 비범위:
  - `.github/workflows/`, `scripts/cross-review/`(프롬프트·스키마), `scripts/gates/`, `scripts/hooks/`, `.claude/runner-settings.json`(무인 권한 프로필)은 바꾸지 않는다. 판정·기록 job의 동작과 원장 형식도 그대로다.
  - 판정 워크플로 다시 실행(`gh run rerun`). `error`는 기다리고 오래되면 사람에게 알린다.
  - runner가 만든 PR이 보호 경로를 바꿨을 때 PR 본문의 `- [x] 보호 경로 변경:` 줄. runner는 적지 않는다. `harness-guard` 실패로 수정 세션이 한도에 닿으면 사람에게 넘어간다(step6에서 TD로 등록).
  - 위험도 높음 PR의 `pr-ready` 조건 전체(초안 유지, 기록 완료 확인). runner는 step 완료 때 초안을 해제하고, 승인 요청은 수용 기준 2대로 한다.
  - 대화 세션의 Stop 훅(`scripts/hooks/session.ts`) 표시.
  - 실제 GitHub에서의 runner 무인 시범 실행. 제작자가 만든 Issue와 구독 세션이 필요하다. #57(자체 테스트)이나 파일럿에서 한다.
  - `revert-check`·자체 테스트·운영 전환(#57), 지표 수집(17.2절), 만료된 선점 정리(TD-11), runner의 설정 다시 읽기(TD-21).

## 관련 파일·문서

- scripts/runner/
- scripts/lib/
- scripts/commands/
- scripts/ci/
- scripts/harness.ts
- scripts/test/
- harness.config.json
- AGENTS.md
- CLAUDE.md
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/decisions/ADR-0006-pr-update-merge.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261115-runner-pr-flow/

## step 목록

- step0 pr-state: 커밋의 체크를 출처와 함께 읽고(`commitChecks`), 필수 체크 상태와 PR 분류를 내는 순수 함수(`pr-state.ts`), `pr-state` 명령
- step1 pick-by-state: `pickNext`와 runner 루프가 분류를 쓴다(수정 세션·CI 대기·승인 요청·오래된 대기 알림·자동 병합 다시 켜기, 갱신 조건)
- step2 plan-review: runner의 계획 검증(G1) 흐름. 계획 전용 push·초안 PR·원장의 계획 승인 확인
- step3 review-fix: 원장의 열린 P0·P1마다 수정 세션, 판정, 한 번의 push, `F<번호>` 실패 키
- step4 rebuttal-evidence: 반박 문단 검사·PR 댓글, 교착, 판정 로그에서 근거·제안 읽기
- step5 divergence: 발산 신호 판정, `git revert`, `review-round` 키
- step6 workers-notify: 작업자 여러 개, 정지 알림, 충돌 자동 해결, 문서 정리

## 진행 로그

- 2026-11-15 step0: 계획 작성. #55(PR #89) 병합과 마무리(PR #91) 뒤 제작자 대화 지시("#56부터 시작하라")로 시작. 위험도는 제작자 결정(2026-11-15 대화: #55·#56·#57은 보통)에 따라 `normal`이다. `planReview.required: true`라 이 계획부터 계획만 담은 커밋을 먼저 올려 검증받는다.
- 2026-11-15 step0: 계획 검증(PR #92, 계획만 담은 커밋 `98e6395`). `review/claude` 승인(P2 1), `review/codex` 승인(지적 없음). 원장에 `계획 검증(G1): 해시 4215e28f88b8 · 승인: claude, codex`. 미룬 지적 F1(P2, step3의 중단과 `reopenStep` 순서)은 의사결정 로그에 반영했다.
- 2026-11-15 step0: 테스트 먼저. `node --test scripts/test/pr-state.test.ts` 종료 코드 1(`scripts/runner/pr-state.ts` 없음). 구현 뒤 16개 통과. AC 테스트(`pr-state`·`next`·`runner`·`cli`) 종료 코드 0(73개 통과. 변환 함수 `statusToCheck`·`checkRunToCheck`·`newestFirst` 테스트 2개를 더한 뒤 75개 통과). 전체 `check` 종료 코드 0. 도중에 `pr-state` 명령 테스트가 한 번 실패했다: 테스트가 없는 Issue의 댓글을 읽었다. "읽기만 한다"는 가짜 GitHub 상태 파일이 그대로인지로 확인하게 고쳤다.
- 2026-11-15 step0: `--pr <번호>`에 번호로 PR을 찾는 포트 메서드가 필요해 `getPR`을 더했다. 분류를 한 줄로 적는 `describeVerdict`와 명령 구현(`scripts/commands/pr-state.ts`)을 따로 뒀다(`pr-state.ts`는 순수 함수만 둔다).
- 2026-11-15 step0: 실제 PR 확인(수용 기준 11). PR #92의 계획 전용 head `98e6395`에서 `node scripts/harness.ts pr-state`:
  - 판정 진행 중: `check [actions]: success`, `plan-gate [recorder]: failure — 이 PR의 step0 상태가 pending이다(완료 처리 전) 외 1건`, `risk-gate`·`deps-guard`·`harness-guard` success, `review/claude`·`review/codex`·`review-ledger`는 `missing` → `분류: wait-ci (대기: review/claude, review/codex, review-ledger) · 뒤처짐: 아니오 · step 완료: 아니오`.
  - 판정 뒤: `review/claude [recorder]: success — 승인 (P2 1) patch:…`, `review/codex [recorder]: success — 승인 (지적 없음) patch:…`, `review-ledger [recorder]: success — 차단 지적 없음 (전체 1, 미룸 1)` → `분류: ready (조치할 것 없음)`. `plan-gate` 실패는 step이 끝나지 않은 PR이라 보지 않는다(규칙 5).
  - 병합된 PR #91(`--pr 91`): 8개 모두 success, `mergeStateStatus=UNKNOWN`, `분류: closed`.
  - 실제 응답에서 확인한 것: 커밋 상태의 작성자(`harness-recorder[bot]`)와 `check`의 check run App(GitHub Actions)으로 고르기, 진행 중 → 통과 전이, 초안·자동 병합 여부. 보지 못한 것: 흉내 상태가 섞인 커밋, check run 다시 실행, `error` 상태, 100개를 넘는 기록(페이지 넘김).
- 2026-11-15 step0: PR #92 병합(`2e8c59c`). 구현 head `073935d`에서 `review/claude`·`review/codex` 모두 승인(지적 없음), `plan-gate`는 원장의 계획 승인(해시 4215e28f88b8)으로 통과. `pr-state`로 `분류: ready`, `mergeStateStatus=CLEAN`을 확인한 뒤 GitHub이 자동 병합했다.
- 2026-11-15 step1: 테스트 먼저. `node --test scripts/test/runner-pr.test.ts` 종료 코드 1(`next.ts`에 `readPrWait` export 없음). 구현 뒤 9개 통과. AC 테스트(`next`·`runner-pr`·`runner`·`start`·`pr-state`) 종료 코드 0(101개 통과).
- 2026-11-15 step1: 작업 목록에 없던 것 세 가지를 더했다(의사결정 로그). 알림으로 붙인 `needs-human` 떼기(`settleNotices`), 알림에 대한 제작자 답 처리(`doAnswered`가 완료된 step을 되돌리지 않는다), 통과한 체크의 `pr:<context>` 키 초기화(`trackPrs`). `pickNext`는 읽은 worktree 목록(`locals`)을 함께 돌려주고 runner가 그것으로 대기 기록을 쓴다.

## 의사결정 로그

- 결정: runner의 계획 검증(G1) 흐름을 이 계획에 넣는다(수용 기준 4). / 이유: Issue 본문에는 없지만 `planReview.required: true`에서 runner가 계획과 코드를 함께 올리면 중·대 계획의 PR이 모두 `plan-gate`에서 막힌다. "runner와 PR 흐름 연결"의 전제다. / 버린 대안: 별도 Issue로 미루기(그동안 runner를 쓸 수 없다).
- 결정: 뒤처진 PR은 필수 체크가 모두 success일 때만 갱신한다(수용 기준 3). / 이유: 승인 이어받기(10.3절)는 앞선 head의 판정이 success일 때만 된다. 수정 요청 상태나 판정 중에 갱신하면 변경이 없는데도 검증자 판정이 한 번 더 돌아 한도와 라운드를 쓴다. 충돌은 `pull_request` 워크플로가 돌지 않아 아무것도 진행되지 않으므로 바로 푼다. / 버린 대안: 지금처럼 BEHIND면 바로 갱신.
- 결정: 뒤처짐은 로컬 git으로 판단한다. / 이유: `mergeStateStatus`가 실패한 필수 체크와 뒤처짐이 겹칠 때 어느 값을 내는지 확인한 기록이 없다. 조상 관계는 로컬에서 확실히 알 수 있다. `mergeStateStatus`는 충돌(DIRTY) 판단에만 쓴다.
- 결정: 커밋 상태는 context별 최신 하나만 주는 API(체크 요약, combined status)가 아니라 전체 목록에서 출처로 걸러 고른다. / 이유: 봇 PAT도 같은 이름의 상태를 쓸 수 있다(ADR-0003). 나중에 쓰인 흉내 상태가 검증 App의 상태를 가리면 안 된다.
- 결정: 지적 대응은 지적 하나에 세션 하나, push는 라운드에 한 번. / 이유: 10.2절 (6)의 지적별 최소 수정과, push마다 `check`와 두 검증자 판정이 도는 비용을 함께 맞춘다. / 버린 대안: 지적마다 push(라운드 수와 한도 소모가 지적 수만큼 늘어난다), 모든 지적을 한 세션에(수정이 얽힌다).
- 결정: 반박은 세션의 마지막 출력에서 절차서 8절 형식 문단을 runner가 골라 PR 댓글로 단다. / 이유: 무인 세션은 `gh`를 쓸 수 없고(권한 프로필), 형식 검사는 판정 워크플로와 같은 함수(`parseRebuttals`)를 쓸 수 있다. / 버린 대안: 세션이 파일로 남기기(추적되지 않는 파일 위치를 새로 정해야 한다), 권한 프로필에 `gh pr comment` 허용(프로필 완화).
- 결정: 지적의 근거·제안은 판정 실행의 `record` job 로그에서 읽고, 읽지 못하면 위치·제목만으로 진행한다. / 이유: 원장에는 위치와 제목만 있다(10.1절). 원장 형식을 바꾸면 댓글 상한과 기록 job을 건드린다. / 버린 대안: 원장에 근거를 넣기.
- 결정: 발산 대응의 되돌리기는 `git revert` 커밋이다. 작업 트리에 남은 변경도 먼저 커밋한 뒤 되돌린다. / 이유: `reset --hard`·force push는 R14다. squash 병합이라 PR 안의 되돌림 커밋은 main 이력에 남지 않는다.
- 결정: 작업자 여러 개는 작업자마다 프로세스 하나로 띄운다. / 이유: 루프는 동기 git·`gh` 호출과 프로세스 전역 상태(현재 폴더, 환경 변수)를 쓴다. 프로세스를 나누면 서로 영향이 없고 lock·로그도 지금 구조 그대로다. / 버린 대안: 한 프로세스 안의 비동기 루프 여러 개.
- 결정: 정지 알림은 진행 중인 계획의 Issue에 멘션 댓글로만 남기고 `needs-human` 라벨은 붙이지 않는다. / 이유: 라벨은 "제작자 답을 기다린다"는 뜻이고 답이 없으면 계속 남는다. 정지는 runner를 다시 시작하면 풀린다. 진행 중인 계획이 없으면 기다리는 일이 없으므로 알리지 않는다. / 버린 대안: 알림용 Issue 새로 만들기.
- 결정: 충돌 자동 해결을 넣는다(수용 기준 8). / 이유: TD-9 항목이고 설계서 4.5절이 2단계로 미뤄 둔 것이다. 충돌 해결로 PR 변경이 바뀌면 patch-id가 달라져 두 검증자가 다시 판정하므로(10.3절) 사람 답 없이 풀어도 검증이 남는다.
- 결정: runner는 PR 본문의 보호 경로 체크 줄을 적지 않는다(비범위). / 이유: 그 줄은 작성자가 보호 경로 변경을 확인했다는 표시다. runner가 기계로 채우면 `harness-guard` 검사의 뜻이 달라져 하네스 규칙 변경이 된다(9.1절). 대상 프로젝트에서 runner가 보호 경로를 바꾸는 일은 드물다.

- 결정: `code` 단계에서 실패 한도(5회)로 멈출 때는 step을 먼저 `reopenStep`으로 되돌린 뒤 `blockPlan`한다. 5회 중단 테스트는 계획 상태(`blocked`)와 step 상태를 함께 단언한다(step3 구현 때 따른다). / 이유: 완료된 step의 PR에 `blocked`를 올리면 `plan-gate`가 "완료된 step" 검사로도 실패해 열린 지적과 별개의 실패가 생긴다(4.5절, PR #29). step3 작업 2의 3번·4번은 순서를 정한 것이 아니다(PR #92 원장 F1). / 버린 대안: step3.md를 고쳐 다시 계획 검증받기(비차단 지적이고 구현 순서로 풀린다).
- 결정: "GitHub 반영 지연" 판단은 PR head를 worktree의 `HEAD`가 아니라 push한 커밋(원격 추적 브랜치 `<remote>/<브랜치>`)과 비교한다. / 이유: step1 작업 1은 `HEAD`와 비교한다고 적었지만, 수정 세션이 판정에 실패하면 push하지 않은 로컬 커밋이 남는다. 그때 `HEAD`와 비교하면 PR의 `check` 실패를 영영 CI 대기로 보고 다시 고치지 않는다. 의도(push한 커밋이 PR에 아직 안 보이는 경우만 기다린다)는 원격 추적 브랜치 비교로 맞는다. 뒤처짐도 PR head 기준으로 본다. / 버린 대안: 글자 그대로 `HEAD`와 비교.
- 결정: 승인 요청·오래된 대기 알림으로 붙인 `needs-human`은 runner가 뗀다(PR이 병합됐거나 `ready`가 되면, 할 일이 없는 바퀴에서). 제작자가 그 Issue에 답하면 라벨만 떼고 계획·step 상태는 그대로 둔다. / 이유: 떼지 않으면 남은 step이 있는 Issue에 라벨이 계속 남아 `start`가 매번 답변 대기로 보고한다. 기존 답변 처리는 step을 `in_progress`로 되돌리는데, 완료된 step의 열린 PR에서 그러면 `plan-gate`가 실패한다. / 버린 대안: 라벨 없이 멘션만(절차서 5절이 승인 요청에 `needs-human`을 쓴다).
- 결정: 오래된 대기를 알린 PR은 CI 대기가 아니라 사람 대기로 센다. / 이유: 알린 뒤에도 CI 대기로 세면 다른 할 일이 없을 때 runner가 끝없이 기다린다. 사람 대기로 세면 runner가 멈추고, 다시 시작하면 상태를 다시 읽는다.

## 발견 사항

- PR #91에서 Claude 검증자가 낸 미룬 지적(P2): 설계서 머리말 버전이 변경 이력과 반복해 어긋났는데 재발 방지(`doc-lint`가 머리말 버전과 변경 이력의 마지막 항목을 비교)가 기술 부채로 등록되지 않았다. step0에서 등록한다. → 처리: TD-33
- PR #92 계획 검증에서 Claude 검증자가 낸 미룬 지적 F1(P2): step3의 `doReview`가 한도에 닿아 `blockPlan`을 부르는 것(3번)과 완료된 step을 `reopenStep`으로 되돌리는 것(4번)의 순서가 모호하다. 완료 상태에서 `blocked`가 올라가면 `plan-gate`가 따로 실패한다. → 처리: [계획 의사결정 로그](plan.md)
- `gh pr view`의 `autoMergeRequest`와 `headRefOid`로 자동 병합 여부와 PR head를 읽을 수 있다. 병합된 PR의 `mergeStateStatus`는 `UNKNOWN`이다. → 처리: 해당 없음
- 기존 답변 처리(`doAnswered`)는 답을 받으면 step을 `in_progress`로 되돌린다. 완료된 step의 열린 PR에 달린 알림(승인 요청, 오래된 대기)에 제작자가 답하면 step이 되돌려져 `plan-gate`가 실패할 수 있었다. 알림에 대한 답은 상태를 바꾸지 않게 했다. → 처리: [설계서 4.5절 "내 PR 다루기"](../../../harness/design.md)
- 다른 세션(`start`)이 병합된 worktree를 먼저 지우면 runner가 알림 라벨을 떼지 못한다(표시가 worktree 상태 폴더에 있다). 마지막 step이면 Issue가 닫혀 문제가 없고, 남은 step이 있으면 라벨이 남는다. → 처리: TD-34

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일과 기존 runner·next 테스트)과 `node scripts/harness.ts check`.
- runner 흐름은 가짜 GitHub(`HARNESS_FAKE_GH`)과 가짜 에이전트로 끝까지 돌린다: 출처별 체크, 계획 승인 대기, 지적 대응 라운드, 발산 되돌리기, 작업자 2개, 정지 알림.
- 실제 GitHub 응답은 이 계획의 PR에서 `node scripts/harness.ts pr-state`로 확인해 진행 로그에 남긴다(수용 기준 11).
- 결과: (step마다 진행 로그에 적는다)

## 다음 할 일

- step0부터 차례로 진행한다. 계획만 담은 커밋으로 초안 PR을 열어 계획 검증을 받은 뒤 step0 구현을 올린다.
- 이 계획이 끝나면 #57(revert·자체 테스트·운영 전환). 실제 GitHub에서의 runner 무인 시범은 #57이나 파일럿에서 한다.
