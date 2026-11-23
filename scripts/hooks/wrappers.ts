// 래퍼(다른 명령을 대신 실행하는 명령: sudo, nice, timeout …)의 옵션 표와, 표대로 옵션을 건너뛰는 함수.
// 셸 분석기(shell.ts)가 래퍼 뒤의 실제 명령을 찾을 때 쓴다(설계서 13.1절 "래퍼의 옵션", Issue #193, TD-62 (3)).
// 값을 받는 옵션이 값과 띄어 쓰여 있으면(`nice -n 5 명령`) 그 값을 명령 이름으로 읽지 않게 한다.
// 표에 없는 옵션은 값을 받는지 알 수 없다: `unsure`로 알리고, 분석기가 뒤의 낱말에서 시작하는 명령도 후보로 본다.

export interface WrapperSpec {
  /** 값을 받지 않는 짧은 옵션의 글자들 */
  flags?: string;
  /** 값을 받는 짧은 옵션의 글자들(`-u 값`, `-u값`) */
  values?: string;
  /**
   * values 가운데 값을 붙여 써야만 받는 글자들(GNU xargs의 `-i{}`). 낱말의 끝에 오면 다음 낱말이 값인지
   * 알 수 없으므로 표에 없는 옵션처럼 다룬다
   */
  attached?: string;
  /** 값을 받지 않는 긴 옵션의 이름들(`--이름`. `--이름=값`만 되는 옵션도 여기에 둔다) */
  longFlags?: readonly string[];
  /** 값을 받는 긴 옵션의 이름들(`--이름 값`, `--이름=값`) */
  longValues?: readonly string[];
  /** 글자 그대로 견주는 옵션 낱말(`arch`의 `-arm64`) */
  words?: readonly string[];
  /** 글자 그대로 견주는 옵션 낱말 가운데 값을 받는 것(`arch -arch 값`) */
  wordValues?: readonly string[];
  /** 옵션 뒤, 명령 앞에 오는 자리 인자의 수(`timeout`의 시간) */
  positionals?: number;
  /** `-<숫자>` 꼴의 옵션을 받는다(`nice -10`) */
  numeric?: boolean;
  /**
   * 옵션 사이에 `이름=값` 낱말을 받아 환경에 넣고 그 뒤에서 옵션 읽기를 이어 간다(sudo: `sudo A=1 -u 사용자 명령`).
   * 그 낱말을 읽는 것은 분석기다(할당을 모아야 한다)
   */
  assigns?: boolean;
}

const COMMON_LONG = ['help', 'version'] as const;

const NICE: WrapperSpec = {
  values: 'n',
  longFlags: COMMON_LONG,
  longValues: ['adjustment'],
  numeric: true,
};
const TIMEOUT: WrapperSpec = {
  flags: 'v',
  values: 'sk',
  longFlags: ['preserve-status', 'foreground', 'verbose', ...COMMON_LONG],
  longValues: ['signal', 'kill-after'],
  positionals: 1,
};
const XARGS: WrapperSpec = {
  flags: '0oprtx',
  values: 'adEeIiJLlnPRSs',
  attached: 'eil',
  longFlags: [
    'null',
    'no-run-if-empty',
    'verbose',
    'interactive',
    'exit',
    'open-tty',
    'show-limits',
    'eof',
    'replace',
    'max-lines',
    ...COMMON_LONG,
  ],
  longValues: ['arg-file', 'delimiter', 'max-args', 'max-procs', 'max-chars', 'process-slot-var'],
};
const STDBUF: WrapperSpec = {
  values: 'ioe',
  longFlags: COMMON_LONG,
  longValues: ['input', 'output', 'error'],
};

