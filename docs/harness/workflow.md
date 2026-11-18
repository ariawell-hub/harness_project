---
status: active
related_code: [scripts/commands/, scripts/runner/, docs/exec-plans/TEMPLATE*.md]
review_cycle: on-change
---

# 작업 절차서 (에이전트용)

작업 루프의 단계별 명령과 형식만 담는다. "왜"는 [설계서](design.md)에 있고, 작업 중에는 읽지 않아도 된다.

## 1. 접수와 작업 공간

```bash
node scripts/harness.ts start                                   # 세션 시작 절차
node scripts/harness.ts new-task --issue 42 --slug login-rate-limit --size medium
```

- 작업은 GitHub Issue로만 접수한다.
  - **제작자가 대화에서 직접 지시한 일**은 묻지 않고 봇이 Issue를 등록한 뒤 그 세션이 바로 `new-task`로 시작한다. 본문 첫 줄에 `> 출처: 제작자 대화 지시(<날짜>). 봇이 대신 등록했다.`를 적는다.
  - 지시 없이 에이전트가 스스로 떠올린 일(발견 사항, 개선 아이디어)은 Issue를 만들지 않는다. 제작자에게 제안하거나 TD·발견 사항으로 남긴다.
  - runner는 제작자·외주 개발자(`harness.config.json`의 `github.collaborators`) 계정이 만든 Issue만 가져간다. 봇 계정이 대신 등록한 Issue는 runner가 고르지 않는다. 대화 세션의 `new-task --issue`로는 시작할 수 있다.
  - 봇이 대신 등록한 Issue를 runner에 맡기려면 `harness.config.json`의 `github.botIssues`가 `"owner-approved"`여야 한다(기본값 `"exclude"`). 그 상태에서 제작자 계정으로 그 Issue에 `/harness accept` 한 줄 댓글을 달면 후보가 된다. 봇·외주 개발자 계정의 댓글, 인용, 문장 속 언급, 코드 블록 안의 줄은 승인이 아니다. 취소하려면 Issue를 닫거나 `needs-human` 라벨을 붙인다.
  - runner는 Issue를 만든 뒤의 변경도 본다(설계서 14.6절). 허용 계정이 아닌 계정(봇 등)이 제목·본문을 고쳤으면 그 Issue를 고르지 않고, 이미 맡았으면 계획을 멈추고 `needs-human`으로 알린다. 내용을 확인하고 맞으면 제작자 계정으로 `/harness accept` 한 줄 댓글을 단다(봇 Issue 설정과 관계없다). 승인 뒤에 다시 고쳐지면 다시 승인한다. 다른 계정이 고친 제작자 댓글은 답·승인이 아니므로 새 댓글로 단다.
- `new-task`가 `claim/<issue>`를 push해 선점한다. 거부되면 다른 작업자가 이미 맡은 것이니 다음 Issue로 간다.
  - **병합된 PR이 revert된 뒤 이어 가기**(설계서 8.3절 "되돌리기"): main의 `check`가 다시 실행한 뒤에도 실패하면 revert 워크플로가 revert PR을 만들고 원래 Issue에 이어 갈 명령을 댓글로 남긴다(10.3절). revert PR이 병합된 뒤에 시작한다. `needs-human`이 붙었으면 자동으로 되돌리지 않은 것이니 제작자의 답을 기다린다. 먼저 `start`로 병합된 옛 worktree를 정리한다. 계획이 main에서 빠졌으면(첫 step이나 소규모 계획의 PR이 되돌려짐) `new-task --issue <N>`을 다시 실행한다. revert 워크플로가 Issue에 단 표식을 읽어 새 골격 대신 그 계획을 같은 id·같은 브랜치 이름으로 복원한다(`--slug`·`--size`·`--risk`는 무시한다). 계획이 main에 남아 있으면(둘째 step부터) `new-task --plan <id> --step <N>`으로 그 step을 다시 한다. 선점이 풀려 있으면 이때 다시 잡는다. 복원한 계획의 핵심 섹션과 step 파일은 그대로 두고(계획 승인이 유지된다) 되돌려진 원인을 진행 로그에 적은 뒤 고친다.
  - 선점은 마지막 step이 병합되어 Issue가 닫힌 뒤 다음 `start`가 지운다(닫혔음을 확인 못 하면 남긴다). 손으로 지우지 않는다. 만료된 선점 정리는 아직 없다(TD-11).
