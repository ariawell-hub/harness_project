// gates 워크플로가 판정할 PR을 이벤트에서 정한다(10.4절).
// 어느 이벤트든 페이로드의 head를 그대로 쓰지 않고 API로 다시 조회해 실행 시점의 head를 판정한다.
// pull_request_target은 이벤트의 PR 번호로 그 PR을 조회한다: 본문 수정(edited)의 이벤트에는 수정한 때의 head가 담겨 있어,
// 직후에 push가 오면 지난 head를 판정하고 새 head에는 상태가 남지 않았다(Issue #181).
// workflow_run(리뷰 뒤 재판정)은 head SHA로 조회해 열려 있는 같은 리포 PR의 현재 head에만 판정한다.
import { SHA_RE } from './results.ts';

export interface PrInfo {
  number: number;
  headSha: string;
  headRef: string;
  baseSha: string;
  body: string;
}

export type Resolved = PrInfo | { skip: string };

/** 저장소의 전체 이름(owner/name) */
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

interface RawPr {
  number?: unknown;
  state?: unknown;
  body?: unknown;
  head?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } | null };
  base?: { sha?: unknown };
}

function toInfo(p: RawPr, repo: string): PrInfo | null {
  if (
    typeof p?.number !== 'number' ||
    !Number.isSafeInteger(p.number) ||
    p.number <= 0 ||
    typeof p.head?.sha !== 'string' ||
    !SHA_RE.test(p.head.sha) ||
    typeof p.head.ref !== 'string' ||
    typeof p.base?.sha !== 'string' ||
    !SHA_RE.test(p.base.sha) ||
    p.head.repo?.full_name !== repo
  )
    return null;
  return {
    number: p.number,
    headSha: p.head.sha,
    headRef: p.head.ref,
    baseSha: p.base.sha,
    body: typeof p.body === 'string' ? p.body : '',
  };
}

export async function resolvePr(o: {
  eventName: string;
  event: unknown;
  /** owner/name */
  repo: string;
  /** GitHub REST GET(경로는 `repos/...`) */
  api: (path: string) => Promise<unknown>;
}): Promise<Resolved> {
  const ev = (o.event ?? {}) as { pull_request?: RawPr; workflow_run?: { head_sha?: unknown } };
  if (o.eventName === 'pull_request_target') {
    const fork = { skip: '같은 리포 브랜치의 PR이 아니다(포크 PR은 판정하지 않는다)' };
    // 포크 PR과 형식이 틀린 이벤트는 조회하지 않고 건너뛴다(워크플로의 job 조건과 같은 판단이다)
    const fromEvent = ev.pull_request ? toInfo(ev.pull_request, o.repo) : null;
    if (!fromEvent) return fork;
    const cur = (await o.api(`repos/${o.repo}/pulls/${fromEvent.number}`)) as RawPr | null;
    // 응답이 이벤트의 PR과 맞지 않으면 건너뛰지 않고 실패한다: 건너뛰면 상태가 빠진 채 실행이 성공으로 보인다
    if (!cur || typeof cur !== 'object' || Array.isArray(cur) || cur.number !== fromEvent.number)
      throw new Error(`PR 조회 응답이 PR #${fromEvent.number}이 아니다`);
    const info = toInfo(cur, o.repo);
    if (info) return info;
    // head 저장소가 지워졌거나(null) 이름이 다른 리포로 확인되면(owner/name 꼴이고 이 리포와 다르다) 포크 PR이다. 이름이 없거나 그 꼴이 아니면
    // 포크인지 알 수 없다: 응답의 형식이 틀린 것으로 보고 실패한다(건너뛰면 상태가 조용히 빠진다)
    const headRepo = cur.head && typeof cur.head === 'object' ? cur.head.repo : undefined;
    const name = headRepo && typeof headRepo === 'object' ? headRepo.full_name : undefined;
    if (headRepo === null || (typeof name === 'string' && REPO_RE.test(name) && name !== o.repo))
      return fork;
    throw new Error(`PR 조회 응답의 형식이 틀렸다(PR #${fromEvent.number})`);
  }
  if (o.eventName === 'workflow_run') {
    const sha = ev.workflow_run?.head_sha;
    if (typeof sha !== 'string' || !SHA_RE.test(sha))
      return { skip: 'workflow_run에 head SHA가 없다' };
    const list = await o.api(`repos/${o.repo}/commits/${sha}/pulls`);
    if (!Array.isArray(list)) return { skip: 'PR 조회 응답이 배열이 아니다' };
    for (const p of list as RawPr[]) {
      if (p?.state !== 'open' || p.head?.sha !== sha) continue;
      const info = toInfo(p, o.repo);
      if (info) return info;
    }
    return { skip: `head ${sha.slice(0, 12)}인 열린 같은 리포 PR이 없다` };
  }
  return { skip: `지원하지 않는 이벤트: ${o.eventName}` };
}

export function githubGet(token: string, apiUrl?: string): (path: string) => Promise<unknown> {
  const api = (apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  return async (p) => {
    const res = await fetch(`${api}/${p}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub 조회 실패: HTTP ${res.status} ${p}`);
    return res.json();
  };
}

/** GraphQL 요청의 실패. 메시지는 고정된 문구와 수뿐이다(응답 본문·GitHub의 오류 문구를 넣지 않는다) */
export class GraphqlError extends Error {}

/**
 * GitHub GraphQL 요청 함수. data를 돌려준다. 200이 아니거나 응답에 errors가 있으면(데이터가 함께 와도) 예외다.
 * 오류 응답에는 댓글 본문 같은 데이터가 섞일 수 있어, 예외 메시지에는 상태 코드와 수만 쓴다
 */
export function githubGraphql(
  token: string,
  apiUrl?: string,
): (query: string, variables: Record<string, unknown>) => Promise<unknown> {
  const api = (apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  return async (query, variables) => {
    let res: Response;
    try {
      res = await fetch(`${api}/graphql`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new GraphqlError('GraphQL 요청 실패: 응답 없음');
    }
    if (!res.ok) throw new GraphqlError(`GraphQL 요청 실패: HTTP ${res.status}`);
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw new GraphqlError('GraphQL 응답 형식 오류');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new GraphqlError('GraphQL 응답 형식 오류');
    const { errors, data } = raw as { errors?: unknown; data?: unknown };
    if (Array.isArray(errors) ? errors.length > 0 : errors !== undefined && errors !== null)
      throw new GraphqlError(
        `GraphQL 응답에 오류가 있다(${Array.isArray(errors) ? errors.length : 1}건)`,
      );
    if (!data || typeof data !== 'object') throw new GraphqlError('GraphQL 응답 형식 오류');
    return data;
  };
}
