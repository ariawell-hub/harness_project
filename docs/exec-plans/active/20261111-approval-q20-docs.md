---
id: 20261111-approval-q20-docs
issue: 3 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-11T17:06:06+09:00
---

# docs: 구축 단계 승인 설정 반영과 Q20 시험 리포 운영 결정 기록

- 목표: 제작자가 바꾼 main 승인 설정과 제작자가 정한 Q20 시험 리포 운영 방식을 리포 문서에 기록한다(B1). 대화 세션의 브라우저 도구가 L1 훅 밖에 있는 문제를 TD로 남긴다.
- 변경: 설계서 0.2절·10.4절 운영 전환 체크리스트·Q20 행·변경 이력(v0.7.3), `docs/harness/CHANGELOG.md`, `README.md` 0단계, ADR-0004 신설과 ADR-0003·ADR 목차 연결, `tech-debt-tracker.md` TD-13.
- 검증: `node scripts/harness.ts check`가 통과하고, 이 PR이 필수 체크 통과만으로 사람 승인 없이 자동 병합된다.
- 결정(제작자, 대화 2026-11-11): "Require approval of the most recent reviewable push"는 구축·운영 단계 모두 끈다. 이유: 필수 승인이 0이어도 모든 PR에 사람 승인을 요구해 자동 병합을 막는다(PR #2). 제작자 승인의 head 결속은 "Dismiss stale approvals"와 `risk-gate`가 맡는다. 버린 대안: 운영 단계에서 다시 켜기(낮음·보통 PR까지 막힘), 운영 단계 결정 보류.
- 결정(제작자, 대화 2026-11-11): Q20 시험 리포는 시험 기간에만 봇을 Write로 초대하고 끝나면 철회한다(ADR-0004).

## 관련 파일·문서

- docs/harness/design.md
- docs/harness/CHANGELOG.md
- README.md
- docs/decisions/ADR-0003-bot-token-classic-pat.md
- docs/decisions/ADR-0004-q20-lab-repo.md
- docs/decisions/index.md
- docs/exec-plans/tech-debt-tracker.md
