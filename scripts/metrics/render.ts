// 지표(17.2절)를 docs/QUALITY_SCORE.md의 표식 구간에 넣을 글로 만든다.
// 수와 PR·Issue 번호만 쓴다. 제목·본문 같은 외부 입력 문자열은 넣지 않는다(14.6절): 문서가 다음 세션의 입력이 된다.
// 표와 집계 시각을 쓰지 않는다: prettier가 다시 정렬하지 않고, 같은 자료면 같은 글이 나온다.
import { STOP_REASONS, type LocalMetrics, type StopName } from './local.ts';
import type { PilotMetrics } from './pilot.ts';
import type { EscalationKind, Period } from './source.ts';
import { ESCALATION_KINDS, type SteadyMetrics } from './steady.ts';

export const BEGIN = '<!-- metrics:begin -->';
export const END = '<!-- metrics:end -->';

const DASH = '—';
const NO_PRS = '병합 PR 없음';

const refs = (ns: number[]) => (ns.length ? `(${ns.map((n) => `#${n}`).join(', ')})` : '');
const count = (ns: number[]) => `${ns.length}건${refs(ns)}`;
const min = (v: number) => `${Math.round(v)}분`;
const one = (v: number) => v.toFixed(1);
/** 정수면 그대로, 아니면 소수 한 자리(짝수 개의 중앙값) */
const num = (v: number) => (Number.isInteger(v) ? String(v) : one(v));

const KIND_LABEL: Record<EscalationKind, string> = {
  'stop-failures': '5회 실패 중단',
  'stop-limit': '총량 상한 중단',
  'stop-deadlock': '교착',
  'stop-conflict': '갱신 충돌',
  'stop-other': '그 밖의 중단',
  question: '질문',
  approval: '승인 요청',
  'ci-stall': 'CI 대기',
  revert: '자동 revert 불가',
};

/** `합(PR당 값)` 또는 PR이 없을 때 `합(PR당 —, 병합 PR 없음)` */
function withPerPr(total: string, per: number | null, unit: string): string {
  return per === null ? `${total}(PR당 ${DASH}, ${NO_PRS})` : `${total}(PR당 ${one(per)}${unit})`;
}

function steadyLines(s: SteadyMetrics): string[] {
  const { leadTime: lead, firstPass: fp, rounds, escalation, stops, risk, size } = s;
  return [
    '### 상시 지표',
    '',
    lead.medianMin === null || lead.maxMin === null
      ? `- PR 리드타임(계획 생성 → 병합): ${DASH}(계획을 찾은 PR 없음)`
      : `- PR 리드타임(계획 생성 → 병합): 중앙값 ${min(lead.medianMin)} · 최대 ${min(lead.maxMin)}`,
    `  - 계획을 찾지 못한 PR: ${lead.noPlan}건`,
    fp.rate === null
      ? `- CI 첫 통과율: ${DASH}(실행을 찾은 PR 없음)`
      : `- CI 첫 통과율: ${fp.passed}건 ÷ 실행을 찾은 PR ${fp.withRuns}건 = ${one(fp.rate * 100)}%`,
    `  - 실행을 이을 수 없는 PR: ${fp.unlinkable}건`,
    `  - 이을 수 있지만 실행을 찾지 못한 PR: ${fp.noRuns}건`,
    rounds.median === null || rounds.max === null
      ? `- PR당 리뷰 라운드 수: ${DASH}(${NO_PRS})`
      : `- PR당 리뷰 라운드 수: 중앙값 ${num(rounds.median)}회 · 최대 ${rounds.max}회`,
    `  - 3라운드를 넘은 PR: ${count(rounds.over3)}`,
    '- 에스컬레이션(라벨과 댓글은 따로 기록돼 같은 사건을 가리킬 수 있다. 더하지 않는다)',
    `  - \`needs-human\` 라벨이 붙은 횟수: ${escalation.labels}건`,
    `  - 사유별 알림 댓글: ${ESCALATION_KINDS.map((k) => `${KIND_LABEL[k]} ${escalation.comments[k]}건`).join(' · ')}`,
    `- 5회 중단: ${stops.failures}건 · 총량 상한 도달: ${stops.limit}건`,
    `- 위험도별 PR 수: 낮음 ${risk.low}개 · 보통 ${risk.normal}개 · 높음 ${risk.high}개 · 알 수 없음 ${risk.unknown}개`,
    size.median === null
      ? `- PR 크기(추가 + 삭제 줄 수): ${DASH}(${NO_PRS})`
      : `- PR 크기(추가 + 삭제 줄 수): 중앙값 ${num(size.median)}줄 · 400줄을 넘는 PR ${size.over400}건`,
  ];
}

/**
 * 잴 수 없는 지표가 가리키는 기술 부채(docs/exec-plans/tech-debt-tracker.md).
 * 번호를 바꾸면 그 표의 행도 함께 바꾼다(scripts/test/metrics-local.test.ts가 견준다)
 */
export const UNMEASURED_TD = {
  /** R15 `pr-size`·R18 `scope` 게이트가 없다 */
  gates: 6,
  /** L1 훅이 차단을 기록하지 않는다 */
  hookBlocks: 55,
  /** 구독 한도와 그 밖의 검증자 장애를 가르는 기록이 없다 */
  quotaHold: 56,
  /** 실패 기록이 worktree와 함께 지워진다 */
  failureKeys: 57,
  /** runner가 `judge-fail`에 AC 결과를 따로 남기지 않는다 */
  acResult: 58,
} as const;

const NO_LOG = '이 머신에 runner 로그 없음';

const STOP_LABEL: Record<StopName, string> = {
  idle: '할 일 없음',
  human: '사람 대기',
  'time-limit': '시간 상한',
  'usage-limit': '사용량 한도',
  'max-iterations': '반복 상한',
  once: '한 번 실행',
  locked: '다른 runner 실행 중',
  'agent-missing': '에이전트 없음',
  error: '오류',
  other: '그 밖',
};

/** 리포 파일과 로컬 로그로 재는 상시 지표와, 잴 수 없는 지표의 이유(step2). 상시 지표 절의 뒤에 붙는다 */
function localLines(l: LocalMetrics): string[] {
  const td = UNMEASURED_TD;
  const { switches, findings: f, runner: r, selfTest: st } = l;
  const byPlan = switches.byPlan.map((x) => `${x.id} ${x.count}건`).join(', ');
  const acWhy = `runner가 \`judge-fail\`에 AC 결과를 따로 남기지 않아 정확한 수를 낼 수 없다, TD-${td.acResult}`;
  const lines = [
    `- 발산 감지 횟수: ${r ? `${r.diverged}건` : `${DASH}(${NO_LOG})`}`,
    `- 3회 방법 전환: ${switches.total}건${byPlan ? `(${byPlan})` : ''}`,
    `  - 실패 키별 3회·5회 횟수: ${DASH}(실패 기록 \`attempts.jsonl\`이 worktree와 함께 지워져 키별로 셀 수 없다, TD-${td.failureKeys}). 횟수는 계획의 방법 전환 줄과 중단 보고 댓글로 센다`,
    '- PR당 검증 사용량: 파일럿 판정 지표의 "PR당 사용량"(판정 워크플로 시간, 판정 수)으로 본다',
    `- 구독 한도 때문에 검증이 보류된 횟수(Q12): ${DASH}(한도와 그 밖의 검증자 장애를 가르는 기록이 없다, TD-${td.quotaHold}). 파일럿 판정 지표의 "실패로 끝난 판정 워크플로 실행"으로 대신 본다`,
    `- PR 크기 경고·범위 이탈 경고 수(R15, R18): ${DASH}(게이트가 없다, TD-${td.gates}). PR 크기는 위 "400줄을 넘는 PR"로 대신 본다`,
    `- 위험 작업·제작자 권한 명령 차단 횟수(R13, R14, R20): ${DASH}(L1 훅이 차단을 기록하지 않는다, TD-${td.hookBlocks})`,
    `- "검토 필요" 문서 수: ${l.reviewNeeded}개(기간과 무관한 현재 값)`,
    st === null
      ? `- 하네스 자체 테스트 통과율: ${DASH}(보고서 없음. \`self-test --out\`으로 만든다)`
      : `- 하네스 자체 테스트 통과율: ${st.passed}건 ÷ ${st.total}건 = ${one((st.passed / st.total) * 100)}%`,
  ];
  if (!r) {
    lines.push(
      `- runner 연속 실행 시간과 멈춘 이유: ${DASH}(${NO_LOG})`,
      `- step당 세션 수·재시도 수: ${DASH}(${NO_LOG})`,
      `- "세션은 완료라 했지만 AC 실패": ${DASH}(${NO_LOG}). 로그가 있어도 범위로만 낸다(${acWhy})`,
    );
  } else {
    const time =
      r.medianMin === null || r.maxMin === null
        ? ''
        : ` · 중앙값 ${min(r.medianMin)} · 최대 ${min(r.maxMin)}`;
    const stopped = [...STOP_REASONS, 'other' as const]
      .filter((k) => r.reasons[k] > 0)
      .map((k) => `${STOP_LABEL[k]} ${r.reasons[k]}회`);
    const { sessions: se, judgeFail: j } = r;
    lines.push(
      '- runner 연속 실행 시간과 멈춘 이유(이 명령을 실행한 머신의 로그만 본다)',
      `  - 실행: ${r.runs}회${time}${r.noExit ? ` · 종료 기록 없음 ${r.noExit}회` : ''}`,
      `  - 멈춘 이유: ${stopped.length ? stopped.join(' · ') : '없음'}`,
      `  - 읽지 못한 로그 줄: ${r.broken}줄`,
      se.median === null || se.max === null
        ? `- step당 세션 수·재시도 수: ${DASH}(기간 안의 세션 없음)`
        : `- step당 세션 수·재시도 수: 중앙값 ${num(se.median)}회 · 최대 ${se.max}회 · 재시도 ${se.retries}건`,
      `- "세션은 완료라 했지만 AC 실패": ${j.acFailed}건 이상 ${j.acFailed + j.acUnknown}건 이하(${acWhy})`,
      `  - AC 실패 확인 ${j.acFailed}건 · AC 결과 미확인 ${j.acUnknown}건 · 그 밖 ${j.other}건`,
    );
  }
  lines.push(
    `- 발견 사항의 처리 분포: 문서 반영 ${f.doc}건 · Issue·TD ${f.issueTd}건 · 해당 없음 ${f.none}건 · 처리 표기 없음 ${f.unmarked}건`,
  );
  return lines;
}

/**
 * `steady`를 주지 않으면 파일럿 판정 지표만 낸다.
 * `local`은 상시 지표 절의 뒤에 붙는다(`steady`가 있을 때만)
 */
export function renderBlock(
  p: Period,
  pilot: PilotMetrics,
  steady?: SteadyMetrics,
  local?: LocalMetrics,
): string {
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
  if (steady) lines.push('', ...steadyLines(steady));
  if (steady && local) lines.push(...localLines(local));
  return lines.join('\n');
}
