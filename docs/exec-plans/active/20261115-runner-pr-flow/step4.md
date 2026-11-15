# Step 4: rebuttal-evidence

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-runner-pr-flow/plan.md` (수용 기준 5·6, 의사결정 로그의 반박·근거 결정)
- `docs/harness/workflow.md` 8절(반박 형식), `docs/harness/design.md` 10.2절 (4) 반박 형식, 9.1절(교착), 10.1절(지적 본문은 기록 job 로그)
- 앞 step에서 만든·바꾼 파일: `scripts/runner/review.ts`(`doReview`, `ReviewState`), `scripts/runner/prompt.ts`(`reviewPrompt`), `scripts/runner/ledger-read.ts`, `scripts/test/fake-agent.ts`
- `scripts/ci/rebuttal.ts`(`parseRebuttals`), `scripts/ci/record.ts`, `scripts/harness.ts`의 `record-review` 명령(`onVerdict`의 로그 줄), `scripts/runner/agents.ts`(`SessionResult.output`)

## 작업

1. 반박
   - `reviewPrompt`에 선택지를 더한다: 지적이 틀렸다고 판단하면 파일을 바꾸지 말고 마지막 출력에 절차서 8절 형식 문단(`- 지적:`, `- 근거:`, `- 요지:` 세 줄, 앞뒤 빈 줄)을 적는다. 근거는 이미 push된 커밋의 40자 SHA나 리포 안 파일 경로(`경로` 또는 `경로:줄`) 하나다.
   - `scripts/runner/review.ts`
     ```ts
     /** 세션 출력에서 이 지적의 반박을 고른다. 형식·근거가 맞지 않으면 null */
     export function sessionRebuttal(o: {
       output: string;
       id: string;
       ledger: Ledger;
       repo: string; // owner/name
       worktree: string;
     }): Rebuttal | null;
     ```
     형식 검사는 `scripts/ci/rebuttal.ts`의 `parseRebuttals`를 그대로 쓴다(세션 출력을 PR 작성자의 댓글 하나로 넣는다). 더해서 runner가 근거를 확인한다: SHA면 원격 브랜치에 있는 커밋이어야 하고(`<remote>/<브랜치>`의 조상), 경로면 worktree에 그 파일이 있어야 한다.
   - `doReview`: 세션이 아무것도 바꾸지 않았고 `sessionRebuttal`이 있으면 그 지적은 반박으로 대응한 것이다(실패가 아니다). 세션이 파일을 바꿨으면 출력의 반박 문단은 무시하고 수정으로 판정한다. 라운드의 반박은 push 전에 PR 댓글 하나로 단다(`gh.comment(pr.number, …)`. 본문은 형식 문단들뿐이다). 라운드에 수정 커밋이 하나도 없으면 계획의 진행 로그에 한 줄("F<번호> 반박")을 더한 계획 전용 커밋을 만들어 push한다(다음 판정은 새 커밋이 올라와야 돈다).
   - 저장소 이름(`owner/name`)은 `GitHubPort`에 `repoSlug(): string`을 더해 얻는다(가짜는 상태 파일의 값, 없으면 `fake/repo`).
2. 교착(9.1절): 같은 지적에 반박 대응이 2회 있고, 둘째 반박 head를 그 검증자가 판정한 뒤에도 열려 있으면 계획을 멈추고 `needs-human`으로 올린다. 보고에는 지적 ID·검증자·위치·제목, 두 반박의 근거와 요지, 선택지(A: 지적대로 고치게 한다 / B: 범위를 줄인다 / C: 포기)를 적는다. 제작자 답을 받으면 답을 넣어 그 지적의 세션을 다시 띄운다(기존 `answered` 흐름).
3. 근거·제안 읽기
   - `scripts/ci/record.ts`: `reviewLogLines(v: Verdict): string[]`. 지금 `harness.ts`의 `record-review`가 `onVerdict`에서 찍는 줄을 그대로 만든다(형식을 바꾸지 않는다). `harness.ts`는 이 함수를 쓴다.
   - `scripts/lib/github.ts`: `GitHubPort.runLog(runUrl: string): string | null`. Actions 실행의 로그 전문이다. URL이 이 리포의 실행 URL 형식이 아니거나 읽지 못하면 null이다. 가짜는 상태 파일의 `runLogs[url]`을 준다.
   - `scripts/runner/review.ts`
     ```ts
     export interface LoggedFinding {
       severity: string;
       file: string;
       line: number;
       title: string;
       evidence: string;
       suggestion: string;
     }
     /** 실행 로그(줄 앞에 job·step·시각이 붙어 있어도 된다)에서 record-review가 찍은 지적을 읽는다 */
     export function parseReviewLog(text: string): LoggedFinding[];
     ```
   - `doReview`: 지적마다 그 지적이 등록된 판정의 head(원장 `rounds`에서 그 검증자의 `round`번째 항목)의 `review/<검증자>` 상태(`commitChecks`, 출처 확인은 `requiredStates`와 같은 규칙)에서 `targetUrl`을 얻어 `runLog`를 읽고, 위치와 제목이 같은 지적의 근거·제안을 프롬프트의 데이터 블록에 더한다. 어느 단계든 실패하면 근거 없이 진행하고 프롬프트에 "근거를 읽지 못했다"를 적는다. 같은 실행 로그는 한 라운드에 한 번만 읽는다.
4. `scripts/test/fake-agent.ts`: `review` 순서에 `rebut`(파일을 바꾸지 않고 형식에 맞는 반박 문단을 출력)과 `rebut-bad`(형식이 틀린 반박)를 더한다.
5. 테스트(`scripts/test/runner-review.test.ts`에 더한다)
   - `reviewLogLines`가 만든 줄을 `parseReviewLog`가 그대로 읽는다(줄 앞에 `record\t단계\t시각` 접두가 붙은 경우 포함). 제목·근거에 줄바꿈이나 `[P1]` 같은 글자가 있어도 지적 수가 달라지지 않는다.
   - 반박: 형식이 맞고 근거 파일이 있으면 PR 댓글이 형식 문단만으로 달리고, 수정 커밋이 없어도 계획 전용 커밋이 push된다. 형식이 틀리거나 근거 파일·커밋이 없으면 댓글을 달지 않고 `F<번호>` 실패로 센다.
   - 세션이 파일을 바꾸고 반박도 출력하면 수정으로만 판정한다.
   - 같은 지적에 반박 2회 뒤에도 열려 있으면 계획이 `blocked`이고 Issue에 `needs-human`과 교착 보고가 달린다.
   - 실행 로그를 읽지 못해도(`runLog`가 null) 세션은 뜨고 프롬프트에 "근거를 읽지 못했다"가 있다. 읽으면 근거·제안이 데이터 블록에 들어 있다.
6. 문서: 절차서 8절(runner가 반박을 다는 방식과 교착), 설계서 10.2절 (4) 반박 형식 구현 문단, 9.1절 교착, 10.1절(지적 본문 로그를 runner가 읽는다), `architecture.md`, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test scripts/test/runner-review.test.ts scripts/test/rebuttal.test.ts scripts/test/record.test.ts scripts/test/runner.test.ts
grep -q "export function sessionRebuttal" scripts/runner/review.ts
grep -q "export function parseReviewLog" scripts/runner/review.ts
grep -q "export function reviewLogLines" scripts/ci/record.ts
```

