# Step 0: literal-paths

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/`, `lib/` 줄)
- `scripts/gates/harness-guard.ts`의 `harnessGuard`(신호를 모으는 반복문의 끝, 위험 플래그 부분)
- `scripts/gates/test-effect.ts`의 `headBlob`, `pastBlobs`, `runOnBase`(head 판을 덮어쓰는 부분), `testEffect`
- `scripts/lib/git.ts`의 `git`, `gitTry`
- `scripts/test/harness-guard.test.ts`의 `repo`·`run`·`reasons`와 위험 플래그 테스트, `scripts/test/test-effect.test.ts`의 `repo`·`check`·`outcomes`와 "이전 판으로 되돌린"·"예외 줄" 테스트, `scripts/test/helpers.ts`
- 이 계획의 "목표와 수용 기준"(지금의 git 동작)과 "의사결정 로그"(조사한 자리)

## 작업

### 1. `scripts/lib/git.ts`

- 상수 `LITERAL_PATHSPECS = '--literal-pathspecs'`(export). git의 전역 옵션이라 하위 명령 앞에 둔다: `git([LITERAL_PATHSPECS, 'diff', …, '--', 파일], root)`. 주석에 뜻(그 호출의 경로 인자를 pathspec이 아니라 글자 그대로 읽는다)과 쓰는 때(남이 정한 파일 이름을 경로 인자로 넘길 때)를 적는다.
- `git`·`gitTry`의 동작은 바꾸지 않는다.

### 2. `scripts/gates/harness-guard.ts`

- 파일별 diff 호출(`gitTry(['diff', '-U0', '--no-renames', …, '--', f], …)`)의 인자 맨 앞에 `LITERAL_PATHSPECS`를 둔다. 다른 인자와 그 뒤의 처리(더해진 줄에서 위험 플래그를 찾는다, `.md`는 보지 않는다)는 그대로다.

### 3. `scripts/gates/test-effect.ts`

- `headBlob`의 `git ls-tree HEAD -- <파일>`, `pastBlobs`의 `git rev-list -n <한도> <base> -- <파일>`, `runOnBase`의 `git checkout -q <head> -- <파일들>` 세 호출의 인자 맨 앞에 `LITERAL_PATHSPECS`를 둔다. 다른 인자와 처리는 그대로다.
- `git hash-object -- <파일>`, `git rev-parse <커밋>:<파일>`, `git show HEAD:<파일>`은 고치지 않는다(pathspec이 아니다).

### 4. 테스트(먼저 쓴다)

새 테스트와 그 도우미는 두 테스트 파일의 끝에 붙인다. 있던 내용은 import 줄까지 한 글자도 바꾸지 않는다(새 테스트는 그 파일에 이미 있는 import와 도우미만 쓴다). 그래서 병합 기준 커밋(merge-base)의 파일 내용이 고친 파일의 앞부분에 그대로 남고, AC가 그것을 바이트로 견준다(있던 테스트의 단언을 지우거나 고치면 실패한다).

`*`와 `:`은 Windows의 파일 이름에 쓸 수 없다. 그 글자가 든 이름을 만드는 테스트는 Windows에서 건너뛴다(`process.platform === 'win32'`). `[`가 든 이름의 테스트는 건너뛰지 않는다.

`scripts/test/harness-guard.test.ts`에 더한다(있던 테스트는 고치지 않는다).

- 이름에 `[`가 든 파일: base에 `scripts/a[1].ts`와 `scripts/a1.ts`를 둔다. PR이 `scripts/a1.ts`에 위험 플래그를 더하고 `scripts/a[1].ts`에는 평범한 줄을 더한다. 위험 플래그 추가 신호는 `scripts/a1.ts`의 것 하나뿐이다(`scripts/a[1].ts`의 신호가 없다). 지금은 둘 다 나온다.
- 그 파일 자신에 더한 위험 플래그: PR이 `scripts/a[1].ts`에 위험 플래그를 더하면 그 파일의 신호가 나온다(지금도 통과한다. 고친 뒤에도 놓치지 않는지 보는 테스트다).
- 이름이 `*`인 파일과 `.md`(Windows에서는 건너뛴다): base에 `docs/harness/n*`(확장자 없는 파일)와 `docs/harness/notes.md`를 둔다. PR이 `docs/harness/notes.md`에 위험 플래그가 든 줄을 더하고 `docs/harness/n*`에는 평범한 줄을 더한다. 위험 플래그 추가 신호가 하나도 없다. 지금은 `docs/harness/n*`의 신호가 나온다.
- 위험 플래그 문자열은 있던 테스트처럼 나눠 적는다(`'--dangerously-' + 'skip-permissions'`). 이유: 테스트 파일도 보호 경로라 그대로 적으면 이 PR 자신이 신호를 낸다.

`scripts/test/test-effect.test.ts`에 더한다(있던 테스트는 고치지 않는다). 셋 다 커밋된 변경만 보는 실행(`check(root, base, true)`)이다. 테스트 파일을 실행하는 명령은 `[process.execPath]`로 바꿔 쓴다(`repo({ command: [process.execPath] })`). 이유: `node --test <파일>`은 인자를 glob으로 읽어 이름에 glob 글자가 든 파일을 실행하지 못한다("발견 사항" 둘째 항목). 이 step이 보는 것은 git에 넘기는 이름이다.

- 이전 판 찾기: `t/x[ab].test.mjs`를 첫 판으로 커밋하고, 둘째 판으로 고쳐 커밋한다. 그 뒤 `t/xa.test.mjs`를 고치는 커밋을 한도(30)보다 많이 쌓는다. 그 끝이 base다. PR이 `t/x[ab].test.mjs`를 첫 판으로 되돌린다(base에서도 통과하는 내용이다). 결과가 `restored`다. 지금은 `restored`가 아니다(한도 안의 커밋이 모두 `t/xa.test.mjs`를 바꾼 것이라 그 파일의 첫 판을 보지 못한다).
- base 체크아웃: 설정에 실패 이유를 가리는 정규식(`assertPattern`)을 둔다. base에 `t/xa.test.mjs`가 있다. PR이 `t/xa.test.mjs`를 고쳐 값을 하나 더 내보내고(export), 계획 파일의 예외 줄로 그 파일을 판정에서 뺀다(`exempt`). PR이 새 파일 `t/x[ab].test.mjs`를 더한다. 이 파일은 `./xa.test.mjs`를 네임스페이스로 가져와(`import * as`) 그 값을 고유한 메시지의 단언으로 견주고, 단언 뒤에 고유한 표식을 출력한다.
  - 먼저 head에서 그 파일을 직접 실행해 통과하고 표식이 출력되는 것을 단언한다(그 이름의 파일이 실행되고 단언까지 가는 테스트라는 확인이다. 테스트 실행기 안에서 띄우므로 `NODE_TEST_CONTEXT`를 비워 넘긴다).
  - 판정 결과: `t/x[ab].test.mjs`가 `effective`이고 실패 이유가 단언 실패(`reason: 'assertion'`)다. base 체크아웃의 `t/xa.test.mjs`는 base 판이라 그 값이 없어 그 단언에서 실패한다. `effective`만 보지 않는 이유: 그 파일이 base 체크아웃에 놓이지 않았거나 가져오기에서 죽어도 `effective`가 되지만 그때의 이유는 단언 실패가 아니다(`other`). 네임스페이스로 가져오는 이유도 같다(없는 이름을 직접 가져오면 단언 전에 죽는다).
  - 지금은 `ineffective`다(glob에 맞는 `t/xa.test.mjs`도 head 판으로 덮어써 base에서 통과한다).
- `:`으로 시작하는 이름(Windows에서는 건너뛴다): 설정의 `files`에 리포 최상위의 테스트 파일도 넣는다(`['*.test.mjs', 't/*.test.mjs']`). PR이 최상위에 `:!x.test.mjs`(base에서도 통과하는 테스트)를 더한다. 예외 없이 끝나고 결과가 `ineffective`다. 지금은 `git ls-tree`가 실패해 `testEffect`가 예외로 끝난다.

테스트만 담은 커밋을 구현 커밋보다 먼저 만들고, 구현 전의 실패를 진행 로그에 적는다.

### 5. 문서와 기술 부채 표

- `docs/harness/design.md`: 머리말의 버전을 올리고 0절 변경 이력에 한 항목(Issue #218, TD-28 해결)을 더한다. 본문의 절은 고치지 않는다(판정의 규칙은 그대로이고 읽는 방법만 바뀐다).
- `docs/harness/CHANGELOG.md`: "다음 버전"에 한 항목.
- `docs/exec-plans/tech-debt-tracker.md`: TD-28의 상태를 `해결(#218: …)`로 바꾼다. 해결 글에 실험으로 확인한 것(자기 diff는 빠지지 않고 다른 파일의 것이 더해졌다)을 적는다. 새 행 하나(상태 `열림`): "발견 사항"의 두 항목. (1) `harness-guard`의 파일별 diff가 실패해도 조용히 넘어간다. (2) `test-effect`의 실행 명령 `node --test <파일>`이 파일 이름을 glob으로 읽는다.
- 계획의 "발견 사항" 두 항목 끝에 `→ 처리: TD-<새 번호>`를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/harness-guard.test.ts scripts/test/test-effect.test.ts
git rev-parse --verify --quiet origin/main^{commit}
test "$(head -c "$(git cat-file -s "$(git merge-base origin/main HEAD):scripts/test/harness-guard.test.ts")" scripts/test/harness-guard.test.ts | git hash-object --stdin)" = "$(git rev-parse "$(git merge-base origin/main HEAD):scripts/test/harness-guard.test.ts")"
test "$(head -c "$(git cat-file -s "$(git merge-base origin/main HEAD):scripts/test/test-effect.test.ts")" scripts/test/test-effect.test.ts | git hash-object --stdin)" = "$(git rev-parse "$(git merge-base origin/main HEAD):scripts/test/test-effect.test.ts")"
test "$(git cat-file -s "$(git merge-base origin/main HEAD):scripts/test/harness-guard.test.ts")" -lt "$(wc -c < scripts/test/harness-guard.test.ts)"
test "$(git cat-file -s "$(git merge-base origin/main HEAD):scripts/test/test-effect.test.ts")" -lt "$(wc -c < scripts/test/test-effect.test.ts)"
grep -qE "^export const LITERAL_PATHSPECS = '--literal-pathspecs';$" scripts/lib/git.ts
[ $(grep -o 'LITERAL_PATHSPECS' scripts/gates/harness-guard.ts | wc -l) -ge 2 ]
[ $(grep -o 'LITERAL_PATHSPECS' scripts/gates/test-effect.ts | wc -l) -ge 4 ]
git diff --quiet origin/main...HEAD -- scripts/runner scripts/ci scripts/gates/doc-lint.ts scripts/gates/scope.ts scripts/gates/bypass-scan.ts scripts/gates/conflict-markers.ts scripts/commands harness.config.json profiles
grep -qE '^  - v0\.7\.[0-9]+ \(2026-11-[0-9]+\): .*Issue #218' docs/harness/design.md
grep -qF -- '--literal-pathspecs' docs/harness/CHANGELOG.md
grep -qE '^\| TD-28 .*\| 해결\(#218' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-[0-9]+ +\| .*node --test.*\| 열림 *\|$' docs/exec-plans/tech-debt-tracker.md
test "$(grep -c '→ 처리: TD-' docs/exec-plans/*/20261122-literal-pathspec/plan.md)" = 2
node scripts/harness.ts doc-lint
```

## 금지사항

- 있던 테스트를 고치거나 지우지 마라. 이유: 평범한 이름의 판정이 그대로라는 것을 그 테스트가 본다(수용 기준 4).
- `git`·`gitTry`가 늘 `--literal-pathspecs`를 붙이게 하거나 환경 변수 `GIT_LITERAL_PATHSPECS`를 넣지 마라. 이유: 일부러 pathspec을 쓰는 호출(`doc-lint`의 `*.md`, `bypass-scan`의 `:(exclude)*.md`)이 깨진다.
- "의사결정 로그"에서 남기기로 한 자리(`doc-lint`, `bypass-scan`, `conflict-markers`, `scope`, `plan-hash`, `task.ts`, runner)를 고치지 마라. 이유: 범위 밖이고, 다른 세션의 작업과 겹친다.
- 위험 플래그의 목록, `.md`를 보지 않는 규칙, 이전 판의 한도, 판정의 결과 문구를 바꾸지 마라. 이유: 이 step은 git에 이름을 넘기는 방법만 바꾼다.
- glob 글자나 `:`이 든 이름의 파일을 거절하거나 `invalid`로 돌리지 마라. 이유: 그런 이름은 웹 프로파일의 평범한 경로다(`src/app/[id]/page.test.tsx`).
- `harness-guard`의 파일별 diff가 실패했을 때의 처리와 `test-effect`의 실행 명령을 이 step에서 고치지 마라. 이유: "발견 사항"으로 남겨 따로 정한다(재현할 실패 경로와 고치는 방법이 아직 없다).
- 테스트 파일에 위험 플래그 문자열을 그대로 적지 마라. 이유: 테스트 파일도 보호 경로라 이 PR이 `harness-guard`의 신호를 낸다.
- 테스트가 이 리포의 파일을 바꾸게 하지 마라(임시 리포에서만 쓴다).
