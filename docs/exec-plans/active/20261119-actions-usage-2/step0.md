# Step 0: repro-on-demand

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `scripts/harness.ts`의 `codex-scan`·`claude-scan`, `scripts/ci/repro.ts`, `scripts/ci/verdict.ts`, `scripts/ci/ledger.ts`(재현 결과가 동결 판단에 쓰이는 곳)
- `scripts/test/codex-scan.test.ts`, `scripts/test/claude-scan.test.ts`(유출 검사를 통과하는 입력 픽스처)
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`
- `scripts/test/ci.test.ts`(워크플로 구조 단언), `scripts/gates/harness-guard.ts`(`reproJobViolations`)
- 설계서 10.2절 (3), 10.3·10.4절, `docs/SECURITY.md`, 절차서 5절

## 작업

테스트를 먼저 쓴다(R5). 구현 전에 새 단언이 실패하는 것을 확인해 진행 로그에 적는다.

1. 유출 검사 명령의 `repro` 출력
   - 판정에 재현 테스트가 있는지 돌려주는 함수를 둔다(`scripts/ci/repro.ts`의 `hasRepro(verdict): boolean`. 지적의 `repro.content`가 빈 문자열이 아닌 것이 하나라도 있으면 참).
   - `scripts/harness.ts`의 `codex-scan`·`claude-scan`이 판정 파일을 쓴 뒤 환경 변수 `GITHUB_OUTPUT`이 있으면 그 파일에 `repro=true` 또는 `repro=false` 한 줄을 덧붙인다. 없으면 쓰지 않는다. 판정을 내보내지 못하고 끝나는 경로에서는 쓰지 않는다.
   - `runRepro`와 기록 쪽(`parseReproResults`, 원장)은 바꾸지 않는다.
   - 기록 쪽 테스트를 더한다(구현은 바꾸지 않는다. 지금 동작을 고정한다). `scripts/test/ci.test.ts`: 두 판정 워크플로의 기록 job 조건이 `${{ !cancelled() && needs.plan.result != 'skipped' && needs.plan.outputs.skip != 'true' }}`이고 그 조건에 `needs.repro`가 나오지 않는다(재현 job이 건너뛰어져도 돈다). 이 단언은 패치 전의 워크플로에서도 통과하므로 봇의 커밋에 넣는다. `scripts/test/record.test.ts`: `record-review`에 빈 재현 결과(`--repro-results ''`)를 주면 종료 코드 0으로 판정 상태와 원장을 기록하고 원장 항목의 재현 칸이 비어 있다.
   - 테스트 `scripts/test/scan-output.test.ts`: 두 명령을 `node scripts/harness.ts <명령>`으로 실제 실행한다. 명령마다 넷을 단언한다. ① 재현 테스트가 붙은 지적이 있는 판정이면 `GITHUB_OUTPUT` 파일에 `repro=true` 줄이 정확히 하나 있다. ② 재현 테스트가 없는 판정이면 `repro=false` 줄이 정확히 하나 있다. ③ 유출 검사가 실패하는 입력이면 종료 코드가 0이 아니고 `repro`로 시작하는 줄이 없다. ④ `GITHUB_OUTPUT` 없이 실행하면 종료 코드 0이고 판정 파일이 생긴다. `GITHUB_OUTPUT` 파일에 이미 있던 내용은 그대로 남는지도 본다.

2. 워크플로 패치 `lab/actions-usage-2/workflows.patch` (`git diff` 형식. 봇은 대상 파일을 커밋하지 않는다)
   - `judge-claude.yml`, `judge-codex.yml`: `judge` job의 출력에 `repro: ${{ steps.scan.outputs.repro }}`를 더하고, `repro` job의 조건을 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`로 바꾼다. 머리 주석의 재현 job 설명에 조건을 한 줄 더한다. 그 밖의 줄(권한, `needs`, 기록 job)은 바꾸지 않는다.
   - `scripts/test/ci.test.ts`: 재현 job의 조건과 `judge` job의 출력을 단언하는 부분만 새 내용에 맞춘다(패치에 함께 넣는다. 패치 전의 워크플로에서는 지금 단언이 통과해야 하므로 봇의 커밋에는 넣지 않는다).
   - `lab/actions-usage-2/README.md`: 적용 명령(브랜치 받기, `git apply`, 커밋, push), 적용 뒤 확인 명령(`node --test scripts/test/ci.test.ts scripts/test/harness-guard.test.ts`, `node scripts/harness.ts check`), 패치가 바꾸는 줄의 요약을 적는다.
   - `lab/actions-usage-2/verify-patch.ts`: HEAD를 임시 폴더(`mkdtemp`)에 클론하고, 패치가 적용되면 적용한 뒤, 이미 적용돼 있으면(역방향 확인이 통과) 그대로 `node --test scripts/test/ci.test.ts scripts/test/harness-guard.test.ts`를 돌린다. 둘 다 아니면 실패한다. 테스트가 실패하면 실패한다. 작업 트리는 바꾸지 않고 임시 폴더는 지우지 않는다.
   - 패치를 적용한 임시 클론에서 `node scripts/harness.ts check`도 한 번 돌려 통과를 확인한다. 결과를 진행 로그에 적는다.

