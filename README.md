# 범용 하네스 템플릿

에이전트(Claude Code, Codex)가 이 리포만 읽고 **계획 → 구현 → 점검 → 수정**을 반복하도록 만드는 하네스다. 언어·엔진에 중립인 코어 위에 웹·게임 프로파일을 얹는다. 설계와 이유는 [docs/harness/design.md](docs/harness/design.md), 에이전트용 지도는 [AGENTS.md](AGENTS.md)다.

현재 구현 범위: **로드맵 1단계(최소 구성)**. 2단계(CI 교차 검증) 이후 항목은 [기술 부채 목록](docs/exec-plans/tech-debt-tracker.md)에 있다.

## 요구 사항

- Node 22.18 이상, pnpm 10, git, gh, gitleaks (`brew install gitleaks`)
- 에이전트 CLI: Claude Code(`claude`), 선택적으로 Codex(`codex`)

## 새 프로젝트에 적용하기

1. 이 폴더를 복사하고 프로파일을 고른다.
   ```bash
   node scripts/harness.ts init --profile web --owner <제작자 계정> --bot <봇 계정>
   pnpm install
   node scripts/harness.ts check
   ```
2. **0단계(제작자가 직접)**: 설계서 0절의 전제 조건과 리포 설정.
   - 에이전트 전용 봇 계정 + 이 리포 한정 토큰(contents·pull requests·issues 쓰기, 90일 이하). GitHub Pro.
   - **에이전트가 실행되는 Mac에서 제작자 계정의 `gh` 로그인을 지운다**(E5): `gh auth logout`. 제작자 승인은 GitHub 웹·모바일에서만.
   - 원격 리포를 만들고 main을 push한 뒤 브랜치 보호: PR 필수, force push·삭제 금지, 관리자 우회 없음, 최신 브랜치 필수, stale 승인 무효화.
   - 승인 설정: 필수 승인 0, "Require approval of the most recent reviewable push" **끔**. 켜 두면 필수 승인이 0이어도 모든 PR에 사람 승인이 필요해 자동 병합이 멈춘다(설계서 0.2절).
   - Actions: 기본 권한 읽기 전용, "Actions가 PR 승인" 끔, 리포 수준 시크릿 없음. 자동 병합 허용, head 브랜치 자동 삭제.
   - 필수 상태 체크 등록: `check`, `plan-gate`.
   - 라벨: `needs-human`, `priority:high|medium|low`, `size:small|medium|large`, `risk:low|high`, `bug`.
3. 작업은 GitHub Issue로 넣는다.

## 실행

```bash
# 대화 세션: 에이전트가 AGENTS.md의 세션 시작 절차를 따른다
node scripts/harness.ts start

# 무인 실행: step마다 새 세션을 띄우고 AC·check로 직접 판정한다
GH_TOKEN=<봇 토큰> node scripts/harness.ts run --worker runner-1 --tool claude
```

runner는 할 일이 없거나 사람의 답만 기다릴 때 멈춘다. 계획이 5회 실패하면 그 Issue에 `needs-human` 라벨과 중단 보고를 남기고 다음 Issue로 넘어간다. 제작자 계정으로 Issue에 답을 달면 다음 실행에서 이어 간다.

## 이 템플릿 자체를 고칠 때

이 리포도 같은 규칙을 따른다. Issue → `new-task` → 계획 → PR. 하네스 파일은 보호 경로이므로 [변경 이력](docs/harness/CHANGELOG.md)에 한 줄을 남긴다. 테스트: `node scripts/harness.ts test`.
