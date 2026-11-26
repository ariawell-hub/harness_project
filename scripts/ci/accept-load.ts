// 제작자 승인(10.2절 (4) accepted)을 원장에 잇는다: PR 댓글을 편집 이력과 함께 읽어(GraphQL) owner-accept.ts로 반영한다.
// plan job(review-plan)과 기록 job(record-review)이 같은 함수 loadAccepted를 쓴다. 판별 규칙은 owner-accept.ts에만 있다.
// 댓글은 외부 입력이다(14.6절). 이 파일의 예외·이유 문구에는 댓글 본문, 응답 본문, GitHub이 준 오류 문구를 넣지 않는다.
import { parkFor, type Ledger } from './ledger.ts';
import { checkWhere, ledgerFromComments, listComments } from './ledger-store.ts';
import {
  applyOwnerAccepts,
  needsAccepts,
  ownerAccepts,
  type Accept,
  type AcceptComment,
  type AcceptOutcome,
} from './owner-accept.ts';
import { GraphqlError } from './pr.ts';
import { parseRebuttals, type Rebuttal } from './rebuttal.ts';

export type Graphql = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** 이 파일이 내는 예외. 메시지는 고정된 문구와 수뿐이라 로그·상태 설명에 그대로 써도 된다 */
export class AcceptError extends Error {}

/** 승인을 읽다 난 예외를 밖에 보여도 되는 한 줄로 바꾼다. 모르는 예외의 문구는 쓰지 않는다 */
export function acceptErrorText(e: unknown): string {
  return e instanceof AcceptError || e instanceof GraphqlError
    ? e.message
    : '편집 이력을 읽지 못했다';
}

const REPO_RE = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const PER_PAGE = 100;
/** ledger-store.ts의 댓글 목록 상한과 같다. 넘으면 끝을 확인하지 못한 것이다 */
const MAX_PAGES = 30;

// 편집 여부를 가리는 세 필드(lastEditedAt, editor, userContentEdits)를 함께 읽는다. 편집 기록은 수만 본다.
// 댓글 번호는 fullDatabaseId(BigInt, 문자열)로 읽는다. databaseId는 스키마에서 32비트 Int인데 실제 댓글 번호는 그 범위를 넘는다
const COMMENTS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      comments(first: ${PER_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          fullDatabaseId author { login } body createdAt lastEditedAt editor { login }
          userContentEdits(first: 1) { totalCount }
        }
      }
    }
  }
}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const FULL_ID_RE = /^[1-9]\d{0,15}$/;
/**
 * GraphQL 댓글을 판별 함수의 입력 꼴로 바꾼다. 댓글 번호는 fullDatabaseId에서만 얻는다(응답에 databaseId가 있어도 쓰지 않는다).
 * 번호가 숫자 문자열이 아니거나 안전한 정수 범위를 넘으면 번호 없는 댓글이 되고, ownerAccepts가 버린다
 */
function toAcceptComment(n: Record<string, unknown>): AcceptComment {
  const { fullDatabaseId, databaseId: _int32, ...rest } = n;
  const id =
    typeof fullDatabaseId === 'string' && FULL_ID_RE.test(fullDatabaseId)
      ? Number(fullDatabaseId)
      : NaN;
  return Number.isSafeInteger(id) ? { ...rest, databaseId: id } : rest;
}

/** PR의 댓글을 편집 이력 필드와 함께 모두 읽는다. 끝을 확인하지 못하거나 응답 꼴이 다르면 예외(일부만 돌려주지 않는다) */
export async function listAcceptComments(o: {
  graphql: Graphql;
  /** owner/name */
  repo: string;
  number: number;
}): Promise<AcceptComment[]> {
  const m = REPO_RE.exec(o.repo);
  if (!m) throw new AcceptError('repo 형식 오류(owner/name)');
  if (!Number.isInteger(o.number) || o.number <= 0) throw new AcceptError('PR 번호를 모른다');
  const out: AcceptComment[] = [];
  let after: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await o.graphql(COMMENTS_QUERY, {
      owner: m[1],
      name: m[2],
      number: o.number,
      after,
    });
    const repository = isObj(data) ? data.repository : null;
    const pr = isObj(repository) ? repository.pullRequest : null;
    const comments = isObj(pr) ? pr.comments : null;
    const info = isObj(comments) ? comments.pageInfo : null;
    const nodes = isObj(comments) ? comments.nodes : null;
    if (!isObj(info) || typeof info.hasNextPage !== 'boolean' || !Array.isArray(nodes))
      throw new AcceptError(`댓글 편집 이력 응답 형식 오류(${page}쪽)`);
    // 지워진 댓글 자리는 null일 수 있다. 꼴이 다른 항목은 ownerAccepts가 버린다
    for (const n of nodes) if (isObj(n)) out.push(toAcceptComment(n));
    if (!info.hasNextPage) return out;
    if (typeof info.endCursor !== 'string' || info.endCursor === '')
      throw new AcceptError(`댓글 편집 이력 응답 형식 오류(${page}쪽)`);
    after = info.endCursor;
  }
  throw new AcceptError(`댓글 편집 이력의 끝을 확인하지 못했다(${MAX_PAGES}쪽 넘음)`);
}

