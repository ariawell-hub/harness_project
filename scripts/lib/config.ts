// harness.config.json 로드와 검증. 이 파일(설정)은 보호 경로다.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CommandDef {
  run: string;
  check?: string;
  timeoutSec: number;
}

export type StandardName = 'setup' | 'fmt' | 'lint' | 'test' | 'build' | 'dev' | 'verify';
export const STANDARD_COMMANDS: StandardName[] = [
  'setup',
  'fmt',
  'lint',
  'test',
  'build',
  'dev',
  'verify',
];

export interface AgentDef {
  cmd: string;
  args: string[];
  permissionProfile?: string;
}

export type BotIssuesMode = 'exclude' | 'owner-approved';
export const BOT_ISSUES_MODES: BotIssuesMode[] = ['exclude', 'owner-approved'];

export interface HarnessConfig {
  version: number;
  stage: 'build' | 'operation';
  profile: string;
  profileVersion: string;
  github: {
    remote: string;
    defaultBranch: string;
    owner: string;
    bot: string;
    /** 외주 개발자 계정(14.6절). 이 계정이 만든 Issue도 runner 작업 후보가 된다 */
    collaborators: string[];
    /**
     * 봇 계정이 만든 Issue 처리(14.6절). `exclude`(기본)는 runner 후보에서 뺀다.
     * `owner-approved`는 제작자 계정이 `/harness accept` 한 줄 댓글을 단 봇 Issue만 후보로 삼는다
     */
    botIssues: BotIssuesMode;
    priorityLabels: string[];
    needsHumanLabel: string;
  };
  paths: { worktreeRoot: string; devEnvFile: string };
  limits: {
    sessionTimeoutMin: number;
    acTimeoutSec: number;
    stepFailedCheckLimit: number;
    stepSessionMinutesLimit: number;
    runnerMaxHours: number;
    workers: number;
    wipPerWorker: number;
    claimExpiryHours: number;
    usageLimitMaxWaitMin: number;
    pollSec: number;
  };
  failure: { switchAt: number; stopAt: number };
  commands: Record<StandardName, CommandDef | null>;
  docLint: { agentsMdMaxLines: number; exclude: string[] };
  bypass: { extraPatterns: string[]; excludeExtensions: string[] };
  guard: { dbPatterns: string[]; dbClients: string[] };
  planReview: { required: boolean };
  riskPaths: { glob: string; risk: 'low' | 'normal' | 'high' }[];
  protectedPaths: string[];
  /** CI 판정 기준. environments: 워크플로가 참조해도 되는 역할별 environment(10.4절) */
  ci: { environments: string[] };
  /** 의존성 통제 기준(R17, Q14). deps-guard가 쓴다 */
  deps: {
    lockfiles: string[];
    minReleaseAgeDays: number;
    licenses: string[];
    registry: string;
    osvApi: string;
  };
  agents: Record<string, AgentDef>;
}

/** 역할별 environment(10.4절). 이 밖의 이름을 참조하는 워크플로는 harness-guard가 표시한다 */
export const DEFAULT_ENVIRONMENTS = [
  'judge-claude',
  'judge-codex',
  'codex-auth-store',
  'recorder',
  'revert',
];

/** 의존성 기준 기본값(Q14: 게시 후 14일, 허용 라이선스. ISC는 제작자 결정 2026-11-14) */
export const DEFAULT_DEPS: HarnessConfig['deps'] = {
  lockfiles: ['pnpm-lock.yaml'],
  minReleaseAgeDays: 14,
  licenses: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'ISC'],
  registry: 'https://registry.npmjs.org',
  osvApi: 'https://api.osv.dev/v1/querybatch',
};

export const CONFIG_FILE = 'harness.config.json';

export class ConfigError extends Error {}

export function loadConfig(repoRoot: string): HarnessConfig {
  const file = path.join(repoRoot, CONFIG_FILE);
  if (!existsSync(file)) {
    throw new ConfigError(
      `${CONFIG_FILE}이 없다: ${file}\n고치는 법: 하네스 템플릿을 복사한 리포의 루트에서 실행하라. 문서: docs/harness/workflow.md`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILE} JSON 파싱 실패: ${(e as Error).message}`);
  }
  const cfg = raw as HarnessConfig;
  const problems: string[] = [];
  if (cfg.stage !== 'build' && cfg.stage !== 'operation')
    problems.push('stage는 build | operation');
  if (!cfg.commands) problems.push('commands가 없다');
  else {
    for (const name of STANDARD_COMMANDS) {
      const c = cfg.commands[name];
      if (c === undefined) problems.push(`commands.${name}이 없다 (해당 없으면 null)`);
      else if (c !== null && (typeof c.run !== 'string' || !(c.timeoutSec > 0)))
        problems.push(`commands.${name}에는 run(문자열)과 timeoutSec(양수)이 필요하다`);
    }
  }
  for (const key of [
    'github',
    'paths',
    'limits',
    'failure',
    'docLint',
    'bypass',
    'guard',
  ] as const) {
    if (!cfg[key]) problems.push(`${key} 항목이 없다`);
  }
  const collaborators: unknown = cfg.github?.collaborators;
  if (
    collaborators !== undefined &&
    !(Array.isArray(collaborators) && collaborators.every((c) => typeof c === 'string'))
  )
    problems.push('github.collaborators는 계정 이름 문자열 배열이어야 한다');
  const botIssues: unknown = cfg.github?.botIssues;
  if (botIssues !== undefined && !BOT_ISSUES_MODES.some((m) => m === botIssues))
    problems.push('github.botIssues는 exclude | owner-approved');
  if (problems.length) {
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- ${problems.join('\n- ')}`);
  }
  cfg.github.collaborators ??= [];
  cfg.github.botIssues ??= 'exclude'; // 제작자가 고르기 전에는 fail-closed(14.6절)
  cfg.agents ??= {};
  cfg.riskPaths ??= [];
  cfg.protectedPaths ??= [];
  cfg.planReview ??= { required: false };
  cfg.ci ??= { environments: [...DEFAULT_ENVIRONMENTS] };
  cfg.ci.environments ??= [...DEFAULT_ENVIRONMENTS];
  cfg.deps = { ...DEFAULT_DEPS, ...(cfg.deps ?? {}) };
  return cfg;
}

/** `{repo}`와 `~`를 치환해 절대 경로로 만든다. 상대 경로는 메인 체크아웃 기준이다 */
export function resolveConfigPath(template: string, mainRoot: string): string {
  const repo = path.basename(mainRoot);
  let p = template.replaceAll('{repo}', repo);
  if (p.startsWith('~')) p = path.join(homedir(), p.slice(1));
  return path.resolve(mainRoot, p);
}
