---
id: 20261115-check-exit-code
issue: 72 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-15T14:37:33+09:00
---

# docs: push 전 check 결과는 종료 코드로 확인한다

- 목표: push 전 `check` 실패를 파이프가 가리는 실수를 절차서에 적는다(Issue #72).
- 변경: `docs/harness/workflow.md` 4절에 주의와 나쁜 예·좋은 예. `docs/harness/CHANGELOG.md` 한 줄.
- 검증: `grep -q "종료 코드로 확인" docs/harness/workflow.md`, `node scripts/harness.ts check`.

## 관련 파일·문서

- docs/harness/workflow.md
- docs/harness/CHANGELOG.md

## 진행 로그

- 2026-11-15: #54 step4에서 `check … | tail -1 && git push`로 실행해, 네트워크 끊김으로 `check`가 실패했는데 push가 이어졌다(실패한 push는 다시 했고 `check`는 다시 돌려 통과를 확인했다). 절차서에 적었다.

## 발견 사항

- 도구로 막는 방법(L1 훅)은 별도로 등록했다. → 처리: #74
