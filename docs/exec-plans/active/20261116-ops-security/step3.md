# Step 3: selftest-guard

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 4, 의사결정 로그의 `selftest` job 결정 두 건)
- `docs/harness/design.md` 10.3절(`harness-guard` 행), 10.4절(CI 작업 분리, 재현 job의 조건과 한계, 캐시 규칙, 보호 경로 정책 "구축 단계"), 12.4절
- #57 계획(`20261116-ops-transition`)의 step1·step2(selftest-core, selftest-runner)가 만든 파일(먼저 병합돼 있어야 한다): `scripts/selftest/run.ts`(`runSelfTest`, `SelfTestReport`), `scripts/harness.ts`의 `self-test`
- `.github/workflows/gates.yml`(`evaluate` → `record`), `.github/workflows/judge-claude.yml`의 `repro` job(PR 코드를 실행하는 job의 형식)
- `scripts/ci/gates.ts`, `scripts/ci/results.ts`(`validateResults`, `toStatuses`), `scripts/ci/record.ts`(`recordStatuses`), `scripts/harness.ts`의 `gates`·`record-status`
- `scripts/gates/harness-guard.ts`(`reproJobViolations`, 신호), `scripts/test/harness-guard.test.ts`, `scripts/test/record.test.ts`

## 작업

1. `scripts/ci/gates.ts`·`scripts/harness.ts`의 `gates`: PR이 보호 경로를 바꿨으면(`harness-guard`가 보는 것과 같은 판단) `$GITHUB_OUTPUT`에 `selftest=true`, 아니면 `false`를 쓴다. 판단하지 못하면 `true`다.

2. `scripts/ci/selftest-result.ts`(이름은 재량)

   ```ts
   /** selftest job의 보고서를 검사한다. 형식이 깨졌거나 headSha가 다르면 ok: false */
   export function validateSelfTest(
     raw: unknown,
     o: { headSha: string },
   ): { ok: true; failed: string[]; total: number } | { ok: false; reason: string };

   /** harness-guard 결과에 자체 테스트 결과를 합친다 */
   export function mergeSelfTest(
     guard: GateResult,
     o: { needed: boolean; report: unknown | null; headSha: string },
   ): GateResult;
   ```

   - `needed`가 false면 `guard` 그대로다.
   - `needed`인데 보고서가 없거나 검사에 실패하면 `state: 'error'`("자체 테스트 결과가 없다"), 실패한 시나리오가 있으면 `state: 'failure'`("자체 테스트 실패: <id 목록>"), 시나리오가 0개여도 `error`다.
   - `guard`가 이미 `failure`면 `failure`를 유지하고 설명에 자체 테스트 결과를 덧붙인다. `error`도 유지한다. 통과면 설명 끝에 `· 자체 테스트 통과 <N>`을 붙인다.
   - 보고서의 시나리오 id·detail은 PR 코드가 쓸 수 있는 값이다. 상태 설명에 넣기 전에 형식(`[a-z0-9-]{1,40}`)을 검사하고 그 밖의 글은 넣지 않는다.

3. `scripts/harness.ts`의 `record-status`: `--selftest-needed <true|false>`와 환경 변수 `SELFTEST_B64`(보고서 JSON의 base64)를 받아 `harness-guard` 결과에 `mergeSelfTest`를 적용한 뒤 기록한다.

4. `.github/workflows/gates.yml`
   - `evaluate`의 출력에 `selftest`를 더한다.
   - 새 job `selftest`: `needs: evaluate`, `if: needs.evaluate.outputs.skip == 'false' && needs.evaluate.outputs.selftest == 'true'`. 권한은 `contents: read`뿐이고 environment·비밀·캐시가 없다. `timeout-minutes: 15`.
     - main 정의 체크아웃(`base/`, `persist-credentials: false`), `core.symlinks false`, PR head 체크아웃(`pr/`, `evaluate`가 정한 head SHA, `persist-credentials: false`), `setup-node`(캐시 옵션 없음).
     - `node base/scripts/harness.ts self-test --harness pr --head-sha "$HEAD_SHA" --out "$RUNNER_TEMP/selftest.json"`을 실행하고, 종료 코드와 무관하게 보고서를 base64로 job 출력에 쓴다. 의존성 설치는 하지 않는다. job 환경에 `GH_TOKEN`을 주지 않는다.
   - `record`: `needs: [evaluate, selftest]`. `selftest`가 실패·취소·시간 초과여도 실행된다(`!cancelled()` 조건 유지). `SELFTEST_B64`와 `--selftest-needed`를 넘긴다.
   - 그 밖의 줄(트리거, concurrency, 액션 SHA, 기록 job의 권한)은 바꾸지 않는다.

