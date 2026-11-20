---
id: 20261120-doclint-strict-gate
issue: 163 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-20T21:18:07+09:00 # new-task가 채운다
---

# doc-lint 게이트가 git 읽기 실패를 조용히 통과시키지 않게 한다 (TD-60)

## 목표와 수용 기준

`doc-lint`는 `git`으로 문서 목록(`git ls-files`)과 커밋 시각(`git log`)을 읽는다. 지금 게이트(`check`의 `doc-lint` 단계, `doc-lint` 명령)는 이 읽기가 실패하면 빈 목록·시각 0으로 넘어가, 검사 대상 없이 통과한다(기술 부채 표 TD-60, Issue #163). 검사 대상을 읽지 못한 것은 통과가 아니라 실패로 처리한다.

수용 기준:

1. 문서 목록을 읽지 못하면(`git ls-files` 실패) `doc-lint` 명령과 `check`의 `doc-lint` 단계가 실패하고(종료 코드 1), 출력에 무엇을 읽지 못했는지와 고치는 법이 있다.
2. 커밋 시각을 읽지 못하면(`git log` 실패) 같은 방식으로 실패한다.
3. 커밋이 하나도 없는 리포(`git init` 직후)는 커밋 시각을 읽을 수 없는 것이 정상이다. 실패로 치지 않고 커밋 시각 검사("검토 필요" 경고)만 건너뛴다. 다른 검사(깨진 링크, 색인 누락, frontmatter, `AGENTS.md` 줄 수)는 그대로 한다.
4. `git` 읽기가 성공하는 리포에서는 게이트의 결과(오류·경고)가 지금과 같다.
5. 지표 집계(`metrics`)의 동작은 바뀌지 않는다: 문서 조회가 실패하면 종료 코드 2다.
6. 기술 부채 표의 TD-60이 해결로 바뀐다.

## 범위 / 비범위

범위:

- `scripts/gates/doc-lint.ts`: 읽기 실패를 예외로 알리는 것을 기본 동작으로 하고(느슨한 모드를 없앤다), 게이트용 함수가 그 예외를 오류 한 건으로 바꾼다.
- 두 호출처(`scripts/commands/check.ts`의 `doc-lint` 단계, `scripts/harness.ts`의 `doc-lint` 명령)가 게이트용 함수를 쓴다.
- `scripts/metrics/local.ts`: 없어진 옵션 인자를 뺀다(동작은 같다).
- 새 테스트 파일, `CHANGELOG`, 기술 부채 표.

비범위:

- `doc-lint`의 검사 항목과 판정 기준.
- 다른 게이트(`bypass-scan`, `secret-scan`, `test-effect`)의 `git` 실패 처리.
- 지표 집계의 출력과 종료 코드.
- 설계서 본문(규칙 R8과 7.2절의 정의는 그대로다).

## 관련 파일·문서

- `scripts/gates/doc-lint.ts`
- `scripts/commands/check.ts`(`doc-lint` 단계의 호출 한 곳)
- `scripts/harness.ts`(`doc-lint` 명령의 호출 한 곳과 import)
- `scripts/metrics/local.ts`(호출 인자와 주석)
- `scripts/test/doc-lint-gate.test.ts`(새 파일)
- `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-60 행)
- 읽기만: `scripts/lib/git.ts`(`gitTry`), `scripts/test/helpers.ts`, `scripts/test/gates.test.ts`, `scripts/test/metrics-allow.ts`, `scripts/test/metrics-command.test.ts`, 설계서 7.2절

## step 목록

- step0 gate-read-failure: `git` 읽기 실패를 게이트의 실패로 만들고 TD-60을 닫는다.

## 진행 로그

- 2026-11-20 21:20 제작자 대화 지시("추천안이 모두 합리적으로 보인다. 그대로 진행해달라": TD-54의 ③ → TD-60 → Issue #155의 1단계 → TD-54의 ② 순서)로 봇이 Issue #163을 등록하고 시작했다. 계획을 썼다.

## 의사결정 로그

- 결정: 규모를 medium으로 한다. / 이유: 게이트의 동작이 바뀐다(절차서 1절: 동작이 바뀌는 변경은 medium 이상). 추천을 보고할 때는 "소규모 계획 하나"라고 했으나 규칙에 맞춰 올렸다. / 버린 대안: small(계획 검증을 거치지 않는다).
- 결정: 느슨한 모드(읽기 실패를 빈 결과로 넘김)를 없애고 `docLint`가 늘 예외를 던지게 한다. 게이트는 그 예외를 오류 한 건으로 바꾸는 함수(`docLintGate`)를 쓴다. / 이유: 게이트 둘이 옮겨 가면 느슨한 모드를 쓰는 코드가 남지 않는다. 남겨 두면 다음에 `docLint`를 부르는 코드가 모르고 느슨한 쪽을 쓴다. / 버린 대안: `strict` 옵션을 남기고 게이트만 `strict: true`로 부르기.
- 결정: 읽기 실패 때 게이트의 결과는 그 오류 한 건뿐이다(그때까지 찾은 다른 오류는 내지 않는다). / 이유: 목록을 읽지 못하면 다른 검사는 대상이 없고, 커밋 시각 실패는 드물어 고친 뒤 다시 돌리면 나머지가 나온다. 예외 하나로 끝내는 쪽이 단순하다. / 버린 대안: 실패를 모으며 끝까지 검사하기.
- 결정: 커밋 없는 리포의 판별(`git rev-parse --verify -q HEAD`)은 게이트용 함수에만 둔다. / 이유: `docLint` 안에 두면 지표 집계가 실행하는 `git` 호출이 하나 늘어 그 명령의 허용 목록과 호출 순서 테스트가 바뀐다(비범위). 지표 집계는 커밋 없는 리포에서 지금처럼 종료 코드 2다. / 버린 대안: `docLint` 안에서 판별하기.
- 결정: 설계서 본문은 고치지 않는다. / 이유: R8의 정의와 7.2절의 판정 기준은 그대로이고, "읽지 못하면 실패"는 구현의 견고함이다. `CHANGELOG` 한 줄로 남긴다. / 버린 대안: 7.2절에 문장 더하기(다른 세션의 설계서 버전과 겹친다).

## 발견 사항

- 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- step0의 Acceptance Criteria(새 테스트와 `doc-lint`·`check`·`metrics`를 다루는 기존 테스트, 기술 부채 표의 TD-60 행).
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
