---
id: 20261113-windows-tests
issue: 48 # GitHub Issue 번호
type: test # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: low # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-13T16:53:39+09:00 # new-task가 채운다
---

# test: Windows에서 실패하는 하네스 테스트 3건

## 목표와 수용 기준

Windows 네이티브(Git Bash, ADR-0005)에서 하네스 자체 테스트가 실패해 push 전 `check`를 통과할 수 없다(Q20 step3 PR #47). 원인은 모두 테스트가 Windows를 고려하지 않은 것이고 하네스 동작은 맞다. 테스트를 고쳐 Windows와 CI(ubuntu) 모두에서 통과시킨다.

수용 기준:

1. `scripts/test/start.test.ts`, `scripts/test/task.test.ts`, `scripts/test/guard.test.ts`가 Windows(개발자 모드 꺼짐, `core.autocrlf=true`)에서 통과한다.
2. 같은 테스트가 CI(ubuntu)의 `check`에서도 통과한다.
3. 검사를 약화시키지 않는다(R4). 각 테스트가 원래 확인하던 동작(LF 내용, 심볼릭 링크 → 하드 링크 대체 순서, 리포 루트 삭제 차단)은 그대로 확인한다.

## 범위 / 비범위

- 범위: 위 테스트 3개와 테스트 도우미 `scripts/test/helpers.ts`.
- 비범위: 하네스 동작 코드(`scripts/commands/`, `scripts/hooks/` 등), 개발자의 PATH·개발자 모드 같은 로컬 환경 설정(제작자가 직접 한다), gitleaks를 PATH에서 찾지 못할 때 runner 테스트가 실패하는 것(환경 준비 문제, 아래 발견 사항).

## 관련 파일·문서

- scripts/test/helpers.ts
- scripts/test/start.test.ts
- scripts/test/task.test.ts
- scripts/test/guard.test.ts
- docs/exec-plans/active/20261113-windows-tests/

## step 목록

- step0 windows-tests: 테스트 3개를 Windows에서도 통과하게 고친다

## 진행 로그

- 2026-11-13 16:55 (KST) 계획 작성(대화 세션, Issue #48). 원인 확인 기록:
  - gitleaks를 PATH에 넣고 `node --test scripts/test/*.test.ts`를 main 체크아웃에서 실행하면 143개 중 140개 통과, 3개 실패(아래 3건). gitleaks가 PATH에 없으면 runner 테스트 8개가 `check:secret-scan` 실패로 추가로 실패한다.
  - `start.test.ts` (a): `'r\r\n' !== 'r\n'`. fixture 리포에 `.gitattributes`가 없어 Windows Git 기본값 `core.autocrlf=true`로 CRLF 체크아웃된다.
  - `task.test.ts` linkFile: 실제 연산이 `hardlink`. 개발자 모드가 꺼진 Windows는 심볼릭 링크를 만들 수 없다(ADR-0005가 예상한 대체 경로).
  - `guard.test.ts` 파일 도구: `rm -rf ${wt}`에 따옴표 없는 `C:\…` 경로가 들어가 bash 규칙대로 역슬래시가 이스케이프로 풀린다. 같은 경로를 작은따옴표·큰따옴표·`/` 표기로 넣으면 R14로 막히는 것을 확인했다(대화 세션의 재현 스크립트).
- 2026-11-13 17:10 (KST) step0: 고치기 전 worktree에서 AC 실행 36개 중 3개 실패(위 3건). `makeFixture`에 `.gitattributes` 복사, linkFile 테스트를 심볼릭 링크 가능 여부에 따라 기대값을 정하게, guard 테스트 `rm -rf` 경로를 작은따옴표로 감쌌다. AC 36개 통과. gitleaks를 PATH에 넣고 `node scripts/harness.ts check` 전체 통과(test 143개 포함). 이 PC(Windows, 개발자 모드 꺼짐)에서 `check`가 통과한 첫 기록이다.

## 의사결정 로그

- 결정: fixture(`makeFixture`)에 하네스 리포의 `.gitattributes`를 복사한다. / 이유: 실제 리포와 같은 조건(LF 고정)에서 시험한다. / 버린 대안: fixture에 `core.autocrlf=false` 설정(실제 리포가 기대는 `.gitattributes`를 시험하지 않는다), 테스트에서 줄바꿈을 정규화해 비교(실제로 CRLF가 생기는 문제를 가린다).
- 결정: linkFile 테스트는 같은 임시 폴더에서 심볼릭 링크를 만들 수 있는지 먼저 확인하고, 가능하면 `symlink`, 아니면 `hardlink`를 기대한다. 대체 순서는 주입한 연산으로 지금처럼 검사한다. / 이유: 링크 방식은 환경이 정하고, ADR-0005가 두 경우를 모두 정상으로 본다. / 버린 대안: Windows에서 건너뛰기(R4 위반), 항상 `hardlink`도 허용(macOS·Linux에서 심볼릭 링크를 쓰지 않게 되는 퇴행을 못 잡는다).
- 결정: guard 테스트의 `rm -rf ${wt}`를 `rm -rf '${wt}'`로 바꾼다. / 이유: 에이전트가 실제로 칠 bash 명령의 형태이고, 따옴표 없는 Windows 경로는 bash에서 다른 경로가 되므로 막지 않는 것이 맞다. / 버린 대안: guard가 따옴표 없는 역슬래시 경로도 Windows 경로로 해석(bash와 다르게 해석하면 오탐·미탐이 생긴다).

## 발견 사항

- gitleaks가 PATH에 없으면 runner 테스트 8개가 실패한다(테스트 속 runner가 `check`의 secret-scan을 통과하지 못해 멈춘다). winget으로 설치한 뒤에도 `%LOCALAPPDATA%\Microsoft\WinGet\Links`가 비어 있어 별칭이 PATH에 잡히지 않았다(심볼릭 링크 권한이 없어서로 보인다). 환경 준비 문제라 코드로 고치지 않는다. → 처리: 해당 없음(제작자에게 PATH 추가 방법을 안내했다, 대화 2026-11-13)

## 열린 질문

- 없음

## 검증 방법과 결과

- 명령: step0 AC(`node --test scripts/test/start.test.ts scripts/test/task.test.ts scripts/test/guard.test.ts`), `node scripts/harness.ts check`(gitleaks를 PATH에 넣고), PR의 CI `check`.
- 결과: Windows에서 AC 36개 통과, `check` 전체 통과(2026-11-13). CI 결과는 PR에서 확인한다.

## 다음 할 일

- PR을 병합하면 완료. 남은 일 없음.
