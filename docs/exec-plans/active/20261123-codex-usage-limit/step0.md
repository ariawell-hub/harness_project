# Step 0: usage-limit

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/SECURITY.md` "워크플로 변경 절차"(계획 검증을 받는 계획에서의 순서 포함)
- 계획 `docs/exec-plans/active/20261123-codex-usage-limit/plan.md`의 수용 기준과 의사결정 로그
- `scripts/ci/codex-scan.ts`(`scanCodexRun`의 `turn.failed` 처리), `scripts/harness.ts`의 `codex-scan`·`record-review` 명령과 `writeReproOutput`, 옵션 표(`OPTIONS`)
- `scripts/ci/record.ts`의 `recordReview`, `scripts/ci/results.ts`의 `cleanDescription`
- `scripts/runner/run.ts`의 `doReportStall`, `scripts/runner/pr-state.ts`의 `infra-error`
- `.github/workflows/judge-codex.yml`의 `judge` job 출력과 `record` job의 `record-review` 단계
- `scripts/test/scan-output.test.ts`, `scripts/test/codex-scan.test.ts`, `scripts/test/record.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/ci.test.ts`(judge-codex.yml 불변식)
- 앞선 같은 꼴의 계획: `docs/exec-plans/completed/20261119-repro-on-demand/`
- 설계서 10.1절 "검증자 장애", 10.4절

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **한도 인식**: `scripts/ci/codex-scan.ts`
   - `usageLimitOutput(message: string): string | null`을 둔다. 문구에 사용 한도(`usage limit`, 대소문자 무시)가 있으면 `usage-limit`를, 그 안에 `try again at <월 약자> <일><st|nd|rd|th>, <연> <시>:<분> <AM|PM>`이 있고 실재하는 시각이면 `usage-limit@YYYY-MM-DDTHH:MMZ`(UTC로 읽는다)를 돌려준다. 한도가 아니면 `null`.
   - `scanCodexRun`의 실패 결과(`CodexScan`의 실패 쪽)에 `unavailable?: string`을 더한다. 마지막 `turn.failed`의 오류 문구(자르기·가리기 전 원문)에 `usageLimitOutput`을 적용한 값이 있을 때만 채운다. 반환값과 로그의 다른 내용은 바꾸지 않는다.
   - `scripts/test/codex-scan.test.ts`에 단위 테스트를 더한다(계획 수용 기준 1의 문구들, 없는 날짜 `Feb 30th`, `12:05 AM`·`12:05 PM`, 시간대가 붙은 다른 표기는 시각 없음).
2. **명령 출력**: `scripts/harness.ts`의 `codex-scan`이 실패로 끝날 때 결과에 `unavailable`이 있고 환경 변수 `GITHUB_OUTPUT`이 있으면 그 파일에 `unavailable=<값>` 한 줄을 덧붙인 뒤 지금처럼 종료 코드 1로 끝난다. 값은 `usageLimitOutput`의 형식인지 다시 확인하고 쓴다. 통과 경로와 다른 실패 경로는 바꾸지 않는다. `scripts/test/scan-output.test.ts`에 수용 기준 1의 경우를 자식 프로세스로 더한다(자식에는 테스트가 만든 `GITHUB_OUTPUT`만 넘긴다).
3. **기록 설명**: `scripts/ci/record.ts`
   - `RecordReviewOptions`에 `unavailable?: string`을 더한다. 판정이 없을 때(`raw`가 null이거나 빈 글)만 본다. 값이 `^usage-limit(@\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)?$`이고 시각이 실재하면 계획 수용 기준 2의 설명으로 error를 쓴다. 아니면 지금 설명 그대로다.
   - 설명은 140자 안이다(GitHub 커밋 상태 설명의 상한. `cleanDescription`을 그대로 거친다).
   - `scripts/harness.ts`의 `record-review`가 `--unavailable <값>`을 받아 넘긴다. 옵션 표에 `unavailable`(문자열)을 더한다.
   - `scripts/test/record.test.ts`에 수용 기준 2의 경우를 더한다.
4. **runner 알림**: `scripts/runner/run.ts`의 `doReportStall`이 기다리는 체크 가운데 설명이 사용 한도 설명(3번의 글. 판별 함수는 `scripts/ci/record.ts`에서 내보내 함께 쓴다)인 것이 있으면 "사람이 결정할 것"의 A)를 "풀리는 시각(설명에 적힌 값) 뒤에 판정 워크플로를 다시 실행한다(추천)"로 적는다. 그 밖의 글과 동작(라벨, 댓글 한 번, 다시 실행하지 않음)은 그대로다. `scripts/test/runner-pr.test.ts`에 한도인 경우와 아닌 경우를 더한다.
5. **워크플로 패치**: `lab/codex-usage-limit/judge-codex.patch`(`git diff` 형식, `.github/workflows/judge-codex.yml` 하나만)와 `lab/codex-usage-limit/README.md`(제작자가 웹에서 넣을 줄과 위치)를 만든다.
   - `judge` job의 `outputs`에서 `repro` 줄 바로 아래에 `unavailable: ${{ steps.scan.outputs.unavailable }}`.
   - `record` job의 `record-review` 단계 `env`에 `UNAVAILABLE: ${{ needs.judge.outputs.unavailable }}`(그 위에 이유를 적은 주석 한 줄), `run`의 `record-review` 명령에 `--unavailable "$UNAVAILABLE"`.
   - 그 밖의 줄은 바꾸지 않는다.
   - **패치를 만들 때 구조 테스트를 함께 확인한다(제작자에게 요청하기 전).** `scripts/test/ci.test.ts`에 judge-codex.yml 단언(위 세 자리. `judge` job 출력이 `steps.scan.outputs.unavailable`이고, `record-review` 단계가 `needs.judge.outputs.unavailable`을 환경 변수로 받아 `--unavailable`로 넘긴다)을 먼저 더해 지금 워크플로에서 실패하는 것을 본다. 워크플로를 고쳐 AC가 통과하는 것을 보고, 그 상태의 `git diff -- .github/workflows`를 패치로 저장한다. 그다음 워크플로 파일을 되돌리고 `ci.test.ts`의 변경은 리포 밖 파일로 옮겨 둔다(push 1에 넣지 않는다). 되돌린 트리에 패치가 그대로 적용되는지(`git apply --check`) 본다. 실패와 통과를 진행 로그에 적는다.
6. **문서**: 설계서 10.1절 "검증자 장애"(사용 한도는 다시 돌리지 않고, 판정 job이 한도를 알리면 상태 설명에 풀리는 시각을 적는다)와 10.4절의 판정 job 출력, 머리말·변경 이력. `CHANGELOG`. 기술 부채 표: TD-50을 해결로, TD-56에 "Codex 한도는 상태 설명으로 가를 수 있다"를 적는다. Claude 검증자에서 같은 일이 어떻게 보이는지(실행 기록의 `result` 이벤트, 과거 `judge-claude` 실행 로그) 조사해 계획의 발견 사항에 적고 새 TD 행으로 남긴다.
7. **push 1**: 1~6을 커밋하고 `check`를 통과시켜 push한다. 이때 `scripts/test/ci.test.ts`와 워크플로 파일은 바꾸지 않는다. 판정의 차단 지적을 먼저 해결한다. 그 뒤 Issue #223에 제작자 작업을 요청한다(`needs-human`, 넣을 줄과 위치, 브랜치 이름). 요청할 때의 원격 브랜치 head가 기준 커밋이다. 제작자의 커밋이 올 때까지 이 브랜치에 push하지 않는다.
8. **제작자의 워크플로 커밋을 받은 뒤**: `docs/SECURITY.md` "워크플로 변경 절차" 4번대로 받은 head의 트리가 기준 커밋에 패치를 적용한 트리와 같은지 본다. 다르면 멈추고 제작자에게 알린다.
9. **push 2**: 5번에서 옮겨 둔 `scripts/test/ci.test.ts`의 단언을 커밋한다. AC, `check`, 완료 처리 뒤 push한다. 판정을 통과하면 `pr-ready`로 승인을 요청한다. 병합 뒤 관찰(계획의 "검증 방법과 결과")을 Issue #223에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/codex-scan.test.ts scripts/test/scan-output.test.ts scripts/test/record.test.ts scripts/test/runner-pr.test.ts scripts/test/ci.test.ts scripts/test/harness-guard.test.ts
```

