// 검증자 판정(verdict.json)의 형식 검사와 시크릿 스캔(10.1·10.4절). 기록 job과 판정 job의 유출 검사가 쓴다.
// 형식은 scripts/cross-review/verdict.schema.json과 같다(테스트가 둘의 일치를 확인한다).
// 스캔은 보조 수단이다. 1차 방어는 판정 job 규칙대로 LLM이 인증 정보를 읽지 못하게 하는 것이다.

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const LIMITS = {
  summary: 1000,
  findings: 30,
  file: 300,
  title: 200,
  evidence: 1500,
  suggestion: 1000,
  resolutions: 60,
  note: 300,
  reproPath: 200,
  reproContent: 4000,
  /** 판정 하나에 붙일 수 있는 재현 테스트 수(job 출력 크기) */
  repros: 3,
} as const;

/** 원장 지적 ID(10.2절 (4)) */
export const RESOLUTION_ID_RE = /^F[1-9][0-9]{0,3}$/;
export const RESOLUTION_STATUSES = ['fixed', 'rejected', 'open'] as const;

/** 검증자가 원장의 지적 하나에 내는 판정(2라운드부터) */
export interface Resolution {
  id: string;
  status: (typeof RESOLUTION_STATUSES)[number];
  note: string;
}

export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  title: string;
  evidence: string;
  suggestion: string;
  /** 재현 테스트(10.2절 (3)). 없으면 path와 content가 빈 문자열 */
  repro: Repro;
}

export interface Repro {
  /** 재현 job이 PR 체크아웃에 쓸 새 테스트 파일 경로 */
  path: string;
  /** 테스트 소스. 지적한 결함이 있으면 단언이 실패해야 한다 */
  content: string;
}

export interface Verdict {
  verdict: 'approve' | 'request_changes';
  risk: 'low' | 'normal' | 'high';
  summary: string;
  findings: Finding[];
  resolutions: Resolution[];
}

type Validated = { ok: true; value: Verdict } | { ok: false; reason: string };

const onlyKeys = (o: object, keys: readonly string[], optional: readonly string[] = []) =>
  Object.keys(o).every((k) => keys.includes(k) || optional.includes(k)) &&
  keys.every((k) => k in o);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export function validateVerdict(raw: unknown): Validated {
  const no = (reason: string): Validated => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('판정이 객체가 아니다');
  const v = raw as Record<string, unknown>;
  if (!onlyKeys(v, ['verdict', 'risk', 'summary', 'findings'], ['resolutions']))
    return no('판정의 키가 다르다');
  if (v.verdict !== 'approve' && v.verdict !== 'request_changes') return no('verdict 값이 다르다');
  if (v.risk !== 'low' && v.risk !== 'normal' && v.risk !== 'high') return no('risk 값이 다르다');
  if (!str(v.summary, LIMITS.summary)) return no('summary가 문자열이 아니거나 너무 길다');
  if (!Array.isArray(v.findings) || v.findings.length > LIMITS.findings)
    return no('findings가 배열이 아니거나 너무 많다');
  const findings: Finding[] = [];
  for (const [i, x] of (v.findings as unknown[]).entries()) {
    if (!x || typeof x !== 'object' || Array.isArray(x))
      return no(`findings[${i}]가 객체가 아니다`);
    const f = x as Record<string, unknown>;
    if (!onlyKeys(f, ['severity', 'file', 'line', 'title', 'evidence', 'suggestion'], ['repro']))
      return no(`findings[${i}]의 키가 다르다`);
    let repro: Repro = { path: '', content: '' };
    if (f.repro !== undefined) {
      const r = f.repro as Record<string, unknown>;
      if (!r || typeof r !== 'object' || Array.isArray(r) || !onlyKeys(r, ['path', 'content']))
        return no(`findings[${i}].repro의 형식이 다르다`);
      if (!str(r.path, LIMITS.reproPath) || !str(r.content, LIMITS.reproContent))
        return no(`findings[${i}].repro가 문자열이 아니거나 너무 길다`);
      repro = { path: r.path, content: r.content };
    }
    if (!(SEVERITIES as readonly unknown[]).includes(f.severity))
      return no(`findings[${i}].severity 값이 다르다`);
    if (!Number.isInteger(f.line) || (f.line as number) < 0)
      return no(`findings[${i}].line이 0 이상의 정수가 아니다`);
    for (const k of ['file', 'title', 'evidence', 'suggestion'] as const)
      if (!str(f[k], LIMITS[k])) return no(`findings[${i}].${k}가 문자열이 아니거나 너무 길다`);
    findings.push({
      severity: f.severity as Severity,
      file: f.file as string,
      line: f.line as number,
      title: f.title as string,
      evidence: f.evidence as string,
      suggestion: f.suggestion as string,
      repro,
    });
  }
  if (findings.filter((f) => f.repro.content !== '').length > LIMITS.repros)
    return no(`재현 테스트가 ${LIMITS.repros}개를 넘는다`);
  const resolutions: Resolution[] = [];
  const rawRes = v.resolutions ?? [];
  if (!Array.isArray(rawRes) || rawRes.length > LIMITS.resolutions)
    return no('resolutions가 배열이 아니거나 너무 많다');
  for (const [i, x] of (rawRes as unknown[]).entries()) {
    if (!x || typeof x !== 'object' || Array.isArray(x))
      return no(`resolutions[${i}]가 객체가 아니다`);
    const r = x as Record<string, unknown>;
    if (!onlyKeys(r, ['id', 'status', 'note'])) return no(`resolutions[${i}]의 키가 다르다`);
    if (typeof r.id !== 'string' || !RESOLUTION_ID_RE.test(r.id))
      return no(`resolutions[${i}].id가 F<번호> 꼴이 아니다`);
    if (!(RESOLUTION_STATUSES as readonly unknown[]).includes(r.status))
      return no(`resolutions[${i}].status 값이 다르다`);
    if (!str(r.note, LIMITS.note))
      return no(`resolutions[${i}].note가 문자열이 아니거나 너무 길다`);
    resolutions.push({ id: r.id, status: r.status as Resolution['status'], note: r.note });
  }
  return {
    ok: true,
    value: { verdict: v.verdict, risk: v.risk, summary: v.summary, findings, resolutions },
  };
}

