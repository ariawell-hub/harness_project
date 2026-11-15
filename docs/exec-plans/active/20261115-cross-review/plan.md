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
6. 승인 결속(10.3절): 승인 상태에 merge-base 대비 diff의 `git patch-id --stable`을 남기고, main 병합 갱신 뒤 patch-id가 같고 위험도가 낮음·보통이며 그사이 main에서 바뀐 파일이 PR이 바꾼 파일과 겹치지 않고 PR 파일의 내용이 바이트 단위로 같으면 LLM 없이 새 head로 승인을 옮긴다. 위험도 높음은 다시 검증한다.
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
- step3 approval-binding: patch-id 결속과 승인 이어받기
- step4 verify-register: Codex 판정·이어받기 실제 확인, 필수 체크 등록, 문서 정리

## 진행 로그

- 2026-11-15: 계획 작성(대화 세션). 제작자가 `judge-claude`(시크릿 `CLAUDE_CODE_OAUTH_TOKEN`), `judge-codex`(시크릿 `CODEX_AUTH_JSON`), `codex-auth-store`(변수 `STORE_APP_CLIENT_ID`, 시크릿 `STORE_APP_KEY`) environment를 준비했다. 셋 다 `main`만 허용임을 봇 API로 확인했다. Q20 소스(커밋 7b837e7의 `lab/q20/repo/`)를 읽었다.
- 2026-11-15 step0: `scripts/test/verdict.test.ts`를 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND`) → 스키마·프롬프트, `scripts/ci/{verdict,review-plan}.ts`, `recordReview`, `record-review` 명령 구현 뒤 `verdict`·`ci` 테스트 24개 통과.
- 2026-11-15 step0: 첫 `check`가 secret-scan에서 실패했다(테스트의 가짜 토큰 리터럴이 실제 토큰 형식으로 검출). 실패한 채 `complete-step`까지 이어 실행한 것은 명령을 `;`로 이은 실수였다. push 전이라 로컬 커밋을 계획 커밋 위에서 다시 만들고(`reset --soft`), 테스트 값은 런타임에 조각을 이어 붙이게 바꿨다. `check` 통과를 확인한 뒤 완료 처리했다.
- 2026-11-15: #53의 마지막 PR #62가 제작자 재승인 뒤 병합됐다.
- 2026-11-15 step1: `scripts/test/claude-scan.test.ts`와 `ci.test.ts`의 입력 폴더·워크플로 테스트를 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND`: `claude-scan.ts`, `review-input.ts`) → `scanClaudeRun`, `writeReviewInput`, `planReview`, 명령 `review-plan`·`claude-scan`, `judge-claude.yml` 구현 뒤 `claude-scan`·`ci`·`verdict` 테스트 42개 통과. `review-plan`을 이 브랜치에 직접 돌려 출력(`risk=high`, `claude=true`, `codex=true`)과 입력 폴더를 확인했다. 워크플로는 `workflow_run`이라 이 PR에서는 돌지 않는다. 실제 판정은 step2 PR에서 확인한다.
- 2026-11-15 step2: `scripts/test/codex-auth.test.ts`·`codex-scan.test.ts`와 `ci.test.ts`의 `judge-codex.yml` 불변식을 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND`: `codex-auth.ts`, `codex-scan.ts`, `ENOENT`: `judge-codex.yml`) → 구현 뒤 통과. 새 명령(`codex-auth restore|snapshot|diff|config|seal`, `codex-schema`, `codex-scan`)을 가짜 값으로 직접 돌려 출력에 값이 없는 것(필드 이름·해시 앞 8자)을 확인했다. 봉인은 libsodium 0.8.4를 임시 폴더에 받아 임의 키쌍으로 봉인→풀기 왕복이 원문과 같음을 확인했다(리포 밖 임시 스크립트). `codex-probe.sh`는 로컬에서 문법 검사(`bash -n`)만 했다. Linux 샌드박스 동작은 CI에서만 확인할 수 있다.
- 2026-11-15 step2: `judge-claude`(step1) 첫 실제 실행을 이 step의 PR #67에서 확인했다(실행 43666809569, head 초안 커밋). `check` 성공 → `plan`(위험도 high, claude=true) → `judge`(Claude Code 2.1.314, 모델 claude-sonnet-5-5, 약 40초, 세션 도구 4개·허용 밖 0·MCP 0, Read 9·Grep 2·StructuredOutput 1, `pr/` 밖 시도 0, 비밀 0, 유출 검사 통과) → `record`가 `review/claude = success — 승인 (P2 3)`을 기록했다. 상태 작성자는 `harness-recorder[bot]`이다. main push의 `check` 완료에서는 `plan`이 건너뛰어 아무것도 기록하지 않았다. 판정의 지적 본문(P2 3건)은 아직 어디에도 게시되지 않는다(원장은 #55).
- 2026-11-15 step3: `scripts/test/binding.test.ts`를 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND`: `binding.ts`) → `patchId`·`withPatch`·`patchOf`·`changedOnBaseSince`·`carryOver`·`fetchCandidates`, `recordReview`의 patch·이어받기, `review-plan`의 이어받기 판정, 두 판정 워크플로 연결을 구현했다.
- 2026-11-15 step3: 초안 PR #68에서 `judge-codex`가 처음 실제로 돌았다(실행 43670203495). `plan`·`pubkey`(공개키 조회, 인증 저장 App 읽기)는 성공, `judge`는 도구 설치(Codex 0.167.2, bubblewrap 0.11.1)까지 된 뒤 인증 복원에서 `CODEX_AUTH_JSON: JSON이 아니다`로 실패했다. 봉인은 스냅숏이 없어 실패했고, `store`는 건너뛰어 기존 시크릿은 그대로다. `record`가 `review/codex = error — 판정 없음`을 기록했다(작성자 `harness-recorder[bot]`, fail-closed 동작 확인). 봇 API로 본 시크릿은 이름과 갱신 시각뿐이다(2026-11-15T01:07:02Z 등록, 로그에는 `***`로 가려져 비어 있지는 않다). 사전 측정·판정·봉인·저장은 아직 실제로 돌지 못했다. → step4.
- 2026-11-15 step3: 같은 PR에서 `review/claude = failure — 수정 요청 (P1 2, P2 2)`가 기록됐으나 지적 본문을 볼 곳이 없었다(판정은 job 출력으로만 넘어간다). CI와 같은 인자(`--restricted --tools Read,Grep,Glob …`, `scripts/cross-review/prompt.md`)로 로컬 사전 점검을 돌려 지적을 재현했다: P1 ① 공백만 바꾼 후속 커밋이 patch-id가 같아 승인을 이어받는다 ② step3 문서 갱신 누락 ③ 진행 로그 누락. P2: 바이너리 내용이 patch-id에 약하게 묶임, 기록 job 로그의 줄바꿈(워크플로 명령 주입 여지), `fetchCandidates` 무테스트, `ci.recorderBot` 형식 검사 없음. P3: 길이 상수 중복.
- 2026-11-15 step3: 지적마다 테스트를 먼저 더해 실패를 확인하고 고쳤다. ① `samePrContent`(PR 파일이 옛 head와 바이트 단위로 같아야 이어받는다, 공백만 바꾼 커밋 테스트) ② `git diff --binary --full-index`(바이너리 변경 테스트) ③ `oneLine`(로그 한 줄화) ④ `fetchCandidates` 테스트(가짜 API) ⑤ `loadConfig`의 `ci.recorderBot` 형식 검사 ⑥ `DESCRIPTION_MAX` 공유. 문서와 이 로그를 채웠다. 전체 테스트 253개, `check` 통과.
- 2026-11-15 step3: AC 실행 결과 — `node --test scripts/test/binding.test.ts scripts/test/verdict.test.ts scripts/test/protection.test.ts` 통과, `grep -q "export function carryOver" scripts/ci/binding.ts`·`grep -q "recorderBot" harness.config.json` 통과. 이어받기는 이 PR(위험도 높음)에서 일어나지 않는다. `review-plan`을 이 브랜치에 돌려 `patch=<40자>`, `carry_claude=`, `carry_codex=`(높음이라 다시 검증)를 확인했다. 실제 이어받기 확인과 필수 체크 등록은 step4.

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
- `review-plan`은 PR을 직접 해석하지 않고 기존 `ci-pr` 다음에 돈다(step1 파일의 `--event` 인자와 다르다). 이유: `pr/`를 체크아웃하려면 head SHA를 먼저 알아야 하고, PR 해석은 `gates`가 쓰는 `ci-pr`이 이미 한다. `skip`·`head_sha`는 `ci-pr`이, `risk`·`claude`·`codex`는 `review-plan`이 출력한다.
- 판정 워크플로의 concurrency는 head 리포 + 브랜치 단위로 묶고 진행 중인 실행을 취소한다. 이유: 새 커밋의 `check`가 통과하면 옛 head의 판정은 쓸모가 없고 구독 한도만 쓴다. 리포 이름을 넣어 포크의 같은 이름 브랜치가 실행을 취소하지 못하게 한다. 취소된 실행은 아무것도 기록하지 않는다.
- 유출 검사에서 `pr/` 밖 대상의 도구 결과를 알 수 없으면(결과 이벤트 없음) 성공한 것으로 보고 실패시킨다. Q20의 표식 파일 검사(시험용 훅·MCP 미끼)는 옮기지 않고, 대신 init 이벤트의 도구 목록·MCP 서버 목록에 허용 밖 항목이 있으면 실패시킨다. init이 없어도 실패다(fail-closed).
- Claude 판정의 모델은 지정하지 않는다(Q20과 같은 조건, 구독 기본 모델). 판정 품질 때문에 고정이 필요해지면 설정 값으로 올린다.
- Codex 유출 검사는 `pr/` 밖을 가리킨 명령을 실패 조건으로 쓰지 않고 세어 보고만 한다(Q20과 같다). 이유: 명령 문자열만으로는 검색 패턴의 `/`나 `$`도 밖으로 보여 오탐이 잦고, 오탐이면 판정 전체가 `error`가 된다. 읽기 범위는 권한 프로필 샌드박스와 사전 측정(기대와 다르면 판정 없이 실패)이 막는다. 비밀 값·허용 밖 항목 종류·`turn.failed`는 실패 조건이다.
- `codex exec --output-schema`에는 공통 스키마에서 길이·개수 제약 키워드(`maxLength`, `maxItems`, `minimum`)를 뺀 사본을 준다(`codex-schema`). 이유: 구조화 출력이 이 키워드를 받지 않으면 실행 자체가 실패한다(Q20의 Codex 스키마에도 없었다). 제약은 프롬프트 꼬리말로 알리고 `validateVerdict`가 검사한다.
- 판정 설정은 인증 폴더(`CODEX_HOME`)가 거부 목록에 덮이지 않으면 만들지 않는다. 이유: 거부 목록 인자를 잘못 줘 인증 파일이 읽히는 설정이 조용히 만들어지는 것을 막는다(사전 측정이 다시 잡지만 앞에서 거절한다).
- 사전 측정에 홈 설정 폴더(`~/.codex`, `~/.config`) 읽기 항목을 더하고, 측정 전에 샌드박스 밖에서 빈 표식 파일을 둔다. 이유: Q20의 측정은 없는 파일을 읽어 "거부"와 "없음"을 구분하지 못했다.
- `judge-codex`는 취소하지 않고 줄을 세우므로(`queue: max`) 옛 head의 판정도 끝까지 돈다. 이유: 취소하면 봉인·저장이 빠져 갱신된 인증을 잃을 수 있다(13.3절). 구독 한도가 문제가 되면 판정 job 앞에서 head가 최신인지 확인해 LLM 단계만 건너뛰는 방식을 검토한다.
- 비밀 스캔의 16자 조각은 JWT 머리처럼 여러 토큰에 공통인 부분도 포함한다. PR 파일에 같은 머리의 JWT가 있고 검증자가 그 파일을 읽으면 판정이 `error`가 된다. 이유: 조각을 빼면 스캔이 약해진다. 실제로 걸리면 그때 공통 머리만 제외하는 규칙을 검토한다.
- step3을 둘로 나눴다(step4 verify-register 추가). 이유: `judge-codex` 첫 실행이 시크릿 형식 문제로 판정까지 가지 못해, 수용 기준 4·7(Codex 실제 판정, 이어받기 실제 확인)과 8(필수 체크 등록)을 step3 PR 안에서 닫을 수 없다. 검증자가 실제로 판정을 내기 전에 `review/*`를 필수로 등록하면 모든 PR의 병합이 막히므로, step3 작업 5(제작자에게 등록 요청, 등록 뒤 `required-checks` 확인)와 작업 6의 0.2절·TD-1 갱신은 step4에서 한다. step 파일의 작업·AC는 실행 PR에서 바꿀 수 없어(`plan-gate`) step3 파일은 그대로 두고 여기에 적는다. 설정 `ci.requiredChecks`에는 step3 AC대로 `review/*`를 더했다. 등록 전까지 `required-checks`는 두 체크를 미등록으로 보고한다(목표 상태와 실제의 차이를 그대로 보여 준다).
- 승인 상태에는 patch-id 전체(40자)를 적는다(step 파일의 "앞 16자"와 다르다). 이유: PR 작성자는 승인받을 diff와 바꿔 넣을 diff를 모두 정할 수 있어, 앞 16자(64비트)만 같은 쌍은 생일 공격(약 2^32회)으로 만들 수 있다. 40자를 적어도 description 상한(140자) 안에 든다.
- 이어받기 조건에 "PR이 바꾼 파일이 옛 head와 새 head에서 바이트 단위로 같다"를 더했다(Claude 검증자 지적). 이유: `git patch-id`는 공백을 무시해, 승인 뒤 들여쓰기나 따옴표 안 공백만 바꾼 커밋이 patch-id로는 걸러지지 않는다. main 병합 갱신은 PR 파일을 건드리지 않으므로 이 조건이 항상 성립한다. patch-id 비교는 그대로 둔다(PR 파일 목록이 줄어든 경우를 잡는다).
- 이어받기 후보는 가장 최근에 판정된 앞선 head 하나다. 그 head의 마지막 판정이 success가 아니거나 patch가 다르면 더 옛 head의 승인으로 거슬러 가지 않는다. 이유: 같은 patch의 최신 판정이 실패인데 옛 승인을 되살리면 안 된다.
- 기록 job은 검사를 통과한 판정의 요약과 지적을 로그에 한 줄씩 낸다(원장 #55 전의 임시 통로). 이유: step3 PR에서 `수정 요청 (P1 2)`만 보이고 무엇을 고칠지 알 수 없었다. 본문은 형식 검사와 시크릿 스캔을 통과한 뒤에만, 제어 문자를 공백으로 바꿔 낸다.
- `restoreAuth`는 JSON 파싱에 실패하면 줄바꿈을 빼고 한 번 더 읽는다. 그래도 안 되면 값 없이 길이·줄 수·첫 글자 종류만 오류에 적는다. 이유: 터미널 폭 줄바꿈이 섞인 붙여넣기는 Claude 토큰에서도 겪은 문제이고(13.3절), 첫 실행의 "JSON이 아니다"만으로는 원인을 좁힐 수 없었다.
- (제작자 결정, 2026-11-15 대화) 이 계획(#54)은 `risk: high`를 유지해 PR마다 제작자 head 승인을 받는다. 구독 토큰·Codex 인증·인증 저장 App이 실제로 CI에 들어가는 작업이기 때문이다. #55·#56·#57의 계획은 `risk: normal`로 만든다. 그 PR들은 자동 병합되고, `harness-guard`가 검사 약화·권한 완화 신호를 잡았거나 경로 표가 높음인 PR만 승인을 요구한다. 이유: 구축 단계에서는 보호 경로도 자동 병합한다는 결정(설계서 10.4절)과 맞추되, 인증을 직접 다루는 구간만 사람이 본다. 버린 대안: 전부 높음(PR마다 승인, #53에서 겪은 부담), #54도 보통(검증자가 완성되기 전에 인증 워크플로가 사람 눈 없이 병합됨).

## 발견 사항

- 판정 지적의 본문은 원장(#55) 전에는 기록 job 로그에서만 볼 수 있다(`record-review:` 줄). 이 출력은 main에 병합된 뒤의 PR부터 나온다. → 처리: #55
- 로컬에서 CI와 같은 인자로 `claude -p`를 돌리면 CI 검증자의 지적을 미리 볼 수 있다(`review-plan`으로 입력 폴더를 만든 뒤 실행). 로컬 사전 점검용이고 병합 판단에는 쓰지 않는다. → 처리: [문서](../../../harness/workflow.md)
- `judge-codex` environment의 `CODEX_AUTH_JSON`이 JSON으로 읽히지 않는다(값은 봇이 볼 수 없다). → 처리: #54 step4(제작자 재등록)
- `workflow_run`으로 도는 실행은 `gh run list`의 `headBranch`가 PR 브랜치가 아니라 `main`이다. PR의 판정 실행을 찾을 때는 브랜치 이름이 아니라 PR head의 커밋 상태(`review/*`의 target URL)로 찾는다. → 처리: 해당 없음
- 테스트에 실제 토큰 형식(`sk-ant-…`, `gho_…`, JWT 머리)의 가짜 값을 리터럴로 적으면 gitleaks가 검출해 `check`가 실패한다. 시크릿 스캔 테스트 값은 조각을 런타임에 이어 붙인다. → 처리: 해당 없음

## 열린 질문

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- step1·2는 다음 PR에서 처음 돈다(`workflow_run`도 main 정의). 각 step의 실제 동작은 그다음 step의 PR에서 확인해 진행 로그에 남긴다. step3 뒤에는 확인용 PR이 따로 필요하다.

## 다음 할 일

- 제작자: `judge-codex` environment의 `CODEX_AUTH_JSON`을 다시 등록한다(임시 `CODEX_HOME`의 `auth.json` 파일 내용 전체. 13.3절 CI 전용 로그인).
- step4 verify-register.
