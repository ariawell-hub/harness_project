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

1. 문서 목록을 읽지 못하면(`git ls-files` 실패) `doc-lint` 명령과 `check`의 `doc-lint` 단계가 실패하고(종료 코드 1), 출력에 무엇을 읽지 못했는지(실패한 `git` 조회의 이름)와 고치는 법이 있다. `check`는 `doc-lint` 단계가 실제로 도는 실행, 곧 캐시가 적중하지 않은 기본 실행과 `--no-cache` 실행에서 그렇다. 캐시가 적중한 실행은 어떤 단계도 다시 돌리지 않는다(설계서 6절: 같은 작업 트리·도구의 통과 결과를 재사용한다. CI는 캐시를 쓰지 않는다).
2. 커밋 시각을 읽지 못하면(`git log` 실패) 같은 방식으로 실패한다.
3. 커밋이 하나도 없는 리포는 커밋 시각을 읽을 수 없는 것이 정상이다. 실패로 치지 않고 커밋 시각 검사("검토 필요" 경고)만 건너뛴다. 다른 검사(깨진 링크, 색인 누락, frontmatter, `AGENTS.md` 줄 수)는 그대로 한다. "커밋이 없는 리포"는 HEAD가 브랜치를 가리키고 그 브랜치의 ref가 아예 없는 리포다(`git init` 직후, `checkout --orphan` 직후). ref가 있는데 읽을 수 없는 리포(내용이 손상됐거나 없는 객체를 가리킨다)는 여기에 들지 않는다. 커밋이 없는 리포가 아니면 HEAD의 커밋을 읽을 수 있어야 하고, 읽지 못하면 커밋 시각이 필요한 문서가 하나도 없어도 읽기 실패다.
4. `git` 읽기가 성공하는 리포에서는 게이트의 결과(오류·경고)가 지금과 같다.
5. 지표 집계(`metrics`)의 동작은 바뀌지 않는다: 문서 조회가 실패하면 종료 코드 2다.
6. `check`가 캐시 키를 만들지 못하면(작업 트리 해시 계산이 실패한다) 예외로 끝나지 않고 캐시 없이 검사 단계를 실행한다. 그 실행의 결과는 캐시에 남지 않는다. 1의 "기본 실행"이 `doc-lint` 단계까지 가려면 필요하다(색인이 손상되면 캐시 키 계산이 먼저 실패한다).
7. 기술 부채 표의 TD-60이 해결로 바뀐다.

## 범위 / 비범위

범위:

- `scripts/gates/doc-lint.ts`: 읽기 실패를 예외로 알리는 것을 기본 동작으로 하고(느슨한 모드를 없앤다), 게이트용 함수가 그 예외를 오류 한 건으로 바꾼다.
- 두 호출처(`scripts/commands/check.ts`의 `doc-lint` 단계, `scripts/harness.ts`의 `doc-lint` 명령)가 게이트용 함수를 쓴다.
- `scripts/commands/check.ts`: 캐시 키를 만들지 못하면 캐시 없이 실행한다.
- `scripts/metrics/local.ts`: 없어진 옵션 인자를 뺀다(동작은 같다).
- 새 테스트 파일, `CHANGELOG`, 기술 부채 표.

비범위:

- `doc-lint`의 검사 항목과 판정 기준.
- 다른 게이트(`bypass-scan`, `secret-scan`, `test-effect`)의 `git` 실패 처리.
- 지표 집계의 출력과 종료 코드.
- `check` 캐시의 정의(설계서 6절). 캐시가 적중하면 `doc-lint`를 포함해 모든 단계가 돌지 않고, 캐시 키는 `git` 이력의 상태를 담지 않는다. `git`을 읽는 다른 단계도 같다. 병합 판정(CI)은 캐시를 쓰지 않는다.
- 설계서 본문(규칙 R8과 7.2절의 정의는 그대로다).

## 관련 파일·문서

