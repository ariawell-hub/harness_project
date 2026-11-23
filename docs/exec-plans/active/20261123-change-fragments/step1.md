# Step 1: collect

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`commands/*`·`lib/*` 줄)
- step0이 만든·바꾼 파일: `scripts/lib/changes.ts`(`CHANGES_DIR`, `isFragmentPath`, `parseFragment`), `scripts/lib/design-version.ts`(`DESIGN_DOC`, `readDesignVersion`, `designVersionProblems`), `docs/harness/workflow.md` 5절의 "변경 조각"
- `scripts/harness.ts`의 `HELP`와 `doc-lint`·`codeowners` 명령 분기(명령 하나를 더하는 꼴)
- `scripts/lib/util.ts`의 `today`, `scripts/lib/git.ts`의 `gitTry`
- `docs/harness/CHANGELOG.md`의 머리와 `## 다음 버전 (미배포)` 절, `docs/harness/design.md`의 머리말 줄과 `- **변경 이력**` 목록
- `docs/exec-plans/tech-debt-tracker.md`의 TD-39 행과 표 형식(상태 열 `열림`, `해결(#N: …)`)
- `scripts/test/changes.test.ts`의 임시 리포 도우미(`docLint`용), `scripts/test/helpers.ts`
- 이 계획의 "의사결정 로그" 4, 6, 9, 14와 "진행 로그" 2026-11-23 12:23

## 작업

### 1. `scripts/lib/changes.ts`에 모으기 계산(순수 함수)

```ts
export interface CollectInput {
  /** `docs/harness/design.md`의 글 */
  design: string;
  /** `docs/harness/CHANGELOG.md`의 글 */
  changelog: string;
  /** 조각 폴더의 파일(리포 루트 기준 경로와 글). 차례는 함수가 정한다 */
  fragments: { rel: string; text: string }[];
  /** 모으는 날 `YYYY-MM-DD` */
  date: string;
}

export type CollectResult =
  | { ok: true; design: string; changelog: string; versions: string[]; items: number }
  | { ok: false; problems: string[] };

export function collectFragments(i: CollectInput): CollectResult;
```

규칙:

- 설계서는 `scripts/lib/design-version.ts`의 `readDesignVersion`·`designVersionProblems`로 읽는다. `scripts/gates/`를 가져오지 않는다.
- 조각을 `rel`의 글자 차례(코드 단위 비교)로 정렬한다. 하나라도 `parseFragment`가 실패하면 문제를 `<경로>: <문제>`로 모두 모아 `ok: false`다.
- 설계서:
  - 먼저 `designVersionProblems`가 문제를 내면 `ok: false`다(문제의 `what`을 그대로 쓴다).
  - 변경 이력의 마지막 항목 버전이 `<정수>.<정수>.<정수>`가 아니면 `ok: false`다(예: `v0.8`).
  - 조각의 `design` 항목마다 차례로 패치 번호를 하나씩 올린 버전으로 `  - v<버전> (<date>): <글>` 한 줄을 만든다. 이 줄들을 변경 이력 목록의 끝(`readDesignVersion`의 `end`)에 넣는다.
  - 넣은 줄이 있으면 머리말 줄의 버전과 최종 갱신을 마지막에 넣은 항목의 것으로 바꾼다. 머리말의 다른 글자는 그대로 둔다. 넣은 줄이 없으면 설계서 글은 입력 그대로다.
- CHANGELOG:
  - `## 다음 버전 (미배포)` 줄이 정확히 하나여야 한다. 아니면 `ok: false`다.
  - 그 절(다음 `## ` 제목이나 파일 끝까지)의 마지막 비지 않은 줄 바로 뒤에 조각의 `changelog` 항목을 `- <글>`로 차례대로 넣는다. 절 끝의 빈 줄과 그 뒤의 절은 그대로 둔다.
- 결과 설계서에 `designVersionProblems`가 문제를 내지 않는다.
- 조각이 없으면 `ok: true`이고 두 글은 입력 그대로, `versions`는 `[]`, `items`는 0이다.
- `versions`는 넣은 설계서 버전(`v0.7.82` 꼴)의 목록, `items`는 옮긴 CHANGELOG 항목 수다.

### 2. 새 파일 `scripts/commands/changes.ts`

