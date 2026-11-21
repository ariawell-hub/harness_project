// L1 훅이 명령의 이름을 찾는 자리(계획 20261121-hook-command-position, Issue #182, TD-62 (3)).
// 명령 이름 앞의 리다이렉션·예약어·zsh 수식어, 이름 뒤에 낀 리다이렉션, 리다이렉션에 붙은 대상 파일을 본다.
// 금지 호출의 글은 판정만 한다(evaluate). 실제 셸로 돌리는 것은 인자를 파일에 적는 가짜 명령 `tool`뿐이다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { parseShell } from '../hooks/shell.ts';
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

/** 금지 호출과, 그대로 썼을 때의 규칙 */
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

type Frame = [name: string, wrap: (call: string) => string];
/** 명령 이름 */
const head = (c: string) => c.slice(0, c.indexOf(' '));
/** 이름 뒤의 인자 */
const rest = (c: string) => c.slice(c.indexOf(' ') + 1);

/** 닫는 꼴: 전에는 이 꼴로 감싸면 규칙이 돌지 않았다 */
const CLOSE: Frame[] = [
  // 이름 앞의 리다이렉션
  ['>/dev/null C', (c) => `>/dev/null ${c}`],
  ['> /dev/null C', (c) => `> /dev/null ${c}`],
  ['2>&1 C', (c) => `2>&1 ${c}`],
  ['</dev/null C', (c) => `</dev/null ${c}`],
  ['&>/dev/null C', (c) => `&>/dev/null ${c}`],
  ['>&2 C', (c) => `>&2 ${c}`],
  ['<<<x C', (c) => `<<<x ${c}`],
  ['2>/dev/null >/dev/null C', (c) => `2>/dev/null >/dev/null ${c}`],
  ['A=1 >/dev/null C', (c) => `A=1 >/dev/null ${c}`],
  ['>/dev/null env C', (c) => `>/dev/null env ${c}`],
  ['env >/dev/null C', (c) => `env >/dev/null ${c}`],
  // bash의 디스크립터 변수(bash 4.1부터 실행한다)
  ['{fd}>/dev/null C', (c) => `{fd}>/dev/null ${c}`],
  // 이름 뒤에 낀 리다이렉션, 이름에 붙은 리다이렉션
  ['이름 >/dev/null 나머지', (c) => `${head(c)} >/dev/null ${rest(c)}`],
  ['이름 2>&1 나머지', (c) => `${head(c)} 2>&1 ${rest(c)}`],
  ['이름 > out 나머지', (c) => `${head(c)} > out ${rest(c)}`],
  ['이름>/dev/null 나머지', (c) => `${head(c)}>/dev/null ${rest(c)}`],
  ['이름> out 나머지', (c) => `${head(c)}> out ${rest(c)}`],
  ['이름 {fd}>/dev/null 나머지', (c) => `${head(c)} {fd}>/dev/null ${rest(c)}`],
  // bash의 예약어
  ['then', (c) => `if true; then ${c}; fi`],
  ['else', (c) => `if false; then :; else ${c}; fi`],
  ['elif', (c) => `if false; then :; elif ${c}; then :; fi`],
  ['for … do', (c) => `for a in b; do ${c}; done`],
  ['while … do', (c) => `while true; do ${c}; break; done`],
  ['until … do', (c) => `until false; do ${c}; break; done`],
  ['select … do', (c) => `select a in b; do ${c}; break; done`],
  ['if 조건 자리', (c) => `if ${c}; then :; fi`],
  ['while 조건 자리', (c) => `while ${c}; do break; done`],
  ['until 조건 자리', (c) => `until ${c}; do break; done`],
  ['!', (c) => `! ${c}`],
  ['coproc', (c) => `coproc ${c}`],
  // 조합
  ['then !', (c) => `if true; then ! ${c}; fi`],
  ['if !', (c) => `if ! ${c}; then :; fi`],
  ['! time', (c) => `! time ${c}`],
  ['time !', (c) => `time ! ${c}`],
  ['else if', (c) => `if false; then :; else if true; then ${c}; fi; fi`],
  ['then >/dev/null', (c) => `if true; then >/dev/null ${c}; fi`],
  ['do 이름 >/dev/null 나머지', (c) => `while :; do ${head(c)} >/dev/null ${rest(c)}; done`],
  // zsh의 명령 앞 수식어와 짧은 꼴
  ['noglob', (c) => `noglob ${c}`],
  ['nocorrect', (c) => `nocorrect ${c}`],
  ['-', (c) => `- ${c}`],
  ['repeat 1', (c) => `repeat 1 ${c}`],
  ['if [[ … ]] C', (c) => `if [[ -n x ]] ${c}`],
  ['while [[ … ]] C', (c) => `while [[ -n x ]] ${c}`],
  ['if [[ x == "]]" ]] C', (c) => `if [[ x == "]]" ]] ${c}`],
  // 따옴표로 묶은 "]]"는 피연산자다. 따옴표 없는 첫 ]]가 조건식의 끝이다
  ['if [[ "]]" == "]]" ]] C', (c) => `if [[ "]]" == "]]" ]] ${c}`],
  // 조건식 안의 연산자는 조건식을 끝내지 않는다
  ['if [[ a && b ]] C', (c) => `if [[ -n x && -n y ]] ${c}`],
  ['if [[ a || b ]] C', (c) => `if [[ -n x || -n y ]] ${c}`],
  ['if [[ ( a ) ]] C', (c) => `if [[ ( -n x ) ]] ${c}`],
  ['if [[ a⏎]] C', (c) => `if [[ -n x\n]] ${c}`],
  ['if ! [[ … ]] C', (c) => `if ! [[ -z x ]] ${c}`],
  ['if true && [[ … ]] C', (c) => `if true && [[ -n y ]] ${c}`],
  ['if [[ … ]] && [[ … ]] C', (c) => `if [[ -n x ]] && [[ -n y ]] ${c}`],
  ['if time [[ … ]] C', (c) => `if time [[ -n x ]] ${c}`],
  ['if [[ … ]] >/dev/null C', (c) => `if [[ -n x ]] >/dev/null ${c}`],
  ['if [[ … ]]>/dev/null C', (c) => `if [[ -n x ]]>/dev/null ${c}`],
  ['if [[ … ]] ! C', (c) => `if [[ -n x ]] ! ${c}`],
  ['if [[ … ]] noglob C', (c) => `if [[ -n x ]] noglob ${c}`],
  ['if [[ … ]] if [[ … ]] C', (c) => `if [[ -n x ]] if [[ -n y ]] ${c}`],
  // zsh의 다른 짧은 꼴: 괄호와 ;에서 명령이 나뉜다
  ['if (( 1 )) C', (c) => `if (( 1 )) ${c}`],
  ['if ( true ) C', (c) => `if ( true ) ${c}`],
  ['for x (a) C', (c) => `for x (a) ${c}`],
  ['for x in a; C', (c) => `for x in a; ${c}`],
];

