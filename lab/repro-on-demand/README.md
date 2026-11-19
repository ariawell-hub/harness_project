# 재현 job의 조건부 실행: 워크플로 패치 (Issue #143)

봇은 워크플로 파일을 push할 수 없다(봇 토큰에 `workflow` 권한이 없다). 이 폴더의 `workflows.patch`는 제작자가 올릴 변경이다. 절차는 [docs/SECURITY.md](../../docs/SECURITY.md) "워크플로 변경 절차".

## 바꾸는 것

두 파일에 같은 변경이다(`.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`).

1. `judge` job의 `outputs`에서 `verdict` 줄 바로 아래에 한 줄을 더한다(앞에 공백 6칸).

   ```yaml
   repro: ${{ steps.scan.outputs.repro }}
   ```

2. `repro` job의 `if` 줄을 아래 두 줄로 바꾼다(앞에 공백 4칸).

   ```yaml
   # 재현 테스트가 붙은 지적이 있을 때만 돈다. judge의 유출 검사 단계가 repro 출력으로 정하고, 값이 없으면 돈다(Issue #143)
   if: needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'
   ```

   바꾸기 전의 줄은 `if: needs.judge.outputs.verdict != ''`이다. 파일에 이 줄은 하나뿐이다.

## 제작자 작업

GitHub 웹에서 한다. 브랜치 `feat/20261119-repro-on-demand-s0`에서 두 파일을 차례로 열어 위 두 곳을 고치고 그 브랜치에 바로 커밋한다. 파일 하나에 커밋 하나가 되어 커밋이 둘이어도 된다. 에이전트가 도는 머신의 터미널에서는 하지 않는다(설계서 E5).

끝나면 봇이 받은 트리를 "이 패치를 적용한 트리"와 통째로 비교한다. 공백 하나라도 다르면 봇이 다른 곳을 알려 준다.

## 봇이 확인한 것

- 구조 테스트(`scripts/test/ci.test.ts`의 재현 job 테스트)를 먼저 고쳤다. 지금 워크플로에서 실패하고, 이 패치를 적용한 트리에서 step0의 AC가 통과한다. 결과는 계획의 진행 로그에 있다.
- 패치는 통과를 확인한 그 트리의 `git diff -- .github/workflows`다.
