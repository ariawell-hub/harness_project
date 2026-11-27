# 승인 결속 실측 (Issue #250)

GitHub의 "Dismiss stale pull request approvals when new commits are pushed"(오래된 승인 철회)를 규칙 세트로 켠 뒤, 제작자 승인이 push마다 어떻게 되는지 잰 결과다. 계획은 `20261126-approval-binding`(`docs/exec-plans/`), 이 실측은 그 step0이다. step1은 이 결과 위에서 `risk-gate`·`ops-check`가 규칙을 확인하게 한다.

- 리포: `ariawell-hub/harness_project`(이 리포). 테스트 리포 `harness-ops-lab`은 봇 토큰으로 보이지 않아(404) 버릴 시험 PR #256으로 쟀다.
- 날짜: 2026-11-26(UTC)
- 결과: [`results/live.json`](results/live.json)

## 절차

1. 제작자가 main에 규칙 세트 `approval-dismiss-stale`을 만들었다(Active, 우회 없음, 대상 기본 브랜치, "Require a pull request before merging" + 필수 승인 0 + 오래된 승인 철회 켬). 봇 토큰으로 `GET rules/branches/main`과 `GET rulesets/28177521`이 모두 읽혔다.
2. `origin/main`에 `docs/harness/approval-probe-250.md` 하나를 더한 커밋을 플러밍으로 만들어 `test/approval-probe-250`으로 push하고 PR #256을 열었다. 보호 경로라 위험도 높음이고, `plan-gate`·`harness-guard`·`check`가 실패해 병합될 수 없다. 자동 병합은 켜지 않았다.
3. 제작자가 #256의 head를 승인했다(사례 `approved`).
4. #242가 main에 병합된 뒤, 승인이 유지되고 `risk-gate`가 success인 것을 확인하고 `origin/main` 병합 커밋만 더해 push했다(사례 `main-merge`).
5. 다시 승인 유지와 success를 확인하고 시험 파일 내용을 바꾼 일반 커밋을 push했다(사례 `normal-commit`).
6. #256을 닫고 브랜치를 지웠다.

각 사례의 값은 리뷰 API(`pulls/256/reviews`)의 제작자 리뷰와 head 커밋의 `risk-gate` 상태다. `before`는 push 직전에 본 값이다.

## 결과

| 사례            | head      | 부모 | 리뷰 상태   | 리뷰 커밋 | `risk-gate` |
| --------------- | --------- | ---- | ----------- | --------- | ----------- |
| `approved`      | `b87c8b3` | 1    | `APPROVED`  | `b87c8b3` | success     |
| `main-merge`    | `8cd1641` | 2    | `APPROVED`  | `8cd1641` | success     |
| `normal-commit` | `511f2a5` | 1    | `DISMISSED` | `8cd1641` | failure     |

- main 병합만 더한 push: GitHub은 승인을 철회하지 않고 리뷰의 커밋을 새 head로 옮긴다. 지금 `risk-gate`(제작자의 마지막 판정 리뷰가 승인이고 리뷰 커밋이 head)는 success다. 실제 PR #253의 main 병합 갱신(`c77a1cd`)에서도 같았다(`extraObservations`).
- 일반 커밋 push: push 1초 뒤 GitHub이 승인을 철회했다(`review_dismissed`, 철회 커밋 `511f2a5`). 리뷰 커밋은 마지막으로 승인이 유지된 head에 남는다. `risk-gate`는 push와 철회 이벤트로 두 번 돌았고 둘 다 failure다.
- 필수 승인 0이어도 철회는 일어난다.

## 해석

- 계획의 기대(수용 기준 2)와 같다. step1을 계획대로 한다.
- 일반 커밋에서 리뷰 커밋이 새 head로 옮겨지지 않으므로, `gates`가 철회 직전에 리뷰를 읽더라도 리뷰 커밋이 head가 아니라 failure다. 철회 이벤트가 `gates`를 한 번 더 돌린다.
- 규칙이 꺼져 있으면 일반 커밋에서 승인이 어떻게 되는지는 재지 않았다. 그래서 step1은 규칙이 켜져 있는지를 `risk-gate`가 확인한다(fail-closed).
- 규칙 세트의 `created_at`은 2026-11-26T16:11:33Z이고, 봇이 처음 본 시각(`rule.firstSeenAt`)은 16:18:41Z다. step1의 전환 시각(`github.dismissStaleSince`)은 둘 중 늦은 `firstSeenAt`을 쓴다. 그보다 앞선 승인은 step1 뒤에 다시 받아야 한다.

## PR #226과의 비교

#226(규칙 없음)에서도 main 병합 커밋 둘을 올린 뒤 제작자 리뷰의 커밋이 새 head로 옮겨져 `risk-gate`가 success였다. 이번 결과의 main 병합 사례와 같다. 다른 점은 일반 커밋이다. #226에서는 일반 커밋 사례가 없어 승인이 옮겨지는지 몰랐다. 이번에는 규칙이 켜진 상태에서 일반 커밋이 승인을 철회하는 것을 확인했다.
