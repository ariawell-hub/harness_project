# Step 0: planning-questions

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-planning-questions/plan.md` (수용 기준, 의사결정 로그)
- `docs/harness/workflow.md` 7절(질문 형식), `docs/harness/design.md` 4.5절·9.1절
- `scripts/runner/run.ts` `doPlanning`, `doAnswered`, `blockPlan`, `doStep`의 `answer.md` 처리
- `scripts/runner/next.ts` `pickNext` 1번(답을 받은 needs-human)·3번(진행 중인 계획)
- `scripts/runner/prompt.ts` `planningPrompt`
- `scripts/lib/plan.ts` `sections`·`section`·`isBlank`
- `scripts/test/runner.test.ts` `setup`, `scripts/test/fake-agent.ts`

## 작업

1. `scripts/lib/plan.ts`에 `export function openQuestions(body: string): { title: string; text: string }[]`를 더한다. 계획 본문의 "열린 질문" 섹션(HTML 주석 제거)에서 `### 질문:`으로 시작하는 줄부터 다음 `###` 제목 또는 섹션 끝까지를 한 블록으로 돌려준다. `title`은 `### 질문:` 뒤의 한 줄(앞뒤 공백 제거), `text`는 블록 전문(끝 공백 제거). 섹션이 없거나 `### 질문:`이 없으면 `[]`.
2. `scripts/runner/run.ts`
   - worktree 하네스 상태 폴더(`harnessStateDir(info, 'worktree')`)의 `questions.json`(`{ reported: string[]; waiting: boolean }`)을 읽고 쓰는 작은 도우미를 둔다. 파일이 없거나 깨졌으면 `{ reported: [], waiting: false }`.
   - `doPlanning`: plan-gate를 통과한 뒤 계획 파일의 `openQuestions`를 본다. `reported`에 없는 질문이 있으면
     - `setPlanStatus(worktree, 'blocked', '열린 질문 N건: 제작자 답변 대기(#<issue>)')`(계획 작성 결과도 함께 커밋된다), 계획 브랜치를 일반 push(`gitTry`, 실패는 경고만),
     - 상태를 `{ reported: 기존 + 새 제목, waiting: true }`로 저장,
     - Issue에 `needs-human` 라벨을 달고 `@<github.owner>` 멘션 댓글을 남긴다. 댓글에는 계획 id·계획 파일 경로·브랜치, 답하는 법(이 Issue에 제작자 계정 댓글. runner가 답을 넣어 계획을 다시 작성하고 이어 간다), 새 질문 블록 전문을 넣는다. GitHub 실패는 경고만 남긴다.
     - `questions` 이벤트를 남기고 `'ok'`를 돌려준다. 계획을 `active`로 바꾸지 않는다.
     - 이미 올린 질문만 남아 있으면 지금처럼 진행한다(`questions-kept` 같은 이벤트로 남기기만 한다).
   - `doPlanning`은 worktree에 `answer.md`가 있으면 계획 작성 프롬프트에 넣는다(`planningPrompt`에 선택 인자 추가).
   - `doAnswered`: `questions.json`의 `waiting`이 `true`면 `answer.md`를 쓰고, 실패 횟수 초기화 기록(`RESET_KEY`)을 남기고, `setPlanStatus(worktree, 'draft', '제작자 답변 받음(#N): 계획에 반영한다')`, `waiting: false`로 저장한다. step 상태는 바꾸지 않는다. `waiting`이 아니면 지금 동작 그대로다.
3. `scripts/runner/prompt.ts` `planningPrompt`
   - 선택 인자 `answer?: string`. 있으면 "## 제작자 답변 (9.1절, 이 지시를 따른다)" 아래에 넣고, "답을 계획에 반영하고, 반영한 질문은 '열린 질문'에서 지우고 '의사결정 로그'에 결정/이유/버린 대안으로 옮겨라"를 덧붙인다.
   - 해야 할 일에 한 줄: 제작자에게 반드시 물어야 할 것(절차서 7절)만 "열린 질문"에 `### 질문: <한 줄>` 형식(선택지·영향·추천)으로 적는다. runner가 Issue에 `needs-human`과 제작자 멘션으로 올리고 답을 받을 때까지 계획을 멈춘다. 추천안으로 진행할 판단은 질문으로 적지 않고 "의사결정 로그"에 남긴다.
4. 테스트(먼저 실패를 확인하고 진행 로그에 남긴다)
   - `scripts/test/fake-agent.ts`: 계획 작성 동작 `question`을 더한다. `ok`와 같이 계획을 채우고 "## 열린 질문" 아래에 `### 질문: 데모 질문` 블록(선택지 2개 + 추천)을 넣는다.
   - `scripts/test/runner.test.ts`: 계획 작성 `['question', 'ok']`, step 1개인 Issue로 runner를 돌린다. 종료 `human`, Issue에 `needs-human`, `@maker`와 `데모 질문`이 든 댓글 1개, PR 없음, 원격 계획 브랜치의 계획 status `blocked`. 다시 돌려도 `human`이고 질문 댓글이 늘지 않는다. 제작자 답(`ownerComment`) 뒤 다시 돌리면 `idle`, Issue 닫힘, 라벨 없음, 두 번째 계획 작성 프롬프트에 "제작자 답변"과 답 문구가 있다.
   - `scripts/test/lib.test.ts`: `openQuestions`가 질문 2개를 블록별로 나누고, 주석·"없음"·`###` 없는 목록이면 `[]`를 돌려준다.
5. 문서
   - 설계서 4.5절 "실패와 대기"에 계획 작성 세션의 열린 질문 처리(멈춤·`needs-human`·멘션·답을 넣어 재작성), 9.1절 "질문·알림 방법"에 `### 질문:` 형식과 runner 처리를 적고 버전을 v0.7.10으로 올린다(이력 한 줄).
   - 절차서 7절 형식 아래에 runner가 계획 작성 세션의 `### 질문:`을 Issue에 올리고 계획을 멈춘다는 한 줄.
   - TD-18을 해결로 바꾸고, step 세션의 열린 질문을 runner가 감지하지 않는 문제를 새 TD로 등록한다.
   - CHANGELOG 한 줄, architecture.md `lib/plan.ts` 행에 열린 질문 추출.

## Acceptance Criteria

```bash
node --test scripts/test/lib.test.ts scripts/test/runner.test.ts
grep -q "export function openQuestions" scripts/lib/plan.ts
grep -q "v0.7.10" docs/harness/design.md
grep -q "TD-18.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 질문이 있어도 계획을 `active`로 바꾸거나 step 세션을 띄우지 마라. 이유: 제작자 결정이 필요한 항목을 runner가 기본값으로 구현하게 된다(TD-18의 원인).
- step 세션 판정(`doStep`)의 질문 처리를 이 step에서 바꾸지 마라. 이유: 범위 밖이다. 새 TD로 남긴다.
- L1 훅(`scripts/hooks/`)을 고치지 마라. 이유: 이번 범위 밖이다.
