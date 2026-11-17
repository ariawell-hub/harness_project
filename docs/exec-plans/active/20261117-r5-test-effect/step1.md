# Step 1: check-step

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-test-effect/plan.md`(목표, 의사결정 로그, 발견 사항)
- 앞 step에서 만든·바꾼 파일: `scripts/gates/test-effect.ts`, `scripts/test/test-effect.test.ts`, `scripts/lib/config.ts`(`testEffect`), `scripts/harness.ts`(`test-effect` 명령)
- `scripts/commands/check.ts`(`CHECK_STEPS`, `cacheKey`, `runCheck`)
- `scripts/selftest/scenarios/r4-bypass.ts`(시나리오의 꼴), `docs/harness/workflow.md` 4절(시나리오 규칙)
- `docs/harness/design.md` 5.1절 R5 행, 10.2절 "검증 항목", 12.4절 시나리오 표
- `.github/pull_request_template.md`, `scripts/cross-review/checklist.md`, `scripts/cross-review/prompt.md`

## 작업

`test-effect`를 `check`의 하위 검사로 넣고 설정값을 켠다. 자체 테스트 시나리오를 더하고 문서를 맞춘다.

1. `scripts/commands/check.ts`
   - `CHECK_STEPS`에 `'test-effect'`를 `'test'` 바로 뒤에 넣는다.
   - `testEffect(root, cfg, { base, committedOnly: !!opts.ci })`를 부른다. `skipped`면 "해당 없음"으로 표시한다. 문제가 없으면 통과다.
   - 출력: 파일별 판정 줄과 문제를 낸다. 통과해도 판정 줄이 있으면 낸다(예외와 복원이 CI 로그에 보여야 한다).
   - `cacheKey`에 `cfg.testEffect`를 넣는다(설정이 바뀌면 캐시가 맞지 않게).

2. 설정값: `harness.config.json`과 `profiles/core/profile.json`의 `config`에 같은 값을 넣는다.

   ```json
   "testEffect": {
     "files": ["scripts/test/*.test.ts"],
     "support": ["scripts/test/helpers.ts"],
     "command": ["node", "--test"],
     "timeoutSec": 900,
     "link": ["node_modules"]
   }
   ```

   - web 프로파일에는 넣지 않는다(계획의 비범위). `docs/exec-plans/tech-debt-tracker.md`에 새 TD로 등록한다.

3. `scripts/selftest/scenarios/r5-test-effect.ts`(새 파일, `covers: 'R5'`)
   - 샘플 리포의 worktree에서 `ctx.cli(s, ['test-effect', '--ci'], …)`로 확인한다. 대상 하네스의 내부 모듈을 import하지 않는다.
   - base에서도 통과하는 테스트 파일을 더한 커밋 → 종료 코드가 0이 아니고 stderr에 `R5`가 있다.
   - 대조군: base에서 실패하는 테스트 파일(테스트가 확인하는 코드를 같은 커밋에 더한다) → 통과.
   - 예외 줄을 계획 파일에 적어 커밋하면 통과한다. 줄은 실패 출력의 고치는 법에서 가져와 사유만 채운다.
   - 샘플 리포의 설정에 `testEffect`가 없으면(대상 하네스가 켜지 않았다) 시나리오가 실패해야 한다.

4. 테스트
   - `scripts/test/gates.test.ts`: `runCheck`가 `test-effect`를 실행한다(base에서 통과하는 테스트를 더한 리포에서 `check`가 실패하고 그 하위 검사 이름이 결과에 있다. 설정이 `null`이면 건너뛴다). `cacheKey`가 `testEffect` 설정에 따라 달라진다.
   - `scripts/test/cli.test.ts`: `check --only test-effect`가 그 하위 검사만 실행한다.
   - `scripts/test/selftest.test.ts`: 시나리오 수·id를 확인하는 단언이 있으면 맞춘다.

5. 문서
   - `docs/harness/design.md`
     - 5.1절 R5 행: 검출 항목에 `test-effect`의 구현(`check`의 하위 검사, base 코드 + head 테스트 파일, 예외 줄, 이전 판 복원)과 한계(base에서 실패한 이유는 구분하지 않는다. import만 하고 단언하지 않는 테스트는 통과한다)를 적는다. 절차 항목은 "테스트를 먼저 썼는지는 CI로 증명할 수 없다. 기록은 `test-effect` 결과다. 문장은 기록이 아니다. 검증자는 예외 사유가 타당한지와 테스트가 의미 있는 단언을 하는지 본다"로 바꾼다.
     - 10.2절 "검증 항목"의 "먼저 실패한 기록이 있는가(R5)"를 "`test-effect` 예외의 사유가 타당한가(R5)"로 바꾼다.
     - 12.4절 시나리오 표에 `r5-test-effect`를 더한다.
     - 버전을 올리고 변경 이력에 한 줄을 적는다.
   - `docs/harness/workflow.md`: 3절의 "먼저 실패한 테스트 실행 기록을 진행 로그나 PR에 남긴다"를 `test-effect`와 예외 줄 쓰는 법(형식, 어디에 적는가, 언제 쓰는가)으로 바꾼다.
   - `.github/pull_request_template.md`: `먼저 실패한 테스트 기록(R5):` 줄을 ``테스트 실효성(R5, `check`의 test-effect) 예외: 없음``으로 바꾼다(예외가 있으면 파일과 사유를 적는다).
   - `scripts/cross-review/checklist.md`, `scripts/cross-review/prompt.md`: "먼저 실패한 기록"을 "`test-effect` 예외가 있으면 사유가 타당하다"로 바꾼다. "테스트가 실제로 동작을 검증한다"는 그대로 둔다.
   - `docs/exec-plans/tech-debt-tracker.md`: TD-4를 닫는다. 새 TD(web 프로파일의 `testEffect`).
   - `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`.

6. 이 step의 PR에서 CI `check` 로그의 `test-effect` 줄을 확인해 진행 로그에 적는다(이 PR이 고친 테스트 파일의 판정).

## Acceptance Criteria

```bash
node --test scripts/test/gates.test.ts
node --test scripts/test/cli.test.ts
node --test scripts/test/selftest.test.ts
node scripts/harness.ts self-test --only r5-test-effect
node scripts/harness.ts test-effect
grep -q "'test-effect'" scripts/commands/check.ts
grep -q '"testEffect"' harness.config.json
! grep -q "먼저 실패한 테스트 기록" .github/pull_request_template.md
```

## 금지사항

- `scripts/gates/test-effect.ts`의 판정 규칙(통과만 막는다, 예외 줄 형식, 이전 판 복원)을 바꾸지 마라. 이유: step0에서 검증받은 동작이다. 결함을 찾으면 진행 로그에 적고 고친 이유를 PR에 적는다.
- 다른 하위 검사의 순서와 동작을 바꾸지 마라. 이유: 실패 기록 키와 캐시가 하위 검사 이름에 묶여 있다.
- `.github/workflows/`를 고치지 마라. 이유: `check` 워크플로는 이미 `check --ci --base`를 실행한다. 워크플로 변경은 범위 밖이다.
- "테스트가 실제로 동작을 검증한다"는 검증 항목을 빼지 마라. 이유: `test-effect`는 테스트가 base에서 실패하는지만 본다. 단언의 의미는 검증자가 본다.
- 이 PR이 고친 테스트 파일에 `test-effect` 예외 줄을 쓰지 마라. 이유: 이 step의 테스트는 새 동작을 확인하므로 base에서 실패해야 한다. 통과하면 테스트를 고친다.
