# 웹 프로파일 (초안)

`node scripts/harness.ts init --profile web`이 `profile.json`의 설정을 `harness.config.json`에 병합하고 템플릿을 복사한다.

- **표준 명령**: 제품의 실제 스크립트는 `package.json`에 `app:test`, `app:build`, `app:dev` 이름으로 둔다. 루트의 `test`·`build` 등은 하네스 별칭(`node scripts/harness.ts …`)이므로 같은 이름을 쓰면 재귀한다.
- **패키지 설치 정책**: 루트 `pnpm-workspace.yaml`(`minimumReleaseAge: 20160`, `onlyBuiltDependencies`)을 그대로 쓴다. 설치 스크립트가 꼭 필요한 패키지만 허용 목록에 넣고 ADR을 남긴다.
- **경로별 최소 위험도**: `profile.json`의 `riskPaths` (2단계 `risk-gate`가 쓴다).
- **테스트 실효성 검사(R5, `testEffect`)**: `node scripts/harness.ts test-effect`가 추가·수정한 테스트 파일을 변경 전 코드에서 돌려 본다.
  - 대상은 `src/**/*.test.ts`와 `src/**/*.test.tsx`(Vitest로 돌리는 단위·통합 테스트)다. 공용 테스트 도구는 `src/test/`에 둔다(`support`). 테스트와 함께 바뀐 판이 변경 전 코드 위에 같이 놓인다. 래퍼 폴더(`profiles/web/test-effect/`)도 `support`다. 웹 프로파일을 처음 적용하는 변경에서는 변경 전 코드에 래퍼가 없어서, 이 변경이 더한 래퍼를 변경 전 코드 위에 놓고 테스트를 돌린다(없으면 실행 자체가 실패해 모든 테스트가 실효 있다고 판정된다).
  - E2E 시나리오(`e2e/**/*.spec.ts`)는 대상이 아니다. 실행 중인 앱이 필요해 변경 전 코드에서 돌릴 수 없다.
  - 명령은 `node profiles/web/test-effect/run-one.mjs <테스트 파일>`이다. Vitest CLI(`vitest run <파일>`)를 쓰지 않는 이유: CLI의 파일 인자는 경로 부분 문자열 필터라서 `src/a.test.ts`를 넘기면 `src/a.test.tsx`도 돌고, 다른 파일의 실패가 그 파일의 판정에 섞인다. 래퍼는 Vitest 설정의 `include`를 그 파일 하나로 바꿔 실행한다. 맞는 테스트 파일이 없으면 통과로 두지 않는다.
  - 단언 실패인지는 출력의 `AssertionError`로 가른다(`assertPattern`). 모듈이 없어서 실패한 테스트는 "단언 실패 아님"으로 표시되고, 그 테스트의 단언은 직접 확인해야 한다.
  - `vitest`는 대상 리포의 devDependency다. 테스트 위치나 실행 도구가 다르면 그 리포의 `harness.config.json`에서 `testEffect`를 고친다. 그 변경은 `harness-guard`가 신호로 올린다.
  - 실제 Vitest로 확인한 기록: [lab/pilot-prep](../../lab/pilot-prep/README.md).
- **verify**: `web-verify` 스킬은 3단계 파일럿에서 만든다(TD-12).
- **DB 금지 명령**: 코어 목록에 `guard.dbPatterns`를 더한다. DB·ORM 확정(Q10) 후 보강한다.
