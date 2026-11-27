# 변경 조각: 20261126-approval-binding-s1

## CHANGELOG

- 제작자 승인 결속을 GitHub의 "오래된 승인 철회" 규칙 세트에 묶는다(Issue #250 step1). `risk-gate`는 위험도 높음이고 제작자의 마지막 판정 리뷰가 승인이면 PR의 실제 base 브랜치 규칙(`GET rules/branches/<base>`)을 읽어, `dismiss_stale_reviews_on_push`가 켜진 `pull_request` 규칙이 없으면 failure, 읽지 못하면 error다. 전환 시각 `github.dismissStaleSince`(main 설정)보다 엄격히 뒤(초 단위)의 승인만 센다. `ops-check` 2번이 같은 규칙을 봇 토큰으로 확인한다(GitHub 포트 `branchRules`). 제작자 절차는 SECURITY.md "오래된 승인 철회 규칙 세트 (제작자)".

## 설계서 변경 이력

- 승인 결속(10.3절): 제작자 승인을 head SHA와 오래된 승인 철회 규칙 세트(0.2절)로 묶는다. 충돌 없이 main 병합만 더한 갱신은 승인이 유지되고(실측), 충돌 해결로 PR 변경분이 바뀐 병합과 그 밖의 새 커밋은 GitHub이 철회할 수 있어 다시 승인한다. `risk-gate`가 PR base 브랜치의 규칙과 전환 시각을 확인한다(10.4절, Issue #250)
