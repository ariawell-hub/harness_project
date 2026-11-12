# Step 2: ask-rules

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-stop-friction/plan.md`
- `docs/harness/workflow.md` 1절(접수), 7절(에스컬레이션)
- `AGENTS.md` 작업 루프 마지막 줄("판단이 필요하면 …")
- `docs/harness/design.md` 9.1절(에스컬레이션), 14.6절(Issue 작성자)

## 작업

배경: 절차서 1절 "Issue가 없으면 만들지 말고 제작자에게 묻는다" 때문에 제작자가 대화로 지시해도 "Issue를 어떻게 만들까요?"를 3번 물었고 답은 매번 "봇이 등록(추천안)"이었다. 11월 11일 운영 질문 5개도 모두 추천안으로 답이 왔고, 작업 중간에 물어 두 세션이 동시에 46분을 기다렸다.

1. `docs/harness/workflow.md` 1절
   - 접수 규칙: 대화에서 제작자가 직접 지시한 일은 봇이 Issue를 등록하고(본문 첫 줄 `> 출처: 제작자 대화 지시(<날짜>)`) 묻지 않고 `new-task`로 시작한다. 지시 없이 에이전트가 스스로 떠올린 일은 Issue를 만들지 않고 제작자에게 제안한다.
2. `docs/harness/workflow.md` 7절
   - "묻지 않고 진행한다"에 "추천안이 분명한 운영 판단(Issue 등록 방식, 작업 순서, 문서 위치)"을 더한다.
   - 질문 시점: 질문은 작업 시작 때(계획 작성 중) 한 번에 모은다. 작업 중간에 생긴 질문은 막히지 않은 일을 먼저 끝내고 모아서 한다.
   - 대화로 합의된 결정은 그 자리에서 ADR이나 계획 의사결정 로그에 남긴다(같은 질문을 다시 하지 않도록, B1).
3. `AGENTS.md`: "판단이 필요하면 혼자 추측하지 말고 묻는다" 줄을 "반드시 묻는 것"과 "추천안으로 진행하고 기록하는 것"이 workflow.md 7절에 있다는 내용으로 고친다(지도 문서이므로 한두 줄).
4. `docs/harness/design.md`에 같은 규칙이 있으면 맞추고 버전·변경 이력을 갱신한다. 없으면 고치지 않는다.
5. `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄.

## Acceptance Criteria

```bash
! grep -q "Issue가 없으면 만들지 말고" docs/harness/workflow.md
grep -q "제작자 대화 지시" docs/harness/workflow.md
node scripts/harness.ts check
```

## 금지사항

- "반드시 묻는다" 목록(되돌릴 수 없는 작업, 보안·권한, 하네스 원칙 변경, 5회 실패 등)을 줄이지 마라. 이유: 제작자 지시는 불필요한 질문을 없애는 것이지 위험 판단을 넘기는 것이 아니다.
- runner의 Issue 작성자 규칙(봇 Issue는 runner가 고르지 않음, 14.6절)을 바꾸지 마라. 이유: 봇이 스스로 일을 만드는 경로를 막는 보안 규칙이다.
