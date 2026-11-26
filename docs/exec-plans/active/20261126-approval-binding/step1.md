# Step 1: rule

## 읽어야 할 파일

- 계획의 수용 기준 4~6, step0 결과 `lab/approval-binding/results/live.json`과 `lab/approval-binding/README.md`
- `scripts/gates/risk-gate.ts`(`ownerApprovedHead`, `riskGate`)
- `scripts/ci/gates.ts`(`RunGatesOptions`, `runGates`의 `risk-gate`, `planReview`처럼 읽기 함수를 받아 쓰는 꼴)
- `scripts/harness.ts`의 `gates` 명령, `scripts/ci/pr.ts`의 `githubGet`
- `scripts/commands/ops-check.ts`(2번 항목)
- `scripts/test/risk-gate.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/harness-guard.test.ts`(`runGates: 신호가 있으면 risk-gate가 높음 → 제작자 head 승인이 있어야 통과`), `scripts/test/ops-check.test.ts`

## 작업

step0이 main에 병합된 뒤 한다. 테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **규칙 읽기**: `scripts/ci/gates.ts`에 `readDismissRule({ api, repo, pr }): Promise<boolean | null>`을 내보낸다. 먼저 `GET repos/{repo}/pulls/{pr}`의 `base.ref`(PR의 실제 base, 문자열이 아니면 null)를 읽고, `GET repos/{repo}/rules/branches/{base}`(쪽 번호 `per_page=100`, 쪽이 덜 찰 때까지)의 항목 가운데 `type`이 `pull_request`이고 `parameters.dismiss_stale_reviews_on_push`가 `true`인 것이 있으면 true, 없으면 false, 요청이 실패하거나 응답 꼴이 틀리면(배열이 아님, 항목에 `type` 없음) null.
2. **`risk-gate`**: `riskGate`의 입력에 `dismissRule?: boolean | null`을 더한다. 위험도 높음일 때 순서: 리뷰를 못 읽음 → error(지금과 같다), 제작자의 마지막 판정 리뷰가 승인이 아님 → failure(지금과 같다), `dismissRule`이 없음·null → error(`위험도 높음: 오래된 승인 철회 규칙을 확인하지 못해 제작자 승인을 head에 묶을 수 없다`, details에 SECURITY.md의 복구 방법), false → failure(`위험도 높음: 오래된 승인 철회 규칙이 없어 제작자 승인을 head에 묶을 수 없다`, 고치는 법에 SECURITY.md의 절차), main 설정 `github.dismissStaleSince`가 없거나 시각이 아님 → failure(설정 방법), 마지막 승인의 `submittedAt`이 그 시각보다 앞섬 → failure(`위험도 높음: 규칙을 켜기 전의 승인이라 현재 head를 다시 승인해야 한다`), 그 밖에는 지금 판정(리뷰의 커밋이 head면 success). `scripts/gates/`는 `scripts/ci/`를 가져오지 않는다.
3. **연결**: `RunGatesOptions`에 `dismissRule?: () => Promise<boolean | null>`. `runGates`는 위험도 높음이고 제작자의 마지막 판정 리뷰가 승인일 때만 부르고, 예외는 null로 본다. `scripts/harness.ts`의 `gates`가 `GH_TOKEN`으로 만든 `githubGet`과 `--pr-number`로 만든다(PR 번호가 없으면 만들지 않아 error).
4. **`ops-check`**: 2번 항목에 main의 규칙(`GET rules/branches/<기본 브랜치>`, 규칙 판정은 1과 같은 함수를 나눠 쓴다)을 확인하는 줄을 더한다. true ✓, false ✗와 SECURITY.md 절차이고 항목 상태 `fail`, null `?`이고 다른 실패가 없으면 항목 상태 `unknown`. 명령의 종료 코드는 지금 규칙대로 항목 상태를 따른다.
   4-1. **설정**: `scripts/lib/config.ts`에 `github.dismissStaleSince`(선택, ISO 시각 문자열)를 더하고, `harness.config.json`에 step0의 `rule.firstSeenAt`을 넣는다.
