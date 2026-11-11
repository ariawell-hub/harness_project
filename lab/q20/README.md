# Q20 시험 도구

로드맵 2단계 착수 조건인 Q20 시험(설계서 18절 Q20)을 시험 리포 `ariawell-hub/harness-q20-lab`에서 하기 위한 도구와 결과다. 운영 방식은 [ADR-0004](../../docs/decisions/ADR-0004-q20-lab-repo.md), 진행은 실행 계획 `20261111-q20-lab`을 따른다.

**시험이 끝나면(step6) 시험 소스(`repo/`, `attacks/`, `deploy.ts`, `patch-id.ts`)를 트리에서 지운다.** 결과(`results/`)와 이 README, `report.ts`는 남긴다. 소스는 git 이력에 있다.

## 구조

| 경로                  | 내용                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `repo/`               | 시험 리포 main 트리의 원본. 워크플로는 `repo/.github/workflows/`                        |
| `attacks/<이름>/`     | 공격 PR overlay. 시험 리포 main 트리 위에 이 파일들만 덮어 PR을 연다                    |
| `deploy.ts`           | 커밋된 트리로 시험 리포 브랜치 커밋을 만들고 PR을 연다. 작업 트리는 건드리지 않는다(R3) |
| `report.ts`           | `results/*.json` 기록 완결성 검사                                                       |
| `results/<항목>.json` | 항목별 결과                                                                             |
| `test/`               | 도구 테스트(`node --test lab/q20/test/*.test.ts`)                                       |

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않는다. 시험 워크플로는 하네스 리포 `.github/`가 아니라 `repo/.github/`에 두므로 하네스 CI에서 돌지 않는다.

## 배포

배포는 **커밋된 HEAD**만 쓴다. 고친 뒤 먼저 커밋한다.

```bash
# 시험 리포 내용 갱신: lab/q20/repo 트리로 PR을 열고 squash 병합
node lab/q20/deploy.ts --branch q20/<이름> --merge
# 공격 PR: 시험 리포 main 위에 overlay를 덮은 PR을 연다(병합하지 않는다)
node lab/q20/deploy.ts --branch q20/attack-<이름> --overlay lab/q20/attacks/<이름>
```

출력은 `{ branch, commit, parent, tree, source, pr, merged }` JSON 한 줄이다.

## 결과 형식

```json
{
  "item": "patch-id",
  "summary": "한두 문장 요약",
  "cases": [
    {
      "name": "사례 이름",
      "expected": "설계서가 기대하는 동작",
      "observed": "관찰한 동작",
      "verdict": "pass | fail | partial | n/a",
      "evidence": ["워크플로 실행 URL, PR URL 등"]
    }
  ]
}
```

- 판정이 `fail`이어도 기록이 완결되면 `report.ts`는 통과다. 실패도 유효한 결과다.
- `n/a`가 아니면 근거가 1개 이상 있어야 한다. `n/a`면 `observed`에 이유를 적는다.
- 자격증명 값이나 그 일부는 적지 않는다. 필요하면 sha256 앞 8자만 쓴다.

```bash
node lab/q20/report.ts --item <항목>
node lab/q20/report.ts --all   # 7개 항목 전부
```
