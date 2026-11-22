// 판단 절차 문서(docs/harness/actions-cost.md)가 비어 있거나 값이 보존 기록과 다르면 실패하게 하는 검사
// (계획 20261121-actions-cost-design step1). 낱말을 찾는 대신 문서의 구조와 값을 읽는다.
// Markdown을 해석하지 않는다. 검사가 읽는 좁은 형식만 받고, 벗어난 줄은 "형식"으로 거부한다(`viewsOf`):
// 해석이 화면과 어긋나는 자리마다 가려진 글이 통과하거나 바른 문서가 거부되기 때문이다.
// GitHub을 읽지 않는다: 값은 보존 기록(lab/actions-cost/*.jsonl)으로만 계산한다. 지난 기간의 실행 기록도
// 다시 실행하면 바뀌므로, 읽으면 바르게 적은 기준선이 뒤에 실패한다.
// 글의 옳고 그름(설명이 맞는가, 절차가 쓸 만한가)은 보지 않는다. 그것은 PR 검증이 본다.
//   node lab/actions-cost/check-doc.ts [--doc <파일>] [--dir <보존 기록 폴더>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionsCost,
  fromSaved,
  knownNamesFrom,
  parseSaved,
  recordCells,
  renderCost,
  type CostReport,
  type KnownNames,
} from '../../scripts/metrics/actions-cost.ts';
import type { Period } from '../../scripts/metrics/source.ts';

/** 제작자가 정한 예산(2026-11-21). 문서의 "예산" 절이 이 값과 같아야 한다 */
export const BUDGET = {
  accountUsd: 18,
  prsPerMonth: 100,
  minutesPerPr: 30,
  usdPerPr: 0.18,
} as const;
export const BASELINE_FILE = '2026-11-17_2026-11-20.jsonl';

export interface DocInputs {
  /** 문서의 글 */
  doc: string;
  /** 보존 기록 파일의 글(이름으로 찾는다). 없으면 null */
  saved: (name: string) => string | null;
  known: KnownNames;
}

const SECTIONS = ['왜 재는가', '재는 방법', '예산', '기준선', '판단 절차', '기록'] as const;
type Title = (typeof SECTIONS)[number];

const BASELINE_PERIOD: Period = { since: '2026-11-17', until: '2026-11-20' };
/** 예산을 정한 날. 기준선은 그 뒤에 쟀다 */
const DECIDED = '2026-11-21';
const BEGIN = '<!-- actions-cost:begin -->';
const END = '<!-- actions-cost:end -->';
const SAVE_COMMAND = `node scripts/harness.ts actions-cost --since ${BASELINE_PERIOD.since} --until ${BASELINE_PERIOD.until} --save lab/actions-cost/${BASELINE_FILE}`;
const FROM_COMMAND = `node scripts/harness.ts actions-cost --from lab/actions-cost/${BASELINE_FILE}`;

/** 본문에 있어야 하는 낱말 */
const PROSE: { title: Title; words: string[] }[] = [
  { title: '왜 재는가', words: ['비공개', '올림', '포함 사용량'] },
  { title: '재는 방법', words: ['actions-cost --since', '--save', '--from', '올림', '단가'] },
];

/** "판단 절차"의 여덟 항목: 목록 줄의 머리와 내용에 있어야 하는 낱말 */
const PROCEDURE: { head: string; words: string[] }[] = [
  { head: '- 기준이 되는 입력:', words: ['보존 기록', '--from'] },
  { head: '- 다시 재는 때:', words: ['--save'] },
  { head: '- 판단 시점 1(절감 수단마다):', words: [] },
  { head: '- 판단 시점 2(파일럿을 비공개 리포에서 시작하기 전):', words: ['예산'] },
  { head: '- 판단 시점 3(이 리포를 다시 비공개로 돌릴지 정할 때):', words: [] },
  { head: '- 효과가 없을 때:', words: ['되돌린다'] },
  { head: '- 파일럿 실측:', words: ['check'] },
  { head: '- 예산을 넘는 결정:', words: ['제작자'] },
];