/** 유지하는 꼴: 전에도 막혔다 */
const KEEP: Frame[] = [
  ['C >/dev/null', (c) => `${c} >/dev/null`],
  ['time', (c) => `time ${c}`],
  ['time -p', (c) => `time -p ${c}`],
  ['{ C; }', (c) => `{ ${c}; }`],
  ['( C )', (c) => `( ${c} )`],
  ['true && C', (c) => `true && ${c}`],
  ['case 가지', (c) => `case x in x) ${c};; esac`],
  ['f() { C; }', (c) => `f() { ${c}; }; f`],
  ['function f { C; }', (c) => `function f { ${c}; }; f`],
  ['A=1 C', (c) => `A=1 ${c}`],
  ['env A=1 C', (c) => `env A=1 ${c}`],
  ['command', (c) => `command ${c}`],
  ['exec', (c) => `exec ${c}`],
  ['nohup', (c) => `nohup ${c}`],
  ['xargs', (c) => `echo | xargs ${c}`],
  ['eval', (c) => `eval "${c}"`],
  ['bash -c', (c) => `bash -c "${c}"`],
  ['sh -c', (c) => `sh -c '${c}'`],
  ['줄을 바꾼 then', (c) => `if true\nthen\n  ${c}\nfi`],
  ['do { C; }', (c) => `for a in b; do { ${c}; }; done`],
  ['then ( C )', (c) => `if true; then ( ${c} ); fi`],
  ['coproc N { C; }', (c) => `coproc N { ${c}; }`],
  ['builtin command', (c) => `builtin command ${c}`],
];

