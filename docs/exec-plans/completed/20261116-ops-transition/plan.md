---
id: 20261116-ops-transition
issue: 57 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: completed # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-16T09:41:21+09:00 # new-task가 채운다
---

# chore: 2단계⑤ revert·하네스 자체 테스트·운영 전환 — 계획 복원, 12.4 시나리오

## 목표와 수용 기준

로드맵 2단계의 마지막 Issue다. ①~④(#53~#56)로 기계 판정, 교차 검증, 지적 원장, runner 연결이 끝났다. 남은 것은 병합 후 main CI 실패의 자동 복구(revert), 하네스를 바꿀 때 규칙이 깨지지 않았는지 보는 자체 테스트(설계서 12.4절), 구축 단계에서 운영 단계로 넘어가는 전환(10.4절 체크리스트, Q7)이다. 제작자 결정(2026-11-16)으로 이 일을 두 계획으로 나눴다. 보안·권한에 해당하는 일(revert 게이트와 워크플로, MCP 훅, 자체 테스트의 `harness-guard` 연결, 실제 세션 시험 `self-test --live`, `ops-check`·CODEOWNERS, 새 테스트 리포에서의 전체 확인, `stage: operation` 전환)은 보안 계획(`20261116-ops-security`, Issue #102, `risk: high`)이 맡고, 이 계획은 그 밖의 일을 맡는다: revert된 계획의 복원, 자체 테스트 실행기와 LLM 없는 시나리오. 이 계획의 step은 모두 임시 git 리포와 가짜 GitHub·가짜 에이전트 안에서 끝나고, 실제 자격증명·실제 GitHub·실제 세션을 쓰지 않는다. Issue #57의 완료 기준 가운데 "`stage: operation` 전환"은 #102에서 닫는다.

수용 기준:

1. **계획 복원**: revert로 main에서 계획 파일이 빠진 Issue를 `new-task --issue <N>`으로 다시 시작하면, 새 골격 대신 revert 대상 커밋에 있던 계획을 같은 id로 `active/`에 복원하고 되돌려진 step을 `pending`으로 둔다. 닫혔다 다시 열린 Issue의 남은 step은 `new-task --plan <id> --step <N>`으로 선점부터 다시 할 수 있다.
2. **자체 테스트 시나리오**: `node scripts/harness.ts self-test [--harness <폴더>]`가 임시 샘플 리포에 대상 하네스를 적용해 12.4절의 기본 시나리오를 LLM 없이 실행하고 종료 코드로 결과를 낸다. 시나리오: S1(선점되지 않은 다음 작업 찾기), R1(계획 없는 변경이 `plan-gate`에서 막힘), R4(`.skip`·`--no-verify`가 막힘), R13(금지 DB 명령이 L1에서 종료 코드 2), R20(제작자 권한 명령이 L1에서 종료 코드 2), 9.2절(3회 방법 전환·5회 중단 보고), 4.5절(runner가 step 여러 개·Issue 여러 개를 개입 없이 처리, 세션 시간 초과·`blocked`에서 다음 할 일로 넘어감, "완료"라 했지만 AC 실패면 완료로 보지 않음), 전체 흐름(선점 → 계획 → PR → 검증 승인 → 계획 완료 커밋 → 자동 병합, 결속 기준에 맞는 PR만 승인 이어받기). 시나리오는 대상 하네스의 CLI와 훅 프로세스만 부른다(내부 함수를 import하지 않는다).
3. **문서**: 설계서(8.3·12.4절, 버전·변경 이력), 절차서, 코드 구조 문서, `CHANGELOG`를 고치고, TD-1을 결과에 맞게 갱신한다.

## 범위 / 비범위

- 범위: `scripts/commands/`(계획 복원), `scripts/lib/`(revert 표식 모듈), `scripts/selftest/`(새 폴더: 실행기, 기본 시나리오, 가짜 에이전트), `scripts/runner/`·`scripts/test/`(가짜 에이전트 이동에 따른 경로), `scripts/harness.ts`(`self-test`), 문서.
- 비범위:
  - 보안 계획(#102)이 맡는 것: `revert-check`, revert 워크플로(`revert.yml`, `revert` environment), MCP 훅(TD-13), `gates`의 `selftest` job과 `harness-guard` 연결, `self-test --live`(실제 세션), `ops-check`·CODEOWNERS·`ci.requiredChecks`, 테스트 리포 확인(`lab/ops-transition/`), `stage` 전환. 이 계획의 PR은 훅·워크플로·게이트·`harness.config.json`의 판정 키·`.claude/` 설정을 바꾸지 않는다.
  - 판정 job의 프롬프트·스키마(`scripts/cross-review/`), 원장 형식, runner의 PR 흐름(#56)은 바꾸지 않는다.
  - 자체 테스트의 주간 정기 실행과 통과율 기준(4단계, TD-11), R5 실효성 검사(TD-4), `pr-size`·`scope`(TD-6).
  - 파일럿(3단계) 자체와 지표 수집(17.2절).

## 관련 파일·문서

- scripts/commands/
- scripts/lib/
- scripts/runner/
- scripts/selftest/
- scripts/test/
- scripts/harness.ts
- profiles/
- AGENTS.md
- CLAUDE.md
- ARCHITECTURE.md
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/decisions/
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261116-ops-transition/

## step 목록

- step0 plan-restore: revert된 계획을 `new-task`가 복원, 다시 열린 Issue의 재선점, revert 표식 모듈
- step1 selftest-core: 자체 테스트 실행기와 샘플 리포, 시나리오 S1·R1·R4·R13·R20, `self-test` 명령
- step2 selftest-runner: 시나리오 9.2절·4.5절·전체 흐름(가짜 에이전트·가짜 GitHub)

## 진행 로그

- 2026-11-16 step0: 계획 작성. 제작자 대화 지시("현재 프로젝트 진행 상황 검토하고 #57을 진행해달라")로 시작. 계획 작성 중 제작자에게 두 가지를 물어 답을 받았다(의사결정 로그).
- 2026-11-16 step0: 계획만 담은 커밋을 올리기 전 로컬 `check`가 이 Windows PC(Node 24)에서 계획과 무관한 테스트 실패로 통과하지 않았다. 절차서 5절에 따라 Issue #99로 먼저 고쳤다(PR #100 병합: CLI 자연 종료, POSIX 환경을 가정한 테스트 6개). main(`5177010`)을 받아 온 뒤 이 계획을 올렸다.
- 2026-11-16 step0: 계획 검증 1라운드(PR #101, head `a2b35b7`, step 11개짜리 계획). `review/claude` 승인(P2 2건), `review/codex` 수정 요청(F1, P1: 권한·보안이 든 계획인데 `risk`가 normal이다). F1에 반박했다(위험도 normal은 2026-11-15의 제작자 결정이다. 근거 `docs/exec-plans/completed/20261115-cross-review/plan.md:120`).
- 2026-11-16 step0: 2라운드(head `b41d13a`). `review/claude` 승인, `review/codex`는 반박을 받아들이지 않았다("제작자 결정 기록은 확인했지만 계획 검증 기준상 보안·권한 작업이 든 계획은 high여야 한다"). 보안·권한 결정이고 앞선 제작자 결정을 바꾸는 일이라 제작자에게 물었다. 답: 계획을 둘로 나눈다. 봇이 Issue #102를 등록하고 보안·권한 step 6개(revert-check, revert-workflow, mcp-guard, selftest-guard, ops-check, operation)를 보안 계획(`20261116-ops-security`)으로 옮겼다. 이 계획에는 5개가 남고 step 번호를 다시 매겼다(plan-restore 2→0, selftest-core 3→1, selftest-runner 4→2, selftest-live 5→3, test-repo 9→4).
- 2026-11-16 step0: 3라운드(head `53895e2`). `review/claude` 승인(P2 1건: 옮긴 step에 남은 옛 번호 "step9"). `review/codex`는 F1을 닫지 않았다("실제 GitHub 테스트, 보호 설정 및 봇 권한 동작 확인, `self-test --live`를 포함하므로 high 기준과 충돌한다"). 그 두 step(selftest-live, test-repo)도 보안 계획으로 옮겼다(그 계획의 step5·step6). 이 계획에는 실제 자격증명·실제 GitHub·실제 세션을 쓰지 않는 step 3개만 남는다.
- 2026-11-16 step0: 4라운드(head `6a0e3f5`, step 3개)에서 두 검증자가 승인했다(G1, 지적 없음). 원장 F1은 닫혔다.
- 2026-11-16 step0: 구현. `scripts/lib/revert-marker.ts`(`revertMarker`, `findRevertMarker`), `scripts/commands/task.ts`(`restorablePlan`, `restorePlan`, `findRestore`, `claimOwner`, `new-task`의 복원과 재선점). "확인할 것"(step0 작업 2번)에서 고칠 곳이 둘 나왔다. (1) 첫 step의 PR이 되돌려진 Issue는 닫힌 적이 없어 내 선점이 남는데, runner는 선점된 Issue를 고르지 않아 아무도 이어 가지 못한다. 내 선점이고 계획을 복원할 수 있으면 후보로 고르게 했다(`scripts/runner/next.ts`). (2) 복원한 작업은 되돌려진 PR과 브랜치 이름이 같아, 병합된 옛 PR이 이 작업의 PR로 잡혀 step을 건너뛰고 worktree 정리 대상이 된다. 병합된 PR인데 그 step이 worktree에서도 main에서도 끝나 있지 않으면 이 작업의 PR로 보지 않게 했다(`readLocalPlans`). runner의 다음 step 시작(`run.ts`)은 `new-task`가 선점을 다시 잡을 수 있게 GitHub 조회를 켰다. 테스트: `task.test.ts` 4개(표식, 첫 step 복원, 소규모 계획 복원, 마지막 step 재선점), `next.test.ts` 2개(후보 선택과 옛 PR, worktree가 뒤처진 병합 PR).
- 2026-11-16 step0: PR #101 병합(main `cbe2f2e`). 보안 계획의 PR #103은 main을 병합해 갱신했다(TD-39의 순서).
- 2026-11-16 step1: 구현. `scripts/selftest/run.ts`(`runSelfTest`, 샘플 리포, `ctx.cli`·`ctx.hook`, `assertBlocked`·`assertAllowed`, `formatSelfTest`), 시나리오 5개(`s1-next-task`, `r1-plan-gate`, `r4-bypass`, `r13-db`, `r20-owner-commands`), `scripts/harness.ts`의 `self-test`. 이 Windows PC에서 5개 실행에 약 40초다. 테스트 `selftest.test.ts` 6개(이 리포 전부 통과, 훅 종료 코드 1 사본에서 R20 실패, 항상 통과하는 `plan-gate` 사본에서 R1 실패, `--only`와 없는 id, 예외·assert 실패 뒤에도 나머지 실행, 자식 프로세스 환경 변수). 문서: 설계서 12.4절(v0.7.45), 코드 구조 문서, 절차서 4절, `CHANGELOG`.
- 2026-11-16 step1: PR #104. 1라운드에서 `review/claude` 승인(지적 없음). 그 사이 보안 계획의 PR #103이 제작자 승인으로 병합돼(main `5ac523a`) `origin/main`을 병합해 갱신했다. 충돌은 문서 두 곳(설계서 버전 줄·변경 이력, `CHANGELOG`)이었고 main의 v0.7.44 줄 뒤에 이 PR의 v0.7.45 줄을 뒀다.
- 2026-11-16 step1: PR #104 병합(main `34ad3c1`). 보안 계획의 step1(PR #105)이 main을 병합해 받았다.
- 2026-11-16 step2: 구현. 가짜 에이전트를 `scripts/selftest/fake-agent.ts`로 옮기고(내용 그대로, runner 테스트 5개 파일의 경로만 수정) 실행기에 `ctx.agent`·`ctx.github`·`ctx.api`(읽기 전용 로컬 서버 `api-stub.ts`), `Sample.prompts`, `Scenario.timeoutSec`, `runnerConfig`를 더했다. 시나리오 `f92-switch-stop`(9.2절), `r45-runner`(4.5절), `flow-full`(전체 흐름과 승인 이어받기). 테스트: 이 리포는 시나리오 8개가 모두 `pass`, runner가 AC 결과를 보지 않는 사본에서 `r45-runner`가 `fail`, 실행기 테스트 1개(상태 파일 읽고 고치기, 가짜 에이전트 연결, 서버가 시나리오 뒤 꺼짐, 시나리오별 시간 제한). 문서: 설계서 v0.7.47(12.4절), 코드 구조 문서, `CHANGELOG`.
- 2026-11-16 step2: 만들면서 어긋난 것은 모두 시나리오·샘플 쪽 원인이었고 대기 시간을 늘려 가린 것은 없다. (1) 샘플 리포에서 `check`의 doc-lint가 실패해(복사한 `AGENTS.md`가 가리키는 문서가 샘플에 없다) 모든 step이 `check:doc-lint`로 멈췄다 → `runnerConfig`가 복사한 문서를 doc-lint에서 뺀다. (2) 계획 frontmatter의 `status: blocked` 뒤에 주석이 붙는다 → 줄 끝까지가 아니라 값만 본다. (3) `flow-full`: step이 하나인 계획의 PR은 `Closes`다, CI 흉내 체크아웃이 새 head를 받아야 한다, main 병합 갱신 뒤의 기준 커밋은 앞서 나간 main과의 merge-base다.
- 2026-11-16 step2: 흔들림 확인. `node scripts/harness.ts self-test --only f92-switch-stop,r45-runner,flow-full`을 이 Windows PC에서 5번 이어서 실행했다: 5번 모두 종료 코드 0(3개 모두 `pass`), 회당 143·142·140·138·144초. 4·5회차는 다른 worktree의 테스트(`revert.test.ts`)와 겹쳐 돌았다. AC의 테스트 명령(`selftest.test.ts`·`runner.test.ts`·`runner-workers.test.ts`)은 31개 통과, 363초였다(`selftest.test.ts`만 약 270초).
- 2026-11-16 step2: PR #106. 1라운드(head `8d487ed`)에서 두 검증자가 승인했다(지적 없음). 보안 계획 step1(PR #105, 설계서 v0.7.46)이 제작자 승인으로 병합될 때까지 초안으로 두었고, 병합된 뒤(main `decf237`) `origin/main`을 병합해 받았다. 충돌은 문서 두 곳(설계서 버전 줄·변경 이력, `CHANGELOG`)이었고 main의 v0.7.46 줄 뒤에 이 PR의 v0.7.47 줄을 뒀다. 코드 충돌은 없었고, 병합한 트리에서 전체 `check`를 다시 돌렸다.

## 의사결정 로그

- 결정(제작자, 2026-11-15 대화): 이 계획의 위험도는 `risk: normal`이다. 기록: [Issue #57 댓글](https://github.com/ariawell-hub/harness_project/issues/57#issuecomment-6887304907), 완료 계획 `docs/exec-plans/completed/20261115-cross-review/plan.md`의 의사결정 로그. / 이유: 구축 단계에서는 보호 경로도 자동 병합하고, 인증을 직접 다루는 일만 PR마다 사람이 본다.
- 결정(제작자, 2026-11-16 대화): 계획을 둘로 나눈다. 보안·권한 step은 새 Issue #102의 `risk: high` 계획(`20261116-ops-security`)으로 옮겨 PR마다 제작자 head 승인을 받고, 나머지는 이 계획(`risk: normal`)에 남겨 자동 병합한다. 제작자는 "STEP에서의 AI 작업 진행해 병목이 생기는 사항을 줄일 필요가 있다"고 덧붙였다. / 이유: 절차서 1절("기준에 해당하는 일과 아닌 일은 계획을 나눈다")과 계획 검증 프롬프트의 위험도 기준(PR #101 원장 F1). 앞의 `normal` 결정은 보안·권한 일을 뺀 이 계획에 그대로 적용된다. / 버린 대안: 계획 전체를 high로(PR 11개 모두 승인. 2026-11-15에 "#53에서 겪은 부담"으로 버린 방식), normal 유지와 재반박(검증 기준이 그대로라 교착).
- 결정: 병목을 줄이기 위해 두 계획을 병행한다. 보안 계획의 PR이 제작자 승인을 기다리는 동안 이 계획의 step을 진행한다. 이 계획의 step0~2는 보안 계획과 무관하게 시작할 수 있게 짰다(revert 표식은 양쪽이 같은 모듈 `scripts/lib/revert-marker.ts`를 쓰고 먼저 병합되는 쪽이 만든다). 이 계획의 step은 제작자 작업 없이 끝난다. / 이유: 한 계획 안의 step은 순서대로 병합돼야 다음으로 간다. 계획이 둘이면 한쪽이 승인 대기일 때 다른 쪽이 나아간다. / 버린 대안: 보안 계획이 끝난 뒤 이 계획 시작(승인 대기 동안 멈춘다).
- 결정: `self-test --live`와 테스트 리포 확인(test-repo)은 보안 계획으로 옮긴다. / 이유: 두 step은 실제 자격증명이 있는 환경에서 보호 설정·봇 권한·금지 규칙의 실제 동작을 확인한다. 계획 검증 기준은 이런 일을 보안·권한 작업으로 본다(PR #101 원장 F1의 3라운드 답). 둘 다 대화 세션과 제작자 작업이 필요한 step이라 승인이 더해져도 대기가 늘지 않는다. / 버린 대안: 이 계획에 두고 재반박(같은 지적에 두 번째 반박이라 받아들여지지 않으면 교착이다).
- 결정: 자체 테스트는 두 층으로 둔다. LLM 없는 시나리오(가짜 에이전트·가짜 GitHub·훅 프로세스 직접 호출)는 이 계획이 만들고 CI와 `harness-guard`에 연결한다(연결은 보안 계획 step3). 실제 세션 시나리오(`--live`, 보안 계획 step5)는 손으로 실행해 통과율만 기록한다. / 이유: PR 코드를 실행하는 job에는 구독 인증을 둘 수 없다(10.4절). 실제 세션은 실행마다 달라 병합 판정에 쓸 수 없다(12.4절). / 버린 대안: CI에서 실제 세션 실행.
- 결정(step1): 실행기는 Node 내장 모듈만 쓰고 이 리포의 `scripts/lib/`도 import하지 않는다. 가짜 GitHub 상태 파일은 실행기가 JSON으로 직접 쓴다(제작자·봇 계정은 대상 하네스의 설정에서 읽는다). / 이유: 보안 계획 step3에서 main의 실행기가 PR의 하네스를 시험한다. 실행기가 기대는 것을 CLI·훅의 입출력과 상태 파일 형식으로 좁혀 둔다. / 버린 대안: 대상 하네스의 `github-fake.ts`를 import(다른 버전의 내부 모듈에 기댄다).
- 결정(step1): step 파일의 인터페이스에 세 가지를 더했다. `Sample`의 모양(`root`, `remote`, `ghState`, `owner`, `bot`, `git`, `write`, `issue`: step 파일은 이름만 썼다), 시나리오가 함께 쓰는 `assertBlocked`(종료 코드가 정확히 2 + 규칙 이름)·`assertAllowed`, `runSelfTest`의 선택 인자 `scenarioDir`(실행기 테스트가 임시 시나리오 폴더를 준다). CLI에는 `scenarioDir`를 열지 않았다. / 이유: "예외 뒤에도 나머지를 돌린다"를 목록 파일 없이 시험하려면 시나리오 폴더를 바꿀 수 있어야 한다.
- 결정(step1): `--only`에 없는 id가 있으면 실행하지 않고 종료 코드 2로 끝낸다. 시나리오 폴더가 비어도 같다. / 이유: 오타 하나로 "0개 실행, 통과"가 되면 보안 계획 step3의 게이트가 빈 채로 통과한다.
- 결정(step1): R13의 대조군 "같은 클라이언트의 읽기 명령"은 같은 도구의 읽기 명령(`prisma migrate status`, `knex migrate:status`)으로 확인한다. / 이유: 훅은 `psql` 같은 DB 클라이언트를 읽기 명령이어도 직접 접속으로 막는다(설계서 14.3절 "직접 접속"). 클라이언트 실행 파일의 읽기 명령이 통과한다고 확인하면 설계와 어긋난다.
- 결정(step1): 설계서 버전은 v0.7.45로 올린다. v0.7.44는 승인 요청을 앞둔 보안 계획의 PR #103이 쓴다. / 이유: 어느 쪽이 먼저 병합돼도 최종 변경 이력의 번호가 겹치지 않는다(TD-39).
- 결정(step2): step 파일의 인터페이스에 네 가지를 더했다. `ctx.api(s, routes)`(읽기 전용 GitHub REST 흉내), `Sample.prompts()`(가짜 에이전트가 받은 프롬프트), `Scenario.timeoutSec`(기본 120초, runner 시나리오 300초), `runnerConfig(harness, over)`(runner 시나리오의 샘플 설정). / 이유: `review-plan`의 승인 이어받기는 가짜 GitHub 상태 파일이 아니라 REST(`GITHUB_API_URL`)로 조회한다. 실행기는 대상 CLI를 동기로 실행하므로 그 조회에 답할 서버는 다른 프로세스여야 하고, 시나리오가 끝나면 꺼야 해서 실행기가 수명을 맡는다. 시간 제한은 step 파일이 300초로 정했는데 step1의 시나리오는 120초로 충분하다. 설정은 세 시나리오가 같은 것을 쓴다. / 버린 대안: 서버 없이 `review-plan`을 부르기(조회 실패라 이어받기가 늘 비어, "main 병합 갱신에서는 채워진다"를 확인할 수 없다).
- 결정(step2): `runnerConfig`는 대상 하네스의 설정에서 만든다(표준 명령 끔, 세션 1분·AC 60초·대기 0초·작업자 1개, 복사한 문서를 doc-lint에서 뺌). 고정 값의 설정 전체를 쓰지 않는다. / 이유: 대상 하네스(PR)가 설정 항목을 더하면 고정 값은 그 항목이 빠져 설정 검증에서 떨어진다. 표준 명령을 끄는 것은 샘플 리포에 의존성이 없어서고, runner의 AC 판정과 `check`의 나머지(doc-lint의 계획 폴더 검사, 우회 탐지, 시크릿 스캔)는 그대로 돈다.
- 결정(step2): `flow-full`의 계획 승인 원장 댓글은 시나리오가 직접 만든다(표식 `harness-ledger:v1`과 숨은 자료). 필수 체크 결과도 상태 파일에 직접 넣는다. / 이유: 대상 하네스의 `record-review`·`record-status`는 REST로만 쓰고 가짜 GitHub 상태 파일에는 쓰지 못한다. 시나리오가 기대는 형식이 가짜 GitHub 상태 파일에 더해 원장 댓글 형식(v1)까지 늘어난다(설계서 12.4절에 적었다). / 버린 대안: 쓰기까지 받는 REST 서버를 만들어 상태 파일과 잇기(가짜 GitHub을 한 벌 더 만드는 일이다).
- 결정(step2): `flow-full`에서 필수 체크를 넣은 뒤 PR의 자동 병합 표시를 꺼서 runner가 다시 켜게 한다(`arm-merge`). / 이유: 가짜 GitHub은 `setCheck`나 `enableAutoMerge`가 불릴 때만 병합 조건을 본다. 상태 파일에 체크를 직접 넣으면 다시 보지 않고, CLI에서 그 판정에 닿는 길은 runner의 자동 병합 켜기뿐이다. 그 전에 "필수 체크가 없는 head는 병합되지 않는다"를 먼저 확인한다.
- 결정(step2): 승인 이어받기는 runner의 worktree가 아니라 원격을 새로 받은 체크아웃에서 확인한다. main의 앞선 커밋과 병합 갱신·공백 커밋은 그 체크아웃 안에만 만들고 push하지 않는다. / 이유: `review-plan`은 체크아웃 안에 검증 입력 폴더를 쓴다. runner의 worktree를 더럽히면 뒤의 병합 단계가 달라진다. CI도 새 체크아웃에서 돈다.
- 결정(step2): `r45-runner`의 세션 시간 제한은 6초(0.1분)이고, 세션 횟수를 정확히 세지 않는다("다시 띄웠다"는 2회 이상으로 본다). `f92-switch-stop`은 세션 제한 1분에서 횟수(정확히 5회)를 센다. / 이유: 시간 초과 세션 하나가 제한만큼 걸려 짧아야 하지만, 부하가 걸린 PC에서 정상 세션이 제한을 넘으면 횟수가 달라진다. 횟수를 세는 시나리오에는 시간 초과를 넣지 않았다.
- 결정(step2): 설계서 버전은 v0.7.47이다. v0.7.46은 보안 계획 step1(PR #105)이 쓴다. 이 PR은 PR #105가 병합된 뒤에 병합한다(그때까지 자동 병합을 켜지 않는다). / 이유: PR #105는 제작자 head 승인을 기다리는 위험도 높음 PR이라, 이 PR이 먼저 병합되면 문서 충돌로 PR #105에 커밋을 더 올려야 하고 승인 요청이 무효가 된다(TD-39). 보안 계획의 다음 step은 어차피 PR #105가 병합돼야 시작할 수 있어, 이 PR을 먼저 병합해도 앞당겨지는 일이 없다.

## 발견 사항

- 이 Windows PC는 개발자 모드가 꺼져 있어 심볼릭 링크를 만들 수 없고, 파일 이름에 `:`·`*`를 쓸 수 없고, POSIX 권한 비트가 없다(#99). 이 계획에서 새로 쓰는 테스트·시나리오도 같은 제약을 지켜야 로컬 `check`가 통과한다(디렉터리 링크는 `'junction'`, 셸 명령에 넣는 경로는 `/`, 전체 `check`는 약 13분). → 처리: TD-14
- 두 계획을 병행하면 step PR끼리 문서의 같은 자리(설계서 버전 줄, 변경 이력 끝, `CHANGELOG` 끝)에서 충돌한다. 먼저 병합된 쪽 때문에 나중 PR은 main을 병합해 갱신해야 하고, 그 PR이 제작자 승인을 기다리는 보안 계획의 PR이면 승인 요청이 무효가 된다. 이번에는 이 계획의 step0을 먼저 병합하고 보안 계획의 PR #103을 갱신한 뒤 승인을 요청하는 순서로 피한다. → 처리: TD-39
- 복원 조건 "main에 그 계획이 없다"는 계획 id로만 본다. revert 뒤 같은 Issue에 새 계획(다른 id)이 이미 만들어져 병합됐다면 옛 계획도 복원 대상으로 남는다. 선점이 살아 있는 동안에는 그 작업자만 `new-task --issue`를 다시 실행할 수 있어 드물다. 보안 계획 step6(테스트 리포의 `plan-restore` 사례)에서 실제 흐름으로 본다. → 처리: #102
- 자체 테스트의 샘플 리포는 `check`의 doc-lint를 통과하지 못한다. 복사한 `AGENTS.md`·절차서가 가리키는 문서(설계서, `docs/index.md`, ADR 등)가 샘플에 없다. runner 시나리오는 복사한 문서를 doc-lint에서 빼고 돈다. 하네스를 적용한 새 리포에서 문서 검사까지 통과하는지는 보안 계획 step6(테스트 리포)에서 본다. → 처리: #102
- 가짜 GitHub은 체크가 상태 파일에 직접 들어오면 병합 조건을 다시 보지 않는다. 실제 GitHub의 "필수 체크 통과 → 자동 병합"은 자체 테스트가 아니라 보안 계획 step6(테스트 리포)에서 확인된다. → 처리: #102
- 이 Windows PC에서 전체 `check`의 `test` 단계가 870~900초로, 시간 제한(`commands.test.timeoutSec` 900초)에 닿아 있다(오늘 8번 실행: 805~900초). 이 step으로 `selftest.test.ts`가 약 270초가 됐다(가장 긴 파일은 아니다). GitHub Actions의 `check`는 6분 안팎이라 CI에는 여유가 있다. → 처리: TD-40

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- 계획 복원·자체 테스트는 임시 git 리포, 가짜 GitHub(`HARNESS_FAKE_GH`), 가짜 에이전트로 끝까지 돌린다.

## 다음 할 일

- 이 계획의 step은 step2가 마지막이다. PR이 병합되면 Issue #57이 닫히고, #57의 남은 수용 기준(운영 전환 체크리스트, `stage: operation`)은 보안 계획(#102, `20261116-ops-security`)이 이어서 한다.
- 이 계획에는 제작자 작업이 없다. 보안 계획(#102)의 제작자 작업은 그 계획의 "다음 할 일"에 있다.
