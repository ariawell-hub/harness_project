// L1 훅 진입점. Claude Code·Codex의 PreToolUse 훅이 stdin으로 JSON을 넘긴다.
// 차단은 종료 코드 2 + stderr 메시지(13.1절 훅 구현 규칙). 0이 아닌 다른 코드는 차단이 아니므로 쓰지 않는다.
// 내부 오류가 나도 종료 코드 2로 막는다(fail-closed): R20은 L1에 기대기 때문이다(13.2절).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasCommits, tryRepoInfo } from '../lib/git.ts';
import { findPlan } from '../lib/plan.ts';
import { formatProblem } from '../lib/util.ts';
import { evaluate, type GuardContext, type GuardInput } from './rules.ts';
import { baseName } from './shell.ts';

type Json = Record<string, unknown>;

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

function quote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

function argvToScript(argv: string[]): string {
  if (argv.length >= 3 && SHELLS.has(baseName(argv[0])) && /^-[a-z]*c$/.test(argv[1]))
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

export function normalize(payload: Json): GuardInput | null {
  const tool = String(payload.tool_name ?? payload.toolName ?? '');
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
    /^(Bash|shell|exec_command|local_shell|unified_exec|run_shell_command|container\.exec)$/i.test(
      tool,
    ) ||
    cmd !== undefined
  ) {
    if (Array.isArray(cmd)) return { kind: 'bash', command: argvToScript(cmd.map(String)), cwd };
    if (typeof cmd === 'string') return { kind: 'bash', command: cmd, cwd };
  }
  return null;
}

function loadGuardConfig(root: string | null): { dbPatterns: string[]; dbClients: string[] } {
  if (!root) return { dbPatterns: [], dbClients: [] };
  const f = path.join(root, 'harness.config.json');
  if (!existsSync(f)) return { dbPatterns: [], dbClients: [] };
  const cfg = JSON.parse(readFileSync(f, 'utf8')) as {
    guard?: { dbPatterns?: string[]; dbClients?: string[] };
  };
  return { dbPatterns: cfg.guard?.dbPatterns ?? [], dbClients: cfg.guard?.dbClients ?? [] };
}

export function decide(payload: Json): string | null {
  const input = normalize(payload);
  if (!input) return null;
  const repo = tryRepoInfo(input.cwd);
  const ctx: GuardContext = {
    repo,
    hasCommits: repo ? hasCommits(repo.root) : undefined,
    hasPlan: (root, id) => findPlan(root, id) !== null,
    ...loadGuardConfig(repo?.root ?? null),
  };
  const p = evaluate(input, ctx);
  return p ? formatProblem(p) : null;
}

function main(): void {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
    const payload = JSON.parse(raw || '{}') as Json;
    const msg = decide(payload);
    if (msg) {
      process.stderr.write(`하네스 L1 훅이 차단했다.\n${msg}\n`);
      process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    process.stderr.write(
      `하네스 L1 훅 내부 오류로 안전을 위해 차단했다(fail-closed): ${(e as Error).message}\n` +
        '고치는 법: scripts/hooks/guard.ts를 고치는 별도 계획을 만들어라. 근거: docs/harness/design.md 13.1절\n',
    );
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
