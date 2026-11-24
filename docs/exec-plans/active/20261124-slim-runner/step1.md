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

시작 조건: step0이 병합됐고, 2026-11-29 00:00(UTC)이 지났다. 리포 변수 `SHORT_JOB_RUNNER`는 아직 없다. step0 작업 8의 병합 뒤 관찰(새 정의로 만들어진 실행에서 8개 job이 `ubuntu-latest`로 성공했다)은 이 step을 시작하는 조건이 아니라 변수를 켜 달라고 요청하는(작업 4) 조건이다. 다른 PR로 관찰을 마치지 못했으면 이 PR의 첫 push(작업 1~3)가 관찰 대상이다(계획 `risk: high`이고 보호 경로를 바꿔 두 검증자가 모두 판정한다). 관찰(실행 링크)은 이 PR의 진행 로그에 옮겨 적는다.

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
- step0 작업 8의 관찰이 Issue #240에 아직 없으면 이 push의 head로 한다: 그 head의 세 실행이 끝난 뒤 작업 5의 확인 명령을 `L=ubuntu-latest`로 돌리고(새 정의로 돈 실행인지도 step0 작업 8대로 본다), 결과를 Issue #240에 남긴다. `통과`가 나오지 않으면 변수를 요청하지 않고 멈춘다.
- 판정이 끝나고 관찰이 Issue에 있으면 Issue #240에 요청을 남긴다(`needs-human`): `docs/SECURITY.md`의 절 링크, 변수 이름과 값(`SHORT_JOB_RUNNER` = `ubuntu-slim`), 켠 뒤 알릴 방법, 깨졌을 때 지우는 법. 켠 시각을 알려 달라고 적는다(넣은 뒤 값의 기간이 그 뒤 첫 UTC 자정부터다).

### 5. 켠 뒤 관찰한다

13개 job을 둘로 나눈다(계획 검증 1라운드 F3).

- 필수 8개: `check`가 성공한 head마다 돈다. `gates`의 `evaluate`·`record`, `judge-claude`의 `plan`·`record`, `judge-codex`의 `plan`·`pubkey`·`store`·`record`. 승인을 요청하기 전에 최종 head에서 모두 `ubuntu-slim`으로 성공해야 한다.
- 미룰 수 있는 5개: 조건이 있을 때만 돈다. `judge-claude`의 `failed`(판정 job이 실패했을 때)·`ci-failure`(`check`가 실패했을 때)·`repro`(재현 테스트가 붙은 지적이 있을 때), `judge-codex`의 `repro`, `review-trigger`(리뷰가 제출될 때. 봇은 리뷰를 제출하지 않는다, R20). 일부러 실패나 지적을 만들어 돌리지 않는다.

순서:

- 제작자가 켰다고 알리면, 진행 로그에 켠 시각을 적고 완료 처리 커밋까지 올린다. 이 push의 head가 최종 head다. 그 head의 `check`가 성공하면 `gates`와 두 판정 워크플로가 새 러너에서 돈다.
- 최종 head의 세 실행이 끝날 때까지 기다린 뒤(그 head의 커밋 상태 `plan-gate`·`review/claude`·`review/codex`가 모두 pending이 아닐 때) worktree에서 아래 확인 명령을 돌린다. 세 상태가 가리키는 실행(`target_url`)의 job을 읽어, 세 상태가 성공이고 필수 8개가 모두 `L`(기본 `ubuntu-slim`)·`success`일 때만 `통과`를 낸다. 판정 워크플로 실행의 `head_sha`는 PR head가 아니라 main 커밋이라 커밋으로 실행을 찾지 않고 커밋 상태로 찾는다. `SHA`와 `L`을 정해 주면 다른 head와 러너로 돌린다(step0 작업 8).

```bash
SHA=${SHA:-$(git rev-parse HEAD)} && L=${L:-ubuntu-slim} && R=$(gh repo view --json nameWithOwner --jq .nameWithOwner) && T=$(mktemp -d) && \
gh api "repos/$R/commits/$SHA/status" --jq '.statuses[] | "\(.context) \(.state) \(.target_url)"' > "$T/st" && \
test "$(grep -cE '^(plan-gate|review/claude|review/codex) success ' "$T/st")" = 3 && \
grep -E '^(plan-gate|review/claude|review/codex) ' "$T/st" | awk '{print $3}' | sed 's#.*/runs/##' > "$T/ids" && test "$(grep -c "" "$T/ids")" = 3 && \
for id in $(cat "$T/ids"); do gh api "repos/$R/actions/runs/$id/jobs" --jq '.jobs[] | "\(.name) \(.conclusion) \(.labels | join(","))"' >> "$T/jobs"; done && \
test "$(grep -cx "evaluate success $L" "$T/jobs")" = 1 && test "$(grep -cx "record success $L" "$T/jobs")" = 3 && test "$(grep -cx "plan success $L" "$T/jobs")" = 2 && test "$(grep -cx "pubkey success $L" "$T/jobs")" = 1 && test "$(grep -cx "store success $L" "$T/jobs")" = 1 && \
echo 통과
```

