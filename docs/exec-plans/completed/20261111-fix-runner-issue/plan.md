---
id: 20261111-fix-runner-issue
issue: 5 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active    # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: runner-1 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-11T20:56:02+09:00 # new-task가 채운다
---

# fix: runner 작업 후보를 제작자가 만든 Issue로 한정

## 목표와 수용 기준

설계서 14.6절: 작업 지시는 제작자·외주 개발자가 만든 Issue와 계획에서만 온다. 지금 `scripts/runner/next.ts`의 "선점되지 않은 Issue" 후보 선택(4.5절 우선순위 5번)은 Issue 작성자를 보지 않는다. 그래서 봇 계정(에이전트가 쓰는 계정)이 만든 Issue도 runner가 그대로 가져간다. 프롬프트 주입을 받은 에이전트가 봇 계정으로 Issue를 만들면 runner가 그것을 작업 지시로 실행하는 경로가 된다. 이 경로를 막는다.

수용 기준:

1. runner의 새 Issue 후보(`pickNext` 우선순위 5번)는 작성자가 `github.owner`(제작자)나 `github.collaborators`(외주 개발자, 새 설정)인 Issue뿐이다. 봇 계정, 그 밖의 계정, 작성자를 알 수 없는 Issue는 후보가 아니다.
2. `github.owner`가 비어 있으면 어떤 Issue도 새 후보로 삼지 않는다(fail-closed).
3. 계정 비교는 대소문자를 무시한다(GitHub login은 대소문자를 구분하지 않는다).
4. 작성자 때문에 후보에서 뺀 Issue는 번호와 이유가 `start`·`next` 출력에 보인다. runner 정지 조건(`waiting` 수)은 바뀌지 않는다.
5. 봇 Issue 처리는 설정 `github.botIssues`로 정한다. 기본값 `exclude`는 제외한다. `owner-approved`는 제작자 계정이 `/harness accept` 한 줄 댓글을 단 봇 Issue만 후보로 삼는다. 어느 값을 쓸지는 제작자에게 묻는다("열린 질문"). 답이 오기 전에는 `exclude`로 둔다.
6. 우선순위 1~4번(답을 받은 needs-human, 내 PR 조치, 진행 중인 step, 다음 step)은 동작이 바뀌지 않는다. 이미 선점한 계획은 작성자와 관계없이 이어 간다.
7. 모든 동작 변경은 `github-fake` 기반 테스트로 확인하고, `node scripts/harness.ts check`가 통과한다.
8. 설계서 4.5·14.6절, 절차서 1절, CHANGELOG가 새 규칙을 설명한다.
9. runner(`node scripts/harness.ts run --worker runner-1`)가 step0·step1을 실제 GitHub에서 사람 개입 없이 병합까지 진행한다. 로드맵 1단계 완료 기준(사람 개입 없이 마지막 step까지)을 실제 환경에서 확인하는 시험을 겸한다.

## 범위 / 비범위

- 범위
  - Issue 작성자 조회: `GitHubPort`의 `Issue` 타입, gh CLI 구현, 가짜 GitHub
  - 설정: `github.collaborators`, `github.botIssues`와 검증
  - runner 후보 필터(`pickNext` 5번)와 제외 목록 출력(`start`, `next`)
  - 봇 Issue의 제작자 승인 댓글 판정(설정이 `owner-approved`일 때만 동작)
  - 테스트, 설계서·절차서·CHANGELOG, 기술 부채 등록
- 비범위
  - 대화 세션의 `new-task --issue` 수동 선점. 제작자가 대화로 지시하는 경로라 작성자를 보지 않는다.
  - needs-human 답변 인정(`latestOwnerAnswer`, 9.1절) 변경
  - Issue를 만든 뒤 본문·제목을 고친 경우의 감지(TD-19)
  - runner가 계획 작성 세션의 "열린 질문"을 자동으로 에스컬레이션하는 기능(TD-18)
  - 라벨·리액션 기반 승인(열린 질문 C안). 제작자가 고르면 후속 Issue로 한다.
  - `init`에 외주 개발자 계정 옵션 추가
  - 실제 `gh`를 부르는 테스트

## 관련 파일·문서

