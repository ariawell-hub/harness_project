// test-effect (R5, 설계서 5.1절): 추가·수정된 테스트 파일이 merge-base 코드에서 실패하는가.
// base 코드를 임시 worktree로 체크아웃하고 head의 테스트 파일(과 보조 파일)을 덮어써 파일마다 실행한다.
// 거기서도 통과하는 테스트 파일은 이 변경을 잡아내지 못한다. head에서 통과하는지는 `test`가 본다.
// 실행 명령은 설정(testEffect.command, 인자 배열)에서만 읽고 셸을 쓰지 않는다.
// 테스트 프로세스의 출력은 어디에도 옮기지 않는다(비밀이 섞일 수 있다). 판정에는 종료 코드만 쓴다.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HarnessConfig, TestEffectConfig } from '../lib/config.ts';
import { run } from '../lib/exec.ts';
import { git, gitTry, LITERAL_PATHSPECS } from '../lib/git.ts';
import { matchesAny, type Problem } from '../lib/util.ts';

export type TestEffectOutcome = 'effective' | 'ineffective' | 'restored' | 'exempt' | 'invalid';
/**
 * base에서 실패한 이유(설정 testEffect.assertPattern이 있을 때만 나눈다).
 * assertion: 단언 실패, other: 그 밖(모듈 없음, 문법 오류 등. 이 검사로는 단언을 확인하지 못했다), timeout: 시간 초과.
 * 나누지 않았거나 base에서 실패하지 않은 판정은 null
 */
export type TestEffectReason = 'assertion' | 'other' | 'timeout' | null;
export interface TestEffectItem {
  file: string;
  outcome: TestEffectOutcome;
  detail: string;
  reason: TestEffectReason;
}
export interface TestEffectResult {
  skipped: boolean;
  items: TestEffectItem[];
  problems: Problem[];
  /** 막지 않는 안내(명령과 check가 `참고:`로 낸다) */
  notes: string[];
}

const RULE = 'R5 테스트 실효성';
const DOC = 'docs/harness/design.md 5.1절 R5';
const REASON_SLOT = '<한 줄>';
/** 이전 판을 찾을 때 보는, 그 경로를 바꾼 최근 커밋 수 */
const HISTORY = 30;
const CONCURRENCY = 4;
const PLAN_RE = /^docs\/exec-plans\/.+\.md$/;
const EXEMPT_RE = /^- test-effect 예외: `([^`]+)` @ `([0-9a-f]{40})` — 사유: (.*)$/;

/** 예외 줄(고치는 법에 그대로 낸다). 사유 자리는 `<한 줄>`로 둔다 */
export function exemptLine(file: string, blob: string): string {
  return `- test-effect 예외: \`${file}\` @ \`${blob}\` — 사유: ${REASON_SLOT}`;
}

/** 계획 파일의 예외 줄. 줄 전체가 형식에 맞고 사유가 채워져 있어야 읽는다 */
export function parseExemptions(text: string): { file: string; blob: string; reason: string }[] {
  const out: { file: string; blob: string; reason: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = EXEMPT_RE.exec(line);
    if (!m) continue;
    const reason = m[3].trim();
    if (reason === '' || reason === REASON_SLOT) continue;
    out.push({ file: m[1], blob: m[2], reason });
  }
  return out;
}

// 테스트 파일·보조 파일의 이름은 PR이 정한다. git의 경로 인자로 넘길 때는 글자 그대로 읽게 한다(LITERAL_PATHSPECS)
const list = (out: string) => out.split('\0').filter(Boolean);

/** base 대비 추가·수정되었거나 파일 종류가 바뀐 파일. 이름 변경은 삭제 + 추가로 본다 */
function changed(root: string, base: string, committedOnly: boolean): string[] {
  const diff = ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=AMT', base];
  if (committedOnly) return list(git([...diff, 'HEAD'], root));
  const untracked = list(git(['ls-files', '--others', '--exclude-standard', '-z'], root));
  return [...new Set([...list(git(diff, root)), ...untracked])];
}

