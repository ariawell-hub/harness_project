// L1 훅의 판정. 진입 파일(guard.ts)이 Claude Code·Codex의 PreToolUse 훅 입력(stdin JSON)을 이 모듈의 decide에
// 넘긴다. 진입·종료 코드·fail-closed는 guard.ts에 있다(13.1절 훅 구현 규칙). 테스트는 guard.ts가 아니라 이 모듈을
// import한다(guard.ts는 불리면 늘 실행한다).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { approvalPending, planRiskOf } from '../lib/approval.ts';
import { resolveDbCommands, resolveMcpGuard, type DbCommandRule } from '../lib/config.ts';
import { hasCommits, tryRepoInfo, type RepoInfo } from '../lib/git.ts';
import { findPlan, parseDoc } from '../lib/plan.ts';
import { formatProblem } from '../lib/util.ts';
import { evaluate, type GuardContext, type GuardInput } from './rules.ts';
import { commandName, type Dialect } from './shell.ts';

type Json = Record<string, unknown>;

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

/**
 * 셸 도구 명령을 해석할 방언(ADR-0005, 설계서 13.1절).
 * Claude Code `PowerShell` 도구는 PowerShell, `Bash` 도구는 POSIX(Windows에서는 Git Bash).
 * Windows에서 형식을 실측하지 않은 그 밖의 셸 도구(Codex 등)는 두 방식으로 모두 판정한다(fail-closed).
 */
function shellDialects(tool: string, platform: NodeJS.Platform): Dialect[] {
  if (/^powershell$/i.test(tool)) return ['powershell'];
  if (/^bash$/i.test(tool)) return ['posix'];
  return platform === 'win32' ? ['posix', 'powershell'] : ['posix'];
}

function quote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

function argvToScript(argv: string[]): string {
  if (argv.length >= 3 && SHELLS.has(commandName(argv[0])) && /^-[a-z]*c$/.test(argv[1]))
    return argv[2];
  return argv.map(quote).join(' ');
}

export function patchFiles(patch: string): string[] {
  const out: string[] = [];
  for (const m of patch.matchAll(
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm,
  )) {
    out.push((m[1] ?? m[2]).trim());
  }
  return out;
}

export function normalize(
  payload: Json,
  platform: NodeJS.Platform = process.platform,
): GuardInput | null {
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
  if (/^mcp__/i.test(tool)) {
    // MCP 도구 입력의 command·cwd·patch는 도구마다 뜻이 달라 셸 명령이나 패치로 읽지 않는다
    return {
      kind: 'mcp',
      tool,
      input: payload.tool_input ?? payload.toolInput ?? payload.input ?? {},
      cwd: String(payload.cwd ?? process.cwd()),
    };
  }
  const ti = (payload.tool_input ?? payload.toolInput ?? payload.input ?? {}) as Json;
  const cwd = String(ti.workdir ?? ti.cwd ?? payload.cwd ?? process.cwd());
  const str = (x: unknown) => (typeof x === 'string' ? x : undefined);

  const patch =
    str(ti.patch) ??
    (str(ti.input)?.includes('*** Begin Patch') ? str(ti.input) : undefined) ??
    (str(ti.command)?.includes('*** Begin Patch') ? str(ti.command) : undefined);
  if (/apply_patch/i.test(tool) || patch) {
    return { kind: 'write', files: patchFiles(patch ?? ''), cwd };
  }
  if (/^(Read|NotebookRead|view|read_file|Grep|Glob)$/i.test(tool)) {
    const f = str(ti.file_path) ?? str(ti.notebook_path) ?? str(ti.path);
    return { kind: 'read', files: f ? [f] : [], cwd };
  }
  if (
    /^(Edit|Write|MultiEdit|NotebookEdit|write_file|edit_file|create_file|str_replace_editor)$/i.test(
      tool,
    )
  ) {
    const f = str(ti.file_path) ?? str(ti.notebook_path) ?? str(ti.path);
    return { kind: 'write', files: f ? [f] : [], cwd };
  }
  const cmd = ti.command ?? ti.cmd;
  if (
    /^(Bash|PowerShell|shell|exec_command|local_shell|unified_exec|run_shell_command|container\.exec)$/i.test(
      tool,
    ) ||
    cmd !== undefined
  ) {
    const dialects = shellDialects(tool, platform);
    if (Array.isArray(cmd))
      return { kind: 'bash', command: argvToScript(cmd.map(String)), cwd, dialects };
    if (typeof cmd === 'string') return { kind: 'bash', command: cmd, cwd, dialects };
  }
  return null;
}