- scripts/lib/github.ts
- scripts/lib/github-fake.ts
- scripts/lib/config.ts
- scripts/runner/next.ts
- scripts/commands/start.ts
- scripts/harness.ts
- scripts/test/next.test.ts
- scripts/test/helpers.ts
- scripts/test/lib.test.ts
- harness.config.json
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261111-fix-runner-issue/

## step 목록

- step0 issue-author: Issue 작성자 조회, `github.collaborators` 설정, `pickNext` 후보를 제작자·외주 개발자 Issue로 한정(봇 Issue 제외), 제외 목록 출력, 문서, TD-18·TD-19 등록
- step1 bot-approval: 설정 `github.botIssues`(`exclude` 기본 | `owner-approved`)와 제작자 `/harness accept` 댓글 판정, 문서

## 진행 로그

- 2026-11-11 21:02 계획 작성(runner-1 무인 세션). `next.ts`·`github.ts`·`github-fake.ts`·`config.ts`·`run.ts`(`doPlanning`)·`.claude/runner-settings.json`, 설계서 4.5·14.6절을 읽었다. 봇 Issue 처리는 열린 질문으로 남기고, 답이 없어도 마지막 step까지 갈 수 있게 설정 스위치(기본값 `exclude`)로 나눴다(의사결정 로그). 무인 세션은 `gh`가 막혀 있어 Issue에 질문 댓글을 달지 못했다(발견 사항).
- 2026-11-11T21:05:08+09:00 계획 작성 완료
- 2026-11-11 step0 issue-author(runner-1 무인 세션). 먼저 실패한 테스트: `node --test scripts/test/next.test.ts` → `SyntaxError: The requested module '../runner/next.ts' does not provide an export named 'filterTrustedIssues'`(1 fail). 구현: `Issue.author`와 `toIssue`(gh `--json`에 `author`), 가짜 GitHub `addFakeIssue(..., author?)`(생략 시 제작자, 옛 상태·PR 그림자는 `''`), `github.collaborators`(없으면 `[]`, 문자열 배열 아니면 `ConfigError`), `sameLogin`·`filterTrustedIssues`·`Pick.excluded`, idle 이유 끝에 "작성자 확인으로 제외: #N", `start` ③과 `next`(일반·`--json`)에 제외 목록. 일반 `next` 출력에도 제외 줄을 넣었다(수용 기준 4가 `start`·`next`를 함께 요구해서, 출력 형식은 `describeExcluded` 하나로 공유). 그 뒤 `next.test.ts` 13개 통과, `runner.test.ts`는 기대값을 고치지 않고 통과. 설계서 v0.7.5(4.5·14.6절), 절차서 1절, architecture, CHANGELOG, TD-18·TD-19 등록(번호 그대로).
- 2026-11-12 step1 bot-approval(runner-1 무인 세션). 먼저 실패한 테스트: `node --test scripts/test/next.test.ts` → `SyntaxError: The requested module '../runner/next.ts' does not provide an export named 'BOT_ISSUE_ACCEPT'`(1 fail). 구현: `github.botIssues`(`BotIssuesMode`, 없으면 `exclude`, 두 값이 아니면 `ConfigError`), `harness.config.json`에 `"botIssues": "exclude"` 명시, `BOT_ISSUE_ACCEPT`·`BOT_ISSUE_WAITING_REASON`·`ownerAccepted`(제작자 댓글만, 줄 단위 정확히 일치, 펜스 코드 블록 안은 건너뜀), `filterTrustedIssues(issues, cfg, comments)`(owner-approved이고 봇 Issue일 때만 댓글 조회, 조회 예외는 그 Issue만 "댓글 조회 실패: <첫 줄>"로 제외), `pickNext` 5번은 `(n) => gh.comments(n)`, `start` ③에 승인 안내 한 줄(`acceptHint`, exclude면 없음), 가짜 GitHub `commentAs`. 그 뒤 `next.test.ts` 28개 통과(새 15개), `runner.test.ts`는 기대값을 고치지 않고 통과. 펜스 판정은 CommonMark 규칙 일부(같은 문자·여는 펜스 이상 길이·3칸까지 들여쓰기·정보 문자열이 붙은 줄은 닫지 않음)를 따랐다. 4칸 들여 쓴 ` ``` `이 펜스를 닫는 것으로 잘못 보면 코드 블록 안의 줄이 승인으로 인정되기 때문이다. 설계서 14.6절(v0.7.5 유지)·4.5절 5번, 절차서 1절, CHANGELOG, TD-20 등록(발견 사항).
- 2026-11-12T13:36:44+09:00 중단: origin/main 병합이 충돌한다(docs/exec-plans/tech-debt-tracker.md, docs/harness/CHANGELOG.md, docs/harness/design.md, scripts/commands/start.ts, scripts/test/next.test.ts). 병합은 취소했다. 절차서 5절대로 worktree에서 병합해 충돌을 풀고 일반 push한다
- 2026-11-12T15:35:07+09:00 제작자 답변 받음(#5)

## 의사결정 로그

- 결정: 봇 Issue 처리를 설정 `github.botIssues`로 두고 기본값은 `exclude`(A안)로 한다. 추천안인 B안(`owner-approved`)은 step1에서 함께 구현하되 꺼 둔다. 이유: Issue #5는 (1) 봇 Issue 처리를 제작자에게 묻고 (2) runner가 사람 개입 없이 마지막 step까지 가기를 함께 요구한다. 무인 세션은 답을 기다릴 수 없고, runner는 계획 작성 세션의 열린 질문을 needs-human으로 올리지 않는다(발견 사항). 스위치로 나누면 답이 A면 할 일이 없고, B면 설정값 하나만 바꾸면 되며, 보안 결정은 제작자에게 남는다. 버린 대안: 계획 작성 후 멈춤(runner가 멈춤을 알아채지 못하고 step으로 넘어간다. 시험 목적과도 충돌), B를 기본값으로(보안 결정을 제작자 대신 내린다), B를 후속 Issue로 미룸(추천안이 B라 답이 오면 계획을 하나 더 돌려야 하고, 그동안 "대화 → 봇 등록 → runner" 흐름이 끊긴다).
- 결정: 제작자 표시는 제작자 계정 댓글의 `/harness accept` 한 줄로 한다. 이유: 기존 `GitHubPort.comments()`와 가짜 GitHub로 확인할 수 있다. 9.1절 답변 인정과 같은 근거(댓글 작성자는 봇이 흉내 낼 수 없다)를 쓴다. 모바일에서도 된다. 버린 대안: 라벨(봇도 붙일 수 있어 timeline API로 붙인 계정을 따로 확인해야 한다), 리액션(👍의 뜻이 모호하고 API가 늘어난다), 제작자의 아무 댓글(“보류” 같은 댓글도 승인이 된다).
- 결정: 봇 Issue 승인은 제작자(`github.owner`)만 할 수 있다. 이유: 외주 개발자는 자기 계정으로 Issue를 만들면 되므로 승인 권한이 필요 없다. 9.1절도 제작자 답만 인정한다.
- 결정: `github.owner`가 비면 새 Issue 후보가 없다(fail-closed). 이유: 14.6절. 버린 대안: 비면 필터를 끄는 것(지금 동작. 설정 누락이 곧 우회가 된다).
- 결정: 작성자 필터는 우선순위 5번(새 Issue 선점)에만 적용한다. 이유: 이미 선점한 작업은 선점 때 판단이 끝났다. 이 Issue #5도 봇이 대신 등록했으므로, 1~4번에 소급하면 이 계획이 step0 병합 직후 스스로 멈춘다.
- 결정: 계정 비교는 소문자로 바꿔 비교하고, 빈 문자열은 어떤 계정과도 같지 않다. 이유: 설정은 사람이 적고 API는 GitHub 표기로 준다. 삭제된 계정(`author: null`)은 `''`이 되어 항상 제외된다.
- 결정: `risk: normal`을 유지한다. 이유: 작업 접수 범위를 좁히는 변경이다. 넓히는 경로(B안)는 기본으로 꺼져 있고 켜려면 보호 경로(`harness.config.json`)를 바꿔야 한다. 자격 증명·인증 코드는 건드리지 않는다. 제작자가 high로 보면 바꿀 수 있다.
- 결정: step을 2개로 나누고 각 step이 자기 문서를 함께 고친다. 이유: PR마다 문서와 동작이 맞는 상태로 병합된다. step0만 병합돼도 A안이 완성된다.

## 발견 사항

- runner의 계획 작성 처리(`scripts/runner/run.ts` `doPlanning`)는 plan-gate만 통과하면 계획을 `active`로 바꾸고 step으로 넘어간다. 계획 작성 세션이 "열린 질문"을 적어도 needs-human 라벨과 제작자 멘션이 붙지 않는다. runner 세션은 `gh`가 막혀 있어(`.claude/runner-settings.json`) 세션이 직접 물을 수도 없다. 무인 세션 규칙의 "열린 질문에 적고 멈춰라"는 실제로 멈추지 않는다. 이 계획은 답 없이 끝까지 가도록 짰다(의사결정 로그). → 처리: TD-18
- 작성자 확인은 Issue를 만든 계정만 본다. 봇 계정은 리포 쓰기 권한으로 제작자가 만든 Issue의 제목·본문도 고칠 수 있다. 만든 뒤 고쳐서 지시를 바꾸는 경로는 이 계획으로 막히지 않는다. 막으려면 GraphQL `lastEditedAt`·`editor`(또는 `userContentEdits`)로 마지막 편집자를 확인해야 한다. B안의 승인 댓글 뒤 수정도 같은 문제다. → 처리: TD-19
- (step1) 댓글 수정도 같은 문제다. GitHub 문서상 쓰기 권한 계정은 다른 사람의 Issue 댓글을 고칠 수 있다(실제 리포에서는 시험하지 않음). 그러면 봇이 제작자의 아무 댓글이나 `/harness accept`로 바꿀 수 있고, 댓글 작성자만 보는 `ownerAccepted`는 이를 막지 못한다. 기존 9.1절 답변 인정(`latestOwnerAnswer`)도 같다. 그래서 "댓글 작성자는 봇이 흉내 낼 수 없다"는 근거는 TD-20이 풀릴 때까지 완전하지 않다. REST 댓글의 `updated_at`으로 고친 댓글을 거부하는 방법도 있지만, 보안 판정 규칙을 바꾸는 결정이고(9.1절) step 지시 범위 밖이라 구현하지 않았다. 기본값 `exclude`에서는 승인 경로가 꺼져 있어 지금은 영향이 없다. TD-19(Issue 본문 수정)와 원인은 같지만 대상(댓글)과 영향 범위(9.1절 답변 인정 포함)가 달라 따로 등록했다. 설계서 14.6절 "한계"와 열린 질문 B의 영향에 적었다. → 처리: TD-20
- (step1) 마크다운 렌더링과 판정이 다른 경계 사례가 남는다. 인용 바로 다음 줄에 빈 줄 없이 쓴 `/harness accept`(인용의 이어지는 줄로 렌더링)와 4칸 들여쓰기 코드 블록 안의 줄은 승인으로 인정된다. step 지시(앞뒤 공백을 뺀 한 줄, 펜스 안만 건너뜀)대로다. 제작자 계정 댓글만 보므로 봇이 이 경로를 쓸 수는 없고, 제작자가 의도하지 않은 승인이 될 수 있는 정도다. → 처리: 해당 없음

## 열린 질문

### 질문: 봇 계정이 만든 Issue를 runner 작업 후보로 받을까

- A) 제외한다 — 설정 `github.botIssues: "exclude"`(이 계획의 기본값). 영향: runner는 제작자가 GitHub 웹·모바일에서 직접 만든 Issue(와 외주 개발자 Issue)만 가져간다. 대화에서 봇이 대신 등록한 Issue(이 #5처럼)는 대화 세션의 `new-task --issue`로만 시작된다. 추가 작업은 없다.
- B) 제작자 표시가 있으면 받는다 — 설정 `"owner-approved"`. 제작자 계정이 그 Issue에 `/harness accept` 한 줄 댓글을 달면 후보가 된다. 영향: "대화 → 봇 등록 → 제작자 한 줄 확인 → runner" 흐름이 유지된다. 확인은 댓글 작성자로 하므로 봇이 흉내 낼 수 없다(9.1절 답변 인정과 같은 근거). step1이 구현해 두므로 `harness.config.json` 한 줄 PR(보호 경로)이면 켜진다. 취소하려면 Issue를 닫거나 `needs-human` 라벨을 붙인다. 추가 영향(step1에서 발견): 쓰기 권한 계정은 다른 사람의 댓글을 고칠 수 있어, TD-20이 풀리기 전에는 봇이 제작자의 기존 댓글을 `/harness accept`로 바꾸는 경로가 남는다(9.1절 답변 인정도 같다). B를 켜기 전에 TD-20을 먼저 할지도 함께 정해 달라.
- C) 제작자가 붙인 라벨(예: `accepted`)이 있으면 받는다 — 영향: 모바일에서 라벨 하나로 끝난다. 봇도 라벨을 붙일 수 있으므로 라벨을 붙인 계정을 timeline API로 확인해야 한다(Issue마다 조회 1회 추가). 이 계획에서는 구현하지 않는다. 고르면 후속 Issue로 한다.
- 추천: B. 이유: 지금 제작자는 대화로 지시하고 봇이 Issue를 대신 등록한다(#5). A는 이 흐름을 끊고, C는 확인 비용이 더 들고 B보다 나은 보안 근거가 없다. B는 제작자 계정의 행동 하나를 요구하므로 14.6절("작업 지시는 제작자 Issue에서만")의 취지를 지킨다.
- 진행: runner가 답을 기다리지 않도록 이 계획은 A를 기본값으로 두고 B를 꺼진 스위치로 구현한다. 답은 Issue #5에 제작자 계정 댓글로 달면 된다.

## 검증 방법과 결과

- step별 AC: runner가 각 step 파일의 ```bash 블록을 직접 실행해 판정한다.
- `node scripts/harness.ts check`(fmt·lint·test·doc-lint·우회 탐지·시크릿 스캔)
- 가짜 GitHub 시나리오: `scripts/test/next.test.ts`
  - step0: 제작자·외주 개발자 Issue는 후보, 봇·다른 계정·작성자 불명 Issue는 제외, 우선순위 라벨이 높은 봇 Issue를 건너뛰고 제작자 Issue를 고름, 대소문자 무시, `github.owner`가 비면 후보 없음, idle 이유에 제외 번호
  - step1: `exclude`면 승인 댓글이 있어도 제외하고 댓글을 조회하지 않음, `owner-approved`면 제작자 `/harness accept` 댓글이 있을 때만 후보, 봇·외주 개발자 댓글이나 인용·문장 속 언급은 불인정, 봇이 아닌 계정의 Issue에는 승인 경로 없음
