---
id: 20261122-literal-pathspec
issue: 218 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T22:04:16+09:00 # new-task가 채운다
---

# 판정 코드가 PR이 정하는 파일 이름을 pathspec이 아니라 글자 그대로 읽는다 (TD-28)

## 목표와 수용 기준

판정 코드 두 곳이 PR이 정하는 파일 이름을 `git … -- <파일>`의 경로 인자로 넘긴다. git은 그 자리의 글을 파일 이름이 아니라 pathspec으로 읽는다. `*`·`?`·`[`는 glob이고, `:`으로 시작하면 특수 표기(`:!x`는 제외)다. 그런 글자가 든 이름은 드물지 않다: 웹 프로파일이 다루는 Next.js의 경로(`src/app/[id]/page.test.tsx`)가 그렇다.

임시 리포에서 확인한 지금의 동작(git 2.50):

- `git diff … -- 'scripts/a[1].ts'`는 `scripts/a[1].ts`의 diff와 함께 `scripts/a1.ts`의 diff도 낸다. git은 경로 인자를 글자 그대로도 맞춰 보고 glob으로도 맞춰 보기 때문에, 그 파일 자신의 diff는 빠지지 않고 다른 파일의 것이 더해진다.
- `git rev-list … -- 't/x[ab].test.mjs'`는 `t/xa.test.mjs`를 바꾼 커밋도 낸다.
- `git ls-tree HEAD -- ':!x'`는 `pathspec magic not supported`로 실패한다(종료 코드 128). `ls-tree`는 glob 글자를 글자 그대로 읽지만 `:` 표기는 읽는다.
- 전역 옵션 `git --literal-pathspecs <명령> …`을 주면 셋 다 그 이름의 파일만 본다.

그래서 생기는 일:

- `harness-guard`(`scripts/gates/harness-guard.ts`)는 보호 경로 파일마다 `git diff -U0 … -- <파일>`로 더해진 줄을 읽어 위험 플래그 추가 신호를 낸다. 이름에 glob 글자가 있으면 다른 파일에 더해진 줄을 그 파일의 것으로 센다. 다른 파일이 `.md`여도 센다(`.md`는 위험 플래그를 설명하는 글이 있어 일부러 보지 않는 파일이다). 신호가 틀린 파일에 붙거나, 없어야 할 신호(위험도 높음)가 생긴다.
- `test-effect`(`scripts/gates/test-effect.ts`)는 PR이 바꾼 테스트 파일과 보조 파일의 이름을 세 곳에 넘긴다.
  - 이전 판 찾기(`git rev-list -n 30 <base> -- <파일>`): glob에 맞는 다른 파일을 바꾼 커밋이 30개 한도를 채워, 이전 판으로 되돌린 테스트 파일(`restored`)을 알아보지 못한다.
  - base 체크아웃에 head 판 덮어쓰기(`git checkout <head> -- <파일들>`): glob에 맞는 다른 파일도 head 판으로 덮어쓴다. base에서 돌려야 할 파일이 head 판이 된다.
  - head 판의 blob(`git ls-tree HEAD -- <파일>`): `:`으로 시작하는 이름에서 git이 실패해 판정이 예외로 끝난다.

수용 기준:

1. `harness-guard`의 위험 플래그 추가 신호는 그 파일에 더해진 줄만 본다. 이름에 glob 글자가 든 보호 경로 파일을 바꾼 PR에서, glob으로 맞는 다른 파일에 더해진 위험 플래그를 그 파일의 신호로 내지 않는다. 그 파일 자신에 더한 위험 플래그는 지금처럼 신호다.
2. `test-effect`가 테스트 파일·보조 파일의 이름을 글자 그대로 읽는다.
   - 이전 판을 찾을 때 그 파일을 바꾼 커밋만 센다. glob으로 맞는 다른 파일을 바꾼 커밋이 한도보다 많아도, 이전 판으로 되돌린 테스트 파일은 `restored`다.
   - base 체크아웃에는 실행할 테스트 파일과 보조 파일의 head 판만 덮어쓴다. glob으로 맞는 다른 파일은 base 판 그대로다.
   - `:`으로 시작하는 이름의 테스트 파일도 커밋된 변경만 보는 실행(`committedOnly`)에서 예외 없이 판정된다.
