# Step 0: edited-content-trust

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-edited-content-trust/plan.md` (수용 기준, 의사결정 로그)
- `docs/harness/design.md` 9.1절 "답변 인정 기준", 14.6절
- `scripts/lib/github.ts` `Comment`·`GitHubPort`·`GhCli.comments`, `scripts/lib/github-fake.ts`
- `scripts/runner/next.ts` `latestOwnerAnswer`·`ownerAccepted`·`filterTrustedIssues`·`pickNext`
- `scripts/runner/run.ts` `doPlanning`·`blockPlan`, `scripts/commands/start.ts` ①

## 작업

1. `scripts/lib/github.ts`
   - `export interface Change { by: string; at: string }`(계정 login, 알 수 없으면 `''` / ISO 시각), `export interface ContentHistory { changes: Change[]; complete: boolean }`. `changes`는 **만든 것을 첫 변경으로 포함**한다.
   - `Comment`에 `history: ContentHistory | null`(null = 확인 못 함)을 더한다.
   - `export interface IssueHistory extends ContentHistory { title: string; body: string }`: 본문 편집과 제목 변경(`RENAMED_TITLE_EVENT`)을 합친 변경 이력과, 같은 조회의 제목·본문.
   - `GitHubPort.issueHistory(n: number): IssueHistory`.
   - `GhCli.comments`를 GraphQL `issueOrPullRequest(number).comments(last: 100)`로 바꾸고 `userContentEdits`로 `history`를 채운다. `GhCli.issueHistory`는 `issue(number)`의 `author`·`createdAt`·`title`·`body`·`lastEditedAt`·`userContentEdits`·`timelineItems(itemTypes: [RENAMED_TITLE_EVENT])`로 채운다. 원시 응답 → 이력 변환은 순수 함수(`toContentHistory`)로 빼서 테스트한다. 이력이 `totalCount`보다 적게 왔거나, `lastEditedAt`이 있는데 편집 기록이 없으면 `complete: false`.
2. `scripts/lib/github-fake.ts`: 상태 파일의 Issue·댓글에 선택 필드 `changes`를 둔다(없으면 만든 것 하나). 시각은 앞 시각보다 늘 1ms 이상 뒤로 준다. 테스트용 `editIssueAs(n, by, { title?, body? })`, `editCommentAs(n, index, by, body)`를 더한다.
3. `scripts/runner/next.ts`
   - `export function ownerComment(c: Comment, owner: string): boolean`: 작성자가 제작자이고 이력이 완전하며 모든 변경이 제작자. `export function ownerCommentRejection(c, owner): string | null`(작성자는 제작자인데 인정하지 않는 이유, `start`가 쓴다).
   - `latestOwnerAnswer`·`ownerAccepted`가 `ownerComment`를 쓴다.
   - `export function issueTrust(h: IssueHistory, allowed: string[], owner: string, comments: () => Comment[]): { ok: true } | { ok: false; reason: string; accepted: boolean }`: 이력 불완전 → 불신. 허용 계정이 아닌 변경이 없으면 신뢰(댓글 조회 안 함). 있으면 마지막 비허용 변경보다 엄격히 뒤의 제작자 `/harness accept`가 있어야 신뢰. 사유에 비허용 계정과 시각을 넣는다.
   - `filterTrustedIssues(issues, cfg, comments, history)`: 허용 계정 Issue와 `owner-approved` 봇 Issue에 `issueTrust`를 쓴다. 기존 사유(`봇 계정이 만든 Issue`, `BOT_ISSUE_WAITING_REASON`, 허용 계정 아님, 작성자 불명, owner 비어 있음)는 그대로. 조회 실패는 `변경 이력 조회 실패: <첫 줄>` / `댓글 조회 실패: <첫 줄>`.
4. `scripts/runner/run.ts` `doPlanning`: `getIssue` 뒤 `issueHistory`로 `issueTrust`(허용 계정 = 제작자·외주 개발자). 조회 실패 → 이벤트 남기고 `'env'`. 불신 → `blockPlan`(사람이 결정할 것: 제목·본문 확인 뒤 `/harness accept`)하고 `'fail'`, 계획 작성 세션은 띄우지 않는다. 신뢰 → 프롬프트에 이력 조회의 제목·본문.
5. `scripts/commands/start.ts` ①: `ownerComment`로 "제작자 답변 있음"을 판정하고, 마지막 댓글이 제작자 것인데 인정하지 않으면 이유를 붙인다.
6. 테스트(먼저 실패를 확인하고 진행 로그에 남긴다): `next.test.ts`(판정 함수·`filterTrustedIssues`·`pickNext`·`toContentHistory`), `runner.test.ts`(계획 작성 전 차단과 승인 뒤 재개), `start.test.ts`(답변 표시).
7. 문서: 설계서 9.1절 답변 인정 기준, 14.6절(작성자 확인·봇 Issue 승인·한계), v0.7.13과 이력. 절차서 1절 재승인. CHANGELOG, architecture.md `lib/github.ts` 행, TD-19·TD-26 해결.

## Acceptance Criteria

```bash
node --test scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/runner.test.ts
grep -q "issueHistory(n: number): IssueHistory" scripts/lib/github.ts
grep -q "export function issueTrust" scripts/runner/next.ts
grep -q "v0.7.13" docs/harness/design.md
grep -q "TD-19.*해결" docs/exec-plans/tech-debt-tracker.md
grep -q "TD-26.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 이력을 확인하지 못한 댓글·Issue를 신뢰하지 마라. 이유: fail-closed가 이 변경의 목적이다.
- 같은 시각의 승인을 변경 뒤로 보지 마라. 이유: 초 단위 시각에서 순서를 단정할 수 없다.
- 작성자가 허용 계정도 봇도 아닌 Issue에 승인 경로를 열지 마라. 이유: 14.6절 범위 밖이다.
- L1 훅(`scripts/hooks/`)을 고치지 마라. 이유: 이번 범위 밖이다.
