# Step 0: fragments

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*`·`lib/*`·`ci/*` 줄)
- `scripts/gates/harness-guard.ts`: `harnessGuard`의 인자, "실패: 작성자가 고칠 것", 결과 설명(`failures[0]`의 첫 줄)을 만드는 곳
- `scripts/ci/gates.ts`: `runGates`가 `harnessGuard`를 부르는 곳과 `o.branch`
- `scripts/gates/doc-lint.ts`: `NO_FRONTMATTER`, `docLint`의 검사 차례, 문서 목록(`listMarkdown`), 설계서 버전 검사(`DESIGN_DOC`, `DESIGN_HEAD`, `DESIGN_ITEM`, `compareVersions`, `designVersionProblems`)
- `scripts/test/doc-lint-design-version.test.ts`(옮긴 뒤에도 고치지 않고 통과해야 한다. 읽기만)
- `scripts/test/harness-guard.test.ts`의 `repo`·`run` 도우미와 `runGates` 테스트, `scripts/test/helpers.ts`
- `scripts/test/metrics-allow.ts`의 `GIT_READ_SHAPES`, `scripts/test/metrics-command.test.ts`의 자식 프로세스 테스트("허용 목록의 git 넷뿐이다"), `scripts/metrics/local.ts`의 `docLint` 호출(읽기만)
- `docs/harness/workflow.md` 5절, `docs/harness/design.md`의 7.2절 트리·R9 행·`harness-guard` 행·10.4절의 `harness-guard` 설명 줄, `docs/harness/CHANGELOG.md`의 머리, `.github/pull_request_template.md`, `README.md`의 하네스 변경 이력 문장
- 이 계획의 "목표와 수용 기준"과 "의사결정 로그"
- 초안(참고만): `git show 5059e42:docs/exec-plans/active/20261123-change-fragments/draft-step0.patch`. 초안은 계획마다 파일 하나(`<계획 id>.md`)로 문구를 썼고 브랜치를 보지 않는다. 이 step의 규칙(아래)으로 고쳐 쓴다.

## 작업

### 1. 새 파일 `scripts/lib/changes.ts`

```ts
/** 변경 조각을 두는 폴더(리포 루트 기준, `/` 구분) */
export const CHANGES_DIR = 'docs/harness/changes';

export interface Fragment {
  /** 파일 이름에서 `.md`를 뺀 것(PR 브랜치 이름의 `/` 뒤) */
  name: string;
  /** CHANGELOG로 옮길 항목(앞의 `- `를 빼고 앞뒤 공백을 지운 글). 하나 이상 */
  changelog: string[];
  /** 설계서 변경 이력으로 옮길 항목(같은 꼴). 없어도 된다 */
  design: string[];
}

export type FragmentParse = { ok: true; value: Fragment } | { ok: false; problems: string[] };

/** 리포 루트 기준 경로가 조각 파일 자리인가 */
export function isFragmentPath(rel: string): boolean;

/** PR 브랜치의 조각 경로: `CHANGES_DIR/<브랜치 이름의 마지막 / 뒤>.md`. 그 이름이 조각 자리가 아니면 null */
export function fragmentPathFor(branch: string): string | null;

/** 조각 파일을 읽는다. 문제를 모두 모아 돌려준다 */
export function parseFragment(rel: string, text: string): FragmentParse;
```

규칙:

- 자리: `CHANGES_DIR` 바로 아래이고 이름이 `^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$`이다(계획 id 꼴. step 브랜치면 끝에 `-s<N>`이 붙는다). 하위 폴더, 다른 확장자, 대문자, 다른 폴더는 자리 밖이다.
- 자리 밖이면 다른 검사 없이 문제 하나다: `조각 파일의 자리·이름이 틀리다(docs/harness/changes/<브랜치 이름의 / 뒤>.md): <경로>`.
- 줄 끝의 CRLF는 LF로 읽는다. 파일 끝의 줄바꿈 하나는 무시한다.
- 첫 줄은 `# 변경 조각: <이름>`이다(`<이름>`은 파일 이름에서 `.md`를 뺀 것).
- 그 뒤에는 빈 줄, `## CHANGELOG`, `## 설계서 변경 이력`, 섹션 안의 `- <글>` 한 줄 항목만 둔다.
  - 섹션은 `CHANGELOG`, `설계서 변경 이력` 차례로 한 번씩 둔다. `## 설계서 변경 이력`은 없어도 된다.
  - 그 밖의 `## ` 제목, 섹션 밖의 글, 항목에 이어지는 줄은 문제다.
