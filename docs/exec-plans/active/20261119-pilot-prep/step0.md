# Step 0: web-test-effect

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 1·2, 의사결정 로그, 진행 로그의 Vitest 확인 결과, 다음 할 일)
- `profiles/web/profile.json`, `profiles/web/README.md`, `profiles/core/profile.json`(`testEffect` 예)
- `scripts/lib/config.ts`(`TestEffectConfig`, `resolveTestEffect`), `scripts/lib/util.ts`(`globToRegExp`)
- `scripts/gates/test-effect.ts`(`runOnBase`: 임시 worktree에 변경 전 코드를 체크아웃하고 `link` 경로를 연결한 뒤 `command` 끝에 테스트 파일 경로를 붙여 셸 없이 실행한다. 종료 코드 0이면 `ineffective`, 아니면 출력에 `assertPattern`이 보이는지로 사유를 나눈다)
- `scripts/lib/exec.ts`(`resolveExecutable`: Windows에서 `.cmd` 래퍼는 셸 없이 띄우지 못한다)
- `scripts/commands/init.ts`, `scripts/test/helpers.ts`
- `docs/exec-plans/tech-debt-tracker.md`의 TD-42 행

## 작업

웹 프로파일을 적용한 리포에서 테스트 실효성 검사(R5, `test-effect`)가 실제로 판정하게 한다(TD-42).

1. `profiles/web/test-effect/run-one.mjs`(새 파일. `vitest/node`를 import한다. 이 리포의 `tsconfig.json` 대상이 아니다)
   - 사용법: `node profiles/web/test-effect/run-one.mjs <테스트 파일의 리포 안 상대 경로>`. 인자가 정확히 하나가 아니면 종료 코드 2.
   - Vitest Node API로 그 파일 **하나만** 실행한다: `include`를 그 경로 하나(glob 문자를 이스케이프한 것)로 바꾸고 감시 모드를 끈다. CLI의 파일 인자(부분 문자열 필터)는 쓰지 않는다.
   - 종료 코드: 그 파일의 테스트가 모두 통과하면 0, 하나라도 실패하면 0이 아닌 값, 맞는 테스트 파일이 없으면 0이 아닌 값(통과로 두지 않는다).
   - 테스트 출력은 Vitest가 내는 대로 둔다(`test-effect`가 `assertPattern`을 대 본다).

2. `profiles/web/profile.json`
   - `config.testEffect`를 더한다.
     - `files`: `["src/**/*.test.ts", "src/**/*.test.tsx"]`. Vitest로 돌리는 단위·통합 테스트다. E2E 시나리오(`e2e/**/*.spec.ts`)는 넣지 않는다(실행 중인 앱이 필요하다).
     - `support`: `["src/test/**"]`(공용 테스트 도구).
     - `command`: `["node", "profiles/web/test-effect/run-one.mjs"]`. 끝에 테스트 파일 경로가 붙는다. 첫 요소는 `node`다. `pnpm`은 Windows에서 `.cmd` 래퍼일 수 있어 셸 없이 띄우지 못한다.
     - `timeoutSec`: `300`. `link`: `["node_modules"]`. `assertPattern`: `"AssertionError"`.
   - `version`을 `0.2.0`으로 올린다. 이유: `check` 캐시 키에 프로파일 버전이 들어간다.
   - 다른 키는 바꾸지 않는다.

3. 테스트 `scripts/test/profile-web.test.ts`(새 파일)
   - 임시 폴더에 이 리포의 `profiles/web/`과 `harness.config.json`을 복사하고 `init(root, 'web', {})`을 적용한 뒤 `loadConfig`가 통과하고 `testEffect`가 위 값과 같다.
   - `files`가 `src/a.test.ts`, `src/domain/user/user.test.tsx`에 맞고 `e2e/login.spec.ts`, `src/a.ts`, `tests/a.test.ts`에는 맞지 않는다(`matchesAny`).
   - `command`가 `["node", "profiles/web/test-effect/run-one.mjs"]`이고 그 파일이 이 리포에 있다.
   - `assertPattern`이 `AssertionError: expected 1 to be 2`에 맞고 `Error: Cannot find module './nope'`에는 맞지 않는다.
   - 래퍼를 인자 없이 실행하면(`node profiles/web/test-effect/run-one.mjs`) 종료 코드 2다. 이유: 인자 검사는 Vitest를 불러오기 전에 한다(이 리포에는 Vitest가 없다).

