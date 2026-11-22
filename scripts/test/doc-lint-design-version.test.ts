// doc-lint가 설계서 머리말의 버전·최종 갱신을 변경 이력과 견주는지 본다(Issue #175 step1, TD-33).
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { designVersionProblems, docLint } from '../gates/doc-lint.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

const RULE = 'R8 설계서 버전';
const DESIGN = 'docs/harness/design.md';
const FRONT = '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n';

const head = (version: string, date: string) =>
  `> 버전 v${version} · 상태: 초안 · 최종 갱신: ${date}`;
const item = (version: string, date: string) => `  - v${version} (${date}): 내용`;

/** 맞는 설계서의 항목 넷 */
const ITEMS = [
  item('0.4', '2026-11-10'),
  item('0.4.1', '2026-11-10'),
  item('0.7.2', '2026-11-20'),
  item('0.7.3', '2026-11-21'),
];

/**
 * 설계서 글자. 머리말 줄(없으면 null), 변경 이력 제목 아래의 줄들(제목까지 없애려면 null).
 * 목록 뒤에는 늘 다른 최상위 항목과 그 아래의 `v`로 시작하는 딸린 줄, 본문이 온다.
 */
function design(headLine: string | null, listLines: string[] | null): string {
  return [
    '# 설계서',
    '',
    ...(headLine === null ? [] : [headLine, '']),
    '- **문서 성격**: 설명',
    ...(listLines === null ? [] : ['- **변경 이력**', ...listLines]),
    '- **다른 항목**',
    '  - v9.9 (2026-12-31): 변경 이력이 아니다',
    '',
    '본문',
    '',
  ].join('\n');
}

/** 그 줄이 마지막으로 나오는 줄 번호(1부터) */
const lineNo = (text: string, line: string) => text.split('\n').lastIndexOf(line) + 1;
const rules = (p: { rule: string }[]) => p.map((x) => x.rule);

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });

test('design-version: 머리말이 변경 이력의 마지막 항목과 맞으면 문제가 없다', () => {
  const text = design(head('0.7.3', '2026-11-21'), ITEMS);
  assert.deepEqual(designVersionProblems(text), []);
  // 줄 끝이 CRLF여도 같다
  assert.deepEqual(designVersionProblems(text.replace(/\n/g, '\r\n')), []);
  // 항목 사이에 더 깊이 들여쓴 줄이 있어도 같다
  const nested = [
    ITEMS[0],
    '    딸린 줄',
    ITEMS[1],
    '    - v0.0 (2026-01-01): 딸린 목록',
    ...ITEMS.slice(2),
  ];
  assert.deepEqual(designVersionProblems(design(head('0.7.3', '2026-11-21'), nested)), []);
});

test('design-version: 머리말의 버전이 마지막 항목과 다르면 두 버전을 알린다', () => {
  const p = designVersionProblems(design(head('0.7.2', '2026-11-21'), ITEMS));
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE);
  assert.ok(p[0].what.includes('v0.7.2') && p[0].what.includes('v0.7.3'), p[0].what);
  assert.ok(p[0].how.length > 0 && p[0].doc.length > 0);
});

test('design-version: 머리말의 최종 갱신이 마지막 항목의 날짜와 다르면 두 날짜를 알린다', () => {
  const p = designVersionProblems(design(head('0.7.3', '2026-11-20'), ITEMS));
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE);
  assert.ok(p[0].what.includes('2026-11-20') && p[0].what.includes('2026-11-21'), p[0].what);
  // 버전과 날짜가 모두 다르면 두 건이다
  const both = designVersionProblems(design(head('0.7.2', '2026-11-20'), ITEMS));
  assert.deepEqual(rules(both), [RULE, RULE]);
});

test('design-version: 버전이 앞 항목보다 크지 않은 항목을 줄 번호와 함께 알린다', () => {
  // 같은 버전이 두 번
  const twice = design(head('0.7.3', '2026-11-21'), [...ITEMS, item('0.7.3', '2026-11-21')]);
  const p = designVersionProblems(twice);
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE);
  assert.ok(p[0].what.includes(String(lineNo(twice, item('0.7.3', '2026-11-21')))), p[0].what);
  assert.ok(p[0].what.includes('v0.7.3'), p[0].what);
  // 뒤 항목이 앞 항목보다 작다
  const back = design(head('0.7.2', '2026-11-21'), [...ITEMS, item('0.7.2', '2026-11-21')]);
  const q = designVersionProblems(back);
  assert.equal(q.length, 1);
  assert.ok(q[0].what.includes(String(lineNo(back, item('0.7.2', '2026-11-21')))), q[0].what);
  assert.ok(q[0].what.includes('v0.7.2') && q[0].what.includes('v0.7.3'), q[0].what);
});

