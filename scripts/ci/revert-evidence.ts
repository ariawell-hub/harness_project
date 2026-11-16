// revert-check의 증거(10.3절): 대상 커밋의 main `check`가 실패했는가.
// GitHub Actions App이 만든 check run만 본다. 커밋 상태(status)는 봇 PAT도 같은 이름으로 쓸 수 있어 근거로 쓰지 않는다.
import type { TargetCheck } from '../gates/revert-check.ts';
import { ACTIONS_APP_ID } from './protection.ts';
import { SHA_RE } from './results.ts';

/** 필수 체크 `check`의 check run 이름(check.yml의 job) */
const CHECK_NAME = 'check';

interface RawRun {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  conclusion?: unknown;
  started_at?: unknown;
  app?: { id?: unknown } | null;
}

/**
 * 대상 커밋의 `check` 결론. 이름이 `check`이고 Actions App이 만든 run 가운데 가장 최근 것을 본다.
 * failure·timed_out은 'failure', success는 'success', 없거나 진행 중·취소·그 밖은 'none', 조회 실패는 null
 */
export async function targetCheckOf(
  api: (path: string) => Promise<unknown>,
  repo: string,
  sha: string,
): Promise<TargetCheck> {
  if (!SHA_RE.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  let raw: unknown;
  try {
    raw = await api(
      `repos/${repo}/commits/${sha}/check-runs?check_name=${CHECK_NAME}&per_page=100`,
    );
  } catch {
    return null;
  }
  const runs = (raw as { check_runs?: unknown } | null)?.check_runs;
  if (!Array.isArray(runs)) return null;
  const mine = (runs as RawRun[]).filter(
    (r) => r?.name === CHECK_NAME && r.app?.id === ACTIONS_APP_ID,
  );
  if (!mine.length) return 'none';
  const key = (r: RawRun) => [String(r.started_at ?? ''), Number(r.id) || 0] as const;
  const latest = mine.reduce((a, b) => {
    const [at, ai] = key(a);
    const [bt, bi] = key(b);
    return bt > at || (bt === at && bi > ai) ? b : a;
  });
  if (latest.status !== 'completed') return 'none';
  if (latest.conclusion === 'failure' || latest.conclusion === 'timed_out') return 'failure';
  return latest.conclusion === 'success' ? 'success' : 'none';
}
