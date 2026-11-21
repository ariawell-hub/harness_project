---
id: 20261122-size-scope-warn
issue: 186 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T02:49:16+09:00 # new-task가 채운다
---

# gates가 pr-size(R15)와 scope(R18)를 경고로 낸다 (TD-6)

## 목표와 수용 기준

설계서 5절의 R15(PR 크기 상한)와 R18(계획 범위 밖 변경 표시)은 L3 검사 `pr-size`와 `scope`가 맡게 돼 있는데 둘 다 없다(기술 부채 표 TD-6). PR이 열려 있는 동안 크기와 범위 이탈을 알려 주는 것이 없어, 크기는 병합된 뒤의 지표로만 보고 범위는 검증자가 손으로 견준다. `gates` 판정 묶음이 두 검사를 **경고**로 내게 한다(설계서 10.2절 (1): 처음에는 경고로 운영한다).

수용 기준:

1. `gates` 판정 묶음의 결과에 `pr-size`와 `scope`가 필수 판정 다섯 뒤에 들어가고, 기록 job이 둘을 커밋 상태로 쓴다. 워크플로 파일과 `scripts/harness.ts`는 바뀌지 않는다.
2. 두 판정은 병합을 막지 않는다.
   - 경고여도 `state`는 `success`다. 경고는 `description`이 `경고: `로 시작하는 것으로 가린다.
   - 필수 체크 목록(`GATE_CONTEXTS`, `harness.config.json`의 `ci.requiredChecks`, `ops-check`의 요구 목록)에 넣지 않는다.
   - 판정 중 예외가 나면 그 context만 `error`다. 다른 판정의 결과는 바뀌지 않는다.
   - 결과 파일이 없거나 깨졌으면 기록 job이 두 context도 `error`로 쓴다(필수 체크가 아니라 병합에는 영향이 없다).
   - 두 판정의 결과는 PR이 정하는 값(파일 경로)이 아무리 길고 많아도 크기가 묶인다: `details`의 한 줄은 200자, 판정 하나의 `details` 전체는 12,000바이트(UTF-8)를 넘지 않고(줄였다는 표시 한 줄은 따로다), `description`에 넣는 경로 하나는 60자까지다. 이유: 결과 파일은 job 출력과 환경 변수 하나로 기록 job에 넘어간다. 커지면 기록 step이 시작되지 못해 필수 판정까지 기록되지 않는다.
   - 파일 경로는 `git`이 준 글자 그대로 glob과 견준다(`\`를 `/`로 바꾸지 않는다). 이름에 `\`가 든 파일이 폴더 경로로 판정되지 않는다.
3. `pr-size`: merge-base 대비 변경 줄 수(`git diff --numstat`의 추가 + 삭제)의 합이 상한을 **넘으면** 경고다.
   - 세지 않는 파일: `prSize.exclude`의 glob에 맞는 파일(기본값은 문서·테스트·생성 파일), `deps.lockfiles`의 파일, 바이너리.
   - 상한과 제외 목록은 설정 `prSize`(`maxLines` 기본 400, `exclude`)로 조정한다. 키가 없는 설정 파일은 기본값으로 읽는다. 판정은 main 쪽 설정만 쓴다.
   - `prSize`를 바꾼 PR에는 `harness-guard`가 "판정 관련 설정 변경" 신호를 낸다(상한을 올리는 것은 완화다).
4. `scope`: PR이 바꾼 파일 가운데 계획 자신의 파일도 아니고 계획의 "관련 파일·문서"의 경로에도 들지 않는 것이 하나라도 있으면 경고이고, 그 파일들이 `details`에 나온다.
   - 범위 경로는 그 섹션에서 백틱으로 감싼 글자다. glob으로 맞거나 그 경로를 폴더로 본 아래에 있으면 범위 안이다. `읽기만`으로 시작하는 목록 항목의 경로와 코드 블록 안의 글자는 범위에 넣지 않는다.
   - 코드 블록은 여는 펜스의 글자와 길이를 기억해 가린다(같은 글자가 그 길이 이상인 줄에서만 닫는다). 긴 펜스 안의 짧은 펜스가 블록을 닫지 않는다. 섹션의 경계(다음 `## ` 제목)도 같은 기준으로 `scope`가 스스로 읽는다. `scripts/lib/plan.ts`의 섹션 추출은 바꾸지 않는다.
   - 계획은 PR 트리의 것을 읽는다. 브랜치 이름이 계획에 이어지지 않거나 계획 파일이 없으면 보지 않고 통과다(계획이 없는 것은 `plan-gate`가 막는다).
5. 확인된 revert PR(`revert-check`가 확인한 것)에서는 두 판정 모두 보지 않고 통과다.
6. 절차서에 두 경고 판정의 뜻과 "관련 파일·문서"를 적는 형식이 있고, 설계서·구조 문서·`CHANGELOG`·기술 부채 표(TD-6)가 구현과 맞다.

알려 둔 한계(이 계획에서 고치지 않는다):

- 경로는 `git` 출력을 UTF-8로 읽은 글자열이다. UTF-8로 읽을 수 없는 파일 이름은 제외 목록·범위 경로와 견줄 때 어긋날 수 있다(TD-63과 같은 원인). 줄 수의 합은 영향을 받지 않는다.
- 이름을 바꾼 파일은 삭제와 추가로 센다(`--no-renames`. 다른 판정의 변경 파일 목록과 같은 기준이다).
- 필수 판정 다섯의 `details`에는 크기 상한이 없다(지금도 그렇다). 이 계획은 새로 더하는 두 판정만 묶고, 나머지는 step1이 새 기술 부채 행에 적는다.
- `scope`는 파일 단위다. "관련 파일·문서"에 적은 파일 안에서 계획과 무관한 곳을 고친 것은 잡지 못한다(검증자가 본다).

## 범위 / 비범위

범위:

- 경고 판정의 틀: context 목록(`WARN_CONTEXTS`), 판정 묶음(`runGates`)과 기록(`recordStatuses`)의 연결, 판정 job 요약의 `경고` 표기.
- `pr-size` 판정과 설정 `prSize`(step0), `scope` 판정(step1).
- 문서: 절차서 2절·5절, 계획 템플릿 둘의 주석, 구조 문서, `CHANGELOG`, 설계서(step1), 기술 부채 표의 TD-6 행과 새 행 하나(step1).

비범위:

- 경고를 차단으로 바꾸는 일과 그 스위치(Q9. 지표를 본 뒤 제작자가 정한다).
- 필수 체크 등록, 브랜치 보호 설정, `harness.config.json`의 `ci.requiredChecks`(제작자만 한다. 경고 판정은 넣지 않는다).
- 워크플로 파일(`.github/workflows/`). 판정 job과 기록 job은 main의 스크립트를 실행하므로 바꿀 것이 없다.
- 지표(`scripts/metrics/`)가 두 경고의 수를 세는 일과 지표 출력의 "게이트가 없다" 문구, `pr-state`가 경고를 보여 주는 일. 이유: 다른 세션의 PR(#171, #185)이 그 파일들을 고치는 중이고, 지표 문구를 바꾸면 그 블록이 든 문서까지 다시 만들어야 한다. step1이 새 기술 부채 행으로 남긴다.
- 검증자 프롬프트에 `scope`의 결과를 넣는 일. 검증자는 지금처럼 자체 리뷰 체크리스트의 R18 항목으로 본다.
- `harness.config.json`과 `profiles/`에 `prSize` 키를 적는 일. 기본값으로 충분하고, 키가 없어도 읽힌다.
- R11 구조 테스트, R19 보안 린트·SAST(TD-6의 나머지).

## 관련 파일·문서

- `scripts/gates/pr-size.ts`(새 파일), `scripts/gates/scope.ts`(새 파일), `scripts/gates/harness-guard.ts`(`CONFIG_KEYS`에 한 항목)
- `scripts/ci/results.ts`, `scripts/ci/gates.ts`, `scripts/ci/record.ts`
- `scripts/lib/config.ts`(`prSize`), `scripts/lib/util.ts`(`WARN_PREFIX`, `capDetails`)
- `scripts/test/pr-size.test.ts`(새 파일), `scripts/test/scope.test.ts`(새 파일)
- `scripts/test/ci.test.ts`, `scripts/test/record.test.ts`, `scripts/test/risk-gate.test.ts`, `scripts/test/revert-check.test.ts`, `scripts/test/harness-guard.test.ts`
- `docs/harness/workflow.md`(2절, 5절), `docs/harness/architecture.md`(파일 표), `docs/harness/CHANGELOG.md`
- `docs/harness/design.md`(0절 머리말·변경 이력, 10.2절 (1), 10.3절, 14.6절), `docs/exec-plans/tech-debt-tracker.md`(TD-6 행, 새 행 하나)
- `docs/exec-plans/TEMPLATE.md`, `docs/exec-plans/TEMPLATE-small.md`("관련 파일·문서"의 안내 주석)
- 읽기만: `scripts/gates/risk-gate.ts`(`changedFiles`), `scripts/gates/revert-check.ts`, `scripts/lib/plan.ts`(`parseBranch`, `findPlan`, `planCandidates`, `section`, `stripHtmlComments`), `scripts/lib/git.ts`, `scripts/commands/ops-check.ts`, `scripts/harness.ts`(`gates`, `record-status` 명령), `scripts/test/helpers.ts`, `.github/workflows/gates.yml`, `scripts/cross-review/checklist.md`

## step 목록

- step0 pr-size: 경고 판정의 틀과 `pr-size` 판정, 설정 `prSize`
- step1 scope: `scope` 판정과 "관련 파일·문서"를 적는 형식, 설계서·기술 부채 표 정리

## 진행 로그

- 2026-11-22 02:59 Issue #186을 등록하고(제작자 대화 지시의 2순위) 계획을 썼다. 쓰기 전에 커밋하지 않는 시험 구현으로 확인한 것: 판정 묶음에 context 둘을 더하면 기존 테스트 여섯 건이 context 목록 단언에서 실패한다(`ci.test.ts` 3건, `record.test.ts`·`revert-check.test.ts`·`risk-gate.test.ts` 1건씩). `ops-check`·`protection`·`plan-gate`·`harness-guard`·`lib`·`selftest` 테스트는 그대로 통과한다.
- 2026-11-22 02:59 초안 규칙을 main의 최근 병합 30건에 적용해 봤다(읽기만). `pr-size` 경고 9건(가장 큰 것 3,152줄), `scope` 경고 10건(주로 테스트 보조 파일, 경로를 백틱 없이 적은 옛 계획).
- 2026-11-22 03:10 PR #187의 첫 계획 검증(head `b6c6623`): claude 승인, codex 수정 요청 넷. F1: 경고 판정의 `details`에 크기 상한이 없어 긴 경로가 많으면 기록 job의 환경 변수 한도를 넘는다. F2: step0이 `record.test.ts`에서 상태 수만 고치라고 해 다른 단언이 실패한다. F3: 긴 펜스 안의 짧은 펜스가 코드 블록을 닫는다. F4: `matchesAny`가 파일 경로의 `\`를 `/`로 바꿔 이름에 `\`가 든 파일이 범위 안으로 판정된다. 넷 다 맞는 지적이라 반박하지 않고 계획을 고쳤다.
- 2026-11-22 03:10 고친 계획의 문장은 커밋하지 않은 초안 구현과 테스트로 먼저 확인했다: step0 초안은 `node --test scripts/test/pr-size.test.ts` 12건과 `record.test.ts` 14건이 통과하고(상세 크기 상한, 긴 경로 40개, 역슬래시 파일 이름, 기록 명령의 경고 판정 포함), step1 초안은 `scope.test.ts` 14건이 통과한다(긴 펜스 안의 짧은 펜스, 홀수 번 나온 안쪽 펜스, 역슬래시 파일 이름 포함). 초안은 계획 승인 뒤에 테스트 커밋부터 올린다.

## 의사결정 로그

- 결정: 경고는 커밋 상태 `success`와 `경고: `로 시작하는 설명으로 낸다. / 이유: 커밋 상태에는 중립 값이 없다. `failure`로 쓰면 필수 체크 설정이 없는 리포의 `pr-state`가 체크 요약만 보고 실패로 분류한다. / 버린 대안: `failure`(필수 체크가 아니라 병합은 되지만 분류와 `gh pr checks`가 실패로 읽는다), 커밋 상태를 쓰지 않고 판정 job 요약에만 남기기(지표가 나중에 셀 자료가 없다).
- 결정: 경고 판정은 `GATE_CONTEXTS`가 아니라 새 목록 `WARN_CONTEXTS`에 둔다. / 이유: `ops-check`가 `GATE_CONTEXTS`를 필수 체크 요구 목록으로 쓴다. 거기에 넣으면 브랜치 보호에 등록하라는 요구가 된다(제작자만 할 수 있고, 경고의 뜻과 어긋난다).
- 결정: 설정 `prSize`는 키가 없으면 기본값이고 `harness.config.json`과 프로파일에는 적지 않는다. / 이유: 대상 리포의 옛 설정 파일이 그대로 읽혀야 하고, 설정 파일은 다른 세션과 겹치기 쉬운 보호 경로다.
- 결정: `scope`의 범위 경로는 백틱 안의 글자로만 읽고, `읽기만`으로 시작하는 항목은 뺀다. / 이유: 최근 계획 대부분이 이미 이렇게 쓴다. 문장 속의 "설계서 6절" 같은 말을 경로로 추측하지 않는다. / 버린 대안: 백틱 없는 경로도 읽기(산문과 가를 수 없다), "읽기만" 항목도 범위에 넣기(읽기만 하겠다고 한 파일을 고친 것이 바로 범위 이탈이다).
- 결정: 지표와 `pr-state`는 이 계획에서 건드리지 않는다. / 이유: 비범위에 적은 대로 다른 세션의 PR과 겹친다. 새 기술 부채 행으로 남긴다.
- 결정: 위험도는 normal이다. / 이유: 보안·인증·마이그레이션·데이터 스크립트가 아니다. 보호 경로를 바꾸므로 PR의 위험도는 `risk-gate`가 경로로 올린다.
- 결정: 경고 판정의 `details`는 `capDetails`로 묶고(한 줄 200자, 전체 12,000바이트), 고치는 법·근거 줄을 파일 줄보다 앞에 둔다. / 이유: 결과 파일 전체가 환경 변수 하나(Linux에서 약 128KB까지)로 넘어간다(PR #187의 F1). 줄일 때 뒤에서부터 버리므로 고정 줄이 앞에 있어야 남는다. / 버린 대안: 기록 job에 넘기는 결과에서 `details`를 떼기(워크플로 파일을 바꿔야 한다), 필수 판정까지 한꺼번에 묶기(필수 판정의 결과 문구가 바뀐다. 새 기술 부채 행으로 남긴다).
- 결정: 파일 경로는 `globToRegExp(glob).test(path)`로 견주고 `matchesAny`를 쓰지 않는다. / 이유: `matchesAny`는 파일 경로의 `\`를 `/`로 바꾼다(PR #187의 F4). `git`은 Windows에서도 `/`로 나눈 경로를 주므로 바꿀 필요가 없다. / 버린 대안: `matchesAny`를 고치기(다른 호출자 여럿의 동작이 바뀐다).
- 결정: `scope`는 섹션을 자기 함수(`relatedSection`)로 읽고 `scripts/lib/plan.ts`는 고치지 않는다. / 이유: `sections`는 펜스의 글자와 길이를 기억하지 않는다(PR #187의 F3). 그 함수는 계획 검증의 해시가 쓰므로, 고치면 이미 승인된 계획의 해시가 달라질 수 있다.

## 발견 사항

- 없음

## 열린 질문

없음

## 검증 방법과 결과

- 각 step의 Acceptance Criteria.
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push해 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다(테스트 먼저).
