# Step 6: bind-prohibitions

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 8, 의사결정 로그의 "금지사항" 항목, 발견 사항의 PR #87 F2)
- `docs/harness/design.md` 8.2절(step 설계 원칙 아래의 자기 step 규칙), 10.3절 승인 결속 기준과 "계획 검증(G1) 구현"
- `scripts/ci/plan-hash.ts`, `scripts/gates/plan-gate.ts`(자기 step 불변 규칙, `checkG1`), `scripts/lib/plan.ts`
- 앞 step에서 만든·바꾼 파일: `scripts/test/plan-hash.test.ts`, `scripts/test/plan-gate.test.ts`, `scripts/test/gates.test.ts`의 `plan-gate` 테스트

## 작업

1. `scripts/lib/plan.ts`에 step 파일에서 승인에 묶이는 섹션 목록을 export한다: `STEP_BOUND_SECTIONS = ['작업', 'Acceptance Criteria', '금지사항']`. 목록은 이 한 곳에만 둔다(`gates/`는 `ci/`를 import하지 않으므로 `lib/`에 둔다).
2. `scripts/ci/plan-hash.ts`의 `planHash`·`planHashAt`이 step 파일마다 그 목록의 섹션을 해시에 넣는다. "금지사항" 섹션이 없는 step 파일은 빈 본문으로 넣는다. "읽어야 할 파일"은 넣지 않는다. `plan.md` 쪽 대상 섹션과 해시 형식(이름·본문 목록의 JSON, sha256)은 그대로 둔다.
3. `scripts/gates/plan-gate.ts`의 자기 step 불변 규칙이 같은 목록을 쓴다. 이 PR이 실행하는 step의 "금지사항"을 고치거나 지우면 실패하고, 다른 step의 것이면 지금처럼 계획 수정 참고로 남긴다(그쪽은 G1이 해시로 본다). G1 실패 안내 문구에 금지사항을 넣는다.
4. 테스트를 먼저 쓴다.
   - `plan-hash.test.ts`: step의 금지사항을 고치면 해시가 다르다, 금지사항 섹션을 지우면 다르다, "읽어야 할 파일"만 고치면 같다. 지금 있는 "금지사항을 고쳐도 해시가 같다" 단언은 뒤집는다(구현만 바꾸고 테스트를 두면 AC가 실패한다).
   - `plan-gate.test.ts`: 계획 승인 뒤 다른 step의 금지사항을 고치면 G1 실패.
   - `gates.test.ts`: 자기 step의 금지사항을 지우거나 고친 PR은 실패, 다른 step이면 실패 없이 참고만.
5. 문서: 설계서 8.2절(자기 step 규칙과 이유)·8.3절(계획 전용 커밋 조건)·10.3절(필수 체크 표의 `plan-gate` 행, 승인 결속 기준 표의 G1 행, 해시 구현 문단), 절차서 2절의 두 문장, runner 프롬프트(`scripts/runner/prompt.ts`)의 "고치지 마라" 문구, `CHANGELOG`.
6. 병합 전에 열린 PR 가운데 원장에 계획 승인(`planReview`)이 기록된 것이 있는지 확인해 진행 로그에 남긴다. 해시 정의가 바뀌면 그 승인은 무효가 되어 다시 검증받아야 한다.

## Acceptance Criteria

```bash
node --test scripts/test/plan-hash.test.ts scripts/test/plan-gate.test.ts scripts/test/gates.test.ts
grep -q "STEP_BOUND_SECTIONS" scripts/ci/plan-hash.ts
grep -q "STEP_BOUND_SECTIONS" scripts/gates/plan-gate.ts
```

## 금지사항

- "읽어야 할 파일"을 해시나 자기 step 불변 규칙에 넣지 마라. 이유: 안내이고 구현 중에 자주 고친다. 넣으면 고칠 때마다 계획을 다시 검증받는다.
- 검증 프롬프트(`scripts/cross-review/prompt.md`, `prompt-plan.md`)를 고치지 마라. 이유: 프롬프트는 이미 금지사항까지 읽으라고 한다. 어긋난 쪽은 해시다.
- step 섹션 목록을 `plan-hash.ts`와 `plan-gate.ts`에 따로 적지 마라. 이유: 두 곳이 어긋나면 해시에는 있는데 자기 step 규칙에는 없는 섹션이 생긴다.
