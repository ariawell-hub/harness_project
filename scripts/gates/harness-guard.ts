// harness-guard (10.3·10.4절, R9). 보호 경로를 바꾼 PR을 LLM 없이 규칙으로 검사한다.
// 실패(작성자가 고칠 것): CHANGELOG 누락, PR 본문의 보호 경로 체크리스트 누락, 워크플로 캐시 사용,
//   PR 코드를 실행하는 job(재현, 자체 테스트)의 environment·비밀·쓰기 권한.
// 신호(제작자 결정 2026-11-14): 검사 약화·샌드박스·권한 완화·정해 둔 environment 밖 참조·기존 자체 테스트 파일 변경은 표시만 하고
//   risk-gate가 위험도를 높음으로 올려 제작자 head 승인을 요구한다.
// 기준선은 base 커밋의 파일과 main 설정(cfg)이다. PR 트리의 설정을 기준으로 쓰지 않는다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { CONFIG_FILE } from '../lib/config.ts';
import { LITERAL_PATHSPECS, gitTry, showFile } from '../lib/git.ts';
import { matchesAny } from '../lib/util.ts';
import { changedFiles, type RiskSignal } from './risk-gate.ts';

export const CHANGELOG = 'docs/harness/CHANGELOG.md';
const WORKFLOWS = '.github/workflows/';
/** 자체 테스트의 실행기·시나리오(12.4절). base에 있던 파일을 고치거나 지우면 신호다 */
const SELFTEST = 'scripts/selftest/';
/** PR 코드를 실행하는 job(10.4절): job id이거나, 그 명령을 실행하는 job */
const PR_CODE_JOBS = [
  { id: 'repro', run: /harness\.ts repro\b/ },
  { id: 'selftest', run: /harness\.ts self-test\b/ },
];
const DOC = 'docs/harness/design.md 10.4절 보호 경로 정책 / docs/harness/workflow.md 5절';
/** harness.config.json에서 판정·권한에 걸리는 키. 바뀌면 신호다(TD-10) */
const CONFIG_KEYS = [
  'commands',
  'protectedPaths',
  'riskPaths',
  'stage',
  'bypass',
  'guard',
  'failure',
  'planReview',
  'testEffect',
  'testInertPaths',
  'ci',
  'deps',
  'agents',
  'prSize',
];
// 이 파일 자신이 "새로 들어간 위험 플래그"로 잡히지 않게 나눠 적는다
const DANGER_FLAGS = [
  '--dangerously-' + 'skip-permissions',
  'bypass' + 'Permissions',
  'danger-' + 'full-access',
];
const CODEX_KEYS = [
  'sandbox_mode',
  'approval_policy',
  'approvals_reviewer',
  'network_access',
  'hooks',
];

export interface HarnessGuardResult {
  result: { state: 'success' | 'failure' | 'error'; description: string; details: string[] };
  signals: RiskSignal[];
}

function jobIds(text: string): string[] {
  const i = text.search(/^jobs:\s*$/m);
  if (i < 0) return [];
  const ids: string[] = [];
  for (const line of text.slice(i).split('\n').slice(1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (m) ids.push(m[1]);
    else if (/^\S/.test(line)) break;
  }
  return ids;
}

function environments(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = /^\s*environment:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) return;
    let v = m[1];
    if (!v) v = /^\s*name:\s*(.*?)\s*(#.*)?$/.exec(lines[i + 1] ?? '')?.[1] ?? '';
    out.push(v.replace(/^['"]|['"]$/g, ''));
  });
  return out;
}

const writeLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z-]+:\s*write(-all)?$/.test(l) || l === 'permissions: write-all');

const usesCache = (text: string) =>
  text
    .split('\n')
    .some((l) => /uses:\s*actions\/cache/.test(l) || /^\s*cache(-dependency-path)?:/.test(l));

/**
 * 비밀 참조: `secrets.X`, `secrets['X']`, `toJSON(secrets)`, 재사용 워크플로의 `secrets: inherit`.
 * 꼴을 가리지 않고 `secrets`라는 낱말이 있으면 참조로 본다(주석만 있는 줄은 뺀다)
 */
