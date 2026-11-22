---
id: 20261122-patch-not-inert
issue: 215 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-22T21:30:10+09:00
---

# 워크플로 패치(lab/q10-db/q10-trial-workflow.patch)만 바꾼 PR이 test를 건너뛴다

- 목표: 워크플로 패치 `lab/q10-db/q10-trial-workflow.patch`만 바꾼 변경에서 `check`가 `test`를 건너뛰지 않게 한다. PR #188(Issue #180)이 더하는 구조 테스트 `scripts/test/q10-trial-workflow.test.ts`가 그 패치를 읽는데, `lab/**`가 설정 `testInertPaths`(테스트가 읽지 않는 경로)에 들어 있어 패치만 바꾼 PR은 불일치를 병합 전에 잡지 못한다(PR #188 판정의 F14. 그 PR 안에서는 고칠 수 없어 제작자가 별도 PR로 먼저 고치기로 정했다. Issue #215).
- 변경: `harness.config.json`의 `protectedPaths`에 `lab/q10-db/q10-trial-workflow.patch`를 더한다. 보호 경로는 `test` 건너뛰기 대상이 아니다(`scripts/commands/check.ts`의 `testInert`: `testInertPaths` 안이고 보호 경로가 아닐 때만 건너뛴다). 워크플로 파일의 원본이므로 바꾸려면 제작자 승인이 필요한 것이 맞다. `.github/CODEOWNERS`를 `node scripts/harness.ts codeowners --write`로 다시 만든다(절차서: `protectedPaths`를 바꾸면 같은 PR에서). `scripts/test/check-skip.test.ts`의 "이 리포의 설정" 테스트에서 "테스트가 읽는 파일" 목록에 그 경로를 더하고, `lab/` 아래의 다른 파일(`lab/q10-db/README.md`)이 여전히 건너뛰기 대상임을 단언한다. `docs/harness/CHANGELOG.md`에 한 줄. `testInertPaths`와 `check.ts`는 바꾸지 않는다. 이 경로의 파일은 아직 main에 없다(PR #188이 더한다). 설정의 경로는 파일이 없어도 된다.
- 검증: 테스트를 먼저 고쳐 실패를 확인한다(`node --test scripts/test/check-skip.test.ts`: 그 경로가 건너뛰기 대상으로 나온다). 설정을 고친 뒤 같은 명령이 통과한다. `node scripts/harness.ts codeowners`(검사)와 `node scripts/harness.ts check`, `node scripts/harness.ts self-test` 통과.

## 관련 파일·문서

- `harness.config.json`
- `.github/CODEOWNERS`
- `scripts/test/check-skip.test.ts`
- `docs/harness/CHANGELOG.md`
- `docs/exec-plans/active/20261122-patch-not-inert.md`
- 읽기만: `scripts/commands/check.ts`, `scripts/test/q10-trial-workflow.test.ts`(PR #188), `docs/harness/workflow.md`, `docs/SECURITY.md`

## 진행 로그

- 2026-11-22 접수: PR #188의 구현 판정에서 Codex가 낸 F14(P1, 재현됨)가 맞는 지적인데 그 PR 안에서 고칠 수 없어(step0의 금지사항이 `harness.config.json`을 막고, 계획을 고치려면 제작자가 올린 워크플로 파일을 봇이 되돌려야 한다) 제작자에게 물었고, 별도 PR로 먼저 고치기로 정했다(2026-11-22 대화). 봇이 Issue #215를 등록해 `new-task`로 시작했다.

## 의사결정 로그

- 결정: 그 패치 경로를 `testInertPaths`에서 빼는 대신 `protectedPaths`에 더한다. / 이유: `testInertPaths`에는 빼는 문법이 없고(glob의 목록), `lab/**`를 폴더마다 나눠 적으면 새 폴더를 더할 때마다 고쳐야 한다. 보호 경로는 이미 건너뛰기 대상에서 빠지고, 이 패치는 워크플로 파일의 원본이라 보호할 이유가 있다. / 버린 대안: `testInertPaths`에 제외 문법을 더한다(코드 변경이 커진다), 패치를 `lab/` 밖으로 옮긴다(PR #188의 step이 경로를 정했다).

## 발견 사항

없음.
