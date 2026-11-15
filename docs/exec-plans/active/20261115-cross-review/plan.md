---
id: 20261115-cross-review
issue: 54 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-15T10:10:42+09:00 # new-task가 채운다
---

# feat: 2단계② 교차 검증 판정 job — Claude·Codex 판정, review/*, 승인 결속 (TD-1)

## 목표와 수용 기준

로드맵 2단계의 둘째 Issue다. PR 병합 판단에 쓰는 교차 검증(R12)을 CI에서 실행하고, 결과를 작성자가 만들 수 없는 경로(검증 App)로 `review/claude`·`review/codex`에 기록한다. 판정 job 규칙은 Q20 시험으로 확인한 설계서 10.4·13.3절을 그대로 따른다.

수용 기준:

1. 판정은 `check`가 통과한 커밋에서만 실행된다(R16). `check` 워크플로 완료(`workflow_run`, main 정의)로 시작하고, 판정할 PR은 페이로드가 아니라 head SHA로 API를 다시 조회해 정한다. 포크 PR과 `check` 실패 커밋에는 실행하지 않는다.
2. 위험도와 작성 도구로 필요한 검증자를 정한다(10.1절): 낮음은 다른 도구 1명, 보통·높음은 A + B. 실행하지 않은 검증자의 상태는 기록 job이 "해당 없음(통과)"으로 기록한다.
3. Claude 판정 job(`judge-claude` environment): `base/`(github.sha)의 프롬프트·스크립트만 실행, `pr/`는 심볼릭 링크 없이 데이터로 읽기, `claude -p --restricted --strict-mcp-config --tools Read,Grep,Glob --permission-mode dontAsk --json-schema`, 같은 job의 LLM 없는 유출 검사(토큰 원문·조각·인코딩, `pr/` 밖 도구 호출, 허용 밖 도구)를 통과해야만 판정을 낸다. 실행 오류·한도는 판정 없이 실패(fail closed).
4. Codex 판정(`judge-codex` environment) + 인증 저장(`codex-auth-store` environment): 공개키 조회 → 인증 복원(0600, `RUNNER_TEMP`) → 권한 프로필 설정(읽기 거부 목록, `pr/` 조상 거부 금지) → 샌드박스 사전 측정(기대와 다르면 판정 없이 실패) → `codex exec --json --ephemeral` → 유출 검사 → `auth.json` 봉인 → 저장 job이 풀지 않고 등록(공개키 id 일치 때만). 봉인·저장은 판정이 실패해도 실행한다. 워크플로 단위 concurrency(`cancel-in-progress: false`, `queue: max`).
5. 기록 job(`recorder` environment)이 판정을 스키마(값·길이)와 시크릿 스캔으로 검사한 뒤 `review/claude`·`review/codex`를 기록한다. 판정이 승인이고 차단 지적(P0·P1)이 없을 때만 success다. 판정이 없거나 깨졌으면 `error`.
6. 승인 결속(10.3절): 승인 상태에 merge-base 대비 diff의 `git patch-id --stable`을 남기고, main 병합 갱신 뒤 patch-id가 같고 위험도가 낮음·보통이며 그사이 main에서 바뀐 파일이 PR이 바꾼 파일과 겹치지 않으면 LLM 없이 새 head로 승인을 옮긴다. 위험도 높음은 다시 검증한다.
7. 실제 PR에서 두 검증자의 판정과 기록(작성자 = 검증 App), 해당 없음 기록, 승인 이어받기를 확인해 진행 로그에 남긴다. Codex 실행 중 인증 갱신이 일어나면 재저장을 확인한다(TD-1 비고. 일어나지 않으면 미확인으로 남긴다).
8. 제작자가 `review/claude`·`review/codex`를 검증 App 출처의 필수 체크로 등록하고 `required-checks`가 통과한다.

## 범위 / 비범위

