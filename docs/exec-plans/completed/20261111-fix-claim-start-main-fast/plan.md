---
id: 20261111-fix-claim-start-main-fast
issue: 4 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: runner-1 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-11T20:38:21+09:00 # new-task가 채운다
---

# fix: 대화형 경로의 claim 해제와 start의 main fast-forward

## 목표와 수용 기준

출처: Issue #4(제작자 대화 지시, 2026-11-11). 두 가지 세션 시작 절차의 빈틈을 고친다.

1. **선점 해제**: 대화형 경로(`complete-step` → PR → 병합)에는 `claim/<N>` 해제가 없다. `start`의 worktree 정리(`cleanupMerged`)가 `releaseClaim`을 부르기는 하지만, 마지막 step의 worktree가 로컬에 남아 있고 깨끗하고 PR이 병합된 경우에만 동작한다. 그래서 Issue #1이 닫힌 뒤에도 원격 `claim/1`이 남았다.
2. **main 동기화**: `start`는 fetch만 하고 로컬 main을 당기지 않는다. 그래서 병합 뒤에도 main 체크아웃의 `harness.config.json`이 옛 버전으로 읽혀 "github.owner(제작자 계정)가 비어 있어" 경고가 났다.

수용 기준(Issue #4 그대로 + 구체화):

- `start` 뒤에 닫힌 Issue의 `claim/<N>` 브랜치가 원격에 남지 않는다. 로컬 worktree가 없어도(손으로 지웠거나 다른 머신에서 작업했어도) 지운다.
- 닫혔음을 GitHub에서 확인하지 못한 claim(조회 실패, 없는 번호)과 열린 Issue의 claim은 지우지 않는다.
- main 체크아웃이 깨끗하고 fast-forward가 가능하면 `start`가 `origin/main`까지 당긴다. 아니면 이유(다른 브랜치, 미커밋 변경, 로컬 전용 커밋, merge 실패)를 출력하고 넘어간다. 어느 경우에도 `start`의 종료 코드는 바뀌지 않는다.
- `start`는 main을 당긴 뒤 `harness.config.json`을 다시 읽어, 같은 실행에서 새 설정을 쓴다(위 owner 경고가 재현되지 않는다).
- 두 동작 모두 테스트가 있다(로컬 bare 원격, `github-fake`). `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

- 범위
  - `scripts/lib/git.ts`: main 체크아웃 fast-forward 함수(`fastForwardMain`).
  - `scripts/commands/start.ts`: fast-forward → 설정 재로드 → ② 정리 절에 main 동기화 결과와 선점 해제 결과 출력.
  - `scripts/commands/task.ts`: 원격 claim 목록, 닫힌 Issue의 claim 해제(`listRemoteClaims`, `releaseClosedClaims`), `releaseClaim` 반환값.
  - `scripts/runner/run.ts`: `syncMain`이 `fastForwardMain`을 쓰도록(동작 동일).
  - `scripts/runner/next.ts`: claim 목록 파싱을 `listRemoteClaims`로(동작 동일).
  - 테스트 `scripts/test/start.test.ts`(새 파일), 필요하면 `scripts/test/helpers.ts`.
  - 문서: `AGENTS.md` 세션 시작 절차, `docs/harness/workflow.md` 1절, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD 등록).
- 비범위
  - 만료 선점 정리(24시간 무응답 claim). 정기 작업이고 인수 절차가 따로 있다 → TD-11 그대로.
  - runner가 실행 중에 바뀐 `harness.config.json`을 다시 읽는 것 → TD로 등록만(발견 사항).
  - runner 루프에서 닫힌 Issue의 claim 정리. runner는 `cleanupMerged`로 자기 선점을 이미 푼다.
  - main 체크아웃이 더러울 때 stash·reset 등으로 강제로 맞추기. 이유만 출력한다.
  - 설계서(`docs/harness/design.md`) 변경. 8.3절·10.3절 절차 5가 이미 "마지막 step 병합 뒤 claim 정리"를 요구하고, 이번 변경은 그 구현이다.

## 관련 파일·문서

- scripts/lib/git.ts
- scripts/commands/start.ts
- scripts/commands/task.ts
- scripts/runner/run.ts
- scripts/runner/next.ts
- scripts/test/start.test.ts
- scripts/test/helpers.ts
- AGENTS.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261111-fix-claim-start-main-fast/

## step 목록

- step0 main-sync: `fastForwardMain`(lib/git.ts)을 만들어 `start`가 main을 당기고 설정을 다시 읽으며, 못 당기면 이유를 출력한다. runner `syncMain`도 같은 함수를 쓴다.
- step1 claim-release: `start`가 닫힌 Issue의 `claim/<N>`을 원격에서 지운다(`releaseClosedClaims`). `next.ts`의 claim 목록 파싱을 공용 함수로 바꾼다.

## 진행 로그

- 2026-11-11 20:47 계획 작성(runner-1 무인 세션). 코드 변경 없음. step 2개로 나눴다. 이 세션에서는 `git ls-remote`(네트워크)가 권한 설정으로 거부되어 실제 원격의 claim 현황은 확인하지 못했다(계획에는 영향 없음).
- 2026-11-11T20:49:44+09:00 계획 작성 완료
- 2026-11-11 step0 main-sync(runner-1 무인 세션)
  - 먼저 실패한 테스트 1: `node --test scripts/test/start.test.ts` → 파일 전체 실패(`lib/git.ts`에 `fastForwardMain` export 없음).
  - `fastForwardMain`만 구현한 뒤 같은 명령: 단위 6개 통과, `start` 통합 3개 실패. 실패 요지: 로컬 main HEAD ≠ `origin/main`(당기지 않음), 출력에 "harness.config.json github.owner(제작자 계정)가 비어 있어" 경고 재현, `## ② 정리`·`- main:` 줄 없음. Issue #4 증상 재현 확인.
  - `start.ts`(fetch → fast-forward → 설정 재로드 → ①②③, ② 첫 줄에 main 동기화 결과)와 runner `syncMain`(`fastForwardMain` 호출만) 변경 뒤 `node --test scripts/test/start.test.ts scripts/test/runner.test.ts` 11개 모두 통과.
  - 문서: `AGENTS.md` 세션 시작 절차 2번, `docs/harness/architecture.md` `lib/git.ts` 행, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md` TD-21 등록.

- 2026-11-12 11:07 (KST) 제작자 지시로 runner-1 소유 PR #14 충돌 해결을 넘겨받았다. 대상 worktree `feat/20261111-fix-claim-start-main-fast-s0`는 rebase 전 깨끗했다. 지정 worktree에서 `node scripts/harness.ts start`를 다시 실행한 결과 열린 `needs-human` 항목은 없었다.
- `origin/main` (`913c9d6`) 위로 rebase했다. `scripts/commands/start.ts`, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`의 충돌을 해결했고, main의 Issue 후보 제외 및 병합 worktree 보호 변경을 보존했다. main에서 TD-17이 Issue #16 step4로 이미 사용·해결되어, step0의 조건부 지침에 따라 runner 설정 캐시 부채를 TD-21로 옮기고 계획·index 참조를 맞췄다. rebase 결과의 작업 커밋은 `bf5e977`, 계획 전용 커밋은 `000e728`이다.
- 원격 PR branch는 여전히 이전 커밋 `ef78279`를 가리킨다. rebase 결과를 반영하려면 non-fast-forward 갱신이 필요하지만 R2가 force push를 금지하므로 수행하지 않았다. PR #14의 GitHub 상태는 아직 갱신되지 않았다.

- 2026-11-12 11:29 (KST) 제작자가 PR #14 갱신을 추가 지시했다. 재확인 결과 PR은 OPEN이고 원격 head는 예상한 `ef78279`, `origin/main`은 `913c9d6` 그대로다. 포맷 수정 뒤 `node scripts/harness.ts check`가 통과했다. `--force-with-lease` 갱신은 시도했지만, Git 실행 전 L1 hook이 R14로 차단했다. 원격 ref는 변경되지 않았다.

- 2026-11-12 11:35 (KST) 최종 `node scripts/harness.ts check` 통과(fmt·lint·test·doc-lint·bypass-scan·secret-scan; 기존 R8 경고 5건). 확인한 원격 head `ef78279`를 lease에 고정해 PR branch 갱신을 시도했으나, PreToolUse L1 hook이 `[R14 파괴적 git]`로 명령을 차단했다. Git push는 실행되지 않았고 원격 ref는 그대로다. hook을 우회하지 않는다.

- 2026-11-12 12:10 (KST) 제작자가 merge 방식 갱신을 승인했다. PR #14 OPEN, 원격 head `ef78279`, `origin/main` `913c9d6`을 재확인했다. `git merge -s ours`로 병합 커밋 `22ba806`(부모 `e6d9418`·`ef78279`, 트리는 `e6d9418`과 같음)을 만들고, `check`·`plan-gate` 통과 뒤 일반 push로 갱신했다. (2026-11-12 Issue #35로 옮겨 적음. 원래 기록은 Issue #4 댓글이다. 그때는 계획 owner가 `runner-1`이라 L1 훅 R3가 대화 세션의 계획 수정을 막았다.)

- 2026-11-12 13:41 (KST) step1 claim-release(runner-1 무인 세션). 브랜치 `feat/20261111-fix-claim-start-main-fast-s1`.
  - 먼저 실패한 테스트 1: `node --test scripts/test/start.test.ts` → 파일 전체 실패(`SyntaxError: ... '../commands/task.ts' does not provide an export named 'listRemoteClaims'`).
  - `task.ts`(`listRemoteClaims`, `releaseClaim` 반환값, `releaseClosedClaims`)만 구현하고 `start.ts`는 그대로 둔 뒤 같은 명령: 24개 중 단위 14개 통과, `start` 통합 2개 실패. 실패 요지: (1) `start` 뒤에도 원격에 `claim/2`가 남음(`deepEqual` actual에 `'claim/2'`), 출력에 `## ② 정리`가 `- 병합된 worktree: 없음`에서 끝나 선점 해제 줄 없음 — Issue #4 증상 재현 (2) claim 목록 조회 실패 경고 없음.
  - `start.ts` ② 절에 `releaseClosedClaims` 호출·출력, `next.ts` 5번 우선순위를 `listRemoteClaims`로 바꾼 뒤 `node --test scripts/test/start.test.ts scripts/test/runner.test.ts` 24개 모두 통과.
  - 문서: `AGENTS.md` 세션 시작 절차 2번, `docs/harness/workflow.md` 1절 선점 설명, `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md` "상태가 사는 곳" 선점 행.
- 2026-11-12 (KST) step1 이어서(runner-1 무인 세션, 앞 세션의 미커밋 변경을 이어받음). 변경 diff를 다시 검토하고 AC를 실행했다: `node --test scripts/test/start.test.ts scripts/test/runner.test.ts` 24개 통과, grep 3개 통과, `AGENTS.md` 73줄. `node scripts/harness.ts check` 통과(R8 경고 4건, 아래 결과 참고). `index.json` step1 summary, "검증 방법과 결과"의 step1 결과를 채웠다.

## 의사결정 로그

- 결정: 선점 해제 기준을 로컬 worktree 상태가 아니라 "GitHub Issue가 닫혔는가"로 한다. 이유: Issue는 마지막 step PR의 `Closes #N`으로 닫히므로 8.3절의 "마지막 step 병합"과 같은 뜻이고, worktree를 손으로 지웠거나 다른 머신에서 병합한 경우도 잡는다. 버린 대안: `complete-step`에서 해제(PR 병합 전이라 다른 작업자가 같은 Issue를 선점할 수 있다), PR 병합 감시(대화 세션은 병합을 기다리지 않는다), `cleanupMerged` 조건 완화(로컬에 worktree가 없으면 여전히 못 본다).
- 결정: 닫혔음을 확인하지 못한 claim은 지우지 않는다(fail-safe). 이유: 살아 있는 선점을 지우면 두 작업자가 같은 Issue를 맡는다. 남은 claim은 다음 `start`가 다시 본다.
- 결정: 선점 해제는 `start`(세션 시작 절차 ②)에서만 한다. 이유: Issue #4의 범위가 대화형 경로이고, runner는 `cleanupMerged`로 자기 선점을 푼다. runner 매 바퀴에 GitHub 조회를 늘리지 않는다. 버린 대안: runner idle 분기에도 호출.
- 결정: main fast-forward는 `scripts/lib/git.ts`의 `fastForwardMain` 하나를 runner(`syncMain`)와 `start`가 함께 쓴다. `start`만 결과 이유를 출력하고, runner는 지금처럼 결과를 무시한다. 이유: 같은 규칙을 두 번 구현하지 않는다. runner 출력은 매 바퀴 반복되므로 늘리지 않는다.
- 결정: "깨끗함"은 기존 `isClean`(추적 안 된 파일 포함)으로 판정한다. 이유: runner `syncMain`과 같은 기준이고 수용 기준의 "깨끗하고"에 맞는 보수적 선택이다. 버린 대안: 추적 파일 변경만 보기(`merge --ff-only`가 덮어쓰기 충돌은 막아 주지만 runner와 기준이 갈린다).
- 결정: `start`는 당긴 뒤 설정을 다시 읽는다. 이유: Issue #4 owner 경고의 직접 원인이다. 결과 출력은 ① needs-human 보고 순서를 지키도록 ② 정리 절에 둔다.
- 결정: 하네스 스크립트가 main 체크아웃을 `merge --ff-only`로 당기는 것은 R3("main 체크아웃은 고치지 않는다") 위반으로 보지 않는다. 이유: 에이전트가 파일을 고치는 것이 아니라 원격 기본 브랜치에 맞추는 것뿐이고, fast-forward만 하므로 로컬 커밋·미커밋 작업을 잃지 않는다. runner `syncMain`이 이미 같은 일을 한다.
- 결정: step 2개(main-sync, claim-release)로 나눈다. 이유: 두 동작이 독립적이고 각각 PR 하나(400줄 안팎)에 든다. main-sync를 먼저 하는 이유는 claim-release 통합 테스트가 PR 병합으로 원격 main을 앞서게 만들어 `start`의 동기화를 함께 거치기 때문이다.

- 결정: runner 설정 캐시 부채를 TD-21로 등록한다. / 이유: origin/main에서 TD-17은 Issue #16 step4로 이미 사용·해결되어 있고, step0 계획의 조건부 지침은 다음 빈 번호 사용을 허용한다. / 버린 대안: TD-17을 중복 등록한다.

- 시도: 제작자의 후속 지시에 따라 PR #14 branch만, 예상 head `ef78279`를 고정한 `--force-with-lease`로 갱신하려 했다. / 이유: 로컬 rebase 결과를 원격 PR에 반영하려면 이력이 바뀌어야 한다. / 결과: L1 hook이 R14 파괴적 git으로 차단했고 push 명령은 실행되지 않았다. / 금지한 대안: hook 우회.

- 결정: rebase 결과 위에 이전 PR head를 `-s ours`로 병합해 일반 push로 PR #14를 갱신한다. / 이유: 이력을 덮어쓰지 않아 R2·R14 안에서 끝나고, 트리가 `check`를 통과한 `e6d9418`과 같으며, squash 병합이라 main 이력에는 차이가 없다. / 버린 대안: 새 브랜치로 새 PR(로컬·PR 브랜치 이름이 갈라진다), 제작자 직접 force push. (Issue #4 댓글에서 옮겨 적음, Issue #35. 이 방식은 뒤에 ADR-0006과 절차서 5절의 표준이 됐다.)

- 결정(step1): `listRemoteClaims`는 ref 이름 전체가 정확히 `refs/heads/claim/<1 이상 정수, 앞자리 0 없음>`인 것만 센다. 이유: `ls-remote` 패턴은 꼬리 일치라 `feat/claim/5`·`claim/1/x`도 돌아오고, `claim/04`를 4로 읽으면 `releaseClaim`이 다른 이름(`claim/4`)을 지우려 한다. `claimIssue`는 항상 `claim/${정수}`로 만들므로 잃는 것이 없다. 버린 대안: 기존 `next.ts` 정규식(앵커 없음) 재사용.
- 결정(step1): `releaseClaim`은 지정대로 `boolean`만 돌려주고, `releaseClosedClaims`는 같은 내부 함수(`deleteClaim`)의 stderr 첫 줄을 `failed.reason`에 쓴다. 이유: 시그니처를 지키면서 실패 이유를 출력하기 위해서. `cleanupMerged`는 그대로(반환값 무시).
- 결정(step1): `start` ② 절에서 해제·확인 실패가 하나도 없으면 `- 닫힌 Issue의 선점: 없음` 한 줄을 낸다. 이유: 같은 절의 `- 병합된 worktree: 없음`과 맞춰 단계가 실행됐음을 보인다. 열린 Issue의 claim(`kept`)은 정상 상태라 출력하지 않는다.
- 결정(step1): `releaseClosedClaims`가 TaskError 말고 다른 예외(프로그래밍 오류)를 던지면 `start`에서 잡지 않는다. 이유: 명세는 claim 목록 조회 실패(TaskError)만 경고로 넘기라고 했고, `getIssue`·삭제 실패는 함수 안에서 `failed`로 모은다.

## 발견 사항

- `start`의 ② 정리(`cleanupMerged`)는 이미 `releaseClaim`을 부르지만, 마지막 step의 worktree가 로컬에 남아 깨끗하고 PR이 병합된 경우에만 동작한다. Issue 본문의 "runner에서만 호출"보다 "조건이 좁아 대화형 경로를 놓친다"가 정확한 원인이다 → 처리: 해당 없음(step1에서 닫힌 Issue 기준 정리로 보완)
- runner는 시작할 때 읽은 `harness.config.json`(`runRunner`의 `cfg`)을 끝까지 쓴다. 매 바퀴 `syncMain`으로 main을 당겨도 설정 변경은 runner를 다시 시작해야 반영된다 → 처리: TD-21 (step0에서 등록. TD-17은 main에서 이미 사용·해결되어 다음 빈 번호를 썼다)
- 기존 runner `syncMain`은 `isClean`(git 실패 시 예외)을 먼저 불러 git status가 실패하면 runner 바퀴가 예외로 끊길 수 있었다. `fastForwardMain`은 모든 git 실패를 `skipped`로 돌려주므로 이 경우 조용히 넘어간다. 판정 순서도 "브랜치 → 깨끗함"으로 바뀌었지만 결과(당김/안 당김)는 같다 → 처리: 해당 없음
- `start`는 당긴 뒤 설정을 다시 읽으므로, 원격 main의 `harness.config.json`이 깨져 있으면 재로드에서 `ConfigError`로 끝난다. 사람이 손으로 pull 한 뒤 `start`를 실행한 것과 같은 결과이고, 메시지에 파싱·검증 실패 내용이 나온다 → 처리: 해당 없음
- (step1) `git ls-remote --heads <remote> 'claim/*'`의 패턴은 꼬리 일치(`*/claim/*`)라 `feat/claim/5`, `claim/1/x`도 돌려준다. 기존 `next.ts` 정규식은 앵커가 없어 `claim/1/x`를 #1 선점으로 셌다(그런 브랜치를 만드는 코드는 없어 실제 영향은 없었다) → 처리: 해당 없음(`listRemoteClaims`가 정확히 `claim/<숫자>`만 세도록 고침, 테스트 포함)
- (step1) 실제 `GhCli.listOpenIssues`는 `--limit 200`이다. 열린 Issue가 200개를 넘으면 목록에 없는 열린 Issue의 claim이 생기지만, `releaseClosedClaims`가 `getIssue`로 다시 확인해 `open`이면 남긴다(테스트 "목록에 없어도 GitHub에서 열려 있으면 지우지 않는다") → 처리: 해당 없음
- (step1) runner 루프는 `releaseClosedClaims`를 부르지 않는다(금지사항). runner는 자기 선점을 `cleanupMerged`로 풀고, 다른 경로로 남은 claim은 다음 대화 세션 `start`가 정리한다. runner만 오래 도는 기간에는 그런 claim이 남아 있을 수 있지만 닫힌 Issue는 후보가 아니라 새 선점을 막지 않는다 → 처리: 해당 없음
- (step1) 마지막 PR 병합으로 닫힌 Issue가 `start`가 돌기 전에 다시 열리면, 옛 `claim/<N>`은 "열린 Issue의 claim"이 되어 `start`가 남긴다(금지사항: 열린 Issue의 claim은 지우지 않는다). 이 경우 `new-task --issue <N>`이 "이미 선점되어 있다"로 거부된다. 만료 선점 정리(인수 절차 포함)의 범위다 → 처리: TD-11
- (step1) 실제 `GhCli`의 `toIssue`는 `state`가 `'OPEN'`이 아니면 모두 `closed`로 바꾼다. `gh issue view --json state`는 `OPEN`/`CLOSED`만 돌려주므로 지금은 안전하지만, `releaseClosedClaims`의 "닫혔음을 확인한 것만 지운다"는 이 매핑에 기댄다. `lib/github.ts`는 이 step 범위 밖이라 고치지 않았다 → 처리: 해당 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- 각 step의 AC 명령과 `node scripts/harness.ts check`(runner가 직접 실행해 판정).
- 수용 기준별 증거
  - 닫힌 Issue의 claim 해제: step1 `scripts/test/start.test.ts`. 가짜 PR 병합(`Closes #N`)으로 Issue를 닫고, 로컬 worktree 없이 `node scripts/harness.ts start`를 실행한 뒤 원격에 `claim/<N>`이 없음을 `git ls-remote`로 확인. 열린 Issue·없는 번호의 claim은 남는다.
  - main fast-forward: step0 `scripts/test/start.test.ts`. 원격이 앞서면 로컬 main HEAD == `origin/main`, 미커밋 변경·다른 브랜치·로컬 전용 커밋이면 HEAD가 그대로이고 출력에 이유가 있다.
  - 설정 재로드: step0 통합 테스트. 로컬 설정의 `github.owner`가 비어 있고 원격 main에서 채워졌을 때 `start` 출력에 owner 경고가 없다.
- 병합 뒤 실제 리포 확인(대화 세션, 선택): `node scripts/harness.ts start` 출력의 ② 절, `git ls-remote --heads origin 'claim/*'`.
- 결과
  - step0: `scripts/test/start.test.ts` — `fastForwardMain` 단위 (a) 당김 (b) 최신 (c) 미커밋 변경 (d) 다른 브랜치·detached (e) 로컬 전용 커밋(앞섬·갈라짐, 커밋 수 표시) + 원격 브랜치 없음, `start` 통합(당김 + owner 경고 없음, 미커밋 변경이면 이유 출력·HEAD 그대로, 최신) 통과. 통합 테스트는 고치기 전 `start.ts`에서 실패함을 확인(진행 로그). `node scripts/harness.ts check` 통과. doc-lint R8 경고(비차단): `docs/harness/architecture.md`는 이번에 갱신했고, `docs/harness/workflow.md`는 `start` 명령만 적고 절차를 풀어 쓰지 않아 갱신할 내용이 없고, ADR-0001·0002·0003·0005는 이 변경과 관계없다.
  - step1: `scripts/test/start.test.ts`에 7개 추가 — `releaseClosedClaims` (a) 가짜 PR 병합(`Closes #2`)으로 닫힌 #2만 해제, 열린 #1은 `kept`, 없는 #99는 `failed`(이유에 `#99`), `ls-remote`에 claim/1·claim/99만 남음, 다시 실행하면 `released` 빈 배열 (b) 열린 목록에 있는 번호는 `getIssue`를 부르지 않음 (c) 열린 목록이 비어도 GitHub에서 열려 있으면 남김; `listRemoteClaims` (d) `claim/abc`·`claim/3/x`·`claim/04`·`feat/claim/5`·`claimx/6`을 버리고 `[2, 10]` (e) 원격 조회 실패는 `TaskError`; `start` 통합 (f) 로컬 worktree 없이 종료 코드 0, claim/2 삭제·claim/1·claim/99 유지, 출력에 `- 선점 해제: claim/2 (Issue #2 닫힘)`·`- 선점 유지(확인 실패): claim/99 — …`, 재실행 멱등 (g) claim 목록 조회 실패 시 경고 `선점 정리 건너뜀` + 종료 코드 0. (f)·(g)는 `start.ts`를 고치기 전에 실패함을 확인(진행 로그). AC: `node --test scripts/test/start.test.ts scripts/test/runner.test.ts` 24개 통과, grep 3개 통과, `node scripts/harness.ts check` 통과. doc-lint R8 경고(비차단): `docs/harness/workflow.md`는 이번에 1절을 갱신했다(커밋 뒤 시각 비교로 해소될 것). ADR-0005(Windows)는 `task.ts`가 새로 쓰는 git 호출이 기존 `gitTry`(`lib/exec.ts`) 경로뿐이라 관계없고, ADR-0001·0003은 이 변경과 관계없다.

## 다음 할 일

- step1 claim-release: runner가 AC·`check`로 판정하고 push·PR(본문 첫 줄 `Closes #4`)·병합한다. 이 step이 마지막이다.
- 병합 뒤(대화 세션, 선택): main 체크아웃에서 `node scripts/harness.ts start`를 실행해 ② 절의 `- 선점 해제: claim/<N>` 줄과 `git ls-remote --heads origin 'claim/*'`로 Issue #1·#4의 claim이 사라졌는지 본다. 무인 세션에서는 실제 원격 claim을 지우는 외부 동작이라 실행하지 않았다.
