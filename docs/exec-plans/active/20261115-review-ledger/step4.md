# Step 4: plan-review

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 8, 의사결정 로그, 진행 로그)
- `docs/harness/design.md` 4.1절 G1, 4.3절, 8.2~8.3절, 10.3절 승인 결속 기준 표
- `scripts/gates/plan-gate.ts`, `scripts/ci/{gates,review-plan,ledger,ledger-store,record}.ts`, `.github/workflows/gates.yml`

## 작업

1. `scripts/ci/plan-hash.ts`: `planHash(root, planDir)`가 계획의 "목표와 수용 기준"·"범위 / 비범위"·"관련 파일·문서" 섹션과 모든 step 파일의 "작업"·"Acceptance Criteria" 섹션을 정규화(줄 끝 공백)해 sha256으로 낸다.
2. `review-plan`: PR이 바꾼 파일이 계획 폴더 안뿐이면 `mode=plan`과 `plan_hash`를 출력한다. 판정 job은 `mode=plan`일 때 `scripts/cross-review/prompt-plan.md`(계획 검증 항목: 수용 기준이 검증 가능한가, step 분할과 AC, 범위, 위험도)를 덧붙인다.
3. `record-review`: `mode=plan`이고 판정이 승인이면 원장 `planReview`에 `{ hash, head, approvals }`를 남긴다. 해시가 바뀌면 이전 승인을 지운다.
4. `plan-gate`: `planReview.required`이고 `size`가 small이 아니면 (a) merge-base의 같은 계획과 해시가 같으면 통과, (b) 아니면 원장(검증 App 봇 댓글)의 `planReview.hash`가 지금 해시와 같고 필요한 검증자가 모두 승인했으면 통과, (c) 그 밖은 실패. `gates`의 판정 job에 원장을 읽을 읽기 권한을 준다. 설정은 아직 `false`로 둔다(step5에서 켠다).
5. 테스트: 해시(진행 로그만 바뀌면 같다, AC가 바뀌면 다르다), `plan-gate`의 세 경로, 기록. 문서: 설계서 4.1·10.3절, 절차서 2절(계획 전용 커밋으로 먼저 올린다), `CHANGELOG`. step3의 실제 동작 확인 결과를 진행 로그에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/plan-hash.test.ts scripts/test/plan-gate.test.ts scripts/test/ledger.test.ts scripts/test/ci.test.ts
grep -q "export function planHash" scripts/ci/plan-hash.ts
test -f scripts/cross-review/prompt-plan.md
```

## 금지사항

- 이 step에서 `planReview.required`를 `true`로 바꾸지 마라. 이유: 실제 PR에서 확인하기 전에 켜면 모든 중·대 규모 PR이 막힌다.
- 코드 변경이 섞인 커밋의 판정을 계획 승인으로 기록하지 마라. 이유: G1은 코드보다 먼저 설계를 본다(4.1절).
