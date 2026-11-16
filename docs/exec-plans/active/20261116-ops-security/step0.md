# Step 0: revert-check

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 1, 의사결정 로그의 revert-check 결정 세 건)
- `docs/harness/design.md` 10.3절(필수 상태 체크 표, "병합 후 main CI가 실패하면"), 10.4절(CI 작업 분리, 판정 시작과 입력)
- `scripts/ci/gates.ts`, `scripts/ci/results.ts`, `scripts/ci/review-plan.ts`, `scripts/ci/pr.ts`(`githubGet`), `scripts/ci/protection.ts`(`ACTIONS_APP_ID`)
- `scripts/gates/plan-gate.ts`, `scripts/gates/harness-guard.ts`, `scripts/gates/risk-gate.ts`(`changedFiles`)
- `scripts/harness.ts`의 `gates`·`review-plan`·`record-status` 명령
- `.github/workflows/gates.yml`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`(`plan` job)
- `scripts/test/gates.test.ts`, `scripts/test/helpers.ts`

## 작업

1. `scripts/gates/revert-check.ts`(순수 함수. git은 `root`에서 읽기만 한다)

   ```ts
   /** 대상 커밋의 main `check` 최신 결론. 조회하지 못했으면 null */
   export type TargetCheck = 'failure' | 'success' | 'none' | null;
   export interface RevertCheck {
     /** 브랜치가 revert/<40자 소문자 hex>인가 */
     applies: boolean;
     /** 정확한 역적용이고 대상의 main check가 실패했는가 */
     verified: boolean;
     target: string | null;
     state: 'success' | 'failure' | 'error';
     description: string;
     details: string[];
   }
   export function revertTarget(branch: string): string | null;
   export function revertCheck(o: {
     root: string;
     /** PR head와 base 브랜치의 merge-base */
     base: string;
     branch: string;
     targetCheck: TargetCheck;
   }): RevertCheck;
   ```

   - 브랜치가 `revert/<SHA>` 꼴이 아니면 `applies: false`, `state: 'success'`, 설명 "revert PR 아님".
   - `verified` 조건(모두): 대상이 `base`의 first-parent 이력에 있다. 대상의 부모가 하나다. `git diff --raw --no-renames --no-abbrev -z <base> HEAD`와 `git diff --raw --no-renames --no-abbrev -z <대상> <대상>^`의 항목 집합이 같다(경로·모드·blob SHA). `targetCheck`가 `'failure'`다.
   - `applies`인데 조건을 어기면 `state: 'failure'`이고 어긴 조건을 `details`에 한 줄씩 적는다(여분 파일, 빠진 파일, 내용이 다른 파일은 경로를 20개까지). `targetCheck`가 `null`이면 `state: 'error'`(fail-closed).
   - PR 유래 값(브랜치 이름, 경로)은 git 인자로 넘기기 전에 형식을 검사한다. 경로는 pathspec으로 넘기지 않는다.

2. 대상의 `check` 결론 조회: `scripts/ci/revert-evidence.ts`(이름은 재량)에 `targetCheckOf(api, repo, sha): Promise<TargetCheck>`. `GET repos/<repo>/commits/<sha>/check-runs`에서 이름이 `check`이고 App id가 `ACTIONS_APP_ID`인 run 가운데 가장 최근 것의 결론을 본다. `failure`·`timed_out`은 `'failure'`, `success`는 `'success'`, 없거나 진행 중·취소는 `'none'`, 조회 실패는 `null`.

3. `scripts/ci/results.ts`: `GATE_CONTEXTS`에 `'revert-check'`를 맨 앞에 더한다.

4. `scripts/ci/gates.ts`의 `runGates`
   - 옵션 `targetCheck?: () => Promise<TargetCheck>`(브랜치가 `revert/` 꼴일 때만 부른다. 주지 않으면 `null`).
   - `revert-check` 결과를 먼저 낸다. `verified`면 `plan-gate`는 계획을 보지 않고 success("revert PR: 계획 불필요")다. `harness-guard`는 작성자 체크리스트(`CHANGELOG`, PR 본문 줄)를 실패로 내지 않고 신호와 워크플로 검사(캐시, 재현 job)는 그대로 낸다(`harnessGuard`에 선택 인자를 더한다). `risk-gate`·`deps-guard`는 바꾸지 않는다.

5. `scripts/ci/review-plan.ts`의 `planReview`: 옵션으로 받은 `revert?: RevertCheck`가 `verified`면 `claude: false`, `codex: false`이고 `reasons`에 "revert-check가 확인한 revert PR"을 넣는다. 위험도 계산은 그대로 한다.

6. `scripts/harness.ts`: `gates`와 `review-plan` 명령이 브랜치가 `revert/` 꼴일 때 `GH_TOKEN`과 리포 이름으로 `targetCheckOf`를 불러 위 옵션에 넘긴다. 도움말을 고친다.

7. 워크플로: `gates.yml`의 `evaluate` job과 `judge-claude.yml`·`judge-codex.yml`의 `plan` job 권한에 `checks: read`를 더한다. `review-plan` 호출에 리포 이름이 없으면 env로 넘긴다. 그 밖의 줄은 바꾸지 않는다.

8. 테스트(새 파일 `scripts/test/revert-check.test.ts`, `gates.test.ts`에 더한다)
   - 임시 git 리포에서: 정확한 역적용은 `verified`. 여분 파일을 더한 PR, 일부만 되돌린 PR, 내용이 한 바이트 다른 PR, 실행 권한만 다른 PR은 실패. main이 대상 뒤로 나아갔고 겹치지 않으면 `verified`, 대상이 바꾼 파일을 뒤 커밋이 다시 바꿨으면 실패. 대상이 first-parent 이력에 없거나 병합 커밋이면 실패. `targetCheck`가 `success`·`none`이면 실패, `null`이면 `error`.
   - `runGates`: 확인된 revert PR은 계획 없이 `plan-gate` success이고 `harness-guard`가 `CHANGELOG` 누락으로 실패하지 않는다. 훅을 더한 커밋의 revert(훅 삭제가 된다)는 신호가 남아 `risk-gate`가 높음이다. 확인되지 않은 `revert/` PR은 `revert-check` 실패이고 `plan-gate`도 평소대로 실패한다.
   - `planReview`: 확인된 revert는 두 검증자 모두 false.
   - `targetCheckOf`: 다른 App의 같은 이름 run, 이름이 다른 run은 무시한다. 여러 run 가운데 최신을 고른다.
   - `validateResults`·`toStatuses`가 새 context를 받는다.

9. 문서: 설계서 10.3절(표의 `revert-check` 행, 구현 문단: 판정 조건·면제 범위·증거 출처), 10.4절 CI 작업 분리 표, 설계서 버전·변경 이력, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`.

