# Step 0: question-post

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `scripts/runner/run.ts`(`QuestionState`, `readQuestionState`, `questionComment`, `askQuestions`, `doAnswered`, 주 루프의 처음과 `idle` 분기, 환경 장애 처리)
- `scripts/runner/next.ts`(`latestOwnerAnswer`, `ownerComment`, 할 일 고르기의 "답을 받은 needs-human", 멈춘 계획을 고르지 않는 자리, `readConflictState`·`writeConflictState`: 상태 파일을 이 모듈에 두고 `run.ts`가 가져다 쓰는 선례)
- `scripts/commands/task.ts`(`setPlanStatus`, `commitPlan`: 계획 폴더에 커밋할 것이 없으면 아무것도 하지 않는다)
- `scripts/lib/github.ts`(`GitHubError`, `comment`, `comments`, `Comment`), `scripts/lib/github-fake.ts`(`FakeState`, `comment`, `commentAs`, `addLabel`), `scripts/lib/literal.ts`
- `scripts/test/runner.test.ts`(열린 질문의 테스트: TD-18, TD-24, `questionComment`. 한 주기만 도는 `onceRunner`), `scripts/test/next.test.ts`
- `docs/harness/design.md` 4.5절의 열린 질문 항목

## 작업

### 1. 질문 상태

`QuestionState`와 읽기·쓰기 함수를 `scripts/runner/run.ts`에서 `scripts/runner/next.ts`로 옮겨 내보낸다(`readConflictState`와 같은 자리. 할 일 고르기가 읽어야 한다(7)). `run.ts`는 가져다 쓴다. 파일의 위치와 이름(`questions.json`)은 그대로다. 두 필드를 더한다. 파일에 값이 없으면 `unposted`는 `false`, `base`는 없는 것으로 읽는다(이미 있는 상태 파일을 그대로 읽는다).

- `reported`: 제작자에게 전달된 질문의 제목(지금과 같은 뜻. 적는 때만 바뀐다).
- `waiting`: 답을 기다린다(지금과 같다).
- `unposted`: 질문을 올리기로 했는데 전달된 것을 아직 확인하지 못했다.
- `base`: 질문을 올리기로 한 때 Issue의 **마지막 댓글**(작성자와 작성 시각. 댓글이 없었으면 "없음"). 아직 읽지 못했으면 값이 없다. 이 댓글보다 뒤에 있는 댓글만 "이번 질문 뒤의 댓글"로 본다. runner의 시계를 쓰지 않는다(GitHub이 준 값끼리만 견준다).

"기준 뒤의 댓글": 댓글 목록에서 `base`와 작성자·작성 시각이 같은 마지막 댓글보다 뒤에 있는 댓글들이다. `base`가 "없음"이면 모든 댓글이다. `base`가 있는데 목록에서 찾지 못하면(지워졌다) **빈 목록**으로 본다(아래의 두 판단이 모두 "아니다"가 되어 질문을 다시 올린다. 잃는 쪽이 아니라 한 번 더 올리는 쪽으로 틀린다). 이 계산을 함수 하나로 두고(`next.ts`, 내보낸다) 4와 7이 같이 쓴다.

### 2. 안내 댓글 `questionNotice`

`questionComment`와 같은 인자를 받아 본문을 낸다(`run.ts`, 내보낸다). 세션이 쓴 글(질문의 제목과 본문)을 넣지 않는다. 들어가는 것: 제작자 멘션(설정에 제작자 계정이 있을 때), 어느 세션이 질문 몇 건을 남겼는지, 질문의 글을 댓글로 올리지 못했다는 것, 질문이 있는 곳(계획 파일의 경로와 "열린 질문" 절, 브랜치 이름), 답하는 법(`questionComment`의 문장과 같다). 계획 파일의 경로와 브랜치 이름은 `questionComment`처럼 코드 스팬에 넣는다.

### 3. 게시 실패의 구분

`comment` 호출의 실패를 둘로 나눈다(`run.ts` 안의 함수. GitHub 클라이언트는 고치지 않는다).

