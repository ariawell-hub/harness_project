// doc-lint 게이트가 `git` 읽기 실패를 조용히 통과시키지 않는지 본다(Issue #163, TD-60).
// 읽기 실패는 임시 리포를 실제로 깨뜨려 만든다(가짜 `git`을 끼우지 않는다).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { docLint, docLintGate, DocLintReadError } from '../gates/doc-lint.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, sh, tmp, write } from './helpers.ts';

const READ_FAIL = 'R8 문서 읽기 실패';
const FRONT = (related: string) =>
  `---\nstatus: active\nrelated_code: [${related}]\nreview_cycle: on-change\n---\n`;
const BROKEN_LINK = '# 가이드\n\n[없음](missing.md)\n';

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });
const rules = (r: { errors: { rule: string }[] }) => r.errors.map((e) => e.rule);

/** 설정·지도·색인·문서 하나(`related_code`가 있는 on-change 문서)를 둔 리포. 커밋은 하지 않는다 */
function repo(guideBody = '# 가이드\n', related = 'src/a.ts'): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude: [] } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(root, 'docs/index.md', `${FRONT('')}# 목차\n\n- [가이드](guide.md)\n`);
  write(root, 'src/a.ts', 'export const a = 1;\n');
  write(root, 'docs/guide.md', FRONT(related) + guideBody);
  return root;
}

/** 색인 파일을 색인이 아닌 내용으로 덮어쓴다: `git ls-files`가 실패하고 `git rev-parse`는 성공한다 */
function breakIndex(root: string): void {
  writeFileSync(
    path.resolve(root, sh('git', ['rev-parse', '--git-path', 'index'], root)),
    'not an index',
  );
}

/** 현재 브랜치의 ref 파일 */
function refFile(root: string): string {
  const ref = sh('git', ['symbolic-ref', 'HEAD'], root);
  return path.resolve(root, sh('git', ['rev-parse', '--git-path', ref], root));
}

/** 읽기 실패 사례의 CLI 단언: 세 실행 모두 종료 코드 1, 실패한 조회의 이름과 고치는 법이 출력에 있다 */
function assertCliReadFailure(
  root: string,
  query: 'git ls-files' | 'git log' | 'git show-ref' | 'git cat-file',
): void {
  const runs: [string[], boolean][] = [
    [['doc-lint'], false],
    [['check', '--only', 'doc-lint'], true],
    [['check', '--only', 'doc-lint', '--no-cache'], true],
  ];
  for (const [args, isCheck] of runs) {
    const r = cli(args, root);
    const out = r.stdout + r.stderr;
    const label = `${args.join(' ')}\n${out}`;
    assert.equal(r.code, 1, label);
    assert.ok(out.includes(READ_FAIL), label);
    assert.ok(out.includes(query), label);
    assert.ok(out.includes('git status'), label);
    if (isCheck) {
      assert.ok(out.includes('✗ doc-lint'), label);
      // 캐시 키를 만들지 못해도 예외로 끝나지 않는다
      assert.ok(!out.includes('git add'), label);
    }
  }
}

test('문서 목록을 읽지 못하면(git ls-files 실패) 게이트가 실패한다', () => {
  // 깨진 링크가 있는데도 목록이 비어 통과하던 경우다
  const root = repo(BROKEN_LINK);
  commitAll(root, 'init');
  breakIndex(root);
  const cfg = loadConfig(root);

  assert.throws(() => docLint(root, cfg), DocLintReadError);

  const r = docLintGate(root, cfg);
  assert.deepEqual(rules(r), [READ_FAIL]);
  assert.ok(r.errors[0].what.includes('git ls-files'), r.errors[0].what);
  assert.ok(r.errors[0].how.includes('git status'), r.errors[0].how);
  assert.deepEqual(r.warnings, []);

  assertCliReadFailure(root, 'git ls-files');
});

for (const [name, content] of [
  ['없는 객체의 해시', '1'.repeat(40) + '\n'],
  ['해시가 아닌 내용', 'not a hash\n'],
  ['빈 파일', ''],
] as const) {
  test(`커밋 시각을 읽지 못하면(git log 실패) 게이트가 실패한다: ref가 ${name}`, () => {
    const root = repo();
    commitAll(root, 'init');
    writeFileSync(refFile(root), content);
    const cfg = loadConfig(root);

    const r = docLintGate(root, cfg);
    assert.deepEqual(rules(r), [READ_FAIL]);
    assert.ok(r.errors[0].what.includes('git log'), r.errors[0].what);
    assert.deepEqual(r.warnings, []);

    assertCliReadFailure(root, 'git log');
  });

  test(`커밋 시각이 필요한 문서가 없어도 HEAD를 읽지 못하면 게이트가 실패한다: ref가 ${name}`, () => {
    // 모든 문서의 related_code가 비어 git log가 불리지 않는다
    const root = repo('# 가이드\n', '');
    commitAll(root, 'init');
    writeFileSync(refFile(root), content);
    const cfg = loadConfig(root);

    const r = docLintGate(root, cfg);
    assert.deepEqual(rules(r), [READ_FAIL]);
    assert.ok(r.errors[0].what.includes('git show-ref'), r.errors[0].what);
    assert.deepEqual(r.warnings, []);

    assertCliReadFailure(root, 'git show-ref');
  });
}

for (const related of ['src/a.ts', '']) {
  test(`HEAD가 커밋이 아닌 객체(blob)를 가리키면 읽기 실패다: related_code [${related}]`, () => {
    // git ls-files, git show-ref --verify HEAD, git log가 모두 성공하는 경우다
    const root = repo('# 가이드\n', related);
    commitAll(root, 'init');
    writeFileSync(refFile(root), sh('git', ['hash-object', 'src/a.ts'], root) + '\n');
    const cfg = loadConfig(root);

    const r = docLintGate(root, cfg);
    assert.deepEqual(rules(r), [READ_FAIL]);
    assert.ok(r.errors[0].what.includes('git cat-file'), r.errors[0].what);
    assert.deepEqual(r.warnings, []);

    assertCliReadFailure(root, 'git cat-file');
  });
}

