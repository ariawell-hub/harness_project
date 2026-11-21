// L1 훅의 DB 규칙 가운데 인자 배열로 하위 명령을 판정하는 부분(guard.dbCommands, 계획 20261121-db-arg-boundary).
// 인자를 이은 글에 정규식을 돌리면 인자의 경계가 사라진다(PR #169의 F1·F3). 여기서는 인자의 자리로 본다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchDbCommand, type DbCommandRule } from '../hooks/db-commands.ts';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { parseShell } from '../hooks/shell.ts';

const DRIZZLE: DbCommandRule[] = [{ tool: 'drizzle-kit', forbidden: ['migrate', 'push', 'drop'] }];

const ctx = (rules: DbCommandRule[] = []): GuardContext => ({
  repo: null,
  hasPlan: () => true,
  dbPatterns: [],
  dbClients: [],
  dbCommands: () => rules,
  home: '/Users/someone',
});
const bash = (command: string, c: GuardContext) =>
  evaluate({ kind: 'bash', command, cwd: '/work/repo' }, c);
const argvOf = (command: string) => parseShell(command).map((s) => s.argv);

const BLOCK = [
  'drizzle-kit migrate',
  'drizzle-kit --config x migrate',
  'drizzle-kit --config "team config.ts" migrate',
  'drizzle-kit --config=x migrate',
  'drizzle-kit -- migrate',
  'npx drizzle-kit@latest migrate',
  'pnpm exec drizzle-kit migrate',
  'pnpm dlx drizzle-kit@0.31.11 migrate',
  'node node_modules/drizzle-kit/bin.cjs migrate',
  './node_modules/.bin/drizzle-kit migrate',
  'Drizzle-Kit MIGRATE',
  'drizzle-kit --verbose drop',
  `drizzle-kit ${'--config a '.repeat(500)}migrate`,
  // 도구 자리가 여럿이다
  'drizzle-kit --config drizzle-kit migrate',
  'drizzle-kit generate drizzle-kit migrate',
];

const ALLOW = [
  'drizzle-kit generate',
  'drizzle-kit generate --name migrate',
  'drizzle-kit --config a generate --name migrate',
  'drizzle-kit --config "team local migrate config.ts" generate',
  'drizzle-kit --config "a migrate" generate',
  'drizzle-kit --name=migrate generate',
  'drizzle-kit --config drizzle-kit generate',
  'echo drizzle-kit',
  'cat docs/drizzle-kit/migrate.md',
  'drizzle-kit',
  'drizzle-kit --help',
];

test('설정의 dbCommands: 금지 하위 명령은 플래그·버전·실행기·경로를 거쳐도 R13으로 막힌다', () => {
  const c = ctx(DRIZZLE);
  for (const cmd of BLOCK) {
    const r = bash(cmd, c);
    assert.ok(r?.rule.startsWith('R13'), `막혀야 한다: ${cmd.slice(0, 80)} → ${r?.rule}`);
  }
});

test('설정의 dbCommands: 허용된 하위 명령과 도구를 부르지 않는 명령은 통과한다', () => {
  const c = ctx(DRIZZLE);
  for (const cmd of ALLOW) assert.equal(bash(cmd, c), null, `통과해야 한다: ${cmd}`);
});

test('차단 메시지에 도구와 하위 명령, 값을 붙여 쓰는 방법이 있다', () => {
  const r = bash('drizzle-kit --config x migrate', ctx(DRIZZLE));
  assert.match(r!.what, /drizzle-kit/);
  assert.match(r!.what, /migrate/);
  assert.match(r!.how, /--이름=값/);
});

// 인자가 다르고 이은 글이 같은 두 호출. 글로는 가를 수 없고 인자의 자리로만 가를 수 있다
const SAME_TEXT: [blocked: string, allowed: string][] = [
  [
    'drizzle-kit --config "team config.ts" migrate',
    'drizzle-kit --config "team config.ts migrate"',
  ],
  [
    'drizzle-kit --config "a generate" --name migrate',
    'drizzle-kit --config a generate --name migrate',
  ],
];

test('경계: 인자가 다르고 이은 글이 같은 두 호출을 다르게 판정한다', () => {
  const c = ctx(DRIZZLE);
  for (const [blocked, allowed] of SAME_TEXT) {
    assert.notDeepEqual(argvOf(blocked), argvOf(allowed), '두 호출은 인자가 다르다');
    assert.deepEqual(
      argvOf(blocked).map((a) => a.join(' ')),
      argvOf(allowed).map((a) => a.join(' ')),
      '인자를 이은 글은 같다',
    );
    assert.ok(bash(blocked, c)?.rule.startsWith('R13'), `막혀야 한다: ${blocked}`);
    assert.equal(bash(allowed, c), null, `통과해야 한다: ${allowed}`);
  }
});

