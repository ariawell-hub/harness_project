# Step 1: baseline-procedure

## 읽어야 할 파일

- `docs/harness/architecture.md`, `docs/index.md`
- `docs/harness/workflow.md` 5절(push와 PR 본문 수정의 비용 안내), 7절(반드시 묻는 것: 비용)
- `docs/harness/design.md` 10.2~10.4절(읽기만)
- step0이 만든 파일: `scripts/metrics/actions-cost.ts`(`actionsCost`, `renderCost`, `recordCells`, `parseSaved`, `fromSaved`, `knownNamesFrom`), `scripts/metrics/actions-source.ts`, `scripts/commands/actions-cost.ts`(`--save`, `--from`)
- `lab/q10-db/README.md`, `lab/q10-db/check-results.ts`, `lab/q10-db/test/check-results.test.ts`(검사 스크립트와 그 테스트를 두는 방식의 본보기)
- 이 계획의 `plan.md`("열린 질문"의 예산 질문과 제작자의 답, 의사결정 로그의 예산 결정)
- Issue #170, Issue #126

## 작업

검사 스크립트의 테스트(`lab/actions-cost/test/check-doc.test.ts`)를 먼저 쓰고 실패하는 것을 확인해 진행 로그에 적는다(R5).

### 1. 기준선의 입력을 남긴다 (`lab/actions-cost/2026-11-17_2026-11-20.jsonl`)

```bash
T=$(mktemp -d) && node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-20 --save lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/live.md"
```

- GitHub을 읽는다(실행 수만큼 조회해 몇 분 걸린다). 이 step에서 GitHub을 읽는 것은 이 한 번이다.
- 이 파일이 기준선의 입력이고 기준이다(보존 기록). 그 뒤로는 GitHub을 다시 읽지 않는다. 문서에 붙이는 기준선과 기록 표의 값은 `node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl`의 출력에서만 가져온다.
- 파일을 손으로 고치지 않는다. 포매터(`fmt`)는 `.jsonl`을 건드리지 않는다.
- 잰 뒤에 그 기간의 실행을 누가 다시 실행하거나 실행 기록이 지워져 GitHub을 다시 읽은 값이 달라져도 기준선은 바뀌지 않는다. 보존 기록이 GitHub의 그 시점 기록과 같은지는 AC가 보지 않는다(다시 읽으면 달라질 수 있어 볼 수 없다). 잰 날짜와 잰 명령을 문서에 적어 둔다.

### 2. 문서 (`docs/harness/actions-cost.md`, 새 파일)

frontmatter와 형식은 `docs/harness/`의 다른 문서를 따른다(`doc-lint`가 본다). 절은 아래 여섯이고 제목과 순서를 그대로 쓴다. 굵은 글씨로 적은 줄의 머리(`- 상태:` 등)는 글자 그대로 쓴다. 검사 스크립트가 그 줄을 찾는다.

1. `## 왜 재는가`: 비공개 리포에서는 Actions가 과금되고(job마다 분으로 올림), 하네스를 쓸 프로젝트는 비공개다. 공개 리포는 청구가 0이라 청구서로 볼 수 없으므로 실행 기록으로 잰다. 포함 사용량은 계정의 비공개 리포 전체가 나눠 쓴다.
2. `## 재는 방법`: `node scripts/harness.ts actions-cost --since … --until …`, 입력을 남기는 `--save`와 남긴 입력으로 다시 계산하는 `--from`. 계산 규칙(올림, 시도, 단가, 돌지 않은 job), 값이 뜻하는 것과 뜻하지 않는 것(공개 리포에서는 실제 청구가 아니다. 단가를 모르는 러너는 금액에 없다. 검증자의 구독 사용량은 들지 않는다. 앱의 테스트·빌드 시간은 프로젝트마다 다르다. "PR 하나당 청구 분"은 PR 밖 실행까지 PR 수로 나눈 값이다).
3. `## 예산`: 제작자가 2026-11-21에 정한 값을 아래 네 줄로 적는다(계획의 의사결정 로그). 값을 바꾸거나 더 지어내지 않는다. 줄 뒤에 설명을 이어 적어도 된다.
   - **`- 상태: 확정(제작자 결정, 2026-11-21)`**
   - **`- 계정의 월 예산: $18`** (Pro의 포함 사용량)
   - **`- 프로젝트 하나의 월 PR 수: 100개`**
   - **`- PR 하나당 예산: 30분($0.18`** … `)` (2코어 Linux 기준)
