---
id: 20261119-repro-on-demand
issue: 143 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T19:40:10+09:00 # new-task가 채운다
---

# 재현 job을 재현 테스트가 붙은 지적이 있을 때만 띄운다 (TD-49 ④, #135를 새 절차로 다시 시작)

## 목표와 수용 기준

판정 워크플로(`judge-claude.yml`, `judge-codex.yml`)의 재현 job(`repro`)은 판정이 나오면 항상 돈다. 재현 테스트가 붙은 지적이 없으면 실행할 것이 없는데도 job 하나에 1분이 청구된다. 2026-11-17~18 이틀에 57회였다(최대 57분, 그 이틀 청구 782분의 7%. TD-49 ④). 할 일이 없는 재현 job을 띄우지 않는다. 격리 경계(재현 job의 권한, environment)와 기록 job은 그대로 둔다.

같은 일을 Issue #135에서 계획했다가 접었다(PR #136). 이번에는 #139에서 정한 순서로 한다(`docs/SECURITY.md` "워크플로 변경 절차": 제작자의 워크플로 커밋이 먼저, 봇의 구조 테스트가 그 뒤).

수용 기준:

1. 유출 검사 명령(`codex-scan`, `claude-scan`)이 판정을 내보낼 때 환경 변수 `GITHUB_OUTPUT`이 가리키는 파일에 `repro=true` 또는 `repro=false` 한 줄을 덧붙인다. 두 명령을 실제로 실행하는 테스트로 아래 넷을 확인한다.
   - 지적 가운데 재현 테스트 내용(`repro.content`)이 빈 문자열이 아닌 것이 하나라도 있는 판정: `repro=true`.
   - 그런 지적이 없는 판정(지적이 없는 승인 포함): `repro=false`.
   - 판정을 내보내지 못한 실행(종료 코드가 0이 아니다): `repro` 줄을 쓰지 않는다.
   - `GITHUB_OUTPUT`이 없는 실행(로컬): 지금처럼 판정 파일만 쓰고 종료 코드 0이다.
2. 두 판정 워크플로에서 `judge` job이 출력 `repro`(`${{ steps.scan.outputs.repro }}`)를 내고, 재현 job의 조건이 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`이다. 값이 없거나 `false`가 아닌 값이면 지금처럼 돈다(모르면 돌린다). `scripts/test/ci.test.ts`가 두 워크플로에서 단언한다.
3. 재현 job의 권한·격리와 기록 job의 입력·조건은 바뀌지 않는다. 재현 job이 건너뛰어져도 기록 job은 돈다: `scripts/test/ci.test.ts`가 두 워크플로의 기록 job 조건이 `${{ !cancelled() && needs.plan.result != 'skipped' && needs.plan.outputs.skip != 'true' }}`이고 그 조건에 `needs.repro`가 나오지 않는 것을 단언한다.
4. 병합되는 head에는 워크플로 변경과 그것을 단언하는 테스트가 함께 있다. step의 AC는 워크플로 변경이 없는 트리에서 실패하고(수용 기준 2의 새 단언), 워크플로만 바뀐 트리에서도 실패한다(지금의 단언이 옛 조건을 요구한다).
5. 설계서(10.2절 (3), 10.4절), `CHANGELOG`, 기술 부채 표(TD-49)가 바뀐 동작과 맞는다. 워크플로 변경 절차의 기록 둘을 고친다.
   - `docs/SECURITY.md` "워크플로 변경 절차"의 "해 보지 않은 것" 첫 항목(계획 검증을 받는 중·대 규모 계획에서의 순서)을 이 PR에서 해 본 결과로 고친다: 초안 PR이 열린 상태에서 제작자의 커밋만 올라간 head의 `check`가 어떻게 됐는지, 봇의 다음 push까지 무엇이 기록됐는지.
   - `lab/workflow-change/result.json`의 `bot-enables-auto-merge`(지금 `n/a`)를 #139의 결과로 고친다: PR #141에서 봇이 자동 병합을 켰고(2026-11-19T10:02:39Z) 제작자 승인(10:34:11Z) 뒤 병합됐다(10:36:12Z, `bd18dd0`). 근거는 Issue #139의 병합 뒤 관찰 댓글이다. 같은 절의 6번("자동 병합을 봇이 켜지 못하면")에는 PR #141에서 켜졌다는 것을 덧붙인다.

## 범위 / 비범위

범위:

- `scripts/`: 유출 검사 명령의 `repro` 출력과 그 테스트, 워크플로 구조 테스트.
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`: `judge` job의 출력 한 줄, 재현 job의 조건 한 줄과 그 위의 주석 한 줄. **제작자가 커밋한다.** 봇은 패치 파일로 준비한다.
- 문서와 기술 부채 표, 시험 기록(`lab/`).

비범위:

