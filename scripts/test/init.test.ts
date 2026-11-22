// init: 대상 리포(--repo), 쓰지 않는 실행(--dry-run), 바뀌는 것이 없으면 설정 파일을 다시 쓰지 않는다(TD-31, Issue #208).
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { changedKeys, fileKey, init, resolvesInside } from '../commands/init.ts';
import { CONFIG_FILE, loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { gitInit, HARNESS_ROOT, tmp } from './helpers.ts';

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });

/** 이 리포의 profiles/와 harness.config.json(core 프로파일이 적용된 것)을 임시 폴더에 복사한다 */
function templateCopy(): string {
  const root = tmp('harness-init-');
  cpSync(path.join(HARNESS_ROOT, 'profiles'), path.join(root, 'profiles'), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, CONFIG_FILE), path.join(root, CONFIG_FILE));
  return root;
}

const cfgText = (root: string) => readFileSync(path.join(root, CONFIG_FILE), 'utf8');

/** 폴더 아래 모든 파일의 상대 경로와 내용(경로순). 실행 전후를 견줘 아무것도 바뀌거나 생기지 않았는지 본다 */
function snapshot(root: string): [string, string][] {
  return (readdirSync(root, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath, d.name))
    .map((f): [string, string] => [
      path.relative(root, f).split(path.sep).join('/'),
      readFileSync(f).toString('base64'),
    ])
    .sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

const PLACEHOLDER = '# 구조\n\n<!-- harness:placeholder -->\n';

/** 심볼릭 링크를 만들 수 있는 환경인가(개발자 모드가 꺼진 Windows는 못 만든다, ADR-0005) */
function canSymlink(): boolean {
  const d = tmp('harness-init-probe-');
  try {
    symlinkSync(path.join(d, 'none'), path.join(d, 'probe'));
    return true;
  } catch {
    return false;
  }
}

const WEB_TEMPLATES = [
  'docs/product/TEMPLATE.md',
  'docs/decisions/TEMPLATE.md',
  'ARCHITECTURE.md',
  'e2e/smoke.spec.ts',
];

test('init: 같은 프로파일이 이미 적용된 리포에서는 설정 파일을 다시 쓰지 않는다(바이트가 그대로다)', () => {
  const root = templateCopy();
  const before = cfgText(root);
  // 이 리포의 설정은 포맷터의 서식이라 JSON.stringify로 다시 쓰면 바이트가 달라진다
  assert.notEqual(before, JSON.stringify(JSON.parse(before), null, 2) + '\n');
  assert.equal(init(root, 'core', {}), 0);
  assert.equal(cfgText(root), before);
});

test('init: 서식과 키의 순서만 다른 설정도 다시 쓰지 않는다', () => {
  const root = templateCopy();
  const cfg = JSON.parse(cfgText(root)) as Record<string, Record<string, unknown>>;
  // 프로파일이 정하는 항목(commands)의 키 순서를 뒤집고 한 줄로 적는다
  cfg.commands = Object.fromEntries(Object.entries(cfg.commands).reverse());
  const oneLine = JSON.stringify(cfg) + '\n';
  writeFileSync(path.join(root, CONFIG_FILE), oneLine);
  assert.equal(init(root, 'core', {}), 0);
  assert.equal(cfgText(root), oneLine);
});

test('init: 바뀌는 항목이 있으면 전처럼 적용하고, 다시 실행하면 그대로 둔다', () => {
  const root = templateCopy();
  const before = JSON.parse(cfgText(root)) as Record<string, unknown>;
  const profile = JSON.parse(
    readFileSync(path.join(root, 'profiles/web/profile.json'), 'utf8'),
  ) as { version: string; config: Record<string, unknown> };
  assert.equal(init(root, 'web', { owner: 'maker-x', bot: 'bot-x' }), 0);
  // 결과는 전과 같다: 프로파일의 항목을 덮어쓰고 나머지는 그대로이며, 들여쓰기 2칸으로 쓴다
  const want = {
    ...before,
    ...profile.config,
    profile: 'web',
    profileVersion: `web@${profile.version}`,
    github: { ...(before.github as object), owner: 'maker-x', bot: 'bot-x' },
  };
  const written = cfgText(root);
  assert.equal(written, JSON.stringify(want, null, 2) + '\n');
  assert.equal(loadConfig(root).profile, 'web');
  for (const t of WEB_TEMPLATES) assert.ok(existsSync(path.join(root, t)), t);
  // 같은 인자로 다시: 서식을 바꿔 둬도 내용이 같으면 쓰지 않는다
  const compact = JSON.stringify(JSON.parse(written)) + '\n';
  writeFileSync(path.join(root, CONFIG_FILE), compact);
  assert.equal(init(root, 'web', { owner: 'maker-x', bot: 'bot-x' }), 0);
  assert.equal(cfgText(root), compact);
  // 계정만 달라도 바뀐 것이다
  assert.equal(init(root, 'web', { owner: 'maker-y' }), 0);
  assert.equal(loadConfig(root).github.owner, 'maker-y');
  assert.equal(loadConfig(root).github.bot, 'bot-x');
});

test('init: dryRun이면 어떤 파일도 바뀌거나 생기지 않는다', () => {
  const root = templateCopy();
  writeFileSync(path.join(root, 'ARCHITECTURE.md'), PLACEHOLDER);
  const before = cfgText(root);
  const listed = snapshot(root);
  assert.equal(init(root, 'web', { owner: 'maker-x', dryRun: true }), 0);
  assert.equal(cfgText(root), before);
  assert.deepEqual(snapshot(root), listed);
});

test('changedKeys: 값이 달라진 항목만, 객체는 그 아래 키까지 적는다. 키의 순서는 보지 않는다', () => {
  const before = {
    a: 1,
    b: { x: 1, y: [1, 2], z: { p: 1, q: 2 } },
    c: [1, 2],
    gone: true,
    same: { k: 'v' },
  };
  assert.deepEqual(changedKeys(before, before), []);
  assert.deepEqual(
    changedKeys(before, {
      same: { k: 'v' },
      c: [2, 1],
      b: { z: { q: 2, p: 1 }, y: [1, 2], x: 2, added: null },
      a: 1,
      fresh: 0,
    }),
    ['b.x', 'b.added', 'c', 'gone', 'fresh'],
  );
  // 한쪽만 객체면 그 항목의 이름만 적는다
  assert.deepEqual(changedKeys({ a: { x: 1 } }, { a: null }), ['a']);
  assert.deepEqual(changedKeys({ a: [1] }, { a: { 0: 1 } }), ['a']);
});

/** 리포의 웹 프로파일을 다른 리포와 구별되게 바꾼다: 버전, 설정값 하나, 템플릿 하나의 글 */
function markProfile(root: string, version: string, timeoutSec: number, prd: string): void {
  const pf = path.join(root, 'profiles/web/profile.json');
  const p = JSON.parse(readFileSync(pf, 'utf8')) as {
    version: string;
    config: { commands: { test: { timeoutSec: number } } };
  };
  p.version = version;
  p.config.commands.test.timeoutSec = timeoutSec;
  writeFileSync(pf, JSON.stringify(p, null, 2) + '\n');
  writeFileSync(path.join(root, 'profiles/web/templates/PRD.md'), prd);
}

test('CLI init --repo: 가리킨 리포의 프로파일·템플릿을 읽어 그 리포에만 적용하고, 명령을 실행한 리포는 그대로 둔다', () => {
  const here = templateCopy();
  gitInit(here);
  const there = templateCopy();
  // 두 리포의 프로파일과 템플릿을 다르게 해, 어느 쪽에서 읽었는지 결과로 가린다
  markProfile(here, '1.1.1', 1111, '실행한 리포의 템플릿\n');
  markProfile(there, '9.9.9', 9999, '가리킨 리포의 템플릿\n');
  // 자리 표시 파일은 템플릿으로 바뀌고, 그렇지 않은 있던 파일은 그대로다
  writeFileSync(path.join(there, 'ARCHITECTURE.md'), PLACEHOLDER);
  mkdirSync(path.join(there, 'e2e'));
  writeFileSync(path.join(there, 'e2e/smoke.spec.ts'), '// 내 시나리오\n');
  const hereFiles = snapshot(here);
  const r = cli(['init', '--profile', 'web', '--repo', there, '--owner', 'maker-x'], here);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(snapshot(here), hereFiles, '명령을 실행한 리포의 파일은 그대로다');
  const cfg = loadConfig(there);
  assert.equal(cfg.profile, 'web');
  assert.equal(cfg.profileVersion, 'web@9.9.9');
  assert.equal(cfg.commands.test?.timeoutSec, 9999);
  assert.equal(cfg.github.owner, 'maker-x');
  assert.equal(
    readFileSync(path.join(there, 'docs/product/TEMPLATE.md'), 'utf8'),
    '가리킨 리포의 템플릿\n',
  );
  assert.equal(
    readFileSync(path.join(there, 'ARCHITECTURE.md'), 'utf8'),
    readFileSync(path.join(there, 'profiles/web/templates/ARCHITECTURE.md'), 'utf8'),
  );
  assert.equal(readFileSync(path.join(there, 'e2e/smoke.spec.ts'), 'utf8'), '// 내 시나리오\n');
  assert.ok(existsSync(path.join(there, 'docs/decisions/TEMPLATE.md')));
  assert.match(r.stdout, /프로파일 web@9\.9\.9을 harness\.config\.json에 적용했다\. 바뀐 항목: /);
  assert.match(r.stdout, /github\.owner/);
  assert.match(r.stdout, /- 건너뜀\(이미 있음\): e2e\/smoke\.spec\.ts/);
  assert.match(r.stdout, /node scripts\/harness\.ts fmt/);
  assert.match(r.stdout, /남은 수동 작업/);
});

test('CLI init --repo: 상대 경로는 명령을 실행한 폴더 기준이고, --repo가 없으면 지금처럼 실행한 리포에 적용한다', () => {
  const here = templateCopy();
  gitInit(here);
  cpSync(path.join(HARNESS_ROOT, 'profiles'), path.join(here, 'sub/profiles'), { recursive: true });
  cpSync(path.join(HARNESS_ROOT, CONFIG_FILE), path.join(here, 'sub', CONFIG_FILE));
  const before = cfgText(here);
  const rel = cli(['init', '--profile', 'web', '--repo', 'sub'], here);
  assert.equal(rel.code, 0, rel.stderr);
  assert.equal(cfgText(here), before);
  assert.equal(loadConfig(path.join(here, 'sub')).profile, 'web');
  const plain = cli(['init', '--profile', 'web'], here);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(loadConfig(here).profile, 'web');
});

test('CLI init --dry-run: 쓰지 않고 바뀔 항목·복사될 템플릿·안내를 출력한다', () => {
  const root = templateCopy();
  gitInit(root);
  // 복사 대상인 자리 표시 파일과, 건너뛸 있던 파일을 둔다. 둘 다 바이트가 그대로여야 한다
  writeFileSync(path.join(root, 'ARCHITECTURE.md'), PLACEHOLDER);
  mkdirSync(path.join(root, 'e2e'));
  writeFileSync(path.join(root, 'e2e/smoke.spec.ts'), '// 내 시나리오\n');
  const before = cfgText(root);
  const listed = snapshot(root);
  const r = cli(['init', '--profile', 'web', '--owner', 'maker-x', '--dry-run'], root);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(cfgText(root), before);
  assert.deepEqual(snapshot(root), listed);
  assert.match(r.stdout, /- 건너뜀\(이미 있음\): e2e\/smoke\.spec\.ts/);
  assert.doesNotMatch(r.stdout, /- 템플릿 복사: /);
  assert.match(r.stdout, /^\[dry-run\] 파일을 쓰지 않는다/);
  assert.match(
    r.stdout,
    /프로파일 web@\S+을 적용하면 harness\.config\.json의 다음 항목이 바뀐다: /,
  );
  for (const k of ['profile', 'profileVersion', 'github.owner', 'commands.'])
    assert.ok(r.stdout.includes(k), k);
  for (const t of WEB_TEMPLATES.filter((x) => x !== 'e2e/smoke.spec.ts'))
    assert.ok(r.stdout.includes(`- 템플릿 복사 예정: ${t}`), t);
  assert.match(r.stdout, /남은 수동 작업/);
  assert.doesNotMatch(r.stdout, /적용했다/);
  // 바뀌는 것이 없는 리포: 그렇게 알리고 쓰지 않는다
  const same = cli(['init', '--profile', 'core', '--dry-run'], root);
  assert.equal(same.code, 0, same.stderr);
  assert.match(
    same.stdout,
    /프로파일 core@\S+은 이미 적용돼 있다: harness\.config\.json에서 바뀌는 항목이 없다/,
  );
  assert.equal(cfgText(root), before);
});

test('CLI init: 이미 적용된 리포에서는 다시 쓰지 않았다고 알리고 안내는 그대로 낸다', () => {
  const root = templateCopy();
  gitInit(root);
  const before = cfgText(root);
  const r = cli(['init', '--profile', 'core'], root);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(cfgText(root), before);
  assert.match(
    r.stdout,
    /프로파일 core@\S+은 이미 적용돼 있다: harness\.config\.json을 다시 쓰지 않았다/,
  );
  assert.match(r.stdout, /남은 수동 작업/);
});

test('CLI --dry-run: 값을 붙이거나 init이 아닌 명령에 주면 실행 없이 종료 코드 2다', () => {
  const root = templateCopy();
  gitInit(root);
  const before = cfgText(root);
  const listed = snapshot(root);
  // 같은 옵션을 거듭 주면 파서에는 마지막 값만 남는다. 값을 붙인 것이 앞에 있어도 뒤에 있어도 거절한다
  for (const v of [
    ['--dry-run=false'],
    ['--dry-run=true'],
    ['--dry-run='],
    ['--dry-run=false', '--dry-run'],
    ['--dry-run', '--dry-run=false'],
  ]) {
    const r = cli(['init', '--profile', 'web', ...v], root);
    assert.equal(r.code, 2, `${v.join(' ')}: ${r.stdout}`);
    assert.match(r.stderr, /--dry-run은 값을 받지 않는다/);
  }
  // 문자열 옵션의 값 자리에 온 글자는 옵션이 아니다(--owner의 값이다). 뒤의 --dry-run이 쓰기를 막는다
  const asValue = cli(['init', '--profile', 'core', '--dry-run', '--owner', '--dry-run=x'], root);
  assert.equal(asValue.code, 0, asValue.stderr);
  assert.match(asValue.stdout, /다음 항목이 바뀐다: github\.owner/);
  for (const cmd of ['codeowners', 'fmt', 'start']) {
    const r = cli([cmd, '--dry-run'], root);
    assert.equal(r.code, 2, `${cmd}: ${r.stdout}`);
    assert.match(r.stderr, /--dry-run은 init에서만 쓴다/);
  }
  assert.equal(cfgText(root), before);
  assert.deepEqual(snapshot(root), listed);
});

test('CLI init: 설정 파일이나 프로파일이 없는 폴더는 이유를 내고 종료 코드 1이다(아무것도 쓰지 않는다)', () => {
  const here = templateCopy();
  gitInit(here);
  const empty = tmp('harness-init-empty-');
  const noCfg = cli(['init', '--profile', 'web', '--repo', empty], here);
  assert.equal(noCfg.code, 1);
  assert.match(noCfg.stderr, /설정 파일이 없다: /);
  assert.doesNotMatch(noCfg.stderr, /\n\s+at /, '스택이 아니라 이유를 낸다');
  assert.deepEqual(snapshot(empty), []);
  const noProfile = cli(['init', '--profile', 'nope'], here);
  assert.equal(noProfile.code, 1);
  assert.match(noProfile.stderr, /프로파일이 없다: /);
});

test('init: 대상 폴더의 파일이 밖을 가리키는 심볼릭 링크면 아무것도 쓰지 않고 종료 코드 1이다', (t) => {
  if (!canSymlink()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
  const outside = templateCopy();
  const outsideFiles = snapshot(outside);
  const fresh = () => {
    const root = templateCopy();
    gitInit(root);
    return root;
  };
  const refused = (root: string, args: string[] = []) => {
    const r = cli(['init', '--profile', 'web', '--repo', root, ...args], outside);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /대상 폴더 밖을 가리키는 경로가 있다/);
    assert.match(r.stderr, /아무것도 쓰지 않았다/);
    assert.deepEqual(snapshot(outside), outsideFiles, '밖의 파일은 그대로다');
    return r;
  };

  // 설정 파일이 다른 리포의 설정을 가리킨다
  const b = tmp('harness-init-link-');
  cpSync(path.join(outside, 'profiles'), path.join(b, 'profiles'), { recursive: true });
  symlinkSync(path.join(outside, CONFIG_FILE), path.join(b, CONFIG_FILE));
  assert.match(refused(b).stderr, /harness\.config\.json/);
  assert.match(refused(b, ['--dry-run']).stderr, /harness\.config\.json/);
  assert.deepEqual(
    readdirSync(b).sort(),
    [CONFIG_FILE, 'profiles'].sort(),
    '템플릿도 복사하지 않았다',
  );

  // 템플릿이 놓일 폴더가 밖을 가리킨다: 설정도 쓰지 않는다
  const c = fresh();
  const cBefore = cfgText(c);
  const away = tmp('harness-init-away-');
  mkdirSync(path.join(c, 'docs'));
  symlinkSync(away, path.join(c, 'docs/product'), 'junction');
  assert.match(refused(c).stderr, /docs[\\/]product[\\/]TEMPLATE\.md/);
  assert.equal(cfgText(c), cBefore, '설정을 쓰기 전에 거절한다');
  assert.deepEqual(readdirSync(away), []);
  assert.ok(!existsSync(path.join(c, 'e2e')), '다른 템플릿도 복사하지 않았다');

  // 템플릿 자리에 끊긴 링크가 있다: 그 자리에 쓰면 링크가 가리키는 밖에 파일이 생긴다
  const d = fresh();
  mkdirSync(path.join(d, 'e2e'));
  symlinkSync(path.join(away, 'made.ts'), path.join(d, 'e2e/smoke.spec.ts'));
  assert.match(refused(d).stderr, /smoke\.spec\.ts/);
  assert.deepEqual(readdirSync(away), []);

  // 프로파일 폴더가 밖을 가리킨다(읽는 쪽)
  const e = tmp('harness-init-plink-');
  cpSync(path.join(outside, CONFIG_FILE), path.join(e, CONFIG_FILE));
  mkdirSync(path.join(e, 'profiles'));
  symlinkSync(path.join(outside, 'profiles/web'), path.join(e, 'profiles/web'), 'junction');
  const eBefore = cfgText(e);
  assert.match(refused(e).stderr, /profile\.json/);
  assert.equal(cfgText(e), eBefore);
});

test('init: 덮어쓸 파일이 하드 링크로 다른 이름과 이어져 있으면 아무것도 쓰지 않고 종료 코드 1이다', () => {
  // 설정 파일이 다른 리포의 설정과 같은 파일이다
  const other = templateCopy();
  const otherFiles = snapshot(other);
  const b = tmp('harness-init-hard-');
  cpSync(path.join(other, 'profiles'), path.join(b, 'profiles'), { recursive: true });
  linkSync(path.join(other, CONFIG_FILE), path.join(b, CONFIG_FILE));
  for (const extra of [[], ['--dry-run']]) {
    const r = cli(['init', '--profile', 'web', '--repo', b, ...extra], other);
    assert.equal(r.code, 1, r.stdout);
    assert.match(
      r.stderr,
      /다른 이름과 이어진 파일\(하드 링크\)에는 쓰지 않는다: .*harness\.config\.json/,
    );
    assert.match(r.stderr, /아무것도 쓰지 않았다/);
    assert.deepEqual(snapshot(other), otherFiles, '이어진 다른 리포의 파일은 그대로다');
    assert.deepEqual(
      readdirSync(b).sort(),
      [CONFIG_FILE, 'profiles'].sort(),
      '템플릿도 복사하지 않았다',
    );
  }
  // 바뀌는 것이 없으면 쓰지 않으므로 거절하지 않는다
  const same = cli(['init', '--profile', 'core', '--repo', b], other);
  assert.equal(same.code, 0, same.stderr);
  assert.deepEqual(snapshot(other), otherFiles);

  // 바꿀 자리 표시 파일이 밖의 파일과 같은 파일이다: 설정도 쓰지 않는다
  const c = templateCopy();
  const away = tmp('harness-init-hard-away-');
  writeFileSync(path.join(away, 'shared.md'), PLACEHOLDER);
  linkSync(path.join(away, 'shared.md'), path.join(c, 'ARCHITECTURE.md'));
  const cBefore = cfgText(c);
  assert.equal(init(c, 'web', {}), 1);
  assert.equal(readFileSync(path.join(away, 'shared.md'), 'utf8'), PLACEHOLDER);
  assert.equal(cfgText(c), cBefore, '설정을 쓰기 전에 거절한다');
  assert.ok(!existsSync(path.join(c, 'e2e')), '다른 템플릿도 복사하지 않았다');
  // 건너뛸 파일(자리 표시가 아닌 있던 파일)은 쓰지 않으므로 이어져 있어도 된다
  const d = templateCopy();
  mkdirSync(path.join(d, 'e2e'));
  writeFileSync(path.join(away, 'mine.ts'), '// 내 시나리오\n');
  linkSync(path.join(away, 'mine.ts'), path.join(d, 'e2e/smoke.spec.ts'));
  assert.equal(init(d, 'web', {}), 0);
  assert.equal(readFileSync(path.join(away, 'mine.ts'), 'utf8'), '// 내 시나리오\n');
  assert.equal(loadConfig(d).profile, 'web');
});

test('init: 프로파일의 템플릿 경로가 대상 폴더를 벗어나면(..) 아무것도 쓰지 않는다', () => {
  const root = templateCopy();
  const parent = path.dirname(root);
  const name = `escaped-${path.basename(root)}.md`;
  const pf = path.join(root, 'profiles/web/profile.json');
  const p = JSON.parse(readFileSync(pf, 'utf8')) as { templates: { from: string; to: string }[] };
  p.templates.push({ from: 'templates/PRD.md', to: `../${name}` });
  writeFileSync(pf, JSON.stringify(p, null, 2) + '\n');
  const before = snapshot(root);
  assert.equal(init(root, 'web', {}), 1);
  assert.deepEqual(snapshot(root), before);
  assert.ok(!existsSync(path.join(parent, name)));
});

test('resolvesInside: 실제 위치로 본다 — 없는 경로는 있는 상위 폴더 기준, 끊긴 링크는 밖', (t) => {
  const root = tmp('harness-init-inside-');
  mkdirSync(path.join(root, 'a'));
  writeFileSync(path.join(root, 'a/f'), '');
  assert.ok(resolvesInside(root, root));
  assert.ok(resolvesInside(root, path.join(root, 'a/f')));
  assert.ok(resolvesInside(root, path.join(root, 'a/none/deep/x')));
  assert.ok(!resolvesInside(root, path.dirname(root)));
  assert.ok(!resolvesInside(root, path.join(root, '..', 'x')));
  assert.ok(!resolvesInside(root, `${root}-sibling`), '이름이 앞부분만 같은 이웃 폴더는 밖이다');
  if (!canSymlink()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
  const away = tmp('harness-init-inside-away-');
  symlinkSync(away, path.join(root, 'out'), 'junction');
  symlinkSync(path.join(root, 'a'), path.join(root, 'in'), 'junction');
  symlinkSync(path.join(away, 'none'), path.join(root, 'dangling'));
  assert.ok(!resolvesInside(root, path.join(root, 'out')));
  assert.ok(!resolvesInside(root, path.join(root, 'out/x/y')));
  assert.ok(resolvesInside(root, path.join(root, 'in/f')), '안을 가리키는 링크는 안이다');
  assert.ok(!resolvesInside(root, path.join(root, 'dangling')));
});

/** 리포의 웹 프로파일 파일을 읽어 고친 뒤 다시 쓴다 */
function editProfile(
  root: string,
  edit: (p: {
    version: string;
    config: Record<string, unknown>;
    templates: { from: string; to: string; replacePlaceholder?: boolean }[];
  }) => void,
): { version: string; config: Record<string, unknown> } {
  const pf = path.join(root, 'profiles/web/profile.json');
  const p = JSON.parse(readFileSync(pf, 'utf8'));
  edit(p);
  writeFileSync(pf, JSON.stringify(p, null, 2) + '\n');
  return p;
}

test('init: 프로파일이 정한 github 항목을 적용하고, --owner·--bot은 그 위에 적는다(판정 지적 F10)', () => {
  const root = templateCopy();
  const before = JSON.parse(cfgText(root)) as Record<string, unknown>;
  const github = { ...(before.github as object), owner: 'profile-owner', bot: 'profile-bot' };
  const p = editProfile(root, (x) => {
    x.config.github = github;
  });
  assert.equal(init(root, 'web', {}), 0);
  // 전의 구현과 같은 결과: 프로파일의 항목을 덮어쓴 뒤의 github이 남는다
  assert.equal(
    cfgText(root),
    JSON.stringify(
      { ...before, ...p.config, profile: 'web', profileVersion: `web@${p.version}`, github },
      null,
      2,
    ) + '\n',
  );
  assert.equal(loadConfig(root).github.owner, 'profile-owner');
  assert.equal(loadConfig(root).github.bot, 'profile-bot');
  // 명령줄의 값은 프로파일의 값 위에 적는다. 주지 않은 것은 프로파일의 값이다
  const again = templateCopy();
  gitInit(again);
  editProfile(again, (x) => {
    x.config.github = github;
  });
  const r = cli(['init', '--profile', 'web', '--owner', 'cli-owner', '--dry-run'], again);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /github\.owner/);
  assert.match(r.stdout, /github\.bot/);
  assert.equal(init(again, 'web', { owner: 'cli-owner' }), 0);
  assert.equal(loadConfig(again).github.owner, 'cli-owner');
  assert.equal(loadConfig(again).github.bot, 'profile-bot');
});

test('init: 같은 자리에 놓이는 템플릿이 여럿이면 앞의 것만 복사하고, 미리보기도 같게 알린다(판정 지적 F11)', () => {
  const make = (first: string, second: { replacePlaceholder?: boolean } = {}) => {
    const root = templateCopy();
    gitInit(root);
    const dir = path.join(root, 'profiles/web/templates');
    writeFileSync(path.join(dir, 'first.md'), first);
    writeFileSync(path.join(dir, 'second.md'), '둘째\n');
    editProfile(root, (x) => {
      x.templates = [
        { from: 'templates/first.md', to: 'guide.md' },
        { from: 'templates/second.md', to: 'guide.md', ...second },
        // 적는 꼴이 달라도 같은 자리다
        { from: 'templates/second.md', to: './sub/../guide.md' },
      ];
    });
    return root;
  };
  const lines = (out: string) =>
    out.split('\n').filter((l) => l.startsWith('- ') && l.includes('guide.md'));

  // 뒤의 템플릿은 앞의 것이 복사한 파일을 이미 있는 것으로 보고 건너뛴다
  const root = make('첫째\n');
  const listed = snapshot(root);
  const dry = cli(['init', '--profile', 'web', '--dry-run'], root);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(lines(dry.stdout), [
    '- 템플릿 복사 예정: guide.md',
    '- 건너뜀(이미 있음): guide.md',
    '- 건너뜀(이미 있음): ./sub/../guide.md',
  ]);
  assert.deepEqual(snapshot(root), listed);
  const real = cli(['init', '--profile', 'web'], root);
  assert.equal(real.code, 0, real.stderr);
  assert.deepEqual(lines(real.stdout), [
    '- 템플릿 복사: guide.md',
    '- 건너뜀(이미 있음): guide.md',
    '- 건너뜀(이미 있음): ./sub/../guide.md',
  ]);
  assert.equal(readFileSync(path.join(root, 'guide.md'), 'utf8'), '첫째\n');
  assert.ok(!existsSync(path.join(root, 'sub')));

  // 앞의 것이 자리 표시 파일이고 뒤의 것이 자리 표시 파일을 바꾸는 템플릿이면 뒤의 것으로 바뀐다(전과 같다)
  const swap = make(PLACEHOLDER, { replacePlaceholder: true });
  const swapDry = cli(['init', '--profile', 'web', '--dry-run'], swap);
  assert.deepEqual(lines(swapDry.stdout), [
    '- 템플릿 복사 예정: guide.md',
    '- 템플릿 복사 예정: guide.md',
    '- 건너뜀(이미 있음): ./sub/../guide.md',
  ]);
  assert.ok(!existsSync(path.join(swap, 'guide.md')));
  assert.equal(init(swap, 'web', {}), 0);
  assert.equal(readFileSync(path.join(swap, 'guide.md'), 'utf8'), '둘째\n');
});

/** 템플릿 줄(복사·복사 예정·건너뜀)만 뽑는다 */
const templateLines = (out: string) =>
  out.split('\n').filter((l) => /^- (템플릿 복사|템플릿 복사 예정|건너뜀\(이미 있음\)): /.test(l));

/** 웹 프로파일의 템플릿 목록을 바꾼 리포. files는 profiles/web/templates 아래에 쓸 원본이다 */
function templateRepo(
  files: Record<string, string>,
  templates: { from: string; to: string; replacePlaceholder?: boolean }[],
): string {
  const root = templateCopy();
  gitInit(root);
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(root, 'profiles/web/templates', name), text);
  editProfile(root, (x) => {
    x.templates = templates;
  });
  return root;
}

