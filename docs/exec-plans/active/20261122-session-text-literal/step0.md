# Step 0: literal-text

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`lib/*`, `runner/*`, `ci/*` 행)
- `docs/harness/design.md` 4.5절(열린 질문을 올리는 항목), 10.2절 (4)(반박 형식의 구현, runner의 반박·교착), 14.6절
- `docs/harness/workflow.md` 7절(열린 질문), 8절(반박 형식)
- `scripts/runner/run.ts`의 `askQuestions`, 교착 보고를 만드는 부분(`deadlocked`를 부르는 곳), `blockPlan`(읽기만)
- `scripts/runner/review.ts`의 `sessionRebuttal`, `rebuttalComment`, `findingLine`, `deadlockRebuttals`
- `scripts/ci/rebuttal.ts`(전체), `scripts/ci/gates.ts`의 `cellCode`와 `summaryMarkdown`
- `scripts/lib/plan.ts`의 `openQuestions`(질문 블록의 글이 무엇인지), `scripts/metrics/source.ts`의 `classifyEscalation`(읽기만)
- `scripts/test/scope.test.ts`의 `tableCells`·`codeSpanText`(코드 스팬을 렌더러의 규칙으로 읽는 테스트 안의 모델), `scripts/test/rebuttal.test.ts`, `scripts/test/runner-review.test.ts`의 반박·교착 테스트, `scripts/test/runner.test.ts`의 열린 질문 테스트 둘, `scripts/selftest/fake-agent.ts`의 `question`·`rebut` 동작(읽기만)

## 작업

### 1. `scripts/lib/literal.ts`(새 파일)

GitHub 댓글·요약에 남이 정한 글자를 글자 그대로 넣는 함수 둘. 다른 모듈을 import하지 않는다.

- `literalSpan(s: string): string` — 한 줄 코드 스팬.
  - 줄 나눔 글자(`\r`, `\n`, U+2028, U+2029)의 묶음은 공백 하나로 바꾼다.
  - 그 결과가 공백뿐이거나 비었으면 `''`를 돌려준다.
  - 구분 백틱의 수는 글 안의 가장 긴 백틱 줄보다 하나 많다. 구분 백틱과 글 사이에 공백을 하나씩 둔다.
  - 지금의 `cellCode`에서 `|`를 막는 부분만 뺀 것과 결과가 같아야 한다.
- `literalBlock(s: string): string` — 펜스 코드 블록.
  - `\r\n`과 홀로 있는 `\r`은 `\n`으로 바꾸고, 앞뒤의 빈 줄(`\n`의 묶음)은 뗀다. 그 밖의 글자는 바꾸지 않는다.
  - 그 결과가 공백뿐이거나 비었으면 `''`를 돌려준다.
  - 펜스는 백틱이고 길이는 글 안의 가장 긴 백틱 줄보다 하나 많되 셋 이상이다. 여는 줄은 펜스 바로 뒤에 `text`를 붙인다. 닫는 줄은 펜스뿐이다. 결과는 `여는 줄\n글\n닫는 줄`이고 끝에 줄 바꿈이 없다.
  - 이유: 닫는 펜스는 여는 펜스와 같은 글자이고 길이가 같거나 길어야 한다. 글 안에는 그만큼 긴 백틱 줄이 없으므로 글의 어느 줄도 블록을 닫지 못한다. `~~~` 줄은 백틱 펜스를 닫지 못한다.

### 2. `scripts/ci/gates.ts`의 `cellCode`

`literalSpan`의 결과에서 `|`를 `\|`로 바꾼 값을 돌려준다. 결과는 지금과 글자까지 같다(구분 백틱에는 `|`가 없다). 다른 곳은 고치지 않는다.

### 3. 질문 댓글(`scripts/runner/run.ts`)

