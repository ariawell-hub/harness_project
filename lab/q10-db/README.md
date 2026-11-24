# Q10(DB·ORM): 실물 확인

파일럿 웹 프로젝트의 DB를 PostgreSQL + Drizzle로 정할 때의 기준은 "여러 PC와 다양한 개발 환경에 영향이 없는가"였다([ADR-0007](../../docs/decisions/ADR-0007-db-postgres-drizzle.md)). 이 폴더는 그 기준을 잰 기록이다. PC에 DB 서버나 컨테이너 런타임 없이, 패키지 설치만으로 마이그레이션 생성·적용과 폴더별 격리가 되는지 실제 도구로 돌려 본다. 계획은 `20261120-q10-db-decision`(`docs/exec-plans/`)이다.

| 경로                        | 내용                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run.ts`                    | 절차 전체를 명령 하나로 돌린다(아래 "절차"). 실패한 자리에서 멈춘다                                                                                    |
| `trial.ts`                  | 빈 폴더에 시험 프로젝트를 만들고 돌려 결과 파일을 쓴다                                                                                                 |
| `check-results.ts`          | 결과 파일을 기대값과 대 본다(어긋나면 종료 코드 1). 확인한 버전의 출처. `--confirm`은 확정 조건을 판정한다                                             |
| `verify-artifacts.ts`       | CI 러너에서 잰 결과 파일의 출처 확인: 아래 "잰 머신" 표가 가리키는 실행의 산출물과 값으로 같은지 본다(GitHub은 읽기만 한다)                            |
| `results/<platform>-<arch>` | 실행한 머신마다 결과 파일 하나                                                                                                                         |
| `test/`                     | 이 폴더 스크립트의 테스트와, 결과 파일·문서가 같은 확정 상태를 말하는지 보는 테스트(`confirmed.test.ts`)                                               |
| `q10-trial-workflow.patch`  | CI 러너에서 절차를 돌리는 워크플로(`.github/workflows/q10-trial.yml`)의 패치. 워크플로는 제작자가 올린다([워크플로 변경 절차](../../docs/SECURITY.md)) |

결과 파일은 스크립트가 쓴다. 손으로 고치지 않는다. 기대와 다른 결과가 나오면 스크립트나 절차를 고치고 다시 돌린다.

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않는다. `scripts/test/`의 테스트는 이 폴더에서 두 파일을 읽는다: 워크플로 패치(`q10-trial-workflow.test.ts`가 워크플로 파일과 글자 그대로 같은지 본다)와 `results/darwin-arm64.json`(`profile-web-db.test.ts`가 웹 프로파일 README의 DB 절에 적은 버전과 같은지 본다). `check`는 `lab/` 안의 파일만 바뀐 변경에서 `test`를 건너뛰지만(`testInertPaths`) 보호 경로는 건너뛰지 않는다. 워크플로 패치는 보호 경로라, 그것을 바꾼 변경은 `test`를 돌리고 제작자 승인이 필요하다. 결과 파일을 같게 다루는 일은 Issue #225다.

## 절차

리포의 루트에서 돌린다. macOS, Linux, Windows 네이티브에서 같은 명령이다(셸과 무관하다):

```bash
node lab/q10-db/run.ts
```

`run.ts`는 새 임시 폴더를 만들어 다음을 차례로 돌린다: `trial.ts`(실행) → `node scripts/harness.ts fmt`(결과 파일 포맷) → `check-results.ts <platform>-<arch>`(결과 검사) → `check-results.ts`의 테스트. **한 단계가 실패하면 뒤 단계를 돌리지 않고** 실패한 단계의 이름을 내며 종료 코드 1로 끝난다. `trial.ts`는 실패하면 결과 파일을 새로 쓰지 않는다. 그때 `results/`에 남아 있는 파일은 이전 실행의 것이라, 이어서 검사를 돌리면 이전 결과가 통과로 보인다. 그래서 실패한 자리에서 멈춘다(`test/run.test.ts`가 본다).

- 통과한 결과 파일만 커밋한다. 절차가 중간에 멈췄으면 `git status`로 결과 파일이 이번 실행에서 바뀌었는지 본다.
- 결과 파일의 이름(`<platform>-<arch>`)은 그 머신의 `process.platform`과 `process.arch`다(`trial.ts`가 쓴 파일 이름을 출력한다). 예: `darwin-arm64`, `win32-x64`, `linux-x64`. `run.ts`가 그 이름을 만들어 검사에 넘긴다.
- 필요한 것은 Node(22.18 이상), 이 리포가 고정한 버전의 pnpm, npm 레지스트리 접근이다. DB 서버, 컨테이너 런타임, 빌드 도구는 필요 없다.
- `trial.ts`는 이 리포의 설치 정책(`pnpm-workspace.yaml`, R17: 게시 후 14일이 지난 버전만, 설치 스크립트 차단)을 시험 프로젝트에 그대로 복사한 뒤 설치한다. 정책에 걸리는 버전이면 설치가 거부되고 결과 파일을 쓰지 않는다.
- 이 명령은 `lab/q10-db/results/<platform>-<arch>.json`을 다시 쓴다(결과를 다른 경로에 쓰는 옵션은 없다). 작업 트리를 바꾸지 않고 돌려 보려면 리포를 새 임시 폴더에 복제해 그 안에서 돌린다: `git clone <이 리포의 경로> <새 임시 폴더>/repo` 뒤 그 폴더에서 `node lab/q10-db/run.ts --skip-fmt`. 복제본에는 하네스의 의존성이 없어 포맷을 건너뛴다(CI 러너와 같은 조건이다). 결과는 복제본의 `results/`에 쓰인다.
- 포맷만 건너뛰려면 `--skip-fmt`를 준다. 하네스의 의존성(`node scripts/harness.ts setup`)을 설치하지 않은 곳에서 쓴다. 그 결과 파일은 리포에 넣기 전에 `node scripts/harness.ts fmt`로 포맷한다.

### CI 러너에서 돌리기

Linux와 Windows 네이티브의 결과는 GitHub Actions 러너에서 얻을 수 있다. 워크플로 `q10-trial`(`.github/workflows/q10-trial.yml`)은 손으로만 돌고(`workflow_dispatch`), `ubuntu-latest`와 `windows-latest`에서 `node lab/q10-db/run.ts --skip-fmt`를 돌려 `results/` 폴더를 실행 산출물로 올린다. 러너에서는 포맷을 건너뛴다(하네스의 의존성을 설치하지 않는다). 비밀과 쓰기 권한을 쓰지 않고, 리포에 아무것도 올리지 않는다.

1. 돌린다: `gh workflow run q10-trial.yml --ref main`. 실행 번호는 `gh run list --workflow q10-trial.yml --limit 1`로 본다.
2. 두 job이 모두 성공하면 산출물(`q10-result-ubuntu-latest`, `q10-result-windows-latest`)을 새 임시 폴더에 받는다: `gh run download <실행 번호> --dir <새 임시 폴더>`.
3. 받은 폴더의 `linux-<arch>.json`과 `win32-<arch>.json`을 `lab/q10-db/results/`에 복사한다. 내용은 손으로 고치지 않는다. 산출물에 함께 든 다른 환경의 파일(체크아웃된 그대로 올라온 것)은 쓰지 않는다.
4. `node scripts/harness.ts fmt`로 포맷하고 `node lab/q10-db/check-results.ts <이름>`으로 검사한다. 아래 "잰 머신" 표에 실행 주소와 함께 적는다.
5. `node lab/q10-db/verify-artifacts.ts`로 출처를 확인한다. 표의 `linux-`·`win32-` 행마다 그 실행이 `main`에서 손으로 돌린 `q10-trial` 실행이고 두 OS의 job이 성공했는지, 그 OS의 산출물(`q10-result-<러너>`)에 든 같은 이름의 파일이 커밋한 결과 파일과 값으로 같은지(JSON으로 읽어 견준다. 포맷 차이는 빠진다) 본다. 문제가 있으면 종료 코드 1이다. 맞지 않으면 표의 주소를 바꾸지 말고 산출물을 다시 받는다.
   - 아래 "잰 머신" 표는 포매터가 쓰는 꼴로만 읽는다(GitHub이 보여 주는 표와 검사가 읽는 표가 어긋나지 않게). 절에 표는 하나이고 앞뒤에 빈 줄을 둔다. 표의 모든 줄은 맨 앞에서 `|`로 시작해 `|`로 끝나고, 둘째 줄이 구분 줄이며, 모든 줄의 칸 수가 같다. 머리줄에 "결과 파일"·"실행" 칸이 하나씩 있고, 실행 칸에는 실행 주소 하나만 적는다. 절 안에는 HTML 줄과 코드 울타리를 두지 않고, README 어디에도 빈 줄에서 끝나지 않는 HTML 블록(`<!--`, `<pre>` 등)을 두지 않는다. README의 코드 울타리는 맨 앞의 ` ``` ` 또는 `~~~` 셋과 언어 이름(없어도 된다)으로 열고 같은 세 글자만 있는 줄로 닫는다. 다른 꼴이면 행을 하나도 읽지 않고 종료 코드 1이다. `node scripts/harness.ts fmt`로 정리하면 표가 이 꼴이 된다.

