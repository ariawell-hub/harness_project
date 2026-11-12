---
id: 20261111-q20-lab
issue: 12 # GitHub Issue 번호
type: chore # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: large # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-11T20:41:27+09:00 # new-task가 채운다
---

# chore: Q20 시험 — 2단계 CI 보안 설계를 시험 리포에서 검증

## 목표와 수용 기준

설계서 Q20의 항목이 개인 계정 비공개 리포(GitHub Pro)에서 실제로 되는지 시험 리포 `ariawell-hub/harness-q20-lab`에서 확인한다. 결과로 로드맵 2단계 착수 여부와 설계 수정 필요를 정한다. 운영 방식은 [ADR-0004](../../../decisions/ADR-0004-q20-lab-repo.md)를 따른다.

수용 기준:

1. 시험 항목 7개(`env-ref`, `patch-id`, `check-source`, `judge-claude`, `judge-codex`, `codex-auth`, `merge-queue`)마다 `lab/q20/results/<항목>.json`에 사례별 기대·관찰·판정·근거(워크플로 실행 URL 등)가 있고, `node lab/q20/report.ts --all`이 통과한다. 판정이 "실패"여도 기록이 완결되면 통과다.
2. 실패·부분 통과 항목은 설계서 수정 또는 제작자 질문으로 넘겨져 있다. Codex 인증이 안 되면 E3 재결정을 제작자에게 묻는다.
3. 설계서 Q20 행과 19절에 결과 요약이 있다.
4. 시험에 쓴 진짜 자격증명을 교체했고, 봇의 시험 리포 초대가 철회됐다(ADR-0004 확인 명령 결과를 기록).

## 범위 / 비범위

- 범위: `lab/q20/`(시험 리포 내용, 배포·결과 도구, 결과), 설계서 Q20 관련 절, 필요한 ADR, 기술 부채 목록.
- 비범위: 2단계 실제 구현(판정·기록 job을 하네스 리포 `.github/`에 넣는 일), 하네스 리포의 보호 설정 변경, 시험 리포 밖 계정 설정.

## 관련 파일·문서

- lab/q20/
- docs/exec-plans/active/20261111-q20-lab/
- docs/harness/design.md
- docs/harness/CHANGELOG.md
- docs/decisions/
- docs/exec-plans/tech-debt-tracker.md

## step 목록

- step0 lab-scaffold: 시험 리포 내용(`lab/q20/repo/`)·배포 도구·결과 검사 도구, 기준 배포, merge queue 가능 여부
- step1 patch-id: rebase·"Update branch" 뒤 patch-id가 유지되는지
- step2 env-ref: `pull_request_target`의 ref와 역할별 environment(가짜 시크릿)
- step3 check-source: 필수 체크 출처를 시험 App으로 고정할 수 있는지
- step4 judge-claude: Claude 판정 job 격리(진짜 토큰)
- step5 judge-codex: Codex 판정 job 격리와 인증 수명주기(진짜 인증)
- step6 wrap-up: 설계서 반영, 자격증명 교체, 봇 초대 철회 확인, 시험 소스 정리

## 진행 로그

