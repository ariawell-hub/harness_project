# Step 4: ops-check

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 5, 의사결정 로그의 `ci.requiredChecks` 결정, "다음 할 일"의 제작자 작업 목록)
- `docs/harness/design.md` 0.1절(E1), 0.2절(리포 설정, "운영 단계에 추가"), 10.4절(보호 경로, 운영 전환 체크리스트), 16절
- `docs/SECURITY.md`(자격증명 표, "필수 체크 등록 (제작자)" 절의 형식), `docs/decisions/ADR-0003-bot-token-classic-pat.md`, `docs/decisions/ADR-0004-q20-lab-repo.md`
- `scripts/ci/protection.ts`(`compareRequiredChecks`), `scripts/harness.ts`의 `required-checks`, `scripts/lib/github.ts`·`github-fake.ts`
- `scripts/commands/check.ts`, `scripts/gates/doc-lint.ts`, `scripts/lib/util.ts`(`globToRegExp`, `matchesAny`), `harness.config.json`의 `protectedPaths`
- 앞 step에서 만든·바꾼 파일: `scripts/ci/results.ts`(`GATE_CONTEXTS`의 `revert-check`), `.github/workflows/revert.yml`

## 작업

1. `scripts/gates/codeowners.ts`

   ```ts
   export const CODEOWNERS_FILE = '.github/CODEOWNERS';
   /** protectedPaths → CODEOWNERS 본문. 소유자는 @<cfg.github.owner> */
   export function codeownersText(cfg: HarnessConfig): string;
   /** 파일이 없거나 생성 결과와 다르면 문제를 돌려준다 */
   export function codeownersProblems(root: string, cfg: HarnessConfig): Problem[];
   ```

   - 변환: `X/**` → `/X/`, 그 밖의 항목은 앞에 `/`를 붙인다(`docs/exec-plans/TEMPLATE*.md` → `/docs/exec-plans/TEMPLATE*.md`). 파일 머리에 "생성 파일: `node scripts/harness.ts codeowners --write`" 주석을 둔다. 항목 순서는 설정 순서다.
   - CODEOWNERS 문법으로 옮길 수 없는 glob(중간의 `**` 등)은 문제로 알린다.
   - `scripts/harness.ts`: `codeowners [--write]`(없으면 비교만, 다르면 종료 코드 1).
   - `check`가 불일치를 실패로 낸다. `CHECK_STEPS`에 새 단계를 더하지 않고 기존 단계(`doc-lint`) 안에서 부른다.
   - `.github/CODEOWNERS`를 생성해 커밋한다.

2. `scripts/commands/ops-check.ts`와 `scripts/harness.ts`의 `ops-check`

   ```ts
   export interface OpsItem {
     /** 10.4절 체크리스트 번호 */
     n: 1 | 2 | 3;
     state: 'ok' | 'fail' | 'unknown';
     lines: string[];
   }
   export function opsCheck(o: { root: string; cfg: HarnessConfig; gh: GitHubPort }): OpsItem[];
   ```

   - 1번: `compareRequiredChecks` 결과(등록·출처가 `ci.requiredChecks`와 같다).
   - 2번: `codeownersProblems`가 없다. 코드 오너 리뷰 필수 설정은 봇이 읽을 수 있으면 읽고(읽기 전용 조회 하나), 읽지 못하면 그 줄을 `?`로 표시하고 "설정은 step5의 시험 PR(`protected-needs-owner`)로 확인한다"를 `lines`에 적는다. 항목 상태는 파일이 맞으면 `ok`다. 이 항목에서 `ops-check`가 보증하는 것은 CODEOWNERS 파일이고, 리포 설정의 근거는 시험 PR 결과(`lab/ops-transition/results/`)다.
   - 3번: 봇 토큰의 권한 범위(`gh api -i user`의 `x-oauth-scopes` 응답 머리말)에 `workflow`가 없다. 머리말이 없으면(세분화 토큰) `unknown`이다. 토큰 값은 읽지도 출력하지도 않는다.
   - 출력은 항목별 `✓`/`✗`/`?`와 이유다. 모두 `ok`일 때만 종료 코드 0이다. `--allow-unknown`은 두지 않는다.
   - 읽기만 한다. 설정을 바꾸는 API를 부르지 않는다(R20).
   - 포트에 필요한 조회 메서드를 더하고 가짜 GitHub에도 넣는다.

3. `harness.config.json`: `ci.requiredChecks`에 `{ "context": "revert-check", "source": "recorder" }`를 더한다. 프로파일 기본값·`init`이 같은 목록을 쓰면 함께 맞춘다.

