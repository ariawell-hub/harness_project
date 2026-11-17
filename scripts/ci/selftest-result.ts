// 자체 테스트(gates 워크플로 selftest job) 보고서를 검사해 harness-guard 결과에 합친다(10.3·10.4·12.4절).
// 보고서는 PR 코드를 실행한 job이 쓴 값이다. 형식을 검사하고, 상태 설명에는 형식 검사를 통과한 시나리오 id와 개수만 넣는다.
// 자체 테스트가 필요한데 결과가 없거나 깨졌으면 harness-guard는 success가 아니다(fail-closed).
import { SHA_RE, type GateResult } from './results.ts';

/** 시나리오 id 형식. 보고서의 id는 이 형식일 때만 상태 설명에 넣는다 */
const ID_RE = /^[a-z0-9-]{1,40}$/;
const STATES: readonly string[] = ['pass', 'fail', 'error'];
/** 보고서 하나에 들어갈 수 있는 시나리오 수 */
const MAX_RESULTS = 200;

type Validated = { ok: true; failed: string[]; total: number } | { ok: false; reason: string };

/** selftest job이 job 출력으로 넘긴 보고서(base64)를 푼다. 없거나 JSON이 아니면 null */
export function decodeSelfTest(b64: string | undefined): unknown | null {
  if (!b64 || !b64.trim()) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** selftest job의 보고서를 검사한다. 형식이 깨졌거나 headSha가 다르면 ok: false */
export function validateSelfTest(raw: unknown, o: { headSha: string }): Validated {
  const no = (reason: string): Validated => ({ ok: false, reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return no('보고서가 객체가 아니다');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return no('지원하지 않는 version');
  if (typeof r.headSha !== 'string' || !SHA_RE.test(r.headSha))
    return no('headSha가 40자리 소문자 hex가 아니다');
  if (r.headSha !== o.headSha) return no('보고서의 headSha가 기록 대상 head와 다르다');
  if (!Array.isArray(r.results)) return no('results가 배열이 아니다');
  if (r.results.length > MAX_RESULTS) return no('results가 너무 많다');
  const seen = new Set<string>();
  const failed: string[] = [];
  for (const x of r.results as unknown[]) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return no('results 항목이 객체가 아니다');
    const s = x as Record<string, unknown>;
    if (typeof s.id !== 'string' || !ID_RE.test(s.id)) return no('시나리오 id 형식이 틀리다');
    if (seen.has(s.id)) return no(`중복 시나리오: ${s.id}`);
    seen.add(s.id);
    if (typeof s.state !== 'string' || !STATES.includes(s.state))
      return no(`${s.id}: state가 pass | fail | error가 아니다`);
    if (s.state !== 'pass') failed.push(s.id);
  }
  return { ok: true, failed, total: seen.size };
}

/** harness-guard 결과에 자체 테스트 결과를 합친다 */
export function mergeSelfTest(
  guard: GateResult,
  o: { needed: boolean; report: unknown | null; headSha: string },
): GateResult {
  if (!o.needed) return guard;
  const v: Validated =
    o.report === null
      ? { ok: false, reason: 'selftest job이 보고서를 남기지 않았다' }
      : validateSelfTest(o.report, { headSha: o.headSha });
  let state: GateResult['state'];
  let note: string;
  if (!v.ok) {
    state = 'error';
    note = `자체 테스트 결과가 없다(${v.reason})`;
  } else if (v.total === 0) {
    state = 'error';
    note = '자체 테스트 결과가 없다(시나리오 0개)';
  } else if (v.failed.length) {
    state = 'failure';
    note = `자체 테스트 실패: ${v.failed.join(', ')}`;
  } else {
    state = 'success';
    note = `자체 테스트 통과 ${v.total}`;
  }
  const details = [...guard.details, note];
  // harness-guard 자신의 실패·오류가 먼저다. 통과일 때만 자체 테스트 결과가 상태를 정한다
  if (guard.state !== 'success' || state === 'success')
    return { ...guard, description: `${guard.description} · ${note}`, details };
  return { ...guard, state, description: note, details };
}
