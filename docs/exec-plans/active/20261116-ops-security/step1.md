# Step 1: revert-workflow

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 2, 의사결정 로그의 재실행·봇 토큰 결정)
- `docs/harness/design.md` 10.3절 "병합 후 main CI가 실패하면", 10.4절(역할별 environment, 캐시 규칙), 0.2절(Actions 설정), 14.4절(R14)
- 앞 step에서 만든·바꾼 파일: `scripts/gates/revert-check.ts`(`revertTarget`, `revertCheck`), `scripts/ci/revert-evidence.ts`, `scripts/ci/gates.ts`
- `scripts/lib/github.ts`(`GitHubPort`: `comment`, `addLabel`, `reopenIssue`, `createPR`), `scripts/lib/github-fake.ts`, `scripts/lib/git.ts`
- `scripts/gates/risk-gate.ts`(`assessRisk`, `changedFiles`), `scripts/lib/plan.ts`(`findPlan`, `parseBranch`)
- `.github/workflows/gates.yml`(액션 고정 SHA, 기록 job 형식), `.github/workflows/check.yml`
- `scripts/gates/harness-guard.ts`(환경·캐시·쓰기 권한 검사)

## 작업

1. `scripts/ci/revert.ts`

   ```ts
   export type RevertAction =
     | { action: 'skip'; reason: string }
     | { action: 'rerun'; runId: number }
     | { action: 'escalate'; reason: string; issue: number | null; pr: number | null }
     | {
         action: 'revert';
         target: string;
         pr: number;
         issue: number | null;
         closes: boolean;
         title: string;
       };

   /** 무엇을 할지 정한다(순수 함수. 조회 결과는 인자로 받는다) */
   export function decideRevert(o: {
     run: {
       id: number;
       headSha: string;
       attempt: number;
       conclusion: string;
       event: string;
       branch: string;
     };
     defaultBranch: string;
     /** 대상이 main의 first-parent 이력에 있는가 */
     onMain: boolean;
     /** 대상 커밋을 병합한 PR. 없으면 null */
     source: { number: number; headRef: string; title: string; body: string } | null;
     /** revert/<대상> 브랜치나 그 PR이 이미 있는가 */
     exists: boolean;
     /** 되돌려도 복구되지 않는 변경인가(계획 risk: high, 경로 표의 높음 경로) */
     irreversible: boolean;
   }): RevertAction;

   /** 정한 일을 한다. git은 main 체크아웃에서, GitHub은 포트로 */
   export function actRevert(
     o: { root: string; gh: GitHubPort; cfg: HarnessConfig; runUrl: string },
     a: RevertAction,
   ): { done: string };
   ```

   - `decideRevert` 순서: push 이벤트·기본 브랜치·결론 `failure`|`timed_out`이 아니면 `skip` → `onMain`이 아니면 `skip` → `attempt`가 1이면 `rerun` → `exists`면 `skip` → `source`가 없으면 `escalate` → `source.headRef`가 `revert/`로 시작하면 `escalate`(revert의 revert는 자동으로 하지 않는다) → `irreversible`이면 `escalate` → `revert`.
   - 원래 Issue는 `source.body` 첫 줄의 `Closes #N`·`Refs #N`에서 읽는다(`closes`는 `Closes`일 때 true).
   - `irreversible`은 대상 커밋 트리의 계획 `risk`(브랜치 이름 `source.headRef`로 찾는다)가 `high`이거나, 대상이 바꾼 파일이 `cfg.riskPaths`의 `high` 항목에 걸릴 때다. 보호 경로의 단계별 위험도(`stage`)는 넣지 않는다.
   - `actRevert`의 `revert`: `revert/<대상>` 브랜치를 `origin/<기본 브랜치>`에서 만들고 `git revert --no-edit <대상>`. 충돌하면 `git revert --abort` 뒤 에스컬레이션으로 바꾼다. 일반 push(실패하면 에스컬레이션) → PR 생성(제목 `revert: <원래 제목>`, 본문 첫 줄 `Refs #<issue>`, 대상 SHA·원래 PR·실패한 실행 링크) → 자동 병합 켜기 → `closes`면 Issue 다시 열기 → Issue 댓글(무엇이 실패했는지, revert PR, 이어 가는 명령: revert 병합 뒤 `node scripts/harness.ts new-task --issue <N>` 또는 `--plan <id> --step <N>`).
   - Issue 댓글에는 복원용 표식 한 줄을 넣는다: `<!-- harness-revert target=<40자 SHA> plan=<계획 id> -->`(#57 계획(`20261116-ops-transition`)의 step0 plan-restore가 읽는다. 계획 id는 `source.headRef`에서). 표식을 만드는 함수와 읽는 함수는 한 모듈 `scripts/lib/revert-marker.ts`(`revertMarker`, `findRevertMarker`)에 둔다. 그 모듈이 main에 이미 있으면 그것을 쓰고, 없으면 이 step이 만든다.
   - `escalate`: 원래 Issue(없으면 원래 PR)에 이유와 제작자 멘션 댓글, `needs-human` 라벨. 같은 표식의 댓글이 마지막이면 다시 달지 않는다.
   - `rerun`: `gh run rerun <runId> --failed`(포트에 메서드를 더한다. 가짜 GitHub은 호출을 기록한다).
   - 댓글에 넣는 제목·본문 값은 한 줄로 만들고 멘션·마크다운이 해석되지 않게 한다(`scripts/ci/ledger.ts`의 `cell`과 같은 처리).

2. `scripts/harness.ts`: `revert-plan --event <이벤트 JSON>`(조회 후 `decideRevert` 결과를 `$GITHUB_OUTPUT`에 `action`·`data`(base64 JSON)로 쓴다. 비밀 없음)와 `revert-act --data <base64 JSON> --run-url <url>`(`actRevert`). `revert-act`는 받은 값을 다시 검사한다(SHA 형식, 대상이 main 이력에 있는지).

3. `.github/workflows/revert.yml`
   - `on: workflow_run`(`workflows: [check]`, `types: [completed]`). `permissions: {}`.
   - job `plan`: `if`로 `event == 'push'`, `head_branch == 'main'`, 결론이 실패일 때만. 권한 `contents: read`, `pull-requests: read`, `checks: read`. main 체크아웃(`fetch-depth: 0`, 자격증명 남기지 않음) 뒤 `revert-plan`.
   - job `act`: `needs: plan`, `action`이 `skip`이 아닐 때. `environment: revert`, 권한 `contents: read`. main 체크아웃(`fetch-depth: 0`) 뒤 `GH_TOKEN: ${{ secrets.REVERT_BOT_TOKEN }}`으로 `revert-act`. git push 인증은 `gh auth setup-git`으로 한다(토큰을 URL·명령 인자에 넣지 않는다).
   - 액션은 `gates.yml`과 같은 커밋 SHA로 고정한다. 캐시를 쓰지 않는다. PR 유래 값은 run 스크립트에 직접 넣지 않고 env로 넘긴다.
   - concurrency: 워크플로 단위 하나씩(`cancel-in-progress: false`).

4. `scripts/gates/harness-guard.ts`: 바꿀 것이 있으면만 바꾼다(`revert`는 이미 허용 environment다). `revert.yml`이 캐시 규칙과 environment 검사를 통과하는지 테스트로 확인한다.

5. 테스트(새 파일 `scripts/test/revert.test.ts`)
   - `decideRevert`: 위 순서의 갈래마다 하나씩. `Closes`/`Refs` 읽기, 본문에 Issue 줄이 없을 때.
   - `actRevert`(임시 git 리포 + 로컬 원격 + 가짜 GitHub): revert PR의 변경이 `revertCheck`에서 `verified`가 될 조건(b)을 만족한다(대상의 정확한 역적용). 자동 병합이 켜지고, `closes`면 Issue가 다시 열리고, 댓글에 표식이 있다. 충돌하면 브랜치가 원격에 없고 `needs-human`이 붙는다. 같은 대상을 두 번 처리해도 PR·댓글이 하나다.
   - `irreversible`: 계획 `risk: high`, 높음 경로.
   - 워크플로 파일: `harnessGuard`가 `revert.yml`을 더하는 PR에서 캐시·environment 실패나 "정해 둔 environment 밖 참조" 신호를 내지 않는다. `act` job만 environment를 참조한다.

6. 문서: 설계서 10.3절 "병합 후 main CI가 실패하면"(재실행, 에스컬레이션 조건, 표식), 10.4절 표에 revert 워크플로 행, `docs/SECURITY.md` 자격증명 표의 `revert` 행(`REVERT_BOT_TOKEN`), 절차서(revert 뒤 이어 가기 한 줄), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/revert.test.ts scripts/test/revert-check.test.ts scripts/test/harness-guard.test.ts
grep -q "export function decideRevert" scripts/ci/revert.ts
grep -q "environment: revert" .github/workflows/revert.yml
! grep -nE "actions/cache|^\s*cache:" .github/workflows/revert.yml
! grep -nE ":\s*write(-all)?\s*$" .github/workflows/revert.yml
! grep -nE "'--hard'|'--force'|force-with-lease" scripts/ci/revert.ts
```

## 금지사항

- `git reset --hard`, force push로 main이나 브랜치를 되돌리지 마라. 이유: R14. 되돌리기는 `git revert` 커밋의 PR로만 한다.
- main에 직접 push하지 마라. 이유: R2. revert도 PR과 필수 체크를 거친다.
- 워크플로의 `GITHUB_TOKEN`에 쓰기 권한을 주지 마라. 이유: 쓰기는 `revert` environment의 봇 토큰 하나로 모은다(계획 의사결정 로그). 새 `write` 권한은 `harness-guard` 신호다.
- `plan` job에 environment나 비밀을 두지 마라. 이유: 조회와 결정에는 읽기 권한이면 된다. 비밀을 가진 job을 하나로 줄인다.
- revert PR의 병합 커밋이 실패했을 때 그것을 다시 자동으로 되돌리지 마라. 이유: 실패 원인이 대상이 아니면 revert가 끝없이 이어진다.
- PR 본문에 `- [x] 보호 경로 변경:` 줄을 기계로 넣지 마라. 이유: 작성자 확인 표시다. 확인된 revert PR은 step0에서 그 검사를 면제받는다.