const TABLE_HEAD = [
  '기간',
  '수단',
  '청구 분',
  'PR 하나당 청구 분',
  'PR 하나당 금액',
  'PR head 하나당 청구 분',
  '30일 환산 금액',
  '보존 기록',
  '판단',
];
/** 기록 표의 칸 → `recordCells`의 칸. 수단·보존 기록·판단은 `recordCells`에 없다 */
const CELL_OF: [number, number][] = [
  [0, 0],
  [2, 1],
  [3, 2],
  [4, 3],
  [5, 4],
  [6, 5],
];
const SAVED_NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.jsonl$/;

const VERDICTS = ['예산 안', '예산 밖', '판단 못 함'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** PR 하나당 예산의 밀리달러 정수 */
const BUDGET_MILLI = Math.round(BUDGET.usdPerPr * 1000);

/**
 * 보존 기록으로 계산한 값의 판단. 금액은 나누지 않고 정수로 견준다: 전체 금액의 밀리달러를
 * `PR 하나당 예산의 밀리달러 × PR 수`와 견준다. 나눈 값을 반올림해 견주면 1밀리달러에 못 미치는 초과가 사라진다.
 * ① PR이 없으면 판단 못 함. ② 단가를 아는 러너의 금액만으로 예산을 넘으면 예산 밖(모르는 러너의 분은 금액을 늘릴 뿐이다).
 * ③ 그렇지 않고 단가를 모르는 러너의 분이 있으면 판단 못 함(금액에 빠진 것이 있다). ④ 그 밖은 예산 안.
 * self-hosted 러너의 분은 Actions 청구가 아니라 판단을 바꾸지 않는다
 */
export function verdictOf(r: CostReport): Verdict {
  if (r.prs === 0) return '판단 못 함';
  if (r.usdMilli > BUDGET_MILLI * r.prs) return '예산 밖';
  if (r.unknownMinutes > 0) return '판단 못 함';
  return '예산 안';
}

/** 공백을 뺀 글자 수 */
const dense = (lines: string[]) => lines.join('').replace(/\s/g, '').length;
const blank = (line: string) => /^\s*$/.test(line);

/**
 * 문서의 줄을 보는 눈. 줄 번호는 모두 같다.
 * - `raw`: 파일의 글 그대로. 표식 구간을 계산한 출력과 견줄 때 쓴다.
 * - `text`: 글. 링크의 주소를 뺐다. 코드 블록 안의 줄은 그대로다.
 * - `struct`: 문서의 뼈대를 찾는 눈. `text`에서 코드 블록의 줄을 비웠다. 제목, 목록 항목, 표, 표식을 여기서 찾는다.
 * - `fenced`: 코드 블록 안의 줄인가(여닫는 줄 제외).
 * - `codes`: 그 줄의 코드 구간(백틱)에 든 글.
 * 머리말(frontmatter)과 표식 구간 안의 줄은 `text`·`struct`에서 비운다. 표식 줄은 남긴다
 */
interface Views {
  raw: string[];
  text: string[];
  struct: string[];
  fenced: boolean[];
  codes: string[][];
}

interface Part {
  code: boolean;
  s: string;
}

/**
 * 한 줄을 코드 구간(백틱)과 그 밖의 글로 가른다. 코드 구간은 길이가 같은 백틱 묶음 한 쌍의 사이다.
 * 짝이 없는 묶음이 있으면 null이다(줄을 넘는 코드 구간은 받지 않는다)
 */
function partsOf(line: string): Part[] | null {
  const parts: Part[] = [];
  let plain = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      plain += line[i];
      i++;
      continue;
    }
    let n = 1;
    while (line[i + n] === '`') n++;
    let close = -1;
    for (let j = i + n; j < line.length;) {
      if (line[j] !== '`') {
        j++;
        continue;
      }
      let k = 1;
      while (line[j + k] === '`') k++;
      if (k === n) {
        close = j;
        break;
      }
      j += k;
    }
    if (close < 0) return null;
    parts.push({ code: false, s: plain }, { code: true, s: line.slice(i + n, close) });
    plain = '';
    i = close + n;
  }
  parts.push({ code: false, s: plain });
  return parts;
}

