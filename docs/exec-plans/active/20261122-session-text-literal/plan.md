---
id: 20261122-session-text-literal
issue: 198 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: draft # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T10:40:57+09:00 # new-task가 채운다
---

# 무인 세션이 쓴 글이 Issue 댓글과 검증자 입력에서 그대로 해석되지 않게 한다 (TD-36)

## 목표와 수용 기준

무인 세션(runner가 띄운 세션)이 쓴 글이 사람과 검증자에게 나가는 곳 가운데 막지 않은 곳이 남아 있다(기술 부채 표 TD-36, 설계서 14.6절, 10.2절 (4)). 주입된 세션이 그 글로 임의 계정을 멘션하거나, 댓글의 모양을 바꾸거나, 보이지 않는 글자로 검증자에게 숨은 글을 넘길 수 있다. 세 곳을 막는다.

- runner가 Issue에 올리는 열린 질문의 글(TD-36의 (1)).
- runner의 교착 보고에 들어가는 반박의 근거와 요지. TD-36은 이 자리를 "막았다"고 봤지만 막히지 않았다: 문자 참조(`&#64;` 등)로 바꾼 글자도 GitHub은 멘션·Issue 참조·이모지로 그린다("발견 사항" 첫 항목).
- 검증자 입력(`.harness-review/rebuttals.md`)에 쓰이는 반박의 요지(TD-36의 (2)).

수용 기준:

1. 열린 질문의 글은 Issue 댓글에서 펜스 코드 블록 하나 안에 글자 그대로 들어간다.
   - 질문 블록의 글은 `openQuestions`가 계획에서 뽑은 글(`OpenQuestion.text`)이다. 뽑을 때 HTML 주석은 빠지고 블록 끝의 공백은 떼어진다. 이 추출은 지금과 같고 바꾸지 않는다.
   - 그 글에 멘션(`@계정`), `#번호`, Markdown, 닫히지 않은 HTML 주석, 코드 펜스(백틱 셋 이상의 줄, `~~~`)가 있어도 블록은 댓글의 마지막 줄에서만 닫힌다. 여는 펜스의 백틱 수는 글 안의 가장 긴 백틱 줄보다 하나 많고 셋 이상이다.
   - runner가 쓰는 부분은 그대로다: 제작자 멘션으로 시작하는 첫 문장(`runner의 … 세션이 질문 N건을 남겼다. …`), 계획·답하는 법 두 항목. 지표(`scripts/metrics/source.ts`)가 그 문장으로 에스컬레이션을 센다.
   - 블록 안의 글은 뽑은 글들을 빈 줄 하나로 이은 것과 같다. 다른 것은 둘뿐이다: 줄 바꿈 글자(`\r\n`, 홀로 있는 `\r`)를 `\n`으로 맞추고 앞뒤의 빈 줄을 뗀다.
   - 계획 본문에서 댓글까지를 테스트가 확인한다: 계획의 "열린 질문"에 적은 질문을 runner와 같은 순서(`parseDoc`으로 읽은 본문을 `openQuestions`에 넣는다)로 뽑아 댓글 본문을 만든 결과를 본다.
2. 교착 보고의 반박 줄(`반박 N: 근거 … · 요지 …`)은 근거와 요지를 각각 코드 스팬 하나로 적는다. 값에 백틱·멘션·`#번호`가 있어도 스팬 안에 글자 그대로 남는다. 값이 비면 지금처럼 `—`다.
3. 반박의 요지는 한 곳(`scripts/ci/rebuttal.ts`)의 규칙으로 검사한다.
   - 받지 않는 글자: 제어 문자(Cc), 형식 문자(Cf: 폭 없는 글자, 방향 바꿈 문자, 태그 문자 등), 짝 없는 서러게이트(Cs), 사용자 정의 영역(Co), 줄·단락 구분자(Zl, Zp), 기본 무시 글자(`Default_Ignorable_Code_Point`: 변형 선택자, 한글 채움 문자 등).
   - 길이 규칙(1자 이상 300자 이하)은 그대로다. 위 글자가 없는 요지(한글, 영문, 구두점, 짝이 맞는 이모지, 결합 문자, 줄 바꿈 없는 공백)는 지금처럼 전달된다.
   - 댓글에서 뽑은 요지는 앞뒤 공백을 떼기(`trim`) 전에 받지 않는 글자를 검사한다. 그 글자가 요지의 앞이나 끝에만 있어도(탭, U+FEFF 등) 그 반박은 버려진다. 지금은 떼는 과정에서 사라져 받아들여진다. 길이는 지금처럼 앞뒤 공백을 뗀 글로 센다. job 사이로 넘긴 값은 지금처럼 떼지 않고 값 그대로 검사한다.
   - 판정 워크플로의 두 자리(댓글에서 고르는 `parseRebuttals`, job 사이에 넘긴 값을 다시 읽는 `parseRebuttalData`)와 runner(`sessionRebuttal`)가 같은 함수로 검사한다. runner가 따로 두던 줄 구분자 검사(`scripts/runner/review.ts`의 `LINE_SEPARATOR`)는 없앤다.
