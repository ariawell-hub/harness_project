// 재현 job(10.2절 (3), 10.4절): 검증자가 낸 재현 테스트를 PR 체크아웃에 붙여 하나씩 실행한다.
// 이 job은 PR 코드를 실행한다. 비밀·environment·쓰기 권한·캐시 없이 돌고, 결과는 조작될 수 있다고 본다:
// "재현됨"은 차단 근거로만 쓰고, "재현 안 됨"으로는 아무것도 닫지 않는다(검증자가 다음 라운드에 확인한다).
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSync } from '../lib/exec.ts';
import type { ReproResult } from './ledger.ts';
import type { Verdict } from './verdict.ts';

export interface ReproConfig {
  /** 재현 테스트를 둘 폴더(리포 루트 기준). 이 폴더 바로 아래에만 쓴다 */
  dir: string;
  /** 테스트 하나를 실행하는 명령. 끝에 파일 경로를 붙인다 */
  command: string[];
  /** 실패 출력에 이 정규식이 보여야 "재현됨"이다(단언 실패). 문법·import 오류를 재현으로 세지 않기 위해서다 */
  failPattern: string;
  timeoutSec: number;
}

export interface ReproOutcome {
  /** 판정 findings의 순번 */
  index: number;
  result: Exclude<ReproResult, ''>;
}

const NAME_RE = /^harness-repro-[a-z0-9][a-z0-9-]{0,59}\.test\.(?:ts|mts|js|mjs|cjs)$/;

/** 재현 테스트 경로: 설정한 폴더 바로 아래의 `harness-repro-<소문자·숫자·->.test.<ts|js|…>` */
export function reproPathOk(p: string, dir: string): boolean {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  return p.startsWith(prefix) && NAME_RE.test(p.slice(prefix.length));
}

/**
 * 테스트 프로세스에 넘길 환경. 러너의 변수(GITHUB_*, 토큰 경로 등)는 넘기지 않는다.
 * HOME과 임시 폴더는 러너의 것이 아니라 이 실행을 위해 만든 빈 폴더다(홈의 설정·자격증명 파일을 가리키지 않게)
 */
function childEnv(scratch: string): NodeJS.ProcessEnv {
  const keep = ['PATH', 'LANG', 'SystemRoot'];
  return {
    ...Object.fromEntries(
      keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]),
    ),
    HOME: scratch,
    USERPROFILE: scratch,
    TMPDIR: scratch,
    TEMP: scratch,
    TMP: scratch,
  };
}

/**
 * 판정의 재현 테스트를 하나씩 붙여 실행한다. 설정이 없으면 실행하지 않는다.
 * 실패 + 단언 실패 출력 = reproduced, 통과 = not-reproduced, 그 밖(경로 오류, 덮어쓰기, 시간 초과, 실행 오류) = error
 */
export function runRepro(o: {
  /** PR head 체크아웃 */
  root: string;
  verdict: Verdict;
  cfg: ReproConfig | null;
}): ReproOutcome[] {
  if (!o.cfg) return [];
  const cfg = o.cfg;
  const out: ReproOutcome[] = [];
  const fail = new RegExp(cfg.failPattern);
  const root = realpathSync(o.root);
  const scratch = mkdtempSync(path.join(tmpdir(), 'harness-repro-'));
  for (const [index, f] of o.verdict.findings.entries()) {
    if (f.repro.content === '') continue;
    const done = (result: ReproOutcome['result']) => void out.push({ index, result });
    if (!reproPathOk(f.repro.path, cfg.dir)) {
      done('error');
      continue;
    }
    const file = path.join(root, f.repro.path);
    const parent = path.dirname(file);
    // 폴더가 리포 안의 실제 폴더여야 하고(심볼릭 링크로 밖을 가리키면 안 된다) 같은 이름의 파일이 없어야 한다
    const parentOk =
      existsSync(parent) &&
      lstatSync(parent).isDirectory() &&
      realpathSync(parent) === path.join(root, path.dirname(f.repro.path));
    if (!parentOk || lstatSync(file, { throwIfNoEntry: false })) {
      done('error');
      continue;
    }
    try {
      writeFileSync(file, f.repro.content, { flag: 'wx' });
      const r = runSync(cfg.command[0], [...cfg.command.slice(1), f.repro.path], {
        cwd: root,
        env: childEnv(scratch),
        timeoutMs: cfg.timeoutSec * 1000,
      });
      if (r.code === 0) done('not-reproduced');
      else done(fail.test(`${r.stdout}\n${r.stderr}`) ? 'reproduced' : 'error');
    } catch {
      done('error');
    } finally {
      rmSync(file, { force: true });
    }
  }
  return out;
}

/** job 사이에 넘길 값(base64 JSON). 없으면 '' */
export function reproResultsData(list: readonly ReproOutcome[]): string {
  return list.length ? Buffer.from(JSON.stringify(list), 'utf8').toString('base64') : '';
}

const RESULTS: readonly string[] = ['reproduced', 'not-reproduced', 'error'];

/** 재현 job이 넘긴 값을 읽는다. 순번(0 이상, findings 수 미만, 중복 없음)과 값만 받는다. 형식이 다르면 null */
export function parseReproResults(data: string, findings: number): ReproOutcome[] | null {
  if (data === '') return [];
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length > findings) return null;
  const out: ReproOutcome[] = [];
  for (const x of raw as unknown[]) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const r = x as Record<string, unknown>;
    if (Object.keys(r).length !== 2) return null;
    if (!Number.isInteger(r.index) || (r.index as number) < 0 || (r.index as number) >= findings)
      return null;
    if (typeof r.result !== 'string' || !RESULTS.includes(r.result)) return null;
    if (out.some((p) => p.index === r.index)) return null;
    out.push({ index: r.index as number, result: r.result as ReproOutcome['result'] });
  }
  return out;
}