/** 미리보기의 템플릿 줄이 want이고 파일이 그대로인지, 이어서 실제 적용의 줄이 같은 결정인지 본다 */
function previewThenApply(root: string, want: string[]): void {
  const listed = snapshot(root);
  const dry = cli(['init', '--profile', 'web', '--dry-run'], root);
  assert.equal(dry.code, 0, dry.stderr);
  assert.deepEqual(templateLines(dry.stdout), want);
  assert.deepEqual(snapshot(root), listed);
  const real = cli(['init', '--profile', 'web'], root);
  assert.equal(real.code, 0, real.stderr);
  assert.deepEqual(
    templateLines(real.stdout),
    want.map((l) => l.replace('템플릿 복사 예정', '템플릿 복사')),
  );
}

test('init: 앞의 템플릿이 바꾼 파일을 뒤의 템플릿이 원본으로 쓰면 바뀐 뒤의 글로 본다(판정 지적 F13)', () => {
  // 1) 프로파일 안의 자리 표시 원본(ph.md)을 일반 글로 바꾼다 2) 그 원본을 doc.md로 복사한다
  // 3) doc.md가 자리 표시 파일이면 바꾼다 — 2)가 복사한 것은 일반 글이라 건너뛴다(차례로 처리한 결과)
  const root = templateRepo(
    { 'normal.md': '일반 글\n', 'ph.md': PLACEHOLDER, 'second.md': '둘째\n' },
    [
      { from: 'templates/normal.md', to: 'profiles/web/templates/ph.md', replacePlaceholder: true },
      { from: 'templates/ph.md', to: 'doc.md' },
      { from: 'templates/second.md', to: 'doc.md', replacePlaceholder: true },
    ],
  );
  previewThenApply(root, [
    '- 템플릿 복사 예정: profiles/web/templates/ph.md',
    '- 템플릿 복사 예정: doc.md',
    '- 건너뜀(이미 있음): doc.md',
  ]);
  assert.equal(readFileSync(path.join(root, 'doc.md'), 'utf8'), '일반 글\n');
  assert.equal(readFileSync(path.join(root, 'profiles/web/templates/ph.md'), 'utf8'), '일반 글\n');

  // 복사할 글도 그 시점의 것이다: 앞의 템플릿이 바꾼 원본(ph.md)으로 뒤의 템플릿이 자리 표시 파일을 바꾼다
  const swap = templateRepo(
    { 'normal.md': PLACEHOLDER, 'ph.md': PLACEHOLDER, 'second.md': '둘째\n' },
    [
      { from: 'templates/second.md', to: 'profiles/web/templates/ph.md', replacePlaceholder: true },
      {
        from: 'templates/normal.md',
        to: 'profiles/web/templates/ph.md',
        replacePlaceholder: false,
      },
      { from: 'templates/normal.md', to: 'doc.md' },
      { from: 'templates/ph.md', to: 'doc.md', replacePlaceholder: true },
    ],
  );
  previewThenApply(swap, [
    '- 템플릿 복사 예정: profiles/web/templates/ph.md',
    '- 건너뜀(이미 있음): profiles/web/templates/ph.md',
    '- 템플릿 복사 예정: doc.md',
    '- 템플릿 복사 예정: doc.md',
  ]);
  // ph.md는 1)에서 '둘째'가 됐고, doc.md는 자리 표시 글(normal.md)로 만들어졌다가 그 '둘째'로 바뀐다
  assert.equal(readFileSync(path.join(swap, 'doc.md'), 'utf8'), '둘째\n');
});

