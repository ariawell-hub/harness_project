---
id: 20261117-test-effect-reason
issue: 118 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-17T22:31:02+09:00 # new-task가 채운다
---

# feat: test-effect가 변경 전 코드에서 실패한 이유(단언 실패 / 그 밖)를 표시한다

## 목표와 수용 기준

테스트 실효성 검사(`test-effect`, Issue #116)는 추가·수정한 테스트 파일이 merge-base 코드에서 "통과하지 않으면" 실효가 있다고 본다. 새 모듈의 테스트는 merge-base에 그 모듈이 없어 import 단계에서 실패하므로 단언이 무엇이든 통과한다(설계서 5.1절 R5의 한계). 이 계획은 merge-base에서 실패한 이유를 "단언 실패"와 "그 밖의 실패"로 나눠 **표시**하고, 검증자가 "그 밖의 실패"에 해당하는 테스트 파일의 단언을 직접 보게 한다. 막지는 않는다(제작자 결정, 2026-11-17 대화, Issue #118).

수용 기준:

1. merge-base에서 단언 실패로 끝난 테스트 파일과 그 밖의 이유(모듈 없음, 문법 오류 등)로 끝난 테스트 파일의 판정 줄(`detail`)이 서로 다르다. 결과 항목에 구분 값(`reason`)이 있다.
2. 두 경우 모두 `effective`이고 `test-effect`와 `check`는 통과한다.
3. "그 밖의 실패"가 하나라도 있으면 `test-effect` 명령과 `check`의 출력에 안내 한 줄이 나온다(이 검사로는 그 파일의 단언을 확인하지 못했다).
4. 구분에는 테스트 출력에 설정한 정규식(`testEffect.assertPattern`)이 보이는지만 쓴다. 결과·문제·로그에 테스트 출력이 들어가지 않는다.
5. `assertPattern`이 없으면(`null`) 구분하지 않고 지금과 같은 판정 줄을 낸다.
6. 검증자 프롬프트와 자체 리뷰 체크리스트에 "이 PR이 새로 만든 모듈을 import하는 테스트 파일은 `test-effect`가 단언을 확인하지 못한다. 그 파일의 단언을 직접 확인한다"는 항목이 있다.
7. 설계서 5.1절 R5와 절차서 3절이 이 표시를 설명한다.

## 범위 / 비범위

범위:

- `scripts/gates/test-effect.ts`의 판정 사유 구분, 설정 `testEffect.assertPattern`, 명령·`check` 출력의 안내 줄.
- 이 리포와 core 프로파일의 설정값.
- 자체 테스트 시나리오 `r5-test-effect`에 판정 줄 확인을 더한다.
- 검증자 프롬프트, 자체 리뷰 체크리스트, 설계서, 절차서.

비범위:

- "그 밖의 실패"를 막는 것. 이유: 새 모듈의 테스트가 모두 막힌다(Issue #118).
- 테스트 케이스 단위 판정.
- CI의 `test-effect` 결과를 검증자 입력으로 넘기는 것. 이유: 판정 job은 PR 코드를 실행하지 않고(설계서 10.4절), `check`의 결과는 PR 쪽 코드가 낸 값이라 그대로 믿을 수 없다. 검증자는 diff에서 "새로 만든 모듈을 import하는 테스트 파일"을 스스로 가려낸다(수용 기준 6). 재현 job처럼 비밀 없는 job에서 다시 실행해 넘기는 방식은 워크플로를 바꿔야 해서 TD로 남긴다.
- `.github/workflows/`.

## 관련 파일·문서

- `scripts/gates/test-effect.ts`, `scripts/test/test-effect.test.ts`
- `scripts/lib/config.ts`, `scripts/test/lib.test.ts`
- `scripts/harness.ts`, `scripts/commands/check.ts`, `scripts/test/gates.test.ts`
- `harness.config.json`, `profiles/core/profile.json`
- `scripts/selftest/scenarios/r5-test-effect.ts`
- `scripts/cross-review/prompt.md`, `scripts/cross-review/checklist.md`
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261117-test-effect-reason/`

## step 목록

- step0 reason: 판정 사유 구분과 표시, 설정값, 시나리오, 검증자 항목, 문서.

## 진행 로그

- 2026-11-17: 제작자 대화 지시로 Issue #118을 등록하고 계획을 작성했다. 이 계획은 Issue #116의 step1(`check`에 `test-effect` 연결, PR 진행 중)이 main에 들어간 뒤의 코드를 고친다. 계획만 담은 커밋으로 초안 PR을 열어 계획 검증(G1)을 먼저 받고, #116 step1이 병합되면 main을 병합한 뒤 구현한다.

## 의사결정 로그

- 결정: 구분은 테스트 프로세스의 출력에 정규식이 보이는지로 한다(재현 job의 `ci.repro.failPattern`과 같은 방식). / 이유: 테스트 러너마다 종료 코드로는 단언 실패와 모듈 없음을 가릴 수 없다. 출력은 메모리에서 정규식만 대 보고 버린다. / 버린 대안: 러너별 결과 형식(TAP, JSON)을 해석한다(러너에 묶인다).
- 결정: 결과 항목에 `reason`(`assertion` | `other` | `timeout` | `null`)을 더하고 `outcome`은 그대로 `effective`로 둔다. / 이유: 막지 않는 표시다. 판정 종류를 늘리면 `effective`를 보는 기존 테스트·시나리오가 모두 바뀐다. / 버린 대안: 새 `outcome`(`unverified`).
- 결정: 검증자에게는 CI 결과를 넘기지 않고 프롬프트 항목으로 알린다. / 이유: 범위/비범위에 적었다. 검증자는 diff와 변경 파일 목록으로 "새로 만든 모듈을 import하는 테스트 파일"을 가려낼 수 있다. / 버린 대안: PR 본문에 작성자가 "그 밖의 실패" 파일을 적는다(작성자의 글에 기댄다. Issue #116에서 없앤 방식이다).
- 결정: 위험도는 normal이다. / 이유: 표시를 더하는 변경이고 판정(통과·실패)은 바뀌지 않는다.

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

## 열린 질문

<!-- 선택지 + 추천안 (9.1절) -->

## 검증 방법과 결과

- step의 AC 명령, `node scripts/harness.ts check`, `node scripts/harness.ts self-test --only r5-test-effect`.
- 이 계획의 PR에서 CI `check` 로그의 `test-effect` 판정 줄을 확인한다.

## 다음 할 일

- 계획 검증(G1) 승인과 Issue #116 step1의 병합을 기다린다. 둘 다 끝나면 `origin/main`을 병합하고 step0을 TDD로 구현한다.
