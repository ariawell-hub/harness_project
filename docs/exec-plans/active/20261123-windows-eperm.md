---
id: 20261123-windows-eperm
issue: 228 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: draft # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-23T12:58:22+09:00
---

# Windows 네이티브에서 테스트 2건이 EPERM으로 실패한다 (writeQuestionState의 rename, scopeCheck 테스트의 symlink)

- 목표: Windows 네이티브(개발자 모드 꺼짐)에서 `check`의 `test`가 통과한다. 지금 `EPERM`으로 실패하는 두 테스트가 같은 것을 OS에 기대지 않는 방법으로 확인하게 고친다. 단언을 줄이지 않고, 테스트를 건너뛰지 않는다(R4).
- 변경: (1) `next.test.ts`의 `writeQuestionState` 테스트는 지금 전의 파일을 열어 둔 채 바꿔 넣고 그 내용이 그대로인지 본다. Windows에서는 열린 파일 위로 `rename`할 수 없어 실패한다. 파일을 열어 두는 대신 전의 파일에 하드 링크를 걸어 두고(상태 폴더 밖), 새로 쓴 뒤 그 링크의 내용이 그대로인지 본다. 그 자리에서 덮어쓰면 링크의 내용도 바뀌고, 새 파일로 바꿔 넣으면 그대로다. 단언(`전의 파일은 그대로다`)은 글자 그대로 둔다. 열어 둔 파일이 없어 어느 OS에서든 `rename`이 된다. (2) `scope.test.ts`의 심볼릭 링크 테스트는 작업 트리에 링크를 만들지 않는다. 링크 객체(모드 120000, 내용은 가리키는 경로)를 git 색인에 바로 넣어 커밋한다(`test-effect.test.ts`와 같은 방법). 판정 코드(`readPlanAtHead`)는 HEAD 커밋의 트리만 읽으므로 확인하는 것은 같다. 코드는 바꾸지 않는다.
- 검증: `node --test scripts/test/next.test.ts scripts/test/scope.test.ts`(이 Windows PC에서, CI에서는 Linux에서), `node scripts/harness.ts check`

## 관련 파일·문서

- `scripts/test/next.test.ts`
- `scripts/test/scope.test.ts`
- `docs/harness/CHANGELOG.md`
- 읽기만: `scripts/runner/next.ts`(`writeQuestionState`), `scripts/gates/scope.ts`(`readPlanAtHead`, `scopeCheck`), `scripts/test/test-effect.test.ts`(링크 객체를 색인에 넣는 방법), `scripts/gates/test-effect.ts`(예외 줄)

## 테스트 (먼저 쓴다)

- 동작 코드는 바꾸지 않으므로 고친 두 테스트는 지금 코드에서 통과해야 한다. 그 대신 확인하려는 잘못을 일부러 넣었을 때 실패하는지 본다(넣은 잘못은 되돌린다. 진행 로그에 적는다):
  - `writeQuestionState`가 임시 파일을 거치지 않고 그 자리에서 덮어쓰면(`writeFileSync(file, …)`) 고친 테스트가 실패한다.
  - `readPlanAtHead`가 링크 모드(120000)를 막지 않으면 고친 scope 테스트가 실패한다(링크 객체의 내용이 리포 밖 경로라 일반 파일로 읽히지 않는다. 막는 검사를 빼면 단언이 깨진다).
- 고친 scope 테스트가 만든 커밋에서 `git ls-tree`가 링크를 모드 120000으로 보인다는 단언은 그대로 둔다.
- 두 테스트 파일은 변경 전 코드에서도 통과한다(동작이 아니라 확인 방법만 바뀐다). `test-effect`(R5)의 예외 줄을 의사결정 로그에 적는다.

## 진행 로그

- 2026-11-23 접수: PR #188(Issue #180)을 Windows PC에서 이어받아 push 전 `check`를 돌리다 찾았다. main 체크아웃(`e9f7ad6`)에서 두 테스트만 돌려도 똑같이 실패했다. 제작자가 "#188의 다음 push 전에 #228부터 고친다"로 정했다(2026-11-23 대화).
- 2026-11-23 두 테스트를 고쳤다(계획의 "변경"). 처음에는 `writeQuestionState` 테스트를 파일 식별 번호(`ino`)로 보려 했으나, 하드 링크를 걸어 두면 원래 단언("전의 파일은 그대로다")을 그대로 둘 수 있어 그쪽으로 했다. 이 Windows PC에서 `node --test scripts/test/next.test.ts scripts/test/scope.test.ts`: 82건 통과(전에는 2건 실패).
- 2026-11-23 잘못을 넣어 확인했다(넣은 잘못은 바로 되돌렸다. 되돌린 뒤 `git status`에 코드 파일의 변경이 없다): (1) `writeQuestionState`를 임시 파일 없이 그 자리에서 덮어쓰게 바꾸자 고친 테스트가 실패했다(`fail 1`). (2) `readPlanAtHead`의 링크 모드 검사 둘을 끄자 고친 scope 테스트가 `Missing expected exception: 소규모 계획 파일이 링크`로 실패했다.

## 의사결정 로그

- 결정: 동작 코드(`writeQuestionState`)는 바꾸지 않는다. / 이유: 실패의 원인은 테스트가 파일을 열어 둔 채 `rename`하는 것이다. runner가 그 파일을 열어 둔 채 쓰는 곳은 없다(`readQuestionState`는 읽고 바로 닫는다). 백신 프로그램 같은 다른 프로세스가 잠깐 열어 `rename`이 실패할 수 있다는 것은 추측이고 재현한 적이 없다. / 버린 대안: `EPERM`·`EBUSY`에 다시 시도를 넣기(재현하지 못한 경우를 위한 코드다).
- 결정: scope 테스트는 링크 객체를 색인에 넣어 만든다. / 이유: 판정은 HEAD 커밋의 트리를 읽으므로 작업 트리의 링크는 필요 없다. 이 방법은 OS·권한과 무관하게 같은 커밋을 만든다. / 버린 대안: 링크를 만들 수 없으면 테스트를 건너뛰기(Windows에서 확인하지 않게 된다. R4).
- 결정: 두 테스트 파일에 `test-effect`(R5) 예외를 둔다. / 이유: 동작은 그대로이고 기존 동작을 확인하는 방법만 OS에 기대지 않게 바꿨으므로, 변경 전 코드에서도 통과하는 것이 맞다. 확인하려는 잘못을 넣으면 실패하는 것은 진행 로그에 적었다.
- test-effect 예외: `scripts/test/next.test.ts` @ `0bec76fdcf8a2fbd1d7761db1f51845044330460` — 사유: 기존 동작(writeQuestionState가 새 파일로 바꿔 넣는다)을 확인하는 방법만 하드 링크로 바꿨다(Windows에서 열린 파일 위로 rename이 안 된다, Issue #228)
- test-effect 예외: `scripts/test/scope.test.ts` @ `b1013d0ac024b6b09a0db1237bf1b168e22e72a3` — 사유: 기존 동작(계획 자리의 심볼릭 링크를 읽지 않는다)을 확인하는 커밋을 링크 객체를 색인에 넣어 만들게만 바꿨다(Windows는 권한 없이 링크를 못 만든다, Issue #228)

## 발견 사항

없음.

## 검증 결과

- 진행하며 적는다.
