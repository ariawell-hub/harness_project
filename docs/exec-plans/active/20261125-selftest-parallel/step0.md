# Step 0: parallel

## 읽어야 할 파일

- 이 계획의 `plan.md`(목표와 수용 기준, 의사결정 로그)
- `scripts/selftest/run.ts`(실행기: `runSelfTest`, `context`, `exec`, `load`)
- `scripts/selftest/scenarios/*.ts`(읽기만. `timeoutSec`를 가진 셋과 `r45-runner`의 세션 시간 제한)
- `scripts/test/selftest.test.ts`(기존 테스트와 시험용 시나리오 폴더·`echoHarness` 도우미)
- `scripts/harness.ts`의 `self-test` 처리와 도움말
- `scripts/ci/selftest-result.ts`(읽기만. 보고서를 어떻게 검사하는가)
- `.github/workflows/gates.yml`의 `selftest` job(읽기만. CLI를 어떻게 부르는가)
- `docs/harness/design.md` 12.4절, `docs/harness/architecture.md`의 `scripts/selftest/` 문단

## 작업

### 1. 실행기 (`scripts/selftest/run.ts`)

- 시나리오 하나를 돌리는 부분(지금 `runSelfTest`의 반복문 본문: 불러오기, `context`, `run`, `close`, `pass`/`fail`/`error` 판정)을 함수 하나로 뺀다. 차례로 돌 때와 자식 프로세스가 같은 함수를 쓴다.
- `runSelfTest`에 `jobs?: number`를 더한다. 기본값은 `os.availableParallelism()`이고 돌릴 시나리오 수를 넘지 않는다. 1 이상의 정수가 아니면 예외를 던진다.
- 동시 수가 1이면 지금처럼 실행기 프로세스 안에서 파일 이름순으로 하나씩 돈다(다시 돌리기 없음).
- 동시 수가 2 이상이면:
  - 실행기 프로세스에서 시나리오 파일을 모두 불러(`load`) 시간 제한을 읽는다. 불러오지 못한 시나리오는 지금처럼 `error`다(자식을 띄우지 않는다).
  - `timeoutSec`가 큰 것부터(같으면 파일 이름순) 동시 수만큼 자식 프로세스를 띄운다. 하나가 끝나면 다음 것을 띄운다.
  - 자식은 `process.execPath`로 `scripts/selftest/child.ts <대상 하네스> <시나리오 파일> <결과 파일>`을 띄운다. 환경 변수는 실행기의 것을 그대로 넘긴다(샘플 리포의 자식 프로세스에 넘기는 환경은 지금처럼 `makeSample`이 거른다). 결과 파일은 `mkdtempSync`로 만든 임시 폴더 안에 둔다(지우지 않는다).
  - 자식이 끝나면 결과 파일을 읽는다. 결과 파일이 없거나 형식이 틀리거나 `id`가 다르면 `error`다(`detail`에 종료 코드와 stderr의 끝을 한 줄로).
  - 자식을 띄운 때부터 시나리오의 시간 제한(`timeoutSec`, 기본 120초) + 여유(`childGraceSec`, 기본 30초) 안에 자식이 끝나지 않으면 실행기가 자식과 그 아래 프로세스를 모두 끝내고 그 시도를 `error`로 본다. POSIX는 `ps -A -o pid= -o ppid=`로 자식과 그 자손(부모 pid로 찾는다. 새 세션·그룹으로 띄운 것도 포함)을 찾아 `SIGSTOP`으로 멈추고, 새로 보이는 자손이 없을 때까지(최대 10번) 되풀이한 뒤 멈춘 것을 모두 `SIGKILL`한다. Windows는 `taskkill /PID <pid> /T /F`다. 끝낸 뒤에는 자식의 `exit` 이벤트로 그 시도를 끝내고(`close`를 기다리지 않는다) 자식의 stderr 스트림을 닫는다(`destroy`). 남은 프로세스가 파이프를 쥐고 있어도 실행기가 멈추지 않게 한다. 스스로 끝난 자식도 `exit` 뒤 1초 안에 `close`가 오지 않으면 그때까지의 stderr로 넘어간다(같은 이유). 대기열에서 기다린 시간은 셈하지 않는다(자식을 띄운 때부터 잰다).
  - 자식의 끝은 셋으로 나눈다: 결과 파일이 있음(그 결과), 시간 제한으로 끝냄(`error`), 결과 파일 없이 스스로 끝남(띄우지 못한 경우 포함, `error`).
  - 나란히 도는 것이 모두 끝나면 `pass`가 아닌 시나리오를 파일 이름순으로 하나씩(겹치지 않게) 다시 돌린다. 첫 시도가 결과 파일 없이 스스로 끝났으면 실행기 프로세스 안에서(`runScenario`), 그 밖은 자식 프로세스로 같은 시간 제한을 두고 돌린다. 다시 돌려 통과하면 `state`는 `pass`이고 `detail`은 `<제목> (나란히 돌 때 <state>: <detail 앞부분>, 혼자 다시 돌려 통과)`이다(500자 안에 끝의 표시가 들어가게 앞부분을 줄인다). 통과하지 못하면 다시 돌린 결과를 그대로 쓴다.
  - `runSelfTest`에 `childGraceSec?: number`(기본 30)를 더한다. 테스트만 줄인다.
