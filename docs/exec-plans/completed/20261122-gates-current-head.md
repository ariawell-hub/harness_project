---
id: 20261122-gates-current-head
issue: 181 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-22T00:07:49+09:00
---

# PR 본문 수정 직후 push하면 새 head에 게이트 상태가 기록되지 않는다: ci-pr이 현재 head를 조회한다

- 목표: `gates` 워크플로가 `pull_request_target` 이벤트로 돌 때도 이벤트에 담긴 head가 아니라 실행 시점의 PR head를 판정한다. PR 본문을 고친 직후에 push하면 본문 수정의 실행(이전 head를 담은 이벤트)이 push의 실행을 취소하고 이전 head에 상태를 기록해, 새 head에 게이트 상태가 없는 채로 남았다(PR #177의 4라운드, Issue #181). 그리고 `pr-state`가 "검증자의 판정은 났는데 게이트 상태가 없는" head에서 원인과 다시 돌리는 법을 한 줄 알려 준다.
- 변경: (1) `scripts/ci/pr.ts`의 `resolvePr`: `pull_request_target`에서 이벤트의 PR이 같은 리포 브랜치의 PR이면 그 번호로 `repos/<리포>/pulls/<번호>`를 조회해 **응답의** head SHA·base SHA·head ref·본문을 낸다. 이벤트의 PR이 같은 리포 브랜치의 PR이 아니면(포크, 형식 오류) 전처럼 API를 부르지 않고 건너뛴다. 응답이 객체가 아니거나 번호가 이벤트의 번호와 다르거나 형식이 틀리면(head·base SHA, head ref) 예외를 던진다(실행이 실패로 드러난다. 상태가 조용히 빠지지 않게 한다). 응답의 head 저장소가 이 리포가 아니면(지워진 저장소 포함) 포크 PR로 보고 건너뛴다. API 호출의 실패는 `workflow_run` 경로와 같이 예외다. PR의 열림·닫힘은 전처럼 따지지 않는다. PR 번호가 양의 정수가 아닌 이벤트·응답은 PR로 보지 않는다(번호를 조회 경로에 넣기 때문이다. `workflow_run` 경로의 응답에도 같은 확인이 적용된다). 그 밖에 `workflow_run` 경로와 다른 이벤트는 그대로다. 워크플로 파일은 바꾸지 않는다(그 단계에는 이미 조회용 토큰이 있다). (2) 기존 테스트 `scripts/test/risk-gate.test.ts`의 "resolvePr: pull_request_target은 이벤트에서, 포크는 건너뛴다"를 새 동작의 테스트 넷으로 바꾼다: 이 테스트는 "API를 부르지 않는다"와 "이벤트의 값을 낸다"를 단언하는데 그 동작이 바뀐다(R5). 포크는 API를 부르지 않고 건너뛴다는 단언은 남긴다. (3) `scripts/runner/pr-state.ts`에 순수 함수 `gatesMissing(required)`를 더한다: 필수 체크에 든 검증자 판정(`review/claude`, `review/codex`)의 상태가 모두 `success`나 `failure`인데 게이트(`scripts/ci/results.ts`의 `GATE_CONTEXTS`에 든 필수 체크)의 상태가 `missing`인 것이 있으면 그 이름들을 낸다(아니면 빈 배열. 필수 체크에 검증자 판정이 없어도 빈 배열). `scripts/commands/pr-state.ts`가 그 이름들이 있으면 필수 체크 목록 아래에 한 줄을 낸다(게이트 상태가 없다는 것, 기다려도 오지 않는다는 것, 실행을 찾는 명령과 다시 돌리는 명령). PR의 분류(`classifyPr`)는 바꾸지 않는다. (4) 문서: 설계서 10.4절의 `risk-gate` 재판정 항목에 `pull_request_target`에서도 API로 현재 head를 조회한다는 설명, 절차서 5절의 "본문은 올릴 때 맞추고…" 항목에 설명(본문 수정과 push가 겹쳐도 실행 시점의 head를 판정한다. 판정은 났는데 게이트 상태가 없으면 `pr-state`의 안내를 따른다), `docs/harness/architecture.md`의 `runner/*` 행에 `gatesMissing`, 설계서 0절 버전 이력, `docs/harness/CHANGELOG.md`.
- 검증: node --test scripts/test/risk-gate.test.ts scripts/test/pr-state.test.ts

## 관련 파일·문서

- `scripts/ci/pr.ts`, `scripts/runner/pr-state.ts`, `scripts/commands/pr-state.ts`
- `scripts/test/risk-gate.test.ts`, `scripts/test/pr-state.test.ts`
- `docs/harness/design.md`(10.4절, 0절 버전 이력), `docs/harness/workflow.md`(5절), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `.github/workflows/gates.yml`(읽기만 한다. 고치지 않는다)

## 테스트 (먼저 쓴다)

- `resolvePr`, `pull_request_target`:
  - 이벤트의 head가 이전 것이고 응답의 head·base·본문·head ref가 새것이면 응답의 값을 낸다. API는 `repos/o/r/pulls/7` 한 번만 부른다.
  - 닫힌 PR(`state: 'closed'`)의 응답도 값을 낸다(열림·닫힘을 따지지 않는다).
  - 이벤트의 PR이 포크거나(head 저장소가 다른 리포, `null`) 형식이 틀리면(head SHA가 SHA가 아니다, 번호가 문자열·0·소수·음수) API를 부르지 않고 건너뛴다. 이벤트에 PR이 없어도 같다.
  - 응답이 객체가 아니면(`null`, `undefined`, 문자열, 배열), 번호가 없거나 다르면, 형식이 틀리면(head SHA, head ref, base SHA) 예외다.
  - 응답의 head 저장소가 다른 리포거나 `null`이면 건너뛴다.
  - API가 던지면 그 예외가 그대로 나온다.
- `resolvePr`, `workflow_run`과 그 밖의 이벤트: 있던 테스트가 그대로 통과한다(고치지 않는다).
- `gatesMissing`: 판정이 모두 났고(`success`·`failure` 조합) 게이트 하나 이상이 `missing`이면 그 이름들을 설정 순서로 낸다. 판정 하나가 `missing`·`pending`·`error`이면 빈 배열이다. 게이트가 모두 기록돼 있으면(`success`·`failure`·`pending`·`error`) 빈 배열이다. `check`(Actions 출처)와 `review-ledger`가 `missing`인 것은 세지 않는다. 필수 체크에 검증자 판정이 없으면 빈 배열이다. `revert-check`도 게이트로 센다.
- `pr-state` 명령: 판정이 났고 게이트 상태가 없는 head에서 출력에 안내 한 줄(게이트 이름, `gh run list --workflow gates --branch <브랜치>`, `gh run rerun`)이 필수 체크 목록과 분류 줄 사이에 있다. 판정 하나가 아직 없을 때와 게이트가 기록된 뒤에는 그 줄이 없다. 분류는 그대로 `wait-ci`이고 읽기만 한다(있는 `pr-state` 테스트의 가짜 GitHub으로 본다).

## 진행 로그

- 2026-11-22 접수: 제작자가 대화에서 "Issue를 등록해 고친다"로 정했다(2026-11-21). Issue #181을 `new-task`로 시작했다.
- 2026-11-22 사전 확인: `.github/workflows/gates.yml`의 "판정할 PR 정하기" 단계에는 이미 `GH_TOKEN`(워크플로 토큰, `pull-requests: read`)이 있다. `workflow_run` 경로가 같은 토큰으로 API를 조회한다. 워크플로를 바꾸지 않고 스크립트만으로 고칠 수 있다. `gates`는 main의 스크립트(`base/`)로 돌므로 이 변경은 병합 뒤의 실행부터 적용된다.
- 2026-11-22 테스트 먼저: 새 테스트를 넣고 구현 전에 돌렸다. `risk-gate.test.ts`는 새 테스트 4건이 실패했고(나머지 10건 통과), `pr-state.test.ts`는 `gatesMissing`이 없어 파일 전체가 실패했다.
- 2026-11-22 구현: `resolvePr`, `gatesMissing`, `pr-state` 명령의 안내 줄을 넣었다. 두 파일의 테스트 41건이 통과한다.
- 2026-11-22 문서: 설계서 10.4절·버전 이력(v0.7.72), 절차서 5절, `architecture.md`, CHANGELOG.
- 2026-11-22T00:55:52+09:00 step 재작업: 구현 판정 1회차(Codex 수정 요청). F1(P0): `pr-state`의 안내 줄이 PR 브랜치 이름을 인용 없이 셸 명령에 넣는다. F2(P1): 조회 응답의 head 저장소에 이름이 없으면(빈 객체) 포크로 보고 조용히 건너뛴다. 둘 다 맞는 지적이라 고친다.
- 2026-11-22 구현 판정 1회차: Claude 승인(지적 없음), Codex 수정 요청(P0 하나, P1 하나).
  - F1(P0): `pr-state`의 안내 줄이 PR 브랜치 이름(`pr.head`, GitHub에서 온 값)을 인용 없이 `gh run list … --branch` 명령에 넣는다. git은 셸의 특수 문자가 든 브랜치 이름을 받으므로, 안내를 복사해 실행하면 이름의 일부가 명령으로 읽힐 수 있다. 맞는 지적이다. 안내 줄을 함수(`gatesMissingLine`)로 빼고 브랜치 이름을 있는 `shellQuote`로 낱말 하나로 인용했다. 제어 문자가 든 이름은 넣지 않는다. 테스트 먼저: 특수 문자가 든 이름 여덟 개로 인용의 꼴을 보고, 실제 `sh`가 그 낱말을 이름 그대로 읽는지(다른 명령이 실행되지 않는지) 본다. 구현 전에는 함수가 없어 실패했다.
  - F2(P1, 재현됨): 조회 응답의 head 저장소가 이름 없는 객체(`{}`)면 포크로 보고 건너뛰었다. 형식이 틀린 응답은 실패로 드러나야 한다는 이 계획의 기준과 어긋난다. 맞는 지적이다. head 저장소가 `null`이거나 이름이 다른 리포로 **확인될 때만** 포크로 본다. 이름이 없거나 글이 아니거나 빈 글이면 예외다. 테스트 먼저: 그 응답 여섯 가지를 "건너뛰지 않고 실패한다" 테스트에 넣어 실패를 확인한 뒤 고쳤다.
  - 완료 처리 뒤라 `reopenStep`으로 step을 다시 열고 고쳤다.
- 2026-11-22T01:13:44+09:00 step 재작업: 구현 판정 2회차(Claude 승인, Codex 수정 요청). F1·F2는 고쳐진 것으로 닫혔다. F3(P1, 재현됨): 조회 응답의 head 저장소 이름이 `owner/name` 꼴이 아닌 글(`invalid`)이어도 "다른 리포"로 보고 건너뛴다. 맞는 지적이다(F2와 같은 원칙: 포크로 확인될 때만 건너뛴다). 이름이 `owner/name` 꼴일 때만 다른 리포로 본다. 테스트를 먼저 넣어 실패를 확인하고 고친다.

## 의사결정 로그

- 결정: 이벤트의 PR 번호로 PR을 다시 조회해 응답의 값을 쓴다. / 이유: 동시 실행 묶음이 PR 번호이고 진행 중인 실행을 취소하므로, 어느 이벤트의 실행이 남든 실행 시점의 head를 판정하면 현재 head에 상태가 기록된다. `workflow_run` 경로가 이미 같은 원칙이다(페이로드를 믿지 않고 조회한다). / 버린 대안: 본문 수정 이벤트(`edited`)에서는 판정하지 않기(본문을 읽는 게이트가 본문 수정 뒤에 다시 돌지 않는다), 동시 실행 묶음을 head SHA로 바꾸기(워크플로 변경이 필요하고 이전 head의 실행이 취소되지 않는다).
- 결정: 응답이 이벤트의 PR과 맞지 않거나 형식이 틀리면 건너뛰지 않고 예외를 던진다. / 이유: 건너뛰면 상태가 기록되지 않은 채 실행이 성공으로 보인다. 이번 문제가 바로 "상태가 조용히 빠진" 것이다. 실패한 실행은 눈에 보이고 다시 돌릴 수 있다.
- 결정: 포크 PR은 전처럼 이벤트만 보고 건너뛴다(API를 부르지 않는다). 응답에서 head 저장소가 이 리포가 아닌 것으로 나오면 그것도 포크로 보고 건너뛴다. / 이유: 포크 PR을 판정하지 않는 조건(10.4절)을 그대로 둔다. 워크플로의 job 조건도 이벤트의 값으로 같은 판단을 한다.
- 결정: PR 번호는 양의 정수만 받는다. / 이유: 번호가 조회 경로에 들어간다. 이벤트는 GitHub이 만든 값이지만 경로에 넣는 값은 형식을 확인하고 쓴다.
- 결정: `pr-state`는 안내만 더하고 분류는 바꾸지 않는다. / 이유: runner의 분기(`classifyPr`)를 바꾸면 무인 실행의 동작이 달라진다. 이 Issue의 범위는 대화 세션이 오지 않는 상태를 오래 기다린 것이다. 고친 뒤에는 이 상태가 드물어야 한다.
- 결정: 게이트 상태가 없다고 알리는 조건을 "검증자의 판정이 모두 난 뒤"로 둔다. / 이유: 게이트는 push 직후에 돌아 몇 분 안에 끝나고, 판정은 `check`가 끝난 뒤에 시작한다. 판정이 난 뒤에도 게이트 상태가 없으면 정상적인 대기가 아니다. push 직후의 정상적인 대기에는 줄이 나오지 않는다.
- 결정: 위험도 high. / 이유: 기계 판정이 어느 커밋을 판정하는지를 바꾼다(보호 경로 `scripts/**`).

## 발견 사항

- `.github/workflows/gates.yml`의 단계 이름("판정할 PR 정하기 (workflow_run이면 API로 현재 head 확인)")과 머리 주석은 `workflow_run`만 조회한다고 적혀 있다. 이 변경 뒤에는 `pull_request_target`도 조회한다. 워크플로 파일은 봇이 고칠 수 없다. → 처리: 해당 없음
- `record` job은 `evaluate`가 head를 내지 못하면 이벤트의 head(`github.event.pull_request.head.sha`)에 오류 상태를 쓴다. 이벤트의 head가 지난 것이면 지난 head에 쓴다. 고치려면 워크플로 변경이 필요하다. `evaluate`가 실패한 실행은 Actions에 실패로 보인다. → 처리: 해당 없음

## 검증 결과

- 2026-11-22: `node --test scripts/test/risk-gate.test.ts scripts/test/pr-state.test.ts` 통과(41건). `node scripts/harness.ts check` 통과(test 전체 포함), `node scripts/harness.ts self-test` 통과(시나리오 10개).
- 수용 기준 "이전 head를 담은 `pull_request_target` 이벤트로 돌려도 현재 head가 나온다"는 `risk-gate.test.ts`의 "resolvePr: pull_request_target은 이벤트의 PR 번호로 API를 조회해 실행 시점의 head를 낸다"가 본다.
- 2026-11-22(판정 1회차의 수정 뒤): 같은 두 파일 통과(42건). `node scripts/harness.ts check`, `node scripts/harness.ts self-test` 통과.
- 2026-11-22(판정 2회차의 수정 뒤): 같은 두 파일 통과(42건). `node scripts/harness.ts check`, `node scripts/harness.ts self-test` 통과.
- 병합 뒤 확인(Issue의 수용 기준): 실제 PR에서 본문 수정 직후 push해 새 head에 게이트 상태가 기록되는지 보고 Issue #181에 남긴다. `gates`는 main의 스크립트로 돌므로 병합 전에는 확인할 수 없다.