/** 막히지 않아야 하는 호출 */
const ALLOW = [
  'echo then git push --force origin main',
  'echo do rm -rf /',
  'git commit -m "do it"',
  'git commit -m "if then else"',
  'grep -r "if" .',
  "echo '>' git reset --hard",
  'if git diff --quiet; then echo clean; fi',
  'for f in a b; do node --test "$f"; done',
  'until [ -f done.txt ]; do sleep 10; done',
  'while read -r line; do echo "$line"; done < in.txt',
  '! grep -q x in.txt',
  'if [[ -f x ]]; then echo y; fi',
  '[[ -n x ]] && echo y',
  'git status >/dev/null 2>&1',
  '>/dev/null git status',
  'git >/dev/null status',
  'repeat 3 echo hi',
  'noglob echo *',
  'cat <.env.example',
  // 따옴표 안의 글은 리다이렉션이 아니다
  'gh issue comment 1 --body "cat <.env"',
  // 따옴표로 묶은 [[·]]는 인자다
  "printf '%s\\n' '[[' ']]' npm publish",
  // 명령의 첫 낱말 자리가 아닌 [[는 인자다
  'echo [[ a ]] git reset --hard',
  // 따옴표로 묶은 [[는 예약어가 아니다(셸은 [[라는 명령을 찾다 실패한다)
  '"[[" -n x ]] git reset --hard',
  // 따옴표·이스케이프 안의 >는 파일 이름의 글자다
  "cat <'notes>.env'",
  'cat <"a>.env"',
  'cat <in\\>.env',
  // here-string의 글은 파일이 아니다
  'cat <<<.env',
  'node scripts/harness.ts check > check.log 2>&1 && git push origin feat/x',
];

test('기준: 금지 호출을 그대로 쓰면 정해진 규칙으로 막힌다', () => {
  for (const [call, want] of CALLS) assert.equal(rule(call), want, call);
});

test('닫는 꼴: 이름 앞의 리다이렉션·예약어·zsh 수식어, 이름 뒤의 리다이렉션으로 감싸도 같은 규칙으로 막힌다', () => {
  const missed: string[] = [];
  for (const [name, wrap] of CLOSE)
    for (const [call, want] of CALLS) {
      const got = rule(wrap(call));
      if (got !== want) missed.push(`[${name}] ${JSON.stringify(wrap(call))}: ${got ?? '통과'}`);
    }
  assert.deepEqual(missed, []);
});

test('유지하는 꼴: 전에 막히던 꼴의 판정이 그대로다', () => {
  const missed: string[] = [];
  for (const [name, wrap] of KEEP)
    for (const [call, want] of CALLS) {
      const got = rule(wrap(call));
      if (got !== want) missed.push(`[${name}] ${JSON.stringify(wrap(call))}: ${got ?? '통과'}`);
    }
  assert.deepEqual(missed, []);
});

test('허용: 예약어와 같은 글자가 인자에 있을 뿐인 호출과 예약어 뒤의 허용된 명령은 막히지 않는다', () => {
  for (const c of ALLOW) assert.equal(rule(c), null, c);
});

