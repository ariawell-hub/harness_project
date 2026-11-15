# Step 5: divergence

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 7, 의사결정 로그의 되돌리기 결정)
- `docs/harness/design.md` 10.2절 (7) 발산 감지와 대응, 9.2절(`review-round` 키), 14.4절(R14)
- 앞 step에서 만든·바꾼 파일: `scripts/runner/review.ts`(`doReview`, `ReviewState.round`, `openBlocking`), `scripts/runner/pr-state.ts`, `scripts/runner/ledger-read.ts`, `scripts/runner/prompt.ts`(`reviewPrompt`), `scripts/test/fake-agent.ts`
- `scripts/ci/ledger.ts`(`Entry`, `CiFailure`), `scripts/lib/attempts.ts`, `scripts/commands/task.ts`(`appendProgress`, `completeStep`, `reopenStep`)

## 작업

1. `scripts/runner/divergence.ts`(순수 함수)
   ```ts
   export interface RoundBefore {
     /** 대응 전 열린 차단 지적(ID, 파일, 줄) */
     open: { id: string; file: string; line: number }[];
     /** 대응 전 원장의 가장 큰 지적 번호 */
     maxId: number;
     /** 대응을 push한 head */
     head: string;
   }
   export function divergence(
     before: RoundBefore,
     after: Ledger,
   ): { diverged: boolean; signals: string[] };
   ```
   신호(하나라도 있으면 `diverged`. `signals`에는 사람이 읽을 한 줄씩):
   - 새 차단 지적 > 해소: "새 차단 지적"은 지금 `open`인 P0·P1 중 번호가 `maxId`보다 큰 것과, 대응 전에는 열려 있지 않았는데 지금 열린 것(다시 열림)이다. "해소"는 `before.open` 중 지금 `fixed`·`rejected`인 것이다.
   - 회귀: 원장의 `ciFailures`에 `head`가 `before.head`인 기록이 있다.
   - 같은 위치: 새 차단 지적 중 파일과 줄이 `before.open`의 어느 지적과 같은 것이 있다.
   - `ReviewState.round`가 이 판정에 필요한 값(대응 전 열린 지적의 파일·줄)을 담도록 step3의 형식을 넓힌다. 옛 형식의 파일은 `round`가 없는 것으로 읽는다.
2. `scripts/runner/review.ts`·`run.ts`
   - 원격 발산: `doReview`를 시작할 때, 마지막 대응 라운드(`round`)가 있고 지금 PR head가 그 `head`이며 아직 평가하지 않았으면 `divergence`를 본다. 평가는 그 head의 `review/*`·`review-ledger`가 모두 끝난 뒤(`prState`가 `review`로 온 시점)에 한 번만 한다. 발산이면:
     1. `round.base..round.head`의 커밋 중 계획 폴더 밖 파일을 바꾼 커밋을 최신순으로 `git revert --no-edit`한다. 계획 전용 커밋은 건너뛴다. 되돌리기가 충돌하면 `git revert --abort`하고 계획을 멈춰 보고한다.
     2. 계획의 진행 로그에 한 줄(발산 신호, 되돌린 커밋)을 더하고 `review-round` 키로 실패 1회를 기록한다(`kind: 'review'`).
     3. step을 다시 완료 처리(`completeStep`)하고 `planGate`를 통과하면 일반 push한다. 이 바퀴에서는 새 대응 세션을 띄우지 않는다.
     4. 되돌린 head를 `review.json`에 적는다. 되돌린 head에 대한 다음 라운드는 발산을 평가하지 않는다(되돌려서 다시 열린 지적을 "같은 위치"로 세지 않기 위해서다).
   - `review-round` 실패가 `failure.switchAt`(3회) 이상이면 `reviewPrompt`에 방법 전환 지시를 넣는다: 지금까지의 수정 방식을 버리고, 계획을 고쳐야 하거나 PR을 나눠야 한다고 판단하면 계획의 "열린 질문"에 `### 질문:`으로 남긴다. `failure.stopAt`(5회)이면 계획을 멈추고 중단 보고를 올린다(기존 `judge`·`blockPlan`).
   - 로컬 회귀(step3의 "판정이 실패하면 이번 라운드를 push 없이 끝낸다"를 바꾼다): 수정 세션 뒤 AC나 `check`가 실패하면 작업 트리에 남은 변경을 `fix(F<번호>): 판정 실패(되돌림)` 메시지로 커밋한 뒤, 세션 시작 전 HEAD 이후의 커밋을 `git revert --no-edit`로 되돌린다. `F<번호>` 실패로 기록하고 이번 라운드를 push 없이 끝낸다. `plan` 단계에는 적용하지 않는다(계획 파일은 다음 세션이 고쳐 쓴다).
3. 테스트(새 파일 `scripts/test/divergence.test.ts`, `scripts/test/runner-review.test.ts`에 더한다)
   - `divergence`: 신호 세 가지 각각, 새 지적 수와 해소 수가 같으면 발산이 아님, 동결돼 `deferred`로 등록된 새 P1은 세지 않음, 다시 열린 지적을 새 지적으로 셈.
   - runner: 대응 push 뒤 원장에 새 P1 두 건이 열리고 해소가 한 건이면 되돌림 커밋이 push되고, 원격 브랜치의 옛 head가 새 head의 조상이며(force push 없음), `review-round` 실패가 1회 기록되고, 진행 로그에 줄이 생긴다. 같은 head를 두 번 평가하지 않는다. 되돌린 head의 라운드는 평가하지 않는다.
   - `review-round` 3회면 프롬프트에 방법 전환 지시, 5회면 `blocked`와 중단 보고.
   - 수정 세션 뒤 AC가 실패하면 작업 트리가 세션 전과 같은 내용으로 돌아가고(`git diff <세션 전 HEAD> HEAD`가 비어 있다) push하지 않는다.
4. 문서: 설계서 10.2절 (7)에 구현 문단(신호 판정 기준, 되돌리기 방식, 평가 시점), 9.2절의 `review-round` 설명, 4.5절 "실패와 대기", `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/divergence.test.ts scripts/test/runner-review.test.ts scripts/test/runner.test.ts
grep -q "export function divergence" scripts/runner/divergence.ts
grep -q "review-round" scripts/runner/review.ts
! grep -nE "'--hard'|'--force'|force-with-lease" scripts/runner/review.ts scripts/runner/divergence.ts
```

## 금지사항

- `git reset --hard`, `git checkout -- <경로>`, `git clean`, force push로 되돌리지 마라. 이유: R14. 되돌리기는 `git revert` 커밋과 일반 push로만 한다.
- 계획 전용 커밋(진행 로그·상태)을 되돌리지 마라. 이유: 기록이 사라지고 step 상태가 어긋나 `plan-gate`가 실패한다.
- 같은 대응 head를 두 번 평가하거나, 판정이 끝나지 않은 head를 평가하지 마라. 이유: 실패 횟수가 부풀거나 한쪽 검증자의 지적만 보고 되돌리게 된다.
- 발산 판정에 `deferred`(동결·P2·P3) 지적을 넣지 마라. 이유: 10.2절 (7)의 신호는 차단 지적 기준이다.
- 발산을 감지한 바퀴에서 바로 새 수정 세션을 띄우지 마라. 이유: "덧대지 말고 멈춘다"(10.2절 (7) 대응 1). 되돌린 head의 판정을 받은 뒤 다시 대응한다.
