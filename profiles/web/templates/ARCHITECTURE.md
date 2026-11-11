# ARCHITECTURE — 최상위 지도

<!-- 웹 프로파일 예시(Next.js 기준). 제품에 맞게 고친다. 레이어 규칙: Types → Config → Repo → Service → Runtime → UI, 횡단 관심사는 Providers로만 -->

## 디렉토리 구조

```
src/
├── app/               # 페이지 + API 라우트
├── components/        # UI 컴포넌트
├── types/             # TypeScript 타입 정의
├── lib/               # 유틸리티 + 헬퍼
└── services/          # 외부 API 래퍼
```

## 패턴

{사용하는 디자인 패턴 (예: Server Components 기본, 인터랙션이 필요한 곳만 Client Component)}

## 데이터 흐름

```
{데이터가 어떻게 흐르는지 (예:
사용자 입력 → Client Component → API Route → 외부 API → 응답 → UI 업데이트
)}
```

## 상태 관리

{상태 관리 방식 (예: 서버 상태는 Server Components, 클라이언트 상태는 useState/useReducer)}
