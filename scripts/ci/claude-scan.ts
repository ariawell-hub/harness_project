// Claude 판정 job의 유출 검사(10.4절 "판정 job 안의 유출 검사"). LLM 단계 뒤 같은 job에서 LLM 없이 돈다.
// stream-json 실행 기록 전체와 판정에서 인증 값(원문·조각·인코딩)을 찾고, pr/ 밖을 가리킨 도구 호출(실제 경로 기준),
// 허용 밖 도구, MCP 서버를 본다. 문제가 없을 때만 판정을 낸다. 값과 실행 기록 원문은 돌려주지 않는다.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { secretNeedles, validateVerdict } from './verdict.ts';

// StructuredOutput: --json-schema가 판정을 받으려고 더하는 도구
export const CLAUDE_ALLOWED_TOOLS = ['Read', 'Grep', 'Glob', 'StructuredOutput'] as const;

export type ClaudeScan =
  | { ok: true; verdict: unknown; report: string[] }
  | { ok: false; reason: string; errorText?: string; report: string[] };

interface ToolUse {
  id?: unknown;
  name?: unknown;
  input?: Record<string, unknown>;
}

interface StreamEvent {
  type?: unknown;
  subtype?: unknown;
  model?: unknown;
  tools?: unknown;
  mcp_servers?: unknown;
  is_error?: unknown;
  num_turns?: unknown;
  result?: unknown;
  structured_output?: unknown;
  message?: { content?: unknown };
}

/** 가장 깊은 존재하는 조상까지 링크를 풀어 실제 경로를 구한다 */
function realTarget(p: string): string {
  let cur = p;
  const rest: string[] = [];
  while (!existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) return p;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  return path.join(realpathSync(cur), ...rest);
}

function isOutside(prReal: string, prDir: string, target: string): boolean {
  if (/^~/.test(target)) return true;
  const rel = path.relative(prReal, realTarget(path.resolve(prDir, target)));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

const ESCAPING_PATTERN = /^(\/|~|[A-Za-z]:)|(^|[\\/{,])\.\.([\\/},]|$)/;

/** 도구 호출이 가리키는 경로들. 경로 인자와, 밖으로 나갈 수 있는 glob 패턴 */
function targets(u: ToolUse): string[] {
  const i = u.input ?? {};
  const t = [i.file_path, i.path, i.notebook_path].filter(
    (x): x is string => typeof x === 'string',
  );
  if (u.name === 'Glob' && typeof i.pattern === 'string' && ESCAPING_PATTERN.test(i.pattern))
    t.push(i.pattern);
  if (typeof i.glob === 'string' && ESCAPING_PATTERN.test(i.glob)) t.push(i.glob);
  return t;
}

export function scanClaudeRun(o: { log: string; prDir: string; secrets: string[] }): ClaudeScan {
  const report: string[] = [];
  const fail = (reason: string, errorText?: string): ClaudeScan => ({
    ok: false,
    reason,
    ...(errorText === undefined ? {} : { errorText }),
    report,
  });
  const secretIn = secretNeedles(o.secrets);
  const lines = o.log.split('\n').filter((l) => l.trim());
  const events = lines.flatMap((l): StreamEvent[] => {
    try {
      const e: unknown = JSON.parse(l);
      return e && typeof e === 'object' ? [e as StreamEvent] : [];
    } catch {
      return [];
    }
  });
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.findLast((e) => e.type === 'result');

  const uses: ToolUse[] = [];
  const errored = new Map<unknown, boolean>();
  for (const e of events) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content as Record<string, unknown>[]) {
      if (c?.type === 'tool_use') uses.push(c as ToolUse);
      if (c?.type === 'tool_result') errored.set(c.tool_use_id, c.is_error === true);
    }
  }

  const prDir = path.resolve(o.prDir);
  const prReal = realTarget(prDir);
  const allowed = CLAUDE_ALLOWED_TOOLS as readonly unknown[];
  const counts = new Map<string, number>();
  let outsideAttempts = 0;
  let outsideOk = 0;
  let otherTools = 0;
  for (const u of uses) {
    const name = typeof u.name === 'string' ? u.name.slice(0, 40) : '?';
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!allowed.includes(u.name)) otherTools++;
    if (targets(u).some((t) => isOutside(prReal, prDir, t))) {
      outsideAttempts++;
      // 거부(is_error)가 확인된 것만 시도로 센다. 결과를 모르면 성공으로 본다
      if (errored.get(u.id) !== true) outsideOk++;
    }
  }
  const sessionTools = Array.isArray(init?.tools) ? (init.tools as unknown[]) : null;
  const extraTools = sessionTools ? sessionTools.filter((t) => !allowed.includes(t)).length : 0;
  const mcp = Array.isArray(init?.mcp_servers) ? init.mcp_servers.length : 0;
  const secretLines = lines.filter((l) => secretIn(l)).length;

  const tally = [...counts].map(([k, v]) => `${k}:${v}`).join(',') || '-';
  report.push(
    `model=${typeof init?.model === 'string' && !secretIn(init.model) ? init.model.slice(0, 60) : '?'} session_tools=${sessionTools ? sessionTools.length : '?'} extra_tools=${extraTools} mcp_servers=${mcp}`,
    `tool_uses=${tally} other_tools=${otherTools} num_turns=${typeof result?.num_turns === 'number' ? result.num_turns : '?'} is_error=${result ? result.is_error === true : '?'}`,
    `outside_attempts=${outsideAttempts} outside_ok=${outsideOk}`,
    `secret_lines=${secretLines}`,
  );

  if (!lines.length) return fail('실행 기록이 비어 있다');
  if (!result) return fail('실행 기록에 result 이벤트가 없다(판정 없음)');
  if (result.is_error === true) {
    const msg = String(result.result ?? '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    return fail('실행 오류(판정 없음)', secretIn(msg) ? '<redacted>' : msg);
  }
  if (secretLines) return fail('실행 기록에 비밀 값이 보인다');
  if (!init || !sessionTools) return fail('init 이벤트가 없어 세션의 도구를 확인할 수 없다');
  if (extraTools) return fail('허용 밖 도구가 세션에 실려 있다');
  if (mcp) return fail('MCP 서버가 세션에 실려 있다');
  if (otherTools) return fail('허용 밖 도구를 호출했다');
  if (outsideOk) return fail('pr/ 밖을 가리킨 도구 호출이 거부되지 않았다');

  let verdict: unknown = result.structured_output;
  if (verdict === undefined && typeof result.result === 'string') {
    try {
      verdict = JSON.parse(result.result);
    } catch {
      verdict = undefined;
    }
  }
  if (verdict === undefined) return fail('판정이 없다');
  const v = validateVerdict(verdict);
  if (!v.ok) return fail(`판정 형식 오류: ${v.reason}`);
  if (secretIn(JSON.stringify(v.value))) return fail('판정에 비밀 값이 보인다');
  return { ok: true, verdict: v.value, report };
}
