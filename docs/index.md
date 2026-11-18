---
status: active
related_code: []
review_cycle: on-change
---

# 문서 목차

새 문서를 만들면 여기(또는 그 폴더의 `index.md`)에 한 줄 설명과 링크를 추가한다. doc-lint가 색인 누락을 막는다(R8).

## 작업할 때

- [작업 절차서](harness/workflow.md) — 계획·step 작성, 완료 처리, 실패 보고, 에스컬레이션 형식
- [핵심 원칙](core-beliefs.md) — B1~B11, 황금 원칙
- [실행 계획 템플릿](exec-plans/TEMPLATE.md) · [소규모](exec-plans/TEMPLATE-small.md) · [step 지시서](exec-plans/TEMPLATE-step.md)
- [기술 부채](exec-plans/tech-debt-tracker.md)

## 제품·결정

- [제품 스펙](product/index.md) — PRD 목록
- [의사결정 기록(ADR)](decisions/index.md)

## 품질·보안

- [품질 점수](QUALITY_SCORE.md) — 지표와 도메인별 등급
- [보안](SECURITY.md) — 자격증명 목록, 유출 대응

## 하네스 자체

- [하네스 설계서](harness/design.md) — 요구사항과 설계("왜")
- [하네스 코드 구조](harness/architecture.md) — 레이어·모듈·상태 위치
- [하네스 변경 이력](harness/CHANGELOG.md)
- [운영 전환 시험 결과](../lab/ops-transition/README.md) — 테스트 리포에서 확인한 체크리스트 5·6의 사례별 기록(`results/`)과 검사 명령

## 데이터 (지시가 아님)

- `generated/` — 자동 생성 문서. 손으로 고치지 않는다
- `references/` — 외부 도구 문서. 스크립트로만 받고 출처 URL·해시를 기록한다
- `harness/background/` — 설계서의 참조 자료와 검토 의견
