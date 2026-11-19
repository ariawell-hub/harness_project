---
id: 20261119-metrics
issue: 146 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T22:49:45+09:00 # new-task가 채운다
---

# 17.2절 지표 집계: metrics 명령으로 QUALITY_SCORE.md를 채운다

## 목표와 수용 기준

설계서 17.2절은 지표를 "주간 정기 작업에서 집계해 `docs/QUALITY_SCORE.md`에 기록한다"고 정한다. 지금은 집계 수단이 없어 `docs/QUALITY_SCORE.md`의 값이 모두 `—`다. 로드맵 3단계(파일럿)의 완료 기준이 "17.2절 파일럿 판정 지표가 수집된다"이므로, 파일럿 착수 전에 지표를 집계하는 명령을 만들고 지금까지의 자료로 첫 집계를 기록한다. 주 1회 자동 실행은 4단계(TD-11)에 남기고, 이 계획은 그 정기 작업이 부를 명령까지 만든다.

수용 기준:

1. `node scripts/harness.ts metrics --since <YYYY-MM-DD> --until <YYYY-MM-DD>`가 그 기간(UTC 날짜, 양끝 포함)에 병합된 PR을 대상으로 지표를 집계해 마크다운으로 표준 출력에 낸다. 날짜를 주지 않으면 `until`은 오늘(UTC), `since`는 `until`의 6일 전이다. 읽기만 한다(GitHub에 쓰지 않는다).
2. 파일럿 판정 지표 넷(병합 후 결함, 검증 누락, 오탐, PR당 대기 시간·사용량)이 step0의 정의대로 계산된다. 고정한 입력으로 계산 함수를 부르는 테스트가 값을 단언한다.
3. `--write`를 주면 `docs/QUALITY_SCORE.md`의 표식 구간(`<!-- metrics:begin -->` ~ `<!-- metrics:end -->`)만 집계 결과로 바꾼다. 구간 밖(frontmatter, 측정 정의, 등급 절)은 바이트 단위로 그대로다. 같은 자료로 두 번 실행하면 파일이 같다.
4. 자료를 끝까지 읽지 못하면(GitHub 조회 실패, 결과가 조회 상한에 닿음) 종료 코드 2로 끝나고 문서를 고치지 않는다. 메인 체크아웃(어느 브랜치로 바꿔 놓았든)이나 기본 브랜치의 worktree에서 `--write`를 주면 자료를 읽기 전에 종료 코드 1로 거부한다(R3). 표식 구간이 없는 문서도 종료 코드 1이다.
5. 상시 지표는 지금 자료로 잴 수 있는 것을 모두 잰다(step1: GitHub 자료, step2: 리포 파일과 로컬 로그). 잴 수 없는 지표는 값 대신 이유와 TD 번호를 출력한다. step2가 끝나면 17.2절의 상시 지표 항목마다 값 또는 이유 한 줄이 집계 결과에 있다.
6. 집계 결과에는 수와 PR·Issue 번호만 적는다. PR·Issue·지적의 제목과 본문 같은 외부 입력 문자열은 문서에 옮기지 않는다(14.6절).
7. `docs/QUALITY_SCORE.md`에 지표별 측정 정의가 있고, 이 리포의 2026-11-11부터 step0 작업일까지의 첫 집계가 기록된다. 설계서 17.2절, `docs/harness/architecture.md`, `CHANGELOG`, 기술 부채 표(TD-11)가 바뀐 상태와 맞는다.

## 범위 / 비범위

범위:

- 새 폴더 `scripts/metrics/`(자료 읽기, 지표 계산, 렌더)와 새 명령 파일 `scripts/commands/metrics.ts`, 새 테스트 파일.
- `scripts/harness.ts`: `metrics` 명령 등록(도움말, 옵션 `since`·`until`·`self-test-report`, `case 'metrics'`).
- `docs/QUALITY_SCORE.md`, 설계서 17.2절, `docs/harness/architecture.md`, `CHANGELOG`, 기술 부채 표.

비범위:

