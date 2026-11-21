# Step 1: baseline-procedure

## 읽어야 할 파일

- `docs/harness/architecture.md`, `docs/index.md`
- `docs/harness/workflow.md` 5절(push와 PR 본문 수정의 비용 안내), 7절(반드시 묻는 것: 비용)
- `docs/harness/design.md` 10.2~10.4절(읽기만)
- step0이 만든 파일: `scripts/metrics/actions-cost.ts`, `scripts/metrics/actions-source.ts`, `scripts/commands/actions-cost.ts`
- 이 계획의 `plan.md`("열린 질문"의 예산 질문과 제작자의 답)
- Issue #170, Issue #126

## 작업

새 문서 `docs/harness/actions-cost.md`를 쓰고 `docs/index.md`에 링크를 더한다. 문서의 frontmatter와 형식은 `docs/harness/`의 다른 문서를 따른다(`doc-lint`가 본다).

문서의 절(제목은 그대로 쓴다):

1. `## 왜 재는가`: 비공개 리포에서는 Actions가 과금되고(job마다 분으로 올림), 하네스를 쓸 프로젝트는 비공개다. 공개 리포는 청구가 0이라 청구서로 볼 수 없으므로 실행 기록으로 잰다. 포함 사용량은 계정의 비공개 리포 전체가 나눠 쓴다.
2. `## 재는 방법`: `node scripts/harness.ts actions-cost --since … --until …`. 계산 규칙(올림, 시도, 단가, 돌지 않은 job), 값이 뜻하는 것과 뜻하지 않는 것(공개 리포에서는 실제 청구가 아니다. 단가를 모르는 러너는 금액에 없다. 검증자의 구독 사용량은 들지 않는다. 앱의 테스트·빌드 시간은 프로젝트마다 다르다).
3. `## 예산`: 제작자가 정한 값(계정 월 예산, 프로젝트 하나의 월 예산, PR 하나당 청구 분). 절의 첫 줄에 상태를 적는다: `- 상태: 확정(제작자 결정, <날짜>)` 또는 `- 상태: 잠정(제작자 확인 전)`. 제작자의 답이 없으면 계획의 추천안을 잠정으로 적는다. 값을 지어내지 않는다.
4. `## 기준선`: 2026-11-17~2026-11-20(비공개 기간)을 `actions-cost`로 잰 결과를 표식 구간(`<!-- actions-cost:begin -->` 줄과 `<!-- actions-cost:end -->` 줄 사이)에 그대로 붙인다. 표식 구간 밖에 `잰 날짜: <YYYY-MM-DD>` 줄과 잰 명령(`node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-20`)을 적는다. Issue #170 본문의 임시 집계(청구 단위 3,391분)와 차이가 있으면 차이와 이유를 적는다(임시 집계는 최근 실행 1,000건만 읽었고 다시 실행한 시도를 따로 세지 않았다).
5. `## 판단 절차`:
   - 절감 수단을 하나 넣을 때마다 넣기 전과 뒤를 같은 길이의 기간으로 재서 표에 한 줄을 더한다(날짜, 수단, PR당 청구 분, push당 청구 분, 30일 환산, 판단). 효과가 없으면 되돌린다.
   - 판단 시점 셋: 절감 수단마다, 파일럿을 비공개 리포에서 시작하기 전(예산 안이면 시작, 아니면 다음 수단), 이 리포를 다시 비공개로 돌릴지 정할 때.
   - 파일럿 대상 리포에서 `check`의 실제 시간을 한 번 재서 환산에 넣는다.
   - 예산을 넘는 결정(지출 한도, 요금제, 러너)은 제작자가 한다(절차서 7절).
6. `## 기록`: 위 표(처음에는 기준선 한 줄. 첫 열은 기간의 시작 날짜 `2026-11-17`로 시작한다).

- 수치는 명령의 출력에서만 가져온다. 손으로 계산한 값을 섞지 않는다.
- 문서에 계정 이름, 주소, 절대 경로, PR 제목을 넣지 않는다.

## Acceptance Criteria

```bash
test -f docs/harness/actions-cost.md
grep -q "^## 왜 재는가" docs/harness/actions-cost.md
grep -q "^## 재는 방법" docs/harness/actions-cost.md
grep -q "^## 예산" docs/harness/actions-cost.md
grep -q "^## 기준선" docs/harness/actions-cost.md
grep -q "^## 판단 절차" docs/harness/actions-cost.md
grep -q "^## 기록" docs/harness/actions-cost.md
grep -Eq "^- 상태: (확정\(제작자 결정, 20[0-9]{2}-[0-9]{2}-[0-9]{2}\)|잠정\(제작자 확인 전\))" docs/harness/actions-cost.md
grep -Eq "^잰 날짜: 20[0-9]{2}-[0-9]{2}-[0-9]{2}" docs/harness/actions-cost.md
grep -q "actions-cost --since 2026-11-17 --until 2026-11-20" docs/harness/actions-cost.md
awk '/^## 판단 절차/{s=1;next} /^## /{s=0} s' docs/harness/actions-cost.md | grep -q "파일럿"
awk '/^## 판단 절차/{s=1;next} /^## /{s=0} s' docs/harness/actions-cost.md | grep -q "되돌린다"
awk '/^## 기록/{s=1;next} /^## /{s=0} s' docs/harness/actions-cost.md | grep -q "^| 2026-11-17"
t=$(mktemp -d) && node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-20 > "$t/out.md" && test -s "$t/out.md" && grep -v "^$" "$t/out.md" > "$t/a" && awk '/<!-- actions-cost:begin -->/{s=1;next} /<!-- actions-cost:end -->/{s=0} s' docs/harness/actions-cost.md | grep -v "^$" > "$t/b" && test -s "$t/b" && diff "$t/a" "$t/b"
grep -q "harness/actions-cost.md" docs/index.md
node scripts/harness.ts check
```

- 끝에서 둘째 줄은 GitHub을 읽는다(실행 수만큼 조회해 몇 분 걸린다). 문서에 붙인 기준선이 명령의 지금 출력과 같은지 본다. 빈 줄은 비교에서 뺀다(prettier가 표식 줄 앞뒤에 빈 줄을 둔다).

## 금지사항

- 예산 값을 제작자의 답 없이 확정된 것처럼 적지 마라. 이유: 비용은 제작자의 결정이다(절차서 7절). 답이 없으면 "잠정(제작자 확인 전)"이라고 적는다.
- 명령이 내지 않은 수치를 기준선에 넣지 마라. 이유: 다음에 다시 잴 때 같은 방법으로 비교할 수 없다.
- 설계서 5절·10.2~10.4절·13.2절과 절차서의 규칙을 고치지 마라. 이유: 이 step은 재는 절차만 적는다. 구조를 바꾸는 결정은 step2의 ADR과 그 뒤의 별도 Issue에서 한다.
- `.github/workflows/`를 고치지 마라. 이유: 제작자가 적용한다.
- step0의 코드를 고치지 마라. 이유: 재는 방법이 바뀌면 기준선이 흔들린다. 결함을 찾으면 진행 로그에 적고 제작자에게 알린다.
