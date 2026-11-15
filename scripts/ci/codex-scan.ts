// Codex 판정 job의 유출 검사(10.4절 "판정 job 안의 유출 검사"). LLM 단계 뒤 같은 job에서 LLM 없이 돈다.
// `codex exec --json` 이벤트, 마지막 메시지, 그 밖의 로그에서 인증 토큰(실행 전 시크릿과 실행 뒤 auth.json)을 찾고,
// 허용 밖 항목 종류와 turn.failed를 본다. 문제가 없을 때만 판정을 낸다. 값과 실행 기록 원문은 돌려주지 않는다.
// Codex는 셸을 뺄 수 없다. 읽기 범위·쓰기·네트워크를 막는 것은 샌드박스와 사전 측정(codex-probe.sh)이고,
// pr/ 밖을 가리킨 명령은 문자열로만 알 수 있어 세어 보고만 한다.
import path from 'node:path';
import type { ClaudeScan } from './claude-scan.ts';
import { secretNeedles, validateVerdict } from './verdict.ts';

export type CodexScan = ClaudeScan;

// 셸 명령과 메시지 말고는 쓰지 않아야 한다. error 항목은 Codex 자체 경고다
export const CODEX_ALLOWED_ITEMS = [
  'agent_message',
  'reasoning',
  'command_execution',
  'todo_list',
  'error',
] as const;

const MIN_SECRET = 16;

/** auth.json 본문에서 스캔할 토큰 값(tokens의 문자열과 API 키) */
export function authTokenValues(text: string): string[] {
  try {
    const o = JSON.parse(text) as { tokens?: Record<string, unknown>; OPENAI_API_KEY?: unknown };
    const vals: unknown[] = Object.values(o?.tokens ?? {});
    vals.push(o?.OPENAI_API_KEY);
    return vals.filter((v): v is string => typeof v === 'string' && v.length >= MIN_SECRET);
  } catch {
    return [];
  }
}

/**
 * `codex exec --output-schema`에 줄 스키마. 공통 스키마에서 길이·개수 제약 키워드만 뺀다
 * (구조화 출력이 받지 않을 수 있다). 제약은 프롬프트로 알리고 validateVerdict가 검사한다.
 */
export function codexOutputSchema(schema: unknown): unknown {
  const DROP = ['maxLength', 'minLength', 'maxItems', 'minItems', 'minimum', 'maximum', 'pattern'];
  if (Array.isArray(schema)) return schema.map(codexOutputSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([k]) => !DROP.includes(k))
      .map(([k, v]) => [k, codexOutputSchema(v)]),
  );
}

interface Item {
  type?: unknown;
  text?: unknown;
  command?: unknown;
  exit_code?: unknown;
  aggregated_output?: unknown;
}

