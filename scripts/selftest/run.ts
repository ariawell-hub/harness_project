// 하네스 자체 테스트 실행기(설계서 12.4절). 대상 하네스를 임시 샘플 리포에 적용하고,
// 시나리오가 그 CLI와 L1 훅을 프로세스로 불러 규칙이 실제로 막는지 확인한다.
// 실행기와 시나리오는 대상 하네스의 내부 모듈을 import하지 않는다. 다른 버전의 하네스(PR의 하네스)를
// 시험할 수 있어야 하기 때문이다. 기대는 것은 CLI·훅의 입출력과 가짜 GitHub 상태 파일 형식뿐이다.
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** 대상 하네스를 적용한 임시 샘플 리포 */
export interface Sample {
  /** main 체크아웃 */
  root: string;
  /** 로컬 bare 원격(origin) */
  remote: string;
  /** 가짜 GitHub 상태 파일(자식 프로세스에 HARNESS_FAKE_GH로 넘어간다) */
  ghState: string;
  /** 설정의 제작자·봇 계정 */
  owner: string;
  bot: string;
  /** git을 실행하고 stdout을 돌려준다. 실패하면 예외다. cwd 기본값은 main 체크아웃 */
  git(args: string[], cwd?: string): string;
  /** 파일을 쓴다(폴더도 만든다). cwd 기본값은 main 체크아웃 */
  write(rel: string, content: string, cwd?: string): void;
  /** 가짜 GitHub에 열린 Issue를 더하고 번호를 돌려준다. author 기본값은 제작자 */
  issue(title: string, o?: { author?: string; body?: string; labels?: string[] }): number;
  /** 가짜 에이전트가 받은 프롬프트(받은 순서). ctx.agent를 부른 뒤에만 쌓인다 */
  prompts(): { slug: string; step: string; prompt: string }[];
}

export interface Scenario {
  /** 파일 이름과 같은 kebab-case id. 예) r20-owner-commands */
  id: string;
  /** 12.4절의 어느 항목인가. 예) 'R20' */
  covers: string;
  title: string;
  /** 이 시나리오가 쓸 수 있는 시간(초). 기본 120, runner를 띄우는 시나리오는 300 */
  timeoutSec?: number;
  run(ctx: ScenarioContext): Promise<void> | void; // 어긋나면 예외(assert)
}

export interface ScenarioContext {
  /** 시험 대상 하네스의 루트(절대 경로) */
  harness: string;
  /** 대상 하네스를 적용한 임시 샘플 리포(main 체크아웃 + 로컬 bare 원격 + 가짜 GitHub 상태 파일)를 새로 만든다 */
  sample(o?: { config?: Record<string, unknown> }): Sample;
  /** 대상 하네스의 CLI를 샘플 리포에서 실행한다. 종료 코드·stdout·stderr를 돌려준다(예외를 던지지 않는다) */
  cli(s: Sample, args: string[], o?: { cwd?: string; env?: NodeJS.ProcessEnv }): Ran;
  /** 대상 하네스의 L1 훅(scripts/hooks/guard.ts)에 도구 호출 JSON을 stdin으로 넣는다 */
  hook(s: Sample, payload: Record<string, unknown>, o?: { cwd?: string }): Ran;
  /** 샘플 리포의 에이전트 설정을 실행기 쪽 가짜 에이전트로 바꾼다. script는 가짜 에이전트의 동작 지정(기존 형식 그대로) */
  agent(s: Sample, script: Record<string, unknown>): void;
  /** 가짜 GitHub 상태 파일을 읽고 고친다(Issue·PR·체크·댓글) */
  github(s: Sample): { read(): unknown; update(fn: (state: any) => void): void };
  /**
   * 읽기 전용 GitHub REST 응답을 흉내 내는 로컬 서버를 띄운다(대상 하네스의 CI 명령이 GITHUB_API_URL로 조회한다).
   * routes는 경로(쿼리 제외, 앞 `/` 없음) → JSON 응답이다. 없는 경로와 GET이 아닌 요청은 404다.
   * 시나리오가 끝나면 실행기가 끈다
   */
  api(
    s: Sample,
    routes: Record<string, unknown>,
  ): Promise<{ url: string; set(routes: Record<string, unknown>): void; hits(): string[] }>;
}

export interface SelfTestReport {
  version: 1;
  /** --head-sha로 받은 값(없으면 '') */
  headSha: string;
  results: { id: string; covers: string; state: 'pass' | 'fail' | 'error'; detail: string }[];
}

