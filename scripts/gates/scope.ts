// scope (R18, 14.6절): PR이 바꾼 파일 가운데 계획의 "관련 파일·문서"에 없는 것을 경고로 보인다. 병합을 막지 않는다.
// 계획은 PR 트리의 것을 데이터로 읽는다. 범위 경로는 계획 검증의 해시에 들어가는 글자(boundPlanSection)에서만 뽑는다:
// 그 글자의 순수 함수라서, 승인 뒤에 범위 경로가 바뀌면 해시도 바뀐다. git은 root에서 읽기만 한다.
// 계획은 작업 폴더가 아니라 HEAD 커밋에 추적된 일반 파일로만 읽는다: 심볼릭 링크를 따라가 PR 트리 밖의 파일을 읽지 않는다.
import { git } from '../lib/git.ts';
import {
  boundPlanSection,
  parseBranch,
  parseDoc,
  planCandidates,
  stripHtmlComments,
} from '../lib/plan.ts';
import { type PlanRef } from '../lib/plan.ts';
import { capDetails, globToRegExp, showPath, WARN_PREFIX } from '../lib/util.ts';
import { changedFiles } from './risk-gate.ts';

const DOC = 'docs/harness/design.md 14.6절, R18';
/** details에 적는 파일 수 상한 */
const FILE_LIMIT = 30;
/** description에 적는 경로 하나의 글자 수 상한 */
const PATH_IN_DESCRIPTION = 60;

/**
 * 줄마다 코드 블록 안인지 가린다. 여는 펜스(백틱이나 물결 셋 이상)의 글자와 길이를 기억하고,
 * 같은 글자가 그 길이 이상이고 다른 글자가 없는 줄에서만 닫는다. 닫히지 않은 블록은 끝까지다.
 * 펜스 줄 자신도 코드 블록 안으로 친다
 */
