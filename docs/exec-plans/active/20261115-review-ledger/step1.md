# Step 1: ledger-record

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 1·3·4·6, 의사결정 로그, 진행 로그)
- `docs/harness/design.md` 10.1절 실행 방식, 10.2절 (2)·(4)·(5), 10.4절 job 표와 캐시 규칙, 0.2절 검증 App 권한
- `scripts/ci/{ledger,record,review-input,review-plan,binding}.ts`, `scripts/harness.ts`의 `review-plan`·`record-review`
- `.github/workflows/judge-claude.yml`, `judge-codex.yml`, `scripts/test/ci.test.ts`

## 작업

1. 제작자 작업을 한 번에 요청한다(진행 로그에 기록): 검증 App 권한을 Pull requests 읽기·쓰기로 올리고 설치에서 수락. 확인 방법과 절차를 `docs/SECURITY.md`에 적는다. 수락 전에 이 step을 병합해도 기록 job이 실패하지 않게, 댓글 쓰기 실패는 `review-ledger = error`로만 남기고 `review/*` 기록은 그대로 한다.
2. `scripts/ci/ledger-store.ts`: 원장 댓글 조회(작성자가 `ci.recorderBot`이고 숨은 표식이 있는 댓글 중 가장 오래된 것), 생성·수정(API를 주입받는다). 가짜 API로 테스트한다.
3. `record-review`: 판정 검사를 통과하면 원장을 읽어 `applyVerdict`로 반영하고 댓글을 쓴 뒤 `review-ledger` 상태를 head에 기록한다. 판정이 없는 경우(해당 없음, 이어받음, error)에도 지금 원장으로 `review-ledger`를 기록한다. 원장이 없고 지적도 없으면 댓글을 만들지 않고 success다.
4. `review-plan`: 원장 댓글을 읽어(읽기 권한 토큰) `.harness-review/ledger.md`에 표와 지적 ID를 쓰고, 직전 라운드 head 이후 바뀐 파일 목록(`round-changed.txt`)과 그 diff(`round-diff.patch`)를 쓴다. 출력에 `round`, `prompt_base`를 더한다.
5. 프롬프트: `scripts/cross-review/prompt.md`에 라운드 규칙(원장 지적마다 `resolutions`를 내라, 2라운드부터는 원장 해소 여부와 직전 라운드 이후 diff만 봐라)을 더한다. 판정 job은 `prompt_base`가 있으면 그 SHA의 프롬프트를 쓴다(`git -C base show <sha>:scripts/cross-review/prompt.md`, 실패하면 판정 없이 실패).
6. 워크플로: 두 `record` job에 job 단위 concurrency(`ledger-<PR 번호>`, 취소 없음, `queue: max`), App 토큰에 `permission-pull-requests: write`. `check`가 실패로 끝났을 때 원장에 CI 실패를 남기는 job을 `judge-claude`에 둔다(판정 없음, `recorder`). `ci.requiredChecks`에는 아직 넣지 않는다(step5).
7. 테스트: `ledger-store`, `record-review`의 원장 경로, 워크플로 불변식(권한, concurrency, `recorder`는 기록 job에만). 문서: 설계서 10.1·10.2·10.3절, `architecture.md`, `CHANGELOG`.

## Acceptance Criteria

```bash
node --test scripts/test/ledger.test.ts scripts/test/ledger-store.test.ts scripts/test/record.test.ts scripts/test/ci.test.ts
grep -q "permission-pull-requests: write" .github/workflows/judge-claude.yml
grep -q "permission-pull-requests: write" .github/workflows/judge-codex.yml
grep -q "review-ledger" scripts/ci/results.ts
```

## 금지사항

- 판정 job에 PR 댓글 쓰기 권한이나 검증 App 키를 주지 마라. 이유: 10.4절. 원장은 기록 job만 쓴다.
- 검증 App 봇이 쓰지 않은 댓글을 원장으로 읽지 마라. 이유: 봇 PAT과 PR 작성자도 같은 표식의 댓글을 쓸 수 있다(ADR-0003).
- 검증 App 권한을 봇으로 바꾸려 하지 마라. 이유: R20.
