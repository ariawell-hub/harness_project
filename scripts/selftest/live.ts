// 실제 세션 시나리오 실행기(설계서 12.4절의 둘째 층). `self-test --live`가 부른다.
// 대상 하네스를 적용한 샘플 리포에서 그 하네스 설정의 agents.claude로 실제 세션을 띄우고,
// 세션이 끝난 뒤 샘플에 남은 흔적(가짜 도구의 호출 기록)과 결과 JSON으로 판정한다.
// 모델 응답은 실행마다 달라 통과율만 낸다. 구독 인증이 필요해 기본 모드(run.ts)·CI·check에서는 돌지 않는다.
// run.ts와 같이 대상 하네스의 내부 모듈을 import하지 않는다(설정 파일과 CLI·훅의 입출력에만 기댄다).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { context, type Sample, type ScenarioContext } from './run.ts';

export interface LiveScenario {
  /** 파일 이름과 같은 kebab-case id */
  id: string;
  /** 12.4절의 어느 항목인가. 예) 'R20' */
  covers: string;
  /** 샘플 리포를 준비하고 세션에 줄 프롬프트를 돌려준다 */
  setup(ctx: ScenarioContext): { sample: Sample; prompt: string };
  /** 세션이 끝난 뒤 샘플 리포와 세션 출력을 보고 판정한다 */
  judge(r: { sample: Sample; text: string; denials: string[] }): {
    pass: boolean;
    detail: string;
  };
}

export interface LiveResult {
  id: string;
  covers: string;
  /** 판정한 세션 수. 끝까지 돌지 못한 세션(인증·한도·시간 초과)은 세지 않고 details에만 남긴다 */
  runs: number;
  passed: number;
  /** 회차마다 한 줄 */
  details: string[];
}

/** 세션을 한 번도 띄우지 못했다(에이전트 CLI 없음, 인증 실패). CLI는 종료 코드 1로 끝낸다 */
export class LiveLaunchError extends Error {}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = path.join(HERE, 'live');
/** 샘플 리포 준비(git, CLI)에 쓰는 시간. 세션 시간 제한에 더한다 */
const SETUP_MS = 120_000;
const DETAIL_MAX = 300;
/** PATH 앞에 두는 가짜 도구. 호출 인자를 기록 파일에 남기고 0으로 끝난다 */
const FAKE_TOOLS = ['gh', 'psql'];
/**
 * 세션에 넘기는 환경 변수(run.ts의 목록에 더한다). 에이전트 CLI의 구독 인증은 실제 홈 폴더
 * (macOS는 키체인, 그 밖은 ~/.claude)나 아래 변수에 있다. GitHub 자격증명은 넘기지 않는다
 */
const AGENT_ENV = new Set([
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'USER',
  'LOGNAME',
  'SHELL',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_GIT_BASH_PATH',
]);

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX);
const toolLog = (s: Sample) => path.join(path.dirname(s.ghState), 'tool-calls.log');

/** 가짜 도구가 받은 호출(받은 순서). 한 줄이 `<도구> <인자들>`이다 */
export function toolCalls(s: Sample): string[] {
  const f = toolLog(s);
  return existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean) : [];
}

/** sh 스크립트 안에 넣을 경로: Windows 드라이브 경로는 Git Bash 꼴(/c/…)로 바꾸고 작은따옴표로 감싼다 */
function shPath(p: string): string {
  const posix = p
    .replace(/^([A-Za-z]):[\\/]/, (_, d: string) => `/${d.toLowerCase()}/`)
    .replace(/\\/g, '/');
  return `'${posix.replace(/'/g, `'\\''`)}'`;
}

/**
 * 세션의 환경: 샘플 리포의 환경(가짜 GitHub, 샘플 전용 git 설정)에 에이전트 인증에 필요한 것만 더하고,
 * 가짜 도구 폴더를 PATH 맨 앞에 둔다
 */
function sessionEnv(base: NodeJS.ProcessEnv, s: Sample): NodeJS.ProcessEnv {
  const dir = path.dirname(s.ghState);
  const bin = path.join(dir, 'bin');
  const log = toolLog(s);
  mkdirSync(bin, { recursive: true });
  for (const t of FAKE_TOOLS) {
    writeFileSync(
      path.join(bin, t),
      `#!/bin/sh\nprintf '%s\\n' "${t} $*" >> ${shPath(log)}\nexit 0\n`,
      { mode: 0o755 },
    );
    if (process.platform === 'win32')
      writeFileSync(
        path.join(bin, `${t}.cmd`),
        `@echo off\r\n>>"${log}" echo ${t} %*\r\nexit /b 0\r\n`,
      );
  }
  // 사용자 셸 설정이 PATH 순서를 바꾸거나 토큰을 내보내도, Bash 명령마다 가짜 도구가 먼저 걸리게 한다
  const envFile = path.join(dir, 'session-env.sh');
  writeFileSync(
    envFile,
    `export PATH=${shPath(bin)}:"$PATH"\nunset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN\n`,
  );
  const ghConfig = path.join(dir, 'gh-config');
  mkdirSync(ghConfig, { recursive: true });

  const env: NodeJS.ProcessEnv = { ...base };
  delete env.HOME;
  delete env.USERPROFILE;
  for (const [k, v] of Object.entries(process.env)) {
    if (AGENT_ENV.has(k.toUpperCase())) env[k] = v;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = bin + path.delimiter + (env[pathKey] ?? '');
  env.CLAUDE_ENV_FILE = envFile;
  // 실제 gh를 절대 경로로 불러도 이 머신의 로그인 설정을 읽지 못한다
  env.GH_CONFIG_DIR = ghConfig;
  return env;
}

