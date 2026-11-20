# Q10(DB·ORM): 실물 확인

파일럿 웹 프로젝트의 DB를 PostgreSQL + Drizzle로 정할 때의 기준은 "여러 PC와 다양한 개발 환경에 영향이 없는가"였다([ADR-0007](../../docs/decisions/ADR-0007-db-postgres-drizzle.md)). 이 폴더는 그 기준을 잰 기록이다. PC에 DB 서버나 컨테이너 런타임 없이, 패키지 설치만으로 마이그레이션 생성·적용과 폴더별 격리가 되는지 실제 도구로 돌려 본다. 계획은 `20261120-q10-db-decision`(`docs/exec-plans/`)이다.

| 경로                        | 내용                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `trial.ts`                  | 빈 폴더에 시험 프로젝트를 만들고 돌려 결과 파일을 쓴다                                                     |
| `check-results.ts`          | 결과 파일을 기대값과 대 본다(어긋나면 종료 코드 1). 확인한 버전의 출처. `--confirm`은 확정 조건을 판정한다 |
| `results/<platform>-<arch>` | 실행한 머신마다 결과 파일 하나                                                                             |
| `test/`                     | `check-results.ts` 테스트                                                                                  |

결과 파일은 스크립트가 쓴다. 손으로 고치지 않는다. 기대와 다른 결과가 나오면 스크립트나 절차를 고치고 다시 돌린다.

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않고, `scripts/test/`의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).

## 절차

```bash
T=$(mktemp -d)
node lab/q10-db/trial.ts "$T"
node scripts/harness.ts fmt
node lab/q10-db/check-results.ts <platform>-<arch>
node --test lab/q10-db/test/check-results.test.ts
```

- `<platform>-<arch>`는 그 머신의 `process.platform`과 `process.arch`다(`trial.ts`가 쓴 파일 이름을 출력한다). 예: `darwin-arm64`, `win32-x64`, `linux-x64`.
- 필요한 것은 Node(22.18 이상), 이 리포가 고정한 버전의 pnpm, npm 레지스트리 접근이다. DB 서버, 컨테이너 런타임, 빌드 도구는 필요 없다.
- `trial.ts`는 이 리포의 설치 정책(`pnpm-workspace.yaml`, R17: 게시 후 14일이 지난 버전만, 설치 스크립트 차단)을 시험 프로젝트에 그대로 복사한 뒤 설치한다. 정책에 걸리는 버전이면 설치가 거부되고 결과 파일을 쓰지 않는다.
- 작업 트리를 바꾸지 않고 돌려만 보려면 결과를 리포 밖에 쓴다: `node lab/q10-db/trial.ts "$T" --out "$O/result.json"` 뒤 `node lab/q10-db/check-results.ts --file "$O/result.json"`(`O`도 `mktemp -d`).

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

| 결과 파일                   | 머신                 | 날짜       |
| --------------------------- | -------------------- | ---------- |
| `results/darwin-arm64.json` | macOS(Apple Silicon) | 2026-11-20 |

Windows 네이티브와 Linux에서는 아직 재지 않았다. 그래서 ADR-0007은 잠정이다.

## 확정 조건

```bash
node lab/q10-db/check-results.ts --confirm
```

`results/`에 macOS(`darwin-*`), Windows 네이티브(`win32-*`), Linux(`linux-*`)의 결과 파일이 모두 있고 모두 검사를 통과할 때만 종료 코드 0이다. 결과가 없는 환경과 통과하지 못한 파일을 한 줄씩 낸다. 환경 하나만 더 통과한 상태는 1이다. 지금은 macOS 결과뿐이라 1이다.

Windows는 그 머신에서 처음 작업할 때 위 절차를 돌려 결과 파일을 더한다(기술 부채 표의 TD-14). 검사가 통과하지 않으면 ADR-0007의 "되돌리는 조건"을 따른다.

## 이 확인이 보지 않는 것

- 같은 폴더를 두 프로세스가 함께 여는 경우. PGlite는 한 프로세스가 연결 하나로 쓴다. `dev`와 테스트는 서로 다른 DB를 쓴다.
- 서버형 PostgreSQL(운영)과의 차이: 연결 풀, 동시성, 확장 기능.
- 성능. 첫 기동은 1초 안쪽이고 DB 폴더는 수십 MB였다(2026-11-20, macOS). 결과 파일에는 담지 않는다(머신마다 달라 비교할 수 없다).