5. `scripts/gates/harness-guard.ts`
   - PR 코드를 실행하는 job 검사를 넓힌다: 재현 job에 더해, id가 `selftest`이거나 `harness.ts self-test`를 실행하는 job도 environment·비밀·쓰기 권한이 있으면 실패다(`reproJobViolations`를 일반화한다. 기존 export 이름은 유지하거나 테스트와 함께 바꾼다).
   - 신호(위험도 높음): base에 있던 `scripts/selftest/` 아래 파일을 고치거나 지운 PR. 새 파일 추가는 신호가 아니다. 이유 문구에 파일 경로를 넣는다.

6. 테스트
   - `mergeSelfTest`·`validateSelfTest`: 위 갈래 전부, headSha 불일치, 이상한 id.
   - `record-status`(CLI 또는 `recordStatuses` 수준): 보호 경로 PR에서 보고서가 없으면 `harness-guard`가 `error`로 기록된다. 실패한 시나리오가 있으면 `failure`다. 필요 없으면 그대로다.
   - `harness-guard`: `selftest` job에 `environment:`·`secrets.`·`write` 권한이 있으면 실패. 기존 시나리오 파일 수정·삭제는 신호, 새 시나리오 파일 추가는 신호 아님.
   - 이 리포의 `gates.yml`을 읽는 테스트: `selftest` job에 environment·비밀·쓰기 권한·캐시가 없고, `record`만 `recorder` environment를 참조한다.

7. 문서: 설계서 10.3절(`harness-guard` 행: 자체 테스트 연결됨), 10.4절(CI 작업 분리 표에 `selftest` job 행, 보호 경로 정책의 "자체 테스트를 통과해야 한다"를 현재형으로, 한계: PR 코드가 결과를 조작할 수 있어 회귀를 잡는 용도다), 12.4절(실행 시점), 절차서 5절 "보호 경로를 바꾼 PR"(자체 테스트가 요구하는 동작을 바꾸려면 시나리오를 먼저 고친다), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/harness-guard.test.ts scripts/test/record.test.ts scripts/test/gates.test.ts scripts/test/selftest.test.ts
grep -q "export function mergeSelfTest" scripts/ci/selftest-result.ts
grep -q "self-test --harness pr" .github/workflows/gates.yml
test "$(grep -c "environment:" .github/workflows/gates.yml)" = "1"
! grep -nE "actions/cache|^\s*cache:" .github/workflows/gates.yml
```

## 금지사항

- `selftest` job에 environment·비밀·쓰기 권한·`GH_TOKEN`을 주지 마라. 이유: 이 job은 PR 코드를 실행한다(10.4절 재현 job과 같은 조건).
- `selftest` job에서 `pr/`의 실행기(`pr/scripts/selftest/`)를 실행하지 마라. 이유: PR이 자기 시나리오를 약화시켜 통과할 수 있다. 실행기와 시나리오는 `base/`의 것이다.
- 자체 테스트 결과가 없을 때 `harness-guard`를 success로 두지 마라. 이유: fail-closed(10.4절). job이 죽었으면 `error`다.
- 기록 job에서 PR 트리를 체크아웃하거나 보고서의 글을 그대로 상태 설명에 넣지 마라. 이유: 기록 job에는 검증 App 키가 있고, 보고서는 PR 코드가 쓴 값이다.
- 워크플로에 Actions 캐시를 쓰지 마라. 이유: 10.4절 캐시 규칙.
