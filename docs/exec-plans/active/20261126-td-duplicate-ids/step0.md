# Step 0: unique-ids

## 읽어야 할 파일

- `ARCHITECTURE.md`, `docs/harness/architecture.md`(`gates/*` 줄)
- `scripts/gates/doc-lint.ts`의 `docLint`(1~6번 검사, `Problem` 꼴, `DOC`)
- `scripts/test/changes.test.ts`의 `lintRepo`·`lint` 도우미(임시 리포에서 `docLint`를 부르는 꼴)
- `docs/exec-plans/tech-debt-tracker.md` 76~79행
- `docs/exec-plans/completed/20261125-symlink-main/plan.md` 발견 사항, `docs/harness/changes/20261125-symlink-main-s0.md`
- 계획 `docs/exec-plans/active/20261126-td-duplicate-ids/plan.md`의 수용 기준

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **테스트**: 새 파일 `scripts/test/doc-lint-td-ids.test.ts`. 임시 리포(설정·`AGENTS.md`·`docs/index.md`가 표를 가리키는 꼴)에 기술 부채 표를 두고 `docLint`를 부른다.
   - 같은 id가 두 행에 있으면 `R8 기술 부채 id` 오류가 하나 나고, 글에 그 id와 두 행 번호(1부터)가 있다. id 둘이 각각 겹치면 오류가 둘이다.
   - id가 모두 다르면 이 규칙의 오류가 없다. 표 밖의 글(본문, 코드 블록이 아닌 문단)에 같은 id를 적은 것은 세지 않는다.
   - 표가 `docLint`의 검사 대상 목록(`files`: git이 나열한 Markdown 파일에서 `docLint.exclude`를 뺀 것)에 없으면 이 규칙을 보지 않는다. 테스트는 두 경우를 본다: (ㄱ) 표 파일을 만들지 않는다(이 규칙의 오류가 없고 예외도 없다), (ㄴ) 중복 id를 담은 표 파일을 두고 그 경로를 `docLint.exclude`에 넣는다(이 규칙의 오류가 없다). 색인 링크가 빠진 것은 이 규칙의 조건이 아니다(색인 누락은 있던 `R8 색인 누락`이 본다).
2. **구현**: `scripts/gates/doc-lint.ts`의 `docLint` 끝에 7번 검사. `docs/exec-plans/tech-debt-tracker.md`가 `files`에 있으면 줄마다 `^\| (TD-\d+) +\|`의 id를 모으고, 두 번 이상 나온 id마다 오류 하나(`rule: 'R8 기술 부채 id'`, `what`에 id와 행 번호들, `how`에 "나중에 더한 행을 다음 빈 번호로 옮기고 그 행을 가리키는 참조를 맞춰라").
3. **표와 참조**: `docs/exec-plans/tech-debt-tracker.md`에서 #246의 두 행(`lab/` 스크립트 행의 TD-70 → TD-76, 시간 비율 테스트 행의 TD-71 → TD-77)의 id만 바꾼다(행의 자리와 다른 칸은 그대로). `docs/exec-plans/completed/20261125-symlink-main/plan.md` 발견 사항의 `→ 처리: TD-70`을 `TD-76`으로, `→ 처리: TD-71`을 `TD-77`로, `docs/harness/changes/20261125-symlink-main-s0.md`의 같은 참조를 새 번호로 바꾼다.
4. **기록**: 변경 조각 `docs/harness/changes/20261126-td-duplicate-ids-s0.md`에 CHANGELOG 한 줄(Issue #251, 옮긴 번호, 새 `doc-lint` 검사).

## Acceptance Criteria

```bash
node --test scripts/test/doc-lint-td-ids.test.ts scripts/test/changes.test.ts scripts/test/doc-lint-design-version.test.ts scripts/test/doc-lint-gate.test.ts
test -z "$(grep -oE '^\| TD-[0-9]+ ' docs/exec-plans/tech-debt-tracker.md | sort | uniq -d)"
grep -qE '^\| TD-76 +\| `lab/`의 스크립트 7개' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-77 +\| `scripts/test/wrapper-options.test.ts`의 시간 비율 테스트' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-70 +\| Windows에서 `check` 캐시 키' docs/exec-plans/tech-debt-tracker.md
grep -qE '^\| TD-71 +\| Windows에서 하네스 테스트가 느린 몫' docs/exec-plans/tech-debt-tracker.md
grep -qF '→ 처리: TD-76' docs/exec-plans/completed/20261125-symlink-main/plan.md && grep -qF '→ 처리: TD-77' docs/exec-plans/completed/20261125-symlink-main/plan.md
grep -qF 'TD-76' docs/harness/changes/20261125-symlink-main-s0.md
test -z "$(grep -E 'TD-7[01]([^0-9]|$)' docs/harness/changes/20261125-symlink-main-s0.md docs/exec-plans/completed/20261125-symlink-main/plan.md)"
git diff --quiet "$(git merge-base HEAD origin/main)" HEAD -- docs/exec-plans/completed/20261123-windows-test-speed
grep -qF "'R8 기술 부채 id'" scripts/gates/doc-lint.ts
grep -qF 'Issue #251' docs/harness/changes/20261126-td-duplicate-ids-s0.md
node scripts/harness.ts doc-lint
node scripts/harness.ts check
```

## 금지사항

- #236이 더한 TD-70·71 행과 그 참조(`docs/exec-plans/completed/20261123-windows-test-speed/`)를 바꾸지 마라. 이유: 먼저 병합된 번호다.
- TD-72~75를 쓰지 마라. 이유: 열린 PR(#242, #229)이 쓴다.
- 표의 다른 행·칸, 행의 차례를 바꾸지 마라. 이유: 범위 밖이고 diff가 커진다.
- 중복 id를 경고로만 내지 마라. 이유: 경고는 병합을 막지 않아 이번 같은 중복을 다시 놓친다.
