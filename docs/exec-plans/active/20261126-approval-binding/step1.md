# Step 1: rule

## 읽어야 할 파일

- 계획의 수용 기준 4~6, step0 결과 `lab/approval-binding/results/live.json`과 `lab/approval-binding/README.md`
- `scripts/gates/risk-gate.ts`(`ownerApprovedHead`, `riskGate`)
- `scripts/ci/gates.ts`(`RunGatesOptions`, `runGates`의 `risk-gate`, `planReview`처럼 읽기 함수를 받아 쓰는 꼴)
- `scripts/harness.ts`의 `gates` 명령, `scripts/ci/pr.ts`의 `githubGet`
- `scripts/commands/ops-check.ts`(2번 항목), `scripts/lib/github.ts`(`GitHubPort`, `GhCli`의 `branchInfo`), `scripts/lib/github-fake.ts`(`FakeState`, `FakeGitHub`)
- `scripts/test/risk-gate.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/harness-guard.test.ts`(`runGates: 신호가 있으면 risk-gate가 높음 → 제작자 head 승인이 있어야 통과`), `scripts/test/ops-check.test.ts`

## 작업

step0이 main에 병합된 뒤 한다. 테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **규칙 모듈과 읽기**: 새 모듈 `scripts/lib/rules.ts`에 (ㄱ) `rulesPath(repo, branch, page)`: `repos/{repo}/rules/branches/{branch}?per_page=100&page={page}`, 브랜치 이름은 `encodeURIComponent`로 경로 한 구간(`release/1.x` → `release%2F1.x`), (ㄴ) `readRulePagesSync(get, repo, branch)`와 `readRulePages(get, repo, branch)`(비동기): 1쪽부터 쪽이 100개보다 덜 찰 때까지 읽어 쪽들(배열의 배열)을 돌려주고, 요청이 실패하거나 쪽이 배열이 아니거나 20쪽을 넘으면 던진다, (ㄷ) `dismissRuleOf(pages)`: 쪽들 가운데 `type`이 `pull_request`이고 `parameters.dismiss_stale_reviews_on_push`가 `true`인 항목이 있으면 true, 없으면 false, 꼴이 틀리면(배열이 아님, 항목에 `type` 없음) null. `scripts/ci/gates.ts`에 `readDismissRule({ api, repo, pr }): Promise<{ base: string; on: boolean } | null>`을 내보낸다: `GET repos/{repo}/pulls/{pr}`의 `base.ref`(PR의 실제 base, 문자열이 아니면 null)로 `readRulePages`를 부르고 `dismissRuleOf`로 판정해 base와 함께 돌려준다(판정이 null이거나 던지면 null).
2. **`risk-gate`**: `riskGate`의 입력에 `dismissRule?: { base: string; on: boolean } | null`을 더한다. 위험도 높음일 때 순서: 리뷰를 못 읽음 → error(지금과 같다), 제작자의 마지막 판정 리뷰가 승인이 아님 → failure(지금과 같다), `dismissRule`이 없음·null → error(`위험도 높음: 오래된 승인 철회 규칙을 확인하지 못해 제작자 승인을 head에 묶을 수 없다`, details에 SECURITY.md의 복구 방법), `on`이 false → failure(`위험도 높음: 오래된 승인 철회 규칙이 없어 제작자 승인을 head에 묶을 수 없다`, 고치는 법에 SECURITY.md의 절차), `base`가 기본 브랜치(`github.defaultBranch`)가 아님 → failure(`위험도 높음: 기본 브랜치가 아닌 base(<base>)에는 승인 전환 시각이 없어 제작자 승인을 셀 수 없다`), main 설정 `github.dismissStaleSince`가 없거나 시각이 아님 → failure(설정 방법), 마지막 승인의 `submittedAt`이 그 시각보다 엄격히 뒤(초 단위)가 아님(같은 초 포함) → failure(`위험도 높음: 규칙을 켜기 전의 승인이라 현재 head를 다시 승인해야 한다`), 그 밖에는 지금 판정(리뷰의 커밋이 head면 success). `scripts/gates/`는 `scripts/ci/`를 가져오지 않는다.
3. **연결**: `RunGatesOptions`에 `dismissRule?: () => Promise<{ base: string; on: boolean } | null>`. `runGates`는 위험도 높음이고 제작자의 마지막 판정 리뷰가 승인일 때만 부르고, 예외는 null로 본다. `scripts/harness.ts`의 `gates`가 `GH_TOKEN`으로 만든 `githubGet`과 `--pr-number`로 만든다(PR 번호가 없으면 만들지 않아 error).
4. **`ops-check`**: GitHub 포트에 `branchRules(branch): unknown`(규칙 목록의 쪽들. `GhCli`는 `readRulePagesSync`에 `gh api <rulesPath>`를 넘겨 끝까지 읽고, 끝까지 못 읽으면 던진다. 시험을 위해 `GhCli`의 생성자는 `gh` 실행 함수를 둘째 인자로 받는다(기본은 지금의 `gh`). `FakeGitHub`는 상태 파일의 `branchRules`를 돌려주고 없으면 던진다)를 더한다. 2번 항목에 기본 브랜치의 규칙(`branchRules` → `dismissRuleOf`, 1과 같은 함수)을 확인하는 줄을 더한다. 포트가 던지면 null로 본다. true ✓, false ✗와 SECURITY.md 절차이고 항목 상태 `fail`, null `?`이고 다른 실패가 없으면 항목 상태 `unknown`. 명령의 종료 코드는 지금 규칙대로 항목 상태를 따른다.
   4-1. **설정**: `scripts/lib/config.ts`에 `github.dismissStaleSince`(선택, 문자열)의 형을 더한다. 읽을 때 형식을 검사하지 않는다: 설정 오류로 `gates` 명령이 죽으면 판정 결과가 없으므로, 없거나 시각이 아닌 값은 `risk-gate`가 failure와 설정 안내로 낸다(작업 2). `harness.config.json`에 step0의 `rule.firstSeenAt`을 그대로 넣는다.
