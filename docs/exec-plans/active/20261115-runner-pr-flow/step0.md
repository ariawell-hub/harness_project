# Step 0: pr-state

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 1·2·3, 의사결정 로그)
- `docs/harness/design.md` 10.3절 "필수 상태 체크" 표와 "체크 요약 API는 출처를 보지 않는다" 문단, 0.2절
- `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`, `scripts/lib/git.ts`
- `scripts/ci/protection.ts`(`ACTIONS_APP_ID`), `scripts/ci/results.ts`(`GATE_CONTEXTS`, `REVIEW_CONTEXTS`, `LEDGER_CONTEXT`)
- `scripts/harness.ts`의 `required-checks`·`next` 명령

## 작업

1. `scripts/lib/github.ts`
   - `PullRequest`에 `headSha`(PR head 커밋 SHA)와 `autoMerge`(자동 병합이 켜져 있는가)를 더한다.
   - 타입과 포트 메서드를 더한다.
     ```ts
     export interface CommitCheck {
       context: string; // 커밋 상태의 context 또는 check run 이름
       kind: 'status' | 'check-run';
       state: 'success' | 'failure' | 'error' | 'pending';
       description: string;
       creator: string; // 커밋 상태를 쓴 계정 login. check run은 ''
       appId: number | null; // check run을 만든 App id. 커밋 상태는 null
       targetUrl: string;
       at: string; // 기록 시각(ISO)
     }
     // GitHubPort
     commitChecks(sha: string): CommitCheck[];
     ```
   - `commitChecks`는 그 커밋의 커밋 상태 **전체 기록**(같은 context의 옛 기록 포함)과 check run 전체를 최신순으로 돌려준다. context별 최신 하나만 주는 API(체크 요약 `statusCheckRollup`, combined status)로 만들지 않는다. check run의 실패 계열 결론(failure, timed_out, cancelled, action_required 등)은 `failure`, 끝나지 않았으면 `pending`이다.
   - `GhCli`와 `FakeGitHub` 모두 구현한다. 가짜는 상태 파일에 커밋별 체크 목록을 두고 테스트 도우미 `setCheck(sha, check)`를 준다. 가짜 PR의 `headSha`는 원격 브랜치 끝이다.
2. `scripts/lib/git.ts`: `isBehind(cwd, remote, branch): boolean`. `<remote>/<branch>`가 `HEAD`의 조상이 아니면 true. 판단하지 못하면 false.
3. `scripts/runner/pr-state.ts`(순수 함수. 네트워크·git 호출 없음)
   ```ts
   export type CheckState = 'success' | 'failure' | 'error' | 'pending' | 'missing';
   export interface RequiredState {
     context: string;
     source: 'actions' | 'recorder';
     state: CheckState;
     description: string;
     targetUrl: string;
     at: string;
   }
   export function requiredStates(
     checks: readonly CommitCheck[],
     ci: Pick<HarnessConfig['ci'], 'requiredChecks' | 'recorderBot'>,
   ): RequiredState[];
   export type PrVerdict =
     | { kind: 'closed' }
     | { kind: 'conflict' }
     | { kind: 'fix'; failing: RequiredState[] }
     | { kind: 'review' }
     | { kind: 'infra-error'; failing: RequiredState[] }
     | { kind: 'wait-ci'; waiting: string[] }
     | { kind: 'behind' }
     | { kind: 'approval' }
     | { kind: 'ready' };
   export function classifyPr(i: {
     pr: PullRequest;
     required: readonly RequiredState[];
     behind: boolean;
     stepCompleted: boolean;
   }): PrVerdict;
   ```
   - `requiredStates`: `ci.requiredChecks`의 순서대로 하나씩 낸다. `recorder`는 `kind: 'status'`이고 `creator`가 `ci.recorderBot`인 것 중 가장 최근 것, `actions`는 `kind: 'check-run'`이고 `appId`가 `ACTIONS_APP_ID`인 것 중 가장 최근 것이다. 해당하는 것이 없으면 `missing`이다. `ci.recorderBot`이 없으면 `recorder` 체크는 모두 `missing`이다.
   - `classifyPr`는 위에서부터 처음 맞는 것을 낸다.
     1. PR이 열려 있지 않다 → `closed`
     2. `pr.mergeState`가 `DIRTY` → `conflict`
     3. 출처가 `actions`인 필수 체크가 `failure` → `fix`
     4. 필수 체크 중 `pending`·`missing`이 있다 → `wait-ci`(`waiting`은 그 context들)
     5. `stepCompleted`가 false다(계획 검증 중이거나 step 진행 중인 PR): `plan-gate`·`risk-gate`의 실패와 뒤처짐은 보지 않는다. `review/*`·`review-ledger` 실패 → `review`, `error`가 있으면 → `infra-error`, 그 밖은 `ready`
     6. `plan-gate`·`deps-guard`·`harness-guard`(출처 `recorder`이고 `review/*`·`review-ledger`·`risk-gate`가 아닌 것) 실패 → `fix`
     7. `review/*` 또는 `review-ledger` 실패 → `review`
     8. `error`가 있다 → `infra-error`
     9. `behind`가 true → `behind`(`risk-gate`만 실패인 경우 포함)
     10. `risk-gate`가 실패 → `approval`
     11. 그 밖 → `ready`