- 항목 글(앞의 `- `를 빼고 앞뒤 공백을 지운 글):
  - 비지 않는다.
  - 버전(`v<숫자>(.<숫자>)+`)으로 시작하지 않는다. 버전과 날짜는 모으기가 붙인다.
  - Markdown 링크(`](`)를 넣지 않는다. 모으면 파일 자리가 바뀌어 상대 경로가 깨진다.
- `## CHANGELOG` 항목이 하나 이상이다.
- 문제마다 줄 번호를 붙인다(`<N>번째 줄: …`. 파일 전체에 걸린 문제는 줄 번호 없이). 문제가 하나라도 있으면 `ok: false`다.

### 2. 새 파일 `scripts/lib/design-version.ts`(옮기기)

`scripts/gates/doc-lint.ts`의 설계서 버전 검사(`DESIGN_DOC`, `DESIGN_HEAD`, `DESIGN_ITEM`, `compareVersions`, `designVersionProblems`)를 이 파일로 옮긴다. 규칙과 문제 글(`rule`, `what`, `how`, `doc`)은 바꾸지 않는다. 읽기 결과를 내보내는 함수 하나를 더한다(`designVersionProblems`도 이 함수로 읽는다).

```ts
/** 설계서의 경로 */
export const DESIGN_DOC = 'docs/harness/design.md';

export interface DesignVersion {
  /** 머리말 줄: 0부터 센 줄 번호, 버전(`v`를 뺀 글), 최종 갱신 날짜 */
  head: { line: number; version: string; date: string };
  /** 변경 이력 항목(하나 이상): 0부터 센 줄 번호, 버전, 날짜 */
  items: { line: number; version: string; date: string }[];
  /** 변경 이력 목록의 마지막 줄(마지막 항목에 딸린 더 깊이 들여쓴 줄 포함) 다음 줄의 번호(0부터) */
  end: number;
}

/** 머리말과 변경 이력을 읽는다. 읽지 못하면 지금의 "읽지 못함" 문제들 */
export function readDesignVersion(
  text: string,
): { ok: true; value: DesignVersion } | { ok: false; problems: Problem[] };

/** 지금의 `R8 설계서 버전` 검사 그대로 */
export function designVersionProblems(text: string): Problem[];

/** 버전(`v`를 뺀 글) 비교: 음수·0·양수. 옮기기만 하고 내보낸다(4의 설계서 기록이 쓴다) */
export function compareVersions(a: string, b: string): number;
```

- `scripts/gates/doc-lint.ts`는 이 파일을 가져다 쓰고 `designVersionProblems`를 다시 내보낸다(`scripts/test/doc-lint-design-version.test.ts`의 가져오기가 그대로 동작한다).
- `scripts/lib/`의 파일은 `scripts/gates/`를 가져오지 않는다.

### 3. `scripts/gates/doc-lint.ts`

- `NO_FRONTMATTER`에 `${CHANGES_DIR}/**`를 더한다. 조각 파일에는 frontmatter와 색인 링크를 요구하지 않는다.
- `docLint`의 검사 끝에 하나를 더한다: 조각 폴더 아래의 파일을 문서 목록과 따로 모두 읽는다(`git ls-files -z --cached --others --exclude-standard -- docs/harness/changes`. 작업 트리에 없는 파일은 뺀다). 확장자와 하위 폴더를 가리지 않는다. 파일마다 `parseFragment`를 부르고, 문제마다 오류 하나를 낸다.
  - `rule`: `R8 변경 조각`
  - `what`: `<경로>: <문제>`
  - `how`: `조각 파일의 자리·형식을 docs/harness/workflow.md 5절 "변경 조각"대로 맞춰라`
  - 목록을 읽지 못하면 지금의 문서 목록과 같이 읽기 오류다(`DocLintReadError`).
