# Step 0: rates

## 읽어야 할 파일

- `docs/harness/architecture.md`
- `scripts/metrics/actions-cost.ts`(`RATE_MILLI`, `runnerRate`, `keptLabel`, `toSaved`, `parseSaved`, `actionsCost`, `CostReport`, `renderCost`)
- `scripts/test/actions-cost.test.ts`, `scripts/test/actions-cost-command.test.ts`
- `docs/harness/actions-cost.md`("재는 방법", "예산", "기준선"의 표식 구간, "판단 절차")
- `lab/actions-cost/check-doc.ts`, `lab/actions-cost/test/check-doc.test.ts`, `lab/actions-cost/README.md`
- `docs/decisions/ADR-0008-actions-cost.md`의 "확인한 외부 사실"(읽기만. 단가와 라벨의 출처)
- Issue #204

## 작업

테스트를 먼저 쓰고 실패하는 것을 확인해 진행 로그에 적는다(R5). 실패하는 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

### 1. 단가표 (`scripts/metrics/actions-cost.ts`)

`RATE_MILLI`에 두 줄을 더한다. 값은 천분의 1달러다.

| 라벨               | 러너              | 분당 단가 | 값  |
| ------------------ | ----------------- | --------- | --- |
| `ubuntu-24.04-arm` | Linux 2코어 arm64 | $0.005    | 5   |
| `ubuntu-slim`      | Linux 1코어 x64   | $0.002    | 2   |

- 지금의 세 줄(`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-22.04` = 6)은 그대로 둔다.
- `RATE_MILLI` 바로 위의 주석(`/**`로 시작해 `const RATE_MILLI` 줄 앞에서 끝나는 주석 하나)에 러너의 종류, 두 라벨, 단가, 출처의 주소 둘(단가 `https://docs.github.com/en/billing/reference/actions-runner-pricing`, 라벨 `https://docs.github.com/en/actions/reference/runners/github-hosted-runners`)과 확인한 날짜 `2026-11-22`를 적는다. AC가 이 주석에서 주소 둘, 날짜, 두 라벨을 찾는다.
- 그 밖의 규칙은 그대로다: 라벨이 단가표의 라벨 하나뿐일 때만 단가를 안다. 라벨이 여럿이거나 없으면 모르는 러너다. `self-hosted`가 들어 있으면 self-hosted다.
- 보존 기록은 단가표에 있는 라벨과 `self-hosted`만 그대로 남긴다(`keptLabel`). 두 라벨이 단가표에 들면 그대로 남는다. 따로 목록을 만들지 않는다(단가표와 보존 기록이 받는 라벨이 어긋나지 않게 한다).

### 2. 러너별 합계 (`scripts/metrics/actions-cost.ts`)

`CostReport`에 칸 하나를 더한다.

```ts
/** 러너별. 이름은 단가표의 라벨, 'self-hosted', '(기타)'(단가를 모르는 러너) 가운데 하나다 */
byRunner: CostRow[];
```

- 돈 job만 센다(돌지 않은 job은 다른 표와 같이 들지 않는다).
- 단가를 아는 러너의 줄: `jobs`는 돈 job 수, `minutes`는 청구 분, `usd`는 그 단가를 곱한 금액이다.
- `(기타)`와 `self-hosted`의 줄: `jobs`는 돈 job 수이고 `minutes`와 `usd`는 0이다(다른 표가 단가를 모르는 러너의 job을 세는 방식과 같다. 그 분은 지금처럼 `unknownMinutes`, `selfHostedMinutes`에 있다).
- 순서는 다른 표와 같다(청구 분 내림차순, 같으면 이름 오름차순).
- 줄의 금액은 다른 표와 같이 그 줄의 밀리달러 정수를 1000으로 나눈 값이다(`row`). 달러로 나눈 값끼리 더하지 않는다.
- 합계의 불변 조건은 정수로 견준다: 모든 줄의 `jobs`의 합은 `ranJobs`, `minutes`의 합은 `minutes`, 줄마다 `Math.round(usd × 1000)`으로 되돌린 밀리달러의 합은 `usdMilli`와 같다. 줄의 `usd`를 그대로 더한 값을 `report.usd`와 견주지 않는다(arm64 20분 $0.10과 1코어 100분 $0.20을 더하면 부동소수점에서 0.30000000000000004가 된다).

