# Step 0: bind

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*`, `ci/*` 줄)
- `scripts/gates/risk-gate.ts`(`Review`, `parseReviews`, `ownerApprovedHead`, `riskGate`)
- `scripts/ci/gates.ts`(`RunGatesOptions`, `runGates`, `planG1`·`planReview`처럼 읽기 함수를 받아 쓰는 꼴, `riskGate` 호출)
- `scripts/harness.ts`의 `gates` 명령(`--reviews`, `--pr-number`, `GH_TOKEN`으로 원장을 읽는 꼴)
- `scripts/ci/binding.ts`(`patchId`, `samePrContent`, `changedOnBaseSince`, `carryOver`의 조건)
- `.github/workflows/gates.yml`의 `evaluate` job(권한, 체크아웃, 리뷰 조회) — 읽기만
- `scripts/test/risk-gate.test.ts`
- 계획 `docs/exec-plans/active/20261126-approval-binding/plan.md`의 수용 기준과 의사결정 로그

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **승인 head 판정(순수 함수)**: `scripts/gates/risk-gate.ts`에 승인 판정을 하는 함수를 둔다. 입력: 제작자 리뷰들(`Review[]`), 제작자 계정, 지금 head SHA, PR 커밋별 check suite 목록(SHA → `{ appId, headBranch, createdAt }[]`), PR head 브랜치 이름, Actions App id, 그리고 이어받기 판정 함수 넷(`isAncestor(h0)`, `samePatch(h0)`, `samePrContent(h0)`, `overlapsBase(h0)`). 출력: `{ approved: true, from: 'head' | <H0 SHA> } | { approved: false, why: string }`.
   - 제작자의 마지막 판정 리뷰(`APPROVED`·`CHANGES_REQUESTED`·`DISMISSED`, 지금의 `DECISIVE`)가 승인이 아니면 승인 아님.
   - H0 = check suite 가운데 Actions App이 만들고 `headBranch`가 PR head 브랜치이며 `createdAt <= 리뷰 submittedAt`인 것의 커밋 중 `createdAt`이 가장 늦은 것. 없으면 승인 아님("승인 head를 정하지 못했다").
   - H0 = 지금 head면 승인(`from: 'head'`). 아니면 수용 기준 3의 네 조건을 이 순서로 보고, 모두 맞으면 승인(`from: H0`), 하나라도 아니면 그 이유로 승인 아님.
   - 리뷰의 `commitId`는 판정에 쓰지 않는다.
2. **`riskGate`**: 위험도 높음이면 위 함수로 판정한다. 승인이면 지금처럼 success, 이어받았으면 설명에 `제작자 head 승인 이어받음 <H0 12자리>`를 넣는다. 승인이 아니면 지금 문구(`위험도 높음: 제작자 head 승인 필요 — …`)로 failure. 자료를 읽지 못했으면(`null`) 지금처럼 error.
3. **자료 읽기**: `scripts/ci/gates.ts`의 `RunGatesOptions`에 읽기 함수 하나를 더한다(예: `approvalInputs(): Promise<{ commits: string[]; suites: Record<string, Suite[]> }>`. `planReview`와 같은 꼴). PR 커밋 목록(`GET /repos/{repo}/pulls/{n}/commits`, 페이지 넘김)과 커밋마다 check suite(`GET /repos/{repo}/commits/{sha}/check-suites`, App id·`head_branch`·`created_at`)를 읽는다. 이어받기 판정 함수는 PR 체크아웃(`--repo`)에서 `binding.ts`의 함수와 `git merge-base --is-ancestor`로 만든다. `scripts/harness.ts`의 `gates` 명령이 `GH_TOKEN`·`--pr-number`로 그 함수를 만든다. 위험도가 높음일 때만 읽는다.
4. **Actions App id**: 설정의 필수 체크 표(`ci.requiredChecks`에서 `check`의 출처 App id)에서 읽는다. 없으면 승인 아님(fail-closed).
5. **테스트**: 새 파일 `scripts/test/risk-gate-approval.test.ts`에 판정 함수의 표 테스트(리뷰가 옮겨진 `commitId`를 보고해도 일반 커밋이 더해진 head는 승인 아님, main 병합만 더한 head는 이어받음, H0가 조상이 아님, patch가 다름, PR 파일 내용이 다름, main 변경과 겹침, 다른 브랜치·다른 App의 suite는 무시, 리뷰보다 뒤에 만든 suite는 무시, 마지막 판정 리뷰가 변경 요청, suite가 없음). `scripts/test/risk-gate.test.ts`의 있던 테스트는 새 입력으로 맞추되 단언(승인·실패·error의 경우)은 그대로 둔다. `gates`에서 위험도 높음 PR이 읽기 함수를 부르는지(그 밖에는 부르지 않는지)를 한 테스트로 본다.
6. **문서**: 설계서 10.3절(승인 결속)과 10.4절의 `risk-gate` 설명, 절차서 5절("위험도 높음", "승인 요청 전 조건")에 규칙을 적는다: 승인 뒤 main 병합만 더한 갱신은 승인을 이어받고, 그 밖의 커밋은 다시 승인받는다. 변경 조각 `docs/harness/changes/20261126-approval-binding-s0.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/risk-gate-approval.test.ts scripts/test/risk-gate.test.ts scripts/test/ci.test.ts
grep -q "제작자 head 승인 이어받음" scripts/gates/risk-gate.ts
test -z "$(grep -nE 'commitId === ' scripts/gates/risk-gate.ts)"
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s0.md
node scripts/harness.ts check
```

## 금지사항

- 워크플로 파일(`.github/workflows/`)을 고치지 마라. 이유: 봇은 워크플로를 push할 수 없고, 판정 job의 지금 권한으로 할 수 있다.
- 리뷰의 `commitId`로 승인 head를 정하지 마라. 이유: GitHub이 그 값을 새 head로 옮겨 보고한다(PR #226).
- 자료를 읽지 못했을 때 승인으로 보지 마라. 이유: fail-closed.
- 위험도가 높음이 아닌 PR에서 추가 API를 부르지 마라. 이유: 판정 job 시간과 API 사용량.
- 검증자 승인 이어받기(`review/*`)의 규칙을 바꾸지 마라. 이유: 범위 밖이다.