- 재현 job의 실행 내용(`runRepro`), 기록 쪽(`record-review`, `parseReproResults`, 원장), 재현 job의 권한·environment·캐시 규칙.
- main의 중복 `test` 생략(TD-49 ③, 제작자 결정으로 하지 않는다), job 합치기, `gates`의 제목 수정 생략(TD-49 ⑤), 인증 저장 job(`store`)의 조건부 실행.
- `check.yml`, `gates.yml`, `revert.yml`.

## 관련 파일·문서

- `scripts/ci/repro.ts`, `scripts/harness.ts`(`codex-scan`·`claude-scan` 명령)
- `scripts/test/scan-output.test.ts`(새 파일), `scripts/test/ci.test.ts`
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`(제작자 커밋)
- `lab/repro-on-demand/`(워크플로 패치와 적용 방법), `lab/workflow-change/result.json`
- `docs/harness/design.md`, `docs/harness/CHANGELOG.md`, `docs/SECURITY.md`, `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `scripts/ci/verdict.ts`, `scripts/ci/codex-scan.ts`, `scripts/ci/claude-scan.ts`, `scripts/gates/harness-guard.ts`, `scripts/test/record.test.ts`, `scripts/test/repro.test.ts`

## step 목록

- step0 repro-on-demand: 유출 검사 명령의 `repro` 출력, 워크플로 변경(제작자 커밋), 구조 테스트, 문서를 한 PR로 올린다.

## 진행 로그

