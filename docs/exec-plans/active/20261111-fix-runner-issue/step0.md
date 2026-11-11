# Step 0: issue-author

runner가 새로 선점할 Issue를 제작자(`github.owner`)·외주 개발자(`github.collaborators`)가 만든 것으로 한정한다. 봇 계정이 만든 Issue는 후보에서 뺀다(설계서 14.6절). 봇 Issue를 제작자 표시로 받는 경로는 step1이 만든다.

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/exec-plans/active/20261111-fix-runner-issue/plan.md`: 목표와 수용 기준, 의사결정 로그, 발견 사항(TD-18·TD-19)
- `docs/harness/design.md` 4.5절(다음 할 일 우선순위), 9.1절(답변 인정), 14.6절(외부 입력 처리)
- `docs/harness/workflow.md` 1절(접수와 작업 공간)
- `scripts/runner/next.ts`: `pickNext`, 특히 "5. 선점되지 않은 Issue"
- `scripts/lib/github.ts`: `Issue`, `GhCli.listOpenIssues`, `GhCli.getIssue`
- `scripts/lib/github-fake.ts`: `FakeState`, `initFakeState`, `addFakeIssue`, `FakeGitHub.listOpenIssues`·`getIssue`·`issue`
- `scripts/lib/config.ts`: `HarnessConfig.github`, `loadConfig`
- `scripts/commands/start.ts`, `scripts/harness.ts`(`next` 명령)
- `scripts/test/helpers.ts`(`makeFixture`, `fixtureConfig`), `scripts/test/runner.test.ts`(가짜 GitHub 사용 예), `scripts/test/lib.test.ts`
- `docs/exec-plans/tech-debt-tracker.md`, `docs/harness/CHANGELOG.md`
- 앞 step에서 만든·바꾼 파일: 없음(첫 step)

## 작업

1. Issue 작성자 (`scripts/lib/github.ts`)
   - `Issue`에 `author: string`을 더한다. 작성자 login이며, 알 수 없으면 `''`이다.
   - `GhCli.listOpenIssues`·`getIssue`의 `--json` 필드에 `author`를 더한다. 원시 JSON을 `Issue`로 바꾸는 코드를 `export function toIssue(raw: RawIssue): Issue` 하나로 모은다(두 메서드가 같이 쓴다). `author`가 `null`이거나 없으면(삭제된 계정) `''`이다.
2. 가짜 GitHub (`scripts/lib/github-fake.ts`)
   - `addFakeIssue(file, title, body, labels = [], author?: string)`: `author`를 생략하면 상태의 `owner`(제작자)로 둔다. 기존 `runner.test.ts`가 고치지 않고 통과해야 한다.
   - `listOpenIssues`·`getIssue`가 `author`를 돌려준다. `author`가 없는 옛 상태 파일의 Issue와 PR 그림자 Issue는 `''`이다.
3. 설정 (`scripts/lib/config.ts`, `harness.config.json`)
   - `HarnessConfig.github.collaborators: string[]`를 더한다. 외주 개발자 계정이다(14.6절). 이 계정이 만든 Issue도 작업 후보가 된다.
   - `loadConfig`: 없으면 `[]`로 채운다. 있는데 문자열 배열이 아니면 `ConfigError`("github.collaborators는 계정 이름 문자열 배열이어야 한다")를 던진다.
   - `harness.config.json`의 `github`에 `"collaborators": []`를 넣는다.
4. 후보 필터 (`scripts/runner/next.ts`)
   - `export interface ExcludedIssue { number: number; title: string; author: string; reason: string }`
   - `export function sameLogin(a: string, b: string): boolean`: 소문자로 바꿔 비교한다. 어느 한쪽이 빈 문자열이면 `false`다.
   - `export function filterTrustedIssues(issues: Issue[], cfg: HarnessConfig): { trusted: Issue[]; excluded: ExcludedIssue[] }`
     - 작성자가 `cfg.github.owner`이거나 `cfg.github.collaborators` 중 하나면 `trusted`다.
     - 나머지는 `excluded`다. `reason`은 사람이 읽을 한 줄로 쓴다. 작성자가 `cfg.github.bot`이면 "봇 계정이 만든 Issue", 빈 값이면 "작성자 불명", 그 밖은 "허용 계정(github.owner·github.collaborators)이 아닌 작성자".
     - `cfg.github.owner`가 비어 있으면 모든 Issue가 `excluded`다(fail-closed). `reason`에 "github.owner가 비어 있다"를 쓴다.
     - 입력 순서를 유지한다.
   - `pickNext` 5번: 기존 조건(needs-human 아님, 선점 안 됨, 로컬 계획 없음)으로 먼저 거른 뒤 `filterTrustedIssues`를 적용하고, `trusted`만 우선순위 정렬해 고른다. 앞 조건으로 빠진 Issue는 `excluded`에 넣지 않는다. 작성자 때문에 빠진 것만 넣는다.
   - `Pick`에 `excluded: ExcludedIssue[]`를 더한다. 5번까지 가지 않고 반환하는 곳은 `[]`이다.
   - idle 이유 끝에 작성자 때문에 뺀 Issue 번호를 붙인다. 예: `할 일 없음 (작성자 확인으로 제외: #12, #15)`. `waiting` 수는 바꾸지 않는다. runner 정지 조건이 그대로여야 한다.
5. 출력
   - `scripts/commands/start.ts` ③: `pick.excluded`가 있으면 `- 후보 제외: #N "<title>" (작성자 <author 또는 '불명'>) — <reason>`을 Issue마다 한 줄씩 출력한다.
   - `scripts/harness.ts`의 `next --json` 출력에 `excluded`를 더한다.
6. 테스트: 새 파일 `scripts/test/next.test.ts`. 가짜 GitHub(`initFakeState`, `addFakeIssue`)와 `makeFixture`를 쓰고, `process.env.HARNESS_FAKE_GH`는 테스트가 끝나면 원래대로 돌린다.
   - `pickNext`
     - 제작자가 만든 Issue는 `new-issue`다.
     - `collaborators`에 있는 계정이 만든 Issue는 `new-issue`다.
     - 봇(`harness-bot`)이 만든 Issue만 있으면 `idle`이다. `excluded`에 그 번호와 봇 사유가 있고, `reason`에 `#N`이 있다.
     - 번호가 작고 `priority:high` 라벨이 붙은 봇 Issue와 라벨 없는 제작자 Issue가 함께 있으면 제작자 Issue를 고른다.
     - 대소문자만 다른 제작자 계정(`Maker`)이 만든 Issue는 후보다.
     - `github.owner`가 `''`인 설정에서는 Issue 작성자와 관계없이 `idle`이다.
   - `filterTrustedIssues`: 작성자 `''`은 "작성자 불명"으로 제외한다. 그 밖의 계정은 허용 계정이 아니라는 사유로 제외한다.
   - `sameLogin`: 대소문자 무시, 빈 문자열은 `false`.
   - `toIssue`: `author: { login: 'x' }`는 `'x'`, `author: null`은 `''`.
   - `loadConfig`: `collaborators`가 없으면 `[]`, 문자열 배열이 아니면 `ConfigError`. 위치는 `next.test.ts`나 `lib.test.ts` 중 골라도 된다.
   - "먼저 실패한 테스트" 실행 기록(명령과 실패 요약)을 계획의 진행 로그에 남긴다.
7. 문서
   - `docs/harness/design.md`
     - 4.5절 우선순위 5번을 다음 뜻으로 고친다: "선점되지 않은 Issue 중 제작자(`github.owner`)·외주 개발자(`github.collaborators`) 계정이 만든 것(우선순위 라벨 순). 봇 계정이 만든 Issue는 고르지 않는다(14.6절)."
     - 14.6절 "원칙" 아래에 runner가 Issue 작성자를 확인한다는 것, 작성 뒤 수정은 확인하지 않는다는 것(TD-19)을 적는다.
     - 머리말 버전을 v0.7.5로, 최종 갱신일을 2026-11-11로 한다.
   - `docs/harness/workflow.md` 1절: "작업은 GitHub Issue로만 접수한다" 항목 아래에 이렇게 적는다. "runner는 제작자·외주 개발자(`harness.config.json`의 `github.collaborators`) 계정이 만든 Issue만 가져간다. 봇 계정이 대신 등록한 Issue는 runner가 고르지 않는다. 대화 세션의 `new-task --issue`로는 시작할 수 있다."
   - `docs/harness/architecture.md`: `runner/next.ts` 설명이 있으면 작성자 필터를 한 마디 더한다. 없으면 고치지 않는다.
   - `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄 더한다. 예: 설계서 v0.7.5와 runner 새 Issue 후보 작성자 확인(`github.collaborators`), Issue #5.
   - `docs/exec-plans/tech-debt-tracker.md`에 계획 발견 사항의 두 항목을 등록한다.
     - TD-18: 계획 작성 세션의 열린 질문이 needs-human으로 올라가지 않는다. 다시 볼 때는 다음 runner 수정 때다.
     - TD-19: Issue를 만든 뒤 제목·본문 수정을 확인하지 않는다(GraphQL `lastEditedAt`·`editor`). 다시 볼 때는 2단계 전이나 외주 개발자 합류 전이다.
     - 번호가 이미 쓰였으면 다음 빈 번호를 쓰고, `plan.md` 발견 사항의 TD 번호도 같이 고친다.

## Acceptance Criteria

```bash
test -f scripts/test/next.test.ts
grep -q "addFakeIssue" scripts/test/next.test.ts
grep -q "filterTrustedIssues" scripts/runner/next.ts
grep -q '"collaborators"' harness.config.json
grep -q "github.collaborators" docs/harness/design.md
grep -q "github.collaborators" docs/harness/workflow.md
node --test scripts/test/next.test.ts scripts/test/runner.test.ts
node scripts/harness.ts check
```

## 금지사항

- `pickNext` 우선순위 1~4번(답을 받은 needs-human, 내 PR 조치, 진행 중인 step, 다음 step)의 동작을 바꾸지 마라. 이유: 이미 선점한 계획이 작성자 필터 때문에 멈추면 안 된다. 이 계획의 Issue #5도 봇이 대신 등록했다.
- 봇 Issue를 받는 경로(제작자 댓글·라벨 등 어떤 승인 표시도)를 만들지 마라. 이유: step1 범위이고, 제작자에게 묻고 있는 보안 결정이다(계획 "열린 질문").
- `latestOwnerAnswer`(needs-human 답변 인정)를 고치지 마라. 이유: 9.1절 규칙이며 이 Issue 범위 밖이다.
- `new-task --issue`(`scripts/commands/task.ts`)에 작성자 검사를 넣지 마라. 이유: 제작자가 대화로 지시하는 수동 경로이며 비범위다.
- `scripts/test/runner.test.ts`의 기대값을 바꾸지 마라. 이유: `addFakeIssue`의 기본 작성자가 제작자이면 그대로 통과해야 한다. 바뀌면 회귀다.
- 실제 GitHub(`gh`)를 부르는 테스트를 쓰지 마라. 이유: 수용 기준이 `github-fake` 테스트이고, 무인 세션은 `gh`가 막혀 있다.
- `github.owner`가 비었을 때 필터를 끄지 마라. 이유: 설정 누락이 곧 우회가 된다(fail-closed, 14.6절).
