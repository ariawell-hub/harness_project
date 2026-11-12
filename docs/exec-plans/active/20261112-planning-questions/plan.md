---
id: 20261112-planning-questions
issue: 33 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T16:10:59+09:00 # new-task가 채운다
---

# fix: runner 계획 작성 세션의 열린 질문을 needs-human으로 올리고 멈춘다 (TD-18)

## 목표와 수용 기준

출처: Issue #33(제작자 대화 지시, 2026-11-12). runner의 계획 작성 세션이 "열린 질문"에 적은 질문이 `needs-human`·제작자 멘션 없이 묻히는 문제(TD-18)를 고친다. #5의 질문이 하루 동안 보이지 않았다. 무인 세션 규칙 "열린 질문에 적고 멈춰라"(설계서 9.1절)가 실제로 멈추게 한다.

수용 기준:

1. 계획 작성 세션 뒤 plan-gate를 통과한 계획의 "열린 질문"에 `### 질문: <한 줄>` 블록(절차서 7절 형식)이 있으면, runner는 계획을 `blocked`로 바꿔 커밋·push하고, Issue에 `needs-human` 라벨과 제작자 멘션 댓글(질문 블록 전문)을 남긴다. step 세션은 띄우지 않는다.
2. 같은 질문을 두 번 올리지 않는다. 답을 기다리는 동안 runner를 다시 돌려도 댓글이 늘지 않는다.
3. 제작자 계정의 답을 받으면 runner는 계획을 `draft`로 되돌리고 답을 넣어 계획 작성 세션을 다시 띄운다. 이미 올린 질문만 남아 있으면 다시 멈추지 않고 step으로 넘어간다. 새 질문이 생기면 그것만 다시 올린다.
4. `### 질문:` 블록이 없는 "열린 질문"(비어 있음, "없음", 준비 항목 목록)은 지금처럼 그대로 진행한다.
5. 테스트: 질문을 남기는 계획 작성 세션 → `human`으로 멈춤·라벨·멘션·댓글 1회 → 제작자 답 → 계획 재작성 프롬프트에 답 포함 → Issue 종료(옛 코드에서 실패). `openQuestions` 단위 테스트.
6. 설계서 4.5절·9.1절, 절차서 7절, 계획 작성 프롬프트가 이 동작을 설명한다. TD-18을 해결로 바꾼다.

## 범위 / 비범위

