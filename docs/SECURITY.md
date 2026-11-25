---
status: active
related_code: [scripts/hooks/, .github/workflows/]
review_cycle: quarterly
---

# 보안

## 원칙

- 되돌릴 수 없는 작업은 권한으로 먼저 막고, 명령 차단(L1 훅)은 보조로 쓴다(B9).
- 에이전트 환경에는 유출돼도 피해가 작은 개발·테스트 전용 키만 둔다. 에이전트 환경의 키는 "에이전트가 알고 있다"고 가정한다.
- 에이전트는 전용 봇 계정(`GH_TOKEN`)만 쓴다. **에이전트가 실행되는 모든 머신(macOS·Windows)에는 제작자의 GitHub 토큰(`gh` 로그인, git 자격증명 도우미, macOS 키체인·Windows 자격 증명 관리자에 저장된 토큰)을 두지 않는다**(E5, [ADR-0005](decisions/ADR-0005-windows-native.md)). 제작자 승인은 GitHub 웹·모바일에서만 한다.
- 개인 계정 비공개 리포는 GitHub의 서버 측 push 차단이 없다. 보장은 "로컬 예방 + push 후 탐지·키 교체"다.

## 자격증명 목록

| 자격증명                 | 보관 위치                                                                                         | 사용 주체                      | 권한                                                                                                                                                                                                                                                                           | 만료·갱신                                                     | 유출 시 피해                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 봇 토큰 (`ariawell247`)  | runner·에이전트 세션 환경(`GH_TOKEN`). git은 `gh auth git-credential`로 같은 토큰 사용            | 작성 에이전트, runner          | 클래식 PAT `repo`·`read:org`. `workflow`는 없다(구축 단계에만 있었고 2026-11-18의 운영 전환 때 회수했다. 워크플로 파일을 바꾼 push는 GitHub이 거부한다). 봇을 이 리포에만 Write로 초대해 범위를 제한. [ADR-0003](decisions/ADR-0003-bot-token-classic-pat.md)                  | 90일 이하                                                     | 브랜치 push·PR 생성·커밋 상태 쓰기. main은 브랜치 보호와 필수 체크 출처 고정으로 보호됨 |
| revert용 봇 토큰         | `revert` environment(main 전용)의 시크릿 `REVERT_BOT_TOKEN`                                       | revert 워크플로의 `act` job    | 봇 PAT(위와 같은 토큰, `workflow` 없음). 실패한 `check` 재실행, `revert/<SHA>` 브랜치 push·PR·자동 병합, Issue 재오픈·댓글·라벨. main 직접 push는 브랜치 보호가 막는다. 워크플로 파일을 되돌리는 revert는 push가 거부돼 `needs-human`으로 넘어간다(실제로 본 적은 없다, TD-38) | 90일 이하. 봇 토큰을 다시 발급하면 이 시크릿도 함께 바꾼다    | 봇 토큰과 같다. main은 브랜치 보호와 필수 체크 출처 고정으로 보호됨                     |
| 검증 App 키 (2단계)      | `recorder` environment                                                                            | 기록 job                       | 커밋 상태·PR 댓글 쓰기                                                                                                                                                                                                                                                         | 정기 교체                                                     | 검증 결과 위조(치명)                                                                    |
| Claude 구독 토큰 (2단계) | `judge-claude` environment. 한 줄로 붙여 넣는다(설계서 13.3절)                                    | Claude 판정 job                | 제작자 Claude 구독                                                                                                                                                                                                                                                             | `setup-token` 만료 전 갱신                                    | 구독 한도 소진                                                                          |
| Codex 인증 파일 (2단계)  | `judge-codex` environment. 임시 `CODEX_HOME`에서 새로 로그인한 CI 전용 `auth.json`(설계서 13.3절) | Codex 판정 job                 | 제작자 ChatGPT 구독                                                                                                                                                                                                                                                            | access token 만료 뒤 실행 중 갱신, 저장 job이 봉인본을 재저장 | 위와 같음                                                                               |
| 인증 저장 App 키 (2단계) | `codex-auth-store` environment                                                                    | 공개키 조회·저장 job(LLM 없음) | Environments 읽기·쓰기만                                                                                                                                                                                                                                                       | 정기 교체                                                     | environment 시크릿 덮어쓰기(Codex 인증 교체·손상)                                       |
| 개발·테스트 키           | 리포 밖 파일(`~/.config/harness/<repo>/.env.dev`) → worktree `.env` 링크                          | 에이전트, 테스트               | 개발·테스트 환경만                                                                                                                                                                                                                                                             | 필요 시 교체                                                  | 개발 환경 한정                                                                          |
| 제작자 GitHub 계정       | 제작자의 브라우저·모바일                                                                          | 제작자                         | 리포 관리자                                                                                                                                                                                                                                                                    | 패스키 2단계 인증                                             | 모든 보호 무력화                                                                        |

## Codex CI 인증 등록 (제작자)

`judge-codex` environment의 `CODEX_AUTH_JSON`에는 CI 전용으로 로그인한 `auth.json` **파일의 내용**을 넣는다(설계서 13.3절). 에이전트는 이 절차를 하지 않는다(R20).

```bash
export CODEX_HOME="$(mktemp -d)"                 # 로컬 로그인과 분리한 임시 폴더
codex login -c cli_auth_credentials_store=file   # 출력된 주소를 브라우저에서 열어 로그인을 끝낸다
ls -l "$CODEX_HOME/auth.json"                    # 파일이 생겼는지 확인
pbcopy < "$CODEX_HOME/auth.json"                 # 파일에서 바로 복사(macOS)
```