test('init: 경로가 달라도 같은 파일을 가리키면 같은 자리다 — 안을 가리키는 폴더 링크(판정 지적 F11)', (t) => {
  if (!canSymlink()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
  const root = templateRepo({ 'first.md': '첫째\n', 'second.md': '둘째\n' }, [
    { from: 'templates/first.md', to: 'docs/guide.md' },
    { from: 'templates/second.md', to: 'alias/guide.md' },
    { from: 'templates/second.md', to: 'alias/new/x.md' },
    { from: 'templates/first.md', to: 'docs/new/x.md' },
  ]);
  mkdirSync(path.join(root, 'docs'));
  symlinkSync(path.join(root, 'docs'), path.join(root, 'alias'), 'junction');
  previewThenApply(root, [
    '- 템플릿 복사 예정: docs/guide.md',
    '- 건너뜀(이미 있음): alias/guide.md',
    '- 템플릿 복사 예정: alias/new/x.md',
    '- 건너뜀(이미 있음): docs/new/x.md',
  ]);
  assert.equal(readFileSync(path.join(root, 'docs/guide.md'), 'utf8'), '첫째\n');
  assert.equal(readFileSync(path.join(root, 'docs/new/x.md'), 'utf8'), '둘째\n');
});

test('init: 실제 적용은 그 순간의 파일로 정한다 — 이름의 대소문자만 다른 두 자리', () => {
  const root = templateRepo({ 'first.md': '첫째\n', 'second.md': '둘째\n' }, [
    { from: 'templates/first.md', to: 'Guide.md' },
    { from: 'templates/second.md', to: 'guide.md' },
  ]);
  assert.equal(init(root, 'web', {}), 0);
  // 대소문자를 가리지 않는 파일 시스템에서는 둘이 같은 파일이라 뒤의 것을 건너뛴다(앞의 것을 덮어쓰지 않는다).
  // 가리는 파일 시스템에서는 다른 파일이라 둘 다 복사한다. 어느 쪽이든 앞의 것은 그대로다
  assert.equal(readFileSync(path.join(root, 'Guide.md'), 'utf8'), '첫째\n');
  const names = readdirSync(root).filter((n) => n.toLowerCase() === 'guide.md');
  if (names.length === 2) assert.equal(readFileSync(path.join(root, 'guide.md'), 'utf8'), '둘째\n');
  else assert.deepEqual(names, ['Guide.md']);
});

test('init: 복사할 템플릿의 원본이 없으면 아무것도 쓰지 않고 종료 코드 1이다', () => {
  const root = templateRepo({ 'first.md': '첫째\n' }, [
    { from: 'templates/first.md', to: 'a.md' },
    { from: 'templates/none.md', to: 'b.md' },
  ]);
  const listed = snapshot(root);
  for (const extra of [[], ['--dry-run']]) {
    const r = cli(['init', '--profile', 'web', ...extra], root);
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stderr, /템플릿 원본이 없다: .*none\.md/);
    assert.match(r.stderr, /아무것도 쓰지 않았다/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, '스택이 아니라 이유를 낸다');
    assert.deepEqual(snapshot(root), listed);
  }
  // 건너뛸 템플릿의 원본은 읽지 않으므로 없어도 된다(전과 같다)
  writeFileSync(path.join(root, 'b.md'), '있던 글\n');
  assert.equal(init(root, 'web', {}), 0);
  assert.equal(readFileSync(path.join(root, 'b.md'), 'utf8'), '있던 글\n');
  assert.equal(readFileSync(path.join(root, 'a.md'), 'utf8'), '첫째\n');
});

