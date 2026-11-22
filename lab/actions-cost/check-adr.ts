// ADR(docs/decisions/ADR-<번호>-actions-cost.md)에서 후보의 평가나 결정이 빠지면 실패하게 하는 검사
// (계획 20261121-actions-cost-design step2). 표와 줄을 읽어 칸과 값을 본다.
// 문서 검사(check-doc.ts)와 같은 좁은 형식만 받는다(`viewsOf`). 그 위에 값이 든 자리를 닫아 둔다:
// 표는 "후보표" 절의 표 하나뿐이고, 묶음에는 정한 줄만, "결정"의 목록에는 정한 줄만 적는다.
// 화면에는 값으로 보이는데 검사가 읽지 않는 줄(모양만 바꾼 둘째 줄, 이어 쓴 줄)을 받지 않기 위해서다.
// 평가가 옳은가, 출처가 그 사실을 말하는가, 추정이 그럴듯한가는 보지 않는다. 그것은 PR 검증과 제작자가 본다.
//   node lab/actions-cost/check-adr.ts [--file <ADR 파일>]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blank, BUDGET, cellsOf, dense, partsOf, realDay, viewsOf } from './check-doc.ts';

/** 반드시 다뤄야 하는 후보의 ID(계획 step2의 후보 표) */
export const REQUIRED_IDS: readonly string[] = [
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'B1',
  'B2',
  'B3',
  'B4',
  'C1',
  'C2',
  'C3',
  'D1',
  'D2',
  'D3',
  'E1',
  'E2',
];

const SECTIONS = ['배경', '후보표', '묶음', '결정', '되돌리는 조건'] as const;
type Title = (typeof SECTIONS)[number];
type Status = '제안' | '채택';