제작자의 워크플로 커밋과 push 2의 구조 테스트가 모두 든 트리에서 통과한다. 워크플로 커밋이 없으면 `scripts/test/ci.test.ts`가 실패한다.

## 금지사항

- `.github/workflows/`의 파일을 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없어 push가 거부된다. 워크플로 파일은 제작자가 올린다.
- 사용 한도일 때 상태를 error 말고 다른 값(success, failure, pending)으로 쓰지 마라. 이유: 제작자 결정(검증을 약화하지 않는다, fail-closed).
- `turn.failed`의 오류 문구 원문이나 그 일부를 job 출력·커밋 상태 설명에 넣지 마라. 이유: 판정 job과 기록 job 사이의 값은 정한 형식만 나른다(10.4절 출력 검사). 원문에 비밀 값이나 임의의 글이 섞일 수 있다.
- 한도 오류에 판정 워크플로를 다시 실행하는 코드(runner, 워크플로)를 더하지 마라. 이유: 제작자 결정. 한도가 풀리기 전의 재실행은 판정 없이 사용량만 쓴다.
- 판정이 있는 실행에서 `unavailable` 값을 쓰거나 읽지 마라. 이유: 판정이 있으면 판정 검사·기록이 지금과 같아야 한다.
- `scripts/test/ci.test.ts`의 새 단언을 옛 워크플로와 새 워크플로를 둘 다 받게 쓰지 마라. 이유: 워크플로 변경이 빠진 head가 `check`를 통과한다(#135의 결함).
- `judge-claude.yml`, `claude-scan`, 지표 집계를 바꾸지 마라. 이유: 이 step의 범위 밖이다(계획의 비범위).
- 계획 검증 승인 전에 구현하지 마라. 이유: 절차서 2절.
