# Step 0: gates-record

## 읽어야 할 파일

- `docs/exec-plans/active/20261114-ci-gates/plan.md` (수용 기준 1·2, 의사결정 로그)
- `docs/harness/design.md` 10.3절 필수 상태 체크, 10.4절 "CI 작업 분리"·"main 정의로 실행하는 것과 main 스크립트를 실행하는 것은 다르다"·캐시 규칙
- `.github/workflows/plan-gate.yml`(지금의 판정 방식), `.github/workflows/check.yml`(액션 SHA 고정)
- `scripts/harness.ts` `plan-gate` 명령, `scripts/gates/plan-gate.ts` `planGate`, `scripts/lib/util.ts` `Problem`
- Q20 기록 job: `git show 7b837e7:lab/q20/repo/.github/workflows/recorder.yml`

## 작업

1. `scripts/ci/results.ts`(새 레이어 `ci/`: 게이트 결과 조립과 기록. `gates/`·`lib/`에만 의존)
   - `export const GATE_CONTEXTS = ['plan-gate'] as const`. 다음 step이 검사를 더할 때 여기에 context를 더한다.
   - `export type GateState = 'success' | 'failure' | 'error'`
   - `export interface GateResult { context: string; state: GateState; description: string; details: string[] }`
   - `export interface GateResults { version: 1; headSha: string; results: GateResult[] }`
   - `export function validateResults(raw: unknown, o: { headSha: string; contexts: readonly string[] }): { ok: true; value: GateResults } | { ok: false; reason: string }`: version, `headSha`가 40자리 소문자 hex이고 `o.headSha`와 같음, context가 목록 안에 있고 중복 없음, state가 셋 중 하나, description이 문자열, details가 문자열 배열. 하나라도 어긋나면 `ok: false`.
   - `export function toStatuses(r: GateResults | null, contexts: readonly string[], reason: string): StatusPayload[]`(`{ context, state, description }`): 결과가 없으면(`null`) 모든 context를 `error` + reason. 결과에 빠진 context도 `error`. description은 제어 문자를 공백으로 바꾸고 140자로 자른다(GitHub 한도).
2. `scripts/ci/gates.ts`
   - `export function runGates(o: { root: string; cfg: HarnessConfig; base: string; branch: string; headSha: string }): GateResults`: 지금은 `planGate(mode: 'pr')`만 돌려 `plan-gate` 결과를 만든다. 문제가 없으면 `success`, 있으면 `failure`이고 description은 첫 문제의 `what`(+ "외 N건"), details는 `formatProblem` 전부.
   - 검사마다 `try/catch`로 감싸 예외는 그 context만 `error`(description에 예외 첫 줄)로 만든다.
   - `export function summaryMarkdown(r: GateResults): string`: 판정 job의 `$GITHUB_STEP_SUMMARY`용 표 + details.
3. `scripts/ci/record.ts`
   - `export async function recordStatuses(o: { raw: string | null; headSha: string; repo: string; targetUrl: string; post: (p: StatusPayload) => Promise<void> }): Promise<{ ok: boolean; reason: string | null }>`: `raw`를 JSON 파싱 → `validateResults` → `toStatuses`. 파싱·검증 실패면 모든 `GATE_CONTEXTS`에 `error`를 쓰고 `ok: false`. `repo`가 `owner/name` 형식이 아니거나 `headSha`가 40자리 hex가 아니면 아무것도 쓰지 않고 예외.
   - `export function githubStatusPoster(o: { token: string; repo: string; sha: string; targetUrl: string; apiUrl?: string }): (p: StatusPayload) => Promise<void>`: `fetch`로 `POST {apiUrl}/repos/{repo}/statuses/{sha}`. 응답이 2xx가 아니면 상태 코드와 본문 앞부분으로 예외(토큰은 메시지에 넣지 않는다).
4. `scripts/harness.ts` 명령 두 개(도움말에도 적는다)
   - `gates --repo <pr> --config-root <base> --base <sha> --head-ref <브랜치> --out <파일> [--summary <파일>]`: head SHA는 `--repo`의 `HEAD`. 결과를 파일로 쓰고 종료 코드 0. 파일을 쓰지 못하면 1.
   - `record-status --results <파일> --head-sha <sha> --repo-slug <owner/name> --target-url <url>`: 토큰은 환경 변수 `GH_TOKEN`. 결과 파일이 없거나 비어도 `error`를 기록한다. `ok: false`면 종료 코드 1.
