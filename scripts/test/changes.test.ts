// 변경 조각(TD-39, Issue #222): 조각 파일의 자리·형식, doc-lint의 검사, 두 PR의 조각이 병합에서 충돌하지 않는 것을 본다.
// 계획 20261123-change-fragments step0.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { docLint } from '../gates/doc-lint.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

// 새 모듈은 동적으로 가져온다: 이 변경 전의 코드에는 없어서, 정적으로 가져오면 파일 전체가 단언 전에 죽는다
const changes: Partial<typeof import('../lib/changes.ts')> =
  await import('../lib/changes.ts').catch(() => ({}));
const NAME = '20261123-demo-s0';
const FILE = `docs/harness/changes/${NAME}.md`;
const FRAG = (body: string, name = NAME) => `# 변경 조각: ${name}\n${body}`;
const OK = FRAG('\n## CHANGELOG\n\n- 한 줄\n- 두 줄\n\n## 설계서 변경 이력\n\n- 10.4절에 적었다\n');

/** 결과를 값으로: 통과면 항목, 아니면 문제 목록. 이 변경 전의 코드에서도 단언으로 실패하게 한다 */
function parsed(rel: string, text: string): unknown {
  const parse = changes.parseFragment;
  if (typeof parse !== 'function') return 'parseFragment 없음';
  const r = parse(rel, text);
  return r.ok ? r.value : r.problems;
}

test('조각 파일의 자리: docs/harness/changes/<브랜치 이름의 / 뒤>.md만이다', () => {
  assert.equal(changes.CHANGES_DIR, 'docs/harness/changes');
  const at = changes.isFragmentPath;
  assert.equal(typeof at, 'function');
  for (const ok of [
    FILE,
    'docs/harness/changes/20261123-a.md',
    'docs/harness/changes/20261123-a-b-2.md',
  ])
    assert.equal(at!(ok), true, ok);
  for (const no of [
    'docs/harness/changes/README.md',
    'docs/harness/changes/2026-11-23-a.md',
    'docs/harness/changes/20261123-A.md',
    'docs/harness/changes/20261123-a.txt',
    'docs/harness/changes/sub/20261123-a.md',
    'docs/harness/20261123-a.md',
    'x/docs/harness/changes/20261123-a.md',
  ])
    assert.equal(at!(no), false, no);
  // PR 브랜치의 조각: 브랜치 이름의 마지막 / 뒤
  const forBranch = changes.fragmentPathFor;
  assert.equal(typeof forBranch, 'function');
  assert.equal(forBranch!('feat/20261123-demo-s0'), FILE);
  assert.equal(forBranch!('fix/20261123-a'), 'docs/harness/changes/20261123-a.md');
  for (const no of ['revert/0123abc', 'main', ''])
    assert.equal(forBranch!(no), null, JSON.stringify(no));
});

test('조각 파일을 읽는다: CHANGELOG 항목은 하나 이상, 설계서 변경 이력은 없어도 된다', () => {
  assert.deepEqual(parsed(FILE, OK), {
    name: NAME,
    changelog: ['한 줄', '두 줄'],
    design: ['10.4절에 적었다'],
  });
  assert.deepEqual(parsed(FILE, FRAG('\n## CHANGELOG\n\n- 하나\n')), {
    name: NAME,
    changelog: ['하나'],
    design: [],
  });
  // CRLF도 같다
  assert.deepEqual(parsed(FILE, OK.replace(/\n/g, '\r\n')), parsed(FILE, OK));
});

