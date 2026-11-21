// 기계 판정 결과 파일 형식과 커밋 상태 변환(10.3·10.4절). 판정 job이 쓰고 기록 job이 검사한다.
// 기록 job은 이 형식을 통과한 값만 커밋 상태로 쓴다. 결과가 없거나 깨지면 아는 context 모두 error(fail-closed).

/**
 * 기록 job이 쓰는 기계 판정 context(판정 순서). harness-guard의 신호를 risk-gate가 받으므로 앞에 둔다.
 * revert-check는 맨 앞이다. 확인된 revert PR이면 plan-gate·harness-guard가 그 결과를 본다(10.3절)
 */
export const GATE_CONTEXTS = [
  'revert-check',
  'plan-gate',
  'harness-guard',
  'risk-gate',
  'deps-guard',
] as const;

/**
 * 경고 판정 context(R15·R18, 10.2절 (1)). 병합을 막지 않는다: 필수 체크가 아니고, 경고여도 state는 success다.
 * 경고는 description이 `경고: `로 시작한다
 */
export const WARN_CONTEXTS = ['pr-size'] as const;

/** 기록 job이 커밋 상태로 쓰는 context 전부(필수 판정 뒤에 경고 판정) */
export const RECORDED_CONTEXTS = [...GATE_CONTEXTS, ...WARN_CONTEXTS] as const;

/**
 * 판정 결과 파일의 크기 상한(바이트). 파일은 Base64로 job 출력과 환경 변수 하나(Linux에서 131,072바이트)에 실려
 * 기록 job으로 간다(gates.yml의 results·RESULTS_B64). 넘으면 기록 step이 시작되지 못해 필수 판정까지 기록되지 않는다
 */
export const RESULTS_MAX_BYTES = 90_000;
/** 결과가 커서 경고 판정의 상세를 뺐을 때 그 자리에 두는 한 줄 */
export const WARN_DETAILS_DROPPED = '… (판정 결과가 커서 상세를 뺐다)';

/** 검증자 판정 context(R12). 판정 워크플로의 기록 job이 쓴다 */
export const REVIEW_CONTEXTS = ['review/claude', 'review/codex'] as const;

/** 지적 원장 판정 context(R16). 판정 워크플로의 기록 job이 원장을 고친 뒤 쓴다 */
export const LEDGER_CONTEXT = 'review-ledger';

export type GateState = 'success' | 'failure' | 'error';
const STATES: readonly string[] = ['success', 'failure', 'error'];

export interface GateResult {
  context: string;
  state: GateState;
  /** 커밋 상태 설명(기록 때 140자로 자른다) */
  description: string;
  /** 판정 job 요약에만 쓰는 상세. 커밋 상태에는 넣지 않는다 */
  details: string[];
}

export interface GateResults {
  version: 1;
  headSha: string;
  results: GateResult[];
  /** risk-gate가 정한 위험도. 이후 검증자 수를 정하는 데 쓴다(10.1절) */
  risk?: 'low' | 'normal' | 'high';
}

/** 판정 명령(`gates`)이 결과 파일에 쓰는 글자 */
export function serializeResults(r: GateResults): string {
  return JSON.stringify(r, null, 2) + '\n';
}

/** 결과 파일의 UTF-8 바이트 수 */
export function resultsBytes(r: GateResults): number {
  return Buffer.byteLength(serializeResults(r), 'utf8');
}

/**
 * 경고 판정이 결과 파일을 RESULTS_MAX_BYTES 너머로 키우지 않게 한다. 필수 판정의 결과는 건드리지 않는다.
 * 넘으면 경고 판정의 상세를 한 줄로 바꾸고, 그래도 넘으면 경고 판정을 결과에서 뺀다(기록 job이 그 context만 error로 쓴다).
 * 그래서 돌려주는 결과는 상한 이하이거나, 경고 판정이 없던 때의 결과와 같다
 */
