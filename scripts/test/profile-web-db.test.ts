// 웹 프로파일(profiles/web)의 DB 차단 목록: Drizzle(ADR-0007)의 명령 가운데 DB에 접속하는 것과
// 마이그레이션 파일을 지우는 것을 L1 훅이 막는다(R13, 설계서 14.3절). 파일만 다루는 명령은 막지 않는다.
// 목록은 설정 guard.dbCommands의 항목이고, 판정은 코어가 인자 배열의 자리로 한다(설계서 13.1절).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../commands/init.ts';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { parseShell } from '../hooks/shell.ts';
import { loadConfig, type DbCommandRule } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { HARNESS_ROOT, commitAll, gitInit, sh, tmp } from './helpers.ts';

/** 이 리포의 profiles/web과 harness.config.json을 폴더에 복사하고 웹 프로파일을 적용한다 */
function applyWeb(root: string): void {
  cpSync(path.join(HARNESS_ROOT, 'profiles', 'web'), path.join(root, 'profiles', 'web'), {
    recursive: true,
  });
  cpSync(path.join(HARNESS_ROOT, 'harness.config.json'), path.join(root, 'harness.config.json'));
  assert.equal(init(root, 'web', {}), 0);
}

function webRepo(): string {
  const root = tmp('harness-profile-web-db-');
  applyWeb(root);
  return root;
}

const ctx = (
  dbPatterns: string[],
  dbClients: string[],
  dbCommands: DbCommandRule[],
): GuardContext => ({
  repo: null,
  hasPlan: () => true,
  dbPatterns,
  dbClients,
  dbCommands: () => dbCommands,
  home: '/Users/someone',
});

/** 웹 프로파일을 적용한 리포의 설정으로 만든 훅 컨텍스트 */
function webCtx(): GuardContext {
  const cfg = loadConfig(webRepo());
  return {
    repo: null,
    hasPlan: () => true,
    dbPatterns: cfg.guard.dbPatterns,
    dbClients: cfg.guard.dbClients,
    dbCommands: () => cfg.guard.dbCommands,
    home: '/Users/someone',
  };
}

const bash = (command: string, c: GuardContext) =>
  evaluate({ kind: 'bash', command, cwd: '/work/repo' }, c);

const FORBIDDEN = ['migrate', 'studio', 'introspect', 'pull', 'drop', 'push'];
const ALLOWED = ['generate', 'check', 'export', 'up'];

// 하위 명령이 도구 이름 바로 뒤에 오는 형태
const BLOCK_DIRECT = [
  'pnpm exec drizzle-kit migrate',
  'npx drizzle-kit migrate --config drizzle.config.ts',
  'pnpm drizzle-kit studio',
  'drizzle-kit introspect',
  'drizzle-kit pull',
  'drizzle-kit drop',
  'DRIZZLE-KIT MIGRATE',
  'pnpm exec drizzle-kit push',
  // 버전을 붙여 받아 실행하는 형태와 패키지의 실행 파일을 직접 부르는 형태
  'pnpm dlx drizzle-kit@0.31.11 migrate',
  'npx drizzle-kit@latest push',
  'npx drizzle-kit@latest --config drizzle.config.ts studio',
  'node node_modules/drizzle-kit/bin.cjs migrate',
  'node ./node_modules/drizzle-kit/bin.cjs --config drizzle.config.ts drop',
];

// 플래그가 하위 명령 앞에 오는 형태(drizzle-kit은 이 순서도 받는다)
const BLOCK_FLAG_FIRST = [
  'drizzle-kit --config drizzle.config.ts migrate',
  'drizzle-kit --config=drizzle.config.ts studio',
  'pnpm exec drizzle-kit --config drizzle.config.ts push',
  'drizzle-kit -h drop',
  'drizzle-kit --config a.ts --verbose pull',
  'drizzle-kit --verbose introspect',
];

// 플래그의 값에 공백이 든 형태. 인자를 이은 글에 정규식을 돌려서는 가릴 수 없던 호출이다(PR #169의 F1)
const BLOCK_SPACED_VALUE = [
  'drizzle-kit --config "team config.ts" migrate',
  "drizzle-kit --config 'a b.ts' studio",
  'npx drizzle-kit@latest --config "team config.ts" drop',
  'pnpm exec drizzle-kit --config "my team/drizzle config.ts" push',
];