5. **테스트**:
   - `readDismissRule`(가짜 `api`, 돌려준 `base`와 `on`으로 단언): true·false인 `pull_request` 규칙, 빈 배열, 다른 종류만, 두 쪽(둘째 쪽에 규칙), 배열이 아님·`type` 없음·요청 실패는 null. PR의 base가 기본 브랜치가 아니면(예: `release`) 그 브랜치의 규칙을 읽고, 슬래시가 든 base(`release/1.x`)는 `release%2F1.x` 한 구간으로 읽는다(부른 경로로 단언). `base.ref`가 없으면 null.
   - `readRulePagesSync`(가짜 `get`, `ops-check.test.ts`): 둘째 쪽에만 규칙이 있으면 두 쪽을 모두 돌려줘 `dismissRuleOf`가 true, 둘째 쪽 읽기가 실패하면 던진다. 실제 포트: `new GhCli(dir, 가짜 gh 실행)`의 `branchRules('main')`을 불러 `gh api` 인자로 1쪽·2쪽 경로(`repos/{owner}/{repo}/rules/branches/main?per_page=100&page=2`)가 차례로 요청되고, 둘째 쪽에만 있는 규칙이 `dismissRuleOf`로 true이며, 둘째 쪽 실행이 실패하면 던지고 그 포트의 `branchRules`를 쓰는 `ops-check` 2번이 `?`·`unknown`인 것을 단언한다.
   - `riskGate`: 위 순서의 경우 모두. 승인 리뷰가 없으면 `dismissRule`과 무관하게 failure. 규칙을 켜기 전의 승인(리뷰 커밋이 head로 옮겨진 것)은 failure이고, 그 뒤 현재 head를 다시 승인하면 success(계획 검증 F23). 경계: 승인 시각이 전환 시각과 같은 초면 failure, 1초 뒤면 success. base가 기본 브랜치가 아니면(`release`, 그 브랜치에 규칙이 있고 승인이 main 전환 시각 뒤여도) failure.
   - `ci.test.ts`의 `gates`: 위험도 높음이고 승인 리뷰가 있을 때만 `dismissRule`을 부르고(부른 횟수로 단언), `{ base: 'main', on: true }`면 success, `{ base: 'main', on: false }`면 failure, null이면 error, 던지면 error. 위험도 보통이나 승인 리뷰가 없으면 부르지 않는다.
   - `harness-guard.test.ts`의 그 테스트: 그 테스트 리포의 설정에 `github.dismissStaleSince`(예: `2026-11-14T00:00:00Z`)를 넣고, 승인 리뷰의 `submittedAt`을 `t`에서 그보다 뒤의 ISO 시각(예: `2026-11-14T01:00:00Z`)으로 바꾸고, 승인 입력에 `dismissRule: async () => ({ base: 'main', on: true })`(테스트 설정의 기본 브랜치)를 더한다. 있던 단언은 그대로 두고 같은 설정·리뷰에서 "`dismissRule`을 주지 않으면 리뷰의 커밋이 head여도 error" 단언을 더한다(새 동작, merge-base 코드에서는 success라 R5 test-effect가 실효로 본다).
   - `ops-check.test.ts`: 새 줄 셋(✓, ✗, ?)과 각 경우의 2번 항목 상태(`ok`·`fail`·`unknown`, 다른 실패가 있으면 `fail` 유지), 명령의 종료 코드.
   - `lib.test.ts`(설정 읽기 테스트): `github.dismissStaleSince`가 있으면 그대로 읽고, 시각이 아닌 값이어도 설정 오류가 아니다. `ci.test.ts`의 `gates`: 시각이 아닌 `github.dismissStaleSince`가 든 설정 파일을 `loadConfig`로 읽어 `runGates`를 돌리면(위험도 높음, 승인 리뷰, 규칙 켬) `risk-gate`가 failure이고 설명에 `github.dismissStaleSince`, 상세에 설정 방법이 있다.
