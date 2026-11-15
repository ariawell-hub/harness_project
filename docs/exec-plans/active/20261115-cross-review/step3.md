# Step 3: approval-binding

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-cross-review/plan.md` (수용 기준 6·7·8, 진행 로그의 실제 PR 기록)
- `docs/harness/design.md` 10.3절 승인 결속 기준과 그 아래 설명(이벤트 head SHA로 측정, patch-id의 한계), 0.2절
- step0~2가 만든 파일: `scripts/ci/{verdict,review-plan,review-input,record}.ts`, `.github/workflows/judge-{claude,codex}.yml`
- `scripts/ci/protection.ts`, `harness.config.json`의 `ci`
- Q20: `git show 7b837e7:lab/q20/patch-id.ts`, `lab/q20/results/patch-id.json`

## 작업

1. `scripts/ci/binding.ts`
   - `export function patchId(root: string, base: string): string`: `git diff <base>...HEAD | git patch-id --stable`의 id. 변경이 없으면 `''`.
   - 승인 상태 description 끝에 `patch:<id 앞 16자>`를 붙이고(`verdictStatus` 결과에 더한다), `export function patchOf(description: string): string | null`로 읽는다.
   - `export function carryOver(o: { patch: string; risk: Risk; prFiles: string[]; candidates: { sha: string; statuses: { context; state; description; creator }[] }[]; changedOnMainSince: (oldHead: string) => string[] | null; recorderBot: string; context: string }): { from: string } | { no: string }`: 후보(이 PR의 앞선 head들) 중 검증 App 봇이 쓴 해당 context의 **마지막** 상태가 success이고 patch가 같은 것. 위험도 높음, patch 없음, main에서 바뀐 파일과 PR 파일의 겹침, 조회 실패(`null`)는 이어받지 않는다.
2. 설정 `ci.recorderBot`(예: `harness-recorder[bot]`)과 `ci.requiredChecks`에 `review/claude`·`review/codex`(source `recorder`).
3. `review-plan`이 이어받기를 판정해 `$GITHUB_OUTPUT`에 `carry_claude`·`carry_codex`(이어받을 원래 SHA)를 낸다. 후보와 상태는 `GITHUB_TOKEN`(읽기)으로 PR 커밋 목록과 커밋 상태를 조회한다(주입 가능한 함수). 이어받으면 판정 job은 돌지 않고, 기록 job이 `record-review --carried-from <sha>`로 success("이어받음 <sha 앞 12자> patch:<id>")를 쓴다. `check`는 새 head에서 이미 통과했다(트리거 조건).
4. 테스트 `scripts/test/binding.test.ts`(먼저 실패 확인): main 병합 갱신 뒤 patch-id 같음(임시 리포에서 실제 병합), 충돌 해결로 PR 변경이 바뀌면 다름, 이어받기 성립, 위험도 높음·겹침·다른 작성자(봇 PAT 흉내)·마지막 상태가 failure·patch 다름·조회 실패는 불성립.
5. 제작자에게 요청(진행 로그에 기록): `review/claude`·`review/codex`를 검증 App 출처의 필수 체크로 등록. 등록 뒤 `required-checks` 통과를 확인한다. 이 PR은 등록 전에 병합돼도 막히는 것이 없지만(추가만 한다), `required-checks`가 실패로 남으므로 등록 확인 뒤 완료 처리한다.
6. 문서: 설계서 10.3절 결속 구현 위치와 description 형식, 0.2절 필수 체크 목록, 절차서 5절(검증자 판정·이어받기), `architecture.md`, `CHANGELOG`, TD-1 비고(② 완료, Codex 갱신 관찰 여부).

## Acceptance Criteria

```bash
node --test scripts/test/binding.test.ts scripts/test/verdict.test.ts scripts/test/protection.test.ts
grep -q "export function carryOver" scripts/ci/binding.ts
grep -q '"review/codex"' harness.config.json
grep -q "recorderBot" harness.config.json
```

## 금지사항

- PR ref(`refs/pull/<n>/head`)로 patch-id를 재지 마라. 이유: push 직후 옛 head를 가리킬 수 있다(Q20). 체크아웃한 이벤트 head에서 잰다.
- 위험도 높음 PR의 승인을 이어받지 마라. 이유: 10.3절.
- 작성자를 확인하지 않은 상태를 승인 근거로 쓰지 마라. 이유: 봇 PAT도 같은 이름의 상태를 쓸 수 있다(ADR-0003).
- 필수 체크를 봇으로 등록하려 하지 마라. 이유: R20.
