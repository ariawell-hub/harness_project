// 웹 프로파일(profiles/web)의 DB 차단 목록: Drizzle(ADR-0007)의 명령 가운데 DB에 접속하는 것과
// 마이그레이션 파일을 지우는 것을 L1 훅이 막는다(R13, 설계서 14.3절). 파일만 다루는 명령은 막지 않는다.
import assert from 'node:assert/strict';
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
