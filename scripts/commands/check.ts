// check (6절, R7): fmt --check + lint + test + test-effect + build + doc-lint + bypass-scan + secret-scan.
// 결과는 캐시한다. 키 = 작업 트리 해시 + 프로파일 버전 + 런타임·도구 버전 + 플랫폼 + 명령 정의 해시 (+ base).
// CI(--ci)는 항상 새로 실행한다. 하위 검사별 결과를 실패 기록(attempts)에 남긴다.
// test 건너뛰기(6절): 바뀐 파일이 모두 설정 testInertPaths(테스트가 읽지 않는 경로) 안이면 test를 돌리지 않는다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordAttempt } from '../lib/attempts.ts';
import type { HarnessConfig } from '../lib/config.ts';
import { runSync, tail } from '../lib/exec.ts';
import {
  defaultBase,
  gitTry,
  harnessStateDir,
  worktreeTreeHash,
  type RepoInfo,
} from '../lib/git.ts';
import { parseBranch } from '../lib/plan.ts';
import { formatProblem, matchesAny, type Problem } from '../lib/util.ts';
import { bypassScan } from '../gates/bypass-scan.ts';
import { codeownersProblems } from '../gates/codeowners.ts';
import { docLint } from '../gates/doc-lint.ts';
import { secretScan } from '../gates/secret-scan.ts';
import { testEffect } from '../gates/test-effect.ts';
import { describeFailure, runStandard } from './standard.ts';

export const CHECK_STEPS = [
  'fmt',
  'lint',
  'test',
  'test-effect',
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
  /** test 건너뛰기 판정이 읽는 환경 변수(GITHUB_REF). 기본은 process.env(테스트용) */
  env?: NodeJS.ProcessEnv;
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
    testEffect: cfg.testEffect,
    base,
    only: only ?? null,
  };
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

/** 이 파일의 변경이 test 결과를 바꿀 수 없는가: testInertPaths 안이고 보호 경로가 아니다 */
export function testInert(file: string, cfg: HarnessConfig): boolean {
  return matchesAny(file, cfg.testInertPaths) && !matchesAny(file, cfg.protectedPaths);
}

export interface TestSkip {
  /** test를 돌리지 않아도 되는가 */
  skippable: boolean;
  reason: string;
}

/**
 * test를 건너뛸 수 있는가(6절). 바뀐 파일이 1개 이상이고 모두 testInert일 때만이다.
 * 그때 PR의 트리는 "기본 브랜치의 끝 + 테스트가 읽지 않는 변경"이라 test 결과가 기본 브랜치와 같다.
 * 기본 브랜치의 check는 건너뛰지 않는다(분류가 틀렸을 때 거기서 잡는다).
 */
export function testSkip(
  info: RepoInfo,
  cfg: HarnessConfig,
  o: { base: string | null; committedOnly: boolean; env?: NodeJS.ProcessEnv },
): TestSkip {
  const no = (reason: string): TestSkip => ({ skippable: false, reason });
  if (cfg.testInertPaths.length === 0) return no('testInertPaths가 비어 있다');
  if (!o.base) return no('비교 기준(base)이 없다');
  const def = cfg.github.defaultBranch;
  const env = o.env ?? process.env;
  if (info.branch === def || env.GITHUB_REF === `refs/heads/${def}`)
    return no(`기본 브랜치(${def})의 check는 건너뛰지 않는다`);
  // 이름 바꾸기는 옛 경로와 새 경로가 모두 나오게 한다(--no-renames). 삭제도 센다
  const diff = ['diff', '--no-renames', '--name-only', '-z', o.base];
  // 목록을 구하지 못하면(없는 base 등) 멈추지 않고 test를 돌린다. 모를 때는 건너뛰지 않는다
  const runs = o.committedOnly
    ? [gitTry([...diff, 'HEAD'], info.root)]
    : [
        gitTry(diff, info.root),
        gitTry(['ls-files', '--others', '--exclude-standard', '-z'], info.root),
      ];
  if (runs.some((r) => !r.ok)) return no('바뀐 파일을 구하지 못했다(base를 확인하라)');
  const files = [...new Set(runs.flatMap((r) => r.stdout.split('\0').filter(Boolean)))];
  if (files.length === 0) return no('바뀐 파일이 없다');
  const outside = files.filter((f) => !testInert(f, cfg));
  if (outside.length)
    return no(
      `testInertPaths 밖의 변경 ${outside.length}개: ${outside.slice(0, 3).join(', ')}${outside.length > 3 ? ' …' : ''}`,
    );
  return {
    skippable: true,
    reason: `바뀐 파일 ${files.length}개가 모두 설정 testInertPaths(테스트가 읽지 않는 경로) 안이다. 기본 브랜치의 check가 test를 전부 돌린다`,
  };
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
  // test 건너뛰기는 실행을 시작할 때 한 번만 판정한다. 도중에 작업 트리가 바뀌어도 판정과 결과가 어긋나지 않는다
  const inert =
    steps.includes('test') && cfg.commands.test
      ? testSkip(info, cfg, { base, committedOnly: !!opts.ci, env: opts.env })
      : null;
  const testSkipped = !!inert?.skippable;
  const results: SubResult[] = [];
  for (const name of steps) {
    const started = Date.now();
    let ok = true;
    let skipped = false;
    let output = '';
    let note = '';
    if (name === 'test' && inert && testSkipped) {
      skipped = true;
      note = ' (건너뜀)';
      output = inert.reason;
    } else if (name === 'fmt' || name === 'lint' || name === 'test' || name === 'build') {
      const r = await runStandard(name, root, cfg, { checkMode: name === 'fmt' });
      skipped = r.notApplicable;
      ok = r.ok;
      if (!ok) output = describeFailure(r, cfg.commands[name]?.timeoutSec);
    } else if (name === 'test-effect') {
      // R5: 추가·수정한 테스트 파일이 변경 전 코드에서 실패하는가(5.1절). 판정 줄은 통과해도 남긴다
      const r = await testEffect(root, cfg, { base, committedOnly: !!opts.ci });
      skipped = r.skipped;
      ok = r.problems.length === 0;
      output = [
        ...r.items.map((i) => `${i.file}: ${i.outcome}(${i.detail})`),
        ...r.notes.map((n) => `참고: ${n}`),
        problemsText(r.problems),
      ]
        .filter(Boolean)
        .join('\n');
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
      const label = note || (skipped ? ' (해당 없음)' : '');
      process.stdout.write(`${mark} ${name}${label} (${(sub.durationMs / 1000).toFixed(1)}s)\n`);
      if (
        output &&
        (!ok || name === 'doc-lint' || name === 'test-effect' || (name === 'test' && testSkipped))
      )
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
  // test를 건너뛴 실행은 캐시에 남기지 않는다. 캐시에 있는 결과는 모두 test를 실제로 돌린 것이라,
  // 같은 트리의 기본 브랜치 check가 건너뛴 결과를 재사용할 길이 없다
  if (useCache && ok && !testSkipped) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, `${key}.json`), JSON.stringify(result));
  }
  if (!opts.quiet)
    process.stdout.write(ok ? 'check: 통과\n' : 'check: 실패 — 위 항목의 고치는 법을 따르라\n');
  return result;
}