## 금지사항

- 세션 출력의 글을 형식 검사 없이 PR 댓글로 달지 마라. 댓글 본문은 검사를 통과한 세 줄 문단뿐이다. 이유: 자유 글은 검증자에게 전달하지 않는다(10.2절 (4)). 주입된 문장이 반박을 타고 검증자에게 가는 것을 막는다.
- 반박 형식 규칙을 runner 쪽에 다시 구현하지 마라. 이유: 판정 워크플로(`scripts/ci/rebuttal.ts`)와 규칙이 갈라지면 runner가 단 반박이 버려진다.
- `record-review`가 찍는 로그 줄의 형식을 바꾸지 마라. 이유: CI는 main의 스크립트로 돈다. 형식을 바꾸면 병합 전후 실행의 로그가 달라져 읽기가 깨지고, 절차서 5절이 가리키는 사람용 로그도 바뀐다.
- 실행 로그의 근거·제안을 프롬프트의 지시 자리에 넣지 마라. 데이터 블록에만 넣는다. 이유: 검증자 출력은 PR 내용에 영향받는다(14.6절).
- 무인 권한 프로필(`.claude/runner-settings.json`)에 `gh`를 허용하지 마라. 이유: 댓글은 runner가 단다. 프로필 완화는 `harness-guard` 신호다(10.4절).
- 반박으로 원장 상태가 바뀐 것처럼 다루지 마라. 이유: 반박은 상태를 바꾸지 않는다. 다음 판정에서 그 검증자가 답한다.
