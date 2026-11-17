# Step 0: reason

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-test-effect-reason/plan.md`(목표, 의사결정 로그)
- `scripts/gates/test-effect.ts`(`runOnBase`의 판정), `scripts/test/test-effect.test.ts`
- `scripts/lib/config.ts`(`TestEffectConfig`, `resolveTestEffect`, `ci.repro.failPattern` 검증)
- `scripts/harness.ts`의 `test-effect` 명령, `scripts/commands/check.ts`의 `test-effect` 하위 검사
- `scripts/selftest/scenarios/r5-test-effect.ts`
- `docs/harness/design.md` 5.1절 R5 행, `docs/harness/workflow.md` 3절, `scripts/cross-review/prompt.md`, `scripts/cross-review/checklist.md`

## 작업

`test-effect`가 merge-base에서 실패한 이유를 나눠 표시한다. 통과·실패 판정은 바꾸지 않는다.

1. 설정 `testEffect.assertPattern`(`scripts/lib/config.ts`)
   - `string | null`. 없으면 `null`. 단언 실패일 때 테스트 출력에 보이는 정규식이다(예: `AssertionError|ERR_ASSERTION`).
   - 검증: 문자열이면 비어 있지 않고 `new RegExp`로 만들 수 있어야 한다. 아니면 `ConfigError`.

2. `scripts/gates/test-effect.ts`
   - `TestEffectItem`에 `reason: 'assertion' | 'other' | 'timeout' | null`을 더한다.
     - merge-base에서 실행해 0이 아닌 종료 코드로 끝났고 `assertPattern`이 있으면: 그 프로세스의 stdout·stderr에 정규식이 보이면 `assertion`, 아니면 `other`.
     - 시간 초과는 `timeout`. `assertPattern`이 `null`이거나 실행하지 않은 판정(`restored`, `exempt`, `invalid`, `ineffective`)은 `null`.
   - `detail`: `assertion`은 `base에서 단언 실패, 종료 코드 N`, `other`는 `base에서 실패(단언 실패 아님: 모듈 없음 등), 종료 코드 N`. `null`이면 지금의 `base에서 실패, 종료 코드 N` 그대로다.
   - `outcome`은 그대로 `effective`다. `problems`에 더하지 않는다.
   - `TestEffectResult`에 `notes: string[]`을 더한다. `other`가 하나 이상이면 한 줄을 넣는다: 그 파일 수와 "이 검사로는 그 파일의 단언을 확인하지 못했다. 테스트가 동작을 단언하는지 직접 확인하라"는 뜻의 문장. 없으면 빈 배열이다.
   - **테스트 출력을 옮기지 않는다.** 출력은 정규식을 대 보는 데만 쓰고 `detail`·`notes`·`problems`·로그에 넣지 않는다.

3. 출력
   - `scripts/harness.ts`의 `test-effect`: 판정 줄 뒤, 마지막 줄 앞에 `notes`를 `참고: …`로 stdout에 낸다. 종료 코드는 그대로다.
   - `scripts/commands/check.ts`: `test-effect` 하위 검사의 출력에 `notes`를 `참고: …`로 더한다. 통과·실패는 그대로다.

4. 설정값: `harness.config.json`과 `profiles/core/profile.json`의 `testEffect`에 `"assertPattern": "AssertionError|ERR_ASSERTION"`.

5. `scripts/selftest/scenarios/r5-test-effect.ts`
   - 대조군(새 모듈을 import하는 테스트)의 판정 줄에 `단언 실패 아님`이 있는지 확인한다.
   - 기존 모듈의 동작을 바꾸고 그 동작을 단언하는 테스트 파일을 더한 커밋을 하나 더해, 판정 줄에 `단언 실패`가 있고 `단언 실패 아님`이 없는지 확인한다. 두 경우 모두 `test-effect`는 통과한다.
   - 기존 확인(통과하는 테스트는 실패, 예외 줄, 예외 풀림)은 그대로 둔다.

6. 테스트
   - `scripts/test/test-effect.test.ts`
     - 단언 실패로 끝난 테스트 파일 → `effective`, `reason: 'assertion'`, `detail`에 `단언 실패`. 새 모듈이 없어 끝난 테스트 파일 → `effective`, `reason: 'other'`, `detail`에 `단언 실패 아님`. 두 경우 `problems`는 비어 있다.
     - `other`가 있으면 `notes`가 한 줄이고 파일 수가 들어 있다. 없으면 빈 배열이다.
     - 시간 초과 → `reason: 'timeout'`. `restored`·`exempt`·`invalid`·`ineffective` → `reason: null`.
     - `assertPattern`이 `null`이면 `reason`은 모두 `null`이고 `detail`은 지금과 같다.
     - 테스트 파일이 stdout·stderr에 낸 표식 문자열(단언 메시지에 넣은 것 포함)이 결과(`items`, `problems`, `notes`)와 CLI 출력에 없다.
     - CLI: `other`가 있으면 stdout에 `참고:` 줄이 있고 종료 코드는 0이다.
   - `scripts/test/lib.test.ts`: `assertPattern` 검증(없으면 `null`, 빈 문자열·잘못된 정규식·문자열이 아닌 값은 `ConfigError`).
   - `scripts/test/gates.test.ts`: `check`의 `test-effect` 출력에 `참고:` 줄이 나오고 통과한다.

7. 문서
   - `scripts/cross-review/prompt.md`, `scripts/cross-review/checklist.md`: 테스트 항목에 "이 PR이 새로 만든 모듈을 import하는 테스트 파일은 `test-effect`가 단언을 확인하지 못한다(merge-base에서 모듈 없음으로 실패한다). 그 파일의 단언을 직접 확인한다"를 더한다. 기존 문장("테스트가 실제로 동작을 검증하는가", 예외 사유)은 그대로 둔다.
   - `docs/harness/design.md` 5.1절 R5 행(한계 문장 뒤에 표시와 검증자 항목), 버전·변경 이력. `docs/harness/workflow.md` 3절(판정 줄 읽는 법 한 줄).
   - `docs/exec-plans/tech-debt-tracker.md`: 새 TD(CI의 `test-effect` 결과를 검증자 입력으로 넘기지 않는다. 계획의 비범위).
   - `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`.

## Acceptance Criteria

```bash
node --test scripts/test/test-effect.test.ts
node --test scripts/test/lib.test.ts
node --test scripts/test/gates.test.ts
node scripts/harness.ts self-test --only r5-test-effect
node scripts/harness.ts test-effect
grep -q '"assertPattern"' harness.config.json
grep -q "새로 만든 모듈" scripts/cross-review/prompt.md
grep -q "새로 만든 모듈" scripts/cross-review/checklist.md
grep -q "assertPattern" docs/harness/design.md
```

## 금지사항

- "그 밖의 실패"를 문제(`problems`)로 내거나 종료 코드를 바꾸지 마라. 이유: 새 모듈의 테스트가 모두 막힌다. 이 계획은 표시만 한다.
- 테스트 프로세스의 출력을 `detail`·`notes`·로그·파일에 옮기지 마라. 이유: 테스트 출력에 비밀이 섞일 수 있다. 정규식이 보이는지만 쓴다.
- 기존 판정 규칙(통과만 막는다, 예외 줄, 이전 판 복원, 링크를 따라가지 않는다)을 바꾸지 마라. 이유: Issue #116에서 검증받은 동작이다.
- `.github/workflows/`를 고치지 마라. 이유: 검증자 입력 경로를 바꾸는 일은 범위 밖이다(TD로 남긴다).
- 검증자 프롬프트의 기존 검증 항목을 빼거나 약하게 바꾸지 마라. 이유: 항목을 더하는 변경이다.
- 이 PR이 고친 테스트 파일에 `test-effect` 예외 줄을 쓰지 마라. 이유: 이 step의 테스트는 새 동작을 확인하므로 merge-base에서 실패해야 한다.
