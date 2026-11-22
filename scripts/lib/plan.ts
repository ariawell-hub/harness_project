// 실행 계획(8절) 파일의 위치·형식 처리. frontmatter, 섹션, index.json, step 지시서.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PLANS_DIR = 'docs/exec-plans';
export const PLAN_STATUSES = ['draft', 'active', 'blocked', 'completed', 'abandoned'] as const;
export const STEP_STATUSES = ['pending', 'in_progress', 'completed', 'blocked'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;
export const RISKS = ['low', 'normal', 'high'] as const;

export type Scalar = string | number | boolean | null | string[];
export type Frontmatter = Record<string, Scalar>;

// ---------- frontmatter ----------

function parseScalar(raw: string): Scalar {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => unquote(s.trim()));
  }
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return unquote(v);
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** ` #` 뒤의 주석을 뗀다(따옴표 안은 제외) */
function stripComment(v: string): string {
  let q: string | null = null;
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i);
  }
  return v;
}

export interface ParsedDoc {
  frontmatter: Frontmatter | null;
  body: string;
  /** frontmatter 원문 줄 (수정 시 보존용) */
  fmLines: string[];
}

export function parseDoc(text: string): ParsedDoc {
  const norm = text.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) return { frontmatter: null, body: norm, fmLines: [] };
  const end = norm.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: null, body: norm, fmLines: [] };
  const fmText = norm.slice(4, end);
  const after = norm.slice(end + 4);
  const body = after.startsWith('\n') ? after.slice(1) : after;
  const fm: Frontmatter = {};
  const fmLines = fmText.split('\n');
  for (const line of fmLines) {
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) continue;
    fm[m[1]] = parseScalar(stripComment(m[2]));
  }
  return { frontmatter: fm, body, fmLines };
}

function formatScalar(v: Scalar): string {
  if (v === null) return '';
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  return String(v);
}

/**
 * frontmatter의 한 키 값을 바꾼다. 같은 줄의 주석은 보존한다. 키가 없으면 끝에 추가.
 * 값과 주석 사이는 공백 하나로 쓴다(포매터의 결과와 같다. 주석의 칸을 보존하면 값이 짧아질 때 공백이 남아 fmt 검사가 실패한다).
 */
export function setFrontmatter(text: string, key: string, value: Scalar): string {
  const doc = parseDoc(text);
  if (!doc.frontmatter) throw new Error('frontmatter가 없는 문서다');
  let found = false;
  const lines = doc.fmLines.map((line) => {
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m || m[1] !== key) return line;
    found = true;
    const valuePart = stripComment(m[2]);
    const comment = m[2].slice(valuePart.length);
    const head = `${key}: ${formatScalar(value)}`;
    return comment ? `${head} ${comment}` : head;
  });
  if (!found) lines.push(`${key}: ${formatScalar(value)}`);
  return `---\n${lines.join('\n')}\n---\n${doc.body}`;
}

// ---------- 섹션 ----------

export function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

/** `## 제목` 단위로 본문을 나눈다. 코드 블록 안의 `##`은 무시한다 */
export function sections(body: string): Map<string, string> {
  const map = new Map<string, string>();
  let current: string | null = null;
  let buf: string[] = [];
  let fence = false;
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence ? /^##\s+(.+?)\s*$/.exec(line) : null;
    if (m && !line.startsWith('###')) {
      if (current !== null) map.set(current, buf.join('\n'));
      current = m[1];
      buf = [];
    } else if (current !== null) buf.push(line);
  }
  if (current !== null) map.set(current, buf.join('\n'));
  return map;
}

/** 제목이 prefix로 시작하는 섹션 본문 */
export function section(body: string, prefix: string): string | null {
  for (const [title, content] of sections(body)) {
    if (title.startsWith(prefix)) return content;
  }
  return null;
}

export function isBlank(content: string | null): boolean {
  if (content === null) return true;
  return stripHtmlComments(content).trim() === '';
}

export interface OpenQuestion {
  /** `### 질문:` 뒤의 한 줄 */
  title: string;
  /** 제목 줄부터 다음 `###` 제목(또는 섹션 끝)까지 */
  text: string;
}

