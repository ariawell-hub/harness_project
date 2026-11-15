# Step 3: repro-job

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-review-ledger/plan.md` (수용 기준 4·7, 의사결정 로그, 진행 로그)
- `docs/harness/design.md` 10.2절 (3)·(5), 10.4절 job 표·"재현 job의 한계"·캐시 규칙
- `scripts/ci/{verdict,ledger,record}.ts`, `.github/workflows/judge-*.yml`, `scripts/gates/harness-guard.ts`

## 작업

1. 판정 스키마의 지적에 `repro`(선택)를 더한다: `{ path, content }`. `path`는 설정 `ci.repro.dir` 아래의 새 파일 이름(정해진 접두어, `..` 금지), `content`는 크기 상한이 있는 테스트 소스다. 기록 job의 시크릿 스캔 대상에 넣는다.
2. `scripts/ci/repro.ts`: 판정에서 재현 테스트를 뽑아 PR 체크아웃에 쓰고(기존 파일은 덮지 않는다) 설정 `ci.repro.command`로 하나씩 실행한다(시간 제한). 테스트가 실패하면 `reproduced`, 통과하면 `not-reproduced`, 실행 자체가 안 되면 `error`. 결과는 지적 순번과 값만 담은 JSON이다.
3. 워크플로: 두 판정 워크플로에 `repro` job(`permissions: {}`, environment 없음, 캐시 없음, `judge` 뒤). 판정을 job 출력으로 받아 `repro.ts`를 `base/`에서 실행한다. `record`가 결과를 받아 원장에 반영한다. `harness-guard`의 캐시·environment 검사에 이 job을 넣는다.
4. 원장 규칙: 근거(`evidence`·위치)가 빈 P1은 등록할 때 P2로 내린다. `reproduced`인 P1은 동결 규칙의 예외로 `open`으로 받는다. `not-reproduced`는 상태를 바꾸지 않고 표시만 한다(검증자가 다음 라운드에 판정). P0은 내리지 않는다.
5. 테스트: `repro.ts`(경로 탈출, 덮어쓰기 거부, 시간 초과, 세 결과), 원장 규칙, 워크플로 불변식. 문서: 설계서 10.2절 (3), 10.4절(재현 job 트리거를 실제 구현으로), 프롬프트(재현 테스트 작성 규칙), `CHANGELOG`. step2의 실제 동작 확인 결과를 진행 로그에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/repro.test.ts scripts/test/ledger.test.ts scripts/test/verdict.test.ts scripts/test/ci.test.ts
grep -q "export function runRepro" scripts/ci/repro.ts
grep -Eq "^  repro:" .github/workflows/judge-claude.yml
```

## 금지사항

- 재현 job에 비밀·environment·쓰기 권한·캐시 복원을 주지 마라. 이유: PR 코드를 실행한다(10.4절).
- "재현 안 됨"만으로 P1을 내리거나 닫지 마라. 이유: PR 코드가 결과를 조작할 수 있다(10.4절 재현 job의 한계).
- 재현 결과 문자열을 기록 job에서 실행하거나 셸에 넘기지 마라. 이유: 신뢰할 수 없는 출력이다.
