# Step 0: record-command

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-fail-first/plan.md` (수용 기준 1~3, 의사결정 로그)
- `docs/harness/design.md` 5.1절 R5 행, 10.2절 (3)(재현 job의 단언 실패 판정)
- `scripts/commands/task.ts`(`planOf`, `TaskError`), `scripts/lib/git.ts`(`repoInfo`, `harnessStateDir`), `scripts/lib/attempts.ts`(상태 폴더의 jsonl 기록 방식), `scripts/lib/exec.ts`(`runShell`), `scripts/lib/config.ts`(`ci.repro.failPattern`, `limits.acTimeoutSec`), `scripts/lib/util.ts`(`globToRegExp`)
- `scripts/harness.ts`(명령 등록, 도움말, 옵션 표)

## 작업

1. `scripts/commands/fail-first.ts`

   ```ts
   export interface FailFirstRecord {
     ts: string; // ISO 시각
     plan: string;
     step: number | null; // 소규모 계획은 null
     kind: 'fail' | 'exempt';
     /** kind가 fail일 때: 실행한 명령, 종료 코드, 단언 실패가 보인 첫 줄(200자 이내), 출력의 sha256 앞 12자 */
     command?: string;
     code?: number;
     matched?: string;
     outputSha?: string;
     /** kind가 exempt일 때: 사유 */
     reason?: string;
     head: string; // 기록 시점의 HEAD
   }
   /** 테스트 파일인가(리포 루트 기준 경로). 기본 glob: `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`, `**/test_*.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**` */
   export function isTestFile(file: string): boolean;
   /** 이 worktree의 기록 가운데 그 계획·step의 것(쓴 순서) */
   export function readFailFirst(info: RepoInfo, plan: string, step: number | null): FailFirstRecord[];
   /** 명령을 실행해 단언 실패면 기록한다. 기록하지 못하면 FailFirstError(이유) */
   export async function failFirst(cwd: string, command: string): Promise<FailFirstRecord>;
   /** 실행 없이 예외를 기록한다 */
   export function exemptFailFirst(cwd: string, reason: string): FailFirstRecord;
   ```

   - 계획·step은 현재 브랜치에서 정한다(`complete-step`과 같은 방법). 계획 브랜치가 아니면 오류다.
   - 명령은 worktree 루트에서 `runShell`로 실행한다. 시간 제한은 `limits.acTimeoutSec`이다.
   - 판정: 종료 코드가 0이 아니고, 시간 초과가 아니고, 출력(stdout + stderr)에 단언 실패 정규식이 보이면 기록한다. 정규식은 `ci.repro.failPattern`이고 `ci.repro`가 null이면 `AssertionError|ERR_ASSERTION`이다.
   - 기록하지 않는 경우마다 이유가 다르다: "테스트가 통과했다(종료 코드 0)", "시간 제한을 넘겼다", "단언 실패가 아니다(모듈을 찾지 못함·문법 오류 등. 테스트가 실행돼 단언에서 실패해야 한다)".
   - 기록 파일은 `harnessStateDir(info, 'worktree')`의 `fail-first.jsonl`이다. 한 줄에 기록 하나를 덧붙인다. 깨진 줄은 읽을 때 건너뛴다.
   - 명령·사유·단언 실패 줄은 한 줄로 만들고(줄바꿈을 공백으로) 길이를 자른다(명령 500자, 사유 500자, 단언 실패 줄 200자).

2. `scripts/harness.ts`: `fail-first "<테스트 명령>"`과 `fail-first --exempt "<사유>"`.
   - 기록하면 `fail-first: 기록했다 — <명령> → 종료 코드 <N>, <단언 실패 줄>`을 출력하고 0으로 끝난다. 예외는 `fail-first: 예외를 기록했다 — <사유>`.
   - 기록하지 못하면 이유와 실행 출력의 끝 40줄을 stderr로 내고 1로 끝난다(Node 테스트 출력은 모듈을 찾지 못한 원인 줄이 요약보다 앞에 있다).
   - 명령이 비었거나, `--exempt`의 사유가 비었거나, 둘을 함께 줬거나, 계획 브랜치가 아니면 2다.
   - 도움말에 두 줄을 더한다.

3. 테스트 `scripts/test/fail-first.test.ts`(임시 git 리포에 `new-task`로 만든 계획 worktree. `scripts/test/helpers.ts`를 쓴다)
   - 단언에서 실패하는 테스트 명령은 기록되고 CLI가 0이다. 기록에 명령·종료 코드·단언 실패 줄·HEAD가 있다.
   - 통과하는 명령, 없는 모듈을 import하는 테스트, 시간 제한을 넘긴 명령은 기록되지 않고 CLI가 1이다. 이유 문구가 서로 다르다. 시간 제한은 임시 리포 설정의 `limits.acTimeoutSec`을 1~2초로 낮춰 확인한다(`makeFixture`의 설정 인자).
   - `--exempt "<사유>"`는 `kind: 'exempt'` 기록을 남긴다. 빈 사유, 빈 명령, 계획 브랜치가 아닌 곳은 2다.
   - `readFailFirst`는 다른 계획·다른 step의 기록과 깨진 줄을 돌려주지 않는다.
   - `isTestFile`: `scripts/test/a.test.ts`, `src/foo.spec.js`, `pkg/foo_test.go`, `tests/test_foo.py`, `src/__tests__/a.ts`는 참이고 `scripts/commands/task.ts`, `docs/latest.md`, `src/contest/a.ts`는 거짓이다.

4. 문서: 코드 구조 문서(`scripts/commands/` 표나 목록에 한 줄), `CHANGELOG` 한 줄. 규칙 문서(설계서 R5 행, 절차서)는 step1에서 고친다.

## Acceptance Criteria

```bash
node --test scripts/test/fail-first.test.ts
grep -q "export async function failFirst" scripts/commands/fail-first.ts
grep -q "fail-first" docs/harness/CHANGELOG.md
```

## 금지사항

- 기록을 계획 파일·`index.json`·PR 본문에 쓰지 마라. 이유: 손으로 쓸 수 있는 자리에 두면 다시 문장으로 대체된다. 계획에 옮기는 일은 step1의 `complete-step`이 한다.
- 종료 코드가 0이 아니라는 것만으로 기록하지 마라. 이유: 모듈을 찾지 못한 실패는 테스트의 단언이 동작을 검증한다는 근거가 아니다.
- `complete-step`·runner를 이 step에서 고치지 마라. 이유: 검사 연결은 step1이다. 이 step이 병합된 뒤에도 기존 흐름이 그대로 돌아야 한다.
- `harness.config.json`과 프로파일에 새 키를 더하지 마라. 이유: 계획의 비범위다(판정 관련 설정 변경은 `harness-guard` 신호다).