- **대화 세션은 main 체크아웃에 머문 채** `new-task`가 출력한 worktree 경로의 파일을 고친다. 자기 계획(`owner`가 현재 작업자)의 worktree면 L1 훅이 허용하므로 `EnterWorktree`(사람 승인 필요)로 옮겨 갈 필요가 없다. 다른 작업자(runner 등)의 worktree는 막힌다.
  - 셸 명령은 `git -C <worktree> …` 또는 `cd <worktree> && …`로 실행한다.
  - push는 브랜치 이름을 적는다: `git -C <worktree> push -u origin <브랜치>`. 인자 없는 `git push`는 세션 위치(main) 기준으로 판정되어 R2로 막힌다.
  - `start`는 병합된 worktree를 지우지만, 실행한 프로세스가 들어 있는 worktree는 "남김"으로 두고 이유를 출력한다. 다른 세션이 정리해서 세션이 있던 worktree가 사라졌다면(명령마다 "Working directory … was deleted") `ExitWorktree` 또는 main 체크아웃으로 `cd`해서 돌아온다.
- 규모(4.3절)는 아래 기준으로 정한다. 애매하면 큰 쪽을 고른다. 동작이 바뀌는 변경은 아무리 작아도 medium 이상이다.

| 규모   | 예                       | 계획 형태                                                            |
| ------ | ------------------------ | -------------------------------------------------------------------- |
| small  | 오타, 문구, 설정값 하나  | `active/<id>.md` 한 파일(목표/변경/검증 3줄). 이 파일이 곧 step 하나 |
| medium | 기능 하나, 버그 수정     | `active/<id>/plan.md` + `index.json` + `stepN.md` (보통 1~3개)       |
| large  | 여러 모듈, 아키텍처 변경 | 위와 같고 step이 여러 개                                             |

- 위험도(`risk`)는 규모와 별개다: low(문서·소규모), normal(일반 코드·lockfile), high(보안·인증·마이그레이션·데이터 스크립트).
  - high는 이 기준에 해당하는 작업에만 붙인다. 계획의 `risk`가 high면 그 계획의 모든 PR에 제작자 승인이 필요하므로, 기준에 해당하는 일과 아닌 일은 계획(Issue)을 나눈다.
  - 검사 약화·권한 변경이 없는 후속 수정(오타, 설치 경로, 문서)은 normal로 올린다(제작자 결정, 2026-11-15). 약화·완화가 섞이면 `harness-guard`가 높음으로 올린다.
  - 애매하면 high다. 승인을 줄이려고 기준에 해당하는 작업을 낮춰 적지 않는다.
- 진행 로그를 갱신할 때 `node scripts/harness.ts claim-heartbeat --issue <N>`로 선점이 살아 있음을 알린다(24시간 무응답이면 만료).
- **여러 머신(Mac·Windows)에서 일하면 작업자 이름을 머신마다 고유하게 정한다**: 대화 세션은 환경 변수 `HARNESS_WORKER`(예: `mac-session`), runner는 `--worker`(예: `win-runner-1`). 계획의 `owner`가 이 이름이라, 같은 이름이면 서로의 계획을 자기 것으로 본다.
- Windows는 네이티브로 작업한다(WSL 아님). Git for Windows(Git Bash)가 필요하고, 하네스는 셸 명령을 Git Bash로 실행한다([ADR-0005](../decisions/ADR-0005-windows-native.md)).

## 2. 계획 작성 (코드보다 먼저)

`new-task`가 만든 골격을 worktree 안에서 채운다. 템플릿: [TEMPLATE.md](../exec-plans/TEMPLATE.md), [TEMPLATE-small.md](../exec-plans/TEMPLATE-small.md), [TEMPLATE-step.md](../exec-plans/TEMPLATE-step.md)

- frontmatter의 `id`·`issue`·`owner`는 바꾸지 않는다. 다 채웠으면 `status: active`.
- 필수 섹션: **목표와 수용 기준**, **범위**, **검증 방법**. "관련 파일·문서"는 범위 검사 기준이 된다.
- step으로 나누고 `index.json`에 적는다: `{"step": 0, "name": "kebab-name", "status": "pending"}`

### step 설계 원칙