test('design-version: 버전은 마디를 수로 견준다', () => {
  const d = '2026-11-21';
  // 앞 마디가 같으면 마디가 더 많은 쪽이 크다
  assert.deepEqual(
    designVersionProblems(design(head('0.4.1', d), [item('0.4', d), item('0.4.1', d)])),
    [],
  );
  assert.equal(
    designVersionProblems(design(head('0.4', d), [item('0.4.1', d), item('0.4', d)])).length,
    1,
  );
  // 글자가 달라도 수가 같으면 같은 버전이다
  const same = designVersionProblems(design(head('0.07', d), [item('0.7', d), item('0.07', d)]));
  assert.equal(same.length, 1);
  assert.ok(same[0].what.includes('v0.7') && same[0].what.includes('v0.07'), same[0].what);
  // 수로 견준다: 0.10은 0.9보다 크다
  assert.deepEqual(
    designVersionProblems(design(head('0.10', d), [item('0.9', d), item('0.10', d)])),
    [],
  );
});

test('design-version: 빈 줄은 변경 이력 목록을 끝내지 않는다', () => {
  const split = [...ITEMS.slice(0, 3), '', ITEMS[3]];
  assert.deepEqual(designVersionProblems(design(head('0.7.3', '2026-11-21'), split)), []);
  // 공백만 있는 줄도 빈 줄이다
  const spaces = [...ITEMS.slice(0, 3), '   ', ITEMS[3]];
  assert.deepEqual(designVersionProblems(design(head('0.7.3', '2026-11-21'), spaces)), []);
  // 머리말이 빈 줄 앞의 항목과 같으면 마지막 항목(빈 줄 뒤)과 달라 한 건이다
  const p = designVersionProblems(design(head('0.7.2', '2026-11-21'), split));
  assert.equal(p.length, 1);
  assert.ok(p[0].what.includes('v0.7.2') && p[0].what.includes('v0.7.3'), p[0].what);
  // 빈 줄 뒤에 앞 항목과 같은 버전의 항목이 있으면 그 줄을 알린다
  const dup = design(head('0.7.3', '2026-11-21'), [...ITEMS, '', item('0.7.3', '2026-11-21')]);
  const q = designVersionProblems(dup);
  assert.equal(q.length, 1);
  assert.ok(q[0].what.includes(String(lineNo(dup, item('0.7.3', '2026-11-21')))), q[0].what);
});

test('design-version: 머리말이나 변경 이력을 읽지 못하면 통과가 아니라 문제 한 건이다', () => {
  // 머리말 줄이 없다
  const noHead = designVersionProblems(design(null, ITEMS));
  assert.equal(noHead.length, 1);
  assert.equal(noHead[0].rule, RULE);
  assert.ok(noHead[0].what.includes('머리말'), noHead[0].what);
  // 머리말 줄에 최종 갱신이 없다
  const noDate = designVersionProblems(design('> 버전 v0.7.3 · 상태: 초안', ITEMS));
  assert.equal(noDate.length, 1);
  assert.ok(noDate[0].what.includes('머리말'), noDate[0].what);
  // 변경 이력 줄이 없다
  const noList = designVersionProblems(design(head('0.7.3', '2026-11-21'), null));
  assert.equal(noList.length, 1);
  assert.ok(noList[0].what.includes('변경 이력'), noList[0].what);
  // 변경 이력 줄 바로 뒤가 빈 줄이고 항목이 없다
  const empty = designVersionProblems(design(head('0.7.3', '2026-11-21'), ['']));
  assert.equal(empty.length, 1);
  assert.ok(empty[0].what.includes('변경 이력'), empty[0].what);
  // 항목 하나의 형식이 틀리다(날짜가 없다). 머리말이 어긋나 있어도 비교 문제는 함께 나오지 않는다
  const badLine = '  - v0.7.3: 날짜가 없다';
  const bad = design(head('0.7.2', '2026-11-20'), [...ITEMS.slice(0, 3), badLine]);
  const p = designVersionProblems(bad);
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE);
  assert.ok(p[0].what.includes(String(lineNo(bad, badLine))), p[0].what);
  assert.ok(!p[0].what.includes('날짜가 없다'), p[0].what);
});