test('분석기: argv의 첫 낱말은 명령 이름이다', () => {
  const one = (s: string) => {
    const all = parseShell(s);
    assert.equal(all.length, 1, s);
    return all[0];
  };
  // 이름 앞의 리다이렉션은 끝으로 옮긴다
  assert.deepEqual(one('>/dev/null git push').argv, ['git', 'push', '>/dev/null']);
  assert.deepEqual(one('>/dev/null git push').args, ['git', 'push']);
  assert.deepEqual(one('> out git push').argv, ['git', 'push', '>', 'out']);
  assert.deepEqual(one('> out git push').args, ['git', 'push']);
  assert.deepEqual(one('2>/dev/null >out git push').argv, ['git', 'push', '2>/dev/null', '>out']);
  assert.deepEqual(one('A=1 >out env B=2 git push').argv, ['git', 'push', '>out']);
  assert.deepEqual(one('A=1 >out env B=2 git push').assigns, { A: '1', B: '2' });
  // 이름에 붙은 리다이렉션은 뗀다
  assert.deepEqual(one('git>/dev/null push').argv, ['git', '>/dev/null', 'push']);
  assert.deepEqual(one('git>/dev/null push').args, ['git', 'push']);
  assert.deepEqual(one('git> out push').argv, ['git', '>', 'out', 'push']);
  assert.deepEqual(one('git> out push').args, ['git', 'push']);
  assert.deepEqual(one('env>/dev/null git push').argv, ['git', 'push', '>/dev/null']);
  // 인자 사이의 리다이렉션은 그 자리 그대로다
  assert.deepEqual(one('git >/dev/null push').argv, ['git', '>/dev/null', 'push']);
  assert.deepEqual(one('git >/dev/null push').args, ['git', 'push']);
  assert.deepEqual(one('git push>out origin').argv, ['git', 'push>out', 'origin']);
  // 이름이 없는 명령은 전과 같다
  assert.deepEqual(one('>/dev/null').argv, ['>/dev/null']);
  assert.deepEqual(one('> out').argv, ['>', 'out']);
  assert.deepEqual(one('A=1 >out').argv, ['>out']);
  // 예약어와 zsh 수식어
  const argvs = (s: string) => parseShell(s).map((c) => c.argv);
  assert.deepEqual(argvs('if true; then git push; fi'), [['true'], ['git', 'push'], ['fi']]);
  // 예약어뿐인 조각(줄을 바꾼 then)은 전처럼 그 낱말을 담은 명령을 낸다
  assert.deepEqual(argvs('if true\nthen\n git push\nfi'), [
    ['true'],
    ['then'],
    ['git', 'push'],
    ['fi'],
  ]);
  assert.deepEqual(argvs('for a in b; do git push; done'), [
    ['for', 'a', 'in', 'b'],
    ['git', 'push'],
    ['done'],
  ]);
  assert.deepEqual(argvs('! time -p git push'), [['git', 'push']]);
  assert.deepEqual(argvs('else if ! coproc git push'), [['git', 'push']]);
  assert.deepEqual(argvs('noglob nocorrect - repeat 3 git push'), [['git', 'push']]);
  assert.deepEqual(argvs('then'), [['then']]);
  assert.deepEqual(argvs('! noglob'), [['!', 'noglob']]);
  assert.deepEqual(argvs('echo then git push'), [['echo', 'then', 'git', 'push']]);
  assert.deepEqual(argvs('if [[ -n x ]] git push'), [
    ['[[', '-n', 'x', ']]'],
    ['git', 'push'],
  ]);
  assert.deepEqual(argvs('[[ -n x ]] && echo y'), [
    ['[[', '-n', 'x', ']]'],
    ['echo', 'y'],
  ]);
  // 인자 자리의 [[·]], 따옴표로 묶은 [[·]]에서는 명령을 나누지 않는다
  const named = (s: string) => parseShell(s).filter((c) => (c.args ?? c.argv)[0] === 'tool');
  assert.equal(one("printf '%s\\n' '[[' ']]' tool a b").argv[0], 'printf');
  assert.equal(one('echo [[ a ]] tool a b').argv[0], 'echo');
  assert.equal(one('"[[" -n x ]] tool a b').argv[0], '[[');
  assert.equal(one('A=1 [[ -n x ]] tool a b').argv[0], '[[');
  // 조건식 안의 연산자는 조건식을 끝내지 않는다. 따옴표로 묶은 "]]"는 끝이 아니다
  for (const s of [
    'if [[ -n x && -n y ]] tool a b',
    'if [[ -n x || -n y ]] tool a b',
    'if [[ ( -n x ) ]] tool a b',
    'if [[ -n x\n]] tool a b',
    'if [[ "]]" == "]]" ]] tool a b',
    "if [[ ']]' == x || -n y ]] tool a b",
    'if [[ -n x ]]>/dev/null tool a b',
    'if [[ -n x ]] && [[ -n y ]] tool a b',
  ])
    assert.deepEqual(
      named(s).map((c) => c.args ?? c.argv),
      [['tool', 'a', 'b']],
      s,
    );
  // 조건식이 끝난 뒤의 ]]는 인자다(zsh: `if [[ … ]] echo ]] x`는 echo 하나를 실행한다)
  assert.deepEqual(argvs('if [[ -n x ]] echo ]] tool a b').at(-1), [
    'echo',
    ']]',
    'tool',
    'a',
    'b',
  ]);
  // 디스크립터 변수
  assert.deepEqual(one('{fd}>/dev/null tool a b').args, ['tool', 'a', 'b']);
  assert.deepEqual(one('tool {fd}>/dev/null a b').args, ['tool', 'a', 'b']);
});