1. **범위 최소화**: step 하나는 레이어나 모듈 하나. PR 하나(400줄 안팎) 안에 든다.
2. **자기완결성**: 새 세션이 그 step 파일만 읽고 작업한다. "앞에서 논의한 대로"를 쓰지 않는다.
3. **읽을 파일 명시**: 관련 문서와 앞 step이 만든·바꾼 파일의 경로.
4. **시그니처 수준 지시**: 인터페이스만 주고 구현은 맡긴다. 꼭 지킬 규칙(멱등성, 보안)은 적는다.
5. **AC는 실행 가능한 명령**: ` ```bash ` 블록에 runner가 그대로 실행할 명령을 쓴다. POSIX `sh` 문법으로 쓴다. Windows runner도 Git Bash로 같은 명령을 실행하므로, 한 OS에만 있는 명령(`pbcopy`, `open`, `Remove-Item` 같은 PowerShell cmdlet)은 쓰지 않는다.
6. **금지사항은 구체적으로**: "X를 하지 마라. 이유: Y".
7. **이름**: kebab-case 한두 단어.

- step을 실행하는 PR은 **자기 step 파일의 "작업"·"Acceptance Criteria"·"금지사항"을 바꿀 수 없다**(plan-gate). 계획을 고쳐야 하면 진행 로그에 이유를 적고 제작자에게 알린다. 실행 중인 step에 일을 더해야 하면 새 step을 더하고 계획만 담은 커밋으로 다시 검증받는다(아래 "계획 검증").

### 계획 검증 (중·대 규모, G1)

중·대 규모 계획은 구현 전에 교차 검증을 받는다. `plan-gate`가 확인하고, 승인이 없으면 병합되지 않는다(`harness.config.json`의 `planReview.required: true`. `false`인 리포에서는 결과를 참고로만 남긴다).

1. **계획만 담은 커밋을 먼저 올린다.** 계획 폴더(`docs/exec-plans/active/<id>/`)의 파일만 커밋해 push하고 초안 PR을 연다(`gh pr create --draft`). 코드·문서·설정을 함께 올리면 계획 검증으로 판정되지 않는다.
2. `check`가 통과하면 판정 워크플로가 계획 검증 항목(수용 기준의 검증 가능성, step 분할과 AC, 범위, 위험도)으로 판정한다. plan job 로그의 `review-plan: mode=plan` 줄로 확인한다.
3. 필요한 검증자가 승인하면 원장 댓글에 `계획 검증(G1): 해시 … · 승인: claude, codex`가 남는다. 지적(P0·P1)이 나오면 계획을 고쳐 다시 계획만 push한다.
4. 승인 뒤에 구현을 올린다. 진행 로그·의사결정 로그·발견 사항·상태는 승인 뒤에 바꿔도 된다.

- 승인은 계획의 "목표와 수용 기준"·"범위 / 비범위"·"관련 파일·문서"와 모든 step 파일의 "작업"·"Acceptance Criteria"·"금지사항"에 묶인다. 이 섹션을 고치면 승인이 무효가 되어 다시 검증받는다.
- 코드를 이미 올린 PR에서 계획 검증이 필요해지면(계획 수정) 되돌리는 커밋으로 PR의 변경을 계획만 남긴 뒤 검증받고, 승인 뒤에 코드를 다시 올린다. force push는 하지 않는다(R14).
- 계획이 이미 main에 있고 위 섹션이 그대로인 PR(둘째 step부터)은 다시 검증받지 않는다.
- 소규모 계획(단일 파일)은 대상이 아니다.
- runner도 같은 순서로 한다: 계획 작성 세션이 끝나면 계획만 담은 커밋을 push해 초안 PR을 열고, 원장의 계획 승인(해시가 같고 두 검증자)을 확인한 뒤에 step 세션을 띄운다. step이 끝나면 그 PR의 초안을 해제한다. 계획 작성 세션은 계획 폴더 밖 파일을 커밋하지 않는다(커밋하면 runner가 올리지 않고 실패로 센다).
- 대화 세션의 `start`는 계획을 다 쓴 계획 검증 대상 worktree에 "계획만 담은 커밋을 push하고 초안 PR을 연다"를, 승인 뒤에는 step 진행을 다음 할 일로 보인다.

### 계획 구조 확인

```bash
node scripts/harness.ts plan-gate --mode plan
```

## 3. 구현 (TDD)

- 실패하는 테스트 → 구현 → 리팩터. 구현 전에 테스트를 실행해 실패하는 것을 본다.
- **테스트 실효성은 `check`의 `test-effect`가 확인한다**(R5). 추가·수정한 테스트 파일을 변경 전 코드(merge-base)에서 실행해, 거기서도 통과하면 `check`가 실패한다. PR에 "테스트를 먼저 썼다"고 적는 것은 기록이 아니다. 따로 돌려 보려면 `node scripts/harness.ts test-effect`.
  - 실패하면 변경 전 코드에서 실패하는 테스트로 고친다.
  - 기존 동작을 확인하는 테스트를 더했거나 테스트만 리팩터했다면 예외 줄을 계획 파일(의사결정 로그)에 적는다. 실패 출력의 "고치는 법"에 나온 줄을 그대로 붙이고 사유만 채운다: ``- test-effect 예외: `<경로>` @ `<blob>` — 사유: <한 줄>``
  - 예외는 그 변경이 고친 계획 파일에 있어야 하고 blob(테스트 파일의 내용)에 묶여 있다. 테스트 파일을 다시 고치면 풀리므로 새 줄로 바꾼다. 사유는 검증자가 본다.
  - 판정 줄 읽는 법: `effective(base에서 단언 실패, …)`는 변경 전 코드에서 단언이 실패했다는 뜻이다. `effective(base에서 실패(단언 실패 아님: 모듈 없음 등), …)`는 단언에 닿기 전에 끝났다는 뜻이다(새 모듈의 테스트가 그렇다). 둘 다 통과지만, 뒤쪽은 이 검사가 단언을 확인하지 못한 것이다. `참고:` 줄이 나오면 그 파일의 테스트가 동작을 단언하는지 스스로 확인한다. 검증자도 그 파일을 직접 본다.
- 진행 로그는 step 완료, 실패, 방법 전환, 세션 종료 직전에 반드시 갱신한다. 도중에도 자주 갱신한다.
- 결정은 "의사결정 로그"에 `결정 / 이유 / 버린 대안`으로 적는다.

## 4. 자체 검증과 완료 처리

```bash
<step의 AC 명령>
node scripts/harness.ts check
node scripts/harness.ts complete-step     # 계획 전용 커밋
node scripts/harness.ts plan-gate         # PR 모드 확인
```

- **하네스 자체를 고쳤으면 자체 테스트도 본다.** 훅·게이트·`start`·`next`·`new-task`를 고친 PR은 `node scripts/harness.ts self-test`로 규칙이 여전히 막는지 확인한다(설계서 12.4절. `check`의 `test` 단계에도 들어 있다). 규칙을 새로 더했으면 `scripts/selftest/scenarios/`에 시나리오 파일을 더한다. 시나리오는 대상 하네스의 내부 모듈을 import하지 않고 `ctx.cli`·`ctx.hook`만 쓴다.
  - 실제 세션으로 확인하려면 `node scripts/harness.ts self-test --live`를 손으로 돌린다(구독 인증 필요. 시나리오 3개를 3번씩, 세션 9개). 통과 수만 내고 `check`·병합 판정에는 쓰지 않는다. 훅이나 무인 권한 프로필(`.claude/runner-settings.json`)을 고쳤을 때와 운영 전환 직전에 실행해 결과를 진행 로그에 적는다.
- **`check` 결과는 종료 코드로 확인한다.** 출력을 줄이려고 파이프를 붙이면 `&&`가 실패를 보지 못한다. 파이프의 종료 코드는 마지막 명령의 것이기 때문이다. 실패한 채 push·`complete-step`이 이어진 사례가 있다(Issue #72, TD-29). L1 훅이 이 꼴을 R4로 막는다: 검사 명령 바로 뒤의 파이프(앞에 `set -o pipefail`이 있으면 허용), 검사 명령과 그 뒤 `complete-step`·`git push`·`gh pr create` 사이의 `;`·줄바꿈·`||`(앞에 `set -e`가 있으면 허용).

  ```bash
  # 나쁜 예: check가 실패해도 push된다
  node scripts/harness.ts check 2>&1 | tail -1 && git push

  # 좋은 예: 출력은 파일로 보내고 종료 코드로 잇는다
  node scripts/harness.ts check > check.log 2>&1 && git push
  ```

- 자체 리뷰는 [검증 체크리스트](../../scripts/cross-review/checklist.md)로 하고 결과를 PR에 남긴다.
- **발견 사항 처리**: `complete-step` 전에 "발견 사항"의 각 항목 끝에 처리를 적는다. 셋 중 하나다.
  - `→ 처리: [반영한 문서](경로)`: 다음 에이전트가 알아야 할 것은 문서로 옮긴다
  - `→ 처리: #Issue번호` 또는 `→ 처리: TD-N`: 후속 작업이나 기술 부채로 넘긴다
  - `→ 처리: 해당 없음`
