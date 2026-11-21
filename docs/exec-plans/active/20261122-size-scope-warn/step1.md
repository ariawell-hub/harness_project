# Step 1: scope

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*`, `ci/*` 행)
- `docs/harness/design.md` 5절(R18 행), 8.2절(계획 파일 구성), 10.2절 (1), 10.3절의 필수 체크 표와 그 아래 목록, 14.6절 "범위 이탈 표시", 0절의 머리말과 변경 이력
- step0이 만든·바꾼 파일: `scripts/gates/pr-size.ts`, `scripts/ci/results.ts`(`WARN_CONTEXTS`, `RECORDED_CONTEXTS`), `scripts/ci/gates.ts`(`runGates`의 경고 판정 부분, `isWarning`), `scripts/lib/util.ts`(`WARN_PREFIX`), `scripts/test/pr-size.test.ts`
- `scripts/gates/risk-gate.ts`의 `changedFiles`, `scripts/lib/plan.ts`(`parseBranch`, `findPlan`, `planCandidates`, `parseDoc`, `section`, `stripHtmlComments`), `scripts/lib/util.ts`(`matchesAny`)
- `docs/harness/workflow.md` 2절·5절, `docs/exec-plans/TEMPLATE.md`, `docs/exec-plans/TEMPLATE-small.md`, `scripts/cross-review/checklist.md`(R18 항목)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-6 행, `scripts/metrics/render.ts`의 `UNMEASURED_TD`(읽기만)
- `scripts/test/helpers.ts`, `scripts/test/risk-gate.test.ts`, `scripts/test/revert-check.test.ts`

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

### 1. `scripts/gates/scope.ts`(새 파일)

```ts
/** "관련 파일·문서" 섹션 본문에서 범위 경로를 뽑는다(나온 순서, 중복 없음) */
export function scopePaths(sectionText: string): string[];
/** 파일이 범위 경로 하나에 드는가 */
export function inScope(file: string, paths: string[]): boolean;

export interface ScopeResult {
  state: 'success';
  description: string;
  details: string[];
  /** 범위 밖 파일(경로 순서) */
  outside: string[];
}
export function scopeCheck(o: { root: string; base: string; branch: string }): ScopeResult;
```

- `scopePaths`: 순수 함수다. HTML 주석을 지운 뒤 줄마다 본다.
  - 범위 경로는 백틱 하나로 감싼 글자(`` `…` ``)의 안쪽이다. 앞뒤 공백을 떼고, 비었거나 공백 문자가 든 것은 버린다.
  - 코드 블록(줄 머리가 공백 뒤 ` ``` ` 또는 `~~~`인 줄 사이) 안의 줄은 보지 않는다.
  - `읽기만`으로 시작하는 목록 항목(줄 머리의 공백, 목록 표식 `-`·`*`·`+` 하나, 공백 뒤가 `읽기만`)의 줄은 보지 않는다. 그 항목보다 깊이 들여쓴 뒤따르는 줄도 보지 않는다. 들여쓰기가 같거나 얕은 줄이 나오면 다시 본다. 빈 줄은 이 판단을 바꾸지 않는다.
  - 항목 머리가 아닌 곳의 `읽기만`(예: `` `a.ts`(읽기만) ``)은 아무 뜻이 없다. 그 경로는 범위에 든다.
- `inScope`: 범위 경로 하나라도 아래 둘 가운데 하나를 만족하면 참이다.
  - `matchesAny(file, [경로])`가 참이다(glob. 글자 그대로의 경로도 여기에 든다).
  - 경로에서 끝의 `/`를 뗀 것이 비어 있지 않고, `file`이 그것에 `/`를 붙인 글자로 시작한다(폴더 아래). `scripts/ci`는 `scripts/ci/a.ts`를 덮고 `scripts/ci-x/a.ts`는 덮지 않는다.