4. 코드 스팬과 코드 블록을 만드는 함수는 한 곳(`scripts/lib/literal.ts`)에 있고, 판정 job 요약의 `cellCode`(`scripts/ci/gates.ts`)도 그 함수를 쓴다. `cellCode`의 결과는 글자까지 그대로다.
5. 검사를 약화하지 않는다(R4). 반박 형식 규칙은 받지 않는 것이 늘어나는 쪽으로만 바뀐다. 기존 테스트의 단언은 지우지 않는다(문구가 바뀐 댓글을 보는 단언은 새 문구로 맞춘다).
6. 절차서 8절, 설계서(4.5절, 10.2절 (4), 14.6절), 구조 문서, 변경 이력이 위와 맞고, 기술 부채 표의 TD-36은 해결로 닫히며 "발견 사항"의 남은 일은 새 행으로 남는다.

## 범위 / 비범위

범위:

- `scripts/lib/literal.ts`(새 파일): `literalSpan`, `literalBlock`.
- `scripts/runner/run.ts`: 질문 댓글의 본문을 만드는 부분, 교착 보고의 반박 줄.
- `scripts/runner/review.ts`: 교착 보고의 반박 줄을 만드는 함수, `sessionRebuttal`의 줄 구분자 검사 제거.
- `scripts/ci/rebuttal.ts`: 요지 검사 함수.
- `scripts/ci/gates.ts`: `cellCode`가 `literalSpan`을 쓴다.
- 문서와 기술 부채 표.

비범위(남은 일은 step0이 기술 부채 표의 새 행으로 적는다):