const TABLE_HEAD = [
  'ID',
  '수단',
  '예상 절감',
  '잃는 보장',
  '바꿔야 하는 것',
  '되돌리는 방법',
  '확인 상태',
];
/** ADR(docs/decisions)에서 본 기준선 문서(docs/harness/actions-cost.md)의 주소 */
const BASELINE_LINK = /^\.\.\/harness\/actions-cost\.md(#[^#]*)?$/;
const ID_RE = /^[A-Z]\d+$/;
/** 자리만 채운 글(강조 표시·공백·마침표를 떼고 견준다) */
const FILLERS = new Set(['', '-', '—', '?', 'tbd', '미정', '없음']);
const CHANGE_WORDS = ['워크플로', '설계서', '훅', '스크립트', '설정', '절차서'];

const MONTH_HEAD = `- 월 금액(PR ${BUDGET.prsPerMonth}개):`;
const SHORT_HEAD = '- 모자라는 폭:';
/** 묶음에 한 번씩 적는 줄(`- PR당 청구 분(분당 $<단가>):`와 `- 모자라는 폭:`은 따로 본다) */
const BUNDLE_HEADS = [
  '- 수단:',
  '- 가정:',
  '- PR당 금액:',
  MONTH_HEAD,
  '- 예산 안인가:',
  '- 잃는 보장:',
];
const RATE_RE = /^- PR당 청구 분\(분당 \$([^():]*)\):(.*)$/;
const BUNDLE_KEYS = [
  '수단:',
  '가정:',
  'PR당 청구 분',
  'PR당 금액:',
  '월 금액',
  '예산 안인가:',
  '모자라는 폭:',
  '잃는 보장:',
];
const DECISION_HEADS = ['- 추천 묶음:', '- 고른 묶음:', '- 순서:', '- 이유:', '- 결정한 사람:'];

/** 금액은 $0.00001 단위의 정수로 센다(분은 0.1분, 단가는 $0.0001 단위) */
const UNITS_PER_USD = 100000n;
const BUDGET_UNITS = BigInt(BUDGET.accountUsd) * UNITS_PER_USD;
const PRS = BigInt(BUDGET.prsPerMonth);

interface Range {
  from: number;
  to: number;
}

/** 목록·인용으로 보이는 줄(들여 쓴 것, 다른 목록 표시 포함) */
const LISTISH = /^ {0,3}(?:[-*+](?: |$)|>|\d+[.)](?: |$))/;
/** 강조 표시와 백틱을 떼고 쌍점 앞의 공백을 없앤 글. 모양만 바꾼 줄을 찾을 때 쓴다 */
const unstyled = (line: string) => line.replace(/[*_~`]/g, '').replace(/\s+:/g, ':');
const count = <T>(xs: T[], x: T) => xs.filter((y) => y === x).length;

/** 소수로 적은 수를 10^-scale 단위의 정수로 읽는다. 수가 아니면 null. strict면 scale보다 잘게 적은 것도 null이다 */
function decimal(s: string, scale: number, strict: boolean): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,12}))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > scale && (strict || /[^0]/.test(frac.slice(scale)))) return null;
  return BigInt(m[1]) * 10n ** BigInt(scale) + BigInt(frac.slice(0, scale).padEnd(scale, '0'));
}
/** `$`와 수로 적은 표시값을 $0.00001 단위로 읽는다(`$18.02`와 `$18.020`은 같다) */
const money = (s: string) => (s.startsWith('$') ? decimal(s.slice(1), 5, false) : null);
const ceilTo = (x: bigint, step: bigint) => ((x + step - 1n) / step) * step;
function usd(units: bigint, digits: number): string {
  const s = units.toString().padStart(6, '0');
  return `$${s.slice(0, -5)}.${s.slice(-5).slice(0, digits)}`;
}
/** 문서에서 온 글을 어긋난 점에 옮길 때 길이를 자른다 */
const quote = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/** 다섯 절의 범위(제목 다음 줄부터 다음 `## ` 전까지). 없거나 두 번 있는 절은 넣지 않는다 */
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

/** 머리(첫 `## ` 앞)의 `- 상태:` 줄. 하나가 아니거나 값이 정한 것이 아니면 null */
function statusOf(head: string[], problems: string[]): Status | null {
  const HEAD = '- 상태:';
  if (head.some((l) => !l.startsWith(HEAD) && unstyled(l).includes('상태:')))
    problems.push(`머리: "상태:"가 든 줄이 "${HEAD}" 줄 말고 더 있다(상태는 그 한 줄에만 적는다)`);
  const hits = head.flatMap((l, i) => (l.startsWith(HEAD) ? [i] : []));
  if (hits.length !== 1) {
    problems.push(
      hits.length
        ? `머리: "${HEAD}" 줄이 ${hits.length}번 있다(한 번이어야 한다)`
        : `머리: "${HEAD}" 줄이 없다`,
    );
    return null;
  }
  const next = head[hits[0] + 1];
  if (next !== undefined && !blank(next) && !next.startsWith('- '))
    problems.push(
      `머리: "${HEAD}" 줄의 다음 줄은 빈 줄이거나 다른 목록 줄이다(이어 쓴 줄은 화면에서 그 줄의 값이 된다)`,
    );
  const m = /^(제안|채택)(?![\p{L}\p{N}])/u.exec(head[hits[0]].slice(HEAD.length).trim());
  if (!m) {
    problems.push(`머리: "${HEAD}" 줄의 값이 "제안"이나 "채택"으로 시작하지 않는다`);
    return null;
  }
  return m[1] as Status;
}

/** 코드 구간을 가린 글자. 코드 안의 대괄호와 괄호는 링크의 문법이 아니다 */
const CODE_MARK = '\uE000';

/**
 * 한 문단(줄바꿈으로 이은 줄. 코드 구간은 CODE_MARK로 가렸다)에서 화면에 링크로 보이는 것의 주소.
 * `](주소)`에서 거슬러 올라가 짝이 맞는 여는 대괄호를 찾는다. 여는 대괄호가 없거나, 글에 보이는
 * 글자가 없거나, 글 안에 링크가 있으면(그때 바깥 대괄호는 링크가 아니다) 세지 않는다
 */
function linkTargets(para: string): string[] {
  const targets: string[] = [];
  for (const m of para.matchAll(/\]\(([^()\s"'<>|`\uE000]*)\)/g)) {
    let depth = 0;
    let open = -1;
    for (let j = m.index - 1; j >= 0 && open < 0; j--) {
      if (para[j] === ']') depth++;
      else if (para[j] === '[') {
        if (depth === 0) open = j;
        else depth--;
      }
    }
    if (open < 0) continue;
    const label = para.slice(open + 1, m.index);
    if (label.includes('](') || !/[^\s*_[\]]/.test(label)) continue;
    targets.push(m[1]);
  }
  return targets;
}

function checkBackground(
  raw: string[],
  struct: string[],
  fenced: boolean[],
  r: Range,
  problems: string[],
): void {
  const body = struct.slice(r.from, r.to);
  const n = dense(body);
  if (n < 100) problems.push(`배경: 본문이 공백을 빼고 100자보다 짧다(${n}자)`);
  // 링크의 주소는 struct에서 빠져 있다. raw에서 문단마다 찾는다(링크의 글은 줄을 넘을 수 있다).
  // 주소는 ADR 폴더(docs/decisions)에서 본 기준선 문서 그대로여야 한다(뒤에 #절 이름만 받는다).
  // 파일 이름만 같은 다른 주소나 같은 문서를 다르게 적은 주소는 세지 않는다
  let linked = false;
  let para: string[] = [];
  const flush = (): void => {
    if (linkTargets(para.join('\n')).some((t) => BASELINE_LINK.test(t))) linked = true;
    para = [];
  };
  for (let i = r.from; i < r.to; i++) {
    const parts = fenced[i] || blank(raw[i]) ? null : partsOf(raw[i]);
    if (!parts) {
      flush();
      continue;
    }
    // 목록 항목·인용·제목은 새 블록을 연다. 앞 줄의 여는 대괄호와 이어지지 않는다
    if (LISTISH.test(raw[i]) || /^ {0,3}#/.test(raw[i])) flush();
    para.push(parts.map((p) => (p.code ? CODE_MARK : p.s)).join(''));
  }
  flush();
  if (!linked)
    problems.push(
      '배경: 기준선 문서로 가는 링크가 없다(주소는 ../harness/actions-cost.md 그대로 적는다)',
    );
  if (!new RegExp(`(?<![\\d.,])${BUDGET.minutesPerPr}분`).test(body.join('\n')))
    problems.push(`배경: 예산("${BUDGET.minutesPerPr}분")이 없다`);
}

function checkCell(at: string, name: string, cell: string, problems: string[]): void {
  if (cell === '') {
    problems.push(`${at}: "${name}" 칸이 비었다`);
    return;
  }
  const bare = cell.replace(/[\s*_`~.]/g, '').toLowerCase();
  if (FILLERS.has(bare) && !(name === '잃는 보장' && bare === '없음')) {
    problems.push(`${at}: "${name}" 칸이 자리만 채운 글이다(${quote(cell)})`);
    return;
  }
  const n = dense([cell]);
  const short = (min: number) => {
    if (n < min) problems.push(`${at}: "${name}" 칸이 공백을 빼고 ${min}자보다 짧다(${n}자)`);
  };
  /** 정한 말 뒤에 적은 글의 길이 */
  const after = (lead: string) => dense([cell.slice(lead.length).replace(/^[\s:.,]+/, '')]);
  if (name === '수단') short(4);
  else if (name === '예상 절감') {
    const WAIT = '재 봐야 안다';
    if (cell.startsWith(WAIT)) {
      if (after(WAIT) < 10)
        problems.push(
          `${at}: "${name}" 칸의 "${WAIT}" 뒤에 왜 계산할 수 없는지가 공백을 빼고 10자보다 짧다`,
        );
    } else if (!/\d\s*(?:분|%)/.test(cell) && !/\$\s*\d/.test(cell))
      problems.push(`${at}: "${name}" 칸에 수와 단위(분·%·$)가 없고 "${WAIT}"로 시작하지도 않는다`);
  } else if (name === '잃는 보장') {
    if (
      !cell.startsWith('없음') &&
      !/\d+(?:\.\d+)?절/.test(cell) &&
      !/(?<![A-Za-z0-9])[RE]\d+(?![A-Za-z])/.test(cell)
    )
      problems.push(
        `${at}: "${name}" 칸이 "없음"으로 시작하지 않고 절 번호(예: 10.4절)나 규칙·보장 번호(예: R7, E3)도 없다`,
      );
  } else if (name === '바꿔야 하는 것') {
    if (!CHANGE_WORDS.some((w) => cell.includes(w)))
      problems.push(`${at}: "${name}" 칸에 ${CHANGE_WORDS.join('·')} 가운데 하나가 없다`);
    short(10);
  } else if (name === '되돌리는 방법') short(10);
  else if (name === '확인 상태') {
    const NONE = '확인 못 함';
    if (cell.startsWith('확인함(외부 사실 없음)')) return;
    if (cell.startsWith(NONE)) {
      if (after(NONE) < 10)
        problems.push(
          `${at}: "${name}" 칸의 "${NONE}" 뒤에 무엇을 확인하지 못했는지가 공백을 빼고 10자보다 짧다`,
        );
      return;
    }
    const m = /^확인함\(([^)]*)\)/.exec(cell);
    if (!m) {
      problems.push(
        `${at}: "${name}" 칸이 "확인함(출처의 https 주소, YYYY-MM-DD)"·"확인함(외부 사실 없음)"·"${NONE}" 가운데 하나로 시작하지 않는다`,
      );
      return;
    }
    if (!/https:\/\/[^\s,)]+\.[^\s,)]+/.test(m[1]))
      problems.push(`${at}: "${name}" 칸의 괄호 안에 출처의 https:// 주소가 없다`);
    const days = m[1].match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (!days.length || !days.every(realDay))
      problems.push(`${at}: "${name}" 칸의 괄호 안에 실재하는 날짜(YYYY-MM-DD)가 없다`);
  }
}

/** 후보표의 ID. 표를 읽지 못했으면 null */
function checkCandidates(body: string[], problems: string[]): Set<string> | null {
  // 표: `|`로 시작하는 줄이 이어진 묶음
  const tables: string[][] = [];
  const starts: number[] = [];
  let current: string[] | null = null;
  body.forEach((l, i) => {
    if (!/^ {0,3}\|/.test(l)) current = null;
    else if (current) current.push(l);
    else {
      tables.push((current = [l]));
      starts.push(i);
    }
  });
  // `|`로 시작하지 않는 줄도 화면에서는 표의 행이나 다른 표가 된다
  if (body.some((l) => l.includes('|') && !/^ {0,3}\|/.test(l)))
    problems.push(
      '후보표: 표 밖의 줄에 `|`를 쓰지 않는다(`|`로 시작하지 않는 줄도 화면에서 표가 된다)',
    );
  if (tables.length !== 1) {
    problems.push(`후보표: 표가 ${tables.length}개다(하나여야 한다)`);
    return null;
  }
  const end = starts[0] + tables[0].length;
  if ((starts[0] > 0 && !blank(body[starts[0] - 1])) || (end < body.length && !blank(body[end])))
    problems.push('후보표: 표의 앞뒤에 빈 줄을 둔다(표에 붙여 쓴 줄은 화면에서 표의 행이 된다)');
  const [head, rule, ...rows] = tables[0];
  if (cellsOf(head).join('\n') !== TABLE_HEAD.join('\n')) {
    problems.push(`후보표: 표의 머리 줄이 다르다(| ${TABLE_HEAD.join(' | ')} |여야 한다)`);
    return null;
  }
  const ruleCells = rule === undefined ? [] : cellsOf(rule);
  if (ruleCells.length !== TABLE_HEAD.length || !ruleCells.every((c) => /^:?-+:?$/.test(c))) {
    problems.push(
      `후보표: 표의 둘째 줄이 머리 줄과 칸 수가 같은 구분 줄(| --- | … |, ${TABLE_HEAD.length}칸)이 아니다`,
    );
    return null;
  }
  const ids: string[] = [];
  rows.forEach((line, k) => {
    const c = cellsOf(line);
    const shaped = ID_RE.test(c[0]);
    const at = shaped ? `후보표 ${c[0]} 행` : `후보표 ${k + 1}째 행`;
    if (shaped) ids.push(c[0]);
    else problems.push(`${at}: ID(${quote(c[0])})가 대문자 하나와 수의 꼴(예: A1)이 아니다`);
    if (c.length !== TABLE_HEAD.length) {
      problems.push(`${at}: 칸이 ${c.length}개다(${TABLE_HEAD.length}개여야 한다)`);
      return;
    }
    for (let j = 1; j < TABLE_HEAD.length; j++) checkCell(at, TABLE_HEAD[j], c[j], problems);
  });
  for (const id of REQUIRED_IDS)
    if (!ids.includes(id)) problems.push(`후보표: ${id} 행이 없다(반드시 다루는 후보다)`);
  for (const id of new Set(ids))
    if (count(ids, id) > 1)
      problems.push(`후보표: ID ${id}가 ${count(ids, id)}번 있다(겹치지 않아야 한다)`);
  return new Set(ids);
}

/** 쉼표나 화살표로 나눈 ID 목록. ID의 꼴이 아닌 것이 있으면 null */
function idList(value: string, separator: string): string[] | null {
  const tokens = value.split(separator).map((s) => s.trim());
  return tokens.every((t) => ID_RE.test(t)) ? tokens : null;
}

interface Bundle {
  name: string;
  /** 줄의 머리 → 값(줄마다 하나) */
  values: Map<string, string[]>;
  rates: { rate: string; minutes: string }[];
}

/** 묶음의 이름 → `수단`의 ID(읽지 못했으면 null) */
function checkBundles(
  body: string[],
  from: number,
  tableIds: Set<string> | null,
  problems: string[],
): Map<string, string[] | null> {
  const bundles: Bundle[] = [];
  let current: Bundle | null = null;
  const heads = [...BUNDLE_HEADS, SHORT_HEAD];
  body.forEach((l, k) => {
    if (blank(l)) return;
    const at = `${from + k + 1}째 줄`;
    const title = /^### 묶음 (\S.*?)\s*$/.exec(l);
    if (title) {
      bundles.push((current = { name: title[1], values: new Map(), rates: [] }));
      return;
    }
    if (/^ {0,3}#/.test(l)) {
      problems.push(`묶음: ${at}의 제목이 "### 묶음 <이름>" 꼴이 아니다`);
      return;
    }
    if (!current) {
      // 첫 묶음 앞의 글: 풀어 쓴 문단만 받는다
      if (LISTISH.test(l))
        problems.push(
          `묶음: ${at} — 첫 묶음 제목 앞에는 목록과 인용을 쓰지 않는다(값은 묶음의 정한 줄에만 적는다)`,
        );
      else if (BUNDLE_KEYS.some((key) => unstyled(l).includes(key)))
        problems.push(
          `묶음: ${at} — 묶음의 줄 이름을 묶음 밖에 쓰지 않는다(값은 묶음의 정한 줄에만 적는다)`,
        );
      return;
    }
    const head = heads.find((h) => l.startsWith(h));
    const rate = RATE_RE.exec(l);
    if (head)
      current.values.set(head, [...(current.values.get(head) ?? []), l.slice(head.length).trim()]);
    else if (rate) current.rates.push({ rate: rate[1].trim(), minutes: rate[2].trim() });
    else
      problems.push(
        `묶음 ${quote(current.name)}: ${at}이 정한 줄(${heads.join(' ')} - PR당 청구 분(분당 $<단가>):)로 시작하지 않는다(묶음에는 정한 줄만 적는다)`,
      );
  });

  if (bundles.length < 2) problems.push(`묶음: 묶음이 ${bundles.length}개다(둘 이상이어야 한다)`);
  const names = bundles.map((b) => b.name);
  for (const name of new Set(names)) {
    if (count(names, name) > 1) problems.push(`묶음: 이름 "${quote(name)}"가 겹친다`);
    if (ID_RE.test(name))
      problems.push(`묶음: 이름 "${name}"가 후보의 ID와 같은 꼴이다(다른 이름을 쓴다)`);
  }

  const result = new Map<string, string[] | null>();
  for (const b of bundles) {
    const at = `묶음 ${quote(b.name)}`;
    /** 한 번 있고 값이 있는 줄의 값 */
    const one = (head: string): string | null => {
      const vals = b.values.get(head) ?? [];
      if (vals.length !== 1) {
        problems.push(
          vals.length
            ? `${at}: "${head}" 줄이 ${vals.length}번 있다(한 번이어야 한다)`
            : `${at}: "${head}" 줄이 없다`,
        );
        return null;
      }
      if (vals[0] === '') {
        problems.push(`${at}: "${head}" 줄의 값이 비었다`);
        return null;
      }
      return vals[0];
    };

    let ids: string[] | null = null;
    const idsText = one('- 수단:');
    if (idsText !== null) {
      ids = idList(idsText, ',');
      if (!ids) problems.push(`${at}: "- 수단:"의 값이 후보표의 ID를 쉼표로 나눈 목록이 아니다`);
      else {
        for (const id of new Set(ids)) {
          if (count(ids, id) > 1) problems.push(`${at}: "- 수단:"의 ${id} ID가 겹친다`);
          if (tableIds && !tableIds.has(id))
            problems.push(`${at}: "- 수단:"의 ${id} ID가 후보표에 없다`);
        }
        ids = [...new Set(ids)];
      }
    }
    if (!result.has(b.name)) result.set(b.name, ids);

    const assume = one('- 가정:');
    if (assume !== null && dense([assume]) < 10)
      problems.push(`${at}: "- 가정:"이 공백을 빼고 10자보다 짧다`);
    one('- 잃는 보장:');

    // 원값: 분 × 단가의 합($0.00001 단위의 정수). 읽지 못한 줄이 있으면 null
    let raw: bigint | null = 0n;
    if (!b.rates.length) {
      problems.push(
        `${at}: "- PR당 청구 분(분당 $<단가>):" 줄이 없다(한 줄 이상이어야 한다. 금액은 이 줄에서 계산한다)`,
      );
      raw = null;
    }
    const seen = new Set<bigint>();
    for (const { rate, minutes } of b.rates) {
      const line = `"PR당 청구 분(분당 $${quote(rate)})" 줄`;
      const r = decimal(rate, 4, true);
      if (r === null)
        problems.push(
          /^\d+\.\d{5,}$/.test(rate)
            ? `${at}: ${line}의 단가는 소수 넷째 자리까지 적는다`
            : `${at}: ${line}의 단가가 수가 아니다`,
        );
      else if (r === 0n) problems.push(`${at}: ${line}의 단가는 0보다 커야 한다`);
      else if (seen.has(r)) problems.push(`${at}: 단가 $${rate}가 겹친다(단가마다 한 줄이다)`);
      const m = decimal(minutes, 1, true);
      if (minutes === '') problems.push(`${at}: ${line}의 값이 비었다`);
      else if (m === null)
        problems.push(
          /^\d+\.\d{2,}$/.test(minutes)
            ? `${at}: ${line}의 분은 소수 첫째 자리까지 적는다`
            : `${at}: ${line}의 분이 0 이상의 수가 아니다(${quote(minutes)})`,
        );
      if (r === null || r === 0n || seen.has(r) || m === null) raw = null;
      else if (raw !== null) raw += r * m;
      if (r !== null) seen.add(r);
    }

    const per = one('- PR당 금액:');
    const month = one(MONTH_HEAD);
    const within = one('- 예산 안인가:');
    const shorts = b.values.get(SHORT_HEAD) ?? [];
    if (within !== null && within !== '예' && within !== '아니오')
      problems.push(`${at}: "- 예산 안인가:"가 "예"나 "아니오"가 아니다`);
    if (shorts.length > 1) problems.push(`${at}: "${SHORT_HEAD}" 줄이 ${shorts.length}번 있다`);
    if (raw === null) continue;

    /** 표시값이 계산한 값과 같은가 */
    const same = (head: string, shown: string, want: bigint, digits: number, how: string) => {
      if (money(shown) !== want)
        problems.push(
          `${at}: "${head}"(${quote(shown)})이 ${how}(${usd(want, digits)})과 다르다. "$"와 수로 적는다`,
        );
    };
    const monthRaw = raw * PRS;
    if (per !== null)
      same(
        '- PR당 금액:',
        per,
        ceilTo(raw, 100n),
        3,
        'PR당 청구 분 줄의 분 × 단가의 합을 소수 셋째 자리로 올림한 값',
      );
    if (month !== null)
      same(
        MONTH_HEAD,
        month,
        ceilTo(monthRaw, 1000n),
        2,
        `원값 × ${BUDGET.prsPerMonth}을 소수 둘째 자리로 올림한 값`,
      );
    const over = monthRaw > BUDGET_UNITS;
    if ((within === '예' && over) || (within === '아니오' && !over))
      problems.push(
        `${at}: "- 예산 안인가:"가 "${within}"인데 월 원값 ${usd(monthRaw, 5)}은 계정의 월 예산 $${BUDGET.accountUsd}${over ? '을 넘는다' : ' 이하다'}(분이 아니라 금액으로, 표시값이 아니라 원값으로 판정한다)`,
      );
    if (!over) {
      if (shorts.length)
        problems.push(`${at}: "${SHORT_HEAD}" 줄은 예산을 넘을 때("아니오")만 적는다`);
    } else if (!shorts.length)
      problems.push(`${at}: "${SHORT_HEAD}" 줄이 없다(예산을 넘으면 적는다)`);
    else if (shorts.length === 1)
      same(
        SHORT_HEAD,
        shorts[0],
        ceilTo(monthRaw - BUDGET_UNITS, 1000n),
        2,
        `원값 × ${BUDGET.prsPerMonth} − $${BUDGET.accountUsd}를 소수 둘째 자리로 올림한 값`,
      );
  }
  return result;
}

function checkDecision(
  body: string[],
  from: number,
  status: Status | null,
  bundles: Map<string, string[] | null>,
  tableIds: Set<string> | null,
  problems: string[],
): void {
  if (!body.join('\n').includes('별도 Issue'))
    problems.push(
      '결정: 본문에 "별도 Issue"가 없다(고른 수단은 수단마다 별도 Issue로 구현한다고 적는다)',
    );
  const values = new Map<string, string[]>();
  const names = DECISION_HEADS.map((h) => `"${h}"`).join('·');
  body.forEach((l, k) => {
    if (blank(l)) return;
    const at = `${from + k + 1}째 줄`;
    const head = DECISION_HEADS.find((h) => l.startsWith(h));
    if (head) {
      values.set(head, [...(values.get(head) ?? []), l.slice(head.length).trim()]);
      const next = body[k + 1];
      if (next !== undefined && !blank(next) && !DECISION_HEADS.some((h) => next.startsWith(h)))
        problems.push(
          `결정: ${at}("${head}")의 다음 줄은 빈 줄이거나 정한 줄이다(이어 쓴 줄은 화면에서 그 줄의 값이 된다)`,
        );
    } else if (LISTISH.test(l))
      problems.push(
        `결정: ${at}의 목록·인용 줄이 ${names} 가운데 하나로 시작하지 않는다(목록에는 정한 줄만 적는다)`,
      );
    else {
      const key = DECISION_HEADS.map((h) => h.slice(2)).find((x) => unstyled(l).includes(x));
      if (key) problems.push(`결정: ${at}에 "${key}"가 있다(그 값은 "- ${key}" 줄에만 적는다)`);
    }
  });
  if (!status) return;

  const one = (head: string, required: boolean): string | null => {
    const vals = values.get(head) ?? [];
    if (!vals.length) {
      if (required) problems.push(`결정: 상태가 "${status}"인데 "${head}" 줄이 없다`);
      return null;
    }
    if (vals.length > 1) {
      problems.push(`결정: "${head}" 줄이 ${vals.length}번 있다(한 번이어야 한다)`);
      return null;
    }
    if (vals[0] === '') {
      problems.push(`결정: "${head}" 줄의 값이 비었다`);
      return null;
    }
    return vals[0];
  };
  const adopted = status === '채택';
  if (!adopted)
    for (const head of ['- 고른 묶음:', '- 결정한 사람:'])
      if (values.has(head))
        problems.push(
          `결정: 상태가 "제안"인데 "${head}" 줄이 있다(제작자가 고른 뒤에 상태를 "채택"으로 바꾸고 적는다)`,
        );

  const recommended = one('- 추천 묶음:', !adopted);
  if (recommended !== null && !bundles.has(recommended))
    problems.push(`결정: 추천 묶음 "${quote(recommended)}"는 위 묶음의 이름이 아니다`);
  const why = one('- 이유:', !adopted);
  if (why !== null && dense([why]) < 20)
    problems.push('결정: "- 이유:"가 공백을 빼고 20자보다 짧다');

  /** 고른 수단. 읽지 못했으면 null */
  let chosen: string[] | null = null;
  if (!adopted) chosen = recommended === null ? null : (bundles.get(recommended) ?? null);
  else {
    const picked = one('- 고른 묶음:', true);
    if (picked !== null && bundles.has(picked)) chosen = bundles.get(picked) ?? null;
    else if (picked !== null) {
      const ids = idList(picked, ',');
      if (!ids)
        problems.push(
          `결정: 고른 묶음 "${quote(picked)}"는 위 묶음의 이름도, 후보표의 ID를 쉼표로 나눈 목록도 아니다`,
        );
      else {
        for (const id of new Set(ids)) {
          if (count(ids, id) > 1) problems.push(`결정: 고른 묶음의 ${id} ID가 겹친다`);
          if (tableIds && !tableIds.has(id))
            problems.push(`결정: 고른 묶음의 ${id} ID가 후보표에 없다`);
        }
        chosen = [...new Set(ids)];
      }
    }
    const who = one('- 결정한 사람:', true);
    if (who !== null) {
      const m = /^제작자\((\d{4}-\d{2}-\d{2})\)/.exec(who);
      if (!m) problems.push('결정: "- 결정한 사람:"이 "제작자(YYYY-MM-DD)"로 시작하지 않는다');
      else if (!realDay(m[1]))
        problems.push(`결정: "- 결정한 사람:"의 날짜(${m[1]})가 실재하는 날짜가 아니다`);
    }
  }

  const orderText = one('- 순서:', true);
  if (orderText === null) return;
  const order = idList(orderText, '→');
  if (!order) {
    problems.push('결정: "- 순서:"의 값이 후보표의 ID를 "→"로 이은 목록이 아니다');
    return;
  }
  for (const id of new Set(order)) {
    if (count(order, id) > 1)
      problems.push(`결정: 순서에 ${id}가 ${count(order, id)}번 있다(한 번씩 적는다)`);
    if (chosen ? !chosen.includes(id) : tableIds && !tableIds.has(id))
      problems.push(
        chosen
          ? `결정: 순서의 ${id}는 고른 수단(${chosen.join(', ')})에 없다`
          : `결정: 순서의 ${id}는 후보표에 없다`,
      );
  }
  for (const id of chosen ?? [])
    if (!order.includes(id)) problems.push(`결정: 순서에 고른 수단 ${id}가 빠졌다`);
}

/** 어긋난 점의 목록. 없으면 빈 배열 */
export function checkAdr(text: string): string[] {
  const problems: string[] = [];
  // 표식 구간은 받지 않는다(그 안의 줄이 화면에 보이는 채 읽히지 않는다)
  const v = viewsOf(text, problems, false);
  v.struct.forEach((l, i) => {
    if (/^ {1,3}#{1,6}(?: |$)/.test(l))
      problems.push(`형식(${i + 1}째 줄): 제목은 줄 머리에서 시작한다(들여 쓰지 않는다)`);
  });
  const found = sections(v.struct, problems);
  const firstSection = v.struct.findIndex((l) => l.startsWith('## '));
  const status = statusOf(
    v.struct.slice(0, firstSection < 0 ? v.struct.length : firstSection),
    problems,
  );
  const part = (r: Range) => v.struct.slice(r.from, r.to);

  // 표는 "후보표" 절의 표 하나뿐이다. 다른 자리의 표는 칸을 보지 않은 채 화면에 보인다. 절마다 처음 한 줄만 낸다
  const kept = found.get('후보표');
  const told = new Set<string>();
  v.struct.forEach((l, k) => {
    if (!l.includes('|') || (kept && k >= kept.from && k < kept.to)) return;
    const title = [...found].find(([, r]) => k >= r.from && k < r.to)?.[0] ?? '절 밖';
    if (told.has(title)) return;
    told.add(title);
    problems.push(
      `표: ${k + 1}째 줄(${title})에 \`|\`가 있다. 표는 "후보표" 절에만 둔다(다른 자리의 표는 칸을 보지 않는다)`,
    );
  });

  const background = found.get('배경');
  if (background) checkBackground(v.raw, v.struct, v.fenced, background, problems);
  const tableIds = kept ? checkCandidates(part(kept), problems) : null;
  const bundleRange = found.get('묶음');
  const bundles = bundleRange
    ? checkBundles(part(bundleRange), bundleRange.from, tableIds, problems)
    : new Map<string, string[] | null>();
  const decision = found.get('결정');
  if (decision) checkDecision(part(decision), decision.from, status, bundles, tableIds, problems);
  const undo = found.get('되돌리는 조건');
  if (undo) {
    const n = dense(part(undo));
    if (n < 30) problems.push(`되돌리는 조건: 본문이 공백을 빼고 30자보다 짧다(${n}자)`);
  }
  return problems;
}

// ---- 명령행 ----

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = '사용법: node lab/actions-cost/check-adr.ts [--file <ADR 파일>]\n';

function main(argv: string[]): number {
  if (argv.length !== 0 && !(argv.length === 2 && argv[0] === '--file')) {
    process.stderr.write(USAGE);
    return 1;
  }
  let file: string;
  if (argv.length === 2) file = path.resolve(argv[1]);
  else {
    // 기본값: docs/decisions의 ADR-<번호>-actions-cost.md 하나
    const dir = path.join(ROOT, 'docs', 'decisions');
    let names: string[];
    try {
      names = readdirSync(dir).filter((f) => /^ADR-\d+-actions-cost\.md$/.test(f));
    } catch {
      names = [];
    }
    if (names.length !== 1) {
      process.stderr.write(
        `check-adr: docs/decisions에 ADR-<번호>-actions-cost.md가 ${names.length}개다(하나여야 한다)\n`,
      );
      return 1;
    }
    file = path.join(dir, names[0]);
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    // 오류 글에는 절대 경로가 들어 있어 오류 코드만 낸다
    const code = (e as NodeJS.ErrnoException | null)?.code;
    process.stderr.write(
      `check-adr: ADR을 읽지 못했다(${typeof code === 'string' ? code : '오류'})\n`,
    );
    return 1;
  }
  const problems = checkAdr(text);
  if (problems.length) {
    process.stderr.write(`check-adr: 어긋난 점 ${problems.length}건\n`);
    for (const p of problems) process.stderr.write(`- ${p}\n`);
    return 1;
  }
  process.stdout.write('check-adr: 통과\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