- `통과`가 나오면 PR 본문과 Issue #240에 세 실행의 링크와 8개 job의 라벨·결과를 적는다. 미룰 수 있는 5개는 관찰 기간(변수를 켠 때부터 승인 요청 직전까지, 이 PR과 다른 PR의 실행)에 `ubuntu-slim`에서 돈 실행이 있으면 링크를, 없으면 이름을 적고 병합 뒤 Issue에서 이어 본다. 그 뒤 `pr-ready`로 제작자 head 승인을 요청한다.
- `통과`가 나오지 않으면 승인을 요청하지 않는다. 상태가 아직 pending이면 기다린다. 필수 job이 러너 탓으로 실패했으면(도구가 없다, 15분 제한, 메모리) 바로 Issue #240에 제작자에게 변수를 지워 달라고 요청하고, 실패한 실행과 원인을 적는다. 다음 할 일은 제작자에게 묻는다(범위를 줄인다 / 고친다 / 그만둔다). 러너와 무관한 실패(판정의 지적 등)는 평소대로 고친다. 고친 커밋이 새 최종 head이므로 확인 명령을 다시 돌린다.
- 미룰 수 있는 5개 가운데 관찰 기간에 돌아 러너 탓으로 실패한 것이 있으면 위와 같이 변수를 지워 달라고 요청하고 승인을 요청하지 않는다.

실패 감시(커밋 상태에 기대지 않는다. 계획 검증 2라운드 F5): 러너가 깨지면 기록 job이 상태를 쓰기 전에 실패해 `target_url`이 생기지 않을 수 있고, 판정 실행은 PR을 가리키는 필드가 없다(`pull_requests`가 비어 있고 `head_branch`가 `main`이다). 그래서 이 PR의 실행을 찾지 않고, 켠 뒤에 만들어진 네 워크플로의 실행을 모두 본다. 러너 문제는 어느 PR의 실행에서든 같이 드러난다.

```bash
FROM=<이 감시의 시작 시각, 예: 2026-11-29T03:00:00Z> && END=${END:-$(date -u +%Y-%m-%dT%H:%M:%SZ)} && R=$(gh repo view --json nameWithOwner --jq .nameWithOwner) && T=$(mktemp -d) && \
for wf in gates judge-claude judge-codex review-trigger; do gh api --paginate "repos/$R/actions/workflows/$wf.yml/runs?created=$FROM..$END&per_page=100" --jq '.workflow_runs[] | "\(.id) \(.status) \(.created_at)"' > "$T/runs-$wf" || touch "$T/err"; n=$(gh api "repos/$R/actions/workflows/$wf.yml/runs?created=$FROM..$END&per_page=1" --jq '.total_count') || touch "$T/err"; { test -n "$n" && test "$n" -lt 1000 && test "$(cut -d ' ' -f 1 "$T/runs-$wf" | sort -u | grep -c "")" = "$n" && test "$(grep -c "" "$T/runs-$wf")" = "$n"; } || { echo "$wf: 다 읽지 못했다(전체 $n)"; touch "$T/err"; }; cat "$T/runs-$wf" >> "$T/runs"; done && \
touch "$T/failed" && for id in $(cut -d ' ' -f 1 "$T/runs"); do gh api "repos/$R/actions/runs/$id/jobs?per_page=100" --jq ".jobs[] | select(.conclusion == \"failure\" or .conclusion == \"timed_out\" or (.status != \"completed\" and (now - ((.created_at // .started_at) | fromdateiso8601)) > 1800)) | \"$id \(.name) \(.status) \(.conclusion) \(.labels | join(\",\"))\"" >> "$T/failed" || touch "$T/err"; done && \
test ! -e "$T/err" && NEXT=$(awk '$2 != "completed" {print $3}' "$T/runs" | sort | head -n 1) && \
echo "$FROM..$END 실행 $(grep -c "" "$T/runs")개(끝나지 않은 실행 $(awk '$2 != "completed"' "$T/runs" | grep -c "")개), 실패하거나 30분 넘게 끝나지 않은 job $(grep -c "" "$T/failed")개, 다음 FROM ${NEXT:-$END}" && cat "$T/failed"
```

