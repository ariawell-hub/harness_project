# Step 2: verify-guard

## 읽어야 할 파일

- `docs/exec-plans/active/20261119-pilot-prep/plan.md`(목표와 수용 기준 5·6·8, 의사결정 로그의 거부 프록시·공개 증거 항목, 진행 로그의 Playwright 확인 결과)
- `docs/harness/design.md` 11.1절(열 수 있는 주소, 증거), 14.6절(외부 입력은 데이터다)
- 앞 step에서 만든·바꾼 파일: `scripts/verify/judge.ts`(`Observation`, `Verdict`, `judge`), `scripts/verify/web.ts`(`verifyWeb`, 출력 폴더 구조, 정리 계약, 실행기에 넘기는 환경 변수), `scripts/test/verify-web.test.ts`(가짜 `dev`·가짜 실행기 만드는 법), `docs/harness/architecture.md`

## 작업

앱 출처 밖으로 나가려는 요청을 하네스 프로세스가 직접 거부·기록하는 프록시와, PR에 올릴 수 있는 증거 요약을 만든다. 둘 다 Node 표준 모듈만 쓰고 이 리포의 테스트로 확인한다. 브라우저를 이 프록시로 보내는 설정은 step3이다.

1. `scripts/verify/deny-proxy.ts`(새 파일)

   ```ts
   export interface DeniedRequest {
     kind: 'http' | 'connect' | 'upgrade';
     host: string;
     port: number;
   }
   export interface DenyProxy {
     /** http://127.0.0.1:<포트> */
     url: string;
     /** 지금까지 거부한 요청(최대 1000건까지 담는다) */
     denied(): DeniedRequest[];
     /** 거부한 요청의 전체 건수(1000건을 넘어도 센다) */
     count(): number;
     close(): Promise<void>;
   }
   export function startDenyProxy(): Promise<DenyProxy>;
   ```

   - `127.0.0.1`의 0번 포트에서 뜬다. 다른 인터페이스에 바인드하지 않는다.
   - 들어온 것은 **아무것도 전달하지 않는다.** 일반 HTTP 요청(절대 URL 형식 포함)은 403으로 답하고 닫는다. `CONNECT`는 403으로 답하고 소켓을 닫는다. 업그레이드 요청은 소켓을 닫는다. 깨진 요청은 닫는다.
   - 기록은 종류, 대상 호스트, 포트뿐이다. 경로, 쿼리 문자열, 헤더, 본문은 읽어 두지도 기록하지도 않는다. 호스트를 알 수 없으면 `host: '(알 수 없음)'`, `port: 0`.
   - `close()`는 열린 소켓을 모두 끊고 포트를 놓는다.

2. `scripts/verify/web.ts` 연결
   - `dev`를 띄우기 전에 프록시를 띄우고, 실행기에 환경 변수 `HARNESS_VERIFY_PROXY=<프록시 url>`을 더 넘긴다.
   - 실행기가 끝난 뒤(판정 전) 프록시의 기록을 읽는다. `count()`가 0이 아니면 판정을 실패로 하고 전체 문제에 "앱 출처 밖으로 가려는 요청 N건"과 호스트:포트 목록(중복 제거)을 더한다. 이 실패는 관찰 기록의 `allowed`와 무관하다.
   - `VerifyResult`에 `denied: { count: number; requests: DeniedRequest[] }`를 더한다.
   - 정리 계약에 프록시를 넣는다: 어느 경우에도 돌아가기 전에 `close()`한다.
   - 판정 뒤(통과·실패 모두, 결과 파일을 읽지 못한 경우 포함) 아래 3의 `buildEvidence`를 부르고 명령행 출력에 묶음 경로를 낸다. 에이전트가 원인을 볼 자세한 내용(시나리오별 문제, 관찰 기록, 거부된 요청)은 `local/detail.json`에 쓴다.

3. `scripts/verify/evidence.ts`(새 파일)

   ```ts
   export function buildEvidence(
     outDir: string,
     verdict: Verdict,
     meta: { startedAt: string; deniedCount: number },
   ): { dir: string; files: string[] };
   ```

   - `<outDir>/evidence/`에 `summary.json`과 `summary.md` **둘만** 만든다. 다른 파일은 복사하지 않는다(스크린샷, 영상, trace, HAR, 로그 모두 `local/`에 둔다).
   - 요약에 넣는 것: 실행 시각, 전체 판정(통과/실패), 시나리오 수, 거부 프록시에 닿은 요청 건수, 시나리오별 `파일:줄`·상태·건수(콘솔 에러, 실패한 요청, 그 가운데 앱 출처 밖이라 막은 요청, 의도한 실패로 뺀 건수)·관찰 기록 유무, 전체 문제의 **분류**(예: "시나리오 없음", "결과 파일 읽지 못함", "실행기 종료 코드 0 아님", "앱 출처 밖 요청")와 건수.
   - 요약에 넣지 않는 것: 실행 중에 만들어진 문자열 전부. 콘솔 문구, URL(호스트·경로·쿼리), 시나리오 제목, `judge`의 `problems` 문장, 거부된 요청의 호스트, 실행기·`dev`의 출력.
   - 시나리오의 파일 경로는 `e2e/`로 시작하고 영문자·숫자·`._-/[]()`만으로 된 경우에만 그대로 적고, 아니면 `(경로 생략)`으로 적는다. 상태는 정해 둔 값(`passed`, `failed`, `timedOut`, `skipped`, `interrupted`)이 아니면 `(알 수 없음)`으로 적는다.
   - `summary.md`는 PR 본문에 그대로 옮길 수 있는 글이다(표 하나와 한 줄 판정).

