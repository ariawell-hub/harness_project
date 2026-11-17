---
id: 20261117-r5-fail-first
issue: 111 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-17T17:22:39+09:00 # new-task가 채운다
---

# feat: R5 '먼저 실패한 테스트' 기록을 명령으로 남기고 완료 처리에서 확인한다

## 목표와 수용 기준

R5(TDD)의 "먼저 실패한 테스트" 기록이 문장으로 대체되지 않게 한다. #102 step5(PR #110)에서 대화 세션이 테스트를 구현보다 먼저 쓰고도 구현 전에 실패하는 실행을 돌리지 않았고, 테스트 4개가 첫 실행에 통과했다. 지금 이 기록은 절차서의 문장, PR 템플릿의 자유 서술 칸, 검증자의 판단에만 기댄다. 제작자 결정(2026-11-17 대화)에 따라 기록을 명령의 실행 결과로 남기고 `complete-step`이 그 기록을 확인하게 한다.

수용 기준:

1. **기록 명령**: `node scripts/harness.ts fail-first "<테스트 명령>"`이 계획 브랜치의 worktree에서 그 명령을 셸로 실행한다(시간 제한 `limits.acTimeoutSec`). 종료 코드가 0이 아니고 출력에 단언 실패 정규식이 보일 때만 기록을 남기고 종료 코드 0으로 끝난다. 통과한 실행(종료 코드 0), 시간 초과, 단언 실패가 아닌 실패(모듈을 찾지 못함, 문법 오류)는 기록하지 않고 종료 코드 1과 이유를 낸다. 계획 브랜치가 아니거나 명령이 비면 종료 코드 2다.
2. **기록 위치와 내용**: 기록은 git이 추적하지 않는 worktree별 하네스 상태 폴더의 `fail-first.jsonl`에 한 줄씩 쌓인다(시각, 계획 id, step, 명령, 종료 코드, HEAD, 단언 실패가 보인 첫 줄 200자 이내, 출력의 sha256 앞 12자). 계획 파일이나 PR 본문에 손으로 쓴 문장은 기록이 아니다.
3. **예외 기록**: `node scripts/harness.ts fail-first --exempt "<사유>"`가 실행 없이 예외를 같은 파일에 남긴다(R5의 예외: 문서·설정·순수 리팩터, 기록을 남기지 못한 경위). 사유가 비면 종료 코드 2다.
4. **완료 처리 검사**: `complete-step`은 그 step의 변경(merge-base 대비, 작업 트리 포함)에 테스트 파일이 있으면 그 계획·step의 기록이나 예외를 요구한다. 없으면 계획 파일을 바꾸지 않고 종료 코드가 0이 아니며 고치는 법을 출력한다. 있으면 진행 로그에 `먼저 실패한 기록(R5)` 또는 `R5 예외` 한 줄(명령, 종료 코드, 단언 실패 줄, 기록 시각 또는 사유)을 더해 계획 전용 커밋에 담는다. 테스트 파일이 바뀌지 않은 step의 동작은 그대로다.
5. **runner**: step 세션 프롬프트가 `fail-first` 사용을 지시한다. 테스트 파일을 바꾸고 기록 없이 끝난 세션은 runner의 완료 처리 실패(`plan:complete`)로 세어지고 다음 세션 프롬프트에 그 이유가 들어간다.
6. **자체 테스트**: 시나리오 `r5-fail-first`가 샘플 리포에서 위 1·3·4를 CLI로 확인한다(기록 없이는 완료 처리가 막힌다, 통과하는 테스트와 단언 실패가 아닌 실패는 기록되지 않는다, 기록 뒤에는 완료된다). 완료 처리 검사를 뺀 사본에서 이 시나리오가 실패한다.
7. **문서**: 설계서 5.1절 R5 행과 12.4절 시나리오 표, 절차서 3·4절(인정되는 기록의 형식), PR 템플릿의 R5 줄, `AGENTS.md` 작업 루프 3번, 코드 구조 문서, `CHANGELOG`, TD-4(남는 범위)를 고친다.

## 범위 / 비범위

- 범위: `scripts/commands/`(새 `fail-first.ts`, `task.ts`의 `completeStep`), `scripts/harness.ts`(명령·도움말), `scripts/runner/prompt.ts`(step 프롬프트 한 줄), `scripts/selftest/scenarios/`(새 시나리오), `scripts/test/`, `.github/pull_request_template.md`, 문서.
- 비범위:
  - CI의 R5 실효성 검사(새 테스트가 merge-base 코드에서 실패하고 head에서 통과하는가). TD-4로 남는다. 이 계획의 기록은 로컬 완료 처리에서만 확인하고 CI는 보지 않는다.
  - 검증자 프롬프트·체크리스트(`scripts/cross-review/`)의 판정 기준 변경. 제작자가 고르지 않았다.
  - "테스트를 구현보다 먼저 썼다"는 순서의 증명. 기록은 그 시점에 단언 실패가 있었다는 것만 말한다(설계서 5.1절: 순서는 CI로 증명할 수 없다).
  - `harness.config.json`·프로파일의 새 설정 키. 테스트 파일 판별은 코드의 기본 glob, 단언 실패 정규식은 이미 있는 `ci.repro.failPattern`을 쓴다(없으면 코드의 기본값).
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

