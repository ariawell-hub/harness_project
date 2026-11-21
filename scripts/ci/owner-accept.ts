// 제작자 승인으로 열린 P0·P1 지적을 닫는다(10.2절 (4) accepted, B11): 제작자 계정이 PR에 단 승인 댓글을 가려 원장에 반영한다.
// 검증자(LLM)의 판단을 거치지 않는다. 이 파일은 순수 함수만 둔다(네트워크·파일·환경 변수·시계 없음).
// 댓글은 편집 이력 필드와 함께 읽은 것(GraphQL)을 받는다. 고쳐지지 않은 것이 확인되지 않으면 버린다(TD-26).
import type { Entry, Ledger } from './ledger.ts';

/** GraphQL로 읽은 PR 댓글 하나. 읽지 못한 필드는 undefined나 null이다 */
export interface AcceptComment {
  databaseId?: unknown;
  author?: { login?: unknown } | null;
  body?: unknown;
  createdAt?: unknown;
  lastEditedAt?: unknown;
  editor?: unknown;
  userContentEdits?: { totalCount?: unknown } | null;
}

export interface Accept {
  /** F<번호> */
  id: string;
  /** 승인 댓글의 id */
  commentId: number;
  /** 댓글이 달린 시각(GraphQL createdAt) */
  at: string;
}

export interface AcceptOutcome {
  ledger: Ledger;
  /** 이번에 반영됐거나 유지된 승인 */
  applied: Accept[];
  /** 반영하지 않은 승인과 이유(로그용. 이유는 고정된 문자열 가운데 하나) */
  ignored: { id: string; commentId: number; reason: string }[];
  /** 승인이 없어져 open으로 되돌린 지적 ID */
  reopened: string[];
}

/** 승인 줄. 줄 앞에는 공백도 없어야 한다(들여쓴 줄은 코드 블록일 수 있다) */
const ACCEPT_LINE = /^\/harness accept (F[1-9]\d{0,5})[ \t]*$/;

/**
 * 본문 전체가 승인 줄뿐인 댓글에서 지적 ID를 고른다(중복 없이, 나온 순서). 아니면 빈 배열.
 * 빈 줄을 뺀 줄이 하나라도 승인 줄이 아니면 통째로 승인이 아니다. 그 줄이 GitHub에서 코드·인용·주석으로
 * 보이는지는 마크다운을 해석해야 알 수 있으므로, 다른 글이 없는 댓글만 받는다
 */
export function acceptIds(body: string): string[] {
  const ids: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*$/.test(line)) continue;
    const m = ACCEPT_LINE.exec(line);
    if (!m) return [];
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** 같은 계정인가: 대소문자를 가리지 않는다. 빈 문자열은 어느 것과도 같지 않다(runner/next.ts의 sameLogin과 같은 규칙) */
const sameLogin = (a: string, b: string) => a !== '' && a.toLowerCase() === b.toLowerCase();

/**
 * 고쳐지지 않은 것이 확인되는가. 마지막 편집 시각·편집자가 null이고 편집 기록이 0건이어야 한다.
 * 필드가 없으면(undefined) 확인하지 못한 것이다. REST의 작성·수정 시각은 초 단위라 쓰지 않는다
 */
function unedited(c: AcceptComment): boolean {
  return (
    c.lastEditedAt === null &&
    c.editor === null &&
    !!c.userContentEdits &&
    typeof c.userContentEdits === 'object' &&
    c.userContentEdits.totalCount === 0
  );
}

/**
 * 제작자 계정이 달았고 한 번도 고쳐지지 않은 것이 확인된 댓글의 승인만 고른다. 쓰기 권한 계정(봇)은 남의 댓글을
 * 고칠 수 있으므로 고쳐진 댓글은 누가 고쳤든 버린다. 같은 지적의 승인이 여럿이면 가장 늦게 단 것을 쓴다
 */
export function ownerAccepts(comments: readonly AcceptComment[], owner: string): Accept[] {
  const latest = new Map<string, Accept>();
  if (!owner) return [];
  for (const c of comments) {
    const login = c?.author?.login;
    if (typeof login !== 'string' || !sameLogin(login, owner)) continue;
    const commentId = c.databaseId;
    if (typeof commentId !== 'number' || !Number.isInteger(commentId) || commentId <= 0) continue;
    const at = c.createdAt;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) continue;
    if (!unedited(c)) continue;
    if (typeof c.body !== 'string') continue;
    for (const id of acceptIds(c.body)) {
      const prev = latest.get(id);
      const newer =
        !prev ||
        Date.parse(at) > Date.parse(prev.at) ||
        (Date.parse(at) === Date.parse(prev.at) && commentId > prev.commentId);
      if (newer) latest.set(id, { id, commentId, at });
    }
  }
  return [...latest.values()];
}

/** 이 승인을 그 지적에 반영하지 않는 이유. 반영하면 null */
function refusal(e: Entry | undefined, a: Accept): string | null {
  if (!e) return '원장에 없는 지적';
  if (e.severity !== 'P0' && e.severity !== 'P1') return '차단 지적(P0·P1)이 아니다';
  if (e.status !== 'open' && e.status !== 'accepted') return '열린 지적이 아니다';
  if (e.openedAt === undefined) return '게시 시각을 모르는 지적';
  // 같은 시각은 뒤로 보지 않는다(GitHub 시각은 초 단위라 순서를 단정할 수 없다). 읽을 수 없는 시각도 거부된다
  if (!(Date.parse(a.at) > Date.parse(e.openedAt))) return '지적이 게시된 뒤에 단 댓글이 아니다';
  return null;
}

/**
 * 원장에 승인을 반영한 새 원장을 돌려준다(입력은 바꾸지 않는다). 승인은 저장된 상태가 아니라 댓글에서 매번 다시
 * 계산한다: accepted인데 이번에 인정된 승인이 없는 지적은 open으로 되돌린다(댓글이 지워지거나 고쳐진 철회).
 * 같은 입력에 두 번 적용해도 결과가 같다
 */
export function applyOwnerAccepts(l: Ledger, accepts: readonly Accept[]): AcceptOutcome {
  const findings = l.findings.map((e) => ({ ...e, rejectedBy: [...e.rejectedBy] }));
  const applied: Accept[] = [];
  const ignored: AcceptOutcome['ignored'] = [];
  const reopened: string[] = [];
  const kept = new Set<string>();
  for (const a of accepts) {
    const e = findings.find((x) => x.id === a.id);
    const reason = refusal(e, a);
    if (reason || !e) {
      ignored.push({ id: a.id, commentId: a.commentId, reason: reason ?? '' });
      continue;
    }
    e.status = 'accepted';
    e.note = `제작자 승인(댓글 ${a.commentId})`;
    kept.add(e.id);
    applied.push({ ...a });
  }
  for (const e of findings) {
    if (e.status !== 'accepted' || kept.has(e.id)) continue;
    e.status = 'open';
    e.note = '제작자 승인이 없어져 다시 열림';
    reopened.push(e.id);
  }
  return { ledger: { ...l, findings }, applied, ignored, reopened };
}

/** 이 원장에 승인을 볼 지적이 있는가: open이거나 accepted인 P0·P1이 하나라도 있다 */
export function needsAccepts(l: Ledger): boolean {
  return l.findings.some(
    (e) =>
      (e.severity === 'P0' || e.severity === 'P1') &&
      (e.status === 'open' || e.status === 'accepted'),
  );
}