/** 래퍼의 이름(경로·대소문자·실행 확장자를 뗀 것)과 옵션 표. `env`는 분석기가 따로 읽는다(할당과 `-u`를 모은다) */
export const WRAPPER_OPTIONS: ReadonlyMap<string, WrapperSpec> = new Map<string, WrapperSpec>([
  [
    'sudo',
    {
      assigns: true,
      flags: 'ABbEeHiKklNnPSsVv',
      values: 'CDghpRrTtUu',
      longFlags: [
        'askpass',
        'background',
        'bell',
        'preserve-env',
        'edit',
        'set-home',
        'help',
        'login',
        'remove-timestamp',
        'reset-timestamp',
        'list',
        'no-update',
        'non-interactive',
        'preserve-groups',
        'stdin',
        'shell',
        'version',
        'validate',
      ],
      longValues: [
        'close-from',
        'chdir',
        'group',
        'host',
        'prompt',
        'chroot',
        'role',
        'type',
        'command-timeout',
        'other-user',
        'user',
      ],
    },
  ],
  ['doas', { flags: 'Lns', values: 'Cu' }],
  ['nice', NICE],
  ['gnice', NICE],
  [
    'ionice',
    {
      flags: 't',
      values: 'cnpPu',
      longFlags: ['ignore', ...COMMON_LONG],
      longValues: ['class', 'classdata', 'pid', 'pgid', 'uid'],
    },
  ],
  ['exec', { flags: 'cl', values: 'a' }],
  ['command', { flags: 'pvV' }],
  ['builtin', { longFlags: COMMON_LONG }],
  ['nohup', { longFlags: COMMON_LONG }],
  [
    'time',
    {
      flags: 'apv',
      values: 'fo',
      longFlags: ['append', 'verbose', 'portability', ...COMMON_LONG],
      longValues: ['format', 'output'],
    },
  ],
  ['timeout', TIMEOUT],
  ['gtimeout', TIMEOUT],
  ['xargs', XARGS],
  ['gxargs', XARGS],
  ['stdbuf', STDBUF],
  ['gstdbuf', STDBUF],
  ['setsid', { flags: 'cfw', longFlags: ['ctty', 'fork', 'wait', ...COMMON_LONG] }],
  ['caffeinate', { flags: 'dimsu', values: 'tw' }],
  [
    'arch',
    {
      words: ['-32', '-64', '-arm64', '-arm64e', '-x86_64', '-x86_64h', '-i386', '-c'],
      wordValues: ['-arch', '-e', '-d'],
    },
  ],
  [
    'chrt',
    {
      flags: 'abdfimoRrv',
      values: 'DPpT',
      longFlags: [
        'all-tasks',
        'batch',
        'deadline',
        'fifo',
        'idle',
        'max',
        'other',
        'rr',
        'reset-on-fork',
        'verbose',
        ...COMMON_LONG,
      ],
      longValues: ['sched-runtime', 'sched-period', 'sched-deadline', 'pid'],
      positionals: 1,
    },
  ],
  [
    'taskset',
    {
      flags: 'acp',
      longFlags: ['all-tasks', 'cpu-list', 'pid', ...COMMON_LONG],
      positionals: 1,
    },
  ],
  ['unbuffer', { flags: 'p' }],
]);

interface Compiled {
  flags: Set<string>;
  values: Set<string>;
  attached: Set<string>;
  longFlags: Set<string>;
  longValues: Set<string>;
  words: Set<string>;
  wordValues: Set<string>;
  positionals: number;
  numeric: boolean;
}

const COMPILED = new Map<string, Compiled>(
  [...WRAPPER_OPTIONS].map(([name, s]) => [
    name,
    {
      flags: new Set(s.flags ?? ''),
      values: new Set(s.values ?? ''),
      attached: new Set(s.attached ?? ''),
      longFlags: new Set(s.longFlags ?? []),
      longValues: new Set(s.longValues ?? []),
      words: new Set(s.words ?? []),
      wordValues: new Set(s.wordValues ?? []),
      positionals: s.positionals ?? 0,
      numeric: s.numeric ?? false,
    },
  ]),
);

/** 표에 든 래퍼의 이름인가 */
export function isWrapper(name: string): boolean {
  return COMPILED.has(name);
}

/**
 * 래퍼 `name`의 옵션과 자리 인자를 `words[i]`부터 건너뛴다. `next`는 명령(또는 다음 래퍼·할당)이 시작하는 자리다
 * (낱말이 모자라면 끝). `unsure`는 표에 없는 옵션을 만났다는 뜻이다: 그 옵션이 값을 받는지 알 수 없다.
 * 파일 시스템을 보지 않는 순수 함수다.
 */
