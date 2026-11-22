// L1 훅이 래퍼(다른 명령을 대신 실행하는 명령)의 옵션을 읽는 방법(계획 20261122-hook-wrapper-options, Issue #193, TD-62 (3)).
// 값을 받는 옵션이 값과 띄어 쓰인 래퍼(`nice -n 5 명령`, `sudo -u 사용자 명령`) 뒤의 명령에도 규칙이 돈다.
// 금지 호출의 글은 판정만 한다(evaluate). 실제로 돌리는 것은 인자를 파일에 적는 가짜 명령 `tool`뿐이다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { parseSequence, parseShell, parseWork } from '../hooks/shell.ts';
import { WRAPPER_OPTIONS, skipWrapperOptions, uutilsSplits } from '../hooks/wrappers.ts';
import { tmp } from './helpers.ts';

const ctx: GuardContext = {
  repo: null,
  hasPlan: () => true,
  dbPatterns: [],
  dbClients: ['psql'],
  dbCommands: () => [],
  home: '/Users/someone',
};
/** 판정한 규칙의 첫 낱말(`R14`). 통과면 null */
const rule = (command: string): string | null =>
  evaluate({ kind: 'bash', command, cwd: '/work/repo' }, ctx)?.rule.split(' ')[0] ?? null;

/** 금지 호출과, 그대로 썼을 때의 규칙(command-position.test.ts와 같은 열둘) */
const CALLS: [call: string, rule: string][] = [
  ['git push --force origin main', 'R14'],
  ['git push origin main', 'R2'],
  ['git reset --hard', 'R14'],
  ['git clean -fd', 'R14'],
  ['gh pr review 7 --approve', 'R20'],
  ['gh secret set X', 'R20'],
  ['gh auth switch', 'R20'],
  ['git commit --no-verify -m x', 'R4'],
  ['rm -rf /', 'R14'],
  ['psql -c x', 'R13'],
  ['security find-generic-password -s x', 'R20'],
  ['npm publish', 'R14'],
];

/** 금지 호출을 감싸는 꼴. 이름의 `C`가 금지 호출의 자리다 */
type Frame = [name: string, wrap: (call: string) => string];
/** `… C` 꼴의 틀: 이름의 끝의 `C`를 호출로 바꾼다 */
const prefix = (name: string): Frame => {
  assert.ok(name.endsWith(' C'), name);
  return [name, (c) => `${name.slice(0, -1)}${c}`];
};
/** 명령 이름 */
const head = (c: string) => c.slice(0, c.indexOf(' '));
/** 이름 뒤의 인자 */
const rest = (c: string) => c.slice(c.indexOf(' ') + 1);

/** 닫는 꼴: 전에는 이 꼴로 감싸면 규칙이 돌지 않았다 */
const CLOSE: Frame[] = [
  // nice
  ...['nice -n 5 C', 'nice --adjustment 5 C', 'nice -n 5 -- C', 'gnice -n 5 C'].map(prefix),
  // sudo, doas
  ...[
    'sudo -u someone C',
    'sudo -g staff C',
    'sudo -u someone -- C',
    'sudo --user someone C',
    'sudo -iu someone C',
    'sudo -E -u someone A=1 C',
    'sudo -u someone -g staff C',
    'sudo -D /tmp C',
    'sudo -h host C',
    'sudo -p prompt C',
    'sudo --chdir /tmp C',
    'doas -u someone C',
  ].map(prefix),
  // ionice, exec, time
  ...[
    'ionice -c 2 C',
    'ionice -c 2 -n 7 C',
    'ionice --class 2 C',
    'exec -a name C',
    'exec -cla name C',
    'time -f %e C',
    'time -o out.txt C',
  ].map(prefix),
  // timeout
  ...[
    'timeout -s KILL 5 C',
    'timeout -k 1 5 C',
    'timeout --signal KILL 5 C',
    'timeout --kill-after 1 5 C',
    'timeout -s KILL -k 1 5 C',
    'gtimeout 5 C',
    'gtimeout -s KILL 5 C',
  ].map(prefix),
  // env
  ...[
    'env -C /tmp C',
    'env --chdir /tmp C',
    'env -P /usr/bin C',
    'env -a name C',
    'env --argv0 name C',
    'env -i -C /tmp A=1 C',
    'env -iC /tmp C',
    'genv -u HOME C',
    // 값을 붙여 쓴 `-u`의 값에 `S`가 들어도 `-S`가 아니다
    'env -uSSH_AUTH_SOCK C',
    'env -iuS C',
  ].map(prefix),
  // xargs
  ...[
    'xargs --max-args 1 C',
    'xargs --max-procs 2 C',
    'xargs -a list.txt C',
    'xargs --arg-file list.txt C',
    'xargs -J % C',
    'xargs -R 2 C',
    'gxargs -n 1 C',
  ].map(prefix),
  // 래퍼 목록에 새로 넣은 래퍼
  ...[
    'stdbuf -o L C',
    'stdbuf -oL C',
    'stdbuf --output=L C',
    'stdbuf --output L C',
    'gstdbuf -o L C',
    'setsid C',
    'setsid -w C',
    'caffeinate C',
    'caffeinate -i C',
    'caffeinate -t 60 C',
    'caffeinate -dims -w 1 C',
    'arch -arm64 C',
    'arch -arch arm64 C',
    'arch -e A=1 C',
    'chrt -f 10 C',
    'chrt 10 C',
    'taskset -c 0 C',
    'taskset 0x1 C',
    'unbuffer C',
    'unbuffer -p C',
  ].map(prefix),
  // 겹친 래퍼
  ...[
    'sudo -u someone nice -n 5 C',
    'nice -n 5 sudo -u someone C',
    'timeout -s KILL 5 env -C /tmp C',
    'nohup nice -n 5 C',
  ].map(prefix),
  // 다른 틀과 섞인 꼴
  ['if true; then nice -n 5 C; fi', (c) => `if true; then nice -n 5 ${c}; fi`],
  ['bash -c "nice -n 5 C"', (c) => `bash -c "nice -n 5 ${c}"`],
  ...[
    '>/dev/null nice -n 5 C',
    'nice >/dev/null -n 5 C',
    'nice -n >/dev/null 5 C',
    'nice -n 5 >/dev/null C',
    'A=1 nice -n 5 C',
    'true && sudo -u someone C',
    'NICE -n 5 C',
    '/usr/bin/nice -n 5 C',
  ].map(prefix),
  // 할당과 옵션의 끝: env의 할당은 `=`가 든 낱말이고(이름이 셸의 식별자가 아니어도) `--`가 옵션을 끝낸다. sudo는 옵션 사이에 할당을 받는다
  ...[
    'env BUILD-MODE=local C',
    'env a.b=1 C',
    'env -i A-B=1 C',
    'env -- BUILD-MODE=local C',
    'env -- -x=1 C',
    'env =x C',
    'env A=1 -x=1 C',
    // 옵션 단계의 혼자 쓴 `-` 뒤의 할당
    'env - A=1 C',
    'sudo A-B=1 C',
    'sudo A=1 -u someone C',
    'sudo -u someone A-B=1 C',
    'sudo A=1 B-C=2 -g staff -u someone C',
    'sudo -u someone A=1 -- C',
  ].map(prefix),
];