- `scopeCheck`: `state`는 늘 `success`다.
  1. `parseBranch(branch)`가 없거나 `findPlan(root, id)`가 없으면 `description`은 `계획이 없어 범위를 보지 않는다`이고 `details`·`outside`는 비어 있다.
  2. 바뀐 파일은 `changedFiles(root, base)`의 경로다(삭제 포함). 그 가운데 계획 자신의 파일은 뺀다: `planCandidates(id)`의 네 자리(`active`·`completed`의 `<id>/` 폴더 아래 전부와 `<id>.md`).
  3. 남은 파일이 없으면 `통과 (계획 파일만 바뀌었다)`.
  4. 계획 파일(PR 트리의 것)을 읽어 `section(body, '관련 파일')`에서 `scopePaths`를 뽑는다. 섹션이 없거나 경로가 하나도 없으면 경고다: `description`은 `WARN_PREFIX`로 시작하고 범위를 견줄 수 없다는 뜻을 담는다. `outside`는 남은 파일 전부다.
  5. 남은 파일 가운데 `inScope`가 거짓인 것이 `outside`다(경로 순서로 정렬). 비어 있으면 `통과 (바뀐 파일 <N>개가 모두 계획의 관련 파일 안)`이다(`<N>`은 남은 파일 수).
  6. `outside`가 있으면 경고다. `description`은 `WARN_PREFIX`로 시작하고 `outside`의 수와 앞의 두 경로를 담는다(셋 이상이면 나머지 수도 적는다). `details`에는 `outside`를 한 줄에 하나씩 30개까지 적고 나머지는 수만 적은 뒤, 고치는 법(의도한 변경이면 PR 본문에 이유를 적는다, 검증자가 확인한다, 경고이며 병합을 막지 않는다)과 근거 문서(설계서 14.6절, R18) 줄을 더한다.
  - 계획 파일을 읽지 못하면 예외다(통과로 넘기지 않는다). `runGates`가 그 context만 `error`로 만든다.
  - 계획은 `root`(PR 트리)의 것만 읽는다. merge-base의 계획과 견주지 않는다("관련 파일·문서"는 계획 검증의 해시에 묶여 있다).

### 2. 판정 묶음에 잇기

- `scripts/ci/results.ts`: `WARN_CONTEXTS`를 `['pr-size', 'scope']`로 한다(이 순서). `RECORDED_CONTEXTS`는 그에 따라 늘어난다.
- `scripts/ci/gates.ts`의 `runGates`: `scope` 판정은 `scopeCheck({ root, base, branch })`의 `state`·`description`·`details`를 쓴다. 감싸기(`guarded`)와 확인된 revert PR의 처리는 step0이 만든 경고 판정의 틀 그대로다.
- `scripts/ci/record.ts`와 `scripts/harness.ts`는 고치지 않는다.

### 3. 테스트 `scripts/test/scope.test.ts`(새 파일)

- **`scopePaths`**:
  - 한 줄에 경로 여럿(`` `a.ts`, `b/c.ts`(설명) ``)을 순서대로 뽑고 같은 경로는 한 번만 넣는다.
  - 공백이 든 백틱 글자(`` `git status` ``)와 빈 것은 버린다.
  - HTML 주석 안과 코드 블록 안의 백틱 글자는 넣지 않는다.
  - `- 읽기만: `x.ts``의 경로는 넣지 않는다. 그 항목 아래에 더 깊이 들여쓴 줄의 경로도 넣지 않는다. 그 뒤에 오는 같은 들여쓰기의 항목은 넣는다. `* 읽기만`과 `+ 읽기만`도 같다.
  - ``- `a.ts`(읽기만)``의 `a.ts`는 넣는다.
- **`inScope`**: 글자 그대로의 경로, glob(`scripts/ci/**`, `docs/*.md`), 폴더(`scripts/ci/`와 `scripts/ci` 둘 다 `scripts/ci/a/b.ts`를 덮는다), 비슷한 접두어(`scripts/ci`는 `scripts/ci-x/a.ts`를 덮지 않는다), 범위 경로가 없으면 거짓.
- **`scopeCheck`**(임시 `git` 리포. 계획 폴더와 "관련 파일·문서"를 테스트 안에서 만든다):
  - 바뀐 파일이 모두 범위 안이면 `통과 (바뀐 파일 N개가 모두 계획의 관련 파일 안)`이고 `outside`가 비어 있다.
  - 범위 밖 파일 셋(그 가운데 하나는 base에 있던 파일을 지운 것)이면 `description`이 `경고: `로 시작하고 `3`과 경로 순서로 앞의 두 경로가 들어 있다. `outside`와 `details`의 앞 세 줄이 경로 순서의 세 파일이다. `state`는 `success`다.
  - `읽기만` 항목에만 있는 파일을 고치면 범위 밖이다.
  - 계획 자신의 파일(`plan.md`, `index.json`, `step0.md`)은 "관련 파일·문서"에 없어도 범위 안이다. 계획 폴더가 `completed/`에 있어도 같다. base에서 `active/`에 있던 계획을 `completed/`로 옮긴 PR에서 `active/` 쪽의 삭제도 범위 안이다.
  - 계획 파일만 바뀐 PR은 `통과 (계획 파일만 바뀌었다)`이다. "관련 파일·문서"가 비어 있어도 같다.
  - "관련 파일·문서"에 경로가 없는데(섹션이 없는 경우와 주석만 있는 경우) 다른 파일이 바뀌면 경고이고 `outside`가 그 파일들이다.
  - 소규모 계획(단일 파일 `<id>.md`, 브랜치에 `-sN`이 없다)도 같은 규칙이다.
  - 브랜치가 `revert/…`나 `claim/1`이면, 또는 브랜치는 계획 꼴인데 계획 파일이 없으면 `계획이 없어 범위를 보지 않는다`이다.
  - 범위 밖 파일이 31개면 `details`에 30개만 적히고 나머지 1개는 수로 적힌다. `outside`의 길이는 31이다.