- 설계서 버전 검사는 2의 파일을 쓴다. 다른 검사(깨진 링크 등)는 고치지 않는다.
- 지표 명령(`metrics`)이 `docLint`를 부르므로, 그 테스트의 git 허용 목록에 이 읽기를 더한다(의사결정 로그 15).
  - `scripts/test/metrics-allow.ts`의 `GIT_READ_SHAPES` 끝에 꼴 하나: 이름 `ls-files-changes`, 인자 `['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs/harness/changes']`. 머리 주석의 개수를 맞춘다.
  - `scripts/test/metrics-command.test.ts`의 자식 프로세스 테스트: 제목의 "git 넷"을 "git 다섯"으로, 호출 차례를 "`repoInfo`의 둘 → 문서 목록 → 커밋 시각 읽기들 → 마지막에 `ls-files-changes` 하나"로, 허용 목록 이름 단언을 다섯으로 바꾼다. 다른 테스트는 고치지 않는다.

### 4. `scripts/gates/harness-guard.ts`와 `scripts/ci/gates.ts`

- `harnessGuard`의 인자에 `branch?: string`(PR 브랜치 이름)을 더한다. `scripts/ci/gates.ts`의 `runGates`는 `o.branch`를 넘긴다. 다른 호출자는 고치지 않는다.
- "이 PR의 조각"은 `branch`가 있고 `fragmentPathFor(branch)`가 null이 아닐 때 그 경로다. `branch`가 없으면 이 PR의 조각은 없다(조각을 세지 않는다).
- "새 항목": 이 PR의 조각이 바뀐 파일에 있고 head에서 `parseFragment`가 통과할 때, 그 섹션의 항목 가운데 base의 같은 파일에 없던 글이다. base에 그 파일이 없거나 base의 파일이 형식에 맞지 않으면 base의 항목은 없는 것으로 본다.
- CHANGELOG 기록(있던 검사를 넓힌다): 바뀐 파일에 `docs/harness/CHANGELOG.md`가 있거나, 이 PR의 조각에 CHANGELOG 새 항목이 있으면 기록이 있다. 없을 때의 실패 문구:
  - 첫 줄(결과 설명이 된다): `보호 경로를 바꿨는데 docs/harness/CHANGELOG.md도 이 PR의 변경 조각(docs/harness/changes/)도 그대로다`
  - 고치는 법: `이 PR의 변경 조각(docs/harness/changes/<브랜치 이름의 / 뒤>.md)의 "## CHANGELOG" 아래에 한 줄을 더하라. 다른 브랜치 이름의 조각과 형식이 틀린 조각은 세지 않는다(doc-lint R8 변경 조각)`
- 설계서 기록(새 검사): 바뀐 파일에 `docs/harness/design.md`가 있으면, 다음 둘 가운데 하나가 있어야 한다.
  1. 옛 방식: head와 base에서 `readDesignVersion`이 모두 통과하고, base의 변경 이력 항목 버전이 head의 변경 이력에 모두 있으며, head의 마지막 항목 버전이 base의 마지막 항목 버전보다 크다(`compareVersions`). 마지막 항목을 지우거나 글만 고친 것은 기록이 아니다(Codex F8).
  2. 이 PR의 조각에 설계서 변경 이력 새 항목이 있다.
  - 없을 때의 실패 문구 첫 줄: `설계서(docs/harness/design.md)를 바꿨는데 변경 이력에도 이 PR의 변경 조각에도 설계서 기록이 없다`. 고치는 법: `이 PR의 변경 조각에 "## 설계서 변경 이력" 한 줄을 더하라(모으기 PR이 버전을 매긴다)`.
- 두 검사 모두 `skipAuthorChecks`면 하지 않는다. 체크리스트 줄, 워크플로 검사, 위험도 신호는 고치지 않는다.

### 5. 테스트(먼저 쓴다)

새 파일 `scripts/test/changes.test.ts`(테스트 5건):

