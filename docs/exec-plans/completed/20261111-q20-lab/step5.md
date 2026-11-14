# Step 5: judge-codex

## 읽어야 할 파일

- `lab/q20/README.md`, step4의 `judge-claude.yml`과 유출 검사
- `docs/harness/design.md` 10.4절 "Codex 인증 저장 job", 13.3절 Codex 인증
- `docs/decisions/ADR-0004-q20-lab-repo.md`

## 작업

항목 `judge-codex`(판정 job 격리)와 `codex-auth`(인증 수명주기)를 확인한다. 제작자가 `judge-codex`에 진짜 `CODEX_AUTH_JSON`, `codex-auth-store`에 재저장용 자격증명을 넣은 뒤에 시작한다. 필수 승인 1은 step4부터 유지한다.

1. 재저장 방식 설계를 먼저 제작자에게 확인받는다.
   - 판정 job이 갱신된 `auth.json`을 저장 job만 풀 수 있게 암호화해 넘긴다.
   - 저장 job(`codex-auth-store`, LLM 없음)이 environment 시크릿을 갱신한다. 갱신 권한을 가진 자격증명 종류(시험 App의 Environments 권한 등)와 암호화 방식을 열린 질문으로 정한다.
2. `lab/q20/repo/.github/workflows/judge-codex.yml`: 판정 job(`judge-codex`)과 저장 job(`codex-auth-store`, `needs: judge`). Codex 작업은 concurrency group으로 하나씩 실행한다.
   - `codex exec`를 읽기 전용 샌드박스, 승인 없음, 비대화로 `pr/`에서 실행한다. 쓸 옵션은 설치한 버전의 도움말로 확인해 기록한다.
   - step4와 같은 유출 검사를 붙인다.
3. 항목 `judge-codex`: step4의 공격 overlay를 Codex 판정에도 적용한다.
4. 항목 `codex-auth`의 사례
   - 비대화 실행이 되는지
   - 실행 뒤 `auth.json`이 바뀌는지(갱신 시점·필드). 값은 기록하지 않고 해시와 필드 이름만 기록한다
   - 재저장된 인증으로 다음 실행이 되는지
   - concurrency group이 동시 실행을 하나씩 처리하는지
   - 사용량 한도에 걸릴 때의 동작: 일부러 소진하지 않는다. 문서 근거와 오류 처리 경로만 기록하고 판정은 `n/a` 또는 `partial`
5. 결과를 `lab/q20/results/judge-codex.json`, `lab/q20/results/codex-auth.json`에 기록한다. 비대화 실행이나 재저장이 안 되면 E3 재결정을 열린 질문으로 올린다(설계서 13.3절).

## Acceptance Criteria

```bash
node lab/q20/report.ts --item judge-codex
node lab/q20/report.ts --item codex-auth
```

## 금지사항

- `auth.json` 내용이나 토큰 일부를 출력·커밋하지 마라. 이유: 제작자 구독 자격증명이다.
- concurrency group 없이 동시 실행을 시험하지 마라. 이유: 토큰 갱신이 충돌하면 제작자 계정 로그인이 풀릴 수 있다.
- 사용량 한도를 일부러 소진하지 마라. 이유: 제작자의 대화형 사용과 한도를 공유한다(13.3절).
