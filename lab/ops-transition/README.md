# 운영 전환 시험 결과

운영 전환 체크리스트 5·6(설계서 10.4절)을 실제 GitHub의 테스트 리포에서 확인한 결과다. 계획은 `20261116-ops-security`의 step6(`docs/exec-plans/`), 테스트 리포의 운영 방식은 [ADR-0004](../../docs/decisions/ADR-0004-q20-lab-repo.md), 제작자 준비 절차는 [docs/SECURITY.md](../../docs/SECURITY.md)의 "테스트 리포 준비" 절이다.

- 테스트 리포: `ariawell-hub/harness-ops-lab` (비공개. 하네스 main `f439e81`의 트리를 올렸다)
- 시험 날짜: 2026-11-17(도입) ~ 2026-11-18(사례 실행)

## 구조

| 경로                  | 내용                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `report.ts`           | `results/*.json`의 기록 완결과 필수 사례를 검사한다                 |
| `results/<항목>.json` | 항목별 결과                                                         |
| `test/`               | `report.ts` 테스트(`node --test lab/ops-transition/test/*.test.ts`) |

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않는다.

## 항목과 필수 사례

필수 사례가 모두 있고 `verdict`가 `pass`여야 `report.ts`가 통과한다. 필수가 아닌 사례는 `fail`·`partial`·`n/a`여도 기록이 완결되면 통과다.

| 항목             | 필수 사례                                                                                   | 필수가 아닌 사례                                                            |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `selftest`       | `ci-check`, `live`                                                                          |                                                                             |
| `flow`           | `runner-unattended`, `carry-over`, `no-carry`                                               |                                                                             |
| `revert`         | `rerun-first`, `revert-pr`, `issue-reopen`, `plan-restore`, `tampered`                      |                                                                             |
| `guard-selftest` | `protected-pr`, `non-protected-pr`                                                          |                                                                             |
| `codeowners`     | `owner-required`, `auto-merge`                                                              |                                                                             |
| `workflow-scope` | `push-rejected`                                                                             | `update-after-workflow-change`, `revert-of-workflow`                        |
| `stage`          | `operation-pr`                                                                              |                                                                             |
| `target-repo`    | `workflow-push-rejected`, `low-risk-auto-merge`(하네스 리포 자신에서 한 시험, 체크리스트 6) | `protected-needs-owner`는 운영 전환 PR의 승인 전 상태를 본 뒤 필수로 더한다 |
| `td38`           | 없음(결과 파일이 없어도 된다)                                                               | TD-38 목록 가운데 실제로 본 것과 못 본 것                                   |

각 사례가 확인하는 것은 계획의 step6 지시서에 있다.

## 결과 형식

```json
{
  "item": "revert",
  "summary": "한두 문장 요약",
  "cases": [
    {
      "name": "rerun-first",
      "expected": "설계서가 기대하는 동작",
      "observed": "관찰한 동작",
      "verdict": "pass | fail | partial | n/a",
      "evidence": ["워크플로 실행 URL, PR URL 등"]
    }
  ]
}
```

- 관찰하지 못한 사례를 `pass`로 적지 않는다. 못 봤으면 `n/a`와 이유(`observed`)를 적는다. 필수 사례가 `n/a`면 `report.ts`가 실패한다.
- `n/a`가 아니면 근거가 1개 이상 있어야 한다.
- 한 항목 안에서 사례 이름은 겹치지 않는다.
- 자격증명 값이나 그 일부는 적지 않는다. 필요하면 sha256 앞 8자만 쓴다.

```bash
node lab/ops-transition/report.ts --item <항목>
node lab/ops-transition/report.ts --all
```
