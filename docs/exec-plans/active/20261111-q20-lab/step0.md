# Step 0: lab-scaffold

## 읽어야 할 파일

- `docs/decisions/ADR-0004-q20-lab-repo.md`
- `docs/harness/design.md` Q20 행, 10.3절, 10.4절
- `docs/exec-plans/active/20261111-q20-lab/plan.md`

## 작업

시험 리포 `ariawell-hub/harness-q20-lab`을 하네스 리포에서 다루는 도구를 만들고, 기준 내용을 배포하고, merge queue 가능 여부(항목 `merge-queue`)를 기록한다.

1. `lab/q20/README.md`: 목적, 디렉터리 구조, 배포 방법, 결과 형식, ADR-0004 링크. "시험이 끝나면 step6에서 시험 소스를 지운다"를 적는다.
2. `lab/q20/repo/`: 시험 리포 main 트리의 원본이다. 지금은 `README.md` 하나만 둔다. 워크플로는 이후 step이 `lab/q20/repo/.github/workflows/`에 추가한다.
3. `lab/q20/deploy.ts`(Node 22, 외부 의존성 없음):
   - `node lab/q20/deploy.ts --branch q20/<이름> [--overlay <디렉터리>] [--title <제목>] [--merge]`
   - 시험 리포 원격은 URL 상수 `https://github.com/ariawell-hub/harness-q20-lab.git`로 쓴다. 하네스 리포의 remote 설정은 바꾸지 않는다.
   - 기본 모드: **커밋된** `HEAD:lab/q20/repo` 트리를 그대로 쓰고, 부모를 시험 리포 main 끝으로 하는 커밋을 `git commit-tree`로 만든다.
   - `--overlay` 모드(공격 PR용): 시험 리포 main 트리 위에 overlay 디렉터리(커밋된 `HEAD:<디렉터리>`)의 파일만 덮어쓴 트리를 만든다. 임시 index는 `git rev-parse --git-dir` 아래에 둔다(`GIT_INDEX_FILE`).
   - 만든 커밋을 `refs/heads/q20/<이름>`으로 push하고 `gh pr create -R ariawell-hub/harness-q20-lab`로 PR을 연다. 이미 PR이 있으면 PR URL만 출력한다.
   - `--merge`면 `gh pr merge --squash`로 병합한다. 시험 리포 내용을 바꿀 때만 쓰고, 공격 PR에는 쓰지 않는다.
   - 작업 트리 파일을 쓰지 않는다. git 객체와 임시 index만 만든다.
   - 출력: 브랜치, 커밋 SHA, PR URL을 JSON 한 줄로.
4. `lab/q20/report.ts`: `--item <이름>` 또는 `--all`.
   - `lab/q20/results/<항목>.json`을 검사한다. 형식: `{ "item": string, "summary": string, "cases": [{ "name", "expected", "observed", "verdict": "pass"|"fail"|"partial"|"n/a", "evidence": string[] }] }`
   - case가 1개 이상이어야 한다. `n/a`가 아니면 evidence가 1개 이상이어야 하고, `n/a`면 observed에 이유가 있어야 한다.
   - `--all`은 7개 항목(`env-ref`, `patch-id`, `check-source`, `judge-claude`, `judge-codex`, `codex-auth`, `merge-queue`)이 모두 있는지 본다.
   - 문제가 있으면 무엇이 빠졌는지 출력하고 종료 코드 1.
5. `lab/q20/test/*.test.ts`(`node --test`): report 검사 규칙과 deploy의 트리 구성(로컬 bare 원격으로, 기본·overlay 모드)을 테스트한다. 먼저 실패하는 테스트를 쓴다(R5).
6. 기준 배포: `node lab/q20/deploy.ts --branch q20/baseline --merge`. 시험 리포 main이 `lab/q20/repo`와 같아진다.
7. 항목 `merge-queue`: GraphQL `repository { mergeQueue(branch: "main") { id } }` 응답, rulesets API 응답, GitHub 문서 근거를 모으고, 제작자에게 시험 리포 설정 화면에서 merge queue 규칙을 켤 수 있는지 확인을 받아 `lab/q20/results/merge-queue.json`에 기록한다. 쓸 수 없으면 설계서 10.3절의 대안("최신 브랜치 필수 + 새 head의 `check`")이 있으므로 판정은 `fail`로 두고 영향 없음을 summary에 적는다.

## Acceptance Criteria

```bash
node --test lab/q20/test/*.test.ts
node lab/q20/report.ts --item merge-queue
gh api repos/ariawell-hub/harness-q20-lab/contents/README.md --jq .name
```

## 금지사항

- 시험 리포 main에 직접 push하지 마라. 이유: 시험 리포도 하네스 리포와 같은 PR 흐름으로 다뤄야 결과가 실제 환경을 반영한다(R2).
- 하네스 리포 `.github/`에 시험 워크플로를 넣지 마라. 이유: 하네스 CI가 시험 코드를 실행하게 된다.
- worktree 밖 파일을 만들거나 고치지 마라. 이유: R3.
