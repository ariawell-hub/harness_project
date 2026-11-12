# Step 1: claim-release

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/exec-plans/active/20261111-fix-claim-start-main-fast/plan.md` (목표, 의사결정 로그)
- `scripts/commands/task.ts` (`claimIssue`, `releaseClaim`, `fetchRemote`, `TaskError`)
- `scripts/runner/run.ts` (`cleanupMerged`: 로컬 worktree가 있을 때만 선점을 푼다)
- `scripts/runner/next.ts` (5번 우선순위의 `ls-remote --heads <remote> claim/*` 파싱)
- `scripts/lib/github.ts` (`GitHubPort.getIssue`, `listOpenIssues`, `Issue.state`)
- `scripts/lib/github-fake.ts` (`addFakeIssue`, `createPR`, `enableAutoMerge`: 본문에 `Closes #N`이 있으면 병합 때 Issue가 닫힌다. 없는 번호의 `getIssue`는 예외를 던진다)
- `scripts/test/helpers.ts`, `scripts/test/runner.test.ts`
- `AGENTS.md` "세션 시작 절차", `docs/harness/workflow.md` 1절, `docs/harness/CHANGELOG.md`
- 앞 step에서 만든·바꾼 파일:
  - `scripts/lib/git.ts` (`fastForwardMain`)
  - `scripts/commands/start.ts` (main 동기화 → 설정 재로드, `## ② 정리` 절)
  - `scripts/runner/run.ts` (`syncMain`)
  - `scripts/test/start.test.ts` (fixture·가짜 GitHub·subprocess로 `start`를 실행하는 방식)
  - `AGENTS.md`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`

## 작업

배경: 대화형 경로(`complete-step` → PR → 병합)에는 선점 해제가 없다. `start`의 `cleanupMerged`는 마지막 step의 worktree가 로컬에 남아 깨끗하고 PR이 병합된 경우에만 `claim/<N>`을 지운다. worktree를 손으로 지웠거나 다른 머신에서 작업했으면 claim이 원격에 남는다(Issue #1의 `claim/1`, Issue #4). 그래서 로컬 상태가 아니라 **GitHub Issue가 닫혔는지**를 기준으로 정리한다. Issue는 마지막 step PR의 `Closes #N`으로 닫힌다.

1. `scripts/commands/task.ts`

   ```ts
   /** 원격의 claim/<숫자> 브랜치 번호(오름차순). 조회 실패는 TaskError */
   export function listRemoteClaims(main: string, cfg: HarnessConfig): number[];

   /** 원격 claim/<issue>를 지운다. 성공하면 true */
   export function releaseClaim(main: string, cfg: HarnessConfig, issue: number): boolean;

   export interface ClaimCleanup {
     released: number[];
     kept: number[];
     failed: { issue: number; reason: string }[];
   }

   /** 닫힌 Issue의 claim 브랜치를 원격에서 지운다(세션 시작 절차 ②) */
   export function releaseClosedClaims(
     main: string,
     cfg: HarnessConfig,
     gh: GitHubPort,
     openIssues: Issue[],
   ): ClaimCleanup;
   ```

   - `listRemoteClaims`는 `git ls-remote --heads <remote> claim/*`를 쓴다. `claim/<숫자>`가 아닌 이름(예: `claim/abc`, `claim/1/x`)은 버린다.
   - `releaseClosedClaims` 규칙:
     - `openIssues`에 있는 번호 → `kept`. GitHub를 다시 부르지 않는다.
     - 그 밖의 번호는 `gh.getIssue(N)`로 확인한다. `state === 'closed'`일 때만 `releaseClaim`을 부르고, 성공하면 `released`, 실패하면 `failed`(stderr 첫 줄). 열려 있으면 `kept`.
     - `getIssue`가 실패하면(없는 번호, 네트워크) 지우지 않고 `failed`에 이유와 함께 넣는다.
     - 멱등이다: 다시 실행해도 오류가 없고 `released`가 비어 있다.
   - `releaseClaim`의 기존 호출부(`cleanupMerged`)는 반환값을 쓰지 않아도 된다(동작 동일).

2. `scripts/runner/next.ts`의 5번 우선순위에서 claim 번호를 `listRemoteClaims`로 얻는다. 조회 실패는 지금처럼 빈 집합으로 다룬다(try/catch). 그 밖의 동작은 바꾸지 않는다.
3. `scripts/commands/start.ts`의 `## ② 정리` 절에서 worktree 정리(`cleanupMerged`) 다음에 `releaseClosedClaims(main, cfg, gh, issues)`를 호출한다. `issues`는 ①에서 받은 열린 Issue 목록이다. 출력:
   - 해제한 것마다 `- 선점 해제: claim/<N> (Issue #<N> 닫힘)`
   - 확인 실패마다 `- 선점 유지(확인 실패): claim/<N> — <이유>`
   - claim 목록 조회 실패(`TaskError`)는 경고 한 줄을 내고 넘어간다. `start`의 종료 코드는 바꾸지 않는다.
   - 파일 맨 위 주석의 절차 설명에 선점 해제를 더한다.
4. 테스트: `scripts/test/start.test.ts`에 추가한다(로컬 bare 원격 + `github-fake`).
   - 준비: 가짜 Issue #1(열림), #2를 만든다. #2는 **가짜 PR 병합으로 닫는다**: 파일 하나를 바꾼 브랜치를 원격에 push → `createPR({ head, base: 'main', title, body: 'Closes #2' })` → `enableAutoMerge`(mergeMode `immediate`). `claimIssue`로 `claim/1`, `claim/2`, `claim/99`(가짜 GitHub에 없는 번호)를 원격에 만든다. 로컬 worktree는 만들지 않는다(대화형 경로에서 worktree가 이미 지워진 상태를 재현한다).
   - `releaseClosedClaims`: `released`가 `[2]`, `kept`가 `[1]`, `failed`는 99 하나. `git ls-remote --heads origin claim/*`에 claim/1·claim/99는 있고 claim/2는 없다. 다시 호출하면 `released`가 비어 있다.
   - `listRemoteClaims`: 원격에 `claim/abc` 브랜치가 있어도 숫자 claim만 돌려준다.
   - `start` 통합: 같은 준비 뒤 fixture 리포에서 `node scripts/harness.ts start`를 subprocess로 실행한다(env `HARNESS_FAKE_GH`). 종료 코드 0, 원격에 claim/2가 없고 claim/1은 있으며, 출력에 `claim/2`가 있다. 이 테스트는 고치기 전 코드에서 실패해야 한다.
   - 먼저 실패하는 테스트를 실행한 기록(명령과 실패 요지)을 계획의 진행 로그에 남긴다.
5. 문서
   - `AGENTS.md` "세션 시작 절차" 2번에 "닫힌 Issue의 `claim/<N>` 브랜치를 지운다"를 더한다(스크립트가 한다). 120줄 상한 안에 둔다.
   - `docs/harness/workflow.md` 1절의 선점 설명(`new-task`가 `claim/<issue>`를 push해 선점한다는 줄 근처)에 한 줄: 선점은 마지막 step이 병합되어 Issue가 닫힌 뒤 다음 `start`가 지운다. 손으로 지우지 않는다. 만료된 선점 정리는 아직 없다(TD-11).
   - `docs/harness/CHANGELOG.md` "다음 버전 (미배포)"에 한 줄: `start`가 닫힌 Issue의 `claim/<N>`을 지움(확인 못 한 claim은 유지), `next`의 claim 목록 파싱 공용화.
6. 계획 파일: 진행 로그, 발견 사항(처리 포함), "검증 방법과 결과"의 결과, "다음 할 일"을 갱신한다. 이 step이 마지막이다. PR 본문 첫 줄은 `Closes #4`.

## Acceptance Criteria

```bash
node --test scripts/test/start.test.ts scripts/test/runner.test.ts
grep -q "export function releaseClosedClaims" scripts/commands/task.ts
grep -q "export function listRemoteClaims" scripts/commands/task.ts
grep -q "닫힌 Issue" AGENTS.md
node scripts/harness.ts check
```

## 금지사항

- GitHub에서 닫혔음을 확인하지 못한 claim(조회 실패, 없는 번호)은 지우지 마라. 이유: 살아 있는 선점을 지우면 두 작업자가 같은 Issue를 맡는다(8.3절).
- 열린 Issue의 claim을 마지막 push 시각(만료) 기준으로 지우지 마라. 이유: 만료 선점 정리는 정기 작업(TD-11, 설계서 12.2절)의 범위이고 인수 절차(Issue 댓글)가 따로 있다.
- `claim/<숫자>` 말고 다른 원격 브랜치를 지우지 마라. 이유: 작업 브랜치·PR head는 GitHub 설정과 `cleanupMerged`가 다룬다.
- force push(`--force`, `--force-with-lease`)를 쓰지 마라. 이유: R2. 선점 해제는 `push --delete`뿐이다.
- `complete-step`에서 선점을 풀지 마라. 이유: 그 시점엔 PR이 병합되기 전이라 다른 작업자가 같은 Issue를 선점할 수 있다.
- runner 루프(`runRunner`)에 `releaseClosedClaims`를 넣지 마라. 이유: 이 계획 범위 밖이다(runner는 `cleanupMerged`로 자기 선점을 푼다). 필요해 보이면 발견 사항에 적는다.
- `fastForwardMain`과 `start`의 main 동기화 동작을 바꾸지 마라. 이유: step0에서 끝난 범위다.