4. `## 기준선`: 2026-11-17~2026-11-20(비공개 기간).
   - 표식 구간(`<!-- actions-cost:begin -->` 줄과 `<!-- actions-cost:end -->` 줄 사이)에 `actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl`의 출력을 그대로 붙인다. 표식 구간은 문서에 하나다.
   - 표식 구간 밖에 **`잰 날짜: <YYYY-MM-DD>`** 줄, 잰 명령(`node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-20 --save lab/actions-cost/2026-11-17_2026-11-20.jsonl`), 다시 계산하는 명령(`node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl`)을 적는다.
   - Issue #170 본문의 임시 집계(청구 단위 3,391분)와 차이가 있으면 차이와 이유를 적는다(임시 집계는 최근 실행 1,000건만 읽었고 다시 실행한 시도를 따로 세지 않았다).
5. `## 판단 절차`: 아래 여덟 항목을 이 머리로 시작하는 목록 줄로 하나씩 적는다(머리 뒤에 내용을 쓴다. 아래 괄호 안은 써야 할 내용이다).
   - **`- 기준이 되는 입력:`** (기준은 보존 기록이다. 확인은 `--from`으로 한다. GitHub을 다시 읽은 값이 달라도 보존 기록을 바꾸지 않는다. 워크플로·job 이름이 바뀌어 `--from`의 출력이 달라지면 같은 보존 기록으로 다시 계산해 붙인다.)
   - **`- 다시 재는 때:`** (절감 수단을 하나 넣을 때마다 넣기 전과 뒤를 같은 길이의 기간으로 `--save`해 재고, "기록" 표에 한 줄을 더한다.)
   - **`- 판단 시점 1(절감 수단마다):`** (전후를 견줘 효과를 본다.)
   - **`- 판단 시점 2(파일럿을 비공개 리포에서 시작하기 전):`** (예산 안이면 시작, 아니면 다음 수단.)
   - **`- 판단 시점 3(이 리포를 다시 비공개로 돌릴지 정할 때):`**
   - **`- 효과가 없을 때:`** (그 수단을 되돌린다.)
   - **`- 파일럿 실측:`** (파일럿 대상 리포에서 `check`의 실제 시간을 한 번 재서 환산에 넣는다.)
   - **`- 예산을 넘는 결정:`** (지출 한도, 요금제, 러너는 제작자가 정한다. 절차서 7절.)
6. `## 기록`: 표 하나. 머리 줄은 **`| 기간 | 수단 | 청구 분 | PR 하나당 청구 분 | PR 하나당 금액 | PR head 하나당 청구 분 | 30일 환산 금액 | 보존 기록 | 판단 |`**이다.
   - 처음에는 기준선 한 행이다. `기간`·`청구 분`·`PR 하나당 청구 분`·`PR 하나당 금액`·`PR head 하나당 청구 분`·`30일 환산 금액`은 `--from` 출력의 기록 칸 행(`recordCells`)을 그대로 옮긴다. `수단`은 `기준선`, `보존 기록`은 파일 이름(`2026-11-17_2026-11-20.jsonl`)이다.
   - `판단`은 `예산 안`·`예산 밖`·`판단 못 함` 가운데 하나로 시작하고 뒤에 한 줄 설명을 단다. 아래 순서로 정한다. 칸에 적힌 반올림한 글이 아니라 보존 기록으로 계산한 값으로, 금액은 밀리달러 정수로 견준다. ① PR 수가 0이면 `판단 못 함`. ② 단가를 아는 러너의 금액만으로 PR 하나당 금액(전체 금액 ÷ PR 수)이 예산(`$0.18`)을 넘으면 `예산 밖`(단가를 모르는 러너의 분은 금액을 늘릴 뿐이다). ③ 그렇지 않고 단가를 모르는 러너의 청구 분이 0보다 크면 `판단 못 함`(금액에 빠진 것이 있어 예산 안이라고 할 수 없다). ④ 그 밖은 `예산 안`. self-hosted 러너의 분은 Actions 청구가 아니라 판단을 바꾸지 않는다. `판단 못 함`의 설명에는 까닭(PR이 없음, 또는 단가를 모르는 러너의 분과 그 러너의 단가를 확인해야 한다는 것)을 적는다. 비교는 분이 아니라 금액으로 한다(단가가 다른 러너가 섞여도 맞다. 지금은 단가를 아는 러너가 2코어 Linux뿐이라 30분과 같은 기준이다).

