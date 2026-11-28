# 변경 조각: 20261127-changes-output-limit

## CHANGELOG

- `changes-collect`가 모은 설계서·CHANGELOG의 바이트 수가 읽기 상한(16 MiB)을 넘으면 쓰거나 조각을 지우기 전에 파일 이름과 상한을 알리고 1로 끝낸다. 다음 실행에서 읽을 수 없는 기록 파일을 게시하던 일을 막는다(Issue #264, PR #254 판정 F6).
