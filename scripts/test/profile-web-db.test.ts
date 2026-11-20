// 웹 프로파일(profiles/web)의 DB 차단 목록: Drizzle(ADR-0007)의 명령 가운데 DB에 접속하는 것과
// 마이그레이션 파일을 지우는 것을 L1 훅이 막는다(R13, 설계서 14.3절). 파일만 다루는 명령은 막지 않는다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { init } from '../commands/init.ts';
import { evaluate, type GuardContext } from '../hooks/rules.ts';
import { loadConfig } from '../lib/config.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

/** 이 리포의 profiles/web과 harness.config.json을 임시 폴더에 복사하고 웹 프로파일을 적용한다 */
function webRepo(): string {
  const root = tmp('harness-profile-web-db-');
  cpSync(path.join(HARNESS_ROOT, 'profiles', 'web'), path.join(root, 'profiles', 'web'), {
    recursive: true,
  });
  cpSync(path.join(HARNESS_ROOT, 'harness.config.json'), path.join(root, 'harness.config.json'));
  assert.equal(init(root, 'web', {}), 0);
  return root;
}

const ctx = (dbPatterns: string[], dbClients: string[]): GuardContext => ({
  repo: null,
  hasPlan: () => true,
  dbPatterns,
  dbClients,
  home: '/Users/someone',
});

/** 웹 프로파일을 적용한 리포의 설정으로 만든 훅 컨텍스트 */
function webCtx(): GuardContext {
  const guard = loadConfig(webRepo()).guard;
  return ctx(guard.dbPatterns, guard.dbClients);
}

const bash = (command: string, c: GuardContext) =>
  evaluate({ kind: 'bash', command, cwd: '/work/repo' }, c);

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
  // 플래그의 값에 공백이 든 형태. 훅은 따옴표를 푼 인자를 공백으로 이은 글을 보므로 값이 여러 토막으로 보인다
  'drizzle-kit --config "team config.ts" migrate',
  "drizzle-kit --config='team config.ts' push",
  'pnpm exec drizzle-kit --config "my project/drizzle.config.ts" --verbose studio',
  'npx drizzle-kit@latest --config "a b c.ts" drop',
  'drizzle-kit --config "a (b).ts" migrate',
  'drizzle-kit --verbose migrate; git status',
];

// 파일만 다루는 명령과 상관없는 명령
const ALLOW = [
  'pnpm exec drizzle-kit generate',
  'pnpm exec drizzle-kit generate --name add-migrate-log',
  'pnpm exec drizzle-kit generate --name push-notifications',
  'drizzle-kit --config drizzle.config.ts generate',
  'drizzle-kit check',
  'drizzle-kit export',
  'drizzle-kit up',
  'pnpm test',
  'npx drizzle-kit@0.31.11 generate',
  'node node_modules/drizzle-kit/bin.cjs generate --name add-pull-log',
  'pnpm add -D --save-exact drizzle-kit@0.31.11',
  'cat node_modules/drizzle-kit/package.json',
  'ls node_modules/drizzle-kit',
  // 값에 공백이 든 플래그 뒤에 허용된 하위 명령이 오면 막지 않는다(그 뒤의 인자는 보지 않는다)
  'drizzle-kit --config "team config.ts" generate',
  'drizzle-kit --config "team config.ts" generate --name add-migrate-log',
  'drizzle-kit --config "team config.ts" generate --name migrate',
  'drizzle-kit --config "team config.ts" check',
  // 다른 명령과 이어 쓴 경우: 뒤따르는 명령의 낱말을 drizzle-kit의 하위 명령으로 보지 않는다
  'drizzle-kit --version && git pull',
  'drizzle-kit --config x.ts generate; git pull',
  'drizzle-kit --help | grep push',
  'drizzle-kit --config x.ts check || git pull --rebase',
  // 구분 기호가 낱말에 붙어 있어도 뒤따르는 명령으로 넘어가지 않는다
  'drizzle-kit --version; git pull',
  'drizzle-kit --help;git pull',
  'drizzle-kit --config x.ts; git pull',
  'drizzle-kit --version&& git pull',
  'drizzle-kit --help|grep push',
  '(cd web && drizzle-kit --config x.ts generate) && git pull',
];