- **거부**: GitHub이 본문을 받지 않았다. 댓글이 만들어지지 않은 것이 확실하다. `GitHubError`이고 메시지에 `(HTTP 422)`가 있는 실패다(`gh`가 표준 오류에 내는 꼴).
- **불확실**: 그 밖의 모든 실패(시간 초과, 네트워크, 5xx, 권한, 한도). 댓글이 만들어졌는지 알 수 없다.

### 4. 전달 `deliverQuestions`

질문을 Issue에 전달하고 결과를 돌려준다(예외를 던지지 않는다). 결과는 `delivered`(전달된 것을 확인했다) | `answered`(전달하지 않았다. 제작자의 댓글이 먼저 달렸다) | `pending`(전달하지 못했거나 알 수 없다) 가운데 하나다. `askQuestions`(5)와 다시 보기(6)가 같은 차례로 부른다.

차례:

1. **멈춘 계획을 커밋하고 push한다.** `setPlanStatus(worktree, 'blocked')`를 진행 로그 글 없이 부른다: 계획 파일에 `blocked`가 적혔는데 커밋되기 전에 끝난 실행의 변경이 여기서 커밋된다(커밋할 것이 없으면 아무 일도 없다). 그 뒤 계획 브랜치를 push한다. 커밋이나 push가 실패하면 경고를 남기고 이어 가되, 그 결과("push됨": 커밋과 push가 모두 성공했다)를 4에서 쓴다.
2. Issue의 댓글을 읽는다(`comments`. 읽지 못하면 `pending`). 상태에 `base`가 없으면 지금의 마지막 댓글로 적고 저장한다. "기준 뒤의 댓글"(1)을 구해 차례로 본다.
   - (가) **이미 올라간 댓글**: 기준 뒤의 댓글 가운데 봇 계정(`gh.me()`)의 댓글이고 본문이 이 전달의 질문 댓글 또는 안내 댓글과 같은 것이 있으면, 라벨을 붙이고(실패하면 `pending`) `delivered`다. 그 뒤에 제작자의 댓글이 달려 있어도 같다(제작자의 답은 다음 할 일 고르기가 받는다). 본문은 줄 끝의 공백과 끝의 빈 줄, `\r\n`을 맞춘 뒤 비교한다.
   - (나) **먼저 달린 제작자 댓글**: 목록의 마지막 댓글이 기준 뒤의 댓글이고 인정되는 제작자 댓글(`ownerComment`)이면, 라벨을 붙이고(실패하면 `pending`) 아무것도 올리지 않고 `answered`다. 다음 할 일 고르기가 그 댓글을 답으로 받는다(7).
3. 질문 댓글의 본문 길이(문자열의 길이)가 댓글 길이 상한(65,536) 이하이면 올린다.
   - 성공하면 5로 간다.
   - 불확실한 실패면 `pending`(이 호출에서는 더 올리지 않는다. 다음 주기의 2-(가)가 올라갔는지 본다).
   - 거부면 4로 간다.
4. 안내 댓글(본문이 상한을 넘었거나 3에서 거부됐을 때): 1에서 "push됨"일 때만 올린다(제작자가 그 브랜치에서 질문을 읽어야 한다. 아니면 `pending`). 성공하면 5로 가고, 실패하면(거부든 불확실이든) `pending`이다.
5. **댓글을 올린 뒤에** `needs-human` 라벨을 붙인다. 성공하면 `delivered`, 실패하면 `pending`이다(다음 주기의 2-(가)가 댓글을 찾아 라벨을 다시 붙인다). 라벨을 댓글보다 먼저 붙이지 않는다: 댓글을 올리지 못한 채 라벨만 남으면 그 전의 제작자 댓글이 답으로 보일 수 있다.

상한을 넘는 본문은 GitHub에 보내지 않는다. 실패한 이유는 경고와 이벤트에 남긴다(이벤트의 값에 질문의 글을 넣지 않는다. 제목은 지금의 `questions` 이벤트처럼 넣는다).

### 5. `askQuestions`의 순서