- `scripts/lib/changes.ts`는 동적으로 가져온다(`await import('../lib/changes.ts').catch(() => ({}))`). 이 변경 전의 코드에는 이 모듈이 없어서, 정적으로 가져오면 파일 전체가 단언 전에 죽는다.
- 읽기 결과는 값으로 받아 단언한다: 통과면 `value`, 아니면 `problems`, 함수가 없으면 고정 글. 그래야 이 변경 전의 코드에서도 단언 실패로 끝난다.

1. 자리: `docs/harness/changes/20261123-demo-s0.md`, `docs/harness/changes/20261123-a.md`, `docs/harness/changes/20261123-a-b-2.md`는 자리다. `docs/harness/changes/README.md`, `docs/harness/changes/2026-11-23-a.md`, `docs/harness/changes/20261123-A.md`, `docs/harness/changes/20261123-a.txt`, `docs/harness/changes/sub/20261123-a.md`, `docs/harness/20261123-a.md`, `x/docs/harness/changes/20261123-a.md`는 자리 밖이다. `CHANGES_DIR`는 `docs/harness/changes`다. `fragmentPathFor`: `feat/20261123-demo-s0` → `docs/harness/changes/20261123-demo-s0.md`, `fix/20261123-a` → `docs/harness/changes/20261123-a.md`, `revert/0123abc`와 `main`과 빈 글 → null.
2. 읽기: CHANGELOG 둘과 설계서 하나인 조각은 `{ name, changelog: [둘], design: [하나] }`이다. 설계서 섹션이 없으면 `design`은 `[]`다. CRLF로 바꾼 글도 결과가 같다.
3. 형식 문제(각각 `ok: false`이고 문제 글로 이유를 본다): 자리 밖 이름, 첫 줄의 이름이 파일 이름과 다름, CHANGELOG 섹션이 없음, CHANGELOG 항목이 없음, 받지 않는 섹션, 섹션 차례가 거꾸로임, 같은 섹션이 두 번, 항목에 이어지는 줄, 첫 섹션 앞의 글, 빈 항목, 버전으로 시작하는 항목(`- v0.7.81 (2026-11-23): …`), 링크가 있는 항목(`- [설계서](design.md)를 고쳤다`).
4. `doc-lint`(`docLint`, 설정·`AGENTS.md`·`docs/index.md`만 둔 임시 리포): 형식에 맞는 조각 하나만 더하면 오류가 없다(frontmatter·색인 요구 없음). CHANGELOG 항목이 없는 조각이면 오류가 `R8 변경 조각 <경로>: <문제>` 하나다. 같은 폴더의 `notes.md`, `notes.txt`, `sub/20261123-a.md`는 각각 `R8 변경 조각`의 자리·이름 오류다.
5. 두 브랜치가 같은 main에서 각자 조각 파일(`20261123-a-s0.md`, `20261123-b.md`)만 더하면 차례로 병합해도 충돌하지 않고(`git merge`의 종료 코드 0), 병합 결과의 두 파일이 모두 형식대로 읽힌다.

`scripts/test/harness-guard.test.ts`에 테스트 4건을 더한다. 있던 테스트와 도우미는 고치지 않는다. 필요한 도우미는 이 파일에 새로 만든다. 브랜치는 `repo`가 만드는 `feat/20261114-demo-s0`이고 이 PR의 조각은 `docs/harness/changes/20261114-demo-s0.md`다.

