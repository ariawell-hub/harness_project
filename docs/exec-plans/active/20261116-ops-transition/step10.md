# Step 10: operation

이 step은 대화 세션이 실행한다. 제작자 설정과 승인이 필요하다.

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-transition/plan.md` (수용 기준 10·11, 의사결정 로그의 "위험도 낮음 PR" 결정)
- `docs/harness/design.md` 10.4절(운영 단계, 단계 표시, 운영 전환 체크리스트 1~7), 0.2절, 19절, 18절 Q7
- `docs/SECURITY.md`의 "코드 오너 리뷰 필수", "봇 토큰의 `workflow` 권한 회수" 절
- 앞 step에서 만든·바꾼 파일: `scripts/commands/ops-check.ts`, `lab/ops-transition/`(`report.ts`, `results/`), `.github/CODEOWNERS`
- `docs/harness/workflow.md` 5절("승인 요청 전 조건", `pr-ready`)

## 작업

1. 제작자 작업 확인(요청은 step8의 승인 요청 때 이미 했다. 안 끝난 것만 다시 알린다)
   - 하네스 리포의 코드 오너 리뷰 필수 설정, 봇 PAT의 `workflow` 권한 회수와 머신·`revert` environment 시크릿 교체, 에이전트용 브라우저 프로필의 GitHub 로그아웃.
   - `node scripts/harness.ts ops-check`가 종료 코드 0인지 확인한다(체크리스트 1~3).

2. 하네스 리포 시험(체크리스트 6). 결과는 `lab/ops-transition/results/target-repo.json`에 남긴다(`report.ts`의 항목과 필수 사례에 더한다).
   - `workflow-push-rejected`: 버릴 브랜치에서 `.github/workflows/`의 주석 한 줄만 바꾼 커밋을 push해 거부되는지 본다. 거부 문구를 근거로 적는다. 거부되지 않았으면 그 원격 브랜치를 지우고 제작자에게 알린 뒤 멈춘다.
   - `low-risk-auto-merge`: 봇이 #57의 일부로 Issue를 등록하고(본문 첫 줄에 출처) 소규모 계획(위험도 낮음)으로 `lab/ops-transition/results/target-repo.json`에 위 사례를 적는 PR을 올린다. 보호 경로 밖 파일만 바꾼다. 사람 승인 없이 자동 병합되는지 본다.
   - `protected-needs-owner`: 아래 3번의 PR이 제작자 승인 전에는 병합되지 않는 것(`risk-gate` 실패, 리뷰 필요 상태)을 `pr-state` 출력과 함께 본다.

3. 전환 PR(이 step의 PR, 마지막 step이라 `Closes #57`)
   - `harness.config.json`: `stage`를 `operation`으로 바꾼다. 다른 키는 바꾸지 않는다.
   - 문서: 설계서 10.4절("구축 단계(현재)"·"운영 단계" 문단의 현재 표시, 체크리스트 항목별 확인 결과와 날짜), 0.1절 E1·0.2절(봇 권한 회수 반영), 19절(2단계 완료, 다음은 3단계 파일럿), 18절 Q7, 머리말 버전·변경 이력. `docs/SECURITY.md` 자격증명 표의 봇 토큰 행(권한에서 `workflow` 제거)과 강제 장치 요약. `AGENTS.md`·`CLAUDE.md`에 단계가 적힌 곳이 있으면 맞춘다. 절차서 5절(운영 단계에서는 보호 경로 PR이 모두 제작자 승인 대상임). `tech-debt-tracker.md`: TD-1 해결, TD-13·TD-38을 결과에 맞게. `CHANGELOG`.
   - `lab/ops-transition/results/target-repo.json`에 `protected-needs-owner` 사례를 승인 전 상태로 기록한다(승인 뒤에는 커밋을 더하지 않는다).
   - PR 본문에 체크리스트 1~6의 확인 결과를 표로 적는다: 항목, 확인 방법(명령 또는 결과 파일), 결과.
   - 초안으로 올리고, 완료 처리·기록·`origin/main` 병합·`check`가 끝난 뒤 `pr-ready`로 승인을 요청한다. 이 PR은 `stage` 변경 신호와 보호 경로 변경으로 제작자 head 승인이 있어야 병합된다.

4. 병합 뒤 확인(진행 로그에는 병합 전에 적을 수 없으므로 Issue #57 댓글로 남긴다): main의 `stage`가 `operation`이다. 다음 세션의 `start`가 깨끗하다.

## Acceptance Criteria

```bash
node scripts/harness.ts ops-check
node lab/ops-transition/report.ts --all
grep -q '"stage": "operation"' harness.config.json
test -f lab/ops-transition/results/target-repo.json
node scripts/harness.ts doc-lint
```

## 금지사항

- `ops-check`가 통과하지 않았거나 `report.ts --all`이 실패한 상태에서 `stage`를 바꾸는 PR의 초안을 해제하지 마라. 이유: 체크리스트 7번은 1~6을 충족한 뒤에만 한다(10.4절).
- 이 PR을 봇이 승인하거나 승인 없이 병합되게 하려고 설정·검사를 고치지 마라. 이유: R20, R4. 운영 단계 전환은 제작자 승인으로만 된다.
- 승인을 요청한 뒤 이 PR에 커밋을 더 올리지 마라. 이유: 승인은 head에 묶여 있다. 병합 뒤 기록은 Issue 댓글로 남긴다.
- 워크플로 push 거부 시험을 실제 변경이 든 브랜치나 열린 PR의 브랜치에서 하지 마라. 이유: 거부되지 않았을 때 지워야 하는 브랜치다. 버릴 브랜치에서만 한다.
- `harness.config.json`에서 `stage` 말고 다른 판정 관련 키를 함께 바꾸지 마라. 이유: 전환 PR의 변경을 제작자가 한눈에 확인할 수 있어야 한다.
