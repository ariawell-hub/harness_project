# Step 1: bot-approval

봇 계정이 만든 Issue의 처리 방식을 설정 `github.botIssues`로 고를 수 있게 한다. 기본값 `exclude`는 step0과 같이 제외한다. `owner-approved`는 제작자 계정이 `/harness accept` 한 줄 댓글을 단 봇 Issue만 후보로 삼는다. 어느 값을 쓸지는 제작자에게 묻고 있으므로(계획 "열린 질문") 기본값은 `exclude`로 둔다.

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `docs/exec-plans/active/20261111-fix-runner-issue/plan.md`: 목표와 수용 기준 5번, 의사결정 로그(제작자 표시, 승인 계정), 열린 질문
- `docs/harness/design.md` 9.1절(답변 인정: 제작자 계정의 댓글만), 4.5절, 14.6절
- `docs/harness/workflow.md` 1절
- 앞 step(step0 issue-author)에서 만든·바꾼 파일
  - `scripts/runner/next.ts`: `sameLogin`, `filterTrustedIssues`, `ExcludedIssue`, `Pick.excluded`, `pickNext` 5번
  - `scripts/lib/github.ts`: `Issue.author`, `Comment`, `GitHubPort.comments`
  - `scripts/lib/github-fake.ts`: `addFakeIssue(..., author)`, `FakeGitHub.comment`(작성자는 상태의 `me` = 봇), `ownerComment`
  - `scripts/lib/config.ts`: `github.collaborators`
  - `scripts/commands/start.ts`: 후보 제외 출력
  - `scripts/test/next.test.ts`
  - `harness.config.json`, `docs/harness/design.md`(4.5·14.6절, v0.7.5), `docs/harness/workflow.md` 1절, `docs/harness/CHANGELOG.md`

## 작업

1. 설정 (`scripts/lib/config.ts`, `harness.config.json`)
   - `HarnessConfig.github.botIssues: 'exclude' | 'owner-approved'`를 더한다.
   - `loadConfig`: 없으면 `'exclude'`로 채운다. 두 값이 아니면 `ConfigError`("github.botIssues는 exclude | owner-approved")를 던진다.
   - `harness.config.json`의 `github`에 `"botIssues": "exclude"`를 명시한다. 제작자가 답을 고르면 이 값 하나만 바꾸면 된다.
2. 승인 판정 (`scripts/runner/next.ts`)
   - `export const BOT_ISSUE_ACCEPT = '/harness accept';`
   - `export function ownerAccepted(comments: Comment[], owner: string): boolean`
     - `sameLogin(c.author, owner)`인 댓글 가운데, 어느 한 줄이든 앞뒤 공백을 뺀 값이 정확히 `/harness accept`이면 `true`다.
     - 다른 계정(봇, 외주 개발자 포함)의 댓글, 인용(`> /harness accept`), 문장 속 언급(`... /harness accept 해 주세요`), 코드 블록 안의 언급은 인정하지 않는다. 코드 블록 처리는 펜스 안의 줄을 건너뛰면 된다.
   - `filterTrustedIssues`의 시그니처를 `filterTrustedIssues(issues: Issue[], cfg: HarnessConfig, comments: (issue: number) => Comment[]): { trusted: Issue[]; excluded: ExcludedIssue[] }`로 바꾼다.
     - `cfg.github.botIssues === 'owner-approved'`이고 작성자가 봇(`sameLogin(author, cfg.github.bot)`)일 때만 `comments(n)`을 부른다. `ownerAccepted`이면 `trusted`다. 아니면 `excluded`이고 사유는 "봇 계정이 만든 Issue: 제작자 계정의 `/harness accept` 댓글 대기"다.
     - `exclude`이면 댓글을 조회하지 않는다. 봇이 아닌 계정(그 밖의 계정, 작성자 불명)의 Issue에는 승인 경로를 열지 않는다.
     - `comments(n)`이 예외를 던지면 그 Issue는 `excluded`("댓글 조회 실패: <메시지 첫 줄>")로 둔다. `pickNext`는 멈추지 않는다.
     - `github.owner`가 비면 step0처럼 모두 제외한다. 이때 댓글 조회도 하지 않는다.
   - `pickNext` 5번이 `(n) => gh.comments(n)`을 넘긴다. step0처럼 needs-human·선점·로컬 계획 조건으로 먼저 거른 뒤 적용한다. 댓글 조회 횟수를 줄이기 위해서다.
