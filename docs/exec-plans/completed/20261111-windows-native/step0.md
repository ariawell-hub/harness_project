# Step 0: windows-design

## 읽어야 할 파일

- `docs/exec-plans/active/20261111-windows-native/plan.md` (목표와 의사결정 로그)
- `docs/harness/design.md` 0절 지원 범위, 0.1절 E5, 4.5절 운영, 5.1절 R20, 6절, 8.3절 실패 기록, 10.4절 보호 경로, 13.1~13.2절, 14.2절, 18절 Q4, 19절 0단계, 부록 A·C
- `docs/decisions/ADR-0001-script-language.md`, `docs/decisions/ADR-0002-codex-hooks-sandbox.md`
- `docs/harness/workflow.md`, `README.md` 0단계, `docs/SECURITY.md`, `docs/exec-plans/tech-debt-tracker.md`, `docs/harness/CHANGELOG.md`

## 작업

문서만 고친다. 코드는 고치지 않는다(step1~3의 몫).

1. `docs/decisions/ADR-0005-windows-native.md`를 만든다. 결정: macOS와 Windows 네이티브(WSL 아님)를 함께 쓴다. Windows 전제 조건은 Git for Windows(Git Bash)와 Node 22.18 이상이다. 내용: 맥락, 결정(실행 셸, 줄바꿈, L1 셸 방언, 자격증명 위생, 작업자 이름, `.env` 연결), 버린 대안(WSL2, cmd.exe·PowerShell 표준화, OS별 AC), 남은 위험과 확인 항목(TD-14, TD-15). `docs/decisions/index.md`에 행을 추가한다.
2. `docs/harness/design.md`를 v0.7.4로 올리고 변경 이력에 한 줄을 넣는다.
   - 0절 지원 범위: 에이전트 실행 OS(macOS, Windows 네이티브)와 Windows 전제 조건.
   - "에이전트가 실행되는 Mac"을 모두 "에이전트가 실행되는 모든 머신(macOS·Windows)"으로 바꾼다: E5, 4.5절 운영, R20, 8.3절 실패 기록, 14.2절, 19절 0단계. 부록 C의 "별도 macOS 사용자"는 "별도 OS 사용자".
   - R20 L1: 키체인 조회만이 아니라 OS 자격증명 저장소 조회(macOS 키체인 `security`, Windows 자격 증명 관리자 `cmdkey`·`vaultcmd`, git 자격증명 도우미), 토큰 환경 변수 변경(PowerShell `$env:`·cmd `set` 포함).
   - 4.5절: 여러 머신에서 runner·대화 세션을 돌릴 수 있고, 작업자 이름(`--worker`, `HARNESS_WORKER`)은 머신마다 고유해야 한다. 이유(같은 이름이면 서로의 계획을 자기 것으로 본다).
   - 6절: 명령 문자열의 셸(AC·프로파일 명령은 POSIX `sh` 문법, macOS·Linux는 `/bin/sh`, Windows는 Git Bash, 못 찾으면 실행하지 않음, WSL `bash.exe` 금지), 줄바꿈(LF 고정, `.gitattributes`).
   - 10.4절 보호 경로에 `.gitattributes`를 넣는다.
   - 13.1절 훅 구현 규칙: 셸 방언(POSIX와 PowerShell·cmd, 셸 래퍼 재귀, 명령 이름 대소문자·확장자 무시, Claude Code `PowerShell` 도구 matcher), Windows에서 훅 자체가 실행되지 못하면 차단되지 않는 위험과 실측(TD-14).
   - 14.2절: 개발용 `.env` 연결은 심볼릭 링크, 실패하면 하드 링크.
   - 18절 Q4: Windows 네이티브 L0 지원 확인을 다시 넣는다.
   - 부록 A에 이 결정의 행을 추가한다.
3. `docs/harness/workflow.md`: AC는 POSIX `sh` 문법(Windows에서도 Git Bash로 실행), OS 전용 명령 금지, 여러 머신 작업 시 작업자 이름 고유, Windows 전제 조건.
4. `README.md` 0단계와 `docs/SECURITY.md`의 E5 문장을 모든 머신 기준으로 바꾸고, Windows의 제작자 자격증명 정리 방법(`gh auth logout`, 자격 증명 관리자의 `git:https://github.com` 항목)을 적는다.
5. `docs/exec-plans/tech-debt-tracker.md`에 TD-14(Windows 실기 검증), TD-15(CI OS 행렬)를 등록한다.
6. `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄을 넣는다.

## Acceptance Criteria

```bash
test -f docs/decisions/ADR-0005-windows-native.md
grep -q "ADR-0005" docs/decisions/index.md
grep -q "v0.7.4" docs/harness/design.md
! grep -n "실행되는 Mac" docs/harness/design.md README.md docs/SECURITY.md
grep -q "TD-14" docs/exec-plans/tech-debt-tracker.md
node scripts/harness.ts check
```

## 금지사항

- 코드·설정 파일(`scripts/`, `.claude/`, `harness.config.json`, `.gitattributes`)을 고치지 마라. 이유: step1~3의 범위이고 step 하나 = PR 하나다.
- 설계서의 다른 결정(L0 4단계, 자동 병합 정책 등)을 바꾸지 마라. 이유: 이번 범위는 Windows 병행에 치명적이거나 Mac에 고정된 항목뿐이다.
- 아직 확인하지 못한 Windows 동작을 "확인됨"으로 쓰지 마라. 이유: 이 Mac에서는 실측할 수 없다. 확인 전 항목은 TD-14로 남긴다.
