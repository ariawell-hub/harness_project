# Step 0: safe-read

## 읽어야 할 파일

- `docs/exec-plans/active/20261125-plan-symlink/plan.md`(목표와 수용 기준, 의사결정 로그)
- `scripts/lib/plan.ts`(`planCandidates`, `findPlan`, `stepFile`, `parseIndex`), `scripts/lib/git.ts`(git 실행 도우미)
- `scripts/gates/scope.ts`의 `readPlanAtHead`·`entriesAt`: 같은 문제를 HEAD 커밋 읽기로 막은 예(모드 120000·160000 판정)
- 바꿀 호출자: `scripts/gates/plan-gate.ts`(`read`, `findPlan`), `scripts/gates/risk-gate.ts`(`planRisk`), `scripts/ci/plan-hash.ts`(`planHash`, `planHashes`, `planMode`), `scripts/ci/review-plan.ts`(`planAuthor`), `scripts/ci/review-input.ts`(`writeReviewInput`)
- `scripts/ci/gates.ts`의 `guarded`(판정이 던지면 `error`), `scripts/ci/review-plan.ts`의 `planReview`(위험도를 못 내면 high)
- 기존 테스트: `scripts/test/plan-gate.test.ts`, `plan-hash.test.ts`(git 리포가 아닌 임시 폴더에서도 `planHash`를 부른다), `risk-gate.test.ts`, `gates.test.ts`, `scripts/test/helpers.ts`. 링크를 만드는 테스트의 예: `scripts/test/changes.test.ts`(`EPERM`이면 그 경우만 건너뛴다), `scripts/test/init.test.ts`
- `docs/harness/design.md` 10.4절 "심볼릭 링크" 항목

## 작업

1. 테스트를 먼저 쓰고 지금 코드에서 실패하는 것을 본다.
   - `scripts/test/plan-symlink.test.ts`(새 파일): 새 모듈을 import하지 않고 기존 함수(`planGate`, `assessRisk`·`riskGate`, `planHash`, `planHashes`, `planMode`, `planAuthor`, `writeReviewInput`)만 부른다(변경 전 코드에서도 단언으로 실패하게).
     - 픽스처: git 리포(브랜치 `fix/<id>-s0`)에 정상 계획(`risk: high`, `author: claude-code`, step 하나)을 커밋하고, 리포 밖 임시 폴더에 "그럴듯한 계획"(`risk: low`, `author: codex`, 표식 글 `LINK-TARGET-MARKER`가 든 `plan.md`·`index.json`·`step0.md`)을 둔다.
     - 링크의 꼴(경우마다 새 픽스처): (가) `plan.md`를 밖의 `plan.md`로 가리키는 파일 링크, (나) 계획 폴더를 밖의 폴더로 가리키는 폴더 링크(정션), (다) `index.json` 파일 링크, (라) `step0.md` 파일 링크, (마) 계획 파일 링크를 커밋한 리포를 `git -c core.symlinks=false clone`으로 받은 체크아웃, (바) 계획 폴더 링크를 커밋한 리포를 같은 방법으로 받은 체크아웃, (사) `step0.md`를 작업 트리에서 지우고 색인에만 모드 120000으로 둔 리포(작업 트리 목록에 step 파일이 없다). (마)·(바)·(사)의 링크는 `git update-index --add --cacheinfo 120000,<대상 경로 글의 blob>,<경로>`로 커밋해 링크를 만들 권한이 없어도 돈다. 파일 링크를 만들다 `EPERM`이면 그 경우만 건너뛴다(개발자 모드가 꺼진 Windows).
     - 경우마다 단언(모든 꼴): `planGate`(mode `pr`와 `plan`)의 문제 가운데 하나가 "계획 자리가 일반 파일·폴더가 아니다"와 그 자리의 경로를 담는다. `planHash`·`planHashes`가 던지고 `planMode`가 `{ mode: 'code', hash: '' }`다. `writeReviewInput`이 쓴 `context.md`에 "읽지 않음"이 있다. 결과(문제 글, 위험도 사유, `context.md`)를 이은 글에 `LINK-TARGET-MARKER`, `risk: low`, `codex`가 없다.
     - 계획 파일·계획 폴더의 꼴((가)·(나)·(마)·(바))에서만: `assessRisk`가 던지고, `riskGate`를 `gates`처럼(`guarded`와 같이 던지면 `error`로) 부른 결과가 통과가 아니다. `planAuthor`가 `''`다.
     - `index.json`·step 파일의 꼴((다)·(라)·(사))에서는: `assessRisk`의 위험도가 high(정상 계획의 `risk: high`)이고 `planAuthor`가 `claude-code`다(읽지 않는 자리의 링크가 결과를 바꾸지 않는다).
     - 숫자로 바꾸면 이름이 달라지는 step 링크: `index.json`은 step0만 적고, `step9007199254740993.md`를 작업 트리에 두지 않고 색인에만 모드 120000으로 커밋한 리포에서 `planHash`·`planHashes`가 그 원래 경로(`…/step9007199254740993.md`)를 메시지에 담아 던지고 `planMode`가 `{ mode: 'code', hash: '' }`다.
     - 읽지 않는 자리의 링크(대조): 계획 폴더의 참고 파일 `notes.md`를 작업 트리에 두지 않고 색인에만 모드 120000으로 커밋한 리포에서 `planHash`가 `planHashAt(root, 'HEAD', 계획 폴더)`와 같고, `planMode`가 `{ mode: 'plan', hash: <그 해시> }`이며, `planGate` mode `plan`이 통과한다(링크를 만들 권한이 없어도 돈다).
     - 링크 없는 같은 픽스처(대조): `planGate` 통과, `assessRisk`의 위험도 high(계획 risk), `planAuthor`가 `claude-code`, `planHash`가 `planHashAt(root, 'HEAD', 계획 폴더)`와 같다.
     - 커밋하지 않은 계획: 계획 파일을 추적하지 않은 채(커밋 전) `planGate` mode `plan`이 통과하고 `planHash`가 계산된다.
     - 이 리포의 계획: `docs/exec-plans/{active,completed}/`의 계획 폴더마다 `planHash(HARNESS_ROOT, 폴더)`가 `planHashAt(HARNESS_ROOT, 'HEAD', 폴더)`와 같다(HEAD에 있는 폴더만. 작업 트리에서 바뀐 계획은 건너뛴다).
   - `scripts/test/plan-read.test.ts`(새 파일): `findPlanSafe`, `readPlanFile`, `listPlanDir` 단위 테스트. 일반 파일·폴더는 글·목록, 없으면 `null`·`[]`, 파일 링크·폴더 링크(정션)·위 폴더 자리의 링크·폴더 자리의 일반 파일·파일 자리의 폴더는 `PlanPathError`(그 자리의 경로가 메시지에 있다), 색인에 120000·160000으로 있는 자리(`update-index --cacheinfo`로 만든다)는 `PlanPathError`(작업 트리에 그 자리가 없고 색인에만 있어도: `findPlanSafe`가 뒤 후보로 넘어가지 않고 던진다), 폴더 바로 아래에 작업 트리에는 없고 색인에만 링크로 있는 항목이 있으면 `listPlanDir`가 던지지 않고 그 이름을 목록에 넣으며 그 이름을 `readPlanFile`로 읽으면 던진다, git 리포가 아닌 폴더에서는 `lstat`만으로 판정, 색인 파일이 깨진 리포(`.git/index`에 쓰레기 글)에서는 던진다.
