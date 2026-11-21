---
id: 20261121-merge-leftovers
issue: 175 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: draft # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T17:23:51+09:00 # new-task가 채운다
---

# check가 남은 병합 충돌 표식을 잡고, doc-lint가 설계서 머리말 버전을 변경 이력과 견준다 (TD-30, TD-33)

## 목표와 수용 기준

세션 여럿이 같은 문서(설계서, `CHANGELOG`, 기술 부채 표)를 고치는 동안 PR마다 `origin/main`을 병합해 충돌을 손으로 푼다. 그때 생기는 실수 두 가지를 검사가 잡지 못한다(Issue #175). 남은 충돌 표식(기술 부채 표 TD-30)과, 설계서 머리말의 버전이 변경 이력과 어긋나는 것(TD-33)이다. 둘을 `check`가 실패로 알리게 한다.

이 문서에서 "충돌 표식 줄"은 줄 머리가 `<` 일곱 개 또는 `>` 일곱 개이고 그 바로 뒤가 공백이거나 줄 끝(줄 끝의 CR 하나는 허용)인 줄이다. `=`만 일곱 개인 줄은 세지 않는다(Markdown의 제목 밑줄과 모양이 같다. 충돌 블록에는 시작·끝 표식이 함께 있으므로 둘만 보아도 블록을 놓치지 않는다).

수용 기준:

1. 작업 트리의 파일에 충돌 표식 줄이 있으면 `bypass-scan` 명령과 `check`의 `bypass-scan` 단계가 실패한다(종료 코드 1). 출력에 규칙 이름 `R7 충돌 표식`, 그 파일의 경로와 첫 표식 줄의 줄 번호, 고치는 법이 있다. 문제는 파일마다 한 건이고 경로 순이다.
   - 검사 대상은 `git`이 추적하는 파일과 무시되지 않는 새 파일이다. 커밋했는지와 무관하게 작업 트리의 내용을 본다(CI의 작업 트리는 판정할 커밋 그대로다).
   - 시작 표식이나 끝 표식 하나만 남은 파일도 걸린다.
2. 다음은 걸리지 않는다: `=`만 일곱 개인 줄, 줄 머리가 아닌 곳의 같은 문자열(들여쓴 줄 포함), 같은 문자가 여덟 개 이상 이어진 줄, 일곱 개 바로 뒤에 공백 없이 글자가 붙은 줄, `.gitignore`로 무시되는 파일, `git`이 바이너리로 보는 파일(NUL 바이트가 든 파일).
3. 검사를 하지 못하면 통과가 아니라 실패다(규칙 이름 `R7 충돌 표식 검사 실패`, 한 건). `git grep`이 종료 코드 0·1이 아닌 값으로 끝난 경우와 출력을 해석하지 못한 경우다.
4. 사용자의 `git` 설정(`grep.patternType`, `grep.column`, `color.grep`)이 달라도 결과가 같다.
5. 충돌 표식 줄이 없는 리포에서는 `bypass-scan` 명령과 `check`의 결과가 지금과 같다. `check`의 단계 이름 목록(`CHECK_STEPS`)은 늘지 않는다.
6. 문서 목록에 설계서(`docs/harness/design.md`)가 있으면 `doc-lint`가 아래를 확인하고, 하나라도 아니면 오류(규칙 이름 `R8 설계서 버전`)로 알린다. 오류는 `doc-lint` 명령과 `check`의 `doc-lint` 단계를 실패하게 한다.
   - 머리말 줄(`> 버전 v<버전> · … 최종 갱신: <날짜>`)의 버전이 변경 이력의 마지막 항목의 버전과 같다.
   - 머리말 줄의 최종 갱신 날짜가 변경 이력의 마지막 항목의 날짜와 같다.
   - 변경 이력의 항목은 버전이 앞 항목보다 크다(숫자 마디를 왼쪽부터 견주고, 앞 마디가 모두 같으면 마디가 더 많은 쪽이 크다: v0.4 < v0.4.1 < v0.5). 같은 버전이 두 번 나오면 여기에 걸린다.
   - 머리말 줄이나 변경 이력을 형식대로 읽지 못하면(줄이 없다, 항목이 하나도 없다, 항목의 형식이 틀렸다) 그것도 같은 규칙 이름의 오류다. 읽지 못한 것을 통과로 치지 않는다.
7. 설계서가 문서 목록에 없으면(파일이 없다, `docLint.exclude`에 든다) 이 검사를 하지 않는다.
8. 지금 이 리포의 설계서는 이 검사를 통과한다(`node scripts/harness.ts doc-lint`가 종료 코드 0).
9. 지표 집계(`metrics`)의 동작은 바뀌지 않는다. `docLint`가 실행하는 `git` 호출은 늘지 않는다.
10. 기술 부채 표의 TD-30(step0)과 TD-33(step1)이 해결로 바뀐다.

## 범위 / 비범위

범위:

- 새 게이트 함수(충돌 표식)와 그 호출 두 곳(`check`의 `bypass-scan` 단계, `bypass-scan` 명령).
- `doc-lint`의 설계서 버전 검사.
- 새 테스트 파일 둘, 절차서 5절의 두 항목, `CHANGELOG`, 기술 부채 표의 두 행.

비범위:

- `check`에 단계를 더하는 일. 실패 키(`check:<단계>`)와 캐시가 단계 이름에 묶여 있어 기존 단계 안에서 본다(CODEOWNERS 검사를 `doc-lint` 단계 안에서 보는 것과 같은 방식).
- 충돌 표식 검사의 예외 설정(특정 파일을 빼는 설정 키). 표식 모양의 줄이 꼭 필요한 파일(병합 도구의 테스트 자료 등)은 줄 머리에 오지 않게 쓰거나 실행 중에 조립한다. 필요한 사례가 나오면 그때 더한다.
- `git`이 바이너리로 보는 파일 안의 충돌 표식(`.gitattributes`로 `binary`나 `-diff`를 붙인 텍스트 파일 포함).
- `bypass-scan`(R4)의 기존 검사, `secret-scan`, `doc-lint`의 다른 검사 항목과 판정 기준.
- 병행 PR의 문서 충돌 자체를 줄이는 구조 변경(TD-39).
- 설계서 본문. 규칙 표(R4, R7, R8)의 정의는 그대로이고 검사 항목이 늘 뿐이다. `CHANGELOG`와 절차서에 적는다.
- `scripts/hooks/**`, `scripts/lib/config.ts`, `harness.config.json`, `profiles/**`(다른 세션이 고치는 중이다).

## 관련 파일·문서

- `scripts/gates/conflict-markers.ts`(새 파일), `scripts/test/conflict-markers.test.ts`(새 파일)
- `scripts/commands/check.ts`(`bypass-scan` 단계의 한 줄과 import), `scripts/harness.ts`(`bypass-scan` 명령의 한 곳과 import)
- `scripts/gates/doc-lint.ts`, `scripts/test/doc-lint-design-version.test.ts`(새 파일)
- `docs/harness/workflow.md`(5절 "main에 뒤처지거나 충돌한 PR 갱신"의 두 항목)
- `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-30 행, TD-33 행)
- 읽기만: `scripts/gates/bypass-scan.ts`, `scripts/lib/git.ts`(`gitTry`), `scripts/lib/util.ts`(`Problem`), `scripts/test/helpers.ts`, `scripts/test/gates.test.ts`, `scripts/test/doc-lint-gate.test.ts`, `scripts/metrics/local.ts`, `docs/harness/design.md`(머리말과 0절 변경 이력의 형식)

## step 목록

- step0 conflict-markers: 남은 충돌 표식을 `check`의 `bypass-scan` 단계와 `bypass-scan` 명령이 잡고 TD-30을 닫는다.
- step1 design-version: `doc-lint`가 설계서 머리말의 버전·최종 갱신을 변경 이력과 견주고 TD-33을 닫는다.

## 진행 로그

- 2026-11-21 17:26 제작자 대화 지시("추천안대로 1순위부터 진행해달라": 다른 세션과 겹치지 않는 후보 가운데 1순위 TD-30·TD-33)로 봇이 Issue #175를 등록하고 시작했다. 계획을 썼다.
  - 계획을 쓰기 전에 확인한 것: 지금 리포에는 충돌 표식 줄이 없다. 설계서 변경 이력 78개 항목은 모두 같은 형식(공백 두 개 들여쓴 `- v<버전> (<날짜>): 내용`)이고 버전이 앞 항목보다 크다. 머리말(v0.7.68, 2026-11-21)은 마지막 항목과 같다.
  - 임시 리포에서 확인한 것(git 2.50.1): `git grep -n -I -z -G --no-color --no-column --no-recurse-submodules --untracked -e <시작 표식 패턴> -e <끝 표식 패턴> -- .`의 출력은 `경로 NUL 줄 번호 NUL 줄 내용 LF`의 반복이다. 맞는 줄이 없으면 종료 코드 1, `git` 리포가 아닌 폴더에서는 128이다. `grep.patternType=fixed`, `grep.column=true`, `color.grep=always`를 설정해도 출력이 같다. 커밋이 없는 리포에서도 새 파일을 본다. 색인 파일이 손상된 리포에서는 종료 코드 0으로 작업 트리의 파일을 그대로 읽어 표식을 찾는다(`git ls-files`는 128로 실패한다).

## 의사결정 로그

- 결정: 충돌 표식 검사를 `check`의 `bypass-scan` 단계와 `bypass-scan` 명령 안에서 한다. 함수는 따로 둔다(`scripts/gates/conflict-markers.ts`). / 이유: 단계 이름을 늘리면 실패 키와 캐시, `--only`의 값, 단계를 나열한 문서가 함께 바뀐다. 기존 단계 가운데 "커밋되면 안 되는 표시를 찾는다"는 뜻이 가장 가까운 것이 `bypass-scan`이다. 규칙 이름은 R4가 아니라 `R7 충돌 표식`으로 내어 구분한다. / 버린 대안: 새 단계 `conflict-scan`, `doc-lint` 단계 안에서 보기(문서가 아닌 파일도 대상이다), `bypassScan` 함수 안에 넣기(R4 검사와 섞인다).
- 결정: 새로 더한 줄만이 아니라 작업 트리 전체를 본다. / 이유: 비교 기준(`base`)이 없거나 틀려도 검사가 빠지지 않는다. "리포에 충돌 표식 줄이 없다"는 한 문장으로 판정이 정해진다. `git grep`이라 리포 전체를 보아도 빠르다. / 버린 대안: `bypass-scan`처럼 `base` 대비 더한 줄만 보기(`base`가 없으면 검사가 통째로 빠진다).
- 결정: `=`만 일곱 개인 줄은 세지 않는다. / 이유: Markdown 제목 밑줄과 같아 오탐이 난다. 충돌 블록에는 시작·끝 표식이 있어 그 둘로 잡힌다. / 버린 대안: 시작 표식과 끝 표식 사이에 있을 때만 세기(판정이 복잡해지고 얻는 것이 없다).
- 결정: 예외 설정을 두지 않는다. / 이유: 설정 키를 더하려면 `scripts/lib/config.ts`와 `harness.config.json`을 고쳐야 하는데 다른 세션의 PR #174가 고치는 중이다. 지금 리포에 필요한 파일이 없고, 줄 머리를 피하면 되는 우회가 있다(B4: 관찰된 실패를 보고 규칙을 키운다). / 버린 대안: `conflictScan.exclude` 설정.
- 결정: 설계서 버전이 어긋나면 경고가 아니라 오류다. / 이유: 어긋남은 판단할 것 없이 틀린 상태이고 한 줄을 고치면 풀린다. 경고는 `check`를 통과시켜 다시 쌓인다(TD-33이 생긴 경위). / 버린 대안: 경고.
- 결정: 변경 이력의 버전이 앞 항목보다 큰지도 본다. / 이유: 병행 PR이 같은 버전을 쓰고 병합에서 두 항목을 모두 남기면 머리말은 마지막 항목과 같아도 버전이 겹친다(이번 구간에서 PR #167과 #168이 같은 번호를 썼고 손으로 올렸다). 머리말과 마지막 항목만 견주면 이 경우를 놓친다. / 버린 대안: 머리말과 마지막 항목만 견주기.
- 결정: 설계서 본문은 고치지 않는다. / 이유: 규칙의 정의는 그대로다. 다른 세션의 PR 둘(#169, #174)이 설계서 버전을 올리는 중이라 본문을 고치면 버전 줄에서 또 겹친다. / 버린 대안: 5.1절 R8의 검사 목록에 한 구절 더하기.
- 결정: 규모는 medium이고 step을 둘로 나눈다. / 이유: 두 검사는 파일과 목적이 다르다(R15: PR 하나에 목적 하나). 게이트의 동작이 바뀌므로 medium 이상이다(절차서 1절).

## 발견 사항

- 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- 각 step의 Acceptance Criteria.
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 올려 계획 검증(G1)을 받는다. 승인 뒤 step0의 테스트를 먼저 올린다.
