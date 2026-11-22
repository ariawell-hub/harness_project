// 지적 원장(10.2절 (4)·(5)): PR마다 리뷰 지적의 등급과 처리 상태를 추적한다.
// 이 파일은 순수 함수만 둔다(네트워크·git 호출 없음). 기록 job이 PR 댓글로 읽고 쓴다(step1).
// 댓글에는 사람이 읽는 표와 기계가 읽는 숨은 자료가 함께 있고, 기계는 숨은 자료만 읽는다. 형식: scripts/cross-review/ledger.md
import { PLANS_DIR } from '../lib/plan.ts';
import { PLAN_HASH_RE, SHA_RE } from './results.ts';
import {
  LIMITS,
  RESOLUTION_ID_RE,
  SEVERITIES,
  type Finding,
  type Severity,
  type Verdict,
} from './verdict.ts';

export const REVIEWERS = ['claude', 'codex'] as const;
export type Reviewer = (typeof REVIEWERS)[number];
/**
 * accepted: 제작자가 남은 위험을 받아들인 P0·P1(owner-accept.ts만 만든다). 검증자의 판정으로 바뀌지 않는다.
 * parked: 구현 대기. 계획만 담은 head에서 판정할 수 없는 코드 지적(parkFor만 만들고 되돌린다, Issue #212)
 */
export const ENTRY_STATUSES = [
  'open',
  'fixed',
  'rejected',
  'deferred',
  'accepted',
  'parked',
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export const REPRO_RESULTS = ['', 'reproduced', 'not-reproduced', 'error'] as const;
export type ReproResult = (typeof REPRO_RESULTS)[number];

/** 이 수를 넘으면 P2·P3은 더 등록하지 않는다. P0·P1은 계속 받는다 */
export const MAX_ENTRIES = 150;
/** 댓글 본문이 이 길이를 넘게 되면 P2·P3은 더 등록하지 않는다(GitHub 댓글 상한 65536자) */
export const MAX_BODY = 60_000;
const MAX_CI_FAILURES = 30;
/** 읽을 때의 상한. 넘으면 원장으로 읽지 않는다(fail-closed). 쓸 때는 자르지 않는다 */
const MAX_ROUNDS = 2000;

export interface Entry {
  /** F<번호>. 원장 전체에서 차례로 붙인다 */
  id: string;
  severity: Severity;
  reviewer: Reviewer;
  file: string;
  line: number;
  title: string;
  repro: ReproResult;
  status: EntryStatus;
  /** 처리: 검증자가 판정에 붙인 한 줄, 또는 기계가 적은 이유(동결 등) */
  note: string;
  /** 그 검증자의 몇 번째 판정에서 등록됐는가 */
  round: number;
  /** P0을 rejected로 보자고 한 검증자. 둘 다 있어야 rejected다(B11) */
  rejectedBy: Reviewer[];
  /**
   * 이 지적이 open(또는 parked)인 채로 원장 댓글에 게시된 것이 확인된 시각(GitHub이 준 ISO 8601 시각). 제작자 승인 댓글이
   * 이보다 뒤여야 인정된다. 이 파일의 함수는 채우지 않는다(원장을 읽는 쪽이 채운다). 다시 열리면 지운다
   */
  openedAt?: string;
  /**
   * 계획 전용 판정(mode=plan)에서 등록된 지적이다. 없으면 코드가 섞인 판정에서 등록된 것이다(이 필드가 생기기 전의
   * 원장도 그렇게 읽는다). 계획 검증이 판정해야 할 지적이라 구현 대기로 두지 않는다. 등록 상태는 바꾸지 않는다
   */
  planRound?: true;
}

export interface Round {
  reviewer: Reviewer;
  head: string;
}

export interface CiFailure {
  head: string;
  /** 실패한 실행의 URL */
  run: string;
}

/** 계획 검증(G1, 4.1·10.3절)의 승인 기록. 계획만 바꾼 PR head(mode=plan)의 판정으로만 남긴다 */
export interface PlanReview {
  /** 승인받은 계획 핵심 섹션 해시(plan-hash.ts) */
  hash: string;
  /** 이 해시의 승인이 마지막으로 기록된 PR head */
  head: string;
  /** 이 해시의 계획을 승인한 검증자. 위험도 기준으로 실행하지 않은 검증자(해당 없음 = 통과)도 들어간다 */
  approvals: Reviewer[];
}

export interface Ledger {
  version: 1;
  /** 1라운드의 base SHA. 이 PR의 모든 라운드가 이 버전의 프롬프트를 쓴다(10.2절 (2)) */
  promptBase: string;
  rounds: Round[];
  findings: Entry[];
  ciFailures: CiFailure[];
  /** 원장이 가득 찼거나 댓글 상한에 걸려 등록하지 않은 P2·P3 수 */
  dropped: number;
  /** 계획 승인. 계획 검증을 받은 적이 없으면 없다(이 필드가 생기기 전의 원장도 그렇다) */
  planReview?: PlanReview;
}

export function emptyLedger(promptBase: string): Ledger {
  return { version: 1, promptBase, rounds: [], findings: [], ciFailures: [], dropped: 0 };
}

const BLOCKING: readonly Severity[] = ['P0', 'P1'];

/** 그 검증자가 이 원장에 낸 판정 수 */
export function roundsOf(l: Ledger, reviewer: Reviewer): number {
  return l.rounds.filter((r) => r.reviewer === reviewer).length;
}

/** 그 검증자가 마지막으로 판정한 head. 없으면 null */
export function lastHeadOf(l: Ledger, reviewer: Reviewer): string | null {
  return l.rounds.findLast((r) => r.reviewer === reviewer)?.head ?? null;
}

const oneLine = (s: string, max: number) =>
  s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max);