5. `.github/workflows/gates.yml`
   - `on: pull_request_target: types: [opened, synchronize, reopened, ready_for_review, edited]`, 최상위 `permissions: {}`, PR 번호별 concurrency(`cancel-in-progress: true`).
   - job `evaluate`(environment 없음, `permissions: contents: read, pull-requests: read`, 같은 리포 PR만): `base/`는 ref 없이 체크아웃(= `github.sha`), `git config --global core.symlinks false` 뒤 `pr/`를 PR head SHA로 `fetch-depth: 0` 체크아웃, 둘 다 `persist-credentials: false`. `setup-node`는 캐시 옵션 없이. `node base/scripts/harness.ts gates …`로 결과를 만들고 base64 한 줄로 job 출력 `results`에 넣고 요약을 `$GITHUB_STEP_SUMMARY`에 쓴다. head ref·base SHA는 `env:`로만 넘긴다.
   - job `record`(`needs: evaluate`, `if: ${{ !cancelled() && 같은 리포 PR }}`, `environment: recorder`, `permissions: {}`): `base/`의 `scripts/`만 sparse 체크아웃, `setup-node`, `actions/create-github-app-token`(Q20과 같은 커밋 SHA, `client-id: vars.RECORDER_APP_CLIENT_ID`, `private-key: secrets.RECORDER_APP_KEY`, `permission-statuses: write`), job 출력을 `env:`로 받아 파일로 풀고 `record-status` 실행. head SHA는 이벤트의 `pull_request.head.sha`.
   - 액션은 모두 커밋 SHA로 고정하고 기존 워크플로와 같은 버전을 쓴다.
6. 테스트 `scripts/test/ci.test.ts`(먼저 실패를 확인하고 진행 로그에 남긴다)
   - `runGates`: 임시 리포에서 계획이 있는 브랜치는 `plan-gate` success, 계획이 없는 브랜치는 failure, `planGate`가 예외를 던지는 입력(예: 없는 base)은 error.
   - `validateResults`: 모르는 context, 중복, 잘못된 state, head SHA 불일치, 숫자 description을 거른다.
   - `toStatuses`: 빠진 context는 error, 141자 이상·제어 문자 description 정리.
   - `recordStatuses`: 정상 결과는 그대로, 깨진 JSON·`null`은 모든 context error + `ok: false`, 잘못된 repo·sha는 예외이고 아무것도 쓰지 않는다(가짜 `post`로 확인).
   - 워크플로 불변식(`gates.yml` 텍스트): 모든 `uses:`가 40자리 SHA, 최상위 `permissions: {}`, `environment: recorder`는 `record` job에만, `cache` 문자열 없음, `run:` 블록 안에 `${{ github.event`·`${{ github.head_ref`·`${{ needs.` 없음.
7. 문서: `docs/harness/architecture.md` 레이어 그림·모듈 표에 `ci/`, `docs/harness/CHANGELOG.md` 한 줄, 계획 진행 로그.

## Acceptance Criteria

```bash
node --test scripts/test/ci.test.ts
grep -q "export const GATE_CONTEXTS" scripts/ci/results.ts
grep -q "environment: recorder" .github/workflows/gates.yml
OUT="$(git rev-parse --git-dir)/gates-ac.json"
node scripts/harness.ts gates --repo . --config-root . --base "$(git merge-base origin/main HEAD)" --head-ref "$(git branch --show-current)" --out "$OUT"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(r.version!==1||r.results[0].context!=="plan-gate") process.exit(1)' "$OUT"
```

## 금지사항

- 판정 job에 `environment`·시크릿을 두거나, 기록 job에서 `pr/`를 체크아웃하거나 PR 스크립트를 실행하지 마라. 이유: 10.4절 job 분리. 기록 job은 App 키를 가진다.
- `run:` 블록에 `${{ … }}`로 PR 유래 값(브랜치 이름, 본문, job 출력)을 넣지 마라. 이유: 스크립트 주입. `env:`로만 넘긴다.
- 캐시(`actions/cache`, `setup-*`의 `cache`)를 쓰지 마라. 이유: 10.4절 캐시 규칙.
- `.github/workflows/plan-gate.yml`을 지우거나 고치지 마라. 이유: 필수 체크 출처 전환(step4) 전까지 지금의 필수 체크다.
- 토큰 값을 로그·예외 메시지·결과 파일에 넣지 마라. 이유: 검증 App 키 유출은 검증 결과 위조로 이어진다.
