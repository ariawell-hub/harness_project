---
status: draft
related_code: [.codex/, scripts/runner/agents.ts, scripts/hooks/guard.ts]
review_cycle: on-change
---

# ADR-0002: Codex 훅·샌드박스 지원 범위와 runner 사용 방식

- 날짜: 2026-11-11
- 상태: 일부 확인 (실제 세션 검증은 TD-8)
- 관련: 설계서 Q4, 13.1~13.2절, R20

## 확인한 것 (codex-cli 0.167.0, 이 Mac)

- `codex features list`에서 `hooks`가 stable·켜짐이다.
- 훅 정의 형식은 Claude Code와 같다: `hooks.json`의 `PreToolUse`/`PostToolUse`, `matcher`, `type: command` (번들 플러그인 예시로 확인).
- 훅은 **신뢰(trust)를 저장해야** 실행된다. 자동화용으로 `codex exec --dangerously-bypass-hook-trust`가 있다("훅 출처를 이미 검증한 자동화용").
- 샌드박스: `codex exec --sandbox read-only|workspace-write|danger-full-access`. 메모리는 `features.memories`로 끌 수 있다.

## 결정

- 코어 훅은 하나(`scripts/hooks/guard.ts`)이고, Claude Code와 Codex가 같은 stdin JSON 규약과 종료 코드 2 차단을 쓴다(13.1절). 가드는 Codex의 셸 도구 형식(`command` 배열, `apply_patch` 패치)도 정규화한다.
- 대화형 Codex 세션은 `.codex/hooks.json`을 쓴다. 제작자가 리포를 처음 열 때 훅 신뢰를 한 번 승인한다.
- runner의 Codex 세션은 `--sandbox workspace-write`와 `approval_policy="never"`로 띄우고, 공유 git-dir를 쓰기 허용 경로에 넣는다(worktree 커밋용). `danger-full-access`와 `--dangerously-bypass-approvals-and-sandbox`는 쓰지 않는다.
- 대화형 Codex 세션의 승인 요청(샌드박스 밖 명령 등)은 사람 대신 Codex 자동 검토자(guardian, codex-cli 0.167.2의 `guardian_approval` stable)가 판단한다: `.codex/config.toml`의 `approvals_reviewer = "auto_review"`(제작자 결정, 2026-11-12, Issue #25). 샌드박스(`workspace-write`, 네트워크 꺼짐)와 L1 훅은 그대로다. runner는 `approval_policy="never"`로 띄우므로 영향이 없다.

## 남은 확인 (TD-8)

1. 실제 `codex exec` 세션에서 프로젝트 `.codex/hooks.json`이 로드되고 종료 코드 2가 도구 실행을 막는가.
2. Codex PreToolUse 페이로드의 실제 필드 이름(`tool_name`, `tool_input.command` 배열 여부)이 가드의 정규화와 맞는가.
3. workspace-write 샌드박스에서 worktree 커밋이 되는가(`writable_roots`에 공유 git-dir).
4. 훅 신뢰를 runner에서 어떻게 줄 것인가: (A) 제작자가 한 번 신뢰를 저장, (B) runner가 main 체크아웃의 훅만 가리키게 하고 `--dangerously-bypass-hook-trust`. 확인 전까지 Codex 세션의 R20은 E5로만 지켜진다(Q4 추천안).
5. `approvals_reviewer = "auto_review"`에서 자동 검토자가 어떤 요청을 승인·거절하는지, 거절된 요청이 사람에게 넘어오는지(Issue #25).