- 질문 댓글의 본문을 만드는 부분을 순수 함수 하나로 빼서 export한다(이름과 인자는 재량. 테스트가 직접 부른다). `askQuestions`는 그 함수의 결과를 댓글로 단다.
- 본문은 runner가 쓰는 부분(제작자 멘션, 첫 문장, `- 계획:`·`- 답하는 법:` 두 항목)을 지금과 글자까지 같게 두고, 그 뒤에 빈 줄 하나와 `literalBlock(질문 블록들의 글을 빈 줄 하나로 이은 것)`을 붙인다. 블록 뒤에는 아무것도 붙이지 않는다.
- 질문 블록의 글(`OpenQuestion.text`)은 바꾸지 않는다(치환·줄임 없음).
- 라벨 달기, 상태 파일, 이벤트 기록, push는 그대로다.

### 4. 교착 보고의 반박 줄(`scripts/runner/review.ts`, `scripts/runner/run.ts`)

- `scripts/runner/review.ts`에 반박 한 줄을 만드는 순수 함수를 더하고 export한다(이름은 재량): `반박 <N>: 근거 <근거> · 요지 <요지>`.
  - 근거와 요지는 각각 앞 300자까지만 `literalSpan`에 넣는다. `literalSpan`이 `''`를 주면 `—`를 적는다.
- `scripts/runner/run.ts`의 교착 보고는 그 함수를 쓴다. 줄의 들여쓰기와 앞의 `- `, 지적 한 줄(`findingLine`)은 그대로다. `cell`을 더 쓰지 않게 되면 그 import를 지운다.

### 5. 요지에 받지 않는 글자(`scripts/ci/rebuttal.ts`, `scripts/runner/review.ts`)

- `scripts/ci/rebuttal.ts`에 요지 검사 함수를 더하고 export한다(이름은 재량, 아래에서는 `validSummary`): 길이가 1 이상 `SUMMARY_MAX` 이하이고 아래 글자가 하나도 없으면 참이다.
  - 유니코드 속성으로 적는다: `Cc`, `Cf`, `Cs`, `Co`, `Zl`, `Zp`, `Default_Ignorable_Code_Point`. 미할당(`Cn`)은 넣지 않는다(Node의 유니코드 버전에 따라 달라진다).
- `valid`(반박 한 건의 검사)는 요지를 그 함수로 본다. 그래서 `parseRebuttals`와 `parseRebuttalData`가 같은 규칙을 쓴다. 지적·근거의 규칙은 바꾸지 않는다.
- `scripts/runner/review.ts`의 `LINE_SEPARATOR`와 그것을 쓰는 검사를 지운다. `sessionRebuttal`은 `parseRebuttals`의 결과를 그대로 쓴다(근거 확인은 그대로다). 함수 위의 주석도 맞춘다.

### 6. 테스트(구현보다 먼저 커밋한다. 구현 전 실패를 진행 로그에 적는다)

- `scripts/test/literal.test.ts`(새 파일)
  - `literalSpan`: 사례마다 결과를 코드 스팬 모델(테스트 안의 함수. 여는 백틱 줄과 길이가 같은 다음 백틱 줄에서 닫고, 안쪽 글의 앞뒤 공백 하나를 뗀다)로 읽어 스팬이 결과 전체이고 안쪽 글이 원문(줄 나눔 글자의 묶음을 공백 하나로 바꾼 것)과 같은지 본다. 사례: 멘션, `#번호`, `**굵게**`, 백틱 하나·둘·셋이 섞인 글, 백틱으로 시작하고 끝나는 글, 줄 바꿈·U+2028이 든 글, `|`가 든 글. 빈 글과 공백뿐인 글은 `''`다.
  - `literalBlock`: 사례마다 결과를 펜스 블록 모델(테스트 안의 함수. 줄은 `\r\n`·`\n`·`\r`에서 나눈다. 들여쓰기 0~3칸 뒤의 백틱 셋 이상 또는 `~` 셋 이상이 블록을 열고, 같은 글자가 같거나 더 길게 이어지고 뒤가 공백뿐인 줄이 닫는다)로 읽어 블록이 하나이고, 첫 줄에서 열려 마지막 줄에서 닫히며, 안의 글이 원문(`\r\n`·`\r`을 `\n`으로 바꾸고 앞뒤 빈 줄을 뗀 것)과 같은지 본다. 사례: 백틱 3·4·10개인 줄, 들여쓴 백틱 줄, 뒤에 글자가 붙은 백틱 줄, `~~~` 줄, HTML 주석, 멘션과 `#번호`, `\r\n`, 홀로 있는 `\r`, 앞뒤 빈 줄. 빈 글과 공백뿐인 글은 `''`다.
  - `cellCode(s)`가 `literalSpan(s)`의 `|`를 `\|`로 바꾼 것과 같다(사례 여럿).