// 파일만 다루는 명령과 상관없는 명령
const ALLOW = [
  'pnpm exec drizzle-kit generate',
  'pnpm exec drizzle-kit generate --name add-migrate-log',
  'pnpm exec drizzle-kit generate --name push-notifications',
  // 하위 명령 뒤의 인자에 금지 명령의 이름이 있어도 막지 않는다
  'drizzle-kit generate --name migrate',
  'drizzle-kit --config drizzle.config.ts generate',
  // 값 안의 낱말은 하위 명령이 아니다
  'drizzle-kit --config "team migrate config.ts" generate',
  'drizzle-kit --config "team local migrate config.ts" generate',
  'drizzle-kit check',
  'drizzle-kit export',
  'drizzle-kit up',
  'pnpm test',
  'npx drizzle-kit@0.31.11 generate',
  'node node_modules/drizzle-kit/bin.cjs generate --name add-pull-log',
  'pnpm add -D --save-exact drizzle-kit@0.31.11',
  'cat node_modules/drizzle-kit/package.json',
  'ls node_modules/drizzle-kit',
];

function assertBlocked(cmds: string[], c: GuardContext): void {
  for (const cmd of cmds) {
    const r = bash(cmd, c);
    assert.ok(r, `막혀야 한다: ${cmd}`);
    assert.ok(r.rule.startsWith('R13'), `${cmd} → ${r.rule} (기대 R13)`);
  }
}

test('웹 프로파일: DB에 접속하는 drizzle-kit 명령과 drop을 막는다(R13)', () => {
  assertBlocked(BLOCK_DIRECT, webCtx());
});

test('웹 프로파일: 플래그가 하위 명령 앞에 와도 막는다(R13)', () => {
  assertBlocked(BLOCK_FLAG_FIRST, webCtx());
});

test('웹 프로파일: 플래그의 값에 공백이 들어 있어도 막는다(R13)', () => {
  assertBlocked(BLOCK_SPACED_VALUE, webCtx());
});

test('웹 프로파일: 파일만 다루는 drizzle-kit 명령(generate, check, export, up)은 막지 않는다', () => {
  const c = webCtx();
  for (const cmd of ALLOW) {
    const r = bash(cmd, c);
    assert.equal(r, null, `허용되어야 한다: ${cmd} → ${r?.rule}: ${r?.what}`);
  }
});

test('웹 프로파일: 인자의 경계를 본다(이은 글이 같아도 인자가 다르면 판정이 다르다)', () => {
  const c = webCtx();
  const forbidden = 'drizzle-kit --config "team config.ts" migrate';
  const valueOnly = 'drizzle-kit --config "team config.ts migrate"';
  const argv = (cmd: string) => parseShell(cmd).map((s) => s.argv);
  assert.notDeepEqual(argv(forbidden), argv(valueOnly), '두 호출은 인자가 다르다');
  assert.deepEqual(
    argv(forbidden).map((a) => a.join(' ')),
    argv(valueOnly).map((a) => a.join(' ')),
    '인자를 공백으로 이은 글은 같다',
  );
  assert.ok(bash(forbidden, c)?.rule.startsWith('R13'), '하위 명령 자리의 금지 명령은 막힌다');
  assert.equal(bash(valueOnly, c), null, '값 안의 낱말일 뿐이라 막히지 않는다');
});

test('웹 프로파일: 플래그의 값이 금지 명령의 이름이면 막힌다(알려진 대가). 붙여 쓰면 통과한다', () => {
  const c = webCtx();
  const r = bash('drizzle-kit --name migrate generate', c);
  assert.ok(r?.rule.startsWith('R13'), `막혀야 한다 → ${r?.rule}`);
  assert.equal(bash('drizzle-kit --name=migrate generate', c), null);
});

test('프로파일이 더한 것이다: dbCommands가 비면 migrate는 막히지 않고 push는 코어가 막는다', () => {
  const core = ctx([], [], []);
  assert.equal(bash('drizzle-kit migrate', core), null);
  assert.equal(bash('drizzle-kit studio', core), null);
  assert.ok(bash('drizzle-kit push', core)?.rule.startsWith('R13'));
  // 코어 기본 항목은 플래그가 앞에 오는 push도 막는다(Issue #172). 웹 프로파일을 적용해도 같다
  const flagFirst = 'pnpm exec drizzle-kit --config x push';
  assert.ok(bash('drizzle-kit --config x push', core)?.rule.startsWith('R13'));
  assert.ok(bash(flagFirst, core)?.rule.startsWith('R13'));
  assert.ok(bash(flagFirst, webCtx())?.rule.startsWith('R13'));
});

