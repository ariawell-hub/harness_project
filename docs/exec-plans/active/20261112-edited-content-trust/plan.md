---
id: 20261112-edited-content-trust
issue: 41 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T22:05:43+09:00 # new-task가 채운다
---

# fix: 고친 댓글·Issue를 runner 신뢰 판정에서 거른다 (TD-26, TD-19)

## 목표와 수용 기준

runner의 신뢰 판정(9.1절 제작자 답변, 14.6절 새 Issue 작성자·봇 Issue 승인)은 지금 **만든 계정**만 본다. 쓰기 권한 계정(봇 포함)은 다른 사람의 Issue 제목·본문과 댓글을 고칠 수 있다. 그래서 프롬프트 주입을 받은 에이전트가 봇 토큰으로 제작자의 기존 댓글이나 Issue를 고치면, runner가 그 내용을 "제작자 답변"이나 "제작자 지시"로 받는다. 답변 인정 경로는 기본 설정에서도 켜져 있어 지금 열린 경로다. 편집 이력까지 보고, 허용 계정이 아닌 계정이 고친 흔적이 있으면 신뢰하지 않게 한다(fail-closed).

수용 기준

- 제작자 댓글(답변, `/harness accept`)은 고친 적이 없거나 고친 계정이 모두 제작자일 때만 인정한다. 편집 이력을 확인하지 못하면(조회 결과 없음, 이력 일부만 읽음, 편집 계정 불명) 인정하지 않는다.
  - runner의 답 받음 판정(`pickNext` 1번)과 `start`의 "제작자 답변 있음" 표시가 같은 기준을 쓴다. `start`는 인정하지 않은 이유를 보여 준다.
- 새 Issue 후보(`filterTrustedIssues`): 만든 계정과 제목·본문을 바꾼 계정이 모두 허용 계정(제작자·외주 개발자)이면 후보다. 허용 계정이 아닌 계정의 변경이 있으면, 그 마지막 변경보다 뒤에 단 제작자 `/harness accept` 댓글이 있을 때만 후보다.
  - 봇 Issue(`owner-approved`)도 같은 규칙이다. 봇이 만든 것도 "허용 계정이 아닌 변경"이므로 승인 댓글이 Issue의 마지막 비허용 변경보다 뒤에 있어야 한다. 승인 뒤에 봇이 고치면 다시 승인해야 한다.
  - 변경 이력 조회가 실패하거나 이력을 다 읽지 못하면 그 Issue만 빼고 사유를 남긴다.
- runner 계획 작성(`doPlanning`): 계획을 쓰기 직전에 같은 규칙으로 Issue를 다시 확인한다. 통과하지 못하면 계획을 `blocked`로 멈추고 Issue에 `needs-human`과 확인 방법(내용 확인 뒤 `/harness accept`)을 남긴다. 계획 작성 프롬프트에는 확인한 조회 결과의 제목·본문을 넣는다. 조회 실패는 환경 장애로 다루고 실패로 세지 않는다.
- 설계서 9.1절 답변 인정 기준과 14.6절(작성자 확인, 봇 Issue 승인, 한계)을 바꾸고 v0.7.13으로 올린다. 절차서 1절에 다시 승인하는 법을 적는다. TD-19·TD-26을 해결로 바꾼다.
- `node scripts/harness.ts check`가 통과한다.

## 범위 / 비범위

- 범위: `GitHubPort`에 편집 이력 조회를 더하고(gh GraphQL), 가짜 GitHub과 테스트, runner 판정(`next.ts`, `run.ts` `doPlanning`), `start` 표시, 문서(설계서·절차서·CHANGELOG·tech-debt-tracker·architecture.md).
- 비범위
  - 라벨을 붙인 계정 확인(라벨은 판정 근거가 아니다).
  - 대화 세션의 `new-task --issue`(제작자와 대화 중이라 14.6절대로 확인하지 않는다).
  - PR 본문·댓글(판정에 쓰지 않는다).
  - TD-27·TD-24(runner 멈춤·보고 경로)는 다음 Issue에서 한다.

## 관련 파일·문서

