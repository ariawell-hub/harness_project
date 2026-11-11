# Step 1: patch-id

## 읽어야 할 파일

- `lab/q20/README.md`, `lab/q20/deploy.ts`(step0)
- `docs/harness/design.md` 10.3절 "승인 결속 기준"

## 작업

항목 `patch-id`: 설계서 10.3절의 승인 결속(merge-base 대비 diff의 `git patch-id --stable`)이 실제 GitHub 흐름에서 유지되는지 확인한다. 진짜 자격증명은 필요 없다.

1. 시험 리포에 PR A(파일 `a.txt` 수정)를 연다. main에 다른 파일 `b.txt`를 바꾸는 PR B를 병합한다.
2. A를 두 방식으로 최신화하고 각각 patch-id를 비교한다.
   - (1) 로컬 rebase 뒤 `--force-with-lease` push. runner가 쓰는 방식과 같다.
   - (2) GitHub "Update branch"(`gh api -X PUT repos/.../pulls/<n>/update-branch`, merge 방식).
3. 겹치는 경우: main에서 `a.txt`를 바꾼 뒤 A를 rebase(충돌 해결)하면 patch-id가 달라지는지 확인한다.
4. "최신 브랜치 필수"일 때 squash 병합 결과 트리가 PR head 트리와 같은지 확인한다(10.3절의 전제).
5. patch-id 계산은 `lab/q20/patch-id.ts <PR 번호>`로 스크립트화한다. 시험 리포를 fetch하고 merge-base 대비 diff의 patch-id를 출력한다.
6. 결과를 `lab/q20/results/patch-id.json`에 기록한다. 근거는 PR URL과 각 시점의 head SHA·patch-id다.

## Acceptance Criteria

```bash
node lab/q20/report.ts --item patch-id
```

## 금지사항

- `--force`(lease 없음)로 push하지 마라. 이유: R2. runner와 같은 `--force-with-lease`만 쓴다.
- 시험 리포 main에 직접 push하지 마라. 이유: R2.
