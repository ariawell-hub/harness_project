---
id: 20261119-td-check-cache
issue: 131 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-19T14:07:11+09:00
---

# chore: PR #130의 미룬 P2(check 캐시와 도중 변경)와 남은 확인을 기술 부채 표에 적는다

- 목표: PR #130(Issue #129)에서 미룬 P2 두 건(원장 F5·F6, 같은 내용)과 아직 하지 못한 확인(CI에서 `test`를 실제로 건너뛰는지)이 세션이 바뀌어도 남게 기술 부채 표에 적는다(Issue #131).
- 변경: `docs/exec-plans/tech-debt-tracker.md` 한 파일. TD-52를 등록하고(`check` 캐시가 실행 도중 바뀐 작업 트리를 구분하지 못한다) TD-49의 ②에 PR #130의 결과와 남은 확인을 덧붙인다. 코드와 설정은 바꾸지 않는다.
- 검증: node scripts/harness.ts doc-lint
- 그 밖의 검증: `node scripts/harness.ts check`.

## 관련 파일·문서

- `docs/exec-plans/tech-debt-tracker.md`(TD-49, TD-52)
- PR #130의 지적 원장(F5·F6), Issue #129의 2026-11-19 댓글
- 계획 `20261119-test-skip-inert`

## 진행 로그

- 2026-11-19: PR #130이 병합된 뒤(04:56:36Z, 병합 커밋 `f9e49f7`) main의 `check`가 `test`를 전부 돌려 통과한 것을 확인했다(실행 44461732496, `test` 497.9초). 제작자 대화 지시("이어서 진행하라". 미룬 P2를 병합 뒤 등록하겠다고 보고한 뒤다)로 봇이 Issue #131을 등록하고 시작했다.
- 2026-11-19: TD-52를 등록하고 TD-49의 ②를 갱신했다.
- 2026-11-19: 이 PR은 기술 부채 표를 바꾸므로 `test`를 건너뛰지 않는다(표는 테스트 픽스처가 복사해 쓰는 파일이라 건너뛰기 목록에 없다). 건너뛰기의 CI 확인은 이 PR로 할 수 없다.

## 의사결정 로그

- 결정: 기록만 하는 PR을 따로 올린다. / 이유: 두 검증자가 따로 낸 지적이고, 지금 열린 다른 작업이 없어 묶을 PR이 없다. 자동 메모리를 쓰지 않아 표에 적지 않으면 다음 세션이 알 길이 없다. 비용은 판정 한 라운드(Actions 약 20분)다. / 버린 대안: 다음에 표를 고치는 PR에 묶기(언제인지 알 수 없고 잊힌다), F5·F6을 바로 고치기(`scripts/`는 보호 경로라 위험도 높음 PR이 한 번 더 든다. 로컬 캐시에만 해당해 급하지 않다).
- 결정: 건너뛰기의 CI 확인을 위한 PR을 일부러 만들지 않는다. / 이유: 확인만 하려는 PR도 판정 한 라운드가 든다. 건너뛰지 못해도 `test`가 도는 쪽이라 해가 없고, 계획 검증 PR처럼 계획 폴더만 바꾸는 PR이 생기면 그 로그로 확인된다. / 버린 대안: `lab/`에 기록 파일 하나를 더하는 확인용 PR.

## 발견 사항

- 없음