GitHub → Settings → Environments → `judge-codex` → `CODEX_AUTH_JSON`에 붙여 넣고, 임시 폴더를 지운다.

- 같은 터미널에서 끝까지 한다. 새 터미널에서는 `CODEX_HOME`이 없어 평소 쓰는 로컬 로그인 파일을 가리킨다.
- `codex logout`은 쓰지 않는다. 토큰이 폐기될 수 있다.
- 등록한 뒤에는 판정 job이 실행마다 인증을 봉인해 다시 저장한다. 손으로 다시 넣을 일은 로그인이 풀렸을 때뿐이다.

흔한 실수:

| 실수                                              | 증상(`judge-codex`의 `judge` job 로그)                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| 로그인 주소(`https://auth.openai.com/…`)를 넣었다 | `codex-auth: 실패 — CODEX_AUTH_JSON: JSON이 아니다(… 첫 글자: 그 밖)`   |
| 터미널 출력을 복사해 값 안에 줄바꿈이 섞였다      | 줄바꿈만 섞였으면 읽힌다. 글자가 빠졌으면 `JSON이 아니다(… 첫 글자: {)` |
| API 키 로그인 파일이나 다른 JSON을 넣었다         | `tokens가 없다(ChatGPT 로그인 auth.json이 아니다)`                      |
| 값을 비워 두었다                                  | `CODEX_AUTH_JSON: 비어 있다`                                            |

정상이면 `codex-auth: restore sha8=… fields=…tokens.access_token,…` 줄이 나온다. 값은 로그에 나오지 않고, 필드 이름과 해시 앞 8자만 나온다.

## 검증 App 권한 변경 (제작자)

검증 App(`harness-recorder`)은 커밋 상태와 지적 원장 댓글을 쓴다(설계서 0.2절, 10.2절 (4)). 필요한 권한은 Commit statuses 읽기·쓰기, Pull requests 읽기·쓰기, Contents 읽기다. 에이전트는 App 설정을 바꾸지 않는다(R20).

권한을 더할 때(예: Pull requests를 읽기에서 읽기·쓰기로):

1. GitHub → 오른쪽 위 프로필 → Settings → Developer settings → GitHub Apps → `harness-recorder` → Edit.
2. 왼쪽 Permissions & events → Repository permissions → Pull requests를 "Read and write"로 바꾸고 맨 아래 Save changes.
3. 설치에서 새 권한을 수락한다. Settings → Applications → Installed GitHub Apps → `harness-recorder` → Configure → "Review request"(또는 권한 변경 알림)에서 Accept new permissions. 수락하기 전에는 새 권한이 적용되지 않는다.

확인: 그 뒤 아무 PR에서 판정 워크플로(`judge-claude` 또는 `judge-codex`)의 `record` job 로그를 본다.

| 상태                             | `record` job 로그                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| 적용됨                           | `record-review: review-ledger = success` 또는 `failure`                                        |
| 권한을 저장하지 않았거나 수락 전 | "검증 App 토큰 (지적 원장 댓글 읽기·쓰기)" 단계 실패, `review-ledger = error — 원장 토큰 없음` |

권한이 없어도 `review/claude`·`review/codex`는 그대로 기록된다. `review-ledger`만 `error`로 남는다. `review-ledger`는 필수 체크라 `error`인 동안 PR이 병합되지 않는다.

## 운영 전환까지의 제작자 작업 (순서)

구축 단계에서 운영 단계로 넘어갈 때(설계서 10.4절 운영 전환 체크리스트) 제작자만 할 수 있는 일을 순서대로 모았다. 절차는 아래 각 절에 있다. 에이전트는 이 가운데 어느 것도 하지 않고(R20), 끝났다고 알려 주면 읽기 전용 명령으로 확인한다.

| 순서 | 할 일                                        | 때                                           | 봇의 확인                                                |
| ---- | -------------------------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| 1    | "필수 체크 등록"에서 `revert-check`를 더한다 | 지금(설정에 넣은 PR의 병합 전후 어느 때든)   | `required-checks`, `ops-check` 1번                       |
| 2    | "테스트 리포 준비"                           | 테스트 리포 확인(체크리스트 5)을 시작하기 전 | 테스트 리포에서 `required-checks`, environment 이름 조회 |
| 3    | "코드 오너 리뷰 필수"                        | 하네스를 고치는 PR이 모두 병합된 뒤          | 시험 PR(체크리스트 6)                                    |
| 4    | "봇 토큰의 `workflow` 권한 회수"             | 워크플로를 바꾸는 PR이 모두 병합된 뒤        | `ops-check` 3번, 시험 PR                                 |
| 5    | "에이전트용 브라우저 프로필"의 로그아웃 확인 | 운영 전환 PR 전                              | 제작자가 알려 준다(봇은 볼 수 없다)                      |
| 6    | 운영 전환 PR(`stage: operation`)의 head 승인 | 1~5와 시험 PR이 끝난 뒤                      | 병합 뒤 `ops-check`                                      |

`revert` environment는 revert 워크플로를 들일 때 이미 만들었다(아래 "`revert` environment"). 4번에서 봇 토큰을 다시 발급할 때 그 시크릿도 바꾼다.

