# Step 2: harness-guard

## 읽어야 할 파일

- `docs/exec-plans/active/20261114-ci-gates/plan.md` (수용 기준 5·6, 의사결정 로그의 제작자 결정 "약화·완화는 위험도 높음")
- `docs/harness/design.md` 10.3절 `harness-guard`, 10.4절 보호 경로 정책·샌드박스·권한 완화 탐지·캐시 규칙·역할별 environment, 5.1절 R9·R10, 4.5절 무인 권한 프로필
- step0·1이 만든 파일: `scripts/ci/`, `scripts/gates/risk-gate.ts`(`RiskSignal`), `.github/workflows/gates.yml`
- `harness.config.json`, `.claude/settings.json`, `.claude/runner-settings.json`, `.codex/config.toml`, `.codex/hooks.json`, `.gitignore`, `.github/pull_request_template.md`
- TD-10(`docs/exec-plans/tech-debt-tracker.md`)

## 작업

1. 설정: `harness.config.json`과 `scripts/lib/config.ts`에 `ci: { environments: string[] }`(기본 `["judge-claude", "judge-codex", "codex-auth-store", "recorder", "revert"]`, 10.4절). `profiles/*/profile.json`이 이 키를 덮지 않는지 확인한다.
2. `scripts/gates/harness-guard.ts`
   - `export function harnessGuard(o: { root: string; base: string; cfg: HarnessConfig; prBody: string | null }): { result: GateResult; signals: RiskSignal[] }`. base 쪽 파일은 `git show <base>:<경로>`로, head 쪽은 `root`에서 읽는다. 보호 경로 판정은 `cfg`(main 설정)의 `protectedPaths`.
   - 보호 경로 변경이 없으면 success("보호 경로 변경 없음"), signals 없음.
   - **실패**(작성자가 고칠 것): `docs/harness/CHANGELOG.md`가 바뀌지 않음, PR 본문에 체크된 보호 경로 체크리스트 줄(`- [x] 보호 경로 변경:`로 시작)이 없음(`prBody === null`이면 error), 아무 워크플로에 캐시 사용(`actions/cache`, `with:` 아래 `cache:`·`cache-dependency-path:`).
   - **신호**(risk high, 제작자 결정): 워크플로 파일 삭제 또는 base에 있던 job id 삭제, `harness.config.json`의 `commands`·`protectedPaths`·`riskPaths`·`stage`·`bypass`·`guard`·`failure`·`planReview`·`ci`·`docLint.exclude`·`agents` 변경(TD-10: runner 판정 명령 약화 포함), `.claude/*settings*.json`의 `permissions.allow` 추가·`permissions.deny` 삭제·`defaultMode` 변경·`enableAllProjectMcpServers: true`·`hooks` 변경·`disableAllHooks`, `.codex/config.toml`의 `sandbox_mode`·`approval_policy`·`approvals_reviewer` 변경, `.codex/hooks.json` 변경·삭제, 보호 경로 파일에 새로 들어간 `--dangerously-skip-permissions`·`bypassPermissions`·`danger-full-access`, `.gitignore`에서 `.env` 항목 삭제, 워크플로의 `environment:` 값이 `cfg.ci.environments` 밖, 워크플로 `permissions`에 새 `write`.
   - 결과 description: 실패가 있으면 첫 실패, 없으면 "보호 경로 변경: 신호 N건(위험도 높음)" 또는 "보호 경로 변경: 통과". details에 파일·항목별 사유.
   - JSON·TOML은 텍스트 비교로 충분한 범위만 다룬다(키 단위 비교가 필요한 JSON은 `JSON.parse`). 파싱 실패는 신호로 본다(fail-closed).
3. `scripts/ci/`: `GATE_CONTEXTS`에 `harness-guard`. `runGates`가 `harnessGuard`를 먼저 돌려 그 signals를 `riskGate`에 넘긴다. `gates` 명령에 `--pr-body <파일>`(step1 `ci-pr`이 쓴 본문).
4. `.github/pull_request_template.md` 자체 리뷰에 `- [ ] 보호 경로 변경: CHANGELOG 갱신, 검사를 약화하지 않음(또는 제작자 승인 요청)` 줄.
5. 테스트(`scripts/test/harness-guard.test.ts`, 먼저 실패 확인): 보호 경로 변경 없음, CHANGELOG 누락, 체크리스트 누락·미체크, 캐시 사용, 위 신호 각각 최소 한 건, 신호가 있으면 `runGates`의 `risk-gate`가 failure(승인 없음)·success(제작자 head 승인), 이 리포의 현재 설정 파일을 base=head로 넣으면 신호가 없음.
6. 문서: 설계서 10.4절 "샌드박스·권한 완화 탐지"에 처리(표시 + 위험도 높음, 제작자 결정)를 적는다. 절차서 4절(보호 경로 PR의 체크리스트·CHANGELOG), `architecture.md`, `CHANGELOG`, TD-10 해결.

## Acceptance Criteria

```bash
node --test scripts/test/harness-guard.test.ts scripts/test/risk-gate.test.ts scripts/test/ci.test.ts
grep -q "'harness-guard'" scripts/ci/results.ts
grep -q "보호 경로 변경:" .github/pull_request_template.md
grep -q "TD-10.*해결" docs/exec-plans/tech-debt-tracker.md
```

## 금지사항

- 약화·완화 신호를 `harness-guard` 실패로 만들지 마라. 이유: 제작자 결정(2026-11-14)은 "표시 + 위험도 높음"이다.
- 탐지 기준을 PR 트리 설정에서 읽지 마라. 이유: PR이 기준을 함께 바꿀 수 있다. 기준선은 base 파일과 main 설정이다.
- 이 step에서 `.claude/`·`.codex/` 설정 자체를 바꾸지 마라. 이유: 탐지 대상이라 이 PR의 위험도를 올리고, 범위 밖이다.
