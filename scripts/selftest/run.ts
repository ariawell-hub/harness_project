// 하네스 자체 테스트 실행기(설계서 12.4절). 대상 하네스를 임시 샘플 리포에 적용하고,
// 시나리오가 그 CLI와 L1 훅을 프로세스로 불러 규칙이 실제로 막는지 확인한다.
// 실행기와 시나리오는 대상 하네스의 내부 모듈을 import하지 않는다. 다른 버전의 하네스(PR의 하네스)를
// 시험할 수 있어야 하기 때문이다. 기대는 것은 CLI·훅의 입출력과 가짜 GitHub 상태 파일 형식뿐이다.
// 시나리오의 도구가 spawnSync로 기다리므로 나란히 돌릴 때는 시나리오마다 자식 프로세스(child.ts)를 띄운다.
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
import { availableParallelism, tmpdir } from 'node:os';
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

/**
 * 시나리오 하나가 쓸 도구 묶음. 실제 세션 실행기(live.ts)도 쓴다.
 * envOf는 샘플 리포의 자식 프로세스 환경이다(그 ctx.sample()이 만든 샘플만)
 */
export function context(
  harness: string,
  deadline: number,
): { ctx: ScenarioContext; close(): void; envOf(s: Sample): NodeJS.ProcessEnv } {
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
    envOf,
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

type Result = SelfTestReport['results'][number];

/**
 * 시나리오 하나를 이 프로세스에서 돌린다. 차례로 돌 때, 나란히 돌다 실패해 다시 돌릴 때,
 * 자식 프로세스(child.ts) 안에서 같은 함수를 쓴다. 시간 제한은 시나리오가 시작한 때부터 잰다
 */
export async function runScenario(harness: string, file: string): Promise<Result> {
  const id = path.basename(file, '.ts');
  let covers = '';
  let close = () => {};
  try {
    const s = await load(file);
    covers = s.covers;
    const c = context(harness, Date.now() + (s.timeoutSec ?? SCENARIO_TIMEOUT_SEC) * 1000);
    close = c.close;
    await s.run(c.ctx);
    return { id, covers, state: 'pass', detail: s.title };
  } catch (e) {
    const state = e instanceof assert.AssertionError ? 'fail' : 'error';
    return { id, covers, state, detail: oneLine((e as Error)?.message ?? String(e)) };
  } finally {
    close();
  }
}

/** 시나리오 하나를 돌리는 자식 프로세스의 진입점(실행기 쪽 파일) */
const CHILD = path.join(HERE, 'child.ts');
/** 자식 프로세스의 마지막 시간 제한: 시나리오의 시간 제한에 더하는 여유(기본). 시나리오 안의 제한이 듣지 않을 때만 쓴다 */
const CHILD_GRACE_SEC = 30;
/** 결과 없이 끝난 자식의 stderr에서 detail에 남기는 끝부분 */
const STDERR_KEEP = 2000;

/** 자식이 쓴 결과 파일을 읽는다. 없거나 형식이 틀리거나 다른 시나리오의 것이면 null */
function readResult(file: string, id: string): Result | null {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8')) as Partial<Result>;
    if (
      r.id === id &&
      typeof r.covers === 'string' &&
      typeof r.detail === 'string' &&
      (r.state === 'pass' || r.state === 'fail' || r.state === 'error')
    )
      return { id, covers: r.covers, state: r.state, detail: r.detail };
  } catch {
    // 파일이 없거나 JSON이 아니다
  }
  return null;
}

/** 자손을 찾아 멈추기를 되풀이하는 최대 횟수 */
const FREEZE_ROUNDS = 10;

/** pid와 그 자손(부모 pid로 찾는다. 새 세션·그룹으로 띄운 것도 포함). ps를 읽지 못하면 pid만 */
function descendants(pid: number): number[] {
  const r = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  const children = new Map<number, number[]>();
  for (const line of (r.stdout ?? '').split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(p) || !Number.isInteger(pp)) continue;
    children.set(pp, [...(children.get(pp) ?? []), p]);
  }
  const out: number[] = [];
  const todo = [pid];
  while (todo.length) {
    const p = todo.pop()!;
    if (out.includes(p)) continue;
    out.push(p);
    todo.push(...(children.get(p) ?? []));
  }
  return out;
}

