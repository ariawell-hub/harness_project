# Step 0: repro-on-demand

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `docs/SECURITY.md` "워크플로 변경 절차"
- `scripts/harness.ts`의 `codex-scan`·`claude-scan`·`repro`·`record-review` 명령, `scripts/ci/repro.ts`, `scripts/ci/verdict.ts`
- `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`
- `scripts/test/ci.test.ts`(재현 job 단언), `scripts/test/codex-scan.test.ts`·`scripts/test/claude-scan.test.ts`(유출 검사를 통과하는 입력)
- 설계서 10.2절 (3), 10.4절

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **유출 검사 명령의 `repro` 출력**
   - `scripts/ci/repro.ts`에 `hasRepro(verdict: Verdict): boolean`을 둔다. 지적 가운데 `repro.content`가 빈 문자열이 아닌 것이 하나라도 있으면 참이다(`runRepro`가 실행 대상으로 삼는 기준과 같다).
   - `scripts/harness.ts`의 `codex-scan`·`claude-scan`이 판정 파일을 쓴 뒤, 환경 변수 `GITHUB_OUTPUT`이 있으면 그 파일에 `repro=true` 또는 `repro=false` 한 줄을 덧붙인다. 없으면 쓰지 않는다. 판정을 내보내지 못하고 끝나는 경로에서는 쓰지 않는다. 판정을 `validateVerdict`로 읽지 못하면 `repro=true`를 쓴다(모르면 돌린다).
   - 새 테스트 `scripts/test/scan-output.test.ts`: 두 명령을 자식 프로세스로 실행해 수용 기준 1의 네 경우를 확인한다. 자식 프로세스에는 테스트가 만든 `GITHUB_OUTPUT` 파일만 넘긴다(CI 러너의 `GITHUB_OUTPUT`을 물려주지 않는다).
2. **워크플로 패치**: `lab/repro-on-demand/workflows.patch`(`git diff` 형식, 워크플로 파일 두 개만)와 `lab/repro-on-demand/README.md`(제작자가 웹에서 넣을 줄과 위치)를 만든다. 두 워크플로에 같은 변경이다.
   - `judge` job의 `outputs`에서 `verdict` 줄 바로 아래에 `repro: ${{ steps.scan.outputs.repro }}`를 더한다.
   - 재현 job의 `if: needs.judge.outputs.verdict != ''`를 `if: needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`로 바꾸고, 그 줄 바로 위에 이유를 적은 주석 한 줄을 더한다.
   - 그 밖의 줄은 바꾸지 않는다.
3. **문서**: 설계서 10.2절 (3)의 재현 job 항목과 10.4절에 도는 조건을 적고 버전을 올린다. `CHANGELOG`, TD-49 ④를 고친다.
4. **push 1**: 1~3을 커밋하고 `check`를 통과시켜 push한다. 이때 `scripts/test/ci.test.ts`와 워크플로 파일은 바꾸지 않는다. 판정의 차단 지적을 먼저 해결한다. 그 뒤 Issue #143에 제작자 작업을 요청한다(`needs-human`). 요청한 뒤 제작자의 커밋이 올 때까지 이 브랜치에 push하지 않는다. 요청할 때의 원격 브랜치 head가 기준 커밋이다.
5. **제작자의 워크플로 커밋을 받은 뒤**: `docs/SECURITY.md` "워크플로 변경 절차"의 4번대로 받은 head의 트리가 기준 커밋에 패치를 적용한 트리와 같은지 본다. 다르면 멈추고 제작자에게 알린다. 웹에서는 파일 하나에 커밋 하나가 되므로 커밋이 둘이어도 된다. 트리로 비교한다.
6. **push 2**: `scripts/test/ci.test.ts`의 재현 job 테스트를 고친다. 재현 job의 조건 단언을 수용 기준 2의 조건으로 바꾸고, `judge` job의 `repro` 출력 단언과 수용 기준 3의 기록 job 조건 단언을 더한다. `docs/SECURITY.md` "워크플로 변경 절차"와 `lab/workflow-change/result.json`을 이번에 해 본 결과로 고친다. `check`, AC, 완료 처리 뒤 push한다.
7. 판정을 통과하면 `pr-ready`로 승인을 요청한다. 병합 뒤 관찰(계획의 "검증 방법과 결과")을 Issue #143에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/scan-output.test.ts scripts/test/ci.test.ts scripts/test/harness-guard.test.ts scripts/test/record.test.ts scripts/test/repro.test.ts
```

제작자의 워크플로 커밋과 push 2의 테스트가 모두 든 트리에서 통과한다. 둘 중 하나만 있으면 `scripts/test/ci.test.ts`가 실패한다.

## 금지사항

- `.github/workflows/`의 파일을 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없어 push가 거부된다. 워크플로 파일은 제작자가 올린다.
- 재현 job의 조건을 "값이 `true`일 때만 돈다"로 쓰지 마라. 이유: 출력이 빠지거나 깨지면 재현이 빠진다.
- 판정을 내보내지 못한 경로에서 `repro` 값을 쓰지 마라. 이유: 판정이 없는데 재현 여부만 있는 출력이 생긴다.
- `scripts/test/ci.test.ts`의 단언을 옛 조건과 새 조건을 둘 다 받게 쓰지 마라. 이유: 워크플로 변경이 빠진 head가 `check`를 통과한다(#135의 결함).
- 재현 job의 권한·environment, 기록 job의 입력·조건, `runRepro`, `record-review`를 바꾸지 마라. 이유: 10.4절의 격리와 이 step의 범위.
- 계획 검증 승인 전에 구현하거나 옛 worktree의 초안을 돌리지 마라. 이유: 절차서 2절(#136에서 어긴 순서).