1. 질문 댓글의 본문을 만든다(지금과 같다. 여기서 예외가 나면 아무것도 적지 않는다).
2. Issue의 댓글을 읽어 마지막 댓글을 `base`로 잡는다(읽지 못하면 `base` 없이 간다. `deliverQuestions`가 처음 읽을 때 잡는다).
3. 질문 상태를 `{ reported: 전의 값 그대로, waiting: true, stage, unposted: true, base }`로 저장한다. **계획을 멈추기 전이다**: 이 뒤 어디에서 runner가 끝나도 다음 실행이 이 상태를 보고 이어 간다(6).
4. 계획을 `blocked`로 바꾼다(지금과 같은 `setPlanStatus` 호출. push는 `deliverQuestions`가 한다).
5. `deliverQuestions`를 부르고 결과를 적는다(아래 "결과를 적는 법").
6. `questions` 이벤트는 지금처럼 낸다. 결과가 `delivered`가 아니면 `questions-unposted` 이벤트를 더 낸다.

결과를 적는 법:

- `delivered`: `{ reported: 전의 값 + 그 질문들의 제목, waiting: true, stage, unposted: false, base }`.
- `answered`, `pending`: 그대로 둔다(`unposted: true`).

### 6. 주기마다 다시 보기 `retryQuestions`

주 루프의 주기마다 **할 일을 고르기(`pickNext`) 전에** 부른다. 이 작업자의 계획 가운데 질문 상태가 `unposted`인 것마다(조건은 계획의 스냅숏이 아니라 디스크의 계획 파일과 질문 상태 파일에서 읽는다):

- 계획 파일의 상태가 `blocked`가 아니면(상태를 적은 뒤 계획 파일을 고치기 전에 끝난 실행의 흔적이다) `waiting`과 `unposted`를 `false`로 적고 `base`를 지우고 넘어간다. 계획이 멈추지 않았으므로 세션이 다시 돌고, 질문이 남아 있으면 `askQuestions`가 처음부터 다시 한다.
- `waiting`이 아니면(답을 받아 이어 가는 중이다) 건드리지 않는다.
- 계획 파일에서 열린 질문을 다시 읽어 `reported`에 없는 것을 고른다. 없으면 `unposted`만 지운다.
- 있으면 본문을 만들어 `deliverQuestions`를 부르고 결과를 적는다(5의 "결과를 적는 법"). `delivered`면 `questions-posted` 이벤트를 낸다.

돌려주는 값은 이 호출 뒤에도 `unposted`인 채 `blocked`로 남은 계획의 수다. 한 계획의 처리에서 난 예외는 경고로 남기고 다음 계획으로 간다(그 계획은 남은 것으로 센다).

`idle` 분기: 정리(`cleanupMerged`) 뒤, **CI 대기 분기보다 먼저** 남은 수를 본다. 0보다 크면 멈추지도 CI를 기다리며 돌지도 않고 그 주기의 결과를 환경 장애(`env`)로 한다. 지금의 환경 장애 처리가 기다렸다가 다시 돌고, 할 일 없이 기다린 시간이 `limits.usageLimitMaxWaitMin`을 넘으면 `usage-limit`으로 멈춘다(다른 PR이 CI를 기다리는 중이어도 같다. 그 사이 할 일이 생겨 일을 하면 지금의 환경 장애 대기처럼 기다린 시간은 0으로 돌아간다).

### 7. 할 일 고르기의 답변 인정(`scripts/runner/next.ts`)

"답을 받은 needs-human"을 고르는 자리에서, 그 Issue에 이 작업자의 계획이 있고 그 계획의 질문 상태가 `unposted`이면 조건을 하나 더 본다: 마지막 댓글이 **기준 뒤의 댓글**(1)일 때만 답으로 받는다. `base`가 아직 없으면 답으로 받지 않는다. `unposted`가 아니면 지금과 같다.

그래서 질문을 올리지 못하는 동안, 질문보다 먼저 있던 제작자 댓글이 마지막 댓글이고 `needs-human` 라벨이 (다른 이유로) 붙어 있어도 그 댓글로 세션을 다시 띄우지 않는다.