function loadGuardConfig(root: string | null): {
  dbPatterns: string[];
  dbClients: string[];
  dbCommands?: unknown;
  mcp?: unknown;
} {
  if (!root) return { dbPatterns: [], dbClients: [] };
  const f = path.join(root, 'harness.config.json');
  if (!existsSync(f)) return { dbPatterns: [], dbClients: [] };
  const cfg = JSON.parse(readFileSync(f, 'utf8')) as {
    guard?: { dbPatterns?: string[]; dbClients?: string[]; dbCommands?: unknown; mcp?: unknown };
  };
  return {
    dbPatterns: cfg.guard?.dbPatterns ?? [],
    dbClients: cfg.guard?.dbClients ?? [],
    dbCommands: cfg.guard?.dbCommands,
    mcp: cfg.guard?.mcp,
  };
}

/** 경로가 속한 리포(worktree). 아직 없는 파일이면 존재하는 가장 가까운 상위 폴더로 찾는다 */
export function repoOfPath(abs: string): RepoInfo | null {
  let d = abs;
  while (!existsSync(d)) {
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
  if (!statSync(d).isDirectory()) d = path.dirname(d);
  return tryRepoInfo(d);
}

/** worktree에 있는 계획의 frontmatter owner. 못 찾거나 못 읽으면 null(호출자가 막는다) */
export function planOwnerOf(root: string, id: string): string | null {
  const ref = findPlan(root, id);
  if (!ref) return null;
  try {
    const owner = parseDoc(readFileSync(path.join(root, ref.file), 'utf8')).frontmatter?.owner;
    return typeof owner === 'string' && owner ? owner : null;
  } catch {
    return null;
  }
}

/** 판정 문맥. 작업자 이름 규칙은 new-task의 owner 기본값과 같다 */
export function buildContext(
  cwd: string,
  worker = process.env.HARNESS_WORKER ?? 'session',
): GuardContext {
  const repo = tryRepoInfo(cwd);
  const { dbPatterns, dbClients } = loadGuardConfig(repo?.root ?? null);
  // guard.dbCommands도 guard.mcp처럼 메인 체크아웃의 설정으로 판정한다: worktree의 빈 목록이나 옛 설정이
  // 메인의 차단을 풀 수 없다. Bash 명령을 판정할 때만 읽고(한 번 읽어 다시 쓴다), 틀리면 던져서 그 호출을 막는다
  let dbCommands: DbCommandRule[] | null = null;
  return {
    repo,
    hasCommits: repo ? hasCommits(repo.root) : undefined,
    hasPlan: (root, id) => findPlan(root, id) !== null,
    repoOf: repoOfPath,
    planOwner: planOwnerOf,
    worker,
    approvalPending,
    planRisk: planRiskOf,
    dbPatterns,
    dbClients,
    dbCommands: () =>
      (dbCommands ??= resolveDbCommands(loadGuardConfig(repo?.mainRoot ?? null).dbCommands)),
    // MCP 규칙은 메인 체크아웃의 설정으로 판정한다(훅 코드도 그쪽 것이 돈다):
    // worktree에서 고친, 아직 병합되지 않은 설정으로 규칙을 풀 수 없다. MCP 호출 때만 읽고, 틀리면 던져서 막는다
    mcp: () => resolveMcpGuard(loadGuardConfig(repo?.mainRoot ?? null).mcp),
  };
}

export function decide(payload: Json): string | null {
  const input = normalize(payload);
  if (!input) return null;
  const p = evaluate(input, buildContext(input.cwd));
  return p ? formatProblem(p) : null;
}
