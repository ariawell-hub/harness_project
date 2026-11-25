# Step 0: entry

## 읽어야 할 파일

- `docs/exec-plans/active/20261125-symlink-main/plan.md`(목표와 수용 기준, 의사결정 로그)
- `scripts/hooks/guard.ts`, `scripts/hooks/session.ts`, `scripts/verify/web.ts`: 파일 끝의 직접 실행 판정
- `lab/q10-db/verify-artifacts.ts`의 `isMain`과 `lab/q10-db/test/verify-artifacts.test.ts`의 링크 테스트: 같은 문제를 고친 예(정션으로 링크를 만들어 Windows에서도 돈다)
- `scripts/test/guard.test.ts`(`runGuard`: 훅을 프로세스로 부르는 법), `scripts/test/session-hook.test.ts`(`runHook`, Stop 알림, 가짜 GitHub 상태), `scripts/test/verify-web.test.ts`(명령행의 받을 수 없는 인자), `scripts/test/selftest.test.ts`(`weaken`이 `scripts/hooks/guard.ts`의 `process.exit(2)`를 정확히 두 개로 센다), `scripts/test/helpers.ts`, `scripts/lib/github-fake.ts`(`initFakeState`)
- `docs/harness/design.md` 13.1절 "훅 구현 규칙"과 "남는 위험", `docs/harness/architecture.md`의 진입점 줄과 모듈 표

## 작업

1. 테스트를 먼저 쓰고 지금 코드에서 실패하는 것을 본다.
   - `scripts/test/entry-link.test.ts`(새 파일): 새 모듈을 import하지 않고 스크립트를 프로세스로만 부른다(변경 전 코드에서도 단언으로 실패하게). 임시 폴더(`mkdtempSync`, `realpathSync`로 풀지 않는다)에 리포를 가리키는 링크를 `symlinkSync(HARNESS_ROOT, link, 'junction')`으로 만든다(Windows는 정션, macOS·Linux는 심볼릭 링크).
     - (가) 링크 경로의 `scripts/hooks/guard.ts`: `git push --force origin main` → 종료 코드 2, stderr에 `R14`. `gh pr review 7 --approve` → 2, `R20`. `ls` → 0.
     - (나) `scripts/hooks/guard.ts`의 글에 `import.meta.url`과 `process.argv`가 없다.
     - (다) 판정 모듈을 불러오지 못하는 경우: 임시 폴더의 `scripts/hooks/guard.ts`에 진입 파일을 복사하고, 경우마다 새 임시 폴더에서 아래처럼 대역 파일을 둔다. 경우마다 금지 호출(`git push --force origin main`)과 `ls`를 넣으면 둘 다 종료 코드 2이고 stderr에 `fail-closed`가 있다.
       - 다른 파일이 없다(모듈 없음).
       - 설정 모듈 대역 `scripts/lib/config.ts`가 `export class ConfigError extends Error {}`이고, 판정 모듈 대역 `scripts/hooks/decide.ts`가 각각: 문법 오류인 글, 불러올 때 `throw new Error('boom')`, 불러올 때 `throw null`, 불러올 때 문자열을 던짐, `decide`를 export하지 않음(`export {};`).
       - 설정 모듈 대역 `scripts/lib/config.ts`가 불러올 때 `throw null`.
       - 판정 모듈 대역의 `decide`가 `null`을 던짐(불러오기는 되고 판정에서 던진다).
       - 오류 처리 중 재던짐: 판정 모듈 대역이 불러올 때 `process.stderr.write`를 던지는 함수로 바꾼 뒤 `null`을 던진다. 이 경우는 종료 코드 2만 단언한다(메시지를 쓸 수 없다).
     - (다-2) 재던짐 테스트가 `finally`를 본다는 확인: 진입 파일 사본에서 `catch`의 `try { 메시지 쓰기 } finally { process.exit(2) }`를 `finally` 없이 차례로 쓴 꼴(메시지 쓰기 뒤 `process.exit(2)`)로 바꾸고(바꿀 글이 정확히 한 번 있어야 한다), 위 재던짐 대역으로 실행하면 종료 코드가 2가 아니다.
     - (라) 링크 경로의 `scripts/hooks/session.ts`: Stop 입력, 환경 `HARNESS_FAKE_GH`(열린 PR 하나, `mergeState: DIRTY`)와 `CLAUDE_PROJECT_DIR`, `HARNESS_SESSION` 없음 → 종료 코드 0이고 stdout의 `systemMessage`에 그 PR 번호가 있다.
     - (마) 링크 경로의 `scripts/verify/web.ts --config x`(현재 폴더는 리포) → 종료 코드 1, stderr에 `받을 수 없는 인자`.
   - `scripts/test/entry.test.ts`(새 파일): `isEntry` 단위 테스트. 참: 같은 파일의 절대 경로, 링크(정션)를 거친 경로, 현재 폴더 기준 상대 경로, 테스트 파일 자신의 URL과 `process.argv[1]`. 거짓: 다른 파일, `argv1`이 `undefined`(테스트 파일 자신의 URL로도 거짓), 빈 문자열, 없는 파일(어느 쪽이든).