interface AgentDef {
  cmd?: string;
  args?: string[];
  permissionProfile?: string;
}

/**
 * 세션 설정 파일: 샘플 리포의 무인 권한 프로필에 샘플 리포 `.claude/settings.json`의 L1 훅(PreToolUse)을 건다.
 * 훅이 없는 하네스는 없는 채로 띄운다(그때 세션이 금지 명령을 실행하면 그 회차가 실패로 남는다)
 */
function writeSettings(s: Sample, agent: AgentDef): string {
  const read = (rel: string): Record<string, unknown> => {
    const f = path.join(s.root, rel);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>) : {};
  };
  const settings = read(agent.permissionProfile ?? '.claude/runner-settings.json');
  const hooks = (read('.claude/settings.json').hooks ?? {}) as Record<string, unknown>;
  if (hooks.PreToolUse) settings.hooks = { PreToolUse: hooks.PreToolUse };
  const out = path.join(path.dirname(s.ghState), 'session-settings.json');
  writeFileSync(out, JSON.stringify(settings, null, 2));
  return out;
}

interface Ended {
  code: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** 프로세스를 띄우지 못했다(실행 파일 없음 등) */
  spawnError?: string;
}

function session(
  cmd: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; input: string; timeoutMs: number },
): Promise<Ended> {
  const win = process.platform === 'win32';
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    const child = spawn(cmd, args, {
      cwd: o.cwd,
      env: o.env,
      detached: !win,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    // 세션이 띄운 자식 프로세스까지 정리한다
    const kill = () => {
      if (!child.pid) return;
      try {
        if (win)
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        // 이미 끝났다
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, o.timeoutMs);
    const finish = (code: number, spawnError?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      kill();
      resolve({ code: timedOut ? 124 : code, timedOut, stdout, stderr, spawnError });
    };
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => finish(127, e.message));
    // 손자 프로세스가 파이프를 잡고 있어도 2초 뒤에는 끝낸다
    child.on('exit', (code) => setTimeout(() => finish(code ?? 1), 2000).unref());
    child.on('close', (code) => finish(code ?? 1));
    child.stdin.on('error', () => {
      // 프롬프트를 읽기 전에 끝난 세션
    });
    child.stdin.end(o.input);
  });
}

type Obj = Record<string, unknown>;

/** `claude -p --output-format json`(또는 stream-json)의 마지막 결과 객체. 없으면 null */
function resultOf(stdout: string): Obj | null {
  const isResult = (x: unknown): x is Obj =>
    typeof x === 'object' && x !== null && (x as Obj).type === 'result';
  const text = stdout.trim();
  try {
    const whole = JSON.parse(text) as unknown;
    if (isResult(whole)) return whole;
    if (Array.isArray(whole)) return [...whole].reverse().find(isResult) ?? null;
  } catch {
    // 여러 줄 출력: 줄마다 본다
  }
  for (const line of text.split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const o = JSON.parse(line) as unknown;
      if (isResult(o)) return o;
    } catch {
      // JSON이 아닌 줄
    }
  }
  return null;
}

async function load(file: string): Promise<LiveScenario> {
  const id = path.basename(file, '.ts');
  const mod = (await import(pathToFileURL(file).href)) as { default?: Partial<LiveScenario> };
  const s = mod.default;
  if (!s || typeof s.setup !== 'function' || typeof s.judge !== 'function' || !s.covers)
    throw new Error(`${id}: default export가 LiveScenario(id, covers, setup, judge)가 아니다`);
  if (s.id !== id) throw new Error(`id(${s.id})가 파일 이름(${id})과 다르다`);
  return s as LiveScenario;
}

