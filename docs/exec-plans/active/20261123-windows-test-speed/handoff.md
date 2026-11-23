# 세션 인수인계 (2026-11-23 저녁)

> 대화 세션 하나가 2026-11-23에 한 일과 남긴 일. 제작자가 "이번 스텝 마무리 되면 인수인계서 작성하고 작업 종료하라"고 해 만들었다.
> **이 파일은 #230 계획을 처음 push(초안 PR)하기 전에 지운다**(계획 검증에 들어갈 파일이 아니다).

## 0. 이어받는 세션이 먼저 할 일

1. `node scripts/harness.ts start`를 실행한다.
2. 열린 `needs-human`: **#180**(Q10 확정)은 다른 세션 담당이라 이쪽 일이 아니다. **#222**는 이 세션이 PR #227의 제작자 head 승인을 요청하며 붙였다(2026-11-23 댓글).
3. **PR #227**(Issue #222 step0)의 상태를 본다(1절). 초안을 풀고 자동 병합을 켰다. 제작자가 승인하면 GitHub이 병합한다. 승인 대기 중에는 커밋을 올리지 않는다. 병합됐으면 step1을 시작한다.
4. **Issue #230**(Windows 테스트 속도)은 이 세션이 선점했고 계획은 골격뿐이다(2절). 측정 결과로 계획을 쓴다.
5. `start`가 "다음 할 일"로 띄우는 `20261123-q13-personal-account`는 다른 세션의 계획이다.

## 1. PR #227 — Issue #222 step0 (변경 조각)

- 세션을 끝낼 때 head는 2a9e053이다(F12~F14 고침, `origin/main` 69ecad1 병합, 완료 처리, `check` 통과).
  - 판정이 통과했으면 이 세션이 `node scripts/harness.ts pr-ready`로 초안을 풀고 제작자 head 승인을 요청한 뒤 끝냈다. **승인 요청 뒤에는 커밋을 올리지 않는다.** main에 뒤처져 갱신이 필요하면 push 전에 제작자에게 먼저 알린다.
  - 통과하지 못했으면 새 지적이 PR의 지적 원장 댓글(`harness-ledger`)에 열려 있고 이 세션은 고치지 않고 끝냈다. 고칠 때는 index.json의 step0을 `in_progress`로 되돌리고, 진행 로그에 적고, `complete-step`을 다시 한다.
  - 확인: `gh pr view 227 --json isDraft,reviewDecision`, `gh pr checks 227`.
- worktree `harness_project.worktrees/feat/20261123-change-fragments-s0`, 브랜치 `feat/20261123-change-fragments-s0`, 선점 `claim/222`. 위험도 high라 제작자 head 승인이 있어야 병합된다.
- 구현 판정에서 Codex가 낸 P1 셋을 고쳤다. 자세한 것은 계획 `docs/exec-plans/active/20261123-change-fragments/plan.md`의 진행 로그 17:40, 19:10과 의사결정 로그 16이다.
  - F12: 조각의 풀 수 없는 링크 글(`[x](%ZZ)`)이 일반 링크 검사의 예외로 `doc-lint`를 멈췄다. 조각은 일반 링크 검사에서 뺀다.
  - F13: 조각 자리의 심볼릭 링크를 따라가 다른 파일의 글을 기록으로 셌다. `harness-guard`는 커밋 트리의 일반 파일(모드 100644·100755)만, `doc-lint`는 링크를 따라가지 않고 일반 파일만 읽는다.
  - F14: F13 고침의 `lstatSync`가 조각 상위 경로의 순환 링크에서 `ELOOP`를 던졌다(내 회귀). `fragmentEntry`가 예외 없이 종류를 본다. 이 경우의 테스트는 링크를 만들 수 있는 환경(CI Linux)에서만 돈다. 이 PC는 링크를 만들 수 없고(`EPERM`), 순환 junction·폴더 권한 막기로도 `lstat`이 예외를 내지 않아 고치기 전 실패를 로컬에서 재현하지 못했다.
- 병합되면 `node scripts/harness.ts new-task --plan 20261123-change-fragments --step 1`로 step1(모으기 명령 `changes-collect`)을 시작한다. step1은 자기 조각 파일로 기록한다(옛 방식 아님).
- 이 PC에서 `check` 한 번은 30분쯤 걸린다. 그사이 main이 자주 움직인다. push 조건에 "main보다 뒤처지지 않음"을 걸지 말고, 뒤처지면 승인 요청 전에 `origin/main`을 병합한다.

