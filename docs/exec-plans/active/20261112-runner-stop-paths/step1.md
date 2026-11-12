# Step 1: step-questions

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-runner-stop-paths/plan.md` (수용 기준, 의사결정 로그)
- `docs/harness/workflow.md` 7절, `docs/harness/design.md` 4.5절·9.1절
- `scripts/runner/run.ts` `askQuestions`·`QuestionState`·`doPlanning`(질문 처리)·`doStep`·`doAnswered`
- `scripts/runner/prompt.ts` `stepPrompt`, `scripts/test/fake-agent.ts`, `scripts/test/runner.test.ts`(TD-18 테스트)

## 작업

1. `scripts/runner/run.ts`
   - `QuestionState`에 `stage: 'plan' | 'step'`(없으면 `plan`)을 더한다.
   - `askQuestions`가 단계를 받아 댓글 문구를 나눈다(step이면 "step N 세션이 질문을 남겼다. 답을 받으면 답을 넣어 그 step을 이어 간다").
   - `doStep`: 세션이 끝나고 환경 장애가 아니면, 판정 전에 계획 파일의 `openQuestions`에서 `reported`에 없는 질문을 본다. 있으면 `askQuestions(..., 'step')`하고 `'blocked'`를 돌려준다. AC·check를 돌리지 않고 실패를 기록하지 않는다.
   - `doAnswered`: `waiting`이고 `stage`가 `step`이면 `waiting: false`, 계획 `active`, step `in_progress`(답 파일은 이미 쓴다). `plan`이면 지금처럼 `draft`.
2. `scripts/runner/prompt.ts` `stepPrompt`: 질문 안내 한 절(제작자에게 반드시 물어야 할 것만 `### 질문:` 형식으로 적고 멈춘다. runner가 올리고 답을 받을 때까지 이 step을 멈춘다. 추천안으로 진행할 판단은 의사결정 로그).
3. `scripts/test/fake-agent.ts`: step 동작 `question`(계획의 "열린 질문"에 `### 질문: 스텝 질문` 블록을 남기고 아무것도 커밋하지 않는다).
4. 테스트(먼저 실패 확인): `runner.test.ts` — step0 `['question', 'ok']`인 Issue로 runner: 정지 `human`, `needs-human`, 멘션·`스텝 질문` 댓글 1개, AC 실패 기록 없음. 다시 돌려도 댓글이 늘지 않는다. 제작자 답 뒤 `idle`, Issue 닫힘, 두 번째 step0 프롬프트에 답 문구.
5. 문서: 설계서 4.5절·9.1절, v0.7.15 이력, 절차서 7절, CHANGELOG, TD-24 해결.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts
grep -q "stage" scripts/runner/run.ts
grep -q "v0.7.15" docs/harness/design.md
grep -q "TD-24.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 질문이 있는 step을 AC로 판정하거나 실패로 세지 마라. 이유: 제작자 결정이 필요한 일을 실패 반복으로 다루게 된다(TD-24의 원인).
- 계획 작성 단계 질문의 동작을 바꾸지 마라. 이유: TD-18로 이미 동작한다.
