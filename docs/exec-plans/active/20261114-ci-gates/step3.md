# Step 3: deps-guard

## 읽어야 할 파일

- `docs/exec-plans/active/20261114-ci-gates/plan.md` (수용 기준 4, 의사결정 로그의 라이선스 허용 목록)
- `docs/harness/design.md` 5.1절 R17, 18절 Q14, 15절(설치 단계 설정)
- step0~2가 만든 파일: `scripts/ci/`, `scripts/gates/risk-gate.ts`, `scripts/gates/harness-guard.ts`
- `pnpm-lock.yaml`(lockfile v9: `importers`, `packages`), `pnpm-workspace.yaml`(`minimumReleaseAge`), `harness.config.json`, `profiles/*/profile.json`

## 작업

1. 설정: `harness.config.json`·`scripts/lib/config.ts`에 `deps: { lockfiles: string[]; minReleaseAgeDays: number; licenses: string[]; registry: string; osvApi: string }`. 값: `["pnpm-lock.yaml"]`, 14, `["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "ISC"]`, `https://registry.npmjs.org`, `https://api.osv.dev/v1/querybatch`. 웹 프로파일도 같은 기본값.
2. `scripts/lib/lockfile.ts`(의존성 없는 줄 단위 파서)
   - `export function parsePnpmLock(text: string): { packages: Set<string>; direct: Map<string, Set<string>> }`: `packages:` 아래 2칸 들여쓰기 키(`'@scope/name@1.2.3':`, `name@1.2.3:`, 따옴표 유무)와 `importers:`의 각 importer `dependencies`·`devDependencies`·`optionalDependencies` 이름.
   - `export function splitSpec(key: string): { name: string; version: string }`(스코프 `@` 처리, 피어 접미사 `(…)` 제거).
3. `scripts/gates/deps-guard.ts`
   - `export interface Registry { packument(name: string): Promise<unknown | null>; osv(q: { name: string; version: string }[]): Promise<unknown> }`(404 → `null`). 실제 구현은 `fetch` + 시간 제한, 테스트는 가짜.
   - `export async function depsGuard(o: { root: string; base: string; cfg: HarnessConfig; registry: Registry; now: Date }): Promise<GateResult>`: lockfile이 안 바뀌었으면 네트워크 없이 success("lockfile 변경 없음"). 바뀌었으면 base에 없던 `name@version`마다 레지스트리 실존, `time[version]` 기준 경과 일수 ≥ `minReleaseAgeDays`, `versions[version].license`(문자열·SPDX 식·옛 `{type}` 객체)가 허용 목록(`OR`는 하나, `AND`는 모두), OSV 취약점 없음. 새 직접 의존성 이름은 같은 PR에서 바뀐 `docs/decisions/ADR-*.md` 중 하나가 그 이름을 언급해야 한다. 네트워크·응답 형식 오류는 error(fail-closed).
   - 실패 description은 첫 위반 + 건수, details에 패키지별 사유.
4. `scripts/ci/`: `GATE_CONTEXTS`에 `deps-guard`, `runGates`를 async로(또는 deps만 따로 await) 바꾼다. 판정 job은 비밀 없이 레지스트리·OSV에 접속한다(`gates.yml` 변경 없음이 목표).
5. 테스트(`scripts/test/deps-guard.test.ts`, 먼저 실패 확인): 파서(스코프, 따옴표, 피어 접미사, importers), 변경 없음 → 네트워크 호출 0회, 새 버전 통과, 404, 게시 13일, 허용 밖 라이선스, `(MIT OR GPL-3.0)` 통과·`(MIT AND GPL-3.0)` 실패, OSV 취약점, 새 직접 의존성 ADR 있음·없음, 레지스트리 오류 → error. 이 리포의 실제 `pnpm-lock.yaml`을 base=head로 넣으면 success.
6. 문서: 설계서 18절 Q14에 ISC 추가(제작자 결정 2026-11-14), 5.1절 R17에 구현 위치, `architecture.md`, `CHANGELOG`.

## Acceptance Criteria

```bash
node --test scripts/test/deps-guard.test.ts scripts/test/ci.test.ts
grep -q "'deps-guard'" scripts/ci/results.ts
grep -q "export function parsePnpmLock" scripts/lib/lockfile.ts
grep -q '"ISC"' harness.config.json
```

## 금지사항

- YAML 파서 등 새 의존성을 추가하지 마라. 이유: 하네스 스크립트는 `node:` 내장 모듈만 쓴다(ADR-0001). 새 의존성은 이 검사의 대상이기도 하다.
- 테스트에서 실제 레지스트리·OSV에 접속하지 마라. 이유: 네트워크 의존 테스트는 flaky하고 CI `check`가 외부에 기댄다.
- 조회 실패를 통과로 처리하지 마라. 이유: fail-closed(R17).