3. PR이 정하는 이름을 git의 경로 인자로 넘기는 다른 자리를 조사한 결과(고쳤는지, 남겼는지와 이유)가 이 계획의 "의사결정 로그"에 있다.
4. 평범한 이름의 파일에 대한 판정은 그대로다. 있던 테스트(`scripts/test/harness-guard.test.ts`, `scripts/test/test-effect.test.ts`의 지금 있는 테스트)는 고치지 않고 통과한다.
5. 설계서의 변경 이력과 CHANGELOG에 적고, 기술 부채 표의 TD-28은 해결로 닫는다. "발견 사항"의 두 항목은 기술 부채 표의 새 행 하나로 남긴다.

## 범위 / 비범위

범위:

- `scripts/lib/git.ts`: 전역 옵션의 이름을 상수로 둔다.
- `scripts/gates/harness-guard.ts`: 파일별 diff 한 곳.
- `scripts/gates/test-effect.ts`: `ls-tree`, `rev-list`, `checkout` 세 곳.
- 테스트(`scripts/test/harness-guard.test.ts`, `scripts/test/test-effect.test.ts`에 더한다), 문서, 기술 부채 표.

비범위:

- 일부러 pathspec을 쓰는 자리와, 이름의 출처가 형식 검사를 거친 자리("의사결정 로그"의 조사 결과).
- `harness-guard`의 파일별 diff가 실패했을 때 조용히 넘어가는 것("발견 사항" 첫 항목).
- `test-effect`가 테스트 파일 이름을 실행 명령에 넘길 때 그 명령이 이름을 glob으로 읽는 것("발견 사항" 둘째 항목). 이 리포의 설정(`node --test <파일>`)이 그렇다. 명령은 프로파일이 정하는 것이고 고치는 방법(이름 거절, 실행기 바꾸기)을 따로 정해야 한다.
- git 출력의 경로를 UTF-8로만 읽는 것(TD-63).
- 판정의 다른 동작. 위험 플래그의 목록, `.md`를 보지 않는 규칙, 이전 판의 한도(30)는 그대로다.

## 관련 파일·문서