3. `scripts/commands/start.ts`: 제외 사유가 승인 대기인 Issue가 있으면, 제작자 계정으로 `/harness accept` 댓글을 달면 후보가 된다는 안내를 한 줄 출력한다. `botIssues`가 `exclude`이면 안내하지 않는다.
4. 가짜 GitHub (`scripts/lib/github-fake.ts`): 테스트에 필요하면 `commentAs(n: number, author: string, body: string): void`를 더한다. 임의 계정 댓글용이다.
5. 테스트 (`scripts/test/next.test.ts`에 더함, 가짜 GitHub)
   - `exclude`(기본값): 봇 Issue에 제작자 `/harness accept` 댓글이 있어도 제외한다. `filterTrustedIssues` 단위 테스트에서 `comments` 함수가 불리지 않았음을 호출 횟수로 확인한다.
   - `owner-approved`
     - 제작자의 `/harness accept` 댓글이 있으면 `pickNext`가 그 봇 Issue를 `new-issue`로 고른다.
     - 승인 댓글이 없으면 `idle`이다. `excluded` 사유에 `/harness accept`가 있다.
     - 봇 자신이 쓴 `/harness accept`(`FakeGitHub.comment`)는 불인정이다.
     - 외주 개발자 계정의 `/harness accept`는 불인정이다.
     - 인용, 문장 속 언급, 코드 블록 안의 언급은 불인정이다. 대소문자만 다른 제작자 계정의 승인은 인정한다.
     - 봇이 아닌 다른 계정의 Issue는 제작자 승인 댓글이 있어도 제외한다.
     - 댓글 조회 예외가 나면 그 Issue만 제외하고 다른 후보는 고른다.
   - `loadConfig`: `botIssues` 기본값 `exclude`, 잘못된 값이면 `ConfigError`.
   - 기존 step0 테스트와 `scripts/test/runner.test.ts`가 그대로 통과해야 한다.
   - "먼저 실패한 테스트" 실행 기록을 계획의 진행 로그에 남긴다.
6. 문서
   - `docs/harness/design.md` 14.6절: `github.botIssues`(`exclude` 기본 | `owner-approved`)와 승인 표시(제작자 계정 댓글의 `/harness accept` 한 줄, 9.1절과 같은 근거)를 적는다. 취소하려면 Issue를 닫거나 `needs-human` 라벨을 붙인다는 것도 적는다. 4.5절 5번에 "`github.botIssues`가 `owner-approved`면 제작자 승인 댓글이 있는 봇 Issue도"를 더한다. 버전은 v0.7.5를 유지한다(같은 미배포 버전).
   - `docs/harness/workflow.md` 1절: 봇이 대신 등록한 Issue를 runner에 맡기려면 `github.botIssues: "owner-approved"`에서 제작자 계정으로 `/harness accept` 댓글을 단다는 것을 적는다.
   - `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄 더한다.
   - 완료 전에 계획 `plan.md`의 "검증 방법과 결과"에 결과를 적는다.

## Acceptance Criteria

```bash
grep -q '"botIssues": "exclude"' harness.config.json
grep -q "owner-approved" scripts/lib/config.ts
grep -q "ownerAccepted" scripts/runner/next.ts
grep -q "/harness accept" scripts/test/next.test.ts
grep -q "/harness accept" docs/harness/workflow.md
grep -q "botIssues" docs/harness/design.md
node --test scripts/test/next.test.ts scripts/test/runner.test.ts
node scripts/harness.ts check
```

## 금지사항

- `botIssues` 기본값을 `owner-approved`로 하거나 `harness.config.json`에서 `owner-approved`로 켜지 마라. 이유: 제작자가 답하기 전에 보안 결정을 대신 내리는 것이다(9.1절). 답이 오기 전에는 fail-closed다.
- 봇·외주 개발자 계정의 댓글이나 라벨·리액션을 승인으로 인정하지 마라. 이유: 봇은 에이전트가 쓰는 계정이라 흉내 낼 수 있다. 9.1절 답변 인정과 같은 근거다.
- 라벨 기반 승인(열린 질문 C안)과 timeline API 조회를 구현하지 마라. 이유: 제작자가 C를 고르면 후속 Issue로 한다.
- 봇이 아닌 계정의 Issue에 승인 경로를 열지 마라. 이유: Issue #5의 질문은 봇 Issue에 한정된다. 범위를 넓히는 것은 별도 결정이다.
- `pickNext` 우선순위 1~4번과 `latestOwnerAnswer`를 고치지 마라. 이유: 범위 밖이다. 진행 중인 계획이 멈추면 안 된다.
- 실제 GitHub(`gh`)를 부르는 테스트를 쓰지 마라. 이유: 수용 기준이 `github-fake` 테스트다.
