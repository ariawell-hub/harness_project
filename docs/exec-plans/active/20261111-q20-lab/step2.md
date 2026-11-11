# Step 2: env-ref

## 읽어야 할 파일

- `lab/q20/README.md`, `lab/q20/deploy.ts`
- `docs/harness/design.md` 10.4절 "CI 작업 분리", "역할별 environment", "main 전용 environment는 PR 격리 장치가 아니다"

## 작업

항목 `env-ref`: `pull_request_target`이 어떤 ref·정의로 도는지, 역할별 environment(main만 허용)의 비밀이 어느 이벤트에 넘어가는지 확인한다. 제작자가 environment 4개와 가짜 시크릿 `Q20_FAKE_SECRET`을 만든 뒤에 시작한다(plan.md 열린 질문).

1. `lab/q20/repo/.github/workflows/`에 시험 워크플로를 추가하고 `deploy.ts --merge`로 배포한다.
   - `probe-prt.yml`: `pull_request_target`. environment별 job 4개와 environment 없는 job 1개. `github.ref`, `github.sha`, PR base·head SHA, 체크아웃된 워크플로 정의의 출처, 시크릿이 비었는지 여부와 sha256 앞 8자만 출력한다.
   - `probe-pr.yml`: `pull_request`. `judge-claude` environment를 참조한다. 기대: 배포 규칙에 막힌다.
   - `probe-push.yml`: main이 아닌 브랜치의 `push`. environment를 참조한다. 기대: 막힌다.
   - 모든 워크플로는 `permissions:`를 명시하고, 액션은 커밋 SHA로 고정하고, 캐시를 쓰지 않는다.
2. 공격 overlay(`lab/q20/attacks/env-ref-*/`)로 PR을 연다.
   - PR이 `probe-prt.yml`을 고쳐 시크릿을 출력하게 한다. 기대: `pull_request_target`은 main 정의로 돌아 고친 내용이 적용되지 않는다.
   - PR이 `probe-pr.yml`에서 environment 이름을 바꾼다. 기대: 여전히 막힌다.
3. 사례별 기대·관찰·판정·근거(실행 URL)를 `lab/q20/results/env-ref.json`에 기록한다.

## Acceptance Criteria

```bash
node lab/q20/report.ts --item env-ref
```

## 금지사항

- 시크릿 값을 그대로 출력하지 마라. 가짜여도 sha256 앞 8자만 쓴다. 이유: 이후 step의 유출 검사 기준을 흐리지 않기 위해서다.
- 공격 PR을 병합하지 마라. 이유: 시험 리포 main 정의가 오염된다.
