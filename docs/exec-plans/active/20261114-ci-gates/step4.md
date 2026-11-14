# Step 4: required-checks

## 읽어야 할 파일

- `docs/exec-plans/active/20261114-ci-gates/plan.md` (수용 기준 6·8, 발견 사항, 진행 로그의 실제 PR 기록)
- `docs/harness/design.md` 0.2절(필수 체크 출처, `app_id` 확인), 10.3절, 10.4절 부트스트랩·운영 전환 체크리스트 1
- step0~3이 만든 파일: `scripts/ci/`, `scripts/gates/{risk-gate,harness-guard,deps-guard}.ts`, `.github/workflows/{gates,review-trigger}.yml`
- `scripts/lib/github.ts` `GitHubPort`, `scripts/lib/github-fake.ts`
- `docs/exec-plans/tech-debt-tracker.md` TD-1·TD-2·TD-10

## 작업

시작 전에 제작자에게 요청해 확인한다(진행 로그에 기록): 검증 App이 네 상태를 보고한 PR이 있고, 제작자가 main 필수 체크를 `check`(GitHub Actions) + `plan-gate`·`risk-gate`·`deps-guard`·`harness-guard`(출처 = 검증 App)로 바꿨다. 이 등록 전에 옛 `plan-gate.yml`을 지우면 모든 PR이 막힌다.

1. 설정: `ci.requiredChecks: { context: string; source: "actions" | "recorder" }[]`와 `ci.recorderAppId: number`(제작자가 알려 준 검증 App ID). `scripts/lib/config.ts` 검증.
2. `GitHubPort.requiredChecks(branch: string): { context: string; appId: number | null }[]`(봇 토큰으로 `GET repos/{repo}/branches/{branch}`의 `protection.required_status_checks.checks`). 가짜 구현 포함.
3. `scripts/ci/protection.ts` `export function compareRequiredChecks(actual, cfg): { ok: boolean; lines: string[] }`: 설정에 있는데 등록 안 됨, 출처 다름(`actions` = 15368, `recorder` = `ci.recorderAppId`), 설정에 없는 등록을 각각 보고. `harness.ts required-checks` 명령(종료 코드 0/1). 운영 전환 체크리스트 1의 확인 도구다.
4. `.github/workflows/plan-gate.yml` 삭제.
5. 테스트(`scripts/test/protection.test.ts`, 먼저 실패 확인): 일치, 누락, 출처 다름(Actions로 등록된 `plan-gate`), 여분, `recorderAppId` 없음.
6. 문서
   - 설계서 0.2절: 등록 순서(App 보고 → 등록 → 옛 job 제거)와 `required-checks` 명령. 10.3절 표에 기록 위치(`gates` 워크플로의 기록 job). 10.4절 CI 작업 분리 표에 판정 job 하나가 네 검사를 돌림, 리뷰 재판정 경로(`review-trigger` → `workflow_run`), 부트스트랩: `pull_request_target` 체크는 도입 PR에서 돌지 않음(발견 사항).
   - 절차서, `architecture.md`, `CHANGELOG`.
   - TD-2 해결, TD-1 비고에 ① 완료와 남은 항목(#54~#57), 계획 "검증 방법과 결과"에 `required-checks` 출력.

## Acceptance Criteria

```bash
node --test scripts/test/protection.test.ts scripts/test/ci.test.ts
test ! -e .github/workflows/plan-gate.yml
grep -q "recorderAppId" harness.config.json
grep -q "TD-2.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 브랜치 보호·필수 체크를 봇으로 바꾸려 하지 마라. 이유: R20, 봇에 관리자 권한이 없다. 제작자에게 요청한다.
- 제작자 확인 전에 `plan-gate.yml`을 지운 PR을 자동 병합하지 마라. 이유: 필수 체크 `plan-gate`(Actions 출처)가 사라져 모든 PR이 막힌다.
- `required-checks`가 체크 요약 API(`statusCheckRollup`)를 쓰지 않게 하라. 이유: 출처를 보지 않는다(10.3절, Q20).
