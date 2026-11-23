# Step 0: fewer-spawns

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`의 `lib/git.ts` 줄
- `scripts/lib/git.ts`(`RepoInfo`, `repoInfo`, `tryRepoInfo`, `git`, `gitTry`, `GitError`)
- `scripts/lib/exec.ts`의 `runSync`(읽기만. 고치지 않는다)
- `scripts/test/helpers.ts`(임시 리포), `scripts/test/runner.test.ts`(AC가 돌리는 runner 테스트)
- `docs/exec-plans/tech-debt-tracker.md`의 표 형식과 마지막 번호
- 이 계획의 수용 기준 2·3·7, "의사결정 로그" 5, 8, 9, 10과 "발견 사항" 1~4, "검증 방법과 결과"의 측정 2·Windows PC 측정·AC 확인

## 작업

### 1. `scripts/lib/git.ts`의 `repoInfo`를 git 한 번으로 읽는다

시그니처와 돌려주는 값(`RepoInfo`)은 그대로다. 결과를 담아 두지 않는다(의사결정 로그 9).

- `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir --abbrev-ref=loose HEAD` 한 번으로 읽는다(`gitTry`). 종료 코드가 0이고 출력(끝의 줄바꿈 하나를 뗀 것)이 네 줄이면, 앞 세 줄로 `root`·`gitDir`·`commonDir`·`mainRoot`·`isMainCheckout`을 지금과 같은 방법(`path.resolve` 등)으로 만들고 넷째 줄을 `branch`로 쓴다. detached HEAD면 넷째 줄은 `HEAD`다.
- 그 밖(커밋이 없는 브랜치에서는 128로 끝난다, 리포 아님, 출력 줄 수가 다름)이면 지금의 순서 그대로 다시 읽는다: `rev-parse --show-toplevel --absolute-git-dir --git-common-dir`(`git`. 실패하면 지금과 같은 `GitError`) → `symbolic-ref --short -q HEAD`(성공이 아니면 `'HEAD'`).
- 어떤 입력에서도 돌려주는 값과 던지는 예외가 지금과 같다. `--abbrev-ref=loose`(느슨한 줄임)는 `symbolic-ref --short`와 같은 규칙으로 줄인다. `--abbrev-ref`만 쓰면 엄격한 규칙이라 다르다("AC 확인").
- `repoInfo` 밖의 함수와 부르는 곳(`scripts/runner/`, `scripts/commands/`, 상태 파일 경로)은 바꾸지 않는다.

### 2. 테스트

프로세스 수는 테스트 안에서 `node:child_process`의 `spawnSync`를 감싼 뒤 `syncBuiltinESMExports()`(`node:module`)로 바꿔 센다. 테스트가 끝나면 원래대로 되돌린다. 제품 코드에 세는 장치를 두지 않는다(의사결정 로그 8). 새 테스트는 변경 전 코드에서 **단언으로** 실패해야 한다(프로세스 수 단언. test-effect가 `effective(base에서 단언 실패, …)`를 내야 한다).

새 파일 `scripts/test/repo-info.test.ts`(임시 리포는 `scripts/test/helpers.ts`로 만든다):

- `repoInfo`는 커밋이 있는 리포에서 부를 때마다 git을 하나만 띄운다(같은 cwd로 두 번 불러도 둘째에도 하나). 메인 체크아웃과 `git worktree add`로 만든 worktree 둘 다 본다. 자리 값(`root`, `gitDir`, `commonDir`, `mainRoot`, `isMainCheckout`)이 `git rev-parse`로 직접 읽은 값과 같다.
- `repoInfo().branch`가 그때 `git symbolic-ref --short -q HEAD`로 읽은 값(실패하면 `HEAD`)과 같다. 사례: 일반 브랜치, `/`가 든 이름, 같은 이름의 태그가 있는 브랜치(`heads/main`), 같은 짧은 이름의 원격 추적 ref가 있는 브랜치(`origin/zz` 브랜치와 `refs/remotes/origin/zz`), HEAD가 `refs/remotes/…`를 가리킴, detached HEAD, 커밋이 없는 브랜치(이때만 git이 셋이어도 된다). 같은 리포에서 브랜치를 바꾸면 다음 호출에 새 값이 나온다.
- 하위 폴더를 cwd로 주면 자리 값이 루트로 읽은 값과 같다.
- 리포가 아닌 폴더에서는 지금과 같은 `GitError`를 던진다(메시지가 `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir 실패`로 시작한다).
- 설정이 바뀌면 바로 보인다: 메인 체크아웃에서 `git config core.worktree <다른 폴더>`를 하면 다음 `repoInfo(root)`가 그때 git이 준 값(또는 예외)과 같다.

있던 테스트는 고치지 않고 통과한다. AC 둘째 줄이 돌리고, 여섯째 줄이 `repo-info.test.ts` 밖의 최상위 테스트 블록이 base와 글자 그대로 같은지 본다(4회차 지적 F12).

### 3. 문서와 기록

- `docs/harness/architecture.md`의 `lib/git.ts` 줄의 설명 끝에 쉼표와 공백 하나를 두고 아래 글을 글자 그대로 더한다. 그 줄의 다른 글은 바꾸지 않는다(표의 칸 맞춤은 `fmt`가 한다).

  ```text
  `repoInfo`는 git 한 번(`rev-parse … --abbrev-ref=loose HEAD`)으로 읽고 담아 두지 않는다
  ```

- 기술 부채 표(`docs/exec-plans/tech-debt-tracker.md`)에 새 행 둘을 더한다. 번호는 push할 때 main의 다음 번호다. (1) 발견 사항 1(Windows에서 캐시 키에 pnpm 버전이 빠진다. 고칠 것: 셸 래퍼를 실행하는 방법으로 버전을 읽고 Windows 테스트를 붙인다). (2) 발견 사항 2·3·4(Windows에서만 큰 테스트 비용 다섯과 각각 먼저 잴 것, 캐시 키의 도구 버전 실행 비용과 설계서 6절의 보장을 지키며 줄이는 방법, macOS에서 동시 실행의 이득이 경합에 막힌 측정).
- 변경 조각 `docs/harness/changes/20261123-windows-test-speed-s0.md`를 만든다(절차서 5절 "변경 조각" 형식). `## CHANGELOG` 항목 하나(`repoInfo`가 git을 둘에서 하나로 줄여 띄운다). `## 설계서 변경 이력`은 두지 않는다(설계서를 고치지 않는다).
- AC 셋째 줄이 출력한 동기 프로세스 수를 진행 로그에 적는다(수용 기준 3).
- 이 PR의 승인 요청 전에 "검증 방법과 결과"의 Windows A/B(수용 기준 5)가 진행 로그에 있어야 한다. 그것으로 step1을 할지가 정해진다. step1을 하지 않기로 정해지면 이 step이 마지막이므로 Windows PC 최종 측정(수용 기준 7)도 승인 요청 전에 받는다. step1을 하기로 정해지면 최종 측정은 step1에서 한다(4회차 지적 F10).

