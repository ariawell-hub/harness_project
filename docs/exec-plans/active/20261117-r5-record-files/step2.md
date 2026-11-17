# Step 2: complete-check

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-record-files/plan.md` (수용 기준 6~9, 의사결정 로그, 발견 사항)
- step1이 만든 파일: `scripts/commands/fail-first.ts`(`isTestFile`, `readFailFirst`, `FailFirstRecord`의 `files`), `scripts/test/fail-first.test.ts`
- `scripts/commands/task.ts`(`completeStep`, `appendProgress`, `reopenStep`), `scripts/lib/git.ts`(`changedFiles`, `defaultBase`)
- `scripts/runner/run.ts`(`publishStep`이 `completeStep`의 예외를 `plan:complete` 실패로 세는 곳), `scripts/runner/prompt.ts`(step 세션 프롬프트의 공통 규칙)
- `scripts/selftest/run.ts`(`ScenarioContext`), `scripts/selftest/scenarios/r1-plan-gate.ts`(계획을 만들어 완료 처리하는 시나리오), `scripts/test/selftest.test.ts`(시나리오 id 목록, 약화된 사본 테스트)
- `docs/harness/design.md` 5.1절 R5 행, 12.4절, 13.1절, `docs/harness/workflow.md` 3·4절, `docs/exec-plans/tech-debt-tracker.md`(TD-4)

## 작업

1. `scripts/commands/task.ts`의 `completeStep`
   - 발견 사항 검사 뒤, 계획을 바꾸기 전에 확인한다: 그 step의 변경(`defaultBase`로 정한 merge-base 대비 `changedFiles`. 커밋하지 않은 변경과 추적하지 않는 파일 포함) 가운데 `isTestFile`인 파일이 하나라도 있으면 `readFailFirst`로 그 계획·step의 기록을 찾는다. `kind: 'fail'` 기록은 `files` 가운데 이 step이 바꾼 테스트 파일이 하나 이상 있을 때만 인정한다(바뀐 테스트와 무관한 파일의 실패는 기록이 아니다).
   - merge-base 대비 변경이 곧 그 step의 변경이다: step마다 브랜치가 따로이고(`new-task --plan <id> --step <N>`이 `origin/main`에서 그 step의 브랜치를 만든다) 앞 step은 병합돼 main에 있다. 앞 step이 바꾼 테스트 파일은 뒤 step의 검사에 들어오지 않아야 한다(아래 테스트로 확인한다).
   - 기록이 없으면 `TaskError`다. 문구에 바뀐 테스트 파일(5개까지)과 고치는 법 두 가지를 적는다: 구현 전이면 `node scripts/harness.ts fail-first <테스트 파일>`, 이미 구현했거나 R5의 예외(문서·설정·순수 리팩터)면 `node scripts/harness.ts fail-first --exempt "<사유>"`. 계획 파일과 `index.json`은 바꾸지 않는다.
   - 기록이 있으면 진행 로그에 한 줄을 더한다(`appendProgress`). `kind: 'fail'` 기록이 있으면 가장 최근 것으로 `step<N> 먼저 실패한 기록(R5): \`<파일들>\` → 종료 코드 <N>, <단언 실패 줄> (기록 <시각>, HEAD <7자>)`, 예외만 있으면 `step<N> R5 예외: <사유> (기록 <시각>)`. 같은 줄이 이미 있으면 다시 더하지 않는다(재작업 뒤 두 번째 완료 처리).
   - merge-base를 정하지 못하면(원격·로컬 기본 브랜치가 없다) 검사를 건너뛰지 않고 `TaskError`로 멈춘다.
   - 테스트 파일이 바뀌지 않은 step은 지금과 같이 완료된다.

2. `scripts/runner/prompt.ts`: step 세션 프롬프트의 공통 규칙에 한 줄. "테스트를 새로 쓰거나 고치면 구현 전에 `node scripts/harness.ts fail-first <테스트 파일>`로 단언 실패를 기록하라. 기록이 없으면 runner가 완료 처리하지 못한다. 문서·설정·순수 리팩터라 실패할 테스트가 없으면 `fail-first --exempt "<사유>"`를 남겨라." 계획 작성·지적 대응·충돌 해결 프롬프트는 바꾸지 않는다.

3. 자체 테스트 시나리오 `scripts/selftest/scenarios/r5-fail-first.ts`(`covers: 'R5'`, `ctx.cli`만 쓴다)
   - 샘플 리포에서 `new-task`로 계획 worktree를 만들고, 테스트 파일(`node:test` + `node:assert`로 함수의 반환값을 단언)과 틀린 값을 돌려주는 구현을 커밋한다.
   - `complete-step`이 실패하고 출력에 `fail-first`가 있다. 계획 파일은 그대로다.
   - 대조군: 통과하는 테스트 파일에 `fail-first`는 종료 코드 1이고, 그 뒤에도 `complete-step`은 실패한다.
   - 셸 명령 문자열(`"node --test <그 파일>; touch pwned"`)을 인자로 주면 `fail-first`는 종료 코드 2이고 worktree에 `pwned`가 생기지 않는다.
   - `fail-first <그 테스트 파일>`이 0으로 끝난 뒤 구현을 고쳐 커밋하면 `complete-step`이 0으로 끝나고 계획 파일의 진행 로그에 `먼저 실패한 기록(R5)` 줄이 있다.
   - 대조군: 테스트 파일을 바꾸지 않은 계획은 기록 없이 완료된다.

