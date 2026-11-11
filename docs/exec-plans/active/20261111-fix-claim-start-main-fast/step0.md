# Step 0: main-sync

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/exec-plans/active/20261111-fix-claim-start-main-fast/plan.md` (목표, 의사결정 로그)
- `scripts/commands/start.ts` (`start`: 설정 로드 → fetch → ① needs-human → ② 정리 → ③ 다음 할 일)
- `scripts/runner/run.ts` (`syncMain`, `runRunner`의 `fetchRemote` → `syncMain` 순서)
- `scripts/commands/task.ts` (`fetchRemote`)
- `scripts/lib/git.ts` (`git`, `gitTry`, `isClean`, `revParse`)
- `scripts/lib/config.ts` (`loadConfig`)
- `scripts/lib/github-fake.ts` (`initFakeState`, 환경 변수 `HARNESS_FAKE_GH`)
- `scripts/test/helpers.ts` (`makeFixture`, `fixtureConfig`, `sh`, `write`, `commitAll`, `tmp`)
- `scripts/test/runner.test.ts` (가짜 GitHub를 붙이는 방식)
- `AGENTS.md` "세션 시작 절차", `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`
- 앞 step에서 만든·바꾼 파일: 없음(첫 step)

## 작업

배경: `start`는 `fetch`만 하고 로컬 main을 당기지 않는다. 그래서 병합 뒤에도 main 체크아웃의 `harness.config.json`이 옛 버전으로 읽혀 "github.owner(제작자 계정)가 비어 있어" 경고가 났다(Issue #4). runner에는 같은 일을 하는 `syncMain`(`scripts/runner/run.ts`)이 있지만 당기지 못한 이유를 버린다.

1. `scripts/lib/git.ts`에 main 체크아웃 fast-forward 함수를 추가한다.

   ```ts
   export type MainSync =
     | { status: 'updated'; from: string; to: string }
     | { status: 'up-to-date'; head: string }
     | { status: 'skipped'; reason: string };

   /** main 체크아웃을 <remote>/<branch>로 fast-forward 한다. fetch는 호출자가 먼저 한다 */
   export function fastForwardMain(mainRoot: string, remote: string, branch: string): MainSync;
   ```

   - 아래 순서로 판정한다. `skipped`의 `reason`은 사람이 읽는 한국어 한 줄이고, 고치는 법을 짧게 붙인다.
     1. 체크아웃된 브랜치가 `branch`가 아니다(다른 브랜치, detached HEAD) → skipped. 이유에 지금 브랜치(또는 detached)를 적는다.
     2. 작업 트리가 깨끗하지 않다(`isClean`, 추적 안 된 파일 포함) → skipped.
     3. `<remote>/<branch>`가 없다 → skipped.
     4. HEAD와 `<remote>/<branch>`가 같다 → `up-to-date`.
     5. HEAD가 `<remote>/<branch>`의 조상이 아니다(로컬에만 있는 커밋이 있다. 앞섰거나 갈라졌다) → skipped. 이유에 로컬 전용 커밋 수(`rev-list --count <remote>/<branch>..HEAD`)를 적는다.
     6. `git merge --ff-only --quiet <remote>/<branch>`. 실패하면 skipped(stderr 첫 줄), 성공하면 `updated`와 전후 SHA.
   - 예외를 던지지 않는다(git 실패는 모두 skipped로 돌려준다).

2. `scripts/runner/run.ts`의 `syncMain`은 `fastForwardMain(ctx.main.mainRoot, remote, defaultBranch)`를 호출만 한다. runner 동작(결과를 무시하고 진행, 출력 없음)은 바꾸지 않는다. 쓰지 않게 된 import는 지운다.
3. `scripts/commands/start.ts`
   - 순서: 설정 로드 → `fetchRemote`(실패하면 지금처럼 경고) → `fastForwardMain(main, remote, defaultBranch)` → **설정을 다시 로드**(`loadConfig(main)`) → GitHub 연결 → ① needs-human → ② 정리 → ③ 다음 할 일. ①부터는 다시 읽은 설정만 쓴다.
   - fetch가 실패해도 fast-forward는 시도한다(로컬에 있는 마지막 원격 상태 기준).
   - ② 절 제목을 `## ② 정리`로 바꾸고, 첫 줄에 main 동기화 결과를 출력한다(`origin/main`은 설정의 remote·defaultBranch로 만든다).
     - updated: `- main: origin/main으로 당겼다 (<from 앞 7자리> → <to 앞 7자리>)`
     - up-to-date: `- main: 최신(origin/main과 같다)`
     - skipped: `- main: 당기지 않았다 — <reason>`
   - 그 아래에 기존 worktree 정리 결과를 출력한다(`- 삭제: <경로>`, 없으면 `- 병합된 worktree: 없음`).
   - 당기지 못해도 `start`의 종료 코드는 지금과 같다.
   - 파일 맨 위 주석의 절차 설명에 main 동기화를 더한다.