/** 링크의 주소: 괄호 안에 공백·괄호·따옴표·백틱 없이 적은 것. 제목을 단 링크는 맞지 않는다 */
const LINK_TARGET = String.raw`\]\([^()\s"'<>\`]*\)`;

/**
 * 코드 구간 밖의 글 한 줄이 형식을 벗어난 점. 없으면 null.
 * 코드 구간이 화면과 다르게 읽히는 길(이스케이프한 백틱, 표의 칸, 링크의 제목, 참조 정의)을 모두 막아야
 * "백틱 안의 `<`는 글이다"가 참이 된다
 */
function lineFormat(line: string, parts: Part[] | null): string | null {
  if (!/^ {0,3}\S/.test(line))
    return '줄 머리를 네 칸 이상이나 탭으로 들여 쓰지 않는다(들여 쓴 코드 블록을 쓰지 않는다)';
  if (/^ {0,3}(=+|-+)\s*$/.test(line)) return '밑줄 제목과 가로줄(===, ---)을 쓰지 않는다';
  if (/^ {0,3}\[[^\]]*\]:/.test(line)) return '참조 정의([이름]: 주소)를 쓰지 않는다';
  if (line.includes('\\')) return '역슬래시를 쓰지 않는다(이스케이프한 글자를 가려 읽지 않는다)';
  if (parts === null)
    return '백틱의 짝이 한 줄 안에서 맞지 않는다(코드 구간은 한 줄 안에서 여닫는다)';
  const plain = parts.filter((p) => !p.code);
  if (plain.some((p) => p.s.includes('<')))
    return '코드(백틱, 코드 블록) 밖에 `<`를 쓰지 않는다(HTML 태그와 주석을 쓰지 않는다. 표식은 줄 전체가 표식인 두 줄만 둔다)';
  if (line.includes('|') && line.includes('<'))
    return '`|`가 있는 줄에는 백틱 안에도 `<`를 쓰지 않는다(표의 칸은 백틱 안의 `|`에서도 갈린다)';
  if (plain.some((p) => p.s.includes('!['))) return '그림(![…](…))을 쓰지 않는다';
  for (const p of plain)
    for (let at = p.s.indexOf(']('); at >= 0; at = p.s.indexOf('](', at + 1))
      if (!new RegExp(`^${LINK_TARGET}`).test(p.s.slice(at)))
        return '링크의 주소는 한 줄 안에 공백·괄호·따옴표 없이 적는다(제목을 달지 않는다)';
  return null;
}

/**
 * 문서를 줄 단위로 읽는다. 형식을 벗어난 줄은 `problems`에 넣고 글로 남긴다(뒤의 줄을 가리지 않는다).
 * 받는 형식: 머리말, 줄 머리의 ``````로 여닫는 코드 블록, 줄 전체가 표식인 표식 구간, 그리고 `lineFormat`을 지킨 줄
 */
function viewsOf(doc: string, problems: string[]): Views {
  const raw = doc.split(/\r?\n/);
  const text = raw.map(() => '');
  const struct = raw.map(() => '');
  const fenced = raw.map(() => false);
  const codes: string[][] = raw.map(() => []);
  const bad = (i: number, why: string) => problems.push(`형식(${i + 1}째 줄): ${why}`);
  /** 줄을 글로 남긴다 */
  const keep = (i: number, s: string) => {
    text[i] = s;
    struct[i] = s;
  };
  let i = 0;
  if (raw[0] === '---') {
    const end = raw.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  while (i < raw.length) {
    const line = raw[i];
    if (blank(line)) {
      i++;
      continue;
    }
    // 표식 구간: 안의 줄은 계산한 출력과 raw로 견줄 뿐 글로 읽지 않는다
    if (line === BEGIN || line === END) {
      keep(i, line);
      const end = line === BEGIN ? raw.indexOf(END, i + 1) : -1;
      if (end > 0) {
        keep(end, END);
        i = end + 1;
      } else i++;
      continue;
    }
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      const end = /^```[A-Za-z0-9_-]*$/.test(line) ? raw.indexOf('```', i + 1) : -1;
      if (!/^```[A-Za-z0-9_-]*$/.test(line)) {
        bad(
          i,
          '코드 블록은 줄 머리의 ```(뒤에 언어 이름만)로 열고 줄 머리의 ```로 닫는다(들여 쓴 것, ~~~, 백틱 네 개 이상은 쓰지 않는다)',
        );
        keep(i, line);
        i++;
      } else if (end < 0) {
        bad(i, '코드 블록이 닫히지 않았다(줄 머리의 ```로 닫는다)');
        i++;
      } else {
        for (let k = i + 1; k < end; k++) {
          fenced[k] = true;
          text[k] = raw[k];
          if (/^\s*`{3,}/.test(raw[k]))
            bad(
              k,
              '코드 블록 안에 ```로 시작하는 줄을 쓰지 않는다(화면에서 블록이 거기서 닫힐 수 있다)',
            );
        }
        i = end + 1;
      }
      continue;
    }
    const parts = partsOf(line);
    const why = lineFormat(line, parts);
    if (why !== null) bad(i, why);
    if (parts === null) keep(i, line);
    else {
      codes[i] = parts.filter((p) => p.code).map((p) => p.s.trim());
      // 코드 구간은 백틱 한 쌍으로 다시 적고, 그 밖의 글에서는 링크의 주소를 뺀다
      keep(
        i,
        parts
          .map((p) => (p.code ? `\`${p.s}\`` : p.s.replace(new RegExp(LINK_TARGET, 'g'), ']')))
          .join(''),
      );
    }
    i++;
  }
  return { raw, text, struct, fenced, codes };
}

