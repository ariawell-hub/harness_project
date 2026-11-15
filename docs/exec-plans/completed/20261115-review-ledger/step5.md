# Step 5: verify-register

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 9, 진행 로그 전체)
- `docs/harness/design.md` 0.2절 필수 체크, 10.2절, 10.3절
- `harness.config.json`의 `ci`·`planReview`, `scripts/ci/protection.ts`, `scripts/commands/init.ts`

## 작업

1. 실제 PR에서 확인해 진행 로그에 남긴다: 원장 댓글(작성자 = 검증 App), 2라운드의 상태 전이와 동결, 반박 전달, 재현 job 결과, `review-ledger` 상태, 계획 전용 커밋의 계획 검증과 `plan-gate`. 기대와 다른 것은 이 step에서 고친다.
2. `ci.requiredChecks`에 `review-ledger`(recorder)를 더하고, `init` 안내 목록에 넣는다.
3. 제작자에게 한 번에 요청한다(진행 로그에 기록): `review-ledger`를 검증 App 출처의 필수 체크로 등록. 1이 확인된 뒤에만 요청한다. 등록 뒤 `required-checks` 통과를 확인한다.
4. `planReview.required: true`로 켠다. 켠 뒤 이 PR의 `plan-gate`가 통과하는지 본다(이 계획은 main의 것과 해시가 같다).
5. 문서: 설계서 0.2절 필수 체크 목록·10.1절(원장 전 로그 문장)·19절, 절차서 5절, TD-3 해결, TD-1 비고(③ 완료), `CHANGELOG`.

## Acceptance Criteria

```bash
node --test scripts/test/protection.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts
node scripts/harness.ts required-checks
grep -q '"required": true' harness.config.json
```

## 금지사항

- 실제 PR에서 `review-ledger`가 기록되는 것을 확인하기 전에 필수 체크 등록을 요청하지 마라. 이유: 아무도 채우지 못하는 필수 체크는 모든 PR을 막는다.
- 필수 체크를 봇으로 등록하려 하지 마라. 이유: R20.
