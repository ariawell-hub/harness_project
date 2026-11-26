---
id: 20261126-td-duplicate-ids
issue: 251 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-26T13:01:00+09:00 # new-task가 채운다
---

# 기술 부채 표에 TD-70·TD-71이 두 번씩 있다 — 번호를 고치고 doc-lint가 겹친 id를 막는다

## 목표와 수용 기준

main의 `docs/exec-plans/tech-debt-tracker.md`에 같은 id가 두 행씩 있다. TD-70은 `lab/` 스크립트의 링크 경로 문제(#246, 76행)와 Windows `pnpm --version` 감지 문제(#236, 77행), TD-71은 `wrapper-options.test.ts` 시간 비율 테스트의 흔들림(#246, 78행)과 Windows 테스트 성능의 남은 몫(#236, 79행)이다. #236과 #246이 각자 `origin/main` 기준 다음 번호를 썼고, 행을 넣은 자리가 달라 git이 충돌 없이 합쳤다. 계획·변경 조각의 `TD-70`·`TD-71` 참조가 어느 행인지 가릴 수 없다(PR #242 Codex 판정 P2도 같은 지적). 새 행 번호가 겹치는 일 자체는 PR #242가 기술 부채로 등록한다(TD-72).

수용 기준:

1. 나중에 병합된 #246의 두 행을 TD-76(`lab/` 스크립트)·TD-77(시간 비율 테스트)로 옮긴다. TD-72~75는 열린 PR(#242: TD-72·73, #229: TD-74·75)이 쓰고 있어 건너뛴다. 먼저 병합된 #236의 TD-70·71은 그대로 둔다.
2. #246이 남긴 참조를 새 번호로 맞춘다: 계획 `docs/exec-plans/completed/20261125-symlink-main/plan.md`의 발견 사항 두 줄(`→ 처리: TD-70`, `→ 처리: TD-71`), 변경 조각 `docs/harness/changes/20261125-symlink-main-s0.md`의 `TD-70`(과 `TD-71`이 있으면 그것). #236의 참조는 바꾸지 않는다.
3. `doc-lint`가 기술 부채 표(`docs/exec-plans/tech-debt-tracker.md`)에서 같은 id(`| TD-<번호> |`로 시작하는 행의 첫 칸)가 두 번 이상 나오면 오류(`R8 기술 부채 id`)를 낸다. 오류 글에 그 id와 행 번호들이 있다. 표가 문서 목록에 없으면 보지 않는다.
4. 고친 뒤 이 리포에서 `node scripts/harness.ts doc-lint`가 통과한다.

## 범위 / 비범위

범위: 기술 부채 표의 두 행 번호, #246의 계획·변경 조각 참조, `doc-lint`의 새 검사와 테스트, 이 PR의 변경 조각.

비범위:

- 새 행 번호를 정하는 방법을 바꾸는 일(TD-72, PR #242).
- 표의 내용·상태를 고치는 일.
- 다른 문서의 id 중복(ADR 번호 등).

## 관련 파일·문서

- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/completed/20261125-symlink-main/plan.md`
- `docs/harness/changes/20261125-symlink-main-s0.md`
- `scripts/gates/doc-lint.ts`
- `scripts/test/doc-lint-td-ids.test.ts`
- `docs/harness/changes/20261126-td-duplicate-ids-s0.md`
- `docs/exec-plans/active/20261126-td-duplicate-ids/**`
- 읽기만: `scripts/test/changes.test.ts`(임시 리포 도우미 `lintRepo`), `scripts/test/helpers.ts`, `docs/exec-plans/completed/20261123-windows-test-speed/plan.md`

## step 목록

- step0 unique-ids: `doc-lint` 검사와 테스트를 먼저 쓰고, 두 행의 번호와 #246의 참조를 고친다.

## 진행 로그

- 2026-11-26 접수: 제작자가 대화에서 남은 지적을 Issue로 열어 고치라고 지시했고 봇이 Issue #251을 등록했다. `new-task --issue 251 --slug td-duplicate-ids --type fix --size medium --risk high`로 시작했다(main `4816af5`).
- 2026-11-26 읽은 것: main의 표 76~79행(TD-70 둘, TD-71 둘). #246의 참조는 계획 92·93행과 변경 조각 한 곳, #236의 참조는 `windows-test-speed` 계획 113행. 열린 PR이 더한 행 번호는 #242 TD-72·73, #229 TD-74·75다(나머지 열린 PR은 새 행을 더하지 않는다).

## 의사결정 로그

- 결정: 나중에 병합된 #246의 행을 옮긴다. / 이유: 먼저 병합된 번호를 다른 PR·문서가 먼저 가리켰을 가능성이 크다.
- 결정: 새 번호는 TD-76·77이다. / 이유: TD-72~75는 열린 PR이 쓰고 있다. 그 번호를 쓰면 바로 같은 충돌이 난다.
- 결정: `doc-lint`에 중복 id 검사를 더한다(오류). / 이유: 이번 중복은 git이 충돌 없이 합쳐 아무 검사에도 걸리지 않았다. 병합 전 `check`(그리고 main 병합 뒤 `check`)에서 잡는다. 번호를 정하는 방법 자체(TD-72)는 다루지 않는다.

## 발견 사항

없음.

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 `node scripts/harness.ts check`.

## 다음 할 일

1. 계획만 담은 초안 PR로 계획 검증(G1)을 받는다.
2. 승인 뒤 테스트를 먼저 쓰고 고친다.
