// metrics(17.2절): 지표를 집계해 출력하고, --write면 docs/QUALITY_SCORE.md의 표식 구간을 바꾼다.
// GitHub은 읽기만 한다. 순서가 규칙이다: 기간 검사 → 쓰기 전 조건 → 자료 읽기 → 계산 → 출력·쓰기.
// 자료를 다 읽지 못하면 아무것도 내지 않는다(종료 코드 2). 메인 체크아웃과 기본 브랜치에서는 쓰지 않는다(R3).
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import type { Ledger } from '../ci/ledger.ts';
import { loadConfig } from '../lib/config.ts';
import { repoInfo } from '../lib/git.ts';
import { isMainCheck, pilotMetrics } from '../metrics/pilot.ts';
import { renderBlock, replaceBlock } from '../metrics/render.ts';
import {
  daysBefore,
  defaultSource,
  parsePeriod,
  type MetricsSource,
  type Period,
} from '../metrics/source.ts';

export const METRICS_DOC = 'docs/QUALITY_SCORE.md';
/** 기간 직전의 main `check` 결론을 찾으러 거슬러 올라가는 날 수 */
const PRIOR_DAYS = 7;

export interface MetricsOptions {
  since?: string;
  until?: string;
  write: boolean;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
  /** 파일에 바이트를 쓰는 함수(기본 `writeSync`). 쓴 바이트 수를 돌려준다. 테스트가 짧은 쓰기와 실패를 끼운다 */
  writeBytes?: (fd: number, buf: Uint8Array, offset: number, length: number) => number;
}

const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** 쓸 수 없는 문서. 메시지는 "무엇 + 고치는 법"이다 */
class DocError extends Error {}

const DOC_DIR = path.dirname(METRICS_DOC);
const DOC_NAME = path.basename(METRICS_DOC);
const NO_DOC = `${METRICS_DOC}가 없다. 문서를 만들고 표식 구간을 넣은 뒤 다시 실행하라`;
const DOC_IS_LINK = `${METRICS_DOC}가 심볼릭 링크다. 링크가 가리키는 곳은 고치지 않는다(R3). 일반 파일로 바꿔라`;
// Windows에는 이 플래그들이 없다(undefined). 그때는 0이다
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = constants.O_NONBLOCK ?? 0;

const errCode = (e: unknown) =>
  typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * 문서 폴더를 현재 작업 폴더로 삼아 `fn`을 실행한다(R3). `fn`은 상대 이름(`DOC_NAME`)으로만 읽고 쓴다.
 *
 * 경로를 확인한 뒤에 그 경로로 다시 열면, 그 사이에 `docs`가 worktree 밖을 가리키는 심볼릭 링크로 바뀌었을 때 밖을 쓰게 된다.
 * 그래서 먼저 폴더로 들어가고, 들어온 폴더의 실제 경로(`process.cwd()`는 커널이 아는 경로를 돌려준다)가
 * worktree 안의 그 폴더인지 본다. 그 뒤의 상대 이름 작업은 경로가 아니라 들어온 폴더 자체에 묶인다
 */
function inDocDir<T>(root: string, fn: () => T): T {
  const expected = path.join(realpathSync(root), DOC_DIR);
  const prev = process.cwd();
  try {
    process.chdir(path.join(root, DOC_DIR));
  } catch {
    throw new DocError(NO_DOC);
  }
  try {
    if (!samePath(process.cwd(), expected))
      throw new DocError(
        `${DOC_DIR} 폴더가 작업 worktree 밖을 가리킨다(심볼릭 링크). worktree 밖의 파일은 고치지 않는다(R3). 폴더를 실제 폴더로 되돌려라`,
      );
    return fn();
  } finally {
    try {
      process.chdir(prev);
    } catch {
      // 원래 폴더가 사라졌다. fn의 결과나 오류를 가리지 않는다
    }
  }
}

