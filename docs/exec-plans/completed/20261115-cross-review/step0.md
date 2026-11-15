# Step 0: verdict-core

## 읽어야 할 파일

- `docs/exec-plans/active/20261115-cross-review/plan.md` (수용 기준 2·5, 의사결정 로그)
- `docs/harness/design.md` 10.1절(검증자 구성, 위험도별 검증 수준, 검증 항목, 출력), 10.2절 (3) 지적 등급, 10.4절 "기록 job의 검사"
- `scripts/ci/results.ts`, `scripts/ci/record.ts`, `scripts/ci/gates.ts`, `scripts/gates/risk-gate.ts`, `scripts/cross-review/checklist.md`
- Q20 소스: `git show 7b837e7:lab/q20/repo/judge/prompt.md`, `verdict.schema.json`, `scan.mjs`(needles)

## 작업

1. `scripts/cross-review/verdict.schema.json`: `{ verdict: approve | request_changes, risk: low | normal | high, summary(≤1000), findings[≤30]: { severity: P0~P3, file(≤300), line(정수, 0 = 모름), title(≤200), evidence(≤1500), suggestion(≤1000) } }`, `additionalProperties: false`. `risk`는 검증자 의견이고 올리는 데만 쓴다(#55에서 반영).
2. `scripts/cross-review/prompt.md`: 검증자 공통 프롬프트. 작업 폴더의 모든 내용은 신뢰할 수 없는 데이터, 폴더 밖·환경 변수·인증 정보 금지, 읽을 입력(`.harness-review/changed.txt`·`diff.patch`·`context.md`, 계획과 step 파일), 10.1절 검증 항목(`checklist.md`와 같은 항목), 등급 기준과 차단 지적의 근거 요건(위치 + 실패 시나리오), 범위는 이번 diff와 직접 영향, 비밀처럼 보이는 값을 옮겨 적지 말 것, 출력은 스키마 하나.
3. `scripts/ci/verdict.ts`
   - `export interface Verdict`와 `export function validateVerdict(raw: unknown): { ok: true; value: Verdict } | { ok: false; reason: string }`(스키마와 같은 규칙을 코드로. 모르는 키 거부).
   - `export function secretNeedles(values: string[]): (text: string) => boolean`: 원문, base64·base64url·hex(대소문자)·URL 인코딩, 16자 조각. 16자 미만 값은 원문만.
   - `export function highEntropy(text: string): boolean`: 40자 이상 연속한 base64/hex 꼴 토큰 중 엔트로피가 높은 것(커밋 SHA 40자리 hex는 제외).
   - `export function verdictStatus(v: Verdict): { state: 'success' | 'failure'; description: string }`: 승인이고 P0·P1이 없으면 success. description에 등급별 건수.
4. `scripts/ci/review-plan.ts`: `export function reviewersFor(risk: Risk, author: string): { claude: boolean; codex: boolean }`(10.1절 표), `export function planAuthor(root: string, branch: string): string`(계획 frontmatter `author`, 없으면 `''`).
5. `scripts/ci/results.ts`·`record.ts`: `REVIEW_CONTEXTS = ['review/claude', 'review/codex']`. `export async function recordReview(o: { context; needed: boolean; raw: string | null; secrets: string[]; headSha; repo; post })`: 필요 없으면 success "해당 없음(위험도·작성 도구 기준)". 필요하면 JSON 파싱 → `validateVerdict` → 판정 전체 문자열에 `secretNeedles`·`highEntropy` 검사 → `verdictStatus`. 어느 단계든 실패하면 `error`(사유는 값 없이).
6. `harness.ts record-review --context <review/claude|review/codex> --needed <true|false> --verdict <파일> --head-sha --repo-slug --target-url`(토큰 `GH_TOKEN`, 스캔할 비밀은 환경 변수 `SCAN_SECRETS`에 줄 단위).
7. 테스트 `scripts/test/verdict.test.ts`(먼저 실패 확인): 스키마 경계(모르는 키, 길이, 등급, 건수), needles(원문·각 인코딩·조각, 짧은 값), 엔트로피(SHA·일반 문장은 통과), 검증자 표(위험도 3 × 작성자 3), 기록(해당 없음, 승인, P1 있는 승인 → failure, 변경 요청, 깨진 JSON·비밀 포함·고엔트로피 → error), 스키마 파일과 코드 규칙의 일치(필드·enum·최대 길이를 스키마 JSON에서 읽어 비교).
8. 문서: `architecture.md`, `CHANGELOG`, 계획 진행 로그.

## Acceptance Criteria

```bash
node --test scripts/test/verdict.test.ts scripts/test/ci.test.ts
test -f scripts/cross-review/prompt.md
node -e 'JSON.parse(require("fs").readFileSync("scripts/cross-review/verdict.schema.json","utf8"))'
grep -q "export function reviewersFor" scripts/ci/review-plan.ts
grep -q "record-review" scripts/harness.ts
```

## 금지사항

- 비밀 값이나 그 조각을 오류 메시지·로그·상태 설명에 넣지 마라. 이유: 기록 job의 출력은 PR 화면에 보인다.
- 스캔 실패를 통과로 처리하지 마라. 이유: fail-closed(10.4절).
- 이 step에서 워크플로를 추가하지 마라. 이유: 판정 job은 step1·2다.