export interface ApplyOptions {
  reviewer: Reviewer;
  /** 형식 검사와 시크릿 스캔을 통과한 판정 */
  verdict: Verdict;
  headSha: string;
  /** 이 검증자의 직전 판정 head 이후 바뀐 파일. 모르면 null(2라운드부터는 모두 동결한다) */
  changedSinceLastRound: readonly string[] | null;
  /** 재현 job 결과: 이 판정의 findings 순번 → 결과. PR 코드가 조작할 수 있는 값이다(10.4절) */
  repro?: ReadonlyMap<number, ReproResult>;
  /** 계획 전용 판정(mode=plan)인가. 참이면 이 판정에서 새로 등록하는 지적에 planRound를 적는다 */
  planOnly?: boolean;
}

export const PARK_NOTE = '구현 대기: 계획만 담은 head에서는 판정하지 않는다';
export const UNPARK_NOTE = '구현이 올라와 다시 열림';

/**
 * 구현 대기(Issue #212)를 그 head에 맞춘 새 원장을 돌려준다(입력은 바꾸지 않는다. 바뀐 것이 없으면 받은 원장 그대로다).
 * - 계획만 담은 head(planOnly): 그 head에 없는 코드에 대한 열린 지적을 parked로 둔다. 대상은 open이고, 계획 전용
 *   판정에서 등록된 것이 아니고(planRound), 위치가 계획 폴더 밖인 지적이다. 계획 폴더 안 파일에 대한 지적과 계획
 *   전용 판정에서 등록된 지적은 계획 검증이 판정해야 하므로 두지 않는다
 * - 코드가 섞인 head: parked를 모두 open으로 되돌린다. 건너뛰는 갈래가 없다(계획만 남겼다가 다시 올리는 것으로
 *   열린 지적을 지울 수 없다, R4). mode를 모르면 부르는 쪽이 이쪽으로 부른다(fail-closed)
 * 게시 시각(openedAt)은 어느 쪽에서도 그대로 둔다: 되돌아온 지적에 그 사이 달린 제작자 승인이 반영될 수 있다
 */
export function parkFor(l: Ledger, planOnly: boolean): Ledger {
  const inPlans = (file: string) => file.startsWith(`${PLANS_DIR}/`);
  let changed = false;
  const findings = l.findings.map((e): Entry => {
    if (planOnly ? e.status !== 'open' || e.planRound || inPlans(e.file) : e.status !== 'parked')
      return e;
    changed = true;
    return {
      ...e,
      rejectedBy: [...e.rejectedBy],
      status: planOnly ? 'parked' : 'open',
      note: planOnly ? PARK_NOTE : UNPARK_NOTE,
    };
  });
  return changed ? { ...l, findings } : l;
}

