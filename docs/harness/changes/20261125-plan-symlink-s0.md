# 변경 조각: 20261125-plan-symlink-s0

## CHANGELOG

- 계획을 읽는 판정 코드가 계획 자리의 심볼릭 링크를 따라가지 않는다(Issue #194. 검사를 약화하지 않는다): `plan-gate`, `risk-gate`의 계획 위험도, 계획 해시(`planHash`·`planHashes`·`planMode`), 검증자 계획의 작성자(`planAuthor`), 검증 입력(`writeReviewInput`)이 `existsSync`·`readFileSync`·`readdirSync` 대신 새 `scripts/lib/plan-read.ts`(`planReader`, `findPlanSafe`, `readPlanFile`, `listPlanDir`)로 읽는다. 작업 트리의 각 자리를 `lstat`으로 보고 git 색인에 링크(120000)·서브모듈(160000)로 있는 자리도 거절한다(`core.symlinks=false`로 받은 CI 체크아웃 포함). 그 자리를 읽어야 하는 판정은 실패 쪽이다(`plan-gate` 문제, `risk-gate` error, 위험도 high, 작성자 모름, 계획 승인 없음). 전에는 CI 워크플로의 `core.symlinks false` 설정만이 막았다. 작업 트리에서 읽으므로 커밋하지 않은 계획과 이 리포의 계획 해시는 그대로다. 테스트는 `scripts/test/plan-read.test.ts`·`plan-symlink.test.ts`.

## 설계서 변경 이력

- 10.4절 "심볼릭 링크" 항목에 계획을 읽는 base 스크립트가 체크아웃 설정과 무관하게 계획 자리의 링크를 따라가지 않고(작업 트리 `lstat` + git 색인의 모드) 그 자리를 읽어야 하는 판정을 실패 쪽으로 둔다는 것을 적었다. 규칙은 약화하지 않았다(Issue #194)