4. 실물 확인(`lab/pilot-prep/`)
   - `mktemp -d`로 만든 폴더에 이 worktree를 로컬 복제하고 `node scripts/harness.ts init --profile web`을 적용한다. `vitest`를 devDependency로 더한다(버전 고정, 이 리포의 `pnpm-workspace.yaml` 설치 정책 그대로). 이 리포의 `package.json`·lockfile은 바꾸지 않는다.
   - 기준 커밋을 만든다: `src/`에 작은 모듈과 통과하는 테스트. 그 위에 아래 사례의 변경을 만든다(사례 하나에 테스트 파일 하나).

     | 사례 id          | 테스트 파일                         | 변경 전 코드에서 | 기대 판정                               |
     | ---------------- | ----------------------------------- | ---------------- | --------------------------------------- |
     | `passes-on-base` | `src/keep.test.ts`                  | 통과             | `ineffective`                           |
     | `assertion`      | `src/change.test.ts`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
     | `new-module`     | `src/fresh.test.ts`                 | 모듈 없음        | `effective`, 판정 줄에 `단언 실패 아님` |
     | `similar-pass`   | `src/sim/a.test.ts`                 | 통과             | `ineffective`                           |
     | `similar-fail`   | `src/sim/a.test.tsx`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
     | `similar-nested` | `src/sim/deep/src/sim/a.test.ts`    | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
     | `special-path`   | `src/app/(shop)/[id]/page.test.tsx` | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |

   - `node scripts/harness.ts test-effect --base <기준 커밋>`을 두 번 돌린다: ① 일곱 사례가 모두 든 작업 트리(기대 종료 코드 1) ② `ineffective` 두 사례를 뺀 작업 트리(기대 종료 코드 0).
   - 사례 만들기, 두 번의 실행, 결과 파일 쓰기는 스크립트 `lab/pilot-prep/trial-test-effect.ts <복제한 폴더>`가 한다(의존성 설치는 README의 명령으로 먼저 한다). 판정 줄과 종료 코드는 실행 출력에서 옮긴다. 결과 파일을 손으로 쓰지 않는다.
   - 결과 파일 `lab/pilot-prep/results/test-effect-vitest.json`의 형식:
     ```json
     {
       "tool": { "vitest": "<버전>", "node": "<버전>", "os": "<플랫폼>" },
       "command": ["node", "profiles/web/test-effect/run-one.mjs"],
       "runs": [
         { "id": "all", "exitCode": 1 },
         { "id": "effective-only", "exitCode": 0 }
       ],
       "cases": [
         {
           "id": "passes-on-base",
           "file": "src/keep.test.ts",
           "outcome": "ineffective",
           "line": "<판정 줄>"
         }
       ]
     }
     ```
   - `lab/pilot-prep/check-results.ts`(새 파일): `node lab/pilot-prep/check-results.ts test-effect-vitest`가 결과 파일을 읽어 아래를 모두 확인하고, 하나라도 어긋나면 무엇이 어긋났는지 내고 종료 코드 1로 끝난다.
     - `tool.vitest`가 비어 있지 않다. `command`가 프로파일의 값과 같다(`profiles/web/profile.json`을 읽어 비교한다).
     - `runs`에 `all`(종료 코드 1)과 `effective-only`(종료 코드 0)가 있다.
     - 위 표의 일곱 사례 id가 모두 있고 더 있는 것은 없다. 사례마다 `file`과 `outcome`이 표와 같고, `line`에 표의 문구가 있다(`단언 실패`를 기대하는 사례의 `line`에는 `단언 실패 아님`이 없다).
     - 알 수 없는 이름을 넘기면 종료 코드 2다.
   - 기대와 다른 사례가 있으면 결과 파일을 맞춰 고치지 않는다. 래퍼나 설정값을 고치고(테스트도 함께) 다시 돌린다. 계획에 적은 값(`files`, `command`의 꼴)을 바꿔야 하면 멈추고 계획을 고쳐 다시 검증받는다.
   - `lab/pilot-prep/README.md`에 다시 해 볼 수 있는 절차(명령)와 결과 파일·검사 스크립트 설명을 쓰고, `docs/index.md`의 "하네스 자체"에 링크 한 줄을 더한다.