/**
 * 판정 하나를 원장에 반영한 새 원장을 돌려준다(입력은 바꾸지 않는다).
 * - 새 지적: P0·P1은 open, P2·P3은 deferred. 그 검증자의 2라운드부터는 바뀌지 않은 파일의 P1을 deferred로 등록한다(동결)
 * - resolutions: 자기 지적의 fixed·rejected·open만 반영한다. 남의 P0에 대한 rejected는 동의로 기록한다
 * - accepted(제작자 승인)와 parked(구현 대기)인 지적은 deferred처럼 판정으로 바뀌지 않는다
 * - 계획 전용 판정(planOnly)에서 새로 등록하는 지적에는 planRound를 적는다. 등록 상태를 정하는 규칙은 같다
 * - 닫힌 지적이 다시 열리면 openedAt을 지운다(게시 시각을 다시 확인해야 승인을 받을 수 있다)
 */
export function applyVerdict(l: Ledger, o: ApplyOptions): Ledger {
  const out: Ledger = {
    ...l,
    rounds: [...l.rounds, { reviewer: o.reviewer, head: o.headSha }],
    findings: l.findings.map((e) => ({ ...e, rejectedBy: [...e.rejectedBy] })),
    ciFailures: [...l.ciFailures],
  };
  const round = roundsOf(l, o.reviewer) + 1;
  const changed = new Set(o.changedSinceLastRound ?? []);

  for (const r of o.verdict.resolutions) {
    const e = out.findings.find((x) => x.id === r.id);
    if (!e || e.status === 'deferred' || e.status === 'accepted' || e.status === 'parked') continue;
    const own = e.reviewer === o.reviewer;
    const note = oneLine(r.note, LIMITS.note);
    if (e.severity === 'P0' && r.status === 'rejected') {
      if (!e.rejectedBy.includes(o.reviewer)) e.rejectedBy.push(o.reviewer);
      if (REVIEWERS.every((x) => e.rejectedBy.includes(x))) e.status = 'rejected';
      if (own && note) e.note = note;
      continue;
    }
    if (!own) continue;
    e.rejectedBy = e.rejectedBy.filter((x) => x !== o.reviewer);
    if (e.status !== 'open' && r.status === 'open') delete e.openedAt;
    e.status = r.status;
    if (note) e.note = note;
  }

  let next = out.findings.reduce((n, e) => Math.max(n, Number(e.id.slice(1))), 0) + 1;
  const same = (e: Entry, f: Finding) =>
    e.reviewer === o.reviewer &&
    e.file === oneLine(f.file, LIMITS.file) &&
    e.line === f.line &&
    e.title === oneLine(f.title, LIMITS.title);
  for (const [index, f] of o.verdict.findings.entries()) {
    const repro = o.repro?.get(index) ?? '';
    const dup = out.findings.find((e) => same(e, f));
    if (dup) {
      if (repro) dup.repro = repro;
      // 닫힌 지적을 낸 검증자가 같은 지적을 다시 냈다: 회귀로 보고 다시 연다. deferred·accepted·parked는 그대로 둔다
      if (dup.status === 'fixed' || dup.status === 'rejected') {
        dup.status = 'open';
        delete dup.openedAt;
        dup.rejectedBy = dup.rejectedBy.filter((x) => x !== o.reviewer);
        dup.note = `다시 지적됨(${round}라운드)`;
      }
      continue;
    }
    // 근거(실패 시나리오와 위치)가 없는 P1은 P2로 내린다. P0은 내리지 않는다(10.2절 (3))
    const unfounded = f.severity === 'P1' && (f.evidence.trim() === '' || f.file.trim() === '');
    const severity: Severity = unfounded ? 'P2' : f.severity;
    const blocking = BLOCKING.includes(severity);
    if (!blocking && out.findings.length >= MAX_ENTRIES) {
      out.dropped++;
      continue;
    }
    // 동결: 재현 job이 재현한 P1은 예외로 받는다(10.2절 (5)). "재현 안 됨"은 상태를 바꾸지 않는다
    const frozen =
      round >= 2 && severity === 'P1' && !changed.has(f.file) && repro !== 'reproduced';
    out.findings.push({
      id: `F${next++}`,
      severity,
      reviewer: o.reviewer,
      file: oneLine(f.file, LIMITS.file),
      line: f.line,
      title: oneLine(f.title, LIMITS.title),
      repro,
      status: blocking && !frozen ? 'open' : 'deferred',
      note: unfounded
        ? '근거 없음: P1에서 P2로 내림(10.2절 (3))'
        : frozen
          ? '동결: 직전 라운드 이후 바뀌지 않은 파일의 새 지적(10.2절 (5))'
          : '',
      round,
      rejectedBy: [],
      ...(o.planOnly ? { planRound: true as const } : {}),
    });
    // 댓글 상한을 넘기는 비차단 지적은 등록하지 않는다. 차단 지적은 넘겨도 등록한다(쓰기 실패는 기록 job이 error로 남긴다)
    if (!blocking && renderLedger(out).length > MAX_BODY) {
      out.findings.pop();
      next--;
      out.dropped++;
    }
  }
  return out;
}

