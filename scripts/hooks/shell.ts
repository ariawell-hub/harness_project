// 셸 명령 문자열을 단순 명령 목록으로 분해한다(L1 훅용 휴리스틱).
// 복합 연산자, 따옴표, $(...)·백틱, heredoc, `bash -c`·`eval` 재귀, env/sudo 같은 접두어를 처리한다.
// 완벽한 셸 파서가 아니다. L1은 빠른 피드백이며, 보장은 권한·L3가 한다(13.2절). R20만 예외다.

export interface SimpleCommand {
  argv: string[];
  /** 명령 앞에 붙은 VAR=값 할당과 env VAR=값 */
  assigns: Record<string, string>;
  /** env -u NAME, unset NAME */
  unsets: string[];
}

const WRAPPERS = new Set([
  'sudo',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'nice',
  'ionice',
  'doas',
]);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const MAX_DEPTH = 6;

interface Token {
  kind: 'word' | 'op';
  value: string;
}

/** 단어·연산자 토큰화. 치환($(...)·백틱)의 내용은 subs로 따로 모은다 */
function tokenize(src: string, subs: string[]): Token[] {
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  const push = () => {
    if (inWord) tokens.push({ kind: 'word', value: word });
    word = '';
    inWord = false;
  };
  const heredocs: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // heredoc 본문 건너뛰기: 줄바꿈을 만나면 대기 중인 구분자까지 소비
    if (c === '\n' && heredocs.length) {
      push();
      tokens.push({ kind: 'op', value: ';' });
      let j = i + 1;
      while (heredocs.length && j <= src.length) {
        const end = src.indexOf('\n', j);
        const line = src.slice(j, end < 0 ? src.length : end);
        j = end < 0 ? src.length + 1 : end + 1;
        if (line.replace(/^\t+/, '').trim() === heredocs[0]) heredocs.shift();
      }
      heredocs.length = 0;
      i = j;
      continue;
    }
    if (c === '\\' && i + 1 < src.length) {
      if (src[i + 1] === '\n') {
        i += 2;
        continue;
      }
      word += src[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end < 0 ? src.length : end;
      word += src.slice(i + 1, stop);
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length && '"\\$`\n'.includes(src[j + 1])) {
          buf += src[j + 1];
          j += 2;
          continue;
        }
        if (src[j] === '$' && src[j + 1] === '(') {
          const [inner, next] = readParen(src, j + 2);
          subs.push(inner);
          buf += '$(…)';
          j = next;
          continue;
        }
        if (src[j] === '`') {
          const end = src.indexOf('`', j + 1);
          const stop = end < 0 ? src.length : end;
          subs.push(src.slice(j + 1, stop));
          buf += '`…`';
          j = stop + 1;
          continue;
        }
        buf += src[j];
        j++;
      }
      word += buf;
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      const [inner, next] = readParen(src, i + 2);
      subs.push(inner);
      word += '$(…)';
      inWord = true;
      i = next;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      const stop = end < 0 ? src.length : end;
      subs.push(src.slice(i + 1, stop));
      word += '`…`';
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '#' && !inWord) {
      // 주석: 줄 끝까지
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      push();
      let j = i + 2;
      if (src[j] === '-') j++;
      while (src[j] === ' ' || src[j] === '\t') j++;
      let delim = '';
      while (j < src.length && !/[\s;&|<>()]/.test(src[j])) {
        if (src[j] !== "'" && src[j] !== '"' && src[j] !== '\\') delim += src[j];
        j++;
      }
      if (delim) heredocs.push(delim);
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      push();
      if (c === '\n') tokens.push({ kind: 'op', value: ';' });
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === ';;' || two === '|&') {
      push();
      tokens.push({ kind: 'op', value: two });
      i += 2;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}') {
      // `{`, `}`는 단어 중간이면 그대로 둔다(예: ${HOME}, a{b,c})
      if ((c === '{' || c === '}') && inWord) {
        word += c;
        i++;
        continue;
      }
      if (c === '&' && (src[i - 1] === '>' || src[i + 1] === '>')) {
        word += c;
        inWord = true;
        i++;
        continue;
      }
      push();
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    word += c;
    inWord = true;
    i++;
  }
  push();
  return tokens;
}

