---
id: 20261115-codex-install-path
issue: 70 # GitHub Issue 번호
type: fix # 브랜치 접두어
status: active # draft | active | blocked | completed | abandoned
size: small
risk: high # low | normal | high
author: claude-code
owner: session
claimed_at: 2026-11-15T12:47:46+09:00
---

# fix: judge-codex 샌드박스가 Codex 실행 파일을 찾지 못한다

- 목표: `judge-codex`의 `judge` job이 샌드박스 준비에서 `bwrap: execvp …/codex: No such file or directory`로 실패하지 않고 사전 측정·판정까지 간다(Issue #70, #54 step4에서 발견).
- 변경: `.github/workflows/judge-codex.yml`의 Codex 설치를 `setup-node`의 전역 위치(`/opt/hostedtoolcache/…`, 판정 권한 프로필의 읽기 범위 밖) 대신 `/usr/local`로 한다(Q20에서 확인한 배치). 설치된 실행 파일의 실제 경로를 로그에 낸다. `scripts/test/ci.test.ts`에 설치 위치 불변식.
- 검증: `node --test scripts/test/ci.test.ts`(먼저 실패 확인), `node scripts/harness.ts check`. 워크플로는 `workflow_run`(main 정의)이라 이 PR에서는 돌지 않는다. 실제 동작은 병합 뒤 #54 step4의 PR #69에서 확인한다.

## 관련 파일·문서

- .github/workflows/judge-codex.yml
- scripts/test/ci.test.ts
- docs/harness/design.md
- docs/harness/CHANGELOG.md

## 진행 로그

- 2026-11-15: 원인 추정의 근거. 실행 43673752078 로그의 실패 경로가 `setup-node`가 깐 Node의 전역 모듈 위치다. 판정 설정의 읽기 범위는 `:minimal`과 `pr/`뿐이다. Q20 워크플로(커밋 7b837e7)는 `setup-node` 없이 `npm install -g`를 해 러너 기본 Node의 `/usr/local`에 설치됐고 샌드박스가 동작했다. 로컬(macOS)에서는 재현할 수 없다(샌드박스 구현이 다르다).
- 2026-11-15: `ci.test.ts`에 설치 위치 검사를 먼저 더해 실패 확인 → 워크플로 수정 뒤 통과.

## 의사결정 로그

- 위험도는 높음으로 둔다. 이유: 구독 인증이 들어가는 판정 워크플로를 바꾼다(#54 계획의 제작자 결정과 같은 기준).
- 권한 프로필에 설치 폴더 읽기를 더하는 대신 설치 위치를 옮긴다. 이유: 읽기 범위를 넓히지 않고 Q20에서 확인한 배치와 같아진다.

## 발견 사항

- Q20 시험 워크플로와 본 구현의 차이(`setup-node` 사용)가 샌드박스 읽기 범위에 영향을 줬다. 판정 job의 도구 설치 위치는 권한 프로필의 읽기 범위 안이어야 한다. → 처리: [문서](../../harness/design.md)