test('분석기: 낱말에 붙은 리다이렉션의 대상은 따옴표 밖의 연산자에서만 나뉜다', () => {
  const targets = (s: string) => {
    const all = parseShell(s);
    assert.equal(all.length, 1, s);
    return all[0].targets;
  };
  assert.deepEqual(targets('cat <.env'), ['.env']);
  assert.deepEqual(targets('cat 0<.env'), ['.env']);
  assert.deepEqual(targets('cat <a>b'), ['a', 'b']);
  assert.deepEqual(targets("cat <'notes>.env'"), ['notes>.env']);
  assert.deepEqual(targets('cat <"a b">out'), ['a b', 'out']);
  assert.deepEqual(targets('cat <in\\>put'), ['in>put']);
  assert.deepEqual(targets('cat 2>&1 <in'), ['1', 'in']);
  assert.deepEqual(targets('<.env cat'), ['.env']);
  assert.deepEqual(targets('cat<.env'), ['.env']);
  assert.deepEqual(targets('env>out cat <in'), ['in', 'out']);
  // 띄어 쓴 대상은 argv의 낱말이다. here-string의 글은 파일이 아니다. 따옴표 안의 글은 리다이렉션이 아니다
  assert.equal(targets('cat < .env'), undefined);
  assert.equal(targets('cat <<<.env'), undefined);
  assert.equal(targets('echo "cat <.env"'), undefined);
});

test('분석기: PowerShell·cmd 방언에서는 예약어와 zsh 수식어를 벗기지 않는다', () => {
  for (const dialect of ['powershell', 'cmd'] as const) {
    assert.deepEqual(parseShell('then git push', dialect)[0].argv, ['then', 'git', 'push']);
    assert.deepEqual(parseShell('noglob git push', dialect)[0].argv, ['noglob', 'git', 'push']);
  }
});

test('검사 순서 규칙(R4): 이름 앞·뒤에 리다이렉션이 있어도 돈다', () => {
  for (const c of [
    'node scripts/harness.ts check; >/dev/null git push origin x',
    'node scripts/harness.ts check; git >/dev/null push origin x',
    'node scripts/harness.ts check; git>/dev/null push origin x',
    '>/dev/null node scripts/harness.ts check; git push origin x',
    '>check.log node scripts/harness.ts check | cat',
    'node scripts/harness.ts >check.log check; git push origin x',
    // 제어문이 아닌 낱말(`!`, zsh 수식어)은 검사 순서에서도 벗긴다
    'node scripts/harness.ts check; ! git push origin x',
    'node scripts/harness.ts check; noglob git push origin x',
  ])
    assert.equal(rule(c), 'R4', c);
  for (const c of [
    'node scripts/harness.ts check >check.log 2>&1 && >/dev/null git push origin x',
    'if node scripts/harness.ts check; then git push origin x; fi',
  ])
    assert.equal(rule(c), null, c);
});

/** 검사가 통과한 뒤에만 실행돼야 하는 뒤 명령과, 이름 앞·이름 뒤·하위 명령 앞에 리다이렉션을 넣은 꼴 */
const FOLLOW_UPS: [plain: string, redirected: string[]][] = [
  [
    'git push origin x',
    ['>x.log git push origin x', 'git >x.log push origin x', 'git>x.log push origin x'],
  ],
  [
    'node scripts/harness.ts complete-step',
    [
      '>x.log node scripts/harness.ts complete-step',
      'node >x.log scripts/harness.ts complete-step',
      'node>x.log scripts/harness.ts complete-step',
      'node scripts/harness.ts >x.log complete-step',
      '2>&1 node scripts/harness.ts complete-step',
    ],
  ],
  [
    'node scripts/harness.ts pr-ready',
    [
      '>x.log node scripts/harness.ts pr-ready',
      'node >x.log scripts/harness.ts pr-ready',
      'node scripts/harness.ts >x.log pr-ready',
      '2>&1 node scripts/harness.ts pr-ready',
    ],
  ],
  [
    'gh pr create --draft',
    ['>x.log gh pr create --draft', 'gh >x.log pr create --draft', 'gh pr >x.log create --draft'],
  ],
  ['gh pr ready 7', ['>x.log gh pr ready 7', 'gh >x.log pr ready 7', 'gh pr >x.log ready 7']],
];