- 보고서는 형식을 바꾸지 않는다. `results`는 파일 이름순이다. 실행 정보는 보고서에 넣지 않고 선택 인자 `onStats?: (s: { jobs: number; reruns: number; ms: number }) => void`로 넘긴다(`jobs`는 실제로 쓴 동시 수, `reruns`는 다시 돌린 시나리오 수, `ms`는 `runSelfTest` 전체의 걸린 시간). 반환값은 지금처럼 `SelfTestReport`이고 보고서 JSON(`--out`)에 새 필드를 넣지 않는다.

### 2. 자식 진입점 (`scripts/selftest/child.ts`)

- 인자 셋(대상 하네스, 시나리오 파일, 결과 파일)을 받아 1의 함수로 시나리오 하나를 돌리고, 결과(`id`, `covers`, `state`, `detail`)를 결과 파일에 JSON으로 쓰고 0으로 끝난다. 인자가 틀리면 2로 끝난다.
- 대상 하네스의 내부 모듈을 import하지 않는다(실행기 쪽 `run.ts`만 쓴다).

### 3. CLI (`scripts/harness.ts`)

- `self-test`에 `--jobs <N>`을 더한다(기본 모드만. `--live`는 그대로). 1 이상의 정수가 아니면 stderr에 이유를 쓰고 종료 코드 2다. 도움말 줄에도 더한다.
- 요약 줄: `self-test: 통과 (시나리오 N개, 나란히 M개, 다시 돌린 것 K개, S초)`. 실패면 `통과` 자리가 `실패 N건`이다. `S`는 소수 첫째 자리까지다. 동시 수가 1이면 `나란히 1개`다.

### 4. 테스트 (`scripts/test/selftest.test.ts`)

시험용 시나리오 폴더(기존 테스트와 같은 방식)로 다음을 본다. 실제 시간에 기대는 테스트는 기다리는 시간을 넉넉히 두고(자식 프로세스가 뜨는 데 걸리는 시간보다 길게), 실패할 때 막히지 않게 시간 제한을 둔다.

