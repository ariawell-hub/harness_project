---
id: 20261120-codex-note-limit
issue: 161 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-20T21:09:34+09:00
---

# Codex 프롬프트의 길이 제한 안내에 빠진 제한(resolutions의 note 등)을 더한다 (TD-54 ③)

- 목표: Codex 검증자가 프롬프트에 없는 길이 제한을 넘겨 판정 전체가 버려지는 일을 막는다(Issue #161, TD-54의 ③). Issue #146의 계획 검증 4라운드에서 `resolutions[].note`가 300자를 넘어 판정 없음이 됐다.
- 변경: `scripts/cross-review/prompt-codex.md`의 길이 제한 줄에 빠진 제한 다섯(`resolutions` 개수, `note` 길이, `repro`의 `path`·`content` 길이, 재현 테스트 개수)을 더한다. 새 테스트 `scripts/test/prompt-limits.test.ts`가 그 줄의 숫자를 `scripts/ci/verdict.ts`의 `LIMITS`와 견준다(`LIMITS`에 키가 늘면 테스트가 안내를 고치라고 실패한다). `LIMITS`의 값과 판정 기준은 바꾸지 않는다. `CHANGELOG` 한 줄, 기술 부채 표 TD-54 행에 ③을 반영했다고 적는다.
- 검증: node --test scripts/test/prompt-limits.test.ts
- 그 밖의 검증: `node scripts/harness.ts check`.

## 관련 파일·문서

- `scripts/cross-review/prompt-codex.md`, `scripts/test/prompt-limits.test.ts`(새 파일)
- `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-54 행)
- 읽기만: `scripts/ci/verdict.ts`(`LIMITS`)

## 진행 로그

- 2026-11-20 21:10 제작자 대화 지시("추천안이 모두 합리적으로 보인다. 그대로 진행해달라": TD-54의 ③ → TD-60 → Issue #155의 1단계 → TD-54의 ② 순서)로 봇이 Issue #161을 등록하고 시작했다.
- 2026-11-20 21:10 테스트만 담은 커밋 `b071067`. 구현 전 실패 확인: `prompt-limits.test.ts`가 "resolutions: 안내에 `resolutions` 60개가 없다"로 단언 실패한다.
- 2026-11-20 21:10 안내 줄을 고쳤다. 테스트 통과. `CHANGELOG` 한 줄과 TD-54 행(③ 반영, 제작자 결정)을 적었다.
- 2026-11-20 21:33 PR #162 구현 판정 1라운드(head `1c83102`): 두 검증자 승인. codex의 F1(P2, 미룸)은 재현 테스트 개수가 공통 프롬프트 `prompt.md`에도 적혀 있어 한쪽만 고치면 어긋난다는 것이다. 그사이 PR #159가 병합돼 `CHANGELOG`가 충돌했다. `origin/main`을 병합해 풀고(main의 내용 그대로에 이 PR의 한 줄을 끝에 더했다), 올리는 김에 F1을 반영해 `prompt.md`의 그 줄도 `LIMITS.repros`와 견주는 테스트를 더했다(프롬프트 본문은 고치지 않았다).

## 의사결정 로그

- 결정: 빠진 제한을 모두 더한다(`note`뿐 아니라 `resolutions` 개수와 `repro`의 셋). / 이유: 어느 것이든 넘으면 판정 전체가 버려지는 것은 같다. / 버린 대안: 실제로 걸린 `note`만 더하기.
- 결정: 안내의 숫자를 `LIMITS`와 견주는 테스트를 더한다. / 이유: 이번 문제는 `LIMITS`에 키가 늘 때 프롬프트를 함께 고치지 않아 생겼다. / 버린 대안: 프롬프트를 `LIMITS`에서 만들어 내기(프롬프트는 base의 파일을 그대로 읽어 쓰고, 만드는 단계를 더하면 판정 워크플로를 고쳐야 한다).

## 발견 사항

- 없음
