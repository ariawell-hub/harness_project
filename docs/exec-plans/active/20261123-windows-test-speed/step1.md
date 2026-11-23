# Step 1: fewer-spawns

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`의 `lib/git.ts` 줄
- `scripts/lib/git.ts`(`RepoInfo`, `repoInfo`, `tryRepoInfo`, `harnessStateDir`, `gitTry`)
- 상태 파일 경로: `scripts/runner/next.ts`(`prWaitFile`, `conflictFile`, `questionFile`, `readQuestionState`, `writeQuestionState`), `scripts/runner/review.ts`(`stateFile`, `readReviewState`), `scripts/runner/run.ts`(`retryQuestions`의 `unposted`)
- `scripts/commands/check.ts`(`toolVersions`, `cacheKey`)
- `scripts/lib/exec.ts`의 `runSync`(읽기만. 고치지 않는다)
- step0이 나눈 runner 테스트 파일(`scripts/test/runner*.test.ts`)과 보조 모듈(`scripts/test/runner-fixture.ts` 등)
- `docs/exec-plans/tech-debt-tracker.md`의 표 형식과 마지막 번호
- 이 계획의 "의사결정 로그" 5, 8, 9, 10과 "발견 사항" 1, 2, "검증 방법과 결과"의 측정 2와 추적 스크립트

## 작업

### 1. `scripts/lib/git.ts`: worktree 자리를 다시 읽지 않는다

```ts
/** worktree의 자리. 브랜치는 넣지 않는다(체크아웃마다 바뀐다) */
export type RepoDirs = Omit<RepoInfo, 'branch'>;

/**
 * cwd의 worktree 자리. 같은 프로세스에서 같은 worktree 루트를 다시 물으면 git을 띄우지 않는다.
 * 리포가 아니거나 git이 실패하면 지금의 repoInfo와 같은 GitError를 던진다
 */
export function repoDirs(cwd: string): RepoDirs;

