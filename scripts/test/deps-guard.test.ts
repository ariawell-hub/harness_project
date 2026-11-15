// deps-guard(R17, Q14)와 pnpm lockfile 파서. 계획 20261114-ci-gates step3. 네트워크는 쓰지 않는다(가짜 레지스트리).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { parsePnpmLock, splitSpec } from '../lib/lockfile.ts';
import { depsGuard, licenseAllowed, type Registry } from '../gates/deps-guard.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const lock = (pkgs: string[], direct: string[] = []) =>
  `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    devDependencies:\n${direct
    .map(
      (d) =>
        `      ${d.startsWith('@') ? `'${d}'` : d}:\n        specifier: 1.0.0\n        version: 1.0.0\n`,
    )
    .join('')}\npackages:\n\n${pkgs
    .map((p) => `  ${p.startsWith('@') ? `'${p}'` : p}:\n    resolution: {integrity: sha512-x}\n`)
    .join('\n')}\nsnapshots:\n\n${pkgs.map((p) => `  ${p}: {}\n`).join('\n')}`;

test('splitSpec: 스코프와 피어 접미사', () => {
  assert.deepEqual(splitSpec('prettier@3.9.10'), { name: 'prettier', version: '3.9.10' });
  assert.deepEqual(splitSpec('@types/node@22.20.5'), { name: '@types/node', version: '22.20.5' });
  assert.deepEqual(splitSpec('a@1.0.0(react@18.0.0)'), { name: 'a', version: '1.0.0' });
});

test('parsePnpmLock: packages 키와 importers의 직접 의존성', () => {
  const real = parsePnpmLock(readFileSync(path.join(HARNESS_ROOT, 'pnpm-lock.yaml'), 'utf8'));
  assert.ok(real.packages.has('@types/node@22.20.5'));
  assert.ok(real.packages.has('undici-types@6.21.0'));
  assert.ok(![...real.packages].some((p) => p.includes('resolution')));
  assert.deepEqual([...real.direct.get('.')!].sort(), ['@types/node', 'prettier', 'typescript']);
  const t = parsePnpmLock(lock(['a@1.0.0', '@s/b@2.0.0'], ['a', '@s/b']));
  assert.deepEqual([...t.packages].sort(), ['@s/b@2.0.0', 'a@1.0.0']);
  assert.deepEqual([...t.direct.get('.')!].sort(), ['@s/b', 'a']);
});

test('licenseAllowed: SPDX 식의 OR는 하나, AND는 모두', () => {
  const ok = ['MIT', 'Apache-2.0', 'ISC'];
  assert.equal(licenseAllowed('MIT', ok), true);
  assert.equal(licenseAllowed('(MIT OR GPL-3.0)', ok), true);
  assert.equal(licenseAllowed('(MIT AND GPL-3.0)', ok), false);
  assert.equal(licenseAllowed('(MIT OR GPL-3.0) AND GPL-2.0', ok), false);
  assert.equal(licenseAllowed('(MIT OR GPL-3.0) AND ISC', ok), true);
  assert.equal(licenseAllowed({ type: 'ISC' }, ok), true);
  assert.equal(licenseAllowed('GPL-3.0', ok), false);
  assert.equal(licenseAllowed(undefined, ok), false);
  assert.equal(licenseAllowed('SEE LICENSE IN x', ok), false);
});

const NOW = new Date('2026-11-15T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

function fake(
  pkgs: Record<string, { days?: number; license?: unknown } | null>,
  vulns: Record<string, string[]> = {},
): Registry & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async packument(name) {
      calls.push(name);
      const hit = Object.entries(pkgs).filter(([k]) => splitSpec(k).name === name);
      if (!hit.length || hit.every(([, v]) => v === null)) return null;
      const time: Record<string, string> = {};
      const versions: Record<string, unknown> = {};
      for (const [k, v] of hit) {
        const ver = splitSpec(k).version;
        time[ver] = daysAgo(v!.days ?? 30);
        versions[ver] = { license: 'license' in v! ? v!.license : 'MIT' };
      }
      return { time, versions };
    },
    async osv(q) {
      calls.push('osv');
      return {
        results: q.map((x) => ({
          vulns: (vulns[`${x.name}@${x.version}`] ?? []).map((id) => ({ id })),
        })),
      };
    },
  };
}

