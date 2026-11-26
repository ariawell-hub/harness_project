# 변경 조각: 20261123-results-not-inert

## CHANGELOG

- 실측 결과 파일 `lab/q10-db/results/darwin-arm64.json`을 보호 경로(`protectedPaths`)에 더했다(#225). `scripts/test/profile-web-db.test.ts`가 웹 프로파일 README의 DB 절과 맞대는 파일이라, 이 파일만 바꾼 변경에서도 `check`가 `test`를 건너뛰지 않는다. 바꾸려면 제작자 승인이 필요하다. #216의 테스트가 이 파일을 건너뛰기 대상으로 단언하던 것을 고쳤고, `scripts/test/`의 테스트가 따옴표 안에 적은 `lab/` 경로가 건너뛰기 대상이면 실패하는 테스트를 더했다(`check-skip.test.ts`). 그 훑기는 여는 따옴표와 같은 따옴표에서 닫아, 공백이나 다른 따옴표가 든 경로도 찾는다(PR #226의 F1). `lab/q10-db/README.md`의 "테스트가 읽는 파일" 문장을 두 파일 모두 보호 경로인 것으로 맞췄다. 검사를 약화하지 않는다.
