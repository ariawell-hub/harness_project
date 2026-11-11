// 공통 출력·글롭 도구.

/** 에러 메시지 규칙(5.1절): 무엇이 틀렸나 + 어떻게 고치나 + 근거 문서 */
export interface Problem {
  rule: string;
  what: string;
  how: string;
  doc: string;
}

export function formatProblem(p: Problem): string {
  return `[${p.rule}] ${p.what}\n  고치는 법: ${p.how}\n  근거: ${p.doc}`;
}

export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/`는 0개 이상의 디렉터리
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(file: string, globs: string[]): boolean {
  const f = file.replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(f));
}

export function log(msg: string): void {
  process.stdout.write(msg + '\n');
}

export function warn(msg: string): void {
  process.stderr.write(msg + '\n');
}

export function nowIso(): string {
  // 로컬 시간대 오프셋을 포함한 ISO 문자열
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

export function today(): string {
  return nowIso().slice(0, 10);
}