- 범위: `scripts/cross-review/`(프롬프트·스키마), `scripts/ci/`(검증자 계획, 판정 검사·유출 검사, Codex 인증·설정, 승인 결속, 기록), `harness.ts` 명령, `.github/workflows/judge-claude.yml`·`judge-codex.yml`, 설정(`ci`), 문서.
- 비범위: 지적 원장·라운드 규칙·반박·재현 job·G1(#55), runner의 지적 대응(#56), revert(#57), 로컬 사전 점검용 `cross-review` 명령(필요가 생기면 TD).

## 관련 파일·문서

- scripts/cross-review/
- scripts/ci/
- scripts/gates/
- scripts/lib/
- scripts/harness.ts
- scripts/test/
- .github/workflows/
- harness.config.json
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/SECURITY.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261115-cross-review/

## step 목록

- step0 verdict-core: 판정 스키마·프롬프트, 판정 검사와 시크릿 스캔, 검증자 계획(위험도 × 작성 도구), `review/*` 기록
- step1 judge-claude: Claude 판정 워크플로와 실행 기록 유출 검사
- step2 judge-codex: Codex 판정 워크플로, 인증 복원·봉인·저장, 샌드박스 설정과 사전 측정
- step3 approval-binding: patch-id 결속과 승인 이어받기, 필수 체크 등록, 문서 정리

## 진행 로그

- 2026-11-15: 계획 작성(대화 세션). 제작자가 `judge-claude`(시크릿 `CLAUDE_CODE_OAUTH_TOKEN`), `judge-codex`(시크릿 `CODEX_AUTH_JSON`), `codex-auth-store`(변수 `STORE_APP_CLIENT_ID`, 시크릿 `STORE_APP_KEY`) environment를 준비했다. 셋 다 `main`만 허용임을 봇 API로 확인했다. Q20 소스(커밋 7b837e7의 `lab/q20/repo/`)를 읽었다.
- 2026-11-15 step0: `scripts/test/verdict.test.ts`를 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND`) → 스키마·프롬프트, `scripts/ci/{verdict,review-plan}.ts`, `recordReview`, `record-review` 명령 구현 뒤 `verdict`·`ci` 테스트 24개 통과.
- 2026-11-15 step0: 첫 `check`가 secret-scan에서 실패했다(테스트의 가짜 토큰 리터럴이 실제 토큰 형식으로 검출). 실패한 채 `complete-step`까지 이어 실행한 것은 명령을 `;`로 이은 실수였다. push 전이라 로컬 커밋을 계획 커밋 위에서 다시 만들고(`reset --soft`), 테스트 값은 런타임에 조각을 이어 붙이게 바꿨다. `check` 통과를 확인한 뒤 완료 처리했다.
- 2026-11-15: #53의 마지막 PR #62가 제작자 재승인 뒤 병합됐다.

## 의사결정 로그

- 판정 워크플로는 `check` 워크플로의 `workflow_run`(완료·성공)으로 시작한다. 이유: R16 "검증은 `check`를 통과한 커밋에서만", 실패할 커밋에 구독 한도를 쓰지 않는다. `workflow_run`은 main 정의로 돌고 environment 시크릿을 받는다. `check`는 main push에서도 돌지만 그때는 열린 PR이 없어 건너뛴다. 버린 대안: `pull_request_target`에서 바로 실행(실패 커밋도 검증, R16 위반).
- Claude와 Codex는 워크플로를 나눈다. 이유: Codex만 워크플로 단위 직렬화(`queue: max`)가 필요하고, 한쪽 장애가 다른 쪽 기록을 막지 않는다.
- 위험도와 필요한 검증자는 각 판정 워크플로의 첫 job(비밀 없음)이 base 스크립트로 다시 계산한다. 이유: `gates` 실행 결과를 다른 워크플로에서 믿고 가져올 통로가 없고, 계산이 싸다. `harness-guard` 신호도 같이 계산해 `gates`와 같은 위험도가 나온다.
- 작성 도구는 계획 frontmatter `author`로 본다(`claude-code` | `codex` | 그 밖은 사람). 낮음에서 B는 Claude 작성이면 Codex, Codex 작성이면 Claude, 사람이면 Codex다(10.1절 표). `author`는 PR이 정하지만 어느 쪽이든 다른 도구 1명은 반드시 돌고, 보통 이상은 둘 다 돈다.
- 원장(#55) 전의 `review/*` 판정: 승인이고 P0·P1 지적이 없으면 success, 아니면 failure. 이유: #55가 원장 상태(`fixed`·`rejected`)로 바꾸기 전까지의 가장 단순하고 안전한 규칙이다.
- 검증자 입력 중 diff와 변경 파일 목록은 base 스크립트가 `pr/.harness-review/`에 써 준다. 이유: 검증자는 셸이 없고 읽기 범위가 `pr/`뿐이다. PR이 같은 이름의 폴더를 넣었으면 base 스크립트가 지우고 다시 만든다.
- 도구 버전은 Q20에서 확인한 버전으로 고정한다(Claude Code 2.1.314, Codex 0.167.2, libsodium-wrappers 0.8.4). 올릴 때는 격리 동작을 다시 확인한다.
- 승인의 patch-id는 커밋 상태 description에 적고, 이어받을 때는 그 상태의 작성자가 검증 App 봇(`ci.recorderBot`)인지 확인한다. 이유: 별도 저장소 없이 head SHA에 묶이고, 봇 PAT이 쓴 같은 이름의 상태를 거를 수 있다.
- 고엔트로피 검사는 40자 이상 이어진 base64/hex 꼴 조각 중 대문자·소문자·숫자가 섞이고 문자 엔트로피 4.3비트 이상인 것만 잡는다. 이유: 커밋 SHA(소문자 hex)와 긴 경로·식별자를 지적에 적는 일이 흔해 오탐이면 판정 전체가 error가 된다. 놓치는 토큰이 있을 수 있지만 이 검사는 보조 수단이다(10.4절).
- 판정에 비밀이 보이면 failure가 아니라 error로 기록하고 사유에 값을 넣지 않는다. 이유: 유출은 검증 결과가 아니라 판정 job의 장애이고, 다시 돌려야 한다.
- (제작자 결정, 2026-11-15 대화) 이 계획(#54)은 `risk: high`를 유지해 PR마다 제작자 head 승인을 받는다. 구독 토큰·Codex 인증·인증 저장 App이 실제로 CI에 들어가는 작업이기 때문이다. #55·#56·#57의 계획은 `risk: normal`로 만든다. 그 PR들은 자동 병합되고, `harness-guard`가 검사 약화·권한 완화 신호를 잡았거나 경로 표가 높음인 PR만 승인을 요구한다. 이유: 구축 단계에서는 보호 경로도 자동 병합한다는 결정(설계서 10.4절)과 맞추되, 인증을 직접 다루는 구간만 사람이 본다. 버린 대안: 전부 높음(PR마다 승인, #53에서 겪은 부담), #54도 보통(검증자가 완성되기 전에 인증 워크플로가 사람 눈 없이 병합됨).

## 발견 사항

- 테스트에 실제 토큰 형식(`sk-ant-…`, `gho_…`, JWT 머리)의 가짜 값을 리터럴로 적으면 gitleaks가 검출해 `check`가 실패한다. 시크릿 스캔 테스트 값은 조각을 런타임에 이어 붙인다. → 처리: 해당 없음

## 열린 질문

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- step1·2는 다음 PR에서 처음 돈다(`workflow_run`도 main 정의). 각 step의 실제 동작은 그다음 step의 PR에서 확인해 진행 로그에 남긴다. step3 뒤에는 확인용 PR이 따로 필요하다.

## 다음 할 일

- step1 judge-claude.