export function fitWarnings(r: GateResults): GateResults {
  if (resultsBytes(r) <= RESULTS_MAX_BYTES) return r;
  const isWarn = (g: GateResult) => (WARN_CONTEXTS as readonly string[]).includes(g.context);
  const slim: GateResults = {
    ...r,
    results: r.results.map((g) =>
      isWarn(g) && g.details.length ? { ...g, details: [WARN_DETAILS_DROPPED] } : g,
    ),
  };
  if (resultsBytes(slim) <= RESULTS_MAX_BYTES) return slim;
  return { ...r, results: r.results.filter((g) => !isWarn(g)) };
}

export interface StatusPayload {
  context: string;
  state: GateState;
  description: string;
}

export const SHA_RE = /^[0-9a-f]{40}$/;
/** 계획 핵심 섹션 해시(sha256 hex, plan-hash.ts) */
export const PLAN_HASH_RE = /^[0-9a-f]{64}$/;
/** GitHub 커밋 상태 description 한도 */
export const DESCRIPTION_MAX = 140;

type Validated = { ok: true; value: GateResults } | { ok: false; reason: string };

export function validateResults(
  raw: unknown,
  o: { headSha: string; contexts: readonly string[] },
): Validated {
  const no = (reason: string): Validated => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('결과가 객체가 아니다');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return no(`지원하지 않는 version: ${String(r.version)}`);
  if (typeof r.headSha !== 'string' || !SHA_RE.test(r.headSha))
    return no('headSha가 40자리 소문자 hex가 아니다');
  if (r.headSha !== o.headSha) return no('결과의 headSha가 기록 대상 head와 다르다');
  if (!Array.isArray(r.results)) return no('results가 배열이 아니다');
  if (r.risk !== undefined && r.risk !== 'low' && r.risk !== 'normal' && r.risk !== 'high')
    return no('risk 값이 low | normal | high가 아니다');
  const seen = new Set<string>();
  const out: GateResult[] = [];
  for (const x of r.results as unknown[]) {
    if (!x || typeof x !== 'object') return no('results 항목이 객체가 아니다');
    const g = x as Record<string, unknown>;
    if (typeof g.context !== 'string' || !o.contexts.includes(g.context))
      return no(`모르는 context: ${String(g.context).slice(0, 40)}`);
    if (seen.has(g.context)) return no(`중복 context: ${g.context}`);
    seen.add(g.context);
    if (typeof g.state !== 'string' || !STATES.includes(g.state))
      return no(`${g.context}: 잘못된 state`);
    if (typeof g.description !== 'string') return no(`${g.context}: description이 문자열이 아니다`);
    if (!Array.isArray(g.details) || !g.details.every((d) => typeof d === 'string'))
      return no(`${g.context}: details가 문자열 배열이 아니다`);
    out.push({
      context: g.context,
      state: g.state as GateState,
      description: g.description,
      details: g.details as string[],
    });
  }
  const value: GateResults = { version: 1, headSha: r.headSha, results: out };
  if (r.risk !== undefined) value.risk = r.risk;
  return { ok: true, value };
}

export function cleanDescription(s: string): string {
  const flat = s.replace(/\p{Cc}/gu, ' ').trim();
  return flat.length > DESCRIPTION_MAX ? flat.slice(0, DESCRIPTION_MAX - 1) + '…' : flat;
}

/** 결과를 context 목록 순서의 커밋 상태로. 없거나 빠진 context는 error */
export function toStatuses(
  r: GateResults | null,
  contexts: readonly string[],
  reason: string,
): StatusPayload[] {
  return contexts.map((context) => {
    const g = r?.results.find((x) => x.context === context);
    if (!g)
      return {
        context,
        state: 'error' as const,
        description: cleanDescription(r ? `판정 결과에 ${context}가 없다` : reason),
      };
    return { context, state: g.state, description: cleanDescription(g.description) };
  });
}
