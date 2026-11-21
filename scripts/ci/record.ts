// 기록 job(gates 워크플로 record): 판정 결과를 검사한 뒤 검증 App 토큰으로 PR head에 커밋 상태를 쓴다(10.4절).
// LLM을 실행하지 않고 PR 코드를 실행하지 않는다. 토큰 값은 어떤 출력에도 넣지 않는다.
import { patchOf, withPatch } from './binding.ts';
import { mergeSelfTest } from './selftest-result.ts';
import {
  highEntropy,
  secretNeedles,
  validateVerdict,
  verdictStatus,
  type Verdict,
} from './verdict.ts';
import {
  cleanDescription,
  REVIEW_CONTEXTS,
  RECORDED_CONTEXTS,
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
  /**
   * 자체 테스트(selftest job, 12.4절). 주면 harness-guard 결과에 합친다: 필요한데 보고서가 없거나 깨졌으면 error,
   * 실패한 시나리오가 있으면 failure다. `report`는 PR 코드를 실행한 job이 쓴 값이다
   */
  selfTest?: { needed: boolean; report: unknown | null };
}

export async function recordStatuses(
  o: RecordOptions,
): Promise<{ ok: boolean; reason: string | null }> {
  if (!REPO_RE.test(o.repo)) throw new Error(`repo 형식 오류(owner/name): ${o.repo.slice(0, 80)}`);
  if (!SHA_RE.test(o.headSha)) throw new Error('head SHA가 40자리 소문자 hex가 아니다');
  const contexts = o.contexts ?? RECORDED_CONTEXTS;
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
  const st = o.selfTest;
  if (value && st)
    value = {
      ...value,
      results: value.results.map((g) =>
        g.context === 'harness-guard' ? mergeSelfTest(g, { ...st, headSha: o.headSha }) : g,
      ),
    };
  for (const s of toStatuses(value, contexts, reason ?? '')) await o.post(s);
  return { ok: value !== null, reason };
}

/** 로그 한 줄로: 줄바꿈·제어 문자를 공백으로. 판정 본문이 러너의 워크플로 명령 줄(`::…`)을 만들지 못하게 한다 */
export function oneLine(s: string): string {
  return s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * 기록 job이 판정 하나를 로그에 내는 줄(10.1절): 판정 한 줄, 그 뒤 지적마다 세 줄(위치·제목, 근거, 제안).
 * 원장에는 위치와 제목만 남으므로 근거·제안은 이 줄에서 본다. 사람(절차서 5절)과 runner
 * (`runner/review.ts`의 `parseReviewLog`)가 읽는다. 형식을 바꾸면 병합 전후 실행의 로그가 달라져 읽기가 깨진다.
 * 본문은 PR 내용에 영향받는 LLM 출력이다. 한 줄로 만들고 접두어를 붙여 워크플로 명령 줄이 생기지 않게 한다
 */
export function reviewLogLines(v: Verdict): string[] {
  const lines = [
    `record-review: 판정 ${v.verdict} (검증자가 본 위험도 ${v.risk}) — ${oneLine(v.summary)}`,
  ];
  for (const f of v.findings)
    lines.push(
      `  [${f.severity}] ${oneLine(f.file)}:${f.line} ${oneLine(f.title)}`,
      `    근거: ${oneLine(f.evidence)}`,
      `    제안: ${oneLine(f.suggestion)}`,
    );
  return lines;
}

export interface RecordReviewOptions {
  context: string;
  /** 위험도·작성 도구 기준으로 이 검증자가 필요한가 */
  needed: boolean;
  /** 판정 job이 넘긴 verdict.json 내용. 없으면 null */
  raw: string | null;
  /** 판정에 있으면 안 되는 비밀 값(기록 job이 아는 것). 값은 어떤 출력에도 넣지 않는다 */
  secrets: string[];
  headSha: string;
  repo: string;
  post: (p: StatusPayload) => Promise<void>;
  /** 지금 head의 patch-id(plan job이 base 스크립트로 계산). 승인 상태에 적어 이어받기의 근거로 쓴다(10.3절) */
  patch?: string;
  /** 승인을 이어받을 원래 head SHA(plan job의 판정). 있으면 판정 없이 success를 쓴다 */
  carriedFrom?: string;
  /** 형식 검사와 시크릿 스캔을 통과한 판정을 받는다(로그 출력용) */
  onVerdict?: (v: Verdict) => void;
}

/** 검증자 판정을 검사한 뒤 review/* 상태 하나를 쓴다. 판정이 없거나 깨졌거나 비밀이 보이면 error(fail-closed) */
export async function recordReview(o: RecordReviewOptions): Promise<StatusPayload> {
  if (!(REVIEW_CONTEXTS as readonly string[]).includes(o.context))
    throw new Error(`review context가 아니다: ${o.context.slice(0, 40)}`);
  if (!REPO_RE.test(o.repo)) throw new Error(`repo 형식 오류(owner/name): ${o.repo.slice(0, 80)}`);
  if (!SHA_RE.test(o.headSha)) throw new Error('head SHA가 40자리 소문자 hex가 아니다');
  const done = async (state: StatusPayload['state'], description: string) => {
    const p = { context: o.context, state, description: cleanDescription(description) };
    await o.post(p);
    return p;
  };
  if (!o.needed)
    return done('success', '해당 없음(위험도·작성 도구 기준으로 이 검증자는 실행하지 않는다)');
  if (o.carriedFrom) {
    if (!SHA_RE.test(o.carriedFrom)) return done('error', '이어받을 원래 SHA 형식 오류');
    const d = withPatch(`이어받음 ${o.carriedFrom.slice(0, 12)}`, o.patch ?? '');
    if (patchOf(d) === null) return done('error', '이어받기에 patch가 없다');
    return done('success', d);
  }
  if (o.raw === null || o.raw.trim() === '')
    return done('error', '판정 없음(판정 job 실패 또는 유출 검사 불통과)');
  let parsed: unknown;
  try {
    parsed = JSON.parse(o.raw);
  } catch {
    return done('error', '판정 JSON 파싱 실패');
  }
  const v = validateVerdict(parsed);
  if (!v.ok) return done('error', `판정 형식 오류: ${v.reason}`);
  const text = JSON.stringify(v.value);
  if (secretNeedles(o.secrets)(text)) return done('error', '판정에 비밀 값이 보여 기록하지 않는다');
  if (highEntropy(text))
    return done('error', '판정에 토큰처럼 보이는 문자열이 있어 기록하지 않는다');
  o.onVerdict?.(v.value);
  const s = verdictStatus(v.value);
  // 승인에만 patch를 적는다. 다음 head가 같은 patch면 이 승인을 이어받는다
  return done(
    s.state,
    s.state === 'success' ? withPatch(s.description, o.patch ?? '') : s.description,
  );
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
