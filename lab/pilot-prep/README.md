# 파일럿 착수 준비: 실물 확인

웹 프로파일의 `test-effect` 설정(TD-42)과 `verify` 구현(TD-12)을 실제 도구(Vitest, Playwright)로 돌려 본 기록이다. 이 템플릿 리포는 core 프로파일이라 두 도구가 없다. 그래서 임시 폴더에 이 리포를 복제해 웹 프로파일을 적용하고 거기서 돌린다. 계획은 `20261119-pilot-prep`(`docs/exec-plans/`)이다.

| 경로                              | 내용                                                                   |
| --------------------------------- | ---------------------------------------------------------------------- |
| `trial-test-effect.ts`            | `test-effect` 실물 확인을 돌리고 결과 파일을 쓴다                      |
| `check-results.ts`                | 결과 파일을 사례별 기대값과 대 본다(어긋나면 종료 코드 1)              |
| `results/test-effect-vitest.json` | `test-effect` 실물 확인 결과                                           |
| `test/`                           | `check-results.ts` 테스트(`node --test lab/pilot-prep/test/*.test.ts`) |

결과 파일은 스크립트가 쓴다. 손으로 고치지 않는다. 기대와 다른 사례가 나오면 래퍼나 설정을 고치고 다시 돌린다.

하네스 리포의 `tsconfig.json`·`check`는 `lab/`을 검사하지 않고, `scripts/test/`의 테스트는 `lab/`을 읽지 않는다(`testInertPaths`).

## test-effect (Vitest)

확인하는 것(계획의 수용 기준 2): 웹 프로파일을 적용한 실제 Vitest 프로젝트에서 `node scripts/harness.ts test-effect`가 판정을 내고, 테스트 파일 하나의 판정에 다른 테스트 파일의 결과가 섞이지 않는다.

```bash
T=$(mktemp -d)
git clone -q . "$T/repo"
(cd "$T/repo" && node scripts/harness.ts init --profile web && pnpm add -D --save-exact vitest)
node lab/pilot-prep/trial-test-effect.ts "$T/repo"
node scripts/harness.ts fmt
node lab/pilot-prep/check-results.ts test-effect-vitest
```

- 복제는 커밋된 내용만 가져간다. 확인할 변경을 먼저 커밋한다.
- `pnpm add`는 이 리포의 설치 정책(`pnpm-workspace.yaml`의 `minimumReleaseAge`, 설치 스크립트 차단)을 그대로 따른다. 설치된 버전은 결과 파일의 `tool.vitest`에 남는다.
- 결과 파일은 스크립트가 쓴 뒤 `fmt`로 포맷만 맞춘다(내용은 바뀌지 않는다).
- 임시 폴더는 지우지 않는다(R14).

스크립트가 하는 일:

1. 기준 커밋을 만든다: `src/math.ts`(`add`, 값을 그대로 돌려주는 `clamp`), 통과하는 테스트, `vitest.config.ts`. 설정에는 래퍼가 덮어써야 하는 값(`include`, `passWithNoTests: true`)을 일부러 넣는다.
2. 작업 트리를 바꾼다: `clamp`가 10으로 자르게 하고 새 모듈 `src/fresh.ts`를 더하고, 사례마다 테스트 파일 하나를 더한다.
3. `node scripts/harness.ts test-effect --base <기준 커밋>`을 두 번 돌린다: 일곱 사례가 모두 있을 때(`all`), 변경 전 코드에서도 통과하는 두 사례를 뺐을 때(`effective-only`).
4. 판정 줄과 종료 코드를 실행 출력에서 옮겨 `results/test-effect-vitest.json`에 쓴다.

| 사례 id          | 테스트 파일                         | 변경 전 코드에서 | 기대 판정                               |
| ---------------- | ----------------------------------- | ---------------- | --------------------------------------- |
| `passes-on-base` | `src/keep.test.ts`                  | 통과             | `ineffective`                           |
| `assertion`      | `src/change.test.ts`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `new-module`     | `src/fresh.test.ts`                 | 모듈 없음        | `effective`, 판정 줄에 `단언 실패 아님` |
| `similar-pass`   | `src/sim/a.test.ts`                 | 통과             | `ineffective`                           |
| `similar-fail`   | `src/sim/a.test.tsx`                | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `similar-nested` | `src/sim/deep/src/sim/a.test.ts`    | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |
| `special-path`   | `src/app/(shop)/[id]/page.test.tsx` | 단언 실패        | `effective`, 판정 줄에 `단언 실패`      |

`similar-*` 세 파일은 경로가 서로 부분 문자열이다. Vitest CLI의 파일 인자는 부분 문자열 필터라서 `vitest run src/sim/a.test.ts`는 세 파일을 모두 돌린다. 그러면 통과하는 `similar-pass`가 다른 두 파일의 실패 때문에 `effective`로 잘못 판정된다. 래퍼(`profiles/web/test-effect/run-one.mjs`)가 파일 하나만 돌리므로 `similar-pass`는 `ineffective`로 나와야 한다.

`check-results.ts test-effect-vitest`가 확인하는 것: `tool.vitest`가 있다, `command`가 `profiles/web/profile.json`의 `testEffect.command`와 같다, 두 실행의 종료 코드(`all` 1, `effective-only` 0), 위 표의 사례가 모두 있고 더 있는 것이 없다, 사례마다 파일·판정·판정 줄의 문구가 표와 같다.