2. `scripts/lib/plan-read.ts`(새 파일):
   - `export class PlanPathError extends Error`(그 자리의 리포 기준 경로를 `place`로 갖는다).
   - `export function readPlanFile(root: string, rel: string): string | null`, `export function listPlanDir(root: string, rel: string): string[]`, `export function findPlanSafe(root: string, id: string): PlanRef | null`(`planCandidates` 순서. 후보의 계획 파일이 있으면 그 후보).
   - 판정 순서: 먼저 색인. `root`가 git 작업 트리 안이면 색인(`git ls-files -s -z`)에서 모드 120000·160000인 경로를 모아, `rel`을 `/`로 나눈 각 자리 가운데 그 모음에 있는 것이 있으면 `PlanPathError`(작업 트리에 그 자리가 없어도). git 리포가 아니면("not a git repository") 색인은 보지 않고, 그 밖의 이유로 색인을 읽지 못하면 던진다. 그다음 각 자리를 `root`부터 차례로 `lstat`한다. 없으면 그 뒤를 보지 않고 없는 것으로 돌려준다. 링크면 `PlanPathError`. 폴더 자리가 폴더가 아니거나 마지막 자리가 기대한 종류(파일·폴더)가 아니면 `PlanPathError`.
   - 폴더 읽기(`listPlanDir`, `list`)는 작업 트리의 이름(`readdirSync`)에, 색인에서 모은 링크·서브모듈 경로 가운데 그 폴더 바로 아래 항목(`<rel>/<이름>`, 이름에 `/`가 없는 것)의 이름을 작업 트리 목록에 없으면 더해 돌려준다. 목록만으로는 던지지 않는다: 그 이름을 읽는 쪽(`read`)이 읽을 때 색인으로 거절한다. 그래서 작업 트리 목록에 없는 step 링크를 계획 해시가 읽다가 거절하고, 해시가 읽지 않는 같은 폴더의 다른 링크는 결과를 바꾸지 않는다.
   - 한 판정 안에서 여러 자리를 읽는 호출자(`plan-gate`, 계획 해시)를 위해 색인을 한 번만 읽는 읽기 객체 `planReader(root)`(`find`·`read`·`list`)를 함께 내보낸다. 위 세 함수는 그것을 한 번 쓰는 꼴이다.