test('검사 순서 규칙(R4): 뒤 명령(push·완료 처리·승인 요청·PR 생성)에 리다이렉션이 끼어도 판정이 같다', () => {
  const after = (f: string) => `node scripts/harness.ts check; ${f}`;
  const chained = (f: string) => `node scripts/harness.ts check > check.log 2>&1 && ${f}`;
  // gh pr ready는 직접 호출이 승인 요청 순서 규칙으로 막힌다. &&로 이어도 그 규칙으로 막힌다(R4 검사 우회가 아니다)
  const ready = rule('gh pr ready 7');
  assert.ok(ready !== null && ready !== 'R4', String(ready));
  const diffs: string[] = [];
  for (const [plain, redirected] of FOLLOW_UPS) {
    // 기준: 리다이렉션이 없는 꼴
    assert.equal(rule(after(plain)), 'R4', after(plain));
    const want: string | null = plain === 'gh pr ready 7' ? ready : null;
    assert.equal(rule(chained(plain)), want, chained(plain));
    for (const f of redirected) {
      if (rule(after(f)) !== 'R4') diffs.push(`${after(f)}: ${rule(after(f)) ?? '통과'}`);
      if (rule(chained(f)) !== want) diffs.push(`${chained(f)}: ${rule(chained(f)) ?? '통과'}`);
    }
  }
  assert.deepEqual(diffs, []);
  // 검사 명령 쪽에 리다이렉션이 낀 꼴
  for (const c of [
    'node scripts/harness.ts >check.log check; node scripts/harness.ts complete-step',
    '>check.log node scripts/harness.ts check; node scripts/harness.ts pr-ready',
  ])
    assert.equal(rule(c), 'R4', c);
});

test('파일 이름 검사(R10·R20): 리다이렉션에 붙은 대상도 본다', () => {
  const E = '.env';
  for (const c of [
    `cat <${E}`,
    `<${E} cat`,
    `cat 0<${E}`,
    `wc -l <${E}`,
    `cat<${E}`,
    `cat <${E}.local`,
    `cat < ${E}`,
  ])
    assert.equal(rule(c), 'R10', c);
  assert.equal(rule('cat <~/.config/gh/hosts.yml'), 'R20');
  assert.equal(rule(`cat <${E}.example`), null);
  assert.equal(rule(`ls ${E}`), null);
  // 따옴표로 묶은 대상도 대상이다. 연산자가 이어 붙으면 대상마다 본다
  for (const c of [`cat <'${E}'`, `cat <"${E}"`, `cat <in>${E}`]) assert.equal(rule(c), 'R10', c);
  // 따옴표·이스케이프 안의 <·>는 대상을 나누지 않는다(파일 이름이 notes>.env, a>.env, in>.env다)
  for (const c of [`cat <'notes>${E}'`, `cat <"a>${E}"`, `cat <in\\>${E}`, `cat <<<${E}`])
    assert.equal(rule(c), null, c);
});

// ---------- 실제 셸 대조 ----------
// 감싼 꼴에서 셸이 명령을 실제로 실행하는지를 bash와 zsh에 묻는다. 셸이 `tool a b`를 실행한 꼴에서는
// 분석기도 이름이 tool이고 인자가 a b인 명령을 내야 한다. tool은 받은 인자를 파일에 적고 셸을 끝내는 함수다.

/** 인자 자리에 예약어가 있는 꼴(셸이 tool을 실행하지 않는다) */
const NOT_RESERVED: Frame[] = [
  ['echo then C', (c) => `echo then ${c}`],
  ['"then" C', (c) => `"then" ${c}`],
  ['A=1 then C', (c) => `A=1 then ${c}`],
];