/**
 * 자식과 그 아래 프로세스를 모두 끝낸다. 대상 하네스의 runner는 에이전트 세션을 새 세션으로 띄우므로
 * 프로세스 그룹이 아니라 부모 pid로 자손을 찾는다. POSIX는 찾은 것을 SIGSTOP으로 멈추고(그 사이 새로 띄우거나
 * 부모가 끝나 고아가 되어 빠지지 않게) 새로 보이는 것이 없을 때까지 되풀이한 뒤 모두 SIGKILL한다.
 * Windows는 taskkill /T가 프로세스 트리를 끝낸다
 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  const stopped = new Set<number>();
  for (let i = 0; i < FREEZE_ROUNDS; i++) {
    const fresh = descendants(child.pid).filter((p) => !stopped.has(p));
    if (!fresh.length) break;
    for (const p of fresh) {
      stopped.add(p);
      try {
        process.kill(p, 'SIGSTOP');
      } catch {
        // 이미 끝났다
      }
    }
  }
  for (const p of stopped) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      // 이미 끝났다
    }
  }
  child.kill('SIGKILL');
}

/**
 * 자식 프로세스 한 번의 끝: 결과 파일이 있음(result), 시간 제한으로 끝냄(killed),
 * 결과 파일 없이 스스로 끝남(noresult, 띄우지 못한 경우 포함). killed와 noresult의 결과는 error다
 */
type ChildEnd = { result: Result; ended: 'result' | 'killed' | 'noresult' };

/**
 * 시나리오 하나를 자식 프로세스로 돌린다. 자식을 띄운 때부터 시나리오의 시간 제한 + graceSec 안에
 * 끝나지 않으면 자식과 그 아래 프로세스를 모두 끝낸다(대기열에서 기다린 시간은 셈하지 않는다)
 */
function runChild(
  harness: string,
  file: string,
  timeoutSec: number,
  graceSec: number,
  out: string,
): Promise<ChildEnd> {
  const id = path.basename(file, '.ts');
  const error = (detail: string): Result => ({
    id,
    covers: '',
    state: 'error',
    detail: oneLine(detail),
  });
  return new Promise((resolve) => {
    let settled = false;
    let closeWait: NodeJS.Timeout | undefined;
    const settle = (e: ChildEnd) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(closeWait);
      // 남은 프로세스가 파이프를 쥐고 있어도 실행기가 그 파이프를 기다리지 않는다
      child.stderr?.destroy();
      resolve(e);
    };
    const child = spawn(process.execPath, [CHILD, harness, file, out], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr!.on('data', (d: Buffer) => {
      stderr = (stderr + String(d)).slice(-STDERR_KEEP);
    });
    let killed = false;
    const limit = timeoutSec + graceSec;
    const timer = setTimeout(() => {
      // 이미 끝난 자식(close만 기다리는 중)은 끝내지 않는다: 거둔 pid는 다른 프로세스가 다시 쓸 수 있다
      if (child.exitCode !== null || child.signalCode !== null) return;
      killed = true;
      killTree(child);
    }, limit * 1000);
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      if (killed)
        return settle({
          result: error(`자식 프로세스가 ${limit}초 안에 끝나지 않아 끝냈다`),
          ended: 'killed',
        });
      const r = readResult(out, id);
      settle(
        r
          ? { result: r, ended: 'result' }
          : {
              result: error(
                `자식 프로세스가 결과 없이 끝났다(종료 코드 ${code ?? signal}): ${stderr}`,
              ),
              ended: 'noresult',
            },
      );
    };
    child.once('error', (e) =>
      settle({ result: error(`자식 프로세스를 띄우지 못했다: ${e.message}`), ended: 'noresult' }),
    );
    // 끝낸 자식은 exit로 바로 넘어가고, 스스로 끝난 자식은 stderr를 다 읽도록 close를 1초까지 기다린다
    child.once('exit', (code, signal) => {
      closeWait = setTimeout(() => done(code, signal), killed ? 0 : 1000);
    });
    child.once('close', (code, signal) => done(code, signal));
  });
}

/**
 * 시나리오를 자식 프로세스로 jobs개씩 나란히 돌린다. 시간 제한이 긴 것부터 띄운다(같으면 이름순).
 * 나란히 돌 때 pass가 아닌 시나리오는 모두 끝난 뒤 이름순으로 하나씩(겹치지 않게) 한 번 더 돌린다(12.4절).
 * 첫 시도가 결과 없이 스스로 끝났으면 자식 진입점이 깨졌을 수 있어 이 프로세스에서 지금 방식으로,
 * 시나리오가 fail·error를 냈으면 자식 프로세스로 같은 시간 제한을 두고 돌린다.
 * 시간 제한으로 끝낸 시도가 생기면 그 뒤로는 다시 돌리지 않는다
 */
