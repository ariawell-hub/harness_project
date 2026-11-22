// 테스트들이 함께 쓰는 모델: 만든 글을 GitHub 렌더러의 규칙(CommonMark의 코드 스팬·펜스 코드 블록)으로 읽는다.
// 테스트 파일이 아니다. 계획 20261122-session-text-literal step0.

/** 코드 스팬의 안쪽 글자: 안이 공백으로 시작하고 끝나면(공백뿐이 아니면) 하나씩 뗀다 */
const inner = (t: string) =>
  t.startsWith(' ') && t.endsWith(' ') && t.trim() ? t.slice(1, -1) : t;

/**
 * 한 줄을 코드 스팬과 그 밖의 글로 나눈다. 백틱은 이어진 묶음으로 읽는다: 여는 묶음과 길이가 같은 다음 묶음에서 닫히고,
 * 닫히지 않은 묶음은 글자다
 */
export function codeSpans(line: string): { spans: string[]; outside: string } {
  const spans: string[] = [];
  let outside = '';
  let i = 0;
  while (i < line.length) {
    const open = /^`+/.exec(line.slice(i))?.[0];
    if (!open) {
      outside += line[i];
      i++;
      continue;
    }
    const rest = line.slice(i + open.length);
    const close = [...rest.matchAll(/`+/g)].find((r) => r[0].length === open.length);
    if (!close) {
      outside += open;
      i += open.length;
      continue;
    }
    spans.push(inner(rest.slice(0, close.index)));
    i += open.length + close.index + open.length;
  }
  return { spans, outside };
}

/** 글 전체가 코드 스팬 하나면 그 안쪽 글자, 아니면 null */
export function spanText(md: string): string | null {
  const { spans, outside } = codeSpans(md);
  return spans.length === 1 && outside === '' ? spans[0] : null;
}

export interface Fenced {
  /** 블록을 연 줄의 번호(0부터) */
  open: number;
  /** 블록을 닫은 줄의 번호. 닫히지 않았으면 -1 */
  close: number;
  /** 블록 안의 줄들을 `\n`으로 이은 글 */
  text: string;
}

/**
 * 펜스 코드 블록을 읽는다. 줄은 `\r\n`·`\n`·`\r`에서 나눈다. 들여쓰기 0~3칸 뒤의 백틱 셋 이상(그 줄의 뒤쪽에 백틱이 없다)이나
 * `~` 셋 이상이 블록을 열고, 같은 글자가 같거나 더 길게 이어지고 뒤가 공백뿐인 줄이 닫는다
 */
export function fencedBlocks(md: string): { lines: string[]; blocks: Fenced[] } {
  const lines = md.split(/\r\n|\n|\r/);
  const blocks: Fenced[] = [];
  let cur: { open: number; ch: string; len: number; body: string[] } | null = null;
  for (const [i, line] of lines.entries()) {
    if (cur) {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === cur.ch && m[1].length >= cur.len) {
        blocks.push({ open: cur.open, close: i, text: cur.body.join('\n') });
        cur = null;
      } else cur.body.push(line);
      continue;
    }
    const m = /^ {0,3}(`{3,})[^`]*$/.exec(line) ?? /^ {0,3}(~{3,})/.exec(line);
    if (m) cur = { open: i, ch: m[1][0], len: m[1].length, body: [] };
  }
  if (cur) blocks.push({ open: cur.open, close: -1, text: cur.body.join('\n') });
  return { lines, blocks };
}