/** 셸이 tool을 명령으로 실행하지 않고, 분석기도 이름이 tool인 명령을 내지 않아야 하는 꼴(tool2는 아무것도 하지 않는 함수다) */
const NOT_COMMAND: Frame[] = [
  ["printf '[[' ']]' C", (c) => `printf '%s\\n' '[[' ']]' ${c}`],
  ['echo [[ a ]] C', (c) => `echo [[ a ]] ${c}`],
  ['"[[" -n x ]] C', (c) => `"[[" -n x ]] ${c}`],
  ['echo then C', (c) => `echo then ${c}`],
  ["tool2 <'in>put' C", (c) => `tool2 <'in>put' ${c}`],
  // 따옴표·이스케이프로 묶은 예약어는 예약어가 아니라 명령 이름이다: 그 뒤의 `[[`는 인자이고 조건식이 아니다
  ['"then" [[ a ]] C', (c) => `"then" [[ a ]] ${c}`],
  ["'if' [[ a ]] C", (c) => `'if' [[ a ]] ${c}`],
  ['\\if [[ a ]] C', (c) => `\\if [[ a ]] ${c}`],
  ['"!" [[ a ]] C', (c) => `"!" [[ a ]] ${c}`],
  ['"time" [[ a ]] C', (c) => `"time" [[ a ]] ${c}`],
];

test('분석기: 인자 자리의 [[·]]와 따옴표 안의 >에서 가짜 명령을 만들지 않는다', () => {
  for (const [name, wrap] of NOT_COMMAND) {
    const cmds = parseShell(wrap('tool a b'));
    assert.deepEqual(
      cmds.filter((c) => (c.args ?? c.argv)[0] === 'tool'),
      [],
      name,
    );
  }
});

function compareWithShell(t: TestContext, shell: string, flags: string[], atLeast: number): void {
  const probe = spawnSync(shell, [...flags, 'exit 0'], { encoding: 'utf8' });
  if (process.platform === 'win32' || probe.error || probe.status !== 0) {
    t.skip(`${shell}이 없다`);
    return;
  }
  // 디스크립터 변수(`{fd}>파일`)는 bash 4.1에서 생겼다. 그 앞의 bash(macOS의 3.2)는 `{fd}`를 인자로 넘기므로 그 틀은 비교하지 않는다
  const ver = spawnSync(shell, [...flags, 'echo "${BASH_VERSINFO[0]:-9}.${BASH_VERSINFO[1]:-9}"'], {
    encoding: 'utf8',
  });
  const [major, minor] = ver.stdout.trim().split('.').map(Number);
  const noFdVar = major < 4 || (major === 4 && minor < 1);
  const call = 'tool a b';
  let compared = 0;
  const diffs: string[] = [];
  /** 틀마다 새 임시 폴더에서 돌린다(조건식 안의 비교 연산자나 리다이렉션이 파일을 만들 수 있다). 셸이 tool을 실행했으면 인자를 적은 파일의 경로 */
  const run = (cmd: string): string | null => {
    const work = tmp('harness-command-position-');
    writeFileSync(path.join(work, 'in.txt'), 'input\n');
    writeFileSync(path.join(work, 'in>put'), 'input\n');
    const out = path.join(work, 'argv.out');
    spawnSync(
      shell,
      [
        ...flags,
        `tool() { printf '%s\\0' "$#" "$@" > "$ARGV_OUT"; exit 0; }\ntool2() { :; }\n${cmd}\nwait\n`,
      ],
      {
        cwd: work,
        encoding: 'utf8',
        input: '',
        timeout: 10_000,
        env: { PATH: process.env.PATH, ARGV_OUT: out },
      },
    );
    return existsSync(out) ? out : null;
  };
  // 반대 방향: 이 꼴들에서는 셸이 tool을 명령으로 실행하지 않는다
  for (const [name, wrap] of NOT_COMMAND)
    assert.equal(run(wrap(call)), null, `${shell}이 tool을 실행했다: [${name}]`);
  for (const [name, wrap] of [...CLOSE, ...KEEP, ...NOT_RESERVED]) {
    if (noFdVar && name.includes('{fd}')) continue;
    const cmd = wrap(call);
    const out = run(cmd);
    // 셸이 tool을 실행하지 않은 꼴(문법 오류, 없는 명령, 예약어가 아닌 자리)은 비교할 것이 없다
    if (out === null) continue;
    const raw = readFileSync(out, 'utf8').split('\0');
    const real = ['tool', ...raw.slice(1, 1 + Number(raw[0]))];
    compared += 1;
    const ours = parseShell(cmd).map((c) => c.args ?? c.argv);
    if (!ours.some((a) => JSON.stringify(a) === JSON.stringify(real)))
      diffs.push(
        `[${name}] ${JSON.stringify(cmd)}: ${shell} ${JSON.stringify(real)} / 훅 ${JSON.stringify(ours)}`,
      );
  }
  assert.deepEqual(diffs, []);
  assert.ok(compared >= atLeast, `비교한 꼴이 너무 적다: ${compared}`);
}

