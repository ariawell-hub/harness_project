// 테스트 공용 도구: 임시 git 리포 + 로컬 bare 원격 + 하네스 파일 복사.
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync } from '../lib/exec.ts';

export const HARNESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function tmp(prefix = 'harness-test-'): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

export function sh(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const r = runSync(cmd, args, { cwd, env: env ? { ...process.env, ...env } : undefined });
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패(${cwd}): ${r.stderr}`);
  return r.stdout.trim();
}

export function write(root: string, rel: string, content: string): void {
  const f = path.join(root, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content);
}

export function gitInit(root: string): void {
  mkdirSync(root, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], root);
  sh('git', ['config', 'user.email', 'test@example.invalid'], root);
  sh('git', ['config', 'user.name', 'test'], root);
  sh('git', ['config', 'commit.gpgsign', 'false'], root);
}

export function commitAll(root: string, msg = 'commit'): string {
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', msg], root);
  return sh('git', ['rev-parse', 'HEAD'], root);
}

/** 테스트용 harness.config.json. 표준 명령은 기본적으로 해당 없음(null) */
export function fixtureConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    version: 1,
    stage: 'build',
    profile: 'test',
    profileVersion: 'test@0',
    github: {
      remote: 'origin',
      defaultBranch: 'main',
      owner: 'maker',
      bot: 'harness-bot',
      priorityLabels: ['priority:high'],
      needsHumanLabel: 'needs-human',
    },
    paths: {
      worktreeRoot: '../{repo}.worktrees',
      devEnvFile: '~/.config/harness-test-none/.env.dev',
    },
    limits: {
      sessionTimeoutMin: 1,
      acTimeoutSec: 60,
      stepFailedCheckLimit: 10,
      stepSessionMinutesLimit: 120,
      runnerMaxHours: 1,
      workers: 1,
      wipPerWorker: 2,
      claimExpiryHours: 24,
      usageLimitMaxWaitMin: 60,
      pollSec: 0,
    },
    failure: { switchAt: 3, stopAt: 5 },
    commands: {
      setup: null,
      fmt: null,
      lint: null,
      test: null,
      build: null,
      dev: null,
      verify: null,
    },
    docLint: { agentsMdMaxLines: 120, exclude: ['docs/harness/**'] },
    bypass: { extraPatterns: [], excludeExtensions: ['.md'] },
    guard: { dbPatterns: [], dbClients: [] },
    planReview: { required: false },
    riskPaths: [],
    protectedPaths: [],
    agents: {},
  };
  return { ...base, ...over };
}

export interface Fixture {
  dir: string;
  root: string;
  remote: string;
  cleanup: () => void;
}

/** 하네스 스크립트·템플릿을 담은 리포 + bare 원격. main이 원격에 push되어 있다 */
export function makeFixture(configOver: Record<string, unknown> = {}): Fixture {
  const dir = tmp();
  const root = path.join(dir, 'repo');
  const remote = path.join(dir, 'remote.git');
  sh('git', ['init', '-q', '--bare', '-b', 'main', remote], dir);
  gitInit(root);
  cpSync(path.join(HARNESS_ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  for (const f of [
    'TEMPLATE.md',
    'TEMPLATE-small.md',
    'TEMPLATE-step.md',
    'tech-debt-tracker.md',
  ]) {
    cpSync(path.join(HARNESS_ROOT, 'docs/exec-plans', f), path.join(root, 'docs/exec-plans', f));
  }
  cpSync(
    path.join(HARNESS_ROOT, 'docs/harness/workflow.md'),
    path.join(root, 'docs/harness/workflow.md'),
  );
  cpSync(
    path.join(HARNESS_ROOT, '.claude/runner-settings.json'),
    path.join(root, '.claude/runner-settings.json'),
  );
  write(root, 'docs/exec-plans/active/.gitkeep', '');
  write(root, 'docs/exec-plans/completed/.gitkeep', '');
  write(
    root,
    'AGENTS.md',
    '# AGENTS.md\n\n테스트 리포. `node scripts/harness.ts start`로 시작한다.\n',
  );
  write(root, '.gitignore', '.env\n.env.*\n!.env.example\nnode_modules/\n');
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig(configOver), null, 2));
  commitAll(root, 'init');
  sh('git', ['remote', 'add', 'origin', remote], root);
  sh('git', ['push', '-q', '-u', 'origin', 'main'], root);
  return { dir, root, remote, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * bare 원격을 다른 곳에 clone해 `branch`(기본 main)의 파일을 바꾸고 push한다.
 * `fetch`가 참이면(기본) fixture 리포에서 fetch까지 한다. fixture 리포의 체크아웃은 건드리지 않는다.
 */
export function advanceRemote(
  fx: Fixture,
  rel: string,
  content: string,
  o: { branch?: string; fetch?: boolean } = {},
): string {
  const branch = o.branch ?? 'main';
  const clone = path.join(mkdtempSync(path.join(fx.dir, 'clone-')), 'c');
  sh('git', ['clone', '-q', fx.remote, clone], fx.dir);
  sh('git', ['config', 'user.email', 'test@example.invalid'], clone);
  sh('git', ['config', 'user.name', 'test'], clone);
  sh('git', ['config', 'commit.gpgsign', 'false'], clone);
  if (branch !== 'main') sh('git', ['checkout', '-q', branch], clone);
  write(clone, rel, content);
  const sha = commitAll(clone, `remote: ${rel}`);
  sh('git', ['push', '-q', 'origin', branch], clone);
  if (o.fetch ?? true) sh('git', ['fetch', '-q', 'origin'], fx.root);
  return sha;
}