6. 보호 경로(`scripts/x.ts`)를 바꾸고 CHANGELOG는 그대로 둔 채 이 PR의 조각(형식에 맞음)만 더하면, `branch`를 준 `harnessGuard`가 `success`이고 신호가 없다. 같은 변경을 `runGates`(`branch` 포함)로 판정해도 `harness-guard`가 `success`다.
7. 기록으로 세지 않는 경우는 각각 `failure`이고 설명에 `CHANGELOG`와 `변경 조각`이 있다(CHANGELOG는 그대로): (a) CHANGELOG 항목이 없는 조각, (b) 형식이 틀린 조각(버전으로 시작하는 항목), (c) 자리 밖 파일 `docs/harness/changes/notes.md`·`docs/harness/changes/sub/20261114-demo-s0.md`(글은 형식에 맞다), (d) 다른 브랜치 이름의 조각 `docs/harness/changes/20261114-other-s0.md`(형식에 맞음), (e) 이 PR의 조각이지만 `branch`를 주지 않음.
8. base에 이 PR의 조각이 있을 때(보호 경로도 함께 바꾼다): 그 조각에 설계서 항목만 더하면 `failure`, 그 조각을 지우기만 하면 `failure`, 새 CHANGELOG 항목을 더하면 `success`다.
9. 설계서 기록(CHANGELOG는 이 PR의 조각에 있다): base에 머리말과 변경 이력이 맞는 짧은 설계서를 둔다. (a) 설계서 본문만 바꾸면 `failure`이고 설명에 `설계서`가 있다. (b) 본문을 바꾸고 변경 이력에 새 항목을 더하고 머리말을 맞추면(옛 방식) `success`. (c) 본문을 바꾸고 이 PR의 조각에 설계서 변경 이력 항목을 더하면 `success`. (d) 본문을 바꾸고 다른 브랜치 이름의 조각에만 설계서 항목이 있으면 `failure`. (e) 본문을 바꾸고 변경 이력의 마지막 항목을 지운 뒤 머리말을 그 앞 항목에 맞추면 `failure`이고 설명에 `설계서`가 있다. (f) 본문을 바꾸고 마지막 항목의 글만 고치면(버전은 그대로) `failure`.

먼저 테스트만 커밋하고, 이 변경 전의 코드에서 새 테스트가 실패하는 것을 진행 로그에 적는다.

### 6. 문서와 템플릿

- `docs/harness/workflow.md` 5절:
  - "보호 경로를 바꾼 PR" 항목: CHANGELOG에 한 줄 대신 변경 조각에 적는다고 바꾼다. PR 본문의 체크 줄, 워크플로 캐시 등 나머지 글은 그대로다.
  - 그 아래에 하위 항목 "변경 조각"을 둔다. 적을 것:
    - 자리와 이름 `docs/harness/changes/<계획 id>-s<N>.md`(소규모 계획은 `docs/harness/changes/<계획 id>.md`). PR 브랜치 이름의 `/` 뒤와 같다. PR마다 새 파일이라 다른 PR과 충돌하지 않는다. `harness-guard`는 이 이름의 조각만 기록으로 센다. 다른 PR의 조각은 고치지 않는다.
    - 형식 예시(코드 블록): `# 변경 조각: <이름>`, `## CHANGELOG`와 항목, `## 설계서 변경 이력`과 항목.
    - CHANGELOG, 설계서 머리말의 버전·최종 갱신, 변경 이력을 직접 고치지 않는다. 설계서를 고쳤으면 `## 설계서 변경 이력`에 한 줄을 적는다. 없으면 `harness-guard`가 막는다.
    - 항목은 한 줄이고 버전·Markdown 링크를 넣지 않는다.
    - 형식은 `doc-lint`가 `R8 변경 조각`으로 본다. 형식이 틀린 조각은 `harness-guard`가 기록으로 세지 않는다.
    - 버전과 날짜를 붙여 CHANGELOG·설계서로 옮기고 조각을 지우는 일은 모으기 PR이 한다.
    - CHANGELOG를 직접 고친 PR도 통과한다(모으기 PR, 이 규칙 전에 쓴 계획).
  - "설계서(`docs/harness/design.md`)를 고친 PR은 병합 뒤에 머리말의 버전·최종 갱신을 …" 항목: 설계서를 고친 PR은 머리말과 변경 이력을 고치지 않고 변경 조각의 `## 설계서 변경 이력`에 적는다고 바꾼다. 머리말과 변경 이력은 모으기 PR이 고친다. 머리말과 마지막 항목이 어긋나면 `doc-lint`가 `R8 설계서 버전`으로 막는다. 직접 고친 옛 방식 PR이 main과 번호가 겹치면 지금처럼 이 PR의 항목을 다음 번호로 올린다.
