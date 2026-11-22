# check job을 arm64 2코어 러너로: 워크플로 패치 (Issue #206)

ADR-0008에서 고른 수단 B2의 첫 단계다. `check` 워크플로의 `check` job을 arm64 2코어 러너(`ubuntu-24.04-arm`, 분당 $0.005. 지금의 x64 2코어는 분당 $0.006)로 옮긴다. 검사의 내용은 바꾸지 않는다.

봇은 워크플로 파일을 push할 수 없다(봇 토큰에 `workflow` 권한이 없다). 이 폴더의 `workflows.patch`는 제작자가 올릴 변경이다. 절차는 [docs/SECURITY.md](../../../docs/SECURITY.md) "워크플로 변경 절차".

## 바꾸는 것

파일 하나(`.github/workflows/check.yml`), `check` job의 세 줄이다. 줄을 더하거나 지우지 않는다. 세 줄 모두 파일에 하나씩만 있다.

1. `runs-on` 줄(20째 줄, 앞에 공백 4칸).

   ```yaml
   runs-on: ubuntu-24.04-arm
   ```

   바꾸기 전의 줄은 `runs-on: ubuntu-latest`다.

2. "gitleaks (체크섬 검증)" 단계의 `GITLEAKS_SHA256` 줄(38째 줄, 앞에 공백 10칸).

   ```yaml
   GITLEAKS_SHA256: e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
   ```

   바꾸기 전의 값은 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`다.

3. 같은 단계의 `curl` 줄(40째 줄)에서 파일 이름 끝의 `linux_x64`를 `linux_arm64`로 바꾼다. 줄의 다른 곳은 그대로다.

   ```yaml
   curl -sSfL -o /tmp/gitleaks.tgz "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz"
   ```

`GITLEAKS_VERSION`(8.30.1)과 체크섬을 검증하는 줄(`sha256sum -c -`)은 그대로 둔다. 다른 워크플로(`gates.yml`의 `selftest` 포함)는 건드리지 않는다.

## 제작자 작업

GitHub 웹에서 한다. 브랜치 `feat/20261122-arm64-check-s0`에서 `.github/workflows/check.yml`을 열어 위 세 줄을 고치고 그 브랜치에 바로 커밋한다. 에이전트가 도는 머신의 터미널에서는 하지 않는다(설계서 E5).

끝나면 봇이 받은 트리를 "이 패치를 적용한 트리"와 통째로 비교한다. 공백 하나라도 다르면 봇이 다른 곳을 알려 준다.

커밋이 올라가면 그 head의 `check`가 arm64 러너에서 돈다(`check` 워크플로는 PR 쪽 정의로 돈다). 봇이 이어서 구조 테스트와 완료 처리를 올리고, 그 head의 `check`가 arm64에서 통과한 것을 확인한 뒤에 승인을 요청한다.

## 봇이 확인한 것

- arm64 파일의 체크섬은 gitleaks 8.30.1의 배포 체크섬 목록(`gitleaks_8.30.1_checksums.txt`)에서 읽었고, 파일을 받아 계산한 값과 같다. 같은 목록의 x64 값은 지금 워크플로에 고정한 값과 같다.
- 구조 테스트(`scripts/test/ci.test.ts`의 러너 테스트, `scripts/test/harness-guard.test.ts`의 gitleaks 고정값 단언)를 먼저 썼다. 두 파일 모두 지금 워크플로에서 단언 실패로 실패하고, 이 패치를 적용한 트리에서 통과한다. 결과는 계획의 진행 로그에 있다.
- 패치는 통과를 확인한 그 트리의 `git diff -- .github/workflows`다.
- arm64 러너에서 `check`가 실제로 통과하는지는 로컬에서 확인하지 못했다(이 머신에 Linux arm64 환경이 없다). 제작자의 커밋 뒤 이 PR의 `check`가 확인한다.

## 옮기지 않은 것

- `gates`의 `selftest` job과 두 판정 워크플로의 `judge` job. main의 정의로 돌아(`pull_request_target`, `workflow_run`) 병합 전에 실제 조건으로 돌려 볼 수 없다. 별도 Issue에서 다룬다.
- 1분 미만 job. 다음 수단(B1)에서 1코어 러너로 옮긴다.

## 되돌리는 방법

이 패치의 반대다(세 줄을 "바꾸기 전"의 값으로). `check` 워크플로는 PR 쪽 정의로 돌므로 되돌리는 PR의 `check`는 되돌린 정의(x64)로 돈다. main의 다른 PR은 `origin/main`을 병합하면 되돌린 정의를 받는다.
