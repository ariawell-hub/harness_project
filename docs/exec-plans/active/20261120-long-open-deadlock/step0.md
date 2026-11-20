# Step 0: long-open

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/harness/design.md` 9.1절(에스컬레이션 기준), 10.2절 (4)(지적 원장)·(6)("runner의 지적 대응"), 10.3절(`pr-state`), `docs/harness/workflow.md` 7절·8절
- `scripts/ci/ledger.ts`(`Ledger`, `Entry`의 `round`·`status`·`severity`·`reviewer`, `roundsOf`)
- `scripts/runner/review.ts`(`openBlocking`), `scripts/commands/pr-state.ts`, `scripts/runner/ledger-read.ts`(`readPrLedger`)
- `scripts/test/runner-review.test.ts`(장치 `judged`·`finding`·`emptyLedger`), `scripts/test/pr-state.test.ts`(`fixtureWithPR`, 명령 테스트 `cli`)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 테스트만 담은 커밋을 구현 커밋보다 먼저 만든다.

### 1. 판단 `scripts/runner/review.ts`

```ts
/** 오래 열린 지적으로 보는 재판정 수 */
export const LONG_OPEN_REJUDGED = 3;

export interface LongOpen {
  entry: Entry;
  /** 지적이 등록된 판정 뒤로 그 검증자가 낸 판정 수 */
  rejudged: number;
}
/** 재판정 수가 기준 이상인 열린 차단 지적. ID 번호 순 */
export function longOpen(ledger: Ledger): LongOpen[];
```

- 대상은 `status`가 `open`이고 `severity`가 `P0` 또는 `P1`인 지적뿐이다(지금의 `openBlocking`).
- 지적 `e`의 `rejudged`는 `roundsOf(ledger, e.reviewer) - e.round`다. `LONG_OPEN_REJUDGED` 이상인 지적만 돌려준다.
- `e.round`는 그 검증자의 몇 번째 판정에서 등록됐는가다. 닫혔다 다시 열린 지적도 등록된 판정부터 센다. 다른 검증자의 판정은 세지 않는다.
- 원장만 읽는 순수 함수다. 파일·GitHub·`git`을 읽지 않는다.
- runner(`scripts/runner/run.ts`)는 이 함수를 부르지 않는다.

### 2. `pr-state` `scripts/commands/pr-state.ts`

- 필수 체크 줄들 뒤, `분류:` 줄 앞에서 그 PR의 원장을 읽는다(`readPrLedger`). `longOpen(ledger)`의 지적마다 한 줄을 낸다: `- 오래 열린 지적: <ID> [<등급>, <검증자>] 재판정 <수>회 뒤에도 열려 있다 — 대화 세션은 더 고쳐 올리기 전에 제작자에게 묻는다(절차서 8절)`. 지적의 제목과 위치는 넣지 않는다.
- 원장 댓글이 없거나 해당 지적이 없으면 아무 줄도 더하지 않는다.
- 설정 `ci.recorderBot`이 비어 있으면 원장을 읽지 않고 아무 줄도 더하지 않는다.
- 원장을 읽다 예외가 나면 `- 오래 열린 지적 확인: 원장을 읽지 못했다(<예외 메시지의 첫 줄>)`을 그 자리에 내고 나머지 출력과 종료 코드(0)는 그대로다.
- `ci.requiredChecks`가 빈 리포(지금은 체크 요약 한 줄을 내고 끝난다. 분류 줄이 없다)에서도 같다: 체크 요약 줄 뒤에 위와 같은 규칙으로 줄을 내고(오래 열린 지적의 줄, 읽지 못했으면 확인 줄, `ci.recorderBot`이 비면 없음) 종료 코드 0으로 끝난다.
- 아무것도 쓰지 않는다(댓글·라벨·체크·파일).

### 3. 문서

- `docs/harness/workflow.md`
  - 8절: "교착" 항목 뒤에 한 줄짜리 항목 `- **오래 열린 지적(대화 세션)**: …`을 더한다. 그 한 줄에 다음이 모두 들어 있다.
    - 재판정 수의 뜻(지적이 등록된 판정 뒤로 그 검증자가 낸 판정 수)과 기준(3회).
    - 확인 시점: 계획 검증이든 구현 판정이든 새 판정이 끝나면 열린 지적에 대응하기 전에 `pr-state`를 실행한다.
    - 규칙: `오래 열린 지적` 줄이 보이는 지적은 더 고쳐 올리거나 반박하지 않고 제작자에게 묻는다. 물을 때 지적 ID와 지금까지의 대응, 선택지 `A 방향을 정해 한 번 더 고친다 / B 범위를 줄인다 / C 포기`를 적는다.
    - 남은 위험을 받아들이는 승인은 P0에만 있다(같은 절의 "제작자 승인(P0)"). P1에는 그 길이 없다.
    - runner는 이 기준을 쓰지 않는다: 실패 횟수(3회 방법 전환, 5회 중단)와 교착으로 다룬다.
  - 2절 "계획 검증"의 3번(`3. 필요한 검증자가 승인하면 …`) 끝에 한 문장을 더한다: 고치거나 반박하기 전에 `pr-state`로 오래 열린 지적이 있는지 본다(8절).
  - 4절은 고치지 않는다.
- `docs/harness/design.md`
  - 9.1절: 한 줄짜리 항목으로 적는다. 대화 세션에는 실패 횟수를 세는 기록이 없으므로 `pr-state`가 원장으로 재판정 수를 세어 오래 열린 지적을 보여 주고, 대화 세션은 그 지적을 제작자에게 묻는다는 것, runner는 이 기준을 쓰지 않고 실패 횟수와 교착으로 다룬다는 것. 교착의 정의(반박 2회)와 runner의 동작은 바꾸지 않는다.
  - 10.3절의 `pr-state` 설명(한 줄)에 오래 열린 지적의 줄을 낸다는 것을 적는다.
  - 문서 머리의 버전을 다음 번호로 올리고 변경 이력에 한 줄을 더한다.
  - 11.1절은 고치지 않는다.
- `docs/harness/CHANGELOG.md`의 "다음 버전 (미배포)"에 한 줄(설계서 버전, 무엇이 바뀌었는지, runner와 검사는 그대로라는 것).
- `docs/exec-plans/tech-debt-tracker.md`: TD-54 행의 상태를 `해결(#<이 PR 번호>: …)`로 바꾼다(②는 대화 세션에 넣었고 ①은 하지 않는다). 다른 행은 고치지 않는다. 표의 다른 행이 다시 정렬되지 않게 열 폭 안으로 쓴다.

### 4. 테스트

기존 테스트는 고치지 않는다.

`scripts/test/runner-review.test.ts`에 `longOpen`의 테스트를 더한다(원장을 그 파일의 `judged`·`finding`으로 만든다).

- `LONG_OPEN_REJUDGED`가 3이다.
- 한 검증자가 1번째 판정에서 P1을 등록하고 그 뒤 판정이 2번 더 쌓이면(판정 3번) 빈 배열, 3번 더 쌓이면(판정 4번) 그 지적 하나이고 `rejudged`가 3, 4번 더 쌓이면 `rejudged`가 4다.
- 2번째 판정에서 등록된 지적은 그 검증자의 판정이 4번일 때는 나오지 않고 5번일 때 나온다.
- 다른 검증자의 판정은 세지 않는다(codex의 지적에 claude의 판정만 5번 쌓이면 나오지 않는다).
- `deferred`·`fixed`·`rejected`·`accepted`인 지적과 P2·P3은 재판정 수가 3 이상이어도 나오지 않는다. P0은 나온다. P2·P3은 원장에 등록될 때 미룸이 되므로, 등급만으로 빠지는지 보려고 원장 객체에서 그 지적의 상태를 `open`으로 바꿔 놓고 본다.
- 여럿이면 ID 번호 순이다(F2가 F10보다 앞).

`scripts/test/pr-state.test.ts`에 명령 테스트를 더한다(가짜 GitHub. 원장은 `applyVerdict`로 만들고 `renderLedger`로 댓글 본문을 만들어 `commentAs`로 단다. 판정의 head는 16진수 40자로 준다: 원장 파서가 그렇지 않은 head를 깨진 원장으로 본다).

- 원장 댓글(작성자가 `ci.recorderBot`)에 codex의 열린 P1이 있고 codex의 판정이 4번이면 출력에 `- 오래 열린 지적: F1 [P1, codex] 재판정 3회 뒤에도 열려 있다`로 시작하는 줄이 있고, 그 줄이 `분류:` 줄보다 앞이고, 마지막 줄은 `분류:` 줄이다. 출력에 지적의 제목이 없다. 종료 코드 0이고 가짜 GitHub의 상태 파일이 실행 전과 같다.
- 판정이 3번이면 그 줄이 없다.
- 같은 내용의 댓글을 `ci.recorderBot`이 아닌 계정이 달았으면 그 줄이 없다.
- 원장 표식은 있지만 본문이 깨진 댓글(작성자가 `ci.recorderBot`)이면 `- 오래 열린 지적 확인: 원장을 읽지 못했다`로 시작하는 줄이 있고 종료 코드 0, `분류:` 줄은 그대로 나온다.
- `ci.recorderBot`이 빈 설정이면(원장 댓글이 있어도) 두 줄 모두 없다.
- `ci.requiredChecks`가 비고 `ci.recorderBot`은 있는 설정에서 판정 4번의 원장 댓글이 있으면: 출력에 `ci.requiredChecks가 비어`가 든 줄과 그 뒤의 `- 오래 열린 지적: F1 [P1, codex] 재판정 3회 뒤에도 열려 있다` 줄이 있고 `분류:` 줄은 없다. 종료 코드 0이다. 원장 댓글이 없으면 지금과 같은 출력이다(기존 테스트).

## Acceptance Criteria

```bash
node --test scripts/test/runner-review.test.ts scripts/test/pr-state.test.ts
awk '/^- \*\*오래 열린 지적\(대화 세션\)\*\*/ && /재판정/ && /pr-state/ && /대응하기 전에/ && /제작자에게 묻는다/ {f=1} END {exit !f}' docs/harness/workflow.md
awk '/^- \*\*오래 열린 지적\(대화 세션\)\*\*/ && /A 방향을 정해 한 번 더 고친다/ && /B 범위를 줄인다/ && /C 포기/ && /P0에만/ {f=1} END {exit !f}' docs/harness/workflow.md
awk '/^- \*\*오래 열린 지적\(대화 세션\)\*\*/ && /runner/ && /3회 방법 전환/ && /5회 중단/ {f=1} END {exit !f}' docs/harness/workflow.md
awk '/^3\. 필요한 검증자가 승인하면/ && /pr-state/ && /오래 열린 지적/ {f=1} END {exit !f}' docs/harness/workflow.md
awk '/^### 9\.1 /{on=1} /^### 9\.2 /{on=0} on && /오래 열린 지적/ && /pr-state/ && /제작자에게 묻는다/ && /runner/ {f=1} END {exit !f}' docs/harness/design.md
awk '/^### 10\.3 /{on=1} /^### 10\.4 /{on=0} on && /pr-state/ && /오래 열린 지적/ {f=1} END {exit !f}' docs/harness/design.md
grep -q "^| TD-54 .*| 해결(" docs/exec-plans/tech-debt-tracker.md
```

- `awk` 명령들은 문서의 그 자리(절차서 8절의 그 항목 한 줄, 2절 "계획 검증"의 3번, 설계서 9.1절·10.3절 안의 한 줄)에 낱말들이 함께 있는지를 본다. 항목과 문장은 한 줄로 쓴다(이 리포의 문서는 문단을 줄바꿈하지 않는다).

## 금지사항

- `scripts/runner/run.ts`와 `scripts/runner/prompt.ts`를 고치지 마라. 이유: runner의 동작은 비범위다(수용 기준 4).
- 기존 테스트를 고치지 마라. 이유: runner의 동작이 그대로임을 기존 테스트가 보인다.
- 원장의 형식과 기록 job(`scripts/ci/`)을 바꾸지 마라. 이유: 원장은 병합 판정의 자료다. 이 step은 읽기만 한다.
- 교착(`deadlocked`)의 조건과 문서의 교착 정의를 바꾸지 마라. 이유: 비범위다.
- 검증자 프롬프트와 등급 기준(`scripts/cross-review/`)을 바꾸지 마라. 이유: TD-54의 ①은 하지 않기로 했다.
- `pr-state`가 무엇이든 쓰게 하지 마라. 이유: 읽기 전용 명령이다.
- `pr-state`의 출력에 지적의 제목·근거(검증자 출력)를 넣지 마라. 이유: 검증자 출력은 데이터다(신뢰 경계).
- `scripts/metrics/`, `scripts/hooks/`, `.github/`를 고치지 마라. 이유: 범위 밖이다.
- 설계서 11.1절과 절차서 4절을 고치지 마라. 이유: 다른 작업이 맡은 절이다.