- `docs/harness/design.md`:
  - 7.2절 트리의 `harness/` 아래에 `changes/` 줄을 더한다. 설명에 `변경 조각`을 넣는다(PR마다 파일 하나, 모으기 PR이 CHANGELOG·변경 이력으로 옮기고 지운다).
  - R9 행, `harness-guard` 행, 10.4절의 `harness-guard` 설명 줄("체크리스트, `CHANGELOG`, …"): `CHANGELOG`를 변경 기록(`CHANGELOG` 또는 그 PR의 변경 조각)으로 바꾼다. 세 줄 모두에 `변경 조각`이 들어간다. `harness-guard` 행에는 설계서를 바꾼 PR의 설계서 기록 요구를 더한다.
  - 머리말의 버전·최종 갱신과 변경 이력 한 줄(옛 방식. 의사결정 로그 3): `Issue #222`, `TD-39`, `변경 조각`, `R8 변경 조각`을 넣는다. TD-39는 step1에서 닫으므로 "해결"로 적지 않는다.
- `docs/harness/CHANGELOG.md`:
  - 머리 문장("보호 경로(10.4절)를 바꾸는 PR은 여기에 한 줄을 남긴다."): 보호 경로를 바꾸는 PR은 변경 조각(`docs/harness/changes/`)에 적고 모으기 PR이 "다음 버전" 아래로 옮긴다고 바꾼다(절차서 5절).
  - 이 step의 항목 한 줄(옛 방식): `Issue #222`, `docs/harness/changes/`, `R8 변경 조각`을 넣는다.
- `.github/pull_request_template.md`: `- [ ] 보호 경로 변경:` 줄의 "CHANGELOG 갱신"을 변경 조각(`docs/harness/changes/`)에 기록으로 바꾼다. 줄 앞머리 `- [ ] 보호 경로 변경:`은 그대로 둔다(`harness-guard`가 이 앞머리를 본다).
- `README.md`: `하네스 파일은 보호 경로이므로 [변경 이력](docs/harness/CHANGELOG.md)에 한 줄을 남긴다` 문장을 변경 조각(`docs/harness/changes/`)에 한 줄을 남긴다로 바꾼다.
- `docs/harness/architecture.md`: 라이브러리 목록과 표에 `lib/changes.ts`(변경 조각의 자리·형식. `doc-lint`·`harness-guard`가 쓴다)와 `lib/design-version.ts`(설계서 머리말·변경 이력 읽기)를 더한다.

## Acceptance Criteria

```bash
node --test scripts/test/changes.test.ts scripts/test/harness-guard.test.ts scripts/test/doc-lint-design-version.test.ts scripts/test/metrics-command.test.ts
git rev-parse --verify --quiet origin/main^{commit}
test "$(git diff --name-only origin/main...HEAD -- scripts .github harness.config.json | sort | tr '\n' ' ')" = ".github/pull_request_template.md scripts/ci/gates.ts scripts/gates/doc-lint.ts scripts/gates/harness-guard.ts scripts/lib/changes.ts scripts/lib/design-version.ts scripts/test/changes.test.ts scripts/test/harness-guard.test.ts scripts/test/metrics-allow.ts scripts/test/metrics-command.test.ts "
grep -qF "'ls-files-changes'" scripts/test/metrics-allow.ts
test -z "$(git diff origin/main...HEAD -- scripts/test/harness-guard.test.ts | grep '^-[^-]')"
test "$(grep -c '^test(' scripts/test/changes.test.ts)" = 5
test "$(grep -c '^test(' scripts/test/harness-guard.test.ts)" = "$(( $(git show origin/main:scripts/test/harness-guard.test.ts | grep -c '^test(') + 4 ))"
grep -qxF "export const CHANGES_DIR = 'docs/harness/changes';" scripts/lib/changes.ts
grep -qE '^export function parseFragment\(' scripts/lib/changes.ts
grep -qE '^export function fragmentPathFor\(' scripts/lib/changes.ts
grep -qE '^export function designVersionProblems\(' scripts/lib/design-version.ts
grep -qE '^export function readDesignVersion\(' scripts/lib/design-version.ts
grep -qE '^export function compareVersions\(' scripts/lib/design-version.ts
test -z "$(grep -lE "from '\.\./gates/" scripts/lib/changes.ts scripts/lib/design-version.ts)"
test ! -e docs/harness/changes
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF 'docs/harness/changes/<계획 id>-s<N>.md'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF 'R8 변경 조각'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF '## 설계서 변경 이력'
awk '/^## 5\. PR/{f=1;next} /^## 6\./{f=0} f' docs/harness/workflow.md | grep -qF '모으기 PR'
awk '/^### 7\.2 /{f=1;next} /^### |^## /{f=0} f' docs/harness/design.md | grep -F 'changes/' | grep -qF '변경 조각'
grep -E '^\| R9 \|' docs/harness/design.md | grep -qF '변경 조각'
grep -E '^\| `harness-guard` \|' docs/harness/design.md | grep -qF '변경 조각'
awk '/^### 10\.4 /{f=1;next} /^### |^## /{f=0} f' docs/harness/design.md | grep -F '`harness-guard`를 main의 정의로 실행한다' | grep -qF '변경 조각'
grep -E '^  - v0\.7\.[0-9]+ \(2026-1[12]-[0-9]{2}\): ' docs/harness/design.md | grep -F 'Issue #222' | grep -F 'TD-39' | grep -qF 'R8 변경 조각'
sed -n '/^# /,/^## /p' docs/harness/CHANGELOG.md | grep -qF 'docs/harness/changes/'
grep -F 'Issue #222' docs/harness/CHANGELOG.md | grep -F 'docs/harness/changes/' | grep -qF 'R8 변경 조각'
grep -E '^- \[ \] 보호 경로 변경:' .github/pull_request_template.md | grep -qF 'docs/harness/changes/'
grep -qF 'docs/harness/changes/' README.md
grep -qF 'lib/changes.ts' docs/harness/architecture.md
grep -qF 'lib/design-version.ts' docs/harness/architecture.md
node scripts/harness.ts doc-lint
```