/** 시나리오 하나가 쓸 수 있는 시간의 기본값(초). 자식 프로세스의 시간 제한은 남은 시간이다 */
const SCENARIO_TIMEOUT_SEC = 120;
const DETAIL_MAX = 500;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.join(HERE, 'scenarios');
/** 가짜 에이전트와 API 서버는 대상 하네스의 것이 아니라 실행기 쪽 파일을 쓴다 */
const FAKE_AGENT = path.join(HERE, 'fake-agent.ts');
const API_STUB = path.join(HERE, 'api-stub.ts');

/** 자식 프로세스에 넘기는 환경 변수. 세션의 자격증명(GH_TOKEN 등)과 홈 폴더는 넘기지 않는다 */
const ENV_KEEP = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
]);

/** 샘플 리포에 복사하는 대상 하네스의 파일·폴더(없으면 건너뛴다) */
const COPY = [
  'scripts',
  '.claude',
  '.github/CODEOWNERS',
  '.gitattributes',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/exec-plans/TEMPLATE.md',
  'docs/exec-plans/TEMPLATE-small.md',
  'docs/exec-plans/TEMPLATE-step.md',
  'docs/exec-plans/tech-debt-tracker.md',
  'docs/harness/workflow.md',
];

function exec(
  cmd: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; input?: string; deadline: number },
): Ran {
  const left = o.deadline - Date.now();
  const timeout = () =>
    new Error(`시나리오 시간 제한을 넘겼다: ${cmd} ${args.slice(0, 2).join(' ')}`);
  if (left <= 0) throw timeout();
  const r = spawnSync(cmd, args, {
    cwd: o.cwd,
    env: o.env,
    input: o.input,
    encoding: 'utf8',
    timeout: left,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw timeout();
  return {
    code: r.status ?? (r.error ? 127 : 1),
    stdout: r.stdout ?? '',
    stderr: (r.stderr ?? '') + (r.error ? `\n${r.error.message}` : ''),
  };
}

function makeSample(
  harness: string,
  over: Record<string, unknown>,
  deadline: number,
): { sample: Sample; env: NodeJS.ProcessEnv } {
  // 임시 폴더는 지우지 않는다(R14). 실패했을 때 그대로 들여다볼 수 있다
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'harness-selftest-')));
  const root = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  const home = path.join(dir, 'home');
  const ghState = path.join(dir, 'github.json');
  mkdirSync(root);
  mkdirSync(home);
  const gitConfig = path.join(home, 'gitconfig');
  writeFileSync(
    gitConfig,
    '[user]\n\tname = selftest\n\temail = selftest@example.invalid\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n',
  );
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ENV_KEEP.has(k.toUpperCase())) env[k] = v;
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HARNESS_FAKE_GH: ghState,
  });

  const git = (args: string[], cwd = root): string => {
    const r = exec('git', args, { cwd, env, deadline });
    if (r.code !== 0) throw new Error(`git ${args.join(' ')} 실패(${cwd}): ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const write = (rel: string, content: string, cwd = root): void => {
    const f = path.join(cwd, rel);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, content);
  };

  for (const rel of COPY) {
    const from = path.join(harness, rel);
    if (!existsSync(from)) continue;
    cpSync(from, path.join(root, rel), {
      recursive: true,
      // 사용자별 로컬 설정(settings.local.json 등)은 복사하지 않는다
      filter: (src) => !/\.local\./.test(path.basename(src)),
    });
  }
  const cfg = {
    ...(JSON.parse(readFileSync(path.join(harness, 'harness.config.json'), 'utf8')) as Record<
      string,
      unknown
    >),
    ...over,
  };
  const gh = (cfg.github ?? {}) as { owner?: string; bot?: string };
  const owner = gh.owner || 'maker';
  const bot = gh.bot || 'harness-bot';
  write('harness.config.json', JSON.stringify(cfg, null, 2) + '\n');
  write('.gitignore', '.env\n.env.*\n!.env.example\nnode_modules/\n');
  write('docs/exec-plans/active/.gitkeep', '');
  write('docs/exec-plans/completed/.gitkeep', '');

  git(['init', '-q', '--bare', '-b', 'main', remote], dir);
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'init']);
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-q', '-u', 'origin', 'main']);

  // 가짜 GitHub 상태 파일(대상 하네스의 scripts/lib/github-fake.ts가 읽는 형식)
  writeFileSync(
    ghState,
    JSON.stringify(
      { me: bot, owner, remote, mergeMode: 'immediate', next: 1, issues: [], prs: [] },
      null,
      2,
    ),
  );
  const t0 = Date.now() - 3_600_000;
  // 상태 파일은 대상 하네스의 명령도 고친다(PR, 댓글). 고칠 때마다 파일에서 다시 읽는다
  const issue: Sample['issue'] = (title, o = {}) => {
    const state = JSON.parse(readFileSync(ghState, 'utf8')) as {
      next: number;
      issues: unknown[];
    };
    const number = state.next++;
    state.issues.push({
      number,
      title,
      body: o.body ?? '',
      labels: o.labels ?? [],
      state: 'open',
      createdAt: new Date(t0 + number * 1000).toISOString(),
      author: o.author ?? owner,
      comments: [],
    });
    writeFileSync(ghState, JSON.stringify(state, null, 2));
    return number;
  };
  const promptLog = path.join(dir, 'prompts.jsonl');
  const prompts: Sample['prompts'] = () =>
    existsSync(promptLog)
      ? readFileSync(promptLog, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as { slug: string; step: string; prompt: string })
      : [];
  return { sample: { root, remote, ghState, owner, bot, git, write, issue, prompts }, env };
}

/**
 * runner를 띄우는 시나리오의 설정: 대상 하네스의 설정에서 표준 명령을 끄고(샘플 리포에는 의존성이 없다)
 * 세션·AC 시간 제한과 대기를 줄인다. 대상의 설정에서 만들므로 그 하네스가 더한 항목이 빠지지 않는다.
 * 샘플 리포에는 대상 하네스의 문서가 일부만 있어, 복사한 문서(AGENTS.md 등)는 doc-lint에서 뺀다
 * (링크 대상이 없다). runner가 만드는 계획 폴더는 그대로 검사한다
 */
export function runnerConfig(
  harness: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const cfg = JSON.parse(readFileSync(path.join(harness, 'harness.config.json'), 'utf8')) as {
    commands?: Record<string, unknown>;
    limits?: Record<string, unknown>;
    docLint?: { exclude?: string[] };
  };
  return {
    commands: Object.fromEntries(Object.keys(cfg.commands ?? {}).map((k) => [k, null])),
    docLint: {
      ...cfg.docLint,
      exclude: [...(cfg.docLint?.exclude ?? []), 'AGENTS.md', 'CLAUDE.md', 'docs/harness/**'],
    },
    ...over,
    limits: {
      ...cfg.limits,
      sessionTimeoutMin: 1,
      acTimeoutSec: 60,
      workers: 1,
      pollSec: 0,
      ...(over.limits as Record<string, unknown> | undefined),
    },
  };
}

/** API 서버가 포트를 알릴 때까지 기다리는 시간 */
const API_START_MS = 15_000;

function context(harness: string, deadline: number): { ctx: ScenarioContext; close(): void } {
  const envs = new Map<Sample, NodeJS.ProcessEnv>();
  const envOf = (s: Sample): NodeJS.ProcessEnv => {
    const e = envs.get(s);
    if (!e) throw new Error('이 ctx.sample()이 만든 샘플이 아니다');
    return e;
  };
  const servers: ChildProcess[] = [];
  const ctx: ScenarioContext = {
    harness,
    agent(s, script) {
      const dir = path.dirname(s.ghState);
      const behavior = path.join(dir, 'behavior.json');
      // 가짜 에이전트는 동작을 하나 쓸 때마다 이 파일을 고쳐 쓴다
      writeFileSync(behavior, JSON.stringify(script));
      Object.assign(envOf(s), {
        HARNESS_FAKE_AGENT: FAKE_AGENT,
        FAKE_BEHAVIOR: behavior,
        FAKE_LOG: path.join(dir, 'prompts.jsonl'),
      });
    },
    github(s) {
      envOf(s);
      const read = () => JSON.parse(readFileSync(s.ghState, 'utf8')) as unknown;
      return {
        read,
        update(fn) {
          const state = read();
          fn(state);
          writeFileSync(s.ghState, JSON.stringify(state, null, 2));
        },
      };
    },
    async api(s, routes) {
      const dir = path.dirname(s.ghState);
      const n = servers.length;
      const routesFile = path.join(dir, `api-${n}.json`);
      const logFile = path.join(dir, `api-${n}.log`);
      const set = (r: Record<string, unknown>) => writeFileSync(routesFile, JSON.stringify(r));
      set(routes);
      writeFileSync(logFile, '');
      const child = spawn(process.execPath, [API_STUB, routesFile, logFile], {
        env: envOf(s),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      servers.push(child);
      const port = await new Promise<number>((resolve, reject) => {
        const wait = Math.min(API_START_MS, Math.max(0, deadline - Date.now()));
        const timer = setTimeout(() => reject(new Error('API 서버가 뜨지 않았다')), wait);
        const fail = (why: string) => {
          clearTimeout(timer);
          reject(new Error(`API 서버가 뜨지 않았다: ${why}`));
        };
        child.once('error', (e) => fail(e.message));
        child.once('exit', (code) => fail(`종료 코드 ${code}`));
        child.stdout!.once('data', (d: Buffer) => {
          clearTimeout(timer);
          resolve(Number(String(d).trim()));
        });
      });
      if (!Number.isInteger(port) || port <= 0) throw new Error('API 서버의 포트를 읽지 못했다');
      return {
        url: `http://127.0.0.1:${port}`,
        set,
        hits: () => readFileSync(logFile, 'utf8').split('\n').filter(Boolean),
      };
    },
    sample(o = {}) {
      const { sample, env } = makeSample(harness, o.config ?? {}, deadline);
      envs.set(sample, env);
      return sample;
    },
    cli(s, args, o = {}) {
      return exec(process.execPath, ['scripts/harness.ts', ...args], {
        cwd: o.cwd ?? s.root,
        env: { ...envOf(s), ...o.env },
        deadline,
      });
    },
    hook(s, payload, o = {}) {
      const cwd = o.cwd ?? s.root;
      return exec(process.execPath, [path.join(s.root, 'scripts/hooks/guard.ts')], {
        cwd,
        env: envOf(s),
        input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, ...payload }),
        deadline,
      });
    },
  };
  return {
    ctx,
    close() {
      for (const c of servers) c.kill();
    },
  };
}

