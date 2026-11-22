# Step 0: question-post

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `scripts/runner/run.ts`(`QuestionState`, `readQuestionState`, `questionComment`, `askQuestions`, `doAnswered`, 주 루프의 `pickNext` 뒤와 `idle` 분기, 환경 장애 처리)
- `scripts/runner/next.ts`(`latestOwnerAnswer`, 멈춘 계획을 고르지 않는 자리)
- `scripts/lib/github-fake.ts`(`FakeState`, `comment`), `scripts/lib/literal.ts`
- `scripts/test/runner.test.ts`(열린 질문의 테스트: TD-18, TD-24, `questionComment`)
- `docs/harness/design.md` 4.5절의 열린 질문 항목

## 작업

### 1. 질문 상태에 "올리지 못한 질문" 표시

`scripts/runner/run.ts`의 `QuestionState`에 `unposted: boolean`을 더한다. 파일에 값이 없으면 `false`로 읽는다(이미 있는 상태 파일을 그대로 읽는다).

- `reported`: 제작자에게 전달된 질문의 제목(지금과 같은 뜻. 적는 때만 바뀐다).
- `waiting`: 답을 기다린다(지금과 같다).
- `unposted`: 계획을 멈췄는데 질문을 아직 전달하지 못했다.

### 2. 안내 댓글 `questionNotice`

`questionComment`와 같은 인자를 받아 본문을 낸다(내보낸다). 세션이 쓴 글(질문의 제목과 본문)을 넣지 않는다. 들어가는 것: 제작자 멘션(설정에 제작자 계정이 있을 때), 어느 세션이 질문 몇 건을 남겼는지, 질문의 글을 댓글로 올리지 못했다는 것, 질문이 있는 곳(계획 파일의 경로와 "열린 질문" 절, 브랜치 이름), 답하는 법(`questionComment`의 문장과 같다). 계획 파일의 경로와 브랜치 이름은 `questionComment`처럼 코드 스팬에 넣는다.

### 3. 전달 `deliverQuestions`

질문을 Issue에 전달하고 전달됐는지를 돌려준다(예외를 던지지 않는다). 차례:

1. `needs-human` 라벨을 붙인다. 실패하면 전달하지 못한 것이다(라벨이 없으면 runner가 답을 찾지 않는다).
2. 질문 댓글의 본문 길이(문자열의 길이)가 댓글 길이 상한(65,536) 이하이면 올린다. 성공하면 전달된 것이다.
3. 본문이 상한을 넘거나 2의 게시가 실패했으면, 멈춘 계획의 브랜치가 push돼 있을 때만 안내 댓글을 올린다. 성공하면 전달된 것이다. push는 이 함수가 다시 해 본다(`git push`가 성공하거나 올릴 것이 없으면 push된 것이다).
4. 그 밖에는 전달하지 못한 것이다.

상한을 넘는 본문은 GitHub에 보내지 않는다. 실패한 이유는 경고와 이벤트에 남긴다(이벤트의 값에 질문의 글을 넣지 않는다. 제목은 지금의 `questions` 이벤트처럼 넣는다).

### 4. `askQuestions`의 순서

1. 질문 댓글의 본문을 만든다(지금과 같다. 여기서 예외가 나면 아무것도 적지 않는다).
2. 계획을 `blocked`로 바꾸고 push한다(지금과 같다).
3. 질문 상태를 `{ reported: 전의 값 그대로, waiting: true, stage, unposted: true }`로 저장한다.
4. `deliverQuestions`를 부른다. 전달됐으면 상태를 `{ reported: 전의 값 + 새 질문의 제목, waiting: true, stage, unposted: false }`로 저장한다. 전달하지 못했으면 3의 상태로 둔다.
5. `questions` 이벤트는 지금처럼 낸다. 전달하지 못했으면 `questions-unposted` 이벤트를 더 낸다.

### 5. 주기마다 다시 올리기 `retryQuestions`

주 루프에서 `pickNext`로 할 일을 고른 뒤, 그 할 일을 하기 전에 부른다. 이 작업자의 계획 가운데 계획 파일의 상태가 `blocked`이고 질문 상태가 `waiting`이며 `unposted`인 것마다:

- 고른 할 일이 그 계획의 Issue에 대한 답변 처리(`answered`)이면 건너뛴다(6이 처리한다).
- 계획 파일에서 열린 질문을 다시 읽어 `reported`에 없는 것을 고른다. 없으면 `unposted`만 지운다.
- 있으면 본문을 만들어 `deliverQuestions`를 부른다. 전달됐으면 4의 전달된 상태로 저장하고 `questions-posted` 이벤트를 낸다.

돌려주는 값은 이 호출 뒤에도 올리지 못한 채 남은 계획의 수다. 조건은 계획의 스냅숏이 아니라 디스크의 계획 파일과 질문 상태 파일에서 읽는다. 한 계획의 처리에서 난 예외는 경고로 남기고 다음 계획으로 간다(그 계획은 남은 것으로 센다).