## 금지사항

- `docs/harness/changes/`에 파일을 두지 마라. 이 step의 기록도 조각으로 하지 마라. 이유: 이 PR은 main의 `harness-guard`(조각을 모르는 판)로 판정된다. CHANGELOG와 설계서 버전을 직접 고친다(의사결정 로그 3).
- CHANGELOG를 고친 PR을 통과시키는 조건을 빼지 마라. 기록이 없을 때의 실패를 경고나 통과로 바꾸지 마라. 이유: 모으기 PR과 이 규칙 전에 쓴 계획이 CHANGELOG를 직접 고친다. 실패를 낮추면 검사 약화다.
- `branch`가 없을 때 조각을 세지 마라. 다른 브랜치 이름의 조각을 세지 마라. 이유: 다른 PR의 조각에 더한 줄은 모으기 PR과 충돌한다(의사결정 로그 11). 모를 때는 세지 않는 쪽(fail-closed)이다.
- 있던 테스트와 테스트 도우미를 고치거나 지우지 마라(`scripts/test/doc-lint-design-version.test.ts` 포함). 예외는 3의 지표 명령 git 허용 목록(`scripts/test/metrics-allow.ts`)과 그 자식 프로세스 테스트 하나다(의사결정 로그 15). 이유: 있던 판정과 `R8 설계서 버전`의 결과가 그대로라는 것을 있던 테스트가 지킨다. AC가 `scripts/test/harness-guard.test.ts`에서 지운 줄이 없는지 본다.
- 설계서 버전 검사의 규칙과 문제 글을 바꾸지 마라(옮기기만 한다). 이유: 수용 기준 7. step1의 모으기 결과도 이 검사로 본다.
- `scripts/lib/`의 파일이 `scripts/gates/`를 가져오게 하지 마라. 이유: 하위 계층이 상위 계층에 기대게 된다(의사결정 로그 13).
- `scripts/harness.ts`, `scripts/runner/`, `scripts/commands/`, `harness.config.json`, `scripts/ci/gates.ts`의 `harnessGuard` 호출 밖을 고치지 마라. 이유: 모으기 명령은 step1에서 만들고, runner 안내와 설정은 범위 밖이다(의사결정 로그 7).
- 조각 항목의 버전 금지와 링크 금지를 빼지 마라. 이유: 버전은 모으기가 매기고, 링크는 모으면 깨진다(의사결정 로그 5).