## Acceptance Criteria

```bash
node --test scripts/test/repo-info.test.ts
node --test scripts/test/runner.test.ts scripts/test/runner-review.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-plan-review.test.ts scripts/test/next.test.ts scripts/test/start.test.ts scripts/test/task.test.ts
d=$(mktemp -d) && node -e 'const [mod, log] = process.argv.slice(1); require("node:fs").writeFileSync(mod, ["import cp from \"node:child_process\";", "import { syncBuiltinESMExports } from \"node:module\";", "import { appendFileSync } from \"node:fs\";", `const LOG = ${JSON.stringify(require("node:path").resolve(log))};`, "const orig = cp.spawnSync;", "cp.spawnSync = function (...a) { appendFileSync(LOG, \"s\\n\"); return orig.apply(this, a); };", "syncBuiltinESMExports();", ""].join("\n"));' "$d/count.mjs" "$d/spawn.log" && NODE_OPTIONS="--import=$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$d/count.mjs")" node --test scripts/test/runner.test.ts > "$d/test.log" 2>&1 && node -e 'const n = require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).length; console.log(`runner.test.ts 37개의 동기 프로세스 ${n}개(상한 8400)`); process.exit(n > 0 && n <= 8400 ? 0 : 1);' "$d/spawn.log"
grep -qF '`repoInfo`는 git 한 번(`rev-parse … --abbrev-ref=loose HEAD`)으로 읽고 담아 두지 않는다' docs/harness/architecture.md
test -f docs/harness/changes/20261123-windows-test-speed-s0.md
node -e 'const { execFileSync: x } = require("node:child_process"), fs = require("node:fs"); const g = (...a) => x("git", a, { encoding: "utf8", maxBuffer: 1 << 28 }); const base = g("merge-base", "HEAD", "origin/main").trim(); const blocks = (texts) => { const b = []; for (const t of texts) { const L = t.split("\n"); for (let i = 0; i < L.length; i++) { if (!L[i].startsWith("test(")) continue; let j = i; if (!/\);\s*$/.test(L[i])) while (j + 1 < L.length && !/^[})]/.test(L[++j])); b.push(L.slice(i, j + 1).join("\n")); i = j; } } return b.sort(); }; const before = blocks(g("ls-tree", "--name-only", base, "scripts/test/").split("\n").filter((f) => f.endsWith(".test.ts")).map((f) => g("show", `${base}:${f}`))); const after = blocks(fs.readdirSync("scripts/test").filter((f) => f.endsWith(".test.ts") && f !== "repo-info.test.ts").map((f) => fs.readFileSync(`scripts/test/${f}`, "utf8"))); if (JSON.stringify(before) !== JSON.stringify(after)) { console.error(`최상위 test 블록이 base와 다르다: base ${before.length}개, 지금 ${after.length}개`); process.exit(1); } console.log(`repo-info.test.ts 밖의 최상위 test 블록 ${after.length}개가 base와 글자 그대로 같다`);'
```

