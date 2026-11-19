---
id: 20261119-actions-usage-2
issue: 135 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: blocked # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T14:58:53+09:00 # new-task가 채운다
---

# chore: Actions 사용량 절감 2차 — 재현 job의 조건부 실행 (TD-49 ③~⑤ 재검토)

## 목표와 수용 기준

GitHub Actions 청구 분을 줄인다(TD-49, Issue #135, 제작자 지시 2026-11-19). 2026-11-17~18 이틀의 job별 청구는 782분이고, PR 한 라운드(push 한 번)가 약 22분이다. 그 가운데 `check`가 7~8분, 나머지 14~15분은 1분 미만 job 13개가 분 단위로 올림된 값이다.

이 계획은 격리 경계(environment, PR 코드 실행 job의 권한)를 그대로 두고 **할 일이 없는 재현 job**을 돌리지 않게 한다. 재현 job(`repro`)은 지금 판정이 나오면 항상 돈다. 재현 테스트가 붙은 지적이 없으면 할 일이 없는데도 두 판정 워크플로에서 1분씩 청구된다(그 이틀에 57회, 최대 57분으로 782분의 7%).

수용 기준:

1. 판정 job의 유출 검사 명령(`codex-scan`, `claude-scan`)이 판정을 내보낼 때 `GITHUB_OUTPUT` 파일에 `repro=true` 또는 `repro=false` 한 줄을 덧붙인다. 명령을 실제로 실행해 아래 넷을 두 명령 모두에서 확인한다.
   - 지적 가운데 재현 테스트 내용(`repro.content`)이 빈 문자열이 아닌 것이 하나라도 있는 판정: `repro=true`.
   - 재현 테스트가 없는 판정(지적이 없는 승인 포함): `repro=false`.
   - 판정을 내보내지 못한 실행(유출 검사 실패, 종료 코드 0이 아님): `repro` 줄을 쓰지 않는다.
   - `GITHUB_OUTPUT`이 없는 실행(로컬): 지금처럼 판정 파일만 쓰고 종료 코드 0이다.
2. 워크플로 패치를 적용하면 두 판정 워크플로에서 `judge` job이 `repro` 출력을 내고, 재현 job의 조건이 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`이다. 값이 없거나 `false`가 아닌 다른 값이면 지금처럼 돈다(모르면 돌린다).
3. 재현 job의 권한·격리(비밀·environment·쓰기 권한 없음, `reproJobViolations` 위반 없음)와 기록 job의 입력·조건은 그대로다. 재현 job이 건너뛰어져도 기록 job은 돌고 재현 결과 없이 판정을 기록한다. 병합 전에 아래 둘을 테스트로 확인한다.
   - 두 판정 워크플로의 기록 job 조건이 `${{ !cancelled() && needs.plan.result != 'skipped' && needs.plan.outputs.skip != 'true' }}`이고(앞선 job이 건너뛰어져도 돈다) 재현 job의 결과를 조건에 쓰지 않는다. 패치 적용 전과 후의 워크플로 모두에서 단언한다.
   - 기록 명령(`record-review`)이 빈 재현 결과(`--repro-results ''`)를 받으면 판정 상태와 원장을 기록하고, 원장 항목의 재현 칸은 비어 있다.
4. 워크플로 패치(`lab/actions-usage-2/workflows.patch`)가 main의 워크플로에 그대로 적용되고, 적용한 트리에서 워크플로 구조 테스트(`scripts/test/ci.test.ts`, `scripts/test/harness-guard.test.ts`)와 `node scripts/harness.ts check`가 통과한다. 패치를 적용하지 않은 트리(봇이 올리는 head)에서도 통과한다. 적용한 트리의 구조 테스트는 명령 하나(`node lab/actions-usage-2/verify-patch.ts`)로 다시 돌릴 수 있다.
5. 설계서(10.2절 (3), 10.4절의 재현 job), 절차서와 `docs/SECURITY.md`(운영 단계의 워크플로 변경 절차), `CHANGELOG`, 기술 부채 표(TD-49)가 바뀐 동작·절차와 맞는다.

## 범위 / 비범위

범위:

- `scripts/`: 유출 검사 명령의 `repro` 출력과 테스트.
- 워크플로 변경은 **패치 파일로 준비**한다(`judge-claude.yml`, `judge-codex.yml`과 그 구조를 단언하는 테스트의 해당 줄). 봇은 워크플로 파일을 push할 수 없으므로(`docs/SECURITY.md`) 제작자가 이 PR 브랜치에 패치를 적용한 커밋을 마지막으로 올리고 승인한다.
- 문서와 기술 부채 표. CI에서 `testInertPaths` 건너뛰기를 처음 관찰한 결과(TD-49에 남아 있던 확인)도 함께 적는다.

비범위:

- **main의 중복 `test` 생략(TD-49 ③)**: 이 계획에서 뺀다. 계획 검증 1라운드에서 설계 결함 두 가지가 나왔다(의사결정 로그). 고치려면 필수 체크 `check`의 job 구조와 권한을 바꾸고 PR 실행이 "실제로 `test`를 돌린 트리"의 증거를 남기는 경로를 새로 만들어야 한다. 제작자가 할지 정한 뒤 별도 Issue로 한다(열린 질문).
- **job 합치기(TD-49 ④)**: 하지 않는다. job이 나뉜 이유가 environment(시크릿 범위)와 PR 코드 실행 격리다.
- **인증 저장 job(`store`)의 조건부 실행**: 이번에는 하지 않는다. 실행 중 인증 갱신(`changed=true`)과 그 뒤의 복원을 아직 실제로 보지 못했다(TD-38). 매번 저장하는 지금 방식은 저장 경로가 깨지면 바로 드러난다. 첫 갱신을 확인한 뒤 다시 본다(라운드당 1분).
- **`gates`의 제목만 바뀐 수정 생략(TD-49 ⑤)**: 하지 않는다. `gates`의 동시 실행 그룹은 진행 중인 실행을 취소한다. 건너뛰는 실행이 push의 판정을 취소하면 그 head에 상태가 기록되지 않는다. 절감은 8일에 약 40분이다.
- `check.yml`, `revert.yml`, `gates.yml`, 워크플로 토큰 권한, 캐시 규칙(10.4절)은 바꾸지 않는다.

## 관련 파일·문서

- `scripts/harness.ts`(`codex-scan`·`claude-scan` 명령), `scripts/ci/repro.ts`
- 새 파일 `scripts/test/scan-output.test.ts`
- `scripts/test/ci.test.ts`(기록 job 조건 단언을 봇의 커밋에서 더한다. 재현 job 조건 단언은 패치로 바꾼다), `scripts/test/record.test.ts`(빈 재현 결과)
- 읽기만: `scripts/ci/verdict.ts`, `scripts/ci/codex-scan.ts`, `scripts/ci/claude-scan.ts`, `scripts/ci/ledger.ts`, `scripts/gates/harness-guard.ts`(`reproJobViolations`), `scripts/test/codex-scan.test.ts`·`scripts/test/claude-scan.test.ts`(픽스처)
- `lab/actions-usage-2/workflows.patch`, `lab/actions-usage-2/README.md`(패치 적용 방법과 적용 뒤 확인 명령), `lab/actions-usage-2/verify-patch.ts`(임시 클론에 패치를 적용해 구조 테스트를 돌린다)
- 패치가 바꾸는 파일(봇은 커밋하지 않는다): `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `scripts/test/ci.test.ts`의 재현 job 단언
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/CHANGELOG.md`, `docs/SECURITY.md`, `docs/exec-plans/tech-debt-tracker.md`

## step 목록

- step0 repro-on-demand: 유출 검사 명령의 `repro` 출력·테스트·문서와 워크플로 패치를 한 PR로 올린다. 제작자가 패치 커밋을 올리고 승인한다. 병합 뒤 실제 실행을 확인해 Issue에 남긴다.

## 진행 로그

- 2026-11-19: 제작자 대화 지시("이것들 진행하자". TD-49의 남은 후보 ③④⑤)로 봇이 Issue #135를 등록했다. 시작 전에 2026-11-17~18의 job별 청구를 다시 세어(782분) 후보를 다시 골랐다: ④는 합치기 대신 조건부 실행으로, ⑤는 하지 않는다. 계획을 썼다.
- 2026-11-19: 계획만 담은 커밋(`d344773`)을 초안 PR #136으로 올렸다. 이 push의 `check`(실행 44469844146)가 CI에서 `test`를 건너뛰었다: 로그에 `– test (건너뜀) (0.0s)`와 "바뀐 파일 3개가 모두 설정 testInertPaths(테스트가 읽지 않는 경로) 안이다"가 나왔고 job은 29초였다(06:07:14~06:07:43Z. `test`를 돌리는 PR의 `check` job은 평균 402초다). TD-49에 남아 있던 "CI에서 건너뛰는 것은 아직 보지 못했다"의 확인이다. 표에는 step0에서 옮긴다.
- 2026-11-19: 계획 검증 1라운드(head `d344773`). claude 승인(P2 1), codex 수정 요청(P1 4). 모두 받아들였다.
  - F2(P1): main의 `test` 재사용이 고른 PR 실행을 "그 실행이 본 base·트리"와 "실제로 `test`를 돌렸는가"에 묶지 않았다. 같은 head를 다른 base로 검사한 실행이 성공해 있을 수 있고, main에서 다시 계산한 파일 목록은 그 실행이 `test`를 돌렸다는 증거가 아니다. 맞다. 내 근거("head가 main을 담고 있으면 PR 쪽 파일 목록이 main 쪽을 포함한다")는 실행의 base를 모르는 채로는 성립하지 않는다.
  - F3(P1): `check.yml`의 권한은 PR 실행과 push 실행이 같은 job을 쓰므로 워크플로 수준에 더하면 PR 실행의 토큰에도 붙는다. 환경 변수의 push 조건은 한 단계의 변수만 막는다. 맞다. 설계서 10.4절의 PR `check` 권한 경계(`contents: read`)가 바뀐다.
  - 두 지적을 고치려면 `check`를 job 둘로 나누고(push 전용 확인 job) PR 실행이 증거를 남기는 경로를 새로 만들어야 한다. 필수 체크의 구조를 바꾸는 일이라 이 계획에서 빼고 제작자 결정으로 넘겼다(비범위, 열린 질문).
  - F4(P1): 제작자가 패치를 push한 뒤 봇의 worktree가 이전 커밋에 남아 `pr-ready`가 실패한다. main이 그사이 전진한 경우의 절차도 없었다. step0의 5번에 넣었다.
  - F5(P1): AC가 유출 검사 명령의 출력 계약을 실제로 확인하지 않았다. 수용 기준 1을 명령 실행으로 확인하는 네 경우로 쓰고, 새 테스트 파일을 AC에 넣었다.
  - F1(P2, claude): AC의 `git apply --check`는 패치가 적용된 head에서는 실패한다. 적용 전이면 정방향, 적용 뒤면 역방향 확인이 통과하게 고쳤다.
- 2026-11-19: 계획 검증 2라운드(head `c9099c9`). claude 승인(P2 1), codex 수정 요청(P1 1, 앞 라운드의 F2·F3·F5는 해결로 판정). 모두 받아들였다.
  - F4(P1, 열린 채): PR 브랜치만 fetch하면 `origin/main`이 갱신되지 않아 뒤처짐을 놓친다. step0의 5번에서 main도 함께 fetch하게 고쳤다.
  - F7(P1): 재현 job이 건너뛰어졌을 때 기록 job이 도는지를 AC가 확인하지 않았다. 기록 job의 조건 단언(두 워크플로, 패치 전후)과 빈 재현 결과로 기록하는 테스트를 수용 기준 3과 AC에 넣었다.
  - F6(P2, claude): 패치 내용을 확인하는 명령이 AC 밖에 있었다. 임시 클론에 패치를 적용해 구조 테스트를 돌리는 스크립트(`lab/actions-usage-2/verify-patch.ts`)를 두고 AC에 넣었다.
- 2026-11-19: 계획 검증 3라운드(head `47786b9`). claude 승인(지적 없음), codex 수정 요청(P1 1, F4·F7은 해결로 판정). F8(P1): 기존 동작을 고정하는 두 테스트(`ci.test.ts`의 기록 job 조건, `record.test.ts`의 빈 재현 결과)는 변경 전 코드에서도 통과하므로 `test-effect`가 실패로 낸다. 예외 줄을 적는 절차가 step에 없었다. 받아들였다. step0의 1번에 넣었다.
- 2026-11-19: 제작자가 대화에서 열린 질문에 A로 답했다(main의 중복 `test` 생략은 하지 않는다). Issue #135에 기록하고 `needs-human`을 뗐다.
- 2026-11-19: **절차에서 벗어난 것을 적는다.** 계획 검증을 기다리는 동안 step0의 구현 초안(스크립트, 테스트, 패치, 문서)을 worktree에 만들어 두었고(커밋·push하지 않았다), 3라운드 뒤에는 그 초안으로 AC와 `check`를 돌려 본 결과를 계획에 반영해 4라운드를 올렸다. 절차서 2절 "계획 검증"은 중·대 규모 계획의 구현을 G1 승인 뒤로 정한다. 순서를 어겼다.
- 2026-11-19: 계획 검증 4라운드(head `fdc53ff`). claude 승인(지적 없음), codex 수정 요청(P1 2, F8은 해결로 판정). 둘 다 받아들였다.
  - F9(P1): 패치 커밋 뒤의 `ci.test.ts`를 확인하는 절차가 `test-effect`를 `--base` 없이 돌리게 돼 있었다. 비교 기준을 찾지 못하면 이 명령은 "해당 없음"으로 종료 코드 0을 낸다(`scripts/harness.ts`의 `test-effect`, `scripts/lib/git.ts`의 `defaultBase`). step0의 1번에 비교 기준을 구해 넘기는 순서와 통과 조건·실패로 보는 경우를 적었다. 코드로 대조한 것: `--ci`가 없으면 변경 목록에 작업 트리의 변경이 들어간다(`changed`), `testEffect.link`의 `node_modules`는 없으면 건너뛴다(`runOnBase`), 단언 실패는 `effective(base에서 단언 실패, …)`로 출력된다.
  - F10(P1): 위에 적은 순서 위반을 "방식 전환"으로 계획에 적어 두었다. 맞는 지적이다. 의사결정 로그의 방법 전환을 고쳤다(새 방법은 코드 대조이고, 구현과 그 검증은 G1 승인 뒤다). 미리 적어 둔 `test-effect` 예외 줄 두 개는 의사결정 로그에서 뺐다. step0의 1번대로 구현할 때 `check`가 내는 줄을 받아 적는다.
  - worktree의 초안은 G1 승인 전에는 고치지도 돌리지도 않는다. 승인되면 승인된 step0의 "작업"에 한 항목씩 대조하고, 테스트가 변경 전 코드에서 실패하는지를 다시 확인한 뒤 커밋한다. 초안으로 미리 돌려 본 결과는 step의 검증 기록으로 쓰지 않는다.
- 2026-11-19: 5라운드를 올리기 전에 로컬 사전 점검을 했다(서브에이전트 하나가 계획 두 파일을 main 체크아웃의 코드와 대조했다. 읽기만 했다. 병합 판단의 근거가 아니다). 나온 것을 main의 코드에서 직접 다시 확인하고 반영했다.
  - 패치를 적용한 임시 클론의 `check`에 F9와 같은 구멍이 남아 있었다(`--base`와 통과 조건이 없었다. `scripts/commands/check.ts`는 base가 없으면 `defaultBase`를 쓰고 `test-effect`가 건너뛰어져도 통과한다). step0의 2번에 `--base`·`--no-cache`와 통과 조건을 적었다.
  - `scripts/test/ci.test.ts`에는 `judge` job의 출력을 단언하는 줄이 지금 없다(재현 job 조건 단언 한 줄뿐이다). step0의 문장("단언하는 부분만 새 내용에 맞춘다")대로면 출력 줄 단언이 빠질 수 있었다. 새로 더한다고 고쳤다.
  - 절 번호를 고쳤다: 재현 job 설명은 설계서 10.2절 (3)과 10.4절이고(10.3절은 병합이다), `test-effect` 예외 줄은 절차서 3절, 계획 검증은 절차서 2절이다.
  - 그 밖에 고친 것: 예외 줄은 `check`를 실패시키지 않고 `test-effect` 명령으로 받는다(실패 횟수를 쌓지 않는다), `scan-output.test.ts`가 러너의 `GITHUB_OUTPUT`을 넘기지 않는다, `verify-patch.ts`가 `NODE_TEST_CONTEXT`를 뺀다, `judge-codex.yml`의 머리 주석에는 재현 job 설명이 없어 주석 위치를 `if` 위로 정했다, 구현·완료 처리를 한 push로 묶는다, 마지막 `origin/main` 병합 뒤 확인을 다시 돌린다, 병합을 누가 하는지(봇의 자동 병합이 거부되면 제작자)를 적었다, 문서에 "해 본 결과대로" 적을 수 없는 부분(패치 커밋 뒤의 절차)은 다음 PR로 넘긴다.
- 2026-11-19: 계획 검증 5라운드(head `c0f49f7`). claude 승인(지적 없음), codex 수정 요청(P1 1, F9·F10은 해결로 판정). F11(P1): 제작자가 패치 적용을 빠뜨리고 브랜치 갱신 커밋만 올려도, 봇의 확인(최신 main 포함, 필수 체크 통과)이 모두 통과해 `pr-ready`와 자동 병합으로 넘어간다. `verify-patch.ts`는 패치가 없으면 임시 클론에 적용해 통과하므로 "실제 head에 패치가 들어갔는가"를 가리지 못한다. 맞는 지적이다.
- 2026-11-19: **계획을 멈춘다(계획 검증 수정 요청 5회, 절차서 6절).** `status: blocked`. Issue #135에 중단 보고를 남기고 제작자의 결정을 기다린다. 이 커밋은 push하지 않는다(push하면 멈춘 계획에 6번째 판정이 돈다). worktree의 구현 초안은 그대로 둔다(미커밋).

## 의사결정 로그

- 결정: job을 합치지 않고, 할 일이 없는 job을 돌리지 않는 쪽으로 한다. / 이유: 1분 미만 job이 나뉜 이유는 environment별 시크릿 범위와 PR 코드 실행 격리다(10.4절). 합치면 판정용 자격증명과 기록용 자격증명, 또는 PR 코드와 쓰기 권한이 한 러너에 놓인다. / 버린 대안: `gates`의 `evaluate`와 `record` 합치기, 판정 워크플로의 `repro`를 `judge`에 넣기(판정 자격증명이 있는 러너에서 PR 코드를 실행하게 된다).
- 결정: 재현 job을 돌릴지는 판정 job의 유출 검사 명령(main의 스크립트, LLM 없음)이 정해 job 출력으로 넘기고, 워크플로 조건은 "`false`가 아니면 돈다"로 쓴다. / 이유: 판정 내용에서 기계적으로 정해지는 값이다. 값이 빠지거나 깨졌을 때 재현 job이 도는 쪽이 안전하다(2라운드부터 새 P1은 "재현됨"이 아니면 동결되므로, 재현을 빠뜨리면 차단이 풀리는 쪽이다). 판정 출력과 같은 단계에서 나오므로 신뢰 수준은 판정 출력과 같다. / 버린 대안: 워크플로의 셸에서 `jq`로 계산(테스트가 없다), 재현 job 안에서 일찍 끝내기(job이 뜨면 이미 1분이 청구된다).
- 결정: main의 중복 `test` 생략을 이 계획에서 뺀다. / 이유: 계획 검증에서 나온 두 결함(진행 로그 F2·F3)을 고친 설계는 `check`를 job 둘로 나누고, PR 실행이 "`test`를 실제로 돌린 트리"를 남기는 증거 경로(예: 실행의 아티팩트 이름)를 만들고, 확인 job이 한 번 더 청구된다. 병합당 절감이 5~6분에서 4~5분으로 줄고, 필수 체크 `check`의 조건을 잘못 쓰면 job이 건너뛰어져 통과로 보이는 위험이 생긴다. 얻는 것(이틀에 40~50분, 6% 안팎)에 비해 main의 마지막 안전망과 필수 체크의 구조를 바꾸는 비용이 크다. 할지는 제작자가 정한다. / 버린 대안: 이 계획 안에서 다시 설계하기(계획 검증과 구현 라운드가 여러 번 더 들고, 재현 job 쪽 절감이 그동안 묶인다).
- 결정: 계획 위험도는 높음으로 둔다. / 이유: 판정 워크플로를 바꾼다. 운영 단계라 보호 경로 변경으로 어차피 제작자 승인 대상이다. / 버린 대안: 보통.
- 결정: 스크립트와 워크플로 패치를 한 PR에 넣고, 제작자가 패치 커밋을 그 브랜치의 마지막 커밋으로 올린다. / 이유: 판정 워크플로는 병합된 뒤의 정의로 돌기 때문에 스크립트와 워크플로가 한 번에 들어가야 어긋나는 구간이 없다(따로 들어가도 조건이 "`false`가 아니면 돈다"라 안전하지만 판정 라운드와 승인이 한 번씩 더 든다). 제작자가 따로 PR을 올리면 제작자는 자기 PR을 승인할 수 없어 `risk-gate`의 제작자 head 승인을 채울 수 없다. 봇이 연 PR에 제작자가 커밋을 더하면 두 검증자가 워크플로 변경까지 판정하고 제작자가 승인할 수 있다. 워크플로 커밋이 브랜치에 들어간 뒤에 봇이 그 위에 push할 수 있는지는 확인된 적이 없어, 봇의 작업을 모두 끝낸 뒤 마지막에 올린다. / 버린 대안: 스크립트 PR과 워크플로 PR을 따로, 봇 토큰에 `workflow` 권한 주기(`docs/SECURITY.md`가 금지한다).
- 방법 전환(계획 검증, 3회): 가설 지적된 항목만 고치면 다음 라운드에 수렴한다 / 시도한 방법 라운드마다 지적된 문장만 고쳐 다시 올렸다 / 폐기 이유 세 라운드 모두 다른 자리에서 같은 종류의 새 지적("계획대로 하면 그 명령·검사가 실제로 어떻게 동작하는가": AC가 수용 기준을 확인하지 않음, 제작자 push 뒤의 절차, `test-effect` 예외)이 나왔다 / 새 방법 계획을 올리기 전에 step의 "작업"·AC 문장마다 그 문장이 기대는 기존 코드(명령의 기본값과 종료 코드, 검사가 건너뛰는 조건, 판정 조건)를 직접 읽어 대조하고, 확인 절차에는 통과 조건과 실패로 보는 경우를 함께 적는다. 구현과 구현에 대한 AC·`check` 실행은 G1 승인 뒤에 한다(절차서 2절 "계획 검증"). 4라운드에 올린 판(구현을 먼저 끝까지 돌려 보고 계획을 고친다)은 그 순서를 뒤집는 것이어서 버렸다(진행 로그 F10).
- 결정: 제작자의 답(2026-11-19 대화, A)에 따라 main의 중복 `test` 생략은 하지 않는다. / 이유: 절감(이틀에 40~50분 추정)에 비해 필수 체크 `check`의 job 구조와 권한을 바꾸는 위험과 비용이 크다. / 버린 대안: 별도 Issue로 다시 설계(B).
- 결정: step은 하나로 둔다. 병합 뒤 확인은 Issue 댓글로 남긴다. / 이유: 계획 위험도가 높음이라 기록만 하는 둘째 step PR도 제작자 승인이 필요해진다. 급하지 않은 기록은 다음 PR에 모으는 것이 절차서 5절의 규칙이다. / 버린 대안: 관찰·기록 step을 따로 두기.

## 발견 사항

- 운영 단계에서 워크플로를 바꾸는 절차가 문서에 한 줄뿐이다("봇이 내용을 Issue나 패치로 넘기고 제작자가 직접 PR을 올린다"). 제작자가 연 PR은 제작자가 승인할 수 없어 `risk-gate`를 통과하지 못한다. 이 계획에서 "봇의 PR 브랜치에 제작자가 패치 커밋을 더한다"로 해 보고, 된 절차를 문서에 적는다(step0). → 처리: [docs/SECURITY.md](../../../SECURITY.md)
- TD-49의 "1분 미만 job 합치기 240~480분"은 합칠 수 있다는 가정의 추정이었다. 격리를 지키면 합칠 수 있는 job이 없고, 조건부 실행으로 줄일 수 있는 것은 재현 job(이틀에 57분)이다. step0에서 표를 고친다. → 처리: TD-49
- TD-49의 "main의 중복 `check` 건너뛰기 약 260분"도 구조 변경 없이 되는 것으로 적혀 있었다. 실제로는 필수 체크의 job 구조·권한·증거 경로를 바꿔야 한다(진행 로그 F2·F3). step0에서 표에 조건과 함께 적는다. → 처리: TD-49

## 열린 질문

### 질문: main의 중복 `test` 생략(TD-49 ③)을 별도 작업으로 할 것인가

- 해당 항목: 보안·권한 결정(필수 체크 `check`의 job 구조와 워크플로 토큰 권한).
- A) 하지 않는다. — 영향: main의 `check`는 지금처럼 병합마다 `test`를 전부 돌린다(이틀에 10회, 약 79분). 구조와 권한은 그대로다.
- B) 별도 Issue로 다시 설계해서 한다. — 영향: `check.yml`에 push 전용 확인 job(읽기 권한 `actions`·`pull-requests`)을 더하고, PR의 `check`가 `test`를 실제로 돌린 트리를 증거로 남기게 한다. 병합당 4~5분(이틀에 40~50분)이 줄 것으로 추정한다. 계획 검증과 구현에 판정이 여러 라운드 든다(PR #130은 4라운드에 약 80분이었다).
- 추천: A. 이유: 절감(6% 안팎)에 비해 main의 마지막 안전망과 필수 체크 구조를 바꾸는 위험과 비용이 크다. (처음 올린 질문에는 "같은 분량은 `test` 자체의 소요를 줄이는 쪽에서 찾을 수 있다"고 적었는데 재지 않고 쓴 문장이라 뺐다. PR의 `check`가 이틀에 230분(29%)으로 가장 큰 덩어리라는 것까지만 확인했다.)
- 진행: 이 계획은 답과 무관하게 재현 job만 한다. B면 별도 Issue를 등록한다.
- **답(2026-11-19, 제작자 대화): A.** Issue #135에 기록했다. 별도 Issue는 등록하지 않는다.

## 검증 방법과 결과

- 수용 기준 1: `node --test scripts/test/scan-output.test.ts`(두 명령을 실제로 실행해 네 경우를 본다).
- 수용 기준 2·3: `node lab/actions-usage-2/verify-patch.ts`(HEAD를 임시 클론으로 받아 패치를 적용하고 `node --test scripts/test/ci.test.ts scripts/test/harness-guard.test.ts`를 돌린다: 재현 job 조건·권한·`reproJobViolations`, `judge` job의 `repro` 출력, 기록 job의 `needs`·조건·입력 단언. 패치가 이미 적용된 head에서는 적용 없이 같은 테스트를 돌린다). 기록 명령은 `node --test scripts/test/record.test.ts scripts/test/repro.test.ts`.
- 수용 기준 4: 위 명령(패치 적용 가능 여부 포함)과, 패치를 적용한 임시 클론의 `node scripts/harness.ts check --base <비교 기준> --no-cache`(step0의 2번. `test`와 `test-effect`가 실제로 돈 것을 통과 조건으로 본다. 결과를 진행 로그에 적는다). 봇의 head에서는 `node scripts/harness.ts check`.
- 수용 기준 5: `node scripts/harness.ts doc-lint`.
- 병합 뒤(Issue #135 댓글): 재현 테스트가 없는 판정에서 두 워크플로의 `repro` job이 `skipped`이고 기록 job이 판정을 기록하는지, 재현 테스트가 붙은 판정이 나오면 `repro` job이 도는지(기회가 생기면).

## 다음 할 일

- 멈춤. Issue #135의 중단 보고에 대한 제작자의 답을 기다린다.
- 승인되면 step0을 구현한다(worktree의 초안을 승인된 step에 대조해 쓴다. 진행 로그).
