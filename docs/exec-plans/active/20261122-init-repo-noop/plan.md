---
id: 20261122-init-repo-noop
issue: 208 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: normal # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-22T19:09:47+09:00 # new-task가 채운다
---

# init이 --repo를 받고, 바뀌는 것이 없으면 설정 파일을 다시 쓰지 않는다 (TD-31)

## 목표와 수용 기준

`node scripts/harness.ts init`은 대상 리포를 고를 수 없고, 실행하면 늘 설정 파일을 다시 쓴다(기술 부채 표 TD-31, 설계서 16절). 세 가지가 겹쳐 있다.

- `--repo`가 조용히 무시된다. 명령줄의 옵션 표(`scripts/harness.ts`의 `OPTIONS`)는 모든 명령이 함께 써서 `init --repo <폴더>`는 오류 없이 받아들여지지만, `init` 분기는 그 값을 읽지 않고 명령을 실행한 리포에 적용한다.
- 바뀌는 것이 없어도 `harness.config.json` 전체를 `JSON.stringify`로 다시 쓴다. 이 리포의 설정은 포맷터의 서식이라 다시 쓰면 160줄쯤이 달라지고 `fmt --check`가 실패한다. 안내 문구만 보려고 실행했다가 worktree의 설정이 다시 쓰인 일이 있었다(계획 `20261115-review-ledger`의 발견 사항).
- 쓰지 않고 볼 방법이 없다. 무엇이 바뀌는지, 남은 수동 작업이 무엇인지 보려면 실제로 적용해야 한다.

수용 기준:

1. `init --repo <폴더>`는 그 폴더에 적용한다. 설정 파일과 프로파일(`profiles/<이름>/profile.json`), 템플릿을 모두 그 폴더에서 읽고 그 폴더에 쓴다. 상대 경로는 명령을 실행한 폴더 기준이다. 명령을 실행한 리포의 파일은 바뀌지 않는다. `--repo`가 없으면 지금처럼 명령을 실행한 리포다.
2. 프로파일을 적용한 설정의 내용이 지금의 내용과 같으면 설정 파일을 다시 쓰지 않는다(파일의 바이트가 그대로다). 서식이나 객체 안 키의 순서만 다른 것은 같은 내용이다(배열의 순서는 내용이다). 그때는 이미 적용돼 있어 다시 쓰지 않았다고 출력한다.
3. 내용이 달라지면 지금과 같은 결과를 쓴다: 프로파일의 `config` 항목을 덮어쓰고, `profile`·`profileVersion`을 적고, `--owner`·`--bot`이 있으면 `github.owner`·`github.bot`을 적고, 나머지는 그대로 두며, 들여쓰기 2칸의 JSON으로 쓴다. 출력에 바뀐 항목의 이름과 서식을 맞추는 방법(`fmt`)을 더한다.
   - 바뀐 항목의 이름: 값이 달라진 최상위 키. 양쪽 값이 모두 객체면 그 아래 키까지 적는다(`github.owner`, `commands.test`).
4. `init --dry-run`은 어떤 파일도 바꾸거나 만들지 않는다. 바뀔 설정 항목(없으면 없다고), 복사될 템플릿, 남은 수동 작업 안내를 출력하고 종료 코드는 0이다.
5. `--dry-run`을 읽지 않는 명령이 조용히 받아 실제로 실행하는 일이 없다. `init`이 아닌 명령에 주거나 값을 붙이면(`--dry-run=false`) 아무것도 실행하지 않고 종료 코드 2와 이유를 낸다.
6. 설정 파일이 없는 폴더에서는 이유를 내고 종료 코드 1이다(지금은 처리되지 않은 예외다). 프로파일이 없을 때의 문구와 종료 코드는 그대로다.
7. 템플릿을 복사하는 규칙(이미 있으면 건너뛰고, 자리 표시 파일이면 바꾼다)과 남은 수동 작업 안내의 글은 그대로다. 있던 테스트(`scripts/test/profile-web.test.ts`, `scripts/test/profile-web-db.test.ts`)는 고치지 않고 통과한다.
8. 도움말, README의 "새 프로젝트에 적용하기", 설계서 16절, 변경 이력이 위와 맞고, 기술 부채 표의 TD-31은 해결로 닫힌다.

## 범위 / 비범위

범위:

- `scripts/commands/init.ts`: 대상 폴더의 설정 파일 확인, 내용 비교, 바뀐 항목 이름, `dryRun`.
- `scripts/harness.ts`: `init` 분기가 `--repo`·`--dry-run`을 넘긴다. 옵션 표에 `dry-run`, 그 옵션의 사용 제한, 도움말.
- 테스트(새 파일), 문서, 기술 부채 표.

비범위:

- 이미 프로파일이 적용된 리포에서 덮어쓰기를 거부하거나 확인을 묻는 것. 템플릿은 core 프로파일이 적용된 채로 배포되고 `init`의 주된 쓰임이 프로파일을 바꾸는 것이라 "적용된 리포"를 가려낼 기준이 없고, 명령은 모두 비대화식이다. 바뀔 항목은 `--dry-run`으로 미리 본다("의사결정 로그").
- 다시 쓴 설정 파일의 서식을 `init`이 맞추는 것. 포맷터는 프로파일이 정하는 도구이고 `init`은 의존성을 설치하기 전에 돈다. 안내 문구와 README의 순서로 푼다.
- 다른 명령이 자기가 읽지 않는 옵션을 조용히 받는 것(`--dry-run`만 막는다). 옵션 표를 명령별로 나누는 일은 "발견 사항"에 적고 기술 부채 표의 새 행으로 남긴다.
- 프로파일 이름의 검증, 프로파일을 다른 폴더에서 읽는 옵션, 템플릿 복사 규칙.
- `profiles/`와 `harness.config.json`의 내용.