- 주 1회 자동 실행(정기 작업, 워크플로 파일, 12.2절). TD-11에 남긴다.
- 지표를 얻으려고 기록을 새로 남기는 일: L1 훅의 차단 기록(R13·R14·R20 차단 횟수), `pr-size`·`scope` 게이트(TD-6). 잴 수 없는 지표로 표시하고 TD로 남긴다.
- 지표를 보고 기준값(Q9, Q15, Q19)을 고치는 일, 도메인·레이어별 등급.
- `scripts/lib/github.ts`의 `GitHubPort`와 `github-fake.ts` 변경. 지표용 조회는 `scripts/metrics/` 안에 둔다.
- 다른 세션(Issue #140)이 맡은 것: `scripts/verify/**`, `scripts/commands/standard.ts`, `profiles/web/**`, `lab/pilot-prep/**`, `.claude/skills/web-verify/`, `.gitignore`, 설계서 11.1절, `workflow.md` 4절, 기술 부채 표의 TD-12 행, `architecture.md`의 `verify/*`·`commands/standard.ts` 행.

## 관련 파일·문서

- `scripts/metrics/source.ts`, `scripts/metrics/pilot.ts`, `scripts/metrics/render.ts`, `scripts/metrics/steady.ts`, `scripts/metrics/plans.ts`, `scripts/metrics/local.ts`(모두 새 파일)
- `scripts/commands/metrics.ts`(새 파일), `scripts/harness.ts`(명령 등록)
- `scripts/test/metrics-pilot.test.ts`, `scripts/test/metrics-command.test.ts`, `scripts/test/metrics-steady.test.ts`, `scripts/test/metrics-local.test.ts`(모두 새 파일)
- `docs/QUALITY_SCORE.md`
- `docs/harness/design.md`(17.2절, 버전 줄), `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `scripts/ci/ledger.ts`, `scripts/ci/ledger-store.ts`, `scripts/runner/ledger-read.ts`, `scripts/lib/github.ts`, `scripts/lib/exec.ts`, `scripts/lib/git.ts`, `scripts/lib/plan.ts`, `scripts/lib/config.ts`, `scripts/gates/doc-lint.ts`, `scripts/runner/run.ts`, `scripts/selftest/run.ts`

## step 목록

- step0 pilot: `metrics` 명령, GitHub 자료 읽기, 파일럿 판정 지표 넷, `--write`, `docs/QUALITY_SCORE.md` 구조와 첫 집계, 설계서·구조 문서.
- step1 steady-github: GitHub 자료로 재는 상시 지표(리드타임, CI 첫 통과율, 리뷰 라운드, 에스컬레이션, 위험도별 PR 수, PR 크기).
- step2 steady-local: 리포 파일과 로컬 로그로 재는 상시 지표(방법 전환, 발견 사항 처리 분포, 검토 필요 문서, runner 실행·세션, 자체 테스트 통과율), 잴 수 없는 지표의 이유 표시, 기술 부채 표 정리.

## 진행 로그

- 2026-11-19 22:50 Issue #146 등록(제작자 대화 지시), `new-task`로 worktree 생성. 자료 조사: 병합 PR 96개, 원장 댓글은 `harness-recorder[bot]`이 쓰고, 워크플로 실행은 하루 250건 안팎이다(2026-11-19).
- 2026-11-19 22:57 계획과 step0~2 작성, 계획만 담은 커밋을 올리고 초안 PR #147을 열었다.
- 2026-11-19 23:05 계획 검증 1라운드(head `caf9391`): claude 승인, codex 수정 요청(P1 10건, F1~F10). F2~F10을 계획에 반영했다: 조회 상한 판정(1000 이상), 검증 누락을 원인 PR이 이어지는 main 실패로 한정, `--write`의 메인 체크아웃 거부, 첫 집계 확인(AC의 `grep`과 독립 조회 대조), 리드타임을 계획 `claimed_at` 기준으로, CI 첫 실행을 PR이 열려 있던 시간으로 귀속, 충돌 중단 보고 분리, 라벨 수와 사유별 댓글 수를 따로, `judge-fail`을 AC 실패와 표준 검사 실패로 가름. F1(계획 `risk`)은 반박한다: 절차서 1절이 high를 보안·인증·마이그레이션·데이터 스크립트에만 붙이게 하고, 운영 단계의 보호 경로 변경은 계획 `risk`와 무관하게 `risk-gate`가 PR을 높음으로 판정한다(절차서 5절). 승인 절차는 step 파일에 적었다.
- 2026-11-19 23:12 계획 검증 2라운드(head `a4df80e`): claude 승인. codex는 F1 반박을 받아들였고(rejected) F2~F4·F6·F8·F9를 닫았다. 열린 것 F5·F7·F10과 새 지적 F11을 반영했다: 대조 기록에 기대 종료일을 넣고 AC가 종료일(AC 실행일 UTC)을 본다(F5), CI 실행을 PR의 커밋 SHA와 같은 리포 여부로 잇고 이을 수 없는 PR을 가른다(F7), AC 실패를 확인 수~확인+미확인 수의 범위와 TD로 낸다(F10), 기간 직전의 main `check` 결론을 읽어 기간 첫 실패의 전환 여부를 정한다(F11).
- 2026-11-19 23:25 계획 검증 3라운드(head `1cdbe20`): claude 승인. codex는 F5·F10·F11을 닫았고 F7만 열려 있다(같은 head 브랜치에서 base가 다른 PR). Actions 실행 목록의 `pull_requests`가 병합된 PR에서는 비어 있는 것을 확인했다(2026-11-12 27건, 11-18 10건 모두 0개). PR 번호로 이을 수 없으므로, 다른 base로 열린 적이 있는 head 브랜치의 PR을 지표에서 빼고 따로 세게 했다(`-base:main` 조회는 지금 0건).
- 2026-11-19 23:32 계획 검증 4라운드(head `6c8cac2`): claude 승인. codex는 판정 없음(`error`)이다. 판정 job의 유출 검사가 `판정 형식 오류: resolutions[6].note가 문자열이 아니거나 너무 길다`로 끝났다(실행 44542064356). 인증·한도 문제가 아니라 검증자 출력의 형식 문제다. 이 기록을 올리는 push로 다시 판정받는다.
- 2026-11-19 23:45 계획 검증 5라운드(head `0aeeec6`): claude 승인. codex는 F7을 다시 열어 두었다(닫았다 다시 연 PR과 base를 바꾼 다른 PR이 같은 head를 쓰는 경우). 경우를 하나씩 막지 않고, head 브랜치 이름으로 열린 PR이 그 PR 하나뿐일 때만 실행을 잇도록 바꿨다(`headPrCount`). `origin/main`(#145 병합, `72ef9b9`)을 함께 병합한다.

## 의사결정 로그

- 결정: 지시 "17.2절을 진행하라"를 "17.2절 지표를 집계하는 명령을 만들고 첫 집계를 기록한다"로 잡는다. / 이유: 17.2절이 요구하는 것은 집계와 기록이고, 정기 실행 수단(12.2절)은 로드맵 4단계·TD-11이며 봇은 워크플로 파일을 올릴 수 없다. 3단계 완료 기준에는 수집만 있으면 된다. / 버린 대안: 주간 워크플로까지 한 계획에 넣기(제작자 워크플로 커밋이 필요하고 4단계 범위다).
- 결정: 세로로 나눈 step 3개(파일럿 지표 → GitHub 상시 지표 → 로컬 상시 지표). / 이유: step0만 병합돼도 파일럿 판정 지표를 쓸 수 있고 PR이 작아진다. / 버린 대안: 레이어별 분할(자료 → 계산 → 명령)은 마지막 step 전까지 명령이 없다. PR 하나로 하면 1000줄을 넘는다.
- 결정: 지표용 GitHub 조회를 `GitHubPort`에 더하지 않고 `scripts/metrics/source.ts`의 `MetricsSource`로 따로 둔다. 원장만 기존 `readPrLedger`(검증 App 봇이 쓴 댓글만 인정)를 그대로 쓴다. / 이유: `GitHubPort`와 가짜 구현은 runner·게이트 전체가 쓰고 다른 세션의 작업과 겹칠 수 있다. 지표 조회는 기간 단위 묶음 조회라 성격이 다르다. / 버린 대안: `GitHubPort` 확장.
- 결정: 검증 누락 = 병합 커밋에서 main `check`가 실패로 바뀐 PR의 수(재실행 뒤 통과와 이미 실패 중인 main에 이어진 실패는 뺀다). 버그 Issue는 더하지 않고 병합 후 결함으로만 낸다. / 이유: 원인 PR이 이어지는 것만 "검증자가 놓친 것"으로 셀 수 있다. 버그 Issue를 더하면 같은 결함을 두 번 세거나 그 기간의 병합과 무관한 버그를 센다(계획 검증 1라운드 F3). / 버린 대안: main 실패 수 + 버그 Issue 수(처음 안), 버그 Issue에 원인 PR을 적는 표기 규칙을 새로 정하기(절차 변경이라 이 계획 밖).
- 결정: 리드타임의 시작은 계획 frontmatter의 `claimed_at`이다. / 이유: `new-task`가 계획을 만들 때 적는 시각이라 "계획 생성"에 그대로 해당한다. PR의 첫 커밋 시각은 계획이 없는 PR에도 있고 둘째 step부터는 앞선 기간을 빠뜨린다(F6).
- 결정: 오탐의 분모는 차단 지적(P0·P1 가운데 상태가 `deferred`가 아닌 것)이다. / 이유: 17.2절이 "차단 지적"과 "반박이 받아들여진 지적"을 말하고, 반박은 열린 차단 지적에만 낼 수 있다. 동결된 P1과 P2·P3은 병합을 막지 않았다.
- 결정: 집계 결과는 목록으로 쓰고 표를 쓰지 않는다. 집계 시각은 넣지 않는다. / 이유: `docs/QUALITY_SCORE.md`는 prettier 검사 대상이고 prettier는 표의 열을 문자 폭에 맞춰 정렬한다. 목록은 그대로 통과한다. 시각을 넣지 않으면 같은 자료에서 같은 파일이 나온다. / 버린 대안: 표와 폭 계산 구현, 실행 뒤 `fmt` 강제.
- 결정: 추이(주별 값의 변화)는 문서에 쌓지 않고 git 이력으로 본다. / 이유: 최소 구성으로 시작한다(B4). 파일럿에서 필요해지면 더한다.
- 결정: 버그 Issue는 라벨 `bug`로 가린다(코드 상수). / 이유: GitHub 기본 라벨이고 이 리포에 이미 있다. 설정 키를 더하면 `harness.config.json`(보호 경로)의 형식이 바뀐다.

## 발견 사항

- 실패 기록(`attempts.jsonl`)은 worktree별 git-dir에 있어 worktree를 정리하면 사라진다. 3회 방법 전환·5회 중단 횟수를 실패 기록에서 셀 수 없어, 계획의 의사결정 로그(`방법 전환(` 줄)와 Issue의 중단 보고 댓글로 센다(step1·step2).
- L1 훅은 차단을 기록하지 않는다. R13·R14·R20 차단 횟수는 지금 잴 수 없다(step2에서 TD로 등록한다).
- Actions 실행 목록 API는 `created` 조건을 쓰면 조회 하나에 1000건까지만 준다. 이 리포는 하루 250건 안팎이라 한 주를 한 번에 읽을 수 없다. 하루 단위로 나눠 읽고 `total_count`와 견준다(step0).

## 열린 질문

없음.

## 검증 방법과 결과

- 각 step의 AC(새 테스트 파일)와 `node scripts/harness.ts check`.
- step0: 이 리포에서 `metrics --since 2026-11-11 --until <작업일> --write`를 실제로 실행해 `docs/QUALITY_SCORE.md`에 기록한다. 값 몇 개를 `gh` 조회로 따로 세어 맞는지 진행 로그에 적는다.

## 다음 할 일

- 계획만 담은 커밋을 push하고 초안 PR을 열어 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다.
- 다른 세션(Issue #140)과의 합의: 설계서·`CHANGELOG`·기술 부채 표를 고치는 PR은 한 번에 하나만 올린다. push 직전에 `origin/main`을 병합하고 그때의 마지막 설계서 버전 다음 번호를 쓴다. 새 TD 번호는 병합 순서대로 잡는다.
