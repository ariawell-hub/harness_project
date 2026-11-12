---
id: 20261112-r8-adr-review
issue: 37 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-12T16:23:53+09:00
---

# docs: R8 문서 검토 경고(ADR-0001·0003·0005·0006) 정리

- 목표: `doc-lint`의 R8 검토 경고 4건(ADR-0001·0003·0005·0006)을 정리한다. 각 ADR이 지금 코드와 맞는지 검토하고, 틀리면 고치고, 맞으면 검토 기록을 남긴다.
- 변경: 각 ADR 끝에 "## 검토 기록" 한 줄(검토한 변경 PR, 확인한 사실, 결론). 반복 경고 문제는 TD로 등록한다.
- 검증: ! node scripts/harness.ts doc-lint 2>&1 | grep "R8 검토 필요" | grep -q "docs/decisions/"

## 관련 파일·문서

- `docs/decisions/ADR-0001-script-language.md`, `docs/decisions/ADR-0003-bot-token-classic-pat.md`
- `docs/decisions/ADR-0005-windows-native.md`, `docs/decisions/ADR-0006-pr-update-merge.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/active/20261112-r8-adr-review.md`

## 진행 로그

- 2026-11-12 16:24 (KST) `new-task --issue 37 --slug r8-adr-review --size small --type docs`.
- 2026-11-12 16:24 (KST) 검토 결과(main `2a08b64` 기준). 네 ADR 모두 서술이 코드와 맞아 본문은 고치지 않는다.
  - ADR-0001(`scripts/`, `package.json`, `tsconfig.json`): ADR 뒤 변경 13건은 모두 `scripts/` 안의 기능 변경이다. `package.json`·`tsconfig.json`은 그대로(`engines.node >=22.18.0`, devDependencies `typescript`·`prettier`·`@types/node`, `erasableSyntaxOnly`). `scripts/`에 `node:`·상대 경로 밖 import와 `enum`·`namespace`가 없다.
  - ADR-0003(`harness.config.json`): ADR 뒤 변경은 `github.collaborators`(#15), `.gitattributes` 보호 경로(#9), runner Claude 인자에서 `--no-session-persistence` 제거(#20). 봇 계정(`github.bot: ariawell247`)·토큰 결정과 무관하다.
  - ADR-0005(`scripts/lib/exec.ts`, `scripts/hooks/`, `scripts/runner/`, `scripts/commands/task.ts`): Git Bash 실행·WSL bash 거부(`exec.ts`), `.cmd` 래퍼 거부(`agents.ts`), PowerShell·cmd 방언과 Windows 삭제·토큰 변수 규칙(`hooks/`), `.env` 심볼릭 → 하드 링크(`task.ts`), runner 권한 프로필의 `PowerShell` 거부가 그대로다. ADR 뒤 변경(#14~#34)은 R3 판정, 세션 기록, PR 갱신, force push 제거, 선점 해제, 열린 질문으로 Windows 결정과 무관하다.
  - ADR-0006(`scripts/runner/`, `scripts/lib/git.ts`, `scripts/hooks/rules.ts`): ADR 마지막 갱신(#28) 뒤 변경은 #31(선점 해제, `next.ts` claim 목록)과 #34(열린 질문)다. `updateBranchFromBase`·`doUpdate`·`pickNext`의 `BEHIND`·`DIRTY` 처리와 force push 없음이 그대로다.
- 2026-11-12 16:25 (KST) ADR 4건에 검토 기록을 커밋하자 ADR 경고는 0건이 됐지만 `workflow.md` 경고가 새로 떴다. `workflow.md`의 `related_code`에 `docs/exec-plans/`가 있어 계획 파일을 커밋하는 PR마다 뜬다. 내용은 #34에서 갱신해 지금 코드와 맞으므로(1절 선점·5절 main 병합 갱신·7절 runner 질문) 검토 기록으로 덮지 않고 TD-25에 묶었다. 검증을 ADR 경고 기준으로 고쳤다.

## 발견 사항

- R8 검토 경고는 `related_code`의 마지막 커밋이 문서보다 새로우면 뜬다. ADR-0001(`scripts/`)·ADR-0005·ADR-0006(`scripts/runner/` 등)처럼 범위가 넓으면 결정과 무관한 코드 변경마다 다시 뜬다(이번에 정리해도 다음 runner 수정 PR에서 다시 생긴다). `workflow.md`는 `related_code`에 `docs/exec-plans/`가 있어 계획 파일을 더하는 거의 모든 PR 뒤에 뜬다. 범위를 결정이 걸린 파일로 좁히면 줄지만 검사 범위를 줄이는 일이라 이 작업에서 정하지 않는다 → 처리: TD-25
