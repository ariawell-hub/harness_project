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
  guard: {
    dbPatterns: string[];
    dbClients: string[];
    dbCommands: DbCommandRule[];
    mcp: McpGuardConfig;
  };
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
  /** 테스트 실효성 검사(R5, test-effect) 설정. null이면 검사하지 않는다 */
  testEffect: TestEffectConfig | null;
  /**
   * 테스트가 읽지 않는 경로(glob, 리포 루트 기준). 바뀐 파일이 모두 여기에 들면 check가 test를 건너뛴다(6절).
   * 비어 있으면 건너뛰지 않는다. 보호 경로의 파일은 여기에 걸려도 건너뛰는 근거가 아니다
   */
  testInertPaths: string[];
}

export interface TestEffectConfig {
  /** 검사할 테스트 파일 glob(리포 루트 기준) */
  files: string[];
  /** head 판을 함께 덮어쓸 보조 파일 glob(검사 대상은 아니다) */
  support: string[];
  /** 테스트 파일 하나를 실행하는 명령(인자 배열). 끝에 파일 경로가 붙는다 */
  command: string[];
  timeoutSec: number;
  /** head 체크아웃에서 base 체크아웃으로 연결할 경로(예: node_modules) */
  link: string[];
  /** 단언 실패일 때 테스트 출력에 보이는 정규식. 있으면 base에서 실패한 이유를 나눠 표시한다. null이면 나누지 않는다 */
  assertPattern: string | null;
}

/** 리포 안 상대 경로(glob 포함)인가: 비어 있지 않고, `/`로 시작하지 않고, `..` 구간과 `\`가 없다 */
function relPath(x: unknown): boolean {
  return (
    typeof x === 'string' &&
    x !== '' &&
    !x.startsWith('/') &&
    !x.includes('\\') &&
    !/^[A-Za-z]:/.test(x) &&
    !x.split('/').includes('..')
  );
}