- 감시 구간(UTC, `YYYY-MM-DDTHH:MM:SSZ`): 켠 시각을 `ON`이라 하자. 제작자가 알린 시각이고, 알리지 않았으면 `ubuntu-slim` 라벨이 처음 나온 job의 `started_at`이다. 첫 감시의 `FROM`은 `ON`이다. 그 뒤 감시의 `FROM`은 앞 감시가 출력한 `다음 FROM`이다. 구간 안에 끝나지 않은 실행(`status`가 `completed`가 아니다)이 있으면 `다음 FROM`은 그 가운데 가장 이른 생성 시각이고, 없으면 `END`다(계획 검증 6라운드 F11). 그래서 감시 때 아직 돌고 있던 실행(예: `judge`가 40분 도는 동안 뒤의 `repro`가 아직 돌지 않은 판정 실행)은 끝날 때까지 다음 감시가 다시 읽고, 끝난 실행만 구간 밖으로 넘어간다. 구간은 양 끝을 포함한다. `END`는 정하지 않으면 지금이다. 감시마다 출력의 첫 줄(`FROM..END 실행 …개(끝나지 않은 실행 …개), …, 다음 FROM …`)을 PR 본문(승인 전)이나 Issue #240(병합 뒤)에 남겨, 감시한 구간이 `ON`부터 빈틈없이 이어진 것을 보인다. 승인은 `ON`부터 이어진 감시들이 빈틈없고, 마지막 감시의 `다음 FROM`이 최종 head의 세 실행(커밋 상태가 가리키는 `gates`와 두 판정 실행)의 생성 시각보다 뒤일 때만 요청한다. 그래야 최종 head의 실행과 그보다 먼저 만들어진 모든 실행이 끝난 상태로 감시됐다.
- 빠짐없이 본다(계획 검증 3라운드 F7·F8, 4라운드 F9, 5라운드 F10): 실행 목록과 전체 수를 같은 고정 구간(`created=FROM..END`)으로 읽는다. 그 구간에 만들어진 실행은 조회 중에 늘지 않는다. 목록은 페이지 끝까지 읽고(`--paginate`), 워크플로마다 읽은 줄 수와 중복을 뺀 수가 그 구간의 `total_count`와 모두 같아야 한다(페이지 사이에 목록이 밀려 같은 실행을 두 번 읽고 하나를 빠뜨리면 중복을 뺀 수가 모자란다). `created` 조건의 실행 목록은 1000건까지만 읽힌다(`scripts/metrics/actions-source.ts`의 `RUNS_LIMIT`과 같은 기준). 한 워크플로라도 구간의 `total_count`가 1000 이상이면 다 읽었는지 알 수 없어 실패로 끝난다. 그때는 구간을 둘로 나눠(`END=<가운데 시각>`으로 앞 절반, 그 시각을 `FROM`으로 뒤 절반) 따로 돌리고, 나눈 구간도 상한에 닿으면 다시 나눈다. 나눠 돌린 감시의 `다음 FROM`은 하나로 합친다(계획 검증 7라운드 F11): 시간 순으로 보아 끝나지 않은 실행이 있는 첫 구간의 `다음 FROM`이고, 그런 구간이 없으면 마지막 구간의 `END`다. 뒤 구간의 `다음 FROM`만 쓰면 앞 구간에서 아직 돌던 실행을 다시 읽지 않는다. 승인 조건도 이 합친 값으로 본다. 나눈 구간들의 출력 첫 줄을 모두 남긴다. 목록·전체 수·job 조회가 하나라도 실패하거나 수가 어긋나면 표시 파일(`$T/err`)이 남아 명령이 `… 실행 …개` 줄을 내지 않고 실패로 끝난다. 그때는 그 구간의 감시를 마치지 못한 것이므로 승인을 요청하지 않고 다시 돌린다.
- 실패한 job(`failure`, `timed_out`)과 함께, 만들어진 지 30분이 지나도 끝나지 않은 job(러너를 받지 못해 대기 중이거나 멈춘 job. `conclusion`이 비어 있다)도 낸다(계획 검증 3라운드 claude의 P2). 그런 job이 13개 가운데 라벨이 `ubuntu-slim`인 것이면 러너 문제로 보고 아래와 같이 한다.
- 언제 돌리나: (1) 최종 head의 `check`가 성공한 뒤 30분이 지나도 세 상태 가운데 없거나 pending인 것이 있을 때, (2) 승인을 요청하기 직전, (3) 병합 뒤 미룬 5개를 이어 볼 때(Issue #240에 날마다 한 번, 5개를 모두 보거나 넣은 뒤 값을 잴 때까지).
- 출력에 13개 job 가운데 라벨이 `ubuntu-slim`인 실패나 멈춘 job이 있으면 `gh run view <id> --log-failed`로 실패한 단계를 읽는다(멈춘 job은 Actions 실행 기록의 상태와 대기 시간을 적는다). 러너 탓(명령이 없다, 압축 풀기·Node 내려받기 실패, 15분 제한, 메모리 부족으로 죽었다)이면 위와 같이 바로 변수를 지워 달라고 요청하고, 승인을 요청하지 않는다(병합 뒤면 Issue에 적고 다음 할 일을 묻는다). 러너와 무관한 실패(판정의 지적, 다른 PR의 테스트 실패 등)면 그 까닭을 한 줄로 적는다.

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
