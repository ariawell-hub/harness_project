---
id: 20261112-no-force-push
issue: 27 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-12T13:31:12+09:00 # new-task가 채운다
---

# fix: runner step 완료 push의 --force-with-lease 폴백 제거 (TD-22)

## 목표와 수용 기준

출처: Issue #27(제작자 대화 지시, 2026-11-12). runner 스크립트에서 마지막으로 남은 force push를 없앤다. ADR-0006(PR 갱신은 main 병합 + 일반 push)과 설계서 14.4절(`push --force` 금지)에 맞춘다.

수용 기준:

1. `scripts/runner/`·`scripts/lib/`에 force push(`--force`, `--force-with-lease`, `+refspec`)가 없다.
2. step 완료 push가 거부되고 원격 브랜치에 로컬에 없는 커밋이 있으면, runner는 덮어쓰지 않고 계획을 `blocked` + `needs-human`으로 보고한다. 원격 브랜치는 그대로다.
3. 갈라짐을 확인하지 못한 push 실패(네트워크, 원격 브랜치 조회 실패)는 지금처럼 환경 대기(`env`)다.
4. 설계서 14.4절에 runner 스크립트도 force push하지 않는다고 적고, TD-22를 해결로 바꾼다.
5. 테스트: 원격 브랜치에 다른 커밋이 있을 때 runner가 덮어쓰지 않고 멈춘다(옛 코드에서 실패). 갈라짐 판정 함수 단위 테스트.

## 범위 / 비범위

- 범위: `doStep`의 push 실패 처리, 갈라짐 판정 함수, 관련 테스트, 설계서 14.4절·버전, TD-22, CHANGELOG, ADR-0006 결과.
- 비범위: L1 훅 규칙(에이전트 force push 차단은 이미 있다), PR 갱신 경로(ADR-0006에서 끝남), 다른 작업자 worktree 인계(TD-23).

## 관련 파일·문서

- `scripts/runner/run.ts`, `scripts/lib/git.ts`
- `scripts/test/runner.test.ts`, `scripts/test/branch-update.test.ts`
- `docs/harness/design.md`, `docs/harness/CHANGELOG.md`, `docs/harness/architecture.md`
- `docs/decisions/ADR-0006-pr-update-merge.md`, `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261112-no-force-push/`

## step 목록

- step0 no-force-push: step 완료 push의 lease 폴백을 "갈라졌으면 멈추고 보고, 아니면 환경 대기"로 바꾸고 문서를 맞춘다.

## 진행 로그

- 2026-11-12 13:31 (KST) `new-task --issue 27 --slug no-force-push --size medium --type fix`. 동작이 바뀌는 변경이라 medium(절차서 1절), step 하나.
- 2026-11-12 13:31~13:33 (KST) 먼저 실패한 테스트: `branch-update.test.ts` 전체 실패(`remoteBranchDiverged` export 없음). runner 통합 테스트(원격 브랜치에 다른 커밋) → 기대 `human`, 실제 `idle`. 옛 코드가 lease로 원격 커밋을 덮어쓰고 PR까지 병합했다.
- 2026-11-12 13:33 (KST) 구현(커밋 `b3bd985`): `remoteBranchDiverged`(lib/git.ts), `doStep` push 실패 처리(runner/run.ts). 테스트 18개 통과, `scripts/runner`·`scripts/lib`에 `force-with-lease` 없음. PR #26 병합으로 main이 앞서 `origin/main`을 병합해 갱신했다(ADR-0006 절차, 충돌 없음).
- 2026-11-12 13:34 (KST) 문서: 설계서 v0.7.9(14.4절 git 행), TD-22 해결, ADR-0006 결과, architecture.md, CHANGELOG.

## 의사결정 로그

- 결정: push가 거부되면 원격 브랜치를 fetch해 로컬 HEAD의 조상인지 본다. 조상이 아니면(갈라짐) `blockPlan`, 판정하지 못하면 `env`. / 이유: runner 흐름에서 정상적으로는 자기 브랜치 push가 거부될 일이 없다(세션은 커밋을 더하기만 한다). 거부는 누군가 원격에 push했거나 세션이 이미 push한 이력을 고쳤다는 뜻이고, 어느 쪽이 맞는지는 사람이 판단해야 한다. / 버린 대안: 지금처럼 lease로 덮어쓰기(원격 커밋이 조용히 사라진다, 14.4절과 어긋남), `merge -s ours`로 자동 연결(원격 커밋 내용을 버리는 판단을 runner가 대신한다), 원격 커밋을 자동 병합(세션이 모르는 변경이 PR에 섞인다).
- 결정: 갈라짐 판정은 `scripts/lib/git.ts`의 함수로 두고 runner는 호출만 한다. / 이유: `updateBranchFromBase`와 같은 방식이라 bare 원격으로 단위 테스트할 수 있다.

## 발견 사항

- 없음

## 열린 질문

- 없음. 에이전트·runner 모두 force push를 하지 않는 방향은 R14·ADR-0006과 같고, 규칙을 더 엄격히 지키는 쪽이다.

## 검증 방법과 결과

- `node --test scripts/test/branch-update.test.ts scripts/test/runner.test.ts`, `! grep -rn "force-with-lease" scripts/runner scripts/lib`, `node scripts/harness.ts check`. 결과: AC 4개 통과(테스트 18개), `check` 통과.

## 다음 할 일

- step0 구현 → `check` → `complete-step` → PR(`Closes #27`).