export function skipWrapperOptions(
  name: string,
  words: readonly string[],
  i: number,
): { next: number; unsure: boolean } {
  const spec = COMPILED.get(name);
  if (!spec) return { next: i, unsure: false };
  const n = words.length;
  let unsure = false;
  while (i < n) {
    const w = words[i];
    // `--`: 건너뛰고 옵션 읽기를 끝낸다
    if (w === '--') {
      i++;
      break;
    }
    // `-` 하나뿐인 낱말과 `-`로 시작하지 않는 낱말: 옵션 읽기를 끝낸다
    if (w === '-' || !w.startsWith('-')) break;
    if (spec.wordValues.has(w)) {
      i += 2;
      continue;
    }
    if (spec.words.has(w)) {
      i++;
      continue;
    }
    if (w.startsWith('--')) {
      // `--이름=값`은 이름을 몰라도 한 낱말이다
      if (!w.includes('=')) {
        const long = w.slice(2);
        if (spec.longValues.has(long)) {
          i += 2;
          continue;
        }
        if (!spec.longFlags.has(long)) unsure = true;
      }
      i++;
      continue;
    }
    if (spec.numeric && /^-\d+$/.test(w)) {
      i++;
      continue;
    }
    // 묶은 짧은 옵션: 값을 받는 글자에서 끝난다. 그 글자가 낱말의 끝이면 다음 낱말이 값이고, 아니면 나머지 글자가 값이다
    let step = 1;
    for (let k = 1; k < w.length; k++) {
      const ch = w[k];
      if (spec.values.has(ch)) {
        if (k === w.length - 1) {
          if (spec.attached.has(ch)) unsure = true;
          else step = 2;
        }
        break;
      }
      if (!spec.flags.has(ch)) {
        unsure = true;
        break;
      }
    }
    i += step;
  }
  i += spec.positionals;
  return { next: Math.min(i, n), unsure };
}

/** uutils의 env가 먼저 나누는 낱말의 머리. 뒤에 글이 붙었으면 그 글을, 글자가 같으면 다음 낱말을 나눈다 */
const UUTILS_SPLIT_HEADS = ['--split-string', '-S', '-vS', '-vvS'];
/** uutils의 env가 값을 받는다고 보는 긴 옵션과 짧은 옵션의 글자(그 다음 낱말에서는 훑기가 그치지 않는다) */
const UUTILS_LONG_VALUES = new Set(['--argv0', '--chdir', '--file', '--unset']);
const UUTILS_SHORT_VALUES = new Set(['a', 'C', 'f', 'u']);

/**
 * uutils coreutils의 env가 옵션을 읽기 전에 `-S`를 먼저 나누는 훑기(0.10.0의 `process_all_string_arguments`)를 따라 한다.
 * words의 from부터가 `env` 뒤의 처음 받은 낱말이다. uutils가 나누는 낱말의 자리(from에서 0부터)와 훑기가 그친 자리(words의 자리)를 낸다.
 * GNU와 macOS는 옵션을 읽는 자리에서만 나누고 훅은 `-S`의 문자열을 읽지 않으므로, 나누는 낱말이 하나라도 있으면 읽지 못한 명령이다
 */
export function uutilsScan(words: readonly string[], from = 0): { found: number[]; end: number } {
  const found: number[] = [];
  /** 바로 앞 낱말이 값을 받는 옵션으로 보였다: 이 낱말에서는 그치지 않는다 */
  let expecting = false;
  let n = from;
  for (; n < words.length; n++) {
    const x = words[n];
    // 그치는 곳: `--`, `-`로 시작하지 않고 `=`도 없는 낱말
    if (!expecting && (x === '--' || !(x.startsWith('-') || x.includes('=')))) break;
    expecting = false;
    // 머리 뒤에 글이 붙은 꼴: 붙은 글을 나눈다
    if (UUTILS_SPLIT_HEADS.some((h) => x.length > h.length && x.startsWith(h))) {
      found.push(n - from);
      continue;
    }
    // 머리와 글자가 같은 꼴: 다음 낱말을 나누고 그 낱말은 훑지 않는다. 다음 낱말이 없으면 나누지 않는다
    if (UUTILS_SPLIT_HEADS.includes(x)) {
      if (n + 1 < words.length) {
        found.push(n - from);
        n++;
      }
      continue;
    }
    if (x.startsWith('--')) expecting = UUTILS_LONG_VALUES.has(x);
    else if (x.length > 1 && x.startsWith('-'))
      expecting = UUTILS_SHORT_VALUES.has(x[x.length - 1]);
  }
  return { found, end: Math.min(n, words.length) };
}

/** uutils의 env가 먼저 나누는 낱말의 자리(0부터). words는 `env` 뒤의 처음 받은 낱말이다 */
export function uutilsSplits(words: readonly string[]): number[] {
  return uutilsScan(words).found;
}
