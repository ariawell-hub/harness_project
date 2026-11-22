---
status: active
related_code: []
review_cycle: on-change
---

# 의사결정 기록(ADR)

결정 1건 = 파일 1개(`ADR-NNNN-<제목>.md`). 리포 밖(메신저, 회의)에서 정해진 결정도 정해지는 즉시 여기에 기록한다(B1).

| ADR                                           | 결정                                                                                      | 상태      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| [ADR-0001](ADR-0001-script-language.md)       | 하네스 공통 스크립트는 TypeScript, Node 22 내장 타입 제거로 빌드 없이 실행 (Q3)           | 채택      |
| [ADR-0002](ADR-0002-codex-hooks-sandbox.md)   | Codex 훅·샌드박스 지원 범위와 runner 사용 방식 (Q4)                                       | 일부 확인 |
| [ADR-0003](ADR-0003-bot-token-classic-pat.md) | 봇 토큰은 클래식 PAT, 리포 범위는 봇 초대 범위로 제한 (E1 예외)                           | 채택      |
| [ADR-0004](ADR-0004-q20-lab-repo.md)          | Q20 시험 리포에는 시험 기간에만 봇을 초대하고 끝나면 철회 (ADR-0003 예외)                 | 채택      |
| [ADR-0005](ADR-0005-windows-native.md)        | macOS와 Windows 네이티브를 함께 쓴다(실행 셸, 줄바꿈, L1 셸 방언, E5 범위)                | 채택      |
| [ADR-0006](ADR-0006-pr-update-merge.md)       | 뒤처진 PR은 rebase가 아니라 `origin/main` 병합 + 일반 push로 갱신 (R14 유지)              | 채택      |
| [ADR-0007](ADR-0007-db-postgres-drizzle.md)   | 파일럿 웹 프로젝트의 DB는 PostgreSQL + Drizzle, 일회용 DB는 내장 PostgreSQL(PGlite) (Q10) | 잠정      |
| [ADR-0008](ADR-0008-actions-cost.md)          | 비공개 리포의 Actions 비용: 예산에 견준 절감 수단의 후보표와 묶음 (Issue #170)            | 제안      |