/** 닫는 꼴 가운데 표에 없는 옵션이 든 것: 뒤의 낱말에서 시작하는 후보로 막힌다 */
const UNSURE: Frame[] = [
  'nice --unknown 5 C',
  'sudo --unknown someone C',
  'sudo -Z someone C',
  'timeout --unknown x 5 C',
  'stdbuf -Z x C',
  // 값을 붙여 써야 하는 옵션을 띄어 쓴 꼴
  'xargs -i {} C',
  // 후보의 넷째 자리
  'nice --unknown a b c d C',
].map(prefix);

/** 유지하는 꼴: 전에도 막혔다 */
const KEEP: Frame[] = [
  'nice C',
  'sudo C',
  'sudo -n C',
  'nohup C',
  'time -p C',
  'command -p C',
  'exec -c C',
  'nice -n5 C',
  'nice --adjustment=5 C',
  'nice -10 C',
  'ionice -c2 C',
  'timeout 5 C',
  'timeout --signal=KILL 5 C',
  'timeout --preserve-status 5 C',
  'env -u HOME C',
  'env -i C',
  'env --chdir=/tmp C',
  'env A=1 C',
  'xargs -n 1 C',
  'xargs -I {} C',
  'xargs --max-procs=2 C',
  'xargs -0 -n 1 C',
  'sudo --user=someone C',
  'sudo -usomeone C',
  'command -- C',
  'exec -- C',
  'nohup -- C',
  'builtin command C',
  // 할당과 옵션의 끝
  'env -- C',
  'env -i -- A=1 C',
  'env - C',
  'sudo A=1 C',
  'sudo -- A=1 C',
].map(prefix);

/** 막히지 않아야 하는 호출 */
const ALLOW = [
  'nice -n 5 node scripts/harness.ts test',
  'timeout -s KILL 5 git status',
  'timeout -k 1 5 node --test x.test.ts',
  'sudo -u someone ls',
  'nice -n 5 echo git reset --hard',
  'sudo -u someone echo "git reset --hard"',
  'timeout 5 grep -r "git push --force" .',
  'xargs -n 1 echo',
  'nice -n 5 git log --oneline',
  'env -C /tmp git status',
  'env -uSHELL git status',
  'stdbuf -o L cat file.txt',
  'caffeinate -i node scripts/harness.ts test',
  'arch -arm64 node -v',
  'chrt -f 10 node -v',
  'taskset -c 0 node -v',
  // 모르는 옵션이 있어도 뒤에 금지 호출이 없으면 통과한다
  'nice --unknown 5 node -v',
  'sudo --unknown someone git status',
  // 할당과 옵션의 끝
  'env BUILD-MODE=local git status',
  'env -- git status',
  'env - git status',
  'env - A=1 git status',
  'sudo A=1 -u someone ls',
  // 따로 쓴 명령 이름 뒤의 `-S`는 그 명령의 인자다
  'env tool -S "git reset --hard"',
  // 할당 뒤의 명령 이름에서 uutils의 훑기가 그친다
  'env LC_ALL=C sort -S 1G file.txt',
  // `--` 뒤의 `-S`는 그 이름의 명령이고 문자열은 인자 하나다
  'env -- -S "git reset --hard"',
];

const judge = (frames: Frame[]): string[] => {
  const missed: string[] = [];
  for (const [name, wrap] of frames)
    for (const [call, want] of CALLS) {
      const got = rule(wrap(call));
      if (got !== want) missed.push(`[${name}] ${JSON.stringify(wrap(call))}: ${got ?? '통과'}`);
    }
  return missed;
};

test('기준: 금지 호출을 그대로 쓰면 정해진 규칙으로 막힌다', () => {
  for (const [call, want] of CALLS) assert.equal(rule(call), want, call);
});

test('닫는 꼴: 값을 받는 옵션이 붙은 래퍼, 새 래퍼, 겹친 래퍼로 감싸도 같은 규칙으로 막힌다', () => {
  assert.deepEqual(judge(CLOSE), []);
});

test('모르는 옵션: 표에 없는 옵션이 붙은 래퍼 뒤에서는 뒤의 낱말에서 시작하는 후보로 막힌다', () => {
  assert.deepEqual(judge(UNSURE), []);
});

test('유지하는 꼴: 전에 막히던 꼴의 판정이 그대로다', () => {
  assert.deepEqual(judge(KEEP), []);
});

test('허용: 래퍼 뒤의 금지되지 않은 명령과, 금지 호출의 글이 인자일 뿐인 호출은 막히지 않는다', () => {
  for (const c of ALLOW) assert.equal(rule(c), null, c);
});

test('막는 쪽으로 기우는 대가: 모르는 옵션이 붙은 래퍼 뒤에서는 인자에 이어진 금지 호출의 글도 막힌다', () => {
  assert.equal(rule('nice --unknown 5 echo git reset --hard'), 'R14');
  // 같은 호출에서 모르는 옵션을 빼면 통과한다
  assert.equal(rule('nice -n 5 echo git reset --hard'), null);
});

/** 실행되지 않는 명령: env의 할당 뒤(나 `--` 뒤)의 `-`로 시작하는 낱말은 실행 파일 이름이고 뒤의 낱말은 그 인자다 */
const NOT_RUN: Frame[] = [
  'env A=1 -i C',
  'env A=1 -u HOME C',
  'env A=1 -- C',
  'env A=1 --split C',
  'env -- -x C',
].map(prefix);
/** 글 전체가 인자 하나인 꼴 */
const NOT_RUN_QUOTED: Frame[] = [
  ['env -- -S "C"', (c) => `env -- -S "${c}"`],
  ['env -- A=1 -S "C"', (c) => `env -- A=1 -S "${c}"`],
];

test('실행되지 않는 명령: env의 할당 뒤의 `-` 낱말은 명령 이름이고, 뒤의 글은 다른 명령의 인자일 때와 판정이 같다', () => {
  // 기준: 금지 호출의 글이 다른 명령의 인자일 뿐인 호출. 열하나가 통과하고 DB 클라이언트만 R13이다(이름을 인자 자리에서도 본다)
  for (const [call, want] of CALLS)
    assert.equal(rule(`tool-x ${call}`), want === 'R13' ? 'R13' : null, call);
  const missed: string[] = [];
  for (const [frames, base] of [
    [NOT_RUN, (c: string) => `tool-x ${c}`],
    [NOT_RUN_QUOTED, (c: string) => `tool-x "${c}"`],
  ] as const)
    for (const [name, wrap] of frames)
      for (const [call] of CALLS) {
        const got = rule(wrap(call));
        if (got !== rule(base(call)))
          missed.push(`[${name}] ${JSON.stringify(wrap(call))}: ${got ?? '통과'}`);
        // 읽지 못한 명령으로 막은 것이 아니다
        for (const c of parseShell(wrap(call))) assert.equal(c.incomplete, undefined, wrap(call));
      }
  assert.deepEqual(missed, []);
});