- 수치는 명령의 출력에서만 가져온다. 손으로 계산한 값을 섞지 않는다.
- 문서에 계정 이름, 주소, 절대 경로, PR 제목을 넣지 않는다.

### 3. 검사 스크립트 (`lab/actions-cost/check-doc.ts`, `lab/actions-cost/test/check-doc.test.ts`, `lab/actions-cost/README.md`. 모두 새 파일)

문서가 비어 있거나 값이 보존 기록과 다르면 실패하게 하는 검사다. `grep`으로 낱말을 찾는 대신 문서의 구조와 값을 읽는다. GitHub을 읽지 않는다(`scripts/metrics/actions-source.ts`를 import하지 않는다).

```ts
/** 제작자가 정한 예산(2026-11-21). 문서의 "예산" 절이 이 값과 같아야 한다 */
export const BUDGET = {
  accountUsd: 18,
  prsPerMonth: 100,
  minutesPerPr: 30,
  usdPerPr: 0.18,
} as const;
export const BASELINE_FILE = '2026-11-17_2026-11-20.jsonl';

export interface DocInputs {
  /** 문서의 글 */
  doc: string;
  /** 보존 기록 파일의 글(이름으로 찾는다). 없으면 null */
  saved: (name: string) => string | null;
  known: KnownNames;
}
/** 어긋난 점의 목록. 없으면 빈 배열 */
export function checkDoc(i: DocInputs): string[];
```

- 명령행: `node lab/actions-cost/check-doc.ts [--doc <파일>] [--dir <보존 기록 폴더>]`. 기본값은 `docs/harness/actions-cost.md`와 `lab/actions-cost/`다. 허용 목록은 체크아웃의 워크플로 파일에서 만든다(`knownNamesFrom`). 어긋난 점이 없으면 종료 코드 0, 있으면 목록을 표준 오류에 내고 1, 인자가 틀리거나 문서를 읽지 못하면 1이다.
- `checkDoc`이 보는 것(하나라도 어긋나면 그 점을 목록에 넣는다):
  1. **절**: 위 여섯 절의 제목이 각각 한 번, 정한 순서로 있다.
  2. **왜 재는가, 재는 방법**: 본문이 공백을 빼고 100자 이상이다. "왜 재는가"에 `비공개`·`올림`·`포함 사용량`이, "재는 방법"에 `actions-cost --since`·`--save`·`--from`·`올림`·`단가`가 있다.
  3. **예산**: 네 줄이 각각 한 번 있고 값이 `BUDGET`과 같다. 상태 줄은 `- 상태: 확정(제작자 결정, 2026-11-21)`로 시작한다. 금액·수는 줄에서 수로 읽어 견준다(`$18`과 `$18.00`은 같다. `$180`, `300분`은 다르다).
  4. **기준선**: 표식 구간이 하나다. 보존 기록 `BASELINE_FILE`이 있고 `parseSaved`를 통과하며 기간이 2026-11-17~2026-11-20이다. 표식 구간의 글이 그 보존 기록으로 계산한 `renderCost(actionsCost(fromSaved(…), 기간, known), 기간)`와 같다(양쪽에서 빈 줄만 빼고 줄 단위로 견준다). 표식 구간 밖에 `잰 날짜: <실재하는 날짜>` 줄(2026-11-21 이후), 잰 명령(`--save lab/actions-cost/2026-11-17_2026-11-20.jsonl`까지), 다시 계산하는 명령(`--from lab/actions-cost/2026-11-17_2026-11-20.jsonl`)이 있다.
  5. **판단 절차**: 여덟 머리가 각각 한 번, 목록 줄의 처음에 있다. 머리 뒤의 내용(다음 머리 전까지)이 공백을 빼고 20자 이상이다. 내용에 있어야 하는 낱말: "기준이 되는 입력"에 `보존 기록`·`--from`, "다시 재는 때"에 `--save`, "판단 시점 2"에 `예산`, "효과가 없을 때"에 `되돌린다`, "파일럿 실측"에 `check`, "예산을 넘는 결정"에 `제작자`.
  6. **기록**: 절에 표가 하나이고 머리 줄의 아홉 칸이 정한 이름·순서다. 데이터 행이 하나 이상이다. 첫 행의 `수단`은 `기준선`, `보존 기록`은 `BASELINE_FILE`이다. 모든 행에서: 아홉 칸이 비어 있지 않다. `보존 기록`은 `<YYYY-MM-DD>_<YYYY-MM-DD>.jsonl` 꼴의 이름이고(백틱은 떼고 읽는다) 그 파일이 있고 `parseSaved`를 통과한다. `기간`·`청구 분`·`PR 하나당 청구 분`·`PR 하나당 금액`·`PR head 하나당 청구 분`·`30일 환산 금액` 여섯 칸이 그 보존 기록으로 계산한 `recordCells`와 글자 그대로 같다. `판단`은 `예산 안`·`예산 밖`·`판단 못 함` 가운데 하나로 시작하고 그 뒤에 글이 더 있다. 어느 것인지는 아래 순서로 정한다. 칸에 적힌 반올림한 글이 아니라 보존 기록으로 계산한 값으로, 금액은 밀리달러 정수로 견준다. ① PR 수가 0이면 `판단 못 함`. ② 단가를 아는 러너의 금액만으로 PR 하나당 금액(전체 금액 ÷ PR 수)이 `BUDGET.usdPerPr`을 넘으면 `예산 밖`(단가를 모르는 러너의 분은 금액을 늘릴 뿐이다). ③ 그렇지 않고 단가를 모르는 러너의 청구 분(`unknownMinutes`)이 0보다 크면 `판단 못 함`(금액에 빠진 것이 있어 예산 안이라고 할 수 없다). ④ 그 밖은 `예산 안`. self-hosted 러너의 분은 Actions 청구가 아니라 판단을 바꾸지 않는다.
