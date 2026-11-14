# Step 6: wrap-up

## 읽어야 할 파일

- `lab/q20/results/*.json`
- `docs/exec-plans/active/20261111-q20-lab/plan.md`
- `docs/harness/design.md` Q20 행, 19절, 13.3절, 10.4절
- `docs/decisions/ADR-0004-q20-lab-repo.md`

## 작업

1. plan.md "검증 방법과 결과"에 항목별 판정·근거 요약 표를 채운다.
2. 설계서 반영
   - Q20 행: 항목별 결과 요약과 "통과" 또는 "조건부 통과(무엇을 고쳤는지)".
   - 실패·부분 통과 항목은 해당 절을 고치거나, 제작자 결정이 필요하면 열린 질문으로 올린다. E3가 바뀌면 새 ADR.
   - 변경 이력, `docs/harness/CHANGELOG.md`, 기술 부채 목록(TD-1·TD-2 비고).
3. 제작자에게 정리를 요청하고 결과를 확인한다.
   - 진짜 자격증명 교체(Claude 토큰 폐기, Codex 재로그인), 시험 App 삭제, 봇 초대 철회, 시험 리포 보관
4. 봇으로 ADR-0004 확인 명령을 실행해 하네스 리포 하나만 나오는지 기록한다.
5. `lab/q20/repo/`, `lab/q20/attacks/`, `lab/q20/deploy.ts`, `lab/q20/patch-id.ts`를 트리에서 지운다. `lab/q20/README.md`, `lab/q20/report.ts`, `lab/q20/test/`의 report 테스트, `lab/q20/results/`는 남긴다. README에 "소스는 git 이력에 있다"와 마지막 커밋 SHA를 적는다.

## Acceptance Criteria

```bash
node lab/q20/report.ts --all
test "$(gh api 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100' --jq '[.[].full_name] | join(",")')" = "ariawell-hub/harness_project"
node scripts/harness.ts check
```

## 금지사항

- 실패한 항목을 통과로 바꿔 적지 마라. 이유: 2단계 착수 판단의 근거다.
- 제작자 확인 없이 E3·ADR-0003·ADR-0004 결정을 바꾸지 마라. 이유: 하네스 원칙 변경은 제작자에게 묻는다(workflow.md 7절).
