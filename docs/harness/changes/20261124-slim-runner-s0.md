# 변경 조각: 20261124-slim-runner-s0

## CHANGELOG

- 1분 미만 job 13개(`gates`의 `evaluate`·`record`, 두 판정 워크플로의 `plan`·`repro`·`record`와 `judge-claude`의 `failed`·`ci-failure`, `judge-codex`의 `pubkey`·`store`, `review-trigger`의 `trigger`)의 러너를 리포 변수 `SHORT_JOB_RUNNER`로 고르는 스위치로 바꿨다(Issue #240. ADR-0008의 수단 B1. 검사를 약화하지 않는다). 변수가 `ubuntu-slim`이면(대소문자는 가리지 않는다) 1코어 러너(`ubuntu-slim`, 분당 $0.002), 없거나 다른 값이면 지금의 `ubuntu-latest`라 병합만으로는 러너가 바뀌지 않는다. 12개가 main의 정의로 돌아 병합 전에 실제 조건으로 확인할 수 없어, 제작자가 변수로 켜고 깨지면 지워 PR 없이 되돌린다. 식은 변수 값을 그대로 러너로 쓰지 않고 두 GitHub 호스팅 러너 가운데 하나만 고른다(협업자도 리포 변수를 바꿀 수 있어서다. 봇의 변경은 L1 훅이 R20으로 막는다). 구조 테스트가 모든 job의 러너와 스위치 식을 단언하고(`ci.test.ts`), 비밀이 없는 job에 `vars.`가 없다는 기존 단언은 그대로 두되 스위치 줄 하나만 검사할 글에서 뺀다(빼는 범위도 테스트한다). `check`, `selftest`, 판정의 `judge`, `revert`의 job은 옮기지 않았다. 제작자의 켜고 끄는 절차를 `docs/SECURITY.md`에 더했다.

## 설계서 변경 이력

- 10.4절 "self-hosted 러너는 쓰지 않는다"의 하위 항목과 E3: 1분 미만 job 13개는 리포 변수 `SHORT_JOB_RUNNER`가 `ubuntu-slim`이면 1코어 컨테이너 러너(공유 VM 위의 job마다 새 컨테이너, 비밀을 가진 기록 job과 Codex 인증 저장 job 포함)에서 돌고, 판정의 `judge` 등 나머지는 VM 러너에서 돈다는 것, 식이 두 러너 가운데 하나만 고른다는 것, 변수는 제작자가 바꾸고 지우면 되돌아간다는 것을 적었다(Issue #240, ADR-0008 B1). 전에는 "모든 작업은 GitHub 호스팅(일회용) 러너에서 돈다"였다.
