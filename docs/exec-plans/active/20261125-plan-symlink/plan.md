---
id: 20261125-plan-symlink
issue: 194 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: mac-session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-25T12:54:22+09:00 # new-task가 채운다
---

# PR 트리의 계획을 읽는 판정·검증 코드가 계획 자리의 심볼릭 링크를 따라가는지 확인하고 HEAD 커밋 읽기로 맞춘다

## 목표와 수용 기준

PR 트리의 계획을 데이터로 읽는 판정 코드(`plan-gate`, `risk-gate`의 계획 위험도, 계획 해시, 검증자 계획의 작성자, 검증 입력)는 `findPlan`(`existsSync`)으로 계획을 찾고 `readFileSync`·`readdirSync`로 읽는다. 셋 다 심볼릭 링크를 따라간다. 계획 자리(계획 파일, `index.json`, step 파일, 그 위의 폴더)에 링크가 있으면 링크 대상, 곧 PR 트리 밖의 파일이나 다른 계획을 그 PR의 계획으로 읽는다(Issue #194, PR #189의 계획 검증 지적 F1). 예를 들어 위험도 high 계획 자리를 `risk: low`인 파일로 가리키게 할 수 있다.

착수 때 확인한 것: 계획을 읽는 CI job(`gates`의 `evaluate`·`selftest`, 두 판정 워크플로의 `plan`·`judge`)은 PR 트리를 받기 전에 `git config --global core.symlinks false`를 설정한다. 그래서 지금 CI에서는 링크가 링크 대상 경로를 글로 담은 일반 파일로 체크아웃되고, 위 코드가 링크를 따라가지 않는다. 보호는 워크플로의 설정 한 줄에만 있고 코드에는 없다(설정이 빠진 체크아웃이나 로컬에서 PR 트리를 읽으면 따라간다). `scope`는 계획을 HEAD 커밋의 일반 파일로만 읽어 이미 막는다(`readPlanAtHead`).

이 계획은 계획을 읽는 코드가 체크아웃 설정과 무관하게 링크를 따라가지 않게 한다. HEAD 커밋이 아니라 작업 트리에서 읽되 링크를 거절한다: `plan-gate`와 계획 해시는 로컬(`plan-gate --mode plan`을 커밋 전에 돌린다)과 runner도 쓰므로, HEAD에서 읽으면 커밋하지 않은 계획을 보지 못한다(의사결정 로그).

수용 기준:

1. 새 파일 `scripts/lib/plan-read.ts`의 세 함수는 링크를 따라가지 않는다.
   - `findPlanSafe(root, id)`: `findPlan`과 같은 후보 순서로 계획을 찾는다. `readPlanFile(root, rel)`: 계획 안 파일의 글(없으면 `null`). `listPlanDir(root, rel)`: 계획 폴더의 이름 목록(없으면 `[]`).
   - `root`부터 그 경로까지의 각 자리를 `lstat`으로 본다. 어느 자리든 심볼릭 링크이면 그 자리를 적은 `PlanPathError`를 던진다. 폴더 자리는 폴더, 파일 자리는 일반 파일이어야 한다(아니면 던진다). 자리가 없으면 없는 것으로 돌려준다.
   - `root`가 git 작업 트리 안이면 색인도 본다: 그 경로나 위 폴더 자리가 색인에 심볼릭 링크(모드 120000)나 서브모듈(160000)로 있으면 던진다. `core.symlinks=false`로 받아 링크가 일반 파일이 된 체크아웃을 잡는다. 색인을 읽지 못하면 던진다. git 작업 트리가 아니면 색인은 보지 않는다(색인이 없다).
   - 경로는 계획 id로 만든 것이고 git에는 `--literal-pathspecs`로 넘긴다(테스트: 위 경우마다 던짐·없음·글을 단언).
2. 계획을 읽는 판정 코드가 이 함수로 읽는다: `scripts/gates/plan-gate.ts`(계획 찾기, 계획·`index.json`·step 파일 읽기), `scripts/gates/risk-gate.ts`의 `planRisk`, `scripts/ci/plan-hash.ts`(`planHash`, `planHashes`, `planMode`), `scripts/ci/review-plan.ts`의 `planAuthor`, `scripts/ci/review-input.ts`의 계획 찾기. 계획 자리에 링크가 있으면(링크 자체, `core.symlinks=false`로 받은 일반 파일 모두):
   - `planGate`는 통과가 아니다: 문제 하나가 "계획 자리가 일반 파일·폴더가 아니다(심볼릭 링크·서브모듈)"와 그 자리를 적는다.
   - `riskGate`(`gates`의 `guarded` 안)는 통과가 아니다(`assessRisk`가 던져 `error`). `planReview`는 위험도 high다(이미 있는 `catch`).
   - `planHash`·`planHashes`는 던지고, `planMode`는 `{ mode: 'code', hash: '' }`다.
   - `planAuthor`는 `''`이다(작성자를 모르면 위험도 낮음에서도 Codex가 판정한다).
   - `writeReviewInput`의 `context.md`는 계획을 "읽지 않음(일반 파일·폴더가 아니다)"으로 적는다.
   - 어느 결과에도 링크 대상의 글(테스트가 링크 대상에 넣은 표식, `risk: low`, `author: codex`)이 나오지 않는다(테스트).
3. 링크의 꼴: 계획 파일(`plan.md`) 링크, 계획 폴더 링크, `index.json` 링크, step 파일 링크, 그리고 계획 파일·계획 폴더 링크를 커밋한 뒤 `core.symlinks=false`로 받은 체크아웃. 링크 대상은 리포 밖의 "그럴듯한 계획"(`risk: low`, `author: codex`, 표식 글)이다(테스트, 새 파일 `scripts/test/plan-symlink.test.ts`. 변경 전 코드에서는 링크 대상을 읽어 단언으로 실패한다).
4. 기존 동작이 그대로다: 기존 테스트(`plan-gate.test.ts`, `plan-hash.test.ts`, `risk-gate.test.ts`, `gates.test.ts`, `ci.test.ts`, `scope.test.ts`, `runner-plan-review.test.ts`, `task.test.ts`)가 단언을 고치지 않고 통과한다. 이 리포의 `docs/exec-plans/`에 있는 계획 폴더마다 새 읽기로 계산한 `planHash`가 그 커밋의 `planHashAt(root, 'HEAD', …)`와 같다(테스트). 커밋하지 않은(추적되지 않은) 계획 파일도 전처럼 읽어 `plan-gate --mode plan`이 통과한다(테스트).
5. 설계서 10.4절 "심볼릭 링크" 항목에 계획을 읽는 base 스크립트가 체크아웃 설정과 무관하게 링크를 따라가지 않는다는 것을 적는다. `docs/harness/architecture.md`의 라이브러리 목록과 변경 조각이 맞다. `node scripts/harness.ts check`가 통과하고, 그 안의 `test-effect`가 새 테스트(`scripts/test/plan-symlink.test.ts`)를 변경 전 코드에서 "단언 실패"로 판정한다.

## 범위 / 비범위

범위:

- `scripts/lib/plan-read.ts`(새 파일): `findPlanSafe`, `readPlanFile`, `listPlanDir`, `PlanPathError`.
- 판정 코드의 계획 읽기를 바꾼다: `scripts/gates/plan-gate.ts`, `scripts/gates/risk-gate.ts`, `scripts/ci/plan-hash.ts`, `scripts/ci/review-plan.ts`, `scripts/ci/review-input.ts`. 읽는 자리만 바꾸고 판정 규칙은 그대로다.
- 테스트: 새 파일 `scripts/test/plan-symlink.test.ts`, `scripts/test/plan-read.test.ts`.
- 문서: 설계서 10.4절, `docs/harness/architecture.md`, 변경 조각.

비범위:

- `scripts/gates/scope.ts`. 이유: 이미 HEAD 커밋의 일반 파일로만 읽는다. 읽는 방식을 하나로 합치는 일은 동작을 바꾸지 않는 정리라 이 계획에 넣지 않는다.
- 로컬 명령과 L1 훅의 계획 읽기(`findPlan`을 쓰는 `task.ts`, `approval.ts`, `hooks/decide.ts` 등). 이유: 자기 worktree를 읽는다(Issue #194의 대상이 아니다). `findPlan`은 그대로 둔다.
- 워크플로의 `core.symlinks false` 설정. 이유: 그대로 둔다(LLM 검증자가 `pr/`를 읽을 때의 보호이기도 하다, 10.4절). 재현 job 두 곳(`judge-*.yml`의 `repro`)은 이 설정이 없지만 계획을 읽지 않고 PR 코드를 실행하는 job이다(비밀·쓰기 권한 없음).
- base 쪽 읽기(`findPlanAt`, `planHashAt`, `showFile`): git 객체를 읽으므로 작업 트리의 링크와 무관하다.

## 관련 파일·문서

- `scripts/lib/plan-read.ts`, `scripts/gates/plan-gate.ts`, `scripts/gates/risk-gate.ts`, `scripts/ci/plan-hash.ts`, `scripts/ci/review-plan.ts`, `scripts/ci/review-input.ts`
- `scripts/test/plan-symlink.test.ts`, `scripts/test/plan-read.test.ts`
- `docs/harness/design.md`, `docs/harness/architecture.md`, `docs/harness/changes/20261125-plan-symlink-s0.md`
- `docs/exec-plans/active/20261125-plan-symlink/**`
- 읽기만: `scripts/lib/plan.ts`, `scripts/lib/git.ts`, `scripts/gates/scope.ts`, `scripts/ci/gates.ts`, `scripts/test/helpers.ts`, `scripts/test/plan-gate.test.ts`, `scripts/test/plan-hash.test.ts`, `scripts/test/risk-gate.test.ts`, `.github/workflows/gates.yml`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`

## step 목록

- step0 safe-read: 링크를 따라가지 않는 계획 읽기(`plan-read.ts`)를 만들고 판정 코드 다섯 곳의 계획 읽기를 그것으로 바꾼다. 테스트 먼저.

## 진행 로그

- 2026-11-25 접수: 제작자가 대화에서 "다른 세션의 작업과 겹치지 않게 작업 가능한 것을 파악하고 진행"을 지시했다. #237(PR #246)이 제작자 승인 대기에 들어가 다음으로 선점되지 않은 #194를 맡았다. 열린 PR 8개 가운데 이 계획의 코드 파일을 고치는 PR은 없다(PR #217은 `scripts/ci/ledger*.ts`·`review-round.ts`, PR #229는 `scripts/ci/record.ts`·`codex-scan.ts`).
- 2026-11-25 확인(읽기만): Issue가 꼽은 호출자 다섯이 `findPlan`(`existsSync`) 뒤에 `readFileSync`·`readdirSync`로 읽는다. `review-input`은 계획의 경로 이름만 쓰고 글은 읽지 않는다. 계획을 읽는 CI job의 체크아웃 여섯 곳은 모두 `core.symlinks false`를 먼저 설정한다(재현 job 두 곳만 없다). 판정 코드가 던지면 `gates`의 `guarded`가 `error`로 적고, `planReview`는 위험도 high로 둔다.

## 의사결정 로그

- 결정: HEAD 커밋이 아니라 작업 트리에서 읽되 링크를 거절한다(`lstat`으로 각 자리 + git 색인의 모드) / 이유: `planGate`와 `planHash`는 CI뿐 아니라 로컬 `plan-gate`(커밋 전에 돌린다)와 runner도 부른다. HEAD에서 읽으면 커밋하지 않은 계획을 보지 못해 로컬 동작이 바뀐다. 색인을 함께 보면 `core.symlinks=false`로 받아 링크가 일반 파일이 된 CI 체크아웃에서도 "링크였다"를 알아 분명한 오류로 막는다 / 버린 대안: (가) Issue의 제안대로 HEAD 커밋에서만 읽는다(`scope`의 `readPlanAtHead`. 로컬의 커밋 전 검사가 달라진다). (나) CI 호출에만 HEAD 읽기를 넘기는 선택지를 둔다(같은 함수가 부르는 곳에 따라 다른 것을 읽어 판정이 갈린다). (다) `lstat`만 본다(`core.symlinks=false` 체크아웃에서 링크 대상 경로를 담은 글을 계획으로 읽는다. 따라가지는 않지만 오류가 흐려진다).
- 결정: 링크를 만나면 판정을 실패 쪽으로 둔다(`plan-gate` 문제, `risk-gate` error, 위험도 high, 작성자 모름) / 이유: 링크인 계획은 정상 작업에서 생기지 않고, 무엇을 읽어야 하는지 정할 수 없다 / 버린 대안: 링크를 없는 계획으로 본다(`plan-gate`는 "계획 없음"으로 막지만 `risk-gate`는 계획 위험도를 빼고 판정한다).

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령(새 테스트 두 파일, 기존 판정 테스트, `test-effect` 판정 줄, `check`).

## 다음 할 일

- 계획만 담은 커밋으로 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현해 올린다.
