---
id: 20261123-corepack-version
issue: 233 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-23T21:52:11+09:00
---

# Q10 실측: CI 러너에서 trial.ts가 Corepack의 다운로드 안내를 pnpm 버전으로 읽어 실패한다

- 목표: 워크플로 `q10-trial`의 두 job(`ubuntu-latest`, `windows-latest`)이 `trial` 단계의 pnpm 버전 확인을 통과한다. `lab/q10-db/trial.ts`가 `pnpm --version`의 표준 출력에서만 버전을 읽는다. 읽은 버전을 리포가 고정한 `packageManager`와 글자 그대로 견주는 판정은 바꾸지 않는다(느슨하게 하지 않는다).
- 변경: 버전을 읽는 순수 함수 `readPnpmVersion`을 새 파일 `lab/q10-db/pnpm-version.ts`에 두고(`trial.ts`는 불러오기만 해도 실측이 돌아 테스트가 불러올 수 없다), `trial.ts`의 `pnpm()`이 표준 출력과 표준 오류를 따로 돌려준다. 오류 메시지와 정책 확인(`probePolicy`)이 쓰는 이어 붙인 출력(`out`)은 그대로다.
- 검증: `node --test lab/q10-db/test/pnpm-version.test.ts`, `node --test lab/q10-db/test/check-results.test.ts lab/q10-db/test/run.test.ts`, 빈 Corepack 캐시로 CI와 같은 조건을 만들어(새 임시 폴더의 `COREPACK_HOME`, `corepack enable --install-directory`로 만든 `pnpm`을 `PATH` 앞에) 새 임시 복제본에서 `node lab/q10-db/run.ts --skip-fmt`를 돌린다(고치기 전에는 CI와 같은 메시지로 실패, 고친 뒤 통과). `node scripts/harness.ts check`. 병합 뒤 계획 `20261121-q10-confirm` step1에서 워크플로를 다시 돌려 두 job을 본다.

## 관련 파일·문서

- `lab/q10-db/pnpm-version.ts`
- `lab/q10-db/test/pnpm-version.test.ts`
- `lab/q10-db/trial.ts`(pnpm 버전을 읽는 곳과 `pnpm()`의 돌려주는 값만)
- 읽기만: `lab/q10-db/check-results.ts`, `lab/q10-db/run.ts`, `.github/workflows/q10-trial.yml`, `docs/exec-plans/active/20261121-q10-confirm/step1.md`(작업 1: 스크립트의 문제는 별도 PR로 먼저 고친다)

## 테스트 (먼저 쓴다)

- `lab/q10-db/test/pnpm-version.test.ts`(새 파일, `node:test`): 표준 출력의 버전을 읽는다, 표준 오류에 Corepack 안내가 있어도 표준 출력의 버전이다, 표준 오류만 있으면 빈 글, CRLF·앞뒤 공백을 뺀다, 여러 줄이면 비어 있지 않은 마지막 줄, 출력이 없으면(`null` 포함) 빈 글.
- `trial.ts`는 불러오기만 해도 실측이 돌아 단위 테스트로 부를 수 없다. `trial.ts`가 이 함수를 쓰는지는 위 "검증"의 실제 실행(고치기 전 실패, 고친 뒤 통과)으로 본다.

## 진행 로그

- 2026-11-23 접수: 계획 `20261121-q10-confirm` step1에서 `gh workflow run q10-trial.yml --ref main`을 돌렸다(실행 45177957783, main `85cac33`). 두 job이 모두 `trial` 단계에서 `trial: 쓰는 pnpm(! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.34.5.tgz)이 이 리포가 고정한 pnpm@10.34.5와 다르다`로 실패했다. step1.md 작업 1("스크립트의 문제면 별도 PR로 먼저 고친다")대로 Issue #233을 등록하고 시작했다.
- 2026-11-23 재현(이 Mac, macOS arm64): 빈 `COREPACK_HOME`과 `corepack enable --install-directory`로 만든 `pnpm`으로 `pnpm --version`을 돌리면 표준 출력은 `10.34.5`, 표준 오류는 `! Corepack is about to download …`다. `trial.ts`는 둘을 이어 붙인 글의 마지막 줄을 읽어 안내 줄을 버전으로 본다. 같은 조건으로 main(`85cac33`)의 새 임시 복제본에서 `node lab/q10-db/trial.ts <빈 폴더>`를 돌리자 CI와 같은 메시지로 종료 코드 1이었다. 이 Mac의 평소 `pnpm`은 Homebrew 것이라 Corepack을 거치지 않아 드러나지 않았다.
- 2026-11-23 테스트를 먼저 썼다: `node --test lab/q10-db/test/pnpm-version.test.ts`가 `pnpm-version.ts`가 없어 실패했다(`ERR_MODULE_NOT_FOUND`, 통과 0). 구현 뒤 6건 통과.
- 2026-11-23 고친 커밋(`92b094c`)의 새 임시 복제본에서, 위 재현과 같은 조건(빈 `COREPACK_HOME`, Corepack의 `pnpm`)으로 `node lab/q10-db/run.ts --skip-fmt`를 돌렸다: 종료 코드 0. `trial: lab/q10-db/results/darwin-arm64.json을 썼다` → `darwin-arm64: 통과` → 검사 스크립트의 테스트 75건 통과. 복제본의 결과 파일은 리포의 것과 포맷(`installScripts` 배열의 줄바꿈)만 다르다. Windows는 이 Mac에서 돌릴 수 없어 병합 뒤 CI의 `windows-latest` job으로 본다.

## 의사결정 로그

- 결정: 버전은 표준 출력에서만 읽는다. / 이유: `pnpm --version`은 버전을 표준 출력에 쓰고, Corepack의 안내는 표준 오류에 쓴다(재현). 판정(`pnpm@<읽은 버전>`이 리포의 `packageManager`와 같아야 한다)은 그대로라, 표준 출력에 다른 글이 오면 여전히 실패한다. / 버린 대안: 워크플로나 `trial.ts`에서 `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`을 주기(워크플로는 제작자가 올려야 하고, 손으로 돌리는 PC마다 같은 설정이 필요하다), 이어 붙인 출력에서 버전 꼴의 줄을 찾기(어느 출력에서 왔는지 가려진다).
- 결정: 위험도 normal. / 이유: 실험 폴더(`lab/`)의 실행 스크립트에서 출력을 읽는 곳만 고친다. 보호 경로·판정 기준·권한을 바꾸지 않는다. 보안·인증·마이그레이션·데이터 스크립트가 아니다(절차서 1절).

## 발견 사항

없음.

## 검증 결과

- `node --test lab/q10-db/test/pnpm-version.test.ts`: 6건 통과(구현 전에는 모듈이 없어 실패).
- `node --test lab/q10-db/test/check-results.test.ts lab/q10-db/test/run.test.ts`: 통과(아래 실행에서 75건, 이 작업 트리에서도 통과).
- 빈 Corepack 캐시 조건의 실제 실행: 고치기 전(main `85cac33`) CI와 같은 메시지로 실패, 고친 뒤(`92b094c`) `node lab/q10-db/run.ts --skip-fmt` 종료 코드 0(진행 로그).
- `node scripts/harness.ts check`: 통과(이 Mac. 바뀐 파일이 모두 `testInertPaths` 안이라 `test`는 건너뛰었다).