- 이 검사가 보지 않는 것: 글의 옳고 그름(설명이 맞는가, 절차가 쓸 만한가). 그것은 PR 검증이 본다. README에 그렇게 적는다.
- 테스트(`check-doc.test.ts`): 작은 가짜 보존 기록(step0의 `formatSaved`로 만든다)과 그것으로 만든 바른 문서가 통과한다. 그 문서를 하나씩 망가뜨린 것이 각각 실패하고 어긋난 점에 해당 절이나 줄이 적힌다: 빈 글, 제목만 남긴 글, 절 하나 삭제, 절 순서 바뀜, "왜 재는가" 본문이 비었음, 예산 줄 하나 삭제(네 줄 각각), 예산 값 바뀜(`30분` → `300분`, `$18` → `$180`), 상태가 `잠정`, 표식 구간이 비었음, 표식 구간의 수 하나가 바뀜, 표식 구간이 둘, `잰 날짜` 없음·없는 날짜, 잰 명령 없음, 판단 절차의 머리 하나 삭제(여덟 각각), 머리만 있고 내용이 비었음, 내용에 있어야 하는 낱말이 없음, 기록 표가 머리 줄뿐, 기록 행이 기간 칸만 있음, 기록 행의 칸 하나가 비었음, 기록 행의 수가 보존 기록과 다름, 판단이 값과 어긋남(`예산 밖`이어야 하는데 `예산 안`), 단가를 모르는 러너의 분이 있는 보존 기록(확인된 금액은 PR 하나당 $0.12, 모르는 러너의 청구 20분)에서 판단이 `예산 안`이면 실패하고 `판단 못 함`이면 통과함, 단가를 모르는 러너의 분이 있어도 확인된 금액만으로 예산을 넘는 보존 기록에서는 `예산 밖`이어야 하고 `판단 못 함`이면 실패함, PR 하나당 금액이 꼭 $0.18인 보존 기록은 `예산 안`이고 1밀리달러만 넘어도 `예산 밖`임(표시는 둘 다 `$0.180`일 수 있다), 보존 기록이 없음, 보존 기록의 줄 하나가 빠짐, 보존 기록의 기간이 다름. 명령행은 임시 폴더의 문서·보존 기록으로 종료 코드 0과 1을 확인한다.
- `lab/actions-cost/README.md`: 이 폴더가 무엇인지, 파일 표(보존 기록, `check-doc.ts`, `test/`), 보존 기록을 남기고 문서를 고치는 절차, 보존 기록을 손으로 고치지 않고 덮어쓰지 않는다는 것, 검사가 보지 않는 것.

### 4. 가리키는 줄

- `docs/index.md`: `docs/harness/actions-cost.md`와 `lab/actions-cost/README.md`로 가는 줄을 더한다.
- `docs/harness/CHANGELOG.md`: "다음 버전" 아래에 한 줄(`actions-cost.md`를 더했다). 이 step은 보호 경로(`docs/harness/**`)를 바꾸므로 `harness-guard`가 이 줄을 요구한다.

## Acceptance Criteria