- `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`
- `scripts/runner/next.ts`, `scripts/runner/run.ts`
- `scripts/commands/start.ts`
- `scripts/test/next.test.ts`, `scripts/test/runner.test.ts`, `scripts/test/start.test.ts`
- `docs/harness/design.md`(9.1절, 14.6절, 버전·이력), `docs/harness/workflow.md`(1절), `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`, `docs/exec-plans/tech-debt-tracker.md`

## step 목록

- step0 edited-content-trust: 편집 이력 조회와 판정 규칙, runner·start 적용, 문서

## 진행 로그

- 2026-11-12 대화 세션. 제작자 지시("우선순위를 파악해서 문제되는 사항들 먼저 해결해달라")로 Issue #41을 봇이 등록하고 계획을 썼다. 우선순위: 1) TD-26·TD-19(보안, 지금 열린 경로) 2) TD-27·TD-24(runner 멈춤·보고) 3) TD-23(2번 뒤 다시 판단).
- 2026-11-12 실제 GitHub에서 편집 정보 형식을 확인했다(봇이 만든 Issue #41 본문을 봇이 한 번 고침). `lastEditedAt`·`editor`가 채워지고, `userContentEdits`는 최신순이며 처음 작성분(편집 시각 = 작성 시각, 편집자 = 작성자)을 포함해 2건이었다. 본인이 고쳐도 편집자로 남는다. 고친 적이 없으면 `userContentEdits`는 0건이다(Issue #5 댓글). `gh api graphql`의 `-F owner='{owner}' -F name='{repo}'` 자리 표시가 현재 리포로 바뀐다.
- 2026-11-12 step0 테스트 먼저: `next.test.ts`(편집 이력 변환, 제작자 댓글 판정, `issueTrust`, `filterTrustedIssues`, `pickNext`), `start.test.ts`(고친 답변 표시), `runner.test.ts`(계획 작성 전 차단과 승인 뒤 재개)를 더하고 실패를 확인했다(next.test.ts는 `issueTrust` export 없음으로 불러오기 실패, start·runner 새 테스트 2개 실패, 28개 중 25 통과).
- 2026-11-12 step0 구현: `GitHubPort.issueHistory`와 댓글 편집 이력(GraphQL), 가짜 GitHub 이력·시각, `ownerComment`·`ownerCommentRejection`·`issueTrust`·`allowedAccounts`, `filterTrustedIssues`에 이력 조회 인자, runner `doPlanning` 재확인과 `blockPlan`의 결정 문구 인자, `start` `describeAnswer`. 문서(설계서 v0.7.13, 절차서 1절, CHANGELOG, architecture.md, TD-19·TD-26 해결).
- 2026-11-12 편집 기록의 개별 항목 삭제에 대비해 최상위 `editor`·`lastEditedAt`도 변경으로 넣었다(발견 사항).

## 의사결정 로그

- 결정: 판정을 "편집 이력 전체"로 한다. 만든 계정을 변경 이력의 첫 항목으로 넣고, 허용 계정이 아닌 계정의 변경이 하나라도 있으면 그 마지막 변경 뒤의 제작자 `/harness accept`가 있어야 신뢰한다. 이유: 봇 Issue 승인과 고친 Issue 재승인을 한 규칙으로 다룬다. 승인 뒤에 고친 경우도 같은 규칙으로 막힌다. 버린 대안: 마지막 편집자(`editor`)만 보기(중간 편집을 놓친다), REST `updated_at`으로 "고친 적 있음"만 보기(제작자가 자기 댓글을 고쳐도 거부한다. 리액션 등으로 바뀌는지 불확실하다).
- 결정: 제작자 Issue가 다른 계정에 의해 고쳐졌을 때 `botIssues` 설정과 관계없이 제작자 `/harness accept`로 다시 승인할 수 있다. 이유: 그렇지 않으면 제작자가 Issue를 새로 만들어야 한다. 승인은 제작자 계정 행동이므로 14.6절 취지("작업 지시는 제작자 Issue에서만")를 지킨다. 작성자가 허용 계정인 Issue와 `owner-approved`의 봇 Issue만 해당한다. 그 밖의 계정·작성자 불명 Issue는 지금처럼 승인 경로가 없다.
- 결정: 시각 비교는 엄격히 "뒤"(같은 시각은 불인정). 이유: GitHub 시각은 초 단위다. 같은 초에 단 승인은 그 변경을 본 뒤라고 단정할 수 없다(fail-closed). 가짜 GitHub은 시각이 겹치지 않게 1ms씩 늘린다.
- 결정: 댓글 조회를 REST에서 GraphQL(`last: 100`)로 바꾼다. 이유: 편집 이력은 GraphQL에만 있다. REST `per_page=100`은 처음 100개를 돌려줘 댓글이 100개를 넘으면 "마지막 댓글"이 틀렸다. `last: 100`은 최근 100개다.
- 결정: 보안 판정 규칙 변경(9.1절 "반드시 묻는다")이지만 묻지 않고 진행한다. 이유: 제작자가 대화에서 이 문제를 먼저 해결하라고 지시했고, 바꾸는 방향이 더 보수적(fail-closed)이다.

## 발견 사항

- GitHub은 쓰기 권한 계정이 편집 기록의 개별 항목을 지우게 한다(민감 정보 삭제). 지운 항목이 GraphQL `userContentEdits`에 어떻게 남는지는 시험하지 않았다. 지워져도 남는 최상위 `editor`·`lastEditedAt`를 변경으로 넣어 마지막 편집은 놓치지 않게 했고, 편집 계정이 비면 불명('')으로 불신한다. 중간 편집이 지워지고 그 뒤 제작자가 다시 저장한 경우는 제작자가 저장한 내용으로 본다. → 처리: [설계서 14.6절 한계](../../../harness/design.md)
- 기존 댓글 조회(REST `per_page=100`)는 처음 100개를 돌려줘, 댓글이 100개를 넘는 Issue에서는 "마지막 댓글"(답 받음 판정)이 틀렸다. GraphQL `last: 100`으로 바꾸며 함께 고쳤다. → 처리: 해당 없음

## 열린 질문

없음

## 검증 방법과 결과

- 단위: `node --test scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/runner.test.ts`
  - 판정 함수: 고치지 않은 제작자 댓글 인정, 제작자가 고친 댓글 인정, 봇이 고친 제작자 댓글 불인정, 이력 불완전·불명 불인정, 같은 시각 승인 불인정
  - `filterTrustedIssues`: 봇이 고친 제작자 Issue 제외(사유에 계정), 그 뒤 제작자 승인이면 후보, 승인 뒤 봇이 고친 봇 Issue 제외, 이력 조회 실패는 그 Issue만 제외
  - `pickNext`: 봇이 고친 제작자 댓글은 답으로 보지 않는다
  - runner: 계획 작성 전에 봇이 고친 제작자 Issue는 `blocked` + `needs-human`, 계획 작성 세션을 띄우지 않는다. 제작자 승인 뒤 다시 돌리면 이어 간다
  - `start`: 봇이 고친 답변을 "답변 대기"로 보이고 이유를 붙인다
- 실제 GitHub: `issueHistory`·`comments`를 Issue #41(봇이 한 번 고침)과 #5에 대해 실행해 변경 이력이 위 형식대로 나오는지 본다.
- `node scripts/harness.ts check`
- 결과(2026-11-12, step0)
  - `node --test scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/runner.test.ts` 통과. 전체 `node --test "scripts/test/*.test.ts"` 137 pass / 0 fail. `tsc` 통과. AC grep 5개 통과.
  - 실제 GitHub(봇 토큰): Issue #41은 변경 2건(봇이 만듦 13:05:38, 봇이 고침 13:07:06)·완전, #5·#12는 만든 것 1건·완전. #5의 제작자 댓글(고친 적 없음)은 `ownerComment` 인정, 봇 댓글은 불인정. 세 Issue 모두 봇이 만들어 `issueTrust`는 승인 대기(waiting)다.
  - `node scripts/harness.ts check` 통과. R8 경고 2건(ADR-0003의 `harness.config.json`, architecture.md의 `scripts/`)은 경고다. ADR-0003은 이 변경과 무관하고, architecture.md는 이 PR에서 함께 고쳤다.

## 다음 할 일

- PR을 올려 자동 병합. 그다음 Issue: TD-27·TD-24(runner 멈춤·보고 경로)