export async function runLive(o: {
  harness: string;
  /** 시나리오마다 실행 횟수(기본 3) */
  runs: number;
  only?: string[];
  /** 진행 상황 한 줄(세션마다) */
  log?: (line: string) => void;
}): Promise<LiveResult[]> {
  const harness = path.resolve(o.harness);
  let ids = readdirSync(LIVE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.basename(f, '.ts'))
    .sort();
  if (o.only) {
    const unknown = o.only.filter((x) => !ids.includes(x));
    if (unknown.length) throw new Error(`없는 시나리오: ${unknown.join(', ')}`);
    ids = ids.filter((x) => o.only!.includes(x));
  }
  if (!ids.length) throw new Error(`실행할 시나리오가 없다(${LIVE_DIR})`);
  if (!Number.isInteger(o.runs) || o.runs < 1) throw new Error('runs는 1 이상의 정수여야 한다');
  const scenarios: LiveScenario[] = [];
  for (const id of ids) scenarios.push(await load(path.join(LIVE_DIR, `${id}.ts`)));

  const cfg = JSON.parse(readFileSync(path.join(harness, 'harness.config.json'), 'utf8')) as {
    agents?: { claude?: AgentDef };
    limits?: { sessionTimeoutMin?: number };
  };
  const agent = cfg.agents?.claude;
  if (!agent?.cmd)
    throw new LiveLaunchError(
      '에이전트 CLI를 실행하지 못했다: 대상 하네스 설정에 agents.claude.cmd가 없다',
    );
  const timeoutMin = cfg.limits?.sessionTimeoutMin ?? 30;

  const results: LiveResult[] = [];
  let judged = 0;
  let lastWhy = '';
  for (const s of scenarios) {
    const r: LiveResult = { id: s.id, covers: s.covers, runs: 0, passed: 0, details: [] };
    results.push(r);
    for (let n = 1; n <= o.runs; n++) {
      const c = context(harness, Date.now() + timeoutMin * 60_000 + SETUP_MS);
      let line: string;
      try {
        const { sample, prompt } = s.setup(c.ctx);
        const ended = await session(
          agent.cmd,
          [...(agent.args ?? []), '--settings', writeSettings(sample, agent)],
          {
            cwd: sample.root,
            env: sessionEnv(c.envOf(sample), sample),
            input: prompt,
            timeoutMs: timeoutMin * 60_000,
          },
        );
        if (ended.spawnError)
          throw new LiveLaunchError(
            `에이전트 CLI를 실행하지 못했다(${agent.cmd}): ${ended.spawnError}`,
          );
        // 샘플 폴더는 지우지 않는다(R14). 세션의 원본 출력을 옆에 남겨 회차를 들여다볼 수 있게 한다
        writeFileSync(
          path.join(path.dirname(sample.ghState), 'session-output.txt'),
          `${ended.stdout}\n--- stderr ---\n${ended.stderr}`,
        );
        const res = resultOf(ended.stdout);
        const text = typeof res?.result === 'string' ? res.result : ended.stdout;
        const why = ended.timedOut
          ? `세션 시간 제한(${timeoutMin}분)을 넘겼다`
          : ended.code !== 0 || res?.is_error === true
            ? `세션이 실패로 끝났다(종료 코드 ${ended.code}): ${oneLine(text || ended.stderr)}`
            : '';
        if (why) {
          // 판정하지 않는 세션이라도 금지 명령이 실행됐으면 드러나게 한다
          const calls = toolCalls(sample);
          lastWhy = why;
          line = `판정 제외 — ${why}${calls.length ? ` (가짜 도구 호출: ${calls.join(' | ')})` : ''}`;
        } else {
          const denials = (
            Array.isArray(res?.permission_denials) ? res.permission_denials : []
          ).map(
            (d: Obj) =>
              `${String(d.tool_name ?? '?')}: ${JSON.stringify(d.tool_input ?? null).slice(0, 200)}`,
          );
          const v = s.judge({ sample, text, denials });
          judged++;
          r.runs++;
          if (v.pass) r.passed++;
          line = `${v.pass ? '통과' : '실패'} — ${v.detail}`;
        }
      } catch (e) {
        if (e instanceof LiveLaunchError) throw e;
        lastWhy = (e as Error)?.message ?? String(e);
        line = `판정 제외 — ${lastWhy}`;
      } finally {
        c.close();
      }
      r.details.push(`${n}회차: ${oneLine(line)}`);
      o.log?.(`${s.id} ${r.details.at(-1)}`);
    }
  }
  if (!judged) throw new LiveLaunchError(`세션을 한 번도 띄우지 못했다: ${oneLine(lastWhy)}`);
  return results;
}

/** 시나리오별 한 줄. 예) `r20-live (R20) — 통과 3/3` */
export function formatLive(results: LiveResult[]): string[] {
  return results.map((r) => `${r.id} (${r.covers}) — 통과 ${r.passed}/${r.runs}`);
}
