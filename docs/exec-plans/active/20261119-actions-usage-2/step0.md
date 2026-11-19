# Step 0: reuse-and-repro

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`
- `scripts/commands/check.ts`, `scripts/test/check-skip.test.ts`(PR #130의 건너뛰기와 그 테스트 도구)
- `scripts/ci/repro.ts`, `scripts/ci/verdict.ts`, `scripts/ci/ledger.ts`(재현 결과가 동결 판단에 쓰이는 곳)
- `.github/workflows/check.yml`, `judge-claude.yml`, `judge-codex.yml`, `revert.yml`
- `scripts/test/ci.test.ts`(워크플로 구조 단언), `scripts/gates/harness-guard.ts`(`reproJobViolations`)
- 설계서 6절(`test` 건너뛰기), 10.2절 (3), 10.3·10.4절, `docs/SECURITY.md`

## 작업

테스트를 먼저 쓴다(R5). 구현 전에 새 단언이 실패하는 것을 확인해 진행 로그에 적는다.

1. 재현 job의 조건부 실행 (가)
   - 판정에 재현 테스트가 있는지 돌려주는 함수를 둔다(`scripts/ci/repro.ts`의 `hasRepro(verdict): boolean`. 지적의 `repro.content`가 빈 문자열이 아닌 것이 하나라도 있으면 참).
   - `scripts/harness.ts`의 `codex-scan`·`claude-scan`이 판정 파일을 쓴 뒤 `GITHUB_OUTPUT`이 있으면 `repro=true|false` 한 줄을 덧붙인다. `GITHUB_OUTPUT`이 없으면(로컬) 쓰지 않는다. 판정을 내보내지 못하고 끝나는 경로에서는 쓰지 않는다.
   - `runRepro`와 기록 쪽(`parseReproResults`, 원장)은 바꾸지 않는다.

2. main의 `test` 재사용 (나)
   - `scripts/ci/test-reuse.ts`: 조건 판정 함수와 API 포트를 둔다. 포트는 넷이다: 커밋에 연결된 PR 목록, 커밋의 트리 SHA, 두 커밋의 비교(`behind_by`), head SHA의 `check` 워크플로 실행 목록. 판정 함수는 계획의 수용 기준 3의 (a)~(g)를 순서대로 확인하고 `{ reuse: boolean, reason: string }`을 돌려준다. 포트가 실패하거나(예외·null) 응답에 필요한 값이 없으면 `reuse: false`다. `reason`에는 토큰이나 응답 본문을 넣지 않는다.
   - (g)는 `scripts/commands/check.ts`의 `testInert`로 판정한다. 기존 `testSkip`의 조건과 결과는 바꾸지 않는다.
   - `runCheck`: 옵션으로 재사용 판정 함수를 받는다(없으면 재사용하지 않는다). `test` 단계 직전에 한 번 부르고, 재사용이면 `– test (건너뜀)`과 근거를 출력한다. 건너뛴 실행은 캐시에 쓰지 않는다(CI는 원래 쓰지 않는다).
   - `scripts/harness.ts`의 `check`: `--ci`이고 `HARNESS_REUSE_TOKEN`이 있을 때만 실제 포트(`gh api`, 그 호출에만 토큰을 준다)를 만들어 넘긴다. 토큰은 읽자마자 `process.env`에서 지운다. `--ci`가 아니면 읽지 않고 지운다.
   - 실제 포트는 읽기 호출(GET)만 한다. 리포 이름은 `GITHUB_REPOSITORY`에서 읽는다.

3. 워크플로 패치 `lab/actions-usage-2/workflows.patch` (`git diff` 형식. 봇은 대상 파일을 커밋하지 않는다)
   - `judge-claude.yml`, `judge-codex.yml`: `judge` job의 출력에 `repro: ${{ steps.scan.outputs.repro }}`를 더하고, `repro` job의 조건을 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`로 바꾼다. 그 밖의 줄은 바꾸지 않는다.
   - `check.yml`: `permissions`에 `actions: read`, `pull-requests: read`를 더하고, `check` 단계의 `env`에 `HARNESS_REUSE_TOKEN: ${{ github.event_name == 'push' && github.token || '' }}`를 더한다. 머리 주석에 이유를 적는다.
   - `scripts/test/ci.test.ts`: 위 줄을 단언하는 부분만 새 내용에 맞춘다(패치에 함께 넣는다. 패치 전의 워크플로에서는 지금 단언이 통과해야 하므로 봇의 커밋에는 넣지 않는다).
   - `lab/actions-usage-2/README.md`: 적용 명령(`git apply`, 커밋, push)과 적용 뒤 확인 방법을 적는다.
   - 임시 클론(`mktemp -d`)에서 패치를 적용하고 `check`를 돌려 통과를 확인한다.

