// 기록 job(gates 워크플로 record): 판정 결과를 검사한 뒤 검증 App 토큰으로 PR head에 커밋 상태를 쓴다(10.4절).
// LLM을 실행하지 않고 PR 코드를 실행하지 않는다. 토큰 값은 어떤 출력에도 넣지 않는다.
import {
  GATE_CONTEXTS,
  SHA_RE,
  toStatuses,
  validateResults,
  type GateResults,
  type StatusPayload,
} from './results.ts';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface RecordOptions {
  /** 판정 job이 넘긴 결과 파일 내용. 없으면 null */
  raw: string | null;
  headSha: string;
  /** owner/name */
  repo: string;
  targetUrl: string;
  post: (p: StatusPayload) => Promise<void>;
  contexts?: readonly string[];
}

export async function recordStatuses(
  o: RecordOptions,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!REPO_RE.test(o.repo)) throw new Error(`repo 형식 오류(owner/name): ${o.repo.slice(0, 80)}`);
  if (!SHA_RE.test(o.headSha)) throw new Error('head SHA가 40자리 소문자 hex가 아니다');
  const contexts = o.contexts ?? GATE_CONTEXTS;
  let value: GateResults | null = null;
  let reason: string | null = null;
  if (o.raw === null || o.raw.trim() === '') reason = '판정 결과 없음(판정 job 실패)';
  else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(o.raw);
    } catch {
      reason = '판정 결과 JSON 파싱 실패';
    }
    if (!reason) {
      const v = validateResults(parsed, { headSha: o.headSha, contexts });
      if (v.ok) value = v.value;
      else reason = `판정 결과 형식 오류: ${v.reason}`;
    }
  }
  for (const s of toStatuses(value, contexts, reason ?? '')) await o.post(s);
  return { ok: value !== null, reason };
}

export function githubStatusPoster(o: {
  token: string;
  repo: string;
  sha: string;
  targetUrl: string;
  apiUrl?: string;
}): (p: StatusPayload) => Promise<void> {
  const api = (o.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const url = `${api}/repos/${o.repo}/statuses/${o.sha}`;
  return async (p) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${o.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...p, target_url: o.targetUrl }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`커밋 상태 기록 실패(${p.context}): HTTP ${res.status} ${body}`);
    }
  };
}
