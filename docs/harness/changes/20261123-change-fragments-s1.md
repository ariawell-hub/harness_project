# 변경 조각: 20261123-change-fragments-s1

## CHANGELOG

- 변경 조각 모으기 명령 `changes-collect`(Issue #222, TD-39 해결): 모으기 PR(절차서 5절, 제작자가 지시할 때 연다)에서 `node scripts/harness.ts changes-collect`가 `docs/harness/changes/`의 조각을 이름 차례로 읽어 CHANGELOG 항목은 "다음 버전 (미배포)" 끝으로, 설계서 변경 이력 항목은 패치 번호를 하나씩 올린 버전과 그날 날짜로 변경 이력 끝에 옮기고 머리말을 맞춘 뒤 조각 파일을 지운다(`scripts/lib/changes.ts`의 `collectFragments`, `scripts/commands/changes.ts`). 조각이 없으면 아무것도 바꾸지 않는다. 형식이 틀린 조각, 조각 폴더 안의 다른 파일, 심볼릭 링크와 하드 링크, 커밋하지 않은 파일(git이 무시하는 파일 포함)이나 변경이 있으면 아무것도 바꾸지 않고 실패한다. 도중에 실패하면 되돌리는 명령(`git restore --source=HEAD …`)을 출력한다. 명령은 git을 읽기(`git ls-tree`, `git status`)만 한다. 이 PR은 CHANGELOG·설계서를 고치지 않고 이 조각으로만 기록한다.