- 2026-11-19: 제작자 대화 지시("TD-53대로 워크플로 변경 절차를 먼저 따로 정한 뒤 새 Issue로 다시 시작해")로 봇이 Issue #143을 등록했다. 절차는 #139(PR #141, 병합 `bd18dd0`)에서 정했다. 계획을 썼다.
- 2026-11-19: #139의 병합 뒤 관찰. 워크플로 변경이 든 PR #141은 봇이 켠 자동 병합으로 병합됐다(제작자 승인 10:34:11Z, 병합 10:36:12Z). main의 `judge-codex.yml`에 더한 줄이 있다. 그 뒤 main의 `check`(실행 44507204377)와 판정 워크플로의 결과는 이 PR의 첫 판정에서 확인해 적는다.
- 2026-11-19: 계획만 담은 커밋(`50943aa`)을 초안 PR #144로 올렸다. main의 `check`(실행 44507204377, #141 병합 커밋)는 성공했고, 이 PR의 판정 워크플로 둘도 main의 새 정의로 정상으로 돌았다.
- 2026-11-19: 계획 검증 1라운드(head `50943aa`). claude 승인(지적 없음), codex 수정 요청(P1 1, P2 1). 둘 다 받아들였다.
  - F1(P1): 제작자에게 요청하기 전에 패치와 새 구조 테스트를 함께 확인하는 단계가 step에 없었다. 패치에 출력 줄이 빠져 있어도 push 1의 `check`와 트리 비교는 통과하고, 누락은 제작자가 커밋한 뒤에야 드러난다. `docs/SECURITY.md`의 절차 1번이 요구하는 확인이기도 하다. step0의 2번에 넣었다: 구조 테스트를 먼저 고쳐 실패를 보고, 워크플로를 고쳐 AC가 통과하는 상태의 diff를 패치로 저장한다(패치는 통과를 확인한 그 트리에서 나온다).
  - F2(P2): 수용 기준 5가 어느 기록을 어느 PR의 결과로 고치는지 모호했다. 둘로 나눠 적었다(`docs/SECURITY.md`는 이 PR의 G1 중간 head, `lab/workflow-change/result.json`은 #139의 자동 병합).
- 2026-11-19: 계획 검증 2라운드(head `5d4e0a0`). claude·codex 승인(지적 없음). 원장: `계획 검증(G1): 해시 3c99817ee7af · 승인: claude, codex`. 여기서부터 구현이다.
- 2026-11-19: step0의 1번. `scripts/test/scan-output.test.ts`를 먼저 뒀다(접은 #136의 초안을 참고했다). `hasRepro`만 넣은 상태에서 9개 가운데 4개가 실패했다(두 명령의 `repro=true`·`repro=false` 경우: 기대한 `['repro=true']` 대신 `[]`). 읽지 못한 판정은 돌리는 쪽으로 내는 것을 시험할 수 있게 값 계산을 `reproOutputValue(verdict: unknown)`으로 `scripts/ci/repro.ts`에 두고 테스트를 더했다(실패 확인: export 없음). 명령에 출력을 넣은 뒤 `scan-output`·`repro`·`claude-scan`·`codex-scan` 테스트 36개가 통과했다.
- 2026-11-19: step0의 2번. `scripts/test/ci.test.ts`의 재현 job 테스트를 먼저 고쳤다. 지금 워크플로에서 AC 명령이 78개 가운데 1개 실패했다("judge-\*.yml: 재현 job은 …": 새 조건의 정규식이 `if: needs.judge.outputs.verdict != ''`에 맞지 않는다). 워크플로 두 파일을 고친 트리에서 AC 78개가 통과했고, 그 트리의 `git diff -- .github/workflows`를 `lab/repro-on-demand/workflows.patch`로 저장했다(두 파일, 각각 3줄 추가 1줄 삭제). 같은 트리에서 `check`도 통과했다(`test` 153.0초. test-effect: `ci.test.ts`는 `effective(base에서 단언 실패)`, `scan-output.test.ts`는 `effective(base에서 실패(단언 실패 아님: 모듈 없음 등))`). 그다음 워크플로를 되돌리고(`git apply -R`) `ci.test.ts`의 변경은 리포 밖 파일로 옮겼다. 되돌린 트리에 패치가 그대로 적용되는 것을 확인했다(`git apply --check` 종료 코드 0).
- 2026-11-19: step0의 3번. 설계서 v0.7.58(10.2절 (3), 10.4절 "재현 job이 도는 조건"), `CHANGELOG`, TD-49 ④, `lab/repro-on-demand/README.md`.

## 의사결정 로그

- **순서**: 계획 검증(G1) → 봇의 push 1(스크립트, 그 테스트, 문서, 워크플로 패치 파일) → 제작자의 워크플로 커밋(GitHub 웹) → 봇의 push 2(워크플로 구조 테스트, 완료 처리) → 판정 → 승인. 이유: 워크플로 변경과 그 단언이 서로를 요구하게 해서, 어느 한쪽이 빠진 head가 `check`를 통과하지 못하게 한다. push 1에서 설계 전체(패치 포함)가 판정을 받으므로, 패치를 고쳐야 하는 지적은 제작자에게 요청하기 전에 나온다. 버린 대안: 봇이 먼저 전부 올리고 제작자가 마지막에 패치를 올린다(#135. 패치가 빠져도 `check`가 통과해 사람의 확인에 기대야 했다).
- **계획 검증과의 순서**: #139는 소규모라 PR을 봇의 마지막 push 뒤에 열었다. 이 계획은 중규모라 계획만 담은 초안 PR이 먼저 열린다. 그래서 제작자의 커밋만 올라간 head에서 `check`가 돌고 실패한다(지금의 구조 단언이 옛 조건을 요구한다). 기대한 실패다. 봇이 바로 이어서 push 2를 올린다. `docs/SECURITY.md`에 "해 보지 않은 것"으로 적어 둔 갈래이고, 이번에 해 본 대로 문서를 고친다.
- **push 1이 병합될 수 없는 이유**: 완료 처리(`complete-step`)를 push 2에서 한다. 그 전에는 `plan-gate`가 실패하고 PR은 초안이다.
- **값이 없으면 돈다**: 조건을 `!= 'false'`로 쓴다. 출력이 빠지거나 깨졌을 때 재현을 건너뛰면 재현된 P1이 원장에 남지 않는다. 버린 대안: `== 'true'`.
- **`repro` 출력의 기준은 `runRepro`와 같다**: `runRepro`는 `repro.content`가 빈 지적을 건너뛴다(`scripts/ci/repro.ts`). 같은 기준으로 "하나도 없다"를 `false`로 낸다. 그러면 건너뛰어진 재현 job이 기록 job에 넘기는 값(빈 문자열)은, 지금 재현 테스트가 없는 판정에서 재현 job이 내는 값(`reproResultsData([])`가 빈 문자열)과 같다. 기록 쪽은 바꿀 것이 없고, 빈 값의 처리는 이미 테스트가 있다(`scripts/test/repro.test.ts`의 `parseReproResults('', …)`가 빈 배열, `scripts/test/record.test.ts`의 `--repro-results` 없는 기록들). 그래서 `record.test.ts`는 고치지 않는다(지금 동작을 고정하는 테스트를 더하면 변경 전 코드에서도 통과해 `test-effect`가 실효 없음으로 낸다).
- **기록 job 조건의 단언은 `ci.test.ts`에 넣는다**: 지금 구조를 고정하는 단언이지만 같은 파일에 수용 기준 2의 새 단언이 있어 파일 전체는 변경 전 트리에서 실패한다.
- **접은 #136의 초안**: 옛 worktree(`feat/20261119-actions-usage-2-s0`)에 미커밋으로 남아 있다. 계획 검증 승인 전에는 열지도 돌리지도 않는다. 승인 뒤에 참고하되, 테스트가 변경 전 코드에서 실패하는 것을 이 worktree에서 다시 확인하고 구현한다.

## 발견 사항

- 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- 수용 기준 1~4: step0의 AC(테스트 다섯 파일).
- 수용 기준 5: `node scripts/harness.ts check`의 doc-lint와 자체 리뷰.
- 병합 뒤(AC가 아니다. 관찰해서 Issue #143에 남긴다): 재현 테스트가 없는 판정에서 재현 job이 건너뛰어지고 기록 job이 판정을 기록하는지, 두 판정 워크플로에서 본다.

## 다음 할 일

- 계획만 담은 커밋을 올려 계획 검증을 받는다. 승인 뒤 step0.