- 남은 부채는 [tech-debt-tracker.md](../exec-plans/tech-debt-tracker.md)에 TD 번호로 등록한다.
- 완료 커밋 뒤에 코드를 다시 고쳐야 하면 그 step을 `in_progress`로 되돌리고 진행 로그에 이유를 남긴다(runner는 자동).

## 5. PR

- 제목: `<type>(<계획 id>): step<N> <이름>`. 본문 첫 줄은 마지막 step만 `Closes #<issue>`, 나머지는 `Refs #<issue>`.
- **본문은 올릴 때 맞추고, 고칠 일이 생기면 모아서 한 번에 고친다.** `gates`는 PR 본문·제목을 고칠 때마다 다시 돈다(본문을 읽는 게이트가 있어서다). 한 번에 job 둘이 돌고 job마다 1분으로 올려 청구된다(Actions 사용량, Issue #126). `gh pr edit`를 여러 번 나눠 실행하지 않는다. 커밋을 올릴 예정이면 본문도 그 push 직전에 고친다.
- `gh pr merge --auto --squash`로 자동 병합을 켠다. 필수 체크가 통과하면 GitHub이 병합한다.
- 필수 체크는 `check`(GitHub Actions)와 검증 App이 기록하는 `revert-check`·`plan-gate`·`risk-gate`·`deps-guard`·`harness-guard`·`review/claude`·`review/codex`·`review-ledger`다. `review-ledger`는 지적 원장에 열린 P0·P1이 없어야 통과한다(8절). 등록 상태는 `node scripts/harness.ts required-checks`로 확인한다. PR 화면의 체크 요약과 `gh pr checks`는 출처를 보지 않는다. 필수 체크별 상태(기대 출처가 쓴 결과만)와 지금 무엇을 기다리는지는 worktree에서 `node scripts/harness.ts pr-state`로 본다(`--pr <번호>`로 다른 PR. 읽기만 한다). 병합 가능 여부는 `mergeStateStatus`로 본다.
- `harness.config.json`의 `protectedPaths`나 `github.owner`를 바꾸면 같은 PR에서 `node scripts/harness.ts codeowners --write`로 `.github/CODEOWNERS`를 다시 만든다. 이 파일은 손으로 고치지 않는다. 어긋나면 `check`의 doc-lint 단계가 실패한다.
- **위험도 높음**(`risk-gate`): 계획 `risk: high`, 경로 표의 높음 경로, 바이너리 파일, 운영 단계의 보호 경로가 있으면 `risk-gate`가 실패로 남는다. 제작자에게 현재 head 승인을 요청한다(Issue에 `needs-human`). 제작자가 GitHub 웹·모바일에서 승인하면 `review-trigger` → `gates`가 다시 판정한다. 승인 뒤 새 커밋을 push하면 다시 승인받아야 한다. 에이전트는 승인하지 않는다(R20).
- **승인 요청 전 조건**: 승인은 head 커밋에 묶여 있어 승인 뒤 커밋이 올라가면 철회된다(#62, #63에서 재승인). 승인이 필요한 PR은 초안(`gh pr create --draft`)으로 올리고, 아래가 모두 끝난 뒤에 worktree 안에서 `node scripts/harness.ts pr-ready`로 초안을 해제하며 승인을 요청한다.
  - `complete-step` 커밋까지 push했다.
  - 의사결정 로그·발견 사항 등 이 PR에 넣을 기록을 다 넣었다. 승인 요청 뒤에 생긴 기록은 다음 PR에 넣는다.
  - `origin/main`을 병합해 최신이고 `check`가 통과했다.
  - 이 PR에 반영해야 하는 제작자 작업(App ID 같은 설정값)을 먼저 받아 반영했다.
  - `pr-ready`는 완료 처리, 커밋하지 않은 변경, push 여부, `origin/main` 병합 여부를 확인한다. 하나라도 안 되면 이유를 출력하고 PR은 그대로 둔다. 통과하면 초안을 해제하고 worktree에 승인 요청 표시(그때의 HEAD)를 남긴다.
  - L1 훅이 순서를 지키게 한다: `gh pr ready` 직접 실행, 위험도 높음 계획의 초안 아닌 `gh pr create`, 승인 요청 표시가 있는 브랜치에 새 커밋을 올리는 push를 막는다. `origin/main` 병합 커밋만 더한 push는 막지 않는다.
  - 승인 요청 뒤에 꼭 커밋을 올려야 하면 제작자에게 먼저 알리고 `node scripts/harness.ts pr-ready --undo`로 초안으로 되돌린 뒤 push한다. 끝나면 `pr-ready`로 다시 요청한다.
- **제작자 작업 요청**: 제작자만 할 수 있는 일(시크릿·environment 등록, 필수 체크 등록, App 설정)은 한 번에 모아 요청한다. 항목마다 아래를 적는다.
  - 순서: 무엇을 먼저 해야 하는지, 승인·병합보다 앞인지 뒤인지.
  - 넣을 값의 형식: 예) "`auth.json` 파일 내용 전체. `{`로 시작한다. 로그인 URL이 아니다."
  - 확인 방법: 등록 뒤 봇이 무엇으로 확인하는지(이름 조회, `required-checks` 등). 봇은 시크릿 값을 볼 수 없다.
  - 절차 문서 링크([SECURITY.md](../SECURITY.md) 등).
- **보호 경로를 바꾼 PR**(`harness-guard`): `docs/harness/CHANGELOG.md`에 한 줄을 남기고, PR 본문의 `- [ ] 보호 경로 변경: …`을 `[x]`로 체크한다. 워크플로에 Actions 캐시를 쓰지 않는다. 검사 약화·권한 완화(워크플로·job 삭제, `harness.config.json`의 판정 관련 키, `.claude/`·`.codex/` 권한·훅, 새 `write` 권한, 정해 둔 environment 밖 참조, 기존 자체 테스트 파일 `scripts/selftest/`의 수정·삭제)가 탐지되면 위험도 높음이 되어 제작자 head 승인이 필요하다.
  - **자체 테스트**: 보호 경로를 바꾼 PR에서는 `gates` 워크플로의 `selftest` job이 main의 시나리오로 PR의 하네스를 시험하고, 결과가 `harness-guard`에 합쳐진다. 설명이 `자체 테스트 실패: <id 목록>`이면 `selftest` job 로그에서 그 시나리오의 `✗` 줄을 보고 하네스를 고친다. 로컬에서는 `node scripts/harness.ts self-test --only <id>`로 다시 본다. `자체 테스트 결과가 없다`(`error`)는 job이 보고서를 남기지 못한 것이다(시간 초과, 실행기 오류). job 로그를 본다.
  - 시나리오가 요구하는 동작을 바꾸려면 시나리오를 먼저 고친다. `selftest` job은 PR의 시나리오가 아니라 main의 시나리오를 쓰므로, 동작과 시나리오를 한 PR에서 함께 바꾸면 통과하지 못한다. 먼저 시나리오가 옛 동작과 새 동작을 모두 받도록 고치는 PR(위험도 높음)을 병합하고, 다음 PR에서 동작을 바꾼다.
- **교차 검증**(`review/claude`, `review/codex`): `check`가 통과하면 판정 워크플로(`judge-claude`, `judge-codex`)가 main의 정의로 돈다. 위험도 낮음은 작성 도구와 다른 검증자 1명, 보통·높음은 둘 다 판정하고, 돌지 않은 쪽은 "해당 없음(통과)"으로 기록된다. 승인이고 P0·P1 지적이 없어야 success다.
  - 지적 본문(근거·제안)은 판정 실행의 `record` job 로그(`record-review:` 줄)에서 본다. runner도 같은 줄을 읽어 지적 대응 세션에 데이터로 넘긴다. 실행은 PR head 커밋 상태의 링크로 찾는다(`workflow_run` 실행은 브랜치가 `main`으로 표시된다). P0·P1을 고쳐 push하면 `check` 통과 뒤 다시 판정한다.
  - `error`(판정 없음)는 검증자 장애다. 판정 job 로그의 오류 문구를 보고, 인증·한도 문제면 제작자에게 알린다. 다른 검증자로 대신하지 않는다.
  - **승인 이어받기**: 위험도 낮음·보통 PR을 `origin/main` 병합으로 갱신했을 때, 변경이 그대로면(patch-id 같음, PR 파일이 바이트 단위로 같음, main에서 바뀐 파일과 겹치지 않음) 판정 없이 `이어받음 <sha>`가 기록된다. 위험도 높음과 그 밖의 경우는 다시 판정한다.
  - 로컬 사전 점검: push 전에 CI 검증자의 지적을 미리 보려면 worktree에서 `review-plan`으로 입력 폴더(`.harness-review/`)를 만든 뒤 `judge-claude.yml`의 판정 단계와 같은 인자로 `claude -p`를 돌린다. 병합 판단에는 CI 결과만 쓴다.
- 무관한 검사 실패는 별도 PR로 먼저 고친다. flaky 테스트는 같은 커밋에서 한 번만 재실행하고, 통과하면 TD로 등록한 뒤 격리한다.

```ts
// harness-quarantine: TD-12 until=2026-12-01 reason="네트워크 타이밍 의존"
```

### main에 뒤처지거나 충돌한 PR 갱신

PR 브랜치는 `origin/main`을 병합해 갱신하고 일반 push로 올린다([ADR-0006](../decisions/ADR-0006-pr-update-merge.md)).

```bash
git -C <worktree> fetch origin
git -C <worktree> merge origin/main        # 충돌이면 파일을 고치고 git add 후 git commit
node scripts/harness.ts check              # worktree 안에서
git -C <worktree> push origin <브랜치>
```

- **언제 갱신하나**: 충돌은 바로 푼다(충돌한 PR에서는 `check`가 돌지 않는다). 뒤처지기만 했으면 필수 체크가 모두 통과한 뒤에 갱신한다. 검증자가 수정을 요청했거나 판정 중일 때 갱신하면 승인을 이어받지 못해 판정이 한 번 더 돈다. runner도 이 순서로 한다.
- **rebase하지 않는다.** 이미 push한 브랜치를 rebase하면 원격 갱신에 force push가 필요하고, R14가 막는다. squash 병합이라 PR의 병합 커밋은 main 이력에 남지 않는다.
- 이미 로컬에서 rebase했다면 원격 이력을 부모로 연결한 뒤 일반 push한다. 트리는 rebase 결과 그대로다.
  ```bash
  git -C <worktree> merge -s ours origin/<브랜치>
  git -C <worktree> push origin <브랜치>
  ```
- 완료 커밋 뒤에 충돌 해결로 코드가 바뀌면 4절대로 그 step을 `in_progress`로 되돌리고 진행 로그에 남긴다.
- 충돌을 풀 수 없거나 push가 막히면 우회하지 말고 7절 형식으로 Issue에 `needs-human` 라벨과 질문을 남긴다. 댓글만 남기면 `start`의 ①에 나오지 않는다.
- runner는 충돌을 만나면 제작자 답을 기다리지 않고 충돌을 남긴 병합과 충돌 해결 세션을 띄운다. 해결 세션은 충돌 파일만 고치고 git 명령은 쓰지 않는다. 스테이징·커밋·push와 판정(충돌 표시, AC, `check`)은 runner가 하고, 실패하면 병합을 취소한다. 5회 실패하면 계획 파일을 바꾸지 않고 Issue에 `needs-human`과 중단 보고를 남긴다. 제작자가 그 Issue에 답하면 runner가 답을 넣어 다시 푼다. 사람이 직접 병합해 push했다면 그 뒤 답을 달면 된다.

## 6. 실패와 방법 전환 (3회 / 5회)

실패 횟수는 `check`·runner가 실패 키(`계획 id + 검사 이름`)별로 자동으로 센다. 손으로 세거나 고치지 않는다.

| 키별 누적 실패 | 행동                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 1~2회          | 원인을 분석하고 같은 접근법 안에서 고친다                                        |
| 3회            | 접근법을 버리고 **다른 방법으로 전환**한다. 의사결정 로그에 아래 형식으로 남긴다 |
| 4회            | 전환한 방법 안에서 고친다                                                        |
| 5회            | **그 계획을 멈추고 보고한다**. 계획 `status: blocked`                            |

3회 방법 전환 기록:

```markdown
- 방법 전환(<실패 키>, 3회): 가설 … / 시도한 방법 … / 폐기 이유 … / 새 방법 …
```

수렴하지 않은 리뷰 라운드(실패 키 `review-round`, 설계서 10.2절 (7)):

- 지적 대응을 올린 뒤 아래 가운데 하나라도 보이면 덧대지 않는다: 새로 열린 차단 지적이 해소된 차단 지적보다 많다, 대응 전 열린 지적과 같은 위치(파일·줄)에 새 차단 지적이 열렸다, 대응을 올린 head의 `check`가 실패했다.
- 마지막 대응의 수정 커밋을 `git revert`로 되돌려 일반 push하고 진행 로그에 원인을 적는다. `reset --hard`와 force push는 쓰지 않는다(R14). 계획 전용 커밋은 되돌리지 않는다.
- runner는 대응을 올린 head의 판정이 끝나면 한 번 평가해 자동으로 되돌리고 `review-round` 실패로 센다. 되돌린 head의 판정을 받은 뒤 다시 대응한다. 3회면 수정 방식을 버리고(PR 분할, 계획 수정 뒤 재검증, main 기준 재구현 가운데 하나를 의사결정 로그에 남긴다. runner 세션은 계획 수정·PR 분할이 필요하면 열린 질문으로 남긴다), 5회면 멈춘다.
- 수정한 뒤 로컬 AC나 `check`가 실패해도 그 수정을 `git revert`로 되돌리고 다른 방법으로 다시 한다(runner는 자동).

5회 중단 보고(Issue 댓글, runner는 자동):

```markdown
## 중단 보고: <계획 id>

- 목표:
- 실패 키:
- 시도 이력: 1~5회 각각의 가설 / 방법 / 실패 근거(로그·에러 요약)
- 3회차 방법 전환 내용과 이유:
- 추정 원인:
- 교차 검증 의견:
- 사람이 결정할 것: 선택지 A / B / C + 추천안
```

## 7. 에스컬레이션 (사람에게 묻기)

**반드시 묻는다**: 요구사항이 모호해 결과가 크게 갈릴 때, 제품·UX 방향, 되돌릴 수 없는 작업(DB 파괴적 변경, 데이터 삭제, 외부 발송, 운영 배포, 비용), 보안·권한 결정, 하네스 원칙·규칙 변경, 5회 실패, 교착.
**묻지 않고 진행한다**(의사결정 로그에 기록): 구현 방식, 내부 구조, 테스트 설계, 리팩터 범위, 라이브러리 선택(새 직접 의존성은 ADR 필요), 추천안이 분명한 운영 판단(제작자가 지시한 일의 Issue 등록, 작업·step 순서, 문서 위치).

**언제 묻나**: 작업 중간에 물으면 제작자가 자리에 없는 동안 세션 전체가 멈춘다(2026-11-11에 두 세션이 동시에 46분 대기).

- 질문은 작업 시작 때(계획 작성 중) 한 번에 모은다.
- 작업 중에 생긴 질문은 막히지 않은 일을 먼저 끝내고 모아서 묻는다.
- 대화로 정한 결정은 그 자리에서 ADR이나 계획의 의사결정 로그에 남긴다. 리포에 없는 합의는 다음 세션이 모르고 다시 묻는다(B1).

형식(계획의 "열린 질문"에 적고, Issue에 `needs-human` 라벨 + 제작자 멘션):

```markdown
### 질문: <한 줄>

- A) … — 영향: …
- B) … — 영향: …
- 추천: A. 이유: …
```

- 대화 중인 세션이면 그 대화에서 바로 묻는다.
- runner의 계획 작성 세션이나 step 세션이 "열린 질문"에 남긴 `### 질문:`은 runner가 Issue에 `needs-human` + 제작자 멘션으로 올리고, 답을 받을 때까지 그 계획을 멈춘다. 답을 받으면 답을 넣어 계획을 다시 작성하거나(계획 작성 세션) 그 step을 다시 띄운다(step 세션). step 세션의 질문은 실패로 세지 않는다. 그래서 추천안으로 진행할 판단은 `### 질문:`으로 적지 않고 의사결정 로그에 남긴다.
- 답은 **제작자 계정의 댓글**이나 대화 중인 제작자의 답만 인정한다.
- 기다리는 동안 막히지 않은 일은 계속한다.
- **대기 상태 보고**: 멈추거나 기다릴 때는 세 가지를 알린다. 무엇을 기다리는지(예: PR #N의 `risk-gate` 승인), 누가 풀어야 하는지(봇·제작자·CI), 그동안 무엇을 하는지. 제작자 차례가 아닌 대기(CI 진행 중, main과 충돌)는 봇이 이어서 처리하고 멈추지 않는다.
- 추천안이 있는 질문은 하지 않는다. 물을 때는 위 "반드시 묻는다"의 어느 항목인지 적는다.

## 8. 반박 형식 (2단계 교차 검증부터)

검증자의 지적에 반박할 때는 아래 형식만 쓴다. 자유 글은 검증자에게 전달되지 않는다.

```markdown
- 지적: F3
- 근거: <커밋 SHA | 테스트 경로 | 로그 링크>
- 요지: (300자 이내)
```

- **어디에 쓰는가**: PR 작성자 계정으로 그 PR에 댓글을 단다(`gh pr comment <번호> --body-file <파일>`). 다른 계정의 댓글과 원장 댓글은 보지 않는다.
- **무엇을 반박할 수 있는가**: 지적 원장에서 상태가 `open`인 지적만. 지적 하나에 가장 최근 반박 하나만 쓰인다.
- **형식**: 위 세 줄이 빈 줄로 구분된 한 문단이어야 한다. 한 댓글에 여러 문단을 쓸 수 있다.
  - 근거는 공백 없는 값 하나다: 40자 커밋 SHA, 리포 안 상대 경로(`scripts/test/a.test.ts` 또는 `…:12`), 이 리포의 `https://github.com/<owner>/<repo>/…` 링크 중 하나.
  - 요지는 한 줄, 300자 이내다.
- **버려지는 것**: 세 줄 문단이 아닌 글(앞뒤 설명 포함), 줄이 더 있거나 순서가 다른 문단, 원장에 없거나 닫힌 지적, 외부 링크·절대 경로·`..`가 든 근거, 300자를 넘거나 제어 문자가 든 요지. 버려진 것은 알림 없이 전달되지 않는다. 전달된 반박은 판정 워크플로 `plan` job 로그의 `review-plan: 반박 N건(F…)` 줄로 확인한다.
- **runner의 반박**: 무인 세션은 `gh`를 쓰지 않는다. 지적이 틀렸다고 판단하면 파일을 하나도 바꾸지 않고 마지막 출력에 위 세 줄 문단을 앞뒤에 빈 줄을 두고 적는다. runner가 판정 워크플로와 같은 규칙으로 형식을 검사하고 근거를 확인한 뒤(40자 SHA는 원격 브랜치에 있는 커밋, 경로는 리포에 있는 파일. 링크는 받지 않는다) 그 세 줄만 PR 댓글로 달고(코드 블록 안에 둬서 요지의 멘션·마크다운이 해석되지 않는다), 진행 로그에 `F<번호> 반박` 한 줄을 더한 커밋을 올린다. 파일을 바꿨으면 반박 문단은 무시되고 수정으로 판정된다. 형식이나 근거가 맞지 않으면 그 지적의 실패 1회다.
- **교착**: 같은 지적에 반박을 2회 냈는데도 그 검증자가 받아들이지 않으면 교착이다(7절 "반드시 묻는다"). runner는 계획을 멈추고 Issue에 `needs-human`과 보고(지적, 두 반박의 근거와 요지, 선택지 A 지적대로 고치게 한다 / B 범위를 줄인다 / C 포기)를 올린다. 제작자가 답하면 답을 넣어 그 지적의 세션을 다시 띄운다. 대화 세션도 2회 반박 뒤에는 더 반박하지 않고 제작자에게 묻는다.
- **효과**: 반박은 원장 상태를 바꾸지 않는다. 다음 판정에서 그 지적을 낸 검증자가 근거를 확인해 `rejected` 또는 `open`으로 답한다(P0은 두 검증자가 모두 동의해야 닫힌다). 다음 판정은 새 커밋이 올라와 `check`가 통과할 때 돈다.