function resolveTestEffect(raw: unknown): TestEffectConfig | null {
  if (raw === undefined || raw === null) return null;
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const paths = (v: unknown) => Array.isArray(v) && v.every(relPath);
  const support = r.support ?? [];
  const link = r.link ?? [];
  const assertPattern = r.assertPattern ?? null;
  let okPattern =
    assertPattern === null || (typeof assertPattern === 'string' && assertPattern !== '');
  try {
    if (typeof assertPattern === 'string') new RegExp(assertPattern);
  } catch {
    okPattern = false;
  }
  const ok =
    paths(r.files) &&
    (r.files as unknown[]).length > 0 &&
    paths(support) &&
    paths(link) &&
    okPattern &&
    Array.isArray(r.command) &&
    r.command.length > 0 &&
    r.command.every((x) => typeof x === 'string' && x !== '') &&
    Number.isInteger(r.timeoutSec) &&
    (r.timeoutSec as number) > 0;
  if (!ok)
    throw new ConfigError(
      `${CONFIG_FILE} 검증 실패:\n- testEffect는 null 또는 { files(리포 안 상대 경로 glob 배열, 1개 이상), support·link(리포 안 상대 경로 배열, 생략 가능), command(문자열 배열), timeoutSec(양의 정수), assertPattern(정규식 문자열, 생략 가능) }`,
    );
  return {
    files: r.files as string[],
    support: support as string[],
    command: r.command as string[],
    timeoutSec: r.timeoutSec as number,
    link: link as string[],
    assertPattern: assertPattern as string | null,
  };
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

/** MCP 도구 호출의 L1 규칙(13.1절). 막는 것만 적는다: 그 밖의 MCP 도구는 통과한다 */
export interface McpGuardConfig {
  /** 도구 이름(서버 접두어 뒤)을 `_`·`-`와 대소문자·숫자 경계로 나눈 단어에 이 중 하나가 있으면 삭제 계열로 막는다(R14) */
  denyWords: string[];
  /** 전체 도구 이름 glob. 외부 발송(R14) */
  denyTools: string[];
  /** 위 두 규칙의 예외(전체 도구 이름 glob) */
  allowTools: string[];
  /** 브라우저·데스크톱 자동화 도구(전체 도구 이름 glob). 입력에 denyHosts의 주소가 있으면 막는다(R20) */
  browserTools: string[];
  denyHosts: string[];
}

export const DEFAULT_MCP_GUARD: McpGuardConfig = {
  denyWords: ['delete', 'trash', 'remove', 'destroy', 'purge', 'erase', 'wipe', 'cancel'],
  denyTools: ['mcp__*Gmail__send_message', 'mcp__*Gmail__reply', 'mcp__*Gmail__forward'],
  allowTools: [],
  browserTools: [
    'mcp__claude-in-chrome__*',
    'mcp__playwright__*',
    'mcp__*Browser__*',
    'mcp__computer-use__*',
    'mcp__remote-devices__*',
  ],
  denyHosts: ['github.com', '*.github.com', 'github.dev', '*.github.dev'],
};

/** 도구의 금지 하위 명령(R13). L1 훅이 인자 배열의 자리로 판정한다(scripts/hooks/db-commands.ts) */
export interface DbCommandRule {
  /** 도구 이름(예: `drizzle-kit`) */
  tool: string;
  /** 금지 하위 명령. 낱말이 둘 이상이면 공백으로 나눠 적는다(예: `db push`) */
  forbidden: string[];
}

/** 도구 이름에 허용하는 글자. 이 밖의 글자가 든 이름은 인자의 경로 조각과 같아질 수 없거나(`/`, `@`, 공백) 플래그로 읽힌다(`-`로 시작) */
const DB_TOOL_NAME = /^[a-z0-9][a-z0-9._-]*$/;
/** 도구 자리를 찾을 때 떼고 비교하는 실행 파일 확장자. 이것으로 끝나는 이름은 걸 수 없다 */
const DB_TOOL_EXEC_EXT = /\.(exe|cmd|bat|com)$/;

/**
 * `guard.dbCommands`를 검증해 정규화한다. 키가 없으면 빈 목록이다(옛 설정 파일과 호환). L1 훅도 이 함수로 읽는다.
 * 통과한 규칙은 모두 실제로 걸 수 있다: `[tool, ...금지 항목의 낱말들]`은 반드시 금지로 판정된다.
 * 걸 수 없는 항목을 조용히 받아 주면 오타 하나로 규칙이 꺼진 것을 아무도 모른다.
 */
export function resolveDbCommands(raw: unknown): DbCommandRule[] {
  if (raw === undefined) return [];
  const problems: string[] = [];
  const out: DbCommandRule[] = [];
  if (!Array.isArray(raw)) problems.push('guard.dbCommands는 배열이어야 한다');
  else
    raw.forEach((item: unknown, i) => {
      const at = `guard.dbCommands[${i}]`;
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        problems.push(`${at}는 객체여야 한다({ "tool": …, "forbidden": […] })`);
        return;
      }
      const before = problems.length;
      for (const key of Object.keys(item))
        if (key !== 'tool' && key !== 'forbidden') problems.push(`${at}.${key}는 모르는 키다`);
      const { tool, forbidden } = item as { tool?: unknown; forbidden?: unknown };
      let name = '';
      if (typeof tool !== 'string') problems.push(`${at}.tool은 문자열이어야 한다`);
      else {
        name = tool.trim().toLowerCase();
        if (!DB_TOOL_NAME.test(name))
          problems.push(
            `${at}.tool은 영문 소문자·숫자로 시작하고 영문·숫자·\`.\`·\`_\`·\`-\`만 담아야 한다(경로, 버전, 공백, \`-\`로 시작하는 이름은 걸리지 않는다)`,
          );
        else if (DB_TOOL_EXEC_EXT.test(name))
          problems.push(
            `${at}.tool은 실행 파일 확장자(.exe·.cmd·.bat·.com) 없이 적는다(확장자를 떼고 비교하므로 걸리지 않는다)`,
          );
      }
      const subs: string[] = [];
      if (!Array.isArray(forbidden)) problems.push(`${at}.forbidden은 문자열 배열이어야 한다`);
      else if (forbidden.length === 0) problems.push(`${at}.forbidden이 비어 있다`);
      else
        forbidden.forEach((f: unknown, j) => {
          if (typeof f !== 'string') {
            problems.push(`${at}.forbidden[${j}]은 문자열이어야 한다`);
            return;
          }
          const words = f.toLowerCase().split(/\s+/).filter(Boolean);
          if (words.length === 0) problems.push(`${at}.forbidden[${j}]이 비어 있다`);
          else if (words[0].startsWith('-'))
            problems.push(
              `${at}.forbidden[${j}]의 첫 낱말이 \`-\`로 시작한다(플래그로 읽혀 걸리지 않는다)`,
            );
          else subs.push(words.join(' '));
        });
      if (problems.length === before) out.push({ tool: name, forbidden: subs });
    });
  if (problems.length)
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- ${problems.join('\n- ')}`);
  return out;
}

/** `guard.mcp`를 검증해 기본값을 채운다. 키가 없으면 기본값이다(옛 설정 파일과 호환). L1 훅도 이 함수로 읽는다 */
export function resolveMcpGuard(raw: unknown): McpGuardConfig {
  const out: McpGuardConfig = {
    denyWords: [...DEFAULT_MCP_GUARD.denyWords],
    denyTools: [...DEFAULT_MCP_GUARD.denyTools],
    allowTools: [...DEFAULT_MCP_GUARD.allowTools],
    browserTools: [...DEFAULT_MCP_GUARD.browserTools],
    denyHosts: [...DEFAULT_MCP_GUARD.denyHosts],
  };
  if (raw === undefined) return out;
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    problems.push('guard.mcp는 객체여야 한다');
  else
    for (const [key, value] of Object.entries(raw)) {
      if (!Object.hasOwn(out, key)) problems.push(`guard.mcp.${key}는 모르는 키다`);
      else if (!(Array.isArray(value) && value.every((x) => typeof x === 'string' && x !== '')))
        problems.push(`guard.mcp.${key}는 문자열 배열이어야 한다(빈 문자열 없이)`);
      else out[key as keyof McpGuardConfig] = value;
    }
  if (problems.length)
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- ${problems.join('\n- ')}`);
  return out;
}

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
  // 작업자 수(4.5절 운영, Q19): `run`을 --worker 없이 실행하면 이만큼 작업자 프로세스를 띄운다. 없으면 1
  if (cfg.limits.workers === undefined) cfg.limits.workers = 1;
  if (!(Number.isInteger(cfg.limits.workers) && cfg.limits.workers >= 1))
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- limits.workers는 1 이상의 정수(작업자 수)`);
  if (!(typeof cfg.limits.ciStallHours === 'number' && cfg.limits.ciStallHours > 0))
    throw new ConfigError(`${CONFIG_FILE} 검증 실패:\n- limits.ciStallHours는 양수(시간)`);
  cfg.github.botIssues ??= 'exclude'; // 제작자가 고르기 전에는 fail-closed(14.6절)
  cfg.agents ??= {};
  cfg.riskPaths ??= [];
  cfg.protectedPaths ??= [];
  cfg.planReview ??= { required: false };
  cfg.guard.mcp = resolveMcpGuard(cfg.guard.mcp);
  cfg.guard.dbCommands = resolveDbCommands(cfg.guard.dbCommands);
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
  cfg.testEffect = resolveTestEffect(cfg.testEffect);
  cfg.testInertPaths ??= [];
  const inert: unknown = cfg.testInertPaths;
  const okGlob = (g: unknown) =>
    typeof g === 'string' &&
    g !== '' &&
    !g.includes('\\') &&
    !path.posix.isAbsolute(g) &&
    !/^[A-Za-z]:/.test(g) &&
    !g.split('/').includes('..');
  if (!Array.isArray(inert) || !inert.every(okGlob))
    throw new ConfigError(
      `${CONFIG_FILE} 검증 실패:\n- testInertPaths는 리포 안 상대 경로 glob의 배열(\`/\`로 구분, \`..\` 없음). 테스트가 읽지 않는 경로만 적는다(6절)`,
    );
  return cfg;
}

/** `{repo}`와 `~`를 치환해 절대 경로로 만든다. 상대 경로는 메인 체크아웃 기준이다 */
export function resolveConfigPath(template: string, mainRoot: string): string {
  const repo = path.basename(mainRoot);
  let p = template.replaceAll('{repo}', repo);
  if (p.startsWith('~')) p = path.join(homedir(), p.slice(1));
  return path.resolve(mainRoot, p);
}
