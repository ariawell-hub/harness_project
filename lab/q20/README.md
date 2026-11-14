# Q20 시험 결과

로드맵 2단계 착수 조건인 Q20 시험(설계서 18절 Q20)의 결과다. 시험은 시험 리포 `ariawell-hub/harness-q20-lab`(시험 뒤 보관)에서 했다. 운영 방식은 [ADR-0004](../../docs/decisions/ADR-0004-q20-lab-repo.md), 진행·결정·발견 사항은 실행 계획 `20261111-q20-lab`(`docs/exec-plans/completed/`)에 있다.

**종합: 조건부 통과(2026-11-14).** 항목별 요약과 설계서에 반영한 내용은 설계서 18절 Q20 행과 실행 계획의 "검증 방법과 결과"에 있다.

## 시험 소스는 git 이력에 있다

시험이 끝나 시험 소스(`repo/`, `attacks/`, `deploy.ts`, `patch-id.ts`와 그 테스트)를 트리에서 지웠다(step6). **소스가 남아 있는 마지막 커밋은 `7b837e7b68412d6259a195e13e51858478e2f024`**(main, step5 병합)다.

```bash
git show 7b837e7b68412d6259a195e13e51858478e2f024:lab/q20/repo/.github/workflows/judge-codex.yml
git ls-tree -r --name-only 7b837e7b68412d6259a195e13e51858478e2f024 lab/q20
```

2단계 구현 때 참고할 소스(위 커밋 기준 경로):

| 경로                                                           | 내용                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lab/q20/repo/.github/workflows/judge-claude.yml`              | Claude 판정 job(`--restricted`·Read/Grep/Glob·`dontAsk`·MCP 없음)과 유출 검사                          |
| `lab/q20/repo/.github/workflows/judge-codex.yml`               | 공개키 조회 → Codex 판정(권한 프로필 샌드박스, 사전 측정) → 봉인 → 저장 job, 워크플로 단위 concurrency |
| `lab/q20/repo/.github/workflows/recorder.yml`                  | 시험 App 토큰(`actions/create-github-app-token`, 커밋 SHA 고정)으로 commit status 쓰기                 |
| `lab/q20/repo/.github/workflows/probe-{prt,pr,push}.yml`       | 이벤트별 ref·environment 관찰                                                                          |
| `lab/q20/repo/judge/{scan,codex-scan}.mjs`                     | 판정 job 유출 검사(토큰·인코딩, 밖 읽기, 허용 밖 도구, 훅·MCP 표식)                                    |
| `lab/q20/repo/judge/codex-auth.mjs`, `codex-probe.sh`          | Codex `auth.json` 복원·봉인, 권한 프로필 생성(`pr/` 조상 거부 금지), LLM 없는 샌드박스 측정            |
| `lab/q20/repo/judge/{prompt,codex-prompt}.md`, `*.schema.json` | 판정 프롬프트와 판정 스키마                                                                            |
| `lab/q20/attacks/`                                             | 공격 PR overlay(주입 문서, 프롬프트 덮어쓰기, PR 트리 설정, 심볼릭 링크, 워크플로 수정)                |
| `lab/q20/deploy.ts`, `lab/q20/patch-id.ts`                     | 시험 리포 배포(작업 트리 없이 커밋·PR), patch-id 측정                                                  |
| `lab/q20/test/`                                                | 위 도구의 테스트(`codex-auth`, `codex-scan`, `judge-scan`, `deploy`, `patch-id`)                       |

## 남은 구조

| 경로                  | 내용                                                     |
| --------------------- | -------------------------------------------------------- |
| `report.ts`           | `results/*.json` 기록 완결성 검사                        |
| `results/<항목>.json` | 항목별 결과                                              |
| `test/`               | `report.ts` 테스트(`node --test lab/q20/test/*.test.ts`) |

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않는다.

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
- 근거의 URL은 보관된 시험 리포를 가리킨다. 제작자 계정으로 볼 수 있다.

```bash
node lab/q20/report.ts --item <항목>
node lab/q20/report.ts --all   # 7개 항목 전부
```
