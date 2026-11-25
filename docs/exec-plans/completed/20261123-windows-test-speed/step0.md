# Step 0: fewer-spawns

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`의 `lib/git.ts` 줄
- `scripts/lib/git.ts`(`RepoInfo`, `repoInfo`, `tryRepoInfo`, `git`, `gitTry`, `GitError`)
- `scripts/lib/exec.ts`의 `runSync`(읽기만. 고치지 않는다)
- `scripts/test/helpers.ts`(임시 리포), `scripts/test/runner.test.ts`(AC가 돌리는 runner 테스트)
- 지표 테스트: `scripts/test/metrics-allow.ts`(`GIT_READ_SHAPES`), `scripts/test/metrics-command.test.ts`(`REPO_INFO_GIT`, "허용 목록의 git 다섯뿐이다" 테스트와 기본 자료원 경로 테스트), `scripts/commands/metrics.ts`(읽기만)
- `docs/exec-plans/tech-debt-tracker.md`의 표 형식과 마지막 번호
- 이 계획의 수용 기준 1~5, "의사결정 로그" 3, 5~9와 "발견 사항" 1~5, "검증 방법과 결과"의 측정 2·Windows PC 측정·AC 확인

## 작업

### 1. `scripts/lib/git.ts`의 `repoInfo`를 git 한 번으로 읽는다

시그니처와 돌려주는 값(`RepoInfo`)은 그대로다. 결과를 담아 두지 않는다(의사결정 로그 7).

- `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD` 한 번으로 읽는다(`gitTry`). 종료 코드가 0이고 출력(끝의 줄바꿈 하나를 뗀 것)이 네 줄이면, 앞 세 줄로 `root`·`gitDir`·`commonDir`·`mainRoot`·`isMainCheckout`을 지금과 같은 방법(`path.resolve` 등)으로 만들고 넷째 줄을 `branch`로 쓴다. detached HEAD면 넷째 줄은 `HEAD`다.
- 그 밖(커밋이 없는 브랜치에서는 128로 끝난다, 리포 아님, 출력 줄 수가 다름)이면 지금의 순서 그대로 다시 읽는다: `rev-parse --show-toplevel --absolute-git-dir --git-common-dir`(`git`. 실패하면 지금과 같은 `GitError`) → `symbolic-ref --short -q HEAD`(성공이 아니면 `'HEAD'`).
- 어떤 입력에서도 돌려주는 값과 던지는 예외가 지금과 같다. `--abbrev-ref=loose`(느슨한 줄임)는 `symbolic-ref --short`와 같은 규칙으로 줄인다. `--abbrev-ref`만 쓰면 엄격한 규칙이라 다르다("AC 확인").
- `repoInfo` 밖의 함수와 부르는 곳(`scripts/runner/`, `scripts/commands/`, 상태 파일 경로)은 바꾸지 않는다.

### 2. 테스트

프로세스 수는 테스트 안에서 `node:child_process`의 `spawnSync`를 감싼 뒤 `syncBuiltinESMExports()`(`node:module`)로 바꿔 센다. 테스트가 끝나면 원래대로 되돌린다. 제품 코드에 세는 장치를 두지 않는다(의사결정 로그 6). 새 테스트는 변경 전 코드에서 **단언으로** 실패해야 한다(프로세스 수 단언. test-effect가 `effective(base에서 단언 실패, …)`를 내야 한다).

새 파일 `scripts/test/repo-info.test.ts`(임시 리포는 `scripts/test/helpers.ts`로 만든다):

- `repoInfo`는 커밋이 있는 리포에서 부를 때마다 git을 하나만 띄운다(같은 cwd로 두 번 불러도 둘째에도 하나). 메인 체크아웃과 `git worktree add`로 만든 worktree 둘 다 본다. 자리 값(`root`, `gitDir`, `commonDir`, `mainRoot`, `isMainCheckout`)이 `git rev-parse`로 직접 읽은 값과 같다.
- `repoInfo().branch`가 그때 `git symbolic-ref --short -q HEAD`로 읽은 값(실패하면 `HEAD`)과 같다. 사례: 일반 브랜치, `/`가 든 이름, 같은 이름의 태그가 있는 브랜치(`heads/main`), 같은 짧은 이름의 원격 추적 ref가 있는 브랜치(`origin/zz` 브랜치와 `refs/remotes/origin/zz`), HEAD가 `refs/remotes/…`를 가리킴, detached HEAD, 커밋이 없는 브랜치(이때만 git이 셋이어도 된다). 같은 리포에서 브랜치를 바꾸면 다음 호출에 새 값이 나온다.
- 하위 폴더를 cwd로 주면 자리 값이 루트로 읽은 값과 같다.
- 리포가 아닌 폴더에서는 지금과 같은 `GitError`를 던진다(메시지가 `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir 실패`로 시작한다).
- 설정이 바뀌면 바로 보인다: 메인 체크아웃에서 `git config core.worktree <다른 폴더>`를 하면 다음 `repoInfo(root)`가 그때 git이 준 값(또는 예외)과 같다.

지표 테스트가 고정한 `repoInfo`의 git 명령을 새 꼴로 맞춘다(의사결정 로그 9). 이 밖의 있던 테스트 파일은 고치지 않는다(AC 여섯째 줄이 바이트까지 견준다).

- `scripts/test/metrics-allow.ts`의 `GIT_READ_SHAPES`: `rev-parse` 꼴의 `args`를 `['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir', '--abbrev-ref=loose', 'HEAD']`로 바꾸고 `symbolic-ref` 꼴을 뺀다. 위 주석의 "둘"·"다섯"을 맞추고, 커밋이 없는 브랜치에서만 `repoInfo`가 예전 둘(`rev-parse` 세 자리, `symbolic-ref`)을 실행하며 지표는 커밋이 있는 리포에서 돌아 목록에 두지 않는다는 것을 한 줄로 적는다.
- `scripts/test/metrics-command.test.ts`: `REPO_INFO_GIT`을 새 명령 하나로 바꾸고, 그 개수를 쓰는 자리(`slice(0, 2)`, `slice(2, 3)`)를 `REPO_INFO_GIT.length`로 쓴다. 꼴 이름의 기대(`names.slice(…)`, `GIT_READ_SHAPES.map(…)`의 목록)에서 `symbolic-ref`를 빼고 자리를 맞춘다. 테스트 제목 "…허용 목록의 git 다섯뿐이다"를 "…git 넷뿐이다"로, 주석의 "repoInfo의 둘"을 "repoInfo의 하나"로 바꾼다. 다른 줄은 바꾸지 않는다. AC 일곱째·여덟째 줄이 base의 두 파일에 정해진 바꿔치기(옛 글 → 새 글. 허용 목록 4곳, 지표 테스트 8곳)만 적용한 결과와 지금 파일을 바이트까지 견준다. 그 바꿔치기가 이 작업의 정확한 정의다(`.skip`을 붙이거나 단언을 지우는 것 같은 다른 변경은 실패한다. 6회차 지적 F13).
- 바꾼 `metrics-command.test.ts`는 변경 전 코드에서 단언으로 실패해야 한다(test-effect).

있던 테스트는 모두 통과한다(AC 첫째·둘째 줄과 `check`).

### 3. 문서와 기록

- `docs/harness/architecture.md`의 `lib/git.ts` 줄의 설명 끝에 쉼표와 공백 하나를 두고 아래 글을 글자 그대로 더한다. 그 줄의 다른 글은 바꾸지 않는다(표의 칸 맞춤은 `fmt`가 한다).

  ```text
  `repoInfo`는 git 한 번(`rev-parse … --abbrev-ref=loose HEAD`)으로 읽고 담아 두지 않는다
  ```

- 기술 부채 표(`docs/exec-plans/tech-debt-tracker.md`)에 새 행 둘을 더한다. 번호는 push할 때 main의 다음 번호다. (1) 발견 사항 1(Windows에서 캐시 키에 pnpm 버전이 빠진다. 고칠 것: 셸 래퍼를 실행하는 방법으로 버전을 읽고 Windows 테스트를 붙인다). (2) 발견 사항 2·3·4(Windows에서만 큰 테스트 비용 다섯과 각각 먼저 잴 것, 캐시 키의 도구 버전 실행 비용과 설계서 6절의 보장을 지키며 줄이는 방법, 긴 테스트 파일 나누기와 macOS에서 동시 실행의 이득이 경합에 막힌 측정, Windows A/B용 실험 브랜치).
- 변경 조각 `docs/harness/changes/20261123-windows-test-speed-s0.md`를 만든다(절차서 5절 "변경 조각" 형식). `## CHANGELOG` 항목 하나(`repoInfo`가 git을 둘에서 하나로 줄여 띄운다). `## 설계서 변경 이력`은 두지 않는다(설계서를 고치지 않는다).
- AC 셋째 줄이 출력한 동기 프로세스 수를 진행 로그에 적는다(수용 기준 3).
- 이 PR의 승인 요청 전에 "검증 방법과 결과"의 Windows PC 측정(수용 기준 5)을 받아 진행 로그와 PR 본문에 적는다. (가) base와 (나) 이 PR의 head 두 실행 모두 종료 코드 0·실패 0이고 (나)가 (가)보다 짧아야 승인을 요청한다. 아니면 요청하지 않고 제작자에게 묻는다.