/** 읽지 못한 명령: 구현(GNU, macOS, uutils)에 따라 실행 파일이나 인자가 달라지는 꼴과 표에 없는 env의 옵션. x는 실행하려는 명령의 글 */
const UNREADABLE: [name: string, wrap: (x: string) => string][] = [
  // 표에 없는 옵션과 줄인 긴 옵션
  ['env --unknown x X', (x) => `env --unknown x ${x}`],
  ['env -Z X', (x) => `env -Z ${x}`],
  ['env -L someone X', (x) => `env -L someone ${x}`],
  ['env --split "X"', (x) => `env --split "${x}"`],
  ['env --s="X"', (x) => `env --s="${x}"`],
  ['env --split-s "이름" 나머지', (x) => `env --split-s "${head(x)}" ${rest(x)}`],
  ['env --unse HOME X', (x) => `env --unse HOME ${x}`],
  ['env --unset HOME X', (x) => `env --unset HOME ${x}`],
  ['env --S "X"', (x) => `env --S "${x}"`],
  ['env --uY X', (x) => `env --uY ${x}`],
  ['env -i-S "X"', (x) => `env -i-S "${x}"`],
  ['env -x=1 X', (x) => `env -x=1 ${x}`],
  ['env --file x X', (x) => `env --file x ${x}`],
  // -S가 옵션으로 읽히는 호출: 문자열을 읽지 않는다(구현마다 문자열을 나누는 규칙이 다르다)
  ['env -S "X"', (x) => `env -S "${x}"`],
  ['env -S"X"', (x) => `env -S"${x}"`],
  ['env --split-string "X"', (x) => `env --split-string "${x}"`],
  ['env --split-string="X"', (x) => `env --split-string="${x}"`],
  ['env -i -S "X"', (x) => `env -i -S "${x}"`],
  ['env -iS "X"', (x) => `env -iS "${x}"`],
  ['env -vS "X"', (x) => `env -vS "${x}"`],
  ['env -S "이름" 나머지', (x) => `env -S "${head(x)}" ${rest(x)}`],
  ['env -S "BUILD-MODE=local X"', (x) => `env -S "BUILD-MODE=local ${x}"`],
  ['env -u -S X', (x) => `env -u -S ${x}`],
  ['env -C -Sa X', (x) => `env -C -Sa ${x}`],
  ['env -P /usr/bin -S "X"', (x) => `env -P /usr/bin -S "${x}"`],
  [`env -S "-S 'X'"`, (x) => `env -S "-S '${x}'"`],
  ['env -S -i -S -i -S "X"', (x) => `env -S -i -S -i -S "${x}"`],
  // uutils만 -S를 나누는 호출: GNU와 macOS에게는 명령 이름이나 인자다
  ['env A=1 -S "X"', (x) => `env A=1 -S "${x}"`],
  ['env A=1 -S"X"', (x) => `env A=1 -S"${x}"`],
  ['env A=1 -S "B=2 X"', (x) => `env A=1 -S "B=2 ${x}"`],
  ['env A=1 --split-string "X"', (x) => `env A=1 --split-string "${x}"`],
  ['env A=1 --split-string="X"', (x) => `env A=1 --split-string="${x}"`],
  ['env A=1 -iS "X"', (x) => `env A=1 -iS "${x}"`],
  ['env A=1 -vS "X"', (x) => `env A=1 -vS "${x}"`],
  // 할당 뒤의 `-`로 시작하는 명령 이름 뒤
  ['env A=1 -x -S "X"', (x) => `env A=1 -x -S "${x}"`],
  ['env A=1 -u HOME -S "X"', (x) => `env A=1 -u HOME -S "${x}"`],
  // 끝 글자 때문에 uutils가 명령 이름을 지나쳐 나눈다
  ['env -uXa 이름 -S "나머지"', (x) => `env -uXa ${head(x)} -S "${rest(x)}"`],
  // 혼자 쓴 `-`의 갈림
  ['env A=1 - X', (x) => `env A=1 - ${x}`],
  ['env -- - X', (x) => `env -- - ${x}`],
  ['env -- A=1 - X', (x) => `env -- A=1 - ${x}`],
  ['env A=1 - B=2 X', (x) => `env A=1 - B=2 ${x}`],
  ['env -- - A=1 X', (x) => `env -- - A=1 ${x}`],
  ['env A=1 - -i X', (x) => `env A=1 - -i ${x}`],
  ['env - -i X', (x) => `env - -i ${x}`],
  ['env - -u HOME X', (x) => `env - -u HOME ${x}`],
  ['env - -- X', (x) => `env - -- ${x}`],
  ['env - - X', (x) => `env - - ${x}`],
];

test('읽지 못한 명령: 구현마다 읽기가 갈리는 env의 꼴과 표에 없는 env의 옵션은 R4로 막는다', () => {
  for (const [name, wrap] of UNREADABLE) {
    const command = wrap('git status');
    assert.ok(
      parseShell(command).some((c) => c.incomplete === true),
      `[${name}] 표시가 없다: ${command}`,
    );
    assert.equal(rule(command), 'R4', `[${name}] ${command}`);
    // 금지 호출을 넣어도 막힌다
    for (const [call] of CALLS) assert.notEqual(rule(wrap(call)), null, `[${name}] ${wrap(call)}`);
  }
  // -S의 문자열 안에 따옴표 밖의 줄바꿈이 든 꼴: 어디서 나누는지가 구현의 문서마다 다르다(GNU는 구분자로, FreeBSD는 스페이스와 탭만 적는다. 이 Mac은 나눈다)
  for (const command of [
    "env -S 'tool a\nb'",
    "env -S'tool a\nb'",
    "env --split-string='tool a\nb'",
  ]) {
    assert.ok(command.includes('\n'));
    assert.equal(rule(command), 'R4', JSON.stringify(command));
  }
});

test('uutilsSplits: uutils의 env가 옵션을 읽기 전에 나누는 낱말의 자리', () => {
  const cases: [words: string[], want: number[]][] = [
    // 따로 쓴 -S와 다음 낱말, 붙여 쓴 꼴, 긴 옵션, -vS·-vvS
    [['-S', 'a b', 'x'], [0]],
    [['-Sab'], [0]],
    [['--split-string=a'], [0]],
    [['--split-string', 'a'], [0]],
    [['-vS', 'a'], [0]],
    [['-vvSa'], [0]],
    // 묶은 -iS는 나누지 않는다
    [['-iS', 'a'], []],
    // 값이 없는 끝
    [['-S'], []],
    // 그치는 낱말과 `--` 뒤
    [['tool', '-S', 'a'], []],
    [['--', '-S', 'a'], []],
    // 할당과 `-`로 시작하는 낱말은 지나간다
    [['A=1', '-x', '-', '-S', 'a'], [3]],
    // 값을 받는 옵션의 다음 낱말에서 그치지 않는다
    [['-u', 'HOME', '-S', 'a'], [2]],
    [['--chdir', 'd', '-S', 'a'], [2]],
    // 끝 글자의 예외
    [['-uXa', 'tool', '-S', 'a'], [2]],
    [['-uXb', 'tool', '-S', 'a'], []],
    // -P는 값을 받는 옵션으로 보지 않는다
    [['-P', 'd', '-S', 'a'], []],
    // 나눈 낱말 뒤에서는 예외가 없다
    [['-S', '-u', 'tool', '-S', 'a'], [0]],
    // 여러 번. 건너뛴 문자열 낱말은 훑지 않는다
    [
      ['-S', 'a', '-S', 'b'],
      [0, 2],
    ],
    [
      ['-S', '--', '-S', 'a'],
      [0, 2],
    ],
  ];
  for (const [words, want] of cases)
    assert.deepEqual(uutilsSplits(words), want, JSON.stringify(words));
});

const parsed = (command: string): string[][] => parseShell(command).map((c) => c.args ?? c.argv);