- 질문 댓글(`scripts/test/runner.test.ts`)
  - 새 순수 함수에 멘션·`#번호`·백틱 넷의 줄·`~~~`·HTML 주석이 든 질문 둘을 넣는다. 본문의 첫 줄이 지금의 첫 문장과 같고(`@<제작자> runner의 … 질문 2건을 남겼다. …`), 펜스 블록 모델로 읽으면 블록이 하나이고 본문의 마지막 줄에서 닫히며, 안의 글이 두 질문의 글을 빈 줄 하나로 이은 것과 같다. 블록 앞부분(runner가 쓴 부분)에는 질문의 글이 한 글자도 없다.
  - 평범한 질문으로 만든 본문을 `classifyEscalation`에 넣으면 `question`이다.
  - 있던 runner 테스트 둘(계획 작성 세션의 질문, step 세션의 질문)에 단언을 더한다: 댓글의 펜스 블록이 하나이고 그 안에 `### 질문:` 줄이 있다. 있던 단언은 그대로 둔다.
- 교착 보고(`scripts/test/runner-review.test.ts`)
  - 새 순수 함수에 백틱·멘션·`#번호`·`|`가 든 근거와 요지를 넣는다. 코드 스팬 모델로 읽으면 스팬이 둘이고 안쪽 글이 각각 근거와 요지다. 스팬 밖의 글은 `반박 1: 근거 `, `· 요지`뿐이다. 빈 값은 `—`다. 300자를 넘는 값은 앞 300자만 들어간다.
  - 있던 교착 테스트의 단언 `/반박 1: .*요지 F1는 이 step의 범위 밖이다/`는 코드 스팬이 된 새 줄에 맞춘다(요지의 글자는 그대로 확인한다). 다른 단언은 그대로 둔다.
  - `sessionRebuttal`: 요지에 U+2028이 든 반박은 지금처럼 `null`이다(있는 단언). 폭 없는 공백(U+200B)이 든 반박도 `null`이다.
- 요지 규칙(`scripts/test/rebuttal.test.ts`)
  - `validSummary`: 받지 않는 글자마다 한 사례씩 거짓이다(탭, U+0085, U+200B, U+200D, U+202E, U+FEFF, U+00AD, U+2028, U+2029, U+FE0F, U+E0041(태그 문자), U+E0100(변형 선택자 보충), U+3164(한글 채움 문자), U+E000(사용자 정의 영역), 짝 없는 서러게이트). 받는 글자는 참이다(한글·영문·구두점, 짝이 맞는 이모지 U+1F600, 결합 문자 U+0301, 줄 바꿈 없는 공백 U+00A0, 전각 공백 U+3000). 빈 글과 301자는 거짓, 300자는 참이다.
  - `parseRebuttals`: 받지 않는 글자가 요지 가운데에 든 문단은 버려지고 같은 댓글의 다른 문단은 남는다.
  - `parseRebuttalData`: 받지 않는 글자가 든 요지를 `rebuttalData`의 형식으로 넣으면 `null`이다.
  - 테스트 파일에는 보이지 않는 글자를 글자 그대로 적지 않고 코드 포인트(`String.fromCodePoint`)나 이스케이프로 적는다.

### 7. 구현 뒤의 확인(진행 로그에 결과를 적는다. AC에는 넣지 않는다: 네트워크가 필요하다)