### 8. 답을 받았을 때

`doAnswered`가 질문 상태를 고쳐 쓰는 두 자리(step 세션의 질문, 계획 작성 단계의 질문)에서 `unposted`를 `false`로 적고 `base`를 지운다. `reported`는 건드리지 않는다: 전달을 확인하지 못한 질문의 제목은 `reported`에 없으므로, 세션 뒤에도 그 질문이 열린 질문에 남아 있으면 `askQuestions`가 다시 올린다.

### 9. 가짜 GitHub의 장치(`scripts/lib/github-fake.ts`)

`FakeState`에 선택 필드를 더한다. 없으면 지금과 같이 동작한다.

- `commentFaults`: `'reject' | 'lost' | 'down'`의 배열. `comment`가 불릴 때마다 앞에서 하나를 꺼낸다. `reject`는 댓글을 남기지 않고 메시지에 `(HTTP 422)`가 든 `GitHubError`를 던진다. `lost`는 **댓글을 남긴 뒤** `(HTTP 422)`가 없는 `GitHubError`를 던진다(저장된 뒤 응답을 잃은 경우). `down`은 댓글을 남기지 않고 `(HTTP 422)`가 없는 `GitHubError`를 던진다.
- `commentMax`: 수. 본문의 길이가 이 값을 넘으면 `comment`가 `reject`처럼 던진다.
- `labelFaults`: 수. 0보다 크면 `addLabel`이 `GitHubError`를 던지고 1을 줄인다.
- `commentCalls`: `comment`가 받은 호출의 수(성공·실패를 합친다). 상한을 넘는 본문을 보내지 않았는지를 테스트가 본다.

제작자·다른 계정의 댓글을 흉내 내는 `ownerComment`·`commentAs`는 이 장치를 타지 않는다.

### 10. 테스트 먼저 (있던 테스트의 단언은 고치지 않는다)

구현 전에 돌려 실패를 확인하고 진행 로그에 적는다. 따로 적지 않은 것은 `scripts/test/runner.test.ts`에 더한다. 주기 하나씩 돌리는 것은 `onceRunner`로 한다. "봇 댓글"은 Issue에 봇 계정이 단 질문 댓글과 안내 댓글을 말한다.

