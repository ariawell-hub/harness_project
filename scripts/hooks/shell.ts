// 셸 명령 문자열을 단순 명령 목록으로 분해한다(L1 훅용 휴리스틱).
// 복합 연산자, 따옴표, $(...)·백틱, heredoc, `bash -c`·`eval` 재귀, env/sudo 같은 접두어를 처리한다.
// Windows 네이티브의 PowerShell·cmd 방언과 `powershell -Command`·`-EncodedCommand`·`cmd /c` 재귀도 다룬다(ADR-0005).
// 완벽한 셸 파서가 아니다. L1은 빠른 피드백이며, 보장은 권한·L3가 한다(13.2절). R20만 예외다.

export type Dialect = 'posix' | 'powershell' | 'cmd';

/** 방언별 이스케이프 문자: POSIX `\`, PowerShell 백틱, cmd `^` */
const ESCAPE: Record<Dialect, string> = { posix: '\\', powershell: '`', cmd: '^' };

export interface SimpleCommand {
  /**
   * 첫 낱말이 명령 이름이다. 앞의 할당·래퍼·예약어는 벗기고, 명령 이름 앞의 리다이렉션은 끝으로 옮기고, 이름에 붙은
   * 리다이렉션(`git>out`)은 이름 바로 뒤에 따로 둔다. 그 밖의 낱말은 그대로 담는다: 인자 사이의 리다이렉션(`>`, `out.txt`,
   * `2>&1`)도 그 자리에 낱말로 들어 있다(명령의 글과 대상 파일을 보는 규칙이 쓴다). 명령 이름이 없는 명령(리다이렉션뿐)은
   * 리다이렉션 낱말만 담는다
   */
  argv: string[];
  /**
   * 셸이 명령에 넘기는 인자: argv에서 리다이렉션의 연산자와 대상을 뺀 것. 인자의 자리를 보는 규칙이 쓴다.
   * 따옴표로 묶거나 이스케이프한 `>`·`<`는 인자이므로 남는다. 인자 자리의 `{`·`}`에서 명령이 나뉘면 첫 조각의 args에
   * bash가 넘기는 나머지 인자를 붙인다(argv와 명령의 수는 그대로다). argv와 같으면 두지 않는다
   */
  args?: string[];
  /**
   * 낱말에 붙은 리다이렉션의 대상(`<in.txt`의 `in.txt`, `2>err.log`의 `err.log`). 파일 이름을 보는 규칙이 쓴다.
   * 띄어 쓴 대상(`< in.txt`)은 argv의 낱말로 들어 있다. 없으면 두지 않는다
   */
  targets?: string[];
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
/**
 * 명령 앞에 서는 낱말(POSIX 방언): 뒤에 명령이 이어지는 bash의 예약어와 zsh의 명령 앞 수식어. `time`은 WRAPPERS에 있다.
 * 따옴표로 묶었거나 할당 뒤에 온 것은 셸에서 예약어가 아니지만(없는 명령으로 실패한다) 구별하지 않고 벗긴다. 벗기는 쪽이 막는 쪽이다
 */
const BEFORE_COMMAND = new Set([
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  'coproc',
  'noglob',
  'nocorrect',
  '-',
]);
/** 그 가운데 제어문의 낱말: 뒤의 명령이 조건·반복 안에 있다 */
const CONTROL = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish']);
const POWERSHELLS = new Set(['powershell', 'pwsh']);
const MAX_DEPTH = 6;

/** 낱말에 든 리다이렉션(따옴표·이스케이프 밖의 `>`·`<`) */
interface Redir {
  /** 연산자 앞에 붙은 인자(`sub>out`의 `sub`). 없거나 파일 디스크립터 번호(`2>`)면 null */
  arg: string | null;
  /** 낱말이 연산자로 끝난다: 대상은 다음 낱말이다(`> out`) */
  needsTarget: boolean;
  /** 연산자 앞의 글 그대로(파일 디스크립터여도 담는다). 앞에 중괄호가 붙으면 디스크립터가 아니라 인자다(`{2>out`) */
  pre: string;
  /**
   * 이 낱말에 붙은 대상(`<a>b`의 a와 b). 토큰화가 따옴표 밖의 연산자가 끝난 자리부터 다음 연산자까지를 하나씩 낸다.
   * 따옴표·이스케이프 안의 `<`·`>`는 대상의 글자다(`<'a>b'`의 대상은 `a>b` 하나). here-string(`<<<글`)의 글은 파일이 아니라 넣지 않는다
   */
  targets?: string[];
}

interface Token {
  kind: 'word' | 'op';
  value: string;
  redir?: Redir;
  /** 이 낱말에 따옴표·이스케이프·치환으로 들어온 글이 있다(`"[["`는 예약어가 아니다) */
  quoted?: boolean;
  /** 연산자 `{`·`}` 바로 뒤에 공백 없이 낱말이 이어진다: bash에서는 그 낱말의 앞 글자다(`{a`, `}a`) */
  glue?: boolean;
}

/** bash가 넘기는 인자 가운데 이 조각 뒤에 이어지는 것(인자 자리의 `{`·`}`에서 나뉜 나머지) */
interface Tail {
  words: string[];
  redirs: (Redir | undefined)[];
  /** 이어지는 인자가 끝나는 토큰의 자리 */
  end: number;
}

/** 뒤에 오는 `{`가 묶음 괄호인 예약어(명령의 첫 낱말일 때) */
const BEFORE_GROUP = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '!', 'time']);