- 서로를 기다리는 두 시나리오(각자 표시 파일을 쓰고 상대의 표시 파일이 생길 때까지 기다린다)가 `jobs: 2`에서 둘 다 `pass`다. 차례로 돌면 먼저 돈 쪽이 기다리다 실패한다.
- 시나리오 넷을 `jobs: 2`로 돌리면 동시에 돈 수의 최댓값이 2다(시작·끝 표시 파일로 센다).
- 결과가 파일 이름순이다(끝나는 순서를 거꾸로 만들어도).
- 다른 시나리오가 함께 돌고 있을 때만 실패하는 시나리오는 혼자 다시 돌려 `pass`가 되고 `detail`에 `혼자 다시 돌려 통과`가 있다. 늘 `assert`로 실패하는 시나리오는 `fail`이고 다시 돌려도 `fail`이다.
- 결과 파일 없이 스스로 끝나는 자식(시나리오가 자식 진입점 안에서 돌 때만 `process.exit`로 끝나는 꼴로 흉내 낸다)은 나란히 돌 때 `error`이고, 실행기 안에서 다시 돌려 `pass`가 된다. 실행기 안에서 `process.exit`를 부르는 꼴은 쓰지 않는다.
- 끝나지 않는 시나리오(`timeoutSec: 1`, `childGraceSec: 1`)는 시작할 때마다 시작 표시 파일에 한 줄을 더하고, 중간 프로세스 하나(같은 그룹)를 띄운다. 중간 프로세스는 새 세션(`detached: true`)으로 손자 프로세스를 하나 띄우고 둘의 pid를 적은 뒤 끝없이 기다린다(runner가 에이전트를 새 세션으로 띄우는 꼴). 시나리오도 끝없이 기다린다. 결과: 최종 `error`이고 `detail`에 시간 제한으로 끝냈다는 말이 있다. 시작 표시가 정확히 두 줄이다(나란히 한 번, 자식으로 다시 한 번). 적힌 pid(시도마다 둘)가 모두 끝나 있다(`process.kill(pid, 0)`이 `ESRCH`. 좀비가 거둬질 때까지 잠깐 기다린다). 함께 돈 다른 시나리오는 `pass`로 보고서에 남는다.
- 파이프를 쥔 고아: 끝나지 않는 시나리오(`timeoutSec: 1`, `childGraceSec: 1`)가 중간 프로세스를 stderr를 물려받게(`inherit`) 띄우고, 중간 프로세스는 손자를 새 세션·stderr 물려받기로 띄워 그 pid를 적고 곧바로 끝난다(손자는 고아가 되어 자식의 stderr 파이프를 쥐고 끝없이 돈다). 결과: `runSelfTest`가 돌아오고(테스트 시간 제한 안) 그 시나리오는 최종 `error`, 시작 표시가 두 줄이다. 적힌 손자 pid는 테스트가 `finally`에서 끝낸다(부모 pid로 찾지 못하는 한계의 경우라 실행기가 끝내리라고 단언하지 않는다).
- 대기열에서 기다린 시나리오: `jobs: 2`, `childGraceSec: 1`. 오래 걸리는 시나리오 둘(`timeoutSec: 30`, 각 8초)이 먼저 돌고(시간 제한이 긴 것부터 띄운다), 셋째(`timeoutSec: 4`)는 앞의 하나가 끝난 것을 확인한 뒤 바로 `ctx.sample()`을 부른다. 셋째는 8초 넘게 대기열에서 기다려, 대기열 시간을 셈하면 실행기의 제한(4 + 1초)과 시나리오의 제한(4초)을 모두 넘는다. 결과: 셋 다 `pass`이고 다시 돌린 수가 0이며 셋째의 `detail`이 제목 그대로다.
- `jobs`가 0이나 정수가 아니면 예외다. CLI `self-test --jobs 0`·`--jobs x`는 종료 코드 2다. CLI 요약 줄에 `나란히`와 `초`가 있다.
- 기존 테스트는 고치지 않고 통과해야 한다(이 리포의 하네스가 모든 시나리오를 기본 동시 수로 통과, 약화된 사본에서 해당 시나리오 실패, 자격증명과 홈 폴더를 넘기지 않음, `--only`).

### 5. 시간 재기

- 로컬에서 이 리포의 하네스로 `uptime; node scripts/harness.ts self-test --jobs 1; uptime; node scripts/harness.ts self-test --jobs 2`를 바로 잇달아 돌린다(같은 머신·같은 트리).
- 진행 로그에 한 줄로 적는다: `- <날짜> 시간 재기: --jobs 1 <S1>초(부하 <1분 평균>), --jobs 2 <S2>초(부하 <1분 평균>)`. `S1`·`S2`는 요약 줄의 시간, 부하는 각 실행 앞 `uptime`의 1분 평균이다. AC가 이 줄의 꼴을 확인한다.

