---
id: 20261116-ops-security
issue: 102 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-16T12:38:57+09:00 # new-task가 채운다
---

# chore: 2단계⑤ 보안·권한 — revert 게이트·워크플로, MCP 훅, 자체 테스트 연결, 운영 전환 (#57에서 분리)

## 목표와 수용 기준

로드맵 2단계의 마지막 묶음(#57) 가운데 보안·권한에 해당하는 일이다. #57 계획의 계획 검증(PR #101)에서 "보안·권한 작업이 든 계획은 `risk: high`여야 한다"는 지적이 나와, 제작자 결정으로 계획을 둘로 나눴다(절차서 1절). 이 계획은 병합 후 main CI 실패의 자동 복구(revert 게이트와 워크플로), 대화 세션의 MCP 도구 규칙(TD-13), 자체 테스트를 `harness-guard`에 연결하는 일, 구축 단계에서 운영 단계로 넘어가는 전환(10.4절 체크리스트, Q7)을 맡는다. 이 계획이 끝나면 `harness.config.json`의 `stage`가 `operation`이고, 보호 경로 변경은 제작자 승인 없이 병합되지 않는다. 실제 세션으로 규칙을 시험하는 `self-test --live`와 새 테스트 리포에서의 전체 확인(보호 설정·봇 권한의 실제 동작)도 이 계획이 맡는다. 계획 복원과 LLM 없는 자체 테스트 시나리오는 #57 계획(`20261116-ops-transition`, `risk: normal`)이 맡는다.

수용 기준:

1. **revert-check**: 브랜치 이름이 `revert/<대상 커밋 40자 SHA>`인 PR을 LLM 없이 판정한다. 다음을 모두 만족할 때만 "확인됨"이다. (a) 대상이 base 브랜치의 first-parent 이력에 있는 부모 하나짜리 커밋이다. (b) PR의 변경(merge-base → head)이 대상 커밋의 역방향 변경(대상 → 대상의 부모)과 파일·모드·blob 단위로 같다. (c) 대상 커밋의 main `check`(GitHub Actions App의 check run) 최신 결론이 실패다. 확인된 revert PR은 계획 없이 `plan-gate`를 통과하고 `review/claude`·`review/codex`는 판정 없이 "해당 없음(통과)"으로 기록된다. `risk-gate`·`deps-guard`·`harness-guard`의 신호는 그대로 적용된다. `revert/` 브랜치인데 확인되지 않으면 `revert-check`는 실패다. 그 밖의 PR에는 "revert PR 아님"(success)을 쓴다.
2. **revert 워크플로**: main의 `check`가 실패로 끝나면(push 이벤트) 한 번 다시 실행하고, 다시 실패하면 `revert` environment의 봇 토큰으로 `revert/<SHA>` 브랜치·PR을 만들어 자동 병합을 켜고 원래 Issue를 다시 열어 알린다. 자동으로 되돌리지 않고 `needs-human`으로 넘기는 경우: 원래 PR을 찾지 못함, 대상이 revert PR의 병합 커밋임, 계획 `risk: high`이거나 경로 표의 높음 경로가 든 변경(마이그레이션·데이터·배포), `git revert` 충돌, push 거부. 같은 대상에 PR·브랜치가 이미 있으면 아무것도 하지 않는다.
3. **MCP 훅(TD-13)**: 대화 세션의 MCP 도구 호출(`mcp__*`)이 L1 훅을 거친다. 삭제 계열 도구와 메일 발송 도구(R14), 브라우저 자동화 도구의 GitHub 접근(R20)을 종료 코드 2로 막고, 그 밖의 MCP 도구(읽기·검색·작성·브라우저 조작과 캡처)는 막지 않는다. 브라우저 안에서 클릭으로 GitHub에 닿는 경로는 훅이 볼 수 없으므로 E5 절차(에이전트가 조작하는 브라우저 프로필에 제작자 GitHub 로그인을 두지 않는다)로 문서에 명시한다.
4. **harness-guard 연결**: 보호 경로를 바꾼 PR에서 `gates` 워크플로의 `selftest` job이 main의 시나리오를 PR의 하네스에 대해 실행하고, 기록 job이 결과를 `harness-guard` 상태에 합친다. 자체 테스트가 실패했거나 결과가 없으면 `harness-guard`는 success가 아니다(fail-closed). `selftest` job에는 environment·비밀·쓰기 권한이 없고 `harness-guard`가 이를 검사한다. 기존 `scripts/selftest/` 파일을 고치거나 지운 PR은 신호(위험도 높음)다.
5. **실제 세션 시나리오**: `self-test --live`가 실제 `claude -p` 세션으로 S1·R13·R20을 여러 번 실행해 시나리오별 통과율을 낸다. 판정 기준값은 정하지 않고 결과만 기록한다(12.4절: 기준은 파일럿에서 정한다).
6. **CODEOWNERS와 전환 점검 명령**: `.github/CODEOWNERS`가 `harness.config.json`의 `protectedPaths`에서 생성되고, 어긋나면 `check`가 실패한다. `node scripts/harness.ts ops-check`가 운영 전환 체크리스트 1~3(필수 체크 등록·출처, CODEOWNERS, 봇 토큰의 `workflow` 권한 회수)을 읽기만으로 확인해 종료 코드로 알린다. `ci.requiredChecks`에 `revert-check`를 넣는다.
7. **테스트 리포 확인(체크리스트 5)**: 새 빈 비공개 테스트 리포에 하네스를 적용해 아래를 실제 GitHub에서 확인하고 `lab/ops-transition/results/`에 기대·관찰·판정·근거로 남긴다. 필수 항목: 자체 테스트 통과, runner 무인 실행으로 선점 → 계획 검증 → PR → 교차 검증 → 계획 완료 커밋 → 자동 병합, main 병합 갱신 뒤 승인 이어받기, main 실패 → 재실행 → revert PR → `revert-check` → 자동 병합 → Issue 재오픈 → 계획 복원, 여분 변경이 든 `revert/` PR의 차단, 보호 경로 PR의 `selftest` job, 코드 오너 리뷰 설정에서 보호 경로 PR은 제작자 승인 없이 병합되지 않고 보호 경로 밖 PR은 자동 병합됨, `workflow` 권한 없는 봇 토큰의 워크플로 push 거부. `node lab/ops-transition/report.ts --all`이 필수 항목의 기록 완결과 `pass` 판정을 확인한다. 이 step은 step0~5와 #57 계획의 step0~2가 병합된 뒤에 한다.
8. **운영 전환(체크리스트 1~7)**: 하네스 리포에서 `ops-check`가 통과하고, 시험 PR로 세 가지를 확인한다(보호 경로를 바꾸는 PR은 제작자 승인 없이 병합되지 않는다, 봇의 워크플로 파일 push는 거부된다, 보호 경로 밖 위험도 낮음 PR은 사람 승인 없이 자동 병합된다). 체크리스트 5(테스트 리포 확인)는 step6의 결과(`node lab/ops-transition/report.ts --all`)로 확인한다. 그 결과를 본문에 적은 PR로 `stage`를 `operation`으로 바꾼다.
9. **문서**: 설계서(0.2·10.3·10.4·12.4·13.1·14절·16절·19절, 버전·변경 이력), 절차서, 코드 구조 문서, `SECURITY.md`(제작자 절차), `CHANGELOG`를 고치고, TD-1·TD-13·TD-38을 결과에 맞게 갱신한다.

## 범위 / 비범위

- 범위: `scripts/gates/`(revert-check, harness-guard, CODEOWNERS), `scripts/ci/`(기계 판정 묶음, 결과 형식, 검증자 계산, revert, 자체 테스트 결과 합치기), `scripts/commands/`(`ops-check`), `scripts/hooks/`(MCP 규칙), `scripts/lib/`, `scripts/selftest/`(MCP 시나리오 추가, `--live` 실행기와 실제 세션 시나리오), `scripts/harness.ts`, `scripts/test/`, `.github/workflows/`(`gates.yml`, `judge-*.yml`의 읽기 권한, 새 `revert.yml`), `.github/CODEOWNERS`, `.claude/settings.json`(훅 matcher), `harness.config.json`(`ci.requiredChecks`, `guard`, `stage`), `lab/ops-transition/`(결과 틀, 테스트 리포와 하네스 리포의 시험 결과), 문서.
- 비범위:
  - #57 계획이 맡는 것: 계획 복원(`new-task`), 자체 테스트 실행기와 LLM 없는 시나리오(`scripts/selftest/`의 실행기·기본 시나리오·가짜 에이전트).
  - 제작자만 할 수 있는 설정은 봇이 하지 않는다(R20): 테스트 리포 생성·보호 설정·environment·App 설치, `revert` environment와 시크릿, 필수 체크 등록, 코드 오너 리뷰 필수 설정, 봇 토큰 재발급. 절차와 확인 방법을 문서로 주고 한 번에 모아 요청한다.
  - 판정 job의 프롬프트·스키마(`scripts/cross-review/`), 원장 형식, runner의 PR 흐름(#56)은 바꾸지 않는다.
  - revert PR의 `risk-gate`·`deps-guard` 면제. 운영 단계에서 보호 경로를 되돌리는 revert PR은 제작자 승인이 필요하다.
  - Codex 훅의 MCP 규칙과 Codex 실제 세션의 자체 테스트(`--live --tool codex`). Codex 훅은 실제 세션 검증이 안 됐다(TD-8).
  - 자체 테스트의 주간 정기 실행과 통과율 기준(4단계, TD-11).
  - MCP 도구의 공유·초대(Drive 공유, 캘린더 초대)처럼 발송에 가까운 동작의 전수 차단. 기본 규칙은 삭제 계열과 메일 발송만 막고 나머지는 설정으로 더한다.
  - 파일럿(3단계) 자체와 지표 수집(17.2절), R5 실효성 검사(TD-4), `pr-size`·`scope`(TD-6).

## 관련 파일·문서

- scripts/gates/
- scripts/ci/
- scripts/commands/
- scripts/hooks/
- scripts/lib/
- scripts/runner/
- scripts/selftest/
- scripts/test/
- scripts/harness.ts
- .github/workflows/
- .github/CODEOWNERS
- .github/pull_request_template.md
- .claude/settings.json
- harness.config.json
- profiles/
- lab/ops-transition/
- AGENTS.md
- CLAUDE.md
- ARCHITECTURE.md
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/SECURITY.md
- docs/decisions/
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261116-ops-security/

## step 목록

- step0 revert-check: `revert/<SHA>` PR의 정확한 역적용 판정(순수 함수), 기계 판정·검증자 계산 연결, 워크플로의 check run 읽기 권한
- step1 revert-workflow: main `check` 실패 → 재실행 1회 → revert PR·자동 병합·Issue 재오픈, 자동으로 되돌리지 않는 경우의 에스컬레이션
- step2 mcp-guard: MCP 도구 호출의 L1 규칙(삭제·발송·브라우저의 GitHub 접근), E5 문서, TD-13 (선행: #57 계획 step1)
- step3 selftest-guard: `gates`의 `selftest` job, 기록 job이 `harness-guard`에 합치기, `harness-guard` 규칙 (선행: #57 계획 step1·step2)
- step4 ops-check: CODEOWNERS 생성·검사, `ops-check` 명령, `ci.requiredChecks`에 `revert-check`, 제작자 절차 문서
- step5 selftest-live: `self-test --live`(실제 `claude -p` 세션의 S1·R13·R20, 통과율) (선행: #57 계획 step1)
- step6 test-repo: 새 테스트 리포에서 전체 흐름·revert·설정 확인, 결과 기록(`lab/ops-transition/`) (선행: #57 계획 step0~2)
- step7 operation: 하네스 리포 시험 PR 확인, `stage: operation` 전환, 문서·TD 정리

## 진행 로그

- 2026-11-16 step0: 계획 작성. #57 계획(`20261116-ops-transition`)의 step 11개 가운데 보안·권한에 해당하는 6개를 이 계획으로 옮겼다(제작자 결정, 의사결정 로그). 봇이 Issue #102를 등록했다. step0(revert-check)의 구현 초안은 나누기 전에 #57 worktree에서 써 두었고(push하지 않았다), 이 계획의 계획 검증 승인 뒤에 이 브랜치에 올린다.
- 2026-11-16 step0: 계획 검증 1라운드(PR #103, head `076b8fd`, step 6개)에서 두 검증자가 승인했다(`review/claude` P2 2건). 같은 때 #57 계획(PR #101)의 3라운드에서 `review/codex`가 "실제 GitHub 테스트, 보호 설정·봇 권한 동작 확인, `self-test --live`가 든 계획은 high여야 한다"며 F1을 닫지 않았다. 그 두 step(selftest-live, test-repo)을 이 계획으로 옮겨 step5·step6에 넣고 operation을 step7로 바꿨다(step0~4의 번호와 내용은 그대로다). P2 두 건도 반영했다: step2의 선행 설명(`self-test` 명령은 #57 계획 step1이 만든다), step4 `ops-check` 3번이 보증하는 범위(이 머신의 토큰. `revert` 시크릿 교체는 제작자 확인).
- 2026-11-16 step0: 계획 검증 2라운드(head `ba644d9`, step 8개)에서 두 검증자가 승인했다(G1). `review/claude`의 P2 4건(원장 F3~F6)은 모두 step6·step7의 내용이라 미뤘고, 그 step을 시작할 때 반영한다: 자기 PR에 자기 결과를 적는 `low-risk-auto-merge` 사례의 순환(F3), 봇 PAT 재발급 시점(F4), `workflow` 권한 회수 뒤 PR 갱신 push 사례(F5), `docs/index.md`(F6).
- 2026-11-16 step0: 구현. `scripts/gates/revert-check.ts`(`revertTarget`, `revertCheck`)와 `scripts/ci/revert-evidence.ts`(`targetCheckOf`)를 만들고 기계 판정 묶음(`gates`)·검증자 계산(`review-plan`)·`harness-guard`(`skipAuthorChecks`)에 연결했다. `gates`·`judge-*` 워크플로의 해당 job에 `checks: read`를 더했다(대상 커밋의 `check` 결과 조회). 테스트 `scripts/test/revert-check.test.ts`(13개)와 `gates.test.ts` 1개. AC 명령과 이 PC의 전체 `check`가 종료 코드 0이었다(`test` 약 13분). `pull_request_target`으로 도는 변경이라 병합 뒤 다음 PR에서 `revert-check` 상태("해당 없음")가 기록되는지 확인한다.
- 2026-11-16 step0: 코드 판정(head `3f43d66`)에서 두 검증자가 승인했다(지적 없음). 승인을 요청하기 전에 #57 계획의 step0(PR #101, 설계서 v0.7.43)이 먼저 병합됐다. 두 PR이 설계서 변경 이력·`CHANGELOG`·코드 구조 문서 표의 같은 자리를 고쳐 충돌했고(TD-39), `origin/main`을 병합해 풀었다: main의 줄을 앞에 두고 이 PR의 줄은 v0.7.44로 올렸다. 코드는 충돌하지 않았다. 병합한 트리에서 전체 `check`를 다시 돌린 뒤 승인을 요청한다.
- 2026-11-16 step0: PR #103이 제작자 head 승인(`05ccfcd`)으로 병합됐다(main `5ac523a`).
- 2026-11-16 step1: 구현. `scripts/ci/revert.ts`(`decideRevert`, `planRevert`·`sourcePrOf`·`irreversible`, `actRevert`, `parseRevertAction`), `scripts/harness.ts`의 `revert-plan`·`revert-act`, `GitHubPort.rerunFailed`(가짜 GitHub은 `reruns`에 기록), `.github/workflows/revert.yml`(`plan`: 읽기만, `act`: `revert` environment). `harness-guard`는 바꾸지 않았다(`revert.yml`이 실패·신호 없이 통과한다). 테스트 `scripts/test/revert.test.ts` 12개와 `harness-guard.test.ts` 1개. 문서: 설계서 v0.7.46(10.3절, 10.4절 표), `docs/SECURITY.md` 자격증명 표, 절차서 1절, 코드 구조 문서, `CHANGELOG`.
- 2026-11-16 step1: step0의 `revert-check` 상태가 그 뒤의 PR(#104)에서 "revert PR 아님"(success)으로 기록되는 것을 확인했다. 필수 체크 등록은 step4에서 요청한다.
- 2026-11-16 step1: PR을 올리기 전에 #57 계획의 step1(PR #104, 설계서 v0.7.45)이 먼저 병합돼 `origin/main`(`34ad3c1`)을 병합해 받았다. 충돌은 문서 두 곳(설계서 버전 줄·변경 이력, `CHANGELOG`)이었고 main의 v0.7.45 줄 뒤에 이 PR의 v0.7.46 줄을 뒀다(TD-39). 코드는 자동 병합됐고(`scripts/harness.ts`의 `self-test`와 `revert-plan`·`revert-act`), 병합한 트리에서 전체 `check`를 다시 돌렸다.
- 2026-11-16 step1: PR #105 판정 1라운드(head `545214e`). `review/claude` 승인(F1, P2: `revert-act`가 재실행할 실행 번호와 `--run-url`을 대조하지 않는다). `review/codex` 수정 요청(F2, P1: 원래 PR을 찾지 못하면 `needs-human` 없이 워크플로가 오류로 끝난다. 수용 기준 2와 다르다). 둘 다 고쳤다: 알릴 Issue도 PR도 없으면 봇이 새 Issue를 만들어 `needs-human`을 붙이고(`GitHubPort.createIssue`, 같은 대상은 한 번만), `revert-act`는 재실행 번호가 `--run-url`의 실행과 다르면 종료 코드 1이다. 설계서 10.3절과 `CHANGELOG`를 맞췄다.
- 2026-11-16 step1: PR #105 판정 2라운드(head `48a97bc`)에서 두 검증자가 승인했다. `review/codex`의 P2 한 건(원장 F3: 닫힌 에스컬레이션 Issue는 중복 생성 방지에 쓰이지 않는다)은 미뤘고 step2에서 고치지 않기로 정했다(의사결정 로그). 제작자 head 승인으로 병합됐다(main `decf237`).
- 2026-11-16 step1: 제작자 작업 확인. `revert` environment가 있고(배포 브랜치 `main`만) 시크릿 `REVERT_BOT_TOKEN`이 등록됐다(2026-11-16T08:04:16Z, `gh api repos/…/environments/revert/secrets`로 이름만 확인). 워크플로의 실제 동작(재실행, revert PR)은 step6의 테스트 리포에서 확인한다.
- 2026-11-16 step2: 구현. 설정 `guard.mcp`(`scripts/lib/config.ts`의 `McpGuardConfig`·`DEFAULT_MCP_GUARD`·`resolveMcpGuard`, `harness.config.json`, 프로파일 core·web), `scripts/hooks/guard.ts`(`normalize`의 `kind: 'mcp'`, 메인 체크아웃의 `guard.mcp` 읽기, 설정 오류 메시지), `scripts/hooks/rules.ts`(`evaluateMcp`), `.claude/settings.json`의 PreToolUse matcher에 `mcp__.*`, 자체 테스트 시나리오 `mcp-guard`. 테스트: `guard.test.ts` 8개, `lib.test.ts` 3개, `selftest.test.ts` 1개(약화된 사본 둘). 문서: 설계서 v0.7.48(0.1절 E5, 5.1절 R14·R20, 10.4절 체크리스트 3번, 12.4절 표, 13.1절, 13.2절), `docs/SECURITY.md`("에이전트용 브라우저 프로필 (제작자)", 강제 장치 표), `CLAUDE.md`, 코드 구조 문서, `CHANGELOG`, TD-13. step2의 AC 명령 4개가 종료 코드 0이었다.
- 2026-11-16 step2: 이 Windows PC의 전체 `check`가 `test` 단계의 시간 제한(900초)에 걸렸다. #57 계획 step2(PR #106)의 트리에 main을 병합해 돌린 `check`가 두 번 연속 `test (900.6s)`로 실패했고(두 번째는 다른 작업 없이 실행), 같은 트리의 전체 테스트를 제한 없이 돌리니 951초에 실패 0건이었다(파일 40개, 파일별 합계 4516초. 긴 파일: `runner-review` 650초, `runner-pr` 588초, `runner` 536초, `selftest` 408초, `runner-plan-review` 390초). 이 PR에 `commands.test.timeoutSec` 900 → 1800을 함께 넣는다(의사결정 로그). PR #106은 이 PR이 병합된 뒤 main을 받아 다시 검사한다.
- 2026-11-16 step2: PR #107 판정 1라운드(head `655bf33`)에서 두 검증자가 승인했다. `review/claude`의 P2 한 건(원장 F1: 금지 호스트 탐색이 표의 마침표 `。` 같은 유니코드 구분자를 정규화하지 않아 `https://github。com`이 통과한다)을 승인 요청 전에 고쳤다: 호스트를 찾기 전에 NFKC로 맞추고 U+3002·U+FF61을 `.`으로 바꾼다. 테스트 4건을 더했다.

## 의사결정 로그

- 결정(제작자, 2026-11-16 대화): #57 계획을 둘로 나눈다. 보안·권한 step은 이 계획(`risk: high`, Issue #102)으로 옮겨 PR마다 제작자 head 승인을 받고, 나머지는 #57의 `risk: normal` 계획에 남겨 자동 병합한다. 제작자는 "STEP에서의 AI 작업 진행해 병목이 생기는 사항을 줄일 필요가 있다"고 덧붙였다. / 이유: 절차서 1절("기준에 해당하는 일과 아닌 일은 계획을 나눈다")과 계획 검증 프롬프트의 위험도 기준. PR #101 원장 F1. / 버린 대안: 계획 전체를 high로(PR 11개 모두 승인), normal 유지와 재반박(검증 기준이 그대로라 교착).
- 결정: 병목을 줄이기 위해 두 계획을 병행한다. 이 계획의 PR이 제작자 승인을 기다리는 동안 #57 계획의 step을 진행하고, 승인 요청은 PR마다 한 번, 제작자 작업은 "다음 할 일"의 묶음으로 미리 알린다. 선행 조건이 있는 step(step2·3·5·6)은 #57 계획의 해당 step이 병합된 뒤에 시작한다. / 이유: 한 계획 안의 step은 순서대로 병합돼야 다음으로 간다. 계획이 둘이면 한쪽이 승인 대기일 때 다른 쪽이 나아간다. / 버린 대안: 승인 대기 동안 멈추기.
- 결정: `self-test --live`와 테스트 리포 확인(test-repo)도 이 계획에 둔다. / 이유: 두 step은 실제 자격증명이 있는 환경에서 보호 설정·봇 권한·금지 규칙의 실제 동작을 확인한다. 계획 검증 기준은 이런 일을 보안·권한 작업으로 본다(PR #101 원장 F1의 3라운드 답). 둘 다 대화 세션과 제작자 작업이 필요한 step이라 승인이 더해져도 대기가 늘지 않는다. / 버린 대안: #57 계획에 두고 재반박(같은 지적에 두 번째 반박이라 받아들여지지 않으면 교착이다).
- 결정: 실제 세션 시나리오(`--live`)는 손으로 실행해 통과율만 기록하고 병합 판정과 `check`에 쓰지 않는다. / 이유: 구독 인증이 필요하고 실행마다 결과가 달라진다(12.4절, 10.4절). LLM 없는 시나리오 층은 #57 계획이 만든다. / 버린 대안: CI에서 실제 세션 실행(자격증명이 PR 코드와 같은 job에 놓인다).
- 결정(제작자, 2026-11-16 대화): 체크리스트 5는 새 빈 비공개 리포에 전체 구성(5개 environment, 두 App, 필수 체크)으로 확인한다. / 이유: 체크리스트 문구 그대로이고 새 프로젝트 도입 절차(16절)의 첫 실제 검증이 된다. runner 무인 시범(TD-38)도 여기서 한다. / 버린 대안: 보관한 q20-lab 재사용, revert·runner만 축소 시험.
- 결정(제작자, 2026-11-16 대화): TD-13은 MCP를 막지 않고 규칙을 더한다. 제작자는 Gmail·Drive·Notion 등의 데이터를 "삭제는 안 하는 선에서 적극 활용"하고, Chrome 브라우저의 직접 조종·캡처·분석도 필요하다고 답했다. 같은 날 "MCP 같은 외부 프로그램은 AI가 적극 활용했으면 좋겠다"고 다시 밝혔다. / 이유: 대화 세션의 MCP 활용이 제작자의 작업 방식이다. / 버린 대안: 허용 목록 방식(기본 차단), 절차로만 두기.
- 결정: MCP 규칙은 삭제 계열(도구 이름의 단어)과 메일 발송(R14 "외부 발송"), 브라우저 자동화 도구 입력의 GitHub 주소(R20)만 막는다. / 이유: 제작자 답의 선("삭제는 안 한다")과 이미 있는 절대 규칙(R14, R20)을 합친 최소 규칙이다. 메일 초안 작성은 막지 않는다. / 버린 대안: 발송까지 열기(R14를 바꾸는 일이라 제작자 지시가 따로 필요하다), 공유·초대까지 기본 차단(제작자가 바란 적극 활용을 좁힌다. 설정으로 더할 수 있게 둔다).
- 결정: revert-check의 "정확한 역적용"은 patch-id가 아니라 `git diff --raw`(경로·모드·blob SHA)의 일치로 본다. / 이유: patch-id는 공백과 줄 위치를 무시한다(10.3절 승인 이어받기에서 바이트 비교를 따로 둔 이유와 같다). raw 비교는 "base의 내용이 대상과 같고 head의 내용이 대상의 부모와 같다"를 파일 단위로 정확히 말한다. main이 대상 뒤로 나아갔어도 겹치지 않으면 성립한다. / 버린 대안: patch-id 비교.
- 결정: revert-check는 대상 커밋의 main `check` 실패를 조건으로 둔다. / 이유: 조건이 없으면 봇 토큰을 가진 에이전트가 main의 아무 커밋이나 `revert/<SHA>` PR로 LLM 검증 없이 되돌릴 수 있다. 실패 근거는 GitHub Actions App의 check run이라 봇 PAT로 만들 수 없다. / 버린 대안: 조건 없이 역적용만 확인하기.
- 결정: 확인된 revert PR이 면제받는 것은 `plan-gate`의 계획 요구와 `review/*` 판정, `harness-guard`의 작성자 체크리스트(`CHANGELOG`·PR 본문 줄)뿐이다. `risk-gate`와 `harness-guard` 신호, `deps-guard`는 그대로다. / 이유: 설계서 10.3절은 "통과하면 `review/*`를 대신한다"까지만 정한다. 훅·권한을 더한 커밋을 되돌리는 revert는 완화 신호가 되어 제작자 승인으로 간다. / 버린 대안: 모든 기계 판정 면제.
- 결정: revert 워크플로는 첫 실패에서 되돌리지 않고 한 번 다시 실행한다. / 이유: 최신 브랜치 필수라 병합 결과 트리는 `check`를 통과한 PR head와 같다. 병합 후 main 실패는 흔들리는 테스트나 시간 의존(격리 만료, 의존성 게시 기간)일 가능성이 크고, 절차서 5절도 한 번 재실행을 정한다. / 버린 대안: 첫 실패에서 바로 revert.
- 결정: 재실행과 revert push·PR·Issue 조작은 모두 `revert` environment의 봇 토큰으로 한다. 워크플로의 `GITHUB_TOKEN`에는 쓰기 권한을 주지 않는다. / 이유: `GITHUB_TOKEN`으로 만든 PR은 `check`를 일으키지 않고, 리포 설정상 Actions는 PR을 만들 수 없다(0.2절). 쓰기 권한을 한 자격증명에 모은다. / 버린 대안: 재실행만 `actions: write`로 하기.
- 결정: `ci.requiredChecks`에 `revert-check`를 넣는 설정 변경은 step0이 아니라 step4에서 한다. / 이유: 판정 관련 설정 변경과 그에 따른 제작자 작업(필수 체크 등록 확인)을 step4 하나에 모은다. 그 사이 `revert-check` 상태는 기록되지만 로컬 분류(`pr-state`)는 보지 않는다. / 버린 대안: step0에서 함께 바꾸기.
- 결정: `selftest` job은 main의 시나리오(`base/scripts/selftest/`)를 PR의 하네스(`pr/`)에 대해 실행한다. 시나리오가 요구하는 동작을 바꾸려면 먼저 시나리오를 고치는 PR(신호, 위험도 높음)을 병합한다. / 이유: PR이 자기 시나리오를 함께 약화시키지 못한다. / 버린 대안: PR의 시나리오를 실행하기.
- 결정: `selftest` job은 `gates` 워크플로(`pull_request_target`) 안에 두고 재현 job과 같은 조건(비밀·environment·쓰기 권한 없음, 캐시 없음)으로 PR 코드를 실행한다. / 이유: `harness-guard` 상태를 쓰는 기록 job이 같은 워크플로에 있어 결과를 합치기 쉽다. PR 코드 실행은 판정 워크플로의 재현 job이 이미 같은 조건으로 한다. 결과는 PR 코드가 조작할 수 있으므로 회귀를 잡는 용도이고, 악의적 약화는 검증자와 제작자 승인이 맡는다(한계로 문서에 적는다). / 버린 대안: PR 쪽 정의인 `check` 워크플로에서만 실행하기(시나리오 정의가 PR 것이 된다).
- 결정: 체크리스트 6의 "위험도 낮음 PR"은 이 계획의 PR로는 만들 수 없어(계획 위험도 높음) 봇이 #102의 일부로 Issue를 등록해 소규모 계획(위험도 낮음, 보호 경로 밖 `lab/ops-transition/results/`만 변경)으로 올린다. / 이유: 체크리스트 문구를 그대로 지킨다. / 버린 대안: 다른 위험도의 PR로 갈음하기.
- 결정(step1): `git revert`는 main 체크아웃이 아니라 임시 worktree(`origin/<기본 브랜치>`의 detached HEAD)에서 하고 `HEAD:refs/heads/revert/<대상>`으로 일반 push한다. / 이유: main 체크아웃의 브랜치와 작업 트리를 바꾸지 않는다(R3의 취지). 충돌하면 `git revert --abort` 뒤 worktree만 지우면 된다. / 버린 대안: main 체크아웃에서 브랜치를 바꿔 되돌리기.
- 결정(step1): step 파일의 `RevertAction`에서 `escalate`에 `target`(실패한 커밋)을 더했다. / 이유: "같은 표식의 댓글이 마지막이면 다시 달지 않는다"의 표식(`<!-- harness-revert-escalate target=<SHA> -->`)을 대상 단위로 만들려면 실행 job이 대상을 알아야 한다. 이유 문구로 표식을 만들면 충돌·push 거부처럼 이유가 달라질 때마다 다시 알린다.
- 결정(step1): 알릴 Issue도 PR도 없는 에스컬레이션(대상 커밋을 병합한 PR을 찾지 못함)은 `revert-act`를 종료 코드 1로 끝낸다. / 이유: 댓글을 달 곳이 없다. 실패한 워크플로 실행이 제작자에게 가는 알림이다. / 버린 대안: 새 Issue 만들기(포트에 Issue 생성이 없고, 원인 커밋이 PR 없이 main에 들어온 드문 경우다).
- 결정(step1, 판정 1라운드 F2로 위 결정을 바꾼다): 알릴 Issue도 PR도 없는 에스컬레이션은 봇이 새 Issue(제목 `main check 실패: <SHA 12자>…`, 본문에 제작자 멘션·이유·실패한 커밋·실행 링크·표식)를 만들고 `needs-human`을 붙인다. 같은 표식의 봇 Issue가 열려 있으면 다시 만들지 않는다. / 이유: 수용 기준 2가 "원래 PR을 찾지 못함"을 `needs-human`으로 넘기는 경우로 적었다. 실패한 워크플로 실행만으로는 `start`의 needs-human 목록에 뜨지 않는다. 봇이 만든 Issue는 설정(`github.botIssues: exclude`)에 따라 runner의 작업 대상이 되지 않는다. / 버린 대안: 종료 코드 1로만 알리기(위 결정).
- 결정(step1): 결정 job의 "이미 있는가"는 PR 조회(API)와 체크아웃의 원격 추적 브랜치로 본다. 실행 job은 push 직전에 `git ls-remote`와 PR 조회로 다시 본다. / 이유: 결정 job에는 git 인증을 두지 않는다(`persist-credentials: false`). 비공개 리포에서 `ls-remote`를 쓸 수 없다.
- 결정(step1): Issue 댓글의 "이어 가는 명령"은 대상의 부모 커밋에 그 계획이 있는지로 고른다. 없으면(첫 PR이 되돌려짐) `new-task --issue <N>`(계획 복원), 있으면 `new-task --plan <id> --step <N>`. / 이유: #57 계획 step0의 복원 조건("main에 그 계획이 없다")과 같은 기준이다.
- 결정(step1): 워크플로의 동시 실행 그룹은 워크플로 전체 하나가 아니라 실패한 커밋 단위(`revert-<head_sha>`, `cancel-in-progress: false`)로 둔다. step 파일은 "워크플로 단위 하나씩"이라고 적었다. / 이유: `workflow_run`은 PR의 `check`가 끝날 때도 이 워크플로의 실행을 만든다(job은 건너뛴다). GitHub은 같은 그룹의 대기 실행을 하나만 두고 새 실행이 오면 앞의 대기를 취소하므로, 그룹이 하나면 대기 중인 main 실패 처리가 PR의 실행에 밀려 사라질 수 있다. 커밋 단위 그룹은 step 파일의 목적(같은 대상의 처리가 겹치지 않는다)을 지키고, 다른 커밋의 실행과는 서로 막지 않는다(대상별 브랜치가 달라 독립이다). / 버린 대안: 워크플로 전체 하나.
- 결정(step2): `allowTools`는 삭제·발송 규칙의 예외로만 쓰고 브라우저 도구의 GitHub 주소 규칙(R20)은 풀지 않는다. / 이유: step 파일의 판정 순서 1번은 "allowTools에 맞으면 통과"이고 설정 주석은 "위 두 규칙의 예외"다. 좁은 쪽을 골랐다. `mcp__claude-in-chrome__*` 같은 넓은 예외 하나로 R20이 풀리지 않는다. GitHub 접근을 열려면 `browserTools`·`denyHosts`를 고쳐야 하고 그 변경은 설정 diff에 그대로 드러난다. / 버린 대안: allowTools에 맞으면 모든 규칙 통과.
- 결정(step2): 훅은 `guard.mcp`를 세션의 worktree가 아니라 메인 체크아웃의 `harness.config.json`에서 읽는다. / 이유: MCP 규칙이 지키는 것(메일·문서, 브라우저의 GitHub 세션)은 리포 밖에 있어 PR이 병합되기 전의 설정 변경으로 풀리면 안 된다. 훅 코드도 메인 체크아웃(`$CLAUDE_PROJECT_DIR`)의 것이 돈다. / 버린 대안: `dbPatterns`처럼 현재 worktree의 설정 읽기.
- 결정(step2): 금지 호스트는 URL 파싱이 아니라 문자열을 호스트 이름 글자의 덩어리로 나눠 찾는다(`github.com/o/r`, 이스케이프된 `https:\/\/github.com`, %인코딩 한 번 풀기 포함). 검색어나 경로에 `github.com`이 든 브라우저 입력도 막힌다. / 이유: 브라우저 도구의 입력은 주소 칸, 입력할 글자, 실행할 JS 코드처럼 형식이 제각각이다. 못 찾아서 통과시키는 것보다 넓게 막는 쪽이 R20에 맞다. 정규식 되짚기가 없어 긴 입력에도 길이에 비례한다. / 버린 대안: `new URL()`로 읽히는 값만 보기.
- 결정(step2): 해석하지 못한 MCP 호출(입력이 객체가 아님, 브라우저 입력이 깊이 16·문자열 합계 200만 자를 넘음)과 형식이 틀린 `guard.mcp`는 MCP 호출만 막는다. 셸·파일 도구의 판정은 그대로다. / 이유: 13.1절 "판단하지 못하면 막는다". 설정이 틀렸다고 모든 도구를 막으면 설정을 고치는 작업도 못 한다. / 버린 대안: 설정이 틀리면 모든 도구 차단.
- 결정(step2): `mcp-guard` 시나리오는 훅 호출과 함께 샘플의 `.claude/settings.json` matcher가 `mcp__` 도구를 훅에 거는지도 확인한다. / 이유: 규칙이 있어도 matcher가 없으면 훅이 불리지 않는다. 설정 파일 형식은 대상 하네스의 내부 모듈이 아니라 Claude Code의 형식이라 "CLI·훅의 입출력에만 기댄다"(12.4절)와 어긋나지 않는다.
- 결정(step2): PR #105 원장 F3(P2, 닫힌 에스컬레이션 Issue는 중복 생성 방지에 쓰이지 않는다)은 고치지 않는다. / 이유: 닫힌 Issue는 제작자가 처리를 끝냈다는 뜻이다. 같은 커밋의 `check`가 그 뒤에 다시 실패하면 새로 알리는 것이 맞다. 열린 Issue가 있는 동안의 중복만 막는다. / 버린 대안: 닫힌 Issue도 찾아 다시 열기(제작자가 닫은 Issue를 봇이 되살린다).
- 결정(step2): 기본 `denyHosts`에 step 파일의 `github.com`·`*.github.com`에 더해 `github.dev`·`*.github.dev`를 넣었다. / 이유: 웹 편집기(`github.dev`)는 브라우저의 GitHub 로그인 세션으로 리포에 커밋한다. R20이 막으려는 것과 같은 경로이고, 정상 작업에서 열 일이 없는 주소라 넓혀도 잃는 것이 없다. / 버린 대안: step 파일의 두 값만 두기.
- 결정(step2): 이 PR에 `commands.test.timeoutSec` 900 → 1800(`harness.config.json`, 프로파일 core)을 함께 넣는다. step 파일에 없는 변경이다. / 이유: 이 PC에서 전체 테스트가 951초 걸려 `check`가 통과하지 못한다(실패하는 테스트는 없다). 통과하지 못하면 이 PR도 #57의 PR #106도 push할 수 없다. 시간 제한은 멈춘 명령을 끊는 장치이고 판정 기준이 아니어서, 올려도 검사가 약해지지 않는다(테스트는 모두 그대로 돈다). GitHub Actions의 `check`는 6분 안팎이라 영향이 없다. `commands` 변경은 `harness-guard` 신호라 제작자 head 승인이 필요한데, 이 PR은 이미 위험도 높음이다. / 버린 대안: 별도 Issue로 올리기(지시 없는 Issue를 봇이 만들 수 없고 승인이 한 번 더 든다), 테스트 파일을 나누거나 줄이기(파일별 합계가 4516초라 나누는 것으로는 100초 넘게 줄지 않는다. 느린 원인을 줄이는 일은 TD-40에 남긴다), PR #106에 넣기(위험도 보통 계획에 판정 관련 설정 변경을 넣게 된다).

## 발견 사항

- revert 워크플로는 main의 스크립트로 돈다. 실패한 커밋이 `scripts/harness.ts`나 revert 코드 자체를 깨뜨렸으면 결정 job이 실패해 자동으로 되돌리지 못한다(실패한 실행으로만 드러난다). step6의 테스트 리포에서 이 경우 제작자가 손으로 되돌리는 절차를 확인해 `docs/SECURITY.md`에 적는다. → 처리: #102
- 실패한 커밋 A 위에 다른 PR의 커밋 B가 병합돼 B의 `check`도 A 때문에 실패하면, 워크플로는 B도 되돌리려 한다(대상별로 독립해서 판단한다). 최신 브랜치 필수라 B의 PR head는 A를 포함한 채 `check`를 통과했어야 하므로 흔들리는 실패에서만 생긴다. step6의 revert 사례에서 실제 순서를 확인한다. → 처리: #102
- 기본 `denyWords`의 `cancel`은 삭제가 아닌 도구도 막는다(예: Figma `weave_cancel_tool_run`은 실행 중인 작업을 멈출 뿐이다). `*.github.com`은 공개 문서(`docs.github.com`)를 브라우저로 여는 것도 막는다. step 파일의 기본값 그대로 두었다. 필요해지면 제작자가 `guard.mcp.allowTools`에 더하거나 `denyHosts`를 좁힌다(보호 경로라 PR과 승인이 필요하다). → 처리: TD-13
- 이름이 규칙에 걸리지 않는 변경 도구는 통과한다: Drive `update_file`(덮어쓰기)·`share_file`, Notion `notion-move-pages`·`notion-update-page`, Calendar `respond_to_event`·`update_event`, Gmail `mark_message_spam`. 제작자 결정의 선(삭제만 금지)과 의사결정 로그("공유·초대는 설정으로 더할 수 있게 둔다")에 따른 것이다. 막으려면 `denyTools`에 더한다. → 처리: TD-13
- Codex의 훅 설정(`.codex/hooks.json`)은 matcher가 `.*`라 MCP 호출이 훅에 올 수 있지만, Codex가 넘기는 도구 이름이 `mcp__…` 꼴인지는 확인하지 않았다. 다른 꼴이면 `evaluateMcp`를 타지 않는다. → 처리: TD-8

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- revert는 임시 git 리포, 가짜 GitHub(`HARNESS_FAKE_GH`)으로 끝까지 돌린다. `--live`는 이 머신에서 한 번 실행해 통과율을 진행 로그에 적는다.
- `pull_request_target`·`workflow_run`으로 도는 변경(step0·1·3)은 병합된 뒤에야 실제로 돈다. 병합 뒤 다음 PR에서 처음 동작을 확인해 진행 로그에 남기고, 전체는 step6의 테스트 리포에서 확인한다.
- step6·step7은 실제 GitHub 결과를 `lab/ops-transition/results/`에 남기고 `node lab/ops-transition/report.ts --all`과 `node scripts/harness.ts ops-check`로 확인한다.

## 다음 할 일

- step2(PR 병합) 뒤 step3(selftest-guard)을 시작한다. 선행: #57 계획 step2(PR #106)의 병합.
- 이 계획의 PR은 모두 위험도 높음이다. 초안으로 올리고, 완료 처리·기록·main 병합·`check`가 끝난 뒤 `pr-ready`로 한 번만 승인을 요청한다.
- 제작자 작업(한 번에 모아 요청, 절차는 step4에서 `docs/SECURITY.md`에 적는다):
  1. PR마다: head 승인(step0~7, 8회).
  2. step0 병합 뒤: 하네스 리포 main의 필수 체크에 `revert-check`(출처 `harness-recorder`) 등록.
  3. (끝남, 2026-11-16) 하네스 리포에 `revert` environment(main 전용)와 시크릿 `REVERT_BOT_TOKEN`(봇 PAT).
  4. step6 전: 새 비공개 테스트 리포 생성, 봇 초대(Write), 보호 설정·environment 5개·App 설치, 제작자 계정으로 시험 Issue 2건.
  5. step7 전: 하네스 리포의 코드 오너 리뷰 필수 설정, 봇 PAT를 `workflow` 권한 없이 재발급, 에이전트가 조작하는 브라우저 프로필의 GitHub 로그아웃 확인(절차: `docs/SECURITY.md` "에이전트용 브라우저 프로필 (제작자)").
