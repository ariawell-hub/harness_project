// 지적 대응(10.2절 (4)·(6), 4.5절): runner가 원장의 열린 P0·P1에 지적마다 세션 하나로 대응한다.
// 이 파일은 대응 기록(`review.json`)과 원장에서 대상을 고르는 함수만 둔다. 세션·판정·push는 run.ts의 doReview가 한다.
// 원장 상태는 검증자 판정으로만 바뀐다. runner는 원장을 읽기만 하고, 자기 대응이 통했는지는 다음 판정으로 안다.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEWERS, cell, roundsOf, type Entry, type Ledger, type Reviewer } from '../ci/ledger.ts';
import { harnessStateDir, repoInfo } from '../lib/git.ts';

/** 대응 한 번. head는 그 대응을 push한 커밋 */
export interface ReviewResponse {
  head: string;
  kind: 'fix' | 'rebuttal';
  /** 이 대응의 결과(다음 판정에서 닫혔는가, 여전히 열려 있는가)를 실패 기록에 반영했는가 */
  counted: boolean;
}

/** 지적 대응 상태. worktree 하네스 상태 폴더의 `review.json`(git이 추적하지 않는다). runner만 쓴다 */
export interface ReviewState {
  /**
   * 대응 키 → 대응 기록(오래된 것부터). 키는 지적 ID(`F3`)이거나, 차단 지적 없이 수정을 요청한
   * 검증자에 대한 대응이면 `review:<검증자>`다
   */
  responses: Record<string, ReviewResponse[]>;
  /** 마지막 대응 라운드: 대응 전 head와 push한 head, 대응 전 열린 차단 지적, 대응 전 원장의 가장 큰 지적 번호 */
  round: { base: string; head: string; open: string[]; maxId: number } | null;
  /** 지금 라운드에서 판정을 통과했지만 아직 push하지 않은 대응 키. push하면 비운다 */
  pending: string[];
}

const EMPTY: ReviewState = { responses: {}, round: null, pending: [] };

function stateFile(worktree: string): string {
  return path.join(harnessStateDir(repoInfo(worktree), 'worktree'), 'review.json');
}

const isStr = (v: unknown): v is string => typeof v === 'string';

/** 없거나 깨졌으면 빈 상태 */
export function readReviewState(worktree: string): ReviewState {
  try {
    const raw = JSON.parse(readFileSync(stateFile(worktree), 'utf8')) as Partial<ReviewState>;
    const responses: ReviewState['responses'] = {};
    for (const [k, list] of Object.entries(raw.responses ?? {})) {
      if (!Array.isArray(list)) continue;
      responses[k] = list
        .filter((r) => r && isStr(r.head) && (r.kind === 'fix' || r.kind === 'rebuttal'))
        .map((r) => ({ head: r.head, kind: r.kind, counted: r.counted === true }));
    }
    const r = raw.round;
    const round =
      r && isStr(r.base) && isStr(r.head) && Array.isArray(r.open) && Number.isInteger(r.maxId)
        ? { base: r.base, head: r.head, open: r.open.filter(isStr), maxId: r.maxId }
        : null;
    return {
      responses,
      round,
      pending: Array.isArray(raw.pending) ? raw.pending.filter(isStr) : [],
    };
  } catch {
    return { ...EMPTY, responses: {} };
  }
}

export function writeReviewState(worktree: string, s: ReviewState): void {
  writeFileSync(stateFile(worktree), JSON.stringify(s, null, 2) + '\n');
}

const idNumber = (id: string) => Number(id.slice(1));

