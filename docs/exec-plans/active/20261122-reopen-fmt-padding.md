---
id: 20261122-reopen-fmt-padding
issue: 192 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-22T09:22:27+09:00
---

# step을 다시 열면(reopenStep) 계획의 status 줄에 공백이 남아 fmt 검사가 실패한다

- 목표: 계획의 frontmatter 값을 스크립트가 바꾼 뒤에도 그 줄이 포매터의 결과와 같다. 완료한 step을 다시 연 직후(`reopenStep`) 따로 `fmt`를 돌리지 않아도 `fmt --check`가 통과한다.
- 변경: `scripts/lib/plan.ts`의 `setFrontmatter`가 값과 주석 사이를 공백 하나로 쓴다. 지금은 주석을 원래 칸에 두려고 값을 공백으로 채워(`padEnd`), 새 값이 옛 값보다 짧으면(`completed` → `active`) 공백이 여럿 남고 포매터가 그것을 고친다. 주석이 없는 줄과 주석의 글은 그대로다. `scripts/commands/task.ts`의 `appendProgress`(다시 열 때 진행 로그에 한 줄을 붙인다)도 포매터의 결과와 같게 쓴다: 진행 로그 절이 없거나 비어 있으면 제목 아래에 빈 줄을 두고, 목록의 끝에는 바로 잇고, 주석·문단 뒤에는 빈 줄을 두며, 파일의 끝은 줄바꿈 하나다.
- 검증: node --test scripts/test/lib.test.ts scripts/test/runner-pr.test.ts scripts/test/task.test.ts

## 관련 파일·문서

- `scripts/lib/plan.ts`(`setFrontmatter`)
- `scripts/commands/task.ts`(`appendProgress`. `reopenStep`·`setPlanStatus`·`new-task`의 값 채우기는 읽기만 한다)
- `scripts/test/lib.test.ts`, `scripts/test/runner-pr.test.ts`, `scripts/test/task.test.ts`
- `docs/harness/CHANGELOG.md`

## 테스트 (먼저 쓴다)

- `setFrontmatter`(`lib.test.ts`):
  - 값이 짧아지는 변경(`status: completed # …` → `active`)의 결과 줄이 글자 그대로 `status: active # …`다(공백 하나).
  - 값이 길어지는 변경(`active` → `completed`), 길이가 같은 변경도 공백 하나다.
  - 주석 앞에 공백이 여럿 있던 줄(손으로 칸을 맞춘 것)도 바꾼 뒤에는 공백 하나다. 바꾸지 않은 다른 줄은 글자 그대로다.
  - 주석이 없는 줄은 `키: 값`이다. 주석의 글(`#` 뒤)은 그대로다. 없는 키는 끝에 더해진다(있던 동작).
  - 바꾼 frontmatter를 포매터에 넣어도 바뀌지 않는다(`prettier`의 `check`. 리포의 `.prettierrc`를 쓴다).
  - 있던 테스트 "frontmatter 파싱과 수정(주석 보존)"의 단언은 그대로 둔다.
- `reopenStep`(`runner-pr.test.ts`): 포맷이 맞는 완료된 계획에서 시작해 step을 다시 연 뒤, 계획 파일의 `status` 줄에 값과 주석 사이의 공백이 하나이고, 진행 로그에 한 줄이 붙었으며, **계획 파일 전체**가 포매터의 검사를 통과한다.
- `appendProgress`(`task.test.ts`): 포맷이 맞는 계획 일곱 가지(진행 로그 절이 없다, 비어 있고 마지막 절이다, 비어 있고 뒤에 절이 있다, 항목이 있고 마지막 절이다, 항목과 딸린 줄이 있고 뒤에 절이 있다, 주석으로 끝난다, 문단으로 끝난다)에 두 번 붙인 뒤 파일 전체가 포매터의 검사를 통과한다. 붙인 두 줄이 진행 로그 절 안에 차례로 있고 있던 글은 그대로다.

## 진행 로그

- 2026-11-22 접수: 제작자가 대화에서 Issue로 등록하라고 정했고(2026-11-22) 봇이 Issue #192를 등록했다. PR #185가 병합된 뒤 `new-task`로 시작했다.
- 2026-11-22 테스트를 먼저 썼다. `node --test scripts/test/lib.test.ts`: 새 테스트 `setFrontmatter: 값과 주석 사이는 공백 하나다`가 실패했다(기대 `status: active # …`, 실제 `status: active    # …`). `node --test scripts/test/runner-pr.test.ts`의 새 테스트 `reopenStep: 다시 연 계획의 frontmatter를 포매터가 고치지 않는다`도 같은 줄에서 실패했다.
- 2026-11-22 `setFrontmatter`가 값과 주석 사이를 공백 하나로 쓰게 고쳤다. 두 파일 32건 모두 통과(있던 테스트 `frontmatter 파싱과 수정(주석 보존)`은 고치지 않았다). 테스트는 포매터(`prettier`, 리포의 설정)를 직접 불러 결과를 검사한다. `origin/main`을 병합했다(PR #185·#189 병합 뒤).
- 2026-11-22T09:47:36+09:00 step 재작업: 구현 판정 1회차: Claude 승인(지적 없음), Codex 수정 요청(P1 하나). F1: `reopenStep` 테스트가 frontmatter만 포매터에 넣는다. 다시 연 계획 파일 전체는 통과하지 못할 수 있다(진행 로그 절이 없는 계획에서는 `appendProgress`가 제목 바로 아래에 목록을 붙여 포매터가 빈 줄을 넣는다). 맞는 지적이다. 테스트가 파일 전체를 보게 하고 `appendProgress`가 쓰는 글도 포매터의 결과와 같게 고친다.
- 2026-11-22 구현 판정 1회차의 F1(P1)을 고쳤다. 테스트를 먼저 고쳤다: `reopenStep` 테스트가 계획 파일 전체를 포매터에 넣게 했고(지금의 시험용 계획은 진행 로그에 항목이 있어 통과한다), `appendProgress`의 테스트를 더했다. 고치기 전에 `appendProgress` 테스트가 첫 사례(진행 로그 절이 없다)에서 실패했다(제목 바로 아래에 목록이 붙어 포매터가 빈 줄을 넣는다). `appendProgress`를 고친 뒤 세 파일 41건 모두 통과. 이 계획 자신을 `reopenStep`으로 다시 연 직후 `fmt --check`가 따로 `fmt`를 돌리지 않고 통과했다(고친 `setFrontmatter`로).

## 의사결정 로그

- 결정: 주석의 칸을 보존하지 않고 언제나 공백 하나로 쓴다. / 이유: 이 리포의 Markdown은 포매터가 고치고, 포매터는 frontmatter의 값과 주석 사이를 공백 하나로 둔다. 칸을 보존하는 동작은 포매터를 쓰기 전의 템플릿(주석의 칸을 손으로 맞춘 것)을 위한 것이었고, 지금은 포맷 검사와 어긋나는 결과만 낸다. / 버린 대안: `reopenStep` 뒤에 포매터를 돌린다(`setFrontmatter`를 부르는 다른 곳에 같은 문제가 남는다).

## 발견 사항

없음.

## 검증 결과

- `node --test scripts/test/lib.test.ts scripts/test/runner-pr.test.ts scripts/test/task.test.ts`: 41건 통과.
- `node scripts/harness.ts check`: 통과.