function repo(head: { pkgs: string[]; direct?: string[]; adr?: string }): {
  root: string;
  base: string;
  cfg: HarnessConfig;
} {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  write(root, 'pnpm-lock.yaml', lock(['a@1.0.0'], ['a']));
  write(root, 'src/a.ts', 'export {}\n');
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', 'feat/20261114-demo-s0'], root);
  write(root, 'pnpm-lock.yaml', lock(head.pkgs, head.direct ?? ['a']));
  write(root, 'src/a.ts', 'export const a = 1\n');
  if (head.adr) write(root, 'docs/decisions/ADR-0009-x.md', head.adr);
  commitAll(root, 'change');
  return { root, base, cfg: loadConfig(root) };
}

const run = (r: ReturnType<typeof repo>, registry: Registry) =>
  depsGuard({ ...r, registry, now: NOW });

test('deps-guard: lockfile이 안 바뀌면 네트워크 없이 통과', async () => {
  const reg = fake({});
  const g = await run(repo({ pkgs: ['a@1.0.0'] }), reg);
  assert.equal(g.state, 'success');
  assert.match(g.description, /lockfile 변경 없음/);
  assert.deepEqual(reg.calls, []);
});

test('deps-guard: 새 버전이 기준을 모두 지키면 통과(전이 의존성, 버전 업)', async () => {
  const reg = fake({ 'a@1.1.0': {}, '@s/b@2.0.0': { license: 'ISC' } });
  const g = await run(repo({ pkgs: ['a@1.1.0', '@s/b@2.0.0'] }), reg);
  assert.equal(g.state, 'success', g.details.join('\n'));
  assert.match(g.description, /2개/);
  assert.deepEqual(reg.calls.sort(), ['@s/b', 'a', 'osv']);
});

test('deps-guard: 레지스트리에 없음, 게시 13일, 허용 밖 라이선스, 취약점은 실패', async () => {
  const cases: [Parameters<typeof fake>, RegExp][] = [
    [[{ 'b@1.0.0': null }], /레지스트리에 없다/],
    [[{ 'b@1.0.0': { days: 13 } }], /게시 후 13일/],
    [[{ 'b@1.0.0': { license: 'GPL-3.0' } }], /라이선스/],
    [[{ 'b@1.0.0': { license: undefined } }], /라이선스/],
    [[{ 'b@1.0.0': {} }, { 'b@1.0.0': ['GHSA-xxxx'] }], /GHSA-xxxx/],
  ];
  for (const [args, re] of cases) {
    const g = await run(repo({ pkgs: ['a@1.0.0', 'b@1.0.0'] }), fake(...args));
    assert.equal(g.state, 'failure', String(re));
    assert.match(g.details.join('\n'), re);
  }
  const ok = await run(repo({ pkgs: ['a@1.0.0', 'b@1.0.0'] }), fake({ 'b@1.0.0': { days: 14 } }));
  assert.equal(ok.state, 'success');
});

test('deps-guard: 새 직접 의존성은 같은 PR의 ADR이 이름을 언급해야 한다', async () => {
  const reg = () => fake({ 'b@1.0.0': {} });
  const no = await run(repo({ pkgs: ['a@1.0.0', 'b@1.0.0'], direct: ['a', 'b'] }), reg());
  assert.equal(no.state, 'failure');
  assert.match(no.details.join('\n'), /ADR/);
  const other = await run(
    repo({ pkgs: ['a@1.0.0', 'b@1.0.0'], direct: ['a', 'b'], adr: '# ADR\n다른 패키지 c\n' }),
    reg(),
  );
  assert.equal(other.state, 'failure');
  const yes = await run(
    repo({ pkgs: ['a@1.0.0', 'b@1.0.0'], direct: ['a', 'b'], adr: '# ADR\n`b`를 쓴다\n' }),
    reg(),
  );
  assert.equal(yes.state, 'success', yes.details.join('\n'));
});

test('deps-guard: 조회 실패·응답 형식 오류는 error(fail-closed)', async () => {
  const boom: Registry = {
    packument: async () => {
      throw new Error('ETIMEDOUT');
    },
    osv: async () => ({ results: [] }),
  };
  assert.equal((await run(repo({ pkgs: ['a@1.0.0', 'b@1.0.0'] }), boom)).state, 'error');
  const badOsv: Registry = { ...fake({ 'b@1.0.0': {} }), osv: async () => ({}) };
  assert.equal((await run(repo({ pkgs: ['a@1.0.0', 'b@1.0.0'] }), badOsv)).state, 'error');
});
