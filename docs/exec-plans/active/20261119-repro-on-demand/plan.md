---
id: 20261119-repro-on-demand
issue: 143 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T19:40:10+09:00 # new-task가 채운다
---

# 재현 job을 재현 테스트가 붙은 지적이 있을 때만 띄운다 (TD-49 ④, #135를 새 절차로 다시 시작)

## 목표와 수용 기준

판정 워크플로(`judge-claude.yml`, `judge-codex.yml`)의 재현 job(`repro`)은 판정이 나오면 항상 돈다. 재현 테스트가 붙은 지적이 없으면 실행할 것이 없는데도 job 하나에 1분이 청구된다. 2026-11-17~18 이틀에 57회였다(최대 57분, 그 이틀 청구 782분의 7%. TD-49 ④). 할 일이 없는 재현 job을 띄우지 않는다. 격리 경계(재현 job의 권한, environment)와 기록 job은 그대로 둔다.

같은 일을 Issue #135에서 계획했다가 접었다(PR #136). 이번에는 #139에서 정한 순서로 한다(`docs/SECURITY.md` "워크플로 변경 절차": 제작자의 워크플로 커밋이 먼저, 봇의 구조 테스트가 그 뒤).

수용 기준:

1. 유출 검사 명령(`codex-scan`, `claude-scan`)이 판정을 내보낼 때 환경 변수 `GITHUB_OUTPUT`이 가리키는 파일에 `repro=true` 또는 `repro=false` 한 줄을 덧붙인다. 두 명령을 실제로 실행하는 테스트로 아래 넷을 확인한다.
   - 지적 가운데 재현 테스트 내용(`repro.content`)이 빈 문자열이 아닌 것이 하나라도 있는 판정: `repro=true`.
   - 그런 지적이 없는 판정(지적이 없는 승인 포함): `repro=false`.
   - 판정을 내보내지 못한 실행(종료 코드가 0이 아니다): `repro` 줄을 쓰지 않는다.
   - `GITHUB_OUTPUT`이 없는 실행(로컬): 지금처럼 판정 파일만 쓰고 종료 코드 0이다.
2. 두 판정 워크플로에서 `judge` job이 출력 `repro`(`${{ steps.scan.outputs.repro }}`)를 내고, 재현 job의 조건이 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`이다. 값이 없거나 `false`가 아닌 값이면 지금처럼 돈다(모르면 돌린다). `scripts/test/ci.test.ts`가 두 워크플로에서 단언한다.
3. 재현 job의 권한·격리와 기록 job의 입력·조건은 바뀌지 않는다. 재현 job이 건너뛰어져도 기록 job은 돈다: `scripts/test/ci.test.ts`가 두 워크플로의 기록 job 조건이 `${{ !cancelled() && needs.plan.result != 'skipped' && needs.plan.outputs.skip != 'true' }}`이고 그 조건에 `needs.repro`가 나오지 않는 것을 단언한다.
4. 병합되는 head에는 워크플로 변경과 그것을 단언하는 테스트가 함께 있다. step의 AC는 워크플로 변경이 없는 트리에서 실패하고(수용 기준 2의 새 단언), 워크플로만 바뀐 트리에서도 실패한다(지금의 단언이 옛 조건을 요구한다).
5. 설계서(10.2절 (3), 10.4절), `CHANGELOG`, 기술 부채 표(TD-49)가 바뀐 동작과 맞는다. `docs/SECURITY.md` "워크플로 변경 절차"의 "해 보지 않은 것" 가운데 이번에 해 본 것(계획 검증을 받는 계획에서의 순서, 봇이 켠 자동 병합)을 해 본 결과로 고친다.

## 범위 / 비범위

범위:

- `scripts/`: 유출 검사 명령의 `repro` 출력과 그 테스트, 워크플로 구조 테스트.
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`: `judge` job의 출력 한 줄, 재현 job의 조건 한 줄과 그 위의 주석 한 줄. **제작자가 커밋한다.** 봇은 패치 파일로 준비한다.
- 문서와 기술 부채 표, 시험 기록(`lab/`).

비범위:

- 재현 job의 실행 내용(`runRepro`), 기록 쪽(`record-review`, `parseReproResults`, 원장), 재현 job의 권한·environment·캐시 규칙.
- main의 중복 `test` 생략(TD-49 ③, 제작자 결정으로 하지 않는다), job 합치기, `gates`의 제목 수정 생략(TD-49 ⑤), 인증 저장 job(`store`)의 조건부 실행.
- `check.yml`, `gates.yml`, `revert.yml`.

## 관련 파일·문서

- `scripts/ci/repro.ts`, `scripts/harness.ts`(`codex-scan`·`claude-scan` 명령)
- `scripts/test/scan-output.test.ts`(새 파일), `scripts/test/ci.test.ts`
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`(제작자 커밋)
- `lab/repro-on-demand/`(워크플로 패치와 적용 방법), `lab/workflow-change/result.json`
- `docs/harness/design.md`, `docs/harness/CHANGELOG.md`, `docs/SECURITY.md`, `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `scripts/ci/verdict.ts`, `scripts/ci/codex-scan.ts`, `scripts/ci/claude-scan.ts`, `scripts/gates/harness-guard.ts`, `scripts/test/record.test.ts`, `scripts/test/repro.test.ts`

