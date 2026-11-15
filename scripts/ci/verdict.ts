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
} as const;

export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  title: string;
  evidence: string;
  suggestion: string;
}

export interface Verdict {
  verdict: 'approve' | 'request_changes';
  risk: 'low' | 'normal' | 'high';
  summary: string;
  findings: Finding[];
}

type Validated = { ok: true; value: Verdict } | { ok: false; reason: string };

const onlyKeys = (o: object, keys: readonly string[]) =>
  Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

export function validateVerdict(raw: unknown): Validated {
  const no = (reason: string): Validated => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('판정이 객체가 아니다');
  const v = raw as Record<string, unknown>;
  if (!onlyKeys(v, ['verdict', 'risk', 'summary', 'findings'])) return no('판정의 키가 다르다');
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
    if (!onlyKeys(f, ['severity', 'file', 'line', 'title', 'evidence', 'suggestion']))
      return no(`findings[${i}]의 키가 다르다`);
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
    });
  }
  return {
    ok: true,
    value: { verdict: v.verdict, risk: v.risk, summary: v.summary, findings },
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

/** 원장(#55) 전의 판정 규칙: 승인이고 차단 지적(P0·P1)이 없을 때만 통과 */
export function verdictStatus(v: Verdict): { state: 'success' | 'failure'; description: string } {
  const count = (s: Severity) => v.findings.filter((f) => f.severity === s).length;
  const counts = SEVERITIES.map((s) => [s, count(s)] as const).filter(([, n]) => n > 0);
  const tally = counts.length ? counts.map(([s, n]) => `${s} ${n}`).join(', ') : '지적 없음';
  const blocking = count('P0') + count('P1');
  if (v.verdict === 'approve' && blocking === 0)
    return { state: 'success', description: `승인 (${tally})` };
  return {
    state: 'failure',
    description: `${v.verdict === 'approve' ? '차단 지적 있음' : '수정 요청'} (${tally})`,
  };
}