test('웹 프로파일의 설정: dbCommands에 drizzle-kit 항목 하나, 금지 목록은 여섯이고 dbPatterns에는 drizzle 항목이 없다', () => {
  let cfg: ReturnType<typeof loadConfig> | undefined;
  assert.doesNotThrow(() => {
    cfg = loadConfig(webRepo());
  }, '설정 검사(resolveDbCommands)에서 던지면 안 된다');
  const { dbPatterns, dbClients, dbCommands } = cfg!.guard;
  const entries = dbCommands.filter((e) => e.tool === 'drizzle-kit');
  assert.equal(entries.length, 1, 'drizzle-kit 항목은 하나다');
  assert.deepEqual([...entries[0].forbidden].sort(), [...FORBIDDEN].sort());
  for (const name of ALLOWED)
    assert.ok(!entries[0].forbidden.includes(name), `파일만 다루는 명령을 막으면 안 된다: ${name}`);
  assert.deepEqual(
    dbPatterns.filter((p) => /drizzle/i.test(p)),
    [],
    'drizzle-kit은 정규식이 아니라 dbCommands 항목으로 막는다',
  );
  // 있던 항목은 그대로다
  for (const p of dbPatterns) assert.doesNotThrow(() => new RegExp(p, 'i'), p);
  for (const kept of [
    '\\btypeorm\\s+schema:(drop|sync)\\b',
    '\\bsequelize\\s+db:drop\\b',
    '\\bknex\\s+migrate:rollback\\b.*--all',
    '\\bsupabase\\s+db\\s+reset\\b',
  ])
    assert.ok(dbPatterns.includes(kept), `있던 항목이 빠졌다: ${kept}`);
  assert.deepEqual(dbClients, ['supabase-db']);
});

// 훅은 모든 Bash 호출에서 dbPatterns를 돌린다. 플래그가 많은 긴 명령에서 역추적이 폭주하면 훅이 멈춘다.
// 판정은 자식 프로세스에서 돌려 시간 제한을 건다(폭주하면 이 프로세스 안에서는 끊을 수 없다).
// 입력은 표준 입력으로 넘긴다. 환경 변수나 인자로 넘기면 OS의 길이 한도에 걸린다
// (Linux는 문자열 하나에 131072바이트, Windows는 환경 블록 전체에 32767자).
const TIMING = `
const { patterns, inputs } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
let hits = 0;
for (const p of patterns) { const re = new RegExp(p, 'i'); for (const s of inputs) if (re.test(s)) hits += 1; }
process.stdout.write(String(hits));
`;

test('웹 프로파일의 dbPatterns는 플래그가 많은 긴 명령에서도 판정이 끝난다(역추적 폭주 없음)', () => {
  const { dbPatterns } = loadConfig(webRepo()).guard;
  const many = (unit: string, n: number) => unit.repeat(n);
  const inputs = [
    // 금지 하위 명령으로 끝나지 않는 긴 명령(맞지 않는 쪽이 역추적이 가장 많다)
    `drizzle-kit ${many('--config ', 40)}generate`,
    `drizzle-kit ${many('--config a ', 2000)}generate`,
    `drizzle-kit ${many('--a-b-c=d ', 2000)}generate`,
    `drizzle-kit ${many('-x ', 5000)}check`,
    `drizzle-kit ${many('--config a ', 2000)}`,
    `${many('drizzle-kit --verbose ', 2000)}up`,
  ];
  const r = spawnSync(process.execPath, ['-e', TIMING], {
    encoding: 'utf8',
    timeout: 20_000,
    input: JSON.stringify({ patterns: dbPatterns, inputs }),
  });
  assert.equal(
    r.error,
    undefined,
    `판정이 시간 안에 끝나지 않았거나 실행하지 못했다: ${r.error?.message}`,
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '0', '금지 하위 명령이 없는 명령이 패턴에 맞았다');
});

test('웹 프로파일: 플래그가 아주 많아도 끝의 금지 하위 명령을 막는다', () => {
  const r = bash(`drizzle-kit ${'--config a '.repeat(500)}migrate`, webCtx());
  assert.ok(r?.rule.startsWith('R13'), `막혀야 한다 → ${r?.rule}`);
});

// 값을 직접 넣는 위 테스트는 훅이 설정을 읽는 길을 보지 못한다. 여기서는 훅을 프로세스로 부른다.
function runGuard(cwd: string, command: string): { code: number; stderr: string } {
  const r = runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/hooks/guard.ts')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }),
  });
  return { code: r.code, stderr: r.stderr };
}