4. 테스트: 새 파일 `scripts/test/start.test.ts` (node:test, 로컬 bare 원격 + `github-fake`)
   - 원격 main을 앞서게 만들 때는 fixture의 bare 원격(`fx.remote`)을 다른 임시 디렉터리에 clone해 커밋하고 push한 뒤, fixture 리포에서 `git fetch`한다.
   - `fastForwardMain` 단위:
     - (a) 원격이 앞서면 `updated`이고 로컬 main HEAD == `origin/main`.
     - (b) 같으면 `up-to-date`.
     - (c) 추적 파일을 고친 채면 `skipped`이고 HEAD와 그 파일 내용이 그대로다.
     - (d) main 체크아웃이 다른 브랜치면 `skipped`.
     - (e) 로컬 main에만 커밋이 있으면(원격도 앞선 갈라진 경우 포함) `skipped`이고 이유에 로컬 전용 커밋 수가 있다.
   - `start` 통합: fixture 리포에서 `node scripts/harness.ts start`를 subprocess로 실행한다(env `HARNESS_FAKE_GH=<initFakeState로 만든 파일>`, `HARNESS_WORKER`는 아무 이름).
     - 로컬 main의 `harness.config.json`은 `github.owner`가 빈 문자열이고(`makeFixture`의 설정 덮어쓰기는 `github` 객체 전체를 바꾸므로 나머지 필드도 넣는다), 원격 main에는 `"maker"`로 고친 커밋이 있다. 실행하면 종료 코드 0, 로컬 main HEAD == `origin/main`, 출력(stdout+stderr)에 `github.owner` 경고가 없고 `당겼다`가 있다. 이 테스트는 고치기 전 코드에서 실패해야 한다.
     - main 체크아웃에 추적 파일 변경이 있으면 종료 코드 0, 출력에 `당기지 않았다`와 이유가 있고, HEAD와 변경 내용이 그대로다.
   - 먼저 실패하는 테스트를 실행한 기록(명령과 실패 요지)을 계획의 진행 로그에 남긴다.
5. 문서
   - `AGENTS.md` "세션 시작 절차" 2번을 이렇게 바꾼다: "main 체크아웃이 깨끗하고 fast-forward가 되면 `origin/main`까지 당기고(안 되면 이유를 출력한다), 병합된 브랜치의 worktree를 정리한다(스크립트가 한다)." `AGENTS.md`는 120줄 상한 안에 둔다.
   - `docs/harness/architecture.md`의 `lib/git.ts` 행에 "main 체크아웃 fast-forward"를 더한다.
   - `docs/harness/CHANGELOG.md` "다음 버전 (미배포)"에 한 줄: `start`가 main을 fast-forward 하고 설정을 다시 읽음, 못 당기면 이유 출력, runner `syncMain`과 같은 함수(`fastForwardMain`).
   - `docs/exec-plans/tech-debt-tracker.md`에 TD-17을 등록한다. 내용: "runner는 시작할 때 읽은 `harness.config.json`을 끝까지 쓴다. 매 바퀴 `syncMain`으로 main을 당겨도 설정 변경은 runner를 다시 시작해야 반영된다" / 근거: Issue #4, `runRunner` / 다시 볼 때: runner 장시간 운영 전 또는 설정 변경이 잦아질 때 / 상태: 열림. TD-17이 이미 있으면 다음 빈 번호를 쓰고, `plan.md` "발견 사항"의 TD 번호도 같이 고친다.
6. 계획 파일: 진행 로그(먼저 실패한 테스트 기록 포함), 예상과 다른 점은 발견 사항에 처리와 함께 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/start.test.ts scripts/test/runner.test.ts
grep -q "export function fastForwardMain" scripts/lib/git.ts
grep -q "origin/main" AGENTS.md
grep -q "TD-17" docs/exec-plans/tech-debt-tracker.md
node scripts/harness.ts check
```

## 금지사항

- main 체크아웃에서 `reset`, `checkout`, `switch`, `stash`, `clean`, `rebase`, `pull`, ff-only가 아닌 `merge`를 실행하지 마라. 이유: 사람의 로컬 커밋·미커밋 작업을 지킨다(R14). 당길 수 없으면 이유만 출력한다.
- 당기지 못했다고 `start`를 실패(종료 코드 1)로 끝내지 마라. 이유: 수용 기준이 "이유를 출력하고 넘어간다"이다.
- runner 출력·이벤트를 늘리지 마라(`syncMain`은 결과를 무시한다). 이유: 매 바퀴 반복되어 로그만 늘고, 이 step의 범위는 `start`의 출력이다.
- runner가 실행 중에 설정을 다시 읽도록 고치지 마라. 이유: 이 계획의 범위 밖이다(TD-17로 등록만 한다).
- `claim/*` 정리(선점 해제)를 이 step에서 구현하지 마라. 이유: step1 범위다.
- 테스트에서 `git reset --hard`로 상태를 되돌리지 마라. 이유: R14. 원격을 앞서게 할 때는 별도 clone을 쓴다.
