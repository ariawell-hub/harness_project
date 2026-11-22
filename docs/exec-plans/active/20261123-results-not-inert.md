---
id: 20261123-results-not-inert
issue: 225 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-23T06:36:16+09:00
---

# 결과 파일(lab/q10-db/results/darwin-arm64.json)만 바꾼 PR이 test를 건너뛴다

- 목표: 실측 결과 파일 `lab/q10-db/results/darwin-arm64.json`만 바꾼 변경에서 `check`가 `test`를 건너뛰지 않게 한다. `scripts/test/profile-web-db.test.ts`의 "README의 DB 절: 확인한 버전이 실측 결과 파일과 같다"가 그 파일을 읽는데(PR #169부터), `lab/**`가 설정 `testInertPaths`(테스트가 읽지 않는 경로)에 들어 있고 그 파일은 보호 경로가 아니라서 그것만 바꾼 PR은 불일치를 병합 전에 잡지 못한다. PR #216(Issue #215)은 같은 꼴의 워크플로 패치를 고치면서 이 파일을 오히려 건너뛰기 대상으로 단언했다(봇의 실수). 같은 실수가 다시 나지 않게, 테스트가 적은 `lab/` 경로를 훑어 건너뛰기 대상이 아님을 보는 테스트를 더한다(Issue #225).
- 변경:
  - `harness.config.json`의 `protectedPaths`에 `lab/q10-db/results/darwin-arm64.json`을 더한다(#215와 같은 방법). 보호 경로는 `test` 건너뛰기 대상이 아니다(`scripts/commands/check.ts`의 `testInert`). 실측 결과는 ADR-0007의 근거라 바꾸려면 제작자 승인이 필요한 것이 맞다. `.github/CODEOWNERS`를 `node scripts/harness.ts codeowners --write`로 다시 만든다(절차서: `protectedPaths`를 바꾸면 같은 PR에서).
  - `scripts/test/check-skip.test.ts`의 "이 리포의 설정" 테스트에서 그 파일을 "테스트가 읽는 파일" 목록으로 옮긴다(건너뛰기 대상이 아님을 단언한다). 다른 결과 파일 `lab/q10-db/results/linux-x64.json`은 건너뛰기 대상으로 단언해 결과 폴더 전체가 빠지지 않았음을 본다.
  - 같은 파일에 테스트를 하나 더한다: `scripts/test/` 아래의 `.ts` 파일(이 테스트 파일은 뺀다. 픽스처의 경로를 적는다)이 따옴표 안에 적은 `lab/`로 시작하는 경로 가운데 리포에 있는 파일은 모두 건너뛰기 대상이 아니다. glob 글자가 든 글은 경로로 보지 않는다. 훑기가 헛돌지 않게 찾은 경로에 `lab/q10-db/results/darwin-arm64.json`이 들어 있는지도 본다.
  - `docs/harness/CHANGELOG.md`의 "다음 버전" 끝에 한 줄.
  - `lab/q10-db/README.md`의 "테스트가 읽는 파일" 문장: PR #188이 그 문장을 지금의 사실대로 고치면서 "결과 파일은 Issue #225"라고 적는다. #188이 먼저 병합되면 이 PR이 main을 병합해 그 문장을 "두 파일 모두 보호 경로"로 맞춘다. 이 PR이 먼저 병합되면 #188이 main을 병합할 때 맞춘다(그 계획에 적는다).
  - `testInertPaths`와 `check.ts`는 바꾸지 않는다.
- 검증: 테스트를 먼저 고쳐 실패를 확인한다(`node --test scripts/test/check-skip.test.ts`: 두 테스트가 결과 파일을 건너뛰기 대상으로 보고 실패한다). 설정을 고친 뒤 같은 명령이 통과한다. `node scripts/harness.ts codeowners`(검사)와 `node scripts/harness.ts check`, `node scripts/harness.ts self-test` 통과.

## 관련 파일·문서

- `harness.config.json`
- `.github/CODEOWNERS`
- `scripts/test/check-skip.test.ts`
- `docs/harness/CHANGELOG.md`
- `lab/q10-db/README.md`
- `docs/exec-plans/active/20261123-results-not-inert.md`
- 읽기만: `scripts/commands/check.ts`, `scripts/test/profile-web-db.test.ts`, `docs/exec-plans/completed/20261122-patch-not-inert.md`, `docs/harness/workflow.md`

## 진행 로그

- 2026-11-23 접수: PR #188(Issue #180)의 미룬 지적 F15(README의 "`scripts/test/`의 테스트는 `lab/`을 읽지 않는다"가 틀렸다)를 고치다가, 워크플로 패치 말고도 `profile-web-db.test.ts`가 `lab/q10-db/results/darwin-arm64.json`을 읽는 것을 찾았다. 그 파일은 건너뛰기 대상이다(F14와 같은 꼴). #188의 step은 `harness.config.json`을 고칠 수 없어, F14 때 제작자가 정한 방법(별도 PR로 먼저 고친다)을 따라 봇이 Issue #225를 등록하고 `new-task`로 시작했다.
- 2026-11-23 구현: 테스트를 먼저 고쳤다(`scripts/test/check-skip.test.ts`: "이 리포의 설정" 테스트에서 결과 파일을 "테스트가 읽는 파일"로 옮기고 `lab/q10-db/results/linux-x64.json`을 건너뛰기 대상으로 더했다. 따옴표 안의 `lab/` 경로를 훑는 테스트를 더했다). 설정을 고치기 전에 돌려 실패를 확인했다: 20건 가운데 그 두 테스트가 실패한다(둘 다 `lab/q10-db/results/darwin-arm64.json`이 건너뛰기 대상). 그 사이 PR #214가 병합돼 이 브랜치를 `origin/main`(`3e9e8b2`)으로 빨리 감았다(커밋 전이라 병합 커밋은 없다). 그 뒤 `harness.config.json`의 `protectedPaths`에 경로를 더하고 `codeowners --write`로 `.github/CODEOWNERS`를 다시 만들었다. CHANGELOG "다음 버전" 끝에 한 줄을 더했다(설계서 본문은 바뀌지 않는다). `lab/q10-db/README.md`는 PR #188이 병합된 뒤 맞춘다(아직 고치지 않았다).

## 의사결정 로그

- 결정: 그 결과 파일을 `protectedPaths`에 더한다(#215와 같은 방법). / 이유: `testInertPaths`에는 빼는 문법이 없고, `lab/**`를 폴더마다 나눠 적으면 새 폴더를 더할 때마다 고쳐야 한다. 실측 결과는 ADR-0007의 근거라 보호할 이유도 있다. / 버린 대안: 테스트가 결과 파일을 읽지 않게 한다(실측과 문서를 맞대는 테스트의 목적이 사라진다), 결과 폴더 전체(`lab/q10-db/results/**`)를 보호한다(테스트가 읽지 않는 결과 파일까지 제작자 승인이 필요해진다. Issue #180의 step1이 더할 Linux·Windows 결과 파일은 테스트가 읽지 않는다).
- 결정: 있던 테스트의 단언 하나를 바꾼다(`testInert('lab/q10-db/results/darwin-arm64.json')`의 기대를 `true`에서 `false`로 옮긴다). / 이유: 그 단언이 틀린 사실(테스트가 읽지 않는다)을 굳혀 두었고, 이 작업이 고치는 동작이 바로 그것이다. 단언을 지우지 않고 반대쪽 목록으로 옮기며, 건너뛰기 대상인 결과 파일의 단언은 다른 결과 파일로 남긴다(검사를 약화하지 않는다).
- 결정: 테스트가 적은 `lab/` 경로를 훑는 테스트를 더한다. / 이유: #215와 이번 일 모두 "테스트가 읽는 파일" 목록을 손으로 채우다 빠뜨렸다. 훑기는 따옴표 안의 경로 글만 보므로 경로를 조립해 읽는 테스트는 놓친다. 지금 그런 테스트는 없다(`scripts/test/`에서 `lab/`이 나오는 곳은 이 둘과 주석 하나다). / 버린 대안: 모든 테스트를 실제로 돌려 읽은 파일을 기록한다(비용이 크다).

## 발견 사항

- `lab/q10-db/README.md`와 `lab/pilot-prep/README.md`가 같은 문장("`scripts/test/`의 테스트는 `lab/`을 읽지 않는다")을 적었다. pilot-prep 폴더는 테스트가 읽지 않아(`verify-playwright.test.ts`의 주석에 이름만 나온다) 그쪽 문장은 맞다.