test('웹 프로파일: DB에 접속하는 drizzle-kit 명령과 drop을 막는다(R13)', () => {
  const c = webCtx();
  for (const cmd of BLOCK_DIRECT) {
    const r = bash(cmd, c);
    assert.ok(r, `막혀야 한다: ${cmd}`);
    assert.ok(r.rule.startsWith('R13'), `${cmd} → ${r.rule} (기대 R13)`);
  }
});

test('웹 프로파일: 플래그가 하위 명령 앞에 와도 막는다(R13)', () => {
  const c = webCtx();
  for (const cmd of BLOCK_FLAG_FIRST) {
    const r = bash(cmd, c);
    assert.ok(r, `막혀야 한다: ${cmd}`);
    assert.ok(r.rule.startsWith('R13'), `${cmd} → ${r.rule} (기대 R13)`);
  }
});

test('웹 프로파일: 파일만 다루는 drizzle-kit 명령(generate, check, export, up)은 막지 않는다', () => {
  const c = webCtx();
  for (const cmd of ALLOW) {
    const r = bash(cmd, c);
    assert.equal(r, null, `허용되어야 한다: ${cmd} → ${r?.rule}: ${r?.what}`);
  }
});

test('웹 프로파일: 플래그의 값이 금지 명령의 이름이면 막힌다(엄한 쪽의 오탐, README에 적었다)', () => {
  const r = bash('drizzle-kit --name migrate generate', webCtx());
  assert.ok(r?.rule.startsWith('R13'), `막혀야 한다 → ${r?.rule}`);
});

test('프로파일이 더한 것이다: 프로파일 패턴이 없으면 migrate는 막히지 않고 push는 코어가 막는다', () => {
  const core = ctx([], []);
  assert.equal(bash('drizzle-kit migrate', core), null);
  assert.equal(bash('drizzle-kit studio', core), null);
  assert.ok(bash('drizzle-kit push', core)?.rule.startsWith('R13'));
});

test('코어 패턴은 플래그가 앞에 오는 push를 놓치고, 웹 프로파일의 패턴이 막는다', () => {
  const cmd = 'pnpm exec drizzle-kit --config drizzle.config.ts push';
  assert.equal(
    bash(cmd, ctx([], [])),
    null,
    '코어 패턴의 틈(기술 부채 표)이 메워졌으면 이 단언을 고친다',
  );
  assert.ok(bash(cmd, webCtx())?.rule.startsWith('R13'));
});

test('웹 프로파일의 dbPatterns는 모두 정규식으로 컴파일되고, 있던 항목이 그대로 있다', () => {
  const { dbPatterns, dbClients } = loadConfig(webRepo()).guard;
  for (const p of dbPatterns) assert.doesNotThrow(() => new RegExp(p, 'i'), p);
  for (const kept of [
    '\\btypeorm\\s+schema:(drop|sync)\\b',
    '\\bsequelize\\s+db:drop\\b',
    '\\bknex\\s+migrate:rollback\\b.*--all',
    '\\bsupabase\\s+db\\s+reset\\b',
  ])
    assert.ok(dbPatterns.includes(kept), `있던 항목이 빠졌다: ${kept}`);
  assert.ok(
    dbPatterns.some((p) => p.includes('drizzle-kit')),
    'drizzle-kit 항목이 없다',
  );
  assert.deepEqual(dbClients, ['supabase-db']);
});

// 훅은 모든 Bash 호출에서 이 패턴을 돌린다. 플래그가 많은 긴 명령에서 역추적이 폭주하면 훅이 멈춘다.
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
    `drizzle-kit ${many('--config a b c ', 2000)}generate`,
    `drizzle-kit ${many('--a-b-c=d ', 2000)}generate`,
    `drizzle-kit ${many('-x ', 5000)}check`,
    `drizzle-kit ${many('--config a b c ', 2000)}`,
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
  const r = bash(`drizzle-kit ${'--config a b c '.repeat(500)}migrate`, webCtx());
  assert.ok(r?.rule.startsWith('R13'), `막혀야 한다 → ${r?.rule}`);
});
