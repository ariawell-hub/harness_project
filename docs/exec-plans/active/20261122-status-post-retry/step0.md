# Step 0: status-retry

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`ci/*` 줄)
- `scripts/ci/record.ts` 전체(특히 `githubStatusPoster`, `recordStatuses`, `recordReview`)
- `scripts/harness.ts`의 `record-status`·`record-review`(poster를 만드는 세 자리. 읽기만)
- `scripts/ci/ledger-store.ts`에서 `post`를 부르는 자리(읽기만)
- `scripts/runner/review.ts`의 `parseReviewLog`(읽기만)
- `scripts/test/record.test.ts`의 가짜 GitHub API 서버와 `run`, `scripts/test/helpers.ts`
- 이 계획의 "목표와 수용 기준"과 "의사결정 로그"

## 작업

### 1. `scripts/ci/record.ts`

다시 시도의 값을 상수로 내보낸다.

```ts
export const STATUS_RETRY = {
  attempts: 4,
  waitsMs: [2_000, 6_000, 15_000],
  timeoutMs: 30_000,
  budgetMs: 60_000,
} as const;
```

`githubStatusPoster`를 고친다. 받는 값에 셋을 더한다(모두 선택).

```ts
/** 다시 시도를 알리는 줄을 받는다. 기본은 표준 출력(`scripts/lib/util.ts`의 `log`) */
log?: (line: string) => void;
/** 테스트용: 대기와 시계(ms). 기본은 `node:timers/promises`의 `setTimeout`과 `performance.now()` */
sleep?: (ms: number) => Promise<unknown>;
now?: () => number;
```

동작:

- 요청 하나: 지금과 같은 주소·메서드·헤더·본문으로 보낸다. 시간 제한은 요청마다 새로 건다(`AbortSignal.timeout(STATUS_RETRY.timeoutMs)`).
  - 성공(2xx)이면 끝난다.
  - 요청이 예외로 끝나면(연결 실패·끊김, 시간 제한) "응답 없음"이다. 다시 보낼 수 있는 실패다. 오류의 이름이 영문자 1~40자면 그 이름을, 아니면 `Error`를 쓴다. 오류의 글은 쓰지 않는다.
  - 2xx가 아니면 응답 본문의 앞 300자를 읽어 둔다(지금처럼). 상태 코드가 500 이상이면 다시 보낼 수 있는 실패, 아니면 다시 보내지 않는 실패다.
- 실패한 뒤 다시 보내는 조건(모두 만족):
  - 다시 보낼 수 있는 실패다.
  - 이 상태에 보낸 요청 수가 `attempts`보다 적다.
  - `이 poster가 다시 시도에 쓴 시간 + 이번 대기 + timeoutMs ≤ budgetMs`.
- 다시 보낼 때: 알리는 줄을 내고, 대기하고, 요청을 보낸다. 대기를 시작한 때부터 그 요청이 끝날 때까지의 시간을 "다시 시도에 쓴 시간"에 더한다(성공해도 더한다). 이 값은 poster마다 하나다(그 poster가 쓰는 상태 전체에 걸린다).
  - 알리는 줄: `record: 커밋 상태 기록 다시 시도(<context>): <무엇>, <대기 초>초 뒤 <다음 요청의 순번>/<attempts>번째`. `<무엇>`은 `HTTP <코드>` 또는 `응답 없음(<오류 이름>)`이다.
- 다시 보내지 않을 때: 예외를 던진다.
  - HTTP 실패: `커밋 상태 기록 실패(<context>): HTTP <코드> <본문 앞 300자>`(지금과 같은 글).
  - 응답 없음: `커밋 상태 기록 실패(<context>): 응답 없음(<오류 이름>)`.
  - 요청을 두 번 이상 보냈으면 끝에 ` (<보낸 수>회 시도)`를 붙인다.

`recordStatuses`·`recordReview`·`reviewLogLines`·`oneLine`은 고치지 않는다.

### 2. 테스트(먼저 쓴다): 새 파일 `scripts/test/status-poster.test.ts`

가짜 GitHub API 서버(`node:http`, 127.0.0.1의 빈 포트)를 이 파일 안에 둔다. 서버는 요청마다 미리 정한 응답을 차례로 쓴다: HTTP 상태 코드, 또는 응답 없이 연결 끊기. 정한 것을 다 쓰면 201이다. 실패 응답의 본문에는 고유한 표식을 넣는다. 받은 요청(메서드, 경로, `authorization`, 본문)을 모두 적어 둔다.