4. 문서
   - 설계서: 6절에 main의 `test` 재사용(조건 (a)~(g), 근거, 켜는 방법)을, 10.2절 (3)·10.3절에 재현 job의 조건을, 10.4절에 `check.yml` 토큰 권한과 그 토큰이 닿는 범위를, 5절 R4 표에 예외를 적는다. 버전과 변경 이력.
   - 절차서 4절, `docs/SECURITY.md`(워크플로 변경 절차: 봇의 PR 브랜치에 제작자가 패치 커밋을 더한다. 해 본 결과대로 적는다), `CHANGELOG`.
   - 기술 부채 표 TD-49: 후보를 다시 본 결과(④는 조건부 실행으로, ⑤와 `store`는 하지 않는 이유), CI에서 `testInertPaths` 건너뛰기를 관찰한 결과(계획 전용 push의 `check` 로그와 소요 시간).

5. PR과 제작자 작업
   - 초안으로 올린다. 판정이 통과하면 완료 처리·기록·`origin/main` 병합·`check`를 끝낸 뒤, 제작자에게 **한 번에** 요청한다: ① 열린 질문의 답, ② `lab/actions-usage-2/README.md`의 명령으로 패치 커밋을 이 브랜치에 올리기, ③ 그 head의 판정이 통과하면 승인. `pr-ready`는 패치 커밋의 판정이 통과한 뒤에 실행한다.
   - 패치 커밋이 올라간 뒤에는 봇이 이 브랜치에 push하지 않는다. 그 뒤에 고칠 것이 생기면 제작자에게 먼저 알린다.

6. 병합 뒤 확인(Issue #135 댓글): 계획의 "검증 방법과 결과"의 병합 뒤 항목 ①②를 실제 실행에서 보고 run 링크와 소요 시간을 남긴다. 기대와 다르면 Issue를 등록한다.

## Acceptance Criteria

```bash
node --test scripts/test/test-reuse.test.ts scripts/test/check-skip.test.ts scripts/test/ci.test.ts
git apply --check lab/actions-usage-2/workflows.patch
node scripts/harness.ts doc-lint
```

## 금지사항

- `.github/workflows/`의 파일을 커밋하지 마라. 이유: 봇 토큰에 `workflow` 권한이 없어 브랜치 전체의 push가 거부된다. 패치 파일로만 준비한다.
- `test`를 건너뛰게 하는 명령 옵션이나 "확인됨"을 받는 환경 변수를 만들지 마라. 이유: 로컬에서 쓸 수 있는 우회로가 된다(R4).
- 조건을 확인하지 못한 경우를 재사용으로 처리하지 마라. 이유: 모르면 돌리는 것이 지금 동작이고, 틀린 재사용은 main의 실패를 가린다.
- 토큰을 로그·출력·`reason`에 넣거나 하위 프로세스 환경에 남기지 마라. 이유: `test`는 의존성 코드를 실행한다.
- job을 합치거나 environment·권한 경계를 바꾸지 마라(`check.yml`의 읽기 권한 두 개 말고). 이유: 10.4절의 격리.
- 기존 `testInertPaths` 건너뛰기의 조건을 넓히지 마라. 이유: 이 step의 범위가 아니다.
- PR 판정이 도는 중에 PR 본문을 고치지 마라. 이유: `gates`가 다시 돈다(절차서 5절).