## step 목록

- step0 repro-on-demand: 유출 검사 명령의 `repro` 출력, 워크플로 변경(제작자 커밋), 구조 테스트, 문서를 한 PR로 올린다.

## 진행 로그

- 2026-11-19: 제작자 대화 지시("TD-53대로 워크플로 변경 절차를 먼저 따로 정한 뒤 새 Issue로 다시 시작해")로 봇이 Issue #143을 등록했다. 절차는 #139(PR #141, 병합 `bd18dd0`)에서 정했다. 계획을 썼다.
- 2026-11-19: #139의 병합 뒤 관찰. 워크플로 변경이 든 PR #141은 봇이 켠 자동 병합으로 병합됐다(제작자 승인 10:34:11Z, 병합 10:36:12Z). main의 `judge-codex.yml`에 더한 줄이 있다. 그 뒤 main의 `check`(실행 44507204377)와 판정 워크플로의 결과는 이 PR의 첫 판정에서 확인해 적는다.

## 의사결정 로그

- **순서**: 계획 검증(G1) → 봇의 push 1(스크립트, 그 테스트, 문서, 워크플로 패치 파일) → 제작자의 워크플로 커밋(GitHub 웹) → 봇의 push 2(워크플로 구조 테스트, 완료 처리) → 판정 → 승인. 이유: 워크플로 변경과 그 단언이 서로를 요구하게 해서, 어느 한쪽이 빠진 head가 `check`를 통과하지 못하게 한다. push 1에서 설계 전체(패치 포함)가 판정을 받으므로, 패치를 고쳐야 하는 지적은 제작자에게 요청하기 전에 나온다. 버린 대안: 봇이 먼저 전부 올리고 제작자가 마지막에 패치를 올린다(#135. 패치가 빠져도 `check`가 통과해 사람의 확인에 기대야 했다).
- **계획 검증과의 순서**: #139는 소규모라 PR을 봇의 마지막 push 뒤에 열었다. 이 계획은 중규모라 계획만 담은 초안 PR이 먼저 열린다. 그래서 제작자의 커밋만 올라간 head에서 `check`가 돌고 실패한다(지금의 구조 단언이 옛 조건을 요구한다). 기대한 실패다. 봇이 바로 이어서 push 2를 올린다. `docs/SECURITY.md`에 "해 보지 않은 것"으로 적어 둔 갈래이고, 이번에 해 본 대로 문서를 고친다.
- **push 1이 병합될 수 없는 이유**: 완료 처리(`complete-step`)를 push 2에서 한다. 그 전에는 `plan-gate`가 실패하고 PR은 초안이다.
- **값이 없으면 돈다**: 조건을 `!= 'false'`로 쓴다. 출력이 빠지거나 깨졌을 때 재현을 건너뛰면 재현된 P1이 원장에 남지 않는다. 버린 대안: `== 'true'`.
- **`repro` 출력의 기준은 `runRepro`와 같다**: `runRepro`는 `repro.content`가 빈 지적을 건너뛴다(`scripts/ci/repro.ts`). 같은 기준으로 "하나도 없다"를 `false`로 낸다. 그러면 건너뛰어진 재현 job이 기록 job에 넘기는 값(빈 문자열)은, 지금 재현 테스트가 없는 판정에서 재현 job이 내는 값(`reproResultsData([])`가 빈 문자열)과 같다. 기록 쪽은 바꿀 것이 없고, 빈 값의 처리는 이미 테스트가 있다(`scripts/test/repro.test.ts`의 `parseReproResults('', …)`가 빈 배열, `scripts/test/record.test.ts`의 `--repro-results` 없는 기록들). 그래서 `record.test.ts`는 고치지 않는다(지금 동작을 고정하는 테스트를 더하면 변경 전 코드에서도 통과해 `test-effect`가 실효 없음으로 낸다).
- **기록 job 조건의 단언은 `ci.test.ts`에 넣는다**: 지금 구조를 고정하는 단언이지만 같은 파일에 수용 기준 2의 새 단언이 있어 파일 전체는 변경 전 트리에서 실패한다.
- **접은 #136의 초안**: 옛 worktree(`feat/20261119-actions-usage-2-s0`)에 미커밋으로 남아 있다. 계획 검증 승인 전에는 열지도 돌리지도 않는다. 승인 뒤에 참고하되, 테스트가 변경 전 코드에서 실패하는 것을 이 worktree에서 다시 확인하고 구현한다.

## 발견 사항

- 없음

## 열린 질문

- 없음

## 검증 방법과 결과

- 수용 기준 1~4: step0의 AC(테스트 다섯 파일).
- 수용 기준 5: `node scripts/harness.ts check`의 doc-lint와 자체 리뷰.
- 병합 뒤(AC가 아니다. 관찰해서 Issue #143에 남긴다): 재현 테스트가 없는 판정에서 재현 job이 건너뛰어지고 기록 job이 판정을 기록하는지, 두 판정 워크플로에서 본다.

## 다음 할 일

- 계획만 담은 커밋을 올려 계획 검증을 받는다. 승인 뒤 step0.