## 2. Issue #230 — Windows에서 하네스 테스트가 느리다

- worktree `harness_project.worktrees/fix/20261123-windows-test-speed-s0`, 브랜치 `fix/20261123-windows-test-speed-s0`, 선점 `claim/230`(2026-11-23 18:42). 규모 medium, 위험도는 아직 정하지 않았다(`scripts/lib/exec.ts`·`scripts/lib/git.ts`를 고치면 보호 경로다).
- 계획 파일은 골격뿐이다. 코드는 고치지 않았다.
- 같은 파일의 macOS·Windows 비교 자료는 Issue #230 댓글에 있다(`runner.test.ts` 244초 대 1257초, 테스트마다 4.3~5.6배).

### 측정: runner 테스트 하나가 무엇에 시간을 쓰는가

`scripts/test/runner.test.ts`의 "반복 실패는 5회에 멈추고…"(macOS 23.3초, Windows 100.4초) 하나를 추적을 켜고 돌렸다. 첫 측정은 다른 `check`가 돌지 않을 때 쟀다(83.7초). 호출 위치를 적은 둘째 측정은 PR #227의 `check`와 겹쳐 시간은 부풀었고, 횟수만 본다.

| 무엇                            | 횟수 | 시간(첫 측정) | 비고                                                         |
| ------------------------------- | ---- | ------------- | ------------------------------------------------------------ |
| 테스트 프로세스의 동기 git 호출 | 732  | 69.0초(82%)   | 가벼운 명령도 회당 55ms, 평균 94ms                           |
| `taskkill`(동기)                | 21   | 6.5초(8%)     | 회당 311ms. `run()`이 자식이 끝날 때마다 `killTree`를 부른다 |
| 비동기 실행(가짜 세션 등)       | 19   | 7.2초         | 자식 node의 시작은 22ms 안팎이다                             |

git 호출을 부른 곳(둘째 측정, 많은 차례):

| 횟수 | 명령 @ 부른 곳                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| 132  | `rev-parse` @ `repoInfo` (`scripts/lib/git.ts:50`)                                                                |
| 45   | `worktree` @ `listWorktrees` (`scripts/lib/git.ts:317`)                                                           |
| 43   | `symbolic-ref` @ `repoInfo` < `unposted` (`scripts/runner/run.ts:623`)                                            |
| 29   | `symbolic-ref` @ `repoInfo` < `conflictFile` (`scripts/runner/next.ts:156`)                                       |
| 24   | `rev-parse` @ `revParse` < `readLocalPlans` (`scripts/runner/next.ts:349`)                                        |
| 20   | `fetch` @ `fetchRemote` (`scripts/commands/task.ts:54`) < `runRunner`. 회당 약 450ms                              |
| 20×4 | `symbolic-ref`·`status`·`rev-parse`×2 @ `fastForwardMain` < `syncMain` (`scripts/runner/run.ts:237`)              |
| 8    | `gitleaks version`(회당 약 390ms)·`pnpm --version` @ `toolVersions` < `cacheKey` (`scripts/commands/check.ts:68`) |

정리: 시간은 프로세스 실행 횟수 × 회당 비용이다. Windows는 회당 비용이 크고(git 한 번 55~94ms), `repoInfo`는 같은 프로세스 안에서 같은 값을 여러 번 다시 읽는다. 한 단계가 막히는 것이 아니다(macOS 자료의 "테스트마다 고르게 4~5배"와 맞는다).

### 줄일 방법 후보 (계획에서 고른다)

1. **큰 테스트 파일 나누기**: `runner.test.ts`(1257초)가 혼자 `check`의 `test` 시간을 정한다(동시 8개). `runner-review`·`runner-pr`·`selftest`도 800초 넘는다. 나누면 원인과 상관없이 벽시계 시간이 준다. 동작 코드는 그대로다.
2. **`repoInfo` 다시 읽기 줄이기**: 한 번의 runner 반복이나 명령 안에서 결과를 넘겨 쓰거나 캐시한다. runner는 반복 사이에 브랜치를 바꾸므로 캐시를 언제 버릴지가 핵심이다. 실제 runner도 빨라진다.
3. **Windows의 `taskkill`**: 자식이 끝날 때마다 동기로 311ms를 쓴다. 비동기로 돌리거나 남은 자식이 있을 때만 부르는 안. 손자 프로세스(dev 서버) 정리 동작이 바뀌지 않게 해야 한다. 끝난 pid에 `taskkill`을 거는 것은 pid 재사용 위험도 있다(조사 필요).
4. **`check`의 캐시 키**: `cacheKey`가 부를 때마다 `gitleaks version`을 실행한다. 한 프로세스 안에서 한 번이면 된다.