test('분석기: 래퍼의 옵션과 값을 건너뛴 자리가 명령 이름이다', () => {
  for (const command of [
    'nice -n 5 git status',
    'sudo -u someone -g staff git status',
    'timeout -s KILL -k 1 5 git status',
    'xargs --max-args 1 git status',
    'stdbuf -o L git status',
    'arch -arch arm64 git status',
    'chrt -f 10 git status',
  ])
    assert.deepEqual(parsed(command), [['git', 'status']], command);
  for (const command of ['env -C /tmp A=1 git status', 'sudo -u someone A=1 git status']) {
    const cmds = parseShell(command);
    assert.deepEqual(
      cmds.map((c) => c.args ?? c.argv),
      [['git', 'status']],
      command,
    );
    assert.equal(cmds[0].assigns.A, '1', command);
  }
});

test('분석기: env와 sudo의 할당, env의 옵션의 끝(--), 할당 뒤의 낱말', () => {
  /** 명령 하나(후보가 없고 끝까지 읽었다)의 낱말과 할당 */
  const one = (command: string): [string[], Record<string, string>] => {
    const cmds = parseShell(command);
    assert.equal(cmds.length, 1, command);
    assert.equal(cmds[0].incomplete, undefined, command);
    return [cmds[0].args ?? cmds[0].argv, { ...cmds[0].assigns }];
  };
  // env의 할당: `=`가 든 낱말이다. 이름이 셸의 식별자가 아니어도 된다
  assert.deepEqual(one('env BUILD-MODE=local git status'), [
    ['git', 'status'],
    { 'BUILD-MODE': 'local' },
  ]);
  // 이름이 빈 낱말은 담지 않고 건너뛴다
  assert.deepEqual(one('env =x git status'), [['git', 'status'], {}]);
  // `--` 뒤: 옵션으로 읽지 않는다. 문자열을 나누지 않는다
  assert.deepEqual(one("env -- -S 'tool a'"), [['-S', 'tool a'], {}]);
  assert.deepEqual(one('env -- -x=1 tool a'), [['tool', 'a'], { '-x': '1' }]);
  assert.deepEqual(one('env -i -- A=1 tool a'), [['tool', 'a'], { A: '1' }]);
  // 할당 뒤의 `-`로 시작하는 낱말은 명령 이름이다(세 구현 모두 그 이름의 실행 파일을 찾는다). 글자 그대로 둔다
  assert.deepEqual(one('env A=1 -i tool a'), [['-i', 'tool', 'a'], { A: '1' }]);
  assert.deepEqual(one('env A=1 -- tool a'), [['--', 'tool', 'a'], { A: '1' }]);
  assert.deepEqual(one('env A=1 -u HOME -i tool a'), [
    ['-u', 'HOME', '-i', 'tool', 'a'],
    { A: '1' },
  ]);
  // 뒤의 할당과 래퍼를 벗기지 않는다(인자일 뿐이다)
  assert.deepEqual(one('env A=1 -i B=2 nice tool a'), [
    ['-i', 'B=2', 'nice', 'tool', 'a'],
    { A: '1' },
  ]);
  // 뒤의 인자 가운데 uutils의 훑기가 그친 뒤의 `-S`는 인자다
  assert.deepEqual(one('env A=1 -i git log -S x'), [['-i', 'git', 'log', '-S', 'x'], { A: '1' }]);
  // 할당 단계의 `-x=1`은 할당이다
  assert.deepEqual(one('env A=1 -x=1 tool a'), [['tool', 'a'], { A: '1', '-x': '1' }]);
  // 옵션 단계의 혼자 쓴 `-`는 건너뛴다
  for (const command of ['env - tool a', 'env -i - tool a', 'env -i tool a'])
    assert.deepEqual(one(command), [['tool', 'a'], {}], command);
  assert.deepEqual(one('env - A=1 tool a'), [['tool', 'a'], { A: '1' }]);
  // 명령 이름 뒤의 `-S`는 인자다
  assert.deepEqual(one("env tool -S 'a b'"), [['tool', '-S', 'a b'], {}]);
  assert.deepEqual(one('env A=1 sort -S 1G'), [['sort', '-S', '1G'], { A: '1' }]);
  // 값을 붙여 쓴 `-u`의 값에 `S`가 들어도 `-S`가 아니다
  {
    const cmds = parseShell('env -uSHELL -uS git status');
    assert.deepEqual(
      cmds.map((c) => c.args ?? c.argv),
      [['git', 'status']],
    );
    assert.equal(cmds[0].incomplete, undefined);
    assert.deepEqual(cmds[0].unsets, ['SHELL', 'S']);
  }
  // 할당 뒤의 래퍼는 전처럼 벗긴다
  assert.deepEqual(one('env A=1 nice -n 5 tool a'), [['tool', 'a'], { A: '1' }]);
  // sudo: 옵션 사이의 할당 뒤에 옵션 읽기를 이어 간다
  assert.deepEqual(one('sudo A=1 -u someone git status'), [['git', 'status'], { A: '1' }]);
  assert.deepEqual(one('sudo -u someone A-B=1 git status'), [['git', 'status'], { 'A-B': '1' }]);
  // `/`로 시작하면 명령이다
  assert.deepEqual(one('sudo /x=1 git status'), [['/x=1', 'git', 'status'], {}]);
  // `--` 바로 뒤는 명령이다
  assert.deepEqual(one('sudo -u someone -- A-B=1 git status'), [['A-B=1', 'git', 'status'], {}]);
  // doas는 할당을 받지 않는다
  assert.deepEqual(one('doas A-B=1 git status'), [['A-B=1', 'git', 'status'], {}]);
});

test('옵션 표: 옵션 사이에 할당을 받는 래퍼는 sudo뿐이다', () => {
  assert.deepEqual(
    [...WRAPPER_OPTIONS].filter(([, spec]) => spec.assigns).map(([name]) => name),
    ['sudo'],
  );
});

