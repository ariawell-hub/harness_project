# 1분 미만 job의 러너 스위치: 워크플로 패치 (Issue #240)

ADR-0008에서 고른 수단 B1이다. 1분 미만 job 13개의 `runs-on`을, 리포 변수 `SHORT_JOB_RUNNER`로 1코어 러너(`ubuntu-slim`, 분당 $0.002)와 지금의 러너(`ubuntu-latest`, 분당 $0.006) 가운데 하나를 고르는 식으로 바꾼다. 검사의 내용은 바꾸지 않는다.

봇은 워크플로 파일을 push할 수 없다(봇 토큰에 `workflow` 권한이 없다). 이 폴더의 `workflows.patch`는 제작자가 올릴 변경이다. 절차는 [docs/SECURITY.md](../../../docs/SECURITY.md) "워크플로 변경 절차".

## 스위치 식

```yaml
runs-on: ${{ vars.SHORT_JOB_RUNNER == 'ubuntu-slim' && 'ubuntu-slim' || 'ubuntu-latest' }}
```

변수 값마다 고르는 러너다. GitHub 식의 `==`는 문자열의 대소문자를 가리지 않는다.

| `SHORT_JOB_RUNNER`의 값                             | 러너            |
| --------------------------------------------------- | --------------- |
| 없음(빈 문자열)                                     | `ubuntu-latest` |
| `ubuntu-slim`                                       | `ubuntu-slim`   |
| 대소문자만 다른 값(`UBUNTU-SLIM`, `Ubuntu-Slim` 등) | `ubuntu-slim`   |
| 그 밖의 값(`ubuntu-latest`, `self-hosted`, `on` 등) | `ubuntu-latest` |

어느 값이든 고르는 라벨은 식에 적힌 두 값 가운데 하나다(대소문자가 달라도 라벨은 소문자 `ubuntu-slim`이다). 변수 값을 그대로 러너로 쓰지 않으므로 변수로 다른 러너(예: self-hosted)를 고를 수 없다.

**이 패치를 커밋해도 러너는 바뀌지 않는다.** 변수가 없으면 지금처럼 `ubuntu-latest`다. 변수는 봇이 넣기 전 값을 잰 뒤(2026-11-29 UTC 뒤) 따로 요청한다([docs/SECURITY.md](../../../docs/SECURITY.md) "1분 미만 job의 러너 변수 (제작자)").

## 바꾸는 것

파일 네 개, job마다 `runs-on` 한 줄(앞 공백 4칸)이다. 줄을 더하거나 지우지 않는다. 바꾸기 전의 줄은 모두 `    runs-on: ubuntu-latest`이고, 바꾼 뒤의 줄은 모두 위의 스위치 식(앞 공백 4칸)이다.

| 파일                                   | job과 줄                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.github/workflows/gates.yml`          | `evaluate` 31째 줄, `record` 154째 줄                                                         |
| `.github/workflows/judge-claude.yml`   | `plan` 34째 줄, `repro` 204째 줄, `record` 246째 줄, `failed` 330째 줄, `ci-failure` 360째 줄 |
| `.github/workflows/judge-codex.yml`    | `plan` 35째 줄, `pubkey` 112째 줄, `store` 276째 줄, `repro` 311째 줄, `record` 353째 줄      |
| `.github/workflows/review-trigger.yml` | `trigger` 15째 줄                                                                             |

다른 job(`gates`의 `selftest`, 두 판정의 `judge`, `check`, `revert`, `q10-trial`)은 건드리지 않는다.

## 제작자 작업

GitHub 웹에서 한다. 브랜치 `feat/20261124-slim-runner-s0`에서 위 네 파일을 하나씩 열어(연필 → 고치기 → "Commit changes" → "Commit directly to the `feat/20261124-slim-runner-s0` branch") 그 브랜치에 바로 커밋한다. 파일마다 커밋 하나라 커밋이 넷이어도 된다. 에이전트가 도는 머신의 터미널에서는 하지 않는다(설계서 E5). 이 단계에서는 리포 변수를 만들지 않는다.

끝나면 봇이 받은 트리를 "이 패치를 적용한 트리"와 통째로 비교한다. 공백 하나라도 다르면 봇이 다른 곳을 알려 준다.

커밋 뒤 이 브랜치의 `check`는 한 번 실패한다. 기대한 실패다(기존 러너 테스트가 옛 러너를 요구한다). 봇이 이어서 구조 테스트(`tests.patch`)와 완료 처리를 올린다.

## 봇이 확인한 것

- 구조 테스트(`tests.patch`, `scripts/test/ci.test.ts`에 적용한다)를 먼저 썼다. 지금 워크플로에서 39개 가운데 2개(러너 표, 스위치 식)가 단언 실패로 실패하고, 이 패치를 적용한 트리에서 39개가 모두 통과한다. 그 트리에서 전체 테스트(1338개)도 통과한다.
- 패치는 통과를 확인한 그 트리의 `git diff -- .github/workflows`다.
- 같은 파일의 기존 단언 6곳이 비밀이 없는 job에 `vars.`가 없기를 요구한다. 그 금지는 그대로 두고 스위치 줄(글자 그대로 일치하는 한 줄)만 검사할 글에서 뺀다. 다른 `vars.` 줄은 계속 막힌다는 것도 테스트한다.
- `ubuntu-slim`에서 이 job들이 실제로 도는지는 변수를 켠 뒤 첫 실행으로 확인한다(계획 step1). 병합만으로는 러너가 바뀌지 않으므로 이 PR에서는 확인할 수 없다.

## 옮기지 않은 것

- `check`: B2에서 arm64 2코어로 옮겼고 1분 미만 job이 아니다.
- `gates`의 `selftest`, 두 판정의 `judge`: 몇 분씩 도는 job이다. arm64로 옮기는 것은 별도 Issue에서 다룬다.
- `revert`의 두 job: ADR-0008 B1의 목록에 없고, `act` job은 main에 push하는 봇 토큰을 가진다.

## 되돌리는 방법

- 러너만 되돌리려면 리포 변수 `SHORT_JOB_RUNNER`를 지운다. 바로 다음 실행부터 `ubuntu-latest`다. PR이 필요 없다.
- 스위치 식을 걷어 내려면 되돌리는 PR 하나에서 워크플로 13줄(제작자, 모두 `runs-on: ubuntu-latest`로)과 구조 테스트(봇: 러너 표의 기대값, 스위치 식 테스트, `withoutSwitch` 예외)를 함께 맞춘다. 워크플로만 바꾸면 구조 테스트가 그 PR의 `check`를 실패시킨다.
