---
id: 20261120-plan-fix-procedure
issue: 155 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-20T21:22:47+09:00
---

# 실행 중인 step의 작업을 고치는 계획 수정 경로가 없다 (plan-gate가 그 길에서 G1 해시를 확인하지 않는다)

- 목표: 실행 중인 step의 "작업"·"Acceptance Criteria"·"금지사항"을 고쳐야 할 때 어느 브랜치·PR로 올려 무엇이 계획 검증(G1)을 확인하는지를 절차서에 적는다(Issue #155의 1단계. 제작자 결정, 2026-11-20). Issue #146에서 절차가 없어 PR #154가 3라운드를 쓰고 닫혔고, PR #156의 길로 풀었다.
- 변경: `docs/harness/workflow.md` 2절 "계획 검증"에 "실행 중인 step의 계획 수정" 항목을 더한다(완료된 step 번호의 브랜치로 계획만 담은 PR을 올린다. 다른 계획의 PR에 섞지 않는다. 완료된 step이 없으면 멈춘다). `CHANGELOG` 한 줄. 기술 부채 표에 TD-61(완료된 step이 없을 때의 길, `plan-gate` 일반화)을 등록한다. 코드와 게이트는 바꾸지 않는다.
- 검증: grep -q "실행 중인 step의 계획 수정" docs/harness/workflow.md
- 그 밖의 검증: `node scripts/harness.ts check`.

## 관련 파일·문서

- `docs/harness/workflow.md`(2절), `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-61)
- 읽기만: `scripts/gates/plan-gate.ts`(PR 모드의 step 완료 확인, 결속 섹션 비교, G1), 계획 `20261119-metrics`의 진행 로그(PR #154, #156), Issue #155

## 진행 로그

- 2026-11-20 21:23 제작자 대화 지시("추천안이 모두 합리적으로 보인다. 그대로 진행해달라")로 시작했다. Issue #155는 봇이 앞서 등록한 것이다. `plan-gate.ts`를 읽어 절차가 기대는 판정을 확인했다: 브랜치의 step이 `completed`면 PR 모드를 통과하고, 그 step이 아닌 step 파일의 결속 섹션 변경은 문제 대신 "계획 수정(G1 재검증 대상)"으로 남으며, step 폴더 계획이면 G1(해시와 원장 승인)을 확인한다.
- 2026-11-20 21:23 절차서 2절에 항목을 더하고 `CHANGELOG` 한 줄과 TD-61을 적었다.
- 2026-11-21 13:17 앞선 PR(#162, #164, #168)이 병합될 때까지 push를 미뤘다(설계서·`CHANGELOG`·기술 부채 표를 고치는 PR은 한 번에 하나만 올린다). `origin/main`(`ef33a77`)을 병합했다. `CHANGELOG`와 기술 부채 표의 충돌은 main의 내용에 이 PR의 한 줄씩을 다시 넣어 풀었다. 절차서 2절은 자동으로 합쳐졌다(#168이 고친 3번 줄과 겹치지 않는다). main의 마지막 번호가 TD-60이라 TD-61을 그대로 쓴다. 다른 세션의 PR #169(초안)도 TD-61을 더한다. 먼저 병합되는 쪽이 번호를 갖고 뒤쪽이 다음 번호로 바꾼다.
- 2026-11-21 13:34 PR #173의 판정 1라운드: claude 승인, codex P1 둘. 둘 다 받아들였다. F1(기존 "코드를 이미 올린 PR" 길과 새 절차가 같은 경우에 겹친다): `plan-gate.ts`를 다시 읽어 자기 step 검사가 base(main)에 계획이 있을 때만 도는 것을 확인하고, 기존 길의 범위(계획이 아직 main에 없는 PR, 실행하는 step이 아닌 곳)와 새 절차의 범위(계획이 main에 있고 실행 중인 step)를 나눠 적었다. 그에 따라 "완료된 step이 없을 때"의 항목과 TD-61도 "계획이 main에 있는데 완료된 step이 없을 때"로 좁혔다. F2(계획 수정 PR의 초안 해제 단계가 없다): PR #156의 기록(초안 해제 → 자동 병합 → 병합)대로 `pr-ready` 단계를 더했다.

## 의사결정 로그

- 결정: 이미 돈 길(PR #156)을 절차로 적고 `plan-gate`는 고치지 않는다. / 이유: 그 길은 지금 게이트가 G1을 확인한다. 게이트를 일반화하면(계획 폴더만 바꾼 PR을 브랜치 이름과 무관하게 확인) 판정 경로가 하나 늘고, 파일럿 전에는 문서로 충분하다(제작자 결정). / 버린 대안: `plan-gate` 일반화(TD-61로 남겼다).
- 결정: 이 PR로 Issue #155를 닫고 남은 일은 TD-61로 옮긴다. / 이유: 봇이 등록한 Issue는 runner가 고르지 않아 열어 두면 잊힌다. 조건이 붙은 일("step0 실행 중에 필요해지면")은 기술 부채 표가 맞는 자리다. / 버린 대안: Issue를 열어 두기.
- 결정: 테스트를 더하지 않는다. / 이유: 동작이 바뀌지 않는다. 절차가 기대는 판정을 고정하는 테스트는 변경 전 코드에서도 통과해 `test-effect`(R5)에 맞지 않는다. / 버린 대안: `plan-gate`의 지금 동작을 고정하는 테스트.

## 발견 사항

- 없음