test('실제 bash가 명령을 실행하는 꼴에서는 분석기도 그 명령을 낸다', (t) => {
  compareWithShell(t, 'bash', ['-c'], 30);
});

test('실제 zsh가 명령을 실행하는 꼴에서는 분석기도 그 명령을 낸다', (t) => {
  compareWithShell(t, 'zsh', ['-f', '-c'], 35);
});

// ---------- 시간 ----------
// 훅은 모든 Bash 호출에서 돈다. 폭주하면 이 프로세스 안에서는 끊을 수 없으므로 자식 프로세스에 시간 제한을 건다.

/** 입력마다 판정에 걸린 시간(ms). 자식 프로세스에서 판정하고 시간 제한을 건다. 판정이 예외를 던지면 실패한다 */
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
      const t0 = Date.now();
      evaluate({ kind: 'bash', command, cwd: '/work/repo' }, ctx);
      times.push(Date.now() - t0);
    }
    process.stdout.write(JSON.stringify(times));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 60_000,
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

test('긴 입력(낱말 20,000개)의 판정이 시간 안에 끝난다', () => {
  const n = 20_000;
  const inputs = [
    `if [[ ${']] '.repeat(n)}echo x`,
    `${'then '.repeat(n)}echo x`,
    `${'>/dev/null '.repeat(n)}echo x`,
    `${'! noglob '.repeat(n / 2)}echo x`,
    `${'[[ -n x ]] && '.repeat(n / 4)}echo x`,
    `if [[ ${'a && '.repeat(n)}b ]] echo x`,
    `echo ${'[[ '.repeat(n)}x`,
    `cat ${'<a>b'.repeat(n)}`,
  ];
  for (const [i, ms] of timeEvaluate(inputs).entries()) assert.ok(ms < 5_000, `입력 ${i}: ${ms}ms`);
});

test('한 낱말에 리다이렉션이 아주 많은 입력도 예외 없이 시간 안에 판정한다', () => {
  // 대상의 수가 함수 인자의 한도를 넘어도 분석기가 멈추지 않는다(대상을 하나씩 더한다).
  // here-string이 많은 낱말도 입력의 길이에 비례해 읽는다(구간마다 목록을 다시 찾지 않는다)
  const n = 300_000;
  const inputs = [
    `cat ${'<a'.repeat(n)}`,
    `cat ${'<a>b'.repeat(n / 2)}`,
    `cat ${'<<<a'.repeat(n)}`,
    `cat ${'<<<a<b'.repeat(n / 2)}`,
    `cat ${'<<<<<<a<b'.repeat(n / 2)}`,
    `cat ${'<a '.repeat(n)}`,
    `>x ${'<a'.repeat(n)} cat`,
    `cat${'<a'.repeat(n)} x`,
    `if [[ -n x ]]${'>a'.repeat(n)} echo x`,
  ];
  for (const [i, ms] of timeEvaluate(inputs).entries()) assert.ok(ms < 5_000, `입력 ${i}: ${ms}ms`);
});

test('분석기: here-string의 글은 대상이 아니고, 그 앞뒤의 리다이렉션의 대상은 그대로 낸다', () => {
  const targets = (src: string) => parseShell(src).map((c) => c.targets ?? []);
  assert.deepEqual(targets('cat <<<a'), [[]]);
  assert.deepEqual(targets('cat <<<a<b'), [['b']]);
  assert.deepEqual(targets('cat <a<<<b<c'), [['a', 'c']]);
  assert.deepEqual(targets('cat <<<a<<<b<c>d'), [['c', 'd']]);
  assert.deepEqual(targets('cat <a<<<b<<<c'), [['a']]);
});