/** head 판의 blob. 일반 파일이 아니면 null */
function headBlob(root: string, file: string, committedOnly: boolean): string | null {
  if (committedOnly) {
    const m = /^(\d{6}) blob ([0-9a-f]{40})\t/.exec(
      git([LITERAL_PATHSPECS, 'ls-tree', 'HEAD', '--', file], root),
    );
    return m && (m[1] === '100644' || m[1] === '100755') ? m[2] : null;
  }
  const st = lstatSync(path.join(root, file), { throwIfNoEntry: false });
  return st?.isFile() ? git(['hash-object', '--', file], root) : null;
}

/** 그 경로의 base 판과 이전 판(base에서 그 경로를 바꾼 최근 커밋들의 판)의 blob */
function pastBlobs(root: string, base: string, file: string): Set<string> {
  const out = new Set<string>();
  const commits = git(
    [LITERAL_PATHSPECS, 'rev-list', '-n', String(HISTORY), base, '--', file],
    root,
  );
  for (const c of commits.split('\n').filter(Boolean)) {
    const r = gitTry(['rev-parse', '-q', '--verify', `${c}:${file}`], root);
    if (r.ok) out.add(r.stdout.trim());
  }
  return out;
}

function headText(root: string, file: string, committedOnly: boolean): string {
  if (committedOnly) return gitTry(['show', `HEAD:${file}`], root).stdout;
  const f = path.join(root, file);
  return lstatSync(f, { throwIfNoEntry: false })?.isFile() ? readFileSync(f, 'utf8') : '';
}