- 모든 테스트는 `apiUrl`을 이 서버로 준다. GitHub으로 가는 요청이 없어야 한다(이 변경 전의 코드로 돌려도 그렇다).
- `sleep`과 `now`는 가짜를 준다: `sleep`은 받은 값을 적고 가짜 시계를 그만큼 돌린다(실제로 기다리지 않는다). 서버는 요청마다 가짜 시계를 정한 만큼 돌릴 수 있다(요청에 걸린 시간을 흉내 낸다).
- `record.ts`는 네임스페이스로 가져온다(`import * as record`). 이 변경 전의 코드에서 `STATUS_RETRY`가 없어도 파일 전체가 가져오기에서 죽지 않고 테스트마다 단언으로 실패하게 한다.

테스트(11건):

1. 값: `record.STATUS_RETRY`가 위의 값과 같다(`deepEqual`). poster 둘의 상한을 더한 값이 5분의 절반보다 작다.
2. HTTP 500·502·503·504 각각: 한 번 받고 다음에 201이면 예외 없이 끝난다. 서버가 받은 요청은 둘이고 둘의 메서드·경로·`authorization`·본문이 같다(본문은 `{ context, state, description, target_url }`). `sleep`은 `[2000]`을 받았다. 로그 줄은 `record: 커밋 상태 기록 다시 시도(plan-gate): HTTP <코드>, 2초 뒤 2/4번째` 하나다.
3. 응답 없음: 연결을 두 번 끊고 201. 요청 셋, `sleep`은 `[2000, 6000]`, 로그 줄은 둘이고 `응답 없음(<영문자>)` 형식이다.
4. 계속 실패(500, 503, 끊김, 502): 요청 넷 뒤 예외다. 글은 `커밋 상태 기록 실패(plan-gate): HTTP 502 … (4회 시도)`. `sleep`은 `[2000, 6000, 15000]`. 넷 다 끊기면 `커밋 상태 기록 실패(plan-gate): 응답 없음(<영문자>) (4회 시도)`다.
5. HTTP 400·401·403·404·409·422·429 각각: 요청 하나로 바로 예외다. 글은 지금과 같다(`커밋 상태 기록 실패(plan-gate): HTTP <코드> <본문>`, 시도 수 없음). `sleep`을 부르지 않고 로그 줄이 없다. 이 테스트는 지금의 코드에서도 통과한다(지금 동작을 지킨다).
6. 로그 줄에 토큰과 응답 본문의 표식이 없다(500, 끊김, 503 뒤 201. 줄 셋).
7. 실패가 없으면 상태 하나에 요청 하나다. 상태 셋(a, b, c)을 차례로 쓰고 b의 첫 요청만 500이면 서버가 받은 context의 순서는 `a, b, b, c`이고 `sleep`은 한 번이다.
8. 상한: 요청마다 30초가 걸린 것으로 치고 500만 주면, 요청 둘 뒤 예외다(`(2회 시도)`). `sleep`은 `[2000]`. 다시 시도에 쓴 시간(가짜 시계에서 첫 요청의 30초를 뺀 값)은 32초로 상한 60초 이하다.
9. 상한은 poster의 상태 전체에 걸린다: 한 poster로 (a) 빠른 500 셋 뒤 201(23초를 쓴다) → (b) 500 하나 뒤 201인데 요청이 30초 걸린다(다시 보낸다. 55초를 쓴 것이 된다) → (c) 500이면 다시 보내지 않고 요청 하나로 예외다. 새 poster는 새 상한으로 다시 보낸다.
10. 명령 실행(`node scripts/harness.ts record-status`, 환경 변수 `GITHUB_API_URL`을 가짜 서버로): 둘째 상태의 첫 요청만 500이면 종료 코드 0이고, 서버가 받은 context의 순서가 `RECORDED_CONTEXTS`에서 둘째만 두 번인 순서다. 출력에 다시 시도 줄이 있고 토큰과 응답 본문의 표식이 없다. 이 테스트만 실제로 2초를 기다린다(호출하는 쪽을 고치지 않아도 다시 시도하는지 본다).
11. 다시 시도 줄과 runner의 읽기: `reviewLogLines`가 낸 줄들(지적 하나) 뒤에 실제로 받은 다시 시도 줄과 상태 줄을 붙인 글을 `parseReviewLog`로 읽으면, 붙이기 전과 같은 지적이 나온다.

있던 테스트 파일은 고치지 않는다.