- 올리지 못했다가 풀린다(계획 작성 단계): `commentFaults`를 `['down']`으로 두고 한 주기를 돌린다. 계획은 `blocked`이고 push됐고, Issue에 봇 댓글도 라벨도 없고(`commentCalls`는 1: 불확실한 실패 뒤에 안내 댓글을 올리지 않았다), `reported`에 그 제목이 없고 `unposted`가 `true`다. 이어서 돌리면 질문 댓글이 **한 번** 올라가고(`questionComment`의 본문 그대로) 라벨이 붙고, `reported`에 제목이 들어가고 `unposted`가 `false`이며 runner는 `human`으로 멈춘다. 다시 돌려도 더 올리지 않는다. 제작자가 답하면 지금처럼 끝까지 간다.
- 올리지 못했다가 풀린다(step 세션의 질문): 같은 것을 step 단계에서 본다(다시 올린 뒤 답을 받으면 그 step을 이어 간다).
- 응답을 잃었다: `commentFaults`를 `['lost']`로 두면(댓글은 남았다) 그 주기에는 `unposted`이고, 다음 주기에 **아무것도 더 올리지 않고**(`commentCalls`가 늘지 않는다. 봇 댓글은 질문 댓글 하나다) 라벨이 붙고 `reported`에 제목이 들어가고 `unposted`가 `false`가 된다. 안내 댓글에서 응답을 잃은 경우도 같다(상한을 넘는 질문에 `['lost']`: 안내 댓글 하나).
- 응답을 잃은 질문에 제작자가 바로 답한다: `['lost']`로 한 주기를 돌린 뒤 제작자 댓글을 단다. 다음 주기에 봇 댓글을 더 올리지 않고 `reported`에 제목이 들어가며, 그 댓글을 답으로 받아 세션을 다시 띄운다. 세션이 같은 질문을 열린 질문에 남겨도 다시 올리지 않는다(봇 댓글은 끝까지 하나다).
- 거부: `commentFaults`를 `['reject']`로 두면 같은 주기에 안내 댓글이 올라가고(`commentCalls`는 2) 전달된 것으로 적는다. 봇 댓글은 안내 댓글 하나다.
- 길이 상한: 질문 댓글의 본문이 65,536자를 넘게 만든 질문(긴 백틱 줄)에서, `commentCalls`가 1이고(안내 댓글 하나. 넘는 본문은 보내지 않았다) 봇 댓글은 안내 댓글 하나다. 안내 댓글에는 제작자 멘션, 계획 파일의 경로, 브랜치 이름이 있고 질문의 글(제목, 본문의 한 줄)은 없다. `reported`에 제목이 들어가고 runner는 `human`으로 멈춘다. 경계: 본문이 정확히 65,536자이면 질문 댓글을 올리고, 65,537자이면 안내 댓글을 올린다(`questionComment`의 결과 길이로 맞춘다).
- 안내 댓글은 push 뒤에만: 원격에 push할 수 없게 만든 상태에서(테스트가 방법을 정한다) 길이 상한을 넘는 질문은 안내 댓글도 올리지 않고 `unposted`로 남는다. push가 되면 다음 주기에 안내 댓글이 올라간다.
- 올리지 못한 사이에 제작자가 댓글을 단다: `commentFaults`를 `['down']`으로 두고 한 주기를 돌린 뒤 제작자 댓글을 단다. 다음 주기들에서 runner는 **질문 댓글을 올리지 않고**(제작자 댓글이 마지막 댓글로 남는다) 라벨을 붙이고 그 댓글을 답으로 받아 세션을 다시 띄운다. 세션이 같은 질문을 열린 질문에 남기면 그 질문 댓글이 올라간다(한 번).
- 그때 라벨도 붙이지 못한다: 위의 경우에서 제작자 댓글 뒤의 첫 주기에 `labelFaults`를 1로 두면 그 주기에는 답으로 받지 않고 질문 댓글도 올리지 않는다. 그다음 주기에 라벨을 붙이고 답으로 받는다.
- 질문을 올리려는 사이에 달린 제작자 댓글: `askQuestions`가 `base`를 잡은 뒤, 전달이 댓글을 읽기 전에 제작자 댓글이 달린 상태를 만든다(디스크 상태로: 질문 상태가 `{ waiting: true, unposted: true, base: 그 전의 마지막 댓글 }`이고 계획이 `blocked`이며 그 뒤에 제작자 댓글이 하나 있다). 돌리면 질문 댓글을 올리지 않고 그 댓글을 답으로 받는다.
- 질문보다 먼저 있던 제작자 댓글은 답이 아니다: Issue에 제작자 댓글이 먼저 있고 `needs-human` 라벨도 붙어 있는 상태에서 질문을 올리지 못한다(`commentFaults`를 `['down', 'down', 'down']`). 세 주기 동안 세션이 다시 뜨지 않고(세션 호출 수가 늘지 않는다) `unposted`가 `true`로 남는다. 게시가 풀린 다음 주기에 질문 댓글이 올라간다.
- `scripts/test/next.test.ts`: 할 일 고르기의 답변 인정. `unposted`이고 마지막 댓글이 `base`와 같은 제작자 댓글이면 `answered`를 고르지 않는다. `base` 뒤의 제작자 댓글이 마지막이면 고른다. `unposted`인데 `base`가 없으면 고르지 않는다. `unposted`가 아니면 지금처럼 고른다. "기준 뒤의 댓글" 함수: `base`가 "없음"이면 전부, 목록에 없으면 빈 목록, 작성자·시각이 같은 댓글이 둘이면 마지막 것 기준.
- 상태 전환의 경계에서 끝난 실행(디스크 상태는 테스트가 질문 상태 파일과 계획 파일을 직접 써서 만든다): (a) 질문 상태가 `{ waiting: true, unposted: true }`이고 계획이 `blocked`로 커밋돼 있으며 Issue에 라벨도 봇 댓글도 없으면(계획을 멈춘 직후에 끝났다) 돌렸을 때 질문이 올라간다. (b) 같은 질문 상태인데 계획 파일에 `blocked`가 **적히기만 하고 커밋되지 않은** 상태이면(파일을 고친 직후에 끝났다), 돌린 뒤 그 변경이 커밋·push돼 있고(원격 브랜치의 계획 파일이 `blocked`이고 질문이 들어 있다) 질문이 올라간다. 상한을 넘는 질문으로도 본다(안내 댓글이 올라간 때 원격 브랜치에 질문이 있다). (c) 같은 질문 상태인데 계획이 `blocked`가 아니면(상태를 적은 직후에 끝났다) `waiting`·`unposted`가 지워지고 세션이 다시 돌아 질문이 올라간다(한 번).
- 계속 올리지 못한다: `commentFaults`를 `down`으로 충분히 채우면 runner는 `human`이 아니라 `usage-limit`으로 멈춘다(테스트의 설정에서 대기 상한을 작게 둔다). 그 뒤에도 `reported`에 제목이 없다. 같은 상태에서 이 작업자의 다른 PR이 CI를 기다리고 있어도 `usage-limit`으로 멈춘다(CI 대기로 끝없이 돌지 않는다).
- 라벨은 댓글 뒤에 붙인다: `commentFaults`가 `['down']`인 주기 뒤에 Issue에 라벨이 없다. 댓글은 올라갔는데 라벨을 붙이지 못한 주기(`labelFaults` 1) 뒤에는 `unposted`이고, 다음 주기에 댓글을 더 올리지 않고 라벨을 붙여 `delivered`가 된다.
- `questionNotice`의 단위 테스트: 제작자 계정이 있으면 멘션이 있고 없으면 없다. 계획 파일의 경로와 브랜치 이름이 코드 스팬 안에 있다. 질문의 글을 받아도 결과에 넣지 않는다(질문의 제목·본문에 넣은 표식 문자열이 결과에 없다). 길이가 1,000자 이하다.
- 이미 있는 상태 파일: `unposted`·`base`가 없는 질문 상태 파일을 둔 계획이 지금처럼 동작한다(다시 올리지 않는다).

