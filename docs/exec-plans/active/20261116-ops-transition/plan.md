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

# chore: 2단계⑤ revert·하네스 자체 테스트·운영 전환 — revert-check, 12.4 시나리오, 운영 전환 체크리스트

## 목표와 수용 기준

로드맵 2단계의 마지막 Issue다. ①~④(#53~#56)로 기계 판정, 교차 검증, 지적 원장, runner 연결이 끝났다. 남은 것은 병합 후 main CI 실패의 자동 복구(revert), 하네스를 바꿀 때 규칙이 깨지지 않았는지 보는 자체 테스트(설계서 12.4절), 그리고 구축 단계에서 운영 단계로 넘어가는 전환(10.4절 체크리스트, Q7)이다. 이 계획이 끝나면 `harness.config.json`의 `stage`가 `operation`이고, 보호 경로 변경은 제작자 승인 없이 병합되지 않는다.

수용 기준:

1. **revert-check**: 브랜치 이름이 `revert/<대상 커밋 40자 SHA>`인 PR을 LLM 없이 판정한다. 다음을 모두 만족할 때만 "확인됨"이다. (a) 대상이 base 브랜치의 first-parent 이력에 있는 부모 하나짜리 커밋이다. (b) PR의 변경(merge-base → head)이 대상 커밋의 역방향 변경(대상 → 대상의 부모)과 파일·모드·blob 단위로 같다. (c) 대상 커밋의 main `check`(GitHub Actions App의 check run) 최신 결론이 실패다. 확인된 revert PR은 계획 없이 `plan-gate`를 통과하고 `review/claude`·`review/codex`는 판정 없이 "해당 없음(통과)"으로 기록된다. `risk-gate`·`deps-guard`·`harness-guard`의 신호는 그대로 적용된다. `revert/` 브랜치인데 확인되지 않으면 `revert-check`는 실패다. 그 밖의 PR에는 "revert PR 아님"(success)을 쓴다.
2. **revert 워크플로**: main의 `check`가 실패로 끝나면(push 이벤트) 한 번 다시 실행하고, 다시 실패하면 `revert` environment의 봇 토큰으로 `revert/<SHA>` 브랜치·PR을 만들어 자동 병합을 켜고 원래 Issue를 다시 열어 알린다. 자동으로 되돌리지 않고 `needs-human`으로 넘기는 경우: 원래 PR을 찾지 못함, 대상이 revert PR의 병합 커밋임, 계획 `risk: high`이거나 경로 표의 높음 경로가 든 변경(마이그레이션·데이터·배포), `git revert` 충돌, push 거부. 같은 대상에 PR·브랜치가 이미 있으면 아무것도 하지 않는다.
3. **계획 복원**: revert로 main에서 계획 파일이 빠진 Issue를 `new-task --issue <N>`으로 다시 시작하면, 새 골격 대신 revert 대상 커밋에 있던 계획을 같은 id로 `active/`에 복원하고 되돌려진 step을 `pending`으로 둔다. 닫혔다 다시 열린 Issue의 남은 step은 `new-task --plan <id> --step <N>`으로 선점부터 다시 할 수 있다.
4. **자체 테스트 시나리오**: `node scripts/harness.ts self-test [--harness <폴더>]`가 임시 샘플 리포에 대상 하네스를 적용해 12.4절의 기본 시나리오를 LLM 없이 실행하고 종료 코드로 결과를 낸다. 시나리오: S1(선점되지 않은 다음 작업 찾기), R1(계획 없는 변경이 `plan-gate`에서 막힘), R4(`.skip`·`--no-verify`가 막힘), R13(금지 DB 명령이 L1에서 종료 코드 2), R20(제작자 권한 명령이 L1에서 종료 코드 2), 9.2절(3회 방법 전환·5회 중단 보고), 4.5절(runner가 step 여러 개·Issue 여러 개를 개입 없이 처리, 세션 시간 초과·`blocked`에서 다음 할 일로 넘어감, "완료"라 했지만 AC 실패면 완료로 보지 않음), 전체 흐름(선점 → 계획 → PR → 검증 승인 → 계획 완료 커밋 → 자동 병합, 결속 기준에 맞는 PR만 승인 이어받기). 시나리오는 대상 하네스의 CLI와 훅 프로세스만 부른다(내부 함수를 import하지 않는다).
5. **실제 세션 시나리오**: `self-test --live`가 실제 `claude -p` 세션으로 S1·R13·R20을 여러 번 실행해 시나리오별 통과율을 낸다. 판정 기준값은 정하지 않고 결과만 기록한다(12.4절: 기준은 파일럿에서 정한다).
6. **harness-guard 연결**: 보호 경로를 바꾼 PR에서 `gates` 워크플로의 `selftest` job이 main의 시나리오를 PR의 하네스에 대해 실행하고, 기록 job이 결과를 `harness-guard` 상태에 합친다. 자체 테스트가 실패했거나 결과가 없으면 `harness-guard`는 success가 아니다(fail-closed). `selftest` job에는 environment·비밀·쓰기 권한이 없고 `harness-guard`가 이를 검사한다. 기존 `scripts/selftest/` 파일을 고치거나 지운 PR은 신호(위험도 높음)다.
7. **MCP 훅(TD-13)**: 대화 세션의 MCP 도구 호출(`mcp__*`)이 L1 훅을 거친다. 삭제 계열 도구와 메일 발송 도구(R14), 브라우저 자동화 도구의 GitHub 접근(R20)을 종료 코드 2로 막고, 그 밖의 MCP 도구(읽기·검색·작성·브라우저 조작과 캡처)는 막지 않는다. 브라우저 안에서 클릭으로 GitHub에 닿는 경로는 훅이 볼 수 없으므로 E5 절차(에이전트가 조작하는 브라우저 프로필에 제작자 GitHub 로그인을 두지 않는다)로 문서에 명시한다.
8. **CODEOWNERS와 전환 점검 명령**: `.github/CODEOWNERS`가 `harness.config.json`의 `protectedPaths`에서 생성되고, 어긋나면 `check`가 실패한다. `node scripts/harness.ts ops-check`가 운영 전환 체크리스트 1~3(필수 체크 등록·출처, CODEOWNERS, 봇 토큰의 `workflow` 권한 회수)을 읽기만으로 확인해 종료 코드로 알린다. `ci.requiredChecks`에 `revert-check`를 넣는다.
9. **테스트 리포 확인(체크리스트 5)**: 새 빈 비공개 테스트 리포에 하네스를 적용해 아래를 실제 GitHub에서 확인하고 `lab/ops-transition/results/`에 기대·관찰·판정·근거로 남긴다. 필수 항목: 자체 테스트 통과, runner 무인 실행으로 선점 → 계획 검증 → PR → 교차 검증 → 계획 완료 커밋 → 자동 병합, main 병합 갱신 뒤 승인 이어받기, main 실패 → 재실행 → revert PR → `revert-check` → 자동 병합 → Issue 재오픈 → 계획 복원, 여분 변경이 든 `revert/` PR의 차단, 보호 경로 PR의 `selftest` job, 코드 오너 리뷰 설정에서 보호 경로 PR은 제작자 승인 없이 병합되지 않고 보호 경로 밖 PR은 자동 병합됨, `workflow` 권한 없는 봇 토큰의 워크플로 push 거부. `node lab/ops-transition/report.ts --all`이 필수 항목의 기록 완결과 `pass` 판정을 확인한다.
10. **운영 전환(체크리스트 1~7)**: 하네스 리포에서 `ops-check`가 통과하고, 시험 PR로 세 가지를 확인한다(보호 경로를 바꾸는 PR은 제작자 승인 없이 병합되지 않는다, 봇의 워크플로 파일 push는 거부된다, 보호 경로 밖 위험도 낮음 PR은 사람 승인 없이 자동 병합된다). 그 결과를 본문에 적은 PR로 `stage`를 `operation`으로 바꾼다.
11. **문서**: 설계서(0.2·10.3·10.4·12.4·13.1·14절·19절, 버전·변경 이력), 절차서, 코드 구조 문서, `SECURITY.md`(제작자 절차), `CHANGELOG`를 고치고, TD-1·TD-13·TD-38을 결과에 맞게 갱신한다.

## 범위 / 비범위

- 범위: `scripts/gates/`(revert-check, harness-guard, CODEOWNERS), `scripts/ci/`(기계 판정 묶음, 결과 형식, 검증자 계산, revert), `scripts/commands/`(계획 복원, `ops-check`), `scripts/selftest/`(새 폴더), `scripts/hooks/`(MCP 규칙), `scripts/lib/`, `scripts/harness.ts`, `scripts/test/`, `.github/workflows/`(`gates.yml`, `judge-*.yml`의 읽기 권한, 새 `revert.yml`), `.github/CODEOWNERS`, `.claude/settings.json`(훅 matcher), `harness.config.json`(`ci.requiredChecks`, `guard`, `stage`), `lab/ops-transition/`, 문서.
- 비범위:
  - 제작자만 할 수 있는 설정은 봇이 하지 않는다(R20): 테스트 리포 생성·보호 설정·environment·App 설치, `revert` environment와 시크릿, 필수 체크 등록, 코드 오너 리뷰 필수 설정, 봇 토큰 재발급. 절차와 확인 방법을 문서로 주고 한 번에 모아 요청한다.
  - 판정 job의 프롬프트·스키마(`scripts/cross-review/`), 원장 형식, runner의 PR 흐름(#56)은 바꾸지 않는다. 테스트 리포에서 결함이 드러나면 새 step을 더해 고친다.
  - revert PR의 `risk-gate`·`deps-guard` 면제. 운영 단계에서 보호 경로를 되돌리는 revert PR은 제작자 승인이 필요하다.
  - Codex 실제 세션의 자체 테스트(`--live --tool codex`)와 Codex 훅의 MCP 규칙. Codex 훅은 실제 세션 검증이 안 됐다(TD-8).
  - 자체 테스트의 주간 정기 실행과 통과율 기준(4단계, TD-11), R5 실효성 검사(TD-4), `pr-size`·`scope`(TD-6).
  - MCP 도구의 공유·초대(Drive 공유, 캘린더 초대)처럼 발송에 가까운 동작의 전수 차단. 기본 규칙은 삭제 계열과 메일 발송만 막고 나머지는 설정으로 더한다.
  - 파일럿(3단계) 자체와 지표 수집(17.2절).

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
- docs/exec-plans/active/20261116-ops-transition/

## step 목록

- step0 revert-check: `revert/<SHA>` PR의 정확한 역적용 판정(순수 함수), 기계 판정·검증자 계산 연결, 워크플로의 check run 읽기 권한
- step1 revert-workflow: main `check` 실패 → 재실행 1회 → revert PR·자동 병합·Issue 재오픈, 자동으로 되돌리지 않는 경우의 에스컬레이션
- step2 plan-restore: revert된 계획을 `new-task`가 복원, 다시 열린 Issue의 재선점
- step3 selftest-core: 자체 테스트 실행기와 샘플 리포, 시나리오 S1·R1·R4·R13·R20, `self-test` 명령
- step4 selftest-runner: 시나리오 9.2절·4.5절·전체 흐름(가짜 에이전트·가짜 GitHub)
- step5 selftest-live: `self-test --live`(실제 `claude -p` 세션의 S1·R13·R20, 통과율)
- step6 selftest-guard: `gates`의 `selftest` job, 기록 job이 `harness-guard`에 합치기, `harness-guard` 규칙
- step7 mcp-guard: MCP 도구 호출의 L1 규칙(삭제·발송·브라우저의 GitHub 접근), E5 문서, TD-13
- step8 ops-check: CODEOWNERS 생성·검사, `ops-check` 명령, `ci.requiredChecks`에 `revert-check`, 제작자 절차 문서
- step9 test-repo: 새 테스트 리포에서 전체 흐름·revert·설정 확인, 결과 기록(`lab/ops-transition/`)
- step10 operation: 하네스 리포 시험 PR 확인, `stage: operation` 전환, 문서·TD 정리

## 진행 로그

- 2026-11-16 step0: 계획 작성. 제작자 대화 지시("현재 프로젝트 진행 상황 검토하고 #57을 진행해달라")로 시작. 위험도는 제작자 결정(2026-11-15, Issue #57 댓글)에 따라 `normal`이다. 계획 작성 중 제작자에게 두 가지를 물어 답을 받았다(의사결정 로그).
- 2026-11-16 step0: 계획만 담은 커밋을 올리기 전 로컬 `check`가 이 Windows PC(Node 24)에서 계획과 무관한 테스트 실패로 통과하지 않았다. 절차서 5절에 따라 Issue #99로 먼저 고쳤다(PR #100 병합: CLI 자연 종료, POSIX 환경을 가정한 테스트 6개). main(`5177010`)을 받아 온 뒤 이 계획을 올린다.
- 2026-11-16 step0: 계획 검증 1라운드(PR #101, head `a2b35b7`). `review/claude` 승인(P2 2건), `review/codex` 수정 요청(F1, P1: 권한·보안이 든 계획인데 `risk`가 normal이다). F1 반박: 위험도 normal은 제작자 결정이다(근거 `docs/exec-plans/completed/20261115-cross-review/plan.md:120`). P2 두 건을 반영했다: 위험도 결정의 기록 위치를 의사결정 로그에 적었고, step8 작업 2에서 `ops-check` 2번이 보증하는 범위(CODEOWNERS 파일)와 리포 설정의 근거(시험 PR)를 나눠 적었다.

## 의사결정 로그

- 결정(제작자, 2026-11-15 대화): 이 계획의 위험도는 `risk: normal`이다. 기록: [Issue #57 댓글](https://github.com/ariawell-hub/harness_project/issues/57#issuecomment-6887304907), 완료 계획 `docs/exec-plans/completed/20261115-cross-review/plan.md`의 의사결정 로그("#55·#56·#57의 계획은 `risk: normal`로 만든다. … `harness-guard`가 검사 약화·권한 완화 신호를 잡았거나 경로 표가 높음인 PR만 승인을 요구한다"). / 이유: 구축 단계에서는 보호 경로도 자동 병합하고, 인증을 직접 다루는 #54만 PR마다 사람이 본다. 이 계획에서 훅·판정 설정·`stage`를 바꾸는 step7·8·10의 PR은 신호로 높음이 되어 제작자 head 승인을 받는다. 시크릿과 environment 값은 제작자만 넣는다(R20). / 버린 대안: 계획 전체를 높음으로 올리기(위험도는 제작자가 정한 값이라 봇이 바꾸지 않는다. PR #101 원장 F1에 반박했다).
- 결정(제작자, 2026-11-16 대화): TD-13은 MCP를 막지 않고 규칙을 더한다. 제작자는 Gmail·Drive·Notion 등의 데이터를 "삭제는 안 하는 선에서 적극 활용"하고, Chrome 브라우저의 직접 조종·캡처·분석도 필요하다고 답했다. / 이유: 대화 세션의 MCP 활용이 제작자의 작업 방식이다. / 버린 대안: 허용 목록 방식(기본 차단), 절차로만 두기.
- 결정: MCP 규칙은 삭제 계열(도구 이름의 단어)과 메일 발송(R14 "외부 발송"), 브라우저 자동화 도구 입력의 GitHub 주소(R20)만 막는다. / 이유: 제작자 답의 선("삭제는 안 한다")과 이미 있는 절대 규칙(R14, R20)을 합친 최소 규칙이다. 메일 초안 작성은 막지 않는다. / 버린 대안: 발송까지 열기(R14를 바꾸는 일이라 제작자 지시가 따로 필요하다), 공유·초대까지 기본 차단(제작자가 바란 적극 활용을 좁힌다. 설정으로 더할 수 있게 둔다).
- 결정(제작자, 2026-11-16 대화): 체크리스트 5는 새 빈 비공개 리포에 전체 구성(5개 environment, 두 App, 필수 체크)으로 확인한다. / 이유: 체크리스트 문구 그대로이고 새 프로젝트 도입 절차(16절)의 첫 실제 검증이 된다. runner 무인 시범(TD-38)도 여기서 한다. / 버린 대안: 보관한 q20-lab 재사용, revert·runner만 축소 시험.
- 결정: revert-check의 "정확한 역적용"은 patch-id가 아니라 `git diff --raw`(경로·모드·blob SHA)의 일치로 본다. / 이유: patch-id는 공백과 줄 위치를 무시한다(10.3절 승인 이어받기에서 바이트 비교를 따로 둔 이유와 같다). raw 비교는 "base의 내용이 대상과 같고 head의 내용이 대상의 부모와 같다"를 파일 단위로 정확히 말한다. main이 대상 뒤로 나아갔어도 겹치지 않으면 성립한다. / 버린 대안: patch-id 비교.
- 결정: revert-check는 대상 커밋의 main `check` 실패를 조건으로 둔다. / 이유: 조건이 없으면 봇 토큰을 가진 에이전트가 main의 아무 커밋이나 `revert/<SHA>` PR로 LLM 검증 없이 되돌릴 수 있다. 실패 근거는 GitHub Actions App의 check run이라 봇 PAT로 만들 수 없다. / 버린 대안: 조건 없이 역적용만 확인하기.
- 결정: 확인된 revert PR이 면제받는 것은 `plan-gate`의 계획 요구와 `review/*` 판정, `harness-guard`의 작성자 체크리스트(`CHANGELOG`·PR 본문 줄)뿐이다. `risk-gate`와 `harness-guard` 신호, `deps-guard`는 그대로다. / 이유: 설계서 10.3절은 "통과하면 `review/*`를 대신한다"까지만 정한다. 훅·권한을 더한 커밋을 되돌리는 revert는 완화 신호가 되어 제작자 승인으로 간다. / 버린 대안: 모든 기계 판정 면제.
- 결정: revert 워크플로는 첫 실패에서 되돌리지 않고 한 번 다시 실행한다. / 이유: 최신 브랜치 필수라 병합 결과 트리는 `check`를 통과한 PR head와 같다. 병합 후 main 실패는 흔들리는 테스트나 시간 의존(격리 만료, 의존성 게시 기간)일 가능성이 크고, 절차서 5절도 한 번 재실행을 정한다. / 버린 대안: 첫 실패에서 바로 revert.
- 결정: 재실행과 revert push·PR·Issue 조작은 모두 `revert` environment의 봇 토큰으로 한다. 워크플로의 `GITHUB_TOKEN`에는 쓰기 권한을 주지 않는다. / 이유: `GITHUB_TOKEN`으로 만든 PR은 `check`를 일으키지 않고, 리포 설정상 Actions는 PR을 만들 수 없다(0.2절). 쓰기 권한을 한 자격증명에 모은다. / 버린 대안: 재실행만 `actions: write`로 하기.
- 결정: `ci.requiredChecks`에 `revert-check`를 넣는 설정 변경은 step0이 아니라 step8에서 한다. / 이유: `harness.config.json`의 `ci` 변경은 `harness-guard` 신호(위험도 높음)다. 판정 관련 설정 변경을 step8 하나에 모아 제작자 승인 횟수를 줄인다. 그 사이 `revert-check` 상태는 기록되지만 로컬 분류(`pr-state`)는 보지 않는다. / 버린 대안: step0에서 함께 바꾸기.
- 결정: 자체 테스트는 두 층으로 둔다. LLM 없는 시나리오(가짜 에이전트·가짜 GitHub·훅 프로세스 직접 호출)는 CI와 `harness-guard`에 연결하고, 실제 세션 시나리오(`--live`)는 손으로 실행해 통과율만 기록한다. / 이유: PR 코드를 실행하는 job에는 구독 인증을 둘 수 없다(10.4절). 실제 세션은 실행마다 달라 병합 판정에 쓸 수 없다(12.4절). / 버린 대안: CI에서 실제 세션 실행.
- 결정: `selftest` job은 main의 시나리오(`base/scripts/selftest/`)를 PR의 하네스(`pr/`)에 대해 실행한다. 시나리오가 요구하는 동작을 바꾸려면 먼저 시나리오를 고치는 PR(신호, 위험도 높음)을 병합한다. / 이유: PR이 자기 시나리오를 함께 약화시키지 못한다. / 버린 대안: PR의 시나리오를 실행하기.
- 결정: `selftest` job은 `gates` 워크플로(`pull_request_target`) 안에 두고 재현 job과 같은 조건(비밀·environment·쓰기 권한 없음, 캐시 없음)으로 PR 코드를 실행한다. / 이유: `harness-guard` 상태를 쓰는 기록 job이 같은 워크플로에 있어 결과를 합치기 쉽다. PR 코드 실행은 판정 워크플로의 재현 job이 이미 같은 조건으로 한다. 결과는 PR 코드가 조작할 수 있으므로 회귀를 잡는 용도이고, 악의적 약화는 검증자와 제작자 승인이 맡는다(한계로 문서에 적는다). / 버린 대안: PR 쪽 정의인 `check` 워크플로에서만 실행하기(시나리오 정의가 PR 것이 된다).
- 결정: 체크리스트 6의 "위험도 낮음 PR"은 이 계획의 PR로는 만들 수 없어(계획 위험도 보통) 봇이 #57의 일부로 Issue를 등록해 소규모 계획(위험도 낮음, 보호 경로 밖 `lab/ops-transition/results/`만 변경)으로 올린다. / 이유: 체크리스트 문구를 그대로 지킨다. / 버린 대안: 보통 위험도 PR로 갈음하기.

## 발견 사항

- 이 Windows PC는 개발자 모드가 꺼져 있어 심볼릭 링크를 만들 수 없고, 파일 이름에 `:`·`*`를 쓸 수 없고, POSIX 권한 비트가 없다(#99). 이 계획에서 새로 쓰는 테스트·시나리오도 같은 제약을 지켜야 로컬 `check`가 통과한다(디렉터리 링크는 `'junction'`, 셸 명령에 넣는 경로는 `/`, 전체 `check`는 약 13분). → 처리: TD-14

## 열린 질문

없음.

## 검증 방법과 결과

- step마다 AC 명령(해당 테스트 파일)과 `node scripts/harness.ts check`.
- revert·자체 테스트·계획 복원은 임시 git 리포, 가짜 GitHub(`HARNESS_FAKE_GH`), 가짜 에이전트로 끝까지 돌린다.
- `pull_request_target`·`workflow_run`으로 도는 변경(step0·1·6)은 병합된 뒤에야 실제로 돈다. 병합 뒤 다음 PR에서 처음 동작을 확인해 진행 로그에 남기고, 전체는 step9의 테스트 리포에서 확인한다.
- step9·step10은 실제 GitHub 결과를 `lab/ops-transition/results/`에 남기고 `node lab/ops-transition/report.ts --all`과 `node scripts/harness.ts ops-check`로 확인한다.

## 다음 할 일

- 계획만 담은 커밋을 push하고 초안 PR로 계획 검증(G1)을 받는다. 승인 뒤 step0부터 구현한다.
- 제작자 작업(한 번에 모아 요청, 절차는 step8에서 `docs/SECURITY.md`에 적는다):
  1. step0 병합 뒤: 하네스 리포 main의 필수 체크에 `revert-check`(출처 `harness-recorder`) 등록.
  2. step1 병합 전후: 하네스 리포에 `revert` environment(main 전용)와 시크릿 `REVERT_BOT_TOKEN`(봇 PAT).
  3. step9 전: 새 비공개 테스트 리포 생성, 봇 초대(Write), 보호 설정·environment 5개·App 설치, 제작자 계정으로 시험 Issue 2건.
  4. step10 전: 하네스 리포의 코드 오너 리뷰 필수 설정, 봇 PAT를 `workflow` 권한 없이 재발급, 에이전트가 조작하는 브라우저 프로필의 GitHub 로그아웃 확인.
  5. 위험도 높음으로 올라가는 PR(step7·step8·step10)의 head 승인.