3. 호출자를 바꾼다(판정 규칙은 그대로):
   - `scripts/gates/plan-gate.ts`: `findPlan` → `findPlanSafe`, `read` → `readPlanFile`. `PlanPathError`를 잡아 문제 하나("계획 자리가 일반 파일·폴더가 아니다(심볼릭 링크·서브모듈): <자리>", 고치는 법: 계획 자리에 링크를 두지 말고 일반 파일로 커밋하라)로 돌려주고 그 뒤 검사를 하지 않는다.
   - `scripts/gates/risk-gate.ts`의 `planRisk`: `findPlanSafe`·`readPlanFile`. `PlanPathError`는 잡지 않는다(`assessRisk`가 던진다).
   - `scripts/ci/plan-hash.ts`: `planHash`의 `read`·`list`를 `planReader`의 `read`·`list`로, `planHashes`·`planMode`의 `findPlan`을 `findPlanSafe`로. `planHash`는 해시 입력(`plan.md`, step 파일)을 그대로 두고, `index.json` 자리도 같은 읽기로 확인한다(있으면 일반 파일이어야 한다. 글은 해시에 넣지 않는다: 이 리포의 계획 해시가 그대로다). 또 해시를 계산하기 전에 폴더 목록에서 step 파일 이름(`step<N>.md`)에 맞는 이름마다 그 원래 이름의 자리를 읽어 확인한다: 해시 계산기(`hashFrom`)는 번호를 숫자로 바꿔 경로를 다시 만들어, 숫자로 바꾸면 달라지는 이름(`step9007199254740993.md`)의 링크를 읽지 않기 때문이다. 해시 입력은 바꾸지 않는다. `planMode`는 던지면 `{ mode: 'code', hash: '' }`(지금 `planHash` 실패와 같다).
   - `scripts/ci/review-plan.ts`의 `planAuthor`: `findPlanSafe`·`readPlanFile`. `PlanPathError`면 `''`.
   - `scripts/ci/review-input.ts`: `findPlanSafe`. `PlanPathError`면 계획 줄을 "읽지 않음(일반 파일·폴더가 아니다: <자리>)"로, step 줄을 "없음"으로 쓴다. 계획을 찾았고 step 브랜치면 `index.json` 자리와 step 파일 자리도 같은 판정(`readPlanFile`)으로 보고, 어느 쪽이든 링크면 step 줄을 "읽지 않음(일반 파일·폴더가 아니다: <자리>)"으로 쓴다(검증자가 그 경로를 열지 않게).
4. 문서:
   - `docs/harness/design.md` 10.4절 "심볼릭 링크" 항목 끝에: 계획을 읽는 base 스크립트(`plan-gate`, `risk-gate`, 계획 해시, 검증 입력)는 체크아웃 설정과 무관하게 계획 자리의 링크를 따라가지 않고 판정을 실패 쪽으로 둔다(`scripts/lib/plan-read.ts`, Issue #194).
   - `docs/harness/architecture.md` 라이브러리 목록에 `plan-read`.
   - 변경 조각 `docs/harness/changes/20261125-plan-symlink-s0.md`(`## CHANGELOG`, `## 설계서 변경 이력`).

## Acceptance Criteria

```bash
node --test scripts/test/plan-read.test.ts scripts/test/plan-symlink.test.ts scripts/test/plan-gate.test.ts scripts/test/plan-hash.test.ts scripts/test/risk-gate.test.ts scripts/test/gates.test.ts scripts/test/ci.test.ts scripts/test/scope.test.ts scripts/test/runner-plan-review.test.ts scripts/test/task.test.ts
L=$(mktemp -d)/test-effect.log && node scripts/harness.ts test-effect > "$L" 2>&1 && grep -F 'scripts/test/plan-symlink.test.ts: effective(base에서 단언 실패,' "$L"
node scripts/harness.ts check
```

## 금지사항

- `findPlan`과 로컬 명령·L1 훅의 계획 읽기를 바꾸지 마라. 이유: 자기 worktree를 읽는 쪽은 이 계획의 대상이 아니다(비범위). 훅 판정이 바뀌면 다른 계획의 일이 된다.
- 판정 규칙(문제 목록, 위험도 계산, 해시에 넣는 섹션)을 바꾸지 마라. 이유: 읽는 자리만 바꾼다. 기존 테스트가 단언을 고치지 않고 통과하고 이 리포의 계획 해시가 그대로여야 승인된 계획들이 다시 검증받지 않는다.
- 워크플로(`.github/workflows/`)를 고치지 마라. 이유: `core.symlinks false`는 그대로 두고 코드에 보호를 더한다. 워크플로는 봇이 push할 수 없다.
- 새 테스트를 플랫폼 조건이나 `skip`으로 빼지 마라. 파일 링크를 만들 권한이 없을 때(`EPERM`)만 그 경우를 건너뛴다. 이유: 폴더 링크(정션)와 `core.symlinks=false` 경우는 어느 OS에서나 돈다.
- 링크 대상을 읽어 내용으로 판정하지 마라(예: 링크가 리포 안의 계획을 가리키면 허용). 이유: 무엇이 맞는 계획인지 정할 수 없고, 링크를 거쳐 읽는 길을 남기지 않는 것이 목적이다.
