# Step 0: main-merge

## 읽어야 할 파일

- `ARCHITECTURE.md`
- `docs/exec-plans/active/20261125-approval-main-merge/plan.md`(목표·수용 기준·의사결정 로그 2·3)
- `scripts/lib/approval.ts`(`approvalPending`), `scripts/hooks/rules.ts`(`승인 요청 뒤 push` 규칙, `approvalPending` 호출), `scripts/hooks/guard.ts`(`buildContext`)
- `scripts/commands/pr-ready.ts`(기본 브랜치 ref를 `loadConfig(info.mainRoot).github`의 `remote`·`defaultBranch`로 만드는 방식)
- `scripts/ci/binding.ts`의 `changedOnBaseSince`, `samePrContent`(승인 이어받기가 main 병합 갱신을 알아보는 조건. 읽기만)
- `scripts/test/guard.test.ts`의 "승인 요청 규칙: 실제 worktree의 표시와 계획 위험도로 판정한다", `scripts/test/helpers.ts`(`tmp`, `sh`, `write`, `gitInit`, `commitAll`, `fixtureConfig`)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-38 행, `docs/harness/workflow.md` 5절 "승인 요청 전 조건"

## 작업

1. `scripts/lib/approval.ts`의 `approvalPending(dir: string, branch: string | null): number | null`
   - 시그니처와 반환 의미(표시가 없거나 알 수 없으면 null, 아니면 수. 0이면 막지 않는다)는 그대로 둔다.
   - 기본 브랜치 ref는 `refs/remotes/<remote>/<defaultBranch>` 전체 이름이다. `remote`·`defaultBranch`는 `loadConfig(<worktree의 mainRoot>).github`에서 읽고, 설정을 읽지 못하면 `origin`·`main`을 쓴다.
   - 그 ref가 커밋으로 풀리지 않거나(`rev-parse --verify -q <ref>^{commit}` 실패) 표시가 HEAD의 조상이 아니면(`merge-base --is-ancestor <표시> HEAD` 실패), 예전처럼 `rev-list --count --no-merges HEAD ^<표시>`를 돌려준다.
   - 그 밖에는 "병합만"인지 본다. `old` = `merge-base <표시> <ref>`, `new` = `merge-base HEAD <ref>`이고, 파일 목록은 모두 `git diff --name-only -z --no-renames <a> <b>`로 얻는다.
     - `old..표시`의 PR 파일이 비어 있으면(표시가 이미 기본 브랜치에 들어갔다 등) 병합만이 아니다.
     - (가) PR 파일 목록 `old..표시`와 `new..HEAD`가 같다.
     - (나) `표시..HEAD`에서 바뀐 파일에 PR 파일(`old..표시`)이 없다.
     - (다) `old..new`(그사이 기본 브랜치)에서 바뀐 파일에 PR 파일이 없다.
     - 셋 다 맞으면 0을 돌려준다. 아니면 `rev-list --count --no-merges HEAD ^<표시> ^<ref>`를 돌려주되, 0이면 1을 돌려준다.
   - git 명령이 실패하면 지금처럼 null이다. 파일 이름은 git 인자로 넘기지 않는다(pathspec으로 해석된다).
   - 판정 규칙과 이유(Issue #243, 승인 이어받기와 같은 꼴)를 함수 주석에 적는다.
2. `scripts/test/guard.test.ts`에 테스트 셋을 더한다. 이름은 모두 `승인 요청 규칙: `으로 시작한다. 기존 줄은 고치거나 지우지 않는다(import도 새 줄로 더한다). 테스트들이 같이 쓰는 리포 준비는 이 파일 안의 작은 함수로 둔다.
   - 공통 준비
     - 임시 폴더에 bare 원격(`git init --bare -b <기본 브랜치>`)과 리포(`gitInit`)를 만든다. 리포의 첫 커밋에는 여러 줄짜리 `README.md`가 있고, 이를 원격의 기본 브랜치로 push한다.
     - 계획 브랜치 worktree에서 계획 파일을 더하고 `README.md` 첫 줄을 바꾼 커밋 하나를 만든 뒤, 그 HEAD로 승인 요청 표시(`<worktree의 git-dir>/harness/approval-requested`)를 쓴다.
     - 메인 체크아웃에서 PR 파일이 아닌 파일을 더한 커밋을 원격의 기본 브랜치로 push한다. worktree에서 fetch한 뒤 원격 추적 ref를 `--no-ff --no-edit`로 병합한다.
   - 테스트 A(설정 없음: `origin`·`main` 기본값)
     - main 병합만 한 뒤 `approvalPending(<worktree>, null)`이 0이다. `buildContext(<메인 체크아웃>)`으로 판정한 `git push origin <브랜치>`가 null(허용)이다.
     - 기본 브랜치가 아닌 브랜치에서 커밋 하나를 만들어 `--no-ff`로 병합한다. 수가 1이고, push가 `승인 요청` 규칙(`1개`)으로 막힌다.
     - worktree에 직접 커밋을 하나 더 만든다. 수가 2다.
     - 표시 뒤의 공통 커밋 C에서 두 브랜치를 내어 각각 커밋 하나씩을 더하고, 두 브랜치를 한 병합 커밋(octopus)으로 병합한다. 수가 5다(C를 한 번만 센다).
     - 이름이 `origin/main`인 로컬 브랜치를 worktree HEAD에 만들어도(`git branch origin/main HEAD`) 수가 5다. 그 브랜치는 지운다.
     - 메인 체크아웃에서 PR 브랜치를 `--no-ff`로 병합해 원격에 push한다. worktree에서 fetch한 뒤 수가 1 이상이고 push가 막힌다. 다시 `origin/main`을 병합해도 막힌다.
   - 테스트 B(설정 있음: 기본값과 다른 이름)
     - 메인 체크아웃에 `fixtureConfig`로 만든 `harness.config.json`을 쓴다. `github`은 원래 값에 `remote: 'up'`, `defaultBranch: 'trunk'`만 바꾼다.
     - 원격 이름 `up`, 원격 기본 브랜치 `trunk`로 공통 준비를 한다. main 병합만 한 뒤 수가 0이고 push(`git push up <브랜치>`)가 허용된다.
     - 메인 체크아웃에서 `README.md` 마지막 줄(PR 파일)을 바꿔 push하고, worktree에서 그것을 병합한다(충돌 없음). 수가 1 이상이고 push가 막힌다.
   - 테스트 C(토픽 병합 뒤 main이 그 토픽으로 fast-forward. 의사결정 로그 2)
     - 공통 준비(기본값) 뒤, 원격 기본 브랜치 끝에서 토픽 브랜치를 내어 커밋 하나를 더하고 worktree에서 `--no-ff`로 병합한다. 수가 1이다.
     - 메인 체크아웃의 main을 그 토픽으로 fast-forward해 push하고 worktree에서 fetch한다. 수가 0이다(토픽의 변경은 main에 있고 PR이 더하는 변경은 표시 때와 같다).
3. `scripts/hooks/rules.ts`: `승인 요청 뒤 push` 고치는 법의 "main 병합 갱신(병합 커밋만 더함)은 막지 않는다"를 "main 병합 갱신(PR이 바꾼 파일을 main이 건드리지 않았으면)은 막지 않는다"로 고친다. 규칙의 판정 코드는 바꾸지 않는다.
4. `docs/harness/workflow.md` 5절: "`origin/main` 병합 커밋만 더한 push는 막지 않는다."를 PR의 변경은 그대로 두고 `origin/main`만 병합한 push는 막지 않고, 그사이 main이 PR 파일을 바꿨으면 막는다는 뜻으로 고친다. 문장에 "PR이 바꾼 파일을 main이 건드리지 않았으면"이 들어간다.
5. `docs/harness/architecture.md`: `lib/approval.ts` 줄의 "표시 뒤 병합이 아닌 커밋 수"를 "표시 뒤 새 커밋 수(PR이 기본 브랜치에 더하는 변경이 표시 때와 같으면 0)"로 고친다.
6. `docs/exec-plans/tech-debt-tracker.md`의 TD-38 행
   - "여전히 보지 못한 것" 구간에서 "봇 토큰의 `workflow` 권한을 회수한 뒤 main에 워크플로 변경이 들어간 다음의 PR 갱신 push와"를 뺀다. "워크플로를 바꾼 커밋의 revert push"와 그 괄호 설명은 남기되, 두 사례를 가리키던 말("두 사례", "위 두 사례")을 한 사례에 맞춘다.
   - 그 구간 바로 뒤에 `**2026-11-25 PR #236에서 본 것**:` 구간을 더한다. 내용: `workflow` 권한 없는 봇 토큰으로, main의 워크플로 변경(#207, `.github/workflows/check.yml`)을 병합해 가져온 PR 갱신 push(`d426343..fd2f6f6`)를 GitHub이 받아들였다.
   - 행의 다른 항목은 고치지 않는다.
7. 변경 조각 `docs/harness/changes/20261125-approval-main-merge-s0.md`를 절차서 5절 형식으로 만든다. `## CHANGELOG`에 한 줄을 적는다: 승인 요청 뒤 PR의 변경은 그대로 두고 `origin/main`만 병합한 push를 L1 훅이 막지 않는다는 것과 판정 조건. 설계서를 고치지 않으므로 `## 설계서 변경 이력`은 두지 않는다.

## Acceptance Criteria

```bash
node --test --test-name-pattern "승인 요청 규칙" scripts/test/guard.test.ts
node --test scripts/test/pr-ready.test.ts scripts/test/runner-pr.test.ts
base=$(git merge-base origin/main HEAD) && n=$(git diff --numstat "$base" -- scripts/test/guard.test.ts) && test -n "$n" && test "$(printf '%s\n' "$n" | cut -f2)" = 0
row=$(grep '^| TD-38 ' docs/exec-plans/tech-debt-tracker.md) && unseen=$(printf '%s\n' "$row" | sed 's/.*\*\*여전히 보지 못한 것\*\*//; s/\*\*2026-11-25 PR #236에서 본 것\*\*.*//') && seen=$(printf '%s\n' "$row" | sed -n 's/.*\*\*2026-11-25 PR #236에서 본 것\*\*//p') && test -n "$seen" && printf '%s\n' "$unseen" | grep -q '워크플로를 바꾼 커밋의 revert push' && ! printf '%s\n' "$unseen" | grep -q 'PR 갱신 push' && printf '%s\n' "$seen" | grep -q 'd426343\.\.fd2f6f6' && printf '%s\n' "$seen" | grep -q '받아들였다'
grep 'lib/approval.ts' docs/harness/architecture.md | grep -q 'PR이 기본 브랜치에 더하는 변경이 표시 때와 같으면 0'
grep -q 'PR이 바꾼 파일을 main이 건드리지 않았으면' docs/harness/workflow.md && grep -q 'PR이 바꾼 파일을 main이 건드리지 않았으면' scripts/hooks/rules.ts
line=$(sed -n '/^## CHANGELOG/,/^## [^C]/p' docs/harness/changes/20261125-approval-main-merge-s0.md | grep '^- ') && printf '%s\n' "$line" | grep -q '승인 요청' && printf '%s\n' "$line" | grep -q 'origin/main' && printf '%s\n' "$line" | grep -q '막지 않는다'
```

## 금지사항

- `approvalPending`의 시그니처와 반환 의미를 바꾸지 마라. 이유: `scripts/hooks/rules.ts`, `scripts/hooks/guard.ts`, 기존 테스트가 그 계약을 쓴다.
- 기존 승인 요청 테스트를 고치거나 지우지 마라. 이유: 기존 동작(직접 커밋은 막는다, 원격 ref가 없으면 모두 센다)이 그대로인지 그 테스트로 확인한다(수용 기준 4).
- `approvalPending` 안에서 `git fetch`를 실행하지 마라. 이유: 훅은 Bash 호출마다 돌아 네트워크를 타면 느려지고 실패한다. 로컬 원격 추적 ref만 본다. ref가 오래됐으면 더 막는 쪽이다.
- 커밋 그래프의 모양(첫 부모 줄기, 병합 부모가 기본 브랜치에서 닿는지)으로 막을지를 정하지 마라. 이유: 지금의 ref로는 과거 병합의 출처를 가릴 수 없다(계획 검증 1·2회차 F1·F5·F6, 의사결정 로그 2).
- patch-id로 같은 변경인지 보지 마라. 이유: 공백 차이를 보지 못한다(`scripts/ci/binding.ts`의 `samePrContent` 주석).
- `scripts/ci/`의 코드를 import하지 마라. 이유: `lib/`가 CI 코드에 기대게 된다. 같은 꼴의 판정을 이 모듈 안에 둔다.
- 짧은 이름(`origin/main`)으로 ref를 풀지 마라. 이유: 같은 이름의 로컬 브랜치가 먼저 잡힌다(의사결정 로그 3).
- 설정이나 ref를 못 읽을 때 0이나 null(막지 않음)을 돌려주지 마라. 이유: 지금의 실패 처리보다 느슨해진다. 예전처럼 센다.
- `lab/ops-transition/results/`의 시험 결과 파일을 고치지 마라. 이유: 그때의 시험 기록이다. 관찰은 TD-38에 적는다.
