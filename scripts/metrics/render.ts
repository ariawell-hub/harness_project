// 지표(17.2절)를 docs/QUALITY_SCORE.md의 표식 구간에 넣을 글로 만든다.
// 수와 PR·Issue 번호만 쓴다. 제목·본문 같은 외부 입력 문자열은 넣지 않는다(14.6절): 문서가 다음 세션의 입력이 된다.
// 표와 집계 시각을 쓰지 않는다: prettier가 다시 정렬하지 않고, 같은 자료면 같은 글이 나온다.
import type { PilotMetrics } from './pilot.ts';
import type { Period } from './source.ts';

export const BEGIN = '<!-- metrics:begin -->';
export const END = '<!-- metrics:end -->';

const DASH = '—';
const NO_PRS = '병합 PR 없음';

const refs = (ns: number[]) => (ns.length ? `(${ns.map((n) => `#${n}`).join(', ')})` : '');
const count = (ns: number[]) => `${ns.length}건${refs(ns)}`;
const min = (v: number) => `${Math.round(v)}분`;
const one = (v: number) => v.toFixed(1);

/** `합(PR당 값)` 또는 PR이 없을 때 `합(PR당 —, 병합 PR 없음)` */
function withPerPr(total: string, per: number | null, unit: string): string {
  return per === null ? `${total}(PR당 ${DASH}, ${NO_PRS})` : `${total}(PR당 ${one(per)}${unit})`;
}

export function renderBlock(p: Period, pilot: PilotMetrics): string {
  const { defects, missed, falsePositives: fp, wait, usage } = pilot;
  const rerun = defects.passedAfterRerun
    ? `(재실행 뒤 통과한 실행 ${defects.passedAfterRerun}건은 넣지 않았다)`
    : '';
  const lines = [
    `집계 기간: ${p.since} ~ ${p.until}(UTC) · 병합 PR ${pilot.mergedPrs}개`,
    '',
    '### 파일럿 판정 지표',
    '',
    '- 병합 후 결함(세 값은 같은 결함을 가리킬 수 있어 더하지 않는다)',
    `  - main \`check\` 실패: ${defects.mainCheckFailures}건${rerun}`,
    `  - revert PR: ${count(defects.revertPrs)}`,
    `  - 버그 Issue: ${count(defects.bugIssues)}`,
    `- 검증 누락: ${count(missed.prs)}`,
    `  - 실패로 바뀌었지만 원인 PR을 찾지 못한 실행: ${missed.unattributed}건`,
    `  - 전환 여부 미확인(기간 첫 실행이 실패이고 직전 결과를 모른다): ${missed.unknownTransition}건`,
  ];
  if (defects.bugIssues.length)
    lines.push(
      `  - 버그 Issue ${defects.bugIssues.length}건은 원인 PR이 이어지지 않아 넣지 않았다. 사람이 가른다`,
    );
  lines.push(
    fp.rate === null
      ? `- 오탐: ${DASH}(차단 지적 없음)`
      : `- 오탐: ${fp.either}건 ÷ 차단 지적 ${fp.blocking}건 = ${one(fp.rate * 100)}%`,
    `  - 재현 안 된 차단 지적: ${fp.notReproduced}건`,
    `  - 받아들여진 반박(rejected): ${fp.rejected}건`,
    wait.medianMin === null || wait.maxMin === null
      ? `- PR당 대기 시간: ${DASH}(${NO_PRS})`
      : `- PR당 대기 시간: 중앙값 ${min(wait.medianMin)} · 최대 ${min(wait.maxMin)}`,
    '- PR당 사용량',
    `  - Actions 실행 시간: ${withPerPr(min(usage.actionsMin), usage.actionsMinPerPr, '분')}`,
    `  - 그중 판정 워크플로: ${withPerPr(min(usage.judgeMin), usage.judgeMinPerPr, '분')}`,
    `  - 판정 수: ${withPerPr(`${usage.rounds}회`, usage.roundsPerPr, '회')}`,
    `  - 실패로 끝난 판정 워크플로 실행: ${usage.failedJudgeRuns}건`,
    `- 세지 못한 항목(시각이 깨진 PR·실행): ${pilot.skipped}건`,
  );
  return lines.join('\n');
}
