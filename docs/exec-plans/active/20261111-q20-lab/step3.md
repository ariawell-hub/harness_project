# Step 3: check-source

## 읽어야 할 파일

- `lab/q20/README.md`, `lab/q20/deploy.ts`, step2의 워크플로
- `docs/harness/design.md` 0.2절(체크 출처), 10.3절, 10.4절
- `docs/decisions/ADR-0003-bot-token-classic-pat.md` "커밋 상태를 쓸 수 있다"

## 작업

항목 `check-source`: 필수 체크를 시험 App이 보낸 것만 인정하도록 고정할 수 있는지, 같은 이름을 흉내 내는 방법이 모두 막히는지 확인한다. 제작자가 시험 App을 만들고 `recorder`에 App ID·키를 넣은 뒤에 시작한다(plan.md 열린 질문).

1. `lab/q20/repo/.github/workflows/recorder.yml`: `pull_request_target`, environment `recorder`. App 토큰을 만들어(커밋 SHA로 고정한 공식 액션) PR head에 commit status `q20/recorded`를 success로 쓴다. LLM은 쓰지 않는다.
2. 배포 뒤 제작자에게 main 필수 체크 `q20/recorded`를 출처 = 시험 App으로 등록해 달라고 요청한다.
3. 흉내 사례를 PR로 시험한다. 기대: 모두 필수 체크를 만족하지 못한다.
   - PR이 `pull_request` 워크플로를 추가하고 job 이름을 `q20/recorded`로 둔다.
   - PR 워크플로가 `GITHUB_TOKEN`(statuses 쓰기)으로 status `q20/recorded`를 쓴다.
   - 봇 PAT로 `gh api`를 써서 status `q20/recorded`를 쓴다(ADR-0003의 위험).
   - 대조군: recorder job이 쓴 status만 있을 때 병합할 수 있는 상태가 된다.
4. 판정은 PR의 `mergeStateStatus`와 필수 체크 평가로 한다. commit status와 check run 각각에 출처 고정이 적용되는지도 기록한다.
5. 결과를 `lab/q20/results/check-source.json`에 기록한다.

## Acceptance Criteria

```bash
node lab/q20/report.ts --item check-source
```

## 금지사항

- App 키를 출력하거나 파일로 남기지 마라. 이유: 기록 job 키 유출은 검증 결과 위조로 이어진다(10.4절).
- 시험 App을 다른 리포에 설치해 달라고 요청하지 마라. 이유: ADR-0004 범위.
