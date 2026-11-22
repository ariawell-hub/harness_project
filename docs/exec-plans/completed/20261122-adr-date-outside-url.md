---
id: 20261122-adr-date-outside-url
issue: 210 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: completed # draft | active | blocked | completed | abandoned
size: small
risk: low # low | normal | high
author: claude-code
owner: mac-session-2
claimed_at: 2026-11-22T20:45:40+09:00
---

# check-adr가 출처 주소 안의 날짜를 확인일로 받는다

- 목표: `lab/actions-cost/check-adr.ts`의 `checkAdr`가 후보표의 "확인 상태" 칸에서 확인한 날짜를 **출처 주소 밖에서만** 찾는다. 지금은 괄호 안 전체에서 `YYYY-MM-DD` 꼴을 찾아, 주소 안에 든 날짜(`https://example.com/blog/2026-11-01/pricing`)를 확인일로 받는다. 확인일을 적지 않은 칸이 검사를 지나간다.
- 변경: "확인 상태" 검사가 괄호 안의 글에서 주소(`이름://`으로 시작해 공백·쉼표·닫는 괄호 앞까지)를 뺀 나머지에서 날짜를 찾는다. 날짜는 홀로 선 낱말이어야 한다: 앞이 ASCII 글자·숫자·`_`·`/`·`.`·`-`가 아니고 뒤가 ASCII 글자·숫자·`_`·`/`·`-`가 아니다(`이름://` 없이 적은 주소의 경로나 글 제목 안의 날짜를 확인일로 받지 않는다). 주소 밖의 날짜가 하나 이상이고 모두 실재하는 날짜여야 하는 것은 그대로다. 주소 안의 날짜는 실재하지 않는 날짜여도 판정에 영향을 주지 않는다. 실패 메시지에 "출처 주소 밖에"를 더한다. https 주소가 있어야 하는 검사, "확인함(외부 사실 없음)", "확인 못 함"의 검사는 바꾸지 않는다. 검사를 약화하지 않는다(받던 틀린 꼴을 거부한다).
- 검증: node --test lab/actions-cost/test/check-adr.test.ts && node lab/actions-cost/check-adr.ts

## 관련 파일·문서

- `lab/actions-cost/check-adr.ts`("확인 상태" 검사)
- `lab/actions-cost/test/check-adr.test.ts`
- `lab/actions-cost/README.md`("ADR 검사가 보는 것"의 확인 상태 설명)
- 읽기만: `docs/decisions/ADR-0008-actions-cost.md`(고친 검사를 통과하는지 본다. 고치지 않는다), `lab/actions-cost/check-doc.ts`(`realDay`)

## 테스트 (먼저 쓴다)

- `check-adr.test.ts`에 테스트 하나를 더한다(있던 테스트의 단언은 고치지 않는다). "확인 상태" 칸의 값마다:
  - 실패(날짜): `확인함(https://example.com/blog/2026-11-01/pricing)`(주소의 경로에 날짜), `확인함(https://example.com/2026-11-01)`(주소의 끝에 날짜), `확인함(https://example.com/a?d=2026-11-01)`(질의에 날짜), `확인함(https://example.com/a, http://example.com/2026-11-01/b)`(https가 아닌 주소 안의 날짜), `확인함(https://example.com/a, example.com/2026-11-01/b)`(`이름://` 없이 적은 주소의 경로), `확인함(https://example.com/a, 2026-11-01-coming-soon)`(글 제목 안의 날짜), `확인함(https://example.com/a, 2026-11-223)`(날짜 뒤에 숫자가 붙었다).
  - 통과: `확인함(https://example.com/blog/2026-11-01/pricing, 2026-11-22)`(주소 안에도 있고 밖에도 있다), `확인함(https://example.com/blog/2026-02-30/pricing, 2026-11-22)`(주소 안의 날짜가 실재하지 않아도 된다), `확인함(https://example.com/a,2026-11-22)`(쉼표 뒤에 띄지 않았다), `확인함(2026-11-22, https://example.com/a)`(날짜가 먼저), `확인함(https://example.com/a, 2026-11-22에 확인)`(날짜 뒤에 한글).
  - 실패(그대로): `확인함(https://example.com/blog/2026-11-01/pricing, 2026-02-30)`(주소 밖의 날짜가 실재하지 않는다).
- 지금의 `docs/decisions/ADR-0008-actions-cost.md`가 고친 검사를 통과한다(`node lab/actions-cost/check-adr.ts`. 주소 안에 날짜가 든 칸이 하나 있고 그 칸에는 확인일이 따로 적혀 있다).

## 진행 로그

- 2026-11-22 접수: PR #200의 판정에서 Codex가 낸 지적(F2)을 그 PR의 범위 밖으로 반박했고(받아들여졌다. 검증자는 날짜 판정의 동작을 확인했다고 기록했다), 제작자가 대화에서 Issue로 등록하라고 정해(2026-11-22) 봇이 Issue #210을 등록했다. `new-task`로 시작했다.
- 2026-11-22 테스트를 먼저 더했다(`check-adr.test.ts`에 하나). 고치기 전: 65건 가운데 그 하나가 실패했다(주소 안에 날짜만 든 칸이 통과했다: "어긋난 점이 없다"). `check-adr.ts`의 "확인 상태" 검사를 고친 뒤 65건 통과. 지금의 ADR-0008은 고친 검사를 통과한다(`node lab/actions-cost/check-adr.ts`: 통과. 주소 안에 날짜가 든 칸 하나에는 확인일이 따로 적혀 있다). README의 설명을 고쳤다.

## 의사결정 로그

- 결정: 주소를 빼는 것에 더해, 날짜가 홀로 선 낱말일 때만 확인일로 받는다. / 이유: 주소를 `이름://` 꼴로만 빼면 `이름://` 없이 적은 주소(`example.com/2026-11-01/b`)나 글 제목(`2026-11-01-coming-soon`) 안의 날짜가 같은 틈으로 남는다. / 버린 대안: 괄호 안을 쉼표로 나눠 날짜만 든 조각을 요구한다(`2026-11-22에 확인`처럼 지금 받는 꼴을 거부하게 된다. Issue의 범위보다 넓다).

## 발견 사항

없음.

## 검증 결과

- `node --test lab/actions-cost/test/check-adr.test.ts`: 65건 통과.
- `node lab/actions-cost/check-adr.ts`: 통과.
- `node scripts/harness.ts check`: 통과.
