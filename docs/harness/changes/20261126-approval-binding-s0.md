# 변경 조각: 20261126-approval-binding-s0

## CHANGELOG

- `risk-gate`가 제작자 승인을 리뷰의 커밋(`commit_id`) 대신 하네스가 정한 승인 head에 묶는다(Issue #250): GitHub이 main 병합 뒤 리뷰의 커밋을 새 head로 옮겨 보고해 승인이 다시 확인 없이 넘어갔다(PR #226). 승인 head는 리뷰 제출보다 앞서 생긴 Actions check suite로 정하고, 승인 뒤 main 병합만 더했고 PR 내용이 같으면 승인을 이어받는다(`제작자 head 승인 이어받음`). 그 밖의 커밋, 승인 직전 60초 안의 push, 강제 push가 있으면 다시 승인받는다. 자료를 읽지 못하면 error다.

## 설계서 변경 이력

- 10.3절 승인 결속 기준의 제작자 승인 행과 "제작자 승인 결속 구현" 항목: 승인 head를 check suite 시각으로 정하고 main 병합만 더한 갱신에 이어받는다. 10.4절 `risk-gate` 설명과 판정 job 토큰 설명을 맞췄다(Issue #250).