4. `scripts/harness.ts`에 읽기 전용 명령 `pr-state [--pr <번호>]`: 번호가 없으면 현재 브랜치의 PR이다. 필수 체크마다 `context`, 출처, 상태, 설명을 한 줄씩 출력하고 마지막 줄에 분류(`kind`)와 PR head, `mergeStateStatus`, 뒤처짐 여부를 출력한다. `ci.requiredChecks`가 비면 그 사실을 알리고 종료 코드 0이다. PR이 없으면 종료 코드 1이다. 도움말(`HELP`)에 넣는다.
5. 테스트 `scripts/test/pr-state.test.ts`: 출처가 다른 같은 이름의 상태·check run을 무시하는지(흉내 상태가 더 최근이어도 검증 App의 결과를 쓴다), 같은 출처의 옛 기록보다 최근 기록을 쓰는지, `classifyPr`의 11개 규칙 각각과 순서(예: `check` 실패는 다른 체크가 진행 중이어도 `fix`, `review/*` 실패는 다른 검증자가 진행 중이면 `wait-ci`), `isBehind`, 가짜 GitHub의 `commitChecks`·`headSha`, `pr-state` 명령 출력.
6. 문서와 기록
   - 설계서 10.3절 "체크 요약 API" 문단의 마지막 문장(지금 runner는 요약을 실패를 찾는 데만 쓴다)을 구현에 맞게 고친다: 분류 함수와 `pr-state` 명령이 생겼고 runner 연결은 step1이다.
   - 절차서 5절에 `node scripts/harness.ts pr-state` 한 줄, `docs/harness/architecture.md`의 `runner/*`·`lib/github.ts` 설명, `docs/harness/CHANGELOG.md` 한 줄, 설계서 버전·변경 이력.
   - `docs/exec-plans/tech-debt-tracker.md`에 TD-33 등록: `doc-lint`가 설계서 머리말 버전과 변경 이력의 마지막 항목을 비교하지 않아 머리말이 반복해 어긋났다(PR #91 원장 F1).
   - 이 step의 PR에서 `pr-state`를 실행해 출력(진행 중일 때와 통과한 뒤)을 계획의 진행 로그에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/pr-state.test.ts scripts/test/next.test.ts scripts/test/runner.test.ts scripts/test/cli.test.ts
grep -q "export function classifyPr" scripts/runner/pr-state.ts
grep -q "export function requiredStates" scripts/runner/pr-state.ts
grep -q "commitChecks" scripts/lib/github.ts
grep -q "TD-33" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- `pickNext`와 runner 루프(`scripts/runner/next.ts`의 판단, `run.ts`)의 동작을 바꾸지 마라. 이유: 분류를 쓰는 연결은 step1이다. 이 step은 읽기와 순수 판정만 더한다.
- 필수 체크 상태를 체크 요약(`statusCheckRollup`)이나 combined status에서 만들지 마라. 이유: 출처를 보지 않고 context별 최신 하나만 준다(10.3절, Q20).
- `pr-state` 명령에서 GitHub에 쓰지 마라(상태·댓글·라벨). 이유: 대화 세션과 진단용 읽기 명령이다.
- `scripts/gates/`가 `scripts/runner/`나 `scripts/ci/`를 import하게 만들지 마라. 이유: 레이어 규칙(`docs/harness/architecture.md`).
