---
status: active
related_code: [scripts/]
review_cycle: on-change
---

# 하네스 코드 구조

하네스 코드는 모두 `scripts/` 아래 TypeScript이며 Node 22.18+가 빌드 없이 바로 실행한다([ADR-0001](../decisions/ADR-0001-script-language.md)). 런타임 의존성은 없고 `node:` 내장 모듈만 쓴다.

## 레이어

의존은 위에서 아래로만 흐른다.

```
진입점      scripts/harness.ts (CLI)          scripts/hooks/guard.ts (L1 훅)
              │                                     │
명령·runner  commands/  (표준 명령, check, new-task, complete-step, start, init)
             runner/    (run: 루프, next: 우선순위·새 Issue 작성자 확인, agents: 세션, prompt)
              │
게이트       gates/     (plan-gate, doc-lint, bypass-scan, secret-scan)   hooks/rules.ts, hooks/shell.ts
              │
라이브러리   lib/       (exec, git, config, plan, attempts, github, util)
```

| 모듈              | 책임                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/exec.ts`     | 시간 제한 프로세스 실행, 프로세스 그룹 정리. 셸 명령은 macOS·Linux `/bin/sh`, Windows Git Bash. Windows 실행 파일 확인(`.cmd` 래퍼 거부) (ADR-0005)                                          |
| `lib/git.ts`      | worktree·git-dir·트리 해시·diff 도우미, main 체크아웃 fast-forward, PR 브랜치 main 병합 갱신(`updateBranchFromBase`, 일반 push만, ADR-0006), 원격 브랜치 갈라짐 판정(`remoteBranchDiverged`) |
| `lib/config.ts`   | `harness.config.json` 로드·검증                                                                                                                                                              |
| `lib/plan.ts`     | 계획 frontmatter·섹션·`index.json`·step AC·브랜치 이름                                                                                                                                       |
| `lib/attempts.ts` | 실패 기록(`.git/.../harness/attempts.jsonl`), 3회/5회·총량 판정                                                                                                                              |
| `lib/github.ts`   | `GitHubPort`(gh CLI). `github-fake.ts`는 테스트·스모크용                                                                                                                                     |
| `gates/*`         | 기계 검사. 에러 메시지는 "무엇 + 고치는 법 + 근거"                                                                                                                                           |
| `hooks/*`         | 도구 실행 직전 금지 규칙(R1~R4, R10, R13, R14, R20). POSIX·PowerShell·cmd 방언과 셸 래퍼 재귀, 명령 이름은 대소문자·확장자 무시 (ADR-0005)                                                   |
| `runner/*`        | 다음 할 일 고르기 → 새 세션 → AC·check로 직접 판정 → PR                                                                                                                                      |

## 상태가 사는 곳

| 상태                         | 위치                                                  | 이유                                      |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| 계획·step 상태               | `docs/exec-plans/` (git)                              | 인수인계 문서. 병합으로만 main에 들어간다 |
| 실패 기록                    | `$(git rev-parse --git-dir)/harness/attempts.jsonl`   | 작업 트리 밖. 캐시·승인을 깨지 않는다     |
| check 캐시, runner 로그·lock | `$(git rev-parse --git-common-dir)/harness/`          | worktree끼리 공유                         |
| 선점                         | 원격 `claim/<issue>` 브랜치                           | push 거부로 원자적 선점                   |
| runner 세션 원본 출력        | `$(git rev-parse --git-common-dir)/harness/sessions/` | 무인 세션이 왜 멈췄는지 본다(Issue #16)   |

runner는 세션이 끝날 때마다 `runner.jsonl`에 `session-end`를 남긴다: 세션 id, 턴 수, 종료 이유, 권한 거부 개수와 도구 이름(`deniedTools`), 원본 출력 파일(`log`). Claude 세션의 전체 기록은 Claude Code가 `~/.claude/projects/<worktree 경로를 - 로 바꾼 이름>/<세션 id>.jsonl`에 남긴다. `dontAsk` 권한 프로필이 조용히 거부한 도구는 `deniedTools`로 먼저 확인한다.

## 설정과 프로파일

- `harness.config.json`: 단계(`stage`), 표준 명령 정의, 한도(Q19), 보호 경로, 에이전트 실행 인자. 보호 경로다.
- `profiles/<이름>/profile.json`: 프로파일이 채우는 값. `node scripts/harness.ts init --profile web`이 설정에 병합한다. 코어 코드는 프로파일을 몰라도 된다(S5).

## 테스트

`scripts/test/*.test.ts` (node:test). 임시 git 리포 + 로컬 bare 원격 + 가짜 GitHub(`HARNESS_FAKE_GH`) + 가짜 에이전트(`HARNESS_FAKE_AGENT`)로 runner 전체 흐름까지 검사한다.
