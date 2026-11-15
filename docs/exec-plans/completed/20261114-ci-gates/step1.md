# Step 1: risk-gate

## 읽어야 할 파일

- `docs/exec-plans/active/20261114-ci-gates/plan.md` (수용 기준 3, 의사결정 로그의 재판정 트리거·제작자 결정)
- `docs/harness/design.md` 10.1절 위험도 판정, 10.3절 `risk-gate`·승인 결속(제작자 승인 = head SHA), 10.4절 단계 표시(`stage`), 5.1절 R13·R20
- step0이 만든 파일: `scripts/ci/results.ts`, `scripts/ci/gates.ts`, `scripts/ci/record.ts`, `.github/workflows/gates.yml`, `scripts/test/ci.test.ts`
- `scripts/lib/config.ts` `riskPaths`·`protectedPaths`·`stage`, `scripts/lib/plan.ts` `parseBranch`·`findPlan`·`parseDoc`

## 작업

1. `scripts/gates/risk-gate.ts`
   - `export type Risk = 'low' | 'normal' | 'high'`, `export interface RiskSignal { risk: Risk; reason: string }`
   - `export function changedFiles(root: string, base: string): { path: string; binary: boolean }[]`: `git diff --numstat -z --no-renames <base>...HEAD`(바이너리는 `-\t-`). 삭제 파일도 포함.
   - `export function assessRisk(o: { root; base; branch; cfg; signals: RiskSignal[] }): { risk: Risk; reasons: string[] }`: 계획 frontmatter `risk`(PR 트리의 그 브랜치 계획. 없거나 값이 이상하면 무시), `cfg.riskPaths` 중 맞는 glob의 최댓값, 보호 경로 변경(`stage` build → normal, operation → high), 바이너리 파일 → high(판정할 수 없는 파일 형식, fail-closed), `signals`. 이유는 최댓값을 만든 항목 위주로 짧게.
   - `export interface Review { user: string; state: string; commitId: string; submittedAt: string }`
   - `export function ownerApprovedHead(reviews: Review[], owner: string, headSha: string): boolean`: 제작자 계정의 **마지막** 리뷰(`APPROVED`·`CHANGES_REQUESTED`·`DISMISSED`만 센다, `COMMENTED`는 무시)가 `APPROVED`이고 `commitId === headSha`.
   - `export function riskGate(o: { …assessRisk 입력; headSha: string; reviews: Review[] | null }): GateResult & { risk: Risk }`: low·normal → success("위험도 보통: …"). high + 승인 → success("위험도 높음, 제작자 head 승인"). high + 미승인 → failure("위험도 높음: 제작자 head 승인 필요 — …"). high인데 `reviews === null`(조회 실패) → error.
2. `scripts/ci/`: `GATE_CONTEXTS`에 `risk-gate`. `GateResults`에 선택 필드 `risk`(검증된 값만)를 더해 이후 #54가 검증자 수를 정할 때 쓴다. `runGates`는 `reviews`(GitHub 리뷰 API 원본 JSON 배열 → `Review[]` 변환은 순수 함수로)와 `signals`를 받는다. `gates` 명령에 `--reviews <파일>`(없거나 깨지면 `null`).
3. 리뷰 뒤 재판정
   - `.github/workflows/review-trigger.yml`: `on: pull_request_review: types: [submitted, dismissed]`, `permissions: {}`, 아무것도 하지 않는 job 하나(비밀·체크아웃 없음).
   - `gates.yml`에 `workflow_run: workflows: [review-trigger], types: [completed]`를 더한다. 두 이벤트를 하나로 맞추는 해석 단계를 `node base/scripts/harness.ts ci-pr --event "$GITHUB_EVENT_PATH" --out <파일>`로 만든다: `pull_request_target`은 이벤트에서, `workflow_run`은 페이로드의 head SHA로 `GET repos/{repo}/commits/{sha}/pulls`를 조회해 열린 같은 리포 PR 중 head SHA가 같은 것 하나를 고른다(없으면 판정 없이 종료). 결과(PR 번호, head SHA, head ref, base SHA, 본문)를 파일로 쓰고 이후 단계가 읽는다. API 호출은 주입 가능한 함수로 두고 테스트한다.
   - 판정 job이 `gh api --paginate repos/{repo}/pulls/{n}/reviews`를 파일로 받아 `--reviews`로 넘긴다(`GITHUB_TOKEN`, `pull-requests: read`).
   - concurrency는 PR 번호 기준을 유지한다(`workflow_run`이면 해석 전이라 head SHA 기준 그룹으로 둔다).
4. 테스트(`scripts/test/risk-gate.test.ts`, 먼저 실패 확인): 경로 표 최댓값, 계획 risk가 경로보다 높을 때, stage build/operation의 보호 경로, 바이너리 → high, signal → high, 제작자의 옛 커밋 승인·다른 계정 승인·승인 뒤 변경 요청·COMMENTED 무시, 리뷰 조회 실패, `ci-pr` 해석(두 이벤트, 포크 PR, head 불일치, 닫힌 PR).
5. 문서: `architecture.md` 모듈 표, `CHANGELOG`, 절차서 4절에 "위험도 높음이면 제작자에게 head 승인을 요청한다"와 재판정 경로, 계획 진행 로그에 실제 PR에서 `risk-gate` 상태(작성자 = 검증 App)를 기록.

## Acceptance Criteria

```bash
node --test scripts/test/risk-gate.test.ts scripts/test/ci.test.ts
grep -q "'risk-gate'" scripts/ci/results.ts
grep -q "export function ownerApprovedHead" scripts/gates/risk-gate.ts
grep -q "workflow_run" .github/workflows/gates.yml
test -f .github/workflows/review-trigger.yml
```

## 금지사항

- 위험도를 PR 트리의 `harness.config.json`으로 판정하지 마라. 이유: PR이 경로 표·`stage`를 낮출 수 있다. 설정은 `--config-root`(main)에서만 읽는다.
- 검증 신호·계획 `risk`로 위험도를 낮추지 마라. 이유: 10.1절, 위험도는 올릴 수만 있다(B11).
- `review-trigger.yml`에 시크릿·environment·쓰기 권한을 두지 마라. 이유: PR 쪽 정의로 돈다.
- `workflow_run` 페이로드의 PR 정보를 검증 없이 쓰지 마라. 이유: 같은 이름의 워크플로를 PR이 만들 수 있다. API로 다시 조회한 현재 head에만 판정한다.