받은 파일을 리포에 넣기 전에 검사하려면 `node lab/q10-db/check-results.ts --file <받은 파일>`을 쓸 수 있다(파일을 읽어 검사만 하고 아무것도 쓰지 않는다). 이 검사는 그 파일을 실행 중인 머신의 플랫폼과 대 본다. 받은 머신과 플랫폼이 다르면(Mac에서 받은 `linux-*`·`win32-*`) 복사한 뒤 `<이름>`으로 검사한다.

패키지 버전, pnpm 고정 버전, 설치 정책을 바꾸면 다시 돌린다.

## 확인하는 것

- **패키지**: `drizzle-orm`, `@electric-sql/pglite`, `drizzle-kit`을 `check-results.ts`의 `PACKAGES`에 적힌 버전으로 설치한다. 설치 정책 아래에서 설치되는 버전이다(2026-11-20에 PGlite의 최신 버전 0.5.17은 게시 하루째라 정책에 걸렸고, 0.5.15가 설치됐다).
- **설치 정책**: 시험 프로젝트에 놓인 정책 파일의 게시 후 최소 기간이 20160분(14일) 이상이고 설치 스크립트 허용 항목이 없다.
- **쓰는 pnpm이 그 정책을 실제로 적용한다**: 정책 파일을 놓는 것만으로는 부족하다(정책을 모르는 pnpm은 파일을 무시한다). `trial.ts`는 설치 전에 두 가지를 확인하고, 어긋나면 결과를 쓰지 않고 실패한다.
  - pnpm 버전이 이 리포의 `package.json`에 고정된 `packageManager`와 같다. `check-results.ts`도 결과의 pnpm 버전을 리포의 그 값과 직접 대 본다(결과 안의 두 칸이 서로 같기만 한 것은 통과가 아니다). 리포의 고정 버전을 올리면 저장된 결과는 통과하지 않으므로 다시 잰다.
  - 최소 기간을 100년으로 올린 정책 파일을 놓은 확인용 폴더(`probe/`)에서 설치가 `NO_MATURE_MATCHING_VERSION`으로 거부된다. 결과의 `policy.enforced`가 이 확인의 통과를 뜻한다.
