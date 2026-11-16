---
id: 20261116-win-node24-exit
issue: 99 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-16T10:32:44+09:00 # new-task가 채운다
---

# fix: Windows(Node 24)에서 로컬 check 실패 — fetch 뒤 process.exit 크래시, 심볼릭 링크 테스트

## 목표와 수용 기준

Windows PC(Node v24.12.0, 개발자 모드 꺼짐)의 main에서 `node scripts/harness.ts check`가 `test` 단계에서 실패한다. #57의 계획 커밋을 올리기 전 로컬 `check`에서 드러났고, #57과 무관한 실패라 먼저 고친다(절차서 5절).

- 원인 1: `scripts/harness.ts`는 명령이 끝나면 `process.exit(code)`를 부른다. `fetch`를 쓴 뒤에 불리면 Windows의 Node 24가 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`으로 죽는다(종료 코드 3221226505). `record.test.ts` 7개 중 4개가 매번 실패한다.
- 원인 2: `repro.test.ts`의 한 테스트가 디렉터리 심볼릭 링크를 만든다. 개발자 모드가 꺼진 Windows는 `EPERM`이다.
- 원인 3: 원인 1·2를 고친 뒤 전체 테스트(443개)를 돌려 Windows에서만 실패하는 테스트 5개를 더 찾았다. 모두 테스트가 POSIX 환경을 가정한 것이고 제품 코드의 동작은 맞다.
  - `claude-scan.test.ts` "…실제 경로가 밖이면(심볼릭 링크) 밖으로 본다": 원인 2와 같다(디렉터리 심볼릭 링크).
  - `binding.test.ts` "samePrContent: 파일 이름을 pathspec으로 해석하지 않는다": `:!a.txt`, `:!*` 이름의 파일을 작업 트리에 만든다. Windows는 `:`·`*`가 든 이름을 만들 수 없다(`ENOENT`).
  - `guard.test.ts` "승인 요청 규칙" 2개: 하나는 훅이 넘기는 `-C` 경로를 `/work/asked` 문자열과 비교한다(Windows에서는 `path.resolve`가 드라이브 문자를 붙인다). 다른 하나는 Windows 경로(`\`)를 POSIX 셸 명령 문자열에 그대로 넣는다(`\`는 이스케이프라 경로가 깨진다).
  - `codex-auth.test.ts` "restoreAuth: auth.json을 0600으로, 폴더를 0700으로…": Windows에는 POSIX 권한 비트가 없다(`chmod`는 읽기 전용 표시만 바꾸고 `stat`의 mode는 0666이다).

수용 기준:

1. `scripts/harness.ts`는 명령이 끝나면 종료 코드를 정하고 이벤트 루프가 비어 자연히 끝나게 한다. 명령이 남긴 핸들 때문에 끝나지 않는 경우에 대비해 정해 둔 시간 뒤에는 강제로 끝낸다(그 타이머는 프로세스를 붙잡지 않는다). 종료 코드의 뜻(성공 0, 실패 1, 사용법 2, `TaskError` 3)과 표준 출력·오류 내용은 그대로다.
2. 이 Windows PC에서 `node --test scripts/test/record.test.ts`가 3회 연속 통과한다.
3. `repro.test.ts`의 링크 테스트가 개발자 모드가 꺼진 Windows에서도 같은 것(리포 밖을 가리키는 링크 폴더에는 쓰지 않는다)을 확인한다. 건너뛰지 않는다.
4. 이 Windows PC에서 `node scripts/harness.ts check`가 종료 코드 0이다. Linux CI의 `check`도 통과한다.
5. 원인 3의 테스트 5개가 이 Windows PC와 Linux CI에서 모두 통과한다. 테스트를 건너뛰지 않고, 각 테스트가 확인하던 것은 Linux에서 그대로 확인한다. Windows에서 빠지는 단언은 `codex-auth.test.ts`의 POSIX 권한 비트 두 줄뿐이다(그 테스트의 나머지 단언은 Windows에서도 돈다).

## 범위 / 비범위

- 범위: `scripts/harness.ts`의 종료 처리, `scripts/test/repro.test.ts`의 링크 만들기, 종료 처리를 확인하는 테스트, 원인 3의 테스트 파일 4개(`claude-scan.test.ts`, `binding.test.ts`, `guard.test.ts`, `codex-auth.test.ts`)의 Windows 호환, 문서(`CHANGELOG`, 설계서 변경 이력, TD-14 비고).
- 비범위:
  - 원인 3과 관련된 제품 코드(`scripts/ci/`, `scripts/hooks/`, `scripts/lib/`). 고치는 것은 테스트뿐이다.
  - Git Bash의 `/c/…` 꼴 경로를 훅이 Windows 경로로 바꿔 읽는 일(발견 사항, TD-14).
  - `scripts/hooks/guard.ts`·`scripts/hooks/session.ts`의 `process.exit`. 두 진입점은 `fetch`를 쓰지 않고, 훅의 종료 코드 2는 차단 규약이라 건드리지 않는다.
  - Node 버전 고정이나 CI의 Windows 러너 추가(TD-15).
  - TD-14의 나머지 Windows 실기 검증 항목.

## 관련 파일·문서

- scripts/harness.ts
- scripts/test/
- docs/harness/design.md
- docs/harness/CHANGELOG.md
- docs/exec-plans/tech-debt-tracker.md
- docs/exec-plans/active/20261116-win-node24-exit/

## step 목록

- step0 exit-code: CLI 종료를 자연 종료로 바꾸고, POSIX 환경을 가정한 테스트를 Windows에서도 돌게 한다

## 진행 로그

- 2026-11-16 step0: 계획 작성. #57 계획 커밋 전 로컬 `check`가 `test` 단계에서 실패했다(787초, `record.test.ts` 4개와 `repro.test.ts` 1개). `record.test.ts`만 3회 반복해 3회 모두 같은 4개가 실패했다(흔들림이 아니다). 실험: `NODE_OPTIONS=--import`로 `harness.ts`의 `process.exit`를 "종료 코드만 정하고 자연 종료"로 바꿔 끼우면 `record.test.ts` 7개가 3회 모두 통과했다. `fetch` 한 번 뒤 `process.exit`만 하는 작은 스크립트로는 재현되지 않았다(요청 여러 개와 POST가 있어야 하는 것으로 보인다).
- 2026-11-16 step0: 계획 검증 1라운드에서 `review/codex`가 F1(P1, `TaskError` 종료 코드 3을 확인하는 테스트가 없다)을 냈다. step0 작업 3에 오류 갈래 테스트를 더해 2라운드에서 두 검증자가 승인했다(head `6b8a00a`).
- 2026-11-16 step0: 원인 1·2를 로컬에서 고친 뒤 `check`가 다시 `test` 단계에서 실패했다(803초). `check` 로그는 test 출력의 끝부분만 담아 실패 3개만 보였다. `node --test "scripts/test/*.test.ts"`를 파일로 받아 전체를 확인했다: 443개 중 5개 실패(원인 3의 5개). `record.test.ts`와 `repro.test.ts`는 통과했다. 범위가 늘어 계획을 고치고 계획 검증을 다시 받는다.
- 2026-11-16 step0: 범위를 넓힌 계획(head `8fbde5d`)에 `review/claude`는 승인, `review/codex`는 F2(P1, 강제 종료 타이머의 `unref`를 확인하는 기준이 없다)를 냈다. step0 작업 3에 동작(`--help`가 5초 안에 끝난다)과 구조(`setTimeout(…).unref()`) 확인을 더하고 AC에 두 줄을 더했다.

## 의사결정 로그

- 결정: `process.exit(code)` 대신 `process.exitCode`를 정하고 자연 종료한다. 강제 종료 타이머(`unref`)를 함께 둔다. / 이유: 크래시는 열린 핸들이 닫히는 도중 강제 종료할 때 난다. 자연 종료는 핸들이 정리된 뒤 끝난다. 타이머는 명령이 핸들을 남겨 끝나지 않는 회귀를 막는다. / 버린 대안: 테스트에서 Windows의 종료 코드를 무시하기(R4, 실제 명령이 죽는 것은 그대로다), Node 22로 내려 쓰기(`engines`는 22.18 이상이라 24도 지원 범위다).
- 결정: 링크 테스트는 `symlinkSync(…, 'junction')`으로 만든다. / 이유: Windows의 디렉터리 정션은 권한 없이 만들 수 있고 Node는 정션을 심볼릭 링크로 본다. 다른 OS에서는 이 인자가 무시된다. 테스트가 확인하는 것(밖을 가리키는 링크 폴더에 쓰지 않는다)은 같다. / 버린 대안: 권한이 없으면 건너뛰기(R4).
- 결정: 봇이 Issue #99를 등록했다. / 이유: 제작자가 지시한 #57의 push를 막는 선행 작업이다(절차서 5절 "무관한 검사 실패는 별도 PR로 먼저 고친다").

- 결정: 원인 3은 같은 계획·같은 step에 넣는다. / 이유: 수용 기준 4(이 PC의 `check` 종료 코드 0)를 막는 같은 종류의 실패이고 모두 테스트 파일만 고친다. 나누면 `check`가 통과하지 않는 PR이 하나 더 생긴다. / 버린 대안: 별도 Issue·PR(중간 PR의 로컬 `check`가 통과하지 못한다).
- 결정: `binding.test.ts`는 특수 이름 파일을 작업 트리에 쓰지 않고 `git update-index --add --cacheinfo`(`-c core.protectNTFS=false`)로 인덱스에 바로 넣어 커밋한다. 커밋에 그 이름들이 들어갔는지 `git ls-tree`로 확인한다. / 이유: `samePrContent`는 커밋끼리만 비교해 작업 트리가 필요 없다. 테스트가 확인하는 것(파일 이름을 pathspec으로 해석하지 않는다)은 모든 OS에서 같다. / 버린 대안: Windows에서 특수 이름을 빼기(Windows에서 확인하는 것이 줄어든다).
- 결정: `guard.test.ts`는 기대 경로를 `path.resolve('/work/asked')`로 만들고, 셸 명령에 넣는 worktree 경로는 `\`를 `/`로 바꾼다. / 이유: 훅은 `-C` 경로를 `path.resolve`로 절대 경로로 바꾼다(Windows에서는 드라이브 문자가 붙는 것이 맞다). Git Bash에서 사람이 쓰는 경로도 `C:/…` 꼴이다. Linux에서는 두 값이 지금과 같다. / 버린 대안: 훅이 경로를 정규화하지 않게 바꾸기(제품 동작을 테스트에 맞추는 것이다).
- 결정: `codex-auth.test.ts`의 권한 비트 단언 두 줄만 `process.platform !== 'win32'`일 때 확인한다. / 이유: Windows에는 POSIX 권한 비트가 없어 어떤 구현으로도 0600·0700을 만들 수 없다(Node 문서: Windows의 `chmod`는 쓰기 권한 표시만 바꾼다). `restoreAuth`는 Codex 판정 job(Linux 러너)에서만 돌고, Linux CI의 `check`가 이 단언을 계속 확인한다. 나머지 단언(내용, 필드 이름, 해시, 값 비노출)은 Windows에서도 확인한다. / 버린 대안: 테스트 전체 건너뛰기(R4), Windows ACL로 같은 보호를 구현하기(이 도구가 Windows에서 돌 일이 없다. 범위 밖).

## 발견 사항

- `check`의 로그는 실패한 단계 출력의 끝부분만 담는다. test 단계에서 실패가 여러 파일에 흩어져 있으면 앞쪽 실패가 보이지 않는다(이번에 5개 중 3개만 보였다). 전체 목록은 `node --test "scripts/test/*.test.ts" > <파일>`로 따로 받아야 했다. → 이 계획에서는 고치지 않는다. `tech-debt-tracker.md`의 TD-14 비고에 적는다(step0 작업 5).
- 훅의 `gitWorkDir`는 `git -C <경로>`를 `path.resolve`로 푼다. Git Bash의 `/c/Users/…` 꼴 경로는 Windows에서 `C:\c\Users\…`가 되어 worktree를 찾지 못하고, "승인 요청 뒤 push" 규칙이 그 명령을 막지 못한다(막지 않는 쪽으로 실패한다). `C:/…` 꼴은 맞게 풀린다. → 이 계획에서는 고치지 않는다(제품 코드 변경, TD-14의 Windows 실기 검증 항목). TD-14 비고에 적는다(step0 작업 5).

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 이 Windows PC의 `node scripts/harness.ts check`, PR의 Linux CI `check`.
- 이 계획의 계획만 담은 커밋은 로컬 `check`가 통과하지 않은 채 올린다(고치려는 실패 때문이다). CI `check`(Linux)가 그 커밋을 검사한다.

## 다음 할 일

- 범위를 넓힌 계획의 계획 검증(G1) 승인 뒤 step0 구현을 올린다. 병합되면 #57의 계획 커밋을 올린다.