- **`runGates`**: 결과의 context 순서가 `RECORDED_CONTEXTS`와 같고 끝의 둘이 `pr-size`, `scope`다. 범위 밖 파일이 있는 PR에서 `scope`가 `success`이고 `isWarning`이 참이며, 필수 판정 다섯의 `state`는 범위 밖 파일이 없는 같은 모양의 PR과 같다. 계획 파일 자리에 폴더가 있어 읽을 수 없으면 `scope`는 `error`이고 `pr-size`는 `success`다.
- `scripts/test/revert-check.test.ts`: 확인된 revert PR의 `runGates` 테스트에 `scope`가 `success`·`revert PR: 보지 않는다`인 단언을 더한다.

### 4. 문서

- `docs/harness/workflow.md` 5절: step0이 더한 "경고 판정 `pr-size`는 …" 항목 바로 뒤에 아래 한 항목을 더한다(글자 그대로).

  ```text
  - 경고 판정 `scope`도 필수 체크가 아니다. PR이 바꾼 파일 가운데 계획의 "관련 파일·문서"에 없는 것이 있으면 커밋 상태의 설명이 `경고: `로 시작하고, 판정 job 요약에 그 파일들이 나온다(계획 자신의 파일은 늘 범위 안이다). 의도한 변경이면 PR 본문에 이유를 적는다. 검증자가 확인한다(R18).
  ```

- `docs/harness/workflow.md` 2절: "필수 섹션: …"으로 시작하는 항목 바로 뒤에 아래 한 항목을 더한다(글자 그대로).

  ```text
  - "관련 파일·문서"에는 바꿀 파일·폴더의 경로를 백틱으로 감싸 적는다(glob을 쓸 수 있고, 폴더는 그 아래 전부다). 읽기만 할 파일은 `읽기만`으로 시작하는 항목에 따로 적는다. 그 항목의 경로는 범위에 넣지 않는다(`scope`, R18).
  ```

- `docs/exec-plans/TEMPLATE.md`: "관련 파일·문서" 아래의 안내 주석을, 경로를 백틱으로 감싸 적는다는 것과 읽기만 할 파일은 `읽기만`으로 시작하는 항목에 적는다는 것을 담게 고친다. `docs/exec-plans/TEMPLATE-small.md`의 같은 제목 아래에 같은 뜻의 주석을 더한다. 두 파일의 제목과 그 밖의 줄은 바꾸지 않는다.
- `docs/harness/architecture.md`: `gates/*` 행에 `scope.ts`의 한 문장을 더한다.
- `docs/harness/design.md`:
  - 10.2절 (1)의 목록에 한 항목: `pr-size`의 구현(센 줄 수의 기준, 설정 `prSize`, 경고 표현).
  - 10.3절의 필수 체크 표 아래 목록에 한 항목: `pr-size`·`scope`는 경고 판정이고 필수 체크로 등록하지 않는다는 것, 기록 job이 커밋 상태로 쓰되 경고여도 `success`이고 설명이 `경고: `로 시작한다는 것.
  - 14.6절 "범위 이탈 표시" 항목: 범위 경로를 읽는 규칙(백틱, 폴더, `읽기만` 항목, 계획 자신의 파일)을 한두 문장으로 더한다. "`읽기만`으로 시작하는 항목"이라는 말을 그대로 쓴다.
  - 0절의 변경 이력에 새 항목을 더하고 머리말의 버전·최종 갱신을 그 항목과 맞춘다. 버전은 push 직전에 `origin/main`을 병합한 뒤의 마지막 버전 다음 번호다(`doc-lint`의 `R8 설계서 버전`이 확인한다).
  - 5절의 R15·R18 행과 그 밖의 절은 바꾸지 않는다.
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)"에 한 줄: `scope` 판정, "관련 파일·문서"를 적는 형식, 템플릿 주석, 필수 체크와 워크플로는 바뀌지 않는다는 것, 검사를 약화하지 않는다는 것.
- `docs/exec-plans/tech-debt-tracker.md`:
  - TD-6 행의 내용을 고친다: R15 `pr-size`와 R18 `scope`는 경고 판정으로 구현했다는 것(이 계획의 두 PR 번호)과, 남은 것이 R11 구조 테스트와 R19 보안 린트·SAST라는 것. 상태는 `열림` 그대로다.
  - 새 행 하나(push 직전에 `origin/main`을 병합한 뒤의 마지막 번호 다음, 상태 `열림`): 경고 판정의 남은 일 셋. (1) 지표가 두 경고의 수를 세지 않고 지표 출력이 "게이트가 없다"고 적는다(`scripts/metrics/render.ts`의 `UNMEASURED_TD.gates`). (2) `pr-state`가 경고를 보여 주지 않는다. (3) 경고를 차단으로 바꾸는 스위치가 없다(Q9).
  - 다른 행은 고치지 않는다. 표의 다른 행이 다시 정렬되지 않게 열 폭 안으로 쓴다.

