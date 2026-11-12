---
status: active
related_code: [scripts/, package.json, tsconfig.json]
review_cycle: on-change
---

# ADR-0001: 하네스 공통 스크립트는 TypeScript, Node 22 내장 타입 제거로 빌드 없이 실행

- 날짜: 2026-11-11
- 상태: 채택
- 관련: 설계서 Q3, 6절("셸 전용 금지"), 15절(템플릿 복사 배포)

## 맥락

하네스는 웹과 게임(엔진 미정, Q1) 개발에 함께 쓴다. 공통 스크립트(`new-task`, `run`, `check`, 훅, 게이트)는 엔진 **안**이 아니라 **바깥**에서 git, gh, 에이전트 CLI, 프로세스 시간 제한, JSON·Markdown을 다룬다. Windows 게임 개발 가능성 때문에 셸 전용은 쓸 수 없다.

## 결정

- 언어는 TypeScript, 런타임은 Node 22 LTS(22.18 이상)다. Node의 내장 타입 제거로 `.ts`를 **빌드 없이** 바로 실행한다: `node scripts/harness.ts <명령>`.
- 런타임 의존성 없이 `node:` 내장 모듈만 쓴다. 테스트는 내장 `node:test`로 한다.
- 개발 의존성은 `typescript`(타입 검사 `tsc --noEmit`)와 `prettier`만 둔다.
- 타입 제거로 지울 수 있는 문법만 쓴다(`erasableSyntaxOnly`): `enum`, `namespace`, 매개변수 프로퍼티는 쓰지 않는다. import에는 `.ts` 확장자를 붙인다.

## 이유

- 웹 프로파일은 Node·pnpm이 원래 필요하다. 런타임을 하나로 유지한다.
- Node는 Windows·macOS·Linux에서 같은 방식으로 동작한다. 게임 개발 PC에는 Node 설치 하나만 더하면 되고, 엔진(Godot·Unity·Unreal)과 무관하다.
- 컴파일 단계가 없으므로 템플릿을 복사하면 바로 동작하고, 에이전트가 고친 스크립트도 바로 실행된다.
- 타입 검사로 큰 스크립트(runner, 게이트)의 유지보수성을 지킨다.

## 버린 대안

| 대안                  | 버린 이유                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| JavaScript(.mjs)      | 의존성 0이지만 타입 검사가 없어 runner·게이트가 커질수록 깨지기 쉽다                                   |
| Python                | macOS 기본 3.9가 오래됐고 Windows 설치 경로가 제각각이다. 웹과 런타임이 둘로 나뉜다                    |
| Go·Rust 단일 바이너리 | 배포는 쉽지만 빌드·릴리스 파이프라인이 필요하고, 템플릿 복사 배포와 에이전트의 즉시 수정에 맞지 않는다 |
| Deno·Bun              | TS를 바로 실행하지만 "지루한 기술"(B8)이 아니고 웹 프로파일 도구와 겹친다                              |

## 다시 볼 조건

게임 엔진이 확정되어(Q1) 엔진 쪽 CI 러너에 Node를 둘 수 없을 때.

## 검토 기록

- 2026-11-12 (Issue #37): R8 검토. ADR 뒤 변경 13건은 모두 `scripts/` 안의 기능 변경이고 `package.json`·`tsconfig.json`은 그대로다. `scripts/`에 `node:`·상대 경로 밖 import와 `enum`·`namespace`가 없다. 결정 유효, 본문 수정 없음.
