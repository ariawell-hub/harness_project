---
id: 20261120-metrics-plan-fix
issue: 153 # GitHub Issue 번호
type: docs # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-20T12:39:45+09:00
---

# 계획 20261119-metrics의 step1 작업 수정: PR 커밋 조회와 댓글 조회 경계

- 목표: 계획 `20261119-metrics`의 step1 "작업"을 구현할 수 있게 고친다(Issue #153). step1이 정한 PR 커밋 조회(`gh pr list --limit 1000 --json …,commits`)가 이 리포에서 GraphQL 노드 한도를 넘어 실패한다. step을 실행하는 PR은 자기 step 파일의 "작업"을 바꿀 수 없으므로(`plan-gate`, 설계서 8.2절) 계획 수정만 따로 올린다.
- 변경: `docs/exec-plans/active/20261119-metrics/step1.md`와 `step2.md` 두 파일. 코드·설정·다른 문서는 바꾸지 않는다. ① PR의 커밋 목록을 PR마다 `pulls/<번호>/commits`로 읽고, 250개 이상·빈 응답·중복은 `SourceError`로 끝낸다(쪽 넘김과 이 경우들의 테스트 명세 포함). ② 리포 댓글 조회의 `since`를 집계 시작일의 전날로 한다. ③ step2의 기술 부채 표 작업에 조회 한계의 TD 등록을 더한다.
- 검증: node scripts/harness.ts doc-lint
- 그 밖의 검증: `node scripts/harness.ts check`. ①과 ③은 PR #151의 계획 검증(G1) 3라운드에서 두 검증자가 승인한 내용(해시 `68405e5ebcb9`, head `252de0a`)을 그대로 옮긴 것이다: `git diff 252de0a -- docs/exec-plans/active/20261119-metrics/step1.md docs/exec-plans/active/20261119-metrics/step2.md`의 차이가 ②뿐이다.

## 관련 파일·문서

- `docs/exec-plans/active/20261119-metrics/step1.md`, `step2.md`
- PR #151(step1의 구현. 계획 검증 3라운드와 구현 판정 1라운드의 지적 원장 F2~F6)
- `docs/harness/design.md` 8.2절(step 파일의 결속), `scripts/gates/plan-gate.ts`

## 진행 로그

- 2026-11-20 12:40 PR #151에 계획 수정과 step1 구현을 함께 올렸더니 `plan-gate`가 "이 PR이 실행하는 step1의 작업 섹션을 바꿨다"로 실패했다. 절차서 2절에 적힌 규칙인데 봇이 놓쳤다. 봇이 Issue #153을 등록하고 계획 수정을 이 PR로 나눴다.
- 2026-11-20 12:40 `git checkout 252de0a -- step1.md step2.md`로 PR #151에서 계획 검증을 받은 두 파일을 그대로 가져오고, step1.md에 ②(댓글 조회의 `since`)를 더했다. ②는 PR #151 구현 판정 1라운드의 F5(P1, codex. 시작일 00:00:00Z에 쓰인 댓글이 서버에서 빠질 수 있다)의 대응이다. 읽기 요청 꼴(`since=<날짜>T00:00:00Z`)은 그대로다.

## 의사결정 로그

- 결정: 계획 수정을 소규모 계획의 별도 PR로 올린다. / 이유: `plan-gate`는 step 폴더 계획의 브랜치에 step 번호를 요구하고(`<type>/<id>-s<N>`), 그 step의 PR은 자기 step 파일을 바꿀 수 없다. 다른 step의 브랜치(step2)로 올리면 그 step의 완료 처리를 요구한다. 남는 길이 별도 작업이다. / 버린 대안: step1 파일을 그대로 두고 구현만 계획과 다르게 하기(계획과 구현이 어긋난다), 새 step을 더해 step1을 버리기(step1의 나머지 작업은 그대로 유효하다).
- 결정: ②를 이 PR에 함께 넣는다. / 이유: 조회 인자의 명세가 step1 "작업"에 있어 구현 PR에서 고칠 수 없다. 이 부분은 계획 검증(G1)을 따로 받지 않았으므로 이 PR의 판정에서 본다.
- 결정: `plan.md`는 이 PR에서 고치지 않는다. / 이유: 결속되는 섹션(목표와 수용 기준, 범위, 관련 파일)은 바뀌지 않았고, 진행 로그는 PR #151이 갖고 있다. 여기서도 고치면 PR #151이 main을 병합할 때 같은 줄에서 충돌한다.

## 발견 사항

- step 폴더 계획에서 아직 실행하지 않은 step의 "작업"을 고치는 절차가 문서에 없다. 절차서 2절은 "계획을 고쳐야 하면 진행 로그에 이유를 적고 제작자에게 알린다"까지만 적고, `plan-gate`의 안내("별도 계획 수정으로 처리하라")는 어떤 브랜치로 올리는지 말하지 않는다. 이번에는 소규모 계획의 별도 PR로 풀었다. 이 길에서는 계획 검증(G1) 해시를 게이트가 확인하지 않는다(일반 판정만 받는다). → 처리: #153
