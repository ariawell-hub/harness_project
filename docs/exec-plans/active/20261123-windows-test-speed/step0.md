# Step 0: split

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`의 "테스트" 절(69~71줄 근처: `scripts/test/*.test.ts`와 `scripts/selftest/` 설명)
- 나눌 파일: `scripts/test/runner.test.ts`, `scripts/test/runner-review.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/selftest.test.ts`
- 공용 도구: `scripts/test/helpers.ts`(`makeFixture` 등. 고치지 않는다), 보조 모듈의 예 `scripts/test/markdown-model.ts`
- `docs/harness/workflow.md` 3절(test-effect와 예외 줄)과 5절의 "변경 조각"
- `harness.config.json`의 `commands.test`(동시 실행 수)와 `testEffect`(읽기만)
- 이 계획의 "의사결정 로그" 1~4와 "검증 방법과 결과"의 측정 3

## 작업

### 1. 테스트를 표대로 옮긴다

`test` 명령은 파일을 동시에 8개 돌리고 한 파일의 테스트는 차례로 돈다. 가장 긴 파일이 전체 시간을 정하므로 긴 파일 넷을 아래 표대로 나눈다. **테스트 블록**(`test(`로 시작하는 줄부터 그 블록을 닫는 줄까지)은 한 글자도 바꾸지 않고 옮긴다. 순서는 원래 파일의 순서를 지킨다. 옮기는 단위는 표의 "처음"부터 "끝"까지 붙어 있는 테스트 전부다(그 사이의 테스트를 빼거나 다른 데서 가져오지 않는다).

시간은 측정 3(macOS, 동시 8개)의 테스트별 시간을 더한 것이다.

| 파일(`scripts/test/`)                  | 처음 테스트(제목의 앞부분)                                     | 끝 테스트(제목의 앞부분)                                                             | 수  | 시간  |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --- | ----- |
| `runner.test.ts`(남긴다)               | `runner: Issue 하나를 계획 → step 2개 → 자동 병합까지`         | `runner: step 완료 push가 거부되고 원격 브랜치가 갈라졌으면`                         | 9   | 73.5s |
| `runner-questions.test.ts`(새)         | `questionComment: 질문의 글은 코드 블록 하나 안에`             | `runner: 기준 댓글이 목록에 없어도 번호로 이번 질문의 댓글을 찾고`                   | 15  | 71.0s |
| `runner-question-delivery.test.ts`(새) | `runner: GitHub이 질문 댓글의 본문을 거부하면(HTTP 422)`       | `questionNotice: 질문의 글 없이 질문이 있는 곳과 답하는 법을 알린다`                 | 13  | 56.9s |
| `runner-review.test.ts`(남긴다)        | `openBlocking·failedResponses·settledResponses:`               | `runner: 수정 세션 뒤 AC가 실패하면 그 수정을 git revert로 되돌리고`                 | 7   | 68.0s |
| `runner-review-rebuttal.test.ts`(새)   | `runner: 원장 댓글 작성자가 검증 App 봇이 아니면`              | `runner: 계획 검증 단계의 반박은 계획 폴더 파일만 바꾼 커밋을 push한다`              | 12  | 53.4s |
| `runner-review-round.test.ts`(새)      | `runner: 같은 지적에 반박 2회 뒤에도 열려 있으면`              | `longOpen: 미룬 지적·닫힌 지적·받아들인 지적·P2·P3은 대상이 아니고`                  | 8   | 63.6s |
| `runner-pr.test.ts`(남긴다)            | `runner: 봇 계정이 쓴 같은 이름의 success만 있는 PR은`         | `runner: review/*·review-ledger 실패는 check 실패용 수정 세션이 아니라`              | 7   | 58.3s |
| `runner-pr-update.test.ts`(새)         | `runner: 뒤처진 PR은 필수 체크가 모두 success일 때만 갱신한다` | `runner: push한 커밋이 PR head에 아직 반영되지 않았으면`                             | 5   | 63.2s |
| `selftest.test.ts`(남긴다)             | `self-test: 이 리포의 하네스는 모든 시나리오를 통과한다`       | (같다)                                                                               | 1   | 86.2s |
| `selftest-cases.test.ts`(새)           | `self-test: MCP 규칙을 판정하지 않거나`                        | `self-test 기본 모드는 실제 세션 시나리오(scripts/selftest/live/)를 실행하지 않는다` | 12  | 21s   |

- 수와 시간은 2026-11-23 main(`67bd225`)의 것이다(참고). AC 셋째 줄은 수가 아니라 표의 처음·끝 테스트 제목으로 base 파일의 범위를 잘라, 그 범위의 테스트 블록이 해당 파일에 같은 차례·글로 정확히 있는지 본다. 처음·끝 제목은 base 파일에서 그 앞부분으로 시작하는 첫 테스트를 가리킨다.
- 이 step 도중 main에서 이 네 파일의 두 묶음 사이나 묶음 안에 테스트가 더해지거나 바뀌면, `origin/main`을 병합한 뒤 그 테스트를 표의 범위대로 그 묶음의 파일에 글자 그대로 옮긴다(AC 둘째·셋째 줄은 그 경우에도 맞다). 파일의 첫 묶음 앞이나 마지막 묶음 뒤에 더해지거나 처음·끝 테스트의 제목이 바뀌면 표를 고쳐야 하므로 멈추고 알린다(계획 수정).
- 각 파일의 머리 주석(파일이 무엇을 시험하는지)을 새 파일에도 둔다. 원래 파일의 머리 주석은 남은 테스트에 맞게 고친다. 주석은 테스트 블록이 아니다.

### 2. 함께 쓰는 준비 코드를 보조 모듈로 옮긴다

- 나뉜 파일 둘 이상이 쓰는 도우미(`setup`, `run`, 상수, 가짜 GitHub·원장·체크 도우미 등)는 계열마다 새 보조 모듈 하나로 옮겨 `export`한다.
  - `runner.test.ts` 계열 → `scripts/test/runner-fixture.ts`
  - `runner-review.test.ts` 계열 → `scripts/test/runner-review-fixture.ts`
  - `runner-pr.test.ts` 계열 → `scripts/test/runner-pr-fixture.ts`
- 한 파일에서만 쓰는 도우미는 그 파일로 옮긴다(보조 모듈에 넣지 않는다).
- `selftest.test.ts`의 도우미(`copyHarness`, `weaken`, `selfTestCli` 등)는 옮겨 가는 12개만 쓰면 `selftest-cases.test.ts`로 옮긴다. `IDS`는 남는 테스트가 쓴다. 둘 다 쓰는 것이 있으면 보조 모듈을 만들지 말고 알려라(표의 묶음으로는 생기지 않을 것이다).
- 옮기는 도우미의 이름·인자·기본값·동작을 바꾸지 않는다. `export`를 붙이고 import 경로를 고치는 것만 한다. 보조 모듈은 이름이 `.test.ts`로 끝나지 않는다(`test` 명령이 테스트 파일로 돌리지 않는다).
- 보조 모듈은 그 계열의 테스트 파일만 import한다.

### 3. 문서

- `docs/harness/architecture.md`의 문장 "`scripts/test/selftest.test.ts`가 `check`에서 이 리포와 약화된 사본을 시험한다."를 "`scripts/test/selftest.test.ts`가 `check`에서 이 리포를, `scripts/test/selftest-cases.test.ts`가 약화된 사본과 실행기를 시험한다."로 바꾼다. 같은 문단의 다른 글은 바꾸지 않는다.
- 설계서(`docs/harness/design.md`)는 고치지 않는다(12.4절의 "`selftest.test.ts`가 그 브랜치의 시나리오로 그 브랜치의 하네스를 시험한다"는 그대로 맞다. 의사결정 로그 3).
- 변경 조각 `docs/harness/changes/20261123-windows-test-speed-s0.md`를 만든다(절차서 5절 "변경 조각" 형식). `## CHANGELOG` 항목 하나: 긴 테스트 파일 넷을 파일 10개로 나눠 `test`의 동시 실행을 쓰게 했다는 것과 테스트 블록은 그대로라는 것. `## 설계서 변경 이력`은 두지 않는다.

### 4. test-effect 예외

- 이 step이 추가·수정한 테스트 파일 10개(표의 모든 파일)는 기존 테스트를 옮긴 것이라 변경 전 코드에서도 통과하거나, 새 보조 모듈이 없어 단언 전에 끝난다. 파일마다 예외 줄을 이 계획의 "의사결정 로그" 끝에 적는다: ``- test-effect 예외: `<경로>` @ `<blob>` — 사유: 기존 테스트 블록을 글자 그대로 옮겼다(Issue #230 나누기, AC 둘째 줄이 확인한다)``
- blob은 `check`(또는 `node scripts/harness.ts test-effect`)가 출력하는 "고치는 법" 줄의 값이나 `git hash-object <경로>`의 값이다. 파일을 다시 고치면(main 병합 포함) 그 파일의 줄을 새 blob으로 바꾼다.

### 5. 측정

- 나눈 뒤 macOS에서 `test`를 측정 3과 같은 방법(동시 8개, 파일별 보고기)으로 한 번 돌려, 나눈 파일 10개의 시간과 전체 시간을 진행 로그에 적는다. 판정이 아니라 기록이다(수용 기준 2, 의사결정 로그 11). 표의 예상(75초 안팎, `selftest.test.ts` 86~88초)과 크게 다르면 까닭을 진행 로그에 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/runner.test.ts scripts/test/runner-questions.test.ts scripts/test/runner-question-delivery.test.ts scripts/test/runner-review.test.ts scripts/test/runner-review-rebuttal.test.ts scripts/test/runner-review-round.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-pr-update.test.ts scripts/test/selftest.test.ts scripts/test/selftest-cases.test.ts
node -e 'const { execFileSync: x } = require("node:child_process"), fs = require("node:fs"); const g = (...a) => x("git", a, { encoding: "utf8", maxBuffer: 1 << 28 }); const base = g("merge-base", "HEAD", "origin/main").trim(); const blocks = (texts) => { const b = []; for (const t of texts) { const L = t.split("\n"); for (let i = 0; i < L.length; i++) { if (!L[i].startsWith("test(")) continue; let j = i; if (!/\);\s*$/.test(L[i])) while (j + 1 < L.length && !/^[})]/.test(L[++j])); b.push(L.slice(i, j + 1).join("\n")); i = j; } } return b.sort(); }; const before = blocks(g("ls-tree", "--name-only", base, "scripts/test/").split("\n").filter((f) => f.endsWith(".test.ts")).map((f) => g("show", `${base}:${f}`))); const after = blocks(fs.readdirSync("scripts/test").filter((f) => f.endsWith(".test.ts")).map((f) => fs.readFileSync(`scripts/test/${f}`, "utf8"))); if (JSON.stringify(before) !== JSON.stringify(after)) { console.error(`최상위 test 블록이 base와 다르다: base ${before.length}개, 지금 ${after.length}개`); process.exit(1); } console.log(`최상위 test 블록 ${after.length}개가 base와 글자 그대로 같다`);'
node -e 'const { execFileSync: x } = require("node:child_process"), fs = require("node:fs"); const g = (...a) => x("git", a, { encoding: "utf8", maxBuffer: 1 << 28 }); const base = g("merge-base", "HEAD", "origin/main").trim(); const blocks = (t) => { const b = [], L = t.split("\n"); for (let i = 0; i < L.length; i++) { if (!L[i].startsWith("test(")) continue; let j = i; if (!/\);\s*$/.test(L[i])) while (j + 1 < L.length && !/^[})]/.test(L[++j])); b.push(L.slice(i, j + 1).join("\n")); i = j; } return b; }; const title = (b) => (/^test\(\s*([\x27"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(b) || [])[2] || ""; const plan = { "runner": [["runner", "runner: Issue 하나를 계획 → step 2개 → 자동 병합까지", "runner: step 완료 push가 거부되고 원격 브랜치가 갈라졌으면"], ["runner-questions", "questionComment: 질문의 글은 코드 블록 하나 안에", "runner: 기준 댓글이 목록에 없어도 번호로 이번 질문의 댓글을 찾고"], ["runner-question-delivery", "runner: GitHub이 질문 댓글의 본문을 거부하면(HTTP 422)", "questionNotice: 질문의 글 없이 질문이 있는 곳과 답하는 법을 알린다"]], "runner-review": [["runner-review", "openBlocking·failedResponses·settledResponses:", "runner: 수정 세션 뒤 AC가 실패하면 그 수정을 git revert로 되돌리고"], ["runner-review-rebuttal", "runner: 원장 댓글 작성자가 검증 App 봇이 아니면", "runner: 계획 검증 단계의 반박은 계획 폴더 파일만 바꾼 커밋을 push한다"], ["runner-review-round", "runner: 같은 지적에 반박 2회 뒤에도 열려 있으면", "longOpen: 미룬 지적·닫힌 지적·받아들인 지적·P2·P3은 대상이 아니고"]], "runner-pr": [["runner-pr", "runner: 봇 계정이 쓴 같은 이름의 success만 있는 PR은", "runner: review/*·review-ledger 실패는 check 실패용 수정 세션이 아니라"], ["runner-pr-update", "runner: 뒤처진 PR은 필수 체크가 모두 success일 때만 갱신한다", "runner: push한 커밋이 PR head에 아직 반영되지 않았으면"]], "selftest": [["selftest", "self-test: 이 리포의 하네스는 모든 시나리오를 통과한다", "self-test: 이 리포의 하네스는 모든 시나리오를 통과한다"], ["selftest-cases", "self-test: MCP 규칙을 판정하지 않거나", "self-test 기본 모드는 실제 세션 시나리오(scripts/selftest/live/)를 실행하지 않는다"]] }; let bad = 0; for (const [src, groups] of Object.entries(plan)) { const bb = blocks(g("show", `${base}:scripts/test/${src}.test.ts`)); let next = 0; for (const [file, first, last] of groups) { const i = bb.findIndex((b) => title(b).startsWith(first)), j = bb.findIndex((b) => title(b).startsWith(last)); if (i !== next || j < i) { console.error(`${src}.test.ts: ${file}.test.ts 묶음의 처음·끝 테스트를 base에서 찾지 못했거나 앞 묶음에 이어지지 않는다`); bad = 1; break; } const want = bb.slice(i, j + 1), path = `scripts/test/${file}.test.ts`, got = fs.existsSync(path) ? blocks(fs.readFileSync(path, "utf8")) : []; if (JSON.stringify(want) !== JSON.stringify(got)) { console.error(`${path}: base ${src}.test.ts의 ${i + 1}~${j + 1}번째 테스트 ${want.length}개와 차례·글이 같아야 한다(지금 ${got.length}개)`); bad = 1; } next = j + 1; } if (!bad && next !== bb.length) { console.error(`${src}.test.ts: 표의 묶음이 base의 테스트 ${bb.length}개 가운데 ${next}개만 덮는다`); bad = 1; } } if (!bad) console.log("네 파일의 테스트가 표의 묶음대로 차례와 글 그대로 나뉘었다"); process.exit(bad);'
grep -qF '`scripts/test/selftest.test.ts`가 `check`에서 이 리포를, `scripts/test/selftest-cases.test.ts`가 약화된 사본과 실행기를 시험한다.' docs/harness/architecture.md
! grep -qF '`scripts/test/selftest.test.ts`가 `check`에서 이 리포와 약화된 사본을 시험한다.' docs/harness/architecture.md
test -f docs/harness/changes/20261123-windows-test-speed-s0.md
```

## 금지사항

- 테스트 블록을 한 글자도 고치지 마라(제목, 본문, 들여쓰기, 줄바꿈 포함). 이유: 테스트가 그대로인지는 블록 비교(AC 둘째 줄)로만 확인한다. 블록 안을 고쳐야 옮겨진다면 멈추고 알려라.
- 테스트를 지우거나 합치거나 `.skip`·`.only`·`todo`·`skip:` 옵션을 붙이지 마라. 시간 제한(`timeout`)이나 `pollSec`·`maxIterations` 같은 준비 값을 줄이지 마라. 이유: 검사 약화(R4). 이 step은 옮기기만 한다.
- 옮기는 도우미의 이름·인자·기본값·동작을 바꾸지 마라. 이유: 블록이 같아도 도우미가 바뀌면 테스트가 확인하는 것이 바뀐다.
- 표의 10개 밖의 테스트 파일, `scripts/test/helpers.ts`, `scripts/test/` 밖의 코드를 고치지 마라. 이유: 동작 코드는 step1이 고친다. 이 step의 PR은 테스트 이동만 담아야 검토가 쉽다.
- `harness.config.json`(`commands`, `testEffect.support`)과 `profiles/core/profile.json`을 고치지 마라. 이유: 의사결정 로그 1, 4, 6. `commands`를 바꾸면 위험도 높음이다.
- 설계서(`docs/harness/design.md`)와 CHANGELOG를 직접 고치지 마라. 이유: 기록은 변경 조각에 적는다(수용 기준 9). 설계서는 고칠 곳이 없다.
- 표의 묶음을 바꾸지 마라(파일 이름, 처음·끝 테스트). 이유: 계획 검증을 받은 나누기다. 바꿔야 하면 계획 수정으로 한다.