- **PGlite가 머신에 기대지 않는다**: 런타임 의존성 0, 네이티브 바이너리(`.node`) 0, WASM 파일이 있다, `os`·`cpu` 제한이 없다.
- **설치 스크립트**: 설치된 패키지 가운데 설치 스크립트를 가진 것은 `esbuild`뿐이고(`drizzle-kit`이 쓴다), 그 스크립트를 실행하지 않아도 아래가 모두 된다.
- **마이그레이션 생성**: `drizzle-kit generate`가 `CREATE TABLE`이 든 SQL 파일을 만든다.
- **사례**: 실행할 때마다 마이그레이션을 적용하고 한 행을 넣은 뒤 그 DB의 전체 행 수를 센다.

  | 사례                           | 기대 | 뜻                                       |
  | ------------------------------ | ---- | ---------------------------------------- |
  | `folder-a`                     | 1행  | 폴더 하나가 DB 하나다                    |
  | `folder-b`                     | 1행  | 다른 폴더는 격리된다                     |
  | `folder-a-again`               | 2행  | 같은 폴더를 다시 열면 데이터가 남아 있다 |
  | `memory`                       | 1행  | 메모리 DB(테스트용)                      |
  | `concurrent-c`, `concurrent-d` | 1행  | 서로 다른 폴더는 동시에 열 수 있다       |

