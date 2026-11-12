# Step 0: merge-procedure

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-pr-update-merge/plan.md` (목표, 의사결정 로그, 발견 사항)
- `docs/harness/workflow.md` 5절 PR, 7절 에스컬레이션
- `docs/harness/design.md` 4.5절 "다음 할 일 우선순위", 10.3절 "승인 결속 기준"·"절차", 14.4절 R14 표, 맨 앞 버전 이력
- `docs/decisions/index.md`, `docs/decisions/ADR-0005-windows-native.md` (ADR 형식 예)
- `docs/exec-plans/tech-debt-tracker.md` (TD-9, TD-21 행 형식)
- `docs/harness/CHANGELOG.md` "다음 버전 (미배포)"
- `scripts/runner/run.ts`의 `doRebase`와 step 완료 push(일반 push 실패 시 `--force-with-lease` 폴백) — 읽기만 한다

## 작업

문서만 바꾼다. 코드는 step1에서 바꾼다.

1. **ADR-0006** `docs/decisions/ADR-0006-pr-update-merge.md`를 만든다(frontmatter `status: active`, `related_code: [scripts/runner/, scripts/lib/git.ts, scripts/hooks/rules.ts]`, `review_cycle: on-change`). 섹션은 ADR-0005처럼 맥락 / 결정 / 버린 대안 / 결과로 쓴다.
   - 맥락: 설계서가 뒤처진 PR을 "rebase 후 재검사"로 정했다. 이미 push한 브랜치를 rebase하면 원격 갱신에 force push가 필요한데, R14와 L1 훅이 에이전트의 force push(`--force-with-lease` 포함)를 막는다. PR #14 사례(세션이 rebase로 충돌을 풀었지만 push가 막혀 `CONFLICTING`으로 멈춤, `-s ours` 병합으로 해결). 2단계에서 "main 최신 필수"를 켜면 갱신이 잦아진다.
   - 결정: 에이전트 세션과 runner 모두 PR 브랜치 갱신은 `origin/main`을 PR 브랜치에 병합하고 일반 push한다. 이미 push한 브랜치는 rebase하지 않는다. R14는 완화하지 않는다. 충돌은 세션이 병합 커밋 안에서 해결하고, runner는 병합을 취소하고 `needs-human`으로 넘긴다(2단계 자동 해결 전까지). 이미 로컬에서 rebase했다면 `git merge -s ours origin/<브랜치>`로 원격 이력을 연결한 뒤 일반 push한다(트리는 rebase 결과 그대로).
   - 10.3절 결속: main을 병합한 뒤의 merge-base는 병합한 main 커밋이므로 "merge-base 대비 diff"는 PR이 main에 더하는 변경과 같다. 충돌 없이 병합했으면 patch-id가 이전과 같아 승인을 이어받을 수 있고, 충돌을 해결하며 PR 변경이 바뀌면 patch-id가 달라져 다시 검증한다(rebase 때와 같은 규칙).
   - 버린 대안: 에이전트에 자기 작업 브랜치 `--force-with-lease` 허용(R14 완화, 훅이 "자기 브랜치"를 판정해야 함), 갱신할 때마다 새 브랜치·새 PR(PR 번호·검토 기록이 갈라짐), 제작자가 매번 직접 force push(사람 대기).
   - 결과: PR 커밋 목록에 병합 커밋이 남지만 squash 병합이라 main 이력에는 남지 않는다. runner 구현은 step1(Issue #22). runner step 완료 push의 lease 폴백은 TD-22.
2. `docs/decisions/index.md` 표에 ADR-0006 행을 더한다(상태: 채택).
3. **절차서** `docs/harness/workflow.md` 5절 PR 안에 하위 절 `### main에 뒤처지거나 충돌한 PR 갱신`을 더한다. 내용:
   - 명령(POSIX `sh`, worktree 경로와 브랜치 이름을 적는 1절 규칙을 따른다):
     ```bash
     git -C <worktree> fetch origin
     git -C <worktree> merge origin/main        # 충돌이면 파일을 고치고 git add 후 git commit
     node scripts/harness.ts check              # worktree 안에서
     git -C <worktree> push origin <브랜치>
     ```
   - rebase하지 않는 이유(force push가 필요하고 R14가 막는다, ADR-0006).
   - 이미 로컬에서 rebase했으면 `git -C <worktree> merge -s ours origin/<브랜치>` 뒤 일반 push.
   - 완료 커밋 뒤에 충돌 해결로 코드가 바뀌면 4절 규칙대로 step을 `in_progress`로 되돌린다.
   - 충돌을 풀 수 없거나 push가 막히면 우회하지 말고 7절 형식으로 Issue에 `needs-human` 라벨과 질문을 남긴다. 댓글만 남기면 `start` ①에 나오지 않는다.