/** 절의 본문이 놓인 줄의 범위(제목 다음 줄부터 다음 `## ` 전까지) */
interface Range {
  from: number;
  to: number;
}

/** 여섯 절의 범위. 없거나 두 번 있는 절은 넣지 않는다. 제목은 `struct`에서 찾는다 */
function sections(lines: string[], problems: string[]): Map<Title, Range> {
  const heads = lines.flatMap((l, i) => {
    const m = /^## (.+?)\s*$/.exec(l);
    return m ? [{ title: m[1], i }] : [];
  });
  const found = new Map<Title, Range>();
  for (const title of SECTIONS) {
    const hits = heads.filter((h) => h.title === title);
    if (hits.length !== 1) {
      problems.push(
        hits.length
          ? `절: "## ${title}"이 ${hits.length}번 있다(한 번이어야 한다)`
          : `절: "## ${title}"이 없다`,
      );
      continue;
    }
    const next = heads.find((h) => h.i > hits[0].i);
    found.set(title, { from: hits[0].i + 1, to: next ? next.i : lines.length });
  }
  const order = heads
    .map((h) => h.title)
    .filter((t) => (SECTIONS as readonly string[]).includes(t));
  if (found.size === SECTIONS.length && order.join('\n') !== SECTIONS.join('\n'))
    problems.push(`절: 순서가 다르다(${SECTIONS.join(' → ')}여야 한다)`);
  return found;
}

function checkProse(title: Title, words: string[], body: string[], problems: string[]): void {
  const n = dense(body);
  if (n < 100) problems.push(`${title}: 본문이 공백을 빼고 100자보다 짧다(${n}자)`);
  const text = body.join('\n');
  for (const w of words) if (!text.includes(w)) problems.push(`${title}: "${w}" 낱말이 없다`);
}

/** 수 뒤에 숫자나 자릿수 구분이 이어지지 않아야 한다(`$18`을 `$180`·`$18,000`의 앞부분으로 읽지 않는다) */
const NUM = String.raw`(\d+(?:\.\d+)?)(?!\d|[.,]\d)`;

