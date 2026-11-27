# 변경 조각: 20261126-approval-binding-s0

## CHANGELOG

- 제작자 승인 결속 실측(Issue #250 step0): main에 규칙 세트 `approval-dismiss-stale`("오래된 승인 철회" 켬, 필수 승인 0)을 켠 뒤 버릴 시험 PR #256으로 쟀다. main 병합만 더한 push는 승인이 유지되고 리뷰 커밋이 새 head로 옮겨져 `risk-gate`가 success, 내용을 바꾼 일반 커밋 push는 승인이 `DISMISSED`가 되어 failure다. 결과는 `lab/approval-binding/`. 코드는 바꾸지 않았다(규칙 확인은 step1).