test('조각 파일의 형식이 틀리면 줄마다 문제를 낸다', () => {
  const problems = (text: string, rel = FILE) => {
    const r = parsed(rel, text);
    assert.ok(Array.isArray(r), JSON.stringify(r));
    return (r as string[]).join('\n');
  };
  assert.match(problems(OK, 'docs/harness/changes/README.md'), /자리·이름/);
  assert.match(
    problems(OK.replace(`# 변경 조각: ${NAME}`, '# 변경 조각: 20261123-other')),
    /첫 줄/,
  );
  assert.match(problems(FRAG('\n## 설계서 변경 이력\n\n- 하나\n')), /CHANGELOG.*하나 이상/);
  assert.match(problems(FRAG('\n## CHANGELOG\n\n')), /CHANGELOG.*하나 이상/);
  assert.match(problems(FRAG('\n## CHANGELOG\n\n- 하나\n\n## 기타\n\n- 둘\n')), /받지 않는 섹션/);
  assert.match(
    problems(FRAG('\n## 설계서 변경 이력\n\n- 하나\n\n## CHANGELOG\n\n- 둘\n')),
    /차례로 한 번씩/,
  );
  assert.match(
    problems(FRAG('\n## CHANGELOG\n\n- 하나\n\n## CHANGELOG\n\n- 둘\n')),
    /차례로 한 번씩/,
  );
  assert.match(
    problems(FRAG('\n## CHANGELOG\n\n- 하나\n  이어지는 줄\n')),
    /^6번째 줄: 섹션 안의/m,
  );
  assert.match(problems(FRAG('\n머리 글\n\n## CHANGELOG\n\n- 하나\n')), /^3번째 줄: 섹션 안의/m);
  assert.match(problems(FRAG('\n## CHANGELOG\n\n- \n- 하나\n')), /비었다/);
  assert.match(problems(FRAG('\n## CHANGELOG\n\n- v0.7.81 (2026-11-23): 하나\n')), /버전으로 시작/);
  assert.match(problems(FRAG('\n## CHANGELOG\n\n- [설계서](design.md)를 고쳤다\n')), /링크/);
});

/** 설정·지도·색인만 둔 리포(doc-lint용) */
function lintRepo(): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude: [] } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(
    root,
    'docs/index.md',
    '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n# 목차\n',
  );
  return root;
}
const lint = (root: string) =>
  docLint(root, loadConfig(root), { noHistory: true }).errors.map((e) => `${e.rule} ${e.what}`);

test('doc-lint: 조각 파일은 frontmatter·색인을 요구하지 않고 형식을 본다(R8 변경 조각)', () => {
  const root = lintRepo();
  write(root, FILE, OK);
  assert.deepEqual(lint(root), []);
  write(root, FILE, FRAG('\n## CHANGELOG\n\n'));
  assert.deepEqual(lint(root), [
    `R8 변경 조각 ${FILE}: \`## CHANGELOG\` 섹션에 항목이 하나 이상 있어야 한다`,
  ]);
  // 폴더 안의 다른 이름·확장자·하위 폴더도 잡는다(Markdown이 아니어도)
  write(root, FILE, OK);
  const strays = [
    'docs/harness/changes/notes.md',
    'docs/harness/changes/notes.txt',
    'docs/harness/changes/sub/20261123-a.md',
  ];
  for (const f of strays) write(root, f, OK);
  const errors = lint(root);
  for (const f of strays)
    assert.ok(
      errors.some((e) => e.startsWith(`R8 변경 조각 ${f}: 조각 파일의 자리·이름`)),
      `${f}\n${errors.join('\n')}`,
    );
});

test('두 PR이 각자 조각 파일만 더하면 차례로 병합해도 충돌하지 않는다', () => {
  const root = path.join(tmp(), 'm');
  gitInit(root);
  write(root, 'docs/harness/CHANGELOG.md', '# 이력\n\n## 다음 버전 (미배포)\n\n- 앞 항목\n');
  commitAll(root, 'init');
  const main = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], root);
  const names = ['20261123-a-s0', '20261123-b'];
  for (const name of names) {
    sh('git', ['checkout', '-q', '-b', name, main], root);
    write(root, `docs/harness/changes/${name}.md`, FRAG('\n## CHANGELOG\n\n- 바꿈\n', name));
    commitAll(root, name);
  }
  sh('git', ['checkout', '-q', main], root);
  for (const name of names) {
    const r = runSync('git', ['merge', '--no-edit', name], { cwd: root });
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
  for (const name of names)
    assert.deepEqual(
      parsed(
        `docs/harness/changes/${name}.md`,
        sh('git', ['show', `HEAD:docs/harness/changes/${name}.md`], root) + '\n',
      ),
      { name, changelog: ['바꿈'], design: [] },
    );
});
