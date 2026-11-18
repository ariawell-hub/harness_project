---
id: 20261118-target-repo-trial
issue: 124 # GitHub Issue 번호
type: chore # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-18T18:58:57+09:00
---

# chore: 운영 전환 시험 — 하네스 리포의 워크플로 push 거부 결과 기록 (#102 step7의 위험도 낮음 PR)

- 목표: 운영 전환 체크리스트 6(설계서 10.4절)의 하네스 리포 시험 가운데 `workflow-push-rejected` 사례의 결과를 `lab/ops-transition/results/target-repo.json`에 남긴다(Issue #124, 계획 `20261116-ops-security` step7 지시서 2번). 이 PR 자신은 `low-risk-auto-merge` 사례의 대상이다: 보호 경로 밖 파일만 바꾸는 위험도 낮음 PR이 사람 승인 없이 자동 병합되는지 본다.
- 변경: `lab/ops-transition/results/target-repo.json` 새 파일 하나(사례 `workflow-push-rejected`)와 이 계획 파일. 보호 경로(`harness.config.json`의 `protectedPaths`)는 바꾸지 않는다.
- 검증: node -e "const d=JSON.parse(require('fs').readFileSync('lab/ops-transition/results/target-repo.json','utf8'));const c=d.cases.find(x=>x.name==='workflow-push-rejected');if(d.item!=='target-repo'||!c||c.verdict!=='pass'||!c.evidence.length)process.exit(1)"
- 그 밖의 검증: `node scripts/harness.ts check`, `node lab/ops-transition/report.ts --all`(기존 8개 항목이 그대로 통과한다).
- 비범위: `report.ts`의 항목·필수 사례에 `target-repo`를 더하는 일, `low-risk-auto-merge`·`protected-needs-owner` 사례의 기록, `stage` 전환은 #102 step7의 전환 PR이 한다. 이 PR의 병합 결과를 이 PR에 적지 않는다(자기 PR에 자기 결과를 적으면 병합 전에 병합을 적게 된다. #102 계획 검증 2라운드의 P2, 원장 F3).

## 관련 파일·문서

- `lab/ops-transition/results/target-repo.json`
- `lab/ops-transition/report.ts`, `lab/ops-transition/README.md`(결과 형식, 읽기만)
- `docs/exec-plans/active/20261116-ops-security/step7.md`(지시서 2번, 읽기만)
- `docs/harness/design.md` 10.4절 운영 전환 체크리스트 6(읽기만)

## 진행 로그

- 2026-11-18: #102 step7의 대화 세션이 Issue #124를 등록하고 시작했다(제작자 대화 지시 "step 7 시작하라", 계획 `20261116-ops-security`의 의사결정 로그 "체크리스트 6의 위험도 낮음 PR"). 그 전에 같은 세션이 `workflow-push-rejected` 시험을 했다: main `ba141ce` 위에 `.github/workflows/check.yml` 주석 한 줄을 더한 커밋 `1155bcf`를 git 객체로만 만들어(작업 트리와 다른 브랜치는 건드리지 않았다) 버릴 브랜치 이름 `trial/workflow-push-rejected-20261118`로 push했고, GitHub이 `workflow` 권한이 없다는 문구로 거부했다. 원격에 브랜치가 생기지 않아 지울 것이 없다. 결과를 Issue #124 본문과 `target-repo.json`에 적었다.

## 의사결정 로그

- 결정: 이 PR은 `workflow-push-rejected` 사례만 적는다. / 이유: step7 지시서 2번의 문구("위 사례를 적는 PR")이고, 이 PR의 자동 병합 결과는 병합된 뒤에야 알 수 있다. / 버린 대안: `low-risk-auto-merge`를 "예정"으로 함께 적기(관찰하지 않은 것을 기록에 넣게 된다).
- 결정: 시험 커밋은 worktree를 만들지 않고 git 객체로만 만들었다(임시 index → `commit-tree` → SHA를 원격 브랜치 이름으로 push). / 이유: step7 지시서의 금지사항("실제 변경이 든 브랜치나 열린 PR의 브랜치에서 하지 마라")을 지키면서 로컬에 남는 브랜치·worktree가 없다. 거부되면 원격에도 남는 것이 없다. / 버린 대안: 시험용 Issue와 `new-task` worktree(테스트 리포에서 쓴 방법. 거부된 뒤 로컬 worktree와 선점 브랜치가 남았다).

## 발견 사항
