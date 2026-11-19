---
id: 20261119-test-skip-inert
issue: 129 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-19T12:02:12+09:00
---

# chore: 테스트가 읽지 않는 경로만 바꾼 PR에서 check의 test 단계를 건너뛴다 (Actions 사용량 절감 ②)

- 목표: 계획 파일과 `lab/` 기록만 바꾼 PR 라운드에서 `check`의 `test` 단계(CI에서 7~8분)를 돌리지 않는다(Issue #129, TD-49의 방안 ②). 검사를 건너뛰는 변경이라 제작자 승인으로 하고(R4), 건너뛰는 조건을 좁게 잡는다: 바뀐 파일이 **모두** 설정의 "테스트가 읽지 않는 경로" 안이고, 보호 경로에 드는 파일이 하나도 없고, 기본 브랜치가 아닐 때만이다. main의 `check`는 지금처럼 전부 돈다.
- 변경: `scripts/commands/check.ts`(건너뛰기 판정 `testSkip`과 `test` 단계 연결, 캐시 키에 설정 추가), `scripts/lib/config.ts`(설정 키 `testInertPaths`, 기본값 빈 배열, 형식 검증), `scripts/gates/harness-guard.ts`(판정 관련 키 목록에 `testInertPaths` 추가), `harness.config.json`(이 리포의 목록 3개), 테스트 `scripts/test/check-skip.test.ts`(새 파일)와 `scripts/test/harness-guard.test.ts`, 문서(설계서 6절·5절 R4·R7 표·변경 이력 v0.7.56, 절차서, `CHANGELOG`, TD-49).
- 검증: node --test scripts/test/check-skip.test.ts scripts/test/harness-guard.test.ts
- 그 밖의 검증: `node scripts/harness.ts check`. 구현 전에 새 테스트가 실패하는 것을 먼저 확인해 진행 로그에 적는다. 이 PR 자신은 `scripts/`를 바꾸므로 CI에서 `test`가 돌아야 한다(건너뛰면 결함이다). 병합 뒤 계획 파일만 바꾼 첫 PR에서 `– test (건너뜀 …)` 줄과 `check` 소요 시간을 확인해 Issue #129에 댓글로 남긴다.
- 비범위: 워크플로 파일(봇이 올릴 수 없고, `check.yml`이 이미 `--base`를 넘긴다). main의 중복 `check` 건너뛰기(TD-49의 ③)와 job 합치기(④). 기술 부채 표와 절차서를 목록에 넣는 일(테스트가 읽는 파일이다. 발견 사항). 프로파일(`profiles/`)에는 키를 넣지 않는다(기본값이 "건너뛰지 않음"이다).

## 관련 파일·문서

- `scripts/commands/check.ts`, `scripts/lib/config.ts`, `scripts/lib/util.ts`(`matchesAny`, 읽기만)
- `scripts/gates/harness-guard.ts`(`CONFIG_KEYS`)
- `scripts/gates/test-effect.ts`(바뀐 파일 목록을 구하는 방식, 읽기만)
- `.github/workflows/check.yml`(읽기만. PR은 `--ci --base <merge-base>`, main push는 `--base <이전 커밋>`)
- `scripts/test/helpers.ts`, `scripts/test/selftest.test.ts`, `scripts/selftest/run.ts`(테스트가 실제 리포에서 복사하는 파일 목록, 읽기만)
- 설계서 5절(R4, R7), 6절(`check`), `docs/exec-plans/tech-debt-tracker.md` TD-49
- 계획 `20261118-actions-usage`(측정과 방안 목록)

## 설계

- **설정**: `testInertPaths`(문자열 glob 배열, 리포 루트 기준 상대 경로). 없거나 비어 있으면 건너뛰지 않는다. 이 리포의 값은 `docs/exec-plans/active/**`, `docs/exec-plans/completed/**`, `lab/**`다.
- **판정**(`testSkip`): 아래가 모두 참일 때만 건너뛴다. 하나라도 아니면 지금처럼 `test`를 돌린다.
  1. `testInertPaths`가 비어 있지 않다.
  2. 비교 기준(`base`)이 있다.
  3. 현재 브랜치가 기본 브랜치가 아니고, `GITHUB_REF`가 기본 브랜치의 ref가 아니다(main push의 `check`는 전부 돈다).
  4. 바뀐 파일이 1개 이상이고, 모두 `testInertPaths`에 걸리며, `protectedPaths`에 걸리는 파일이 없다. 바뀐 파일은 `git diff --no-renames --name-only <base> [HEAD]`로 구한다(이름 바꾸기는 옛 경로와 새 경로가 모두 잡힌다). CI가 아니면 커밋하지 않은 변경과 추적되지 않은 새 파일도 센다.
- **표시**: `– test (건너뜀) (0.0s)`와 그 아래 이유 한 줄(바뀐 파일 수, 설정 키). 건너뛴 결과는 실패 기록에 남기지 않는다(기존 "해당 없음"과 같다).
- **왜 안전한가**: PR의 `check`가 보는 트리는 "main의 끝 + 이 PR의 변경"이다. 변경이 테스트가 읽지 않는 파일뿐이면 테스트 결과는 main의 끝에서 돌린 결과와 같고, 그 결과는 main의 `check`가 이미 확인했다(실패했다면 revert 흐름이 돈다). 분류가 틀렸을 때는 병합 뒤 main의 `check`가 전부 돌아 잡는다.
- **목록의 근거**: 테스트가 실제 리포에서 읽는 파일은 `scripts/**`, `.github/**`, `.claude/**`, `.gitattributes`, `harness.config.json`, `profiles/**`, `pnpm-lock.yaml`, `AGENTS.md`, `CLAUDE.md`, `docs/exec-plans/TEMPLATE*.md`, `docs/exec-plans/tech-debt-tracker.md`, `docs/harness/workflow.md`다(`helpers.ts`의 `makeFixture`, `selftest.test.ts`의 `copyHarness`, `selftest/run.ts`의 `COPY`, `HARNESS_ROOT`를 읽는 테스트들). 계획 폴더와 `lab/`은 어느 테스트도 읽지 않는다. 이 관계를 테스트 하나로 고정한다(이 리포의 설정에서 위 파일들이 건너뛰기 대상이 아님).

## 진행 로그

- 2026-11-19: 제작자 대화 지시("다음 작업도 바로 승인하니 실행해라". 앞선 보고의 방안 ②)로 봇이 Issue #129를 등록하고 시작했다. 운영 단계(`stage: operation`)의 첫 작업이다.
- 2026-11-19: 시작 전 조사. `check.yml`은 PR에서 `node scripts/harness.ts check --ci --base <merge-base>`를 부르므로 워크플로를 바꾸지 않고 `check` 안에서 판정할 수 있다. 테스트가 실제 리포에서 읽는 파일을 추렸다(위 "목록의 근거").
- 2026-11-19: **예상 효과를 다시 셌다.** 앞선 보고(TD-49, 계획 `20261118-actions-usage`)의 "병합된 PR 87개 가운데 23개, 약 300분"은 넓게 센 값이었다. 2026-11-11~18의 PR 87개를 파일 목록으로 다시 나누면: 코드·설정·워크플로를 바꾸지 않은 PR은 19개이고, 그 가운데 10개는 테스트가 읽는 문서(기술 부채 표 9개, 절차서 3개)를 바꿨다. 이 계획의 목록(계획 폴더와 `lab/`)에 모두 드는 PR은 **8개**다. 예상 절감은 8일에 약 110분(8개 × PR당 `check` 평균 1.8회 × `test` 약 7.5분), 그 기간 청구 2,399분의 약 5%다.
- 2026-11-19: 테스트를 먼저 썼다(`scripts/test/check-skip.test.ts` 새 파일 10개, `scripts/test/harness-guard.test.ts`에 단언 1개). 구현 전 `node --test scripts/test/check-skip.test.ts scripts/test/harness-guard.test.ts`: 16개 가운데 2개 실패(`check-skip.test.ts`는 `testInert`를 내보내지 않아 모듈을 읽지 못함, `harness-guard.test.ts`의 "판정 관련 키 변경"은 `testInertPaths` 신호가 없어 단언 실패).
- 2026-11-19: 구현했다. `scripts/commands/check.ts`에 `testInert`(파일 하나의 판정)와 `testSkip`(바뀐 파일 전체의 판정과 이유), `test` 단계 연결, 캐시 키. `scripts/lib/config.ts`에 `testInertPaths`(기본 `[]`, 형식 검증). `scripts/gates/harness-guard.ts`의 `CONFIG_KEYS`에 한 줄. 구현 뒤에는 "이 리포의 설정" 테스트 하나만 실패했고(`harness.config.json`에 목록이 아직 없었다), 목록을 넣은 뒤 25개가 모두 통과했다.
- 2026-11-19: 문서를 맞췄다. 설계서 v0.7.56(6절 "`test` 건너뛰기", 5절 R4·R7 표, 변경 이력), 절차서 4절, `CHANGELOG`, TD-49(②의 결과와 다시 센 수치), TD-51 등록.

## 의사결정 로그

- 결정: 계획 위험도는 높음으로 한다. / 이유: 필수 체크 `check`가 도는 범위를 줄이는 변경이다(검사 약화, R4). 운영 단계라 보호 경로(`scripts/`, `harness.config.json`, `docs/harness/`) 변경은 어차피 제작자 head 승인이 필요하다. / 버린 대안: 보통(검증자 둘과 제작자 승인은 같지만 판정 이어받기가 생긴다. 검사 약화에는 맞지 않다).
- 결정: 목록은 계획 폴더와 `lab/`만 넣는다. 기술 부채 표와 절차서는 넣지 않는다. / 이유: 두 파일은 테스트 픽스처에 복사돼 사본의 `check`(doc-lint 등)가 읽는다. 내용이 바뀌면 테스트 결과가 달라질 수 있다. 넣으면 대상 PR이 8개에서 15개(기술 부채 표 포함)로 늘지만 "테스트가 읽지 않는다"는 근거가 깨진다. / 버린 대안: `docs/**` 전체에서 테스트가 읽는 파일만 빼기(대상이 1개 늘 뿐이고, 보호 경로의 문서가 섞인다), 픽스처가 실제 기술 부채 표 대신 작은 표를 쓰게 테스트를 고친 뒤 표를 목록에 넣기(범위가 커진다. 발견 사항으로 남긴다).
- 결정: 보호 경로에 드는 파일은 `testInertPaths`에 걸려도 건너뛰는 근거로 치지 않는다. / 이유: 설정을 넓게 잘못 적어도(`docs/**` 등) 하네스 문서·설정·스크립트 변경에서는 테스트가 돈다. 설정 파일 자신이 보호 경로라, 목록을 바꾸는 PR은 항상 테스트가 돈다. / 버린 대안: 설정을 읽을 때 두 목록의 glob이 겹치는지 검사(glob끼리의 교차는 일반적으로 판정하기 어렵다).
- 결정: main의 `check`는 건너뛰지 않는다. / 이유: 분류가 틀렸을 때의 안전망이고 제작자에게 그렇게 보고했다. main까지 건너뛰는 것은 TD-49의 ③(별도 결정)이다. / 버린 대안: main도 같은 규칙으로 건너뛰기.
- 결정: 로컬 `check`에도 같은 규칙을 쓴다. / 이유: 로컬과 CI의 `check`가 같은 판정을 내야 한다(R7 "CI가 같은 검사를 다시 실행한다"). 계획만 고친 브랜치에서 로컬 `check`가 2~3분 짧아진다. / 버린 대안: `--ci`일 때만 건너뛰기.
- 결정: 프로파일(`profiles/core`, `profiles/web`)에는 키를 넣지 않는다. / 이유: 기본값이 "건너뛰지 않음"이어야 템플릿을 받은 리포의 검사가 조용히 줄지 않는다. 어떤 경로를 테스트가 읽지 않는지는 리포마다 다르다. / 버린 대안: 계획 폴더 둘을 프로파일 기본값으로 넣기.
- 결정: 기본 브랜치인지는 브랜치 이름과 `GITHUB_REF` 둘로 본다. / 이유: main push의 CI에서 체크아웃이 브랜치인지 분리된 HEAD인지에 기대지 않으려는 것이다(`actions/checkout`의 동작에 묶이지 않는다). 테스트는 `env`를 넣어 CI의 환경 변수와 무관하게 돈다. / 버린 대안: `--ci`에 `--event` 같은 인자를 더해 워크플로가 알려 주기(워크플로 파일을 바꿔야 한다).
- 결정: 바뀐 파일은 `git diff --no-renames --name-only`로 직접 구한다(`lib/git.ts`의 `changedFiles`를 쓰지 않는다). / 이유: `changedFiles`는 이름 바꾸기를 새 경로 하나로만 돌려준다. `scripts/x.ts`를 `lab/x.ts`로 옮긴 변경이 "`lab/`만 바뀜"으로 보이면 안 된다. `test-effect`도 같은 방식으로 구한다. / 버린 대안: `changedFiles`에 옵션 추가(다른 호출자의 동작을 건드린다).

## 발견 사항

- `harness-guard`의 판정 관련 키 목록에 `testEffect`가 없다(R5 검사를 끄는 설정 변경이 신호로 잡히지 않는다). 이 PR의 범위 밖이라 고치지 않았다. → 처리: TD-51
- 기술 부채 표와 절차서는 테스트 픽스처가 실제 파일을 복사해 쓴다(`helpers.ts`의 `makeFixture`, 자체 테스트의 `COPY`). 그래서 건너뛰기 목록에 넣지 못했고, 넣으면 대상 PR이 8개에서 15개로 는다. → 처리: TD-49
- 앞선 계획(`20261118-actions-usage`)의 "코드를 바꾸지 않은 PR 23개, 약 300분"은 테스트가 읽는 문서를 바꾼 PR까지 센 값이었다(다시 세면 8개, 약 110분). 예상 수치를 낼 때 "무엇을 건너뛸 수 있는가"의 조건을 먼저 정하지 않고 넓은 분류로 셌다. → 처리: TD-49