/** 담아 둔 자리를 모두 버린다(테스트용) */
export function clearRepoDirs(): void;
```

규칙(의사결정 로그 9):

- 자리는 지금처럼 `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir` 한 번으로 읽고, 값을 만드는 방법(`path.resolve` 등)도 지금 `repoInfo`와 같다.
- 담는 키는 `path.resolve(cwd)`다. 읽은 `root`를 `path.resolve`한 값이 키와 같을 때만 담는다(Windows는 대소문자를 가리지 않고 견준다). 아니면(하위 폴더, 경로 표기가 다름) 담지 않고 매번 git으로 읽는다.
- 꺼낼 때 프로세스를 띄우지 않고 파일로만 확인한다: `<root>/.git`이 폴더면 그 경로가, 일반 파일이면 첫 줄 `gitdir: <경로>`를 `root` 기준으로 `path.resolve`한 값이 담아 둔 `gitDir`과 같고(Windows는 대소문자를 가리지 않는다), 그 `gitDir`이 있어야 한다. 다르거나 읽지 못하면 그 항목을 버리고 git으로 다시 읽는다(다시 읽은 값은 위 규칙대로 담는다).
- `process.env`에 `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_CEILING_DIRECTORIES`, `GIT_DISCOVERY_ACROSS_FILESYSTEM` 가운데 하나라도 있으면 담지도 꺼내지도 않는다.
- 실패는 담지 않는다. 돌려주는 객체는 호출마다 새 객체다(부른 쪽이 고쳐도 담아 둔 값이 바뀌지 않는다).
- `repoInfo(cwd)`는 `repoDirs(cwd)`에 지금과 같은 방법(`symbolic-ref --short -q HEAD`, 실패하면 `'HEAD'`)으로 읽은 `branch`를 더해 돌려준다. 어떤 입력에서도 돌려주는 값과 던지는 예외가 지금과 같다.
- `harnessStateDir`의 첫 인자를 `Pick<RepoDirs, 'gitDir' | 'commonDir'>`로 넓힌다(동작은 같다).

### 2. 상태 파일 경로는 `repoDirs`로 구한다

- `scripts/runner/next.ts`: `prWaitFile`, `conflictFile`이 `repoInfo` 대신 `repoDirs`를 쓴다. `questionFile`·`readQuestionState`·`writeQuestionState`의 인자를 `Pick<RepoDirs, 'gitDir' | 'commonDir'>`로 넓힌다(`RepoInfo`를 넘기는 곳은 그대로 둔다).
- `scripts/runner/review.ts`: `stateFile`이 `repoDirs`를 쓴다.
- `scripts/runner/run.ts`: `retryQuestions`의 `unposted`가 `readQuestionState(repoDirs(worktree))`를 쓴다.
- 이 넷 밖의 `repoInfo` 호출은 바꾸지 않는다(1의 규칙으로 git이 둘에서 하나로 준다).

### 3. `scripts/commands/check.ts`: 도구 버전을 한 번만 실행한다

- `toolVersions()`의 결과를 이 모듈 안에서 그때의 `process.env.PATH` 값(없으면 빈 문자열)을 키로 담는다. 같은 키면 `pnpm --version`·`gitleaks version`을 다시 실행하지 않는다(의사결정 로그 10).
- 돌려주는 문자열의 모양과 값은 지금과 같다(Windows에서 pnpm 버전이 빠지는 문제는 고치지 않는다. 발견 사항 1).

### 4. 테스트

프로세스 수는 테스트 안에서 `node:child_process`의 `spawnSync`를 감싼 뒤 `syncBuiltinESMExports()`(`node:module`)로 바꿔 센다. 테스트가 끝나면 원래대로 되돌린다. 제품 코드에 세는 장치를 두지 않는다(의사결정 로그 8). 새 테스트는 변경 전 코드에서 **단언으로** 실패해야 한다: 프로세스 수 단언은 이미 있는 함수(`repoInfo`, `readPrWait`, `readConflictState`, `readReviewState`, `readQuestionState`, `cacheKey`)로 하고, 새 함수만 쓰는 단언은 그 뒤에 둔다(test-effect가 `effective(base에서 단언 실패, …)`를 내야 한다).

- 새 파일 `scripts/test/repo-dirs.test.ts`(임시 리포는 `scripts/test/helpers.ts`로 만든다):
  - 같은 worktree 루트로 `repoInfo`를 두 번 부르면 둘째에는 git을 하나만 띄우고(`symbolic-ref`), 값은 첫째와 같다.
  - 같은 루트로 `readPrWait`·`readConflictState`·`readReviewState`와 `readQuestionState(repoDirs(root))`를 처음 한 번 부른 뒤 다시 부르면 git을 띄우지 않는다.
  - 브랜치를 바꾸면(`git checkout -b`, `git checkout --detach`) 다음 `repoInfo`의 `branch`가 새 값(`HEAD` 포함)이다.
  - worktree를 지우고 같은 경로에 git-dir 이름이 다른 worktree를 다시 만들면(같은 이름의 관리 폴더가 남아 있게 해서 git이 다른 이름을 고르게 한다) 다음 `repoInfo`의 `gitDir`이 새 git-dir이다. 지우기만 하면 다음 호출이 전처럼 `GitError`를 던진다.
  - 하위 폴더를 cwd로 주면 부를 때마다 git으로 읽고(둘째에도 `rev-parse`가 돈다) 값은 루트로 읽은 값과 같다.
  - `GIT_DIR`이 있으면 담아 둔 값을 쓰지 않는다(그 환경 변수대로 git이 준 값과 같다). 테스트가 끝나면 환경 변수를 되돌린다.
  - 메인 체크아웃과 worktree 모두에서 `repoDirs`와 `repoInfo`의 자리 값이 `git rev-parse`로 직접 읽은 값과 같다(`isMainCheckout` 포함).
- 새 파일 `scripts/test/check-tools.test.ts`:
  - 같은 `PATH`로 `cacheKey`를 두 번 부르면 `pnpm`과 `gitleaks`는 각각 많아야 한 번 실행되고 두 키는 같다.
  - `PATH` 값을 바꾸면(없는 폴더를 하나 덧붙인다) 다시 실행한다. 테스트가 끝나면 `PATH`를 되돌린다. 가짜 실행 파일을 만들지 않는다(Windows에서 확장자 없는 파일은 실행되지 않는다).
- step0이 나눈 runner 테스트와 `next.test.ts`·`check-skip.test.ts`·`gates.test.ts`는 고치지 않고 통과한다.

### 5. 문서와 기록

- `docs/harness/architecture.md`의 `lib/git.ts` 줄의 설명 끝에 쉼표와 공백 하나를 두고 아래 글을 글자 그대로 더한다. 그 줄의 다른 글은 바꾸지 않는다(표의 칸 맞춤은 `fmt`가 한다).

  ```text
  같은 프로세스에서 worktree 루트의 자리를 다시 읽지 않는 캐시(`repoDirs`. 꺼낼 때 `.git`이 같은 git-dir을 가리키는지 본다)
  ```

- 기술 부채 표(`docs/exec-plans/tech-debt-tracker.md`)에 새 행 둘을 더한다. 번호는 push할 때 main의 다음 번호다. (1) 발견 사항 1(Windows에서 캐시 키에 pnpm 버전이 빠진다. 고칠 것: 셸 래퍼를 실행하는 방법으로 버전을 읽고 Windows 테스트를 붙인다). (2) 발견 사항 2(Windows에서만 큰 테스트 비용 다섯과 각각 먼저 잴 것).
- 변경 조각 `docs/harness/changes/20261123-windows-test-speed-s1.md`를 만든다. `## CHANGELOG` 항목 하나(같은 프로세스에서 worktree 자리와 도구 버전을 다시 읽지 않아 git·도구 실행이 준다). `## 설계서 변경 이력`은 두지 않는다(설계서를 고치지 않는다).
- 추적 스크립트("검증 방법과 결과")로 옛 `runner.test.ts`의 테스트 37개(`runner.test.ts`, `runner-questions.test.ts`, `runner-question-delivery.test.ts`)를 macOS에서 다시 재 동기 프로세스 수를 진행 로그에 적는다. 측정 2의 9887개보다 25% 이상 적어야 한다(수용 기준 5). 모자라면 까닭을 진행 로그에 적고 제작자에게 알린다.

