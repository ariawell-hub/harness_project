---
id: 20261119-actions-usage-2
issue: 135 # GitHub Issue 번호
type: feat # 브랜치 접두어: feat | fix | chore | docs | refactor | test
status: active # draft | active | blocked | completed | abandoned
size: medium # small | medium | large (4.3절)
risk: high # low | normal | high (10.1절)
author: claude-code # claude-code | codex | <사람>
owner: session # 선점한 runner 작업자 또는 사람
claimed_at: 2026-11-19T14:58:53+09:00 # new-task가 채운다
---

# chore: Actions 사용량 절감 2차 — 재현 job의 조건부 실행, main의 중복 test 생략 (TD-49 ③~⑤ 재검토)

## 목표와 수용 기준

GitHub Actions 청구 분을 줄인다(TD-49, Issue #135, 제작자 지시 2026-11-19). 2026-11-17~18 이틀의 job별 청구는 782분이고, PR 한 라운드(push 한 번)가 약 22분이다. 그 가운데 `check`가 7~8분, 나머지 14~15분은 1분 미만 job 13개가 분 단위로 올림된 값이다. 이 계획은 격리 경계(environment, PR 코드 실행 job의 권한)를 그대로 두고 **필요 없는 실행 두 가지**만 없앤다.

- (가) 재현 job(`repro`): 지금은 판정이 나오면 항상 돈다. 재현 테스트가 붙은 지적이 없으면 할 일이 없는데도 두 판정 워크플로에서 1분씩 청구된다(이틀에 57회).
- (나) main의 `test`: 병합 커밋의 트리가 PR head에서 이미 `test`를 통과한 트리와 같아도 main의 `check`가 `test`를 다시 돌린다(이틀에 10회, 회당 약 7.5분 가운데 `test`가 5~6분).

예상 절감은 그 이틀 기준으로 (가) 최대 57분, (나) 최대 50~60분이다(합쳐 782분의 14% 안팎). (나)의 main `check` 소요(2~3분 예상)는 추정이고 병합 뒤 실제 실행에서 잰다.

수용 기준:

1. 판정 job의 유출 검사 명령(`codex-scan`, `claude-scan`)이 판정을 내보낼 때 `GITHUB_OUTPUT`에 `repro=true` 또는 `repro=false`를 쓴다. 판정의 지적 가운데 재현 테스트 내용(`repro.content`)이 빈 문자열이 아닌 것이 하나라도 있으면 `true`다. 판정을 내보내지 못한 실행(유출 검사 실패 등)은 이 값을 쓰지 않는다.
2. 워크플로 패치를 적용하면 두 판정 워크플로의 재현 job 조건이 `needs.judge.outputs.verdict != '' && needs.judge.outputs.repro != 'false'`이다. 값이 없거나 `false`가 아닌 다른 값이면 지금처럼 돈다(모르면 돌린다). 재현 job의 권한·격리(비밀·environment·쓰기 권한 없음)와 기록 job의 입력은 그대로다.
3. `check --ci`가 **기본 브랜치의 push**에서 아래 조건을 모두 확인했을 때만 `test`를 돌리지 않고 `– test (건너뜀)`과 근거(PR 번호, head SHA, 실행 id)를 출력한다. 하나라도 확인하지 못하면(API 오류·응답 형식 다름 포함) 지금처럼 돌린다.
   - (a) 실행 환경: `--ci`이고 `GITHUB_EVENT_NAME`이 `push`, `GITHUB_REF`가 기본 브랜치이며, 읽기 토큰(환경 변수 `HARNESS_REUSE_TOKEN`)이 있다.
   - (b) 이 push가 더한 커밋이 HEAD 하나이고 그 부모가 비교 기준(`--base`)이다.
   - (c) HEAD에 연결된 PR이 정확히 하나이고, 병합됐고, 그 PR의 `merge_commit_sha`가 HEAD이며, base가 기본 브랜치이고 head 리포가 이 리포다.
   - (d) PR head 커밋의 트리가 HEAD의 트리와 같다.
   - (e) PR head가 HEAD의 부모(병합 직전의 main)를 모두 담고 있다(비교 API의 `behind_by`가 0). 그래야 PR의 `check`가 본 병합 결과 트리가 head 트리와 같다.
   - (f) 그 head SHA에서 `pull_request` 이벤트로 돈 `check` 워크플로(`check.yml`)의 가장 최근 실행이 끝났고 결론이 `success`다.
   - (g) base..HEAD의 바뀐 파일에 `testInertPaths` 밖(또는 보호 경로) 파일이 하나 이상 있다. 전부 목록 안이면 PR의 `check`가 `test`를 건너뛰었으므로(PR #130) main이 돌린다.
4. PR의 `check`, 로컬 `check`, 토큰이 없는 실행은 (나)를 적용하지 않는다. 기존 `testInertPaths` 건너뛰기의 조건과 "기본 브랜치의 check는 건너뛰지 않는다"는 그대로다((나)는 별도의 조건이다).
5. `HARNESS_REUSE_TOKEN`은 조건 확인에만 쓰고, `check`가 띄우는 단계(`fmt`·`lint`·`test` 등)의 프로세스 환경에는 남지 않는다.
6. `test`를 건너뛴 실행의 나머지 단계(`fmt`·`lint`·`test-effect`·`build`·`doc-lint`·`bypass-scan`·`secret-scan`)는 그대로 돌고, main `check`의 결론과 revert 흐름(`revert.yml`)은 바뀌지 않는다.
7. 워크플로 패치(`lab/actions-usage-2/workflows.patch`)가 main의 워크플로에 그대로 적용되고, 적용한 트리에서 `node scripts/harness.ts check`가 통과한다. 패치를 적용하지 않은 트리(봇이 올리는 head)에서도 통과한다.
8. 설계서(6절, 10.3·10.4절의 해당 부분, 5절 R4 표), 절차서, `docs/SECURITY.md`(`check.yml` 토큰 권한), `CHANGELOG`, 기술 부채 표(TD-49)가 바뀐 동작과 맞는다.

## 범위 / 비범위

범위:

- `scripts/`: 유출 검사 명령의 `repro` 출력, main `test` 재사용 판정과 `check` 연결, 테스트.
- 워크플로 변경은 **패치 파일로 준비**한다(`judge-claude.yml`, `judge-codex.yml`, `check.yml`과 그 구조를 단언하는 테스트의 해당 줄). 봇은 워크플로 파일을 push할 수 없으므로(`docs/SECURITY.md`) 제작자가 이 PR 브랜치에 패치를 적용한 커밋을 마지막으로 올리고 승인한다.
- 문서와 기술 부채 표.
- CI에서 `testInertPaths` 건너뛰기를 처음 관찰한 결과의 기록(TD-49에 남은 확인. 이 계획의 계획 전용 push가 그 조건에 해당한다).

비범위:

- **job 합치기(TD-49 ④)**: 하지 않는다. job이 나뉜 이유가 environment(시크릿 범위)와 PR 코드 실행 격리다.
- **인증 저장 job(`store`)의 조건부 실행**: 이번에는 하지 않는다. 실행 중 인증 갱신(`changed=true`)과 그 뒤의 복원을 아직 실제로 보지 못했다(TD-38). 매번 저장하는 지금 방식은 저장 경로가 깨지면 바로 드러난다. 첫 갱신을 확인한 뒤 다시 본다(라운드당 1분).
- **`gates`의 제목만 바뀐 수정 생략(TD-49 ⑤)**: 하지 않는다. `gates`의 동시 실행 그룹은 진행 중인 실행을 취소한다. 건너뛰는 실행이 push의 판정을 취소하면 그 head에 상태가 기록되지 않는다. 절감은 8일에 약 40분이다.
- main의 `check` job 전체 건너뛰기, 두 판정 워크플로의 `plan` job 합치기, 동시 실행 수 변경.
- 캐시 사용(10.4절 캐시 규칙은 그대로다).

## 관련 파일·문서

- `scripts/commands/check.ts`(`runCheck`, `testSkip`), `scripts/harness.ts`(`check`·`codex-scan`·`claude-scan` 명령)
- 새 파일 `scripts/ci/test-reuse.ts`, `scripts/test/test-reuse.test.ts`
- `scripts/ci/repro.ts`, `scripts/ci/verdict.ts`, `scripts/ci/codex-scan.ts`, `scripts/ci/claude-scan.ts`
- `scripts/test/check-skip.test.ts`, `scripts/test/ci.test.ts`, `scripts/test/gates.test.ts`
- `lab/actions-usage-2/workflows.patch`, `lab/actions-usage-2/README.md`(패치 적용 방법)
- 패치가 바꾸는 파일(봇은 커밋하지 않는다): `.github/workflows/check.yml`, `.github/workflows/judge-claude.yml`, `.github/workflows/judge-codex.yml`, `scripts/test/ci.test.ts`의 워크플로 구조 단언
- `docs/harness/design.md`, `docs/harness/workflow.md`, `docs/harness/CHANGELOG.md`, `docs/SECURITY.md`, `docs/exec-plans/tech-debt-tracker.md`
- 읽기만: `.github/workflows/revert.yml`, `scripts/ci/revert.ts`, `scripts/gates/harness-guard.ts`(`reproJobViolations`)

## step 목록

- step0 reuse-and-repro: 두 절감의 스크립트·테스트·문서와 워크플로 패치를 한 PR로 올린다. 제작자가 패치 커밋을 올리고 승인한다. 병합 뒤 실제 실행을 확인해 Issue에 남긴다.

## 진행 로그

- 2026-11-19: 제작자 대화 지시("이것들 진행하자". TD-49의 남은 후보 ③④⑤)로 봇이 Issue #135를 등록했다. 시작 전에 2026-11-17~18의 job별 청구를 다시 세어(782분) 후보를 다시 골랐다: ④는 합치기 대신 조건부 실행으로, ⑤는 하지 않는다. 계획을 썼다.

## 의사결정 로그

- 결정: job을 합치지 않고, 할 일이 없는 job을 돌리지 않는 쪽으로 한다. / 이유: 1분 미만 job이 나뉜 이유는 environment별 시크릿 범위와 PR 코드 실행 격리다(10.4절). 합치면 판정용 자격증명과 기록용 자격증명, 또는 PR 코드와 쓰기 권한이 한 러너에 놓인다. / 버린 대안: `gates`의 `evaluate`와 `record` 합치기, 판정 워크플로의 `repro`를 `judge`에 넣기(판정 자격증명이 있는 러너에서 PR 코드를 실행하게 된다).
- 결정: 재현 job을 돌릴지는 판정 job의 유출 검사 명령(main의 스크립트, LLM 없음)이 정해 job 출력으로 넘기고, 워크플로 조건은 "`false`가 아니면 돈다"로 쓴다. / 이유: 판정 내용에서 기계적으로 정해지는 값이다. 값이 빠지거나 깨졌을 때 재현 job이 도는 쪽이 안전하다(2라운드부터 새 P1은 "재현됨"이 아니면 동결되므로, 재현을 빠뜨리면 차단이 풀리는 쪽이다). 판정 출력과 같은 job에서 나오므로 신뢰 수준은 판정 출력과 같다. / 버린 대안: 워크플로의 셸에서 `jq`로 계산(테스트가 없다), 재현 job 안에서 일찍 끝내기(job이 뜨면 이미 1분이 청구된다).
- 결정: main의 `test`만 건너뛰고 `check` job과 나머지 단계는 그대로 돌린다. / 이유: main `check`의 결론이 revert 흐름의 입력이다. job 전체를 건너뛰면 결론이 `skipped`가 되어 그 흐름과 `revert-check`의 근거가 달라진다. 나머지 단계는 합쳐 1분 안팎이다. / 버린 대안: job 전체 건너뛰기(1~2분 더 줄지만 revert 구조를 바꿔야 한다).
- 결정: 재사용 조건은 `check` 명령 안에서 GitHub API로 직접 확인한다. 명령 옵션이나 "확인됨" 값을 받는 환경 변수는 만들지 않는다. / 이유: "`test`를 건너뛰라"는 옵션은 로컬에서 에이전트가 쓸 수 있는 우회로가 된다(R4). 직접 확인하면 환경 변수를 꾸며도 병합된 PR·같은 트리·성공한 `check`라는 사실이 없으면 건너뛰지 못한다. 켜고 끄는 것은 워크플로가 토큰을 주느냐로 정해지고, 워크플로는 제작자만 바꿀 수 있다. / 버린 대안: 워크플로의 앞 단계가 판정해 `--skip-test` 옵션으로 넘기기, `--only`로 단계 목록을 워크플로에 적기(단계가 늘면 워크플로와 어긋난다), 설정 키로 켜기(토큰 없이는 어차피 동작하지 않는다).
- 결정: PR head가 병합 직전의 main을 모두 담고 있을 것((e))을 조건에 넣는다. / 이유: PR의 `check`는 head가 아니라 head와 base를 합친 트리를 본다. head가 main을 모두 담고 있으면 그 트리가 head 트리와 같고, PR 쪽 건너뛰기 판정의 파일 목록이 main 쪽 목록을 포함한다((g)의 근거). 뒤처진 PR은 병합 전에 갱신하는 것이 이 리포의 절차라 평소에는 항상 맞는다. / 버린 대안: 트리 비교만 하기(대부분 맞지만 근거가 길어진다).
- 결정: 계획 위험도는 높음이다. / 이유: 필수 체크의 단계를 조건부로 생략하고(검사 약화), 워크플로 토큰의 읽기 권한을 넓힌다(보안·권한). / 버린 대안: 보통.
- 결정: 스크립트와 워크플로 패치를 한 PR에 넣고, 제작자가 패치 커밋을 그 브랜치의 마지막 커밋으로 올린다. / 이유: 판정 워크플로와 main의 `check`는 병합된 뒤의 정의로 돌기 때문에 스크립트와 워크플로가 한 번에 들어가야 어긋나는 구간이 없다. 제작자가 따로 PR을 올리면 제작자는 자기 PR을 승인할 수 없어 `risk-gate`의 제작자 head 승인을 채울 수 없다. 봇이 연 PR에 제작자가 커밋을 더하면 두 검증자가 워크플로 변경까지 판정하고 제작자가 승인할 수 있다. 워크플로 커밋이 브랜치에 들어간 뒤에 봇이 그 위에 push할 수 있는지는 확인된 적이 없어, 봇의 작업을 모두 끝낸 뒤 마지막에 올린다. / 버린 대안: 스크립트 PR과 워크플로 PR을 따로(판정 라운드와 승인이 한 번씩 더 든다), 봇 토큰에 `workflow` 권한 주기(`docs/SECURITY.md`가 금지한다).
- 결정: step은 하나로 둔다. 병합 뒤 확인은 Issue 댓글로 남기고, 기술 부채 표에는 다음 PR에서 옮긴다. / 이유: 계획 위험도가 높음이라 기록만 하는 둘째 step PR도 제작자 승인이 필요해진다. 급하지 않은 기록은 다음 PR에 모으는 것이 절차서 5절의 규칙이다. / 버린 대안: 관찰·기록 step을 따로 두기.

## 발견 사항

- 운영 단계에서 워크플로를 바꾸는 절차가 문서에 한 줄뿐이다("봇이 내용을 Issue나 패치로 넘기고 제작자가 직접 PR을 올린다"). 제작자가 연 PR은 제작자가 승인할 수 없어 `risk-gate`를 통과하지 못한다. 이 계획에서 "봇의 PR 브랜치에 제작자가 패치 커밋을 더한다"로 해 보고, 된 절차를 문서에 적는다(step0). → 처리: [docs/SECURITY.md](../../../SECURITY.md)
- TD-49의 "1분 미만 job 합치기 240~480분"은 합칠 수 있다는 가정의 추정이었다. 격리를 지키면 합칠 수 있는 job이 없고, 조건부 실행으로 줄일 수 있는 것은 재현 job(이틀에 57분)이다. step0에서 표를 고친다. → 처리: TD-49

## 열린 질문

### 질문: `check.yml`의 토큰에 읽기 권한 두 개를 더하고, main push의 `check` 단계에 그 토큰을 넘겨도 되는가

- 해당 항목: 보안·권한 결정.
- 배경: (나)는 "이 병합 커밋의 트리가 PR에서 이미 `check`를 통과했다"를 GitHub API로 확인해야 한다. 지금 `check.yml`은 `contents: read`뿐이고 어느 단계에도 토큰을 넘기지 않는다.
- 선택지 A(추천): `check.yml`의 권한에 `actions: read`, `pull-requests: read`를 더하고, `check` 단계에 push 이벤트에서만 `HARNESS_REUSE_TOKEN`으로 워크플로 토큰을 넘긴다. PR 실행에는 넘기지 않는다. 명령은 토큰을 조건 확인에만 쓰고 테스트 등 하위 프로세스의 환경에서 지운다. 토큰은 이 리포 읽기 전용이고 job이 끝나면 만료된다.
- 선택지 B: 권한을 넓히지 않는다. (나)를 하지 않고 (가)만 한다(절감은 절반).
- 선택지 C: `check` 단계가 아니라 그 앞의 별도 단계에만 토큰을 주고 결과를 옵션으로 넘긴다. 테스트 프로세스와 토큰이 같은 단계에 놓이지 않지만, "`test`를 건너뛰라"는 옵션이 생긴다.
- 추천 이유: main push에서 도는 코드는 이미 승인되어 병합된 코드다. 읽기 토큰으로 볼 수 있는 것은 그 러너가 이미 받아 둔 리포 내용과 PR·실행 목록이다. 옵션을 만들지 않으므로 로컬 우회로가 생기지 않는다.
- 진행: 답을 받기 전에는 A로 계획 검증과 구현을 진행한다. 워크플로 패치는 제작자가 직접 올리므로, A가 아니면 패치를 올리기 전에 알려 주면 된다. B면 (나)를 계획에서 빼고 다시 검증받는다.

## 검증 방법과 결과

- 수용 기준 1·3·4·5·6: `node --test scripts/test/test-reuse.test.ts scripts/test/check-skip.test.ts scripts/test/ci.test.ts`. API는 가짜 포트로 바꿔 조건 (a)~(g)를 하나씩 어긴 경우마다 `test`가 도는지 본다.
- 수용 기준 2·7: 임시 클론에서 `git apply --check lab/actions-usage-2/workflows.patch`와 적용 뒤의 `node scripts/harness.ts check`. 봇의 head에서는 `node scripts/harness.ts check`.
- 수용 기준 8: `node scripts/harness.ts doc-lint`.
- 병합 뒤(Issue #135 댓글): ① 재현 테스트가 없는 판정에서 두 워크플로의 `repro` job이 `skipped`인지, ② 다음 병합의 main `check` 로그에 `– test (건너뜀)`과 근거가 나오는지와 소요 시간, ③ `testInertPaths`만 바꾼 병합에서는 main이 `test`를 돌리는지(기회가 생기면).

## 다음 할 일

- 계획만 담은 커밋을 push해 초안 PR을 열고 계획 검증(G1)을 받는다. 이 push의 `check` 로그에서 `– test (건너뜀)`을 확인한다(TD-49에 남은 확인).
- Issue #135에 위 질문을 `needs-human`으로 올린다.
- 승인되면 step0을 구현한다.