`idle` 분기에서 멈추기(`human`·`idle`) 전에: 남은 수가 0보다 크면 멈추지 않고 그 주기의 결과를 환경 장애(`env`)로 한다. 지금의 환경 장애 처리가 기다렸다가 다시 돌고, 기다린 시간이 `limits.usageLimitMaxWaitMin`을 넘으면 `usage-limit`으로 멈춘다. 정리(`cleanupMerged`)와 CI 대기의 분기는 지금과 같다.

### 6. 답을 받았을 때

`doAnswered`가 질문 상태를 고쳐 쓰는 두 자리(step 세션의 질문, 계획 작성 단계의 질문)에서 `unposted`를 `false`로 함께 적는다. `reported`는 건드리지 않는다: 전달하지 못한 질문의 제목은 `reported`에 없으므로, 세션 뒤에도 그 질문이 열린 질문에 남아 있으면 `askQuestions`가 다시 올린다.

### 7. 가짜 GitHub의 장치(`scripts/lib/github-fake.ts`)

`FakeState`에 선택 필드 둘을 더한다. 없으면 지금과 같이 동작한다.

- `commentFailures`: 수. 0보다 크면 `comment`가 예외를 던지고 1을 줄인다(댓글은 남지 않는다).
- `commentMax`: 수. 본문의 길이가 이 값을 넘으면 `comment`가 예외를 던진다(GitHub의 길이 거부를 흉내 낸다. 댓글은 남지 않는다).

`comment`가 받은 호출을 세는 값(`commentCalls`: 성공·실패를 합친 수)을 상태에 적어, 상한을 넘는 본문을 보내지 않았는지를 테스트가 볼 수 있게 한다. 제작자 댓글을 흉내 내는 `ownerComment`는 이 장치를 타지 않는다.

### 8. 테스트 먼저 (`scripts/test/runner.test.ts`에 더한다. 있던 테스트의 단언은 고치지 않는다)

구현 전에 돌려 실패를 확인하고 진행 로그에 적는다.

- 게시가 실패했다가 풀린다(계획 작성 단계): `commentFailures`를 2로 두고(질문 댓글과 안내 댓글이 모두 실패한다) runner를 돌린다. 첫 주기 뒤의 상태를 보려면 한 주기만 도는 방식으로 돌린다: 계획은 `blocked`이고 push됐고, Issue에 질문 댓글도 안내 댓글도 없고, 질문 상태의 `reported`에 그 제목이 없고 `unposted`가 `true`다. 이어서 돌리면 질문 댓글이 **한 번** 올라가고(`questionComment`의 본문 그대로), `reported`에 제목이 들어가고 `unposted`가 `false`이며 runner는 `human`으로 멈춘다. 다시 돌려도 더 올리지 않는다. 제작자가 답하면 지금처럼 끝까지 간다.
- 게시가 실패했다가 풀린다(step 세션의 질문): 같은 것을 step 단계에서 본다(다시 올린 뒤 답을 받으면 그 step을 이어 간다).
- 길이 상한: 질문 댓글의 본문이 65,536자를 넘게 만든 질문(긴 백틱 줄)에서, 가짜 GitHub의 `commentCalls`가 1이고(안내 댓글 하나. 넘는 본문은 보내지 않았다) Issue의 댓글은 안내 댓글 하나다. 안내 댓글에는 제작자 멘션, 계획 파일의 경로, 브랜치 이름이 있고 질문의 글(제목, 본문의 한 줄)은 없다. `reported`에 제목이 들어가고 runner는 `human`으로 멈춘다. 경계: 본문이 정확히 65,536자이면 질문 댓글을 올리고, 65,537자이면 안내 댓글을 올린다(`questionComment`의 결과 길이로 맞춘다).
- 게시가 거부된다(길이가 아닌 이유): `commentFailures`를 1로 두면 같은 주기에 안내 댓글이 올라가고 전달된 것으로 적는다.
- 안내 댓글은 push 뒤에만: 원격에 push할 수 없게 만든 상태에서(가짜 원격의 경로를 잠시 바꾸는 등 테스트가 정한다) 길이 상한을 넘는 질문은 안내 댓글도 올리지 않고 `unposted`로 남는다. push가 되면 다음 주기에 안내 댓글이 올라간다.
- 게시가 계속 실패한다: `commentFailures`를 충분히 크게 두면 runner는 `human`이 아니라 `usage-limit`으로 멈춘다(테스트의 설정에서 대기 상한을 작게 둔다). 그 뒤에도 `reported`에 제목이 없다.
- 올리지 못한 채 제작자가 댓글을 단다: 게시가 실패한 상태에서 제작자 댓글을 달고 게시를 풀면, runner가 답으로 받아 세션을 다시 띄우고, 세션이 같은 질문을 열린 질문에 남기면 그 질문 댓글이 올라간다(한 번).
- 라벨을 붙이지 못하면 댓글을 올리지 않는다: 라벨 붙이기가 실패하게 한 주기(테스트가 정한 방법으로. 가짜에 장치가 더 필요하면 `labelFailures`를 같은 방식으로 더한다)에서 댓글 호출이 없다.
- `questionNotice`의 단위 테스트: 제작자 계정이 있으면 멘션이 있고 없으면 없다. 계획 파일의 경로와 브랜치 이름이 코드 스팬 안에 있다. 질문의 글을 받아도 결과에 넣지 않는다(질문의 제목·본문에 넣은 표식 문자열이 결과에 없다). 길이가 상한보다 한참 작다(1,000자 이하).
- 이미 있는 상태 파일: `unposted`가 없는 질문 상태 파일을 둔 계획이 지금처럼 동작한다(다시 올리지 않는다).