async function runParallel(
  harness: string,
  dir: string,
  ids: string[],
  jobs: number,
  graceSec: number,
): Promise<{ results: Result[]; reruns: number }> {
  const first = new Map<string, ChildEnd>();
  const timeouts = new Map<string, number>();
  const queue: { id: string; file: string; timeoutSec: number }[] = [];
  for (const id of ids) {
    const file = path.join(dir, `${id}.ts`);
    try {
      const s = await load(file);
      timeouts.set(id, s.timeoutSec ?? SCENARIO_TIMEOUT_SEC);
      queue.push({ id, file, timeoutSec: s.timeoutSec ?? SCENARIO_TIMEOUT_SEC });
    } catch (e) {
      const detail = oneLine((e as Error)?.message ?? String(e));
      first.set(id, { result: { id, covers: '', state: 'error', detail }, ended: 'result' });
    }
  }
  queue.sort((a, b) => b.timeoutSec - a.timeoutSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // 결과 파일을 두는 임시 폴더는 지우지 않는다(R14)
  const outDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'harness-selftest-results-')));
  let next = 0;
  const lane = async () => {
    while (next < queue.length) {
      const q = queue[next++];
      const out = path.join(outDir, `${q.id}.json`);
      first.set(q.id, await runChild(harness, q.file, q.timeoutSec, graceSec, out));
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, lane));

  const results: Result[] = [];
  let reruns = 0;
  // 시간 제한으로 끝낸 시도가 생기면 그 뒤로는 다시 돌리지 않는다: 그 실행은 이미 error가 있어 판정이 바뀌지 않고,
  // 다시 돌리는 시도가 끝낸 시도의 남은 프로세스와 겹치지 않게 한다(제작자 결정 2026-11-26)
  let killed = [...first.values()].some((e) => e.ended === 'killed');
  for (const id of ids) {
    const { result: r, ended } = first.get(id)!;
    if (r.state === 'pass' || killed) {
      results.push(r);
      continue;
    }
    reruns++;
    const file = path.join(dir, `${id}.ts`);
    let again: Result;
    if (ended === 'noresult') {
      again = await runScenario(harness, file);
    } else {
      const e = await runChild(
        harness,
        file,
        timeouts.get(id) ?? SCENARIO_TIMEOUT_SEC,
        graceSec,
        path.join(outDir, `${id}.again.json`),
      );
      again = e.result;
      if (e.ended === 'killed') killed = true;
    }
    if (again.state !== 'pass') {
      results.push(again);
      continue;
    }
    const head = `${again.detail} (나란히 돌 때 ${r.state}: `;
    const tail = ', 혼자 다시 돌려 통과)';
    const room = Math.max(0, DETAIL_MAX - head.length - tail.length);
    results.push({ ...again, detail: oneLine(head + oneLine(r.detail).slice(0, room) + tail) });
  }
  return { results, reruns };
}

export interface SelfTestStats {
  /** 실제로 쓴 동시 수(1이면 이 프로세스에서 차례로 돌았다) */
  jobs: number;
  /** 나란히 돌 때 pass가 아니어서 다시 돌린 시나리오 수 */
  reruns: number;
  /** runSelfTest 전체의 걸린 시간(ms) */
  ms: number;
}

export async function runSelfTest(o: {
  harness: string;
  only?: string[];
  headSha?: string;
  /** 시나리오 폴더(기본: 실행기 옆의 scenarios/). 실행기 테스트가 쓴다 */
  scenarioDir?: string;
  /** 동시에 돌리는 시나리오 수(기본: 코어 수). 시나리오 수를 넘지 않는다. 1이면 이 프로세스에서 차례로 돈다 */
  jobs?: number;
  /** 자식 프로세스의 시간 제한에 더하는 여유(초, 기본 30). 실행기 테스트가 줄인다 */
  childGraceSec?: number;
  /** 실행 정보(보고서에는 넣지 않는다) */
  onStats?: (s: SelfTestStats) => void;
}): Promise<SelfTestReport> {
  const t0 = Date.now();
  const want = o.jobs ?? availableParallelism();
  if (!Number.isInteger(want) || want < 1)
    throw new Error(`동시 수는 1 이상의 정수여야 한다(받은 값: ${want})`);
  const graceSec = o.childGraceSec ?? CHILD_GRACE_SEC;
  if (!Number.isFinite(graceSec) || graceSec <= 0)
    throw new Error(`자식 프로세스의 여유는 0보다 커야 한다(받은 값: ${graceSec})`);
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

  const jobs = Math.min(want, ids.length);
  let results: Result[] = [];
  let reruns = 0;
  if (jobs === 1) {
    for (const id of ids) results.push(await runScenario(harness, path.join(dir, `${id}.ts`)));
  } else {
    ({ results, reruns } = await runParallel(harness, dir, ids, jobs, graceSec));
  }
  o.onStats?.({ jobs, reruns, ms: Date.now() - t0 });
  return { version: 1, headSha: o.headSha ?? '', results };
}

/** 시나리오별 한 줄. 예) `✓ r20-owner-commands (R20) — …` */
export function formatSelfTest(r: SelfTestReport): string[] {
  return r.results.map(
    (x) => `${x.state === 'pass' ? '✓' : '✗'} ${x.id} (${x.covers || '?'}) — ${x.detail}`,
  );
}
