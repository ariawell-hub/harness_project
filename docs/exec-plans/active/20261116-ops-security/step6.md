# Step 6: test-repo

이 step은 대화 세션이 실행한다. 제작자 작업(테스트 리포 준비)과 실제 GitHub이 필요해 runner 세션으로는 끝낼 수 없다.

## 읽어야 할 파일

- `docs/exec-plans/active/20261116-ops-security/plan.md` (수용 기준 7, "다음 할 일"의 제작자 작업)
- `docs/harness/design.md` 10.4절 운영 전환 체크리스트 5·6, 16절 "새 프로젝트", 12.4절, 0.2절
- `docs/SECURITY.md`의 "테스트 리포 준비 (제작자, #102 step6)" 절, `docs/decisions/ADR-0004-q20-lab-repo.md`
- `lab/q20/README.md`, `lab/q20/report.ts`, `lab/q20/test/`(결과 형식과 완결성 검사)
- `docs/exec-plans/tech-debt-tracker.md`의 TD-38(실제 GitHub에서 보지 못한 경로), TD-1
- 앞 step과 #57 계획(`20261116-ops-transition`)의 step0~2가 만든·바꾼 파일(모두 먼저 병합돼 있어야 한다): `.github/workflows/revert.yml`, `scripts/ci/revert.ts`, `scripts/commands/task.ts`(`restorePlan`), `scripts/selftest/`, `.github/workflows/gates.yml`(`selftest` job), `scripts/commands/ops-check.ts`, `.github/CODEOWNERS`

## 작업

1. 결과 기록 틀: `lab/ops-transition/`
   - `README.md`(시험 리포 이름, 날짜, 결과 형식, 실행 방법), `results/<항목>.json`, `report.ts`, `test/report.test.ts`.
   - 결과 형식은 `lab/q20/README.md`의 것과 같다(`item`, `summary`, `cases[]`: `name`·`expected`·`observed`·`verdict`·`evidence`).
   - `report.ts --item <항목>` / `--all`: 기록 완결(필드, `n/a`가 아니면 근거 1개 이상)을 검사하고, 아래 "필수 사례"가 모두 있고 `verdict`가 `pass`일 때만 종료 코드 0이다. 필수가 아닌 사례는 `fail`·`partial`이어도 기록이 완결되면 통과다. 자격증명 값은 적지 않는다.
   - 항목과 필수 사례:
     - `selftest`: `ci-check`(테스트 리포의 `check`에서 자체 테스트 통과), `live`(`self-test --live` 통과율 기록. 판정은 세 시나리오 모두 1회 이상 통과면 `pass`)
     - `flow`: `runner-unattended`(제작자가 만든 Issue를 runner가 선점 → 계획 검증 초안 PR → 두 검증자의 계획 승인 → step → PR → 교차 검증 → 계획 완료 커밋 → 자동 병합까지 사람 개입 없이), `carry-over`(승인된 PR을 main 병합으로 갱신하면 판정 없이 `이어받음`), `no-carry`(PR 파일이 바뀐 갱신은 다시 판정)
     - `revert`: `rerun-first`(main `check` 첫 실패에서 재실행만), `revert-pr`(두 번째 실패에서 `revert/<SHA>` PR, `revert-check` success, `review/*` "해당 없음", 자동 병합), `issue-reopen`(원래 Issue가 다시 열리고 표식 댓글이 있다), `plan-restore`(`new-task --issue`가 계획을 복원), `tampered`(여분 변경을 더한 `revert/` PR은 `revert-check` 실패로 병합되지 않는다)
     - `guard-selftest`: `protected-pr`(보호 경로 PR에서 `selftest` job이 돌고 `harness-guard` 설명에 반영), `non-protected-pr`(보호 경로 밖 PR에서는 돌지 않는다)
     - `codeowners`: `owner-required`(코드 오너 리뷰 필수·승인 수 0 설정에서 보호 경로 PR은 제작자 승인 전 병합되지 않는다), `auto-merge`(보호 경로 밖 PR은 사람 승인 없이 자동 병합된다)
     - `workflow-scope`: `push-rejected`(`workflow` 권한 없는 봇 토큰의 워크플로 파일 push가 거부된다). 필수 아님: `update-after-workflow-change`(main에 워크플로 변경이 들어간 뒤 PR 브랜치를 main 병합으로 갱신하는 push가 되는가), `revert-of-workflow`(워크플로를 바꾼 커밋의 revert push)
     - `stage`: `operation-pr`(테스트 리포에서 `stage`를 `operation`으로 바꾸는 PR이 제작자 승인으로만 병합된다)
     - `td38`(필수 아님): TD-38의 "가짜 GitHub으로만 확인한 것" 목록 가운데 이번에 실제로 본 것과 못 본 것