## 금지사항

- `repoInfo`의 결과(자리, `branch`)를 프로세스 안에 담아 두지 마라. git 결과를 담아 두는 다른 캐시도 만들지 마라. 이유: 담아 둔 값은 설정(`core.worktree`, 포함된 설정 파일), 저장소 상태, 저장소 신뢰 판정(`safe.directory`)과 어긋날 수 있다(Codex F3·F6·F7, 의사결정 로그 9).
- `--abbrev-ref=loose`를 `--abbrev-ref`(엄격)로 바꾸지 마라. 이유: 같은 짧은 이름의 원격 추적 ref가 있으면 `symbolic-ref --short`와 다른 이름(`heads/…`)이 나온다.
- `repoInfo` 밖의 함수와 부르는 곳을 고치지 마라(`tryRepoInfo`는 `repoInfo`를 부르는 그대로 둔다). 이유: 범위가 커지고 값이 같은지 확인할 곳이 는다.
- `scripts/commands/check.ts`(`cacheKey`, `toolVersions`)를 고치지 마라. 이유: 도구 버전은 키를 만들 때마다 읽어야 한다(수용 기준 4, 의사결정 로그 10, Codex F2).
- `scripts/lib/exec.ts`(`runSync`, `run`, `killTree`)를 고치지 마라. 프로세스를 세는 변수나 훅을 제품 코드에 두지 마라. 이유: 의사결정 로그 5, 8.
- 있던 테스트 블록을 고치거나 지우지 마라. 테스트 파일을 나누지 마라(나누기는 step1이고 시작 조건이 있다). 이유: 수용 기준 1, 5.
- `harness.config.json`과 `profiles/core/profile.json`을 고치지 마라. 이유: 의사결정 로그 6.
- 설계서와 CHANGELOG를 직접 고치지 마라. 이유: 수용 기준 10.
- Windows A/B(수용 기준 5) 결과 없이 승인을 요청하지 마라. step1을 하지 않기로 정해졌으면 최종 측정(수용 기준 7) 없이도 요청하지 마라. 이유: 그 결과가 이 step이 마지막인지를 정하고, 마지막 step은 Windows 측정으로만 효과를 판정한다(F10).
