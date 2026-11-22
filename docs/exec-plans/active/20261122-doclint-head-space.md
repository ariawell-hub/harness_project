---
id: 20261122-doclint-head-space
issue: 191 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-22T09:35:47+09:00
---

# doc-lint의 설계서 머리말 검사가 '최종 갱신:' 앞의 공백을 요구하지 않는다

- 목표: `doc-lint`의 설계서 버전 검사가 머리말 줄을 정한 형식(`> 버전 v<버전> · <임의의 글자> 최종 갱신: <날짜>`)대로 읽는다. `최종 갱신:` 바로 앞에 공백이 없는 머리말(`… 초안최종 갱신: …`)은 형식 오류다.
- 변경: `scripts/gates/doc-lint.ts`의 정규식 `DESIGN_HEAD`가 `최종 갱신:` 바로 앞의 공백을 요구한다. 지금은 `· .*최종 갱신:`이라 앞 글자가 무엇이든 받는다. 가운데의 글이 없는 꼴(`> 버전 v… · 최종 갱신: …`)은 지금처럼 받는다. 검사를 강화하는 변경이다(받던 틀린 꼴 하나를 거부한다).
- 검증: node --test scripts/test/doc-lint-design-version.test.ts

## 관련 파일·문서

- `scripts/gates/doc-lint.ts`(`DESIGN_HEAD`, `designVersionProblems`)
- `scripts/test/doc-lint-design-version.test.ts`
- `docs/exec-plans/completed/20261121-merge-leftovers/step1.md`(머리말 형식을 정한 곳. 읽기만 한다)
- `docs/harness/design.md`(머리말 줄. 읽기만 한다. 지금의 줄이 그대로 통과해야 한다), `docs/harness/CHANGELOG.md`

## 테스트 (먼저 쓴다)

- `최종 갱신:` 앞의 공백만 빠진 머리말(`> 버전 v0.7.3 · 상태: 초안최종 갱신: 2026-11-21`)은 문제 한 건이다. 규칙은 `R8 설계서 버전`, `what`에 `머리말`이 있다. 읽지 못한 경우라 비교 문제는 함께 나오지 않는다(버전이 어긋난 머리말로도 한 건이다).
- 그대로 통과하는 꼴: 지금의 머리말(`… · 상태: 초안 · 최종 갱신: …`), 가운데 글이 없는 꼴(`> 버전 v0.7.3 · 최종 갱신: …`), 날짜 뒤에 공백이 있는 꼴.
- 정규식의 다른 자리도 계획의 형식대로인지 본다(지금도 거부한다. 그대로인지 확인한다): 버전 뒤 `·`의 공백이 없는 꼴(`v0.7.3· …`, `v0.7.3 ·상태 …`), 날짜 뒤에 글이 있는 꼴은 형식 오류 한 건이다.
- 실제 설계서(`docs/harness/design.md`)가 문제 0건이다(있던 `doc-lint` 통과가 그대로다).
- 있던 테스트의 단언은 고치지 않는다.

## 진행 로그

- 2026-11-22 접수: PR #185의 판정에서 Codex가 낸 지적(F4)을 그 PR의 범위 밖으로 반박했고, 제작자가 대화에서 Issue로 등록하라고 정해(2026-11-22) 봇이 Issue #191을 등록했다. `new-task`로 시작했다.
- 2026-11-22 테스트를 먼저 썼다. `node --test scripts/test/doc-lint-design-version.test.ts`: 새 테스트가 첫 사례(`> 버전 v0.7.3 · 상태: 초안최종 갱신: 2026-11-21`)에서 실패했다(문제 0건. 기대는 한 건). 있던 11건은 통과.
- 2026-11-22 `DESIGN_HEAD`가 `최종 갱신:` 바로 앞의 공백을 요구하게 고쳤다. 12건 모두 통과. 실제 설계서의 머리말은 그대로 문제 0건이다(테스트가 본다).

## 의사결정 로그

- 결정: 가운데의 글이 없는 머리말(`> 버전 v… · 최종 갱신: …`)은 받는다. / 이유: 계획의 형식에서 `<임의의 글자>`는 비어도 된다고 읽을 수 있고 지금도 받는다. 이 Issue가 닫으려는 것은 두 부분이 붙은 꼴이다. 받던 바른 꼴을 새로 거부하지 않는다.

## 발견 사항

없음.

## 검증 결과

- `node --test scripts/test/doc-lint-design-version.test.ts`: 12건 통과.
- `node scripts/harness.ts check`(`doc-lint` 포함): 통과.