test('design-version: 머리말은 정한 형식대로만 읽는다(`최종 갱신:` 앞의 공백, ` · `의 공백, 날짜 뒤)', () => {
  const onlyHead = (line: string) => {
    const p = designVersionProblems(design(line, ITEMS));
    assert.equal(p.length, 1, line);
    assert.equal(p[0].rule, RULE);
    assert.ok(p[0].what.includes('머리말'), p[0].what);
  };
  // 두 부분이 붙었다: 형식 오류 한 건. 버전이 어긋나 있어도 비교 문제는 함께 나오지 않는다
  onlyHead('> 버전 v0.7.3 · 상태: 초안최종 갱신: 2026-11-21');
  onlyHead('> 버전 v0.7.2 · 상태: 초안최종 갱신: 2026-11-20');
  onlyHead('> 버전 v0.7.3 ·최종 갱신: 2026-11-21');
  // 다른 자리(지금도 거부한다)
  onlyHead('> 버전 v0.7.3· 상태: 초안 · 최종 갱신: 2026-11-21');
  onlyHead('> 버전 v0.7.3 ·상태: 초안 · 최종 갱신: 2026-11-21');
  onlyHead('> 버전 v0.7.3 · 상태: 초안 · 최종 갱신: 2026-11-21 끝');
  // 그대로 통과하는 꼴
  for (const line of [
    head('0.7.3', '2026-11-21'),
    '> 버전 v0.7.3 · 최종 갱신: 2026-11-21',
    `${head('0.7.3', '2026-11-21')}  `,
  ])
    assert.deepEqual(designVersionProblems(design(line, ITEMS)), [], line);
  // 실제 설계서
  assert.deepEqual(
    designVersionProblems(readFileSync(path.join(HARNESS_ROOT, DESIGN), 'utf8')),
    [],
  );
});

/** 설정·지도·색인과 설계서를 둔 리포. 커밋까지 한다 */
function repo(designText: string, exclude: string[] = []): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(root, 'docs/index.md', `${FRONT}# 목차\n\n- [설계서](harness/design.md)\n`);
  write(root, DESIGN, FRONT + designText);
  commitAll(root);
  return root;
}

const STALE = design(head('0.7.2', '2026-11-21'), ITEMS);
const GOOD = design(head('0.7.3', '2026-11-21'), ITEMS);

test('design-version: docLint가 문서 목록에 설계서가 있을 때만 검사한다', () => {
  const root = repo(STALE);
  const r = docLint(root, loadConfig(root));
  assert.deepEqual(rules(r.errors), [RULE]);
  // 맞는 설계서는 오류가 없다
  const good = repo(GOOD);
  assert.deepEqual(rules(docLint(good, loadConfig(good)).errors), []);
  // docLint.exclude에 넣으면 검사하지 않는다
  const excluded = repo(STALE, [DESIGN]);
  assert.ok(!rules(docLint(excluded, loadConfig(excluded)).errors).includes(RULE));
  // 설계서가 없으면 검사하지 않는다(색인의 링크도 지운다)
  const none = repo(STALE);
  rmSync(path.join(none, DESIGN));
  write(none, 'docs/index.md', `${FRONT}# 목차\n`);
  commitAll(none);
  assert.deepEqual(rules(docLint(none, loadConfig(none)).errors), []);
});

test('design-version: doc-lint 명령과 check의 doc-lint 단계가 실패하고, 머리말을 맞추면 통과한다', () => {
  const root = repo(STALE);
  const lint = cli(['doc-lint'], root);
  assert.equal(lint.code, 1, lint.stdout + lint.stderr);
  assert.ok((lint.stdout + lint.stderr).includes(RULE), lint.stdout + lint.stderr);
  const check = cli(['check', '--only', 'doc-lint', '--no-cache'], root);
  const out = check.stdout + check.stderr;
  assert.equal(check.code, 1, out);
  assert.ok(out.includes('✗ doc-lint') && out.includes(RULE), out);

  write(root, DESIGN, FRONT + GOOD);
  commitAll(root);
  const lint2 = cli(['doc-lint'], root);
  assert.equal(lint2.code, 0, lint2.stdout + lint2.stderr);
  const check2 = cli(['check', '--only', 'doc-lint', '--no-cache'], root);
  assert.equal(check2.code, 0, check2.stdout + check2.stderr);
});

test('design-version: 머리말 줄 안의 유니코드 줄 구분 문자는 줄을 나누지 않는다', () => {
  // 줄은 LF로만 나눈다. U+2028·U+2029는 머리말 가운데의 임의의 글자다
  for (const ch of [' ', ' ']) {
    const line = `> 버전 v0.7.3 · 상태: 초안${ch}검토 중 · 최종 갱신: 2026-11-21`;
    assert.deepEqual(designVersionProblems(design(line, ITEMS)), [], JSON.stringify(ch));
  }
});

test('design-version: 변경 이력의 문제가 아주 많아도 docLint가 예외 없이 모두 돌려준다', () => {
  const N = 200_000;
  const many = Array.from({ length: N }, () => item('0.7.3', '2026-11-21'));
  const root = repo(design(head('0.7.3', '2026-11-21'), many));
  const r = docLint(root, loadConfig(root));
  assert.equal(r.errors.length, N - 1);
  assert.ok(r.errors.every((e) => e.rule === RULE));
});