- 회귀: 기존 `scripts/test/runner.test.ts`(S6: Issue → 계획 → step 2개 → 자동 병합)가 고치지 않고 통과
- 실제 환경: runner가 step0·step1 PR 두 개를 사람 개입 없이 병합하고, 마지막 PR이 `Closes #5`로 Issue를 닫는다. 병합 뒤 대화 세션에서 `node scripts/harness.ts next`를 실행해 봇이 만든 열린 Issue가 "작성자 확인으로 제외"에 나오는지 본다.
- 결과
  - step0(2026-11-11): AC 전부 통과. `node --test scripts/test/next.test.ts scripts/test/runner.test.ts` 15 pass / 0 fail. `node scripts/harness.ts check` 통과(fmt·lint·test·doc-lint·bypass-scan·secret-scan). doc-lint R8 경고 6건(ADR-0001·0002·0003·0005, architecture.md, workflow.md의 `related_code`가 문서보다 나중에 바뀜)은 경고다. architecture.md·workflow.md는 이 step에서 함께 고쳤고, ADR들은 이 변경(Issue 작성자 확인)과 결정 내용이 무관해 고치지 않았다.
  - step1(2026-11-12): `node --test scripts/test/next.test.ts scripts/test/runner.test.ts` 30 pass / 0 fail(next 28: step0 13 + step1 15, runner 2). AC grep 6개 통과. `node scripts/harness.ts check` 통과(fmt·lint·test·doc-lint·bypass-scan·secret-scan). doc-lint R8 경고 4건(ADR-0001·0002·0003·0005)은 step0과 같은 경고이고, ADR 결정 내용과 무관해 고치지 않았다.

## 다음 할 일

- runner: step0 issue-author부터 진행한다. step0 병합 뒤 step1 bot-approval.
- 제작자: "열린 질문"에 답한다(Issue #5에 제작자 계정 댓글). B면 `harness.config.json`의 `github.botIssues`를 `"owner-approved"`로 바꾸는 PR을 승인한다. 그 전에 TD-20(고친 댓글 미확인)을 먼저 처리할지 정한다.
- 제작자: 외주 개발자 계정이 생기면 `harness.config.json`의 `github.collaborators`에 넣는다.
