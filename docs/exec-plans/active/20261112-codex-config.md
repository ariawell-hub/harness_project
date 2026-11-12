---
id: 20261112-codex-config
issue: 25 # GitHub Issue 번호
type: chore # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-12T13:28:17+09:00
---

# chore: Codex 자동 승인 검토자 설정과 Codex용 new-task 스킬을 리포에 반영

- 목표: main 체크아웃에 커밋되지 않고 남아 있던 Codex 변경 두 개를 제작자 결정(2026-11-12 대화, "둘 다 리포에 반영")대로 정식 반영하고 결정을 기록한다(B1).
- 변경: `.codex/config.toml`에 `approvals_reviewer = "auto_review"`(Codex 대화 세션의 승인 요청을 Codex 자동 검토자가 판단), `.agents/skills/new-task/SKILL.md`(Codex용 new-task 스킬, `.claude/skills/new-task/SKILL.md`와 같은 내용) 추가. ADR-0002 결정에 한 줄, TD-8에 실제 동작 확인 항목, CHANGELOG 한 줄.
- 검증: `node scripts/harness.ts check` 통과, `diff .agents/skills/new-task/SKILL.md .claude/skills/new-task/SKILL.md`가 같다. 병합 뒤 main 체크아웃의 같은 내용 미커밋 변경은 제작자가 정리한다(fast-forward가 막히지 않게).

## 관련 파일·문서

- .codex/config.toml
- .agents/skills/new-task/SKILL.md
- docs/decisions/ADR-0002-codex-hooks-sandbox.md
- docs/exec-plans/tech-debt-tracker.md
- docs/harness/CHANGELOG.md

## 의사결정 로그

- 결정: `approvals_reviewer = "auto_review"`를 프로젝트 설정(보호 경로)으로 반영한다. / 이유: 제작자가 대화에서 "둘 다 리포에 반영"을 골랐다(권한 완화임을 알린 뒤). runner의 Codex 세션은 `approval_policy="never"`로 띄우므로 이 설정과 무관하다. / 버린 대안: 사용자 설정(`~/.codex/config.toml`)에만 두기(추천안이었으나 제작자가 고르지 않음), 버리기.
