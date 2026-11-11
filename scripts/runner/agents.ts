// 에이전트 세션 실행 어댑터(4.5절). step마다 새 세션을 띄운다.
//   claude: claude -p (무인 권한 프로필 + main 체크아웃의 L1 훅)
//   codex : codex exec (workspace-write 샌드박스, 승인 never)
//   fake  : 테스트용. HARNESS_FAKE_AGENT=<스크립트 경로>
// --dangerously-skip-permissions / bypassPermissions는 쓰지 않는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { resolveExecutable, run, type ExecResult, type ExecutableProbe } from '../lib/exec.ts';
import { harnessStateDir, type RepoInfo } from '../lib/git.ts';

export type AgentTool = 'claude' | 'codex' | 'fake';

export interface SessionResult {
  code: number;
  timedOut: boolean;
  durationMs: number;
  output: string;
  /** 사용량 한도·네트워크 등 환경 장애(실패로 세지 않음, 9.2절) */
  envFailure: boolean;
}

const ENV_FAILURE =
  /usage limit|rate[ _-]?limit|limit reached|hit your (usage )?limit|too many requests|\b429\b|overloaded|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|network error|service unavailable|\b503\b|\b529\b/i;

const realProbe = (): ExecutableProbe => ({
  platform: process.platform,
  env: process.env,
  exists: existsSync,
});

/**
 * runner가 띄울 에이전트 CLI 실행 파일을 확인한다(ADR-0005).
 * Windows에서 npm 래퍼(.cmd)뿐이면 셸 없이 실행할 수 없으므로 오류를 돌려준다.
 */
export function resolveAgentCommand(
  tool: AgentTool,
  cfg: HarnessConfig,
  probe: ExecutableProbe = realProbe(),
): { path: string } | { error: string } {
  if (tool === 'fake') return { path: process.execPath };
  const def = cfg.agents[tool];
  if (!def) return { error: `harness.config.json agents.${tool}가 없다` };
  const r = resolveExecutable(def.cmd, probe);
  if ('error' in r) {
    return {
      error: `${r.error}. harness.config.json agents.${tool}.cmd에 .exe 경로를 적어라(docs/decisions/ADR-0005-windows-native.md)`,
    };
  }
  return r;
}

/** 세션용 실행 파일 경로. runner 시작 때 확인했으므로 여기서 오류면 시작 확인을 건너뛴 것이다 */
function agentPath(tool: 'claude' | 'codex', cfg: HarnessConfig): string {
  const r = resolveAgentCommand(tool, cfg);
  if ('error' in r) throw new Error(r.error);
  return r.path;
}

export function isEnvFailure(r: ExecResult): boolean {
  if (r.timedOut || r.code === 0) return false;
  return ENV_FAILURE.test((r.stderr + '\n' + r.stdout).slice(-4000));
}

/**
 * runner용 Claude 설정 파일을 만든다. 권한은 main 체크아웃의 .claude/runner-settings.json,
 * 훅은 main 체크아웃의 guard.ts(절대 경로)를 쓴다. worktree 안의 설정을 세션이 고쳐도 다음 세션에 적용되지 않게 하기 위해서다.
 */
export function writeClaudeRunnerSettings(main: RepoInfo, cfg: HarnessConfig): string {
  const profile = path.join(
    main.mainRoot,
    cfg.agents.claude?.permissionProfile ?? '.claude/runner-settings.json',
  );
  if (!existsSync(profile)) throw new Error(`무인 권한 프로필이 없다: ${profile}`);
  const settings = JSON.parse(readFileSync(profile, 'utf8')) as Record<string, unknown>;
  const guard = path.join(main.mainRoot, 'scripts', 'hooks', 'guard.ts');
  settings.hooks = {
    PreToolUse: [
      {
        // PowerShell은 프로필에서 거부하지만 훅도 함께 건다(ADR-0005)
        matcher: 'Bash|PowerShell|Read|Edit|Write|MultiEdit|NotebookEdit|Grep|Glob',
        hooks: [{ type: 'command', command: `node ${JSON.stringify(guard)}`, timeout: 30 }],
      },
    ],
  };
  const out = path.join(harnessStateDir(main, 'common'), 'claude-runner-settings.json');
  writeFileSync(out, JSON.stringify(settings, null, 2));
  return out;
}

export async function runSession(
  tool: AgentTool,
  prompt: string,
  worktree: string,
  main: RepoInfo,
  cfg: HarnessConfig,
  timeoutMs: number,
): Promise<SessionResult> {
  let r: ExecResult;
  const env = { ...process.env, HARNESS_SESSION: '1' };
  if (tool === 'fake') {
    const script = process.env.HARNESS_FAKE_AGENT;
    if (!script) throw new Error('HARNESS_FAKE_AGENT가 없다');
    r = await run(process.execPath, [script], { cwd: worktree, input: prompt, timeoutMs, env });
  } else if (tool === 'claude') {
    const def = cfg.agents.claude;
    if (!def) throw new Error('harness.config.json agents.claude가 없다');
    const settings = writeClaudeRunnerSettings(main, cfg);
    r = await run(agentPath('claude', cfg), [...def.args, '--settings', settings], {
      cwd: worktree,
      input: prompt,
      timeoutMs,
      env,
    });
  } else {
    const def = cfg.agents.codex;
    if (!def) throw new Error('harness.config.json agents.codex가 없다');
    // worktree의 git 메타데이터는 공유 git-dir에 있으므로 쓰기 허용 경로에 넣는다
    const roots = `sandbox_workspace_write.writable_roots=[${JSON.stringify(main.commonDir)}]`;
    r = await run(agentPath('codex', cfg), [...def.args, '-c', roots, '-C', worktree, '-'], {
      cwd: worktree,
      input: prompt,
      timeoutMs,
      env,
    });
  }
  return {
    code: r.code,
    timedOut: r.timedOut,
    durationMs: r.durationMs,
    output: (r.stdout + '\n' + r.stderr).slice(-20000),
    envFailure: isEnvFailure(r),
  };
}