function checkBudget(body: string[], problems: string[]): void {
  /** 머리로 시작하는 줄이 꼭 하나일 때 머리 뒤의 글 */
  const rest = (head: string): string | null => {
    const hits = body.filter((l) => l.startsWith(head));
    if (hits.length === 1) return hits[0].slice(head.length);
    problems.push(
      hits.length
        ? `예산: "${head}" 줄이 ${hits.length}번 있다(한 번이어야 한다)`
        : `예산: "${head}" 줄이 없다`,
    );
    return null;
  };
  const state = rest('- 상태:');
  if (state !== null && !state.startsWith(' 확정(제작자 결정, 2026-11-21)'))
    problems.push('예산: "- 상태:" 줄이 "- 상태: 확정(제작자 결정, 2026-11-21)"로 시작하지 않는다');

  const account = rest('- 계정의 월 예산:');
  if (account !== null) {
    const m = new RegExp(String.raw`^\s*\$${NUM}`).exec(account);
    if (!m || Number(m[1]) !== BUDGET.accountUsd)
      problems.push(`예산: "- 계정의 월 예산:"의 값이 $${BUDGET.accountUsd}가 아니다`);
  }
  const prs = rest('- 프로젝트 하나의 월 PR 수:');
  if (prs !== null) {
    const m = /^\s*(\d+)개/.exec(prs);
    if (!m || Number(m[1]) !== BUDGET.prsPerMonth)
      problems.push(`예산: "- 프로젝트 하나의 월 PR 수:"의 값이 ${BUDGET.prsPerMonth}개가 아니다`);
  }
  const perPr = rest('- PR 하나당 예산:');
  if (perPr !== null) {
    const m = new RegExp(String.raw`^\s*(\d+(?:\.\d+)?)분\(\$${NUM}`).exec(perPr);
    if (!m || Number(m[1]) !== BUDGET.minutesPerPr || Number(m[2]) !== BUDGET.usdPerPr)
      problems.push(
        `예산: "- PR 하나당 예산:"의 값이 ${BUDGET.minutesPerPr}분($${BUDGET.usdPerPr})이 아니다`,
      );
  }
}

interface Loaded {
  period: Period;
  report: CostReport;
}

/** 보존 기록을 이름으로 읽어 계산한다. 읽지 못하면 까닭(글자열)이다. 같은 이름은 한 번만 읽는다 */
function loader(i: DocInputs): (name: string) => Loaded | string {
  const cache = new Map<string, Loaded | string>();
  return (name) => {
    let v = cache.get(name);
    if (v === undefined) {
      const text = i.saved(name);
      if (text === null) v = `보존 기록 ${name}이 없다`;
      else
        try {
          const { period, jobs } = parseSaved(text);
          v = { period, report: actionsCost(fromSaved(jobs), period, i.known) };
        } catch (e) {
          v = `보존 기록 ${name}을 읽지 못했다: ${e instanceof Error ? e.message : String(e)}`;
        }
      cache.set(name, v);
    }
    return v;
  };
}

const samePeriod = (a: Period, b: Period) => a.since === b.since && a.until === b.until;