```ts
/** 테스트용: 쓰기·지우기. 기본은 `node:fs`의 `writeFileSync`, `unlinkSync` */
export interface CollectFs {
  writeFile: (file: string, text: string) => void;
  unlink: (file: string) => void;
}

/** `changes-collect`: 변경 조각을 CHANGELOG·설계서 변경 이력으로 옮기고 조각 파일을 지운다. 종료 코드를 돌려준다 */
export function runChangesCollect(
  root: string,
  o?: { date?: string; fs?: Partial<CollectFs> },
): number;
```

`root`는 리포 루트다. 차례:

1. `<root>/docs/harness/changes/`가 없거나 비었으면 `changes-collect: 모을 조각 없음`을 출력하고 0이다. 파일을 쓰지 않는다.
2. 경계 확인(`lstatSync`. 링크를 따라가지 않는다): `docs`, `docs/harness`, `docs/harness/changes`가 심볼릭 링크가 아닌 실제 폴더이고, 조각 폴더 안의 항목과 설계서·CHANGELOG가 심볼릭 링크가 아닌 일반 파일이다. 아니면 문제다. 조각 폴더 안의 항목은 `isFragmentPath`여야 한다(하위 폴더나 다른 이름은 문제다).
3. 상태 확인: `git status --porcelain --untracked-files=all -- docs/harness/design.md docs/harness/CHANGELOG.md docs/harness/changes`의 출력이 비어야 한다(커밋하지 않은 변경이 없다). 비지 않았거나 명령이 실패하면 문제다. 문제 글에 되돌리는 명령 `git restore --source=HEAD --staged --worktree -- docs/harness/design.md docs/harness/CHANGELOG.md docs/harness/changes`와 "앞선 모으기가 중간에 실패했으면 되돌린 뒤 다시 실행하라"를 넣는다.
4. 설계서와 CHANGELOG, 조각을 읽어 `collectFragments`에 넘긴다(`date`의 기본값은 `today()`). 읽지 못한 파일은 문제다.
5. 2~4에서 문제가 하나라도 있으면 문제를 줄마다 출력하고 1이다. 아무 파일도 쓰거나 지우지 않는다.
6. 바뀐 기록 파일을 쓰고(설계서, CHANGELOG 차례), 조각 파일을 하나씩 지운다. 폴더는 재귀로 지우지 않는다. 출력은 `changes-collect: 조각 <N>개, CHANGELOG 항목 <M>개, 설계서 <넣은 버전들 또는 그대로>`이고 0이다.
7. 6의 쓰기·지우기가 예외로 끝나면 그 자리에서 멈추고, 무엇이 실패했는지와 3의 되돌리는 명령을 출력하고 1이다. 되돌리기 전에 다시 실행하면 3에서 막힌다(항목이 두 번 옮겨지지 않는다).

git은 3의 상태 읽기만 쓴다. 스테이징·커밋(`git add`, `git rm`, `git commit`)과 되돌리기(`git restore`)는 실행하지 않는다. 커밋과 되돌리기는 모으기 PR을 여는 세션이 확인하고 한다.

### 3. `scripts/harness.ts`

- 명령 분기 하나: `changes-collect`는 `repoInfo(cwd).root`로 `runChangesCollect`를 부르고 그 종료 코드를 돌려준다. `fs`·`date`는 넘기지 않는다.
- `HELP`의 "작업:" 아래에 한 줄: `changes-collect`와 설명(변경 조각을 CHANGELOG·설계서 변경 이력으로 옮기고 지운다. 모으기 PR, 절차서 5절).
- 그 밖은 고치지 않는다(의사결정 로그 10).

### 4. 테스트(먼저 쓴다): 새 파일 `scripts/test/changes-collect.test.ts`(테스트 9건)

- `collectFragments`와 `runChangesCollect`는 동적으로 가져온다(`.catch(() => ({}))`). 결과는 값으로 받아 단언한다(함수가 없으면 고정 글). 이 변경 전의 코드에서도 단언 실패로 끝나야 한다.
- 명령 테스트(5~9)는 임시 git 리포에 파일을 두고 **커밋한 뒤** 실행한다. 5~7은 그 폴더를 `cwd`로 `node <이 리포>/scripts/harness.ts changes-collect`를 실행한다(`runSync`). 8·9는 `runChangesCollect`를 직접 부른다(`fs` 주입이 필요하다).
- 설계서 글은 머리말 줄(`> 버전 v0.7.81 · 상태: 초안 · 최종 갱신: 2026-11-23`)과 `- **변경 이력**` 목록(마지막 항목 v0.7.81)을 가진 짧은 글이다. CHANGELOG 글은 머리, `## 다음 버전 (미배포)`와 항목 하나, 빈 줄, `## 0.1.0 — …` 절이다.