3. 문서
   - 설계서: 10.2절 (3)과 10.3절의 재현 job 설명에 "재현 테스트가 붙은 지적이 있을 때만 돈다. 판정 job의 유출 검사 단계가 정하고, 값이 없으면 돈다"를 적는다. 버전과 변경 이력.
   - 절차서 5절과 `docs/SECURITY.md`: 운영 단계의 워크플로 변경 절차(봇이 패치를 준비하고, 제작자가 봇의 PR 브랜치에 패치 커밋을 마지막으로 올린 뒤 승인한다. 그 뒤의 봇 작업은 아래 5번). 해 본 결과대로 적는다. `CHANGELOG`.
   - 기술 부채 표 TD-49: 후보를 다시 본 결과(④는 조건부 실행으로, ③은 구조 변경이 필요해 제작자 결정으로, ⑤와 `store`는 하지 않는 이유), CI에서 `testInertPaths` 건너뛰기를 관찰한 결과(계획의 진행 로그).

4. PR
   - 초안으로 올린다. 판정이 통과하면 완료 처리·기록·`origin/main` 병합·`check`를 끝낸다.

5. 제작자 작업과 그 뒤의 봇 작업
   - 봇의 작업이 모두 끝나고 판정이 통과한 뒤에 제작자에게 **한 번에** 요청한다: ① `lab/actions-usage-2/README.md`의 명령으로 패치 커밋을 이 브랜치에 올리기, ② 그 head의 판정이 통과하면 승인. 요청하기 직전에 `origin/main`을 병합해 두어 뒤처질 구간을 줄인다.
   - 제작자가 push한 뒤 봇은 PR 브랜치와 main을 함께 받아(`git fetch origin main <브랜치>`. `origin/main`도 갱신된다) worktree를 원격 PR head로 fast-forward한다(`git merge --ff-only origin/<브랜치>`). fast-forward가 안 되면(로컬에 다른 커밋이 있다) 멈추고 알린다.
   - 방금 받은 `origin/main`이 그 head의 조상인지 본다(`git merge-base --is-ancestor origin/main HEAD`). 아니면(그사이 main이 전진) 봇이 push하지 않고 제작자에게 브랜치 갱신(GitHub의 "Update branch" 또는 `origin/main` 병합 push)을 요청한다. 갱신되면 같은 두 명령으로 다시 받고 다시 확인한다.
   - 최신 main을 담은 head의 `check`와 판정(필수 체크 가운데 `risk-gate` 말고 전부)이 통과한 것을 `pr-state`로 확인한 뒤 `node scripts/harness.ts pr-ready`로 초안을 해제하고 승인을 요청한다.
   - 패치 커밋이 올라간 뒤에는 봇이 이 브랜치에 push하지 않는다. 그 뒤에 고칠 것이 생기면(판정 지적 등) 제작자에게 먼저 알리고, 봇의 push가 거부되면 제작자에게 패치로 넘긴다.

6. 병합 뒤 확인(Issue #135 댓글): 재현 테스트가 없는 판정에서 두 워크플로의 `repro` job이 `skipped`이고 기록 job이 판정을 기록했는지를 run 링크와 함께 남긴다. 기대와 다르면 Issue를 등록한다.

## Acceptance Criteria

```bash
node --test scripts/test/scan-output.test.ts scripts/test/codex-scan.test.ts scripts/test/claude-scan.test.ts scripts/test/ci.test.ts scripts/test/harness-guard.test.ts scripts/test/record.test.ts scripts/test/repro.test.ts
node lab/actions-usage-2/verify-patch.ts
node scripts/harness.ts doc-lint
```

첫 줄은 지금 head의 워크플로에서 돈다(기록 job 조건, 유출 검사 명령의 출력, 빈 재현 결과의 기록). 둘째 줄은 패치를 적용한 트리의 워크플로 구조 테스트다: 패치 전의 head에서는 임시 클론에 패치를 적용해서, 제작자가 패치 커밋을 올린 뒤의 head에서는 적용 없이 돌린다.

## 금지사항

- `.github/workflows/`의 파일을 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없어 브랜치 전체의 push가 거부된다. 패치 파일로만 준비한다.
- 재현 job의 조건을 "값이 `true`일 때만 돈다"로 쓰지 마라. 이유: 출력이 빠지거나 깨지면 재현이 빠지고, 2라운드부터의 새 P1이 동결된다.
- 판정을 내보내지 못한 경로에서 `repro` 값을 쓰지 마라. 이유: 판정이 없는데 재현 여부만 있는 출력이 생긴다.
- job을 합치거나 environment·권한 경계, 기록 job의 입력·조건을 바꾸지 마라. 이유: 10.4절의 격리.
- `check.yml`·`revert.yml`·`gates.yml`과 `check` 명령의 `test` 건너뛰기 조건을 바꾸지 마라. 이유: 이 step의 범위가 아니다(main의 중복 `test` 생략은 계획에서 뺐다).
- PR 판정이 도는 중에 PR 본문을 고치지 마라. 이유: `gates`가 다시 돈다(절차서 5절).
