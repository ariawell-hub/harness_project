# Step 1: patch-id

## 읽어야 할 파일

- `lab/q20/README.md`, `lab/q20/deploy.ts`(step0)
- `docs/harness/design.md` 10.3절 "승인 결속 기준"

## 작업

항목 `patch-id`: 설계서 10.3절의 승인 결속(merge-base 대비 diff의 `git patch-id --stable`)이 ADR-0006의 PR 갱신 방식(`origin/main` 병합 + 일반 push)으로 실제 GitHub 흐름에서 유지되는지 확인한다. 진짜 자격증명은 필요 없다.

1. 시험 리포에 PR A(파일 `a.txt` 수정)를 연다. main에 다른 파일 `b.txt`를 바꾸는 PR B를 병합한다.
2. A를 두 방식으로 최신화하고 각각 갱신 전후 patch-id를 비교한다.
   - (1) main 병합 커밋을 만들어 일반 push. 세션·runner가 쓰는 방식이다(ADR-0006). 작업 트리 없이 git 객체로 만든다(`deploy.ts`와 같은 방식, R3).
   - (2) GitHub "Update branch"(`gh api -X PUT repos/.../pulls/<n>/update-branch`, merge 방식).
3. 겹치는 경우: main에서 `a.txt`를 바꾼 뒤 A에 main을 병합(충돌 해결)하면 patch-id가 달라지는지 확인한다.
4. A가 main 최신일 때 squash 병합 결과 트리가 PR head 트리와 같은지 확인한다(10.3절의 전제). 시험 리포의 "최신 브랜치 필수" 설정은 바꾸지 않고(R20), 병합 직전에 최신임을 확인한 뒤 병합한다.
5. patch-id 계산은 `lab/q20/patch-id.ts <PR 번호>`로 스크립트화한다. 시험 리포를 fetch하고 merge-base 대비 diff의 patch-id를 출력한다.
6. 결과를 `lab/q20/results/patch-id.json`에 기록한다. 근거는 PR URL과 각 시점의 head SHA·patch-id다.

## Acceptance Criteria

```bash
node lab/q20/report.ts --item patch-id
```

## 금지사항

- force push(`--force`, `--force-with-lease`)를 하지 마라. 이유: R14, ADR-0006. 갱신은 병합 커밋 + 일반 push로 한다.
- 시험 리포 main에 직접 push하지 마라. 이유: R2.
- 시험 리포의 브랜치 보호 설정을 바꾸지 마라. 이유: R20.
- 시험 리포를 worktree 밖에 클론해 작업 트리로 고치지 마라. 이유: R3(계획 의사결정 로그).