5. **테스트**:
   - `readDismissRule`(가짜 `api`): true·false인 `pull_request` 규칙, 빈 배열, 다른 종류만, 두 쪽(둘째 쪽에 규칙), 배열이 아님·`type` 없음·요청 실패는 null. PR의 base가 기본 브랜치가 아니면(예: `release`) 그 브랜치의 규칙을 읽는다(부른 경로로 단언). `base.ref`가 없으면 null.
   - `riskGate`: 위 순서의 경우 모두. 승인 리뷰가 없으면 `dismissRule`과 무관하게 failure. 규칙을 켜기 전의 승인(리뷰 커밋이 head로 옮겨진 것)은 failure이고, 그 뒤 현재 head를 다시 승인하면 success(계획 검증 F23).
   - `ci.test.ts`의 `gates`: 위험도 높음이고 승인 리뷰가 있을 때만 `dismissRule`을 부르고(부른 횟수로 단언), true면 success, false면 failure, null이면 error. 위험도 보통이나 승인 리뷰가 없으면 부르지 않는다.
   - `harness-guard.test.ts`의 그 테스트: 승인 입력에 `dismissRule: async () => true`를 더한다. 있던 단언은 그대로 두고 "`dismissRule`을 주지 않으면 리뷰의 커밋이 head여도 error" 단언을 더한다(새 동작, merge-base 코드에서는 success라 R5 test-effect가 실효로 본다).
   - `ops-check.test.ts`: 새 줄 셋(✓, ✗, ?)과 각 경우의 2번 항목 상태(`ok`·`fail`·`unknown`, 다른 실패가 있으면 `fail` 유지), 명령의 종료 코드.
   - `lib.test.ts`(설정 읽기 테스트): `github.dismissStaleSince`가 시각 문자열이면 읽고, 시각이 아니면 설정 오류.
6. **문서**: 설계서 0.2절(리포 설정 표에 규칙 세트 줄), 10.3절 승인 결속 기준의 제작자 승인 행(묶는 기준: head SHA + GitHub의 오래된 승인 철회 규칙, 이어받는 경우: step0에서 잰 대로), 10.4절의 `risk-gate` 설명, 절차서 5절("위험도 높음", "승인 요청 전 조건": step0 결과대로 main 병합 갱신 뒤 승인이 유지되는지), SECURITY.md에 새 절 "오래된 승인 철회 규칙 세트 (제작자)"(step0 작업 1의 절차와 확인 방법). 변경 조각 `docs/harness/changes/20261126-approval-binding-s1.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/risk-gate.test.ts scripts/test/ci.test.ts scripts/test/harness-guard.test.ts scripts/test/ops-check.test.ts
grep -q "export async function readDismissRule" scripts/ci/gates.ts
grep -q "오래된 승인 철회 규칙이 없어" scripts/gates/risk-gate.ts
node -e "const c=JSON.parse(require('fs').readFileSync('harness.config.json','utf8'));if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(c.github.dismissStaleSince))process.exit(1)"
node --test scripts/test/lib.test.ts
test -z "$(grep -nE "from '\.\./ci/" scripts/gates/risk-gate.ts)"
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github
grep -qF '오래된 승인 철회 규칙 세트' docs/SECURITY.md
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s1.md
node scripts/harness.ts check
```

## 금지사항

- 워크플로 파일(`.github/workflows/`)을 고치지 마라. 이유: 봇은 워크플로를 push할 수 없고, 규칙은 판정 job의 지금 토큰으로 읽힌다.
- 규칙을 읽지 못했을 때 승인으로 보지 마라. 이유: fail-closed.
- 위험도가 높음이 아니거나 승인 리뷰가 없는 PR에서 규칙 API를 부르지 마라. 이유: 판정 job 시간과 API 사용량.
- 승인 head를 시각으로 추정하는 코드를 다시 넣지 마라. 이유: 제작자 결정으로 버린 방식이다.
