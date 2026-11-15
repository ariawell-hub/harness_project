---
id: 20261115-codex-auth-setup
issue: 73 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-15T14:37:38+09:00
---

# docs: Codex CI 인증 등록 절차와 흔한 실수

- 목표: Codex CI 인증의 등록 절차와 흔한 실수를 `docs/SECURITY.md`에 적는다(Issue #73).
- 변경: `docs/SECURITY.md`에 "Codex CI 인증 등록 (제작자)" 절. `docs/harness/CHANGELOG.md` 한 줄.
- 검증: `grep -q "Codex CI 인증 등록" docs/SECURITY.md`, `node scripts/harness.ts check`.

## 관련 파일·문서

- docs/SECURITY.md
- docs/harness/CHANGELOG.md

## 진행 로그

- 2026-11-15: 오류 문구는 `scripts/ci/codex-auth.ts`의 `parseAuth`와 맞췄다. 정상 줄은 실행 43681655728의 로그에서 확인했다.

## 발견 사항

- 없음
