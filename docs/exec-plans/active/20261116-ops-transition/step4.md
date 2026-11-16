# Step 4: selftest-runner

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-transition/plan.md` (수용 기준 4)
- `docs/harness/design.md` 12.4절(9.2절·4.5절·전체 흐름 시나리오), 9.2절(3회·5회), 4.5절(runner), 10.3절(승인 결속 기준)
- 앞 step에서 만든·바꾼 파일: `scripts/selftest/run.ts`(`Scenario`, `ScenarioContext`, `sample`, `cli`), `scripts/selftest/scenarios/`, `scripts/test/selftest.test.ts`
- `scripts/test/fake-agent.ts`(가짜 에이전트의 동작 지정 방식), `scripts/lib/github-fake.ts`(`setCheck`, `mergeRequires`, 상태 파일), `scripts/test/runner.test.ts`, `scripts/test/runner-workers.test.ts`(실제 `run` 프로세스를 띄우는 테스트), `scripts/test/runner-pr.test.ts`, `scripts/test/binding.test.ts`
- `scripts/harness.ts`의 `run`·`review-plan` 명령

## 작업

1. 가짜 에이전트를 자체 테스트가 쓸 수 있게 한다: `scripts/test/fake-agent.ts`를 `scripts/selftest/fake-agent.ts`로 옮기고(기존 테스트의 import·설정 경로를 고친다) `ScenarioContext`에 더한다.

   ```ts
   /** 샘플 리포의 에이전트 설정을 실행기 쪽 가짜 에이전트로 바꾼다. script는 가짜 에이전트의 동작 지정(기존 형식 그대로) */
   agent(s: Sample, script: Record<string, unknown>): void;
   /** 가짜 GitHub 상태 파일을 읽고 고친다(Issue·PR·체크·댓글) */
   github(s: Sample): { read(): unknown; update(fn: (state: any) => void): void };
   ```

   가짜 에이전트는 실행기(main) 쪽 파일을 쓴다. 가짜 GitHub은 대상 하네스의 구현(`HARNESS_FAKE_GH`)이다.

2. 시나리오(`scripts/selftest/scenarios/`). runner는 대상 하네스의 `harness.ts run --worker <이름> --no-wait --max-iterations <N>`을 자식 프로세스로 띄운다.
   - `f92-switch-stop.ts`(9.2절): AC가 계속 실패하는 step. 같은 키로 3회 실패한 뒤의 세션 프롬프트에 방법 전환 지시가 들어 있고(가짜 에이전트가 받은 프롬프트를 파일로 남긴다), 5회에 계획이 `blocked`이고 Issue에 "중단 보고" 댓글과 `needs-human` 라벨이 있다.
   - `r45-runner.ts`(4.5절): step 2개짜리 계획의 Issue와 다른 Issue 하나를 사람 개입 없이 끝까지 처리한다(가짜 GitHub이 필수 체크 통과 뒤 병합한다). 세션이 "완료"라고 출력했지만 AC가 실패하면 step을 완료로 두지 않는다. 세션 시간 초과와 한 계획의 `blocked` 뒤에 runner 프로세스가 죽지 않고 다른 Issue를 처리한다.
   - `flow-full.ts`(전체 흐름): 선점(`claim/<N>`이 원격에 있다) → 계획(계획만 담은 커밋의 초안 PR) → 가짜 GitHub에 계획 승인 원장과 체크를 넣으면 step 진행 → PR → 검증 승인 체크 → 계획 완료 커밋(PR head의 step이 `completed`) → 자동 병합 → Issue 닫힘. 승인 이어받기: 승인된 PR을 `origin/main` 병합으로 갱신한 head에서 `review-plan`의 이어받기 출력(`carry_claude`·`carry_codex`)이 채워지고, PR 파일을 공백만 바꾼 커밋을 더한 head에서는 비어 있다(가짜 GitHub이 `review-plan`의 조회를 받지 못하면 이 부분은 `binding`의 CLI 입력으로 확인한다. 방법은 재량이되 대상 하네스의 CLI만 쓴다).
   - 시나리오마다 runner 실행 횟수와 시간을 제한한다(`--max-iterations`, 시나리오 시간 제한 300초).

3. `scripts/test/selftest.test.ts`: 새 시나리오 셋도 이 리포에 대해 `pass`다. 약화 확인을 하나 더한다: AC 판정을 건너뛰게 바꾼 하네스 사본에서 `r45-runner`가 `fail`이다.

4. 흔들림 확인: 새 시나리오 셋을 로컬에서 5번 반복 실행해 결과를 진행 로그에 적는다. 한 번이라도 실패하면 원인을 고친다(대기 시간을 늘려 가리지 않는다).

5. 문서: 설계서 12.4절 시나리오 표에 세 행, `architecture.md`(가짜 에이전트 위치), `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/selftest.test.ts scripts/test/runner.test.ts scripts/test/runner-workers.test.ts
node scripts/harness.ts self-test --only f92-switch-stop,r45-runner,flow-full
test -f scripts/selftest/fake-agent.ts
! test -f scripts/test/fake-agent.ts
! grep -rnE "from '\.\./\.\./(lib|gates|hooks|commands|runner|ci)/" scripts/selftest/scenarios
```

## 금지사항

- 시나리오에서 runner 함수(`runRunner`, `pickNext`)를 직접 부르지 마라. 이유: 대상 하네스의 CLI만 불러야 main의 시나리오로 PR의 하네스를 시험할 수 있다.
- 가짜 에이전트의 동작 지정 형식을 바꾸지 마라. 이유: 기존 runner 테스트 전체가 그 형식에 기댄다. 필요한 동작은 더하기만 한다.
- 흔들리는 시나리오를 재시도나 긴 `sleep`으로 통과시키지 마라. 이유: step6에서 이 시나리오가 보호 경로 PR의 병합을 막는다. 흔들리면 모든 하네스 PR이 막힌다.
- step3에서 만든 시나리오 파일을 고치지 마라(import 경로 수정이 꼭 필요한 경우 제외). 이유: 시나리오는 더하기만 하는 구조다.