2. 테스트 리포 준비와 실행(순서)
   1. 제작자에게 `docs/SECURITY.md` "테스트 리포 준비" 절의 작업을 요청하고 끝났는지 확인한다(봇 토큰으로 리포 조회, `required-checks`를 테스트 리포 체크아웃에서 실행).
   2. 하네스 main을 테스트 리포에 올린다(이 리포의 이력 없이 트리만 담은 첫 커밋. `harness.config.json`의 `github.owner`·`bot`·`ci.recorderAppId`는 테스트 리포 값으로, `stage`는 `build`). 테스트 리포의 main 보호 때문에 첫 내용은 제작자가 정한 방법(빈 리포의 첫 push 또는 PR)으로 넣는다.
   3. 필수 체크는 각 체크가 한 번 보고된 뒤 제작자가 등록한다(부트스트랩, 10.4절). 등록 뒤 `required-checks` 통과를 확인한다.
   4. 위 사례를 하나씩 실행하고 결과 파일에 근거(PR·실행 URL)를 적는다. main을 일부러 깨는 PR(예: 병합 뒤에만 실패하는 날짜 의존 테스트)은 테스트 리포에서만 만든다.
   5. `workflow-scope`와 `stage` 사례는 마지막에 한다(제작자가 봇 PAT를 재발급한 뒤). 재발급 뒤 `ops-check`를 테스트 리포에서 실행해 결과를 적는다.
   6. 끝나면 제작자에게 뒷정리(테스트 리포의 자격증명 교체, 봇 초대 철회, 리포 보관)를 요청하고 ADR-0004의 확인 명령 결과를 진행 로그에 적는다.

3. 결함 처리: 시험에서 하네스 결함이 드러나면 진행 로그와 "발견 사항"에 적는다. 이 step의 PR에서 고칠 수 있는 것은 문서와 `lab/ops-transition/`뿐이다. 코드를 고쳐야 하면 계획에 새 step을 더해(계획만 담은 커밋으로 다시 검증받는다) 고친 뒤 사례를 다시 실행한다. 고치지 않기로 한 것은 TD로 등록한다.

4. 문서: 설계서 10.4절 체크리스트 5(결과 위치 `lab/ops-transition/results/`), 16절(도입 절차에서 실제로 걸린 곳을 반영), 19절 2단계(무인 시범 실행 결과), `tech-debt-tracker.md`(TD-38·TD-1 갱신), `docs/index.md`에 필요하면 한 줄, `CHANGELOG`, 설계서 버전·변경 이력.

## Acceptance Criteria

```bash
node --test lab/ops-transition/test/report.test.ts
node lab/ops-transition/report.ts --all
test -f lab/ops-transition/results/revert.json
test -f lab/ops-transition/results/flow.json
node scripts/harness.ts doc-lint
```

## 금지사항

- 하네스 리포(`harness_project`)의 main을 일부러 깨거나 시험용 PR을 하네스 리포에 올리지 마라. 이유: revert 시험과 공격·시험 PR은 테스트 리포에서만 한다(ADR-0004).
- 테스트 리포의 보호 설정·environment·시크릿·App을 봇이 만들거나 바꾸지 마라. 이유: R20. 제작자가 한다.
- 관찰하지 못한 사례를 `pass`로 적지 마라. 이유: 이 기록이 운영 전환(step7)의 근거다. 못 봤으면 `n/a`와 이유를 적고, 필수 사례면 step을 끝내지 않는다.
- 결과 파일·로그에 자격증명 값이나 그 일부를 적지 마라. 이유: R10. 필요하면 sha256 앞 8자만 쓴다.
- 이 step의 PR에서 `scripts/`·`.github/`를 고치지 마라. 이유: 시험에서 나온 수정은 새 step으로 계획 검증을 거친다(TD-32).
- 테스트 리포에서 쓴 진짜 자격증명을 시험 뒤 그대로 두지 마라. 이유: ADR-0004. 교체와 봇 초대 철회를 요청하고 확인한다.