export interface PlanReviewOptions {
  reviewer: Reviewer;
  /** 판정한 head의 계획 해시 */
  hash: string;
  headSha: string;
  /** true: 승인(review/* success), false: 수정 요청, null: 판정 없음(error) */
  approved: boolean | null;
}

/**
 * 계획 전용 head의 판정 하나를 계획 승인에 반영한 새 원장을 돌려준다(입력은 바꾸지 않는다).
 * 해시가 바뀌면 이전 승인을 모두 지운다. 수정 요청은 그 검증자의 승인만 지우고, 판정이 없으면 그대로 둔다
 */
export function applyPlanReview(l: Ledger, o: PlanReviewOptions): Ledger {
  const cur =
    l.planReview?.hash === o.hash ? l.planReview : { hash: o.hash, head: o.headSha, approvals: [] };
  if (o.approved === null) return { ...l, planReview: { ...cur, approvals: [...cur.approvals] } };
  const others = cur.approvals.filter((r) => r !== o.reviewer);
  const approvals = REVIEWERS.filter((r) => others.includes(r) || (o.approved && r === o.reviewer));
  return {
    ...l,
    planReview: { hash: o.hash, head: o.approved ? o.headSha : cur.head, approvals },
  };
}

/**
 * review-ledger 판정(R16): open인 P0·P1이 없어야 한다.
 * 동결돼 deferred로 등록된 P1은 막지 않는다(10.2절 (5): 후속 PR·tech-debt로 넘긴다). 수를 description에 적는다.
 * accepted(제작자 승인)인 P0·P1도 막지 않고 수를 적는다.
 * parked(구현 대기)도 막지 않고 수를 적는다: 계획만 담은 head에만 있고, 코드가 섞인 head의 기록은 판정 전에 open으로 되돌린다
 */
export function ledgerStatus(l: Ledger): { state: 'success' | 'failure'; description: string } {
  const open = l.findings.filter((e) => BLOCKING.includes(e.severity) && e.status === 'open');
  const parkedCount = l.findings.filter((e) => e.status === 'parked').length;
  const parked = parkedCount ? `, 구현 대기 ${parkedCount}` : '';
  if (open.length === 0) {
    const deferred = l.findings.filter((e) => e.status === 'deferred');
    const frozen = deferred.filter((e) => e.severity === 'P1').length;
    const accepted = l.findings.filter((e) => e.status === 'accepted').length;
    return {
      state: 'success',
      description: `차단 지적 없음 (전체 ${l.findings.length}, 미룸 ${deferred.length}${frozen ? `, 그중 동결 P1 ${frozen}` : ''}${accepted ? `, 제작자 승인 ${accepted}` : ''}${parked})`,
    };
  }
  let ids = open.map((e) => e.id).join(', ');
  if (ids.length > 100) ids = `${ids.slice(0, 100).replace(/,[^,]*$/, '')} 외`;
  // 제작자 승인 수는 실패할 때도 적는다(무엇이 승인으로 닫혀 있는지 상태만 보고 알 수 있게)
  const accepted = l.findings.filter((e) => e.status === 'accepted').length;
  return {
    state: 'failure',
    description: `열린 차단 지적 ${open.length}건: ${ids}${accepted ? `, 제작자 승인 ${accepted}` : ''}${parked}`,
  };
}