- 범위: `doPlanning`·`doAnswered`, 계획 작성 프롬프트, 열린 질문 추출 함수, 관련 테스트, 설계서·절차서·CHANGELOG·architecture.md·TD-18.
- 비범위: step 세션이 적은 열린 질문(지금은 AC 실패로 세다가 5회에 중단 보고로 올라간다. 새 TD로 남긴다), 대화 세션의 질문 흐름(대화에서 바로 묻는다), 봇 Issue 정책(#5), 다른 작업자 worktree 인계(TD-23, 제작자가 보류).

## 관련 파일·문서

- `scripts/runner/run.ts`, `scripts/runner/prompt.ts`, `scripts/lib/plan.ts`
- `scripts/test/runner.test.ts`, `scripts/test/fake-agent.ts`, `scripts/test/lib.test.ts`
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261112-planning-questions/`

## step 목록

- step0 planning-questions: 계획 작성 뒤 열린 질문을 Issue에 올리고 계획을 멈추며, 답을 받으면 답을 넣어 계획을 다시 작성한다. 문서를 맞춘다.

## 진행 로그

- 2026-11-12 16:11 (KST) `new-task --issue 33 --slug planning-questions --size medium --type fix`. 동작이 바뀌는 변경이라 medium(절차서 1절), step 하나.
- 2026-11-12 (KST) 먼저 실패한 테스트: runner 통합 테스트(계획 작성 세션이 `### 질문:`을 남김) → 기대 `human`, 실제 `idle`. 옛 코드는 질문을 무시하고 step·PR·병합까지 갔다. `lib.test.ts`는 `openQuestions` export가 없어 실패.
- 2026-11-12 (KST) 구현(커밋 `3929326`): `openQuestions`(lib/plan.ts), `askQuestions`·`questions.json`·`doPlanning`·`doAnswered`(runner/run.ts), `planningPrompt` 질문 안내·제작자 답변(runner/prompt.ts), 가짜 에이전트 `question` 동작. 전체 테스트 112개 통과.
- 2026-11-12 (KST) 문서: 설계서 v0.7.10(4.5절 실패와 대기, 9.1절 질문·알림 방법), 절차서 7절, TD-18 해결·TD-24 등록, CHANGELOG, architecture.md.

## 의사결정 로그

- 결정: 질문이 있으면 계획을 멈춘다(`blocked`). 추천안으로 진행하는 비차단 질문 형식은 만들지 않는다. / 이유: 절차서 7절·설계서 9.1절은 "반드시 묻는 것"만 질문으로 올리고 나머지는 추천안으로 진행해 의사결정 로그에 남기라고 한다. "열린 질문"의 `### 질문:`은 정의상 제작자 결정이 필요한 항목이고, 무인 세션 규칙도 "적고 멈춰라"다. runner는 그 계획만 멈추고 다른 일을 계속하므로 전체가 서지는 않는다. / 버린 대안: 질문만 올리고 계속 진행(`- 진행:` 줄이 있으면 비차단) — 파싱 규약이 하나 더 생기고, 제작자 결정이 필요한 항목을 runner가 기본값으로 구현해 버린다. #5가 이 형태였다.
- 결정: 답을 받으면 계획을 `draft`로 되돌려 계획 작성 세션을 다시 띄우고, 답을 프롬프트에 넣는다. / 이유: 계획 단계의 질문은 계획(step 구성·AC)을 바꿀 수 있는데, step 세션은 자기 step의 작업·AC를 고칠 수 없다(plan-gate). / 버린 대안: 지금 `doAnswered`처럼 `active`로 바꾸고 step으로 바로 넘어가기 — 답이 계획에 반영되지 않는다.
- 결정: 올린 질문 제목과 답 대기 여부를 worktree의 하네스 상태 폴더(`questions.json`)에 둔다. 다시 작성한 계획에 이미 올린 질문만 남아 있으면 진행한다. / 이유: 실패 기록(`attempts.jsonl`)·답(`answer.md`)과 같은 자리이고, 계획 파일을 이 용도로 더럽히지 않는다. 세션이 질문을 옮기지 않아도 같은 질문으로 무한히 멈추지 않는다. / 버린 대안: 계획 진행 로그에 표식 — 세션이 고칠 수 있는 파일이라 판정 근거로 약하다.
- 결정: 질문 블록은 "열린 질문" 섹션 안의 `### 질문:`으로 시작하는 줄부터 다음 `###` 또는 섹션 끝까지로 본다. / 이유: 절차서 7절 형식 그대로라 세션이 따로 배울 것이 없고, Q20 계획 같은 준비 항목 목록은 걸리지 않는다.

## 발견 사항

- step 세션도 같은 무인 세션 규칙("열린 질문에 적고 멈춰라")을 받지만 runner는 step 판정 전에 질문을 보지 않는다. AC 실패로 세다가 5회에 중단 보고로만 올라간다. → 처리: TD-24

## 열린 질문

- 없음. 무인 세션 규칙("열린 질문에 적고 멈춰라")과 설계서 9.1절("needs-human 라벨 + 제작자 멘션")을 runner가 실제로 지키게 하는 변경이라 규칙 변경이 아니다.

## 검증 방법과 결과

- step0 AC: `node --test scripts/test/lib.test.ts scripts/test/runner.test.ts`, `grep`으로 `openQuestions`·설계서 버전·TD-18 해결 확인, `node scripts/harness.ts check`. 결과: AC 4개 통과(테스트 20개), 전체 테스트 112개 통과.

## 다음 할 일

- step0 구현 → `check` → `complete-step` → PR(`Closes #33`).
