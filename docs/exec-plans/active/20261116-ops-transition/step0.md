# Step 0: plan-restore

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-transition/plan.md` (수용 기준 1)
- `docs/harness/design.md` 8.3절("되돌리기": revert 뒤 계획 복원), 10.3절 "병합 후 main CI가 실패하면", 4.5절(다음 할 일 우선순위)
- 표식의 형식: Issue 댓글의 `<!-- harness-revert target=<40자 SHA> plan=<계획 id> -->`. 보안 계획(`20261116-ops-security`, #102) step1의 revert 워크플로가 봇 토큰으로 단다
- `scripts/commands/task.ts`(`newTask`, `writeSkeleton`, `claimIssue`, `releaseClosedClaims`), `scripts/lib/plan.ts`(`findPlan`, `findPlanAt`, 계획 읽기·쓰기), `scripts/lib/git.ts`(`showFile`)
- `scripts/commands/start.ts`, `scripts/runner/next.ts`(Issue 후보와 진행 중인 계획 고르기)
- `scripts/test/task.test.ts`, `scripts/test/start.test.ts`

## 작업

1. `scripts/lib/revert-marker.ts`와 `scripts/commands/task.ts`
   - 표식을 만드는 함수와 읽는 함수는 한 모듈 `scripts/lib/revert-marker.ts`(`revertMarker`, `findRevertMarker`)에 둔다. 그 모듈이 main에 이미 있으면 그것을 쓰고, 없으면 이 step이 만든다. `revertMarker(target, planId): string`은 위 형식의 한 줄을 만든다.
   - `findRevertMarker(comments, bot): { target: string; planId: string } | null`: 작성자가 `cfg.github.bot`인 댓글 가운데 가장 최근의 표식을 읽는다. 다른 계정의 댓글과 형식이 다른 표식은 무시한다.
   - `restorePlan(wt, base, m: { target; planId; issue }): PlanRef | null`: 다음을 모두 확인한 뒤에만 복원한다. `m.target`이 `origin/<기본 브랜치>`의 조상이다. `m.target` 트리에 계획 `planId`가 있고 frontmatter `issue`가 `m.issue`다. base(지금 main)에는 그 계획이 없다. 하나라도 아니면 null(새 골격으로 간다).
     - 계획 파일·폴더를 `m.target` 트리에서 읽어 `docs/exec-plans/active/` 아래에 쓴다(`completed/`에 있었어도 `active/`로).
     - `m.target^`의 계획과 비교해 그 커밋에서 `completed`가 된 step을 `pending`으로 되돌리고 `completed_at`·`summary`를 지운다. 계획 `status`는 `active`, `owner`는 지금 작업자다.
     - 진행 로그에 한 줄(`revert된 계획 복원: 대상 <SHA 앞 12자>`)을 더한다. "목표와 수용 기준"·"범위 / 비범위"·"관련 파일·문서"와 step 파일의 "작업"·"Acceptance Criteria"·"금지사항"은 한 글자도 바꾸지 않는다.
   - `newTask`(`--issue`): 골격을 쓰기 전에 Issue 댓글에서 표식을 찾아 `restorePlan`을 시도한다. 복원되면 계획 id·type·브랜치 이름(`<type>/<id>-s<되돌려진 step>`)을 복원한 계획에서 정하고, `--slug`·`--size`·`--risk`는 무시했다고 출력한다. `--no-github`이면 복원하지 않는다.
   - `newTask`(`--plan <id> --step <N>`): 그 계획의 Issue가 열려 있는데 `claim/<issue>`가 원격에 없으면 다시 선점한다(이미 있으면 지금처럼 진행한다). 다른 작업자의 선점이면 지금처럼 거부한다.
2. `scripts/commands/start.ts`·`scripts/runner/next.ts`: 바꿀 것이 있으면만 바꾼다. 확인할 것: revert가 병합된 뒤 main의 계획이 `active/`에 있고 되돌려진 step이 끝나지 않은 상태면 "다음 step"으로 고른다. 계획이 main에 없고 Issue가 다시 열려 있으면 Issue 후보로 고른다.
3. 테스트(`scripts/test/task.test.ts`에 더한다. 임시 리포 + 가짜 GitHub)
   - 첫 step의 PR(계획이 그 커밋에서 처음 들어옴)을 revert한 뒤 `new-task --issue N`: 같은 id의 계획이 `active/`에 있고 step0이 `pending`, 핵심 섹션 해시(`scripts/ci/plan-hash.ts`)가 대상 커밋의 계획과 같다.
   - 소규모 계획(단일 파일)의 revert 복원.
   - 마지막 step의 PR을 revert한 경우: main의 계획이 `active/`로 돌아와 있으므로 복원하지 않고, `new-task --plan <id> --step <N>`이 claim이 없으면 다시 선점한다.
   - 표식이 봇이 아닌 계정의 댓글에 있으면 무시한다. 대상이 main의 조상이 아니거나 계획의 `issue`가 다르면 새 골격을 만든다.
   - 표식이 없는 평소의 `new-task --issue`는 지금과 같다.
4. 문서: 설계서 8.3절 "되돌리기"에 복원 방법, 절차서 1절 또는 5절에 revert 뒤 이어 가는 절차, `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/task.test.ts scripts/test/start.test.ts scripts/test/next.test.ts
grep -q "export function restorePlan" scripts/commands/task.ts
grep -q "harness-revert" scripts/lib/revert-marker.ts
```

## 금지사항

- 표식의 SHA를 검사 없이 git 명령에 넘기지 마라. 이유: Issue 댓글은 외부 입력이다(14.6절). 40자 hex 형식과 main 조상 여부를 먼저 본다.
- 복원하면서 계획의 핵심 섹션이나 step 파일의 작업·AC·금지사항을 고치지 마라. 이유: 계획 해시가 바뀌어 이미 받은 계획 승인이 무효가 된다(10.3절).
- 봇이 아닌 계정이 단 표식을 믿지 마라. 이유: 표식은 revert 워크플로(봇 토큰)만 단다.
- revert 대상 커밋보다 옛 이력에서 계획을 찾아 복원하지 마라. 이유: 표식이 가리키는 커밋의 계획만이 되돌려진 계획이다.
