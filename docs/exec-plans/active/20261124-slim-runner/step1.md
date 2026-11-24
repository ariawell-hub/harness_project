# Step 1: slim-on

## 읽어야 할 파일

- 이 계획의 `plan.md`(목표와 수용 기준 4·5, 의사결정 로그)
- `docs/harness/actions-cost.md`("재는 방법", "판단 절차", "기록". 기록 표의 A6 행이 본보기다)
- `docs/SECURITY.md`의 "1분 미만 job의 러너 변수 (제작자)"(step0이 더한 절)
- `docs/harness/design.md` 10.4절의 러너 문단(step0이 고친 것)
- `lab/actions-cost/check-doc.ts`(기록 표의 행을 보존 기록과 견주는 검사), `lab/actions-cost/README.md`
- `docs/exec-plans/completed/20261122-arm64-check/step0.md`의 작업 1·2(측정과 기록의 본보기)
- Issue #240(step0의 병합 뒤 관찰)

## 작업

시작 조건: step0이 병합됐고, 2026-11-29 00:00(UTC)이 지났다. 리포 변수 `SHORT_JOB_RUNNER`는 아직 없다(step0 병합 뒤 main의 `gates` 실행이 `ubuntu-latest`에서 돈 것을 Issue에서 확인한다).

### 1. 넣기 전 값을 잰다 (`lab/actions-cost/2026-11-25_2026-11-28.jsonl`)

```bash
T=$(mktemp -d) && node scripts/harness.ts actions-cost --since 2026-11-25 --until 2026-11-28 --save lab/actions-cost/2026-11-25_2026-11-28.jsonl > "$T/live.md"
```

