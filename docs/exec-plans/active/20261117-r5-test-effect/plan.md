---
id: 20261117-r5-test-effect
issue: 116 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-17T21:03:30+09:00 # new-task가 채운다
---

# feat: R5 테스트 실효성 검사를 check에 넣는다(TD-4)

## 목표와 수용 기준

R5의 검출 항목 가운데 "새로 추가·수정된 테스트가 merge-base 코드에서는 실패하는가"(설계서 5.1절, TD-4)를 `check`의 하위 검사 `test-effect`로 만든다. PR의 "먼저 실패한 테스트 기록" 자유 서술 칸은 이 검사의 결과로 대체한다(제작자 결정, 2026-11-17 대화). 문장("테스트를 먼저 썼다")이 기록을 대신하지 못하게 하는 것이 목적이다(Issue #116).

수용 기준:

1. 추가·수정한 테스트 파일이 merge-base 코드에서도 통과하면(예외 기록 없음) `node scripts/harness.ts test-effect`와 `check`가 종료 코드 0이 아니고, 파일 경로와 고치는 법(그대로 붙여 넣을 예외 줄 포함)을 출력한다.
2. 추가·수정한 테스트 파일이 merge-base 코드에서 실패하면(종료 코드가 0이 아니거나 시간 초과) 통과한다.
3. 예외는 이 변경이 고친 계획 파일의 `- test-effect 예외: \`<경로>\` @ \`<blob 40자>\` — 사유: <한 줄>` 줄로만 인정한다. blob이 그 테스트 파일의 현재 내용과 다르거나 사유가 비면 인정하지 않는다.
4. 이전 판으로 되돌린 테스트 파일(내용이 그 경로의 이전 커밋 판과 같다)은 실행하지 않고 통과한다(revert PR이 막히지 않는다).
5. 검사는 테스트 출력을 stdout·stderr·파일 어디에도 옮기지 않는다(파일 경로, 판정, 종료 코드만 낸다). 실행 뒤 임시 worktree가 남지 않고 head 작업 트리와 index가 바뀌지 않는다.
6. 설정 `testEffect`가 없거나 `null`이면, 또는 비교 대상(base)이 없으면 "해당 없음"으로 건너뛴다.
7. 하네스 자체 테스트(12.4절)에 시나리오 `r5-test-effect`가 있고 `self-test`가 통과한다.
8. 설계서 R5·검증 항목, 절차서, PR 템플릿, 자체 리뷰 체크리스트, 검증자 프롬프트가 "기록 = test-effect 결과, 검증자는 예외 사유를 본다"로 맞춰지고 TD-4가 닫힌다.

## 범위 / 비범위

범위:

- 게이트 `scripts/gates/test-effect.ts`와 설정 `testEffect`(검증 포함), 단독 명령 `test-effect [--ci] [--base <sha>]`.
- `check`에 하위 검사로 넣기(로컬·CI 공통), 이 리포와 core 프로파일의 설정값.
- 자체 테스트 시나리오, 문서.

비범위:

- 로컬 기록 명령(`fail-first`)의 재도입. 이유: 제작자 결정(Issue #116).
- "테스트를 먼저 썼는가"의 증명. 이 검사는 테스트가 변경을 잡아내는지만 본다.
- base에서 실패한 이유의 구분(단언 실패인지 모듈 없음인지). 새 모듈의 테스트는 base에서 모듈 없음으로 실패하므로 구분하면 모두 막힌다. 테스트가 의미 있는 단언을 하는지는 검증자가 본다.
- R5의 다른 검출 항목(동작 코드 변경 시 테스트 변경 동반, 커버리지 하한).
- web 프로파일의 `testEffect` 설정값. 이유: 그 프로파일의 테스트 러너로 파일 하나를 실행하는 명령을 이 리포에서 확인할 수 없다. TD로 남긴다.
- `.github/workflows/`. `check` 워크플로는 이미 `check --ci --base <merge-base>`를 실행한다.

## 관련 파일·문서

- `scripts/gates/test-effect.ts`(새 파일)
- `scripts/test/test-effect.test.ts`(새 파일)
- `scripts/lib/config.ts`, `scripts/test/lib.test.ts`
- `scripts/harness.ts`
- `scripts/commands/check.ts`, `scripts/test/gates.test.ts`, `scripts/test/cli.test.ts`
- `harness.config.json`, `profiles/core/profile.json`
- `scripts/selftest/scenarios/r5-test-effect.ts`(새 파일), `scripts/selftest/run.ts`, `scripts/test/selftest.test.ts`
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `.github/pull_request_template.md`, `scripts/cross-review/checklist.md`, `scripts/cross-review/prompt.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261117-r5-test-effect/`

## step 목록

- step0 gate: 게이트 함수, 설정 검증, 단독 명령 `test-effect`, 단위 테스트. `check`에는 아직 넣지 않는다.
- step1 check-step: `check`의 하위 검사로 넣고 설정값을 켠다. 자체 테스트 시나리오와 문서(R5 기록 칸을 CI 결과로 대체).

## 진행 로그

- 2026-11-17: 제작자 대화 지시로 Issue #116을 등록하고(#111은 대체로 닫았다) 계획을 작성했다. 계획만 담은 커밋으로 초안 PR을 열어 계획 검증(G1)을 받는다.
- 2026-11-17 step0: 계획 검증(PR #117)을 기다리는 동안 로컬에서 구현했다(승인 전에는 올리지 않는다). 테스트를 먼저 쓰고 빈 구현(`testEffect`가 빈 결과를 돌려주는 stub)으로 `node --test scripts/test/test-effect.test.ts`를 실행했다: 15개 가운데 14개 실패, 1개 통과(종료 코드 1). 통과한 1개는 "삭제된 테스트 파일과 대상이 아닌 파일은 보지 않는다"로, 빈 결과를 기대하는 테스트라 stub에서도 통과한다. 설정 검증 테스트(`lib.test.ts`의 `testEffect`)는 고치기 전 `config.ts`에서 실패했다(1개 실패). 구현 뒤에 더한 테스트 2개("명령을 실행할 수 없으면 invalid", "`-`로 시작하는 경로는 invalid")도 각각 구현 전에 실패하는 것을 실행해 확인했다.
- 2026-11-17 step0: 구현. `scripts/gates/test-effect.ts`(`testEffect`·`exemptLine`·`parseExemptions`), `scripts/lib/config.ts`의 `testEffect` 검증(`TestEffectConfig`), `scripts/harness.ts`의 `test-effect [--ci] [--base]`. `test-effect.test.ts` 17개와 `lib.test.ts`의 설정 검증 테스트가 통과한다. 실행 뒤 임시 worktree가 남지 않는 것을 테스트와 이 worktree의 `git worktree list`로 확인했다.
- 2026-11-17: 계획 검증 1라운드(PR #117, head `278b5c7`). `review/claude` 승인(P2 1건, 원장 F1: step1의 문서 AC가 PR 템플릿 한 곳만 본다), `review/codex` 수정 요청(P0 1건, 원장 F2: base 체크아웃에 `support` 파일을 덮어쓸 때 base 트리의 심볼릭 링크를 따라가 밖에 쓸 수 있다). 둘 다 받아들였다. step0에 "덮어쓰기와 연결은 심볼릭 링크를 따라가지 않는다"(원본은 일반 파일만, 목적지의 상위 경로는 실제 폴더만, 목적지가 링크면 지우고 쓴다, 걸리면 `invalid`)와 그 테스트 4가지를 더했다. 같은 이유로 대상에 "파일 종류가 바뀐 파일"을 넣었다(링크에서 일반 파일로 바뀐 테스트 파일이 대상에서 빠지지 않게). 구현하면서 더한 판정 두 가지(`-`로 시작하는 경로, 실행할 수 없는 명령)도 step0에 적었다. step1의 AC에 문서별 확인을 더했다. 계획만 담은 커밋으로 다시 검증받는다.
- 2026-11-17 step0: 로컬 `check`가 `test`에서 실패했다(540개 가운데 1개). `selftest.test.ts`의 약화 도우미가 `scripts/harness.ts`에서 `return r.problems.length ? 1 : 0;`이 한 번만 나온다고 기대하는데, `test-effect` 명령이 같은 문장을 써서 두 번이 됐다. 명령 쪽 문장을 바꿨다(자체 테스트 파일은 고치지 않았다).
- 2026-11-17 step0: 지적 F2의 테스트 3개("링크를 따라가지 않는다")를 먼저 쓰고 고치기 전 구현에서 실행했다: 3개 모두 실패(종료 코드 1). 2개에서는 리포 밖 폴더에 `new.test.mjs`·`helper.mjs`가 실제로 써졌다(지적이 맞다). 1개는 링크에서 일반 파일로 바뀐 `support` 파일이 대상에서 빠져 `effective`로 나왔다. 그 뒤 `prepareDest`(상위 경로 `lstat`, 목적지 링크 제거)와 `--diff-filter=AMT`를 넣었다. `test-effect.test.ts` 20개 통과. 계획이 다시 승인되기 전에는 구현을 올리지 않는다.
- 2026-11-17: 계획 검증 2라운드(head `97f46a7`)에서 두 검증자가 승인했다(G1 해시 `e80fbb145073`. F2는 fixed, F1은 P2라 미룸으로 남았지만 AC에 반영했다). step0 구현을 올린다.
- 2026-11-17 step0: AC 명령 5개가 종료 코드 0이다(`test-effect.test.ts` 20개, `lib.test.ts` 15개 통과). 이 리포에서 `node scripts/harness.ts test-effect`는 "해당 없음(설정 testEffect 없음)"이다(설정값은 step1). step1에 넣을 설정값으로 게이트를 이 변경에 직접 돌려 봤다: `scripts/test/lib.test.ts`와 `scripts/test/test-effect.test.ts`가 모두 `effective`(base에서 실패, 종료 코드 1), 1.2초, 실행 뒤 임시 worktree 없음, `node_modules` 그대로.
- 2026-11-17 step0: 구현을 올린 직후(head `2ae0524`) PR #110(#102 step5)이 병합돼(main `84acf52`) `CHANGELOG`가 충돌했다. `origin/main`을 병합해 풀었다: main의 v0.7.51 줄을 앞에, 이 PR의 줄을 뒤에 뒀다. `scripts/harness.ts`와 코드 구조 문서는 자동 병합됐다. 병합한 트리에서 전체 `check`를 다시 돌린다.
- 2026-11-17 step0: PR #117이 병합됐다(main `7ddf901`. 두 검증자 승인, 위험도 보통).
- 2026-11-17 step1: 테스트를 먼저 쓰고 구현 전에 실행했다: `gates.test.ts` 4개, `cli.test.ts` 1개, `selftest.test.ts` 1개가 모두 실패(6개 가운데 6개, 종료 코드 1). 그 뒤 구현: `check`의 하위 검사 `test-effect`(`test` 바로 뒤, 판정 줄은 통과해도 출력, 캐시 키에 설정), `harness.config.json`·core 프로파일의 `testEffect` 값, 시나리오 `r5-test-effect`. 6개 통과.
- 2026-11-17 step1: 문서. 설계서 v0.7.52(5.1절 R5 행, 10.2절 검증 항목, 12.4절 시나리오 표, 변경 이력), 절차서 3절, PR 템플릿, 자체 리뷰 체크리스트, 검증자 프롬프트, 코드 구조 문서, `CHANGELOG`, TD-4 해결, TD-42 등록(web 프로파일).
- 2026-11-17 step1: 이 worktree에서 `node scripts/harness.ts test-effect`: 이 step이 고친 테스트 파일 3개(`cli.test.ts`, `gates.test.ts`, `selftest.test.ts`)가 모두 `effective`(base에서 실패, 종료 코드 1)이고 통과다. `self-test --only r5-test-effect` 통과.
- 2026-11-17 step1: 로컬 `check`가 `test`에서 실패했다(553개 가운데 1개). "이 리포의 하네스는 모든 시나리오를 통과한다" 테스트가 시나리오의 항목 목록을 적어 두는데 `R5`를 더하지 않았다(시나리오 자체는 통과했다). 목록에 `R5`를 더했다. 같은 실행에서 `check`의 `test-effect`는 통과했다(98.6초. `selftest.test.ts`를 변경 전 코드에서 한 번 더 돌리는 시간이다).

## 의사결정 로그

- 결정: base 코드는 임시 `git worktree`(detached)로 만들고 그 위에 head의 테스트 파일을 덮어쓴다. / 이유: 이 리포의 테스트는 git 리포 안에서 도는 것을 전제한다. head 작업 트리를 건드리지 않는다. / 버린 대안: head 작업 트리에서 코드 파일을 base 판으로 되돌렸다 복구(작업 트리를 바꾼다, R14에 가깝다), `git archive`(git 리포가 아니라서 무관한 이유로 실패해 "실효 있음"으로 잘못 센다).
- 결정: base에서 "통과(종료 코드 0)"만 막는다. 0이 아닌 종료와 시간 초과는 실패로 본다. / 이유: 새 모듈의 테스트는 base에서 단언 실패가 아니라 모듈 없음으로 끝난다. / 버린 대안: 재현 job처럼 단언 실패 패턴을 요구(새 모듈의 테스트가 모두 막힌다).
- 결정: 테스트 실행 명령은 설정(`testEffect.command`, 인자 배열)에서만 읽고 셸을 쓰지 않는다. 명령줄 인자로 명령이나 파일을 받지 않는다. / 이유: 되돌린 `fail-first`는 인자를 셸로 실행해 L1 훅을 지나갔다(계획 `20261117-revert-fail-first` 발견 사항). 설정 파일은 보호 경로라 바꾸면 `harness-guard`가 본다. / 버린 대안: 표준 명령 `test`의 셸 문자열 재사용(파일 하나만 실행할 수 없다).
- 결정: 테스트 출력은 어디에도 옮기지 않는다. / 이유: 테스트 출력에 비밀이 섞일 수 있다(같은 발견 사항 3번). 판정에는 종료 코드면 충분하다.
- 결정: 예외는 계획 파일의 한 줄(경로 + blob + 사유)이고, 이 변경이 고친 계획 파일에 있어야 한다. / 이유: 설계서 5.1절은 예외를 "PR에 사유 기록"으로 허용한다. `check`는 PR 본문을 읽지 못하므로 리포 안에 둔다. blob에 묶으면 테스트 파일을 다시 고쳤을 때 예외가 풀리고, 같은 계획의 다음 step에 이어지지 않는다. 소규모 계획(단일 파일)에도 쓸 수 있다. / 버린 대안: 커밋 trailer(squash 병합 뒤 main의 `check`에서 사라져 revert를 부른다), 테스트 파일 안의 주석(그 파일이 영구히 면제된다), `index.json` 항목(소규모 계획에는 없다).
- 결정: 이전 판으로 되돌린 테스트 파일은 건너뛴다. / 이유: revert PR은 테스트를 이전 판으로 되돌리고, 그 판은 base 코드에서 통과할 수 있다(대상 커밋이 테스트 케이스만 더한 경우). 막으면 자동 되돌리기가 멈춘다. 브랜치 이름으로 구분하면 `revert/…` 이름만으로 검사를 피할 수 있어 내용으로 판단한다.
- 결정: 보조 파일(`testEffect.support`, 예: `scripts/test/helpers.ts`)은 head 판을 함께 덮어쓴다. / 이유: 덮어쓰지 않으면 새 헬퍼를 쓰는 테스트가 base에서 "헬퍼 없음"으로 실패해 무엇을 단언하든 통과한다.
- 결정: 위험도는 normal이다. / 이유: 검사를 더하는 변경이고 보안·인증·마이그레이션·데이터 스크립트가 아니다. `check`는 이미 PR의 테스트 코드를 비밀 없는 job에서 실행한다. 보호 경로 변경이라 `harness-guard`는 돈다.
- 결정: R5의 절차 항목(PR의 "먼저 실패한 테스트 기록")은 `test-effect` 결과로 대체한다. / 이유: 제작자 결정(2026-11-17 대화, 선택지 2개 가운데 "CI 결과로 대체"). 하네스 규칙 문구 변경이라 물었다. / 버린 대안: 서술 칸을 남기고 문장을 인정하지 않는다고만 적는다(에이전트가 적는 글에 여전히 기댄다).
- 결정: `base`가 head의 조상이 아니면 둘의 merge-base를 변경 전 코드로 쓴다. / 이유: 뒤처진 브랜치에서 `--base origin/main`처럼 넘겨도 이 변경만 비교하게 한다. / 버린 대안: 넘겨받은 `base`를 그대로 쓴다(main에만 있는 변경이 이 변경의 것으로 잡힌다).
- 결정: 설정한 명령을 실행하지 못한 경우(실행 파일 없음)와 `-`로 시작하는 테스트 파일 경로는 `invalid`로 막는다(step 파일에 없는 판정 사유다). / 이유: `lib/exec.ts`의 `run`은 실행 실패를 종료 코드 127로 돌려준다. 이것을 "base에서 실패"로 세면 잘못 적은 `command`가 모든 테스트를 통과시킨다. `-`로 시작하는 경로는 테스트 명령의 옵션으로 읽힌다. / 버린 대안: 경로 앞에 `./`를 붙인다(명령마다 경로 해석이 다를 수 있다).

## 발견 사항

- web 프로파일에는 `testEffect` 설정값이 없다(파일 하나를 실행하는 명령을 확인하지 못했다). step1에서 TD로 등록한다. → 처리: TD-42
- 한계: 새 모듈을 import만 하고 아무것도 단언하지 않는 테스트는 base에서 "모듈 없음"으로 실패해 이 검사를 통과한다. step1에서 설계서 5.1절에 적는다. → 처리: [설계서 5.1절 R5](../../../harness/design.md)
- `AGENTS.md`의 표준 명령 표는 `check`를 "fmt·lint·test·build + doc-lint + 우회 탐지 + 시크릿 스캔"으로 적는다. `test-effect`가 빠져 있지만 이 계획의 "관련 파일"에 없어 고치지 않았다. 설계서 6절 표에는 "테스트 실효성(R5)"이 이미 있다. → 처리: 해당 없음
- 자체 테스트의 시나리오 샘플 리포에는 `node_modules`가 없어 `testEffect.link`가 건너뛰어진다(연결은 단위 테스트가 확인한다). → 처리: 해당 없음

## 열린 질문

<!-- 선택지 + 추천안 (9.1절) -->

## 검증 방법과 결과

- step별 AC 명령, `node scripts/harness.ts check`, `node scripts/harness.ts self-test`.
- step1을 올린 PR의 CI `check` 로그에서 `test-effect` 줄을 확인한다(그 PR이 고친 테스트 파일이 base에서 실패했다고 나와야 한다).

## 다음 할 일

- 계획 검증(G1) 승인 뒤 step0을 TDD로 구현한다.
