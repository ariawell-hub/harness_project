# Step 1: revert-command

이 step은 대화 세션이 실행한다(제작자 대화 결정에 따른 보안 되돌리기).

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-r5-fail-first/plan.md` (수용 기준 1, 진행 로그 2026-11-17 step1, 의사결정 로그의 되돌리기 결정)
- step0이 main에 넣은 변경: `git show --stat c5126bd` (PR #112). 계획 폴더 밖의 파일은 `scripts/commands/fail-first.ts`, `scripts/test/fail-first.test.ts`, `scripts/harness.ts`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/harness/design.md` 13.1절(L1 훅), `scripts/hooks/shell.ts`(훅이 안쪽 명령을 다시 판정하는 경우: `bash -c`, `eval`)

## 작업

1. `c5126bd`가 계획 폴더(`docs/exec-plans/`) 밖에 넣은 변경을 되돌린다.
   - `scripts/commands/fail-first.ts`와 `scripts/test/fail-first.test.ts`를 지운다.
   - `scripts/harness.ts`에서 `fail-first` 명령(case), 도움말 두 줄, `--exempt` 옵션, 이 명령만 쓰던 import를 뺀다. 다른 명령은 건드리지 않는다.
   - `docs/harness/architecture.md`의 명령 목록에서 `fail-first`를 빼고, 테스트 절에 더한 `NODE_TEST_CONTEXT` 문장에서 지워진 파일 이름(`fail-first.test.ts`)만 뺀다(문장은 남긴다. 사실이고 step2가 다시 쓴다).
   - 계획 폴더는 되돌리지 않는다.
2. `docs/harness/CHANGELOG.md`: step0의 줄을 지우지 않고 그 뒤에 되돌린 사실과 이유를 한 줄로 더한다(인자를 셸로 실행하는 명령이 L1 훅의 우회로가 됐다, 훅이 판정하지 못한 규칙, 다시 만드는 방식은 step2).
3. 확인: 되돌린 뒤 `node scripts/harness.ts fail-first x`는 "알 수 없는 명령"으로 끝난다. `scripts/`에 `fail-first`를 가리키는 코드가 남지 않는다.
4. 이 step은 코드와 그 테스트를 지우는 일이라 먼저 실패할 테스트가 없다. PR의 R5 줄에 그 사유를 적는다.

## Acceptance Criteria

```bash
test ! -e scripts/commands/fail-first.ts
test ! -e scripts/test/fail-first.test.ts
! grep -rq "fail-first" scripts
grep -q "fail-first" docs/harness/CHANGELOG.md
node --test scripts/test/cli.test.ts
node scripts/harness.ts doc-lint
```

## 금지사항

- 이 step에서 기록 명령을 다른 방식으로 다시 만들지 마라. 이유: 되돌리기는 작고 빨리 병합돼야 한다. 다시 만드는 일은 step2다.
- `git revert`로 계획 폴더까지 되돌리지 마라. 이유: 결함의 경위와 결정이 적힌 계획이 main에서 빠진다.
- `revert/<SHA>` 브랜치를 쓰지 마라. 이유: `revert-check`는 main `check`가 실패한 커밋만 인정한다(10.3절). 이 되돌리기는 계획 브랜치의 일반 PR이다.
- L1 훅(`scripts/hooks/`)과 자체 테스트(`scripts/selftest/`)를 고치지 마라. 이유: 계획의 비범위다. 명령이 없어지면 우회로도 없어진다.
- 금지 명령을 실제로 실행해 우회를 재현하지 마라. 이유: R20·R2·R14. 훅의 판정(종료 코드)만 본다.
