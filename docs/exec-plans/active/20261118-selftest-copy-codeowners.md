---
id: 20261118-selftest-copy-codeowners
issue: 121 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-18T16:02:53+09:00
---

# fix: stage: operation에서 selftest 테스트의 하네스 사본에 CODEOWNERS가 없어 check가 실패한다

- 목표: `harness.config.json`의 `stage`가 `operation`이어도 `scripts/test/selftest.test.ts`가 통과하게 한다(Issue #121). 지금은 그 테스트의 `copyHarness()`가 하네스 사본에 `.github/CODEOWNERS`를 넣지 않아, 운영 단계 설정을 물려받은 샘플 리포의 `check`가 CODEOWNERS 없음으로 실패하고 "runner가 AC 결과를 보지 않는 하네스" 테스트가 기대와 다른 단언에서 걸린다. 하네스 동작은 바꾸지 않는다(테스트 파일만).
- 변경: `scripts/test/selftest.test.ts` 한 파일. ① `copyHarness()`의 목록에 `.github/CODEOWNERS`를 더한다(실행기 `scripts/selftest/run.ts`의 복사 목록과 같게. 대상에 없으면 건너뛴다). ② runner 약화 테스트를 사본의 `stage`를 `build`와 `operation`으로 각각 고정해 두 번 돌린다. 이 리포의 `stage` 값이 무엇이든 두 단계가 모두 확인된다. `docs/harness/CHANGELOG.md` 한 줄(보호 경로 `scripts/`).
- 검증: node --test scripts/test/selftest.test.ts
- 그 밖의 검증: `node scripts/harness.ts check`. 수정 전 목록(①을 뺀 상태)에서 `operation` 쪽 테스트가 Issue에 적은 문구로 실패하는 것을 먼저 확인해 진행 로그에 적는다.
- 비범위: 실행기와 시나리오(`scripts/selftest/`)는 바꾸지 않는다(기존 자체 테스트 파일의 수정은 위험도 높음이고 이 결함과 무관하다). `stage` 전환 자체는 #102 step7의 일이다.

## 관련 파일·문서

- `scripts/test/selftest.test.ts`
- `scripts/selftest/run.ts`(복사 목록 `COPY`, 읽기만)
- `scripts/commands/check.ts`(doc-lint 단계의 CODEOWNERS 검사, 읽기만)
- `docs/harness/CHANGELOG.md`
- 계획 `20261116-ops-security`의 "열린 질문"과 진행 로그(2026-11-18 step6)

## 진행 로그

- 2026-11-18: 제작자 대화 지시("A로 진행")로 봇이 Issue #121을 등록하고 시작했다. 원인은 #102 step6의 세션이 임시 사본 두 개로 먼저 재현했다(`stage: operation` + runner 약화. CODEOWNERS를 함께 복사하면 기대한 문구, 빼면 다른 문구).
- 2026-11-18: 테스트를 먼저 바꿨다(runner 약화 테스트를 사본의 `stage`별로 두 번). `copyHarness()`를 고치기 전에 `node --test --test-name-pattern="runner가 AC 결과를 보지 않는" scripts/test/selftest.test.ts`를 돌렸다: `stage: build`는 통과, `stage: operation`은 실패했다(`AssertionError`, 받은 문구 `step 2개짜리 Issue가 닫히지 않았다 'open' !== 'closed'`, 약 18초). 목록에 `.github/CODEOWNERS`를 더한 뒤 둘 다 통과했다.
- 2026-11-18: 첫 `check`는 `test-effect`에서 실패했다(`scripts/test/selftest.test.ts: ineffective(base에서도 통과)`). 결함과 수정이 모두 그 테스트 파일 안에 있어, 수정된 테스트 파일을 변경 전 코드(테스트 밖)에서 돌리면 통과하는 것이 맞다. 의사결정 로그에 예외 줄을 적었다.

## 의사결정 로그

- test-effect 예외: `scripts/test/selftest.test.ts` @ `3000e19b569462532f712ecd13d46466c77f6ac9` — 사유: 결함(사본 목록에 CODEOWNERS 없음)과 수정이 모두 이 테스트 파일 안에 있어 변경 전 코드(테스트 밖)에서는 차이가 나지 않는다. 수정 전 목록에서는 `stage: operation` 쪽이 실패한 것을 진행 로그에 적었다.

- 결정: 새 테스트를 따로 더하지 않고 기존 runner 약화 테스트를 단계별로 두 번 돌린다(`build`, `operation`). / 이유: 이 리포가 운영 단계로 바뀐 뒤에도 구축 단계 설정의 확인이 남는다. 이 리포의 `stage`에 기대는 테스트가 이번 결함의 원인이었다. / 버린 대안: `operation`만 고정(구축 단계 확인이 사라진다), 리포의 값 그대로 한 번 + `operation` 한 번(전환 뒤 같은 것을 두 번 돈다).
- 결정: 실행기의 복사 목록을 내보내 테스트가 같이 쓰게 하지 않는다. / 이유: `scripts/selftest/`의 기존 파일을 고치면 위험도 높음(제작자 승인)이고, 두 목록은 뜻이 다르다(테스트 쪽은 설정 파일을 더 담고 `.claude`는 일부만 담는다). / 버린 대안: `COPY`를 export해 재사용.

## 발견 사항
