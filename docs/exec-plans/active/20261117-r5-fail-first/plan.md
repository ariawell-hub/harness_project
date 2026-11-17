---
id: 20261117-r5-fail-first
issue: 111 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-17T17:22:39+09:00 # new-task가 채운다
---

# feat: R5 '먼저 실패한 테스트' 기록을 명령으로 남기고 완료 처리에서 확인한다

## 목표와 수용 기준

R5(TDD)의 "먼저 실패한 테스트" 기록이 문장으로 대체되지 않게 한다. #102 step5(PR #110)에서 대화 세션이 테스트를 구현보다 먼저 쓰고도 구현 전에 실패하는 실행을 돌리지 않았고, 테스트 4개가 첫 실행에 통과했다. 지금 이 기록은 절차서의 문장, PR 템플릿의 자유 서술 칸, 검증자의 판단에만 기댄다. 제작자 결정(2026-11-17 대화)에 따라 기록을 명령의 실행 결과로 남기고 `complete-step`이 그 기록을 확인하게 한다.

step0(PR #112, 병합됨)이 만든 `fail-first "<테스트 명령>"`은 인자를 셸로 실행해 L1 훅의 우회로가 됐다: 금지 명령을 이 명령 안에 감싸면 훅이 R20·R2·R14·R4를 판정하지 못한다(진행 로그 2026-11-17). 제작자 결정(2026-11-17 대화)에 따라 먼저 되돌리고(step1), 임의 명령을 실행하지 않는 방식으로 다시 만든다(step2).

수용 기준:

1. **되돌리기**: step0이 main에 넣은 `fail-first` 명령(코드, 테스트, CLI 연결, 문서 줄)이 main에서 빠진다. 하네스 CLI에 인자로 받은 문자열을 셸로 실행하는 명령이 남지 않는다.
2. **기록 명령(다시 만든다)**: `node scripts/harness.ts fail-first <테스트 파일> [<테스트 파일>…]`이 계획 브랜치의 worktree에서 그 파일들을 실행한다. 셸을 거치지 않고, 설정의 "테스트 하나를 실행하는 명령"(`ci.repro.command`) 뒤에 파일 경로를 붙여 프로세스로 띄운다(시간 제한 `limits.acTimeoutSec`). 인자는 worktree 안에 있는 테스트 파일의 상대 경로만 받는다. 그 밖의 인자(셸 명령 문자열, `-`로 시작하는 값, 절대 경로, `..`, 없는 파일, 테스트 파일이 아닌 경로)는 아무것도 실행하지 않고 종료 코드 2다.
3. **기록 조건**: 종료 코드가 0이 아니고 출력에 단언 실패 정규식(`ci.repro.failPattern`)이 보일 때만 기록을 남기고 종료 코드 0으로 끝난다. 통과한 실행(종료 코드 0), 시간 초과, 단언 실패가 아닌 실패(모듈을 찾지 못함, 문법 오류)는 기록하지 않고 종료 코드 1과 이유를 낸다. 계획 브랜치가 아니거나 `ci.repro`가 없는 리포에서는 종료 코드 2다.
4. **기록 위치와 내용**: 기록은 git이 추적하지 않는 worktree별 하네스 상태 폴더의 `fail-first.jsonl`에 한 줄씩 쌓인다(시각, 계획 id, step, 실행한 테스트 파일들, 종료 코드, HEAD, 단언 실패가 보인 첫 줄 200자 이내, 출력의 sha256 앞 12자). 계획 파일이나 PR 본문에 손으로 쓴 문장은 기록이 아니다.
5. **예외 기록**: `node scripts/harness.ts fail-first --exempt "<사유>"`가 실행 없이 예외를 같은 파일에 남긴다(R5의 예외: 문서·설정·순수 리팩터, 기록을 남기지 못한 경위). 사유가 비면 종료 코드 2다.
6. **완료 처리 검사**: `complete-step`은 그 step의 변경(merge-base 대비, 작업 트리 포함)에 테스트 파일이 있으면 그 계획·step의 기록이나 예외를 요구한다. 기록은 실행한 파일 가운데 이 step이 바꾼 테스트 파일이 하나 이상 있어야 인정한다. 없으면 계획 파일을 바꾸지 않고 종료 코드가 0이 아니며 고치는 법을 출력한다. 있으면 진행 로그에 `먼저 실패한 기록(R5)` 또는 `R5 예외` 한 줄(파일, 종료 코드, 단언 실패 줄, 기록 시각 또는 사유)을 더해 계획 전용 커밋에 담는다. 테스트 파일이 바뀌지 않은 step의 동작은 그대로다.
7. **runner**: step 세션 프롬프트가 `fail-first` 사용을 지시한다. 테스트 파일을 바꾸고 기록 없이 끝난 세션은 runner의 완료 처리 실패(`plan:complete`)로 세어지고 다음 세션 프롬프트에 그 이유가 들어간다.
8. **자체 테스트**: 시나리오 `r5-fail-first`가 샘플 리포에서 위 2·3·6을 CLI로 확인한다(기록 없이는 완료 처리가 막힌다, 통과하는 테스트는 기록되지 않는다, 셸 명령 문자열은 실행되지 않는다, 기록 뒤에는 완료된다). 완료 처리 검사를 뺀 사본에서 이 시나리오가 실패한다.
9. **문서**: 설계서 5.1절 R5 행과 12.4절 시나리오 표, 절차서 3·4절(인정되는 기록의 형식), PR 템플릿의 R5 줄, `AGENTS.md` 작업 루프 3번, 코드 구조 문서, `CHANGELOG`, TD-4(남는 범위)를 고친다.

## 범위 / 비범위

- 범위: `scripts/commands/`(`fail-first.ts`를 지우고 다시 만든다, `task.ts`의 `completeStep`), `scripts/harness.ts`(명령·도움말), `scripts/runner/prompt.ts`(step 프롬프트 한 줄), `scripts/selftest/scenarios/`(새 시나리오), `scripts/test/`, `.github/pull_request_template.md`, 문서.
- 비범위:
  - CI의 R5 실효성 검사(새 테스트가 merge-base 코드에서 실패하고 head에서 통과하는가). TD-4로 남는다. 이 계획의 기록은 로컬 완료 처리에서만 확인하고 CI는 보지 않는다.
  - 검증자 프롬프트·체크리스트(`scripts/cross-review/`)의 판정 기준 변경. 제작자가 고르지 않았다.
  - "테스트를 구현보다 먼저 썼다"는 순서의 증명. 기록은 그 시점에 단언 실패가 있었다는 것만 말한다(설계서 5.1절: 순서는 CI로 증명할 수 없다).
  - `harness.config.json`·프로파일의 새 설정 키. 테스트 파일 판별은 코드의 기본 glob이고, 실행 명령과 단언 실패 정규식은 이미 있는 `ci.repro`를 쓴다. `ci.repro`가 없는 프로파일(core, web)에 그 값을 넣는 일은 하지 않는다: 그런 리포에서는 예외 기록만 쓸 수 있다(TD로 남긴다).
  - L1 훅(`scripts/hooks/`)의 변경. 다시 만드는 명령은 임의 명령을 실행하지 않으므로 훅이 안쪽 명령을 들여다볼 필요가 없다.
  - 테스트 파일 안의 코드가 하는 일의 통제. 세션이 쓴 테스트 파일을 `node --test`로 실행하는 것은 지금도 무인 권한 프로필이 허용한다. L0 샌드박스(4단계)의 몫이다.
  - 지적 대응 세션(`review`)과 충돌 해결 세션의 프롬프트. step 세션 프롬프트만 고친다.
  - 기록의 위조 방지. 상태 폴더의 파일을 손으로 만들면 통과한다. 막으려는 것은 부주의한 누락과 문장 대체다.

## 관련 파일·문서

- scripts/commands/fail-first.ts
- scripts/commands/task.ts
- scripts/harness.ts
- scripts/runner/prompt.ts
- scripts/selftest/scenarios/
- scripts/test/
- .github/pull_request_template.md
- AGENTS.md
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261117-r5-fail-first/

## step 목록

- step0 record-command: `fail-first "<테스트 명령>"`(셸 실행). 병합됐고(PR #112) step1에서 되돌린다
- step1 revert-command: step0이 넣은 `fail-first` 명령을 main에서 뺀다(L1 훅 우회로 제거)
- step2 record-files: `fail-first <테스트 파일…>`(셸 없이 실행)과 예외 기록, 기록 읽기, 테스트 파일 판별
- step3 complete-check: `complete-step`의 기록 검사와 진행 로그 한 줄, runner step 프롬프트, 자체 테스트 시나리오, 규칙 문서

## 진행 로그

- 2026-11-17 step0: 계획 작성. 제작자가 대화에서 대처를 지시했고 선택지 3개(기록 명령 + 완료 검사 / 문서·검증 기준만 / TD-4 앞당김) 가운데 첫째를 골랐다. 봇이 Issue #111을 등록했다. PR #110(#102 step5)은 제작자 승인 대기 중이라 건드리지 않는다.
- 2026-11-17 step0: 계획 검증이 시작되기 전에(PR #112, `check` 진행 중) step0 지시서의 한 곳을 고쳤다: 기록하지 못했을 때 보여 주는 출력을 끝 20줄에서 40줄로. 로컬에서 테스트를 먼저 돌려 보니 Node 테스트 출력(37줄)에서 모듈을 찾지 못한 원인 줄이 5번째 줄이라 끝 20줄에 보이지 않았다.
- 2026-11-17 step0: 계획 검증(PR #112). 1라운드(head `ca4fd70`)에서 `review/claude`가 수정을 요청했다(원장 F1, P1: "그 step의 변경"을 merge-base 대비로 정하면 앞 step의 테스트 파일이 뒤 step의 검사에 섞인다). 근거의 전제는 "계획 하나가 브랜치 하나에서 step을 쌓는다"인데, 이 하네스는 step마다 브랜치를 `origin/main`에서 새로 만든다. 2라운드(head `3b05d2d`)에서는 두 검증자가 승인했고(G1 해시 `cc2530ea133b`) `review/claude`도 같은 이유로 문제없다고 봤지만 F1은 원장에 열린 채다. F1의 제안 가운데 다단계 테스트는 맞는 말이라 step1에 넣었다(step0이 테스트를 바꾼 뒤의 step1은 기록 없이 완료된다, 그 전제를 지시서에 적었다). 2라운드의 P2 두 건도 반영했다: 시간 제한 테스트의 설정 방법(F2), 기록된 명령과 바뀐 테스트의 대응은 검증자가 본다는 문서 항목(F3). 계획 섹션이 바뀌어 다시 검증받는다.
- 2026-11-17 step0: 계획 검증 3라운드(head `9ac77de`)에서 두 검증자가 승인했다(G1 해시 `5cf0e1e97904`). F1은 반박이 받아들여져 `rejected`로 닫혔고 F2·F3(P2)은 계획에 반영된 채 `deferred`로 남았다.
- 2026-11-17 step0: 먼저 실패한 기록(이 step은 명령이 아직 없어 손으로 적는다). 테스트 파일 `scripts/test/fail-first.test.ts`와 값을 돌려주지 않는 골격(`isTestFile`은 항상 false, `readFailFirst`는 빈 배열, CLI 명령 없음)만 둔 상태에서 `node --test scripts/test/fail-first.test.ts`가 종료 코드 1이었다: 7개 모두 `AssertionError [ERR_ASSERTION]`으로 실패했다(예: "알 수 없는 명령: fail-first"로 종료 코드 단언 실패, `assert.ok(before.length > 0)`, `isTestFile('scripts/test/a.test.ts')`가 `false !== true`). 그 뒤에 구현했다.
- 2026-11-17 step0: 구현 뒤 첫 실행에서 2개가 계속 실패했고 원인은 테스트 쪽이었다. (1) 이 테스트 파일은 `node --test` 안에서 돌아 `NODE_TEST_CONTEXT`가 자식에게 넘어갔고, 명령 안의 `node --test`가 테스트 파일을 실행하지 않고 0으로 끝났다. 테스트가 그 변수를 빼고 CLI를 띄우게 고쳤다. (2) "출력의 끝 20줄에 원인이 보인다"는 단언이 Node 출력 형식과 맞지 않았다(위 20줄 → 40줄 수정).
- 2026-11-17 step0: 구현. `scripts/commands/fail-first.ts`(`failFirst`·`exemptFailFirst`·`readFailFirst`·`isTestFile`·`failFirstFile`), `scripts/harness.ts`의 `fail-first` 명령·도움말·`--exempt` 옵션, 테스트 `scripts/test/fail-first.test.ts` 7개. 문서: 코드 구조 문서, `CHANGELOG`. `complete-step`·runner·설정은 바꾸지 않았다.
- 2026-11-17 step0: PR #112가 두 검증자의 승인으로 자동 병합됐다(main `c5126bd`, 위험도 보통).
- 2026-11-17 step1: (옛 step1 complete-check를 시작했다가 멈췄다) 테스트를 먼저 쓰고 `fail-first`로 단언 실패를 기록한 뒤, 구현 전에 이 명령의 안전성을 확인하다 결함을 찾았다. `fail-first "<명령>"`은 인자를 셸로 실행하는데, L1 훅은 그 인자 안의 명령을 판정하지 않는다. 훅(`scripts/hooks/guard.ts`)에 `node scripts/harness.ts fail-first "gh pr review 1 --approve"` 꼴의 Bash 호출을 넣어 판정만 확인했다(금지 명령은 실행하지 않았다): R20(PR 승인), R2(main push), R14(`reset --hard`, 재귀 삭제), R4(`--no-verify`)가 종료 코드 0으로 통과했고 R13만 문구로 막혔다. runner 무인 권한 프로필이 거부하는 `gh`·`curl`도 `Bash(node scripts/harness.ts:*)` 허용으로 감싸 실행할 수 있다. step0의 계획 검증 3라운드와 코드 판정에서 두 검증자 모두 이 점을 지적하지 않았다.
- 2026-11-17 step1: 제작자에게 바로 알리고 물었다(절차서 7절 "보안·권한 결정"). 제작자가 "먼저 #112 되돌리기"를 골랐다. 계획을 고쳤다: 위험도 high, step1을 되돌리기로 바꾸고 기록 명령을 파일만 받는 방식으로 다시 만드는 step2를 더했으며, 완료 처리 검사는 step3으로 옮겼다. 쓰던 테스트·시나리오는 리포 밖에 보관했다가 step3에서 새 인터페이스에 맞춰 쓴다. 계획 섹션과 step 파일이 바뀌어 다시 검증받는다.

## 의사결정 로그

- 결정(제작자, 2026-11-17 대화): R5의 "먼저 실패한 기록"을 명령의 실행 결과로 남기고 `complete-step`이 확인한다. / 이유: 제작자 지적("'테스트를 먼저 썼다' 같은 문장이 나왔을 때 동일하게 TDD를 실행하지 않을 수 있다"). 문서와 모델 판단은 이번에 뚫린 것과 같은 종류의 장치다. / 버린 대안: 문서·검증 기준만 강화, TD-4(CI 실효성 검사) 앞당김.
- 결정: 기록은 계획 파일이 아니라 git이 추적하지 않는 worktree별 상태 폴더(`fail-first.jsonl`)에 두고, `complete-step`이 진행 로그에 한 줄로 옮긴다. / 이유: 계획 파일의 줄은 손으로 쓸 수 있어 다시 문장이 된다. 상태 폴더의 파일은 명령만 쓴다(실패 횟수 `attempts.jsonl`과 같은 자리). PR에는 완료 처리가 옮긴 한 줄이 남아 검증자가 기록인지 예외인지 본다. / 버린 대안: `index.json`의 step 항목에 넣기(소규모 계획에는 `index.json`이 없고, 손으로 고치는 파일이다).
- 결정: 검사 조건은 "테스트 파일이 바뀐 step"이다. 동작 코드만 바꾸고 테스트를 바꾸지 않은 step은 이 검사의 대상이 아니다. / 이유: 그 경우는 R5의 다른 검출 항목(동작 코드 변경 시 테스트 변경 동반)의 몫이고 아직 구현되지 않았다. 기존 흐름(가짜 에이전트의 step, 문서 step)을 깨지 않는다. / 버린 대안: 코드가 바뀐 모든 step에 기록 요구(문서·설정 step마다 예외를 적게 된다).
- 결정: 단언 실패 판별은 `ci.repro.failPattern`(재현 job이 쓰는 정규식)을 쓰고, `ci.repro`가 null이면 코드의 기본값 `AssertionError|ERR_ASSERTION`을 쓴다. 테스트 파일 판별은 코드의 기본 glob이다. 새 설정 키를 두지 않는다. / 이유: "단언 실패"의 정의가 이미 프로파일 설정에 있다. 판정 관련 설정 키를 더하면 `harness-guard` 신호가 되고 프로파일 세 곳을 함께 고쳐야 한다. / 버린 대안: `failFirst.testGlobs`·`failPattern` 설정 키(다른 언어 프로파일에서 필요해지면 더한다).
- 결정: 예외는 `complete-step`의 옵션이 아니라 `fail-first --exempt`로 남긴다. / 이유: runner는 `completeStep`을 함수로 부르고 세션은 `complete-step`을 실행하지 않는다. 같은 명령이면 대화 세션과 runner 세션이 같은 방법을 쓴다.
- 결정: 위험도는 normal이다. / 이유: 검사를 더하는 변경이고 보안·인증·마이그레이션·데이터 스크립트가 아니다(절차서 1절). 약화·완화가 섞이면 `harness-guard`가 높음으로 올린다.
- 결정(제작자, 2026-11-17 대화): `fail-first`의 훅 우회로는 먼저 PR #112의 코드를 되돌려 없앤 뒤 다시 설계한다. / 이유: 고치는 동안 main에 우회로를 남기지 않는다. / 버린 대안: 되돌리지 않고 바로 고치기(파일만 받게 변경, 훅이 안쪽 명령 검사).
- 결정: 다시 만드는 `fail-first`는 테스트 파일 경로만 받고 셸을 거치지 않는다(`ci.repro.command` + 파일). 제작자에게 보인 두 방식 가운데 추천안이다. / 이유: 임의 명령을 감쌀 수 없어 L1 훅과 runner 무인 권한 프로필이 모두 우회되지 않는다. 훅이 안쪽 명령을 검사하는 방식은 L1 규칙만 되살리고 프로필이 거부하는 `gh`·`curl`은 그대로 통과시킨다. 기록에 실행한 파일이 남아 "기록이 바뀐 테스트와 무관해도 통과한다"(PR #112 원장 F3)도 완료 처리에서 확인할 수 있다. / 버린 대안: 셸 명령을 유지하고 훅의 `bash -c` 재귀 목록에 `fail-first`를 더하기, 명령 안에서 L1 규칙을 다시 평가하기.
- 결정: 위험도를 normal에서 high로 올린다. / 이유: 훅 우회로를 없애는 보안 수정이 계획에 들어왔다(절차서 1절 기준 "보안"). 남은 PR은 모두 제작자 head 승인을 받는다. / 버린 대안: 보안 수정만 다른 Issue로 나누기(지시 없이 봇이 Issue를 만들 수 없고, 되돌리기와 다시 만들기는 이 Issue의 산출물을 고치는 일이다).
- 결정: 되돌리기는 `revert/<SHA>` 브랜치가 아니라 이 계획의 step1(계획 브랜치)로 한다. 계획 폴더는 되돌리지 않는다. / 이유: `revert-check`는 대상 커밋의 main `check`가 실패했을 때만 통과한다(10.3절). `c5126bd`의 `check`는 통과했다. 계획 폴더를 남겨야 진행 로그와 결정이 main에 남는다. / 버린 대안: `git revert c5126bd` 전체(계획이 main에서 빠진다).

## 발견 사항

- PR #110에서 `review/claude`는 "먼저 실패한 기록이 없다"를 확인하고도 사후 변이 확인을 받아들여 승인했다. 설계서 5.1절은 절차 항목 누락을 P1 지적으로 정한다. 검증 기준을 고치는 일은 제작자가 고르지 않았으므로 이 계획에서 바꾸지 않는다. → 처리: #111
- `node --test` 안에서 도는 테스트가 `node --test`를 자식으로 띄우면 `NODE_TEST_CONTEXT`가 넘어가 자식이 테스트 파일을 실행하지 않고 종료 코드 0으로 끝난다("run() is being called recursively" 경고). 통과로 보이는 거짓 결과라 테스트에서 이 변수를 빼야 한다. 에이전트의 셸과 자체 테스트 실행기(환경 변수 허용 목록)에는 이 변수가 없다. → 처리: [코드 구조 문서](../../../harness/architecture.md)
- 계획 검증 1라운드의 P1(F1)은 "한 브랜치에 step을 쌓는다"는 틀린 전제였고 반박으로 닫혔다. 반박은 새 커밋이 올라와야 판정되므로 계획 검증이 한 라운드(약 12분) 더 걸렸다. → 처리: 해당 없음
- 인자로 받은 문자열을 셸로 실행하는 하네스 명령은 L1 훅의 우회로가 된다. 훅은 `bash -c`·`eval`의 안쪽은 다시 판정하지만(`scripts/hooks/shell.ts`) 하네스 자신의 명령 인자는 들여다보지 않는다. 검증자 둘 다 놓쳤다. 다시 만드는 명령은 셸을 쓰지 않고, step2의 테스트가 "셸 명령 문자열은 실행되지 않는다"를 확인한다. 같은 꼴의 명령을 새로 만들지 않게 설계서 13.1절에 한 줄을 적는다(step3 문서). → 처리: #111
- `ci.repro`가 없는 프로파일(core, web)로 만든 리포에서는 다시 만드는 `fail-first`가 실행할 명령을 모른다(종료 코드 2). 예외 기록만 쓸 수 있다. 프로파일에 `ci.repro`를 넣는 일은 판정 관련 설정 변경이라 이 계획에서 하지 않는다. step3에서 TD로 등록한다. → 처리: #111

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- step3은 step2가 만든 `fail-first`로 자기 기록을 남긴다(진행 로그에 완료 처리가 옮긴 줄이 보여야 한다). step0·step2는 명령이 아직 없으므로 실패한 실행의 출력을 진행 로그에 직접 적는다. step1(되돌리기)은 지우는 일이라 실패할 테스트가 없다.
- step1 뒤: L1 훅에 `fail-first`로 감싼 금지 명령을 넣어도 실행 경로가 없다(명령 자체가 없다). step2 뒤: 셸 명령 문자열을 인자로 주면 아무것도 실행하지 않고 종료 코드 2다(테스트가 표시 파일이 생기지 않음을 확인한다).
- 자체 테스트 `node scripts/harness.ts self-test --only r5-fail-first`.

## 다음 할 일

- 지금: 고친 계획(계획만 담은 커밋)을 push해 초안 PR을 열고 계획 검증(G1)을 다시 받는다. 승인 뒤 같은 PR에 step1(되돌리기)을 올리고 제작자 head 승인을 요청한다.
- step1이 병합되면 `new-task --plan 20261117-r5-fail-first --step 2`로 step2(파일만 받는 기록 명령), 그 뒤 step3(완료 처리 검사)을 한다. 이 계획의 PR은 모두 위험도 높음이다: 초안으로 올리고 `pr-ready`로 한 번만 승인을 요청한다.
- step2는 명령이 아직 없으므로 실패한 실행의 출력을 진행 로그에 직접 적고, step3은 step2가 만든 `fail-first`로 기록을 남긴다.
- step3을 시작할 때 보관해 둔 테스트·시나리오 초안(옛 step1에서 쓴 것. 리포 밖 세션 스크래치패드에 있어 세션이 끝나면 없을 수 있다)이 있으면 새 인터페이스(파일 인자)에 맞춰 쓴다. 없으면 step3 지시서대로 새로 쓴다.
- PR #110(#102 step5)과 같은 파일을 고친다(`scripts/test/selftest.test.ts`, 설계서 버전 줄·변경 이력, `CHANGELOG`). 먼저 병합된 쪽의 뒤에 `origin/main`을 병합해 푼다(TD-39).
