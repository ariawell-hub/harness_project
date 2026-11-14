// gates 워크플로가 판정할 PR을 이벤트에서 정한다(10.4절).
// pull_request_target은 이벤트의 PR을, workflow_run(리뷰 뒤 재판정)은 페이로드의 PR 정보를 믿지 않고
// head SHA로 API를 다시 조회해 열려 있는 같은 리포 PR의 현재 head에만 판정한다.
import { SHA_RE } from './results.ts';

export interface PrInfo {
  number: number;
  headSha: string;
  headRef: string;
  baseSha: string;
  body: string;
}

export type Resolved = PrInfo | { skip: string };

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
    const info = ev.pull_request ? toInfo(ev.pull_request, o.repo) : null;
    return info ?? { skip: '같은 리포 브랜치의 PR이 아니다(포크 PR은 판정하지 않는다)' };
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