test('알려진 대가: 값을 받지 않는 플래그 뒤의 허용된 하위 명령 + 금지 이름과 같은 플래그 값은 막힌다', () => {
  const c = ctx(DRIZZLE);
  assert.ok(bash('drizzle-kit --verbose generate --name migrate', c)?.rule.startsWith('R13'));
  // 값을 붙여 쓰면 통과한다(차단 메시지의 "고치는 법")
  assert.equal(bash('drizzle-kit --verbose generate --name=migrate', c), null);
});

test('코어 기본 항목: 설정 없이 drizzle-kit push와 prisma db push·migrate reset을 자리로 막는다', () => {
  const c = ctx();
  for (const cmd of [
    'drizzle-kit --config x push',
    'npx drizzle-kit@latest push',
    'pnpm dlx drizzle-kit@0.31.11 --config "a b.ts" push',
    'prisma db push',
    'prisma --schema x db push',
    'npx prisma@6 --schema "my schema.prisma" db push',
    'npx prisma migrate reset --force',
    'prisma --schema x migrate reset',
  ])
    assert.ok(bash(cmd, c)?.rule.startsWith('R13'), `막혀야 한다: ${cmd}`);
  for (const cmd of [
    'drizzle-kit generate',
    'drizzle-kit --config x generate',
    'prisma migrate status',
    'prisma db pull',
    'prisma generate',
    'prisma migrate dev --name reset',
    'cat prisma/schema.prisma',
  ])
    assert.equal(bash(cmd, c), null, `통과해야 한다: ${cmd}`);
});

test('matchDbCommand: 낱말이 둘 이상인 금지 항목은 인자가 차례로 같을 때만 걸린다', () => {
  const rules: DbCommandRule[] = [{ tool: 'prisma', forbidden: ['db push', 'migrate reset'] }];
  assert.deepEqual(matchDbCommand(['prisma', 'db', 'push'], rules), {
    tool: 'prisma',
    sub: 'db push',
  });
  assert.equal(matchDbCommand(['prisma', 'db', 'pull'], rules), null);
  assert.equal(matchDbCommand(['prisma', 'db'], rules), null);
  assert.equal(matchDbCommand(['prisma', 'db push'], rules), null, '인자 하나에 든 글은 다르다');
  assert.equal(matchDbCommand(['prisma', 'push'], rules), null);
  assert.equal(matchDbCommand([], rules), null);
  assert.equal(matchDbCommand(['prisma', 'db', 'push'], []), null);
});

test('matchDbCommand: 도구 자리는 경로 조각·버전·확장자를 보고, 플래그와 공백이 든 글은 아니다', () => {
  const hit = (argv: string[]) => matchDbCommand(argv, DRIZZLE) !== null;
  assert.ok(hit(['node_modules\\.bin\\drizzle-kit.cmd', 'push']));
  assert.ok(hit(['C:\\repo\\node_modules\\.bin\\DRIZZLE-KIT.EXE', 'push']));
  assert.ok(hit(['drizzle-kit@0.31.11', 'push']));
  assert.ok(hit(['drizzle-kit', '--', 'push']));
  assert.ok(hit(['drizzle-kit', '', 'push']) === false, '빈 인자가 하위 명령 자리다');
  assert.ok(hit(['drizzle-kit', '--x', '', 'push']), '플래그 뒤의 빈 인자는 값일 수 있다');
  assert.equal(hit(['drizzle-kit push']), false, '공백으로 이은 글 하나는 도구 자리가 아니다');
  assert.equal(hit(['--bin=node_modules/drizzle-kit/bin.cjs', 'push']), false, '플래그다');
  assert.equal(hit(['drizzle-kitx', 'push']), false);
  assert.equal(hit(['my-drizzle-kit', 'push']), false);
  assert.equal(hit(['drizzle-kit', '--', '--x', 'push']), false, '-- 다음 인자가 하위 명령이다');
});

// ---------- 한 번만 걷는다 ----------

/** 느린 기준 구현: 도구 자리마다 뒤를 처음부터 다시 걷는다(step0의 판정 규칙을 그대로 옮겼다) */
function slowMatch(argv: string[], rules: DbCommandRule[]): boolean {
  const lower = argv.map((a) => a.toLowerCase());
  for (const rule of rules) {
    const forb = rule.forbidden.map((f) => f.split(' '));
    const at = (i: number) =>
      forb.some((w) => w.every((word, j) => i + j < lower.length && lower[i + j] === word));
    for (let p = 0; p < argv.length; p++) {
      if (argv[p].startsWith('-')) continue;
      const isTool = lower[p]
        .split(/[\\/]/)
        .map((s) => s.replace(/\.(exe|cmd|bat|com)$/, ''))
        .some((s) => s === rule.tool || s.startsWith(`${rule.tool}@`));
      if (!isTool) continue;
      let afterFlag = false;
      for (let i = p + 1; i < argv.length; i++) {
        if (argv[i] === '--') {
          if (i + 1 < argv.length && at(i + 1)) return true;
          break;
        }
        if (argv[i].startsWith('-')) {
          afterFlag = true;
          continue;
        }
        if (at(i)) return true;
        if (!afterFlag) break;
        afterFlag = false;
      }
    }
  }
  return false;
}

