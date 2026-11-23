# 변경 조각: 20261123-windows-test-speed-s0

## CHANGELOG

- `repoInfo`가 git을 둘(`rev-parse`, `symbolic-ref`)에서 하나(`rev-parse … --abbrev-ref=loose HEAD`)로 줄여 띄운다. 결과를 담아 두지 않고, 실패하면 예전 순서로 읽어 돌려주는 값과 예외는 같다(Issue #230)