6. **문서**: 설계서 0.2절(리포 설정 표에 규칙 세트 줄), 10.3절 승인 결속 기준의 제작자 승인 행(묶는 기준: head SHA + GitHub의 오래된 승인 철회 규칙, 이어받는 경우: step0에서 잰 대로), 10.4절의 `risk-gate` 설명, 절차서 5절("위험도 높음", "승인 요청 전 조건": step0 결과대로 main 병합 갱신 뒤 승인이 유지되는지), SECURITY.md에 새 절 "오래된 승인 철회 규칙 세트 (제작자)"(step0 작업 1의 절차와 확인 방법). 변경 조각 `docs/harness/changes/20261126-approval-binding-s1.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/risk-gate.test.ts scripts/test/ci.test.ts scripts/test/harness-guard.test.ts scripts/test/ops-check.test.ts
grep -q "export async function readDismissRule" scripts/ci/gates.ts
grep -q "오래된 승인 철회 규칙이 없어" scripts/gates/risk-gate.ts
node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('harness.config.json','utf8'));const r=JSON.parse(fs.readFileSync('lab/approval-binding/results/live.json','utf8'));const v=c.github.dismissStaleSince;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)||Number.isNaN(Date.parse(v))||v!==r.rule.firstSeenAt)process.exit(1)"
node --test scripts/test/lib.test.ts
test -z "$(grep -nE "from '\.\./ci/" scripts/gates/risk-gate.ts)"
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github
grep -qF '오래된 승인 철회 규칙 세트' docs/SECURITY.md
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s1.md
grep -q "export function readRulePagesSync" scripts/lib/rules.ts
grep -q "branchRules" scripts/lib/github.ts
node --test --test-name-pattern="GhCli" scripts/test/ops-check.test.ts
grep -qF 'approval-dismiss-stale' docs/harness/design.md
grep -qF 'readDismissRule' docs/harness/design.md
grep -qF '| 제작자 승인(위험도 높음) | head SHA + GitHub의 오래된 승인 철회 규칙 세트' docs/harness/design.md
grep -qF 'github.dismissStaleSince' docs/harness/workflow.md
grep -qF 'origin/main` 병합만 더한 갱신은 승인이 유지되고' docs/harness/workflow.md
node scripts/harness.ts check
```

## 금지사항

- 워크플로 파일(`.github/workflows/`)을 고치지 마라. 이유: 봇은 워크플로를 push할 수 없고, 규칙은 판정 job의 지금 토큰으로 읽힌다.
- 규칙을 읽지 못했을 때 승인으로 보지 마라. 이유: fail-closed.
- 위험도가 높음이 아니거나 승인 리뷰가 없는 PR에서 규칙 API를 부르지 마라. 이유: 판정 job 시간과 API 사용량.
- 승인 head를 시각으로 추정하는 코드를 다시 넣지 마라. 이유: 제작자 결정으로 버린 방식이다.