4. `docs/SECURITY.md`에 제작자 절차를 더한다. 절마다 순서(무엇보다 앞·뒤인지), 넣을 값의 형식, 봇의 확인 방법을 적는다.
   - "`revert` environment (제작자)": main 전용 environment, 시크릿 `REVERT_BOT_TOKEN`(봇 계정의 PAT 한 줄. `ghp_`로 시작한다). 확인: main `check`가 실패했을 때 `revert` 워크플로 `act` job 로그. 봇 PAT를 재발급하면 이 시크릿도 바꾼다.
   - "`revert-check` 필수 체크 등록": 기존 "필수 체크 등록" 절의 목록에 더한다. 확인: `required-checks`.
   - "코드 오너 리뷰 필수 (제작자, 운영 전환)": main 보호 규칙의 "Require a pull request before merging" 아래 "Require review from Code Owners"를 켜고 필수 승인 수는 0으로 둔다. 확인: 보호 경로를 바꾼 시험 PR이 승인 전에는 병합되지 않는다.
   - "봇 토큰의 `workflow` 권한 회수 (제작자, 운영 전환)": 봇 계정에서 `workflow` 없이 PAT를 재발급하고, 에이전트가 도는 머신의 토큰과 `revert` environment 시크릿을 바꾼다. 순서: 워크플로를 바꾸는 PR이 모두 병합된 뒤. 확인: `ops-check` 3번, 워크플로 파일 push 거부.
   - "테스트 리포 준비 (제작자, #57 step4)": 새 비공개 리포, 봇 초대(Write, 시험 기간에만. ADR-0004 방식), 0.2절 보호 설정, environment 5개와 값의 형식(Claude 토큰은 새로 발급한 한 줄, Codex는 CI 전용 새 로그인의 `auth.json` 내용, 두 App은 테스트 리포에도 설치하고 Client ID 변수·개인 키 시크릿), 필수 체크는 첫 보고 뒤 등록, 제작자 계정으로 시험 Issue 2건. 시험 뒤: 자격증명 교체, 봇 초대 철회, 리포 보관.

5. 테스트
   - `codeownersText`: 이 리포의 `protectedPaths` 전체가 한 줄씩 있고 소유자가 제작자 계정이다. 옮길 수 없는 glob은 문제. `codeownersProblems`: 파일 없음, 한 줄 다름.
   - 이 리포의 `.github/CODEOWNERS`가 생성 결과와 같다(`check`에서 확인되는 것과 같은 함수).
   - `opsCheck`(가짜 GitHub): 필수 체크 누락·출처 다름은 1번 `fail`. 권한 범위에 `workflow`가 있으면 3번 `fail`, 머리말이 없으면 `unknown`. 모두 맞으면 종료 코드 0.
   - 설정: `revert-check`가 `ci.requiredChecks`에 있고 `pr-state`의 필수 체크 목록에 나온다.

6. 문서: 설계서 0.2절("운영 단계에 추가"에 CODEOWNERS 생성과 `ops-check`, 필수 체크 목록에 `revert-check`), 10.4절(체크리스트 1~3의 확인 명령), 16절(도입 절차에서 `ops-check`·`codeowners --write`), `AGENTS.md` 필수 체크 언급이 있으면 맞춘다, 절차서 5절(필수 체크 목록에 `revert-check`), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

7. 이 step의 PR은 `harness.config.json`의 `ci`를 바꿔 `harness-guard` 신호(위험도 높음)가 된다. 초안으로 올리고 `pr-ready`로 제작자 승인을 요청한다. 승인 요청 댓글에 계획 "다음 할 일"의 제작자 작업 목록과 `docs/SECURITY.md` 절 링크를 함께 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/codeowners.test.ts scripts/test/ops-check.test.ts scripts/test/protection.test.ts scripts/test/pr-state.test.ts
node scripts/harness.ts codeowners
grep -q '"revert-check"' harness.config.json
grep -q "export function opsCheck" scripts/commands/ops-check.ts
grep -q "REVERT_BOT_TOKEN" docs/SECURITY.md
```

## 금지사항

- 보호 설정·environment·시크릿을 바꾸는 API나 `gh` 명령을 부르지 마라. 이유: R20. `ops-check`는 읽기만 한다.
- 토큰 값을 읽거나 출력하지 마라(`gh auth token` 포함). 이유: R20, R10. 권한 범위는 응답 머리말로만 본다.
- `.github/CODEOWNERS`를 손으로 고치지 마라. 이유: `protectedPaths`가 단일 원본이다. 어긋나면 `check`가 실패한다.
- 확인하지 못한 항목을 `ok`로 내지 마라. 이유: 운영 전환 PR(step5)이 이 명령의 종료 코드를 근거로 쓴다. 모르면 `unknown`이고 종료 코드는 0이 아니다(2번의 리포 설정 부분만 예외로, 시험 PR로 확인한다).
- `CHECK_STEPS`에 새 단계를 더하지 마라. 이유: 실패 키(`check:<단계>`)와 캐시가 단계 이름에 묶여 있다.
