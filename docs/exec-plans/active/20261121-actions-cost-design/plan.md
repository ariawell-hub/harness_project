---
id: 20261121-actions-cost-design
issue: 170 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session-2 # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-21T13:06:30+09:00 # new-task가 채운다
---

# 비공개 리포에서의 Actions 비용 설계: 공개 기간에 재고, 예산과 절감 수단을 정한다

## 목표와 수용 기준

2026-11-18과 11-20에 Actions의 포함 사용량과 지출 한도가 바닥나 모든 job이 시작되지 않았다(Issue #126, #170). 2026-11-17~20의 실측으로는 월 $180~320의 속도다. 제작자는 2026-11-21에 이 리포를 공개로 바꿨고(표준 러너 무료), 하네스를 실제로 쓸 프로젝트는 비공개여야 한다고 정했다. 그래서 비공개 리포에서 감당할 수 있는 Actions 비용이 하네스의 요구사항이 된다.

공개 리포는 청구가 0이라 청구서로는 비용을 볼 수 없다. 이 계획은 (1) Actions 실행 기록에서 "비공개였다면 청구됐을 값"을 재는 명령을 만들고, (2) 그 값으로 판단하는 절차와 기준선을 문서로 남기고, (3) 절감 수단을 조사해 제작자가 고를 수 있는 결정 기록(ADR)으로 만든다. 고른 수단의 구현은 이 계획에 넣지 않는다.

수용 기준:

1. `node scripts/harness.ts actions-cost --since <YYYY-MM-DD> --until <YYYY-MM-DD>`가 그 기간(UTC 날짜, 양끝 포함)에 만들어진 Actions 실행의 job을 읽어, job마다 올림한 분과 러너 단가로 "비공개였다면 청구됐을 값"을 계산해 마크다운으로 표준 출력에 낸다. 읽기만 한다(GitHub에 쓰지 않고 파일을 쓰지 않는다).
2. 계산 규칙이 step0의 정의대로이고, 고정한 입력으로 계산 함수를 부르는 테스트가 값을 단언한다: 돌지 않은 job은 0분, 돈 job은 초를 분으로 올림(최소 1분), 다시 실행한 시도도 따로 청구, 단가를 모르는 러너와 self-hosted 러너는 금액에 넣지 않고 따로 보인다.
3. 출력에 합계, 워크플로별, job별, 날짜별, PR별, push 한 번당 평균, 올림으로 붙은 몫, 30일 환산값이 있다. PR을 찾지 못한 실행은 숨기지 않고 "PR을 찾지 못함" 행으로 합산한다.
4. 자료를 끝까지 읽지 못하면 종료 코드 2로 끝나고 표준 출력에 결과를 내지 않는다. 기간이 틀리면 GitHub을 읽기 전에 종료 코드 1로 끝난다.
5. 출력에는 수, PR 번호, 날짜, 그리고 안전한 글자로만 된 워크플로·job 이름만 적는다. PR 제목·브랜치 이름 같은 외부 입력 문자열과 계정 이름은 옮기지 않는다(설계서 14.6절).
6. `docs/harness/actions-cost.md`에 판단 절차(예산, 다시 재는 시점, 판단 시점, 재는 방법)와 기준선(2026-11-17~20, 비공개 기간)이 있고 `docs/index.md`가 가리킨다.
7. 절감 수단마다 예상 절감, 잃는 보장, 바꿔야 하는 것, 되돌리는 방법을 적은 ADR이 있고, 제작자가 고른 수단과 순서(또는 아직 고르지 않았다는 상태)가 적혀 있다. 설계서와 기술 부채 표가 ADR을 가리킨다.
8. `node scripts/harness.ts check` 통과.

## 범위 / 비범위

범위:

- 새 명령 `actions-cost`: 계산·렌더 모듈, 자료 읽기 모듈, 명령 파일, `scripts/harness.ts` 등록, 테스트, `docs/harness/architecture.md`의 해당 행.
- 새 문서 `docs/harness/actions-cost.md`와 `docs/index.md`의 링크.
- 새 ADR(비공개 리포의 Actions 비용: 예산과 절감 수단), `docs/decisions/index.md`, 설계서의 가리키는 줄(10.4절과 18절의 열린 질문), `CHANGELOG`, 기술 부채 표.

비범위:

- 절감 수단의 구현(push 전 통과 도장, 요청한 head만 검증, 러너 변경, Actions 밖 검증 서비스 등). ADR에서 고른 뒤 수단마다 별도 Issue로 한다. 보안 설계나 워크플로를 바꾸는 수단은 위험도 높음이다.
- `.github/workflows/` 변경, 보호 설정·시크릿·결제 설정·리포 공개 여부 변경(제작자의 일).
- 설계서 5절·10.2~10.4절·13.2절의 보장과 구조를 바꾸는 일. 이 계획은 ADR을 가리키는 줄만 더한다.
- 검증자의 구독 사용량(Q12).
- `metrics` 명령의 출력(`docs/QUALITY_SCORE.md`)에 비용을 넣는 일, 주기 실행(TD-11).
- `scripts/metrics/source.ts`에 있는 export의 동작 변경, `scripts/lib/github.ts`의 `GitHubPort` 변경.

## 관련 파일·문서

- `scripts/metrics/actions-cost.ts`, `scripts/metrics/actions-source.ts`, `scripts/commands/actions-cost.ts`(모두 새 파일)
- `scripts/harness.ts`(명령 등록)
- `scripts/test/actions-cost.test.ts`, `scripts/test/actions-cost-command.test.ts`(모두 새 파일)
- `docs/harness/architecture.md`
- `docs/harness/actions-cost.md`(새 파일), `docs/index.md`
- `docs/decisions/ADR-0008-actions-cost.md`(새 파일. 번호가 이미 쓰였으면 다음 빈 번호), `docs/decisions/index.md`
- `docs/harness/design.md`(10.4절과 18절의 가리키는 줄, 버전 줄), `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `scripts/metrics/source.ts`, `scripts/commands/metrics.ts`, `scripts/lib/exec.ts`, `scripts/lib/git.ts`, `scripts/lib/config.ts`, `.github/workflows/*.yml`, `docs/harness/workflow.md`

## step 목록

- step0 shadow-cost: `actions-cost` 명령(자료 읽기, 계산, 렌더)과 테스트, 구조 문서의 행.
- step1 baseline-procedure: 판단 절차 문서와 기준선 기록(`docs/harness/actions-cost.md`).
- step2 options-adr: 절감 수단 조사와 ADR, 설계서·기술 부채 표의 가리키는 줄.

## 진행 로그

- 2026-11-21 Issue #170 등록(제작자 대화 지시), `new-task`로 작업 공간을 만들고 계획을 썼다. 앞서 대화에서 임시 스크립트로 2026-11-17~20을 쟀다(최근 실행 1,000건, 돈 job 1,986개, 청구 단위 3,391분. Issue #170 본문). 그 스크립트는 리포에 없으므로 step0이 같은 계산을 명령으로 만든다.

## 의사결정 로그

- 결정: `metrics`에 잇지 않고 `actions-cost` 명령을 따로 둔다. / 이유: `metrics`의 출력은 `docs/QUALITY_SCORE.md`에 붙이는 주간 지표이고 PR 단위로 읽는다. 비용은 실행마다 job 목록을 읽어야 해 조회 수가 실행 수만큼 든다(1,000건이면 1,000회). 주간 집계가 그만큼 느려지면 안 된다. / 버린 대안: `metrics`에 절을 더하기(느려지고, 출력 문서가 다르다).
- 결정: 위험도는 normal이다(`new-task`에는 low로 넣었다가 고쳤다). / 이유: step0이 일반 코드다. 읽기만 하는 명령과 문서이고 검사·권한·워크플로를 바꾸지 않는다. 보안 설계를 바꾸는 절감 수단은 이 계획의 비범위이고 별도 Issue에서 높음으로 한다.
- 결정: 단가는 코드의 표로 두고 확인한 것만 넣는다(2코어 Linux x64 분당 $0.006). / 이유: 지금 워크플로는 모두 `ubuntu-latest`다. 확인하지 않은 단가로 금액을 내면 판단이 틀린다. 모르는 러너는 분만 보인다. / 버린 대안: 설정 파일(`harness.config.json`)에 단가를 두기(설정 스키마가 늘고, 단가는 프로젝트가 아니라 GitHub이 정한다).

## 발견 사항

- 판정 워크플로(`judge-claude`, `judge-codex`)와 `revert`는 `workflow_run`으로 시작해 실행 기록의 브랜치가 main이고 PR 목록이 비어 있다. PR을 찾으려면 다른 자료가 필요하다. PR head 커밋의 커밋 상태(`review/claude` 등)의 `target_url`이 그 실행을 가리킨다(2026-11-21에 PR #169에서 확인). → 처리: 해당 없음(step0의 작업에 반영했다)
- job 목록 조회는 기본으로 마지막 시도만 준다. 다시 실행한 실행의 앞선 시도는 `filter=all`로 받아야 한다(같은 날 PR #169의 판정 실행에서 확인: 시도 1의 job은 시작하지 못했고 시도 2가 돌았다). → 처리: 해당 없음(step0의 작업에 반영했다)
- 리포가 공개되면 포크의 PR이 `pull_request` 워크플로의 job 이름을 정할 수 있다. job 이름도 외부 입력이다. → 처리: 해당 없음(step0의 출력 규칙에 반영했다)

## 열린 질문

### 질문: 비공개 리포의 Actions 예산을 얼마로 두는가 (비용 결정)

- A) 계정의 포함 사용량(Pro 월 $18) 안. 프로젝트 하나가 월 PR 100개를 처리한다고 보면 PR 하나당 $0.18(2코어 Linux 30분) — 영향: 지금(PR당 약 100분: 청구 단위 3,391분 ÷ 같은 기간에 병합된 PR 33개)의 1/3 이하로 줄여야 한다. 프로젝트가 둘이면 다시 절반이다.
- B) 월 정액을 정해 초과 지출을 허용한다(예: 월 $50) — 영향: 줄일 폭이 작아진다. 지출 한도 설정이 필요하다(제작자의 일).
- C) 예산을 정하지 않고 절감 수단의 효과를 본 뒤 정한다 — 영향: step1의 문서에 예산이 "미정"으로 남고 판단 기준이 없다.
- 추천: A. 이유: 제작자가 "Pro 기본 요금제 안"을 물었고, 값이 있어야 절감 수단을 어디까지 넣을지 판단할 수 있다. step1에서 답을 적는다. 답이 없으면 A를 잠정값으로 적고 "제작자 확인 전"이라고 표시한다.

### 질문: 어느 절감 수단을 어떤 순서로 넣는가 (보안·하네스 원칙 결정)

- step2의 ADR이 후보표를 만든 뒤 묻는다. 지금은 답할 자료가 없다.

## 검증 방법과 결과

- 수용 기준 1~5: `node --test scripts/test/actions-cost.test.ts scripts/test/actions-cost-command.test.ts`, 그리고 이 리포에서 실제 기간으로 한 번 실행해 임시 스크립트의 값(3,391분)과 비교한다.
- 수용 기준 6·7: 문서가 있고 `doc-lint`(`check`에 들어 있다)를 통과한다. step의 AC가 필요한 절의 제목을 확인한다.
- 수용 기준 8: `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push하고 초안 PR을 열어 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
