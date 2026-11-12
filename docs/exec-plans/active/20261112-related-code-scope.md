---
id: 20261112-related-code-scope
issue: 39 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-12T16:48:16+09:00
---

# docs: 문서 related_code를 내용이 기대는 파일로 좁힌다 (TD-25)

- 목표: R8 검토 경고가 결정·내용과 무관한 변경마다 다시 뜨지 않게, ADR-0001·0005·0006과 `workflow.md`의 `related_code`를 내용이 실제로 기대는 파일로 좁힌다(제작자 결정, 2026-11-12 대화 "추천대로 진행"). 설계서 7.2절에 작성 기준을 적고 TD-25를 해결로 바꾼다.
- 변경: ADR-0001 `[package.json, tsconfig.json]`, ADR-0005 `[scripts/lib/exec.ts, scripts/hooks/shell.ts, .gitattributes]`, ADR-0006 `[scripts/lib/git.ts]`, `workflow.md` `[scripts/commands/, scripts/runner/, docs/exec-plans/TEMPLATE*.md]`. 설계서 v0.7.11(7.2절 frontmatter), CHANGELOG, TD-25.
- 검증: ! node scripts/harness.ts doc-lint 2>&1 | grep -q "R8 검토 필요" && grep -q "^related_code: \[package.json, tsconfig.json\]" docs/decisions/ADR-0001-script-language.md && ! grep -q "docs/exec-plans/\]" docs/harness/workflow.md && grep -q "v0.7.11" docs/harness/design.md

## 관련 파일·문서

- `docs/decisions/ADR-0001-script-language.md`, `docs/decisions/ADR-0005-windows-native.md`, `docs/decisions/ADR-0006-pr-update-merge.md`
- `docs/harness/workflow.md`, `docs/harness/design.md`, `docs/harness/CHANGELOG.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261112-related-code-scope.md`

## 진행 로그

- 2026-11-12 16:48 (KST) `new-task --issue 39 --slug related-code-scope --size small --type docs`. 문서 frontmatter와 설계서 문구만 바꾸고 동작 변경은 없다.
- 2026-11-12 16:48 (KST) 후보 경로의 변경 빈도(전체 커밋 25개 중): `docs/exec-plans/` 25, `scripts/runner/` 11, `scripts/runner/run.ts` 8, `scripts/commands/` 6, `scripts/hooks/rules.ts` 5, `scripts/lib/git.ts` 4, `scripts/runner/agents.ts` 4, `scripts/commands/task.ts` 3, `exec.ts`·`shell.ts`·`runner-settings.json` 각 2, `package.json`·`tsconfig.json`·`.gitattributes`·템플릿 각 1.

- 2026-11-12 16:52 (KST) 첫 시도에서 ADR-0005·`workflow.md` 줄이 100자를 넘어 Prettier가 여러 줄 배열로 바꿨고 doc-lint가 "related_code가 배열이 아니다" 오류를 냈다. ADR-0005는 세 경로로, `workflow.md`는 템플릿 글롭으로 줄였다.

## 의사결정 로그

- 결정: `related_code`는 "이 파일이 바뀌면 문서가 틀릴 수 있는가"로 고른다. 폴더 전체·계획 폴더처럼 다른 이유로 자주 바뀌는 경로는 넣지 않는다. / 이유: 무관한 변경마다 경고가 뜨면 검토 없이 지나치게 되어 R8 경고 자체가 묻힌다. / 버린 대안: 지금 범위 유지 + 매번 검토 기록(경고가 PR마다 반복된다, Issue #37), 경고를 끄거나 ADR을 R8에서 빼기(R4 검사 약화).
- 결정: ADR-0001은 `package.json`·`tsconfig.json`만. / 이유: 결정(TypeScript, Node 22.18+, 런타임 의존성 없음, `erasableSyntaxOnly`)이 이 두 파일에 고정된다. 런타임 의존성을 더하거나 Node 버전·타입 제거 설정을 바꾸려면 이 파일이 바뀐다.
- 결정: ADR-0005는 `lib/exec.ts`(셸 선택·Git Bash·WSL 거부), `hooks/shell.ts`(PowerShell·cmd 방언), `.gitattributes`(LF). / 이유: Windows 결정의 중심이 구현·고정된 곳이고 거의 바뀌지 않는다. / 뺀 것: `hooks/rules.ts`의 Windows 규칙과 `commands/task.ts`의 `.env` 하드 링크는 다른 이유로 자주 바뀌는 파일의 일부라 뺐다(회귀는 `guard.test.ts`·`task.test.ts`가 잡는다). `runner/agents.ts`(`.exe` 확인, 4회 변경)와 `.claude/runner-settings.json`(`PowerShell` 거부)은 넣고 싶었지만 한 줄이 100자를 넘으면 Prettier가 여러 줄 배열로 바꾸고, doc-lint frontmatter 파서는 여러 줄 배열을 읽지 못한다(TD-16, 실제로 "related_code가 배열이 아니다" 오류를 확인). 그래서 덜 바뀌고 결정과 직결되는 세 개만 남겼다.
- 결정: ADR-0006은 `lib/git.ts`만. / 이유: PR 브랜치 갱신 방식(main 병합 + 일반 push, 갈라짐 판정)이 `updateBranchFromBase`·`remoteBranchDiverged`에 있다. / 뺀 것: `runner/`(11회)와 `hooks/rules.ts`(5회). R14 차단은 ADR-0006 이전부터 있던 규칙이고 `guard.test.ts`가 지킨다.
- 결정: `workflow.md`는 `scripts/commands/`·`scripts/runner/`를 두고 `docs/exec-plans/`를 `docs/exec-plans/TEMPLATE*.md`(git pathspec 글롭, 템플릿 3개)로 바꾼다. / 이유: 절차서는 명령·runner 절차와 계획 형식(템플릿)을 설명한다. 계획 파일 자체는 모든 PR이 더하므로 경고가 매번 뜬다.
- 결정: ADR-0002·0003, `architecture.md`, `CHANGELOG.md`, `SECURITY.md`는 그대로 둔다. / 이유: 이미 파일 단위이거나(ADR-0003은 파일 하나), 문서가 그 폴더 전체를 설명한다(`architecture.md`=`scripts/` 구조, CHANGELOG=보호 경로 변경 기록).

## 발견 사항

- `related_code`가 100자를 넘으면 Prettier가 여러 줄 YAML 배열로 바꾸고, doc-lint는 그 배열을 읽지 못해 R8 frontmatter 오류가 된다. 이번에는 항목 수를 줄여 피했다. TD-16이 이미 이 경우("지금은 경로를 줄여 피한다")를 적고 있어 내용은 고치지 않는다 → 처리: TD-16
