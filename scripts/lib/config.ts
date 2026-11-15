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
    /** 같은 PR head에서 CI 대기·판정 없음이 이 시간을 넘으면 needs-human으로 알린다(4.5절). 없으면 24 */
    ciStallHours: number;
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
  ci: {
    environments: string[];
    /** main에 등록되어 있어야 하는 필수 체크와 출처(0.2절). actions = GitHub Actions, recorder = 검증 App */
    requiredChecks: { context: string; source: 'actions' | 'recorder' }[];
    /** 검증 App ID(제작자가 알려 준 값). 없으면 출처를 확인할 수 없다 */
    recorderAppId: number | null;
    /** 검증 App 봇의 login(예: `harness-recorder[bot]`). 승인 이어받기에서 상태의 작성자를 확인한다(10.3절) */
    recorderBot: string | null;
    /** 재현 job 설정(10.2절 (3)). null이면 재현 테스트를 실행하지 않는다 */
    repro: {
      /** 재현 테스트를 둘 폴더(리포 루트 기준) */
      dir: string;
      /** 테스트 하나를 실행하는 명령. 끝에 파일 경로가 붙는다 */
      command: string[];
      /** 실패 출력에 이 정규식이 보여야 재현으로 본다(단언 실패) */
      failPattern: string;
      timeoutSec: number;
    } | null;
  };
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
  cfg.limits.ciStallHours ??= 24;
  if (!(typeof cfg.limits.ciStallHours === 'number' && cfg.limits.ciStallHours > 0))
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- limits.ciStallHours는 양수(시간)`);
  cfg.github.botIssues ??= 'exclude'; // 제작자가 고르기 전에는 fail-closed(14.6절)
  cfg.agents ??= {};
  cfg.riskPaths ??= [];
  cfg.protectedPaths ??= [];
  cfg.planReview ??= { required: false };
  const ci: Partial<HarnessConfig['ci']> = cfg.ci ?? {};
  cfg.ci = {
    environments: ci.environments ?? [...DEFAULT_ENVIRONMENTS],
    requiredChecks: ci.requiredChecks ?? [],
    recorderAppId: ci.recorderAppId ?? null,
    recorderBot: ci.recorderBot ?? null,
    repro: ci.repro ?? null,
  };
  if (cfg.ci.repro !== null) {
    const r = cfg.ci.repro as Record<string, unknown>;
    const okDir = typeof r.dir === 'string' && /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(r.dir);
    const okCmd =
      Array.isArray(r.command) &&
      r.command.length > 0 &&
      r.command.every((x) => typeof x === 'string' && x !== '');
    let okPattern = typeof r.failPattern === 'string' && r.failPattern !== '';
    try {
      if (okPattern) new RegExp(r.failPattern as string);
    } catch {
      okPattern = false;
    }
    const okTimeout = Number.isInteger(r.timeoutSec) && (r.timeoutSec as number) > 0;
    if (!okDir || !okCmd || !okPattern || !okTimeout || (r.dir as string).split('/').includes('..'))
      throw new ConfigError(
        `${CONFIG_FILE} 검증 실패:\n- ci.repro는 { dir(리포 안 상대 경로), command(문자열 배열), failPattern(정규식), timeoutSec(양의 정수) }`,
      );
  }
  if (cfg.ci.recorderBot !== null && typeof cfg.ci.recorderBot !== 'string')
    throw new ConfigError(
      `${CONFIG_FILE} 검증 실패:\n- ci.recorderBot은 문자열(검증 App 봇의 login)`,
    );
  for (const c of cfg.ci.requiredChecks) {
    if (typeof c?.context !== 'string' || (c.source !== 'actions' && c.source !== 'recorder'))
      throw new ConfigError(
        `${CONFIG_FILE} 검증 실패:\n- ci.requiredChecks 항목은 { context, source: actions | recorder }`,
      );
  }
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
