# Step 0: revert-command

이 step은 대화 세션이 실행한다(제작자 대화 결정에 따른 보안 되돌리기).

## 읽어야 할 파일

- `docs/exec-plans/active/20261117-revert-fail-first/plan.md` (수용 기준, 진행 로그, 의사결정 로그)
- 옛 계획 `docs/exec-plans/active/20261117-r5-fail-first/`(step0이 PR #112로 병합됐고 step1은 시작하지 않았다)
- 옛 계획의 step0이 main에 넣은 변경: `git show --stat c5126bd` (PR #112). 계획 폴더 밖의 파일은 `scripts/commands/fail-first.ts`, `scripts/test/fail-first.test.ts`, `scripts/harness.ts`, `docs/harness/architecture.md`, `docs/harness/CHANGELOG.md`
- `docs/harness/design.md` 13.1절(L1 훅), `scripts/hooks/shell.ts`(훅이 안쪽 명령을 다시 판정하는 경우: `bash -c`, `eval`)

## 작업

1. `c5126bd`가 계획 폴더(`docs/exec-plans/`) 밖에 넣은 변경을 되돌린다.
   - `scripts/commands/fail-first.ts`와 `scripts/test/fail-first.test.ts`를 지운다.
   - `scripts/harness.ts`에서 `fail-first` 명령(case), 도움말 두 줄, `--exempt` 옵션, 이 명령만 쓰던 import를 뺀다. 다른 명령은 건드리지 않는다.
   - `docs/harness/architecture.md`의 명령 목록에서 `fail-first`를 빼고, 테스트 절에 더한 `NODE_TEST_CONTEXT` 문장에서 지워진 파일 이름(`fail-first.test.ts`)만 뺀다(문장은 남긴다. 사실이다).
   - 옛 계획 폴더의 파일 내용은 되돌리지 않는다(아래 3번에서 폐기 처리만 한다).
2. `docs/harness/CHANGELOG.md`: 옛 계획 step0의 줄을 지우지 않고 그 뒤에 되돌린 사실과 이유를 한 줄로 더한다. 줄은 "`fail-first` 명령을 되돌렸다"로 시작한다(인자를 셸로 실행하는 명령이 L1 훅의 우회로가 됐다, 훅이 판정하지 못한 규칙, 기록 명령은 후속 계획에서 다시 설계한다).
3. 옛 계획 `20261117-r5-fail-first`를 폐기한다(설계서 8.3절): frontmatter `status: abandoned`, 진행 로그에 한 줄(폐기 이유, 되돌리는 계획의 id, 기록 명령은 같은 Issue의 후속 계획에서 다시 설계한다는 것), 폴더를 `docs/exec-plans/completed/`로 옮긴다(`git mv`). 그 계획의 핵심 섹션·step 파일·`index.json`은 고치지 않는다.
4. 확인: 되돌린 뒤 `node scripts/harness.ts fail-first x`는 "알 수 없는 명령"으로 끝난다. `scripts/`에 `fail-first`를 가리키는 코드가 남지 않는다.
5. 이 step은 코드와 그 테스트를 지우는 일이라 먼저 실패할 테스트가 없다. PR의 R5 줄에 그 사유를 적는다.

## Acceptance Criteria

```bash
test ! -e scripts/commands/fail-first.ts
test ! -e scripts/test/fail-first.test.ts
! grep -rq "fail-first" scripts
grep -q "명령을 되돌렸다" docs/harness/CHANGELOG.md
! grep -q "fail-first" docs/harness/architecture.md
node --test scripts/test/cli.test.ts
test -f docs/exec-plans/completed/20261117-r5-fail-first/plan.md
grep -q "^status: abandoned" docs/exec-plans/completed/20261117-r5-fail-first/plan.md
test ! -e docs/exec-plans/active/20261117-r5-fail-first
node scripts/harness.ts doc-lint
```

## 금지사항

- 이 step에서 기록 명령을 다른 방식으로 다시 만들지 마라. 이유: 되돌리기는 작고 빨리 병합돼야 한다. 다시 만드는 일은 후속 계획이다(PR #114에서 재설계와 한 계획에 묶었다가 계획 검증이 세 라운드 동안 수렴하지 않았다).
- `git revert`로 옛 계획 폴더까지 되돌리지 마라. 이유: 옛 계획의 기록(계획 검증 경위, step0의 진행 로그)이 main에서 빠진다. 폐기 처리로 남긴다.
- `revert/<SHA>` 브랜치를 쓰지 마라. 이유: `revert-check`는 main `check`가 실패한 커밋만 인정한다(10.3절). 이 되돌리기는 계획 브랜치의 일반 PR이다.
- L1 훅(`scripts/hooks/`)과 자체 테스트(`scripts/selftest/`)를 고치지 마라. 이유: 계획의 비범위다. 명령이 없어지면 우회로도 없어진다.
- 금지 명령을 실제로 실행해 우회를 재현하지 마라. 이유: R20·R2·R14. 훅의 판정(종료 코드)만 본다.