/** 현재 폴더의 문서를 읽는다. 일반 파일일 때만 읽는다(`inDocDir` 안에서 부른다) */
function readDocHere(): { mode: number; text: string } {
  const st = lstatSync(DOC_NAME, { throwIfNoEntry: false });
  if (!st) throw new DocError(NO_DOC);
  if (st.isSymbolicLink()) throw new DocError(DOC_IS_LINK);
  let fd: number;
  try {
    // 확인과 열기 사이에 링크로 바뀐 경우는 O_NOFOLLOW가 막는다. O_NONBLOCK은 FIFO에서 멈추지 않게 한다
    fd = openSync(DOC_NAME, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    const code = errCode(e);
    if (code === 'ELOOP' || code === 'EMLINK') throw new DocError(DOC_IS_LINK);
    if (code === 'ENOENT') throw new DocError(NO_DOC);
    throw e;
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile())
      throw new DocError(`${METRICS_DOC}가 일반 파일이 아니다. 일반 파일로 바꿔라`);
    return { mode: opened.mode & 0o777, text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}

type WriteBytes = NonNullable<MetricsOptions['writeBytes']>;

/** `buf`를 끝까지 쓴다. `write`는 일부만 쓰고 그 수를 돌려줄 수 있다(디스크가 거의 찼을 때 등) */
export function writeAll(fd: number, buf: Uint8Array, write: WriteBytes): void {
  let off = 0;
  while (off < buf.length) {
    const n = write(fd, buf, off, buf.length - off);
    if (!Number.isInteger(n) || n <= 0 || n > buf.length - off)
      throw new Error(`쓰기가 진행되지 않는다(${off}/${buf.length}바이트에서 ${n})`);
    off += n;
  }
}

/**
 * 현재 폴더의 문서를 새 내용으로 바꾼다(`inDocDir` 안에서 부른다).
 * 임시 파일을 새로 만들어(`wx`) 끝까지 쓰고, 크기를 확인하고, 디스크에 내린 뒤에만 이름을 바꿔 덮는다.
 * - 그 자리의 것이 심볼릭 링크로 바뀌었거나 다른 파일과 하드 링크로 묶여 있어도 바뀌는 것은 이 폴더 안의 이름뿐이다
 * - 쓰기·닫기가 실패하거나 일부만 쓰였으면 원본은 그대로이고 임시 파일은 지운다
 */
function replaceDocHere(text: string, mode: number, write: WriteBytes): void {
  const buf = Buffer.from(text, 'utf8');
  const tmp = `.${DOC_NAME}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'wx', mode);
  let renamed = false;
  try {
    let closed = false;
    try {
      writeAll(fd, buf, write);
      const size = fstatSync(fd).size;
      if (size !== buf.length)
        throw new Error(`임시 파일의 크기가 다르다(${size}/${buf.length}바이트)`);
      fsyncSync(fd);
      closed = true;
      closeSync(fd);
    } finally {
      if (!closed) {
        try {
          closeSync(fd);
        } catch {
          // 앞선 오류를 그대로 올린다
        }
      }
    }
    renameSync(tmp, DOC_NAME);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        unlinkSync(tmp);
      } catch {
        // 이미 없으면 둔다
      }
    }
  }
}

/**
 * 기간 직전의 마지막 main `check` 실행(결론이 success·failure인 것)의 결론.
 * 전날부터 하루씩 거슬러 그런 실행이 처음 나온 날의 가장 늦은 실행을 쓴다. 없으면 null
 */
function priorMainCheck(
  source: MetricsSource,
  p: Period,
  defaultBranch: string,
): 'success' | 'failure' | null {
  for (let n = 1; n <= PRIOR_DAYS; n++) {
    const day = daysBefore(p.since, n);
    let last: { t: number; conclusion: 'success' | 'failure' } | null = null;
    for (const r of source.workflowRuns({ since: day, until: day })) {
      if (!isMainCheck(r, defaultBranch)) continue;
      if (r.conclusion !== 'success' && r.conclusion !== 'failure') continue;
      const t = Date.parse(r.createdAt);
      if (Number.isNaN(t)) continue;
      if (!last || t >= last.t) last = { t, conclusion: r.conclusion };
    }
    if (last) return last.conclusion;
  }
  return null;
}

export function runMetrics(cwd: string, o: MetricsOptions, source?: MetricsSource): number {
  const out = o.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l: string) => process.stderr.write(`${l}\n`));

  // ① 기간
  let period: Period;
  try {
    period = parsePeriod(o.since, o.until, o.now ?? new Date());
  } catch (e) {
    err(`metrics: ${first(e)}. 날짜는 UTC 기준 YYYY-MM-DD로 준다(예: --since 2026-11-11)`);
    return 1;
  }

  // ② 쓰기 전 조건. GitHub을 읽기 전에 본다
  const info = repoInfo(cwd);
  const cfg = loadConfig(info.root);
  if (o.write) {
    if (info.isMainCheckout || info.branch === cfg.github.defaultBranch) {
      err(
        `metrics: 메인 체크아웃과 기본 브랜치(${cfg.github.defaultBranch})에서는 --write로 파일을 고치지 않는다(R3). 작업 worktree에서 실행하라. 값만 보려면 --write를 빼라`,
      );
      return 1;
    }
    try {
      if (replaceBlock(inDocDir(info.root, readDocHere).text, '') === null)
        throw new DocError(
          `${METRICS_DOC}에서 표식 구간을 찾지 못했다. "<!-- metrics:begin -->" 줄과 "<!-- metrics:end -->" 줄을 이 순서로 하나씩 넣어라`,
        );
    } catch (e) {
      err(`metrics: ${first(e)}`);
      return 1;
    }
  }

  // ③ 자료 읽기. 하나라도 읽지 못하면 값을 내지 않는다
  let block: string;
  try {
    const src = source ?? defaultSource(info.root, cfg);
    const prs = src.mergedPrs(period);
    const runs = src.workflowRuns(period);
    const bugs = src.bugIssues(period);
    const ledgers = new Map<number, Ledger | null>();
    for (const p of prs) ledgers.set(p.number, src.ledger(p.number));
    const prior = priorMainCheck(src, period, cfg.github.defaultBranch);
    // ④ 계산·렌더
    block = renderBlock(
      period,
      pilotMetrics({
        period,
        defaultBranch: cfg.github.defaultBranch,
        priorMainCheck: prior,
        prs,
        runs,
        bugs,
        ledgers,
      }),
    );
  } catch (e) {
    err(
      `metrics: ${first(e)}. 집계하지 않았고 문서도 바꾸지 않았다(자료를 일부만 읽은 값은 내지 않는다). gh 인증과 네트워크를 확인하고 다시 실행하라`,
    );
    return 2;
  }

  // ⑤ 출력·쓰기
  out(block);
  if (o.write) {
    // 자료를 읽는 동안 문서가 바뀌었을 수 있다. 조건을 다시 보고 지금 내용에서 구간만 바꾼다
    try {
      inDocDir(info.root, () => {
        const doc = readDocHere();
        const next = replaceBlock(doc.text, block);
        if (next === null)
          throw new DocError(`자료를 읽는 동안 ${METRICS_DOC}의 표식 구간이 사라졌다`);
        replaceDocHere(next, doc.mode, o.writeBytes ?? writeSync);
      });
    } catch (e) {
      err(`metrics: ${first(e)}. 문서를 쓰지 않았다`);
      return 1;
    }
    err(`metrics: ${METRICS_DOC}의 집계 결과를 바꿨다`);
  }
  return 0;
}