- `scripts/gates/doc-lint.ts`
- `scripts/commands/check.ts`(`doc-lint` 단계의 호출 한 곳, 시작할 때의 캐시 키 계산)
- `scripts/harness.ts`(`doc-lint` 명령의 호출 한 곳과 import)
- `scripts/metrics/local.ts`(호출 인자와 주석)
- `scripts/test/doc-lint-gate.test.ts`(새 파일)
- `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-60 행)
- 읽기만: `scripts/lib/git.ts`(`gitTry`, `worktreeTreeHash`), `scripts/test/check-skip.test.ts`, `scripts/test/helpers.ts`, `scripts/test/gates.test.ts`, `scripts/test/metrics-allow.ts`, `scripts/test/metrics-command.test.ts`, 설계서 7.2절

## step 목록

- step0 gate-read-failure: `git` 읽기 실패를 게이트의 실패로 만들고 TD-60을 닫는다.

## 진행 로그

- 2026-11-20 21:20 제작자 대화 지시("추천안이 모두 합리적으로 보인다. 그대로 진행해달라": TD-54의 ③ → TD-60 → Issue #155의 1단계 → TD-54의 ② 순서)로 봇이 Issue #163을 등록하고 시작했다. 계획을 썼다.
- 2026-11-20 21:28 PR #164 계획 검증 1라운드(head `dde3e04`): claude 승인(P2 1, 미룸), codex 수정 요청(P1 3). 셋 다 수용해 계획을 고쳤다.
  - F2(P1, codex. claude의 F1(P2)과 같은 곳) `git rev-parse --verify -q HEAD`의 종료 코드 1만으로는 커밋 없는 리포와 손상된 ref를 가를 수 없다 → 수용. 임시 리포에서 확인했다: ref 파일의 내용이 쓰레기이거나 비어 있으면 그 명령이 1로 끝난다(커밋 없는 리포와 같다). 판별을 "HEAD가 브랜치를 가리키고(`git symbolic-ref -q HEAD` 종료 코드 0) 그 ref가 없다(`git show-ref --verify -q`가 1이고 ref 파일도 없다)"로 좁혔다. 확인한 값: 커밋 없는 리포는 `symbolic-ref` 0·`show-ref` 1·파일 없음, 쓰레기·빈 ref는 `symbolic-ref` 128·`show-ref` 1·파일 있음, 없는 객체를 가리키는 ref는 `symbolic-ref` 0·`show-ref` 128.
  - F3(P1, codex) 기본 `check`는 캐시 키를 만들다 손상된 색인에서 예외로 끝나 `doc-lint` 단계에 가지 못한다 → 수용. 확인했다: 지금 코드에서 `check --only doc-lint`가 `git add -A 실패`와 스택으로 종료 코드 1이다(조용한 통과는 아니지만 고치는 법이 없다). 캐시 키를 만들지 못하면 캐시 없이 실행하게 한다(수용 기준 6, step0 작업 2).
  - F4(P1, codex) CLI 테스트가 실패한 조회의 이름과 고치는 법을 단언하지 않고, 커밋 시각 실패에서는 `check`를 부르지 않는다 → 수용. 두 읽기 실패 모두에서 세 실행(`doc-lint`, `check --only doc-lint`, 같은 명령에 `--no-cache`)의 종료 코드와 출력을 단언하게 했다.
- 2026-11-20 21:38 PR #164 계획 검증 2라운드(head `bcc8ff3`): claude 승인(지적 없음), codex 수정 요청. F2·F3·F4는 닫혔고(fixed) 새 P1이 둘 나왔다.
  - F6(P1, codex) 커밋 시각이 필요한 문서가 하나도 없으면 손상된 ref에서도 `git log`가 불리지 않아 통과한다 → 수용. 게이트가 커밋이 없는 리포가 아니면 HEAD의 커밋을 읽을 수 있는지 한 번 확인하게 했다(`git rev-parse --verify -q HEAD^{commit}`). 임시 리포에서 확인했다: 정상·분리된 HEAD는 0, 쓰레기·빈 ref와 없는 객체는 1이다.
  - F5(P1, codex) 캐시가 적중하면 `doc-lint`가 돌지 않아, 통과가 캐시된 뒤 작업 트리는 그대로인데 커밋 객체만 잃은 리포의 `git log` 실패를 놓친다 → 반박 1회(근거 `docs/harness/design.md:439`). 캐시 적중이 어떤 단계도 다시 돌리지 않는 것은 6절의 정의이고 `git`을 읽는 다른 단계도 같다. CI는 캐시를 쓰지 않아 병합 판정에서는 늘 돈다. 다만 수용 기준 1의 문장("캐시를 쓰는 기본 실행")이 캐시 적중까지 약속하는 것으로 읽혀, "단계가 실제로 도는 실행"으로 고치고 캐시의 정의를 비범위에 적었다.

## 의사결정 로그

- 결정: 규모를 medium으로 한다. / 이유: 게이트의 동작이 바뀐다(절차서 1절: 동작이 바뀌는 변경은 medium 이상). 추천을 보고할 때는 "소규모 계획 하나"라고 했으나 규칙에 맞춰 올렸다. / 버린 대안: small(계획 검증을 거치지 않는다).
- 결정: 느슨한 모드(읽기 실패를 빈 결과로 넘김)를 없애고 `docLint`가 늘 예외를 던지게 한다. 게이트는 그 예외를 오류 한 건으로 바꾸는 함수(`docLintGate`)를 쓴다. / 이유: 게이트 둘이 옮겨 가면 느슨한 모드를 쓰는 코드가 남지 않는다. 남겨 두면 다음에 `docLint`를 부르는 코드가 모르고 느슨한 쪽을 쓴다. / 버린 대안: `strict` 옵션을 남기고 게이트만 `strict: true`로 부르기.
- 결정: 읽기 실패 때 게이트의 결과는 그 오류 한 건뿐이다(그때까지 찾은 다른 오류는 내지 않는다). / 이유: 목록을 읽지 못하면 다른 검사는 대상이 없고, 커밋 시각 실패는 드물어 고친 뒤 다시 돌리면 나머지가 나온다. 예외 하나로 끝내는 쪽이 단순하다. / 버린 대안: 실패를 모으며 끝까지 검사하기.
- 결정: 커밋 없는 리포의 판별(`git symbolic-ref`와 `git show-ref`, ref 파일의 유무)은 게이트용 함수에만 둔다. / 이유: `docLint` 안에 두면 지표 집계가 실행하는 `git` 호출이 하나 늘어 그 명령의 허용 목록과 호출 순서 테스트가 바뀐다(비범위). 지표 집계는 커밋 없는 리포에서 지금처럼 종료 코드 2다. / 버린 대안: `docLint` 안에서 판별하기.
- 결정: 설계서 본문은 고치지 않는다. / 이유: R8의 정의와 7.2절의 판정 기준은 그대로이고, "읽지 못하면 실패"는 구현의 견고함이다. `CHANGELOG` 한 줄로 남긴다. / 버린 대안: 7.2절에 문장 더하기(다른 세션의 설계서 버전과 겹친다).
- 결정: 커밋 없는 리포가 아닌 모든 경우(분리된 HEAD, 손상된 ref, `git` 리포가 아닌 폴더, 판별 명령의 실패)는 따로 가르지 않고 보통의 경로(`docLint(root, cfg)`)로 보낸다. / 이유: 그 경로에서 `git ls-files`나 `git log`가 실패하면 읽기 실패로 보고된다. 판별이 틀려도 "커밋 없음"으로 잘못 넘어가지 않는 쪽으로만 틀린다. / 버린 대안: 판별 명령의 종료 코드마다 오류를 따로 만들기.
- 결정: `check`가 캐시 키를 만들지 못하면 캐시 없이 실행한다(PR #164의 F3). / 이유: 캐시는 통과한 결과를 다시 쓰려는 부가 기능이다. 키를 못 만들면 모든 단계를 실제로 돌리는 쪽이 안전하고, 단계가 고치는 법과 함께 실패를 보고한다. 끝날 때의 캐시 쓰기는 이미 같은 방식이다(키를 다시 만들지 못하면 쓰지 않는다). / 버린 대안: 수용 기준을 `--no-cache` 실행으로 좁히기(기본 실행이 스택으로 끝나는 것이 남는다).
- 결정: 캐시가 적중한 `check`에서 `doc-lint`를 다시 돌리지 않는다(PR #164의 F5에 반박). / 이유: 캐시 적중의 뜻이 "같은 작업 트리·도구로 이미 통과했다"이고(설계서 6절), 그 사이에 커밋 객체만 사라지는 경우는 리포 손상이다. 캐시 키에 이력의 상태를 넣거나 적중 때 일부 단계를 다시 돌리면 캐시의 정의가 바뀌고 `git`을 읽는 다른 단계와도 어긋난다. 병합 판정은 CI가 캐시 없이 한다. / 버린 대안: 캐시 적중 때도 `doc-lint`를 실행하기.
- 결정: 게이트가 HEAD의 커밋을 읽을 수 있는지 따로 확인한다(PR #164의 F6). 확인은 문서 검사 뒤에 한다. / 이유: 커밋 시각이 필요한 문서가 없으면 `git log`가 불리지 않아 손상된 ref가 드러나지 않는다. 문서 검사를 먼저 하면 `git ls-files`·`git log`의 실패는 지금처럼 그 조회의 이름으로 보고된다. / 버린 대안: HEAD 확인을 먼저 하기(커밋 시각 읽기 실패가 모두 `git rev-parse` 실패로 보고된다).

## 발견 사항

- 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- step0의 Acceptance Criteria(새 테스트와 `doc-lint`·`check`·`metrics`를 다루는 기존 테스트, 기술 부채 표의 TD-60 행).
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