- 기간은 B2의 첫 단계가 병합된 시각(2026-11-24 13:07 UTC, PR #207) 뒤의 첫 UTC 자정부터 나흘이다. 이 값은 B2 첫 단계를 넣은 뒤의 값이자 B1을 넣기 전의 값이다.
- 그 기간에 만들어진 실행 가운데 진행 중이거나 대기 중인 것이 없을 때 잰다. 잰 시각과 그 확인을 진행 로그에 적는다.
- 제작자에게 변수를 켜 달라고 요청하기 전에 잰다.
- GitHub을 읽는 것은 이 한 번이다. 그 뒤로는 `--from`의 출력만 쓴다. 파일을 손으로 고치지 않는다. 앞의 보존 기록 둘(`2026-11-17_2026-11-20.jsonl`, `2026-11-20_2026-11-23.jsonl`)은 건드리지 않는다.

### 2. 기록 표 (`docs/harness/actions-cost.md`)

- "기록" 표의 A6 행 다음으로 한 행을 더한다. `수단` 칸은 `B2`, `보존 기록` 칸은 `` `2026-11-25_2026-11-28.jsonl` ``이다. `기간`부터 `30일 환산 금액`까지 여섯 칸은 `node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-25_2026-11-28.jsonl` 출력의 "기록 칸" 행을 그대로 옮긴다.
- `판단` 칸은 문서가 정한 순서로 정하고 설명을 단다: B2 첫 단계(`check` job만 arm64) 뒤이자 B1을 넣기 전의 값이라는 것, 판단 시점 1(A6 행과 견준 "PR head 하나당 청구 분"과 "PR 하나당 금액"), 그 기간에 x64에서 돈 `check`가 있으면 그 까닭(`origin/main`을 병합하지 않은 PR은 PR 쪽 정의로 돈다)과 분, 단가를 모르는 러너의 분이 있으면 어느 실행의 것인지.
- 효과가 없으면(두 값이 모두 줄지 않았으면) 문서의 "효과가 없을 때"대로 되돌릴지를 진행 로그에 적고, 되돌리는 것은 제작자에게 묻는다(비용·워크플로 결정).
- 다른 행과 기준선의 표식 구간은 바꾸지 않는다.

### 3. 변경 조각 (`docs/harness/changes/20261124-slim-runner-s1.md`)

`## CHANGELOG`에 한 줄: Issue #240, B2 첫 단계 뒤(B1 넣기 전)의 값을 기록 표에 더했다는 것, 변수를 켠 시각과 그 뒤 관찰한 job. 설계서를 고치지 않으면 `## 설계서 변경 이력`은 두지 않는다.

### 4. 판정을 받고, 제작자에게 변수를 켜 달라고 요청한다

- 1~3을 올려 초안 PR을 열고 판정을 받는다.
- 판정이 끝나면 Issue #240에 요청을 남긴다(`needs-human`): `docs/SECURITY.md`의 절 링크, 변수 이름과 값(`SHORT_JOB_RUNNER` = `ubuntu-slim`), 켠 뒤 알릴 방법, 깨졌을 때 지우는 법. 켠 시각을 알려 달라고 적는다(넣은 뒤 값의 기간이 그 뒤 첫 UTC 자정부터다).

### 5. 켠 뒤 관찰한다

- 제작자가 켰다고 알리면, 진행 로그에 켠 시각을 적고 완료 처리 커밋까지 올린다. 그 push로 이 PR의 `gates`(`evaluate`, `record`)와 판정 워크플로(`plan`, `pubkey`, `store`, `record`)가 새 러너에서 돈다.
- 관찰 기간은 변수를 켠 때부터 이 PR의 승인 요청 직전까지다. 그동안 돈 실행(이 PR과 다른 PR)에서 13개 job마다 job 라벨과 결과를 실행 기록(`gh api repos/<owner>/<repo>/actions/runs/<id>/jobs`의 `labels`, `conclusion`)으로 읽는다.
- PR 본문과 Issue #240에 job마다 하나씩 적는다: job 라벨이 `ubuntu-slim`이고 결과가 성공인 실행의 링크. 관찰 기간에 돌지 않은 job(`failed`, `ci-failure`, `repro`처럼 조건이 있을 때만 도는 job, 승인 때 도는 `review-trigger`)은 이름을 적고 병합 뒤 Issue에서 이어 본다.
- 러너 탓으로 실패한 job이 있으면(도구가 없다, 15분 제한, 메모리): 바로 Issue #240에 제작자에게 변수를 지워 달라고 요청하고, 실패한 실행과 원인을 적고, 승인을 요청하지 않는다. 다음 할 일은 제작자에게 묻는다(범위를 줄인다 / 고친다 / 그만둔다).
- 모두 성공했으면 `pr-ready`로 제작자 head 승인을 요청한다.

## Acceptance Criteria

```bash
test -s lab/actions-cost/2026-11-25_2026-11-28.jsonl && head -1 lab/actions-cost/2026-11-25_2026-11-28.jsonl | grep -q '"since":"2026-11-25","until":"2026-11-28"' && \
git diff --quiet origin/main HEAD -- lab/actions-cost/2026-11-17_2026-11-20.jsonl lab/actions-cost/2026-11-20_2026-11-23.jsonl && \
T=$(mktemp -d) && grep "^| 2026-11-25~2026-11-28 *| B2 *|" docs/harness/actions-cost.md > "$T/row" && test "$(grep -c "" "$T/row")" = 1 && grep -qF '`2026-11-25_2026-11-28.jsonl`' "$T/row" && \
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-25_2026-11-28.jsonl > "$T/out.md" && awk '/^\*\*기록 칸\*\*/{s=1;next} /^\*\*/{s=0} s' "$T/out.md" | grep "^| 2026-11-25~2026-11-28 " | tr -d ' ' > "$T/a" && test -s "$T/a" && grep "^| 2026-11-25~2026-11-28 *| B2 *|" docs/harness/actions-cost.md | tr -d ' ' | sed 's/|B2|/|/' > "$T/b" && grep -qF "$(cat "$T/a")" "$T/b" && \
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-25_2026-11-28.jsonl > "$T/out.md" && awk '/^\*\*러너별\*\*/{s=1;next} /^\*\*/{s=0} s' "$T/out.md" > "$T/r" && grep -q "^| ubuntu-24.04-arm " "$T/r" && ! grep -q "^| ubuntu-slim " "$T/r" && \
node lab/actions-cost/check-doc.ts && \
node --test lab/actions-cost/test/check-doc.test.ts && \
grep -q "#240" docs/harness/changes/20261124-slim-runner-s1.md && git diff --quiet origin/main HEAD -- docs/harness/CHANGELOG.md && \
node scripts/harness.ts check
```

- 블록은 줄 끝의 `&& \`로 이은 하나의 명령이다. 한 줄이라도 실패하면 뒤의 줄은 돌지 않고 블록 전체가 실패로 끝난다. `origin/main`과 견주는 줄은 로컬의 `origin/main`을 쓴다(먼저 `git fetch origin`, main이 앞서 있으면 병합한 뒤에 돌린다).
- 첫째 줄: 보존 기록이 있고 머리 줄의 기간이 2026-11-25~2026-11-28이다. 둘째 줄: 앞의 보존 기록 둘은 그대로다.
- 셋째 줄: 기록 표에 그 기간의 행이 하나이고 수단이 `B2`, 보존 기록 칸이 그 파일이다. 넷째 줄: 그 행의 여섯 칸이 `--from` 출력의 "기록 칸" 행과 같다(공백을 지우고 견준다).
- 다섯째 줄: 그 기간에 arm64에서 돈 job이 있고(B2 첫 단계의 효과), 1코어 러너에서 돈 job이 없다(변수를 측정 기간 뒤에 켰다). 변수가 기간 안에 켜졌으면 `ubuntu-slim` 행이 생겨 실패한다.
- 여섯째·일곱째 줄: 문서 검사와 그 테스트(모든 행의 값과 판단을 보존 기록으로 다시 계산해 견준다). 여덟째 줄: 변경 조각과 CHANGELOG.
- 수용 기준 5(켠 뒤의 job 라벨과 결과)는 push 뒤의 실행 기록으로 확인하므로 이 블록에 없다. 작업 5대로 PR 본문과 Issue에 적는다.

## 금지사항

- 리포 변수를 봇이 만들거나 바꾸거나 지우지 않는다. 이유: R20이고 L1 훅이 막는다. 켜고 끄는 것은 제작자에게 요청한다.
- 측정을 마치기 전에 변수를 켜 달라고 요청하지 않는다. 이유: 넣기 전 값의 기간에 1코어 러너의 실행이 섞인다.
- 러너 탓의 실패가 있는데 승인을 요청하지 않는다. 이유: 병합 뒤에도 변수가 켜져 있으면 모든 PR의 기록과 판정이 같은 job이라 함께 막힌다.
- 보존 기록을 손으로 고치거나 다시 재서 덮어쓰지 않는다. 이유: 기록 표와 문서 검사의 기준이다(`docs/harness/actions-cost.md` "판단 절차").
- 워크플로 파일을 바꾸지 않는다. 이유: 이 step은 측정·켜기·관찰이고, 워크플로는 step0에서 끝났다.
- `docs/harness/CHANGELOG.md`를 고치지 않는다. 이유: 변경 조각에 적는다.