test('fileKey: 같은 파일은 이름이 달라도 같고, 아직 없는 파일은 있는 상위 폴더와 나머지 경로로 가린다', (t) => {
  const root = tmp('harness-init-key-');
  mkdirSync(path.join(root, 'a'));
  writeFileSync(path.join(root, 'a/f'), '');
  writeFileSync(path.join(root, 'a/g'), '');
  assert.equal(fileKey(path.join(root, 'a/f')), fileKey(path.join(root, 'a/../a/f')));
  assert.notEqual(fileKey(path.join(root, 'a/f')), fileKey(path.join(root, 'a/g')));
  linkSync(path.join(root, 'a/f'), path.join(root, 'hard'));
  assert.equal(fileKey(path.join(root, 'hard')), fileKey(path.join(root, 'a/f')), '하드 링크');
  assert.equal(fileKey(path.join(root, 'a/none/x')), fileKey(path.join(root, 'a/none/x')));
  assert.notEqual(fileKey(path.join(root, 'a/none/x')), fileKey(path.join(root, 'a/none/y')));
  assert.notEqual(fileKey(path.join(root, 'a/none')), fileKey(path.join(root, 'none')));
  if (!canSymlink()) return t.skip('심볼릭 링크를 만들 수 없는 환경');
  symlinkSync(path.join(root, 'a'), path.join(root, 'b'), 'junction');
  assert.equal(fileKey(path.join(root, 'b/f')), fileKey(path.join(root, 'a/f')), '폴더 링크');
  assert.equal(fileKey(path.join(root, 'b/none/x')), fileKey(path.join(root, 'a/none/x')));
});

test('도움말: init의 --repo와 --dry-run을 적는다', () => {
  const r = cli(['--help'], tmp());
  assert.match(r.stdout, /init --profile core\|web \[--repo <폴더>\] \[--dry-run\]/);
});
