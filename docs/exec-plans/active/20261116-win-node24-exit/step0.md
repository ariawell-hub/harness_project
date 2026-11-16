# Step 0: exit-code

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-win-node24-exit/plan.md`
- `scripts/harness.ts`(파일 끝의 `main(...).then(...)`)
- `scripts/test/record.test.ts`(CLI를 자식 프로세스로 띄우는 `run`), `scripts/test/repro.test.ts`(링크 테스트), `scripts/test/cli.test.ts`
- `scripts/ci/repro.ts`(`runRepro`의 링크 판정)
- `docs/decisions/ADR-0005-windows-native.md`, `docs/exec-plans/tech-debt-tracker.md`의 TD-14

## 작업

1. `scripts/harness.ts`의 끝: `main`이 돌려준 종료 코드를 `process.exitCode`에 넣고 `process.exit`를 바로 부르지 않는다. 같은 자리에서 강제 종료 타이머를 건다(10초 뒤 `process.exit(code)`, `unref()`로 프로세스를 붙잡지 않게 한다). 오류 갈래(`TaskError`는 3, 그 밖은 1)도 같은 방식이다. 종료 코드와 출력 내용은 바꾸지 않는다.
2. `scripts/test/repro.test.ts`의 "테스트 폴더가 리포 밖을 가리키는 심볼릭 링크면 쓰지 않는다": 링크를 `symlinkSync(outside, <경로>, 'junction')`으로 만든다. 단언은 그대로 둔다.
3. 테스트(`scripts/test/cli.test.ts`에 더한다)
   - `harness.ts`가 성공·사용법 오류·모르는 명령에서 지금과 같은 종료 코드(0, 2, 2)로 끝난다.
   - 오류 갈래 둘을 자식 프로세스로 확인한다. `TaskError`를 내는 명령(예: 계획 브랜치가 아닌 임시 리포에서 `complete-step`)은 종료 코드 3이고 stderr에 그 메시지가 있다. 그 밖의 예외로 끝나는 명령(예: `harness.config.json`이 없는 임시 리포의 `plan-gate`)은 종료 코드 1이고 stderr가 `오류:`로 시작한다.
   - `harness.ts` 본문에 `main(` 뒤의 처리에서 `process.exit(`가 `setTimeout` 밖에서 불리지 않는다(소스에서 종료 처리 블록을 읽어 확인한다).
4. 확인: 이 PC(Windows)에서 `node --test scripts/test/record.test.ts`를 3회 실행해 결과를 진행 로그에 적는다. 고치기 전 실패 기록(계획 진행 로그의 3회 실패)이 "먼저 실패한 테스트"다.
5. 문서: `docs/harness/CHANGELOG.md` 한 줄, 설계서 버전·변경 이력 한 줄, `tech-debt-tracker.md`의 TD-14 비고에 "Windows + Node 24에서 `check` 통과 확인(#99)"을 더한다.

## Acceptance Criteria

```bash
node --test scripts/test/record.test.ts scripts/test/repro.test.ts scripts/test/cli.test.ts
grep -q "process.exitCode" scripts/harness.ts
grep -q "'junction'" scripts/test/repro.test.ts
```

## 금지사항

- 테스트를 건너뛰거나(`.skip`, OS 조건으로 return) Windows에서만 종료 코드 단언을 풀지 마라. 이유: R4. 실제 명령이 죽는 원인을 고친다.
- `scripts/hooks/guard.ts`·`session.ts`의 종료 처리를 바꾸지 마라. 이유: 훅의 종료 코드 2는 차단 규약(설계서 13.1절)이고 이 문제와 무관하다.
- 강제 종료 타이머를 `unref()` 없이 두지 마라. 이유: 모든 명령이 끝난 뒤 그 시간만큼 기다리게 된다.
- 종료 코드의 뜻을 바꾸지 마라. 이유: runner와 CI 워크플로가 종료 코드로 판정한다.
