# Step 0: measure

## 읽어야 할 파일

- 계획 `docs/exec-plans/active/20261126-approval-binding/plan.md`의 수용 기준 1~3과 의사결정 로그
- `docs/SECURITY.md`의 "코드 오너 리뷰 필수"(지금 main 보호 규칙의 리뷰 설정)
- `scripts/gates/risk-gate.ts`의 `ownerApprovedHead`·`riskGate`(읽기만. 지금 판정: 제작자의 마지막 판정 리뷰가 승인이고 리뷰의 커밋이 head)
- `lab/ops-transition/README.md`의 결과 형식(참고)

## 작업

이 step은 코드를 고치지 않는다. 실측하고 기록한다.

1. **제작자 작업을 한 번에 요청한다**(대화와 Issue #250 댓글. 순서, 확인 방법, 넣을 값을 함께 적는다):
   - (ㄱ) main에 규칙 세트를 만든다: Settings → Rules → Rulesets → New ruleset → New branch ruleset. 이름 `approval-dismiss-stale`, Enforcement status `Active`, Bypass list 비움, Target branches `Include default branch`. Rules에서 "Require a pull request before merging"을 켜고 그 아래 Required approvals `0`, "Dismiss stale pull request approvals when new commits are pushed" 켬, 나머지 하위 항목은 끈다. 새 규칙 세트에 기본으로 켜져 있는 "Restrict deletions"·"Block force pushes"는 그대로 둔다. Create.
   - (ㄴ) 아래 3의 시험 PR head를 승인한다(병합하지 않는 PR이다).
   - 확인: 봇이 `gh api repos/ariawell-hub/harness_project/rules/branches/main`으로 `type: pull_request`, `parameters.dismiss_stale_reviews_on_push: true`를 본다.
2. **규칙 기록**: (ㄱ) 뒤 위 응답에서 그 규칙의 `type`·`parameters`·`ruleset_id`를 `lab/approval-binding/results/live.json`의 `rule`에 적는다.
3. **시험 PR**: `origin/main`에 `docs/harness/approval-probe-250.md` 하나를 더한 커밋을 플러밍(`git hash-object -w`, 임시 `GIT_INDEX_FILE`의 `read-tree`·`update-index`·`write-tree`, `commit-tree`)으로 만들어 `test/approval-probe-250` 브랜치로 push하고 초안이 아닌 PR을 연다(본문: 시험용이고 병합하지 않는다, `Refs #250`). 작업 트리는 바꾸지 않는다. 보호 경로라 위험도 높음이고, 색인에 없는 문서라 `check`가 실패해 검증자 판정이 돌지 않으며, 계획이 없어 `plan-gate`가 실패해 병합되지 않는다. 자동 병합을 켜지 않는다.
4. **승인 뒤 기록**(사례 `approved`): 리뷰 API(`pulls/<n>/reviews`의 제작자 리뷰 `state`·`commit_id`·`submitted_at`), head, 그 head의 `risk-gate` 상태·설명.
5. **(가) main 병합만**(사례 `main-merge`): main이 앞서 나간 뒤(다른 PR이 병합된 뒤) 시험 브랜치에 `origin/main` 병합 커밋만 더한다(`git merge-tree --write-tree`와 `commit-tree`, 충돌이 없어야 한다). push하고 `gates`가 끝나면 4와 같은 값을 기록한다. 병합 커밋의 부모 수도 적는다.
6. **(나) 일반 커밋**(사례 `normal-commit`): 시험 파일의 내용을 바꾼 일반 커밋을 더해 push하고, 끝나면 같은 값을 기록한다.
7. 시험 PR을 닫고 브랜치를 지운다(`gh pr close <n> --delete-branch`).
8. **결과**: `lab/approval-binding/results/live.json`(`rule`, `cases`: `id`, `head`, `parents`, `review`(`state`·`commitId`·`submittedAt`), `riskGate`(`state`·`description`), `observedAt`, `evidence`(PR·실행 URL)), `lab/approval-binding/README.md`(절차와 해석, #226과의 비교), 변경 조각 `docs/harness/changes/20261126-approval-binding-s0.md`(CHANGELOG 한 줄. 설계서는 step1에서 고친다). 결과가 기대(수용 기준 2)와 다르면 그대로 기록하고 계획의 수용 기준 3대로 step1을 고친다(아래 AC는 기대를 단언하므로 그때는 계획 수정과 함께 고친다).

## Acceptance Criteria

```bash
test -f lab/approval-binding/results/live.json
node -e "const r=JSON.parse(require('fs').readFileSync('lab/approval-binding/results/live.json','utf8'));if(r.rule.type!=='pull_request'||r.rule.parameters.dismiss_stale_reviews_on_push!==true)process.exit(1);const c=Object.fromEntries(r.cases.map(x=>[x.id,x]));const sha=/^[0-9a-f]{40}$/;for(const id of ['approved','main-merge','normal-commit']){const x=c[id];if(!x||!sha.test(x.head)||!sha.test(x.review.commitId)||!x.observedAt||!x.riskGate||!x.evidence.length)process.exit(1)}if(c.approved.review.state!=='APPROVED'||c.approved.riskGate.state!=='success')process.exit(1);if(c['main-merge'].parents!==2||c['main-merge'].review.state!=='APPROVED'||c['main-merge'].riskGate.state!=='success')process.exit(1);if(c['normal-commit'].review.state!=='DISMISSED'||c['normal-commit'].riskGate.state!=='failure')process.exit(1)"
BASE="$(git merge-base HEAD origin/main)" && test -z "$(git diff --name-only "$BASE" HEAD -- scripts .github)"
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s0.md
node scripts/harness.ts check
```

## 금지사항

- 시험 PR을 병합하지 마라. 자동 병합도 켜지 마라. 이유: 시험용이다.
- 제작자 대신 승인하거나 규칙 세트·보호 설정을 바꾸지 마라. 이유: R20.
- 시험 브랜치에 강제 push하지 마라. 이유: R2. 강제 push는 이 실측의 사례도 아니다.
- `scripts/`·`.github/`를 고치지 마라. 이유: 코드는 step1에서 실측 결과 위에 고친다.
