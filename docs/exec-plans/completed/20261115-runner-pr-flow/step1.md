# Step 1: pick-by-state

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 1·2·3, 의사결정 로그)
- `docs/harness/design.md` 4.5절(우선순위, 실패와 대기, 멈추는 조건), 9.1절(알림 방법), 10.3절(승인 결속 기준, 절차 4)
- 앞 step에서 만든·바꾼 파일: `scripts/runner/pr-state.ts`, `scripts/lib/github.ts`(`commitChecks`, `headSha`, `autoMerge`), `scripts/lib/github-fake.ts`, `scripts/lib/git.ts`(`isBehind`)
- `scripts/runner/next.ts`, `scripts/runner/run.ts`, `scripts/commands/start.ts`, `scripts/lib/approval.ts`, `scripts/lib/config.ts`

## 작업

1. `scripts/runner/next.ts`
   - `LocalPlan`에 `prState?: PrVerdict`를 더한다. `readLocalPlans`가 열린 PR마다 채운다: `cfg.ci.requiredChecks`가 비어 있지 않을 때만 `commitChecks(pr.headSha)` → `requiredStates` → `classifyPr`(`behind`는 `isBehind`, `stepCompleted`는 그 step의 상태가 `completed`인가). `pr.headSha`가 worktree의 `HEAD`와 다르거나(GitHub 반영 지연) 조회가 실패하면 `{ kind: 'wait-ci', waiting: [...] }`로 둔다. `requiredChecks`가 빈 리포는 `prState`가 없고 지금 판단(체크 요약)을 그대로 쓴다.
   - `Task`에 더한다: `{ kind: 'request-approval'; local; pr }`, `{ kind: 'report-stall'; local; pr; waiting: string[] }`, `{ kind: 'arm-merge'; local; pr }`. `fix-pr`에는 `failing: { context: string; description: string }[]`을 더한다.
   - `pickNext` 2번(내 PR 중 조치가 필요한 것)은 `prState`가 있으면 그것으로 고른다.
     - `conflict`, `behind` → `update`
     - `fix` → `fix-pr`
     - `approval` → 승인 요청 표시(`lib/approval.ts`)가 지금 head와 다르면 `request-approval`, 같으면 사람 대기로 센다
     - `review` → 이 step에서는 사람 대기로 세고 이유에 "열린 차단 지적"을 적는다(대응은 step3)
     - `wait-ci`, `infra-error` → 같은 head에서 기다린 시간이 `limits.ciStallHours`를 넘고 아직 알리지 않았으면 `report-stall`, 아니면 CI 대기로 센다
     - `ready` → `pr.autoMerge`가 false이고 초안이 아니면 `arm-merge`, 아니면 CI 대기로 센다
   - 기다린 시간은 worktree 하네스 상태 폴더의 `pr-wait.json`(`{ head, since, reported }`)에 둔다. head가 바뀌면 새로 센다. 읽고 쓰는 함수는 `next.ts`에 두고 쓰기는 runner만 한다(`start`·`next` 명령은 읽기만).
2. `scripts/runner/run.ts`
   - `request-approval`: Issue에 `needs-human` 라벨과 제작자 멘션 댓글(PR 번호, head SHA 12자, `risk-gate` 설명, "승인 뒤 새 커밋이 올라가면 다시 승인해야 한다")을 달고 승인 요청 표시를 지금 head로 쓴다.
   - `report-stall`: Issue에 `needs-human` 라벨과 멘션 댓글(PR 번호, 기다리는 context와 상태, 실행 링크, 기다린 시간)을 달고 `pr-wait.json`에 알렸음을 적는다.
   - `arm-merge`: `enableAutoMerge`.
   - `doFixPR`: 실패 키를 `pr:<context>`로 context마다 기록하고, 프롬프트에 context와 상태 설명을 넣는다.
   - CI 대기일 때 `pr-wait.json`을 갱신한다.
3. `scripts/lib/config.ts`: `limits.ciStallHours`(없으면 24). `harness.config.json`에 `"ciStallHours": 24`를 적는다.
4. `scripts/commands/start.ts`의 `describeTask`에 새 작업 종류의 문구를 더한다.
5. `scripts/lib/github-fake.ts`: 상태 파일에 필수 체크 목록(context와 출처)이 있으면 `tryMerge`가 `ciCommand` 대신 "PR head에 출처가 맞는 success가 모두 있는가"로 병합을 정한다. 테스트가 `setCheck`로 CI를 흉내 낸다.
6. 테스트(`scripts/test/next.test.ts`, 새 파일 `scripts/test/runner-pr.test.ts`)
   - 봇 계정이 쓴 `review/claude` success만 있는 PR은 CI 대기이고 병합되지 않는다.
   - `check`(Actions) 실패 → `fix-pr`. `risk-gate`만 실패 → 수정 세션을 띄우지 않고 승인 요청을 head마다 한 번만 올린다. head가 바뀌면 다시 올린다.
   - `review/*` 실패 → 세션 없이 사람 대기.
   - 뒤처진 PR: 필수 체크가 모두 success면 `update`, 수정 요청 상태나 진행 중이면 갱신하지 않는다. `DIRTY`는 바로 `update`.
   - 같은 head에서 `ciStallHours`를 넘긴 대기는 한 번만 알린다.
   - 자동 병합이 꺼진 `ready` PR은 다시 켠다.
   - `requiredChecks`가 빈 설정에서는 기존 테스트가 그대로 통과한다.
7. 문서: 설계서 4.5절(우선순위 2번, "실패와 대기", "runner가 멈추는 조건"), 10.3절 "체크 요약 API" 문단과 절차 4, 절차서 5절(갱신 조건), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/next.test.ts scripts/test/runner-pr.test.ts scripts/test/runner.test.ts scripts/test/start.test.ts scripts/test/pr-state.test.ts
grep -q "request-approval" scripts/runner/next.ts
grep -q "ciStallHours" scripts/lib/config.ts
grep -q "ciStallHours" harness.config.json
```

## 금지사항

- `risk-gate`·`review/*`·`review-ledger` 실패에 `check` 실패용 수정 세션(`doFixPR`)을 띄우지 마라. 이유: 세션이 고칠 수 없는 대기이거나(제작자 승인) 지적 대응(step3)의 일이다. 지금 runner의 오동작이 이것이다.
- 수정 요청 상태이거나 판정이 진행 중인 PR을 뒤처졌다는 이유로 갱신하지 마라. 이유: 승인을 이어받지 못해 검증자 판정이 한 번 더 돈다(10.3절).
- runner가 PR을 승인하거나 `risk-gate` 상태를 직접 쓰지 마라. 이유: R20. 승인은 제작자만 한다.
- `start`·`next` 명령에서 `pr-wait.json`이나 승인 요청 표시를 쓰지 마라. 이유: 대화 세션의 조회가 runner의 대기 시간 계산을 바꾸면 안 된다.
- `ci.requiredChecks`가 빈 리포의 동작을 바꾸지 마라. 이유: 2단계 CI를 붙이지 않은 프로파일은 체크 요약 판단을 그대로 써야 한다.