const refsSecret = (lines: string[]) =>
  lines.some((l) => !/^\s*#/.test(l) && /\bsecrets\b/.test(l));

/**
 * PR 코드를 실행하는 job(10.4절)이 지켜야 할 것: environment·비밀·쓰기 권한이 없다. 어긴 내용을 돌려준다.
 * 대상: 재현 job(id가 `repro`이거나 `harness.ts repro`를 실행)과
 * 자체 테스트 job(id가 `selftest`이거나 `harness.ts self-test`를 실행).
 * job 밖(워크플로 최상위의 `env` 등)의 비밀 참조도 본다. 그 값은 모든 job이 물려받는다
 */
export function reproJobViolations(text: string): string[] {
  const i = text.search(/^jobs:\s*(#.*)?$/m);
  if (i < 0) return [];
  const blocks = new Map<string, string[]>();
  let cur: string | null = null;
  const rest = text.slice(i).split('\n').slice(1);
  // jobs 블록은 다음 최상위 키에서 끝난다. 첫 칸의 주석 줄은 블록을 끝내지 않는다
  let end = rest.length;
  for (let k = 0; k < rest.length; k++) {
    const line = rest[k];
    const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (m) {
      cur = m[1];
      blocks.set(cur, []);
    } else if (/^[^\s#]/.test(line)) {
      end = k;
      break;
    } else if (cur) blocks.get(cur)!.push(line);
  }
  const inherited = refsSecret([...text.slice(0, i).split('\n'), ...rest.slice(end)]);
  const out: string[] = [];
  for (const [id, lines] of blocks) {
    const body = lines.join('\n');
    if (!PR_CODE_JOBS.some((j) => j.id === id || j.run.test(body))) continue;
    if (environments(body).length) out.push(`${id}: environment를 참조한다`);
    if (refsSecret(lines)) out.push(`${id}: 비밀을 참조한다`);
    if (inherited) out.push(`${id}: 워크플로 최상위(job 밖)의 비밀 참조를 물려받는다`);
    if (writeLines(body).length) out.push(`${id}: 쓰기 권한이 있다`);
    if (!/^ {4}permissions:/m.test(body)) out.push(`${id}: job 권한을 적지 않았다`);
  }
  return out;
}

function parse(text: string | null): Record<string, unknown> | null {
  if (text === null) return {};
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function claudeSignals(
  file: string,
  baseText: string | null,
  headText: string,
  add: (r: string) => void,
) {
  const b = parse(baseText);
  const h = parse(headText);
  if (!b || !h) return add(`${file}: JSON을 읽을 수 없다`);
  const bp = (b.permissions ?? {}) as Record<string, unknown>;
  const hp = (h.permissions ?? {}) as Record<string, unknown>;
  const added = list(hp.allow).filter((x) => !list(bp.allow).includes(x));
  if (added.length) add(`${file}: permissions.allow 추가 — ${added.join(', ')}`);
  const removed = list(bp.deny).filter((x) => !list(hp.deny).includes(x));
  if (removed.length) add(`${file}: permissions.deny 삭제 — ${removed.join(', ')}`);
  if (JSON.stringify(bp.defaultMode) !== JSON.stringify(hp.defaultMode))
    add(`${file}: permissions.defaultMode 변경`);
  for (const k of ['hooks', 'disableBypassPermissionsMode', 'defaultMode']) {
    if (JSON.stringify(b[k]) !== JSON.stringify(h[k])) add(`${file}: ${k} 변경`);
  }
  for (const k of ['enableAllProjectMcpServers', 'disableAllHooks']) {
    if (h[k] === true && b[k] !== true) add(`${file}: ${k} 켬`);
  }
}

const tomlValue = (text: string, key: string) =>
  [...text.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*(#.*)?$`, 'gm'))]
    .map((m) => m[1])
    .join('|');

export function harnessGuard(o: {
  root: string;
  base: string;
  cfg: HarnessConfig;
  prBody: string | null;
  /**
   * 작성자 체크리스트(CHANGELOG 한 줄, PR 본문의 체크 줄)를 보지 않는다. revert-check가 확인한 revert PR에만 쓴다(10.3절).
   * 신호(위험도 높음)와 워크플로 검사는 그대로 낸다
   */
  skipAuthorChecks?: boolean;
}): HarnessGuardResult {
  const changed = changedFiles(o.root, o.base).map((f) => f.path);
  const prot = changed.filter((f) => matchesAny(f, o.cfg.protectedPaths));
  if (!prot.length)
    return {
      result: { state: 'success', description: '보호 경로 변경 없음', details: [] },
      signals: [],
    };

  const head = (f: string) => {
    const p = path.join(o.root, f);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const base = (f: string) => showFile(o.root, o.base, f);
  const failures: string[] = [];
  const reasons: string[] = [];
  const add = (r: string) => void reasons.push(r);

  // ---- 실패: 작성자가 고칠 것 ----
  const author = !o.skipAuthorChecks;
  if (author && !changed.includes(CHANGELOG))
    failures.push(
      `보호 경로를 바꿨는데 ${CHANGELOG}가 그대로다\n  고치는 법: "다음 버전" 아래에 한 줄을 남겨라\n  근거: ${DOC}`,
    );
  let bodyUnknown = false;
  if (author && o.prBody === null) bodyUnknown = true;
  else if (author && !/^\s*[-*] \[[xX]\] 보호 경로 변경:/m.test(o.prBody ?? ''))
    failures.push(
      `PR 본문에 체크된 "- [x] 보호 경로 변경: …" 줄이 없다\n  고치는 법: PR 템플릿의 자체 리뷰 항목을 확인하고 체크하라\n  근거: ${DOC}`,
    );
  const wfDir = path.join(o.root, WORKFLOWS);
  for (const name of existsSync(wfDir) ? readdirSync(wfDir).sort() : []) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = readFileSync(path.join(wfDir, name), 'utf8');
    for (const v of reproJobViolations(text))
      failures.push(
        `${WORKFLOWS}${name}: PR 코드를 실행하는 job ${v}\n  고치는 법: 재현 job과 자체 테스트 job에는 environment·비밀·쓰기 권한을 두지 마라\n  근거: docs/harness/design.md 10.4절 재현 job`,
      );
    if (usesCache(text))
      failures.push(
        `${WORKFLOWS}${name}: Actions 캐시를 쓴다\n  고치는 법: actions/cache와 setup-* 액션의 cache 옵션을 빼라\n  근거: docs/harness/design.md 10.4절 캐시 규칙`,
      );
  }

  // ---- 신호: 위험도 높음 ----
  const allowedEnvs = o.cfg.ci.environments;
  for (const f of prot) {
    const b = base(f);
    const h = head(f);
    if (f.startsWith(WORKFLOWS) && /\.ya?ml$/.test(f)) {
      if (h === null) {
        add(`워크플로 삭제: ${f}`);
        continue;
      }
      const gone = jobIds(b ?? '').filter((j) => !jobIds(h).includes(j));
      if (gone.length) add(`job 삭제: ${f} — ${gone.join(', ')}`);
      const outside = environments(h).filter((e) => !allowedEnvs.includes(e));
      if (outside.length)
        add(`정해 둔 environment 밖 참조: ${f} — ${[...new Set(outside)].join(', ')}`);
      const newWrite = writeLines(h).filter((l) => !writeLines(b ?? '').includes(l));
      if (newWrite.length)
        add(`워크플로 권한에 새 write: ${f} — ${[...new Set(newWrite)].join(', ')}`);
    } else if (f === CONFIG_FILE) {
      const bj = parse(b);
      const hj = h === null ? null : parse(h);
      if (!bj || !hj) add(`${f}: 삭제됐거나 JSON을 읽을 수 없다`);
      else {
        const diff = CONFIG_KEYS.filter((k) => JSON.stringify(bj[k]) !== JSON.stringify(hj[k]));
        const ex = (v: Record<string, unknown>) =>
          JSON.stringify((v.docLint as { exclude?: unknown })?.exclude);
        if (ex(bj) !== ex(hj)) diff.push('docLint.exclude');
        if (diff.length) add(`${f}: 판정 관련 설정 변경 — ${diff.join(', ')}`);
      }
    } else if (/^\.claude\/[^/]*settings[^/]*\.json$/.test(f)) {
      if (h === null) add(`${f}: 삭제`);
      else claudeSignals(f, b, h, add);
    } else if (f === '.codex/config.toml') {
      if (h === null) add(`${f}: 삭제`);
      else {
        const diff = CODEX_KEYS.filter((k) => tomlValue(b ?? '', k) !== tomlValue(h, k));
        if (diff.length) add(`${f}: ${diff.join(', ')} 변경`);
      }
    } else if (f === '.codex/hooks.json') {
      add(`${f}: ${h === null ? '삭제' : '변경'}`);
    } else if (f === '.gitignore') {
      const lines = (t: string | null) => (t ?? '').split('\n').map((l) => l.trim());
      const gone = ['.env', '.env.*'].filter((e) => lines(b).includes(e) && !lines(h).includes(e));
      if (gone.length) add(`.gitignore에서 ${gone.join(', ')} 항목 삭제`);
    }
    // 새 시나리오 추가는 신호가 아니다. 기존 실행기·시나리오를 바꾸면 자체 테스트가 약해질 수 있다(12.4절)
    if (f.startsWith(SELFTEST) && b !== null)
      add(`자체 테스트 파일 ${h === null ? '삭제' : '수정'}: ${f}`);
    if (h !== null && !f.endsWith('.md')) {
      // 파일 이름을 글자 그대로 넘긴다. pathspec으로 읽히면 glob에 맞는 다른 파일의 줄이 섞인다
      const d = gitTry(
        [LITERAL_PATHSPECS, 'diff', '-U0', '--no-renames', `${o.base}...HEAD`, '--', f],
        o.root,
      );
      const addedLines = d.stdout
        .split('\n')
        .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const hit = DANGER_FLAGS.filter((t) => addedLines.some((l) => l.includes(t)));
      if (hit.length) add(`위험 플래그 추가: ${f} — ${hit.join(', ')}`);
    }
  }

  const signals: RiskSignal[] = reasons.map((reason) => ({ risk: 'high', reason }));
  const details = [...failures, ...reasons.map((r) => `신호(위험도 높음): ${r}`)];
  if (failures.length) {
    const more = failures.length > 1 ? ` 외 ${failures.length - 1}건` : '';
    return {
      result: { state: 'failure', description: failures[0].split('\n')[0] + more, details },
      signals,
    };
  }
  if (bodyUnknown)
    return {
      result: {
        state: 'error',
        description: 'PR 본문을 읽지 못해 보호 경로 체크리스트를 확인할 수 없다',
        details,
      },
      signals,
    };
  return {
    result: {
      state: 'success',
      description: reasons.length
        ? `보호 경로 변경 ${prot.length}개: 신호 ${reasons.length}건(위험도 높음, 제작자 승인 필요)`
        : `보호 경로 변경 ${prot.length}개: 통과`,
      details,
    },
    signals,
  };
}