이 리포는 2026-11-18에 이 순서로 운영 단계로 전환했다(확인 결과는 설계서 10.4절 운영 전환 체크리스트, 시험 기록은 `lab/ops-transition/results/`). 이 템플릿으로 새 프로젝트를 시작하면 같은 순서로 한다.

전환 뒤에 달라지는 것:

- 보호 경로(`harness.config.json`의 `protectedPaths`)를 바꾸는 PR은 모두 제작자의 head 승인이 있어야 병합된다(`risk-gate`의 위험도 높음과 코드 오너 리뷰). 승인은 GitHub 웹·모바일에서 한다. 보호 경로 밖만 바꾼 위험도 낮음·보통 PR은 그대로 자동 병합된다.
- 워크플로 파일(`.github/workflows/`)은 봇이 올릴 수 없다. 바꿔야 하면 봇이 패치를 준비하고 제작자가 봇의 브랜치에 워크플로 커밋을 올린다(아래 "워크플로 변경 절차"). 제작자가 PR을 직접 열지 않는다(자기 PR은 승인할 수 없어 `risk-gate`를 통과하지 못한다). `workflow` 권한을 봇 토큰에 다시 주지 않는다.
- 봇 토큰을 다시 발급할 때(만료 90일 이하)도 `repo`와 `read:org`만 고르고, 발급 뒤 머신마다 `node scripts/harness.ts ops-check`로 확인한다.

## 필수 체크 등록 (제작자)

main의 필수 상태 체크는 제작자가 리포 설정에서 등록한다(설계서 0.2절). 에이전트는 보호 설정을 바꾸지 않고 읽어서 비교만 한다(R20). 검증 App이 그 체크를 실제 PR에서 한 번 이상 기록한 뒤에 등록한다. 아무도 채우지 못하는 필수 체크는 모든 PR을 막는다.

1. GitHub → 리포 → Settings → Branches → `main` 보호 규칙 → Edit.
2. "Require status checks to pass before merging" 아래 검색 칸에 체크 이름(예: `review-ledger`)을 넣고 고른다. 목록에는 최근에 보고된 체크만 나온다.
3. 고른 체크 옆의 출처를 "any source"에서 `harness-recorder`로 바꾼다(`check`만 GitHub Actions). 출처를 지정하지 않으면 PR 워크플로가 같은 이름으로 흉내 낼 수 있다.
4. Save changes.

확인: 봇이 `node scripts/harness.ts required-checks`를 실행한다. 등록된 체크와 출처가 `harness.config.json`의 `ci.requiredChecks`와 같으면 `required-checks: 통과`다. 출처가 다르면 `출처가 다르다(등록 아무 출처, …)`로 알려 준다.

등록할 체크는 설정(`ci.requiredChecks`)의 목록이다.

| 체크                                                                                                                      | 출처               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `check`                                                                                                                   | GitHub Actions     |
| `revert-check`, `plan-gate`, `risk-gate`, `deps-guard`, `harness-guard`, `review/claude`, `review/codex`, `review-ledger` | `harness-recorder` |

