# Step 0: web-test-effect

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표, 의사결정 로그, 다음 할 일)
- `profiles/web/profile.json`, `profiles/web/README.md`, `profiles/core/profile.json`(`testEffect` 예)
- `scripts/lib/config.ts`(`TestEffectConfig`, `resolveTestEffect`), `scripts/lib/util.ts`(`globToRegExp`)
- `scripts/gates/test-effect.ts`(`runOnBase`: 임시 worktree에 변경 전 코드를 체크아웃하고 `link` 경로를 연결한 뒤 `command` 끝에 테스트 파일 경로를 붙여 셸 없이 실행한다)
- `scripts/lib/exec.ts`(`resolveExecutable`: Windows에서 `.cmd` 래퍼는 셸 없이 띄우지 못한다)
- `scripts/commands/init.ts`, `scripts/test/helpers.ts`
- `docs/exec-plans/tech-debt-tracker.md`의 TD-42 행

## 작업

웹 프로파일을 적용한 리포에서 테스트 실효성 검사(R5, `test-effect`)가 실제로 판정하게 한다(TD-42).

1. `profiles/web/profile.json`
   - `config.testEffect`를 더한다.
     - `files`: `["src/**/*.test.ts", "src/**/*.test.tsx"]`. Vitest로 돌리는 단위·통합 테스트다. E2E 시나리오(`e2e/**/*.spec.ts`)는 넣지 않는다(실행 중인 앱이 필요하다).
     - `support`: `["src/test/**"]`(공용 테스트 도구).
     - `command`: `["node", "node_modules/vitest/vitest.mjs", "run"]`. 끝에 테스트 파일 경로가 붙는다. 첫 요소는 `node`여야 한다. `pnpm`은 Windows에서 `.cmd` 래퍼일 수 있어 셸 없이 띄우지 못한다.
     - `timeoutSec`: `300`. `link`: `["node_modules"]`. `assertPattern`: `"AssertionError"`.
   - `version`을 `0.2.0`으로 올린다. 이유: `check` 캐시 키에 프로파일 버전이 들어간다.
   - 다른 키는 바꾸지 않는다.

2. 테스트 `scripts/test/profile-web.test.ts`(새 파일)
   - 임시 폴더에 이 리포의 `profiles/web/`과 `harness.config.json`을 복사하고 `init(root, 'web', {})`을 적용한 뒤 `loadConfig`가 통과하고 `testEffect`가 위 값과 같다.
   - `files`가 `src/a.test.ts`, `src/domain/user/user.test.tsx`에 맞고 `e2e/login.spec.ts`, `src/a.ts`, `tests/a.test.ts`에는 맞지 않는다(`matchesAny`).
   - `command`의 첫 요소가 `node`이고 모든 요소가 비어 있지 않은 문자열이다.
   - `assertPattern`이 `AssertionError: expected 1 to be 2`에 맞고 `Error: Cannot find module`에는 맞지 않는다.

3. 실물 확인(`lab/pilot-prep/`)
   - `mktemp -d`로 만든 폴더에 이 worktree를 로컬 복제하고 `node scripts/harness.ts init --profile web`을 적용한다. `vitest`를 devDependency로 더한다(버전 고정, 이 리포의 `pnpm-workspace.yaml` 설치 정책 그대로). 이 리포의 `package.json`·lockfile은 바꾸지 않는다.
   - 기준 커밋: `src/`에 작은 모듈과 통과하는 테스트. 그 위에 세 가지 변경을 만든다: ① 변경 전 코드에서도 통과하는 테스트 파일 추가 ② 기존 모듈의 동작을 바꾸고 그 동작을 단언하는 테스트 파일 ③ 새 모듈과 그 테스트 파일.
   - `node scripts/harness.ts test-effect --base <기준 커밋>`의 판정 줄과 종료 코드를 `lab/pilot-prep/results/test-effect-vitest.json`에 적는다: 사례 id(`passes-on-base`, `assertion`, `new-module`), 판정(`ineffective` | `effective`), 판정 줄, 종료 코드, Vitest·Node 버전, OS, 실행한 `command`.
   - 기대: ①은 `ineffective`이고 종료 코드 1, ②는 `단언 실패`, ③은 `단언 실패 아님`. 기대와 다르면 설정값을 고치고(테스트도 함께) 의사결정 로그에 이유를 적는다.
   - Vitest는 인자를 파일 이름 필터로 쓴다. `src/a.test.ts`를 넘겼을 때 `src/a.test.tsx`까지 도는지 확인해 결과 파일의 `notes`에 적는다. 돈다면 한계로 `profiles/web/README.md`에 적는다.
   - `lab/pilot-prep/README.md`에 다시 해 볼 수 있는 절차(명령)와 결과 파일 설명을 쓰고, `docs/index.md`의 "하네스 자체"에 링크 한 줄을 더한다.

