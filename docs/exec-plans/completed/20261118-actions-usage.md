---
id: 20261118-actions-usage
issue: 126 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-18T23:12:27+09:00
---

# chore: GitHub Actions 사용량 절감 — CI 테스트 동시 실행 수, PR 본문 수정 규칙

- 목표: GitHub Actions 사용량을 리스크가 낮은 방법 두 가지로 줄인다(Issue #126, 제작자 대화 지시 2026-11-18 "우선 절감 작업부터 진행하자"). 2코어인 CI 러너에서 테스트 파일이 하나씩 돌지 않게 하고, PR 본문 수정으로 `gates`가 거듭 도는 일을 줄인다.
- 변경: `harness.config.json`과 `profiles/core/profile.json`의 `commands.test.run`에서 `--test-concurrency`의 최소값을 1에서 2로(`Math.max(1, …)` → `Math.max(2, …)`). `scripts/test/lib.test.ts`에 그 식을 코어 수별로 확인하는 테스트 1개. `docs/harness/workflow.md` 5절에 본문 수정 규칙 한 줄. `docs/harness/CHANGELOG.md` 한 줄. 이 계획 파일.
- 검증: node --test --test-name-pattern="동시 실행 수" scripts/test/lib.test.ts
- 그 밖의 검증: `node scripts/harness.ts check`. 효과는 이 PR의 CI `check` 로그의 `✓ test (N초)`를 477초(PR #125의 첫 실행, 실행 44281644138)와 비교해 PR 댓글에 적는다.
- 되돌릴 조건: CI의 `test` 단계가 20% 넘게 줄지 않거나, 병합 뒤 시간 제한에 걸려 실패하는 테스트가 생기면 최소값을 1로 되돌린다.
- 비범위: 워크플로 파일 변경(1분 미만 job 합치기, main `check` 생략, `gates`의 `edited` 트리거. 봇은 워크플로 파일을 올릴 수 없고 격리 설계 검토가 먼저다). 테스트의 작업량 줄이기(TD-40). `tech-debt-tracker.md`(TD-49는 #102 step7의 전환 PR에 있다. 그 표는 병행 PR끼리 충돌하기 쉬워 여기서 고치지 않는다). 프로파일 web(자체 `test` 명령을 쓴다).

## 관련 파일·문서

- `harness.config.json`, `profiles/core/profile.json`(`commands.test.run`)
- `scripts/test/lib.test.ts`
- `docs/harness/workflow.md` 5절, `docs/harness/CHANGELOG.md`
- `.github/workflows/check.yml`, `.github/workflows/gates.yml`(읽기만)
- Issue #102의 2026-11-18 댓글(사용량 집계), 계획 `20261116-ops-security`의 의사결정 로그(2026-11-17, 동시 실행 수를 8로 묶은 결정)

## 진행 로그

- 2026-11-18: 대화 세션이 Issue #126을 등록하고 시작했다. 먼저 쟀다.
  - CI `check`의 `test` 단계는 477초다(PR #125의 첫 실행). `check` job 전체는 11-11에 평균 41초였고 11-17~18에는 430~450초다(runner 흐름 테스트가 늘었다).
  - 이 Mac(10코어)에서 테스트 파일을 하나씩 돌리면(`--test-concurrency=1`) 442초, 지금 설정(8개씩)으로는 135초다. 561개 테스트가 모두 통과했다.
  - 테스트 이름 접두어로 묶으면 `runner` 52개가 223초, `self-test` 7개가 72초로 전체 438초의 67%다. 2초를 넘는 테스트 63개가 317초다.
  - CPU 위주다: `runner.test.ts` 하나가 실제 50초에 CPU 44초(user 26.5, sys 17.6).
  - 그 50초는 자식 프로세스 약 3,200개에 고르게 퍼져 있다(거의 다 git. 한 번에 8~40밀리초). 많은 것: `git symbolic-ref --short -q HEAD` 517회, `git rev-parse --show-toplevel …` 427회(둘 다 `scripts/lib/git.ts`의 `repoInfo`), `git rev-parse --verify -q origin/main^{commit}` 284회, `git status --porcelain` 155회, `git fetch` 108회, `git push` 89회.
  - Node 컴파일 캐시(`NODE_COMPILE_CACHE`)는 효과가 없었다(49.2초 → 49.6초). 하네스 명령의 시작 비용은 0.11초로 작다.
- 2026-11-18: 테스트를 먼저 썼다(`lib.test.ts`: 설정의 `--test-concurrency` 식을 코어 수 1·2·3·4·8·9·10·20으로 계산해 2·2·2·3·7·8·8·8인지, 프로파일 core와 같은 문자열인지). 구현 전 실행에서 실패했다(코어 1·2에서 1이 나와 `ERR_ASSERTION`). 두 설정 파일의 `Math.max(1, …)`을 `Math.max(2, …)`로 바꾼 뒤 통과했다.
- 2026-11-18: PR #127 1라운드(head `77ccc6e`). Actions가 다시 돌았다(이유는 봇이 확인하지 못했다. 제작자가 지출 한도를 올린 것으로 보인다).
  - **효과**: CI `check`의 `test` 단계가 477초에서 332초로 줄었다(30% 감소). `check` job 전체는 363초다(직전 PR #125는 약 500초). 청구는 job마다 분 단위로 올리므로 9분에서 7분이 된다. 한 번 잰 값이다. 되돌릴 조건(20% 넘게 줄지 않음)에 해당하지 않는다.
  - `risk-gate`가 실패했다: "위험도 높음: 제작자 head 승인 필요 — harness.config.json: 판정 관련 설정 변경 — commands". `commands` 변경은 구축 단계에서도 위험도 높음 신호다(의사결정 로그의 마지막 항목을 바로잡았다). 초안으로 올렸어야 했다. `pr-ready --undo`로 초안으로 되돌렸다.
  - `review/claude`는 승인(지적 없음), 기계 판정은 `risk-gate` 말고 모두 통과, 자체 테스트 10개 통과다.
  - `review/codex`는 판정이 없다(error). Codex 계정이 사용 한도에 걸렸다. 판정 job의 유출 검사 단계가 남긴 문구: "You’ve hit your usage limit. Upgrade to Plus to continue using Codex …, or try again at Nov 21st, 2026 8:36 AM." PR #125도 같은 이유로 판정이 없다. 풀릴 때까지 어떤 PR도 병합되지 않는다(제작자 차례: 요금제를 올리거나 기다린다. Issue #102의 `needs-human` 댓글).
  - 이 기록은 Codex 판정이 다시 될 때 올린다(지금 올리면 판정 없는 실행이 한 번 더 돈다).

## 의사결정 로그

- 결정: 최소값만 2로 올린다(식 `Math.max(2, Math.min(8, 코어 수 − 1))`). / 이유: 바뀌는 것은 코어가 1~2개인 머신뿐이다(2코어: 1 → 2). 2026-11-17의 제작자 결정(코어 수 − 1, 최대 8)이 지키려던 것, 곧 코어가 많은 PC의 메모리와 4코어 이상 머신의 동작은 그대로다. / 버린 대안: 4코어 이하에서 코어 수만큼 돌리기(4코어 머신의 동작이 3에서 4로 바뀐다. 얻는 것이 작다), 값을 CI에서만 바꾸기(워크플로 파일을 고쳐야 하는데 봇은 올릴 수 없다. 로컬과 CI의 명령도 갈린다).
- 결정: CI 러너를 2코어로 본다. 근거는 GitHub 문서의 러너 사양(비공개 리포의 표준 Linux 러너는 2 CPU)과 청구 단가(분당 $0.006은 2코어 Linux의 값이다)다. 계획 `20261116-ops-security`의 의사결정 로그(2026-11-17)는 "CI 러너(4코어, 지금 3개 동시)"라고 적었는데 공개 리포의 사양으로 보인다. / 이유: 러너에서 코어 수를 직접 찍어 본 기록은 없다. 이 PR의 CI 실행 시간이 확인이 된다. / 버린 대안: 코어 수를 찍는 단계를 워크플로에 넣어 먼저 확인하기(워크플로 변경이라 제작자가 올려야 하고, 지금은 Actions가 멈춰 있다).
- 결정: `repoInfo`의 git 호출을 기억해 두는 최적화는 하지 않는다. / 이유: runner 테스트 파일에서 `rev-parse` 427회는 3.4초(7%)이고 전체 테스트 시간의 3~4%다. 같은 경로가 프로세스 안에서 다른 worktree가 되는 경우(정리 뒤 다시 만들기)가 있어 틀린 값을 쓸 위험이 얻는 것보다 크다. / 버린 대안: 경로별로 기억하기.
- 결정: `gates`의 `edited` 트리거는 그대로 두고 절차서에 규칙만 적는다. / 이유: `harness-guard`가 본문의 보호 경로 확인 줄을 읽으므로 본문 수정 뒤 다시 판정해야 한다. 트리거를 빼면 본문을 고쳐도 실패가 풀리지 않는다. / 버린 대안: 트리거에서 `edited` 빼기.
- 결정: 계획의 위험도를 `normal`로 적는다. / 이유: 보호 경로(`harness.config.json`의 `commands`, `docs/harness/`)를 바꾼다. 검사를 약화하지 않는다(도는 테스트는 같다). 계획의 `risk: high`는 기준(보안·인증·마이그레이션·데이터 스크립트)에 해당할 때만 붙인다. / 바로잡음(PR #127 1라운드 뒤): 처음에는 "`risk-gate`가 구축 단계에서 보통으로 판정한다"고 적었는데 틀렸다. `harness.config.json`의 `commands` 변경은 판정 관련 설정 신호라 단계와 관계없이 `risk-gate`가 위험도 높음으로 판정하고 제작자의 head 승인이 필요하다. 계획의 `risk` 값은 그대로 두고(위 기준에 해당하지 않는다), PR은 초안으로 되돌려 `pr-ready`로 승인을 요청한다.

## 발견 사항

- CI `check`의 시간은 거의 다 `test` 단계이고(495초 가운데 477초), 그 시간은 runner 흐름 테스트와 자체 테스트가 git 프로세스를 수천 개 띄우는 데서 나온다. 한 곳을 고쳐 크게 줄일 지점은 없었다. 줄이려면 시나리오마다 다시 만드는 리포·원격 준비를 나누어 쓰거나 테스트를 줄여야 한다. → 처리: TD-40 (같은 원인이다. 측정값은 이 계획의 진행 로그에 있다. TD 표는 #102 step7의 전환 PR과 충돌하지 않게 그 PR이 병합된 뒤 갱신한다)
- 계획 `20261116-ops-security`의 의사결정 로그(2026-11-17)에 적힌 "CI 러너(4코어, 지금 3개 동시)"는 근거가 없는 값으로 보인다(비공개 리포는 2코어). → 처리: 해당 없음 (이 계획의 의사결정 로그에 바로잡아 적었다. 지난 기록은 고치지 않는다)
- Codex 계정의 사용 한도에 걸리면 `review/codex`가 판정 없음(error)으로 남아 모든 PR이 멈춘다(위험도 낮음도 Codex 판정이 필요하다). 한도에 가까워졌는지 미리 알 방법이 없고, 판정 없음의 이유는 판정 job 로그를 열어야 보인다. → 처리: #102 (전환 PR이 TD로 등록한다. `needs-human` 댓글)
