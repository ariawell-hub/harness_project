# Step 1: judge-claude

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-cross-review/plan.md` (수용 기준 1·2·3·5, 의사결정 로그)
- `docs/harness/design.md` 10.4절 판정 job 규칙·"판정 job 안의 유출 검사"·캐시 규칙, 13.3절 Claude Code 인증
- step0이 만든 파일: `scripts/cross-review/{prompt.md,verdict.schema.json}`, `scripts/ci/{verdict,review-plan,record}.ts`
- `scripts/ci/pr.ts`(`resolvePr`의 `workflow_run`), `.github/workflows/gates.yml`
- Q20 소스: `git show 7b837e7:lab/q20/repo/.github/workflows/judge-claude.yml`, `lab/q20/repo/judge/scan.mjs`, `lab/q20/test/judge-scan.test.ts`

## 작업

1. `scripts/ci/review-input.ts` + `harness.ts review-plan --event <파일> --pr <pr 폴더> --config-root <base> --out-dir <폴더>`: PR 해석(`resolvePr`), merge-base 계산, 위험도(`harnessGuard` 신호 + `assessRisk`), `reviewersFor`, 그리고 `pr/.harness-review/`에 `changed.txt`·`diff.patch`(크기 상한, 넘으면 잘랐다고 표시)·`context.md`(계획 경로, 이 PR의 step 파일 경로, 위험도와 이유, 체크리스트 경로)를 쓴다. PR이 넣은 같은 이름의 폴더는 지우고 다시 만든다. `$GITHUB_OUTPUT`에 `skip`, `number`, `head_sha`, `risk`, `claude`, `codex`.
2. `scripts/ci/claude-scan.ts`(Q20 `scan.mjs` 이식): stream-json 실행 기록에서 도구 호출 대상의 실제 경로가 `pr/` 밖인지, 허용 밖 도구(`Read`·`Grep`·`Glob`·`StructuredOutput` 외), 비밀(needles)이 판정·기록에 있는지, `is_error`를 본다. `export function scanClaudeRun(o: { log: string; prDir: string; secrets: string[] }): { ok: true; verdict: unknown } | { ok: false; reason: string; errorText?: string }`. 문제가 없을 때만 판정을 낸다. 실행 오류 문구는 비밀을 가려 돌려준다. `harness.ts claude-scan --log <파일> --pr <폴더> --out <verdict.json>`(비밀은 환경 변수).
3. `.github/workflows/judge-claude.yml`: `on: workflow_run: workflows: [check], types: [completed]`, `permissions: {}`.
   - job `plan`(비밀 없음, `check` 성공일 때만): base(github.sha)·pr(심볼릭 링크 끔, fetch-depth 0) 체크아웃, `review-plan`.
   - job `judge`(`environment: judge-claude`, `plan.outputs.claude == 'true'`): base·pr 체크아웃 + `review-plan`으로 입력을 다시 만든다(job 사이에 `pr/`를 넘기지 않는다). Claude Code 2.1.314 설치(캐시 없음), `pr/`에서 `claude -p`(Q20과 같은 인자, 프롬프트는 `base/`의 `prompt.md`), 이어서 `claude-scan`. 판정은 job 출력(base64). 실행 기록은 올리지 않는다.
   - job `record`(`environment: recorder`, `!cancelled()`이고 건너뛰지 않았을 때): `record-review --context review/claude --needed <plan 출력>`. 스캔할 비밀은 없다(Claude 토큰은 이 job에 없다. 고엔트로피 검사만).
4. 테스트: `scripts/test/claude-scan.test.ts`(Q20 테스트 사례 이식: 정상, `pr/` 밖 읽기, `..` 경로, 허용 밖 도구, 토큰 원문·base64·조각, `is_error`, 판정 없음), `review-input` 테스트(입력 파일, 기존 폴더 덮어쓰기, diff 상한), 워크플로 불변식(SHA 고정, `judge-claude`는 `judge` job에만·`recorder`는 `record`에만, 캐시 없음, run 블록에 표현식 없음, `--tools Read,Grep,Glob`·`--restricted`·`--strict-mcp-config`·`dontAsk` 포함).
5. `harness.config.json` `ci.environments`는 이미 `judge-claude`를 담고 있다(확인만). 문서: 설계서 10.4절에 트리거(`check` 완료)와 입력 폴더, `architecture.md`, `CHANGELOG`, 진행 로그.

## Acceptance Criteria

```bash
node --test scripts/test/claude-scan.test.ts scripts/test/verdict.test.ts scripts/test/ci.test.ts
grep -q "environment: judge-claude" .github/workflows/judge-claude.yml
grep -q "workflows: \[check\]" .github/workflows/judge-claude.yml
grep -q "export function scanClaudeRun" scripts/ci/claude-scan.ts
```

## 금지사항

- 판정 job에 `recorder`·Codex 인증·GitHub 쓰기 권한을 두지 마라. 이유: 10.4절, 한쪽이 주입당해도 다른 인증이 노출되지 않게 한다.
- `--disallowedTools` 방식으로 도구를 빼지 마라. 이유: 새 도구가 생기면 열린다. 허용 목록(`--tools`)만 쓴다.
- 실행 기록 원문을 출력하거나 아티팩트로 올리지 마라. 이유: 10.4절.
- `pr/`의 어떤 파일도 실행하지 마라. 프롬프트·스키마·스크립트는 `base/`에서만 읽는다. 이유: 가장 흔히 뚫리는 곳이다.
