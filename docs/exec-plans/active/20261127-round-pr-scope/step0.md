# Step 0: scope

## 읽어야 할 파일

- 계획의 목표와 수용 기준 1~6, 의사결정 로그
- `scripts/ci/review-round.ts`(`writeRoundInput`, `RoundInput`), `scripts/ci/review-input.ts`(merge-base 대비 바뀐 파일)
- `scripts/harness.ts`의 `review-plan`(라운드 입력과 `round_changed` 출력)과 `record-review`(`--round-changed` 읽기)
- `scripts/ci/ledger.ts`(`ApplyOptions`, `applyVerdict`의 동결, `review-ledger` 상태 설명), `scripts/ci/ledger-store.ts`(`recordLedger`)
- `scripts/commands/pr-state.ts`(`logLongOpen`)
- `scripts/test/ledger-store.test.ts`(`writeRoundInput` 테스트, `roundRepo`), `scripts/test/record.test.ts`(`--round-changed`, `review-plan` 출력), `scripts/test/ledger.test.ts`(동결), `scripts/test/pr-state.test.ts`(구현 대기 지적 줄)
- 읽기만: `.github/workflows/judge-claude.yml`(plan job이 `--base "$BASE"`(merge-base)로 `review-plan`을 부르고, 기록 job이 `needs.plan.outputs.round_changed`를 `--round-changed`로 넘긴다)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **라운드 입력**(`writeRoundInput`): 입력에 `base?: string`(merge-base)을 더하고, 반환값에 `outside: string[]`를 더한다. 직전 판정 head 이후 바뀐 파일(지금의 목록)을 구한 뒤, `base`가 있으면 이 PR의 파일로 나눈다. 이 PR의 파일은 `git diff --name-only -z --no-renames <base>...HEAD`와 `<base>...<직전 head>`의 합이다(직전 판정 뒤 되돌린 파일도 이 PR의 파일이다, 계획 검증 F1). 이 PR의 파일이면 `changed`, 아니면 `outside`. `base`가 없거나 두 diff 중 하나라도 읽지 못하면 지금처럼 전부 `changed`이고 `outside`는 빈 목록이다. `round-changed.txt`에는 `changed`만, 새 파일 `round-main.txt`에는 `outside`만 적는다(비어 있으면 만들지 않는다). `round-diff.patch`는 `changed`의 파일로 한정한다(`git --literal-pathspecs diff … <last> HEAD -- <changed>`. `changed`가 비었으면 빈 diff). 원장 파일(`ledger.md`)에 `round-main.txt`가 있으면 그 경로와 뜻(직전 판정 이후 main 병합으로만 바뀐 파일, 이 PR의 변경이 아니다)을 한 줄 적는다. 목록이 `MAX_ROUND_FILES`를 넘거나 직전 head를 못 찾는 경우는 지금과 같다(`changed` null, `outside` 빈 목록). 원장이 없으면 `{ round: 1, promptBase: '', changed: null, outside: [] }`.
2. **plan job 출력**(`review-plan`): `writeRoundInput`에 `base`를 넘긴다. `round_changed`는 `scripts/ci/review-round.ts`의 `encodeRoundChanged(round)`가 만든다: `{ changed, outside }`의 base64 JSON이고, 100,000자를 넘으면 빈 값이다(지금과 같은 상한). `changed`가 null이어도 객체로 낸다. 로그 줄에 범위 밖 파일 수를 더한다.
3. **기록 job 입력**(`record-review`): `--round-changed`를 `scripts/ci/review-round.ts`의 `parseRoundChanged(value)`로 읽는다: (ㄱ) 문자열 배열이면 `changed`는 그 배열이고 `outside`는 빈 목록이다(지금 꼴), (ㄴ) 객체이고 `changed`가 문자열 배열이나 null이고 `outside`가 문자열 배열이면 그 값이다, (ㄷ) 그 밖(빈 값, base64·JSON이 아님, 숫자·문자열 같은 값, 필드가 없거나 형이 다름, 원소에 문자열이 아닌 값)에는 `changed` null, `outside` 빈 목록이다. `recordLedger`에 `outsideSinceLastRound`로 넘기고 `applyVerdict`까지 전한다.
4. **원장 반영**(`applyVerdict`): `ApplyOptions`에 `outsideSinceLastRound?: readonly string[]`. 새 지적(같은 지적의 재등록이 아닌 것)의 등급이 근거 검사 뒤 P1이고 위치가 그 목록에 있으면 재현 결과와 상관없이 `deferred`로 등록하고 처리 칸에 `OUTSIDE_NOTE`(`범위 밖: 직전 판정 이후 main 병합으로만 바뀐 파일의 새 P1이다. 이 PR을 막지 않고 Issue로 넘긴다(10.2절 (5))`)를 적는다. P0과 그 밖의 등록 규칙은 그대로다. `review-ledger`의 상태 설명은 처리 칸이 `OUTSIDE_NOTE`인 `deferred` P1의 수를 `그중 범위 밖 P1 N`으로 적고, `그중 동결 P1`에서는 뺀다(통과·실패 설명 모두).
5. **`pr-state`**: 원장에 처리 칸이 `OUTSIDE_NOTE`인 `deferred` 지적이 있으면 `- 범위 밖 지적: F6, F7 — main 병합으로 들어온 다른 PR의 코드에 대한 P1이라 이 PR을 막지 않는다. Issue로 등록한다(절차서 8절)`를 한 줄 낸다(번호 차례).
6. **테스트**:
   - `ledger-store.test.ts`: 직전 판정 head(PR 커밋) 뒤에 main에 커밋(PR이 바꾸지 않은 `src/main-only.ts`를 바꾼다)을 만들고 PR 브랜치가 그 main을 병합한 뒤 PR이 `src/a.ts`를 한 번 더 바꾼 리포에서, `base`(merge-base)를 주면 `changed`가 `src/a.ts`만, `outside`가 `src/main-only.ts`만이고, `round-changed.txt`·`round-main.txt`가 그 목록이며, `round-diff.patch`에 `src/main-only.ts`가 없고 `src/a.ts`의 PR 변경이 있다. `ledger.md`가 `round-main.txt`를 가리킨다. `base`를 주지 않으면 둘 다 `changed`이고 `outside`는 빈 목록, `round-main.txt`가 없다. PR이 직전 판정 뒤 main 병합만 더했으면(`changed`가 비었다) `round-diff.patch`가 비어 있다. 되돌림(계획 검증 F1): 직전 판정 head에서 PR이 바꾼 `src/a.ts`를 그 뒤 merge-base와 같게 되돌리고 main을 병합한 리포에서 `src/a.ts`가 `changed`에 있고 `outside`에 없으며 `round-diff.patch`에 그 되돌림이 있다. 있던 테스트의 기대값에 `outside: []`를 더한다.
   - `ledger-store.test.ts`(전달 꼴, 계획 검증 F3): `parseRoundChanged`가 배열 꼴, 객체 꼴(`changed` null 포함)을 읽고, 빈 값, base64가 아닌 글, JSON이 아닌 글, 숫자, `outside` 없음, `outside`가 문자열, `outside`에 숫자가 섞임, `changed`가 문자열, `changed`에 숫자가 섞임을 모두 `{ changed: null, outside: [] }`로 본다. `encodeRoundChanged`가 인코딩한 길이가 100,000자이면 그 값을, 100,001자이면 빈 값을 낸다(경로 길이로 맞춘다), 낸 값을 `parseRoundChanged`가 되읽으면 같다.
   - `record.test.ts`: `review-plan`의 `round_changed` 출력이 객체 꼴이다(직전 판정 head가 없는 리포에서 `{ changed: null, outside: [] }`). `record-review`에 객체 꼴 `--round-changed`(`outside`에 `src/b.ts`)를 주면 `src/b.ts`의 새 P1(재현 결과 `reproduced`)이 `deferred`이고 처리 칸이 범위 밖이며 `review-ledger`가 success이고 설명에 `그중 범위 밖 P1 1`이 있다. 지금 꼴(배열)도 그대로 읽는다(있던 테스트).
   - `ledger.test.ts`: `outsideSinceLastRound`에 있는 파일의 새 P1은 1라운드든 2라운드든, 재현됐든 아니든 `deferred`(`OUTSIDE_NOTE`). 같은 파일의 새 P0은 `open`. 목록에 없는 파일의 P1은 지금 규칙(1라운드 `open`, 2라운드부터 바뀐 파일이면 `open`, 바뀌지 않은 파일이면 재현됐을 때만 `open`). 근거 없는 P1은 지금처럼 P2로 내려 `deferred`(처리 칸은 근거 없음). `review-ledger` 설명의 범위 밖·동결 수.
   - `pr-state.test.ts`: 원장에 범위 밖 지적이 있으면 그 줄, 없으면 줄이 없다. 판정 → 원장 → 안내(계획 검증 F2): 프롬프트대로 `round-main.txt`의 파일에 원래 등급(P1)으로 낸 판정을 `applyVerdict`(`outsideSinceLastRound`)로 반영한 원장 댓글에서 그 지적 번호가 그 줄에 나온다.