### 6. 문서

- 설계서 12.4절: "LLM 없는 시나리오의 구성"에 시나리오를 시나리오마다 자식 프로세스로 나란히 돌린다는 것(동시 수 기본값, 시간 제한이 긴 것부터, 실행기의 마지막 시간 제한), 나란히 돌 때 실패한 시나리오를 혼자 다시 돌린다는 것과 그 이유(main의 실행기가 깨져도 고치는 PR이 막히지 않게), "실행"에 `--jobs`와 요약 줄을 적는다.
- `docs/harness/architecture.md`의 `scripts/selftest/` 문단: "파일 이름순으로 돌린다"를 나란히 돌리는 방식(`child.ts`)으로 고친다.
- 변경 조각 `docs/harness/changes/20261125-selftest-parallel-s0.md`: `## CHANGELOG`와 `## 설계서 변경 이력`에 한 줄씩(Issue #247).

### 7. 승인 요청과 병합 뒤 관찰

- 코드 판정이 끝나도 `pr-ready`는 2026-11-29 00:00 UTC 뒤에 한다. 그 전에는 PR을 초안으로 둔다.
- 병합 뒤 새 실행기로 돈 `selftest` job(로그의 요약 줄에 `나란히`가 있는 것)의 job 걸린 시간(`started_at`~`completed_at`)과 요약 줄의 시간을 병합 뒤 처음 10개(7일 안에 10개가 안 되면 그때까지)에 대해 Issue #247에 남긴다. 60초를 넘는 job이 있으면 워크플로의 준비 단계를 줄이는 후속 Issue를 연다. 다시 돌린 것이 0이 아닌 실행이 있으면 그 시나리오와 이유를 함께 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/selftest.test.ts && \
T=$(mktemp -d) && node scripts/harness.ts test-effect --ci > "$T/te" 2>&1 && grep -qF "scripts/test/selftest.test.ts: effective(base에서 단언 실패" "$T/te" && \
git diff --quiet origin/main HEAD -- scripts/selftest/scenarios scripts/selftest/live scripts/selftest/live.ts scripts/selftest/fake-agent.ts scripts/selftest/api-stub.ts scripts/ci/selftest-result.ts .github && \
T=$(mktemp -d) && node scripts/harness.ts self-test --jobs 1 > "$T/o1" 2>&1 && grep -qE "^self-test: 통과 \(시나리오 10개, 나란히 1개, 다시 돌린 것 0개, [0-9.]+초\)$" "$T/o1" && \
node scripts/harness.ts self-test --jobs 2 --out "$T/r.json" > "$T/o" 2>&1 && grep -qE "^self-test: 통과 \(시나리오 10개, 나란히 2개, 다시 돌린 것 [0-9]+개, [0-9.]+초\)$" "$T/o" && test "$(jq -r '[.results[].id] | join(",")' "$T/r.json")" = "$(ls scripts/selftest/scenarios | sed 's/\.ts$//' | LC_ALL=C sort | paste -sd, -)" && test "$(jq -r 'keys | join(",")' "$T/r.json")" = "headSha,results,version" && \
awk '/^## 진행 로그/{s=1;next} /^## /{s=0} s' docs/exec-plans/active/20261125-selftest-parallel/plan.md | grep -qE "^- [0-9]{4}-[0-9]{2}-[0-9]{2} 시간 재기: --jobs 1 [0-9.]+초\(부하 [0-9.]+\), --jobs 2 [0-9.]+초\(부하 [0-9.]+\)" && \
T=$(mktemp -d) && (node scripts/harness.ts self-test --jobs 0 > "$T/o" 2>&1; test $? = 2) && \
T=$(mktemp -d) && awk '/^### 12\.4 /{s=1;next} /^##+ /{s=0} s' docs/harness/design.md > "$T/s" && grep -qF -- "--jobs" "$T/s" && grep -qF "혼자 다시 돌린다" "$T/s" && grep -qF "child.ts" docs/harness/architecture.md && \
grep -q "#247" docs/harness/changes/20261125-selftest-parallel-s0.md && grep -q "^## 설계서 변경 이력" docs/harness/changes/20261125-selftest-parallel-s0.md && git diff --quiet origin/main HEAD -- docs/harness/CHANGELOG.md && \
node scripts/harness.ts check
```

- 블록은 줄 끝의 `&& \`로 이은 하나의 명령이다. 한 줄이라도 실패하면 뒤의 줄은 돌지 않고 블록 전체가 0이 아닌 종료 코드로 끝난다. 아래 "N째 줄"은 블록 안의 줄 차례다.
- `origin/main`과 견주는 줄은 로컬의 `origin/main`을 쓴다(AC를 돌리기 전에 `git fetch origin`으로 맞추고, main이 앞서 있으면 `origin/main`을 병합한 뒤에 돌린다).
- 첫째 줄: 실행기 테스트. 둘째 줄: 고친 테스트 파일이 merge-base의 코드에서 단언 실패로 실패한다(나란히 돌아야 통과하는 테스트가 있다).
- 셋째 줄: 시나리오, 실제 세션 실행기, 가짜 에이전트·API 서버, 보고서 병합 코드, 워크플로가 main 그대로다.
- 넷째·다섯째 줄: 이 리포의 하네스를 동시 수 1과 2로 잇달아 돌려 둘 다 통과하고, 요약 줄의 꼴이 수용 기준 5와 같고, 동시 수 2의 보고서의 결과가 파일 이름순(바이트 순)이고, 보고서의 최상위 키가 지금 그대로다.
- 여섯째 줄: 진행 로그에 작업 5의 `시간 재기:` 줄(두 모드의 시간과 부하)이 있다.
- 일곱째 줄: `--jobs 0`은 종료 코드 2다. 괄호 안의 `;`는 그 명령의 종료 코드를 `test`가 보게 하려는 것이고, 괄호 전체의 종료 코드는 `test`의 것이다.
- 여덟째 줄: 설계서 12.4절에 `--jobs`와 다시 돌리기가 있고, 구조 문서에 자식 진입점이 있다.
- 아홉째 줄: 변경 조각(#247, 설계서 변경 이력)이 있고 CHANGELOG는 main 그대로다. 조각의 형식은 마지막 줄의 `check`(`doc-lint`의 `R8 변경 조각`)가 본다.

## 금지사항

- 시나리오 파일(`scripts/selftest/scenarios/`)과 그 시간 제한을 바꾸지 않는다. 이유: 범위 밖이고, `selftest` job은 main의 시나리오로 PR의 하네스를 시험하므로 시나리오 변경은 따로 순서를 밟아야 한다(12.4절).
- 보고서 형식(최상위 키, `results`의 필드, 순서)을 바꾸지 않는다. 이유: `harness-guard`에 합치는 코드(`scripts/ci/selftest-result.ts`)가 main의 정의로 이 보고서를 검사한다.
- 다시 돌리기를 두 번 이상 하거나, 다시 돌린 결과를 나란히 돈 결과와 섞어 `pass`로 만들지 않는다(다시 돌려 통과한 것만 `pass`다). 다시 돌린 사실을 `detail`과 요약 줄에서 빼지 않는다. 이유: 회귀를 가리지 않는다(R4).
- `.github/workflows/`를 고치지 않는다. 이유: 범위 밖이고 봇은 워크플로를 push할 수 없다.
- 자식 프로세스에 넘기는 환경을 넓히지 않는다(샘플 리포의 자식 프로세스 환경은 지금처럼 `makeSample`이 거른다). 이유: 12.4절의 자격증명 규칙.
- 실행기가 만든 임시 폴더를 지우지 않는다. 이유: R14, 실패를 들여다볼 수 있게(12.4절).
- 2026-11-29 00:00 UTC 전에 `pr-ready`를 하지 않는다. 이유: B1의 넣기 전 값과 섞이지 않게(의사결정 로그).
- `docs/harness/CHANGELOG.md`와 설계서 머리말·변경 이력을 고치지 않는다. 이유: 보호 경로 PR의 변경 기록은 변경 조각에 적는다.