/**
 * 계획 본문 "열린 질문" 섹션의 `### 질문: <한 줄>` 블록(절차서 7절 형식). runner가 Issue에 올린다(TD-18).
 * 주석·"없음"·`### 질문:`이 아닌 목록은 질문이 아니다
 */
export function openQuestions(body: string): OpenQuestion[] {
  const content = section(body, '열린 질문');
  if (content === null) return [];
  const out: OpenQuestion[] = [];
  let cur: string[] | null = null;
  const flush = () => {
    if (!cur) return;
    const title = /^###\s*질문:(.*)$/.exec(cur[0])![1].trim();
    if (title) out.push({ title, text: cur.join('\n').replace(/\s+$/, '') });
    cur = null;
  };
  for (const line of stripHtmlComments(content).split('\n')) {
    if (/^###\s/.test(line)) {
      flush();
      if (/^###\s*질문:/.test(line)) cur = [line];
    } else if (cur) cur.push(line);
  }
  flush();
  return out;
}

/**
 * step 파일에서 승인에 묶이는 섹션(8.2절, 10.3절 결속 기준). 계획 해시에 들어가고(ci/plan-hash.ts),
 * step을 실행하는 PR은 자기 step의 이 섹션을 바꿀 수 없다(gates/plan-gate.ts).
 * "읽어야 할 파일"은 안내라 넣지 않는다
 */
export const STEP_BOUND_SECTIONS = ['작업', 'Acceptance Criteria', '금지사항'] as const;

/** 계획 검증의 해시에 넣는 plan.md의 섹션(제목이 이 말로 시작한다. section과 같은 규칙) */
export const PLAN_BOUND_SECTIONS = ['목표와 수용 기준', '범위', '관련 파일'] as const;

/** 해시에 넣는 섹션 글자의 정규화: 줄 끝 공백과 섹션 앞뒤 빈 줄을 뗀다. 줄 안의 글자는 그대로 둔다 */
export function normalizeBound(content: string | null): string {
  return (content ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * 해시에 넣는 plan.md 한 섹션의 글자 그대로(섹션이 없으면 ''). body는 frontmatter를 뗀 본문이다.
 * 계획 해시(ci/plan-hash.ts)와 scope(gates/scope.ts)가 함께 쓴다: 범위 경로를 이 글자에서만 읽으므로 범위 경로가 바뀌면 해시도 바뀐다
 */
export function boundPlanSection(body: string, s: (typeof PLAN_BOUND_SECTIONS)[number]): string {
  return normalizeBound(section(body, s));
}

export function hashText(s: string): string {
  return createHash('sha256').update(s.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);
}

// ---------- 계획 위치 ----------

export interface PlanRef {
  id: string;
  kind: 'small' | 'multi';
  where: 'active' | 'completed';
  /** 리포 루트 기준 상대 경로: small은 <id>.md, multi는 <id>/plan.md */
  file: string;
  /** multi일 때 폴더 */
  dir?: string;
}

export const PLAN_ID_RE = /^\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function planCandidates(id: string): PlanRef[] {
  const out: PlanRef[] = [];
  for (const where of ['active', 'completed'] as const) {
    const dir = `${PLANS_DIR}/${where}/${id}`;
    out.push({ id, kind: 'multi', where, file: `${dir}/plan.md`, dir });
    out.push({ id, kind: 'small', where, file: `${PLANS_DIR}/${where}/${id}.md` });
  }
  return out;
}

/** 파일 시스템에서 계획을 찾는다 */
export function findPlan(root: string, id: string): PlanRef | null {
  for (const ref of planCandidates(id)) {
    if (existsSync(path.join(root, ref.file))) return ref;
  }
  return null;
}

/** 특정 리비전에서 계획을 찾는다 (read: rev:path → 내용 또는 null) */
export function findPlanAt(read: (file: string) => string | null, id: string): PlanRef | null {
  for (const ref of planCandidates(id)) {
    if (read(ref.file) !== null) return ref;
  }
  return null;
}

// ---------- 브랜치 이름 (8.1절) ----------

export interface BranchInfo {
  type: string;
  id: string;
  /** small 계획은 null */
  step: number | null;
}

export function parseBranch(branch: string): BranchInfo | null {
  const m = /^([a-z]+)\/(\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*?)(?:-s(\d+))?$/.exec(branch);
  if (!m) return null;
  return { type: m[1], id: m[2], step: m[3] === undefined ? null : Number(m[3]) };
}

export function branchName(type: string, id: string, step: number | null): string {
  return step === null ? `${type}/${id}` : `${type}/${id}-s${step}`;
}

// ---------- index.json ----------

export interface StepEntry {
  step: number;
  name: string;
  status: (typeof STEP_STATUSES)[number];
  pr?: number;
  summary?: string;
  started_at?: string;
  completed_at?: string;
}

export interface StepIndex {
  plan: string;
  steps: StepEntry[];
}

export function parseIndex(text: string): StepIndex {
  const data = JSON.parse(text) as StepIndex;
  if (typeof data.plan !== 'string' || !Array.isArray(data.steps)) {
    throw new Error('index.json에는 plan(문자열)과 steps(배열)가 있어야 한다');
  }
  return data;
}

export function readIndex(root: string, ref: PlanRef): StepIndex {
  if (!ref.dir) throw new Error('소규모 계획에는 index.json이 없다');
  return parseIndex(readFileSync(path.join(root, ref.dir, 'index.json'), 'utf8'));
}

export function writeIndex(root: string, ref: PlanRef, idx: StepIndex): void {
  if (!ref.dir) throw new Error('소규모 계획에는 index.json이 없다');
  writeFileSync(path.join(root, ref.dir, 'index.json'), JSON.stringify(idx, null, 2) + '\n');
}

// ---------- step 지시서 ----------

/** ```bash / ```sh 블록의 명령. `\`로 끝나는 줄은 이어 붙이고 `#` 주석 줄은 뺀다 */
export function extractCommands(content: string | null): string[] {
  if (!content) return [];
  const cmds: string[] = [];
  const re = /```(?:bash|sh|shell|console)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    let pending = '';
    for (const raw of m[1].split('\n')) {
      const line = raw.replace(/^\$\s+/, '');
      if (!pending && (line.trim() === '' || line.trim().startsWith('#'))) continue;
      if (line.endsWith('\\')) {
        pending += line.slice(0, -1) + ' ';
        continue;
      }
      cmds.push((pending + line).trim());
      pending = '';
    }
    if (pending.trim()) cmds.push(pending.trim());
  }
  return cmds;
}

export function stepFile(ref: PlanRef, step: number): string {
  if (!ref.dir) throw new Error('소규모 계획에는 step 파일이 없다');
  return `${ref.dir}/step${step}.md`;
}

/** 소규모 계획의 `- 목표:`, `- 변경:`, `- 검증:` 줄 */
export function smallPlanFields(body: string): Record<'목표' | '변경' | '검증', string> {
  const get = (k: string) => {
    const m = new RegExp(`^\\s*[-*]\\s*${k}\\s*:\\s*(.*)$`, 'm').exec(stripHtmlComments(body));
    return m ? m[1].trim() : '';
  };
  return { 목표: get('목표'), 변경: get('변경'), 검증: get('검증') };
}

/** step의 AC 명령. multi는 stepN.md의 Acceptance Criteria, small은 `- 검증:` 줄 */
export function acceptanceCommands(root: string, ref: PlanRef, step: number | null): string[] {
  if (ref.kind === 'small') {
    const doc = parseDoc(readFileSync(path.join(root, ref.file), 'utf8'));
    const v = smallPlanFields(doc.body).검증.replace(/^`|`$/g, '');
    return v ? [v] : [];
  }
  const text = readFileSync(path.join(root, stepFile(ref, step ?? 0)), 'utf8');
  return extractCommands(section(text, 'Acceptance Criteria'));
}

// ---------- 발견 사항 (8.3절) ----------

const DISPOSITION_RE = /처리\s*:\s*(\[[^\]]+\]\([^)]+\)|#\d+|TD-\d+|해당 없음)/;

/** 처리가 적히지 않은 발견 사항 항목 */
export function unhandledFindings(body: string): string[] {
  const content = section(body, '발견 사항');
  if (!content) return [];
  const bad: string[] = [];
  for (const line of stripHtmlComments(content).split('\n')) {
    if (!/^\s*[-*]\s+\S/.test(line)) continue;
    if (/^\s*[-*]\s+(없음|none)\s*$/i.test(line)) continue;
    if (!DISPOSITION_RE.test(line)) bad.push(line.trim());
  }
  return bad;
}