## 잰 머신

| 결과 파일                   | 머신                            | 날짜       | 실행                                                                     |
| --------------------------- | ------------------------------- | ---------- | ------------------------------------------------------------------------ |
| `results/darwin-arm64.json` | macOS(Apple Silicon)            | 2026-11-20 |                                                                          |
| `results/linux-x64.json`    | GitHub Actions `ubuntu-latest`  | 2026-11-23 | https://github.com/ariawell-hub/harness_project/actions/runs/45180055726 |
| `results/win32-x64.json`    | GitHub Actions `windows-latest` | 2026-11-23 | https://github.com/ariawell-hub/harness_project/actions/runs/45180055726 |

세 환경(macOS, Linux, Windows 네이티브)의 결과가 모두 검사를 통과해 ADR-0007은 채택이다(2026-11-23). Linux와 Windows 네이티브의 결과 파일은 위 실행(`main`의 `67bd225`에서 손으로 돌린 `q10-trial`)의 산출물이고, `node lab/q10-db/verify-artifacts.ts`로 출처를 확인했다. 그 전 실행(45177957783)은 `trial.ts`가 Corepack의 다운로드 안내를 pnpm 버전으로 읽어 두 job이 실패했다(Issue #233에서 고쳤다).

## 확정 조건

```bash
node lab/q10-db/check-results.ts --confirm
```

`results/`에 macOS(`darwin-*`), Windows 네이티브(`win32-*`), Linux(`linux-*`)의 결과 파일이 모두 있고 모두 검사를 통과할 때만 종료 코드 0이다. 결과가 없는 환경과 통과하지 못한 파일을 한 줄씩 낸다. 환경 하나만 더 통과한 상태는 1이다. 지금(2026-11-23)은 세 환경의 결과가 모두 통과해 0이다.

Windows 네이티브의 결과는 CI의 `windows-latest` 러너에서 받은 산출물이다(Linux는 같은 실행의 `ubuntu-latest`). 패키지 버전, pnpm 고정 버전, 설치 정책을 바꾸면 위 "CI 러너에서 돌리기"로 다시 잰다. 검사가 통과하지 않으면 ADR-0007의 "되돌리는 조건"을 따른다.

## 이 확인이 보지 않는 것

- 같은 폴더를 두 프로세스가 함께 여는 경우. PGlite는 한 프로세스가 연결 하나로 쓴다. `dev`와 테스트는 서로 다른 DB를 쓴다.
- 서버형 PostgreSQL(운영)과의 차이: 연결 풀, 동시성, 확장 기능.
- 성능. 첫 기동은 1초 안쪽이고 DB 폴더는 수십 MB였다(2026-11-20, macOS). 결과 파일에는 담지 않는다(머신마다 달라 비교할 수 없다).