### 11. 문서

- `docs/harness/design.md` 4.5절의 열린 질문 항목(“계획 작성 세션이 "열린 질문"에 …”로 시작하는 항목)에서 문장 "같은 질문은 다시 올리지 않는다." 바로 뒤에 다음 문장을 넣는다(글자 그대로):

  `질문은 전달된 것을 확인한 뒤에만 올린 것으로 적는다(댓글 하나와 라벨). 질문 댓글이 댓글 길이 상한을 넘거나 GitHub이 본문을 거부하면(HTTP 422) 질문의 글 대신 계획 파일의 위치를 알리는 안내 댓글을 올린다. 올리지 못했거나 올라갔는지 알 수 없으면 계획을 멈춘 채 주기마다 다시 본다: 같은 댓글이 이미 있으면 올린 것으로 적고, 그 사이 제작자의 댓글이 달렸으면 답으로 받고, 아니면 다시 올린다. 올리지 못한 질문이 남은 동안 runner는 사람의 답을 기다린다고 멈추지 않고 환경 장애로 기다린다(Issue #211).`

- 0절 버전 이력에 한 항목(다음 번호. 올릴 때의 main 기준), 머리말의 버전.
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)" 절에 한 줄(`#211`, "검사를 약화하지 않는다").
- 이벤트 이름(`questions-unposted`, `questions-posted`)을 문서나 지표 코드가 목록으로 갖고 있으면 거기에 더한다. 없으면 더하지 않고 진행 로그에 적는다.

### 12. 발견 사항

