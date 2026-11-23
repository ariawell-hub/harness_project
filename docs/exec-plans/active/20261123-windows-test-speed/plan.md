---
id: 20261123-windows-test-speed
issue: 230 # GitHub Issue 번호
type: fix # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: draft # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-23T18:42:46+09:00 # new-task가 채운다
---

# Windows 네이티브에서 하네스 테스트가 느려 check의 test가 25~30분 넘게 걸린다 (runner 테스트 파일이 혼자 20분)

## 목표와 수용 기준

<!-- 무엇을 왜 하는가. 수용 기준은 검증 가능한 문장으로 -->

## 범위 / 비범위

## 관련 파일·문서

<!-- 바꿀 파일·폴더 경로를 백틱으로 감싸 적는다(glob 가능, 폴더는 그 아래 전부). 읽기만 할 파일은 "읽기만"으로 시작하는 항목에 따로 적는다. 범위 밖 변경 검사(scope, R18)의 기준 -->

## step 목록

<!-- 지시서는 stepN.md, 상태는 index.json. 예) - step0 rate-limit-store: 한 줄 목적 -->

## 진행 로그

<!-- 시간순. step 완료, 실패, 방법 전환, 세션 종료 직전에 반드시 갱신 -->

- 2026-11-23 19:40 선점(`claim/230`)하고 골격을 만들었다. runner 테스트 하나를 추적해 시간의 82%가 동기 git 호출(732회)임을 쟀다. 계획은 아직 쓰지 않았다. 측정 결과·후보·다음 차례는 같은 폴더의 `handoff.md`(계획 push 전에 지운다).

## 의사결정 로그

<!-- 결정 / 이유 / 버린 대안. 3회 방법 전환 기록도 여기에 -->

## 발견 사항

<!-- 예상과 달랐던 것 → 처리: [문서](경로) | #Issue | TD-N | 해당 없음 -->

## 열린 질문

<!-- 선택지 + 추천안 (9.1절) -->

## 검증 방법과 결과

<!-- 어떤 명령·증거로 수용 기준을 확인하는가 -->

## 다음 할 일

<!-- 인수인계: 세션이 끊겨도 이어 갈 수 있게 -->

- `handoff.md` 2절 "다음 차례"부터 한다.