7. **문서**: `scripts/cross-review/prompt.md`의 "읽을 입력"에 `round-main.txt`(있을 때만: 직전 판정 이후 main 병합으로만 바뀐 파일. 이 PR의 변경이 아니고 `round-diff.patch`에 없다), "라운드 규칙"에 그 파일에서 찾은 결함은 P2로 낮추지 말고 원래 등급으로 적으라는 것(기계가 P1은 범위 밖 미룸으로 등록해 이 PR을 막지 않고 Issue로 넘기고, P0은 막는다. 지적 등급 절의 "바뀌지 않은 기존 코드의 문제는 P2로"의 예외로 적는다). `scripts/cross-review/ledger.md`의 "판정 반영 규칙"에 범위 밖 등록과 상태 설명. 설계서 10.2절 (4)(`deferred`의 뜻, 병합 조건)과 (5)(바뀐 파일의 정의, 범위 밖 규칙, 제작자 결정 2026-11-27, Issue #262). 절차서 8절(`pr-state`의 범위 밖 지적 줄이 보이면 그 지적마다 Issue를 등록한다. 출처에 PR 번호와 지적 ID). 변경 조각 `docs/harness/changes/20261127-round-pr-scope-s0.md`(CHANGELOG 한 줄, 설계서 변경 이력 한 줄).

## Acceptance Criteria

```bash
node --test scripts/test/ledger-store.test.ts scripts/test/record.test.ts scripts/test/ledger.test.ts scripts/test/pr-state.test.ts
grep -q "outside" scripts/ci/review-round.ts
grep -q "round-main.txt" scripts/ci/review-round.ts
grep -q "export const OUTSIDE_NOTE" scripts/ci/ledger.ts
grep -q "export function parseRoundChanged" scripts/ci/review-round.ts
grep -q "export function encodeRoundChanged" scripts/ci/review-round.ts
grep -qF '원래 등급' scripts/cross-review/prompt.md
grep -qF 'round-main.txt' scripts/cross-review/prompt.md
grep -qF '범위 밖' scripts/cross-review/ledger.md
grep -qF 'Issue #262' docs/harness/design.md
grep -qF '범위 밖 지적' docs/harness/workflow.md
grep -qF 'Issue #262' docs/harness/changes/20261127-round-pr-scope-s0.md
BASE="$(git merge-base HEAD origin/main)" && git diff --quiet "$BASE" HEAD -- .github
node scripts/harness.ts check
```

## 금지사항

- 워크플로 파일(`.github/workflows/`)을 고치지 마라. 이유: 봇은 워크플로를 push할 수 없고, 출력 이름을 그대로 두면 고칠 필요가 없다.
- 범위 밖 P0을 미루지 마라. 이유: 제작자 결정.
- `outside`를 모를 때(꼴이 깨짐, 너무 큼) 미루지 마라. 이유: fail-closed. 모르면 지금 규칙(동결)대로다.
- 이미 원장에 있는 지적의 상태를 바꾸지 마라. 이유: 이 규칙은 새로 등록하는 지적의 상태만 정한다.