/** harness.config.json의 guard.dbCommands를 바꾼다. undefined면 키를 지운다 */
function setDbCommands(root: string, value: unknown): void {
  const f = path.join(root, 'harness.config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8')) as { guard: Record<string, unknown> };
  if (value === undefined) delete cfg.guard.dbCommands;
  else cfg.guard.dbCommands = value;
  writeFileSync(f, JSON.stringify(cfg, null, 2));
}

test('guard 프로세스: 실제 훅이 웹 프로파일의 dbCommands를 메인 체크아웃에서 읽어 막는다', () => {
  const dir = tmp('harness-profile-web-db-hook-');
  const main = path.join(dir, 'repo');
  gitInit(main);
  applyWeb(main);
  commitAll(main);
  const forbidden = 'drizzle-kit --config "team config.ts" migrate';
  const blocked = runGuard(main, forbidden);
  assert.equal(blocked.code, 2, blocked.stderr);
  assert.match(blocked.stderr, /R13/);
  assert.equal(runGuard(main, 'drizzle-kit generate').code, 0);

  // 연결 worktree의 설정에서 목록을 비우거나 키를 지워도 메인 체크아웃의 설정으로 막는다
  const wt = path.join(dir, 'wt');
  sh('git', ['worktree', 'add', '-q', '-b', 'chore/20261121-relax-s0', wt], main);
  setDbCommands(wt, []);
  const inWt = runGuard(wt, forbidden);
  assert.equal(inWt.code, 2, 'worktree의 빈 목록이 메인의 차단을 풀지 못한다');
  assert.match(inWt.stderr, /R13/);
  setDbCommands(wt, undefined);
  const noKey = runGuard(wt, forbidden);
  assert.equal(noKey.code, 2, 'worktree에 키가 없어도 메인의 차단이 남는다');
  assert.match(noKey.stderr, /R13/);

  // 대조: 메인 체크아웃의 목록을 비우면 풀린다(막던 것은 웹 프로파일의 항목이다). 코어 기본 항목은 남는다
  setDbCommands(main, []);
  assert.equal(runGuard(main, forbidden).code, 0);
  assert.equal(runGuard(wt, forbidden).code, 0);
  const push = runGuard(main, 'drizzle-kit --config x push');
  assert.equal(push.code, 2);
  assert.match(push.stderr, /R13/);
});

/** profiles/web/README.md의 `## DB` 절(다음 `## ` 제목 앞까지) */
function readmeDbSection(): string[] {
  const lines = readFileSync(path.join(HARNESS_ROOT, 'profiles/web/README.md'), 'utf8').split('\n');
  const start = lines.indexOf('## DB');
  assert.ok(start >= 0, 'README에 "## DB" 절이 없다');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

/** "명령" 표에서 훅 칸이 mark인 행들의 첫 칸에 백틱으로 적힌 이름 */
function commandNames(section: string[], mark: string): string[] {
  const names: string[] = [];
  for (const line of section) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells[2] !== mark) continue;
    for (const m of cells[1].matchAll(/`([^`]+)`/g)) names.push(m[1]);
  }
  return names.sort();
}

test('README의 DB 절: 금지·허용 명령의 표가 웹 프로파일의 설정과 같다', () => {
  const section = readmeDbSection();
  const entry = loadConfig(webRepo()).guard.dbCommands.find((e) => e.tool === 'drizzle-kit');
  assert.ok(entry, '웹 프로파일의 dbCommands에 drizzle-kit 항목이 없다');
  const forbidden = commandNames(section, '금지');
  const allowed = commandNames(section, '허용');
  assert.deepEqual(forbidden, [...entry.forbidden].sort(), '표의 금지 명령과 설정이 다르다');
  assert.deepEqual(allowed, [...ALLOWED].sort(), '표의 허용 명령이 다르다');
  assert.deepEqual(
    allowed.filter((n) => forbidden.includes(n)),
    [],
    '허용과 금지에 함께 든 이름이 있다',
  );
});

test('README의 DB 절: 확인한 버전이 실측 결과 파일과 같다', () => {
  const section = readmeDbSection();
  const result = JSON.parse(
    readFileSync(path.join(HARNESS_ROOT, 'lab/q10-db/results/darwin-arm64.json'), 'utf8'),
  ) as { packages: Record<string, string> };
  for (const name of ['drizzle-orm', 'drizzle-kit', '@electric-sql/pglite']) {
    const version = result.packages[name];
    assert.ok(version, `결과 파일에 ${name}의 버전이 없다`);
    assert.ok(
      section.some((l) => l.includes(`\`${name}\` ${version}`)),
      `DB 절에 "\`${name}\` ${version}"이 없다`,
    );
  }
});
