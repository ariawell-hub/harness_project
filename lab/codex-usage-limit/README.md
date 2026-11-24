# Codex 사용 한도의 이유와 풀리는 시각: 워크플로 패치 (Issue #223)

봇은 워크플로 파일을 push할 수 없다(봇 토큰에 `workflow` 권한이 없다). 이 폴더의 `judge-codex.patch`는 제작자가 올릴 변경이다. 절차는 [docs/SECURITY.md](../../docs/SECURITY.md) "워크플로 변경 절차".

## 바꾸는 것

파일 하나다(`.github/workflows/judge-codex.yml`). 네 곳을 고친다. 다른 줄은 바꾸지 않는다.

1. `judge` job의 `outputs`에서 `repro` 줄 바로 아래에 한 줄을 더한다(앞에 공백 6칸).

   ```yaml
   unavailable: ${{ steps.why.outputs.unavailable }}
   ```

2. `judge` job의 `유출 검사` 단계(`id: scan`)에서 `codex-scan` 명령의 마지막 줄 끝 `--out "$OUT"` 뒤에 ` \`(공백과 역슬래시)를 붙이고, 그 아래에 한 줄을 더한다(앞에 공백 12칸).

   ```sh
   --unavailable-out "$RUNNER_TEMP/codex-unavailable.txt"
   ```

3. 같은 단계 바로 뒤, `인증 봉인` 단계(`id: seal`) 앞에 빈 줄 하나와 아래 다섯 줄을 더한다. 주석과 `- name`은 앞에 공백 6칸, 나머지는 8칸이다.

   ```yaml
   # 실패한 scan 단계의 출력에 기대지 않는다: 성공하는 이 단계가 한도 값 파일을 검사해 job 출력으로 넘긴다(Issue #223)
   - name: 사용 한도를 기록 job에 넘긴다 (LLM 없음. 정한 형식의 값만)
     id: why
     if: always() && steps.scan.outcome == 'failure'
     run: node base/scripts/harness.ts codex-unavailable --file "$RUNNER_TEMP/codex-unavailable.txt"
   ```

4. `record` job의 `record-review` 단계에서:
   - `env`의 `PLAN_HASH` 줄 바로 아래에 두 줄을 더한다(앞에 공백 10칸).

     ```yaml
     # 판정이 없을 때 설명에 적을 사용 한도(정한 형식만. record-review가 다시 검사한다, Issue #223)
     UNAVAILABLE: ${{ needs.judge.outputs.unavailable }}
     ```

   - `run`의 마지막 줄 `--mode "$MODE" --plan-hash "$PLAN_HASH"` 끝에 ` --unavailable "$UNAVAILABLE"`을 붙인다(같은 줄).

## 무엇이 달라지나

- Codex가 사용 한도에 걸리면 `review/codex`는 지금처럼 error(병합 막힘)다. 설명만 `판정 없음: 검증자 사용 한도(풀림 2026-11-21 08:36 UTC). 풀린 뒤 판정 워크플로를 다시 실행한다`처럼 이유와 풀리는 시각을 적는다(시각을 모르면 "풀리는 시각 모름").
- `why` 단계는 `scan` 단계가 실패했을 때만 돌고, 비밀과 환경 변수를 받지 않는다. 값 파일을 형식 검사해 `usage-limit` 또는 `usage-limit@YYYY-MM-DDTHH:MMZ`만 넘긴다. 오류 문구 원문은 넘기지 않는다. 언제나 종료 코드 0이다.
- 한도가 아니면 값이 비고, 기록 job의 설명은 지금 그대로다. 봉인 단계는 지금처럼 `always()`로 마지막에 돈다.

## 제작자 작업

GitHub 웹에서 한다. 브랜치 `feat/20261123-codex-usage-limit-s0`에서 `.github/workflows/judge-codex.yml`을 열어 위 네 곳을 고치고 그 브랜치에 바로 커밋한다. 에이전트가 도는 머신의 터미널에서는 하지 않는다(설계서 E5).

끝나면 봇이 받은 트리를 "요청할 때의 브랜치 head에 이 패치를 적용한 트리"와 통째로 비교한다. 공백 하나라도 다르면 봇이 다른 곳을 알려 준다.

## 봇이 확인한 것

- 구조 테스트(`scripts/test/ci.test.ts`의 judge-codex 테스트)를 먼저 더했다. 지금 워크플로에서 실패하고(`why` 단계가 없다), 이 패치를 적용한 트리에서 step0의 AC가 통과한다. 결과는 계획의 진행 로그에 있다.
- 패치는 통과를 확인한 그 트리의 `git diff -- .github/workflows`다. 워크플로를 되돌린 트리에 `git apply --check`로 그대로 적용된다.
- 실패한 job의 출력이 다음 job에 가는 것은 봉인·저장 경로가 이미 쓰는 동작이다(실행 44542064356: `judge`가 `scan`에서 실패했고 `seal` 출력으로 `store`가 성공). `why`는 같은 꼴이다.
- 세 명령(`codex-scan` → `codex-unavailable` → `record-review`)을 자식 프로세스로 잇는 테스트(`scripts/test/usage-limit-cli.test.ts`)가 가짜 GitHub API가 받은 상태를 단언한다.
