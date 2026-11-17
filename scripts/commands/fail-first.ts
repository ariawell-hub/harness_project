// fail-first: R5(TDD)의 "먼저 실패한 테스트" 기록을 명령의 실행 결과로 남긴다(설계서 5.1절).
//   fail-first "<테스트 명령>"   : 명령을 실행해 단언 실패로 끝났을 때만 기록한다
//   fail-first --exempt "<사유>" : 실행 없이 예외를 기록한다(문서·설정·순수 리팩터 등)
// 기록은 git이 추적하지 않는 worktree별 상태 폴더에 둔다. 계획 파일이나 PR 본문에 손으로 쓴 문장은 기록이 아니다.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.ts';
import { runShell } from '../lib/exec.ts';
import { git, harnessStateDir, repoInfo, type RepoInfo } from '../lib/git.ts';
import { findPlan, parseBranch } from '../lib/plan.ts';
import { globToRegExp } from '../lib/util.ts';

export interface FailFirstRecord {
  /** ISO 시각 */
  ts: string;
  plan: string;
  /** 소규모 계획은 null */
  step: number | null;
  kind: 'fail' | 'exempt';
  /** kind가 fail일 때: 실행한 명령, 종료 코드, 단언 실패가 보인 첫 줄(200자 이내), 출력의 sha256 앞 12자 */
  command?: string;
  code?: number;
  matched?: string;
  outputSha?: string;
  /** kind가 exempt일 때: 사유 */
  reason?: string;
  /** 기록 시점의 HEAD */
  head: string;
}

/** 실행했지만 기록하지 못했다(통과, 시간 초과, 단언 실패가 아닌 실패). CLI는 종료 코드 1 */
export class FailFirstError extends Error {
  /** 실행 출력(stdout + stderr) */
  readonly output: string;
  constructor(message: string, output = '') {
    super(message);
    this.output = output;
  }
}
/** 쓸 수 없는 호출(빈 명령·빈 사유, 계획 브랜치가 아님). CLI는 종료 코드 2 */
export class FailFirstUsageError extends Error {}

/** `ci.repro`가 없는 리포에서 쓰는 단언 실패 정규식(Node의 assert) */
const DEFAULT_FAIL_PATTERN = 'AssertionError|ERR_ASSERTION';
const COMMAND_MAX = 500;
const REASON_MAX = 500;
const MATCHED_MAX = 200;

const TEST_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '**/*_test.*',
  '**/test_*.*',
  '**/test/**',
  '**/tests/**',
  '**/__tests__/**',
].map(globToRegExp);

/** 테스트 파일인가(리포 루트 기준 경로) */
export function isTestFile(file: string): boolean {
  const f = file.replace(/\\/g, '/');
  return TEST_GLOBS.some((re) => re.test(f));
}

export function failFirstFile(info: RepoInfo): string {
  return path.join(harnessStateDir(info, 'worktree'), 'fail-first.jsonl');
}

/** 이 worktree의 기록 가운데 그 계획·step의 것(쓴 순서). 깨진 줄은 건너뛴다 */
export function readFailFirst(
  info: RepoInfo,
  plan: string,
  step: number | null,
): FailFirstRecord[] {
  const file = failFirstFile(info);
  if (!existsSync(file)) return [];
  const out: FailFirstRecord[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as FailFirstRecord | null;
      if (!r || typeof r !== 'object') continue;
      if (r.kind !== 'fail' && r.kind !== 'exempt') continue;
      if (r.plan === plan && (r.step ?? null) === step) out.push(r);
    } catch {
      // 깨진 줄
    }
  }
  return out;
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** 현재 브랜치의 계획·step(`complete-step`과 같은 방법) */
function current(cwd: string): { info: RepoInfo; plan: string; step: number | null } {
  const info = repoInfo(cwd);
  const b = parseBranch(info.branch);
  if (!b)
    throw new FailFirstUsageError(
      `브랜치 ${info.branch}가 계획 브랜치가 아니다. new-task로 만든 worktree 안에서 실행하라`,
    );
  const ref = findPlan(info.root, b.id);
  if (!ref || ref.where !== 'active')
    throw new FailFirstUsageError(`진행 중인 계획 ${b.id}를 찾을 수 없다`);
  return { info, plan: b.id, step: b.step };
}

function append(info: RepoInfo, rec: FailFirstRecord): FailFirstRecord {
  appendFileSync(failFirstFile(info), JSON.stringify(rec) + '\n');
  return rec;
}

/** 명령을 실행해 단언 실패면 기록한다. 기록하지 못하면 FailFirstError(이유) */
export async function failFirst(cwd: string, command: string): Promise<FailFirstRecord> {
  if (!command.trim()) throw new FailFirstUsageError('실행할 테스트 명령이 없다');
  const { info, plan, step } = current(cwd);
  const cfg = loadConfig(info.root);
  const r = await runShell(command, {
    cwd: info.root,
    timeoutMs: cfg.limits.acTimeoutSec * 1000,
  });
  const output = r.stdout + (r.stderr ? `\n${r.stderr}` : '');
  if (r.timedOut)
    throw new FailFirstError(
      `시간 제한(${cfg.limits.acTimeoutSec}초)을 넘겼다. 기록하지 않았다`,
      output,
    );
  if (r.code === 0)
    throw new FailFirstError(
      '테스트가 통과했다(종료 코드 0). 실패하는 테스트가 아니라서 기록하지 않았다. 구현 전에 실행해야 한다',
      output,
    );
  const re = new RegExp(cfg.ci.repro?.failPattern ?? DEFAULT_FAIL_PATTERN);
  const line = output.split(/\r?\n/).find((l) => re.test(l));
  if (line === undefined)
    throw new FailFirstError(
      `단언 실패가 아니다(종료 코드 ${r.code}. 모듈을 찾지 못함·문법 오류 등). 테스트가 실행돼 단언에서 실패해야 기록한다`,
      output,
    );
  return append(info, {
    ts: new Date().toISOString(),
    plan,
    step,
    kind: 'fail',
    command: oneLine(command, COMMAND_MAX),
    code: r.code,
    matched: oneLine(line, MATCHED_MAX),
    outputSha: createHash('sha256').update(output).digest('hex').slice(0, 12),
    head: git(['rev-parse', 'HEAD'], info.root),
  });
}

/** 실행 없이 예외를 기록한다 */
export function exemptFailFirst(cwd: string, reason: string): FailFirstRecord {
  const text = oneLine(reason, REASON_MAX);
  if (!text) throw new FailFirstUsageError('--exempt에는 사유가 있어야 한다');
  const { info, plan, step } = current(cwd);
  return append(info, {
    ts: new Date().toISOString(),
    plan,
    step,
    kind: 'exempt',
    reason: text,
    head: git(['rev-parse', 'HEAD'], info.root),
  });
}
