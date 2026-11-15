---
id: 20261115-no-push-after-approval
issue: 64 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-15T10:36:14+09:00
---

# docs: 승인을 요청한 PR에 추가 커밋을 올리지 않는다(AGENTS.md)

- 목표: 제작자 승인을 요청한 PR에 에이전트가 커밋을 더 올려 승인이 철회되는 일(PR #62·#63)을 규칙으로 막는다. 제작자 대화 지시(2026-11-15).
- 변경: `AGENTS.md` 작업 루프 6번(PR)에 "승인을 요청한 PR에는 커밋을 더 올리지 않는다. 꼭 올려야 하면 push 전에 제작자에게 먼저 알린다"를 더한다. `docs/harness/CHANGELOG.md` 한 줄.
- 검증: `grep -q "승인을 요청한 PR" AGENTS.md`, `node scripts/harness.ts check`

## 관련 파일·문서

- AGENTS.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/active/20261115-no-push-after-approval.md