4. 문서
   - `profiles/web/README.md`: `testEffect` 항목(대상 glob, 공용 테스트 도구 위치 `src/test/`, E2E는 대상이 아님, 리포 구조가 다르면 그 리포의 `harness.config.json`에서 고친다. 그 변경은 `harness-guard`가 신호로 올린다).
   - `docs/exec-plans/tech-debt-tracker.md`: TD-42 행의 상태를 해결로 바꾸고 이 PR을 적는다. 다른 행은 건드리지 않는다.
   - `docs/harness/CHANGELOG.md`: 한 줄(`TD-42 해결`이라는 문구를 넣는다). 설계서 버전은 `origin/main`의 마지막 버전 다음 번호를 쓴다(TD-53 PR이 v0.7.58을 쓴다).
   - `docs/harness/design.md`: 0절 변경 이력에 같은 버전 한 줄. 다른 절은 고치지 않는다.

5. 순서(다른 세션과의 합의, plan.md 의사결정 로그)
   - 1~3과 4의 README는 계획 검증 승인 뒤 로컬에서 한다. push하지 않는다.
   - `CHANGELOG`·기술 부채 표·설계서는 TD-53 PR(Issue #139)이 main에 병합된 뒤 `origin/main`을 병합하고 나서 고친다.
   - 그 뒤 `check` → `complete-step` → push → `pr-ready`를 한 번에 한다. 다른 세션의 PR이 제작자 승인 대기 중이면 `pr-ready`를 하지 않고 기다린다.

## Acceptance Criteria

```bash
node --test scripts/test/profile-web.test.ts
node --test scripts/test/lib.test.ts
grep -q '"testEffect"' profiles/web/profile.json
grep -q 'testEffect' profiles/web/README.md
grep -q '"passes-on-base"' lab/pilot-prep/results/test-effect-vitest.json
grep -q '"ineffective"' lab/pilot-prep/results/test-effect-vitest.json
grep -q '단언 실패 아님' lab/pilot-prep/results/test-effect-vitest.json
grep -q 'pilot-prep' docs/index.md
grep 'TD-42' docs/exec-plans/tech-debt-tracker.md | grep -q '해결'
grep -q 'TD-42 해결' docs/harness/CHANGELOG.md
node scripts/harness.ts doc-lint
```

## 금지사항

- 이 리포의 `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `harness.config.json`, `scripts/lib/config.ts`를 바꾸지 마라. 이유: Vitest는 대상 리포의 의존성이고 이 계획은 설정 키를 더하지 않는다.
- `scripts/gates/test-effect.ts`의 판정 규칙을 바꾸지 마라. 이유: Issue #116·#118에서 검증받은 동작이다. 이 step은 프로파일 설정값만 채운다.
- `scripts/test/` 아래 기존 테스트 파일을 고치지 마라. 이유: 다른 세션과 겹친다. 테스트는 새 파일로 더한다.
- 테스트가 `lab/`을 읽게 하지 마라. 이유: `lab/**`는 `testInertPaths`(테스트가 읽지 않는 경로)다. `scripts/test/check-skip.test.ts`가 이 관계를 확인한다.
- 기술 부채 표에서 TD-42 밖의 행을 고치지 마라. 설계서 14.3절·18절, 0.1절·0.2절, 10.2~10.4절을 고치지 마라. 이유: 다른 세션과의 합의, Q10·Q13 미결정.
- `CHANGELOG`·기술 부채 표·설계서를 TD-53 PR 병합 전에 고쳐 push하지 마라. 이유: 세 파일을 고치는 PR은 한 번에 하나만 올린다.
- 임시 폴더를 지우는 명령을 실행하지 마라. 이유: R14(변수 경로 재귀 삭제 금지). `mktemp -d`로 만들고 둔다.