### 3. 출력 (`renderCost`)

- 단가 안내 문장이 세 단가를 모두 적는다: 2코어 Linux x64 분당 $0.006, 2코어 Linux arm64 분당 $0.005, 1코어 Linux 분당 $0.002.
- "러너별" 표를 "워크플로별" 표 앞에 낸다. 칸은 다른 표와 같다(러너, 돈 job, 청구 분, 금액, 비율).
- "기록 칸"과 요약의 칸은 바꾸지 않는다.

### 4. 문서

- `docs/harness/actions-cost.md`
  - "재는 방법"의 `- **단가**:`로 시작하는 줄 하나에 세 단가(`$0.006`, `$0.005`, `$0.002`), 두 라벨(`ubuntu-24.04-arm`, `ubuntu-slim`), 출처의 주소 둘(위 1의 주소), 확인한 날짜 `2026-11-22`를 적는다. AC가 "재는 방법" 절의 그 줄에서 이것들을 찾는다.
  - "예산"의 "지금은 단가를 아는 러너가 2코어 Linux뿐이라 $0.18은 30분과 같다"를 고친다: $0.18은 2코어 Linux x64만 쓰면 30분이고, 단가가 낮은 러너에서 돈 분은 그만큼 더 쓸 수 있다는 뜻으로 적는다. `- PR 하나당 예산:` 줄과 예산 값은 바꾸지 않는다.
  - "기준선"의 표식 구간(`<!-- actions-cost:begin -->`~`<!-- actions-cost:end -->`)을 `node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl`의 새 출력으로 바꿔 붙인다. 손으로 고치지 않는다.
  - "기록" 표는 바꾸지 않는다.