## 관련 파일·문서

- `scripts/commands/init.ts`, `scripts/harness.ts`
- `scripts/test/init.test.ts`(새 파일)
- `README.md`("새 프로젝트에 적용하기"), `docs/harness/design.md`(0절 머리말·변경 이력, 16절), `docs/harness/CHANGELOG.md`, `docs/exec-plans/tech-debt-tracker.md`(TD-31 행, 새 행 하나)
- 읽기만: `scripts/lib/config.ts`(`CONFIG_FILE`, `loadConfig`), `scripts/lib/util.ts`(`log`), `scripts/lib/exec.ts`(`runSync`), `scripts/test/helpers.ts`, `scripts/test/cli.test.ts`, `scripts/test/profile-web.test.ts`, `scripts/test/profile-web-db.test.ts`, `profiles/core/profile.json`, `profiles/web/profile.json`, `harness.config.json`, `docs/harness/architecture.md`, `docs/exec-plans/completed/20261115-review-ledger/plan.md`

## step 목록

- step0 init-target: `--repo`, 내용이 같으면 다시 쓰지 않기, `--dry-run`, 문서와 기술 부채 표

## 진행 로그

- 2026-11-22 19:13 `new-task --issue 208`로 시작했다(제작자 대화 지시의 다음 순서, TD-31). 처음에 규모를 small로 잡았다가 절차서 1절("동작이 바뀌는 변경은 아무리 작아도 medium 이상")에 맞지 않아, 커밋·push 전의 small 골격(worktree와 로컬 브랜치)을 걷어내고 medium으로 다시 만들었다(선점 `claim/208`은 그대로 썼다). 계획을 쓰기 전에 `init`과 명령줄 처리 코드를 읽고 초안 구현·테스트로 계획의 문장을 확인했다. 확인한 것: 이 리포의 설정을 `JSON.stringify`로 다시 쓰면 포맷 검사가 실패한다, 옵션 표가 명령 공용이라 `init --repo`가 오류 없이 무시된다, 값을 붙인 불리언 옵션(`--dry-run=false`)은 문자열로 읽혀 참이 되지 않는다.

## 의사결정 로그

- 결정: 적용된 리포에서 덮어쓰기를 거부하지 않고, 내용이 같으면 쓰지 않는 것과 `--dry-run`으로 푼다. / 이유: TD-31이 든 사고(안내만 보려다 설정이 다시 쓰였다)는 같은 프로파일을 다시 적용한 경우라 내용 비교로 없어진다. 템플릿은 core가 적용된 채로 배포되므로 "이미 초기화됐다"를 가릴 기준이 없고, 프로파일 바꾸기를 막으면 본래 쓰임이 막힌다. / 버린 대안: `--force` 없이는 거부(새 프로젝트의 첫 실행부터 `--force`가 필요해진다), 확인 묻기(명령은 비대화식이다).
- 결정: 쓰지 않는 옵션의 이름은 `--dry-run`이고, 바뀔 것이 있어도 종료 코드는 0이다. / 이유: 있는 `--check`(`fmt --check`)는 "바뀔 것이 있으면 실패"의 뜻이라 안내를 보려는 쓰임과 맞지 않는다. / 버린 대안: `--check`를 다시 쓰기, 기본을 쓰지 않는 쪽으로 바꾸고 `--write`를 요구하기(README와 문서의 사용법이 깨진다).
- 결정: `--dry-run`은 `init`에서만 받고 값을 붙인 꼴도 거절한다. / 이유: 옵션 표가 명령 공용이라, 표에 더하기만 하면 `run --dry-run` 같은 명령이 오류 없이 실제로 실행된다(`init --repo`와 같은 문제를 새로 만든다). 값을 붙이면 불리언으로 읽히지 않아 `init --dry-run=true`가 실제로 쓴다.
- 결정: 내용 비교는 `node:util`의 `isDeepStrictEqual`로 한다(객체 안 키의 순서는 보지 않고 배열의 순서는 본다). / 이유: 설정의 뜻이 같으면 다시 쓸 이유가 없다. 문자열로 비교하면 키 순서만 다른 설정을 다시 쓴다.
- 결정: 다시 쓴 파일의 서식은 `init`이 맞추지 않고 안내한다. README의 순서에 `fmt`를 넣는다. / 이유: 포맷터는 프로파일의 표준 명령이고 코어는 프로파일의 도구를 모른다(S5). `init`은 `pnpm install` 전에 돈다. 지금의 README 순서(`init` → `pnpm install` → `check`)는 `check`의 포맷 검사에서 실패한다.

## 발견 사항

- 명령줄의 옵션 표(`OPTIONS`)가 모든 명령 공용이라, 명령이 읽지 않는 옵션을 오류 없이 받는다. `init --repo`가 그 예였고, 다른 명령도 같다(예: `start --repo <폴더>`는 받아들여지고 무시된다). 옵션을 명령별로 검사하면 이런 오용이 실행 전에 드러난다.
- README의 "새 프로젝트에 적용하기" 순서(`init` → `pnpm install` → `check`)는 `init`이 설정 파일을 `JSON.stringify`로 다시 써서 `check`의 포맷 검사에서 실패한다(임시 폴더에서 다시 쓴 설정으로 `prettier --check` 실패를 확인했다).

## 열린 질문

없음.

## 검증 방법과 결과

- step0의 Acceptance Criteria.
- `node scripts/harness.ts check`.

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 승인 뒤 step0을 구현한다(테스트 먼저).