/**
 * 토큰 k의 `{`·`}`가 인자 자리에 있을 때, 거기서부터 진짜 구분자 앞까지를 bash가 읽는 낱말로 모은다.
 * 공백 없이 붙은 중괄호는 다음 낱말의 앞 글자다(`{a`, `}}`)
 */
function braceTail(tokens: Token[], k: number): Tail {
  const words: string[] = [];
  const redirs: (Redir | undefined)[] = [];
  let pending = '';
  let j = k;
  for (; j < tokens.length; j++) {
    const tk = tokens[j];
    if (tk.kind === 'op') {
      if (tk.value !== '{' && tk.value !== '}') break;
      if (tk.glue) pending += tk.value;
      else {
        words.push(pending + tk.value);
        redirs.push(undefined);
        pending = '';
      }
      continue;
    }
    words.push(pending + tk.value);
    redirs.push(
      tk.redir && pending
        ? {
            arg: pending + tk.redir.pre,
            needsTarget: tk.redir.needsTarget,
            pre: pending + tk.redir.pre,
            targets: tk.redir.targets,
          }
        : tk.redir,
    );
    pending = '';
  }
  if (pending) {
    words.push(pending);
    redirs.push(undefined);
  }
  return { words, redirs, end: j };
}

/**
 * 리다이렉션 연산자(`<`·`>`로 시작하는 것과 heredoc) 바로 앞에 붙은, 따옴표 밖의 글이 파일 디스크립터 번호인가.
 * 일반 리다이렉션과 heredoc이 같은 판별을 쓴다. 숫자(`2>`)와 PowerShell의 `*>`(모든 스트림).
 * bash의 디스크립터 변수(`{이름}>`)는 낱말을 읽을 때 낱말을 읽는 반복문이 따로 가린다
 */
function isFdPrefix(pre: string, dialect: Dialect): boolean {
  return /^\d+$/.test(pre) || (dialect === 'powershell' && pre === '*');
}

/** 낱말을 끝내는 글자(따옴표 밖): 공백과 셸의 연산자 글자 */
const isWordEnd = (ch: string): boolean => /\s/.test(ch) || ';&|()<>'.includes(ch);

/**
 * 자리 j에서 시작하는 "통째로 건너뛸 조각"의 다음 자리. 조각이 아니면 -1. 닫히지 않았으면 입력의 끝.
 * 조각: 이스케이프한 글자, 따옴표로 묶은 글, `$(…)`, `${…}`, 백틱. 그 안의 공백과 연산자 글자는 낱말을 끝내지 않는다
 */