```bash
node --test lab/actions-cost/test/check-doc.test.ts
test -s lab/actions-cost/2026-11-17_2026-11-20.jsonl
node lab/actions-cost/check-doc.ts
T=$(mktemp -d) && node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/out.md" && test -s "$T/out.md" && grep -v "^$" "$T/out.md" > "$T/a" && awk '/<!-- actions-cost:begin -->/{s=1;next} /<!-- actions-cost:end -->/{s=0} s' docs/harness/actions-cost.md | grep -v "^$" > "$T/b" && test -s "$T/b" && diff "$T/a" "$T/b"
T=$(mktemp -d) && : > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && grep "^#" docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && grep -v "^- PR 하나당 예산:" docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && sed 's/^- PR 하나당 예산: 30분/- PR 하나당 예산: 300분/' docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && grep -v "^- 효과가 없을 때:" docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && sed 's/^\(- 판단 시점 2[^:]*:\).*/\1/' docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && sed 's/^| 2026-11-17~2026-11-20 |.*/| 2026-11-17~2026-11-20 |/' docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && awk '/<!-- actions-cost:begin -->/{print;s=1;next} /<!-- actions-cost:end -->/{s=0} !s' docs/harness/actions-cost.md > "$T/d.md" && ! node lab/actions-cost/check-doc.ts --doc "$T/d.md"
T=$(mktemp -d) && ! node lab/actions-cost/check-doc.ts --dir "$T"
T=$(mktemp -d) && sed '$d' lab/actions-cost/2026-11-17_2026-11-20.jsonl > "$T/2026-11-17_2026-11-20.jsonl" && ! node lab/actions-cost/check-doc.ts --dir "$T"
grep -q "harness/actions-cost.md" docs/index.md
grep -q "lab/actions-cost/README.md" docs/index.md
grep -q "actions-cost.md" docs/harness/CHANGELOG.md
node scripts/harness.ts check
```

- 어느 줄도 GitHub을 읽지 않는다. 기준선의 확인은 보존 기록으로 한다. 그래서 잰 뒤에 그 기간의 실행이 다시 실행되어도 결과가 같다.
- 넷째 줄은 검사 스크립트를 거치지 않고 문서의 표식 구간이 `--from`의 출력과 같은지 직접 본다. 빈 줄은 비교에서 뺀다(prettier가 표식 줄 앞뒤에 빈 줄을 둔다).
- `!`로 시작하는 검사가 든 줄(다섯째~열넷째)은 지금 문서를 그 자리에서 망가뜨려 검사 스크립트가 실패하는지 본다: 빈 글, 제목만, 예산 줄 삭제, 예산 값 바뀜, 판단 절차의 항목 삭제, 항목의 내용 비움, 기록 행이 기간 칸만 남음, 표식 구간 비움, 보존 기록 없음, 보존 기록의 마지막 줄 빠짐. 망가뜨린 것이 통과하면 이 줄이 실패한다. 망가뜨리는 명령이 문서를 바꾸지 못해도(찾는 줄이 문서에 없다) 바른 문서가 통과하므로 이 줄이 실패한다.

## 금지사항

- 예산 값을 계획의 의사결정 로그에 적힌 제작자의 결정과 다르게 적지 마라. 이유: 비용은 제작자의 결정이다(절차서 7절).
- 명령이 내지 않은 수치를 기준선과 기록 표에 넣지 마라. 이유: 다음에 다시 잴 때 같은 방법으로 비교할 수 없다.
- 보존 기록을 손으로 고치거나 다시 재서 바꾸지 마라. 이유: 그 파일이 기준이다. step0의 결함으로 다시 만들어야 하면 진행 로그에 이유를 적고 제작자에게 알린 뒤 새로 잰다.
- 검사 스크립트가 GitHub을 읽게 하지 마라. 이유: 지난 기간의 실행 기록도 다시 실행하면 바뀐다. 읽으면 바르게 적은 기준선이 뒤에 실패한다.
- 설계서 5절·10.2~10.4절·13.2절과 절차서의 규칙을 고치지 마라. 이유: 이 step은 재는 절차만 적는다. 구조를 바꾸는 결정은 step2의 ADR과 그 뒤의 별도 Issue에서 한다.
- `.github/workflows/`를 고치지 마라. 이유: 제작자가 적용한다.
- step0의 코드를 고치지 마라. 이유: 재는 방법이 바뀌면 기준선이 흔들린다. 결함을 찾으면 진행 로그에 적고 제작자에게 알린다.
