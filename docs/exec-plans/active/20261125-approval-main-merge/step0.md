# Step 0: main-merge

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `docs/exec-plans/active/20261125-approval-main-merge/plan.md`(목표·수용 기준·의사결정 로그 2·3)
- `scripts/lib/approval.ts`(`approvalPending`), `scripts/hooks/rules.ts`(`승인 요청 뒤 push` 규칙, `approvalPending` 호출), `scripts/hooks/guard.ts`(`buildContext`)
- `scripts/commands/pr-ready.ts`(기본 브랜치 ref를 `loadConfig(info.mainRoot).github`의 `remote`·`defaultBranch`로 만드는 방식)
- `scripts/test/guard.test.ts`의 "승인 요청 규칙: 실제 worktree의 표시와 계획 위험도로 판정한다", `scripts/test/helpers.ts`(`tmp`, `sh`, `write`, `gitInit`, `commitAll`, `fixtureConfig`)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-38 행

## 작업

1. `scripts/lib/approval.ts`의 `approvalPending(dir: string, branch: string | null): number | null`
   - 시그니처와 반환 의미(표시가 없거나 알 수 없으면 null, 아니면 수)는 그대로 둔다.
   - 기본 브랜치 ref는 `refs/remotes/<remote>/<defaultBranch>` 전체 이름이다. `remote`·`defaultBranch`는 `loadConfig(<worktree의 mainRoot>).github`에서 읽고, 설정을 읽지 못하면 `origin`·`main`을 쓴다.
   - 그 ref가 커밋으로 풀리지 않으면(`rev-parse --verify -q <ref>^{commit}` 실패) 예전처럼 `rev-list --count --no-merges HEAD ^<표시>`를 돌려준다.
   - ref가 있으면 셈 규칙은 다음과 같다(계획 의사결정 로그 2).
     - 줄기: `rev-list --first-parent --parents HEAD ^<표시>`의 각 커밋(첫 부모 줄기)
     - main 줄기: `rev-list --first-parent <ref> ^<표시>`의 커밋 집합
     - 줄기의 커밋이 병합이 아니면(부모가 1개 이하) 1을 센다.
     - 줄기의 커밋이 병합이면, 첫 부모가 아닌 부모 P마다
       - P가 main 줄기에 있으면 세지 않는다(main 병합 갱신).
       - 아니면 `rev-list --count --no-merges P ^<첫 부모> ^<표시>`를 더한다.
   - 셈 규칙과 이유(Issue #243)를 함수 주석에 적는다.
2. `scripts/test/guard.test.ts`에 테스트 둘을 더한다. 이름은 둘 다 `승인 요청 규칙: `으로 시작한다. 기존 테스트는 고치지 않는다. 두 테스트가 같이 쓰는 리포 준비는 이 파일 안의 작은 함수로 둬도 된다.
   - 공통 준비
     - 임시 폴더에 bare 원격(`git init --bare -b <기본 브랜치>`)과 리포(`gitInit`)를 만든다.
     - 첫 커밋을 원격의 기본 브랜치로 push한다.
     - 계획 브랜치 worktree를 만들고 커밋 하나를 더한 뒤, 그 HEAD로 승인 요청 표시(`<worktree의 git-dir>/harness/approval-requested`)를 쓴다.
     - 메인 체크아웃에서 커밋을 더해 원격의 기본 브랜치로 push하고, worktree에서 fetch한 뒤 원격 추적 ref를 병합(`--no-edit`)한다.
   - 테스트 A(설정 없음: `origin`·`main` 기본값)
     - main 병합만 한 뒤 `approvalPending(<worktree>, null)`이 0이다. `buildContext(<메인 체크아웃>)`으로 판정한 `git push origin <브랜치>`가 null(허용)이다.
     - 기본 브랜치가 아닌 브랜치에서 커밋 하나를 만들어 `--no-ff`로 병합한다. 수가 1이고, push가 `승인 요청` 규칙(`1개`)으로 막힌다.
     - worktree에 직접 커밋을 하나 더 만든다. 수가 2다.
     - 이름이 `origin/main`인 로컬 브랜치를 worktree HEAD에 만들고(`git branch origin/main HEAD`) 수가 2인지 본다. 그 브랜치는 지운다.
     - 메인 체크아웃에서 PR 브랜치를 `--no-ff`로 병합해 원격에 push한다(앞의 두 커밋이 main에서 닿게 된다). worktree에서 fetch한 뒤 수가 2다. 다시 `origin/main`을 병합해도 수가 2다.
   - 테스트 B(설정 있음: 기본값과 다른 이름)
     - 메인 체크아웃에 `fixtureConfig`로 만든 `harness.config.json`을 쓴다. `github`은 원래 값에 `remote: 'up'`, `defaultBranch: 'trunk'`만 바꾼다.
     - 원격 이름 `up`, 원격 기본 브랜치 `trunk`로 공통 준비를 한다.
     - main 병합만 한 뒤 수가 0이고, push가 허용된다.
3. `docs/harness/architecture.md`: `lib/approval.ts` 줄의 "표시 뒤 병합이 아닌 커밋 수"를 "표시 뒤 PR 브랜치에서 더한 병합이 아닌 커밋 수(기본 브랜치 병합으로 들어온 커밋은 세지 않는다)"로 고친다.
4. `docs/exec-plans/tech-debt-tracker.md`의 TD-38 행
   - 관찰을 더한다: 2026-11-25, PR #236의 갱신 push `d426343..fd2f6f6`. `workflow` 권한 없는 봇 토큰으로 main의 워크플로 변경(#207, `.github/workflows/check.yml`)을 병합해 가져온 push를 GitHub이 받아들였다.
   - "여전히 보지 못한 것"의 "봇 토큰의 `workflow` 권한을 회수한 뒤 main에 워크플로 변경이 들어간 다음의 PR 갱신 push와 워크플로를 바꾼 커밋의 revert push"에서 PR 갱신 push를 뺀다. "워크플로를 바꾼 커밋의 revert push"와 그 괄호 설명(`n/a` 사례, 예상, #139)은 남기되, 두 사례를 가리키던 말("두 사례", "위 두 사례")을 한 사례에 맞춘다.
   - 행의 다른 항목은 고치지 않는다.
5. 변경 조각 `docs/harness/changes/20261125-approval-main-merge-s0.md`를 절차서 5절 형식으로 만든다. `## CHANGELOG`에 "승인 요청"이 들어간 한 줄을 적는다. 설계서를 고치지 않으므로 `## 설계서 변경 이력`은 두지 않는다.

## Acceptance Criteria

```bash
node --test --test-name-pattern "승인 요청 규칙" scripts/test/guard.test.ts
node --test scripts/test/pr-ready.test.ts scripts/test/runner-pr.test.ts
base=$(git merge-base origin/main HEAD) && n=$(git diff --numstat "$base" -- scripts/test/guard.test.ts) && test -n "$n" && test "$(printf '%s\n' "$n" | cut -f2)" = 0
row=$(grep '^| TD-38 ' docs/exec-plans/tech-debt-tracker.md) && printf '%s\n' "$row" | grep -q 'd426343\.\.fd2f6f6' && ! printf '%s\n' "$row" | grep -q '다음의 PR 갱신 push와' && printf '%s\n' "$row" | grep -q '워크플로를 바꾼 커밋의 revert push'
grep 'lib/approval.ts' docs/harness/architecture.md | grep -q '기본 브랜치 병합으로 들어온 커밋은 세지 않는다'
sed -n '/^## CHANGELOG/,/^## [^C]/p' docs/harness/changes/20261125-approval-main-merge-s0.md | grep -q '^- .*승인 요청'
```

## 금지사항

- `approvalPending`의 시그니처와 반환 의미를 바꾸지 마라. 이유: `scripts/hooks/rules.ts`, `scripts/hooks/guard.ts`, 기존 테스트가 그 계약을 쓴다.
- 기존 승인 요청 테스트를 고치거나 지우지 마라. 이유: 기존 동작(직접 커밋은 막는다, 원격 ref가 없으면 모두 센다)이 그대로인지 그 테스트로 확인한다(수용 기준 4).
- `approvalPending` 안에서 `git fetch`를 실행하지 마라. 이유: 훅은 Bash 호출마다 돌아 네트워크를 타면 느려지고 실패한다. 로컬 원격 추적 ref만 본다. ref가 오래됐으면 더 막는 쪽이다.
- 기본 브랜치에서 닿는 커밋을 집합으로 빼서(`^<ref>`) 세지 마라. 둘째 부모가 기본 브랜치의 조상인지만 보고 main 병합으로 판정하지도 마라. 이유: PR 브랜치에서 만들었거나 다른 브랜치에서 들여온 커밋이 나중에 main에서 닿게 되면 빠진다(계획 검증 1회차 F1).
- 첫 부모 줄기의 병합 아닌 커밋만 세지 마라. 이유: 다른 브랜치를 `--no-ff`로 병합해 들어온 커밋이 빠진다.
- 짧은 이름(`origin/main`)으로 ref를 풀지 마라. 이유: 같은 이름의 로컬 브랜치가 먼저 잡힌다(의사결정 로그 3).
- 설정이나 ref를 못 읽을 때 null(막지 않음)을 돌려주지 마라. 이유: 지금의 실패 처리보다 느슨해진다. 예전처럼 모두 센다.
- `lab/ops-transition/results/`의 시험 결과 파일을 고치지 마라. 이유: 그때의 시험 기록이다. 관찰은 TD-38에 적는다.
