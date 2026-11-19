---
id: 20261119-check-cache-guard
issue: 133 # GitHub Issue 번호
type: feat # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: normal # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-19T14:48:40+09:00
---

# fix: check 캐시가 실행 도중 바뀐 작업 트리를 구분하지 못하고(TD-52), testEffect 설정 변경이 약화 신호로 잡히지 않는다(TD-51)

- 목표: 기술 부채 두 건을 한 PR로 닫는다(Issue #133, 제작자 지시). ① `check`가 도는 동안 작업 트리가 바뀐 실행의 결과가 시작할 때의 캐시 키로 남지 않게 한다(TD-52, PR #130의 원장 F5·F6). ② 설정 `testEffect`를 끄거나 줄이는 변경이 `harness-guard`의 "판정 관련 설정 변경" 신호로 올라오게 한다(TD-51). 둘 다 검사를 조이는 쪽이고 약화는 없다.
- 변경: `scripts/commands/check.ts`(끝날 때 캐시 키를 다시 만들어 시작할 때와 같을 때만 저장), `scripts/gates/harness-guard.ts`(`CONFIG_KEYS`에 `testEffect`), 테스트 `scripts/test/check-skip.test.ts`·`scripts/test/harness-guard.test.ts`, 문서(설계서 v0.7.57의 6절·변경 이력, `CHANGELOG`, 기술 부채 표의 TD-51·TD-52 해결).
- 검증: node --test scripts/test/check-skip.test.ts scripts/test/harness-guard.test.ts
- 그 밖의 검증: `node scripts/harness.ts check`. 구현 전에 새 단언이 실패하는 것을 먼저 확인한다.
- 비범위: 캐시 키의 구성은 바꾸지 않는다. 도중에 바뀌었다가 시작할 때와 같은 내용으로 되돌아온 경우(시작과 끝의 키가 같다)는 다루지 않는다. Actions 사용량 절감의 나머지 후보(TD-49의 ③~⑤)는 별도 Issue다.

## 관련 파일·문서

- `scripts/commands/check.ts`(`cacheKey`, `runCheck`), `scripts/gates/harness-guard.ts`(`CONFIG_KEYS`)
- `scripts/test/check-skip.test.ts`, `scripts/test/harness-guard.test.ts`
- 설계서 6절(`check` 캐시), 10.4절(보호 경로 정책의 신호)
- `docs/exec-plans/tech-debt-tracker.md` TD-51, TD-52
- PR #130의 지적 원장(F5·F6), 계획 `20261119-test-skip-inert`, `20261119-td-check-cache`

## 진행 로그

- 2026-11-19: 제작자 대화 지시("이것들 진행하자". 남은 항목 목록의 TD-51·TD-52)로 봇이 Issue #133을 등록하고 시작했다. 두 항목을 한 PR로 묶었다(둘 다 `scripts/`라 따로 올리면 제작자 승인과 판정이 두 번 든다).
- 2026-11-19: 테스트를 먼저 더했다. `check-skip.test.ts`: 처음부터 끝까지 목록 밖 변경이 있고(두 건너뛰기 판정이 같다) `fmt` 검사가 그 파일의 내용을 바꾸는 리포에서, `test`가 통과해도 캐시 폴더가 비어 있는지. `harness-guard.test.ts`: `testEffect`를 `null`로 바꾼 설정과 대상을 바꾼 설정이 신호로 잡히는지. 구현 전 `node --test scripts/test/check-skip.test.ts scripts/test/harness-guard.test.ts`: 31개 가운데 2개 실패(캐시 파일이 1개 남음, `testEffect` 신호 없음).
- 2026-11-19: 구현했다. `runCheck`가 결과를 저장하기 전에 `cacheKey`를 다시 불러 시작할 때의 키와 비교한다. `CONFIG_KEYS`에 한 줄. 구현 뒤 `check-skip.test.ts`·`harness-guard.test.ts`·`gates.test.ts` 48개 통과. 설계서 v0.7.57, `CHANGELOG`, 기술 부채 표를 맞췄다.
- 2026-11-19: 초안 PR #134 판정 1라운드(head `1b9e1df`). claude는 승인(지적 없음), codex는 수정 요청(P1 1, P2 1). F1(P1, 재현됨): 끝날 때 `cacheKey`가 예외를 내면(검사가 남긴 파일 때문에 `git add`가 실패하는 경우) 통과한 `check`가 예외로 끝난다. 받아들였다. 로컬에서 재현했다: `fmt` 검사가 읽을 수 없는 파일을 남기는 픽스처에서 `check-skip.test.ts`의 새 테스트가 `git add -A 실패 … Permission denied`로 실패했다. 끝날 때의 키 계산과 캐시 파일 쓰기를 함께 `try`로 감싸, 실패하면 캐시에 쓰지 않고 결과는 그대로 돌려주게 고쳤다(캐시 폴더를 만들 수 없는 경우도 같은 종류라 함께 막고 테스트를 더했다. 수정 전 코드에서는 두 테스트가 각각 `Permission denied`와 `EEXIST`로 실패한다). F2(P2, 미룸 처리된 것): `testEffect` 테스트가 "없던 키를 `null`로" 바꾸는 경우만 봤다. base에서 켜져 있던 검사를 head에서 끄는 전이와, 그대로 둔 경우에 신호가 없는 것을 테스트에 더했다(픽스처의 base 설정을 바꿀 수 있게 했다). 고친 뒤 `check-skip.test.ts`·`harness-guard.test.ts` 33개 통과.
- 2026-11-19: 놓친 것. 시작할 때의 `cacheKey`가 실패하면 `check`가 실패하는 것은 원래 동작이라, 끝에 같은 호출을 더하면서 "통과한 뒤에 실패할 수 있는 지점"이 새로 생긴다는 것을 보지 않았다. 통과 판정 뒤에 더하는 부가 작업(캐시 쓰기)은 실패해도 판정을 바꾸지 않아야 한다.
- 2026-11-19: PR #134 판정 2라운드(head `4b9a1db`). claude 승인(지적 없음), codex는 F1을 해결로 보고 새 P1을 냈다. F3(P1, 재현됨): 캐시 파일을 최종 경로에 바로 쓰고 쓰기 오류를 삼키므로, 쓰다가 실패하면(디스크 부족 등) 일부만 쓴 파일이 남고 다음 `check`가 그 파일을 읽다 `JSON.parse` 예외로 끝난다. 받아들였다. 1라운드 대응에서 쓰기 오류를 삼키게 하면서 생긴 경로다(그 전에는 쓰기 실패가 그 자리에서 드러났다). 테스트를 먼저 더했다: 끊긴 JSON, 모양이 다른 JSON, 빈 파일을 최종 경로에 두고 `check`를 돌린다. 수정 전에는 `SyntaxError`로 실패했다. 읽는 쪽은 읽지 못하거나 깨진 캐시를 없는 것으로 보고(`readCache`), 쓰는 쪽은 같은 폴더의 임시 파일에 전부 쓴 뒤 이름을 바꾼다(`writeCache`. 실패하면 임시 파일을 지운다). 고친 뒤 `check-skip.test.ts` 19개 통과.
- 2026-11-19: 두 라운드 연속으로 "고친 곳 바로 옆"에서 P1이 나왔다. 오류를 삼키는 수정을 넣을 때는 삼킨 뒤에 남는 상태(여기서는 디스크의 파일)를 읽는 쪽이 어떻게 되는지까지 봐야 한다.

## 의사결정 로그

- 결정: 끝날 때 캐시 키 전체를 다시 만들어 비교한다(트리 해시만 따로 재지 않는다). / 이유: 키가 "이 결과가 무엇에 대한 것인가"의 정의다. 키를 그대로 다시 만들면 트리뿐 아니라 키에 든 다른 것(도구 버전 등)이 도중에 바뀐 경우도 같은 규칙으로 걸린다. 비용은 통과한 실행마다 한 번(도구 버전 조회와 트리 해시, 1초 미만)이다. / 버린 대안: `worktreeTreeHash`만 시작과 끝에 재서 비교(키 계산과 따로 놀아 둘이 어긋날 수 있다. PR #130의 F3과 같은 종류의 틈이다).
- 결정: 도중에 바뀌었다가 되돌아온 경우는 다루지 않고 문서에 한계로 적는다. / 이유: 시작과 끝만 보는 방식으로는 구분할 수 없고, 단계마다 재도 단계 안에서 바뀌었다 돌아오는 경우는 남는다. 로컬 캐시에만 해당하고 CI는 캐시를 쓰지 않는다. / 버린 대안: 단계마다 키를 다시 만들기(통과한 `check`마다 몇 초가 더 들고 틈은 여전히 남는다).
- 결정: 계획 위험도는 보통으로 적는다. / 이유: 검사를 조이는 변경이고 보안·인증·데이터와 무관하다. 다만 운영 단계라 `scripts/` 변경은 `risk-gate`가 높음으로 판정한다. PR은 초안으로 올리고 `pr-ready`로 제작자 승인을 요청한다. / 버린 대안: 높음(기준에 해당하지 않는다).

## 발견 사항

- 없음
