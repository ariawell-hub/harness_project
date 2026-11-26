# 변경 조각: 20261126-td-duplicate-ids-s0

## CHANGELOG

- 기술 부채 표의 겹친 id를 풀었다(Issue #251): #246이 더한 두 행을 TD-76(`lab/` 스크립트의 직접 실행 판정)과 TD-77(`wrapper-options` 시간 비율 테스트)로 옮기고 그 계획·변경 조각의 참조를 맞췄다. #236의 TD-70·TD-71은 그대로다. `doc-lint`가 표(`docs/exec-plans/tech-debt-tracker.md`)에서 같은 id가 두 행 이상에 나오면 오류(`R8 기술 부채 id`)를 낸다(표가 검사 대상 목록에 있을 때만).