2. `scripts/lib/entry.ts`(새 파일): `export function isEntry(moduleUrl: string, argv1: string | undefined): boolean`. `argv1`에 기본값을 두지 않는다(호출자가 `process.argv[1]`을 넘긴다). `realpathSync.native(path.resolve(argv1))`와 `realpathSync.native(fileURLToPath(moduleUrl))`가 같으면 참. `argv1`이 `undefined`·빈 문자열이거나 어느 쪽이든 풀다가 던지면 거짓.
3. `scripts/hooks/decide.ts`(새 파일): `scripts/hooks/guard.ts`에서 `main`과 파일 끝 판정을 뺀 코드(`shellDialects`, `quote`, `argvToScript`, `patchFiles`, `normalize`, `loadGuardConfig`, `repoOfPath`, `planOwnerOf`, `buildContext`, `decide`)를 그대로 옮긴다. export 이름과 동작은 바꾸지 않는다.
4. `scripts/hooks/guard.ts`: 실행 전용 진입 파일로 다시 쓴다.
   - 정적 import는 `node:` 모듈만 둔다.
   - `main`은 `try` 안에서 `./decide.ts`와 `../lib/config.ts`를 동적 `import()`로 불러오고, stdin을 읽어 `decide`로 판정한다. 차단이면 stderr에 지금과 같은 메시지를 쓰고 `process.exit(2)`, 아니면 `process.exit(0)`.
   - `catch`는 지금처럼 fail-closed 메시지를 쓰고 `process.exit(2)`. 메시지를 만들고 쓰는 일은 `try`에 넣고 `process.exit(2)`는 그 `finally`에 둔다: 메시지 처리 중에 다시 던져도 종료 코드 2로 끝난다. 던진 값이 `Error`가 아니어도(`null`, 문자열) 메시지를 만든다(`(e as Error).message`처럼 속성을 바로 읽지 않는다). 설정 오류 메시지(`ConfigError`)는 그 클래스를 불러온 뒤에만 고르고, 불러오기 전의 오류는 내부 오류 메시지로 쓴다.
   - `process.exit(2)`는 두 곳(차단, `catch`)만 둔다(`selftest.test.ts`가 센다).
   - 파일 끝에서 조건 없이 `main`을 부른다. 머리 주석에 "실행 전용이다. import하지 않는다. 판정은 `decide.ts`"를 적는다.
5. `scripts/hooks/session.ts`, `scripts/verify/web.ts`: 파일 끝의 `process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`를 `isEntry(import.meta.url, process.argv[1])`로 바꾼다. 쓰지 않게 된 import는 지운다.
6. `scripts/test/guard.test.ts`: `import { buildContext, normalize } from '../hooks/guard.ts'`를 `'../hooks/decide.ts'`로 바꾼다. 다른 줄은 고치지 않는다.
7. 문서:
   - `docs/harness/design.md` 13.1절 "훅 구현 규칙": 진입 파일은 직접 실행을 판정하지 않고 늘 검사한다(판정 코드는 `scripts/hooks/decide.ts`), 판정 모듈을 불러오지 못해도 종료 코드 2로 막는다, 링크를 거친 경로(링크한 폴더, macOS의 `/tmp`·`/var`, Windows의 정션)로 불려도 같다(Issue #237)를 한 항목으로 적는다. "남는 위험"의 문구를 이에 맞춘다(훅 프로세스가 뜨지 못하는 경우만 남는다).
   - `docs/harness/architecture.md`: 진입점 줄에 L1 훅 진입 파일이 실행 전용이고 판정은 `hooks/decide.ts`임을, 라이브러리 목록에 `entry`를 넣는다.
   - `docs/exec-plans/tech-debt-tracker.md`: `lab/`의 스크립트 7개(plan.md 비범위)에 같은 판정이 남았다는 행 하나를 표 끝에 더한다.
   - 변경 조각 `docs/harness/changes/20261125-symlink-main-s0.md`(`## CHANGELOG`, `## 설계서 변경 이력`).

## Acceptance Criteria

```bash
node --test scripts/test/entry.test.ts scripts/test/entry-link.test.ts scripts/test/guard.test.ts scripts/test/session-hook.test.ts scripts/test/selftest.test.ts scripts/test/profile-web-db.test.ts
node scripts/harness.ts self-test
! grep -nE 'import\.meta\.url|process\.argv' scripts/hooks/guard.ts
L=$(mktemp -d)/test-effect.log && node scripts/harness.ts test-effect > "$L" 2>&1 && grep -F 'scripts/test/entry-link.test.ts: effective(base에서 단언 실패,' "$L"
node scripts/harness.ts check
```

## 금지사항

- 훅 명령과 권한 설정(`.claude/settings.json`, `.codex/hooks.json`, `.claude/runner-settings.json`)을 바꾸지 마라. 이유: 훅 명령의 경로는 그대로 두고 진입 파일 안에서 고친다. 권한·훅 설정 변경은 검사 약화 신호이고 이 step의 범위가 아니다.
- `decide.ts`로 옮기면서 판정(규칙, 메시지, export 이름)을 바꾸지 마라. 이유: 이 step은 진입만 고친다. 기존 테스트가 단언을 고치지 않고 통과해야 동작이 그대로임을 보인다.
- `scripts/selftest/`와 기존 테스트의 단언을 고치지 마라(`guard.test.ts`는 import 줄 하나만). 이유: 자체 테스트 파일 수정은 위험도 높음 신호이고 main의 시나리오로 시험받는다. 기존 단언이 동작 유지의 근거다.
- 새 테스트를 플랫폼 조건이나 `skip`으로 빼지 마라. 이유: 링크 문제는 macOS의 임시 폴더와 Windows의 정션에서 실제로 난다. 정션은 Windows에서 권한 없이 만들 수 있다.
- `lab/`을 고치지 마라. 이유: 비범위다(기술 부채 표에 남긴다).
