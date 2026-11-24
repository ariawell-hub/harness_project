# 변경 조각: 20261122-plan-review-parked-s0

## CHANGELOG

- 원장의 구현 대기(`parked`, Issue #212. 검사를 약화하지 않는다: 코드가 올라온 head에서는 전과 같이 막는다): 코드를 올린 PR이 계획을 고치려고 변경을 계획만 남기면 앞선 구현 판정의 코드 지적이 열린 채 남아, 그 head에서 판정할 수 없는데도 계획 검증(G1)을 막았다. 이제 기록 job(`scripts/ci/ledger-store.ts`)과 plan job(`scripts/ci/accept-load.ts`)이 계획만 담은 head(`mode=plan`)에서는 계획 폴더 밖 파일에 대한 열린 지적을 `parked`로 두고(계획 전용 판정에서 등록된 지적, 필드 `planRound`는 빼고), 코드가 섞인 head에서는 판정을 반영하기 전에 모두 `open`으로 되돌린다(`scripts/ci/ledger.ts`의 `parkFor`). `parked`는 판정·제작자 승인·반박으로 바뀌지 않고 `review-ledger`를 막지 않으며 상태 설명에 `구현 대기 N`으로 센다. 판정 입력의 원장 파일(`scripts/ci/review-round.ts`)에 그 뜻을 한 줄 적고, 검증자 프롬프트(`scripts/cross-review/prompt.md`)에 판정하지 말라는 항목을 더했다. `pr-state`가 구현 대기 지적의 번호를 알리고, runner(`scripts/runner/review.ts`의 `settledResponses`)는 그 지적에 대한 대응을 세지 않고 남긴다.

## 설계서 변경 이력

- 원장에 상태 `parked`(구현 대기)를 더했다(10.2절, Issue #212). 코드를 올린 PR이 계획을 고치려고 변경을 계획만 남기면, 앞선 구현 판정의 코드 지적이 계획 검증(G1)을 막았다. 계획만 담은 head에서는 그런 지적을 `parked`로 두고, 코드가 섞인 head의 기록에서 `open`으로 되돌려 다시 판정받게 한다.