### 9. 문서

- `docs/harness/design.md` 4.5절의 열린 질문 항목(“계획 작성 세션이 "열린 질문"에 …”로 시작하는 항목)에서 문장 "같은 질문은 다시 올리지 않는다." 바로 뒤에 다음 문장을 넣는다(글자 그대로):

  `질문은 전달된 뒤에만 올린 것으로 적는다(라벨과 댓글 하나). 질문 댓글이 댓글 길이 상한을 넘거나 게시가 거부되면 질문의 글 대신 계획 파일의 위치를 알리는 안내 댓글을 올리고, 그것도 올리지 못하면 계획을 멈춘 채 주기마다 다시 올린다. 올리지 못한 질문이 남은 동안 runner는 사람의 답을 기다린다고 멈추지 않고 환경 장애로 기다린다(Issue #211).`

- 0절 버전 이력에 한 항목(다음 번호. 올릴 때의 main 기준), 머리말의 버전.
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(`#211`, "검사를 약화하지 않는다").
- 이벤트 이름(`questions-unposted`, `questions-posted`)을 문서나 지표 코드가 목록으로 갖고 있으면 거기에 더한다. 없으면 더하지 않고 진행 로그에 적는다.

### 10. 발견 사항

runner가 상태를 먼저 적고 GitHub에 알리는 다른 자리(`blockPlan`, 교착 보고, 충돌 알림, 승인 요청·대기 알림)를 읽어, 알림이 실패하면 제작자가 모르는 채 기다리게 되는 자리를 계획의 "발견 사항"에 적는다. 고치지 않는다.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts
node --test scripts/test/runner-review.test.ts scripts/test/runner-plan-review.test.ts scripts/test/literal.test.ts
test "$(grep -c -F '질문은 전달된 뒤에만 올린 것으로 적는다(라벨과 댓글 하나). 질문 댓글이 댓글 길이 상한을 넘거나 게시가 거부되면 질문의 글 대신 계획 파일의 위치를 알리는 안내 댓글을 올리고, 그것도 올리지 못하면 계획을 멈춘 채 주기마다 다시 올린다. 올리지 못한 질문이 남은 동안 runner는 사람의 답을 기다린다고 멈추지 않고 환경 장애로 기다린다(Issue #211).' docs/harness/design.md)" = 1
test "$(git diff --numstat "$(git merge-base HEAD origin/main)" HEAD -- docs/harness/design.md | cut -f1,2 | tr '\t' ' ')" = "3 2"
grep -q '#211' docs/harness/CHANGELOG.md
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- scripts | tr '\n' ' ')" = "scripts/lib/github-fake.ts scripts/runner/run.ts scripts/test/runner.test.ts "
node scripts/harness.ts self-test
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 셋째·넷째 줄: 설계서에는 정한 문장 하나가 들어가고, 바뀌는 줄은 머리말의 버전(한 줄을 고친다), 버전 이력(한 줄을 더한다), 4.5절의 항목(한 줄을 고친다)뿐이다. `origin/main`이 필요하다(`git fetch origin`).
- 여섯째 줄: `scripts/` 아래에서 바뀌는 파일은 셋뿐이다.

## 금지사항

- `questionComment`와 `literalBlock`의 결과를 바꾸지 마라. 이유: 질문의 글을 글자 그대로 넣는 보장(#198)이다.
- 질문의 글을 자르거나 고쳐 올리지 마라. 이유: 제작자가 잘린 질문에 답하게 된다.
- 안내 댓글이나 이벤트에 세션이 쓴 글을 코드 블록 없이 넣지 마라. 이유: 멘션·Issue 참조로 해석된다(14.6절).
- 있던 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
- GitHub 클라이언트(`scripts/lib/github.ts`)와 `scripts/runner/next.ts`를 고치지 마라. 이유: 이 step의 범위가 아니다(고쳐야 하면 멈추고 계획을 고친다).
- 다른 알림 자리(`blockPlan` 등)를 고치지 마라. 이유: 비범위다. 발견 사항에 적는다.