1. 모으기: 조각 둘을 `20261124-b-s0.md`(CHANGELOG 하나, 설계서 둘), `20261124-a.md`(CHANGELOG 둘) 차례로 넘긴다(`date` `2026-11-24`). 결과 설계서의 변경 이력 끝 두 줄이 `  - v0.7.82 (2026-11-24): <b의 첫째>`, `  - v0.7.83 (2026-11-24): <b의 둘째>`이고 머리말이 `> 버전 v0.7.83 · 상태: 초안 · 최종 갱신: 2026-11-24`다. CHANGELOG의 "다음 버전" 절 끝에 a의 둘, b의 하나가 이 차례로 들어가고 `## 0.1.0` 절은 그대로다. `versions`는 `['v0.7.82', 'v0.7.83']`, `items`는 3이다. 결과 설계서에 `designVersionProblems`가 빈 배열이다.
2. 설계서 항목이 없는 조각만 있으면 설계서 글이 입력과 같다. 조각이 없으면 두 글이 입력과 같고 `versions`는 `[]`, `items`는 0이다.
3. 변경 이력 목록의 마지막 항목에 더 깊이 들여쓴 줄이 딸려 있으면 새 항목은 그 줄 뒤에 들어가고, 결과 설계서에 `designVersionProblems`가 빈 배열이다.
4. 문제(각각 `ok: false`이고 문제 글로 이유를 본다): 형식이 틀린 조각(문제 글에 그 경로), 자리 밖 경로, 설계서 머리말과 마지막 항목의 버전이 어긋남, 마지막 버전이 세 마디가 아님(`v0.8`), CHANGELOG에 `## 다음 버전 (미배포)`가 없음.
5. 명령: 임시 리포(`docLint`가 설계서를 문서 목록에서 읽도록 설정·`AGENTS.md`·`docs/index.md`·설계서·CHANGELOG를 둔다)에 조각 둘을 두고 실행한다. 종료 코드 0, 출력에 `changes-collect: 조각 2개`, 조각 파일이 없다. 설계서와 CHANGELOG가 1번과 같은 꼴이다(날짜는 실행한 날의 `today()`). 이어서 `docLint`의 오류가 없다. 한 번 더 실행하면 종료 코드 0, 출력에 `모을 조각 없음`이고 설계서·CHANGELOG가 바이트 단위로 그대로다.
6. 명령: 조각 폴더가 없을 때와 빈 폴더일 때 각각 종료 코드 0, 출력에 `모을 조각 없음`, 설계서·CHANGELOG가 바이트 단위로 그대로다.
7. 명령: (a) 조각 둘 가운데 하나의 형식이 틀렸을 때, (b) 형식에 맞는 조각 옆에 `notes.txt`가 있을 때, (c) 형식에 맞는 조각이 있고 CHANGELOG에 커밋하지 않은 변경이 있을 때 각각 종료 코드 1이고 출력에 문제가 있다((c)는 되돌리는 명령 `git restore --source=HEAD`가 있다). 설계서·CHANGELOG·폴더 안의 모든 파일이 실행 전과 바이트 단위로 같다.
8. 경계(심볼릭 링크를 만들 수 없는 환경이면 건너뛴다): 리포 밖 폴더에 형식에 맞는 조각을 두고 (a) `docs/harness/changes`를 그 폴더로 가는 심볼릭 링크로 만들었을 때, (b) 실제 조각 폴더 안에 리포 밖 조각 파일로 가는 심볼릭 링크를 두었을 때, (c) CHANGELOG가 리포 밖 파일로 가는 심볼릭 링크일 때 각각 `runChangesCollect`가 1이다. 리포 밖 파일과 설계서·CHANGELOG(링크 대상 포함)가 실행 전과 바이트 단위로 같다.
9. 중간 실패 뒤 재실행: 조각 둘을 두고 `fs.unlink`가 둘째 조각에서 예외를 던지게 해 실행하면 1이고, 출력에 실패한 파일과 `git restore --source=HEAD`가 있다. 그 상태로 다시 실행하면(주입 없이) 1이고 설계서·CHANGELOG가 첫 실행 직후와 바이트 단위로 같다(항목이 두 번 들어가지 않는다). 테스트가 출력의 되돌리는 명령으로 되돌린 뒤 다시 실행하면 0이고, CHANGELOG에 각 항목이 한 번씩, 설계서에 새 버전이 v0.7.82부터 한 번씩 들어간다.