4. **설계서** `docs/harness/design.md`:
   - 4.5절 우선순위 2번의 "main에 뒤처짐(rebase)"을 "main에 뒤처짐·충돌(`origin/main` 병합으로 갱신, ADR-0006)"으로 바꾼다. WIP 문장의 "rebase가 늘어나기"도 "갱신이 늘어나기"로 바꾼다.
   - 10.3절 결속 표·본문·절차 4번의 "rebase 뒤"를 "main 병합으로 갱신한 뒤"로 바꾸고, ADR-0006의 결속 설명(merge-base·patch-id)을 한두 문장으로 넣는다.
   - 14.4절 git 행의 대신 쓰는 방법에 "뒤처진 PR은 `origin/main` 병합으로 갱신한다(ADR-0006)"를 더한다.
   - 맨 앞 버전을 v0.7.8로 올리고 버전 이력에 한 줄을 더한다.
   - 그 밖의 "rebase" 표현(로드맵·시험 항목 등)은 뜻이 "PR 갱신"이면 같은 식으로 바꾼다. 문맥상 rebase 자체를 말하는 곳은 둔다.
5. `AGENTS.md` 작업 루프 6번(PR) 아래에 한 줄: main에 뒤처지거나 충돌한 PR은 rebase가 아니라 `origin/main` 병합으로 갱신한다(절차서 5절).
6. `docs/exec-plans/tech-debt-tracker.md`:
   - TD-9의 "rebase 충돌 자동 대응"을 "main 병합 충돌 자동 대응"으로 바꾼다.
   - TD-22 등록: runner step 완료 push가 일반 push 거부 시 자기 브랜치에 `--force-with-lease`로 덮어쓴다(`scripts/runner/run.ts`). 14.4절은 force push를 금지로 적고 runner 예외를 구분하지 않는다. 근거: Issue #22, ADR-0006. 다시 볼 때: 2단계 runner PR 흐름 연결 전.
   - TD-23 등록: 제작자 지시로 다른 작업자(runner 등) worktree를 넘겨받을 정식 방법이 없다. L1 R3가 계획 파일 수정을 막아 PR #14 갱신 기록을 Issue #4 댓글로 남겼다. 근거: Issue #4·#22, R3. 다시 볼 때: runner와 대화 세션을 함께 운영하기 전.
7. `docs/harness/CHANGELOG.md` "다음 버전 (미배포)"에 한 줄: 설계서 v0.7.8, PR 갱신을 main 병합으로(ADR-0006, Issue #22 step0), runner 구현은 step1.
8. 계획 `plan.md` 진행 로그와 "검증 방법과 결과"의 step0 결과를 갱신한다.

## Acceptance Criteria

```bash
test -f docs/decisions/ADR-0006-pr-update-merge.md
grep -q "ADR-0006" docs/decisions/index.md
grep -q "^### main에 뒤처지거나 충돌한 PR 갱신" docs/harness/workflow.md
grep -q "merge -s ours" docs/harness/workflow.md
grep -q "needs-human" docs/harness/workflow.md
grep -q "v0.7.8" docs/harness/design.md
! grep -n "main에 뒤처짐(rebase)" docs/harness/design.md
grep -q "ADR-0006" docs/harness/design.md
grep -q "ADR-0006" AGENTS.md
grep -q "TD-22" docs/exec-plans/tech-debt-tracker.md
grep -q "TD-23" docs/exec-plans/tech-debt-tracker.md
node scripts/harness.ts doc-lint
```

## 금지사항

- 코드(`scripts/`)를 고치지 마라. 이유: runner 변경은 테스트와 함께 step1에서 한다.
- R14·L1 훅 규칙을 완화하는 문장을 쓰지 마라. 이유: 제작자가 고른 방향은 "R14 유지 + 병합"이다.
- 설계서 버전 이력의 기존 줄을 고치지 마라. 이유: 이력은 덧붙이기만 한다.
