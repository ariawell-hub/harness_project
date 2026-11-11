# 웹 프로파일 (초안)

`node scripts/harness.ts init --profile web`이 `profile.json`의 설정을 `harness.config.json`에 병합하고 템플릿을 복사한다.

- **표준 명령**: 제품의 실제 스크립트는 `package.json`에 `app:test`, `app:build`, `app:dev` 이름으로 둔다. 루트의 `test`·`build` 등은 하네스 별칭(`node scripts/harness.ts …`)이므로 같은 이름을 쓰면 재귀한다.
- **패키지 설치 정책**: 루트 `pnpm-workspace.yaml`(`minimumReleaseAge: 20160`, `onlyBuiltDependencies`)을 그대로 쓴다. 설치 스크립트가 꼭 필요한 패키지만 허용 목록에 넣고 ADR을 남긴다.
- **경로별 최소 위험도**: `profile.json`의 `riskPaths` (2단계 `risk-gate`가 쓴다).
- **verify**: `web-verify` 스킬은 3단계 파일럿에서 만든다(TD-12).
- **DB 금지 명령**: 코어 목록에 `guard.dbPatterns`를 더한다. DB·ORM 확정(Q10) 후 보강한다.
