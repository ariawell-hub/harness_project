// 설계서 머리말의 버전·최종 갱신과 변경 이력 읽기(R8 설계서 버전). doc-lint, harness-guard, 변경 조각 모으기가 같은 규칙을 쓴다.
// scripts/gates/doc-lint.ts에서 옮겼다(TD-39, Issue #222). 규칙과 문제 글은 그대로다.
import type { Problem } from './util.ts';

const DOC = 'docs/harness/design.md 7.2절, R8';
/** 설계서의 경로. doc-lint는 문서 목록에 있을 때만 머리말과 변경 이력을 견준다 */
export const DESIGN_DOC = 'docs/harness/design.md';
const VERSION = String.raw`\d+(?:\.\d+)*`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
/**
 * `> 버전 v<버전> · <임의의 글자> 최종 갱신: <날짜>`. `최종 갱신:` 바로 앞은 공백이다(가운데 글이 없으면 ` · ` 뒤에 바로 온다).
 * 줄은 이미 LF로 나눴으므로 가운데의 `.`은 모든 글자다(`s`)
 */
const DESIGN_HEAD = new RegExp(`^> 버전 v(${VERSION}) ·(?: .*)? 최종 갱신: (${DATE})\\s*$`, 's');
/** 변경 이력의 항목: 공백 둘, 붙임표, `v<버전> (<날짜>): ` */
const DESIGN_ITEM = new RegExp(`^  - v(${VERSION}) \\((${DATE})\\): `);

/** 버전을 마디마다 수로 견준다. 앞 마디가 모두 같으면 마디가 더 많은 쪽이 크다 */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(BigInt);
  const y = b.split('.').map(BigInt);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

const problem = (what: string): Problem => ({
  rule: 'R8 설계서 버전',
  what,
  how: '머리말의 버전·최종 갱신을 변경 이력의 마지막 항목과 맞춰라. main을 병합하다 버전이 겹쳤으면 이 PR의 항목을 다음 번호로 올려라',
  doc: DOC,
});

export interface DesignVersion {
  /** 머리말 줄: 0부터 센 줄 번호, 버전(`v`를 뺀 글), 최종 갱신 날짜 */
  head: { line: number; version: string; date: string };
  /** 변경 이력 항목(하나 이상): 0부터 센 줄 번호, 버전, 날짜 */
  items: { line: number; version: string; date: string }[];
  /** 변경 이력 목록의 마지막 줄(마지막 항목에 딸린 더 깊이 들여쓴 줄 포함) 다음 줄의 번호(0부터) */
  end: number;
}

/** 머리말과 변경 이력을 읽는다. 읽지 못하면 그 문제들(형식이 바뀌어 검사가 조용히 꺼지는 일을 막는다) */
export function readDesignVersion(
  text: string,
): { ok: true; value: DesignVersion } | { ok: false; problems: Problem[] } {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const unreadable: Problem[] = [];
  const headIndex = lines.findIndex((l) => l.startsWith('> 버전 v'));
  const head = headIndex < 0 ? null : DESIGN_HEAD.exec(lines[headIndex]);
  if (headIndex < 0) {
    unreadable.push(problem('설계서에 머리말 줄(`> 버전 v…`)이 없다'));
  } else if (!head) {
    unreadable.push(
      problem('설계서 머리말 줄의 형식이 틀리다(`> 버전 v<버전> · … 최종 갱신: <YYYY-MM-DD>`)'),
    );
  }

  const items: DesignVersion['items'] = [];
  let end = -1;
  const start = lines.findIndex((l) => l.startsWith('- **변경 이력**'));
  if (start < 0) {
    unreadable.push(problem('설계서에 변경 이력 목록(`- **변경 이력**`)이 없다'));
  } else {
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue; // 빈 줄은 목록을 끝내지 않는다
      if (!l.startsWith('  ')) break; // 다음 최상위 항목이나 본문
      end = i + 1;
      if (!l.startsWith('  - ')) continue; // 더 깊이 들여쓴 줄은 앞 항목에 딸린 줄이다
      count++;
      const m = DESIGN_ITEM.exec(l);
      if (m) items.push({ line: i, version: m[1], date: m[2] });
      else {
        unreadable.push(
          problem(
            `설계서 ${i + 1}번째 줄의 변경 이력 항목 형식이 틀리다(\`- v<버전> (<YYYY-MM-DD>): 내용\`)`,
          ),
        );
      }
    }
    if (count === 0) unreadable.push(problem('설계서의 변경 이력에 항목이 없다'));
  }
  if (unreadable.length || !head) return { ok: false, problems: unreadable };
  return {
    ok: true,
    value: { head: { line: headIndex, version: head[1], date: head[2] }, items, end },
  };
}

/** 설계서 본문에서 머리말의 버전·최종 갱신과 변경 이력이 맞는지 본다. 문제가 없으면 빈 배열 */
export function designVersionProblems(text: string): Problem[] {
  const r = readDesignVersion(text);
  if (!r.ok) return r.problems;
  const { head, items } = r.value;
  const out: Problem[] = [];
  const last = items[items.length - 1];
  if (compareVersions(head.version, last.version) !== 0) {
    out.push(
      problem(
        `설계서 머리말의 버전 v${head.version}가 변경 이력의 마지막 항목 v${last.version}와 다르다`,
      ),
    );
  }
  if (head.date !== last.date) {
    out.push(
      problem(
        `설계서 머리말의 최종 갱신 ${head.date}이 변경 이력의 마지막 항목 날짜 ${last.date}와 다르다`,
      ),
    );
  }
  for (let i = 1; i < items.length; i++) {
    if (compareVersions(items[i].version, items[i - 1].version) > 0) continue;
    out.push(
      problem(
        `설계서 ${items[i].line + 1}번째 줄의 v${items[i].version}가 바로 앞 항목 v${items[i - 1].version}보다 크지 않다`,
      ),
    );
  }
  return out;
}