- 지적 원장의 표(`scripts/ci/ledger.ts`의 `cell`)와 중단 보고의 "교차 검증 의견" 가운데 지적 한 줄(`findingLine`). 검증자 출력을 문자 참조로 바꿔 넣는데 멘션은 막히지 않는다. 원장 댓글의 모양과 테스트가 함께 바뀌는 일이라 따로 한다.
- 중단 보고·승인 요청·CI 대기 알림·충돌 보고의 다른 값(계획 목표의 첫 줄, 시도 이력의 출력 줄, 추정 원인, 커밋 상태의 설명, 충돌 파일 이름). 지표가 중단 보고의 `- 추정 원인: ` 줄을 읽으므로 형식을 바꾸려면 지표와 함께 바꿔야 한다.
- revert 복원 표식(`scripts/lib/revert-marker.ts`)을 봇 댓글의 본문 어디에서든 읽는 것. 세션이 쓴 글이 봇 댓글에 실리면 그 글 안의 표식도 봇의 표식으로 읽힌다(코드 블록 안이어도 같다).
- 질문 댓글의 길이 상한. 지금도 없다.
- 계획 파일·PR 본문·커밋 메시지에 들어가는 세션의 글. 검증자가 PR 트리(데이터)로 읽는다.
- runner가 다는 반박 PR 댓글(`rebuttalComment`). 이미 코드 블록이다(PR #96).

## 관련 파일·문서

- `scripts/lib/literal.ts`(새 파일)
- `scripts/runner/run.ts`, `scripts/runner/review.ts`
- `scripts/ci/rebuttal.ts`, `scripts/ci/gates.ts`
- `scripts/test/literal.test.ts`(새 파일), `scripts/test/markdown-model.ts`(새 파일. 테스트들이 함께 쓰는 코드 스팬·펜스 블록 모델), `scripts/test/rebuttal.test.ts`, `scripts/test/runner.test.ts`, `scripts/test/runner-review.test.ts`
- `docs/harness/workflow.md`(8절), `docs/harness/architecture.md`(파일 표), `docs/harness/CHANGELOG.md`
- `docs/harness/design.md`(0절 머리말·변경 이력, 4.5절, 10.2절 (4), 14.6절), `docs/exec-plans/tech-debt-tracker.md`(TD-36 행, 새 행 둘)
- 읽기만: `scripts/ci/ledger.ts`(`cell`, `oneLine`), `scripts/lib/plan.ts`(`openQuestions`), `scripts/metrics/source.ts`(`classifyEscalation`), `scripts/lib/revert-marker.ts`, `scripts/selftest/fake-agent.ts`, `scripts/test/helpers.ts`, `scripts/test/scope.test.ts`(`tableCells`, `codeSpanText`), `scripts/test/pr-size.test.ts`, `scripts/test/metrics-steady.test.ts`

## step 목록

- step0 literal-text: 질문 댓글의 코드 블록, 교착 보고의 코드 스팬, 요지에 받지 않는 글자, 문서와 기술 부채 표

## 진행 로그

- 2026-11-22 10:41 `new-task --issue 198`로 시작했다(제작자 대화 지시의 다음 순서, TD-36). 계획을 쓰기 전에 runner가 댓글을 다는 일곱 자리와 반박 형식 코드를 읽었고, GitHub Markdown API로 문자 참조·코드 스팬·코드 블록의 렌더링을 확인했다("발견 사항").
- 2026-11-22 10:56 계획 검증 1회차(PR #199, head `92c1029`): claude 승인(P2 둘, 미룸), codex 수정 요청(P1 셋). 오래 열린 지적 표시는 없었다. 셋 다 맞는 지적이라 계획을 고쳤다. F3: 질문의 글은 `openQuestions`가 뽑은 글이라 HTML 주석과 끝의 공백은 이미 빠져 있다. 보존 기준의 입력을 그 글로 적고 계획 본문에서 댓글까지 보는 테스트를 더했다. F4: 댓글 파서가 요지를 `trim`한 뒤 검사해 앞뒤의 금지 글자가 사라진다. 떼기 전에 검사하게 했다. F5: 설계서의 세 절, 새 기술 부채 행 둘, 발견 사항의 처리 표기를 AC가 확인하게 했다. 미룬 P2 둘(F1 앞뒤 빈 줄, F2 300자 자르기가 서러게이트 쌍을 가른다)도 함께 반영했다.
- 2026-11-22 11:04 계획 검증 2회차(head `b91487b`): claude 승인, codex가 F3·F4·F5를 해결로 닫고 F6(P1)을 냈다. 오래 열린 지적 표시는 없었다. F6: 계획 본문에서 댓글까지 보는 테스트가 `\r\n`인 글을 `openQuestions`에 바로 넣게 돼 있었다. `openQuestions`는 `\n`으로 줄을 나눠 제목 줄 끝에 `\r`이 남으면 예외가 난다(로컬 초안 테스트에서도 같은 예외를 봤다). runner는 `parseDoc`으로 먼저 읽으므로 테스트도 같은 순서로 읽게 고쳤다.
- 2026-11-22 11:05 계획 검증 3회차(head `2f78057`): claude·codex 승인(해시 `022b61f0b4a4`). F6은 해결로 닫혔다.
- 2026-11-22 11:08 테스트 먼저: 테스트만 담은 커밋(`literal.test.ts`, `markdown-model.ts`, `rebuttal.test.ts`, `runner-review.test.ts`, `runner.test.ts`)에서 네 테스트 파일이 모두 실패했다(`scripts/lib/literal.ts`가 없고 `questionComment`·`rebuttalReportLine`·`validSummary`가 export되지 않는다). 구현 커밋 뒤 step0의 AC 명령 스물(테스트 191건, `doc-lint`, 문서 확인)이 통과한다.
- 2026-11-22 11:10 구현 뒤의 확인: 멘션(`@octocat`)·`#1`·`:tada:`·굵게·백틱 넷의 줄·`~~~`·닫히지 않은 HTML 주석이 든 질문으로 만든 질문 댓글과, 같은 글자가 든 근거·요지로 만든 교착 보고의 반박 줄을 GitHub Markdown API(`mode=gfm`, 리포 context)로 그렸다. 질문 댓글: 멘션 링크는 runner가 쓴 제작자 멘션 하나뿐이고, 질문의 글은 `<pre>` 하나 안에 글자 그대로 있었다(Issue 링크·이모지·굵게 없음). 반박 줄: 근거와 요지가 `<code>` 둘에 글자 그대로 있었고 멘션·Issue 링크·이모지가 없었다.
- 2026-11-22 11:11 구현과 완료 처리를 한 번에 올린다. 판정 횟수를 줄이려는 것이고, 구현 판정에서 지적이 나오면 step을 되돌려 고친다.

## 의사결정 로그

- 결정: 질문의 글은 코드 블록에 넣는다. / 이유: GitHub 렌더러로 확인하니 코드 스팬과 코드 블록 안의 글자만 멘션·`#번호`·이모지·Markdown으로 그려지지 않았다. / 버린 대안: 문자 참조로 바꾸기(TD-36이 든 다른 방법). 멘션과 Issue 참조가 그대로 그려진다. 역슬래시로 막기는 원문이 읽기 어렵고 멘션을 막지 못한다.
- 결정: 교착 보고의 반박 줄을 이 계획에 넣는다. / 이유: 세션이 쓴 글(근거·요지)이 Issue로 나가는 자리이고 TD-36이 막혔다고 본 근거(문자 참조)가 틀렸다. 고치는 곳이 한 줄이다. / 버린 대안: 새 기술 부채로만 남기기. 같은 계획이 "세션의 글"을 막는다고 적으면서 알고 있는 자리를 남기게 된다.
- 결정: 지적 원장의 표와 중단 보고의 다른 값은 넣지 않고 기술 부채로 남긴다. / 이유: 원장은 검증자 출력이고(세션의 글이 아니다) 원장 댓글의 모양과 여러 테스트가 바뀐다. 중단 보고는 지표가 읽는 형식이다. PR 하나의 목적을 넘는다. / 버린 대안: 한 PR에 모두 넣기.
- 결정: 요지에서 변형 선택자와 폭 없는 이음 문자(ZWJ)도 받지 않는다. / 이유: 보이지 않는 글자는 검증자(LLM)에게 숨은 글을 넘기는 길이다(태그 문자, 변형 선택자). 그 결과 `⚠️`처럼 변형 선택자가 붙은 이모지나 ZWJ로 이은 이모지가 든 요지는 버려진다. 절차서 8절에 적는다. / 버린 대안: 이모지에 쓰이는 선택자만 허용하기. 규칙이 복잡해지고 숨길 자리가 남는다.
- 결정: 미할당 코드 포인트(Cn)는 규칙에 넣지 않는다. / 이유: 무엇이 미할당인지는 Node의 유니코드 버전에 달려 있어, runner의 머신과 CI가 같은 요지를 다르게 판정할 수 있다. / 버린 대안: `\p{C}` 전체를 막기.
- 결정: step은 하나다. / 이유: 세 변경이 함수 둘(`literalSpan`, `literalBlock`)과 규칙 하나를 나눠 쓰고 문서의 같은 절을 고친다. 위험도 높음이라 PR마다 제작자 승인이 필요하다. / 버린 대안: 질문과 반박을 두 step으로 나누기.

## 발견 사항

- 문자 참조는 멘션을 막지 못한다. GitHub Markdown API(`mode=gfm`, 리포 context)에 `&#64;계정 &#35;1 &#58;tada&#58;`를 넣으니 멘션 링크·Issue 링크·이모지로 그려졌다(굵게 같은 Markdown 서식만 막혔다). 코드 스팬과 코드 블록 안의 같은 글자는 그대로였다. 그래서 `cell`(`scripts/ci/ledger.ts`)로 바꿔 넣는 자리(지적 원장의 표, 중단 보고의 지적 한 줄, 교착 보고의 반박)는 멘션에 열려 있다. → 처리: TD-65
- 중단 보고(`blockPlan`)의 목표 첫 줄·시도 이력의 출력 줄·추정 원인, 승인 요청과 CI 대기 알림의 커밋 상태 설명, 충돌 보고의 파일 이름은 세션·PR이 정하는 글자인데 그대로 들어간다. → 처리: TD-65
- revert 복원 표식은 봇 계정 댓글의 본문 전체에서 찾는다. runner가 봇 계정으로 다는 댓글에 세션의 글이 실리므로, 그 글 안의 표식 모양 줄이 봇의 표식으로 읽힐 수 있다. → 처리: TD-66

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 Acceptance Criteria.
- `node scripts/harness.ts check`.
- 구현 뒤의 확인(진행 로그에 결과를 적는다): 만든 질문 댓글과 교착 보고의 반박 줄을 GitHub Markdown API로 그려 세션의 글 자리에 멘션 링크·Issue 링크가 없고 코드 블록·코드 스팬 안에 글자 그대로 있는지 본다.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다(테스트 먼저).
