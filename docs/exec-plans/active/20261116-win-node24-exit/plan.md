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

수용 기준:

1. `scripts/harness.ts`는 명령이 끝나면 종료 코드를 정하고 이벤트 루프가 비어 자연히 끝나게 한다. 명령이 남긴 핸들 때문에 끝나지 않는 경우에 대비해 정해 둔 시간 뒤에는 강제로 끝낸다(그 타이머는 프로세스를 붙잡지 않는다). 종료 코드의 뜻(성공 0, 실패 1, 사용법 2, `TaskError` 3)과 표준 출력·오류 내용은 그대로다.
2. 이 Windows PC에서 `node --test scripts/test/record.test.ts`가 3회 연속 통과한다.
3. `repro.test.ts`의 링크 테스트가 개발자 모드가 꺼진 Windows에서도 같은 것(리포 밖을 가리키는 링크 폴더에는 쓰지 않는다)을 확인한다. 건너뛰지 않는다.
4. 이 Windows PC에서 `node scripts/harness.ts check`가 종료 코드 0이다. Linux CI의 `check`도 통과한다.

## 범위 / 비범위

- 범위: `scripts/harness.ts`의 종료 처리, `scripts/test/repro.test.ts`의 링크 만들기, 종료 처리를 확인하는 테스트, 문서(`CHANGELOG`, 설계서 변경 이력, TD-14 비고).
- 비범위:
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

- step0 exit-code: CLI 종료를 자연 종료로 바꾸고 링크 테스트를 Windows에서도 돌게 한다

## 진행 로그

- 2026-11-16 step0: 계획 작성. #57 계획 커밋 전 로컬 `check`가 `test` 단계에서 실패했다(787초, `record.test.ts` 4개와 `repro.test.ts` 1개). `record.test.ts`만 3회 반복해 3회 모두 같은 4개가 실패했다(흔들림이 아니다). 실험: `NODE_OPTIONS=--import`로 `harness.ts`의 `process.exit`를 "종료 코드만 정하고 자연 종료"로 바꿔 끼우면 `record.test.ts` 7개가 3회 모두 통과했다. `fetch` 한 번 뒤 `process.exit`만 하는 작은 스크립트로는 재현되지 않았다(요청 여러 개와 POST가 있어야 하는 것으로 보인다).

## 의사결정 로그

- 결정: `process.exit(code)` 대신 `process.exitCode`를 정하고 자연 종료한다. 강제 종료 타이머(`unref`)를 함께 둔다. / 이유: 크래시는 열린 핸들이 닫히는 도중 강제 종료할 때 난다. 자연 종료는 핸들이 정리된 뒤 끝난다. 타이머는 명령이 핸들을 남겨 끝나지 않는 회귀를 막는다. / 버린 대안: 테스트에서 Windows의 종료 코드를 무시하기(R4, 실제 명령이 죽는 것은 그대로다), Node 22로 내려 쓰기(`engines`는 22.18 이상이라 24도 지원 범위다).
- 결정: 링크 테스트는 `symlinkSync(…, 'junction')`으로 만든다. / 이유: Windows의 디렉터리 정션은 권한 없이 만들 수 있고 Node는 정션을 심볼릭 링크로 본다. 다른 OS에서는 이 인자가 무시된다. 테스트가 확인하는 것(밖을 가리키는 링크 폴더에 쓰지 않는다)은 같다. / 버린 대안: 권한이 없으면 건너뛰기(R4).
- 결정: 봇이 Issue #99를 등록했다. / 이유: 제작자가 지시한 #57의 push를 막는 선행 작업이다(절차서 5절 "무관한 검사 실패는 별도 PR로 먼저 고친다").

## 발견 사항

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 AC 명령과 이 Windows PC의 `node scripts/harness.ts check`, PR의 Linux CI `check`.
- 이 계획의 계획만 담은 커밋은 로컬 `check`가 통과하지 않은 채 올린다(고치려는 실패 때문이다). CI `check`(Linux)가 그 커밋을 검사한다.

## 다음 할 일

- 계획 검증(G1) 승인 뒤 step0 구현. 병합되면 #57의 계획 커밋을 올린다.
