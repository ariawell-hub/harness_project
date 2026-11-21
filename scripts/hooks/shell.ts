// 셸 명령 문자열을 단순 명령 목록으로 분해한다(L1 훅용 휴리스틱).
// 복합 연산자, 따옴표, $(...)·백틱, heredoc, `bash -c`·`eval` 재귀, env/sudo 같은 접두어를 처리한다.
// Windows 네이티브의 PowerShell·cmd 방언과 `powershell -Command`·`-EncodedCommand`·`cmd /c` 재귀도 다룬다(ADR-0005).
// 완벽한 셸 파서가 아니다. L1은 빠른 피드백이며, 보장은 권한·L3가 한다(13.2절). R20만 예외다.

export type Dialect = 'posix' | 'powershell' | 'cmd';

/** 방언별 이스케이프 문자: POSIX `\`, PowerShell 백틱, cmd `^` */
const ESCAPE: Record<Dialect, string> = { posix: '\\', powershell: '`', cmd: '^' };

export interface SimpleCommand {
  /** 낱말을 그대로 담는다. 리다이렉션(`>`, `out.txt`, `2>&1`)도 낱말로 들어 있다(명령의 글을 보는 규칙이 쓴다) */
  argv: string[];
  /**
   * 셸이 명령에 넘기는 인자: argv에서 리다이렉션의 연산자와 대상을 뺀 것. 인자의 자리를 보는 규칙이 쓴다.
   * 리다이렉션이 없으면 두지 않는다(argv와 같다). 따옴표로 묶거나 이스케이프한 `>`·`<`는 인자이므로 남는다
   */
  args?: string[];
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

/** 낱말에 든 리다이렉션(따옴표·이스케이프 밖의 `>`·`<`) */
interface Redir {
  /** 연산자 앞에 붙은 인자(`sub>out`의 `sub`). 없거나 파일 디스크립터 번호(`2>`)면 null */
  arg: string | null;
  /** 낱말이 연산자로 끝난다: 대상은 다음 낱말이다(`> out`) */
  needsTarget: boolean;
}

interface Token {
  kind: 'word' | 'op';
  value: string;
  redir?: Redir;
}

/** 낱말 목록에서 리다이렉션을 뺀다. 리다이렉션이 없으면 undefined */
function shellArgs(words: string[], redirs: (Redir | undefined)[]): string[] | undefined {
  if (!redirs.some((r) => r !== undefined)) return undefined;
  const out: string[] = [];
  let target = false;
  for (let k = 0; k < words.length; k++) {
    const r = redirs[k];
    if (target) {
      // 앞 연산자의 대상이다. 대상에 연산자가 붙어 있으면(`> a>`) 그 연산자의 대상이 또 이어진다
      target = r?.needsTarget ?? false;
      continue;
    }
    if (!r) {
      out.push(words[k]);
      continue;
    }
    if (r.arg !== null) out.push(r.arg);
    target = r.needsTarget;
  }
  return out;
}

/** 단어·연산자 토큰화. 치환($(...)·백틱)의 내용은 subs로 따로 모은다 */
function tokenize(src: string, subs: string[], dialect: Dialect): Token[] {
  const posix = dialect === 'posix';
  const esc = ESCAPE[dialect];
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  /** 이 낱말에서 따옴표 밖의 첫 리다이렉션 연산자가 시작한 자리(없으면 -1)와, 마지막 연산자 글자 바로 뒤의 자리 */
  let redirAt = -1;
  let redirEnd = -1;
  /** 따옴표·이스케이프 밖의 리다이렉션 연산자 글자를 낱말에 더한다 */
  const redirOp = (ch: string) => {
    if (redirAt < 0) redirAt = word.length;
    word += ch;
    redirEnd = word.length;
    inWord = true;
  };
  const push = () => {
    if (inWord) {
      const t: Token = { kind: 'word', value: word };
      if (redirAt >= 0) {
        const pre = word.slice(0, redirAt);
        // 연산자 바로 앞의 숫자는 파일 디스크립터다(`2>`). PowerShell의 `*>`는 모든 스트림이다
        const fd = /^\d+$/.test(pre) || (dialect === 'powershell' && pre === '*');
        t.redir = { arg: pre !== '' && !fd ? pre : null, needsTarget: redirEnd === word.length };
      }
      tokens.push(t);
    }
    word = '';
    inWord = false;
    redirAt = -1;
    redirEnd = -1;
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
    // here-string(`<<< 낱말`)은 heredoc이 아니다: 연산자 하나로 읽는다(대상은 뒤의 낱말)
    if (posix && c === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
      redirOp('<');
      redirOp('<');
      redirOp('<');
      i += 3;
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
        // `&>`의 시작이거나 연산자 글자 바로 뒤(`>&`)면 리다이렉션 연산자의 글자다
        if (src[i + 1] === '>' || (redirAt >= 0 && redirEnd === word.length)) redirOp(c);
        else {
          word += c;
          inWord = true;
        }
        i++;
        continue;
      }
      // `>|`(noclobber를 무시하는 출력)는 파이프가 아니다
      if (posix && c === '|' && redirAt >= 0 && redirEnd === word.length && word.endsWith('>')) {
        redirOp(c);
        i++;
        continue;
      }
      push();
      tokens.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      redirOp(c);
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

function normalize(
  words: string[],
  out: SimpleCommand[],
  depth: number,
  dialect: Dialect,
  redirs?: (Redir | undefined)[],
): void {
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
  const args = redirs ? shellArgs(argv, redirs.slice(i)) : undefined;
  /** argv와, 리다이렉션이 있을 때만 args */
  const base = args ? { argv, args } : { argv };
  const head = commandName(argv[0]);
  if (head === 'unset') {
    out.push({
      ...base,
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
    out.push({ ...base, assigns: a, unsets });
    return;
  }
  out.push({ ...base, assigns, unsets });
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
  let curRedirs: (Redir | undefined)[] = [];
  for (const t of tokens) {
    if (t.kind === 'op') {
      if (cur.length) normalize(cur, out, depth, dialect, curRedirs);
      cur = [];
      curRedirs = [];
    } else {
      cur.push(t.value);
      curRedirs.push(t.redir);
    }
  }
  if (cur.length) normalize(cur, out, depth, dialect, curRedirs);
  if (depth < MAX_DEPTH) for (const s of subs) parseInto(s, out, depth + 1, dialect);
}

export function parseShell(src: string, dialect: Dialect = 'posix'): SimpleCommand[] {
  const out: SimpleCommand[] = [];
  parseInto(src, out, 0, dialect);
  return out;
}

export interface SequencedCommand {
  cmd: SimpleCommand;
  /** 이 명령 바로 뒤의 연산자(`&&`, `||`, `;`, `|`, `|&`, `&`). 줄바꿈은 `;`, 마지막 명령은 null */
  next: string | null;
}

const GROUP_OPS = new Set(['(', ')', '{', '}']);

/**
 * 최상위 명령을 순서대로, 그 뒤 연산자와 함께 돌려준다(검사 순서 규칙용).
 * `parseShell`과 달리 치환·`bash -c` 안으로 들어가지 않는다. 묶음 괄호는 연산자로 세지 않는다.
 */
export function parseSequence(src: string, dialect: Dialect = 'posix'): SequencedCommand[] {
  const out: SequencedCommand[] = [];
  let cur: string[] = [];
  const flush = (op: string | null) => {
    if (cur.length) {
      const one: SimpleCommand[] = [];
      normalize(cur, one, MAX_DEPTH, dialect);
      if (one.length) out.push({ cmd: one[0], next: op });
    }
    cur = [];
  };
  // 묶음을 닫기 직전의 `;`(예: `{ a; } && b`)는 묶음 뒤 연산자로 바꿔 읽는다
  let semiJustNow = false;
  for (const t of tokenize(src, [], dialect)) {
    if (t.kind !== 'op') {
      cur.push(t.value);
      semiJustNow = false;
      continue;
    }
    const op = t.value === ';;' ? ';' : t.value;
    const group = GROUP_OPS.has(op);
    const last = out[out.length - 1];
    if (cur.length) flush(group ? null : op);
    else if (group) {
      if ((op === ')' || op === '}') && semiJustNow && last) last.next = null;
    } else if (last && last.next === null) last.next = op;
    semiJustNow = op === ';';
  }
  flush(null);
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
