# Step 1: live

## 읽어야 할 파일

- 계획의 수용 기준 7, step0이 바꾼 파일(`scripts/gates/risk-gate.ts`, `scripts/ci/gates.ts`)
- `docs/SECURITY.md`의 "테스트 리포 준비", `lab/ops-transition/README.md`(테스트 리포 `ariawell-hub/harness-ops-lab`의 운영 방식)

## 작업

step0이 main에 병합된 뒤 한다.

1. 테스트 리포의 하네스를 step0 병합 뒤 main의 트리로 맞춘다(봇이 PR로 올린다. 보호 경로라 제작자 승인이 필요하다. 이 승인을 아래 첫 확인과 묶지 않는다).
2. 테스트 리포에서 보호 경로를 바꾸는 시험 PR 하나를 연다. 제작자에게 승인을 요청한다(Issue에 `needs-human`, 무엇을 승인하는지 적는다).
3. 승인 뒤:
   - (가) 테스트 리포 main에 다른 커밋을 넣고(봇의 위험도 낮음 PR을 자동 병합), 시험 PR에 main 병합 커밋만 올린다. 그 head의 `risk-gate`가 `제작자 head 승인 이어받음`인지, 리뷰 API가 리뷰의 커밋을 무엇으로 보고하는지 기록한다.
   - (나) 시험 PR에 일반 커밋 하나를 올린다. `risk-gate`가 `제작자 head 승인 필요`인지, 리뷰 API가 무엇을 보고하는지 기록한다.
4. 결과를 `lab/approval-binding/results/live.json`(`cases`: 사례마다 `id`(`main-merge`·`normal-commit`), `head`, `reviewApiCommit`(리뷰 API가 보고한 커밋), `riskGate`(`state`·`description`), `observedAt`)과 `lab/approval-binding/README.md`(절차와 해석)에 남긴다. 변경 조각 `docs/harness/changes/20261126-approval-binding-s1.md`.
5. 시험 PR은 닫는다(병합하지 않는다).

## Acceptance Criteria

```bash
test -f lab/approval-binding/results/live.json
node -e "const r=JSON.parse(require('fs').readFileSync('lab/approval-binding/results/live.json','utf8'));const c=Object.fromEntries(r.cases.map(x=>[x.id,x]));const sha=/^[0-9a-f]{40}$/;for(const id of ['main-merge','normal-commit']){const x=c[id];if(!x||!sha.test(x.head)||!sha.test(x.reviewApiCommit)||!x.observedAt||!x.riskGate)process.exit(1)}if(c['main-merge'].riskGate.state!=='success'||!c['main-merge'].riskGate.description.includes('제작자 head 승인 이어받음'))process.exit(1);if(c['normal-commit'].riskGate.state!=='failure'||!c['normal-commit'].riskGate.description.includes('제작자 head 승인 필요'))process.exit(1)"
grep -qF 'Issue #250' docs/harness/changes/20261126-approval-binding-s1.md
node scripts/harness.ts check
```

## 금지사항

- 제작자 대신 승인하지 마라. 이유: R20.
- 테스트 리포의 보호 설정·environment·App 설정을 바꾸지 마라. 이유: R20. 필요하면 제작자에게 요청한다.
- 시험 PR을 병합하지 마라. 이유: 시험용이다.
