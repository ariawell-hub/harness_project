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
import { WRAPPER_OPTIONS, skipWrapperOptions, splitEnvString } from '../hooks/wrappers.ts';
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
  ].map(prefix),
  ['env -S "C"', (c) => `env -S "${c}"`],
  ['env --split-string="C"', (c) => `env --split-string="${c}"`],
  ['env --split-string "C"', (c) => `env --split-string "${c}"`],
  ['env -S "이름" 나머지', (c) => `env -S "${head(c)}" ${rest(c)}`],
  ['env -i -S "C"', (c) => `env -i -S "${c}"`],
  // 네 번째 문자열 안의 금지 호출
  ['env -S -i -S -i -S -i -S "C"', (c) => `env -S -i -S -i -S -i -S "${c}"`],
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
];

/** 닫는 꼴 가운데 표에 없는 옵션이 든 것: 뒤의 낱말에서 시작하는 후보로 막힌다 */
const UNSURE: Frame[] = [
  'nice --unknown 5 C',
  'sudo --unknown someone C',
  'sudo -Z someone C',
  'timeout --unknown x 5 C',
  'stdbuf -Z x C',
  'env --unknown x C',
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
  'env -S "node -v"',
  'stdbuf -o L cat file.txt',
  'caffeinate -i node scripts/harness.ts test',
  'arch -arm64 node -v',
  'chrt -f 10 node -v',
  'taskset -c 0 node -v',
  // 모르는 옵션이 있어도 뒤에 금지 호출이 없으면 통과한다
  'nice --unknown 5 node -v',
  'sudo --unknown someone git status',
  // -S 네 번까지는 읽는다
  'env -S -i -S -i -S -i -S "git status"',
  'env -S-S-S-S"git status"',
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

test('닫는 꼴: 값을 받는 옵션이 붙은 래퍼, 새 래퍼, env -S, 겹친 래퍼로 감싸도 같은 규칙으로 막힌다', () => {
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

test('분석기: env -S의 문자열은 env의 규칙으로 낱말로 나눠 그 자리의 명령으로 읽는다', () => {
  const TAB = '\t';
  const cases: [command: string, want: string[]][] = [
    ['env -S "git status" --short', ['git', 'status', '--short']],
    // 뒤 인자의 경계
    [`env -S 'tool' 'a b'`, ['tool', 'a b']],
    // 빈 인자
    [`env -S "tool a" '' b`, ['tool', 'a', '', 'b']],
    // 문자열 안의 따옴표
    [`env -S 'tool "a b"' c`, ['tool', 'a b', 'c']],
    // 셸의 연산자는 문자열 안에서 연산자가 아니다
    ['env -S "git status; echo x"', ['git', 'status;', 'echo', 'x']],
    // 주석
    ['env -S "git status # x" y', ['git', 'status', 'y']],
    [`env -S 'git\\_status'`, ['git', 'status']],
    // 겹친 -S, 붙여 쓴 꼴, 긴 옵션
    [`env -S "-S 'git status'"`, ['git', 'status']],
    ['env -S"git status"', ['git', 'status']],
    ['env --split-string="git status"', ['git', 'status']],
    ['env --split-string "git status"', ['git', 'status']],
    // 이스케이프
    [`env -S 'tool "a\\tb"'`, ['tool', `a${TAB}b`]],
    [`env -S 'tool a\\tb'`, ['tool', `a${TAB}b`]],
    [`env -S "tool 'a\\tb'"`, ['tool', 'a\\tb']],
    [`env -S 'tool \\#a "b\\"c" \\$d'`, ['tool', '#a', 'b"c', '$d']],
    [`env -S 'tool a\\cb c'`, ['tool', 'a']],
    // 네 번까지 나눈다
    ['env -S -i -S -i -S -i -S "git status"', ['git', 'status']],
    ['env -S-S-S-S"git status"', ['git', 'status']],
  ];
  for (const [command, want] of cases) {
    const cmds = parseShell(command);
    assert.deepEqual(
      cmds.map((c) => c.args ?? c.argv),
      [want],
      command,
    );
    assert.equal(cmds[0].incomplete, undefined, command);
  }
  // 문자열 안의 옵션과 할당
  for (const command of ['env -S "-i A=1 git status"', 'env -iS "A=1 git status"']) {
    const cmds = parseShell(command);
    assert.deepEqual(
      cmds.map((c) => c.args ?? c.argv),
      [['git', 'status']],
      command,
    );
    assert.equal(cmds[0].assigns.A, '1', command);
  }
});

test('env -S가 다섯 번 넘게 겹치면 끝까지 읽지 못한 명령으로 표시하고 R4로 막는다', () => {
  for (const command of [
    'env -S -i -S -i -S -i -S -i -S "git status"',
    'env -S-S-S-S-S"git status"',
    'env -S -i -S -i -S -i -S -i -S "tool a"',
  ]) {
    assert.ok(
      parseShell(command).some((c) => c.incomplete === true),
      command,
    );
    assert.equal(rule(command), 'R4', command);
  }
  // 금지 호출을 다섯 번째 문자열에 넣은 꼴도 모두 막힌다
  for (const [call] of CALLS) {
    const command = `env -S -i -S -i -S -i -S -i -S "${call}"`;
    assert.notEqual(rule(command), null, command);
  }
  // 그 밖의 명령에는 표시가 없다
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

test('splitEnvString: env가 문자열을 인자로 나누는 규칙', () => {
  const cases: [text: string, want: string[]][] = [
    // 공백 글자에서 나눈다
    ['a b\tc\nd', ['a', 'b', 'c', 'd']],
    ['  a   b  ', ['a', 'b']],
    ['a\rb\vc\fd', ['a', 'b', 'c', 'd']],
    // 따옴표
    [`a 'b c' d`, ['a', 'b c', 'd']],
    ['a "b c" d', ['a', 'b c', 'd']],
    [`a '' "" b`, ['a', '', '', 'b']],
    ['a"b c"d', ['ab cd']],
    [`a "b'c" 'd"e'`, ['a', "b'c", 'd"e']],
    // 제어 문자 이스케이프(따옴표 밖과 큰따옴표 안)
    ['a\\fb a\\nb a\\rb a\\tb a\\vb', ['a\fb', 'a\nb', 'a\rb', 'a\tb', 'a\vb']],
    ['"a\\fb" "a\\nb" "a\\rb" "a\\tb" "a\\vb"', ['a\fb', 'a\nb', 'a\rb', 'a\tb', 'a\vb']],
    // 글자 이스케이프
    [`\\#a \\$b c\\"d e\\'f g\\\\h`, ['#a', '$b', 'c"d', "e'f", 'g\\h']],
    ['"\\#a" "\\$b" "c\\"d" "g\\\\h"', ['#a', '$b', 'c"d', 'g\\h']],
    // `\_`: 따옴표 밖에서는 나누고 큰따옴표 안에서는 공백이다
    ['a\\_b', ['a', 'b']],
    ['"a\\_b"', ['a b']],
    // `\c`: 읽기를 끝낸다. 그때까지의 낱말은 남는다
    ['a b\\cc d', ['a', 'b']],
    ['a \\c b', ['a']],
    // 정해지지 않은 이스케이프: 백슬래시를 떼고 그 글자를 둔다
    ['a\\qb', ['aqb']],
    // 작은따옴표 안의 백슬래시
    [`'a\\'b' 'c\\\\d' 'e\\tf' 'g\\_h'`, ["a'b", 'c\\d', 'e\\tf', 'g\\_h']],
    // 주석
    ['a #b c', ['a']],
    ['#a b', []],
    ['a#b c', ['a#b', 'c']],
    ['a "#b" c', ['a', '#b', 'c']],
    // 닫히지 않은 따옴표
    ['a "b c', ['a', 'b c']],
    [`a 'b c`, ['a', 'b c']],
    // 풀지 않는 것
    ['a ${HOME} $b', ['a', '${HOME}', '$b']],
    // 빈 문자열, 문자열 끝의 백슬래시
    ['', []],
    ['   ', []],
    ['a\\', ['a\\']],
  ];
  for (const [text, want] of cases)
    assert.deepEqual(splitEnvString(text), want, JSON.stringify(text));
});

test('검사 순서 규칙(R4): 래퍼의 옵션에 따라 판정이 달라지지 않는다', () => {
  const CHECK = 'node scripts/harness.ts check';
  const PUSH = 'git push origin x';
  const plain = rule(`${CHECK} && ${PUSH}`);
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
  // env -S: 문자열 안의 명령이 그 자리의 명령이다
  assert.equal(rule(`${CHECK}; env -S "${PUSH}"`), 'R4');
  assert.equal(rule(`${CHECK} && env -S "${PUSH}"`), plain);
  assert.equal(rule(`env -S "${CHECK}"; ${PUSH}`), 'R4');
  assert.equal(rule(`env -S "${CHECK}" && ${PUSH}`), plain);
  assert.equal(rule(`env -S "${CHECK}"; env -S "${PUSH}"`), 'R4');
  assert.equal(rule(`env -S "${CHECK}" && env -S "${PUSH}"`), plain);
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
  // env -S의 명령은 그 자리의 주 해석이다
  const s = parseSequence('env -S "git push origin x"; true');
  assert.deepEqual(words(s[0].cmd), ['git', 'push', 'origin', 'x']);
  assert.equal(s[0].alts, undefined);
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
  `env -S 'T' 'a b'`,
  `env -S "T a" '' b`,
  `env -S 'T "a b"' c`,
  `env -S 'T a; b'`,
  `env -S 'T a # b' c`,
  `env -S '-i T a'`,
  `nice -n 5 T 'a b' ''`,
  // 이스케이프
  `env -S 'T "a\\tb"'`,
  `env -S 'T a\\tb'`,
  `env -S "T 'a\\tb'"`,
  `env -S 'T "a\\nb" c\\_d "e\\_f"'`,
  `env -S 'T \\#a "b\\"c" \\$d'`,
  `env -S 'T a\\cb c'`,
  // 네 번 나눈다
  `env -S -i -S -i -S -i -S 'T a'`,
];

test('실제 실행 대조: 래퍼가 tool을 실행하는 꼴에서는 분석기도 그 명령을 낸다', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX 셸이 필요하다');
    return;
  }
  const bin = tmp('harness-wrapper-options-bin-');
  const tool = path.join(bin, 'tool');
  const out = path.join(bin, 'argv.out');
  // 경로를 명령과 스크립트에 그대로 적는다: 셸이나 env -S가 달리 읽는 글자가 없어야 한다
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
  // 준비: tool을 래퍼 없이 돌리면 받은 인자를 적는다. 준비의 실패를 "-S를 모른다"로 읽지 않는다
  assert.deepEqual(run(`${tool} direct`), [tool, 'direct'], 'tool이 실행돼 인자를 적어야 한다');
  // 이 머신의 env가 -S를 아는가: 모른다고 보는 것은 env가 옵션을 모른다는 오류를 낸 때뿐이다
  assert.ok(has('env'), 'env가 있어야 한다');
  const probe = exec(`env -S '${tool} probe'`);
  const unknownOption =
    probe.argv === null &&
    probe.status !== 0 &&
    /invalid option|illegal option|unrecognized option/i.test(probe.stderr);
  if (!unknownOption)
    assert.deepEqual(
      probe.argv,
      [tool, 'probe'],
      `env -S로 tool이 실행되지 않았다(종료 코드 ${probe.status}): ${probe.stderr}`,
    );
  const splits = !unknownOption;
  if (!splits) t.diagnostic('이 머신의 env는 -S를 모른다: -S가 든 틀과 사례를 건너뛴다');
  const usesSplit = (cmd: string) => /(^|\s)(-[A-Za-z0-9]*S|--split-string)/.test(cmd);

  const call = `${tool} a b`;
  const want3 = JSON.stringify([tool, 'a', 'b']);
  let compared = 0;
  let skipped = 0;
  const diffs: string[] = [];
  // 모르는 옵션의 틀(UNSURE)은 돌리지 않는다: 후보는 실제 실행과 견줄 해석이 아니다
  for (const [name, wrap] of [...CLOSE, ...KEEP]) {
    const cmd = wrap(call);
    const used = wrappersOf(cmd);
    if (
      !used.length ||
      !used.every((w) => RUNNABLE.has(w) && has(w)) ||
      (usesSplit(cmd) && !splits)
    ) {
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
  /** -S를 아는 머신에서 tool이 실행되지 않은 사례(건너뛰지 않는다: 실패다). 그 머신의 env가 낸 종료 코드와 오류를 함께 적는다 */
  const notRun: string[] = [];
  for (const shape of BOUNDARY) {
    const cmd = shape.replace('T', () => tool);
    if (usesSplit(cmd) ? !splits : !wrappersOf(cmd).every((w) => has(w))) continue;
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
  // 다섯 번 나누는 꼴: 실제로는 tool이 실행되고, 훅은 그 호출을 막는다
  if (splits) {
    const five = `env -S -i -S -i -S -i -S -i -S '${tool} a'`;
    const r = exec(five);
    if (r.argv === null)
      notRun.push(`다섯 번 나누는 꼴: 종료 코드 ${r.status}, ${r.stderr.trim()}`);
    else assert.deepEqual(r.argv, [tool, 'a']);
    assert.equal(rule(five), 'R4');
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
  t.diagnostic(`대조한 틀 ${compared}개, 건너뛴 틀 ${skipped}개, 경계 사례 ${boundary}개`);
  assert.deepEqual(diffs, []);
  assert.ok(compared >= 1, '대조한 틀이 하나도 없다');
});

// ---------- 입력 길이에 비례하는가 ----------

/** 입력의 꼴 여섯 */
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
 * 입력마다 판정에 걸린 시간(ms. 세 번 재어 가장 짧은 값). 자식 프로세스에서 판정하고 시간 제한을 건다.
 * 판정이 예외를 던지면 실패한다
 */
function timeEvaluate(inputs: string[]): number[] {
  const mod = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'rules.ts'),
  ).href;
  const script = `
    import { readFileSync } from 'node:fs';
    const { evaluate } = await import(${JSON.stringify(mod)});
    const ctx = { repo: null, hasPlan: () => true, dbPatterns: [], dbClients: ['psql'], dbCommands: () => [], home: '/Users/someone' };
    const times = [];
    for (const command of JSON.parse(readFileSync(0, 'utf8'))) {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        evaluate({ kind: 'bash', command, cwd: '/work/repo' }, ctx);
        best = Math.min(best, performance.now() - t0);
      }
      times.push(best);
    }
    process.stdout.write(JSON.stringify(times));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 120_000,
    input: JSON.stringify(inputs),
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

test('긴 입력의 판정이 시간 안에 끝나고, 입력을 4배로 늘린 시간이 8배를 넘지 않는다', () => {
  const small = timeEvaluate(SHAPES.map(([, make]) => make(20_000)));
  const large = timeEvaluate(SHAPES.map(([, make]) => make(80_000)));
  for (const [i, [name]] of SHAPES.entries()) {
    assert.ok(small[i] < 5_000, `${name}, n=20000: ${small[i]}ms`);
    // 선형이면 4배, 제곱이면 16배다. 1초 아래에서는 재는 오차가 비율을 흔들므로 견주지 않는다
    const limit = Math.max(8 * small[i], 1_000);
    assert.ok(large[i] <= limit, `${name}: n=20000 ${small[i]}ms → n=80000 ${large[i]}ms`);
  }
});