- 2026-11-11: 계획 작성(대화 세션). 시험 리포 초기 상태를 봇 API로 확인했다.
- 2026-11-11 step0: `lab/q20/deploy.ts`·`report.ts`와 테스트 8개(로컬 bare 원격으로 기본·overlay 모드) 작성. 테스트를 구현과 함께 써서 먼저 실패한 기록은 없다. 기준 배포(시험 리포 PR #1, squash 병합) 완료. merge queue 결과 기록. 제작자 설정 화면 확인은 요청 중.
- 2026-11-12 13:37 (KST) step1 계획 수정(제작자 승인, 대화): ADR-0006으로 PR 갱신이 rebase + `--force-with-lease`에서 `origin/main` 병합 + 일반 push로 바뀌어, step1 사례 (1)·3을 병합 방식으로 고쳤다. 사례 4는 시험 리포 보호 설정을 바꾸지 않고(R20) 병합 직전 최신 확인으로 전제를 시험한다. 실행 PR은 자기 step 파일을 고칠 수 없어(plan-gate) 계획 수정만 별도 PR로 낸다.
- 2026-11-12 13:39 (KST) step1 시험 도구 `lab/q20/patch-id.ts`(PR patch-id 계산, 작업 트리 없이 커밋·병합 커밋 만들기, `--experiment`로 시험 전체 실행)와 테스트 3개(`lab/q20/test/patch-id.test.ts`). 구현을 먼저 쓰고 테스트를 뒤에 써서 먼저 실패한 기록은 없다.
- 시험 실행 4회. 앞의 3회는 도구 결함으로 버렸고, 결과는 4회차만 쓴다.
  - 1회(시험 리포 PR #2~#5): 마지막 사례의 squash 병합이 "Head branch was modified"로 거부됐다. push 직후 GitHub이 새 head를 아직 몰랐다. → 병합 전에 PR head가 기대 커밋이 될 때까지 기다리고 다시 시도하게 고쳤다. #2는 닫았다.
  - 2회(#6~#9): 같은 사례에서 대기 시간 초과. push 직후 `refs/pull/<n>/head`가 늦게 갱신되어 도구가 옛 head를 읽었다. 같은 이유로 push 직후 잰 patch-id도 옛 head 기준일 수 있었다. → 모든 측정을 "PR ref가 push한 커밋이 될 때까지 대기 후 측정"으로 고쳤다. #6은 닫았다.
  - 3회(#10~#13): 사례 3에서 충돌이 나지 않았다. 앞선 실행이 main의 `a.txt`를 이미 같은 내용으로 바꿔 둬서 C PR이 아무것도 바꾸지 않았다. → 파일 내용에 실행 태그를 넣어 실행끼리 간섭하지 않게 고쳤다.
  - 2026-11-12 14:57 (KST) 4회(#14~#17): 4개 사례 모두 기대대로다. `node lab/q20/report.ts --item patch-id` 통과. 시험 리포에 열린 PR은 남지 않았다.

## 의사결정 로그

- 결정: 시험 리포 내용은 하네스 리포 `lab/q20/repo/`에 두고, `lab/q20/deploy.ts`가 그 트리로 시험 리포에 브랜치·PR을 만든다. / 이유: worktree 밖 파일을 고치지 않고(R3), 시험 코드를 리포 기록으로 남긴다(B1). / 버린 대안: worktree 밖에 시험 리포를 클론해 직접 수정(R3 위반), worktree 안 중첩 클론(gitlink가 실수로 커밋될 수 있고 기록이 남지 않음).
- 결정: AC는 "통과"가 아니라 "기록 완결"로 판정한다. / 이유: 시험의 목적은 관찰이고 실패도 유효한 결과다. / 버린 대안: 기대대로 동작해야 통과(설계 결함이 드러나면 계획이 막힘).
- 결정: 진짜 자격증명이 필요한 step4·5를 뒤로 두고, 그 기간에만 시험 리포 필수 승인을 1로 올린다(ADR-0004). / 이유: 가짜 시크릿으로 볼 수 있는 것을 먼저 확인해 진짜 자격증명 노출 기간을 줄인다.
- 결정: step6에서 `lab/q20/`의 시험 소스(repo/, attacks/, deploy.ts)를 트리에서 지우고 결과와 README만 남긴다. / 이유: 템플릿을 복사할 때 시험 소스가 따라가지 않게 한다. 소스는 git 이력에 남는다.
- 결정: step1의 비교 대상에서 "로컬 rebase + `--force-with-lease`"를 빼고 "main 병합 커밋 + 일반 push"로 바꾼다(제작자 승인, 2026-11-12). / 이유: ADR-0006으로 세션·runner 모두 이 방식을 쓰고, rebase 방식은 L1 훅(R14)이 막는다. 10.3절 결속도 병합 방식 기준으로 고쳤다(설계서 v0.7.8). / 버린 대안: 원래대로 rebase 사례 유지(제작자가 직접 force push해야 하고, 더는 쓰지 않는 방식을 시험한다).

## 발견 사항

- 시험 리포 초기 상태(봇 API, 2026-11-11): 자동 병합 꺼짐, head 브랜치 자동 삭제 꺼짐, 필수 체크 없음, environment 없음. 봇은 admin이 아니라 승인 설정·Actions 권한은 볼 수 없다. → 처리: 해당 없음(열린 질문의 제작자 준비 항목으로 요청)
- merge queue 가용 범위는 GitHub 문서의 렌더링된 본문에 없고, 문서 원본의 gated-features 조각에만 있다. 개인 계정 리포는 대상이 아니다. → 처리: [lab/q20/results/merge-queue.json](../../../../lab/q20/results/merge-queue.json), 설계서 10.3절 문구는 step6에서 고친다
- GitHub은 push 직후 PR head(`headRefOid`, `refs/pull/<n>/head`)를 늦게 반영한다. 바로 병합하거나 PR ref를 읽으면 옛 head 기준이 된다. 2단계 기록 job이 새 head로 승인을 옮길 때도 PR ref가 아니라 이벤트의 head SHA로 재야 한다. → 처리: [lab/q20/results/patch-id.json](../../../../lab/q20/results/patch-id.json), 2단계 기록 job 구현 때 반영(TD-1)
- `node scripts/harness.ts run --help`가 도움말을 출력하지 않고 runner를 그대로 시작한다. 알 수 없는 플래그를 무시하기 때문이다. 이 세션에서 실수로 runner가 #4를 선점했다. → 처리: TD-17

## 열린 질문

제작자 준비 항목(봇은 admin이 아니라 할 수 없다). 해당 step 전에 요청한다.

- step0 전: 시험 리포 설정. 자동 병합 허용, head 브랜치 자동 삭제 켬, Actions 기본 권한 읽기 전용, "Actions가 PR 생성·승인" 끔.
- step2 전: environment `judge-claude`, `judge-codex`, `codex-auth-store`, `recorder`. 각각 Deployment branches를 main만 허용하고, 시크릿 `Q20_FAKE_SECRET`에 environment마다 다른 임의 문자열(32자 이상)을 넣는다.
- step3 전: 시험용 GitHub App(webhook 끔, 권한 Commit statuses·Checks 쓰기, Pull requests·Contents 읽기, 시험 리포에만 설치). `recorder`에 변수 `RECORDER_APP_ID`, 시크릿 `RECORDER_APP_KEY`. 배포 뒤 main 필수 체크 등록(출처 = 이 App).
- step4 전: 시험 리포 필수 승인 1로 올림, `claude setup-token`으로 만든 토큰을 `judge-claude`의 `CLAUDE_CODE_OAUTH_TOKEN`에.
- step5 전: Codex 로그인 인증 파일을 `judge-codex`의 `CODEX_AUTH_JSON`에, 재저장용 자격증명을 `codex-auth-store`에(step5에서 형식 안내).
- step6: 진짜 자격증명 교체, 시험 App 삭제, 봇 초대 철회, 시험 리포 보관.

## 검증 방법과 결과

- 명령: `node lab/q20/report.ts --all`
- 결과 요약(항목 | 판정 | 근거): step마다 채운다.

| 항목        | 판정 | 근거                                                                                                                                    |
| ----------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| merge-queue | fail | 개인 계정 리포는 대상 아님(GitHub 문서). 10.3절 대안이 있어 2단계 영향 없음(step0)                                                      |
| patch-id    | pass | main 병합 갱신·GitHub Update branch 모두 patch-id 유지, 충돌 해결 시 변경, 최신 PR squash 트리 = head 트리(시험 리포 PR #14~#17, step1) |

## 다음 할 일

- step2(env-ref) 전에 제작자에게 environment 4개와 가짜 시크릿을 요청한다(열린 질문). 시험 리포 설정(자동 병합, head 브랜치 자동 삭제, Actions 권한)과 merge queue 설정 화면 확인도 아직 받지 못했다.
