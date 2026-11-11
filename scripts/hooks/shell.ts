// 셸 명령 문자열을 단순 명령 목록으로 분해한다(L1 훅용 휴리스틱).
// 복합 연산자, 따옴표, $(...)·백틱, heredoc, `bash -c`·`eval` 재귀, env/sudo 같은 접두어를 처리한다.
// Windows 네이티브의 PowerShell·cmd 방언과 `powershell -Command`·`-EncodedCommand`·`cmd /c` 재귀도 다룬다(ADR-0005).
// 완벽한 셸 파서가 아니다. L1은 빠른 피드백이며, 보장은 권한·L3가 한다(13.2절). R20만 예외다.

export type Dialect = 'posix' | 'powershell' | 'cmd';

/** 방언별 이스케이프 문자: POSIX `\`, PowerShell 백틱, cmd `^` */
const ESCAPE: Record<Dialect, string> = { posix: '\\', powershell: '`', cmd: '^' };

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
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const MAX_DEPTH = 6;

interface Token {
  kind: 'word' | 'op';
  value: string;
}

/** 단어·연산자 토큰화. 치환($(...)·백틱)의 내용은 subs로 따로 모은다 */
function tokenize(src: string, subs: string[], dialect: Dialect): Token[] {
  const posix = dialect === 'posix';
  const esc = ESCAPE[dialect];
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
    if (c === esc && i + 1 < src.length) {
      // 줄 잇기(이스케이프 + 줄바꿈)
      if (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n')) {
        i += src[i + 1] === '\r' ? 3 : 2;
        continue;
      }
      word += src[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    // PowerShell 블록 주석 <# … #>
    if (dialect === 'powershell' && c === '<' && src[i + 1] === '#') {
      push();
      const end = src.indexOf('#>', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    // cmd에서 작은따옴표는 따옴표가 아니다
    if (c === "'" && dialect !== 'cmd') {
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
        if (posix && src[j] === '\\' && j + 1 < src.length && '"\\$`\n'.includes(src[j + 1])) {
          buf += src[j + 1];
          j += 2;
          continue;
        }
        if (dialect === 'powershell' && src[j] === '`' && j + 1 < src.length) {
          buf += src[j + 1];
          j += 2;
          continue;
        }
        if (dialect !== 'cmd' && src[j] === '$' && src[j + 1] === '(') {
          const [inner, next] = readParen(src, j + 2);
          subs.push(inner);
          buf += '$(…)';
          j = next;
          continue;
        }
        if (posix && src[j] === '`') {
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
    if (dialect !== 'cmd' && c === '$' && src[i + 1] === '(') {
      const [inner, next] = readParen(src, i + 2);
      subs.push(inner);
      word += '$(…)';
      inWord = true;
      i = next;
      continue;
    }
    if (posix && c === '`') {
      const end = src.indexOf('`', i + 1);
      const stop = end < 0 ? src.length : end;
      subs.push(src.slice(i + 1, stop));
      word += '`…`';
      inWord = true;
      i = stop + 1;
      continue;
    }
    if (c === '#' && !inWord && dialect !== 'cmd') {
      // 주석: 줄 끝까지
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (posix && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
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

/** PowerShell 실행 파일 옵션 가운데 값을 받는 것(-ExecutionPolicy Bypass 등). 소문자, 접두 약어 포함 */
const PS_VALUE_OPTS = new Set([
  'executionpolicy',
  'ex',
  'ep',
  'windowstyle',
  'w',
  'version',
  'v',
  'psconsolefile',
  'configurationname',
  'outputformat',
  'o',
  'of',
  'inputformat',
  'if',
  'inf',
  'workingdirectory',
  'wd',
  'custompipename',
  'settingsfile',
  'encodedarguments',
  'ea',
]);

/** `powershell`·`pwsh` 인자에서 실행할 스크립트를 꺼낸다. -File이면 내용을 볼 수 없으므로 null */
function powershellScript(args: string[]): string | null {
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (!/^[-/]/.test(a)) return args.slice(k).join(' ');
    const name = a.replace(/^[-/]+/, '').toLowerCase();
    if (!name) continue;
    if (
      (name[0] === 'c' && 'command'.startsWith(name)) ||
      name === 'cwa' ||
      name.startsWith('commandwith')
    )
      return args.slice(k + 1).join(' ');
    if (name === 'e' || name === 'ec' || (name.length >= 3 && 'encodedcommand'.startsWith(name))) {
      const b64 = args[k + 1];
      return b64 === undefined ? null : Buffer.from(b64, 'base64').toString('utf16le');
    }
    if (name[0] === 'f' && 'file'.startsWith(name)) return null;
    if (PS_VALUE_OPTS.has(name)) k++;
  }
  return null;
}

function normalize(words: string[], out: SimpleCommand[], depth: number, dialect: Dialect): void {
  const assigns: Record<string, string> = {};
  const unsets: string[] = [];
  let i = 0;
  // 앞의 할당과 래퍼를 벗긴다
  for (;;) {
    const raw = words[i];
    if (raw === undefined) break;
    const m = ASSIGN_RE.exec(raw);
    if (m) {
      assigns[m[1]] = m[2];
      i++;
      continue;
    }
    const w = commandName(raw);
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
  const head = commandName(argv[0]);
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
  // 재귀: bash -c "...", eval ..., powershell -Command ..., cmd /c ..., iex ...
  if (SHELLS.has(head)) {
    for (let k = 1; k < argv.length; k++) {
      const x = argv[k];
      if (x === '-c' || (/^-[a-z]+$/.test(x) && x.includes('c'))) {
        if (argv[k + 1] !== undefined) parseInto(argv[k + 1], out, depth + 1, 'posix');
        break;
      }
    }
  } else if (head === 'eval') {
    parseInto(argv.slice(1).join(' '), out, depth + 1, dialect);
  } else if (POWERSHELLS.has(head)) {
    const script = powershellScript(argv.slice(1));
    if (script !== null) parseInto(script, out, depth + 1, 'powershell');
  } else if (head === 'cmd') {
    const k = argv.findIndex((x, idx) => idx > 0 && /^\/[ck]$/i.test(x));
    if (k > 0) parseInto(argv.slice(k + 1).join(' '), out, depth + 1, 'cmd');
  } else if (head === 'iex' || head === 'invoke-expression') {
    const rest = argv.slice(1).filter((x) => !/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(x));
    parseInto(rest.join(' '), out, depth + 1, 'powershell');
  }
}

function parseInto(src: string, out: SimpleCommand[], depth: number, dialect: Dialect): void {
  const subs: string[] = [];
  const tokens = tokenize(src, subs, dialect);
  let cur: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'op') {
      if (cur.length) normalize(cur, out, depth, dialect);
      cur = [];
    } else cur.push(t.value);
  }
  if (cur.length) normalize(cur, out, depth, dialect);
  if (depth < MAX_DEPTH) for (const s of subs) parseInto(s, out, depth + 1, dialect);
}

export function parseShell(src: string, dialect: Dialect = 'posix'): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  parseInto(src, out, 0, dialect);
  return out;
}

export function baseName(cmd: string): string {
  const parts = cmd.split(/[\\/]/);
  return parts[parts.length - 1];
}

/**
 * 명령 이름 비교용: 경로를 떼고 소문자로 바꾸고 실행 확장자(.exe·.cmd·.bat·.com)를 뗀다.
 * Windows와 macOS 기본 파일 시스템은 대소문자를 구분하지 않아 `GIT`, `git.exe`도 git으로 실행된다.
 */
export function commandName(cmd: string): string {
  return baseName(cmd)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, '');
}
