# 공격 overlay check-source-pat

이 PR에는 워크플로를 더하지 않는다. PR을 연 뒤 봇 PAT로 `gh api`를 써서 PR head에 commit status `q20/recorded=success`를 쓴다(ADR-0003 "커밋 상태를 쓸 수 있다"의 위험).

기대: 필수 체크의 출처가 시험 App으로 고정돼 있어 만족하지 못한다.