5. 문서
   - `profiles/web/README.md`: `testEffect` 항목(대상 glob, 공용 테스트 도구 위치 `src/test/`, E2E는 대상이 아님, 래퍼를 쓰는 이유(Vitest CLI의 파일 인자는 부분 문자열 필터다), 리포 구조가 다르면 그 리포의 `harness.config.json`에서 고친다. 그 변경은 `harness-guard`가 신호로 올린다).
   - `docs/exec-plans/tech-debt-tracker.md`: TD-42 행의 상태를 해결로 바꾸고 이 PR을 적는다. 다른 행은 건드리지 않는다.
   - `docs/harness/CHANGELOG.md`: 한 줄(`TD-42 해결`이라는 문구를 넣는다). 설계서 버전은 `origin/main`의 마지막 버전 다음 번호를 쓴다(TD-53 PR이 v0.7.58을 쓴다).
   - `docs/harness/design.md`: 0절 변경 이력에 같은 버전 한 줄. 다른 절은 고치지 않는다.

6. 순서(다른 세션과의 합의, plan.md 의사결정 로그)
   - 1~4와 5의 README는 계획 검증 승인 뒤 로컬에서 한다. push하지 않는다.
   - `CHANGELOG`·기술 부채 표·설계서는 TD-53 PR(Issue #139)이 main에 병합된 뒤 `origin/main`을 병합하고 나서 고친다.
   - 그 뒤 `check` → `complete-step` → push → `pr-ready`를 한 번에 한다. 다른 세션의 PR이 제작자 승인 대기 중이면 `pr-ready`를 하지 않고 기다린다.

## Acceptance Criteria

```bash
node --test scripts/test/profile-web.test.ts
node --test scripts/test/lib.test.ts
node lab/pilot-prep/check-results.ts test-effect-vitest
grep -q 'run-one.mjs' profiles/web/README.md
grep -q 'pilot-prep' docs/index.md
grep 'TD-42' docs/exec-plans/tech-debt-tracker.md | grep -q '해결'
grep -q 'TD-42 해결' docs/harness/CHANGELOG.md
node scripts/harness.ts fmt --check
node scripts/harness.ts doc-lint
```

## 금지사항

- 래퍼에서 Vitest CLI의 파일 인자(필터)로 대상을 고르지 마라. 이유: 부분 문자열 필터라 이름이 겹치는 다른 테스트 파일이 함께 돌고 그 실패가 대상 파일의 판정에 섞인다(계획 검증 F9).
- 맞는 테스트 파일이 없을 때 래퍼가 종료 코드 0을 내게 하지 마라. 이유: `test-effect`는 0을 "변경 전 코드에서도 통과"로 읽는다. 반대로 실패를 0으로 바꾸면 무의미한 테스트가 통과한다.
- 실물 확인 결과 파일을 손으로 기대값에 맞추지 마라. 돌리지 못한 사례는 채우지 말고 step을 끝내지 않는다. 이유: 이 파일이 수용 기준 2의 근거다.
- 이 리포의 `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `harness.config.json`, `scripts/lib/config.ts`를 바꾸지 마라. 이유: Vitest는 대상 리포의 의존성이고 이 계획은 설정 키를 더하지 않는다.
- `scripts/gates/test-effect.ts`의 판정 규칙을 바꾸지 마라. 이유: Issue #116·#118에서 검증받은 동작이다. 이 step은 프로파일 설정값과 래퍼만 더한다.
- `scripts/test/` 아래 기존 테스트 파일을 고치지 마라. 이유: 다른 세션과 겹친다. 테스트는 새 파일로 더한다.
- 테스트(`scripts/test/`)가 `lab/`을 읽게 하지 마라. 이유: `lab/**`는 `testInertPaths`(테스트가 읽지 않는 경로)다. `scripts/test/check-skip.test.ts`가 이 관계를 확인한다. 결과 파일 검사는 `lab/pilot-prep/check-results.ts`가 한다.
- 기술 부채 표에서 TD-42 밖의 행을 고치지 마라. 설계서 14.3절·18절, 0.1절·0.2절, 10.2~10.4절을 고치지 마라. 이유: 다른 세션과의 합의, Q10·Q13 미결정.
- `CHANGELOG`·기술 부채 표·설계서를 TD-53 PR 병합 전에 고쳐 push하지 마라. 이유: 세 파일을 고치는 PR은 한 번에 하나만 올린다.
- 임시 폴더를 지우는 명령을 실행하지 마라. 이유: R14(변수 경로 재귀 삭제 금지). `mktemp -d`로 만들고 둔다.
