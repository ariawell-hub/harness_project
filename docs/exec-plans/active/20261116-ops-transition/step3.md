# Step 3: selftest-core

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-transition/plan.md` (수용 기준 4, 의사결정 로그의 자체 테스트 결정 세 건)
- `docs/harness/design.md` 12.4절, 13.1절(훅 구현 규칙: 종료 코드 2), 5.1절 규칙 표(R1, R4, R13, R20), 4.5절(다음 할 일)
- `scripts/test/helpers.ts`(`makeFixture`, `fixtureConfig`, `gitInit`), `scripts/test/guard.test.ts`, `scripts/test/plan-gate.test.ts`, `scripts/test/start.test.ts`
- `scripts/hooks/guard.ts`(stdin JSON 형식, 종료 코드), `scripts/lib/github-fake.ts`(`HARNESS_FAKE_GH` 상태 파일 형식)
- `scripts/harness.ts`(명령 등록 방식), `scripts/commands/check.ts`

## 작업

1. `scripts/selftest/run.ts`

   ```ts
   export interface Scenario {
     /** 파일 이름과 같은 kebab-case id. 예) r20-owner-commands */
     id: string;
     /** 12.4절의 어느 항목인가. 예) 'R20' */
     covers: string;
     title: string;
     run(ctx: ScenarioContext): Promise<void> | void; // 어긋나면 예외(assert)
   }
   export interface ScenarioContext {
     /** 시험 대상 하네스의 루트(절대 경로) */
     harness: string;
     /** 대상 하네스를 적용한 임시 샘플 리포(main 체크아웃 + 로컬 bare 원격 + 가짜 GitHub 상태 파일)를 새로 만든다 */
     sample(o?: { config?: Record<string, unknown> }): Sample;
     /** 대상 하네스의 CLI를 샘플 리포에서 실행한다. 종료 코드·stdout·stderr를 돌려준다(예외를 던지지 않는다) */
     cli(s: Sample, args: string[], o?: { cwd?: string; env?: NodeJS.ProcessEnv }): Ran;
     /** 대상 하네스의 L1 훅(scripts/hooks/guard.ts)에 도구 호출 JSON을 stdin으로 넣는다 */
     hook(s: Sample, payload: Record<string, unknown>, o?: { cwd?: string }): Ran;
   }
   export interface SelfTestReport {
     version: 1;
     /** --head-sha로 받은 값(없으면 '') */
     headSha: string;
     results: { id: string; covers: string; state: 'pass' | 'fail' | 'error'; detail: string }[];
   }
   export async function runSelfTest(o: {
     harness: string;
     only?: string[];
     headSha?: string;
   }): Promise<SelfTestReport>;
   ```

   - 시나리오는 실행기와 같은 폴더의 `scenarios/*.ts`를 파일 이름순으로 찾아 읽는다(목록 파일을 두지 않는다. 새 시나리오는 파일 추가만으로 들어간다).
   - 시나리오 하나가 예외로 끝나면 `fail`(assert 실패) 또는 `error`(그 밖)이고 나머지는 계속 실행한다. `detail`은 한 줄 500자 이내다.
   - 샘플 리포에는 대상 하네스의 `scripts/`, `.claude/`, `harness.config.json`, `AGENTS.md`, `CLAUDE.md`, 계획 템플릿과 `docs/` 최소 골격을 복사한다. 의존성 설치(`pnpm install`)는 하지 않는다. 임시 폴더는 지우지 않는다(R14).
   - 자식 프로세스에는 시간 제한을 두고(시나리오당 기본 120초), 환경 변수는 필요한 것만 넘긴다(`GH_TOKEN` 등 세션의 자격증명을 넘기지 않는다).

2. 시나리오(`scripts/selftest/scenarios/`). 모두 대상 하네스의 CLI·훅 프로세스만 부른다.
   - `s1-next-task.ts`(S1): 가짜 GitHub에 제작자 Issue 둘(하나는 `claim/<N>`이 원격에 있음)과 봇이 만든 Issue 하나. `next --json`이 선점되지 않은 제작자 Issue를 고른다. `start` 출력의 "다음 할 일"에 그 번호가 있다.
   - `r1-plan-gate.ts`(R1): 계획 없이 코드를 바꾼 브랜치에서 `plan-gate`가 종료 코드 0이 아니다. 계획이 있는 브랜치는 0이다. 훅: 계획 없는 worktree에서 코드 파일 `Edit`가 종료 코드 2다.
   - `r4-bypass.ts`(R4): 테스트에 `.skip`을 더한 커밋에서 `bypass-scan`이 0이 아니다. 훅: `git commit --no-verify`, `check` 뒤 파이프(`node scripts/harness.ts check | tail -1`)가 종료 코드 2다.
   - `r13-db.ts`(R13): 설정 `guard.dbPatterns`·`dbClients`를 준 샘플에서 스키마 파괴·데이터 삭제 명령(설계서 14.3절의 예 가운데 셋 이상)이 훅에서 종료 코드 2다. 같은 클라이언트의 읽기 명령은 0이다.
   - `r20-owner-commands.ts`(R20): `gh pr review --approve`, `gh auth switch`·`gh auth login`, 브랜치 보호를 바꾸는 `gh api -X PUT …/protection`, `GH_TOKEN=…`을 앞에 붙인 명령이 훅에서 종료 코드 2다(1이 아니라 정확히 2). `gh pr view`는 0이다.
   - 각 시나리오는 "막힌다"와 함께 대조군("막히지 않아야 하는 것은 통과한다")을 하나 이상 확인한다.

3. `scripts/harness.ts`: `self-test [--harness <폴더>] [--only <id,id>] [--out <파일>] [--head-sha <sha>]`. `--harness`가 없으면 이 리포다. 시나리오별 한 줄(`✓`/`✗` id — detail)을 출력하고, `--out`에 보고서 JSON을 쓴다. `fail`·`error`가 하나라도 있으면 종료 코드 1이다. 도움말에 더한다.

4. 테스트(새 파일 `scripts/test/selftest.test.ts`)
   - 이 리포(`HARNESS_ROOT`)에 대해 `runSelfTest`가 모든 시나리오 `pass`다(이 테스트가 `check`의 `test` 단계에서 돌아 Linux CI에서도 확인된다).
   - 약화된 하네스에서는 실패한다: 대상 하네스를 임시 폴더에 복사해 훅의 종료 코드를 1로 바꾼 사본, `plan-gate`가 항상 통과하게 바꾼 사본에서 해당 시나리오가 `fail`이고 CLI 종료 코드가 1이다.
   - 시나리오 하나가 예외를 던져도 나머지가 실행된다. `--only`.

5. 문서: 설계서 12.4절(두 층 구성, 시나리오 표, 실행 방법), `architecture.md`(레이어·테스트 절에 `scripts/selftest/`), `AGENTS.md` 표준 명령 표 아래 한 줄 또는 절차서 4절, `CHANGELOG`, 설계서 버전·변경 이력. `tsconfig.json`의 검사 범위에 `scripts/selftest/`가 들어가는지 확인한다.

## Acceptance Criteria

```bash
node --test scripts/test/selftest.test.ts
node scripts/harness.ts self-test --only s1-next-task,r1-plan-gate,r4-bypass,r13-db,r20-owner-commands
grep -q "export async function runSelfTest" scripts/selftest/run.ts
! grep -rnE "from '\.\./\.\./(lib|gates|hooks|commands|runner|ci)/" scripts/selftest/scenarios
```

## 금지사항

- 시나리오에서 대상 하네스의 내부 모듈(`scripts/lib/` 등)을 import하지 마라. 이유: step6에서 main의 시나리오가 PR의 하네스를 시험한다. 시나리오가 기대는 것은 CLI와 훅 프로세스의 입출력뿐이어야 한다.
- 시나리오 목록을 파일 하나에 모아 적지 마라. 이유: 새 시나리오를 더할 때 기존 파일을 고치게 되고, step6의 "기존 자체 테스트 파일 변경" 신호에 걸린다.
- 샘플 리포를 만들 때 세션의 `GH_TOKEN`·`.env`·홈의 도구 설정을 넘기거나 복사하지 마라. 이유: step6에서 이 실행기는 PR 코드를 실행한다. 자격증명이 닿으면 안 된다(R10, 10.4절).
- 실제 GitHub·네트워크를 부르지 마라. 이유: CI의 비밀 없는 job에서 결정적으로 돌아야 한다.
- 훅 차단을 "0이 아닌 종료 코드"로 확인하지 마라. 이유: Claude Code는 종료 코드 2만 차단으로 본다(13.1절). 1은 경고만 하고 통과시킨다.
