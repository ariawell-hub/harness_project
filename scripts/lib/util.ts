// 공통 출력·글롭 도구.

/** 에러 메시지 규칙(5.1절): 무엇이 틀렸나 + 어떻게 고치나 + 근거 문서 */
export interface Problem {
  rule: string;
  what: string;
  how: string;
  doc: string;
}

/** 경고 판정(pr-size, scope)이 경고를 낼 때 설명의 머리말. 요약과 지표가 이 글자로 경고를 가린다 */
export const WARN_PREFIX = '경고: ';

/** 판정 상세(details) 한 줄의 글자 수 상한 */
export const DETAIL_LINE_MAX = 200;
/** 판정 하나의 상세 전체의 바이트 상한(UTF-8, 줄마다 줄바꿈 1바이트 포함) */
export const DETAILS_MAX_BYTES = 12_000;
/** 상세를 줄였을 때 끝에 더하는 줄 */
export const DETAILS_CUT = '… (상세를 줄였다)';

/**
 * 판정 상세의 크기를 묶는다. 판정 결과는 job 출력과 환경 변수 하나로 기록 job에 넘어가므로(10.4절),
 * PR이 정하는 값(파일 경로)이 그 크기를 키우게 두지 않는다.
 * 한 줄은 DETAIL_LINE_MAX자까지다(넘으면 잘라 끝에 `…`). 앞에서부터 담다가 합이 DETAILS_MAX_BYTES를 넘게 되는 줄부터는 버리고
 * 끝에 DETAILS_CUT 한 줄을 더한다(이 줄은 상한에 세지 않는다).
 * 줄의 크기는 JSON 문자열로 적었을 때의 UTF-8 바이트 수에 1을 더한 값이다(제어 문자·따옴표·역슬래시는 JSON에서 길어진다)
 */
export const detailBytes = (line: string): number =>
  Buffer.byteLength(JSON.stringify(line), 'utf8') + 1;

export function capDetails(lines: string[]): string[] {
  const out: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const t = line.length > DETAIL_LINE_MAX ? line.slice(0, DETAIL_LINE_MAX - 1) + '…' : line;
    bytes += detailBytes(t);
    if (bytes > DETAILS_MAX_BYTES) return [...out, DETAILS_CUT];
    out.push(t);
  }
  return out;
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