/** 실재하는 날짜(YYYY-MM-DD)인가 */
function realDay(day: string): boolean {
  const t = Date.parse(`${day}T00:00:00.000Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day;
}

/**
 * 코드로 적은 글: 코드 구간(백틱)의 글과 코드 블록의 줄. 명령은 여기서 찾는다.
 * 본문에 풀어 쓴 글은 명령으로 치지 않는다(복사해 실행할 글이 무엇인지 가릴 수 없다)
 */
function codeTexts(v: Views, lines: number[]): string[] {
  return lines.flatMap((i) => (v.fenced[i] ? [v.raw[i].trim()] : v.codes[i]));
}

function checkBaseline(
  v: Views,
  r: Range,
  load: (name: string) => Loaded | string,
  problems: string[],
): void {
  // 표식 구간은 문서 전체에 하나이고 이 절 안에 있다. 표식은 struct에서 찾는다(코드 블록 안의 것은 표식이 아니다)
  const count = (mark: string) => v.struct.filter((l) => l === mark).length;
  const within = (mark: string) => {
    for (let i = r.from; i < r.to; i++) if (v.struct[i] === mark) return i;
    return -1;
  };
  const begin = within(BEGIN);
  const end = within(END);
  const one = count(BEGIN) === 1 && count(END) === 1;
  const region = one && begin >= 0 && end > begin ? v.raw.slice(begin + 1, end) : null;
  if (region === null)
    problems.push(
      one
        ? '기준선: 표식 구간이 "기준선" 절 안에 없다(시작 표식 다음에 끝 표식이 와야 한다)'
        : `기준선: 표식 구간이 문서에 하나가 아니다(시작 표식 ${count(BEGIN)}개, 끝 표식 ${count(END)}개)`,
    );
  /** 표식 구간 밖의 줄 번호. 구간을 가를 수 없으면 절 전체다 */
  const outside: number[] = [];
  for (let i = r.from; i < r.to; i++) if (region === null || i < begin || i > end) outside.push(i);

  const loaded = load(BASELINE_FILE);
  if (typeof loaded === 'string') problems.push(`기준선: ${loaded}`);
  else if (!samePeriod(loaded.period, BASELINE_PERIOD))
    problems.push(
      `기준선: 보존 기록 ${BASELINE_FILE}의 기간이 ${BASELINE_PERIOD.since}~${BASELINE_PERIOD.until}이 아니다(${loaded.period.since}~${loaded.period.until})`,
    );
  else if (region !== null) {
    const want = renderCost(loaded.report, loaded.period)
      .split('\n')
      .filter((l) => !blank(l));
    const have = region.filter((l) => !blank(l));
    const at = want.findIndex((l, k) => l !== have[k]);
    if (at >= 0 || have.length !== want.length)
      problems.push(
        `기준선: 표식 구간이 보존 기록으로 계산한 출력과 다르다(빈 줄을 뺀 ${(at >= 0 ? at : want.length) + 1}째 줄부터. 표식 구간 ${have.length}줄, 계산한 출력 ${want.length}줄). "${FROM_COMMAND}"의 출력을 그대로 붙인다`,
      );
  }

  const dated = outside.map((i) => v.struct[i]).filter((l) => l.includes('잰 날짜:'));
  if (!dated.length) problems.push('기준선: "잰 날짜: <YYYY-MM-DD>" 줄이 표식 구간 밖에 없다');
  for (const l of dated) {
    const m = /잰 날짜:\s*(\d{4}-\d{2}-\d{2})(?!\d)/.exec(l);
    if (!m) problems.push('기준선: 잰 날짜가 YYYY-MM-DD 꼴이 아니다');
    else if (!realDay(m[1])) problems.push(`기준선: 잰 날짜 ${m[1]}은 없는 날짜다`);
    else if (m[1] < DECIDED)
      problems.push(`기준선: 잰 날짜 ${m[1]}이 ${DECIDED}보다 앞선다(기준선은 그 뒤에 쟀다)`);
  }
  // 명령은 코드로 적은 글 전체가 같아야 한다. 포함하는지만 보면 다른 파일을 가리키는 명령(…jsonl.bak)이 통과한다
  const commands = codeTexts(v, outside);
  if (!commands.includes(SAVE_COMMAND))
    problems.push(
      `기준선: 잰 명령이 표식 구간 밖에 코드(백틱이나 코드 블록)로 적혀 있지 않다. 명령 전체가 같아야 한다(${SAVE_COMMAND})`,
    );
  if (!commands.includes(FROM_COMMAND))
    problems.push(
      `기준선: 다시 계산하는 명령이 표식 구간 밖에 코드(백틱이나 코드 블록)로 적혀 있지 않다. 명령 전체가 같아야 한다(${FROM_COMMAND})`,
    );
}

function checkProcedure(body: string[], problems: string[]): void {
  const starts = body.flatMap((l, i) => {
    const item = PROCEDURE.find((p) => l.startsWith(p.head));
    return item ? [{ item, i }] : [];
  });
  for (const item of PROCEDURE) {
    const hits = starts.filter((s) => s.item === item);
    if (hits.length !== 1) {
      problems.push(
        hits.length
          ? `판단 절차: "${item.head}" 항목이 ${hits.length}번 있다(한 번이어야 한다)`
          : `판단 절차: "${item.head}" 항목이 없다(목록 줄의 처음에 이 머리를 글자 그대로 쓴다)`,
      );
      continue;
    }
    // 내용은 머리 뒤의 글과 그 항목에 속한 줄이다: 목록 표시("- ")의 글 자리(두 칸)만큼 들여 쓴 줄.
    // 덜 들여 쓴 줄(다음 목록 항목, 문단)을 만나면 끝난다: 화면에서 그 항목의 내용이 아니다
    const content = [body[hits[0].i].slice(item.head.length)];
    for (let j = hits[0].i + 1; j < body.length; j++) {
      if (blank(body[j])) continue;
      if (!/^ {2}/.test(body[j])) break;
      content.push(body[j]);
    }
    const n = dense(content);
    if (n < 20)
      problems.push(`판단 절차: "${item.head}"의 내용이 공백을 빼고 20자보다 짧다(${n}자)`);
    const text = content.join('\n');
    for (const w of item.words)
      if (!text.includes(w)) problems.push(`판단 절차: "${item.head}"의 내용에 "${w}" 낱말이 없다`);
  }
}

/** 표의 한 줄을 칸으로 가른다(양끝의 `|`를 떼고 칸의 앞뒤 공백을 뺀다) */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function checkRecord(
  body: string[],
  load: (name: string) => Loaded | string,
  problems: string[],
): void {
  // 표: `|`로 시작하는 줄이 이어진 묶음
  const tables: string[][] = [];
  let current: string[] | null = null;
  for (const l of body) {
    if (!/^ {0,3}\|/.test(l)) current = null;
    else if (current) current.push(l);
    else tables.push((current = [l]));
  }
  if (tables.length !== 1) {
    problems.push(`기록: 표가 ${tables.length}개다(하나여야 한다)`);
    return;
  }
  const [head, rule, ...rows] = tables[0];
  if (cellsOf(head).join('\n') !== TABLE_HEAD.join('\n')) {
    problems.push(`기록: 표의 머리 줄이 다르다(| ${TABLE_HEAD.join(' | ')} |여야 한다)`);
    return;
  }
  // 구분 줄의 칸 수가 머리 줄과 다르면 화면에서 표가 되지 않는다
  const ruleCells = rule === undefined ? [] : cellsOf(rule);
  if (ruleCells.length !== TABLE_HEAD.length || !ruleCells.every((c) => /^:?-+:?$/.test(c))) {
    problems.push(
      `기록: 표의 둘째 줄이 머리 줄과 칸 수가 같은 구분 줄(| --- | … |, ${TABLE_HEAD.length}칸)이 아니다`,
    );
    return;
  }
  if (!rows.length) problems.push('기록: 표에 데이터 행이 없다(기준선 행이 있어야 한다)');

  rows.forEach((line, k) => {
    const at = `기록 ${k + 1}행`;
    const c = cellsOf(line);
    if (c.length !== TABLE_HEAD.length) {
      problems.push(`${at}: 칸이 ${c.length}개다(${TABLE_HEAD.length}개여야 한다)`);
      return;
    }
    const empty = TABLE_HEAD.filter((_, j) => c[j] === '');
    if (empty.length) {
      for (const name of empty) problems.push(`${at}: "${name}" 칸이 비었다`);
      return;
    }
    const name = c[7].replace(/^`(.*)`$/, '$1');
    if (k === 0) {
      if (c[1] !== '기준선') problems.push(`${at}: 수단이 "기준선"이 아니다(첫 행은 기준선이다)`);
      if (name !== BASELINE_FILE)
        problems.push(`${at}: 보존 기록이 ${BASELINE_FILE}이 아니다(첫 행은 기준선이다)`);
    }
    // 이름이 정한 꼴이 아니면 읽지 않는다(폴더 밖의 파일을 가리키는 이름을 열지 않는다)
    if (!SAVED_NAME_RE.test(name)) {
      problems.push(`${at}: 보존 기록 칸이 <YYYY-MM-DD>_<YYYY-MM-DD>.jsonl 꼴의 이름이 아니다`);
      return;
    }
    const loaded = load(name);
    if (typeof loaded === 'string') {
      problems.push(`${at}: ${loaded}`);
      return;
    }
    if (name !== `${loaded.period.since}_${loaded.period.until}.jsonl`)
      problems.push(
        `${at}: 보존 기록의 이름이 그 안의 기간(${loaded.period.since}~${loaded.period.until})과 다르다`,
      );
    const want = recordCells(loaded.report, loaded.period);
    for (const [j, w] of CELL_OF)
      if (c[j] !== want[w])
        problems.push(
          `${at}: "${TABLE_HEAD[j]}" 칸(${c[j]})이 보존 기록 ${name}으로 계산한 값(${want[w]})과 다르다`,
        );
    const written = VERDICTS.find((v) => c[8].startsWith(v));
    if (!written) {
      problems.push(
        `${at}: 판단이 ${VERDICTS.map((v) => `"${v}"`).join('·')} 가운데 하나로 시작하지 않는다`,
      );
      return;
    }
    if (!/[\p{L}\p{N}]/u.test(c[8].slice(written.length)))
      problems.push(`${at}: 판단 "${written}" 뒤에 설명이 없다(한 줄 설명을 단다)`);
    const computed = verdictOf(loaded.report);
    if (written !== computed)
      problems.push(
        `${at}: 판단이 "${written}"인데 보존 기록 ${name}으로 계산하면 "${computed}"이다(금액 ${loaded.report.usdMilli}밀리달러, PR ${loaded.report.prs}개, PR 하나당 예산 ${BUDGET_MILLI}밀리달러, 단가를 모르는 러너 ${loaded.report.unknownMinutes}분)`,
      );
  });
}

/** 어긋난 점의 목록. 없으면 빈 배열 */
export function checkDoc(i: DocInputs): string[] {
  const problems: string[] = [];
  const v = viewsOf(i.doc, problems);
  const found = sections(v.struct, problems);
  const load = loader(i);
  const part = (lines: string[], r: Range) => lines.slice(r.from, r.to);
  for (const p of PROSE) {
    const r = found.get(p.title);
    if (r) checkProse(p.title, p.words, part(v.text, r), problems);
  }
  const budget = found.get('예산');
  if (budget) checkBudget(part(v.struct, budget), problems);
  const baseline = found.get('기준선');
  if (baseline) checkBaseline(v, baseline, load, problems);
  const procedure = found.get('판단 절차');
  if (procedure) checkProcedure(part(v.struct, procedure), problems);
  const record = found.get('기록');
  if (record) checkRecord(part(v.struct, record), load, problems);
  return problems;
}

// ---- 명령행 ----

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE =
  '사용법: node lab/actions-cost/check-doc.ts [--doc <파일>] [--dir <보존 기록 폴더>]\n';

/** 체크아웃의 워크플로 파일에서 허용 목록을 만든다(`actions-cost` 명령과 같은 방법) */
function knownFromCheckout(): KnownNames {
  const dir = path.join(ROOT, '.github', 'workflows');
  if (!existsSync(dir)) return new Map();
  return knownNamesFrom(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') })),
  );
}

function main(argv: string[]): number {
  let doc: string | undefined;
  let dir: string | undefined;
  for (let k = 0; k < argv.length; k += 2) {
    const value = argv[k + 1];
    if (argv[k] === '--doc' && value !== undefined && doc === undefined) doc = value;
    else if (argv[k] === '--dir' && value !== undefined && dir === undefined) dir = value;
    else {
      process.stderr.write(USAGE);
      return 1;
    }
  }
  const docFile =
    doc === undefined ? path.join(ROOT, 'docs', 'harness', 'actions-cost.md') : path.resolve(doc);
  const savedDir = dir === undefined ? path.join(ROOT, 'lab', 'actions-cost') : path.resolve(dir);
  let text: string;
  try {
    text = readFileSync(docFile, 'utf8');
  } catch (e) {
    // 오류 글에는 절대 경로가 들어 있어 오류 코드만 낸다
    const code = (e as NodeJS.ErrnoException | null)?.code;
    process.stderr.write(
      `check-doc: 문서를 읽지 못했다(${typeof code === 'string' ? code : '오류'})\n`,
    );
    return 1;
  }
  const problems = checkDoc({
    doc: text,
    // 이름은 checkDoc이 정한 꼴만 넘긴다(기준선 파일 이름, <날짜>_<날짜>.jsonl)
    saved: (name) => {
      try {
        return readFileSync(path.join(savedDir, name), 'utf8');
      } catch {
        return null;
      }
    },
    known: knownFromCheckout(),
  });
  if (problems.length) {
    process.stderr.write(`check-doc: 어긋난 점 ${problems.length}건\n`);
    for (const p of problems) process.stderr.write(`- ${p}\n`);
    return 1;
  }
  process.stdout.write('check-doc: 통과\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
