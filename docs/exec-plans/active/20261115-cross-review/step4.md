# Step 4: verify-register

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-cross-review/plan.md` (수용 기준 4·6·7·8, 진행 로그의 step3 기록, 의사결정 로그)
- `docs/harness/design.md` 0.2절 필수 체크, 10.3절 승인 결속, 13.3절 Codex 인증
- `.github/workflows/judge-codex.yml`, `scripts/ci/{codex-auth,codex-scan,binding}.ts`, `scripts/ci/codex-probe.sh`
- `scripts/ci/protection.ts`, `harness.config.json`의 `ci`

## 작업

1. `judge-codex` 실제 실행 확인. 전제: 제작자가 `judge-codex` environment의 `CODEX_AUTH_JSON`을 다시 등록했다(step3에서 "JSON이 아니다"로 실패). 이 step의 PR에서 인증 복원 → 사전 측정 → 판정 → 유출 검사 → 봉인 → 저장 → `review/codex` 기록(작성자 = 검증 App)을 로그로 확인한다. 기대와 다른 단계는 이 step에서 고친다(고친 것은 다음 PR에서 돈다).
2. 승인 이어받기 실제 확인. 위험도 보통인 확인용 PR(문서 한 줄)에서 두 검증자 승인을 받은 뒤 `origin/main`을 병합해 갱신하고, 판정 job 없이 `이어받음 <sha> patch:<id>`가 기록되는지 본다. 공백만 바꾼 커밋은 다시 검증되는지도 본다.
3. 제작자에게 요청(진행 로그에 기록): `review/claude`·`review/codex`를 검증 App 출처의 필수 체크로 등록. 1·2가 확인된 뒤에만 요청한다. 등록 뒤 `required-checks` 통과를 확인한다(설정 `ci.requiredChecks`에는 step3이 이미 더했다).
4. step3 사전 점검이 남긴 P2 처리: `review-plan`의 이어받기 연결부를 API를 주입받는 함수로 빼서 테스트(조회 실패, 위험도 높음, 성공 경로의 출력), 확인용 PR에서 PR API의 `base.sha`가 main 최신을 가리키는지 확인(낡으면 base 브랜치 끝을 따로 조회), `init` 안내의 필수 체크 목록에 `review/*` 추가.
5. 문서: 설계서 0.2절 필수 체크 목록, 절차서 5절 필수 체크 문장, TD-1 비고(② 완료, Codex 갱신 관찰 여부), 진행 로그.

## Acceptance Criteria

```bash
node --test scripts/test/protection.test.ts scripts/test/binding.test.ts
node scripts/harness.ts required-checks
```

## 금지사항

- `judge-codex`가 실제 PR에서 판정을 내는 것을 확인하기 전에 `review/*`를 필수 체크로 등록해 달라고 요청하지 마라. 이유: 검증자가 고장 난 채 필수가 되면 모든 PR의 병합이 막힌다.
- 필수 체크를 봇으로 등록하려 하지 마라. 이유: R20.
- 시크릿 값을 읽거나 바꾸려 하지 마라. 이유: R20, R10. 봇은 이름과 갱신 시각만 본다.
