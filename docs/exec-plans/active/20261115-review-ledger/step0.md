# Step 0: ledger-core

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 1~4, 의사결정 로그)
- `docs/harness/design.md` 10.2절 (3)~(5)
- `scripts/ci/verdict.ts`, `scripts/ci/record.ts`, `scripts/cross-review/verdict.schema.json`, `scripts/test/verdict.test.ts`

## 작업

1. 판정 스키마에 `resolutions`(선택, 최대 60개)를 더한다: `{ id: "F<번호>", status: "fixed" | "rejected" | "open", note: string(300자 이내) }`. `scripts/cross-review/verdict.schema.json`과 `validateVerdict`(`scripts/ci/verdict.ts`)를 함께 고치고, 없으면 빈 배열로 읽는다. Codex용 스키마 변환(`codexOutputSchema`)이 새 필드에서도 통하는지 테스트한다.
2. `scripts/ci/ledger.ts`(새 파일, 순수 함수. 네트워크·git 호출 없음):
   - `interface Ledger { version: 1; promptBase: string; rounds: Round[]; findings: Entry[]; ciFailures: CiFailure[] }`. `Entry`는 id, severity, reviewer(`claude` | `codex`), file, line, title, repro(`'' | 'reproduced' | 'not-reproduced' | 'error'`), status(`open` | `fixed` | `rejected` | `deferred`), note, round, rejectedBy(검증자 목록)를 담는다.
   - `emptyLedger(promptBase)`, `parseLedger(body): Ledger | null`(숨은 JSON만 읽고, 형식이 다르면 null), `renderLedger(l): string`(표 + 숨은 JSON. 표 셀의 `|`·줄바꿈·`<`·`@`를 무해하게 바꾸고, JSON 안의 `-->`를 막는다).
   - `applyVerdict(l, { reviewer, verdict, headSha, changedSinceLastRound }): Ledger`: 그 검증자의 새 라운드를 기록한다. 새 지적은 P0·P1이면 `open`, P2·P3이면 `deferred`. 그 검증자의 2라운드부터는 `changedSinceLastRound`에 없는 파일의 P1을 `deferred`로 등록한다(P0은 `open`). `resolutions`는 자기 지적의 `fixed`·`rejected`·`open`만 반영하고, 남의 P0에 대한 `rejected`는 동의로 기록한다. P0은 두 검증자가 모두 `rejected`여야 `rejected`다. 모르는 ID와 이미 `deferred`인 지적의 판정은 무시한다.
   - `ledgerStatus(l): { state: 'success' | 'failure'; description }`: P0·P1이 모두 `fixed`·`rejected`면 success. description에 열린 지적 수와 ID를 적는다(140자 이내).
3. 테스트 `scripts/test/ledger.test.ts`: 직렬화 왕복(표 깨는 문자, `-->` 포함), 깨진 댓글은 null, 1라운드 등록과 ID 부여, 2라운드 동결(P0·P1·바뀐 파일), 자기 지적만 `fixed`, P1 `rejected`, P0은 한 명 동의로는 `open`·두 명이면 `rejected`, `ledgerStatus`. `verdict.test.ts`에 `resolutions` 사례.
4. #54에서 넘어온 지적: `planCarry`의 patch-id 측정 실패 경로 테스트(`scripts/test/binding.test.ts`), `CHANGELOG`의 v0.7.28 항목 위치.
5. 문서: `scripts/cross-review/ledger.md`(원장 형식, 13.3절), `docs/harness/architecture.md`, `CHANGELOG`, 진행 로그. 설계서는 step1에서 동작이 연결될 때 고친다.

## Acceptance Criteria

```bash
node --test scripts/test/ledger.test.ts scripts/test/verdict.test.ts scripts/test/binding.test.ts scripts/test/codex-scan.test.ts
grep -q "export function applyVerdict" scripts/ci/ledger.ts
grep -q "export function ledgerStatus" scripts/ci/ledger.ts
grep -q '"resolutions"' scripts/cross-review/verdict.schema.json
```

## 금지사항

- 워크플로(`.github/workflows/`)와 기록 job의 동작을 바꾸지 마라. 이유: 이 step은 순수 로직만 만든다. 연결은 step1이다.
- 원장의 표를 해석해 상태를 읽지 마라. 이유: 셀 내용으로 깨지고, 숨은 JSON이 단일 원본이다.
- 지적 본문(`evidence`, `suggestion`)을 원장 JSON에 넣지 마라. 이유: 댓글 크기 상한(65536자)과 주입 문장 노출을 줄인다. 본문은 기록 job 로그에 남는다.