4. 테스트
   - `scripts/test/task.test.ts`(또는 `fail-first.test.ts`): 테스트 파일을 바꾼 step에서 기록 없이 `completeStep`은 `TaskError`이고 `index.json`의 상태가 그대로다. `fail` 기록 뒤에는 완료되고 진행 로그에 줄이 있다. 이 step이 바꾸지 않은 테스트 파일만 실행한 `fail` 기록은 인정되지 않는다. `exempt`만 있으면 `R5 예외` 줄이다. 재작업(`reopenStep`) 뒤 다시 완료해도 줄이 두 번 생기지 않는다. 테스트 파일을 바꾸지 않은 step은 기록 없이 완료된다.
   - step 2개짜리 계획: step0이 테스트 파일을 바꿔 기록을 남기고 완료된 뒤 그 브랜치가 main에 병합된다. `new-task --plan <id> --step 1`로 만든 step1 worktree에서 테스트 파일을 바꾸지 않고 코드만 바꾸면 기록 없이 완료된다(앞 step의 테스트 파일이 검사에 섞이지 않는다). 같은 step1에서 테스트 파일을 바꾸면 step0의 기록으로는 통과하지 못한다.
   - runner: 가짜 에이전트가 만든 step(테스트 파일 없음)이 기존대로 병합되는지는 기존 runner 테스트가 본다. 새로 볼 것은 프롬프트다: step 세션 프롬프트에 `fail-first`가 있고 계획 작성 프롬프트에는 없다.
   - `scripts/test/selftest.test.ts`: 시나리오 id 목록과 항목 목록에 `r5-fail-first`·`R5`를 더하고, `completeStep`의 기록 검사를 뺀 사본에서 이 시나리오가 실패하는 테스트를 더한다.

5. 문서
   - 설계서 5.1절 R5 행의 "절차" 칸: 기록은 `fail-first` 명령이 남기고 `complete-step`이 확인한다. 순서 자체는 여전히 증명하지 못한다는 것과 예외 기록을 적는다. 12.4절 시나리오 표에 `r5-fail-first` 한 줄. 버전·변경 이력.
   - 절차서 3절: 순서를 "테스트 작성 → `fail-first <테스트 파일>`로 단언 실패 기록 → 구현 → 통과 확인"으로 적고, 인정되는 기록은 명령이 남긴 것뿐이며 문장("테스트를 먼저 썼다")과 구현 뒤의 변이 확인은 기록이 아니라 예외 사유로 적는다는 것을 적는다. `fail-first`는 명령이 아니라 테스트 파일만 받는다는 것, 기록은 이 step이 바꾼 테스트 파일을 실행한 것만 인정된다는 것, 진행 로그 줄에 실행한 파일이 남는다는 것도 적는다. 4절: `complete-step`이 멈췄을 때 고치는 법.
   - `.github/pull_request_template.md`의 `먼저 실패한 테스트 기록(R5):` 줄을 "진행 로그의 `먼저 실패한 기록(R5)` 줄 또는 `R5 예외` 줄을 옮긴다"로 고친다.
   - `AGENTS.md` 작업 루프 3번에 `fail-first`를 넣는다(120줄 제한 안에서).
   - 설계서 13.1절에 한 줄: 하네스 명령은 인자로 받은 문자열을 셸로 실행하지 않는다(훅은 하네스 명령의 인자 안에 든 명령을 판정하지 않는다. `fail-first`의 첫 구현이 이 때문에 되돌려졌다).
   - 코드 구조 문서, `CHANGELOG`, TD-4(이 계획이 한 것과 남은 것: CI 실효성 검사), 새 TD(`ci.repro`가 없는 프로파일에서는 `fail-first`가 예외 기록만 쓸 수 있다).

## Acceptance Criteria

```bash
node --test scripts/test/fail-first.test.ts scripts/test/task.test.ts
node --test scripts/test/selftest.test.ts
node scripts/harness.ts self-test --only r5-fail-first
grep -q "fail-first" docs/harness/workflow.md
grep -q "fail-first" AGENTS.md
node scripts/harness.ts doc-lint
```

## 금지사항

- 기록이 없을 때 경고만 하고 완료시키지 마라. 이유: 경고는 이번에 뚫린 문장 기반 절차와 같다. 멈추고 고치는 법을 낸다.
- 예외 사유를 정해진 목록으로 제한하거나 자동으로 판정하지 마라. 이유: 사유가 맞는지는 검증자가 본다(5.1절). 명령은 사유가 있는지만 본다.
- 테스트 파일이 바뀌지 않은 step의 완료 처리를 바꾸지 마라. 이유: 기존 자체 테스트 시나리오(main의 것)가 PR의 하네스에 대해 돈다. 동작이 바뀌면 `selftest` job이 실패한다.
- `scripts/cross-review/`(검증자 프롬프트·체크리스트)를 고치지 마라. 이유: 계획의 비범위다.
- 기존 자체 테스트 시나리오 파일과 실행기(`scripts/selftest/run.ts`)를 고치지 마라. 이유: 새 시나리오 파일을 더하는 것으로 충분하고, 기존 파일 수정은 위험도 높음 신호다.
