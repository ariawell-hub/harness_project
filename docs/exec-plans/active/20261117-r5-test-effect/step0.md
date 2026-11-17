# Step 0: gate

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-test-effect/plan.md`(목표, 의사결정 로그)
- `docs/harness/design.md` 5.1절의 R5 행
- `scripts/gates/bypass-scan.ts`(게이트 함수의 꼴: `base`, `committedOnly`, `Problem`)
- `scripts/ci/repro.ts`(테스트 파일 하나를 인자 배열 명령으로 실행하는 예)
- `scripts/lib/config.ts`(`ci.repro` 검증), `scripts/lib/exec.ts`(`run`, `runSync`), `scripts/lib/git.ts`, `scripts/lib/util.ts`(`globToRegExp`, `Problem`)
- `scripts/harness.ts`의 `bypass-scan`·`secret-scan` 명령

## 작업

테스트 실효성 검사 게이트와 단독 명령을 만든다. 이 step에서는 `check`에 넣지 않고 `harness.config.json`에 설정값도 넣지 않는다(step1).

1. 설정 `testEffect`(`scripts/lib/config.ts`의 `HarnessConfig`와 검증). 없으면 `null`로 채운다.

   ```ts
   testEffect: {
     /** 검사할 테스트 파일 glob(리포 루트 기준) */
     files: string[];
     /** head 판을 함께 덮어쓸 보조 파일 glob(검사 대상은 아니다). 없으면 [] */
     support: string[];
     /** 테스트 파일 하나를 실행하는 명령(인자 배열). 끝에 파일 경로가 붙는다 */
     command: string[];
     timeoutSec: number;
     /** head 체크아웃에서 base 체크아웃으로 연결할 경로(예: node_modules). 없으면 [] */
     link: string[];
   } | null;
   ```

   - 검증: `files`는 비어 있지 않은 문자열 배열, `command`는 비어 있지 않은 문자열 배열(빈 문자열 없음), `timeoutSec`은 양의 정수. `files`·`support`·`link`의 값은 리포 안 상대 경로여야 한다(`/`로 시작하지 않고, `..` 구간과 `\`가 없다). 어기면 `ConfigError`.

2. `scripts/gates/test-effect.ts`(새 파일)

   ```ts
   export type TestEffectOutcome = 'effective' | 'ineffective' | 'restored' | 'exempt' | 'invalid';
   export interface TestEffectItem {
     file: string;
     outcome: TestEffectOutcome;
     detail: string;
   }
   export interface TestEffectResult {
     skipped: boolean;
     items: TestEffectItem[];
     problems: Problem[];
   }
   export async function testEffect(
     root: string,
     cfg: HarnessConfig,
     o: { base: string | null; committedOnly: boolean },
   ): Promise<TestEffectResult>;
   /** 예외 줄(고치는 법에 그대로 낸다). 사유 자리는 `<한 줄>`로 둔다 */
   export function exemptLine(file: string, blob: string): string;
   export function parseExemptions(text: string): { file: string; blob: string; reason: string }[];
   ```

   - `cfg.testEffect`가 `null`이거나 `base`가 `null`이면 `skipped: true`로 끝낸다.
   - 대상: `base`와 head 사이에 추가·수정된 파일(삭제 제외, 이름 변경은 삭제 + 추가로 본다) 가운데 `files` glob에 맞는 것. head는 `committedOnly`면 `HEAD` 커밋, 아니면 작업 트리(추적되지 않은 새 파일 포함)다.
   - 파일마다 순서대로 판정한다.
     1. 일반 파일이 아니면(심볼릭 링크 등) `invalid`. 문제로 낸다.
     2. head 판의 blob이 그 경로의 base 판이나 이전 판(`base`에서 그 경로를 바꾼 최근 커밋 30개의 판)과 같으면 `restored`. 실행하지 않는다.
     3. 이 변경이 고친 계획 파일(`docs/exec-plans/` 아래의 `.md`, head 판)에 경로와 blob이 같은 예외 줄이 있으면 `exempt`. 실행하지 않는다. `detail`에 사유를 넣는다.
     4. 나머지는 base 체크아웃에서 실행한다. 종료 코드 0이면 `ineffective`(문제로 낸다), 0이 아니거나 시간 초과면 `effective`.
   - 예외 줄의 형식(줄 전체가 이 꼴이어야 한다): ``- test-effect 예외: `<경로>` @ `<blob 40자 16진수>` — 사유: <비어 있지 않은 한 줄>``
   - base 체크아웃: 실행할 파일이 하나라도 있을 때만 만든다. `os.tmpdir()` 아래 새 폴더에 `git worktree add --detach`로 `base`를 체크아웃하고, 실행할 테스트 파일과 이 변경이 추가·수정한 `support` 파일의 head 판을 덮어쓴다. `link`의 경로는 head 체크아웃에 있고 base 체크아웃에 없을 때만 연결한다(Windows는 junction).
   - 실행: `command` + 파일 경로를 base 체크아웃을 작업 폴더로 해서 셸 없이 실행한다. 환경 변수는 현재 프로세스의 것에서 `NODE_TEST_CONTEXT`만 뺀다(이 변수가 있으면 중첩된 `node --test`가 테스트를 건너뛰고 0으로 끝난다). 파일은 동시에 최대 4개까지 실행한다.
   - 정리(`finally`): 연결한 경로를 먼저 지우고(연결만 지운다. 원본을 따라가 지우지 않는다) `git worktree remove --force`와 `git worktree prune`을 한다. 정리가 실패해도 판정은 바꾸지 않는다.
   - 문제(`Problem`)의 `rule`은 `R5 테스트 실효성`이다. `ineffective`의 고치는 법에는 두 가지를 적는다: 변경을 잡아내는 테스트로 고친다 / 기존 동작을 확인하는 테스트나 테스트 리팩터면 계획의 의사결정 로그에 `exemptLine`의 줄을 적는다(blob을 채워서 낸다).
   - **테스트 출력을 옮기지 않는다.** 결과·문제·로그에는 파일 경로, 판정, 종료 코드(또는 "시간 초과"), 예외 사유만 넣는다. 실행한 프로세스의 stdout·stderr는 버린다.
   - head 작업 트리와 index는 바꾸지 않는다.

3. `scripts/harness.ts`: `test-effect [--ci] [--base <sha>]`
   - `bypass-scan`과 같은 꼴이다. `--ci`면 `committedOnly`. `--base`가 없으면 `defaultBase`.
   - 파일마다 `<경로>: <판정>(<detail>)` 한 줄을 stdout에, 문제는 `formatProblem`으로 stderr에 낸다. 마지막 줄은 `test-effect: 통과` / `test-effect: <N>건` / `test-effect: 해당 없음(<이유>)`.
   - 종료 코드: 문제가 있으면 1, 없거나 해당 없음이면 0.
   - 도움말에 한 줄을 더한다.
   - **명령이나 테스트 파일을 명령줄 인자로 받지 않는다.**

4. 테스트
   - `scripts/test/test-effect.test.ts`(새 파일). 임시 git 리포(base 커밋 + 변경)와 `node --test`로 도는 작은 테스트 파일로 확인한다.
     - base에서 통과하는 새 테스트 파일 → `ineffective`, 문제의 고치는 법에 그 파일의 blob이 든 예외 줄이 있다.
     - base에서 단언 실패하는 새 테스트 파일 → `effective`. 새 모듈이 없어 실패하는 경우도 `effective`.
     - 수정한 테스트 파일: 더한 케이스가 base에서 실패하면 `effective`, 통과하면 `ineffective`.
     - 시간 초과 → `effective`.
     - 예외 줄: 경로·blob이 같고 이 변경이 고친 계획 파일에 있으면 `exempt`. blob이 다르거나, 사유가 비었거나, 이 변경이 고치지 않은 계획 파일에 있으면 `ineffective`.
     - 이전 판으로 되돌린 테스트 파일 → `restored`(base에서 통과하는 내용이어도).
     - `support` 파일의 head 판이 덮어써진다(새 헬퍼를 쓰지만 base에서도 통과하는 테스트가 `ineffective`로 나온다).
     - `committedOnly`면 커밋되지 않은 변경을 보지 않고, 아니면 추적되지 않은 새 테스트 파일도 본다.
     - 삭제된 테스트 파일은 대상이 아니다. 설정 `null`·`base` `null` → `skipped`.
     - 심볼릭 링크로 커밋된 테스트 파일(`git update-index --cacheinfo 120000,…`로 만든다) → `invalid`.
     - 테스트 파일이 stdout·stderr에 낸 표식 문자열이 결과(`items`, `problems`)와 CLI 출력에 없다.
     - 실행 뒤 `git worktree list`에 임시 worktree가 없고, head의 `git status --porcelain`이 실행 전과 같고, `link`한 원본 폴더와 그 안의 파일이 남아 있다.
     - CLI: 종료 코드와 마지막 줄(통과, N건, 해당 없음).
   - `scripts/test/lib.test.ts`: `testEffect` 설정 검증(없으면 `null`, 잘못된 값마다 `ConfigError`).

5. 문서: `docs/harness/architecture.md`(게이트·명령 목록에 한 줄), `docs/harness/CHANGELOG.md`(한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/test-effect.test.ts
node --test scripts/test/lib.test.ts
grep -q "export async function testEffect" scripts/gates/test-effect.ts
! grep -q "runShell" scripts/gates/test-effect.ts
! grep -q "test-effect" scripts/commands/check.ts
```

## 금지사항

- 테스트를 셸 문자열로 실행하지 마라(`runShell`, `shell: true`). 이유: 되돌린 `fail-first`는 인자를 셸로 실행해 L1 훅을 지나갔다.
- 명령줄 인자로 실행할 명령이나 파일 경로를 받지 마라. 이유: 같은 이유. 실행 대상은 설정과 git이 정한다.
- 테스트 프로세스의 출력을 결과·로그·파일에 옮기지 마라. 이유: 테스트 출력에 비밀이 섞일 수 있다.
- head 작업 트리의 파일을 base 판으로 바꿨다가 되돌리는 방식으로 구현하지 마라. 이유: 중간에 죽으면 작업 트리가 깨진 채 남는다(R14).
- `check`에 넣거나 `harness.config.json`·프로파일에 `testEffect` 값을 넣지 마라. 이유: step1의 범위다. 이 step의 PR이 필수 체크의 동작을 바꾸지 않게 한다.
- 단언 실패 패턴으로 base 실패를 가려내지 마라. 이유: 새 모듈의 테스트는 base에서 모듈 없음으로 끝난다(계획의 의사결정 로그).