멘션(`@octocat`)·`#1`·`:tada:`·백틱 넷의 줄이 든 질문으로 만든 질문 댓글 본문과, 같은 글자가 든 근거·요지로 만든 교착 보고의 반박 줄을 GitHub Markdown API(`gh api -X POST markdown -f mode=gfm -f context=<리포> -F text=@<파일>`)로 그린다. 세션의 글 자리에 `user-mention`·`issue-link`·이모지가 없고 `<pre>`·`<code>` 안에 글자 그대로 있어야 한다. runner가 쓴 제작자 멘션은 멘션으로 그려져야 한다.

### 8. 문서

- `docs/harness/workflow.md`
  - 7절의 `runner의 계획 작성 세션이나 step 세션이 "열린 질문"에 남긴 …` 항목: 첫 문장 뒤에 다음 문장을 넣는다. 질문의 글은 댓글의 코드 블록 안에 글자 그대로 들어간다(멘션·`#번호`·Markdown으로 해석되지 않는다).
  - 8절 "형식"의 요지 항목(`요지는 한 줄, 300자 이내다.`)을 다음 글로 바꾼다. 요지는 한 줄, 300자 이내다. 보이지 않는 글자(제어 문자, 폭 없는 글자, 방향 바꿈 문자, 줄·단락 구분자, 변형 선택자, 한글 채움 문자)는 받지 않는다. 변형 선택자나 이음 문자가 든 이모지도 여기에 걸리므로 요지는 글자로만 적는다.
  - 8절 "버려지는 것"의 `300자를 넘거나 제어 문자가 든 요지`를 `300자를 넘거나 받지 않는 글자가 든 요지`로 바꾼다.
  - 8절 "교착" 항목의 `… / C 포기)를 올린다.` 뒤에 `보고에서 반박의 근거와 요지는 코드 스팬으로 적는다.`를 넣는다.
- `docs/harness/design.md`
  - 머리말의 버전과 0절 변경 이력: push 직전의 `origin/main`을 병합한 뒤 그때의 마지막 버전 다음 번호로 한 항목을 더한다.
  - 4.5절의 열린 질문 항목: 질문의 글을 코드 블록에 넣어 올린다는 것과 이유(세션이 쓴 글이라 멘션·Markdown으로 해석되지 않게 한다).
  - 10.2절 (4): 반박 형식 구현의 요지 규칙(받지 않는 글자, 한 함수로 세 자리에서 검사), runner의 반박 항목에서 `TD-36`을 가리키는 문장을 지금의 규칙으로 고치고, 교착 보고의 근거·요지가 코드 스팬이라는 것.
  - 14.6절: 세션이 쓴 글을 GitHub 댓글에 넣을 때는 코드 스팬·코드 블록에 넣는다는 것과, 문자 참조로는 멘션이 막히지 않는다는 것(남은 자리는 새 기술 부채 행을 가리킨다).
- `docs/harness/architecture.md`: 파일 표에 `lib/literal.ts`(두 함수와 쓰는 곳)를 적는다.
- `docs/harness/CHANGELOG.md`: "다음 버전" 끝에 한 항목(`literalSpan`, `literalBlock`, 요지 규칙, 설계서 버전).
- `docs/exec-plans/tech-debt-tracker.md`
  - TD-36 행의 상태를 `해결(#198: …)`로 바꾼다(다른 닫힌 행의 형식).
  - 새 행 둘을 표 끝에 더한다. 번호는 push 직전 `origin/main`의 마지막 번호 다음이다.
    - 문자 참조로 바꿔 넣거나 그대로 넣는 자리: 지적 원장의 표(`cell`), 중단 보고의 지적 한 줄(`findingLine`), 중단 보고의 목표 첫 줄·시도 이력·추정 원인, 승인 요청과 CI 대기 알림의 커밋 상태 설명, 충돌 보고의 파일 이름. 문자 참조는 멘션·Issue 참조·이모지를 막지 못한다는 확인 결과와, 중단 보고는 지표가 읽는 형식이라 함께 바꿔야 한다는 것을 적는다.
    - 봇 댓글을 읽는 코드가 본문 전체에서 표식과 문구를 찾는 것: revert 복원 표식, runner 정지 표식, 지표의 에스컬레이션 분류. 세션의 글이 실린 댓글에서는 그 글 안의 줄도 읽힌다.
