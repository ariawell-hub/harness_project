---
id: 20261117-revert-fail-first
issue: 111 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-17T20:15:41+09:00 # new-task가 채운다
---

# feat: R5 '먼저 실패한 테스트' 기록을 명령으로 남기고 완료 처리에서 확인한다

## 목표와 수용 기준

계획 `20261117-r5-fail-first`의 step0(PR #112, main `c5126bd`)이 main에 넣은 `fail-first "<테스트 명령>"` 명령을 되돌린다. 이 명령은 인자를 셸로 실행하고, L1 훅은 하네스 명령의 인자 안에 든 명령을 판정하지 않는다. 금지 명령을 이 명령 안에 감싸면 R20(PR 승인)·R2(main push)·R14(`reset --hard`, 재귀 삭제)·R4(`--no-verify`)가 훅을 통과한다(진행 로그). 제작자 결정(2026-11-17 대화): 먼저 되돌린 뒤 다시 설계한다. 이 계획은 되돌리기만 한다.

수용 기준:

1. **명령 제거**: `fail-first` 명령(코드 `scripts/commands/fail-first.ts`, 테스트 `scripts/test/fail-first.test.ts`, `scripts/harness.ts`의 명령·도움말·`--exempt` 옵션, 코드 구조 문서의 명령 목록)이 빠진다. `scripts/` 아래에 `fail-first`를 가리키는 코드가 남지 않고, `node scripts/harness.ts fail-first …`는 "알 수 없는 명령"으로 끝나 아무것도 실행하지 않는다.
2. **기록**: `docs/harness/CHANGELOG.md`에 되돌린 사실과 이유가 한 줄 있다.
3. **옛 계획 폐기**: 계획 `20261117-r5-fail-first`가 `status: abandoned`로 `docs/exec-plans/completed/`에 있다. 그 계획의 step1(완료 처리 검사)은 시작하지 않았다.
4. 다른 명령과 검사(`check`, 자체 테스트, 훅)의 동작은 그대로다.

## 범위 / 비범위

- 범위: `scripts/commands/fail-first.ts`·`scripts/test/fail-first.test.ts`(삭제), `scripts/harness.ts`(이 명령의 연결만 뺀다), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, 옛 계획 폴더(폐기 처리).
- 비범위:
  - 기록 명령을 다시 만드는 일과 `complete-step`의 기록 검사(제작자가 고른 R5 대처). 같은 Issue #111의 후속 계획에서 한다. 이 계획이 병합된 뒤에 시작하고, 설계는 발견 사항에 적은 지적을 반영해 다시 정한다.
  - L1 훅(`scripts/hooks/`)과 자체 테스트(`scripts/selftest/`)의 변경. 명령이 없어지면 우회로도 없어진다.
  - 금지 명령을 실제로 실행해 우회를 재현하는 일. 훅의 판정만 확인했다.

## 관련 파일·문서

- scripts/commands/fail-first.ts
- scripts/test/fail-first.test.ts
- scripts/harness.ts
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/active/20261117-revert-fail-first/
- docs/exec-plans/active/20261117-r5-fail-first/
- docs/exec-plans/completed/20261117-r5-fail-first/

## step 목록

- step0 revert-command: `fail-first` 명령을 main에서 빼고 옛 계획을 폐기한다

## 진행 로그

- 2026-11-17 step0: 앞선 경위. 제작자가 대화에서 R5 "먼저 실패한 기록"의 대처를 지시했고(#102 step5에서 구현 전 실패 실행을 빠뜨렸다) "기록 명령 + 완료 처리 검사"를 골랐다. 봇이 Issue #111을 등록했고, 계획 `20261117-r5-fail-first`의 step0(`fail-first "<테스트 명령>"`)이 두 검증자의 승인으로 자동 병합됐다(PR #112, main `c5126bd`, 위험도 보통).
- 2026-11-17 step0: 결함. 옛 계획의 다음 step을 시작해 구현 전에 이 명령의 안전성을 확인하다 찾았다. `fail-first "<명령>"`은 인자를 셸로 실행하는데 L1 훅은 그 인자 안의 명령을 판정하지 않는다. 훅(`scripts/hooks/guard.ts`)에 `node scripts/harness.ts fail-first "gh pr review 1 --approve"` 꼴의 Bash 호출을 넣어 판정만 확인했다(금지 명령은 실행하지 않았다): R20(PR 승인), R2(main push), R14(`reset --hard`, 재귀 삭제), R4(`--no-verify`)가 종료 코드 0으로 통과했고 R13만 문구로 막혔다. runner 무인 권한 프로필이 거부하는 `gh`·`curl`도 `Bash(node scripts/harness.ts:*)` 허용으로 감싸 실행할 수 있다. PR #112의 계획 검증 3라운드와 코드 판정에서 두 검증자 모두 이 점을 지적하지 않았다.
- 2026-11-17 step0: 제작자에게 바로 알리고 물었다(절차서 7절 "보안·권한 결정"). 제작자가 "먼저 #112 되돌리기"를 골랐다.
- 2026-11-17 step0: 되돌리기를 올리려는 시도 둘이 병합까지 가지 못했다. (1) PR #113: 옛 계획의 step1을 되돌리기로 바꿨다. 계획 검증은 통과했지만 로컬 `plan-gate`가 막았다(실행하는 step의 지시서는 그 PR에서 바꿀 수 없다). push하지 않고 닫았다. (2) PR #114: 새 계획 `20261117-r5-record-files`에 되돌리기와 재설계(파일만 받는 기록 명령, 완료 처리 검사)를 함께 넣었다. 계획 검증 세 라운드 동안 `review/claude`는 매번 승인했고 `review/codex`는 재설계 부분에 새 차단 지적을 라운드마다 하나씩 냈다(테스트 출력의 시크릿 노출 P0, 여러 파일을 함께 실행하면 통과한 파일까지 인정됨 P1, 기록이 테스트 파일 내용에 묶이지 않음 P1). 지적은 모두 타당했지만 되돌리기가 계속 막혔다. 닫았다.
- 2026-11-17 step0: 방식을 바꿨다(의사결정 로그). 되돌리기만 담은 이 계획을 만들었다(`new-task --issue 111 --no-claim`: 선점은 이 세션의 것이다). step0 지시서는 PR #113·#114에서 두 검증자가 문제 삼지 않은 되돌리기 지시서 그대로이고(`review/claude`의 P2 두 건은 반영돼 있다), 재설계를 가리키던 문구만 "후속 계획"으로 고쳤다.
- 2026-11-17 step0: 계획 검증 1라운드(PR #115, head `222cee4`)에서 두 검증자가 승인했다(지적 없음, G1 해시 `ee74da35dcb2`).
- 2026-11-17 step0: 구현(되돌리기). `c5126bd`의 `scripts/harness.ts` 변경을 역적용했고(`fail-first` 명령·도움말·`--exempt` 옵션·`tail` import), `scripts/commands/fail-first.ts`와 `scripts/test/fail-first.test.ts`를 지웠다. 코드 구조 문서의 명령 목록에서 뺐고 `NODE_TEST_CONTEXT` 문장에서는 지워진 파일 이름만 뺐다. `CHANGELOG`에 되돌린 사실과 이유를 한 줄 더했다. 옛 계획 `20261117-r5-fail-first`를 `abandoned`로 바꿔 `completed/`로 옮겼다(진행 로그에 폐기 줄). AC 명령 10개가 종료 코드 0이고, `node scripts/harness.ts fail-first x`는 "알 수 없는 명령"(종료 코드 2)이다.
- 2026-11-17 step0: R5. 코드와 그 테스트를 지우는 step이라 먼저 실패할 테스트가 없다(예외).

## 의사결정 로그

- 결정(제작자, 2026-11-17 대화): `fail-first`의 훅 우회로는 먼저 PR #112의 코드를 되돌려 없앤 뒤 다시 설계한다. / 이유: 고치는 동안 main에 우회로를 남기지 않는다. / 버린 대안: 되돌리지 않고 바로 고치기(파일만 받게 변경, 훅이 안쪽 명령 검사).
- 방법 전환(review-round, 3회): 가설 "되돌리기와 재설계를 한 계획에 넣으면 계획 검증을 한 번만 받는다" / 시도한 방법 PR #114에서 재설계 지적을 라운드마다 고쳐 다시 올렸다(3라운드) / 폐기 이유 라운드마다 재설계에 새 차단 지적이 나와 수렴하지 않았고(새 지적 1건, 해소 0건: `review/codex`의 계획 검증 판정에는 `resolutions`가 없다), 보안 되돌리기가 그 뒤에 묶여 있었다 / 새 방법 계획을 나눈다(절차서 6절 "PR 분할"): 이 계획은 되돌리기만 하고, 재설계는 되돌리기가 병합된 뒤 후속 계획으로 한다.
- 결정: 위험도는 high다. / 이유: 훅 우회로를 없애는 보안 수정이다(절차서 1절 기준 "보안"). 제작자 head 승인을 받는다.
- 결정: 되돌리기는 `revert/<SHA>` 브랜치가 아니라 계획 브랜치의 일반 PR로 한다. / 이유: `revert-check`는 대상 커밋의 main `check`가 실패했을 때만 통과한다(10.3절). `c5126bd`의 `check`는 통과했다. / 버린 대안: `git revert c5126bd` 전체.
- 결정: 옛 계획 폴더의 내용은 되돌리지 않고 폐기 처리(`abandoned`, `completed/`로 이동)만 한다. / 이유: 옛 계획의 기록(계획 검증 경위, step0의 진행 로그)이 main에 남는다. 옛 계획을 고쳐 이어 갈 수는 없다: 다음 step(step1)의 지시서가 되돌려질 명령에 기대고 있고, 실행할 차례인 step의 지시서는 고칠 수 없다.
- 결정: 이 계획의 PR은 `Refs #111`로 올린다(마지막 step이지만 `Closes`가 아니다). / 이유: Issue #111의 일(R5 대처)은 끝나지 않았다. 후속 계획이 이어 간다.

## 발견 사항

- 인자로 받은 문자열을 셸로 실행하는 하네스 명령은 L1 훅의 우회로가 된다. 훅은 `bash -c`·`eval`의 안쪽은 다시 판정하지만(`scripts/hooks/shell.ts`) 하네스 자신의 명령 인자는 들여다보지 않는다. 검증자 둘 다 놓쳤다. 설계서 13.1절에 "하네스 명령은 인자로 받은 문자열을 셸로 실행하지 않는다"를 적는 일은 후속 계획의 문서 작업이다. → 처리: #111
- 후속 계획(기록 명령 재설계)이 지켜야 할 것. PR #113·#114의 계획 검증에서 나온 지적이다. (1) 셸을 거치지 않고 테스트 파일 경로만 받는다. `-`로 시작하는 값, 절대 경로, `..`, 테스트 파일이 아닌 경로를 실행하지 않는다. (2) 심볼릭 링크는 실제 경로(realpath)가 worktree 안이어야 한다(`review/codex` P1). (3) 테스트 출력의 내용(단언 실패 줄, 출력 일부, 해시)을 기록·계획·stdout에 저장하지 않는다: 단언 메시지에 시크릿이 섞일 수 있다(`review/codex` P0). 기록하지 못했을 때 stderr로 보이는 출력도 같은 원칙에서 다시 정한다(`review/claude` P2). (4) 파일마다 따로 실행해 판정한다: 여러 파일을 한 프로세스로 실행하면 통과한 파일까지 기록으로 인정된다(`review/codex` P1). (5) 기록을 실행 당시 테스트 파일의 내용에 묶고 완료 처리 때 지금 내용과 비교한다: 실패를 기록한 뒤 테스트를 바꿔도 통과하면 안 된다(`review/codex` P1). (6) 실행 시간 제한의 출처를 하나로 정한다(`review/claude` P2). → 처리: #111
- 재설계가 이만큼 무거워졌으므로(파일별 실행, 내용 결속, 출력 비저장), 후속 계획을 시작하기 전에 제작자에게 다시 묻는다: 로컬 기록 명령을 이 조건으로 만들지, CI의 실효성 검사(TD-4: 새 테스트가 merge-base 코드에서 실패하고 head에서 통과하는가)로 바꿀지. → 처리: #111
- `ci.repro`가 없는 프로파일(core, web)로 만든 리포에서는 "테스트 하나를 실행하는 명령"을 설정에서 알 수 없다. 파일만 받는 기록 명령은 그런 리포에서 예외 기록만 쓸 수 있다. → 처리: #111
- `node --test` 안에서 도는 테스트가 `node --test`를 자식으로 띄우면 `NODE_TEST_CONTEXT`가 넘어가 자식이 테스트 파일을 실행하지 않고 종료 코드 0으로 끝난다. 통과로 보이는 거짓 결과라 테스트에서 이 변수를 빼야 한다. → 처리: [코드 구조 문서](../../../harness/architecture.md)
- 실행할 차례인 step의 지시서를 고쳐야 하는 계획 수정은 그 계획 안에서 할 수 없다(`plan-gate`: 실행 PR은 자기 step 파일을 못 바꾼다, `new-task`: 앞 step이 병합돼야 다음 step). 계획을 폐기하고 새 계획을 만들어야 한다. 절차서 2절에는 이 경우의 방법이 없다. 후속 계획의 문서 작업에서 한 줄을 더한다. → 처리: #111
- `review/codex`의 계획 검증 판정에는 `resolutions`가 비어 있다(PR #113·#114의 다섯 라운드 모두). 자기가 낸 차단 지적을 계획 검증 단계에서는 닫지 못해, 고친 뒤에도 원장에 `open`으로 남고 `review-ledger`가 실패한다. `review/claude`는 반박 형식 댓글이 있으면 닫았다(PR #112 F1). 코드 판정에서는 닫힌 적이 있다(PR #105, #108). TD로 등록하는 일은 후속 계획의 문서 작업이다. → 처리: #111
- PR #110에서 `review/claude`는 "먼저 실패한 기록이 없다"를 확인하고도 사후 변이 확인을 받아들여 승인했다. 설계서 5.1절은 절차 항목 누락을 P1 지적으로 정한다. 검증 기준을 고치는 일은 제작자가 고르지 않았다. → 처리: #111

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 `node scripts/harness.ts check`.
- 되돌린 뒤 `node scripts/harness.ts fail-first x`는 "알 수 없는 명령"(종료 코드 2)이다. 감싼 금지 명령을 실행할 경로가 없다. 금지 명령은 실제로 실행하지 않는다.
- 이 step은 코드와 그 테스트를 지우는 일이라 먼저 실패할 테스트가 없다(R5 예외. PR의 R5 줄에 적는다).

## 다음 할 일

- 지금: 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 같은 PR에 step0(되돌리기)을 올리고 제작자 head 승인을 요청한다. 되돌리기 변경은 준비돼 있다(AC와 PR 모드 `plan-gate`를 미리 확인했다).
- 병합 뒤: Issue #111은 열린 채로 둔다. 후속 계획(R5 대처의 재설계)을 시작하기 전에 제작자에게 방향을 다시 묻는다(발견 사항 셋째 항목).
- PR #110(#102 step5)과 같은 파일을 고친다(`scripts/harness.ts`, `CHANGELOG`, 코드 구조 문서). 먼저 병합된 쪽의 뒤에 `origin/main`을 병합해 푼다(TD-39).