/** 훅이 차단했는가: 종료 코드가 정확히 2이고 stderr에 규칙이 있다(1은 경고만 하고 통과시킨다, 13.1절) */
export function assertBlocked(r: Ran, rule: RegExp, what: string): void {
  assert.equal(r.code, 2, `${what}: 훅 종료 코드가 2가 아니다(${r.code}). ${r.stderr.trim()}`);
  assert.match(r.stderr, rule, `${what}: 차단 사유에 ${rule}가 없다`);
}

/** 대조군: 막히지 않아야 하는 것이 통과하는가 */
export function assertAllowed(r: Ran, what: string): void {
  assert.equal(r.code, 0, `${what}: 종료 코드가 0이 아니다(${r.code}). ${r.stderr.trim()}`);
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);

async function load(file: string): Promise<Scenario> {
  const id = path.basename(file, '.ts');
  const mod = (await import(pathToFileURL(file).href)) as { default?: Partial<Scenario> };
  const s = mod.default;
  if (!s || typeof s.run !== 'function' || !s.covers || !s.title)
    throw new Error('default export가 Scenario(id, covers, title, run)가 아니다');
  if (s.id !== id) throw new Error(`id(${s.id})가 파일 이름(${id})과 다르다`);
  return s as Scenario;
}

export async function runSelfTest(o: {
  harness: string;
  only?: string[];
  headSha?: string;
  /** 시나리오 폴더(기본: 실행기 옆의 scenarios/). 실행기 테스트가 쓴다 */
  scenarioDir?: string;
}): Promise<SelfTestReport> {
  const harness = path.resolve(o.harness);
  const dir = o.scenarioDir ?? SCENARIO_DIR;
  // 목록 파일을 두지 않는다: 폴더의 *.ts를 이름순으로 읽는다
  let ids = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.basename(f, '.ts'))
    .sort();
  if (o.only) {
    const unknown = o.only.filter((x) => !ids.includes(x));
    // 없는 id를 조용히 건너뛰면 "0개 실행, 통과"가 된다
    if (unknown.length) throw new Error(`없는 시나리오: ${unknown.join(', ')}`);
    ids = ids.filter((x) => o.only!.includes(x));
  }
  if (!ids.length) throw new Error(`실행할 시나리오가 없다(${dir})`);

  const results: SelfTestReport['results'] = [];
  for (const id of ids) {
    let covers = '';
    let close = () => {};
    try {
      const s = await load(path.join(dir, `${id}.ts`));
      covers = s.covers;
      const c = context(harness, Date.now() + (s.timeoutSec ?? SCENARIO_TIMEOUT_SEC) * 1000);
      close = c.close;
      await s.run(c.ctx);
      results.push({ id, covers, state: 'pass', detail: s.title });
    } catch (e) {
      const state = e instanceof assert.AssertionError ? 'fail' : 'error';
      results.push({ id, covers, state, detail: oneLine((e as Error)?.message ?? String(e)) });
    } finally {
      close();
    }
  }
  return { version: 1, headSha: o.headSha ?? '', results };
}

/** 시나리오별 한 줄. 예) `✓ r20-owner-commands (R20) — …` */
export function formatSelfTest(r: SelfTestReport): string[] {
  return r.results.map(
    (x) => `${x.state === 'pass' ? '✓' : '✗'} ${x.id} (${x.covers || '?'}) — ${x.detail}`,
  );
}