## Acceptance Criteria

```bash
node --test scripts/test/repo-dirs.test.ts scripts/test/check-tools.test.ts
node --test scripts/test/runner.test.ts scripts/test/runner-questions.test.ts scripts/test/runner-question-delivery.test.ts scripts/test/runner-review.test.ts scripts/test/runner-review-rebuttal.test.ts scripts/test/runner-review-round.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-pr-update.test.ts scripts/test/runner-plan-review.test.ts scripts/test/next.test.ts scripts/test/check-skip.test.ts scripts/test/gates.test.ts scripts/test/start.test.ts scripts/test/task.test.ts
grep -qF '같은 프로세스에서 worktree 루트의 자리를 다시 읽지 않는 캐시(`repoDirs`. 꺼낼 때 `.git`이 같은 git-dir을 가리키는지 본다)' docs/harness/architecture.md
test -f docs/harness/changes/20261123-windows-test-speed-s1.md
```

## 금지사항

- `branch`를 담아 두지 마라. 이유: 체크아웃마다 바뀐다. `repoInfo`는 매번 `symbolic-ref`로 읽는다.
- 실패(리포 아님, git 오류)를 담지 마라. 이유: 나중에 `git init`·`worktree add`된 자리를 계속 리포가 아니라고 본다.
- 꺼낼 때의 확인을 빼거나 기한(TTL)으로 바꾸지 마라. 이유: runner는 한 프로세스에서 worktree를 지우고 같은 경로에 다시 만든다(의사결정 로그 9).
- 1·2·3에 적은 곳 밖의 호출을 바꾸거나, `RepoInfo`를 넘겨 쓰도록 부르는 쪽을 고치지 마라. 이유: 범위가 커지고 값이 같은지 확인할 곳이 는다.
- `scripts/lib/exec.ts`(`runSync`, `run`, `killTree`)를 고치지 마라. 프로세스를 세는 변수나 훅을 제품 코드에 두지 마라. 이유: 의사결정 로그 5, 8.
- 있던 테스트 블록을 고치거나 지우지 마라. 이유: 수용 기준 1. 새 테스트만 더한다.
- `toolVersions`가 돌려주는 문자열을 바꾸지 마라(Windows의 pnpm 포함). 이유: 키의 값이 그대로여야 한다(수용 기준 4). Windows 문제는 기술 부채로 넘긴다.
- `harness.config.json`과 `profiles/core/profile.json`을 고치지 마라. 이유: 의사결정 로그 6.
- 설계서와 CHANGELOG를 직접 고치지 마라. 이유: 수용 기준 9.