`revert-check` 등록(#102 step4): 검증 App이 이미 모든 PR에 `revert-check`를 기록하고 있어(revert PR이 아니면 "revert PR 아님"으로 통과한다) 언제 등록해도 막히는 PR이 없다. 설정에 이 체크를 넣은 PR이 병합된 뒤에는 등록하기 전까지 `required-checks`와 `ops-check` 1번이 `revert-check: 필수 체크로 등록되지 않았다`로 알린다. 위 1~4의 절차에서 검색 칸에 `revert-check`를 넣고 출처를 `harness-recorder`로 고른다.

## 1분 미만 job의 러너 변수 (제작자)

리포 변수 `SHORT_JOB_RUNNER`가 1분 미만 job 13개(`gates`의 `evaluate`·`record`, 두 판정 워크플로의 `plan`·`repro`·`record`와 `judge-claude`의 `failed`·`ci-failure`, `judge-codex`의 `pubkey`·`store`, `review-trigger`의 `trigger`)의 러너를 고른다(ADR-0008 B1, Issue #240). 워크플로의 식이 두 러너 가운데 하나만 고르므로 변수로 다른 러너는 고를 수 없다. GitHub 식의 비교는 대소문자를 가리지 않는다.

| `SHORT_JOB_RUNNER`의 값                             | 러너                                        |
| --------------------------------------------------- | ------------------------------------------- |
| 없음(빈 문자열)                                     | `ubuntu-latest`(job마다 새 VM, 분당 $0.006) |
| `ubuntu-slim`                                       | `ubuntu-slim`(1코어 컨테이너, 분당 $0.002)  |
| 대소문자만 다른 값(`UBUNTU-SLIM`, `Ubuntu-Slim` 등) | `ubuntu-slim`                               |
| 그 밖의 값(`ubuntu-latest`, `self-hosted`, `on` 등) | `ubuntu-latest`                             |

잃는 보장: 켜면 이 job들이 job마다 새 VM이 아니라 공유 VM 위의 job마다 새 컨테이너에서 돈다. 그 가운데 기록 job(`recorder`)과 Codex 인증 저장 job(`codex-auth-store`)은 비밀을 가진다. 제작자가 ADR-0008의 묶음 "호스팅 유지"를 고를 때 받아들인 보장이다([설계서 10.4절](harness/design.md) "self-hosted 러너는 쓰지 않는다"의 하위 항목).

1. 켜기: GitHub → 리포 → Settings → Secrets and variables → Actions → Variables 탭 → New repository variable. Name `SHORT_JOB_RUNNER`, Value `ubuntu-slim`. 봇이 Issue로 요청할 때 한다(넣기 전 값을 잰 뒤. 켠 시각이 넣은 뒤 값의 기간을 정한다). 켠 시각을 알려 준다.
2. 끄기(되돌리기): 같은 화면에서 변수를 지운다. 바로 다음 실행부터 `ubuntu-latest`다. PR이 필요 없다. 이 job들이 1코어 러너에서 깨지면(기록·판정이 실패하거나 멈춘다) 봇이 Issue로 끄기를 요청한다.

확인: 봇이 실행 기록의 job 라벨(`gh api repos/<owner>/<repo>/actions/runs/<id>/jobs`의 `labels`)과 결과를 본다. 켠 뒤의 실행을 모두 보는 감시 명령은 계획 `20261124-slim-runner`의 step1에 있다.

봇은 이 변수를 만들거나 바꾸거나 지우지 않는다(R20. L1 훅이 `gh variable set/delete`와 `gh api …/actions/variables`를 막는다). 개인 계정 리포에서는 리포의 다른 협업자도 리포 변수를 바꿀 수 있지만, 위 표대로 두 러너 사이를 오갈 뿐이다.

## 에이전트용 브라우저 프로필 (제작자)

대화 세션의 에이전트는 MCP 도구로 Chrome을 직접 조종한다(Claude in Chrome 확장, Playwright). L1 훅은 브라우저 도구의 입력에 GitHub 주소가 있으면 막지만(설계서 13.1절), 브라우저 안에서 링크를 누르거나 이미 열린 탭을 조작해 GitHub에 닿는 경로는 보지 못한다. 그 브라우저 프로필에 제작자 GitHub 계정이 로그인되어 있으면 에이전트가 제작자 이름으로 PR을 승인하거나 설정을 바꿀 수 있다(E5, R20).

1. Claude 확장을 설치한 Chrome 프로필(에이전트가 조종하는 프로필)에서 `https://github.com`을 열어 로그아웃한다(오른쪽 위 프로필 사진 → Sign out). 그 프로필의 비밀번호 관리자에 GitHub 비밀번호가 저장되어 있으면 지운다.
2. PR 승인과 리포 설정은 Claude 확장이 없는 다른 Chrome 프로필(또는 다른 브라우저)이나 모바일에서 한다.
3. Playwright MCP는 평소 쓰는 프로필이 아닌 전용 프로필로 뜬다. 그 창에서 GitHub에 로그인하지 않는다.

확인: 에이전트가 조종하는 프로필에서 `https://github.com/settings/profile`을 열면 로그인 화면이 나온다. 운영 전환 체크리스트(설계서 10.4절) 3번에서 함께 확인한다.

에이전트의 GitHub 작업은 봇 토큰의 `gh` 명령으로 한다. 훅이 막는 MCP 도구와 예외를 두는 법(`guard.mcp.allowTools`, 보호 경로)은 설계서 13.1절에 있다.

## `revert` environment (제작자)

revert 워크플로(`.github/workflows/revert.yml`)의 `act` job이 쓰는 봇 토큰을 둔다(설계서 10.3절). 에이전트는 environment와 시크릿을 만들거나 바꾸지 않는다(R20).

순서: revert 워크플로가 main에 들어가기 전에 만든다. 없으면 main `check`가 실패했을 때 `act` job이 토큰 없이 실패한다. 봇 PAT를 다시 발급하면 이 시크릿도 함께 바꾼다.

1. GitHub → 리포 → Settings → Environments → New environment → 이름 `revert`.
2. "Deployment branches and tags"를 "Selected branches and tags"로 바꾸고 `main`만 더한다.
3. "Environment secrets" → Add secret → 이름 `REVERT_BOT_TOKEN`. 값은 봇 계정의 PAT 한 줄이다(`ghp_`로 시작한다. 앞뒤에 공백이나 줄바꿈을 넣지 않는다).

확인: 봇이 `gh api repos/<owner>/<repo>/environments/revert/secrets`로 시크릿의 이름과 갱신 시각을 본다(값은 볼 수 없다). 토큰이 실제로 통하는지는 main `check`가 실패했을 때 `revert` 워크플로의 `act` job 로그로 확인한다.

## 코드 오너 리뷰 필수 (제작자, 운영 전환)

운영 단계에서는 보호 경로를 바꾸는 PR이 제작자(코드 오너)의 승인 없이 병합되지 않는다(설계서 10.4절 운영 전환 체크리스트 2). 코드 오너는 `.github/CODEOWNERS`가 정한다. 이 파일은 `harness.config.json`의 `protectedPaths`와 `github.owner`에서 만들고 손으로 고치지 않는다(`node scripts/harness.ts codeowners --write`. 어긋나면 `check`가 실패한다).

순서: `.github/CODEOWNERS`가 main에 있은 뒤, 운영 전환 PR(`stage: operation`)보다 앞에 한다. 켠 때부터 보호 경로를 바꾸는 모든 PR에 제작자 승인이 필요하므로, 하네스를 고치는 PR이 남아 있으면 그 PR들이 병합된 뒤에 켠다.

1. GitHub → 리포 → Settings → Branches → `main` 보호 규칙 → Edit.
2. "Require a pull request before merging" 아래 "Require review from Code Owners"를 켠다.
3. 같은 자리의 "Require approvals"는 켜지 않는다(필수 승인 수 0). 1 이상이면 보호 경로 밖의 PR도 사람 승인을 기다려 자동 병합이 멈춘다.
4. "Require approval of the most recent reviewable push"는 끈 채로 둔다(설계서 0.2절).
5. Save changes.

확인: 관리자가 아닌 봇 토큰으로는 이 설정을 읽을 수 없다. `node scripts/harness.ts ops-check`의 2번은 CODEOWNERS 파일만 확인하고 설정은 `?` 줄로 남긴다. 설정은 시험 PR로 확인한다(체크리스트 6). 보호 경로를 바꾼 PR은 필수 체크가 모두 통과해도 제작자 승인 전에는 병합되지 않고, 보호 경로 밖만 바꾼 위험도 낮음 PR은 승인 없이 자동 병합된다.

구축 단계에도 CODEOWNERS 파일이 있으면 GitHub이 보호 경로를 바꾼 PR(초안 해제 뒤)마다 제작자에게 리뷰를 요청한다. 이 설정을 켜기 전에는 알림일 뿐이고 병합을 막지 않는다.

revert PR도 예외가 아니다. 이 설정을 켠 리포에서 main을 깬 커밋이 보호 경로를 바꿨다면, 그것을 되돌리는 `revert/<SHA>` PR도 보호 경로를 바꾸므로 제작자 승인 전에는 병합되지 않는다(봇이 PR을 만들 때 제작자에게 리뷰 요청이 간다). 보호 경로 밖만 바꾼 커밋의 revert는 그대로 자동 병합된다. 하네스 리포 자신은 대부분의 변경이 보호 경로라, 운영 단계에서는 revert가 제작자 승인으로 끝난다.

## 봇 토큰의 `workflow` 권한 회수 (제작자, 운영 전환)

구축 단계의 봇 PAT에는 워크플로 파일을 push하기 위한 `workflow` 권한이 있다([ADR-0003](decisions/ADR-0003-bot-token-classic-pat.md)). 운영 단계에서는 뺀다(설계서 10.4절 운영 전환 체크리스트 3). 옛 토큰의 권한을 줄여 저장하지 않고, 새 토큰을 발급한 뒤 옛 토큰을 지운다.

순서: 워크플로 파일(`.github/workflows/`)을 바꾸는 PR이 모두 병합된 뒤, 운영 전환 PR보다 앞에 한다. 회수한 뒤에는 봇이 워크플로 파일을 바꾼 브랜치를 push할 수 없다. 그런 변경은 제작자가 올린다(아래 "워크플로 변경 절차").

1. 봇 계정으로 GitHub에 로그인한다(제작자 계정을 쓰는 브라우저 프로필과 다른 프로필에서). Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic).
2. 권한은 `repo`와 `read:org`만 고른다. `workflow`는 고르지 않는다. 만료는 90일 이하로 둔다.
3. 에이전트가 도는 머신마다 `GH_TOKEN` 값을 새 토큰으로 바꾼다(환경 변수를 넣어 둔 곳). 바꾼 뒤 터미널과 에이전트 세션을 새로 연다. 이어 쓰던 세션은 시작할 때 받은 옛 토큰을 그대로 들고 있어, 옛 토큰을 지운 뒤에는 `gh`가 401(`Bad credentials`)로 실패한다. 세션은 토큰을 스스로 바꿔 끼우지 않는다(R20). 그 세션에 "끝났다"고 알려도 GitHub 작업은 새 세션에서만 이어진다.
4. `revert` environment의 시크릿 `REVERT_BOT_TOKEN`을 같은 새 토큰으로 바꾼다(위 "`revert` environment").
5. 옛 토큰을 지운다(Tokens (classic) 목록 → Delete).

확인:

- 봇이 머신마다 `node scripts/harness.ts ops-check`를 실행한다. 3번이 `✓ 봇 토큰에 workflow 권한이 없다(범위: read:org, repo)`면 그 머신의 토큰은 바뀌었다. 이 명령은 토큰 값을 읽지 않고 API 응답 머리말(`x-oauth-scopes`)만 본다.
- `revert` 시크릿은 봇이 값을 볼 수 없다. 제작자가 4번을 했다고 알려 주면 봇은 시크릿의 갱신 시각이 재발급 뒤인지만 확인한다.
- 실제 거부는 시험 PR로 본다(체크리스트 6). 워크플로 파일을 바꾼 브랜치를 push하면 GitHub이 `workflow` 권한이 없다는 오류로 거부한다.

## 워크플로 변경 절차 (제작자와 봇, 운영 단계)

봇 토큰에는 `workflow` 권한이 없어, `.github/workflows/`의 파일을 바꾼 커밋이 든 push는 GitHub이 거부한다. 워크플로를 바꿔야 할 때는 아래 순서로 한다. 2026-11-19에 주석 한 줄을 더하는 변경으로 해 본 순서다(Issue #139, 기록은 `lab/workflow-change/result.json`).

원칙은 둘이다.

- **워크플로 파일은 제작자가, 그 워크플로의 새 구조를 단언하는 테스트는 봇이 올린다.** 둘이 다 있어야 `check`가 통과하게 한다. 그러면 워크플로 커밋이 빠진 head는 봇의 테스트가 실패해 병합되지 않는다. 사람이 "패치가 들어갔는지"를 따로 확인하는 데 기대지 않는다.
- **제작자의 워크플로 커밋이 먼저, 봇의 테스트와 나머지 변경이 그 뒤다.** 봇이 올리는 head는 언제나 워크플로 변경이 든 상태 하나만 통과하면 된다. 순서를 반대로 하면(봇이 먼저 전부 올리고 제작자가 마지막에 패치를 올린다) 패치 전의 head와 뒤의 head가 둘 다 통과해야 해서 단언을 패치 안에 넣게 되고, 패치가 빠져도 `check`가 통과한다(Issue #135에서 이 순서로 계획했다가 접었다).

순서:

1. **봇**: Issue와 계획을 만들고, 워크플로에 넣을 변경을 패치 파일(`git diff` 형식, `lab/<작업>/` 아래)과 적용 방법으로 브랜치에 올린다. 패치에는 워크플로 파일만 넣는다. 새 구조를 단언하는 테스트를 먼저 써서 지금 워크플로에서 실패하고 패치를 적용하면 통과하는 것을 로컬에서 확인하되, 테스트는 아직 올리지 않는다. PR도 아직 열지 않는다(워크플로 커밋만 올라간 중간 head에서 `check`가 돌지 않게 한다). 이때 올린 커밋의 SHA를 기준 커밋으로 적어 둔다(계획의 진행 로그).
2. **봇 → 제작자**: Issue에 요청을 남긴다(`needs-human`). 넣을 줄과 위치, 브랜치 이름을 적는다.
3. **제작자**: GitHub 웹에서 그 브랜치의 워크플로 파일을 고쳐 그 브랜치에 바로 커밋한다. 에이전트가 도는 머신의 터미널에서 하지 않는다. 그 머신에는 제작자 자격증명을 두지 않는다(설계서 E5). 변경이 커서 웹에서 고치기 어려우면 에이전트가 돌지 않는 머신에서 패치를 적용해 push한다.
4. **봇**: 브랜치를 받아(`git fetch origin <브랜치>`, `git merge --ff-only origin/<브랜치>`) 제작자가 올린 것이 준비한 패치와 **전체가** 같은지 본다. 기준 커밋의 트리에 패치를 적용한 결과와 받은 head의 트리를 통째로 비교한다. 받은 직후, 봇이 커밋을 더하기 전에 한다(임시 인덱스를 쓰므로 작업 트리는 바뀌지 않는다).

   ```bash
   T=$(mktemp -d)
   want=$(export GIT_INDEX_FILE="$T/index"; git read-tree <기준 커밋> && git apply --cached <패치> && git write-tree)
   [ -n "$want" ] && [ "$want" = "$(git rev-parse 'HEAD^{tree}')" ] && echo 같다
   ```

   "같다"가 나오지 않으면(패치를 빠뜨렸다, 일부만 넣었다, 패치 밖의 파일이나 줄을 함께 바꿨다) 멈추고 제작자에게 알린다. `git apply --reverse --check <패치>`만으로는 부족하다. 패치의 줄이 들어 있는지만 보고, 함께 들어온 다른 변경은 보지 못한다. 같으면 테스트와 나머지 변경을 그 위에 커밋하고 `check`를 통과시킨 뒤 push한다. 워크플로 변경이 이미 원격 브랜치에 올라가 있으면, 그 위에 워크플로를 건드리지 않는 커밋을 올리는 봇의 push는 `workflow` 권한이 없어도 받아들여진다(확인함).

5. **봇**: PR을 열고(보호 경로라 위험도 높음, 초안) 판정을 받는다. 통과하면 `pr-ready`로 승인을 요청한다.
6. **제작자**: 승인한다. 봇이 자동 병합을 켜 두므로 승인하면 병합된다. 워크플로 변경이 든 PR에서도 봇이 자동 병합을 켤 수 있고 승인 뒤 병합된다(PR #141에서 확인). 자동 병합을 봇이 켜지 못하면(거부되면) 제작자가 승인 뒤 Squash 병합한다.
7. **봇**: 병합 뒤 main의 워크플로에 변경이 들어 있는지, 그다음 PR의 `check`와 판정 워크플로가 정상으로 도는지 보고 Issue에 남긴다. 판정 워크플로는 main의 정의로 돌기 때문에 변경은 병합 뒤의 실행부터 적용된다.

워크플로와 스크립트가 서로 기대는 변경(워크플로가 스크립트의 새 출력을 읽는 경우 등)은 한 PR에 넣고, 한쪽만 있어도 기존 동작이 되게 설계한다(값이 없으면 지금처럼 돈다).

계획 검증(G1)을 받는 중·대 규모 계획에서는 계획만 담은 초안 PR이 먼저 열려 있으므로 순서가 조금 다르다. 2026-11-19에 Issue #143(PR #144)에서 해 본 순서다.

- 계획 검증 승인 → 봇이 워크플로 파일과 그 구조 테스트를 뺀 나머지(스크립트, 테스트, 문서, 패치 파일)를 올려 판정을 받는다 → 제작자에게 요청한다 → 제작자의 워크플로 커밋 → 봇이 트리를 비교하고 구조 테스트와 완료 처리를 올린다. 설계 전체가 제작자에게 요청하기 전에 판정을 받으므로, 패치를 고쳐야 하는 지적은 그 전에 나온다. 완료 처리를 마지막 push에 두므로 그 앞의 head는 `plan-gate`를 통과하지 못한다.
- **제작자의 커밋만 올라간 head에서는 `check`가 실패한다.** 기존 구조 테스트가 옛 구조를 요구하기 때문이고, 기대한 실패다. PR #144에서는 그 head의 `check`가 `test`에서 실패했고(실행 44520682808), 판정 워크플로의 CI 실패 기록 job이 원장에 "CI 실패 기록" 한 줄을 남겼다. 검증자 판정은 돌지 않았다(`check`가 성공해야 돈다). `gates`는 그 head에도 돌아 `harness-guard`의 자체 테스트가 통과했다.
- 웹에서는 파일 하나에 커밋 하나라 파일이 둘이면 커밋이 둘이다. 첫 커밋의 `check`와 `gates`는 둘째 커밋으로 취소됐다. 트리 비교는 마지막 head의 트리로 하므로 커밋 수는 상관없다.
- 봇이 제작자의 커밋을 받자마자 다음 push를 올리면 실패할 `check` 실행은 진행 중에 취소된다. PR #144에서는 무엇이 기록되는지 보려고 끝까지 기다렸다. 보통은 바로 올린다.
- 기다리는 사이 main이 전진해 충돌이 생기면, 제작자의 커밋을 받은 뒤에 `origin/main`을 병합해 푼다(절차서 5절). 트리 비교는 병합 전에, 받은 head로 한다.

해 보지 않은 것:

- 워크플로를 바꾼 커밋이 main에서 실패해 revert 워크플로가 되돌리는 경우. `REVERT_BOT_TOKEN`에도 `workflow` 권한이 없어 revert 브랜치의 push가 거부될 것으로 예상한다(TD-38). 그때는 제작자가 손으로 되돌린다.
- main에 워크플로 변경이 들어간 뒤, 열려 있던 다른 PR을 `origin/main` 병합으로 갱신하는 봇의 push(TD-38).

## 테스트 리포 준비 (제작자, #102 step6)

운영 전환 체크리스트 5(빈 테스트 리포에서 자체 테스트와 전체 흐름)를 확인할 리포다. 하네스 리포와 같은 구성을 새 리포에 만든다. 에이전트는 리포·보호 설정·environment·App 설치를 하지 않는다(R20). 하네스 파일은 봇이 PR로 올린다.

순서: 아래 1~6을 끝내고 리포 이름을 알려 주면 봇이 하네스 파일을 PR로 올린다. 7(필수 체크 등록)은 그 뒤의 PR에서 체크가 한 번씩 보고된 다음에 한다. 8은 봇이 요청할 때 한다.

1. 리포: 제작자 계정에 새 **비공개** 리포를 만든다. "Add a README file"을 켜서 `main` 브랜치가 생기게 한다. 이름 예: `harness-ops-lab`.
2. 봇 초대: Settings → Collaborators → 봇 계정을 **Write**로 초대하고, 봇 계정으로 로그인해 초대를 수락한다. Admin·Maintain은 주지 않는다. 시험 기간에만 둔다([ADR-0004](decisions/ADR-0004-q20-lab-repo.md)).
3. 일반 설정(Settings → General): "Allow auto-merge" 켬, "Automatically delete head branches" 켬.
4. Actions 설정(Settings → Actions → General): Workflow permissions는 "Read repository contents and packages permissions", "Allow GitHub Actions to create and approve pull requests"는 끔. 리포 수준 시크릿은 만들지 않는다.
5. main 보호 규칙(Settings → Branches → Add classic branch protection rule, 패턴 `main`). 설계서 0.2절과 같게 둔다.
   - "Require a pull request before merging" 켬. 그 아래 "Require approvals"는 끔(필수 승인 0), "Dismiss stale pull request approvals when new commits are pushed" 켬, "Require review from Code Owners"는 지금은 끔(봇이 시험 순서에 맞춰 요청한다), "Require approval of the most recent reviewable push" 끔.
   - "Require status checks to pass before merging" 켬, "Require branches to be up to date before merging" 켬. 체크는 아직 고르지 않는다(7번).
   - "Do not allow bypassing the above settings" 켬. "Allow force pushes"와 "Allow deletions"는 끔.
6. App 두 개와 environment 다섯 개.
   - 검증 App(`harness-recorder`)과 인증 저장 App을 테스트 리포에도 설치한다: 각 App의 설정 → Install App → 계정 옆 톱니바퀴 → Repository access에 테스트 리포를 더한다.
   - environment는 Settings → Environments에서 만들고, 다섯 개 모두 "Deployment branches and tags"를 "Selected branches and tags"의 `main`만으로 제한한다.

   | environment        | 넣을 것                                                  | 값의 형식                                                                                                  |
   | ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | `recorder`         | 변수 `RECORDER_APP_CLIENT_ID`, 시크릿 `RECORDER_APP_KEY` | 검증 App의 Client ID(`Iv`로 시작하는 한 줄)와 개인 키(`.pem` 파일 내용 전체. 이 시험용으로 새 키를 만든다) |
   | `codex-auth-store` | 변수 `STORE_APP_CLIENT_ID`, 시크릿 `STORE_APP_KEY`       | 인증 저장 App의 Client ID와 개인 키(위와 같은 형식. 새 키)                                                 |
   | `judge-claude`     | 시크릿 `CLAUDE_CODE_OAUTH_TOKEN`                         | `claude setup-token`으로 새로 발급한 토큰 한 줄                                                            |
   | `judge-codex`      | 시크릿 `CODEX_AUTH_JSON`                                 | CI 전용으로 새로 로그인한 `auth.json` 파일의 내용(위 "Codex CI 인증 등록"의 절차를 한 번 더 한다)          |
   | `revert`           | 시크릿 `REVERT_BOT_TOKEN`                                | 봇 계정의 PAT 한 줄(`ghp_`로 시작한다)                                                                     |

7. 필수 체크 등록: 봇이 올린 PR에서 체크가 한 번씩 보고된 뒤, 위 "필수 체크 등록"의 절차로 `check`(GitHub Actions)와 `harness-recorder` 출처의 나머지를 등록한다. 봇이 등록할 때를 알려 준다.
8. 시험 Issue 두 건: 봇이 문안을 주면 **제작자 계정으로** 그대로 등록한다(runner는 제작자가 만든 Issue만 작업 대상으로 본다).

확인: 봇이 테스트 리포에서 `node scripts/harness.ts required-checks`와 `ops-check`를 실행하고, environment와 시크릿 이름은 `gh api repos/<owner>/<repo>/environments`로 본다(값은 볼 수 없다). 값이 틀리면 첫 PR의 판정 job 로그에 드러난다(예: 위 "Codex CI 인증 등록"의 흔한 실수 표).

봇이 테스트 리포에서 일하는 방식: 테스트 리포는 하네스 리포 옆에 따로 clone한다. 하네스 리포에서 연 대화 세션의 훅은 리포 밖 파일 쓰기를 R3으로 막으므로(Bash로 돌려 쓰지 않는다), 테스트 리포의 파일 내용은 그 리포의 worktree에서 띄운 세션이 쓴다. 지시서 파일을 표준 입력으로 주고 `claude -p --permission-mode dontAsk --settings .claude/runner-settings.json`으로 실행하면 테스트 리포의 훅과 무인 권한 프로필이 적용된다. 그 세션은 파일 수정·`check`·커밋까지 하고, `new-task`·push·PR 생성·자동 병합 켜기는 부른 세션이 테스트 리포 폴더에서 Bash로 한다. `git worktree add`로 직접 만든 worktree는 `setup`을 먼저 돌린다. 훅에 테스트 리포용 예외를 둘지는 정하지 않았다(TD-46).

남는 위험: 시험 기간에는 진짜 구독 인증과 App 키가 테스트 리포의 environment에 있고, 봇이 병합한 워크플로가 그 값을 받을 수 있다. ADR-0004는 이런 기간에 필수 승인을 1로 올리라고 했지만, 이 시험은 사람 승인 없는 자동 병합 자체를 확인해야 해서 0으로 둔다. 대신 시험용으로 새로 발급한 값만 넣고, 기간을 짧게 하고, 끝나면 바로 아래 정리를 한다.

시험 뒤 정리(제작자):

1. 테스트 리포에 넣은 자격증명을 폐기한다: Claude 토큰과 Codex 로그인을 다시 발급하거나 해제하고, 두 App에서 시험용으로 만든 개인 키를 지운다. `revert` environment의 `REVERT_BOT_TOKEN`은 하네스 리포에서 계속 쓰는 봇 PAT라 폐기하지 않고, 테스트 리포의 시크릿만 지운다(Settings → Environments → `revert`).
2. 두 App의 Repository access에서 테스트 리포를 뺀다.
3. 봇 초대를 철회한다. 확인: 봇이 `gh api 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100' --jq '.[].full_name'`을 실행하면 하네스 리포 하나만 나온다(ADR-0003).
4. 리포를 보관한다(Settings → General → Archive this repository).

## 유출 대응

시크릿 스캔(로컬·CI)이나 감사에서 시크릿이 검출되면 이미 원격에 올라간 것으로 본다.

1. **해당 키를 즉시 폐기·재발급한다.** 항상 이것이 먼저다.
2. 그 자격증명의 사용 로그를 조사한다.
3. 영향받은 환경(개발 환경, 에이전트 세션)을 다시 만든다.
4. 이력 삭제는 보조 수단이다. force push로 지워도 `refs/pull/<번호>/head`에 남는다. force push가 필요하면 제작자가 예외 절차(설계서 14.5절)로 한다.

## 강제 장치 요약

| 위험                            | 장치                                                                                                      | 보장 수준(1단계)                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| main 직접 push                  | 브랜치 보호 + 봇에 우회 권한 없음 / L1 훅                                                                 | 차단                               |
| 제작자 권한 사용(R20)           | L1 훅(브라우저 MCP 도구의 GitHub 주소 포함) + E5                                                          | 절차(E5를 지키면 사실상 차단)      |
| 시크릿 커밋(R10)                | `.gitignore` + L1 훅 + `check`의 gitleaks + CI                                                            | 절차(push 전) + 검출(push 후)      |
| DB·파괴적 명령(R13, R14)        | 운영 자격증명 없음 / L1 훅                                                                                | 차단(권한) + 절차(로컬)            |
| MCP 도구의 삭제·메일 발송(R14)  | L1 훅(`guard.mcp`: 도구 이름의 삭제 단어, 발송 도구 목록)                                                 | 절차(이름이 규칙에 걸리는 도구만)  |
| 하네스 파일(보호 경로) 변경(R9) | 운영 단계: 코드 오너 리뷰 필수 + `risk-gate`(위험도 높음, 제작자 head 승인) + `harness-guard`·자체 테스트 | 차단(제작자 승인 없이는 병합 불가) |
| 봇의 워크플로 파일 변경         | 봇 토큰에 `workflow` 권한 없음(GitHub이 push를 거부)                                                      | 차단                               |
