# Step 0: end-of-revs

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`lib/git.ts` 줄)
- `scripts/lib/git.ts`의 `REPO_DIRS_ARGS`, `repoInfo`, `toRepoInfo`
- `scripts/test/repo-info.test.ts`(있던 테스트 다섯, `spawned`와 `expected` 도우미)
- 계획 `docs/exec-plans/active/20261126-repoinfo-head-file/plan.md`의 수용 기준

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **테스트**: `scripts/test/repo-info.test.ts`에 테스트 셋을 더한다. 있던 테스트는 고치지 않는다.
   - (가) 첫 커밋 전 리포(`gitInit`만 한 것)의 루트와 하위 폴더에 `HEAD` 파일을 두고, 루트·하위 폴더에서 부른 `repoInfo`의 값이 `expected(cwd)`와 같고 `branch`가 `main`인지 본다. 띄운 git은 셋 이하다(예전 경로).
   - (나) 빠른 경로의 git 호출이 종료 코드 0으로 끝나도 출력의 다섯째 줄이 정확히 `--`가 아니면(다섯째 줄이 다른 글, 줄이 넷, 줄이 여섯) 예전 경로로 간다. `spawned`처럼 `spawnSync`를 감싸, 빠른 경로 호출(인자에 `--abbrev-ref=loose`가 있는 것)에만 꾸민 출력과 종료 코드 0을 돌려주고 나머지는 실제로 실행한다. 예전 경로가 불렸는지(`symbolic-ref`), 돌려준 값이 `expected(cwd)`와 같은지 단언한다.
   - (다) 커밋이 있는 리포의 detached HEAD, 브랜치와 같은 짧은 이름의 태그·원격 추적 ref가 있을 때 `repoInfo`가 git을 한 번만 띄우고 값이 `expected(cwd)`와 같다(있던 77행 테스트는 값만 본다).
2. **구현**: `scripts/lib/git.ts`의 `repoInfo` 빠른 경로 인자 끝에 `--`를 더한다(`[...REPO_DIRS_ARGS, '--abbrev-ref=loose', 'HEAD', '--']`). 출력이 다섯 줄이고 다섯째 줄이 정확히 `--`일 때만 넷째 줄을 브랜치로 쓴다. 그 밖에는 지금처럼 예전 경로로 간다. 함수의 설명 주석을 맞춘다.
3. **문서**: `docs/harness/architecture.md`의 `lib/git.ts` 줄에 적힌 빠른 경로 명령에 끝의 `--`와 다섯째 줄 확인을 반영한다.
4. **기록**: 변경 조각 `docs/harness/changes/20261126-repoinfo-head-file-s0.md`에 CHANGELOG 한 줄(Issue #252, #236의 회귀를 고쳤다는 것, git 실행 횟수는 그대로라는 것). 설계서는 고치지 않으므로 `## 설계서 변경 이력`을 두지 않는다.

## Acceptance Criteria

```bash
node --test scripts/test/repo-info.test.ts
test "$(grep -c '^test(' scripts/test/repo-info.test.ts)" = 8
grep -qF "'--abbrev-ref=loose', 'HEAD', '--'" scripts/lib/git.ts
grep -qF "abbrev-ref=loose HEAD --" docs/harness/architecture.md
BASE="$(git merge-base HEAD origin/main)" && test "$(git diff --name-only "$BASE" HEAD -- scripts | sort | tr '\n' ' ')" = "scripts/lib/git.ts scripts/test/repo-info.test.ts "
grep -qF 'Issue #252' docs/harness/changes/20261126-repoinfo-head-file-s0.md
node scripts/harness.ts check
```

## 금지사항

- `scripts/test/repo-info.test.ts`의 있던 테스트를 고치지 마라. 이유: 있던 동작(값, git 실행 횟수)이 그대로임을 보이는 근거다.
- `repoInfo`가 보통 경우에 git을 두 번 이상 띄우게 하지 마라. 이유: Issue #230(Windows 속도)의 목적이다.
- `scripts/lib/git.ts`의 다른 함수를 바꾸지 마라. 이유: 범위 밖이다.