/** 원장에서 이번에 대응할 지적: 상태가 open인 P0·P1, ID 순 */
export function openBlocking(ledger: Ledger): Entry[] {
  return ledger.findings
    .filter((e) => (e.severity === 'P0' || e.severity === 'P1') && e.status === 'open')
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

/** 원장의 가장 큰 지적 번호. 지적이 없으면 0 */
export function maxFindingId(ledger: Ledger): number {
  return ledger.findings.reduce((n, e) => Math.max(n, idNumber(e.id)), 0);
}

const lastUncounted = (state: ReviewState, key: string): ReviewResponse | null => {
  const last = state.responses[key]?.at(-1);
  return last && !last.counted ? last : null;
};

/**
 * 대응한 뒤 그 지적을 낸 검증자가 대응 head를 판정했는데도 열려 있는 지적 ID(아직 세지 않은 것).
 * 검증자가 대응 head를 아직 판정하지 않았으면(원장의 rounds에 없다) 세지 않는다
 */
export function failedResponses(state: ReviewState, ledger: Ledger): string[] {
  const out: string[] = [];
  for (const e of ledger.findings) {
    const last = lastUncounted(state, e.id);
    if (!last || e.status !== 'open') continue;
    if (ledger.rounds.some((r) => r.reviewer === e.reviewer && r.head === last.head))
      out.push(e.id);
  }
  return out.sort((a, b) => idNumber(a) - idNumber(b));
}

/** 대응한 뒤 닫힌 지적 ID(fixed·rejected·deferred. 아직 세지 않은 것). 그 실패 키는 0으로 돌아간다(9.2절) */
export function settledResponses(state: ReviewState, ledger: Ledger): string[] {
  return ledger.findings
    .filter((e) => lastUncounted(state, e.id) !== null && e.status !== 'open')
    .map((e) => e.id)
    .sort((a, b) => idNumber(a) - idNumber(b));
}

/** 그 키의 마지막 대응을 "결과를 반영했다"로 표시한 새 상태 */
export function markCounted(state: ReviewState, keys: readonly string[]): ReviewState {
  const responses = { ...state.responses };
  for (const k of keys) {
    const list = responses[k];
    if (!list?.length) continue;
    responses[k] = [...list.slice(0, -1), { ...list[list.length - 1], counted: true }];
  }
  return { ...state, responses };
}

/** 차단 지적 없이 수정을 요청한 검증자에 대한 대응 키(실패 키로도 쓴다) */
export const reviewerKey = (reviewer: Reviewer) => `review:${reviewer}`;

/** `review/<검증자>` context에서 검증자 이름. 검증자 context가 아니면 null */
export function reviewerOfContext(context: string): Reviewer | null {
  const name = context.startsWith('review/') ? context.slice('review/'.length) : '';
  return REVIEWERS.find((r) => r === name) ?? null;
}

/** 그 검증자가 마지막 판정에서 등록한 지적(미룬 것 포함), ID 순. 차단 지적 없는 수정 요청에 대응할 때 넘긴다 */
export function lastRoundFindings(ledger: Ledger, reviewer: Reviewer): Entry[] {
  const round = roundsOf(ledger, reviewer);
  return ledger.findings
    .filter((e) => e.reviewer === reviewer && e.round === round)
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

/**
 * 차단 지적 없는 수정 요청에 대응한 뒤, 그 검증자가 대응 head를 판정했는가(아직 세지 않은 대응).
 * 호출하는 쪽은 그 검증자의 `review/*`가 여전히 실패일 때 이 값으로 실패를 센다
 */
export function reviewerJudgedResponse(
  state: ReviewState,
  ledger: Ledger,
  reviewer: Reviewer,
): boolean {
  const last = lastUncounted(state, reviewerKey(reviewer));
  return !!last && ledger.rounds.some((r) => r.reviewer === reviewer && r.head === last.head);
}

/**
 * 중단 보고(Issue 댓글)의 "교차 검증 의견"에 쓰는 지적 한 줄(ID·등급·검증자·위치·제목).
 * 위치와 제목은 검증자 출력이라 원장 표와 같은 방법으로 마크다운·멘션 문자를 문자 참조로 바꾼다.
 * 실패 기록의 detail에는 쓰지 않는다: detail은 다음 세션 프롬프트의 "직전 실패"(데이터 블록 밖)에 들어간다
 */
export function findingLine(e: Entry): string {
  const where = e.file ? `${cell(e.file)}${e.line > 0 ? `:${e.line}` : ''}` : '(위치 없음)';
  return `${e.id} [${e.severity}, ${e.reviewer}] ${where} — ${cell(e.title)}`;
}

/** 커밋 메시지 제목에 쓸 지적 제목 앞부분: 한 줄(제어 문자와 유니코드 줄 구분자 없음) */
export function commitSubject(title: string, max = 60): string {
  return (
    title
      .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
      .replace(/ {2,}/g, ' ')
      .trim()
      .slice(0, max) || '지적 대응'
  );
}