먼저 테스트만 커밋하고, 이 변경 전의 코드에서 새 테스트가 실패하는 것을 진행 로그에 적는다.

### 5. 이 PR의 기록: 새 파일 `docs/harness/changes/20261123-change-fragments-s1.md`

- `## CHANGELOG`에 한 줄: `changes-collect`, `Issue #222`, `TD-39` 해결, 모으기 PR 절차(절차서 5절)를 넣는다.
- 이 step은 설계서를 고치지 않으므로 `## 설계서 변경 이력`을 두지 않는다.
- `docs/harness/CHANGELOG.md`와 `docs/harness/design.md`는 고치지 않는다. 이 PR은 조각만으로 `harness-guard`를 통과해야 한다(수용 기준 10).

### 6. 문서와 기술 부채 표

- `docs/harness/workflow.md` 5절의 "변경 조각" 아래에 하위 항목 "모으기 PR"을 둔다. 적을 것:
  - 언제: 제작자가 지시할 때(대화나 Issue). runner·`start`·CI는 스스로 열지 않는다(의사결정 로그 9).
  - 순서: Issue → `new-task --issue <N> --slug changes-collect --size small` → worktree에서 `node scripts/harness.ts changes-collect` → 결과 확인 → `check` → 초안 PR(보호 경로라 제작자 승인) → `pr-ready`.
  - 명령이 하는 일: 이름 차례로 읽기, 설계서 변경 이력 항목마다 패치 번호 + 1과 그날 날짜, 머리말 맞추기, CHANGELOG "다음 버전 (미배포)" 끝으로 옮기기, 조각 지우기. 조각이 없으면 아무것도 바꾸지 않는다. 형식이 틀린 조각, 심볼릭 링크, 커밋하지 않은 변경이 있으면 아무것도 바꾸지 않고 실패한다. 도중에 실패하면 출력의 되돌리는 명령으로 되돌린 뒤 다시 실행한다.
  - 모으기 PR은 CHANGELOG를 고치므로 자기 조각을 두지 않는다.
  - 모으기 PR이 main과 충돌하면(그 사이 옛 방식 PR이 CHANGELOG·설계서 변경 이력을 고쳤다) main 쪽을 먼저 두고 모은 항목의 버전을 다음 번호로 올린다. 그 사이 main에 더해진 조각은 다음 모으기가 옮긴다.
- `docs/harness/architecture.md`: 명령 목록과 표에 `commands/changes.ts`(`changes-collect`)를, `lib/changes.ts` 줄에 모으기 계산(`collectFragments`)을 더한다.
- `docs/exec-plans/tech-debt-tracker.md`:
  - TD-39를 `해결(#222: …)`로 닫는다. 조각 파일과 모으기 PR로 고쳤다는 것, 같은 종류로 남은 일은 새 행 A라는 것을 적는다.
  - 새 행 A(`열림`): 기술 부채 표의 새 행 번호가 같은 자리에서 충돌한다(TD-39와 같은 종류). 번호는 같은 PR 안에서 코드 주석(`harness-quarantine: TD-N`)·계획·문서가 바로 가리켜야 해서 모으기로 미룰 수 없다(의사결정 로그 6). 지금은 main 병합 때 다음 번호로 옮긴다. 고칠 방법 후보를 하나 적는다.
  - 새 행 B(`열림`): 다른 머신에서 만든 worktree의 계획을 이어 가는 절차가 없다. `start`·`next`는 로컬 worktree의 계획만 보고(`scripts/runner/next.ts`의 `readLocalPlans`), `new-task`는 선점(`claim/<N>`)이 이미 있는 Issue의 원격 브랜치를 이어받지 못한다. 이 계획은 `git worktree add --track -b`와 `setup`으로 손으로 이었다(진행 로그 2026-11-23 12:23).
  - 새 행의 번호는 push 직전의 `origin/main` 기준 다음 번호다.
- 이 계획의 "발견 사항"에 새 행 A와 B를 각각 한 항목으로 적고 끝에 `→ 처리: TD-<번호>`를 단다.

## Acceptance Criteria

