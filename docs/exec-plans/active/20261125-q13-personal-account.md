---
id: 20261125-q13-personal-account
issue: 224 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: mac-session
claimed_at: 2026-11-25T00:45:08+09:00
---

# Q13 결정: 리포를 개인 계정에 둔다 — 설계서·ADR-0008에 적는다

- 목표: 제작자가 2026-11-23 대화에서 고른 Q13의 답(**개인 계정 유지**)을 설계서와 ADR-0008에 적어, Q13이 열린 질문으로 남지 않게 한다(Issue #224). 3단계 파일럿 착수 전에 정할 것(19절)이 Q13 하나 남아 있었다.
- 변경:
  - `docs/harness/design.md`: 18절 Q13 행을 결정으로 닫고 이유(1~2인이면 개인 계정 + Pro가 가장 싸고 Actions 포함 사용량은 Team과 같다)와 대가(외부 테스터에게 읽기·분류 권한만 주는 것은 못 한다. 피드백은 별도 리포나 폼. 조직 전용 러너 그룹·외부 러너 서비스도 쓰지 않는다)를 적는다. 14.6절 외부 테스터, 19절 "현재 위치"와 "단계별 선행 결정"을 결정에 맞춘다.
  - `docs/decisions/ADR-0008-actions-cost.md`: 후보 E2 행의 이름 칸에 결정을 적는다(칸 수와 다른 칸은 그대로, `lab/actions-cost/check-adr.ts` 통과).
  - 변경 조각 `docs/harness/changes/20261125-q13-personal-account.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄). 설계서 머리말·변경 이력과 CHANGELOG는 고치지 않는다(절차서 5절).
- 검증: `node lab/actions-cost/check-adr.ts --file docs/decisions/ADR-0008-actions-cost.md`, `grep -n "Q13" docs/harness/design.md docs/decisions/ADR-0008-actions-cost.md`로 Q13이 "남은 질문"·"열려 있다"로 남은 자리가 없는지 본다, `node scripts/harness.ts check`.

## 관련 파일·문서

- `docs/harness/design.md`
- `docs/decisions/ADR-0008-actions-cost.md`
- `docs/harness/changes/20261125-q13-personal-account.md`
- `docs/exec-plans/active/20261125-q13-personal-account.md`
- 읽기만: `docs/decisions/ADR-0007-db-postgres-drizzle.md`, `lab/actions-cost/check-adr.ts`, `docs/harness/workflow.md`

## 진행 로그

- 2026-11-25 접수: 제작자가 2026-11-23 대화에서 Q13을 "개인 계정 유지"로 정했고 봇이 Issue #224를 등록했다. 그때의 세션이 선점(`claim/224`)만 하고 브랜치를 올리지 않은 채 선점이 만료돼 있었다. 제작자가 2026-11-24 대화에서 이어 가라고 지시해 `mac-session`이 `new-task --no-claim`(같은 봇의 선점이 이미 있다)으로 시작하고 `claim-heartbeat`로 선점을 갱신했다.
- 2026-11-25 Q13을 가리키는 자리를 찾았다: 설계서 18절 Q13 행, 14.6절 외부 테스터, 19절 "현재 위치"·"단계별 선행 결정"(30·110행의 변경 이력과 부록 A 대조표는 기록이라 두었다), ADR-0008의 관련 줄·후보 E2 행, ADR-0007의 결과 절. 고친 곳은 위 "변경".
- 2026-11-25 검증: `check-adr` 통과(ADR-0008의 diff는 E2 행 한 줄), `grep -n Q13`으로 "남은 질문"·"열려 있다"가 설계서·ADR-0008에 남지 않은 것을 봤다. `check` 결과는 아래.

## 의사결정 로그

- 결정: ADR-0007의 "Q13은 열려 있다"(결과 절)는 고치지 않는다. / 이유: 채택된 ADR의 결과 절은 그 결정을 내린 날(2026-11-23)의 상태를 적은 기록이고, Issue #224가 고칠 곳으로 든 자리(14.6절, ADR-0008 E2)도 아니다. 지금 상태는 설계서 18·19절이 말한다. / 버린 대안: ADR-0007에 덧붙임 줄을 단다(채택된 ADR의 기록을 뒤에서 고치게 된다).
- 결정: 기록은 변경 조각으로 남긴다(절차서 5절, #227). / 이유: Issue는 "TD-39가 먼저 병합되면 조각 파일로"라고 적었고 #227이 병합됐다. 설계서 머리말을 고치는 다른 열린 PR(#217, v0.7.83)과 충돌하지 않는다.

## 발견 사항

없음.
