# 변경 조각: 20261127-frozen-review-status

## CHANGELOG

- 구현 판정의 차단 지적이 모두 원장이 미루는 새 P1(동결, 범위 밖, 근거 없음)이고 `resolutions`에 `open`이 없으면 `review/<검증자>`도 success다. 원장만 미루고 검증자 상태는 실패해 PR이 막히던 일을 없앤다. plan job이 라운드 수를 `round_changed`에 함께 넘기고, 원장 반영과 검증자 상태가 같은 등록 규칙(`newEntryStatus`)을 쓴다(Issue #267).

## 설계서 변경 이력

- 10.2절 (5): 원장이 미루는 새 P1만 있는 구현 판정은 `review/<검증자>`도 success다. 기록 job은 원장과 같은 등록 규칙과 plan job이 넘긴 라운드 수로 판단하고, 라운드 수를 모르면 동결로 통과시키지 않는다. 계획 전용 판정은 쓰지 않는다(Issue #267)