### 3. 문서와 기술 부채 표

- `docs/harness/design.md`: 10.4절의 기록 job 서술(기계 판정을 `gates` 워크플로가 기록한다는 항목 아래)에 다시 시도를 적는다: 어떤 오류에, 몇 번, 시간 상한, 그래도 실패하면 지금처럼 job이 실패한다(fail-closed), 4xx는 바로 실패. 버전과 변경 이력 한 줄(`Issue #220`, TD-48 해결).
- `docs/harness/CHANGELOG.md`: 한 항목. `STATUS_RETRY`의 값과 로그 줄의 형식을 적는다.
- `docs/exec-plans/tech-debt-tracker.md`: TD-48을 `해결(#220: …)`로 닫는다. "발견 사항"을 새 행 하나로 더한다(상태 `열림`). 새 행의 번호는 push 직전의 `origin/main` 기준 다음 번호다.
- 이 계획의 "발견 사항"에 `→ 처리: TD-<새 번호>`를 적는다.

## Acceptance Criteria

```bash
node --test scripts/test/status-poster.test.ts scripts/test/record.test.ts scripts/test/ci.test.ts scripts/test/ledger-store.test.ts scripts/test/binding.test.ts
git rev-parse --verify --quiet origin/main^{commit}
test "$(git diff --name-only origin/main...HEAD -- scripts .github harness.config.json profiles | sort | tr '\n' ' ')" = "scripts/ci/record.ts scripts/test/status-poster.test.ts "
test "$(git diff --diff-filter=A --name-only origin/main...HEAD -- scripts)" = "scripts/test/status-poster.test.ts"
grep -qE '^export const STATUS_RETRY = \{$' scripts/ci/record.ts
test "$(grep -c '^test(' scripts/test/status-poster.test.ts)" = 11
grep -qE '^  - v0\.7\.[0-9]+ \(2026-11-[0-9]+\): .*Issue #220' docs/harness/design.md
grep -qF 'STATUS_RETRY' docs/harness/CHANGELOG.md
grep -qE '^\| TD-48 .*\| 해결\(#220' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-[0-9]+ +\| .*githubLedgerApi.*\| 열림 *\|$' docs/exec-plans/tech-debt-tracker.md
test "$(grep -c '→ 처리: TD-' docs/exec-plans/*/20261122-status-post-retry/plan.md)" = 1
node scripts/harness.ts doc-lint
```

## 금지사항

- 있던 테스트 파일을 고치거나 지우지 마라. 이유: 기록되는 상태의 내용과 실패가 없을 때의 동작이 그대로라는 것을 있던 테스트가 지킨다. AC가 `scripts` 아래에서 바뀐 파일이 둘뿐인지 본다.
- `scripts/harness.ts`, `scripts/ci/ledger-store.ts`, `scripts/ci/pr.ts`, `scripts/runner/`를 고치지 마라. 이유: 범위 밖이고 다른 세션의 계획이 고칠 파일이다.
- HTTP 4xx(429 포함)를 다시 보내지 마라. 이유: 다시 보내도 같은 답이거나, 기다릴 시간이 시간 상한을 넘는다.
- 다시 시도가 모두 실패했을 때 예외를 삼키거나 성공으로 돌려주지 마라. 이유: 상태를 쓰지 못했는데 job이 성공하면 필수 체크가 비었는데도 알 수 없다(fail-closed).
- 상태의 내용(context, state, description, target_url)을 다시 보낼 때 바꾸지 마라. 이유: 같은 내용이라야 두 번 기록돼도 해가 없다.
- 로그 줄과 오류 문구에 토큰을 넣지 마라. 로그 줄에는 응답 본문과 오류의 글도 넣지 마라. 이유: 실행 로그는 PR을 볼 수 있는 사람이 읽는다.
- 시간 상한을 없애거나 워크플로 파일의 시간 제한을 고치지 마라. 이유: record job이 5분 안에 끝나야 하고, 워크플로 파일은 봇이 고칠 수 없다.
- 테스트가 `api.github.com`으로 요청을 보내게 하지 마라(`apiUrl`을 늘 가짜 서버로 준다). 요청 함수(`fetch`)를 주입하는 옵션을 만들지 마라. 이유: 판정 `test-effect`가 새 테스트를 이 변경 전의 코드에서도 돌린다.
- 새 TD 행의 일("발견 사항")을 이 step에서 고치지 마라. 이유: 범위가 판정 job의 여러 명령으로 넓어진다.