function skipPiece(src: string, j: number): number {
  const ch = src[j];
  if (ch === '\\') return Math.min(j + 2, src.length);
  if (ch === "'" || ch === '`') {
    const end = src.indexOf(ch, j + 1);
    return end < 0 ? src.length : end + 1;
  }
  if (ch === '"') {
    let k = j + 1;
    while (k < src.length && src[k] !== '"') k += src[k] === '\\' ? 2 : 1;
    return Math.min(k + 1, src.length);
  }
  if (ch === '$' && src[j + 1] === '(') return readParen(src, j + 2)[1];
  if (ch === '$' && src[j + 1] === '{') {
    let depth = 0;
    for (let k = j + 1; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return k + 1;
    }
    return src.length;
  }
  return -1;
}

/** bash의 디스크립터 변수(`{이름}>`, `{이름[첨자]}>`)의 시작: `{이름`. 자리를 정해 두고 맞춘다(길이 제한이 없다) */
const FD_VAR_HEAD = /\{[A-Za-z_][A-Za-z0-9_]*/y;

/**
 * 자리 i의 `{`로 시작하는 낱말이 따옴표 밖의 `}`로 끝나는가와, 그 낱말이 끝나는 자리.
 * 그렇게 끝나는 낱말(`{}`, `{x}`, `{$x}`, `{a,{b,c}}`)은 인자다. 묶음 괄호(`{ 명령; }`)와 zsh의 `{명령 인자}`는
 * `{` 뒤에 공백이 있거나 낱말이 `}`로 끝나지 않으므로 여기에 들지 않는다(전처럼 연산자로 읽는다)
 */
function braceWordAt(src: string, i: number): [closed: boolean, end: number] {
  let j = i + 1;
  let closed = false;
  while (j < src.length && !isWordEnd(src[j])) {
    const next = skipPiece(src, j);
    if (next >= 0) {
      j = next;
      closed = false;
      continue;
    }
    closed = src[j] === '}';
    j++;
  }
  return [closed, j];
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
  /** 이 낱말에 따옴표·이스케이프·치환으로 들어온 글이 있는가(빈 따옴표 포함) */
  let wordQuoted = false;
  /** 첫 연산자 앞부분에 그런 글이 있었는가: 있으면 숫자여도 파일 디스크립터가 아니라 인자다(`'2'>out`) */
  let preQuoted = false;
  /** 첫 연산자가 `&`로 시작하는가(`&>`): 이 연산자는 디스크립터 번호를 받지 않아 앞의 글이 인자다(`2&>out`) */
  let redirAmp = false;
  /** 이 낱말의 앞부분이 bash의 디스크립터 변수(`{이름}`, `{이름[첨자]}`)다: 첨자에 따옴표가 있어도 인자가 아니다 */
  let fdVar = false;
  /** 이 자리 앞에서 시작하는 `{`는 중괄호 낱말이 아님을 이미 확인했다(같은 낱말을 `{`마다 다시 읽지 않는다) */
  let braceFailEnd = -1;
  /**
   * `{이름[`으로 시작한 낱말을 디스크립터 변수로 읽어 보는 중이다. 첨자 안의 글(따옴표, 치환, 이스케이프)은 낱말의 다른 곳과
   * 같은 코드가 읽는다. 짝이 맞는 `]` 뒤에 `}`와 `<`·`>`가 오면 디스크립터 변수이고, 그 전에 낱말이 끝나면 아니다.
   * start: `{`의 자리, open: 첨자를 연 `[`의 자리, depth: `[`의 깊이, subs: 시작할 때 모아 둔 치환의 수,
   * pairs: 첨자 안에서 열린 `${…}`·`$[…]`가 기다리는 닫는 글자(bash는 그 안을 공백이 있어도 낱말 하나로 읽는다),
   * dead: 디스크립터 변수가 아님을 알았다(낱말이 끝나는 자리만 마저 찾는다)
   */
  let sub: {
    start: number;
    open: number;
    depth: number;
    subs: number;
    pairs: string[];
    dead: boolean;
  } | null = null;
  /**
   * 이 자리 앞에서는 디스크립터 변수를 찾지 않는다. 읽다 그만둔 낱말은 bash에서도 그 끝까지 낱말 하나이므로(`${…}` 안의 공백 포함)
   * 그 안에서 다시 시도하지 않는다. 그래서 시도한 구간이 겹치지 않고 전체 시간이 입력 길이에 비례한다
   */
  let noSubBefore = 0;
  /**
   * 이 낱말에서 따옴표 밖의 연산자가 이어진 구간들: [시작, 끝, 시작, 끝, …](낱말 안의 자리). 대상은 구간의 끝부터 다음 구간의 시작까지다.
   * 따옴표를 벗긴 낱말을 `<`·`>`로 다시 나누지 않으려고 읽으면서 적는다(따옴표 안의 `>`는 파일 이름의 글자다)
   */
  let runs: number[] = [];
  /** here-string(`<<<`) 연산자의 구간이 runs에서 시작하는 자리(커지는 차례, 겹치지 않는다). 그 뒤의 글은 파일이 아니다 */
  let hereRuns: number[] = [];
  /** 따옴표·이스케이프 밖의 리다이렉션 연산자 글자를 낱말에 더한다 */
  const redirOp = (ch: string) => {
    if (redirAt < 0) {
      redirAt = word.length;
      preQuoted = wordQuoted;
      redirAmp = ch === '&';
    }
    if (runs.length && redirEnd === word.length) runs[runs.length - 1] = word.length + 1;
    else runs.push(word.length, word.length + 1);
    word += ch;
    redirEnd = word.length;
    inWord = true;
  };
  const push = () => {
    if (inWord) {
      const t: Token = { kind: 'word', value: word };
      if (wordQuoted) t.quoted = true;
      if (redirAt >= 0) {
        const pre = word.slice(0, redirAt);
        // 연산자 바로 앞의, 따옴표 밖의 글이 파일 디스크립터면 인자가 아니다(`2>`, `{이름}>`)
        const fd = fdVar || (!preQuoted && !redirAmp && isFdPrefix(pre, dialect));
        // 따옴표로 묶은 앞부분은 빈 글이어도 인자다(`''>out`)
        const arg = fd ? null : preQuoted || pre !== '' ? pre : null;
        t.redir = { arg, needsTarget: redirEnd === word.length, pre };
        const targets: string[] = [];
        // hereRuns는 커지는 차례로 적혀 있다: 구간과 함께 한 번에 지나간다(구간마다 목록을 다시 찾지 않는다)
        let h = 0;
        for (let k = 0; k < runs.length; k += 2) {
          if (hereRuns[h] === k) {
            h++;
            continue;
          }
          const piece = word.slice(runs[k + 1], runs[k + 2] ?? word.length);
          if (piece) targets.push(piece);
        }
        if (targets.length) t.redir.targets = targets;
      }
      tokens.push(t);
    }
    word = '';
    inWord = false;
    runs = [];
    hereRuns = [];
    redirAt = -1;
    redirEnd = -1;
    wordQuoted = false;
    preQuoted = false;
    redirAmp = false;
    fdVar = false;
  };
  const heredocs: string[] = [];
  let i = 0;
  /** 디스크립터 변수가 아니었다: 읽은 것을 버리고 `{`의 자리로 돌아가 전처럼 읽는다(그사이 모은 치환도 버린다) */
  const giveUpSub = (s: { start: number; subs: number }, end: number) => {
    subs.length = s.subs;
    noSubBefore = Math.max(end, s.start + 1);
    i = s.start;
    sub = null;
    word = '';
    inWord = false;
    wordQuoted = false;
  };
  while (i < src.length || sub) {
    if (sub) {
      const ch = src[i];
      if (ch === undefined) {
        giveUpSub(sub, i);
        continue;
      }
      if (ch === '$' && (src[i + 1] === '{' || src[i + 1] === '[')) {
        // `${…}`·`$[…]`: 닫는 글자까지 낱말이 이어진다
        sub.pairs.push(src[i + 1] === '{' ? '}' : ']');
        word += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      const closer = sub.pairs[sub.pairs.length - 1];
      if (closer !== undefined) {
        // 그 안의 공백과 연산자 글자는 낱말을 끝내지 않는다. 따옴표·이스케이프·치환·보통 글자는 아래의 낱말 읽기가 읽는다
        if (ch === closer || (closer === ']' && ch === '[') || isWordEnd(ch)) {
          if (ch === closer) sub.pairs.pop();
          else if (ch === '[') sub.pairs.push(']');
          word += ch;
          i++;
          continue;
        }
      } else if (isWordEnd(ch)) {
        giveUpSub(sub, i);
        continue;
      } else if (!sub.dead) {
        if (ch === '[') sub.depth++;
        else if (ch === ']' && --sub.depth === 0) {
          // 첨자는 비어 있으면 안 되고, 바로 뒤에 `}`와 리다이렉션 연산자가 와야 한다
          const after = src[i + 2];
          if (i > sub.open + 1 && src[i + 1] === '}' && (after === '<' || after === '>')) {
            word += ']}';
            fdVar = true;
            sub = null;
            i += 2;
            continue;
          }
          sub.dead = true;
        }
      }
    }
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
      wordQuoted = true;
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
      wordQuoted = true;
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
      wordQuoted = true;
      i = j + 1;
      continue;
    }
    if (dialect !== 'cmd' && c === '$' && src[i + 1] === '(') {
      const [inner, next] = readParen(src, i + 2);
      subs.push(inner);
      word += '$(…)';
      inWord = true;
      wordQuoted = true;
      i = next;
      continue;
    }
    if (posix && c === '`') {
      const end = src.indexOf('`', i + 1);
      const stop = end < 0 ? src.length : end;
      subs.push(src.slice(i + 1, stop));
      word += '`…`';
      inWord = true;
      wordQuoted = true;
      i = stop + 1;
      continue;
    }
    if (c === '#' && !inWord && dialect !== 'cmd' && !tokens[tokens.length - 1]?.glue) {
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
      // 앞의 연산자에 바로 이어진 here-string(`<<<<<<`)은 같은 구간이다: 한 번만 적는다
      if (hereRuns[hereRuns.length - 1] !== runs.length - 2) hereRuns.push(runs.length - 2);
      i += 3;
      continue;
    }
    if (posix && c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      // heredoc 연산자 앞에 붙은, 따옴표 밖의 파일 디스크립터(`3<<EOF`, `{fd}<<EOF`)는 인자에서 뺀다.
      // 일반 리다이렉션과 같은 판별이다
      if (inWord && redirAt < 0 && (fdVar || (!wordQuoted && isFdPrefix(word, dialect))))
        redirAt = 0;
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
      // 연산자 글자 바로 뒤(`>&`, `<&`: 디스크립터 복제·닫기)이거나 `&>`의 시작이면 리다이렉션 연산자의 글자다
      if (c === '&' && ((redirAt >= 0 && redirEnd === word.length) || src[i + 1] === '>')) {
        redirOp(c);
        i++;
        continue;
      }
      // 따옴표로 묶은 `>` 바로 뒤의 `&`는 전처럼 낱말의 글자로 둔다
      if (c === '&' && src[i - 1] === '>') {
        word += c;
        inWord = true;
        i++;
        continue;
      }
      if (posix && c === '{' && !inWord) {
        // bash의 디스크립터 변수 + 리다이렉션(`{fd}>out`, `{fds[$i]}>out`): 낱말 전체가 리다이렉션의 일부다
        // (셸이 디스크립터를 골라 그 변수에 넣는다). 이름 부분에 따옴표가 있으면 디스크립터 변수가 아니다
        FD_VAR_HEAD.lastIndex = i;
        if (i >= noSubBefore && FD_VAR_HEAD.test(src)) {
          const j = FD_VAR_HEAD.lastIndex;
          if (src[j] === '}' && (src[j + 1] === '<' || src[j + 1] === '>')) {
            word += src.slice(i, j + 1);
            inWord = true;
            fdVar = true;
            i = j + 1;
            continue;
          }
          if (src[j] === '[') {
            // 배열 원소: 첨자는 아래의 낱말 읽기가 그대로 읽는다(반복문 첫머리가 끝을 가린다)
            sub = { start: i, open: j, depth: 1, subs: subs.length, pairs: [], dead: false };
            word += src.slice(i, j + 1);
            inWord = true;
            i = j + 1;
            continue;
          }
        }
        // 공백 없이 `}`로 닫히는 낱말(`{}`, `{x}`, `{$x}`)은 묶음 괄호가 아니라 인자다
        if (i >= braceFailEnd) {
          const [closed, end] = braceWordAt(src, i);
          if (closed) {
            word += c;
            inWord = true;
            i++;
            continue;
          }
          braceFailEnd = end;
        }
      }
      // `>|`(noclobber를 무시하는 출력)는 파이프가 아니다
      if (posix && c === '|' && redirAt >= 0 && redirEnd === word.length && word.endsWith('>')) {
        redirOp(c);
        i++;
        continue;
      }
      push();
      const op: Token = { kind: 'op', value: c };
      // 공백 없이 낱말이 이어지는 중괄호(`{a`, `}a`, `{{a`)
      const nx = src[i + 1];
      if (posix && (c === '{' || c === '}') && nx !== undefined && !isWordEnd(nx)) op.glue = true;
      tokens.push(op);
      i++;
      continue;
    }
    // 프로세스 치환 `<(…)`·`>(…)`은 리다이렉션이 아니라 인자 하나다(셸이 경로로 바꿔 넘긴다). 안의 명령은 따로 본다
    if (posix && (c === '>' || c === '<') && src[i + 1] === '(') {
      const [inner, next] = readParen(src, i + 2);
      subs.push(inner);
      word += `${c}(…)`;
      inWord = true;
      wordQuoted = true;
      i = next;
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
  tail?: Tail,
  /** 제어문의 낱말(`then`, `do` …)을 벗기지 않는다(검사 순서용 분석: `if 검사; then push; fi`의 push는 조건 안에 있다) */
  keepControl = false,
): void {
  const assigns: Record<string, string> = {};
  const unsets: string[] = [];
  const hasRedirs = redirs?.some((r) => r !== undefined) ?? false;
  const source = words;
  // 명령 이름은 리다이렉션을 뺀 낱말에서 찾는다: 리다이렉션은 단순 명령의 어느 자리에나 올 수 있다(`>out git …`, `env >out git …`).
  // at[j]는 그 낱말이 나온 원래 자리다. 리다이렉션이 붙은 낱말(`git>out`)은 연산자 앞의 글이 낱말이다
  const at: number[] = [];
  if (hasRedirs) {
    words = [];
    let target = false;
    for (let k = 0; k < source.length; k++) {
      const r = redirs![k];
      if (target) {
        target = r?.needsTarget ?? false;
        continue;
      }
      if (!r) {
        words.push(source[k]);
        at.push(k);
        continue;
      }
      if (r.arg !== null) {
        words.push(r.arg);
        at.push(k);
      }
      target = r.needsTarget;
    }
  }
  const strip = dialect === 'posix';
  /** 벗긴 예약어·수식어. 뒤에 명령이 없으면(`then`뿐인 줄) 전처럼 이 낱말을 담은 명령을 낸다 */
  const reserved: string[] = [];
  let i = 0;
  // 앞의 할당과 래퍼, 명령 앞에 서는 낱말을 벗긴다
  for (;;) {
    const raw = words[i];
    if (raw === undefined) break;
    const m = ASSIGN_RE.exec(raw);
    if (m) {
      assigns[m[1]] = m[2];
      i++;
      continue;
    }
    if (strip && BEFORE_COMMAND.has(raw) && !(keepControl && CONTROL.has(raw))) {
      reserved.push(raw);
      i++;
      continue;
    }
    if (strip && raw === 'repeat') {
      reserved.push(raw);
      i += 2; // zsh: repeat <횟수> <명령>
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
  let argv: string[];
  let own: (Redir | undefined)[];
  if (!hasRedirs) {
    argv = words.slice(i);
    own = argv.map(() => undefined);
  } else {
    /** 붙어 있던 낱말에서 뗀 리다이렉션 */
    const detached = (r: Redir): Redir => ({
      arg: null,
      needsTarget: r.needsTarget,
      pre: '',
      targets: r.targets,
    });
    /** 명령 이름이 든 낱말의 원래 자리. 이름이 없으면 끝 */
    const n = i < words.length ? at[i] : source.length;
    // 이름 앞: 벗긴 낱말은 버리고, 리다이렉션(연산자와 대상, 벗긴 낱말에 붙어 있던 것)은 차례대로 모아 끝으로 옮긴다
    const lead: string[] = [];
    const leadRedirs: (Redir | undefined)[] = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const r = redirs![k];
      if (j < at.length && at[j] === k) {
        j++;
        if (!r) continue;
        lead.push(source[k].slice(r.pre.length));
        leadRedirs.push(detached(r));
        continue;
      }
      lead.push(source[k]);
      leadRedirs.push(r);
    }
    argv = [];
    own = [];
    if (n < source.length) {
      const r = redirs![n];
      argv.push(words[i]);
      own.push(undefined);
      if (r) {
        // 이름에 붙은 리다이렉션(`git>out`)은 이름 바로 뒤에 따로 둔다
        argv.push(source[n].slice(r.pre.length));
        own.push(detached(r));
      }
      for (let k = n + 1; k < source.length; k++) {
        argv.push(source[k]);
        own.push(redirs![k]);
      }
    }
    for (let k = 0; k < lead.length; k++) {
      argv.push(lead[k]);
      own.push(leadRedirs[k]);
    }
  }
  if (argv.length === 0 && reserved.length) {
    argv = reserved;
    own = reserved.map(() => undefined);
  }
  if (argv.length === 0) {
    if (Object.keys(assigns).length) out.push({ argv: [], assigns, unsets });
    return;
  }
  let args = hasRedirs ? shellArgs(argv, own) : undefined;
  /** 이 조각의 인자(리다이렉션을 뺀 것). 인자 자리의 중괄호에서 나뉜 나머지는 넣지 않는다: 재귀로 다시 읽을 글에 쓴다 */
  const plain = args ?? argv;
  if (tail) {
    // 인자 자리의 `{`·`}`에서 나뉜 나머지도 bash는 이 명령에 넘긴다
    const words = [...argv, ...tail.words];
    args = shellArgs(words, [...own, ...tail.redirs]) ?? words;
  }
  // 낱말에 붙은 리다이렉션의 대상: 토큰화가 연산자의 경계로 낸 것(`<a>b`는 a와 b, `<'a>b'`는 `a>b` 하나)
  const targets: string[] = [];
  if (hasRedirs)
    for (const r of own) {
      if (!r?.targets) continue;
      // 하나씩 더한다: 배열을 인자로 펼치면 대상이 아주 많은 입력에서 함수 인자의 한도를 넘는다
      for (const target of r.targets) targets.push(target);
    }
  /** argv와, 셸이 넘기는 인자가 argv와 다를 때만 args. 붙은 대상이 있을 때만 targets */
  const base: Pick<SimpleCommand, 'argv' | 'args' | 'targets'> = args ? { argv, args } : { argv };
  if (targets.length) base.targets = targets;
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
  // 셸이 넘기는 인자로 본다: 리다이렉션이 끼어도(`bash >out -c "…"`, `eval >out "…"`) 같은 글을 다시 읽는다
  if (SHELLS.has(head)) {
    for (let k = 1; k < plain.length; k++) {
      const x = plain[k];
      if (x === '-c' || (/^-[a-z]+$/.test(x) && x.includes('c'))) {
        if (plain[k + 1] !== undefined) parseInto(plain[k + 1], out, depth + 1, 'posix');
        break;
      }
    }
  } else if (head === 'eval') {
    parseInto(plain.slice(1).join(' '), out, depth + 1, dialect);
  } else if (POWERSHELLS.has(head)) {
    const script = powershellScript(plain.slice(1));
    if (script !== null) parseInto(script, out, depth + 1, 'powershell');
  } else if (head === 'cmd') {
    const k = plain.findIndex((x, idx) => idx > 0 && /^\/[ck]$/i.test(x));
    if (k > 0) parseInto(plain.slice(k + 1).join(' '), out, depth + 1, 'cmd');
  } else if (head === 'iex' || head === 'invoke-expression') {
    const rest = plain.slice(1).filter((x) => !/^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(x));
    parseInto(rest.join(' '), out, depth + 1, 'powershell');
  }
}

/** 이 낱말들만 앞에 있으면 그 뒤의 `[[`는 명령의 첫 낱말 자리에 있다(조건식의 시작) */
const BEFORE_COND = new Set(['if', 'while', 'until', 'elif', 'then', 'do', 'else', '!', 'time']);

/** 이 낱말들 뒤의 `{`가 묶음 괄호인가: 예약어 하나뿐이거나(`then {`, `do {`), 함수·코프로세스 선언이다 */
function beforeGroup(cur: string[]): boolean {
  if (cur.length === 1 && BEFORE_GROUP.has(cur[0])) return true;
  return cur[0] === 'function' || cur[0] === 'coproc';
}

function parseInto(src: string, out: SimpleCommand[], depth: number, dialect: Dialect): void {
  const subs: string[] = [];
  const tokens = tokenize(src, subs, dialect);
  let cur: string[] = [];
  let curRedirs: (Redir | undefined)[] = [];
  /** 이 자리 앞의 토큰은 앞 조각의 args에 이미 담았다(조각마다 다시 모으지 않는다) */
  let tailEnd = 0;
  /**
   * 조건식 `[[ … ]]` 안이다. zsh는 `if [[ … ]] 명령`의 명령을 실행하므로 조건식이 끝난 자리에서 명령을 나눈다.
   * 시작: 따옴표가 없고 리다이렉션이 붙지 않은 `[[`가 명령의 첫 낱말 자리에 있을 때만이다(인자 자리의 `[[`, `"[["`는 예약어가 아니다).
   * 첫 낱말 자리: 앞의 낱말이 모두 따옴표·이스케이프 없는 예약어다. `"then" [[ a ]] x`의 `then`은 명령 이름이고 `[[`는 그 인자다.
   * 끝: 따옴표 없는 `]]`. 따옴표로 묶은 `"]]"`는 피연산자다. 조건식 안의 연산자(`&&`, `||`, 괄호, 줄바꿈)는 조건식을 끝내지 않는다.
   * bash에서는 `[[ … ]]` 뒤에 연산자가 와야 하므로 바른 bash 명령의 조각은 달라지지 않는다
   */
  let cond = false;
  /** cur의 낱말이 모두 따옴표·이스케이프·리다이렉션 없는 예약어다(비어 있어도 참). 조건식이 설 수 있는 자리다 */
  let bare = true;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === 'op') {
      if (cur.length) {
        // bash는 명령의 첫 낱말 자리가 아닌 곳의 `{`·`}`를 낱말로 넘긴다. 명령은 전처럼 여기서 나누고(argv는 그대로다),
        // 첫 조각의 args에 bash가 넘기는 인자를 진짜 구분자 앞까지 담는다
        let tail: Tail | undefined;
        if (
          dialect === 'posix' &&
          (t.value === '{' || t.value === '}') &&
          k >= tailEnd &&
          !(t.value === '{' && beforeGroup(cur))
        ) {
          tail = braceTail(tokens, k);
          tailEnd = tail.end;
        }
        normalize(cur, out, depth, dialect, curRedirs, tail);
      }
      cur = [];
      curRedirs = [];
      bare = true;
    } else {
      if (dialect === 'posix' && !cond && bare && t.value === '[[' && !t.quoted && !t.redir)
        cond = true;
      cur.push(t.value);
      curRedirs.push(t.redir);
      bare = bare && !t.quoted && !t.redir && BEFORE_COND.has(t.value);
      // 조건식의 끝: `]]`, 또는 `]]`에 리다이렉션이 붙은 낱말(`]]>out`)
      if (cond && (t.redir ? t.redir.pre === ']]' : t.value === ']]' && !t.quoted)) {
        normalize(cur, out, depth, dialect, curRedirs);
        cur = [];
        curRedirs = [];
        bare = true;
        // 리다이렉션이 붙은 낱말에 따옴표가 있으면 `]]`가 따옴표 안이었을 수 있다: 나누기만 하고 조건식은 끝내지 않는다
        if (!t.quoted) cond = false;
      }
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
  let curRedirs: (Redir | undefined)[] = [];
  const flush = (op: string | null) => {
    if (cur.length) {
      const one: SimpleCommand[] = [];
      normalize(cur, one, MAX_DEPTH, dialect, curRedirs, undefined, true);
      if (one.length) out.push({ cmd: one[0], next: op });
    }
    cur = [];
    curRedirs = [];
  };
  // 묶음을 닫기 직전의 `;`(예: `{ a; } && b`)는 묶음 뒤 연산자로 바꿔 읽는다
  let semiJustNow = false;
  for (const t of tokenize(src, [], dialect)) {
    if (t.kind !== 'op') {
      cur.push(t.value);
      curRedirs.push(t.redir);
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