const SLICE = 16;

/** 비밀 값의 원문, 흔한 인코딩, 16자 조각을 찾는 검사기. 16자 미만 값은 원문만 본다 */
export function secretNeedles(values: string[]): (text: string) => boolean {
  const whole = new Set<string>();
  const slices = new Set<string>();
  for (const s of values) {
    if (!s) continue;
    whole.add(s);
    if (s.length < SLICE) continue;
    const b = Buffer.from(s);
    for (const e of [
      b.toString('base64'),
      b.toString('base64url'),
      b.toString('hex'),
      b.toString('hex').toUpperCase(),
      encodeURIComponent(s),
    ])
      whole.add(e);
    for (let i = 0; i + SLICE <= s.length; i++) slices.add(s.slice(i, i + SLICE));
  }
  return (text) => {
    if (!text) return false;
    for (const w of whole) if (text.includes(w)) return true;
    if (slices.size)
      for (let i = 0; i + SLICE <= text.length; i++)
        if (slices.has(text.slice(i, i + SLICE))) return true;
    return false;
  };
}

function entropy(s: string): number {
  const n = new Map<string, number>();
  for (const c of s) n.set(c, (n.get(c) ?? 0) + 1);
  let h = 0;
  for (const c of n.values()) h -= (c / s.length) * Math.log2(c / s.length);
  return h;
}

/**
 * 토큰처럼 보이는 긴 무작위 문자열이 있는가. 40자 이상 이어진 base64/hex 꼴 조각 중
 * 문자 엔트로피가 높고 대문자·소문자·숫자가 섞인 것. 커밋 SHA(소문자 hex 40자)와 경로는 걸리지 않는다
 */
export function highEntropy(text: string): boolean {
  for (const m of text.matchAll(/[A-Za-z0-9+_=-]{40,}/g)) {
    const t = m[0];
    const mixed = /[a-z]/.test(t) && /[A-Z]/.test(t) && /[0-9]/.test(t);
    if (mixed && entropy(t) >= 4.3) return true;
  }
  return false;
}

/**
 * 원장(#55) 전의 판정 규칙: 승인이고 차단 지적(P0·P1)이 없을 때만 통과.
 * 원장이 미루는 P1(Issue #262 범위 밖, #267 동결·근거 없음): 차단 지적이 모두 P1이고 deferred(지적, 순번)가 참이며
 * resolutions에 open이 없으면 통과다. 원장은 그 P1을 미루고, 열린 지적은 review-ledger가 막는다(이 규칙이 없으면 미뤄도
 * review/*가 PR을 막는다). deferred는 원장의 등록 규칙(ledger.ts newEntryStatus)으로 만든다. 없으면 미루지 않는다
 */
export function verdictStatus(
  v: Verdict,
  deferred: (f: Finding, index: number) => boolean = () => false,
): { state: 'success' | 'failure'; description: string } {
  const count = (s: Severity) => v.findings.filter((f) => f.severity === s).length;
  const counts = SEVERITIES.map((s) => [s, count(s)] as const).filter(([, n]) => n > 0);
  const tally = counts.length ? counts.map(([s, n]) => `${s} ${n}`).join(', ') : '지적 없음';
  const blocking = count('P0') + count('P1');
  if (v.verdict === 'approve' && blocking === 0)
    return { state: 'success', description: `승인 (${tally})` };
  const blockers = [...v.findings.entries()].filter(
    ([, f]) => f.severity === 'P0' || f.severity === 'P1',
  );
  if (
    blockers.length > 0 &&
    blockers.every(([i, f]) => f.severity === 'P1' && deferred(f, i)) &&
    !(v.resolutions ?? []).some((r) => r.status === 'open')
  )
    return {
      state: 'success',
      description: `승인 (미룬 P1 ${blockers.length}, ${tally})`,
    };
  return {
    state: 'failure',
    description: `${v.verdict === 'approve' ? '차단 지적 있음' : '수정 요청'} (${tally})`,
  };
}