/** 고정한 씨앗의 난수(mulberry32). 실패하면 같은 입력으로 다시 볼 수 있다 */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('한 번만 걷는 판정은 도구 자리마다 다시 걷는 기준 구현과 결과가 같다', () => {
  const rules: DbCommandRule[] = [
    { tool: 'drizzle-kit', forbidden: ['migrate', 'push'] },
    { tool: 'prisma', forbidden: ['db push', 'migrate reset'] },
  ];
  const words = [
    'drizzle-kit',
    'prisma',
    'node_modules/drizzle-kit/bin.cjs',
    'prisma@6',
    '--config',
    '--x=1',
    '-v',
    '--',
    'migrate',
    'push',
    'db',
    'reset',
    'generate',
    'a b.ts',
    'x',
    '',
  ];
  const next = rng(20261121);
  let blocked = 0;
  for (let n = 0; n < 4000; n++) {
    const len = 1 + Math.floor(next() * 9);
    const argv = Array.from({ length: len }, () => words[Math.floor(next() * words.length)]);
    const fast = matchDbCommand(argv, rules) !== null;
    assert.equal(fast, slowMatch(argv, rules), `다르다: ${JSON.stringify(argv)}`);
    if (fast) blocked += 1;
  }
  assert.ok(blocked > 200 && blocked < 3800, `막힌 것과 통과한 것이 모두 있어야 한다: ${blocked}`);
});

/** 숫자 자리를 읽은 횟수를 세는 배열 */
function counted(arr: string[]): { argv: string[]; reads: () => number } {
  let reads = 0;
  const argv = new Proxy(arr, {
    get(t, k, r) {
      if (typeof k === 'string' && /^\d+$/.test(k)) reads += 1;
      return Reflect.get(t, k, r) as unknown;
    },
  });
  return { argv, reads: () => reads };
}

const WORST_RULES: DbCommandRule[] = [
  { tool: 'drizzle-kit', forbidden: ['migrate', 'db push now'] },
  { tool: 'prisma', forbidden: ['db push', 'migrate reset'] },
];
/** 최악 입력: 금지 하위 명령은 없고 도구 자리가 빽빽하다 */
const worstInputs = (n: number): string[][] => [
  Array.from({ length: n }, () => 'drizzle-kit'),
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'drizzle-kit' : '--x')),
  Array.from({ length: n }, (_, i) => ['drizzle-kit', '--x', 'db', 'push'][i % 4]),
];

test('선형 시간: 인자를 읽는 횟수가 규칙 수 × 인자 수 × (1 + 가장 긴 금지 항목의 낱말 수) 이하다', () => {
  const longest = 3; // 'db push now'
  for (const n of [1000, 10_000]) {
    for (const input of worstInputs(n)) {
      const c = counted(input);
      assert.equal(matchDbCommand(c.argv, WORST_RULES), null);
      const bound = WORST_RULES.length * n * (1 + longest);
      assert.ok(c.reads() <= bound, `n=${n}: ${c.reads()}회 읽었다(한도 ${bound})`);
      assert.ok(c.reads() >= n, '인자를 모두 봤다');
    }
  }
});

// 훅은 모든 Bash 호출에서 이 판정을 돌린다. 폭주하면 이 프로세스 안에서는 끊을 수 없으므로 자식 프로세스에 시간 제한을 건다.
// 큰 입력은 표준 입력으로 넘긴다(환경 변수·인자는 OS의 길이 한도에 걸린다).
test('최악 입력(인자 20,000개)에서도 판정이 시간 안에 끝난다', () => {
  const mod = pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'db-commands.ts'),
  ).href;
  const script = `
    import { readFileSync } from 'node:fs';
    const { matchDbCommand } = await import(${JSON.stringify(mod)});
    const { rules, inputs } = JSON.parse(readFileSync(0, 'utf8'));
    let hits = 0;
    for (const argv of inputs) if (matchDbCommand(argv, rules)) hits += 1;
    process.stdout.write(String(hits));
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 20_000,
    input: JSON.stringify({ rules: WORST_RULES, inputs: worstInputs(20_000) }),
  });
  assert.equal(
    r.error,
    undefined,
    `시간 안에 끝나지 않았거나 실행하지 못했다: ${r.error?.message}`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '0');
});
