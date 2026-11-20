# Step 2: steady-local

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`("상태가 사는 곳")
- `docs/harness/design.md` 17.2절(상시 지표), 12.4절(자체 테스트), 7.2절("검토 필요" 문서)
- `docs/QUALITY_SCORE.md`, `docs/exec-plans/tech-debt-tracker.md`
- step0·step1이 만든 파일: `scripts/metrics/source.ts`, `scripts/metrics/pilot.ts`, `scripts/metrics/steady.ts`, `scripts/metrics/render.ts`, `scripts/commands/metrics.ts`, `scripts/test/metrics-*.test.ts`
- `scripts/lib/plan.ts`(`parseDoc`, `section`, `PLANS_DIR`), `scripts/lib/git.ts`(`harnessStateDir`), `scripts/gates/doc-lint.ts`(`docLint`, 경고 `R8 검토 필요`), `scripts/runner/run.ts`(`event` 함수와 이벤트 이름, `StopReason`), `scripts/selftest/run.ts`(보고서 형식), `docs/harness/workflow.md` 4절(발견 사항 처리 표기)·6절(방법 전환 표기)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 로컬 자료 `scripts/metrics/local.ts`

```ts
export interface LocalInput {
  root: string;
  cfg: HarnessConfig;
  period: Period;
  runnerLog: string | null;
  selfTestReport: string | null;
}
export function localMetrics(i: LocalInput): LocalMetrics;
```

파일만 읽는다(네트워크·GitHub을 쓰지 않는다). 정의:

- **대상 계획**: `root`의 `docs/exec-plans/active/`와 `completed/`에 있는 계획 가운데 id의 날짜(`YYYYMMDD`)가 기간 안인 것. 단일 파일 계획과 폴더 계획(`plan.md`)을 모두 본다. id의 날짜는 시간대 보정 없이 기간의 날짜와 그대로 견준다.
- **3회 방법 전환 횟수**: 대상 계획의 "의사결정 로그" 섹션에서 `- 방법 전환(`으로 시작하는 줄의 수(절차서 6절의 형식). 계획 id별 수도 낸다.
- **발견 사항의 처리 분포**: 대상 계획의 "발견 사항" 섹션의 목록 항목(`- `로 시작)마다 `→ 처리:` 뒤를 본다. 마크다운 링크가 있으면 "문서 반영", `#숫자`나 `TD-숫자`가 있으면 "Issue·TD", `해당 없음`이면 "해당 없음", `→ 처리:`가 없으면 "처리 표기 없음". 한 항목에 여럿이면 문서 반영 → Issue·TD → 해당 없음 순서로 먼저 맞는 것 하나로 센다.
- **"검토 필요" 문서 수**: `docLint(root, cfg)`의 경고 가운데 `rule`이 `R8 검토 필요`인 수. 기간과 무관한 현재 값이다.
- **runner 연속 실행 시간과 멈춘 이유**: `runnerLog`(`$(git rev-parse --git-common-dir)/harness/runner.jsonl`, 한 줄에 JSON 하나)에서 작업자(`worker`)별로 `start` 이벤트와 그 뒤 첫 `exit` 이벤트를 한 번의 실행으로 묶는다. `start`의 시각이 기간 안인 실행의 수, 실행 시간의 중앙값·최댓값(분), `exit`의 `reason`별 수. `exit` 없이 다음 `start`가 오거나 로그가 끝난 실행은 "종료 기록 없음"으로 세고 시간에서 뺀다.
- **step당 세션 수·재시도 수**: 기간 안의 `session-start` 이벤트를 `plan`과 `step`으로 묶은 묶음마다의 세션 수의 중앙값·최댓값, `attempt`가 2 이상인 `session-start`의 수.
- **"세션은 완료라 했지만 AC 실패" 횟수**: 기간 안의 `judge-fail` 이벤트를 `detail`로 가른다. runner는 AC가 모두 통과해도 뒤따르는 `check`가 실패하면 같은 이벤트를 쓰고, `detail`은 runner가 만드는 `AC <수>개, check 실패: <하위 검사 이름들 | 없음>` 꼴이다.
  - `check 실패: 없음`이면 "AC 실패 확인"이다(표준 검사는 통과했으니 AC가 실패한 것이다).
  - `check 실패:` 뒤에 이름이 있으면 "AC 결과 미확인"이다. 표준 검사가 실패했고, AC가 함께 실패했는지는 이 로그로 가를 수 없다.
  - 지표 값은 범위로 낸다: AC 실패는 "확인" 수 이상, "확인 + 미확인" 수 이하다. 정확한 수를 낼 수 없는 이유(runner가 `judge-fail`에 AC 결과를 따로 남기지 않는다)와 TD 번호를 같은 줄에 적는다(새 TD).
  - `detail`이 이 꼴이 아니면 "그 밖"이다.
  - 세 수를 모두 낸다. `detail`은 가르는 데만 쓰고 결과에 옮기지 않는다.
- **발산 감지 횟수**: 기간 안의 `review-diverged`·`review-reverted` 이벤트 수.
- **하네스 자체 테스트 통과율**: `selfTestReport`(`self-test --out <파일>`이 쓴 JSON)의 `results` 가운데 `state`가 `pass`인 수 ÷ 전체. 파일을 주지 않았으면 값 대신 "보고서 없음(`self-test --out`으로 만든다)".
- runner 로그가 없으면(`runnerLog`가 null이거나 파일이 없다) runner 지표는 값 대신 "이 머신에 runner 로그 없음"이다. 깨진 줄은 건너뛰고 그 수를 낸다. runner 지표는 명령을 실행한 머신의 로그만 본다는 것을 결과에 적는다.

### 2. 잴 수 없는 지표

`renderBlock`이 아래의 앞 네 항목을 값 대신 이유와 TD 번호로 낸다(17.2절의 상시 지표 항목마다 한 줄이 있게 한다). 다섯째 항목은 범위와 함께 이유와 TD 번호를 낸다.

- PR 크기 경고·범위 이탈 경고 수(R15, R18): 게이트가 없다(TD-6). PR 크기는 step1의 "400줄을 넘는 PR 수"로 대신 본다.
- 위험 작업·제작자 권한 명령 차단 횟수(R13, R14, R20): L1 훅이 차단을 기록하지 않는다(새 TD).
- 구독 한도 때문에 검증이 보류된 횟수(Q12): 한도와 그 밖의 검증자 장애를 가르는 기록이 없다(새 TD). step0의 "실패로 끝난 판정 워크플로 실행 수"로 대신 본다.
- 실패 키별 3회·5회 횟수: 실패 기록(`attempts.jsonl`)이 worktree와 함께 지워져 키별로 셀 수 없다(새 TD). 횟수는 계획의 방법 전환 줄과 중단 보고 댓글로 센다.
- "세션은 완료라 했지만 AC 실패"의 정확한 수: 위 1번의 범위로 낸다(새 TD).

### 3. 연결, 옵션, 문서

- `runMetrics`가 `localMetrics`를 불러 `### 상시 지표` 절에 더한다. runner 로그 경로는 `harnessStateDir(info, 'common')`의 `runner.jsonl`이다.
- 자체 테스트 보고서 경로는 `metrics --self-test-report <파일>`로 받는다. `scripts/harness.ts`에는 `OPTIONS`의 `self-test-report`, `HELP` 한 줄, `case 'metrics'`의 인자 전달만 더한다. 파일이 없거나 형식이 다르면 종료 코드 1(GitHub을 읽기 전에 끝낸다).
- `docs/QUALITY_SCORE.md`의 "측정 정의"에 이 step의 지표와 잴 수 없는 지표를 더하고, 이 리포에서 `self-test --out <임시 파일>` 뒤 `metrics --since 2026-11-11 --until <작업일(UTC)> --self-test-report <임시 파일>`을 실행하고 출력을 표식 구간에 그대로 붙여 넣어 기록한다.
- 기술 부채 표: 위 "새 TD" 넷을 등록한다(번호는 push 직전 `origin/main`의 마지막 번호 다음부터). TD-11에 "주 1회 실행 때 `self-test --out`과 `metrics`를 함께 돌리고, 출력을 문서에 기록하는 수단을 그 정기 작업에서 만든다"를 적는다.
- `docs/harness/architecture.md`의 `metrics/*` 행, `docs/harness/CHANGELOG.md`를 고친다. 설계서 17.2절에 잴 수 없는 지표가 `docs/QUALITY_SCORE.md`에 이유와 함께 표시된다는 한 문장을 더하고 버전을 올린다.
- 이 step의 PR은 보호 경로(`scripts/**`, `docs/harness/**`)를 바꾼다. 운영 단계에서는 계획의 `risk`와 무관하게 `risk-gate`가 위험도 높음으로 판정하고 제작자 승인이 있어야 병합된다(절차서 5절 "운영 단계의 보호 경로 PR"). 초안으로 올리고, 완료 처리·`origin/main` 병합·`check`가 끝난 뒤 `pr-ready`로 승인을 한 번 요청한다.

### 4. 테스트 `scripts/test/metrics-local.test.ts`(새 파일)

- 임시 폴더에 계획 파일과 runner 로그를 만들어 `localMetrics`의 값마다 단언한다: `judge-fail`의 세 갈래(AC 실패 확인, AC 결과 미확인, 꼴이 다른 `detail`)와 지표의 범위(최소·최대), 기간 밖 계획 제외, 방법 전환 줄 수, 처리 분포의 네 갈래와 우선순위, `exit` 없는 실행, 작업자가 둘인 로그, 깨진 줄, 로그 없음, 보고서 있음·없음.
- `renderBlock`: 잴 수 없는 지표 넷이 이유와 TD 번호로 나오고, AC 실패 지표는 범위와 이유·TD 번호로 나온다. 17.2절 상시 지표 13항목 각각에 대응하는 줄이 있다(항목 이름 목록을 테스트에 고정한다).
- `runMetrics`: `--self-test-report`가 없는 파일이면 종료 코드 1이고 자료를 읽지 않는다.
- 명령 경로의 연결(`scripts/test/metrics-command.test.ts`에 더한다. 임시 리포와 메모리 `MetricsSource`로 `runMetrics`를 부르고 출력을 본다): 임시 리포의 공유 git-dir(`harnessStateDir(info, 'common')`)에 `runner.jsonl`을 두면 출력에 그 로그로 센 runner 실행 수가 나오고 파일이 없으면 "이 머신에 runner 로그 없음"이 나온다, 임시 리포의 계획 파일에 `- 방법 전환(` 줄을 하나 더하면 출력의 방법 전환 횟수가 1 늘어난다, `--self-test-report`로 준 보고서의 통과 수와 전체 수가 출력에 나온다.
- 이 리포의 `docs/QUALITY_SCORE.md` 표식 구간 안에 17.2절 상시 지표 13항목 각각에 대응하는 줄이 있다.

## Acceptance Criteria

```bash
node --test scripts/test/metrics-pilot.test.ts scripts/test/metrics-command.test.ts scripts/test/metrics-steady.test.ts scripts/test/metrics-local.test.ts
grep -q "^집계 기간: 2026-11-11 ~ $(date -u +%Y-%m-%d)(UTC) · 병합 PR [0-9][0-9]*개$" docs/QUALITY_SCORE.md
```

둘째 명령은 문서의 집계 기간이 2026-11-11부터 AC를 실행하는 날(UTC)까지인지 본다. 날짜가 바뀐 뒤에 완료 처리하게 되면 집계를 다시 실행한다.

## 금지사항

- L1 훅(`scripts/hooks/`), runner(`scripts/runner/`), 실패 기록(`scripts/lib/attempts.ts`)을 고쳐 기록을 더하지 마라. 이유: 이 계획의 비범위다. 잴 수 없는 지표는 TD로 남긴다.
- `metrics` 명령 안에서 `self-test`를 실행하지 마라. 이유: 몇 분이 걸리고 샘플 리포를 만든다. 집계는 읽기만 한다. 보고서 파일을 받는다.
- runner 로그의 `detail`·`reason` 같은 자유 문자열을 결과에 옮기지 마라(`exit`의 `reason`은 `StopReason`의 정해진 값일 때만 그 이름으로 세고, 아니면 "그 밖"으로 센다). 이유: 세션 출력이 섞인 문자열이다(14.6절).
- 계획 파일의 발견 사항·의사결정 로그 문장을 결과에 옮기지 마라. 이유: 수와 계획 id만 적는다.
- step0·step1의 지표 정의와 값을 바꾸지 마라. 이유: 이미 기록된 값과 비교할 수 없게 된다.
- `scripts/harness.ts`에서 `metrics` 등록 밖을 고치지 마라. `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`를 고치지 마라. 이유: 다른 세션의 작업과 겹친다.
- 다른 세션(Issue #140)이 맡은 경로(`scripts/verify/**`, `scripts/commands/standard.ts`, `profiles/web/**`, `lab/pilot-prep/**`, `.claude/skills/web-verify/`, `.gitignore`, 설계서 11.1절, `workflow.md` 4절, 기술 부채 표 TD-12 행, `architecture.md`의 `verify/*`·`commands/standard.ts` 행)를 고치지 마라. 이유: 세션 간 합의.