```bash
node --test scripts/test/changes-collect.test.ts scripts/test/changes.test.ts scripts/test/harness-guard.test.ts scripts/test/doc-lint-design-version.test.ts
git rev-parse --verify --quiet origin/main^{commit}
test "$(git diff --name-only origin/main...HEAD -- scripts .github harness.config.json | sort | tr '\n' ' ')" = "scripts/commands/changes.ts scripts/harness.ts scripts/lib/changes.ts scripts/test/changes-collect.test.ts "
git diff --quiet origin/main...HEAD -- docs/harness/CHANGELOG.md docs/harness/design.md
test "$(grep -c '^test(' scripts/test/changes-collect.test.ts)" = 9
grep -qE '^export function collectFragments\(' scripts/lib/changes.ts
grep -qE '^export function runChangesCollect\(' scripts/commands/changes.ts
test -z "$(grep -lE "from '\.\./gates/" scripts/lib/changes.ts scripts/commands/changes.ts)"
grep -qF "'changes-collect'" scripts/harness.ts
grep -F 'changes-collect' docs/harness/changes/20261123-change-fragments-s1.md | grep -F 'Issue #222' | grep -qF 'TD-39'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF 'node scripts/harness.ts changes-collect'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF -- '--slug changes-collect --size small'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF 'git restore --source=HEAD'
grep -qF 'commands/changes.ts' docs/harness/architecture.md
grep -qE '^\| TD-39 .*\| 해결\(#222' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-[0-9]+ +\| .*harness-quarantine.*\| 열림 *\|$' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-[0-9]+ +\| .*readLocalPlans.*\| 열림 *\|$' docs/exec-plans/tech-debt-tracker.md
test "$(grep -c '→ 처리: TD-' docs/exec-plans/*/20261123-change-fragments/plan.md)" = 2
node scripts/harness.ts doc-lint
(d="$(mktemp -d)" && git clone -q . "$d/r" && cd "$d/r" && node scripts/harness.ts changes-collect && test ! -e docs/harness/changes/20261123-change-fragments-s1.md && grep -qF 'changes-collect' docs/harness/CHANGELOG.md && node scripts/harness.ts doc-lint)
```

마지막 줄은 커밋한 HEAD를 클론해 실제 설계서·CHANGELOG로 모으기를 돌려 본다. 커밋한 뒤에 실행한다.

## 금지사항

- `docs/harness/CHANGELOG.md`와 `docs/harness/design.md`를 이 PR에서 고치지 마라. 이유: 이 PR은 자기 조각만으로 `harness-guard`를 통과해야 한다(수용 기준 10).
- 이 PR에서 모으기를 실행하지 마라(조각 파일을 지우거나 CHANGELOG로 옮기지 마라). 이유: 모으기 PR은 제작자 지시로 따로 연다(의사결정 로그 9).
- 모으기 명령이 상태 읽기 밖의 git 명령(스테이징, 커밋, `git rm`, `git restore`)을 실행하거나 폴더를 재귀로 지우게 하지 마라. 이유: R14. 모으기 결과와 되돌리기는 PR을 여는 세션이 확인하고 한다.
- 모으기 명령이 심볼릭 링크를 따라가 읽거나 쓰거나 지우게 하지 마라. 이유: 작업 트리 밖 파일을 옮기고 지울 수 있다(의사결정 로그 14).
- 형식이 틀린 조각을 건너뛰고 나머지만 모으게 하지 마라. 문제가 있을 때 파일 일부만 쓰게 하지 마라. 커밋하지 않은 변경이 있을 때 모으게 하지 마라. 이유: 건너뛴 기록이 조용히 남거나 사라지고, 일부만 쓰거나 다시 모으면 설계서 버전과 CHANGELOG가 어긋나거나 두 번 들어간다.
- 모으기를 runner·`start`·CI에서 돌리거나 알리게 하지 마라. 이유: 의사결정 로그 9.
- `scripts/gates/`, `scripts/ci/`, `scripts/runner/`, `scripts/lib/design-version.ts`, `harness.config.json`, step0의 테스트 파일을 고치지 마라. 이유: 판정과 설계서 읽기는 step0에서 끝났고 나머지는 범위 밖이다. AC가 `scripts` 아래에서 바뀐 파일이 넷뿐인지 본다.
- `scripts/lib/`의 파일이 `scripts/gates/`를 가져오게 하지 마라. 이유: 의사결정 로그 13.
- 새 TD 행(A, B)의 일을 이 step에서 고치지 마라. 이유: 범위 밖이다(의사결정 로그 6).