- step0 record-command: `fail-first` 명령(실행·판정·기록·예외)과 기록 읽기, 테스트 파일 판별
- step1 complete-check: `complete-step`의 기록 검사와 진행 로그 한 줄, runner step 프롬프트, 자체 테스트 시나리오, 규칙 문서

## 진행 로그

- 2026-11-17 step0: 계획 작성. 제작자가 대화에서 대처를 지시했고 선택지 3개(기록 명령 + 완료 검사 / 문서·검증 기준만 / TD-4 앞당김) 가운데 첫째를 골랐다. 봇이 Issue #111을 등록했다. PR #110(#102 step5)은 제작자 승인 대기 중이라 건드리지 않는다.

## 의사결정 로그

- 결정(제작자, 2026-11-17 대화): R5의 "먼저 실패한 기록"을 명령의 실행 결과로 남기고 `complete-step`이 확인한다. / 이유: 제작자 지적("'테스트를 먼저 썼다' 같은 문장이 나왔을 때 동일하게 TDD를 실행하지 않을 수 있다"). 문서와 모델 판단은 이번에 뚫린 것과 같은 종류의 장치다. / 버린 대안: 문서·검증 기준만 강화, TD-4(CI 실효성 검사) 앞당김.
- 결정: 기록은 계획 파일이 아니라 git이 추적하지 않는 worktree별 상태 폴더(`fail-first.jsonl`)에 두고, `complete-step`이 진행 로그에 한 줄로 옮긴다. / 이유: 계획 파일의 줄은 손으로 쓸 수 있어 다시 문장이 된다. 상태 폴더의 파일은 명령만 쓴다(실패 횟수 `attempts.jsonl`과 같은 자리). PR에는 완료 처리가 옮긴 한 줄이 남아 검증자가 기록인지 예외인지 본다. / 버린 대안: `index.json`의 step 항목에 넣기(소규모 계획에는 `index.json`이 없고, 손으로 고치는 파일이다).
- 결정: 검사 조건은 "테스트 파일이 바뀐 step"이다. 동작 코드만 바꾸고 테스트를 바꾸지 않은 step은 이 검사의 대상이 아니다. / 이유: 그 경우는 R5의 다른 검출 항목(동작 코드 변경 시 테스트 변경 동반)의 몫이고 아직 구현되지 않았다. 기존 흐름(가짜 에이전트의 step, 문서 step)을 깨지 않는다. / 버린 대안: 코드가 바뀐 모든 step에 기록 요구(문서·설정 step마다 예외를 적게 된다).
- 결정: 단언 실패 판별은 `ci.repro.failPattern`(재현 job이 쓰는 정규식)을 쓰고, `ci.repro`가 null이면 코드의 기본값 `AssertionError|ERR_ASSERTION`을 쓴다. 테스트 파일 판별은 코드의 기본 glob이다. 새 설정 키를 두지 않는다. / 이유: "단언 실패"의 정의가 이미 프로파일 설정에 있다. 판정 관련 설정 키를 더하면 `harness-guard` 신호가 되고 프로파일 세 곳을 함께 고쳐야 한다. / 버린 대안: `failFirst.testGlobs`·`failPattern` 설정 키(다른 언어 프로파일에서 필요해지면 더한다).
- 결정: 예외는 `complete-step`의 옵션이 아니라 `fail-first --exempt`로 남긴다. / 이유: runner는 `completeStep`을 함수로 부르고 세션은 `complete-step`을 실행하지 않는다. 같은 명령이면 대화 세션과 runner 세션이 같은 방법을 쓴다.
- 결정: 위험도는 normal이다. / 이유: 검사를 더하는 변경이고 보안·인증·마이그레이션·데이터 스크립트가 아니다(절차서 1절). 약화·완화가 섞이면 `harness-guard`가 높음으로 올린다.

## 발견 사항

- PR #110에서 `review/claude`는 "먼저 실패한 기록이 없다"를 확인하고도 사후 변이 확인을 받아들여 승인했다. 설계서 5.1절은 절차 항목 누락을 P1 지적으로 정한다. 검증 기준을 고치는 일은 제작자가 고르지 않았으므로 이 계획에서 바꾸지 않는다. → 처리: #111

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- 이 계획의 step1은 step0이 만든 `fail-first`로 자기 기록을 남긴다(진행 로그에 완료 처리가 옮긴 줄이 보여야 한다). step0은 명령이 아직 없으므로 실패한 실행의 출력을 진행 로그에 직접 적는다.
- 자체 테스트 `node scripts/harness.ts self-test --only r5-fail-first`.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
- PR #110(#102 step5)과 같은 파일을 고친다(`scripts/test/selftest.test.ts`, 설계서 버전 줄·변경 이력, `CHANGELOG`). 먼저 병합된 쪽의 뒤에 `origin/main`을 병합해 푼다(TD-39).