## Acceptance Criteria

```bash
node --test scripts/test/scope.test.ts scripts/test/pr-size.test.ts scripts/test/ci.test.ts scripts/test/record.test.ts scripts/test/risk-gate.test.ts scripts/test/revert-check.test.ts scripts/test/ops-check.test.ts scripts/test/protection.test.ts scripts/test/metrics-local.test.ts
node scripts/harness.ts doc-lint
grep -qxF -e '- 경고 판정 `scope`도 필수 체크가 아니다. PR이 바꾼 파일 가운데 계획의 "관련 파일·문서"에 없는 것이 있으면 커밋 상태의 설명이 `경고: `로 시작하고, 판정 job 요약에 그 파일들이 나온다(계획 자신의 파일은 늘 범위 안이다). 의도한 변경이면 PR 본문에 이유를 적는다. 검증자가 확인한다(R18).' docs/harness/workflow.md
grep -qxF -e '- "관련 파일·문서"에는 바꿀 파일·폴더의 경로를 백틱으로 감싸 적는다(glob을 쓸 수 있고, 폴더는 그 아래 전부다). 읽기만 할 파일은 `읽기만`으로 시작하는 항목에 따로 적는다. 그 항목의 경로는 범위에 넣지 않는다(`scope`, R18).' docs/harness/workflow.md
grep -q '읽기만' docs/exec-plans/TEMPLATE.md
grep -q '읽기만' docs/exec-plans/TEMPLATE-small.md
grep -q 'scope.ts' docs/harness/architecture.md
grep -q '`prSize`' docs/harness/design.md
grep -q '`읽기만`으로 시작하는 항목' docs/harness/design.md
grep -q '경고 판정' docs/harness/design.md
grep -q "^| TD-6 .*경고 판정.*| 열림 " docs/exec-plans/tech-debt-tracker.md
grep -q "^| TD-[0-9]* .*UNMEASURED_TD.*pr-state.*Q9.*| 열림 " docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- `GATE_CONTEXTS`에 `scope`를 넣지 마라. 이유: `ops-check`가 그 목록을 브랜치 보호의 필수 체크 요구로 쓴다. 경고 판정은 필수 체크가 아니다.
- 경고를 `failure`나 `error`로 내지 마라. 이유: 필수 체크 설정이 없는 리포의 `pr-state`는 체크 요약으로 분류하므로 실패로 읽힌다. `error`는 판정하지 못했을 때만이다.
- 백틱으로 감싸지 않은 글자를 경로로 추측하지 마라. 이유: 문장 속의 말("설계서 6절")과 경로를 가를 수 없다. 형식은 절차서 2절에 적는다.
- 계획 파일을 읽지 못한 경우를 통과로 넘기지 마라. 이유: 범위를 견주지 못한 것이 조용히 통과가 된다.
- step0이 만든 `pr-size`의 판정 기준과 설정 `prSize`를 바꾸지 마라. 이유: 이 step은 판정 하나를 더할 뿐이다.
- `scripts/metrics/`, `scripts/test/metrics-*.ts`, `scripts/commands/pr-state.ts`, `scripts/runner/`, `scripts/ci/pr.ts`, `scripts/hooks/`, `scripts/harness.ts`, `harness.config.json`, `profiles/`, `.github/`를 고치지 마라. 이유: 범위 밖이고 다른 세션의 PR(#171, #184, #185)이 고치는 파일이 있다. 지표와 `pr-state`의 남은 일은 새 기술 부채 행으로 남긴다.
- `scripts/cross-review/`의 프롬프트와 체크리스트를 고치지 마라. 이유: 검증자에게 `scope`의 결과를 넘기는 일은 비범위다.
- 설계서 5절의 규칙 표와 10.4절, 절차서 4절을 고치지 마라. 이유: 규칙과 보장 수준은 그대로이고, 다른 세션이 고치는 곳이다.
- 기존 테스트 파일의 단언을 지우거나 약하게 하지 마라(R4). 이유: 다른 판정의 결과가 같다는 증거다.
