# Step 2: judge-codex

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-cross-review/plan.md` (수용 기준 4·5·7)
- `docs/harness/design.md` 10.4절 "Codex 샌드박스"·"Codex 인증 저장 job", 13.3절 Codex 인증(복원·봉인·재저장·동시 실행 제한·갱신)
- step0·1이 만든 파일: `scripts/ci/{verdict,review-plan,review-input,claude-scan,record}.ts`, `.github/workflows/judge-claude.yml`
- Q20 소스: `git show 7b837e7:lab/q20/repo/.github/workflows/judge-codex.yml`, `lab/q20/repo/judge/{codex-auth.mjs,codex-scan.mjs,codex-probe.sh,codex-prompt.md}`, `lab/q20/test/{codex-auth,codex-scan}.test.ts`, `lab/q20/results/{judge-codex,codex-auth}.json`

## 작업

1. `scripts/ci/codex-auth.ts`(Q20 `codex-auth.mjs` 이식, `age` 제외): `restore`(환경 변수 → `<home>/auth.json` 0600), `snapshot`·`diff`(필드 이름과 해시 앞 8자만 출력), `config`(판정용 `config.toml`: 권한 프로필 읽기 거부 목록, 기능 끄기, 프로젝트 불신, `project_doc_max_bytes = 0`, 셸 환경 최소. 거부 폴더가 `pr/`의 조상·자신이면 실패), `seal`(libsodium sealed box, 모듈 폴더는 인자). `harness.ts codex-auth <하위 명령> …`.
2. `scripts/ci/codex-probe.sh`(Q20 이식 + 판정): 같은 설정의 샌드박스에서 `pr/` 읽기는 되고, 쓰기 반영·인증 파일·`RUNNER_TEMP`·`base/`·홈 설정 읽기·네트워크·sudo·조상 프로세스 환경 읽기는 안 되는지 종료 코드로만 잰다. 기대와 하나라도 다르면 0이 아닌 코드로 끝나 판정 단계가 돌지 않는다.
3. `scripts/ci/codex-scan.ts`(Q20 `codex-scan.mjs` 이식): `codex exec --json` 이벤트·마지막 메시지·stderr에서 비밀(실행 전 시크릿과 실행 뒤 `auth.json`의 토큰)과 `pr/` 밖을 가리킨 명령, 허용 밖 항목 종류, `turn.failed`를 본다. `export function scanCodexRun(...)`은 `scanClaudeRun`과 같은 결과 형태. `harness.ts codex-scan …`.
4. `.github/workflows/judge-codex.yml`: `on: workflow_run: workflows: [check]`, 워크플로 단위 `concurrency: { group: codex-auth, cancel-in-progress: false, queue: max }`.
   - `plan`(비밀 없음) → `pubkey`(`codex-auth-store`, `permission-environments: read`, `plan.outputs.codex == 'true'`) → `judge`(`judge-codex`: bubblewrap·Codex 0.167.2·libsodium 설치, 복원, 설정, 샌드박스 준비, 사전 측정, `codex exec --json --ephemeral --ignore-rules --output-schema`, `codex-scan`, `if: always()` 봉인) → `store`(`codex-auth-store`, `permission-environments: write`, 공개키 id 일치 확인 뒤 등록) → `record`(`recorder`, `review/codex`).
   - 프롬프트는 step0의 공통 `prompt.md`에 Codex용 꼬리말(셸은 읽기 명령만)을 붙인다.
5. 테스트: `scripts/test/codex-auth.test.ts`·`codex-scan.test.ts`(Q20 사례 이식. 봉인은 libsodium 없이 인자 검증까지만), 워크플로 불변식(environment가 job마다 하나, `queue: max`, 봉인 단계 `always()`, 저장 job에 LLM·체크아웃 없음, SHA 고정, 캐시 없음, run 블록 표현식 없음).
6. 문서: 설계서 13.3절에 구현 위치, `docs/SECURITY.md` 자격증명 표 확인, `architecture.md`, `CHANGELOG`. step1 PR 이후 실제 `review/claude` 기록을 진행 로그에.

## Acceptance Criteria

```bash
node --test scripts/test/codex-auth.test.ts scripts/test/codex-scan.test.ts scripts/test/ci.test.ts
grep -q "queue: max" .github/workflows/judge-codex.yml
grep -q "environment: codex-auth-store" .github/workflows/judge-codex.yml
grep -q "export function scanCodexRun" scripts/ci/codex-scan.ts
test -f scripts/ci/codex-probe.sh
```

## 금지사항

- 판정 job이 `codex-auth-store`를 참조하거나, 저장 job이 봉인값을 풀게 하지 마라. 이유: 13.3절. 평문은 판정 러너 밖으로 나가지 않는다.
- Codex 내장 `read-only` 샌드박스를 쓰지 마라. 이유: 인증 파일을 포함해 파일 시스템 전체를 읽는다(Q20).
- 거부 목록에 `pr/`의 조상이나 `pr/` 자신을 넣지 마라. 이유: Linux에서 `pr/` 읽기까지 막힌다(Q20).
- concurrency를 job 단위로 걸지 마라. 이유: 다음 실행의 판정이 앞 실행의 저장보다 먼저 시작해 옛 인증으로 돈다.
- 인증 값·그 조각·해시 전체를 출력하지 마라. 이유: 필드 이름과 sha256 앞 8자만 허용한다.
- `codex logout`을 쓰지 마라. 이유: 토큰을 폐기할 수 있다.