test('분석기: 모르는 옵션에서는 주 해석을 먼저 내고 뒤의 낱말에서 시작하는 후보를 그 뒤에 낸다(8개까지)', () => {
  assert.deepEqual(parsed('nice --unknown 5 git status'), [
    ['5', 'git', 'status'],
    ['git', 'status'],
    ['status'],
  ]);
  const many = parsed('nice --unknown a b c d e f g h i j');
  assert.deepEqual(many[0], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
  assert.deepEqual(
    many.slice(1).map((a) => a[0]),
    ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
    '후보는 8개다',
  );
  // `-`로 시작하는 낱말에서는 후보를 내지 않는다
  assert.deepEqual(parsed('nice --unknown 5 git -C x status'), [
    ['5', 'git', '-C', 'x', 'status'],
    ['git', '-C', 'x', 'status'],
    ['x', 'status'],
    ['status'],
  ]);
  // 후보 안의 래퍼도 같은 방식으로 읽는다
  assert.deepEqual(parsed('nice --unknown 5 sudo -u someone git status').slice(0, 2), [
    ['5', 'sudo', '-u', 'someone', 'git', 'status'],
    ['git', 'status'],
  ]);
});

test('읽지 못한 표시(incomplete)는 닫는 꼴·유지하는 꼴·허용의 어느 호출에도 없다', () => {
  for (const [, wrap] of [...CLOSE, ...UNSURE, ...KEEP])
    for (const c of parseShell(wrap('git status'))) assert.equal(c.incomplete, undefined);
  for (const command of ALLOW)
    for (const c of parseShell(command)) assert.equal(c.incomplete, undefined, command);
});

test('분석기: 래퍼뿐인 조각은 명령을 내지 않는다', () => {
  for (const command of ['nice -n 5', 'sudo -u someone', 'timeout -s KILL 5', 'nice -n', 'nice'])
    assert.deepEqual(parsed(command), [], command);
});

test('skipWrapperOptions: 표대로 옵션과 값, 자리 인자를 건너뛴다', () => {
  const skip = (command: string) => {
    const words = command.split(' ');
    return skipWrapperOptions(words[0], words, 1);
  };
  const cases: [command: string, next: number, unsure: boolean][] = [
    // `--`는 건너뛰고 옵션 읽기를 끝낸다
    ['nice -- git status', 2, false],
    ['nice -n 5 -- -x', 4, false],
    // 값이 붙은 긴 옵션(이름을 몰라도 한 낱말이다)
    ['nice --adjustment=5 git', 2, false],
    ['nice --whatever=5 git', 2, false],
    // 값을 띄어 쓴 긴 옵션
    ['nice --adjustment 5 git', 3, false],
    ['sudo --user someone git', 3, false],
    // 값을 받지 않는 긴 옵션
    ['sudo --login git', 2, false],
    // 모르는 긴 옵션
    ['nice --whatever 5 git', 2, true],
    // 숫자 옵션
    ['nice -10 git', 2, false],
    ['sudo -10 git', 2, true],
    // 묶은 짧은 옵션: 값 글자가 끝에 있으면 다음 낱말이 값이다
    ['sudo -iu someone git', 3, false],
    ['sudo -u someone git', 3, false],
    // 값 글자가 가운데 있으면 나머지 글자가 값이다
    ['sudo -usomeone git', 2, false],
    ['sudo -iusomeone git', 2, false],
    // 값을 받지 않는 글자뿐
    ['sudo -En git', 2, false],
    // 모르는 글자
    ['sudo -Z someone git', 2, true],
    ['sudo -iZ someone git', 2, true],
    // `-` 하나뿐인 낱말과 `-`로 시작하지 않는 낱말에서 옵션 읽기를 끝낸다
    ['sudo - git', 1, false],
    ['sudo git -u x', 1, false],
    // 자리 인자
    ['timeout 5 git', 2, false],
    ['timeout -s KILL 5 git', 4, false],
    ['timeout -s KILL -k 1 5 git', 6, false],
    ['timeout --signal=KILL 5 git', 3, false],
    ['chrt -f 10 git', 3, false],
    ['taskset 0x1 git', 2, false],
    ['timeout', 1, false],
    // 값이 있어야 하는데 낱말이 없으면 끝까지 건너뛴다
    ['nice -n', 2, false],
    ['sudo --user', 2, false],
    // 글자 그대로 견주는 옵션 낱말
    ['arch -arm64 git', 2, false],
    ['arch -arch arm64 git', 3, false],
    ['arch -e A=1 -x86_64 git', 4, false],
    ['arch -whatever git', 2, true],
    // 값을 붙여 써야만 받는 옵션: 낱말의 끝에 오면 모르는 옵션처럼 다룬다
    ['xargs -i {} git', 2, true],
    ['xargs -i{} git', 2, false],
    ['xargs -0 -n 1 git', 4, false],
    ['xargs -I {} git', 3, false],
  ];
  for (const [command, next, unsure] of cases)
    assert.deepEqual(skip(command), { next, unsure }, command);
});

test('옵션 표: 한 래퍼에서 같은 옵션이 값을 받는 쪽과 받지 않는 쪽에 함께 있지 않다', () => {
  for (const name of [
    'sudo',
    'doas',
    'nice',
    'gnice',
    'ionice',
    'exec',
    'command',
    'builtin',
    'nohup',
    'time',
    'timeout',
    'gtimeout',
    'xargs',
    'gxargs',
    'stdbuf',
    'gstdbuf',
    'setsid',
    'caffeinate',
    'arch',
    'chrt',
    'taskset',
    'unbuffer',
  ])
    assert.ok(WRAPPER_OPTIONS.has(name), name);
  for (const [name, spec] of WRAPPER_OPTIONS) {
    const values = new Set(spec.values ?? '');
    for (const ch of spec.flags ?? '') assert.ok(!values.has(ch), `${name}: -${ch}`);
    for (const ch of spec.attached ?? '') assert.ok(values.has(ch), `${name}: -${ch}`);
    const longValues = new Set(spec.longValues ?? []);
    for (const long of spec.longFlags ?? []) assert.ok(!longValues.has(long), `${name}: --${long}`);
    const wordValues = new Set(spec.wordValues ?? []);
    for (const w of spec.words ?? []) assert.ok(!wordValues.has(w), `${name}: ${w}`);
  }
});

test('검사 순서 규칙(R4): 래퍼의 옵션에 따라 판정이 달라지지 않는다', () => {
  const CHECK = 'node scripts/harness.ts check';
  const PUSH = 'git push origin x';
  // 뒤 명령 앞의 래퍼
  assert.equal(rule(`${CHECK}; nice ${PUSH}`), 'R4');
  for (const wrapper of ['nice -n 5', 'sudo -u someone', 'timeout -s KILL 5', 'stdbuf -o L'])
    assert.equal(rule(`${CHECK}; ${wrapper} ${PUSH}`), 'R4', wrapper);
  assert.equal(rule(`${CHECK} && nice -n 5 ${PUSH}`), rule(`${CHECK} && nice ${PUSH}`));
  // 검사 명령 앞의 래퍼
  assert.equal(rule(`nice ${CHECK}; ${PUSH}`), 'R4');
  assert.equal(rule(`nice -n 5 ${CHECK}; ${PUSH}`), 'R4');
  assert.equal(rule(`nice -n 5 ${CHECK} && ${PUSH}`), rule(`nice ${CHECK} && ${PUSH}`));
  // 모르는 옵션: 후보도 순서의 그 자리에서 본다
  assert.equal(rule(`${CHECK} && nice --unknown 5 ${PUSH}`), rule(`${CHECK} && nice ${PUSH}`));
  assert.equal(rule(`${CHECK}; nice --unknown 5 ${PUSH}`), 'R4');
  assert.equal(rule(`nice --unknown 5 ${CHECK}; ${PUSH}`), 'R4');
  assert.equal(rule(`nice --unknown 5 ${CHECK} | tail`), 'R4');
  // env -S: 문자열을 읽지 않는다. 이음 연산자와 무관하게 읽지 못한 명령으로 막힌다
  assert.equal(rule(`${CHECK}; env -S "${PUSH}"`), 'R4');
  assert.equal(rule(`${CHECK} && env -S "${PUSH}"`), 'R4');
  assert.equal(rule(`env -S "${CHECK}" && ${PUSH}`), 'R4');
  assert.equal(rule(`env -S "${CHECK}" | tail`), 'R4');
  // env의 할당 뒤: 실제로 실행되는 명령만 그 자리의 명령이다. `-i`라는 이름의 명령일 뿐이면 push도 검사도 실행되지 않는다
  assert.equal(rule(`${CHECK}; env A=1 -i ${PUSH}`), null);
  assert.equal(rule(`env A=1 -i ${CHECK} | tail`), null);
  // 구현마다 갈리는 꼴은 이음 연산자와 무관하게 읽지 못한 명령으로 막힌다
  assert.equal(rule(`${CHECK}; env A=1 - ${PUSH}`), 'R4');
  assert.equal(rule(`${CHECK} && env A=1 - ${PUSH}`), 'R4');
  assert.equal(rule(`${CHECK} && env A=1 -S "${PUSH}"`), 'R4');
  assert.equal(rule(`env A=1 - ${CHECK} | tail`), 'R4');
});

test('parseSequence: 후보는 그 자리의 alts로 낸다. 후보가 없으면 alts가 없다', () => {
  const words = (c: { argv: string[]; args?: string[] }) => c.args ?? c.argv;
  const seq = parseSequence('true; nice --unknown 5 git status && nice -n 5 echo x');
  assert.equal(seq.length, 3);
  assert.equal(seq[0].alts, undefined);
  assert.deepEqual(words(seq[1].cmd), ['5', 'git', 'status']);
  assert.deepEqual(seq[1].alts?.map(words), [['git', 'status'], ['status']]);
  assert.equal(seq[1].next, '&&');
  assert.deepEqual(words(seq[2].cmd), ['echo', 'x']);
  assert.equal(seq[2].alts, undefined);
});

// ---------- 실제 실행 대조 ----------

/** 실제로 돌려 보는 래퍼: 권한이나 시스템 상태를 건드리지 않는다. sudo·doas·ionice·chrt·taskset·setsid는 돌리지 않는다 */
const RUNNABLE = new Set([
  'nice',
  'gnice',
  'env',
  'genv',
  'nohup',
  'command',
  'exec',
  'time',
  'timeout',
  'gtimeout',
  'stdbuf',
  'gstdbuf',
  'caffeinate',
  'arch',
  'unbuffer',
  'xargs',
  'gxargs',
]);
/** 틀에 든 래퍼의 이름들 */
const wrappersOf = (command: string): string[] =>
  command
    .split(/[\s;"&]+/)
    .map((w) => w.split('/').pop()!.toLowerCase())
    .filter((w) => w === 'env' || w === 'genv' || WRAPPER_OPTIONS.has(w));

/** 인자의 경계를 보는 사례. `T`가 tool의 절대 경로의 자리다. tool이 받은 인자 배열과 분석기의 첫 명령이 통째로 같아야 한다 */
const BOUNDARY = [
  `nice -n 5 T 'a b' ''`,
  `env -i T 'a b' ''`,
  // 할당: 이름이 셸의 식별자가 아니다
  `env BUILD-MODE=local T a`,
];
/** 구현마다 다를 수 있는 꼴: tool이 실행된 머신에서만 받은 인자와 분석기의 첫 명령을 견준다 */
const VARIES = [
  `env -- T a`,
  `env -i -- A-B=1 T a`,
  `env -- -x=1 T a`,
  `env =x T a`,
  `env A=1 -x=1 T a`,
  `env - T a`,
  `env - A=1 T a`,
  `env -i - T a`,
  `env T -S 'a b'`,
  `env A=1 T -S 'a b'`,
  `env -uSHELL T a`,
  `env -iuS T a`,
];
/** 실행되지 않는 꼴: 통과로 읽는 꼴의 전제(tool이 아니라 그 이름의 실행 파일이 뒤의 낱말을 그대로 받는다)를 그 머신에서 확인한다 */
const NEVER_RUNS = [
  `env A=1 -i T a`,
  `env A=1 -u HOME T a`,
  `env A=1 -- T a`,
  `env A=1 --split 'T a'`,
  `env -- -x T a`,
  `env -- -S 'T a'`,
  `env -- A=1 -S 'T a'`,
  `env A=1 -i T log -S x`,
];
/** 이름이 `-`로 시작하는 가짜 실행 파일 */
const FAKES = ['-i', '-u', '--', '-x', '-S', '-', '--split'];

test('실제 실행 대조: 래퍼가 tool을 실행하는 꼴에서는 분석기도 그 명령을 낸다', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX 셸이 필요하다');
    return;
  }
  const bin = tmp('harness-wrapper-options-bin-');
  const tool = path.join(bin, 'tool');
  const out = path.join(bin, 'argv.out');
  // 경로를 명령과 스크립트에 그대로 적는다: 셸이 달리 읽는 글자가 없어야 한다
  assert.match(bin, /^[A-Za-z0-9_./-]+$/, '임시 폴더의 경로');
  // 받은 인자의 수와 인자를 NUL로 구분해 적는다. PATH와 환경 변수에 기대지 않는다(env -i로 환경을 비워도 돈다)
  writeFileSync(tool, `#!/bin/sh\nprintf '%s\\0' "$#" "$@" > '${out}'\n`);
  chmodSync(tool, 0o755);
  const PATH = process.env.PATH ?? '';
  const present = new Map<string, boolean>();
  const has = (name: string): boolean => {
    if (!present.has(name)) {
      const r = spawnSync('bash', ['-c', `command -v ${name}`], {
        encoding: 'utf8',
        env: { PATH },
      });
      present.set(name, r.status === 0);
    }
    return present.get(name)!;
  };
  /** 명령을 돌린 결과: tool이 받은 인자 배열(실행되지 않았으면 null), 종료 코드, 표준 오류 */
  const exec = (cmd: string): { argv: string[] | null; status: number | null; stderr: string } => {
    writeFileSync(out, '');
    const r = spawnSync('bash', ['-c', cmd], {
      cwd: tmp('harness-wrapper-options-'),
      encoding: 'utf8',
      input: '\n',
      timeout: 20_000,
      // 오류 문구가 로캘에 따라 바뀌지 않게 한다
      env: { PATH, LC_ALL: 'C' },
    });
    const raw = readFileSync(out, 'utf8');
    const parts = raw.split('\0');
    return {
      argv: raw === '' ? null : [tool, ...parts.slice(1, 1 + Number(parts[0]))],
      status: r.status,
      stderr: r.stderr ?? '',
    };
  };
  const run = (cmd: string): string[] | null => exec(cmd).argv;
  // 준비: tool을 래퍼 없이 돌리면 받은 인자를 적는다. 준비의 실패를 래퍼의 탓으로 읽지 않는다
  assert.deepEqual(run(`${tool} direct`), [tool, 'direct'], 'tool이 실행돼 인자를 적어야 한다');
  assert.ok(has('env'), 'env가 있어야 한다');

  const call = `${tool} a b`;
  const want3 = JSON.stringify([tool, 'a', 'b']);
  let compared = 0;
  let skipped = 0;
  const diffs: string[] = [];
  // 모르는 옵션의 틀(UNSURE)은 돌리지 않는다: 후보는 실제 실행과 견줄 해석이 아니다
  for (const [name, wrap] of [...CLOSE, ...KEEP]) {
    const cmd = wrap(call);
    const used = wrappersOf(cmd);
    if (!used.length || !used.every((w) => RUNNABLE.has(w) && has(w))) {
      skipped += 1;
      continue;
    }
    const real = run(cmd);
    // 래퍼가 tool을 실행하지 않은 꼴(그 옵션을 모르는 구현, 없는 파일)은 견줄 것이 없다
    if (real === null) {
      skipped += 1;
      continue;
    }
    // xargs는 입력에서 읽은 인자를 뒤에 더할 수 있다: 앞의 인자가 같은지 본다
    const got = used.some((w) => w.endsWith('xargs')) ? real.slice(0, 3) : real;
    if (JSON.stringify(got) !== want3) {
      skipped += 1;
      continue;
    }
    compared += 1;
    // 이 틀들에는 모르는 옵션이 없어 후보가 없다: 낸 명령은 모두 어느 조각의 주 해석이다
    const ours = parseShell(cmd).map((c) => c.args ?? c.argv);
    if (!ours.some((a) => JSON.stringify(a) === want3))
      diffs.push(`[${name}] ${JSON.stringify(cmd)}: 훅 ${JSON.stringify(ours)}`);
  }
  // 인자의 경계: 첫 명령이 통째로 같다
  let boundary = 0;
  /** tool이 실행되지 않은 사례(건너뛰지 않는다: 실패다). 그 머신의 래퍼가 낸 종료 코드와 오류를 함께 적는다 */
  const notRun: string[] = [];
  for (const shape of BOUNDARY) {
    const cmd = shape.replace('T', () => tool);
    if (!wrappersOf(cmd).every((w) => has(w))) continue;
    const r = exec(cmd);
    const real = r.argv;
    if (real === null) {
      notRun.push(`${shape}: 종료 코드 ${r.status}, ${r.stderr.trim()}`);
      continue;
    }
    boundary += 1;
    const first = parseShell(cmd)[0];
    const ours = first ? (first.args ?? first.argv) : null;
    if (JSON.stringify(ours) !== JSON.stringify(real))
      diffs.push(`[경계] ${shape}: 실제 ${JSON.stringify(real)} / 훅 ${JSON.stringify(ours)}`);
  }
  // 이름이 `-`로 시작하는 가짜 실행 파일: 제 이름과 받은 인자를 둘째 결과 파일에 적는다.
  // env는 할당이나 `--` 뒤의 `-` 낱말을 실행 파일 이름으로 찾는다. tool만 보면 다른 실행 파일이 실행된 것과 인자가 달라진 것을 놓친다
  const dashBin = tmp('harness-wrapper-options-dash-');
  const dashOut = path.join(dashBin, 'argv.out');
  assert.match(dashBin, /^[A-Za-z0-9_./-]+$/, '임시 폴더의 경로');
  for (const name of FAKES) {
    const file = path.join(dashBin, name);
    writeFileSync(file, `#!/bin/sh\nprintf '%s\\0' '${name}' "$#" "$@" > '${dashOut}'\n`);
    chmodSync(file, 0o755);
  }
  /** 가짜 실행 파일의 폴더를 PATH의 맨 앞에 두고 돌린다. 실행된 것(tool이나 가짜 실행 파일)의 이름과 인자. 없으면 null */
  const execEnv = (cmd: string): { ran: string[] | null; status: number | null } => {
    writeFileSync(out, '');
    writeFileSync(dashOut, '');
    const r = spawnSync('bash', ['-c', cmd], {
      cwd: tmp('harness-wrapper-options-'),
      encoding: 'utf8',
      input: '\n',
      timeout: 20_000,
      env: { PATH: `${dashBin}:${PATH}`, LC_ALL: 'C' },
    });
    const viaTool = readFileSync(out, 'utf8').split('\0');
    const viaDash = readFileSync(dashOut, 'utf8').split('\0');
    let ran: string[] | null = null;
    if (viaDash[0] !== '') ran = [viaDash[0], ...viaDash.slice(2, 2 + Number(viaDash[1]))];
    else if (viaTool[0] !== '') ran = [tool, ...viaTool.slice(1, 1 + Number(viaTool[0]))];
    return { ran, status: r.status };
  };
  /** 공통 단언: 실행된 것이 있으면 훅이 그 호출을 막았거나 분석기가 낸 명령 가운데 그 이름과 인자 전체가 통째로 같은 것이 있다 */
  const sound = (cmd: string, ran: string[] | null): void => {
    if (ran === null || rule(cmd) !== null) return;
    const ours = parseShell(cmd).map((c) => JSON.stringify(c.args ?? c.argv));
    assert.ok(
      ours.includes(JSON.stringify(ran)),
      `${cmd}: 실제 ${JSON.stringify(ran)} / 훅 ${ours.join(' ')}`,
    );
  };
  // 구현마다 갈리는 꼴 가운데 읽는 것: 실행된 머신에서만 견준다
  let varied = 0;
  for (const shape of VARIES) {
    const cmd = shape.replace('T', () => tool);
    const r = execEnv(cmd);
    if (r.ran === null) {
      t.diagnostic(`실행되지 않아 견주지 않는다: ${shape}(종료 코드 ${r.status})`);
      continue;
    }
    varied += 1;
    const first = parseShell(cmd)[0];
    const ours = first ? (first.args ?? first.argv) : null;
    if (JSON.stringify(ours) !== JSON.stringify(r.ran))
      diffs.push(`[구현마다] ${shape}: 실제 ${JSON.stringify(r.ran)} / 훅 ${JSON.stringify(ours)}`);
    sound(cmd, r.ran);
  }
  assert.ok(varied >= 1, '구현마다 갈리는 꼴 가운데 견준 사례가 하나도 없다');
  // 실행되지 않는 꼴: tool이 실행되지 않고, 그 이름의 가짜 실행 파일이 뒤의 낱말을 그대로 받는다. 받은 것이 훅이 읽은 명령과 통째로 같다.
  // 어긋나는 머신이 있으면 그 구현에서는 이 꼴이 다른 것을 실행한다는 뜻이다(계획으로 돌아간다)
  for (const shape of NEVER_RUNS) {
    const cmd = shape.replace('T', () => tool);
    const r = execEnv(cmd);
    assert.ok(r.ran !== null, `${shape}: 실행된 것이 없다(종료 코드 ${r.status})`);
    assert.notEqual(r.ran[0], tool, `${shape}: tool이 실행됐다 ${JSON.stringify(r.ran)}`);
    const first = parseShell(cmd)[0];
    assert.deepEqual(first.args ?? first.argv, r.ran, shape);
    assert.equal(rule(cmd), null, shape);
    sound(cmd, r.ran);
  }
  // 읽지 못한 꼴: 실행 여부와 무관하게 훅이 막는다. 실행된 사례의 수는 구현에 따라 실제로 무엇인가 실행되는 꼴을 막고 있다는 근거다
  {
    let ranUnreadable = 0;
    for (const [name, wrap] of UNREADABLE) {
      const cmd = wrap(`${tool} a`);
      assert.equal(rule(cmd), 'R4', `[${name}] ${cmd}`);
      const r = execEnv(cmd);
      if (r.ran !== null) ranUnreadable += 1;
      sound(cmd, r.ran);
    }
    // -S의 문자열 안에 따옴표 밖의 줄바꿈이 든 꼴: 구현에 따라 tool이 받는 인자의 경계가 다를 수 있다. 무엇이 실행됐든 훅이 막는다
    {
      const cmd = `env -S '${tool} a\nb'`;
      assert.equal(rule(cmd), 'R4', JSON.stringify(cmd));
      const r = execEnv(cmd);
      if (r.ran !== null)
        t.diagnostic(`줄바꿈이 든 -S 문자열로 실행된 것: ${JSON.stringify(r.ran)}`);
      sound(cmd, r.ran);
    }
    t.diagnostic(
      `읽지 못한 꼴 ${UNREADABLE.length}개 가운데 이 머신에서 실행된 것이 있는 꼴 ${ranUnreadable}개`,
    );
  }
  if (notRun.length) {
    const version = spawnSync('env', ['--version'], {
      encoding: 'utf8',
      env: { PATH, LC_ALL: 'C' },
    });
    const which = (version.stdout ?? '').split('\n')[0] || '(env --version이 버전을 내지 않는다)';
    assert.fail(
      `tool이 실행되지 않은 사례 ${notRun.length}개(env: ${which}):\n${notRun.join('\n')}`,
    );
  }
  t.diagnostic(
    `대조한 틀 ${compared}개, 건너뛴 틀 ${skipped}개, 경계 사례 ${boundary}개, 구현마다 다를 수 있는 사례 ${varied}개`,
  );
  assert.deepEqual(diffs, []);
  assert.ok(compared >= 1, '대조한 틀이 하나도 없다');
});

// ---------- 입력 길이에 비례하는가 ----------

/** 입력의 꼴 여덟 */
const SHAPES: [name: string, make: (n: number) => string][] = [
  [
    'nice 뒤에 모르는 옵션 n개와 낱말 n개',
    (n) => `nice ${'--unknown '.repeat(n)}${'w '.repeat(n)}`,
  ],
  ['sudo -u a를 n번 겹친 것', (n) => `${'sudo -u a '.repeat(n)}git status`],
  ['nice --unknown 5를 n번 겹친 것', (n) => `${'nice --unknown 5 '.repeat(n)}git status`],
  ['env 뒤에 -S -i를 n번 쓴 것', (n) => `env ${'-S -i '.repeat(n)}`],
  ['timeout -s KILL 5를 n번 겹친 것', (n) => `${'timeout -s KILL 5 '.repeat(n)}git status`],
  ['-S를 n번 붙여 쓴 낱말 하나', (n) => `env ${'-S'.repeat(n)}x`],
  // 할당 뒤에 옵션 읽기를 이어 가는 입력
  ['sudo 뒤에 A=1 -u a를 n번 쓴 것', (n) => `sudo ${'A=1 -u a '.repeat(n)}git status`],
  // uutils의 훑기가 명령 이름(`env`)을 지나쳐 끝까지 가는 꼴을 겹친 것: env마다 다시 훑으면 제곱으로 는다
  ['env -uXa를 n번 겹친 것', (n) => `${'env -uXa '.repeat(n)}git status`],
];

test('읽은 낱말 수가 입력의 낱말 수의 상수 배를 넘지 않는다(세 크기)', () => {
  for (const [name, make] of SHAPES)
    for (const n of [2_000, 20_000, 80_000]) {
      const input = make(n);
      const total = input.trim().split(/\s+/).length;
      for (const [what, parse] of [
        ['parseShell', parseShell],
        ['parseSequence', parseSequence],
      ] as const) {
        const before = parseWork.words;
        parse(input);
        const read = parseWork.words - before;
        assert.ok(read <= 50 * total, `${name}, n=${n}, ${what}: ${read}개 읽음 / 낱말 ${total}개`);
      }
    }
});

/**
 * 입력마다 판정에 걸린 시간(ms). 한 번의 측정은 같은 판정을 reps번 되풀이한 합이고, 세 번 재어 가장 짧은 값을 낸다.
 * 자식 프로세스에서 판정하고 시간 제한을 건다. 판정이 예외를 던지면 실패한다
 */
function timeEvaluate(inputs: string[], reps: number[]): number[] {
  const mod = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'rules.ts'),
  ).href;
  const script = `
    import { readFileSync } from 'node:fs';
    const { evaluate } = await import(${JSON.stringify(mod)});
    const ctx = { repo: null, hasPlan: () => true, dbPatterns: [], dbClients: ['psql'], dbCommands: () => [], home: '/Users/someone' };
    const times = [];
    for (const [command, reps] of JSON.parse(readFileSync(0, 'utf8'))) {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        for (let r = 0; r < reps; r++) evaluate({ kind: 'bash', command, cwd: '/work/repo' }, ctx);
        best = Math.min(best, performance.now() - t0);
      }
      times.push(best);
    }
    process.stdout.write(JSON.stringify(times));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 300_000,
    input: JSON.stringify(inputs.map((command, i) => [command, reps[i]])),
  });
  assert.equal(
    r.error,
    undefined,
    `시간 안에 끝나지 않았거나 실행하지 못했다: ${r.error?.message}`,
  );
  assert.equal(r.status, 0, r.stderr);
  const times = JSON.parse(r.stdout) as number[];
  assert.equal(times.length, inputs.length);
  return times;
}

/** 작은 크기의 한 측정이 이만큼(ms)은 걸리게 되풀이한다. 8배가 1초보다 커야 8배 기준이 걸린다(125ms). 재는 오차를 덮게 넉넉히 잡는다 */
const TARGET_MS = 200;
const FLOOR_MS = 125;

test('긴 입력의 판정이 시간 안에 끝나고, 입력을 4배로 늘린 시간이 8배를 넘지 않는다', (t) => {
  const smallInputs = SHAPES.map(([, make]) => make(20_000));
  const largeInputs = SHAPES.map(([, make]) => make(80_000));
  // 한 번의 판정 시간(n=20,000)
  const once = timeEvaluate(
    smallInputs,
    SHAPES.map(() => 1),
  );
  for (const [i, [name]] of SHAPES.entries())
    assert.ok(once[i] < 5_000, `${name}, n=20000: ${once[i]}ms`);
  // 판정 한 번이 짧은 꼴은 재는 오차가 비율을 흔든다. 같은 판정을 되풀이한 합으로 재어 작은 크기의 측정값을 키운다.
  // 큰 크기도 같은 횟수로 잰다: 합의 비율이 판정 한 번의 비율이다
  const reps = once.map((ms) => Math.max(1, Math.ceil(TARGET_MS / Math.max(ms, 0.01))));
  let small = timeEvaluate(smallInputs, reps);
  // 처음 잰 한 번이 느리게 나와 횟수가 모자라면 횟수를 늘려 다시 잰다(세 번까지)
  for (let k = 0; k < 3 && small.some((ms) => ms < FLOOR_MS); k++) {
    for (const [i, ms] of small.entries())
      if (ms < FLOOR_MS) reps[i] = Math.ceil((reps[i] * TARGET_MS) / Math.max(ms, 0.01));
    small = timeEvaluate(smallInputs, reps);
  }
  const large = timeEvaluate(largeInputs, reps);
  for (const [i, [name]] of SHAPES.entries()) {
    // 작은 크기의 측정값이 125ms 이상이면 8배가 1초 이상이다: "8배와 1초 가운데 큰 값"이 언제나 8배다(1초가 기준을 가리지 않는다)
    assert.ok(
      small[i] >= FLOOR_MS,
      `${name}: n=20000을 ${reps[i]}번 되풀이한 측정이 ${small[i]}ms로 너무 짧다`,
    );
    // 선형이면 4배, 제곱이면 16배다
    const limit = Math.max(8 * small[i], 1_000);
    assert.equal(limit, 8 * small[i]);
    assert.ok(
      large[i] <= limit,
      `${name}(${reps[i]}번 되풀이): n=20000 ${small[i]}ms → n=80000 ${large[i]}ms`,
    );
  }
  t.diagnostic(
    `시간 비(n=80000 / n=20000): ${SHAPES.map(([name], i) => `${name} ${(large[i] / small[i]).toFixed(2)}배`).join(', ')}`,
  );
});