test('브랜치 ref가 커밋을 가리키는 주석 태그 객체를 담고 있으면 읽기 실패가 아니다', () => {
  // git은 태그를 거쳐 커밋 시각을 그대로 읽는다. 객체의 종류 검사는 git fsck의 몫이다
  const root = repo();
  const at = (sec: number) => {
    const t = `2026-11-01T00:00:${String(sec).padStart(2, '0')}Z`;
    return { GIT_AUTHOR_DATE: t, GIT_COMMITTER_DATE: t };
  };
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', 'init'], root, at(0));
  write(root, 'src/a.ts', 'export const a = 2;\n');
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', 'code'], root, at(10));
  const cfg = loadConfig(root);
  const before = docLintGate(root, cfg);
  assert.deepEqual(
    before.warnings.map((w) => w.rule),
    ['R8 검토 필요'],
  );

  sh('git', ['tag', '-a', 'v1', '-m', 'annotated'], root);
  writeFileSync(refFile(root), sh('git', ['rev-parse', 'refs/tags/v1'], root) + '\n');
  const after = docLintGate(root, cfg);
  assert.ok(!rules(after).includes(READ_FAIL), JSON.stringify(after.errors));
  assert.deepEqual(after, before);
});

test('HEAD와 이름이 같은 태그가 있어도 손상된 브랜치 ref는 읽기 실패다', () => {
  const root = repo('# 가이드\n', '');
  const sha = commitAll(root, 'init');
  const tag = path.resolve(root, sh('git', ['rev-parse', '--git-path', 'refs/tags/HEAD'], root));
  mkdirSync(path.dirname(tag), { recursive: true });
  writeFileSync(tag, sha + '\n');
  writeFileSync(refFile(root), '');
  const cfg = loadConfig(root);

  const r = docLintGate(root, cfg);
  assert.deepEqual(rules(r), [READ_FAIL]);
  assert.ok(r.errors[0].what.includes('git show-ref'), r.errors[0].what);

  assertCliReadFailure(root, 'git show-ref');
});

test('커밋이 없는 리포는 실패가 아니다: 커밋 시각 검사만 건너뛰고 다른 검사는 한다', () => {
  const root = repo();
  const cfg = loadConfig(root);

  assert.deepEqual(docLintGate(root, cfg), { errors: [], warnings: [] });
  const cmd = cli(['doc-lint'], root);
  assert.equal(cmd.code, 0, cmd.stdout + cmd.stderr);

  // 커밋 없는 리포의 처리는 게이트용 함수에만 있다
  assert.throws(() => docLint(root, cfg), DocLintReadError);

  write(root, 'docs/guide.md', FRONT('src/a.ts') + BROKEN_LINK);
  const broken = docLintGate(root, cfg);
  assert.ok(rules(broken).includes('R8 깨진 링크'), JSON.stringify(broken.errors));
  assert.ok(!rules(broken).includes(READ_FAIL), JSON.stringify(broken.errors));
});

test('checkout --orphan 직후도 커밋이 없는 리포다', () => {
  const root = repo();
  commitAll(root, 'init');
  sh('git', ['checkout', '-q', '--orphan', 'fresh'], root);
  assert.deepEqual(docLintGate(root, loadConfig(root)), { errors: [], warnings: [] });
});

test('git 리포가 아닌 폴더는 읽기 실패다', () => {
  const root = tmp();
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  write(root, 'AGENTS.md', '# 지도\n');
  const r = docLintGate(root, loadConfig(root));
  assert.deepEqual(rules(r), [READ_FAIL]);
  assert.ok(r.errors[0].what.includes('git ls-files'), r.errors[0].what);
  assert.deepEqual(r.warnings, []);
});

test('git 읽기가 되는 리포에서는 게이트의 결과가 docLint와 같다(분리된 HEAD에서도)', () => {
  const root = repo(BROKEN_LINK);
  const at = (sec: number) => {
    const t = `2026-11-01T00:00:${String(sec).padStart(2, '0')}Z`;
    return { GIT_AUTHOR_DATE: t, GIT_COMMITTER_DATE: t };
  };
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', 'init'], root, at(0));
  // 코드만 10초 뒤의 커밋 시각으로 고친다: 문서가 "검토 필요"가 된다
  write(root, 'src/a.ts', 'export const a = 2;\n');
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', 'code'], root, at(10));
  const cfg = loadConfig(root);

  const same = () => {
    const gate = docLintGate(root, cfg);
    assert.deepEqual(gate, docLint(root, cfg));
    assert.ok(rules(gate).includes('R8 깨진 링크'));
    assert.ok(!rules(gate).includes(READ_FAIL));
    assert.deepEqual(
      gate.warnings.map((w) => w.rule),
      ['R8 검토 필요'],
    );
  };
  same();
  sh('git', ['checkout', '-q', '--detach'], root);
  same();
});

test('캐시 키를 만들지 못한 check 실행은 캐시 없이 돌고 캐시에 남지 않는다', () => {
  const root = repo();
  commitAll(root, 'init');
  const cacheDir = path.resolve(
    root,
    sh('git', ['rev-parse', '--git-common-dir'], root),
    'harness',
    'check-cache',
  );
  breakIndex(root);
  // 문서를 쓰지 않는 단계만 실행한다(픽스처의 build 명령은 해당 없음이다)
  const r = cli(['check', '--only', 'build'], root);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(cacheDir) || readdirSync(cacheDir).length === 0);
});