- 계획(`plan.md`)의 "발견 사항" 각 항목 끝에 `→ 처리: TD-<번호>`를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/literal.test.ts scripts/test/rebuttal.test.ts scripts/test/runner-review.test.ts scripts/test/runner.test.ts scripts/test/scope.test.ts scripts/test/pr-size.test.ts scripts/test/ci.test.ts scripts/test/metrics-steady.test.ts scripts/test/lib.test.ts
test "$(grep -c 'LINE_SEPARATOR' scripts/runner/review.ts)" = 0
grep -q 'literalSpan' scripts/ci/gates.ts
grep -qF '질문의 글은 댓글의 코드 블록 안에 글자 그대로 들어간다' docs/harness/workflow.md
grep -qF '요지는 한 줄, 300자 이내다. 보이지 않는 글자(제어 문자, 폭 없는 글자, 방향 바꿈 문자, 줄·단락 구분자, 변형 선택자, 한글 채움 문자)는 받지 않는다.' docs/harness/workflow.md
grep -qF '300자를 넘거나 받지 않는 글자가 든 요지' docs/harness/workflow.md
grep -qF '보고에서 반박의 근거와 요지는 코드 스팬으로 적는다.' docs/harness/workflow.md
grep -q 'lib/literal.ts' docs/harness/architecture.md
grep -q 'literalBlock' docs/harness/CHANGELOG.md
grep -qE '^\| TD-36 .*\| 해결\(#198' docs/exec-plans/tech-debt-tracker.md
node scripts/harness.ts doc-lint
```

## 금지사항

- `scripts/ci/ledger.ts`의 `cell`과 `scripts/runner/review.ts`의 `findingLine`을 고치지 마라. 이유: 지적 원장의 모양과 여러 테스트가 함께 바뀌는 일이라 범위 밖이다. 새 기술 부채 행으로 남긴다.
- 질문 댓글의 첫 문장과 두 항목, 중단 보고의 형식(`## 중단 보고:`, `- 추정 원인: ` 줄 등)을 바꾸지 마라. 이유: 지표(`scripts/metrics/source.ts`)와 자체 테스트 시나리오가 그 문구를 읽는다.
- 질문 블록의 글을 치환하거나 줄이거나 지우지 마라. 이유: 제작자가 읽고 답할 원문이다. 막는 방법은 코드 블록이다.
- 문자 참조(`&#…;`)나 역슬래시로 막지 마라. 이유: 렌더러로 확인하니 멘션과 Issue 참조가 그대로 그려진다.
- 요지 규칙을 `scripts/runner/`에 다시 적지 마라. 이유: 규칙이 갈라지면 runner가 단 반박이 판정 워크플로에서 버려지거나, 판정 워크플로가 받지 않을 글자를 runner가 올린다.
- 요지 규칙에서 지금 받지 않는 것(제어 문자, 300자 초과, 빈 요지)을 받게 바꾸지 마라. 지적·근거의 규칙을 바꾸지 마라. 이유: 검사 약화다(R4).
- 있던 테스트의 단언을 지우지 마라. 문구가 바뀌어 맞춰야 하는 것은 교착 보고의 반박 줄을 보는 단언 하나다. 이유: R4.
- `scripts/selftest/`, `scripts/metrics/`, `scripts/hooks/`, `scripts/lib/revert-marker.ts`, `.github/`, `harness.config.json`, `profiles/`를 고치지 마라. 이유: 범위 밖이다.
- `scripts/commands/task.ts`, `scripts/lib/plan.ts`, `scripts/test/lib.test.ts`, `scripts/test/task.test.ts`, `scripts/test/runner-pr.test.ts`를 고치지 마라. 이유: 다른 세션의 PR(#196)이 고치는 중이다.
- `literalSpan`·`literalBlock`이 글자를 지우거나 다른 글자로 바꾸게 하지 마라(위에 적은 줄 나눔 글자의 처리만 한다). 이유: 글자 그대로 보이는 것이 목적이다.
