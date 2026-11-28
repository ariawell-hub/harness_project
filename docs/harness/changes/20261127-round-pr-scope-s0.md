# 변경 조각: 20261127-round-pr-scope-s0

## CHANGELOG

- 라운드 입력이 직전 판정 뒤 바뀐 파일을 둘로 나눈다. 이 PR의 파일은 바뀐 파일로 남기고, main 병합으로만 바뀐 파일은 `round-main.txt`에 따로 적고 라운드 diff에서 뺀다. 그런 파일의 새 P1은 재현됐어도 범위 밖으로 미뤄 PR을 막지 않는다(원장과 `review/<검증자>` 모두). `pr-state`가 그 번호를 알려 봇이 Issue로 넘긴다. P0은 그대로 막는다(Issue #262, 제작자 결정).

## 설계서 변경 이력

- 10.2절 (4)·(5): "바뀐 파일"을 이 PR의 파일(지금 head와 직전 판정 head가 merge-base 대비 바꾼 파일)로 좁혔다. main 병합으로만 바뀐 파일의 새 P1은 재현됐어도 범위 밖 `deferred`로 등록하고 Issue로 넘긴다. 차단 지적이 모두 범위 밖 P1인 판정은 `review/<검증자>`도 success다. P0은 막는다. `review-ledger` 설명에 범위 밖 P1 수를 따로 적는다(Issue #262, 제작자 결정 2026-11-27)
