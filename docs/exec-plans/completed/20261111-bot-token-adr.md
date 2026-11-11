---
id: 20261111-bot-token-adr
issue: 1 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-11T15:30:41+09:00
---

# docs: 봇 토큰 방식 결정 기록과 봇·제작자 계정 설정

- 목표: 제작자와 이미 합의한 봇 토큰 방식(클래식 PAT, 봇은 이 리포에만 초대)을 ADR로 남기고, 자격증명 목록과 하네스 설정을 실제 계정에 맞춘다(B1).
- 변경: ADR-0003 추가와 ADR 목차 갱신, `docs/SECURITY.md` 봇 토큰 행 수정, `harness.config.json`의 `github.owner`=`ariawell-hub`·`github.bot`=`ariawell247`.
- 검증: `node scripts/harness.ts check`가 통과하고, worktree에서 `loadConfig`가 `owner`·`bot`을 읽는다. `start`는 main 체크아웃의 설정을 읽으므로, "github.owner(제작자 계정)가 비어 있어" 경고는 병합 뒤에 사라진다.

## 관련 파일·문서

- docs/decisions/ADR-0003-bot-token-classic-pat.md
- docs/decisions/index.md
- docs/SECURITY.md
- harness.config.json
- docs/harness/design.md (E1·E2·E5, 0.2절. 읽기만)
