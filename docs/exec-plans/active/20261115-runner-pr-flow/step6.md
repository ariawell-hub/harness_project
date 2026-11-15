# Step 6: workers-notify

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 8~12, 의사결정 로그, 진행 로그 전체, 발견 사항)
- `docs/harness/design.md` 4.5절(실패와 대기의 충돌 문단, 멈추는 조건, 운영), 9.1절, 19절 2단계 행, Q19
- 앞 step에서 만든·바꾼 파일: `scripts/runner/run.ts`, `scripts/runner/next.ts`, `scripts/runner/review.ts`, `scripts/runner/pr-state.ts`
- `scripts/harness.ts`의 `run` 명령, `scripts/lib/exec.ts`, `docs/decisions/ADR-0006-pr-update-merge.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-1, TD-9)

## 작업

1. 작업자 여러 개(`scripts/harness.ts`의 `run`, 필요하면 `scripts/runner/workers.ts`)
   - `--worker <이름>`이 있거나 환경 변수 `HARNESS_WORKER`가 있으면 지금처럼 그 이름의 루프 하나를 이 프로세스에서 돈다.
   - 둘 다 없으면 `limits.workers`만큼 자식 프로세스를 띄운다: `node scripts/harness.ts run --worker <접두어>-<번호> …`(번호는 1부터). 접두어는 `--prefix`(기본 `runner`)다. `--tool`, `--once`, `--max-iterations`, `--no-wait`를 그대로 넘긴다. 자식의 출력은 그대로 흘려보내고, SIGINT·SIGTERM을 자식에게 전달하며, 모든 자식이 끝나면 가장 큰 종료 코드로 끝난다.
   - `limits.workers`가 1 이상의 정수가 아니면 `ConfigError`다. `harness.config.json`의 `limits.workers`를 2로 바꾼다(Q19).
2. 정지 알림(`scripts/runner/run.ts`)
   - `runRunner`가 `time-limit`, `usage-limit`, `error`로 끝날 때, 이 작업자가 맡은 계획 중 끝나지 않은 것(계획 상태가 `completed`·`abandoned`가 아니고 PR이 병합되지 않은 것)의 Issue마다 댓글을 단다: 제작자 멘션, 작업자 이름, 정지 이유, 남은 일(계획 id, step, PR 번호), 다시 시작하는 명령. 본문 끝에 표식 `<!-- harness-runner-stop:<작업자>:<이유> -->`을 넣는다.
   - 그 Issue의 마지막 댓글이 같은 표식을 가진 내 댓글이면 다시 달지 않는다. `needs-human` 라벨은 붙이지 않는다. 알림 실패는 경고만 남기고 종료를 막지 않는다.
   - `idle`, `human`, `once`, `max-iterations`, `locked`, `agent-missing`은 알리지 않는다.
3. 충돌 자동 해결(`doUpdate`): `origin/main` 병합이 충돌하면 `reportConflict`로 멈추지 않고 바로 충돌 해결 흐름(`doResolveConflict`)으로 간다. 제작자 답이 없으므로 충돌 해결 프롬프트에는 답변 절이 없다. 실패는 지금처럼 `pr:conflict` 키로 세고, 한도(`judge`가 `stop`)에 닿으면 지금의 `reportConflict`(needs-human, `conflict.json` 대기)로 넘긴다. 제작자가 답하면 지금 흐름대로 답을 넣어 다시 푼다.
4. 테스트(새 파일 `scripts/test/runner-workers.test.ts`, `scripts/test/runner.test.ts`의 충돌 테스트 수정)
   - `--worker` 없이 `limits.workers: 2`로 실행하면 `runner-1`·`runner-2` 두 작업자의 lock·로그가 생기고, Issue 두 개가 모두 끝나며, 같은 Issue를 두 작업자가 함께 맡지 않는다(계획의 `owner`로 확인한다). `--prefix mac`이면 `mac-1`·`mac-2`다.
   - `--worker x`는 프로세스 하나만 돈다.
   - 정지 알림: `error`로 끝나면 진행 중 계획의 Issue에 멘션과 표식이 있는 댓글이 하나 달리고, 다시 같은 이유로 끝나도 늘지 않는다. `idle`로 끝나면 달리지 않는다. 라벨은 바뀌지 않는다.
   - 충돌: 제작자 답 없이 해결 세션이 떠서 풀리면 병합 커밋이 일반 push된다. 5회 실패하면 `needs-human`과 중단 보고가 달리고 그 뒤로는 답을 기다린다.
   - WIP: 작업자의 열린 PR(초안 포함)이 `wipPerWorker`개면 새 Issue를 선점하지 않는다.
5. 문서와 기록
   - 설계서 4.5절: 한 바퀴·우선순위·실패와 대기(충돌 문단의 "답 없이 자동으로 푸는 것은 2단계다" 포함)·멈추는 조건(정지 알림)·운영(작업자 여러 개 실행 방법)을 구현에 맞게 고친다. 10.3절 절차 4, 19절 2단계 행의 진행 표시, 설계서 버전·변경 이력.
   - `AGENTS.md`·`CLAUDE.md`의 무인 실행 줄(`run` 명령), 절차서 5절(runner의 충돌 처리), `docs/decisions/ADR-0006-pr-update-merge.md`의 충돌 처리 문단이 구현과 다르면 고친다, `architecture.md`, `CHANGELOG`.
   - `tech-debt-tracker.md`: TD-9를 해결(#56)로, TD-1 비고에 ④ 완료를 적는다. 새 TD 두 건을 등록한다: (가) runner가 만든 PR이 보호 경로를 바꾸면 PR 본문의 체크 줄이 없어 `harness-guard`가 실패하고 사람에게 넘어간다, (나) 실제 GitHub에서 runner 무인 실행으로 확인하지 못한 경로(이 계획의 진행 로그에서 실제 PR로 확인한 것과 가짜 GitHub으로만 확인한 것을 나눠 적는다).
   - 계획의 "검증 방법과 결과"에 수용 기준 1~12의 확인 결과를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/runner-workers.test.ts scripts/test/runner.test.ts scripts/test/runner-pr.test.ts scripts/test/runner-plan-review.test.ts scripts/test/runner-review.test.ts scripts/test/next.test.ts scripts/test/cli.test.ts
grep -q "harness-runner-stop" scripts/runner/run.ts
grep -Eq '"workers": 2' harness.config.json
grep -Eq "TD-9 .*해결\(#56" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 작업자 이름이 겹치게 띄우지 마라. 이유: 계획의 `owner`가 작업자 이름이라 같은 이름이면 서로의 계획을 자기 것으로 보고 같은 step을 동시에 진행한다(4.5절).
- 정지 알림에 `needs-human` 라벨을 붙이거나 계획을 `blocked`로 바꾸지 마라. 이유: 정지는 runner를 다시 시작하면 풀린다. 라벨과 `blocked`는 제작자 답을 기다린다는 뜻이라 다시 시작한 runner가 그 계획을 건너뛴다.
- 충돌 해결 세션이 실패했을 때 병합 상태를 남기지 마라. 이유: 지금처럼 `git merge --abort`로 병합 전으로 되돌린다(reset·force push 없음, ADR-0006).
- 자식 프로세스에 `GH_TOKEN` 등 환경 변수를 따로 만들어 넘기지 마라. 부모의 환경을 그대로 물려준다. 이유: 봇 토큰만 쓴다(R20).
- 테스트에서 실제 `claude`·`codex`·GitHub을 부르지 마라. 이유: 가짜 에이전트와 가짜 GitHub으로 돌린다. 구독 한도와 실제 리포를 건드리지 않는다.