function fenced(lines: string[]): boolean[] {
  let open: { ch: string; len: number } | null = null;
  return lines.map((line) => {
    if (open) {
      const m = /^\s*(`+|~+)\s*$/.exec(line);
      if (m && m[1][0] === open.ch && m[1].length >= open.len) open = null;
      return true;
    }
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    // 백틱 펜스의 정보 문자열에는 백틱이 올 수 없다(그런 줄은 인라인 코드다)
    if (!m || (m[1][0] === '`' && m[2].includes('`'))) return false;
    open = { ch: m[1][0], len: m[1].length };
    return true;
  });
}

/**
 * "관련 파일·문서" 섹션의 글자에서 범위 경로를 뽑는다(나온 순서, 중복 없음). 순수 함수다.
 * 코드 블록 밖의 `## ` 줄이 나오면 거기서 그친다(해시의 섹션 추출이 제목을 놓친 경우다. 뒤는 다른 섹션이다)
 */
export function scopePaths(sectionText: string): string[] {
  const all = sectionText.split('\n');
  const inFence = fenced(all);
  const end = all.findIndex((l, i) => !inFence[i] && /^##\s/.test(l));
  const raw = (end < 0 ? all : all.slice(0, end)).filter((_, i) => !inFence[i]);
  const lines = stripHtmlComments(raw.join('\n')).split('\n');
  const out: string[] = [];
  /** `읽기만` 항목의 들여쓰기. 그 항목과 그보다 깊이 들여쓴 줄을 건너뛰는 중이면 수 */
  let skipIndent: number | null = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = /^\s*/.exec(line)![0].length;
    if (skipIndent !== null && indent > skipIndent) continue;
    skipIndent = /^\s*[-*+]\s+읽기만/.test(line) ? indent : null;
    if (skipIndent !== null) continue;
    for (const span of singleTickSpans(line)) {
      const t = span.trim();
      if (t !== '' && !/\s/.test(t) && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * 한 줄에서 백틱 하나로 감싼 코드 스팬의 안쪽 글자들. 백틱은 이어진 묶음 단위로 읽는다(CommonMark):
 * 여는 묶음과 길이가 같은 다음 묶음에서 닫히고, 닫히지 않은 묶음은 글자다. 길이가 둘 이상인 스팬(예시,
 * 백틱을 글자로 보이는 표기)과 그 안의 글자는 경로가 아니다
 */
function singleTickSpans(line: string): string[] {
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));
  const out: string[] = [];
  for (let i = 0; i < runs.length; i++) {
    const j = runs.findIndex((r, k) => k > i && r.len === runs[i].len);
    if (j < 0) continue;
    if (runs[i].len === 1) out.push(line.slice(runs[i].at + 1, runs[j].at));
    i = j;
  }
  return out;
}

/** 계획 파일(plan.md나 소규모 계획)의 글에서 범위 경로를 뽑는다. 해시에 들어가는 "관련 파일" 섹션의 글자만 읽는다 */
export function planScopePaths(planText: string): string[] {
  return scopePaths(boundPlanSection(parseDoc(planText).body, '관련 파일'));
}

/** 파일이 범위 경로 하나에 드는가. 경로는 git이 준 글자 그대로 견준다(`\`를 `/`로 바꾸지 않는다) */
export function inScope(file: string, paths: string[]): boolean {
  return paths.some((p) => {
    const dir = p.replace(/\/+$/, '');
    return globToRegExp(p).test(file) || (dir !== '' && file.startsWith(dir + '/'));
  });
}

export interface ScopeResult {
  state: 'success';
  description: string;
  details: string[];
  /** 범위 밖 파일(경로 순서) */
  outside: string[];
}

const pass = (description: string): ScopeResult => ({
  state: 'success',
  description,
  details: [],
  outside: [],
});
const HOW = [
  '고치는 법: 의도한 변경이면 PR 본문에 이유를 적어라(검증자가 확인한다). 계획의 "관련 파일·문서"를 고치면 계획 검증을 다시 받는다. 경고이며 병합을 막지 않는다',
  `근거: ${DOC}`,
];
/** description에 넣는 경로: 한 줄의 보이는 표기로 바꾸고 길면 자른다 */
const short = (p: string) => {
  const t = showPath(p);
  return t.length > PATH_IN_DESCRIPTION ? t.slice(0, PATH_IN_DESCRIPTION - 1) + '…' : t;
};

/** 계획 자신의 파일을 뺀 바뀐 파일과 범위 경로로 판정한다(순수 함수) */
export function judgeScope(changed: string[], paths: string[]): ScopeResult {
  if (!changed.length) return pass('통과 (계획 파일만 바뀌었다)');
  const sorted = [...changed].sort();
  // 경로는 한 줄의 보이는 표기로, 목록 표식을 붙여 적는다: 파일 이름이 줄을 늘리거나 요약의 코드 블록을 닫지 못한다
  const list = (files: string[]) => [
    ...files.slice(0, FILE_LIMIT).map((f) => `- ${showPath(f)}`),
    ...(files.length > FILE_LIMIT ? [`… 외 ${files.length - FILE_LIMIT}개`] : []),
  ];
  if (!paths.length)
    return {
      state: 'success',
      description: `${WARN_PREFIX}계획의 "관련 파일·문서"에 경로가 없어 범위를 견줄 수 없다(바뀐 파일 ${sorted.length}개)`,
      details: capDetails(['경로는 백틱(`)으로 감싸 적는다', ...HOW, ...list(sorted)]),
      outside: sorted,
    };
  const outside = sorted.filter((f) => !inScope(f, paths));
  if (!outside.length)
    return pass(`통과 (바뀐 파일 ${sorted.length}개가 모두 계획의 관련 파일 안)`);
  const more = outside.length > 2 ? ` 외 ${outside.length - 2}개` : '';
  return {
    state: 'success',
    description: `${WARN_PREFIX}계획의 관련 파일 밖 ${outside.length}개 — ${outside.slice(0, 2).map(short).join(', ')}${more}`,
    details: capDetails([...HOW, ...list(outside)]),
    outside,
  };
}

/** HEAD 커밋의 트리 항목(없으면 null). 경로는 계획 id로 만든 것이라 pathspec 글자가 없다 */
function entriesAt(
  root: string,
  files: string[],
): Map<string, { mode: string; type: string; sha: string }> {
  const out = new Map<string, { mode: string; type: string; sha: string }>();
  for (const rec of git(['ls-tree', '-z', 'HEAD', '--', ...files], root).split('\0')) {
    const m = /^(\d{6}) (\S+) ([0-9a-f]+)\t([\s\S]+)$/.exec(rec);
    if (m) out.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
  }
  return out;
}

/**
 * 계획을 HEAD 커밋에서 찾아 읽는다(없으면 null). 추적된 일반 파일만 읽는다:
 * 계획 파일이나 그 위의 폴더 자리가 심볼릭 링크·서브모듈이면 링크 대상을 읽지 않고 예외다
 */
export function readPlanAtHead(root: string, id: string): { ref: PlanRef; text: string } | null {
  for (const ref of planCandidates(id)) {
    const parts = ref.file.split('/');
    const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    const at = entriesAt(root, prefixes);
    for (const dir of prefixes.slice(0, -1)) {
      const e = at.get(dir);
      if (e && e.type !== 'tree' && (e.mode === '120000' || e.mode === '160000'))
        throw new Error(`계획의 폴더 자리가 일반 폴더가 아니다(심볼릭 링크·서브모듈): ${dir}`);
    }
    const e = at.get(ref.file);
    if (!e) continue;
    if (e.type !== 'blob' || (e.mode !== '100644' && e.mode !== '100755'))
      throw new Error(`계획 파일이 일반 파일이 아니다(심볼릭 링크·폴더): ${ref.file}`);
    return { ref, text: git(['cat-file', 'blob', e.sha], root) };
  }
  return null;
}

export function scopeCheck(o: { root: string; base: string; branch: string }): ScopeResult {
  const b = parseBranch(o.branch);
  const found = b ? readPlanAtHead(o.root, b.id) : null;
  if (!b || !found) return pass('계획이 없어 범위를 보지 않는다');
  const own = planCandidates(b.id);
  const isOwn = (f: string) => own.some((c) => (c.dir ? f.startsWith(c.dir + '/') : f === c.file));
  const changed = changedFiles(o.root, o.base)
    .map((f) => f.path)
    .filter((f) => !isOwn(f));
  if (!changed.length) return judgeScope([], []);
  return judgeScope(changed, planScopePaths(found.text));
}