/** 연결만 지운다(원본을 따라가 지우지 않는다). 지웠으면 true */
function removeLink(p: string): boolean {
  try {
    unlinkSync(p);
    return true;
  } catch {
    try {
      rmdirSync(p); // Windows junction
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * base 체크아웃 안의 `rel`에 써도 되는가. 심볼릭 링크를 따라가지 않는다(base 트리에 커밋된 링크가 밖을 가리킬 수 있다).
 * 상위 경로는 이미 있으면 실제 폴더여야 하고 없으면 만든다. `replace`면 목적지의 링크를 지우고 그 자리에 쓰게 한다.
 * 돌려주는 값: 'ok'(쓸 수 있다), 'exists'(replace가 아닌데 이미 있다), 'unsafe'
 */
function prepareDest(wt: string, rel: string, replace: boolean): 'ok' | 'exists' | 'unsafe' {
  const parts = rel.split('/').filter(Boolean);
  let cur = wt;
  for (const part of parts.slice(0, -1)) {
    cur = path.join(cur, part);
    const st = lstatSync(cur, { throwIfNoEntry: false });
    if (!st) mkdirSync(cur);
    else if (!st.isDirectory()) return 'unsafe';
  }
  const dst = path.join(cur, parts[parts.length - 1]);
  const st = lstatSync(dst, { throwIfNoEntry: false });
  if (!st) return 'ok';
  if (!replace) return 'exists';
  if (st.isFile()) return 'ok';
  if (st.isSymbolicLink()) return removeLink(dst) ? 'ok' : 'unsafe';
  return 'unsafe';
}

type Decided = { outcome: TestEffectOutcome; detail: string; reason?: TestEffectReason };

/** base 체크아웃에서 파일마다 실행한다. 종료 코드 0이면 통과다 */
async function runOnBase(o: {
  root: string;
  base: string;
  cfg: TestEffectConfig;
  files: string[];
  /** 이 변경이 추가·수정한 보조 파일 가운데 head 판이 일반 파일인 것 */
  support: string[];
  committedOnly: boolean;
}): Promise<Map<string, Decided>> {
  const { root, cfg } = o;
  const out = new Map<string, Decided>();
  const dir = mkdtempSync(path.join(tmpdir(), 'harness-test-effect-'));
  const wt = path.join(dir, 'base');
  const links: string[] = [];
  let linksGone = true;
  try {
    git(['worktree', 'add', '--detach', '-q', wt, o.base], root);
    // 덮어쓸 자리를 먼저 모두 확인한다. 테스트 파일이 걸리면 그 파일만, 보조 파일·연결이 걸리면 전부 실행하지 않는다
    const tests: string[] = [];
    for (const f of o.files) {
      if (prepareDest(wt, f, true) === 'ok') tests.push(f);
      else out.set(f, { outcome: 'invalid', detail: `base 체크아웃에 쓸 수 없는 경로다(${f})` });
    }
    const blocked = o.support.filter((f) => prepareDest(wt, f, true) !== 'ok');
    const toLink: string[] = [];
    for (const l of cfg.link) {
      if (!existsSync(path.join(root, l))) continue;
      const dest = prepareDest(wt, l, false);
      if (dest === 'unsafe') blocked.push(l);
      else if (dest === 'ok') toLink.push(l);
    }
    if (blocked.length) {
      const detail = `base 체크아웃을 준비하지 못했다(쓸 수 없는 경로: ${blocked.join(', ')})`;
      for (const f of tests) out.set(f, { outcome: 'invalid', detail });
      return out;
    }
    const overlay = [...tests, ...o.support];
    if (overlay.length === 0) return out;
    if (o.committedOnly) {
      git(
        [LITERAL_PATHSPECS, 'checkout', '-q', git(['rev-parse', 'HEAD'], root), '--', ...overlay],
        wt,
      );
    } else {
      for (const f of overlay) copyFileSync(path.join(root, f), path.join(wt, f));
    }
    for (const l of toLink) {
      const src = path.join(root, l);
      const dst = path.join(wt, l);
      symlinkSync(src, dst, lstatSync(src).isDirectory() ? 'junction' : 'file');
      links.push(dst);
    }
    // 이 변수가 있으면 중첩된 `node --test`가 테스트를 건너뛰고 0으로 끝난다
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    // 출력은 이 정규식을 대 보는 데만 쓴다. 결과·로그에 옮기지 않는다
    const assertRe = cfg.assertPattern ? new RegExp(cfg.assertPattern) : null;
    const queue = [...tests];
    const worker = async () => {
      for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
        const r = await run(cfg.command[0], [...cfg.command.slice(1), f], {
          cwd: wt,
          env,
          timeoutMs: cfg.timeoutSec * 1000,
        });
        if (r.timedOut)
          out.set(f, {
            outcome: 'effective',
            detail: 'base에서 시간 초과',
            reason: assertRe ? 'timeout' : null,
          });
        else if (r.code === 127 && r.stderr.includes('[exec] 실행 실패'))
          out.set(f, { outcome: 'invalid', detail: 'testEffect.command를 실행하지 못했다' });
        else if (r.code === 0) out.set(f, { outcome: 'ineffective', detail: 'base에서도 통과' });
        else if (!assertRe)
          out.set(f, { outcome: 'effective', detail: `base에서 실패, 종료 코드 ${r.code}` });
        else if (assertRe.test(`${r.stdout}\n${r.stderr}`))
          out.set(f, {
            outcome: 'effective',
            detail: `base에서 단언 실패, 종료 코드 ${r.code}`,
            reason: 'assertion',
          });
        else
          out.set(f, {
            outcome: 'effective',
            detail: `base에서 실패(단언 실패 아님: 모듈 없음 등), 종료 코드 ${r.code}`,
            reason: 'other',
          });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tests.length) }, worker));
  } finally {
    for (const l of links) if (!removeLink(l)) linksGone = false;
    gitTry(['worktree', 'remove', '--force', wt], root);
    gitTry(['worktree', 'prune'], root);
    // 연결이 남았으면 재귀 삭제하지 않는다(원본을 따라가 지울 수 있다)
    if (linksGone) rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

export async function testEffect(
  root: string,
  cfg: HarnessConfig,
  o: { base: string | null; committedOnly: boolean },
): Promise<TestEffectResult> {
  const te = cfg.testEffect;
  if (!te || !o.base) return { skipped: true, items: [], problems: [], notes: [] };
  // base가 head의 조상이 아니면(뒤처진 브랜치) 공통 조상과 비교한다
  const mb = gitTry(['merge-base', o.base, 'HEAD'], root);
  const base = mb.ok ? mb.stdout.trim() : o.base;
  const all = changed(root, base, o.committedOnly);
  const targets = all.filter((f) => matchesAny(f, te.files)).sort();
  if (targets.length === 0) return { skipped: false, items: [], problems: [], notes: [] };

  const exemptions = all
    .filter((f) => PLAN_RE.test(f))
    .flatMap((f) => parseExemptions(headText(root, f, o.committedOnly)));
  const decided = new Map<string, Decided>();
  const blobs = new Map<string, string>();
  const toRun: string[] = [];
  for (const f of targets) {
    if (f.startsWith('-')) {
      decided.set(f, { outcome: 'invalid', detail: '경로가 `-`로 시작한다' });
      continue;
    }
    const blob = headBlob(root, f, o.committedOnly);
    if (!blob) {
      decided.set(f, { outcome: 'invalid', detail: '일반 파일이 아니다' });
      continue;
    }
    blobs.set(f, blob);
    const ex = exemptions.find((e) => e.file === f && e.blob === blob);
    if (pastBlobs(root, base, f).has(blob))
      decided.set(f, { outcome: 'restored', detail: '이전 판과 같다' });
    else if (ex) decided.set(f, { outcome: 'exempt', detail: `사유: ${ex.reason}` });
    else toRun.push(f);
  }
  if (toRun.length) {
    const ran = await runOnBase({
      root,
      base,
      cfg: te,
      files: toRun,
      // head 판이 일반 파일인 보조 파일만 덮어쓴다
      support: all.filter(
        (f) =>
          matchesAny(f, te.support) &&
          !targets.includes(f) &&
          headBlob(root, f, o.committedOnly) !== null,
      ),
      committedOnly: o.committedOnly,
    });
    for (const [f, r] of ran) decided.set(f, r);
  }

  const items: TestEffectItem[] = targets.map((file) => {
    const d = decided.get(file)!;
    return { file, outcome: d.outcome, detail: d.detail, reason: d.reason ?? null };
  });
  const problems: Problem[] = [];
  for (const i of items) {
    if (i.outcome === 'ineffective')
      problems.push({
        rule: RULE,
        what: `${i.file}: 추가·수정한 테스트 파일이 변경 전 코드(${base.slice(0, 12)})에서도 통과한다. 이 변경을 잡아내지 못한다`,
        how: `변경 전 코드에서 실패하는 테스트로 고쳐라. 기존 동작을 확인하는 테스트나 테스트 리팩터라면 이 변경의 계획 파일(의사결정 로그)에 다음 줄을 사유를 채워 적어라: ${exemptLine(i.file, blobs.get(i.file)!)}`,
        doc: DOC,
      });
    else if (i.outcome === 'invalid')
      problems.push({
        rule: RULE,
        what: `${i.file}: 검사하지 못했다(${i.detail})`,
        how: '테스트 파일은 `-`로 시작하지 않는 경로의 일반 파일로 두고, 테스트·보조 파일·testEffect.link의 상위 경로에 심볼릭 링크가 없게 하고, harness.config.json의 testEffect.command가 실행되는지 확인하라',
        doc: DOC,
      });
  }
  const others = items.filter((i) => i.reason === 'other').length;
  const notes = others
    ? [
        `변경 전 코드에서 단언 실패가 아닌 이유(모듈 없음 등)로 실패한 테스트 파일 ${others}개: 이 검사로는 그 파일의 단언을 확인하지 못했다. 테스트가 동작을 단언하는지 직접 확인하라`,
      ]
    : [];
  return { skipped: false, items, problems, notes };
}
