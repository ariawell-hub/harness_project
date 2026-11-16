---
id: 20261116-ops-transition
issue: 57 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-16T09:41:21+09:00 # new-task가 채운다
---

# chore: 2단계⑤ revert·하네스 자체 테스트·운영 전환 — 계획 복원, 12.4 시나리오, 테스트 리포 확인

## 목표와 수용 기준

로드맵 2단계의 마지막 Issue다. ①~④(#53~#56)로 기계 판정, 교차 검증, 지적 원장, runner 연결이 끝났다. 남은 것은 병합 후 main CI 실패의 자동 복구(revert), 하네스를 바꿀 때 규칙이 깨지지 않았는지 보는 자체 테스트(설계서 12.4절), 구축 단계에서 운영 단계로 넘어가는 전환(10.4절 체크리스트, Q7)이다. 제작자 결정(2026-11-16)으로 이 일을 두 계획으로 나눴다. 보안·권한에 해당하는 일(revert 게이트와 워크플로, MCP 훅, 자체 테스트의 `harness-guard` 연결, `ops-check`·CODEOWNERS, `stage: operation` 전환)은 보안 계획(`20261116-ops-security`, Issue #102, `risk: high`)이 맡고, 이 계획은 그 밖의 일을 맡는다: revert된 계획의 복원, 자체 테스트 실행기와 시나리오, 새 테스트 리포에서의 전체 확인. Issue #57의 완료 기준 가운데 "`stage: operation` 전환"은 #102에서 닫는다.

수용 기준:

1. **계획 복원**: revert로 main에서 계획 파일이 빠진 Issue를 `new-task --issue <N>`으로 다시 시작하면, 새 골격 대신 revert 대상 커밋에 있던 계획을 같은 id로 `active/`에 복원하고 되돌려진 step을 `pending`으로 둔다. 닫혔다 다시 열린 Issue의 남은 step은 `new-task --plan <id> --step <N>`으로 선점부터 다시 할 수 있다.
2. **자체 테스트 시나리오**: `node scripts/harness.ts self-test [--harness <폴더>]`가 임시 샘플 리포에 대상 하네스를 적용해 12.4절의 기본 시나리오를 LLM 없이 실행하고 종료 코드로 결과를 낸다. 시나리오: S1(선점되지 않은 다음 작업 찾기), R1(계획 없는 변경이 `plan-gate`에서 막힘), R4(`.skip`·`--no-verify`가 막힘), R13(금지 DB 명령이 L1에서 종료 코드 2), R20(제작자 권한 명령이 L1에서 종료 코드 2), 9.2절(3회 방법 전환·5회 중단 보고), 4.5절(runner가 step 여러 개·Issue 여러 개를 개입 없이 처리, 세션 시간 초과·`blocked`에서 다음 할 일로 넘어감, "완료"라 했지만 AC 실패면 완료로 보지 않음), 전체 흐름(선점 → 계획 → PR → 검증 승인 → 계획 완료 커밋 → 자동 병합, 결속 기준에 맞는 PR만 승인 이어받기). 시나리오는 대상 하네스의 CLI와 훅 프로세스만 부른다(내부 함수를 import하지 않는다).
3. **실제 세션 시나리오**: `self-test --live`가 실제 `claude -p` 세션으로 S1·R13·R20을 여러 번 실행해 시나리오별 통과율을 낸다. 판정 기준값은 정하지 않고 결과만 기록한다(12.4절: 기준은 파일럿에서 정한다).
4. **테스트 리포 확인(체크리스트 5)**: 새 빈 비공개 테스트 리포에 하네스를 적용해 아래를 실제 GitHub에서 확인하고 `lab/ops-transition/results/`에 기대·관찰·판정·근거로 남긴다. 필수 항목: 자체 테스트 통과, runner 무인 실행으로 선점 → 계획 검증 → PR → 교차 검증 → 계획 완료 커밋 → 자동 병합, main 병합 갱신 뒤 승인 이어받기, main 실패 → 재실행 → revert PR → `revert-check` → 자동 병합 → Issue 재오픈 → 계획 복원, 여분 변경이 든 `revert/` PR의 차단, 보호 경로 PR의 `selftest` job, 코드 오너 리뷰 설정에서 보호 경로 PR은 제작자 승인 없이 병합되지 않고 보호 경로 밖 PR은 자동 병합됨, `workflow` 권한 없는 봇 토큰의 워크플로 push 거부. `node lab/ops-transition/report.ts --all`이 필수 항목의 기록 완결과 `pass` 판정을 확인한다. 이 step은 보안 계획의 step0~4가 병합된 뒤에 한다.
5. **문서**: 설계서(8.3·12.4·16절·19절, 버전·변경 이력), 절차서, 코드 구조 문서, `CHANGELOG`를 고치고, TD-1·TD-38을 결과에 맞게 갱신한다.

## 범위 / 비범위

- 범위: `scripts/commands/`(계획 복원), `scripts/lib/`(revert 표식 모듈), `scripts/selftest/`(새 폴더: 실행기, 기본 시나리오, 가짜 에이전트, `--live`), `scripts/runner/`·`scripts/test/`(가짜 에이전트 이동에 따른 경로), `scripts/harness.ts`(`self-test`), `lab/ops-transition/`(결과 틀과 테스트 리포 결과), 문서.
- 비범위:
  - 보안 계획(#102)이 맡는 것: `revert-check`, revert 워크플로(`revert.yml`, `revert` environment), MCP 훅(TD-13), `gates`의 `selftest` job과 `harness-guard` 연결, `ops-check`·CODEOWNERS·`ci.requiredChecks`, `stage` 전환. 이 계획의 PR은 훅·워크플로·게이트·`harness.config.json`의 판정 키·`.claude/` 설정을 바꾸지 않는다.
  - 제작자만 할 수 있는 설정은 봇이 하지 않는다(R20): 테스트 리포 생성·보호 설정·environment·App 설치. 절차와 확인 방법을 문서로 주고 한 번에 모아 요청한다.
  - 판정 job의 프롬프트·스키마(`scripts/cross-review/`), 원장 형식, runner의 PR 흐름(#56)은 바꾸지 않는다. 테스트 리포에서 결함이 드러나면 새 step(보안·권한에 해당하면 보안 계획)을 더해 고친다.
  - Codex 실제 세션의 자체 테스트(`--live --tool codex`). Codex 훅은 실제 세션 검증이 안 됐다(TD-8).
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
- lab/ops-transition/
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
- step3 selftest-live: `self-test --live`(실제 `claude -p` 세션의 S1·R13·R20, 통과율)
- step4 test-repo: 새 테스트 리포에서 전체 흐름·revert·설정 확인, 결과 기록(`lab/ops-transition/`) (선행: 보안 계획 step0~4)

## 진행 로그

- 2026-11-16 step0: 계획 작성. 제작자 대화 지시("현재 프로젝트 진행 상황 검토하고 #57을 진행해달라")로 시작. 계획 작성 중 제작자에게 두 가지를 물어 답을 받았다(의사결정 로그).
- 2026-11-16 step0: 계획만 담은 커밋을 올리기 전 로컬 `check`가 이 Windows PC(Node 24)에서 계획과 무관한 테스트 실패로 통과하지 않았다. 절차서 5절에 따라 Issue #99로 먼저 고쳤다(PR #100 병합: CLI 자연 종료, POSIX 환경을 가정한 테스트 6개). main(`5177010`)을 받아 온 뒤 이 계획을 올렸다.
- 2026-11-16 step0: 계획 검증 1라운드(PR #101, head `a2b35b7`, step 11개짜리 계획). `review/claude` 승인(P2 2건), `review/codex` 수정 요청(F1, P1: 권한·보안이 든 계획인데 `risk`가 normal이다). F1에 반박했다(위험도 normal은 2026-11-15의 제작자 결정이다. 근거 `docs/exec-plans/completed/20261115-cross-review/plan.md:120`).
- 2026-11-16 step0: 2라운드(head `b41d13a`). `review/claude` 승인, `review/codex`는 반박을 받아들이지 않았다("제작자 결정 기록은 확인했지만 계획 검증 기준상 보안·권한 작업이 든 계획은 high여야 한다"). 보안·권한 결정이고 앞선 제작자 결정을 바꾸는 일이라 제작자에게 물었다. 답: 계획을 둘로 나눈다. 봇이 Issue #102를 등록하고 보안·권한 step 6개(revert-check, revert-workflow, mcp-guard, selftest-guard, ops-check, operation)를 보안 계획(`20261116-ops-security`)으로 옮겼다. 이 계획에는 5개가 남고 step 번호를 다시 매겼다(plan-restore 2→0, selftest-core 3→1, selftest-runner 4→2, selftest-live 5→3, test-repo 9→4).

## 의사결정 로그

- 결정(제작자, 2026-11-15 대화): 이 계획의 위험도는 `risk: normal`이다. 기록: [Issue #57 댓글](https://github.com/ariawell-hub/harness_project/issues/57#issuecomment-6887304907), 완료 계획 `docs/exec-plans/completed/20261115-cross-review/plan.md`의 의사결정 로그. / 이유: 구축 단계에서는 보호 경로도 자동 병합하고, 인증을 직접 다루는 일만 PR마다 사람이 본다.
- 결정(제작자, 2026-11-16 대화): 계획을 둘로 나눈다. 보안·권한 step은 새 Issue #102의 `risk: high` 계획(`20261116-ops-security`)으로 옮겨 PR마다 제작자 head 승인을 받고, 나머지는 이 계획(`risk: normal`)에 남겨 자동 병합한다. 제작자는 "STEP에서의 AI 작업 진행해 병목이 생기는 사항을 줄일 필요가 있다"고 덧붙였다. / 이유: 절차서 1절("기준에 해당하는 일과 아닌 일은 계획을 나눈다")과 계획 검증 프롬프트의 위험도 기준(PR #101 원장 F1). 앞의 `normal` 결정은 보안·권한 일을 뺀 이 계획에 그대로 적용된다. / 버린 대안: 계획 전체를 high로(PR 11개 모두 승인. 2026-11-15에 "#53에서 겪은 부담"으로 버린 방식), normal 유지와 재반박(검증 기준이 그대로라 교착).
- 결정: 병목을 줄이기 위해 두 계획을 병행한다. 보안 계획의 PR이 제작자 승인을 기다리는 동안 이 계획의 step을 진행한다. 이 계획의 step0~3은 보안 계획과 무관하게 시작할 수 있게 짰다(revert 표식은 양쪽이 같은 모듈 `scripts/lib/revert-marker.ts`를 쓰고 먼저 병합되는 쪽이 만든다). step4만 보안 계획 step0~4를 기다린다. 제작자 작업(테스트 리포 준비)은 step4 전에 미리 요청해 대기 시간을 겹친다. / 이유: 한 계획 안의 step은 순서대로 병합돼야 다음으로 간다. 계획이 둘이면 한쪽이 승인 대기일 때 다른 쪽이 나아간다. / 버린 대안: 보안 계획이 끝난 뒤 이 계획 시작(승인 대기 동안 멈춘다).
- 결정(제작자, 2026-11-16 대화): 체크리스트 5는 새 빈 비공개 리포에 전체 구성(5개 environment, 두 App, 필수 체크)으로 확인한다. / 이유: 체크리스트 문구 그대로이고 새 프로젝트 도입 절차(16절)의 첫 실제 검증이 된다. runner 무인 시범(TD-38)도 여기서 한다. / 버린 대안: 보관한 q20-lab 재사용, revert·runner만 축소 시험.
- 결정: 자체 테스트는 두 층으로 둔다. LLM 없는 시나리오(가짜 에이전트·가짜 GitHub·훅 프로세스 직접 호출)는 CI와 `harness-guard`에 연결하고(연결은 보안 계획 step3), 실제 세션 시나리오(`--live`)는 손으로 실행해 통과율만 기록한다. / 이유: PR 코드를 실행하는 job에는 구독 인증을 둘 수 없다(10.4절). 실제 세션은 실행마다 달라 병합 판정에 쓸 수 없다(12.4절). / 버린 대안: CI에서 실제 세션 실행.

## 발견 사항

- 이 Windows PC는 개발자 모드가 꺼져 있어 심볼릭 링크를 만들 수 없고, 파일 이름에 `:`·`*`를 쓸 수 없고, POSIX 권한 비트가 없다(#99). 이 계획에서 새로 쓰는 테스트·시나리오도 같은 제약을 지켜야 로컬 `check`가 통과한다(디렉터리 링크는 `'junction'`, 셸 명령에 넣는 경로는 `/`, 전체 `check`는 약 13분). → 처리: TD-14

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- 계획 복원·자체 테스트는 임시 git 리포, 가짜 GitHub(`HARNESS_FAKE_GH`), 가짜 에이전트로 끝까지 돌린다.
- step4는 실제 GitHub 결과를 `lab/ops-transition/results/`에 남기고 `node lab/ops-transition/report.ts --all`로 확인한다.

## 다음 할 일

- 나눈 계획을 계획만 담은 커밋으로 push해 PR #101에서 계획 검증(G1)을 다시 받는다. 승인 뒤 step0(plan-restore)부터 구현한다.
- 제작자 작업(한 번에 모아 요청, 절차는 보안 계획 step4에서 `docs/SECURITY.md`에 적는다):
  1. step4 전: 새 비공개 테스트 리포 생성, 봇 초대(Write), 보호 설정·environment 5개·App 설치, 제작자 계정으로 시험 Issue 2건.
  2. 보안 계획(#102)의 제작자 작업은 그 계획의 "다음 할 일"에 있다.