runner가 상태를 먼저 적고 GitHub에 알리는 다른 자리(`blockPlan`, 교착 보고, 충돌 알림, 승인 요청·대기 알림)를 읽어, 알림이 실패하면 제작자가 모르는 채 기다리게 되는 자리를 계획의 "발견 사항"에 적는다. 고치지 않는다.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts
node --test scripts/test/next.test.ts
node --test scripts/test/runner-review.test.ts scripts/test/runner-plan-review.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-workers.test.ts scripts/test/literal.test.ts
test "$(grep -c -F '질문은 전달된 것을 확인한 뒤에만 올린 것으로 적는다(댓글 하나와 라벨). 질문 댓글이 댓글 길이 상한을 넘거나 GitHub이 본문을 거부하면(HTTP 422) 질문의 글 대신 계획 파일의 위치를 알리는 안내 댓글을 올린다. 올리지 못했거나 올라갔는지 알 수 없으면 계획을 멈춘 채 주기마다 다시 본다: 같은 댓글이 이미 있으면 올린 것으로 적고, 그 사이 제작자의 댓글이 달렸으면 답으로 받고, 아니면 다시 올린다. 올리지 못한 질문이 남은 동안 runner는 사람의 답을 기다린다고 멈추지 않고 환경 장애로 기다린다(Issue #211).' docs/harness/design.md)" = 1
test "$(git diff --numstat "$(git merge-base HEAD origin/main)" HEAD -- docs/harness/design.md | cut -f1,2 | tr '\t' ' ')" = "3 2"
grep -q '#211' docs/harness/CHANGELOG.md
test "$(git diff --name-only "$(git merge-base HEAD origin/main)" HEAD -- scripts | tr '\n' ' ')" = "scripts/lib/github-fake.ts scripts/runner/next.ts scripts/runner/run.ts scripts/test/next.test.ts scripts/test/runner.test.ts "
node scripts/harness.ts self-test
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
node scripts/harness.ts fmt --check
```

- 넷째·다섯째 줄: 설계서에는 정한 문장 하나가 들어가고, 바뀌는 줄은 머리말의 버전(한 줄을 고친다), 버전 이력(한 줄을 더한다), 4.5절의 항목(한 줄을 고친다)뿐이다. `origin/main`이 필요하다(`git fetch origin`).
- 일곱째 줄: `scripts/` 아래에서 바뀌는 파일은 다섯뿐이다.

## 금지사항

- `questionComment`와 `literalBlock`의 결과를 바꾸지 마라. 이유: 질문의 글을 글자 그대로 넣는 보장(#198)이다.
- 질문의 글을 자르거나 고쳐 올리지 마라. 이유: 제작자가 잘린 질문에 답하게 된다.
- 불확실한 실패 뒤에 같은 호출에서 다른 댓글을 올리지 마라. 이유: 앞의 댓글이 올라가 있을 수 있어 댓글이 둘이 된다.
- 댓글을 올리기 전에 라벨을 붙이지 마라(먼저 달린 제작자 댓글을 답으로 넘길 때는 붙인다). 이유: 라벨만 남으면 그 전의 제작자 댓글이 답으로 보일 수 있다.
- runner의 시계로 댓글의 앞뒤를 가리지 마라. 이유: GitHub의 시계와 다를 수 있다. 댓글 목록의 순서와 GitHub이 준 값만 쓴다.
- 안내 댓글이나 이벤트에 세션이 쓴 글을 코드 블록 없이 넣지 마라. 이유: 멘션·Issue 참조로 해석된다(14.6절).
- 있던 테스트의 단언을 지우거나 약하게 하지 마라. 이유: R4.
- `next.ts`에서 질문 상태를 옮겨 오는 것과 7의 조건 말고는 고치지 마라(답변 인정 기준 `ownerComment`, 우선순위). GitHub 클라이언트(`scripts/lib/github.ts`)와 `scripts/commands/task.ts`를 고치지 마라. 이유: 이 step의 범위가 아니다(고쳐야 하면 멈추고 계획을 고친다).
- 다른 알림 자리(`blockPlan` 등)를 고치지 마라. 이유: 비범위다. 발견 사항에 적는다.
