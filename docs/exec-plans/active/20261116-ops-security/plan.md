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

## 발견 사항

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- revert는 임시 git 리포, 가짜 GitHub(`HARNESS_FAKE_GH`)으로 끝까지 돌린다. `--live`는 이 머신에서 한 번 실행해 통과율을 진행 로그에 적는다.
- `pull_request_target`·`workflow_run`으로 도는 변경(step0·1·3)은 병합된 뒤에야 실제로 돈다. 병합 뒤 다음 PR에서 처음 동작을 확인해 진행 로그에 남기고, 전체는 step6의 테스트 리포에서 확인한다.
- step6·step7은 실제 GitHub 결과를 `lab/ops-transition/results/`에 남기고 `node lab/ops-transition/report.ts --all`과 `node scripts/harness.ts ops-check`로 확인한다.

## 다음 할 일

- 계획만 담은 커밋을 push하고 초안 PR로 계획 검증(G1)을 받는다. 승인 뒤 step0 구현을 올리고 `pr-ready`로 제작자 승인을 요청한다.
- 이 계획의 PR은 모두 위험도 높음이다. 초안으로 올리고, 완료 처리·기록·main 병합·`check`가 끝난 뒤 `pr-ready`로 한 번만 승인을 요청한다.
- 제작자 작업(한 번에 모아 요청, 절차는 step4에서 `docs/SECURITY.md`에 적는다):
  1. PR마다: head 승인(step0~7, 8회).
  2. step0 병합 뒤: 하네스 리포 main의 필수 체크에 `revert-check`(출처 `harness-recorder`) 등록.
  3. step1 병합 전후: 하네스 리포에 `revert` environment(main 전용)와 시크릿 `REVERT_BOT_TOKEN`(봇 PAT).
  4. step6 전: 새 비공개 테스트 리포 생성, 봇 초대(Write), 보호 설정·environment 5개·App 설치, 제작자 계정으로 시험 Issue 2건.
  5. step7 전: 하네스 리포의 코드 오너 리뷰 필수 설정, 봇 PAT를 `workflow` 권한 없이 재발급, 에이전트가 조작하는 브라우저 프로필의 GitHub 로그아웃 확인.
