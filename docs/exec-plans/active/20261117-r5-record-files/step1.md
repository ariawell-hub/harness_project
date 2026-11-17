# Step 1: record-files

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-record-files/plan.md` (수용 기준 2~5, 의사결정 로그의 "파일 경로만 받는다" 결정, 발견 사항)
- 되돌리기 전의 구현(참고용. 판정·기록 형식은 대부분 그대로 쓴다): `git show c5126bd:scripts/commands/fail-first.ts`, `git show c5126bd:scripts/test/fail-first.test.ts`
- `scripts/commands/task.ts`(`TaskError`, 브랜치에서 계획·step을 정하는 방법), `scripts/lib/git.ts`(`repoInfo`, `harnessStateDir`), `scripts/lib/attempts.ts`(상태 폴더의 jsonl 기록 방식), `scripts/lib/exec.ts`(`run`: 셸 없이 프로세스를 띄운다), `scripts/lib/config.ts`(`ci.repro`, `limits.acTimeoutSec`), `scripts/lib/util.ts`(`globToRegExp`)
- `scripts/ci/repro.ts`(재현 job이 `ci.repro.command` 뒤에 파일 경로를 붙여 실행하는 방법)
- `scripts/harness.ts`(명령 등록, 도움말, 옵션 표)

## 작업

1. `scripts/commands/fail-first.ts`

   ```ts
   export interface FailFirstRecord {
     ts: string; // ISO 시각
     plan: string;
     step: number | null; // 소규모 계획은 null
     kind: 'fail' | 'exempt';
     /** kind가 fail일 때: 실행한 테스트 파일 하나(리포 루트 기준), 종료 코드. 테스트 출력의 내용은 담지 않는다 */
     file?: string;
     code?: number;
     /** kind가 exempt일 때: 사유 */
     reason?: string;
     head: string; // 기록 시점의 HEAD
   }
   /** 테스트 파일인가(리포 루트 기준 경로). 기본 glob: `**/*.test.*`, `**/*.spec.*`, `**/*_test.*`, `**/test_*.*`, `**/test/**`, `**/tests/**`, `**/__tests__/**` */
   export function isTestFile(file: string): boolean;
   /** 이 worktree의 기록 가운데 그 계획·step의 것(쓴 순서) */
   export function readFailFirst(info: RepoInfo, plan: string, step: number | null): FailFirstRecord[];
   /** 테스트 파일 하나를 실행해 단언 실패면 기록한다. 기록하지 못하면 FailFirstError(이유) */
   export async function failFirst(cwd: string, file: string): Promise<FailFirstRecord>;
   /** 실행 없이 예외를 기록한다 */
   export function exemptFailFirst(cwd: string, reason: string): FailFirstRecord;
   ```

   - 계획·step은 현재 브랜치에서 정한다(`complete-step`과 같은 방법). 계획 브랜치가 아니면 쓸 수 없는 호출이다.
   - **인자 검사(실행 전)**: 파일은 정확히 하나다. 여러 파일을 한 프로세스로 실행하면 그 가운데 어느 파일이 단언에서 실패했는지 알 수 없어, 통과한 파일까지 기록으로 인정된다(PR #114 원장 F5). 파일마다 명령을 따로 실행한다. 인자는 worktree 루트 기준 상대 경로로 정규화했을 때 worktree 안에 있고(`..`로 벗어나지 않는다, 절대 경로가 아니다), `-`로 시작하지 않고, 실제로 있는 일반 파일이고, `isTestFile`이어야 한다. 심볼릭 링크는 실제 대상(realpath)으로 풀어 다시 본다: 실제 경로가 worktree의 실제 루트 밖이면(파일 자신이 링크이거나 경로 중간의 폴더가 링크) 받지 않는다. 하나라도 어긋나면 아무것도 실행하지 않는다.
   - **실행**: `ci.repro.command`(문자열 배열)의 첫 값을 실행 파일로, 나머지 값과 그 파일 경로를 인자로 넘겨 `run`으로 띄운다. 셸 옵션을 쓰지 않는다(`runShell`, `shell: true`, `sh -c` 금지). 작업 폴더는 worktree 루트, 시간 제한은 `limits.acTimeoutSec`이다(`ci.repro.timeoutSec`은 CI 재현 job의 값이라 쓰지 않는다. 이 리포의 테스트 파일은 하나가 그 값보다 오래 걸린다). `ci.repro`가 null이면 쓸 수 없는 호출이다(고치는 법: 설정에 `ci.repro`를 두거나 `--exempt`로 사유를 남긴다).
   - **판정**: 종료 코드가 0이 아니고, 시간 초과가 아니고, 출력(stdout + stderr)에 `ci.repro.failPattern`이 보이면 기록한다. 기록하지 않는 경우마다 이유가 다르다: "테스트가 통과했다(종료 코드 0)", "시간 제한을 넘겼다", "단언 실패가 아니다(모듈을 찾지 못함·문법 오류 등. 테스트가 실행돼 단언에서 실패해야 한다)".
   - 기록 파일은 `harnessStateDir(info, 'worktree')`의 `fail-first.jsonl`이다. 한 줄에 기록 하나를 덧붙인다. 깨진 줄은 읽을 때 건너뛴다.
   - **테스트 출력을 저장하지 않는다**: 출력은 판정(단언 실패 정규식이 보이는가)에만 쓰고, 그 내용(단언 실패 줄 포함)이나 해시를 기록 파일에 넣지 않는다. 단언 메시지에 환경 변수나 파일에서 읽은 시크릿이 섞일 수 있고, 기록은 step2에서 계획 파일(커밋·PR에 드러난다)로 옮겨진다.
   - 사유는 한 줄로 만들고(줄바꿈을 공백으로) 500자에서 자른다.

2. `scripts/harness.ts`: `fail-first <테스트 파일>`과 `fail-first --exempt "<사유>"`.
   - 기록하면 `fail-first: 기록했다 — <파일> → 종료 코드 <N>, 단언 실패`를 출력하고 0으로 끝난다(테스트 출력은 stdout에 옮기지 않는다). 예외는 `fail-first: 예외를 기록했다 — <사유>`.
   - 실행했지만 기록하지 못하면 이유와 실행 출력의 끝 40줄을 stderr로 내고 1로 끝난다.
   - 쓸 수 없는 호출(파일 없음, 파일이 둘 이상, 인자 검사 실패, 빈 사유, 파일과 `--exempt`를 함께 줌, 계획 브랜치가 아님, `ci.repro` 없음)은 이유를 내고 2로 끝난다.
   - 도움말에 두 줄을 더한다. "명령을 받지 않고 테스트 파일만 받는다"를 적는다.

3. 테스트 `scripts/test/fail-first.test.ts`(임시 git 리포에 `new-task`로 만든 계획 worktree. `scripts/test/helpers.ts`를 쓴다. 임시 리포 설정에 `ci.repro`를 넣는다: `command: ['node', '--test']`)
   - 이 테스트 파일은 `node --test` 안에서 돈다. CLI를 띄울 때 환경 변수 `NODE_TEST_CONTEXT`를 뺀다(넘어가면 안쪽 `node --test`가 파일을 실행하지 않고 0으로 끝난다).
   - 단언에서 실패하는 테스트 파일은 기록되고 CLI가 0이다. 기록에 파일·종료 코드·HEAD가 있다.
   - 파일을 둘 이상 주면 아무것도 실행하지 않고 2다(실패하는 파일과 통과하는 파일을 함께 줘도 기록이 생기지 않는다).
   - **테스트 출력이 새지 않는다**: 단언 메시지에 표시 문자열(예: `SECRET_MARKER_…`)을 넣은 실패 테스트를 기록한 뒤, 기록 파일(`fail-first.jsonl`)과 CLI의 stdout에 그 문자열이 없다.
   - 통과하는 테스트 파일, 없는 모듈을 import하는 테스트 파일, 시간 제한을 넘긴 테스트 파일은 기록되지 않고 CLI가 1이다. 이유 문구가 서로 다르다. 시간 제한은 임시 리포 설정의 `limits.acTimeoutSec`을 1~2초로 낮춰 확인한다(`makeFixture`의 설정 인자).
   - **셸을 거치지 않는다**: 인자 `"node --test t/fail.test.mjs; touch pwned"`, `"gh pr review 1 --approve"`, `"t/fail.test.mjs; touch pwned"`, `"$(touch pwned).test.mjs"`는 2로 끝나고 worktree에 `pwned`가 생기지 않는다. 이름에 `;`와 공백이 든 실제 테스트 파일(예: `t/a; touch pwned.test.mjs`)은 파일로 실행되고 `pwned`가 생기지 않는다.
   - **옵션 주입을 받지 않는다**: `-`로 시작하는 인자(`--import=./t/evil.test.mjs`, `-r`), 절대 경로, `../` 로 벗어나는 경로, 없는 파일, 테스트 파일이 아닌 경로(`scripts/harness.ts`), 디렉터리는 2다.
   - **심볼릭 링크로 벗어나지 못한다**: worktree 안의 `t/link.test.mjs`가 worktree 밖 파일을 가리키는 심볼릭 링크이거나, worktree 밖 폴더를 가리키는 링크 폴더 아래의 테스트 파일이면 2이고 그 파일은 실행되지 않는다(밖의 파일이 실행되면 표시 파일을 만들게 해 두고 생기지 않음을 확인한다). worktree 안의 다른 테스트 파일을 가리키는 링크는 실행된다. 심볼릭 링크를 만들 수 없는 환경(개발자 모드가 꺼진 Windows, ADR-0005)에서는 이 테스트만 건너뛴다.
   - `ci.repro`가 없는 설정에서는 2이고 고치는 법이 나온다.
   - `--exempt "<사유>"`는 `kind: 'exempt'` 기록을 남긴다. 빈 사유, 인자 없음, 파일과 함께 준 호출, 계획 브랜치가 아닌 곳은 2다.
   - `readFailFirst`는 다른 계획·다른 step의 기록과 깨진 줄을 돌려주지 않는다.
   - `isTestFile`: `scripts/test/a.test.ts`, `src/foo.spec.js`, `pkg/foo_test.go`, `tests/test_foo.py`, `src/__tests__/a.ts`는 참이고 `scripts/commands/task.ts`, `docs/latest.md`, `src/contest/a.ts`는 거짓이다.

4. 문서: 코드 구조 문서(`scripts/commands/` 목록에 한 줄, 테스트 절의 `NODE_TEST_CONTEXT` 문장에 파일 이름), `CHANGELOG` 한 줄(다시 만든 명령은 "테스트 파일만 받는다", 셸을 거치지 않는다, 테스트 출력을 저장하지 않는다). 규칙 문서(설계서 R5 행, 절차서)는 step2에서 고친다.

## Acceptance Criteria

```bash
node --test scripts/test/fail-first.test.ts
grep -q "export async function failFirst" scripts/commands/fail-first.ts
! grep -Eq "runShell|shell: *true" scripts/commands/fail-first.ts
grep -q "테스트 파일만 받" docs/harness/CHANGELOG.md
! grep -Eq "matched|outputSha" scripts/commands/fail-first.ts
node scripts/harness.ts doc-lint
```

## 금지사항

- 인자를 셸로 실행하지 마라(`runShell`, `shell: true`, `sh -c`, `bash -c`, 문자열을 이어 붙인 명령줄). 이유: 옛 계획 step0의 명령(PR #112)이 그렇게 해서 L1 훅의 우회로가 됐다. 훅은 하네스 명령의 인자 안에 든 명령을 판정하지 않는다.
- 문자열 경로만 보고 worktree 안이라고 판단하지 마라. 이유: 심볼릭 링크가 worktree 밖 파일을 가리킬 수 있다(PR #113 원장 F2). 실제 경로로 확인한다.
- 테스트 파일이 아닌 인자를 실행 명령에 넘기지 마라. 이유: `-`로 시작하는 값은 실행기의 옵션으로 해석된다(`--import`, `--require`로 임의 코드를 끼운다).
- 테스트 출력의 내용(단언 실패 줄, 출력 일부, 출력의 해시)을 기록 파일이나 stdout에 옮기지 마라. 이유: 단언 메시지에 시크릿이 섞일 수 있다(PR #114 원장 F3, R10). 기록하지 못했을 때 stderr로 보이는 출력 끝 40줄은 그 자리에서 고치라고 보여 주는 것이고 저장하지 않는다.
- 기록을 계획 파일·`index.json`·PR 본문에 쓰지 마라. 이유: 손으로 쓸 수 있는 자리에 두면 다시 문장으로 대체된다. 계획에 옮기는 일은 step2의 `complete-step`이 한다.
- 종료 코드가 0이 아니라는 것만으로 기록하지 마라. 이유: 모듈을 찾지 못한 실패는 테스트의 단언이 동작을 검증한다는 근거가 아니다.
- `complete-step`·runner·L1 훅을 이 step에서 고치지 마라. 이유: 검사 연결은 step2이고 훅은 비범위다. 이 step이 병합된 뒤에도 기존 흐름이 그대로 돌아야 한다.
- `harness.config.json`과 프로파일에 새 키를 더하지 마라. 이유: 계획의 비범위다(판정 관련 설정 변경은 `harness-guard` 신호다).