export const LEDGER_MARKER = '<!-- harness-ledger:v1 -->';
const DATA_RE = /<!-- harness-ledger-data:([A-Za-z0-9+/=]*) -->/g;

/**
 * 표 셀에 넣을 글: 한 줄로 만들고 마크다운·HTML·멘션으로 해석될 문자를 문자 참조로 바꾼다.
 * 검증자 출력(지적 제목·위치)을 GitHub 댓글에 넣는 곳은 모두 이 함수를 쓴다(원장 표, runner의 중단 보고)
 */
export function cell(s: string): string {
  return oneLine(s, 300).replace(/[&<>|[\]@`*_~\\!#:()]/g, (c) => `&#${c.codePointAt(0)};`);
}

const REPRO_LABEL: Record<ReproResult, string> = {
  '': '—',
  reproduced: '재현됨',
  'not-reproduced': '재현 안 됨',
  error: '실행 못 함',
};

/** 원장 댓글 본문: 사람이 읽는 표와 숨은 자료(base64 JSON). 기계는 숨은 자료만 읽는다 */
export function renderLedger(l: Ledger): string {
  const rounds = REVIEWERS.map((r) => `${r} ${roundsOf(l, r)}`).join(', ');
  const lines = [
    LEDGER_MARKER,
    '## 지적 원장',
    '',
    `기록 job이 관리한다. 직접 고쳐도 반영되지 않는다(설계서 10.2절). 프롬프트 버전: \`${l.promptBase.slice(0, 12)}\` · 라운드: ${rounds}`,
    '',
  ];
  if (l.findings.length === 0) lines.push('지적 없음.', '');
  else {
    lines.push(
      '| ID | 등급 | 검증자 | 위치 | 내용 | 재현 | 상태 | 처리 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const e of l.findings) {
      const where = e.line > 0 ? `${cell(e.file)}&#58;${e.line}` : cell(e.file);
      lines.push(
        `| ${[e.id, e.severity, e.reviewer, where || '—', cell(e.title) || '—', REPRO_LABEL[e.repro], e.status, cell(e.note) || '—'].join(' | ')} |`,
      );
    }
    lines.push('');
  }
  if (l.planReview) {
    const p = l.planReview;
    lines.push(
      `계획 검증(G1): 해시 \`${p.hash.slice(0, 12)}\` · 승인: ${p.approvals.join(', ') || '없음'} · head \`${p.head.slice(0, 12)}\``,
      '',
    );
  }
  if (l.dropped > 0) lines.push(`원장이 가득 차 등록하지 않은 P2·P3: ${l.dropped}건`, '');
  if (l.ciFailures.length) {
    lines.push('CI 실패 기록:', '');
    for (const f of l.ciFailures) lines.push(`- \`${f.head.slice(0, 12)}\` ${cell(f.run)}`);
    lines.push('');
  }
  lines.push(`<!-- harness-ledger-data:${ledgerData(l)} -->`);
  return lines.join('\n');
}

/** 숨은 자료만: base64 JSON. job 사이에 원장을 넘길 때 쓴다 */
export function ledgerData(l: Ledger): string {
  return Buffer.from(JSON.stringify(l), 'utf8').toString('base64');
}

/** ledgerData가 만든 값을 읽는다. 형식이 다르면 null */
export function parseLedgerData(data: string): Ledger | null {
  return /^[A-Za-z0-9+/=]+$/.test(data)
    ? parseLedger(`<!-- harness-ledger-data:${data} -->`)
    : null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keysAre = (o: object, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => k in o);
const isReviewer = (v: unknown): v is Reviewer => (REVIEWERS as readonly unknown[]).includes(v);
const validTime = (v: unknown) =>
  typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

function validEntry(raw: unknown): raw is Entry {
  if (!isObj(raw)) return false;
  // openedAt은 없어도 된다(이 필드가 생기기 전의 원장, 게시 시각을 아직 모르는 지적)
  // planRound도 없어도 된다(코드가 섞인 판정에서 등록된 지적, 이 필드가 생기기 전의 원장). 있으면 true뿐이다
  const { openedAt, planRound, ...e } = raw;
  if ('openedAt' in raw && !validTime(openedAt)) return false;
  if ('planRound' in raw && planRound !== true) return false;
  if (
    !keysAre(e, [
      'id',
      'severity',
      'reviewer',
      'file',
      'line',
      'title',
      'repro',
      'status',
      'note',
      'round',
      'rejectedBy',
    ])
  )
    return false;
  return (
    typeof e.id === 'string' &&
    RESOLUTION_ID_RE.test(e.id) &&
    (SEVERITIES as readonly unknown[]).includes(e.severity) &&
    isReviewer(e.reviewer) &&
    typeof e.file === 'string' &&
    e.file.length <= LIMITS.file &&
    Number.isInteger(e.line) &&
    (e.line as number) >= 0 &&
    typeof e.title === 'string' &&
    e.title.length <= LIMITS.title &&
    (REPRO_RESULTS as readonly unknown[]).includes(e.repro) &&
    (ENTRY_STATUSES as readonly unknown[]).includes(e.status) &&
    typeof e.note === 'string' &&
    e.note.length <= LIMITS.note &&
    Number.isInteger(e.round) &&
    (e.round as number) >= 1 &&
    Array.isArray(e.rejectedBy) &&
    e.rejectedBy.length <= REVIEWERS.length &&
    e.rejectedBy.every(isReviewer)
  );
}

function validPlanReview(p: unknown): p is PlanReview {
  return (
    isObj(p) &&
    keysAre(p, ['hash', 'head', 'approvals']) &&
    typeof p.hash === 'string' &&
    PLAN_HASH_RE.test(p.hash) &&
    typeof p.head === 'string' &&
    SHA_RE.test(p.head) &&
    Array.isArray(p.approvals) &&
    p.approvals.every(isReviewer) &&
    new Set(p.approvals).size === p.approvals.length
  );
}

/** 댓글 본문에서 원장을 읽는다. 숨은 자료가 없거나 둘 이상이거나 형식이 다르면 null */
export function parseLedger(body: string): Ledger | null {
  const found = [...body.matchAll(DATA_RE)];
  if (found.length !== 1) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(found[0][1], 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  // planReview는 없어도 된다(계획 검증을 받지 않은 PR, 이 필드가 생기기 전의 원장)
  const { planReview, ...rest } = raw;
  if (!keysAre(rest, ['version', 'promptBase', 'rounds', 'findings', 'ciFailures', 'dropped']))
    return null;
  if ('planReview' in raw && !validPlanReview(planReview)) return null;
  if (raw.version !== 1) return null;
  if (typeof raw.promptBase !== 'string' || !SHA_RE.test(raw.promptBase)) return null;
  if (!Number.isInteger(raw.dropped) || (raw.dropped as number) < 0) return null;
  if (!Array.isArray(raw.rounds) || raw.rounds.length > MAX_ROUNDS) return null;
  for (const r of raw.rounds as unknown[])
    if (
      !isObj(r) ||
      !keysAre(r, ['reviewer', 'head']) ||
      !isReviewer(r.reviewer) ||
      typeof r.head !== 'string' ||
      !SHA_RE.test(r.head)
    )
      return null;
  if (!Array.isArray(raw.findings) || !raw.findings.every(validEntry)) return null;
  const ids = (raw.findings as Entry[]).map((e) => e.id);
  if (new Set(ids).size !== ids.length) return null;
  if (!Array.isArray(raw.ciFailures) || raw.ciFailures.length > MAX_CI_FAILURES) return null;
  for (const f of raw.ciFailures as unknown[])
    if (
      !isObj(f) ||
      !keysAre(f, ['head', 'run']) ||
      typeof f.head !== 'string' ||
      !SHA_RE.test(f.head) ||
      typeof f.run !== 'string' ||
      f.run.length > 300
    )
      return null;
  return raw as unknown as Ledger;
}
