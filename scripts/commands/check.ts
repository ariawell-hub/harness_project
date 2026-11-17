// check (6절, R7): fmt --check + lint + test + build + doc-lint + bypass-scan + secret-scan.
// 결과는 캐시한다. 키 = 작업 트리 해시 + 프로파일 버전 + 런타임·도구 버전 + 플랫폼 + 명령 정의 해시 (+ base).
// CI(--ci)는 항상 새로 실행한다. 하위 검사별 결과를 실패 기록(attempts)에 남긴다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordAttempt } from '../lib/attempts.ts';
import type { HarnessConfig } from '../lib/config.ts';
import { runSync, tail } from '../lib/exec.ts';
import { defaultBase, harnessStateDir, worktreeTreeHash, type RepoInfo } from '../lib/git.ts';
import { parseBranch } from '../lib/plan.ts';
import { formatProblem, type Problem } from '../lib/util.ts';
import { bypassScan } from '../gates/bypass-scan.ts';
import { codeownersProblems } from '../gates/codeowners.ts';
import { docLint } from '../gates/doc-lint.ts';
import { secretScan } from '../gates/secret-scan.ts';
import { describeFailure, runStandard } from './standard.ts';

export const CHECK_STEPS = [
  'fmt',
  'lint',
  'test',
  'build',
  'doc-lint',
  'bypass-scan',
  'secret-scan',
] as const;
export type CheckStep = (typeof CHECK_STEPS)[number];

export interface SubResult {
  name: CheckStep;
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  output: string;
}

export interface CheckResult {
  ok: boolean;
  cached: boolean;
  results: SubResult[];
}

export interface CheckOptions {
  ci?: boolean;
  noCache?: boolean;
  base?: string | null;
  only?: CheckStep[];
  quiet?: boolean;
  /** 실패 기록을 남기지 않는다(테스트용) */
  noRecord?: boolean;
}

function toolVersions(): string {
  const pnpm = runSync('pnpm', ['--version'], { timeoutMs: 20_000 });
  const gl = runSync('gitleaks', ['version'], { timeoutMs: 20_000 });
  return `node ${process.version}; pnpm ${pnpm.stdout.trim()}; gitleaks ${gl.stdout.trim()}`;
}

export function cacheKey(
  info: RepoInfo,
  cfg: HarnessConfig,
  base: string | null,
  only?: CheckStep[],
): string {
  const parts = {
    tree: worktreeTreeHash(info),
    profile: cfg.profileVersion,
    tools: toolVersions(),
    platform: `${process.platform}-${process.arch}`,
    commands: createHash('sha256').update(JSON.stringify(cfg.commands)).digest('hex'),
    base,
    only: only ?? null,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function problemsText(list: Problem[]): string {
  return list.map(formatProblem).join('\n');
}

export async function runCheck(
  info: RepoInfo,
  cfg: HarnessConfig,
  opts: CheckOptions = {},
): Promise<CheckResult> {
  const root = info.root;
  const base =
    opts.base !== undefined
      ? opts.base
      : defaultBase(root, cfg.github.remote, cfg.github.defaultBranch);
  const useCache = !opts.ci && !opts.noCache;
  const cacheDir = path.join(harnessStateDir(info, 'common'), 'check-cache');
  let key = '';
  if (useCache) {
    key = cacheKey(info, cfg, base, opts.only);
    const f = path.join(cacheDir, `${key}.json`);
    if (existsSync(f)) {
      const saved = JSON.parse(readFileSync(f, 'utf8')) as CheckResult;
      if (!opts.quiet)
        process.stdout.write(
          `check: 캐시 적중(${key.slice(0, 12)}) — 같은 작업 트리·도구로 이미 통과했다\n`,
        );
      return { ...saved, cached: true };
    }
  }

  const steps = opts.only ?? [...CHECK_STEPS];
  const results: SubResult[] = [];
  for (const name of steps) {
    const started = Date.now();
    let ok = true;
    let skipped = false;
    let output = '';
    if (name === 'fmt' || name === 'lint' || name === 'test' || name === 'build') {
      const r = await runStandard(name, root, cfg, { checkMode: name === 'fmt' });
      skipped = r.notApplicable;
      ok = r.ok;
      if (!ok) output = describeFailure(r, cfg.commands[name]?.timeoutSec);
    } else if (name === 'doc-lint') {
      const r = docLint(root, cfg);
      // CODEOWNERS는 protectedPaths에서 만든 내용과 같아야 한다(10.4절). 운영 단계에 추가하는 파일이라(0.2절)
      // 구축 단계에서는 없어도 된다. 단계 이름을 늘리지 않으려고 이 단계 안에서 본다(실패 키·캐시가 이름에 묶여 있다)
      const owners = codeownersProblems(root, cfg, { missingOk: cfg.stage !== 'operation' });
      ok = r.errors.length === 0 && owners.length === 0;
      output = problemsText([
        ...r.errors,
        ...owners,
        ...r.warnings.map((w) => ({ ...w, rule: '경고 ' + w.rule })),
      ]);
    } else if (name === 'bypass-scan') {
      const p = bypassScan(root, cfg, { base, committedOnly: !!opts.ci });
      ok = p.length === 0;
      output = problemsText(p);
    } else if (name === 'secret-scan') {
      const p = secretScan(root, { base, committedOnly: !!opts.ci });
      ok = p.length === 0;
      output = problemsText(p);
    }
    const sub: SubResult = { name, ok, skipped, durationMs: Date.now() - started, output };
    results.push(sub);
    if (!opts.quiet) {
      const mark = skipped ? '–' : ok ? '✓' : '✗';
      const note = skipped ? ' (해당 없음)' : '';
      process.stdout.write(`${mark} ${name}${note} (${(sub.durationMs / 1000).toFixed(1)}s)\n`);
      if (output && (!ok || name === 'doc-lint'))
        process.stdout.write(tail(output, 80).replace(/^/gm, '    ') + '\n');
    }
  }
  const ok = results.every((r) => r.ok);

  if (!opts.noRecord) {
    const b = parseBranch(info.branch);
    for (const r of results) {
      if (r.skipped) continue;
      recordAttempt(info, {
        plan: b?.id ?? 'none',
        step: b?.step ?? null,
        key: `check:${r.name}`,
        ok: r.ok,
        kind: 'check',
        durationMs: r.durationMs,
        detail: r.ok ? undefined : tail(r.output, 40),
      });
    }
  }
  const result: CheckResult = { ok, cached: false, results };
  if (useCache && ok) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(result));
  }
  if (!opts.quiet)
    process.stdout.write(ok ? 'check: 통과\n' : 'check: 실패 — 위 항목의 고치는 법을 따르라\n');
  return result;
}