/** `$(`의 짝이 되는 `)`까지 읽는다. [내용, 다음 위치] */
function readParen(src: string, start: number): [string, number] {
  let depth = 1;
  let j = start;
  let q: string | null = null;
  while (j < src.length) {
    const ch = src[j];
    if (q) {
      if (ch === '\\' && q === '"') j++;
      else if (ch === q) q = null;
    } else if (ch === "'" || ch === '"') q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return [src.slice(start, j), j + 1];
    }
    j++;
  }
  return [src.slice(start), src.length];
}

const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

function normalize(words: string[], out: SimpleCommand[], depth: number): void {
  const assigns: Record<string, string> = {};
  const unsets: string[] = [];
  let i = 0;
  // 앞의 할당과 래퍼를 벗긴다
  for (;;) {
    const w = words[i];
    if (w === undefined) break;
    const m = ASSIGN_RE.exec(w);
    if (m) {
      assigns[m[1]] = m[2];
      i++;
      continue;
    }
    if (w === 'env') {
      i++;
      while (i < words.length) {
        const x = words[i];
        if (x === '-u' || x === '--unset') {
          if (words[i + 1]) unsets.push(words[i + 1]);
          i += 2;
        } else if (x.startsWith('--unset=')) {
          unsets.push(x.slice(8));
          i++;
        } else if (x.startsWith('-u') && x.length > 2) {
          unsets.push(x.slice(2));
          i++;
        } else if (x.startsWith('-')) i++;
        else if (ASSIGN_RE.test(x)) {
          const mm = ASSIGN_RE.exec(x)!;
          assigns[mm[1]] = mm[2];
          i++;
        } else break;
      }
      continue;
    }
    if (WRAPPERS.has(w)) {
      i++;
      while (i < words.length && words[i].startsWith('-')) i++;
      continue;
    }
    if (w === 'timeout') {
      i++;
      while (i < words.length && words[i].startsWith('-')) i++;
      i++; // 시간 인자
      continue;
    }
    if (w === 'xargs') {
      i++;
      while (i < words.length && words[i].startsWith('-')) {
        // 값을 받는 옵션
        if (['-I', '-n', '-P', '-L', '-d', '-E', '-s'].includes(words[i])) i++;
        i++;
      }
      continue;
    }
    break;
  }
  const argv = words.slice(i);
  if (argv.length === 0) {
    if (Object.keys(assigns).length) out.push({ argv: [], assigns, unsets });
    return;
  }
  const head = baseName(argv[0]);
  if (head === 'unset') {
    out.push({
      argv,
      assigns,
      unsets: [...unsets, ...argv.slice(1).filter((a) => !a.startsWith('-'))],
    });
    return;
  }
  if (
    head === 'export' ||
    head === 'declare' ||
    head === 'typeset' ||
    head === 'local' ||
    head === 'readonly'
  ) {
    const a: Record<string, string> = { ...assigns };
    for (const x of argv.slice(1)) {
      const mm = ASSIGN_RE.exec(x);
      if (mm) a[mm[1]] = mm[2];
    }
    out.push({ argv, assigns: a, unsets });
    return;
  }
  out.push({ argv, assigns, unsets });
  if (depth >= MAX_DEPTH) return;
  // 재귀: bash -c "...", eval ...
  if (SHELLS.has(head)) {
    for (let k = 1; k < argv.length; k++) {
      const x = argv[k];
      if (x === '-c' || (/^-[a-z]+$/.test(x) && x.includes('c'))) {
        if (argv[k + 1] !== undefined) parseInto(argv[k + 1], out, depth + 1);
        break;
      }
    }
  } else if (head === 'eval') {
    parseInto(argv.slice(1).join(' '), out, depth + 1);
  }
}

function parseInto(src: string, out: SimpleCommand[], depth: number): void {
  const subs: string[] = [];
  const tokens = tokenize(src, subs);
  let cur: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'op') {
      if (cur.length) normalize(cur, out, depth);
      cur = [];
    } else cur.push(t.value);
  }
  if (cur.length) normalize(cur, out, depth);
  if (depth < MAX_DEPTH) for (const s of subs) parseInto(s, out, depth + 1);
}

export function parseShell(src: string): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  parseInto(src, out, 0);
  return out;
}

export function baseName(cmd: string): string {
  const parts = cmd.split(/[\\/]/);
  return parts[parts.length - 1];
}