interface CodexEvent {
  type?: unknown;
  item?: Item;
  error?: { message?: unknown };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

const SHELLS = /^\s*(?:\/usr)?\/bin\/(?:ba|z|da)?sh\s+-l?c\s+/;
const TARGET_RE =
  /(?:^|[\s'"=<>|;&(])(~[^\s'";|&)]*|\.\.(?:\/[^\s'";|&)]*)?|\/[^\s'";|&)]+|\$\{?[A-Z_]+\}?[^\s'";|&)]*)/g;
const ENV_RE = /(?:^|[\s'";|&(])(?:env|printenv|set|export\s+-p)(?=$|[\s'";|&)])/;
const DENIED = /denied|not permitted|no such file|cannot access|cannot open/i;

/** 명령 문자열이 pr/ 밖(절대 경로, ~, .., $변수, 환경 출력)을 가리키는가. 셸 실행 파일과 /dev/null은 뺀다 */
function pointsOutside(command: string, prDir: string): boolean {
  const body = command.replace(SHELLS, '');
  for (const m of body.matchAll(TARGET_RE)) {
    const t = m[1];
    if (t === '/dev/null') continue;
    if (t.startsWith('/')) {
      const rel = path.relative(prDir, t);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) continue;
    }
    return true;
  }
  return ENV_RE.test(body);
}

export function scanCodexRun(o: {
  /** `codex exec --json`의 stdout */
  events: string;
  /** `-o` 마지막 메시지 파일 내용 */
  last: string;
  /** stderr 등 그 밖의 로그 */
  logs: string[];
  prDir: string;
  secrets: string[];
}): CodexScan {
  const report: string[] = [];
  const fail = (reason: string, errorText?: string): CodexScan => ({
    ok: false,
    reason,
    ...(errorText === undefined ? {} : { errorText }),
    report,
  });
  const secretIn = secretNeedles(o.secrets);
  const lines = o.events.split('\n').filter((l) => l.trim());
  const events = lines.flatMap((l): CodexEvent[] => {
    try {
      const e: unknown = JSON.parse(l);
      return e && typeof e === 'object' ? [e as CodexEvent] : [];
    } catch {
      return [];
    }
  });
  const items = events
    .filter((e) => e.type === 'item.completed' && e.item && typeof e.item === 'object')
    .map((e) => e.item as Item);
  const counts = new Map<string, number>();
  let other = 0;
  for (const i of items) {
    const allowed = (CODEX_ALLOWED_ITEMS as readonly unknown[]).includes(i.type);
    if (!allowed) other++;
    const name = allowed ? (i.type as string) : 'other';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const turnFailed = events.findLast((e) => e.type === 'turn.failed');
  const errorEvents = events.filter((e) => e.type === 'error').length;
  const usage = events.findLast((e) => e.type === 'turn.completed')?.usage;

  const prDir = path.resolve(o.prDir);
  let outsideAttempts = 0;
  let outsideOk = 0;
  for (const i of items) {
    if (i.type !== 'command_execution') continue;
    if (!pointsOutside(String(i.command ?? ''), prDir)) continue;
    outsideAttempts++;
    if (i.exit_code === 0 && !DENIED.test(String(i.aggregated_output ?? ''))) outsideOk++;
  }

  const logLines = [...lines, ...o.logs.flatMap((t) => t.split('\n'))];
  const secretLines = logLines.filter((l) => secretIn(l)).length;
  const num = (v: unknown) => (typeof v === 'number' ? v : '?');
  const tally =
    [...counts]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}:${v}`)
      .join(',') || '-';
  report.push(
    `events=${events.length} items=${tally} other_items=${other} errors=${errorEvents} usage=in:${num(usage?.input_tokens)},out:${num(usage?.output_tokens)}`,
    `turn_failed=${Boolean(turnFailed)}`,
    `outside_attempts=${outsideAttempts} outside_ok=${outsideOk}`,
    `secret_lines=${secretLines}`,
  );

  if (!events.length) return fail('실행 기록이 비어 있다');
  if (turnFailed) {
    const m = String(turnFailed.error?.message ?? '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    return fail('실행 오류(turn.failed, 판정 없음)', secretIn(m) ? '<redacted>' : m);
  }
  if (secretLines) return fail('실행 기록에 비밀 값이 보인다');
  if (other) return fail('허용 밖 항목 종류가 실행 기록에 있다(셸·메시지 밖의 도구)');

  // 판정: -o 파일, 없으면 마지막 agent_message
  let lastText = o.last;
  if (!lastText.trim()) {
    const m = items.findLast((i) => i.type === 'agent_message')?.text;
    lastText = typeof m === 'string' ? m : '';
  }
  if (secretIn(lastText)) return fail('판정에 비밀 값이 보인다');
  let verdict: unknown;
  try {
    verdict = JSON.parse(lastText);
  } catch {
    return fail('판정이 없다(마지막 메시지가 JSON이 아니다)');
  }
  const v = validateVerdict(verdict);
  if (!v.ok) return fail(`판정 형식 오류: ${v.reason}`);
  if (secretIn(JSON.stringify(v.value))) return fail('판정에 비밀 값이 보인다');
  return { ok: true, verdict: v.value, report };
}
