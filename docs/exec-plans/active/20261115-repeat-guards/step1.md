# Step 1: command-guard

## 읽어야 할 파일

- `scripts/hooks/shell.ts` (`parseShell`, `parseInto`, `tokenize`: 연산자 토큰)
- `scripts/hooks/rules.ts` (`evaluateBash`, `gitRules`, `ghRules`, R4 메시지 형식)
- `scripts/test/guard.test.ts`, `scripts/test/shell.test.ts`
- `docs/harness/workflow.md` 4절("`check` 결과는 종료 코드로 확인한다"), Issue #74(TD-29)
- `docs/harness/design.md` 13.1절(훅 구현 규칙), 5절(R4)

## 작업

POSIX 방언의 셸 명령 한 덩어리 안에서 아래 두 꼴을 R4(검사 우회)로 막는다.

- **검사 명령**: `node …scripts/harness.ts check` 또는 `test`(앞의 `cd … &&`, 환경 변수 할당, `2>&1` 같은 리다이렉션이 있어도 같다).
- **뒤따르는 작업**: `harness.ts complete-step`, `harness.ts pr-ready`, `git push`, `gh pr create`, `gh pr ready`.

1. **출력 가림**: 검사 명령 바로 뒤가 파이프(`|`, `|&`)면 막는다. 같은 명령 덩어리에서 그보다 앞에 `set -o pipefail`(`set -eo pipefail` 등 묶음 포함)이 있으면 허용한다.
2. **실패 뒤 진행**: 검사 명령과 그 뒤에 오는 "뒤따르는 작업" 사이의 연산자가 모두 `&&`가 아니면(`;`, 줄바꿈, `||`, `&`, `|`) 막는다. 그보다 앞에 `set -e`(묶음 포함)가 있으면 2번은 적용하지 않는다(1번은 그대로 적용).
3. `shell.ts`에 최상위 명령과 그 뒤 연산자를 함께 돌려주는 함수를 더한다. 기존 `parseShell`의 반환값과 동작은 바꾸지 않는다.
4. 메시지는 "무엇이 틀렸나 + 고치는 법 + 근거" 형식이다. 고치는 법에 좋은 예(`check > check.log 2>&1 && …`)를 적는다.
5. 테스트를 먼저 쓴다. 차단: `check 2>&1 | tail -1 && git push …`, `check; node scripts/harness.ts complete-step`, `check | tail -3`, 줄바꿈으로 이은 `check` 다음 줄의 `gh pr create`. 허용: `check && complete-step && git push …`, `check > check.log 2>&1 && git push …`, `set -o pipefail; check | tail -5`, `set -e` 뒤 줄바꿈으로 이은 `check`와 `git push`, 검사 명령이 없는 `git push`, `git log | head`.
6. `docs/harness/design.md` 13.1절의 L1 규칙 설명, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-29가 있으면 해결로 표시)를 맞춘다.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts scripts/test/shell.test.ts
```

## 금지사항

- 기존 guard·shell 테스트의 단언을 고치거나 지우지 마라. 이유: 기존 차단이 그대로임을 그 테스트가 보인다(R4).
- 기존 규칙(R1~R20)의 판정 조건을 바꾸지 마라. 이유: 이 step은 차단을 더하기만 한다.
- 검사 명령이 없는 명령까지 막지 마라(예: `git log | head`, `ls; git push …`). 이유: 오탐이 많으면 훅을 우회하려는 압력이 생긴다.
