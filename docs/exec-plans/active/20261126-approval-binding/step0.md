# Step 0: bind

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*`, `ci/*` 줄)
- `scripts/gates/risk-gate.ts`(`Review`, `parseReviews`, `ownerApprovedHead`, `changedFiles`, `riskGate`)
- `scripts/ci/gates.ts`(`RunGatesOptions`, `runGates`, `planG1`·`planReview`처럼 읽기 함수를 받아 쓰는 꼴, `riskGate` 호출)
- `scripts/harness.ts`의 `gates` 명령(`--reviews`, `--pr-number`, `GH_TOKEN`으로 원장을 읽는 꼴)
- `scripts/ci/binding.ts`(`patchId`, `samePrContent`, `changedOnBaseSince`, `carryOver`의 조건)
- `scripts/ci/protection.ts`의 `ACTIONS_APP_ID`와 필수 체크 출처 매핑(`source: 'actions'`)
- `.github/workflows/gates.yml`의 `evaluate` job(권한, 체크아웃 `fetch-depth: 0`, 리뷰 조회) — 읽기만
- `scripts/test/risk-gate.test.ts`, `scripts/test/ci.test.ts`
- 계획 `docs/exec-plans/active/20261126-approval-binding/plan.md`의 수용 기준과 의사결정 로그

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **승인 head 판정(순수 함수)**: `scripts/gates/risk-gate.ts`에 `ownerApproval` 함수를 둔다. 입력: 제작자 리뷰들(`Review[]`), 제작자 계정, 지금 head SHA, PR 커밋별 check suite 목록(SHA → `{ appId, headBranch, createdAt }[]`), PR head 브랜치 이름, 이어받기 판정 함수 `carry(h0): string | null`(null이면 이어받을 수 있다, 글이면 그 이유). 출력: `{ approved: true, from: 'head' } | { approved: true, from: <H0 SHA> } | { approved: false, why: string }`.
   - 제작자의 마지막 판정 리뷰(`APPROVED`·`CHANGES_REQUESTED`·`DISMISSED`, 지금의 `DECISIVE`)가 승인이 아니면 승인 아님.
   - 커밋마다 "첫 suite 시각" = 그 커밋의 suite 가운데 `appId`가 `ACTIONS_APP_ID`(`scripts/ci/protection.ts`의 상수를 가져다 쓴다)이고 `headBranch`가 PR head 브랜치인 것의 `createdAt` 최솟값. 그런 suite가 없는 커밋은 후보가 아니다.
   - H0 = 첫 suite 시각이 리뷰 `submittedAt`보다 **엄격히 앞선**(초 단위 비교, 같은 초는 앞서지 않은 것으로 본다) 커밋 가운데 첫 suite 시각이 가장 늦은 것. 없으면 승인 아님("승인 head를 정하지 못했다").
   - H0의 첫 suite 시각이 `submittedAt` 60초 안이면(`submittedAt - 60초 <= 첫 suite 시각`) 승인 아님("승인 직전 60초 안에 head가 바뀌어 승인 head가 모호하다"). 같은 초, 서비스 사이 시계 차이, 승인 직전 push를 모두 다시 승인받는 쪽으로 보낸다.
   - H0 = 지금 head면 승인(`from: 'head'`). 아니면 `carry(H0)`가 null일 때만 승인(`from: H0`), 아니면 그 이유로 승인 아님.
   - 리뷰의 `commitId`는 판정에 쓰지 않는다.
2. **이어받기 판정(git)**: `scripts/ci/binding.ts`에 `ownerApprovalCarry(root, baseRef, h0, prFiles): string | null`을 둔다. PR 체크아웃(지금 `HEAD`가 PR head)에서 다음을 이 순서로 보고 처음 어긋난 이유를 돌려준다.
   - (가) H0가 `HEAD`의 조상이다(`git merge-base --is-ancestor`).
   - (나) H0 이후 더한 커밋이 main 병합뿐이다: `git rev-list H0..HEAD ^<baseRef>`의 커밋이 모두 병합 커밋이고, 각 병합 커밋의 첫째 부모를 뺀 부모가 모두 `<baseRef>`의 조상이다. 빈 일반 커밋, 바꿨다가 되돌린 일반 커밋, main이 아닌 브랜치의 병합은 여기서 걸린다.
   - (다) patch-id가 같다: `patchId(root, merge-base(H0, baseRef), H0)`와 `patchId(root, merge-base(HEAD, baseRef), 'HEAD')`. `patchId`에 세 번째 인자 `tip`(기본값 `'HEAD'`)을 더해 비교 끝을 정하게 한다. 있던 호출은 그대로다.
   - (라) PR 파일 내용이 같다(`samePrContent(root, H0, prFiles)`).
   - (마) H0 이후 main에서 바뀐 파일이 PR 파일과 겹치지 않는다(`changedOnBaseSince(root, baseRef, H0)`. `null`이면 이어받지 않는다).
   - git 명령이 실패하면 이어받지 않는다(이유를 돌려준다).
3. **`riskGate`**: 위험도 높음이면 `ownerApproval`로 판정한다. 승인이면 지금처럼 success, 이어받았으면 설명에 `제작자 head 승인 이어받음 <H0 12자리>`를 넣는다. 승인이 아니면 지금 문구(`위험도 높음: 제작자 head 승인 필요 — …`)에 이유를 붙여 failure. 자료를 읽지 못했으면(`null`) 지금처럼 error. `prFiles`는 `changedFiles(root, base)`의 경로를 쓴다.
4. **자료 읽기**: `scripts/ci/gates.ts`의 `RunGatesOptions`에 읽기 함수 하나를 더한다(`approvalSuites(): Promise<Record<string, Suite[]> | null>`, `planReview`와 같은 꼴). PR 커밋 목록(`GET /repos/{repo}/pulls/{n}/commits`, 페이지 넘김. 250개 이상이면 `null`)과 커밋마다 check suite(`GET /repos/{repo}/commits/{sha}/check-suites`, 페이지 넘김, `app.id`·`head_branch`·`created_at`)를 읽는다. 하나라도 실패하면 `null`(fail-closed). `scripts/harness.ts`의 `gates` 명령이 `GH_TOKEN`·`--pr-number`로 그 함수를 만든다. PR head 브랜치 이름과 base ref(`origin/<base>`)는 `gates`가 이미 받는 값에서 쓴다(없으면 더한다). 위험도가 높음일 때만 읽는다.
5. **테스트**:
   - 새 파일 `scripts/test/risk-gate-approval.test.ts`:
     - `ownerApproval` 표 테스트: H0 = head(승인), H0 ≠ head이고 `carry`가 null(이어받음, `from`이 H0), `carry`가 이유(승인 아님, 이유가 실림), 리뷰가 옮겨진 `commitId`(지금 head)를 보고해도 H0가 다르면 `carry`를 거친다, 같은 초의 suite는 H0 후보가 아니다(리뷰 12:00:05, 새 head의 첫 suite 12:00:05 → H0는 앞 커밋), H0의 첫 suite가 제출 60초 안이면 승인 아님, 다른 브랜치·다른 App의 suite는 무시, 한 커밋의 suite가 여럿이면 가장 이른 것(승인 뒤 같은 커밋에 생긴 suite가 H0를 바꾸지 않는다), 마지막 판정 리뷰가 변경 요청, suite가 없음. PR #226의 실제 값(승인 `2026-11-25T04:36:27Z`, `5027f12`의 첫 suite `03:40:49Z`, `c5d5338` `2026-11-26T00:19:29Z`, `a1aae51` `03:09:08Z`)으로 H0가 `5027f12`인 경우 하나.
     - `ownerApprovalCarry` 실제 git 테스트(임시 리포, `origin/main` 역할의 ref): main에 PR과 겹치지 않는 커밋 → PR에 main 병합 → 이어받음. 빈 일반 커밋 → (나). 바꿨다가 되돌린 일반 커밋 둘 → (나). main이 아닌 브랜치 병합 → (나). main이 PR 파일을 바꾼 뒤 병합 → (마). H0가 조상이 아님(다른 줄기) → (가). 병합 커밋에서 PR 파일을 더 고침(evil merge) → (다) 또는 (라).
   - `scripts/test/risk-gate.test.ts`의 있던 테스트는 새 입력으로 맞추되 단언(승인·실패·error의 경우)은 그대로 둔다.
   - `scripts/test/ci.test.ts`(또는 `gates`를 부르는 있던 테스트 파일): 위험도 높음 PR은 읽기 함수를 부르고 지금 설정(`harness.config.json`의 필수 체크 출처)과 `ACTIONS_APP_ID`의 suite로 정당한 승인이 success가 된다. 그 밖의 PR은 읽기 함수를 부르지 않는다.
6. **문서**: 설계서 10.3절(승인 결속)과 10.4절의 `risk-gate` 설명, 절차서 5절("위험도 높음", "승인 요청 전 조건")에 규칙을 적는다: 승인 뒤 main 병합만 더한 갱신은 승인을 이어받고, 그 밖의 커밋은 다시 승인받는다. 승인 head는 check suite 시각으로 정하고 승인 직전 60초 안에 head가 바뀌면 다시 승인받는다. 변경 조각 `docs/harness/changes/20261126-approval-binding-s0.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/risk-gate-approval.test.ts scripts/test/risk-gate.test.ts scripts/test/ci.test.ts
grep -q "제작자 head 승인 이어받음" scripts/gates/risk-gate.ts
grep -q "ACTIONS_APP_ID" scripts/gates/risk-gate.ts
grep -q "export function ownerApprovalCarry" scripts/ci/binding.ts
test -z "$(grep -nE 'commitId === ' scripts/gates/risk-gate.ts)"
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s0.md
node scripts/harness.ts check
```

## 금지사항

- 워크플로 파일(`.github/workflows/`)을 고치지 마라. 이유: 봇은 워크플로를 push할 수 없고, 판정 job의 지금 권한으로 할 수 있다.
- 리뷰의 `commitId`로 승인 head를 정하지 마라. 이유: GitHub이 그 값을 새 head로 옮겨 보고한다(PR #226).
- 자료를 읽지 못했거나 승인 head가 모호할 때 승인으로 보지 마라. 이유: fail-closed.
- 위험도가 높음이 아닌 PR에서 추가 API를 부르지 마라. 이유: 판정 job 시간과 API 사용량.
- 검증자 승인 이어받기(`review/*`, `carryOver`)의 규칙을 바꾸지 마라. 이유: 범위 밖이다. `patchId`의 기본 동작도 그대로 둔다.
