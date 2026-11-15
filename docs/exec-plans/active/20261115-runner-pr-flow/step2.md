# Step 2: plan-review

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 4, 의사결정 로그)
- `docs/harness/design.md` 4.1절(G1 확인 내용), 10.3절 "계획 검증(G1) 구현", `docs/harness/workflow.md` 2절 "계획 검증"
- 앞 step에서 만든·바꾼 파일: `scripts/runner/pr-state.ts`, `scripts/runner/next.ts`(`prState`, 새 작업 종류), `scripts/runner/run.ts`, `scripts/lib/github.ts`, `scripts/lib/github-fake.ts`
- `scripts/ci/plan-hash.ts`(`planHashes`, `planMode`), `scripts/ci/ledger.ts`(`Ledger`, `REVIEWERS`, `renderLedger`), `scripts/ci/ledger-store.ts`(`ledgerFromComments`)

## 작업

1. `scripts/lib/github.ts`: `GitHubPort.prComments(n): { id: number; author: string; body: string }[]`. PR의 댓글을 시간순으로 끝까지 읽는다. 끝을 확인하지 못하면 예외다(일부만 읽고 원장이 없다고 판단하지 않는다). `GhCli`와 `FakeGitHub` 모두 구현한다. 가짜에는 임의 계정으로 댓글을 다는 기존 도우미(`commentAs`)를 쓴다.
2. `scripts/runner/ledger-read.ts`
   ```ts
   /** PR의 지적 원장. 원장 댓글이 없으면 null. 읽지 못하거나 깨졌으면 예외 */
   export function readPrLedger(gh: GitHubPort, cfg: HarnessConfig, pr: number): Ledger | null;
   /** 원장의 계획 승인이 이 해시의 것이고 두 검증자가 모두 있는가 */
   export function planApproved(ledger: Ledger | null, hash: string): boolean;
   ```
   - 원장으로 인정하는 댓글은 작성자가 `cfg.ci.recorderBot`인 것뿐이다(`ledgerFromComments`). `recorderBot`이 없으면 예외다.
3. `scripts/runner/next.ts`
   - `LocalPlan`에 `planReview?: { hash: string; approved: boolean | null }`를 더한다. 조건: `cfg.planReview.required`가 true이고, step 폴더 형식 계획이고, `planHashes`의 `hash`가 `baseHash`와 다르다. 그 PR이 열려 있고 step이 `completed`가 아니고 `prState`가 `ready`일 때만 원장을 읽어 `approved`를 채운다(읽지 못하면 null).
   - `pickNext` 3번(진행 중인 step)의 "PR이 열려 있으면 건너뛴다"를 고친다. 계획 검증 대상이고 PR이 열려 있고 step이 `completed`가 아니면:
     - `prState`가 `fix`(계획만 담은 커밋의 `check` 실패) → `plan` 작업(계획 작성 세션을 실패 내용과 함께 다시 띄운다)
     - `wait-ci`, `infra-error` → step1의 대기 규칙 그대로
     - `review` → 이 step에서는 사람 대기(대응은 step3)
     - `ready`이고 `approved`가 true → `step` 작업
     - `ready`인데 승인이 없거나 읽지 못함 → CI 대기로 세고 step1의 오래된 대기 알림 규칙을 따른다
   - 계획 검증 대상인데 PR이 아직 없고 계획 작성이 끝났으면(`needsPlanning`이 false) `{ kind: 'plan-push'; local }` 작업을 낸다. `scripts/commands/start.ts`의 `describeTask`에 문구를 더한다(대화 세션에는 "계획만 담은 커밋을 push하고 초안 PR을 연다"로 보인다).
4. `scripts/runner/run.ts`
   - `plan-push`(계획 작성 세션이 성공한 바퀴에서도 바로 이어서 한다): `planMode`로 PR 전체 변경이 계획 폴더 안뿐인지 확인한다. 아니면 push하지 않고 `plan:scope` 실패로 기록한다(다음 계획 작성 세션의 직전 실패에 들어간다). 맞으면 브랜치를 일반 push하고 초안 PR을 만든다(`draft: true`). 제목은 그 step의 PR 제목 형식이고 본문 첫 줄은 step이 하나뿐이면 `Closes #N`, 아니면 `Refs #N`이다. 자동 병합은 켜지 않는다.
   - `doStep`이 통과한 뒤: PR이 이미 있으면 새로 만들지 않고, 초안이면 해제(`setDraft(n, false)`)한 다음 자동 병합을 켠다.
   - 계획 검증 대상이 아닌 계획(소규모, `planReview.required: false`, 해시가 base와 같은 둘째 step부터)은 지금 흐름 그대로다.
5. WIP: 계획 검증 중인 초안 PR도 `limits.wipPerWorker`에 센다(지금 계산이 열린 PR을 모두 세는지 테스트로 고정한다).
6. 테스트(새 파일 `scripts/test/runner-plan-review.test.ts`, 가짜 GitHub과 가짜 에이전트)
   - 계획 작성 뒤 초안 PR이 계획 폴더 파일만으로 열리고, 승인 전에는 step 세션이 뜨지 않는다.
   - 검증 App 봇 계정의 원장 댓글에 지금 해시와 두 검증자의 승인이 있으면 step 세션이 뜨고, 끝나면 초안이 해제되고 병합된다.
   - 승인 해시가 다르거나, 검증자가 하나뿐이거나, 원장 댓글 작성자가 봇 계정(PR 작성자)이면 승인으로 보지 않는다.
   - 계획 작성 세션이 계획 폴더 밖 파일을 커밋하면 push하지 않고 `plan:scope` 실패가 남는다.
   - 둘째 step(계획이 main과 같은 해시)과 `planReview.required: false`에서는 초안 PR·승인 대기 없이 기존대로 진행한다.
7. 문서: 설계서 4.1절·4.5절(한 바퀴, 계획 검증 대기), 10.3절 G1 구현 문단의 "로컬(…runner)은 원장을 보지 않고" 문장, 절차서 2절(runner의 계획 검증), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/runner-plan-review.test.ts scripts/test/runner-pr.test.ts scripts/test/runner.test.ts scripts/test/next.test.ts
grep -q "export function readPrLedger" scripts/runner/ledger-read.ts
grep -q "export function planApproved" scripts/runner/ledger-read.ts
grep -q "prComments" scripts/lib/github.ts
```

## 금지사항

- 원장을 작성자 확인 없이 읽지 마라. 이유: 봇 PAT과 PR 작성자도 같은 표식의 댓글을 쓸 수 있다(ADR-0003, 10.2절 (4)). runner가 만든 PR의 작성자는 runner 자신이다.
- 계획 승인을 runner가 스스로 판정하거나 원장 댓글을 쓰지 마라. 이유: 승인은 CI 검증자와 기록 job만 만든다(R12). runner는 읽기만 한다.
- 계획 승인 전에 step 세션을 띄우거나 코드를 push하지 마라. 이유: 코드가 섞인 head의 판정은 계획 승인으로 기록되지 않아(4.1절) 계획 검증을 받을 수 없게 된다.
- 계획 폴더 밖 변경을 runner가 `reset`·`checkout`으로 지우지 마라. 이유: R14. 실패로 기록해 다음 세션이 내용을 되돌리게 한다.
- `scripts/ci/`의 원장·해시 함수를 복사하지 마라. 이유: 판정 워크플로와 runner가 같은 정의를 써야 한다. import해서 쓴다.
