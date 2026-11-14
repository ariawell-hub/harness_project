---
id: 20261114-ci-gates
issue: 53 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-14T14:00:56+09:00 # new-task가 채운다
---

# feat: 2단계① CI 기계 판정과 기록 job — risk-gate·deps-guard·harness-guard, 검증 App 기록 (TD-2·TD-10)

## 목표와 수용 기준

로드맵 2단계(설계서 19절)를 Issue 5개(#53~#57)로 나눈 것 중 첫째다. LLM 없이 규칙으로 판정하는 필수 체크와, 그 결과를 작성자가 흉내 낼 수 없는 출처(검증 App)로 기록하는 기반을 만든다. 이후 ②(#54 판정 job)·③(#55 원장)이 이 기록 job에 `review/*`·`review-ledger`를 더한다.

수용 기준:

1. `pull_request_target`(main 정의) 워크플로 `gates`의 판정 job이 `base/`(실행 중인 main 끝 `github.sha`)의 스크립트만 실행하고 `pr/`를 데이터로 읽어 `plan-gate`·`risk-gate`·`deps-guard`·`harness-guard` 결과를 하나의 결과 파일로 낸다. 비밀·캐시가 없고, PR 입력은 `run:` 스크립트에 직접 넣지 않고 환경 변수로 넘긴다.
2. 기록 job(`recorder` environment, 검증 App 토큰)이 결과 파일을 스키마(정해진 context·state·길이, head SHA 일치)로 검사한 뒤에만 PR head에 커밋 상태를 쓴다. 결과가 없거나 깨졌으면 아는 context 모두에 `error`를 쓴다(fail-closed). LLM을 실행하지 않고 PR 코드를 실행하지 않는다.
3. `risk-gate`: 계획 `risk`, `base` 설정의 경로별 최소 위험도(`riskPaths`), `stage`별 보호 경로 위험도(build=보통, operation=높음), 판정할 수 없는 파일 형식(바이너리=높음), `harness-guard`가 올린 신호 중 최댓값. "높음"이면 제작자 계정(`github.owner`)이 head SHA를 승인했을 때만 통과하고, 승인이 PR 갱신 뒤에 와도 다시 판정된다.
4. `deps-guard`: lockfile에서 새로 생긴 모든 패키지 버전에 레지스트리 실존, 게시 후 경과 기간(Q14, 14일), 라이선스 허용 목록, 알려진 취약점(OSV)을 확인한다. 새 직접 의존성은 같은 PR의 ADR이 패키지 이름을 언급해야 한다. lockfile이 바뀌지 않으면 네트워크 없이 통과한다.
5. `harness-guard`: 보호 경로가 바뀌면 `docs/harness/CHANGELOG.md` 갱신과 PR 본문의 보호 경로 체크리스트를 요구한다. 워크플로 캐시 사용은 실패로, 검사 약화(워크플로·job 삭제, 표준 명령·보호 경로·위험도 표·`stage` 변경)·샌드박스·권한 완화(10.4절 목록)·정해 둔 environment 밖 참조는 탐지해 PR에 표시한다(처리 방식은 열린 질문 1).
6. 제작자가 네 상태를 검증 App 출처의 필수 체크로 등록하고 `plan-gate`의 출처를 GitHub Actions에서 검증 App으로 바꾼 뒤, 옛 `plan-gate.yml`을 지운다. 봇이 `branches/main`의 `app_id`로 등록을 확인하는 명령이 있다(TD-2 해결). runner 세션 판정이 worktree 설정을 쓰는 문제(TD-10)는 `harness-guard`의 표준 명령 약화 탐지로 해결한다.
7. 각 검사는 임시 git 리포 테스트로 통과·실패 경로를 모두 확인하고, 실제 PR에서 기록된 상태(작성자 = 검증 App)를 진행 로그에 남긴다.
8. 설계서(0.2·10.3·10.4절)·절차서·`architecture.md`·`CHANGELOG`·기술 부채 목록이 구현과 맞는다.

## 범위 / 비범위

- 범위: `scripts/ci/`(결과 조립·기록), `scripts/gates/`(risk-gate, deps-guard, harness-guard), `harness.ts` 명령, `.github/workflows/`의 `gates`·리뷰 재판정 트리거, PR 템플릿, 설정 스키마(`riskPaths`·`deps`·`ci`), 문서.
- 비범위: LLM 판정과 `review/*`(#54), 지적 원장·재현 job·G1(#55), runner 대응(#56), revert·자체 테스트·운영 전환(#57), `pr-size`·`scope`(TD-6), R5 테스트 실효성(TD-4), 브랜치 보호 설정 변경(제작자가 한다, R20).

## 관련 파일·문서

- scripts/ci/
- scripts/gates/
- scripts/lib/
- scripts/harness.ts
- scripts/test/
- .github/workflows/
- .github/pull_request_template.md
- harness.config.json
- profiles/
- docs/harness/design.md
- docs/harness/workflow.md
- docs/harness/architecture.md
- docs/harness/CHANGELOG.md
- docs/SECURITY.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261114-ci-gates/

## step 목록

- step0 gates-record: 결과 파일 형식, `gates`(plan-gate 포함)·`record-status` 명령, `gates.yml`(판정 job + 기록 job)
- step1 risk-gate: 위험도 판정, 제작자 head 승인 확인, 리뷰 뒤 재판정 트리거
- step2 harness-guard: 보호 경로 변경 검사, 약화·완화·캐시·environment 탐지
- step3 deps-guard: lockfile 변경의 실존·게시 기간·라이선스·취약점·ADR
- step4 required-checks: 필수 체크 출처 전환 확인 명령, 옛 `plan-gate.yml` 제거, 문서 정리(TD-2·TD-10)

## 진행 로그

- 2026-11-14: 제작자 대화 지시("로드맵 2단계를 진행해달라")로 2단계를 Issue #53~#57로 나눠 봇이 등록했다. 이 계획(#53)을 대화 세션에서 작성했다. 현재 main 필수 체크는 `check`·`plan-gate`(둘 다 GitHub Actions 출처, app_id 15368)이고 리포에 environment가 없다(봇 API로 확인).
- 2026-11-14 step0: 제작자 답 2건(약화·완화 → 위험도 높음, ISC 허용)을 의사결정 로그에 기록. 테스트 `scripts/test/ci.test.ts`를 먼저 써서 실패 확인(`ERR_MODULE_NOT_FOUND: scripts/ci/gates.ts`). `scripts/ci/{results,gates,record}.ts`, `harness.ts gates`·`record-status`, `.github/workflows/gates.yml` 구현 뒤 13개 통과. 테스트를 고친 2건은 fixture 문제였다(마지막 step 완료인데 계획이 active에 있음 → step 2개로, 예외 유발을 없는 base 대신 `planReview` 없는 설정으로). AC 명령 통과. 발견 사항(부트스트랩)은 설계서 10.4절에 바로 반영(v0.7.17). 실제 동작은 step1 PR에서 확인한다.

## 의사결정 로그

- 2단계를 Issue 5개로 나눈다: ① 기계 판정·기록(#53) → ② 판정 job(#54) → ③ 원장·재현·G1(#55) → ④ runner 연결(#56) → ⑤ revert·자체 테스트·운영 전환(#57). 이유: 한 계획에 20개 넘는 step을 넣으면 인수인계가 어렵고, 기록 job이 ②·③의 공통 기반이라 먼저 있어야 한다. 버린 대안: 계획 하나(너무 큼), 검사마다 Issue(기록 기반을 여러 Issue가 공유해 순서가 얽힘).
- 기록은 commit status로 한다. 이유: 설계서 10.3절이 "커밋 상태"로 적었고 Q20 check-source가 status의 출처 고정을 확인했다. check run의 App 출처 인정은 시험하지 않았다. 버린 대안: check run.
- 판정 결과는 판정 job 출력(base64 JSON)으로 기록 job에 넘긴다. 기록 job은 그 값을 환경 변수로만 받아 base 스크립트로 검사한다. 이유: 아티팩트 액션을 더 쓰지 않고, 비밀 job에 PR 유래 값이 셸 코드로 들어가지 않게 한다. 버린 대안: 아티팩트 업로드·다운로드, 기록 job이 직접 판정(비밀 job이 PR 데이터를 오래 다룸).
- 판정 job은 `base/`를 `github.sha`(실행 중인 main 끝)로 받는다. 이유: 10.4절(Q20). 옛 `plan-gate.yml`의 `base.sha` 체크아웃은 step4에서 파일째 지운다.
- 체크 하나에 job 하나가 아니라 판정 job 하나가 네 검사를 모두 돌린다. 이유: 체크아웃·설치가 한 번이고, 기록은 어차피 기록 job 하나가 한다. 검사 하나가 예외로 죽어도 그 context만 `error`가 되게 검사마다 격리한다.
- 제작자 승인 뒤 재판정은 `pull_request_review` 트리거 워크플로(비밀·권한 없음) → `workflow_run`(main 정의)으로 `gates`를 다시 돌린다. 이유: `pull_request_review`는 PR 쪽 정의로 돌아 main 전용 environment(`recorder`)를 못 쓰고, `pull_request_target`은 리뷰에 반응하지 않는다. `workflow_run` 쪽은 페이로드를 믿지 않고 PR 번호로 API를 다시 조회해 현재 head에만 판정한다. 버린 대안: 제작자가 Actions에서 재실행(절차 부담), 정기 실행(지연).
- 기록 job은 `permissions: contents: read`를 둔다. 이유: 비공개 리포에서 `base/`의 `scripts/`를 체크아웃하려면 `GITHUB_TOKEN` 읽기가 필요하다. 상태 쓰기는 `GITHUB_TOKEN`이 아니라 검증 App 토큰(`permission-statuses: write`만)으로 한다. 버린 대안: `permissions: {}`(체크아웃 실패).
- `record-status`는 결과가 깨져도 모든 기계 판정을 `error`로 쓴 뒤 종료 코드 1로 끝난다. 이유: 상태가 없으면 PR 화면에 원인이 보이지 않고, job 실패로 기록 job 로그를 보게 한다.
- (제작자 결정, 2026-11-14 대화) 보호 경로의 검사 약화·샌드박스·권한 완화·정해 둔 environment 밖 참조를 탐지하면 `harness-guard`는 표시만 하고 `risk-gate`가 위험도를 "높음"으로 올린다. 제작자 head 승인이 있어야 병합된다. 캐시 사용·`CHANGELOG`·체크리스트 누락은 작성자가 고칠 수 있으므로 `harness-guard` 실패다. 이유: 10.1절 "위험도는 올릴 수만 있다"와 같은 방향이고, 정당한 변경을 막지 않으면서 사람 확인을 강제한다. 버린 대안: 탐지 즉시 실패(정당한 완화도 제작자가 보호 설정을 풀어야 함), 표시만(②가 생기기 전엔 아무도 막지 않음).
- (제작자 결정, 2026-11-14 대화) `deps-guard` 라이선스 허용 목록: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD, ISC. SPDX 식은 `OR` 중 하나, `AND`는 모두 허용이어야 통과. 이유: ISC는 MIT 수준의 허용 라이선스이고 npm에서 흔하다. 버린 대안: Q14 그대로(ISC 전이 의존성마다 막힘). 설계서 18절 Q14에 반영한다(step3).

## 발견 사항

- `pull_request_target` 워크플로는 main에 들어간 뒤에만 돈다. 체크를 도입하는 PR은 그 체크를 자기 PR에서 통과할 수 없어서, 10.4절 부트스트랩의 "그 체크가 자기 PR에서 통과해야 병합"이 이 체크들에는 성립하지 않는다. 다음 PR(step1)에서 처음 동작을 확인한다. → 처리: [설계서 10.4절 부트스트랩](../../../harness/design.md) (step0에서 반영)

## 열린 질문

답을 받은 질문 2건은 의사결정 로그로 옮겼다(2026-11-14 제작자 답).

### 준비 요청(질문 아님): 검증 App과 `recorder` environment

step0이 병합되기 전에 제작자가 준비한다. 봇은 관리자 권한이 없다(0.2절).

1. GitHub App 생성: 이름 자유(예: `harness-recorder`), webhook 끔, "Only on this account". 권한은 Commit statuses 쓰기, Pull requests 읽기, Contents 읽기(Metadata 읽기는 자동). 이 리포에만 설치.
2. environment `recorder` 생성: Deployment branches = Selected branches `main`만. 변수 `RECORDER_APP_CLIENT_ID`(App의 Client ID), 시크릿 `RECORDER_APP_KEY`(Credentials → Key pairs → New key로 만든 개인 키 전체).
3. 없는 environment를 워크플로가 참조하면 GitHub이 규칙 없이 새로 만든다(Q20). 2를 먼저 하지 못했으면, 생긴 `recorder`에 2의 브랜치 제한을 꼭 건다.
4. 필수 체크 등록은 step1 PR에서 App이 네 상태를 한 번 보고한 뒤 step4에서 요청한다.

## 검증 방법과 결과

- step마다 AC 명령과 `node scripts/harness.ts check`.
- step1부터 실제 PR에서 `gates` 실행과 기록된 상태의 작성자(`creator.login` = 검증 App 봇)를 `gh api repos/<리포>/commits/<head>/statuses`로 확인해 진행 로그에 남긴다.
- step4에서 `branches/main`의 `required_status_checks.checks[].app_id`가 검증 App이고, 옛 Actions 출처 `plan-gate`가 없음을 확인한다.

## 다음 할 일

- step0 gates-record 구현. 제작자에게 열린 질문 2건과 준비 요청을 전달한다.