## Acceptance Criteria

```bash
node --test scripts/test/repo-info.test.ts scripts/test/metrics-command.test.ts
node --test scripts/test/runner.test.ts scripts/test/runner-review.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-plan-review.test.ts scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/task.test.ts
d=$(mktemp -d) && node -e 'const [mod, log] = process.argv.slice(1); require("node:fs").writeFileSync(mod, ["import cp from \"node:child_process\";", "import { syncBuiltinESMExports } from \"node:module\";", "import { appendFileSync } from \"node:fs\";", `const LOG = ${JSON.stringify(require("node:path").resolve(log))};`, "const orig = cp.spawnSync;", "cp.spawnSync = function (...a) { appendFileSync(LOG, \"s\\n\"); return orig.apply(this, a); };", "syncBuiltinESMExports();", ""].join("\n"));' "$d/count.mjs" "$d/spawn.log" && NODE_OPTIONS="--import=$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$d/count.mjs")" node --test scripts/test/runner.test.ts > "$d/test.log" 2>&1 && node -e 'const n = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).length; console.log(`runner.test.ts 37개의 동기 프로세스 ${n}개(상한 8400)`); process.exit(n > 0 && n <= 8400 ? 0 : 1);' "$d/spawn.log"
grep -qF '`repoInfo`는 git 한 번(`rev-parse … --abbrev-ref=loose HEAD`)으로 읽고 담아 두지 않는다' docs/harness/architecture.md
test -f docs/harness/changes/20261123-windows-test-speed-s0.md
base=$(git merge-base HEAD origin/main) && git diff --quiet "$base" -- scripts/test ':(exclude)scripts/test/repo-info.test.ts' ':(exclude)scripts/test/metrics-command.test.ts' ':(exclude)scripts/test/metrics-allow.ts' && test -z "$(git ls-files --others --exclude-standard -- scripts/test ':(exclude)scripts/test/repo-info.test.ts')"
node -e 'const { execFileSync: x } = require("node:child_process"), fs = require("node:fs"); const f = "scripts/test/metrics-allow.ts"; const base = x("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim(); let t = x("git", ["show", `${base}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }); const pairs = [["/**\n * `repoInfo`(scripts/lib/git.ts)가 실행하는 둘과 `docLint`(scripts/gates/doc-lint.ts)가 실행하는 셋\n * (문서 목록과 커밋 시각은 step2, 변경 조각 목록은 계획 20261123-change-fragments step0).", "/**\n * `repoInfo`(scripts/lib/git.ts)가 실행하는 하나와 `docLint`(scripts/gates/doc-lint.ts)가 실행하는 셋\n * (문서 목록과 커밋 시각은 step2, 변경 조각 목록은 계획 20261123-change-fragments step0)."], [" * (문서 목록과 커밋 시각은 step2, 변경 조각 목록은 계획 20261123-change-fragments step0).\n * 다섯 다 읽기만 한다. `log`는 `--` 앞 네 자리가 맞고 그 뒤가 경로뿐일 때만 맞는다\n */", " * (문서 목록과 커밋 시각은 step2, 변경 조각 목록은 계획 20261123-change-fragments step0).\n * 넷 다 읽기만 한다. `log`는 `--` 앞 네 자리가 맞고 그 뒤가 경로뿐일 때만 맞는다.\n * `repoInfo`는 커밋이 없는 브랜치에서만 예전 둘(`rev-parse` 세 자리, `symbolic-ref`)을 대신 실행하는데, 지표는 커밋이 있는 리포에서 돌아 그 둘은 목록에 두지 않는다(계획 20261123-windows-test-speed step0)\n */"], ["    name: \u0027rev-parse\u0027,\n    args: [\u0027rev-parse\u0027, \u0027--show-toplevel\u0027, \u0027--absolute-git-dir\u0027, \u0027--git-common-dir\u0027],\n  },", "    name: \u0027rev-parse\u0027,\n    args: [\n      \u0027rev-parse\u0027,\n      \u0027--show-toplevel\u0027,\n      \u0027--absolute-git-dir\u0027,\n      \u0027--git-common-dir\u0027,\n      \u0027--abbrev-ref=loose\u0027,\n      \u0027HEAD\u0027,\n    ],\n  },"], ["  },\n  { name: \u0027symbolic-ref\u0027, args: [\u0027symbolic-ref\u0027, \u0027--short\u0027, \u0027-q\u0027, \u0027HEAD\u0027] },\n  {", "  },\n  {"]]; for (const [o, n] of pairs) { if (t.split(o).length !== 2) { console.error(`${f}: base에 바꿀 글이 정확히 한 번 있어야 한다: ${JSON.stringify(o.slice(0, 80))}`); process.exit(1); } t = t.replace(o, () => n); } if (fs.readFileSync(f, "utf8") !== t) { console.error(`${f}: 계획에 적은 바꿔치기 밖의 변경이 있다`); process.exit(1); } console.log(`${f}: 계획에 적은 바꿔치기 ${pairs.length}개만 바뀌었다`);'
node -e 'const { execFileSync: x } = require("node:child_process"), fs = require("node:fs"); const f = "scripts/test/metrics-command.test.ts"; const base = x("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim(); let t = x("git", ["show", `${base}:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }); const pairs = [["const REPO_INFO_GIT = [\n  \u0027git rev-parse --show-toplevel --absolute-git-dir --git-common-dir\u0027,\n  \u0027git symbolic-ref --short -q HEAD\u0027,\n];", "const REPO_INFO_GIT = [\n  \u0027git rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD\u0027,\n];"], ["\ntest(\u0027메모리 자료로 실행하는 동안 뜬 자식 프로세스는 허용 목록의 git 다섯뿐이다\u0027, () => {\n  const { work } = repo();", "\ntest(\u0027메모리 자료로 실행하는 동안 뜬 자식 프로세스는 허용 목록의 git 넷뿐이다\u0027, () => {\n  const { work } = repo();"], ["  assert.equal(r.code, 0, r.err);\n  // repoInfo의 둘이 먼저 오고, 그 뒤는 docLint의 문서 목록과 커밋 시각 읽기, 마지막에 변경 조각 목록 읽기 하나다\n  assert.deepEqual(guard.seen.slice(0, 2).map(show), REPO_INFO_GIT);\n  for (const c of guard.seen) {", "  assert.equal(r.code, 0, r.err);\n  // repoInfo의 하나가 먼저 오고, 그 뒤는 docLint의 문서 목록과 커밋 시각 읽기, 마지막에 변경 조각 목록 읽기 하나다\n  assert.deepEqual(guard.seen.slice(0, REPO_INFO_GIT.length).map(show), REPO_INFO_GIT);\n  for (const c of guard.seen) {"], ["  const names = guard.seen.map((c) => matchShape(GIT_READ_SHAPES, c.args)?.name);\n  assert.deepEqual(names.slice(0, 3), [\u0027rev-parse\u0027, \u0027symbolic-ref\u0027, \u0027ls-files\u0027]);\n  assert.equal(names.at(-1), \u0027ls-files-changes\u0027, names.join(\u0027, \u0027));", "  const names = guard.seen.map((c) => matchShape(GIT_READ_SHAPES, c.args)?.name);\n  assert.deepEqual(names.slice(0, 2), [\u0027rev-parse\u0027, \u0027ls-files\u0027]);\n  assert.equal(names.at(-1), \u0027ls-files-changes\u0027, names.join(\u0027, \u0027));"], ["  assert.ok(\n    names.slice(3, -1).every((n) => n === \u0027log\u0027),\n    names.join(\u0027, \u0027),", "  assert.ok(\n    names.slice(2, -1).every((n) => n === \u0027log\u0027),\n    names.join(\u0027, \u0027),"], ["    GIT_READ_SHAPES.map((x) => x.name),\n    [\u0027rev-parse\u0027, \u0027symbolic-ref\u0027, \u0027ls-files\u0027, \u0027log\u0027, \u0027ls-files-changes\u0027],\n  );", "    GIT_READ_SHAPES.map((x) => x.name),\n    [\u0027rev-parse\u0027, \u0027ls-files\u0027, \u0027log\u0027, \u0027ls-files-changes\u0027],\n  );"], ["  assert.equal(gh.length, 15);\n  // gh 밖은 허용 목록의 git뿐이다: repoInfo의 둘, docLint의 문서 목록(과 커밋 시각 읽기)\n  const others = cpGuard.seen.filter((c) => c.cmd !== \u0027gh\u0027);", "  assert.equal(gh.length, 15);\n  // gh 밖은 허용 목록의 git뿐이다: repoInfo의 하나, docLint의 문서 목록(과 커밋 시각 읽기)\n  const others = cpGuard.seen.filter((c) => c.cmd !== \u0027gh\u0027);"], ["  const others = cpGuard.seen.filter((c) => c.cmd !== \u0027gh\u0027);\n  assert.deepEqual(others.slice(0, 2).map(show), REPO_INFO_GIT);\n  assert.deepEqual(others.slice(2, 3).map(show), [\n    \u0027git ls-files -z --cached --others --exclude-standard -- *.md\u0027,", "  const others = cpGuard.seen.filter((c) => c.cmd !== \u0027gh\u0027);\n  assert.deepEqual(others.slice(0, REPO_INFO_GIT.length).map(show), REPO_INFO_GIT);\n  assert.deepEqual(others.slice(REPO_INFO_GIT.length, REPO_INFO_GIT.length + 1).map(show), [\n    \u0027git ls-files -z --cached --others --exclude-standard -- *.md\u0027,"]]; for (const [o, n] of pairs) { if (t.split(o).length !== 2) { console.error(`${f}: base에 바꿀 글이 정확히 한 번 있어야 한다: ${JSON.stringify(o.slice(0, 80))}`); process.exit(1); } t = t.replace(o, () => n); } if (fs.readFileSync(f, "utf8") !== t) { console.error(`${f}: 계획에 적은 바꿔치기 밖의 변경이 있다`); process.exit(1); } console.log(`${f}: 계획에 적은 바꿔치기 ${pairs.length}개만 바뀌었다`);'
```

## 금지사항

- `repoInfo`의 결과(자리, `branch`)를 프로세스 안에 담아 두지 마라. git 결과를 담아 두는 다른 캐시도 만들지 마라. 이유: 담아 둔 값은 설정(`core.worktree`, 포함된 설정 파일), 저장소 상태, 저장소 신뢰 판정(`safe.directory`)과 어긋날 수 있다(Codex F3·F6·F7, 의사결정 로그 7).
- `--abbrev-ref=loose`를 `--abbrev-ref`(엄격)로 바꾸지 마라. 이유: 같은 짧은 이름의 원격 추적 ref가 있으면 `symbolic-ref --short`와 다른 이름(`heads/…`)이 나온다.
- `repoInfo` 밖의 함수와 부르는 곳을 고치지 마라(`tryRepoInfo`는 `repoInfo`를 부르는 그대로 둔다). 이유: 범위가 커지고 값이 같은지 확인할 곳이 는다.
- `scripts/commands/check.ts`(`cacheKey`, `toolVersions`)를 고치지 마라. 이유: 도구 버전은 키를 만들 때마다 읽어야 한다(수용 기준 4, 의사결정 로그 8, Codex F2).
- `scripts/lib/exec.ts`(`runSync`, `run`, `killTree`)를 고치지 마라. 프로세스를 세는 변수나 훅을 제품 코드에 두지 마라. 이유: 의사결정 로그 3, 6.
- 작업 2에 적은 지표 두 파일의 자리 밖에서 있던 테스트를 고치거나 지우지 마라. 테스트 파일을 나누지 마라. 지표 허용 목록에 새 꼴을 더하며 옛 꼴을 남기지 마라. 이유: 수용 기준 2, 의사결정 로그 2·9.
- `harness.config.json`과 `profiles/core/profile.json`을 고치지 마라. 이유: 의사결정 로그 4.
- 설계서와 CHANGELOG를 직접 고치지 마라. 이유: 수용 기준 8.
- Windows PC 측정(수용 기준 5) 없이 승인을 요청하지 마라. 이유: 이 계획의 벽시계 효과는 그 측정으로만 판정한다.
