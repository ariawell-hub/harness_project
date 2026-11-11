---
status: active
related_code: [harness.config.json]
review_cycle: on-change
---

# ADR-0003: 봇 토큰은 클래식 PAT로 쓰고, 리포 범위는 봇 초대 범위로 제한한다

- 날짜: 2026-11-11
- 상태: 채택 (제작자와 이미 합의한 결정을 사후 기록)
- 관련: 설계서 E1·E2·E5, 0.2절, R12, R20, [SECURITY.md](../SECURITY.md)

## 배경

- 설계서 E1은 작성용 봇에 "리포 한정 토큰(contents·pull requests·issues 쓰기, admin 없음)"을 요구한다.
- 이 리포 `ariawell-hub/harness_project`는 개인 계정 소유다(E2: 개인 계정 + GitHub Pro). 봇 계정 `ariawell247`은 협업자로 초대되어 있다.
- fine-grained 토큰은 토큰 소유자 본인이나 소유자가 속한 조직의 리포에만 쓸 수 있다. 다른 개인 계정의 리포에 협업자로 초대된 경우는 대상이 아니다. 그래서 이 구조에서는 E1의 리포 한정 토큰을 발급할 수 없다.

## 결정

- 봇은 클래식 PAT를 쓴다. scope는 `repo`, `workflow`, `read:org`만 준다. `read:org`는 `gh`가 토큰 로그인에 요구하는 최소 scope다.
- 토큰은 에이전트 세션 환경의 `GH_TOKEN`에만 둔다. git의 HTTPS 인증은 `gh auth setup-git`으로 등록한 `gh auth git-credential`을 거쳐 같은 토큰을 쓴다. 제작자 토큰은 이 Mac에 두지 않는다(E5).
- 만료는 90일 이하로 발급한다.
- 리포 범위는 토큰 대신 계정으로 제한한다.
  - 봇은 이 리포 하나에만 협업자로 초대한다. 봇 계정 소유 리포도 만들지 않는다.
  - 리포 역할은 Write다. Admin·Maintain은 주지 않는다.
- `workflow` scope는 구축 단계에만 둔다. 운영 단계로 전환할 때 이 scope를 뺀 토큰으로 바꾼다(설계서 10.4절 운영 전환 체크리스트).

## 확인 방법

봇 토큰으로 실행한다. 토큰을 발급·교체할 때와 운영 전환 전에 확인한다.

```bash
# 접근 가능한 리포: ariawell-hub/harness_project 하나만 나와야 한다
gh api 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100' --jq '.[].full_name'
# 리포 권한: WRITE
gh repo view --json viewerPermission --jq .viewerPermission
# scope 3개, 만료일이 발급일부터 90일 이내
gh api -i user | grep -iE '^(x-oauth-scopes|github-authentication-token-expiration):'
# 필수 체크의 출처 고정: check의 app_id가 15368(GitHub Actions)
gh api repos/ariawell-hub/harness_project/branches/main --jq '.protection.required_status_checks.checks'
```

2026-11-11 확인 결과:

- 접근 가능한 리포는 이 리포 하나이고, 권한은 `WRITE`다.
- scope는 `read:org, repo, workflow`이고, 만료일은 2027-02-09다.
- 필수 체크 `check`의 출처는 `app_id 15368`(GitHub Actions)로 고정되어 있다.

## 결과와 남는 위험

- **다른 리포로 번질 수 있다**: 봇을 다른 리포에 초대하면 이 토큰이 그 리포에도 통한다. 초대는 제작자만 할 수 있으므로 "이 리포에만 초대한다"는 운영 규칙으로 막는다.
- **커밋 상태를 쓸 수 있다**: 클래식 `repo` scope에는 커밋 상태(commit status) 쓰기 권한이 포함된다. E1의 fine-grained 토큰이었다면 주지 않았을 권한이다. 봇이 필수 체크와 같은 이름의 상태를 직접 만들 수 있으므로, **모든 필수 체크는 출처 앱을 고정해야 한다.**
  - 지금: `check`는 GitHub Actions로 고정되어 있다(위 확인 결과).
  - 2단계: `review/*`·`plan-gate`·`risk-gate` 등은 설계서 0.2절대로 검증 App을 출처로 지정한다. 이 설정이 없으면 작성 에이전트가 검증 결과를 위조할 수 있다(R12).
- **나중에 바꿀 수 있다**: 리포를 조직으로 옮기면 E1대로 리포 한정 fine-grained 토큰을 쓸 수 있다. 그때 이 ADR을 새 ADR로 대체한다.

## 버린 대안

- **리포를 GitHub 조직으로 옮기고 fine-grained 토큰을 쓴다**: E1을 그대로 지킬 수 있다. 하지만 E2에서 개인 계정 + GitHub Pro로 정했고, 조직으로 옮기면 같은 보호 기능에 Team 요금제가 필요하다.
- **제작자 계정 토큰을 쓴다**: E1·E5 위반이다. 에이전트가 보호 설정을 바꿀 수 있게 되고, 제작자가 에이전트 PR을 승인할 수 없게 된다.
