---
id: 20261125-approval-main-merge
issue: 243 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-25T10:32:13+09:00 # new-task가 채운다
---

# 승인 요청 뒤 main 병합 갱신 push를 L1 훅이 막는다(main에서 들어온 커밋을 새 커밋으로 센다)

## 목표와 수용 기준

승인 요청(`pr-ready`) 뒤에 main이 움직이면, PR 브랜치를 `origin/main` 병합만으로 갱신한 push도 L1 훅이 `[승인 요청 뒤 push]`로 막는다(PR #236, 2026-11-25). 원인은 `scripts/lib/approval.ts`의 `approvalPending`이 `git rev-list --count --no-merges <표시>..HEAD`로 세서, 병합으로 들어온 main 커밋(#207의 squash 커밋 `a06b7fd`)까지 "새 커밋"으로 센 것이다. 절차서 5절과 훅 안내문은 "main 병합 갱신은 막지 않는다"고 한다. 막을지를 커밋 수가 아니라 "PR이 기본 브랜치에 더하는 변경이 표시 때와 같은가"로 정해 문서와 맞춘다(의사결정 로그 2). 같은 push에서 본 TD-38의 미확인 사례도 기록한다.

수용 기준(아래 "기본 브랜치"는 원격 추적 ref `refs/remotes/<github.remote>/<github.defaultBranch>`, 이 리포는 `origin/main`. "PR 파일"은 기본 브랜치와의 merge-base 대비 PR이 바꾼 파일):

1. 승인 요청 표시 뒤 기본 브랜치에 새 커밋이 생기고, PR 브랜치가 그것을 병합만 했으면 `approvalPending`이 0을 돌려주고 훅이 그 push를 막지 않는다. "병합만"은 표시 때 PR 파일이 하나 이상 있고 셋을 모두 만족하는 것이다: 표시와 HEAD의 PR 파일 목록이 같다, PR 파일의 내용이 표시와 HEAD에서 바이트 단위로 같다, 그사이 기본 브랜치가 PR 파일을 바꾸지 않았다(승인 이어받기, 설계서 10.3절과 같은 꼴). 원격·기본 브랜치 이름은 메인 체크아웃의 설정을 따르고(기본값과 다른 이름이어도), 설정이 없으면 `origin`·`main`이다.
2. 그 밖에는 막는다(1 이상을 돌려준다): 직접 만든 커밋, 기본 브랜치가 아닌 브랜치를 병합해 들어온 변경, 병합 커밋 안에 섞인 변경, 기본 브랜치가 PR 파일을 바꾼 뒤의 병합, PR 브랜치가 squash 아닌 병합으로 기본 브랜치에 들어간 뒤의 갱신. 돌려주는 수는 표시 뒤 병합 아닌 커밋 가운데 기본 브랜치에 없는 것의 수(같은 커밋은 한 번)이고, 그 수가 0이면 1이다.
3. HEAD가 표시와 같으면 0이다(기본 브랜치가 표시를 품은 뒤 fetch만 한 경우도). 기본 브랜치의 원격 추적 ref가 없거나, 표시가 HEAD의 조상이 아니거나, 새 비교의 git 명령(merge-base, diff)이 실패하면(공통 조상이 없는 ref 등) 예전처럼 표시 뒤의 병합 아닌 커밋을 모두 센다. 이름이 같은 로컬 브랜치(`refs/heads/origin/main`)는 원격 추적 ref로 쓰지 않는다.
4. 기존 승인 요청 규칙 테스트(`scripts/test/guard.test.ts`의 "승인 요청 규칙…" 세 개)와 `pr-ready`·runner PR 테스트가 고치지 않은 채 통과한다.
5. `docs/exec-plans/tech-debt-tracker.md`의 TD-38에 관찰을 적는다: 2026-11-25, PR #236의 갱신 push `d426343..fd2f6f6`, `workflow` 권한 없는 봇 토큰, main의 워크플로 변경(#207 `.github/workflows/check.yml`)을 병합으로 가져온 push를 GitHub이 받아들였다. "여전히 보지 못한 것"에서 그 사례를 뺀다(워크플로를 바꾼 커밋의 revert push는 남긴다).
6. 문서가 새 판정을 적는다: `docs/harness/architecture.md`의 `lib/approval.ts` 줄, 절차서 5절의 L1 훅 문장(`docs/harness/workflow.md`), 훅 안내문(`scripts/hooks/rules.ts`의 `승인 요청 뒤 push` 고치는 법). 변경 조각 `docs/harness/changes/20261125-approval-main-merge-s0.md`의 `## CHANGELOG`에 이 변경을 적은 한 줄이 있다.

## 범위 / 비범위

- 범위: `approvalPending`의 판정, 그 회귀 테스트, 위 문서·안내문.
- 비범위:
  - 원격 추적 ref를 일부러 옮기는 우회(`git update-ref`) 대비. L1 훅은 실수를 막는 장치이고 일부러 하는 우회는 R4 위반이다(설계서 5절 보장 수준).
  - runner의 승인 요청 표시 처리(`scripts/runner/run.ts`). runner는 이 훅을 거치지 않고 표시만 읽고 쓴다.
  - 승인 이어받기(`scripts/ci/binding.ts`)의 코드. 같은 꼴로 판정하지만 CI 쪽 코드는 고치지도 가져오지도 않는다(`lib/`가 `ci/`에 기대지 않게).
  - 자체 테스트 시나리오. 새 규칙이 아니라 기존 규칙의 판정을 고친다.

## 관련 파일·문서

- `scripts/lib/approval.ts`
- `scripts/hooks/rules.ts`
- `scripts/test/guard.test.ts`
- `docs/harness/architecture.md`
- `docs/harness/workflow.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/harness/changes/20261125-approval-main-merge-s0.md`
- 읽기만: `scripts/hooks/guard.ts`, `scripts/commands/pr-ready.ts`, `scripts/ci/binding.ts`, `scripts/lib/config.ts`, `scripts/lib/git.ts`, `scripts/test/helpers.ts`

## step 목록

- step0 main-merge: `approvalPending`이 PR의 변경이 그대로인 main 병합 갱신을 막지 않게 하고 TD-38 관찰을 적는다

## 진행 로그

- 2026-11-25 10:32 제작자 대화 지시("이슈 등록하고 바로 진행해라")로 Issue #243을 등록하고 `new-task`로 시작했다. 위험도는 high로 정했다(의사결정 로그 1).
- 2026-11-25 10:41 계획만 담아 초안 PR #244를 열었다(`302426a`). 계획 검증 1회차: claude 승인, codex 수정 요청 P1 4건. 모두 받아들여 계획을 고쳤다.
  - F1(기본 브랜치에서 닿는 직접 커밋까지 뺀다): 셈 방식을 첫 부모 줄기 기준으로 바꿨다.
  - F2(테스트가 설정의 원격·기본 브랜치를 확인하지 않는다): 기본값과 다른 이름을 설정한 테스트를 더했다(step0 작업 2).
  - F3(문서 AC가 TD-38 목록 정정과 CHANGELOG 한 줄을 확인하지 않는다), F4(테스트 보존 AC가 git 실패를 통과로 본다): AC를 고쳤다.
- 2026-11-25 10:51 계획 검증 2회차(`08b666f`): claude 승인, codex 수정 요청. F1·F2·F4는 `fixed`, F3은 열림, 새 P1 2건.
  - F5(기본 브랜치가 나중에 토픽 브랜치로 fast-forward되면 들여온 커밋이 빠진다), F6(여러 병합 부모가 공유하는 커밋을 두 번 센다): 커밋 그래프로 출처를 가리는 방식을 버리고, PR이 기본 브랜치에 더하는 변경을 표시 때와 견주는 방식으로 바꿨다(의사결정 로그 2). 수는 메시지에만 쓰고 고유 커밋으로 센다.
  - F3(TD-38 AC가 목록 밖의 문구도 인정하고, CHANGELOG AC가 내용을 보지 않는다): TD-38의 "여전히 보지 못한 것" 구간과 관찰 구간을 따로 보고, CHANGELOG 줄의 내용을 보게 AC를 고쳤다.
- 2026-11-25 11:10 계획 검증 3회차(`9cca8e3`): claude 승인, codex 수정 요청. F5·F6은 `fixed`, F3은 열림, 새 P1 3건. 모두 받아들여 고쳤다.
  - F7(기본 브랜치가 표시를 품은 뒤 fetch만 해도 HEAD가 그대로인데 막는다): HEAD가 표시와 같으면 0을 돌려준다(수용 기준 3).
  - F8(새 비교가 실패하면 null이 되어 예전에 막던 직접 커밋을 허용한다): 새 비교를 끝내지 못하면 예전 셈으로 돌아간다(수용 기준 3).
  - F9(병합 커밋 안에만 섞인 변경을 막는지 테스트가 없다): 그 사례의 테스트를 더했다(step0 작업 2 테스트 D).
  - F3(CHANGELOG AC가 정책과 반대인 문장도 통과시킨다): CHANGELOG 한 줄에 정해 둔 허용 조건·차단 대상 문구가 그대로 있는지 본다.
- 2026-11-25 11:32 계획 검증 4회차(`8de5889`): claude 승인, codex 수정 요청. F7·F8·F9는 `fixed`. F3만 열려 있다(TD-38 관찰 구간 AC가 push 범위와 "받아들였다"만 보고 토큰 권한·#207 병합 기록은 보지 않는다). 재판정 3회 뒤에도 열려 있어(`pr-state`의 오래 열린 지적) 절차서 8절대로 제작자에게 물었다. 제작자 답(대화): "A: 한 번 더 고친다". TD-38 관찰 구간에 정해 둔 문장 전체가 글자 그대로 있는지 보게 AC를 고쳤다.
- 2026-11-25 11:44 계획 검증 5회차(`d5f4b02`): claude 승인, codex 수정 요청. F3만 열려 있다(관찰 구간을 제목부터 TD-38 행 끝까지로 잡아, 문장을 상태 열에만 적어도 통과한다). 재판정 4회 뒤에도 열려 있어 다시 제작자에게 물었다. 제작자 답(대화): "A: 한 번 더 고친다". AC가 TD-38 행이 하나인지 보고, 설명 열만 잘라 두 제목이 차례로 붙어 있는지 확인한 뒤, 각 구간을 다음 굵은 제목이나 칸 끝에서 잘라 검사하게 고쳤다. 원본은 통과하고 변형본 6개(문장을 상태 열로 옮김, 뒤 구간에 적음, 제목 하나씩 삭제, 사이에 제목 끼움, 행 중복)는 실패하는 것을 확인했다.
- 2026-11-25 12:20 계획 검증 6회차(`b122715`): claude 승인, codex 수정 요청. F3만 열려 있다(AC가 양옆에 공백이 있는 `|`만 칸 경계로 봐서, 공백 없는 `|`로 칸을 더 만들면 다른 칸의 문장도 설명 열로 읽는다). 재판정 5회 뒤에도 열려 있어 다시 제작자에게 물었다. 제작자 답(대화): "A: 한 번 더 고친다". AC가 TD-38 행을 모든 `|`로 나눠 칸이 정확히 5개일 때만 둘째 칸을 보게 고쳤다. 원본은 통과하고, 앞의 변형본 6개와 공백 없는·있는 `|`로 "본 것" 구간을 다음 칸으로 밀어낸 변형본 2개는 실패하는 것을 확인했다.
- 2026-11-25 12:25 계획 검증 7회차(`3c23e63`): claude·codex 승인, 차단 지적 없음(전체 9, F1~F9 `fixed`). 계획 검증(G1) 통과.
- 2026-11-25 12:35 step0 구현을 커밋했다(`a23bf81`). 계획 검증 동안 worktree에 두었던 구현이다: `approvalPending`의 내용 기반 판정, 회귀 테스트 6개(A~F), `rules.ts` 안내문, 절차서 5절·architecture 문구, TD-38 관찰, 변경 조각. step0 AC 7줄 통과, 구현을 포함한 `check` 통과(test-effect: `guard.test.ts`가 base에서 단언 실패). step0 완료.
- 2026-11-25T12:59:51+09:00 step0 재작업: 구현 판정 F10(P1, codex): diff.ignoreSubmodules 설정이 승인 요청 뒤 gitlink 변경을 숨긴다. git diff에 --ignore-submodules=none을 붙이고 회귀 테스트를 더한다
- 2026-11-25 13:05 F10 대응: 구현 판정 1회차(`6a35c71`)는 claude 승인, codex 수정 요청 P1 1건(F10). 받아들였다. `diff.ignoreSubmodules=all`을 설정하고 표시 뒤 gitlink를 더한 커밋이 막히는지 보는 테스트를 먼저 더해 실패(0)를 확인했고, `changedNames`의 `git diff`에 `--ignore-submodules=none`을 붙여 통과시켰다(승인 요청 규칙 테스트 10개 통과). step0 다시 완료.

## 의사결정 로그

1. 결정: 계획 위험도 `high`. 이유: L1 훅이 막는 범위를 줄이는 변경이라 기준(보안)에 해당하는지 애매하고, 애매하면 high다(절차서 1절). 보호 경로(`scripts/`)라 운영 단계에서는 어차피 제작자 head 승인 대상이다. 버린 대안: normal(검사 약화가 아니라 오판 수정으로 볼 수도 있지만 판단을 낮춰 적지 않는다).
2. 결정(계획 검증 2회차 F5·F6으로 다시 고침): 막을지를 커밋 그래프가 아니라 내용으로 정한다. 표시와 HEAD의 PR 파일 목록이 같고, PR 파일 내용이 바이트 단위로 같고, 그사이 기본 브랜치가 PR 파일을 바꾸지 않았으면 0(막지 않음). 이 셋이면 HEAD는 "그때의 main + 표시 때의 PR 변경"이다. 승인 이어받기(설계서 10.3절)가 main 병합 갱신을 알아보는 조건과 같은 꼴이다. 이유: 절차서 5절이 허용하는 갱신은 PR의 변경은 그대로 두고 main만 따라가는 것이다. 지금의 기본 브랜치 ref로는 과거 병합이 main 병합이었는지 가릴 수 없다(F5: main이 나중에 토픽으로 fast-forward되면 판정이 바뀐다). 내용 비교는 그래프 모양과 상관없고, 병합 커밋 안에 섞인 변경도 잡는다. F5의 상황(토픽을 병합한 뒤 main이 그 토픽으로 fast-forward)에서는 토픽의 변경이 이미 main에 있고 PR이 더하는 변경이 표시 때와 같으므로 막지 않는다. 대가: 그사이 main이 PR 파일을 바꾼 병합 갱신은 막힌다. 이때는 CI도 승인을 이어받지 않고 다시 판정하므로, 봇은 제작자에게 알리고 `pr-ready --undo` 절차를 밟는다. 버린 대안: 기본 브랜치에서 닿는 커밋을 집합으로 빼기(1회차 계획, F1), 첫 부모 줄기와 기본 브랜치 첫 부모 줄기로 병합 출처 가리기(2회차 계획, F5·F6), patch-id 비교(공백 차이를 보지 못한다. `scripts/ci/binding.ts`의 `samePrContent` 주석), 원격 추적 ref의 reflog 시각으로 출처 가리기(시각에 기댄다).
3. 결정: ref 이름은 `refs/remotes/…` 전체로 쓰고, 원격·기본 브랜치 이름은 `pr-ready`처럼 메인 체크아웃의 `harness.config.json`(`github.remote`, `github.defaultBranch`)에서 읽는다. 설정을 못 읽으면 `origin`·`main`을 쓴다. 이유: 짧은 이름 `origin/main`은 같은 이름의 로컬 브랜치가 먼저 잡힌다. 원격 추적 ref가 없으면 예전처럼 막는 쪽으로 남는다. 버린 대안: 설정을 못 읽으면 null(막지 않음)을 돌려주기(지금의 실패 처리보다 느슨해진다).

## 발견 사항

- L1 훅은 `$CLAUDE_PROJECT_DIR`(메인 체크아웃)의 `scripts/hooks/guard.ts`로 돈다. 이 수정은 병합 뒤 메인 체크아웃이 `origin/main`을 당겨야 대화 세션에 적용된다. → 처리: 해당 없음(`start`가 당긴다. 당기지 못하면 이유를 출력한다)
- 계획 검증에서 F3(문서 기록 확인 AC)이 7회차까지 이어졌다. 표 행 하나를 셸 한 줄로 검사하는 AC는 구간·칸 경계의 빈틈을 하나씩 지적받았다. → 처리: 해당 없음(진행 로그에 회차별 대응을 적었다)

## 열린 질문

## 검증 방법과 결과

- step0 AC: 새 회귀 테스트와 기존 승인 요청·`pr-ready`·runner PR 테스트, 문서 기록 확인 명령.
- `node scripts/harness.ts check`(test-effect로 새 테스트가 변경 전 코드에서 단언 실패하는지 본다).
- 결과(2026-11-25): step0 AC 7줄 통과. `check` 통과, test-effect `scripts/test/guard.test.ts: effective(base에서 단언 실패, 종료 코드 1)`. doc-lint의 R8 경고 6건은 계획만 올린 `check`에도 같게 나오는 기존 경고다(`docs/harness/CHANGELOG.md`는 변경 조각으로 대신한다).

## 다음 할 일

- 완료 처리를 push하고 구현 판정을 받는다. 판정이 끝나면 `pr-ready`로 제작자 head 승인을 요청한다(위험도 high).
