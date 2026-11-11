---
status: active
related_code: []
review_cycle: on-change
---

# 의사결정 기록(ADR)

결정 1건 = 파일 1개(`ADR-NNNN-<제목>.md`). 리포 밖(메신저, 회의)에서 정해진 결정도 정해지는 즉시 여기에 기록한다(B1).

| ADR                                           | 결정                                                                            | 상태      |
| --------------------------------------------- | ------------------------------------------------------------------------------- | --------- |
| [ADR-0001](ADR-0001-script-language.md)       | 하네스 공통 스크립트는 TypeScript, Node 22 내장 타입 제거로 빌드 없이 실행 (Q3) | 채택      |
| [ADR-0002](ADR-0002-codex-hooks-sandbox.md)   | Codex 훅·샌드박스 지원 범위와 runner 사용 방식 (Q4)                             | 일부 확인 |
| [ADR-0003](ADR-0003-bot-token-classic-pat.md) | 봇 토큰은 클래식 PAT, 리포 범위는 봇 초대 범위로 제한 (E1 예외)                 | 채택      |
| [ADR-0004](ADR-0004-q20-lab-repo.md)          | Q20 시험 리포에는 시험 기간에만 봇을 초대하고 끝나면 철회 (ADR-0003 예외)       | 채택      |
| [ADR-0005](ADR-0005-windows-native.md)        | macOS와 Windows 네이티브를 함께 쓴다(실행 셸, 줄바꿈, L1 셸 방언, E5 범위)      | 채택      |
