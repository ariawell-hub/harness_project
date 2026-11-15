---
id: 20261115-td-check-pipe
issue: 74 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-15T14:38:11+09:00
---

# docs: check 실패를 파이프가 가리는 문제를 기술 부채로 등록

- 목표: `check` 실패를 파이프가 가리는 문제를 도구로 막을 방법을 기술 부채 TD-29로 등록한다(Issue #74).
- 변경: `docs/exec-plans/tech-debt-tracker.md`에 TD-29 행.
- 검증: `grep -q "TD-29" docs/exec-plans/tech-debt-tracker.md`, `node scripts/harness.ts check`.

## 관련 파일·문서

- docs/exec-plans/tech-debt-tracker.md

## 진행 로그

- 2026-11-15: TD-29 등록. 이 PR은 #54 step4의 승인 이어받기 실제 확인에 쓴다. 두 검증자 승인 뒤 바로 병합하지 않고, main이 한 번 나아간 뒤 `origin/main`을 병합해 이어받기 기록을 본다. 결과는 #54 계획 진행 로그에 남긴다.

## 발견 사항

- 없음
