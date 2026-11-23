---
id: 20261123-windows-test-speed
issue: 230 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-23T18:42:46+09:00 # new-task가 채운다
---

# Windows 네이티브에서 하네스 테스트가 느려 check의 test가 25~30분 넘게 걸린다 (runner 테스트 파일이 혼자 20분)

## 목표와 수용 기준

제작자의 Windows PC(네이티브, Git Bash, 20코어)에서 `check`의 `test`가 1516~1858초 걸린다(시간 제한 3600초, #228에서 올렸다). `scripts/test/runner.test.ts` 하나가 혼자 1257초다. 그동안 `check && push`를 지키려면 30분을 기다려야 한다.

잰 것(2026-11-23, "검증 방법과 결과"의 측정 1~4):

- 시간은 프로세스 수 × 회당 비용이다. 같은 테스트("반복 실패는 5회에 멈추고…")가 띄우는 동기 프로세스는 Windows 732개, macOS 743개로 거의 같고, 회당 비용이 다르다(git 한 번 Windows 55~94ms, macOS 약 9ms). 한 단계가 막히는 것이 아니다.
- `test`는 파일을 동시에 8개 돌리고, 한 파일 안의 테스트는 차례로 돈다. macOS에서 파일 78개의 시간 합은 1417초라 8개로 나누면 177초인데, 실제는 249초다. 가장 긴 파일(`runner.test.ts` 203초)이 끝나기를 기다리기 때문이다. Windows도 같은 꼴이다(파일 하나 1257초).
- `repoInfo`(`scripts/lib/git.ts`)는 부를 때마다 git을 둘 띄운다. 옛 `runner.test.ts` 37개가 1951번 불러 git을 약 3900번 띄웠다(그 파일의 동기 프로세스 9887개 가운데 39%). 그 가운데 926번은 상태 파일 경로(`pr-wait.json`, `conflict.json`, 질문 상태)만 구하려는 호출이라 브랜치도 필요 없다.
- `check`의 캐시 키(`cacheKey`)는 부를 때마다 `pnpm --version`(macOS 회당 156ms)과 `gitleaks version`(Windows 회당 약 390ms)을 실행한다. 이 계획에서는 줄이지 않는다(의사결정 로그 10).

그래서 두 가지를 한다. (1) 긴 테스트 파일을 나눠 동시 실행을 쓰게 한다(step0. 동작 코드는 그대로다). (2) 같은 프로세스에서 같은 것을 다시 읽으려고 띄우는 프로세스를 줄인다(step1). 테스트를 줄이거나 건너뛰거나 단언을 약화하지 않는다.

수용 기준:

1. 테스트는 그대로다: step0 뒤 `scripts/test/*.test.ts`의 최상위 `test(` 블록 전부가 base(`origin/main`과의 merge-base)의 블록과 글자 그대로 같다(파일 사이에서 옮기기만 한다. step0의 AC 둘째 줄이 확인한다). step1은 있던 테스트 블록을 고치지 않고 새 테스트만 더한다.
2. step0 뒤 `runner.test.ts`·`runner-review.test.ts`·`runner-pr.test.ts`·`selftest.test.ts`의 테스트는 step0.md의 표대로 파일 10개에 나뉘어 있다. step0 AC 셋째 줄이 표의 처음·끝 테스트로 base 파일의 범위를 잘라, 그 테스트 블록들이 해당 파일에 같은 차례·글로 정확히 있는지 본다. 표의 묶음은 macOS 측정 3의 테스트별 시간으로 정했다: 나뉜 파일 하나의 합이 `selftest.test.ts`(테스트 하나, 86~88초) 말고는 75초 이하다. 시간은 머신·부하에 따라 달라(Windows는 약 5배) step AC로 판정하지 않는다. 나눈 뒤 macOS에서 잰 값을 진행 로그에 적는다(의사결정 로그 11). 벽시계 시간의 판정은 수용 기준 6이다.
3. step1 뒤 `repoInfo`는 부를 때마다 git을 하나(`rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD`)만 띄우고 결과를 담아 두지 않는다. 그 명령이 실패하면(커밋이 없는 브랜치, 리포 아님) 지금의 순서(`rev-parse` → `symbolic-ref`)로 다시 읽으므로, 어떤 입력에서도 돌려주는 값과 던지는 예외가 지금과 같다(브랜치 이름이 `symbolic-ref --short`와 같은 것은 step1 테스트가 경계 사례로 본다. "AC 확인"). 상태 파일 경로만 구하는 곳(`pr-wait.json`, `conflict.json`, `review.json`, 질문 상태 파일)은 같은 프로세스에서 같은 worktree 루트를 다시 물으면 git을 띄우지 않는다(`gitDirs`). 담아 두는 것은 git-dir과 공유 git-dir뿐이라 설정(`core.worktree`, 포함된 설정 파일)과 무관하다. 꺼낼 때마다 `.git`이 같은 git-dir을 가리키고 git이 리포로 보는 조건(git-dir의 `HEAD`, 공유 git-dir의 `objects`·`refs`, worktree의 `commondir`)이 그대로인지 파일로 확인하고, 아니면 지금처럼 git으로 다시 읽는다(망가졌으면 지금과 같은 결과·예외). 확인이 보지 않는 변경에서 상태 파일 경로가 달라질 수 있는 몫은 의사결정 로그 9의 "남는 차이"다. 루트가 아닌 폴더와 git 위치를 바꾸는 환경 변수가 있는 호출은 지금처럼 매번 git으로 읽는다.
4. `check`의 캐시 키와 그 계산(`cacheKey`, `toolVersions`)은 바꾸지 않는다. 도구 버전은 지금처럼 키를 만들 때마다 실행해 읽는다(설계서 6절 "하나라도 바뀌면 다시 실행한다". 의사결정 로그 10).
5. step1 뒤 옛 `runner.test.ts`의 테스트 37개(step0 뒤 `runner.test.ts`·`runner-questions.test.ts`·`runner-question-delivery.test.ts`)가 띄우는 동기 프로세스(`spawnSync` 호출, 자식 node 프로세스의 것 포함)가 7900개 이하다. macOS 측정 2의 9887개보다 20% 적은 값이다. step1 AC 셋째 줄이 센다. 같은 방법으로 변경 전 코드를 두 번 재면 9887개·9908개였고, step1 규칙(의사결정 로그 9)대로 만든 시제품은 7079개(−28%)였다(진행 로그 2026-11-24 01:30).
6. Windows PC: 마지막 step(step1) PR의 승인 요청(`pr-ready`) 전에 제작자의 Windows PC에서 그 PR의 코드로 잰 `node scripts/harness.ts test`가 1100초 이하이고, 잰 값·커밋·조건이 진행 로그와 PR 본문에 있다. 잰 커밋과 승인 요청 head의 차이는 계획 폴더뿐이어야 한다. 이 조건이 채워지지 않으면 승인을 요청하지 않는다(1100초를 넘으면 진행 로그에 적고 제작자에게 묻는다). 목표의 근거는 의사결정 로그 7, 재는 절차는 "검증 방법과 결과"다.
7. Linux(CI)와 macOS에서 `check`가 통과한다. 테스트 수는 그대로다(수용 기준 1).
8. `commands.test.timeoutSec`(이 리포의 `harness.config.json`과 `profiles/core/profile.json`, 둘 다 3600초)은 바꾸지 않는다(의사결정 로그 6. Issue #230의 "줄인 뒤 두 값을 어떻게 둘지 정한다"의 답이다).
9. 각 step PR은 보호 경로(`scripts/**`, `docs/harness/**`)를 바꾸므로 변경 기록을 자기 변경 조각 파일(`docs/harness/changes/20261123-windows-test-speed-s<N>.md`)에 적는다(#227, `85cac33`의 방식. 절차서 5절 "변경 조각"). CHANGELOG와 설계서 변경 이력은 직접 고치지 않는다.

## 범위 / 비범위

범위:

- step0: 테스트 파일 나누기. `scripts/test/runner.test.ts`·`runner-review.test.ts`·`runner-pr.test.ts`·`selftest.test.ts`의 테스트를 옮기고, 파일 사이에서 함께 쓰는 준비 코드를 새 보조 모듈 셋(`scripts/test/runner-fixture.ts`, `runner-review-fixture.ts`, `runner-pr-fixture.ts`)으로 옮긴다. `docs/harness/architecture.md`의 `selftest.test.ts` 설명 한 문장을 맞춘다.
- step1: 프로세스 줄이기. `scripts/lib/git.ts`(`repoInfo`를 git 한 번으로, 상태 파일 경로용 `gitDirs` 캐시, `harnessStateDir`), 상태 파일 경로를 구하는 `scripts/runner/next.ts`·`scripts/runner/review.ts`·`scripts/runner/run.ts`의 해당 줄. 새 테스트 `scripts/test/repo-dirs.test.ts`. `docs/harness/architecture.md`의 `lib/git.ts` 줄. 기술 부채 표의 새 행 둘(발견 사항 1, 2·3).
- 각 step의 변경 조각 파일.

비범위:

- `test` 동시 실행 수(지금 `min(8, 코어 수 - 1)`)를 바꾸는 일. `commands`를 바꾸면 위험도 높음이고 CI(4코어)와 core 프로파일에도 걸린다. Windows에서 몇 개가 좋은지 재지 않았다(의사결정 로그 1, 발견 사항 2).
- Windows의 `taskkill`(자식이 끝날 때마다 동기 실행, 회당 311ms)과 끝난 pid에 `taskkill`을 거는 위험. macOS에서 확인할 수 없고 몫이 작다(옛 `runner.test.ts`에서 약 3%. 의사결정 로그 5, 발견 사항 2).
- runner 반복마다 하는 `fetch`(Windows 회당 약 450ms), 테스트 준비(`makeFixture`)의 파일 복사와 `git add`·`push`, 백신 검사 예외. Windows에서 재야 고를 수 있다(발견 사항 2).
- Windows에서 `pnpm --version`이 실행되지 않아 캐시 키에 pnpm 버전이 빠지는 문제(발견 사항 1).
- `check` 캐시 키의 도구 버전을 덜 실행하는 일(의사결정 로그 10, 발견 사항 3).
- 측정 도구를 리포에 넣는 일. 추적 스크립트는 이 계획의 "검증 방법과 결과"에, 프로세스 수를 세는 최소 코드는 step1 AC 한 줄에 둔다(의사결정 로그 8).
- 테스트를 줄이거나 합치거나 시간 제한·`pollSec`을 바꾸는 일(검사 약화, R4).

## 관련 파일·문서

- `scripts/test/runner.test.ts`
- `scripts/test/runner-questions.test.ts`
- `scripts/test/runner-question-delivery.test.ts`
- `scripts/test/runner-review.test.ts`
- `scripts/test/runner-review-rebuttal.test.ts`
- `scripts/test/runner-review-round.test.ts`
- `scripts/test/runner-pr.test.ts`
- `scripts/test/runner-pr-update.test.ts`
- `scripts/test/selftest.test.ts`
- `scripts/test/selftest-cases.test.ts`
- `scripts/test/runner-fixture.ts`
- `scripts/test/runner-review-fixture.ts`
- `scripts/test/runner-pr-fixture.ts`
- `scripts/test/repo-dirs.test.ts`
- `scripts/lib/git.ts`
- `scripts/runner/next.ts`
- `scripts/runner/review.ts`
- `scripts/runner/run.ts`
- `docs/harness/architecture.md`
- `docs/harness/changes/20261123-windows-test-speed-s0.md`
- `docs/harness/changes/20261123-windows-test-speed-s1.md`
- `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `scripts/lib/exec.ts`, `scripts/commands/check.ts`, `scripts/test/helpers.ts`, `scripts/test/markdown-model.ts`, `scripts/selftest/run.ts`, `scripts/gates/test-effect.ts`, `scripts/lib/attempts.ts`, `scripts/lib/approval.ts`, `harness.config.json`, `profiles/core/profile.json`, `docs/harness/workflow.md`, `docs/harness/design.md`

## step 목록

- step0 split: 긴 테스트 파일 넷을 파일 10개로 나눈다. 테스트 블록은 글자 그대로 옮긴다.
- step1 fewer-spawns: `repoInfo`가 git을 한 번만 띄운다. 상태 파일 경로는 같은 프로세스에서 git-dir을 다시 읽지 않는다(꺼낼 때 파일로 확인).

## 진행 로그

- 2026-11-23 19:40 선점(`claim/230`)하고 골격을 만들었다. runner 테스트 하나를 추적해 시간의 82%가 동기 git 호출(732회)임을 쟀다. 계획은 아직 쓰지 않았다. 측정 결과·후보·다음 차례는 같은 폴더의 `handoff.md`(계획 push 전에 지운다).
- 2026-11-23 22:30 맥 세션이 이어받았다(Windows PC 세션의 인수인계 `handoff.md`, `06505e1`). 이 맥에 worktree를 만들고(`harness_project.worktrees/fix/20261123-windows-test-speed-s0`) `setup`을 했다. 인수인계의 PR #227은 10:53 UTC에 병합됐다(`85cac33`). 그래서 이 계획의 step PR은 변경 조각 파일에 기록한다(수용 기준 9). `origin/main`(`67bd225`)을 병합했다. 측정 대상 파일(`runner*.test.ts`, `selftest.test.ts`, `lib/git.ts`, `commands/check.ts`)은 측정한 `69ecad1`과 같다.
- 2026-11-23 22:30 macOS에서 측정 1~4를 했다("검증 방법과 결과"). 후보 넷(인수인계의 "줄일 방법 후보") 가운데 파일 나누기와 `repoInfo`·도구 버전을 고르고, `taskkill`은 뺐다(의사결정 로그 1, 5). 계획과 step 둘을 썼다. `handoff.md`를 지웠다.
- 2026-11-23 22:45 계획만 담은 커밋(`7d5aa9d`)을 올리고 초안 PR #236을 열었다. 계획 검증 1회차: Claude 승인, Codex 수정 요청(P1 4).
  - F1: step0 AC의 `node -e` 두 줄이 작은따옴표 안의 줄 잇기(`\`) 때문에 셸에서 그대로 실행하면 구문 오류다(runner는 줄을 합쳐 실행하지만 셸에서 그대로 돌리면 깨진다). → 두 명령을 줄 잇기 없는 한 줄로 바꿨다. 그대로 옮기면 통과하고 단언을 바꾸면 실패하는 것을 확인했다("검증 방법과 결과"의 AC 확인).
  - F2: 도구 버전을 `PATH`별로 담으면 같은 경로의 도구를 바꿨을 때 옛 통과 표시를 다시 쓴다. → 도구 버전 담기를 계획에서 뺐다(수용 기준 4, 의사결정 로그 10).
  - F3: `.git`만 확인하면 `HEAD`가 지워진 리포에도 담아 둔 값을 돌려준다. → 꺼낼 때 git이 리포로 보는 조건(`HEAD`, `objects`, `refs`, `commondir`)도 확인하고, `repoInfo`는 `symbolic-ref`의 치명 오류에서 다시 읽는다(수용 기준 3, 의사결정 로그 9, step1 작업 1·4).
  - F4: 성능 기준을 step AC가 판정하지 않는다. → step1 AC에 동기 프로세스 수 상한 판정을 넣었다(상한은 시제품으로 정했다. 다음 줄들). Windows 측정은 마지막 step 승인 요청의 전제로 못 박았다(수용 기준 5, 6). step0의 시간 상한은 머신마다 달라 AC로 두지 않고 묶음을 판정한다(수용 기준 2, 의사결정 로그 11).
- 2026-11-23 23:40 수용 기준 5의 상한을 정하려고 step1 규칙(의사결정 로그 9의 확인 (1)~(4), 상태 파일 경로 넷을 `repoDirs`로)대로 만든 시제품을 이 worktree 밖의 사본에서 돌렸다(이 브랜치에는 올리지 않았다). 옛 `runner.test.ts` 37개 통과, 동기 프로세스 7121개(−28%). 같은 때 변경 전 코드를 다시 재 9908개(측정 2는 9887개, 차이 0.2%).
- 2026-11-24 00:20 스스로 다시 읽다가 고쳤다(2회차 push 전). `rev-parse --show-toplevel`의 답은 리포 설정(`core.worktree`)에도 달려 있어 꺼낼 때의 확인에 설정 파일 (5)를 더했고, `repoInfo`의 `symbolic-ref` 치명 오류 대체를 시제품에 넣었다. 다시 재니 7369개(−25%)라, 상한 7415개는 여유가 0.6%뿐이다. 무관한 설정 쓰기(push의 upstream 등)에도 한 번씩 다시 읽기 때문이다. 정확성을 줄이지 않으려고 확인은 그대로 두고 수용 기준 5의 상한을 7900개(−20%)로 낮췄다. AC 셋째 줄의 기록 경로는 환경 변수 대신 세는 모듈 안에 절대 경로로 넣었다(Windows Git Bash는 환경 변수의 POSIX 경로를 바꾸지 않을 수 있다).
- 2026-11-24 00:35 2회차(`ded4a93`)를 올렸다. 계획 검증 2회차: Claude 승인, Codex 수정 요청(P1 2). F1~F4는 Codex가 `fixed`로 닫았다.
  - F5: 파일별 테스트 수로는 표의 배치를 확인하지 못한다. → step0 AC 셋째 줄을 바꿨다. 표의 처음·끝 테스트 제목으로 base 파일의 범위를 잘라 그 블록들이 해당 파일에 같은 차례·글로 있는지 본다. 바르게 나눈 트리에서 통과하고, 테스트 하나를 옆 파일로 옮긴 트리에서 실패하는 것을 확인했다(그 트리에서 둘째 줄의 전체 블록 비교는 통과한다. "AC 확인").
  - F6: 포함된 설정 파일(`[include]`)이 바뀌면 담아 둔 `repoInfo`의 자리가 낡는다. → `repoInfo`는 담아 두지 않고 git 한 번으로 읽게 바꿨다(수용 기준 3, 의사결정 로그 9). 담아 두는 것은 설정과 무관한 git-dir 자리(`gitDirs`)뿐이다. 그래서 2회차에 더한 설정 파일 확인 (5)는 뺐다.
- 2026-11-24 01:30 바꾼 설계를 확인했다. (1) `rev-parse --abbrev-ref HEAD`(엄격)는 같은 짧은 이름의 원격 추적 ref가 있는 브랜치(`origin/zz`)에서 `heads/origin/zz`를 내 `symbolic-ref --short`(`origin/zz`)와 다르다. `--abbrev-ref=loose`는 일반, `/`가 든 이름, 태그와 겹치는 이름(`heads/main`), 원격 추적 ref와 겹치는 이름, HEAD가 `refs/remotes/…`를 가리킴, `core.warnAmbiguousRefs=false`에서 모두 같고, detached HEAD는 둘 다 `HEAD`, 커밋 없는 브랜치는 128로 끝나 지금의 순서로 다시 읽는다. (2) 시제품(이 worktree 밖의 사본)으로 AC 셋째 줄을 돌려 7079개(−28%, 상한 7900), 37개 통과.

## 의사결정 로그

1. 결정: 파일 나누기(step0)와 프로세스 줄이기(step1)를 둘 다 한다. 동시 실행 수는 바꾸지 않는다.
   - 이유: 나누기는 동작 코드를 바꾸지 않고 벽시계 시간을 줄인다. 지금은 가장 긴 파일이 전체를 정한다(macOS 249초 대 이론 177초, Windows 1257초짜리 파일 하나). 나누면 Windows는 "파일 시간 합 ÷ 8"(macOS 비율로 추정 약 890초)에 가까워진다. 그다음에는 합 자체를 줄여야 하므로 프로세스 수를 줄인다. 둘은 서로 다른 몫을 줄인다.
   - 버린 대안: 동시 실행 수 상한(8)을 Windows에서 올리기. 20코어 PC에서는 효과가 클 수 있으나 `commands.test.run`을 바꿔야 한다(위험도 높음, CI와 core 프로파일에 함께 걸림). 백신·디스크가 병목이면 늘려도 빨라지지 않는다. Windows에서 재지 않고는 고를 수 없어 발견 사항 2로 넘긴다. 한 파일 안에서 테스트를 동시에 돌리기(`describe`의 `concurrency`)도 버렸다: 테스트가 동기 프로세스(`spawnSync`)를 띄우는 동안 이벤트 루프가 막혀 동시에 돌지 않고, 테스트가 `process.env`를 바꾼다(`setup`).
2. 결정: 나누기를 먼저 한다(step0), 프로세스 줄이기는 step1.
   - 이유: 동작 코드를 바꾸지 않아 위험이 작고, Windows에서 줄어드는 몫이 더 크다(추정 1700초 → 약 900초). 다음 PR부터 Windows의 `check`가 빨라진다.
   - 버린 대안: 순서를 바꾸기. step1만으로는 가장 긴 파일이 20%쯤 짧아질 뿐이다.
3. 결정(step0 묶음): 파일은 붙어 있는 테스트를 덩어리째 옮긴다(step0.md의 표). 한 덩어리의 macOS 테스트 시간 합이 75초를 넘지 않게 자른다. `selftest.test.ts`는 오래 걸리는 "모든 시나리오를 통과한다" 하나만 남기고 나머지 12개를 옮긴다.
   - 이유: 덩어리째 옮기면 diff가 잘라 붙이기로 읽히고(`git diff --color-moved`), 같은 파일을 고치는 다른 PR(#217이 `runner-review.test.ts`를 고친다)과 충돌을 풀기 쉽다. 75초면 Windows에서 약 400초라 "합 ÷ 8"(약 890초)보다 짧다. `selftest.test.ts`에 그 테스트를 남기면 설계서 12.4절의 "`selftest.test.ts`가 그 브랜치의 시나리오로 그 브랜치의 하네스를 시험한다"가 그대로 맞아 설계서를 고치지 않는다.
   - 버린 대안: 주제별로 섞어 다시 묶기(diff가 커지고 충돌이 어렵다). 시나리오 실행 테스트를 시나리오별로 쪼개기(테스트 블록이 바뀌어 수용 기준 1을 지킬 수 없다. 86초는 나눈 뒤 가장 긴 파일이지만 "합 ÷ 8"보다 짧다).
4. 결정(step0 보조 모듈): 나뉜 파일들이 함께 쓰는 준비 코드(`setup`, `run`, 가짜 GitHub 도우미 등)는 계열마다 보조 모듈 하나(`runner-fixture.ts`, `runner-review-fixture.ts`, `runner-pr-fixture.ts`)로 옮겨 export한다. 한 파일에서만 쓰는 도우미는 그 파일로 옮긴다. `scripts/test/helpers.ts`에는 넣지 않는다.
   - 이유: 계열마다 `setup`의 모양이 다르다(`runner.test.ts`는 `state`·`behavior`, `runner-review.test.ts`는 원장·체크 도우미). 공용 `helpers.ts`에 넣으면 모든 테스트가 runner 전용 코드를 끌어온다. 보조 모듈을 두는 꼴은 이미 있다(`markdown-model.ts`, `metrics-allow.ts`).
   - test-effect: 옮긴 테스트 파일은 base에서도 통과하므로(새 보조 모듈이 base에 없으면 "모듈 없음"으로 끝난다) 판정이 그 파일들을 확인하지 못한다. 그래서 옮긴 파일마다 `test-effect 예외` 줄(사유: 기존 테스트 블록을 글자 그대로 옮겼다)을 이 의사결정 로그에 적는다(step0 작업 4). 블록이 같은지는 step0 AC 둘째 줄이 본다. `testEffect.support`는 바꾸지 않는다(`harness.config.json`은 core 프로파일과 같아야 하고, 이 리포 전용 모듈을 넣을 자리가 아니다).
5. 결정: Windows `taskkill`은 이 계획에서 다루지 않는다.
   - 이유: `run()`이 자식이 끝날 때마다 `killTree`를 부르고 Windows에서는 동기 `taskkill /T /F`(회당 311ms)다. 옛 `runner.test.ts`에서 비동기 실행은 108번이라 약 34초(1257초의 3%)다. 손자 프로세스(dev 서버) 정리 동작과, 끝난 pid가 다른 프로세스에 다시 쓰였을 때 그 트리를 끝낼 위험을 함께 봐야 하는데 macOS에서는 확인할 수 없다.
   - 버린 대안: 비동기로 돌리거나 남은 자식이 있을 때만 부르기. 위 확인 없이 정리 동작을 바꾸게 된다.
6. 결정: `commands.test.timeoutSec`은 3600초 그대로 둔다(이 리포와 core 프로파일).
   - 이유: 줄여서 얻는 것은 끝나지 않는 테스트를 조금 일찍 끊는 것뿐이다. 하네스를 적용한 리포의 Windows 머신(백신, 느린 디스크)에서 시간 제한에 걸리면 `check`가 통과하지 못해 일이 멈춘다(#228에서 겪었다). 시간 제한은 멈춘 실행을 끊는 장치이고, 느려짐은 수용 기준 6의 측정으로 본다. `commands`를 바꾸면 위험도 높음 PR이 하나 더 생긴다.
   - 버린 대안: 1800초로 되돌리기. 위 이유로 얻는 것이 작다.
7. 결정(Windows 목표 1100초): 수용 기준 6의 목표는 1100초다.
   - 이유: macOS에서 파일 합은 1417초, 같은 테스트의 배율은 4.3~5.6배(Issue #230 댓글)라 Windows 합은 약 7100초, ÷ 8은 약 890초다. step1이 runner 계열 파일(합의 약 절반)의 프로세스를 25% 안팎 줄이면 합이 1할쯤 준다. 동시 실행 때 디스크·백신이 겹치는 몫을 재지 않았으므로 추정(약 800~900초)에 2할 남짓 여유를 둔다. 지금(1516~1858초)보다 30% 이상 짧다.
   - 버린 대안: 목표 없이 "빨라진다"만 적기(Issue의 수용 기준이 "목표 값은 잰 뒤 정한다"이다).
8. 결정: 추적 스크립트는 리포의 코드로 넣지 않고 이 계획의 "검증 방법과 결과"에 둔다. 수용 기준 5의 판정은 step1 AC 한 줄이 `spawnSync`만 세는 최소 코드를 임시 폴더에 써서 `NODE_OPTIONS`로 넣어 센다. step1 테스트의 프로세스 수 단언은 테스트 안에서 `node:child_process`의 `spawnSync`를 감싸 센다.
   - 이유: 측정은 계획의 근거이고 동작이 아니다. 코드로 넣으면 보호 경로의 새 도구가 되어 유지할 것이 는다. 세는 방법은 제품 코드에 세는 장치를 두지 않는다. AC의 세는 코드는 추적 스크립트의 `sync` 줄과 같은 것(모든 node 프로세스의 `spawnSync` 호출)을 세므로 측정 2의 9887개와 견줄 수 있다.
   - 버린 대안: `scripts/lib/exec.ts`에 호출 수를 세는 변수를 두기. 테스트만을 위한 상태가 제품 코드에 남는다.
9. 결정(step1): `repoInfo`는 담아 두지 않고 git 한 번(`rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD`)으로 읽는다. 실패하면(커밋이 없는 브랜치는 128) 지금의 순서로 다시 읽는다. 상태 파일 경로만 구하는 곳은 `gitDirs`(git-dir과 공유 git-dir)를 프로세스 안에 담아 쓴다. 키는 `path.resolve(cwd)`이고, cwd가 그 worktree의 루트(git이 준 `--show-toplevel`과 같은 경로. Windows는 대소문자를 가리지 않는다)일 때만 담는다. 꺼낼 때마다 프로세스 없이 파일로 확인하고, 하나라도 아니거나 읽지 못하면 버리고 git으로 다시 읽는다: (1) `<root>/.git`이 폴더면 그 경로가, 일반 파일이면 `gitdir:` 줄이 담아 둔 git-dir을 가리킨다. (2) git-dir의 `HEAD`가 일반 파일이고 `ref: refs/…`나 객체 id(16진수 40자·64자) 한 줄이다. (3) git-dir이 공유 git-dir과 다르면(worktree) git-dir의 `commondir`이 담아 둔 공유 git-dir을 가리킨다. (4) 공유 git-dir에 `objects`·`refs` 폴더가 있다. `GIT_DIR`·`GIT_WORK_TREE`·`GIT_COMMON_DIR`·`GIT_CEILING_DIRECTORIES`·`GIT_DISCOVERY_ACROSS_FILESYSTEM` 가운데 하나라도 있으면 담지도 꺼내지도 않는다. 실패(리포 아님)는 담지 않는다.
   - 이유: `repoInfo`가 띄우던 둘(`rev-parse`, `symbolic-ref`)을 하나로 합치면 담아 두지 않고도 호출마다 git이 하나 준다. 값이 늘 그때 git이 준 것이라, 담아 둔 자리가 설정(`core.worktree`, 포함된 설정 파일. Codex F6)이나 리포 상태 때문에 낡을 일이 없다. `--abbrev-ref=loose`는 `symbolic-ref --short`와 같은 줄임 규칙을 쓴다. 기본(엄격)은 같은 짧은 이름의 원격 추적 ref가 있으면 `heads/…`를 내 다르다("AC 확인"). 상태 파일 경로는 git-dir만 쓰는데, git-dir은 `.git`과 `commondir` 파일로 정해지고 설정과 무관하다. runner는 한 프로세스가 12시간까지 돌며 worktree를 지우고 만들고, 같은 경로에 다시 만든 worktree는 git-dir 이름이 달라질 수 있다(같은 이름의 관리 폴더가 이미 있으면 `name1`). (1)이 그것을, (2)~(4)가 리포가 망가진 것(git이 폴더를 리포로 보는 조건 `is_git_directory`: `HEAD`, `objects`, `refs`, worktree의 `commondir`. Codex F3)을 프로세스 없이 알아챈다. 루트가 아닌 폴더는 그 안에 나중에 `git init`한 리포가 생길 수 있어 담지 않는다. 대부분의 상태 파일 호출(runner)은 worktree 루트를 넘긴다.
   - 남는 차이: `gitDirs`는 담아 둔 값을 꺼낼 때 git을 띄우지 않으므로, (1)~(4) 밖의 변경(소유자가 바뀌어 `safe.directory`에 걸림 등 git이 리포를 거부하게 되는 전역 조건)이 프로세스 도중에 생기면 git-dir 경로를 그대로 돌려준다. 그 경로의 상태 파일을 읽고 쓰는 동작은 리포가 멀쩡할 때와 같고, 그다음 git을 부르는 곳(`repoInfo` 포함)이 지금처럼 실패한다.
   - 버린 대안: `repoInfo`의 자리를 담아 두고 브랜치만 `symbolic-ref`로 읽기(2회차 계획. 담아 둔 자리가 포함된 설정의 변경을 놓친다, Codex F6. 설정 파일의 크기·수정 시각을 보면 무관한 설정 쓰기마다 다시 읽어 줄어드는 몫도 준다: 시제품 7369개). 호출하는 쪽이 `RepoInfo`를 넘겨 쓰게 고치기(부르는 곳 60곳 남짓을 고쳐야 한다). 기한(TTL)으로 버리기(기한 안의 변경을 놓친다). `.git`만 확인하기(1회차 계획, Codex F3).
10. 결정: `check` 캐시 키의 도구 버전(`toolVersions`)은 이 계획에서 줄이지 않는다.
    - 이유: 설계서 6절은 "런타임·도구 버전 … 하나라도 바뀌면 다시 실행한다"를 보장한다. 프로세스 안에 담아 두면 runner가 도는 동안 같은 경로의 pnpm·gitleaks를 바꿨을 때 키에 옛 버전이 남아, 같은 트리의 로컬 통과 표시를 실제 검사 없이 다시 쓴다(Codex F2). pnpm은 corepack 심(shim)이면 실행 파일이 그대로인 채 버전이 바뀌어 파일 확인으로도 알 수 없다. 몫은 옛 `runner.test.ts`에서 macOS 5%(pnpm 46번), Windows 약 2%(gitleaks 67번)로 작고, 수용 기준 5는 `repoInfo`만으로 채운다(시제품 7369개).
    - 버린 대안: `PATH` 값별로 담기(1회차 계획, 위 보장을 약화한다). `check` 한 번 안에서 시작할 때 읽은 버전을 끝의 키에 다시 쓰기(끝의 키를 다시 만드는 뜻이 바뀌고 줄어드는 몫이 절반이다). 실행 파일의 수정 시각을 키에 넣기(corepack 심을 알아채지 못한다).
11. 결정: step0의 시간(나눈 파일 하나 75초 안팎)은 step AC로 판정하지 않는다.
    - 이유: AC는 runner가 어느 머신에서든 그대로 실행한다. 같은 테스트가 Windows에서 4.3~5.6배 걸리고 동시 실행·부하에 따라 흔들려, 시간 상한은 묶음이 맞아도 머신에 따라 실패한다. 시간을 정하는 것은 묶음(어느 테스트가 어느 파일에 있는가)이고 묶음은 AC 셋째 줄이 판정한다. 벽시계 효과는 수용 기준 6(Windows PC 측정, 승인 요청의 전제)이 판정한다(Codex F4).
    - 버린 대안: step0 AC에 macOS 기준 100초 상한 넣기(1회차 지적의 제안. 위 이유로 머신에 따라 결과가 갈린다).

## 발견 사항

1. Windows에서 `toolVersions`(`scripts/commands/check.ts`)의 `pnpm --version`이 3ms에 끝난다. 셸 없이 띄우면 `pnpm.cmd`를 찾지 못해 실행되지 않는 것으로 보인다(libuv는 `.exe`·`.com`만 붙여 찾는다. Windows에서 확인하지는 않았다). 그러면 Windows의 캐시 키에 pnpm 버전이 빠져, pnpm을 올려도 같은 트리의 통과 표시를 다시 쓴다. 속도와 별개다. → 처리: step1에서 기술 부채 표에 새 행으로 올린다
2. Windows에서만 큰 비용 가운데 이 계획이 다루지 않는 것: 자식이 끝날 때마다 도는 `taskkill`(회당 311ms)과 끝난 pid 재사용 위험, `fetch`·`push`(회당 약 450ms. 로컬 원격에도 하위 프로세스를 여럿 띄운다), 테스트 준비의 파일 복사(`scripts/` 192개)와 `git add -A`, 백신(이 PC는 AhnLab V3 Lite)의 실시간 검사, 20코어에서 동시 실행 상한 8. → 처리: step1에서 기술 부채 표에 새 행으로 올린다(Windows에서 각각의 몫을 잰 뒤 고를 일)
3. macOS에서는 `pnpm --version`이 회당 156ms다(pnpm이 node로 뜬다). 옛 `runner-review.test.ts`에서 87번, 13.7초(그 파일의 11%)였다. 줄이려면 설계서 6절의 "도구 버전이 바뀌면 다시 실행한다"를 지키면서 버전 변경을 알아채는 방법이 필요하다(의사결정 로그 10). → 처리: step1에서 발견 사항 2의 기술 부채 행에 함께 적는다

## 열린 질문

없음(추천안으로 진행한 판단은 의사결정 로그에 있다).

## 검증 방법과 결과

- step0: AC(나눈 파일 실행, 테스트 블록 비교, 파일별 테스트 수, 문서) + `check`. 나눈 뒤 macOS에서 `test`를 한 번 돌려 파일별 시간(측정 3과 같은 방법)과 전체 시간을 진행 로그에 적는다(판정이 아니라 기록. 의사결정 로그 11).
- step1: AC(새 테스트, runner 계열 테스트 실행, 동기 프로세스 수 7900개 이하) + `check`. 센 값을 진행 로그에 적는다(수용 기준 5).
- Windows(수용 기준 6, 승인 요청의 전제): step1 PR의 `complete-step`과 `origin/main` 병합까지 push한 뒤, 승인을 요청하기 전에 제작자의 Windows PC에서 그 커밋으로 잰다.
  1. 그 PC에서 브랜치를 받아(`git fetch origin` 뒤 worktree에서 `git merge --ff-only origin/<브랜치>`) `node scripts/harness.ts setup`을 한다.
  2. 다른 `check`·`test`가 돌지 않을 때 Git Bash에서 `time node scripts/harness.ts test > <임시 폴더>/test.log 2>&1`을 한 번 돌린다.
  3. 잰 커밋, `real` 시간, 통과 여부, 조건(다른 무거운 프로세스, 백신 설정을 바꿨는지)을 진행 로그와 PR 본문에 적는다. 이 기록 커밋은 계획 폴더만 바꾼다.
  - 그 PC의 대화 세션이 재거나, 이 맥 세션이 승인 요청과 따로 먼저 제작자 작업으로 측정을 요청해 결과(위 3의 값)를 받는다. 결과를 받기 전에는 승인을 요청하지 않는다. 1100초를 넘으면 승인을 요청하지 않고 진행 로그에 적어 제작자에게 묻는다(선택지: 발견 사항 2의 후보를 더하는 step 추가 / 목표 조정).
  - step0 PR에서도 잴 수 있으면 잰다(필수 아님. 나누기만의 효과를 본다).

### AC 확인 (2026-11-23, 1회차 지적 F1 대응)

step0 AC의 블록 비교(둘째 줄)와 파일별 테스트 수(셋째 줄)는 줄 잇기 없는 한 줄이다. 셸에서 블록을 그대로 실행해도, runner가 줄을 뽑아 실행해도 같다. 확인한 것:

- 바꾸지 않은 트리: 블록 비교가 통과한다(`최상위 test 블록 1272개가 base와 글자 그대로 같다`). 파일별 테스트 수는 나뉜 파일이 없어 실패한다.
- 테스트 하나의 단언 한 글자를 바꾼 트리: 블록 비교가 종료 코드 1로 실패한다.
- 옛 `runner.test.ts`를 표대로 세 파일과 보조 모듈로 나눈 트리(이 계획을 위해 만든 시험 분할): 블록 비교와 그 세 파일의 테스트 수가 통과한다.

step0 AC 셋째 줄(표대로의 배치, 2회차 지적 F5 대응): 네 파일을 표대로 나눈 시험 트리에서 통과하고(`네 파일의 테스트가 표의 묶음대로 차례와 글 그대로 나뉘었다`), 그 트리에서 `runner-pr.test.ts`의 마지막 테스트를 `runner-pr-update.test.ts` 끝으로 옮기면 두 파일을 짚어 종료 코드 1이다(같은 트리에서 둘째 줄은 통과한다).

step1 AC 셋째 줄(동기 프로세스 수)은 파일 목록만 아직 나뉘지 않은 `runner.test.ts` 하나로 바꿔 같은 꼴로 돌렸다(F4 대응): 변경 전 코드는 9908개로 종료 코드 1이다. 시제품은 2회차 설계(확인 (1)~(5)와 `symbolic-ref` 대체)에서 7369개, 3회차 설계(의사결정 로그 9)에서 7079개로 0이다(상한 7900).

`repoInfo`의 브랜치 이름(3회차 설계): 임시 리포에서 `git symbolic-ref --short -q HEAD`와 `git rev-parse --abbrev-ref=loose HEAD`를 견줬다. 결과는 진행 로그 2026-11-24 01:30의 (1)이다. step1 테스트가 같은 사례를 단언한다.

### 측정 (2026-11-23, macOS)

머신: Apple M5(10코어), Node v22.23.3, git 2.50.1. 커밋: 코드는 `69ecad1`과 같다. 다른 `check`가 돌지 않을 때 쟀다.

1. 테스트 하나("반복 실패는 5회에 멈추고…"): 15.0초. 동기 프로세스 743개 10.7초(git 평균 약 9ms), 비동기 19개. 같은 테스트를 Windows에서 잰 값(인수인계, 다른 `check`가 돌지 않을 때): 83.7초, 동기 git 732개 69.0초(82%, 회당 55~94ms), `taskkill` 21개 6.5초, 비동기 19개 7.2초.
2. 파일 전체(각각 단독): `runner.test.ts` 143.4초, 동기 프로세스 9887개 128.0초, 비동기 108개. `runner-review.test.ts` 122.2초, 동기 9065개 111.7초.
   - `repoInfo`: `runner.test.ts`에서 1951번(git 약 3900개). 부른 곳 상위: `retryQuestions`의 `unposted`(`scripts/runner/run.ts`) 470, `conflictFile`(`scripts/runner/next.ts`) 379, `runRunner` 시작 둘 각 125, `setPlanStatus` 122, `prWaitFile` 77. `runner-review.test.ts`에서는 1479번(`unposted` 270, `prWaitFile` 268, `conflictFile` 183, `review.ts`의 `stateFile` 176).
   - `git worktree list`(`listWorktrees`): `runner.test.ts`에서 891번.
   - `fetch`: 320번(runner 반복마다 하는 `fetchRemote`가 225번). macOS 회당 25ms, Windows 약 450ms.
   - 도구 버전: `pnpm --version` 46번 7.2초(회당 156ms), `gitleaks version` 67번(macOS 회당 5ms, Windows 약 390ms). `runner-review.test.ts`에서는 `pnpm` 87번 13.7초.
3. `test` 전체(`check`와 같은 동시 8개): 249초, 1325건 통과. 파일 78개의 테스트 시간 합 1417초. 상위: `runner.test.ts` 203초, `runner-review.test.ts` 188초, `selftest.test.ts` 152초(테스트 하나가 86~88초), `runner-pr.test.ts` 125초, `verify-tree.test.ts` 99초, `runner-plan-review.test.ts` 77초. 나눌 네 파일의 테스트별 시간은 step0.md의 표에 있다.
4. 같은 날 `test` 전체를 TAP으로 한 번 더 돌린 시간: 246초(user 776초, sys 470초).

### 추적 스크립트 (다시 재려면)

리포 밖(임시 폴더)에 두고 `NODE_OPTIONS`로 넣는다. Windows의 Git Bash에서는 경로를 `cygpath -m` 꼴(`C:/Users/...`)로 쓴다.

```bash
TRACE230_LOG=<기록 파일> NODE_OPTIONS="--import=file:///<경로>/trace.mjs" \
  node --test --test-name-pattern="반복 실패는 5회에" scripts/test/runner.test.ts
```

```js
// trace.mjs: 이 프로세스가 띄우는 자식 프로세스(spawn·spawnSync)의 명령·시간·부른 곳을 TRACE230_LOG에 한 줄씩 적는다
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const LOG = process.env.TRACE230_LOG;
const t0 = performance.now();
const name = (c, a) => {
  const b = path.basename(String(c)).toLowerCase();
  const first = (a || []).find((x) => !String(x).startsWith('-'));
  if (b.startsWith('node')) return `node ${first ? path.basename(String(first)) : ''}`;
  if (b === 'git' || b === 'git.exe') return `git ${first ?? ''}`;
  return `${b} ${first ?? ''}`;
};
const where = () =>
  (new Error().stack || '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /scripts[\\/]/.test(l) && !/lib[\\/]exec\.ts|trace\.mjs/.test(l))
    .slice(0, 3)
    .map((l) =>
      l
        .replace(/^at /, '')
        .replace(/\(?file:\/\/\/.*?scripts[\\/]/, '')
        .replace(/:\d+\)?$/, ''),
    )
    .join(' < ');
const log = (o) => LOG && appendFileSync(LOG, JSON.stringify({ pid: process.pid, ...o }) + '\n');
const origSpawn = cp.spawn;
const origSync = cp.spawnSync;
cp.spawn = function (c, a) {
  const s = performance.now();
  const child = origSpawn.apply(this, arguments);
  child.once('exit', () =>
    log({ k: 'spawn', cmd: name(c, Array.isArray(a) ? a : []), ms: performance.now() - s }),
  );
  return child;
};
cp.spawnSync = function (c, a) {
  const s = performance.now();
  const r = origSync.apply(this, arguments);
  log({
    k: 'sync',
    cmd: name(c, Array.isArray(a) ? a : []),
    ms: performance.now() - s,
    at: where(),
  });
  return r;
};
syncBuiltinESMExports();
log({
  k: 'boot',
  argv: process.argv
    .slice(1, 3)
    .map((x) => path.basename(String(x)))
    .join(' '),
  ms: t0,
});
process.once('exit', () =>
  log({
    k: 'life',
    argv: process.argv
      .slice(1, 3)
      .map((x) => path.basename(String(x)))
      .join(' '),
    ms: performance.now(),
  }),
);
```

- 기록 한 줄이 프로세스 하나다(`k`: `sync`·`spawn`·`boot`·`life`). 동기 프로세스 수는 `k`가 `sync`인 줄의 수다.
- 같은 커밋을 macOS와 Windows에서 재면 횟수는 같고 회당 비용만 다르다(측정 1: 743개 대 732개).
- 파일별 시간은 `node --test --test-concurrency=8 --test-reporter=<보고기> "scripts/test/*.test.ts"`로 쟀다. 보고기는 `test:pass`·`test:fail` 이벤트 가운데 `nesting`이 0인 것의 `details.duration_ms`를 `file`별로 더한다.

## 다음 할 일

- 계획만 담은 커밋 → `check` → push → 초안 PR(`Refs #230`) → 계획 검증(G1).
- 승인 뒤 step0(`split`)을 이 브랜치에서 한다. step0 PR은 보호 경로를 바꾸므로 제작자 head 승인이 필요하다(운영 단계). 초안으로 두고 `pr-ready`로 한 번만 요청한다.