- `scripts/lib/git.ts`, `scripts/gates/harness-guard.ts`, `scripts/gates/test-effect.ts`
- `scripts/test/harness-guard.test.ts`, `scripts/test/test-effect.test.ts`
- `docs/harness/design.md`(0절 머리말·변경 이력), `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-28 행, 새 행 하나)
- 읽기만: `scripts/gates/risk-gate.ts`(`changedFiles`), `scripts/ci/gates.ts`, `scripts/ci/binding.ts`(`samePrContent`), `scripts/ci/rebuttal.ts`(`validEvidence`), `scripts/runner/review.ts`, `scripts/gates/scope.ts`, `scripts/gates/doc-lint.ts`, `scripts/ci/plan-hash.ts`, `scripts/commands/task.ts`, `scripts/lib/plan.ts`(`PLAN_ID_RE`), `scripts/lib/util.ts`(`matchesAny`), `scripts/test/helpers.ts`, `profiles/web/test-effect/run-one.mjs`, `harness.config.json`, `docs/exec-plans/completed/20261115-cross-review/plan.md`

## step 목록

- step0 literal-paths: `harness-guard`와 `test-effect`가 파일 이름을 글자 그대로 넘긴다. 테스트, 문서, 기술 부채 표

## 진행 로그

- 2026-11-22 22:09 `new-task --issue 218`로 시작했다(제작자 대화 지시의 다음 순서, TD-28. Issue는 봇이 대신 등록했다). 계획을 쓰기 전에 git의 경로 인자를 넘기는 자리를 모두 찾아 읽고, 임시 리포에서 지금의 동작과 `--literal-pathspecs`의 효과를 실험했다("목표와 수용 기준"의 네 줄). 기술 부채 표의 문장("자기 diff를 놓쳐")은 실험과 달랐다: git이 경로 인자를 글자 그대로도 맞춰 보므로 그 파일 자신의 diff는 빠지지 않고 다른 파일의 것이 더해진다. step0의 테스트 가운데 지금 실패해야 하는 다섯을 초안으로 써서 돌려, 지금의 코드에서 계획에 적은 이유로 실패하고(`scripts/a[1].ts`와 `docs/harness/n*`에 틀린 신호, `restored`가 아니라 `ineffective`, `effective`가 아니라 `ineffective`, `git ls-tree`의 `pathspec magic not supported`) 초안 구현에서 통과하는 것을 확인했다. 초안은 커밋하지 않고 되돌렸다.

## 의사결정 로그

- 결정: 고치는 방법은 git의 전역 옵션 `--literal-pathspecs`다. 이름을 넘기는 호출마다 붙인다. / 이유: 그 호출의 경로 인자가 모두 PR이 정한 이름이라 pathspec으로 읽을 것이 없다. 호출마다 붙이면 일부러 pathspec을 쓰는 호출(`*.md`, `:(exclude)…`)은 그대로다. / 버린 대안: 환경 변수 `GIT_LITERAL_PATHSPECS`를 git 도우미(`git`, `gitTry`)에 늘 넣기(pathspec을 쓰는 호출이 깨진다), 이름마다 `:(literal)`을 앞에 붙이기(이름을 바꿔 넘기게 되고 `ls-tree`가 받지 않는다), 이름을 넘기지 않고 전체 diff를 받아 파일별로 나누기(`samePrContent`의 방법. diff 본문을 파일별로 가르는 해석기가 필요해진다).
- 결정: 조사한 자리와 처리. / 이유: Issue의 할 일("같은 문제가 있는 자리를 함께 고치거나 남기는 이유를 적는다").
  - 고친다: `scripts/gates/harness-guard.ts`의 파일별 `diff`(PR이 바꾼 보호 경로 파일), `scripts/gates/test-effect.ts`의 `ls-tree`·`rev-list`·`checkout`(PR이 바꾼 테스트 파일과 보조 파일).
  - 남긴다(pathspec이 아니다): `git show <커밋>:<파일>`·`git rev-parse <커밋>:<파일>`(`scripts/lib/git.ts`의 `showFile`, `test-effect`), `git hash-object -- <파일>`(`test-effect`). 이 자리의 글은 경로 그대로 읽힌다.
  - 남긴다(일부러 쓰는 pathspec): `doc-lint`의 `ls-files -- '*.md'`와 문서 머리말 `related_code`의 경로를 넘기는 `git log -- <경로들>`(폴더와 glob을 적는 자리다: `scripts/`, `docs/exec-plans/TEMPLATE*.md`), `bypass-scan`의 `grep -- . ':(exclude)*.md'`, `conflict-markers`의 `grep`.
  - 남긴다(이름이 형식 검사를 거친다): 상수 경로나 계획 id로 만든 경로를 넘기는 자리(`scope`의 `ls-tree`, `plan-hash`의 `ls-tree`, `task.ts`의 `ls-tree`·`mv`·`add`·`commit`, runner의 `ls-tree`·`add`·`commit`). 계획 id는 숫자·소문자·`-`뿐이다(`PLAN_ID_RE`. 브랜치 이름에서 id를 읽는 `parseBranch`도 같은 형식만 받는다). 반박 근거의 파일을 넘기는 `scripts/runner/review.ts`의 `ls-files --error-unmatch -- <파일>`도 같다. 근거의 형식(`scripts/ci/rebuttal.ts`의 `REL_PATH`)이 영문자·숫자와 `_.@+-/`만 받는다.
  - 남긴다(이름을 넘기지 않는다): `samePrContent`(계획 `20261115-cross-review`에서 고쳤다), 이름 없이 전체를 보는 `diff --name-only`·`--numstat`·`--raw` 호출들.

## 발견 사항

- `harness-guard`의 파일별 diff는 git이 실패해도 조용히 넘어간다(`gitTry`의 결과에서 출력만 읽는다). 실패하면 그 파일의 위험 플래그 신호가 빠진다. 지금 알려진 실패 경로는 없다(보호 경로의 이름은 `:`으로 시작하지 않아 `:` 표기의 오류에 걸리지 않는다). 읽지 못하면 판정하지 못한 것으로 올리는 편이 맞다.
- `test-effect`는 테스트 파일 이름을 실행 명령의 인자로 넘기는데, 이 리포의 명령(`node --test <파일>`)은 그 인자를 glob으로 읽는다. Node 22에서 확인했다: `node --test 't/x[ab].test.mjs'`는 그 이름의 파일이 아니라 `t/xa.test.mjs`를 실행하고, 맞는 파일이 없으면 테스트 0건에 종료 코드 0이다. 이름에 glob 글자가 든 테스트 파일은 base에서 다른 파일의 결과로 판정된다. 웹 프로파일의 실행기(`profiles/web/test-effect/run-one.mjs`)는 glob 글자를 이스케이프해 넘긴다.

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 Acceptance Criteria.
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다(테스트 먼저).
