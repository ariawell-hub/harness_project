# 변경 조각: 20261125-symlink-main-s0

## CHANGELOG

- 링크를 거친 경로로 불린 L1 훅이 검사를 건너뛰지 않는다(Issue #237. 검사를 약화하지 않는다): 리포를 링크한 폴더, macOS의 `/tmp`·`/var` 아래, Windows의 정션으로 열면 `scripts/hooks/guard.ts`의 직접 실행 판정이 거짓이 되어 훅이 검사 없이 종료 코드 0으로 끝났다. 진입 파일 `guard.ts`는 판정 없이 늘 검사하고, 판정 코드는 `scripts/hooks/decide.ts`(새 파일)로 옮겼다(규칙·메시지 그대로). 진입 파일은 판정 모듈을 `try` 안에서 불러와, 불러오지 못하는 오류도 종료 코드 2로 막는다(전에는 종료 코드 1로 끝나 막지 않았다). 세션 훅(`scripts/hooks/session.ts`)과 `verify` 웹 구현(`scripts/verify/web.ts`)은 두 경로를 실제 경로로 견주는 `isEntry`(`scripts/lib/entry.ts`, 새 파일)를 쓴다. 테스트는 `scripts/test/entry.test.ts`·`entry-link.test.ts`(새 파일)이고 `guard.test.ts`는 import 줄만 바꿨다. `lab/` 스크립트의 같은 판정은 TD-70.

## 설계서 변경 이력

- 13.1절 "훅 구현 규칙"에 "진입 파일" 항목을 더했다: L1 훅 진입 파일은 직접 실행을 판정하지 않고 늘 검사하며 판정 모듈을 불러오지 못해도 종료 코드 2로 막는다. 테스트가 함수를 import하는 진입 스크립트는 실제 경로로 견준다(`isEntry`). 같은 절의 "남는 위험"에 불러오기 오류는 막는다는 것을 적었다. 규칙은 약화하지 않았다(Issue #237)