## Acceptance Criteria

```bash
node --test scripts/test/revert-check.test.ts scripts/test/gates.test.ts scripts/test/record.test.ts scripts/test/ci.test.ts
grep -q "export function revertCheck" scripts/gates/revert-check.ts
grep -q "'revert-check'" scripts/ci/results.ts
grep -q "checks: read" .github/workflows/gates.yml
! grep -n "revert-check" harness.config.json
```

## 금지사항

- 역적용 판정에 `git patch-id`나 줄 단위 diff 비교를 쓰지 마라. 이유: 공백·줄 위치를 무시해 정확한 역적용이 아닌 변경이 통과한다.
- 대상의 `check` 실패 근거로 커밋 상태(status)나 체크 요약 API를 쓰지 마라. 이유: 봇 PAT도 같은 이름의 상태를 쓸 수 있고 요약은 출처를 보지 않는다(10.3절).
- 확인된 revert PR에서 `risk-gate`·`deps-guard`·`harness-guard` 신호를 면제하지 마라. 이유: 보호 장치를 더한 커밋의 revert는 완화이고 제작자 승인으로 가야 한다.
- `harness.config.json`을 바꾸지 마라. 이유: `ci.requiredChecks` 변경은 step4에서 한 번에 한다(계획 의사결정 로그).
- 워크플로에 쓰기 권한·environment·캐시를 더하지 마라. 이유: 이 step에 필요한 것은 check run 읽기뿐이다.