4. 테스트 `scripts/test/verify-guard.test.ts`(새 파일)
   - 프록시: Node `http` 클라이언트로 프록시에 ① 절대 URL 요청(`GET http://example.test:8080/path?token=<표식>`, 헤더 `Authorization: <표식>`), ② `CONNECT example.test:443`, ③ 업그레이드 요청을 보낸다. ①은 403, ②는 403 뒤 닫힘, ③은 닫힘이다. `denied()`가 종류·호스트·포트를 담고, 기록을 JSON으로 바꾼 문자열에 표식이 없다. `count()`가 3이다.
   - 프록시가 전달하지 않는다: 테스트가 띄운 대상 서버로 가는 요청을 프록시에 보냈을 때 대상 서버의 도달 횟수가 0이다(일반 요청, `CONNECT` 각각).
   - 1001번 보내면 `denied()`는 1000건, `count()`는 1001이다. `close()` 뒤 그 포트에 접속이 되지 않는다.
   - `verifyWeb`: 가짜 실행기가 `HARNESS_VERIFY_PROXY`로 요청을 하나 보내고 통과 결과를 쓰면 `ok: false`이고 `denied.count`가 1이다. 관찰 기록의 `allowed`를 올려도 실패다. 요청을 보내지 않으면 `ok: true`다. 어느 경우에도 끝난 뒤 프록시 포트에 접속이 되지 않는다(시간 초과와 중단 신호 포함).
   - `buildEvidence`: `evidence/`의 파일 목록이 정확히 `summary.json`, `summary.md`다. 통과·실패·결과 파일 없음 각각에서 만들어진다.
   - 표식 누출 없음: 표식 문자열을 시나리오 제목, 콘솔 문구, 실패한 요청의 URL(호스트·경로·쿼리 각각), `problems`, 거부된 요청의 호스트, 틀린 형식의 파일 경로와 상태 값에 넣은 판정으로 `buildEvidence`를 불렀을 때 `evidence/` 두 파일 어디에도 표식이 없다. 같은 판정의 `local/detail.json`에는 있다(진단용).
   - 건수가 맞다: 콘솔 에러 2, 실패한 요청 3(그 가운데 막은 것 1), 의도한 실패 1을 넣으면 요약의 숫자가 그대로다.

5. 문서
   - `docs/harness/architecture.md`의 `verify/*` 줄 갱신, `docs/harness/CHANGELOG.md` 한 줄, 설계서 0절 변경 이력 한 줄(다음 버전 번호).

## Acceptance Criteria

```bash
node --test scripts/test/verify-guard.test.ts
node --test scripts/test/verify-web.test.ts
test -f scripts/verify/deny-proxy.ts
test -f scripts/verify/evidence.ts
grep -q 'deny-proxy' docs/harness/architecture.md
node scripts/harness.ts lint
node scripts/harness.ts doc-lint
```

## 금지사항

- 프록시가 요청을 어디로든 전달하게 하지 마라(앱 출처 포함). 이유: 앱 출처는 브라우저 설정이 프록시를 지나지 않게 한다. 프록시에 닿은 것은 모두 허용 밖이다. 전달 기능이 있으면 허용 목록 판단이 프록시 안에 생기고 그 버그가 곧 외부 접속이다.
- 프록시가 경로·쿼리 문자열·헤더·본문을 기록하거나 출력하게 하지 마라. 이유: 자격증명이 들어 있을 수 있다(11.1절).
- 프록시를 `127.0.0.1` 밖의 인터페이스에 바인드하지 마라. 이유: 같은 네트워크의 다른 기기에 열린다.
- `evidence/`에 요약 두 파일 밖의 것을 넣지 마라. 요약에 실행 중에 만들어진 문자열을 넣지 마라(글자 수를 줄여 넣는 것 포함). 이유: 콘솔 문구·URL·제목·화면에 토큰이 찍힐 수 있고, 잘라도 남는다(계획 검증 F6). 스크린샷을 올리는 일은 이 계획의 범위 밖이다.
- 거부 프록시에 닿은 요청을 관찰 기록의 `allowed`나 다른 선언으로 뺄 수 있게 하지 마라. 이유: 외부 주소를 여는 예외는 계획에 적고 허용하는 일이지(11.1절) 시나리오 코드가 스스로 푸는 일이 아니다.
- 웹 프로파일의 `commands.verify`를 이 step에서 켜지 마라. 이유: Playwright 설정 파일은 step3에서 생긴다.
- `scripts/verify/`에서 `@playwright/test`를 import하지 마라. `scripts/harness.ts`, `scripts/lib/config.ts`, `harness.config.json`을 고치지 마라. 이유: 이 리포의 `lint`가 실패한다. 다른 세션과 겹치고 설정 키를 더하지 않는다.
- 테스트가 실제 외부 주소로 요청을 보내게 하지 마라. 이유: CI와 로컬 테스트는 네트워크에 기대지 않는다. 대상은 테스트가 띄운 로컬 서버나 `example.test`(프록시가 전달하지 않으므로 해석되지 않는다)로 한다.
- `scripts/test/` 아래 기존 테스트 파일(이 계획의 앞 step이 만든 것 제외)을 고치지 마라. 테스트에서 `sleep`으로 고정 시간을 기다리지 마라. 이유: 다른 세션과 겹친다. CI에서 흔들린다.
- 기술 부채 표, 설계서 11.1절 본문·14.3절·18절·0.1절·0.2절·10.2~10.4절, 절차서 5절을 고치지 마라. 이유: 11.1절 반영은 step4가 한다. 나머지는 다른 세션과의 합의와 Q10·Q13 미결정.