export interface Accepted {
  ledger: Ledger;
  /** 승인을 보지 않았으면 null */
  outcome: AcceptOutcome | null;
  /** 인정된 제작자 승인 전부(같은 실행에서 다시 적용할 때 쓴다). 보지 않았으면 빈 배열 */
  accepts: Accept[];
}

/**
 * 원장에 제작자 승인을 반영한다. 제작자 설정이 비었거나 볼 지적(open·accepted인 P0·P1)이 없으면 GraphQL을 부르지 않고
 * 원장을 그대로 돌려준다. 읽지 못하면 예외를 그대로 올린다(부르는 쪽이 닫힌 쪽으로 처리한다)
 */
export async function loadAccepted(o: {
  ledger: Ledger;
  owner: string;
  graphql: Graphql;
  repo: string;
  number: number;
}): Promise<Accepted> {
  if (!o.owner || !needsAccepts(o.ledger)) return { ledger: o.ledger, outcome: null, accepts: [] };
  const accepts = ownerAccepts(await listAcceptComments(o), o.owner);
  const outcome = applyOwnerAccepts(o.ledger, accepts);
  return { ledger: outcome.ledger, outcome, accepts };
}

/**
 * plan job이 판정 job에 넘길 원장과 반박을 읽는다(review-plan). 댓글 목록이나 원장을 읽지 못하면 예외다.
 * 승인(편집 이력)을 읽지 못하면 저장된 원장을 그대로 쓰고 이유를 돌려준다: 여기서 읽은 것은 검증자가 보는 입력이고,
 * 관문(review-ledger)은 기록 job이 같은 규칙으로 다시 계산해 정한다.
 * 구현 대기(Issue #212)는 기록 job과 같은 순서로 반영한다(parkFor → 제작자 승인 → parkFor). 저장하지 않는다
 */
export async function readRoundLedger(o: {
  get: (path: string) => Promise<unknown>;
  graphql: Graphql;
  repo: string;
  number: number;
  recorderBot: string;
  owner: string;
  /** 이 head가 계획만 담고 있는가(mode=plan). 기록 job의 planOnly와 같은 뜻이다 */
  planOnly: boolean;
}): Promise<{
  ledger: Ledger | null;
  rebuttals: Rebuttal[];
  outcome: AcceptOutcome | null;
  /** 승인을 확인하지 못한 이유(한 줄). 확인했거나 볼 것이 없었으면 null */
  acceptError: string | null;
}> {
  checkWhere(o);
  const comments = await listComments(o);
  let ledger = ledgerFromComments(comments, o.recorderBot).ledger;
  if (!ledger) return { ledger: null, rebuttals: [], outcome: null, acceptError: null };
  let outcome: AcceptOutcome | null = null;
  let acceptError: string | null = null;
  ledger = parkFor(ledger, o.planOnly);
  try {
    const a = await loadAccepted({ ...o, ledger });
    ledger = a.ledger;
    outcome = a.outcome;
  } catch (e) {
    acceptError = acceptErrorText(e);
  }
  ledger = parkFor(ledger, o.planOnly);
  // 반박(10.2절 (4)): PR 작성자의 댓글에서 형식에 맞는 것만 넘긴다. accepted·parked인 지적은 열린 지적이 아니라 대상이 아니다
  const pr = (await o.get(`repos/${o.repo}/pulls/${o.number}`)) as { user?: { login?: unknown } };
  const author = typeof pr?.user?.login === 'string' ? pr.user.login : '';
  const rebuttals = parseRebuttals({
    comments,
    ledger,
    author,
    recorderBot: o.recorderBot,
    repo: o.repo,
  });
  return { ledger, rebuttals, outcome, acceptError };
}