- `docs/harness/CHANGELOG.md`의 "다음 버전"에 한 줄(Issue #204, 검사를 약화하지 않는다는 것).
- `lab/actions-cost/check-doc.ts`와 그 테스트, `lab/actions-cost/README.md`는 바뀐 출력 때문에 맞지 않는 곳이 있을 때만 고친다. 검사가 보는 것을 줄이지 않는다.

### 5. 테스트 (`scripts/test/actions-cost.test.ts`, 필요하면 `scripts/test/actions-cost-command.test.ts`)

- `runnerRate(['ubuntu-24.04-arm'])`는 `{ kind: 'priced', usdPerMinute: 0.005 }`, `runnerRate(['ubuntu-slim'])`는 `{ kind: 'priced', usdPerMinute: 0.002 }`다. `['ubuntu-24.04-arm', 'gpu']`와 `['ubuntu-22.04-arm']`은 `unknown`이다.
- 러너가 섞인 입력 M(돈 job 다섯, 모두 같은 PR 하나에 이어진다. 기간 2일): `ubuntu-latest` 300초(5분), `ubuntu-24.04-arm` 240초(4분), `ubuntu-slim` 300초(5분), `macos-latest` 300초(5분), `self-hosted` 360초(6분).
  - 합계: `ranJobs` 5, 청구 분 14, `usdMilli` 60(= 5×6 + 4×5 + 5×2), `usd` 0.06, `unknownMinutes` 5, `selfHostedMinutes` 6, `perPrUsd` 0.06, `monthlyUsd` 0.9(= 60밀리달러 ÷ 2일 × 30일).
  - `byRunner`는 이 순서의 다섯 줄이다(`deepEqual`): `ubuntu-latest`(job 1, 5분, $0.03), `ubuntu-slim`(1, 5분, $0.01), `ubuntu-24.04-arm`(1, 4분, $0.02), `(기타)`(1, 0분, $0), `self-hosted`(1, 0분, $0). 청구 분이 같은 줄은 이름 오름차순이다.
  - 줄의 `jobs`의 합이 `ranJobs`, `minutes`의 합이 `minutes`, `Math.round(usd × 1000)`의 합이 `usdMilli`와 같다.
- 부동소수점 사례: `ubuntu-24.04-arm` 1200초(20분)와 `ubuntu-slim` 6000초(100분)만 있는 입력에서 `usdMilli`는 300이고, `byRunner`의 줄은 `ubuntu-slim`(100분, $0.2), `ubuntu-24.04-arm`(20분, $0.1)이고, `Math.round(usd × 1000)`의 합이 300이다.
- 보존 기록: 두 라벨이 파일에 그대로 있고, `parseSaved` → `fromSaved` → `actionsCost`의 결과가 원래 입력의 결과와 같다(`deepEqual`). `ubuntu-22.04-arm` 같은 단가표 밖의 라벨은 `(기타)`로 남고, 보존 기록의 줄에 그런 라벨을 직접 적으면 `parseSaved`가 거부한다.
- 출력(입력 M의 `renderCost`): `**러너별**` 줄부터 다음 `**`로 시작하는 줄 앞까지를 잘라 그 구간만 본다.
  - 구간의 표에 자료 행이 다섯이고(머리 줄과 구분 줄을 뺀 `|`로 시작하는 줄), 순서와 칸이 위 `byRunner`와 같다: 행마다 러너 이름, 돈 job 수, 청구 분, 표시 금액(`$0.03`, `$0.01`, `$0.02`, `$0.00`, `$0.00`)을 단언한다.
  - 구간이 "워크플로별" 표보다 앞에 있다.
  - 단가 안내 문장(한 줄)에 `$0.006`, `$0.005`, `$0.002`가 모두 있다.

## Acceptance Criteria

```bash
node --test scripts/test/actions-cost.test.ts scripts/test/actions-cost-command.test.ts
node --test lab/actions-cost/test/check-doc.test.ts lab/actions-cost/test/check-adr.test.ts
git diff --quiet origin/main -- lab/actions-cost/2026-11-17_2026-11-20.jsonl
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/out.md" && grep -q "^| 2026-11-17~2026-11-20 | 4028 *| 100.7 *| \$0.604 *| 21.2 *| \$181.26 *|$" "$T/out.md"
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/out.md" && awk '/^\*\*러너별\*\*/{s=1;next} /^\*\*/{s=0} s' "$T/out.md" > "$T/r" && grep -q "^| ubuntu-latest *| 2384 *| 4028 *| \$24.17 *| 100.0% *|$" "$T/r" && test "$(grep -c "^|" "$T/r")" = 3
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/out.md" && grep -F "0.006" "$T/out.md" | grep -F "0.005" | grep -qF "0.002"
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/out.md" && test -s "$T/out.md" && grep -v "^$" "$T/out.md" > "$T/a" && awk '/<!-- actions-cost:begin -->/{s=1;next} /<!-- actions-cost:end -->/{s=0} s' docs/harness/actions-cost.md | grep -v "^$" > "$T/b" && test -s "$T/b" && cmp "$T/a" "$T/b"
node lab/actions-cost/check-doc.ts
node lab/actions-cost/check-adr.ts
T=$(mktemp -d) && awk '/^## 재는 방법/{s=1;next} /^## /{s=0} s' docs/harness/actions-cost.md | grep "^- \*\*단가\*\*:" > "$T/l" && test "$(grep -c "" "$T/l")" = 1 && grep -qF "https://docs.github.com/en/billing/reference/actions-runner-pricing" "$T/l" && grep -qF "https://docs.github.com/en/actions/reference/runners/github-hosted-runners" "$T/l" && grep -qF "2026-11-22" "$T/l" && grep -qF "ubuntu-24.04-arm" "$T/l" && grep -qF "ubuntu-slim" "$T/l" && grep -qF "0.006" "$T/l" && grep -qF "0.005" "$T/l" && grep -qF "0.002" "$T/l"
T=$(mktemp -d) && awk '/^\/\*\*/{c=""} {c=c"\n"$0} /^const RATE_MILLI/{print c; exit}' scripts/metrics/actions-cost.ts > "$T/c" && grep -q "^const RATE_MILLI" "$T/c" && grep -qF "https://docs.github.com/en/billing/reference/actions-runner-pricing" "$T/c" && grep -qF "https://docs.github.com/en/actions/reference/runners/github-hosted-runners" "$T/c" && grep -qF "2026-11-22" "$T/c" && grep -qF "ubuntu-24.04-arm" "$T/c" && grep -qF "ubuntu-slim" "$T/c"
grep -q "#204" docs/harness/CHANGELOG.md
node scripts/harness.ts check
```

- 어느 줄도 GitHub을 읽지 않는다(셋째 줄은 로컬의 `origin/main`과 견준다).
- 셋째 줄: 기준선 보존 기록이 그대로다. 넷째 줄: 그 기록의 "기록 칸" 행이 그대로다(4028분, 100.7분, $0.604, 21.2분, $181.26).
- 다섯째 줄: 출력에서 `**러너별**` 구간만 잘라 본다. 기준선의 돈 job 2384개는 모두 `ubuntu-latest`에서 돌았으므로 구간의 표는 머리 줄, 구분 줄, 자료 행 하나(세 줄)이고, 그 행의 청구 분이 전체 4028분, 금액이 요약의 금액과 같은 $24.17(4028 × $0.006 = $24.168을 소수 둘째 자리로 적은 값), 비율이 100.0%다. 다른 구간에 같은 행이 있어도 통과하지 않는다. 러너가 섞였을 때의 구간은 첫째 줄의 테스트(입력 M)가 본다.
- 여섯째 줄: 출력의 한 줄(단가 안내 문장)에 세 단가가 함께 있다.
- 일곱째 줄: 문서의 기준선 구간이 `--from`의 출력과 같다. 빈 줄은 비교에서 뺀다(prettier가 표식 줄 앞뒤에 빈 줄을 둔다).
- 열째 줄: 문서의 "재는 방법" 절에 `- **단가**:` 줄이 하나이고, 그 줄에 출처의 주소 둘, 확인한 날짜, 두 라벨, 세 단가가 있다.
- 열한째 줄: `const RATE_MILLI` 바로 위의 주석 하나(와 그 선언 줄)를 잘라, 출처의 주소 둘, 확인한 날짜, 두 라벨이 있는지 본다. 주석이 없거나 다른 곳에만 적혀 있으면 실패한다.

## 금지사항

- `.github/workflows/`를 고치지 마라. 이유: `runs-on`을 바꾸는 것은 B2·B1의 Issue이고, 봇은 워크플로 파일을 push할 수 없다.
- `lab/actions-cost/2026-11-17_2026-11-20.jsonl`을 고치거나 다시 재지 마라. 이유: 보존 기록이 기준선의 기준이다(판단 절차 "기준이 되는 입력").
- 확인하지 않은 러너의 단가를 넣지 마라. 이유: 단가표에는 출처에서 확인한 것만 넣는다. 틀린 단가는 금액과 예산 판단을 틀리게 한다.
- 예산 값(`BUDGET`), 판단 규칙(`verdictOf`), "기록" 표의 행을 바꾸지 마라. 이유: 예산은 제작자의 결정이고, 이 step은 재는 도구만 넓힌다.
- `lab/actions-cost/check-doc.ts`가 보는 것을 줄이지 마라. 이유: 검사를 약화하지 않는다(R4).
- GitHub을 읽는 명령(`actions-cost --since`)을 AC와 테스트에 넣지 마라. 이유: 지난 기간의 실행 기록도 다시 실행하면 바뀌어 결과가 달라진다.