### 발견 사항 (계획에 옮긴다)

- `toolVersions`의 `pnpm --version`이 Windows에서 3ms에 끝난다. 실행되지 않은 것으로 보인다(`pnpm`은 `.cmd` 래퍼라 셸 없이 띄울 수 없다. 확인은 안 했다). 그렇다면 `check` 캐시 키에 pnpm 버전이 빠진다. 속도와는 별개다.

### 측정 방법 (다시 재려면)

추적 스크립트를 `NODE_OPTIONS`로 넣는다. 리포 밖(임시 폴더)에 둔다. Git Bash에서는 `<경로>`를 Windows 형식(`cygpath -m`, 예: `C:/Users/...`)으로 쓴다. `/tmp/...`면 file URL이 깨진다.

```bash
TRACE230_LOG=<기록 파일> NODE_OPTIONS="--import=file:///<경로>/trace.mjs" \
  node --test --test-name-pattern="반복 실패는 5회에" scripts/test/runner.test.ts
```

```js
// trace.mjs: 이 프로세스가 띄우는 자식 프로세스(spawn·spawnSync)의 명령·시간·부른 곳을 TRACE230_LOG에 한 줄씩 적는다
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const LOG = process.env.TRACE230_LOG;
const t0 = performance.now();
const name = (c, a) => {
  const b = path.basename(String(c)).toLowerCase();
  const first = (a || []).find((x) => !String(x).startsWith('-'));
  if (b.startsWith('node')) return `node ${first ? path.basename(String(first)) : ''}`;
  if (b === 'git' || b === 'git.exe') return `git ${first ?? ''}`;
  return `${b} ${first ?? ''}`;
};
const where = () =>
  (new Error().stack || '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /scripts[\\/]/.test(l) && !/lib[\\/]exec\.ts|trace\.mjs/.test(l))
    .slice(0, 3)
    .map((l) =>
      l
        .replace(/^at /, '')
        .replace(/\(?file:\/\/\/.*?scripts[\\/]/, '')
        .replace(/:\d+\)?$/, ''),
    )
    .join(' < ');
const log = (o) => LOG && appendFileSync(LOG, JSON.stringify({ pid: process.pid, ...o }) + '\n');
const origSpawn = cp.spawn;
const origSync = cp.spawnSync;
cp.spawn = function (c, a) {
  const s = performance.now();
  const child = origSpawn.apply(this, arguments);
  child.once('exit', () =>
    log({ k: 'spawn', cmd: name(c, Array.isArray(a) ? a : []), ms: performance.now() - s }),
  );
  return child;
};
cp.spawnSync = function (c, a) {
  const s = performance.now();
  const r = origSync.apply(this, arguments);
  log({
    k: 'sync',
    cmd: name(c, Array.isArray(a) ? a : []),
    ms: performance.now() - s,
    at: where(),
  });
  return r;
};
syncBuiltinESMExports();
log({
  k: 'boot',
  argv: process.argv
    .slice(1, 3)
    .map((x) => path.basename(String(x)))
    .join(' '),
  ms: t0,
});
process.once('exit', () =>
  log({
    k: 'life',
    argv: process.argv
      .slice(1, 3)
      .map((x) => path.basename(String(x)))
      .join(' '),
    ms: performance.now(),
  }),
);
```

- 같은 커밋으로 macOS에서도 재면 회당 비용과 횟수를 나눠 견줄 수 있다(횟수는 같아야 한다).

### 다음 차례 (추천)

1. 위 측정을 `runner.test.ts` 전체와 `runner-review.test.ts`로 넓혀(다른 `check`가 돌지 않을 때) 후보 1~4의 몫을 잰다.
2. 계획을 쓴다. 수용 기준의 목표 값은 측정으로 정한다(Issue 본문). 검사를 약화하지 않는다(테스트를 줄이거나 건너뛰지 않는다).
3. `commands.test.timeoutSec`(이 리포 설정과 `profiles/core/profile.json`, 지금 둘 다 3600초)을 줄인 뒤 어떻게 둘지 정한다(Issue #230 댓글).
4. 이 파일을 지우고 계획만 담은 커밋 → `check` → push → 초안 PR(`Refs #230`) → 계획 검증(G1).
