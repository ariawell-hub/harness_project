# 대조군 overlay check-source-control

공격이 아니다. 브랜치 이름이 `q20/attack-*`가 아니라서(`q20/check-source-control`) recorder가 PR head에 `q20/recorded`를 쓴다. 다른 출처의 `q20/recorded`는 없다.

- 필수 체크 등록 전: 시험 App이 `q20/recorded`를 한 번 보고하게 해서 제작자가 출처로 고를 수 있게 한다.
- 등록 뒤: 시험 App의 status만으로 병합할 수 있는 상태(`mergeStateStatus` = `CLEAN`)가 되는지 본다. 병합하지 않는다.
